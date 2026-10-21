-- Private bootstrap topology v2. Source revision only for targets on which
-- 0127 is unapplied; never rewrite an installed checksum. The protected file
-- transaction includes this admission, transfer window, final assertions and
-- existing ledger insert. No runtime identity or environment selects trust.
DO $cm_private_bootstrap_admission$
BEGIN
  IF session_user::text <> 'cloudmarkup_admin' OR current_user::text <> 'cloudmarkup_admin'
    OR current_database() <> 'cloudmarkup'
    OR current_setting('server_version_num')::integer < 160000
    OR current_setting('server_version_num')::integer >= 170000
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname='cloudmarkup_admin' AND rolcanlogin AND rolcreaterole AND NOT rolsuper)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='rdsadmin')
  THEN RAISE EXCEPTION 'Protected PostgreSQL16 private bootstrap required' USING ERRCODE='42501'; END IF;
END;
$cm_private_bootstrap_admission$;

-- CloudMarkup additive migration 0127; fixed reviewed source closure.
CREATE ROLE cloudmarkup_notes_native_lock_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Admit only the zero-edge topology proved by the rollback-only Aurora
-- capability probe or the exact stock PostgreSQL16 creator edge. The
-- temporary transfer memberships must still be revoked; all other shapes
-- fail closed in the initial and final graph assertions.
DO $cm_private_bootstrap_owner_edge$
DECLARE bootstrap_edges integer;
BEGIN
  SELECT count(*) INTO bootstrap_edges FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
    WHERE r.rolname='cloudmarkup_notes_native_lock_owner';
  IF bootstrap_edges NOT IN (0,1)
    OR (bootstrap_edges=1 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
      JOIN pg_catalog.pg_roles a ON a.oid=m.member
      JOIN pg_catalog.pg_roles g ON g.oid=m.grantor
      WHERE r.rolname='cloudmarkup_notes_native_lock_owner' AND a.rolname='cloudmarkup_admin'
        AND g.rolname='rdsadmin' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option))
  THEN RAISE EXCEPTION 'Exact or zero private helper bootstrap edge required' USING ERRCODE='42501'; END IF;
END;
$cm_private_bootstrap_owner_edge$;

-- Temporary protected transfer/ACL authority only. INHERIT enables post-transfer
-- owner ACL operations; SET enables ALTER FUNCTION OWNER. Revoke only this
-- admin-granted edge before final assertion. Any stock creator edge remains.
GRANT cloudmarkup_notes_native_lock_owner TO cloudmarkup_admin
  WITH ADMIN FALSE GRANTED BY cloudmarkup_admin;

GRANT cloudmarkup_notes_native_lock_owner TO cloudmarkup_admin
  WITH INHERIT TRUE GRANTED BY cloudmarkup_admin;

GRANT cloudmarkup_notes_native_lock_owner TO cloudmarkup_admin
  WITH SET TRUE GRANTED BY cloudmarkup_admin;


CREATE ROLE cloudmarkup_notes_publication_authority NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE ROLE cloudmarkup_notes_shared_native_producer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE SCHEMA cloudmarkup_notes_native_private;

REVOKE ALL ON SCHEMA cloudmarkup_notes_native_private FROM PUBLIC;

GRANT USAGE ON SCHEMA cloudmarkup_notes_native_private TO cloudmarkup_notes_native_lock_owner,cloudmarkup_notes_publication_authority,cloudmarkup_notes_shared_native_producer;

GRANT USAGE ON SCHEMA public TO cloudmarkup_notes_native_lock_owner,cloudmarkup_notes_publication_authority,cloudmarkup_notes_shared_native_producer;

-- Needed for reviewed ownership transfer only, revoked before this transaction
-- commits. Migrator owner-assignment authority is a separate activation input.
GRANT CREATE ON SCHEMA cloudmarkup_notes_native_private TO cloudmarkup_notes_native_lock_owner;

-- FOR SHARE requires UPDATE on at least one column of each locked table.
-- Only this inaccessible helper owner receives identity-column privileges.
-- It owns fixed functions, never tables. After temporary membership is revoked,
-- the final guard permits no memberships or only the exact stock creator edges.
GRANT SELECT ON public.memberships,public.principals,public.organizations,public.organization_roles,public.projects,public.project_content_write_scopes,
  public.solution_export_runs,public.async_jobs,public.async_job_attempts,public.stored_objects,public.model_live_evaluation_plans,
  public.notes_native_publications,public.notes_native_publication_revocations,public.audit_events,public.model_gpt6_held_reports
  TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(principal_id) ON public.memberships TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(principal_id) ON public.principals TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(organization_id) ON public.organizations TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(role_key) ON public.organization_roles TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(project_id) ON public.projects TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(solution_export_run_id) ON public.solution_export_runs TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(job_id) ON public.async_jobs TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(attempt_id) ON public.async_job_attempts TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(object_id) ON public.stored_objects TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(plan_sha256) ON public.model_live_evaluation_plans TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(report_id) ON public.model_gpt6_held_reports TO cloudmarkup_notes_native_lock_owner;

GRANT INSERT(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id,occurred_at)
  ON public.audit_events TO cloudmarkup_notes_native_lock_owner;

CREATE FUNCTION cloudmarkup_notes_native_private.lock_current_authorization(organization text,project text,principal text,require_owner boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE role_name text;
BEGIN
  IF (organization IS NOT NULL AND project IS NOT NULL AND principal IS NOT NULL AND require_owner IS NOT NULL) IS NOT TRUE
  THEN RAISE EXCEPTION 'current scoped native authorization required' USING ERRCODE='42501'; END IF;
  SELECT r.role_key INTO role_name FROM public.memberships m
    JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
    JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    JOIN public.projects pr ON pr.organization_id=m.organization_id AND pr.project_id=project AND pr.lifecycle_status='active'
    WHERE m.organization_id=organization AND m.principal_id=principal AND m.lifecycle_status='active'
      AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['exports.run','commercial.expensive.use']::text[]
      AND (NOT require_owner OR r.role_key='owner')
      AND NOT EXISTS(SELECT 1 FROM public.project_content_write_scopes f
        WHERE f.organization_id=pr.organization_id AND f.project_id=pr.project_id AND f.closed_at IS NOT NULL)
    FOR SHARE OF m,p,o,r,pr;
  IF NOT FOUND THEN RAISE EXCEPTION 'current scoped native authorization required' USING ERRCODE='42501'; END IF;
  RETURN role_name;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.lock_current_authorization(text,text,text,boolean) OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.lock_current_authorization(text,text,text,boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_current_authorization(text,text,text,boolean)
  TO cloudmarkup_notes_publication_authority,cloudmarkup_notes_shared_native_producer;

-- Shared composition seam for Task8's separately owned nullable-guard successor.
-- No caller receives plan UPDATE. No Task8 issuer role is invented/granted here.
CREATE FUNCTION cloudmarkup_notes_native_private.lock_current_evaluation_plan(organization text,project text,principal text,plan_sha text)
RETURNS SETOF public.model_live_evaluation_plans LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p public.model_live_evaluation_plans%ROWTYPE;
BEGIN
  IF (organization IS NOT NULL AND project IS NOT NULL AND principal IS NOT NULL AND plan_sha ~ '^[a-f0-9]{64}$') IS NOT TRUE
  THEN RAISE EXCEPTION 'exact current native evaluation plan required' USING ERRCODE='42501'; END IF;
  SELECT plan.* INTO p FROM public.model_live_evaluation_plans plan WHERE plan.organization_id=organization
    AND plan.project_id=project AND plan.principal_id=principal AND plan.plan_sha256=plan_sha FOR SHARE OF plan;
  IF NOT FOUND THEN RETURN; END IF;
  BEGIN
    PERFORM cloudmarkup_notes_native_private.lock_current_authorization(organization,project,p.operator_principal_id,true);
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RETURN NEXT p;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.lock_current_evaluation_plan(text,text,text,text) OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.lock_current_evaluation_plan(text,text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_current_evaluation_plan(text,text,text,text) TO cloudmarkup_notes_shared_native_producer;

-- Publication additionally locks its exact immutable held-report row. Task8's
-- current successor still owns the full nullable/current-plan trigger body.
CREATE FUNCTION cloudmarkup_notes_native_private.lock_current_held_report(organization text,project text,principal text,plan_sha text,report_id text,report_sha text)
RETURNS SETOF public.model_gpt6_held_reports LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE h public.model_gpt6_held_reports%ROWTYPE;
BEGIN
  IF (report_id IS NOT NULL AND report_sha ~ '^[a-f0-9]{64}$') IS NOT TRUE
  THEN RAISE EXCEPTION 'exact held native report required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM cloudmarkup_notes_native_private.lock_current_evaluation_plan(organization,project,principal,plan_sha);
  IF NOT FOUND THEN RETURN; END IF;
  SELECT held.* INTO h FROM public.model_gpt6_held_reports held WHERE held.organization_id=organization
    AND held.project_id=project AND held.principal_id=principal AND held.plan_sha256=plan_sha
    AND held.report_id=lock_current_held_report.report_id AND held.report_sha256=report_sha FOR SHARE OF held;
  IF FOUND THEN RETURN NEXT h; END IF;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.lock_current_held_report(text,text,text,text,text,text) OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.lock_current_held_report(text,text,text,text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_current_held_report(text,text,text,text,text,text) TO cloudmarkup_notes_shared_native_producer;

CREATE FUNCTION cloudmarkup_notes_native_private.lock_current_export(organization text,project text,principal text,job text,attempt text,attempt_number integer,worker text,input_sha text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE locked_job_expires_at timestamptz;locked_lease_expires_at timestamptz;post_lock_checked_at timestamptz;
BEGIN
  IF (organization IS NOT NULL AND project IS NOT NULL AND principal IS NOT NULL AND job IS NOT NULL
    AND attempt IS NOT NULL AND attempt_number>0 AND worker IS NOT NULL AND input_sha ~ '^[a-f0-9]{64}$') IS NOT TRUE
  THEN RAISE EXCEPTION 'actual current native export required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.solution_export_runs x
    JOIN public.async_jobs j ON j.organization_id=x.organization_id AND j.project_id=x.project_id AND j.job_id=x.root_job_id
    JOIN public.async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id
    JOIN public.projects p ON p.organization_id=x.organization_id AND p.project_id=x.project_id AND p.lifecycle_status='active'
    JOIN public.principals actor ON actor.principal_id=x.created_by_principal_id AND actor.lifecycle_status='active'
    JOIN public.memberships m ON m.organization_id=x.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
    JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    WHERE x.organization_id=organization AND x.project_id=project AND x.solution_export_run_id=job
      AND x.created_by_principal_id=principal AND j.created_by_principal_id=principal AND j.idempotency_actor_id=principal
      AND j.family='solution-export-orchestration' AND j.input_sha256=input_sha
      AND j.solution_revision_id=x.solution_revision_id AND j.solution_manifest_sha256=x.solution_manifest_sha256
      AND j.input_object_id=x.orchestration_input_object_id AND j.input_sha256=x.orchestration_input_sha256
      AND j.lifecycle_status='running' AND j.cancellation_requested_at IS NULL
      AND (j.expires_at IS NULL OR j.expires_at>clock_timestamp())
      AND a.attempt_id=attempt AND a.attempt_number=lock_current_export.attempt_number AND a.worker_reference=worker
      AND a.lifecycle_status='running' AND a.lease_expires_at>clock_timestamp()
      AND a.attempt_number=(SELECT max(last_attempt.attempt_number) FROM public.async_job_attempts last_attempt
        WHERE last_attempt.organization_id=j.organization_id AND last_attempt.job_id=j.job_id)
      AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['exports.run','commercial.expensive.use']::text[]
      AND NOT EXISTS(SELECT 1 FROM public.project_content_write_scopes f
        WHERE f.organization_id=p.organization_id AND f.project_id=p.project_id AND f.closed_at IS NOT NULL)
    FOR SHARE OF x,j,a,p,actor,m,o,r;
  IF NOT FOUND THEN RAISE EXCEPTION 'actual current native export required' USING ERRCODE='42501'; END IF;
  -- WHERE clock predicates can be evaluated before a row-lock wait. Reopen
  -- exact current authority after all locks return; no new lock wait follows
  -- the final clock checkpoint. Existing locked rows remain held to commit.
  SELECT j.expires_at,a.lease_expires_at INTO locked_job_expires_at,locked_lease_expires_at
    FROM public.solution_export_runs x
    JOIN public.async_jobs j ON j.organization_id=x.organization_id AND j.project_id=x.project_id AND j.job_id=x.root_job_id
    JOIN public.async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id
    JOIN public.projects p ON p.organization_id=x.organization_id AND p.project_id=x.project_id AND p.lifecycle_status='active'
    JOIN public.principals actor ON actor.principal_id=x.created_by_principal_id AND actor.lifecycle_status='active'
    JOIN public.memberships m ON m.organization_id=x.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
    JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    WHERE x.organization_id=organization AND x.project_id=project AND x.solution_export_run_id=job
      AND x.created_by_principal_id=principal AND j.created_by_principal_id=principal AND j.idempotency_actor_id=principal
      AND j.family='solution-export-orchestration' AND j.input_sha256=input_sha
      AND j.solution_revision_id=x.solution_revision_id AND j.solution_manifest_sha256=x.solution_manifest_sha256
      AND j.input_object_id=x.orchestration_input_object_id AND j.input_sha256=x.orchestration_input_sha256
      AND j.lifecycle_status='running' AND j.cancellation_requested_at IS NULL
      AND a.attempt_id=attempt AND a.attempt_number=lock_current_export.attempt_number AND a.worker_reference=worker
      AND a.lifecycle_status='running'
      AND a.attempt_number=(SELECT max(last_attempt.attempt_number) FROM public.async_job_attempts last_attempt
        WHERE last_attempt.organization_id=j.organization_id AND last_attempt.job_id=j.job_id)
      AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['exports.run','commercial.expensive.use']::text[]
      AND NOT EXISTS(SELECT 1 FROM public.project_content_write_scopes f
        WHERE f.organization_id=p.organization_id AND f.project_id=p.project_id AND f.closed_at IS NOT NULL);
  IF NOT FOUND THEN RAISE EXCEPTION 'actual current native export required' USING ERRCODE='42501'; END IF;
  post_lock_checked_at:=clock_timestamp();
  IF (locked_lease_expires_at IS NOT NULL AND locked_lease_expires_at>post_lock_checked_at
    AND (locked_job_expires_at IS NULL OR locked_job_expires_at>post_lock_checked_at)) IS NOT TRUE
  THEN RAISE EXCEPTION 'actual current native export required' USING ERRCODE='42501'; END IF;
  RETURN true;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.lock_current_export(text,text,text,text,text,integer,text,text) OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.lock_current_export(text,text,text,text,text,integer,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_current_export(text,text,text,text,text,integer,text,text) TO cloudmarkup_notes_shared_native_producer;

CREATE FUNCTION cloudmarkup_notes_native_private.record_publication_audit(event_id text,organization text,operator_id text,action_name text,project text,correlation text,occurred timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF (organization=current_setting('cloudmarkup.notes_publication.organization_id',true)
    AND project=current_setting('cloudmarkup.notes_publication.project_id',true)
    AND operator_id=current_setting('cloudmarkup.notes_publication.operator_id',true)
    AND correlation IS NOT NULL AND occurred<=clock_timestamp()) IS NOT TRUE
  THEN RAISE EXCEPTION 'exact native publication audit required' USING ERRCODE='42501'; END IF;
  PERFORM cloudmarkup_notes_native_private.lock_current_authorization(organization,project,operator_id,true);
  IF action_name='notes-native.publication-issued' THEN
    PERFORM 1 FROM public.notes_native_publications p WHERE p.organization_id=organization AND p.project_id=project
      AND p.principal_id=current_setting('cloudmarkup.notes_publication.principal_id',true)
      AND p.publication_id=event_id AND p.operator_principal_id=operator_id AND p.issued_at=occurred;
  ELSIF action_name='notes-native.publication-revoked' THEN
    PERFORM 1 FROM public.notes_native_publication_revocations v WHERE v.organization_id=organization AND v.project_id=project
      AND v.principal_id=current_setting('cloudmarkup.notes_publication.principal_id',true)
      AND 'notes_revocation_'||v.publication_sha256=event_id AND v.operator_principal_id=operator_id AND v.revoked_at=occurred;
  ELSE RAISE EXCEPTION 'exact native publication audit required' USING ERRCODE='42501'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'exact native publication audit required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.audit_events(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id,occurred_at)
    VALUES(event_id,organization,operator_id,action_name,'project',project,'succeeded','Scoped native Notes publication metadata was recorded.',correlation,occurred);
  RETURN event_id;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.record_publication_audit(text,text,text,text,text,text,timestamptz) OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.record_publication_audit(text,text,text,text,text,text,timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.record_publication_audit(text,text,text,text,text,text,timestamptz) TO cloudmarkup_notes_publication_authority;

GRANT SELECT,INSERT ON public.notes_native_publications,public.notes_native_publication_revocations TO cloudmarkup_notes_publication_authority;

GRANT SELECT ON public.audit_events TO cloudmarkup_notes_publication_authority;

ALTER TABLE public.notes_native_publications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notes_native_publications FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notes_native_publication_revocations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notes_native_publication_revocations FORCE ROW LEVEL SECURITY;

-- Read policies do not grant SELECT; existing verified readers still require
-- separate reviewed SELECT ACLs and exact adapter tenant predicates.
CREATE POLICY notes_publication_read ON public.notes_native_publications FOR SELECT
  USING(organization_id=current_setting('cloudmarkup.notes_publication.organization_id',true)
    AND project_id=current_setting('cloudmarkup.notes_publication.project_id',true)
    AND principal_id=current_setting('cloudmarkup.notes_publication.principal_id',true));

CREATE POLICY notes_revocation_read ON public.notes_native_publication_revocations FOR SELECT
  USING(organization_id=current_setting('cloudmarkup.notes_publication.organization_id',true)
    AND project_id=current_setting('cloudmarkup.notes_publication.project_id',true)
    AND principal_id=current_setting('cloudmarkup.notes_publication.principal_id',true));

CREATE POLICY notes_publication_private_issue ON public.notes_native_publications FOR INSERT TO cloudmarkup_notes_publication_authority
  WITH CHECK((current_user='cloudmarkup_notes_publication_authority' AND environment='beta'
    AND organization_id=current_setting('cloudmarkup.notes_publication.organization_id',true)
    AND project_id=current_setting('cloudmarkup.notes_publication.project_id',true)
    AND principal_id=current_setting('cloudmarkup.notes_publication.principal_id',true)
    AND operator_principal_id=current_setting('cloudmarkup.notes_publication.operator_id',true)
    AND cloudmarkup_notes_native_private.lock_current_authorization(organization_id,project_id,operator_principal_id,true)='owner'
    AND cloudmarkup_notes_native_private.lock_current_authorization(organization_id,project_id,principal_id,false) IS NOT NULL) IS TRUE);

CREATE POLICY notes_publication_private_revoke ON public.notes_native_publication_revocations FOR INSERT TO cloudmarkup_notes_publication_authority
  WITH CHECK((current_user='cloudmarkup_notes_publication_authority'
    AND organization_id=current_setting('cloudmarkup.notes_publication.organization_id',true)
    AND project_id=current_setting('cloudmarkup.notes_publication.project_id',true)
    AND principal_id=current_setting('cloudmarkup.notes_publication.principal_id',true)
    AND operator_principal_id=current_setting('cloudmarkup.notes_publication.operator_id',true)
    AND cloudmarkup_notes_native_private.lock_current_authorization(organization_id,project_id,operator_principal_id,true)='owner') IS TRUE);

-- A claimed native producer attempt never resets on failure or expiry.
CREATE TABLE public.notes_shared_native_producer_attempts (
  organization_id varchar(128) NOT NULL,project_id varchar(128) NOT NULL,principal_id varchar(128) NOT NULL,job_id varchar(128) NOT NULL,
  proposal_sha256 char(64) NOT NULL CHECK(proposal_sha256 ~ '^[a-f0-9]{64}$'),
  attempt_id varchar(128) NOT NULL,attempt_number integer NOT NULL CHECK(attempt_number>0),worker_id varchar(128) NOT NULL,
  input_sha256 char(64) NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,project_id,principal_id,job_id,proposal_sha256)
);

CREATE TABLE public.notes_shared_native_receipt_artifacts (
  organization_id varchar(128) NOT NULL,project_id varchar(128) NOT NULL,principal_id varchar(128) NOT NULL,job_id varchar(128) NOT NULL,
  proposal_sha256 char(64) NOT NULL,workload_id varchar(128) NOT NULL,build_number integer NOT NULL CHECK(build_number IN(1,2)),
  artifact_kind text NOT NULL CHECK(artifact_kind IN('archive','manifest','sbom')),
  object_id varchar(128) NOT NULL,object_version text NOT NULL,content_sha256 char(64) NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  process_source_closure_sha256 char(64) NOT NULL CHECK(process_source_closure_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 char(64) NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),execution_id varchar(128) NOT NULL,
  size_bytes bigint NOT NULL CHECK(size_bytes>0 AND size_bytes<=67108864),
  PRIMARY KEY(organization_id,project_id,principal_id,job_id,proposal_sha256,workload_id,build_number,artifact_kind),
  FOREIGN KEY(organization_id,project_id,principal_id,job_id,proposal_sha256,workload_id)
    REFERENCES public.beta_native_shared_build_receipts(organization_id,project_id,principal_id,job_id,proposal_sha256,workload_id),
  FOREIGN KEY(organization_id,project_id,principal_id,job_id,proposal_sha256)
    REFERENCES public.notes_shared_native_producer_attempts(organization_id,project_id,principal_id,job_id,proposal_sha256)
);

CREATE TRIGGER notes_native_attempt_immutable BEFORE UPDATE OR DELETE ON public.notes_shared_native_producer_attempts
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_row_change();

CREATE TRIGGER notes_native_artifact_immutable BEFORE UPDATE OR DELETE ON public.notes_shared_native_receipt_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_row_change();

ALTER TABLE public.notes_shared_native_producer_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notes_shared_native_producer_attempts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notes_shared_native_receipt_artifacts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notes_shared_native_receipt_artifacts FORCE ROW LEVEL SECURITY;

GRANT SELECT,INSERT ON public.notes_shared_native_producer_attempts,public.notes_shared_native_receipt_artifacts,public.beta_native_shared_build_receipts TO cloudmarkup_notes_shared_native_producer;

CREATE FUNCTION cloudmarkup_notes_native_private.shared_receipt_scope(organization text,project text,principal text,job text,proposal_sha text)
RETURNS boolean LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
  SELECT (current_user='cloudmarkup_notes_shared_native_producer'
    AND organization=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal=current_setting('cloudmarkup.product_receipt.principal_id',true)
    AND job=current_setting('cloudmarkup.notes_shared_native.job_id',true)
    AND proposal_sha=current_setting('cloudmarkup.notes_shared_native.proposal_sha256',true)) IS TRUE;
$$;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.shared_receipt_scope(text,text,text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.shared_receipt_scope(text,text,text,text,text) TO cloudmarkup_notes_shared_native_producer;

CREATE POLICY notes_native_attempt_read ON public.notes_shared_native_producer_attempts FOR SELECT TO cloudmarkup_notes_shared_native_producer
  USING(cloudmarkup_notes_native_private.shared_receipt_scope(organization_id,project_id,principal_id,job_id,proposal_sha256));

CREATE POLICY notes_native_attempt_insert ON public.notes_shared_native_producer_attempts FOR INSERT TO cloudmarkup_notes_shared_native_producer
  WITH CHECK((cloudmarkup_notes_native_private.shared_receipt_scope(organization_id,project_id,principal_id,job_id,proposal_sha256)
    AND claimed_at<=clock_timestamp()
    AND cloudmarkup_notes_native_private.lock_current_export(organization_id,project_id,principal_id,job_id,attempt_id,attempt_number,worker_id,input_sha256)) IS TRUE);

CREATE POLICY notes_native_artifact_read ON public.notes_shared_native_receipt_artifacts FOR SELECT
  USING(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true) AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true));

CREATE POLICY notes_native_artifact_insert ON public.notes_shared_native_receipt_artifacts FOR INSERT TO cloudmarkup_notes_shared_native_producer
  WITH CHECK((cloudmarkup_notes_native_private.shared_receipt_scope(organization_id,project_id,principal_id,job_id,proposal_sha256)
    AND 'sha256:'||process_source_closure_sha256=current_setting('cloudmarkup.notes_shared_native.process_closure_digest',true)
    AND 'sha256:'||request_sha256=current_setting('cloudmarkup.notes_shared_native.request_digest',true)
    AND execution_id='native-process.'||job_id) IS TRUE);

CREATE POLICY notes_shared_native_private_insert ON public.beta_native_shared_build_receipts FOR INSERT TO cloudmarkup_notes_shared_native_producer
  WITH CHECK((cloudmarkup_notes_native_private.shared_receipt_scope(organization_id,project_id,principal_id,job_id,proposal_sha256)
    AND EXISTS(SELECT 1 FROM public.notes_shared_native_producer_attempts a WHERE a.organization_id=beta_native_shared_build_receipts.organization_id
      AND a.project_id=beta_native_shared_build_receipts.project_id AND a.principal_id=beta_native_shared_build_receipts.principal_id
      AND a.job_id=beta_native_shared_build_receipts.job_id AND a.proposal_sha256=beta_native_shared_build_receipts.proposal_sha256
      AND cloudmarkup_notes_native_private.lock_current_export(a.organization_id,a.project_id,a.principal_id,a.job_id,a.attempt_id,a.attempt_number,a.worker_id,a.input_sha256))) IS TRUE);

-- NULL/missing JSON never grants native receipt authority. Required source and
-- compiler/proposal binds are rechecked against the privately derived proposal.
CREATE FUNCTION cloudmarkup_notes_native_private.enforce_shared_native_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF (current_user='cloudmarkup_notes_shared_native_producer'
    AND NEW.observation->>'kind'='cloudmarkup.beta-native-shared-build-observation'
    AND NEW.observation->'contractVersion'='2'::jsonb AND NEW.observation->>'writeAuthority'='none'
    AND NEW.observation->>'workloadId'=NEW.workload_id
    AND NEW.observation->>'proposalDigest'='sha256:'||NEW.proposal_sha256
    AND NEW.observation->>'solutionRevisionDigest'=current_setting('cloudmarkup.notes_shared_native.revision_digest',true)
    AND NEW.observation->>'compilerDigest'=current_setting('cloudmarkup.notes_shared_native.compiler_digest',true)
    AND NEW.observation->>'observationDigest' ~ '^sha256:[a-f0-9]{64}$'
    AND jsonb_typeof(NEW.observation->'builds')='array' AND jsonb_array_length(NEW.observation->'builds')=2
    AND NEW.observation#>>'{builds,0,buildId}'<>NEW.observation#>>'{builds,1,buildId}'
    AND NEW.observation#>>'{builds,0,workspaceId}'<>NEW.observation#>>'{builds,1,workspaceId}') IS NOT TRUE
  THEN RAISE EXCEPTION 'exact privately produced native V2 observation required' USING ERRCODE='23514'; END IF;
  FOR i IN 0..1 LOOP
    IF (NEW.observation#>>ARRAY['builds',i::text,'sourceTreeDigest']=current_setting('cloudmarkup.notes_shared_native.source_tree_digest',true)
      AND NEW.observation#>>ARRAY['builds',i::text,'profileDigest']=current_setting('cloudmarkup.notes_shared_native.profile_digest',true)
      AND NEW.observation#>>ARRAY['builds',i::text,'commandDigest']=current_setting('cloudmarkup.notes_shared_native.command_digest',true)
      AND NEW.observation#>>ARRAY['builds',i::text,'parserDigest']=current_setting('cloudmarkup.notes_shared_native.parser_digest',true)
      AND NEW.observation#>>ARRAY['builds',i::text,'dependencyClosureDigest']=current_setting('cloudmarkup.notes_shared_native.dependency_digest',true)
      AND NEW.observation#>>ARRAY['builds',i::text,'handlerDigest']=current_setting('cloudmarkup.notes_shared_native.handler_digest',true)
      AND NEW.observation#>>ARRAY['builds',i::text,'disposal','verified']='true'
      AND NEW.observation#>>ARRAY['builds',i::text,'disposal','receiptDigest'] ~ '^sha256:[a-f0-9]{64}$'
      AND NEW.observation#>>ARRAY['builds',i::text,'securityReportDigest'] ~ '^sha256:[a-f0-9]{64}$'
      AND NEW.observation#>>ARRAY['builds',i::text,'archiveChecksum'] ~ '^sha256:[a-f0-9]{64}$'
      AND NEW.observation#>>ARRAY['builds',i::text,'manifestDigest'] ~ '^sha256:[a-f0-9]{64}$'
      AND NEW.observation#>>ARRAY['builds',i::text,'sbomDigest'] ~ '^sha256:[a-f0-9]{64}$'
      AND NEW.observation#>>ARRAY['builds',i::text,'modelTests','reportDigest'] ~ '^sha256:[a-f0-9]{64}$'
      AND NEW.observation#>>ARRAY['builds',i::text,'hostContractTests','reportDigest'] ~ '^sha256:[a-f0-9]{64}$'
      AND NEW.observation#>>ARRAY['builds',i::text,'securityBlockingFindings']='0'
      AND (NEW.observation#>>ARRAY['builds',i::text,'modelTests','passed'])::integer>0
      AND (NEW.observation#>>ARRAY['builds',i::text,'hostContractTests','passed'])::integer>0
      AND NEW.observation#>>ARRAY['builds',i::text,'modelTests','failed']='0'
      AND NEW.observation#>>ARRAY['builds',i::text,'hostContractTests','failed']='0'
      AND NEW.observation#>>ARRAY['builds',i::text,'modelTests','skipped']='0'
      AND NEW.observation#>>ARRAY['builds',i::text,'hostContractTests','skipped']='0'
      AND NEW.observation#>>ARRAY['builds',i::text,'modelTests','cancelled']='0'
      AND NEW.observation#>>ARRAY['builds',i::text,'hostContractTests','cancelled']='0'
      AND NEW.observation#>>ARRAY['builds',i::text,'modelTests','todo']='0'
      AND NEW.observation#>>ARRAY['builds',i::text,'hostContractTests','todo']='0'
      AND (NEW.observation#>>ARRAY['builds',i::text,'startedAt'])::timestamptz<=
        (NEW.observation#>>ARRAY['builds',i::text,'completedAt'])::timestamptz
      AND (NEW.observation#>>ARRAY['builds',i::text,'completedAt'])::timestamptz<=clock_timestamp()) IS NOT TRUE
    THEN RAISE EXCEPTION 'actual source, tests and disposal required' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF ((NEW.observation#>>'{builds,0,completedAt}')::timestamptz<=(NEW.observation#>>'{builds,1,startedAt}')::timestamptz
    AND NEW.observation#>>'{builds,0,archiveChecksum}'=NEW.observation#>>'{builds,1,archiveChecksum}'
    AND NEW.observation#>>'{builds,0,manifestDigest}'=NEW.observation#>>'{builds,1,manifestDigest}'
    AND NEW.observation#>>'{builds,0,sbomDigest}'=NEW.observation#>>'{builds,1,sbomDigest}') IS NOT TRUE
  THEN RAISE EXCEPTION 'two independent reproducible builds required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.enforce_shared_native_receipt() FROM PUBLIC;

CREATE TRIGGER notes_shared_native_private_binding BEFORE INSERT ON public.beta_native_shared_build_receipts
  FOR EACH ROW EXECUTE FUNCTION cloudmarkup_notes_native_private.enforce_shared_native_receipt();

CREATE FUNCTION cloudmarkup_notes_native_private.lock_published_artifact(organization text,project text,principal text,object_id text,object_version text,content_sha text,bytes bigint,kind text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.stored_objects o WHERE o.organization_id=organization AND o.project_id=project
    AND o.created_by_principal_id=principal AND o.object_id=lock_published_artifact.object_id
    AND o.object_version=lock_published_artifact.object_version AND o.content_sha256=content_sha AND o.size_bytes=bytes AND o.lifecycle_state='published'
    AND ((kind='archive' AND o.object_purpose='export-package' AND o.media_type='application/zip')
      OR (kind IN('manifest','sbom') AND o.object_purpose='build-output' AND o.media_type='application/json')) FOR SHARE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'exact published native candidate bytes required' USING ERRCODE='23514'; END IF;
  RETURN true;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.lock_published_artifact(text,text,text,text,text,text,bigint,text) OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.lock_published_artifact(text,text,text,text,text,text,bigint,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_published_artifact(text,text,text,text,text,text,bigint,text) TO cloudmarkup_notes_shared_native_producer;

CREATE FUNCTION cloudmarkup_notes_native_private.require_complete_artifact_set() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record;matched integer:=0;expected_sha text;
BEGIN
  FOR a IN SELECT * FROM public.notes_shared_native_receipt_artifacts f WHERE f.organization_id=NEW.organization_id
    AND f.project_id=NEW.project_id AND f.principal_id=NEW.principal_id AND f.job_id=NEW.job_id
    AND f.proposal_sha256=NEW.proposal_sha256 AND f.workload_id=NEW.workload_id LOOP
    expected_sha:=NEW.observation#>>ARRAY['builds',(a.build_number-1)::text,
      CASE a.artifact_kind WHEN 'archive' THEN 'archiveChecksum' WHEN 'manifest' THEN 'manifestDigest' ELSE 'sbomDigest' END];
    IF ('sha256:'||a.content_sha256=expected_sha AND cloudmarkup_notes_native_private.lock_published_artifact(
      a.organization_id,a.project_id,a.principal_id,a.object_id,a.object_version,a.content_sha256,a.size_bytes,a.artifact_kind)) IS NOT TRUE
    THEN RAISE EXCEPTION 'native receipt artifact binding unavailable' USING ERRCODE='23514'; END IF;
    matched:=matched+1;
  END LOOP;
  IF matched<>6 THEN RAISE EXCEPTION 'both complete native artifact sets required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER notes_shared_native_complete_artifacts AFTER INSERT ON public.beta_native_shared_build_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cloudmarkup_notes_native_private.require_complete_artifact_set();

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.require_complete_artifact_set() FROM PUBLIC;

-- SQL byte references/checks do not prove native execution or downloaded-handler
-- behavior. Only the separately admitted closed producer can supply them.
-- No login receives these roles. No migration registry/runtime factory changes.
REVOKE CREATE ON SCHEMA cloudmarkup_notes_native_private FROM cloudmarkup_notes_native_lock_owner;

CREATE ROLE cloudmarkup_gpt6_private_receipt_issuer NOLOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT USAGE ON SCHEMA public,cloudmarkup_notes_native_private TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_current_export(text,text,text,text,text,integer,text,text),
  cloudmarkup_notes_native_private.lock_current_evaluation_plan(text,text,text,text),
  cloudmarkup_notes_native_private.lock_current_held_report(text,text,text,text,text,text)
  TO cloudmarkup_gpt6_private_receipt_issuer;

-- Read-only canonical columns used by the existing INVOKER product/current-owner
-- guards. Application model/credit/object reopening stays on the existing worker.
GRANT SELECT(organization_id,principal_id,role_key,lifecycle_status) ON public.memberships TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT(principal_id,lifecycle_status) ON public.principals TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT(organization_id,lifecycle_status) ON public.organizations TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT(organization_id,role_key,policy_version,capabilities) ON public.organization_roles TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT(organization_id,project_id,lifecycle_status) ON public.projects TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT(organization_id,project_id,closed_at) ON public.project_content_write_scopes TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT(organization_id,reservation_id,project_id,job_id,request_sha256,state,output_object_id,output_sha256,input_tokens,output_tokens,cached_input_tokens,provider_request_id)
  ON public.beta_ai_invocations TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT(organization_id,reservation_id,project_id,job_id,request_sha256,acting_principal_id,status,terminal_ledger_entry_id,pricing_version_id,model_key,provider_key)
  ON public.credit_reservations TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT(organization_id,ledger_entry_id,reservation_id,entry_kind,outcome,input_token_count,output_token_count,cached_input_token_count,provider_request_id)
  ON public.usage_ledger_entries TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT(organization_id,project_id,object_id,content_sha256,lifecycle_state)
  ON public.stored_objects TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT ON public.model_live_evaluation_plans,public.model_live_evaluation_revocations,
  public.model_live_sequence_plans,public.model_live_sequence_revocations TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT ON public.beta_native_shared_build_receipts TO cloudmarkup_gpt6_private_receipt_issuer;

GRANT SELECT,INSERT ON public.beta_gpt6_product_receipts,public.model_live_native_zero_receipts,
  public.model_live_standard_ui_receipts,public.model_gpt6_held_reports,public.model_gpt6_promotions,
  public.model_gpt6_promotion_revocations TO cloudmarkup_gpt6_private_receipt_issuer;

-- Exact metadata locks required by remaining Task8 readers and UI-origin guards.
-- Only the inaccessible existing helper owner gets these three column UPDATEs.
GRANT SELECT ON public.model_live_native_zero_receipts,public.model_live_standard_ui_receipts,
  public.model_gpt6_promotions,public.model_live_evaluation_revocations,
  public.beta_ai_invocations,public.credit_reservations,public.usage_ledger_entries TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(receipt_id) ON public.model_live_native_zero_receipts,
  public.model_live_standard_ui_receipts,public.model_gpt6_promotions TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(reservation_id) ON public.beta_ai_invocations,public.credit_reservations TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(ledger_entry_id) ON public.usage_ledger_entries TO cloudmarkup_notes_native_lock_owner;

GRANT CREATE ON SCHEMA cloudmarkup_notes_native_private TO cloudmarkup_notes_native_lock_owner;

-- Keep the actual paid journal, reservation, terminal ledger and published model
-- output locked through product metadata INSERT. No helper performs a mutation.
CREATE FUNCTION cloudmarkup_notes_native_private.lock_gpt6_product_terminal(organization text,project text,principal text,job text,reservation text,request_sha text,output_id text,output_sha text,model text,provider_request text,pricing text,charging text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF (organization IS NOT NULL AND project IS NOT NULL AND principal IS NOT NULL AND job IS NOT NULL
    AND reservation IS NOT NULL AND request_sha ~ '^[a-f0-9]{64}$' AND output_id IS NOT NULL
    AND output_sha ~ '^[a-f0-9]{64}$' AND model IN('openai.gpt-6-sol','openai.gpt-6-luna')
    AND provider_request IS NOT NULL AND pricing IS NOT NULL AND charging IS NOT NULL) IS NOT TRUE
  THEN RAISE EXCEPTION 'exact locked GPT6 product terminal required' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.beta_ai_invocations i
    JOIN public.credit_reservations r ON r.organization_id=i.organization_id AND r.reservation_id=i.reservation_id
    JOIN public.usage_ledger_entries l ON l.organization_id=r.organization_id AND l.reservation_id=r.reservation_id
      AND l.ledger_entry_id=r.terminal_ledger_entry_id AND l.project_id=r.project_id AND l.job_id=r.job_id
    JOIN public.stored_objects o ON o.organization_id=i.organization_id AND o.project_id=i.project_id
      AND o.object_id=i.output_object_id AND o.content_sha256=i.output_sha256
    WHERE i.organization_id=organization AND i.project_id=project AND i.job_id=job AND i.reservation_id=reservation
      AND i.request_sha256=request_sha AND r.request_sha256=request_sha AND r.project_id=project AND r.job_id=job
      AND r.acting_principal_id=principal AND o.created_by_principal_id=principal
      AND i.state='settled' AND r.status='settled' AND l.entry_kind='settlement' AND l.outcome='useful-output-delivered'
      AND o.lifecycle_state='published' AND o.object_id=output_id AND o.content_sha256=output_sha
      AND o.object_purpose='build-output' AND o.media_type='application/json'
      AND r.model_key=model AND r.provider_key='openai' AND r.pricing_version_id=pricing AND r.charging_policy_version=charging
      AND l.pricing_version_id=pricing AND l.charging_policy_version=charging
      AND i.provider_request_id=provider_request AND l.provider_request_id=provider_request
      AND l.input_token_count=i.input_tokens AND l.output_token_count=i.output_tokens
      AND i.cached_input_tokens=0 AND l.cached_input_token_count=0 FOR SHARE OF i,r,l,o;
  IF NOT FOUND THEN RAISE EXCEPTION 'exact locked GPT6 product terminal required' USING ERRCODE='23514'; END IF;
  RETURN true;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.lock_gpt6_product_terminal(text,text,text,text,text,text,text,text,text,text,text,text) OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.lock_gpt6_product_terminal(text,text,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_gpt6_product_terminal(text,text,text,text,text,text,text,text,text,text,text,text) TO cloudmarkup_gpt6_private_receipt_issuer;

-- Preserve MODEL authorization semantics. Notes export helper requires exports.run;
-- it must not replace the historical projects.mutate check for evaluation users.
CREATE FUNCTION cloudmarkup_notes_native_private.lock_model_evaluation_authorization(organization text,project text,principal text,require_owner boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE role_name text;
BEGIN
  IF (organization IS NOT NULL AND project IS NOT NULL AND principal IS NOT NULL AND require_owner IS NOT NULL) IS NOT TRUE
  THEN RAISE EXCEPTION 'current scoped model authorization required' USING ERRCODE='42501'; END IF;
  SELECT r.role_key INTO role_name FROM public.memberships m
    JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
    JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    JOIN public.projects pr ON pr.organization_id=m.organization_id AND pr.project_id=project AND pr.lifecycle_status='active'
    WHERE m.organization_id=organization AND m.principal_id=principal AND m.lifecycle_status='active'
      AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
      AND (NOT require_owner OR r.role_key='owner')
      AND NOT EXISTS(SELECT 1 FROM public.project_content_write_scopes f
        WHERE f.organization_id=pr.organization_id AND f.project_id=pr.project_id AND f.closed_at IS NOT NULL)
    FOR SHARE OF m,p,o,r,pr;
  IF NOT FOUND THEN RAISE EXCEPTION 'current scoped model authorization required' USING ERRCODE='42501'; END IF;
  RETURN role_name;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.lock_model_evaluation_authorization(text,text,text,boolean) OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.lock_model_evaluation_authorization(text,text,text,boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_model_evaluation_authorization(text,text,text,boolean) TO cloudmarkup_gpt6_private_receipt_issuer;

CREATE FUNCTION cloudmarkup_notes_native_private.lock_native_zero_receipt(organization text,project text,principal text,plan_sha text,receipt text,receipt_sha text)
RETURNS SETOF public.model_live_native_zero_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p public.model_live_evaluation_plans%ROWTYPE;n public.model_live_native_zero_receipts%ROWTYPE;
  post_lock_checked_at timestamptz;
BEGIN
  IF (receipt IS NOT NULL AND receipt_sha ~ '^[a-f0-9]{64}$') IS NOT TRUE
  THEN RAISE EXCEPTION 'exact native receipt required' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM cloudmarkup_notes_native_private.lock_current_evaluation_plan(organization,project,principal,plan_sha);
  IF NOT FOUND THEN RETURN; END IF;
  IF (p.issued_at<=clock_timestamp() AND p.expires_at>clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM public.model_live_evaluation_revocations v WHERE v.organization_id=organization
      AND v.project_id=project AND v.principal_id=principal AND v.plan_sha256=plan_sha)) IS NOT TRUE THEN RETURN; END IF;
  SELECT native.* INTO n FROM public.model_live_native_zero_receipts native WHERE native.organization_id=organization
    AND native.project_id=project AND native.principal_id=principal AND native.plan_sha256=plan_sha
    AND native.receipt_id=receipt AND native.receipt_sha256=receipt_sha FOR SHARE OF native;
  IF NOT FOUND THEN RETURN; END IF;
  -- The immutable receipt may wait unchanged past plan expiry. Reopen the
  -- already locked plan/revocations in a fresh READ COMMITTED statement after
  -- the final row lock; no further lock acquisition follows this checkpoint.
  SELECT plan.* INTO p FROM public.model_live_evaluation_plans plan WHERE plan.organization_id=organization
    AND plan.project_id=project AND plan.principal_id=principal AND plan.plan_sha256=plan_sha
    AND NOT EXISTS(SELECT 1 FROM public.model_live_evaluation_revocations v WHERE v.organization_id=organization
      AND v.project_id=project AND v.principal_id=principal AND v.plan_sha256=plan_sha);
  IF NOT FOUND THEN RETURN; END IF;
  post_lock_checked_at:=clock_timestamp();
  IF (p.issued_at<=post_lock_checked_at AND p.expires_at>post_lock_checked_at) IS NOT TRUE THEN RETURN; END IF;
  RETURN NEXT n;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.lock_native_zero_receipt(text,text,text,text,text,text) OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.lock_native_zero_receipt(text,text,text,text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_native_zero_receipt(text,text,text,text,text,text) TO cloudmarkup_gpt6_private_receipt_issuer;

CREATE FUNCTION cloudmarkup_notes_native_private.lock_standard_ui_receipt(organization text,project text,principal text,plan_sha text,receipt text,receipt_sha text)
RETURNS SETOF public.model_live_standard_ui_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p public.model_live_evaluation_plans%ROWTYPE;u public.model_live_standard_ui_receipts%ROWTYPE;
  post_lock_checked_at timestamptz;
BEGIN
  IF (receipt IS NOT NULL AND receipt_sha ~ '^[a-f0-9]{64}$') IS NOT TRUE
  THEN RAISE EXCEPTION 'exact native UI receipt required' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM cloudmarkup_notes_native_private.lock_current_evaluation_plan(organization,project,principal,plan_sha);
  IF NOT FOUND THEN RETURN; END IF;
  IF (p.issued_at<=clock_timestamp() AND p.expires_at>clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM public.model_live_evaluation_revocations v WHERE v.organization_id=organization
      AND v.project_id=project AND v.principal_id=principal AND v.plan_sha256=plan_sha)) IS NOT TRUE THEN RETURN; END IF;
  SELECT ui.* INTO u FROM public.model_live_standard_ui_receipts ui WHERE ui.organization_id=organization
    AND ui.project_id=project AND ui.principal_id=principal AND ui.plan_sha256=plan_sha
    AND ui.receipt_id=receipt AND ui.receipt_sha256=receipt_sha FOR SHARE OF ui;
  IF NOT FOUND THEN RETURN; END IF;
  -- Preserve zero-row denial, and publish no row before the fresh plan and
  -- revocation read plus server clock check following the final receipt lock.
  SELECT plan.* INTO p FROM public.model_live_evaluation_plans plan WHERE plan.organization_id=organization
    AND plan.project_id=project AND plan.principal_id=principal AND plan.plan_sha256=plan_sha
    AND NOT EXISTS(SELECT 1 FROM public.model_live_evaluation_revocations v WHERE v.organization_id=organization
      AND v.project_id=project AND v.principal_id=principal AND v.plan_sha256=plan_sha);
  IF NOT FOUND THEN RETURN; END IF;
  post_lock_checked_at:=clock_timestamp();
  IF (p.issued_at<=post_lock_checked_at AND p.expires_at>post_lock_checked_at) IS NOT TRUE THEN RETURN; END IF;
  RETURN NEXT u;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.lock_standard_ui_receipt(text,text,text,text,text,text) OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.lock_standard_ui_receipt(text,text,text,text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_standard_ui_receipt(text,text,text,text,text,text) TO cloudmarkup_gpt6_private_receipt_issuer;

-- Historical revocation must remain available after plan/promotion expiry.
-- Current scoped owner authorization remains mandatory; no new approval is issued.
CREATE FUNCTION cloudmarkup_notes_native_private.lock_issued_promotion_receipt(organization text,project text,principal text,plan_sha text,receipt text,receipt_sha text,operator_id text)
RETURNS SETOF public.model_gpt6_promotions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF (plan_sha ~ '^[a-f0-9]{64}$' AND receipt IS NOT NULL AND receipt_sha ~ '^[a-f0-9]{64}$' AND operator_id IS NOT NULL) IS NOT TRUE
  THEN RAISE EXCEPTION 'exact issued promotion required' USING ERRCODE='42501'; END IF;
  PERFORM cloudmarkup_notes_native_private.lock_model_evaluation_authorization(organization,project,principal,false);
  PERFORM cloudmarkup_notes_native_private.lock_model_evaluation_authorization(organization,project,operator_id,true);
  RETURN QUERY SELECT r.* FROM public.model_gpt6_promotions r WHERE r.organization_id=organization
    AND r.project_id=project AND r.principal_id=principal AND r.plan_sha256=plan_sha
    AND r.receipt_id=receipt AND r.receipt_sha256=receipt_sha FOR SHARE OF r;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.lock_issued_promotion_receipt(text,text,text,text,text,text,text) OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.lock_issued_promotion_receipt(text,text,text,text,text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_issued_promotion_receipt(text,text,text,text,text,text,text) TO cloudmarkup_gpt6_private_receipt_issuer;

REVOKE CREATE ON SCHEMA cloudmarkup_notes_native_private FROM cloudmarkup_notes_native_lock_owner;

-- Held/promotion rows lacked forced scope policies in historical 0080. Pair the
-- metadata ACL with exact verified transaction-local scope. Existing native/UI/
-- product rows already have forced scope policies; no ordinary writer is granted.
ALTER TABLE public.model_gpt6_held_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.model_gpt6_held_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY gpt6_private_held_scope ON public.model_gpt6_held_reports
  USING(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true))
  WITH CHECK(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true));

ALTER TABLE public.model_gpt6_promotions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.model_gpt6_promotions FORCE ROW LEVEL SECURITY;

CREATE POLICY gpt6_private_promotion_scope ON public.model_gpt6_promotions
  USING(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true))
  WITH CHECK(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true));

ALTER TABLE public.model_gpt6_promotion_revocations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.model_gpt6_promotion_revocations FORCE ROW LEVEL SECURITY;

CREATE POLICY gpt6_private_promotion_revocation_scope ON public.model_gpt6_promotion_revocations
  USING(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true))
  WITH CHECK(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true));

GRANT SELECT ON public.beta_gpt6_product_receipts TO cloudmarkup_notes_native_lock_owner;

GRANT UPDATE(receipt_id) ON public.beta_gpt6_product_receipts TO cloudmarkup_notes_native_lock_owner;

GRANT CREATE ON SCHEMA cloudmarkup_notes_native_private TO cloudmarkup_notes_native_lock_owner;

-- FOR SHARE requires UPDATE on at least one column. Only the inaccessible
-- NOLOGIN helper owner receives that privilege; this function never updates.
-- The closed publisher retains worker/terminal checks before and after this
-- final immutable-row lock, and repeats the complete check after its INSERT.
CREATE FUNCTION cloudmarkup_notes_native_private.lock_gpt6_product_receipt(
  p_organization text,p_project text,p_principal text,p_job text,p_receipt text,p_receipt_sha text)
RETURNS SETOF public.beta_gpt6_product_receipts LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF (p_organization IS NOT NULL AND p_organization<>''
    AND p_project IS NOT NULL AND p_project<>''
    AND p_principal IS NOT NULL AND p_principal<>''
    AND p_job IS NOT NULL AND p_job<>'' AND p_receipt IS NOT NULL AND p_receipt<>''
    AND p_receipt_sha ~ '^[a-f0-9]{64}$'
    AND p_organization=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND p_project=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND p_principal=current_setting('cloudmarkup.product_receipt.principal_id',true)) IS NOT TRUE
  THEN RAISE EXCEPTION 'exact scoped GPT6 product receipt required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT receipt.* FROM public.beta_gpt6_product_receipts receipt
    WHERE receipt.organization_id=p_organization AND receipt.project_id=p_project
      AND receipt.principal_id=p_principal AND receipt.job_id=p_job
      AND receipt.receipt_id=p_receipt AND receipt.receipt_sha256=p_receipt_sha
    FOR SHARE OF receipt;
END;
$$;

ALTER FUNCTION cloudmarkup_notes_native_private.lock_gpt6_product_receipt(text,text,text,text,text,text)
  OWNER TO cloudmarkup_notes_native_lock_owner;

REVOKE ALL ON FUNCTION cloudmarkup_notes_native_private.lock_gpt6_product_receipt(text,text,text,text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION cloudmarkup_notes_native_private.lock_gpt6_product_receipt(text,text,text,text,text,text)
  TO cloudmarkup_gpt6_private_receipt_issuer;

REVOKE CREATE ON SCHEMA cloudmarkup_notes_native_private FROM cloudmarkup_notes_native_lock_owner;

-- All helper owner assignments and ACL operations have finished. No temporary
-- helper schema CREATE or administrator INHERIT/SET edge may reach COMMIT.
REVOKE cloudmarkup_notes_native_lock_owner FROM cloudmarkup_admin
  GRANTED BY cloudmarkup_admin RESTRICT;

DO $cm_private_bootstrap_final$
DECLARE helper_oid oid; admin_oid oid; grantor_oid oid; private_oids oid[]; expected_helpers oid[];
BEGIN
  SELECT oid INTO STRICT helper_oid FROM pg_catalog.pg_roles WHERE rolname='cloudmarkup_notes_native_lock_owner';
  SELECT oid INTO STRICT admin_oid FROM pg_catalog.pg_roles WHERE rolname='cloudmarkup_admin';
  SELECT oid INTO STRICT grantor_oid FROM pg_catalog.pg_roles WHERE rolname='rdsadmin';
  SELECT array_agg(oid ORDER BY oid) INTO private_oids FROM pg_catalog.pg_roles
    WHERE rolname IN ('cloudmarkup_notes_native_lock_owner','cloudmarkup_notes_publication_authority','cloudmarkup_notes_shared_native_producer','cloudmarkup_gpt6_private_receipt_issuer');
  IF cardinality(private_oids) <> 4 OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles
    WHERE oid=ANY(private_oids) AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb
      OR rolreplication OR rolbypassrls OR rolinherit))
    OR (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.roleid=ANY(private_oids)
      OR m.member=ANY(private_oids) OR m.roleid IN(admin_oid,grantor_oid)) NOT IN (0,4)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE
      (m.roleid=ANY(private_oids) OR m.member=ANY(private_oids) OR m.roleid IN(admin_oid,grantor_oid))
      AND NOT (m.roleid=ANY(private_oids) AND m.member=admin_oid AND m.grantor=grantor_oid
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option))
  THEN RAISE EXCEPTION 'Exact final private bootstrap graph required' USING ERRCODE='42501'; END IF;
  IF pg_catalog.has_schema_privilege(helper_oid,'public','CREATE')
    OR pg_catalog.has_schema_privilege(helper_oid,'cloudmarkup_notes_native_private','CREATE')
  THEN RAISE EXCEPTION 'Private helper schema CREATE must be absent' USING ERRCODE='42501'; END IF;
  SELECT array_agg(signature::regprocedure::oid) INTO expected_helpers FROM (VALUES
      ('cloudmarkup_notes_native_private.lock_current_authorization(text,text,text,boolean)',ARRAY['cloudmarkup_notes_publication_authority','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_current_evaluation_plan(text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_current_held_report(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_current_export(text,text,text,text,text,integer,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.record_publication_audit(text,text,text,text,text,text,timestamptz)',ARRAY['cloudmarkup_notes_publication_authority']::text[]),
      ('cloudmarkup_notes_native_private.lock_published_artifact(text,text,text,text,text,text,bigint,text)',ARRAY['cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_gpt6_product_terminal(text,text,text,text,text,text,text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_model_evaluation_authorization(text,text,text,boolean)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_native_zero_receipt(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_standard_ui_receipt(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_issued_promotion_receipt(text,text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_gpt6_product_receipt(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[])
  ) expected(signature,allowed_roles);
  IF cardinality(expected_helpers) <> 12
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=ANY(expected_helpers)
      AND (p.proowner<>helper_oid OR NOT p.prosecdef OR
        p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend d WHERE d.refclassid='pg_catalog.pg_authid'::regclass
      AND d.refobjid=helper_oid AND d.deptype='o'
      AND (d.dbid<>(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
        OR d.classid<>'pg_catalog.pg_proc'::regclass OR NOT (d.objid=ANY(expected_helpers))))
  THEN RAISE EXCEPTION 'Exact private fixed helper ownership required' USING ERRCODE='42501'; END IF;
  IF EXISTS(
    WITH expected(signature,allowed_roles) AS (VALUES
      ('cloudmarkup_notes_native_private.lock_current_authorization(text,text,text,boolean)',ARRAY['cloudmarkup_notes_publication_authority','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_current_evaluation_plan(text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_current_held_report(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_current_export(text,text,text,text,text,integer,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.record_publication_audit(text,text,text,text,text,text,timestamptz)',ARRAY['cloudmarkup_notes_publication_authority']::text[]),
      ('cloudmarkup_notes_native_private.lock_published_artifact(text,text,text,text,text,text,bigint,text)',ARRAY['cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_gpt6_product_terminal(text,text,text,text,text,text,text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_model_evaluation_authorization(text,text,text,boolean)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_native_zero_receipt(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_standard_ui_receipt(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_issued_promotion_receipt(text,text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_gpt6_product_receipt(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[])
    )
    SELECT 1 FROM expected e JOIN pg_catalog.pg_proc p ON p.oid=e.signature::regprocedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee
    WHERE a.privilege_type='EXECUTE' AND a.grantee<>helper_oid
      AND (a.grantee=0 OR r.rolname IS NULL OR NOT (r.rolname::text=ANY(e.allowed_roles)) OR a.is_grantable)
  ) OR EXISTS(
    WITH expected(signature,allowed_roles) AS (VALUES
      ('cloudmarkup_notes_native_private.lock_current_authorization(text,text,text,boolean)',ARRAY['cloudmarkup_notes_publication_authority','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_current_evaluation_plan(text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_current_held_report(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_current_export(text,text,text,text,text,integer,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer','cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.record_publication_audit(text,text,text,text,text,text,timestamptz)',ARRAY['cloudmarkup_notes_publication_authority']::text[]),
      ('cloudmarkup_notes_native_private.lock_published_artifact(text,text,text,text,text,text,bigint,text)',ARRAY['cloudmarkup_notes_shared_native_producer']::text[]),
      ('cloudmarkup_notes_native_private.lock_gpt6_product_terminal(text,text,text,text,text,text,text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_model_evaluation_authorization(text,text,text,boolean)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_native_zero_receipt(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_standard_ui_receipt(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_issued_promotion_receipt(text,text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[]),
      ('cloudmarkup_notes_native_private.lock_gpt6_product_receipt(text,text,text,text,text,text)',ARRAY['cloudmarkup_gpt6_private_receipt_issuer']::text[])
    )
    SELECT 1 FROM expected e CROSS JOIN LATERAL unnest(e.allowed_roles) allowed(role_name)
      LEFT JOIN pg_catalog.pg_roles r ON r.rolname=allowed.role_name
    WHERE r.oid IS NULL OR NOT pg_catalog.has_function_privilege(r.oid,e.signature::regprocedure,'EXECUTE')
  )
  THEN RAISE EXCEPTION 'Exact private helper EXECUTE ACL required' USING ERRCODE='42501'; END IF;
END;
$cm_private_bootstrap_final$;
