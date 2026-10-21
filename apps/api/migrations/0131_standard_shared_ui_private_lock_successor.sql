-- CloudMarkup additive migration 0131; fixed reviewed source closure.
-- PROPOSAL ONLY. Unregistered/unapplied forward replacements.
-- Load after the original shared UI proposal and private receipt helper contract.
-- Original SQL history and all origin/semantic/NULL rejection guards are retained.
CREATE OR REPLACE FUNCTION enforce_standard_ui_origin() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE n model_live_native_zero_receipts%ROWTYPE;
BEGIN
  SELECT * INTO n FROM cloudmarkup_notes_native_private.lock_native_zero_receipt(
    NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.plan_sha256,NEW.native_receipt_id,NEW.native_receipt_sha256);
  IF (NOT FOUND OR n.record ? 'sharedUi' OR NEW.issued_at<n.issued_at
    OR NEW.record->>'sourceDigest'<>n.record->>'sourceDigest'
    OR NEW.record->>'nativeResultDigest'<>n.record->>'nativeResultDigest'
    OR NEW.record->>'configurationDigest'<>n.record->>'configurationDigest') IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION 'actual original Standard native receipt required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_standard_native_ui_successor() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE n model_live_native_zero_receipts%ROWTYPE;u model_live_standard_ui_receipts%ROWTYPE;
BEGIN
  IF NOT NEW.record ? 'sharedUi' THEN RETURN NEW; END IF;
  IF (NEW.record#>>'{sharedUi,reference,uiReceiptId}' IS NOT NULL
    AND NEW.record#>>'{sharedUi,reference,uiReceiptDigest}' ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE
  THEN RAISE EXCEPTION 'actual issued Standard UI reference required' USING ERRCODE='23514'; END IF;
  SELECT * INTO u FROM cloudmarkup_notes_native_private.lock_standard_ui_receipt(
    NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.plan_sha256,
    NEW.record#>>'{sharedUi,reference,uiReceiptId}',substring(NEW.record#>>'{sharedUi,reference,uiReceiptDigest}' FROM 8));
  IF (NOT FOUND OR NEW.issued_at<u.issued_at OR NEW.record#>'{sharedUi,nativeZero}'<>u.record->'nativeZero') IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION 'actual issued Standard UI reference required' USING ERRCODE='23514'; END IF;
  SELECT * INTO n FROM cloudmarkup_notes_native_private.lock_native_zero_receipt(
    NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.plan_sha256,u.native_receipt_id,u.native_receipt_sha256);
  IF (NOT FOUND OR n.record ? 'sharedUi' OR NEW.receipt_id=n.receipt_id
    OR (NEW.record-ARRAY['receiptId','receiptDigest','issuedAt','caseResult','sharedUi'])<>
       (n.record-ARRAY['receiptId','receiptDigest','issuedAt','caseResult','sharedUi'])
    OR (SELECT jsonb_agg(s) FROM jsonb_array_elements(NEW.record#>'{caseResult,scores}') s
      WHERE s->>'dimension'<>'same-ui-semantics-across-assistance-preferences')<>
       (SELECT jsonb_agg(s) FROM jsonb_array_elements(n.record#>'{caseResult,scores}') s
      WHERE s->>'dimension'<>'same-ui-semantics-across-assistance-preferences')) IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION 'Standard UI successor must preserve actual native facts' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
