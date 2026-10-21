-- Reviewed Sonnet 4.6 Global Standard pricing, observed from the AWS account offer on 2026-09-25.
-- One credit is USD 0.01 normalized provider cost with a 30% operating markup.
INSERT INTO provider_pricing_versions (
  pricing_version_id, provider_key, model_key, model_version,
  effective_from, cost_currency, input_micros_per_million_tokens,
  output_micros_per_million_tokens, cached_input_micros_per_million_tokens,
  credit_conversion_numerator, credit_conversion_denominator
) VALUES (
  'pricing_beta_sonnet46_global_20260925_v1', 'anthropic',
  'anthropic.claude-sonnet-4-6', 'claude-sonnet-4-6',
  '2026-09-25T00:00:00Z', 'USD', 3000000, 15000000, 300000, 13, 100000
);

-- A committed dispatch prevents a retry from making another paid provider call.
-- Output and usage are recorded only after the reviewed output is durably stored.
CREATE TABLE beta_ai_invocations (
  organization_id VARCHAR(128) NOT NULL,
  reservation_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  job_id VARCHAR(128) NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  request_sha256 CHAR(64) NOT NULL,
  estimated_credit_units BIGINT NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'reserved',
  dispatched_at TIMESTAMPTZ,
  usage_recorded_at TIMESTAMPTZ,
  terminal_at TIMESTAMPTZ,
  provider_request_id VARCHAR(128),
  input_tokens BIGINT,
  output_tokens BIGINT,
  cached_input_tokens BIGINT,
  output_object_id VARCHAR(128),
  output_sha256 CHAR(64),
  PRIMARY KEY (organization_id, reservation_id),
  UNIQUE (organization_id, purpose, job_id),
  FOREIGN KEY (organization_id, reservation_id)
    REFERENCES credit_reservations(organization_id, reservation_id),
  CHECK (purpose IN ('proposal', 'application-source')),
  CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (estimated_credit_units >= 0),
  CHECK (state IN ('reserved', 'dispatched', 'usage-recorded', 'settled', 'released')),
  CHECK ((state='reserved' AND dispatched_at IS NULL) OR state='released' OR
         (state IN ('dispatched','usage-recorded','settled') AND dispatched_at IS NOT NULL)),
  CHECK ((state IN ('usage-recorded','settled')) = (usage_recorded_at IS NOT NULL)),
  CHECK ((state IN ('settled','released')) = (terminal_at IS NOT NULL)),
  CHECK ((input_tokens IS NULL) = (usage_recorded_at IS NULL)),
  CHECK ((output_tokens IS NULL) = (usage_recorded_at IS NULL)),
  CHECK ((cached_input_tokens IS NULL) = (usage_recorded_at IS NULL)),
  CHECK ((output_object_id IS NULL) = (usage_recorded_at IS NULL)),
  CHECK ((output_sha256 IS NULL) = (usage_recorded_at IS NULL)),
  CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  CHECK (output_sha256 IS NULL OR output_sha256 ~ '^[a-f0-9]{64}$')
);

-- Existing validated predicates remain intact; admit only the new beta delivery outcome.
DO $$
DECLARE target text; expression text;
BEGIN
  FOREACH target IN ARRAY ARRAY['usage_ledger_entries_scenario_check','usage_ledger_entries_scenario_outcome_check'] LOOP
    SELECT pg_get_expr(conbin,conrelid) INTO expression FROM pg_constraint
      WHERE conrelid='usage_ledger_entries'::regclass AND conname=target AND contype='c' AND convalidated;
    IF expression IS NULL THEN RAISE EXCEPTION 'scenario constraint preflight failed' USING ERRCODE='23514'; END IF;
    EXECUTE format('ALTER TABLE usage_ledger_entries DROP CONSTRAINT %I',target);
    EXECUTE format('ALTER TABLE usage_ledger_entries ADD CONSTRAINT %I CHECK ((%s) OR (charging_scenario=''beta-ai-output-delivered-v1'' AND pricing_version_id=''pricing_beta_sonnet46_global_20260925_v1'' AND entry_kind=''settlement'' AND outcome=''useful-output-delivered''))',target,expression);
  END LOOP;
END;
$$;
