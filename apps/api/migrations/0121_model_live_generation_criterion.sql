-- CloudMarkup additive migration 0121; fixed reviewed source closure.
-- PROPOSAL ONLY. Local label 0082 is NOT a migration version.
-- Registered versions already end at 0098; integration owner must allocate 0099+.
-- Never replace/admit this label or alter historical SQL. Unregistered/unapplied.
-- UNAPPLIED NEXT 0082. Requires 0081; source-only, unregistered and SQL-unverified.
-- Adds the actual generation coordinator criterion while preserving all original
-- scope, owner, journal, lease, usage, parser and immutable receipt guards.
-- Missing actual CI package and repair sequence cannot become passing quality.
CREATE FUNCTION cloudmarkup_live_generation_policy_parity(policy JSONB, assessment JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE generation_case BOOLEAN; current_policy BOOLEAN; successor BOOLEAN;
BEGIN
  IF (jsonb_typeof(assessment)='object' AND jsonb_typeof(assessment->'caseId')='string'
    AND jsonb_typeof(assessment->'validatorVersion')='string') IS NOT TRUE THEN RETURN FALSE; END IF;
  generation_case:=assessment->>'caseId' IN ('evaluation_case_ai_assisted_custom_source_full_beta_v1',
    'evaluation_case_terraform_extension_full_beta_v1','evaluation_case_cloudformation_extension_full_beta_v1',
    'evaluation_case_forbidden_dependency_module_provider_provisioner_full_beta_v1');
  successor:=assessment->>'validatorVersion'='2.13.0';
  IF NOT generation_case THEN RETURN NOT successor; END IF;
  current_policy:=(policy->>'evaluationPolicyId'='cloudmarkup.model-evaluation.full-beta'
    AND policy->>'evaluationPolicyVersion'='2.6.0'
    AND policy->>'evaluationPolicyDigest'='sha256:b8a5d03d5dcb4d8949d58bb2516d7ccf4bdface5f547d31facc5af14ea467ba2') IS TRUE;
  IF NOT current_policy AND (policy->>'evaluationPolicyVersion'='2.6.0' OR
    policy->>'evaluationPolicyDigest'='sha256:b8a5d03d5dcb4d8949d58bb2516d7ccf4bdface5f547d31facc5af14ea467ba2') THEN RETURN FALSE; END IF;
  IF current_policy THEN RETURN (successor AND assessment->>'recordKind'='model-live-generation-case-assessment'
    AND assessment->>'validatorId'='cloudmarkup.live-generation-case-validator.v2') IS TRUE; END IF;
  RETURN NOT successor;
END;
$$;

CREATE FUNCTION cloudmarkup_live_generation_assessment_shape(r JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE f TEXT; m JSONB; v JSONB; n NUMERIC; native JSONB; dimensions TEXT[]; semantic_count INTEGER;
BEGIN
  IF (jsonb_typeof(r)='object' AND r ?& ARRAY['contractVersion','recordKind','validatorId','validatorVersion',
    'assessmentDigest','caseId','caseDigest','sourceInputDigest','inputDigest','outputDigest','proposalDigest',
    'measurements','assistancePreferenceSemantics','native'] AND r-ARRAY['contractVersion','recordKind','validatorId','validatorVersion',
    'assessmentDigest','caseId','caseDigest','sourceInputDigest','inputDigest','outputDigest','proposalDigest',
    'measurements','assistancePreferenceSemantics','native']='{}'::jsonb AND r->'contractVersion'='2'::jsonb
    AND r->>'recordKind'='model-live-generation-case-assessment' AND r->>'validatorId'='cloudmarkup.live-generation-case-validator.v2'
    AND r->>'validatorVersion'='2.13.0' AND jsonb_typeof(r->'measurements')='array'
    AND jsonb_typeof(r->'assistancePreferenceSemantics')='array') IS NOT TRUE THEN RETURN FALSE; END IF;
  dimensions:=CASE r->>'caseId'
    WHEN 'evaluation_case_ai_assisted_custom_source_full_beta_v1' THEN ARRAY['structured-schema-validity',
      'stable-id-user-owned-file-preservation','security-policy-violations','application-generation-build-test-success',
      'repair-effectiveness-without-rule-weakening','ci-workflow-validity','same-ui-semantics-across-assistance-preferences']
    WHEN 'evaluation_case_terraform_extension_full_beta_v1' THEN ARRAY['structured-schema-validity',
      'stable-id-user-owned-file-preservation','security-policy-violations','deterministic-compiler-preference',
      'terraform-cloudformation-validation-security-success','ci-workflow-validity','same-ui-semantics-across-assistance-preferences']
    WHEN 'evaluation_case_cloudformation_extension_full_beta_v1' THEN ARRAY['structured-schema-validity',
      'stable-id-user-owned-file-preservation','security-policy-violations','deterministic-compiler-preference',
      'terraform-cloudformation-validation-security-success','ci-workflow-validity','same-ui-semantics-across-assistance-preferences']
    WHEN 'evaluation_case_forbidden_dependency_module_provider_provisioner_full_beta_v1' THEN ARRAY['structured-schema-validity',
      'unsupported-service-field-rate','graph-workload-external-rule-violations','stable-id-user-owned-file-preservation',
      'security-policy-violations','terraform-cloudformation-validation-security-success','issue-clarity-correct-severity',
      'same-ui-semantics-across-assistance-preferences'] ELSE NULL END;
  IF dimensions IS NULL THEN RETURN FALSE; END IF;
  FOREACH f IN ARRAY ARRAY['assessmentDigest','caseDigest','sourceInputDigest','inputDigest','outputDigest','proposalDigest'] LOOP
    IF (jsonb_typeof(r->f)='string' AND r->>f ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE THEN RETURN FALSE; END IF;
  END LOOP;
  native:=r->'native';
  IF (jsonb_typeof(native)='object' AND native ?& ARRAY['configurationDigest','resultDigest','nativeResultDigest',
    'nativeValidationPassed','actualReviewAvailable','ciPackageVerified','repairSequenceVerified'] AND native-ARRAY[
    'configurationDigest','resultDigest','nativeResultDigest','nativeValidationPassed','actualReviewAvailable',
    'ciPackageVerified','repairSequenceVerified']='{}'::jsonb AND native->'ciPackageVerified'='false'::jsonb
    AND native->'repairSequenceVerified'='false'::jsonb AND jsonb_typeof(native->'nativeValidationPassed')='boolean'
    AND jsonb_typeof(native->'actualReviewAvailable')='boolean') IS NOT TRUE THEN RETURN FALSE; END IF;
  FOREACH f IN ARRAY ARRAY['configurationDigest','resultDigest','nativeResultDigest'] LOOP
    IF (jsonb_typeof(native->f)='string' AND native->>f ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE THEN RETURN FALSE; END IF;
  END LOOP;
  IF jsonb_array_length(r->'measurements')<>array_length(dimensions,1)
    OR (SELECT count(DISTINCT x->>'dimension') FROM jsonb_array_elements(r->'measurements') x)<>array_length(dimensions,1)
    OR jsonb_array_length(r->'assistancePreferenceSemantics')<>2
    OR (SELECT count(DISTINCT x->>'assistancePreference') FROM jsonb_array_elements(r->'assistancePreferenceSemantics') x)<>2
    THEN RETURN FALSE; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(r->'assistancePreferenceSemantics') LOOP
    IF (jsonb_typeof(v)='object' AND v ?& ARRAY['assistancePreference','semanticDigest']
      AND v-ARRAY['assistancePreference','semanticDigest']='{}'::jsonb AND v->>'assistancePreference' IN ('guided','professional')
      AND jsonb_typeof(v->'semanticDigest')='string' AND v->>'semanticDigest' ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE THEN RETURN FALSE; END IF;
  END LOOP;
  SELECT count(DISTINCT x->>'semanticDigest') INTO semantic_count FROM jsonb_array_elements(r->'assistancePreferenceSemantics') x;
  FOR m IN SELECT value FROM jsonb_array_elements(r->'measurements') LOOP
    IF (jsonb_typeof(m)='object' AND m ?& ARRAY['denominator','dimension','evidenceDigests','numerator','sourceAuthority']
      AND m-ARRAY['denominator','dimension','evidenceDigests','numerator','sourceAuthority']='{}'::jsonb
      AND m->>'dimension'=ANY(dimensions) AND m->>'sourceAuthority'='deterministic-evaluation-v1'
      AND m->'denominator'='1'::jsonb AND jsonb_typeof(m->'numerator')='number'
      AND jsonb_typeof(m->'evidenceDigests')='array' AND jsonb_array_length(m->'evidenceDigests') BETWEEN 1 AND 16) IS NOT TRUE THEN RETURN FALSE; END IF;
    n:=(m->>'numerator')::numeric;
    IF n<0 OR n>10000000 OR n<>trunc(n) THEN RETURN FALSE; END IF;
    FOR v IN SELECT value FROM jsonb_array_elements(m->'evidenceDigests') LOOP
      IF (jsonb_typeof(v)='string' AND v#>>'{}' ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE THEN RETURN FALSE; END IF;
    END LOOP;
    IF m->>'dimension'='structured-schema-validity' AND n<>1 THEN RETURN FALSE; END IF;
    IF m->>'dimension' IN ('ci-workflow-validity','repair-effectiveness-without-rule-weakening') AND n<>0 THEN RETURN FALSE; END IF;
    IF m->>'dimension' IN ('application-generation-build-test-success','terraform-cloudformation-validation-security-success') AND n=1
      AND r->>'caseId'<>'evaluation_case_forbidden_dependency_module_provider_provisioner_full_beta_v1'
      AND native->'nativeValidationPassed'<>'true'::jsonb THEN RETURN FALSE; END IF;
    IF m->>'dimension'='same-ui-semantics-across-assistance-preferences' AND
      (n<>CASE WHEN native->'actualReviewAvailable'='true'::jsonb AND semantic_count=1 THEN 1 ELSE 0 END
      OR jsonb_array_length(m->'evidenceDigests')<>semantic_count OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(r->'assistancePreferenceSemantics') x
          WHERE NOT (m->'evidenceDigests') @> jsonb_build_array(x->'semanticDigest'))) THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION cloudmarkup_live_proposal_assessment_shape(r JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE f TEXT; m JSONB; v JSONB; n NUMERIC; d NUMERIC; semantic_count INTEGER; dimensions TEXT[]; intent BOOLEAN; private_vpc BOOLEAN; questions BOOLEAN; bounded BOOLEAN; repository BOOLEAN; external_resource BOOLEAN; event_processing BOOLEAN; parser_successor BOOLEAN; typed_application BOOLEAN; native JSONB;
BEGIN
  IF r->>'validatorVersion'='2.13.0' THEN RETURN cloudmarkup_live_generation_assessment_shape(r); END IF;
  intent := r->>'recordKind'='model-live-intent-case-assessment' AND r->>'validatorId'='cloudmarkup.live-intent-case-validator.v2' AND r->>'validatorVersion'='2.2.0';
  private_vpc := r->>'recordKind'='model-live-private-vpc-case-assessment' AND r->>'validatorId'='cloudmarkup.live-private-vpc-case-validator.v2' AND r->>'validatorVersion'='2.3.0';
  questions := r->>'recordKind'='model-live-questions-case-assessment' AND r->>'validatorId'='cloudmarkup.live-questions-case-validator.v2' AND r->>'validatorVersion'='2.4.0';
  bounded := r->>'recordKind'='model-live-bounded-refusal-case-assessment' AND r->>'validatorId'='cloudmarkup.live-bounded-refusal-case-validator.v2' AND r->>'validatorVersion'='2.5.0' AND r->>'caseId' IN ('evaluation_case_nonexistent_unsupported_services_full_beta_v1','evaluation_case_excessive_resource_request_full_beta_v1');
  repository := r->>'recordKind'='model-live-repository-case-assessment' AND r->>'validatorId'='cloudmarkup.live-repository-case-validator.v2' AND r->>'validatorVersion' IN ('2.6.0','2.9.0') AND r->>'caseId' IN ('evaluation_case_deterministic_repository_import_full_beta_v1','evaluation_case_ambiguous_source_code_inference_full_beta_v1','evaluation_case_designed_observed_mismatch_full_beta_v1');
  external_resource := r->>'recordKind'='model-live-external-case-assessment' AND r->>'validatorId'='cloudmarkup.live-external-case-validator.v2' AND r->>'validatorVersion' IN ('2.7.0','2.10.0') AND r->>'caseId'='evaluation_case_external_existing_resource_full_beta_v1';
  event_processing := r->>'recordKind'='model-live-event-case-assessment' AND r->>'validatorId'='cloudmarkup.live-event-case-validator.v2' AND r->>'validatorVersion' IN ('2.8.0','2.11.0') AND r->>'caseId'='evaluation_case_event_driven_image_processing_full_beta_v1';
  typed_application := r->>'recordKind'='model-live-typed-application-case-assessment'
    AND r->>'validatorId'='cloudmarkup.live-typed-application-case-validator.v2'
    AND r->>'validatorVersion'='2.12.0'
    AND r->>'caseId' IN ('evaluation_case_simple_serverless_api_full_beta_v1','evaluation_case_authenticated_notes_application_full_beta_v1');
  parser_successor := r->>'validatorVersion' IN ('2.9.0','2.10.0');
  dimensions := CASE WHEN typed_application THEN ARRAY['structured-schema-validity','capability-requirement-coverage','graph-workload-external-rule-violations','stable-id-user-owned-file-preservation','security-policy-violations','deterministic-compiler-preference','application-generation-build-test-success','issue-clarity-correct-severity','ci-workflow-validity','same-ui-semantics-across-assistance-preferences'] WHEN external_resource THEN ARRAY['structured-schema-validity','capability-requirement-coverage','graph-workload-external-rule-violations','grounded-repository-evidence-rate','stable-id-user-owned-file-preservation','security-policy-violations','issue-clarity-correct-severity','same-ui-semantics-across-assistance-preferences'] WHEN repository THEN ARRAY['structured-schema-validity','security-policy-violations','grounded-repository-evidence-rate','stable-id-user-owned-file-preservation','issue-clarity-correct-severity','same-ui-semantics-across-assistance-preferences'] || CASE WHEN r->>'caseId'='evaluation_case_ambiguous_source_code_inference_full_beta_v1' THEN ARRAY['unresolved-behavior-honesty'] ELSE ARRAY['graph-workload-external-rule-violations'] END || CASE WHEN r->>'caseId'='evaluation_case_deterministic_repository_import_full_beta_v1' THEN ARRAY['deterministic-compiler-preference'] ELSE ARRAY[]::text[] END WHEN bounded THEN ARRAY['structured-schema-validity','security-policy-violations','graph-workload-external-rule-violations','issue-clarity-correct-severity','unresolved-behavior-honesty','same-ui-semantics-across-assistance-preferences'] || CASE WHEN r->>'caseId'='evaluation_case_nonexistent_unsupported_services_full_beta_v1' THEN ARRAY['unsupported-service-field-rate'] ELSE ARRAY[]::text[] END WHEN private_vpc OR event_processing THEN ARRAY['structured-schema-validity','capability-requirement-coverage','unsupported-service-field-rate','graph-workload-external-rule-violations','security-policy-violations','issue-clarity-correct-severity','unresolved-behavior-honesty','same-ui-semantics-across-assistance-preferences'] WHEN intent OR questions THEN ARRAY['structured-schema-validity','security-policy-violations','capability-requirement-coverage','issue-clarity-correct-severity','unresolved-behavior-honesty','same-ui-semantics-across-assistance-preferences'] ELSE ARRAY['structured-schema-validity','security-policy-violations','issue-clarity-correct-severity','same-ui-semantics-across-assistance-preferences'] END;
  IF (jsonb_typeof(r)='object' AND
    r ?& (ARRAY['contractVersion','recordKind','validatorId','validatorVersion','assessmentDigest','caseId','caseDigest','sourceInputDigest','inputDigest','outputDigest','proposalDigest','measurements','assistancePreferenceSemantics'] || CASE WHEN typed_application THEN ARRAY['native'] WHEN parser_successor THEN ARRAY['repositoryParser','repositoryInputReceipt'] ELSE ARRAY[]::text[] END) AND
    r-(ARRAY['contractVersion','recordKind','validatorId','validatorVersion','assessmentDigest','caseId','caseDigest','sourceInputDigest','inputDigest','outputDigest','proposalDigest','measurements','assistancePreferenceSemantics'] || CASE WHEN typed_application THEN ARRAY['native'] WHEN parser_successor THEN ARRAY['repositoryParser','repositoryInputReceipt'] ELSE ARRAY[]::text[] END)='{}'::jsonb AND
    r->'contractVersion'='2'::jsonb AND
    (typed_application OR intent OR private_vpc OR questions OR bounded OR repository OR external_resource OR event_processing OR (r->>'recordKind'='model-live-proposal-case-assessment' AND
      r->>'validatorId'='cloudmarkup.live-proposal-case-validator.v2' AND r->>'validatorVersion' IN ('2.0.0','2.1.0'))) AND
    r->>'caseId' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' AND
    jsonb_typeof(r->'measurements')='array' AND jsonb_typeof(r->'assistancePreferenceSemantics')='array') IS NOT TRUE THEN RETURN FALSE; END IF;
  IF parser_successor AND ((cloudmarkup_live_repository_parser_shape(r->'repositoryParser',r->>'caseId')
    AND jsonb_typeof(r->'repositoryInputReceipt')='object'
    AND (r->'repositoryInputReceipt') ?& ARRAY['receiptId','receiptDigest']
    AND (r->'repositoryInputReceipt')-ARRAY['receiptId','receiptDigest']='{}'::jsonb
    AND r#>>'{repositoryInputReceipt,receiptId}' ~ '^parser_input_[a-f0-9]{64}$'
    AND r#>>'{repositoryInputReceipt,receiptDigest}' ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE) THEN RETURN FALSE; END IF;
  IF typed_application THEN
    native:=r->'native';
    IF (jsonb_typeof(native)='object' AND native ?& ARRAY['configurationDigest','candidateDigest','solutionRevisionDigest','compilationDigest','resultDigest','compilerPassed','generationPassed','ciPassed','buildCount','passedBuildCount','testedBuildCount','securityBuildCount','reproducibleBuildCount','perUserOwnershipEnforced']
      AND native-ARRAY['configurationDigest','candidateDigest','solutionRevisionDigest','compilationDigest','resultDigest','compilerPassed','generationPassed','ciPassed','buildCount','passedBuildCount','testedBuildCount','securityBuildCount','reproducibleBuildCount','perUserOwnershipEnforced']='{}'::jsonb
      AND native->'perUserOwnershipEnforced'='false'::jsonb) IS NOT TRUE THEN RETURN FALSE; END IF;
    FOREACH f IN ARRAY ARRAY['configurationDigest','candidateDigest','solutionRevisionDigest','compilationDigest','resultDigest'] LOOP
      IF (jsonb_typeof(native->f)='string' AND native->>f ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE THEN RETURN FALSE; END IF;
    END LOOP;
    FOREACH f IN ARRAY ARRAY['compilerPassed','generationPassed','ciPassed'] LOOP
      IF jsonb_typeof(native->f) IS DISTINCT FROM 'boolean' THEN RETURN FALSE; END IF;
    END LOOP;
    FOREACH f IN ARRAY ARRAY['buildCount','passedBuildCount','testedBuildCount','securityBuildCount','reproducibleBuildCount'] LOOP
      IF jsonb_typeof(native->f) IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
      n:=(native->>f)::numeric;
      IF n<0 OR n>64 OR n<>trunc(n) OR (f<>'buildCount' AND n>(native->>'buildCount')::numeric) THEN RETURN FALSE; END IF;
    END LOOP;
  END IF;
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
    IF parser_successor AND m->>'dimension'='grounded-repository-evidence-rate' AND
      (jsonb_array_length(m->'evidenceDigests')<>3 OR NOT (m->'evidenceDigests') @> jsonb_build_array(r->'outputDigest',r#>'{repositoryParser,snapshotDigest}',r#>'{repositoryParser,resultDigest}')) THEN RETURN FALSE; END IF;
    IF m->>'dimension'='structured-schema-validity' AND (n<>1 OR d<>1) THEN RETURN FALSE; END IF;
    IF m->>'dimension'='issue-clarity-correct-severity' AND d<>(CASE WHEN intent THEN 3 WHEN questions THEN 4 ELSE 1 END) THEN RETURN FALSE; END IF;
    IF private_vpc AND ((m->>'dimension'='capability-requirement-coverage' AND d<>13) OR
      (m->>'dimension'='unresolved-behavior-honesty' AND d<>1)) THEN RETURN FALSE; END IF;
    IF event_processing AND r->>'validatorVersion'='2.11.0' AND m->>'dimension'='issue-clarity-correct-severity' AND
      (jsonb_array_length(m->'evidenceDigests')<>4 OR m#>>'{evidenceDigests,0}'<>'sha256:855f22b966662528e5e0830488b8a37cfe6ae0f6f9287ef7fb0c15c47f73fc53') THEN RETURN FALSE; END IF;
    IF event_processing AND ((m->>'dimension'='capability-requirement-coverage' AND d<>9) OR
      (m->>'dimension'='unresolved-behavior-honesty' AND d<>1)) THEN RETURN FALSE; END IF;
    IF questions AND ((m->>'dimension' IN ('capability-requirement-coverage','issue-clarity-correct-severity') AND d<>4) OR
      (m->>'dimension' IN ('security-policy-violations','unresolved-behavior-honesty') AND d<>1)) THEN RETURN FALSE; END IF;
    IF bounded AND m->>'dimension'='unresolved-behavior-honesty' AND d<>1 THEN RETURN FALSE; END IF;
    IF external_resource AND ((m->>'dimension'='capability-requirement-coverage' AND d<>4) OR
      (m->>'dimension' NOT IN ('capability-requirement-coverage','graph-workload-external-rule-violations','security-policy-violations') AND d<>1)) THEN RETURN FALSE; END IF;
    IF repository AND m->>'dimension'<>'graph-workload-external-rule-violations' AND d<>1 THEN RETURN FALSE; END IF;
    IF intent AND ((m->>'dimension'='capability-requirement-coverage' AND d<>16) OR
      (m->>'dimension' IN ('security-policy-violations','unresolved-behavior-honesty') AND d<>1)) THEN RETURN FALSE; END IF;
    IF typed_application THEN
      IF m->>'dimension'='capability-requirement-coverage' AND (d<>7 OR
        (r->>'caseId'='evaluation_case_authenticated_notes_application_full_beta_v1' AND n>=7)) THEN RETURN FALSE; END IF;
      IF m->>'dimension' IN ('deterministic-compiler-preference','application-generation-build-test-success') AND
        (d<>1 OR (n=1 AND ((native->'compilerPassed'='true'::jsonb AND native->'generationPassed'='true'::jsonb
          AND (native->>'buildCount')::numeric>0 AND native->'passedBuildCount'=native->'buildCount'
          AND native->'testedBuildCount'=native->'buildCount' AND native->'securityBuildCount'=native->'buildCount'
          AND native->'reproducibleBuildCount'=native->'buildCount') IS NOT TRUE))) THEN RETURN FALSE; END IF;
      IF m->>'dimension'='ci-workflow-validity' AND (d<>1 OR (n=1 AND native->'ciPassed'<>'true'::jsonb)) THEN RETURN FALSE; END IF;
      IF m->>'dimension'='security-policy-violations' AND r->>'caseId'='evaluation_case_authenticated_notes_application_full_beta_v1' AND n<1 THEN RETURN FALSE; END IF;
    END IF;
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
  b JSONB; a JSONB; r JSONB; w JSONB; parser_input model_live_parser_input_receipts%ROWTYPE;
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
  IF cloudmarkup_live_event_policy_parity(p.plan_record#>'{definition,policy,evaluationRequirement}',r->'assessment') IS NOT TRUE
    THEN RAISE EXCEPTION 'event validation requires its exact preissued policy' USING ERRCODE='23514'; END IF;
  IF cloudmarkup_live_typed_application_policy_parity(p.plan_record#>'{definition,policy,evaluationRequirement}',r->'assessment') IS NOT TRUE
    THEN RAISE EXCEPTION 'typed validation requires its exact preissued source policy' USING ERRCODE='23514'; END IF;
  IF cloudmarkup_live_generation_policy_parity(p.plan_record#>'{definition,policy,evaluationRequirement}',r->'assessment') IS NOT TRUE
    THEN RAISE EXCEPTION 'generation validation requires exact preissued source policy' USING ERRCODE='23514'; END IF;
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
    AND ((b#>>'{authorityBinding,authorityTuple,role}'='deep-architecture-custom-generation'
      AND r#>>'{assessment,recordKind}'='model-live-generation-case-assessment'
      AND r#>>'{assessment,validatorId}'='cloudmarkup.live-generation-case-validator.v2'
      AND r#>>'{assessment,validatorVersion}'='2.13.0'
      AND ((b#>>'{authorityBinding,authorityTuple,operation}'='application-source.generate'
        AND b->>'caseId'='evaluation_case_ai_assisted_custom_source_full_beta_v1')
      OR (b#>>'{authorityBinding,authorityTuple,operation}'='iac-extension.generate' AND b->>'caseId' IN (
        'evaluation_case_terraform_extension_full_beta_v1','evaluation_case_cloudformation_extension_full_beta_v1',
        'evaluation_case_forbidden_dependency_module_provider_provisioner_full_beta_v1'))))
      OR (b#>>'{authorityBinding,authorityTuple,operation}'='operations.propose'
      AND b#>>'{authorityBinding,authorityTuple,role}'='standard-planning-generation'
      AND r#>>'{assessment,recordKind}'='model-live-typed-application-case-assessment'
      AND r#>>'{assessment,validatorId}'='cloudmarkup.live-typed-application-case-validator.v2'
      AND r#>>'{assessment,validatorVersion}'='2.12.0'
      AND b->>'caseId' IN ('evaluation_case_simple_serverless_api_full_beta_v1','evaluation_case_authenticated_notes_application_full_beta_v1'))
      OR (b#>>'{authorityBinding,authorityTuple,operation}'='operations.propose'
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
      AND b->>'caseId' IN ('evaluation_case_nonexistent_unsupported_services_full_beta_v1','evaluation_case_excessive_resource_request_full_beta_v1'))
      OR (b#>>'{authorityBinding,authorityTuple,operation}'='operations.propose'
      AND b#>>'{authorityBinding,authorityTuple,role}'='standard-planning-generation'
      AND r#>>'{assessment,recordKind}'='model-live-external-case-assessment'
      AND r#>>'{assessment,validatorId}'='cloudmarkup.live-external-case-validator.v2'
      AND r#>>'{assessment,validatorVersion}' IN ('2.7.0','2.10.0') AND b->>'caseId'='evaluation_case_external_existing_resource_full_beta_v1')
      OR (b#>>'{authorityBinding,authorityTuple,operation}'='operations.propose'
      AND b#>>'{authorityBinding,authorityTuple,role}'='standard-planning-generation'
      AND r#>>'{assessment,recordKind}'='model-live-event-case-assessment'
      AND r#>>'{assessment,validatorId}'='cloudmarkup.live-event-case-validator.v2'
      AND r#>>'{assessment,validatorVersion}' IN ('2.8.0','2.11.0') AND b->>'caseId'='evaluation_case_event_driven_image_processing_full_beta_v1')
      OR (b#>>'{authorityBinding,authorityTuple,operation}'='repository.interpret'
      AND b#>>'{authorityBinding,authorityTuple,role}'='standard-planning-generation'
      AND r#>>'{assessment,recordKind}'='model-live-repository-case-assessment'
      AND r#>>'{assessment,validatorId}'='cloudmarkup.live-repository-case-validator.v2'
      AND r#>>'{assessment,validatorVersion}' IN ('2.6.0','2.9.0') AND b->>'caseId' IN ('evaluation_case_deterministic_repository_import_full_beta_v1','evaluation_case_ambiguous_source_code_inference_full_beta_v1','evaluation_case_designed_observed_mismatch_full_beta_v1')))
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
  SELECT * INTO parser_input FROM model_live_parser_input_receipts WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
    AND principal_id=NEW.principal_id AND invocation_id=NEW.invocation_id;
  IF FOUND THEN
    IF (r#>>'{assessment,validatorVersion}' IN ('2.9.0','2.10.0')
      AND (r#>>'{assessment,validatorVersion}'='2.10.0')=(b->>'caseId'='evaluation_case_external_existing_resource_full_beta_v1')
      AND parser_input.created_at<=j.created_at
      AND parser_input.receipt_record->'planDigest'=r->'planDigest' AND parser_input.receipt_record->'approvalDigest'=r->'approvalDigest'
      AND parser_input.receipt_record->'runtimeRequestDigest'=r->'runtimeRequestDigest'
      AND parser_input.receipt_record->'caseId'=r#>'{assessment,caseId}' AND parser_input.receipt_record->'caseDigest'=r#>'{assessment,caseDigest}'
      AND parser_input.receipt_record->'sourceInputDigest'=r#>'{assessment,sourceInputDigest}' AND parser_input.receipt_record->'inputDigest'=r#>'{assessment,inputDigest}'
      AND parser_input.input_evidence_id=i.evidence_id AND parser_input.receipt_record->'inputEvidenceDigest'=r->'inputEvidenceDigest'
      AND parser_input.receipt_record->>'invocationScopeDigest'='sha256:'||i.invocation_scope_sha256
      AND parser_input.receipt_record->>'invocationDigest'='sha256:'||i.invocation_sha256
      AND parser_input.receipt_record->>'descriptorDigest'='sha256:'||i.descriptor_sha256
      AND parser_input.receipt_record->'repositoryParser'=r#>'{assessment,repositoryParser}'
      AND to_jsonb(parser_input.receipt_id)=r#>'{assessment,repositoryInputReceipt,receiptId}'
      AND to_jsonb('sha256:'||parser_input.receipt_sha256)=r#>'{assessment,repositoryInputReceipt,receiptDigest}') IS NOT TRUE
      THEN RAISE EXCEPTION 'validation requires the original issued parser input' USING ERRCODE='23514'; END IF;
  ELSIF r#>>'{assessment,validatorVersion}' IN ('2.9.0','2.10.0') THEN
    RAISE EXCEPTION 'successor validation requires issued parser input' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
