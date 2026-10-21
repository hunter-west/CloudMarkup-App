-- Migration 0012 admitted orchestration jobs but not their creation claims.
-- Extend only these three claim checks; all tenant, source, object, and
-- lifecycle constraints remain unchanged. Historical migrations stay pinned.
ALTER TABLE async_job_creation_claims
  DROP CONSTRAINT async_job_creation_claims_family_check,
  ADD CONSTRAINT async_job_creation_claims_family_check CHECK (family IN (
    'intent-extraction', 'architecture-proposal', 'workload-contract-proposal',
    'graph-workload-operation-proposal', 'iac-compilation',
    'application-source-generation', 'application-build-test-package',
    'static-validation', 'diagram-rendering', 'combined-export-packaging',
    'solution-export-orchestration', 'github-repository-export',
    'customer-owned-plan-evidence', 'deployment-evidence',
    'smoke-integration-evidence', 'drift-evidence', 'billing-usage-reconciliation'
  ));

DO $$
DECLARE
  matching_constraint RECORD;
  matching_count INTEGER := 0;
BEGIN
  FOR matching_constraint IN
    SELECT constraint_record.conname
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = 'async_job_creation_claims'::regclass
      AND constraint_record.contype = 'c'
      AND position('environment_type IS NOT NULL'
        IN pg_get_constraintdef(constraint_record.oid)) > 0
      AND position('application-build-test-package'
        IN pg_get_constraintdef(constraint_record.oid)) > 0
  LOOP
    matching_count := matching_count + 1;
    EXECUTE format('ALTER TABLE async_job_creation_claims DROP CONSTRAINT %I',
      matching_constraint.conname);
  END LOOP;
  IF matching_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one creation-claim environment-family check'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE async_job_creation_claims
  ADD CONSTRAINT async_job_creation_claims_environment_family_check_v2 CHECK (
    (family IN (
      'iac-compilation', 'application-source-generation',
      'application-build-test-package', 'solution-export-orchestration',
      'github-repository-export', 'static-validation',
      'customer-owned-plan-evidence', 'deployment-evidence',
      'smoke-integration-evidence', 'drift-evidence'
    ) AND environment_type IS NOT NULL)
    OR (family NOT IN (
      'iac-compilation', 'application-source-generation',
      'application-build-test-package', 'solution-export-orchestration',
      'github-repository-export', 'static-validation',
      'customer-owned-plan-evidence', 'deployment-evidence',
      'smoke-integration-evidence', 'drift-evidence'
    ) AND environment_type IS NULL AND environment_id IS NULL)
  );

DO $$
DECLARE
  matching_constraint RECORD;
  matching_count INTEGER := 0;
BEGIN
  FOR matching_constraint IN
    SELECT constraint_record.conname
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = 'async_job_creation_claims'::regclass
      AND constraint_record.contype = 'c'
      AND cardinality(constraint_record.conkey) = 2
      AND position('billing-usage-reconciliation'
        IN pg_get_constraintdef(constraint_record.oid)) > 0
      AND position('graph-workload-operation-proposal'
        IN pg_get_constraintdef(constraint_record.oid)) > 0
      AND constraint_record.conkey @> ARRAY[
        (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'async_job_creation_claims'::regclass
            AND attname = 'family' AND NOT attisdropped),
        (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'async_job_creation_claims'::regclass
            AND attname = 'subject_kind' AND NOT attisdropped)
      ]::SMALLINT[]
  LOOP
    matching_count := matching_count + 1;
    EXECUTE format('ALTER TABLE async_job_creation_claims DROP CONSTRAINT %I',
      matching_constraint.conname);
  END LOOP;
  IF matching_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one creation-claim family-subject check'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE async_job_creation_claims
  ADD CONSTRAINT async_job_creation_claims_family_subject_check_v2 CHECK (
    (family IN (
      'intent-extraction', 'architecture-proposal',
      'workload-contract-proposal', 'graph-workload-operation-proposal'
    ) AND subject_kind = 'draft')
    OR (family = 'static-validation'
      AND subject_kind IN ('draft', 'solution-revision'))
    OR (family IN (
      'iac-compilation', 'application-source-generation',
      'application-build-test-package', 'diagram-rendering',
      'combined-export-packaging', 'solution-export-orchestration',
      'github-repository-export', 'customer-owned-plan-evidence',
      'deployment-evidence', 'smoke-integration-evidence', 'drift-evidence'
    ) AND subject_kind = 'solution-revision')
    OR (family = 'billing-usage-reconciliation'
      AND subject_kind = 'organization')
  );

ALTER TABLE async_jobs
  ADD COLUMN measured_output_size_bytes BIGINT,
  ADD COLUMN failure_retry_after_seconds INTEGER;

ALTER TABLE async_jobs
  ADD CONSTRAINT async_jobs_measured_output_size_bounds_check
    CHECK (
      measured_output_size_bytes IS NULL
      OR (
        output_object_id IS NOT NULL
        AND measured_output_size_bytes BETWEEN 0 AND max_output_bytes
      )
    ),
  ADD CONSTRAINT async_jobs_failure_retry_delay_check
    CHECK (
      failure_retry_after_seconds IS NULL
      OR (
        failure_classification IS NOT DISTINCT FROM 'transient'
        AND failure_retry_after_seconds BETWEEN 1 AND 86400
      )
    );

ALTER TABLE async_job_attempts
  ADD COLUMN failure_retry_after_seconds INTEGER,
  ADD CONSTRAINT async_job_attempts_failure_retry_delay_check
    CHECK (
      failure_retry_after_seconds IS NULL
      OR (
        failure_classification IS NOT DISTINCT FROM 'transient'
        AND failure_retry_after_seconds BETWEEN 1 AND 86400
      )
    );

ALTER TABLE async_job_creation_claim_events
  ADD COLUMN denial_source VARCHAR(16),
  ADD CONSTRAINT async_job_creation_claim_events_denial_source_check
    CHECK (
      denial_source IS NULL
      OR denial_source IN ('entitlement', 'recovery', 'reservation')
    );

ALTER TABLE async_job_events
  ADD COLUMN transition_at TIMESTAMPTZ;

ALTER TABLE async_job_events
  ADD CONSTRAINT async_job_events_transition_at_presence_check
    CHECK (transition_at IS NULL OR to_status IS NOT NULL);

CREATE FUNCTION validate_async_job_creation_claim_event_runtime_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.event_kind = 'creation-denied') <> (NEW.denial_source IS NOT NULL) THEN
    RAISE EXCEPTION 'creation claim denial source does not match event kind'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_creation_claim_events_validate_runtime_metadata
BEFORE INSERT ON async_job_creation_claim_events
FOR EACH ROW EXECUTE FUNCTION validate_async_job_creation_claim_event_runtime_metadata();

CREATE FUNCTION validate_async_job_event_runtime_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.to_status IS NULL) <> (NEW.transition_at IS NULL) THEN
    RAISE EXCEPTION 'async job transition timestamp does not match transition presence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_events_validate_runtime_metadata
BEFORE INSERT ON async_job_events
FOR EACH ROW EXECUTE FUNCTION validate_async_job_event_runtime_metadata();

CREATE TABLE async_job_record_snapshots (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128),
  job_id VARCHAR(128) NOT NULL,
  record_version BIGINT NOT NULL,
  snapshot_object_id VARCHAR(128) NOT NULL,
  snapshot_sha256 CHAR(64) NOT NULL,
  snapshot_size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, job_id, record_version),
  CHECK (record_version > 0),
  CHECK (snapshot_object_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (snapshot_size_bytes BETWEEN 1 AND 4194304),
  FOREIGN KEY (organization_id, job_id)
    REFERENCES async_jobs(organization_id, job_id),
  FOREIGN KEY (organization_id, snapshot_object_id)
    REFERENCES stored_objects(organization_id, object_id),
  FOREIGN KEY (organization_id, project_id, snapshot_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id)
);

CREATE FUNCTION validate_async_job_record_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM async_jobs AS job
  JOIN stored_objects AS snapshot_object
    ON snapshot_object.organization_id = job.organization_id
   AND snapshot_object.project_id IS NOT DISTINCT FROM job.project_id
   AND snapshot_object.object_id = NEW.snapshot_object_id
  WHERE job.organization_id = NEW.organization_id
    AND job.project_id IS NOT DISTINCT FROM NEW.project_id
    AND job.job_id = NEW.job_id
    AND job.record_version = NEW.record_version
    AND (job.output_object_id IS NULL) = (job.measured_output_size_bytes IS NULL)
    AND snapshot_object.object_purpose = 'report'
    AND snapshot_object.media_type = 'application/json'
    AND snapshot_object.content_sha256 = NEW.snapshot_sha256
    AND snapshot_object.size_bytes = NEW.snapshot_size_bytes
    AND snapshot_object.lifecycle_state = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'async job snapshot does not match current normalized record and exact published object'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_record_snapshots_validate_record
BEFORE INSERT ON async_job_record_snapshots
FOR EACH ROW EXECUTE FUNCTION validate_async_job_record_snapshot();

CREATE TRIGGER async_job_record_snapshots_are_immutable
BEFORE UPDATE OR DELETE ON async_job_record_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE async_job_claim_snapshots (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128),
  operation_id VARCHAR(128) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  record_version BIGINT NOT NULL,
  snapshot_object_id VARCHAR(128) NOT NULL,
  snapshot_sha256 CHAR(64) NOT NULL,
  snapshot_size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (
    organization_id, operation_id, idempotency_key_sha256, record_version
  ),
  CHECK (record_version > 0),
  CHECK (snapshot_object_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (snapshot_size_bytes BETWEEN 1 AND 4194304),
  FOREIGN KEY (organization_id, operation_id, idempotency_key_sha256)
    REFERENCES async_job_creation_claims(
      organization_id, operation_id, idempotency_key_sha256
    ),
  FOREIGN KEY (organization_id, snapshot_object_id)
    REFERENCES stored_objects(organization_id, object_id),
  FOREIGN KEY (organization_id, project_id, snapshot_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id)
);

CREATE FUNCTION validate_async_job_claim_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM async_job_creation_claims AS claim
  JOIN stored_objects AS snapshot_object
    ON snapshot_object.organization_id = claim.organization_id
   AND snapshot_object.project_id IS NOT DISTINCT FROM claim.project_id
   AND snapshot_object.object_id = NEW.snapshot_object_id
  WHERE claim.organization_id = NEW.organization_id
    AND claim.project_id IS NOT DISTINCT FROM NEW.project_id
    AND claim.operation_id = NEW.operation_id
    AND claim.idempotency_key_sha256 = NEW.idempotency_key_sha256
    AND claim.record_version = NEW.record_version
    AND snapshot_object.object_purpose = 'report'
    AND snapshot_object.media_type = 'application/json'
    AND snapshot_object.content_sha256 = NEW.snapshot_sha256
    AND snapshot_object.size_bytes = NEW.snapshot_size_bytes
    AND snapshot_object.lifecycle_state = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'async job claim snapshot does not match current normalized claim and exact published object'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_claim_snapshots_validate_record
BEFORE INSERT ON async_job_claim_snapshots
FOR EACH ROW EXECUTE FUNCTION validate_async_job_claim_snapshot();

CREATE TRIGGER async_job_claim_snapshots_are_immutable
BEFORE UPDATE OR DELETE ON async_job_claim_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

COMMENT ON TABLE async_job_record_snapshots IS
  'Immutable bounded Async Job v1 metadata snapshots; normalized async_jobs rows remain checked authority and snapshot objects contain no raw payload bodies.';

COMMENT ON TABLE async_job_claim_snapshots IS
  'Immutable bounded creation-claim metadata snapshots; normalized claims remain checked authority and snapshot objects contain no raw idempotency keys or payload bodies.';
