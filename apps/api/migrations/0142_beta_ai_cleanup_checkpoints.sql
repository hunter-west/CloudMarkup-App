-- Additive operational metadata only. No runtime admission, grant, TTL or purge.
-- Controls are independently owned by the qualified restore/hold operator.
CREATE TABLE beta_ai_cleanup_control (
 organization_id VARCHAR(128) PRIMARY KEY REFERENCES organizations(organization_id),
 restore_epoch VARCHAR(128) NOT NULL CHECK(restore_epoch ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 resume_allowed BOOLEAN NOT NULL DEFAULT FALSE,
 held BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE FUNCTION lock_beta_ai_cleanup_control_v1() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('beta-ai-cleanup-v1:' || COALESCE(NEW.organization_id,OLD.organization_id),0));
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND NEW.organization_id<>OLD.organization_id) THEN
  RAISE EXCEPTION 'cleanup control lineage is retained';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER beta_ai_cleanup_control_lock BEFORE INSERT OR UPDATE OR DELETE ON beta_ai_cleanup_control
 FOR EACH ROW EXECUTE FUNCTION lock_beta_ai_cleanup_control_v1();

CREATE TABLE beta_ai_cleanup_checkpoints (
 organization_id VARCHAR(128) PRIMARY KEY REFERENCES beta_ai_cleanup_control(organization_id),
 restore_epoch VARCHAR(128) NOT NULL,
 generation BIGINT NOT NULL CHECK(generation>=0),
 snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=131072),
 CHECK((snapshot->>'organizationId'=organization_id AND snapshot->>'restoreEpoch'=restore_epoch AND snapshot->>'generation'=generation::text) IS TRUE)
);
CREATE TABLE beta_ai_cleanup_operations (
 organization_id VARCHAR(128) NOT NULL REFERENCES beta_ai_cleanup_control(organization_id),
 restore_epoch VARCHAR(128) NOT NULL,
 operation_id TEXT NOT NULL CHECK(operation_id ~ '^[a-f0-9]{64}$'),
 payload_sha256 TEXT NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 kind TEXT NOT NULL CHECK(kind IN ('prepare','complete')),
 checkpoint JSONB NOT NULL CHECK(jsonb_typeof(checkpoint)='object' AND octet_length(checkpoint::text)<=131072),
 identities JSONB NOT NULL CHECK(jsonb_typeof(identities)='array' AND jsonb_array_length(identities)<=25 AND octet_length(identities::text)<=65536),
 verification_sha256 TEXT CHECK(verification_sha256 ~ '^[a-f0-9]{64}$'),
 verified_completed_at TIMESTAMPTZ,
 PRIMARY KEY(organization_id,restore_epoch,operation_id),
 CHECK((checkpoint->>'organizationId'=organization_id AND checkpoint->>'restoreEpoch'=restore_epoch) IS TRUE),
 CHECK((verification_sha256 IS NULL AND verified_completed_at IS NULL) OR (kind='complete' AND verification_sha256 IS NOT NULL AND verified_completed_at IS NOT NULL))
);
CREATE FUNCTION stamp_beta_ai_cleanup_completion_v1() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.verified_completed_at IS NOT NULL THEN RAISE EXCEPTION 'completion time is server assigned'; END IF;
 IF NEW.kind='complete' AND NEW.verification_sha256 IS NOT NULL THEN NEW.verified_completed_at=date_trunc('milliseconds',clock_timestamp()); END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER beta_ai_cleanup_completion_clock BEFORE INSERT ON beta_ai_cleanup_operations
 FOR EACH ROW EXECUTE FUNCTION stamp_beta_ai_cleanup_completion_v1();
CREATE TRIGGER beta_ai_cleanup_operations_immutable BEFORE UPDATE OR DELETE ON beta_ai_cleanup_operations
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TABLE beta_ai_cleanup_outcomes (
 organization_id VARCHAR(128) NOT NULL,
 reservation_id VARCHAR(128) NOT NULL,
 restore_epoch VARCHAR(128) NOT NULL,
 identity JSONB NOT NULL CHECK(jsonb_typeof(identity)='object' AND octet_length(identity::text)<=4096),
 financial_status TEXT NOT NULL CHECK(financial_status IN ('released','pending','conflict')),
 cleanup_status TEXT NOT NULL CHECK(cleanup_status IN ('complete','pending')),
 accounting_status TEXT NOT NULL CHECK(accounting_status IN ('known','not-incurred','unresolved','conflict')),
 verification_sha256 TEXT CHECK(verification_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,reservation_id),
 FOREIGN KEY(organization_id,reservation_id) REFERENCES beta_ai_invocations(organization_id,reservation_id),
 CHECK((identity->>'organizationId'=organization_id AND identity->>'reservationId'=reservation_id) IS TRUE),
 CHECK(verification_sha256 IS NULL OR (financial_status='released' AND cleanup_status='complete'))
);
CREATE TABLE beta_ai_cleanup_diagnostics (
 organization_id VARCHAR(128) NOT NULL,
 restore_epoch VARCHAR(128) NOT NULL,
 operation_id TEXT NOT NULL,
 details JSONB CHECK(details IS NULL OR (jsonb_typeof(details)='array' AND jsonb_array_length(details)<=25 AND octet_length(details::text)<=65536)),
 retired_at TIMESTAMPTZ,
 PRIMARY KEY(organization_id,restore_epoch,operation_id),
 FOREIGN KEY(organization_id,restore_epoch,operation_id) REFERENCES beta_ai_cleanup_operations(organization_id,restore_epoch,operation_id),
 CHECK((details IS NULL)=(retired_at IS NOT NULL))
);
CREATE FUNCTION retain_beta_ai_cleanup_diagnostic_identity_v1() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW.organization_id,NEW.restore_epoch,NEW.operation_id) IS DISTINCT FROM (OLD.organization_id,OLD.restore_epoch,OLD.operation_id)
 OR OLD.retired_at IS NOT NULL OR NEW.details IS NOT NULL OR NEW.retired_at IS NULL THEN
  RAISE EXCEPTION 'cleanup retirement identity is immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER beta_ai_cleanup_diagnostic_identity BEFORE UPDATE OR DELETE ON beta_ai_cleanup_diagnostics
 FOR EACH ROW EXECUTE FUNCTION retain_beta_ai_cleanup_diagnostic_identity_v1();
-- Operations, active controls, unresolved outcomes and canonical usage/financial
-- evidence are excluded from the 60-day operational-details policy. No cascade.
-- Restore must pause/fence before runtime access, reconcile retained receipts and
-- canonical evidence, rotate the independently admitted epoch, then resume.
