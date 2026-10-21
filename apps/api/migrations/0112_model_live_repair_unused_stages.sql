-- CloudMarkup additive migration 0112; fixed reviewed source closure.
-- Private additive proposal after exact 0072; not registered for deployment.
-- Only immutable valid/nonrepairable first validation can prove an unused final stage.
CREATE TABLE model_live_repair_unused_stages_v4 (
  organization_id VARCHAR(128) NOT NULL, project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL, stage_id VARCHAR(128) NOT NULL,
  invocation_id VARCHAR(128) NOT NULL, predecessor_stage_id VARCHAR(128) NOT NULL,
  proof_sha256 CHAR(64) NOT NULL CHECK(proof_sha256 ~ '^[a-f0-9]{64}$'),
  proof_record JSONB NOT NULL CHECK(jsonb_typeof(proof_record)='object' AND octet_length(proof_record::text)<=8192),
  outcome_sha256 CHAR(64) NOT NULL CHECK(outcome_sha256 ~ '^[a-f0-9]{64}$'),
  outcome_record JSONB NOT NULL CHECK(jsonb_typeof(outcome_record)='object' AND octet_length(outcome_record::text)<=8192),
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(organization_id,project_id,principal_id,stage_id),
  UNIQUE(organization_id,invocation_id),
  FOREIGN KEY(organization_id,project_id,principal_id,predecessor_stage_id)
    REFERENCES model_live_sequence_candidate_validations(organization_id,project_id,principal_id,stage_id)
);

CREATE FUNCTION enforce_model_live_repair_unused_stage_v4_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  prior model_live_sequence_candidate_validations%ROWTYPE;
  selected model_live_sequence_selections%ROWTYPE;
  p model_live_sequence_plans%ROWTYPE;
  r JSONB:=NEW.proof_record; o JSONB:=NEW.outcome_record; stage JSONB; key TEXT; reason TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT * INTO STRICT prior FROM model_live_sequence_candidate_validations
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND stage_id=NEW.predecessor_stage_id FOR SHARE;
  p:=require_current_model_live_sequence_plan(NEW.organization_id,NEW.project_id,NEW.principal_id,substring(prior.outcome_record->>'planDigest' from 8));
  SELECT * INTO STRICT selected FROM model_live_sequence_selections
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND selection_id=prior.outcome_record->>'selectionId';
  SELECT value INTO STRICT stage FROM jsonb_array_elements(selected.selection_record->'stages')
    WHERE value->>'caseId'=prior.outcome_record->>'caseId' AND value->>'stageKey'='repair-2';
  reason:=CASE prior.receipt_record->>'disposition'
    WHEN 'valid' THEN 'predecessor-valid' WHEN 'invalid-nonrepairable' THEN 'predecessor-nonrepairable' END;
  PERFORM model_live_sequence_metadata_object_v3(r,ARRAY['contractVersion','recordKind','scope','selectionId','selectionDigest','planDigest','caseId','caseDigest','stageKey','stageId','invocationId','predecessorValidationReceiptDigest','predecessorOutcomeDigest','reason','observedAt']);
  PERFORM model_live_sequence_metadata_object_v3(o,ARRAY['contractVersion','parentSequenceContractVersion','recordKind','selectionId','selectionDigest','planDigest','caseId','caseDigest','stageKey','stageId','invocationId','outcomeDigest','status','reason','observedAt','noDispatchReceiptDigest']);
  FOREACH key IN ARRAY ARRAY['caseId','caseDigest','stageKey','stageId','invocationId'] LOOP
    IF (r->key=stage->key AND o->key=stage->key) IS NOT TRUE THEN
      RAISE EXCEPTION 'exact unused selected final stage required' USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['selectionId','selectionDigest','planDigest'] LOOP
    IF (r->key=prior.outcome_record->key AND o->key=prior.outcome_record->key) IS NOT TRUE THEN
      RAISE EXCEPTION 'exact predecessor selection required' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF (
    reason IS NOT NULL AND prior.outcome_record->>'stageKey'='repair-1'
    AND r->'contractVersion'='1'::jsonb AND r->>'recordKind'='model-live-final-stage-unused-proof'
    AND r->'scope'=p.plan_record#>'{definition,scope}'
    AND r->>'stageId'=NEW.stage_id AND r->>'invocationId'=NEW.invocation_id
    AND r->>'predecessorValidationReceiptDigest'='sha256:'||prior.receipt_sha256
    AND r->>'predecessorOutcomeDigest'='sha256:'||prior.outcome_sha256
    AND r->>'reason'=reason AND o->>'reason'=reason
    AND (r->>'observedAt')::timestamptz=NEW.observed_at AND o->'observedAt'=r->'observedAt'
    AND NEW.observed_at>=(prior.receipt_record->>'issuedAt')::timestamptz
    AND NEW.observed_at<=clock_timestamp()
    AND o->'contractVersion'='4'::jsonb AND o->'parentSequenceContractVersion'='3'::jsonb
    AND o->>'recordKind'='model-live-sequence-outcome' AND o->>'status'='not-dispatched'
    AND o->>'outcomeDigest'='sha256:'||NEW.outcome_sha256
    AND o->>'noDispatchReceiptDigest'='sha256:'||NEW.proof_sha256
    AND NOT EXISTS(SELECT 1 FROM model_live_repair_successor_inputs_v4 WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND stage_id=NEW.stage_id)
    AND NOT EXISTS(SELECT 1 FROM model_live_repair_successor_dispatches_v4 WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND stage_id=NEW.stage_id)
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'actual first validation and unused final stage required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_live_repair_unused_stages_v4_require_authority
  BEFORE INSERT ON model_live_repair_unused_stages_v4 FOR EACH ROW EXECUTE FUNCTION enforce_model_live_repair_unused_stage_v4_insert();

CREATE TRIGGER model_live_repair_unused_stages_v4_are_immutable
  BEFORE UPDATE OR DELETE ON model_live_repair_unused_stages_v4 FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
