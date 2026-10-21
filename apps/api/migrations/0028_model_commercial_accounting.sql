-- Model reservations share the canonical grants/ledger, not a second balance.
-- No content, policy defaults, credit grants, or provider activation are added.
ALTER TABLE model_provider_pricing_versions ADD CONSTRAINT model_pricing_tuple_identity UNIQUE(provider_key,model_key,model_version,pricing_version_id);

ALTER TABLE credit_reservations
  ADD COLUMN pricing_authority VARCHAR(32) NOT NULL DEFAULT 'legacy-provider-v1' CHECK(pricing_authority IN ('legacy-provider-v1','model-provider-v1')),
  ADD COLUMN legacy_pricing_version_id VARCHAR(128) GENERATED ALWAYS AS (CASE WHEN pricing_authority='legacy-provider-v1' THEN pricing_version_id END) STORED,
  ADD COLUMN model_pricing_version_id VARCHAR(128) GENERATED ALWAYS AS (CASE WHEN pricing_authority='model-provider-v1' THEN pricing_version_id END) STORED,
  ADD CONSTRAINT credit_reservations_legacy_pricing_fk FOREIGN KEY(provider_key,model_key,model_version,legacy_pricing_version_id) REFERENCES provider_pricing_versions(provider_key,model_key,model_version,pricing_version_id),
  ADD CONSTRAINT credit_reservations_model_pricing_fk FOREIGN KEY(provider_key,model_key,model_version,model_pricing_version_id) REFERENCES model_provider_pricing_versions(provider_key,model_key,model_version,pricing_version_id);

ALTER TABLE usage_ledger_entries
  ADD COLUMN pricing_authority VARCHAR(32) NOT NULL DEFAULT 'legacy-provider-v1' CHECK(pricing_authority IN ('legacy-provider-v1','model-provider-v1')),
  ADD COLUMN legacy_pricing_version_id VARCHAR(128) GENERATED ALWAYS AS (CASE WHEN pricing_authority='legacy-provider-v1' THEN pricing_version_id END) STORED,
  ADD COLUMN model_pricing_version_id VARCHAR(128) GENERATED ALWAYS AS (CASE WHEN pricing_authority='model-provider-v1' THEN pricing_version_id END) STORED,
  ADD CONSTRAINT usage_ledger_legacy_pricing_fk FOREIGN KEY(provider_key,model_key,model_version,legacy_pricing_version_id) REFERENCES provider_pricing_versions(provider_key,model_key,model_version,pricing_version_id),
  ADD CONSTRAINT usage_ledger_model_pricing_fk FOREIGN KEY(provider_key,model_key,model_version,model_pricing_version_id) REFERENCES model_provider_pricing_versions(provider_key,model_key,model_version,pricing_version_id);

-- Require exactly the reviewed old tuple FK before replacing only its lineage
-- selector. The equivalent legacy FK above is already validated for all rows.
DO $$
DECLARE target text; old_name text; matches integer;
BEGIN
  FOREACH target IN ARRAY ARRAY['credit_reservations','usage_ledger_entries'] LOOP
    SELECT count(*),min(c.conname::text) INTO matches,old_name
    FROM pg_constraint c WHERE c.conrelid=target::regclass AND c.contype='f'
      AND c.confrelid='provider_pricing_versions'::regclass AND c.convalidated
      AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=target::regclass AND attname='provider_key'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=target::regclass AND attname='model_key'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=target::regclass AND attname='model_version'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=target::regclass AND attname='pricing_version_id')]::smallint[]
      AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='provider_pricing_versions'::regclass AND attname='provider_key'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='provider_pricing_versions'::regclass AND attname='model_key'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='provider_pricing_versions'::regclass AND attname='model_version'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='provider_pricing_versions'::regclass AND attname='pricing_version_id')]::smallint[]
      AND c.confupdtype='a' AND c.confdeltype='a' AND c.confmatchtype='s' AND NOT c.condeferrable;
    IF matches<>1 THEN RAISE EXCEPTION 'canonical pricing FK preflight failed' USING ERRCODE='23514'; END IF;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',target,old_name);
  END LOOP;
END;
$$;

CREATE TABLE model_commercial_reservation_decisions (
  organization_id VARCHAR(128) NOT NULL,
  scope_sha256 CHAR(64) NOT NULL CHECK(scope_sha256 ~ '^[0-9a-f]{64}$'),
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  workflow_id VARCHAR(128) NOT NULL,
  intent_id VARCHAR(128) NOT NULL CHECK(intent_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  input_sha256 CHAR(64) NOT NULL CHECK(input_sha256 ~ '^[0-9a-f]{64}$'),
  runtime_scope_sha256 CHAR(64) NOT NULL CHECK(runtime_scope_sha256 ~ '^[0-9a-f]{64}$'),
  runtime_fingerprint_sha256 CHAR(64) NOT NULL CHECK(runtime_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  mapping_version VARCHAR(64) NOT NULL CHECK(mapping_version='intent-extract-runtime-windows-v1'),
  organization_window_start TIMESTAMPTZ NOT NULL,
  organization_window_end TIMESTAMPTZ NOT NULL,
  user_window_start TIMESTAMPTZ NOT NULL,
  user_window_end TIMESTAMPTZ NOT NULL,
  accepted BOOLEAN NOT NULL,
  denial_reason VARCHAR(64),
  canonical_reservation_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,scope_sha256,workflow_id),
  UNIQUE(organization_id,scope_sha256,intent_id),
  UNIQUE(canonical_reservation_id),
  FOREIGN KEY(organization_id,scope_sha256,workflow_id) REFERENCES model_commercial_workflows(organization_id,scope_sha256,workflow_id),
  FOREIGN KEY(organization_id,runtime_scope_sha256) REFERENCES model_runtime_admissions(organization_id,scope_sha256),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY(organization_id,principal_id) REFERENCES memberships(organization_id,principal_id),
  FOREIGN KEY(organization_id,canonical_reservation_id) REFERENCES credit_reservations(organization_id,reservation_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK((accepted AND denial_reason IS NULL AND canonical_reservation_id IS NOT NULL)
    OR (NOT accepted AND canonical_reservation_id IS NULL AND denial_reason IS NOT NULL AND denial_reason IN ('commercial-state-unavailable','plan-not-entitled','insufficient-credits','per-user-request-limit-reached','organization-concurrent-reservation-limit-reached','feature-limit-reached'))),
  CHECK(organization_window_start<=created_at AND created_at<organization_window_end AND organization_window_end<=organization_window_start+INTERVAL '1 day'),
  CHECK(user_window_start<=created_at AND created_at<user_window_end AND user_window_end<=user_window_start+INTERVAL '1 day')
);

CREATE INDEX model_commercial_accepted_window ON model_commercial_reservation_decisions(organization_id,created_at,principal_id) WHERE accepted;

CREATE FUNCTION validate_model_commercial_reservation_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workflow model_commercial_workflows%ROWTYPE; runtime model_runtime_admissions%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'model reservation decisions are immutable' USING ERRCODE='23514'; END IF;
  NEW.created_at := clock_timestamp();
  SELECT * INTO workflow FROM model_commercial_workflows WHERE organization_id=NEW.organization_id AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id FOR SHARE;
  SELECT * INTO runtime FROM model_runtime_admissions WHERE organization_id=NEW.organization_id AND scope_sha256=NEW.runtime_scope_sha256 FOR SHARE;
  IF workflow.organization_id IS NULL OR runtime.organization_id IS NULL OR
    workflow.project_id<>NEW.project_id OR workflow.principal_id<>NEW.principal_id OR
    runtime.project_id<>NEW.project_id OR runtime.principal_id<>NEW.principal_id OR
    workflow.snapshot#>>'{reservationIntent,intentId}' IS DISTINCT FROM NEW.intent_id OR
    workflow.snapshot#>>'{request,feature}' IS DISTINCT FROM 'intent.extract' OR
    workflow.snapshot->'dispatchIntent'<>'null'::jsonb OR
    workflow.lease_expires_at IS NULL OR workflow.lease_expires_at<=clock_timestamp() OR
    runtime.snapshot->>'fingerprint' IS DISTINCT FROM 'sha256:'||NEW.runtime_fingerprint_sha256 OR
    runtime.snapshot#>>'{request,operation}' IS DISTINCT FROM 'intent.extract' OR
    runtime.snapshot#>>'{decision,outcome}' IS DISTINCT FROM 'allowed' OR
    runtime.snapshot#>'{executionLease,recoveryOnly}' IS DISTINCT FROM 'false'::jsonb OR
    runtime.snapshot->'recoveryRequired' IS DISTINCT FROM 'false'::jsonb OR
    runtime.lease_expires_at IS NULL OR runtime.lease_expires_at<=clock_timestamp() OR
    (runtime.snapshot->>'commercialExpiresAt')::timestamptz<=clock_timestamp() OR
    (runtime.snapshot#>>'{originalSnapshot,windows,organization,windowStartedAt}')::timestamptz IS DISTINCT FROM NEW.organization_window_start OR
    (runtime.snapshot#>>'{originalSnapshot,windows,organization,windowEndsAt}')::timestamptz IS DISTINCT FROM NEW.organization_window_end OR
    (runtime.snapshot#>>'{originalSnapshot,windows,user,windowStartedAt}')::timestamptz IS DISTINCT FROM NEW.user_window_start OR
    (runtime.snapshot#>>'{originalSnapshot,windows,user,windowEndsAt}')::timestamptz IS DISTINCT FROM NEW.user_window_end OR
    clock_timestamp()>=NEW.organization_window_end OR clock_timestamp()>=NEW.user_window_end OR
    workflow.snapshot#>>'{request,requestedAt}' IS DISTINCT FROM runtime.snapshot#>>'{decision,decidedAt}' OR
    workflow.snapshot#>>'{request,reservationId}' IS DISTINCT FROM runtime.snapshot#>>'{decision,authorization,commercialReservationDecisionId}' OR
    workflow.snapshot#>>'{request,expiresAt}' IS DISTINCT FROM runtime.snapshot->>'commercialExpiresAt'
  THEN RAISE EXCEPTION 'model decision requires current exact workflow runtime authority' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_commercial_decision_authority BEFORE INSERT OR UPDATE OR DELETE ON model_commercial_reservation_decisions FOR EACH ROW EXECUTE FUNCTION validate_model_commercial_reservation_decision();

CREATE FUNCTION require_model_reservation_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.pricing_authority<>OLD.pricing_authority THEN
    RAISE EXCEPTION 'reservation pricing lineage is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.pricing_authority='model-provider-v1' AND (
    NOT EXISTS(SELECT 1 FROM model_commercial_reservation_decisions d JOIN model_commercial_workflows w
      ON w.organization_id=d.organization_id AND w.scope_sha256=d.scope_sha256 AND w.workflow_id=d.workflow_id
      WHERE d.organization_id=NEW.organization_id AND d.canonical_reservation_id=NEW.reservation_id AND d.accepted
      AND d.project_id=NEW.project_id AND d.principal_id=NEW.acting_principal_id
      AND w.snapshot#>>'{resolvedContext,authorization,planVersionId}'=NEW.plan_version_id
      AND w.snapshot#>>'{resolvedContext,authorization,chargingPolicyVersion}'=NEW.charging_policy_version
      AND w.snapshot#>>'{resolvedContext,authorization,entitlementPolicyVersion}'=NEW.entitlement_policy_version
      AND w.snapshot#>>'{resolvedContext,estimateResult,primaryPricingVersionId}'=NEW.pricing_version_id
      AND w.snapshot#>>'{resolvedContext,selectedRoute,providerKey}'=NEW.provider_key
      AND w.snapshot#>>'{resolvedContext,selectedRoute,modelId}'=NEW.model_key
      AND w.snapshot#>>'{resolvedContext,selectedRoute,modelVersion}'=NEW.model_version
      AND w.snapshot#>>'{request,jobId}'=NEW.job_id
      AND w.fingerprint_sha256=NEW.request_sha256
      AND (w.snapshot#>>'{reservationIntent,requestedCreditUnits}')::numeric=NEW.reserved_credit_units)
    OR NEW.feature_key<>'ai-assisted-operations') THEN
    RAISE EXCEPTION 'model credit reservation requires canonical decision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER model_reservation_lineage AFTER INSERT OR UPDATE ON credit_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_model_reservation_lineage();

CREATE FUNCTION require_model_ledger_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM credit_reservations r WHERE r.organization_id=NEW.organization_id AND r.reservation_id=NEW.reservation_id
    AND r.pricing_authority<>NEW.pricing_authority) THEN
    RAISE EXCEPTION 'ledger pricing lineage must equal reservation' USING ERRCODE='23514';
  END IF;
  IF NEW.pricing_authority='model-provider-v1' AND NEW.entry_kind<>'reservation' THEN
    RAISE EXCEPTION 'model terminal accounting requires verified model evidence bridge' USING ERRCODE='23514';
  END IF;
  IF NEW.pricing_authority='model-provider-v1' AND NOT EXISTS(
    SELECT 1 FROM credit_reservations r JOIN model_commercial_reservation_decisions d
      ON d.organization_id=r.organization_id AND d.canonical_reservation_id=r.reservation_id AND d.accepted
    WHERE r.organization_id=NEW.organization_id AND r.reservation_id=NEW.reservation_id
      AND r.pricing_authority=NEW.pricing_authority AND r.pricing_version_id=NEW.pricing_version_id
      AND r.project_id=NEW.project_id AND r.acting_principal_id=NEW.acting_principal_id
      AND r.feature_key=NEW.feature_key AND r.plan_version_id=NEW.plan_version_id
  ) THEN RAISE EXCEPTION 'model ledger requires exact canonical reservation lineage' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER model_ledger_lineage AFTER INSERT ON usage_ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_model_ledger_lineage();
