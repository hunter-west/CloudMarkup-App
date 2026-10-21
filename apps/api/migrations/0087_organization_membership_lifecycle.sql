-- Membership and invitation identities remain stable across a departure/rejoin.
ALTER TABLE memberships
  ADD COLUMN ended_at TIMESTAMPTZ,
  ADD COLUMN end_reason VARCHAR(16),
  ADD CONSTRAINT membership_departure CHECK (
    (ended_at IS NULL AND end_reason IS NULL) OR
    (ended_at IS NOT NULL AND end_reason IS NOT NULL AND lifecycle_status='suspended' AND end_reason IN ('removed','left'))
  );

-- Preserve old administrative SQL while making every semantic change visible
-- to conditional clients. Previously explicit version increments remain valid.
CREATE FUNCTION guard_membership_lifecycle_version_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.membership_id,NEW.organization_id,NEW.principal_id,NEW.joined_at)
    IS DISTINCT FROM ROW(OLD.membership_id,OLD.organization_id,OLD.principal_id,OLD.joined_at) THEN
    RAISE EXCEPTION 'Membership identity is immutable' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.role_key,NEW.lifecycle_status,NEW.ended_at,NEW.end_reason)
    IS DISTINCT FROM ROW(OLD.role_key,OLD.lifecycle_status,OLD.ended_at,OLD.end_reason) THEN
    IF NEW.record_version=OLD.record_version THEN NEW.record_version:=OLD.record_version+1;
    ELSIF NEW.record_version<>OLD.record_version+1 THEN
      RAISE EXCEPTION 'Membership change requires the next version' USING ERRCODE='23514';
    END IF;
    NEW.updated_at:=clock_timestamp();
  ELSIF NEW.record_version<>OLD.record_version THEN
    RAISE EXCEPTION 'Unchanged memberships retain their version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER membership_lifecycle_version_v1 BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION guard_membership_lifecycle_version_v1();

CREATE TABLE organization_membership_change_receipts (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  actor_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  idempotency_key_sha256 CHAR(64) NOT NULL CHECK(idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 CHAR(64) NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
  receipt_json JSONB NOT NULL CHECK(jsonb_typeof(receipt_json)='object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,actor_principal_id,idempotency_key_sha256),
  CHECK(receipt_json->>'organizationId'=organization_id AND receipt_json->>'actorPrincipalId'=actor_principal_id)
);
CREATE TRIGGER organization_membership_change_receipts_immutable BEFORE UPDATE OR DELETE ON organization_membership_change_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
