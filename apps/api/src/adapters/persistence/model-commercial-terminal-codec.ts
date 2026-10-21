import {
  digestStructuredValue,
  projectModelCommercialTerminalOutcomeV1,
  type CanonicalModelUsageEventV1,
  type ModelCommercialWorkflowRecordV1,
  type ModelCommercialVerifiedScopeV1,
} from "@cloudmarkup/model-gateway";
import type {
  AppendModelUsageEventDetailInput,
  ModelUsageUnitsPersistenceInput,
} from "../../application/model-commercial-persistence.js";
import { accountingAssert } from "./model-commercial-accounting-codec.js";
import {
  parseWorkflowRecord,
  workflowJson,
} from "./model-commercial-workflow-codec.js";

export function terminalProjection(
  raw: unknown,
  workflow: ModelCommercialWorkflowRecordV1,
  scope: ModelCommercialVerifiedScopeV1,
  databaseNoDispatchVerified = false,
) {
  accountingAssert(
    raw !== null && typeof raw === "object" && !Array.isArray(raw),
  );
  const receipt = raw as Record<string, unknown>;
  const record = parseWorkflowRecord(
    {
      ...workflow,
      invocationReceipt: raw,
      invocationResult: receipt["result"],
      response: null,
      state: "invoked",
    },
    scope,
  );
  // Callers may additionally verify the private SQL-issued repair expiry proof.
  // Pure projection grants no tenant or financial authority. Historical callers
  // use only the immutable coordinator-issued no-dispatch proof.
  // Callback-origin attestations require their own host verifier and stay held.
  // parseWorkflowRecord already enforces the exact authority/reason literals.
  const proof = record.invocationReceipt?.preDispatchProof;
  const noDispatch =
    proof !== null &&
    proof !== undefined &&
    record.invocationReceipt?.result.attempts.length === 0 &&
    proof.organizationId === record.request.organizationId &&
    proof.projectId === record.request.projectId &&
    proof.multiCallWorkflowId === record.request.multiCallWorkflowId &&
    proof.reservationId === record.request.reservationId &&
    record.invocationReceipt.result.failureCategory ===
      "reservation-expired-before-dispatch" &&
    record.invocationReceipt.result.status === "internal-failure" &&
    !record.invocationReceipt.result.usefulOutputDelivered &&
    proof.dispatchIntentId === record.dispatchIntent?.dispatchIntentId &&
    proof.observedAt === record.invocationReceipt.receivedAt &&
    Date.parse(proof.observedAt) >= Date.parse(record.request.expiresAt);
  const outcome = projectModelCommercialTerminalOutcomeV1(
    record,
    noDispatch || databaseNoDispatchVerified,
  );
  workflowJson(outcome);
  return { record, outcome };
}
export const modelTerminalIdentity = (
  kind: string,
  event: CanonicalModelUsageEventV1,
) =>
  `model_${kind}_${digestStructuredValue({
    organizationId: event.organizationId,
    projectId: event.projectId,
    userId: event.userId,
    eventId: event.eventId,
  }).slice(7)}`;
function units(
  e:
    | CanonicalModelUsageEventV1
    | CanonicalModelUsageEventV1["attempts"][number]["usage"],
): ModelUsageUnitsPersistenceInput {
  return {
    inputUnits: String(e.inputUnits),
    outputUnits: String(e.outputUnits),
    cacheReadUnits: String(e.cacheReadUnits),
    cacheWriteUnits: String(e.cacheWriteUnits),
    totalUnits: String(e.totalUnits),
    providerSpecificUnits: e.providerSpecificUnits.map((u) => ({
      unitName: u.unitName,
      units: String(u.units),
    })),
  };
}
export function modelTerminalDetail(
  e: CanonicalModelUsageEventV1,
  ledgerEntryId: string,
): AppendModelUsageEventDetailInput {
  return {
    ...units(e),
    ledgerEntryId,
    modelUsageEventId: modelTerminalIdentity("usage", e),
    modelUsageIdempotencyKeySha256: digestStructuredValue(e).slice(7),
    modelRoute: e.route,
    modelRouteId: e.routeId,
    ...(e.inferenceProfileId === null
      ? {}
      : { inferenceProfileId: e.inferenceProfileId }),
    promptId: e.promptId,
    promptVersion: e.promptVersion,
    ...(e.templateId === null ? {} : { templateId: e.templateId }),
    ...(e.templateVersion === null
      ? {}
      : { templateVersion: e.templateVersion }),
    pricingVersionId: e.pricingVersionId,
    normalizationPolicyVersionId: e.normalizationPolicyVersionId,
    environment: e.environment,
    estimatedProviderCostMicros: String(e.estimatedProviderCostMicros),
    reservedCreditUnits: String(e.reservedCreditUnits),
    chargedCreditUnits: String(e.chargedCreditUnits),
    compensatedCreditUnits: String(e.compensatedCreditUnits),
    occurredAt: e.occurredAt,
    ...(e.startedAt === null ? {} : { startedAt: e.startedAt }),
    ...(e.completedAt === null ? {} : { completedAt: e.completedAt }),
    status: e.status,
    ...(e.failureCategory === null
      ? {}
      : { failureCategory: e.failureCategory }),
    multiCallWorkflowId: e.multiCallWorkflowId,
    reconciliationState: e.reconciliationState,
    attempts: e.attempts.map((a) => ({
      attemptId: a.attemptId,
      attemptKind: a.attemptKind,
      attemptNumber: String(a.attemptNumber),
      callId: a.callId,
      completedAt: a.completedAt,
      estimatedProviderCostMicros: String(a.estimatedProviderCostMicros),
      ...(a.failureCategory === null
        ? {}
        : { failureCategory: a.failureCategory }),
      ...(a.inferenceProfileId === null
        ? {}
        : { inferenceProfileId: a.inferenceProfileId }),
      invocationId: a.invocationId,
      latencyMilliseconds: String(a.latencyMilliseconds),
      mayHaveBeenProcessed: a.mayHaveBeenProcessed,
      modelId: a.modelId,
      modelVersion: a.modelVersion,
      normalizationPolicyVersionId: a.normalizationPolicyVersionId,
      pricingVersionId: a.pricingVersionId,
      promptId: a.promptId,
      promptVersion: a.promptVersion,
      providerKey: a.providerKey,
      ...(a.providerRequestId === null
        ? {}
        : { providerRequestId: a.providerRequestId }),
      ...(a.retryOfAttemptId === null
        ? {}
        : { retryOfAttemptId: a.retryOfAttemptId }),
      routeId: a.routeId,
      startedAt: a.startedAt,
      status: a.status,
      usage: units(a.usage),
      usageRecordId: a.usageRecordId,
    })),
  };
}
