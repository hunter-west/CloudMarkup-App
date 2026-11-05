-- Audited staff grants admit exports without a paid subscription or trial.
-- Add an immutable successor; preserve all predecessor plan/financial records.
-- No role, grant, ledger, subscription, trial or helper permission changes.
DO $staff_credit_exports$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM commercial_plan_versions v
    JOIN commercial_plan_seat_rules s ON s.plan_version_id=v.plan_version_id
    WHERE v.plan_version_id='planver_staff_credits_2026_10_15_v1'
      AND v.plan_id='plan_staff_credits' AND v.version_number=1
      AND v.configuration_status='proposed-beta-example'
      AND v.configuration_version='cloudmarkup-staff-credits-v1'
      AND s.included_billable_seats=1 AND s.maximum_billable_seats=1
      AND s.maximum_nonbillable_viewers=0 AND NOT s.additional_seat_enabled
  ) THEN
    RAISE EXCEPTION 'Staff-funded exports require the reviewed credit predecessor';
  END IF;
END
$staff_credit_exports$;

INSERT INTO commercial_plan_versions
  (plan_version_id,plan_id,version_number,configuration_version,effective_from,
   proposed_monthly_price_micros,price_currency)
SELECT 'planver_staff_credits_2026_11_05_v2',plan_id,2,
  'cloudmarkup-staff-credits-v2','2026-11-05T00:00:00Z',
  proposed_monthly_price_micros,price_currency
FROM commercial_plan_versions
WHERE plan_version_id='planver_staff_credits_2026_10_15_v1';

INSERT INTO commercial_plan_feature_entitlements
  (plan_version_id,feature_key,entitlement_state)
SELECT 'planver_staff_credits_2026_11_05_v2',feature_key,
  CASE WHEN feature_key IN (
    'data-export','zip-export','cloudformation','terraform',
    'diagram-export','validation-jobs'
  ) THEN 'enabled' ELSE entitlement_state END
FROM commercial_plan_feature_entitlements
WHERE plan_version_id='planver_staff_credits_2026_10_15_v1';

INSERT INTO commercial_plan_numeric_limits
  (plan_version_id,limit_key,limit_scope,period_kind,limit_value)
SELECT 'planver_staff_credits_2026_11_05_v2',limit_key,limit_scope,period_kind,limit_value
FROM commercial_plan_numeric_limits
WHERE plan_version_id='planver_staff_credits_2026_10_15_v1';

INSERT INTO commercial_plan_seat_rules
  (plan_version_id,billable_role_keys,included_billable_seats,
   maximum_billable_seats,maximum_nonbillable_viewers,additional_seat_enabled)
SELECT 'planver_staff_credits_2026_11_05_v2',billable_role_keys,included_billable_seats,
  maximum_billable_seats,maximum_nonbillable_viewers,additional_seat_enabled
FROM commercial_plan_seat_rules
WHERE plan_version_id='planver_staff_credits_2026_10_15_v1';

-- Express that same seat rule in the domain's numeric-limit contract.
INSERT INTO commercial_plan_numeric_limits
  (plan_version_id,limit_key,limit_scope,period_kind,limit_value)
SELECT s.plan_version_id,l.limit_key,'organization','none',l.limit_value
FROM commercial_plan_seat_rules s
CROSS JOIN LATERAL (VALUES
  ('active-members',s.maximum_billable_seats+s.maximum_nonbillable_viewers),
  ('active-owners',s.maximum_billable_seats),
  ('active-administrators',s.maximum_billable_seats),
  ('active-editors',s.maximum_billable_seats),
  ('billable-seats',s.maximum_billable_seats),
  ('viewers',s.maximum_nonbillable_viewers)
) l(limit_key,limit_value)
WHERE s.plan_version_id='planver_staff_credits_2026_11_05_v2';

-- Preserve security-invoker posture, column identity, owner and existing ACLs.
-- Audited grant provenance still yields to active paid or trial access.
CREATE OR REPLACE VIEW organization_effective_entitlement_snapshots_v1
WITH(security_invoker=true) AS
SELECT s.organization_id,s.entitlement_snapshot_id,s.billing_account_id,
  CASE WHEN access.staff_credits THEN NULL ELSE s.subscription_projection_id END AS subscription_projection_id,
  CASE WHEN access.staff_credits THEN 'planver_staff_credits_2026_11_05_v2' ELSE s.plan_version_id END AS plan_version_id,
  s.entitlement_policy_version,s.source_record_version,
  CASE WHEN access.staff_credits THEN true ELSE s.expensive_operations_enabled END AS expensive_operations_enabled,
  s.record_version,s.effective_at,s.updated_at,s.storage_contract_version
FROM organization_entitlement_snapshots s
CROSS JOIN LATERAL (
  SELECT cloudmarkup_staff_credit_access_v1(s.organization_id,s.billing_account_id) AS staff_credits
) access;
