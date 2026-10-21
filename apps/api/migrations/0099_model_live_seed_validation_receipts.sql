-- CloudMarkup additive migration 0099; fixed reviewed source closure.
-- Proposal only, after exact registered0059. Not part of runtime migration loading.
-- Immutable metadata is not native execution or tenant receipt issuance authority.
CREATE TABLE model_live_seed_validation_receipts (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  operator_principal_id VARCHAR(128) NOT NULL,
  case_id VARCHAR(128) NOT NULL CHECK (case_id IN (
    'evaluation_case_repair_success_full_beta_v1',
    'evaluation_case_repair_exhaustion_full_beta_v1'
  )),
  receipt_id VARCHAR(128) NOT NULL CHECK (receipt_id ~ '^seed_validation_[a-f0-9]{64}$'),
  receipt_sha256 CHAR(64) NOT NULL CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  configuration_sha256 CHAR(64) NOT NULL CHECK (configuration_sha256 ~ '^[a-f0-9]{64}$'),
  receipt_record JSONB NOT NULL CHECK (jsonb_typeof(receipt_record)='object' AND octet_length(receipt_record::text)<=8192),
  issued_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (organization_id,project_id,principal_id,receipt_id),
  UNIQUE (organization_id,project_id,principal_id,case_id,configuration_sha256),
  UNIQUE (organization_id,project_id,principal_id,receipt_sha256),
  FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY (organization_id,principal_id) REFERENCES memberships(organization_id,principal_id),
  FOREIGN KEY (organization_id,operator_principal_id) REFERENCES memberships(organization_id,principal_id)
);

CREATE FUNCTION enforce_model_live_seed_validation_metadata_insert() RETURNS TRIGGER AS $$
DECLARE record JSONB := NEW.receipt_record; key TEXT;
BEGIN
  PERFORM model_live_sequence_metadata_object_v3(record, ARRAY[
    'contractVersion','recordKind','receiptId','receiptDigest','scope','operatorUserId',
    'caseId','caseDigest','frozenInputDigest','datasetDigest','recipeId','recipeVersion',
    'sourceAuthority','variant','disposition','observedDefect','cleanup',
    'startedAt','completedAt','issuedAt','ownershipDigest','configurationDigest',
    'profileDigest','toolchainDigest','builderDigest','scannerDigest','bindings','reportDigest'
  ]);
  PERFORM model_live_sequence_metadata_object_v3(record->'scope', ARRAY[
    'organizationId','projectId','userId','environment','plan'
  ]);
  PERFORM model_live_sequence_metadata_object_v3(record->'bindings', ARRAY[
    'requestDigest','recipeDigest','solutionRevisionDigest','generationArtifactDigest',
    'originalBuildContractDigest','baselineSourceDigest','sourceTreeDigest',
    'extensionContentDigest','dependencyLockDigest','policyDigest','imageDigest','helperDigest'
  ]);
  FOREACH key IN ARRAY ARRAY[
    'receiptDigest','caseDigest','frozenInputDigest','datasetDigest','ownershipDigest',
    'configurationDigest','profileDigest','toolchainDigest','builderDigest','scannerDigest','reportDigest'
  ] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(record->key,'digest');
  END LOOP;
  FOR key IN SELECT jsonb_object_keys(record->'bindings') LOOP
    PERFORM model_live_sequence_metadata_atom_v3(record->'bindings'->key,'digest');
  END LOOP;
  FOREACH key IN ARRAY ARRAY['startedAt','completedAt','issuedAt'] LOOP
    IF (jsonb_typeof(record->key)='string' AND record->>key ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$') IS NOT TRUE
    THEN RAISE EXCEPTION 'canonical seed observation time required' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (
    record->'contractVersion'='1'::jsonb AND
    record->>'recordKind'='model-live-seed-validation-receipt' AND
    record->>'receiptId'=NEW.receipt_id AND
    record->>'receiptDigest'='sha256:'||NEW.receipt_sha256 AND
    record->>'configurationDigest'='sha256:'||NEW.configuration_sha256 AND
    record#>>'{scope,organizationId}'=NEW.organization_id AND
    record#>>'{scope,projectId}'=NEW.project_id AND
    record#>>'{scope,userId}'=NEW.principal_id AND
    record#>>'{scope,environment}' IN ('development','staging') AND
    record#>>'{scope,plan}' IN ('free','pro','team') AND
    record->>'operatorUserId'=NEW.operator_principal_id AND
    record->>'caseId'=NEW.case_id AND
    record->>'recipeId'='cloudmarkup.model-live.repair-seed.typescript-assignment' AND
    record->>'recipeVersion'='1.1.0' AND
    record->>'sourceAuthority'='fixed-host-synthetic' AND
    record->>'variant'='invalid-seed' AND
    record->>'disposition'='invalid-repairable' AND
    record->>'observedDefect'='TS2322' AND
    record->>'cleanup'='verified' AND
    (record->>'startedAt')::timestamptz <= (record->>'completedAt')::timestamptz AND
    (record->>'completedAt')::timestamptz <= NEW.issued_at AND
    (record->>'issuedAt')::timestamptz = NEW.issued_at AND
    NEW.issued_at >= date_trunc('milliseconds',transaction_timestamp()) AND
    NEW.issued_at <= clock_timestamp()
  ) IS NOT TRUE
  THEN RAISE EXCEPTION 'exact current seed validation metadata required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reuse the established org-then-scope locks, active tenant/project, canonical
-- capability and current-owner checks. Configured operator and real execution
-- checks remain responsibilities of the private authenticated host issuer.
CREATE TRIGGER model_live_seed_validation_require_authority
  BEFORE INSERT ON model_live_seed_validation_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_sequence_authority_insert();

CREATE TRIGGER model_live_seed_validation_require_metadata
  BEFORE INSERT ON model_live_seed_validation_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_seed_validation_metadata_insert();

CREATE TRIGGER model_live_seed_validation_are_immutable
  BEFORE UPDATE OR DELETE ON model_live_seed_validation_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
