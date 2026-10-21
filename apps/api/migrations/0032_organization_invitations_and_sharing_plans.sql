-- Owner-approved 3/10 included members; additive plans and invitation metadata only.
-- Never rewrite the historical plans, provider quantities, prices or credit grants.
INSERT INTO commercial_plan_versions (
  plan_version_id, plan_id, version_number, configuration_version,
  effective_from, proposed_monthly_price_micros, price_currency
)
SELECT successor.id, source.plan_id, successor.version,
       'cloudmarkup-beta-sharing-plans-2026-09-07-v1',
       '2026-09-07T14:35:22Z', source.proposed_monthly_price_micros, source.price_currency
FROM (VALUES
  ('planver_starter_2026_08_14_v1','planver_starter_2026_09_07_v2',2),
  ('planver_pro_2026_08_14_v2','planver_pro_2026_09_07_v3',3)
) successor(old_id,id,version)
JOIN commercial_plan_versions source ON source.plan_version_id=successor.old_id;

INSERT INTO commercial_plan_feature_entitlements(plan_version_id,feature_key,entitlement_state)
SELECT successor.id, source.feature_key,
       CASE WHEN source.feature_key IN ('shared-projects','organization-roles') THEN 'enabled'
            ELSE source.entitlement_state END
FROM (VALUES
  ('planver_starter_2026_08_14_v1','planver_starter_2026_09_07_v2'),
  ('planver_pro_2026_08_14_v2','planver_pro_2026_09_07_v3')
) successor(old_id,id)
JOIN commercial_plan_feature_entitlements source ON source.plan_version_id=successor.old_id;

INSERT INTO commercial_plan_numeric_limits(plan_version_id,limit_key,limit_scope,period_kind,limit_value)
SELECT successor.id, source.limit_key, source.limit_scope, source.period_kind,
       CASE WHEN source.limit_key IN ('active-members','active-owners','active-administrators','active-editors','billable-seats','viewers')
            THEN successor.members ELSE source.limit_value END
FROM (VALUES
  ('planver_starter_2026_08_14_v1','planver_starter_2026_09_07_v2',3),
  ('planver_pro_2026_08_14_v2','planver_pro_2026_09_07_v3',10)
) successor(old_id,id,members)
JOIN commercial_plan_numeric_limits source ON source.plan_version_id=successor.old_id;

INSERT INTO commercial_plan_included_credit_grants(plan_version_id,grant_kind,credit_units)
SELECT successor.id, source.grant_kind, source.credit_units
FROM (VALUES
  ('planver_starter_2026_08_14_v1','planver_starter_2026_09_07_v2'),
  ('planver_pro_2026_08_14_v2','planver_pro_2026_09_07_v3')
) successor(old_id,id)
JOIN commercial_plan_included_credit_grants source ON source.plan_version_id=successor.old_id;

INSERT INTO commercial_plan_seat_rules(
  plan_version_id,billable_role_keys,included_billable_seats,maximum_billable_seats,
  maximum_nonbillable_viewers,additional_seat_enabled
) VALUES
  ('planver_starter_2026_09_07_v2',ARRAY['owner','administrator','editor'],3,3,3,FALSE),
  ('planver_pro_2026_09_07_v3',ARRAY['owner','administrator','editor'],10,10,10,FALSE);

CREATE TABLE organization_invitations (
  invitation_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  issuer_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  issuer_membership_id VARCHAR(128) NOT NULL,
  target_role VARCHAR(32) NOT NULL,
  token_sha256 CHAR(64) NOT NULL UNIQUE,
  request_sha256 CHAR(64) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_principal_id VARCHAR(128) REFERENCES principals(principal_id),
  accepted_membership_id VARCHAR(128),
  accepted_at TIMESTAMPTZ,
  accepted_auth_expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK (invitation_id ~ '^invitation_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
  CHECK (target_role IN ('administrator','editor','viewer')),
  CHECK (token_sha256 ~ '^[a-f0-9]{64}$' AND request_sha256 ~ '^[a-f0-9]{64}$' AND idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '24 hours'),
  CHECK (
    (lifecycle_state='pending' AND accepted_principal_id IS NULL AND accepted_membership_id IS NULL AND accepted_at IS NULL AND accepted_auth_expires_at IS NULL AND revoked_at IS NULL)
    OR (lifecycle_state='revoked' AND revoked_at IS NOT NULL AND accepted_principal_id IS NULL AND accepted_membership_id IS NULL AND accepted_at IS NULL AND accepted_auth_expires_at IS NULL)
    OR (lifecycle_state='accepted' AND revoked_at IS NULL AND accepted_principal_id IS NOT NULL AND accepted_membership_id IS NOT NULL AND accepted_at IS NOT NULL AND accepted_auth_expires_at IS NOT NULL AND accepted_auth_expires_at > accepted_at AND accepted_at < expires_at)
  ),
  UNIQUE(organization_id,issuer_principal_id,idempotency_key_sha256),
  FOREIGN KEY(organization_id,issuer_membership_id) REFERENCES memberships(organization_id,membership_id),
  FOREIGN KEY(organization_id,accepted_membership_id) REFERENCES memberships(organization_id,membership_id)
);

CREATE FUNCTION guard_organization_invitation_identity_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'invitation history is retained' USING ERRCODE='23514';
  END IF;
  IF OLD.lifecycle_state<>'pending' OR
     (to_jsonb(NEW)-ARRAY['lifecycle_state','accepted_principal_id','accepted_membership_id','accepted_at','accepted_auth_expires_at','revoked_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['lifecycle_state','accepted_principal_id','accepted_membership_id','accepted_at','accepted_auth_expires_at','revoked_at'])
  THEN RAISE EXCEPTION 'invitation identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_invitation_identity_v1 BEFORE UPDATE OR DELETE ON organization_invitations
FOR EACH ROW EXECUTE FUNCTION guard_organization_invitation_identity_v1();

-- Adapter acquires this same account lock before invitation or membership writes.
-- Deferred revalidation catches expiry during any pending COMMIT work.
CREATE FUNCTION validate_organization_invitation_acceptance_v1() RETURNS trigger LANGUAGE plpgsql AS $$
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
    AND plan.configuration_version='cloudmarkup-beta-sharing-plans-2026-09-07-v1'
    AND plan.configuration_status='proposed-beta-example' AND plan.effective_from<=clock_timestamp()
    AND (plan.effective_until IS NULL OR plan.effective_until>clock_timestamp())
    AND ((plan.plan_version_id='planver_starter_2026_09_07_v2' AND limits.limit_value=3) OR (plan.plan_version_id='planver_pro_2026_09_07_v3' AND limits.limit_value=10));
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

CREATE CONSTRAINT TRIGGER organization_invitation_acceptance_v1 AFTER INSERT OR UPDATE ON organization_invitations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_organization_invitation_acceptance_v1();
