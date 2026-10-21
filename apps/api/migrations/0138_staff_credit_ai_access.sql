-- Additive hosted policy packet. Release atomically with runtime consumers after
-- the release owner reconciles the reserved 0137 predecessor and closed helpers.
-- No grant, ledger, subscription or trial is created or rewritten here.
INSERT INTO commercial_plan_definitions(plan_id,plan_key,display_name)
 VALUES('plan_staff_credits','staff-credits','Credits only');
INSERT INTO commercial_plan_versions(plan_version_id,plan_id,version_number,configuration_version,effective_from,proposed_monthly_price_micros,price_currency)
 VALUES('planver_staff_credits_2026_10_15_v1','plan_staff_credits',1,'cloudmarkup-staff-credits-v1','2026-10-15T00:00:00Z',0,'USD');
INSERT INTO commercial_plan_feature_entitlements(plan_version_id,feature_key,entitlement_state)
 SELECT 'planver_staff_credits_2026_10_15_v1',feature_key,
   CASE WHEN feature_key='ai-assisted-operations' THEN 'enabled' ELSE 'disabled' END
 FROM commercial_plan_feature_entitlements WHERE plan_version_id='planver_pro_2026_09_30_v5';
INSERT INTO commercial_plan_numeric_limits(plan_version_id,limit_key,limit_scope,period_kind,limit_value)
 VALUES('planver_staff_credits_2026_10_15_v1','concurrent-ai-jobs','organization','none',1);
INSERT INTO commercial_plan_seat_rules(plan_version_id,billable_role_keys,included_billable_seats,maximum_billable_seats,maximum_nonbillable_viewers,additional_seat_enabled)
 VALUES('planver_staff_credits_2026_10_15_v1',ARRAY['owner','administrator','editor'],1,1,0,false);

-- This is provenance for AI-only access, not a balance. Expiry, adjustment,
-- reservation and settlement continue to be evaluated by the canonical ledger.
-- An exhausted grant never manufactures recurring credit or paid features.
CREATE FUNCTION cloudmarkup_staff_credit_grant_v1(org VARCHAR, grant_id VARCHAR)
 RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=ANY(ARRAY[to_regclass('credit_grants'),to_regclass('platform_staff_account_actions'),to_regclass('usage_ledger_entries')]) AND (relrowsecurity OR relforcerowsecurity)) THEN
   RAISE EXCEPTION 'Staff credit provenance rejects unexpected RLS' USING ERRCODE='42501';
 END IF;
 RETURN EXISTS(SELECT 1 FROM credit_grants g
 JOIN platform_staff_account_actions a ON a.organization_id=g.organization_id
   AND a.billing_account_id=g.billing_account_id AND a.credit_grant_id=g.credit_grant_id
 JOIN usage_ledger_entries l ON l.organization_id=g.organization_id AND l.ledger_entry_id=a.ledger_entry_id
 WHERE g.organization_id=org AND g.credit_grant_id=grant_id
   AND g.grant_kind='promotional' AND g.grant_policy_version='cloudmarkup-staff-credits-v1'
   AND g.created_by_actor_kind='internal-accounting' AND g.created_by_actor_id=a.principal_id
   AND g.source_reference='staff-action:'||a.action_id AND a.action='grant-credits'
   AND a.receipt_json->>'creditGrantId'=g.credit_grant_id
   AND (a.receipt_json->>'creditUnits')::bigint=g.credit_units
   AND l.entry_kind='grant' AND l.credit_grant_id=g.credit_grant_id
   AND l.granted_credit_units=g.credit_units);
END;
$$;
CREATE FUNCTION cloudmarkup_staff_credit_access_v1(org VARCHAR, billing VARCHAR)
 RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=ANY(ARRAY[to_regclass('organization_subscription_projections'),to_regclass('organization_entitlement_snapshots'),to_regclass('platform_staff_trials'),to_regclass('billing_provider_cutovers')]) AND (relrowsecurity OR relforcerowsecurity)) THEN
   RAISE EXCEPTION 'Staff credit access rejects unexpected RLS' USING ERRCODE='42501';
 END IF;
 RETURN NOT EXISTS(SELECT 1 FROM organization_subscription_projections p
   WHERE p.organization_id=org AND p.billing_account_id=billing AND p.normalized_status='active'
     AND p.provider_environment=CASE WHEN EXISTS(SELECT 1 FROM billing_provider_cutovers) THEN 'live' ELSE 'test' END)
   AND NOT cloudmarkup_staff_trial_current_v1(org,billing)
   AND EXISTS(SELECT 1 FROM credit_grants g WHERE g.organization_id=org AND g.billing_account_id=billing
     AND cloudmarkup_staff_credit_grant_v1(g.organization_id,g.credit_grant_id));
END;
$$;
-- Pin the migrator's exact schema, with temp objects last. This also permits the
-- existing isolated PostgreSQL harness to apply the unchanged packet privately.
DO $policy$
BEGIN
 EXECUTE format('ALTER FUNCTION cloudmarkup_staff_credit_grant_v1(varchar,varchar) SET search_path=pg_catalog,%I,pg_temp',current_schema());
 EXECUTE format('ALTER FUNCTION cloudmarkup_staff_credit_access_v1(varchar,varchar) SET search_path=pg_catalog,%I,pg_temp',current_schema());
END $policy$;

-- Closed model lock successors belong to the same atomic hosted packet. The
-- historical component harness uses a private schema and does not claim native
-- role-topology admission. A hosted/public migration must find the frozen 0136
-- private schema; missing topology is an error, never a runtime fallback.
DO $staff_model_policy$
BEGIN
 IF current_schema()='public' THEN
   IF to_regnamespace('cloudmarkup_model_private') IS NULL THEN
     RAISE EXCEPTION 'Staff credit policy requires the protected model helper predecessor';
   END IF;
   EXECUTE $staff_model_definition$
CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_snapshot_account(text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['organization_billing_accounts','organization_entitlement_snapshots']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT a.billing_account_id,e.plan_version_id FROM public.organization_billing_accounts a LEFT JOIN public.organization_effective_entitlement_snapshots_v1 e ON e.organization_id=a.organization_id AND e.billing_account_id=a.billing_account_id WHERE a.organization_id=$1 FOR SHARE OF a
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_snapshot_account(text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_snapshot_account(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_snapshot_subscription_plan(text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['commercial_plan_definitions','commercial_plan_feature_entitlements','commercial_plan_versions','organization_billing_accounts','organization_entitlement_snapshots','organization_subscription_projections']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['effective_from','effective_until','effective_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT s.entitlement_snapshot_id,s.source_record_version::text,s.subscription_projection_id,
      s.plan_version_id,s.entitlement_policy_version,s.expensive_operations_enabled AS snapshot_enabled,
      a.lifecycle_status AS account_state,a.expensive_operations_enabled AS account_enabled,

      to_char(p.effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_until,d.plan_key,f.entitlement_state
     FROM public.organization_effective_entitlement_snapshots_v1 s
     JOIN public.organization_billing_accounts a ON a.organization_id=s.organization_id AND a.billing_account_id=s.billing_account_id

     JOIN public.organization_subscription_projections sub ON sub.organization_id=s.organization_id AND sub.subscription_projection_id=s.subscription_projection_id
       AND sub.record_version=s.source_record_version AND sub.plan_version_id=s.plan_version_id AND sub.normalized_status='active'
     JOIN public.commercial_plan_versions p ON p.plan_version_id=s.plan_version_id AND p.configuration_status='proposed-beta-example'
     JOIN public.commercial_plan_definitions d ON d.plan_id=p.plan_id
     JOIN public.commercial_plan_feature_entitlements f ON f.plan_version_id=s.plan_version_id AND f.feature_key='ai-assisted-operations'
     WHERE s.organization_id=$1 AND s.effective_at<=clock_timestamp() AND p.effective_from<=clock_timestamp()
       AND (p.effective_until IS NULL OR p.effective_until>clock_timestamp())

     FOR SHARE OF s,sub,p,d,f
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_snapshot_subscription_plan(text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_snapshot_subscription_plan(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_snapshot_trial_plan(text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['commercial_plan_definitions','commercial_plan_feature_entitlements','commercial_plan_versions','organization_billing_accounts','organization_entitlement_snapshots','organization_subscription_projections','platform_staff_trials']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['effective_from','effective_until','effective_at','expires_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT s.entitlement_snapshot_id,s.source_record_version::text,s.subscription_projection_id,
      s.plan_version_id,s.entitlement_policy_version,s.expensive_operations_enabled AS snapshot_enabled,
      a.lifecycle_status AS account_state,a.expensive_operations_enabled AS account_enabled,
      t.trial_id,to_char(t.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS trial_expires_at,
      to_char(p.effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_until,d.plan_key,f.entitlement_state
     FROM public.organization_effective_entitlement_snapshots_v1 s
     JOIN public.organization_billing_accounts a ON a.organization_id=s.organization_id AND a.billing_account_id=s.billing_account_id
     JOIN public.platform_staff_trials t ON t.organization_id=s.organization_id AND t.billing_account_id=s.billing_account_id
     LEFT JOIN public.organization_subscription_projections sub ON sub.organization_id=s.organization_id AND sub.subscription_projection_id=s.subscription_projection_id
       AND sub.record_version=s.source_record_version AND sub.plan_version_id=s.plan_version_id AND sub.normalized_status='active'
     JOIN public.commercial_plan_versions p ON p.plan_version_id=s.plan_version_id AND p.configuration_status='proposed-beta-example'
     JOIN public.commercial_plan_definitions d ON d.plan_id=p.plan_id
     JOIN public.commercial_plan_feature_entitlements f ON f.plan_version_id=s.plan_version_id AND f.feature_key='ai-assisted-operations'
     WHERE s.organization_id=$1 AND s.effective_at<=clock_timestamp() AND p.effective_from<=clock_timestamp()
       AND (p.effective_until IS NULL OR p.effective_until>clock_timestamp())
       AND s.subscription_projection_id IS NULL AND public.cloudmarkup_staff_trial_current_v1(s.organization_id,s.billing_account_id)
     FOR SHARE OF s,p,d,f
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_snapshot_trial_plan(text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_snapshot_trial_plan(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_snapshot_staff_credit_plan(text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['commercial_plan_definitions','commercial_plan_feature_entitlements','commercial_plan_versions','organization_billing_accounts','organization_entitlement_snapshots','organization_subscription_projections']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['effective_from','effective_until','effective_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT s.entitlement_snapshot_id,s.source_record_version::text,s.subscription_projection_id,
      s.plan_version_id,s.entitlement_policy_version,s.expensive_operations_enabled AS snapshot_enabled,
      a.lifecycle_status AS account_state,a.expensive_operations_enabled AS account_enabled,

      to_char(p.effective_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_until,d.plan_key,f.entitlement_state
     FROM public.organization_effective_entitlement_snapshots_v1 s
     JOIN public.organization_billing_accounts a ON a.organization_id=s.organization_id AND a.billing_account_id=s.billing_account_id

     LEFT JOIN public.organization_subscription_projections sub ON sub.organization_id=s.organization_id AND sub.subscription_projection_id=s.subscription_projection_id
       AND sub.record_version=s.source_record_version AND sub.plan_version_id=s.plan_version_id AND sub.normalized_status='active'
     JOIN public.commercial_plan_versions p ON p.plan_version_id=s.plan_version_id AND p.configuration_status='proposed-beta-example'
     JOIN public.commercial_plan_definitions d ON d.plan_id=p.plan_id
     JOIN public.commercial_plan_feature_entitlements f ON f.plan_version_id=s.plan_version_id AND f.feature_key='ai-assisted-operations'
     WHERE s.organization_id=$1 AND s.effective_at<=clock_timestamp() AND p.effective_from<=clock_timestamp()
       AND (p.effective_until IS NULL OR p.effective_until>clock_timestamp())

     AND s.subscription_projection_id IS NULL AND public.cloudmarkup_staff_credit_access_v1(s.organization_id,s.billing_account_id)
     FOR SHARE OF s,p,d,f
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_snapshot_staff_credit_plan(text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_snapshot_staff_credit_plan(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_available_credit_grants(text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['credit_grants','credit_reservation_allocations','credit_reservations','usage_ledger_entries','usage_ledger_entry_allocations','organization_entitlement_snapshots']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['starts_at','expires_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT g.credit_grant_id, g.organization_id, g.billing_account_id,
                  g.plan_version_id, g.grant_kind, g.credit_units,
                  g.starts_at, g.expires_at, g.consumption_priority,
                  g.source_reference,
                  (CASE WHEN g.grant_kind = 'administrative'
                    THEN 0 ELSE g.credit_units END)
                    - COALESCE((
                        SELECT SUM(a.settled_credit_units)
                        FROM public.credit_reservation_allocations a
                        JOIN public.credit_reservations r
                          ON r.organization_id = a.organization_id
                         AND r.reservation_id = a.reservation_id
                        WHERE a.organization_id = g.organization_id
                          AND a.credit_grant_id = g.credit_grant_id
                          AND r.status = 'settled'
                      ), 0)
                    - COALESCE((
                        SELECT SUM(a.reserved_credit_units)
                        FROM public.credit_reservation_allocations a
                        JOIN public.credit_reservations r
                          ON r.organization_id = a.organization_id
                         AND r.reservation_id = a.reservation_id
                        WHERE a.organization_id = g.organization_id
                          AND a.credit_grant_id = g.credit_grant_id
                          AND r.status = 'active'
                      ), 0)
                    + COALESCE((
                        SELECT SUM(allocation.credit_adjustment_units)
                        FROM public.usage_ledger_entry_allocations allocation
                        JOIN public.usage_ledger_entries event
                          ON event.organization_id = allocation.organization_id
                         AND event.ledger_entry_id = allocation.ledger_entry_id
                        WHERE allocation.organization_id = g.organization_id
                          AND allocation.credit_grant_id = g.credit_grant_id
                          AND event.entry_kind = 'adjustment'
                      ), 0) AS available_credit_units
           FROM public.credit_grants g
           WHERE g.organization_id = $1
             AND g.starts_at <= CURRENT_TIMESTAMP
             AND g.expiration_policy_kind <> 'unresolved'
             AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP)
             AND ($2 <> 'planver_staff_trial_2026_10_06_v1' OR public.cloudmarkup_staff_trial_grant_available_v1(g.organization_id,g.credit_grant_id))
             AND (((g.grant_policy_version = 'cloudmarkup-staff-trial-v1') = ($2 = 'planver_staff_trial_2026_10_06_v1'))
               OR ($2 = 'planver_staff_trial_2026_10_06_v1' AND g.grant_policy_version='cloudmarkup-staff-credits-v1'))
             AND (g.grant_policy_version IN ('cloudmarkup-staff-trial-v1','cloudmarkup-staff-credits-v1') OR NOT EXISTS(SELECT 1 FROM public.organization_entitlement_snapshots trial_snapshot WHERE trial_snapshot.organization_id=g.organization_id AND trial_snapshot.plan_version_id='planver_staff_trial_2026_10_06_v1'))
           ORDER BY g.expires_at NULLS LAST, g.consumption_priority,
                    g.starts_at, g.credit_grant_id
           FOR UPDATE OF g
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_available_credit_grants(text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_available_credit_grants(text,text) FROM PUBLIC;
$staff_model_definition$;
 END IF;
END $staff_model_policy$;
REVOKE ALL ON FUNCTION cloudmarkup_staff_credit_grant_v1(varchar,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION cloudmarkup_staff_credit_access_v1(varchar,varchar) FROM PUBLIC;

-- Retain the actual snapshot identity and all historical subscription/trial
-- evidence. Only the effective policy changes when paid/trial access is absent.
CREATE VIEW organization_effective_entitlement_snapshots_v1 WITH(security_invoker=true) AS
 SELECT s.organization_id,s.entitlement_snapshot_id,s.billing_account_id,
   CASE WHEN access.staff_credits THEN NULL ELSE s.subscription_projection_id END AS subscription_projection_id,
   CASE WHEN access.staff_credits THEN 'planver_staff_credits_2026_10_15_v1' ELSE s.plan_version_id END AS plan_version_id,
   s.entitlement_policy_version,s.source_record_version,
   CASE WHEN access.staff_credits THEN true ELSE s.expensive_operations_enabled END AS expensive_operations_enabled,
   s.record_version,s.effective_at,s.updated_at,s.storage_contract_version
 FROM organization_entitlement_snapshots s
 CROSS JOIN LATERAL(SELECT cloudmarkup_staff_credit_access_v1(s.organization_id,s.billing_account_id) AS staff_credits) access;

-- Audited complimentary funds may supplement an already authorized trial's AI
-- budget. They neither create nor extend that trial or any other trial feature.
CREATE OR REPLACE FUNCTION enforce_staff_trial_allocation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE is_trial BOOLEAN; trial_plan BOOLEAN; staff_funding BOOLEAN; ai_feature BOOLEAN;
BEGIN
 SELECT g.grant_policy_version='cloudmarkup-staff-trial-v1',r.plan_version_id='planver_staff_trial_2026_10_06_v1',
   cloudmarkup_staff_credit_grant_v1(g.organization_id,g.credit_grant_id),r.feature_key='ai-assisted-operations'
 INTO is_trial,trial_plan,staff_funding,ai_feature
 FROM credit_grants g JOIN credit_reservations r ON r.organization_id=g.organization_id
 WHERE g.organization_id=NEW.organization_id AND g.credit_grant_id=NEW.credit_grant_id AND r.reservation_id=NEW.reservation_id;
 IF is_trial IS DISTINCT FROM trial_plan AND NOT(trial_plan AND staff_funding AND ai_feature) THEN
   RAISE EXCEPTION 'Trial and paid credit allocations cannot mix';
 END IF;
 IF trial_plan AND NOT cloudmarkup_staff_trial_current_v1(NEW.organization_id,
   (SELECT billing_account_id FROM credit_reservations WHERE organization_id=NEW.organization_id AND reservation_id=NEW.reservation_id)) THEN
   RAISE EXCEPTION 'Trial credit admission expired or revoked';
 END IF;
 RETURN NEW;
END $$;

DO $policy$
DECLARE runtime_role TEXT;
BEGIN
 FOREACH runtime_role IN ARRAY ARRAY['cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_billing_runtime','cloudmarkup_beta_export_runtime'] LOOP
   IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=runtime_role) THEN
     EXECUTE format('GRANT SELECT ON organization_effective_entitlement_snapshots_v1 TO %I',runtime_role);
     EXECUTE format('GRANT EXECUTE ON FUNCTION cloudmarkup_staff_credit_grant_v1(varchar,varchar),cloudmarkup_staff_credit_access_v1(varchar,varchar) TO %I',runtime_role);
   END IF;
 END LOOP;
END $policy$;
