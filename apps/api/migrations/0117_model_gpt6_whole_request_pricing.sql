-- CloudMarkup additive migration 0117; fixed reviewed source closure.
-- PROPOSAL ONLY. Local label 0078 is NOT a migration version.
-- Registered versions already end at 0098; integration owner must allocate 0099+.
-- Never replace/admit this label or alter historical SQL. Unregistered/unapplied.
-- Unapplied NEXT proposal. No prices, grants or customer records are installed.
-- Existing immutable rows retain their original fields, digests and arithmetic.
ALTER TABLE model_provider_pricing_versions
  ADD COLUMN long_context_pricing JSONB;

ALTER TABLE model_provider_pricing_versions
  ADD CONSTRAINT model_provider_whole_request_pricing_is_exact CHECK (
    long_context_pricing IS NULL OR (
      jsonb_typeof(long_context_pricing) = 'object'
      AND long_context_pricing ?& ARRAY[
        'inputThresholdUnits','inputMicrosPerMillionUnits','outputMicrosPerMillionUnits']
      AND long_context_pricing - ARRAY[
        'inputThresholdUnits','inputMicrosPerMillionUnits','outputMicrosPerMillionUnits'] = '{}'::JSONB
      AND jsonb_typeof(long_context_pricing->'inputThresholdUnits') = 'string'
      AND jsonb_typeof(long_context_pricing->'inputMicrosPerMillionUnits') = 'string'
      AND jsonb_typeof(long_context_pricing->'outputMicrosPerMillionUnits') = 'string'
      AND long_context_pricing->>'inputThresholdUnits' ~ '^[1-9][0-9]{0,15}$'
      AND long_context_pricing->>'inputMicrosPerMillionUnits' ~ '^(0|[1-9][0-9]{0,15})$'
      AND long_context_pricing->>'outputMicrosPerMillionUnits' ~ '^(0|[1-9][0-9]{0,15})$'
      AND (long_context_pricing->>'inputThresholdUnits')::NUMERIC <= 9007199254740991
      AND (long_context_pricing->>'inputMicrosPerMillionUnits')::NUMERIC BETWEEN input_micros_per_million_units AND 9007199254740991
      AND (long_context_pricing->>'outputMicrosPerMillionUnits')::NUMERIC BETWEEN output_micros_per_million_units AND 9007199254740991
      AND cache_read_micros_per_million_units IS NULL
      AND cache_write_micros_per_million_units IS NULL
    ) IS TRUE
  );
