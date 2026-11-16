-- Explicit staff permission AND organization grant. No principals are enrolled.
ALTER TABLE platform_staff_authorizations DROP CONSTRAINT platform_staff_authorizations_permissions_check;
ALTER TABLE platform_staff_authorizations ADD CONSTRAINT platform_staff_authorizations_permissions_check
 CHECK(cardinality(permissions) BETWEEN 1 AND 7 AND permissions <@ ARRAY['accounts.read','credits.grant','credits.revoke','operations.manage','trials.grant','trials.revoke','provider-costs.read']::TEXT[]);

CREATE TABLE platform_staff_provider_cost_authorizations (
 principal_id VARCHAR(128) NOT NULL REFERENCES platform_staff_authorizations(principal_id),
 organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
 staff_authorization_version BIGINT NOT NULL CHECK(staff_authorization_version>0),
 record_version BIGINT NOT NULL DEFAULT 1 CHECK(record_version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 revoked_at TIMESTAMPTZ,
 PRIMARY KEY(principal_id,organization_id)
);
CREATE TABLE platform_staff_provider_cost_authorization_events (
 event_id TEXT PRIMARY KEY,
 principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
 organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
 staff_authorization_version BIGINT NOT NULL CHECK(staff_authorization_version>0),
 action TEXT NOT NULL CHECK(action IN ('authorized','revoked')),
 operator_reference TEXT NOT NULL CHECK(length(operator_reference) BETWEEN 1 AND 300),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 5 AND 300),
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER platform_staff_provider_cost_authorization_events_immutable
 BEFORE UPDATE OR DELETE ON platform_staff_provider_cost_authorization_events
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
-- No TTL, automatic grant, backfill, delete authority or financial mutation.
-- Authorization lifecycle and immutable audit retention remain governed by the
-- existing operator/security policy. Native grants and restore admission are separate.
