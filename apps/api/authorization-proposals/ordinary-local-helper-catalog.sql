-- Read-only installed admission. Every returned failure refuses business tests.
WITH expected(signature,body_sha256,result_kind) AS (VALUES ('cloudmarkup_ordinary_private.lock_billing_account(text)','aaec2aee3685752d6ccc8f096a53c6690e5f37c0bfa5cbce798f0ba7482be239','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_subscription_plan(text,text)','64cfd65d42ad19fc7fdd3cabca18f356c5584df5ac06533fab81098fda7664e4','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_credit_grant_replay(text,text,text,text,text,text,text)','a53517e5f9d9b78463338c26c030b8814b1bffac02772b9baf7e616979b5e1f3','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_ledger_replay(text,text,text)','9072ad4dae6c9661ff1c817e4cb6ad9af0b9fb3fe859f4b1ed620e85d03fb560','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_included_grant_plan(text,text,text)','8dbfea451e15221d50cf2ce92418e615afad74ed4ec8d4cd713aebb7855bf322','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_top_up_account(text,text)','a888cc32a1ed00ced094972a71b67eb0d5d17f7abde47c8857ba96c32c4d3a98','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_proposal_job_authority(text,text,text,text,text)','b59db2586b2b35a4fcbbee59d5eb166295cc1b0a27e4dae50b1809d182b0fb03','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_export_worker_authority(text,text,text,text,text,text,text,text)','ae497cac92b2fea3f4ae06cc69a3d499f29ad4a490119cf005c680cfe1617e40','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_request_membership(text,text)','d3408bee9813ea2b26ce9de3c3990240f6436098a0ce8888620aa103be6616c1','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_project_scope(text,text)','e70576bf8be35c1b1139749f8ccd7130c75521a4643a30b93d350f9ec83d600c','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_writer_scope(text,text)','868251e81944908987f5ea48609b42e878bb48c5574cde49d3b7032ba2aef686','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_cleanup_control()','0298c5e804b815848bb59fcfa5aa28675b570192d4776b8e817e5e42a657696e','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_staging_membership(text,text,text)','20bbb343414eac9ff103d553593a69151ad43f2d41529c5652a775f6fb8c729a','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_staging_project(text)','26e24efade0b9bb3d4bfb0edadd065df4e7ed3467d8cf8f816a846bf9c131779','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_proposal_baseline(text,text,text,text,text)','13b28540746661c135391bf8866b6bed5a529b5136e0f59939eaf5392e14f128','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_staff_authority(text)','9abb29650603871ed4e07313ab2ec2425992aa85738f3097e00e254a390653c9','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_staff_financial_reference(text,text,text,text)','bf766b2960be372a22dc45f9347344b4d54b534c5df5888dbdc13e46ba53c01d','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_billing_account_share(text)','f1a4190338e86cfe32686590434fecd0e3156f762a63c5f91ce1d4f471c9a352','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_project_request_authorization(text,text,text,text,text,text)','778eae9631d8ada06a86ddbc28cd6922a9bc2ca40c85587e1505f8355fa11477','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_billing_request_authorization(text,text,text,text,text)','6595aeec09ad09493113b16cdefa3d11bf3d5b271279624f85b7ba9d5118dcfc','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_organization_policy_membership(text,text,text)','a7d14ce775d1b13a348e32715c08f46fb65fff0d6dee5894328ff71293ef44e0','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_preview_ack_workflow(text,text,text,text,text)','3411779a5f563a677ecee9b245e097b1afd13c3d299bc2e30fdcbdbbf70600f0','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_export_initial_claim_authorization(text,text,text)','f65324d9050b8b3843998990585cab1d8c9047b8f92b65301d744a5b6d305cff','locked_keys_json'),
('cloudmarkup_ordinary_private.lock_preview_ack_commit_authorization(text,text,text,text)','6f8c07d75a89de78cac8e0ae0765e94b8803aaffb496d6d888d245a92d660ce8','locked_keys_json'),
('cloudmarkup_ordinary_private.verify_preview_ack_canonical(text,text,text,text,text,jsonb,text,text,jsonb)','7a7e5908d797601e28161c943e4425c1dbb6268317ac15a5c83c0bb6743455e9','boolean')),
  allowed(login,signature) AS (VALUES ('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_billing_account(text)'),
('cloudmarkup_beta_proposal_runtime','cloudmarkup_ordinary_private.lock_billing_account(text)'),
('cloudmarkup_beta_export_runtime','cloudmarkup_ordinary_private.lock_billing_account(text)'),
('cloudmarkup_beta_billing_runtime','cloudmarkup_ordinary_private.lock_billing_account(text)'),
('cloudmarkup_beta_billing_runtime','cloudmarkup_ordinary_private.lock_subscription_plan(text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_credit_grant_replay(text,text,text,text,text,text,text)'),
('cloudmarkup_beta_billing_runtime','cloudmarkup_ordinary_private.lock_credit_grant_replay(text,text,text,text,text,text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_ledger_replay(text,text,text)'),
('cloudmarkup_beta_proposal_runtime','cloudmarkup_ordinary_private.lock_ledger_replay(text,text,text)'),
('cloudmarkup_beta_billing_runtime','cloudmarkup_ordinary_private.lock_ledger_replay(text,text,text)'),
('cloudmarkup_beta_billing_runtime','cloudmarkup_ordinary_private.lock_included_grant_plan(text,text,text)'),
('cloudmarkup_beta_billing_runtime','cloudmarkup_ordinary_private.lock_top_up_account(text,text)'),
('cloudmarkup_beta_proposal_runtime','cloudmarkup_ordinary_private.lock_proposal_job_authority(text,text,text,text,text)'),
('cloudmarkup_beta_export_runtime','cloudmarkup_ordinary_private.lock_export_worker_authority(text,text,text,text,text,text,text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_request_membership(text,text)'),
('cloudmarkup_beta_proposal_runtime','cloudmarkup_ordinary_private.lock_request_membership(text,text)'),
('cloudmarkup_beta_export_runtime','cloudmarkup_ordinary_private.lock_request_membership(text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_project_scope(text,text)'),
('cloudmarkup_beta_proposal_runtime','cloudmarkup_ordinary_private.lock_project_scope(text,text)'),
('cloudmarkup_beta_export_runtime','cloudmarkup_ordinary_private.lock_project_scope(text,text)'),
('cloudmarkup_beta_cleanup_runtime','cloudmarkup_ordinary_private.lock_project_scope(text,text)'),
('cloudmarkup_beta_billing_runtime','cloudmarkup_ordinary_private.lock_project_scope(text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_writer_scope(text,text)'),
('cloudmarkup_beta_proposal_runtime','cloudmarkup_ordinary_private.lock_writer_scope(text,text)'),
('cloudmarkup_beta_export_runtime','cloudmarkup_ordinary_private.lock_writer_scope(text,text)'),
('cloudmarkup_beta_cleanup_runtime','cloudmarkup_ordinary_private.lock_writer_scope(text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_cleanup_control()'),
('cloudmarkup_beta_proposal_runtime','cloudmarkup_ordinary_private.lock_cleanup_control()'),
('cloudmarkup_beta_export_runtime','cloudmarkup_ordinary_private.lock_cleanup_control()'),
('cloudmarkup_beta_cleanup_runtime','cloudmarkup_ordinary_private.lock_cleanup_control()'),
('cloudmarkup_beta_billing_runtime','cloudmarkup_ordinary_private.lock_cleanup_control()'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_staging_membership(text,text,text)'),
('cloudmarkup_beta_proposal_runtime','cloudmarkup_ordinary_private.lock_staging_membership(text,text,text)'),
('cloudmarkup_beta_export_runtime','cloudmarkup_ordinary_private.lock_staging_membership(text,text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_staging_project(text)'),
('cloudmarkup_beta_proposal_runtime','cloudmarkup_ordinary_private.lock_staging_project(text)'),
('cloudmarkup_beta_export_runtime','cloudmarkup_ordinary_private.lock_staging_project(text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_proposal_baseline(text,text,text,text,text)'),
('cloudmarkup_beta_proposal_runtime','cloudmarkup_ordinary_private.lock_proposal_baseline(text,text,text,text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_staff_authority(text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_staff_financial_reference(text,text,text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_billing_account_share(text)'),
('cloudmarkup_beta_proposal_runtime','cloudmarkup_ordinary_private.lock_billing_account_share(text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_project_request_authorization(text,text,text,text,text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_billing_request_authorization(text,text,text,text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_organization_policy_membership(text,text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_preview_ack_workflow(text,text,text,text,text)'),
('cloudmarkup_beta_export_runtime','cloudmarkup_ordinary_private.lock_export_initial_claim_authorization(text,text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.lock_preview_ack_commit_authorization(text,text,text,text)'),
('cloudmarkup_beta_api_runtime','cloudmarkup_ordinary_private.verify_preview_ack_canonical(text,text,text,text,text,jsonb,text,text,jsonb)')),
  hosts(login) AS (VALUES ('cloudmarkup_beta_api_runtime'),('cloudmarkup_beta_proposal_runtime'),('cloudmarkup_beta_export_runtime'),('cloudmarkup_beta_cleanup_runtime'),('cloudmarkup_beta_billing_runtime')),
  schema_failures AS (
    SELECT 'schema-acl:'||h.login||':'||required.name AS failure
    FROM hosts h CROSS JOIN (VALUES ('public'),('cloudmarkup_ordinary_private')) required(name)
    LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=required.name
    LEFT JOIN pg_catalog.pg_roles owner ON owner.oid=n.nspowner
    WHERE n.oid IS NULL OR NOT pg_catalog.has_schema_privilege(h.login,n.oid,'USAGE')
      OR pg_catalog.has_schema_privilege(h.login,n.oid,'CREATE')
      OR pg_catalog.has_schema_privilege(h.login,n.oid,'USAGE WITH GRANT OPTION,CREATE WITH GRANT OPTION')
      OR (required.name='cloudmarkup_ordinary_private' AND (
        owner.rolname IS DISTINCT FROM 'cloudmarkup_admin'
        OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a WHERE a.grantee=0 AND a.privilege_type IN ('USAGE','CREATE'))))
  ),
  helper_failures AS (
    SELECT 'helper-definition:'||e.signature AS failure FROM expected e
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
    LEFT JOIN pg_catalog.pg_roles owner ON owner.oid=p.proowner
    WHERE p.oid IS NULL OR NOT p.prosecdef OR owner.rolname IS DISTINCT FROM 'cloudmarkup_admin'
      OR encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM e.body_sha256
      OR NOT COALESCE(p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=on']::text[],false)
      OR CASE WHEN e.result_kind='boolean' THEN p.prorettype<>'pg_catalog.bool'::regtype OR p.proretset
        ELSE p.prorettype<>'pg_catalog.text'::regtype OR NOT p.proretset
          OR p.proargnames[array_length(p.proargnames,1)] IS DISTINCT FROM 'locked_keys_json' END
      OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
  ), helper_acl_failures AS (
    SELECT 'helper-execute:'||h.login||':'||e.signature AS failure FROM hosts h CROSS JOIN expected e
    WHERE pg_catalog.has_function_privilege(h.login,pg_catalog.to_regprocedure(e.signature),'EXECUTE') IS DISTINCT FROM EXISTS(SELECT 1 FROM allowed a WHERE a.login=h.login AND a.signature=e.signature)
      OR pg_catalog.has_function_privilege(h.login,pg_catalog.to_regprocedure(e.signature),'EXECUTE WITH GRANT OPTION')
  ), private_failures AS (
    SELECT 'private-table:'||h.login||':'||t.relname AS failure FROM hosts h CROSS JOIN pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relkind IN ('r','p') AND left(t.relname,6)='model_'
      AND (pg_catalog.has_any_column_privilege(h.login,t.oid,'SELECT,INSERT,UPDATE') OR pg_catalog.has_table_privilege(h.login,t.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  )
SELECT failure FROM schema_failures UNION ALL SELECT failure FROM helper_failures UNION ALL SELECT failure FROM helper_acl_failures UNION ALL SELECT failure FROM private_failures ORDER BY failure;
