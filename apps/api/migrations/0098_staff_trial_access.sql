-- Independent staff trials: no account grant or staff permission is seeded.
ALTER TABLE platform_staff_authorizations DROP CONSTRAINT platform_staff_authorizations_permissions_check;
ALTER TABLE platform_staff_authorizations ADD CONSTRAINT platform_staff_authorizations_permissions_check
 CHECK(cardinality(permissions) BETWEEN 1 AND 6 AND permissions <@ ARRAY['accounts.read','credits.grant','credits.revoke','operations.manage','trials.grant','trials.revoke']::TEXT[]);
ALTER TABLE platform_staff_account_actions DROP CONSTRAINT platform_staff_account_actions_action_check;
ALTER TABLE platform_staff_account_actions ADD CONSTRAINT platform_staff_account_actions_action_check
 CHECK(action IN ('grant-credits','revoke-credits','set-operations','grant-trial','revoke-trial'));
CREATE TABLE platform_staff_trials (
 trial_id VARCHAR(128) PRIMARY KEY,
 storage_contract_version SMALLINT NOT NULL DEFAULT 1 CHECK(storage_contract_version=1),
 organization_id VARCHAR(128) NOT NULL UNIQUE,
 billing_account_id VARCHAR(128) NOT NULL UNIQUE,
 credit_grant_id VARCHAR(128) NOT NULL UNIQUE,
 granted_action_id VARCHAR(128) NOT NULL UNIQUE REFERENCES platform_staff_account_actions(action_id) DEFERRABLE INITIALLY DEFERRED,
 revoked_action_id VARCHAR(128) UNIQUE REFERENCES platform_staff_account_actions(action_id) DEFERRABLE INITIALLY DEFERRED,
 starts_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL CHECK(expires_at>starts_at AND expires_at<=starts_at+interval '720 hours'),
 credit_units BIGINT NOT NULL CHECK(credit_units BETWEEN 1 AND 1000),
 FOREIGN KEY(organization_id,billing_account_id) REFERENCES organization_billing_accounts(organization_id,billing_account_id),
 FOREIGN KEY(organization_id,credit_grant_id) REFERENCES credit_grants(organization_id,credit_grant_id)
);
CREATE FUNCTION enforce_staff_trial_transition_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Trial history is immutable'; END IF;
 IF ROW(NEW.trial_id,NEW.storage_contract_version,NEW.organization_id,NEW.billing_account_id,NEW.credit_grant_id,NEW.granted_action_id,NEW.starts_at,NEW.expires_at,NEW.credit_units)
 IS DISTINCT FROM ROW(OLD.trial_id,OLD.storage_contract_version,OLD.organization_id,OLD.billing_account_id,OLD.credit_grant_id,OLD.granted_action_id,OLD.starts_at,OLD.expires_at,OLD.credit_units)
 OR OLD.revoked_action_id IS NOT NULL OR NEW.revoked_action_id IS NULL THEN RAISE EXCEPTION 'Invalid trial transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER platform_staff_trials_immutable BEFORE UPDATE OR DELETE ON platform_staff_trials FOR EACH ROW EXECUTE FUNCTION enforce_staff_trial_transition_v1();
INSERT INTO commercial_plan_definitions(plan_id,plan_key,display_name) VALUES('plan_staff_trial','staff-trial','Staff trial');
INSERT INTO commercial_plan_versions(plan_version_id,plan_id,version_number,configuration_version,effective_from,proposed_monthly_price_micros,price_currency)
 VALUES('planver_staff_trial_2026_10_06_v1','plan_staff_trial',1,'cloudmarkup-staff-trial-v1','2026-10-06T00:00:00Z',0,'USD');
INSERT INTO commercial_plan_feature_entitlements(plan_version_id,feature_key,entitlement_state)
 SELECT 'planver_staff_trial_2026_10_06_v1',feature_key,entitlement_state
 FROM commercial_plan_feature_entitlements WHERE plan_version_id='planver_pro_2026_09_30_v5';
INSERT INTO commercial_plan_numeric_limits(plan_version_id,limit_key,limit_scope,period_kind,limit_value)
 SELECT 'planver_staff_trial_2026_10_06_v1',limit_key,limit_scope,period_kind,limit_value
 FROM commercial_plan_numeric_limits WHERE plan_version_id='planver_pro_2026_09_30_v5';

-- Database-clock admission: conversion, expiry and revocation all fail closed.
CREATE FUNCTION cloudmarkup_staff_trial_current_v1(org VARCHAR, billing VARCHAR) RETURNS BOOLEAN LANGUAGE SQL AS $$
 SELECT EXISTS(SELECT 1 FROM platform_staff_trials t JOIN organization_entitlement_snapshots e ON e.organization_id=t.organization_id AND e.billing_account_id=t.billing_account_id
 WHERE t.organization_id=org AND t.billing_account_id=billing AND t.revoked_action_id IS NULL AND t.starts_at<=clock_timestamp() AND t.expires_at>clock_timestamp()
 AND e.subscription_projection_id IS NULL AND e.plan_version_id='planver_staff_trial_2026_10_06_v1'
 AND e.entitlement_policy_version='cloudmarkup-entitlements-v1' AND e.effective_at<=clock_timestamp());
$$;
CREATE FUNCTION cloudmarkup_staff_trial_grant_available_v1(org VARCHAR, grant_id VARCHAR) RETURNS BOOLEAN LANGUAGE SQL AS $$
 SELECT EXISTS(SELECT 1 FROM credit_grants g WHERE g.organization_id=org AND g.credit_grant_id=grant_id AND
 (g.grant_policy_version<>'cloudmarkup-staff-trial-v1' OR EXISTS(SELECT 1 FROM platform_staff_trials t WHERE t.organization_id=g.organization_id AND t.credit_grant_id=g.credit_grant_id AND cloudmarkup_staff_trial_current_v1(t.organization_id,t.billing_account_id))));
$$;
-- Every trial must commit with matching original ledger/grant and immutable audit.
CREATE FUNCTION enforce_staff_trial_evidence_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM credit_grants g JOIN platform_staff_account_actions a ON a.organization_id=g.organization_id AND a.credit_grant_id=g.credit_grant_id
 WHERE g.organization_id=NEW.organization_id AND g.billing_account_id=NEW.billing_account_id AND g.credit_grant_id=NEW.credit_grant_id
 AND g.grant_kind='promotional' AND g.grant_policy_version='cloudmarkup-staff-trial-v1' AND g.starts_at=NEW.starts_at AND g.expires_at=NEW.expires_at AND g.credit_units=NEW.credit_units
 AND a.action_id=NEW.granted_action_id AND a.action='grant-trial' AND a.receipt_json->>'trialId'=NEW.trial_id AND (a.receipt_json->>'trialExpiresAt')::timestamptz=NEW.expires_at AND (a.receipt_json->>'creditUnits')::bigint=NEW.credit_units AND g.created_by_actor_id=a.principal_id AND g.created_by_actor_kind='internal-accounting'
 AND EXISTS(SELECT 1 FROM usage_ledger_entries l WHERE l.organization_id=NEW.organization_id AND l.ledger_entry_id=a.ledger_entry_id AND l.entry_kind='grant' AND l.credit_grant_id=NEW.credit_grant_id AND l.granted_credit_units=NEW.credit_units))
 THEN RAISE EXCEPTION 'Trial grant audit evidence mismatch'; END IF;
 IF NEW.revoked_action_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform_staff_account_actions a WHERE a.action_id=NEW.revoked_action_id AND a.organization_id=NEW.organization_id AND a.billing_account_id=NEW.billing_account_id AND a.credit_grant_id=NEW.credit_grant_id AND a.action='revoke-trial' AND a.receipt_json->>'trialId'=NEW.trial_id)
 THEN RAISE EXCEPTION 'Trial revocation audit evidence mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER platform_staff_trials_evidence AFTER INSERT OR UPDATE ON platform_staff_trials DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_staff_trial_evidence_v1();

-- Defense in depth for old-runtime rollback: paid and trial allocations never mix.
CREATE FUNCTION enforce_staff_trial_allocation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE is_trial BOOLEAN; trial_plan BOOLEAN;
BEGIN
 SELECT g.grant_policy_version='cloudmarkup-staff-trial-v1', r.plan_version_id='planver_staff_trial_2026_10_06_v1' INTO is_trial,trial_plan
 FROM credit_grants g JOIN credit_reservations r ON r.organization_id=g.organization_id
 WHERE g.organization_id=NEW.organization_id AND g.credit_grant_id=NEW.credit_grant_id AND r.reservation_id=NEW.reservation_id;
 IF is_trial IS DISTINCT FROM trial_plan THEN RAISE EXCEPTION 'Trial and paid credit allocations cannot mix'; END IF;
 IF is_trial AND NOT cloudmarkup_staff_trial_grant_available_v1(NEW.organization_id,NEW.credit_grant_id) THEN RAISE EXCEPTION 'Trial credit admission expired or revoked'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_reservation_allocations_trial_guard BEFORE INSERT ON credit_reservation_allocations FOR EACH ROW EXECUTE FUNCTION enforce_staff_trial_allocation_v1();
INSERT INTO commercial_plan_seat_rules(plan_version_id,billable_role_keys,included_billable_seats,maximum_billable_seats,maximum_nonbillable_viewers,additional_seat_enabled)
 SELECT 'planver_staff_trial_2026_10_06_v1',billable_role_keys,included_billable_seats,maximum_billable_seats,maximum_nonbillable_viewers,additional_seat_enabled
 FROM commercial_plan_seat_rules WHERE plan_version_id='planver_pro_2026_09_30_v5';

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
  -- Independent trial sharing authority; keep all existing paid and issuer checks.
  IF member_limit IS NULL THEN
    SELECT limits.limit_value INTO member_limit
    FROM organization_billing_accounts account
    JOIN organization_entitlement_snapshots snapshot ON snapshot.organization_id=account.organization_id AND snapshot.billing_account_id=account.billing_account_id
    JOIN commercial_plan_versions plan ON plan.plan_version_id=snapshot.plan_version_id
    JOIN commercial_plan_numeric_limits limits ON limits.plan_version_id=plan.plan_version_id AND limits.limit_key='active-members' AND limits.limit_scope='organization' AND limits.period_kind='none'
    WHERE account.organization_id=NEW.organization_id AND account.lifecycle_status='active'
      AND cloudmarkup_staff_trial_current_v1(account.organization_id,account.billing_account_id)
      AND plan.plan_version_id='planver_staff_trial_2026_10_06_v1' AND plan.configuration_version='cloudmarkup-staff-trial-v1'
      AND plan.configuration_status='proposed-beta-example' AND plan.effective_from<=clock_timestamp()
      AND (plan.effective_until IS NULL OR plan.effective_until>clock_timestamp())
      AND limits.limit_value=10
      AND (SELECT count(*) FROM commercial_plan_feature_entitlements f WHERE f.plan_version_id=plan.plan_version_id AND f.feature_key IN ('shared-projects','organization-roles') AND f.entitlement_state='enabled')=2;
  END IF;
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

-- A rolled-back beta worker cannot dispatch a queued trial after its authority ends.
CREATE FUNCTION enforce_staff_trial_dispatch_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='reserved' AND NEW.state='dispatched' THEN
   PERFORM 1 FROM organization_billing_accounts WHERE organization_id=NEW.organization_id FOR SHARE;
   IF EXISTS(SELECT 1 FROM credit_reservations r WHERE r.organization_id=NEW.organization_id AND r.reservation_id=NEW.reservation_id AND r.plan_version_id='planver_staff_trial_2026_10_06_v1')
     AND NOT EXISTS(SELECT 1 FROM credit_reservations r JOIN organization_billing_accounts a ON a.organization_id=r.organization_id AND a.billing_account_id=r.billing_account_id
       WHERE r.organization_id=NEW.organization_id AND r.reservation_id=NEW.reservation_id AND r.status='active' AND r.expires_at>clock_timestamp()
       AND a.lifecycle_status='active' AND a.expensive_operations_enabled AND cloudmarkup_staff_trial_current_v1(r.organization_id,r.billing_account_id))
   THEN RAISE EXCEPTION 'Trial dispatch authority expired or revoked' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER beta_ai_invocations_trial_dispatch_guard BEFORE UPDATE ON beta_ai_invocations FOR EACH ROW EXECUTE FUNCTION enforce_staff_trial_dispatch_v1();
