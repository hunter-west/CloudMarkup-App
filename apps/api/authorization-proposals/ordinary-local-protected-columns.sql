-- REVIEW ONLY, UNARMED. Not a registered migration or production activation.
-- Requires separate exact local resource/permission approval. Protected loader
-- owns one transaction, executes the complete parsed file, admits catalogs,
-- and commits only with the approved synthetic marker and exact source pins.
-- Separate local proof proposal: all fourteen permissions remain disabled here.
DO $target$
BEGIN
  IF session_user<>'cloudmarkup_admin' OR current_user<>'cloudmarkup_admin'
    OR current_database()<>'cloudmarkup'
    OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
    OR current_setting('createrole_self_grant')<>''
    OR current_setting('session_replication_role')<>'origin'
    OR (SELECT pg_catalog.obj_description(oid,'pg_database') FROM pg_catalog.pg_database WHERE datname=current_database()) IS DISTINCT FROM 'CloudMarkup task-6 PG16 approval bundle synthetic-only 20261010'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND rolcanlogin AND rolcreaterole AND NOT rolsuper)
  THEN RAISE EXCEPTION 'Exact task-owned synthetic PG16 setup actor required' USING ERRCODE='42501'; END IF;
  IF EXISTS(WITH expected(version,checksum) AS (VALUES ('0001','0a9bba95150ddccd28369c86f6c0f8968bb9deda4fd01a0f0206f83d6daf0556'),
('0002','5e96c0ddd1658b861b39e6b0fd7dfe1c426a812eed081abb330b3590961071b2'),
('0003','aa1afe447e5ecf5957f1aba1d5663e55ca33b937923258ff8321e5759771c94a'),
('0004','67addb3c028de70aeef5d8301d1299a729b1e9c480185e169ec41638e3af4bef'),
('0005','fe29e420e0d992bb971b918a16d20efb2a995ce72c746c1d2ba00007b2368cd3'),
('0006','5bcc05af739a63905e93116cc3c4216f810af3d6aad691b0fd5c8bd7fe81dd54'),
('0007','2bc14e1f57d31ce774fbdbbec791f1d001e4809f32bd55422740c6f1a346e4b9'),
('0008','bc85458cf94571e8c766889e0b44d2ef13e21cfe3a6269fba0ac6795cb6e849c'),
('0009','e9341e1e5a33676f96ce729547ccbf75af8ac8a7742fde492f869643a95df55f'),
('0010','05face90ac08f89ba6d08799d0fea1ca921577ea9afce22038309c606a7a6071'),
('0011','f30208999e6efbbcd3d1162d01dcaeeca0e2729b1c75bc61bd870020d21b7607'),
('0012','dea6914a2245b90b5fba70aeeb7e968c5161e5bb1a2ca9b4370b8fb0f8e38893'),
('0013','878afef9795f30e7a8b80749b27f7307f091c6e3523ae32ffca78b2af3412ef3'),
('0014','0ae026617c28409031e1eaa900835acb6ab0bca08b7ca38be80cbe7618942791'),
('0015','e159e5437d35c1110920388c84bfd3dbaefd96a1cd768e87b78d061c404f0a5e'),
('0016','5c4b936150a89a5eec4b31dade7f38d4abb23f1c591145bcff1323a37143800e'),
('0017','ff959f0824c530b693559be596f2599c8d8658b6dbd4d4177be8afa0d6b86b6b'),
('0018','95800c1b6a08c23b8c162a7b88d9a76a905ff0e6a6ec562c68696649fcfde364'),
('0019','e26c8ec1c5b1ec9043956eb44c02fc6a8613001678e977d12fd194cc26fa698a'),
('0020','485e3e7cbc21433e482d68ec5f386621def3b1ebc26e8791bbdfb28f6f14df0c'),
('0021','8904e94dd461eea94a8c9e39dcd40ff66c7368e8d05cfef8fd4448d183d1e63f'),
('0022','327cf097c260d78cf872387d50cc63dcfd42e9a75a42c1c327079f0c94d2fab6'),
('0023','8e9d37c44b14828d3b65640d78af9075f23855d5da4f06d5cc4db1b45e8bf06b'),
('0024','f679f21b5e03fda2b26cedd44731f2880655b7a5e36b9618de7ce6e9ba22e466'),
('0025','d91c7cd4b7e04c388c8ab4af641abb4bc7e0d78227ff3744d7a8408722a52f8f'),
('0026','e85696f4671b59ac637bfc8cd40881c0f60909cdfbf5cbe5d67314e982a56b56'),
('0027','7609a587fdd1b5392eadf8aa3aa6170a2becc5a7e327b070fdbfe5a0ec8804a9'),
('0028','c9db4813af35f21aa4d0f22cd5b1b4075ae9fcbe104cea682214437cd1266890'),
('0029','5a645ed4cbdc1cf9799f959a7391f74cac55629ebf4bd96522c755cf4c0d5efc'),
('0030','4162c2fff434e7ce3344de42fe17eeb99cc910a1c270429e863c45f20201c444'),
('0031','ea47087d559a9957209b255819f8a4a273a4a1aa8354ce9eb3c554123bb607db'),
('0032','d27a0dc26451dc0e94059f3a19be451a0ff224a9d9d9f6279a4a1772d64e884e'),
('0033','6b37441d222e2c80d9883d260bef05a82ce49a104dbff0e0dc77612086ccef3c'),
('0034','639363fca3eae0b1b16b511584ab3b8eef309d6524a113090cec0be3269e76c8'),
('0035','411d444929340800c0e6c3ac949e4d5ed19627ee4420c36af4d97b59847102eb'),
('0036','f2b07a6039755d63f875a63f71836bd4bb4f9a019fb6f7650dea81def83056b0'),
('0037','e7c152430e8554568ebd5a2e9f3885d5ba40be5b29f590b8a6443f44a18a45ed'),
('0038','645c31be59d93b0d9f849cde24cf498b6320b5ba5b4365ba0111aa46cfdae63a'),
('0039','1e541cbe83d4961636be3330f497ab75be2983f1572ec4ccc80a9388875525ba'),
('0040','69d09aa4098aa4d18f6f2ef90c764c93cdfcb3812bc837c1f8ead6ba00d39d27'),
('0041','b443742e9948fc4aa75ee157ee3d06a6a8d076e592511b781f1b91556e9b4895'),
('0042','c002d77ed254f4f8ca08534bcf2ece8f21fcee51c68b13108ce4d1ebe89e1bf1'),
('0043','d98fdcfa90cd664c9977ea2bf5446da7ad2ac448177f0be3806d3a78c9551b2e'),
('0044','afa6518c2ecdf9b5c7a1eb7c8682e5a6e7b6b9709cdd4b7762aeadd41a37efbf'),
('0045','861026d36e00c73a474a5d45a2dbbf1da7591c9401e61bce5fd00a68182a1b59'),
('0046','5e19f45a4f30f098e5f0f798aab83726edc3d677d4120611c74eda70a43a5c6a'),
('0047','0a48204bc093ee591890e663667dd109dffe1c7a248e0f54724d808eae618545'),
('0048','6c2bff1b3acb0834c1501acd15f85042ad87896e59e5a439bdfa72396fca3e8e'),
('0049','9d89e90c335d4796cdb8ede848bcb38bad302baf2d9e3679b64de13dc09c0c92'),
('0050','a87158fb3de47a71d3b1e811c6ca9fac36182a785065edd9f8ceca71528ac967'),
('0051','a578cb90fecf02f47b95e57c286119283dfe6cc5e2aae532ddd7989ace17e072'),
('0052','6b42af88883716cec63b704d54d0a96794206774910888b734d1a2c7cf001dbd'),
('0053','4ffa2c757313357f39434dac0cfc001d1b21cd33af43a9af598e7ecb05686757'),
('0054','cbe23fc755553e65541dcc16f0f0649edb6ccdc89069d59a3014861b0b3c371b'),
('0055','aaa6e796d8139ab3d3789de119d46f429232585f4b4c20778674c2379a797237'),
('0056','6b753f02718875609a1c39b526569bb385901372ffbc6ae26c402a5ce98371a2'),
('0057','67b5381a6e46f30d3b71635d7fddd6d047a73c66e808106a21e685697a656184'),
('0058','2e9cb6502b4dbd889a671b9df27776d9b9359fa0087ab74c75f4869a06929aa6'),
('0059','0b0b53a8829bc91b3e6748f5aee15e7138a378487b8408ce1da59a9fd056fa31'),
('0078','cad86254f3652dc3d8c6263f574dd21bd7513a7562dfaf516b3d7e00b4768770'),
('0079','05232426bc438ff426935f68e0792fd70304b381179fe283f7bde6cb18f10263'),
('0080','0703ffd7acb54d85ed0502df421baeeb3445a13685f2425b05769c068660ec7e'),
('0081','ec7ae42bb7c195e4fc34d3dde1fe90f413aa6a25d12f6411f0b8c22a16feefec'),
('0082','0db9172cb79285bed9aa6c2ca4d8571395ea901fdbfc53890b335a4c03486df5'),
('0083','98668f75767eb7ecc97c5e3559566f1b503480a7a17f28be35003c86c30ee673'),
('0084','030edbb703a3d7b11f806b16eb4d2fb4706ca426d6656e65fb323a17f9b57c59'),
('0085','fec56172c0f62696c5d64443768f1c2c7d589c10719f9e7f0a417b0dff4f9b8e'),
('0086','d19a8c57c0dcdf7b8795016935a81108acce80e621867dce5556662f0405ae3a'),
('0087','f3f1f0a08b3c81f86e7b522c46d2a4335f18a88e8c7b18b207071d9c6d344e3d'),
('0088','b70831ef15b3d8b557dd4409f4441d74ca66924cb3fa2bc38545696395309da5'),
('0089','56ba4ccb9247786bae5162573f3662ce7328ffd365a7141c00a0a0d2fd31e8ec'),
('0090','e5e20d9850eb2019cea569b890a017feadf5876b9a126916d1bd48fc35d2a4da'),
('0091','f6bb365b9508fa6924a7ef5921ce8530279b1b4b7b834dddcb72b41d72dae052'),
('0092','85b81d68705ed9058e167ebd34030a0449eae39461b48365fdcf8df7c05bf40e'),
('0093','c2b66f185c988b1381510033abf231b252c8ebb15ab3ca274d09c576d1527a5b'),
('0094','eb69f14ffb1051f5c513a7b7824c1acb1b498d67e6f836667eb796c4c9c49a6c'),
('0095','1726be28655d7d0d4fba5723760a74b32c73da53ab8b6a8c4b62cbb271a01041'),
('0096','bdde0198c79619b421803eb9bc1dec339c58cae636f677ed7401c4d8f97cfcba'),
('0097','ddcb8de5857c9ada8d70da10f30d3b820163ad30e0b5578b3b89b1881e7cf820'),
('0098','1ceb0fc0f89f084dc537857718bbb2553b444ce7bbd9bdd669c2b250c583596f'),
('0099','c1dbf93f7203742d6b2ab4e66d4aee75f7fbd3a8104649df1655c353f5ab3813'),
('0100','6ee060d0612db919c0e3b239536dc653d4ee2abd19dcb07ce6445b40f83c9887'),
('0101','7e6cc4dad77b980ad4da45f27668ac67b5feb64aeec53b5c14aac24aafe23fc3'),
('0102','5a2911d166649ae66f5f1bb6fce2641d239f52252de0fd1d3cc05d29030a9369'),
('0103','70c6aeb1c7d3c68fd3bb9aa38188175c058ab9d88bfe3fa71e84fa9ca2902df6'),
('0104','fc5fdd92d45d3916a4384dc4b603ab7776fa610521f80eac1dfadb7cde348102'),
('0105','d1799be22c112e46e5367ddaa52dfe5c89164ba36b6edb2b06469c2b88f5edd4'),
('0106','a0bf9632244ed96aebc3da18a94b5493760960f16f45455f32724964c6c4fd3c'),
('0107','a53e18d111ea895a4afdf9e6a148c7113c71a65c95bb46eeb5126fd3af7d34ca'),
('0108','76d9ca4757267713350bf5eeab330a717bde09771733287bc080214be2ebfb72'),
('0109','b84a134c976c88c259c0a7497d68ef42d7af7a3b19f97ed545ca264485196ba6'),
('0110','de3e36f8e6275a88d26d8ebc500c997bce105974aa12fdf86b70292d54279b9b'),
('0111','b3c3f65e86b92cde23f39876bd8374a21d9cc68470a32cfcdabb0291eb13af5e'),
('0112','a45ab3de5cf8f38bd976d328f0c35995bd1557234b622b411bd99d046d285411'),
('0113','143659bd3c33b762efda6dd9ff6fc17339e6d659db9b5d5f4c07d128e686ca92'),
('0114','7c9437612afc6fc58aeccc23d080bac7270a8b89c3edd9c743c3dbe781b5af10'),
('0115','2b1cf22d575c2bd9e01866ad852ac02e334ecbeb067adf7060c9bdb32dc4eec0'),
('0116','b1bbf3edf4c094d2ae2ce1541b17090d0188f50463071725a34d70ff5dc93b23'),
('0117','364854e80a99c257202ad7189f0775a4105816df6533a2af8edd38fd9b115d48'),
('0118','71f424318c158fb8ec80b636522f33febc371c031b37a1098bace7f720e5a4a2'),
('0119','d63cb55f66bddfabeed013305dbb148f348aebf0467a1ee33270e463ba30eb87'),
('0120','1ca2c747fc65a00d1fd2afa1c172fe58817c3957f14f6e52ef6cbb765f4658db'),
('0121','70a24424db2be6cd9279bb49b80d7dca7f163e48c9f1b4ecabfd3717f92d8063'),
('0122','0dc3d848f39b4a279c2768d4b5b8172568c237455450b06e5e6adefd2c5c0ba7'),
('0123','b65ce1ae0c18d42d7fd3e18dc3c1cb4c0b00f969f70e315c40bdbbe2b6fd730e'),
('0124','c6358eb00ce9dd608dc95204bef98eae966fee794bf5989466bb8ca0ec886393'),
('0125','3b005105f4180a572236a77b3e78f486275bc2559cc02e0302c1c4290090a795'),
('0126','31819079070a36314fc247ee7f59ce33828cadb881dc2290eefd583e28117ad0'),
('0127','ff31d8cdc99019d50d1fa1bae38c6b5ada464b48a46183db24b623cc7277d8df'),
('0128','ed74c53e0f3fceefea7b378465c878b3e75445bf2c9a94c72c5bce91ba33a743'),
('0129','099367054e868b05e807eade93fce66db18d10001a0d122eef326a8edc2eecb3'),
('0130','3642348975b1b8e0dd0f053f8c059c9ba1d0f438cd547cb00306c53b8827623c'),
('0131','88489064e6593b229b4a01731b2b573a21e5d5b3e7300e3f66862d4e337fca7d'),
('0132','41587323368d905a20ba7cdf57dc8b41515f901931ef48edc3763a1d607d339b'),
('0133','f1cbda47ce59f12a39f954e0685d92444ceb2428796d4857cface31ce2da3b3f'),
('0134','359e5c76b406b825a40f2fd19f24d65e32eea246493f4a7b46772245bb42e667'),
('0135','4f5c9839f2dba4e5d8914dd6f001670d9733cbc62f67d762cc8c2b44b19ebb15'),
('0136','b058d620143fb9924fb07f2f43317b25c9112a8d695549121140adbde338d778'))
    SELECT 1 FROM expected FULL JOIN public.cloudmarkup_schema_migrations actual USING(version)
    WHERE actual.checksum_sha256 IS DISTINCT FROM expected.checksum)
  THEN RAISE EXCEPTION 'Exact 118 migration ledger required' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime','cloudmarkup_beta_billing_runtime'))<>5
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime','cloudmarkup_beta_billing_runtime') AND
      (NOT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
       OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid)
       OR pg_catalog.has_database_privilege(r.oid,current_database(),'CREATE, TEMP')
       OR pg_catalog.has_schema_privilege(r.oid,'public','CREATE')
       OR pg_catalog.has_parameter_privilege(r.oid,'session_replication_role','SET, ALTER SYSTEM')))
  THEN RAISE EXCEPTION 'Ordinary nonowner login baseline required' USING ERRCODE='42501'; END IF;
END;
$target$;

DO $invariants$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='architecture_revisions' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='architecture_revisions_are_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_api_runtime','public.architecture_revisions','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: api:architecture_revisions.revision_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='credit_grants' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='credit_grants_are_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_api_runtime','public.credit_grants','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: api:credit_grants.credit_grant_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='commercial_plan_versions' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='commercial_plan_versions_are_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_api_runtime','public.commercial_plan_versions','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: api:commercial_plan_versions.plan_version_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='commercial_plan_seat_rules' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='commercial_plan_seat_rules_are_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_api_runtime','public.commercial_plan_seat_rules','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: api:commercial_plan_seat_rules.plan_version_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='commercial_plan_numeric_limits' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='commercial_plan_limits_are_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_api_runtime','public.commercial_plan_numeric_limits','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: api:commercial_plan_numeric_limits.plan_version_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='solution_records' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='solution_records_are_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_api_runtime','public.solution_records','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: api:solution_records.solution_record_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='solution_records' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='solution_records_are_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_export_runtime','public.solution_records','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: export:solution_records.solution_record_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='async_job_record_snapshots' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='async_job_record_snapshots_are_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_api_runtime','public.async_job_record_snapshots','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: api:async_job_record_snapshots.job_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='async_job_record_snapshots' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='async_job_record_snapshots_are_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_export_runtime','public.async_job_record_snapshots','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: export:async_job_record_snapshots.job_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='solution_export_artifacts' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='solution_export_artifacts_are_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_api_runtime','public.solution_export_artifacts','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: api:solution_export_artifacts.solution_export_artifact_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='solution_export_artifacts' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='solution_export_artifacts_are_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_export_runtime','public.solution_export_artifacts','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: export:solution_export_artifacts.solution_export_artifact_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='async_job_creation_claims' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='async_job_creation_claims_validate_record' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='validate_async_job_creation_claim' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='4d0c950fc9fa0d3fcfa2c4dcc7f8deb7b31c818fd2a5596a26454d221968c46e')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_export_runtime','public.async_job_creation_claims','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: export:async_job_creation_claims.job_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='solution_export_download_grants' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='solution_export_download_grants_guard_update' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='guard_solution_export_download_grant_update' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='e4b84718935d651f4771d5e41a44495deae75178db6e1b728eef3ae6ad3a6e18')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_api_runtime','public.solution_export_download_grants','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: api:solution_export_download_grants.organization_id' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid=t.relowner
    JOIN pg_catalog.pg_trigger tr ON tr.tgrelid=t.oid
    JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
    JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.relname='ai_intent_preview_authorities' AND owner.rolname='cloudmarkup_admin'
      AND NOT t.relrowsecurity AND NOT t.relforcerowsecurity
      AND tr.tgname='ai_intent_preview_authorities_immutable' AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A') AND (tr.tgtype::integer & 19)=19
      AND tr.tgattr::text='' AND tr.tgqual IS NULL AND pn.nspname='public'
      AND p.proname='reject_immutable_row_change' AND p.proowner=owner.oid
      AND encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='747ce0d6ff98926fdea4f872765d24ebb7e2f65566c7c4171503b3b417166bf8')
    OR pg_catalog.has_table_privilege('cloudmarkup_beta_api_runtime','public.ai_intent_preview_authorities','UPDATE,DELETE,TRUNCATE,TRIGGER')
  THEN RAISE EXCEPTION 'Exact protected invariant admission failed: api:ai_intent_preview_authorities.invocation_id' USING ERRCODE='42501'; END IF;
END;
$invariants$;
GRANT UPDATE (revision_id) ON TABLE public.architecture_revisions TO cloudmarkup_beta_api_runtime;
GRANT UPDATE (credit_grant_id) ON TABLE public.credit_grants TO cloudmarkup_beta_api_runtime;
GRANT UPDATE (plan_version_id) ON TABLE public.commercial_plan_versions TO cloudmarkup_beta_api_runtime;
GRANT UPDATE (plan_version_id) ON TABLE public.commercial_plan_seat_rules TO cloudmarkup_beta_api_runtime;
GRANT UPDATE (plan_version_id) ON TABLE public.commercial_plan_numeric_limits TO cloudmarkup_beta_api_runtime;
GRANT UPDATE (solution_record_id) ON TABLE public.solution_records TO cloudmarkup_beta_api_runtime;
GRANT UPDATE (solution_record_id) ON TABLE public.solution_records TO cloudmarkup_beta_export_runtime;
GRANT UPDATE (job_id) ON TABLE public.async_job_record_snapshots TO cloudmarkup_beta_api_runtime;
GRANT UPDATE (job_id) ON TABLE public.async_job_record_snapshots TO cloudmarkup_beta_export_runtime;
GRANT UPDATE (solution_export_artifact_id) ON TABLE public.solution_export_artifacts TO cloudmarkup_beta_api_runtime;
GRANT UPDATE (solution_export_artifact_id) ON TABLE public.solution_export_artifacts TO cloudmarkup_beta_export_runtime;
GRANT UPDATE (job_id) ON TABLE public.async_job_creation_claims TO cloudmarkup_beta_export_runtime;
GRANT UPDATE (organization_id) ON TABLE public.solution_export_download_grants TO cloudmarkup_beta_api_runtime;
GRANT UPDATE (invocation_id) ON TABLE public.ai_intent_preview_authorities TO cloudmarkup_beta_api_runtime;
