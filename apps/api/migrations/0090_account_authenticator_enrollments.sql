-- Additive account authenticator metadata after 0089; no provider or account changes.
-- Enrollment and audit metadata only. Setup keys, tokens and codes are never stored.
ALTER TABLE account_credential_attempts DROP CONSTRAINT account_credential_attempts_action_check;
ALTER TABLE account_credential_attempts ADD CONSTRAINT account_credential_attempts_action_check
CHECK(action IN ('password-change','email-start','email-confirm','email-resend',
  'authenticator-start','authenticator-verify-enable','authenticator-cancel-setup','authenticator-disable'));
CREATE TABLE account_authenticator_enrollments (
  principal_id TEXT NOT NULL,
  enrollment_id UUID NOT NULL,
  provider_session_sha256 TEXT NOT NULL CHECK(provider_session_sha256 ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL CHECK(state IN ('starting','ready','verifying','uncertain','confirmed','cancelled')),
  last_attempt_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+INTERVAL '10 minutes'),
  PRIMARY KEY(principal_id,enrollment_id),
  FOREIGN KEY(principal_id,enrollment_id) REFERENCES account_credential_attempts(principal_id,attempt_id),
  FOREIGN KEY(principal_id,last_attempt_id) REFERENCES account_credential_attempts(principal_id,attempt_id)
);
CREATE INDEX account_authenticator_enrollments_active ON account_authenticator_enrollments(principal_id,expires_at DESC)
WHERE state NOT IN ('confirmed','cancelled');
CREATE TABLE account_authenticator_attempts (
  principal_id TEXT NOT NULL,
  attempt_id UUID NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('start','verify-enable','cancel-setup','disable')),
  enrollment_id UUID,
  PRIMARY KEY(principal_id,attempt_id),
  FOREIGN KEY(principal_id,attempt_id) REFERENCES account_credential_attempts(principal_id,attempt_id),
  FOREIGN KEY(principal_id,enrollment_id) REFERENCES account_authenticator_enrollments(principal_id,enrollment_id),
  CHECK(action='disable' OR enrollment_id IS NOT NULL),
  CHECK(action<>'start' OR attempt_id=enrollment_id)
);
CREATE TRIGGER account_authenticator_attempts_immutable BEFORE UPDATE OR DELETE ON account_authenticator_attempts
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
