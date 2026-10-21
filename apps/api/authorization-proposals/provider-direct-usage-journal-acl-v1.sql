-- Reviewed source proposal only: not part of automatic canonical bootstrap.
-- Integration T00/T04 owns separate scoped real-PG qualification/admission.
-- Requires existing protected definitions/owner and exactly the two fixed
-- ordinary purpose users. No role creation, membership, business mutation,
-- DELETE/TRUNCATE, hosted ledger or owner credential enters the API runtime.
DO $provider_direct_acl$
BEGIN
  IF session_user <> 'cloudmarkup_admin' OR current_user <> 'cloudmarkup_admin'
    OR current_database() <> 'cloudmarkup'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_catalog.pg_roles r ON r.oid=c.relowner
      WHERE n.nspname='public' AND c.relname='provider_direct_invocations_v1'
        AND r.rolname='cloudmarkup_admin' AND c.relrowsecurity AND c.relforcerowsecurity)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner
      WHERE p.oid='public.cloudmarkup_provider_direct_assert_authority_v1(varchar,varchar,varchar,varchar,varchar,integer,varchar,char,varchar,varchar)'::regprocedure
        AND r.rolname='cloudmarkup_admin' AND p.prosecdef)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner
      WHERE p.oid='public.cloudmarkup_provider_direct_journal_transition_v1()'::regprocedure
        AND r.rolname='cloudmarkup_admin' AND NOT p.prosecdef)
    OR (SELECT count(*) FROM pg_catalog.pg_roles
      WHERE rolname IN ('cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime')) <> 2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
      WHERE r.rolname IN ('cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime')
      AND (NOT r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
        OR r.rolinherit OR r.rolreplication OR r.rolbypassrls
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)))
  THEN RAISE EXCEPTION 'Provider-direct ACL admission unavailable' USING ERRCODE='42501'; END IF;
END;
$provider_direct_acl$;
GRANT EXECUTE ON FUNCTION public.cloudmarkup_provider_direct_assert_authority_v1(varchar,varchar,varchar,varchar,varchar,integer,varchar,char,varchar,varchar)
  TO cloudmarkup_beta_proposal_runtime,cloudmarkup_beta_export_runtime;

GRANT SELECT,INSERT ON public.provider_direct_invocations_v1 TO cloudmarkup_beta_proposal_runtime,cloudmarkup_beta_export_runtime;

GRANT UPDATE(state,usage_metadata,usage_sha256,outcome_metadata,outcome_sha256,uncertain_reason,revision,updated_at)
  ON public.provider_direct_invocations_v1 TO cloudmarkup_beta_proposal_runtime,cloudmarkup_beta_export_runtime;
