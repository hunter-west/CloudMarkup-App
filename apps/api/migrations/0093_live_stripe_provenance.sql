-- Historical projections and receipts retain their original test provenance.
ALTER TABLE organization_subscription_projections ADD COLUMN provider_environment TEXT NOT NULL DEFAULT 'test' CHECK(provider_environment IN ('test','live'));
ALTER TABLE billing_webhook_events ADD COLUMN provider_environment TEXT NOT NULL DEFAULT 'test' CHECK(provider_environment IN ('test','live'));
CREATE TABLE billing_provider_cutovers (
 cutover_id TEXT PRIMARY KEY CHECK(cutover_id='stripe-test-to-live-v1'),
 actor_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 receipt_json JSONB NOT NULL CHECK(jsonb_typeof(receipt_json)='object')
);
CREATE TRIGGER billing_provider_cutovers_immutable BEFORE UPDATE OR DELETE ON billing_provider_cutovers FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
CREATE TABLE billing_cutover_projection_history (
 organization_id VARCHAR(128) PRIMARY KEY REFERENCES organizations(organization_id),
 projection_json JSONB NOT NULL CHECK(jsonb_typeof(projection_json)='object'),
 entitlement_json JSONB,
 archived_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER billing_cutover_projection_history_immutable BEFORE UPDATE OR DELETE ON billing_cutover_projection_history FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
-- Permit live sessions while preserving the existing purchase state machine.
ALTER TABLE credit_top_up_attempts DROP CONSTRAINT credit_top_up_attempts_provider_session_reference_check;
ALTER TABLE credit_top_up_attempts ADD CONSTRAINT credit_top_up_attempts_provider_session_reference_check CHECK(provider_session_reference ~ '^cs_(test|live)_[A-Za-z0-9_]+$');

CREATE FUNCTION enforce_billing_provider_mode() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.provider_environment='live') IS DISTINCT FROM EXISTS(SELECT 1 FROM billing_provider_cutovers WHERE cutover_id='stripe-test-to-live-v1') THEN
  RAISE EXCEPTION 'Billing mode requires its reviewed cutover';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER billing_projection_provider_mode BEFORE INSERT OR UPDATE ON organization_subscription_projections FOR EACH ROW EXECUTE FUNCTION enforce_billing_provider_mode();
CREATE TRIGGER billing_event_provider_mode BEFORE INSERT OR UPDATE ON billing_webhook_events FOR EACH ROW EXECUTE FUNCTION enforce_billing_provider_mode();
