-- Metadata-only, one-primary Standard Intent terminal accounting.
-- Existing workflow/history and platform dollar reservations are untouched.
-- Model-only namespaces retain every old hyphen key; legacy pricing/billing
-- identifiers are deliberately unchanged. No provider-specific literal mapping.
ALTER TABLE model_provider_pricing_versions DROP CONSTRAINT model_provider_pricing_versions_provider_key_check,
  ADD CONSTRAINT model_provider_pricing_versions_provider_key_check CHECK(provider_key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$' AND length(provider_key)<=64);

ALTER TABLE credit_reservations DROP CONSTRAINT credit_reservations_provider_key_check,
  ADD CONSTRAINT credit_reservations_provider_key_check CHECK(provider_key ~ '^[a-z][a-z0-9-]{0,63}$'
    OR (pricing_authority='model-provider-v1' AND provider_key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$' AND length(provider_key)<=64));

CREATE TABLE model_commercial_accounting_outcomes (
  organization_id VARCHAR(128) NOT NULL,
  scope_sha256 CHAR(64) NOT NULL CHECK(scope_sha256 ~ '^[0-9a-f]{64}$'),
  workflow_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  canonical_reservation_id VARCHAR(128) NOT NULL,
  source_revision BIGINT NOT NULL CHECK(source_revision>=0),
  workflow_fingerprint_sha256 CHAR(64) NOT NULL CHECK(workflow_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  dispatch_intent_id VARCHAR(128) NOT NULL,
  pricing_authority_sha256 CHAR(64) NOT NULL CHECK(pricing_authority_sha256 ~ '^[0-9a-f]{64}$'),
  outcome_kind VARCHAR(32) NOT NULL CHECK(outcome_kind IN ('settlement','release','reconciliation-required')),
  source_kind VARCHAR(32) NOT NULL CHECK(source_kind IN ('preview-journal','workflow-receipt')),
  preview_invocation_id VARCHAR(128),
  receipt JSONB NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=16384),
  outcome JSONB NOT NULL CHECK(jsonb_typeof(outcome)='object' AND octet_length(outcome::text)<=24576),
  outcome_sha256 CHAR(64) NOT NULL CHECK(outcome_sha256 ~ '^[0-9a-f]{64}$'),
  ledger_entry_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,scope_sha256,workflow_id,outcome_kind),
  FOREIGN KEY(organization_id,scope_sha256,workflow_id) REFERENCES model_commercial_reservation_decisions(organization_id,scope_sha256,workflow_id),
  FOREIGN KEY(organization_id,scope_sha256,workflow_id,source_revision) REFERENCES model_commercial_workflow_revisions(organization_id,scope_sha256,workflow_id,revision),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY(organization_id,principal_id) REFERENCES memberships(organization_id,principal_id),
  FOREIGN KEY(organization_id,canonical_reservation_id) REFERENCES credit_reservations(organization_id,reservation_id),
  FOREIGN KEY(organization_id,ledger_entry_id) REFERENCES usage_ledger_entries(organization_id,ledger_entry_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(organization_id,project_id,principal_id,preview_invocation_id) REFERENCES ai_intent_previews(organization_id,project_id,principal_id,invocation_id),
  CHECK((source_kind='preview-journal')=(preview_invocation_id IS NOT NULL)),
  CHECK(((receipt ?& ARRAY['dispatchIntentId','dispatchedAt','preDispatchProof','receiptId','receivedAt','result'])
    AND receipt-ARRAY['dispatchIntentId','dispatchedAt','preDispatchProof','receiptId','receivedAt','result']='{}'::jsonb
    AND receipt->>'dispatchIntentId'=dispatch_intent_id
    AND (receipt->'result')-ARRAY['attempts','completedAt','failureCategory','resultId','status','usefulOutputDelivered']='{}'::jsonb
    AND jsonb_typeof(receipt#>'{result,attempts}')='array' AND jsonb_array_length(receipt#>'{result,attempts}')<=1) IS TRUE),
  CHECK(((outcome ?& ARRAY['actualCreditUnits','event','kind','response'])
    AND outcome-ARRAY['actualCreditUnits','event','kind','response']='{}'::jsonb
    AND outcome->>'kind'=outcome_kind AND jsonb_typeof(outcome->'event')='object'
    AND (outcome->'event')-ARRAY['attempts','cacheReadUnits','cacheWriteUnits','chargedCreditUnits','compensatedCreditUnits','completedAt','environment','estimatedProviderCostMicros','eventId','failureCategory','feature','idempotencyKey','inferenceProfileId','inputUnits','jobId','latencyMilliseconds','modelId','modelVersion','multiCallWorkflowId','normalizationPolicyVersionId','occurredAt','organizationId','outputUnits','pricingVersionId','projectId','promptId','promptVersion','providerKey','providerSpecificUnits','reconciliationState','requestId','reservationId','reservedCreditUnits','route','routeId','startedAt','status','templateId','templateVersion','totalUnits','userId','version']='{}'::jsonb
    AND (outcome->'response')-ARRAY['compensationStatus','completedCreditUnits','denialReason','estimate','reconciliationState','reservationAccepted','reservationId','route','routeExplanation','routeLabel','state','technicalUnits','version']='{}'::jsonb) IS TRUE)
);

CREATE UNIQUE INDEX model_commercial_accounting_one_terminal ON model_commercial_accounting_outcomes(organization_id,canonical_reservation_id) WHERE outcome_kind<>'reconciliation-required';

-- Reuse each existing legacy predicate verbatim. Only the explicitly model-
-- priced delivered scenario gains admission; the deferred bridge below binds it.
DO $$
DECLARE target text; expression text;
BEGIN
  FOREACH target IN ARRAY ARRAY['usage_ledger_entries_scenario_check','usage_ledger_entries_scenario_outcome_check'] LOOP
    SELECT pg_get_expr(conbin,conrelid) INTO expression FROM pg_constraint
      WHERE conrelid='usage_ledger_entries'::regclass AND conname=target AND contype='c' AND convalidated;
    IF expression IS NULL THEN RAISE EXCEPTION 'legacy scenario constraint preflight failed' USING ERRCODE='23514'; END IF;
    EXECUTE format('ALTER TABLE usage_ledger_entries DROP CONSTRAINT %I',target);
    EXECUTE format('ALTER TABLE usage_ledger_entries ADD CONSTRAINT %I CHECK ((%s) OR (pricing_authority=''model-provider-v1'' AND charging_scenario=''model-preview-delivered-v1'' AND entry_kind=''settlement'' AND outcome=''useful-output-delivered''))',target,expression);
  END LOOP;
END;
$$;

CREATE FUNCTION validate_model_commercial_accounting_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w jsonb; e jsonb; attempt jsonb; source_attempt jsonb; usage jsonb; item jsonb; response jsonb;
  d model_commercial_reservation_decisions%ROWTYPE; r credit_reservations%ROWTYPE;
  preview ai_intent_previews%ROWTYPE; p model_provider_pricing_versions%ROWTYPE; n credit_normalization_policy_versions%ROWTYPE;
  pin jsonb; raw_cost numeric:=0; cost numeric:=0; actual numeric:=0; charged numeric:=0; units_total numeric:=0; rate numeric;
  field text; terminal boolean; delivered boolean; expected_result jsonb; source_result jsonb;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'model terminal evidence is append only' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp();
  SELECT * INTO d FROM model_commercial_reservation_decisions WHERE organization_id=NEW.organization_id AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id;
  -- Match every canonical credit transition: account before reservation.
  -- This also protects direct SQL insertion, not only the host adapter path.
  PERFORM a.billing_account_id FROM organization_billing_accounts a JOIN credit_reservations reserved
    ON reserved.organization_id=a.organization_id AND reserved.billing_account_id=a.billing_account_id
    WHERE reserved.organization_id=NEW.organization_id AND reserved.reservation_id=NEW.canonical_reservation_id
    FOR UPDATE OF a;
  SELECT * INTO r FROM credit_reservations WHERE organization_id=NEW.organization_id AND reservation_id=NEW.canonical_reservation_id FOR UPDATE;
  SELECT snapshot INTO w FROM model_commercial_workflow_revisions WHERE organization_id=NEW.organization_id AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id AND revision=NEW.source_revision;
  IF d.organization_id IS NULL OR r.reservation_id IS NULL OR w IS NULL OR NOT d.accepted
    OR d.canonical_reservation_id IS DISTINCT FROM NEW.canonical_reservation_id OR d.project_id<>NEW.project_id OR d.principal_id<>NEW.principal_id
    OR r.pricing_authority<>'model-provider-v1' OR r.status<>'active'
    OR w->>'fingerprint' IS DISTINCT FROM 'sha256:'||NEW.workflow_fingerprint_sha256
    OR w#>>'{request,feature}' IS DISTINCT FROM 'intent.extract' OR w#>>'{request,requestedRoute}' IS DISTINCT FROM 'standard'
    OR jsonb_array_length(w#>'{request,plannedCalls}')<>1 OR w#>>'{request,plannedCalls,0,kind}' IS DISTINCT FROM 'primary'
    OR w#>>'{dispatchIntent,dispatchIntentId}' IS DISTINCT FROM NEW.dispatch_intent_id
    OR w#>>'{reservationReceipt,result,accepted}' IS DISTINCT FROM 'true'
    OR w#>>'{resolvedContext,estimateResult,pricingAuthority,authorityDigest}' IS DISTINCT FROM 'sha256:'||NEW.pricing_authority_sha256
    OR NEW.receipt->>'dispatchedAt' IS DISTINCT FROM w#>>'{dispatchIntent,recordedAt}'
    OR (NEW.receipt->>'receivedAt')::timestamptz < (NEW.receipt->>'dispatchedAt')::timestamptz
    OR (NEW.receipt->>'receivedAt')::timestamptz > clock_timestamp()
  THEN RAISE EXCEPTION 'model terminal source lineage is unavailable' USING ERRCODE='23514'; END IF;
  e:=NEW.outcome->'event'; response:=NEW.outcome->'response'; terminal:=NEW.outcome_kind<>'reconciliation-required';
  IF e->>'organizationId' IS DISTINCT FROM NEW.organization_id OR e->>'projectId' IS DISTINCT FROM NEW.project_id
    OR e->>'userId' IS DISTINCT FROM NEW.principal_id OR e->>'multiCallWorkflowId' IS DISTINCT FROM NEW.workflow_id
    OR e->>'reservationId' IS DISTINCT FROM w#>>'{request,reservationId}' OR e->>'requestId' IS DISTINCT FROM w#>>'{request,requestId}'
    OR e->>'jobId' IS DISTINCT FROM w#>>'{request,jobId}' OR e->>'feature' IS DISTINCT FROM 'intent.extract'
    OR e->>'route' IS DISTINCT FROM 'standard' OR e->>'routeId' IS DISTINCT FROM w#>>'{resolvedContext,selectedRoute,routeId}'
    OR e->>'promptId' IS DISTINCT FROM w#>>'{request,promptId}' OR e->>'promptVersion' IS DISTINCT FROM w#>>'{request,promptVersion}'
    OR e->'templateId' IS DISTINCT FROM w#>'{request,templateId}' OR e->'templateVersion' IS DISTINCT FROM w#>'{request,templateVersion}'
    OR e->>'environment' IS DISTINCT FROM w#>>'{request,environment}'
    OR e->>'providerKey' IS DISTINCT FROM r.provider_key OR e->>'modelId' IS DISTINCT FROM r.model_key OR e->>'modelVersion' IS DISTINCT FROM r.model_version
    OR e->>'pricingVersionId' IS DISTINCT FROM r.pricing_version_id
    OR e->>'normalizationPolicyVersionId' IS DISTINCT FROM w#>>'{resolvedContext,estimateResult,normalizationPolicyVersionId}'
    OR (e->>'reservedCreditUnits')::numeric IS DISTINCT FROM r.reserved_credit_units
    OR e->>'occurredAt' IS DISTINCT FROM NEW.receipt->>'receivedAt' OR e->'completedAt' IS DISTINCT FROM NEW.receipt->'receivedAt'
    OR response->>'reservationId' IS DISTINCT FROM e->>'reservationId' OR response->>'reservationAccepted' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'model terminal event binding is contradictory' USING ERRCODE='23514'; END IF;
  source_result:=NEW.receipt->'result'; delivered:=source_result->>'usefulOutputDelivered'='true';
  IF NEW.source_kind='preview-journal' THEN
    SELECT * INTO preview FROM ai_intent_previews WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND invocation_id=NEW.preview_invocation_id FOR UPDATE;
    IF preview.generation_evidence IS NULL OR preview.scope_sha256 IS DISTINCT FROM NEW.scope_sha256 OR preview.workflow_id IS DISTINCT FROM NEW.workflow_id
      OR preview.dispatch_intent_id IS DISTINCT FROM NEW.dispatch_intent_id OR preview.binding->'request' IS DISTINCT FROM w->'request'
      OR preview.delivery_state NOT IN ('acknowledged','unconfirmed') OR delivered IS DISTINCT FROM (preview.delivery_state='acknowledged')
    THEN RAISE EXCEPTION 'verified model delivery is unavailable' USING ERRCODE='23514'; END IF;
    expected_result:=preview.generation_evidence;
    IF preview.delivery_state='unconfirmed' AND expected_result->>'status'='completed' THEN
      expected_result:=expected_result||jsonb_build_object('status','internal-failure','failureCategory','cloudmarkup.preview.delivery-unconfirmed');
    END IF;
    IF source_result-ARRAY['attempts','completedAt','usefulOutputDelivered'] IS DISTINCT FROM expected_result-ARRAY['attempts','completedAt']
      OR jsonb_array_length(source_result->'attempts')<>1 OR NEW.receipt->'preDispatchProof'<>'null'::jsonb
      OR (source_result#>'{attempts,0}')-ARRAY['startedAt','completedAt','latencyMilliseconds'] IS DISTINCT FROM (expected_result#>'{attempts,0}')-ARRAY['startedAt','completedAt','latencyMilliseconds']
    THEN RAISE EXCEPTION 'model receipt differs from verified generation' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.receipt IS DISTINCT FROM w->'invocationReceipt' THEN RAISE EXCEPTION 'model receipt is not immutable workflow evidence' USING ERRCODE='23514'; END IF;
    IF terminal AND (NEW.outcome_kind='release' AND jsonb_array_length(source_result->'attempts')=0
      AND NEW.receipt#>>'{preDispatchProof,authority}'='coordinator-host-clock-v1'
      AND NEW.receipt#>>'{preDispatchProof,reason}'='reservation-expired-before-dispatch'
      AND NEW.receipt#>>'{preDispatchProof,organizationId}'=NEW.organization_id AND NEW.receipt#>>'{preDispatchProof,projectId}'=NEW.project_id
      AND NEW.receipt#>>'{preDispatchProof,reservationId}'=e->>'reservationId'
      AND NEW.receipt#>>'{preDispatchProof,multiCallWorkflowId}'=NEW.workflow_id
      AND NEW.receipt#>>'{preDispatchProof,dispatchIntentId}'=NEW.dispatch_intent_id
      AND NEW.receipt#>>'{preDispatchProof,observedAt}'=NEW.receipt->>'receivedAt'
      AND (NEW.receipt->>'receivedAt')::timestamptz>=(w#>>'{request,expiresAt}')::timestamptz
      AND source_result->>'status'='internal-failure' AND source_result->>'failureCategory'='reservation-expired-before-dispatch'
      AND source_result->>'usefulOutputDelivered'='false') IS NOT TRUE
    THEN RAISE EXCEPTION 'workflow-only model receipt cannot prove delivery or release' USING ERRCODE='23514'; END IF;
  END IF;
  pin:=w#>'{resolvedContext,estimateResult,pricingAuthority,routePins,0}';
  SELECT * INTO p FROM model_provider_pricing_versions WHERE pricing_version_id=e->>'pricingVersionId';
  SELECT * INTO n FROM credit_normalization_policy_versions WHERE normalization_policy_version_id=e->>'normalizationPolicyVersionId';
  IF p.pricing_version_id IS NULL OR n.normalization_policy_version_id IS NULL OR p.provider_key<>r.provider_key OR p.model_key<>r.model_key OR p.model_version<>r.model_version
    OR p.cost_currency<>n.cost_currency OR p.inference_profile_id IS DISTINCT FROM e->>'inferenceProfileId'
    OR pin#>>'{pricingVersion,pricingVersionId}' IS DISTINCT FROM p.pricing_version_id OR pin#>>'{normalizationPolicy,normalizationPolicyVersionId}' IS DISTINCT FROM n.normalization_policy_version_id
  THEN RAISE EXCEPTION 'model terminal immutable prices are unavailable' USING ERRCODE='23514'; END IF;
  FOREACH field IN ARRAY ARRAY['inputUnits','outputUnits','cacheReadUnits','cacheWriteUnits','totalUnits','estimatedProviderCostMicros','reservedCreditUnits','chargedCreditUnits','compensatedCreditUnits','latencyMilliseconds'] LOOP
    IF jsonb_typeof(e->field) IS DISTINCT FROM 'number' OR (e->>field)!~'^[0-9]+$' OR (e->>field)::numeric>9007199254740991 THEN
      RAISE EXCEPTION 'model terminal units are invalid' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF terminal AND jsonb_array_length(source_result->'attempts')=1 THEN
    attempt:=e#>'{attempts,0}'; source_attempt:=source_result#>'{attempts,0}'; usage:=source_attempt->'usage';
    IF usage IS NULL OR usage='null'::jsonb OR jsonb_array_length(e->'attempts')<>1
      OR attempt-ARRAY['estimatedProviderCostMicros','pricingVersionId','normalizationPolicyVersionId'] IS DISTINCT FROM source_attempt
      OR attempt->>'attemptKind' IS DISTINCT FROM 'primary' OR attempt->>'attemptNumber' IS DISTINCT FROM '1'
      OR attempt->>'pricingVersionId' IS DISTINCT FROM p.pricing_version_id OR attempt->>'normalizationPolicyVersionId' IS DISTINCT FROM n.normalization_policy_version_id
    THEN RAISE EXCEPTION 'priced model attempt evidence is unavailable' USING ERRCODE='23514'; END IF;
    FOREACH field IN ARRAY ARRAY['inputUnits','outputUnits','cacheReadUnits','cacheWriteUnits','totalUnits','providerSpecificUnits'] LOOP
      IF e->field IS DISTINCT FROM usage->field THEN RAISE EXCEPTION 'model aggregate units differ from attempt' USING ERRCODE='23514'; END IF;
    END LOOP;
    IF ((usage->>'cacheReadUnits')::numeric>0 AND p.cache_read_micros_per_million_units IS NULL)
      OR ((usage->>'cacheWriteUnits')::numeric>0 AND p.cache_write_micros_per_million_units IS NULL) THEN
      RAISE EXCEPTION 'model cache usage is not priced' USING ERRCODE='23514'; END IF;
    raw_cost:=(usage->>'inputUnits')::numeric*p.input_micros_per_million_units+(usage->>'outputUnits')::numeric*p.output_micros_per_million_units
      +(usage->>'cacheReadUnits')::numeric*COALESCE(p.cache_read_micros_per_million_units,0)+(usage->>'cacheWriteUnits')::numeric*COALESCE(p.cache_write_micros_per_million_units,0);
    units_total:=(usage->>'inputUnits')::numeric+(usage->>'outputUnits')::numeric+(usage->>'cacheReadUnits')::numeric+(usage->>'cacheWriteUnits')::numeric;
    IF jsonb_array_length(usage->'providerSpecificUnits')>32 OR EXISTS(SELECT 1 FROM jsonb_array_elements(usage->'providerSpecificUnits') x GROUP BY x->>'unitName' HAVING count(*)<>1) THEN
      RAISE EXCEPTION 'model provider units are invalid' USING ERRCODE='23514'; END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(usage->'providerSpecificUnits') LOOP
      IF item-ARRAY['unitName','units']<>'{}'::jsonb OR (item->>'units')!~'^[0-9]+$' THEN RAISE EXCEPTION 'model provider units are invalid' USING ERRCODE='23514'; END IF;
      SELECT (value->>'microsPerMillionUnits')::numeric INTO rate FROM jsonb_array_elements(p.provider_specific_unit_rates) WHERE value->>'unitName'=item->>'unitName';
      IF rate IS NULL THEN RAISE EXCEPTION 'model provider units are not priced' USING ERRCODE='23514'; END IF;
      raw_cost:=raw_cost+(item->>'units')::numeric*rate;
    END LOOP;
    cost:=ceil(raw_cost/1000000); actual:=ceil((cost+ceil(cost*n.operating_buffer_basis_points/10000))/n.credit_unit_micros);
    IF units_total IS DISTINCT FROM (e->>'totalUnits')::numeric OR cost IS DISTINCT FROM (attempt->>'estimatedProviderCostMicros')::numeric THEN
      RAISE EXCEPTION 'model priced attempt totals are contradictory' USING ERRCODE='23514'; END IF;
  ELSIF jsonb_array_length(e->'attempts')<>0 OR e->'providerSpecificUnits'<>'[]'::jsonb
    OR (e->>'inputUnits')::numeric<>0 OR (e->>'outputUnits')::numeric<>0
    OR (e->>'cacheReadUnits')::numeric<>0 OR (e->>'cacheWriteUnits')::numeric<>0
    OR (e->>'totalUnits')::numeric<>0 THEN RAISE EXCEPTION 'unpriced model outcome must remain held' USING ERRCODE='23514'; END IF;
  charged:=CASE WHEN NEW.outcome_kind='settlement' THEN LEAST(actual,r.reserved_credit_units) ELSE 0 END;
  IF e->>'status' IS DISTINCT FROM (CASE WHEN NOT terminal THEN 'reconciliation-required'
      WHEN delivered THEN CASE WHEN actual>charged THEN 'compensated' ELSE 'completed' END
      WHEN source_result->>'status' IN ('provider-failure','timeout') THEN 'provider-failure'
      WHEN source_result->>'status'='cancelled' THEN 'cancelled' ELSE 'internal-failure' END)
    OR e->>'failureCategory' IS DISTINCT FROM (CASE WHEN NOT terminal THEN COALESCE(source_result->>'failureCategory','missing-provider-usage')
      WHEN delivered THEN CASE WHEN actual>charged THEN 'estimate-overrun' ELSE NULL END ELSE source_result->>'failureCategory' END)
  THEN RAISE EXCEPTION 'model terminal event status is contradictory' USING ERRCODE='23514'; END IF;
  IF response->'estimate' IS DISTINCT FROM w#>'{resolvedContext,estimateResult,estimate}'
    OR response->>'route' IS DISTINCT FROM e->>'route'
    OR response->>'routeLabel' IS DISTINCT FROM w#>>'{resolvedContext,selectedRoute,label}'
    OR response->>'routeExplanation' IS DISTINCT FROM w#>>'{resolvedContext,selectedRoute,explanation}'
    OR response->>'version' IS DISTINCT FROM '1' OR response->'denialReason' IS DISTINCT FROM 'null'::jsonb
    OR response->>'compensationStatus' IS DISTINCT FROM (CASE WHEN NOT terminal THEN 'pending' WHEN actual-charged>0 THEN 'applied' ELSE 'not-required' END)
    OR response->>'state' IS DISTINCT FROM (CASE WHEN NOT terminal THEN 'reconciliation-required' WHEN actual-charged>0 THEN 'compensated' WHEN delivered THEN 'completed' ELSE 'released' END)
    OR response->>'reconciliationState' IS DISTINCT FROM e->>'reconciliationState'
    OR response->'technicalUnits' IS DISTINCT FROM (CASE WHEN NOT terminal OR w#>>'{request,includeTechnicalUnitDetail}'<>'true' THEN 'null'::jsonb
      ELSE jsonb_build_object('inputUnits',e->'inputUnits','outputUnits',e->'outputUnits','cacheReadUnits',e->'cacheReadUnits','cacheWriteUnits',e->'cacheWriteUnits','totalUnits',e->'totalUnits','providerSpecificUnits',e->'providerSpecificUnits') END)
    OR e->>'eventId' IS DISTINCT FROM ((w#>>'{request,eventIdPrefix}')||'_'||(CASE WHEN terminal THEN NEW.outcome_kind ELSE 'reconciliation_required' END))
    OR e->>'idempotencyKey' IS DISTINCT FROM ((w#>>'{request,idempotencyKey}')||':'||(CASE WHEN terminal THEN NEW.outcome_kind ELSE 'reconciliation_required' END))
  THEN RAISE EXCEPTION 'model terminal response projection is contradictory' USING ERRCODE='23514'; END IF;
  IF (NEW.outcome_kind='settlement') IS DISTINCT FROM (terminal AND delivered)
    OR (NEW.outcome->>'actualCreditUnits')::numeric IS DISTINCT FROM actual OR (e->>'chargedCreditUnits')::numeric IS DISTINCT FROM charged
    OR (e->>'compensatedCreditUnits')::numeric IS DISTINCT FROM actual-charged OR (e->>'estimatedProviderCostMicros')::numeric IS DISTINCT FROM cost
    OR (terminal AND e->>'reconciliationState' IS DISTINCT FROM 'not-required')
    OR (NOT terminal AND (e->>'reconciliationState' IS DISTINCT FROM 'pending-missing-usage' OR response->>'completedCreditUnits' IS NOT NULL))
    OR (terminal AND (response->>'completedCreditUnits')::numeric IS DISTINCT FROM charged)
  THEN RAISE EXCEPTION 'canonical model terminal amount is contradictory' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_commercial_accounting_outcomes_validate BEFORE INSERT OR UPDATE OR DELETE ON model_commercial_accounting_outcomes FOR EACH ROW EXECUTE FUNCTION validate_model_commercial_accounting_outcome();

CREATE OR REPLACE FUNCTION require_model_ledger_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM credit_reservations r WHERE r.organization_id=NEW.organization_id AND r.reservation_id=NEW.reservation_id AND r.pricing_authority<>NEW.pricing_authority) THEN
    RAISE EXCEPTION 'ledger pricing lineage must equal reservation' USING ERRCODE='23514'; END IF;
  IF NEW.pricing_authority='model-provider-v1' AND NOT EXISTS(
    SELECT 1 FROM credit_reservations r JOIN model_commercial_reservation_decisions d ON d.organization_id=r.organization_id AND d.canonical_reservation_id=r.reservation_id AND d.accepted
    WHERE r.organization_id=NEW.organization_id AND r.reservation_id=NEW.reservation_id AND r.pricing_authority=NEW.pricing_authority
      AND r.pricing_version_id=NEW.pricing_version_id AND r.project_id=NEW.project_id AND r.acting_principal_id=NEW.acting_principal_id
      AND r.feature_key=NEW.feature_key AND r.plan_version_id=NEW.plan_version_id
  ) THEN RAISE EXCEPTION 'model ledger requires exact canonical reservation lineage' USING ERRCODE='23514'; END IF;
  IF NEW.pricing_authority='model-provider-v1' AND NEW.entry_kind<>'reservation' AND NOT EXISTS(
    SELECT 1 FROM model_commercial_accounting_outcomes o WHERE o.organization_id=NEW.organization_id AND o.canonical_reservation_id=NEW.reservation_id
      AND o.ledger_entry_id=NEW.ledger_entry_id AND o.project_id=NEW.project_id AND o.principal_id=NEW.acting_principal_id
      AND ((o.outcome_kind='settlement' AND NEW.entry_kind='settlement' AND NEW.charging_scenario='model-preview-delivered-v1')
        OR (o.outcome_kind='release' AND NEW.entry_kind IN ('release','provider-failure')
          AND NEW.charging_scenario=(CASE WHEN o.outcome#>>'{event,status}'='provider-failure'
            THEN 'provider-failure-before-useful-output' ELSE 'cloudmarkup-internal-failure' END)))
      AND (o.outcome#>>'{event,chargedCreditUnits}')::numeric=NEW.settled_credit_units
      AND (jsonb_array_length(o.outcome#>'{event,attempts}')=0 OR ((o.outcome->>'actualCreditUnits')::numeric=NEW.normalized_credit_units
        AND (o.outcome#>>'{event,estimatedProviderCostMicros}')::numeric=NEW.estimated_provider_cost_micros))
  ) THEN RAISE EXCEPTION 'model terminal accounting requires verified model evidence bridge' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION require_model_accounting_terminal_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM usage_ledger_entries e JOIN model_usage_event_details detail ON detail.organization_id=e.organization_id AND detail.ledger_entry_id=e.ledger_entry_id
    JOIN credit_reservations r ON r.organization_id=e.organization_id AND r.reservation_id=e.reservation_id
    WHERE e.organization_id=NEW.organization_id AND e.ledger_entry_id=NEW.ledger_entry_id AND e.reservation_id=NEW.canonical_reservation_id AND e.pricing_authority='model-provider-v1'
      AND detail.multi_call_workflow_id=NEW.workflow_id AND detail.model_pricing_version_id=NEW.outcome#>>'{event,pricingVersionId}'
      AND detail.normalization_policy_version_id=NEW.outcome#>>'{event,normalizationPolicyVersionId}'
      AND detail.model_route=NEW.outcome#>>'{event,route}' AND detail.model_route_id=NEW.outcome#>>'{event,routeId}'
      AND detail.inference_profile_id IS NOT DISTINCT FROM NEW.outcome#>>'{event,inferenceProfileId}'
      AND detail.prompt_id=NEW.outcome#>>'{event,promptId}' AND detail.prompt_version=NEW.outcome#>>'{event,promptVersion}'
      AND detail.template_id IS NOT DISTINCT FROM NEW.outcome#>>'{event,templateId}'
      AND detail.template_version IS NOT DISTINCT FROM NEW.outcome#>>'{event,templateVersion}'
      AND detail.environment=NEW.outcome#>>'{event,environment}'
      AND detail.input_units=(NEW.outcome#>>'{event,inputUnits}')::numeric AND detail.output_units=(NEW.outcome#>>'{event,outputUnits}')::numeric
      AND detail.cache_read_units=(NEW.outcome#>>'{event,cacheReadUnits}')::numeric AND detail.cache_write_units=(NEW.outcome#>>'{event,cacheWriteUnits}')::numeric
      AND detail.total_units=(NEW.outcome#>>'{event,totalUnits}')::numeric
      AND detail.estimated_provider_cost_micros=(NEW.outcome#>>'{event,estimatedProviderCostMicros}')::numeric
      AND detail.reserved_credit_units=(NEW.outcome#>>'{event,reservedCreditUnits}')::numeric
      AND detail.provider_specific_units=(SELECT COALESCE(jsonb_agg(jsonb_build_object('unitName',u->>'unitName','units',u->>'units')),'[]'::jsonb)
        FROM jsonb_array_elements(NEW.outcome#>'{event,providerSpecificUnits}') u)
      AND detail.occurred_at=(NEW.outcome#>>'{event,occurredAt}')::timestamptz
      AND detail.started_at IS NOT DISTINCT FROM (NEW.outcome#>>'{event,startedAt}')::timestamptz
      AND detail.completed_at IS NOT DISTINCT FROM (NEW.outcome#>>'{event,completedAt}')::timestamptz
      AND detail.latency_milliseconds=(NEW.outcome#>>'{event,latencyMilliseconds}')::numeric
      AND detail.failure_category IS NOT DISTINCT FROM NEW.outcome#>>'{event,failureCategory}'
      AND detail.attempts=(SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(a||jsonb_build_object(
        'attemptNumber',a->>'attemptNumber','latencyMilliseconds',a->>'latencyMilliseconds','estimatedProviderCostMicros',a->>'estimatedProviderCostMicros',
        'usage',jsonb_build_object('inputUnits',a#>>'{usage,inputUnits}','outputUnits',a#>>'{usage,outputUnits}',
          'cacheReadUnits',a#>>'{usage,cacheReadUnits}','cacheWriteUnits',a#>>'{usage,cacheWriteUnits}','totalUnits',a#>>'{usage,totalUnits}',
          'providerSpecificUnits',(SELECT COALESCE(jsonb_agg(jsonb_build_object('unitName',u->>'unitName','units',u->>'units')),'[]'::jsonb)
            FROM jsonb_array_elements(a#>'{usage,providerSpecificUnits}') u))))),'[]'::jsonb)
        FROM jsonb_array_elements(NEW.outcome#>'{event,attempts}') a)
      AND detail.charged_credit_units=(NEW.outcome#>>'{event,chargedCreditUnits}')::numeric
      AND detail.compensated_credit_units=(NEW.outcome#>>'{event,compensatedCreditUnits}')::numeric
      AND detail.lifecycle_status=NEW.outcome#>>'{event,status}' AND detail.reconciliation_state=NEW.outcome#>>'{event,reconciliationState}'
      AND ((NEW.outcome_kind='reconciliation-required' AND e.entry_kind='reservation')
        OR (NEW.outcome_kind='settlement' AND e.entry_kind='settlement' AND r.status='settled' AND r.terminal_ledger_entry_id=e.ledger_entry_id)
        OR (NEW.outcome_kind='release' AND e.entry_kind IN ('release','provider-failure') AND r.status='released' AND r.terminal_ledger_entry_id=e.ledger_entry_id)))
  THEN RAISE EXCEPTION 'model accounting evidence must commit with exact canonical ledger and detail' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER model_commercial_accounting_outcomes_ledger AFTER INSERT ON model_commercial_accounting_outcomes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_model_accounting_terminal_ledger();

COMMENT ON TABLE model_commercial_accounting_outcomes IS 'Append-only metadata-only verified terminal credit effects. Unknown usage retains its hold. No content, provider invocation, workflow history mutation or platform dollar refund.';
