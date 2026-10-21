-- Migration 0056: seal private evaluation invocation identities before execution.
-- Private metadata; no report/model activation or financial/content writes.
CREATE TABLE model_live_invocation_sets (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  plan_sha256 CHAR(64) NOT NULL CHECK(plan_sha256 ~ '^[a-f0-9]{64}$'),
  set_id VARCHAR(128) NOT NULL CHECK(set_id ~ '^live_set_[a-f0-9]{32}$'),
  set_sha256 CHAR(64) NOT NULL CHECK(set_sha256 ~ '^[a-f0-9]{64}$'),
  set_record JSONB NOT NULL CHECK(jsonb_typeof(set_record)='object' AND octet_length(set_record::text)<=32768),
  issued_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(organization_id,project_id,principal_id,plan_sha256),
  UNIQUE(organization_id,set_id),
  FOREIGN KEY(organization_id,project_id,principal_id,plan_sha256)
    REFERENCES model_live_evaluation_plans(organization_id,project_id,principal_id,plan_sha256),
  CHECK((set_record ?& ARRAY['contractVersion','recordKind','issuerId','issuerVersion','setId','setDigest','scope','definitionId','definitionDigest','planDigest','approvalDigest','issuedAt','entries']
    AND set_record - ARRAY['contractVersion','recordKind','issuerId','issuerVersion','setId','setDigest','scope','definitionId','definitionDigest','planDigest','approvalDigest','issuedAt','entries']='{}'::jsonb
    AND set_record->'contractVersion'='2'::jsonb
    AND set_record->>'recordKind'='model-live-invocation-set'
    AND set_record->>'issuerId'='cloudmarkup.model-live-invocation-set'
    AND set_record->>'issuerVersion'='1.0.0'
    AND set_record->>'setId'=set_id AND set_record->>'setDigest'='sha256:'||set_sha256
    AND set_record->>'planDigest'='sha256:'||plan_sha256
    AND set_record#>>'{scope,organizationId}'=organization_id
    AND set_record#>>'{scope,projectId}'=project_id
    AND set_record#>>'{scope,userId}'=principal_id
    AND (set_record->>'issuedAt')::timestamptz=issued_at
    AND jsonb_typeof(set_record->'entries')='array'
    AND jsonb_array_length(set_record->'entries') BETWEEN 1 AND 21) IS TRUE)
);
CREATE FUNCTION enforce_model_live_invocation_set_insert() RETURNS TRIGGER AS $$
DECLARE p model_live_evaluation_plans%ROWTYPE; c JSONB; e JSONB; i INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT * INTO p FROM model_live_evaluation_plans WHERE organization_id=NEW.organization_id
    AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND plan_sha256=NEW.plan_sha256 FOR SHARE;
  IF NOT FOUND OR p.issued_at>clock_timestamp() OR p.expires_at<=clock_timestamp()
    OR NEW.issued_at<p.issued_at OR NEW.issued_at>=p.expires_at OR NEW.issued_at>clock_timestamp()
    OR EXISTS(SELECT 1 FROM model_live_evaluation_revocations v WHERE v.organization_id=p.organization_id
      AND v.project_id=p.project_id AND v.principal_id=p.principal_id AND v.plan_sha256=p.plan_sha256)
    OR EXISTS(SELECT 1 FROM model_live_invocations j WHERE j.organization_id=p.organization_id
      AND j.project_id=p.project_id AND j.principal_id=p.principal_id
      AND j.binding->>'liveEvaluationPlanDigest'='sha256:'||p.plan_sha256)
  THEN RAISE EXCEPTION 'current unused plan required for invocation set' USING ERRCODE='23514'; END IF;
  FOR i IN 0..1 LOOP
    PERFORM 1 FROM memberships m
      JOIN principals u ON u.principal_id=m.principal_id AND u.lifecycle_status='active'
      JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN projects pr ON pr.organization_id=o.organization_id AND pr.project_id=NEW.project_id AND pr.lifecycle_status='active'
      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      WHERE m.organization_id=NEW.organization_id
      AND m.principal_id=CASE WHEN i=0 THEN NEW.principal_id ELSE p.operator_principal_id END
      AND m.lifecycle_status='active' AND r.policy_version='authorization-v2'
      AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
      AND (i=0 OR r.role_key='owner')
      AND NOT EXISTS(SELECT 1 FROM project_content_write_scopes f WHERE f.organization_id=pr.organization_id
        AND f.project_id=pr.project_id AND f.closed_at IS NOT NULL)
      FOR SHARE OF m,u,o,pr,r;
    IF NOT FOUND THEN RAISE EXCEPTION 'current invocation set membership required' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (NEW.set_record->'scope'=p.plan_record#>'{definition,scope}'
    AND NEW.set_record->>'definitionId'=p.definition_id
    AND NEW.set_record->>'definitionDigest'='sha256:'||p.definition_sha256
    AND NEW.set_record->>'approvalDigest'='sha256:'||p.approval_sha256
    AND jsonb_array_length(NEW.set_record->'entries')=jsonb_array_length(p.plan_record#>'{definition,cases}')) IS NOT TRUE
  THEN RAISE EXCEPTION 'exact invocation set plan binding required' USING ERRCODE='23514'; END IF;
  FOR i IN 0..jsonb_array_length(NEW.set_record->'entries')-1 LOOP
    e:=NEW.set_record->'entries'->i; c:=(p.plan_record#>'{definition,cases}')->i;
    IF (jsonb_typeof(e)='object' AND e ?& ARRAY['caseId','caseDigest','sourceInputDigest','authorityTupleDigest','invocationId']
      AND e - ARRAY['caseId','caseDigest','sourceInputDigest','authorityTupleDigest','invocationId']='{}'::jsonb
      AND e->'caseId'=c->'caseId' AND e->'caseDigest'=c->'caseDigest'
      AND e->'sourceInputDigest'=c->'sourceInputDigest'
      AND e->'authorityTupleDigest'=c#>'{authorityBinding,authorityTupleDigest}'
      AND e->>'invocationId' ~ '^invocation_[a-f0-9]{32}$') IS NOT TRUE
    THEN RAISE EXCEPTION 'exact ordered invocation set entry required' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT v->>'invocationId') FROM jsonb_array_elements(NEW.set_record->'entries') v)
    <>jsonb_array_length(NEW.set_record->'entries')
  THEN RAISE EXCEPTION 'unique selected invocation identities required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER model_live_invocation_sets_validate_insert BEFORE INSERT ON model_live_invocation_sets
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_invocation_set_insert();
CREATE TRIGGER model_live_invocation_sets_reject_mutation BEFORE UPDATE OR DELETE ON model_live_invocation_sets
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
CREATE FUNCTION enforce_model_live_selected_invocation_insert() RETURNS TRIGGER AS $$
DECLARE s JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT set_record INTO s FROM model_live_invocation_sets WHERE organization_id=NEW.organization_id
    AND project_id=NEW.project_id AND principal_id=NEW.principal_id
    AND 'sha256:'||plan_sha256=NEW.binding->>'liveEvaluationPlanDigest' FOR SHARE;
  IF FOUND AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'entries') e
    WHERE e->>'invocationId'=NEW.invocation_id AND e->'caseId'=NEW.binding->'evaluationCaseId'
      AND e->'caseDigest'=NEW.binding->'evaluationCaseDigest')
  THEN RAISE EXCEPTION 'invocation does not match immutable selected set' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER model_live_invocations_selected_set BEFORE INSERT ON model_live_invocations
  FOR EACH ROW EXECUTE FUNCTION enforce_model_live_selected_invocation_insert();
