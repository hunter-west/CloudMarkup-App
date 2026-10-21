-- Registered0058 candidate: bounded evaluation sequence metadata and reciprocal reservations.
-- Requires the exact registered0057 predecessor; source proposal bodies are preserved below.
-- Metadata alone grants no dispatch, validation, report, promotion or financial authority.
CREATE TABLE model_live_sequence_plans (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  operator_principal_id VARCHAR(128) NOT NULL,
  definition_id VARCHAR(128) NOT NULL CHECK (definition_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  definition_sha256 CHAR(64) NOT NULL CHECK (definition_sha256 ~ '^[a-f0-9]{64}$'),
  approval_sha256 CHAR(64) NOT NULL CHECK (approval_sha256 ~ '^[a-f0-9]{64}$'),
  plan_sha256 CHAR(64) NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  plan_id VARCHAR(128) NOT NULL CHECK (plan_id ~ '^live_plan_[a-f0-9]{32}$'),
  plan_record JSONB NOT NULL CHECK (jsonb_typeof(plan_record)='object' AND octet_length(plan_record::text)<=49152),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at>issued_at AND expires_at<=issued_at+INTERVAL '24 hours'),
  PRIMARY KEY (organization_id,project_id,principal_id,definition_id),
  UNIQUE (organization_id,project_id,principal_id,plan_sha256),
  UNIQUE (organization_id,plan_id),
  FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY (organization_id,principal_id) REFERENCES memberships(organization_id,principal_id),
  FOREIGN KEY (organization_id,operator_principal_id) REFERENCES memberships(organization_id,principal_id),
  CHECK ((plan_record ?& ARRAY['contractVersion','recordKind','planId','planDigest','definition','approval','issuedAt','expiresAt']
    AND plan_record - ARRAY['contractVersion','recordKind','planId','planDigest','definition','approval','issuedAt','expiresAt']='{}'::jsonb
    AND plan_record->'contractVersion'='3'::jsonb
    AND plan_record->>'recordKind'='model-live-sequence-plan'
    AND plan_record->>'planId'=plan_id
    AND plan_record->>'planDigest'='sha256:'||plan_sha256
    AND (plan_record->>'issuedAt')::timestamptz=issued_at
    AND (plan_record->>'expiresAt')::timestamptz=expires_at
    AND plan_record#>>'{definition,definitionId}'=definition_id
    AND plan_record#>>'{definition,definitionDigest}'='sha256:'||definition_sha256
    AND plan_record#>'{definition,contractVersion}'='3'::jsonb
    AND plan_record#>>'{definition,recordKind}'='model-live-sequence-definition'
    AND plan_record#>'{definition,normalCi}'='false'::jsonb
    AND plan_record#>>'{definition,scope,organizationId}'=organization_id
    AND plan_record#>>'{definition,scope,projectId}'=project_id
    AND plan_record#>>'{definition,scope,userId}'=principal_id
    AND plan_record#>>'{definition,scope,environment}' IN ('development','staging')
    AND plan_record#>'{definition,policy,contractVersion}'='2'::jsonb
    AND plan_record#>>'{definition,policy,recordKind}'='model-live-runtime-control-policy'
    AND plan_record#>>'{approval,approvalDigest}'='sha256:'||approval_sha256
    AND plan_record#>>'{approval,definitionDigest}'='sha256:'||definition_sha256
    AND plan_record#>>'{approval,operatorUserId}'=operator_principal_id
    AND plan_record#>'{approval,scope}'=plan_record#>'{definition,scope}'
    AND plan_record#>'{approval,contractVersion}'='3'::jsonb
    AND plan_record#>>'{approval,recordKind}'='model-live-sequence-approval'
    AND (plan_record#>>'{approval,approvedAt}')::timestamptz<=issued_at
    AND (plan_record#>>'{approval,expiresAt}')::timestamptz>=expires_at
    AND (plan_record#>>'{definition,expiresAt}')::timestamptz>=expires_at) IS TRUE)
);
CREATE TABLE model_live_sequence_revocations (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  plan_sha256 CHAR(64) NOT NULL,
  operator_principal_id VARCHAR(128) NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,project_id,principal_id,plan_sha256),
  FOREIGN KEY (organization_id,project_id,principal_id,plan_sha256)
    REFERENCES model_live_sequence_plans(organization_id,project_id,principal_id,plan_sha256),
  FOREIGN KEY (organization_id,operator_principal_id) REFERENCES memberships(organization_id,principal_id)
);
CREATE FUNCTION enforce_model_live_sequence_authority_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  PERFORM 1 FROM memberships m
    JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
    JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
    JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=NEW.project_id AND pr.lifecycle_status='active'
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=NEW.principal_id AND m.lifecycle_status='active'
      AND NOT EXISTS(SELECT 1 FROM project_content_write_scopes f
        WHERE f.organization_id=pr.organization_id AND f.project_id=pr.project_id AND f.closed_at IS NOT NULL)
    FOR SHARE OF m,p,o,r,pr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'live evaluation requires an active authorized scope' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM memberships m
    JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.role_key='owner'
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=NEW.operator_principal_id AND m.lifecycle_status='active'
    FOR SHARE OF m,p,r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'live evaluation approval requires a current owner' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='model_live_sequence_plans' THEN
    IF NEW.issued_at > clock_timestamp() OR NEW.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'live evaluation approval must be current at issuance' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER model_live_sequence_plans_require_authority
  BEFORE INSERT ON model_live_sequence_plans
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_sequence_authority_insert();
CREATE TRIGGER model_live_sequence_revocations_require_authority
  BEFORE INSERT ON model_live_sequence_revocations
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_sequence_authority_insert();
CREATE TRIGGER model_live_sequence_plans_are_immutable
  BEFORE UPDATE OR DELETE ON model_live_sequence_plans
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
CREATE TRIGGER model_live_sequence_revocations_are_immutable
  BEFORE UPDATE OR DELETE ON model_live_sequence_revocations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
COMMENT ON TABLE model_live_sequence_plans IS
  'Immutable, scoped V3 bounded-sequence evaluation-only approval metadata. Application issuance additionally requires verified Cognito, a configured platform operator and exact current frozen definition. Not report, runtime, credit or dispatch authority.';
COMMENT ON TABLE model_live_sequence_revocations IS
  'Append-only revocation of one exact V3 bounded-sequence evaluation approval. Cannot restore or change a plan.';
-- Closed metadata structure for this proposal only. These checks reject raw
-- nested content; the future issuer must still parse V3 and authenticate every
-- configured policy, canonical digest and receipt. This is not JSON Schema execution.
CREATE FUNCTION model_live_sequence_metadata_object_v3(value JSONB, required_keys TEXT[], optional_keys TEXT[] DEFAULT ARRAY[]::text[])
RETURNS VOID AS $$
BEGIN
  IF (jsonb_typeof(value)='object' AND value ?& required_keys
      AND value-(required_keys||optional_keys)='{}'::jsonb) IS NOT TRUE
  THEN RAISE EXCEPTION 'closed V3 metadata object required' USING ERRCODE='23514'; END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
CREATE FUNCTION model_live_sequence_metadata_atom_v3(value JSONB, kind TEXT)
RETURNS VOID AS $$
BEGIN
  IF (CASE kind
    WHEN 'identifier' THEN jsonb_typeof(value)='string' AND length(value#>>'{}') BETWEEN 1 AND 1024
      AND value#>>'{}' ~ '^[A-Za-z0-9@][A-Za-z0-9._:/@+-]*$'
    WHEN 'digest' THEN jsonb_typeof(value)='string' AND value#>>'{}' ~ '^sha256:[a-f0-9]{64}$'
    WHEN 'integer' THEN jsonb_typeof(value)='number' AND value::text ~ '^[0-9]{1,16}$'
    WHEN 'boolean' THEN jsonb_typeof(value)='boolean'
    ELSE FALSE END) IS NOT TRUE
  THEN RAISE EXCEPTION 'bounded scalar V3 metadata required' USING ERRCODE='23514'; END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
CREATE FUNCTION model_live_sequence_metadata_array_v3(value JSONB, kind TEXT, minimum_count INTEGER, maximum_count INTEGER)
RETURNS VOID AS $$
DECLARE entry JSONB;
BEGIN
  IF (jsonb_typeof(value)='array' AND jsonb_array_length(value) BETWEEN minimum_count AND maximum_count) IS NOT TRUE
  THEN RAISE EXCEPTION 'bounded V3 metadata array required' USING ERRCODE='23514'; END IF;
  FOR entry IN SELECT x.value FROM jsonb_array_elements(value) x LOOP
    PERFORM model_live_sequence_metadata_atom_v3(entry,kind);
  END LOOP;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
CREATE FUNCTION enforce_model_live_sequence_metadata_insert() RETURNS TRIGGER AS $$
DECLARE d JSONB; p JSONB; a JSONB; c JSONB; v JSONB; e RECORD; key TEXT;
BEGIN
  d:=NEW.plan_record->'definition'; p:=d->'policy'; a:=NEW.plan_record->'approval';
  PERFORM model_live_sequence_metadata_object_v3(a, ARRAY['contractVersion','recordKind','approvalId','approvalDigest','definitionDigest','scope','operatorUserId','approvedAt','expiresAt']);
  FOREACH key IN ARRAY ARRAY['approvalId','operatorUserId','approvedAt','expiresAt'] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(a->key,'identifier');
  END LOOP;
  PERFORM model_live_sequence_metadata_atom_v3(a->'approvalDigest','digest');
  PERFORM model_live_sequence_metadata_atom_v3(a->'definitionDigest','digest');
  FOR v IN SELECT x FROM (VALUES(d->'scope'),(a->'scope')) scopes(x) LOOP
    PERFORM model_live_sequence_metadata_object_v3(v,ARRAY['organizationId','projectId','userId','environment','plan']);
    FOR e IN SELECT * FROM jsonb_each(v) LOOP PERFORM model_live_sequence_metadata_atom_v3(e.value,'identifier'); END LOOP;
  END LOOP;
  PERFORM model_live_sequence_metadata_object_v3(d->'limits',ARRAY['maximumConcurrentJobs','maximumCreditUnits','maximumEstimatedMicroUsd','maximumInputTokens','maximumInvocations','maximumOutputTokens','maximumTotalTokens']);
  FOR e IN SELECT * FROM jsonb_each(d->'limits') LOOP PERFORM model_live_sequence_metadata_atom_v3(e.value,'integer'); END LOOP;
  PERFORM model_live_sequence_metadata_object_v3(p,ARRAY['administrativeSuspensions','allowlists','cacheKeyAuthority','canonicalCommercialAuthority','contractVersion','evaluationRequirement','featureEntitlements','killSwitches','limits','liveEvaluation','policyDigest','policyId','policyVersion','recordKind','requestWindows','safety']);
  PERFORM model_live_sequence_metadata_atom_v3(p->'policyDigest','digest');
  PERFORM model_live_sequence_metadata_atom_v3(p->'policyId','identifier');
  PERFORM model_live_sequence_metadata_atom_v3(p->'policyVersion','identifier');
  IF p->>'canonicalCommercialAuthority' IS DISTINCT FROM 'canonical-commercial-v1'
  THEN RAISE EXCEPTION 'canonical commercial metadata required' USING ERRCODE='23514'; END IF;
  IF (jsonb_typeof(p->'administrativeSuspensions')='array' AND jsonb_array_length(p->'administrativeSuspensions')<=10000) IS NOT TRUE
  THEN RAISE EXCEPTION 'bounded suspension metadata required' USING ERRCODE='23514'; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(p->'administrativeSuspensions') LOOP
    PERFORM model_live_sequence_metadata_object_v3(v,ARRAY['reasonCode','scope','scopeId']);
    FOR e IN SELECT * FROM jsonb_each(v) LOOP PERFORM model_live_sequence_metadata_atom_v3(e.value,'identifier'); END LOOP;
  END LOOP;
  PERFORM model_live_sequence_metadata_object_v3(p->'allowlists',ARRAY['dependencies','modelConfigurationReferences','modules','providers','roles','routes']);
  FOR e IN SELECT * FROM jsonb_each(p->'allowlists') LOOP
    PERFORM model_live_sequence_metadata_array_v3(e.value,'identifier',0,CASE e.key WHEN 'dependencies' THEN 512 WHEN 'modelConfigurationReferences' THEN 256 WHEN 'modules' THEN 256 WHEN 'providers' THEN 64 WHEN 'roles' THEN 5 ELSE 3 END);
  END LOOP;
  PERFORM model_live_sequence_metadata_object_v3(p->'cacheKeyAuthority',ARRAY['dataResidencyBoundary','organizationSafePolicyScope']);
  FOR e IN SELECT * FROM jsonb_each(p->'cacheKeyAuthority') LOOP PERFORM model_live_sequence_metadata_atom_v3(e.value,'identifier'); END LOOP;
  v:=p->'evaluationRequirement';
  PERFORM model_live_sequence_metadata_object_v3(v,ARRAY['datasetId','datasetVersion','datasetDigest','datasetCaseDigests','evaluationPolicyDigest','evaluationPolicyId','evaluationPolicyVersion','minimumDeterministicQualityBasisPoints']);
  FOREACH key IN ARRAY ARRAY['datasetId','datasetVersion','evaluationPolicyId','evaluationPolicyVersion'] LOOP PERFORM model_live_sequence_metadata_atom_v3(v->key,'identifier'); END LOOP;
  PERFORM model_live_sequence_metadata_atom_v3(v->'datasetDigest','digest');
  PERFORM model_live_sequence_metadata_atom_v3(v->'evaluationPolicyDigest','digest');
  PERFORM model_live_sequence_metadata_array_v3(v->'datasetCaseDigests','digest',1,2);
  PERFORM model_live_sequence_metadata_atom_v3(v->'minimumDeterministicQualityBasisPoints','integer');
  IF (jsonb_typeof(p->'featureEntitlements')='array' AND jsonb_array_length(p->'featureEntitlements') BETWEEN 1 AND 2) IS NOT TRUE
  THEN RAISE EXCEPTION 'bounded entitlement metadata required' USING ERRCODE='23514'; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(p->'featureEntitlements') LOOP
    PERFORM model_live_sequence_metadata_object_v3(v,ARRAY['features','plan']);
    PERFORM model_live_sequence_metadata_atom_v3(v->'plan','identifier');
    PERFORM model_live_sequence_metadata_array_v3(v->'features','identifier',1,64);
  END LOOP;
  PERFORM model_live_sequence_metadata_object_v3(p->'killSwitches',ARRAY['capabilitySwitches','global']);
  v:=p#>'{killSwitches,global}';
  PERFORM model_live_sequence_metadata_object_v3(v,ARRAY['engaged'],ARRAY['reasonCode']);
  PERFORM model_live_sequence_metadata_atom_v3(v->'engaged','boolean');
  IF v ? 'reasonCode' THEN PERFORM model_live_sequence_metadata_atom_v3(v->'reasonCode','identifier'); END IF;
  v:=p#>'{killSwitches,capabilitySwitches}';
  IF (jsonb_typeof(v)='array' AND jsonb_array_length(v)<=64) IS NOT TRUE
  THEN RAISE EXCEPTION 'bounded capability switch metadata required' USING ERRCODE='23514'; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(v) LOOP
    PERFORM model_live_sequence_metadata_object_v3(v,ARRAY['engaged','operation'],ARRAY['reasonCode']);
    PERFORM model_live_sequence_metadata_atom_v3(v->'engaged','boolean');
    PERFORM model_live_sequence_metadata_atom_v3(v->'operation','identifier');
    IF v ? 'reasonCode' THEN PERFORM model_live_sequence_metadata_atom_v3(v->'reasonCode','identifier'); END IF;
  END LOOP;
  PERFORM model_live_sequence_metadata_object_v3(p->'limits',ARRAY['maximumEdges','maximumFiles','maximumNodes','maximumOutputBytes','maximumOutputTokens','maximumPromptBytes','maximumRepairAttempts','maximumRepositoryBytes','maximumRepositoryFiles']);
  FOR e IN SELECT * FROM jsonb_each(p->'limits') LOOP PERFORM model_live_sequence_metadata_atom_v3(e.value,'integer'); END LOOP;
  v:=p->'liveEvaluation';
  PERFORM model_live_sequence_metadata_object_v3(v,ARRAY['enabledByDefault','excludedFromNormalCi','killSwitchEngagedByDefault','permittedEnvironments']);
  IF (v->'enabledByDefault'='false'::jsonb AND v->'excludedFromNormalCi'='true'::jsonb AND v->'killSwitchEngagedByDefault'='true'::jsonb) IS NOT TRUE
  THEN RAISE EXCEPTION 'evaluation-only closed defaults required' USING ERRCODE='23514'; END IF;
  PERFORM model_live_sequence_metadata_array_v3(v->'permittedEnvironments','identifier',0,2);
  PERFORM model_live_sequence_metadata_object_v3(p->'requestWindows',ARRAY['organization','user']);
  FOR v IN SELECT value FROM jsonb_each(p->'requestWindows') LOOP
    PERFORM model_live_sequence_metadata_object_v3(v,ARRAY['maximumConcurrentJobs','maximumRequests','windowSeconds']);
    FOR e IN SELECT * FROM jsonb_each(v) LOOP PERFORM model_live_sequence_metadata_atom_v3(e.value,'integer'); END LOOP;
  END LOOP;
  v:=p->'safety';
  PERFORM model_live_sequence_metadata_object_v3(v,ARRAY['arbitraryPackageAuthority','arbitraryShellAuthority','arbitraryToolAuthority','arbitraryUrlAuthority','credentialAuthority','deploymentAuthority','rawSensitiveLogsPermitted','repositoryWriteAuthority','resultSanitizationRequired','secretRedactionRequired','structuredOutputsRequired','tenantSafeCacheAndPromptKeysRequired']);
  IF v<>'{"arbitraryPackageAuthority":false,"arbitraryShellAuthority":false,"arbitraryToolAuthority":false,"arbitraryUrlAuthority":false,"credentialAuthority":false,"deploymentAuthority":false,"rawSensitiveLogsPermitted":false,"repositoryWriteAuthority":false,"resultSanitizationRequired":true,"secretRedactionRequired":true,"structuredOutputsRequired":true,"tenantSafeCacheAndPromptKeysRequired":true}'::jsonb
  THEN RAISE EXCEPTION 'closed safety metadata required' USING ERRCODE='23514'; END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(d->'cases') LOOP
    PERFORM model_live_sequence_metadata_atom_v3(c->'routeId','identifier');
    PERFORM model_live_sequence_metadata_object_v3(c->'authorityBinding',ARRAY['authorityTuple','authorityTupleDigest']);
    PERFORM model_live_sequence_metadata_atom_v3(c#>'{authorityBinding,authorityTupleDigest}','digest');
    v:=c#>'{authorityBinding,authorityTuple}';
    PERFORM model_live_sequence_metadata_object_v3(v,ARRAY['capabilityRegistryDigest','catalogDigest','modelConfigurationReference','operation','promptTemplateDigest','promptTemplateId','promptTemplateVersion','responseSchemaDigest','role','routeDefinitionDigest','routeRegistryDigest'],ARRAY['inferenceProfileId']);
    FOR e IN SELECT * FROM jsonb_each(v) LOOP PERFORM model_live_sequence_metadata_atom_v3(e.value,CASE WHEN e.key LIKE '%Digest' THEN 'digest' ELSE 'identifier' END); END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER model_live_sequence_plans_require_closed_metadata BEFORE INSERT ON model_live_sequence_plans
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_sequence_metadata_insert();

CREATE FUNCTION enforce_model_live_sequence_recipe_insert() RETURNS TRIGGER AS $$
DECLARE definition JSONB; c JSONB; n INTEGER;
BEGIN
  definition := NEW.plan_record->'definition';
  IF (definition ?& ARRAY['contractVersion','recordKind','definitionId','definitionDigest','scope','policy','cases','limits','expiresAt','normalCi']
    AND definition - ARRAY['contractVersion','recordKind','definitionId','definitionDigest','scope','policy','cases','limits','expiresAt','normalCi']='{}'::jsonb
    AND jsonb_typeof(definition->'cases')='array' AND jsonb_array_length(definition->'cases') BETWEEN 1 AND 2
    AND jsonb_array_length(definition->'cases')*2 <= (definition#>>'{limits,maximumInvocations}')::integer
    AND (definition#>>'{policy,limits,maximumRepairAttempts}')::integer>=2) IS NOT TRUE
  THEN RAISE EXCEPTION 'exact bounded sequence definition required' USING ERRCODE='23514'; END IF;
  n:=0;
  FOR c IN SELECT value FROM jsonb_array_elements(definition->'cases') LOOP
    IF (c ?& ARRAY['caseId','caseDigest','sourceInputDigest','recipeDigest','authorityBinding','routeId','seed']
      AND c - ARRAY['caseId','caseDigest','sourceInputDigest','recipeDigest','authorityBinding','routeId','seed']='{}'::jsonb
      AND ((c->>'caseId'='evaluation_case_repair_success_full_beta_v1' AND c->>'caseDigest'='sha256:26e82404d35aea55037641eabad0cc378c9bb3de4e61178255dd9366313600f6')
        OR (c->>'caseId'='evaluation_case_repair_exhaustion_full_beta_v1' AND c->>'caseDigest'='sha256:6715b2d07acdeb511c4c29d87b10fd7a924566a3864355b7f1237895339f3c14'))
      AND c->>'recipeDigest'='sha256:1082821c6ca130d9fd46befba48662a079d60b55fa1bd17d88249b07be783a62'
      AND c#>>'{authorityBinding,authorityTuple,operation}'='candidate.repair'
      AND c#>>'{authorityBinding,authorityTuple,role}'='repair-escalation'
      AND c->>'sourceInputDigest' ~ '^sha256:[a-f0-9]{64}$'
      AND c->'seed' ?& ARRAY['sourceDigest','revisionDigest','candidateDigest','ownershipDigest','validationReceiptDigest','validatorPolicyDigest']
      AND (c->'seed') - ARRAY['sourceDigest','revisionDigest','candidateDigest','ownershipDigest','validationReceiptDigest','validatorPolicyDigest']='{}'::jsonb
      AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(c->'seed') e WHERE (e.value ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE)
      AND definition#>'{policy,evaluationRequirement,datasetCaseDigests}'->n=c->'caseDigest') IS NOT TRUE
    THEN RAISE EXCEPTION 'reviewed frozen repair recipe required' USING ERRCODE='23514'; END IF;
    n:=n+1;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'caseId') FROM jsonb_array_elements(definition->'cases'))<>n
    OR jsonb_array_length(definition#>'{policy,evaluationRequirement,datasetCaseDigests}')<>n
  THEN RAISE EXCEPTION 'exact ordered sequence cases required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER model_live_sequence_plans_require_recipe BEFORE INSERT ON model_live_sequence_plans
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_sequence_recipe_insert();

CREATE FUNCTION require_current_model_live_sequence_plan(org VARCHAR, project VARCHAR, principal VARCHAR, plan_hash CHAR(64))
RETURNS model_live_sequence_plans AS $$
DECLARE p model_live_sequence_plans%ROWTYPE; i INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||org,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||org||':'||project||':'||principal,0));
  SELECT * INTO p FROM model_live_sequence_plans WHERE organization_id=org AND project_id=project AND principal_id=principal AND plan_sha256=plan_hash FOR SHARE;
  IF NOT FOUND OR p.issued_at>clock_timestamp() OR p.expires_at<=clock_timestamp()
    OR EXISTS(SELECT 1 FROM model_live_sequence_revocations v WHERE v.organization_id=org AND v.project_id=project AND v.principal_id=principal AND v.plan_sha256=plan_hash)
  THEN RAISE EXCEPTION 'current exact sequence plan required' USING ERRCODE='23514'; END IF;
  FOR i IN 0..1 LOOP
    PERFORM 1 FROM memberships m
      JOIN principals u ON u.principal_id=m.principal_id AND u.lifecycle_status='active'
      JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN projects pr ON pr.organization_id=o.organization_id AND pr.project_id=project AND pr.lifecycle_status='active'
      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      WHERE m.organization_id=org AND m.principal_id=CASE WHEN i=0 THEN principal ELSE p.operator_principal_id END
      AND m.lifecycle_status='active' AND r.policy_version='authorization-v2'
      AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[] AND (i=0 OR r.role_key='owner')
      AND NOT EXISTS(SELECT 1 FROM project_content_write_scopes f WHERE f.organization_id=org AND f.project_id=project AND f.closed_at IS NOT NULL)
      FOR SHARE OF m,u,o,pr,r;
    IF NOT FOUND THEN RAISE EXCEPTION 'current sequence membership required' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN p;
END;
$$ LANGUAGE plpgsql;
CREATE TABLE model_live_sequence_selections (
  organization_id VARCHAR(128) NOT NULL, project_id VARCHAR(128) NOT NULL, principal_id VARCHAR(128) NOT NULL,
  plan_sha256 CHAR(64) NOT NULL CHECK(plan_sha256 ~ '^[a-f0-9]{64}$'),
  selection_id VARCHAR(128) NOT NULL CHECK(selection_id ~ '^live_sequence_[a-f0-9]{32}$'),
  selection_sha256 CHAR(64) NOT NULL CHECK(selection_sha256 ~ '^[a-f0-9]{64}$'),
  selection_record JSONB NOT NULL CHECK(jsonb_typeof(selection_record)='object' AND octet_length(selection_record::text)<=32768),
  issued_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(organization_id,project_id,principal_id,plan_sha256), UNIQUE(organization_id,selection_id),
  UNIQUE(organization_id,selection_id,project_id,principal_id,plan_sha256),
  FOREIGN KEY(organization_id,project_id,principal_id,plan_sha256) REFERENCES model_live_sequence_plans(organization_id,project_id,principal_id,plan_sha256)
);
CREATE FUNCTION enforce_model_live_sequence_selection_insert() RETURNS TRIGGER AS $$
DECLARE p model_live_sequence_plans%ROWTYPE; r JSONB; c JSONB; e JSONB; i INTEGER; total INTEGER;
BEGIN
  p:=require_current_model_live_sequence_plan(NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.plan_sha256);
  r:=NEW.selection_record;
  IF (r ?& ARRAY['contractVersion','recordKind','issuerId','issuerVersion','selectionId','selectionDigest','definitionId','planDigest','approvalDigest','scope','issuedAt','stages']
    AND r - ARRAY['contractVersion','recordKind','issuerId','issuerVersion','selectionId','selectionDigest','definitionId','planDigest','approvalDigest','scope','issuedAt','stages']='{}'::jsonb
    AND r->'contractVersion'='3'::jsonb AND r->>'recordKind'='model-live-sequence-selection'
    AND r->>'issuerId'='cloudmarkup.model-live-sequence-selection' AND r->>'issuerVersion'='1.0.0'
    AND r->>'selectionId'=NEW.selection_id AND r->>'selectionDigest'='sha256:'||NEW.selection_sha256
    AND r->>'definitionId'=p.definition_id AND r->>'planDigest'='sha256:'||p.plan_sha256
    AND r->>'approvalDigest'='sha256:'||p.approval_sha256 AND r->'scope'=p.plan_record#>'{definition,scope}'
    AND (r->>'issuedAt')::timestamptz=NEW.issued_at AND NEW.issued_at>=p.issued_at AND NEW.issued_at<p.expires_at AND NEW.issued_at<=clock_timestamp()
    AND jsonb_typeof(r->'stages')='array' AND jsonb_array_length(r->'stages')=2*jsonb_array_length(p.plan_record#>'{definition,cases}')) IS NOT TRUE
  THEN RAISE EXCEPTION 'exact immutable sequence selection required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM model_live_invocations j WHERE j.organization_id=NEW.organization_id
    AND j.project_id=NEW.project_id AND j.principal_id=NEW.principal_id AND j.binding->>'liveEvaluationPlanDigest'='sha256:'||p.plan_sha256)
  THEN RAISE EXCEPTION 'retrospective sequence selection denied' USING ERRCODE='23514'; END IF;
  total:=jsonb_array_length(r->'stages');
  FOR i IN 0..total-1 LOOP
    e:=r->'stages'->i; c:=(p.plan_record#>'{definition,cases}')->(i/2);
    IF (e ?& ARRAY['caseId','caseDigest','stageKey','stageId','invocationId']
      AND e - ARRAY['caseId','caseDigest','stageKey','stageId','invocationId']='{}'::jsonb
      AND e->>'caseId'=c->>'caseId' AND e->>'caseDigest'=c->>'caseDigest'
      AND e->>'stageKey'=CASE WHEN i%2=0 THEN 'repair-1' ELSE 'repair-2' END
      AND e->>'stageId' ~ '^live_stage_[a-f0-9]{32}$' AND e->>'invocationId' ~ '^invocation_[a-f0-9]{32}$') IS NOT TRUE
    THEN RAISE EXCEPTION 'exact ordered sequence stage required' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM model_live_sequence_selections x CROSS JOIN LATERAL jsonb_array_elements(x.selection_record->'stages') s
      WHERE x.organization_id=NEW.organization_id AND (s->>'stageId'=e->>'stageId' OR s->>'invocationId'=e->>'invocationId'))
      OR EXISTS(SELECT 1 FROM model_live_invocations j WHERE j.organization_id=NEW.organization_id AND j.invocation_id=e->>'invocationId')
      OR EXISTS(SELECT 1 FROM model_live_invocation_sets x CROSS JOIN LATERAL jsonb_array_elements(x.set_record->'entries') s
        WHERE x.organization_id=NEW.organization_id AND s->>'invocationId'=e->>'invocationId')
    THEN RAISE EXCEPTION 'pre-issued invocation identity cannot be reused' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'stageId') FROM jsonb_array_elements(r->'stages'))<>total
    OR (SELECT count(DISTINCT value->>'invocationId') FROM jsonb_array_elements(r->'stages'))<>total
  THEN RAISE EXCEPTION 'unique sequence stage identities required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER model_live_sequence_selections_require_authority BEFORE INSERT ON model_live_sequence_selections
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_sequence_selection_insert();
CREATE TRIGGER model_live_sequence_selections_are_immutable BEFORE UPDATE OR DELETE ON model_live_sequence_selections
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
COMMENT ON TABLE model_live_sequence_selections IS
  'Prospective private V3 pre-result metadata only. Application issuance requires exact configured operator/definition plus host-generated identities in one transaction. No inference, receipt issuance, commercial reservation or quality authority.';

-- Reciprocal reservation guards are part of this same atomic migration.
CREATE FUNCTION require_model_live_sequence_reservation_snapshot(org VARCHAR)
RETURNS VOID AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'read committed invocation reservation required' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||org,0));
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE FUNCTION enforce_model_live_sequence_selection_snapshot() RETURNS TRIGGER AS $$
BEGIN
  PERFORM require_model_live_sequence_reservation_snapshot(NEW.organization_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;
CREATE TRIGGER model_live_sequence_selections_00_read_committed
BEFORE INSERT ON model_live_sequence_selections FOR EACH ROW
EXECUTE FUNCTION enforce_model_live_sequence_selection_snapshot();

CREATE FUNCTION enforce_model_live_set_sequence_reservation() RETURNS TRIGGER AS $$
BEGIN
  PERFORM require_model_live_sequence_reservation_snapshot(NEW.organization_id);
  -- This separate post-lock query obtains its current snapshot under READ COMMITTED.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.set_record->'entries') e
    JOIN model_live_sequence_selections s ON s.organization_id=NEW.organization_id
    CROSS JOIN LATERAL jsonb_array_elements(s.selection_record->'stages') stage
    WHERE stage->>'invocationId'=e->>'invocationId') THEN
    RAISE EXCEPTION 'invocation identity reserved by immutable sequence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;
CREATE TRIGGER model_live_invocation_sets_00_sequence_reservation
BEFORE INSERT ON model_live_invocation_sets FOR EACH ROW
EXECUTE FUNCTION enforce_model_live_set_sequence_reservation();

CREATE FUNCTION enforce_model_live_journal_sequence_reservation() RETURNS TRIGGER AS $$
BEGIN
  PERFORM require_model_live_sequence_reservation_snapshot(NEW.organization_id);
  -- No V3 journal bridge exists. A selected stage ID cannot be used by either V2 path.
  IF EXISTS(SELECT 1 FROM model_live_sequence_selections s
    CROSS JOIN LATERAL jsonb_array_elements(s.selection_record->'stages') stage
    WHERE s.organization_id=NEW.organization_id AND stage->>'invocationId'=NEW.invocation_id) THEN
    RAISE EXCEPTION 'invocation identity reserved by immutable sequence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;
CREATE TRIGGER model_live_invocations_00_sequence_reservation
BEFORE INSERT ON model_live_invocations FOR EACH ROW
EXECUTE FUNCTION enforce_model_live_journal_sequence_reservation();
