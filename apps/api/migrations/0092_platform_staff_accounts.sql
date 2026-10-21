-- Platform authority is separate from customer memberships. No public enrollment.
CREATE TABLE platform_staff_authorizations (
 principal_id VARCHAR(128) PRIMARY KEY REFERENCES principals(principal_id),
 permissions TEXT[] NOT NULL CHECK(cardinality(permissions) BETWEEN 1 AND 4 AND permissions <@ ARRAY['accounts.read','credits.grant','credits.revoke','operations.manage']::TEXT[]),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 revoked_at TIMESTAMPTZ,
 record_version BIGINT NOT NULL DEFAULT 1 CHECK(record_version>0)
);
CREATE TABLE platform_staff_authorization_events (
 event_id TEXT PRIMARY KEY,
 principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
 permissions TEXT[] NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('authorized','revoked')),
 operator_reference TEXT NOT NULL CHECK(length(operator_reference) BETWEEN 1 AND 300),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 5 AND 300),
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER platform_staff_authorization_events_immutable BEFORE UPDATE OR DELETE ON platform_staff_authorization_events
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
CREATE TABLE platform_staff_account_actions (
 action_id VARCHAR(128) PRIMARY KEY,
 principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
 organization_id VARCHAR(128) NOT NULL,
 billing_account_id VARCHAR(128) NOT NULL,
 idempotency_key_sha256 TEXT NOT NULL CHECK(idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
 request_sha256 TEXT NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 action TEXT NOT NULL CHECK(action IN ('grant-credits','revoke-credits','set-operations')),
 credit_grant_id VARCHAR(128),
 ledger_entry_id VARCHAR(128),
 receipt_json JSONB NOT NULL CHECK(jsonb_typeof(receipt_json)='object'),
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(principal_id,idempotency_key_sha256),
 FOREIGN KEY(organization_id,billing_account_id) REFERENCES organization_billing_accounts(organization_id,billing_account_id),
 FOREIGN KEY(organization_id,credit_grant_id) REFERENCES credit_grants(organization_id,credit_grant_id),
 FOREIGN KEY(organization_id,ledger_entry_id) REFERENCES usage_ledger_entries(organization_id,ledger_entry_id),
 CHECK(receipt_json->>'organizationId'=organization_id AND receipt_json->>'billingAccountId'=billing_account_id AND receipt_json->>'actorPrincipalId'=principal_id AND receipt_json->>'actionId'=action_id AND receipt_json->>'action'=action)
);
CREATE INDEX platform_staff_account_actions_history ON platform_staff_account_actions(organization_id,occurred_at DESC,action_id);
CREATE TRIGGER platform_staff_account_actions_immutable BEFORE UPDATE OR DELETE ON platform_staff_account_actions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
