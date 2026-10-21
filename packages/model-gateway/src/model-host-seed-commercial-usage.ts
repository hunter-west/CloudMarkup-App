import {
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  type ModelLiveRepairSuccessorInvocationDescriptorV4,
  modelLiveSequenceInputV3Schema,
  normalizedModelUsageV1Schema,
  type ModelLiveSeedInvocationDescriptorV3,
  type ModelLiveSequenceInputV3,
  type NormalizedModelUsageV1,
} from "@cloudmarkup/schemas";
import {
  parseModelCommercialInvocationAttemptV1,
  type ModelCommercialInvocationAttemptV1,
} from "./commercial-lifecycle.js";
import { attemptStatus, commercialUnits } from "./commercial-usage-units.js";
import { digestStructuredValue } from "./security.js";

function requireBinding(value: boolean): asserts value {
  if (!value) throw new Error("Seed usage does not match its actual stage.");
}

/** Pure known-usage projection. Each physical request has attempt number one;
 * the canonical workflow has repair ordinals one and two. The closed host must
 * verify issued input, dispatch, predecessor outcome and current authority.
 * This neither issues an observation nor grants settlement or a model send. */
interface HostUsageProjectionInput<D> {
  readonly descriptor: D;
  readonly stage: ModelLiveSequenceInputV3;
  readonly usage: NormalizedModelUsageV1;
  readonly predecessor: {
    readonly stage: ModelLiveSequenceInputV3;
    readonly attempt: ModelCommercialInvocationAttemptV1;
  } | null;
}
export function modelHostSeedUsageToCommercialAttemptV4(
  input: HostUsageProjectionInput<ModelLiveSeedInvocationDescriptorV3>,
): ModelCommercialInvocationAttemptV1 {
  return projectHostUsage(
    input,
    modelLiveSeedInvocationDescriptorV3Schema.parse(input.descriptor),
  );
}
/** Final repair stays on the already reserved workflow; this pure projection
 * neither authenticates the predecessor nor issues a usage/accounting record. */
export function modelHostRepairSuccessorUsageToCommercialAttemptV4(
  input: HostUsageProjectionInput<ModelLiveRepairSuccessorInvocationDescriptorV4>,
): ModelCommercialInvocationAttemptV1 {
  const descriptor = modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse(
    input.descriptor,
  );
  requireBinding(
    input.stage.stageKey === "repair-2" && input.predecessor !== null,
  );
  return projectHostUsage(input, descriptor);
}
function projectHostUsage(
  input: HostUsageProjectionInput<
    | ModelLiveSeedInvocationDescriptorV3
    | ModelLiveRepairSuccessorInvocationDescriptorV4
  >,
  descriptor:
    | ModelLiveSeedInvocationDescriptorV3
    | ModelLiveRepairSuccessorInvocationDescriptorV4,
): ModelCommercialInvocationAttemptV1 {
  const stage = modelLiveSequenceInputV3Schema.parse(input.stage);
  const usage = normalizedModelUsageV1Schema.parse(input.usage);
  const ordinal = stage.stageKey === "repair-1" ? 1 : 2;
  requireBinding(
    usage.attemptNumber === 1 &&
      usage.routing === undefined &&
      usage.providerRequestId !== undefined &&
      usage.cacheReadUnits === "0" &&
      usage.cacheWriteUnits === "0" &&
      usage.inputDigest === stage.operationInputDigest &&
      usage.invocationId === stage.invocationId &&
      Date.parse(usage.startedAt) >= Date.parse(stage.issuedAt) &&
      digestStructuredValue(usage.scope) ===
        digestStructuredValue(descriptor.scope),
  );
  for (const key of [
    "feature",
    "inputDigest",
    "invocationId",
    "idempotencyKeyDigest",
    "providerId",
    "modelId",
    "modelVersion",
    "inferenceProfileId",
    "promptTemplateId",
    "promptVersion",
  ] as const)
    requireBinding(usage[key] === descriptor[key]);
  let previousId: string | null = null;
  if (ordinal === 1) {
    requireBinding(input.predecessor === null);
  } else {
    requireBinding(
      input.predecessor !== null && stage.predecessor.kind === "stage",
    );
    const previousStage = modelLiveSequenceInputV3Schema.parse(
      input.predecessor.stage,
    );
    const previous = parseModelCommercialInvocationAttemptV1(
      input.predecessor.attempt,
    );
    for (const key of [
      "planDigest",
      "selectionId",
      "selectionDigest",
      "caseId",
      "caseDigest",
    ] as const)
      requireBinding(stage[key] === previousStage[key]);
    requireBinding(
      previousStage.stageKey === "repair-1" &&
        previousStage.stageId === stage.predecessor.stageId &&
        previous.invocationId === previousStage.invocationId &&
        previous.invocationId !== usage.invocationId &&
        previous.attemptKind === "repair" &&
        previous.attemptNumber === 1 &&
        previous.retryOfAttemptId === null &&
        previous.usage !== null &&
        previous.providerKey === usage.providerId &&
        previous.modelId === usage.modelId &&
        previous.modelVersion === usage.modelVersion &&
        previous.inferenceProfileId === (usage.inferenceProfileId ?? null) &&
        previous.routeId === descriptor.routing.routeId &&
        previous.providerRequestId !== usage.providerRequestId &&
        Date.parse(previous.completedAt) <= Date.parse(usage.startedAt),
    );
    previousId = previous.attemptId;
  }
  return parseModelCommercialInvocationAttemptV1({
    attemptId: usage.invocationId + ".attempt." + String(ordinal),
    attemptKind: "repair",
    attemptNumber: ordinal,
    callId: usage.invocationId + ".call." + String(ordinal),
    completedAt: usage.completedAt,
    failureCategory:
      usage.result === "succeeded" ? null : "model-gateway." + usage.result,
    inferenceProfileId: usage.inferenceProfileId ?? null,
    invocationId: usage.invocationId,
    latencyMilliseconds: usage.durationMilliseconds,
    mayHaveBeenProcessed: true,
    modelId: usage.modelId,
    modelVersion: usage.modelVersion,
    promptId: usage.promptTemplateId,
    promptVersion: usage.promptVersion,
    providerKey: usage.providerId,
    providerRequestId: usage.providerRequestId,
    retryOfAttemptId: previousId,
    routeId: descriptor.routing.routeId,
    startedAt: usage.startedAt,
    status: attemptStatus(usage.result),
    usage: commercialUnits(usage, "included-in-output"),
    usageRecordId: usage.usageRecordId,
  });
}
