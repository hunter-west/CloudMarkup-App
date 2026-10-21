-- Definition-only private model helpers. No runtime grant, role, membership or RLS activation.
CREATE SCHEMA IF NOT EXISTS cloudmarkup_model_private AUTHORIZATION cloudmarkup_admin;
REVOKE ALL ON SCHEMA cloudmarkup_model_private FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_pricing_version(text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_provider_pricing_versions']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['effective_from','effective_until','created_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT pricing_version_id, provider_key, model_key, model_version, inference_profile_id, environment, effective_from, effective_until, pricing_status, cost_currency, input_micros_per_million_units, output_micros_per_million_units, cache_read_micros_per_million_units, cache_write_micros_per_million_units, provider_specific_unit_rates, to_jsonb(model_provider_pricing_versions)->'long_context_pricing' AS long_context_pricing, created_at FROM public.model_provider_pricing_versions WHERE pricing_version_id = $1 FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_pricing_version(text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_pricing_version(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_normalization_version(text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['credit_normalization_policy_versions']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['effective_from','effective_until','created_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT normalization_policy_version_id, cost_currency, effective_from, effective_until, policy_status, operating_buffer_basis_points, credit_unit_micros, created_at FROM public.credit_normalization_policy_versions WHERE normalization_policy_version_id = $1 FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_normalization_version(text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_normalization_version(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_usage_detail(text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_usage_event_details','usage_ledger_entries']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['occurred_at','started_at','completed_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT detail.model_usage_event_id, detail.model_usage_idempotency_key_sha256, detail.ledger_entry_id, detail.model_route, detail.model_route_id, detail.inference_profile_id, detail.prompt_id, detail.prompt_version, detail.template_id, detail.template_version, detail.model_pricing_version_id AS pricing_version_id, detail.normalization_policy_version_id, detail.environment, detail.input_units, detail.output_units, detail.cache_read_units, detail.cache_write_units, detail.total_units, detail.provider_specific_units, detail.estimated_provider_cost_micros, detail.reserved_credit_units, detail.charged_credit_units, detail.compensated_credit_units, detail.started_at, detail.completed_at, detail.latency_milliseconds, detail.lifecycle_status, detail.failure_category, detail.attempts, detail.multi_call_workflow_id, detail.reconciliation_state, event.organization_id, event.acting_principal_id, event.project_id, event.job_id, event.feature_key, event.request_id, event.reservation_id, event.provider_key, event.model_key, event.model_version, detail.occurred_at FROM public.model_usage_event_details detail JOIN public.usage_ledger_entries event ON event.organization_id = detail.organization_id AND event.ledger_entry_id = detail.ledger_entry_id WHERE detail.organization_id = $1 AND (detail.model_usage_event_id = $2 OR detail.model_usage_idempotency_key_sha256 = $3) FOR UPDATE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_usage_detail(text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_usage_detail(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_accounting_workflow(text,text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_commercial_workflows']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT snapshot,snapshot_sha256 FROM public.model_commercial_workflows
          WHERE organization_id=$1 AND scope_sha256=$2 AND workflow_id=$3 AND project_id=$4 AND principal_id=$5 FOR UPDATE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_accounting_workflow(text,text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_accounting_workflow(text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_accounting_runtime(text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_runtime_admissions']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT snapshot,snapshot_sha256 FROM public.model_runtime_admissions
          WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4 FOR UPDATE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_accounting_runtime(text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_accounting_runtime(text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_accounting_authorization(text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['memberships','organization_roles','organizations','principals','projects']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT 1 FROM public.memberships m
          JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
          JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
          JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
          JOIN public.projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'
          WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'
          AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
          AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[] FOR SHARE OF m,p,o,r,pr
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_accounting_authorization(text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_accounting_authorization(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_accounting_billing_id(text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['organization_billing_accounts']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT billing_account_id FROM public.organization_billing_accounts WHERE organization_id=$1 FOR UPDATE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_accounting_billing_id(text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_accounting_billing_id(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_live_terminal_journal(text,text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_live_invocations']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['created_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT organization_id,project_id,principal_id,invocation_id,scope_sha256,workflow_id,reservation_id,dispatch_intent_id,binding_sha256,binding,callback_metadata,gateway_state,gateway_claim,normalized_usage,generation_evidence,output_sha256,output_bytes,created_at FROM public.model_live_invocations WHERE organization_id=$1 AND scope_sha256=$2 AND workflow_id=$3 AND project_id=$4 AND principal_id=$5 FOR UPDATE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_live_terminal_journal(text,text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_live_terminal_journal(text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_preview_terminal_binding(text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['ai_intent_previews']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT binding,binding_sha256 FROM public.ai_intent_previews
      WHERE organization_id=$1 AND scope_sha256=$2 AND workflow_id=$3 FOR UPDATE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_preview_terminal_binding(text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_preview_terminal_binding(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_evidence_authorization(text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['memberships','organization_roles','organizations','principals','projects']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT r.role_key,to_json(r.capabilities)::text AS capabilities FROM public.memberships m
      JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
      JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
      JOIN public.projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'
      WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active' FOR SHARE OF m,p,o,r,pr
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_evidence_authorization(text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_evidence_authorization(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_preview_authorization(text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['memberships','organization_roles','organizations','principals','projects']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT 1 AS authorized FROM public.memberships m
          JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
          JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
          JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
          JOIN public.projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'
          WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'
            AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
            AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
          FOR SHARE OF m,p,o,r,pr
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_preview_authorization(text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_preview_authorization(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_preview_workflow_presence(text,text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_commercial_workflows']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT 1 FROM public.model_commercial_workflows
            WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3
              AND workflow_id=$4 AND scope_sha256=$5 FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_preview_workflow_presence(text,text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_preview_workflow_presence(text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_preview_row(text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['ai_intent_previews']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['delivery_opened_at','delivery_expires_at','acknowledged_at','created_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT organization_id,project_id,principal_id,invocation_id,scope_sha256,workflow_id,reservation_id,dispatch_intent_id,idempotency_sha256,binding_sha256,binding,callback_metadata,gateway_state,gateway_claim,normalized_usage,generation_evidence,output_sha256,output_bytes,output_evidence_sha256,delivery_state,delivery_proof_sha256,delivery_opened_at,delivery_expires_at,acknowledged_at,created_at,
      to_char(delivery_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expiry_iso
      FROM public.ai_intent_previews WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4 FOR UPDATE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_preview_row(text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_preview_row(text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_preview_canonical_workflow(text,text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_commercial_workflows']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['lease_expires_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT snapshot,lease_expires_at>clock_timestamp() AS lease_active
      FROM public.model_commercial_workflows WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3
        AND workflow_id=$4 AND scope_sha256=$5 FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_preview_canonical_workflow(text,text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_preview_canonical_workflow(text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_evaluation_authorization(text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['memberships','organization_roles','organizations','principals','project_content_write_scopes','projects']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['closed_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT r.role_key FROM public.memberships m
      JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
      JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      JOIN public.projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'
      WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'
      AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
      AND NOT EXISTS(SELECT 1 FROM public.project_content_write_scopes f
        WHERE f.organization_id=pr.organization_id AND f.project_id=pr.project_id AND f.closed_at IS NOT NULL)
      FOR SHARE OF m,p,o,r,pr
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_evaluation_authorization(text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_evaluation_authorization(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_admission_authorization(text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['memberships','organization_roles','organizations','principals','projects']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT 1 AS authorized FROM public.memberships m
          JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
          JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
          JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
          JOIN public.projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'
          WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'
          AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
          AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
          FOR SHARE OF m,p,o,r,pr
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_admission_authorization(text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_admission_authorization(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_usage_ledger_identity(text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['usage_ledger_entries']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['occurred_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (

  SELECT ledger_entry_id, usage_ledger_entries.organization_id, entry_kind, reservation_id,
         credit_grant_id, related_ledger_entry_id, acting_principal_id,
         entitlement_policy_version, idempotency_key_sha256,
         charging_scenario,
         recorded_by_actor_kind, recorded_by_actor_id, project_id,
         feature_key, request_id, job_id, plan_version_id,
         pricing_version_id, provider_key, model_key, model_version,
         provider_request_id, input_token_count, output_token_count,
         cached_input_token_count, latency_milliseconds,
         estimated_provider_cost_micros, provider_cost_currency,
         normalized_credit_units,
         granted_credit_units,
         reserved_credit_units, settled_credit_units,
         released_credit_units, expired_credit_units,
         credit_adjustment_units, outcome, reason_code, safe_reason,
         charging_policy_version, occurred_at
  FROM public.usage_ledger_entries

           WHERE organization_id = $1
             AND (ledger_entry_id = $2 OR idempotency_key_sha256 = $3)
           FOR UPDATE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_usage_ledger_identity(text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_usage_ledger_identity(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_available_credit_grants(text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['credit_grants','credit_reservation_allocations','credit_reservations','usage_ledger_entries','usage_ledger_entry_allocations']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
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
             AND ((g.grant_policy_version = 'cloudmarkup-staff-trial-v1') = ($2 = 'planver_staff_trial_2026_10_06_v1'))
           ORDER BY g.expires_at NULLS LAST, g.consumption_priority,
                    g.starts_at, g.credit_grant_id
           FOR UPDATE OF g
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_available_credit_grants(text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_available_credit_grants(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_billing_account(text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['organization_billing_accounts']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT billing_account_id, organization_id, lifecycle_status,
              expensive_operations_enabled, record_version
       FROM public.organization_billing_accounts
       WHERE organization_id = $1
       FOR UPDATE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_billing_account(text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_billing_account(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_preview_request_project(text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['memberships','organization_roles','organizations','principals','projects']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT p.current_draft_id FROM public.projects p
      JOIN public.organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
      JOIN public.principals actor ON actor.principal_id=$3 AND actor.lifecycle_status='active'
      JOIN public.memberships m ON m.organization_id=p.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
      JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      WHERE p.organization_id=$1 AND p.project_id=$2 AND p.lifecycle_status='active'
        AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
        AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
      FOR UPDATE OF p FOR SHARE OF o,actor,m,r
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_preview_request_project(text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_preview_request_project(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_preview_request_lease(text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['project_editing_leases']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['expires_at','authentication_expires_at','released_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT lease_id,principal_id,session_id,token_sha256,
      to_char(LEAST(expires_at,authentication_expires_at,$3::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expiry_iso
      FROM public.project_editing_leases WHERE organization_id=$1 AND project_id=$2
        AND released_at IS NULL AND expires_at>clock_timestamp() AND authentication_expires_at>clock_timestamp()
      FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_preview_request_lease(text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_preview_request_lease(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_preview_request_draft(text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['architecture_drafts','stored_objects']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT d.draft_id,d.draft_version::text,d.content_sha256
      FROM public.architecture_drafts d JOIN public.stored_objects o ON o.organization_id=d.organization_id AND o.project_id=d.project_id AND o.object_id=d.document_object_id
      WHERE d.organization_id=$1 AND d.project_id=$2 AND d.draft_id=$3 AND d.pending_document_object_id IS NULL
        AND o.lifecycle_state='published' AND o.content_sha256=d.content_sha256 AND o.object_purpose='architecture-draft'
      FOR SHARE OF d,o
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_preview_request_draft(text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_preview_request_draft(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_preview_request_receipt(text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['ai_intent_preview_authorities']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['authentication_expires_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT binding_sha256,draft_id,draft_version::text,content_sha256,lease_id,session_sha256,
        to_char(authentication_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS authentication_expiry_iso
        FROM public.ai_intent_preview_authorities WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4 FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_preview_request_receipt(text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_preview_request_receipt(text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_live_journal_workflow(text,text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_commercial_workflows']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['lease_expires_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT snapshot,snapshot_sha256,lease_expires_at>clock_timestamp() AS active
          FROM public.model_commercial_workflows WHERE organization_id=$1 AND project_id=$2
          AND principal_id=$3 AND workflow_id=$4 AND scope_sha256=$5 FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_live_journal_workflow(text,text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_live_journal_workflow(text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_live_journal_runtime(text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_runtime_admissions']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['lease_expires_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT snapshot,snapshot_sha256,lease_expires_at>clock_timestamp() AS active
          FROM public.model_runtime_admissions WHERE organization_id=$1 AND project_id=$2
          AND principal_id=$3 AND scope_sha256=$4 FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_live_journal_runtime(text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_live_journal_runtime(text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_live_journal_reservation(text,text,text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_commercial_reservation_decisions']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT live_binding,live_binding_sha256,accepted FROM public.model_commercial_reservation_decisions
          WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3
          AND workflow_id=$4 AND scope_sha256=$5 AND mapping_version=$6 FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_live_journal_reservation(text,text,text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_live_journal_reservation(text,text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.read_live_journal_final_lease(text,text,text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_commercial_workflows','model_runtime_admissions']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['lease_expires_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT (w.lease_expires_at>clock_timestamp() AND r.lease_expires_at>clock_timestamp()) AS active FROM public.model_commercial_workflows w JOIN public.model_runtime_admissions r ON r.organization_id=w.organization_id AND r.project_id=w.project_id AND r.principal_id=w.principal_id WHERE w.organization_id=$1 AND w.project_id=$2 AND w.principal_id=$3 AND w.workflow_id=$4 AND w.scope_sha256=$5 AND r.scope_sha256=$6
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.read_live_journal_final_lease(text,text,text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.read_live_journal_final_lease(text,text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_snapshot_account(text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['organization_billing_accounts','organization_entitlement_snapshots']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT a.billing_account_id,e.plan_version_id FROM public.organization_billing_accounts a LEFT JOIN public.organization_entitlement_snapshots e ON e.organization_id=a.organization_id AND e.billing_account_id=a.billing_account_id WHERE a.organization_id=$1 FOR SHARE OF a
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
     FROM public.organization_entitlement_snapshots s
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
     FROM public.organization_entitlement_snapshots s
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

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_snapshot_numeric_limits(text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['commercial_plan_numeric_limits']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT limit_key,limit_scope,period_kind,limit_value::text FROM public.commercial_plan_numeric_limits WHERE plan_version_id=$1 FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_snapshot_numeric_limits(text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_snapshot_numeric_limits(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_snapshot_admitted_runtime(text,text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_runtime_admissions']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN e.key=ANY(ARRAY['lease_expires_at']) AND jsonb_typeof(e.value)='string' THEN to_jsonb(to_char((e.value#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT organization_id,project_id,principal_id,scope_sha256,snapshot,snapshot_sha256,revision::text,active_concurrency_lease_id,
       to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS lease_expires_at FROM public.model_runtime_admissions
       WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4
       AND lease_expires_at>clock_timestamp()
       AND snapshot->>'fingerprint'=$5 AND snapshot->'recoveryRequired'='false'::jsonb
       AND snapshot#>'{executionLease,recoveryOnly}'='false'::jsonb
       AND snapshot#>>'{decision,outcome}'='allowed' AND snapshot->'terminal'='null'::jsonb
       AND (snapshot->>'commercialExpiresAt')::timestamptz>clock_timestamp() FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_snapshot_admitted_runtime(text,text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_snapshot_admitted_runtime(text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_model_private.lock_selected_invocation_set(text,text,text,text) RETURNS TABLE(model_private_row jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $model$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['model_live_invocation_sets']) AND (c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Private model fixed lock rejects unexpected RLS' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT (SELECT jsonb_object_agg(e.key,CASE WHEN jsonb_typeof(e.value)='number' THEN to_jsonb(e.value::text) ELSE e.value END)
    FROM jsonb_each(to_jsonb(fixed_row)) e) FROM (
SELECT organization_id,project_id,principal_id,plan_sha256,set_id,set_sha256,set_record FROM public.model_live_invocation_sets WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND plan_sha256=$4 FOR SHARE
  ) fixed_row;
END;
$model$;
ALTER FUNCTION cloudmarkup_model_private.lock_selected_invocation_set(text,text,text,text) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_model_private.lock_selected_invocation_set(text,text,text,text) FROM PUBLIC;
