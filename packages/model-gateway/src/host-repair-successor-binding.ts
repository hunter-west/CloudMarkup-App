import {
  modelHostRepairSuccessorRequestV3Schema,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  modelLiveSeedRoutingDecisionV3Schema,
} from "@cloudmarkup/schemas";
import type { ModelProviderHostRepairSuccessorInvocationV4 } from "./ports.js";
import { reviewedHostBoundedRepairPromptV4 } from "./prompts/host-bounded-repair.js";
import {
  digestStructuredValue,
  ModelGatewayValidationError,
} from "./security.js";
import { getModelHostSeedPatchResponseToolV2 } from "./tools.js";

/** Pure metadata validation, never current issuance or inference authority. */
export function parseHostRepairSuccessorInvocationV4(
  input: ModelProviderHostRepairSuccessorInvocationV4,
): ModelProviderHostRepairSuccessorInvocationV4 {
  try {
    const value = structuredClone(input);
    if (Object.hasOwn(value, "promptCacheKey")) throw Error("Cache key");
    const request = modelHostRepairSuccessorRequestV3Schema.parse(
      value.request,
    );
    const descriptor =
      modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse(
        value.descriptor,
      );
    const promptCachePolicy =
      modelLiveSeedRoutingDecisionV3Schema.shape.promptCachePolicy.parse(
        value.promptCachePolicy,
      );
    const prompt = reviewedHostBoundedRepairPromptV4;
    if (
      descriptor.invocationId === request.predecessor.invocationId ||
      descriptor.inputDigest !==
        digestStructuredValue({ request, scope: descriptor.scope }) ||
      descriptor.requestedMode !== request.requestedMode ||
      descriptor.promptDigest !== prompt.digest ||
      descriptor.promptTemplateId !== prompt.templateId ||
      descriptor.promptVersion !== prompt.version ||
      digestStructuredValue(value.prompt) !== digestStructuredValue(prompt) ||
      digestStructuredValue(value.responseTool) !==
        digestStructuredValue(getModelHostSeedPatchResponseToolV2())
    )
      throw Error("Binding");
    return { ...value, request, descriptor, promptCachePolicy };
  } catch {
    throw new ModelGatewayValidationError(
      "model-provider.repair-successor-binding-invalid",
      "The final repair requires its exact current candidate, descriptor, prompt and response channel.",
    );
  }
}
