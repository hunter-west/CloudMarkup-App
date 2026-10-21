ALTER TABLE github_app_installations
  ADD CONSTRAINT github_app_installations_identity_pair_unique
  UNIQUE (integration_id, installation_id);

CREATE TABLE github_app_installation_link_intents (
  intent_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  state_sha256 VARCHAR(71) NOT NULL UNIQUE,
  lifecycle_status VARCHAR(16) NOT NULL,
  completed_integration_id VARCHAR(128),
  completed_installation_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK (intent_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (state_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (lifecycle_status IN ('pending', 'consumed', 'completed')),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= consumed_at),
  CHECK (
    (lifecycle_status = 'pending'
      AND consumed_at IS NULL
      AND completed_at IS NULL
      AND completed_integration_id IS NULL
      AND completed_installation_id IS NULL)
    OR
    (lifecycle_status = 'consumed'
      AND consumed_at IS NOT NULL
      AND completed_at IS NULL
      AND completed_integration_id IS NULL
      AND completed_installation_id IS NULL)
    OR
    (lifecycle_status = 'completed'
      AND consumed_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND completed_integration_id IS NOT NULL
      AND completed_installation_id IS NOT NULL)
  ),
  FOREIGN KEY (completed_integration_id, completed_installation_id)
    REFERENCES github_app_installations(integration_id, installation_id)
);

COMMENT ON TABLE github_app_installation_link_intents IS
  'Short-lived one-time GitHub App installation link state. Only a SHA-256 state digest is stored; raw state and callback receipts are never persisted.';

CREATE INDEX github_app_installation_link_intents_expiry_idx
  ON github_app_installation_link_intents (
    lifecycle_status,
    expires_at,
    organization_id
  );
