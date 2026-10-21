-- Approved Pro allowance successor: $39/month, 1,250 monthly credits.
-- Existing versions, subscriptions, grants and ledger entries are immutable.
INSERT INTO commercial_plan_versions (
  plan_version_id, plan_id, version_number, configuration_version,
  effective_from, proposed_monthly_price_micros, price_currency
)
SELECT 'planver_pro_2026_09_30_v5', plan_id, 5,
       'cloudmarkup-beta-credit-plans-2026-09-30-v1',
       '2026-09-30T00:00:00Z', proposed_monthly_price_micros, price_currency
FROM commercial_plan_versions WHERE plan_version_id='planver_pro_2026_09_12_v4';

INSERT INTO commercial_plan_feature_entitlements(plan_version_id,feature_key,entitlement_state)
SELECT 'planver_pro_2026_09_30_v5',feature_key,entitlement_state
FROM commercial_plan_feature_entitlements WHERE plan_version_id='planver_pro_2026_09_12_v4';

INSERT INTO commercial_plan_numeric_limits(plan_version_id,limit_key,limit_scope,period_kind,limit_value)
SELECT 'planver_pro_2026_09_30_v5',limit_key,limit_scope,period_kind,limit_value
FROM commercial_plan_numeric_limits WHERE plan_version_id='planver_pro_2026_09_12_v4';

INSERT INTO commercial_plan_included_credit_grants(plan_version_id,grant_kind,credit_units)
SELECT 'planver_pro_2026_09_30_v5',grant_kind,
       CASE WHEN grant_kind='monthly' THEN 1250 ELSE credit_units END
FROM commercial_plan_included_credit_grants WHERE plan_version_id='planver_pro_2026_09_12_v4';

INSERT INTO commercial_plan_seat_rules(
  plan_version_id,billable_role_keys,included_billable_seats,maximum_billable_seats,
  maximum_nonbillable_viewers,additional_seat_enabled
)
SELECT 'planver_pro_2026_09_30_v5',billable_role_keys,included_billable_seats,maximum_billable_seats,
       maximum_nonbillable_viewers,additional_seat_enabled
FROM commercial_plan_seat_rules WHERE plan_version_id='planver_pro_2026_09_12_v4';

-- Admit the successor without weakening recipient, role, expiry or seat checks.
CREATE OR REPLACE FUNCTION validate_organization_invitation_acceptance_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_limit BIGINT; current_members BIGINT;
BEGIN
  IF NEW.lifecycle_state<>'accepted' THEN RETURN NULL; END IF;
  PERFORM 1 FROM organization_billing_accounts WHERE organization_id=NEW.organization_id FOR UPDATE;
  SELECT limits.limit_value INTO member_limit
  FROM organization_billing_accounts account
  JOIN organization_subscription_projections subscription ON subscription.organization_id=account.organization_id AND subscription.billing_account_id=account.billing_account_id
  JOIN organization_entitlement_snapshots snapshot ON snapshot.organization_id=account.organization_id AND snapshot.billing_account_id=account.billing_account_id AND snapshot.subscription_projection_id=subscription.subscription_projection_id AND snapshot.plan_version_id=subscription.plan_version_id AND snapshot.source_record_version=subscription.record_version
  JOIN commercial_plan_versions plan ON plan.plan_version_id=subscription.plan_version_id
  JOIN commercial_plan_numeric_limits limits ON limits.plan_version_id=plan.plan_version_id AND limits.limit_key='active-members' AND limits.limit_scope='organization' AND limits.period_kind='none'
  WHERE account.organization_id=NEW.organization_id AND account.lifecycle_status='active'
    AND subscription.normalized_status='active' AND subscription.billable_seat_quantity=1
    AND subscription.current_period_start<=clock_timestamp() AND subscription.current_period_end>clock_timestamp()
    AND subscription.effective_at<=clock_timestamp() AND snapshot.effective_at<=clock_timestamp()
    AND snapshot.entitlement_policy_version='cloudmarkup-entitlements-v1'
    AND (SELECT count(*) FROM commercial_plan_feature_entitlements feature WHERE feature.plan_version_id=plan.plan_version_id AND feature.feature_key IN ('shared-projects','organization-roles') AND feature.entitlement_state='enabled')=2
    AND plan.configuration_status='proposed-beta-example' AND plan.effective_from<=clock_timestamp()
    AND (plan.effective_until IS NULL OR plan.effective_until>clock_timestamp())
    AND (
      (plan.configuration_version='cloudmarkup-beta-sharing-plans-2026-09-07-v1'
        AND ((plan.plan_version_id='planver_starter_2026_09_07_v2' AND limits.limit_value=3)
          OR (plan.plan_version_id='planver_pro_2026_09_07_v3' AND limits.limit_value=10)))
      OR (plan.configuration_version='cloudmarkup-beta-cloudformation-plans-2026-09-12-v1'
        AND plan.plan_version_id='planver_pro_2026_09_12_v4' AND limits.limit_value=10)
      OR (plan.configuration_version='cloudmarkup-beta-credit-plans-2026-09-30-v1'
        AND plan.plan_version_id='planver_pro_2026_09_30_v5' AND limits.limit_value=10)
    );
  IF member_limit IS NULL OR NEW.expires_at<=clock_timestamp() OR NEW.accepted_auth_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'invitation acceptance authority is unavailable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organizations organization
    JOIN memberships issuer ON issuer.organization_id=organization.organization_id
    JOIN principals principal ON principal.principal_id=issuer.principal_id
    JOIN organization_roles role ON role.organization_id=issuer.organization_id AND role.role_key=issuer.role_key
    WHERE organization.organization_id=NEW.organization_id AND organization.lifecycle_status='active'
      AND issuer.membership_id=NEW.issuer_membership_id AND issuer.principal_id=NEW.issuer_principal_id
      AND issuer.lifecycle_status='active' AND principal.lifecycle_status='active'
      AND role.policy_version='authorization-v2' AND role.capabilities=cloudmarkup_authorization_v2_permissions(role.role_key)
      AND (issuer.role_key='owner' OR (issuer.role_key='administrator' AND NEW.target_role IN ('editor','viewer')))
  ) OR NOT EXISTS (
    SELECT 1 FROM memberships member JOIN principals principal ON principal.principal_id=member.principal_id
    WHERE member.organization_id=NEW.organization_id AND member.membership_id=NEW.accepted_membership_id
      AND member.principal_id=NEW.accepted_principal_id AND member.lifecycle_status='active' AND principal.lifecycle_status='active'
  ) THEN RAISE EXCEPTION 'invitation acceptance authority is unavailable' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO current_members FROM memberships WHERE organization_id=NEW.organization_id AND lifecycle_status='active';
  IF current_members>member_limit THEN RAISE EXCEPTION 'organization member limit reached' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
