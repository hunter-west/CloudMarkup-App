import {
  digestStructuredValue,
  parseModelLiveCommercialInvocationEvidenceV2,
  type ModelCommercialWorkflowRecordV1,
  type ModelCommercialInvocationContextV1,
  type ModelLiveCommercialInvocationRecoveryPortV2,
} from "@cloudmarkup/model-gateway";
import type { ModelLiveRuntimeAdmissionRequestV2 } from "@cloudmarkup/schemas";
import { parseClaim } from "./model-runtime-invocation-codec.js";
import {
  liveJournalAssert,
  liveJournalBindingSchema,
  liveJournalGeneration,
  liveJournalJson,
  liveJournalRead,
  liveJournalSame,
  liveJournalUsage,
  liveJournalScope,
  ModelLiveJournalError,
  type ModelLiveJournalBindingV2,
} from "./model-live-invocation-journal-codec.js";
import {
  modelLiveProposalValidationReceiptV2Schema,
  type ModelLiveProposalValidationReceiptV2,
} from "./model-live-proposal-validation-codec.js";
import type { SqlRow } from "./sql.js";

export function liveJournalClaim(raw: unknown, b: ModelLiveJournalBindingV2) {
  try {
    const claim = parseClaim(raw);
    liveJournalAssert(
      claim.escalation === undefined &&
        claim.invocationId === b.invocationId &&
        claim.authorityDigest === b.claimAuthorityDigest &&
        claim.inputDigest === b.inputDigest &&
        claim.idempotencyKeyDigest === b.idempotencyKeyDigest,
    );
    liveJournalJson(claim, 1024);
    return claim;
  } catch {
    throw new ModelLiveJournalError();
  }
}
export function liveJournalCallback(
  workflow: ModelCommercialWorkflowRecordV1,
): ModelCommercialInvocationContextV1 {
  const resolved = workflow.resolvedContext;
  liveJournalAssert(resolved !== null && workflow.dispatchIntent !== null);
  const estimate = resolved.estimateResult;
  return {
    dispatchIntentId: workflow.dispatchIntent.dispatchIntentId,
    multiCallWorkflowId: workflow.request.multiCallWorkflowId,
    reservationId: workflow.request.reservationId,
    acceptedMaximumCreditUnits: estimate.estimate.maximumCreditUnits,
    acceptedMaximumEstimatedProviderCostMicros:
      estimate.maximumEstimatedProviderCostMicros,
    pricingAuthorityDigest: estimate.pricingAuthority.authorityDigest,
    pricingCatalogDigest: estimate.pricingAuthority.pricingCatalogDigest,
    normalizationPolicyCatalogDigest:
      estimate.pricingAuthority.normalizationPolicyCatalogDigest,
    pricingVersionReference: estimate.primaryPricingVersionId,
    normalizationPolicyVersionReference: estimate.normalizationPolicyVersionId,
    route: resolved.selectedRoute,
  };
}
/** Pure metadata comparison for an already authenticated host transaction.
 * The caller must join the issued plan, current tenant/project, workflow,
 * runtime and accepted canonical reservation. This function issues no authority. */
export function recoverLiveJournalRow(
  row: SqlRow | null,
  workflow: ModelCommercialWorkflowRecordV1,
  admission: ModelLiveRuntimeAdmissionRequestV2,
  accountingBindingDigest: string,
  expectedBinding?: ModelLiveJournalBindingV2,
  validationReceipt?: ModelLiveProposalValidationReceiptV2 | null,
  expiredReservation?: {
    readonly expiresAt: string;
    readonly observedAt: string;
  },
): Awaited<
  ReturnType<ModelLiveCommercialInvocationRecoveryPortV2["recoverVerified"]>
> {
  if (row === null) return { kind: "unavailable" };
  const b = liveJournalBindingSchema.parse(liveJournalRead(row["binding"]));
  const request = workflow.request,
    dispatch = workflow.dispatchIntent;
  liveJournalAssert(
    dispatch !== null &&
      (expectedBinding === undefined || liveJournalSame(b, expectedBinding)) &&
      row["organization_id"] === request.organizationId &&
      row["project_id"] === request.projectId &&
      row["principal_id"] === request.userId &&
      row["scope_sha256"] === liveJournalScope(b).tenantScopeDigest.slice(7) &&
      row["workflow_id"] === request.multiCallWorkflowId &&
      row["reservation_id"] === request.reservationId &&
      row["invocation_id"] === b.invocationId &&
      row["binding_sha256"] === digestStructuredValue(b).slice(7) &&
      b.scope.organizationId === request.organizationId &&
      b.scope.projectId === request.projectId &&
      b.scope.userId === request.userId &&
      b.scope.jobId === request.jobId &&
      b.requestDigest === workflow.fingerprint &&
      b.requestDigest === digestStructuredValue(request) &&
      b.runtimeRequestDigest === admission.requestDigest &&
      b.accountingBindingDigest === accountingBindingDigest &&
      b.liveEvaluationPlanDigest === admission.liveEvaluationPlanDigest &&
      b.liveEvaluationAuthorityDigest ===
        admission.liveEvaluationAuthorityDigest &&
      b.evaluationCaseId === admission.evaluationCaseId &&
      b.evaluationCaseDigest === admission.evaluationCaseDigest &&
      b.inputDigest === admission.inputDigest &&
      b.idempotencyKeyDigest === admission.idempotencyKeyDigest &&
      row["dispatch_intent_id"] === dispatch.dispatchIntentId &&
      ["registered", "claimed", "complete", "failed"].includes(
        String(row["gateway_state"]),
      ),
  );
  const callback = liveJournalCallback(workflow);
  liveJournalAssert(
    liveJournalSame(liveJournalRead(row["callback_metadata"]), callback),
  );
  const completed = row["gateway_state"] === "complete";
  if (row["gateway_state"] !== "failed" && !completed)
    return { kind: "pending" };
  const unvalidated = completed && validationReceipt == null;
  if (unvalidated) {
    if (expiredReservation === undefined) return { kind: "pending" };
    liveJournalAssert(
      expiredReservation.expiresAt === request.expiresAt &&
        Number.isFinite(Date.parse(expiredReservation.observedAt)) &&
        Date.parse(expiredReservation.observedAt) >=
          Date.parse(request.expiresAt),
    );
  }
  liveJournalAssert(
    row["gateway_claim"] !== null &&
      (completed ||
        (row["output_sha256"] === null && row["output_bytes"] === null)),
  );
  liveJournalClaim(liveJournalRead(row["gateway_claim"]), b);
  if (row["normalized_usage"] === null) {
    liveJournalAssert(row["generation_evidence"] === null);
    return { kind: "pending" };
  }
  const usage = liveJournalUsage(
    liveJournalRead(row["normalized_usage"]),
    b,
    callback,
    request,
    admission,
  );
  const generation = liveJournalGeneration(
    usage,
    b,
    request,
    admission,
    !completed,
  );
  const accepted =
    completed && !unvalidated
      ? modelLiveProposalValidationReceiptV2Schema.parse(validationReceipt)
      : null;
  if (accepted !== null) {
    liveJournalAssert(
      accepted.organizationId === request.organizationId &&
        accepted.projectId === request.projectId &&
        accepted.userId === request.userId &&
        accepted.invocationId === b.invocationId &&
        accepted.journalBindingDigest === digestStructuredValue(b) &&
        accepted.normalizedUsageDigest === digestStructuredValue(usage) &&
        accepted.runtimeRequestDigest === admission.requestDigest &&
        accepted.planDigest === admission.liveEvaluationPlanDigest &&
        accepted.approvalDigest === admission.liveEvaluationAuthorityDigest &&
        accepted.assessment.caseId === admission.evaluationCaseId &&
        accepted.assessment.caseDigest === admission.evaluationCaseDigest &&
        accepted.assessment.inputDigest === admission.inputDigest &&
        accepted.assessment.outputDigest ===
          "sha256:" + String(row["output_sha256"]) &&
        usage.result === "succeeded",
    );
  }
  liveJournalAssert(
    liveJournalSame(liveJournalRead(row["generation_evidence"]), generation),
  );
  return parseModelLiveCommercialInvocationEvidenceV2(
    {
      kind: "verified",
      authority: "canonical-model-live-invocation-v2",
      requestDigest: b.requestDigest,
      dispatchIntentId: dispatch.dispatchIntentId,
      evaluation: {
        runtimeRequestDigest: b.runtimeRequestDigest,
        liveEvaluationPlanDigest: b.liveEvaluationPlanDigest,
        liveEvaluationAuthorityDigest: b.liveEvaluationAuthorityDigest,
        evaluationCaseId: b.evaluationCaseId,
        evaluationCaseDigest: b.evaluationCaseDigest,
      },
      source: unvalidated
        ? "expired-unvalidated-output"
        : completed
          ? "validated-output"
          : "failed-generation",
      outputDigest: unvalidated
        ? "sha256:" + String(row["output_sha256"])
        : (accepted?.assessment.outputDigest ?? null),
      validationReceiptDigest: accepted?.receiptDigest ?? null,
      result: unvalidated
        ? {
            ...generation,
            status: "internal-failure",
            failureCategory:
              "cloudmarkup.model-evaluation.validation-unavailable",
            usefulOutputDelivered: false,
          }
        : { ...generation, usefulOutputDelivered: completed },
    },
    request,
    dispatch,
    admission,
  );
}
