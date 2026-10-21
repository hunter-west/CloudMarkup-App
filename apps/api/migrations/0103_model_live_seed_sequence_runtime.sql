-- CloudMarkup additive migration 0103; fixed reviewed source closure.
-- Private additive V4 proposal after exact 0063; not registered for deployment.
-- Historical validators and rows remain unchanged. Two repair calls share one capacity admission.
CREATE FUNCTION cloudmarkup_seed_sequence_runtime_admission_v4_valid(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE request JSONB := value->'request'; decision JSONB := value->'decision'; capacity JSONB := value->'liveAuthorityReservation'; item RECORD; key TEXT;
BEGIN
  IF (jsonb_typeof(value)='object' AND jsonb_typeof(request)='object' AND jsonb_typeof(decision)='object') IS NOT TRUE THEN RETURN FALSE; END IF;
  IF request->'contractVersion'<>'4'::jsonb OR ((value ?& ARRAY['request','decision','originalSnapshot','fingerprint','tenantScopeDigest','commercialExpiresAt','concurrencyLeaseId','revision','recoveryRequired','executionLease','pending','terminal','liveAuthorityReservation'] AND value - ARRAY['request','decision','originalSnapshot','fingerprint','tenantScopeDigest','commercialExpiresAt','concurrencyLeaseId','revision','recoveryRequired','executionLease','pending','terminal','liveAuthorityReservation']='{}'::jsonb)
      AND (request ?& ARRAY['parentSequenceContractVersion','canonicalPlannedCallsDigest','capabilityRegistryDigest','cacheKeyAuthority','catalogDigest','commercialEstimate','contractVersion','evaluationAuthorityTupleDigest','executionClass','idempotencyKeyDigest','inputDigest','selectionId','selectionDigest','stageId','stageKey','invocationId','inputBindingDigest','preparedPayloadDigest','operation','organizationId','plan','projectId','promptTemplateDigest','recordKind','requested','requestDigest','responseSchemaDigest','role','routeRegistryDigest','routingDecisionDigest','runtimePolicyDigest','userId','evaluationCaseDigest','evaluationCaseId','liveEvaluationAuthorityDigest','liveEvaluationPlanDigest'] AND request - ARRAY['parentSequenceContractVersion','canonicalPlannedCallsDigest','capabilityRegistryDigest','cacheKeyAuthority','catalogDigest','commercialEstimate','contractVersion','evaluationAuthorityTupleDigest','executionClass','idempotencyKeyDigest','inputDigest','selectionId','selectionDigest','stageId','stageKey','invocationId','inputBindingDigest','preparedPayloadDigest','operation','organizationId','plan','projectId','promptTemplateDigest','recordKind','requested','requestDigest','responseSchemaDigest','role','routeRegistryDigest','routingDecisionDigest','runtimePolicyDigest','userId','evaluationCaseDigest','evaluationCaseId','liveEvaluationAuthorityDigest','liveEvaluationPlanDigest']='{}'::jsonb)
      AND request->>'recordKind'='model-live-sequence-runtime-admission-request' AND decision->>'recordKind'='model-live-sequence-runtime-admission-decision'
      AND decision->'contractVersion'='4'::jsonb AND request->'parentSequenceContractVersion'='3'::jsonb AND decision->'parentSequenceContractVersion'='3'::jsonb AND request->>'executionClass'='live-evaluation' AND decision->>'executionClass'='live-evaluation'
      AND jsonb_typeof(capacity)='object' AND (capacity ?& ARRAY['authorityDigest','limits','planned'] AND capacity - ARRAY['authorityDigest','limits','planned']='{}'::jsonb)
      AND jsonb_typeof(capacity->'planned')='object' AND ((capacity->'planned') ?& ARRAY['cacheReadTokens','cacheWriteTokens','creditUnits','estimatedMicroUsd','inputTokens','invocations','outputTokens','totalTokens'] AND (capacity->'planned') - ARRAY['cacheReadTokens','cacheWriteTokens','creditUnits','estimatedMicroUsd','inputTokens','invocations','outputTokens','totalTokens']='{}'::jsonb)
      AND jsonb_typeof(capacity->'limits')='object' AND ((capacity->'limits') ?& ARRAY['maximumConcurrentJobs','maximumCreditUnits','maximumEstimatedMicroUsd','maximumInputTokens','maximumInvocations','maximumOutputTokens','maximumTotalTokens'] AND (capacity->'limits') - ARRAY['maximumConcurrentJobs','maximumCreditUnits','maximumEstimatedMicroUsd','maximumInputTokens','maximumInvocations','maximumOutputTokens','maximumTotalTokens']='{}'::jsonb)
      AND capacity->'authorityDigest'=request->'liveEvaluationAuthorityDigest'
      AND capacity->'authorityDigest'=value#>'{originalSnapshot,liveAuthorityUsage,authorityDigest}'
      AND capacity#>'{planned,creditUnits}'=request#>'{commercialEstimate,maximumCreditUnits}'
      AND capacity#>'{planned,estimatedMicroUsd}'=request#>'{commercialEstimate,estimatedMicroUsd}'
      AND decision->'commercialEstimateDigest'=request#>'{commercialEstimate,estimateDigest}') IS NOT TRUE THEN RETURN FALSE; END IF;
  FOREACH key IN ARRAY ARRAY['parentSequenceContractVersion','canonicalPlannedCallsDigest','selectionId','selectionDigest','stageId','stageKey','invocationId','inputBindingDigest','preparedPayloadDigest','requestDigest','routingDecisionDigest','runtimePolicyDigest','evaluationAuthorityTupleDigest','evaluationCaseDigest','evaluationCaseId','liveEvaluationPlanDigest','liveEvaluationAuthorityDigest'] LOOP
    IF (request->key=decision->key) IS NOT TRUE THEN RETURN FALSE; END IF;
  END LOOP;

  PERFORM model_live_sequence_metadata_object_v3(decision,
    ARRAY['parentSequenceContractVersion','canonicalPlannedCallsDigest','contractVersion','recordKind','accountingAuthority','authorization','commercialEstimateDigest','decidedAt','decisionDigest','decisionId','denialReasons','evaluationAuthorityTupleDigest','evaluationCaseDigest','evaluationCaseId','executionClass','invokeModel','liveEvaluationAuthorityDigest','liveEvaluationPlanDigest','outcome','requestDigest','routingDecisionDigest','runtimePolicyDigest','writeAuthority','selectionId','selectionDigest','stageId','stageKey','invocationId','inputBindingDigest','preparedPayloadDigest'],
    ARRAY['expiresAt','safeError']);
  PERFORM model_live_sequence_metadata_object_v3(request->'requested',
    ARRAY['dependencyNames','edgeCount','fileCount','moduleSources','nodeCount','outputBytes','outputTokens','promptBytes','providerSources','repairAttempts','repositoryBytes','repositoryFiles']);
  PERFORM model_live_sequence_metadata_object_v3(request->'commercialEstimate',
    ARRAY['canonicalAuthority','estimateDigest','estimatedMicroUsd','maximumCreditUnits','pricingVersionReference']);
  IF (request->>'operation'='candidate.repair' AND request->>'role'='repair-escalation'
    AND request->>'stageKey'='repair-1' AND request#>'{requested,repairAttempts}'='2'::jsonb
    AND request->>'selectionId' ~ '^live_sequence_[a-f0-9]{32}$'
    AND request->>'stageId' ~ '^live_stage_[a-f0-9]{32}$'
    AND request->>'invocationId' ~ '^invocation_[a-f0-9]{32}$'
    AND request#>>'{commercialEstimate,canonicalAuthority}'='canonical-commercial-v1'
    AND decision->>'accountingAuthority'='canonical-commercial-v1'
    AND capacity#>'{planned,invocations}'='2'::jsonb
    AND capacity#>'{planned,cacheReadTokens}'='0'::jsonb
    AND capacity#>'{planned,cacheWriteTokens}'='0'::jsonb
    AND (capacity#>>'{planned,outputTokens}')::numeric=2*(request#>>'{requested,outputTokens}')::numeric) IS NOT TRUE THEN RETURN FALSE; END IF;
  FOREACH key IN ARRAY ARRAY['canonicalPlannedCallsDigest','selectionDigest','inputBindingDigest','preparedPayloadDigest','requestDigest','routingDecisionDigest','runtimePolicyDigest','evaluationAuthorityTupleDigest','evaluationCaseDigest','liveEvaluationPlanDigest','liveEvaluationAuthorityDigest','inputDigest','idempotencyKeyDigest'] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(request->key,'digest');
  END LOOP;

  FOR item IN SELECT * FROM jsonb_each((capacity->'planned') || (capacity->'limits')) LOOP
    IF jsonb_typeof(item.value)<>'number' OR item.value::text !~ '^(0|[1-9][0-9]*)$'
      OR (item.value::text)::numeric>9007199254740991 THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN ((capacity#>>'{planned,totalTokens}')::numeric =
      (capacity#>>'{planned,inputTokens}')::numeric + (capacity#>>'{planned,outputTokens}')::numeric
      + (capacity#>>'{planned,cacheReadTokens}')::numeric + (capacity#>>'{planned,cacheWriteTokens}')::numeric
    AND (capacity#>>'{planned,invocations}')::numeric>0
    AND (capacity#>>'{planned,outputTokens}')::numeric >= (request#>>'{requested,outputTokens}')::numeric) IS TRUE;
END;
$$;

ALTER TABLE model_runtime_admissions DROP CONSTRAINT model_runtime_admission_version;

ALTER TABLE model_runtime_admissions ADD CONSTRAINT model_runtime_admission_version
  CHECK ((cloudmarkup_runtime_admission_version_valid(snapshot) OR cloudmarkup_seed_runtime_admission_version_valid(snapshot) OR cloudmarkup_seed_sequence_runtime_admission_v4_valid(snapshot)) IS TRUE);

CREATE OR REPLACE FUNCTION require_model_seed_runtime_admission_plan() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE p model_live_sequence_plans%ROWTYPE; source model_live_sequence_inputs%ROWTYPE;
  issued JSONB; binding JSONB; request JSONB := NEW.snapshot->'request';
  capacity JSONB := NEW.snapshot->'liveAuthorityReservation'; current_count NUMERIC;
  accumulated NUMERIC; budget_key TEXT; planned_key TEXT; key TEXT;
BEGIN
  IF request->>'contractVersion' NOT IN ('3','4') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.active_concurrency_lease_id IS NOT NULL AND NEW.snapshot#>'{executionLease,recoveryOnly}'<>'true'::jsonb THEN
      RAISE EXCEPTION 'seed runtime reacquisition is recovery only' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  p:=require_current_model_live_sequence_plan(NEW.organization_id,NEW.project_id,NEW.principal_id,substring(request->>'liveEvaluationPlanDigest' from 8)::char(64));
  issued:=p.plan_record;
  SELECT * INTO STRICT source FROM model_live_sequence_inputs
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND plan_sha256=p.plan_sha256 AND stage_id=request->>'stageId';
  IF (request->>'liveEvaluationAuthorityDigest'='sha256:'||p.approval_sha256
    AND capacity->'limits'=issued#>'{definition,limits}'
    AND request->'runtimePolicyDigest'=issued#>'{definition,policy,policyDigest}'
    AND request->'plan'=issued#>'{definition,scope,plan}'
    AND request->'cacheKeyAuthority'=issued#>'{definition,policy,cacheKeyAuthority}'
    AND source.operator_principal_id=p.operator_principal_id
    AND request->'inputDigest'=source.input_record->'operationInputDigest'
    AND request->'evaluationCaseId'=source.input_record->'caseId'
    AND request->'evaluationCaseDigest'=source.input_record->'caseDigest'
    AND request->'evaluationAuthorityTupleDigest'=source.input_record->'authorityTupleDigest'
    AND (NEW.snapshot->>'commercialExpiresAt')::timestamptz<=p.expires_at
    AND (NEW.snapshot#>>'{decision,decidedAt}')::timestamptz>=source.issued_at
    AND (NEW.snapshot#>>'{decision,decidedAt}')::timestamptz<=clock_timestamp()
    AND (NEW.snapshot#>>'{decision,decidedAt}')::timestamptz<p.expires_at
    AND (NOT(NEW.snapshot->'decision' ? 'expiresAt') OR (NEW.snapshot#>>'{decision,expiresAt}')::timestamptz<=p.expires_at)
    AND NOT EXISTS (SELECT 1 FROM model_live_invocations i WHERE i.organization_id=NEW.organization_id
      AND i.project_id=NEW.project_id AND i.principal_id=NEW.principal_id AND i.invocation_id=source.invocation_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'seed runtime requires its exact current issued input' USING ERRCODE='23514';
  END IF;
  FOREACH key IN ARRAY ARRAY['selectionId','selectionDigest','stageId','stageKey','invocationId','inputBindingDigest','preparedPayloadDigest'] LOOP
    IF (request->key=source.input_record->key) IS NOT TRUE THEN
      RAISE EXCEPTION 'seed runtime input binding differs' USING ERRCODE='23514';
    END IF;
  END LOOP;
  SELECT c INTO STRICT binding FROM jsonb_array_elements(issued#>'{definition,cases}') c WHERE c->'caseId'=request->'evaluationCaseId';
  FOREACH key IN ARRAY ARRAY['operation','role','capabilityRegistryDigest','routeRegistryDigest','catalogDigest','promptTemplateDigest','responseSchemaDigest'] LOOP
    IF (binding#>ARRAY['authorityBinding','authorityTuple',key]=request->key) IS NOT TRUE THEN
      RAISE EXCEPTION 'seed runtime case authority differs' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF NEW.snapshot#>>'{decision,outcome}'='allowed' THEN
    SELECT count(*) INTO current_count FROM model_runtime_admissions a WHERE a.organization_id=NEW.organization_id
      AND a.snapshot#>'{request,liveEvaluationAuthorityDigest}'=request->'liveEvaluationAuthorityDigest' AND a.lease_expires_at>clock_timestamp();
    IF current_count+1>(capacity#>>'{limits,maximumConcurrentJobs}')::numeric THEN
      RAISE EXCEPTION 'live concurrency budget is exhausted' USING ERRCODE='23514';
    END IF;
    FOR planned_key,budget_key IN SELECT * FROM (VALUES
      ('creditUnits','maximumCreditUnits'),('estimatedMicroUsd','maximumEstimatedMicroUsd'),
      ('inputTokens','maximumInputTokens'),('invocations','maximumInvocations'),
      ('outputTokens','maximumOutputTokens'),('totalTokens','maximumTotalTokens')) pairs(planned,budget) LOOP
      SELECT COALESCE(sum((a.snapshot#>>ARRAY['liveAuthorityReservation','planned',planned_key])::numeric),0) INTO accumulated
        FROM model_runtime_admissions a WHERE a.organization_id=NEW.organization_id
        AND a.snapshot#>'{request,liveEvaluationAuthorityDigest}'=request->'liveEvaluationAuthorityDigest'
        AND a.snapshot#>>'{decision,outcome}'='allowed';
      IF accumulated+(capacity#>>ARRAY['planned',planned_key])::numeric>(capacity#>>ARRAY['limits',budget_key])::numeric THEN
        RAISE EXCEPTION 'live cumulative admission budget is exhausted' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP INDEX model_seed_runtime_stage_once;

CREATE UNIQUE INDEX model_seed_runtime_stage_once ON model_runtime_admissions
  (organization_id,project_id,principal_id,(snapshot#>>'{request,stageId}'))
  WHERE snapshot#>>'{request,contractVersion}' IN ('3','4');

DROP INDEX model_seed_runtime_capacity;

CREATE INDEX model_seed_runtime_capacity ON model_runtime_admissions
  (organization_id,(snapshot#>>'{request,liveEvaluationAuthorityDigest}'))
  WHERE snapshot#>>'{decision,outcome}'='allowed' AND snapshot#>>'{request,contractVersion}' IN ('3','4');
