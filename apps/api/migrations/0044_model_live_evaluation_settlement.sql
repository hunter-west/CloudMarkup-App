-- Additive receipt-backed V2 evaluation settlement through the canonical ledger.
-- An actual recorded evaluation can be negative quality. This never activates a model.
-- Every historical financial calculation, reservation cap and failure path is retained.
ALTER TABLE model_commercial_accounting_outcomes
  ADD COLUMN live_validation_receipt_id VARCHAR(128),
  ADD COLUMN live_validation_receipt_sha256 CHAR(64),
  ADD CONSTRAINT model_commercial_accounting_validation_presence CHECK(
    ((source_kind='live-invocation-journal' AND outcome_kind='settlement')=(live_validation_receipt_id IS NOT NULL))
    AND ((live_validation_receipt_id IS NULL)=(live_validation_receipt_sha256 IS NULL))
    AND (live_validation_receipt_sha256 IS NULL OR live_validation_receipt_sha256 ~ '^[a-f0-9]{64}$')),
  ADD CONSTRAINT model_commercial_accounting_validation_receipt FOREIGN KEY(organization_id,project_id,principal_id,live_validation_receipt_id)
    REFERENCES model_live_proposal_validation_receipts(organization_id,project_id,principal_id,receipt_id);

DO $$
DECLARE target TEXT; expression TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['usage_ledger_entries_scenario_check','usage_ledger_entries_scenario_outcome_check'] LOOP
    SELECT pg_get_expr(conbin,conrelid) INTO expression FROM pg_constraint
      WHERE conrelid='usage_ledger_entries'::regclass AND conname=target AND contype='c' AND convalidated;
    IF expression IS NULL THEN RAISE EXCEPTION 'legacy scenario constraint preflight failed' USING ERRCODE='23514'; END IF;
    EXECUTE format('ALTER TABLE usage_ledger_entries DROP CONSTRAINT %I',target);
    EXECUTE format('ALTER TABLE usage_ledger_entries ADD CONSTRAINT %I CHECK ((%s) OR (pricing_authority=''model-provider-v1'' AND charging_scenario=''model-evaluation-recorded-v2'' AND entry_kind=''settlement'' AND outcome=''useful-output-delivered''))',target,expression);
  END LOOP;
END;
$$;

-- Reuse the exact established normalized usage/attempt mapping. Only the
-- completed status and successful normalized usage are different.
CREATE FUNCTION cloudmarkup_live_completed_generation_matches(u JSONB,g JSONB) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
  SELECT (u->>'result'='succeeded' AND g->>'status'='completed' AND g->'failureCategory'='null'::jsonb
    AND cloudmarkup_live_failed_generation_matches(u,g||jsonb_build_object('status','internal-failure','failureCategory','model-gateway.internal-error'))) IS TRUE;
$$;

CREATE OR REPLACE FUNCTION validate_model_commercial_accounting_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w jsonb; e jsonb; attempt jsonb; source_attempt jsonb; usage jsonb; item jsonb; response jsonb;
  d model_commercial_reservation_decisions%ROWTYPE; r credit_reservations%ROWTYPE;
  live model_live_invocations%ROWTYPE; validation model_live_proposal_validation_receipts%ROWTYPE; runtime_record JSONB; issued JSONB;
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
    OR jsonb_array_length(w#>'{request,plannedCalls}')<>1 OR w#>>'{request,plannedCalls,0,kind}' IS DISTINCT FROM 'primary'
    OR w#>>'{dispatchIntent,dispatchIntentId}' IS DISTINCT FROM NEW.dispatch_intent_id
    OR w#>>'{reservationReceipt,result,accepted}' IS DISTINCT FROM 'true'
    OR w#>>'{resolvedContext,estimateResult,pricingAuthority,authorityDigest}' IS DISTINCT FROM 'sha256:'||NEW.pricing_authority_sha256
    OR NEW.receipt->>'dispatchedAt' IS DISTINCT FROM w#>>'{dispatchIntent,recordedAt}'
    OR (NEW.receipt->>'receivedAt')::timestamptz < (NEW.receipt->>'dispatchedAt')::timestamptz
    OR (NEW.receipt->>'receivedAt')::timestamptz > clock_timestamp()
  THEN RAISE EXCEPTION 'model terminal source lineage is unavailable' USING ERRCODE='23514'; END IF;
  IF d.mapping_version='intent-extract-runtime-windows-v1' THEN
    IF w#>>'{request,feature}' IS DISTINCT FROM 'intent.extract'
      OR w#>>'{request,requestedRoute}' IS DISTINCT FROM 'standard'
      OR NEW.source_kind='live-invocation-journal' THEN
      RAISE EXCEPTION 'normal terminal authority cannot use live evaluation' USING ERRCODE='23514';
    END IF;
  ELSIF d.mapping_version='live-evaluation-runtime-windows-v2' THEN
    SELECT snapshot INTO runtime_record FROM model_runtime_admissions
      WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND principal_id=NEW.principal_id AND scope_sha256=d.runtime_scope_sha256 FOR SHARE;
    SELECT plan_record INTO issued FROM model_live_evaluation_plans
      WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
      AND 'sha256:'||plan_sha256=runtime_record#>>'{request,liveEvaluationPlanDigest}';
    IF cloudmarkup_live_accounting_binding_valid(w,runtime_record,d.live_binding,issued) IS NOT TRUE
      OR NEW.source_kind NOT IN ('live-invocation-journal','workflow-receipt') OR NEW.outcome_kind NOT IN ('release','settlement')
      OR (NEW.source_kind='workflow-receipt' AND NEW.outcome_kind<>'release')
      OR (NEW.source_kind='workflow-receipt' AND EXISTS(
        SELECT 1 FROM model_live_invocations WHERE organization_id=NEW.organization_id
          AND scope_sha256=NEW.scope_sha256 AND workflow_id=NEW.workflow_id)) THEN
      RAISE EXCEPTION 'live terminal requires exact journal or undispatched expiry authority' USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown terminal accounting mapping' USING ERRCODE='23514';
  END IF;
  e:=NEW.outcome->'event'; response:=NEW.outcome->'response'; terminal:=NEW.outcome_kind<>'reconciliation-required';
  IF e->>'organizationId' IS DISTINCT FROM NEW.organization_id OR e->>'projectId' IS DISTINCT FROM NEW.project_id
    OR e->>'userId' IS DISTINCT FROM NEW.principal_id OR e->>'multiCallWorkflowId' IS DISTINCT FROM NEW.workflow_id
    OR e->>'reservationId' IS DISTINCT FROM w#>>'{request,reservationId}' OR e->>'requestId' IS DISTINCT FROM w#>>'{request,requestId}'
    OR e->>'jobId' IS DISTINCT FROM w#>>'{request,jobId}' OR e->>'feature' IS DISTINCT FROM w#>>'{request,feature}'
    OR e->>'route' IS DISTINCT FROM w#>>'{request,requestedRoute}' OR e->>'routeId' IS DISTINCT FROM w#>>'{resolvedContext,selectedRoute,routeId}'
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
  ELSIF NEW.source_kind='live-invocation-journal' THEN
    SELECT * INTO live FROM model_live_invocations WHERE organization_id=NEW.organization_id
      AND project_id=NEW.project_id AND principal_id=NEW.principal_id AND invocation_id=NEW.live_invocation_id FOR UPDATE;
    IF (live.scope_sha256=NEW.scope_sha256 AND live.workflow_id=NEW.workflow_id
      AND live.reservation_id=w#>>'{request,reservationId}' AND live.dispatch_intent_id=NEW.dispatch_intent_id
      AND live.binding->'requestDigest'=w->'fingerprint'
      AND live.binding->>'accountingBindingDigest'='sha256:'||d.live_binding_sha256
      AND live.binding->'runtimeRequestDigest'=runtime_record#>'{request,requestDigest}'
      AND live.binding->'liveEvaluationPlanDigest'=runtime_record#>'{request,liveEvaluationPlanDigest}'
      AND live.binding->'liveEvaluationAuthorityDigest'=runtime_record#>'{request,liveEvaluationAuthorityDigest}'
      AND live.binding->'evaluationCaseId'=runtime_record#>'{request,evaluationCaseId}'
      AND live.binding->'evaluationCaseDigest'=runtime_record#>'{request,evaluationCaseDigest}'
      AND live.gateway_claim IS NOT NULL
      AND NEW.receipt->'preDispatchProof'='null'::jsonb) IS NOT TRUE THEN
      RAISE EXCEPTION 'live terminal requires authenticated invocation lineage' USING ERRCODE='23514';
    END IF;
    IF NEW.outcome_kind='settlement' THEN
      SELECT * INTO validation FROM model_live_proposal_validation_receipts
        WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
          AND invocation_id=live.invocation_id AND receipt_id=NEW.live_validation_receipt_id;
      IF (validation.receipt_id IS NOT NULL AND validation.receipt_sha256=NEW.live_validation_receipt_sha256
        AND validation.receipt_record->>'journalBindingDigest'='sha256:'||live.binding_sha256
        AND validation.receipt_record->'runtimeRequestDigest'=runtime_record#>'{request,requestDigest}'
        AND validation.receipt_record->'planDigest'=runtime_record#>'{request,liveEvaluationPlanDigest}'
        AND validation.receipt_record->'approvalDigest'=runtime_record#>'{request,liveEvaluationAuthorityDigest}'
        AND validation.receipt_record#>'{assessment,caseId}'=runtime_record#>'{request,evaluationCaseId}'
        AND validation.receipt_record#>'{assessment,caseDigest}'=runtime_record#>'{request,evaluationCaseDigest}'
        AND validation.receipt_record#>'{assessment,inputDigest}'=runtime_record#>'{request,inputDigest}'
        AND validation.receipt_record#>>'{assessment,outputDigest}'='sha256:'||live.output_sha256
        AND validation.created_at>=(issued->>'issuedAt')::timestamptz
        AND validation.created_at<(issued->>'expiresAt')::timestamptz
        AND live.gateway_state='complete' AND live.output_sha256 IS NOT NULL AND live.output_bytes IS NOT NULL
        AND delivered=true AND cloudmarkup_live_completed_generation_matches(live.normalized_usage,live.generation_evidence)) IS NOT TRUE THEN
        RAISE EXCEPTION 'live settlement requires actual scoped case validation' USING ERRCODE='23514';
      END IF;
    ELSIF (live.gateway_state='failed' AND live.output_sha256 IS NULL AND live.output_bytes IS NULL
      AND delivered=false AND cloudmarkup_live_failed_generation_matches(live.normalized_usage,live.generation_evidence)) IS NOT TRUE THEN
      RAISE EXCEPTION 'live release requires authenticated known failed usage' USING ERRCODE='23514';
    END IF;
    expected_result:=live.generation_evidence;
    IF source_result-ARRAY['attempts','completedAt','usefulOutputDelivered'] IS DISTINCT FROM expected_result-ARRAY['attempts','completedAt']
      OR jsonb_array_length(source_result->'attempts')<>1
      OR (source_result#>'{attempts,0}')-ARRAY['startedAt','completedAt','latencyMilliseconds']
        IS DISTINCT FROM (expected_result#>'{attempts,0}')-ARRAY['startedAt','completedAt','latencyMilliseconds'] THEN
      RAISE EXCEPTION 'live receipt differs from authenticated generation' USING ERRCODE='23514';
    END IF;
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
      AND ((o.outcome_kind='settlement' AND NEW.entry_kind='settlement'
          AND ((o.source_kind='preview-journal' AND o.live_validation_receipt_id IS NULL AND NEW.charging_scenario='model-preview-delivered-v1')
            OR (o.source_kind='live-invocation-journal' AND NEW.charging_scenario='model-evaluation-recorded-v2'
              AND EXISTS(SELECT 1 FROM model_live_proposal_validation_receipts v
                WHERE v.organization_id=o.organization_id AND v.project_id=o.project_id AND v.principal_id=o.principal_id
                  AND v.invocation_id=o.live_invocation_id AND v.receipt_id=o.live_validation_receipt_id
                  AND v.receipt_sha256=o.live_validation_receipt_sha256))))
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
