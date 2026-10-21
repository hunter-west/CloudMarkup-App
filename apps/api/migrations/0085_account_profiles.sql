-- Existing identity-provider subjects and tenant references remain unchanged.
ALTER TABLE principals
  ADD COLUMN public_username VARCHAR(32) UNIQUE,
  ADD COLUMN profile_record_version BIGINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT principal_profile_version CHECK (profile_record_version BETWEEN 1 AND 9007199254740991),
  ADD CONSTRAINT principal_public_username CHECK (public_username IS NULL OR (
    public_username ~ '^[a-z][a-z0-9_]{2,31}$' AND
    public_username NOT IN ('admin','administrator','api','billing','cloudmarkup','help','security','support','system')
  ));

CREATE FUNCTION guard_principal_profile_version_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.display_name,NEW.public_username) IS DISTINCT FROM ROW(OLD.display_name,OLD.public_username) THEN
    IF NEW.profile_record_version<>OLD.profile_record_version+1 THEN
      RAISE EXCEPTION 'Profile changes require the next version' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.profile_record_version<>OLD.profile_record_version THEN
    RAISE EXCEPTION 'Unchanged profiles retain their version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER principal_profile_version_v1 BEFORE UPDATE ON principals
  FOR EACH ROW EXECUTE FUNCTION guard_principal_profile_version_v1();

CREATE TABLE principal_profile_events (
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  profile_record_version BIGINT NOT NULL CHECK(profile_record_version>1),
  display_name_changed BOOLEAN NOT NULL,
  username_changed BOOLEAN NOT NULL,
  correlation_id VARCHAR(128) NOT NULL CHECK(length(correlation_id) BETWEEN 1 AND 128),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(principal_id,profile_record_version),
  CHECK(display_name_changed OR username_changed)
);
CREATE TRIGGER principal_profile_events_immutable BEFORE UPDATE OR DELETE ON principal_profile_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
