-- CloudMarkup additive migration 0104; fixed reviewed source closure.
-- Additive private V4 proposal after exact 0064; not registered for deployment.
-- Application readers verify the exact canonical planned-call digest. SQL independently
-- checks both calls, aggregate limits and current original-plan/runtime authority.
-- Canonical terminal accounting remains closed until actual outcomes are integrated.
ALTER TABLE model_commercial_reservation_decisions
  DROP CONSTRAINT model_commercial_reservation_mapping,
  ADD CONSTRAINT model_commercial_reservation_mapping CHECK(mapping_version IN
    ('intent-extract-runtime-windows-v1','live-evaluation-runtime-windows-v2','seed-evaluation-runtime-windows-v3','seed-sequence-runtime-windows-v4')),
  DROP CONSTRAINT model_commercial_reservation_live_binding,
  ADD CONSTRAINT model_commercial_reservation_live_binding CHECK(
    (mapping_version='intent-extract-runtime-windows-v1' AND live_binding IS NULL AND live_binding_sha256 IS NULL)
    OR (mapping_version IN ('live-evaluation-runtime-windows-v2','seed-evaluation-runtime-windows-v3','seed-sequence-runtime-windows-v4') AND
      (jsonb_typeof(live_binding)='object' AND octet_length(live_binding::text)<=16384
        AND live_binding_sha256 ~ '^[a-f0-9]{64}$'
        AND live_binding ?& ARRAY['workflowId','workflowFingerprint','runtimeScopeDigest','runtimeFingerprint','routingDecision']
        AND live_binding - ARRAY['workflowId','workflowFingerprint','runtimeScopeDigest','runtimeFingerprint','routingDecision']='{}'::jsonb
        AND jsonb_typeof(live_binding->'routingDecision')='object'
        AND (mapping_version NOT IN ('seed-evaluation-runtime-windows-v3','seed-sequence-runtime-windows-v4') OR
          (live_binding#>'{routingDecision,contractVersion}'='3'::jsonb
            AND live_binding#>>'{routingDecision,recordKind}'='model-live-seed-routing-decision'))) IS TRUE));

CREATE FUNCTION cloudmarkup_seed_sequence_accounting_v4_binding_valid(workflow JSONB,runtime JSONB,binding JSONB,issued JSONB,input_record JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE request JSONB := workflow->'request'; admission JSONB := runtime->'request';
  context JSONB := workflow->'resolvedContext'; route JSONB := context->'selectedRoute';
  routing JSONB := binding->'routingDecision'; planned JSONB := runtime#>'{liveAuthorityReservation,planned}';
  call JSONB := request#>'{plannedCalls,0}'; entry JSONB; tuple JSONB; key TEXT;
BEGIN
  SELECT c INTO entry FROM jsonb_array_elements(issued#>'{definition,cases}') c WHERE c->'caseId'=admission->'evaluationCaseId';
  IF entry IS NULL THEN RETURN FALSE; END IF;
  tuple := entry#>'{authorityBinding,authorityTuple}';
  FOREACH key IN ARRAY ARRAY['selectionId','selectionDigest','stageId','stageKey','invocationId','inputBindingDigest','preparedPayloadDigest'] LOOP
    IF (admission->key=input_record->key) IS NOT TRUE THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN (cloudmarkup_seed_sequence_runtime_admission_v4_valid(runtime)
    AND admission->'contractVersion'='4'::jsonb AND admission->>'executionClass'='live-evaluation'
    AND input_record->'contractVersion'='3'::jsonb AND input_record->>'stageKey'='repair-1'
    AND input_record->'planDigest'=issued->'planDigest'
    AND input_record->'caseId'=admission->'evaluationCaseId'
    AND input_record->'caseDigest'=admission->'evaluationCaseDigest'
    AND input_record->'authorityTupleDigest'=admission->'evaluationAuthorityTupleDigest'
    AND routing->'contractVersion'='3'::jsonb AND routing->>'recordKind'='model-live-seed-routing-decision'
    AND routing->'seedInputBindingDigest'=input_record->'inputBindingDigest'
    AND routing->'maximumAttempts'='1'::jsonb AND routing->'automaticEscalationPermitted'='false'::jsonb
    AND routing#>'{promptCachePolicy,enabled}'='false'::jsonb
    AND request->>'feature'='candidate.repair' AND admission->>'role'='repair-escalation'
    AND request->'estimateAccepted'='true'::jsonb AND request->'confirmationRequired'='false'::jsonb
    AND routing->'userConfirmationRequired'='false'::jsonb
    AND planned->'cacheReadTokens'='0'::jsonb AND planned->'cacheWriteTokens'='0'::jsonb
    AND call#>'{minimumUsage,cacheReadUnits}'='0'::jsonb AND call#>'{minimumUsage,cacheWriteUnits}'='0'::jsonb
    AND runtime#>>'{decision,outcome}'='allowed' AND runtime#>'{decision,invokeModel}'='true'::jsonb
    AND routing->>'outcome'='selected'
    AND routing#>'{entitlement,allowed}'='true'::jsonb
    AND routing#>'{creditAuthorization,allowed}'='true'::jsonb
    AND routing#>'{creditAuthorization,estimateAccepted}'='true'::jsonb
    AND jsonb_array_length(request->'plannedCalls')=2 AND call->>'kind'='repair'
    AND routing->'maximumOutputTokens'=admission#>'{requested,outputTokens}'
    AND call#>'{minimumUsage,inputUnits}'=call#>'{maximumUsage,inputUnits}'
    AND call#>'{minimumUsage,outputUnits}'='0'::jsonb
    AND call#>'{minimumUsage,totalUnits}'=call#>'{minimumUsage,inputUnits}'
    AND request#>'{plannedCalls,1,minimumUsage,inputUnits}'='0'::jsonb
    AND request#>'{plannedCalls,1,minimumUsage,outputUnits}'='0'::jsonb
    AND request#>'{plannedCalls,1,minimumUsage,totalUnits}'='0'::jsonb
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(request->'plannedCalls') c WHERE (
      c->>'kind'='repair' AND c->'routeId'=entry->'routeId'
      AND c#>'{maximumUsage,outputUnits}'=routing->'maximumOutputTokens'
      AND (c#>>'{maximumUsage,inputUnits}')::numeric>0
      AND (c#>>'{maximumUsage,inputUnits}')::numeric <= (issued#>>'{definition,limits,maximumInputTokens}')::numeric/(2*jsonb_array_length(issued#>'{definition,cases}'))
      AND (c#>>'{maximumUsage,outputUnits}')::numeric <= (issued#>>'{definition,limits,maximumOutputTokens}')::numeric/(2*jsonb_array_length(issued#>'{definition,cases}'))
      AND c#>'{maximumUsage,cacheReadUnits}'='0'::jsonb AND c#>'{maximumUsage,cacheWriteUnits}'='0'::jsonb
      AND c#>'{minimumUsage,cacheReadUnits}'='0'::jsonb AND c#>'{minimumUsage,cacheWriteUnits}'='0'::jsonb
      AND c#>'{maximumUsage,providerSpecificUnits}'='[]'::jsonb AND c#>'{minimumUsage,providerSpecificUnits}'='[]'::jsonb
      AND (c#>>'{maximumUsage,totalUnits}')::numeric=(c#>>'{maximumUsage,inputUnits}')::numeric+(c#>>'{maximumUsage,outputUnits}')::numeric
    ) IS NOT TRUE)
    AND planned->'invocations'='2'::jsonb
    AND (request->>'requestedAt')::timestamptz>=(input_record->>'issuedAt')::timestamptz
    AND (request->>'expiresAt')::timestamptz<=(issued->>'expiresAt')::timestamptz
    AND 2*(routing->>'maximumOutputTokens')::numeric=(request->>'requestedMaximumOutputUnits')::numeric
    AND (entry->>'routeId'='internal-escalation' AND request->>'requestedRoute'='deep')
    AND call#>'{maximumUsage,providerSpecificUnits}'='[]'::jsonb
    AND call#>'{minimumUsage,providerSpecificUnits}'='[]'::jsonb
    AND (context#>>'{authorization,featureRequests,maximum}')::numeric <= (issued#>>'{definition,policy,requestWindows,organization,maximumRequests}')::numeric
    AND (context#>>'{authorization,perUserRequests,maximum}')::numeric <= (issued#>>'{definition,policy,requestWindows,user,maximumRequests}')::numeric
    AND (context#>>'{authorization,organizationConcurrentReservations,maximum}')::numeric <= (issued#>>'{definition,policy,requestWindows,organization,maximumConcurrentJobs}')::numeric
    AND binding->'workflowId'=request->'multiCallWorkflowId'
    AND binding->'workflowFingerprint'=workflow->'fingerprint'
    AND binding->'runtimeScopeDigest'=runtime->'tenantScopeDigest'
    AND binding->'runtimeFingerprint'=runtime->'fingerprint'
    AND request->'feature'=admission->'operation'
    AND request->'organizationId'=admission->'organizationId'
    AND request->'projectId'=admission->'projectId'
    AND request->'userId'=admission->'userId'
    AND (request->>'requestedMaximumOutputUnits')::numeric=2*(admission#>>'{requested,outputTokens}')::numeric
    AND context#>'{estimateResult,estimate,maximumCreditUnits}'=admission#>'{commercialEstimate,maximumCreditUnits}'
    AND context#>'{estimateResult,primaryPricingVersionId}'=admission#>'{commercialEstimate,pricingVersionReference}'
    AND context#>'{estimateResult,maximumEstimatedProviderCostMicros}'=admission#>'{commercialEstimate,estimatedMicroUsd}'
    AND admission->'liveEvaluationPlanDigest'=issued->'planDigest'
    AND admission->'liveEvaluationAuthorityDigest'=issued#>'{approval,approvalDigest}'
    AND admission->'evaluationCaseDigest'=entry->'caseDigest'
    AND admission->'inputDigest'=input_record->'operationInputDigest'
    AND admission->'evaluationAuthorityTupleDigest'=entry#>'{authorityBinding,authorityTupleDigest}'
    AND admission->'runtimePolicyDigest'=issued#>'{definition,policy,policyDigest}'
    AND admission->'cacheKeyAuthority'=issued#>'{definition,policy,cacheKeyAuthority}'
    AND runtime#>'{liveAuthorityReservation,limits}'=issued#>'{definition,limits}'
    AND request->'environment'=issued#>'{definition,scope,environment}'
    AND request->'organizationId'=issued#>'{definition,scope,organizationId}'
    AND request->'projectId'=issued#>'{definition,scope,projectId}'
    AND request->'userId'=issued#>'{definition,scope,userId}'
    AND admission->'plan'=issued#>'{definition,scope,plan}'
    AND request->'feature'=tuple->'operation'
    AND request->'promptId'=tuple->'promptTemplateId'
    AND request->'promptVersion'=tuple->'promptTemplateVersion'
    AND admission->'catalogDigest'=tuple->'catalogDigest'
    AND admission->'promptTemplateDigest'=tuple->'promptTemplateDigest'
    AND admission->'responseSchemaDigest'=tuple->'responseSchemaDigest'
    AND admission->'role'=tuple->'role'
    AND admission->'capabilityRegistryDigest'=tuple->'capabilityRegistryDigest'
    AND admission->'routeRegistryDigest'=tuple->'routeRegistryDigest'
    AND call->'routeId'=entry->'routeId'
    AND route->'routeId'=entry->'routeId'
    AND routing->'routeId'=entry->'routeId'
    AND routing->'feature'=tuple->'operation'
    AND routing->'capabilityRegistryDigest'=tuple->'capabilityRegistryDigest'
    AND routing->'modelConfigurationReference'=tuple->'modelConfigurationReference'
    AND routing->'routeDefinitionDigest'=tuple->'routeDefinitionDigest'
    AND routing->'routeRegistryDigest'=tuple->'routeRegistryDigest'
    AND routing->'inferenceProfileId'=tuple->'inferenceProfileId'
    AND routing#>'{requestBinding,inputDigest}'=admission->'inputDigest'
    AND routing#>'{requestBinding,idempotencyKeyDigest}'=admission->'idempotencyKeyDigest'
    AND routing#>'{entitlement,planKey}'=issued#>'{definition,scope,plan}'
    AND routing#>'{entitlement,planVersionId}'=context#>'{authorization,planVersionId}'
    AND routing#>'{customerCharge,acceptedMaximumCreditUnits}'=admission#>'{commercialEstimate,maximumCreditUnits}'
    AND routing->'evaluationPolicyId'=issued#>'{definition,policy,evaluationRequirement,evaluationPolicyId}'
    AND routing->'evaluationPolicyVersion'=issued#>'{definition,policy,evaluationRequirement,evaluationPolicyVersion}'
    AND routing->'pricingVersionReference'=admission#>'{commercialEstimate,pricingVersionReference}'
    AND route->'modelId'=routing->'modelId'
    AND route->'modelVersion'=routing->'modelVersion'
    AND route->'providerKey'=routing->'providerId'
    AND route->'inferenceProfileId'=routing->'inferenceProfileId'
    AND route->'route'=request->'requestedRoute'
    AND (SELECT sum((c#>>'{maximumUsage,inputUnits}')::numeric) FROM jsonb_array_elements(request->'plannedCalls') c)=(planned->>'inputTokens')::numeric
    AND (SELECT sum((c#>>'{maximumUsage,outputUnits}')::numeric) FROM jsonb_array_elements(request->'plannedCalls') c)=(planned->>'outputTokens')::numeric
    AND (SELECT sum((c#>>'{maximumUsage,cacheReadUnits}')::numeric) FROM jsonb_array_elements(request->'plannedCalls') c)=(planned->>'cacheReadTokens')::numeric
    AND (SELECT sum((c#>>'{maximumUsage,cacheWriteUnits}')::numeric) FROM jsonb_array_elements(request->'plannedCalls') c)=(planned->>'cacheWriteTokens')::numeric
    AND (SELECT sum((c#>>'{maximumUsage,totalUnits}')::numeric) FROM jsonb_array_elements(request->'plannedCalls') c)=(planned->>'totalTokens')::numeric
    AND request->'requestedMaximumInputUnits'=planned->'inputTokens'
    AND request->'requestedMaximumOutputUnits'=planned->'outputTokens') IS TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION validate_model_commercial_reservation_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workflow model_commercial_workflows%ROWTYPE; runtime model_runtime_admissions%ROWTYPE; issued JSONB; sequence_plan model_live_sequence_plans%ROWTYPE; source model_live_sequence_inputs%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'model reservation decisions are immutable' USING ERRCODE='23514'; END IF;
  NEW.created_at := clock_timestamp();
  IF NEW.mapping_version IN ('seed-evaluation-runtime-windows-v3','seed-sequence-runtime-windows-v4') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
    PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  END IF;
  SELECT * INTO workflow FROM model_commercial_workflows WHERE organization_id=NEW.organization_id AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id FOR SHARE;
  SELECT * INTO runtime FROM model_runtime_admissions WHERE organization_id=NEW.organization_id AND scope_sha256=NEW.runtime_scope_sha256 FOR SHARE;
  IF workflow.organization_id IS NULL OR runtime.organization_id IS NULL OR
    workflow.project_id<>NEW.project_id OR workflow.principal_id<>NEW.principal_id OR
    runtime.project_id<>NEW.project_id OR runtime.principal_id<>NEW.principal_id OR
    workflow.snapshot#>>'{reservationIntent,intentId}' IS DISTINCT FROM NEW.intent_id OR
    workflow.snapshot->'dispatchIntent'<>'null'::jsonb OR
    workflow.lease_expires_at IS NULL OR workflow.lease_expires_at<=clock_timestamp() OR
    runtime.snapshot->>'fingerprint' IS DISTINCT FROM 'sha256:'||NEW.runtime_fingerprint_sha256 OR
    runtime.snapshot#>>'{decision,outcome}' IS DISTINCT FROM 'allowed' OR
    runtime.snapshot#>'{executionLease,recoveryOnly}' IS DISTINCT FROM 'false'::jsonb OR
    runtime.snapshot->'recoveryRequired' IS DISTINCT FROM 'false'::jsonb OR
    runtime.lease_expires_at IS NULL OR runtime.lease_expires_at<=clock_timestamp() OR
    (runtime.snapshot->>'commercialExpiresAt')::timestamptz<=clock_timestamp() OR
    (runtime.snapshot#>>'{originalSnapshot,windows,organization,windowStartedAt}')::timestamptz IS DISTINCT FROM NEW.organization_window_start OR
    (runtime.snapshot#>>'{originalSnapshot,windows,organization,windowEndsAt}')::timestamptz IS DISTINCT FROM NEW.organization_window_end OR
    (runtime.snapshot#>>'{originalSnapshot,windows,user,windowStartedAt}')::timestamptz IS DISTINCT FROM NEW.user_window_start OR
    (runtime.snapshot#>>'{originalSnapshot,windows,user,windowEndsAt}')::timestamptz IS DISTINCT FROM NEW.user_window_end OR
    clock_timestamp()>=NEW.organization_window_end OR clock_timestamp()>=NEW.user_window_end OR
    workflow.snapshot#>>'{request,requestedAt}' IS DISTINCT FROM runtime.snapshot#>>'{decision,decidedAt}' OR
    workflow.snapshot#>>'{request,reservationId}' IS DISTINCT FROM runtime.snapshot#>>'{decision,authorization,commercialReservationDecisionId}' OR
    workflow.snapshot#>>'{request,expiresAt}' IS DISTINCT FROM runtime.snapshot->>'commercialExpiresAt'
  THEN RAISE EXCEPTION 'model decision requires current exact workflow runtime authority' USING ERRCODE='23514'; END IF;
  IF NEW.mapping_version='intent-extract-runtime-windows-v1' THEN
    IF (runtime.snapshot#>'{request,contractVersion}'='1'::jsonb
      AND runtime.snapshot#>>'{request,executionClass}'='normal'
      AND workflow.snapshot#>>'{request,feature}'='intent.extract'
      AND workflow.snapshot#>>'{request,requestedRoute}'='standard'
      AND runtime.snapshot#>>'{request,operation}'='intent.extract') IS NOT TRUE THEN
      RAISE EXCEPTION 'normal accounting requires normal Standard Intent authority' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.mapping_version='live-evaluation-runtime-windows-v2' THEN
    SELECT p.plan_record INTO issued FROM model_live_evaluation_plans p
      WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id AND p.principal_id=NEW.principal_id
        AND 'sha256:'||p.plan_sha256=runtime.snapshot#>>'{request,liveEvaluationPlanDigest}'
        AND 'sha256:'||p.approval_sha256=runtime.snapshot#>>'{request,liveEvaluationAuthorityDigest}'
        AND p.issued_at<=clock_timestamp() AND p.expires_at>clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM model_live_evaluation_revocations r WHERE r.organization_id=p.organization_id AND r.plan_sha256=p.plan_sha256)
        AND EXISTS(SELECT 1 FROM memberships m JOIN principals u ON u.principal_id=m.principal_id
          WHERE m.organization_id=p.organization_id AND m.principal_id=p.operator_principal_id
            AND m.role_key='owner' AND m.lifecycle_status='active' AND u.lifecycle_status='active')
      FOR SHARE OF p;
    IF issued IS NULL OR cloudmarkup_live_accounting_binding_valid(workflow.snapshot,runtime.snapshot,NEW.live_binding,issued) IS NOT TRUE THEN
      RAISE EXCEPTION 'live accounting requires its exact current issued plan binding' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.mapping_version IN ('seed-evaluation-runtime-windows-v3','seed-sequence-runtime-windows-v4') THEN
    sequence_plan:=require_current_model_live_sequence_plan(NEW.organization_id,NEW.project_id,NEW.principal_id,
      substring(runtime.snapshot#>>'{request,liveEvaluationPlanDigest}' from 8)::char(64));
    SELECT * INTO STRICT source FROM model_live_sequence_inputs
      WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
        AND plan_sha256=sequence_plan.plan_sha256 AND stage_id=runtime.snapshot#>>'{request,stageId}';
    IF source.operator_principal_id<>sequence_plan.operator_principal_id
      OR (CASE WHEN NEW.mapping_version='seed-evaluation-runtime-windows-v3' THEN
        cloudmarkup_seed_accounting_binding_valid(workflow.snapshot,runtime.snapshot,NEW.live_binding,sequence_plan.plan_record,source.input_record)
        ELSE cloudmarkup_seed_sequence_accounting_v4_binding_valid(workflow.snapshot,runtime.snapshot,NEW.live_binding,sequence_plan.plan_record,source.input_record) END) IS NOT TRUE
      OR EXISTS(SELECT 1 FROM model_live_invocations i WHERE i.organization_id=NEW.organization_id AND i.project_id=NEW.project_id
        AND i.principal_id=NEW.principal_id AND i.invocation_id=source.invocation_id) THEN
      RAISE EXCEPTION 'seed accounting requires exact current issued input authority' USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown model accounting mapping' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP INDEX model_seed_commercial_runtime_once;

CREATE UNIQUE INDEX model_seed_commercial_runtime_once ON model_commercial_reservation_decisions
  (organization_id,runtime_scope_sha256) WHERE mapping_version IN ('seed-evaluation-runtime-windows-v3','seed-sequence-runtime-windows-v4');
