-- Prompt 24A owns the canonical commercial lineage reserved by migration 0004.
-- Version-0 rows were never valid product data, so their presence is a hard
-- migration error rather than an invitation to guess a conversion.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM organization_entitlement_snapshots)
     OR EXISTS (SELECT 1 FROM usage_ledger_entries) THEN
    RAISE EXCEPTION 'commercial placeholder rows must be empty before version 1'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Migration 0004 used automatically named checks. Resolve those names through
-- the catalog because the entitlement-table name exceeds PostgreSQL's
-- 63-byte identifier limit and must not be guessed.
DO $$
DECLARE
  candidate_count INTEGER;
  constraint_name TEXT;
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organization_entitlement_snapshots',
    'usage_ledger_entries'
  ] LOOP
    SELECT COUNT(*), MIN(c.conname)
    INTO candidate_count, constraint_name
    FROM pg_constraint c
    WHERE c.conrelid = table_name::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%storage_contract_version%0%';

    IF candidate_count <> 1 OR constraint_name IS NULL THEN
      RAISE EXCEPTION
        'expected exactly one commercial storage-version-0 check on %',
        table_name
        USING ERRCODE = '55000';
    END IF;

    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT %I',
      table_name,
      constraint_name
    );
  END LOOP;
END;
$$;

CREATE FUNCTION cloudmarkup_authorization_v2_permissions(role_key TEXT)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT CASE role_key
    WHEN 'viewer' THEN ARRAY[
      'organizations.read', 'projects.read', 'artifacts.read',
      'commercial.summary.read'
    ]::TEXT[]
    WHEN 'editor' THEN ARRAY[
      'organizations.read', 'projects.read', 'artifacts.read',
      'commercial.summary.read', 'projects.create', 'projects.mutate',
      'environments.create', 'revisions.create', 'validation.run',
      'generation.run', 'exports.run', 'commercial.expensive.use'
    ]::TEXT[]
    WHEN 'administrator' THEN ARRAY[
      'organizations.read', 'projects.read', 'artifacts.read',
      'commercial.summary.read', 'projects.create', 'projects.mutate',
      'environments.create', 'revisions.create', 'validation.run',
      'generation.run', 'exports.run', 'commercial.expensive.use',
      'memberships.read', 'memberships.manage', 'projects.delete',
      'integrations.read', 'integrations.manage', 'audit.read',
      'billing.manage', 'usage.read-technical'
    ]::TEXT[]
    WHEN 'owner' THEN ARRAY[
      'organizations.read', 'projects.read', 'artifacts.read',
      'commercial.summary.read', 'projects.create', 'projects.mutate',
      'environments.create', 'revisions.create', 'validation.run',
      'generation.run', 'exports.run', 'commercial.expensive.use',
      'memberships.read', 'memberships.manage', 'projects.delete',
      'integrations.read', 'integrations.manage', 'audit.read',
      'billing.manage', 'usage.read-technical',
      'memberships.assign-owner', 'organizations.delete'
    ]::TEXT[]
    ELSE NULL
  END
$$;

ALTER TABLE organization_roles
  DROP CONSTRAINT organization_roles_authorization_v1_canonical_check;

UPDATE organization_roles
SET policy_version = 'authorization-v2',
    capabilities = cloudmarkup_authorization_v2_permissions(role_key),
    updated_at = CURRENT_TIMESTAMP
WHERE role_key IN ('owner', 'administrator', 'editor', 'viewer');

ALTER TABLE organization_roles
  ADD CONSTRAINT organization_roles_authorization_v2_canonical_check
  CHECK (
    role_key NOT IN ('owner', 'administrator', 'editor', 'viewer')
    OR (
      policy_version = 'authorization-v2'
      AND is_owner = (role_key = 'owner')
      AND capabilities = cloudmarkup_authorization_v2_permissions(role_key)
    )
  );

COMMENT ON FUNCTION cloudmarkup_authorization_v2_permissions(TEXT) IS
  'Mirrors authorization-v2 role permissions for migration checks only; application policy remains the runtime authority.';

COMMENT ON TABLE organization_roles IS
  'Canonical roles use authorization-v2; administrative credit adjustment remains outside organization-role permissions.';

CREATE TABLE commercial_plan_definitions (
  plan_id VARCHAR(128) PRIMARY KEY,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  plan_key VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (plan_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (plan_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  CHECK (length(btrim(display_name)) BETWEEN 1 AND 120)
);

COMMENT ON TABLE commercial_plan_definitions IS
  'Provider-neutral commercial plan identities. Beta values are versioned examples, not contractual promises.';

CREATE TABLE commercial_plan_versions (
  plan_version_id VARCHAR(128) PRIMARY KEY,
  plan_id VARCHAR(128) NOT NULL REFERENCES commercial_plan_definitions(plan_id),
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  version_number BIGINT NOT NULL,
  configuration_version VARCHAR(128) NOT NULL,
  configuration_status VARCHAR(32) NOT NULL DEFAULT 'proposed-beta-example',
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  proposed_monthly_price_micros BIGINT NOT NULL,
  price_currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (plan_version_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (version_number > 0),
  CHECK (configuration_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (configuration_status IN ('proposed-beta-example', 'retired')),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  CHECK (proposed_monthly_price_micros >= 0),
  CHECK (price_currency ~ '^[A-Z]{3}$'),
  UNIQUE (plan_id, version_number),
  UNIQUE (plan_id, plan_version_id)
);

CREATE TABLE commercial_plan_feature_entitlements (
  plan_version_id VARCHAR(128) NOT NULL
    REFERENCES commercial_plan_versions(plan_version_id),
  feature_key VARCHAR(128) NOT NULL,
  entitlement_state VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_version_id, feature_key),
  CHECK (feature_key IN (
    'manual-editing', 'read-existing-projects', 'existing-artifact-access',
    'data-export', 'zip-export', 'diagram-export', 'github-export',
    'terraform', 'cloudformation', 'complete-application-generation',
    'validation-jobs', 'plan-evidence-workflows',
    'deployment-evidence-workflows', 'organization-roles', 'shared-projects',
    'audit-history', 'ai-assisted-operations'
  )),
  CHECK (entitlement_state IN ('enabled', 'limited', 'disabled', 'unavailable'))
);

CREATE TABLE commercial_plan_numeric_limits (
  plan_version_id VARCHAR(128) NOT NULL
    REFERENCES commercial_plan_versions(plan_version_id),
  limit_key VARCHAR(128) NOT NULL,
  limit_scope VARCHAR(32) NOT NULL,
  period_kind VARCHAR(32) NOT NULL DEFAULT 'none',
  limit_value BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_version_id, limit_key, limit_scope),
  CHECK (limit_key IN (
    'projects', 'active-members', 'active-owners', 'active-administrators',
    'active-editors', 'billable-seats', 'viewers', 'concurrent-ai-jobs',
    'per-user-request-count', 'per-project-credit-cap'
  )),
  CHECK (limit_scope IN ('organization', 'member', 'project')),
  CHECK (period_kind IN ('none', 'subscription-period', 'calendar-month', 'rolling-day')),
  CHECK (
    (limit_key = 'per-user-request-count' AND limit_scope = 'member')
    OR (limit_key = 'per-project-credit-cap' AND limit_scope = 'project')
    OR (limit_key NOT IN ('per-user-request-count', 'per-project-credit-cap')
      AND limit_scope = 'organization')
  ),
  CHECK (limit_value >= 0)
);

CREATE TABLE commercial_plan_included_credit_grants (
  plan_version_id VARCHAR(128) NOT NULL
    REFERENCES commercial_plan_versions(plan_version_id),
  grant_kind VARCHAR(32) NOT NULL,
  credit_units BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_version_id, grant_kind),
  CHECK (grant_kind IN ('one-time', 'monthly')),
  CHECK (credit_units > 0)
);

CREATE TABLE commercial_plan_seat_rules (
  plan_version_id VARCHAR(128) PRIMARY KEY
    REFERENCES commercial_plan_versions(plan_version_id),
  billable_role_keys TEXT[] NOT NULL,
  included_billable_seats BIGINT NOT NULL,
  maximum_billable_seats BIGINT NOT NULL,
  maximum_nonbillable_viewers BIGINT NOT NULL,
  additional_seat_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  additional_seat_monthly_price_micros BIGINT,
  additional_seat_price_currency CHAR(3),
  additional_seat_credit_units BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (billable_role_keys = ARRAY['owner', 'administrator', 'editor']::TEXT[]),
  CHECK (included_billable_seats >= 0),
  CHECK (maximum_billable_seats >= included_billable_seats),
  CHECK (maximum_nonbillable_viewers >= 0),
  CHECK (
    (additional_seat_monthly_price_micros IS NULL
      AND additional_seat_price_currency IS NULL
      AND additional_seat_credit_units IS NULL)
    OR
    (additional_seat_monthly_price_micros IS NOT NULL
      AND additional_seat_monthly_price_micros >= 0
      AND additional_seat_price_currency ~ '^[A-Z]{3}$'
      AND additional_seat_credit_units IS NOT NULL
      AND additional_seat_credit_units >= 0)
  ),
  CHECK (NOT additional_seat_enabled OR additional_seat_monthly_price_micros IS NOT NULL)
);

CREATE TABLE organization_billing_accounts (
  billing_account_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL UNIQUE REFERENCES organizations(organization_id),
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'active',
  expensive_operations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  record_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (billing_account_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (lifecycle_status IN ('active', 'suspended', 'closed')),
  CHECK (
    lifecycle_status = 'active'
    OR expensive_operations_enabled = FALSE
  ),
  CHECK (record_version > 0),
  UNIQUE (organization_id, billing_account_id)
);

COMMENT ON COLUMN organization_billing_accounts.expensive_operations_enabled IS
  'Commercial kill switch for new expensive operations; it does not revoke ordinary project or artifact reads.';

CREATE TABLE organization_subscription_projections (
  subscription_projection_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  billing_account_id VARCHAR(128) NOT NULL UNIQUE,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  billing_provider VARCHAR(64) NOT NULL,
  provider_customer_reference VARCHAR(255) NOT NULL,
  provider_subscription_reference VARCHAR(255) NOT NULL,
  provider_product_reference VARCHAR(255),
  provider_price_reference VARCHAR(255),
  last_provider_event_reference VARCHAR(255),
  provider_event_position VARCHAR(255),
  normalized_status VARCHAR(32) NOT NULL,
  plan_version_id VARCHAR(128) NOT NULL
    REFERENCES commercial_plan_versions(plan_version_id),
  billable_seat_quantity BIGINT NOT NULL,
  current_period_id VARCHAR(128),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  effective_at TIMESTAMPTZ NOT NULL,
  record_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (subscription_projection_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (billing_provider ~ '^[a-z][a-z0-9-]{0,63}$'),
  CHECK (length(provider_customer_reference) BETWEEN 1 AND 255),
  CHECK (length(provider_subscription_reference) BETWEEN 1 AND 255),
  CHECK (normalized_status IN (
    'pending', 'active', 'past-due', 'paused', 'canceled', 'incomplete'
  )),
  CHECK (billable_seat_quantity >= 0),
  CHECK (current_period_id IS NULL
    OR current_period_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (
    (current_period_id IS NULL
      AND current_period_start IS NULL AND current_period_end IS NULL)
    OR
    (current_period_id IS NOT NULL AND current_period_start IS NOT NULL
      AND current_period_end > current_period_start)
  ),
  CHECK (record_version > 0),
  UNIQUE (organization_id, subscription_projection_id),
  UNIQUE (billing_provider, provider_customer_reference),
  UNIQUE (billing_provider, provider_subscription_reference),
  FOREIGN KEY (organization_id, billing_account_id)
    REFERENCES organization_billing_accounts(organization_id, billing_account_id)
);

CREATE TABLE provider_pricing_versions (
  pricing_version_id VARCHAR(128) PRIMARY KEY,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  provider_key VARCHAR(64) NOT NULL,
  model_key VARCHAR(128) NOT NULL,
  model_version VARCHAR(128) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  cost_currency CHAR(3) NOT NULL,
  input_micros_per_million_tokens BIGINT NOT NULL,
  output_micros_per_million_tokens BIGINT NOT NULL,
  cached_input_micros_per_million_tokens BIGINT,
  credit_conversion_numerator BIGINT NOT NULL,
  credit_conversion_denominator BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (pricing_version_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (provider_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  CHECK (model_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CHECK (model_version ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  CHECK (cost_currency ~ '^[A-Z]{3}$'),
  CHECK (input_micros_per_million_tokens >= 0),
  CHECK (output_micros_per_million_tokens >= 0),
  CHECK (cached_input_micros_per_million_tokens IS NULL
    OR cached_input_micros_per_million_tokens >= 0),
  CHECK (credit_conversion_numerator > 0),
  CHECK (credit_conversion_denominator > 0),
  UNIQUE (provider_key, model_key, model_version, effective_from),
  UNIQUE (provider_key, model_key, model_version, pricing_version_id)
);

CREATE FUNCTION reject_overlapping_provider_pricing_window()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.provider_key || ':' || NEW.model_key || ':' || NEW.model_version,
    0
  ));
  IF EXISTS (
    SELECT 1
    FROM provider_pricing_versions existing
    WHERE existing.provider_key = NEW.provider_key
      AND existing.model_key = NEW.model_key
      AND existing.model_version = NEW.model_version
      AND tstzrange(existing.effective_from, existing.effective_until, '[)')
        && tstzrange(NEW.effective_from, NEW.effective_until, '[)')
  ) THEN
    RAISE EXCEPTION 'provider pricing windows must not overlap'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_pricing_windows_do_not_overlap
BEFORE INSERT ON provider_pricing_versions
FOR EACH ROW EXECUTE FUNCTION reject_overlapping_provider_pricing_window();

ALTER TABLE organization_entitlement_snapshots
  ALTER COLUMN storage_contract_version SET DEFAULT 1,
  ADD COLUMN entitlement_snapshot_id VARCHAR(128) NOT NULL,
  ADD COLUMN billing_account_id VARCHAR(128) NOT NULL,
  ADD COLUMN subscription_projection_id VARCHAR(128),
  ADD COLUMN plan_version_id VARCHAR(128) NOT NULL,
  ADD COLUMN entitlement_policy_version VARCHAR(64) NOT NULL,
  ADD COLUMN source_record_version BIGINT NOT NULL,
  ADD COLUMN expensive_operations_enabled BOOLEAN NOT NULL,
  ADD COLUMN record_version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN effective_at TIMESTAMPTZ NOT NULL,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT organization_entitlement_snapshots_storage_contract_version_check
    CHECK (storage_contract_version = 1),
  ADD CONSTRAINT organization_entitlement_snapshots_id_check
    CHECK (entitlement_snapshot_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  ADD CONSTRAINT organization_entitlement_snapshots_policy_check
    CHECK (entitlement_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  ADD CONSTRAINT organization_entitlement_snapshots_versions_check
    CHECK (source_record_version > 0 AND record_version > 0),
  ADD CONSTRAINT organization_entitlement_snapshots_id_unique
    UNIQUE (entitlement_snapshot_id),
  ADD CONSTRAINT organization_entitlement_snapshots_org_id_unique
    UNIQUE (organization_id, entitlement_snapshot_id),
  ADD CONSTRAINT organization_entitlement_snapshots_billing_fk
    FOREIGN KEY (organization_id, billing_account_id)
    REFERENCES organization_billing_accounts(organization_id, billing_account_id),
  ADD CONSTRAINT organization_entitlement_snapshots_subscription_fk
    FOREIGN KEY (organization_id, subscription_projection_id)
    REFERENCES organization_subscription_projections(
      organization_id, subscription_projection_id
    ),
  ADD CONSTRAINT organization_entitlement_snapshots_plan_fk
    FOREIGN KEY (plan_version_id)
    REFERENCES commercial_plan_versions(plan_version_id);

CREATE TABLE credit_grants (
  credit_grant_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  billing_account_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  plan_version_id VARCHAR(128) REFERENCES commercial_plan_versions(plan_version_id),
  grant_kind VARCHAR(32) NOT NULL,
  credit_units BIGINT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  expiration_policy_kind VARCHAR(32) NOT NULL,
  expiration_policy_version VARCHAR(64),
  subscription_period_id VARCHAR(128),
  subscription_period_start TIMESTAMPTZ,
  subscription_period_end TIMESTAMPTZ,
  consumption_priority INTEGER NOT NULL DEFAULT 100,
  source_reference VARCHAR(255),
  grant_policy_version VARCHAR(64) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  created_by_actor_kind VARCHAR(32) NOT NULL,
  created_by_actor_id VARCHAR(128) NOT NULL,
  created_by_principal_id VARCHAR(128) REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (credit_grant_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (grant_kind IN (
    'one-time', 'monthly', 'promotional', 'purchased', 'administrative'
  )),
  CHECK (
    grant_kind NOT IN ('one-time', 'monthly')
    OR plan_version_id IS NOT NULL
  ),
  CHECK (credit_units > 0),
  CHECK (expires_at IS NULL OR expires_at > starts_at),
  CHECK (consumption_priority >= 0),
  CHECK (expiration_policy_kind IN (
    'expires-at', 'does-not-expire', 'unresolved'
  )),
  CHECK (
    (expiration_policy_kind = 'expires-at'
      AND expiration_policy_version IS NOT NULL
      AND expires_at IS NOT NULL)
    OR
    (expiration_policy_kind = 'does-not-expire'
      AND expiration_policy_version IS NOT NULL
      AND expires_at IS NULL)
    OR
    (expiration_policy_kind = 'unresolved'
      AND expiration_policy_version IS NULL
      AND expires_at IS NULL
      AND grant_kind = 'purchased')
  ),
  CHECK (
    grant_kind <> 'monthly'
    OR (
      expiration_policy_kind = 'expires-at'
      AND subscription_period_id IS NOT NULL
      AND subscription_period_start IS NOT NULL
      AND subscription_period_end IS NOT NULL
      AND starts_at >= subscription_period_start
      AND starts_at < subscription_period_end
      AND expires_at = subscription_period_end
    )
  ),
  CHECK (
    grant_kind = 'monthly'
    OR (subscription_period_id IS NULL
      AND subscription_period_start IS NULL
      AND subscription_period_end IS NULL)
  ),
  CHECK (source_reference IS NULL OR length(source_reference) BETWEEN 1 AND 255),
  CHECK (grant_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  CHECK (expiration_policy_version IS NULL
    OR expiration_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  CHECK (subscription_period_id IS NULL
    OR subscription_period_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (created_by_actor_kind IN (
    'internal-accounting', 'internal-administration'
  )),
  CHECK (
    (grant_kind = 'administrative'
      AND created_by_actor_kind = 'internal-administration'
      AND created_by_principal_id IS NOT NULL)
    OR
    (grant_kind <> 'administrative'
      AND created_by_actor_kind = 'internal-accounting'
      AND created_by_principal_id IS NULL)
  ),
  CHECK (created_by_actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  UNIQUE (organization_id, credit_grant_id),
  UNIQUE (organization_id, idempotency_key_sha256),
  FOREIGN KEY (organization_id, billing_account_id)
    REFERENCES organization_billing_accounts(organization_id, billing_account_id)
);

CREATE UNIQUE INDEX credit_grants_source_once_idx
  ON credit_grants (organization_id, grant_kind, source_reference)
  WHERE source_reference IS NOT NULL;

CREATE UNIQUE INDEX credit_grants_monthly_period_once_idx
  ON credit_grants (organization_id, subscription_period_id)
  WHERE grant_kind = 'monthly';

CREATE UNIQUE INDEX credit_grants_one_time_issuance_once_idx
  ON credit_grants (
    organization_id, plan_version_id, grant_policy_version
  )
  WHERE grant_kind = 'one-time';

CREATE TABLE credit_reservations (
  reservation_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  billing_account_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  entitlement_snapshot_id VARCHAR(128) NOT NULL,
  entitlement_policy_version VARCHAR(64) NOT NULL,
  plan_version_id VARCHAR(128) NOT NULL,
  pricing_version_id VARCHAR(128) NOT NULL,
  charging_policy_version VARCHAR(64) NOT NULL,
  acting_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  project_id VARCHAR(128) NOT NULL,
  feature_key VARCHAR(128) NOT NULL,
  request_id VARCHAR(128) NOT NULL,
  job_id VARCHAR(128) NOT NULL,
  provider_key VARCHAR(64) NOT NULL,
  model_key VARCHAR(128) NOT NULL,
  model_version VARCHAR(128) NOT NULL,
  requested_credit_units BIGINT NOT NULL,
  reserved_credit_units BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  request_sha256 CHAR(64) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  terminal_request_sha256 CHAR(64),
  terminal_idempotency_key_sha256 CHAR(64),
  terminal_ledger_entry_id VARCHAR(128),
  terminal_payload_sha256 CHAR(64),
  record_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  terminal_at TIMESTAMPTZ,
  CHECK (reservation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (feature_key ~ '^[a-z][a-z0-9-]{0,127}$'),
  CHECK (entitlement_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  CHECK (charging_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
  CHECK (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (job_id IS NULL OR job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (provider_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  CHECK (model_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CHECK (model_version ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CHECK (requested_credit_units > 0),
  CHECK (reserved_credit_units = requested_credit_units),
  CHECK (status IN ('active', 'settled', 'released', 'expired')),
  CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (terminal_request_sha256 IS NULL OR terminal_request_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (terminal_idempotency_key_sha256 IS NULL OR terminal_idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (terminal_payload_sha256 IS NULL
    OR terminal_payload_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (record_version > 0),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'active'
      AND terminal_request_sha256 IS NULL
      AND terminal_idempotency_key_sha256 IS NULL
      AND terminal_ledger_entry_id IS NULL
      AND terminal_payload_sha256 IS NULL
      AND terminal_at IS NULL)
    OR
    (status <> 'active'
      AND terminal_request_sha256 IS NOT NULL
      AND terminal_idempotency_key_sha256 IS NOT NULL
      AND terminal_ledger_entry_id IS NOT NULL
      AND terminal_payload_sha256 IS NOT NULL
      AND terminal_at IS NOT NULL
      AND terminal_at >= created_at
      AND (status <> 'expired' OR terminal_at >= expires_at)
    )
  ),
  UNIQUE (organization_id, reservation_id),
  UNIQUE (organization_id, request_id),
  UNIQUE (organization_id, idempotency_key_sha256),
  FOREIGN KEY (organization_id, billing_account_id)
    REFERENCES organization_billing_accounts(organization_id, billing_account_id),
  FOREIGN KEY (organization_id, entitlement_snapshot_id)
    REFERENCES organization_entitlement_snapshots(
      organization_id, entitlement_snapshot_id
    ),
  FOREIGN KEY (plan_version_id)
    REFERENCES commercial_plan_versions(plan_version_id),
  FOREIGN KEY (provider_key, model_key, model_version, pricing_version_id)
    REFERENCES provider_pricing_versions(
      provider_key, model_key, model_version, pricing_version_id
    ),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, acting_principal_id)
    REFERENCES memberships(organization_id, principal_id),
  FOREIGN KEY (plan_version_id, feature_key)
    REFERENCES commercial_plan_feature_entitlements(plan_version_id, feature_key)
);

CREATE FUNCTION enforce_credit_reservation_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.reservation_id, NEW.organization_id, NEW.billing_account_id,
    NEW.storage_contract_version, NEW.entitlement_snapshot_id,
    NEW.entitlement_policy_version, NEW.plan_version_id,
    NEW.pricing_version_id, NEW.charging_policy_version,
    NEW.acting_principal_id, NEW.project_id, NEW.feature_key,
    NEW.request_id, NEW.job_id, NEW.provider_key, NEW.model_key,
    NEW.model_version, NEW.requested_credit_units, NEW.reserved_credit_units,
    NEW.request_sha256, NEW.idempotency_key_sha256, NEW.created_at,
    NEW.expires_at
  ) IS DISTINCT FROM ROW(
    OLD.reservation_id, OLD.organization_id, OLD.billing_account_id,
    OLD.storage_contract_version, OLD.entitlement_snapshot_id,
    OLD.entitlement_policy_version, OLD.plan_version_id,
    OLD.pricing_version_id, OLD.charging_policy_version,
    OLD.acting_principal_id, OLD.project_id, OLD.feature_key,
    OLD.request_id, OLD.job_id, OLD.provider_key, OLD.model_key,
    OLD.model_version, OLD.requested_credit_units, OLD.reserved_credit_units,
    OLD.request_sha256, OLD.idempotency_key_sha256, OLD.created_at,
    OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'credit reservation pins are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'active' OR NEW.status = 'active'
     OR NEW.record_version <> OLD.record_version + 1
     OR OLD.terminal_request_sha256 IS NOT NULL
     OR OLD.terminal_idempotency_key_sha256 IS NOT NULL
     OR OLD.terminal_ledger_entry_id IS NOT NULL
     OR OLD.terminal_payload_sha256 IS NOT NULL
     OR OLD.terminal_at IS NOT NULL THEN
    RAISE EXCEPTION 'invalid credit reservation terminal transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_reservations_transition_guard
BEFORE UPDATE ON credit_reservations
FOR EACH ROW EXECUTE FUNCTION enforce_credit_reservation_transition();

CREATE TRIGGER credit_reservations_cannot_be_deleted
BEFORE DELETE ON credit_reservations
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE credit_reservation_allocations (
  organization_id VARCHAR(128) NOT NULL,
  reservation_id VARCHAR(128) NOT NULL,
  credit_grant_id VARCHAR(128) NOT NULL,
  allocation_sequence INTEGER NOT NULL,
  reserved_credit_units BIGINT NOT NULL,
  settled_credit_units BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, reservation_id, credit_grant_id),
  CHECK (allocation_sequence > 0),
  CHECK (reserved_credit_units > 0),
  CHECK (settled_credit_units >= 0),
  CHECK (settled_credit_units <= reserved_credit_units),
  UNIQUE (organization_id, reservation_id, allocation_sequence),
  FOREIGN KEY (organization_id, reservation_id)
    REFERENCES credit_reservations(organization_id, reservation_id),
  FOREIGN KEY (organization_id, credit_grant_id)
    REFERENCES credit_grants(organization_id, credit_grant_id)
);

CREATE FUNCTION enforce_credit_reservation_allocation_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status VARCHAR(32);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'credit reservation allocations are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF ROW(
    NEW.organization_id, NEW.reservation_id, NEW.credit_grant_id,
    NEW.allocation_sequence, NEW.reserved_credit_units, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.organization_id, OLD.reservation_id, OLD.credit_grant_id,
    OLD.allocation_sequence, OLD.reserved_credit_units, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'credit reservation allocation pins are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.settled_credit_units <> 0
     OR NEW.settled_credit_units < 0
     OR NEW.settled_credit_units > NEW.reserved_credit_units THEN
    RAISE EXCEPTION 'invalid credit reservation allocation settlement'
      USING ERRCODE = '23514';
  END IF;
  SELECT status INTO parent_status
  FROM credit_reservations
  WHERE organization_id = NEW.organization_id
    AND reservation_id = NEW.reservation_id
  FOR UPDATE;
  IF parent_status <> 'active' THEN
    RAISE EXCEPTION 'allocation settlement requires an active reservation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_reservation_allocations_change_guard
BEFORE UPDATE OR DELETE ON credit_reservation_allocations
FOR EACH ROW EXECUTE FUNCTION enforce_credit_reservation_allocation_change();

CREATE FUNCTION validate_credit_reservation_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocation_total BIGINT;
  settled_total BIGINT;
  reservation_total BIGINT;
  reservation_status VARCHAR(32);
BEGIN
  SELECT reserved_credit_units, status
  INTO reservation_total, reservation_status
  FROM credit_reservations
  WHERE organization_id = NEW.organization_id
    AND reservation_id = NEW.reservation_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(reserved_credit_units), 0),
         COALESCE(SUM(settled_credit_units), 0)
  INTO allocation_total, settled_total
  FROM credit_reservation_allocations
  WHERE organization_id = NEW.organization_id
    AND reservation_id = NEW.reservation_id;
  IF allocation_total <> reservation_total
     OR (reservation_status = 'active' AND settled_total <> 0) THEN
    RAISE EXCEPTION 'credit reservation allocation state does not reconcile'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER credit_reservations_reconcile_allocations
AFTER INSERT OR UPDATE ON credit_reservations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_credit_reservation_allocation_total();

CREATE CONSTRAINT TRIGGER credit_reservation_allocations_reconcile_parent
AFTER INSERT OR UPDATE ON credit_reservation_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_credit_reservation_allocation_total();

ALTER TABLE usage_ledger_entries
  ALTER COLUMN storage_contract_version SET DEFAULT 1,
  ADD COLUMN entry_kind VARCHAR(32) NOT NULL,
  ADD COLUMN billing_account_id VARCHAR(128) NOT NULL,
  ADD COLUMN reservation_id VARCHAR(128),
  ADD COLUMN credit_grant_id VARCHAR(128),
  ADD COLUMN related_ledger_entry_id VARCHAR(128),
  ADD COLUMN acting_principal_id VARCHAR(128),
  ADD COLUMN entitlement_policy_version VARCHAR(64),
  ADD COLUMN recorded_by_actor_kind VARCHAR(32) NOT NULL,
  ADD COLUMN recorded_by_actor_id VARCHAR(128) NOT NULL,
  ADD COLUMN project_id VARCHAR(128),
  ADD COLUMN feature_key VARCHAR(128),
  ADD COLUMN request_id VARCHAR(128),
  ADD COLUMN job_id VARCHAR(128),
  ADD COLUMN plan_version_id VARCHAR(128),
  ADD COLUMN pricing_version_id VARCHAR(128),
  ADD COLUMN provider_key VARCHAR(64),
  ADD COLUMN model_key VARCHAR(128),
  ADD COLUMN model_version VARCHAR(128),
  ADD COLUMN provider_request_id VARCHAR(128),
  ADD COLUMN input_token_count BIGINT,
  ADD COLUMN output_token_count BIGINT,
  ADD COLUMN cached_input_token_count BIGINT,
  ADD COLUMN latency_milliseconds BIGINT,
  ADD COLUMN estimated_provider_cost_micros BIGINT,
  ADD COLUMN provider_cost_currency CHAR(3),
  ADD COLUMN normalized_credit_units BIGINT,
  ADD COLUMN granted_credit_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN reserved_credit_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN settled_credit_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN released_credit_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN expired_credit_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN credit_adjustment_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN outcome VARCHAR(32) NOT NULL,
  ADD COLUMN reason_code VARCHAR(128) NOT NULL,
  ADD COLUMN safe_reason VARCHAR(300),
  ADD COLUMN charging_scenario VARCHAR(64),
  ADD COLUMN charging_policy_version VARCHAR(64) NOT NULL,
  ADD COLUMN correlation_id VARCHAR(128) NOT NULL,
  ADD CONSTRAINT usage_ledger_entries_storage_contract_version_check
    CHECK (storage_contract_version = 1),
  ADD CONSTRAINT usage_ledger_entries_kind_check
    CHECK (entry_kind IN (
      'grant', 'reservation', 'settlement', 'release', 'expiration',
      'provider-failure', 'adjustment'
    )),
  ADD CONSTRAINT usage_ledger_entries_actor_check
    CHECK (recorded_by_actor_kind IN ('principal', 'internal-accounting', 'internal-administration')),
  ADD CONSTRAINT usage_ledger_entries_feature_check
    CHECK (feature_key IS NULL OR feature_key ~ '^[a-z][a-z0-9-]{0,127}$'),
  ADD CONSTRAINT usage_ledger_entries_identifiers_check
    CHECK (
      (request_id IS NULL OR request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
      AND (job_id IS NULL OR job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
      AND (provider_request_id IS NULL
        OR provider_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')
      AND (model_key IS NULL
        OR model_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')
      AND (model_version IS NULL
        OR model_version ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')
      AND (entitlement_policy_version IS NULL
        OR entitlement_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$')
      AND charging_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
      AND recorded_by_actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    ),
  ADD CONSTRAINT usage_ledger_entries_metrics_check
    CHECK (
      (input_token_count IS NULL OR input_token_count >= 0)
      AND (output_token_count IS NULL OR output_token_count >= 0)
      AND (cached_input_token_count IS NULL OR cached_input_token_count >= 0)
      AND (latency_milliseconds IS NULL OR latency_milliseconds >= 0)
      AND (estimated_provider_cost_micros IS NULL OR estimated_provider_cost_micros >= 0)
      AND (normalized_credit_units IS NULL OR normalized_credit_units >= 0)
      AND (
        (estimated_provider_cost_micros IS NULL AND provider_cost_currency IS NULL)
        OR
        (estimated_provider_cost_micros IS NOT NULL
          AND provider_cost_currency ~ '^[A-Z]{3}$')
      )
    ),
  ADD CONSTRAINT usage_ledger_entries_provider_tuple_check
    CHECK (
      (provider_key IS NULL AND model_key IS NULL
        AND model_version IS NULL AND pricing_version_id IS NULL)
      OR
      (provider_key IS NOT NULL AND model_key IS NOT NULL
        AND model_version IS NOT NULL AND pricing_version_id IS NOT NULL)
    ),
  ADD CONSTRAINT usage_ledger_entries_kind_evidence_check
    CHECK (
      (entry_kind = 'grant'
        AND reservation_id IS NULL AND acting_principal_id IS NULL
        AND project_id IS NULL AND feature_key IS NULL AND request_id IS NULL
        AND job_id IS NULL AND provider_key IS NULL
        AND entitlement_policy_version IS NULL
        AND recorded_by_actor_kind = 'internal-accounting')
      OR
      (entry_kind = 'adjustment'
        AND reservation_id IS NULL AND credit_grant_id IS NULL
        AND acting_principal_id IS NULL AND project_id IS NULL
        AND feature_key IS NULL AND request_id IS NULL AND job_id IS NULL
        AND plan_version_id IS NULL AND provider_key IS NULL
        AND entitlement_policy_version IS NULL
        AND recorded_by_actor_kind = 'internal-administration')
      OR
      (entry_kind = 'reservation'
        AND reservation_id IS NOT NULL AND credit_grant_id IS NULL
        AND acting_principal_id IS NOT NULL AND project_id IS NOT NULL
        AND feature_key IS NOT NULL AND request_id IS NOT NULL
        AND job_id IS NOT NULL AND plan_version_id IS NOT NULL
        AND provider_key IS NOT NULL AND entitlement_policy_version IS NOT NULL
        AND recorded_by_actor_kind IN ('principal', 'internal-accounting')
        AND (recorded_by_actor_kind <> 'principal'
          OR recorded_by_actor_id = acting_principal_id))
      OR
      (entry_kind IN ('settlement', 'release', 'provider-failure')
        AND reservation_id IS NOT NULL AND credit_grant_id IS NULL
        AND acting_principal_id IS NOT NULL AND project_id IS NOT NULL
        AND feature_key IS NOT NULL AND request_id IS NOT NULL
        AND job_id IS NOT NULL AND plan_version_id IS NOT NULL
        AND provider_key IS NOT NULL AND entitlement_policy_version IS NOT NULL
        AND recorded_by_actor_kind = 'internal-accounting')
      OR
      (entry_kind = 'expiration'
        AND reservation_id IS NOT NULL AND credit_grant_id IS NULL
        AND acting_principal_id IS NOT NULL AND project_id IS NOT NULL
        AND feature_key IS NOT NULL AND request_id IS NOT NULL
        AND job_id IS NOT NULL AND plan_version_id IS NOT NULL
        AND provider_key IS NOT NULL AND entitlement_policy_version IS NOT NULL
        AND recorded_by_actor_kind = 'internal-accounting')
    ),
  ADD CONSTRAINT usage_ledger_entries_credit_shape_check
    CHECK (
      granted_credit_units >= 0
      AND reserved_credit_units >= 0
      AND settled_credit_units >= 0
      AND released_credit_units >= 0
      AND expired_credit_units >= 0
      AND (
        (entry_kind = 'grant'
          AND granted_credit_units > 0
          AND reserved_credit_units = 0
          AND settled_credit_units = 0
          AND released_credit_units = 0
          AND expired_credit_units = 0
          AND credit_adjustment_units = 0
          AND credit_grant_id IS NOT NULL
          AND reservation_id IS NULL)
        OR
        (entry_kind = 'reservation'
          AND granted_credit_units = 0
          AND reserved_credit_units > 0
          AND settled_credit_units = 0
          AND released_credit_units = 0
          AND expired_credit_units = 0
          AND credit_adjustment_units = 0)
        OR
        (entry_kind = 'settlement'
          AND granted_credit_units = 0
          AND reserved_credit_units = 0
          AND settled_credit_units + released_credit_units > 0
          AND expired_credit_units = 0
          AND credit_adjustment_units = 0)
        OR
        (entry_kind = 'release'
          AND granted_credit_units = 0
          AND reserved_credit_units = 0
          AND settled_credit_units = 0
          AND released_credit_units > 0
          AND expired_credit_units = 0
          AND credit_adjustment_units = 0)
        OR
        (entry_kind = 'provider-failure'
          AND granted_credit_units = 0
          AND reserved_credit_units = 0
          AND settled_credit_units = 0
          AND released_credit_units > 0
          AND expired_credit_units = 0
          AND credit_adjustment_units = 0
          AND reservation_id IS NOT NULL
          AND provider_key IS NOT NULL
          AND model_key IS NOT NULL
          AND model_version IS NOT NULL)
        OR
        (entry_kind = 'expiration'
          AND granted_credit_units = 0
          AND reserved_credit_units = 0
          AND settled_credit_units = 0
          AND released_credit_units = 0
          AND expired_credit_units > 0
          AND credit_adjustment_units = 0)
        OR
        (entry_kind = 'adjustment'
          AND granted_credit_units = 0
          AND reserved_credit_units = 0
          AND settled_credit_units = 0
          AND released_credit_units = 0
          AND expired_credit_units = 0
          AND credit_adjustment_units <> 0
          AND related_ledger_entry_id IS NOT NULL
          AND reason_code IS NOT NULL
          AND safe_reason IS NOT NULL)
      )
    ),
  ADD CONSTRAINT usage_ledger_entries_outcome_check
    CHECK (outcome IN (
      'granted', 'reserved', 'useful-output-delivered', 'no-useful-output',
      'released', 'expired', 'provider-failure', 'internal-failure',
      'canceled', 'adjusted', 'compensated'
    )),
  ADD CONSTRAINT usage_ledger_entries_kind_outcome_check
    CHECK (
      (entry_kind = 'grant' AND outcome = 'granted')
      OR (entry_kind = 'reservation' AND outcome = 'reserved')
      OR (entry_kind = 'settlement' AND outcome = 'useful-output-delivered')
      OR (entry_kind = 'release'
        AND outcome IN ('internal-failure', 'canceled'))
      OR (entry_kind = 'provider-failure' AND outcome = 'provider-failure')
      OR (entry_kind = 'expiration' AND outcome = 'expired')
      OR (entry_kind = 'adjustment'
        AND outcome IN ('adjusted', 'compensated'))
    ),
  ADD CONSTRAINT usage_ledger_entries_scenario_check
    CHECK (
      charging_scenario IS NULL
      OR charging_scenario IN (
        'request-rejected-before-invocation',
        'insufficient-credits',
        'user-cancelled-before-invocation',
        'provider-failure-before-useful-output',
        'cloudmarkup-internal-failure',
        'proposal-delivered-user-rejected',
        'user-requested-redesign',
        'automatic-retry',
        'system-required-repair'
      )
    ),
  ADD CONSTRAINT usage_ledger_entries_scenario_outcome_check
    CHECK (
      (outcome = 'provider-failure'
        AND charging_scenario = 'provider-failure-before-useful-output')
      OR (outcome = 'internal-failure'
        AND charging_scenario = 'cloudmarkup-internal-failure')
      OR (outcome = 'canceled'
        AND charging_scenario = 'user-cancelled-before-invocation')
      OR (outcome = 'useful-output-delivered'
        AND charging_scenario IN (
          'proposal-delivered-user-rejected', 'system-required-repair'
        ))
      OR (outcome NOT IN (
          'provider-failure', 'internal-failure', 'canceled',
          'useful-output-delivered'
        ) AND charging_scenario IS NULL)
    ),
  ADD CONSTRAINT usage_ledger_entries_kind_metrics_check
    CHECK (
      (entry_kind IN ('grant', 'adjustment', 'reservation', 'expiration')
        AND provider_request_id IS NULL
        AND input_token_count IS NULL
        AND output_token_count IS NULL
        AND cached_input_token_count IS NULL
        AND latency_milliseconds IS NULL
        AND estimated_provider_cost_micros IS NULL
        AND provider_cost_currency IS NULL
        AND normalized_credit_units IS NULL)
      OR
      (entry_kind IN ('settlement', 'provider-failure')
        AND estimated_provider_cost_micros IS NOT NULL
        AND provider_cost_currency IS NOT NULL
        AND normalized_credit_units IS NOT NULL)
      OR
      (entry_kind = 'release' AND outcome = 'canceled'
        AND provider_request_id IS NULL
        AND input_token_count IS NULL
        AND output_token_count IS NULL
        AND cached_input_token_count IS NULL
        AND latency_milliseconds IS NULL
        AND estimated_provider_cost_micros IS NULL
        AND provider_cost_currency IS NULL
        AND normalized_credit_units IS NULL)
      OR
      (entry_kind = 'release' AND outcome = 'internal-failure'
        AND (
          (provider_request_id IS NULL
            AND input_token_count IS NULL
            AND output_token_count IS NULL
            AND cached_input_token_count IS NULL
            AND latency_milliseconds IS NULL
            AND estimated_provider_cost_micros IS NULL
            AND provider_cost_currency IS NULL
            AND normalized_credit_units IS NULL)
          OR
          (estimated_provider_cost_micros IS NOT NULL
            AND provider_cost_currency IS NOT NULL
            AND normalized_credit_units IS NOT NULL)
        ))
    ),
  ADD CONSTRAINT usage_ledger_entries_reason_check
    CHECK (
      (reason_code ~ '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$'
        AND (safe_reason IS NULL
          OR length(btrim(safe_reason)) BETWEEN 1 AND 300))
    ),
  ADD CONSTRAINT usage_ledger_entries_billing_fk
    FOREIGN KEY (organization_id, billing_account_id)
    REFERENCES organization_billing_accounts(organization_id, billing_account_id),
  ADD CONSTRAINT usage_ledger_entries_reservation_fk
    FOREIGN KEY (organization_id, reservation_id)
    REFERENCES credit_reservations(organization_id, reservation_id),
  ADD CONSTRAINT usage_ledger_entries_grant_fk
    FOREIGN KEY (organization_id, credit_grant_id)
    REFERENCES credit_grants(organization_id, credit_grant_id),
  ADD CONSTRAINT usage_ledger_entries_related_fk
    FOREIGN KEY (organization_id, related_ledger_entry_id)
    REFERENCES usage_ledger_entries(organization_id, ledger_entry_id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT usage_ledger_entries_actor_fk
    FOREIGN KEY (acting_principal_id) REFERENCES principals(principal_id),
  ADD CONSTRAINT usage_ledger_entries_actor_membership_fk
    FOREIGN KEY (organization_id, acting_principal_id)
    REFERENCES memberships(organization_id, principal_id),
  ADD CONSTRAINT usage_ledger_entries_project_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  ADD CONSTRAINT usage_ledger_entries_plan_fk
    FOREIGN KEY (plan_version_id)
    REFERENCES commercial_plan_versions(plan_version_id),
  ADD CONSTRAINT usage_ledger_entries_plan_feature_fk
    FOREIGN KEY (plan_version_id, feature_key)
    REFERENCES commercial_plan_feature_entitlements(plan_version_id, feature_key),
  ADD CONSTRAINT usage_ledger_entries_pricing_fk
    FOREIGN KEY (provider_key, model_key, model_version, pricing_version_id)
    REFERENCES provider_pricing_versions(
      provider_key, model_key, model_version, pricing_version_id
    );

CREATE UNIQUE INDEX usage_grant_event_credit_grant_unique_idx
  ON usage_ledger_entries (organization_id, credit_grant_id)
  WHERE entry_kind = 'grant';

CREATE UNIQUE INDEX usage_reservation_event_reservation_unique_idx
  ON usage_ledger_entries (organization_id, reservation_id)
  WHERE entry_kind = 'reservation';

CREATE UNIQUE INDEX usage_terminal_event_reservation_unique_idx
  ON usage_ledger_entries (organization_id, reservation_id)
  WHERE entry_kind IN ('settlement', 'release', 'expiration', 'provider-failure');

CREATE TABLE usage_ledger_entry_allocations (
  organization_id VARCHAR(128) NOT NULL,
  ledger_entry_id VARCHAR(128) NOT NULL,
  allocation_sequence INTEGER NOT NULL,
  credit_grant_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  credit_adjustment_units BIGINT NOT NULL DEFAULT 0,
  reserved_credit_units BIGINT NOT NULL DEFAULT 0,
  settled_credit_units BIGINT NOT NULL DEFAULT 0,
  released_credit_units BIGINT NOT NULL DEFAULT 0,
  expired_credit_units BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, ledger_entry_id, allocation_sequence),
  UNIQUE (organization_id, ledger_entry_id, credit_grant_id),
  CHECK (storage_contract_version = 1),
  CHECK (allocation_sequence > 0),
  CHECK (
    reserved_credit_units >= 0
    AND settled_credit_units >= 0
    AND released_credit_units >= 0
    AND expired_credit_units >= 0
    AND (
      (credit_adjustment_units <> 0
        AND reserved_credit_units = 0
        AND settled_credit_units = 0
        AND released_credit_units = 0
        AND expired_credit_units = 0)
      OR
      (credit_adjustment_units = 0
        AND reserved_credit_units + settled_credit_units
          + released_credit_units + expired_credit_units > 0)
    )
  ),
  FOREIGN KEY (organization_id, ledger_entry_id)
    REFERENCES usage_ledger_entries(organization_id, ledger_entry_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organization_id, credit_grant_id)
    REFERENCES credit_grants(organization_id, credit_grant_id)
);

CREATE UNIQUE INDEX usage_positive_adjustment_grant_unique_idx
  ON usage_ledger_entry_allocations (organization_id, credit_grant_id)
  WHERE credit_adjustment_units > 0;

CREATE FUNCTION lock_commercial_credit_consumption_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_billing_account_id VARCHAR(128);
BEGIN
  IF TG_TABLE_NAME = 'usage_ledger_entry_allocations' THEN
    IF NEW.credit_adjustment_units >= 0 THEN
      RETURN NEW;
    END IF;
    SELECT event.billing_account_id INTO target_billing_account_id
    FROM usage_ledger_entries event
    WHERE event.organization_id = NEW.organization_id
      AND event.ledger_entry_id = NEW.ledger_entry_id
      AND event.entry_kind = 'adjustment';
  ELSE
    SELECT reservation.billing_account_id INTO target_billing_account_id
    FROM credit_reservations reservation
    WHERE reservation.organization_id = NEW.organization_id
      AND reservation.reservation_id = NEW.reservation_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit consumption parent is not available'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM organization_billing_accounts account
  WHERE account.organization_id = NEW.organization_id
    AND account.billing_account_id = target_billing_account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit consumption billing account is not available'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_reservation_allocations_account_lock
BEFORE INSERT OR UPDATE ON credit_reservation_allocations
FOR EACH ROW EXECUTE FUNCTION lock_commercial_credit_consumption_account();

CREATE TRIGGER usage_negative_adjustments_account_lock
BEFORE INSERT ON usage_ledger_entry_allocations
FOR EACH ROW
WHEN (NEW.credit_adjustment_units < 0)
EXECUTE FUNCTION lock_commercial_credit_consumption_account();

COMMENT ON TABLE usage_ledger_entry_allocations IS
  'Immutable per-event, per-grant customer-credit effects used for exact technical reconciliation.';

CREATE TRIGGER usage_ledger_entry_allocations_are_immutable
BEFORE UPDATE OR DELETE ON usage_ledger_entry_allocations
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE FUNCTION validate_usage_ledger_allocation_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocation_count BIGINT;
  event_row usage_ledger_entries%ROWTYPE;
  adjustment_total BIGINT;
  reserved_total BIGINT;
  settled_total BIGINT;
  released_total BIGINT;
  expired_total BIGINT;
BEGIN
  SELECT * INTO event_row
  FROM usage_ledger_entries
  WHERE organization_id = NEW.organization_id
    AND ledger_entry_id = NEW.ledger_entry_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(credit_adjustment_units), 0),
         COALESCE(SUM(reserved_credit_units), 0),
         COALESCE(SUM(settled_credit_units), 0),
         COALESCE(SUM(released_credit_units), 0),
         COALESCE(SUM(expired_credit_units), 0)
  INTO allocation_count, adjustment_total, reserved_total, settled_total,
       released_total, expired_total
  FROM usage_ledger_entry_allocations
  WHERE organization_id = NEW.organization_id
    AND ledger_entry_id = NEW.ledger_entry_id;

  IF event_row.entry_kind = 'grant' THEN
    IF allocation_count <> 0 THEN
      RAISE EXCEPTION 'grant events cannot have allocation effects'
        USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;

  IF allocation_count = 0
     OR adjustment_total <> event_row.credit_adjustment_units
     OR reserved_total <> event_row.reserved_credit_units
     OR settled_total <> event_row.settled_credit_units
     OR released_total <> event_row.released_credit_units
     OR expired_total <> event_row.expired_credit_units THEN
    RAISE EXCEPTION 'usage event allocation effects do not reconcile'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM usage_ledger_entry_allocations allocation
    WHERE allocation.organization_id = NEW.organization_id
      AND allocation.ledger_entry_id = NEW.ledger_entry_id
      AND NOT (
        (event_row.entry_kind = 'adjustment'
          AND allocation.credit_adjustment_units <> 0
          AND allocation.reserved_credit_units = 0
          AND allocation.settled_credit_units = 0
          AND allocation.released_credit_units = 0
          AND allocation.expired_credit_units = 0)
        OR (event_row.entry_kind = 'reservation'
          AND allocation.credit_adjustment_units = 0
          AND allocation.reserved_credit_units > 0
          AND allocation.settled_credit_units = 0
          AND allocation.released_credit_units = 0
          AND allocation.expired_credit_units = 0)
        OR (event_row.entry_kind = 'settlement'
          AND allocation.credit_adjustment_units = 0
          AND allocation.reserved_credit_units = 0
          AND allocation.settled_credit_units
            + allocation.released_credit_units > 0
          AND allocation.expired_credit_units = 0)
        OR (event_row.entry_kind IN ('release', 'provider-failure')
          AND allocation.credit_adjustment_units = 0
          AND allocation.reserved_credit_units = 0
          AND allocation.settled_credit_units = 0
          AND allocation.released_credit_units > 0
          AND allocation.expired_credit_units = 0)
        OR (event_row.entry_kind = 'expiration'
          AND allocation.credit_adjustment_units = 0
          AND allocation.reserved_credit_units = 0
          AND allocation.settled_credit_units = 0
          AND allocation.released_credit_units = 0
          AND allocation.expired_credit_units > 0)
      )
  ) THEN
    RAISE EXCEPTION 'usage event allocation kind does not match its parent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER usage_ledger_entries_reconcile_allocations
AFTER INSERT ON usage_ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_usage_ledger_allocation_reconciliation();

CREATE CONSTRAINT TRIGGER usage_ledger_allocations_reconcile_parent
AFTER INSERT ON usage_ledger_entry_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_usage_ledger_allocation_reconciliation();

CREATE FUNCTION validate_credit_grant_funding_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grant_row credit_grants%ROWTYPE;
  funding_event_count BIGINT;
  funding_event_matches BIGINT;
BEGIN
  SELECT * INTO grant_row
  FROM credit_grants
  WHERE organization_id = NEW.organization_id
    AND credit_grant_id = NEW.credit_grant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'usage_ledger_entry_allocations'
     AND NEW.credit_adjustment_units > 0
     AND grant_row.grant_kind <> 'administrative' THEN
    RAISE EXCEPTION 'positive credit adjustment must fund an administrative grant'
      USING ERRCODE = '23514';
  END IF;

  IF grant_row.grant_kind = 'administrative' THEN
    SELECT COUNT(*) INTO funding_event_count
    FROM usage_ledger_entry_allocations allocation
    WHERE allocation.organization_id = grant_row.organization_id
      AND allocation.credit_grant_id = grant_row.credit_grant_id
      AND allocation.credit_adjustment_units > 0;
    SELECT COUNT(*) INTO funding_event_matches
    FROM usage_ledger_entry_allocations allocation
    JOIN usage_ledger_entries event
      ON event.organization_id = allocation.organization_id
     AND event.ledger_entry_id = allocation.ledger_entry_id
    WHERE allocation.organization_id = grant_row.organization_id
      AND allocation.credit_grant_id = grant_row.credit_grant_id
      AND allocation.credit_adjustment_units = grant_row.credit_units
      AND allocation.reserved_credit_units = 0
      AND allocation.settled_credit_units = 0
      AND allocation.released_credit_units = 0
      AND allocation.expired_credit_units = 0
      AND event.entry_kind = 'adjustment'
      AND event.credit_adjustment_units = grant_row.credit_units
      AND event.billing_account_id = grant_row.billing_account_id
      AND event.recorded_by_actor_kind = grant_row.created_by_actor_kind
      AND event.recorded_by_actor_id = grant_row.created_by_actor_id
      AND event.outcome = 'compensated';
  ELSE
    SELECT COUNT(*) INTO funding_event_count
    FROM usage_ledger_entries event
    WHERE event.organization_id = grant_row.organization_id
      AND event.credit_grant_id = grant_row.credit_grant_id
      AND event.entry_kind = 'grant';
    SELECT COUNT(*) INTO funding_event_matches
    FROM usage_ledger_entries event
    WHERE event.organization_id = grant_row.organization_id
      AND event.credit_grant_id = grant_row.credit_grant_id
      AND event.entry_kind = 'grant'
      AND event.billing_account_id = grant_row.billing_account_id
      AND event.plan_version_id IS NOT DISTINCT FROM grant_row.plan_version_id
      AND event.granted_credit_units = grant_row.credit_units
      AND event.recorded_by_actor_kind = grant_row.created_by_actor_kind
      AND event.recorded_by_actor_id = grant_row.created_by_actor_id
      AND event.outcome = 'granted';
  END IF;

  IF funding_event_count <> 1 OR funding_event_matches <> 1 THEN
    RAISE EXCEPTION 'credit grant funding does not reconcile with its ledger event'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER credit_grants_reconcile_funding_ledger
AFTER INSERT ON credit_grants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_credit_grant_funding_reconciliation();

CREATE CONSTRAINT TRIGGER usage_grant_events_reconcile_funding
AFTER INSERT ON usage_ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.entry_kind = 'grant')
EXECUTE FUNCTION validate_credit_grant_funding_reconciliation();

CREATE CONSTRAINT TRIGGER credit_grant_allocations_reconcile_funding
AFTER INSERT ON usage_ledger_entry_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.credit_adjustment_units > 0)
EXECUTE FUNCTION validate_credit_grant_funding_reconciliation();

CREATE FUNCTION validate_credit_grant_balance_invariant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grant_row credit_grants%ROWTYPE;
  event_occurred_at TIMESTAMPTZ;
  funding_total NUMERIC;
  settled_total NUMERIC;
  active_reserved_total NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'usage_ledger_entry_allocations'
     AND NEW.credit_adjustment_units >= 0 THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'commercial-grant-balance:' || NEW.organization_id || ':' || NEW.credit_grant_id,
    0
  ));
  SELECT * INTO grant_row
  FROM credit_grants
  WHERE organization_id = NEW.organization_id
    AND credit_grant_id = NEW.credit_grant_id;
  IF NOT FOUND
     OR grant_row.expiration_policy_kind = 'unresolved' THEN
    RAISE EXCEPTION 'credit allocation targets an ineligible grant'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'usage_ledger_entry_allocations' THEN
    SELECT occurred_at INTO event_occurred_at
    FROM usage_ledger_entries
    WHERE organization_id = NEW.organization_id
      AND ledger_entry_id = NEW.ledger_entry_id
      AND entry_kind = 'adjustment';
  ELSE
    SELECT created_at INTO event_occurred_at
    FROM credit_reservations
    WHERE organization_id = NEW.organization_id
      AND reservation_id = NEW.reservation_id;
  END IF;
  IF NOT FOUND
     OR event_occurred_at < grant_row.starts_at
     OR (grant_row.expires_at IS NOT NULL
       AND event_occurred_at >= grant_row.expires_at)
     OR ((TG_TABLE_NAME = 'usage_ledger_entry_allocations' OR TG_OP = 'INSERT')
       AND (CURRENT_TIMESTAMP < grant_row.starts_at
         OR (grant_row.expires_at IS NOT NULL
           AND CURRENT_TIMESTAMP >= grant_row.expires_at))) THEN
    RAISE EXCEPTION 'credit allocation targets an ineligible grant'
      USING ERRCODE = '23514';
  END IF;

  SELECT (CASE WHEN grant_row.grant_kind = 'administrative'
           THEN 0 ELSE grant_row.credit_units END)
         + COALESCE(SUM(allocation.credit_adjustment_units), 0)
  INTO funding_total
  FROM usage_ledger_entry_allocations allocation
  WHERE allocation.organization_id = grant_row.organization_id
    AND allocation.credit_grant_id = grant_row.credit_grant_id;
  SELECT COALESCE(SUM(allocation.settled_credit_units), 0)
  INTO settled_total
  FROM credit_reservation_allocations allocation
  WHERE allocation.organization_id = grant_row.organization_id
    AND allocation.credit_grant_id = grant_row.credit_grant_id;
  SELECT COALESCE(SUM(allocation.reserved_credit_units), 0)
  INTO active_reserved_total
  FROM credit_reservation_allocations allocation
  JOIN credit_reservations reservation
    ON reservation.organization_id = allocation.organization_id
   AND reservation.reservation_id = allocation.reservation_id
  WHERE allocation.organization_id = grant_row.organization_id
    AND allocation.credit_grant_id = grant_row.credit_grant_id
    AND reservation.status = 'active';
  IF funding_total - settled_total - active_reserved_total < 0 THEN
    RAISE EXCEPTION 'credit allocation would overdraw its grant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER credit_adjustments_preserve_grant_invariants
AFTER INSERT ON usage_ledger_entry_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.credit_adjustment_units < 0)
EXECUTE FUNCTION validate_credit_grant_balance_invariant();

CREATE CONSTRAINT TRIGGER credit_reservation_allocations_preserve_grant_balance
AFTER INSERT OR UPDATE ON credit_reservation_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_credit_grant_balance_invariant();

CREATE FUNCTION validate_credit_reservation_ledger_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reservation_row credit_reservations%ROWTYPE;
  target_reservation_id VARCHAR(128);
  reservation_event_count BIGINT;
  reservation_event_matches BIGINT;
  reservation_ledger_entry_id VARCHAR(128);
  reservation_allocation_mismatches BIGINT;
  terminal_event_count BIGINT;
  terminal_event_matches BIGINT;
  terminal_allocation_mismatches BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'usage_ledger_entry_allocations' THEN
    SELECT event.reservation_id INTO target_reservation_id
    FROM usage_ledger_entries event
    WHERE event.organization_id = NEW.organization_id
      AND event.ledger_entry_id = NEW.ledger_entry_id;
    IF NOT FOUND OR target_reservation_id IS NULL THEN
      RETURN NULL;
    END IF;
  ELSE
    target_reservation_id := NEW.reservation_id;
  END IF;

  SELECT * INTO reservation_row
  FROM credit_reservations
  WHERE organization_id = NEW.organization_id
    AND reservation_id = target_reservation_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO reservation_event_count
  FROM usage_ledger_entries event
  WHERE event.organization_id = reservation_row.organization_id
    AND event.reservation_id = reservation_row.reservation_id
    AND event.entry_kind = 'reservation';

  SELECT COUNT(*) INTO reservation_event_matches
  FROM usage_ledger_entries event
  WHERE event.organization_id = reservation_row.organization_id
    AND event.reservation_id = reservation_row.reservation_id
    AND event.entry_kind = 'reservation'
    AND event.billing_account_id = reservation_row.billing_account_id
    AND event.acting_principal_id = reservation_row.acting_principal_id
    AND event.project_id = reservation_row.project_id
    AND event.feature_key = reservation_row.feature_key
    AND event.request_id = reservation_row.request_id
    AND event.job_id = reservation_row.job_id
    AND event.plan_version_id = reservation_row.plan_version_id
    AND event.pricing_version_id = reservation_row.pricing_version_id
    AND event.provider_key = reservation_row.provider_key
    AND event.model_key = reservation_row.model_key
    AND event.model_version = reservation_row.model_version
    AND event.entitlement_policy_version =
        reservation_row.entitlement_policy_version
    AND event.charging_policy_version = reservation_row.charging_policy_version
    AND event.reserved_credit_units = reservation_row.reserved_credit_units
    AND event.occurred_at >= reservation_row.created_at
    AND event.outcome = 'reserved'
    AND (
      (event.recorded_by_actor_kind = 'principal'
        AND event.recorded_by_actor_id = reservation_row.acting_principal_id)
      OR event.recorded_by_actor_kind = 'internal-accounting'
    );
  IF reservation_event_count <> 1 OR reservation_event_matches <> 1 THEN
    RAISE EXCEPTION 'credit reservation does not reconcile with its reservation ledger event'
      USING ERRCODE = '23514';
  END IF;

  SELECT event.ledger_entry_id INTO reservation_ledger_entry_id
  FROM usage_ledger_entries event
  WHERE event.organization_id = reservation_row.organization_id
    AND event.reservation_id = reservation_row.reservation_id
    AND event.entry_kind = 'reservation';

  SELECT COUNT(*) INTO reservation_allocation_mismatches
  FROM (
    SELECT reservation_allocation.allocation_sequence AS reservation_sequence,
           reservation_allocation.credit_grant_id,
           reservation_allocation.reserved_credit_units,
           ledger_allocation.allocation_sequence AS ledger_sequence,
           ledger_allocation.credit_grant_id AS ledger_grant_id,
           ledger_allocation.reserved_credit_units AS ledger_reserved,
           ledger_allocation.settled_credit_units AS ledger_settled,
           ledger_allocation.released_credit_units AS ledger_released,
           ledger_allocation.expired_credit_units AS ledger_expired,
           ledger_allocation.credit_adjustment_units AS ledger_adjustment
    FROM (
      SELECT allocation_sequence, credit_grant_id, reserved_credit_units
      FROM credit_reservation_allocations
      WHERE organization_id = reservation_row.organization_id
        AND reservation_id = reservation_row.reservation_id
    ) reservation_allocation
    FULL JOIN (
      SELECT allocation_sequence, credit_grant_id, reserved_credit_units,
             settled_credit_units, released_credit_units,
             expired_credit_units, credit_adjustment_units
      FROM usage_ledger_entry_allocations
      WHERE organization_id = reservation_row.organization_id
        AND ledger_entry_id = reservation_ledger_entry_id
    ) ledger_allocation
      ON ledger_allocation.allocation_sequence =
          reservation_allocation.allocation_sequence
  ) effects
  WHERE effects.reservation_sequence IS NULL
     OR effects.ledger_sequence IS NULL
     OR effects.credit_grant_id <> effects.ledger_grant_id
     OR effects.reserved_credit_units <> effects.ledger_reserved
     OR effects.ledger_settled <> 0
     OR effects.ledger_released <> 0
     OR effects.ledger_expired <> 0
     OR effects.ledger_adjustment <> 0;
  IF reservation_allocation_mismatches <> 0 THEN
    RAISE EXCEPTION 'credit reservation allocation evidence does not reconcile'
      USING ERRCODE = '23514';
  END IF;

  IF reservation_row.status = 'active' THEN
    SELECT COUNT(*) INTO terminal_event_count
    FROM usage_ledger_entries event
    WHERE event.organization_id = reservation_row.organization_id
      AND event.reservation_id = reservation_row.reservation_id
      AND event.entry_kind IN (
        'settlement', 'release', 'expiration', 'provider-failure'
      );
    IF terminal_event_count <> 0 THEN
      RAISE EXCEPTION 'active credit reservation has a terminal ledger event'
        USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO terminal_event_count
  FROM usage_ledger_entries event
  WHERE event.organization_id = reservation_row.organization_id
    AND event.reservation_id = reservation_row.reservation_id
    AND event.entry_kind IN (
      'settlement', 'release', 'expiration', 'provider-failure'
    );

  SELECT COUNT(*) INTO terminal_event_matches
  FROM usage_ledger_entries event
  WHERE event.organization_id = reservation_row.organization_id
    AND event.ledger_entry_id = reservation_row.terminal_ledger_entry_id
    AND event.idempotency_key_sha256 =
        reservation_row.terminal_idempotency_key_sha256
    AND event.reservation_id = reservation_row.reservation_id
    AND event.billing_account_id = reservation_row.billing_account_id
    AND event.acting_principal_id = reservation_row.acting_principal_id
    AND event.project_id = reservation_row.project_id
    AND event.feature_key = reservation_row.feature_key
    AND event.request_id = reservation_row.request_id
    AND event.job_id = reservation_row.job_id
    AND event.plan_version_id = reservation_row.plan_version_id
    AND event.pricing_version_id = reservation_row.pricing_version_id
    AND event.provider_key = reservation_row.provider_key
    AND event.model_key = reservation_row.model_key
    AND event.model_version = reservation_row.model_version
    AND event.entitlement_policy_version =
        reservation_row.entitlement_policy_version
    AND event.charging_policy_version = reservation_row.charging_policy_version
    AND event.recorded_by_actor_kind = 'internal-accounting'
    AND event.occurred_at >= reservation_row.created_at
    AND event.occurred_at <= reservation_row.terminal_at
    AND (reservation_row.status <> 'expired' OR event.occurred_at >= reservation_row.expires_at)
    AND (
      (reservation_row.status = 'settled'
        AND event.entry_kind = 'settlement'
        AND event.settled_credit_units + event.released_credit_units =
            reservation_row.reserved_credit_units)
      OR
      (reservation_row.status = 'released'
        AND event.entry_kind IN ('release', 'provider-failure')
        AND event.released_credit_units = reservation_row.reserved_credit_units)
      OR
      (reservation_row.status = 'expired'
        AND event.entry_kind = 'expiration'
        AND event.expired_credit_units = reservation_row.reserved_credit_units)
    );
  IF terminal_event_count <> 1 OR terminal_event_matches <> 1 THEN
    RAISE EXCEPTION 'credit reservation terminal state does not reconcile with its ledger event'
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*) INTO terminal_allocation_mismatches
  FROM (
    SELECT reservation_allocation.allocation_sequence,
           reservation_allocation.credit_grant_id,
           reservation_allocation.reserved_credit_units,
           reservation_allocation.settled_credit_units,
           ledger_allocation.credit_grant_id AS ledger_grant_id,
           ledger_allocation.settled_credit_units AS ledger_settled,
           ledger_allocation.released_credit_units AS ledger_released,
           ledger_allocation.expired_credit_units AS ledger_expired
    FROM (
      SELECT allocation_sequence, credit_grant_id, reserved_credit_units,
             settled_credit_units
      FROM credit_reservation_allocations
      WHERE organization_id = reservation_row.organization_id
        AND reservation_id = reservation_row.reservation_id
    ) reservation_allocation
    FULL JOIN (
      SELECT allocation_sequence, credit_grant_id, settled_credit_units,
             released_credit_units, expired_credit_units
      FROM usage_ledger_entry_allocations
      WHERE organization_id = reservation_row.organization_id
        AND ledger_entry_id = reservation_row.terminal_ledger_entry_id
    ) ledger_allocation
      ON ledger_allocation.allocation_sequence =
         reservation_allocation.allocation_sequence
  ) effects
  WHERE effects.credit_grant_id IS NULL
     OR effects.ledger_grant_id IS NULL
     OR effects.credit_grant_id <> effects.ledger_grant_id
     OR (reservation_row.status = 'settled'
       AND (effects.ledger_settled <> effects.settled_credit_units
         OR effects.ledger_released <>
            effects.reserved_credit_units - effects.settled_credit_units
         OR effects.ledger_expired <> 0))
     OR (reservation_row.status = 'released'
       AND (effects.ledger_settled <> 0
         OR effects.ledger_released <> effects.reserved_credit_units
         OR effects.ledger_expired <> 0))
     OR (reservation_row.status = 'expired'
       AND (effects.ledger_settled <> 0
         OR effects.ledger_released <> 0
         OR effects.ledger_expired <> effects.reserved_credit_units));
  IF terminal_allocation_mismatches <> 0 THEN
    RAISE EXCEPTION 'credit reservation terminal allocation effects do not reconcile'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER credit_reservations_reconcile_lifecycle_ledger
AFTER INSERT OR UPDATE ON credit_reservations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_credit_reservation_ledger_reconciliation();

CREATE CONSTRAINT TRIGGER usage_events_reconcile_credit_reservation
AFTER INSERT ON usage_ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.reservation_id IS NOT NULL)
EXECUTE FUNCTION validate_credit_reservation_ledger_reconciliation();

CREATE CONSTRAINT TRIGGER credit_reservation_allocations_reconcile_lifecycle
AFTER INSERT OR UPDATE ON credit_reservation_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_credit_reservation_ledger_reconciliation();

CREATE CONSTRAINT TRIGGER usage_allocations_reconcile_credit_reservation
AFTER INSERT ON usage_ledger_entry_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_credit_reservation_ledger_reconciliation();

ALTER TABLE credit_reservations
  ADD CONSTRAINT credit_reservations_terminal_ledger_fk
  FOREIGN KEY (organization_id, terminal_ledger_entry_id)
  REFERENCES usage_ledger_entries(organization_id, ledger_entry_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE billing_webhook_events (
  webhook_event_id VARCHAR(128) PRIMARY KEY,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  billing_provider VARCHAR(64) NOT NULL,
  provider_event_reference VARCHAR(255) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'received',
  organization_id VARCHAR(128) REFERENCES organizations(organization_id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  safe_failure_code VARCHAR(128),
  CHECK (webhook_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (billing_provider ~ '^[a-z][a-z0-9-]{0,63}$'),
  CHECK (length(provider_event_reference) BETWEEN 1 AND 255),
  CHECK (event_type ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$'),
  CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (lifecycle_status IN ('received', 'processed', 'failed', 'unsupported')),
  CHECK ((lifecycle_status = 'received') = (processed_at IS NULL)),
  UNIQUE (billing_provider, provider_event_reference)
);

COMMENT ON TABLE billing_webhook_events IS
  'Provider-neutral idempotency and digest placeholder only; no Stripe integration, signature secret, or raw webhook payload is stored.';

CREATE TRIGGER commercial_plan_definitions_are_immutable
BEFORE UPDATE OR DELETE ON commercial_plan_definitions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER commercial_plan_versions_are_immutable
BEFORE UPDATE OR DELETE ON commercial_plan_versions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER commercial_plan_features_are_immutable
BEFORE UPDATE OR DELETE ON commercial_plan_feature_entitlements
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER commercial_plan_limits_are_immutable
BEFORE UPDATE OR DELETE ON commercial_plan_numeric_limits
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER commercial_plan_included_grants_are_immutable
BEFORE UPDATE OR DELETE ON commercial_plan_included_credit_grants
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER commercial_plan_seat_rules_are_immutable
BEFORE UPDATE OR DELETE ON commercial_plan_seat_rules
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE FUNCTION enforce_provider_pricing_version_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider pricing versions cannot be deleted'
      USING ERRCODE = '23514';
  END IF;
  IF ROW(
    NEW.pricing_version_id, NEW.storage_contract_version,
    NEW.provider_key, NEW.model_key, NEW.model_version,
    NEW.effective_from, NEW.cost_currency,
    NEW.input_micros_per_million_tokens,
    NEW.output_micros_per_million_tokens,
    NEW.cached_input_micros_per_million_tokens,
    NEW.credit_conversion_numerator,
    NEW.credit_conversion_denominator, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.pricing_version_id, OLD.storage_contract_version,
    OLD.provider_key, OLD.model_key, OLD.model_version,
    OLD.effective_from, OLD.cost_currency,
    OLD.input_micros_per_million_tokens,
    OLD.output_micros_per_million_tokens,
    OLD.cached_input_micros_per_million_tokens,
    OLD.credit_conversion_numerator,
    OLD.credit_conversion_denominator, OLD.created_at
  ) OR OLD.effective_until IS NOT NULL
    OR NEW.effective_until IS NULL
    OR NEW.effective_until <= OLD.effective_from
    OR NEW.effective_until < CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'invalid provider pricing version transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_pricing_versions_one_way_close
BEFORE UPDATE OR DELETE ON provider_pricing_versions
FOR EACH ROW EXECUTE FUNCTION enforce_provider_pricing_version_transition();

CREATE TRIGGER credit_grants_are_immutable
BEFORE UPDATE OR DELETE ON credit_grants
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE INDEX credit_grants_consumption_order_idx
  ON credit_grants (
    organization_id, expires_at, consumption_priority, starts_at, credit_grant_id
  );

CREATE INDEX credit_reservations_active_expiry_idx
  ON credit_reservations (organization_id, expires_at, reservation_id)
  WHERE status = 'active';

CREATE INDEX usage_ledger_entries_organization_occurred_idx
  ON usage_ledger_entries (organization_id, occurred_at DESC, ledger_entry_id);

-- Versioned beta examples. Changing commercial values creates new immutable
-- plan-version rows; it never rewrites historical reservations or usage.
INSERT INTO commercial_plan_definitions (plan_id, plan_key, display_name)
VALUES
  ('plan_free_trial', 'free-trial', 'Free Trial'),
  ('plan_pro', 'pro', 'Pro'),
  ('plan_team', 'team', 'Team');

INSERT INTO commercial_plan_versions (
  plan_version_id, plan_id, version_number, configuration_version,
  effective_from, proposed_monthly_price_micros, price_currency
)
VALUES
  ('planver_free_trial_2026_08_03_v1', 'plan_free_trial', 1,
    'cloudmarkup-beta-plans-2026-08-03-v1',
    '2026-08-03T00:00:00Z', 0, 'USD'),
  ('planver_pro_2026_08_03_v1', 'plan_pro', 1,
    'cloudmarkup-beta-plans-2026-08-03-v1',
    '2026-08-03T00:00:00Z', 39000000, 'USD'),
  ('planver_team_2026_08_03_v1', 'plan_team', 1,
    'cloudmarkup-beta-plans-2026-08-03-v1',
    '2026-08-03T00:00:00Z', 149000000, 'USD');

WITH canonical_features(feature_key) AS (
  VALUES
    ('manual-editing'),
    ('read-existing-projects'),
    ('existing-artifact-access'),
    ('data-export'),
    ('zip-export'),
    ('diagram-export'),
    ('github-export'),
    ('terraform'),
    ('cloudformation'),
    ('complete-application-generation'),
    ('validation-jobs'),
    ('plan-evidence-workflows'),
    ('deployment-evidence-workflows'),
    ('organization-roles'),
    ('shared-projects'),
    ('audit-history'),
    ('ai-assisted-operations')
), enabled_by_plan(plan_version_id, enabled_feature_keys) AS (
  VALUES
    (
      'planver_free_trial_2026_08_03_v1',
      ARRAY[
        'manual-editing', 'read-existing-projects',
        'existing-artifact-access', 'data-export', 'diagram-export',
        'ai-assisted-operations'
      ]::TEXT[]
    ),
    (
      'planver_pro_2026_08_03_v1',
      ARRAY[
        'manual-editing', 'read-existing-projects',
        'existing-artifact-access', 'data-export', 'zip-export',
        'diagram-export', 'github-export', 'terraform', 'validation-jobs',
        'plan-evidence-workflows', 'deployment-evidence-workflows',
        'ai-assisted-operations'
      ]::TEXT[]
    ),
    (
      'planver_team_2026_08_03_v1',
      ARRAY[
        'manual-editing', 'read-existing-projects',
        'existing-artifact-access', 'data-export', 'zip-export',
        'diagram-export', 'github-export', 'terraform', 'validation-jobs',
        'plan-evidence-workflows', 'deployment-evidence-workflows',
        'organization-roles', 'shared-projects', 'audit-history',
        'ai-assisted-operations'
      ]::TEXT[]
    )
)
INSERT INTO commercial_plan_feature_entitlements (
  plan_version_id, feature_key, entitlement_state
)
SELECT
  plan.plan_version_id,
  feature.feature_key,
  CASE
    WHEN feature.feature_key = ANY(plan.enabled_feature_keys) THEN 'enabled'
    ELSE 'disabled'
  END
FROM enabled_by_plan plan
CROSS JOIN canonical_features feature;

INSERT INTO commercial_plan_numeric_limits (
  plan_version_id, limit_key, limit_scope, period_kind, limit_value
)
VALUES
  ('planver_free_trial_2026_08_03_v1', 'projects', 'organization', 'none', 2),
  ('planver_free_trial_2026_08_03_v1', 'active-members', 'organization', 'none', 1),
  ('planver_free_trial_2026_08_03_v1', 'active-owners', 'organization', 'none', 1),
  ('planver_free_trial_2026_08_03_v1', 'active-administrators', 'organization', 'none', 1),
  ('planver_free_trial_2026_08_03_v1', 'active-editors', 'organization', 'none', 1),
  ('planver_free_trial_2026_08_03_v1', 'billable-seats', 'organization', 'none', 1),
  ('planver_free_trial_2026_08_03_v1', 'viewers', 'organization', 'none', 0),
  ('planver_free_trial_2026_08_03_v1', 'concurrent-ai-jobs', 'organization', 'none', 1),
  ('planver_pro_2026_08_03_v1', 'projects', 'organization', 'none', 25),
  ('planver_pro_2026_08_03_v1', 'active-members', 'organization', 'none', 1),
  ('planver_pro_2026_08_03_v1', 'active-owners', 'organization', 'none', 1),
  ('planver_pro_2026_08_03_v1', 'active-administrators', 'organization', 'none', 1),
  ('planver_pro_2026_08_03_v1', 'active-editors', 'organization', 'none', 1),
  ('planver_pro_2026_08_03_v1', 'billable-seats', 'organization', 'none', 1),
  ('planver_pro_2026_08_03_v1', 'viewers', 'organization', 'none', 0),
  ('planver_pro_2026_08_03_v1', 'concurrent-ai-jobs', 'organization', 'none', 2),
  ('planver_team_2026_08_03_v1', 'projects', 'organization', 'none', 100),
  ('planver_team_2026_08_03_v1', 'active-members', 'organization', 'none', 25),
  ('planver_team_2026_08_03_v1', 'active-owners', 'organization', 'none', 5),
  ('planver_team_2026_08_03_v1', 'active-administrators', 'organization', 'none', 5),
  ('planver_team_2026_08_03_v1', 'active-editors', 'organization', 'none', 5),
  ('planver_team_2026_08_03_v1', 'billable-seats', 'organization', 'none', 5),
  ('planver_team_2026_08_03_v1', 'viewers', 'organization', 'none', 20),
  ('planver_team_2026_08_03_v1', 'concurrent-ai-jobs', 'organization', 'none', 5);

INSERT INTO commercial_plan_included_credit_grants (
  plan_version_id, grant_kind, credit_units
)
VALUES
  ('planver_free_trial_2026_08_03_v1', 'one-time', 150),
  ('planver_pro_2026_08_03_v1', 'monthly', 1000),
  ('planver_team_2026_08_03_v1', 'monthly', 4000);

INSERT INTO commercial_plan_seat_rules (
  plan_version_id, billable_role_keys, included_billable_seats,
  maximum_billable_seats, maximum_nonbillable_viewers,
  additional_seat_enabled, additional_seat_monthly_price_micros,
  additional_seat_price_currency, additional_seat_credit_units
)
VALUES
  ('planver_free_trial_2026_08_03_v1', ARRAY['owner', 'administrator', 'editor'],
    1, 1, 0, FALSE, NULL, NULL, NULL),
  ('planver_pro_2026_08_03_v1', ARRAY['owner', 'administrator', 'editor'],
    1, 1, 0, FALSE, NULL, NULL, NULL),
  ('planver_team_2026_08_03_v1', ARRAY['owner', 'administrator', 'editor'],
    5, 5, 20, FALSE, 20000000, 'USD', 250);
