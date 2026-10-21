-- Operator approval metadata only. Frozen input and unaccepted output bytes
-- remain outside these tables. This does not reserve credits or runtime capacity.
CREATE TABLE model_live_evaluation_plans (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  operator_principal_id VARCHAR(128) NOT NULL,
  definition_id VARCHAR(128) NOT NULL CHECK (definition_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  definition_sha256 CHAR(64) NOT NULL CHECK (definition_sha256 ~ '^[a-f0-9]{64}$'),
  approval_sha256 CHAR(64) NOT NULL CHECK (approval_sha256 ~ '^[a-f0-9]{64}$'),
  plan_sha256 CHAR(64) NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  plan_id VARCHAR(128) NOT NULL CHECK (plan_id ~ '^live_plan_[a-f0-9]{32}$'),
  plan_record JSONB NOT NULL CHECK (jsonb_typeof(plan_record)='object' AND octet_length(plan_record::text)<=49152),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at>issued_at AND expires_at<=issued_at+INTERVAL '24 hours'),
  PRIMARY KEY (organization_id,project_id,principal_id,definition_id),
  UNIQUE (organization_id,project_id,principal_id,plan_sha256),
  UNIQUE (organization_id,plan_id),
  FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY (organization_id,principal_id) REFERENCES memberships(organization_id,principal_id),
  FOREIGN KEY (organization_id,operator_principal_id) REFERENCES memberships(organization_id,principal_id),
  CHECK ((plan_record ?& ARRAY['contractVersion','recordKind','planId','planDigest','definition','approval','issuedAt','expiresAt']
    AND plan_record - ARRAY['contractVersion','recordKind','planId','planDigest','definition','approval','issuedAt','expiresAt']='{}'::jsonb
    AND plan_record->'contractVersion'='2'::jsonb
    AND plan_record->>'recordKind'='model-live-evaluation-plan'
    AND plan_record->>'planId'=plan_id
    AND plan_record->>'planDigest'='sha256:'||plan_sha256
    AND (plan_record->>'issuedAt')::timestamptz=issued_at
    AND (plan_record->>'expiresAt')::timestamptz=expires_at
    AND plan_record#>>'{definition,definitionId}'=definition_id
    AND plan_record#>>'{definition,definitionDigest}'='sha256:'||definition_sha256
    AND plan_record#>'{definition,contractVersion}'='2'::jsonb
    AND plan_record#>>'{definition,recordKind}'='model-live-evaluation-definition'
    AND plan_record#>'{definition,normalCi}'='false'::jsonb
    AND plan_record#>>'{definition,scope,organizationId}'=organization_id
    AND plan_record#>>'{definition,scope,projectId}'=project_id
    AND plan_record#>>'{definition,scope,userId}'=principal_id
    AND plan_record#>>'{definition,scope,environment}' IN ('development','staging')
    AND plan_record#>'{definition,policy,contractVersion}'='2'::jsonb
    AND plan_record#>>'{definition,policy,recordKind}'='model-live-runtime-control-policy'
    AND plan_record#>>'{approval,approvalDigest}'='sha256:'||approval_sha256
    AND plan_record#>>'{approval,definitionDigest}'='sha256:'||definition_sha256
    AND plan_record#>>'{approval,operatorUserId}'=operator_principal_id
    AND plan_record#>'{approval,scope}'=plan_record#>'{definition,scope}'
    AND plan_record#>'{approval,contractVersion}'='2'::jsonb
    AND plan_record#>>'{approval,recordKind}'='model-live-evaluation-approval'
    AND (plan_record#>>'{approval,approvedAt}')::timestamptz<=issued_at
    AND (plan_record#>>'{approval,expiresAt}')::timestamptz>=expires_at
    AND (plan_record#>>'{definition,expiresAt}')::timestamptz>=expires_at) IS TRUE)
);
CREATE TABLE model_live_evaluation_revocations (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  plan_sha256 CHAR(64) NOT NULL,
  operator_principal_id VARCHAR(128) NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,project_id,principal_id,plan_sha256),
  FOREIGN KEY (organization_id,project_id,principal_id,plan_sha256)
    REFERENCES model_live_evaluation_plans(organization_id,project_id,principal_id,plan_sha256),
  FOREIGN KEY (organization_id,operator_principal_id) REFERENCES memberships(organization_id,principal_id)
);
CREATE FUNCTION enforce_model_live_evaluation_authority_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM 1 FROM memberships m
    JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
    JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
    JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=NEW.project_id AND pr.lifecycle_status='active'
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=NEW.principal_id AND m.lifecycle_status='active'
      AND NOT EXISTS(SELECT 1 FROM project_content_write_scopes f
        WHERE f.organization_id=pr.organization_id AND f.project_id=pr.project_id AND f.closed_at IS NOT NULL)
    FOR SHARE OF m,p,o,r,pr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'live evaluation requires an active authorized scope' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM memberships m
    JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.role_key='owner'
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=NEW.operator_principal_id AND m.lifecycle_status='active'
    FOR SHARE OF m,p,r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'live evaluation approval requires a current owner' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='model_live_evaluation_plans' THEN
    IF NEW.issued_at > clock_timestamp() OR NEW.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'live evaluation approval must be current at issuance' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER model_live_evaluation_plans_require_authority
  BEFORE INSERT ON model_live_evaluation_plans
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_evaluation_authority_insert();
CREATE TRIGGER model_live_evaluation_revocations_require_authority
  BEFORE INSERT ON model_live_evaluation_revocations
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_evaluation_authority_insert();
CREATE TRIGGER model_live_evaluation_plans_are_immutable
  BEFORE UPDATE OR DELETE ON model_live_evaluation_plans
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
CREATE TRIGGER model_live_evaluation_revocations_are_immutable
  BEFORE UPDATE OR DELETE ON model_live_evaluation_revocations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
COMMENT ON TABLE model_live_evaluation_plans IS
  'Immutable, scoped V2 evaluation-only approval metadata. Application issuance additionally requires verified Cognito, a configured platform operator and exact current frozen definition. Not report, runtime, credit or dispatch authority.';
COMMENT ON TABLE model_live_evaluation_revocations IS
  'Append-only revocation of one exact V2 evaluation approval. Cannot restore or change a plan.';
