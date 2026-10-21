-- Prompt 24B replaces the active beta examples without rewriting migration 0007
-- or introducing a second commercial lineage. Historical Free Trial/Pro/Team
-- rows remain attributable to their original configuration; only Starter and
-- Pro are effective in the version-2 beta configuration.
DROP TRIGGER commercial_plan_versions_are_immutable
  ON commercial_plan_versions;

UPDATE commercial_plan_versions
SET configuration_status = 'retired',
    effective_until = '2026-08-14T00:00:00Z'
WHERE configuration_version = 'cloudmarkup-beta-plans-2026-08-03-v1'
  AND effective_until IS NULL;

CREATE TRIGGER commercial_plan_versions_are_immutable
BEFORE UPDATE OR DELETE ON commercial_plan_versions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

INSERT INTO commercial_plan_definitions (plan_id, plan_key, display_name)
VALUES ('plan_starter', 'starter', 'Starter');

INSERT INTO commercial_plan_versions (
  plan_version_id, plan_id, version_number, configuration_version,
  effective_from, proposed_monthly_price_micros, price_currency
)
VALUES
  ('planver_starter_2026_08_14_v1', 'plan_starter', 1,
    'cloudmarkup-beta-plans-2026-08-14-v2',
    '2026-08-14T00:00:00Z', 9000000, 'USD'),
  ('planver_pro_2026_08_14_v2', 'plan_pro', 2,
    'cloudmarkup-beta-plans-2026-08-14-v2',
    '2026-08-14T00:00:00Z', 39000000, 'USD');

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
      'planver_starter_2026_08_14_v1',
      ARRAY[
        'manual-editing', 'read-existing-projects',
        'existing-artifact-access', 'data-export', 'zip-export',
        'diagram-export', 'terraform', 'ai-assisted-operations'
      ]::TEXT[]
    ),
    (
      'planver_pro_2026_08_14_v2',
      ARRAY[
        'manual-editing', 'read-existing-projects',
        'existing-artifact-access', 'data-export', 'zip-export',
        'diagram-export', 'github-export', 'terraform',
        'validation-jobs', 'plan-evidence-workflows',
        'deployment-evidence-workflows', 'ai-assisted-operations'
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
  ('planver_starter_2026_08_14_v1', 'projects', 'organization', 'none', 5),
  ('planver_starter_2026_08_14_v1', 'active-members', 'organization', 'none', 1),
  ('planver_starter_2026_08_14_v1', 'active-owners', 'organization', 'none', 1),
  ('planver_starter_2026_08_14_v1', 'active-administrators', 'organization', 'none', 1),
  ('planver_starter_2026_08_14_v1', 'active-editors', 'organization', 'none', 1),
  ('planver_starter_2026_08_14_v1', 'billable-seats', 'organization', 'none', 1),
  ('planver_starter_2026_08_14_v1', 'viewers', 'organization', 'none', 0),
  ('planver_starter_2026_08_14_v1', 'concurrent-ai-jobs', 'organization', 'none', 1),
  ('planver_pro_2026_08_14_v2', 'projects', 'organization', 'none', 25),
  ('planver_pro_2026_08_14_v2', 'active-members', 'organization', 'none', 1),
  ('planver_pro_2026_08_14_v2', 'active-owners', 'organization', 'none', 1),
  ('planver_pro_2026_08_14_v2', 'active-administrators', 'organization', 'none', 1),
  ('planver_pro_2026_08_14_v2', 'active-editors', 'organization', 'none', 1),
  ('planver_pro_2026_08_14_v2', 'billable-seats', 'organization', 'none', 1),
  ('planver_pro_2026_08_14_v2', 'viewers', 'organization', 'none', 0),
  ('planver_pro_2026_08_14_v2', 'concurrent-ai-jobs', 'organization', 'none', 2);

INSERT INTO commercial_plan_included_credit_grants (
  plan_version_id, grant_kind, credit_units
)
VALUES
  ('planver_starter_2026_08_14_v1', 'monthly', 200),
  ('planver_pro_2026_08_14_v2', 'monthly', 1000);

INSERT INTO commercial_plan_seat_rules (
  plan_version_id, billable_role_keys, included_billable_seats,
  maximum_billable_seats, maximum_nonbillable_viewers,
  additional_seat_enabled, additional_seat_monthly_price_micros,
  additional_seat_price_currency, additional_seat_credit_units
)
VALUES
  ('planver_starter_2026_08_14_v1',
    ARRAY['owner', 'administrator', 'editor'], 1, 1, 0,
    FALSE, NULL, NULL, NULL),
  ('planver_pro_2026_08_14_v2',
    ARRAY['owner', 'administrator', 'editor'], 1, 1, 0,
    FALSE, NULL, NULL, NULL);

ALTER TABLE organization_subscription_projections
  ADD COLUMN cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE billing_webhook_events
  ADD COLUMN provider_event_position VARCHAR(255),
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_attempted_at TIMESTAMPTZ,
  ADD CONSTRAINT billing_webhook_events_attempt_count_check
    CHECK (attempt_count >= 0),
  ADD CONSTRAINT billing_webhook_events_attempt_shape_check
    CHECK (
      (attempt_count = 0 AND last_attempted_at IS NULL)
      OR (attempt_count > 0 AND last_attempted_at IS NOT NULL)
    );

CREATE INDEX billing_webhook_events_retry_idx
  ON billing_webhook_events (received_at, webhook_event_id)
  WHERE lifecycle_status = 'received';

COMMENT ON TABLE billing_webhook_events IS
  'Verified provider-event idempotency, ordering, retry, and safe outcome evidence. Raw webhook payloads, signatures, payment details, API keys, and signing secrets are never stored.';

DO $$
DECLARE
  candidate_count INTEGER;
  constraint_name TEXT;
BEGIN
  SELECT COUNT(*), MIN(c.conname)
  INTO candidate_count, constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'audit_events'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%target_kind%';

  IF candidate_count <> 1 OR constraint_name IS NULL THEN
    RAISE EXCEPTION
      'expected exactly one audit target-kind check'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE format(
    'ALTER TABLE audit_events DROP CONSTRAINT %I',
    constraint_name
  );
END;
$$;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_target_kind_v2_check
  CHECK (target_kind IN (
    'organization', 'membership', 'project', 'draft', 'revision', 'artifact',
    'integration', 'billing-account', 'job'
  ));
