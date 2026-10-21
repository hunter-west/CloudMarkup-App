-- Local hosted-validation preparation only; no provider dispatch or customer credit mutation.
CREATE TABLE hosted_terraform_validation_submissions (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  export_run_id VARCHAR(128) NOT NULL,
  validation_id VARCHAR(128) NOT NULL CHECK(validation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  workflow_request_sha256 CHAR(64) NOT NULL CHECK(workflow_request_sha256 ~ '^[a-f0-9]{64}$'),
  validation_request_sha256 CHAR(64) NOT NULL CHECK(validation_request_sha256 ~ '^[a-f0-9]{64}$'),
  policy_sha256 CHAR(64) NOT NULL CHECK(policy_sha256 ~ '^[a-f0-9]{64}$'),
  input_object_id VARCHAR(128) NOT NULL,
  input_object_version VARCHAR(1024) NOT NULL CHECK(length(input_object_version)>0),
  input_sha256 CHAR(64) NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
  submission_sha256 CHAR(64) NOT NULL UNIQUE CHECK(submission_sha256 ~ '^[a-f0-9]{64}$'),
  codebuild_project_arn VARCHAR(512) NOT NULL CHECK(codebuild_project_arn ~ '^arn:aws:codebuild:[a-z]{2}-[a-z]+-[0-9]:[0-9]{12}:project/[A-Za-z0-9][A-Za-z0-9_-]{1,149}$'),
  maximum_build_minutes SMALLINT NOT NULL CHECK(maximum_build_minutes BETWEEN 5 AND 480),
  monthly_build_minutes INTEGER NOT NULL CHECK(monthly_build_minutes BETWEEN maximum_build_minutes AND 100000),
  concurrent_builds SMALLINT NOT NULL CHECK(concurrent_builds BETWEEN 1 AND 100),
  first_attempt_id VARCHAR(128) NOT NULL CHECK(first_attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  reserved_at TIMESTAMPTZ NOT NULL,
  month_utc CHAR(7) NOT NULL CHECK(month_utc ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  retry_before TIMESTAMPTZ NOT NULL CHECK(retry_before>reserved_at AND retry_before<=reserved_at+INTERVAL '2 minutes'),
  provider_build_id VARCHAR(256),
  state VARCHAR(32) NOT NULL DEFAULT 'claimed' CHECK(state IN ('claimed','submitted','succeeded','failed','stopped')),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY(organization_id,project_id,export_run_id,validation_id),
  UNIQUE(organization_id,project_id,export_run_id),
  UNIQUE(codebuild_project_arn,provider_build_id),
  FOREIGN KEY(organization_id,project_id,export_run_id)
    REFERENCES solution_export_runs(organization_id,project_id,solution_export_run_id),
  FOREIGN KEY(organization_id,project_id,input_object_id)
    REFERENCES stored_objects(organization_id,project_id,object_id),
  CHECK((state='claimed')=(provider_build_id IS NULL)),
  CHECK((state IN ('succeeded','failed','stopped'))=(completed_at IS NOT NULL)),
  CHECK(provider_build_id IS NULL OR (provider_build_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,149}:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' AND split_part(provider_build_id,':',1)=split_part(codebuild_project_arn,'/',2)))
);

CREATE INDEX hosted_terraform_validation_budget ON hosted_terraform_validation_submissions(codebuild_project_arn,month_utc);

CREATE FUNCTION guard_hosted_terraform_validation_submission()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total_minutes BIGINT;
  active_builds BIGINT;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Hosted validation receipts cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-'provider_build_id'-'state'-'completed_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'provider_build_id'-'state'-'completed_at') OR
       (OLD.provider_build_id IS NOT NULL AND NEW.provider_build_id IS DISTINCT FROM OLD.provider_build_id) OR
       NOT ((OLD.state='claimed' AND NEW.state='submitted') OR
         (OLD.state='submitted' AND NEW.state IN ('succeeded','failed','stopped'))) THEN
      RAISE EXCEPTION 'Hosted validation receipt transition is invalid' USING ERRCODE='23514';
    END IF;
    IF NEW.state IN ('succeeded','failed','stopped') THEN
      NEW.completed_at:=clock_timestamp();
    END IF;
    RETURN NEW;
  END IF;
  -- The same fence covers every tenant and uncertain dispatch for this fixed project.
  PERFORM pg_advisory_xact_lock(hashtextextended('cloudmarkup:terraform-validation:'||NEW.codebuild_project_arn,0));
  NEW.reserved_at:=clock_timestamp();
  NEW.month_utc:=to_char(NEW.reserved_at AT TIME ZONE 'UTC','YYYY-MM');
  NEW.retry_before:=LEAST(NEW.reserved_at+INTERVAL '2 minutes',
    ((date_trunc('month',NEW.reserved_at AT TIME ZONE 'UTC')+INTERVAL '1 month') AT TIME ZONE 'UTC'));
  IF NEW.state<>'claimed' OR NEW.provider_build_id IS NOT NULL OR NEW.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Hosted validation must start with a reserved claim' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(maximum_build_minutes) FILTER(WHERE month_utc=NEW.month_utc),0),
    count(*) FILTER(WHERE state IN ('claimed','submitted')) INTO total_minutes,active_builds
    FROM hosted_terraform_validation_submissions WHERE codebuild_project_arn=NEW.codebuild_project_arn;
  IF total_minutes+NEW.maximum_build_minutes>NEW.monthly_build_minutes OR active_builds>=NEW.concurrent_builds THEN
    RAISE EXCEPTION 'Hosted validation build budget is unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_terraform_validation_submission_guard
BEFORE INSERT OR UPDATE OR DELETE ON hosted_terraform_validation_submissions
FOR EACH ROW EXECUTE FUNCTION guard_hosted_terraform_validation_submission();

COMMENT ON TABLE hosted_terraform_validation_submissions IS
'Tenant-bound immutable-input dispatch receipts. Worst-case platform build-minute reservations are never refunded; uncertain starts retain concurrency. No customer credits, source bodies, provider authority or deployment capability.';
