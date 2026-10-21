-- CloudMarkup additive migration 0100; fixed reviewed source closure.
-- Private proposal after exact 0060; not registered for runtime migration.
-- First fixed-host stage only. Metadata never grants inference or financial authority.
CREATE TABLE model_live_sequence_inputs (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  operator_principal_id VARCHAR(128) NOT NULL,
  plan_sha256 CHAR(64) NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  selection_id VARCHAR(128) NOT NULL,
  stage_id VARCHAR(128) NOT NULL CHECK (stage_id ~ '^live_stage_[a-f0-9]{32}$'),
  invocation_id VARCHAR(128) NOT NULL CHECK (invocation_id ~ '^invocation_[a-f0-9]{32}$'),
  input_sha256 CHAR(64) NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  model_configuration_sha256 CHAR(64) NOT NULL CHECK (model_configuration_sha256 ~ '^[a-f0-9]{64}$'),
  seed_configuration_sha256 CHAR(64) NOT NULL CHECK (seed_configuration_sha256 ~ '^[a-f0-9]{64}$'),
  input_record JSONB NOT NULL CHECK (jsonb_typeof(input_record)='object' AND octet_length(input_record::text)<=8192),
  issued_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (organization_id,project_id,principal_id,stage_id),
  UNIQUE (organization_id,invocation_id),
  UNIQUE (organization_id,project_id,principal_id,input_sha256),
  FOREIGN KEY (organization_id,selection_id,project_id,principal_id,plan_sha256)
    REFERENCES model_live_sequence_selections(organization_id,selection_id,project_id,principal_id,plan_sha256),
  FOREIGN KEY (organization_id,operator_principal_id) REFERENCES memberships(organization_id,principal_id)
);

CREATE FUNCTION enforce_model_live_sequence_input_insert() RETURNS TRIGGER AS $$
DECLARE p model_live_sequence_plans%ROWTYPE;
  s model_live_sequence_selections%ROWTYPE;
  seed model_live_seed_validation_receipts%ROWTYPE;
  r JSONB := NEW.input_record; c JSONB; stage JSONB; key TEXT;
BEGIN
  p:=require_current_model_live_sequence_plan(NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.plan_sha256);
  SELECT * INTO STRICT s FROM model_live_sequence_selections
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND principal_id=NEW.principal_id AND selection_id=NEW.selection_id AND plan_sha256=NEW.plan_sha256;
  PERFORM model_live_sequence_metadata_object_v3(r, ARRAY[
    'contractVersion','recordKind','selectionId','selectionDigest','planDigest','caseId','caseDigest',
    'stageKey','stageId','invocationId','inputBindingDigest','recipeDigest','authorityTupleDigest',
    'operationInputDigest','preparedPayloadDigest','diagnosticsDigest','revisionDigest','ownershipDigest','predecessor','issuedAt'
  ]);
  PERFORM model_live_sequence_metadata_object_v3(r->'predecessor', ARRAY['kind','candidateDigest','validationReceiptDigest']);
  FOREACH key IN ARRAY ARRAY['selectionDigest','planDigest','caseDigest','inputBindingDigest','recipeDigest','authorityTupleDigest',
    'operationInputDigest','preparedPayloadDigest','diagnosticsDigest','revisionDigest','ownershipDigest'] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(r->key,'digest');
  END LOOP;
  PERFORM model_live_sequence_metadata_atom_v3(r#>'{predecessor,candidateDigest}','digest');
  PERFORM model_live_sequence_metadata_atom_v3(r#>'{predecessor,validationReceiptDigest}','digest');
  SELECT value INTO STRICT stage FROM jsonb_array_elements(s.selection_record->'stages')
    WHERE value->>'stageId'=NEW.stage_id AND value->>'stageKey'='repair-1';
  SELECT value INTO STRICT c FROM jsonb_array_elements(p.plan_record#>'{definition,cases}')
    WHERE value->>'caseId'=stage->>'caseId';
  SELECT * INTO STRICT seed FROM model_live_seed_validation_receipts
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND case_id=stage->>'caseId' AND receipt_sha256=substring(c#>>'{seed,validationReceiptDigest}' from 8)
      AND configuration_sha256=NEW.seed_configuration_sha256;
  IF (
    r->'contractVersion'='3'::jsonb AND r->>'recordKind'='model-live-sequence-input' AND
    r->>'stageKey'='repair-1' AND r->>'stageId'=NEW.stage_id AND
    r->>'invocationId'=NEW.invocation_id AND r->>'invocationId'=stage->>'invocationId' AND
    r->>'selectionId'=NEW.selection_id AND r->>'selectionDigest'='sha256:'||s.selection_sha256 AND
    r->>'planDigest'='sha256:'||p.plan_sha256 AND r->>'inputBindingDigest'='sha256:'||NEW.input_sha256 AND
    r->>'caseId'=c->>'caseId' AND r->>'caseDigest'=c->>'caseDigest' AND r->>'caseDigest'=stage->>'caseDigest' AND
    r->>'recipeDigest'=c->>'recipeDigest' AND r->>'authorityTupleDigest'=c#>>'{authorityBinding,authorityTupleDigest}' AND
    r->>'revisionDigest'=c#>>'{seed,revisionDigest}' AND r->>'ownershipDigest'=c#>>'{seed,ownershipDigest}' AND
    r#>>'{predecessor,kind}'='seed' AND r#>>'{predecessor,candidateDigest}'=c#>>'{seed,candidateDigest}' AND
    r#>>'{predecessor,validationReceiptDigest}'='sha256:'||seed.receipt_sha256 AND
    c#>>'{seed,sourceDigest}'=seed.receipt_record#>>'{bindings,baselineSourceDigest}' AND
    c#>>'{seed,revisionDigest}'=seed.receipt_record#>>'{bindings,solutionRevisionDigest}' AND
    c#>>'{seed,candidateDigest}'=seed.receipt_record#>>'{bindings,sourceTreeDigest}' AND
    c#>>'{seed,ownershipDigest}'=seed.receipt_record->>'ownershipDigest' AND
    c#>>'{seed,validatorPolicyDigest}'=seed.receipt_record#>>'{bindings,policyDigest}' AND
    seed.issued_at<=p.issued_at AND
    jsonb_typeof(r->'issuedAt')='string' AND
    r->>'issuedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' AND
    (r->>'issuedAt')::timestamptz=NEW.issued_at AND NEW.issued_at>=s.issued_at AND
    NEW.issued_at>=date_trunc('milliseconds',transaction_timestamp()) AND NEW.issued_at<=clock_timestamp() AND
    NEW.issued_at<p.expires_at AND NOT EXISTS (
      SELECT 1 FROM model_live_invocations i WHERE i.organization_id=NEW.organization_id
        AND i.project_id=NEW.project_id AND i.principal_id=NEW.principal_id AND i.invocation_id=NEW.invocation_id
    )
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'exact current first-stage input metadata required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER model_live_sequence_input_require_authority
  BEFORE INSERT ON model_live_sequence_inputs FOR EACH ROW EXECUTE FUNCTION enforce_model_live_sequence_authority_insert();

CREATE TRIGGER model_live_sequence_input_require_metadata
  BEFORE INSERT ON model_live_sequence_inputs FOR EACH ROW EXECUTE FUNCTION enforce_model_live_sequence_input_insert();

CREATE TRIGGER model_live_sequence_inputs_are_immutable
  BEFORE UPDATE OR DELETE ON model_live_sequence_inputs FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
