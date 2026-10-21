import {
  buildBedrockHostRepairSuccessorConverseRequestV4,
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  digestStructuredValue as digest,
  getModelHostSeedPatchResponseToolV2,
  measureModelHostRepairSuccessorRuntimeRequestV3,
  reviewedHostBoundedRepairPromptV4,
  serializedByteLength,
  type ModelProviderHostRepairSuccessorInvocationV4,
} from "@cloudmarkup/model-gateway";
import {
  modelHostRepairSuccessorRequestV3Schema,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceOutcomeV4Schema,
  modelRuntimeRequestedResourcesV1Schema,
} from "@cloudmarkup/schemas";
import {
  invocationSchema,
  modelLiveBedrockHostConfigurationV2Schema,
  ModelLiveRuntimeHostEvidenceError,
  prepareModelLiveSeedStageInputV3,
  requireConfiguredLiveInvocation,
  requireLiveHostEvidence as requireEvidence,
} from "./model-live-runtime-host-evidence-codec.js";
import { prepareProductionRepairSuccessorInput } from "../../production-model-live-repair-successor-input.js";
import { same } from "./model-runtime-invocation-codec.js";

const successorInvocationSchema = invocationSchema.extend({
  descriptor: modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  request: modelHostRepairSuccessorRequestV3Schema,
});

/** Pure final-stage preparation from actual retained predecessor bytes and
 * records. The private issuer must authenticate those records and current
 * authority before and after preparation. No parsing result authorizes a send,
 * a new reservation, native execution or financial completion. */
export function prepareModelLiveRepairSuccessorStageInputV4(input: {
  readonly first: Parameters<typeof prepareModelLiveSeedStageInputV3>[0];
  readonly predecessor: Parameters<
    typeof prepareProductionRepairSuccessorInput
  >[0];
  readonly invocation: ModelProviderHostRepairSuccessorInvocationV4;
}) {
  try {
    const first = prepareModelLiveSeedStageInputV3(input.first);
    const predecessor = structuredClone(input.predecessor);
    const derived = prepareProductionRepairSuccessorInput(predecessor);
    const priorInput = modelLiveSequenceInputV3Schema.parse(
      predecessor.first.stage,
    );
    const outcome = modelLiveSequenceOutcomeV4Schema.parse(
      predecessor.recorded.outcome,
    );
    const { inputBindingDigest, issuedAt, ...priorFields } = priorInput;
    const parsed = successorInvocationSchema.parse(input.invocation);
    const { descriptor, request } = parsed;
    const stage = first.selection.stages.find(
      (entry) =>
        entry.caseId === first.stage.caseId && entry.stageKey === "repair-2",
    );
    const binding = first.plan.definition.cases.find(
      (entry) => entry.caseId === first.stage.caseId,
    );
    const prompt = reviewedHostBoundedRepairPromptV4;
    const responseTool = getModelHostSeedPatchResponseToolV2();
    requireEvidence(
      stage !== undefined &&
        binding !== undefined &&
        same(predecessor.invocation, first.invocation) &&
        same(priorFields, first.fields) &&
        inputBindingDigest ===
          predecessor.recorded.receipt.inputBindingDigest &&
        Date.parse(issuedAt) <= Date.parse(outcome.observedAt) &&
        Date.parse(outcome.observedAt) <= Date.parse(input.first.observedAt) &&
        outcome.status === "validated" &&
        outcome.validation.status === "invalid" &&
        outcome.validation.repairable &&
        same(request, derived.request) &&
        same(descriptor.scope, first.scope) &&
        descriptor.invocationId === stage.invocationId &&
        descriptor.invocationId !== first.stage.invocationId &&
        descriptor.inputDigest === digest({ request, scope: first.scope }) &&
        descriptor.requestedMode === request.requestedMode &&
        descriptor.providerFamily ===
          first.invocation.descriptor.providerFamily &&
        descriptor.providerId === first.invocation.descriptor.providerId &&
        same(parsed.prompt, prompt) &&
        same(parsed.responseTool, responseTool) &&
        descriptor.promptDigest === prompt.digest &&
        descriptor.promptTemplateId === prompt.templateId &&
        descriptor.promptVersion === prompt.version,
    );
    const invocation: ModelProviderHostRepairSuccessorInvocationV4 = {
      ...parsed,
      prompt,
      responseTool,
    };
    const configuration = modelLiveBedrockHostConfigurationV2Schema.parse(
      input.first.configuration,
    );
    const configured =
      configuration.contractVersion === 1
        ? createBedrockRoutingConfigurationV1({
            configuration,
            asOf: input.first.observedAt,
          })
        : prepareBedrockLiveEvaluationConfigurationV2({
            configuration,
            asOf: input.first.observedAt,
          });
    const { route, capability } = requireConfiguredLiveInvocation({
      configured,
      plan: first.plan,
      binding,
      invocation,
      catalogDigests: [],
    });
    const promptBytes = serializedByteLength(
      buildBedrockHostRepairSuccessorConverseRequestV4(invocation, route),
    );
    requireEvidence(
      promptBytes > 0 && promptBytes <= capability.maximumInputBytes,
    );
    const invocationDigest = digest(invocation);
    return {
      authority: "unissued-stage-input" as const,
      predecessorObservedAt: outcome.observedAt,
      routingConfigurationDigest: first.routingConfigurationDigest,
      requested: modelRuntimeRequestedResourcesV1Schema.parse({
        ...measureModelHostRepairSuccessorRuntimeRequestV3(request).requested,
        promptBytes,
        outputBytes: invocation.maximumOutputBytes,
        outputTokens: invocation.maximumOutputTokens,
      }),
      plan: first.plan,
      selection: first.selection,
      stage,
      scope: first.scope,
      invocation,
      route,
      invocationDigest,
      routeDigest: digest(route),
      configurationDigest: first.configurationDigest,
      seedConfigurationDigest: first.seedConfigurationDigest,
      fields: {
        contractVersion: 3 as const,
        recordKind: "model-live-sequence-input" as const,
        selectionId: first.selection.selectionId,
        selectionDigest: first.selection.selectionDigest,
        planDigest: first.plan.planDigest,
        ...stage,
        recipeDigest: binding.recipeDigest,
        authorityTupleDigest: binding.authorityBinding.authorityTupleDigest,
        operationInputDigest: descriptor.inputDigest,
        preparedPayloadDigest: invocationDigest,
        diagnosticsDigest: digest(request.diagnostics),
        revisionDigest: first.fields.revisionDigest,
        ownershipDigest: first.fields.ownershipDigest,
        predecessor: {
          kind: "stage" as const,
          stageId: priorInput.stageId,
          outcomeDigest: outcome.outcomeDigest,
          outputDigest: outcome.outputDigest,
          candidateDigest: outcome.candidateDigest,
          validationReceiptDigest: outcome.validationReceiptDigest,
        },
      },
    };
  } catch {
    throw new ModelLiveRuntimeHostEvidenceError();
  }
}
