import {
  digestStructuredValue as digest,
  modelHostSeedUsageToCommercialAttemptV4,
  modelHostRepairSuccessorUsageToCommercialAttemptV4,
  type ModelCommercialInvocationAttemptV1,
  type ModelCommercialWorkflowRecordV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceAttemptObservationV4Schema,
  modelLiveSequenceDispatchV4Schema,
  modelLiveSequenceInputV3Schema,
  normalizedModelUsageV1Schema,
  utcTimestampSchema,
  type ModelLiveSequenceInputV3,
  type ModelLiveSequenceDispatchV4,
  type ModelLiveSeedInvocationDescriptorV3,
  type ModelLiveRepairSuccessorInvocationDescriptorV4,
  type NormalizedModelUsageV1,
} from "@cloudmarkup/schemas";
import { requireSequenceAuthority as requireAuthority } from "./model-live-sequence-authority-codec.js";

/** Known physical usage only. The closed host loads the issued input, immutable
 * dispatch and canonical workflow. This projection grants no validation,
 * settlement, second-stage permission or proof of useful output delivery. */
export function prepareRepairUsageObservationV4(input: {
  readonly stage: ModelLiveSequenceInputV3;
  readonly dispatch: ModelLiveSequenceDispatchV4;
  readonly descriptor:
    | ModelLiveSeedInvocationDescriptorV3
    | ModelLiveRepairSuccessorInvocationDescriptorV4;
  readonly ordinal: 1 | 2;
  readonly predecessor: {
    readonly stage: ModelLiveSequenceInputV3;
    readonly attempt: ModelCommercialInvocationAttemptV1;
  } | null;
  readonly workflow: ModelCommercialWorkflowRecordV1;
  readonly usage: NormalizedModelUsageV1;
  readonly observedAt: string;
}) {
  const stage = modelLiveSequenceInputV3Schema.parse(input.stage);
  const dispatch = modelLiveSequenceDispatchV4Schema.parse(input.dispatch);
  const descriptor = input.descriptor;
  const ordinal = input.ordinal;
  const usage = normalizedModelUsageV1Schema.parse(input.usage);
  const observedAt = utcTimestampSchema.parse(input.observedAt);
  const workflow = input.workflow;
  const planned = workflow.request.plannedCalls[ordinal - 1];
  requireAuthority(
    stage.stageKey === (ordinal === 1 ? "repair-1" : "repair-2") &&
      dispatch.canonicalAttemptOrdinal === ordinal &&
      dispatch.inputBindingDigest === stage.inputBindingDigest &&
      dispatch.descriptorDigest === digest(descriptor) &&
      workflow.fingerprint === digest(workflow.request) &&
      dispatch.canonicalWorkflowFingerprint === workflow.fingerprint &&
      workflow.dispatchIntent !== null &&
      dispatch.canonicalDispatchIntentDigest ===
        digest(workflow.dispatchIntent) &&
      planned?.kind === "repair" &&
      dispatch.canonicalPlannedCallDigest === digest(planned) &&
      Date.parse(observedAt) >= Date.parse(dispatch.dispatchedAt),
  );
  for (const key of [
    "selectionId",
    "selectionDigest",
    "planDigest",
    "caseId",
    "caseDigest",
    "stageKey",
    "stageId",
    "invocationId",
  ] as const)
    requireAuthority(dispatch[key] === stage[key]);
  const args = { stage, usage, predecessor: input.predecessor };
  const attempt =
    descriptor.contractVersion === 3
      ? modelHostSeedUsageToCommercialAttemptV4({ ...args, descriptor })
      : modelHostRepairSuccessorUsageToCommercialAttemptV4({
          ...args,
          descriptor,
        });
  const body = {
    contractVersion: 4 as const,
    parentSequenceContractVersion: 3 as const,
    recordKind: "model-live-sequence-attempt-observation" as const,
    selectionId: stage.selectionId,
    selectionDigest: stage.selectionDigest,
    planDigest: stage.planDigest,
    caseId: stage.caseId,
    caseDigest: stage.caseDigest,
    stageKey: stage.stageKey,
    stageId: stage.stageId,
    invocationId: stage.invocationId,
    inputBindingDigest: stage.inputBindingDigest,
    dispatchDigest: dispatch.dispatchDigest,
    canonicalWorkflowFingerprint: workflow.fingerprint,
    canonicalAttemptOrdinal: ordinal,
    canonicalAttemptDigest: digest(attempt),
    normalizedUsageDigest: digest(usage),
    observedAt,
  };
  return {
    observation: modelLiveSequenceAttemptObservationV4Schema.parse({
      ...body,
      observationDigest: digest(body),
    }),
    usage,
    attempt,
  };
}
