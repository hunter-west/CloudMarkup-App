-- CloudMarkup additive migration 0109; fixed reviewed source closure.
-- Private additive proposal after exact 0069. Not registered for deployment.
-- Final pre-HTTP metadata binds actual first usage/validation and the original reservation.
CREATE TABLE model_live_repair_successor_dispatches_v4 (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  stage_id VARCHAR(128) NOT NULL,
  invocation_id VARCHAR(128) NOT NULL,
  workflow_scope_sha256 CHAR(64) NOT NULL CHECK(workflow_scope_sha256 ~ '^[a-f0-9]{64}$'),
  workflow_id VARCHAR(128) NOT NULL,
  runtime_scope_sha256 CHAR(64) NOT NULL CHECK(runtime_scope_sha256 ~ '^[a-f0-9]{64}$'),
  platform_dispatch_id VARCHAR(64) NOT NULL,
  descriptor JSONB NOT NULL CHECK(jsonb_typeof(descriptor)='object' AND octet_length(descriptor::text)<=16384),
  dispatch_record JSONB NOT NULL CHECK(jsonb_typeof(dispatch_record)='object' AND octet_length(dispatch_record::text)<=16384),
  dispatch_sha256 CHAR(64) NOT NULL CHECK(dispatch_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,project_id,principal_id,stage_id),
  UNIQUE(organization_id,invocation_id),
  UNIQUE(platform_dispatch_id),
  FOREIGN KEY(organization_id,project_id,principal_id,stage_id)
    REFERENCES model_live_repair_successor_inputs_v4(organization_id,project_id,principal_id,stage_id),
  FOREIGN KEY(organization_id,invocation_id) REFERENCES model_live_repair_successor_inputs_v4(organization_id,invocation_id),
  FOREIGN KEY(organization_id,workflow_scope_sha256,workflow_id)
    REFERENCES model_commercial_reservation_decisions(organization_id,scope_sha256,workflow_id),
  FOREIGN KEY(organization_id,runtime_scope_sha256) REFERENCES model_runtime_admissions(organization_id,scope_sha256),
  FOREIGN KEY(platform_dispatch_id) REFERENCES model_platform_spend_reservations(dispatch_id)
);

CREATE FUNCTION enforce_model_live_repair_successor_dispatch_insert_v4() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  source model_live_repair_successor_inputs_v4%ROWTYPE;
  plan model_live_sequence_plans%ROWTYPE;
  first_input model_live_sequence_inputs%ROWTYPE;
  candidate model_live_sequence_candidate_validations%ROWTYPE;
  observation model_live_sequence_observations%ROWTYPE;
  workflow model_commercial_workflows%ROWTYPE;
  runtime model_runtime_admissions%ROWTYPE;
  decision model_commercial_reservation_decisions%ROWTYPE;
  platform model_platform_spend_reservations%ROWTYPE;
  r JSONB := NEW.dispatch_record; d JSONB := NEW.descriptor; key TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT * INTO STRICT source FROM model_live_repair_successor_inputs_v4
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND principal_id=NEW.principal_id AND stage_id=NEW.stage_id;
  plan:=require_current_model_live_sequence_plan(NEW.organization_id,NEW.project_id,NEW.principal_id,source.plan_sha256);
  SELECT * INTO STRICT first_input FROM model_live_sequence_inputs
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND stage_id=source.input_record#>>'{predecessor,stageId}' FOR SHARE;
  SELECT * INTO STRICT candidate FROM model_live_sequence_candidate_validations
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND stage_id=first_input.stage_id FOR SHARE;
  SELECT * INTO STRICT observation FROM model_live_sequence_observations
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND stage_id=first_input.stage_id FOR SHARE;
  SELECT * INTO STRICT workflow FROM model_commercial_workflows
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND principal_id=NEW.principal_id AND scope_sha256=NEW.workflow_scope_sha256 AND workflow_id=NEW.workflow_id FOR SHARE;
  SELECT * INTO STRICT runtime FROM model_runtime_admissions
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND principal_id=NEW.principal_id AND scope_sha256=NEW.runtime_scope_sha256 FOR SHARE;
  SELECT * INTO STRICT decision FROM model_commercial_reservation_decisions
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND principal_id=NEW.principal_id AND scope_sha256=NEW.workflow_scope_sha256 AND workflow_id=NEW.workflow_id FOR SHARE;
  SELECT * INTO STRICT platform FROM model_platform_spend_reservations
    WHERE dispatch_id=NEW.platform_dispatch_id FOR SHARE;
  PERFORM model_live_sequence_metadata_object_v3(d, ARRAY['budgetDecisionId','complexity','contractVersion','entitlementDecisionId','evaluationPolicyId','evaluationPolicyVersion','feature','idempotencyKeyDigest','inferenceProfileId','inputDigest','invocationId','modelId','modelVersion','promptDigest','promptTemplateId','promptVersion','providerFamily','providerId','requestedMode','role','routing','scope','toolAuthority','recordKind']);
  PERFORM model_live_sequence_metadata_object_v3(d->'routing', ARRAY['capabilityRegistryDigest','capabilityRegistryId','capabilityRegistryVersion','capabilityVersion','effort','evaluationPolicyId','evaluationPolicyVersion','modelCapabilityDigest','modelConfigurationReference','modelFamily','pricingVersionReference','routeId','routeDefinitionDigest','routeRegistryDigest','routeRegistryId','routeRegistryVersion','routingConfigurationDigest']);
  PERFORM model_live_sequence_metadata_object_v3(d->'scope', ARRAY['organizationId','projectId','userId','jobId']);
  FOREACH key IN ARRAY ARRAY['budgetDecisionId','complexity','entitlementDecisionId','evaluationPolicyId','evaluationPolicyVersion','feature','idempotencyKeyDigest','inferenceProfileId','inputDigest','invocationId','modelId','modelVersion','promptDigest','promptTemplateId','promptVersion','providerFamily','providerId','requestedMode','role','toolAuthority','recordKind'] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(d->key,CASE WHEN key LIKE '%Digest' THEN 'digest' ELSE 'identifier' END);
  END LOOP;
  FOREACH key IN ARRAY ARRAY['capabilityRegistryDigest','capabilityRegistryId','capabilityRegistryVersion','capabilityVersion','effort','evaluationPolicyId','evaluationPolicyVersion','modelCapabilityDigest','modelConfigurationReference','modelFamily','pricingVersionReference','routeId','routeDefinitionDigest','routeRegistryDigest','routeRegistryId','routeRegistryVersion','routingConfigurationDigest'] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(d#>ARRAY['routing',key],CASE WHEN key LIKE '%Digest' THEN 'digest' ELSE 'identifier' END);
  END LOOP;
  FOREACH key IN ARRAY ARRAY['organizationId','projectId','userId','jobId'] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(d#>ARRAY['scope',key],'identifier');
  END LOOP;
  PERFORM model_live_sequence_metadata_object_v3(r, ARRAY[
    'contractVersion','parentSequenceContractVersion','recordKind','selectionId','selectionDigest','planDigest','caseId','caseDigest',
    'stageKey','stageId','invocationId','inputBindingDigest','dispatchDigest','descriptorDigest','runtimeRequestDigest',
    'platformReservationDigest','canonicalWorkflowFingerprint','canonicalDispatchIntentDigest','canonicalPlannedCallDigest',
    'canonicalAttemptOrdinal','dispatchedAt'
  ]);
  FOREACH key IN ARRAY ARRAY['selectionDigest','planDigest','caseDigest','inputBindingDigest','dispatchDigest','descriptorDigest',
    'runtimeRequestDigest','platformReservationDigest','canonicalWorkflowFingerprint','canonicalDispatchIntentDigest','canonicalPlannedCallDigest'] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(r->key,'digest');
  END LOOP;
  FOREACH key IN ARRAY ARRAY['selectionId','selectionDigest','planDigest','caseId','caseDigest','stageKey','stageId','invocationId','inputBindingDigest'] LOOP
    IF (r->key=source.input_record->key) IS NOT TRUE THEN
      RAISE EXCEPTION 'dispatch must bind its exact issued input' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF (
    r->'contractVersion'='4'::jsonb AND r->'parentSequenceContractVersion'='3'::jsonb
    AND r->>'recordKind'='model-live-sequence-dispatch'
    AND r->>'stageKey'='repair-2' AND r->'canonicalAttemptOrdinal'='2'::jsonb
    AND r->>'stageId'=NEW.stage_id AND r->>'invocationId'=NEW.invocation_id
    AND r->>'dispatchDigest'='sha256:'||NEW.dispatch_sha256
    AND source.invocation_id=NEW.invocation_id AND source.operator_principal_id=plan.operator_principal_id
    AND d->'contractVersion'='4'::jsonb AND d->>'recordKind'='model-live-repair-successor-invocation-descriptor'
    AND d->>'feature'='candidate.repair' AND d->>'role'='repair-escalation'
    AND d->>'toolAuthority'='none' AND d#>>'{routing,routeId}'='internal-escalation'
    AND d#>>'{routing,effort}'='high' AND d->'evaluationPolicyId'=d#>'{routing,evaluationPolicyId}'
    AND d->'evaluationPolicyVersion'=d#>'{routing,evaluationPolicyVersion}'
    AND d->>'invocationId'=NEW.invocation_id AND d->'inputDigest'=source.input_record->'operationInputDigest'
    AND d#>>'{scope,organizationId}'=NEW.organization_id AND d#>>'{scope,projectId}'=NEW.project_id
    AND d#>>'{scope,userId}'=NEW.principal_id AND d#>'{scope,jobId}'=workflow.snapshot#>'{request,jobId}'
    AND d->'budgetDecisionId'=workflow.snapshot#>'{request,reservationId}'
    AND runtime.snapshot#>'{request,contractVersion}'='4'::jsonb
    AND runtime.snapshot#>>'{request,stageId}'=first_input.stage_id
    AND r->'runtimeRequestDigest'=runtime.snapshot#>'{request,requestDigest}'
    AND runtime.snapshot#>'{executionLease,recoveryOnly}'='false'::jsonb
    AND runtime.snapshot->'recoveryRequired'='false'::jsonb
    AND runtime.snapshot->'terminal'='null'::jsonb
    AND runtime.lease_expires_at>clock_timestamp()
    AND workflow.lease_expires_at>clock_timestamp()
    AND (workflow.snapshot#>>'{request,expiresAt}')::timestamptz>clock_timestamp()
    AND workflow.snapshot#>'{reservationReceipt,result,accepted}'='true'::jsonb
    AND workflow.snapshot->'dispatchIntent'<>'null'::jsonb
    AND workflow.snapshot->'invocationReceipt'='null'::jsonb
    AND r->'canonicalWorkflowFingerprint'=workflow.snapshot->'fingerprint'
    AND decision.mapping_version='seed-sequence-runtime-windows-v4' AND decision.accepted
    AND decision.runtime_scope_sha256=NEW.runtime_scope_sha256
    AND cloudmarkup_seed_sequence_accounting_v4_binding_valid(workflow.snapshot,runtime.snapshot,decision.live_binding,plan.plan_record,first_input.input_record)
    AND first_input.plan_sha256=source.plan_sha256 AND first_input.selection_id=source.selection_id
    AND first_input.model_configuration_sha256=source.model_configuration_sha256
    AND first_input.seed_configuration_sha256=source.seed_configuration_sha256
    AND first_input.input_record->>'stageKey'='repair-1' AND first_input.input_record->'caseId'=source.input_record->'caseId'
    AND source.input_record#>>'{predecessor,kind}'='stage'
    AND source.input_record#>>'{predecessor,outcomeDigest}'='sha256:'||candidate.outcome_sha256
    AND source.input_record#>>'{predecessor,validationReceiptDigest}'='sha256:'||candidate.receipt_sha256
    AND source.input_record#>'{predecessor,outputDigest}'=candidate.outcome_record->'outputDigest'
    AND source.input_record#>'{predecessor,candidateDigest}'=candidate.outcome_record->'candidateDigest'
    AND candidate.receipt_record->>'disposition'='invalid-repairable'
    AND candidate.outcome_record->>'status'='validated' AND candidate.outcome_record#>>'{validation,status}'='invalid'
    AND candidate.outcome_record#>'{validation,repairable}'='true'::jsonb
    AND candidate.receipt_record->>'commercialAttemptObservationDigest'='sha256:'||observation.observation_sha256
    AND observation.observation_record->'canonicalWorkflowFingerprint'=workflow.snapshot->'fingerprint'
    AND observation.observation_record->'canonicalAttemptOrdinal'='1'::jsonb
    AND (r->>'dispatchedAt')::timestamptz>=source.issued_at
    AND source.issued_at>=(candidate.outcome_record->>'observedAt')::timestamptz
    AND platform.organization_id=NEW.organization_id AND platform.project_id=NEW.project_id
    AND platform.principal_id=NEW.principal_id AND platform.invocation_id=NEW.invocation_id
    AND 'sha256:'||platform.invocation_sha256=source.input_record->>'preparedPayloadDigest'
    AND platform.provider_id=d->>'providerId' AND platform.model_id=d->>'modelId'
    AND platform.model_version=d->>'modelVersion' AND platform.inference_profile_id=d->>'inferenceProfileId'
    AND platform.pricing_version_id=decision.live_binding#>>'{routingDecision,pricingVersionReference}'
    AND platform.maximum_cost_micro_usd<=(runtime.snapshot#>>'{request,commercialEstimate,estimatedMicroUsd}')::bigint
    AND clock_timestamp()<platform.dispatch_before
    AND (r->>'dispatchedAt')::timestamptz>=platform.reserved_at
    AND (r->>'dispatchedAt')::timestamptz<=clock_timestamp()
    AND (r->>'dispatchedAt')::timestamptz<platform.dispatch_before
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'exact current canonical and platform dispatch authority required' USING ERRCODE='23514';
  END IF;
  NEW.created_at:=clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_live_repair_successor_dispatch_require_authority_v4
  BEFORE INSERT ON model_live_repair_successor_dispatches_v4 FOR EACH ROW EXECUTE FUNCTION enforce_model_live_repair_successor_dispatch_insert_v4();

CREATE TRIGGER model_live_repair_successor_dispatches_immutable_v4
  BEFORE UPDATE OR DELETE ON model_live_repair_successor_dispatches_v4 FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
