-- Private identity photo, independent of organization/project assets and profile name version.
CREATE TABLE principal_account_photos (
  principal_id VARCHAR(128) PRIMARY KEY REFERENCES principals(principal_id) ON DELETE CASCADE,
  record_version BIGINT NOT NULL CHECK(record_version BETWEEN 1 AND 9007199254740991),
  image_bytes BYTEA CHECK(image_bytes IS NULL OR (octet_length(image_bytes) BETWEEN 8 AND 184320 AND substring(image_bytes FROM 1 FOR 8)=decode('89504e470d0a1a0a','hex'))),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- Removal retains a versioned empty row to prevent stale-update ABA races; it retains no image.
CREATE FUNCTION guard_principal_account_photo_version_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.principal_id<>OLD.principal_id OR NEW.record_version<>OLD.record_version+1 OR NEW.image_bytes IS NOT DISTINCT FROM OLD.image_bytes THEN
    RAISE EXCEPTION 'Photo changes require immutable ownership and the next version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER principal_account_photo_version_v1 BEFORE UPDATE ON principal_account_photos
  FOR EACH ROW EXECUTE FUNCTION guard_principal_account_photo_version_v1();
CREATE TABLE principal_account_photo_events (
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  record_version BIGINT NOT NULL CHECK(record_version BETWEEN 1 AND 9007199254740991),
  action VARCHAR(16) NOT NULL CHECK(action IN ('changed','removed')),
  correlation_id VARCHAR(128) NOT NULL CHECK(length(correlation_id) BETWEEN 1 AND 128),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(principal_id,record_version)
);
CREATE TRIGGER principal_account_photo_events_immutable BEFORE UPDATE OR DELETE ON principal_account_photo_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
