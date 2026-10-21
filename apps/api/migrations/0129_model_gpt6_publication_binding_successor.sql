-- CloudMarkup additive migration 0129; fixed reviewed source closure.
-- PROPOSAL ONLY. Additive successor after the named original proposals.
-- Unregistered/unapplied; integration owner allocates final 0099+ versions.
-- Preserve original SQL bytes and load this replacement after its predecessors.
-- 0080 publication: missing/null JSON authority bindings and indeterminate comparison predicates deny.
-- No grants, role/IAM changes, models, activation or data writes are installed.
CREATE OR REPLACE FUNCTION enforce_model_gpt6_publication_current_plan() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE p model_live_evaluation_plans%ROWTYPE; h model_gpt6_held_reports%ROWTYPE;
  post_lock_checked_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT * INTO p FROM cloudmarkup_notes_native_private.lock_current_evaluation_plan(
    NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.plan_sha256);
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
    SELECT * INTO h FROM cloudmarkup_notes_native_private.lock_current_held_report(
      NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.plan_sha256,NEW.report_id,NEW.report_sha256);
    IF (NOT FOUND OR NOT (NEW.receipt ?& ARRAY['evaluationAuthorityDigest','evaluationEnvironment','definitionId','datasetDigest','evaluationPolicyDigest'])
      OR NOT ((h.record->'report') ?& ARRAY['datasetDigest','evaluationPolicyDigest','deterministicPassed'])
      OR NEW.receipt->>'evaluationAuthorityDigest'<>'sha256:'||p.approval_sha256
      OR NEW.receipt->>'evaluationEnvironment'<>p.plan_record#>>'{definition,scope,environment}'
      OR NEW.receipt->>'definitionId'<>p.definition_id
      OR NEW.receipt->>'datasetDigest'<>h.record#>>'{report,datasetDigest}'
      OR NEW.receipt->>'evaluationPolicyDigest'<>h.record#>>'{report,evaluationPolicyDigest}'
      OR h.record#>'{report,deterministicPassed}'<>'true'::jsonb) IS DISTINCT FROM FALSE
    THEN RAISE EXCEPTION 'exact passing held report and source approval required' USING ERRCODE='23514'; END IF;
  ELSE
    IF (NOT ((NEW.record->'report') ?& ARRAY['liveEvaluationAuthorityDigest','datasetDigest'])
      OR NOT ((NEW.record->'reference') ? 'definitionId')
      OR NEW.record#>>'{report,liveEvaluationAuthorityDigest}'<>'sha256:'||p.approval_sha256
      OR NEW.record#>>'{reference,definitionId}'<>p.definition_id
      OR NEW.record#>>'{report,datasetDigest}'<>p.plan_record#>>'{definition,policy,evaluationRequirement,datasetDigest}') IS DISTINCT FROM FALSE
    THEN RAISE EXCEPTION 'held report must bind its exact issued approval' USING ERRCODE='23514'; END IF;
  END IF;
  -- The held-report lock can wait unchanged past plan expiry. Reopen current
  -- revocation state in a fresh statement after the final lock, then sample the
  -- server clock. No further lock acquisition follows this checkpoint.
  PERFORM 1 FROM model_live_evaluation_revocations v WHERE v.organization_id=p.organization_id
    AND v.project_id=p.project_id AND v.principal_id=p.principal_id AND v.plan_sha256=p.plan_sha256;
  IF FOUND THEN RAISE EXCEPTION 'exact current issued evaluation approval required' USING ERRCODE='23514'; END IF;
  post_lock_checked_at:=clock_timestamp();
  IF (p.issued_at<=post_lock_checked_at AND p.expires_at>post_lock_checked_at) IS NOT TRUE
  THEN RAISE EXCEPTION 'exact current issued evaluation approval required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

-- Compose the remaining mixed-publication row lock with the same private
-- helper. The nonowner issuer retains no canonical UPDATE/DELETE privilege.
-- The original mixed-source evidence, bounded repair and revocation checks
-- remain unchanged; historical proposal0085 bytes are preserved.
CREATE OR REPLACE FUNCTION enforce_gpt6_mixed_promotion_sources() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE h JSONB; e JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT held.record INTO h FROM cloudmarkup_notes_native_private.lock_current_held_report(
    NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.plan_sha256,NEW.report_id,NEW.report_sha256) held;
  IF NOT FOUND THEN RAISE EXCEPTION 'exact current held report required for mixed publication' USING ERRCODE='23514'; END IF;
  IF h->'contractVersion'='3'::jsonb THEN
    FOR e IN SELECT value FROM jsonb_array_elements(h->'evidence') LOOP
      IF e->>'kind'='recorded-repair' AND NOT EXISTS(SELECT 1 FROM model_live_sequence_plans p
        WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id AND p.principal_id=NEW.principal_id
          AND p.definition_id=e#>>'{reference,definitionId}' AND 'sha256:'||p.plan_sha256=e#>>'{reference,planDigest}'
          AND p.expires_at>clock_timestamp() AND NEW.expires_at<=p.expires_at
          AND NOT EXISTS(SELECT 1 FROM model_live_sequence_revocations v WHERE v.organization_id=p.organization_id
            AND v.project_id=p.project_id AND v.principal_id=p.principal_id AND v.plan_sha256=p.plan_sha256))
      THEN RAISE EXCEPTION 'mixed publication requires current bounded repair sources' USING ERRCODE='23514'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
