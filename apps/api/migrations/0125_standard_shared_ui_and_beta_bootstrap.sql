-- CloudMarkup additive migration 0125; fixed reviewed source closure.
-- PROPOSAL ONLY, UNREGISTERED AND UNAPPLIED. Integration owner allocates 0099+
-- after Notes/service reconciliation; this filename has no migration version.
-- Requires the native-zero proposal and existing plan/runtime admission tables.
-- No grants, bypass roles, IAM, model calls, activation or customer route change.
-- Cognito authentication/configured operator checks happen in the closed host
-- issuer/revoker. FK/checksum/RLS alone cannot authenticate an issuer. Scoped
-- privileged SQL write admission remains a separate integration-owner review.

CREATE UNIQUE INDEX native_zero_exact_receipt_reference ON model_live_native_zero_receipts
  (organization_id,project_id,principal_id,receipt_id,receipt_sha256);

CREATE TABLE model_live_standard_ui_receipts (
  organization_id VARCHAR(128) NOT NULL,project_id VARCHAR(128) NOT NULL,principal_id VARCHAR(128) NOT NULL,
  plan_sha256 CHAR(64) NOT NULL,receipt_id VARCHAR(128) NOT NULL,receipt_sha256 CHAR(64) NOT NULL,
  native_receipt_id VARCHAR(128) NOT NULL,native_receipt_sha256 CHAR(64) NOT NULL,
  record JSONB NOT NULL,issued_at TIMESTAMPTZ NOT NULL,operator_principal_id VARCHAR(128) NOT NULL,
  PRIMARY KEY(organization_id,project_id,principal_id,receipt_id),
  FOREIGN KEY(organization_id,project_id,principal_id,plan_sha256)
    REFERENCES model_live_evaluation_plans(organization_id,project_id,principal_id,plan_sha256),
  FOREIGN KEY(organization_id,project_id,principal_id,native_receipt_id,native_receipt_sha256)
    REFERENCES model_live_native_zero_receipts(organization_id,project_id,principal_id,receipt_id,receipt_sha256),
  CHECK((receipt_sha256 ~ '^[a-f0-9]{64}$' AND octet_length(record::text)<=16384
    AND record->'contractVersion'='1'::jsonb AND record->>'recordKind'='issued-standard-shared-ui-evidence'
    AND record->>'uiReceiptId'=receipt_id AND record->>'uiReceiptDigest'='sha256:'||receipt_sha256
    AND record#>>'{reference,planDigest}'='sha256:'||plan_sha256
    AND record#>>'{nativeZero,planDigest}'='sha256:'||plan_sha256
    AND record#>>'{nativeZero,receiptId}'=native_receipt_id AND record#>>'{nativeZero,receiptDigest}'='sha256:'||native_receipt_sha256
    AND record->>'operatorPrincipalId'=operator_principal_id AND (record->>'issuedAt')::TIMESTAMPTZ=issued_at
    AND record#>>'{renderer,id}'='cloudmarkup.standard-native-review' AND record#>>'{renderer,version}'='1.0.0'
    AND jsonb_array_length(record->'semanticDigests')=2 AND record#>>'{semanticDigests,0}'=record#>>'{semanticDigests,1}'
    AND record->'browserExecutionVerified'='false'::jsonb) IS TRUE)
);

CREATE TRIGGER standard_ui_immutable BEFORE UPDATE OR DELETE ON model_live_standard_ui_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER standard_ui_current_plan BEFORE INSERT ON model_live_standard_ui_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_native_zero_current_plan();

CREATE FUNCTION enforce_standard_ui_origin() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE n model_live_native_zero_receipts%ROWTYPE;
BEGIN
  SELECT * INTO n FROM model_live_native_zero_receipts WHERE organization_id=NEW.organization_id
    AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND receipt_id=NEW.native_receipt_id
    AND receipt_sha256=NEW.native_receipt_sha256 AND plan_sha256=NEW.plan_sha256 FOR SHARE;
  IF (NOT FOUND OR n.record ? 'sharedUi' OR NEW.issued_at<n.issued_at
    OR NEW.record->>'sourceDigest'<>n.record->>'sourceDigest'
    OR NEW.record->>'nativeResultDigest'<>n.record->>'nativeResultDigest'
    OR NEW.record->>'configurationDigest'<>n.record->>'configurationDigest') IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION 'actual original Standard native receipt required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER standard_ui_origin BEFORE INSERT ON model_live_standard_ui_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_standard_ui_origin();

CREATE FUNCTION enforce_standard_native_ui_successor() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE n model_live_native_zero_receipts%ROWTYPE;u model_live_standard_ui_receipts%ROWTYPE;
BEGIN
  IF NOT NEW.record ? 'sharedUi' THEN RETURN NEW; END IF;
  SELECT * INTO u FROM model_live_standard_ui_receipts WHERE organization_id=NEW.organization_id
    AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND plan_sha256=NEW.plan_sha256
    AND receipt_id=NEW.record#>>'{sharedUi,reference,uiReceiptId}'
    AND 'sha256:'||receipt_sha256=NEW.record#>>'{sharedUi,reference,uiReceiptDigest}' FOR SHARE;
  IF (NOT FOUND OR NEW.issued_at<u.issued_at OR NEW.record#>'{sharedUi,nativeZero}'<>u.record->'nativeZero') IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION 'actual issued Standard UI reference required' USING ERRCODE='23514'; END IF;
  SELECT * INTO n FROM model_live_native_zero_receipts WHERE organization_id=NEW.organization_id
    AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND receipt_id=u.native_receipt_id
    AND receipt_sha256=u.native_receipt_sha256 AND plan_sha256=NEW.plan_sha256 FOR SHARE;
  IF (NOT FOUND OR n.record ? 'sharedUi' OR NEW.receipt_id=n.receipt_id
    OR (NEW.record-ARRAY['receiptId','receiptDigest','issuedAt','caseResult','sharedUi'])<>
       (n.record-ARRAY['receiptId','receiptDigest','issuedAt','caseResult','sharedUi'])
    OR (SELECT jsonb_agg(s) FROM jsonb_array_elements(NEW.record#>'{caseResult,scores}') s
      WHERE s->>'dimension'<>'same-ui-semantics-across-assistance-preferences')<>
       (SELECT jsonb_agg(s) FROM jsonb_array_elements(n.record#>'{caseResult,scores}') s
      WHERE s->>'dimension'<>'same-ui-semantics-across-assistance-preferences')) IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION 'Standard UI successor must preserve actual native facts' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER standard_native_ui_successor BEFORE INSERT ON model_live_native_zero_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_standard_native_ui_successor();

ALTER TABLE model_live_standard_ui_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE model_live_standard_ui_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY standard_ui_exact_scope ON model_live_standard_ui_receipts
  USING(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true))
  WITH CHECK(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true)
    AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true)
    AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true));

CREATE TABLE beta_gpt6_product_bootstrap_approvals (
  organization_id VARCHAR(128) NOT NULL,project_id VARCHAR(128) NOT NULL,principal_id VARCHAR(128) NOT NULL,
  approval_id VARCHAR(128) NOT NULL,document_sha256 CHAR(64) NOT NULL,plan_sha256 CHAR(64) NOT NULL,
  record_sha256 CHAR(64) NOT NULL,record JSONB NOT NULL,issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,operator_principal_id VARCHAR(128) NOT NULL,
  PRIMARY KEY(organization_id,project_id,principal_id,approval_id),
  FOREIGN KEY(organization_id,project_id,principal_id,plan_sha256)
    REFERENCES model_live_evaluation_plans(organization_id,project_id,principal_id,plan_sha256),
  CHECK((record_sha256 ~ '^[a-f0-9]{64}$' AND document_sha256 ~ '^[a-f0-9]{64}$' AND octet_length(record::text)<=16384
    AND record->'contractVersion'='1'::jsonb AND record->>'recordKind'='issued-private-beta-bootstrap-approval'
    AND record->>'approvalId'=approval_id AND record->>'recordDigest'='sha256:'||record_sha256
    AND record->>'documentDigest'='sha256:'||document_sha256
    AND record#>>'{document,documentDigest}'='sha256:'||document_sha256
    AND record#>>'{document,reference,planDigest}'='sha256:'||plan_sha256
    AND record#>>'{document,scope,organizationId}'=organization_id AND record#>>'{document,scope,projectId}'=project_id
    AND record#>>'{document,scope,userId}'=principal_id AND record->>'operatorPrincipalId'=operator_principal_id
    AND (record->>'issuedAt')::TIMESTAMPTZ=issued_at AND (record#>>'{document,expiresAt}')::TIMESTAMPTZ=expires_at
    AND issued_at>=(record#>>'{document,validFrom}')::TIMESTAMPTZ AND issued_at<expires_at
    AND expires_at-(record#>>'{document,validFrom}')::TIMESTAMPTZ<=interval '15 minutes'
    AND record#>>'{document,sourceKind}'='host-owned-review-required-synthetic-fixtures'
    AND record#>'{document,normalRouteAuthority}'='false'::jsonb AND record#>'{document,capabilityActivated}'='false'::jsonb
    AND jsonb_array_length(record#>'{document,requests}')=2
    AND (record#>>'{document,maximumInferenceMicroUsd}')::BIGINT BETWEEN 1 AND 50000000
    AND (record#>>'{document,maximumReservedInferenceMicroUsd}')::BIGINT BETWEEN 1 AND (record#>>'{document,maximumInferenceMicroUsd}')::BIGINT) IS TRUE)
);

CREATE TRIGGER beta_bootstrap_immutable BEFORE UPDATE OR DELETE ON beta_gpt6_product_bootstrap_approvals
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER beta_bootstrap_current_plan BEFORE INSERT ON beta_gpt6_product_bootstrap_approvals
  FOR EACH ROW EXECUTE FUNCTION enforce_native_zero_current_plan();

CREATE TABLE beta_gpt6_product_bootstrap_revocations (
  organization_id VARCHAR(128) NOT NULL,project_id VARCHAR(128) NOT NULL,principal_id VARCHAR(128) NOT NULL,
  approval_id VARCHAR(128) NOT NULL,revoked_at TIMESTAMPTZ NOT NULL,operator_principal_id VARCHAR(128) NOT NULL,
  PRIMARY KEY(organization_id,project_id,principal_id,approval_id),
  FOREIGN KEY(organization_id,project_id,principal_id,approval_id)
    REFERENCES beta_gpt6_product_bootstrap_approvals(organization_id,project_id,principal_id,approval_id)
);

CREATE TABLE beta_gpt6_product_bootstrap_dispatch_claims (
  organization_id VARCHAR(128) NOT NULL,project_id VARCHAR(128) NOT NULL,principal_id VARCHAR(128) NOT NULL,
  approval_id VARCHAR(128) NOT NULL,product VARCHAR(128) NOT NULL,job_id VARCHAR(128) NOT NULL,
  wire_sha256 CHAR(64) NOT NULL,approval_record_sha256 CHAR(64) NOT NULL,
  maximum_cost_micros BIGINT NOT NULL,claimed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(organization_id,project_id,principal_id,approval_id,product),
  FOREIGN KEY(organization_id,project_id,principal_id,approval_id)
    REFERENCES beta_gpt6_product_bootstrap_approvals(organization_id,project_id,principal_id,approval_id),
  CHECK(product IN ('beta-typed-application-planning-v1','beta-native-application-source-v1')
    AND wire_sha256 ~ '^[a-f0-9]{64}$' AND approval_record_sha256 ~ '^[a-f0-9]{64}$' AND maximum_cost_micros BETWEEN 1 AND 50000000)
);

CREATE TRIGGER beta_bootstrap_revocation_immutable BEFORE UPDATE OR DELETE ON beta_gpt6_product_bootstrap_revocations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER beta_bootstrap_claim_immutable BEFORE UPDATE OR DELETE ON beta_gpt6_product_bootstrap_dispatch_claims
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE FUNCTION enforce_beta_bootstrap_claim_or_revocation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE a beta_gpt6_product_bootstrap_approvals%ROWTYPE;p model_live_evaluation_plans%ROWTYPE;r JSONB; total BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('beta-bootstrap:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id||':'||NEW.approval_id,0));
  SELECT * INTO a FROM beta_gpt6_product_bootstrap_approvals WHERE organization_id=NEW.organization_id
    AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND approval_id=NEW.approval_id FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM memberships m JOIN principals u ON u.principal_id=m.principal_id AND u.lifecycle_status='active'
    JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=NEW.project_id AND pr.lifecycle_status='active'
    JOIN organization_roles roles ON roles.organization_id=m.organization_id AND roles.role_key=m.role_key
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=a.operator_principal_id AND m.lifecycle_status='active'
      AND roles.role_key='owner' AND roles.policy_version='authorization-v2' AND roles.capabilities=cloudmarkup_authorization_v2_permissions(roles.role_key))
  THEN RAISE EXCEPTION 'actual current owner required for private bootstrap' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='beta_gpt6_product_bootstrap_revocations' THEN
    IF NEW.operator_principal_id<>a.operator_principal_id OR NEW.revoked_at>clock_timestamp() OR NEW.revoked_at<a.issued_at
    THEN RAISE EXCEPTION 'exact bootstrap revocation operator required' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO p FROM model_live_evaluation_plans WHERE organization_id=a.organization_id AND project_id=a.project_id
    AND principal_id=a.principal_id AND plan_sha256=a.plan_sha256 FOR SHARE;
  IF (NOT FOUND OR p.expires_at<=clock_timestamp() OR a.expires_at<=clock_timestamp()
    OR clock_timestamp()<(a.record#>>'{document,validFrom}')::TIMESTAMPTZ OR NEW.claimed_at>clock_timestamp()
    OR NEW.claimed_at<a.issued_at OR NEW.claimed_at>=a.expires_at OR NEW.approval_record_sha256<>a.record_sha256
    OR a.record->>'approvalDigest'<>'sha256:'||p.approval_sha256 OR a.operator_principal_id<>p.operator_principal_id
    OR EXISTS(SELECT 1 FROM model_live_evaluation_revocations v WHERE v.organization_id=p.organization_id AND v.project_id=p.project_id AND v.principal_id=p.principal_id AND v.plan_sha256=p.plan_sha256)
    OR EXISTS(SELECT 1 FROM beta_gpt6_product_bootstrap_revocations v WHERE v.organization_id=a.organization_id AND v.project_id=a.project_id AND v.principal_id=a.principal_id AND v.approval_id=a.approval_id)) IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION 'current unrevoked exact bootstrap required' USING ERRCODE='23514'; END IF;
  SELECT x INTO r FROM jsonb_array_elements(a.record#>'{document,requests}') x WHERE x->>'product'=NEW.product;
  SELECT sum((x->>'maximumCostMicroUsd')::BIGINT) INTO total FROM jsonb_array_elements(a.record#>'{document,requests}') x;
  IF (r IS NULL OR NOT (r ?& ARRAY['product','jobId','wireDigest','maximumCostMicroUsd','maximumPhysicalAttempts','maximumOutputTokens','bodyBytes'])
    OR r->>'jobId'<>NEW.job_id OR r->>'wireDigest'<>'sha256:'||NEW.wire_sha256
    OR (r->>'maximumCostMicroUsd')::BIGINT<>NEW.maximum_cost_micros OR r->>'maximumPhysicalAttempts'<>'1'
    OR (r->>'maximumOutputTokens')::BIGINT NOT BETWEEN 1 AND 16384 OR (r->>'bodyBytes')::BIGINT NOT BETWEEN 1 AND 524288
    OR total<>(a.record#>>'{document,maximumReservedInferenceMicroUsd}')::BIGINT
    OR total>(a.record#>>'{document,maximumInferenceMicroUsd}')::BIGINT) IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION 'exact reviewed body and budget required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER beta_bootstrap_claim_admission BEFORE INSERT ON beta_gpt6_product_bootstrap_dispatch_claims
  FOR EACH ROW EXECUTE FUNCTION enforce_beta_bootstrap_claim_or_revocation();

CREATE TRIGGER beta_bootstrap_revocation_admission BEFORE INSERT ON beta_gpt6_product_bootstrap_revocations
  FOR EACH ROW EXECUTE FUNCTION enforce_beta_bootstrap_claim_or_revocation();

ALTER TABLE beta_gpt6_product_bootstrap_approvals ENABLE ROW LEVEL SECURITY;

ALTER TABLE beta_gpt6_product_bootstrap_approvals FORCE ROW LEVEL SECURITY;

ALTER TABLE beta_gpt6_product_bootstrap_revocations ENABLE ROW LEVEL SECURITY;

ALTER TABLE beta_gpt6_product_bootstrap_revocations FORCE ROW LEVEL SECURITY;

ALTER TABLE beta_gpt6_product_bootstrap_dispatch_claims ENABLE ROW LEVEL SECURITY;

ALTER TABLE beta_gpt6_product_bootstrap_dispatch_claims FORCE ROW LEVEL SECURITY;

CREATE POLICY beta_bootstrap_approval_exact_scope ON beta_gpt6_product_bootstrap_approvals
  USING(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true) AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true) AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true))
  WITH CHECK(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true) AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true) AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true));

CREATE POLICY beta_bootstrap_revocation_exact_scope ON beta_gpt6_product_bootstrap_revocations
  USING(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true) AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true) AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true))
  WITH CHECK(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true) AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true) AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true));

CREATE POLICY beta_bootstrap_claim_exact_scope ON beta_gpt6_product_bootstrap_dispatch_claims
  USING(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true) AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true) AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true))
  WITH CHECK(organization_id=current_setting('cloudmarkup.product_receipt.organization_id',true) AND project_id=current_setting('cloudmarkup.product_receipt.project_id',true) AND principal_id=current_setting('cloudmarkup.product_receipt.principal_id',true));
