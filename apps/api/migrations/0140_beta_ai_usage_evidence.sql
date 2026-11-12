-- Additive retained provider-usage evidence. Existing financial events and prices are unchanged.
-- Native ordinary-role, concurrent terminal recovery and restore qualification remain mandatory.

ALTER TABLE public.beta_ai_invocations
  ADD COLUMN usage_observed_at TIMESTAMPTZ,
  ADD COLUMN observed_provider_request_id VARCHAR(128),
  ADD COLUMN observed_input_tokens BIGINT,
  ADD COLUMN observed_output_tokens BIGINT,
  ADD COLUMN observed_cached_input_tokens BIGINT,
  ADD CONSTRAINT beta_ai_observed_usage_shape_v3 CHECK (
    (usage_observed_at IS NULL AND observed_provider_request_id IS NULL
      AND observed_input_tokens IS NULL AND observed_output_tokens IS NULL
      AND observed_cached_input_tokens IS NULL)
    OR (usage_observed_at IS NOT NULL AND dispatched_at IS NOT NULL
      AND observed_input_tokens IS NOT NULL AND observed_input_tokens BETWEEN 0 AND 9007199254740991
      AND observed_output_tokens IS NOT NULL AND observed_output_tokens BETWEEN 0 AND 9007199254740991
      AND observed_cached_input_tokens IS NOT NULL AND observed_cached_input_tokens BETWEEN 0 AND 9007199254740991
      AND (observed_provider_request_id IS NULL OR length(observed_provider_request_id)>0))
  );

CREATE FUNCTION public.enforce_beta_ai_observed_usage_v3()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.usage_observed_at IS NOT NULL THEN
      RAISE EXCEPTION 'provider usage cannot precede committed dispatch' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.usage_observed_at IS NOT NULL AND
    ROW(NEW.organization_id,NEW.reservation_id,NEW.project_id,NEW.job_id,NEW.purpose,
      NEW.request_sha256,NEW.dispatched_at,NEW.usage_observed_at,NEW.observed_provider_request_id,
      NEW.observed_input_tokens,NEW.observed_output_tokens,NEW.observed_cached_input_tokens)
    IS DISTINCT FROM
    ROW(OLD.organization_id,OLD.reservation_id,OLD.project_id,OLD.job_id,OLD.purpose,
      OLD.request_sha256,OLD.dispatched_at,OLD.usage_observed_at,OLD.observed_provider_request_id,
      OLD.observed_input_tokens,OLD.observed_output_tokens,OLD.observed_cached_input_tokens)
  THEN RAISE EXCEPTION 'committed provider usage evidence is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.usage_observed_at IS NOT NULL AND OLD.usage_observed_at IS NULL THEN
    IF OLD.dispatched_at IS NULL OR
      ROW(NEW.organization_id,NEW.reservation_id,NEW.project_id,NEW.job_id,NEW.purpose,NEW.request_sha256,NEW.dispatched_at)
      IS DISTINCT FROM
      ROW(OLD.organization_id,OLD.reservation_id,OLD.project_id,OLD.job_id,OLD.purpose,OLD.request_sha256,OLD.dispatched_at) THEN
      RAISE EXCEPTION 'provider usage requires committed dispatch' USING ERRCODE='23514';
    END IF;
    IF OLD.usage_recorded_at IS NOT NULL AND
      ROW(NEW.observed_provider_request_id,NEW.observed_input_tokens,NEW.observed_output_tokens,NEW.observed_cached_input_tokens)
      IS DISTINCT FROM ROW(OLD.provider_request_id,OLD.input_tokens,OLD.output_tokens,OLD.cached_input_tokens)
    THEN RAISE EXCEPTION 'provider usage conflicts with retained legacy evidence' USING ERRCODE='23514'; END IF;
    NEW.usage_observed_at:=clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_beta_ai_observed_usage_v3() FROM PUBLIC;
CREATE TRIGGER beta_ai_observed_usage_is_write_once_v3
  BEFORE INSERT OR UPDATE ON public.beta_ai_invocations FOR EACH ROW
  EXECUTE FUNCTION public.enforce_beta_ai_observed_usage_v3();
