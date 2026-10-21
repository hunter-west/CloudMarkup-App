import {
  digestStructuredValue,
  type ModelCommercialInvocationContextV1,
  type ModelCommercialWorkflowRecordV1,
  type ModelGatewayResultV1,
} from "@cloudmarkup/model-gateway";
import {
  modelGatewayResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  normalizedModelUsageV1Schema,
} from "@cloudmarkup/schemas";
import { createLiveAccountingPgFixture } from "./model-live-commercial-accounting-pg-test-helpers.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { PostgresModelLiveInvocationJournal } from "./model-live-invocation-journal.js";
import { liveJournalBindingSchema } from "./model-live-invocation-journal-codec.js";
import { invocationFixture } from "./model-runtime-invocation-test-helpers.js";
import { parseClaim } from "./model-runtime-invocation-codec.js";
import { sql } from "./sql.js";

/** Isolated synthetic provider metadata over real issued plans, PostgreSQL
 * reservations and workflow transitions. Never actual usage or validator proof. */
export async function createLiveJournalPgFixture(
  harness: ReturnType<typeof createModelAccountingPgTestHarness>,
  mode: "standard" | "deep" = "standard",
  host?: NonNullable<Parameters<typeof createLiveAccountingPgFixture>[3]> & {
    bindResult(result: ModelGatewayResultV1): ModelGatewayResultV1;
    bindScope?(
      scope: ModelGatewayResultV1["descriptor"]["scope"],
    ): ModelGatewayResultV1["descriptor"]["scope"];
  },
  expiry: { readonly expiresAfterMilliseconds?: number } = {},
) {
  const f = await createLiveAccountingPgFixture(
    harness,
    "100",
    mode,
    host,
    expiry,
  );
  const result = await f.adapter.reserve(f.input);
  const request = f.record.request,
    resolved = f.record.resolvedContext;
  if (
    !result.accepted ||
    resolved === null ||
    f.record.reservationIntent === null
  )
    throw Error("Synthetic reservation unavailable.");
  const at = new Date().toISOString();
  const receiptBody = {
    accountingStatus: "active" as const,
    authority: "canonical-commercial-reservation-receipt-v1" as const,
    intentId: f.record.reservationIntent.intentId,
    receivedAt: at,
    result,
  };
  const reserved: ModelCommercialWorkflowRecordV1 = {
    ...f.record,
    state: "reserved",
    reservationReceipt: {
      ...receiptBody,
      receiptId:
        "commercial_reservation_receipt_" +
        digestStructuredValue(receiptBody).slice(7, 55),
    },
  };
  const saved = await f.workflows.compareAndSet({
    expectedRevision: f.record.revision,
    lease: f.workflowLease,
    record: reserved,
    tenantScopeDigest: f.scope.tenantScopeDigest,
    trustedNow: at,
  });
  const dispatched = await f.workflows.compareAndSet({
    expectedRevision: saved.revision,
    lease: f.workflowLease,
    record: {
      ...saved,
      dispatchIntent: {
        dispatchIntentId: "dispatch_synthetic",
        recordedAt: at,
      },
    },
    tenantScopeDigest: f.scope.tenantScopeDigest,
    trustedNow: at,
  });
  const estimate = resolved.estimateResult;
  const callback: ModelCommercialInvocationContextV1 = {
    dispatchIntentId: "dispatch_synthetic",
    multiCallWorkflowId: request.multiCallWorkflowId,
    reservationId: request.reservationId,
    route: resolved.selectedRoute,
    acceptedMaximumCreditUnits: estimate.estimate.maximumCreditUnits,
    acceptedMaximumEstimatedProviderCostMicros:
      estimate.maximumEstimatedProviderCostMicros,
    pricingAuthorityDigest: estimate.pricingAuthority.authorityDigest,
    pricingCatalogDigest: estimate.pricingAuthority.pricingCatalogDigest,
    normalizationPolicyCatalogDigest:
      estimate.pricingAuthority.normalizationPolicyCatalogDigest,
    pricingVersionReference: estimate.primaryPricingVersionId,
    normalizationPolicyVersionReference: estimate.normalizationPolicyVersionId,
  };
  const baseScope = {
    organizationId: request.organizationId,
    projectId: request.projectId,
    userId: request.userId,
    jobId: request.jobId,
  };
  const scope = host?.bindScope?.(baseScope) ?? baseScope;
  const base = invocationFixture(scope);
  const admission = f.runtime.request;
  const binding = liveJournalBindingSchema.parse({
    contractVersion: 2,
    scope,
    invocationId: base.claim.invocationId,
    claimAuthorityDigest: base.claim.authorityDigest,
    requestDigest: digestStructuredValue(request),
    runtimeRequestDigest: admission.requestDigest,
    accountingBindingDigest: digestStructuredValue(f.binding),
    liveEvaluationPlanDigest: admission.liveEvaluationPlanDigest,
    liveEvaluationAuthorityDigest: admission.liveEvaluationAuthorityDigest,
    evaluationCaseId: admission.evaluationCaseId,
    evaluationCaseDigest: admission.evaluationCaseDigest,
    inputDigest: admission.inputDigest,
    idempotencyKeyDigest: admission.idempotencyKeyDigest,
  });
  const claim = parseClaim({
    ...base.claim,
    inputDigest: binding.inputDigest,
    idempotencyKeyDigest: binding.idempotencyKeyDigest,
  });
  const route = callback.route;
  const descriptor = modelInvocationDescriptorV1Schema.parse({
    ...base.result.descriptor,
    feature: request.feature,
    inputDigest: binding.inputDigest,
    idempotencyKeyDigest: binding.idempotencyKeyDigest,
    budgetDecisionId: request.reservationId,
    promptTemplateId: request.promptId,
    promptVersion: request.promptVersion,
    promptDigest: admission.promptTemplateDigest,
    modelId: route.modelId,
    modelVersion: route.modelVersion,
    providerId: route.providerKey,
    inferenceProfileId: route.inferenceProfileId,
    routing: {
      ...base.result.descriptor.routing,
      routeId: route.routeId,
      routingDecisionDigest: admission.routingDecisionDigest,
      acceptedMaximumCreditUnits: callback.acceptedMaximumCreditUnits,
    },
  });
  const usage = normalizedModelUsageV1Schema.parse({
    ...base.result.usage,
    feature: descriptor.feature,
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    providerId: descriptor.providerId,
    inferenceProfileId: descriptor.inferenceProfileId,
    inputDigest: descriptor.inputDigest,
    idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
    promptTemplateId: descriptor.promptTemplateId,
    promptVersion: descriptor.promptVersion,
    routing: descriptor.routing,
    startedAt: at,
    completedAt: at,
    durationMilliseconds: 0,
  });
  const response = modelGatewayResponseV1Schema.parse({
    contractVersion: 1,
    operation: "architecture.propose",
    services: [],
    relationships: [],
    proposalContext: base.result.response.proposalContext,
    provenance: {
      ...base.result.response.provenance,
      inputDigest: descriptor.inputDigest,
      modelId: descriptor.modelId,
      modelVersion: descriptor.modelVersion,
      providerId: descriptor.providerId,
      inferenceProfileId: descriptor.inferenceProfileId,
      promptTemplateId: descriptor.promptTemplateId,
      promptVersion: descriptor.promptVersion,
      promptDigest: descriptor.promptDigest,
    },
  });
  const rawResult = { ...base.result, descriptor, response, usage };
  const gatewayResult = host?.bindResult(rawResult) ?? rawResult;
  const options = {
    binding,
    request,
    admissionRequest: admission,
    accountingBinding: f.binding,
    plans: f.plans,
    definitionId: f.identity.definitionId,
  };
  const journal = new PostgresModelLiveInvocationJournal(options);
  const row = async () =>
    (
      await harness.database.query(
        sql("SELECT * FROM model_live_invocations WHERE organization_id=$1", [
          request.organizationId,
        ]),
      )
    ).rows[0];
  if (dispatched.dispatchIntent === null)
    throw Error("Synthetic dispatch unavailable.");
  const recoveryInput = {
    dispatchIntent: dispatched.dispatchIntent,
    request,
    admissionRequest: admission,
  };
  return {
    ...f,
    recoveryInput,
    dispatched,
    callback,
    claim,
    gatewayResult,
    usage: gatewayResult.usage,
    journal,
    options,
    journalBinding: binding,
    row,
  };
}
