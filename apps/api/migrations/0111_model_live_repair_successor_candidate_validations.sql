-- CloudMarkup additive migration 0111; fixed reviewed source closure.
-- Private additive proposal after exact 0071. Not registered for deployment.
-- Content-free validation of actual model repair bytes; no financial terminal.
CREATE TABLE model_live_repair_successor_candidate_validations_v4 (
  organization_id VARCHAR(128) NOT NULL, project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL, stage_id VARCHAR(128) NOT NULL,
  invocation_id VARCHAR(128) NOT NULL,
  receipt_id VARCHAR(128) NOT NULL CHECK(receipt_id ~ '^repair_successor_[a-f0-9]{64}$'),
  receipt_sha256 CHAR(64) NOT NULL CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'),
  receipt_record JSONB NOT NULL CHECK(jsonb_typeof(receipt_record)='object' AND octet_length(receipt_record::text)<=12288),
  outcome_sha256 CHAR(64) NOT NULL CHECK(outcome_sha256 ~ '^[a-f0-9]{64}$'),
  outcome_record JSONB NOT NULL CHECK(jsonb_typeof(outcome_record)='object' AND octet_length(outcome_record::text)<=8192),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,project_id,principal_id,stage_id),
  UNIQUE(organization_id,invocation_id), UNIQUE(organization_id,receipt_id),
  FOREIGN KEY(organization_id,project_id,principal_id,stage_id)
    REFERENCES model_live_repair_successor_observations_v4(organization_id,project_id,principal_id,stage_id)
);

CREATE FUNCTION enforce_model_live_repair_successor_candidate_validation_v4_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  source model_live_repair_successor_inputs_v4%ROWTYPE; observed model_live_repair_successor_observations_v4%ROWTYPE;
  p model_live_sequence_plans%ROWTYPE;
  prior model_live_sequence_candidate_validations%ROWTYPE;
  r JSONB:=NEW.receipt_record; o JSONB:=NEW.outcome_record; key TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT * INTO STRICT source FROM model_live_repair_successor_inputs_v4
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND stage_id=NEW.stage_id FOR SHARE;
  p:=require_current_model_live_sequence_plan(NEW.organization_id,NEW.project_id,NEW.principal_id,source.plan_sha256);
  SELECT * INTO STRICT observed FROM model_live_repair_successor_observations_v4
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND stage_id=NEW.stage_id FOR SHARE;
  SELECT * INTO STRICT prior FROM model_live_sequence_candidate_validations
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND stage_id=source.input_record#>>'{predecessor,stageId}' FOR SHARE;
  PERFORM model_live_sequence_metadata_object_v3(r,ARRAY['contractVersion','recordKind','receiptId','receiptDigest','scope','stageId','invocationId','inputBindingDigest','seedReceiptDigest','commercialAttemptObservationDigest','normalizedUsageDigest','providerResultDigest','configurationDigest','predecessorOutcomeDigest','predecessorValidationReceiptDigest','bindings','lineage','reportDigest','disposition','observedDefect','cleanup','startedAt','completedAt','issuedAt']);
  PERFORM model_live_sequence_metadata_object_v3(r->'scope',ARRAY['organizationId','projectId','userId','environment','plan']);
  PERFORM model_live_sequence_metadata_object_v3(r->'bindings',ARRAY['requestDigest','recipeDigest','solutionRevisionDigest','generationArtifactDigest','originalBuildContractDigest','baselineSourceDigest','sourceTreeDigest','extensionContentDigest','dependencyLockDigest','policyDigest','imageDigest','helperDigest','baseSeedRequestDigest','repairLineageDigest']);
  PERFORM model_live_sequence_metadata_object_v3(r->'lineage',ARRAY['baseDigest','inputDigest','invocationId','patchDigest','responseDigest','predecessorRequestDigest','predecessorReportDigest','predecessorLineageDigest']);
  PERFORM model_live_sequence_metadata_object_v3(o,ARRAY['contractVersion','parentSequenceContractVersion','selectionId','selectionDigest','planDigest','caseId','caseDigest','stageKey','stageId','invocationId','recordKind','outcomeDigest','observedAt','status','inputBindingDigest','dispatchDigest','normalizedUsageDigest','commercialAttemptObservationDigest','outputDigest','candidateDigest','validationReceiptDigest','validation']);
  PERFORM model_live_sequence_metadata_object_v3(o->'validation',ARRAY['status','repairable']);
  FOREACH key IN ARRAY ARRAY['receiptDigest','inputBindingDigest','seedReceiptDigest','commercialAttemptObservationDigest','normalizedUsageDigest','providerResultDigest','configurationDigest','reportDigest','predecessorOutcomeDigest','predecessorValidationReceiptDigest'] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(r->key,'digest');
  END LOOP;
  FOR key IN SELECT jsonb_object_keys(r->'bindings') LOOP
    PERFORM model_live_sequence_metadata_atom_v3(r#>ARRAY['bindings',key],'digest');
  END LOOP;
  FOREACH key IN ARRAY ARRAY['baseDigest','inputDigest','patchDigest','responseDigest'] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(r#>ARRAY['lineage',key],'digest');
  END LOOP;
  FOREACH key IN ARRAY ARRAY['selectionId','selectionDigest','planDigest','caseId','caseDigest','stageKey','stageId','invocationId','inputBindingDigest','dispatchDigest','normalizedUsageDigest'] LOOP
    IF (o->key=observed.observation_record->key) IS NOT TRUE THEN
      RAISE EXCEPTION 'candidate outcome must bind exact observed attempt' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF (
    source.invocation_id=NEW.invocation_id AND observed.invocation_id=NEW.invocation_id
    AND source.input_record->>'stageKey'='repair-2' AND observed.normalized_usage->>'result'='succeeded'
    AND r->'contractVersion'='2'::jsonb AND r->>'recordKind'='model-live-repair-successor-candidate-validation-receipt'
    AND r->'scope'=p.plan_record#>'{definition,scope}'
    AND r->>'stageId'=NEW.stage_id AND r->>'invocationId'=NEW.invocation_id
    AND r->>'receiptId'=NEW.receipt_id AND r->>'receiptDigest'='sha256:'||NEW.receipt_sha256
    AND r->'inputBindingDigest'=source.input_record->'inputBindingDigest'
    AND r->'seedReceiptDigest'=prior.receipt_record->'seedReceiptDigest'
    AND r->>'predecessorOutcomeDigest'='sha256:'||prior.outcome_sha256
    AND r->>'predecessorValidationReceiptDigest'='sha256:'||prior.receipt_sha256
    AND r->'predecessorOutcomeDigest'=source.input_record#>'{predecessor,outcomeDigest}'
    AND r->'predecessorValidationReceiptDigest'=source.input_record#>'{predecessor,validationReceiptDigest}'
    AND r#>'{lineage,baseDigest}'=prior.receipt_record#>'{bindings,extensionContentDigest}'
    AND r#>'{lineage,predecessorRequestDigest}'=prior.receipt_record#>'{bindings,requestDigest}'
    AND r#>'{lineage,predecessorReportDigest}'=prior.receipt_record->'reportDigest'
    AND r#>'{lineage,predecessorLineageDigest}'=prior.receipt_record#>'{bindings,repairLineageDigest}'
    AND observed.observation_record->'canonicalAttemptOrdinal'='2'::jsonb
    AND prior.receipt_record->>'disposition'='invalid-repairable'
    AND r->'commercialAttemptObservationDigest'=observed.observation_record->'observationDigest'
    AND r->'normalizedUsageDigest'=observed.observation_record->'normalizedUsageDigest'
    AND r#>'{lineage,inputDigest}'=source.input_record->'operationInputDigest'
    AND r#>>'{lineage,invocationId}'=NEW.invocation_id
    AND r->>'disposition' IN ('valid','invalid-nonrepairable')
    AND r->>'observedDefect' IN ('TS2322','none')
    AND (r->>'disposition'<>'valid' OR r->>'observedDefect'='none')
    AND r->>'cleanup'='verified'
    AND (r->>'startedAt')::timestamptz>=(observed.normalized_usage->>'completedAt')::timestamptz
    AND (r->>'startedAt')::timestamptz>=(observed.observation_record->>'observedAt')::timestamptz
    AND (r->>'completedAt')::timestamptz>=(r->>'startedAt')::timestamptz
    AND (r->>'issuedAt')::timestamptz>=(r->>'completedAt')::timestamptz
    AND (r->>'issuedAt')::timestamptz<=clock_timestamp()
    AND o->'contractVersion'='4'::jsonb AND o->'parentSequenceContractVersion'='3'::jsonb
    AND o->>'recordKind'='model-live-sequence-outcome' AND o->>'status'='validated'
    AND o->>'outcomeDigest'='sha256:'||NEW.outcome_sha256 AND o->'observedAt'=r->'issuedAt'
    AND o->'commercialAttemptObservationDigest'=r->'commercialAttemptObservationDigest'
    AND o->'outputDigest'=r#>'{lineage,responseDigest}' AND o->'candidateDigest'=r#>'{bindings,sourceTreeDigest}'
    AND o->'validationReceiptDigest'=r->'receiptDigest'
    AND o#>>'{validation,status}'=CASE WHEN r->>'disposition'='valid' THEN 'valid' ELSE 'invalid' END
    AND o#>'{validation,repairable}'='false'::jsonb
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'exact final-stage candidate validation metadata required' USING ERRCODE='23514';
  END IF;
  NEW.created_at:=clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_live_repair_successor_candidate_validation_v4_require_authority
  BEFORE INSERT ON model_live_repair_successor_candidate_validations_v4 FOR EACH ROW EXECUTE FUNCTION enforce_model_live_repair_successor_candidate_validation_v4_insert();

CREATE TRIGGER model_live_repair_successor_candidate_validations_v4_are_immutable
  BEFORE UPDATE OR DELETE ON model_live_repair_successor_candidate_validations_v4 FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
