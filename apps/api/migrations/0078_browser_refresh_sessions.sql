-- Private additive proposal. No token, code, verifier or tenant selector is stored.
CREATE TABLE browser_refresh_sessions (
  session_sha256 TEXT PRIMARY KEY CHECK (session_sha256 ~ '^[a-f0-9]{64}$'),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('exchanging','active','revoked')),
  principal_id TEXT REFERENCES principals(principal_id),
  provider_session_sha256 TEXT CHECK (provider_session_sha256 ~ '^[a-f0-9]{64}$'),
  authenticated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK ((lifecycle_status='active' AND principal_id IS NOT NULL AND provider_session_sha256 IS NOT NULL AND authenticated_at IS NOT NULL AND revoked_at IS NULL)
    OR (lifecycle_status='exchanging' AND principal_id IS NULL AND provider_session_sha256 IS NULL AND authenticated_at IS NULL AND revoked_at IS NULL)
    OR (lifecycle_status='revoked' AND revoked_at IS NOT NULL)),
  CHECK (authenticated_at IS NULL OR expires_at <= authenticated_at + INTERVAL '8 hours')
);

CREATE INDEX browser_refresh_sessions_expiry ON browser_refresh_sessions(expires_at);

CREATE FUNCTION cloudmarkup_guard_browser_refresh_session() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_sha256 IS DISTINCT FROM OLD.session_sha256
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.lifecycle_status='revoked'
    OR (OLD.lifecycle_status='active' AND NEW.lifecycle_status<>'revoked')
    OR (OLD.lifecycle_status='exchanging' AND NEW.lifecycle_status NOT IN ('active','revoked'))
    OR (OLD.principal_id IS NOT NULL AND (NEW.principal_id IS DISTINCT FROM OLD.principal_id
      OR NEW.provider_session_sha256 IS DISTINCT FROM OLD.provider_session_sha256
      OR NEW.authenticated_at IS DISTINCT FROM OLD.authenticated_at
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at)) THEN
    RAISE EXCEPTION 'invalid browser session transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_browser_refresh_session BEFORE UPDATE ON browser_refresh_sessions
FOR EACH ROW EXECUTE FUNCTION cloudmarkup_guard_browser_refresh_session();
