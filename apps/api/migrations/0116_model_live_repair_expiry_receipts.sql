-- CloudMarkup additive migration 0116; fixed reviewed source closure.
-- Private additive proposal after exact 0076. Not registered for deployment.
-- Database-clock expiry proof; unknown physical usage remains held.
CREATE FUNCTION cloudmarkup_repair_expiry_candidate_v4(
  org TEXT, project TEXT, principal TEXT, workflow_scope TEXT,
  workflow_id_input TEXT, source_revision_input BIGINT, observed_at_input TEXT
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  w JSONB; runtime_record JSONB; issued JSONB; selected JSONB;
  d model_commercial_reservation_decisions%ROWTYPE;
  source model_live_sequence_inputs%ROWTYPE;
  first_dispatch model_live_sequence_dispatches%ROWTYPE;
  first_observation model_live_sequence_observations%ROWTYPE;
  first_validation model_live_sequence_candidate_validations%ROWTYPE;
  final_dispatch model_live_repair_successor_dispatches_v4%ROWTYPE;
  final_observation model_live_repair_successor_observations_v4%ROWTYPE;
  final_stage TEXT; observed_at TEXT; dispatched_at TEXT;
  attempts JSONB; result_id TEXT; receipt_id TEXT;
  failure_code TEXT;
  result_identity TEXT; receipt_identity TEXT; latency NUMERIC;
BEGIN
  SELECT snapshot INTO w FROM model_commercial_workflow_revisions
    WHERE organization_id=org AND scope_sha256=workflow_scope
      AND workflow_id=workflow_id_input AND revision=source_revision_input;
  SELECT * INTO d FROM model_commercial_reservation_decisions
    WHERE organization_id=org AND project_id=project AND principal_id=principal
      AND scope_sha256=workflow_scope AND workflow_id=workflow_id_input FOR SHARE;
  IF w IS NULL OR d.organization_id IS NULL THEN RETURN NULL; END IF;
  IF (d.accepted AND d.mapping_version='seed-sequence-runtime-windows-v4'
    AND w#>>'{request,organizationId}'=org AND w#>>'{request,projectId}'=project
    AND w#>>'{request,userId}'=principal AND w#>>'{request,multiCallWorkflowId}'=workflow_id_input
    AND w#>>'{dispatchIntent,dispatchIntentId}' IS NOT NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'exact repair accounting source required' USING ERRCODE='23514';
  END IF;
  SELECT snapshot INTO runtime_record FROM model_runtime_admissions
    WHERE organization_id=org AND project_id=project AND principal_id=principal
      AND scope_sha256=d.runtime_scope_sha256 FOR SHARE;
  SELECT * INTO source FROM model_live_sequence_inputs
    WHERE organization_id=org AND project_id=project AND principal_id=principal
      AND stage_id=runtime_record#>>'{request,stageId}' FOR SHARE;
  SELECT plan_record INTO issued FROM model_live_sequence_plans
    WHERE organization_id=org AND project_id=project AND principal_id=principal
      AND plan_sha256=source.plan_sha256 FOR SHARE;
  IF cloudmarkup_seed_sequence_accounting_v4_binding_valid(w,runtime_record,d.live_binding,issued,source.input_record) IS NOT TRUE THEN
    RAISE EXCEPTION 'repair result cannot change original runtime binding' USING ERRCODE='23514';
  END IF;
  SELECT selection_record INTO selected FROM model_live_sequence_selections
    WHERE organization_id=org AND project_id=project AND principal_id=principal
      AND selection_id=source.selection_id AND plan_sha256=source.plan_sha256 FOR SHARE;
  SELECT value->>'stageId' INTO STRICT final_stage FROM jsonb_array_elements(selected->'stages')
    WHERE value->'caseId'=source.input_record->'caseId' AND value->>'stageKey'='repair-2';
  SELECT * INTO first_dispatch FROM model_live_sequence_dispatches
    WHERE organization_id=org AND project_id=project AND principal_id=principal AND stage_id=source.stage_id FOR SHARE;
  SELECT * INTO first_observation FROM model_live_sequence_observations
    WHERE organization_id=org AND project_id=project AND principal_id=principal AND stage_id=source.stage_id FOR SHARE;
  SELECT * INTO first_validation FROM model_live_sequence_candidate_validations
    WHERE organization_id=org AND project_id=project AND principal_id=principal AND stage_id=source.stage_id FOR SHARE;
  observed_at:=observed_at_input;
  IF (observed_at::timestamptz>=(w#>>'{request,expiresAt}')::timestamptz
    AND observed_at::timestamptz<=clock_timestamp()) IS NOT TRUE THEN RETURN NULL; END IF;
  IF cloudmarkup_recorded_repair_receipt_v4(org,project,principal,workflow_scope,workflow_id_input,source_revision_input) IS NOT NULL
    OR cloudmarkup_failed_repair_receipt_v4(org,project,principal,workflow_scope,workflow_id_input,source_revision_input) IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO final_dispatch FROM model_live_repair_successor_dispatches_v4
    WHERE organization_id=org AND project_id=project AND principal_id=principal AND stage_id=final_stage FOR SHARE;
  SELECT * INTO final_observation FROM model_live_repair_successor_observations_v4
    WHERE organization_id=org AND project_id=project AND principal_id=principal AND stage_id=final_stage FOR SHARE;
  -- A write-ahead dispatch without usage is uncertain and can never expire away.
  IF (first_dispatch.stage_id IS NOT NULL AND first_observation.stage_id IS NULL)
    OR (final_dispatch.stage_id IS NOT NULL AND final_observation.stage_id IS NULL) THEN RETURN NULL; END IF;
  IF (first_observation.stage_id IS NOT NULL AND
      (first_dispatch.workflow_id=workflow_id_input AND first_dispatch.workflow_scope_sha256=workflow_scope
       AND first_dispatch.runtime_scope_sha256=d.runtime_scope_sha256
       AND first_observation.observation_record->'canonicalWorkflowFingerprint'=w->'fingerprint'
       AND first_observation.normalized_usage->>'result'='succeeded') IS NOT TRUE)
    OR (final_observation.stage_id IS NOT NULL AND
      (first_observation.stage_id IS NOT NULL AND first_validation.receipt_record->>'disposition'='invalid-repairable'
       AND final_dispatch.workflow_id=workflow_id_input AND final_dispatch.workflow_scope_sha256=workflow_scope
       AND final_dispatch.runtime_scope_sha256=d.runtime_scope_sha256
       AND final_observation.observation_record->'canonicalWorkflowFingerprint'=w->'fingerprint'
       AND final_observation.canonical_attempt->>'retryOfAttemptId'=first_observation.canonical_attempt->>'attemptId'
       AND final_observation.normalized_usage->>'result'='succeeded') IS NOT TRUE) THEN
    RAISE EXCEPTION 'expiry requires complete original known usage' USING ERRCODE='23514';
  END IF;
  dispatched_at:=w#>>'{dispatchIntent,recordedAt}';
  latency:=EXTRACT(EPOCH FROM (observed_at::timestamptz-dispatched_at::timestamptz))*1000;
  IF latency<0 OR latency>9007199254740991 THEN RAISE EXCEPTION 'invalid expiry interval' USING ERRCODE='23514'; END IF;
  attempts:='[]'::jsonb;
  result_identity:='model-live-expired-repair-result-v4:'||(w->>'fingerprint')||':'||observed_at;
  IF first_observation.stage_id IS NOT NULL THEN
    attempts:=jsonb_build_array(first_observation.canonical_attempt||jsonb_build_object(
      'startedAt',dispatched_at,'completedAt',observed_at,'latencyMilliseconds',latency));
    result_identity:=result_identity||':'||(first_observation.observation_record->>'observationDigest');
  END IF;
  IF final_observation.stage_id IS NOT NULL THEN
    attempts:=attempts||jsonb_build_array(final_observation.canonical_attempt||jsonb_build_object(
      'startedAt',dispatched_at,'completedAt',observed_at,'latencyMilliseconds',0));
    result_identity:=result_identity||':'||(final_observation.observation_record->>'observationDigest');
  END IF;
  failure_code:=CASE WHEN first_dispatch.stage_id IS NULL THEN 'reservation-expired-before-dispatch'
    ELSE 'cloudmarkup.model-evaluation.validation-unavailable' END;
  result_id:='result_'||substr(encode(sha256(convert_to(result_identity,'UTF8')),'hex'),1,48);
  -- Exact canonical JSON of the host receipt identity's three string fields.
  receipt_identity:=E'{\n  "dispatchIntentId": '||to_jsonb(w#>>'{dispatchIntent,dispatchIntentId}')::text||
    E',\n  "receivedAt": '||to_jsonb(observed_at)::text||E',\n  "resultId": '||to_jsonb(result_id)::text||E'\n}\n';
  receipt_id:='receipt_'||substr(encode(sha256(convert_to(receipt_identity,'UTF8')),'hex'),1,48);
  RETURN jsonb_build_object(
    'dispatchIntentId',w#>>'{dispatchIntent,dispatchIntentId}','dispatchedAt',dispatched_at,
    'preDispatchProof',NULL,'receiptId',receipt_id,'receivedAt',observed_at,
    'result',jsonb_build_object('attempts',attempts,'completedAt',observed_at,
      'failureCategory',failure_code,'resultId',result_id,'status','internal-failure','usefulOutputDelivered',false));
END;
$$;

CREATE TABLE model_live_repair_expiry_receipts_v4 (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  workflow_scope_sha256 CHAR(64) NOT NULL CHECK(workflow_scope_sha256 ~ '^[a-f0-9]{64}$'),
  workflow_id VARCHAR(128) NOT NULL,
  source_revision BIGINT NOT NULL CHECK(source_revision>=0),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  receipt JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=32768),
  PRIMARY KEY(organization_id,workflow_scope_sha256,workflow_id),
  FOREIGN KEY(organization_id,workflow_scope_sha256,workflow_id,source_revision)
    REFERENCES model_commercial_workflow_revisions(organization_id,scope_sha256,workflow_id,revision)
);

CREATE FUNCTION enforce_model_live_repair_expiry_v4() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  -- Expiry and absence are observed under the exact locks used by both sends.
  NEW.observed_at:=date_trunc('milliseconds',clock_timestamp());
  NEW.receipt:=cloudmarkup_repair_expiry_candidate_v4(NEW.organization_id,NEW.project_id,NEW.principal_id,
    NEW.workflow_scope_sha256,NEW.workflow_id,NEW.source_revision,
    to_char(NEW.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  IF NEW.receipt IS NULL THEN RAISE EXCEPTION 'repair expiry is not proven' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_live_repair_expiry_require_evidence BEFORE INSERT ON model_live_repair_expiry_receipts_v4
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_repair_expiry_v4();

CREATE TRIGGER model_live_repair_expiry_immutable BEFORE UPDATE OR DELETE ON model_live_repair_expiry_receipts_v4
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE FUNCTION cloudmarkup_repair_expiry_receipt_v4(
  org TEXT, project TEXT, principal TEXT, workflow_scope TEXT, workflow_id_input TEXT, source_revision_input BIGINT
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE proof model_live_repair_expiry_receipts_v4%ROWTYPE; expected JSONB;
BEGIN
  SELECT * INTO proof FROM model_live_repair_expiry_receipts_v4
    WHERE organization_id=org AND project_id=project AND principal_id=principal
      AND workflow_scope_sha256=workflow_scope AND workflow_id=workflow_id_input AND source_revision=source_revision_input FOR SHARE;
  IF proof.organization_id IS NULL THEN RETURN NULL; END IF;
  expected:=cloudmarkup_repair_expiry_candidate_v4(org,project,principal,workflow_scope,workflow_id_input,source_revision_input,
    to_char(proof.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  IF expected IS NULL OR expected<>proof.receipt THEN RAISE EXCEPTION 'repair expiry proof differs' USING ERRCODE='23514'; END IF;
  RETURN proof.receipt;
END;
$$;

CREATE FUNCTION cloudmarkup_record_repair_expiry_v4(
  org TEXT, project TEXT, principal TEXT, workflow_scope TEXT, workflow_id_input TEXT, source_revision_input BIGINT
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE candidate JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||org,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||org||':'||project||':'||principal,0));
  candidate:=cloudmarkup_repair_expiry_receipt_v4(org,project,principal,workflow_scope,workflow_id_input,source_revision_input);
  IF candidate IS NOT NULL THEN RETURN candidate; END IF;
  candidate:=cloudmarkup_repair_expiry_candidate_v4(org,project,principal,workflow_scope,workflow_id_input,source_revision_input,
    to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  IF candidate IS NULL THEN RETURN NULL; END IF;
  INSERT INTO model_live_repair_expiry_receipts_v4(organization_id,project_id,principal_id,workflow_scope_sha256,workflow_id,source_revision)
    VALUES(org,project,principal,workflow_scope,workflow_id_input,source_revision_input) ON CONFLICT DO NOTHING;
  RETURN cloudmarkup_repair_expiry_receipt_v4(org,project,principal,workflow_scope,workflow_id_input,source_revision_input);
END;
$$;

-- Copy forward 0076 with exact recorded expiry evidence only.
CREATE OR REPLACE FUNCTION validate_model_commercial_accounting_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w jsonb; e jsonb; attempt jsonb; source_attempt jsonb; usage jsonb; item jsonb; response jsonb;
  d model_commercial_reservation_decisions%ROWTYPE; r credit_reservations%ROWTYPE;
  live model_live_invocations%ROWTYPE; validation model_live_proposal_validation_receipts%ROWTYPE; runtime_record JSONB; issued JSONB;
  preview ai_intent_previews%ROWTYPE; p model_provider_pricing_versions%ROWTYPE; n credit_normalization_policy_versions%ROWTYPE;
  pin jsonb; raw_cost numeric:=0; cost numeric:=0; actual numeric:=0; charged numeric:=0; units_total numeric:=0; rate numeric;
  attempt_index INTEGER; attempt_cost NUMERIC; total_input NUMERIC:=0; total_output NUMERIC:=0; total_latency NUMERIC:=0; first_started TEXT;
  verified_repair JSONB; field text; terminal boolean; delivered boolean; expected_result jsonb; source_result jsonb;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'model terminal evidence is append only' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp();
  SELECT * INTO d FROM model_commercial_reservation_decisions WHERE organization_id=NEW.organization_id AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id;
  -- Match every canonical credit transition: account before reservation.
  -- This also protects direct SQL insertion, not only the host adapter path.
  PERFORM a.billing_account_id FROM organization_billing_accounts a JOIN credit_reservations reserved
    ON reserved.organization_id=a.organization_id AND reserved.billing_account_id=a.billing_account_id
    WHERE reserved.organization_id=NEW.organization_id AND reserved.reservation_id=NEW.canonical_reservation_id
    FOR UPDATE OF a;
  SELECT * INTO r FROM credit_reservations WHERE organization_id=NEW.organization_id AND reservation_id=NEW.canonical_reservation_id FOR UPDATE;
  SELECT snapshot INTO w FROM model_commercial_workflow_revisions WHERE organization_id=NEW.organization_id AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id AND revision=NEW.source_revision;
  IF d.organization_id IS NULL OR r.reservation_id IS NULL OR w IS NULL OR NOT d.accepted
    OR d.canonical_reservation_id IS DISTINCT FROM NEW.canonical_reservation_id OR d.project_id<>NEW.project_id OR d.principal_id<>NEW.principal_id
    OR r.pricing_authority<>'model-provider-v1' OR r.status<>'active'
    OR w->>'fingerprint' IS DISTINCT FROM 'sha256:'||NEW.workflow_fingerprint_sha256
    OR (NEW.source_kind<>'live-repair-journal-v4' AND
      (jsonb_array_length(w#>'{request,plannedCalls}')<>1 OR w#>>'{request,plannedCalls,0,kind}' IS DISTINCT FROM 'primary'))
    OR (NEW.source_kind='live-repair-journal-v4' AND
      (d.mapping_version IS DISTINCT FROM 'seed-sequence-runtime-windows-v4'
       OR jsonb_array_length(w#>'{request,plannedCalls}')<>2
       OR w#>>'{request,plannedCalls,0,kind}' IS DISTINCT FROM 'repair'
       OR w#>>'{request,plannedCalls,1,kind}' IS DISTINCT FROM 'repair'))
    OR w#>>'{dispatchIntent,dispatchIntentId}' IS DISTINCT FROM NEW.dispatch_intent_id
    OR w#>>'{reservationReceipt,result,accepted}' IS DISTINCT FROM 'true'
    OR w#>>'{resolvedContext,estimateResult,pricingAuthority,authorityDigest}' IS DISTINCT FROM 'sha256:'||NEW.pricing_authority_sha256
    OR NEW.receipt->>'dispatchedAt' IS DISTINCT FROM w#>>'{dispatchIntent,recordedAt}'
    OR (NEW.receipt->>'receivedAt')::timestamptz < (NEW.receipt->>'dispatchedAt')::timestamptz
    OR (NEW.receipt->>'receivedAt')::timestamptz > clock_timestamp()
  THEN RAISE EXCEPTION 'model terminal source lineage is unavailable' USING ERRCODE='23514'; END IF;
  IF d.mapping_version='intent-extract-runtime-windows-v1' THEN
    IF w#>>'{request,feature}' IS DISTINCT FROM 'intent.extract'
      OR w#>>'{request,requestedRoute}' IS DISTINCT FROM 'standard'
      OR NEW.source_kind='live-invocation-journal' THEN
      RAISE EXCEPTION 'normal terminal authority cannot use live evaluation' USING ERRCODE='23514';
    END IF;
  ELSIF d.mapping_version='live-evaluation-runtime-windows-v2' THEN
    SELECT snapshot INTO runtime_record FROM model_runtime_admissions
      WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND principal_id=NEW.principal_id AND scope_sha256=d.runtime_scope_sha256 FOR SHARE;
    SELECT plan_record INTO issued FROM model_live_evaluation_plans
      WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND 'sha256:'||plan_sha256=runtime_record#>>'{request,liveEvaluationPlanDigest}';
    IF cloudmarkup_live_accounting_binding_valid(w,runtime_record,d.live_binding,issued) IS NOT TRUE
      OR NEW.source_kind NOT IN ('live-invocation-journal','workflow-receipt') OR NEW.outcome_kind NOT IN ('release','settlement')
      OR (NEW.source_kind='workflow-receipt' AND NEW.outcome_kind<>'release')
      OR (NEW.source_kind='workflow-receipt' AND EXISTS(
        SELECT 1 FROM model_live_invocations WHERE organization_id=NEW.organization_id
          AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id)) THEN
      RAISE EXCEPTION 'live terminal requires exact journal or undispatched expiry authority' USING ERRCODE='23514';
    END IF;
  ELSIF d.mapping_version='seed-sequence-runtime-windows-v4' THEN
    verified_repair:=cloudmarkup_recorded_repair_receipt_v4(NEW.organization_id,NEW.project_id,NEW.principal_id,
      NEW.scope_sha256,NEW.workflow_id,NEW.source_revision);
    IF verified_repair IS NULL THEN
      verified_repair:=cloudmarkup_failed_repair_receipt_v4(NEW.organization_id,NEW.project_id,NEW.principal_id,
        NEW.scope_sha256,NEW.workflow_id,NEW.source_revision);
    END IF;
    IF verified_repair IS NULL THEN
      verified_repair:=cloudmarkup_repair_expiry_receipt_v4(NEW.organization_id,NEW.project_id,NEW.principal_id,
        NEW.scope_sha256,NEW.workflow_id,NEW.source_revision);
    END IF;
    IF (NEW.source_kind='live-repair-journal-v4' AND NEW.outcome_kind IN ('settlement','release')
      AND verified_repair IS NOT NULL AND NEW.receipt=verified_repair
      AND NEW.preview_invocation_id IS NULL AND NEW.live_invocation_id IS NULL
      AND NEW.live_validation_receipt_id IS NULL AND NEW.live_validation_receipt_sha256 IS NULL) IS NOT TRUE THEN
      RAISE EXCEPTION 'repair settlement requires complete immutable case evidence' USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown terminal accounting mapping' USING ERRCODE='23514';
  END IF;
  e:=NEW.outcome->'event'; response:=NEW.outcome->'response'; terminal:=NEW.outcome_kind<>'reconciliation-required';
  IF e->>'organizationId' IS DISTINCT FROM NEW.organization_id OR e->>'projectId' IS DISTINCT FROM NEW.project_id
    OR e->>'userId' IS DISTINCT FROM NEW.principal_id OR e->>'multiCallWorkflowId' IS DISTINCT FROM NEW.workflow_id
    OR e->>'reservationId' IS DISTINCT FROM w#>>'{request,reservationId}' OR e->>'requestId' IS DISTINCT FROM w#>>'{request,requestId}'
    OR e->>'jobId' IS DISTINCT FROM w#>>'{request,jobId}' OR e->>'feature' IS DISTINCT FROM w#>>'{request,feature}'
    OR e->>'route' IS DISTINCT FROM w#>>'{request,requestedRoute}' OR e->>'routeId' IS DISTINCT FROM w#>>'{resolvedContext,selectedRoute,routeId}'
    OR e->>'promptId' IS DISTINCT FROM w#>>'{request,promptId}' OR e->>'promptVersion' IS DISTINCT FROM w#>>'{request,promptVersion}'
    OR e->'templateId' IS DISTINCT FROM w#>'{request,templateId}' OR e->'templateVersion' IS DISTINCT FROM w#>'{request,templateVersion}'
    OR e->>'environment' IS DISTINCT FROM w#>>'{request,environment}'
    OR e->>'providerKey' IS DISTINCT FROM r.provider_key OR e->>'modelId' IS DISTINCT FROM r.model_key OR e->>'modelVersion' IS DISTINCT FROM r.model_version
    OR e->>'pricingVersionId' IS DISTINCT FROM r.pricing_version_id
    OR e->>'normalizationPolicyVersionId' IS DISTINCT FROM w#>>'{resolvedContext,estimateResult,normalizationPolicyVersionId}'
    OR (e->>'reservedCreditUnits')::numeric IS DISTINCT FROM r.reserved_credit_units
    OR e->>'occurredAt' IS DISTINCT FROM NEW.receipt->>'receivedAt' OR e->'completedAt' IS DISTINCT FROM NEW.receipt->'receivedAt'
    OR response->>'reservationId' IS DISTINCT FROM e->>'reservationId' OR response->>'reservationAccepted' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'model terminal event binding is contradictory' USING ERRCODE='23514'; END IF;
  source_result:=NEW.receipt->'result'; delivered:=source_result->>'usefulOutputDelivered'='true';
  IF NEW.source_kind='live-repair-journal-v4' THEN
    IF (NEW.receipt=verified_repair AND terminal
      AND ((delivered AND source_result->>'status'='completed' AND NEW.outcome_kind='settlement')
        OR (NOT delivered AND source_result->>'status' IN ('provider-failure','cancelled','internal-failure') AND NEW.outcome_kind='release'))
      AND jsonb_array_length(source_result->'attempts') BETWEEN 0 AND 2) IS NOT TRUE THEN
      RAISE EXCEPTION 'repair receipt differs from recorded validation' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.source_kind='preview-journal' THEN
    SELECT * INTO preview FROM ai_intent_previews WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND invocation_id=NEW.preview_invocation_id FOR UPDATE;
    IF preview.generation_evidence IS NULL OR preview.scope_sha256 IS DISTINCT FROM NEW.scope_sha256 OR preview.workflow_id IS DISTINCT FROM NEW.workflow_id
      OR preview.dispatch_intent_id IS DISTINCT FROM NEW.dispatch_intent_id OR preview.binding->'request' IS DISTINCT FROM w->'request'
      OR preview.delivery_state NOT IN ('acknowledged','unconfirmed') OR delivered IS DISTINCT FROM (preview.delivery_state='acknowledged')
    THEN RAISE EXCEPTION 'verified model delivery is unavailable' USING ERRCODE='23514'; END IF;
    expected_result:=preview.generation_evidence;
    IF preview.delivery_state='unconfirmed' AND expected_result->>'status'='completed' THEN
      expected_result:=expected_result||jsonb_build_object('status','internal-failure','failureCategory','cloudmarkup.preview.delivery-unconfirmed');
    END IF;
    IF source_result-ARRAY['attempts','completedAt','usefulOutputDelivered'] IS DISTINCT FROM expected_result-ARRAY['attempts','completedAt']
      OR jsonb_array_length(source_result->'attempts')<>1 OR NEW.receipt->'preDispatchProof'<>'null'::jsonb
      OR (source_result#>'{attempts,0}')-ARRAY['startedAt','completedAt','latencyMilliseconds'] IS DISTINCT FROM (expected_result#>'{attempts,0}')-ARRAY['startedAt','completedAt','latencyMilliseconds']
    THEN RAISE EXCEPTION 'model receipt differs from verified generation' USING ERRCODE='23514'; END IF;
  ELSIF NEW.source_kind='live-invocation-journal' THEN
    SELECT * INTO live FROM model_live_invocations WHERE organization_id=NEW.organization_id
      AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND invocation_id=NEW.live_invocation_id FOR UPDATE;
    IF (live.scope_sha256=NEW.scope_sha256 AND live.workflow_id=NEW.workflow_id
      AND live.reservation_id=w#>>'{request,reservationId}' AND live.dispatch_intent_id=NEW.dispatch_intent_id
      AND live.binding->'requestDigest'=w->'fingerprint'
      AND live.binding->>'accountingBindingDigest'='sha256:'||d.live_binding_sha256
      AND live.binding->'runtimeRequestDigest'=runtime_record#>'{request,requestDigest}'
      AND live.binding->'liveEvaluationPlanDigest'=runtime_record#>'{request,liveEvaluationPlanDigest}'
      AND live.binding->'liveEvaluationAuthorityDigest'=runtime_record#>'{request,liveEvaluationAuthorityDigest}'
      AND live.binding->'evaluationCaseId'=runtime_record#>'{request,evaluationCaseId}'
      AND live.binding->'evaluationCaseDigest'=runtime_record#>'{request,evaluationCaseDigest}'
      AND live.gateway_claim IS NOT NULL
      AND NEW.receipt->'preDispatchProof'='null'::jsonb) IS NOT TRUE THEN
      RAISE EXCEPTION 'live terminal requires authenticated invocation lineage' USING ERRCODE='23514';
    END IF;
    IF NEW.outcome_kind='settlement' THEN
      SELECT * INTO validation FROM model_live_proposal_validation_receipts
        WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
          AND invocation_id=live.invocation_id AND receipt_id=NEW.live_validation_receipt_id;
      IF (validation.receipt_id IS NOT NULL AND validation.receipt_sha256=NEW.live_validation_receipt_sha256
        AND validation.receipt_record->>'journalBindingDigest'='sha256:'||live.binding_sha256
        AND validation.receipt_record->'runtimeRequestDigest'=runtime_record#>'{request,requestDigest}'
        AND validation.receipt_record->'planDigest'=runtime_record#>'{request,liveEvaluationPlanDigest}'
        AND validation.receipt_record->'approvalDigest'=runtime_record#>'{request,liveEvaluationAuthorityDigest}'
        AND validation.receipt_record#>'{assessment,caseId}'=runtime_record#>'{request,evaluationCaseId}'
        AND validation.receipt_record#>'{assessment,caseDigest}'=runtime_record#>'{request,evaluationCaseDigest}'
        AND validation.receipt_record#>'{assessment,inputDigest}'=runtime_record#>'{request,inputDigest}'
        AND validation.receipt_record#>>'{assessment,outputDigest}'='sha256:'||live.output_sha256
        AND validation.created_at>=(issued->>'issuedAt')::timestamptz
        AND validation.created_at<(issued->>'expiresAt')::timestamptz
        AND live.gateway_state='complete' AND live.output_sha256 IS NOT NULL AND live.output_bytes IS NOT NULL
        AND delivered=true AND cloudmarkup_live_completed_generation_matches(live.normalized_usage,live.generation_evidence)) IS NOT TRUE THEN
        RAISE EXCEPTION 'live settlement requires actual scoped case validation' USING ERRCODE='23514';
      END IF;
    ELSIF live.gateway_state='complete' THEN
      IF (NEW.outcome_kind='release' AND delivered=false
        AND live.output_sha256 IS NOT NULL AND live.output_bytes IS NOT NULL
        AND r.expires_at<=clock_timestamp()
        AND (NEW.receipt->>'receivedAt')::timestamptz>=r.expires_at
        AND r.expires_at=(w#>>'{request,expiresAt}')::timestamptz
        AND cloudmarkup_live_completed_generation_matches(live.normalized_usage,live.generation_evidence)
        AND NOT EXISTS(SELECT 1 FROM model_live_proposal_validation_receipts v
          WHERE v.organization_id=live.organization_id AND v.project_id=live.project_id
            AND v.principal_id=live.principal_id AND v.invocation_id=live.invocation_id)) IS NOT TRUE THEN
        RAISE EXCEPTION 'live unvalidated completion requires expired canonical deadline and known usage' USING ERRCODE='23514';
      END IF;
    ELSIF (live.gateway_state='failed' AND live.output_sha256 IS NULL AND live.output_bytes IS NULL
      AND delivered=false AND cloudmarkup_live_failed_generation_matches(live.normalized_usage,live.generation_evidence)) IS NOT TRUE THEN
      RAISE EXCEPTION 'live release requires authenticated known failed usage' USING ERRCODE='23514';
    END IF;
    expected_result:=live.generation_evidence;
    IF NEW.outcome_kind='release' AND live.gateway_state='complete' THEN
      expected_result:=expected_result||jsonb_build_object('status','internal-failure',
        'failureCategory','cloudmarkup.model-evaluation.validation-unavailable');
    END IF;
    IF source_result-ARRAY['attempts','completedAt','usefulOutputDelivered'] IS DISTINCT FROM expected_result-ARRAY['attempts','completedAt']
      OR jsonb_array_length(source_result->'attempts')<>1
      OR (source_result#>'{attempts,0}')-ARRAY['startedAt','completedAt','latencyMilliseconds']
        IS DISTINCT FROM (expected_result#>'{attempts,0}')-ARRAY['startedAt','completedAt','latencyMilliseconds'] THEN
      RAISE EXCEPTION 'live receipt differs from authenticated generation' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.receipt IS DISTINCT FROM w->'invocationReceipt' THEN RAISE EXCEPTION 'model receipt is not immutable workflow evidence' USING ERRCODE='23514'; END IF;
    IF terminal AND (NEW.outcome_kind='release' AND jsonb_array_length(source_result->'attempts')=0
      AND NEW.receipt#>>'{preDispatchProof,authority}'='coordinator-host-clock-v1'
      AND NEW.receipt#>>'{preDispatchProof,reason}'='reservation-expired-before-dispatch'
      AND NEW.receipt#>>'{preDispatchProof,organizationId}'=NEW.organization_id AND NEW.receipt#>>'{preDispatchProof,projectId}'=NEW.project_id
      AND NEW.receipt#>>'{preDispatchProof,reservationId}'=e->>'reservationId'
      AND NEW.receipt#>>'{preDispatchProof,multiCallWorkflowId}'=NEW.workflow_id
      AND NEW.receipt#>>'{preDispatchProof,dispatchIntentId}'=NEW.dispatch_intent_id
      AND NEW.receipt#>>'{preDispatchProof,observedAt}'=NEW.receipt->>'receivedAt'
      AND (NEW.receipt->>'receivedAt')::timestamptz>=(w#>>'{request,expiresAt}')::timestamptz
      AND source_result->>'status'='internal-failure' AND source_result->>'failureCategory'='reservation-expired-before-dispatch'
      AND source_result->>'usefulOutputDelivered'='false') IS NOT TRUE
    THEN RAISE EXCEPTION 'workflow-only model receipt cannot prove delivery or release' USING ERRCODE='23514'; END IF;
  END IF;
  pin:=w#>'{resolvedContext,estimateResult,pricingAuthority,routePins,0}';
  SELECT * INTO p FROM model_provider_pricing_versions WHERE pricing_version_id=e->>'pricingVersionId';
  SELECT * INTO n FROM credit_normalization_policy_versions WHERE normalization_policy_version_id=e->>'normalizationPolicyVersionId';
  IF p.pricing_version_id IS NULL OR n.normalization_policy_version_id IS NULL OR p.provider_key<>r.provider_key OR p.model_key<>r.model_key OR p.model_version<>r.model_version
    OR p.cost_currency<>n.cost_currency OR p.inference_profile_id IS DISTINCT FROM e->>'inferenceProfileId'
    OR pin#>>'{pricingVersion,pricingVersionId}' IS DISTINCT FROM p.pricing_version_id OR pin#>>'{normalizationPolicy,normalizationPolicyVersionId}' IS DISTINCT FROM n.normalization_policy_version_id
  THEN RAISE EXCEPTION 'model terminal immutable prices are unavailable' USING ERRCODE='23514'; END IF;
  FOREACH field IN ARRAY ARRAY['inputUnits','outputUnits','cacheReadUnits','cacheWriteUnits','totalUnits','estimatedProviderCostMicros','reservedCreditUnits','chargedCreditUnits','compensatedCreditUnits','latencyMilliseconds'] LOOP
    IF jsonb_typeof(e->field) IS DISTINCT FROM 'number' OR (e->>field)!~'^[0-9]+$' OR (e->>field)::numeric>9007199254740991 THEN
      RAISE EXCEPTION 'model terminal units are invalid' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF NEW.source_kind='live-repair-journal-v4' THEN
    IF (jsonb_array_length(e->'attempts')=jsonb_array_length(source_result->'attempts')
      AND e->'providerSpecificUnits'='[]'::jsonb
      AND (e->>'cacheReadUnits')::numeric=0 AND (e->>'cacheWriteUnits')::numeric=0) IS NOT TRUE THEN
      RAISE EXCEPTION 'repair aggregate attempt shape is unavailable' USING ERRCODE='23514';
    END IF;
    FOR attempt_index IN 0..jsonb_array_length(source_result->'attempts')-1 LOOP
      attempt:=e->'attempts'->attempt_index; source_attempt:=source_result->'attempts'->attempt_index;
      usage:=source_attempt->'usage';
      IF (usage IS NOT NULL AND usage<>'null'::jsonb
        AND attempt-ARRAY['estimatedProviderCostMicros','pricingVersionId','normalizationPolicyVersionId']=source_attempt
        AND attempt->>'attemptKind'='repair' AND (attempt->>'attemptNumber')::numeric=attempt_index+1
        AND attempt->>'providerKey'=p.provider_key AND attempt->>'modelId'=p.model_key
        AND attempt->>'modelVersion'=p.model_version
        AND attempt->>'inferenceProfileId' IS NOT DISTINCT FROM p.inference_profile_id
        AND attempt->>'pricingVersionId'=p.pricing_version_id
        AND attempt->>'normalizationPolicyVersionId'=n.normalization_policy_version_id
        AND usage->'providerSpecificUnits'='[]'::jsonb
        AND (usage->>'cacheReadUnits')::numeric=0 AND (usage->>'cacheWriteUnits')::numeric=0
        AND (usage->>'totalUnits')::numeric=(usage->>'inputUnits')::numeric+(usage->>'outputUnits')::numeric) IS NOT TRUE THEN
        RAISE EXCEPTION 'priced repair attempt differs from immutable usage' USING ERRCODE='23514';
      END IF;
      attempt_cost:=ceil(((usage->>'inputUnits')::numeric*p.input_micros_per_million_units
        +(usage->>'outputUnits')::numeric*p.output_micros_per_million_units)/1000000);
      IF (attempt->>'estimatedProviderCostMicros')::numeric IS DISTINCT FROM attempt_cost THEN
        RAISE EXCEPTION 'repair attempt cost is contradictory' USING ERRCODE='23514';
      END IF;
      cost:=cost+attempt_cost;
      total_latency:=total_latency+(source_attempt->>'latencyMilliseconds')::numeric;
      IF first_started IS NULL OR (source_attempt->>'startedAt')::timestamptz<first_started::timestamptz THEN first_started:=source_attempt->>'startedAt'; END IF;
      actual:=actual+ceil((attempt_cost+ceil(attempt_cost*n.operating_buffer_basis_points/10000))/n.credit_unit_micros);
      total_input:=total_input+(usage->>'inputUnits')::numeric;
      total_output:=total_output+(usage->>'outputUnits')::numeric;
    END LOOP;
    IF (e->>'latencyMilliseconds')::numeric IS DISTINCT FROM total_latency
      OR e->>'startedAt' IS DISTINCT FROM first_started
      OR (e->>'inputUnits')::numeric IS DISTINCT FROM total_input
      OR (e->>'outputUnits')::numeric IS DISTINCT FROM total_output
      OR (e->>'totalUnits')::numeric IS DISTINCT FROM total_input+total_output THEN
      RAISE EXCEPTION 'repair aggregate usage is contradictory' USING ERRCODE='23514';
    END IF;
  ELSIF terminal AND jsonb_array_length(source_result->'attempts')=1 THEN
    attempt:=e#>'{attempts,0}'; source_attempt:=source_result#>'{attempts,0}'; usage:=source_attempt->'usage';
    IF usage IS NULL OR usage='null'::jsonb OR jsonb_array_length(e->'attempts')<>1
      OR attempt-ARRAY['estimatedProviderCostMicros','pricingVersionId','normalizationPolicyVersionId'] IS DISTINCT FROM source_attempt
      OR attempt->>'attemptKind' IS DISTINCT FROM 'primary' OR attempt->>'attemptNumber' IS DISTINCT FROM '1'
      OR attempt->>'pricingVersionId' IS DISTINCT FROM p.pricing_version_id OR attempt->>'normalizationPolicyVersionId' IS DISTINCT FROM n.normalization_policy_version_id
    THEN RAISE EXCEPTION 'priced model attempt evidence is unavailable' USING ERRCODE='23514'; END IF;
    FOREACH field IN ARRAY ARRAY['inputUnits','outputUnits','cacheReadUnits','cacheWriteUnits','totalUnits','providerSpecificUnits'] LOOP
      IF e->field IS DISTINCT FROM usage->field THEN RAISE EXCEPTION 'model aggregate units differ from attempt' USING ERRCODE='23514'; END IF;
    END LOOP;
    IF ((usage->>'cacheReadUnits')::numeric>0 AND p.cache_read_micros_per_million_units IS NULL)
      OR ((usage->>'cacheWriteUnits')::numeric>0 AND p.cache_write_micros_per_million_units IS NULL) THEN
      RAISE EXCEPTION 'model cache usage is not priced' USING ERRCODE='23514'; END IF;
    raw_cost:=(usage->>'inputUnits')::numeric*p.input_micros_per_million_units+(usage->>'outputUnits')::numeric*p.output_micros_per_million_units
      +(usage->>'cacheReadUnits')::numeric*COALESCE(p.cache_read_micros_per_million_units,0)+(usage->>'cacheWriteUnits')::numeric*COALESCE(p.cache_write_micros_per_million_units,0);
    units_total:=(usage->>'inputUnits')::numeric+(usage->>'outputUnits')::numeric+(usage->>'cacheReadUnits')::numeric+(usage->>'cacheWriteUnits')::numeric;
    IF jsonb_array_length(usage->'providerSpecificUnits')>32 OR EXISTS(SELECT 1 FROM jsonb_array_elements(usage->'providerSpecificUnits') x GROUP BY x->>'unitName' HAVING count(*)<>1) THEN
      RAISE EXCEPTION 'model provider units are invalid' USING ERRCODE='23514'; END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(usage->'providerSpecificUnits') LOOP
      IF item-ARRAY['unitName','units']<>'{}'::jsonb OR (item->>'units')!~'^[0-9]+$' THEN RAISE EXCEPTION 'model provider units are invalid' USING ERRCODE='23514'; END IF;
      SELECT (value->>'microsPerMillionUnits')::numeric INTO rate FROM jsonb_array_elements(p.provider_specific_unit_rates) WHERE value->>'unitName'=item->>'unitName';
      IF rate IS NULL THEN RAISE EXCEPTION 'model provider units are not priced' USING ERRCODE='23514'; END IF;
      raw_cost:=raw_cost+(item->>'units')::numeric*rate;
    END LOOP;
    cost:=ceil(raw_cost/1000000); actual:=ceil((cost+ceil(cost*n.operating_buffer_basis_points/10000))/n.credit_unit_micros);
    IF units_total IS DISTINCT FROM (e->>'totalUnits')::numeric OR cost IS DISTINCT FROM (attempt->>'estimatedProviderCostMicros')::numeric THEN
      RAISE EXCEPTION 'model priced attempt totals are contradictory' USING ERRCODE='23514'; END IF;
  ELSIF jsonb_array_length(e->'attempts')<>0 OR e->'providerSpecificUnits'<>'[]'::jsonb
    OR (e->>'inputUnits')::numeric<>0 OR (e->>'outputUnits')::numeric<>0
    OR (e->>'cacheReadUnits')::numeric<>0 OR (e->>'cacheWriteUnits')::numeric<>0
    OR (e->>'totalUnits')::numeric<>0 THEN RAISE EXCEPTION 'unpriced model outcome must remain held' USING ERRCODE='23514'; END IF;
  charged:=CASE WHEN NEW.outcome_kind='settlement' THEN LEAST(actual,r.reserved_credit_units) ELSE 0 END;
  IF e->>'status' IS DISTINCT FROM (CASE WHEN NOT terminal THEN 'reconciliation-required'
      WHEN delivered THEN CASE WHEN actual>charged THEN 'compensated' ELSE 'completed' END
      WHEN source_result->>'status' IN ('provider-failure','timeout') THEN 'provider-failure'
      WHEN source_result->>'status'='cancelled' THEN 'cancelled' ELSE 'internal-failure' END)
    OR e->>'failureCategory' IS DISTINCT FROM (CASE WHEN NOT terminal THEN COALESCE(source_result->>'failureCategory','missing-provider-usage')
      WHEN delivered THEN CASE WHEN actual>charged THEN 'estimate-overrun' ELSE NULL END ELSE source_result->>'failureCategory' END)
  THEN RAISE EXCEPTION 'model terminal event status is contradictory' USING ERRCODE='23514'; END IF;
  IF response->'estimate' IS DISTINCT FROM w#>'{resolvedContext,estimateResult,estimate}'
    OR response->>'route' IS DISTINCT FROM e->>'route'
    OR response->>'routeLabel' IS DISTINCT FROM w#>>'{resolvedContext,selectedRoute,label}'
    OR response->>'routeExplanation' IS DISTINCT FROM w#>>'{resolvedContext,selectedRoute,explanation}'
    OR response->>'version' IS DISTINCT FROM '1' OR response->'denialReason' IS DISTINCT FROM 'null'::jsonb
    OR response->>'compensationStatus' IS DISTINCT FROM (CASE WHEN NOT terminal THEN 'pending' WHEN actual-charged>0 THEN 'applied' ELSE 'not-required' END)
    OR response->>'state' IS DISTINCT FROM (CASE WHEN NOT terminal THEN 'reconciliation-required' WHEN actual-charged>0 THEN 'compensated' WHEN delivered THEN 'completed' ELSE 'released' END)
    OR response->>'reconciliationState' IS DISTINCT FROM e->>'reconciliationState'
    OR response->'technicalUnits' IS DISTINCT FROM (CASE WHEN NOT terminal OR w#>>'{request,includeTechnicalUnitDetail}'<>'true' THEN 'null'::jsonb
      ELSE jsonb_build_object('inputUnits',e->'inputUnits','outputUnits',e->'outputUnits','cacheReadUnits',e->'cacheReadUnits','cacheWriteUnits',e->'cacheWriteUnits','totalUnits',e->'totalUnits','providerSpecificUnits',e->'providerSpecificUnits') END)
    OR e->>'eventId' IS DISTINCT FROM ((w#>>'{request,eventIdPrefix}')||'_'||(CASE WHEN terminal THEN NEW.outcome_kind ELSE 'reconciliation_required' END))
    OR e->>'idempotencyKey' IS DISTINCT FROM ((w#>>'{request,idempotencyKey}')||':'||(CASE WHEN terminal THEN NEW.outcome_kind ELSE 'reconciliation_required' END))
  THEN RAISE EXCEPTION 'model terminal response projection is contradictory' USING ERRCODE='23514'; END IF;
  IF (NEW.outcome_kind='settlement') IS DISTINCT FROM (terminal AND delivered)
    OR (NEW.outcome->>'actualCreditUnits')::numeric IS DISTINCT FROM actual OR (e->>'chargedCreditUnits')::numeric IS DISTINCT FROM charged
    OR (e->>'compensatedCreditUnits')::numeric IS DISTINCT FROM actual-charged OR (e->>'estimatedProviderCostMicros')::numeric IS DISTINCT FROM cost
    OR (terminal AND e->>'reconciliationState' IS DISTINCT FROM 'not-required')
    OR (NOT terminal AND (e->>'reconciliationState' IS DISTINCT FROM 'pending-missing-usage' OR response->>'completedCreditUnits' IS NOT NULL))
    OR (terminal AND (response->>'completedCreditUnits')::numeric IS DISTINCT FROM charged)
  THEN RAISE EXCEPTION 'canonical model terminal amount is contradictory' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
