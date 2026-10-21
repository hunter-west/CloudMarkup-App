ALTER TABLE stored_objects
  DROP CONSTRAINT stored_objects_object_purpose_check,
  ADD CONSTRAINT stored_objects_object_purpose_check
    CHECK (object_purpose IN (
      'architecture-draft',
      'architecture-revision',
      'validation-report',
      'generated-code',
      'diagram',
      'report',
      'artifact-manifest',
      'combined-artifact',
      'repository-snapshot',
      'observed-solution',
      'reconciliation-proposal',
      'solution-revision-manifest',
      'ai-authored-extension',
      'active-issue',
      'evidence',
      'input-payload',
      'checkpoint-state',
      'proposal',
      'generated-source',
      'build-output',
      'export-package',
      'repository-export-receipt',
      'plan-result',
      'deployment-result',
      'smoke-integration-result',
      'drift-result',
      'billing-reconciliation-result'
    ));

ALTER TABLE stored_objects
  ADD CONSTRAINT stored_objects_organization_object_unique
  UNIQUE (organization_id, object_id);

CREATE TABLE async_job_identity_reservations (
  organization_id VARCHAR(128) NOT NULL
    REFERENCES organizations(organization_id),
  project_id VARCHAR(128),
  job_id VARCHAR(128) NOT NULL,
  reservation_kind VARCHAR(32) NOT NULL,
  root_job_id VARCHAR(128) NOT NULL,
  parent_job_id VARCHAR(128),
  correlation_id VARCHAR(128) NOT NULL,
  reserving_operation_id VARCHAR(128) NOT NULL,
  reserving_idempotency_key_sha256 CHAR(64) NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, job_id),
  UNIQUE (organization_id, project_id, job_id),
  CHECK (job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (root_job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (
    parent_job_id IS NULL
    OR parent_job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (
    correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (
    reserving_operation_id ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  ),
  CHECK (reserving_idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (
    (reservation_kind = 'root'
      AND parent_job_id IS NULL
      AND root_job_id = job_id)
    OR (reservation_kind = 'expected-child'
      AND parent_job_id IS NOT NULL
      AND parent_job_id <> job_id
      AND root_job_id <> job_id)
  ),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, root_job_id)
    REFERENCES async_job_identity_reservations(organization_id, job_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, project_id, root_job_id)
    REFERENCES async_job_identity_reservations(
      organization_id, project_id, job_id
    ) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, parent_job_id)
    REFERENCES async_job_identity_reservations(organization_id, job_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, project_id, parent_job_id)
    REFERENCES async_job_identity_reservations(
      organization_id, project_id, job_id
    ) DEFERRABLE INITIALLY DEFERRED
);

CREATE FUNCTION validate_async_job_identity_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reservation_kind = 'expected-child' THEN
    PERFORM 1
    FROM async_job_identity_reservations AS parent_identity
    WHERE parent_identity.organization_id = NEW.organization_id
      AND parent_identity.project_id IS NOT DISTINCT FROM NEW.project_id
      AND parent_identity.job_id = NEW.parent_job_id
      AND parent_identity.root_job_id = NEW.root_job_id
      AND parent_identity.correlation_id = NEW.correlation_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'expected child identity must match its reserved lineage'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_identity_reservations_validate_record
BEFORE INSERT ON async_job_identity_reservations
FOR EACH ROW EXECUTE FUNCTION validate_async_job_identity_reservation();

CREATE TRIGGER async_job_identity_reservations_are_immutable
BEFORE UPDATE OR DELETE ON async_job_identity_reservations
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
CREATE TABLE async_jobs (
  job_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL
    REFERENCES organizations(organization_id),
  project_id VARCHAR(128),
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  job_contract_version SMALLINT NOT NULL DEFAULT 1,
  family VARCHAR(64) NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'queued',
  subject_kind VARCHAR(32) NOT NULL,
  draft_id VARCHAR(128),
  draft_version BIGINT,
  draft_strong_etag VARCHAR(122),
  draft_content_sha256 CHAR(64),
  solution_revision_id VARCHAR(128),
  solution_manifest_record_id VARCHAR(128),
  solution_manifest_sha256 CHAR(64),
  environment_id VARCHAR(128),
  environment_type VARCHAR(32),
  input_object_id VARCHAR(128) NOT NULL,
  input_sha256 CHAR(64) NOT NULL,
  referenced_input_size_bytes BIGINT NOT NULL,
  inline_input_size_bytes INTEGER NOT NULL,
  output_object_id VARCHAR(128),
  output_sha256 CHAR(64),
  output_size_bytes BIGINT,
  idempotency_scope VARCHAR(128) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  idempotency_actor_id VARCHAR(128) NOT NULL,
  idempotency_request_sha256 CHAR(64) NOT NULL,
  correlation_id VARCHAR(128) NOT NULL,
  entitlement_decision_reference VARCHAR(128) NOT NULL,
  reservation_reference VARCHAR(128),
  root_job_id VARCHAR(128) NOT NULL,
  parent_job_id VARCHAR(128),
  parent_failure_policy VARCHAR(32) NOT NULL,
  progress_phase VARCHAR(128),
  progress_sequence BIGINT,
  progress_completed_units BIGINT,
  progress_total_units BIGINT,
  progress_message_key VARCHAR(128),
  progress_updated_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  checkpoint_count INTEGER NOT NULL DEFAULT 0,
  artifact_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  max_runtime_seconds INTEGER NOT NULL,
  max_referenced_input_bytes BIGINT NOT NULL,
  max_inline_input_bytes INTEGER NOT NULL,
  max_output_bytes BIGINT NOT NULL,
  max_checkpoint_bytes BIGINT NOT NULL,
  max_checkpoints INTEGER NOT NULL,
  max_artifacts INTEGER NOT NULL,
  cancellation_requested_at TIMESTAMPTZ,
  cancellation_requested_by VARCHAR(128),
  cancellation_acknowledged_at TIMESTAMPTZ,
  interaction_state VARCHAR(32) NOT NULL DEFAULT 'none',
  interaction_id VARCHAR(128),
  interaction_checkpoint_id VARCHAR(128),
  interaction_handler_id VARCHAR(128),
  interaction_handler_version VARCHAR(128),
  interaction_requested_at TIMESTAMPTZ,
  interaction_response_object_id VARCHAR(128),
  interaction_response_sha256 CHAR(64),
  interaction_response_size_bytes BIGINT,
  interaction_received_at TIMESTAMPTZ,
  latest_checkpoint_id VARCHAR(128),
  superseded_by_job_id VARCHAR(128),
  safe_failure_code VARCHAR(128),
  failure_classification VARCHAR(32),
  internal_error_id VARCHAR(128),
  public_failure_message VARCHAR(64),
  expires_at TIMESTAMPTZ,
  created_by_actor_kind VARCHAR(32) NOT NULL,
  created_by_actor_reference VARCHAR(128) NOT NULL,
  created_by_principal_id VARCHAR(128)
    REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  record_version BIGINT NOT NULL DEFAULT 1,
  CHECK (job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (job_contract_version = 1),
  CHECK (family IN (
    'intent-extraction',
    'architecture-proposal',
    'workload-contract-proposal',
    'graph-workload-operation-proposal',
    'iac-compilation',
    'application-source-generation',
    'application-build-test-package',
    'static-validation',
    'diagram-rendering',
    'combined-export-packaging',
    'github-repository-export',
    'customer-owned-plan-evidence',
    'deployment-evidence',
    'smoke-integration-evidence',
    'drift-evidence',
    'billing-usage-reconciliation'
  )),
  CHECK (lifecycle_status IN (
    'queued', 'running', 'awaiting-user-input', 'succeeded', 'failed',
    'canceled', 'expired', 'superseded'
  )),
  CHECK (subject_kind IN ('draft', 'solution-revision', 'organization')),
  CHECK (
    environment_type IS NULL
    OR environment_type IN (
      'development', 'test', 'staging', 'production',
      'disaster-recovery', 'multi-environment', 'unknown'
    )
  ),
  CHECK (environment_id IS NULL OR environment_type IS NOT NULL),
  CHECK (
    (family IN (
      'iac-compilation', 'application-source-generation',
      'application-build-test-package', 'github-repository-export',
      'static-validation', 'customer-owned-plan-evidence',
      'deployment-evidence', 'smoke-integration-evidence',
      'drift-evidence'
    ) AND environment_type IS NOT NULL)
    OR (family NOT IN (
      'iac-compilation', 'application-source-generation',
      'application-build-test-package', 'github-repository-export',
      'static-validation', 'customer-owned-plan-evidence',
      'deployment-evidence', 'smoke-integration-evidence',
      'drift-evidence'
    ) AND environment_type IS NULL AND environment_id IS NULL)
  ),
  CHECK (
    (subject_kind = 'draft'
      AND project_id IS NOT NULL
      AND draft_id IS NOT NULL
      AND draft_version IS NOT NULL
      AND draft_strong_etag IS NOT NULL
      AND draft_content_sha256 IS NOT NULL
      AND solution_revision_id IS NULL
      AND solution_manifest_record_id IS NULL
      AND solution_manifest_sha256 IS NULL)
    OR
    (subject_kind = 'solution-revision'
      AND project_id IS NOT NULL
      AND draft_id IS NULL
      AND draft_version IS NULL
      AND draft_strong_etag IS NULL
      AND draft_content_sha256 IS NULL
      AND solution_revision_id IS NOT NULL
      AND solution_manifest_record_id IS NOT NULL
      AND solution_manifest_sha256 IS NOT NULL)
    OR
    (subject_kind = 'organization'
      AND draft_id IS NULL
      AND project_id IS NULL
      AND draft_version IS NULL
      AND draft_strong_etag IS NULL
      AND draft_content_sha256 IS NULL
      AND solution_revision_id IS NULL
      AND solution_manifest_record_id IS NULL
      AND solution_manifest_sha256 IS NULL)
  ),
  CHECK (
    (family IN (
      'intent-extraction',
      'architecture-proposal',
      'workload-contract-proposal',
      'graph-workload-operation-proposal'
    ) AND subject_kind = 'draft')
    OR (family = 'static-validation'
      AND subject_kind IN ('draft', 'solution-revision'))
    OR (family IN (
      'iac-compilation',
      'application-source-generation',
      'application-build-test-package',
      'diagram-rendering',
      'combined-export-packaging',
      'github-repository-export',
      'customer-owned-plan-evidence',
      'deployment-evidence',
      'smoke-integration-evidence',
      'drift-evidence'
    ) AND subject_kind = 'solution-revision')
    OR (family = 'billing-usage-reconciliation'
      AND subject_kind = 'organization')
  ),
  CHECK (draft_version IS NULL OR draft_version > 0),
  CHECK (
    draft_strong_etag IS NULL
    OR draft_strong_etag ~ '^"[A-Za-z0-9._:-]{1,120}"$'
  ),
  CHECK (draft_content_sha256 IS NULL OR draft_content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (solution_manifest_sha256 IS NULL OR solution_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (idempotency_request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (idempotency_actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (
    idempotency_scope ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  ),
  CHECK (length(correlation_id) BETWEEN 1 AND 128),
  CHECK (referenced_input_size_bytes BETWEEN 0 AND max_referenced_input_bytes),
  CHECK (length(entitlement_decision_reference) BETWEEN 1 AND 128),
  CHECK (reservation_reference IS NULL OR length(reservation_reference) BETWEEN 1 AND 128),
  CHECK (inline_input_size_bytes BETWEEN 0 AND max_inline_input_bytes),
  CHECK (output_size_bytes IS NULL OR output_size_bytes BETWEEN 0 AND max_output_bytes),
  CHECK ((output_object_id IS NULL) = (output_sha256 IS NULL)),
  CHECK ((output_object_id IS NULL) = (output_size_bytes IS NULL)),
  CHECK ((lifecycle_status = 'succeeded') = (output_object_id IS NOT NULL)),
  CHECK (attempt_count BETWEEN 0 AND max_attempts),
  CHECK (checkpoint_count BETWEEN 0 AND max_checkpoints),
  CHECK (artifact_count BETWEEN 0 AND max_artifacts),
  CHECK (max_attempts BETWEEN 1 AND 10),
  CHECK (max_runtime_seconds BETWEEN 1 AND 86400),
  CHECK (max_inline_input_bytes BETWEEN 1 AND 65536),
  CHECK (max_referenced_input_bytes BETWEEN 1 AND 2147483648),
  CHECK (max_checkpoint_bytes BETWEEN 1 AND 268435456),
  CHECK (max_output_bytes BETWEEN 1 AND 2147483648),
  CHECK (max_checkpoints BETWEEN 1 AND 1024),
  CHECK (max_artifacts BETWEEN 1 AND 256),
  CHECK (record_version > 0),
  CHECK (parent_job_id IS NULL OR parent_job_id <> job_id),
  CHECK (created_by_actor_kind IN ('principal', 'worker', 'system')),
  CHECK (length(created_by_actor_reference) BETWEEN 1 AND 128),
  CHECK (
    (created_by_actor_kind = 'principal'
      AND created_by_principal_id IS NOT NULL
      AND created_by_actor_reference = created_by_principal_id
      AND idempotency_actor_id = created_by_principal_id)
    OR (created_by_actor_kind IN ('worker', 'system')
      AND created_by_principal_id IS NULL
      AND idempotency_actor_id = created_by_actor_reference)
  ),
  CHECK (superseded_by_job_id IS NULL OR superseded_by_job_id <> job_id),
  CHECK (parent_failure_policy IN (
    'fail-parent', 'cancel-remaining', 'continue-and-report'
  )),
  CHECK (
    public_failure_message IS NULL OR public_failure_message IN (
      'job-temporarily-unavailable', 'job-input-invalid',
      'job-not-supported', 'job-canceled', 'job-limit-exceeded',
      'job-expired', 'job-internal-error'
    )
  ),
  CHECK (
    safe_failure_code IS NULL
    OR safe_failure_code ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  ),
  CHECK (
    internal_error_id IS NULL
    OR internal_error_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (
    (progress_phase IS NULL
      AND progress_sequence IS NULL
      AND progress_completed_units IS NULL
      AND progress_total_units IS NULL
      AND progress_message_key IS NULL
      AND progress_updated_at IS NULL)
    OR (progress_phase IS NOT NULL
      AND progress_sequence IS NOT NULL
      AND progress_completed_units IS NOT NULL
      AND progress_updated_at IS NOT NULL)
  ),
  CHECK (progress_sequence IS NULL OR progress_sequence >= 0),
  CHECK (progress_completed_units IS NULL OR progress_completed_units >= 0),
  CHECK (progress_total_units IS NULL OR progress_total_units > 0),
  CHECK (progress_total_units IS NULL OR progress_completed_units <= progress_total_units),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (
    (cancellation_requested_at IS NULL
      AND cancellation_requested_by IS NULL
      AND cancellation_acknowledged_at IS NULL)
    OR (cancellation_requested_at IS NOT NULL
      AND cancellation_requested_by IS NOT NULL
      AND (cancellation_acknowledged_at IS NULL
        OR cancellation_acknowledged_at >= cancellation_requested_at))
  ),
  CHECK (interaction_state IN (
    'none', 'awaiting-user-input', 'user-input-received'
  )),
  CHECK (
    (interaction_state = 'none'
      AND interaction_id IS NULL
      AND interaction_checkpoint_id IS NULL
      AND interaction_handler_id IS NULL
      AND interaction_handler_version IS NULL
      AND interaction_requested_at IS NULL
      AND interaction_response_object_id IS NULL
      AND interaction_response_sha256 IS NULL
      AND interaction_response_size_bytes IS NULL
      AND interaction_received_at IS NULL)
    OR (interaction_state = 'awaiting-user-input'
      AND interaction_id IS NOT NULL
      AND interaction_checkpoint_id IS NOT NULL
      AND interaction_handler_id IS NOT NULL
      AND interaction_handler_version IS NOT NULL
      AND interaction_requested_at IS NOT NULL
      AND latest_checkpoint_id = interaction_checkpoint_id
      AND interaction_response_object_id IS NULL
      AND interaction_response_sha256 IS NULL
      AND interaction_response_size_bytes IS NULL
      AND interaction_received_at IS NULL)
    OR (interaction_state = 'user-input-received'
      AND interaction_id IS NOT NULL
      AND interaction_checkpoint_id IS NOT NULL
      AND interaction_handler_id IS NOT NULL
      AND interaction_handler_version IS NOT NULL
      AND interaction_requested_at IS NOT NULL
      AND interaction_response_object_id IS NOT NULL
      AND interaction_response_sha256 IS NOT NULL
      AND interaction_response_size_bytes IS NOT NULL
      AND interaction_received_at IS NOT NULL)
  ),
  CHECK (interaction_id IS NULL OR interaction_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (
    interaction_handler_id IS NULL
    OR interaction_handler_id ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  ),
  CHECK (
    interaction_handler_version IS NULL
    OR length(interaction_handler_version) BETWEEN 1 AND 128
  ),
  CHECK (
    interaction_response_sha256 IS NULL
    OR interaction_response_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CHECK (
    interaction_response_size_bytes IS NULL
    OR interaction_response_size_bytes BETWEEN 0 AND max_referenced_input_bytes
  ),
  CHECK (
    interaction_response_size_bytes IS NULL
    OR referenced_input_size_bytes + interaction_response_size_bytes
      <= max_referenced_input_bytes
  ),
  CHECK (
    interaction_received_at IS NULL
    OR interaction_received_at >= interaction_requested_at
  ),
  CHECK (started_at IS NULL OR started_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (queued_at >= created_at),
  CHECK (
    (lifecycle_status IN (
      'succeeded', 'failed', 'canceled', 'expired', 'superseded'
    )) = (completed_at IS NOT NULL)
  ),
  CHECK (
    failure_classification IS NULL
    OR failure_classification IN ('transient', 'permanent')
  ),
  CHECK (
    (lifecycle_status = 'failed') = (failure_classification IS NOT NULL)
  ),
  CHECK (internal_error_id IS NULL OR lifecycle_status = 'failed'),
  CHECK (
    (lifecycle_status = 'failed') = (safe_failure_code IS NOT NULL)
  ),
  CHECK (
    (lifecycle_status = 'failed') = (public_failure_message IS NOT NULL)
  ),
  CHECK (
    (lifecycle_status = 'superseded') = (superseded_by_job_id IS NOT NULL)
  ),
  CHECK (
    lifecycle_status <> 'canceled'
    OR cancellation_acknowledged_at IS NOT NULL
  ),
  UNIQUE (organization_id, job_id),
  UNIQUE (organization_id, project_id, job_id),
  UNIQUE (organization_id, idempotency_scope, idempotency_key_sha256),
  FOREIGN KEY (organization_id, job_id)
    REFERENCES async_job_identity_reservations(organization_id, job_id),
  FOREIGN KEY (organization_id, project_id, job_id)
    REFERENCES async_job_identity_reservations(
      organization_id, project_id, job_id
    ),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, project_id, draft_id)
    REFERENCES architecture_drafts(organization_id, project_id, draft_id),
  FOREIGN KEY (organization_id, project_id, solution_manifest_record_id)
    REFERENCES solution_records(organization_id, project_id, solution_record_id),
  FOREIGN KEY (organization_id, input_object_id)
    REFERENCES stored_objects(organization_id, object_id),
  FOREIGN KEY (organization_id, output_object_id)
    REFERENCES stored_objects(organization_id, object_id),
  FOREIGN KEY (organization_id, interaction_response_object_id)
    REFERENCES stored_objects(organization_id, object_id),
  FOREIGN KEY (organization_id, project_id, interaction_response_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, root_job_id)
    REFERENCES async_jobs(organization_id, job_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, project_id, root_job_id)
    REFERENCES async_jobs(organization_id, project_id, job_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, parent_job_id)
    REFERENCES async_jobs(organization_id, job_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, project_id, parent_job_id)
    REFERENCES async_jobs(organization_id, project_id, job_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, superseded_by_job_id)
    REFERENCES async_jobs(organization_id, job_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, project_id, superseded_by_job_id)
    REFERENCES async_jobs(organization_id, project_id, job_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE FUNCTION validate_async_job_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.record_version <> 1 THEN
    RAISE EXCEPTION 'async job initial record version must be one'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND ROW(
    OLD.organization_id, OLD.project_id, OLD.family, OLD.subject_kind,
    OLD.draft_id, OLD.draft_version, OLD.draft_strong_etag,
    OLD.draft_content_sha256, OLD.solution_revision_id,
    OLD.solution_manifest_record_id, OLD.solution_manifest_sha256,
    OLD.environment_id, OLD.environment_type, OLD.input_object_id,
    OLD.input_sha256, OLD.referenced_input_size_bytes,
    OLD.inline_input_size_bytes, OLD.idempotency_scope,
    OLD.idempotency_key_sha256, OLD.idempotency_actor_id,
    OLD.idempotency_request_sha256, OLD.correlation_id, OLD.root_job_id,
    OLD.entitlement_decision_reference, OLD.reservation_reference,
    OLD.parent_job_id, OLD.parent_failure_policy, OLD.max_attempts,
    OLD.max_runtime_seconds, OLD.max_referenced_input_bytes,
    OLD.max_inline_input_bytes, OLD.max_output_bytes,
    OLD.max_checkpoint_bytes, OLD.max_checkpoints, OLD.max_artifacts,
    OLD.expires_at, OLD.created_by_actor_kind, OLD.created_by_actor_reference,
    OLD.created_by_principal_id, OLD.created_at,
    OLD.queued_at
  ) IS DISTINCT FROM ROW(
    NEW.organization_id, NEW.project_id, NEW.family, NEW.subject_kind,
    NEW.draft_id, NEW.draft_version, NEW.draft_strong_etag,
    NEW.draft_content_sha256, NEW.solution_revision_id,
    NEW.solution_manifest_record_id, NEW.solution_manifest_sha256,
    NEW.environment_id, NEW.environment_type, NEW.input_object_id,
    NEW.input_sha256, NEW.referenced_input_size_bytes,
    NEW.inline_input_size_bytes, NEW.idempotency_scope,
    NEW.idempotency_key_sha256, NEW.idempotency_actor_id,
    NEW.idempotency_request_sha256, NEW.correlation_id, NEW.root_job_id,
    NEW.entitlement_decision_reference, NEW.reservation_reference,
    NEW.parent_job_id, NEW.parent_failure_policy, NEW.max_attempts,
    NEW.max_runtime_seconds, NEW.max_referenced_input_bytes,
    NEW.max_inline_input_bytes, NEW.max_output_bytes,
    NEW.max_checkpoint_bytes, NEW.max_checkpoints, NEW.max_artifacts,
    NEW.expires_at, NEW.created_by_actor_kind, NEW.created_by_actor_reference,
    NEW.created_by_principal_id, NEW.created_at,
    NEW.queued_at
  ) THEN
    RAISE EXCEPTION 'async job immutable identity cannot change'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.record_version <> OLD.record_version + 1 THEN
      RAISE EXCEPTION 'async job record version must advance by exactly one'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.progress_sequence IS NOT NULL
      AND NEW.progress_sequence IS NULL THEN
      RAISE EXCEPTION 'async job progress cannot be removed'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.progress_sequence IS DISTINCT FROM OLD.progress_sequence THEN
      IF NEW.progress_sequence <> COALESCE(OLD.progress_sequence, 0) + 1
        OR NEW.progress_completed_units < COALESCE(OLD.progress_completed_units, 0)
        OR (OLD.progress_total_units IS NOT NULL AND (
          NEW.progress_total_units IS NULL
          OR NEW.progress_total_units < OLD.progress_total_units
        )) THEN
        RAISE EXCEPTION 'async job progress must advance monotonically'
          USING ERRCODE = '55000';
      END IF;
    ELSIF ROW(
      OLD.progress_phase, OLD.progress_completed_units,
      OLD.progress_total_units, OLD.progress_message_key,
      OLD.progress_updated_at
    ) IS DISTINCT FROM ROW(
      NEW.progress_phase, NEW.progress_completed_units,
      NEW.progress_total_units, NEW.progress_message_key,
      NEW.progress_updated_at
    ) THEN
      RAISE EXCEPTION 'async job progress requires a new sequence'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.lifecycle_status <> NEW.lifecycle_status
    AND NOT (
      (OLD.lifecycle_status = 'queued'
        AND NEW.lifecycle_status IN (
          'running', 'failed', 'canceled', 'expired', 'superseded'
        ))
      OR (OLD.lifecycle_status = 'running'
        AND NEW.lifecycle_status IN (
          'queued', 'awaiting-user-input', 'succeeded', 'failed',
          'canceled', 'expired', 'superseded'
        ))
      OR (OLD.lifecycle_status = 'awaiting-user-input'
        AND NEW.lifecycle_status IN (
          'queued', 'failed', 'canceled', 'expired', 'superseded'
        ))
    ) THEN
    RAISE EXCEPTION 'invalid async job lifecycle transition'
      USING ERRCODE = '55000';
  END IF;


  PERFORM 1
  FROM async_job_identity_reservations AS identity_reservation
  WHERE identity_reservation.organization_id = NEW.organization_id
    AND identity_reservation.project_id IS NOT DISTINCT FROM NEW.project_id
    AND identity_reservation.job_id = NEW.job_id
    AND identity_reservation.root_job_id = NEW.root_job_id
    AND identity_reservation.parent_job_id IS NOT DISTINCT FROM NEW.parent_job_id
    AND identity_reservation.correlation_id = NEW.correlation_id
    AND (
      (NEW.parent_job_id IS NULL
        AND identity_reservation.reservation_kind = 'root'
        AND identity_reservation.reserving_operation_id = NEW.idempotency_scope
        AND identity_reservation.reserving_idempotency_key_sha256
          = NEW.idempotency_key_sha256)
      OR (NEW.parent_job_id IS NOT NULL
        AND identity_reservation.reservation_kind = 'expected-child')
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'async job identity was not reserved in exact scope'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.parent_job_id IS NOT NULL THEN
    PERFORM 1
    FROM async_jobs AS parent
    JOIN async_job_expected_children AS expected_child
      ON expected_child.organization_id = parent.organization_id
     AND expected_child.project_id IS NOT DISTINCT FROM parent.project_id
     AND expected_child.parent_job_id = parent.job_id
     AND expected_child.child_job_id = NEW.job_id
    JOIN async_job_identity_reservations AS child_identity
      ON child_identity.organization_id = expected_child.organization_id
     AND child_identity.project_id IS NOT DISTINCT FROM expected_child.project_id
     AND child_identity.job_id = expected_child.child_job_id
     AND child_identity.reservation_kind = 'expected-child'
     AND child_identity.parent_job_id = parent.job_id
     AND child_identity.root_job_id = parent.root_job_id
     AND child_identity.correlation_id = parent.correlation_id
    WHERE parent.organization_id = NEW.organization_id
      AND parent.project_id IS NOT DISTINCT FROM NEW.project_id
      AND parent.job_id = NEW.parent_job_id
      AND parent.root_job_id = NEW.root_job_id
      AND parent.correlation_id = NEW.correlation_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'async job child was not in its parent reserved expected set'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.subject_kind = 'solution-revision' THEN
    PERFORM 1
    FROM solution_records AS manifest
    WHERE manifest.organization_id = NEW.organization_id
      AND manifest.project_id = NEW.project_id
      AND manifest.solution_record_id = NEW.solution_manifest_record_id
      AND manifest.record_kind = 'solution-revision-manifest'
      AND manifest.subject_id = NEW.solution_revision_id
      AND manifest.content_sha256 = NEW.solution_manifest_sha256;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'async job Solution Revision manifest does not match'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM 1
  FROM stored_objects AS input_object
  WHERE input_object.organization_id = NEW.organization_id
    AND input_object.project_id IS NOT DISTINCT FROM NEW.project_id
    AND input_object.object_id = NEW.input_object_id
    AND input_object.object_purpose = 'input-payload'
    AND input_object.content_sha256 = NEW.input_sha256
    AND input_object.size_bytes = NEW.inline_input_size_bytes
    AND input_object.lifecycle_state = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'async job input object metadata does not match'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.output_object_id IS NOT NULL THEN
    PERFORM 1
    FROM stored_objects AS output_object
    WHERE output_object.organization_id = NEW.organization_id
      AND output_object.project_id IS NOT DISTINCT FROM NEW.project_id
      AND output_object.object_id = NEW.output_object_id
      AND output_object.content_sha256 = NEW.output_sha256
      AND output_object.size_bytes = NEW.output_size_bytes
      AND output_object.lifecycle_state = 'published';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'async job output object metadata does not match'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_jobs_validate_record
BEFORE INSERT OR UPDATE ON async_jobs
FOR EACH ROW EXECUTE FUNCTION validate_async_job_record();

CREATE TABLE async_job_creation_claims (
  organization_id VARCHAR(128) NOT NULL
    REFERENCES organizations(organization_id),
  project_id VARCHAR(128),
  operation_id VARCHAR(128) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  request_sha256 CHAR(64) NOT NULL,
  actor_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  correlation_id VARCHAR(128) NOT NULL,
  job_id VARCHAR(128) NOT NULL,
  creation_plan_contract_version SMALLINT NOT NULL DEFAULT 1,
  creation_plan_sha256 CHAR(64) NOT NULL,
  family VARCHAR(64) NOT NULL,
  subject_kind VARCHAR(32) NOT NULL,
  draft_id VARCHAR(128),
  draft_version BIGINT,
  draft_strong_etag VARCHAR(122),
  draft_content_sha256 CHAR(64),
  solution_revision_id VARCHAR(128),
  solution_manifest_record_id VARCHAR(128),
  solution_manifest_sha256 CHAR(64),
  environment_id VARCHAR(128),
  environment_type VARCHAR(32),
  input_object_id VARCHAR(128) NOT NULL,
  input_sha256 CHAR(64) NOT NULL,
  referenced_input_size_bytes BIGINT NOT NULL,
  inline_input_size_bytes INTEGER NOT NULL,
  root_job_id VARCHAR(128) NOT NULL,
  parent_job_id VARCHAR(128),
  parent_failure_policy VARCHAR(32) NOT NULL,
  max_attempts INTEGER NOT NULL,
  max_runtime_seconds INTEGER NOT NULL,
  max_referenced_input_bytes BIGINT NOT NULL,
  max_inline_input_bytes INTEGER NOT NULL,
  max_output_bytes BIGINT NOT NULL,
  max_checkpoint_bytes BIGINT NOT NULL,
  max_checkpoints INTEGER NOT NULL,
  max_artifacts INTEGER NOT NULL,
  expires_at TIMESTAMPTZ,
  reservation_requested BOOLEAN NOT NULL,
  claim_status VARCHAR(32) NOT NULL DEFAULT 'claimed',
  entitlement_outcome VARCHAR(16),
  entitlement_decision_reference VARCHAR(128),
  entitlement_denial_code VARCHAR(128),
  entitlement_public_message VARCHAR(64),
  reservation_outcome VARCHAR(16),
  reservation_reference VARCHAR(128),
  reservation_denial_code VARCHAR(128),
  reservation_public_message VARCHAR(64),
  denial_code VARCHAR(128),
  denial_public_message VARCHAR(64),
  claimed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  record_version BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, operation_id, idempotency_key_sha256),
  UNIQUE (job_id),
  CHECK (
    operation_id ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  ),
  CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (
    correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (creation_plan_contract_version = 1),
  CHECK (creation_plan_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (family IN (
    'intent-extraction',
    'architecture-proposal',
    'workload-contract-proposal',
    'graph-workload-operation-proposal',
    'iac-compilation',
    'application-source-generation',
    'application-build-test-package',
    'static-validation',
    'diagram-rendering',
    'combined-export-packaging',
    'github-repository-export',
    'customer-owned-plan-evidence',
    'deployment-evidence',
    'smoke-integration-evidence',
    'drift-evidence',
    'billing-usage-reconciliation'
  )),
  CHECK (subject_kind IN ('draft', 'solution-revision', 'organization')),
  CHECK (
    environment_type IS NULL
    OR environment_type IN (
      'development', 'test', 'staging', 'production',
      'disaster-recovery', 'multi-environment', 'unknown'
    )
  ),
  CHECK (environment_id IS NULL OR environment_type IS NOT NULL),
  CHECK (
    (family IN (
      'iac-compilation', 'application-source-generation',
      'application-build-test-package', 'github-repository-export',
      'static-validation', 'customer-owned-plan-evidence',
      'deployment-evidence', 'smoke-integration-evidence',
      'drift-evidence'
    ) AND environment_type IS NOT NULL)
    OR (family NOT IN (
      'iac-compilation', 'application-source-generation',
      'application-build-test-package', 'github-repository-export',
      'static-validation', 'customer-owned-plan-evidence',
      'deployment-evidence', 'smoke-integration-evidence',
      'drift-evidence'
    ) AND environment_type IS NULL AND environment_id IS NULL)
  ),
  CHECK (
    (subject_kind = 'draft'
      AND project_id IS NOT NULL
      AND draft_id IS NOT NULL
      AND draft_version IS NOT NULL
      AND draft_strong_etag IS NOT NULL
      AND draft_content_sha256 IS NOT NULL
      AND solution_revision_id IS NULL
      AND solution_manifest_record_id IS NULL
      AND solution_manifest_sha256 IS NULL)
    OR (subject_kind = 'solution-revision'
      AND project_id IS NOT NULL
      AND draft_id IS NULL
      AND draft_version IS NULL
      AND draft_strong_etag IS NULL
      AND draft_content_sha256 IS NULL
      AND solution_revision_id IS NOT NULL
      AND solution_manifest_record_id IS NOT NULL
      AND solution_manifest_sha256 IS NOT NULL)
    OR (subject_kind = 'organization'
      AND project_id IS NULL
      AND draft_id IS NULL
      AND draft_version IS NULL
      AND draft_strong_etag IS NULL
      AND draft_content_sha256 IS NULL
      AND solution_revision_id IS NULL
      AND solution_manifest_record_id IS NULL
      AND solution_manifest_sha256 IS NULL)
  ),
  CHECK (
    (family IN (
      'intent-extraction', 'architecture-proposal',
      'workload-contract-proposal', 'graph-workload-operation-proposal'
    ) AND subject_kind = 'draft')
    OR (family = 'static-validation'
      AND subject_kind IN ('draft', 'solution-revision'))
    OR (family IN (
      'iac-compilation', 'application-source-generation',
      'application-build-test-package', 'diagram-rendering',
      'combined-export-packaging', 'github-repository-export',
      'customer-owned-plan-evidence', 'deployment-evidence',
      'smoke-integration-evidence', 'drift-evidence'
    ) AND subject_kind = 'solution-revision')
    OR (family = 'billing-usage-reconciliation'
      AND subject_kind = 'organization')
  ),
  CHECK (draft_version IS NULL OR draft_version > 0),
  CHECK (
    draft_strong_etag IS NULL
    OR draft_strong_etag ~ '^"[A-Za-z0-9._:-]{1,120}"$'
  ),
  CHECK (
    draft_content_sha256 IS NULL
    OR draft_content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CHECK (
    solution_manifest_sha256 IS NULL
    OR solution_manifest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (referenced_input_size_bytes BETWEEN 0 AND max_referenced_input_bytes),
  CHECK (inline_input_size_bytes BETWEEN 0 AND max_inline_input_bytes),
  CHECK (root_job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (
    parent_job_id IS NULL
    OR parent_job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (
    (parent_job_id IS NULL AND root_job_id = job_id)
    OR (parent_job_id IS NOT NULL
      AND parent_job_id <> job_id
      AND root_job_id <> job_id)
  ),
  CHECK (parent_failure_policy IN (
    'fail-parent', 'cancel-remaining', 'continue-and-report'
  )),
  CHECK (max_attempts BETWEEN 1 AND 10),
  CHECK (max_runtime_seconds BETWEEN 1 AND 86400),
  CHECK (max_inline_input_bytes BETWEEN 1 AND 65536),
  CHECK (max_referenced_input_bytes BETWEEN 1 AND 2147483648),
  CHECK (max_checkpoint_bytes BETWEEN 1 AND 268435456),
  CHECK (max_output_bytes BETWEEN 1 AND 2147483648),
  CHECK (max_checkpoints BETWEEN 1 AND 1024),
  CHECK (max_artifacts BETWEEN 1 AND 256),
  CHECK (expires_at IS NULL OR expires_at > claimed_at),
  CHECK (claim_status IN ('claimed', 'completed', 'denied')),
  CHECK (
    (entitlement_outcome IS NULL
      AND entitlement_decision_reference IS NULL
      AND entitlement_denial_code IS NULL
      AND entitlement_public_message IS NULL)
    OR (entitlement_outcome = 'allowed'
      AND entitlement_decision_reference IS NOT NULL
      AND entitlement_denial_code IS NULL
      AND entitlement_public_message IS NULL)
    OR (entitlement_outcome = 'denied'
      AND entitlement_decision_reference IS NOT NULL
      AND entitlement_denial_code IS NOT NULL
      AND entitlement_public_message IS NOT NULL)
  ),
  CHECK (
    entitlement_decision_reference IS NULL
    OR length(entitlement_decision_reference) BETWEEN 1 AND 128
  ),
  CHECK (
    entitlement_denial_code IS NULL
    OR entitlement_denial_code ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  ),
  CHECK (
    entitlement_public_message IS NULL OR entitlement_public_message IN (
      'job-temporarily-unavailable', 'job-input-invalid',
      'job-not-supported', 'job-canceled', 'job-limit-exceeded',
      'job-expired', 'job-internal-error'
    )
  ),
  CHECK (
    (reservation_outcome IS NULL
      AND reservation_reference IS NULL
      AND reservation_denial_code IS NULL
      AND reservation_public_message IS NULL)
    OR (reservation_outcome = 'allowed'
      AND reservation_requested
      AND entitlement_outcome = 'allowed'
      AND reservation_reference IS NOT NULL
      AND reservation_denial_code IS NULL
      AND reservation_public_message IS NULL)
    OR (reservation_outcome = 'denied'
      AND reservation_requested
      AND entitlement_outcome = 'allowed'
      AND reservation_reference IS NULL
      AND reservation_denial_code IS NOT NULL
      AND reservation_public_message IS NOT NULL)
  ),
  CHECK (
    reservation_reference IS NULL
    OR length(reservation_reference) BETWEEN 1 AND 128
  ),
  CHECK (
    reservation_denial_code IS NULL
    OR reservation_denial_code ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  ),
  CHECK (
    reservation_public_message IS NULL OR reservation_public_message IN (
      'job-temporarily-unavailable', 'job-input-invalid',
      'job-not-supported', 'job-canceled', 'job-limit-exceeded',
      'job-expired', 'job-internal-error'
    )
  ),
  CHECK (
    (claim_status = 'denied'
      AND denial_code IS NOT NULL
      AND denial_public_message IS NOT NULL)
    OR (claim_status <> 'denied'
      AND denial_code IS NULL
      AND denial_public_message IS NULL)
  ),
  CHECK (
    denial_code IS NULL
    OR denial_code ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  ),
  CHECK (
    denial_public_message IS NULL OR denial_public_message IN (
      'job-temporarily-unavailable', 'job-input-invalid',
      'job-not-supported', 'job-canceled', 'job-limit-exceeded',
      'job-expired', 'job-internal-error'
    )
  ),
  CHECK (
    claim_status <> 'completed'
    OR (
      entitlement_outcome = 'allowed'
      AND (
        (reservation_requested
          AND reservation_outcome = 'allowed'
          AND reservation_reference IS NOT NULL)
        OR (NOT reservation_requested
          AND reservation_outcome IS NULL
          AND reservation_reference IS NULL)
      )
    )
  ),
  CHECK (updated_at >= claimed_at),
  CHECK (record_version > 0),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, project_id, draft_id)
    REFERENCES architecture_drafts(organization_id, project_id, draft_id),
  FOREIGN KEY (organization_id, project_id, solution_manifest_record_id)
    REFERENCES solution_records(organization_id, project_id, solution_record_id),
  FOREIGN KEY (organization_id, input_object_id)
    REFERENCES stored_objects(organization_id, object_id)
);
CREATE FUNCTION validate_async_job_creation_claim()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(
      OLD.organization_id, OLD.project_id, OLD.operation_id,
      OLD.idempotency_key_sha256, OLD.request_sha256, OLD.actor_id,
      OLD.correlation_id, OLD.job_id, OLD.creation_plan_contract_version,
      OLD.creation_plan_sha256, OLD.family, OLD.subject_kind, OLD.draft_id,
      OLD.draft_version, OLD.draft_strong_etag, OLD.draft_content_sha256,
      OLD.solution_revision_id, OLD.solution_manifest_record_id,
      OLD.solution_manifest_sha256, OLD.environment_id, OLD.environment_type,
      OLD.input_object_id, OLD.input_sha256, OLD.referenced_input_size_bytes,
      OLD.inline_input_size_bytes, OLD.root_job_id, OLD.parent_job_id,
      OLD.parent_failure_policy, OLD.max_attempts, OLD.max_runtime_seconds,
      OLD.max_referenced_input_bytes, OLD.max_inline_input_bytes,
      OLD.max_output_bytes, OLD.max_checkpoint_bytes, OLD.max_checkpoints,
      OLD.max_artifacts, OLD.expires_at, OLD.reservation_requested,
      OLD.claimed_at
    ) IS DISTINCT FROM ROW(
      NEW.organization_id, NEW.project_id, NEW.operation_id,
      NEW.idempotency_key_sha256, NEW.request_sha256, NEW.actor_id,
      NEW.correlation_id, NEW.job_id, NEW.creation_plan_contract_version,
      NEW.creation_plan_sha256, NEW.family, NEW.subject_kind, NEW.draft_id,
      NEW.draft_version, NEW.draft_strong_etag, NEW.draft_content_sha256,
      NEW.solution_revision_id, NEW.solution_manifest_record_id,
      NEW.solution_manifest_sha256, NEW.environment_id, NEW.environment_type,
      NEW.input_object_id, NEW.input_sha256, NEW.referenced_input_size_bytes,
      NEW.inline_input_size_bytes, NEW.root_job_id, NEW.parent_job_id,
      NEW.parent_failure_policy, NEW.max_attempts, NEW.max_runtime_seconds,
      NEW.max_referenced_input_bytes, NEW.max_inline_input_bytes,
      NEW.max_output_bytes, NEW.max_checkpoint_bytes, NEW.max_checkpoints,
      NEW.max_artifacts, NEW.expires_at, NEW.reservation_requested,
      NEW.claimed_at
    ) THEN
      RAISE EXCEPTION 'async job creation plan identity cannot change'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.entitlement_outcome IS NOT NULL
      AND ROW(
        OLD.entitlement_outcome, OLD.entitlement_decision_reference,
        OLD.entitlement_denial_code, OLD.entitlement_public_message
      ) IS DISTINCT FROM ROW(
        NEW.entitlement_outcome, NEW.entitlement_decision_reference,
        NEW.entitlement_denial_code, NEW.entitlement_public_message
      ) THEN
      RAISE EXCEPTION 'async job creation entitlement decision cannot change'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.reservation_outcome IS NOT NULL
      AND ROW(
        OLD.reservation_outcome, OLD.reservation_reference,
        OLD.reservation_denial_code, OLD.reservation_public_message
      ) IS DISTINCT FROM ROW(
        NEW.reservation_outcome, NEW.reservation_reference,
        NEW.reservation_denial_code, NEW.reservation_public_message
      ) THEN
      RAISE EXCEPTION 'async job creation reservation decision cannot change'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.claim_status <> 'claimed'
      OR NEW.claim_status NOT IN ('claimed', 'completed', 'denied')
      OR NEW.record_version <> OLD.record_version + 1
      OR NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION 'invalid async job creation claim transition'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.subject_kind = 'solution-revision' THEN
    PERFORM 1
    FROM solution_records AS manifest
    WHERE manifest.organization_id = NEW.organization_id
      AND manifest.project_id = NEW.project_id
      AND manifest.solution_record_id = NEW.solution_manifest_record_id
      AND manifest.record_kind = 'solution-revision-manifest'
      AND manifest.subject_id = NEW.solution_revision_id
      AND manifest.content_sha256 = NEW.solution_manifest_sha256;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'creation claim Solution Revision manifest does not match'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM 1
  FROM stored_objects AS input_object
  WHERE input_object.organization_id = NEW.organization_id
    AND input_object.project_id IS NOT DISTINCT FROM NEW.project_id
    AND input_object.object_id = NEW.input_object_id
    AND input_object.object_purpose = 'input-payload'
    AND input_object.content_sha256 = NEW.input_sha256
    AND input_object.size_bytes = NEW.inline_input_size_bytes
    AND input_object.lifecycle_state = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'creation claim input object metadata does not match'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM async_job_identity_reservations AS identity_reservation
  WHERE identity_reservation.organization_id = NEW.organization_id
    AND identity_reservation.project_id IS NOT DISTINCT FROM NEW.project_id
    AND identity_reservation.job_id = NEW.job_id
    AND identity_reservation.root_job_id = NEW.root_job_id
    AND identity_reservation.parent_job_id IS NOT DISTINCT FROM NEW.parent_job_id
    AND identity_reservation.correlation_id = NEW.correlation_id
    AND (
      (NEW.parent_job_id IS NULL
        AND identity_reservation.reservation_kind = 'root'
        AND identity_reservation.reserving_operation_id = NEW.operation_id
        AND identity_reservation.reserving_idempotency_key_sha256
          = NEW.idempotency_key_sha256)
      OR (NEW.parent_job_id IS NOT NULL
        AND identity_reservation.reservation_kind = 'expected-child')
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'creation claim job identity was not reserved in exact scope'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_job_id IS NOT NULL THEN
    PERFORM 1
    FROM async_jobs AS parent
    JOIN async_job_expected_children AS expected_child
      ON expected_child.organization_id = parent.organization_id
     AND expected_child.project_id IS NOT DISTINCT FROM parent.project_id
     AND expected_child.parent_job_id = parent.job_id
     AND expected_child.child_job_id = NEW.job_id
    WHERE parent.organization_id = NEW.organization_id
      AND parent.project_id IS NOT DISTINCT FROM NEW.project_id
      AND parent.job_id = NEW.parent_job_id
      AND parent.root_job_id = NEW.root_job_id
      AND parent.correlation_id = NEW.correlation_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'creation claim parent was not predeclared in exact scope'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.claim_status = 'completed' THEN
    PERFORM 1
    FROM async_jobs AS job
    WHERE job.organization_id = NEW.organization_id
      AND job.project_id IS NOT DISTINCT FROM NEW.project_id
      AND job.job_id = NEW.job_id
      AND job.family = NEW.family
      AND job.subject_kind = NEW.subject_kind
      AND job.draft_id IS NOT DISTINCT FROM NEW.draft_id
      AND job.draft_version IS NOT DISTINCT FROM NEW.draft_version
      AND job.draft_strong_etag IS NOT DISTINCT FROM NEW.draft_strong_etag
      AND job.draft_content_sha256 IS NOT DISTINCT FROM NEW.draft_content_sha256
      AND job.solution_revision_id IS NOT DISTINCT FROM NEW.solution_revision_id
      AND job.solution_manifest_record_id IS NOT DISTINCT FROM NEW.solution_manifest_record_id
      AND job.solution_manifest_sha256 IS NOT DISTINCT FROM NEW.solution_manifest_sha256
      AND job.environment_id IS NOT DISTINCT FROM NEW.environment_id
      AND job.environment_type IS NOT DISTINCT FROM NEW.environment_type
      AND job.input_object_id = NEW.input_object_id
      AND job.input_sha256 = NEW.input_sha256
      AND job.referenced_input_size_bytes = NEW.referenced_input_size_bytes
      AND job.inline_input_size_bytes = NEW.inline_input_size_bytes
      AND job.idempotency_scope = NEW.operation_id
      AND job.idempotency_key_sha256 = NEW.idempotency_key_sha256
      AND job.idempotency_request_sha256 = NEW.request_sha256
      AND job.idempotency_actor_id = NEW.actor_id
      AND job.correlation_id = NEW.correlation_id
      AND job.entitlement_decision_reference = NEW.entitlement_decision_reference
      AND job.reservation_reference IS NOT DISTINCT FROM NEW.reservation_reference
      AND job.root_job_id = NEW.root_job_id
      AND job.parent_job_id IS NOT DISTINCT FROM NEW.parent_job_id
      AND job.parent_failure_policy = NEW.parent_failure_policy
      AND job.max_attempts = NEW.max_attempts
      AND job.max_runtime_seconds = NEW.max_runtime_seconds
      AND job.max_referenced_input_bytes = NEW.max_referenced_input_bytes
      AND job.max_inline_input_bytes = NEW.max_inline_input_bytes
      AND job.max_output_bytes = NEW.max_output_bytes
      AND job.max_checkpoint_bytes = NEW.max_checkpoint_bytes
      AND job.max_checkpoints = NEW.max_checkpoints
      AND job.max_artifacts = NEW.max_artifacts
      AND job.expires_at IS NOT DISTINCT FROM NEW.expires_at
      AND job.created_by_actor_kind = 'principal'
      AND job.created_by_actor_reference = NEW.actor_id
      AND job.created_by_principal_id = NEW.actor_id
      AND job.created_at = NEW.claimed_at
      AND job.queued_at = NEW.claimed_at
      AND job.lifecycle_status = 'queued'
      AND job.record_version = 1
      AND NOT EXISTS (
        SELECT claim_member.member_job_id
        FROM async_job_creation_claim_orchestration_members AS claim_member
        WHERE claim_member.organization_id = NEW.organization_id
          AND claim_member.operation_id = NEW.operation_id
          AND claim_member.idempotency_key_sha256 = NEW.idempotency_key_sha256
          AND claim_member.relationship_kind = 'dependency'
        EXCEPT
        SELECT dependency.dependency_job_id
        FROM async_job_dependencies AS dependency
        WHERE dependency.organization_id = NEW.organization_id
          AND dependency.job_id = NEW.job_id
      )
      AND NOT EXISTS (
        SELECT dependency.dependency_job_id
        FROM async_job_dependencies AS dependency
        WHERE dependency.organization_id = NEW.organization_id
          AND dependency.job_id = NEW.job_id
        EXCEPT
        SELECT claim_member.member_job_id
        FROM async_job_creation_claim_orchestration_members AS claim_member
        WHERE claim_member.organization_id = NEW.organization_id
          AND claim_member.operation_id = NEW.operation_id
          AND claim_member.idempotency_key_sha256 = NEW.idempotency_key_sha256
          AND claim_member.relationship_kind = 'dependency'
      )
      AND NOT EXISTS (
        SELECT claim_member.member_job_id
        FROM async_job_creation_claim_orchestration_members AS claim_member
        WHERE claim_member.organization_id = NEW.organization_id
          AND claim_member.operation_id = NEW.operation_id
          AND claim_member.idempotency_key_sha256 = NEW.idempotency_key_sha256
          AND claim_member.relationship_kind = 'expected-child'
        EXCEPT
        SELECT expected_child.child_job_id
        FROM async_job_expected_children AS expected_child
        WHERE expected_child.organization_id = NEW.organization_id
          AND expected_child.parent_job_id = NEW.job_id
      )
      AND NOT EXISTS (
        SELECT expected_child.child_job_id
        FROM async_job_expected_children AS expected_child
        WHERE expected_child.organization_id = NEW.organization_id
          AND expected_child.parent_job_id = NEW.job_id
        EXCEPT
        SELECT claim_member.member_job_id
        FROM async_job_creation_claim_orchestration_members AS claim_member
        WHERE claim_member.organization_id = NEW.organization_id
          AND claim_member.operation_id = NEW.operation_id
          AND claim_member.idempotency_key_sha256 = NEW.idempotency_key_sha256
          AND claim_member.relationship_kind = 'expected-child'
      );

    IF NOT FOUND THEN
      RAISE EXCEPTION 'completed creation claim does not match its exact job plan'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER async_job_creation_claims_validate_record
BEFORE INSERT OR UPDATE ON async_job_creation_claims
FOR EACH ROW EXECUTE FUNCTION validate_async_job_creation_claim();

ALTER TABLE async_job_identity_reservations
  ADD CONSTRAINT async_job_identity_reservations_claim_fk
  FOREIGN KEY (
    organization_id, reserving_operation_id,
    reserving_idempotency_key_sha256
  ) REFERENCES async_job_creation_claims(
    organization_id, operation_id, idempotency_key_sha256
  ) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE async_job_creation_claim_orchestration_members (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128),
  operation_id VARCHAR(128) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  relationship_kind VARCHAR(32) NOT NULL,
  member_ordinal SMALLINT NOT NULL,
  member_job_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (
    organization_id, operation_id, idempotency_key_sha256,
    relationship_kind, member_job_id
  ),
  UNIQUE (
    organization_id, operation_id, idempotency_key_sha256,
    relationship_kind, member_ordinal
  ),
  UNIQUE (
    organization_id, operation_id, idempotency_key_sha256, member_job_id
  ),
  CHECK (relationship_kind IN ('dependency', 'expected-child')),
  CHECK (member_ordinal BETWEEN 0 AND 127),
  CHECK (member_job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  FOREIGN KEY (organization_id, operation_id, idempotency_key_sha256)
    REFERENCES async_job_creation_claims(
      organization_id, operation_id, idempotency_key_sha256
    ),
  FOREIGN KEY (organization_id, member_job_id)
    REFERENCES async_job_identity_reservations(organization_id, job_id),
  FOREIGN KEY (organization_id, project_id, member_job_id)
    REFERENCES async_job_identity_reservations(
      organization_id, project_id, job_id
    )
);

CREATE FUNCTION validate_async_job_creation_claim_orchestration_member()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  claim_record async_job_creation_claims%ROWTYPE;
BEGIN
  SELECT claim.* INTO claim_record
  FROM async_job_creation_claims AS claim
  WHERE claim.organization_id = NEW.organization_id
    AND claim.project_id IS NOT DISTINCT FROM NEW.project_id
    AND claim.operation_id = NEW.operation_id
    AND claim.idempotency_key_sha256 = NEW.idempotency_key_sha256
    AND claim.claim_status = 'claimed'
  FOR UPDATE;

  IF claim_record.job_id IS NULL OR claim_record.job_id = NEW.member_job_id THEN
    RAISE EXCEPTION 'creation claim orchestration member has invalid authority'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.relationship_kind = 'dependency' THEN
    PERFORM 1
    FROM async_jobs AS dependency
    WHERE dependency.organization_id = NEW.organization_id
      AND dependency.project_id IS NOT DISTINCT FROM NEW.project_id
      AND dependency.job_id = NEW.member_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'creation claim dependency must exist in exact scope'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    PERFORM 1
    FROM async_job_identity_reservations AS child_identity
    WHERE child_identity.organization_id = NEW.organization_id
      AND child_identity.project_id IS NOT DISTINCT FROM NEW.project_id
      AND child_identity.job_id = NEW.member_job_id
      AND child_identity.reservation_kind = 'expected-child'
      AND child_identity.parent_job_id = claim_record.job_id
      AND child_identity.root_job_id = claim_record.root_job_id
      AND child_identity.correlation_id = claim_record.correlation_id
      AND child_identity.reserving_operation_id = NEW.operation_id
      AND child_identity.reserving_idempotency_key_sha256
        = NEW.idempotency_key_sha256;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'expected child member must match its parent reservation'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER async_job_creation_claim_orchestration_validate_record
BEFORE INSERT ON async_job_creation_claim_orchestration_members
FOR EACH ROW EXECUTE FUNCTION validate_async_job_creation_claim_orchestration_member();

CREATE TRIGGER async_job_creation_claim_orchestration_are_immutable
BEFORE UPDATE OR DELETE ON async_job_creation_claim_orchestration_members
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE async_job_creation_claim_events (
  creation_event_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128),
  operation_id VARCHAR(128) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  sequence_number BIGINT NOT NULL,
  claim_record_version BIGINT NOT NULL,
  event_kind VARCHAR(64) NOT NULL,
  safe_event_code VARCHAR(128),
  public_message VARCHAR(64),
  request_sha256 CHAR(64) NOT NULL,
  creation_plan_sha256 CHAR(64) NOT NULL,
  summary_sha256 CHAR(64) NOT NULL,
  decision_reference_sha256 CHAR(64),
  correlation_id VARCHAR(128) NOT NULL,
  actor_principal_id VARCHAR(128) REFERENCES principals(principal_id),
  actor_kind VARCHAR(32) NOT NULL,
  actor_reference VARCHAR(128) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    creation_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (sequence_number > 0),
  CHECK (claim_record_version > 0),
  CHECK (event_kind IN (
    'claim-created', 'entitlement-allowed', 'entitlement-denied',
    'reservation-allowed', 'reservation-denied', 'recovery-started',
    'recovery-denied', 'creation-completed', 'creation-denied'
  )),
  CHECK (
    safe_event_code IS NULL
    OR safe_event_code ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  ),
  CHECK (
    public_message IS NULL OR public_message IN (
      'job-temporarily-unavailable', 'job-input-invalid',
      'job-not-supported', 'job-canceled', 'job-limit-exceeded',
      'job-expired', 'job-internal-error'
    )
  ),
  CHECK (
    (event_kind IN (
      'entitlement-denied', 'reservation-denied',
      'recovery-denied', 'creation-denied'
    ) AND safe_event_code IS NOT NULL AND public_message IS NOT NULL)
    OR (event_kind NOT IN (
      'entitlement-denied', 'reservation-denied',
      'recovery-denied', 'creation-denied'
    ) AND safe_event_code IS NULL AND public_message IS NULL)
  ),
  CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (creation_plan_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (summary_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (
    decision_reference_sha256 IS NULL
    OR decision_reference_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CHECK (
    event_kind NOT IN (
      'entitlement-allowed', 'entitlement-denied', 'reservation-allowed'
    ) OR decision_reference_sha256 IS NOT NULL
  ),
  CHECK (
    correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (actor_kind IN ('principal', 'worker', 'system')),
  CHECK (length(actor_reference) BETWEEN 1 AND 128),
  CHECK (
    (actor_kind = 'principal'
      AND actor_principal_id IS NOT NULL
      AND actor_reference = actor_principal_id)
    OR (actor_kind IN ('worker', 'system')
      AND actor_principal_id IS NULL)
  ),
  CHECK (
    event_kind NOT IN ('recovery-started', 'recovery-denied')
    OR actor_kind = 'system'
  ),
  UNIQUE (
    organization_id, operation_id, idempotency_key_sha256, sequence_number
  ),
  UNIQUE (organization_id, creation_event_id),
  FOREIGN KEY (organization_id, operation_id, idempotency_key_sha256)
    REFERENCES async_job_creation_claims(
      organization_id, operation_id, idempotency_key_sha256
    )
);

CREATE FUNCTION validate_async_job_creation_claim_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM async_job_creation_claims AS claim
  WHERE claim.organization_id = NEW.organization_id
    AND claim.project_id IS NOT DISTINCT FROM NEW.project_id
    AND claim.operation_id = NEW.operation_id
    AND claim.idempotency_key_sha256 = NEW.idempotency_key_sha256
    AND claim.request_sha256 = NEW.request_sha256
    AND claim.creation_plan_sha256 = NEW.creation_plan_sha256
    AND claim.correlation_id = NEW.correlation_id
    AND NEW.claim_record_version <= claim.record_version
    AND (
      NEW.event_kind <> 'claim-created'
      OR (NEW.actor_kind = 'principal' AND NEW.actor_reference = claim.actor_id)
    )
    AND (
      NEW.event_kind <> 'creation-completed'
      OR claim.claim_status = 'completed'
    )
    AND (
      NEW.event_kind NOT IN ('recovery-denied', 'creation-denied')
      OR claim.claim_status = 'denied'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'creation claim event does not match exact claim authority'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_creation_claim_events_validate_record
BEFORE INSERT ON async_job_creation_claim_events
FOR EACH ROW EXECUTE FUNCTION validate_async_job_creation_claim_event();

CREATE TRIGGER async_job_creation_claim_events_are_immutable
BEFORE UPDATE OR DELETE ON async_job_creation_claim_events
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE async_job_creation_claim_event_delivery_receipts (
  creation_event_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128),
  published_at TIMESTAMPTZ NOT NULL,
  CHECK (
    creation_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  UNIQUE (organization_id, creation_event_id),
  FOREIGN KEY (organization_id, creation_event_id)
    REFERENCES async_job_creation_claim_events(
      organization_id, creation_event_id
    )
);

CREATE FUNCTION validate_async_job_creation_claim_event_delivery_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM async_job_creation_claim_events AS creation_event
  WHERE creation_event.organization_id = NEW.organization_id
    AND creation_event.project_id IS NOT DISTINCT FROM NEW.project_id
    AND creation_event.creation_event_id = NEW.creation_event_id
    AND NEW.published_at >= creation_event.occurred_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'creation claim audit delivery receipt does not match exact event ownership and time'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_creation_claim_event_delivery_receipts_validate
BEFORE INSERT ON async_job_creation_claim_event_delivery_receipts
FOR EACH ROW EXECUTE FUNCTION validate_async_job_creation_claim_event_delivery_receipt();

CREATE TRIGGER async_job_creation_claim_event_delivery_receipts_are_immutable
BEFORE UPDATE OR DELETE ON async_job_creation_claim_event_delivery_receipts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE async_job_dependencies (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128),
  job_id VARCHAR(128) NOT NULL,
  dependency_job_id VARCHAR(128) NOT NULL,
  required_outcome VARCHAR(32) NOT NULL DEFAULT 'succeeded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, job_id, dependency_job_id),
  CHECK (job_id <> dependency_job_id),
  CHECK (required_outcome = 'succeeded'),
  FOREIGN KEY (organization_id, job_id)
    REFERENCES async_jobs(organization_id, job_id),
  FOREIGN KEY (organization_id, dependency_job_id)
    REFERENCES async_jobs(organization_id, job_id),
  FOREIGN KEY (organization_id, project_id, job_id)
    REFERENCES async_jobs(organization_id, project_id, job_id),
  FOREIGN KEY (organization_id, project_id, dependency_job_id)
    REFERENCES async_jobs(organization_id, project_id, job_id)
);

CREATE TRIGGER async_job_dependencies_are_immutable
BEFORE UPDATE OR DELETE ON async_job_dependencies
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
CREATE TABLE async_job_expected_children (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128),
  parent_job_id VARCHAR(128) NOT NULL,
  child_job_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, parent_job_id, child_job_id),
  CHECK (parent_job_id <> child_job_id),
  CHECK (child_job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  FOREIGN KEY (organization_id, parent_job_id)
    REFERENCES async_jobs(organization_id, job_id),
  FOREIGN KEY (organization_id, project_id, parent_job_id)
    REFERENCES async_jobs(organization_id, project_id, job_id),
  FOREIGN KEY (organization_id, child_job_id)
    REFERENCES async_job_identity_reservations(organization_id, job_id),
  FOREIGN KEY (organization_id, project_id, child_job_id)
    REFERENCES async_job_identity_reservations(
      organization_id, project_id, job_id
    )
);

CREATE FUNCTION validate_async_job_expected_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM async_jobs AS parent
  JOIN async_job_identity_reservations AS child_identity
    ON child_identity.organization_id = parent.organization_id
   AND child_identity.project_id IS NOT DISTINCT FROM parent.project_id
   AND child_identity.job_id = NEW.child_job_id
   AND child_identity.reservation_kind = 'expected-child'
   AND child_identity.parent_job_id = parent.job_id
   AND child_identity.root_job_id = parent.root_job_id
   AND child_identity.correlation_id = parent.correlation_id
  WHERE parent.organization_id = NEW.organization_id
    AND parent.project_id IS NOT DISTINCT FROM NEW.project_id
    AND parent.job_id = NEW.parent_job_id
    AND parent.lifecycle_status = 'queued'
    AND (
      SELECT count(*)
      FROM async_job_expected_children AS existing_child
      WHERE existing_child.organization_id = NEW.organization_id
        AND existing_child.parent_job_id = NEW.parent_job_id
    ) < 128
  FOR UPDATE OF parent;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expected child must match a reserved queued parent lineage'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_expected_children_validate_record
BEFORE INSERT ON async_job_expected_children
FOR EACH ROW EXECUTE FUNCTION validate_async_job_expected_child();

CREATE TRIGGER async_job_expected_children_are_immutable
BEFORE UPDATE OR DELETE ON async_job_expected_children
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE async_job_attempts (
  attempt_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  job_id VARCHAR(128) NOT NULL,
  attempt_number INTEGER NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL,
  worker_reference VARCHAR(128),
  lease_expires_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  failure_classification VARCHAR(32),
  retry_disposition VARCHAR(32),
  safe_failure_code VARCHAR(128),
  internal_error_id VARCHAR(128),
  public_failure_message VARCHAR(64),
  checkpoint_id VARCHAR(128),
  started_at TIMESTAMPTZ NOT NULL,
  resumed_from_checkpoint_id VARCHAR(128),
  retry_not_before TIMESTAMPTZ,
  runtime_seconds INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  CHECK (attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (attempt_number > 0),
  CHECK (lifecycle_status IN (
    'running', 'succeeded', 'failed', 'canceled', 'orphaned'
  )),
  CHECK (
    failure_classification IS NULL
    OR failure_classification IN ('transient', 'permanent')
  ),
  CHECK (
    public_failure_message IS NULL OR public_failure_message IN (
      'job-temporarily-unavailable', 'job-input-invalid',
      'job-not-supported', 'job-canceled', 'job-limit-exceeded',
      'job-expired', 'job-internal-error'
    )
  ),
  CHECK (
    safe_failure_code IS NULL
    OR safe_failure_code ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
  ),
  CHECK (
    internal_error_id IS NULL
    OR internal_error_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (heartbeat_at IS NULL OR heartbeat_at >= started_at),
  CHECK (lease_expires_at IS NULL OR lease_expires_at > started_at),
  CHECK (completed_at IS NULL OR completed_at >= started_at),
  CHECK ((lifecycle_status = 'running') = (completed_at IS NULL)),
  CHECK (
    lifecycle_status <> 'running'
    OR (worker_reference IS NOT NULL
      AND heartbeat_at IS NOT NULL
      AND lease_expires_at IS NOT NULL)
  ),
  CHECK (
    (lifecycle_status = 'failed') = (failure_classification IS NOT NULL)
  ),
  CHECK (
    (lifecycle_status = 'failed') = (safe_failure_code IS NOT NULL)
  ),
  CHECK (
    (lifecycle_status = 'failed') = (public_failure_message IS NOT NULL)
  ),
  CHECK (internal_error_id IS NULL OR lifecycle_status = 'failed'),
  CHECK (
    retry_disposition IS NULL
    OR retry_disposition IN ('retry', 'do-not-retry')
  ),
  CHECK (
    (lifecycle_status IN ('failed', 'orphaned'))
      = (retry_disposition IS NOT NULL)
  ),
  CHECK (
    (retry_disposition = 'retry' AND retry_not_before IS NOT NULL)
    OR (retry_disposition IS DISTINCT FROM 'retry'
      AND retry_not_before IS NULL)
  ),
  CHECK (
    retry_disposition <> 'retry'
    OR lifecycle_status = 'orphaned'
    OR failure_classification = 'transient'
  ),
  UNIQUE (organization_id, job_id, attempt_id),
  UNIQUE (organization_id, job_id, attempt_number),
  CHECK (retry_not_before IS NULL OR retry_not_before >= completed_at),
  CHECK (runtime_seconds >= 0),
  FOREIGN KEY (organization_id, job_id)
    REFERENCES async_jobs(organization_id, job_id)
);

CREATE FUNCTION validate_async_job_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempt_allowed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' AND (
    NEW.lifecycle_status <> 'running'
    OR NEW.runtime_seconds <> 0
    OR NEW.checkpoint_id IS NOT NULL
    OR NEW.retry_not_before IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'async job attempt must be created as a fresh running attempt'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ROW(
      OLD.organization_id, OLD.job_id, OLD.attempt_id, OLD.attempt_number,
      OLD.worker_reference, OLD.started_at, OLD.resumed_from_checkpoint_id
    ) IS DISTINCT FROM ROW(
      NEW.organization_id, NEW.job_id, NEW.attempt_id, NEW.attempt_number,
      NEW.worker_reference, NEW.started_at, NEW.resumed_from_checkpoint_id
    ) THEN
      RAISE EXCEPTION 'async job attempt identity cannot change'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.lifecycle_status <> 'running' THEN
      RAISE EXCEPTION 'terminal async job attempt cannot change'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.runtime_seconds < OLD.runtime_seconds
      OR NEW.heartbeat_at IS NULL
      OR NEW.heartbeat_at < OLD.heartbeat_at
      OR NEW.lease_expires_at IS NULL
      OR NEW.lease_expires_at < OLD.lease_expires_at THEN
      RAISE EXCEPTION 'running async job attempt timing must advance monotonically'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.checkpoint_id IS NOT NULL AND NEW.checkpoint_id IS NULL THEN
      RAISE EXCEPTION 'async job attempt checkpoint lineage cannot be removed'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT (
    NEW.attempt_number <= job.max_attempts
    AND (
      SELECT count(*)
      FROM async_job_attempts AS existing_attempt
      WHERE existing_attempt.organization_id = NEW.organization_id
        AND existing_attempt.job_id = NEW.job_id
        AND existing_attempt.attempt_id <> NEW.attempt_id
    ) < job.max_attempts
    AND (
      SELECT COALESCE(sum(existing_attempt.runtime_seconds), 0)
      FROM async_job_attempts AS existing_attempt
      WHERE existing_attempt.organization_id = NEW.organization_id
        AND existing_attempt.job_id = NEW.job_id
        AND existing_attempt.attempt_id <> NEW.attempt_id
    ) + NEW.runtime_seconds <= job.max_runtime_seconds
    AND (TG_OP = 'UPDATE' OR NEW.attempt_number = (
      SELECT count(*) + 1
      FROM async_job_attempts AS existing_attempt
      WHERE existing_attempt.organization_id = NEW.organization_id
        AND existing_attempt.job_id = NEW.job_id
    ))
    AND (NEW.lifecycle_status <> 'running'
      OR job.lifecycle_status = 'running')
    AND (job.expires_at IS NULL OR NEW.started_at < job.expires_at)
    AND (job.expires_at IS NULL
      OR NEW.lease_expires_at IS NULL
      OR NEW.lease_expires_at <= job.expires_at)
    AND (job.expires_at IS NULL
      OR NEW.retry_not_before IS NULL
      OR NEW.retry_not_before < job.expires_at)
  ) INTO attempt_allowed
  FROM async_jobs AS job
  WHERE job.organization_id = NEW.organization_id
    AND job.job_id = NEW.job_id
  FOR UPDATE;

  IF COALESCE(attempt_allowed, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'async job attempt exceeds job state or limits'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_attempts_validate_record
BEFORE INSERT OR UPDATE ON async_job_attempts
FOR EACH ROW EXECUTE FUNCTION validate_async_job_attempt();

CREATE TRIGGER async_job_attempts_reject_delete
BEFORE DELETE ON async_job_attempts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE UNIQUE INDEX async_job_attempts_one_running_idx
  ON async_job_attempts (organization_id, job_id)
  WHERE lifecycle_status = 'running';

CREATE TABLE async_job_checkpoints (
  checkpoint_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  job_id VARCHAR(128) NOT NULL,
  attempt_id VARCHAR(128) NOT NULL,
  attempt_number INTEGER NOT NULL,
  checkpoint_number INTEGER NOT NULL,
  handler_id VARCHAR(128) NOT NULL,
  handler_version VARCHAR(128) NOT NULL,
  input_sha256 CHAR(64) NOT NULL,
  object_id VARCHAR(128) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (checkpoint_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (checkpoint_number > 0),
  CHECK (attempt_number > 0),
  CHECK (handler_id ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'),
  CHECK (length(handler_version) BETWEEN 1 AND 128),
  CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (size_bytes >= 0),
  UNIQUE (organization_id, job_id, checkpoint_id),
  UNIQUE (organization_id, job_id, checkpoint_number),
  FOREIGN KEY (organization_id, job_id, attempt_id)
    REFERENCES async_job_attempts(organization_id, job_id, attempt_id),
  FOREIGN KEY (organization_id, object_id)
    REFERENCES stored_objects(organization_id, object_id)
);

CREATE FUNCTION validate_async_job_checkpoint()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM async_jobs AS job
  JOIN async_job_attempts AS attempt
    ON attempt.organization_id = job.organization_id
   AND attempt.job_id = job.job_id
   AND attempt.attempt_id = NEW.attempt_id
  JOIN stored_objects AS checkpoint_object
    ON checkpoint_object.organization_id = job.organization_id
   AND checkpoint_object.project_id IS NOT DISTINCT FROM job.project_id
   AND checkpoint_object.object_id = NEW.object_id
  WHERE job.organization_id = NEW.organization_id
    AND job.job_id = NEW.job_id
    AND job.lifecycle_status = 'running'
    AND attempt.attempt_number = NEW.attempt_number
    AND attempt.lifecycle_status = 'running'
    AND job.input_sha256 = NEW.input_sha256
    AND NEW.size_bytes <= job.max_checkpoint_bytes
    AND checkpoint_object.object_purpose = 'checkpoint-state'
    AND checkpoint_object.content_sha256 = NEW.content_sha256
    AND checkpoint_object.size_bytes = NEW.size_bytes
    AND checkpoint_object.lifecycle_state = 'published'
    AND (
      SELECT count(*)
      FROM async_job_checkpoints AS existing_checkpoint
      WHERE existing_checkpoint.organization_id = NEW.organization_id
        AND existing_checkpoint.job_id = NEW.job_id
    ) < job.max_checkpoints;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'async job checkpoint metadata does not match'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_checkpoints_validate_record
BEFORE INSERT ON async_job_checkpoints
FOR EACH ROW EXECUTE FUNCTION validate_async_job_checkpoint();

ALTER TABLE async_job_attempts
  ADD CONSTRAINT async_job_attempts_checkpoint_fk
  FOREIGN KEY (organization_id, job_id, checkpoint_id)
  REFERENCES async_job_checkpoints(organization_id, job_id, checkpoint_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE async_job_attempts
  ADD CONSTRAINT async_job_attempts_resume_checkpoint_fk
  FOREIGN KEY (organization_id, job_id, resumed_from_checkpoint_id)
  REFERENCES async_job_checkpoints(organization_id, job_id, checkpoint_id)
  DEFERRABLE INITIALLY DEFERRED;


ALTER TABLE async_jobs
  ADD CONSTRAINT async_jobs_latest_checkpoint_fk
  FOREIGN KEY (organization_id, job_id, latest_checkpoint_id)
  REFERENCES async_job_checkpoints(organization_id, job_id, checkpoint_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE async_jobs
  ADD CONSTRAINT async_jobs_interaction_checkpoint_fk
  FOREIGN KEY (organization_id, job_id, interaction_checkpoint_id)
  REFERENCES async_job_checkpoints(organization_id, job_id, checkpoint_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE async_jobs
  ADD CONSTRAINT async_jobs_interaction_state_matches_lifecycle
  CHECK (
    (lifecycle_status <> 'awaiting-user-input'
      OR interaction_state = 'awaiting-user-input')
    AND (interaction_state <> 'awaiting-user-input'
      OR lifecycle_status IN (
        'awaiting-user-input', 'failed', 'canceled', 'expired', 'superseded'
      ))
    AND (interaction_state <> 'user-input-received'
      OR lifecycle_status <> 'awaiting-user-input')
  );

CREATE FUNCTION validate_async_job_interaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.interaction_state <> 'none' THEN
    PERFORM 1
    FROM async_job_checkpoints AS checkpoint
    WHERE checkpoint.organization_id = NEW.organization_id
      AND checkpoint.job_id = NEW.job_id
      AND checkpoint.checkpoint_id = NEW.interaction_checkpoint_id
      AND checkpoint.handler_id = NEW.interaction_handler_id
      AND checkpoint.handler_version = NEW.interaction_handler_version
      AND checkpoint.input_sha256 = NEW.input_sha256;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'async job interaction does not match its durable checkpoint'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.interaction_state = 'user-input-received' THEN
    PERFORM 1
    FROM stored_objects AS response_object
    WHERE response_object.organization_id = NEW.organization_id
      AND response_object.project_id IS NOT DISTINCT FROM NEW.project_id
      AND response_object.object_id = NEW.interaction_response_object_id
      AND response_object.object_purpose = 'input-payload'
      AND response_object.content_sha256 = NEW.interaction_response_sha256
      AND response_object.size_bytes = NEW.interaction_response_size_bytes
      AND response_object.lifecycle_state = 'published';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'async job user response is not an exact durable input object'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_jobs_validate_interaction
BEFORE INSERT OR UPDATE ON async_jobs
FOR EACH ROW EXECUTE FUNCTION validate_async_job_interaction();

CREATE TABLE async_job_artifact_outputs (
  organization_id VARCHAR(128) NOT NULL,
  job_id VARCHAR(128) NOT NULL,
  artifact_reference_id VARCHAR(128) NOT NULL,
  object_id VARCHAR(128) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  size_bytes BIGINT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, job_id, artifact_reference_id),
  CHECK (artifact_reference_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (size_bytes >= 0),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  FOREIGN KEY (organization_id, job_id)
    REFERENCES async_jobs(organization_id, job_id),
  FOREIGN KEY (organization_id, object_id)
    REFERENCES stored_objects(organization_id, object_id)
);

CREATE FUNCTION validate_async_job_artifact_output()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM async_jobs AS job
  JOIN stored_objects AS artifact_object
    ON artifact_object.organization_id = job.organization_id
   AND artifact_object.project_id IS NOT DISTINCT FROM job.project_id
   AND artifact_object.object_id = NEW.object_id
  WHERE job.organization_id = NEW.organization_id
    AND job.job_id = NEW.job_id
    AND NEW.size_bytes <= job.max_output_bytes
    AND artifact_object.object_purpose IN (
      'proposal', 'generated-source', 'build-output', 'validation-report', 'diagram',
      'export-package', 'repository-export-receipt', 'plan-result',
      'deployment-result', 'smoke-integration-result', 'drift-result',
      'billing-reconciliation-result'
    )
    AND artifact_object.content_sha256 = NEW.content_sha256
    AND artifact_object.size_bytes = NEW.size_bytes
    AND artifact_object.lifecycle_state = 'published'
    AND (
      SELECT count(*)
      FROM async_job_artifact_outputs AS existing_artifact
      WHERE existing_artifact.organization_id = NEW.organization_id
        AND existing_artifact.job_id = NEW.job_id
    ) < job.max_artifacts
    AND NEW.size_bytes + (
      SELECT COALESCE(sum(existing_artifact.size_bytes), 0)
      FROM async_job_artifact_outputs AS existing_artifact
      WHERE existing_artifact.organization_id = NEW.organization_id
        AND existing_artifact.job_id = NEW.job_id
    ) + (
      SELECT COALESCE(sum(existing_evidence.evidence_size_bytes), 0)
      FROM async_job_evidence_outputs AS existing_evidence
      WHERE existing_evidence.organization_id = NEW.organization_id
        AND existing_evidence.job_id = NEW.job_id
    ) <= job.max_output_bytes;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'async job artifact output metadata does not match'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_artifact_outputs_validate_record
BEFORE INSERT ON async_job_artifact_outputs
FOR EACH ROW EXECUTE FUNCTION validate_async_job_artifact_output();

CREATE TABLE async_job_evidence_outputs (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  job_id VARCHAR(128) NOT NULL,
  evidence_solution_record_id VARCHAR(128) NOT NULL,
  evidence_id VARCHAR(128) NOT NULL,
  evidence_record_kind VARCHAR(64) NOT NULL DEFAULT 'evidence',
  evidence_object_id VARCHAR(128) NOT NULL,
  evidence_sha256 CHAR(64) NOT NULL,
  evidence_size_bytes BIGINT NOT NULL,
  solution_revision_id VARCHAR(128) NOT NULL,
  environment_id VARCHAR(128),
  environment_type VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, job_id, evidence_solution_record_id),
  UNIQUE (organization_id, job_id, evidence_id),
  UNIQUE (organization_id, job_id, evidence_object_id),
  CHECK (evidence_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (evidence_record_kind = 'evidence'),
  CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (evidence_size_bytes >= 0),
  CHECK (environment_type IN (
    'development', 'test', 'staging', 'production',
    'disaster-recovery', 'multi-environment', 'unknown'
  )),
  FOREIGN KEY (organization_id, project_id, job_id)
    REFERENCES async_jobs(organization_id, project_id, job_id),
  FOREIGN KEY (organization_id, project_id, evidence_solution_record_id)
    REFERENCES solution_records(organization_id, project_id, solution_record_id),
  FOREIGN KEY (organization_id, project_id, evidence_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (
    organization_id, project_id, evidence_solution_record_id,
    evidence_record_kind, evidence_id
  ) REFERENCES solution_records(
    organization_id, project_id, solution_record_id,
    record_kind, subject_id
  )
);
CREATE FUNCTION validate_async_job_evidence_output()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM async_jobs AS job
  JOIN solution_records AS evidence
    ON evidence.organization_id = job.organization_id
   AND evidence.project_id = job.project_id
   AND evidence.solution_record_id = NEW.evidence_solution_record_id
  JOIN stored_objects AS evidence_object
    ON evidence_object.organization_id = evidence.organization_id
   AND evidence_object.project_id = evidence.project_id
   AND evidence_object.object_id = NEW.evidence_object_id
  WHERE job.organization_id = NEW.organization_id
    AND job.project_id = NEW.project_id
    AND job.job_id = NEW.job_id
    AND job.subject_kind = 'solution-revision'
    AND job.solution_revision_id = NEW.solution_revision_id
    AND evidence.record_kind = 'evidence'
    AND evidence.subject_id = NEW.evidence_id
    AND evidence.content_object_id = NEW.evidence_object_id
    AND evidence.content_sha256 = NEW.evidence_sha256
    AND evidence_object.object_purpose = 'evidence'
    AND evidence_object.content_sha256 = NEW.evidence_sha256
    AND evidence_object.size_bytes = NEW.evidence_size_bytes
    AND evidence_object.lifecycle_state = 'published'
    AND job.environment_type = NEW.environment_type
    AND job.environment_id IS NOT DISTINCT FROM NEW.environment_id
    AND NEW.evidence_size_bytes + (
      SELECT COALESCE(sum(existing_artifact.size_bytes), 0)
      FROM async_job_artifact_outputs AS existing_artifact
      WHERE existing_artifact.organization_id = NEW.organization_id
        AND existing_artifact.job_id = NEW.job_id
    ) + (
      SELECT COALESCE(sum(existing_evidence.evidence_size_bytes), 0)
      FROM async_job_evidence_outputs AS existing_evidence
      WHERE existing_evidence.organization_id = NEW.organization_id
        AND existing_evidence.job_id = NEW.job_id
    ) <= job.max_output_bytes;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'async job Evidence output does not match exact revision and environment'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_evidence_outputs_validate_record
BEFORE INSERT ON async_job_evidence_outputs
FOR EACH ROW EXECUTE FUNCTION validate_async_job_evidence_output();


CREATE TABLE async_job_events (
  event_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  job_id VARCHAR(128) NOT NULL,
  sequence_number BIGINT NOT NULL,
  event_kind VARCHAR(64) NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32),
  summary_sha256 CHAR(64),
  transition_reason VARCHAR(128),
  transition_record_version BIGINT,
  correlation_id VARCHAR(128) NOT NULL,
  actor_principal_id VARCHAR(128) REFERENCES principals(principal_id),
  actor_kind VARCHAR(32) NOT NULL,
  actor_reference VARCHAR(128) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (sequence_number > 0),
  CHECK (event_kind IN (
    'job-created', 'entitlement-authorized', 'entitlement-denied',
    'reservation-established', 'job-enqueued', 'attempt-claimed',
    'progress-recorded', 'checkpoint-recorded', 'awaiting-user-input',
    'retry-scheduled', 'cancellation-requested', 'job-canceled',
    'job-succeeded', 'job-failed', 'job-expired', 'job-superseded',
    'orphan-reconciled', 'child-linked'
  )),
  CHECK (from_status IS NULL OR from_status IN (
    'queued', 'running', 'awaiting-user-input', 'succeeded', 'failed',
    'canceled', 'expired', 'superseded'
  )),
  CHECK (to_status IS NULL OR to_status IN (
    'queued', 'running', 'awaiting-user-input', 'succeeded', 'failed',
    'canceled', 'expired', 'superseded'
  )),
  CHECK (summary_sha256 IS NULL OR summary_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (
    (to_status IS NULL
      AND from_status IS NULL
      AND transition_reason IS NULL
      AND transition_record_version IS NULL)
    OR (to_status IS NOT NULL
      AND transition_reason IS NOT NULL
      AND transition_record_version IS NOT NULL)
  ),
  CHECK (
    transition_reason IS NULL
    OR transition_reason ~ '^[a-z][a-z0-9-]{0,127}$'
  ),
  CHECK (
    transition_record_version IS NULL OR transition_record_version > 0
  ),
  CHECK (length(correlation_id) BETWEEN 1 AND 128),
  CHECK (actor_kind IN ('principal', 'worker', 'system')),
  CHECK (length(actor_reference) BETWEEN 1 AND 128),
  CHECK (
    (actor_kind = 'principal'
      AND actor_principal_id IS NOT NULL
      AND actor_reference = actor_principal_id)
    OR (actor_kind IN ('worker', 'system')
      AND actor_principal_id IS NULL)
  ),
  UNIQUE (organization_id, job_id, sequence_number),
  UNIQUE (organization_id, event_id),
  FOREIGN KEY (organization_id, job_id)
    REFERENCES async_jobs(organization_id, job_id)
);

CREATE TRIGGER async_job_checkpoints_are_immutable
BEFORE UPDATE OR DELETE ON async_job_checkpoints
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER async_job_artifact_outputs_are_immutable
BEFORE UPDATE OR DELETE ON async_job_artifact_outputs
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER async_job_evidence_outputs_are_immutable
BEFORE UPDATE OR DELETE ON async_job_evidence_outputs
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER async_job_events_are_immutable
BEFORE UPDATE OR DELETE ON async_job_events
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE async_job_event_delivery_receipts (
  event_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128),
  published_at TIMESTAMPTZ NOT NULL,
  CHECK (event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  UNIQUE (organization_id, event_id),
  FOREIGN KEY (organization_id, event_id)
    REFERENCES async_job_events(organization_id, event_id)
);

CREATE FUNCTION validate_async_job_event_delivery_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM async_job_events AS job_event
  JOIN async_jobs AS job
    ON job.organization_id = job_event.organization_id
   AND job.job_id = job_event.job_id
  WHERE job_event.organization_id = NEW.organization_id
    AND job.project_id IS NOT DISTINCT FROM NEW.project_id
    AND job_event.event_id = NEW.event_id
    AND NEW.published_at >= job_event.occurred_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job audit delivery receipt does not match exact event ownership and time'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER async_job_event_delivery_receipts_validate
BEFORE INSERT ON async_job_event_delivery_receipts
FOR EACH ROW EXECUTE FUNCTION validate_async_job_event_delivery_receipt();

CREATE TRIGGER async_job_event_delivery_receipts_are_immutable
BEFORE UPDATE OR DELETE ON async_job_event_delivery_receipts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE INDEX async_jobs_organization_status_idx
  ON async_jobs (
    organization_id, lifecycle_status, created_at, job_id
  );

CREATE INDEX async_jobs_project_created_idx
  ON async_jobs (organization_id, project_id, created_at DESC, job_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX async_jobs_queued_reconciliation_idx
  ON async_jobs (organization_id, project_id, queued_at, job_id)
  WHERE lifecycle_status = 'queued';

CREATE INDEX async_jobs_orphan_reconciliation_idx
  ON async_jobs (organization_id, project_id, updated_at, job_id)
  WHERE lifecycle_status = 'running';

CREATE INDEX async_jobs_retention_reconciliation_idx
  ON async_jobs (organization_id, project_id, expires_at, job_id)
  WHERE expires_at IS NOT NULL
    AND lifecycle_status IN ('queued', 'running', 'awaiting-user-input');

CREATE INDEX async_job_attempts_lease_idx
  ON async_job_attempts (organization_id, lease_expires_at, job_id)
  WHERE lifecycle_status = 'running';

CREATE INDEX async_job_creation_claims_recovery_idx
  ON async_job_creation_claims (
    organization_id, project_id, updated_at, operation_id,
    idempotency_key_sha256
  )
  WHERE claim_status = 'claimed';

CREATE INDEX async_job_creation_claim_events_tenant_cursor_idx
  ON async_job_creation_claim_events (
    organization_id, project_id, occurred_at, creation_event_id
  );

CREATE INDEX async_job_creation_claim_delivery_tenant_cursor_idx
  ON async_job_creation_claim_event_delivery_receipts (
    organization_id, project_id, published_at, creation_event_id
  );

CREATE INDEX async_job_events_tenant_cursor_idx
  ON async_job_events (
    organization_id, job_id, occurred_at, event_id
  );

CREATE INDEX async_job_event_delivery_tenant_cursor_idx
  ON async_job_event_delivery_receipts (
    organization_id, project_id, published_at, event_id
  );

CREATE INDEX async_job_attempts_retry_idx
  ON async_job_attempts (organization_id, retry_not_before, job_id)
  WHERE retry_disposition = 'retry';

CREATE INDEX async_jobs_parent_idx
  ON async_jobs (organization_id, parent_job_id, job_id)
  WHERE parent_job_id IS NOT NULL;

CREATE INDEX async_job_artifact_outputs_expiry_idx
  ON async_job_artifact_outputs (organization_id, expires_at, job_id)
  WHERE expires_at IS NOT NULL;

COMMENT ON TABLE async_job_identity_reservations IS
  'Immutable job identity and lineage reservations; these are not job stubs and never carry lifecycle, payload, output, artifact, or secret data.';

COMMENT ON TABLE async_jobs IS
  'Tenant-scoped Async Job v1 coordination records; every row consumes an exact immutable identity reservation and external work remains behind ports.';

COMMENT ON TABLE async_job_creation_claims IS
  'Durable idempotency claim and normalized safe creation plan; claimed_at is the exact eventual job created_at and recovery never reruns commercial hooks.';

COMMENT ON TABLE async_job_creation_claim_orchestration_members IS
  'Immutable ordered dependency and preallocated expected-child identities for exact creation-plan recovery.';

COMMENT ON TABLE async_job_creation_claim_events IS
  'Immutable claim-linked creation decision and recovery audit; stores only bounded safe fields and digests, never raw idempotency keys or secret-bearing payloads.';

COMMENT ON TABLE async_job_creation_claim_event_delivery_receipts IS
  'Immutable tenant-scoped delivery receipts; pending creation audit is derived by anti-joining exact claim events so event content remains append-only.';

COMMENT ON TABLE async_job_events IS
  'Immutable job-linked lifecycle audit cursor; adapters write state and its event in one database transaction for polling and future server events.';

COMMENT ON TABLE async_job_event_delivery_receipts IS
  'Immutable tenant-scoped delivery receipts; pending job audit is derived by anti-joining exact events and publishing is an idempotent insert-on-conflict operation.';
