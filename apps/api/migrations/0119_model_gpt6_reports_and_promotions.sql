-- CloudMarkup additive migration 0119; fixed reviewed source closure.
-- PROPOSAL ONLY. Local label 0080 is NOT a migration version.
-- Registered versions already end at 0098; integration owner must allocate 0099+.
-- Never replace/admit this label or alter historical SQL. Unregistered/unapplied.
-- Unapplied NEXT proposal. No report, promotion, grant or model activation is
-- installed by this migration. Publication is a distinct authenticated action.
CREATE TABLE model_gpt6_held_reports (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  plan_sha256 CHAR(64) NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  report_id VARCHAR(128) NOT NULL,
  report_sha256 CHAR(64) NOT NULL CHECK (report_sha256 ~ '^[a-f0-9]{64}$'),
  record_sha256 CHAR(64) NOT NULL CHECK (record_sha256 ~ '^[a-f0-9]{64}$'),
  record JSONB NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  operator_principal_id VARCHAR(128) NOT NULL,
  PRIMARY KEY (organization_id,project_id,principal_id,report_id),
  UNIQUE (organization_id,project_id,principal_id,report_id,report_sha256),
  UNIQUE (organization_id,project_id,principal_id,plan_sha256,report_id,report_sha256),
  FOREIGN KEY (organization_id,project_id,principal_id,plan_sha256)
    REFERENCES model_live_evaluation_plans (organization_id,project_id,principal_id,plan_sha256),
  CHECK ((octet_length(record::text)<=1048576 AND record->'contractVersion'='2'::JSONB
    AND record->>'recordKind'='issued-gpt6-held-report'
    AND record#>>'{report,evaluationReportId}'=report_id
    AND record#>>'{report,reportDigest}'='sha256:'||report_sha256
    AND record#>>'{report,activationRecommendation}'='hold'
    AND record#>'{report,capabilityActivated}'='false'::JSONB
    AND record#>>'{reference,planDigest}'='sha256:'||plan_sha256
    AND record->>'operatorPrincipalId'=operator_principal_id
    AND jsonb_typeof(record->'evidence')='array' AND jsonb_array_length(record->'evidence')=21
    AND (record->>'issuedAt')::TIMESTAMPTZ=issued_at) IS TRUE)
);

CREATE TRIGGER model_gpt6_held_reports_immutable BEFORE UPDATE OR DELETE ON model_gpt6_held_reports
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE model_gpt6_promotions (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  receipt_id VARCHAR(128) NOT NULL,
  receipt_sha256 CHAR(64) NOT NULL CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  plan_sha256 CHAR(64) NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  report_id VARCHAR(128) NOT NULL,
  report_sha256 CHAR(64) NOT NULL CHECK (report_sha256 ~ '^[a-f0-9]{64}$'),
  receipt JSONB NOT NULL,
  configuration JSONB NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at>issued_at),
  operator_principal_id VARCHAR(128) NOT NULL,
  PRIMARY KEY (organization_id,project_id,principal_id,receipt_id),
  UNIQUE (organization_id,project_id,principal_id,receipt_id,receipt_sha256),
  FOREIGN KEY (organization_id,project_id,principal_id,plan_sha256,report_id,report_sha256)
    REFERENCES model_gpt6_held_reports (organization_id,project_id,principal_id,plan_sha256,report_id,report_sha256),
  CHECK ((octet_length(receipt::text)<=131072 AND octet_length(configuration::text)<=131072
    AND receipt->'contractVersion'='2'::JSONB AND receipt->>'recordKind'='model-normal-gpt6-promotion-receipt'
    AND receipt->>'receiptId'=receipt_id AND receipt->>'receiptDigest'='sha256:'||receipt_sha256
    AND receipt->>'evaluationPlanDigest'='sha256:'||plan_sha256 AND receipt->>'reportId'=report_id
    AND receipt->>'reportDigest'='sha256:'||report_sha256
    AND receipt#>>'{scope,environment}' IN ('development','test','staging','production')
    AND receipt->>'evaluationEnvironment' IN ('development','staging')
    AND receipt#>>'{scope,organizationId}'=organization_id AND receipt#>>'{scope,projectId}'=project_id
    AND receipt#>>'{scope,userId}'=principal_id AND receipt->>'operatorPrincipalId'=operator_principal_id
    AND (receipt->>'issuedAt')::TIMESTAMPTZ=issued_at AND (receipt->>'expiresAt')::TIMESTAMPTZ=expires_at
    AND configuration->'contractVersion'='1'::JSONB) IS TRUE)
);

CREATE TRIGGER model_gpt6_promotions_immutable BEFORE UPDATE OR DELETE ON model_gpt6_promotions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE model_gpt6_promotion_revocations (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  receipt_id VARCHAR(128) NOT NULL,
  receipt_sha256 CHAR(64) NOT NULL CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  operator_principal_id VARCHAR(128) NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,project_id,principal_id,receipt_id),
  FOREIGN KEY (organization_id,project_id,principal_id,receipt_id,receipt_sha256)
    REFERENCES model_gpt6_promotions (organization_id,project_id,principal_id,receipt_id,receipt_sha256)
);

CREATE TRIGGER model_gpt6_promotion_revocations_immutable BEFORE UPDATE OR DELETE ON model_gpt6_promotion_revocations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE FUNCTION enforce_model_gpt6_publication_current_plan() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE p model_live_evaluation_plans%ROWTYPE; h model_gpt6_held_reports%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT * INTO p FROM model_live_evaluation_plans WHERE organization_id=NEW.organization_id
    AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND plan_sha256=NEW.plan_sha256 FOR SHARE;
  IF NOT FOUND OR p.issued_at>clock_timestamp() OR p.expires_at<=clock_timestamp()
    OR NEW.issued_at<p.issued_at OR NEW.issued_at>=p.expires_at OR NEW.issued_at>clock_timestamp()
    OR NEW.operator_principal_id<>p.operator_principal_id
    OR EXISTS(SELECT 1 FROM model_live_evaluation_revocations v WHERE v.organization_id=p.organization_id
      AND v.project_id=p.project_id AND v.principal_id=p.principal_id AND v.plan_sha256=p.plan_sha256)
  THEN RAISE EXCEPTION 'exact current issued evaluation approval required' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM memberships m JOIN principals u ON u.principal_id=m.principal_id AND u.lifecycle_status='active'
    JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=NEW.project_id AND pr.lifecycle_status='active'
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=NEW.operator_principal_id AND m.lifecycle_status='active'
      AND r.role_key='owner' AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key))
  THEN RAISE EXCEPTION 'current owner membership required' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='model_gpt6_promotions' THEN
    IF NEW.expires_at>p.expires_at
    THEN RAISE EXCEPTION 'promotion cannot extend evaluation approval' USING ERRCODE='23514'; END IF;
    SELECT * INTO h FROM model_gpt6_held_reports WHERE organization_id=NEW.organization_id
      AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND plan_sha256=NEW.plan_sha256
      AND report_id=NEW.report_id AND report_sha256=NEW.report_sha256 FOR SHARE;
    IF NOT FOUND OR NEW.receipt->>'evaluationAuthorityDigest'<>'sha256:'||p.approval_sha256
      OR NEW.receipt->>'evaluationEnvironment'<>p.plan_record#>>'{definition,scope,environment}'
      OR NEW.receipt->>'definitionId'<>p.definition_id
      OR NEW.receipt->>'datasetDigest'<>h.record#>>'{report,datasetDigest}'
      OR NEW.receipt->>'evaluationPolicyDigest'<>h.record#>>'{report,evaluationPolicyDigest}'
      OR h.record#>'{report,deterministicPassed}'<>'true'::jsonb
    THEN RAISE EXCEPTION 'exact passing held report and source approval required' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.record#>>'{report,liveEvaluationAuthorityDigest}'<>'sha256:'||p.approval_sha256
      OR NEW.record#>>'{reference,definitionId}'<>p.definition_id
      OR NEW.record#>>'{report,datasetDigest}'<>p.plan_record#>>'{definition,policy,evaluationRequirement,datasetDigest}'
    THEN RAISE EXCEPTION 'held report must bind its exact issued approval' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_gpt6_held_report_current_approval BEFORE INSERT ON model_gpt6_held_reports
  FOR EACH ROW EXECUTE FUNCTION enforce_model_gpt6_publication_current_plan();

CREATE TRIGGER model_gpt6_promotion_current_approval BEFORE INSERT ON model_gpt6_promotions
  FOR EACH ROW EXECUTE FUNCTION enforce_model_gpt6_publication_current_plan();

-- Exact revocation stays available after evaluation expiry. It still requires
-- the current scoped owner; application issuance additionally checks recent
-- verified authentication and the current configured operator allowlist.
CREATE FUNCTION enforce_model_gpt6_revocation_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  IF NEW.revoked_at>clock_timestamp() OR NOT EXISTS(SELECT 1 FROM memberships m
    JOIN principals u ON u.principal_id=m.principal_id AND u.lifecycle_status='active'
    JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=NEW.project_id AND pr.lifecycle_status='active'
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=NEW.operator_principal_id AND m.lifecycle_status='active'
      AND r.role_key='owner' AND r.policy_version='authorization-v2'
      AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key))
  THEN RAISE EXCEPTION 'exact revocation requires current scoped owner' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_gpt6_revocation_current_owner BEFORE INSERT ON model_gpt6_promotion_revocations
  FOR EACH ROW EXECUTE FUNCTION enforce_model_gpt6_revocation_owner();
