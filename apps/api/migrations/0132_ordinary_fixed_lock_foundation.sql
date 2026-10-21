-- Source definitions only. Runtime grants and protected-column permissions remain disabled.
-- Existing migration runners own each transaction and ledger write.

CREATE SCHEMA IF NOT EXISTS cloudmarkup_ordinary_private AUTHORIZATION cloudmarkup_admin;

REVOKE ALL ON SCHEMA cloudmarkup_ordinary_private FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_billing_account(p1 text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_billing_runtime') OR current_database() <> 'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.organization_billing_accounts'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg('fixed'::text ORDER BY 'fixed'::text),'[]'::jsonb)::text
    FROM (
SELECT billing_account_id, organization_id, lifecycle_status,
              expensive_operations_enabled, record_version
       FROM public.organization_billing_accounts
       WHERE organization_id = p1
       FOR UPDATE
    ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_billing_account(text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_billing_account(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_subscription_plan(p1 text,p2 text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_billing_runtime') OR current_database() <> 'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.commercial_plan_seat_rules'::regclass,'public.commercial_plan_versions'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg('fixed'::text ORDER BY 'fixed'::text),'[]'::jsonb)::text
    FROM (
SELECT seats.included_billable_seats, seats.maximum_billable_seats,
                  version.configuration_version, seats.additional_seat_enabled
           FROM public.commercial_plan_versions version
           JOIN public.commercial_plan_seat_rules seats
             ON seats.plan_version_id = version.plan_version_id
           WHERE version.plan_version_id = p1
             AND version.configuration_status = 'proposed-beta-example'
             AND version.effective_from <= p2::timestamptz
             AND (version.effective_until IS NULL
               OR version.effective_until > p2::timestamptz)
           FOR SHARE
    ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_subscription_plan(text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_subscription_plan(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_credit_grant_replay(p1 text,p2 text,p3 text,p4 text,p5 text,p6 text,p7 text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_billing_runtime') OR current_database() <> 'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.credit_grants'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.credit_grant_id ORDER BY locked.credit_grant_id),'[]'::jsonb)::text
    FROM (
SELECT credit_grant_id, organization_id, billing_account_id,
                  plan_version_id, grant_kind, credit_units, starts_at,
                  expires_at, expiration_policy_kind,
                  expiration_policy_version, subscription_period_id,
                  subscription_period_start, subscription_period_end,
                  consumption_priority, source_reference,
                  grant_policy_version
           FROM public.credit_grants
           WHERE organization_id = p1
             AND (
               idempotency_key_sha256 = p2
               OR (p3::VARCHAR IS NOT NULL
                 AND grant_kind = p5
                 AND source_reference = p3)
               OR (p4::VARCHAR IS NOT NULL AND subscription_period_id = p4)
               OR (
                 p5 = 'one-time' AND grant_kind = 'one-time'
                 AND plan_version_id = p6
                 AND grant_policy_version = p7
               )
             )
           FOR UPDATE
    ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_credit_grant_replay(text,text,text,text,text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_credit_grant_replay(text,text,text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_ledger_replay(p1 text,p2 text,p3 text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_billing_runtime') OR current_database() <> 'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.usage_ledger_entries'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.ledger_entry_id ORDER BY locked.ledger_entry_id),'[]'::jsonb)::text
    FROM (
SELECT ledger_entry_id, entry_kind, credit_grant_id,
                    acting_principal_id, recorded_by_actor_kind,
                    recorded_by_actor_id, plan_version_id,
                    granted_credit_units, credit_adjustment_units, outcome,
                    charging_policy_version, reason_code, safe_reason,
                    related_ledger_entry_id
             FROM public.usage_ledger_entries
             WHERE organization_id = p1
               AND (ledger_entry_id = p2 OR idempotency_key_sha256 = p3)
             FOR UPDATE
    ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_ledger_replay(text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_ledger_replay(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_included_grant_plan(p1 text,p2 text,p3 text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_billing_runtime') OR current_database() <> 'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.commercial_plan_included_credit_grants'::regclass,'public.commercial_plan_versions'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg('fixed'::text ORDER BY 'fixed'::text),'[]'::jsonb)::text
    FROM (
SELECT included.credit_units
             FROM public.commercial_plan_included_credit_grants included
             JOIN public.commercial_plan_versions version
               ON version.plan_version_id = included.plan_version_id
             WHERE included.plan_version_id = p1
               AND included.grant_kind = p2
               AND version.configuration_status = 'proposed-beta-example'
               AND version.effective_from <= p3::timestamptz
               AND (version.effective_until IS NULL
                 OR version.effective_until > p3::timestamptz)
             FOR SHARE OF included, version
    ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_included_grant_plan(text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_included_grant_plan(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_top_up_account(p1 text,p2 text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_billing_runtime') OR current_database() <> 'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.organization_billing_accounts'::regclass,'public.organizations'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg('fixed'::text ORDER BY 'fixed'::text),'[]'::jsonb)::text
    FROM (
SELECT a.lifecycle_status,o.lifecycle_status AS organization_state FROM public.organization_billing_accounts a
     JOIN public.organizations o ON o.organization_id=a.organization_id WHERE a.organization_id=p1 AND a.billing_account_id=p2 FOR UPDATE OF a FOR SHARE OF o
    ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_top_up_account(text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_top_up_account(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_proposal_job_authority(p1 text,p2 text,p3 text,p4 text,p5 text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_proposal_runtime') OR current_database() <> 'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.async_jobs'::regclass,'public.memberships'::regclass,'public.organization_roles'::regclass,'public.organizations'::regclass,'public.principals'::regclass,'public.projects'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.membership_id ORDER BY locked.membership_id),'[]'::jsonb)::text
    FROM (
SELECT j.created_by_principal_id,j.correlation_id,m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json
    FROM public.async_jobs j
    JOIN public.projects p ON p.organization_id=j.organization_id AND p.project_id=j.project_id AND p.lifecycle_status='active'
    JOIN public.principals actor ON actor.principal_id=j.created_by_principal_id AND actor.lifecycle_status='active'
    JOIN public.memberships m ON m.organization_id=j.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
    JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
    WHERE j.organization_id=p1 AND j.project_id=p2 AND j.job_id=p3 AND j.family='architecture-proposal'
      AND j.input_sha256=p4 AND j.correlation_id=p5 AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL
      AND j.idempotency_actor_id=j.created_by_principal_id AND j.idempotency_scope='cloudmarkup.beta-infrastructure-proposals.create'
    FOR SHARE OF p,actor,m,o,r
    ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_proposal_job_authority(text,text,text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_proposal_job_authority(text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_export_worker_authority(p1 text,p2 text,p3 text,p4 text,p5 text,p6 text,p7 text,p8 text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_export_runtime') OR current_database() <> 'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.async_job_attempts'::regclass,'public.async_jobs'::regclass,'public.memberships'::regclass,'public.organization_roles'::regclass,'public.organizations'::regclass,'public.principals'::regclass,'public.projects'::regclass,'public.solution_export_runs'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.membership_id ORDER BY locked.membership_id),'[]'::jsonb)::text
    FROM (
SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json,
      j.correlation_id,j.lifecycle_status AS root_state,a.lifecycle_status AS attempt_state,
      a.lease_expires_at > clock_timestamp() AS lease_current,
      (j.expires_at IS NULL OR j.expires_at > clock_timestamp()) AS job_current,
      j.cancellation_requested_at IS NOT NULL AS cancellation_requested
      FROM public.solution_export_runs x
      JOIN public.async_jobs j ON j.organization_id=x.organization_id AND j.project_id=x.project_id AND j.job_id=x.root_job_id
      JOIN public.async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id
      JOIN public.projects p ON p.organization_id=x.organization_id AND p.project_id=x.project_id AND p.lifecycle_status='active'
      JOIN public.principals actor ON actor.principal_id=x.created_by_principal_id AND actor.lifecycle_status='active'
      JOIN public.memberships m ON m.organization_id=x.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
      JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
      WHERE x.organization_id=p1 AND x.project_id=p2 AND x.solution_export_run_id=p3
        AND x.created_by_principal_id=p4 AND j.created_by_principal_id=p4 AND j.idempotency_actor_id=p4
        AND j.family='solution-export-orchestration' AND j.input_sha256=p5
        AND j.solution_revision_id=x.solution_revision_id AND j.solution_manifest_sha256=x.solution_manifest_sha256
        AND j.input_object_id=x.orchestration_input_object_id AND j.input_sha256=x.orchestration_input_sha256
        AND a.attempt_id=p6 AND a.attempt_number=(p7::integer) AND a.worker_reference=p8
        AND a.attempt_number=(SELECT max(current_attempt.attempt_number) FROM public.async_job_attempts current_attempt
          WHERE current_attempt.organization_id=j.organization_id AND current_attempt.job_id=j.job_id)
      FOR SHARE OF p,actor,m,o,r
    ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_export_worker_authority(text,text,text,text,text,text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_export_worker_authority(text,text,text,text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_request_membership(p1 text,p2 text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime') OR current_database() <> 'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.memberships'::regclass,'public.organization_roles'::regclass,'public.organizations'::regclass,'public.principals'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.membership_id ORDER BY locked.membership_id),'[]'::jsonb)::text
    FROM (
SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json FROM public.memberships m
      JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
      JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
      WHERE m.principal_id=p1 AND m.organization_id=p2 AND m.lifecycle_status='active' FOR SHARE OF m,p,o,r
    ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_request_membership(text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_request_membership(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_project_scope(p_org text,p_project text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
 IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime','cloudmarkup_beta_billing_runtime') OR current_database()<>'cloudmarkup' THEN RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.projects'::regclass AND (relrowsecurity OR relforcerowsecurity)) THEN RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT COALESCE(jsonb_agg(locked.key ORDER BY locked.key),'[]'::jsonb)::text FROM (SELECT 'fixed'::text AS key FROM public.projects WHERE organization_id=p_org AND project_id=p_project FOR SHARE) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_project_scope(text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_project_scope(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_writer_scope(p_org text,p_project text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
 IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime') OR current_database()<>'cloudmarkup' THEN RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.project_content_write_scopes'::regclass AND (relrowsecurity OR relforcerowsecurity)) THEN RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT COALESCE(jsonb_agg(locked.key ORDER BY locked.key),'[]'::jsonb)::text FROM (SELECT 'fixed'::text AS key FROM public.project_content_write_scopes WHERE organization_id=p_org AND project_id=p_project FOR UPDATE) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_writer_scope(text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_writer_scope(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_cleanup_control()
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
 IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime','cloudmarkup_beta_billing_runtime') OR current_database()<>'cloudmarkup' THEN RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.project_cleanup_controls'::regclass AND (relrowsecurity OR relforcerowsecurity)) THEN RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT COALESCE(jsonb_agg(locked.key ORDER BY locked.key),'[]'::jsonb)::text FROM (SELECT 'fixed'::text AS key FROM public.project_cleanup_controls WHERE control_id='beta' FOR SHARE) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_cleanup_control() OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_cleanup_control() FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_staging_membership(p_org text,p_principal text,p_membership text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
 IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime') OR current_database()<>'cloudmarkup' THEN RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=ANY(ARRAY['public.memberships'::regclass,'public.principals'::regclass,'public.organizations'::regclass,'public.organization_roles'::regclass]) AND (relrowsecurity OR relforcerowsecurity)) THEN RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT COALESCE(jsonb_agg(locked.key ORDER BY locked.key),'[]'::jsonb)::text FROM (SELECT m.membership_id::text AS key FROM public.memberships m
        JOIN public.principals actor ON actor.principal_id=m.principal_id AND actor.lifecycle_status='active'
        JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
        JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
          AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
        WHERE m.organization_id=p_org AND m.principal_id=p_principal AND m.membership_id=p_membership
          AND m.lifecycle_status='active' AND ('projects.create'=ANY(r.capabilities)
            OR 'projects.mutate'=ANY(r.capabilities) OR 'exports.run'=ANY(r.capabilities))
        FOR SHARE OF m,actor,o,r) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_staging_membership(text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_staging_membership(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_staging_project(p_project text)
RETURNS TABLE(locked_keys_json text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
 IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime') OR current_database()<>'cloudmarkup' THEN RAISE EXCEPTION 'Ordinary lock authority unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=ANY(ARRAY['public.projects'::regclass]) AND (relrowsecurity OR relforcerowsecurity)) THEN RAISE EXCEPTION 'Ordinary lock requires reviewed row security' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT COALESCE(jsonb_agg(locked.key ORDER BY locked.key),'[]'::jsonb)::text FROM (SELECT organization_id::text AS key FROM public.projects WHERE project_id=p_project FOR SHARE) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_staging_project(text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_staging_project(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_proposal_baseline(p1 text,p2 text,p3 text,p4 text,p5 text)
RETURNS TABLE(locked_keys_json text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime') OR current_database()<>'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary reference authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.projects'::regclass,'public.architecture_drafts'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary reference requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.draft_id ORDER BY locked.draft_id),'[]'::jsonb)::text FROM (
SELECT d.draft_id,d.draft_version::text,d.content_sha256,d.document_object_id
        FROM public.projects p JOIN public.architecture_drafts d
          ON d.organization_id=p.organization_id AND d.project_id=p.project_id AND d.draft_id=p.current_draft_id
        WHERE p.organization_id=p1 AND p.project_id=p2 AND p.lifecycle_status='active'
          AND d.draft_id=p3 AND d.draft_version=p4::bigint AND d.content_sha256=p5
          AND d.pending_draft_version IS NULL AND d.pending_document_object_id IS NULL
        FOR SHARE OF p,d
  ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_proposal_baseline(text,text,text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_proposal_baseline(text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_staff_authority(p1 text)
RETURNS TABLE(locked_keys_json text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime') OR current_database()<>'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary reference authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.platform_staff_authorizations'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary reference requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg('fixed'::text ORDER BY 'fixed'::text),'[]'::jsonb)::text FROM (
SELECT permissions FROM public.platform_staff_authorizations WHERE principal_id=p1 AND revoked_at IS NULL FOR SHARE
  ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_staff_authority(text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_staff_authority(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_staff_financial_reference(p1 text,p2 text,p3 text,p4 text)
RETURNS TABLE(locked_keys_json text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime') OR current_database()<>'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary reference authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.organization_subscription_projections'::regclass,'public.organization_entitlement_snapshots'::regclass,'public.billing_provider_cutovers'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary reference requires reviewed row security' USING ERRCODE='42501';
  END IF;
  IF p1='staff-active-plan' AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.subscription_projection_id ORDER BY locked.subscription_projection_id),'[]'::jsonb)::text FROM (
SELECT subscription_projection_id FROM public.organization_subscription_projections WHERE organization_id=p2 AND billing_account_id=p3 AND normalized_status='active' AND provider_environment=CASE WHEN EXISTS(SELECT 1 FROM public.billing_provider_cutovers) THEN 'live' ELSE 'test' END FOR SHARE
  ) locked;
  ELSIF p1='staff-paid-entitlement' AND p2 IS NOT NULL AND p3 IS NULL AND p4 IS NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.entitlement_snapshot_id ORDER BY locked.entitlement_snapshot_id),'[]'::jsonb)::text FROM (
SELECT e.entitlement_snapshot_id,e.record_version::text,e.entitlement_policy_version,p.subscription_projection_id,p.plan_version_id,p.record_version::text AS source_record_version,p.normalized_status FROM public.organization_entitlement_snapshots e JOIN public.organization_subscription_projections p ON p.organization_id=e.organization_id AND p.billing_account_id=e.billing_account_id AND p.subscription_projection_id=e.subscription_projection_id WHERE e.organization_id=p2 FOR UPDATE OF e,p
  ) locked;
  ELSIF p1='staff-trial-state' AND p2 IS NOT NULL AND p3 IS NULL AND p4 IS NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg('fixed'::text ORDER BY 'fixed'::text),'[]'::jsonb)::text FROM (
SELECT normalized_status FROM public.organization_subscription_projections WHERE organization_id=p2 FOR SHARE
  ) locked;
  ELSIF p1='entitlement-source' AND p2 IS NOT NULL AND p3 IS NULL AND p4 IS NOT NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.subscription_projection_id ORDER BY locked.subscription_projection_id),'[]'::jsonb)::text FROM (
SELECT subscription_projection_id, organization_id,
                  billing_account_id, billing_provider,
                  provider_customer_reference,
                  provider_subscription_reference,
                  provider_product_reference, provider_price_reference,
                  last_provider_event_reference, provider_event_position,
                  normalized_status, plan_version_id,
                  billable_seat_quantity, current_period_id,
                  current_period_start, current_period_end,
                  cancel_at_period_end, effective_at, record_version
           FROM public.organization_subscription_projections
           WHERE organization_id = p2
             AND subscription_projection_id = p4
           FOR UPDATE
  ) locked;
  ELSE
    RAISE EXCEPTION 'Ordinary financial reference operation unavailable' USING ERRCODE='42501';
  END IF;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_staff_financial_reference(text,text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_staff_financial_reference(text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_billing_account_share(p1 text)
RETURNS TABLE(locked_keys_json text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
BEGIN
  IF session_user::text NOT IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime') OR current_database()<>'cloudmarkup' THEN
    RAISE EXCEPTION 'Ordinary reference authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.organization_billing_accounts'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary reference requires reviewed row security' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT COALESCE(jsonb_agg('fixed'::text ORDER BY 'fixed'::text),'[]'::jsonb)::text FROM (
SELECT organization_id FROM public.organization_billing_accounts WHERE organization_id=p1 FOR SHARE
  ) locked;
END
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_billing_account_share(text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_billing_account_share(text) FROM PUBLIC;
