CREATE TABLE idempotency_records (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  operation_name VARCHAR(128) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  request_sha256 CHAR(64) NOT NULL,
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  resource_kind VARCHAR(64),
  resource_id VARCHAR(128),
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'in-progress',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (organization_id, operation_name, idempotency_key_sha256),
  CHECK (operation_name ~ '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$'),
  CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (resource_kind IS NULL OR resource_kind ~ '^[a-z][a-z0-9-]{0,63}$'),
  CHECK (lifecycle_status IN ('in-progress', 'completed', 'failed')),
  CHECK ((lifecycle_status = 'completed') = (completed_at IS NOT NULL)),
  CHECK (
    (resource_kind IS NULL AND resource_id IS NULL)
    OR (resource_kind IS NOT NULL AND resource_id IS NOT NULL)
  )
);

CREATE TABLE validation_runs (
  validation_run_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  input_kind VARCHAR(32) NOT NULL,
  draft_id VARCHAR(128),
  draft_version BIGINT,
  revision_id VARCHAR(128),
  environment VARCHAR(32) NOT NULL,
  target VARCHAR(32) NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'queued',
  report_object_id VARCHAR(128),
  report_sha256 CHAR(64),
  safe_failure_code VARCHAR(128),
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK (validation_run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (input_kind IN ('draft', 'revision')),
  CHECK (
    (input_kind = 'draft' AND draft_id IS NOT NULL AND draft_version IS NOT NULL AND revision_id IS NULL)
    OR (input_kind = 'revision' AND revision_id IS NOT NULL AND draft_id IS NULL AND draft_version IS NULL)
  ),
  CHECK (draft_version IS NULL OR draft_version > 0),
  CHECK (environment IN (
    'development', 'test', 'staging', 'production',
    'disaster-recovery', 'multi-environment', 'unknown'
  )),
  CHECK (target IN ('draft', 'revision', 'compilation')),
  CHECK (lifecycle_status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CHECK (report_sha256 IS NULL OR report_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (
    (report_object_id IS NULL AND report_sha256 IS NULL)
    OR (report_object_id IS NOT NULL AND report_sha256 IS NOT NULL)
  ),
  UNIQUE (organization_id, project_id, validation_run_id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, project_id, draft_id)
    REFERENCES architecture_drafts(organization_id, project_id, draft_id),
  FOREIGN KEY (organization_id, project_id, report_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id, revision_id)
    REFERENCES architecture_revisions(organization_id, project_id, revision_id)
);

ALTER TABLE architecture_revisions
  ADD CONSTRAINT architecture_revisions_validation_run_fk
  FOREIGN KEY (organization_id, project_id, validation_run_id)
  REFERENCES validation_runs(organization_id, project_id, validation_run_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE generation_jobs (
  generation_job_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  revision_id VARCHAR(128) NOT NULL,
  generation_kind VARCHAR(32) NOT NULL,
  target VARCHAR(32) NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'queued',
  request_sha256 CHAR(64) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  artifact_id VARCHAR(128),
  safe_failure_code VARCHAR(128),
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK (generation_job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (generation_kind IN ('infrastructure-as-code', 'diagram', 'combined-artifact')),
  CHECK (target IN ('terraform', 'svg', 'png', 'combined')),
  CHECK (lifecycle_status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  UNIQUE (organization_id, project_id, generation_job_id),
  UNIQUE (organization_id, project_id, idempotency_key_sha256),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, project_id, revision_id)
    REFERENCES architecture_revisions(organization_id, project_id, revision_id)
);

CREATE TABLE artifacts (
  artifact_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  revision_id VARCHAR(128) NOT NULL,
  generation_job_id VARCHAR(128) NOT NULL,
  artifact_target VARCHAR(32) NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL,
  manifest_object_id VARCHAR(128) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (artifact_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (artifact_target IN ('terraform', 'diagram', 'combined')),
  CHECK (lifecycle_status IN ('publication-pending', 'ready-to-review', 'verified', 'failed')),
  CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  UNIQUE (organization_id, project_id, artifact_id),
  UNIQUE (organization_id, project_id, generation_job_id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, project_id, manifest_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id, revision_id)
    REFERENCES architecture_revisions(organization_id, project_id, revision_id),
  FOREIGN KEY (organization_id, project_id, generation_job_id)
    REFERENCES generation_jobs(organization_id, project_id, generation_job_id)
);

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_artifact_fk
  FOREIGN KEY (organization_id, project_id, artifact_id)
  REFERENCES artifacts(organization_id, project_id, artifact_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE artifact_files (
  artifact_file_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  artifact_id VARCHAR(128) NOT NULL,
  object_id VARCHAR(128) NOT NULL,
  path VARCHAR(512) NOT NULL,
  media_type VARCHAR(128) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (artifact_file_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (length(path) BETWEEN 1 AND 512),
  CHECK (path !~ '(^|/)\.\.(/|$)'),
  CHECK (length(media_type) BETWEEN 1 AND 128),
  CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (size_bytes >= 0),
  UNIQUE (organization_id, project_id, artifact_id, artifact_file_id),
  UNIQUE (artifact_id, path),
  FOREIGN KEY (organization_id, project_id, artifact_id)
    REFERENCES artifacts(organization_id, project_id, artifact_id),
  FOREIGN KEY (organization_id, project_id, object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id)
);

CREATE TABLE project_integrations (
  integration_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  integration_kind VARCHAR(32) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL,
  external_account_reference VARCHAR(255),
  credential_secret_reference VARCHAR(512),
  record_version BIGINT NOT NULL DEFAULT 1,
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (integration_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (integration_kind = 'github'),
  CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  CHECK (lifecycle_status IN ('connected', 'reauthorization-required', 'disabled')),
  CHECK (external_account_reference IS NULL OR length(external_account_reference) BETWEEN 1 AND 255),
  CHECK (credential_secret_reference IS NULL OR credential_secret_reference ~ '^secretref:[A-Za-z0-9._:/+-]{1,500}$'),
  CHECK (record_version > 0),
  UNIQUE (organization_id, project_id, integration_id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id)
);

CREATE TABLE export_jobs (
  export_job_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  artifact_id VARCHAR(128) NOT NULL,
  integration_id VARCHAR(128),
  export_kind VARCHAR(32) NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'queued',
  request_sha256 CHAR(64) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  safe_failure_code VARCHAR(128),
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK (export_job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (export_kind IN ('zip', 'github')),
  CHECK ((export_kind = 'zip' AND integration_id IS NULL) OR (export_kind = 'github' AND integration_id IS NOT NULL)),
  CHECK (lifecycle_status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  UNIQUE (organization_id, project_id, export_job_id),
  UNIQUE (organization_id, project_id, idempotency_key_sha256),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, project_id, artifact_id)
    REFERENCES artifacts(organization_id, project_id, artifact_id),
  FOREIGN KEY (organization_id, project_id, integration_id)
    REFERENCES project_integrations(organization_id, project_id, integration_id)
);

CREATE TABLE audit_events (
  audit_event_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  actor_principal_id VARCHAR(128) REFERENCES principals(principal_id),
  action VARCHAR(128) NOT NULL,
  target_kind VARCHAR(32) NOT NULL,
  target_id VARCHAR(128),
  outcome VARCHAR(32) NOT NULL,
  safe_summary VARCHAR(300) NOT NULL,
  correlation_id VARCHAR(128) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (audit_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (action ~ '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$'),
  CHECK (target_kind IN ('organization', 'membership', 'project', 'draft', 'revision', 'artifact', 'integration', 'job')),
  CHECK (outcome IN ('succeeded', 'denied', 'failed')),
  CHECK (length(btrim(safe_summary)) BETWEEN 1 AND 300),
  CHECK (length(correlation_id) BETWEEN 1 AND 128)
);

CREATE TRIGGER audit_events_are_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE INDEX validation_runs_project_created_idx
  ON validation_runs (organization_id, project_id, created_at DESC, validation_run_id);

CREATE INDEX generation_jobs_project_created_idx
  ON generation_jobs (organization_id, project_id, created_at DESC, generation_job_id);

CREATE INDEX export_jobs_project_created_idx
  ON export_jobs (organization_id, project_id, created_at DESC, export_job_id);

CREATE INDEX audit_events_organization_occurred_idx
  ON audit_events (organization_id, occurred_at DESC, audit_event_id);
