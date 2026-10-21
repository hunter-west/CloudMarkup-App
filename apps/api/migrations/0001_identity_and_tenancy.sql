CREATE TABLE IF NOT EXISTS cloudmarkup_schema_migrations (
  version VARCHAR(128) PRIMARY KEY,
  checksum_sha256 CHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE principals (
  principal_id VARCHAR(128) PRIMARY KEY,
  application_record_version SMALLINT NOT NULL DEFAULT 1,
  display_name VARCHAR(120) NOT NULL,
  email VARCHAR(320),
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (principal_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (application_record_version = 1),
  CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  CHECK (lifecycle_status IN ('active', 'suspended'))
);

CREATE TABLE principal_identity_references (
  identity_reference_id VARCHAR(128) PRIMARY KEY,
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  identity_provider VARCHAR(64) NOT NULL,
  issuer VARCHAR(512) NOT NULL,
  subject_reference VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (identity_reference_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (identity_provider ~ '^[a-z][a-z0-9-]{0,63}$'),
  CHECK (length(btrim(issuer)) BETWEEN 1 AND 512),
  CHECK (length(btrim(subject_reference)) BETWEEN 1 AND 255),
  UNIQUE (identity_provider, issuer, subject_reference)
);

CREATE TABLE user_presentation_preferences (
  principal_id VARCHAR(128) PRIMARY KEY REFERENCES principals(principal_id),
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  experience_mode VARCHAR(32) NOT NULL,
  contextual_learning_enabled BOOLEAN NOT NULL,
  sync_version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (storage_contract_version = 1),
  CHECK (experience_mode IN ('guided', 'professional')),
  CHECK (sync_version > 0)
);

COMMENT ON TABLE user_presentation_preferences IS
  'Actor-owned synchronized presentation preferences only; never Architecture Document or transient editor state.';

CREATE TABLE organizations (
  organization_id VARCHAR(128) PRIMARY KEY,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  display_name VARCHAR(120) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'active',
  record_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (organization_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (lifecycle_status IN ('active', 'suspended')),
  CHECK (record_version > 0)
);

CREATE TABLE organization_roles (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  role_key VARCHAR(64) NOT NULL,
  policy_version VARCHAR(64) NOT NULL,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, role_key),
  CHECK (role_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  CHECK (policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  CHECK (cardinality(capabilities) <= 128)
);

COMMENT ON TABLE organization_roles IS
  'Versioned role storage; Prompt 21 does not finalize the product permission matrix.';

CREATE TABLE memberships (
  membership_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  role_key VARCHAR(64) NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'active',
  record_version BIGINT NOT NULL DEFAULT 1,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (membership_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (lifecycle_status IN ('active', 'suspended')),
  CHECK (record_version > 0),
  UNIQUE (organization_id, membership_id),
  UNIQUE (organization_id, principal_id),
  FOREIGN KEY (organization_id, role_key)
    REFERENCES organization_roles(organization_id, role_key)
);

CREATE INDEX memberships_principal_status_idx
  ON memberships (principal_id, lifecycle_status, organization_id);
