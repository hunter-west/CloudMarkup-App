-- Definitions only. Business and protected-column grants are separately unarmed.
-- The ordinary API receives no direct model workflow SELECT or producer access.
CREATE OR REPLACE FUNCTION cloudmarkup_ordinary_private.verify_preview_ack_canonical(
  p_organization text,p_project text,p_principal text,p_scope text,p_workflow text,
  p_request jsonb,p_dispatch text,p_reservation text,p_route jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $cm$
DECLARE workflow_snapshot jsonb;
BEGIN
  IF session_user::text<>'cloudmarkup_beta_api_runtime' OR current_user::text<>'cloudmarkup_admin'
    OR current_database()<>'cloudmarkup' OR current_setting('session_replication_role')<>'origin'
    OR pg_catalog.has_parameter_privilege(session_user,'session_replication_role','SET, ALTER SYSTEM') THEN
    RAISE EXCEPTION 'Ordinary preview authority unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.model_commercial_workflows'::regclass
    AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Ordinary preview requires reviewed row security' USING ERRCODE='42501';
  END IF;
  SELECT snapshot INTO workflow_snapshot FROM public.model_commercial_workflows
    WHERE organization_id=p_organization AND project_id=p_project AND principal_id=p_principal
      AND scope_sha256=p_scope AND workflow_id=p_workflow;
  IF workflow_snapshot IS NULL OR workflow_snapshot->'request' IS DISTINCT FROM p_request
    OR workflow_snapshot#>>'{dispatchIntent,dispatchIntentId}' IS DISTINCT FROM p_dispatch
    OR workflow_snapshot#>>'{reservationReceipt,result,reservationId}' IS DISTINCT FROM p_reservation
    OR workflow_snapshot#>>'{reservationReceipt,result,accepted}' IS DISTINCT FROM 'true'
    OR workflow_snapshot#>'{resolvedContext,selectedRoute}' IS DISTINCT FROM p_route THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$cm$;
ALTER FUNCTION cloudmarkup_ordinary_private.verify_preview_ack_canonical(text,text,text,text,text,jsonb,text,text,jsonb) OWNER TO cloudmarkup_admin;
REVOKE ALL ON FUNCTION cloudmarkup_ordinary_private.verify_preview_ack_canonical(text,text,text,text,text,jsonb,text,text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.validate_ai_intent_preview_transition() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $cm$
DECLARE workflow_snapshot JSONB;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.gateway_state<>'registered' OR NEW.gateway_claim IS NOT NULL OR NEW.normalized_usage IS NOT NULL
      OR NEW.generation_evidence IS NOT NULL OR NEW.delivery_state<>'none' OR NEW.delivery_proof_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'preview must begin without invocation or delivery evidence' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.invocation_id,NEW.scope_sha256,NEW.workflow_id,
      NEW.reservation_id,NEW.dispatch_intent_id,NEW.idempotency_sha256,NEW.binding_sha256,NEW.binding,NEW.callback_metadata,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.organization_id,OLD.project_id,OLD.principal_id,OLD.invocation_id,OLD.scope_sha256,OLD.workflow_id,
      OLD.reservation_id,OLD.dispatch_intent_id,OLD.idempotency_sha256,OLD.binding_sha256,OLD.binding,OLD.callback_metadata,OLD.created_at)
      OR (OLD.gateway_state IN ('complete','failed') AND NEW.gateway_state<>OLD.gateway_state)
      OR (OLD.gateway_state='registered' AND NEW.gateway_state NOT IN ('registered','claimed'))
      OR (OLD.gateway_state='claimed' AND NEW.gateway_state NOT IN ('claimed','complete','failed'))
      OR (OLD.gateway_claim IS NOT NULL AND NEW.gateway_claim IS DISTINCT FROM OLD.gateway_claim)
      OR (OLD.normalized_usage IS NOT NULL AND NEW.normalized_usage IS DISTINCT FROM OLD.normalized_usage)
      OR (OLD.generation_evidence IS NOT NULL AND NEW.generation_evidence IS DISTINCT FROM OLD.generation_evidence)
      OR (OLD.output_sha256 IS NOT NULL AND ROW(NEW.output_sha256,NEW.output_bytes) IS DISTINCT FROM ROW(OLD.output_sha256,OLD.output_bytes))
      OR (OLD.delivery_state IN ('acknowledged','unconfirmed') AND NEW.delivery_state<>OLD.delivery_state)
      OR (OLD.delivery_state='pending' AND NEW.delivery_state NOT IN ('pending','acknowledged','unconfirmed'))
      OR (OLD.delivery_proof_sha256 IS NOT NULL AND ROW(NEW.delivery_proof_sha256,NEW.delivery_opened_at,NEW.delivery_expires_at,NEW.output_evidence_sha256)
        IS DISTINCT FROM ROW(OLD.delivery_proof_sha256,OLD.delivery_opened_at,OLD.delivery_expires_at,OLD.output_evidence_sha256))
      OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at) THEN
      RAISE EXCEPTION 'preview evidence is immutable or contradictory' USING ERRCODE='23514';
    END IF;
  END IF;
  IF current_user::text=session_user::text AND session_user::text='cloudmarkup_beta_api_runtime' THEN
    IF NOT cloudmarkup_ordinary_private.verify_preview_ack_canonical(
      NEW.organization_id::text,NEW.project_id::text,NEW.principal_id::text,NEW.scope_sha256::text,NEW.workflow_id::text,
      NEW.binding->'request',NEW.dispatch_intent_id::text,NEW.reservation_id::text,NEW.callback_metadata->'route') THEN
      RAISE EXCEPTION 'preview requires an exact canonical commercial dispatch' USING ERRCODE='23514';
    END IF;
  ELSE
  SELECT snapshot INTO workflow_snapshot FROM model_commercial_workflows
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id;
  IF workflow_snapshot IS NULL OR workflow_snapshot->'request' IS DISTINCT FROM NEW.binding->'request'
    OR workflow_snapshot#>>'{dispatchIntent,dispatchIntentId}' IS DISTINCT FROM NEW.dispatch_intent_id
    OR workflow_snapshot#>>'{reservationReceipt,result,reservationId}' IS DISTINCT FROM NEW.reservation_id
    OR workflow_snapshot#>>'{reservationReceipt,result,accepted}' IS DISTINCT FROM 'true'
    OR workflow_snapshot#>'{resolvedContext,selectedRoute}' IS DISTINCT FROM NEW.callback_metadata->'route' THEN
    RAISE EXCEPTION 'preview requires an exact canonical commercial dispatch' USING ERRCODE='23514';
  END IF;
  END IF;
  RETURN NEW;
END;
$cm$;
