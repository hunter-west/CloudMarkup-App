CREATE TABLE github_repository_imports (
  import_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  integration_id VARCHAR(128) NOT NULL,
  repository_id BIGINT NOT NULL,
  repository_owner VARCHAR(100) NOT NULL,
  repository_name VARCHAR(100) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  previous_import_id VARCHAR(128),
  trigger_kind VARCHAR(16) NOT NULL,
  branch_name VARCHAR(255) NOT NULL,
  commit_sha VARCHAR(64) NOT NULL,
  branch_head_sha VARCHAR(64) NOT NULL,
  snapshot_id VARCHAR(128) NOT NULL,
  snapshot_sha256 VARCHAR(71),
  idempotency_key_sha256 VARCHAR(71) NOT NULL,
  selected_paths_json JSONB NOT NULL,
  ignored_paths_json JSONB NOT NULL,
  safe_result_json JSONB,
  import_attempt_id VARCHAR(128) NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL,
  failure_code VARCHAR(64),
  record_version BIGINT NOT NULL DEFAULT 1,
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CHECK (import_id ~ '^githubimport_[A-Za-z0-9-]{1,115}$'),
  CHECK (storage_contract_version = 1),
  CHECK (repository_id BETWEEN 1 AND 9007199254740991),
  CHECK (length(btrim(repository_owner)) BETWEEN 1 AND 100),
  CHECK (length(btrim(repository_name)) BETWEEN 1 AND 100),
  CHECK (trigger_kind IN ('manual', 'webhook')),
  CHECK (length(btrim(branch_name)) BETWEEN 1 AND 255),
  CHECK (
    branch_name !~ '[[:cntrl:] ~^:?*]'
    AND position(chr(92) IN branch_name) = 0
    AND position('[' IN branch_name) = 0
  ),
  CHECK (commit_sha ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  CHECK (branch_head_sha ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  CHECK (snapshot_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (snapshot_sha256 IS NULL OR snapshot_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (idempotency_key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(selected_paths_json) = 'array'),
  CHECK (jsonb_array_length(selected_paths_json) BETWEEN 1 AND 128),
  CHECK (jsonb_typeof(ignored_paths_json) = 'array'),
  CHECK (jsonb_array_length(ignored_paths_json) <= 128),
  CHECK (safe_result_json IS NULL OR jsonb_typeof(safe_result_json) = 'object'),
  CHECK (import_attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (lifecycle_status IN (
    'running',
    'succeeded',
    'failed-transient',
    'failed-permanent'
  )),
  CHECK (failure_code IS NULL OR failure_code IN (
    'authorization-denied',
    'github-permission-denied',
    'import-blocked',
    'import-in-progress',
    'installation-revoked',
    'integration-not-found',
    'invalid-request',
    'rate-limited',
    'repository-changed',
    'repository-not-found',
    'service-unavailable',
    'ungrounded-claim'
  )),
  CHECK (record_version > 0),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (
    (lifecycle_status = 'succeeded') =
    (safe_result_json IS NOT NULL AND snapshot_sha256 IS NOT NULL)
  ),
  CHECK (
    (lifecycle_status IN ('failed-transient', 'failed-permanent')) =
    (failure_code IS NOT NULL)
  ),
  CHECK ((lifecycle_status = 'succeeded') = (completed_at IS NOT NULL)),
  UNIQUE (organization_id, project_id, import_id),
  UNIQUE (organization_id, project_id, idempotency_key_sha256),
  UNIQUE (organization_id, project_id, snapshot_id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, integration_id, repository_id)
    REFERENCES github_app_repositories(
      organization_id, integration_id, repository_id
    ),
  FOREIGN KEY (organization_id, project_id, previous_import_id)
    REFERENCES github_repository_imports(
      organization_id, project_id, import_id
    )
);

COMMENT ON TABLE github_repository_imports IS
  'Tenant-scoped exact-commit import job metadata and safe deterministic result. GitHub tokens and raw private repository bytes are never stored here; canonical Snapshot, Observed, Proposal, Issue, and Evidence payloads remain immutable solution records.';

CREATE INDEX github_repository_imports_history_idx
  ON github_repository_imports (
    organization_id,
    project_id,
    repository_id,
    created_at DESC,
    import_id
  );

CREATE FUNCTION guard_github_repository_import_update()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW.import_id,
    NEW.organization_id,
    NEW.project_id,
    NEW.integration_id,
    NEW.repository_id,
    NEW.repository_owner,
    NEW.repository_name,
    NEW.storage_contract_version,
    NEW.previous_import_id,
    NEW.trigger_kind,
    NEW.branch_name,
    NEW.commit_sha,
    NEW.snapshot_id,
    NEW.idempotency_key_sha256,
    NEW.selected_paths_json,
    NEW.ignored_paths_json,
    NEW.created_by_principal_id,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.import_id,
    OLD.organization_id,
    OLD.project_id,
    OLD.integration_id,
    OLD.repository_id,
    OLD.repository_owner,
    OLD.repository_name,
    OLD.storage_contract_version,
    OLD.previous_import_id,
    OLD.trigger_kind,
    OLD.branch_name,
    OLD.commit_sha,
    OLD.snapshot_id,
    OLD.idempotency_key_sha256,
    OLD.selected_paths_json,
    OLD.ignored_paths_json,
    OLD.created_by_principal_id,
    OLD.created_at
  ) OR NEW.record_version <> OLD.record_version + 1 THEN
    RAISE EXCEPTION 'github repository import binding is immutable';
  END IF;

  IF OLD.lifecycle_status IN ('succeeded', 'failed-permanent') THEN
    RAISE EXCEPTION 'terminal github repository import is immutable';
  END IF;

  IF OLD.lifecycle_status = 'running'
     AND NEW.import_attempt_id <> OLD.import_attempt_id THEN
    RAISE EXCEPTION 'running github repository import attempt is immutable';
  END IF;

  IF OLD.lifecycle_status = 'failed-transient'
     AND (
       NEW.lifecycle_status <> 'running'
       OR NEW.import_attempt_id = OLD.import_attempt_id
     ) THEN
    RAISE EXCEPTION 'transient github repository import reclaim is invalid';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER github_repository_import_updates_are_guarded
BEFORE UPDATE ON github_repository_imports
FOR EACH ROW EXECUTE FUNCTION guard_github_repository_import_update();


CREATE TABLE github_repository_import_progress_events (
  progress_event_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  import_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  stage VARCHAR(32) NOT NULL,
  lifecycle_status VARCHAR(16) NOT NULL,
  safe_message VARCHAR(300) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  CHECK (progress_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (stage IN (
    'authorization',
    'acquisition',
    'deterministic-import',
    'interpretation',
    'persistence',
    'complete'
  )),
  CHECK (lifecycle_status IN ('failed', 'running', 'succeeded')),
  CHECK (length(btrim(safe_message)) BETWEEN 1 AND 300),
  FOREIGN KEY (organization_id, project_id, import_id)
    REFERENCES github_repository_imports(
      organization_id, project_id, import_id
    )
);

CREATE TRIGGER github_repository_import_progress_events_are_immutable
BEFORE UPDATE OR DELETE ON github_repository_import_progress_events
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE INDEX github_repository_import_progress_events_project_idx
  ON github_repository_import_progress_events (
    organization_id,
    project_id,
    occurred_at DESC,
    progress_event_id
  );

CREATE TABLE github_repository_import_reviews (
  review_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  import_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  operation_id VARCHAR(128) NOT NULL,
  decision VARCHAR(32) NOT NULL,
  snapshot_sha256 VARCHAR(71) NOT NULL,
  reason VARCHAR(1000),
  receipt_id VARCHAR(128) NOT NULL,
  design_changed BOOLEAN NOT NULL,
  idempotency_key_sha256 VARCHAR(71) NOT NULL,
  reviewed_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  reviewed_at TIMESTAMPTZ NOT NULL,
  CHECK (review_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (decision IN (
    'accept-into-design',
    'keep-observed',
    'mark-external',
    'regenerate',
    'ignore',
    'reject'
  )),
  CHECK (snapshot_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
  CHECK (receipt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (decision <> 'ignore' OR reason IS NOT NULL),
  CHECK (design_changed = (decision = 'accept-into-design')),
  CHECK (idempotency_key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  UNIQUE (organization_id, project_id, idempotency_key_sha256),
  UNIQUE (organization_id, project_id, import_id, operation_id, decision),
  FOREIGN KEY (organization_id, project_id, import_id)
    REFERENCES github_repository_imports(
      organization_id, project_id, import_id
    )
);

CREATE TRIGGER github_repository_import_reviews_are_immutable
BEFORE UPDATE OR DELETE ON github_repository_import_reviews
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE github_repository_import_refresh_subscriptions (
  subscription_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  integration_id VARCHAR(128) NOT NULL,
  repository_id BIGINT NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  branch_name VARCHAR(255) NOT NULL,
  event_name VARCHAR(16) NOT NULL,
  selected_paths_json JSONB NOT NULL,
  ignored_paths_json JSONB NOT NULL,
  enabled BOOLEAN NOT NULL,
  idempotency_key_sha256 VARCHAR(71) NOT NULL,
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (subscription_id ~ '^githubrefresh_[A-Za-z0-9-]{1,114}$'),
  CHECK (storage_contract_version = 1),
  CHECK (repository_id BETWEEN 1 AND 9007199254740991),
  CHECK (length(btrim(branch_name)) BETWEEN 1 AND 255),
  CHECK (event_name = 'push'),
  CHECK (jsonb_typeof(selected_paths_json) = 'array'),
  CHECK (jsonb_array_length(selected_paths_json) BETWEEN 1 AND 128),
  CHECK (jsonb_typeof(ignored_paths_json) = 'array'),
  CHECK (jsonb_array_length(ignored_paths_json) <= 128),
  CHECK (idempotency_key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  UNIQUE (organization_id, project_id, subscription_id),
  UNIQUE (organization_id, project_id, idempotency_key_sha256),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, integration_id, repository_id)
    REFERENCES github_app_repositories(
      organization_id, integration_id, repository_id
    )
);

CREATE INDEX github_repository_import_refresh_target_history_idx
  ON github_repository_import_refresh_subscriptions (
    organization_id,
    project_id,
    integration_id,
    repository_id,
    branch_name,
    event_name,
    created_at DESC,
    subscription_id DESC
  );

CREATE TRIGGER github_repository_import_refresh_subscriptions_are_immutable
BEFORE UPDATE OR DELETE ON github_repository_import_refresh_subscriptions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE github_repository_import_webhook_receipts (
  delivery_id VARCHAR(128) NOT NULL,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  subscription_id VARCHAR(128) NOT NULL,
  import_id VARCHAR(128),
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  commit_sha VARCHAR(64) NOT NULL,
  lifecycle_status VARCHAR(16) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (delivery_id, subscription_id),
  CHECK (storage_contract_version = 1),
  CHECK (commit_sha ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  CHECK (lifecycle_status IN ('queued', 'processed', 'ignored', 'failed')),
  FOREIGN KEY (delivery_id)
    REFERENCES github_webhook_deliveries(delivery_id),
  FOREIGN KEY (organization_id, project_id, subscription_id)
    REFERENCES github_repository_import_refresh_subscriptions(
      organization_id, project_id, subscription_id
    ),
  FOREIGN KEY (organization_id, project_id, import_id)
    REFERENCES github_repository_imports(
      organization_id, project_id, import_id
    )
);

CREATE TRIGGER github_repository_import_webhook_receipts_are_immutable
BEFORE UPDATE OR DELETE ON github_repository_import_webhook_receipts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE INDEX github_repository_import_webhook_receipts_project_idx
  ON github_repository_import_webhook_receipts (
    organization_id,
    project_id,
    recorded_at DESC,
    delivery_id
  );
