-- Owner-approved conversion: 400 credits per USD4 model cost.
-- Use the existing one-way pricing-window transition; never rewrite charges,
-- reservations, identities or prior rates. Both versions remain queryable.
DO $$
DECLARE boundary timestamptz;
BEGIN
  -- Drain reservations before choosing the cutoff; transaction-start time can
  -- precede a concurrently committed old-rate reservation. Block new reservation
  -- reads until the pricing windows change atomically.
  LOCK TABLE credit_reservations IN ACCESS EXCLUSIVE MODE;
  boundary := GREATEST(clock_timestamp(), '2026-09-30T00:00:00Z'::timestamptz);
  UPDATE provider_pricing_versions SET effective_until=boundary
    WHERE pricing_version_id='pricing_beta_sonnet46_global_20260925_v1'
      AND provider_key='anthropic' AND model_key='anthropic.claude-sonnet-4-6'
      AND model_version='claude-sonnet-4-6' AND effective_until IS NULL
      AND effective_from='2026-09-25T00:00:00Z'::timestamptz
      AND cost_currency='USD' AND input_micros_per_million_tokens=3000000
      AND output_micros_per_million_tokens=15000000
      AND cached_input_micros_per_million_tokens=300000
      AND credit_conversion_numerator=13 AND credit_conversion_denominator=100000;
  IF NOT FOUND THEN RAISE EXCEPTION 'pricing predecessor preflight failed' USING ERRCODE='23514'; END IF;
  INSERT INTO provider_pricing_versions (
    pricing_version_id, provider_key, model_key, model_version,
    effective_from, cost_currency, input_micros_per_million_tokens,
    output_micros_per_million_tokens, cached_input_micros_per_million_tokens,
    credit_conversion_numerator, credit_conversion_denominator
  ) VALUES (
    'pricing_beta_sonnet46_global_20260930_v2', 'anthropic',
    'anthropic.claude-sonnet-4-6', 'claude-sonnet-4-6',
    boundary, 'USD', 3000000, 15000000, 300000, 1, 10000
  );
END;
$$;

-- Preserve every previously validated predicate, adding only the exact successor.
DO $$
DECLARE target text; expression text;
BEGIN
  FOREACH target IN ARRAY ARRAY['usage_ledger_entries_scenario_check','usage_ledger_entries_scenario_outcome_check'] LOOP
    SELECT pg_get_expr(conbin,conrelid) INTO expression FROM pg_constraint
      WHERE conrelid='usage_ledger_entries'::regclass AND conname=target AND contype='c' AND convalidated;
    IF expression IS NULL THEN RAISE EXCEPTION 'scenario constraint preflight failed' USING ERRCODE='23514'; END IF;
    EXECUTE format('ALTER TABLE usage_ledger_entries DROP CONSTRAINT %I',target);
    EXECUTE format('ALTER TABLE usage_ledger_entries ADD CONSTRAINT %I CHECK ((%s) OR (charging_scenario=''beta-ai-output-delivered-v1'' AND pricing_version_id=''pricing_beta_sonnet46_global_20260930_v2'' AND entry_kind=''settlement'' AND outcome=''useful-output-delivered''))',target,expression);
  END LOOP;
END;
$$;
