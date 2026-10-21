-- Source definitions only. Runtime grants and protected-column permissions remain disabled.
-- Existing migration runners own each transaction and ledger write.

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_project_request_authorization(p_purpose text,p1 text,p2 text,p3 text,p4 text,p5 text)
RETURNS TABLE(locked_keys_json text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$

BEGIN
  IF session_user::text<>'cloudmarkup_beta_api_runtime' OR current_user::text<>'cloudmarkup_admin' OR current_database()<>'cloudmarkup'
    OR current_setting('session_replication_role')<>'origin'
    OR pg_catalog.has_parameter_privilege(session_user,'session_replication_role','SET, ALTER SYSTEM') THEN
    RAISE EXCEPTION 'Ordinary authorization lock unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.memberships'::regclass,'public.organization_roles'::regclass,'public.organizations'::regclass,'public.principals'::regclass,'public.projects'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary authorization requires reviewed row security' USING ERRCODE='42501';
  END IF;
  IF p_purpose='intent-scope' AND p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NOT NULL AND p5 IS NOT NULL AND p3 IN ('projects.read','projects.mutate') THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,p.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM public.projects p JOIN public.organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
      JOIN public.memberships m ON m.organization_id=p.organization_id AND m.principal_id=p1 AND m.lifecycle_status='active'
      JOIN public.principals actor ON actor.principal_id=m.principal_id AND actor.lifecycle_status='active'
      JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      WHERE p.project_id=p2 AND (p.lifecycle_status='active' OR (p3='projects.read' AND p.lifecycle_status='archived'))
        AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
        AND r.capabilities @> ARRAY[p3]::text[] AND p4::timestamptz>clock_timestamp() AND p5::timestamptz<=clock_timestamp()+INTERVAL '60 seconds'
      FOR UPDATE OF p FOR SHARE OF o,m,actor,r
  ) locked;
  ELSIF p_purpose='preview-resolve' AND p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NOT NULL AND p5 IS NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,p.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM public.projects p
        JOIN public.organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
        JOIN public.memberships m ON m.organization_id=p.organization_id AND m.principal_id=p1 AND m.lifecycle_status='active'
        JOIN public.principals actor ON actor.principal_id=m.principal_id AND actor.lifecycle_status='active'
        JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
        WHERE p.project_id=p2 AND p.lifecycle_status='active'
          AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
          AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
          AND p3::timestamptz>clock_timestamp() AND p4::timestamptz<=clock_timestamp()+INTERVAL '60 seconds'
        FOR UPDATE OF p FOR SHARE OF o,m,actor,r
  ) locked;
  ELSIF p_purpose='preview-current' AND p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NULL AND p5 IS NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,p.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM public.projects p
      JOIN public.organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
      JOIN public.principals actor ON actor.principal_id=p3 AND actor.lifecycle_status='active'
      JOIN public.memberships m ON m.organization_id=p.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
      JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      WHERE p.organization_id=p1 AND p.project_id=p2 AND p.lifecycle_status='active'
        AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
        AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
      FOR UPDATE OF p FOR SHARE OF o,actor,m,r
  ) locked;
  ELSIF p_purpose='preview-journal' AND p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NULL AND p5 IS NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,pr.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM public.memberships m
          JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
          JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
          JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
          JOIN public.projects pr ON pr.organization_id=m.organization_id AND pr.project_id=p2 AND pr.lifecycle_status='active'
          WHERE m.organization_id=p1 AND m.principal_id=p3 AND m.lifecycle_status='active'
            AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
            AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
          FOR SHARE OF m,p,o,r,pr
  ) locked;
  ELSIF p_purpose='hosted-validation' AND p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NOT NULL AND p5 IS NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,p.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM public.memberships m
    JOIN public.principals u ON u.principal_id = m.principal_id AND u.lifecycle_status = 'active'
    JOIN public.organizations o ON o.organization_id = m.organization_id AND o.lifecycle_status = 'active'
    JOIN public.organization_roles r ON r.organization_id = m.organization_id AND r.role_key = m.role_key AND r.policy_version = 'authorization-v2'
    JOIN public.projects p ON p.organization_id = m.organization_id AND p.project_id = p4 AND p.lifecycle_status = 'active'
    WHERE m.membership_id = p1 AND m.principal_id = p2 AND m.organization_id = p3 AND m.lifecycle_status = 'active'
    FOR SHARE OF m, u, o, r, p
  ) locked;
  ELSIF p_purpose='editing-lease' AND p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NULL AND p4 IS NULL AND p5 IS NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,project.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM public.projects project
    JOIN public.organizations o ON o.organization_id=project.organization_id AND o.lifecycle_status='active'
    JOIN public.memberships m ON m.organization_id=o.organization_id AND m.principal_id=p1 AND m.lifecycle_status='active'
    JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
    JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
    WHERE project.project_id=p2 AND project.lifecycle_status='active'
    FOR UPDATE OF project FOR SHARE OF m,p,o,r
  ) locked;
  ELSIF p_purpose='approved-package' AND p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NULL AND p5 IS NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,project.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM public.memberships m
       JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
       JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
       JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
       JOIN public.projects project ON project.organization_id=m.organization_id AND project.project_id=p3 AND project.lifecycle_status='active'
       WHERE m.principal_id=p1 AND m.organization_id=p2 AND m.lifecycle_status='active'
       FOR SHARE OF m, p, o, r, project
  ) locked;
  ELSIF p_purpose='active-project-lookup' AND p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NOT NULL AND p5 IS NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
WITH authorized_project AS MATERIALIZED (
        SELECT project_id FROM public.projects WHERE organization_id=p1 AND project_id=p2
          AND lifecycle_status='active' FOR SHARE
      ), authorized_membership AS MATERIALIZED (
        SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json
        FROM authorized_project project
        JOIN public.memberships m ON m.organization_id=p1 AND m.principal_id=p3 AND m.lifecycle_status='active'
        JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
        JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
        JOIN public.organization_roles r ON r.organization_id=m.organization_id
          AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
        FOR SHARE OF m,p,o,r
      )
      SELECT CASE WHEN m.membership_id IS NULL THEN NULL ELSE jsonb_build_array(p1::text,p2::text,p3::text,m.membership_id,m.role_key)::text END AS __cloudmarkup_ordinary_authorization_key
      FROM (SELECT 1) anchor LEFT JOIN authorized_membership m ON TRUE
  ) locked;
  ELSE
    RAISE EXCEPTION 'Ordinary authorization purpose unavailable' USING ERRCODE='42501';
  END IF;
END;
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_project_request_authorization(text,text,text,text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_project_request_authorization(text,text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_billing_request_authorization(p_purpose text,p1 text,p2 text,p3 text,p4 text)
RETURNS TABLE(locked_keys_json text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$

BEGIN
  IF session_user::text<>'cloudmarkup_beta_api_runtime' OR current_user::text<>'cloudmarkup_admin' OR current_database()<>'cloudmarkup'
    OR current_setting('session_replication_role')<>'origin'
    OR pg_catalog.has_parameter_privilege(session_user,'session_replication_role','SET, ALTER SYSTEM') THEN
    RAISE EXCEPTION 'Ordinary authorization lock unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.memberships'::regclass,'public.organization_billing_accounts'::regclass,'public.organization_roles'::regclass,'public.organization_subscription_projections'::regclass,'public.organizations'::regclass,'public.principals'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary authorization requires reviewed row security' USING ERRCODE='42501';
  END IF;
  IF p_purpose='billing-session' AND p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NOT NULL AND p4 IN ('test','live') THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(membership.organization_id,membership.principal_id,membership.membership_id,membership.role_key,account.billing_account_id)::text AS __cloudmarkup_ordinary_authorization_key FROM public.memberships membership
         JOIN public.principals principal
           ON principal.principal_id = membership.principal_id
         JOIN public.organizations organization
           ON organization.organization_id = membership.organization_id
         JOIN public.organization_roles role
           ON role.organization_id = membership.organization_id
          AND role.role_key = membership.role_key
         JOIN public.organization_billing_accounts account
           ON account.organization_id = membership.organization_id
         LEFT JOIN public.organization_subscription_projections subscription
           ON subscription.organization_id = account.organization_id
          AND subscription.billing_account_id = account.billing_account_id
          AND subscription.provider_environment = p4
         WHERE membership.membership_id = p1
           AND membership.principal_id = p2
           AND membership.organization_id = p3
           AND membership.lifecycle_status = 'active'
           AND principal.lifecycle_status = 'active'
           AND organization.lifecycle_status = 'active'
           AND role.policy_version = 'authorization-v2'
           AND 'billing.manage' = ANY(role.capabilities)
         FOR UPDATE OF account FOR SHARE OF membership, principal, organization, role
  ) locked;
  ELSIF p_purpose='credit-top-up' AND p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NOT NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,a.billing_account_id)::text AS __cloudmarkup_ordinary_authorization_key FROM public.organization_billing_accounts a
     JOIN public.memberships m ON m.organization_id=a.organization_id AND m.principal_id=p3 AND m.membership_id=p4 AND m.lifecycle_status='active'
     JOIN public.principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
     JOIN public.organizations o ON o.organization_id=a.organization_id AND o.lifecycle_status='active'
     JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2' AND 'billing.manage'=ANY(r.capabilities)
     WHERE a.organization_id=p1 AND a.billing_account_id=p2 AND a.lifecycle_status='active'
     FOR UPDATE OF a FOR SHARE OF m,p,o,r
  ) locked;
  ELSE
    RAISE EXCEPTION 'Ordinary authorization purpose unavailable' USING ERRCODE='42501';
  END IF;
END;
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_billing_request_authorization(text,text,text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_billing_request_authorization(text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_organization_policy_membership(p_purpose text,p1 text,p2 text)
RETURNS TABLE(locked_keys_json text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$

BEGIN
  IF session_user::text<>'cloudmarkup_beta_api_runtime' OR current_user::text<>'cloudmarkup_admin' OR current_database()<>'cloudmarkup'
    OR current_setting('session_replication_role')<>'origin'
    OR pg_catalog.has_parameter_privilege(session_user,'session_replication_role','SET, ALTER SYSTEM') THEN
    RAISE EXCEPTION 'Ordinary authorization lock unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.memberships'::regclass,'public.organization_roles'::regclass,'public.organizations'::regclass,'public.principals'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary authorization requires reviewed row security' USING ERRCODE='42501';
  END IF;
  IF p_purpose='invitation-issuer' AND p1 IS NOT NULL AND p2 IS NOT NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key)::text AS __cloudmarkup_ordinary_authorization_key FROM public.memberships m JOIN public.principals p ON p.principal_id=m.principal_id
      JOIN public.organizations o ON o.organization_id=m.organization_id
      JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      WHERE m.organization_id=p1 AND m.principal_id=p2 AND m.lifecycle_status='active'
        AND p.lifecycle_status='active' AND o.lifecycle_status='active'
        AND r.policy_version='authorization-v2'
        AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
      FOR SHARE OF m,p,o,r
  ) locked;
  ELSIF p_purpose='invitation-target' AND p1 IS NOT NULL AND p2 IS NOT NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key)::text AS __cloudmarkup_ordinary_authorization_key FROM public.memberships m
      JOIN public.organization_roles role ON role.organization_id=m.organization_id AND role.role_key=m.role_key
      WHERE m.organization_id=p1 AND m.principal_id=p2 AND role.policy_version='authorization-v2'
        AND role.capabilities=public.cloudmarkup_authorization_v2_permissions(role.role_key)
      FOR SHARE OF m,role
  ) locked;
  ELSIF p_purpose='member-view' AND p1 IS NOT NULL AND p2 IS NOT NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key)::text AS __cloudmarkup_ordinary_authorization_key FROM public.memberships m JOIN public.principals p ON p.principal_id=m.principal_id
  JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key WHERE m.organization_id=p1 AND m.principal_id=p2 AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key) FOR SHARE OF m,r
  ) locked;
  ELSE
    RAISE EXCEPTION 'Ordinary authorization purpose unavailable' USING ERRCODE='42501';
  END IF;
END;
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_organization_policy_membership(text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_organization_policy_membership(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_preview_ack_workflow(p1 text,p2 text,p3 text,p4 text,p5 text)
RETURNS TABLE(locked_keys_json text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$

BEGIN
  IF session_user::text<>'cloudmarkup_beta_api_runtime' OR current_user::text<>'cloudmarkup_admin' OR current_database()<>'cloudmarkup'
    OR current_setting('session_replication_role')<>'origin'
    OR pg_catalog.has_parameter_privilege(session_user,'session_replication_role','SET, ALTER SYSTEM') THEN
    RAISE EXCEPTION 'Ordinary authorization lock unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.model_commercial_workflows'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary authorization requires reviewed row security' USING ERRCODE='42501';
  END IF;
  IF p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NOT NULL AND p5 IS NOT NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT 'fixed'::text AS __cloudmarkup_ordinary_authorization_key FROM public.model_commercial_workflows
            WHERE organization_id=p1 AND project_id=p2 AND principal_id=p3
              AND workflow_id=p4 AND scope_sha256=p5 FOR SHARE
  ) locked;
  ELSE
    RAISE EXCEPTION 'Ordinary authorization purpose unavailable' USING ERRCODE='42501';
  END IF;
END;
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_preview_ack_workflow(text,text,text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_preview_ack_workflow(text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_export_initial_claim_authorization(p1 text,p2 text,p3 text)
RETURNS TABLE(locked_keys_json text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$

BEGIN
  IF session_user::text<>'cloudmarkup_beta_export_runtime' OR current_user::text<>'cloudmarkup_admin' OR current_database()<>'cloudmarkup'
    OR current_setting('session_replication_role')<>'origin'
    OR pg_catalog.has_parameter_privilege(session_user,'session_replication_role','SET, ALTER SYSTEM') THEN
    RAISE EXCEPTION 'Ordinary authorization lock unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.async_jobs'::regclass,'public.memberships'::regclass,'public.organization_roles'::regclass,'public.organizations'::regclass,'public.principals'::regclass,'public.solution_export_runs'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary authorization requires reviewed row security' USING ERRCODE='42501';
  END IF;
  IF p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,x.project_id,x.solution_export_run_id)::text AS __cloudmarkup_ordinary_authorization_key FROM public.solution_export_runs x
     JOIN public.async_jobs j ON j.organization_id=x.organization_id AND j.project_id=x.project_id
       AND j.job_id=x.root_job_id AND j.job_id=x.solution_export_run_id
     JOIN public.principals actor ON actor.principal_id=x.created_by_principal_id AND actor.lifecycle_status='active'
     JOIN public.memberships m ON m.organization_id=x.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
     JOIN public.organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
     JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
     WHERE x.organization_id=p1 AND x.project_id=p2 AND x.solution_export_run_id=p3
       AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL
       AND j.family='solution-export-orchestration' AND j.subject_kind='solution-revision'
       AND j.created_by_actor_kind='principal' AND j.idempotency_scope='solution-export-jobs.create'
       AND j.created_by_principal_id=x.created_by_principal_id AND j.idempotency_actor_id=x.created_by_principal_id
       AND j.solution_revision_id=x.solution_revision_id
       AND j.solution_manifest_record_id=x.solution_manifest_record_id AND j.solution_manifest_sha256=x.solution_manifest_sha256
       AND j.environment_type=x.environment_type AND j.environment_id IS NOT DISTINCT FROM x.environment_id
       AND j.input_object_id=x.orchestration_input_object_id AND j.input_sha256=x.orchestration_input_sha256
       AND j.entitlement_decision_reference=x.entitlement_decision_reference
     FOR SHARE OF x,actor,m,o,r
  ) locked;
  ELSE
    RAISE EXCEPTION 'Ordinary authorization purpose unavailable' USING ERRCODE='42501';
  END IF;
END;
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_export_initial_claim_authorization(text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_export_initial_claim_authorization(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.lock_preview_ack_commit_authorization(p1 text,p2 text,p3 text,p4 text)
RETURNS TABLE(locked_keys_json text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
DECLARE receipt public.ai_intent_preview_authorities%ROWTYPE;
BEGIN
  IF session_user::text<>'cloudmarkup_beta_api_runtime' OR current_user::text<>'cloudmarkup_admin' OR current_database()<>'cloudmarkup'
    OR current_setting('session_replication_role')<>'origin'
    OR pg_catalog.has_parameter_privilege(session_user,'session_replication_role','SET, ALTER SYSTEM') THEN
    RAISE EXCEPTION 'Ordinary authorization lock unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.ai_intent_preview_authorities'::regclass,'public.ai_intent_previews'::regclass,'public.architecture_drafts'::regclass,'public.memberships'::regclass,'public.organization_roles'::regclass,'public.organizations'::regclass,'public.principals'::regclass,'public.project_editing_leases'::regclass,'public.projects'::regclass,'public.stored_objects'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary authorization requires reviewed row security' USING ERRCODE='42501';
  END IF;
  SELECT * INTO receipt FROM public.ai_intent_preview_authorities a
    WHERE a.organization_id=p1 AND a.project_id=p2 AND a.principal_id=p3 AND a.invocation_id=p4;
  IF NOT FOUND THEN RAISE EXCEPTION 'Preview original authority unavailable' USING ERRCODE='42501'; END IF;
  IF p1 IS NOT NULL AND p2 IS NOT NULL AND p3 IS NOT NULL AND p4 IS NOT NULL THEN
  RETURN QUERY SELECT COALESCE(jsonb_agg(locked.__cloudmarkup_ordinary_authorization_key ORDER BY locked.__cloudmarkup_ordinary_authorization_key) FILTER (WHERE locked.__cloudmarkup_ordinary_authorization_key IS NOT NULL),'[]'::jsonb)::text FROM (
SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,p.project_id,l.lease_id,d.draft_id,d.draft_version::text,d.document_object_id,obj.object_id)::text AS __cloudmarkup_ordinary_authorization_key FROM public.projects p
    JOIN public.organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
    JOIN public.principals actor ON actor.principal_id=receipt.principal_id AND actor.lifecycle_status='active'
    JOIN public.memberships m ON m.organization_id=p.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
    JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    JOIN public.project_editing_leases l ON l.organization_id=p.organization_id AND l.project_id=p.project_id
    JOIN public.architecture_drafts d ON d.organization_id=p.organization_id AND d.project_id=p.project_id AND d.draft_id=p.current_draft_id
    JOIN public.stored_objects obj ON obj.organization_id=d.organization_id AND obj.project_id=d.project_id AND obj.object_id=d.document_object_id
    JOIN public.ai_intent_previews preview ON preview.organization_id=receipt.organization_id AND preview.project_id=receipt.project_id
      AND preview.principal_id=receipt.principal_id AND preview.invocation_id=receipt.invocation_id
    WHERE p.organization_id=receipt.organization_id AND p.project_id=receipt.project_id AND p.lifecycle_status='active'
      AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
      AND l.lease_id=receipt.lease_id AND l.principal_id=receipt.principal_id
      AND encode(sha256(convert_to(l.session_id,'UTF8')),'hex')=receipt.session_sha256
      AND l.released_at IS NULL AND l.expires_at>clock_timestamp() AND l.authentication_expires_at>clock_timestamp()
      AND receipt.authentication_expires_at>clock_timestamp()
      AND d.draft_id=receipt.draft_id AND d.draft_version=receipt.draft_version AND d.content_sha256=receipt.content_sha256
      AND d.pending_document_object_id IS NULL AND obj.lifecycle_state='published' AND obj.content_sha256=d.content_sha256
      AND obj.object_purpose='architecture-draft' AND preview.binding_sha256=receipt.binding_sha256
    FOR SHARE OF o,actor,m,r,l,d,obj
  ) locked;
  ELSE
    RAISE EXCEPTION 'Ordinary authorization purpose unavailable' USING ERRCODE='42501';
  END IF;
END;
$cm$;

ALTER FUNCTION cloudmarkup_ordinary_private.lock_preview_ack_commit_authorization(text,text,text,text) OWNER TO cloudmarkup_admin;

REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.lock_preview_ack_commit_authorization(text,text,text,text) FROM PUBLIC;
