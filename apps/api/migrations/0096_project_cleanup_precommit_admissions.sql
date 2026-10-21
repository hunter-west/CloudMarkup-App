-- K001437 forward schema after exact dormant 0094/0095. Defaults preserve
-- always-on admission and recovery; activation requires the source-bound proof.
CREATE TABLE project_cleanup_controls (
  control_id varchar(16) PRIMARY KEY CHECK (control_id='beta'),
  admission_required boolean NOT NULL DEFAULT false
);
INSERT INTO project_cleanup_controls(control_id) VALUES('beta');

CREATE TABLE project_cleanup_admissions (
  admission_id varchar(64) PRIMARY KEY CHECK (admission_id ~ '^[a-f0-9]{64}$'),
  organization_id varchar(128) NOT NULL,
  project_id varchar(128) NOT NULL,
  principal_id varchar(128) NOT NULL REFERENCES principals(principal_id),
  idempotency_key_sha256 varchar(64) NOT NULL CHECK (idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 varchar(64) NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  expected_record_version bigint NOT NULL CHECK (expected_record_version BETWEEN 1 AND 9007199254740990),
  wake_binding text NOT NULL CHECK (length(wake_binding) BETWEEN 1 AND 2048),
  admission_deadline timestamptz NOT NULL,
  lifecycle_status varchar(16) NOT NULL DEFAULT 'prepared' CHECK (lifecycle_status IN ('prepared','committed','aborted')),
  resolved_at timestamptz,
  FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,project_id),
  UNIQUE (organization_id,principal_id,idempotency_key_sha256),
  CHECK (jsonb_typeof(wake_binding::jsonb)='object'),
  CHECK (jsonb_typeof(wake_binding::jsonb->'schemaVersion')='number'
    AND jsonb_typeof(wake_binding::jsonb->'recordVersion')='number'
    AND jsonb_typeof(wake_binding::jsonb->'organizationId')='string'
    AND jsonb_typeof(wake_binding::jsonb->'projectId')='string'
    AND jsonb_typeof(wake_binding::jsonb->'deletionRequestedAt')='string'
    AND jsonb_typeof(wake_binding::jsonb->'admissionId')='string'
    AND jsonb_typeof(wake_binding::jsonb->'admissionDeadline')='string'
    AND jsonb_typeof(wake_binding::jsonb->'wakeId')='string'),
  CHECK (wake_binding::jsonb ?& ARRAY['schemaVersion','organizationId','projectId','recordVersion',
    'deletionRequestedAt','admissionId','admissionDeadline','wakeId']),
  CHECK (wake_binding::jsonb - ARRAY['schemaVersion','organizationId','projectId','recordVersion',
    'deletionRequestedAt','admissionId','admissionDeadline','wakeId'] = '{}'::jsonb),
  CHECK ((lifecycle_status='prepared') = (resolved_at IS NULL)),
  CHECK (wake_binding::jsonb->>'schemaVersion' = '2'),
  CHECK (wake_binding::jsonb->>'admissionId' = admission_id),
  CHECK (wake_binding::jsonb->>'organizationId' = organization_id),
  CHECK (wake_binding::jsonb->>'projectId' = project_id),
  CHECK ((wake_binding::jsonb->>'recordVersion')::bigint = expected_record_version+1),
  CHECK (wake_binding::jsonb->>'wakeId' ~ '^[a-f0-9]{64}$'),
  CHECK ((wake_binding::jsonb->>'admissionDeadline')::timestamptz = admission_deadline),
  CHECK ((wake_binding::jsonb->>'deletionRequestedAt')::timestamptz + interval '60 seconds' = admission_deadline)
);

CREATE UNIQUE INDEX project_cleanup_admission_wake_id ON project_cleanup_admissions ((wake_binding::jsonb->>'wakeId'));
CREATE UNIQUE INDEX project_cleanup_admission_binding ON project_cleanup_admissions
  (organization_id,project_id,expected_record_version,(wake_binding::jsonb->>'deletionRequestedAt'));

CREATE FUNCTION cloudmarkup_guard_cleanup_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Cleanup admission is retained';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.lifecycle_status<>'prepared' OR NEW.resolved_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cleanup admission must start prepared';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.admission_id,NEW.organization_id,NEW.project_id,NEW.principal_id,
    NEW.idempotency_key_sha256,NEW.request_sha256,NEW.expected_record_version,
    NEW.wake_binding,NEW.admission_deadline) IS DISTINCT FROM
    ROW(OLD.admission_id,OLD.organization_id,OLD.project_id,OLD.principal_id,
    OLD.idempotency_key_sha256,OLD.request_sha256,OLD.expected_record_version,
    OLD.wake_binding,OLD.admission_deadline) OR OLD.lifecycle_status<>'prepared' OR
    NEW.lifecycle_status NOT IN ('committed','aborted') OR NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'Cleanup admission is immutable';
  END IF;
  IF NEW.lifecycle_status='committed' AND clock_timestamp() >= OLD.admission_deadline AND NOT EXISTS(SELECT 1 FROM project_cleanup_controls c JOIN project_cleanup_restore_history r ON r.history_id=OLD.wake_binding::jsonb->>'wakeId' WHERE c.control_id='beta' AND c.restore_status='restoring' AND r.history_state='committed' AND r.envelope::jsonb->'wake'=OLD.wake_binding::jsonb AND r.envelope::jsonb->>'principalId'=OLD.principal_id AND r.envelope::jsonb->>'idempotencyKeySha256'=OLD.idempotency_key_sha256 AND r.envelope::jsonb->>'requestSha256'=OLD.request_sha256) THEN
    RAISE EXCEPTION 'Cleanup admission expired';
  END IF;
  IF NEW.lifecycle_status='aborted' AND clock_timestamp() < OLD.admission_deadline THEN
    RAISE EXCEPTION 'Cleanup admission is still open';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_cleanup_admission_guard BEFORE INSERT OR UPDATE OR DELETE
  ON project_cleanup_admissions FOR EACH ROW EXECUTE FUNCTION cloudmarkup_guard_cleanup_admission();

CREATE FUNCTION cloudmarkup_assert_cleanup_admission_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  admission project_cleanup_admissions%ROWTYPE;
  required_admission boolean;
BEGIN
  IF TG_TABLE_NAME='projects' THEN
    -- Existing/default admission remains compatible until coverage is approved.
    -- A matching durable admission cannot be bypassed or committed after abort.
    SELECT * INTO admission FROM project_cleanup_admissions
      WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND expected_record_version+1=NEW.record_version
      AND (wake_binding::jsonb->>'deletionRequestedAt')::timestamptz=NEW.deletion_requested_at;
    IF NOT FOUND THEN
      -- Backfilled prior default intents retain their original binding. Required
      -- mode prohibits a new/changed deletion binding, not cleanup progress.
      IF OLD.lifecycle_status='deletion-pending' AND NEW.record_version=OLD.record_version
        AND NEW.deletion_requested_at IS NOT DISTINCT FROM OLD.deletion_requested_at THEN
        RETURN NEW;
      END IF;
      SELECT admission_required INTO required_admission FROM project_cleanup_controls WHERE control_id='beta' FOR SHARE;
      IF (NOT FOUND OR required_admission) AND NOT EXISTS(SELECT 1 FROM project_cleanup_controls c JOIN project_cleanup_restore_history r ON r.envelope::jsonb->'wake'->>'organizationId'=NEW.organization_id AND r.envelope::jsonb->'wake'->>'projectId'=NEW.project_id WHERE c.control_id='beta' AND c.restore_status='restoring' AND r.history_state='committed' AND r.envelope::jsonb->>'kind'='legacy-deletion' AND (r.envelope::jsonb->'wake'->>'recordVersion')::bigint=NEW.record_version AND (r.envelope::jsonb->'wake'->>'deletionRequestedAt')::timestamptz=NEW.deletion_requested_at) THEN
        RAISE EXCEPTION 'Durable cleanup admission is required';
      END IF;
      RETURN NEW;
    END IF;
  ELSE
    SELECT * INTO admission FROM project_cleanup_admissions WHERE admission_id=NEW.admission_id;
    IF admission.lifecycle_status<>'committed' THEN RETURN NEW; END IF;
  END IF;
  IF admission.lifecycle_status<>'committed' OR NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.organization_id=admission.organization_id AND p.project_id=admission.project_id
    AND ((p.lifecycle_status='deletion-pending' AND p.record_version=admission.expected_record_version+1
      AND p.deletion_requested_at=(admission.wake_binding::jsonb->>'deletionRequestedAt')::timestamptz)
      OR (p.lifecycle_status='deleted' AND EXISTS (
        SELECT 1 FROM project_content_erasure_receipts r WHERE r.organization_id=p.organization_id AND r.project_id=p.project_id
        AND r.deletion_record_version=admission.expected_record_version+1
        AND r.deletion_requested_at=(admission.wake_binding::jsonb->>'deletionRequestedAt')::timestamptz)))
  ) THEN
    RAISE EXCEPTION 'Cleanup admission and deletion must commit together';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER project_cleanup_admission_commit AFTER INSERT OR UPDATE
  ON project_cleanup_admissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION cloudmarkup_assert_cleanup_admission_commit();

CREATE CONSTRAINT TRIGGER project_cleanup_admission_project AFTER UPDATE
  ON projects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.lifecycle_status='deletion-pending') EXECUTE FUNCTION cloudmarkup_assert_cleanup_admission_commit();

-- Ordinary project_content_writes and ordinary metadata authority stay closed.
CREATE TABLE project_cleanup_phases (
  organization_id varchar(128) NOT NULL,
  project_id varchar(128) NOT NULL,
  deletion_record_version bigint NOT NULL,
  deletion_requested_at timestamptz NOT NULL,
  phase varchar(16) NOT NULL DEFAULT 'draining' CHECK(phase IN ('draining','erasing')),
  PRIMARY KEY(organization_id,project_id),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,project_id)
);
CREATE FUNCTION cloudmarkup_guard_cleanup_phase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP='INSERT' AND NEW.phase<>'draining') OR TG_OP='DELETE' OR (TG_OP='UPDATE' AND (
    ROW(NEW.organization_id,NEW.project_id,NEW.deletion_record_version,NEW.deletion_requested_at)
      IS DISTINCT FROM ROW(OLD.organization_id,OLD.project_id,OLD.deletion_record_version,OLD.deletion_requested_at)
    OR OLD.phase<>'draining' OR NEW.phase<>'erasing')) THEN
    RAISE EXCEPTION 'Erasure phase cannot reopen';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM projects p JOIN project_content_write_scopes s USING(organization_id,project_id)
    WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id
    AND p.lifecycle_status='deletion-pending' AND p.record_version=NEW.deletion_record_version
    AND p.deletion_requested_at=NEW.deletion_requested_at AND s.closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Exact closed deletion is required';
  END IF;
  IF NEW.phase='erasing' AND (
    EXISTS(SELECT 1 FROM project_content_writes w WHERE w.organization_id=NEW.organization_id AND w.project_id=NEW.project_id AND w.lifecycle_status<>'completed')
    OR EXISTS(SELECT 1 FROM async_jobs j WHERE j.organization_id=NEW.organization_id AND j.project_id=NEW.project_id AND j.lifecycle_status NOT IN('succeeded','failed','canceled','expired','superseded'))
    OR EXISTS(SELECT 1 FROM solution_export_runs x WHERE x.organization_id=NEW.organization_id AND x.project_id=NEW.project_id AND x.lifecycle_status NOT IN('succeeded','failed','canceled'))
    OR EXISTS(SELECT 1 FROM credit_reservations c WHERE c.organization_id=NEW.organization_id AND c.project_id=NEW.project_id AND c.status='active')
    OR EXISTS(SELECT 1 FROM project_deletion_recovery_objects r WHERE r.organization_id=NEW.organization_id AND r.project_id=NEW.project_id AND r.lifecycle_status NOT IN('completed','aborted'))
  ) THEN RAISE EXCEPTION 'Canonical draining must finish before erasure'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_cleanup_phase_guard BEFORE INSERT OR UPDATE OR DELETE ON project_cleanup_phases
  FOR EACH ROW EXECUTE FUNCTION cloudmarkup_guard_cleanup_phase();
CREATE TABLE project_deletion_recovery_objects (
  object_id varchar(128) PRIMARY KEY,
  organization_id varchar(128) NOT NULL,
  project_id varchar(128) NOT NULL,
  job_id varchar(128) NOT NULL,
  job_record_version bigint NOT NULL,
  deletion_record_version bigint NOT NULL,
  content_sha256 char(64) NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 33554432),
  object_purpose varchar(32) NOT NULL CHECK(object_purpose IN('report','checkpoint-state','evidence','validation-report','input-payload','generated-source')),
  media_type varchar(128) NOT NULL,
  history_id char(64),
  created_by_principal_id varchar(128) NOT NULL REFERENCES principals(principal_id),
  lifecycle_status varchar(16) NOT NULL DEFAULT 'in-flight' CHECK(lifecycle_status IN('in-flight','completed','uncertain','aborted')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz,
  FOREIGN KEY(organization_id,project_id) REFERENCES project_cleanup_phases(organization_id,project_id),
  FOREIGN KEY(organization_id,job_id) REFERENCES async_jobs(organization_id,job_id),
  CHECK((lifecycle_status='in-flight')=(finalized_at IS NULL))
);
CREATE FUNCTION cloudmarkup_guard_deletion_recovery_object() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closed_at timestamptz;
BEGIN
  SELECT s.closed_at INTO closed_at FROM project_content_write_scopes s
    WHERE s.organization_id=NEW.organization_id AND s.project_id=NEW.project_id FOR UPDATE;
  IF NOT FOUND OR closed_at IS NULL THEN RAISE EXCEPTION 'Permanent closure is required'; END IF;
  IF TG_OP='INSERT' THEN
    IF EXISTS(SELECT 1 FROM project_cleanup_controls WHERE control_id='beta' AND history_required) AND NEW.history_id IS NULL THEN RAISE EXCEPTION 'Durable recovery writer history is required'; END IF;
    IF NEW.lifecycle_status<>'in-flight' OR NEW.finalized_at IS NOT NULL OR NOT EXISTS(
      SELECT 1 FROM project_cleanup_phases x JOIN projects p USING(organization_id,project_id)
      JOIN async_jobs j ON j.organization_id=p.organization_id AND j.project_id=p.project_id
      WHERE x.organization_id=NEW.organization_id AND x.project_id=NEW.project_id AND x.phase='draining'
      AND x.deletion_record_version=NEW.deletion_record_version AND p.record_version=x.deletion_record_version
      AND p.deletion_requested_at=x.deletion_requested_at AND p.lifecycle_status='deletion-pending'
      AND j.job_id=NEW.job_id AND (j.record_version=NEW.job_record_version OR EXISTS(SELECT 1 FROM project_cleanup_controls c JOIN project_cleanup_restore_history h ON h.history_id=NEW.history_id WHERE c.control_id='beta' AND c.restore_status='restoring' AND h.envelope::jsonb->>'kind'='write' AND h.envelope::jsonb->>'storageNamespace'='deletion-recovery' AND h.envelope::jsonb->>'objectId'=NEW.object_id AND h.envelope::jsonb->>'organizationId'=NEW.organization_id AND h.envelope::jsonb->>'projectId'=NEW.project_id AND h.envelope::jsonb->>'contentSha256'=NEW.content_sha256 AND h.envelope::jsonb->>'principalId'=NEW.created_by_principal_id AND (h.envelope::jsonb#>>'{recovery,jobRecordVersion}')::bigint=NEW.job_record_version AND h.envelope::jsonb#>>'{recovery,jobId}'=NEW.job_id AND j.record_version<=NEW.job_record_version))
      AND j.created_by_principal_id=NEW.created_by_principal_id
      AND (EXISTS(SELECT 1 FROM project_cleanup_controls c JOIN project_cleanup_restore_history h ON h.history_id=NEW.history_id WHERE c.control_id='beta' AND c.restore_status='restoring' AND h.envelope::jsonb->>'objectId'=NEW.object_id) OR j.lifecycle_status NOT IN('succeeded','failed','canceled','expired','superseded') OR EXISTS(
        SELECT 1 FROM solution_export_runs r WHERE r.organization_id=j.organization_id AND r.project_id=j.project_id
        AND r.root_job_id=j.job_id AND r.lifecycle_status NOT IN('succeeded','failed','canceled')))
      AND NOT EXISTS(SELECT 1 FROM async_job_attempts a JOIN async_jobs aj USING(organization_id,job_id)
        WHERE aj.organization_id=p.organization_id AND aj.project_id=p.project_id
        AND a.lifecycle_status='running' AND a.lease_expires_at>clock_timestamp())
    ) THEN RAISE EXCEPTION 'Canonical drained deletion recovery is required'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' OR
    (to_jsonb(NEW)-ARRAY['lifecycle_status','finalized_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['lifecycle_status','finalized_at']) OR NOT (OLD.lifecycle_status='in-flight' AND NEW.lifecycle_status IN('completed','uncertain') OR OLD.lifecycle_status IN('in-flight','uncertain') AND NEW.lifecycle_status IN('completed','aborted') AND EXISTS(SELECT 1 FROM project_deletion_recovery_completion_proofs f WHERE f.object_id=OLD.object_id AND f.history_id=OLD.history_id AND f.history_state=CASE WHEN NEW.lifecycle_status='completed' THEN 'completed' ELSE 'aborted' END))
    OR NEW.lifecycle_status NOT IN('completed','uncertain','aborted') OR NEW.finalized_at IS NULL THEN
    RAISE EXCEPTION 'Recovery write is immutable';
  END IF;
  IF NEW.lifecycle_status='completed' AND NOT EXISTS(SELECT 1 FROM stored_objects o
    WHERE o.object_id=NEW.object_id AND o.organization_id=NEW.organization_id AND o.project_id=NEW.project_id
      AND o.lifecycle_state='published' AND o.content_sha256=NEW.content_sha256 AND o.size_bytes=NEW.size_bytes
      AND o.object_purpose=NEW.object_purpose AND o.media_type=NEW.media_type AND o.storage_provider='s3') THEN
    RAISE EXCEPTION 'Published canonical snapshot is required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_deletion_recovery_object_guard BEFORE INSERT OR UPDATE OR DELETE ON project_deletion_recovery_objects
  FOR EACH ROW EXECUTE FUNCTION cloudmarkup_guard_deletion_recovery_object();

-- Ordinary metadata closure remains unchanged except exact registered canonical
-- recovery objects while phase is draining. No setting, actor flag or lease opens it.
CREATE OR REPLACE FUNCTION enforce_closed_project_object_metadata() RETURNS TRIGGER AS $$
DECLARE project_state text;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT lifecycle_status INTO project_state FROM projects
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id FOR SHARE;
  IF NOT FOUND OR project_state IN ('active','archived') THEN RETURN NEW; END IF;
  IF project_state='deletion-pending' AND NEW.lifecycle_state IN('publication-pending','published')
    AND NEW.storage_provider='s3'
    AND NEW.storage_key=('documents/v1/organizations/v1/organizations/'||NEW.organization_id||'/projects/'||NEW.project_id||'/'||NEW.object_purpose||'/'||NEW.object_id||'/'||NEW.content_sha256)
    AND EXISTS(
      SELECT 1 FROM project_deletion_recovery_objects r JOIN project_cleanup_phases x USING(organization_id,project_id)
      WHERE r.object_id=NEW.object_id AND r.organization_id=NEW.organization_id AND r.project_id=NEW.project_id
      AND r.content_sha256=NEW.content_sha256 AND r.size_bytes=NEW.size_bytes AND r.object_purpose=NEW.object_purpose
      AND r.created_by_principal_id=NEW.created_by_principal_id AND r.media_type=NEW.media_type AND x.phase='draining'
      AND (r.lifecycle_status='in-flight' OR r.lifecycle_status='uncertain' AND EXISTS(SELECT 1 FROM project_deletion_recovery_completion_proofs f WHERE f.object_id=r.object_id AND f.history_id=r.history_id AND f.history_state='completed' AND f.object_version=NEW.object_version)
        OR TG_OP='INSERT' AND r.lifecycle_status='completed' AND EXISTS(SELECT 1 FROM stored_objects existing_object WHERE existing_object.object_id=NEW.object_id AND existing_object.lifecycle_state='published'
          AND ROW(existing_object.organization_id,existing_object.project_id,existing_object.object_purpose,existing_object.storage_key,existing_object.object_version,existing_object.entity_tag,existing_object.content_sha256,existing_object.size_bytes,existing_object.media_type,existing_object.created_by_principal_id)
          IS NOT DISTINCT FROM ROW(NEW.organization_id,NEW.project_id,NEW.object_purpose,NEW.storage_key,NEW.object_version,NEW.entity_tag,NEW.content_sha256,NEW.size_bytes,NEW.media_type,NEW.created_by_principal_id)))
  ) AND (TG_OP='INSERT' OR
    (to_jsonb(NEW)-ARRAY['lifecycle_state','published_at']) IS NOT DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['lifecycle_state','published_at'])) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND project_state='deletion-pending' AND NEW.lifecycle_state='deleted'
    AND (to_jsonb(NEW)-ARRAY['lifecycle_state','delete_requested_at','deleted_at']) IS NOT DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['lifecycle_state','delete_requested_at','deleted_at'])
    AND EXISTS(SELECT 1 FROM project_content_write_scopes s WHERE s.organization_id=NEW.organization_id
      AND s.project_id=NEW.project_id AND s.closed_at IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM project_content_writes w WHERE w.organization_id=NEW.organization_id
      AND w.project_id=NEW.project_id AND w.lifecycle_status<>'completed')
    AND NOT EXISTS(SELECT 1 FROM project_deletion_recovery_objects r WHERE r.organization_id=NEW.organization_id
      AND r.project_id=NEW.project_id AND r.lifecycle_status NOT IN('completed','aborted')) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Project object metadata is closed for erasure' USING ERRCODE='23514';
END;
$$ LANGUAGE plpgsql;

ALTER TABLE project_cleanup_controls ADD COLUMN recovery_required boolean NOT NULL DEFAULT false;
CREATE FUNCTION cloudmarkup_guard_recovery_erasure_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE required boolean;
BEGIN
  SELECT recovery_required INTO required FROM project_cleanup_controls WHERE control_id='beta' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cleanup controls are unavailable'; END IF;
  IF required AND NOT EXISTS(SELECT 1 FROM project_cleanup_phases p
    WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id AND p.phase='erasing'
      AND p.deletion_record_version=NEW.deletion_record_version AND p.deletion_requested_at=NEW.deletion_requested_at) THEN
    RAISE EXCEPTION 'Permanent recovery publication seal is required';
  END IF;
  IF EXISTS(SELECT 1 FROM project_deletion_recovery_objects r WHERE r.organization_id=NEW.organization_id
    AND r.project_id=NEW.project_id AND r.lifecycle_status NOT IN('completed','aborted')) THEN RAISE EXCEPTION 'Recovery writes remain uncertain'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_content_erasure_requires_recovery_seal BEFORE INSERT ON project_content_erasure_receipts
  FOR EACH ROW EXECUTE FUNCTION cloudmarkup_guard_recovery_erasure_receipt();


-- External completion proofs are imported only after an exact strong retained
-- history read. SQL restoration cannot manufacture provider completion.
ALTER TABLE project_content_writes ADD COLUMN history_id char(64) CHECK(history_id ~ '^[a-f0-9]{64}$');
ALTER TABLE project_cleanup_controls ADD COLUMN history_required boolean NOT NULL DEFAULT false;
ALTER TABLE project_cleanup_controls ADD COLUMN restore_status varchar(16) NOT NULL DEFAULT 'ready' CHECK(restore_status IN('ready','restoring','quarantined'));
CREATE TABLE project_content_write_completion_proofs (
 write_id varchar(128) PRIMARY KEY REFERENCES project_content_writes(write_id),
 history_id char(64) NOT NULL CHECK(history_id ~ '^[a-f0-9]{64}$'),
 history_state varchar(16) NOT NULL CHECK(history_state IN('completed','aborted')),
 object_version text,
 CHECK((history_state='completed')=(object_version IS NOT NULL))
);
CREATE TABLE project_deletion_recovery_completion_proofs (
 object_id varchar(128) PRIMARY KEY REFERENCES project_deletion_recovery_objects(object_id),
 history_id char(64) NOT NULL CHECK(history_id ~ '^[a-f0-9]{64}$'),
 history_state varchar(16) NOT NULL CHECK(history_state IN('completed','aborted')),
 object_version text,
 CHECK((history_state='completed')=(object_version IS NOT NULL))
);
CREATE FUNCTION cloudmarkup_immutable_cleanup_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Cleanup completion proof is immutable'; END;
$$;
CREATE TRIGGER project_content_completion_proof_immutable BEFORE UPDATE OR DELETE ON project_content_write_completion_proofs FOR EACH ROW EXECUTE FUNCTION cloudmarkup_immutable_cleanup_proof();
CREATE TRIGGER project_recovery_completion_proof_immutable BEFORE UPDATE OR DELETE ON project_deletion_recovery_completion_proofs FOR EACH ROW EXECUTE FUNCTION cloudmarkup_immutable_cleanup_proof();
CREATE OR REPLACE FUNCTION enforce_project_content_write() RETURNS TRIGGER AS $$
DECLARE scope_closed timestamptz; required boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT closed_at INTO scope_closed FROM project_content_write_scopes WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id FOR UPDATE;
  IF (NOT FOUND OR scope_closed IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM project_cleanup_controls c JOIN project_cleanup_restore_history r ON r.history_id=NEW.history_id WHERE c.control_id='beta' AND c.restore_status='restoring' AND r.envelope::jsonb->>'kind'='write' AND r.envelope::jsonb->>'writeId'=NEW.write_id AND r.envelope::jsonb->>'organizationId'=NEW.organization_id AND r.envelope::jsonb->>'projectId'=NEW.project_id AND r.envelope::jsonb->>'objectId'=NEW.object_id AND r.envelope::jsonb->>'contentSha256'=NEW.content_sha256 AND r.envelope::jsonb->>'principalId'=NEW.created_by_principal_id AND r.envelope::jsonb->>'storageNamespace'=NEW.storage_namespace) OR NEW.lifecycle_status<>'in-flight' THEN RAISE EXCEPTION 'project write scope is closed' USING ERRCODE='23514'; END IF;
  SELECT history_required INTO required FROM project_cleanup_controls WHERE control_id='beta' FOR SHARE;
  IF NOT FOUND OR required AND NEW.history_id IS NULL THEN RAISE EXCEPTION 'Durable writer history is required'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['lifecycle_status','finalized_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['lifecycle_status','finalized_at'])
  OR NEW.finalized_at IS NULL OR NEW.finalized_at<OLD.created_at
  OR NOT(OLD.lifecycle_status='in-flight' AND NEW.lifecycle_status IN('completed','uncertain')
    OR OLD.lifecycle_status='uncertain' AND NEW.lifecycle_status='completed' AND EXISTS(
      SELECT 1 FROM project_content_write_completion_proofs f WHERE f.write_id=OLD.write_id AND f.history_id=OLD.history_id AND f.history_state IN('completed','aborted')))
 THEN RAISE EXCEPTION 'project write outcome is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TABLE project_deletion_job_terminals (
 organization_id varchar(128) NOT NULL, project_id varchar(128) NOT NULL,job_id varchar(128) NOT NULL,
 deletion_record_version bigint NOT NULL,prior_record_version bigint NOT NULL,terminal_record_version bigint NOT NULL,
 prior_snapshot_object_id varchar(128) NOT NULL,
 terminal_snapshot_object_id varchar(128) NOT NULL,command_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,job_id,terminal_record_version),
 FOREIGN KEY(organization_id,project_id) REFERENCES project_cleanup_phases(organization_id,project_id),
 FOREIGN KEY(organization_id,project_id,prior_snapshot_object_id) REFERENCES stored_objects(organization_id, project_id, object_id),
 FOREIGN KEY(organization_id,project_id,terminal_snapshot_object_id) REFERENCES stored_objects(organization_id, project_id, object_id),
 CHECK(terminal_record_version=prior_record_version+1)
);
CREATE FUNCTION cloudmarkup_guard_deletion_job_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM async_jobs j JOIN project_cleanup_phases p USING(organization_id,project_id)
  JOIN async_job_record_snapshots previous_snapshot ON previous_snapshot.organization_id=j.organization_id AND previous_snapshot.job_id=j.job_id AND previous_snapshot.record_version=NEW.prior_record_version
  JOIN async_job_record_snapshots next ON next.organization_id=j.organization_id AND next.job_id=j.job_id AND next.record_version=NEW.terminal_record_version
  WHERE j.organization_id=NEW.organization_id AND j.project_id=NEW.project_id AND j.job_id=NEW.job_id
   AND j.record_version=NEW.terminal_record_version AND j.lifecycle_status IN('canceled','expired') AND j.completed_at=NEW.command_at
   AND p.phase='draining' AND p.deletion_record_version=NEW.deletion_record_version
   AND previous_snapshot.snapshot_object_id=NEW.prior_snapshot_object_id AND next.snapshot_object_id=NEW.terminal_snapshot_object_id)
 THEN RAISE EXCEPTION 'Exact canonical deletion command receipt is required'; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER project_deletion_job_terminal_guard BEFORE INSERT OR UPDATE OR DELETE ON project_deletion_job_terminals FOR EACH ROW EXECUTE FUNCTION cloudmarkup_guard_deletion_job_terminal();
ALTER TABLE project_deletion_recovery_objects ADD CONSTRAINT recovery_media_bound CHECK(
 media_type='application/json' AND size_bytes<=4194304
 OR object_purpose IN('input-payload','generated-source') AND media_type IN('application/vnd.hashicorp.terraform','application/vnd.amazon.cloudformation.template+json','application/yaml','image/svg+xml','text/markdown','text/plain','text/typescript','text/javascript')
);

-- Terminal erasure cannot race later work admission, even an old host.
CREATE FUNCTION cloudmarkup_guard_sealed_project_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text; sealed boolean;
BEGIN
 SELECT p.lifecycle_status,x.phase='erasing' INTO state,sealed FROM projects p LEFT JOIN project_cleanup_phases x USING(organization_id,project_id)
 WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id FOR SHARE OF p;
 IF state IN('deletion-pending','deleted') AND TG_OP='INSERT' THEN RAISE EXCEPTION 'Deleted project work admission is closed'; END IF;
 IF sealed OR state='deleted' THEN
  IF TG_TABLE_NAME='async_jobs' AND NEW.lifecycle_status NOT IN('succeeded','failed','canceled','expired','superseded')
   OR TG_TABLE_NAME='solution_export_runs' AND NEW.lifecycle_status NOT IN('succeeded','failed','canceled')
  THEN RAISE EXCEPTION 'Erasing project work cannot reopen'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER async_jobs_recovery_seal BEFORE INSERT OR UPDATE ON async_jobs FOR EACH ROW EXECUTE FUNCTION cloudmarkup_guard_sealed_project_work();
CREATE TRIGGER solution_export_runs_recovery_seal BEFORE INSERT OR UPDATE ON solution_export_runs FOR EACH ROW EXECUTE FUNCTION cloudmarkup_guard_sealed_project_work();
CREATE FUNCTION cloudmarkup_guard_sealed_project_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='active' AND EXISTS(SELECT 1 FROM projects p LEFT JOIN project_cleanup_phases x USING(organization_id,project_id)
 WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id AND (p.lifecycle_status='deleted' OR x.phase='erasing'))
 THEN RAISE EXCEPTION 'Erasing project credits cannot reopen'; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER credit_reservations_recovery_seal BEFORE INSERT OR UPDATE ON credit_reservations FOR EACH ROW EXECUTE FUNCTION cloudmarkup_guard_sealed_project_credit();

-- Imported external restore records are metadata-only and immutable. They are
-- not a runtime bypass: every ordinary host rejects restore_status<>ready.
CREATE TABLE project_cleanup_restore_history (
 history_id char(64) PRIMARY KEY CHECK(history_id ~ '^[a-f0-9]{64}$'),
 envelope text NOT NULL CHECK(length(envelope) BETWEEN 1 AND 8192),
 history_state varchar(16) NOT NULL CHECK(history_state IN('prepared','issued','committed','aborted','completed'))
);
CREATE TRIGGER project_cleanup_restore_history_immutable BEFORE UPDATE OR DELETE ON project_cleanup_restore_history FOR EACH ROW EXECUTE FUNCTION cloudmarkup_immutable_cleanup_proof();
