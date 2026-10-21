-- Application revocation metadata only. Provider credentials never enter storage.
CREATE TABLE account_authentication_cutoffs (
  principal_id TEXT PRIMARY KEY REFERENCES principals(principal_id),
  authenticated_through TIMESTAMPTZ NOT NULL
);
CREATE FUNCTION guard_account_authentication_cutoff_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.principal_id IS DISTINCT FROM OLD.principal_id
    OR NEW.authenticated_through<OLD.authenticated_through THEN
    RAISE EXCEPTION 'Authentication cutoffs cannot move backwards';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_authentication_cutoff_v1 BEFORE UPDATE OR DELETE ON account_authentication_cutoffs
FOR EACH ROW EXECUTE FUNCTION guard_account_authentication_cutoff_v1();

CREATE TABLE account_revoked_session_families (
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  provider_session_sha256 TEXT NOT NULL CHECK(provider_session_sha256 ~ '^[a-f0-9]{64}$'),
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(principal_id,provider_session_sha256)
);
CREATE TRIGGER account_revoked_session_families_immutable BEFORE UPDATE OR DELETE ON account_revoked_session_families
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
INSERT INTO account_revoked_session_families(principal_id,provider_session_sha256,revoked_at)
SELECT principal_id,provider_session_sha256,min(revoked_at) FROM browser_refresh_sessions
WHERE lifecycle_status='revoked' AND principal_id IS NOT NULL AND provider_session_sha256 IS NOT NULL
GROUP BY principal_id,provider_session_sha256;
CREATE FUNCTION record_browser_session_family_revocation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lifecycle_status='revoked' AND NEW.principal_id IS NOT NULL AND NEW.provider_session_sha256 IS NOT NULL THEN
    INSERT INTO account_revoked_session_families(principal_id,provider_session_sha256,revoked_at)
    VALUES(NEW.principal_id,NEW.provider_session_sha256,NEW.revoked_at) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER browser_session_family_revocation_v1 AFTER INSERT OR UPDATE ON browser_refresh_sessions
FOR EACH ROW EXECUTE FUNCTION record_browser_session_family_revocation_v1();

CREATE FUNCTION cloudmarkup_account_session_allowed_v1(actor TEXT,family TEXT,authenticated TIMESTAMPTZ,expires TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT expires>clock_timestamp() AND authenticated<=clock_timestamp()+INTERVAL '30 seconds'
    AND EXISTS(SELECT 1 FROM principals WHERE principal_id=actor AND lifecycle_status='active')
    AND NOT EXISTS(SELECT 1 FROM account_authentication_cutoffs WHERE principal_id=actor AND authenticated<=authenticated_through)
    AND NOT EXISTS(SELECT 1 FROM account_revoked_session_families WHERE principal_id=actor AND provider_session_sha256=family)
    AND NOT EXISTS(SELECT 1 FROM browser_refresh_sessions WHERE principal_id=actor AND provider_session_sha256=family
      AND (lifecycle_status='revoked' OR expires_at<=clock_timestamp()));
$$;
CREATE INDEX browser_refresh_sessions_principal_family ON browser_refresh_sessions(principal_id,provider_session_sha256);
CREATE TABLE account_session_change_receipts (
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  idempotency_key_sha256 TEXT NOT NULL CHECK(idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 TEXT NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
  receipt_json JSONB NOT NULL CHECK(jsonb_typeof(receipt_json)='object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(principal_id,idempotency_key_sha256),
  CHECK(receipt_json->>'principalId'=principal_id)
);
CREATE TRIGGER account_session_change_receipts_immutable BEFORE UPDATE OR DELETE ON account_session_change_receipts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
