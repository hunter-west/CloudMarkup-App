-- Prompt 34A: immutable model pricing/normalization configuration and
-- append-only technical detail joined to the canonical Prompt 24A ledger.

CREATE TABLE model_provider_pricing_versions (
  pricing_version_id VARCHAR(128) PRIMARY KEY,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  provider_key VARCHAR(64) NOT NULL,
  model_key VARCHAR(128) NOT NULL,
  model_version VARCHAR(128) NOT NULL,
  inference_profile_id VARCHAR(256),
  environment VARCHAR(32) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  pricing_status VARCHAR(64) NOT NULL,
  cost_currency CHAR(3) NOT NULL,
  input_micros_per_million_units BIGINT NOT NULL,
  output_micros_per_million_units BIGINT NOT NULL,
  cache_read_micros_per_million_units BIGINT,
  cache_write_micros_per_million_units BIGINT,
  provider_specific_unit_rates JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (storage_contract_version = 1),
  CHECK (pricing_version_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (provider_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  CHECK (model_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CHECK (model_version ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CHECK (inference_profile_id IS NULL
    OR inference_profile_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
  CHECK (environment IN ('development', 'test', 'staging', 'production')),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  CHECK (pricing_status IN ('enabled', 'disabled-pricing-unavailable')),
  CHECK (cost_currency ~ '^[A-Z]{3}$'),
  CHECK (input_micros_per_million_units >= 0),
  CHECK (output_micros_per_million_units >= 0),
  CHECK (cache_read_micros_per_million_units IS NULL
    OR cache_read_micros_per_million_units >= 0),
  CHECK (cache_write_micros_per_million_units IS NULL
    OR cache_write_micros_per_million_units >= 0),
  CHECK (jsonb_typeof(provider_specific_unit_rates) = 'array'),
  UNIQUE (
    provider_key, model_key, model_version, inference_profile_id,
    environment, effective_from
  )
);

CREATE FUNCTION reject_overlapping_model_provider_pricing_window()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.provider_key || ':' || NEW.model_key || ':' || NEW.model_version
      || ':' || COALESCE(NEW.inference_profile_id, '')
      || ':' || NEW.environment,
    0
  ));
  IF EXISTS (
    SELECT 1
    FROM model_provider_pricing_versions existing
    WHERE existing.provider_key = NEW.provider_key
      AND existing.model_key = NEW.model_key
      AND existing.model_version = NEW.model_version
      AND existing.inference_profile_id IS NOT DISTINCT FROM
        NEW.inference_profile_id
      AND existing.environment = NEW.environment
      AND tstzrange(existing.effective_from, existing.effective_until, '[)')
        && tstzrange(NEW.effective_from, NEW.effective_until, '[)')
  ) THEN
    RAISE EXCEPTION 'model provider pricing windows must not overlap'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_provider_pricing_windows_do_not_overlap
BEFORE INSERT ON model_provider_pricing_versions
FOR EACH ROW EXECUTE FUNCTION
  reject_overlapping_model_provider_pricing_window();

CREATE TRIGGER model_provider_pricing_versions_are_immutable
BEFORE UPDATE OR DELETE ON model_provider_pricing_versions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE credit_normalization_policy_versions (
  normalization_policy_version_id VARCHAR(128) PRIMARY KEY,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  cost_currency CHAR(3) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  policy_status VARCHAR(32) NOT NULL,
  operating_buffer_basis_points BIGINT NOT NULL,
  credit_unit_micros BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (storage_contract_version = 1),
  CHECK (
    normalization_policy_version_id
      ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (cost_currency ~ '^[A-Z]{3}$'),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  CHECK (policy_status IN ('enabled', 'disabled')),
  CHECK (operating_buffer_basis_points BETWEEN 0 AND 1000000),
  CHECK (credit_unit_micros > 0),
  UNIQUE (cost_currency, effective_from)
);

CREATE FUNCTION reject_overlapping_credit_normalization_policy_window()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'credit-normalization:' || NEW.cost_currency,
    0
  ));
  IF EXISTS (
    SELECT 1
    FROM credit_normalization_policy_versions existing
    WHERE existing.cost_currency = NEW.cost_currency
      AND tstzrange(existing.effective_from, existing.effective_until, '[)')
        && tstzrange(NEW.effective_from, NEW.effective_until, '[)')
  ) THEN
    RAISE EXCEPTION 'credit normalization policy windows must not overlap'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_normalization_policy_windows_do_not_overlap
BEFORE INSERT ON credit_normalization_policy_versions
FOR EACH ROW EXECUTE FUNCTION
  reject_overlapping_credit_normalization_policy_window();

CREATE TRIGGER credit_normalization_policy_versions_are_immutable
BEFORE UPDATE OR DELETE ON credit_normalization_policy_versions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE model_usage_event_details (
  organization_id VARCHAR(128) NOT NULL,
  model_usage_event_id VARCHAR(128) NOT NULL,
  model_usage_idempotency_key_sha256 CHAR(64) NOT NULL,
  ledger_entry_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  model_route VARCHAR(32) NOT NULL,
  model_route_id VARCHAR(128) NOT NULL,
  inference_profile_id VARCHAR(256),
  prompt_id VARCHAR(128) NOT NULL,
  prompt_version VARCHAR(128) NOT NULL,
  template_id VARCHAR(128),
  template_version VARCHAR(128),
  model_pricing_version_id VARCHAR(128) NOT NULL,
  normalization_policy_version_id VARCHAR(128) NOT NULL,
  environment VARCHAR(32) NOT NULL,
  input_units BIGINT NOT NULL,
  output_units BIGINT NOT NULL,
  cache_read_units BIGINT NOT NULL,
  cache_write_units BIGINT NOT NULL,
  total_units BIGINT NOT NULL,
  provider_specific_units JSONB NOT NULL DEFAULT '[]'::JSONB,
  estimated_provider_cost_micros BIGINT NOT NULL,
  reserved_credit_units BIGINT NOT NULL,
  charged_credit_units BIGINT NOT NULL,
  compensated_credit_units BIGINT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  latency_milliseconds BIGINT NOT NULL,
  lifecycle_status VARCHAR(64) NOT NULL,
  failure_category VARCHAR(128),
  attempts JSONB NOT NULL DEFAULT '[]'::JSONB,
  multi_call_workflow_id VARCHAR(128) NOT NULL,
  reconciliation_state VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, model_usage_event_id),
  UNIQUE (organization_id, model_usage_idempotency_key_sha256),
  CHECK (model_usage_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CHECK (model_usage_idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (storage_contract_version = 1),
  CHECK (model_route IN ('standard', 'deep')),
  CHECK (model_route_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CHECK (inference_profile_id IS NULL
    OR inference_profile_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
  CHECK (prompt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CHECK (prompt_version ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  CHECK ((template_id IS NULL) = (template_version IS NULL)),
  CHECK (environment IN ('development', 'test', 'staging', 'production')),
  CHECK (input_units >= 0 AND output_units >= 0),
  CHECK (cache_read_units >= 0 AND cache_write_units >= 0),
  CHECK (
    total_units =
      input_units + output_units + cache_read_units + cache_write_units
  ),
  CHECK (jsonb_typeof(provider_specific_units) = 'array'),
  CHECK (estimated_provider_cost_micros >= 0),
  CHECK (reserved_credit_units >= 0),
  CHECK (charged_credit_units >= 0),
  CHECK (compensated_credit_units >= 0),
  CHECK (charged_credit_units <= reserved_credit_units),
  CHECK (completed_at IS NULL OR started_at IS NULL
    OR completed_at >= started_at),
  CHECK (latency_milliseconds >= 0),
  CHECK (lifecycle_status IN (
    'reserved', 'completed', 'released', 'provider-failure', 'cancelled',
    'internal-failure', 'reconciliation-required', 'compensated'
  )),
  CHECK (failure_category IS NULL
    OR failure_category ~ '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$'),
  CHECK (jsonb_typeof(attempts) = 'array'),
  CHECK (
    attempts::TEXT !~* '"(rawPrompt|rawResponse|promptText|responseText)"'
  ),
  CHECK (
    multi_call_workflow_id
      ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
  ),
  CHECK (reconciliation_state IN (
    'not-required', 'pending-missing-usage', 'pending-settlement', 'reconciled'
  )),
  FOREIGN KEY (organization_id, ledger_entry_id)
    REFERENCES usage_ledger_entries(organization_id, ledger_entry_id),
  FOREIGN KEY (organization_id)
    REFERENCES organizations(organization_id),
  FOREIGN KEY (model_pricing_version_id)
    REFERENCES model_provider_pricing_versions(pricing_version_id),
  FOREIGN KEY (normalization_policy_version_id)
    REFERENCES credit_normalization_policy_versions(
      normalization_policy_version_id
    )
);

CREATE TRIGGER model_usage_event_details_are_immutable
BEFORE UPDATE OR DELETE ON model_usage_event_details
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE INDEX model_usage_event_details_workflow_idx
  ON model_usage_event_details (
    organization_id, multi_call_workflow_id, created_at, model_usage_event_id
  );

CREATE INDEX model_usage_event_details_reconciliation_idx
  ON model_usage_event_details (
    reconciliation_state, organization_id, created_at, model_usage_event_id
  )
  WHERE reconciliation_state <> 'not-required';

CREATE INDEX model_usage_event_details_reporting_idx
  ON model_usage_event_details (
    environment, model_route, model_pricing_version_id, created_at
  );

CREATE VIEW canonical_model_usage_events_v1 AS
SELECT
  detail.model_usage_event_id AS event_id,
  detail.model_usage_idempotency_key_sha256 AS idempotency_id,
  event.ledger_entry_id AS related_credit_ledger_event_id,
  event.organization_id,
  event.acting_principal_id AS user_id,
  event.project_id,
  event.job_id,
  event.feature_key,
  detail.model_route,
  detail.model_route_id,
  event.provider_key,
  event.model_key,
  event.model_version,
  detail.inference_profile_id,
  detail.prompt_id,
  detail.prompt_version,
  detail.template_id,
  detail.template_version,
  detail.model_pricing_version_id AS pricing_version_id,
  detail.normalization_policy_version_id,
  detail.environment,
  detail.input_units,
  detail.output_units,
  detail.cache_read_units,
  detail.cache_write_units,
  detail.total_units,
  detail.provider_specific_units,
  detail.estimated_provider_cost_micros,
  detail.reserved_credit_units,
  detail.charged_credit_units,
  detail.compensated_credit_units,
  detail.started_at,
  detail.completed_at,
  detail.latency_milliseconds,
  detail.lifecycle_status,
  detail.failure_category,
  detail.attempts,
  detail.multi_call_workflow_id,
  detail.reconciliation_state,
  detail.occurred_at
FROM usage_ledger_entries event
JOIN model_usage_event_details detail
  ON detail.organization_id = event.organization_id
 AND detail.ledger_entry_id = event.ledger_entry_id;

COMMENT ON TABLE model_usage_event_details IS
  'Append-only model usage detail attached one-to-one to the canonical Prompt 24A credit ledger. It stores no raw prompt or response.';

COMMENT ON COLUMN model_usage_event_details.estimated_provider_cost_micros IS
  'Internal estimated provider cost only; it is not Stripe or customer billing.';

COMMENT ON TABLE credit_normalization_policy_versions IS
  'Versioned internal operating-buffer and CloudMarkup-credit normalization configuration; it is not a permanent public token or currency equivalence.';
