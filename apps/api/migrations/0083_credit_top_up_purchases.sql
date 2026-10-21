-- Separate durable one-time purchase evidence; subscription attempts and grants
-- remain unchanged. No checkout, live charge or existing credit grant is created.
CREATE TABLE credit_top_up_attempts (
  attempt_id VARCHAR(128) PRIMARY KEY CHECK (attempt_id ~ '^topup_[a-f0-9]{32}$'),
  organization_id VARCHAR(128) NOT NULL,
  billing_account_id VARCHAR(128) NOT NULL,
  provider_customer_reference VARCHAR(255) NOT NULL CHECK (provider_customer_reference ~ '^cus_[A-Za-z0-9_]+$'),
  pack_key TEXT NOT NULL,
  policy_version TEXT NOT NULL CHECK (policy_version = 'cloudmarkup-credit-top-ups-2026-09-30-v1'),
  credit_units BIGINT NOT NULL,
  price_micros BIGINT NOT NULL,
  request_key_sha256 CHAR(64) NOT NULL CHECK (request_key_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 CHAR(64) NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  retry_before TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + INTERVAL '23 hours'),
  lifecycle_status TEXT NOT NULL DEFAULT 'pending' CHECK (lifecycle_status IN ('pending','created','expired','fulfilled','review')),
  provider_session_reference VARCHAR(255) UNIQUE CHECK (provider_session_reference ~ '^cs_test_[A-Za-z0-9_]+$'),
  provider_expires_at TIMESTAMPTZ,
  provider_payment_reference VARCHAR(255) UNIQUE CHECK (provider_payment_reference ~ '^pi_[A-Za-z0-9_]+$'),
  credit_grant_id VARCHAR(128),
  review_reason TEXT CHECK (review_reason IN ('refund','dispute','account-unavailable')),
  record_version BIGINT NOT NULL DEFAULT 1 CHECK (record_version > 0),
  FOREIGN KEY (organization_id,billing_account_id) REFERENCES organization_billing_accounts(organization_id,billing_account_id),
  FOREIGN KEY (organization_id,credit_grant_id) REFERENCES credit_grants(organization_id,credit_grant_id),
  UNIQUE (organization_id,billing_account_id,request_key_sha256),
  CHECK ((pack_key='small' AND credit_units=100 AND price_micros=5000000)
    OR (pack_key='medium' AND credit_units=350 AND price_micros=15000000)
    OR (pack_key='large' AND credit_units=800 AND price_micros=30000000)),
  CHECK (retry_before > created_at AND retry_before <= created_at + INTERVAL '23 hours 1 second'),
  CHECK ((lifecycle_status='pending' AND provider_session_reference IS NULL AND provider_expires_at IS NULL AND provider_payment_reference IS NULL AND credit_grant_id IS NULL AND review_reason IS NULL)
    OR (lifecycle_status IN ('created','expired') AND provider_session_reference IS NOT NULL AND provider_expires_at IS NOT NULL AND provider_payment_reference IS NULL AND credit_grant_id IS NULL AND review_reason IS NULL)
    OR (lifecycle_status='fulfilled' AND provider_session_reference IS NOT NULL AND provider_expires_at IS NOT NULL AND provider_payment_reference IS NOT NULL AND credit_grant_id IS NOT NULL)
    OR (lifecycle_status='review' AND provider_session_reference IS NOT NULL AND provider_expires_at IS NOT NULL AND provider_payment_reference IS NOT NULL AND credit_grant_id IS NULL AND review_reason IS NOT NULL))
);

CREATE UNIQUE INDEX credit_top_up_one_open_attempt ON credit_top_up_attempts (organization_id,billing_account_id)
  WHERE lifecycle_status IN ('pending','created');

CREATE FUNCTION validate_credit_top_up_attempt_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Credit purchase evidence is retained'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.lifecycle_status<>'pending' OR NEW.record_version<>1 THEN RAISE EXCEPTION 'Credit purchase must begin pending'; END IF;
    NEW.created_at:=clock_timestamp(); NEW.retry_before:=NEW.created_at+INTERVAL '23 hours';
    RETURN NEW;
  END IF;
  IF ROW(NEW.attempt_id,NEW.organization_id,NEW.billing_account_id,NEW.provider_customer_reference,NEW.pack_key,NEW.policy_version,NEW.credit_units,NEW.price_micros,NEW.request_key_sha256,NEW.request_sha256,NEW.created_at,NEW.retry_before)
    IS DISTINCT FROM ROW(OLD.attempt_id,OLD.organization_id,OLD.billing_account_id,OLD.provider_customer_reference,OLD.pack_key,OLD.policy_version,OLD.credit_units,OLD.price_micros,OLD.request_key_sha256,OLD.request_sha256,OLD.created_at,OLD.retry_before)
    OR NEW.record_version<>OLD.record_version+1
    OR (OLD.provider_session_reference IS NOT NULL AND ROW(NEW.provider_session_reference,NEW.provider_expires_at) IS DISTINCT FROM ROW(OLD.provider_session_reference,OLD.provider_expires_at))
    OR (OLD.provider_payment_reference IS NOT NULL AND NEW.provider_payment_reference IS DISTINCT FROM OLD.provider_payment_reference)
    OR (OLD.credit_grant_id IS NOT NULL AND NEW.credit_grant_id IS DISTINCT FROM OLD.credit_grant_id)
    OR NOT ((OLD.lifecycle_status='pending' AND NEW.lifecycle_status IN ('created','fulfilled','review'))
      OR (OLD.lifecycle_status='created' AND NEW.lifecycle_status IN ('expired','fulfilled','review'))
      OR (OLD.lifecycle_status='fulfilled' AND NEW.lifecycle_status='fulfilled' AND OLD.review_reason IS NULL AND NEW.review_reason IS NOT NULL))
    THEN RAISE EXCEPTION 'Credit purchase transition is immutable or contradictory'; END IF;
  IF NEW.lifecycle_status='fulfilled' AND NOT EXISTS (
    SELECT 1 FROM credit_grants g WHERE g.organization_id=NEW.organization_id AND g.billing_account_id=NEW.billing_account_id
      AND g.credit_grant_id=NEW.credit_grant_id AND g.grant_kind='purchased' AND g.credit_units=NEW.credit_units
      AND g.expiration_policy_kind='does-not-expire' AND g.expires_at IS NULL AND g.expiration_policy_version=NEW.policy_version
      AND g.grant_policy_version=NEW.policy_version AND g.source_reference='stripe-top-up:'||NEW.attempt_id
  ) THEN RAISE EXCEPTION 'Credit purchase requires its exact non-expiring ledger grant'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_top_up_attempt_transition BEFORE INSERT OR UPDATE OR DELETE ON credit_top_up_attempts
FOR EACH ROW EXECUTE FUNCTION validate_credit_top_up_attempt_transition();
