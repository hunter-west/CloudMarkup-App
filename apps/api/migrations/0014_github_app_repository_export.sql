ALTER TABLE solution_export_artifact_files
  DROP CONSTRAINT solution_export_artifact_files_media_type_check,
  ADD CONSTRAINT solution_export_artifact_files_media_type_check CHECK (
    media_type IN (
      'application/json',
      'application/pdf',
      'application/vnd.cyclonedx+json',
      'application/vnd.hashicorp.terraform',
      'application/yaml',
      'application/zip',
      'image/png',
      'image/svg+xml',
      'text/markdown',
      'text/plain',
      'text/typescript'
    )
  );
CREATE TABLE github_app_installations (
  integration_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  installation_id BIGINT NOT NULL UNIQUE,
  account_id BIGINT NOT NULL,
  account_login VARCHAR(100) NOT NULL,
  account_type VARCHAR(32) NOT NULL,
  repository_selection VARCHAR(16) NOT NULL,
  contents_permission VARCHAR(8) NOT NULL,
  metadata_permission VARCHAR(8) NOT NULL,
  pull_requests_permission VARCHAR(8) NOT NULL,
  workflows_permission VARCHAR(8) NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL,
  record_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (integration_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (installation_id BETWEEN 1 AND 9007199254740991),
  CHECK (account_id BETWEEN 1 AND 9007199254740991),
  CHECK (account_login ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  CHECK (account_type IN ('Organization', 'User')),
  CHECK (repository_selection IN ('all', 'selected')),
  CHECK (contents_permission IN ('none', 'read', 'write')),
  CHECK (metadata_permission IN ('none', 'read', 'write')),
  CHECK (pull_requests_permission IN ('none', 'read', 'write')),
  CHECK (workflows_permission IN ('none', 'read', 'write')),
  CHECK (metadata_permission IN ('read', 'write')),
  CHECK (lifecycle_status IN (
    'connected',
    'reauthorization-required',
    'suspended',
    'deleted'
  )),
  CHECK (record_version > 0),
  UNIQUE (organization_id, integration_id)
);

COMMENT ON TABLE github_app_installations IS
  'Organization-authorized GitHub App installation metadata only. App private keys, webhook secrets, and installation tokens are never stored here.';

CREATE TABLE github_app_repositories (
  organization_id VARCHAR(128) NOT NULL,
  integration_id VARCHAR(128) NOT NULL,
  installation_id BIGINT NOT NULL,
  repository_id BIGINT NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  node_id VARCHAR(255) NOT NULL,
  owner_login VARCHAR(100) NOT NULL,
  repository_name VARCHAR(100) NOT NULL,
  default_branch VARCHAR(255) NOT NULL,
  is_private BOOLEAN NOT NULL,
  is_archived BOOLEAN NOT NULL,
  is_disabled BOOLEAN NOT NULL,
  lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'active',
  pushed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, integration_id, repository_id),
  CHECK (storage_contract_version = 1),
  CHECK (installation_id BETWEEN 1 AND 9007199254740991),
  CHECK (repository_id BETWEEN 1 AND 9007199254740991),
  CHECK (length(node_id) BETWEEN 1 AND 255),
  CHECK (owner_login ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  CHECK (repository_name ~ '^[A-Za-z0-9._-]{1,100}$'),
  CHECK (length(btrim(default_branch)) BETWEEN 1 AND 255),
  CHECK (
    default_branch !~ '[[:cntrl:] ~^:?*]'
    AND position(chr(92) IN default_branch) = 0
    AND position('[' IN default_branch) = 0
  ),
  CHECK (lifecycle_status IN ('active', 'deleted', 'transferred')),
  FOREIGN KEY (organization_id, integration_id)
    REFERENCES github_app_installations(organization_id, integration_id),
  FOREIGN KEY (installation_id)
    REFERENCES github_app_installations(installation_id)
);

CREATE INDEX github_app_repositories_installation_lookup_idx
  ON github_app_repositories (
    installation_id,
    lifecycle_status,
    owner_login,
    repository_name
  );

CREATE TABLE github_webhook_deliveries (
  delivery_id VARCHAR(128) PRIMARY KEY,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  event_name VARCHAR(64) NOT NULL,
  payload_sha256 VARCHAR(71) NOT NULL,
  lifecycle_status VARCHAR(16) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  replay_expires_at TIMESTAMPTZ NOT NULL,
  CHECK (delivery_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (event_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  CHECK (payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (lifecycle_status IN ('received', 'processed', 'ignored', 'failed')),
  CHECK (processed_at IS NULL OR processed_at >= received_at),
  CHECK (replay_expires_at > received_at)
);

COMMENT ON TABLE github_webhook_deliveries IS
  'Replay and idempotency evidence only. Raw webhook bodies and signatures are never persisted.';

CREATE INDEX github_webhook_deliveries_replay_expiry_idx
  ON github_webhook_deliveries (replay_expires_at, delivery_id);

CREATE TABLE github_repository_export_previews (
  preview_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  integration_id VARCHAR(128) NOT NULL,
  repository_id BIGINT NOT NULL,
  solution_export_artifact_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  artifact_sha256 VARCHAR(71) NOT NULL,
  base_commit_sha VARCHAR(64) NOT NULL,
  snapshot_sha256 VARCHAR(71) NOT NULL,
  preview_sha256 VARCHAR(71) NOT NULL,
  request_json JSONB NOT NULL,
  preview_json JSONB NOT NULL,
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (preview_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (repository_id BETWEEN 1 AND 9007199254740991),
  CHECK (artifact_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (base_commit_sha ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  CHECK (snapshot_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (preview_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(request_json) = 'object'),
  CHECK (jsonb_typeof(preview_json) = 'object'),
  CHECK (expires_at > created_at),
  UNIQUE (organization_id, project_id, preview_id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, integration_id, repository_id)
    REFERENCES github_app_repositories(
      organization_id, integration_id, repository_id
    ),
  FOREIGN KEY (
    organization_id,
    project_id,
    solution_export_artifact_id
  ) REFERENCES solution_export_artifacts(
    organization_id, project_id, solution_export_artifact_id
  )
);

CREATE INDEX github_repository_export_previews_project_created_idx
  ON github_repository_export_previews (
    organization_id,
    project_id,
    created_at DESC,
    preview_id
  );

CREATE TABLE github_repository_export_executions (
  execution_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  preview_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  idempotency_key_sha256 VARCHAR(71) NOT NULL,
  artifact_sha256 VARCHAR(71) NOT NULL,
  preview_sha256 VARCHAR(71) NOT NULL,
  execution_attempt_id VARCHAR(128) NOT NULL,
  record_version BIGINT NOT NULL DEFAULT 1,
  lifecycle_status VARCHAR(32) NOT NULL,
  failure_code VARCHAR(64),
  branch_created BOOLEAN NOT NULL DEFAULT FALSE,
  commit_sha VARCHAR(64),
  receipt_json JSONB,
  authority_json JSONB,
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (execution_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (idempotency_key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (artifact_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (preview_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (execution_attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (record_version > 0),
  CHECK (lifecycle_status IN (
    'running',
    'succeeded',
    'failed-transient',
    'failed-permanent'
  )),
  CHECK (failure_code IS NULL OR failure_code IN (
    'authorization-denied',
    'artifact-invalid',
    'branch-conflict',
    'destination-invalid',
    'export-in-progress',
    'github-permission-denied',
    'installation-link-expired',
    'installation-link-invalid',
    'installation-link-replayed',
    'installation-revoked',
    'integration-not-found',
    'invalid-request',
    'path-conflict',
    'preview-blocked',
    'preview-expired',
    'public-repository-workflow-denied',
    'rate-limited',
    'repository-changed',
    'repository-not-found',
    'secret-unavailable',
    'service-unavailable',
    'webhook-invalid',
    'webhook-replayed',
    'workflow-confirmation-required'
  )),
  CHECK (commit_sha IS NULL OR commit_sha ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  CHECK (receipt_json IS NULL OR jsonb_typeof(receipt_json) = 'object'),
  CHECK (authority_json IS NULL OR jsonb_typeof(authority_json) = 'object'),
  CHECK ((lifecycle_status = 'succeeded') = (receipt_json IS NOT NULL)),
  CHECK ((lifecycle_status = 'succeeded') = (authority_json IS NOT NULL)),
  CHECK (
    (lifecycle_status IN ('failed-transient', 'failed-permanent')) =
    (failure_code IS NOT NULL)
  ),
  CHECK (receipt_json IS NULL OR commit_sha IS NOT NULL),
  CHECK (lifecycle_status <> 'succeeded' OR branch_created),
  CHECK (NOT branch_created OR commit_sha IS NOT NULL OR lifecycle_status <> 'succeeded'),
  UNIQUE (organization_id, project_id, execution_id),
  UNIQUE (organization_id, project_id, idempotency_key_sha256),
  FOREIGN KEY (organization_id, project_id, preview_id)
    REFERENCES github_repository_export_previews(
      organization_id, project_id, preview_id
    )
);

CREATE INDEX github_repository_export_executions_preview_idx
  ON github_repository_export_executions (
    organization_id,
    project_id,
    preview_id,
    created_at DESC
  );

CREATE INDEX github_repository_export_executions_authority_target_idx
  ON github_repository_export_executions (
    organization_id,
    project_id,
    ((authority_json ->> 'integrationId')),
    ((authority_json ->> 'repositoryId')),
    ((authority_json ->> 'repositoryOwnerId')),
    ((authority_json ->> 'baseBranch')),
    ((authority_json ->> 'destinationFolder')),
    ((authority_json ->> 'completedAt')) DESC,
    execution_id DESC
  )
  WHERE lifecycle_status = 'succeeded' AND authority_json IS NOT NULL;

CREATE FUNCTION guard_github_repository_export_execution_update()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW.execution_id,
    NEW.organization_id,
    NEW.project_id,
    NEW.preview_id,
    NEW.storage_contract_version,
    NEW.idempotency_key_sha256,
    NEW.artifact_sha256,
    NEW.preview_sha256,
    NEW.created_by_principal_id,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.execution_id,
    OLD.organization_id,
    OLD.project_id,
    OLD.preview_id,
    OLD.storage_contract_version,
    OLD.idempotency_key_sha256,
    OLD.artifact_sha256,
    OLD.preview_sha256,
    OLD.created_by_principal_id,
    OLD.created_at
  ) OR NEW.record_version <> OLD.record_version + 1 THEN
    RAISE EXCEPTION 'github repository export execution binding is immutable';
  END IF;

  IF OLD.lifecycle_status IN ('succeeded', 'failed-permanent')
     OR OLD.authority_json IS NOT NULL THEN
    RAISE EXCEPTION 'terminal github repository export execution is immutable';
  END IF;

  IF OLD.lifecycle_status = 'running'
     AND NEW.execution_attempt_id <> OLD.execution_attempt_id THEN
    RAISE EXCEPTION 'running github repository export attempt is immutable';
  END IF;

  IF OLD.lifecycle_status = 'failed-transient'
     AND (
       NEW.lifecycle_status <> 'running'
       OR NEW.execution_attempt_id = OLD.execution_attempt_id
     ) THEN
    RAISE EXCEPTION 'transient github repository export reclaim is invalid';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER github_repository_export_execution_updates_are_guarded
BEFORE UPDATE ON github_repository_export_executions
FOR EACH ROW EXECUTE FUNCTION guard_github_repository_export_execution_update();

CREATE TABLE github_repository_export_progress_events (
  progress_event_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  project_id VARCHAR(128),
  execution_id VARCHAR(128),
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  stage VARCHAR(32) NOT NULL,
  lifecycle_status VARCHAR(16) NOT NULL,
  safe_message VARCHAR(300) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  CHECK (progress_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (stage IN (
    'authorization',
    'discovery',
    'preview',
    'stale-check',
    'branch',
    'commit',
    'pull-request',
    'complete'
  )),
  CHECK (lifecycle_status IN ('failed', 'running', 'succeeded')),
  CHECK (length(btrim(safe_message)) BETWEEN 1 AND 300),
  CHECK (execution_id IS NULL OR project_id IS NOT NULL),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, project_id, execution_id)
    REFERENCES github_repository_export_executions(
      organization_id, project_id, execution_id
    )
);

CREATE TRIGGER github_repository_export_progress_events_are_immutable
BEFORE UPDATE OR DELETE ON github_repository_export_progress_events
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE INDEX github_repository_export_progress_events_project_idx
  ON github_repository_export_progress_events (
    organization_id,
    project_id,
    occurred_at DESC,
    progress_event_id
  );
ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_target_kind_v2_check,
  ADD CONSTRAINT audit_events_target_kind_check CHECK (
    target_kind IN (
      'organization',
      'membership',
      'project',
      'draft',
      'revision',
      'artifact',
      'integration',
      'installation',
      'repository',
      'preview',
      'webhook',
      'export',
      'job'
    )
  );
