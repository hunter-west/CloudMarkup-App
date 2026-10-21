-- Canonical provider-direct journal definitions; source registration only.
-- No runtime grants or roles are armed here. Apply the separately reviewed ACL
-- only in the assigned operator-owned fixture/deployment scope after admission.

CREATE TABLE public.provider_direct_invocations_v1 (
  organization_id varchar(128) NOT NULL,
  project_id varchar(128) NOT NULL,
  principal_id varchar(128) NOT NULL REFERENCES public.principals(principal_id),
  invocation_id varchar(128) NOT NULL,
  job_id varchar(128) NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 2),
  feature varchar(128) NOT NULL CHECK (feature IN ('architecture.propose','application-source.generate')),
  model_role varchar(32) NOT NULL CHECK (model_role IN ('architecture','applicationSource')),
  idempotency_key_sha256 char(64) NOT NULL CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  usage_record_id varchar(128) NOT NULL,
  binding_metadata jsonb NOT NULL,
  binding_sha256 char(64) NOT NULL CHECK (binding_sha256 ~ '^[0-9a-f]{64}$'),
  authority_metadata jsonb NOT NULL,
  authority_sha256 char(64) NOT NULL CHECK (authority_sha256 ~ '^[0-9a-f]{64}$'),
  lease_token uuid NOT NULL,
  quota_window_id varchar(128) NOT NULL,
  quota_metadata jsonb NOT NULL,
  quota_sha256 char(64) NOT NULL CHECK (quota_sha256 ~ '^[0-9a-f]{64}$'),
  reserved_output_units numeric(39,0) NOT NULL CHECK (reserved_output_units BETWEEN 1 AND 12000),
  state varchar(32) NOT NULL CHECK (state IN ('claimed','dispatched','observed','finished','not-dispatched','uncertain')),
  usage_metadata jsonb,
  usage_sha256 char(64) CHECK (usage_sha256 ~ '^[0-9a-f]{64}$'),
  outcome_metadata jsonb,
  outcome_sha256 char(64) CHECK (outcome_sha256 ~ '^[0-9a-f]{64}$'),
  uncertain_reason varchar(64) CHECK (uncertain_reason IN ('dispatch-fence-failed','transport','body','canceled','usage-unavailable','usage-journal-failed','outcome-journal-failed')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,invocation_id),
  UNIQUE (organization_id,idempotency_key_sha256),
  UNIQUE (organization_id,usage_record_id),
  -- New invocation/key/attempt identities cannot turn an uncertain job/role
  -- into a second paid request. A separately authorized new job is distinct.
  UNIQUE (organization_id,job_id,feature,model_role),
  FOREIGN KEY (organization_id,project_id) REFERENCES public.projects(organization_id,project_id),
  FOREIGN KEY (organization_id,job_id) REFERENCES public.async_jobs(organization_id,job_id),
  CHECK (binding_metadata->>'fundingSource'='provider-direct'),
  CHECK (jsonb_typeof(binding_metadata)='object' AND binding_metadata ?& ARRAY['contractVersion','fundingSource','providerId','modelId','modelVersion','role','operationVersion','promptTemplateId','promptVersion','promptDigest','inputDigest','wireDigest','schemaDigest','configurationDigest','maximumOutputTokens','maximumInputBytes','maximumRequestBytes','maximumResponseBytes','deadlineMilliseconds','attemptNumber','feature','idempotencyKeyDigest','invocationId','scope','usageRecordId']),
  CHECK (jsonb_typeof(binding_metadata->'scope')='object' AND binding_metadata->'scope' ?& ARRAY['organizationId','projectId','userId','jobId']),
  CHECK (jsonb_typeof(authority_metadata)='object' AND authority_metadata ?& ARRAY['attemptId','workerReference','jobInputDigest','correlationId']),
  CHECK (jsonb_typeof(quota_metadata)='object' AND quota_metadata ?& ARRAY['windowId','startsAt','expiresAt','maximumRequests','maximumOutputTokenUnits','maximumConcurrent']),
  CHECK (quota_metadata->>'windowId'=quota_window_id AND (quota_metadata->>'maximumRequests')::integer BETWEEN 1 AND 1000000
    AND (quota_metadata->>'maximumConcurrent')::integer BETWEEN 1 AND 1000 AND quota_metadata->>'maximumOutputTokenUnits' ~ '^[1-9][0-9]{0,37}$'),
  CHECK (binding_metadata->>'invocationId'=invocation_id AND binding_metadata->>'usageRecordId'=usage_record_id),
  CHECK (binding_metadata->>'feature'=feature AND binding_metadata->>'role'=model_role),
  CHECK ((binding_metadata->>'attemptNumber')::integer=attempt_number),
  CHECK (binding_metadata->'scope'->>'organizationId'=organization_id AND binding_metadata->'scope'->>'projectId'=project_id
    AND binding_metadata->'scope'->>'userId'=principal_id AND binding_metadata->'scope'->>'jobId'=job_id),
  CHECK (binding_metadata->>'idempotencyKeyDigest'='sha256:'||idempotency_key_sha256),
  CHECK ((binding_metadata->>'maximumOutputTokens')::numeric=reserved_output_units),
  CHECK ((usage_metadata IS NULL)=(usage_sha256 IS NULL)),
  CHECK ((outcome_metadata IS NULL)=(outcome_sha256 IS NULL)),
  CHECK (state NOT IN ('claimed','dispatched','not-dispatched') OR usage_metadata IS NULL),
  CHECK (state NOT IN ('observed','finished') OR usage_metadata IS NOT NULL),
  CHECK ((state IN ('finished','not-dispatched'))=(outcome_metadata IS NOT NULL)),
  CHECK ((state='uncertain')=(uncertain_reason IS NOT NULL)),
  CHECK (usage_metadata IS NULL OR (NOT usage_metadata ? 'result' AND jsonb_typeof(usage_metadata)='object')),
  CHECK (octet_length(binding_metadata::text)<=16384 AND octet_length(authority_metadata::text)<=4096 AND octet_length(quota_metadata::text)<=4096
    AND (usage_metadata IS NULL OR octet_length(usage_metadata::text)<=16384) AND (outcome_metadata IS NULL OR octet_length(outcome_metadata::text)<=18432))
);
CREATE INDEX provider_direct_quota_v1 ON public.provider_direct_invocations_v1(organization_id,quota_window_id,state);

-- Fixed identity/permission/job-family authority. Locks are acquired inside the
-- invoker's existing transaction; this helper has no credit/payment authority.
CREATE FUNCTION public.cloudmarkup_provider_direct_assert_authority_v1(
  p_organization varchar, p_project varchar, p_principal varchar, p_job varchar,
  p_attempt varchar, p_attempt_number integer, p_worker varchar, p_input_hash char(64),
  p_correlation varchar, p_family varchar
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $body$
DECLARE permission varchar;
BEGIN
  IF session_user='cloudmarkup_beta_proposal_runtime' AND p_family='architecture-proposal' THEN permission:='projects.mutate';
  ELSIF session_user='cloudmarkup_beta_export_runtime' AND p_family='application-source-generation' THEN permission:='exports.run';
  ELSE RETURN false; END IF;
  PERFORM j.job_id FROM public.async_jobs j
    JOIN public.async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id
    JOIN public.projects p ON p.organization_id=j.organization_id AND p.project_id=j.project_id
    JOIN public.principals actor ON actor.principal_id=j.created_by_principal_id
    JOIN public.memberships m ON m.organization_id=j.organization_id AND m.principal_id=actor.principal_id
    JOIN public.organizations o ON o.organization_id=j.organization_id
    JOIN public.organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    WHERE j.organization_id=p_organization AND j.project_id=p_project AND j.job_id=p_job AND j.family=p_family
      AND j.created_by_principal_id=p_principal AND j.idempotency_actor_id=p_principal
      AND j.input_sha256=p_input_hash AND j.correlation_id=p_correlation AND j.lifecycle_status='running'
      AND j.cancellation_requested_at IS NULL AND (j.expires_at IS NULL OR j.expires_at>clock_timestamp())
      AND a.attempt_id=p_attempt AND a.attempt_number=p_attempt_number
      AND a.worker_reference=p_worker AND a.lifecycle_status='running' AND a.lease_expires_at>clock_timestamp()
      AND a.attempt_number=(SELECT max(latest.attempt_number) FROM public.async_job_attempts latest WHERE latest.organization_id=j.organization_id AND latest.job_id=j.job_id)
      AND p.lifecycle_status='active' AND actor.lifecycle_status='active' AND m.lifecycle_status='active' AND o.lifecycle_status='active'
      AND r.policy_version='authorization-v2' AND r.capabilities=public.cloudmarkup_authorization_v2_permissions(r.role_key)
      AND permission=ANY(r.capabilities)
    FOR SHARE OF j,a,p,actor,m,o,r;
  IF NOT FOUND THEN RETURN false; END IF;
  -- FOR SHARE may have waited without any row update. Re-evaluate wall-clock
  -- and newest-attempt evidence after the locks are actually held.
  RETURN EXISTS (SELECT 1 FROM public.async_jobs j JOIN public.async_job_attempts a
    ON a.organization_id=j.organization_id AND a.job_id=j.job_id
    WHERE j.organization_id=p_organization AND j.project_id=p_project AND j.job_id=p_job
      AND j.lifecycle_status='running' AND j.cancellation_requested_at IS NULL
      AND (j.expires_at IS NULL OR j.expires_at>clock_timestamp())
      AND a.attempt_id=p_attempt AND a.attempt_number=p_attempt_number AND a.worker_reference=p_worker
      AND a.lifecycle_status='running' AND a.lease_expires_at>clock_timestamp()
      AND a.attempt_number=(SELECT max(latest.attempt_number) FROM public.async_job_attempts latest
        WHERE latest.organization_id=j.organization_id AND latest.job_id=j.job_id));
END;
$body$;
REVOKE ALL ON FUNCTION public.cloudmarkup_provider_direct_assert_authority_v1(varchar,varchar,varchar,varchar,varchar,integer,varchar,char,varchar,varchar) FROM PUBLIC;

CREATE FUNCTION public.cloudmarkup_provider_direct_journal_transition_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
DECLARE family varchar; request_count bigint; concurrent_count bigint; token_units numeric; quota_matches boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'claimed' OR NEW.revision<>1 OR NEW.usage_metadata IS NOT NULL OR NEW.outcome_metadata IS NOT NULL THEN RAISE EXCEPTION 'Invalid provider-direct transition' USING ERRCODE='23514'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('provider-direct:'||NEW.organization_id,0));
    IF current_setting('transaction_isolation')<>'read committed' OR clock_timestamp()<(NEW.quota_metadata->>'startsAt')::timestamptz
      OR clock_timestamp()>=(NEW.quota_metadata->>'expiresAt')::timestamptz THEN RAISE EXCEPTION 'Provider-direct quota unavailable' USING ERRCODE='23514'; END IF;
    SELECT count(*) FILTER (WHERE quota_window_id=NEW.quota_window_id AND state<>'not-dispatched' OR quota_window_id<>NEW.quota_window_id AND state IN ('claimed','dispatched','observed','uncertain')),
      count(*) FILTER (WHERE state IN ('claimed','dispatched','observed','uncertain')),
      COALESCE(sum(CASE WHEN usage_metadata IS NOT NULL THEN (usage_metadata->>'outputUnits')::numeric WHEN state='not-dispatched' THEN 0 ELSE reserved_output_units END)
        FILTER (WHERE quota_window_id=NEW.quota_window_id OR state IN ('claimed','dispatched','observed','uncertain')),0),
      bool_and(quota_sha256=NEW.quota_sha256) FILTER (WHERE quota_window_id=NEW.quota_window_id)
      INTO request_count,concurrent_count,token_units,quota_matches FROM public.provider_direct_invocations_v1 WHERE organization_id=NEW.organization_id;
    IF request_count>=(NEW.quota_metadata->>'maximumRequests')::bigint OR concurrent_count>=(NEW.quota_metadata->>'maximumConcurrent')::bigint
      OR token_units+NEW.reserved_output_units>(NEW.quota_metadata->>'maximumOutputTokenUnits')::numeric OR quota_matches=false
      THEN RAISE EXCEPTION 'Provider-direct quota unavailable' USING ERRCODE='23514'; END IF;
  ELSE
    IF ROW(NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.invocation_id,NEW.job_id,NEW.attempt_number,NEW.feature,NEW.model_role,
      NEW.idempotency_key_sha256,NEW.usage_record_id,NEW.binding_metadata,NEW.binding_sha256,NEW.authority_metadata,NEW.authority_sha256,NEW.lease_token,
      NEW.quota_window_id,NEW.quota_metadata,NEW.quota_sha256,NEW.reserved_output_units,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.organization_id,OLD.project_id,OLD.principal_id,OLD.invocation_id,OLD.job_id,OLD.attempt_number,OLD.feature,OLD.model_role,
      OLD.idempotency_key_sha256,OLD.usage_record_id,OLD.binding_metadata,OLD.binding_sha256,OLD.authority_metadata,OLD.authority_sha256,OLD.lease_token,
      OLD.quota_window_id,OLD.quota_metadata,OLD.quota_sha256,OLD.reserved_output_units,OLD.created_at)
      OR NEW.revision<>OLD.revision+1 OR OLD.state IN ('finished','not-dispatched','uncertain')
      OR NOT ((OLD.state='claimed' AND NEW.state IN ('dispatched','not-dispatched','uncertain'))
        OR (OLD.state='dispatched' AND NEW.state IN ('observed','uncertain')) OR (OLD.state='observed' AND NEW.state IN ('finished','uncertain')))
      OR (OLD.usage_metadata IS NOT NULL AND (NEW.usage_metadata IS DISTINCT FROM OLD.usage_metadata OR NEW.usage_sha256 IS DISTINCT FROM OLD.usage_sha256))
      THEN RAISE EXCEPTION 'Invalid provider-direct transition' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.state IN ('claimed','dispatched') THEN
    family:=CASE NEW.model_role WHEN 'architecture' THEN 'architecture-proposal' ELSE 'application-source-generation' END;
    IF NOT public.cloudmarkup_provider_direct_assert_authority_v1(NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.job_id,
      NEW.authority_metadata->>'attemptId',NEW.attempt_number,NEW.authority_metadata->>'workerReference',
      substring(NEW.authority_metadata->>'jobInputDigest' FROM 8)::char(64),NEW.authority_metadata->>'correlationId',family)
      THEN RAISE EXCEPTION 'Provider-direct authority unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  IF NEW.usage_metadata IS NOT NULL AND (
    NEW.usage_metadata->>'invocationId' IS DISTINCT FROM NEW.invocation_id OR NEW.usage_metadata->>'usageRecordId' IS DISTINCT FROM NEW.usage_record_id
    OR NEW.usage_metadata->'scope' IS DISTINCT FROM NEW.binding_metadata->'scope'
    OR NEW.usage_metadata->>'inputDigest' IS DISTINCT FROM NEW.binding_metadata->>'inputDigest'
    OR NEW.usage_metadata->>'modelId' IS DISTINCT FROM NEW.binding_metadata->>'modelId'
    OR NEW.usage_metadata->>'modelVersion' IS DISTINCT FROM NEW.binding_metadata->>'modelVersion'
    OR NEW.usage_metadata->>'providerId' IS DISTINCT FROM NEW.binding_metadata->>'providerId'
    OR NEW.usage_metadata->>'feature' IS DISTINCT FROM NEW.feature
    OR NEW.usage_metadata->>'idempotencyKeyDigest' IS DISTINCT FROM NEW.binding_metadata->>'idempotencyKeyDigest'
    OR NEW.usage_metadata->>'promptTemplateId' IS DISTINCT FROM NEW.binding_metadata->>'promptTemplateId'
    OR NEW.usage_metadata->>'promptVersion' IS DISTINCT FROM NEW.binding_metadata->>'promptVersion'
    OR NEW.usage_metadata->>'attemptNumber' IS DISTINCT FROM NEW.binding_metadata->>'attemptNumber'
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['inputUnits','outputUnits','cacheReadUnits','cacheWriteUnits','thinkingUnits']) unit
      WHERE NOT COALESCE(NEW.usage_metadata->>unit ~ '^(0|[1-9][0-9]{0,38})$',false))
    ) THEN RAISE EXCEPTION 'Invalid provider-direct observation' USING ERRCODE='23514'; END IF;
  IF NEW.state='finished' AND (NEW.outcome_metadata->>'state' NOT IN ('succeeded','provider-error','canceled','invalid-output')
    OR NEW.outcome_metadata->'usage'->>'result' IS DISTINCT FROM NEW.outcome_metadata->>'state'
    OR (NEW.outcome_metadata->'usage'-'result') IS DISTINCT FROM NEW.usage_metadata)
    THEN RAISE EXCEPTION 'Invalid provider-direct outcome' USING ERRCODE='23514'; END IF;
  IF NEW.state='not-dispatched' AND NEW.outcome_metadata<>jsonb_build_object('state','not-dispatched') THEN RAISE EXCEPTION 'Invalid provider-direct outcome' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (clock_timestamp()<(NEW.quota_metadata->>'startsAt')::timestamptz
    OR clock_timestamp()>=(NEW.quota_metadata->>'expiresAt')::timestamptz)
    THEN RAISE EXCEPTION 'Provider-direct quota unavailable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION public.cloudmarkup_provider_direct_journal_transition_v1() FROM PUBLIC;
CREATE TRIGGER provider_direct_transition_v1 BEFORE INSERT OR UPDATE ON public.provider_direct_invocations_v1
FOR EACH ROW EXECUTE FUNCTION public.cloudmarkup_provider_direct_journal_transition_v1();

ALTER TABLE public.provider_direct_invocations_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_direct_invocations_v1 FORCE ROW LEVEL SECURITY;
-- Hosted beta may not have the standalone proposal/export logins. With no
-- policy, FORCE ROW LEVEL SECURITY denies every runtime role; creating either
-- login or a PUBLIC policy here would arm an unreviewed access path.
DO $provider_direct_policy$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='cloudmarkup_beta_proposal_runtime')
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='cloudmarkup_beta_export_runtime') THEN
   EXECUTE $policy_sql$
     CREATE POLICY provider_direct_scope_v1 ON public.provider_direct_invocations_v1
       TO cloudmarkup_beta_proposal_runtime,cloudmarkup_beta_export_runtime
       USING (organization_id=current_setting('cloudmarkup.organization_id',true))
       WITH CHECK (organization_id=current_setting('cloudmarkup.organization_id',true) AND principal_id=current_setting('cloudmarkup.principal_id',true))
   $policy_sql$;
 END IF;
END;
$provider_direct_policy$;
REVOKE ALL ON public.provider_direct_invocations_v1 FROM PUBLIC;
-- No DELETE/TRUNCATE, owner role, hosted-account access, or owner pool. Original
-- dispatch leases may observe/finalize incurred usage after access withdrawal.
-- Unknown-state reconciliation is separate, explicitly reviewed owner work.

ALTER TABLE public.provider_direct_invocations_v1 OWNER TO cloudmarkup_admin;
ALTER FUNCTION public.cloudmarkup_provider_direct_assert_authority_v1(varchar,varchar,varchar,varchar,varchar,integer,varchar,char,varchar,varchar) OWNER TO cloudmarkup_admin;
ALTER FUNCTION public.cloudmarkup_provider_direct_journal_transition_v1() OWNER TO cloudmarkup_admin;
