-- Live evaluation usage/generation metadata only. No content retention,
-- validation result, settlement, credit grant, model activation or redispatch.
CREATE TABLE model_live_invocations (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  invocation_id VARCHAR(128) NOT NULL CHECK(invocation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  scope_sha256 CHAR(64) NOT NULL CHECK(scope_sha256 ~ '^[0-9a-f]{64}$'),
  workflow_id VARCHAR(128) NOT NULL,
  reservation_id VARCHAR(128) NOT NULL,
  dispatch_intent_id VARCHAR(128) NOT NULL,
  binding_sha256 CHAR(64) NOT NULL CHECK(binding_sha256 ~ '^[0-9a-f]{64}$'),
  binding JSONB NOT NULL CHECK(jsonb_typeof(binding)='object' AND octet_length(binding::text)<=8192),
  callback_metadata JSONB NOT NULL CHECK(jsonb_typeof(callback_metadata)='object' AND octet_length(callback_metadata::text)<=8192),
  gateway_state VARCHAR(16) NOT NULL DEFAULT 'registered' CHECK(gateway_state IN ('registered','claimed','complete','failed')),
  gateway_claim JSONB CHECK(jsonb_typeof(gateway_claim)='object' AND octet_length(gateway_claim::text)<=2048),
  normalized_usage JSONB CHECK(jsonb_typeof(normalized_usage)='object' AND octet_length(normalized_usage::text)<=8192),
  generation_evidence JSONB CHECK(jsonb_typeof(generation_evidence)='object' AND octet_length(generation_evidence::text)<=8192),
  output_sha256 CHAR(64) CHECK(output_sha256 ~ '^[0-9a-f]{64}$'),
  output_bytes INTEGER CHECK(output_bytes BETWEEN 1 AND 16777216),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,project_id,principal_id,invocation_id),
  UNIQUE(organization_id,scope_sha256,workflow_id),
  UNIQUE(organization_id,reservation_id),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY(organization_id,principal_id) REFERENCES memberships(organization_id,principal_id),
  FOREIGN KEY(organization_id,scope_sha256,workflow_id) REFERENCES model_commercial_reservation_decisions(organization_id,scope_sha256,workflow_id),
  CHECK((binding ?& ARRAY['contractVersion','scope','requestDigest','runtimeRequestDigest','accountingBindingDigest','liveEvaluationPlanDigest','liveEvaluationAuthorityDigest','evaluationCaseId','evaluationCaseDigest','invocationId','claimAuthorityDigest','inputDigest','idempotencyKeyDigest']
    AND binding - ARRAY['contractVersion','scope','requestDigest','runtimeRequestDigest','accountingBindingDigest','liveEvaluationPlanDigest','liveEvaluationAuthorityDigest','evaluationCaseId','evaluationCaseDigest','invocationId','claimAuthorityDigest','inputDigest','idempotencyKeyDigest']='{}'::jsonb
    AND binding->'contractVersion'='2'::jsonb AND binding->>'invocationId'=invocation_id
    AND binding#>>'{scope,organizationId}'=organization_id AND binding#>>'{scope,projectId}'=project_id
    AND binding#>>'{scope,userId}'=principal_id
    AND (binding->'scope') - ARRAY['organizationId','projectId','userId','jobId','repositorySnapshotId','solutionRevisionId']='{}'::jsonb) IS TRUE),
  CHECK((callback_metadata ?& ARRAY['acceptedMaximumCreditUnits','acceptedMaximumEstimatedProviderCostMicros','dispatchIntentId','multiCallWorkflowId','normalizationPolicyCatalogDigest','normalizationPolicyVersionReference','pricingAuthorityDigest','pricingCatalogDigest','pricingVersionReference','reservationId','route']
    AND callback_metadata - ARRAY['acceptedMaximumCreditUnits','acceptedMaximumEstimatedProviderCostMicros','dispatchIntentId','multiCallWorkflowId','normalizationPolicyCatalogDigest','normalizationPolicyVersionReference','pricingAuthorityDigest','pricingCatalogDigest','pricingVersionReference','reservationId','route']='{}'::jsonb
    AND callback_metadata->>'dispatchIntentId'=dispatch_intent_id
    AND callback_metadata->>'multiCallWorkflowId'=workflow_id AND callback_metadata->>'reservationId'=reservation_id) IS TRUE),
  CHECK((gateway_state='registered')=(gateway_claim IS NULL)),
  CHECK(gateway_claim IS NULL OR ((gateway_claim ?& ARRAY['authorityDigest','idempotencyKeyDigest','inputDigest','invocationId']
    AND gateway_claim - ARRAY['authorityDigest','idempotencyKeyDigest','inputDigest','invocationId']='{}'::jsonb
    AND gateway_claim->>'invocationId'=invocation_id AND gateway_claim->'inputDigest'=binding->'inputDigest'
    AND gateway_claim->'idempotencyKeyDigest'=binding->'idempotencyKeyDigest'
    AND gateway_claim->'authorityDigest'=binding->'claimAuthorityDigest') IS TRUE)),
  CHECK(normalized_usage IS NULL OR ((normalized_usage - ARRAY['attemptNumber','cacheReadUnits','cacheWriteUnits','completedAt','contractVersion','durationMilliseconds','feature','idempotencyKeyDigest','inferenceProfileId','inputDigest','inputUnits','invocationId','modelId','modelVersion','outputUnits','promptTemplateId','promptVersion','providerId','providerRequestId','result','routing','scope','startedAt','thinkingUnits','usageRecordId']='{}'::jsonb
    AND normalized_usage->>'invocationId'=invocation_id AND normalized_usage->'attemptNumber'='1'::jsonb
    AND normalized_usage->'scope'=binding->'scope' AND normalized_usage->'inputDigest'=binding->'inputDigest'
    AND normalized_usage->'idempotencyKeyDigest'=binding->'idempotencyKeyDigest') IS TRUE)),
  CHECK(generation_evidence IS NULL OR ((generation_evidence ?& ARRAY['attempts','completedAt','failureCategory','resultId','status']
    AND generation_evidence - ARRAY['attempts','completedAt','failureCategory','resultId','status']='{}'::jsonb
    AND jsonb_array_length(generation_evidence->'attempts')=1
    AND generation_evidence#>>'{attempts,0,invocationId}'=invocation_id) IS TRUE)),
  CHECK((gateway_state='complete')=(output_sha256 IS NOT NULL AND output_bytes IS NOT NULL)),
  CHECK((output_sha256 IS NULL)=(output_bytes IS NULL)),
  CHECK(gateway_state<>'complete' OR (normalized_usage IS NOT NULL AND generation_evidence IS NOT NULL
    AND normalized_usage->>'result'='succeeded' AND generation_evidence->>'status'='completed')),
  CHECK(generation_evidence IS NULL OR normalized_usage IS NOT NULL),
  CHECK(gateway_state<>'registered' OR normalized_usage IS NULL)
);

CREATE FUNCTION validate_model_live_invocation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w model_commercial_workflows%ROWTYPE; r model_runtime_admissions%ROWTYPE;
  d model_commercial_reservation_decisions%ROWTYPE; a JSONB; e JSONB;
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.created_at := clock_timestamp();
    IF NEW.gateway_state<>'registered' OR NEW.gateway_claim IS NOT NULL OR NEW.normalized_usage IS NOT NULL
      OR NEW.generation_evidence IS NOT NULL OR NEW.output_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'evaluation must begin without invocation evidence' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.invocation_id,NEW.scope_sha256,NEW.workflow_id,
      NEW.reservation_id,NEW.dispatch_intent_id,NEW.binding_sha256,NEW.binding,NEW.callback_metadata,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.organization_id,OLD.project_id,OLD.principal_id,OLD.invocation_id,OLD.scope_sha256,OLD.workflow_id,
      OLD.reservation_id,OLD.dispatch_intent_id,OLD.binding_sha256,OLD.binding,OLD.callback_metadata,OLD.created_at)
      OR (OLD.gateway_state IN ('complete','failed') AND NEW.gateway_state<>OLD.gateway_state)
      OR (OLD.gateway_state='registered' AND NEW.gateway_state NOT IN ('registered','claimed'))
      OR (OLD.gateway_state='claimed' AND NEW.gateway_state NOT IN ('claimed','complete','failed'))
      OR (OLD.gateway_claim IS NOT NULL AND NEW.gateway_claim IS DISTINCT FROM OLD.gateway_claim)
      OR (OLD.normalized_usage IS NOT NULL AND NEW.normalized_usage IS DISTINCT FROM OLD.normalized_usage)
      OR (OLD.generation_evidence IS NOT NULL AND NEW.generation_evidence IS DISTINCT FROM OLD.generation_evidence)
      OR (OLD.output_sha256 IS NOT NULL AND ROW(NEW.output_sha256,NEW.output_bytes) IS DISTINCT FROM ROW(OLD.output_sha256,OLD.output_bytes)) THEN
      RAISE EXCEPTION 'evaluation invocation evidence is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT * INTO w FROM model_commercial_workflows WHERE organization_id=NEW.organization_id
    AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id FOR SHARE;
  SELECT * INTO d FROM model_commercial_reservation_decisions WHERE organization_id=NEW.organization_id
    AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id FOR SHARE;
  SELECT * INTO r FROM model_runtime_admissions WHERE organization_id=NEW.organization_id
    AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND scope_sha256=d.runtime_scope_sha256 FOR SHARE;
  a := r.snapshot->'request'; e := w.snapshot#>'{resolvedContext,estimateResult}';
  IF (w.organization_id IS NOT NULL AND r.organization_id IS NOT NULL AND d.accepted
    AND d.mapping_version='live-evaluation-runtime-windows-v2'
    AND w.snapshot->'fingerprint'=NEW.binding->'requestDigest'
    AND 'sha256:'||d.live_binding_sha256=NEW.binding->>'accountingBindingDigest'
    AND a->'requestDigest'=NEW.binding->'runtimeRequestDigest'
    AND a->'liveEvaluationPlanDigest'=NEW.binding->'liveEvaluationPlanDigest'
    AND a->'liveEvaluationAuthorityDigest'=NEW.binding->'liveEvaluationAuthorityDigest'
    AND a->'evaluationCaseId'=NEW.binding->'evaluationCaseId'
    AND a->'evaluationCaseDigest'=NEW.binding->'evaluationCaseDigest'
    AND a->'inputDigest'=NEW.binding->'inputDigest'
    AND a->'idempotencyKeyDigest'=NEW.binding->'idempotencyKeyDigest'
    AND w.snapshot#>'{request,jobId}'=NEW.binding#>'{scope,jobId}'
    AND w.snapshot#>>'{request,reservationId}'=NEW.reservation_id
    AND w.snapshot#>>'{dispatchIntent,dispatchIntentId}'=NEW.dispatch_intent_id
    AND w.snapshot#>>'{reservationReceipt,result,reservationId}'=NEW.reservation_id
    AND w.snapshot#>'{reservationReceipt,result,accepted}'='true'::jsonb
    AND w.snapshot#>'{resolvedContext,selectedRoute}'=NEW.callback_metadata->'route'
    AND e#>'{estimate,maximumCreditUnits}'=NEW.callback_metadata->'acceptedMaximumCreditUnits'
    AND e->'maximumEstimatedProviderCostMicros'=NEW.callback_metadata->'acceptedMaximumEstimatedProviderCostMicros'
    AND e#>'{pricingAuthority,authorityDigest}'=NEW.callback_metadata->'pricingAuthorityDigest'
    AND e#>'{pricingAuthority,pricingCatalogDigest}'=NEW.callback_metadata->'pricingCatalogDigest'
    AND e#>'{pricingAuthority,normalizationPolicyCatalogDigest}'=NEW.callback_metadata->'normalizationPolicyCatalogDigest'
    AND e->'primaryPricingVersionId'=NEW.callback_metadata->'pricingVersionReference'
    AND e->'normalizationPolicyVersionId'=NEW.callback_metadata->'normalizationPolicyVersionReference') IS NOT TRUE THEN
    RAISE EXCEPTION 'evaluation requires exact canonical live dispatch metadata' USING ERRCODE='23514';
  END IF;
  IF NEW.normalized_usage IS NOT NULL AND (NEW.normalized_usage->'feature'=a->'operation'
    AND NEW.normalized_usage#>'{routing,routingDecisionDigest}'=a->'routingDecisionDigest'
    AND NEW.normalized_usage#>'{routing,routeId}'=NEW.callback_metadata#>'{route,routeId}'
    AND NEW.normalized_usage#>'{routing,acceptedMaximumCreditUnits}'=NEW.callback_metadata->'acceptedMaximumCreditUnits'
    AND NEW.normalized_usage->'modelId'=NEW.callback_metadata#>'{route,modelId}'
    AND NEW.normalized_usage->'modelVersion'=NEW.callback_metadata#>'{route,modelVersion}'
    AND NEW.normalized_usage->'providerId'=NEW.callback_metadata#>'{route,providerKey}'
    AND coalesce(NEW.normalized_usage->'inferenceProfileId','null'::jsonb)=NEW.callback_metadata#>'{route,inferenceProfileId}'
    AND NEW.normalized_usage->'promptTemplateId'=w.snapshot#>'{request,promptId}'
    AND NEW.normalized_usage->'promptVersion'=w.snapshot#>'{request,promptVersion}') IS NOT TRUE THEN
    RAISE EXCEPTION 'evaluation usage requires exact invocation bindings' USING ERRCODE='23514';
  END IF;
  -- SQL repeats durable current approval. The host also resolves current operator
  -- configuration before commit; expiry/revocation never discard actual usage.
  IF TG_OP='INSERT' OR (NEW.gateway_state IN ('claimed','complete') AND NEW.gateway_state IS DISTINCT FROM OLD.gateway_state) THEN
    IF NOT EXISTS(SELECT 1 FROM model_live_evaluation_plans p
      WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id AND p.principal_id=NEW.principal_id
      AND 'sha256:'||p.plan_sha256=NEW.binding->>'liveEvaluationPlanDigest'
      AND p.expires_at>clock_timestamp()
      AND NOT EXISTS(SELECT 1 FROM model_live_evaluation_revocations v WHERE v.organization_id=p.organization_id AND v.plan_sha256=p.plan_sha256)
      AND EXISTS(SELECT 1 FROM memberships m JOIN principals u ON u.principal_id=m.principal_id
        WHERE m.organization_id=p.organization_id AND m.principal_id=p.operator_principal_id
        AND m.role_key='owner' AND m.lifecycle_status='active' AND u.lifecycle_status='active')) THEN
      RAISE EXCEPTION 'evaluation requires current approval' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_live_invocations_validate BEFORE INSERT OR UPDATE ON model_live_invocations
FOR EACH ROW EXECUTE FUNCTION validate_model_live_invocation_transition();

CREATE TRIGGER model_live_invocations_reject_delete BEFORE DELETE ON model_live_invocations
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

COMMENT ON TABLE model_live_invocations IS
'Bounded V2 usage and generation digests; unknown usage stays unknown. No content, validators, financial settlement, approval grant or redispatch.';
