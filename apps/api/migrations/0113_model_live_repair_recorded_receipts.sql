-- CloudMarkup additive migration 0113; fixed reviewed source closure.
-- Private additive proposal after exact 0073. Not registered for deployment.
-- Reconstruct only completely recorded evaluation metadata. No financial write,
-- current execution authority, new dispatch, source content or quality pass.
CREATE FUNCTION cloudmarkup_recorded_repair_receipt_v4(
  org TEXT, project TEXT, principal TEXT, workflow_scope TEXT,
  workflow_id_input TEXT, source_revision_input BIGINT
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
  final_validation model_live_repair_successor_candidate_validations_v4%ROWTYPE;
  unused model_live_repair_unused_stages_v4%ROWTYPE;
  final_stage TEXT; disposition TEXT; observed_at TEXT; dispatched_at TEXT;
  attempts JSONB; second_outcome JSONB; result_id TEXT; receipt_id TEXT;
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
  IF first_validation.stage_id IS NULL THEN RETURN NULL; END IF;
  IF (first_dispatch.workflow_id=workflow_id_input AND first_dispatch.workflow_scope_sha256=workflow_scope
    AND first_dispatch.runtime_scope_sha256=d.runtime_scope_sha256
    AND first_observation.observation_record->'canonicalWorkflowFingerprint'=w->'fingerprint'
    AND first_observation.normalized_usage->>'result'='succeeded') IS NOT TRUE THEN
    RAISE EXCEPTION 'repair result requires exact first attempt' USING ERRCODE='23514';
  END IF;
  disposition:=first_validation.receipt_record->>'disposition';
  SELECT * INTO unused FROM model_live_repair_unused_stages_v4
    WHERE organization_id=org AND project_id=project AND principal_id=principal AND stage_id=final_stage FOR SHARE;
  SELECT * INTO final_dispatch FROM model_live_repair_successor_dispatches_v4
    WHERE organization_id=org AND project_id=project AND principal_id=principal AND stage_id=final_stage FOR SHARE;
  IF disposition='invalid-repairable' THEN
    SELECT * INTO final_observation FROM model_live_repair_successor_observations_v4
      WHERE organization_id=org AND project_id=project AND principal_id=principal AND stage_id=final_stage FOR SHARE;
    SELECT * INTO final_validation FROM model_live_repair_successor_candidate_validations_v4
      WHERE organization_id=org AND project_id=project AND principal_id=principal AND stage_id=final_stage FOR SHARE;
    IF final_validation.stage_id IS NULL THEN RETURN NULL; END IF;
    IF (unused.stage_id IS NULL AND final_dispatch.workflow_id=workflow_id_input
      AND final_dispatch.workflow_scope_sha256=workflow_scope AND final_dispatch.runtime_scope_sha256=d.runtime_scope_sha256
      AND final_observation.observation_record->'canonicalWorkflowFingerprint'=w->'fingerprint'
      AND final_observation.normalized_usage->>'result'='succeeded'
      AND final_observation.canonical_attempt->>'retryOfAttemptId'=first_observation.canonical_attempt->>'attemptId') IS NOT TRUE THEN
      RAISE EXCEPTION 'repair result requires exact final attempt' USING ERRCODE='23514';
    END IF;
    second_outcome:=final_validation.outcome_record;
    observed_at:=second_outcome->>'observedAt';
  ELSE
    IF unused.stage_id IS NULL THEN RETURN NULL; END IF;
    IF (disposition IN ('valid','invalid-nonrepairable') AND final_dispatch.stage_id IS NULL
      AND unused.predecessor_stage_id=source.stage_id
      AND NOT EXISTS(SELECT 1 FROM model_live_repair_successor_inputs_v4
        WHERE organization_id=org AND project_id=project AND principal_id=principal AND stage_id=final_stage)) IS NOT TRUE THEN
      RAISE EXCEPTION 'repair result requires verified unused final stage' USING ERRCODE='23514';
    END IF;
    second_outcome:=unused.outcome_record;
    observed_at:=second_outcome->>'observedAt';
  END IF;
  dispatched_at:=w#>>'{dispatchIntent,recordedAt}';
  latency:=EXTRACT(EPOCH FROM (observed_at::timestamptz-dispatched_at::timestamptz))*1000;
  IF latency<0 OR latency>9007199254740991 OR observed_at::timestamptz>clock_timestamp() THEN
    RAISE EXCEPTION 'repair receipt host interval is unavailable' USING ERRCODE='23514';
  END IF;
  attempts:=jsonb_build_array(first_observation.canonical_attempt||jsonb_build_object(
    'startedAt',dispatched_at,'completedAt',observed_at,'latencyMilliseconds',latency));
  result_identity:='model-live-validated-repair-result-v4:'||(w->>'fingerprint')||':'||
    (first_validation.outcome_record->>'outcomeDigest')||':'||(second_outcome->>'outcomeDigest')||':'||
    (first_observation.observation_record->>'canonicalAttemptDigest');
  IF disposition='invalid-repairable' THEN
    attempts:=attempts||jsonb_build_array(final_observation.canonical_attempt||jsonb_build_object(
      'startedAt',dispatched_at,'completedAt',observed_at,'latencyMilliseconds',0));
    result_identity:=result_identity||':'||(final_observation.observation_record->>'canonicalAttemptDigest');
  END IF;
  result_id:='result_'||substr(encode(sha256(convert_to(result_identity,'UTF8')),'hex'),1,48);
  -- Exact canonical JSON of the host receipt identity's three string fields.
  receipt_identity:=E'{\n  "dispatchIntentId": '||to_jsonb(w#>>'{dispatchIntent,dispatchIntentId}')::text||
    E',\n  "receivedAt": '||to_jsonb(observed_at)::text||E',\n  "resultId": '||to_jsonb(result_id)::text||E'\n}\n';
  receipt_id:='receipt_'||substr(encode(sha256(convert_to(receipt_identity,'UTF8')),'hex'),1,48);
  RETURN jsonb_build_object(
    'dispatchIntentId',w#>>'{dispatchIntent,dispatchIntentId}','dispatchedAt',dispatched_at,
    'preDispatchProof',NULL,'receiptId',receipt_id,'receivedAt',observed_at,
    'result',jsonb_build_object('attempts',attempts,'completedAt',observed_at,
      'failureCategory',NULL,'resultId',result_id,'status','completed','usefulOutputDelivered',true));
END;
$$;
