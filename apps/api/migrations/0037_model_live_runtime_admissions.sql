-- Additive report-free live metadata, using the existing runtime/debit/outbox tables.
-- No credit ledger, model activation, provider call or temporary content storage.
ALTER TABLE model_runtime_admissions
  DROP CONSTRAINT model_runtime_admissions_check,
  DROP CONSTRAINT model_runtime_admissions_snapshot_check1,
  DROP CONSTRAINT model_runtime_admissions_snapshot_check2;

CREATE FUNCTION cloudmarkup_runtime_admission_version_valid(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE request JSONB := value->'request'; decision JSONB := value->'decision'; capacity JSONB := value->'liveAuthorityReservation'; item RECORD; key TEXT;
BEGIN
  IF (jsonb_typeof(value)='object' AND jsonb_typeof(request)='object' AND jsonb_typeof(decision)='object') IS NOT TRUE THEN RETURN FALSE; END IF;
  IF request->'contractVersion'='1'::jsonb THEN
    RETURN ((value ?& ARRAY['request','decision','originalSnapshot','fingerprint','tenantScopeDigest','commercialExpiresAt','concurrencyLeaseId','revision','recoveryRequired','executionLease','pending','terminal'] AND value - ARRAY['request','decision','originalSnapshot','fingerprint','tenantScopeDigest','commercialExpiresAt','concurrencyLeaseId','revision','recoveryRequired','executionLease','pending','terminal']='{}'::jsonb) AND (request ?& ARRAY['capabilityRegistryDigest','cacheKeyAuthority','catalogDigest','commercialEstimate','contractVersion','evaluationAuthorityTupleDigest','evaluationReportDigest','evaluationReportId','evaluationResultSetDigest','executionClass','idempotencyKeyDigest','inputDigest','inputEvidenceDigest','operation','organizationId','plan','projectId','promptTemplateDigest','recordKind','requested','requestDigest','responseSchemaDigest','role','routeRegistryDigest','routingDecisionDigest','runtimePolicyDigest','userId'] AND request - ARRAY['capabilityRegistryDigest','cacheKeyAuthority','catalogDigest','commercialEstimate','contractVersion','evaluationAuthorityTupleDigest','evaluationReportDigest','evaluationReportId','evaluationResultSetDigest','executionClass','idempotencyKeyDigest','inputDigest','inputEvidenceDigest','operation','organizationId','plan','projectId','promptTemplateDigest','recordKind','requested','requestDigest','responseSchemaDigest','role','routeRegistryDigest','routingDecisionDigest','runtimePolicyDigest','userId']='{}'::jsonb)
      AND request->>'recordKind'='model-runtime-admission-request' AND decision->>'recordKind'='model-runtime-admission-decision'
      AND decision->'contractVersion'='1'::jsonb AND request->>'executionClass'='normal' AND decision->>'executionClass'='normal'
      AND NOT(value->'originalSnapshot' ? 'liveAuthorityUsage')) IS TRUE;
  END IF;
  IF request->'contractVersion'<>'2'::jsonb OR ((value ?& ARRAY['request','decision','originalSnapshot','fingerprint','tenantScopeDigest','commercialExpiresAt','concurrencyLeaseId','revision','recoveryRequired','executionLease','pending','terminal','liveAuthorityReservation'] AND value - ARRAY['request','decision','originalSnapshot','fingerprint','tenantScopeDigest','commercialExpiresAt','concurrencyLeaseId','revision','recoveryRequired','executionLease','pending','terminal','liveAuthorityReservation']='{}'::jsonb)
      AND (request ?& ARRAY['capabilityRegistryDigest','cacheKeyAuthority','catalogDigest','commercialEstimate','contractVersion','evaluationAuthorityTupleDigest','executionClass','idempotencyKeyDigest','inputDigest','inputEvidenceDigest','operation','organizationId','plan','projectId','promptTemplateDigest','recordKind','requested','requestDigest','responseSchemaDigest','role','routeRegistryDigest','routingDecisionDigest','runtimePolicyDigest','userId','evaluationCaseDigest','evaluationCaseId','liveEvaluationAuthorityDigest','liveEvaluationPlanDigest'] AND request - ARRAY['capabilityRegistryDigest','cacheKeyAuthority','catalogDigest','commercialEstimate','contractVersion','evaluationAuthorityTupleDigest','executionClass','idempotencyKeyDigest','inputDigest','inputEvidenceDigest','operation','organizationId','plan','projectId','promptTemplateDigest','recordKind','requested','requestDigest','responseSchemaDigest','role','routeRegistryDigest','routingDecisionDigest','runtimePolicyDigest','userId','evaluationCaseDigest','evaluationCaseId','liveEvaluationAuthorityDigest','liveEvaluationPlanDigest']='{}'::jsonb)
      AND request->>'recordKind'='model-live-runtime-admission-request' AND decision->>'recordKind'='model-live-runtime-admission-decision'
      AND decision->'contractVersion'='2'::jsonb AND request->>'executionClass'='live-evaluation' AND decision->>'executionClass'='live-evaluation'
      AND jsonb_typeof(capacity)='object' AND (capacity ?& ARRAY['authorityDigest','limits','planned'] AND capacity - ARRAY['authorityDigest','limits','planned']='{}'::jsonb)
      AND jsonb_typeof(capacity->'planned')='object' AND ((capacity->'planned') ?& ARRAY['cacheReadTokens','cacheWriteTokens','creditUnits','estimatedMicroUsd','inputTokens','invocations','outputTokens','totalTokens'] AND (capacity->'planned') - ARRAY['cacheReadTokens','cacheWriteTokens','creditUnits','estimatedMicroUsd','inputTokens','invocations','outputTokens','totalTokens']='{}'::jsonb)
      AND jsonb_typeof(capacity->'limits')='object' AND ((capacity->'limits') ?& ARRAY['maximumConcurrentJobs','maximumCreditUnits','maximumEstimatedMicroUsd','maximumInputTokens','maximumInvocations','maximumOutputTokens','maximumTotalTokens'] AND (capacity->'limits') - ARRAY['maximumConcurrentJobs','maximumCreditUnits','maximumEstimatedMicroUsd','maximumInputTokens','maximumInvocations','maximumOutputTokens','maximumTotalTokens']='{}'::jsonb)
      AND capacity->'authorityDigest'=request->'liveEvaluationAuthorityDigest'
      AND capacity->'authorityDigest'=value#>'{originalSnapshot,liveAuthorityUsage,authorityDigest}'
      AND capacity#>'{planned,creditUnits}'=request#>'{commercialEstimate,maximumCreditUnits}'
      AND capacity#>'{planned,estimatedMicroUsd}'=request#>'{commercialEstimate,estimatedMicroUsd}'
      AND decision->'commercialEstimateDigest'=request#>'{commercialEstimate,estimateDigest}') IS NOT TRUE THEN RETURN FALSE; END IF;
  FOREACH key IN ARRAY ARRAY['requestDigest','routingDecisionDigest','runtimePolicyDigest','evaluationAuthorityTupleDigest','evaluationCaseDigest','evaluationCaseId','liveEvaluationPlanDigest','liveEvaluationAuthorityDigest'] LOOP
    IF (request->key=decision->key) IS NOT TRUE THEN RETURN FALSE; END IF;
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

ALTER TABLE model_runtime_admissions ADD CONSTRAINT model_runtime_admission_version
  CHECK(cloudmarkup_runtime_admission_version_valid(snapshot) IS TRUE);

ALTER TABLE model_runtime_admissions ADD CONSTRAINT model_runtime_admission_scope
  CHECK((snapshot#>>'{request,organizationId}'=organization_id AND snapshot#>>'{request,projectId}'=project_id
    AND snapshot#>>'{request,userId}'=principal_id AND snapshot->>'tenantScopeDigest'='sha256:'||scope_sha256
    AND (snapshot->>'revision')::numeric=revision AND jsonb_typeof(snapshot->'recoveryRequired')='boolean') IS TRUE);

CREATE FUNCTION require_model_live_runtime_admission_plan() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE issued JSONB; binding JSONB; request JSONB := NEW.snapshot->'request'; capacity JSONB := NEW.snapshot->'liveAuthorityReservation'; current_count NUMERIC; accumulated NUMERIC; budget_key TEXT; planned_key TEXT;
BEGIN
  IF request->'contractVersion'<>'2'::jsonb THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.active_concurrency_lease_id IS NOT NULL AND NEW.snapshot#>'{executionLease,recoveryOnly}'<>'true'::jsonb THEN
      RAISE EXCEPTION 'live evaluation reacquisition is recovery only' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  SELECT p.plan_record INTO issued FROM model_live_evaluation_plans p
    WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id AND p.principal_id=NEW.principal_id
      AND 'sha256:'||p.plan_sha256=request->>'liveEvaluationPlanDigest'
      AND 'sha256:'||p.approval_sha256=request->>'liveEvaluationAuthorityDigest'
      AND p.issued_at<=clock_timestamp() AND p.expires_at>clock_timestamp()
      AND NOT EXISTS(SELECT 1 FROM model_live_evaluation_revocations r WHERE r.organization_id=p.organization_id AND r.plan_sha256=p.plan_sha256)
      AND EXISTS(SELECT 1 FROM memberships m JOIN principals u ON u.principal_id=m.principal_id
        WHERE m.organization_id=p.organization_id AND m.principal_id=p.operator_principal_id
          AND m.role_key='owner' AND m.lifecycle_status='active' AND u.lifecycle_status='active')
    FOR SHARE OF p;
  IF issued IS NULL OR (capacity->'limits'=issued#>'{definition,limits}'
    AND request->'runtimePolicyDigest'=issued#>'{definition,policy,policyDigest}'
    AND request->'plan'=issued#>'{definition,scope,plan}'
    AND request->'cacheKeyAuthority'=issued#>'{definition,policy,cacheKeyAuthority}'
    AND (NEW.snapshot->>'commercialExpiresAt')::timestamptz<=(issued->>'expiresAt')::timestamptz) IS NOT TRUE THEN
    RAISE EXCEPTION 'live runtime admission requires its current issued plan' USING ERRCODE='23514';
  END IF;
  SELECT c INTO binding FROM jsonb_array_elements(issued#>'{definition,cases}') c
    WHERE c->'caseId'=request->'evaluationCaseId';
  IF binding IS NULL OR (binding->'caseDigest'=request->'evaluationCaseDigest'
    AND binding->'invocationInputDigest'=request->'inputDigest'
    AND binding#>'{authorityBinding,authorityTupleDigest}'=request->'evaluationAuthorityTupleDigest'
    AND binding#>'{authorityBinding,authorityTuple,operation}'=request->'operation'
    AND binding#>'{authorityBinding,authorityTuple,role}'=request->'role'
    AND binding#>'{authorityBinding,authorityTuple,capabilityRegistryDigest}'=request->'capabilityRegistryDigest'
    AND binding#>'{authorityBinding,authorityTuple,routeRegistryDigest}'=request->'routeRegistryDigest'
    AND binding#>'{authorityBinding,authorityTuple,catalogDigest}'=request->'catalogDigest'
    AND binding#>'{authorityBinding,authorityTuple,promptTemplateDigest}'=request->'promptTemplateDigest'
    AND binding#>'{authorityBinding,authorityTuple,responseSchemaDigest}'=request->'responseSchemaDigest') IS NOT TRUE THEN
    RAISE EXCEPTION 'live runtime admission must bind its exact frozen case' USING ERRCODE='23514';
  END IF;
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

CREATE TRIGGER model_live_runtime_plan BEFORE INSERT OR UPDATE ON model_runtime_admissions
  FOR EACH ROW EXECUTE FUNCTION require_model_live_runtime_admission_plan();

CREATE INDEX model_runtime_live_capacity ON model_runtime_admissions(organization_id,(snapshot#>>'{request,liveEvaluationAuthorityDigest}'))
  WHERE snapshot#>>'{decision,outcome}'='allowed' AND snapshot#>>'{request,contractVersion}'='2';
