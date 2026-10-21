-- Principal-owned attempt metadata only; never credentials, verification codes, or provider payloads.
CREATE TABLE account_credential_attempts (
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  attempt_id UUID NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('password-change','email-start','email-confirm','email-resend')),
  provider_session_sha256 TEXT NOT NULL CHECK(provider_session_sha256 ~ '^[a-f0-9]{64}$'),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) BETWEEN 1 AND 128),
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(principal_id,attempt_id)
);
CREATE INDEX account_credential_attempts_recent ON account_credential_attempts(principal_id,started_at DESC);
CREATE TRIGGER account_credential_attempts_immutable BEFORE UPDATE OR DELETE ON account_credential_attempts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
CREATE TABLE account_credential_outcomes (
  principal_id TEXT NOT NULL,
  attempt_id UUID NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','rejected','uncertain')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(principal_id,attempt_id),
  FOREIGN KEY(principal_id,attempt_id) REFERENCES account_credential_attempts(principal_id,attempt_id)
);
CREATE TRIGGER account_credential_outcomes_immutable BEFORE UPDATE OR DELETE ON account_credential_outcomes
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
