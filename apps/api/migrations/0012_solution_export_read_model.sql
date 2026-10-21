ALTER TABLE async_jobs
  DROP CONSTRAINT async_jobs_family_check,
  ADD CONSTRAINT async_jobs_family_check
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
      'solution-export-orchestration',
      'github-repository-export',
      'customer-owned-plan-evidence',
      'deployment-evidence',
      'smoke-integration-evidence',
      'drift-evidence',
      'billing-usage-reconciliation'
    ));

DO $$
DECLARE
  matching_constraint RECORD;
  matching_count INTEGER := 0;
BEGIN
  FOR matching_constraint IN
    SELECT constraint_record.conname
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = 'async_jobs'::regclass
      AND constraint_record.contype = 'c'
      AND position(
        'environment_type IS NOT NULL'
        IN pg_get_constraintdef(constraint_record.oid)
      ) > 0
      AND position(
        'application-build-test-package'
        IN pg_get_constraintdef(constraint_record.oid)
      ) > 0
  LOOP
    matching_count := matching_count + 1;
    EXECUTE format(
      'ALTER TABLE async_jobs DROP CONSTRAINT %I',
      matching_constraint.conname
    );
  END LOOP;

  IF matching_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one async-job environment-family check'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE async_jobs
  ADD CONSTRAINT async_jobs_environment_family_check_v2 CHECK (
    (family IN (
      'iac-compilation',
      'application-source-generation',
      'application-build-test-package',
      'solution-export-orchestration',
      'github-repository-export',
      'static-validation',
      'customer-owned-plan-evidence',
      'deployment-evidence',
      'smoke-integration-evidence',
      'drift-evidence'
    ) AND environment_type IS NOT NULL)
    OR (family NOT IN (
      'iac-compilation',
      'application-source-generation',
      'application-build-test-package',
      'solution-export-orchestration',
      'github-repository-export',
      'static-validation',
      'customer-owned-plan-evidence',
      'deployment-evidence',
      'smoke-integration-evidence',
      'drift-evidence'
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
    WHERE constraint_record.conrelid = 'async_jobs'::regclass
      AND constraint_record.contype = 'c'
      AND position(
        'billing-usage-reconciliation'
        IN pg_get_constraintdef(constraint_record.oid)
      ) > 0
      AND position(
        'graph-workload-operation-proposal'
        IN pg_get_constraintdef(constraint_record.oid)
      ) > 0
      AND cardinality(constraint_record.conkey) = 2
      AND constraint_record.conkey @> ARRAY[
        (
          SELECT attribute_record.attnum
          FROM pg_attribute AS attribute_record
          WHERE attribute_record.attrelid = 'async_jobs'::regclass
            AND attribute_record.attname = 'family'
            AND NOT attribute_record.attisdropped
        ),
        (
          SELECT attribute_record.attnum
          FROM pg_attribute AS attribute_record
          WHERE attribute_record.attrelid = 'async_jobs'::regclass
            AND attribute_record.attname = 'subject_kind'
            AND NOT attribute_record.attisdropped
        )
      ]::SMALLINT[]
  LOOP
    matching_count := matching_count + 1;
    EXECUTE format(
      'ALTER TABLE async_jobs DROP CONSTRAINT %I',
      matching_constraint.conname
    );
  END LOOP;

  IF matching_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one async-job family-subject check'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE async_jobs
  ADD CONSTRAINT async_jobs_family_subject_check_v2 CHECK (
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
      'solution-export-orchestration',
      'github-repository-export',
      'customer-owned-plan-evidence',
      'deployment-evidence',
      'smoke-integration-evidence',
      'drift-evidence'
    ) AND subject_kind = 'solution-revision')
    OR (family = 'billing-usage-reconciliation'
      AND subject_kind = 'organization')
  );

CREATE TABLE solution_export_runs (
  solution_export_run_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  root_job_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  api_contract_version SMALLINT NOT NULL DEFAULT 1,
  solution_revision_id VARCHAR(128) NOT NULL,
  solution_manifest_record_id VARCHAR(128) NOT NULL,
  solution_manifest_record_kind VARCHAR(64) NOT NULL
    DEFAULT 'solution-revision-manifest',
  solution_manifest_subject_id VARCHAR(128) NOT NULL,
  solution_manifest_sha256 CHAR(64) NOT NULL,
  environment_id VARCHAR(128),
  environment_type VARCHAR(32) NOT NULL,
  target_profile_id VARCHAR(96) NOT NULL,
  target_settings_sha256 CHAR(64) NOT NULL,
  export_name VARCHAR(96) NOT NULL,
  orchestration_input_object_id VARCHAR(128) NOT NULL,
  orchestration_input_sha256 CHAR(64) NOT NULL,
  workflow_request_object_id VARCHAR(128) NOT NULL,
  request_sha256 CHAR(64) NOT NULL,
  primary_input_sha256 CHAR(64) NOT NULL,
  run_sequence INTEGER NOT NULL,
  rerun_of_run_id VARCHAR(128),
  request_intent_sha256 CHAR(64) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  entitlement_decision_reference VARCHAR(128) NOT NULL,
  previous_artifact_id VARCHAR(128),
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'queued',
  progress_stage VARCHAR(64),
  progress_completed_stages SMALLINT NOT NULL DEFAULT 1,
  progress_message VARCHAR(512) NOT NULL,
  generation_coverage_object_id VARCHAR(128),
  generation_coverage_sha256 CHAR(64),
  diagnostics_object_id VARCHAR(128),
  diagnostics_sha256 CHAR(64),
  evidence_object_id VARCHAR(128),
  evidence_sha256 CHAR(64),
  workflow_read_model_object_id VARCHAR(128),
  workflow_read_model_sha256 CHAR(64),
  cancellation_requested_at TIMESTAMPTZ,
  cancellation_acknowledged_at TIMESTAMPTZ,
  created_by_principal_id VARCHAR(128) NOT NULL
    REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  record_version BIGINT NOT NULL DEFAULT 1,
  CHECK (
    solution_export_run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (storage_contract_version = 1),
  CHECK (api_contract_version = 1),
  CHECK (solution_manifest_record_kind = 'solution-revision-manifest'),
  CHECK (solution_manifest_subject_id = solution_revision_id),
  CHECK (solution_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (orchestration_input_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (target_settings_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (primary_input_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (run_sequence BETWEEN 1 AND 1000000),
  CHECK (
    (run_sequence = 1 AND rerun_of_run_id IS NULL)
    OR (run_sequence > 1 AND rerun_of_run_id IS NOT NULL)
  ),
  CHECK (request_intent_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (
    target_profile_id = 'cloudmarkup.export.terraform-nodejs24-v1'
  ),
  CHECK (
    export_name ~
      '^(?:[A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9 ._-]{0,94}[A-Za-z0-9])$'
  ),
  CHECK (environment_type IN (
    'development', 'test', 'staging', 'production'
  )),
  CHECK (progress_completed_stages BETWEEN 0 AND 7),
  CHECK (
    progress_stage IS NULL OR progress_stage IN (
      'authorization',
      'compilation',
      'application-generation',
      'application-build',
      'terraform-validation',
      'packaging',
      'publication'
    )
  ),
  CHECK (lifecycle_status IN (
    'queued', 'running', 'succeeded', 'failed',
    'cancellation-requested', 'canceled'
  )),
  CHECK ((generation_coverage_object_id IS NULL) =
    (generation_coverage_sha256 IS NULL)),
  CHECK ((diagnostics_object_id IS NULL) = (diagnostics_sha256 IS NULL)),
  CHECK ((evidence_object_id IS NULL) = (evidence_sha256 IS NULL)),
  CHECK ((workflow_read_model_object_id IS NULL) =
    (workflow_read_model_sha256 IS NULL)),
  CHECK (
    generation_coverage_sha256 IS NULL
    OR generation_coverage_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CHECK (
    diagnostics_sha256 IS NULL OR diagnostics_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CHECK (evidence_sha256 IS NULL OR evidence_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (
    workflow_read_model_sha256 IS NULL
    OR workflow_read_model_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CHECK (record_version > 0),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (
    (lifecycle_status IN ('succeeded', 'failed', 'canceled'))
      = (completed_at IS NOT NULL)
  ),
  CHECK (
    (cancellation_requested_at IS NULL
      AND cancellation_acknowledged_at IS NULL)
    OR (cancellation_requested_at IS NOT NULL
      AND (cancellation_acknowledged_at IS NULL
        OR cancellation_acknowledged_at >= cancellation_requested_at))
  ),
  UNIQUE (organization_id, project_id, solution_export_run_id),
  UNIQUE (organization_id, project_id, root_job_id),
  UNIQUE (
    organization_id,
    project_id,
    primary_input_sha256,
    run_sequence
  ),
  UNIQUE (
    organization_id,
    created_by_principal_id,
    idempotency_key_sha256
  ),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, project_id, root_job_id)
    REFERENCES async_jobs(organization_id, project_id, job_id),
  FOREIGN KEY (organization_id, project_id, rerun_of_run_id)
    REFERENCES solution_export_runs(
      organization_id, project_id, solution_export_run_id
    ),
  FOREIGN KEY (
    organization_id,
    project_id,
    solution_manifest_record_id,
    solution_manifest_record_kind,
    solution_manifest_subject_id
  ) REFERENCES solution_records(
    organization_id,
    project_id,
    solution_record_id,
    record_kind,
    subject_id
  ),
  FOREIGN KEY (organization_id, project_id, orchestration_input_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id, environment_id)
    REFERENCES project_environments(organization_id, project_id, environment_id),
  FOREIGN KEY (organization_id, project_id, workflow_request_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id, generation_coverage_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id, diagnostics_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id, evidence_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id, workflow_read_model_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id)
);

COMMENT ON COLUMN solution_export_runs.orchestration_input_object_id IS
  'Exact published async-job input envelope; orchestration_input_sha256 must match it.';
COMMENT ON COLUMN solution_export_runs.workflow_request_object_id IS
  'Exact published workflow-request object referenced by the root async-job input envelope; application insertions must pass validateSolutionExportRunInsertionBindingV1 before SQL separately validates both objects.';
COMMENT ON COLUMN solution_export_runs.target_profile_id IS
  'Database independently allowlists v1; the API target policy derives the exact profile and target-settings snapshot.';
COMMENT ON COLUMN solution_export_runs.primary_input_sha256 IS
  'Canonical tenant/project/workflow-request digest committing every source reference and approved setting while excluding only previous-package baseline.';
COMMENT ON COLUMN solution_export_runs.run_sequence IS
  'Explicit same-primary-input version; active and retained successful runs deduplicate, while terminal failed, canceled, or expired runs may advance.';

CREATE TABLE solution_export_artifacts (
  solution_export_artifact_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  solution_export_run_id VARCHAR(128) NOT NULL,
  solution_revision_id VARCHAR(128) NOT NULL,
  manifest_object_id VARCHAR(128) NOT NULL,
  manifest_sha256 CHAR(64) NOT NULL,
  manifest_size_bytes BIGINT NOT NULL,
  archive_object_id VARCHAR(128) NOT NULL,
  archive_sha256 CHAR(64) NOT NULL,
  archive_file_name VARCHAR(100) NOT NULL,
  file_count INTEGER NOT NULL,
  size_bytes BIGINT NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    solution_export_artifact_id ~
      '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (manifest_size_bytes BETWEEN 0 AND 33554432),
  CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (archive_file_name ~ '^[a-z0-9][a-z0-9._-]{0,95}\.zip$'),
  CHECK (file_count BETWEEN 0 AND 2048),
  CHECK (size_bytes BETWEEN 0 AND 67108864),
  CHECK (retention_expires_at > created_at),
  UNIQUE (organization_id, project_id, solution_export_artifact_id),
  UNIQUE (organization_id, project_id, solution_export_run_id),
  FOREIGN KEY (organization_id, project_id, solution_export_run_id)
    REFERENCES solution_export_runs(
      organization_id, project_id, solution_export_run_id
    ),
  FOREIGN KEY (organization_id, project_id, manifest_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id, archive_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id)
);

ALTER TABLE solution_export_runs
  ADD FOREIGN KEY (organization_id, project_id, previous_artifact_id)
  REFERENCES solution_export_artifacts(
    organization_id, project_id, solution_export_artifact_id
  );

CREATE INDEX solution_export_runs_previous_artifact_lookup_idx
  ON solution_export_runs (
    organization_id,
    project_id,
    target_profile_id,
    target_settings_sha256,
    environment_type,
    environment_id,
    completed_at DESC,
    solution_export_run_id DESC
  )
  WHERE lifecycle_status = 'succeeded';

CREATE TABLE solution_export_artifact_files (
  solution_export_file_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  solution_export_artifact_id VARCHAR(128) NOT NULL,
  repository_path VARCHAR(512) NOT NULL,
  media_type VARCHAR(128) NOT NULL,
  ownership VARCHAR(64) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  semantic_sha256 CHAR(64) NOT NULL,
  size_bytes BIGINT NOT NULL,
  preview_available BOOLEAN NOT NULL DEFAULT FALSE,
  content_object_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    solution_export_file_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (
    repository_path !~ '(^|/)\.{1,2}(/|$)'
    AND repository_path !~ '^[\\/]'
    AND repository_path !~ '^[A-Za-z]:'
    AND repository_path !~ '[\\:]'
    AND length(repository_path) BETWEEN 1 AND 512
  ),
  CHECK (media_type IN (
    'application/json',
    'application/pdf',
    'application/vnd.cyclonedx+json',
    'application/vnd.hashicorp.terraform',
    'application/zip',
    'image/png',
    'image/svg+xml',
    'text/markdown',
    'text/plain',
    'text/typescript'
  )),
  CHECK (ownership IN (
    'architecture-as-code-source',
    'generated-replaceable',
    'user-owned-extension',
    'user-provided',
    'generated-build-artifact',
    'evidence-artifact'
  )),
  CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (semantic_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (size_bytes BETWEEN 0 AND 33554432),
  CHECK (preview_available = (content_object_id IS NOT NULL)),
  UNIQUE (
    organization_id,
    project_id,
    solution_export_artifact_id,
    solution_export_file_id
  ),
  UNIQUE (
    organization_id,
    project_id,
    solution_export_artifact_id,
    repository_path
  ),
  FOREIGN KEY (
    organization_id,
    project_id,
    solution_export_artifact_id
  ) REFERENCES solution_export_artifacts(
    organization_id, project_id, solution_export_artifact_id
  ),
  FOREIGN KEY (organization_id, project_id, content_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id)
);

CREATE TABLE solution_export_download_grants (
  solution_export_download_grant_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  solution_export_artifact_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  idempotency_key_sha256 CHAR(64) NOT NULL,
  archive_sha256 CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    solution_export_download_grant_id ~
      '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '5 minutes'),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  UNIQUE (
    organization_id,
    principal_id,
    idempotency_key_sha256
  ),
  UNIQUE (
    organization_id,
    project_id,
    solution_export_artifact_id,
    solution_export_download_grant_id
  ),
  FOREIGN KEY (
    organization_id,
    project_id,
    solution_export_artifact_id
  ) REFERENCES solution_export_artifacts(
    organization_id, project_id, solution_export_artifact_id
  )
);

CREATE FUNCTION validate_solution_export_run_objects()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM stored_objects AS orchestration_input_object
  WHERE orchestration_input_object.organization_id = NEW.organization_id
    AND orchestration_input_object.project_id = NEW.project_id
    AND orchestration_input_object.object_id = NEW.orchestration_input_object_id
    AND orchestration_input_object.object_purpose = 'input-payload'
    AND orchestration_input_object.content_sha256 =
      NEW.orchestration_input_sha256
    AND orchestration_input_object.media_type = 'application/json'
    AND orchestration_input_object.lifecycle_state = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'solution export orchestration-input object metadata does not match'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM stored_objects AS workflow_request_object
  WHERE workflow_request_object.organization_id = NEW.organization_id
    AND workflow_request_object.project_id = NEW.project_id
    AND workflow_request_object.object_id = NEW.workflow_request_object_id
    AND workflow_request_object.object_purpose = 'input-payload'
    AND workflow_request_object.content_sha256 = NEW.request_sha256
    AND workflow_request_object.media_type = 'application/json'
    AND workflow_request_object.lifecycle_state = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'solution export workflow-request object metadata does not match'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.generation_coverage_object_id IS NOT NULL THEN
    PERFORM 1
    FROM stored_objects AS coverage_object
    WHERE coverage_object.organization_id = NEW.organization_id
      AND coverage_object.project_id = NEW.project_id
      AND coverage_object.object_id = NEW.generation_coverage_object_id
      AND coverage_object.object_purpose = 'evidence'
      AND coverage_object.content_sha256 = NEW.generation_coverage_sha256
      AND coverage_object.media_type = 'application/json'
      AND coverage_object.lifecycle_state = 'published';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'solution export coverage object metadata does not match'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.diagnostics_object_id IS NOT NULL THEN
    PERFORM 1
    FROM stored_objects AS diagnostics_object
    WHERE diagnostics_object.organization_id = NEW.organization_id
      AND diagnostics_object.project_id = NEW.project_id
      AND diagnostics_object.object_id = NEW.diagnostics_object_id
      AND diagnostics_object.object_purpose = 'validation-report'
      AND diagnostics_object.content_sha256 = NEW.diagnostics_sha256
      AND diagnostics_object.media_type = 'application/json'
      AND diagnostics_object.lifecycle_state = 'published';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'solution export diagnostics object metadata does not match'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.evidence_object_id IS NOT NULL THEN
    PERFORM 1
    FROM stored_objects AS evidence_object
    WHERE evidence_object.organization_id = NEW.organization_id
      AND evidence_object.project_id = NEW.project_id
      AND evidence_object.object_id = NEW.evidence_object_id
      AND evidence_object.object_purpose = 'evidence'
      AND evidence_object.content_sha256 = NEW.evidence_sha256
      AND evidence_object.media_type = 'application/json'
      AND evidence_object.lifecycle_state = 'published';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'solution export evidence object metadata does not match'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.workflow_read_model_object_id IS NOT NULL THEN
    PERFORM 1
    FROM stored_objects AS read_model_object
    WHERE read_model_object.organization_id = NEW.organization_id
      AND read_model_object.project_id = NEW.project_id
      AND read_model_object.object_id = NEW.workflow_read_model_object_id
      AND read_model_object.object_purpose = 'checkpoint-state'
      AND read_model_object.content_sha256 = NEW.workflow_read_model_sha256
      AND read_model_object.media_type = 'application/json'
      AND read_model_object.lifecycle_state = 'published';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'solution export read-model object metadata does not match'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER solution_export_runs_validate_objects
BEFORE INSERT OR UPDATE ON solution_export_runs
FOR EACH ROW EXECUTE FUNCTION validate_solution_export_run_objects();

CREATE FUNCTION validate_solution_export_artifact_objects()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM stored_objects AS manifest_object
  JOIN stored_objects AS archive_object
    ON archive_object.organization_id = manifest_object.organization_id
    AND archive_object.project_id = manifest_object.project_id
    AND archive_object.object_id = NEW.archive_object_id
  JOIN solution_export_runs AS export_run
    ON export_run.organization_id = manifest_object.organization_id
    AND export_run.project_id = manifest_object.project_id
    AND export_run.solution_export_run_id = NEW.solution_export_run_id
  WHERE manifest_object.organization_id = NEW.organization_id
    AND export_run.lifecycle_status = 'succeeded'
    AND export_run.completed_at IS NOT NULL
    AND export_run.solution_revision_id = NEW.solution_revision_id
    AND export_run.generation_coverage_object_id IS NOT NULL
    AND export_run.evidence_object_id IS NOT NULL
    AND export_run.workflow_read_model_object_id IS NOT NULL
    AND manifest_object.project_id = NEW.project_id
    AND manifest_object.object_id = NEW.manifest_object_id
    AND manifest_object.object_purpose = 'artifact-manifest'
    AND manifest_object.content_sha256 = NEW.manifest_sha256
    AND manifest_object.size_bytes = NEW.manifest_size_bytes
    AND manifest_object.media_type = 'application/json'
    AND manifest_object.lifecycle_state = 'published'
    AND archive_object.object_purpose = 'export-package'
    AND archive_object.content_sha256 = NEW.archive_sha256
    AND archive_object.size_bytes = NEW.size_bytes
    AND archive_object.media_type = 'application/zip'
    AND archive_object.lifecycle_state = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'solution export artifact object metadata does not match'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER solution_export_artifacts_validate_objects
BEFORE INSERT ON solution_export_artifacts
FOR EACH ROW EXECUTE FUNCTION validate_solution_export_artifact_objects();

CREATE FUNCTION validate_solution_export_file_object()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.content_object_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM stored_objects AS content_object
  WHERE content_object.organization_id = NEW.organization_id
    AND content_object.project_id = NEW.project_id
    AND content_object.object_id = NEW.content_object_id
    AND content_object.content_sha256 = NEW.content_sha256
    AND content_object.size_bytes = NEW.size_bytes
    AND content_object.media_type = NEW.media_type
    AND content_object.lifecycle_state = 'published'
    AND (
      (NEW.ownership = 'architecture-as-code-source'
        AND content_object.object_purpose IN (
          'architecture-revision', 'input-payload'
        ))
      OR (NEW.ownership IN ('user-owned-extension', 'user-provided')
        AND content_object.object_purpose = 'input-payload')
      OR (NEW.ownership = 'generated-replaceable'
        AND content_object.object_purpose = 'generated-source')
      OR (NEW.ownership = 'generated-build-artifact'
        AND content_object.object_purpose IN ('build-output', 'export-package'))
      OR (NEW.ownership = 'evidence-artifact'
        AND content_object.object_purpose IN ('evidence', 'validation-report'))
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'solution export file object metadata does not match'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER solution_export_artifact_files_validate_object
BEFORE INSERT ON solution_export_artifact_files
FOR EACH ROW EXECUTE FUNCTION validate_solution_export_file_object();

CREATE FUNCTION validate_solution_export_run_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM solution_records AS manifest_record
  JOIN async_jobs AS root_job
    ON root_job.organization_id = NEW.organization_id
    AND root_job.project_id = NEW.project_id
    AND root_job.job_id = NEW.root_job_id
  WHERE manifest_record.organization_id = NEW.organization_id
    AND manifest_record.project_id = NEW.project_id
    AND manifest_record.solution_record_id = NEW.solution_manifest_record_id
    AND manifest_record.record_kind = 'solution-revision-manifest'
    AND manifest_record.subject_id = NEW.solution_revision_id
    AND manifest_record.content_sha256 = NEW.solution_manifest_sha256
    AND root_job.family = 'solution-export-orchestration'
    AND root_job.subject_kind = 'solution-revision'
    AND root_job.solution_revision_id = NEW.solution_revision_id
    AND root_job.solution_manifest_record_id = NEW.solution_manifest_record_id
    AND root_job.solution_manifest_sha256 = NEW.solution_manifest_sha256
    AND root_job.environment_id IS NOT DISTINCT FROM NEW.environment_id
    AND root_job.environment_type = NEW.environment_type
    AND root_job.input_object_id = NEW.orchestration_input_object_id
    AND root_job.input_sha256 = NEW.orchestration_input_sha256
    AND root_job.entitlement_decision_reference =
      NEW.entitlement_decision_reference;
  -- validateSolutionExportRunInsertionBindingV1 proves the envelope request
  -- reference, request digest, target settings, environment, and subject match;
  -- SQL independently binds the envelope and validates both stored objects.

  IF NOT FOUND THEN
    RAISE EXCEPTION 'solution export run does not match immutable job input'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.previous_artifact_id IS NOT NULL THEN
    PERFORM 1
    FROM solution_export_artifacts AS previous_artifact
    JOIN solution_export_runs AS previous_run
      ON previous_run.organization_id = previous_artifact.organization_id
      AND previous_run.project_id = previous_artifact.project_id
      AND previous_run.solution_export_run_id =
        previous_artifact.solution_export_run_id
    WHERE previous_artifact.organization_id = NEW.organization_id
      AND previous_artifact.project_id = NEW.project_id
      AND previous_artifact.solution_export_artifact_id =
        NEW.previous_artifact_id
      AND previous_run.lifecycle_status = 'succeeded'
      AND previous_run.target_profile_id = NEW.target_profile_id
      AND previous_run.target_settings_sha256 = NEW.target_settings_sha256
      AND previous_run.environment_type = NEW.environment_type
      AND previous_run.environment_id IS NOT DISTINCT FROM NEW.environment_id
      AND previous_artifact.retention_expires_at > NEW.created_at
      AND previous_artifact.created_at <= NEW.created_at;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'previous solution export artifact is not an eligible exact-target baseline'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.rerun_of_run_id IS NOT NULL THEN
    PERFORM 1
    FROM solution_export_runs AS preceding_run
    LEFT JOIN solution_export_artifacts AS preceding_artifact
      ON preceding_artifact.organization_id = preceding_run.organization_id
      AND preceding_artifact.project_id = preceding_run.project_id
      AND preceding_artifact.solution_export_run_id =
        preceding_run.solution_export_run_id
    WHERE preceding_run.organization_id = NEW.organization_id
      AND preceding_run.project_id = NEW.project_id
      AND preceding_run.solution_export_run_id = NEW.rerun_of_run_id
      AND preceding_run.primary_input_sha256 = NEW.primary_input_sha256
      AND preceding_run.run_sequence = NEW.run_sequence - 1
      AND (
        preceding_run.lifecycle_status IN ('failed', 'canceled')
        OR (
          preceding_run.lifecycle_status = 'succeeded'
          AND preceding_artifact.retention_expires_at <= NEW.created_at
        )
      );

    IF NOT FOUND THEN
      RAISE EXCEPTION 'solution export rerun does not follow an eligible terminal exact-input run'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER solution_export_runs_validate_binding
BEFORE INSERT ON solution_export_runs
FOR EACH ROW EXECUTE FUNCTION validate_solution_export_run_binding();

CREATE FUNCTION guard_solution_export_run_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.organization_id,
    NEW.project_id,
    NEW.root_job_id,
    NEW.solution_revision_id,
    NEW.solution_manifest_record_id,
    NEW.solution_manifest_sha256,
    NEW.environment_id,
    NEW.environment_type,
    NEW.target_profile_id,
    NEW.target_settings_sha256,
    NEW.export_name,
    NEW.orchestration_input_object_id,
    NEW.orchestration_input_sha256,
    NEW.request_sha256,
    NEW.workflow_request_object_id,
    NEW.request_intent_sha256,
    NEW.primary_input_sha256,
    NEW.run_sequence,
    NEW.rerun_of_run_id,
    NEW.idempotency_key_sha256,
    NEW.entitlement_decision_reference,
    NEW.previous_artifact_id,
    NEW.created_by_principal_id,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.organization_id,
    OLD.project_id,
    OLD.root_job_id,
    OLD.solution_revision_id,
    OLD.solution_manifest_record_id,
    OLD.solution_manifest_sha256,
    OLD.environment_id,
    OLD.environment_type,
    OLD.target_profile_id,
    OLD.target_settings_sha256,
    OLD.export_name,
    OLD.orchestration_input_object_id,
    OLD.orchestration_input_sha256,
    OLD.request_sha256,
    OLD.workflow_request_object_id,
    OLD.request_intent_sha256,
    OLD.primary_input_sha256,
    OLD.run_sequence,
    OLD.rerun_of_run_id,
    OLD.idempotency_key_sha256,
    OLD.entitlement_decision_reference,
    OLD.previous_artifact_id,
    OLD.created_by_principal_id,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'immutable solution export run binding cannot change'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.record_version <> OLD.record_version + 1 THEN
    RAISE EXCEPTION 'solution export run version must increment by one'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.lifecycle_status IN ('succeeded', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'terminal solution export run cannot change'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER solution_export_runs_guard_update
BEFORE UPDATE ON solution_export_runs
FOR EACH ROW EXECUTE FUNCTION guard_solution_export_run_update();

CREATE TRIGGER solution_export_runs_reject_delete
BEFORE DELETE ON solution_export_runs
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER solution_export_artifacts_are_immutable
BEFORE UPDATE OR DELETE ON solution_export_artifacts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER solution_export_artifact_files_are_immutable
BEFORE UPDATE OR DELETE ON solution_export_artifact_files
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE FUNCTION validate_solution_export_download_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM solution_export_artifacts AS artifact
  WHERE artifact.organization_id = NEW.organization_id
    AND artifact.project_id = NEW.project_id
    AND artifact.solution_export_artifact_id =
      NEW.solution_export_artifact_id
    AND artifact.archive_sha256 = NEW.archive_sha256
    AND NEW.expires_at <= artifact.retention_expires_at
    AND NEW.expires_at <= NEW.created_at + interval '5 minutes';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'download grant exceeds verified artifact authority'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER solution_export_download_grants_validate
BEFORE INSERT ON solution_export_download_grants
FOR EACH ROW EXECUTE FUNCTION validate_solution_export_download_grant();

CREATE FUNCTION guard_solution_export_download_grant_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL
    OR NEW.revoked_at IS NULL
    OR ROW(
      NEW.organization_id,
      NEW.project_id,
      NEW.solution_export_artifact_id,
      NEW.principal_id,
      NEW.idempotency_key_sha256,
      NEW.archive_sha256,
      NEW.expires_at,
      NEW.created_at
    ) IS DISTINCT FROM ROW(
      OLD.organization_id,
      OLD.project_id,
      OLD.solution_export_artifact_id,
      OLD.principal_id,
      OLD.idempotency_key_sha256,
      OLD.archive_sha256,
      OLD.expires_at,
      OLD.created_at
    )
  THEN
    RAISE EXCEPTION 'download grant permits only one-way revocation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER solution_export_download_grants_guard_update
BEFORE UPDATE ON solution_export_download_grants
FOR EACH ROW EXECUTE FUNCTION guard_solution_export_download_grant_update();

CREATE TRIGGER solution_export_download_grants_reject_delete
BEFORE DELETE ON solution_export_download_grants
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE INDEX solution_export_runs_project_created_idx
  ON solution_export_runs (
    organization_id, project_id, created_at DESC, solution_export_run_id
  );

CREATE INDEX solution_export_artifacts_project_created_idx
  ON solution_export_artifacts (
    organization_id,
    project_id,
    created_at DESC,
    solution_export_artifact_id
  );

CREATE INDEX solution_export_download_grants_expiry_idx
  ON solution_export_download_grants (expires_at)
  WHERE revoked_at IS NULL;

CREATE VIEW solution_export_artifact_read_model_v1 AS
SELECT
  artifact.organization_id,
  artifact.project_id,
  artifact.solution_export_artifact_id,
  artifact.solution_export_run_id,
  artifact.solution_revision_id,
  artifact.manifest_sha256,
  artifact.archive_sha256,
  artifact.archive_file_name,
  artifact.file_count,
  artifact.size_bytes,
  run.previous_artifact_id,
  run.run_sequence,
  run.rerun_of_run_id,
  run.environment_id,
  run.environment_type,
  run.target_profile_id,
  run.target_settings_sha256,
  CASE
    WHEN artifact.retention_expires_at > CURRENT_TIMESTAMP THEN 'available'
    ELSE 'expired'
  END AS download_availability,
  artifact.retention_expires_at,
  artifact.created_at
FROM solution_export_artifacts AS artifact
JOIN solution_export_runs AS run
  ON run.organization_id = artifact.organization_id
  AND run.project_id = artifact.project_id
  AND run.solution_export_run_id = artifact.solution_export_run_id;

COMMENT ON TABLE solution_export_runs IS
  'Tenant-scoped mutable read model for one immutable Solution Revision export workflow; input binding and predecessor are fixed at creation.';
COMMENT ON TABLE solution_export_artifacts IS
  'Verified immutable export ZIP metadata separate from legacy generation artifacts.';
COMMENT ON TABLE solution_export_artifact_files IS
  'Verified tenant-scoped file metadata and optional bounded-preview object references.';
COMMENT ON TABLE solution_export_download_grants IS
  'Principal-bound short-lived grants; relative URLs are derived and never persisted as bearer capabilities.';
