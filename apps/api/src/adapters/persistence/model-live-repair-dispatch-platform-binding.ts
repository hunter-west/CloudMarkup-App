import {
  digestStructuredValue,
  type ModelLiveSeedRuntimeExecutionInputV4,
  type ModelCommercialWorkflowRecordV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceDispatchV4Schema,
  utcTimestampSchema,
  type ModelLiveSeedInvocationDescriptorV3,
  type ModelLiveRepairSuccessorInvocationDescriptorV4,
  type ModelLiveSequenceInputV3,
} from "@cloudmarkup/schemas";
import {
  modelPlatformReservationInputSchema,
  modelPlatformReservationReceiptSchema,
  type ModelPlatformReservationInput,
  type ModelPlatformReservationReceipt,
} from "../model-platform-spend.js";
import {
  requireSequenceAuthority,
  sameSequenceMetadata,
} from "./model-live-sequence-authority-codec.js";

/** Shared arithmetic and exact platform/workflow joins after distinct stage readers.
 * This pure projection cannot authenticate any supplied row or issue a send. */
export function prepareBoundRepairDispatchV4(input: {
  readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
  readonly descriptor:
    | ModelLiveSeedInvocationDescriptorV3
    | ModelLiveRepairSuccessorInvocationDescriptorV4;
  readonly stage: ModelLiveSequenceInputV3;
  readonly ordinal: 1 | 2;
  readonly preparedPayloadDigest: string;
  readonly workflow: ModelCommercialWorkflowRecordV1;
  readonly platformClaim: ModelPlatformReservationInput;
  readonly platformReceipt: ModelPlatformReservationReceipt;
  readonly dispatchedAt: string;
}) {
  const { execution, descriptor, stage, ordinal } = input;
  requireSequenceAuthority(
    stage.stageKey === (ordinal === 1 ? "repair-1" : "repair-2"),
  );
  const claim = modelPlatformReservationInputSchema.parse(input.platformClaim);
  const receipt = modelPlatformReservationReceiptSchema.parse(
    input.platformReceipt,
  );
  const dispatchedAt = utcTimestampSchema.parse(input.dispatchedAt);
  const request = execution.commercialRequest;
  const workflow = input.workflow;
  const planned = request.plannedCalls[ordinal - 1];
  const route = execution.routingDecision;
  const scope = {
    organizationId: request.organizationId,
    projectId: request.projectId,
    userId: request.userId,
    jobId: request.jobId,
  };
  requireSequenceAuthority(
    sameSequenceMetadata(workflow.request, request) &&
      workflow.fingerprint === digestStructuredValue(request) &&
      workflow.reservationReceipt?.result.accepted === true &&
      workflow.reservationReceipt.result.reservationId ===
        request.reservationId &&
      workflow.dispatchIntent !== null &&
      planned?.kind === "repair" &&
      planned.routeId === descriptor.routing.routeId &&
      descriptor.invocationId === stage.invocationId &&
      descriptor.inputDigest === stage.operationInputDigest &&
      (ordinal === 2 ||
        descriptor.idempotencyKeyDigest ===
          execution.admissionRequest.idempotencyKeyDigest) &&
      descriptor.budgetDecisionId === request.reservationId &&
      sameSequenceMetadata(descriptor.scope, scope) &&
      sameSequenceMetadata(claim.scope, scope) &&
      claim.invocationId === stage.invocationId &&
      claim.ceiling.invocationDigest === input.preparedPayloadDigest &&
      input.preparedPayloadDigest === stage.preparedPayloadDigest &&
      receipt.dispatchId === claim.dispatchId &&
      receipt.claimDigest === digestStructuredValue(claim) &&
      receipt.monthUtc === receipt.reservedAt.slice(0, 7) &&
      receipt.monthUtc === dispatchedAt.slice(0, 7) &&
      Date.parse(receipt.dispatchBefore) - Date.parse(receipt.reservedAt) ===
        5000 &&
      Date.parse(dispatchedAt) >= Date.parse(receipt.reservedAt) &&
      Date.parse(dispatchedAt) < Date.parse(receipt.dispatchBefore) &&
      Date.parse(dispatchedAt) >=
        Date.parse(workflow.dispatchIntent.recordedAt) &&
      Date.parse(dispatchedAt) < Date.parse(request.expiresAt) &&
      Date.parse(dispatchedAt) >= Date.parse(claim.ceiling.validFrom) &&
      Date.parse(dispatchedAt) < Date.parse(claim.ceiling.validUntil) &&
      claim.ceiling.dispatchValidUntil !== undefined &&
      Date.parse(dispatchedAt) < Date.parse(claim.ceiling.dispatchValidUntil),
  );
  requireSequenceAuthority(
    claim.ceiling.providerId === descriptor.providerId &&
      claim.ceiling.modelId === descriptor.modelId &&
      claim.ceiling.modelVersion === descriptor.modelVersion &&
      claim.ceiling.inferenceProfileId === descriptor.inferenceProfileId &&
      claim.ceiling.pricingVersionId === route.pricingVersionReference &&
      claim.ceiling.maximumCostMicroUsd <=
        execution.admissionRequest.commercialEstimate.estimatedMicroUsd &&
      descriptor.providerId === route.providerId &&
      descriptor.modelId === route.modelId &&
      descriptor.modelVersion === route.modelVersion &&
      descriptor.inferenceProfileId === route.inferenceProfileId,
  );
  const body = {
    contractVersion: 4 as const,
    parentSequenceContractVersion: 3 as const,
    recordKind: "model-live-sequence-dispatch" as const,
    selectionId: stage.selectionId,
    selectionDigest: stage.selectionDigest,
    planDigest: stage.planDigest,
    caseId: stage.caseId,
    caseDigest: stage.caseDigest,
    stageKey: stage.stageKey,
    stageId: stage.stageId,
    invocationId: stage.invocationId,
    inputBindingDigest: stage.inputBindingDigest,
    descriptorDigest: digestStructuredValue(descriptor),
    runtimeRequestDigest: execution.admissionRequest.requestDigest,
    platformReservationDigest: digestStructuredValue(receipt),
    canonicalWorkflowFingerprint: workflow.fingerprint,
    canonicalDispatchIntentDigest: digestStructuredValue(
      workflow.dispatchIntent,
    ),
    canonicalPlannedCallDigest: digestStructuredValue(planned),
    canonicalAttemptOrdinal: ordinal,
    dispatchedAt,
  };
  return modelLiveSequenceDispatchV4Schema.parse({
    ...body,
    dispatchDigest: digestStructuredValue(body),
  });
}
