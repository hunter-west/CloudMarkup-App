-- CloudMarkup additive migration 0123; fixed reviewed source closure.
-- PROPOSAL ONLY. Local label 0084 is NOT a migration version.
-- Registered versions already end at 0098; integration owner must allocate 0099+.
-- Never replace/admit this label or alter historical SQL. Unregistered/unapplied.
-- UNAPPLIED NEXT 0084. Requires 0080..0083 and existing canonical Beta tables.
-- Private metadata only. No IAM, grants, price install, model, upload or activation.
CREATE TABLE model_live_native_zero_receipts (
  organization_id VARCHAR(128) NOT NULL, project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL, plan_sha256 CHAR(64) NOT NULL,
  receipt_id VARCHAR(128) NOT NULL,receipt_sha256 CHAR(64) NOT NULL,
  record JSONB NOT NULL,issued_at TIMESTAMPTZ NOT NULL,operator_principal_id VARCHAR(128) NOT NULL,
  PRIMARY KEY(organization_id,project_id,principal_id,receipt_id),
  FOREIGN KEY(organization_id,project_id,principal_id,plan_sha256)
    REFERENCES model_live_evaluation_plans(organization_id,project_id,principal_id,plan_sha256),
  CHECK ((plan_sha256 ~ '^[a-f0-9]{64}$' AND receipt_sha256 ~ '^[a-f0-9]{64}$'
    AND octet_length(record::text)<=32768 AND record->'contractVersion'='3'::jsonb
    AND record->>'recordKind'='issued-model-live-native-zero' AND record->>'receiptId'=receipt_id
    AND record->>'receiptDigest'='sha256:'||receipt_sha256 AND record#>>'{reference,planDigest}'='sha256:'||plan_sha256
    AND record->>'operatorPrincipalId'=operator_principal_id AND (record->>'issuedAt')::TIMESTAMPTZ=issued_at
    AND record#>>'{caseResult,caseId}'='evaluation_case_supported_application_generation_full_beta_v1'
    AND record->'modelInvocations'='0'::jsonb AND record->'inputTokens'='0'::jsonb AND record->'outputTokens'='0'::jsonb
    AND record->'creditUnits'='0'::jsonb AND record->'estimatedMicroUsd'='0'::jsonb AND record->'commercialTerminal'='null'::jsonb) IS TRUE)
);

CREATE TRIGGER native_zero_immutable BEFORE UPDATE OR DELETE ON model_live_native_zero_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE FUNCTION enforce_native_zero_current_plan() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE p model_live_evaluation_plans%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT * INTO p FROM model_live_evaluation_plans WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
    AND principal_id=NEW.principal_id AND plan_sha256=NEW.plan_sha256 FOR SHARE;
  IF NOT FOUND OR p.expires_at<=clock_timestamp() OR NEW.issued_at<p.issued_at OR NEW.issued_at>=p.expires_at
    OR NEW.issued_at>clock_timestamp() OR NEW.operator_principal_id<>p.operator_principal_id
    OR NEW.record->>'approvalDigest'<>'sha256:'||p.approval_sha256
    OR EXISTS(SELECT 1 FROM model_live_evaluation_revocations v WHERE v.organization_id=p.organization_id
      AND v.project_id=p.project_id AND v.principal_id=p.principal_id AND v.plan_sha256=p.plan_sha256)
    OR NOT EXISTS(SELECT 1 FROM memberships m JOIN principals u ON u.principal_id=m.principal_id AND u.lifecycle_status='active'
      JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=NEW.project_id AND pr.lifecycle_status='active'
      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      WHERE m.organization_id=NEW.organization_id AND m.principal_id=NEW.operator_principal_id AND m.lifecycle_status='active'
        AND r.role_key='owner' AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key))
  THEN RAISE EXCEPTION 'actual current Standard native-only issuer authority required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER native_zero_current_plan BEFORE INSERT ON model_live_native_zero_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_native_zero_current_plan();

ALTER TABLE model_live_native_zero_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE model_live_native_zero_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY native_zero_exact_scope ON model_live_native_zero_receipts
  USING(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true))
  WITH CHECK(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true));

CREATE TABLE beta_gpt6_product_receipts (
  organization_id VARCHAR(128) NOT NULL,project_id VARCHAR(128) NOT NULL,principal_id VARCHAR(128) NOT NULL,job_id VARCHAR(128) NOT NULL,
  receipt_id VARCHAR(128) NOT NULL,receipt_sha256 CHAR(64) NOT NULL,reservation_id VARCHAR(128) NOT NULL,request_sha256 CHAR(64) NOT NULL,record JSONB NOT NULL,
  PRIMARY KEY(organization_id,project_id,principal_id,receipt_id),
  FOREIGN KEY(reservation_id) REFERENCES credit_reservations(reservation_id),
  CHECK ((receipt_sha256 ~ '^[a-f0-9]{64}$' AND request_sha256 ~ '^[a-f0-9]{64}$' AND octet_length(record::text)<=32768
    AND record->'contractVersion'='1'::jsonb AND record->>'recordKind'='issued-beta-gpt6-product-receipt'
    AND record->>'receiptId'=receipt_id AND record->>'receiptDigest'='sha256:'||receipt_sha256 AND record->>'wireDigest'='sha256:'||request_sha256
    AND record->>'organizationId'=organization_id AND record->>'projectId'=project_id AND record->>'userId'=principal_id AND record->>'jobId'=job_id
    AND record->>'product' IN ('beta-typed-application-planning-v1','beta-native-application-source-v1')
    AND record->'capabilityActivated'='false'::jsonb AND record->'attempts'='1'::jsonb AND record->>'effort'='medium') IS TRUE)
);

CREATE TRIGGER beta_gpt6_product_immutable BEFORE UPDATE OR DELETE ON beta_gpt6_product_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE FUNCTION enforce_beta_gpt6_product_canonical_terminal() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  IF NOT EXISTS(SELECT 1 FROM beta_ai_invocations i JOIN credit_reservations r ON r.organization_id=i.organization_id AND r.reservation_id=i.reservation_id
    JOIN usage_ledger_entries l ON l.organization_id=r.organization_id AND l.ledger_entry_id=r.terminal_ledger_entry_id AND l.reservation_id=r.reservation_id
    JOIN stored_objects o ON o.organization_id=i.organization_id AND o.project_id=i.project_id AND o.object_id=i.output_object_id AND o.content_sha256=i.output_sha256
    WHERE i.organization_id=NEW.organization_id AND i.project_id=NEW.project_id AND i.job_id=NEW.job_id AND i.reservation_id=NEW.reservation_id
      AND i.request_sha256=NEW.request_sha256 AND r.request_sha256=i.request_sha256 AND r.project_id=i.project_id AND r.job_id=i.job_id
      AND r.acting_principal_id=NEW.principal_id AND i.state='settled' AND r.status='settled' AND l.entry_kind='settlement'
      AND l.outcome='useful-output-delivered' AND o.lifecycle_state='published' AND i.output_object_id=NEW.record->>'outputObjectId'
      AND r.pricing_version_id=NEW.record->>'pricingVersionId' AND r.model_key=NEW.record->>'modelId' AND r.provider_key='openai'
      AND l.input_token_count=i.input_tokens AND l.output_token_count=i.output_tokens AND l.cached_input_token_count=0 AND i.cached_input_tokens=0
      AND i.provider_request_id=l.provider_request_id)
  THEN RAISE EXCEPTION 'independent product requires its actual canonical terminal and stored bytes' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER beta_gpt6_product_canonical_terminal BEFORE INSERT ON beta_gpt6_product_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_beta_gpt6_product_canonical_terminal();

ALTER TABLE beta_gpt6_product_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE beta_gpt6_product_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY beta_gpt6_product_exact_scope ON beta_gpt6_product_receipts
  USING(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true))
  WITH CHECK(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true));

-- Dormant shared native V2 READ boundary. No INSERT policy is installed here.
-- Notes owns the single producer/executor and must supply its reviewed issuer,
-- byte reopening, parser/profile/assets/cleanup/download proof before any write.
CREATE TABLE beta_native_shared_build_receipts (
  organization_id VARCHAR(128) NOT NULL,project_id VARCHAR(128) NOT NULL,principal_id VARCHAR(128) NOT NULL,job_id VARCHAR(128) NOT NULL,
  workload_id VARCHAR(128) NOT NULL,proposal_sha256 CHAR(64) NOT NULL,receipt_sha256 CHAR(64) NOT NULL,observation JSONB NOT NULL,
  PRIMARY KEY(organization_id,project_id,principal_id,job_id,proposal_sha256,workload_id),
  CHECK((proposal_sha256 ~ '^[a-f0-9]{64}$' AND receipt_sha256 ~ '^[a-f0-9]{64}$' AND octet_length(observation::text)<=32768
    AND observation->>'workloadId'=workload_id AND observation->>'proposalDigest'='sha256:'||proposal_sha256) IS TRUE)
);

CREATE TRIGGER beta_native_shared_build_immutable BEFORE UPDATE OR DELETE ON beta_native_shared_build_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

ALTER TABLE beta_native_shared_build_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE beta_native_shared_build_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY beta_native_shared_build_exact_read ON beta_native_shared_build_receipts FOR SELECT
  USING(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true));
