-- Source definitions only. Runtime grants and protected-column permissions remain disabled.
-- Existing migration runners own each transaction and ledger write.

CREATE OR REPLACE FUNCTION public.cloudmarkup_guard_sealed_project_work() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $cm$

DECLARE ordinary_locked_keys text; state text; sealed boolean;
BEGIN
 IF current_user::text = session_user::text AND session_user::text IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime') THEN
 SELECT locked_keys_json INTO ordinary_locked_keys FROM cloudmarkup_ordinary_private.lock_project_scope(NEW.organization_id::text,NEW.project_id::text);
 IF NOT FOUND THEN RAISE EXCEPTION 'Ordinary lock evidence unavailable' USING ERRCODE='42501'; END IF;
 SELECT p.lifecycle_status,x.phase='erasing' INTO state,sealed FROM projects p LEFT JOIN project_cleanup_phases x USING(organization_id,project_id)
 WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id;
 IF ordinary_locked_keys::jsonb IS DISTINCT FROM (CASE WHEN FOUND THEN '["fixed"]'::jsonb ELSE '[]'::jsonb END) THEN RAISE EXCEPTION 'Ordinary lock scope changed' USING ERRCODE='42501'; END IF;
ELSE
 SELECT p.lifecycle_status,x.phase='erasing' INTO state,sealed FROM projects p LEFT JOIN project_cleanup_phases x USING(organization_id,project_id)
 WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id FOR SHARE OF p;
END IF;
 IF state IN('deletion-pending','deleted') AND TG_OP='INSERT' THEN RAISE EXCEPTION 'Deleted project work admission is closed'; END IF;
 IF sealed OR state='deleted' THEN
  IF TG_TABLE_NAME='async_jobs' AND NEW.lifecycle_status NOT IN('succeeded','failed','canceled','expired','superseded')
   OR TG_TABLE_NAME='solution_export_runs' AND NEW.lifecycle_status NOT IN('succeeded','failed','canceled')
  THEN RAISE EXCEPTION 'Erasing project work cannot reopen'; END IF;
 END IF;
 RETURN NEW;
END;

$cm$;

CREATE OR REPLACE FUNCTION public.enforce_closed_project_object_metadata() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $cm$

DECLARE ordinary_locked_keys text; project_state text;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  IF current_user::text = session_user::text AND session_user::text IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime') THEN
 SELECT locked_keys_json INTO ordinary_locked_keys FROM cloudmarkup_ordinary_private.lock_project_scope(NEW.organization_id::text,NEW.project_id::text);
 IF NOT FOUND THEN RAISE EXCEPTION 'Ordinary lock evidence unavailable' USING ERRCODE='42501'; END IF;
 SELECT lifecycle_status INTO project_state FROM projects
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id;
 IF ordinary_locked_keys::jsonb IS DISTINCT FROM (CASE WHEN FOUND THEN '["fixed"]'::jsonb ELSE '[]'::jsonb END) THEN RAISE EXCEPTION 'Ordinary lock scope changed' USING ERRCODE='42501'; END IF;
ELSE
 SELECT lifecycle_status INTO project_state FROM projects
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id FOR SHARE;
END IF;
  IF NOT FOUND OR project_state IN ('active','archived') THEN RETURN NEW; END IF;
  IF project_state='deletion-pending' AND NEW.lifecycle_state IN('publication-pending','published')
    AND NEW.storage_provider='s3'
    AND NEW.storage_key=('documents/v1/organizations/v1/organizations/'||NEW.organization_id||'/projects/'||NEW.project_id||'/'||NEW.object_purpose||'/'||NEW.object_id||'/'||NEW.content_sha256)
    AND EXISTS(
      SELECT 1 FROM project_deletion_recovery_objects r JOIN project_cleanup_phases x USING(organization_id,project_id)
      WHERE r.object_id=NEW.object_id AND r.organization_id=NEW.organization_id AND r.project_id=NEW.project_id
      AND r.content_sha256=NEW.content_sha256 AND r.size_bytes=NEW.size_bytes AND r.object_purpose=NEW.object_purpose
      AND r.created_by_principal_id=NEW.created_by_principal_id AND r.media_type=NEW.media_type AND x.phase='draining'
      AND (r.lifecycle_status='in-flight' OR r.lifecycle_status='uncertain' AND EXISTS(SELECT 1 FROM project_deletion_recovery_completion_proofs f WHERE f.object_id=r.object_id AND f.history_id=r.history_id AND f.history_state='completed' AND f.object_version=NEW.object_version)
        OR TG_OP='INSERT' AND r.lifecycle_status='completed' AND EXISTS(SELECT 1 FROM stored_objects existing_object WHERE existing_object.object_id=NEW.object_id AND existing_object.lifecycle_state='published'
          AND ROW(existing_object.organization_id,existing_object.project_id,existing_object.object_purpose,existing_object.storage_key,existing_object.object_version,existing_object.entity_tag,existing_object.content_sha256,existing_object.size_bytes,existing_object.media_type,existing_object.created_by_principal_id)
          IS NOT DISTINCT FROM ROW(NEW.organization_id,NEW.project_id,NEW.object_purpose,NEW.storage_key,NEW.object_version,NEW.entity_tag,NEW.content_sha256,NEW.size_bytes,NEW.media_type,NEW.created_by_principal_id)))
  ) AND (TG_OP='INSERT' OR
    (to_jsonb(NEW)-ARRAY['lifecycle_state','published_at']) IS NOT DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['lifecycle_state','published_at'])) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND project_state='deletion-pending' AND NEW.lifecycle_state='deleted'
    AND (to_jsonb(NEW)-ARRAY['lifecycle_state','delete_requested_at','deleted_at']) IS NOT DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['lifecycle_state','delete_requested_at','deleted_at'])
    AND EXISTS(SELECT 1 FROM project_content_write_scopes s WHERE s.organization_id=NEW.organization_id
      AND s.project_id=NEW.project_id AND s.closed_at IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM project_content_writes w WHERE w.organization_id=NEW.organization_id
      AND w.project_id=NEW.project_id AND w.lifecycle_status<>'completed')
    AND NOT EXISTS(SELECT 1 FROM project_deletion_recovery_objects r WHERE r.organization_id=NEW.organization_id
      AND r.project_id=NEW.project_id AND r.lifecycle_status NOT IN('completed','aborted')) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Project object metadata is closed for erasure' USING ERRCODE='23514';
END;

$cm$;

CREATE OR REPLACE FUNCTION public.enforce_project_content_write() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $cm$

DECLARE ordinary_locked_keys text; scope_closed timestamptz; required boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  IF current_user::text = session_user::text AND session_user::text IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime') THEN
 SELECT locked_keys_json INTO ordinary_locked_keys FROM cloudmarkup_ordinary_private.lock_writer_scope(NEW.organization_id::text,NEW.project_id::text);
 IF NOT FOUND THEN RAISE EXCEPTION 'Ordinary lock evidence unavailable' USING ERRCODE='42501'; END IF;
 SELECT closed_at INTO scope_closed FROM project_content_write_scopes WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id;
 IF ordinary_locked_keys::jsonb IS DISTINCT FROM (CASE WHEN FOUND THEN '["fixed"]'::jsonb ELSE '[]'::jsonb END) THEN RAISE EXCEPTION 'Ordinary lock scope changed' USING ERRCODE='42501'; END IF;
ELSE
 SELECT closed_at INTO scope_closed FROM project_content_write_scopes WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id FOR UPDATE;
END IF;
  IF (NOT FOUND OR scope_closed IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM project_cleanup_controls c JOIN project_cleanup_restore_history r ON r.history_id=NEW.history_id WHERE c.control_id='beta' AND c.restore_status='restoring' AND r.envelope::jsonb->>'kind'='write' AND r.envelope::jsonb->>'writeId'=NEW.write_id AND r.envelope::jsonb->>'organizationId'=NEW.organization_id AND r.envelope::jsonb->>'projectId'=NEW.project_id AND r.envelope::jsonb->>'objectId'=NEW.object_id AND r.envelope::jsonb->>'contentSha256'=NEW.content_sha256 AND r.envelope::jsonb->>'principalId'=NEW.created_by_principal_id AND r.envelope::jsonb->>'storageNamespace'=NEW.storage_namespace) OR NEW.lifecycle_status<>'in-flight' THEN RAISE EXCEPTION 'project write scope is closed' USING ERRCODE='23514'; END IF;
  IF current_user::text = session_user::text AND session_user::text IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime') THEN
 SELECT locked_keys_json INTO ordinary_locked_keys FROM cloudmarkup_ordinary_private.lock_cleanup_control();
 IF NOT FOUND THEN RAISE EXCEPTION 'Ordinary lock evidence unavailable' USING ERRCODE='42501'; END IF;
 SELECT history_required INTO required FROM project_cleanup_controls WHERE control_id='beta';
 IF ordinary_locked_keys::jsonb IS DISTINCT FROM (CASE WHEN FOUND THEN '["fixed"]'::jsonb ELSE '[]'::jsonb END) THEN RAISE EXCEPTION 'Ordinary lock scope changed' USING ERRCODE='42501'; END IF;
ELSE
 SELECT history_required INTO required FROM project_cleanup_controls WHERE control_id='beta' FOR SHARE;
END IF;
  IF NOT FOUND OR required AND NEW.history_id IS NULL THEN RAISE EXCEPTION 'Durable writer history is required'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['lifecycle_status','finalized_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['lifecycle_status','finalized_at'])
  OR NEW.finalized_at IS NULL OR NEW.finalized_at<OLD.created_at
  OR NOT(OLD.lifecycle_status='in-flight' AND NEW.lifecycle_status IN('completed','uncertain')
    OR OLD.lifecycle_status='uncertain' AND NEW.lifecycle_status='completed' AND EXISTS(
      SELECT 1 FROM project_content_write_completion_proofs f WHERE f.write_id=OLD.write_id AND f.history_id=OLD.history_id AND f.history_state IN('completed','aborted')))
 THEN RAISE EXCEPTION 'project write outcome is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;

$cm$;

CREATE OR REPLACE FUNCTION public.cloudmarkup_assert_cleanup_admission_commit() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $cm$

DECLARE
  ordinary_locked_keys text;
  admission project_cleanup_admissions%ROWTYPE;
  required_admission boolean;
BEGIN
  IF TG_TABLE_NAME='projects' THEN


    SELECT * INTO admission FROM project_cleanup_admissions
      WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND expected_record_version+1=NEW.record_version
      AND (wake_binding::jsonb->>'deletionRequestedAt')::timestamptz=NEW.deletion_requested_at;
    IF NOT FOUND THEN


      IF OLD.lifecycle_status='deletion-pending' AND NEW.record_version=OLD.record_version
        AND NEW.deletion_requested_at IS NOT DISTINCT FROM OLD.deletion_requested_at THEN
        RETURN NEW;
      END IF;
      IF current_user::text = session_user::text AND session_user::text IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime') THEN
 SELECT locked_keys_json INTO ordinary_locked_keys FROM cloudmarkup_ordinary_private.lock_cleanup_control();
 IF NOT FOUND THEN RAISE EXCEPTION 'Ordinary lock evidence unavailable' USING ERRCODE='42501'; END IF;
 SELECT admission_required INTO required_admission FROM project_cleanup_controls WHERE control_id='beta';
 IF ordinary_locked_keys::jsonb IS DISTINCT FROM (CASE WHEN FOUND THEN '["fixed"]'::jsonb ELSE '[]'::jsonb END) THEN RAISE EXCEPTION 'Ordinary lock scope changed' USING ERRCODE='42501'; END IF;
ELSE
 SELECT admission_required INTO required_admission FROM project_cleanup_controls WHERE control_id='beta' FOR SHARE;
END IF;
      IF (NOT FOUND OR required_admission) AND NOT EXISTS(SELECT 1 FROM project_cleanup_controls c JOIN project_cleanup_restore_history r ON r.envelope::jsonb->'wake'->>'organizationId'=NEW.organization_id AND r.envelope::jsonb->'wake'->>'projectId'=NEW.project_id WHERE c.control_id='beta' AND c.restore_status='restoring' AND r.history_state='committed' AND r.envelope::jsonb->>'kind'='legacy-deletion' AND (r.envelope::jsonb->'wake'->>'recordVersion')::bigint=NEW.record_version AND (r.envelope::jsonb->'wake'->>'deletionRequestedAt')::timestamptz=NEW.deletion_requested_at) THEN
        RAISE EXCEPTION 'Durable cleanup admission is required';
      END IF;
      RETURN NEW;
    END IF;
  ELSE
    SELECT * INTO admission FROM project_cleanup_admissions WHERE admission_id=NEW.admission_id;
    IF admission.lifecycle_status<>'committed' THEN RETURN NEW; END IF;
  END IF;
  IF admission.lifecycle_status<>'committed' OR NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.organization_id=admission.organization_id AND p.project_id=admission.project_id
    AND ((p.lifecycle_status='deletion-pending' AND p.record_version=admission.expected_record_version+1
      AND p.deletion_requested_at=(admission.wake_binding::jsonb->>'deletionRequestedAt')::timestamptz)
      OR (p.lifecycle_status='deleted' AND EXISTS (
        SELECT 1 FROM project_content_erasure_receipts r WHERE r.organization_id=p.organization_id AND r.project_id=p.project_id
        AND r.deletion_record_version=admission.expected_record_version+1
        AND r.deletion_requested_at=(admission.wake_binding::jsonb->>'deletionRequestedAt')::timestamptz)))
  ) THEN
    RAISE EXCEPTION 'Cleanup admission and deletion must commit together';
  END IF;
  RETURN NEW;
END;

$cm$;

CREATE OR REPLACE FUNCTION public.cloudmarkup_guard_recovery_erasure_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $cm$

DECLARE ordinary_locked_keys text; required boolean;
BEGIN
  IF current_user::text = session_user::text AND session_user::text IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_cleanup_runtime') THEN
 SELECT locked_keys_json INTO ordinary_locked_keys FROM cloudmarkup_ordinary_private.lock_cleanup_control();
 IF NOT FOUND THEN RAISE EXCEPTION 'Ordinary lock evidence unavailable' USING ERRCODE='42501'; END IF;
 SELECT recovery_required INTO required FROM project_cleanup_controls WHERE control_id='beta';
 IF ordinary_locked_keys::jsonb IS DISTINCT FROM (CASE WHEN FOUND THEN '["fixed"]'::jsonb ELSE '[]'::jsonb END) THEN RAISE EXCEPTION 'Ordinary lock scope changed' USING ERRCODE='42501'; END IF;
ELSE
 SELECT recovery_required INTO required FROM project_cleanup_controls WHERE control_id='beta' FOR SHARE;
END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cleanup controls are unavailable'; END IF;
  IF required AND NOT EXISTS(SELECT 1 FROM project_cleanup_phases p
    WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id AND p.phase='erasing'
      AND p.deletion_record_version=NEW.deletion_record_version AND p.deletion_requested_at=NEW.deletion_requested_at) THEN
    RAISE EXCEPTION 'Permanent recovery publication seal is required';
  END IF;
  IF EXISTS(SELECT 1 FROM project_deletion_recovery_objects r WHERE r.organization_id=NEW.organization_id
    AND r.project_id=NEW.project_id AND r.lifecycle_status NOT IN('completed','aborted')) THEN RAISE EXCEPTION 'Recovery writes remain uncertain'; END IF;
  RETURN NEW;
END;

$cm$;

CREATE OR REPLACE FUNCTION public.require_model_reservation_lineage() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $cm$

BEGIN
  IF TG_OP='UPDATE' AND NEW.pricing_authority<>OLD.pricing_authority THEN
    RAISE EXCEPTION 'reservation pricing lineage is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.pricing_authority='model-provider-v1' THEN
  IF (
    NOT EXISTS(SELECT 1 FROM model_commercial_reservation_decisions d JOIN model_commercial_workflows w
      ON w.organization_id=d.organization_id AND w.scope_sha256=d.scope_sha256 AND w.workflow_id=d.workflow_id
      WHERE d.organization_id=NEW.organization_id AND d.canonical_reservation_id=NEW.reservation_id AND d.accepted
      AND d.project_id=NEW.project_id AND d.principal_id=NEW.acting_principal_id
      AND w.snapshot#>>'{resolvedContext,authorization,planVersionId}'=NEW.plan_version_id
      AND w.snapshot#>>'{resolvedContext,authorization,chargingPolicyVersion}'=NEW.charging_policy_version
      AND w.snapshot#>>'{resolvedContext,authorization,entitlementPolicyVersion}'=NEW.entitlement_policy_version
      AND w.snapshot#>>'{resolvedContext,estimateResult,primaryPricingVersionId}'=NEW.pricing_version_id
      AND w.snapshot#>>'{resolvedContext,selectedRoute,providerKey}'=NEW.provider_key
      AND w.snapshot#>>'{resolvedContext,selectedRoute,modelId}'=NEW.model_key
      AND w.snapshot#>>'{resolvedContext,selectedRoute,modelVersion}'=NEW.model_version
      AND w.snapshot#>>'{request,jobId}'=NEW.job_id
      AND w.fingerprint_sha256=NEW.request_sha256
      AND (w.snapshot#>>'{reservationIntent,requestedCreditUnits}')::numeric=NEW.reserved_credit_units)
    OR NEW.feature_key<>'ai-assisted-operations') THEN
    RAISE EXCEPTION 'model credit reservation requires canonical decision' USING ERRCODE='23514';
  END IF;
  END IF;
  RETURN NEW;
END;

$cm$;

CREATE OR REPLACE FUNCTION public.require_model_ledger_lineage() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $cm$

BEGIN
  IF EXISTS(SELECT 1 FROM credit_reservations r WHERE r.organization_id=NEW.organization_id AND r.reservation_id=NEW.reservation_id AND r.pricing_authority<>NEW.pricing_authority) THEN
    RAISE EXCEPTION 'ledger pricing lineage must equal reservation' USING ERRCODE='23514'; END IF;
  IF NEW.pricing_authority='model-provider-v1' THEN
  IF NOT EXISTS(
    SELECT 1 FROM credit_reservations r JOIN model_commercial_reservation_decisions d ON d.organization_id=r.organization_id AND d.canonical_reservation_id=r.reservation_id AND d.accepted
    WHERE r.organization_id=NEW.organization_id AND r.reservation_id=NEW.reservation_id AND r.pricing_authority=NEW.pricing_authority
      AND r.pricing_version_id=NEW.pricing_version_id AND r.project_id=NEW.project_id AND r.acting_principal_id=NEW.acting_principal_id
      AND r.feature_key=NEW.feature_key AND r.plan_version_id=NEW.plan_version_id
  ) THEN RAISE EXCEPTION 'model ledger requires exact canonical reservation lineage' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.pricing_authority='model-provider-v1' AND NEW.entry_kind<>'reservation' THEN
  IF NOT EXISTS(
    SELECT 1 FROM model_commercial_accounting_outcomes o WHERE o.organization_id=NEW.organization_id AND o.canonical_reservation_id=NEW.reservation_id
      AND o.ledger_entry_id=NEW.ledger_entry_id AND o.project_id=NEW.project_id AND o.principal_id=NEW.acting_principal_id
      AND ((o.outcome_kind='settlement' AND NEW.entry_kind='settlement'
          AND ((o.source_kind='preview-journal' AND o.live_validation_receipt_id IS NULL AND NEW.charging_scenario='model-preview-delivered-v1')
            OR (o.source_kind='live-invocation-journal' AND NEW.charging_scenario='model-evaluation-recorded-v2'
              AND EXISTS(SELECT 1 FROM model_live_proposal_validation_receipts v
                WHERE v.organization_id=o.organization_id AND v.project_id=o.project_id AND v.principal_id=o.principal_id
                  AND v.invocation_id=o.live_invocation_id AND v.receipt_id=o.live_validation_receipt_id
                  AND v.receipt_sha256=o.live_validation_receipt_sha256))
            OR (o.source_kind='live-repair-journal-v4' AND NEW.charging_scenario='model-evaluation-recorded-v2'
              AND o.receipt=cloudmarkup_recorded_repair_receipt_v4(o.organization_id,o.project_id,o.principal_id,
                o.scope_sha256,o.workflow_id,o.source_revision))))
        OR (o.outcome_kind='release' AND NEW.entry_kind IN ('release','provider-failure')
          AND NEW.charging_scenario=(CASE WHEN o.outcome#>>'{event,status}'='provider-failure'
            THEN 'provider-failure-before-useful-output' ELSE 'cloudmarkup-internal-failure' END)))
      AND (o.outcome#>>'{event,chargedCreditUnits}')::numeric=NEW.settled_credit_units
      AND (jsonb_array_length(o.outcome#>'{event,attempts}')=0 OR ((o.outcome->>'actualCreditUnits')::numeric=NEW.normalized_credit_units
        AND (o.outcome#>>'{event,estimatedProviderCostMicros}')::numeric=NEW.estimated_provider_cost_micros))
  ) THEN RAISE EXCEPTION 'model terminal accounting requires verified model evidence bridge' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;

$cm$;

CREATE OR REPLACE FUNCTION public.lock_commercial_credit_consumption_account() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $cm$

DECLARE
  target_billing_account_id VARCHAR(128);
BEGIN
  IF TG_TABLE_NAME = 'usage_ledger_entry_allocations' THEN
    IF NEW.credit_adjustment_units >= 0 THEN
      RETURN NEW;
    END IF;
    SELECT event.billing_account_id INTO target_billing_account_id
    FROM usage_ledger_entries event
    WHERE event.organization_id = NEW.organization_id
      AND event.ledger_entry_id = NEW.ledger_entry_id
      AND event.entry_kind = 'adjustment';
  ELSE
    SELECT reservation.billing_account_id INTO target_billing_account_id
    FROM credit_reservations reservation
    WHERE reservation.organization_id = NEW.organization_id
      AND reservation.reservation_id = NEW.reservation_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit consumption parent is not available'
      USING ERRCODE = '23514';
  END IF;

  IF current_user::text = session_user::text AND session_user::text IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime','cloudmarkup_beta_export_runtime','cloudmarkup_beta_billing_runtime') THEN
  PERFORM 1 FROM cloudmarkup_ordinary_private.lock_billing_account(NEW.organization_id::text)
  WHERE locked_keys_json::jsonb = '["fixed"]'::jsonb;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit consumption billing account is not available' USING ERRCODE = '23514';
  END IF;
  -- A fresh invoker statement preserves the original exact account predicate.
  PERFORM 1 FROM organization_billing_accounts account
  WHERE account.organization_id = NEW.organization_id
    AND account.billing_account_id = target_billing_account_id;
  ELSE
    -- Protected and private callers retain the original invoker lock path.
    PERFORM 1 FROM organization_billing_accounts account
    WHERE account.organization_id = NEW.organization_id
      AND account.billing_account_id = target_billing_account_id
    FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit consumption billing account is not available'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;

$cm$;

CREATE OR REPLACE FUNCTION cloudmarkup_verify_project_editing_commit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  ordinary_locked_keys TEXT;
  ordinary_membership_id TEXT;
  required_lease_id TEXT;
  holder_expires_at TIMESTAMPTZ;
  holder_authentication_expires_at TIMESTAMPTZ;
BEGIN
  IF OLD.pending_editing_lease_id IS NOT NULL
     AND NEW.pending_document_object_id IS NOT NULL
     AND NEW.pending_editing_lease_id IS NULL THEN
    RAISE EXCEPTION 'project editing lease proof cannot be removed' USING ERRCODE = '23514';
  END IF;

  IF ROW(NEW.draft_version, NEW.document_schema_version, NEW.document_object_id,
         NEW.content_sha256, NEW.semantic_sha256, NEW.visual_sha256)
     IS DISTINCT FROM
     ROW(OLD.draft_version, OLD.document_schema_version, OLD.document_object_id,
         OLD.content_sha256, OLD.semantic_sha256, OLD.visual_sha256) THEN
    required_lease_id := OLD.pending_editing_lease_id;
  ELSIF NEW.pending_document_object_id IS NOT NULL THEN
    required_lease_id := NEW.pending_editing_lease_id;
  ELSE
    -- Exact abandonment preserves the published document and retained objects.
    RETURN NULL;
  END IF;

  IF required_lease_id IS NULL THEN
    -- Serialize with first acquisition: an absent lease row cannot be locked.
    PERFORM 1 FROM projects p
    WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id
    FOR SHARE OF p;
    IF NOT FOUND OR EXISTS (
      SELECT 1 FROM project_editing_leases l
      WHERE l.organization_id=NEW.organization_id AND l.project_id=NEW.project_id
    ) THEN
      RAISE EXCEPTION 'project editing lease proof is required after first acquisition' USING ERRCODE = '23514';
    END IF;
    -- Only untouched historical/local projects may retain untagged writes.
    RETURN NULL;
  END IF;

  IF current_user::text=session_user::text AND session_user::text='cloudmarkup_beta_api_runtime' THEN
  SELECT l.expires_at, l.authentication_expires_at
    INTO holder_expires_at, holder_authentication_expires_at
  FROM project_editing_leases l
  JOIN projects p ON p.organization_id=l.organization_id AND p.project_id=l.project_id AND p.lifecycle_status='active'
  JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
  JOIN principals actor ON actor.principal_id=l.principal_id AND actor.lifecycle_status='active'
  JOIN memberships m ON m.organization_id=l.organization_id AND m.principal_id=l.principal_id AND m.lifecycle_status='active'
  JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    AND r.policy_version='authorization-v2'
    AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
    AND 'projects.mutate'=ANY(r.capabilities)
  WHERE l.organization_id=NEW.organization_id AND l.project_id=NEW.project_id
    AND l.lease_id=required_lease_id AND l.principal_id=NEW.updated_by_principal_id
    AND l.released_at IS NULL
  FOR SHARE OF l,p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'project editing lease expired before commit' USING ERRCODE='23514';
    END IF;
    SELECT locked_keys_json INTO ordinary_locked_keys FROM cloudmarkup_ordinary_private.lock_request_membership(NEW.updated_by_principal_id,NEW.organization_id);
  SELECT l.expires_at, l.authentication_expires_at, m.membership_id
    INTO holder_expires_at, holder_authentication_expires_at, ordinary_membership_id
  FROM project_editing_leases l
  JOIN projects p ON p.organization_id=l.organization_id AND p.project_id=l.project_id AND p.lifecycle_status='active'
  JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
  JOIN principals actor ON actor.principal_id=l.principal_id AND actor.lifecycle_status='active'
  JOIN memberships m ON m.organization_id=l.organization_id AND m.principal_id=l.principal_id AND m.lifecycle_status='active'
  JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    AND r.policy_version='authorization-v2'
    AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
    AND 'projects.mutate'=ANY(r.capabilities)
  WHERE l.organization_id=NEW.organization_id AND l.project_id=NEW.project_id
    AND l.lease_id=required_lease_id AND l.principal_id=NEW.updated_by_principal_id
    AND l.released_at IS NULL
  FOR SHARE OF l,p;
    IF NOT FOUND OR ordinary_locked_keys IS DISTINCT FROM jsonb_build_array(ordinary_membership_id)::text THEN
      RAISE EXCEPTION 'project editing membership changed before commit' USING ERRCODE='23514';
    END IF;
  ELSE
  SELECT l.expires_at, l.authentication_expires_at
    INTO holder_expires_at, holder_authentication_expires_at
  FROM project_editing_leases l
  JOIN projects p ON p.organization_id=l.organization_id AND p.project_id=l.project_id AND p.lifecycle_status='active'
  JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
  JOIN principals actor ON actor.principal_id=l.principal_id AND actor.lifecycle_status='active'
  JOIN memberships m ON m.organization_id=l.organization_id AND m.principal_id=l.principal_id AND m.lifecycle_status='active'
  JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    AND r.policy_version='authorization-v2'
    AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
    AND 'projects.mutate'=ANY(r.capabilities)
  WHERE l.organization_id=NEW.organization_id AND l.project_id=NEW.project_id
    AND l.lease_id=required_lease_id AND l.principal_id=NEW.updated_by_principal_id
    AND l.released_at IS NULL
  FOR SHARE OF l,p,o,actor,m,r;
  END IF;

  IF NOT FOUND OR holder_expires_at <= clock_timestamp()
     OR holder_authentication_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'project editing lease expired before commit' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_staff_trial_dispatch_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ordinary_locked_keys TEXT;
BEGIN
 IF OLD.state='reserved' AND NEW.state='dispatched' THEN
   IF current_user::text=session_user::text AND session_user::text IN ('cloudmarkup_beta_api_runtime','cloudmarkup_beta_proposal_runtime') THEN
     SELECT locked_keys_json INTO ordinary_locked_keys FROM cloudmarkup_ordinary_private.lock_billing_account_share(NEW.organization_id);
     PERFORM 1 FROM organization_billing_accounts WHERE organization_id=NEW.organization_id;
     IF ordinary_locked_keys IS DISTINCT FROM (CASE WHEN FOUND THEN '["fixed"]' ELSE '[]' END) THEN
       RAISE EXCEPTION 'Trial dispatch account changed' USING ERRCODE='23514';
     END IF;
   ELSE
   PERFORM 1 FROM organization_billing_accounts WHERE organization_id=NEW.organization_id FOR SHARE;
   END IF;
   IF EXISTS(SELECT 1 FROM credit_reservations r WHERE r.organization_id=NEW.organization_id AND r.reservation_id=NEW.reservation_id AND r.plan_version_id='planver_staff_trial_2026_10_06_v1')
     AND NOT EXISTS(SELECT 1 FROM credit_reservations r JOIN organization_billing_accounts a ON a.organization_id=r.organization_id AND a.billing_account_id=r.billing_account_id
       WHERE r.organization_id=NEW.organization_id AND r.reservation_id=NEW.reservation_id AND r.status='active' AND r.expires_at>clock_timestamp()
       AND a.lifecycle_status='active' AND a.expensive_operations_enabled AND cloudmarkup_staff_trial_current_v1(r.organization_id,r.billing_account_id))
   THEN RAISE EXCEPTION 'Trial dispatch authority expired or revoked' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION verify_ai_intent_preview_authority_commit() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE receipt ai_intent_preview_authorities%ROWTYPE;
  ordinary_locked_keys text;
  ordinary_observed_key text;
BEGIN
  IF TG_TABLE_NAME='ai_intent_previews' THEN
    IF NOT (
      (OLD.gateway_state='registered' AND NEW.gateway_state='claimed')
      OR (OLD.delivery_state='none' AND NEW.delivery_state='pending')
      OR (OLD.delivery_state='pending' AND NEW.delivery_state='acknowledged')) THEN
      RETURN NULL;
    END IF;
  END IF;
  SELECT * INTO receipt FROM ai_intent_preview_authorities a
    WHERE a.organization_id=NEW.organization_id AND a.project_id=NEW.project_id
      AND a.principal_id=NEW.principal_id AND a.invocation_id=NEW.invocation_id;
  IF NOT FOUND THEN
    -- Existing internal journals retain metadata compatibility. The production
    -- host requires issuance; an issued receipt cannot be removed for fallback.
    RETURN NULL;
  END IF;
  -- Normal application transactions take project -> role/lease/draft ->
  -- workflow -> preview locks before mutation. Recheck time at deferred commit.
  PERFORM 1 FROM projects p
    WHERE p.organization_id=receipt.organization_id AND p.project_id=receipt.project_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preview original project is unavailable' USING ERRCODE='23514';
  END IF;
  IF current_user::text=session_user::text AND session_user::text='cloudmarkup_beta_api_runtime' THEN
    SELECT locked_keys_json INTO ordinary_locked_keys
      FROM cloudmarkup_ordinary_private.lock_preview_ack_commit_authorization(
        receipt.organization_id,receipt.project_id,receipt.principal_id,receipt.invocation_id);
  SELECT jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,p.project_id,l.lease_id,d.draft_id,d.draft_version::text,d.document_object_id,obj.object_id)::text INTO ordinary_observed_key FROM projects p
    JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
    JOIN principals actor ON actor.principal_id=receipt.principal_id AND actor.lifecycle_status='active'
    JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    JOIN project_editing_leases l ON l.organization_id=p.organization_id AND l.project_id=p.project_id
    JOIN architecture_drafts d ON d.organization_id=p.organization_id AND d.project_id=p.project_id AND d.draft_id=p.current_draft_id
    JOIN stored_objects obj ON obj.organization_id=d.organization_id AND obj.project_id=d.project_id AND obj.object_id=d.document_object_id
    JOIN ai_intent_previews preview ON preview.organization_id=receipt.organization_id AND preview.project_id=receipt.project_id
      AND preview.principal_id=receipt.principal_id AND preview.invocation_id=receipt.invocation_id
    WHERE p.organization_id=receipt.organization_id AND p.project_id=receipt.project_id AND p.lifecycle_status='active'
      AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
      AND l.lease_id=receipt.lease_id AND l.principal_id=receipt.principal_id
      AND encode(sha256(convert_to(l.session_id,'UTF8')),'hex')=receipt.session_sha256
      AND l.released_at IS NULL AND l.expires_at>clock_timestamp() AND l.authentication_expires_at>clock_timestamp()
      AND receipt.authentication_expires_at>clock_timestamp()
      AND d.draft_id=receipt.draft_id AND d.draft_version=receipt.draft_version AND d.content_sha256=receipt.content_sha256
      AND d.pending_document_object_id IS NULL AND obj.lifecycle_state='published' AND obj.content_sha256=d.content_sha256
      AND obj.object_purpose='architecture-draft' AND preview.binding_sha256=receipt.binding_sha256
    ;
    IF NOT FOUND OR ordinary_locked_keys IS DISTINCT FROM jsonb_build_array(ordinary_observed_key)::text THEN
      RAISE EXCEPTION 'Preview original membership or publication changed' USING ERRCODE='23514';
    END IF;
  ELSE
  PERFORM 1 FROM projects p
    JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
    JOIN principals actor ON actor.principal_id=receipt.principal_id AND actor.lifecycle_status='active'
    JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    JOIN project_editing_leases l ON l.organization_id=p.organization_id AND l.project_id=p.project_id
    JOIN architecture_drafts d ON d.organization_id=p.organization_id AND d.project_id=p.project_id AND d.draft_id=p.current_draft_id
    JOIN stored_objects obj ON obj.organization_id=d.organization_id AND obj.project_id=d.project_id AND obj.object_id=d.document_object_id
    JOIN ai_intent_previews preview ON preview.organization_id=receipt.organization_id AND preview.project_id=receipt.project_id
      AND preview.principal_id=receipt.principal_id AND preview.invocation_id=receipt.invocation_id
    WHERE p.organization_id=receipt.organization_id AND p.project_id=receipt.project_id AND p.lifecycle_status='active'
      AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
      AND l.lease_id=receipt.lease_id AND l.principal_id=receipt.principal_id
      AND encode(sha256(convert_to(l.session_id,'UTF8')),'hex')=receipt.session_sha256
      AND l.released_at IS NULL AND l.expires_at>clock_timestamp() AND l.authentication_expires_at>clock_timestamp()
      AND receipt.authentication_expires_at>clock_timestamp()
      AND d.draft_id=receipt.draft_id AND d.draft_version=receipt.draft_version AND d.content_sha256=receipt.content_sha256
      AND d.pending_document_object_id IS NULL AND obj.lifecycle_state='published' AND obj.content_sha256=d.content_sha256
      AND obj.object_purpose='architecture-draft' AND preview.binding_sha256=receipt.binding_sha256
    FOR SHARE OF o,actor,m,r,l,d,obj;
    IF NOT FOUND THEN RAISE EXCEPTION 'preview original request authority expired or changed' USING ERRCODE='23514'; END IF;
  END IF;

  -- Locks can themselves wait beyond an expiry. Evaluate the clocks after all
  -- locks are acquired; release/takeover/draft mutations cannot race this read.
  IF receipt.authentication_expires_at<=clock_timestamp() OR NOT EXISTS (
    SELECT 1 FROM project_editing_leases l
    WHERE l.organization_id=receipt.organization_id AND l.project_id=receipt.project_id
      AND l.lease_id=receipt.lease_id AND l.released_at IS NULL
      AND l.expires_at>clock_timestamp() AND l.authentication_expires_at>clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'preview original request authority expired at commit' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='ai_intent_previews' THEN
    IF OLD.delivery_state='pending' AND NEW.delivery_state='acknowledged'
      AND NEW.delivery_expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'preview acknowledgement expired at commit' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
