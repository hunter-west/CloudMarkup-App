-- Owner-approved hard USD 50 cap for app-controlled model dispatches only.
-- Separate from customer credits. No body content or refundable accounting.
CREATE TABLE model_platform_spend_reservations (
  dispatch_id VARCHAR(41) PRIMARY KEY CHECK (dispatch_id ~ '^dispatch_[a-f0-9]{32}$'),
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  project_id VARCHAR(128),
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  scope_sha256 CHAR(64) NOT NULL CHECK (scope_sha256 ~ '^[0-9a-f]{64}$'),
  invocation_id VARCHAR(128) NOT NULL CHECK (invocation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  claim_sha256 CHAR(64) NOT NULL CHECK (claim_sha256 ~ '^[0-9a-f]{64}$'),
  invocation_sha256 CHAR(64) NOT NULL CHECK (invocation_sha256 ~ '^[0-9a-f]{64}$'),
  provider_id VARCHAR(256) NOT NULL,
  model_id VARCHAR(256) NOT NULL,
  model_version VARCHAR(128) NOT NULL,
  inference_profile_id VARCHAR(256) NOT NULL,
  pricing_version_id VARCHAR(256) NOT NULL,
  pricing_version_sha256 CHAR(64) NOT NULL CHECK (pricing_version_sha256 ~ '^[0-9a-f]{64}$'),
  maximum_cost_micro_usd BIGINT NOT NULL CHECK (maximum_cost_micro_usd BETWEEN 1 AND 50000000),
  pricing_valid_from TIMESTAMPTZ NOT NULL,
  pricing_valid_until TIMESTAMPTZ NOT NULL CHECK (pricing_valid_until > pricing_valid_from),
  month_utc CHAR(7) NOT NULL CHECK (month_utc ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  reserved_at TIMESTAMPTZ NOT NULL,
  dispatch_before TIMESTAMPTZ NOT NULL CHECK (dispatch_before > reserved_at AND dispatch_before <= reserved_at + INTERVAL '5 seconds'),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id)
);

CREATE INDEX model_platform_spend_month_index ON model_platform_spend_reservations(month_utc);

CREATE FUNCTION reserve_model_platform_monthly_spend()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reserved_total BIGINT;
BEGIN
  -- All tenants and attempts use one fence, also enforced for direct SQL inserts.
  PERFORM pg_advisory_xact_lock(hashtextextended('cloudmarkup:model-platform-monthly-usd:v1',0));
  NEW.reserved_at := clock_timestamp();
  NEW.month_utc := to_char(NEW.reserved_at AT TIME ZONE 'UTC','YYYY-MM');
  NEW.dispatch_before := LEAST(NEW.reserved_at + INTERVAL '5 seconds',
    ((date_trunc('month',NEW.reserved_at AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC'),
    NEW.pricing_valid_until);
  IF NEW.reserved_at < NEW.pricing_valid_from OR NEW.reserved_at >= NEW.pricing_valid_until THEN
    RAISE EXCEPTION 'Model platform pricing authority is not current';
  END IF;
  SELECT COALESCE(SUM(maximum_cost_micro_usd),0) INTO reserved_total
    FROM model_platform_spend_reservations WHERE month_utc=NEW.month_utc;
  IF NEW.maximum_cost_micro_usd < 1 OR NEW.maximum_cost_micro_usd > 50000000 OR
      reserved_total + NEW.maximum_cost_micro_usd > 50000000 THEN
    RAISE EXCEPTION 'Model platform monthly spending cap exceeded';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_platform_spend_reserve BEFORE INSERT ON model_platform_spend_reservations
FOR EACH ROW EXECUTE FUNCTION reserve_model_platform_monthly_spend();

CREATE TRIGGER model_platform_spend_immutable BEFORE UPDATE OR DELETE ON model_platform_spend_reservations
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

COMMENT ON TABLE model_platform_spend_reservations IS
'Append-only worst-case USD reservations across all application tenants. Database UTC month and fixed 50,000,000 micro-USD cap. No release, refund, prompt bodies, tenant credit authority or permission to invoke.';
