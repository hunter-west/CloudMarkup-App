-- Non-replayable Intent preview metadata. No prompt, candidate body, object
-- reference, credit mutation, provider activation or redispatch permission.
CREATE TABLE ai_intent_previews (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  invocation_id VARCHAR(128) NOT NULL CHECK (invocation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  scope_sha256 CHAR(64) NOT NULL CHECK (scope_sha256 ~ '^[0-9a-f]{64}$'),
  workflow_id VARCHAR(128) NOT NULL,
  reservation_id VARCHAR(128) NOT NULL,
  dispatch_intent_id VARCHAR(128) NOT NULL,
  idempotency_sha256 CHAR(64) NOT NULL CHECK (idempotency_sha256 ~ '^[0-9a-f]{64}$'),
  binding_sha256 CHAR(64) NOT NULL CHECK (binding_sha256 ~ '^[0-9a-f]{64}$'),
  binding JSONB NOT NULL CHECK (jsonb_typeof(binding)='object' AND octet_length(binding::text)<=16384),
  callback_metadata JSONB NOT NULL CHECK (jsonb_typeof(callback_metadata)='object' AND octet_length(callback_metadata::text)<=8192),
  gateway_state VARCHAR(16) NOT NULL DEFAULT 'registered' CHECK (gateway_state IN ('registered','claimed','complete','failed')),
  gateway_claim JSONB CHECK (jsonb_typeof(gateway_claim)='object' AND octet_length(gateway_claim::text)<=2048),
  normalized_usage JSONB CHECK (jsonb_typeof(normalized_usage)='object' AND octet_length(normalized_usage::text)<=8192),
  generation_evidence JSONB CHECK (jsonb_typeof(generation_evidence)='object' AND octet_length(generation_evidence::text)<=8192),
  output_sha256 CHAR(64) CHECK (output_sha256 ~ '^[0-9a-f]{64}$'),
  output_bytes INTEGER CHECK (output_bytes BETWEEN 1 AND 16777216),
  output_evidence_sha256 CHAR(64) CHECK (output_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  delivery_state VARCHAR(16) NOT NULL DEFAULT 'none' CHECK (delivery_state IN ('none','pending','acknowledged','unconfirmed')),
  delivery_proof_sha256 CHAR(64) CHECK (delivery_proof_sha256 ~ '^[0-9a-f]{64}$'),
  delivery_opened_at TIMESTAMPTZ,
  delivery_expires_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,project_id,principal_id,invocation_id),
  UNIQUE (organization_id,project_id,principal_id,idempotency_sha256),
  UNIQUE (organization_id,reservation_id),
  UNIQUE (organization_id,scope_sha256,workflow_id),
  FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY (organization_id,principal_id) REFERENCES memberships(organization_id,principal_id),
  FOREIGN KEY (organization_id,scope_sha256,workflow_id) REFERENCES model_commercial_workflows(organization_id,scope_sha256,workflow_id),
  CHECK ((binding ?& ARRAY['contractVersion','scope','request','invocationId','idempotencyKeyDigest','inputDigest','previewBindingDigest']
    AND binding - ARRAY['contractVersion','scope','request','invocationId','idempotencyKeyDigest','inputDigest','previewBindingDigest']='{}'::jsonb
    AND binding->>'contractVersion'='1' AND binding->>'invocationId'=invocation_id
    AND binding#>>'{scope,organizationId}'=organization_id AND binding#>>'{scope,projectId}'=project_id
    AND binding#>>'{scope,userId}'=principal_id AND binding#>>'{scope,jobId}'=binding#>>'{request,jobId}'
    AND binding#>>'{request,organizationId}'=organization_id AND binding#>>'{request,projectId}'=project_id
    AND binding#>>'{request,userId}'=principal_id AND binding#>>'{request,multiCallWorkflowId}'=workflow_id
    AND binding#>>'{request,reservationId}'=reservation_id AND binding#>>'{request,feature}'='intent.extract'
    AND binding#>>'{request,requestedRoute}'='standard'
    AND jsonb_array_length(binding#>'{request,plannedCalls}')=1
    AND binding#>>'{request,plannedCalls,0,kind}'='primary'
    AND binding#>>'{request,plannedCalls,0,routeId}'='standard-design'
    AND binding->>'idempotencyKeyDigest'='sha256:' || idempotency_sha256) IS TRUE),
  CHECK (((binding->'scope') - ARRAY['organizationId','projectId','userId','jobId','repositorySnapshotId','solutionRevisionId']='{}'::jsonb
    AND (binding->'request') - ARRAY['confirmationRequired','environment','estimateAccepted','eventIdPrefix','expiresAt','feature','idempotencyKey','includeTechnicalUnitDetail','jobId','multiCallWorkflowId','organizationId','plannedCalls','projectId','promptId','promptVersion','requestedAt','requestedMaximumInputUnits','requestedMaximumOutputUnits','requestedRoute','requestId','reservationId','templateId','templateVersion','userId']='{}'::jsonb) IS TRUE),
  CHECK ((callback_metadata - ARRAY['acceptedMaximumCreditUnits','acceptedMaximumEstimatedProviderCostMicros','dispatchIntentId','multiCallWorkflowId','normalizationPolicyCatalogDigest','normalizationPolicyVersionReference','pricingAuthorityDigest','pricingCatalogDigest','pricingVersionReference','reservationId','route']='{}'::jsonb
    AND callback_metadata->>'dispatchIntentId'=dispatch_intent_id
    AND callback_metadata->>'multiCallWorkflowId'=workflow_id AND callback_metadata->>'reservationId'=reservation_id
    AND callback_metadata#>>'{route,routeId}'='standard-design') IS TRUE),
  CHECK ((gateway_state='registered')=(gateway_claim IS NULL)),
  CHECK (gateway_claim IS NULL OR ((gateway_claim - ARRAY['authorityDigest','idempotencyKeyDigest','inputDigest','invocationId']='{}'::jsonb
    AND gateway_claim->>'invocationId'=invocation_id AND gateway_claim->>'inputDigest'=binding->>'inputDigest'
    AND gateway_claim->>'idempotencyKeyDigest'=binding->>'idempotencyKeyDigest') IS TRUE)),
  CHECK (normalized_usage IS NULL OR ((normalized_usage - ARRAY['attemptNumber','cacheReadUnits','cacheWriteUnits','completedAt','contractVersion','durationMilliseconds','feature','idempotencyKeyDigest','inferenceProfileId','inputDigest','inputUnits','invocationId','modelId','modelVersion','outputUnits','promptTemplateId','promptVersion','providerId','providerRequestId','result','routing','scope','startedAt','thinkingUnits','usageRecordId']='{}'::jsonb
    AND normalized_usage->>'invocationId'=invocation_id AND normalized_usage->>'feature'='intent.extract'
    AND normalized_usage->>'attemptNumber'='1' AND normalized_usage->'scope'=binding->'scope'
    AND normalized_usage->>'inputDigest'=binding->>'inputDigest') IS TRUE)),
  CHECK (generation_evidence IS NULL OR ((generation_evidence - ARRAY['attempts','completedAt','failureCategory','resultId','status']='{}'::jsonb
    AND jsonb_array_length(generation_evidence->'attempts')=1
    AND generation_evidence#>>'{attempts,0,invocationId}'=invocation_id) IS TRUE)),
  CHECK ((gateway_state='complete')=(output_sha256 IS NOT NULL AND output_bytes IS NOT NULL)),
  CHECK ((output_sha256 IS NULL)=(output_bytes IS NULL)),
  CHECK (gateway_state<>'complete' OR (normalized_usage IS NOT NULL AND generation_evidence IS NOT NULL)),
  CHECK (generation_evidence IS NULL OR normalized_usage IS NOT NULL),
  CHECK ((delivery_proof_sha256 IS NULL AND delivery_opened_at IS NULL AND delivery_expires_at IS NULL AND output_evidence_sha256 IS NULL)
    OR (delivery_proof_sha256 IS NOT NULL AND delivery_opened_at IS NOT NULL AND delivery_expires_at=delivery_opened_at+INTERVAL '30 seconds'
      AND output_evidence_sha256 IS NOT NULL AND gateway_state='complete')),
  CHECK (delivery_state NOT IN ('pending','acknowledged') OR delivery_proof_sha256 IS NOT NULL),
  CHECK ((delivery_state='acknowledged')=(acknowledged_at IS NOT NULL)),
  CHECK (acknowledged_at IS NULL OR (acknowledged_at>=delivery_opened_at AND acknowledged_at<delivery_expires_at)),
  CHECK (delivery_state='none' OR generation_evidence IS NOT NULL)
);

CREATE FUNCTION validate_ai_intent_preview_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workflow_snapshot JSONB;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.gateway_state<>'registered' OR NEW.gateway_claim IS NOT NULL OR NEW.normalized_usage IS NOT NULL
      OR NEW.generation_evidence IS NOT NULL OR NEW.delivery_state<>'none' OR NEW.delivery_proof_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'preview must begin without invocation or delivery evidence' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.invocation_id,NEW.scope_sha256,NEW.workflow_id,
      NEW.reservation_id,NEW.dispatch_intent_id,NEW.idempotency_sha256,NEW.binding_sha256,NEW.binding,NEW.callback_metadata,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.organization_id,OLD.project_id,OLD.principal_id,OLD.invocation_id,OLD.scope_sha256,OLD.workflow_id,
      OLD.reservation_id,OLD.dispatch_intent_id,OLD.idempotency_sha256,OLD.binding_sha256,OLD.binding,OLD.callback_metadata,OLD.created_at)
      OR (OLD.gateway_state IN ('complete','failed') AND NEW.gateway_state<>OLD.gateway_state)
      OR (OLD.gateway_state='registered' AND NEW.gateway_state NOT IN ('registered','claimed'))
      OR (OLD.gateway_state='claimed' AND NEW.gateway_state NOT IN ('claimed','complete','failed'))
      OR (OLD.gateway_claim IS NOT NULL AND NEW.gateway_claim IS DISTINCT FROM OLD.gateway_claim)
      OR (OLD.normalized_usage IS NOT NULL AND NEW.normalized_usage IS DISTINCT FROM OLD.normalized_usage)
      OR (OLD.generation_evidence IS NOT NULL AND NEW.generation_evidence IS DISTINCT FROM OLD.generation_evidence)
      OR (OLD.output_sha256 IS NOT NULL AND ROW(NEW.output_sha256,NEW.output_bytes) IS DISTINCT FROM ROW(OLD.output_sha256,OLD.output_bytes))
      OR (OLD.delivery_state IN ('acknowledged','unconfirmed') AND NEW.delivery_state<>OLD.delivery_state)
      OR (OLD.delivery_state='pending' AND NEW.delivery_state NOT IN ('pending','acknowledged','unconfirmed'))
      OR (OLD.delivery_proof_sha256 IS NOT NULL AND ROW(NEW.delivery_proof_sha256,NEW.delivery_opened_at,NEW.delivery_expires_at,NEW.output_evidence_sha256)
        IS DISTINCT FROM ROW(OLD.delivery_proof_sha256,OLD.delivery_opened_at,OLD.delivery_expires_at,OLD.output_evidence_sha256))
      OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at) THEN
      RAISE EXCEPTION 'preview evidence is immutable or contradictory' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT snapshot INTO workflow_snapshot FROM model_commercial_workflows
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id;
  IF workflow_snapshot IS NULL OR workflow_snapshot->'request' IS DISTINCT FROM NEW.binding->'request'
    OR workflow_snapshot#>>'{dispatchIntent,dispatchIntentId}' IS DISTINCT FROM NEW.dispatch_intent_id
    OR workflow_snapshot#>>'{reservationReceipt,result,reservationId}' IS DISTINCT FROM NEW.reservation_id
    OR workflow_snapshot#>>'{reservationReceipt,result,accepted}' IS DISTINCT FROM 'true'
    OR workflow_snapshot#>'{resolvedContext,selectedRoute}' IS DISTINCT FROM NEW.callback_metadata->'route' THEN
    RAISE EXCEPTION 'preview requires an exact canonical commercial dispatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_intent_previews_validate_transition BEFORE INSERT OR UPDATE ON ai_intent_previews
FOR EACH ROW EXECUTE FUNCTION validate_ai_intent_preview_transition();

CREATE TRIGGER ai_intent_previews_reject_delete BEFORE DELETE ON ai_intent_previews
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

COMMENT ON TABLE ai_intent_previews IS
'Bounded metadata-only non-replayable Intent invocation and delivery evidence. No content retention, canonical credit mutation, platform dollar refund or provider activation.';
