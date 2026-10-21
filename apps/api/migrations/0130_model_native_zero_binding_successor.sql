-- CloudMarkup additive migration 0130; fixed reviewed source closure.
-- PROPOSAL ONLY. Additive successor after original 0084 native-zero guard.
-- Unregistered/unapplied; integration owner allocates final 0099+ versions.
-- Preserve original SQL and Notes producer/receipt boundaries.
-- Missing/null approvalDigest and indeterminate authority predicates deny.
-- No grants, role changes, execution, activation or data writes.
CREATE OR REPLACE FUNCTION enforce_native_zero_current_plan() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE p model_live_evaluation_plans%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT * INTO p FROM cloudmarkup_notes_native_private.lock_current_evaluation_plan(
    NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.plan_sha256);
  IF (NOT FOUND OR NOT (NEW.record ? 'approvalDigest') OR p.expires_at<=clock_timestamp() OR NEW.issued_at<p.issued_at OR NEW.issued_at>=p.expires_at
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
  ) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'actual current Standard native-only issuer authority required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
