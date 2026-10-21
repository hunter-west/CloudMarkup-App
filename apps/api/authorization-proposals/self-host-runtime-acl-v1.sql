-- REVIEW ONLY, UNARMED. Never loaded by automatic bootstrap or the API runtime.
-- Apply only through the separately approved operator/catalog qualification.
-- Purpose logins must already be provisioned with private passwords; no role
-- creation, memberships, database ownership transfer or hosted marker is made.
DO $self_host_runtime_acl_admission$
BEGIN
  IF session_user <> 'cloudmarkup_admin' OR current_user <> 'cloudmarkup_admin'
    OR pg_catalog.current_database() <> 'cloudmarkup'
    OR pg_catalog.current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR pg_catalog.current_setting('createrole_self_grant') <> ''
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('rdsadmin','rds_superuser'))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_database d ON d.datdba=r.oid
      WHERE r.rolname='cloudmarkup_admin' AND d.datname=pg_catalog.current_database()
        AND r.rolcanlogin AND r.rolcreaterole AND NOT r.rolsuper AND NOT r.rolinherit
        AND NOT r.rolbypassrls AND NOT r.rolreplication AND NOT r.rolcreatedb)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.oid=c.relowner
      WHERE c.oid='public.cloudmarkup_installation_profile'::regclass AND r.rolname='cloudmarkup_admin')
    OR NOT EXISTS(SELECT 1 FROM public.cloudmarkup_installation_profile
      WHERE singleton AND profile_id='cloudmarkup-standalone-pg17-v1' AND profile_version=1
        AND engine_major=17 AND schema_owner='cloudmarkup_admin' AND bootstrap_grantor='cloudmarkup_owner')
    OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN
      ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime','cloudmarkup_beta_billing_runtime')) <> 5
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN
      ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime','cloudmarkup_beta_billing_runtime')
      AND (NOT r.rolcanlogin OR r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.relowner=r.oid)
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.proowner=r.oid)
        OR pg_catalog.has_database_privilege(r.oid,pg_catalog.current_database(),'CREATE, TEMP')
        OR pg_catalog.has_schema_privilege(r.oid,'public','CREATE')
        OR pg_catalog.has_parameter_privilege(r.oid,'session_replication_role','SET, ALTER SYSTEM')))
  THEN RAISE EXCEPTION 'Standalone runtime ACL admission unavailable' USING ERRCODE='42501'; END IF;
END;
$self_host_runtime_acl_admission$;
GRANT CONNECT ON DATABASE cloudmarkup TO cloudmarkup_beta_api_runtime,cloudmarkup_beta_proposal_runtime,cloudmarkup_beta_export_runtime,cloudmarkup_beta_cleanup_runtime,cloudmarkup_beta_billing_runtime;
GRANT USAGE ON SCHEMA public TO cloudmarkup_beta_api_runtime,cloudmarkup_beta_proposal_runtime,cloudmarkup_beta_export_runtime,cloudmarkup_beta_cleanup_runtime,cloudmarkup_beta_billing_runtime;
GRANT SELECT ON TABLE public.cloudmarkup_installation_profile,public.cloudmarkup_schema_migrations TO cloudmarkup_beta_api_runtime,cloudmarkup_beta_proposal_runtime,cloudmarkup_beta_export_runtime,cloudmarkup_beta_cleanup_runtime,cloudmarkup_beta_billing_runtime;
-- Local-owner sessions use the same shared session/revocation tables and guard.
-- The common business ACL already grants account revocation/cutoff receipts.
GRANT SELECT (principal_id,lifecycle_status) ON TABLE public.principals TO cloudmarkup_beta_api_runtime;
GRANT SELECT (session_sha256,lifecycle_status,principal_id,provider_session_sha256,authenticated_at,expires_at) ON TABLE public.browser_refresh_sessions TO cloudmarkup_beta_api_runtime;
GRANT INSERT (session_sha256,lifecycle_status,principal_id,provider_session_sha256,authenticated_at,expires_at) ON TABLE public.browser_refresh_sessions TO cloudmarkup_beta_api_runtime;
GRANT UPDATE (lifecycle_status,revoked_at) ON TABLE public.browser_refresh_sessions TO cloudmarkup_beta_api_runtime;
GRANT EXECUTE ON FUNCTION public.cloudmarkup_account_session_allowed_v1(text,text,timestamptz,timestamptz) TO cloudmarkup_beta_api_runtime;

-- ON CONFLICT reads these target timestamps through EXCLUDED in the shared
-- editing-lease upsert. PostgreSQL requires their column SELECT privileges even
-- for a newly inserted lease. Keep the existing fixed column grants otherwise.
GRANT SELECT (acquired_at,updated_at) ON TABLE public.project_editing_leases TO cloudmarkup_beta_api_runtime;

-- Shared draft autosave records the authenticated writer in the pending update.
-- Retain the fixed column boundary instead of allowing table-wide UPDATE.
GRANT UPDATE (updated_by_principal_id) ON TABLE public.architecture_drafts TO cloudmarkup_beta_api_runtime;

-- Namespace access is required for the already selected fixed helper EXECUTE
-- grants. This remains an explicitly acknowledged standalone ACL proposal.
GRANT USAGE ON SCHEMA cloudmarkup_ordinary_private TO cloudmarkup_beta_api_runtime,cloudmarkup_beta_proposal_runtime,cloudmarkup_beta_export_runtime,cloudmarkup_beta_cleanup_runtime,cloudmarkup_beta_billing_runtime;

-- Explicitly approved for the isolated synthetic PG17 self-host ACL only.
-- Remove the prequalification two-argument draft when upgrading that fixture.
DROP FUNCTION IF EXISTS cloudmarkup_ordinary_private.insert_solution_export_run_v1(jsonb,text);
-- No hosted migration.
-- The installer must create this as cloudmarkup_admin and revoke PUBLIC EXECUTE
-- in the same transaction before granting the one purpose login.
CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.insert_solution_export_run_v1(
  p_fields jsonb, p_root_key_sha256 text, p_idempotency_request_sha256 text
)
RETURNS varchar(128)
LANGUAGE plpgsql
SECURITY DEFINER
-- Existing canonical BEFORE INSERT triggers resolve public tables by name.
-- Keep catalog first, the fixed admin-owned public schema second, and temp last.
SET search_path = pg_catalog, public, pg_temp
AS $self_host_export_insert_v1$
DECLARE
  v record;
  inserted_id varchar(128);
BEGIN
  IF session_user <> 'cloudmarkup_beta_api_runtime'
    OR current_user <> 'cloudmarkup_admin'
    OR pg_catalog.current_database() <> 'cloudmarkup'
    OR pg_catalog.current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR pg_catalog.has_schema_privilege(session_user,'public','CREATE')
    OR p_root_key_sha256 !~ '^[0-9a-f]{64}$'
    OR p_idempotency_request_sha256 !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'Export insertion authority unavailable' USING ERRCODE='42501'; END IF;

  -- JSONB collapses duplicate keys. Count plus complete membership closes
  -- extra/missing fields before any cast or privileged read.
  IF p_fields IS NULL OR pg_catalog.jsonb_typeof(p_fields) <> 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_fields)) <> 36
    OR NOT (p_fields ?& ARRAY[
      'solution_export_run_id','organization_id','project_id','root_job_id',
      'solution_revision_id','solution_manifest_record_id','solution_manifest_subject_id',
      'solution_manifest_sha256','environment_id','environment_type',
      'target_profile_id','target_settings_sha256','export_name',
      'orchestration_input_object_id','orchestration_input_sha256',
      'workflow_request_object_id','request_sha256','primary_input_sha256',
      'run_sequence','rerun_of_run_id','request_intent_sha256',
      'idempotency_key_sha256','entitlement_decision_reference',
      'previous_artifact_id','lifecycle_status','progress_stage',
      'progress_completed_stages','progress_message','cancellation_requested_at',
      'cancellation_acknowledged_at','completed_at','created_by_principal_id',
      'created_at','updated_at','workflow_read_model_object_id',
      'workflow_read_model_sha256'
    ]::text[])
  THEN RAISE EXCEPTION 'Export insertion fields unavailable' USING ERRCODE='42501'; END IF;

  SELECT * INTO STRICT v FROM pg_catalog.jsonb_to_record(p_fields) AS payload(
    solution_export_run_id varchar(128), organization_id varchar(128),
    project_id varchar(128), root_job_id varchar(128),
    solution_revision_id varchar(128), solution_manifest_record_id varchar(128),
    solution_manifest_subject_id varchar(128), solution_manifest_sha256 char(64),
    environment_id varchar(128), environment_type varchar(32),
    target_profile_id varchar(96), target_settings_sha256 char(64),
    export_name varchar(96), orchestration_input_object_id varchar(128),
    orchestration_input_sha256 char(64), workflow_request_object_id varchar(128),
    request_sha256 char(64), primary_input_sha256 char(64),
    run_sequence integer, rerun_of_run_id varchar(128),
    request_intent_sha256 char(64), idempotency_key_sha256 char(64),
    entitlement_decision_reference varchar(128), previous_artifact_id varchar(128),
    lifecycle_status varchar(32), progress_stage varchar(64),
    progress_completed_stages smallint, progress_message varchar(512),
    cancellation_requested_at timestamptz, cancellation_acknowledged_at timestamptz,
    completed_at timestamptz, created_by_principal_id varchar(128),
    created_at timestamptz, updated_at timestamptz,
    workflow_read_model_object_id varchar(128), workflow_read_model_sha256 char(64)
  );

  IF v.solution_export_run_id IS NULL OR v.root_job_id IS DISTINCT FROM v.solution_export_run_id
    OR v.created_by_principal_id IS NULL OR v.organization_id IS NULL OR v.project_id IS NULL
    OR v.workflow_read_model_object_id IS NULL OR v.workflow_read_model_sha256 IS NULL
  THEN RAISE EXCEPTION 'Export insertion identity unavailable' USING ERRCODE='42501'; END IF;

  -- The role is shared across organizations. Recheck database facts rather
  -- than trusting an organization/principal string supplied by its caller.
  PERFORM 1 FROM public.projects p
    JOIN public.organizations o ON o.organization_id=p.organization_id
    JOIN public.principals actor ON actor.principal_id=v.created_by_principal_id
    JOIN public.memberships m ON m.organization_id=p.organization_id
      AND m.principal_id=actor.principal_id
    JOIN public.organization_roles role_policy ON role_policy.organization_id=m.organization_id
      AND role_policy.role_key=m.role_key AND role_policy.policy_version='authorization-v2'
    WHERE p.organization_id=v.organization_id AND p.project_id=v.project_id
      AND p.lifecycle_status='active' AND o.lifecycle_status='active'
      AND actor.lifecycle_status='active' AND m.lifecycle_status='active'
      AND role_policy.capabilities @> ARRAY['exports.run']::text[]
    FOR SHARE OF p,o,actor,m,role_policy;
  IF NOT FOUND THEN RAISE EXCEPTION 'Export insertion membership unavailable' USING ERRCODE='42501'; END IF;

  PERFORM 1 FROM public.async_jobs j
    JOIN public.async_job_creation_claims claim ON claim.organization_id=j.organization_id
      AND claim.project_id=j.project_id AND claim.job_id=j.job_id
    WHERE j.organization_id=v.organization_id AND j.project_id=v.project_id
      AND j.job_id=v.solution_export_run_id AND j.root_job_id=j.job_id
      AND j.parent_job_id IS NULL AND j.family='solution-export-orchestration'
      AND j.idempotency_actor_id=v.created_by_principal_id
      AND j.idempotency_key_sha256=p_root_key_sha256
      AND j.idempotency_request_sha256=p_idempotency_request_sha256
      AND j.created_by_actor_kind='principal'
      AND j.created_by_principal_id=v.created_by_principal_id
      AND j.created_at=v.created_at
      AND j.lifecycle_status=v.lifecycle_status
      AND (j.expires_at IS NULL OR j.expires_at > pg_catalog.clock_timestamp())
      AND claim.operation_id='solution-export-jobs.create'
      AND claim.idempotency_key_sha256=p_root_key_sha256
      AND claim.request_sha256=p_idempotency_request_sha256
      AND claim.family='solution-export-orchestration'
      AND claim.claim_status='completed' AND claim.entitlement_outcome='allowed'
      AND claim.actor_id=v.created_by_principal_id
      AND claim.entitlement_decision_reference=v.entitlement_decision_reference
    FOR SHARE OF j,claim;
  IF NOT FOUND THEN RAISE EXCEPTION 'Export insertion root unavailable' USING ERRCODE='42501'; END IF;

  -- The existing immutable-binding and object-metadata BEFORE INSERT triggers
  -- on this table validate the manifest, all three input objects, rerun
  -- lineage and previous artifact. Do not duplicate those canonical rules.
  INSERT INTO public.solution_export_runs (
    solution_export_run_id,organization_id,project_id,root_job_id,
    solution_revision_id,solution_manifest_record_id,solution_manifest_subject_id,
    solution_manifest_sha256,environment_id,environment_type,target_profile_id,
    target_settings_sha256,export_name,orchestration_input_object_id,
    orchestration_input_sha256,workflow_request_object_id,request_sha256,
    primary_input_sha256,run_sequence,rerun_of_run_id,request_intent_sha256,
    idempotency_key_sha256,entitlement_decision_reference,previous_artifact_id,
    lifecycle_status,progress_stage,progress_completed_stages,progress_message,
    cancellation_requested_at,cancellation_acknowledged_at,completed_at,
    created_by_principal_id,created_at,updated_at,
    workflow_read_model_object_id,workflow_read_model_sha256
  ) VALUES (
    v.solution_export_run_id,v.organization_id,v.project_id,v.root_job_id,
    v.solution_revision_id,v.solution_manifest_record_id,v.solution_manifest_subject_id,
    v.solution_manifest_sha256,v.environment_id,v.environment_type,v.target_profile_id,
    v.target_settings_sha256,v.export_name,v.orchestration_input_object_id,
    v.orchestration_input_sha256,v.workflow_request_object_id,v.request_sha256,
    v.primary_input_sha256,v.run_sequence,v.rerun_of_run_id,v.request_intent_sha256,
    v.idempotency_key_sha256,v.entitlement_decision_reference,v.previous_artifact_id,
    v.lifecycle_status,v.progress_stage,v.progress_completed_stages,v.progress_message,
    v.cancellation_requested_at,v.cancellation_acknowledged_at,v.completed_at,
    v.created_by_principal_id,v.created_at,v.updated_at,
    v.workflow_read_model_object_id,v.workflow_read_model_sha256
  ) ON CONFLICT DO NOTHING RETURNING solution_export_run_id INTO inserted_id;
  IF inserted_id IS NULL
  THEN RAISE EXCEPTION 'Export insertion collision' USING ERRCODE='23505'; END IF;
  RETURN inserted_id;
END;
$self_host_export_insert_v1$;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.insert_solution_export_run_v1(jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cloudmarkup_ordinary_private.insert_solution_export_run_v1(jsonb,text,text)
  TO cloudmarkup_beta_api_runtime;
