-- CloudMarkup additive migration 0122; fixed reviewed source closure.
-- PROPOSAL ONLY. Local label 0083 is NOT a migration version.
-- Registered versions already end at 0098; integration owner must allocate 0099+.
-- Never replace/admit this label or alter historical SQL. Unregistered/unapplied.
-- UNAPPLIED NEXT 0083, requires 0082. No live SQL or new quality evidence.
-- Preserve historical 2.13 and unchanged source 1.7 / scoring policy 2.6.
ALTER FUNCTION cloudmarkup_live_generation_assessment_shape(JSONB)
  RENAME TO cloudmarkup_live_generation_assessment_shape_v213;

CREATE FUNCTION cloudmarkup_live_generation_assessment_shape(r JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE legacy JSONB; native JSONB; m JSONB; ci BOOLEAN;
BEGIN
  IF r->>'validatorVersion'<>'2.14.0' THEN
    RETURN cloudmarkup_live_generation_assessment_shape_v213(r);
  END IF;
  native:=r->'native';
  IF jsonb_typeof(native->'ciPackageVerified')<>'boolean' THEN RETURN FALSE; END IF;
  ci:=native->'ciPackageVerified'='true'::jsonb;
  IF ci THEN
    IF (native->>'ciPackageDigest' ~ '^sha256:[a-f0-9]{64}$'
      AND native->>'ciAttachmentDigest' ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE THEN RETURN FALSE; END IF;
  ELSIF native ? 'ciPackageDigest' OR native ? 'ciAttachmentDigest' THEN RETURN FALSE;
  END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(r->'measurements') LOOP
    IF m->>'dimension'='ci-workflow-validity' THEN
      IF (m->>'numerator')::NUMERIC<>(CASE WHEN ci THEN 1 ELSE 0 END) THEN RETURN FALSE; END IF;
      IF ci AND (m->'evidenceDigests' @> jsonb_build_array(native->'ciPackageDigest',native->'ciAttachmentDigest')) IS NOT TRUE
        THEN RETURN FALSE; END IF;
    END IF;
  END LOOP;
  -- The predecessor checks every original dimension, parity, native condition
  -- and strict field. Only the separately versioned CI byte proof is added.
  legacy:=jsonb_set(r,'{validatorVersion}','"2.13.0"'::jsonb);
  legacy:=jsonb_set(legacy,'{native}',jsonb_set(native-ARRAY['ciPackageDigest','ciAttachmentDigest'],'{ciPackageVerified}','false'::jsonb));
  legacy:=jsonb_set(legacy,'{measurements}',(SELECT jsonb_agg(CASE WHEN value->>'dimension'='ci-workflow-validity'
    THEN jsonb_set(value,'{numerator}','0'::jsonb) ELSE value END) FROM jsonb_array_elements(r->'measurements')));
  RETURN cloudmarkup_live_generation_assessment_shape_v213(legacy);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN FALSE;
END;
$$;

ALTER FUNCTION cloudmarkup_live_generation_policy_parity(JSONB,JSONB)
  RENAME TO cloudmarkup_live_generation_policy_parity_v213;

CREATE FUNCTION cloudmarkup_live_generation_policy_parity(policy JSONB,assessment JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF assessment->>'validatorVersion'='2.14.0' THEN
    RETURN cloudmarkup_live_generation_policy_parity_v213(policy,jsonb_set(assessment,'{validatorVersion}','"2.13.0"'::jsonb));
  END IF;
  RETURN cloudmarkup_live_generation_policy_parity_v213(policy,assessment);
END;
$$;

ALTER FUNCTION cloudmarkup_live_proposal_assessment_shape(JSONB)
  RENAME TO cloudmarkup_live_proposal_assessment_shape_before_ci_v214;

CREATE FUNCTION cloudmarkup_live_proposal_assessment_shape(r JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF r->>'validatorVersion'='2.14.0' THEN RETURN cloudmarkup_live_generation_assessment_shape(r); END IF;
  RETURN cloudmarkup_live_proposal_assessment_shape_before_ci_v214(r);
END;
$$;
