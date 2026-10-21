-- Normal-runtime authority/accounting metadata only. This does not authorize
-- models, reserve customer credits/platform USD, or store prompt/output bodies.
CREATE SEQUENCE model_runtime_execution_fence AS BIGINT MINVALUE 1 MAXVALUE 9007199254740991 NO CYCLE;

CREATE TABLE model_runtime_admissions (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  scope_sha256 CHAR(64) NOT NULL CHECK(scope_sha256 ~ '^[0-9a-f]{64}$'),
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=32768),
  snapshot_sha256 CHAR(64) NOT NULL CHECK(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  revision BIGINT NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
  last_fence BIGINT NOT NULL CHECK(last_fence BETWEEN 0 AND 9007199254740991),
  active_concurrency_lease_id VARCHAR(128),
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,scope_sha256),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY(organization_id,principal_id) REFERENCES memberships(organization_id,principal_id),
  CHECK(snapshot ?& ARRAY['request','decision','originalSnapshot','fingerprint','tenantScopeDigest','commercialExpiresAt','concurrencyLeaseId','revision','recoveryRequired','executionLease','pending','terminal']
    AND snapshot - ARRAY['request','decision','originalSnapshot','fingerprint','tenantScopeDigest','commercialExpiresAt','concurrencyLeaseId','revision','recoveryRequired','executionLease','pending','terminal']='{}'::jsonb),
  CHECK((snapshot->'request') ?& ARRAY['capabilityRegistryDigest','cacheKeyAuthority','catalogDigest','commercialEstimate','contractVersion','evaluationAuthorityTupleDigest','evaluationReportDigest','evaluationReportId','evaluationResultSetDigest','executionClass','idempotencyKeyDigest','inputDigest','inputEvidenceDigest','operation','organizationId','plan','projectId','promptTemplateDigest','recordKind','requested','requestDigest','responseSchemaDigest','role','routeRegistryDigest','routingDecisionDigest','runtimePolicyDigest','userId']
    AND (snapshot->'request') - ARRAY['capabilityRegistryDigest','cacheKeyAuthority','catalogDigest','commercialEstimate','contractVersion','evaluationAuthorityTupleDigest','evaluationReportDigest','evaluationReportId','evaluationResultSetDigest','executionClass','idempotencyKeyDigest','inputDigest','inputEvidenceDigest','operation','organizationId','plan','projectId','promptTemplateDigest','recordKind','requested','requestDigest','responseSchemaDigest','role','routeRegistryDigest','routingDecisionDigest','runtimePolicyDigest','userId']='{}'::jsonb),
  CHECK((snapshot#>>'{request,executionClass}'='normal' AND snapshot#>>'{decision,executionClass}'='normal'
    AND NOT(snapshot->'originalSnapshot' ? 'liveAuthorityUsage')
    AND snapshot#>>'{request,organizationId}'=organization_id AND snapshot#>>'{request,projectId}'=project_id AND snapshot#>>'{request,userId}'=principal_id
    AND snapshot->>'tenantScopeDigest'='sha256:'||scope_sha256 AND (snapshot->>'revision')::numeric=revision
    AND jsonb_typeof(snapshot->'recoveryRequired')='boolean') IS TRUE),
  CHECK(((snapshot->'executionLease'='null'::jsonb)=(active_concurrency_lease_id IS NULL)
    AND (active_concurrency_lease_id IS NULL)=(lease_expires_at IS NULL)) IS TRUE),
  CHECK((active_concurrency_lease_id IS NULL OR (
    active_concurrency_lease_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    AND snapshot->>'concurrencyLeaseId'=active_concurrency_lease_id
    AND snapshot#>>'{decision,outcome}'='allowed' AND snapshot->'terminal'='null'::jsonb
    AND snapshot#>>'{executionLease,fencingToken}'='runtime_fence_'||last_fence
    AND (snapshot#>>'{executionLease,revision}')::numeric=revision
    AND (snapshot#>>'{executionLease,expiresAt}')::timestamptz=lease_expires_at
    AND lease_expires_at>(snapshot#>>'{executionLease,acquiredAt}')::timestamptz
    AND lease_expires_at<=(snapshot#>>'{executionLease,acquiredAt}')::timestamptz+INTERVAL '5 minutes'
    AND (snapshot->'recoveryRequired'='false'::jsonb OR snapshot#>'{executionLease,recoveryOnly}'='true'::jsonb))) IS TRUE),
  CHECK((snapshot->'pending'='null'::jsonb OR (
    snapshot#>>'{pending,commercial,state}'='settlement-pending' AND snapshot#>'{pending,admission}'=snapshot->'decision')) IS TRUE),
  CHECK((snapshot->'terminal'='null'::jsonb OR (
    snapshot#>'{terminal,admission}'=snapshot->'decision' AND
    ((snapshot#>>'{decision,outcome}'='denied' AND snapshot#>'{terminal,commercial}'='null'::jsonb AND snapshot#>'{terminal,output}'='null'::jsonb)
      OR (snapshot#>>'{decision,outcome}'='allowed' AND snapshot#>>'{terminal,commercial,state}'<>'settlement-pending')))) IS TRUE)
);

CREATE UNIQUE INDEX model_runtime_active_lease_identity ON model_runtime_admissions(organization_id,active_concurrency_lease_id) WHERE active_concurrency_lease_id IS NOT NULL;

CREATE TABLE model_runtime_admission_debits (
  organization_id VARCHAR(128) NOT NULL,
  scope_sha256 CHAR(64) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  debited_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,scope_sha256),
  FOREIGN KEY(organization_id,scope_sha256) REFERENCES model_runtime_admissions(organization_id,scope_sha256),
  FOREIGN KEY(organization_id,principal_id) REFERENCES memberships(organization_id,principal_id)
);

CREATE INDEX model_runtime_debit_windows ON model_runtime_admission_debits(organization_id,debited_at,principal_id);

CREATE TABLE model_runtime_admission_outbox (
  organization_id VARCHAR(128) NOT NULL,
  scope_sha256 CHAR(64) NOT NULL,
  outbox_sha256 CHAR(64) NOT NULL CHECK(outbox_sha256 ~ '^[0-9a-f]{64}$'),
  entry JSONB NOT NULL CHECK(jsonb_typeof(entry)='object' AND octet_length(entry::text)<=16384),
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(organization_id,scope_sha256,outbox_sha256),
  FOREIGN KEY(organization_id,scope_sha256) REFERENCES model_runtime_admissions(organization_id,scope_sha256),
  CHECK(entry ?& ARRAY['audit','metric','outboxId'] AND entry-ARRAY['audit','metric','outboxId']='{}'::jsonb),
  CHECK((entry->>'outboxId'='sha256:'||outbox_sha256
    AND entry#>>'{audit,organizationId}'=organization_id
    AND entry#>'{audit,noRawPromptResponseRepositoryOrCandidateContent}'='true'::jsonb
    AND entry#>'{metric,noRawSensitiveDimensions}'='true'::jsonb) IS TRUE)
);

CREATE FUNCTION validate_model_runtime_admission_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'runtime admission metadata is irreversible' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>0 OR NEW.snapshot->'pending'<>'null'::jsonb OR NEW.snapshot->'recoveryRequired'<>'false'::jsonb
      OR ((NEW.snapshot#>>'{decision,outcome}'='denied') IS DISTINCT FROM (NEW.snapshot->'terminal'<>'null'::jsonb))
      OR ((NEW.snapshot#>>'{decision,outcome}'='allowed') IS DISTINCT FROM (NEW.active_concurrency_lease_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'runtime admission must begin with one normal decision' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.organization_id,NEW.scope_sha256,NEW.project_id,NEW.principal_id,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.organization_id,OLD.scope_sha256,OLD.project_id,OLD.principal_id,OLD.created_at)
      OR (NEW.snapshot-ARRAY['revision','executionLease','pending','terminal','recoveryRequired']) IS DISTINCT FROM (OLD.snapshot-ARRAY['revision','executionLease','pending','terminal','recoveryRequired'])
      OR NEW.revision<>OLD.revision+1 OR OLD.snapshot->'terminal'<>'null'::jsonb
      OR (OLD.snapshot->'pending'<>'null'::jsonb AND NEW.snapshot->'pending' IS DISTINCT FROM OLD.snapshot->'pending')
      OR (OLD.snapshot->'recoveryRequired'='true'::jsonb AND NEW.snapshot->'recoveryRequired'<>'true'::jsonb) THEN
      RAISE EXCEPTION 'runtime admission identity and completed evidence are immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.active_concurrency_lease_id IS NOT NULL THEN
      IF OLD.active_concurrency_lease_id IS NOT NULL OR NEW.last_fence<=OLD.last_fence
        OR NEW.snapshot->'pending' IS DISTINCT FROM OLD.snapshot->'pending' OR NEW.snapshot->'terminal'<>'null'::jsonb
        OR ((OLD.snapshot->'recoveryRequired'='true'::jsonb OR OLD.snapshot->'pending'<>'null'::jsonb OR (OLD.snapshot->>'commercialExpiresAt')::timestamptz<=clock_timestamp())
          AND NEW.snapshot#>'{executionLease,recoveryOnly}'<>'true'::jsonb) THEN
        RAISE EXCEPTION 'runtime lease reacquisition must preserve recovery authority' USING ERRCODE='23514';
      END IF;
    ELSE
      IF OLD.active_concurrency_lease_id IS NULL OR NEW.last_fence<>OLD.last_fence THEN
        RAISE EXCEPTION 'runtime release requires existing fenced ownership' USING ERRCODE='23514';
      END IF;
      IF OLD.lease_expires_at<=clock_timestamp() AND (NEW.snapshot->'recoveryRequired'<>'true'::jsonb
        OR NEW.snapshot->'pending' IS DISTINCT FROM OLD.snapshot->'pending' OR NEW.snapshot->'terminal' IS DISTINCT FROM OLD.snapshot->'terminal') THEN
        RAISE EXCEPTION 'expired execution may only become recovery required' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF NEW.active_concurrency_lease_id IS NOT NULL AND (NEW.lease_expires_at<=clock_timestamp() OR NEW.lease_expires_at>clock_timestamp()+INTERVAL '301 seconds') THEN
    RAISE EXCEPTION 'runtime execution lease must be current and bounded' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_runtime_admission_transition BEFORE INSERT OR UPDATE OR DELETE ON model_runtime_admissions FOR EACH ROW EXECUTE FUNCTION validate_model_runtime_admission_transition();

CREATE FUNCTION validate_model_runtime_admission_debit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'runtime request debits are immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM model_runtime_admissions a WHERE a.organization_id=NEW.organization_id AND a.scope_sha256=NEW.scope_sha256
    AND a.principal_id=NEW.principal_id AND a.revision=0) OR NEW.debited_at>clock_timestamp() OR NEW.debited_at<clock_timestamp()-INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'runtime request debit requires its original admission' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_runtime_admission_debit BEFORE INSERT OR UPDATE OR DELETE ON model_runtime_admission_debits FOR EACH ROW EXECUTE FUNCTION validate_model_runtime_admission_debit();

CREATE FUNCTION validate_model_runtime_admission_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'runtime telemetry is irreversible' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.organization_id,NEW.scope_sha256,NEW.outbox_sha256,NEW.entry) IS DISTINCT FROM ROW(OLD.organization_id,OLD.scope_sha256,OLD.outbox_sha256,OLD.entry)
      OR (OLD.acknowledged AND NOT NEW.acknowledged) THEN
      RAISE EXCEPTION 'runtime telemetry identity and acknowledgement are immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
    IF NEW.acknowledged OR ((SELECT count(*) FROM model_runtime_admission_outbox WHERE organization_id=NEW.organization_id AND scope_sha256=NEW.scope_sha256)>=256
      AND NOT EXISTS(SELECT 1 FROM model_runtime_admission_outbox WHERE organization_id=NEW.organization_id AND scope_sha256=NEW.scope_sha256 AND outbox_sha256=NEW.outbox_sha256))
      OR NOT EXISTS(SELECT 1 FROM model_runtime_admissions a WHERE a.organization_id=NEW.organization_id AND a.scope_sha256=NEW.scope_sha256
        AND NEW.entry#>>'{audit,projectId}'=a.project_id AND NEW.entry#>>'{audit,userId}'=a.principal_id
        AND NEW.entry#>'{audit,admissionDecisionDigest}'=a.snapshot#>'{decision,decisionDigest}'
        AND NEW.entry#>'{audit,idempotencyKeyDigest}'=a.snapshot#>'{request,idempotencyKeyDigest}') THEN
      RAISE EXCEPTION 'runtime telemetry requires its bounded original admission' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_runtime_admission_outbox BEFORE INSERT OR UPDATE OR DELETE ON model_runtime_admission_outbox FOR EACH ROW EXECUTE FUNCTION validate_model_runtime_admission_outbox();

CREATE FUNCTION require_model_runtime_admission_debit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM model_runtime_admission_debits WHERE organization_id=NEW.organization_id AND scope_sha256=NEW.scope_sha256 AND principal_id=NEW.principal_id) THEN
    RAISE EXCEPTION 'runtime admission requires exactly one immutable request debit' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER model_runtime_original_debit AFTER INSERT ON model_runtime_admissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_model_runtime_admission_debit();
