-- INTEGRATION PROPOSAL ONLY: append to prospective 0058 after reviewed metadata.
-- Not a live migration and not runtime-discovered. No V3 dispatch exception.
CREATE FUNCTION require_model_live_sequence_reservation_snapshot(org VARCHAR)
RETURNS VOID AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'read committed invocation reservation required' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||org,0));
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE FUNCTION enforce_model_live_sequence_selection_snapshot() RETURNS TRIGGER AS $$
BEGIN
  PERFORM require_model_live_sequence_reservation_snapshot(NEW.organization_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;
CREATE TRIGGER model_live_sequence_selections_00_read_committed
BEFORE INSERT ON model_live_sequence_selections FOR EACH ROW
EXECUTE FUNCTION enforce_model_live_sequence_selection_snapshot();

CREATE FUNCTION enforce_model_live_set_sequence_reservation() RETURNS TRIGGER AS $$
BEGIN
  PERFORM require_model_live_sequence_reservation_snapshot(NEW.organization_id);
  -- This separate post-lock query obtains its current snapshot under READ COMMITTED.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.set_record->'entries') e
    JOIN model_live_sequence_selections s ON s.organization_id=NEW.organization_id
    CROSS JOIN LATERAL jsonb_array_elements(s.selection_record->'stages') stage
    WHERE stage->>'invocationId'=e->>'invocationId') THEN
    RAISE EXCEPTION 'invocation identity reserved by immutable sequence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;
CREATE TRIGGER model_live_invocation_sets_00_sequence_reservation
BEFORE INSERT ON model_live_invocation_sets FOR EACH ROW
EXECUTE FUNCTION enforce_model_live_set_sequence_reservation();

CREATE FUNCTION enforce_model_live_journal_sequence_reservation() RETURNS TRIGGER AS $$
BEGIN
  PERFORM require_model_live_sequence_reservation_snapshot(NEW.organization_id);
  -- No V3 journal bridge exists. A selected stage ID cannot be used by either V2 path.
  IF EXISTS(SELECT 1 FROM model_live_sequence_selections s
    CROSS JOIN LATERAL jsonb_array_elements(s.selection_record->'stages') stage
    WHERE s.organization_id=NEW.organization_id AND stage->>'invocationId'=NEW.invocation_id) THEN
    RAISE EXCEPTION 'invocation identity reserved by immutable sequence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;
CREATE TRIGGER model_live_invocations_00_sequence_reservation
BEFORE INSERT ON model_live_invocations FOR EACH ROW
EXECUTE FUNCTION enforce_model_live_journal_sequence_reservation();
