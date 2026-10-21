-- Scoped live host input/output safety metadata only. No bodies, validator
-- quality scores, commercial settlement, model activation or dispatch authority.
CREATE FUNCTION cloudmarkup_live_host_evidence_shape(r JSONB, k TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE f TEXT; v JSONB; n NUMERIC; limit_count INTEGER;
BEGIN
  IF jsonb_typeof(r)<>'object' OR octet_length(r::text)>16384 THEN RETURN FALSE; END IF;
  IF k='input' THEN
    IF (r ?& ARRAY['authority','contractVersion','evidenceDigest','evidenceId','inputDigest','inputSanitized','noRawSensitiveContent','operation','organizationId','projectId','recordKind','requested','secretRedactionApplied','sourceOwnership','userId','verifierId','verifierVersion']
      AND r-ARRAY['authority','contractVersion','evidenceDigest','evidenceId','inputDigest','inputSanitized','noRawSensitiveContent','operation','organizationId','projectId','recordKind','requested','secretRedactionApplied','sourceOwnership','userId','verifierId','verifierVersion']='{}'::jsonb
      AND r->>'recordKind'='model-runtime-input-evidence'
      AND r->'authority'='{"credential":false,"deployment":false,"shell":false,"tool":false,"url":false}'::jsonb
      AND r->'inputSanitized'='true'::jsonb AND r->'noRawSensitiveContent'='true'::jsonb AND r->'secretRedactionApplied'='true'::jsonb
      AND jsonb_typeof(r->'requested')='object'
      AND (r->'requested') ?& ARRAY['dependencyNames','edgeCount','fileCount','moduleSources','nodeCount','outputBytes','outputTokens','promptBytes','providerSources','repairAttempts','repositoryBytes','repositoryFiles']
      AND (r->'requested')-ARRAY['dependencyNames','edgeCount','fileCount','moduleSources','nodeCount','outputBytes','outputTokens','promptBytes','providerSources','repairAttempts','repositoryBytes','repositoryFiles']='{}'::jsonb
      AND jsonb_typeof(r->'sourceOwnership')='object'
      AND (r->'sourceOwnership') ?& ARRAY['evidenceDigests','status']
      AND (r->'sourceOwnership')-ARRAY['evidenceDigests','status']='{}'::jsonb
      AND r#>>'{sourceOwnership,status}' IN ('not-applicable','verified')
      AND jsonb_typeof(r#>'{sourceOwnership,evidenceDigests}')='array') IS NOT TRUE THEN RETURN FALSE; END IF;
    IF jsonb_array_length(r#>'{sourceOwnership,evidenceDigests}')>1024
      OR ((r#>>'{sourceOwnership,status}'='verified') IS DISTINCT FROM (jsonb_array_length(r#>'{sourceOwnership,evidenceDigests}')>0))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(r#>'{sourceOwnership,evidenceDigests}') x GROUP BY x HAVING count(*)>1)
      THEN RETURN FALSE; END IF;
    FOR v IN SELECT value FROM jsonb_array_elements(r#>'{sourceOwnership,evidenceDigests}') LOOP
      IF jsonb_typeof(v)<>'string' OR (v#>>'{}') !~ '^sha256:[a-f0-9]{64}$' THEN RETURN FALSE; END IF;
    END LOOP;
    FOREACH f IN ARRAY ARRAY['edgeCount','fileCount','nodeCount','outputBytes','outputTokens','promptBytes','repairAttempts','repositoryBytes','repositoryFiles'] LOOP
      IF jsonb_typeof(r#>ARRAY['requested',f])<>'number' THEN RETURN FALSE; END IF;
      n:=(r#>>ARRAY['requested',f])::numeric;
      IF n<0 OR n>1000000000 OR n<>trunc(n) THEN RETURN FALSE; END IF;
      IF f IN ('outputBytes','promptBytes') AND (n<1 OR n>16777216) THEN RETURN FALSE; END IF;
      IF f='outputTokens' AND n<1 THEN RETURN FALSE; END IF;
      IF f='repairAttempts' AND n>2 THEN RETURN FALSE; END IF;
    END LOOP;
    FOREACH f IN ARRAY ARRAY['dependencyNames','providerSources','moduleSources'] LOOP
      limit_count:=CASE f WHEN 'dependencyNames' THEN 512 WHEN 'providerSources' THEN 64 ELSE 256 END;
      IF jsonb_typeof(r#>ARRAY['requested',f])<>'array' THEN RETURN FALSE; END IF;
      IF jsonb_array_length(r#>ARRAY['requested',f])>limit_count OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(r#>ARRAY['requested',f]) x GROUP BY x HAVING count(*)>1) THEN RETURN FALSE; END IF;
      FOR v IN SELECT value FROM jsonb_array_elements(r#>ARRAY['requested',f]) LOOP
        IF jsonb_typeof(v)<>'string' THEN RETURN FALSE; END IF;
        IF f='dependencyNames' THEN
          IF length(v#>>'{}')>214 OR (v#>>'{}') !~ '^(@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$' THEN RETURN FALSE; END IF;
        ELSE
          IF (v#>>'{}') !~ '^[a-z0-9][a-z0-9._/-]{0,255}$' OR strpos(v#>>'{}','..')>0 THEN RETURN FALSE; END IF;
        END IF;
      END LOOP;
    END LOOP;
  ELSIF k IN ('allow-listed-operations','source-ownership') THEN
    IF (r ?& ARRAY['contractVersion','evidenceDigest','evidenceId','evidenceKind','catalogDigest','inputDigest','operation','organizationId','outputBytes','outputDigest','outputTokens','passed','projectId','recordKind','responseSchemaDigest','runtimePolicyDigest','verifierId','verifierVersion']
      AND r-ARRAY['contractVersion','evidenceDigest','evidenceId','evidenceKind','catalogDigest','inputDigest','operation','organizationId','outputBytes','outputDigest','outputTokens','passed','projectId','recordKind','responseSchemaDigest','runtimePolicyDigest','verifierId','verifierVersion']='{}'::jsonb
      AND r->>'recordKind'='model-runtime-host-evidence' AND r->>'evidenceKind'=k
      AND r->'passed'='true'::jsonb) IS NOT TRUE THEN RETURN FALSE; END IF;
    FOREACH f IN ARRAY ARRAY['outputBytes','outputTokens'] LOOP
      IF jsonb_typeof(r->f)<>'number' THEN RETURN FALSE; END IF;
      n:=(r->>f)::numeric;
      IF n<0 OR n>1000000000 OR n<>trunc(n) THEN RETURN FALSE; END IF;
      IF f='outputBytes' AND (n<1 OR n>16777216) THEN RETURN FALSE; END IF;
    END LOOP;
    FOREACH f IN ARRAY ARRAY['outputDigest','catalogDigest','responseSchemaDigest','runtimePolicyDigest'] LOOP
      IF jsonb_typeof(r->f)<>'string' OR (r->>f) !~ '^sha256:[a-f0-9]{64}$' THEN RETURN FALSE; END IF;
    END LOOP;
  ELSE RETURN FALSE;
  END IF;
  RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN FALSE;
END;
$$;

CREATE TABLE model_live_runtime_host_evidence (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  plan_sha256 CHAR(64) NOT NULL CHECK(plan_sha256 ~ '^[a-f0-9]{64}$'),
  case_id VARCHAR(128) NOT NULL CHECK(case_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  case_sha256 CHAR(64) NOT NULL CHECK(case_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_id VARCHAR(128) NOT NULL CHECK(evidence_id ~ '^evidence_[a-f0-9]{64}$'),
  evidence_kind VARCHAR(32) NOT NULL CHECK(evidence_kind IN ('input','allow-listed-operations','source-ownership')),
  evidence_sha256 CHAR(64) NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
  invocation_id VARCHAR(128) NOT NULL CHECK(invocation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  invocation_sha256 CHAR(64) NOT NULL CHECK(invocation_sha256 ~ '^[a-f0-9]{64}$'),
  descriptor_sha256 CHAR(64) NOT NULL CHECK(descriptor_sha256 ~ '^[a-f0-9]{64}$'),
  route_sha256 CHAR(64) NOT NULL CHECK(route_sha256 ~ '^[a-f0-9]{64}$'),
  input_sha256 CHAR(64) NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
  invocation_scope_sha256 CHAR(64) NOT NULL CHECK(invocation_scope_sha256 ~ '^[a-f0-9]{64}$'),
  input_evidence_id VARCHAR(128),
  journal_invocation_id VARCHAR(128),
  evidence_record JSONB NOT NULL CHECK(cloudmarkup_live_host_evidence_shape(evidence_record,evidence_kind) IS TRUE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,project_id,principal_id,evidence_id),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY(organization_id,principal_id) REFERENCES memberships(organization_id,principal_id),
  FOREIGN KEY(organization_id,project_id,principal_id,plan_sha256) REFERENCES model_live_evaluation_plans(organization_id,project_id,principal_id,plan_sha256),
  FOREIGN KEY(organization_id,project_id,principal_id,input_evidence_id) REFERENCES model_live_runtime_host_evidence(organization_id,project_id,principal_id,evidence_id),
  FOREIGN KEY(organization_id,project_id,principal_id,journal_invocation_id) REFERENCES model_live_invocations(organization_id,project_id,principal_id,invocation_id),
  CHECK((evidence_kind='input')=(input_evidence_id IS NULL)),
  CHECK((evidence_kind='input')=(journal_invocation_id IS NULL)),
  CHECK(journal_invocation_id IS NULL OR journal_invocation_id=invocation_id),
  CHECK((evidence_record->>'evidenceId'=evidence_id
    AND evidence_record->>'organizationId'=organization_id AND evidence_record->>'projectId'=project_id
    AND evidence_record->>'evidenceDigest'='sha256:'||evidence_sha256
    AND evidence_record->>'inputDigest'='sha256:'||input_sha256
    AND evidence_record->'contractVersion'='1'::jsonb
    AND evidence_record->>'verifierId'='cloudmarkup.live-host-evidence.v2'
    AND evidence_record->>'verifierVersion'='2.0.0'
    AND (evidence_kind<>'input' OR evidence_record->>'userId'=principal_id)) IS TRUE)
);

CREATE FUNCTION validate_model_live_runtime_host_evidence_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE p model_live_evaluation_plans%ROWTYPE; b JSONB; t JSONB; i model_live_runtime_host_evidence%ROWTYPE;
  j model_live_invocations%ROWTYPE; a JSONB;
BEGIN
  NEW.created_at:=clock_timestamp();
  PERFORM 1 FROM memberships m
    JOIN principals pr ON pr.principal_id=m.principal_id AND pr.lifecycle_status='active'
    JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
    JOIN projects pj ON pj.organization_id=m.organization_id AND pj.project_id=NEW.project_id AND pj.lifecycle_status='active'
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=NEW.principal_id AND m.lifecycle_status='active'
      AND NOT EXISTS(SELECT 1 FROM project_content_write_scopes f WHERE f.organization_id=pj.organization_id AND f.project_id=pj.project_id AND f.closed_at IS NOT NULL)
    FOR SHARE OF m,pr,o,r,pj;
  IF NOT FOUND THEN RAISE EXCEPTION 'live host evidence requires an active authorized scope' USING ERRCODE='23514'; END IF;
  SELECT * INTO p FROM model_live_evaluation_plans WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
    AND principal_id=NEW.principal_id AND plan_sha256=NEW.plan_sha256 FOR SHARE;
  IF NOT FOUND OR p.issued_at>clock_timestamp() OR p.expires_at<=clock_timestamp() OR EXISTS(
    SELECT 1 FROM model_live_evaluation_revocations v WHERE v.organization_id=NEW.organization_id AND v.project_id=NEW.project_id
      AND v.principal_id=NEW.principal_id AND v.plan_sha256=NEW.plan_sha256)
    THEN RAISE EXCEPTION 'live host evidence requires current issued approval' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM memberships m JOIN principals pr ON pr.principal_id=m.principal_id AND pr.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key) AND r.role_key='owner'
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=p.operator_principal_id AND m.lifecycle_status='active'
    FOR SHARE OF m,pr,r;
  IF NOT FOUND THEN RAISE EXCEPTION 'live host evidence requires current approving ownership' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p.plan_record#>'{definition,cases}') c WHERE c->>'caseId'=NEW.case_id)<>1
    THEN RAISE EXCEPTION 'live host evidence requires one exact case' USING ERRCODE='23514'; END IF;
  SELECT c INTO b FROM jsonb_array_elements(p.plan_record#>'{definition,cases}') c WHERE c->>'caseId'=NEW.case_id;
  t:=b#>'{authorityBinding,authorityTuple}';
  IF (b->>'caseDigest'='sha256:'||NEW.case_sha256 AND b->>'invocationInputDigest'='sha256:'||NEW.input_sha256
    AND b->>'routeId' IN ('standard-design','deep-design') AND t->'operation'=NEW.evidence_record->'operation') IS NOT TRUE
    THEN RAISE EXCEPTION 'live host evidence must bind the exact primary case input' USING ERRCODE='23514'; END IF;
  IF NEW.evidence_kind<>'input' THEN
    SELECT * INTO i FROM model_live_runtime_host_evidence WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND principal_id=NEW.principal_id AND evidence_id=NEW.input_evidence_id AND evidence_kind='input';
    IF (i.plan_sha256=NEW.plan_sha256 AND i.case_id=NEW.case_id AND i.case_sha256=NEW.case_sha256
      AND i.invocation_id=NEW.invocation_id AND i.invocation_sha256=NEW.invocation_sha256
      AND i.descriptor_sha256=NEW.descriptor_sha256 AND i.route_sha256=NEW.route_sha256
      AND i.invocation_scope_sha256=NEW.invocation_scope_sha256 AND i.input_sha256=NEW.input_sha256
      AND NEW.evidence_record->'catalogDigest'=t->'catalogDigest'
      AND NEW.evidence_record->'responseSchemaDigest'=t->'responseSchemaDigest'
      AND NEW.evidence_record->'runtimePolicyDigest'=p.plan_record#>'{definition,policy,policyDigest}') IS NOT TRUE
      THEN RAISE EXCEPTION 'live output evidence requires exact issued input metadata' USING ERRCODE='23514'; END IF;
    SELECT * INTO j FROM model_live_invocations WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND principal_id=NEW.principal_id AND invocation_id=NEW.journal_invocation_id;
    SELECT r.snapshot->'request' INTO a FROM model_runtime_admissions r WHERE r.organization_id=NEW.organization_id AND r.project_id=NEW.project_id
      AND r.principal_id=NEW.principal_id AND r.snapshot#>'{request,requestDigest}'=j.binding->'runtimeRequestDigest';
    IF (j.gateway_state='complete' AND j.binding->>'liveEvaluationPlanDigest'='sha256:'||NEW.plan_sha256
      AND j.binding->>'evaluationCaseId'=NEW.case_id AND j.binding->>'evaluationCaseDigest'='sha256:'||NEW.case_sha256
      AND j.binding->>'inputDigest'='sha256:'||NEW.input_sha256
      AND j.output_sha256=substring(NEW.evidence_record->>'outputDigest' FROM 8)
      AND j.output_bytes=(NEW.evidence_record->>'outputBytes')::numeric
      AND (j.normalized_usage->>'outputUnits')::numeric=(NEW.evidence_record->>'outputTokens')::numeric
      AND j.normalized_usage->>'result'='succeeded' AND j.generation_evidence->>'status'='completed'
      AND a->>'inputEvidenceDigest'='sha256:'||i.evidence_sha256
      AND a->'requested'=i.evidence_record->'requested'
      AND a->>'liveEvaluationPlanDigest'='sha256:'||NEW.plan_sha256
      AND a->>'evaluationCaseId'=NEW.case_id AND a->>'inputDigest'='sha256:'||NEW.input_sha256) IS NOT TRUE
      THEN RAISE EXCEPTION 'live output evidence requires the exact completed admitted invocation' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_live_runtime_host_evidence_validate_insert
  BEFORE INSERT ON model_live_runtime_host_evidence FOR EACH ROW
  EXECUTE FUNCTION validate_model_live_runtime_host_evidence_insert();

CREATE TRIGGER model_live_runtime_host_evidence_reject_mutation
  BEFORE UPDATE OR DELETE ON model_live_runtime_host_evidence FOR EACH ROW
  EXECUTE FUNCTION reject_immutable_row_change();

COMMENT ON TABLE model_live_runtime_host_evidence IS
  'Append-only current-tenant/current-plan input and completed-journal output safety metadata. No prompt, response, design-quality validator, financial settlement, operational outcome, model promotion or dispatch authority.';
