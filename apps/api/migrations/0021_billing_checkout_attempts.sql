-- An external-effect guard, not a subscription, entitlement or credit grant.
CREATE TABLE billing_checkout_attempts (
  attempt_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  billing_account_id VARCHAR(128) NOT NULL,
  request_key_sha256 CHAR(64) NOT NULL CHECK (request_key_sha256 ~ '^[0-9a-f]{64}$'),
  request_sha256 CHAR(64) NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  lifecycle_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (lifecycle_status IN ('pending', 'created', 'expired', 'consumed')),
  provider_session_reference VARCHAR(255) UNIQUE,
  provider_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  retry_before TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + INTERVAL '23 hours'),
  retired_at TIMESTAMPTZ,
  record_version BIGINT NOT NULL DEFAULT 1 CHECK (record_version > 0),
  FOREIGN KEY (organization_id, billing_account_id)
    REFERENCES organization_billing_accounts(organization_id, billing_account_id),
  UNIQUE (organization_id, billing_account_id, request_key_sha256),
  CHECK (retry_before > created_at AND retry_before <= created_at + INTERVAL '23 hours 1 second'),
  CHECK (
    (lifecycle_status = 'pending' AND provider_session_reference IS NULL AND provider_expires_at IS NULL AND retired_at IS NULL)
    OR
    (lifecycle_status = 'created' AND provider_session_reference IS NOT NULL AND provider_expires_at IS NOT NULL AND retired_at IS NULL)
    OR
    (lifecycle_status IN ('expired', 'consumed') AND provider_session_reference IS NOT NULL AND provider_expires_at IS NOT NULL AND retired_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX billing_checkout_one_open_attempt
  ON billing_checkout_attempts (organization_id, billing_account_id)
  WHERE lifecycle_status IN ('pending', 'created');

CREATE FUNCTION validate_billing_checkout_attempt_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status <> 'pending' OR NEW.record_version <> 1
       OR NEW.provider_session_reference IS NOT NULL
       OR NEW.provider_expires_at IS NOT NULL OR NEW.retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'Checkout attempt must begin without external-effect evidence';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.retry_before := NEW.created_at + INTERVAL '23 hours';
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Checkout attempt evidence is retained';
  END IF;
  IF ROW(NEW.attempt_id, NEW.organization_id, NEW.billing_account_id,
         NEW.request_key_sha256, NEW.request_sha256, NEW.created_at, NEW.retry_before)
     IS DISTINCT FROM
     ROW(OLD.attempt_id, OLD.organization_id, OLD.billing_account_id,
         OLD.request_key_sha256, OLD.request_sha256, OLD.created_at, OLD.retry_before)
     OR NEW.record_version <> OLD.record_version + 1
     OR NOT (
       (OLD.lifecycle_status = 'pending' AND NEW.lifecycle_status = 'created')
       OR (OLD.lifecycle_status = 'created' AND NEW.lifecycle_status IN ('expired', 'consumed')
           AND NEW.provider_session_reference = OLD.provider_session_reference
           AND NEW.provider_expires_at = OLD.provider_expires_at)
     ) THEN
    RAISE EXCEPTION 'Checkout attempt transition is immutable or contradictory';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER billing_checkout_attempt_transition
BEFORE INSERT OR UPDATE OR DELETE ON billing_checkout_attempts
FOR EACH ROW EXECUTE FUNCTION validate_billing_checkout_attempt_transition();
