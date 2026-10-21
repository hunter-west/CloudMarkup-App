-- Add the fixed current bounded-refusal validators without changing historical receipts,
-- accounting, tenant checks, immutable storage or required evidence bindings.
CREATE OR REPLACE FUNCTION cloudmarkup_live_proposal_assessment_shape(r JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE f TEXT; m JSONB; v JSONB; n NUMERIC; d NUMERIC; semantic_count INTEGER; dimensions TEXT[]; intent BOOLEAN; private_vpc BOOLEAN; questions BOOLEAN; bounded BOOLEAN;
BEGIN
  intent := r->>'recordKind'='model-live-intent-case-assessment' AND r->>'validatorId'='cloudmarkup.live-intent-case-validator.v2' AND r->>'validatorVersion'='2.2.0';
  private_vpc := r->>'recordKind'='model-live-private-vpc-case-assessment' AND r->>'validatorId'='cloudmarkup.live-private-vpc-case-validator.v2' AND r->>'validatorVersion'='2.3.0';
  questions := r->>'recordKind'='model-live-questions-case-assessment' AND r->>'validatorId'='cloudmarkup.live-questions-case-validator.v2' AND r->>'validatorVersion'='2.4.0';
  bounded := r->>'recordKind'='model-live-bounded-refusal-case-assessment' AND r->>'validatorId'='cloudmarkup.live-bounded-refusal-case-validator.v2' AND r->>'validatorVersion'='2.5.0' AND r->>'caseId' IN ('evaluation_case_nonexistent_unsupported_services_full_beta_v1','evaluation_case_excessive_resource_request_full_beta_v1');
  dimensions := CASE WHEN bounded THEN ARRAY['structured-schema-validity','security-policy-violations','graph-workload-external-rule-violations','issue-clarity-correct-severity','unresolved-behavior-honesty','same-ui-semantics-across-assistance-preferences'] || CASE WHEN r->>'caseId'='evaluation_case_nonexistent_unsupported_services_full_beta_v1' THEN ARRAY['unsupported-service-field-rate'] ELSE ARRAY[]::text[] END WHEN private_vpc THEN ARRAY['structured-schema-validity','capability-requirement-coverage','unsupported-service-field-rate','graph-workload-external-rule-violations','security-policy-violations','issue-clarity-correct-severity','unresolved-behavior-honesty','same-ui-semantics-across-assistance-preferences'] WHEN intent OR questions THEN ARRAY['structured-schema-validity','security-policy-violations','capability-requirement-coverage','issue-clarity-correct-severity','unresolved-behavior-honesty','same-ui-semantics-across-assistance-preferences'] ELSE ARRAY['structured-schema-validity','security-policy-violations','issue-clarity-correct-severity','same-ui-semantics-across-assistance-preferences'] END;
  IF (jsonb_typeof(r)='object' AND
    r ?& ARRAY['contractVersion','recordKind','validatorId','validatorVersion','assessmentDigest','caseId','caseDigest','sourceInputDigest','inputDigest','outputDigest','proposalDigest','measurements','assistancePreferenceSemantics'] AND
    r-ARRAY['contractVersion','recordKind','validatorId','validatorVersion','assessmentDigest','caseId','caseDigest','sourceInputDigest','inputDigest','outputDigest','proposalDigest','measurements','assistancePreferenceSemantics']='{}'::jsonb AND
    r->'contractVersion'='2'::jsonb AND
    (intent OR private_vpc OR questions OR bounded OR (r->>'recordKind'='model-live-proposal-case-assessment' AND
      r->>'validatorId'='cloudmarkup.live-proposal-case-validator.v2' AND r->>'validatorVersion' IN ('2.0.0','2.1.0'))) AND
    r->>'caseId' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' AND
    jsonb_typeof(r->'measurements')='array' AND jsonb_typeof(r->'assistancePreferenceSemantics')='array') IS NOT TRUE THEN RETURN FALSE; END IF;
  FOREACH f IN ARRAY ARRAY['assessmentDigest','caseDigest','sourceInputDigest','inputDigest','outputDigest','proposalDigest'] LOOP
    IF (jsonb_typeof(r->f)='string' AND r->>f ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE THEN RETURN FALSE; END IF;
  END LOOP;
  IF jsonb_array_length(r->'measurements')<>array_length(dimensions,1) OR jsonb_array_length(r->'assistancePreferenceSemantics')<>2 OR
    (SELECT count(DISTINCT x->>'dimension') FROM jsonb_array_elements(r->'measurements') x)<>array_length(dimensions,1) OR
    (SELECT count(DISTINCT x->>'assistancePreference') FROM jsonb_array_elements(r->'assistancePreferenceSemantics') x)<>2 THEN RETURN FALSE; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(r->'assistancePreferenceSemantics') LOOP
    IF (jsonb_typeof(v)='object' AND v ?& ARRAY['assistancePreference','semanticDigest'] AND
      v-ARRAY['assistancePreference','semanticDigest']='{}'::jsonb AND
      v->>'assistancePreference' IN ('guided','professional') AND
      jsonb_typeof(v->'semanticDigest')='string' AND v->>'semanticDigest' ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE THEN RETURN FALSE; END IF;
  END LOOP;
  SELECT count(DISTINCT x->>'semanticDigest') INTO semantic_count FROM jsonb_array_elements(r->'assistancePreferenceSemantics') x;
  FOR m IN SELECT value FROM jsonb_array_elements(r->'measurements') LOOP
    IF (jsonb_typeof(m)='object' AND m ?& ARRAY['denominator','dimension','evidenceDigests','numerator','sourceAuthority'] AND
      m-ARRAY['denominator','dimension','evidenceDigests','numerator','sourceAuthority']='{}'::jsonb AND
      m->>'sourceAuthority'='deterministic-evaluation-v1' AND
      m->>'dimension'=ANY(dimensions) AND
      jsonb_typeof(m->'denominator')='number' AND jsonb_typeof(m->'numerator')='number' AND
      jsonb_typeof(m->'evidenceDigests')='array') IS NOT TRUE THEN RETURN FALSE; END IF;
    n:=(m->>'numerator')::numeric; d:=(m->>'denominator')::numeric;
    IF n<0 OR n>d OR d<1 OR d>1000000000 OR n<>trunc(n) OR d<>trunc(d) OR
      jsonb_array_length(m->'evidenceDigests') NOT BETWEEN 1 AND 256 OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(m->'evidenceDigests') x GROUP BY x HAVING count(*)>1) THEN RETURN FALSE; END IF;
    FOR v IN SELECT value FROM jsonb_array_elements(m->'evidenceDigests') LOOP
      IF (jsonb_typeof(v)='string' AND v#>>'{}' ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE THEN RETURN FALSE; END IF;
    END LOOP;
    IF m->>'dimension'='structured-schema-validity' AND (n<>1 OR d<>1) THEN RETURN FALSE; END IF;
    IF m->>'dimension'='issue-clarity-correct-severity' AND d<>(CASE WHEN intent THEN 3 WHEN questions THEN 4 ELSE 1 END) THEN RETURN FALSE; END IF;
    IF private_vpc AND ((m->>'dimension'='capability-requirement-coverage' AND d<>13) OR
      (m->>'dimension'='unresolved-behavior-honesty' AND d<>1)) THEN RETURN FALSE; END IF;
    IF questions AND ((m->>'dimension' IN ('capability-requirement-coverage','issue-clarity-correct-severity') AND d<>4) OR
      (m->>'dimension' IN ('security-policy-violations','unresolved-behavior-honesty') AND d<>1)) THEN RETURN FALSE; END IF;
    IF bounded AND m->>'dimension'='unresolved-behavior-honesty' AND d<>1 THEN RETURN FALSE; END IF;
    IF intent AND ((m->>'dimension'='capability-requirement-coverage' AND d<>16) OR
      (m->>'dimension' IN ('security-policy-violations','unresolved-behavior-honesty') AND d<>1)) THEN RETURN FALSE; END IF;
    IF m->>'dimension'='same-ui-semantics-across-assistance-preferences' AND
      (d<>1 OR n<>CASE WHEN semantic_count=1 THEN 1 ELSE 0 END OR
       jsonb_array_length(m->'evidenceDigests')<>semantic_count OR
       EXISTS(SELECT 1 FROM jsonb_array_elements(r->'assistancePreferenceSemantics') x
         WHERE NOT (m->'evidenceDigests') @> jsonb_build_array(x->'semanticDigest'))) THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION validate_model_live_proposal_validation_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE j model_live_invocations%ROWTYPE; p model_live_evaluation_plans%ROWTYPE;
  i model_live_runtime_host_evidence%ROWTYPE; o model_live_runtime_host_evidence%ROWTYPE; s model_live_runtime_host_evidence%ROWTYPE;
  b JSONB; a JSONB; r JSONB; w JSONB;
BEGIN
  NEW.created_at:=clock_timestamp();
  r:=NEW.receipt_record;
  PERFORM 1 FROM memberships m
    JOIN principals pr ON pr.principal_id=m.principal_id AND pr.lifecycle_status='active'
    JOIN organizations org ON org.organization_id=m.organization_id AND org.lifecycle_status='active'
    JOIN organization_roles role ON role.organization_id=m.organization_id AND role.role_key=m.role_key
      AND role.policy_version='authorization-v2' AND role.capabilities=cloudmarkup_authorization_v2_permissions(role.role_key)
      AND role.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
    JOIN projects pj ON pj.organization_id=m.organization_id AND pj.project_id=NEW.project_id AND pj.lifecycle_status='active'
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=NEW.principal_id AND m.lifecycle_status='active'
      AND NOT EXISTS(SELECT 1 FROM project_content_write_scopes f WHERE f.organization_id=pj.organization_id AND f.project_id=pj.project_id AND f.closed_at IS NOT NULL)
    FOR SHARE OF m,pr,org,role,pj;
  IF NOT FOUND THEN RAISE EXCEPTION 'live case validation requires active scope authority' USING ERRCODE='23514'; END IF;
  SELECT * INTO p FROM model_live_evaluation_plans WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
    AND principal_id=NEW.principal_id AND 'sha256:'||plan_sha256=r->>'planDigest' FOR SHARE;
  IF NOT FOUND OR p.issued_at>clock_timestamp() OR p.expires_at<=clock_timestamp() OR EXISTS(
    SELECT 1 FROM model_live_evaluation_revocations v WHERE v.organization_id=NEW.organization_id AND v.project_id=NEW.project_id
      AND v.principal_id=NEW.principal_id AND v.plan_sha256=p.plan_sha256)
    THEN RAISE EXCEPTION 'live case validation requires current issued approval' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM memberships m JOIN principals pr ON pr.principal_id=m.principal_id AND pr.lifecycle_status='active'
    JOIN organization_roles role ON role.organization_id=m.organization_id AND role.role_key=m.role_key
      AND role.policy_version='authorization-v2' AND role.capabilities=cloudmarkup_authorization_v2_permissions(role.role_key) AND role.role_key='owner'
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=p.operator_principal_id AND m.lifecycle_status='active'
    FOR SHARE OF m,pr,role;
  IF NOT FOUND THEN RAISE EXCEPTION 'live case validation requires current approving ownership' USING ERRCODE='23514'; END IF;
  SELECT * INTO j FROM model_live_invocations WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
    AND principal_id=NEW.principal_id AND invocation_id=NEW.invocation_id FOR SHARE;
  SELECT c INTO b FROM jsonb_array_elements(p.plan_record#>'{definition,cases}') c WHERE c->>'caseId'=r#>>'{assessment,caseId}';
  SELECT runtime.snapshot->'request' INTO a FROM model_runtime_admissions runtime
    WHERE runtime.organization_id=NEW.organization_id AND runtime.project_id=NEW.project_id AND runtime.principal_id=NEW.principal_id
      AND runtime.snapshot#>'{request,requestDigest}'=j.binding->'runtimeRequestDigest'
      AND runtime.lease_expires_at>clock_timestamp() AND runtime.snapshot#>'{executionLease,recoveryOnly}'='false'::jsonb
      AND runtime.snapshot->'recoveryRequired'='false'::jsonb FOR SHARE;
  SELECT workflow.snapshot INTO w FROM model_commercial_workflows workflow
    JOIN model_commercial_reservation_decisions decision ON decision.organization_id=workflow.organization_id
      AND decision.scope_sha256=workflow.scope_sha256 AND decision.workflow_id=workflow.workflow_id
      AND decision.accepted AND decision.mapping_version='live-evaluation-runtime-windows-v2'
    JOIN credit_reservations credit ON credit.organization_id=decision.organization_id
      AND credit.reservation_id=decision.canonical_reservation_id AND credit.status='active'
    WHERE workflow.organization_id=NEW.organization_id AND workflow.project_id=NEW.project_id AND workflow.principal_id=NEW.principal_id
      AND workflow.workflow_id=j.workflow_id AND workflow.scope_sha256=j.scope_sha256
      AND workflow.lease_expires_at>clock_timestamp() FOR SHARE OF workflow,decision,credit;
  IF (j.gateway_state='complete' AND j.normalized_usage->>'result'='succeeded' AND j.generation_evidence->>'status'='completed'
    AND j.binding->'runtimeRequestDigest'=r->'runtimeRequestDigest'
    AND j.binding->'liveEvaluationPlanDigest'=r->'planDigest' AND j.binding->'liveEvaluationAuthorityDigest'=r->'approvalDigest'
    AND 'sha256:'||j.binding_sha256=r->>'journalBindingDigest' AND 'sha256:'||p.approval_sha256=r->>'approvalDigest'
    AND j.binding->'evaluationCaseId'=r#>'{assessment,caseId}' AND j.binding->'evaluationCaseDigest'=r#>'{assessment,caseDigest}'
    AND j.binding->'inputDigest'=r#>'{assessment,inputDigest}' AND 'sha256:'||j.output_sha256=r#>>'{assessment,outputDigest}'
    AND b->'caseDigest'=r#>'{assessment,caseDigest}' AND b->'sourceInputDigest'=r#>'{assessment,sourceInputDigest}'
    AND b->'invocationInputDigest'=r#>'{assessment,inputDigest}'
    AND ((b#>>'{authorityBinding,authorityTuple,operation}'='operations.propose'
      AND r#>>'{assessment,recordKind}'='model-live-proposal-case-assessment'
      AND r#>>'{assessment,validatorId}'='cloudmarkup.live-proposal-case-validator.v2'
      AND r#>>'{assessment,validatorVersion}' IN ('2.0.0','2.1.0'))
      OR (b#>>'{authorityBinding,authorityTuple,operation}'='intent.extract'
      AND b#>>'{authorityBinding,authorityTuple,role}'='low-cost-extraction-help'
      AND r#>>'{assessment,recordKind}'='model-live-intent-case-assessment'
      AND r#>>'{assessment,validatorId}'='cloudmarkup.live-intent-case-validator.v2'
      AND r#>>'{assessment,validatorVersion}'='2.2.0')
      OR (b#>>'{authorityBinding,authorityTuple,operation}'='operations.propose'
      AND b#>>'{authorityBinding,authorityTuple,role}'='standard-planning-generation'
      AND r#>>'{assessment,recordKind}'='model-live-private-vpc-case-assessment'
      AND r#>>'{assessment,validatorId}'='cloudmarkup.live-private-vpc-case-validator.v2'
      AND r#>>'{assessment,validatorVersion}'='2.3.0')
      OR (b#>>'{authorityBinding,authorityTuple,operation}'='requirements.blocking-questions'
      AND b#>>'{authorityBinding,authorityTuple,role}'='low-cost-extraction-help'
      AND r#>>'{assessment,recordKind}'='model-live-questions-case-assessment'
      AND r#>>'{assessment,validatorId}'='cloudmarkup.live-questions-case-validator.v2'
      AND r#>>'{assessment,validatorVersion}'='2.4.0')
      OR (b#>>'{authorityBinding,authorityTuple,operation}'='operations.propose'
      AND b#>>'{authorityBinding,authorityTuple,role}'='standard-planning-generation'
      AND r#>>'{assessment,recordKind}'='model-live-bounded-refusal-case-assessment'
      AND r#>>'{assessment,validatorId}'='cloudmarkup.live-bounded-refusal-case-validator.v2'
      AND r#>>'{assessment,validatorVersion}'='2.5.0'
      AND b->>'caseId' IN ('evaluation_case_nonexistent_unsupported_services_full_beta_v1','evaluation_case_excessive_resource_request_full_beta_v1')))
    AND a->'inputEvidenceDigest'=r->'inputEvidenceDigest' AND a->'liveEvaluationPlanDigest'=r->'planDigest'
    AND w->>'state'='reserved' AND w#>'{invocationReceipt}'='null'::jsonb AND w#>'{response}'='null'::jsonb
    AND w#>'{dispatchIntent,dispatchIntentId}'=to_jsonb(j.dispatch_intent_id)) IS NOT TRUE
    THEN RAISE EXCEPTION 'live case validation requires exact completed active invocation' USING ERRCODE='23514'; END IF;
  SELECT * INTO i FROM model_live_runtime_host_evidence WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
    AND principal_id=NEW.principal_id AND evidence_id=NEW.input_evidence_id;
  SELECT * INTO o FROM model_live_runtime_host_evidence WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
    AND principal_id=NEW.principal_id AND evidence_id=NEW.operations_evidence_id;
  SELECT * INTO s FROM model_live_runtime_host_evidence WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
    AND principal_id=NEW.principal_id AND evidence_id=NEW.ownership_evidence_id;
  IF (i.evidence_kind='input' AND o.evidence_kind='allow-listed-operations' AND s.evidence_kind='source-ownership'
    AND i.invocation_id=j.invocation_id AND o.invocation_id=j.invocation_id AND s.invocation_id=j.invocation_id
    AND i.plan_sha256=p.plan_sha256 AND o.plan_sha256=p.plan_sha256 AND s.plan_sha256=p.plan_sha256
    AND o.input_evidence_id=i.evidence_id AND s.input_evidence_id=i.evidence_id
    AND i.case_id=b->>'caseId' AND o.case_id=i.case_id AND s.case_id=i.case_id
    AND 'sha256:'||i.evidence_sha256=r->>'inputEvidenceDigest'
    AND 'sha256:'||o.evidence_sha256=r->>'operationsEvidenceDigest'
    AND 'sha256:'||s.evidence_sha256=r->>'ownershipEvidenceDigest'
    AND o.evidence_record->'outputDigest'=r#>'{assessment,outputDigest}'
    AND s.evidence_record->'outputDigest'=r#>'{assessment,outputDigest}') IS NOT TRUE
    THEN RAISE EXCEPTION 'live case validation requires issued input and output safety evidence' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
