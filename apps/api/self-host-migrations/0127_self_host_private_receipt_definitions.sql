-- Standalone PostgreSQL17 admission/transfer assertions only.
-- The fixed profile loader inserts these three blocks into immutable canonical 0127.
-- All other role, schema, function, RLS, trigger and ACL statements are reused verbatim.
-- cloudmarkup_owner is the real initdb bootstrap superuser; no RDS role is forged.

DO $cm_private_bootstrap_admission$
BEGIN
  IF session_user::text <> 'cloudmarkup_admin' OR current_user::text <> 'cloudmarkup_admin'
    OR pg_catalog.current_database() <> 'cloudmarkup'
    OR pg_catalog.current_setting('server_version_num')::integer < 170000
    OR pg_catalog.current_setting('server_version_num')::integer >= 180000
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname='cloudmarkup_admin' AND rolcanlogin AND rolcreaterole AND NOT rolsuper)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='cloudmarkup_owner')
  THEN RAISE EXCEPTION 'Standalone PostgreSQL17 private bootstrap required' USING ERRCODE='42501'; END IF;
END;
$cm_private_bootstrap_admission$;

DO $cm_private_bootstrap_owner_edge$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
    WHERE r.rolname='cloudmarkup_notes_native_lock_owner') <> 1
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
      JOIN pg_catalog.pg_roles a ON a.oid=m.member
      JOIN pg_catalog.pg_roles g ON g.oid=m.grantor
      WHERE r.rolname='cloudmarkup_notes_native_lock_owner' AND a.rolname='cloudmarkup_admin'
        AND g.rolname='cloudmarkup_owner' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
  THEN RAISE EXCEPTION 'Exact private helper bootstrap edge required' USING ERRCODE='42501'; END IF;
END;
$cm_private_bootstrap_owner_edge$;

DO $cm_private_bootstrap_final$
DECLARE helper_oid oid; admin_oid oid; grantor_oid oid; private_oids oid[]; expected_helpers oid[];
BEGIN
  SELECT oid INTO STRICT helper_oid FROM pg_catalog.pg_roles WHERE rolname='cloudmarkup_notes_native_lock_owner';
  SELECT oid INTO STRICT admin_oid FROM pg_catalog.pg_roles WHERE rolname='cloudmarkup_admin';
  SELECT oid INTO STRICT grantor_oid FROM pg_catalog.pg_roles WHERE rolname='cloudmarkup_owner';
  SELECT array_agg(oid ORDER BY oid) INTO private_oids FROM pg_catalog.pg_roles
    WHERE rolname IN ('cloudmarkup_notes_native_lock_owner','cloudmarkup_notes_publication_authority','cloudmarkup_notes_shared_native_producer','cloudmarkup_gpt6_private_receipt_issuer');
  IF cardinality(private_oids) <> 4 OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles
    WHERE oid=ANY(private_oids) AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb
      OR rolreplication OR rolbypassrls OR rolinherit))
    OR (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.roleid=ANY(private_oids)
      OR m.member=ANY(private_oids) OR m.roleid IN(admin_oid,grantor_oid)) <> 4
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
      AND (d.dbid<>(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
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
