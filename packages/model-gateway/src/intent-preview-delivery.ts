import { parseSinglePrimaryGeneration } from "./model-generation-integrity.js";
import {
  ModelCommercialLifecycleError,
  parseModelCommercialInvocationResultV1,
  type ModelCommercialInvocationResultV1,
  type ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";

export const INTENT_PREVIEW_DELIVERY_POLICY_VERSION =
  "intent-preview-delivery-v1";
export const INTENT_PREVIEW_ACKNOWLEDGEMENT_MILLISECONDS = 30_000;

/** Metadata about production of a result, deliberately not a delivery claim. */
export type IntentPreviewGenerationEvidenceV1 = Omit<
  ModelCommercialInvocationResultV1,
  "usefulOutputDelivered" | "preDispatchNoUsageAttestation"
>;

function invalid(): never {
  throw new ModelCommercialLifecycleError(
    "policy-violation",
    "Memory-only preview evidence is unavailable or contradictory.",
  );
}

export function parseIntentPreviewGenerationEvidenceV1(
  value: unknown,
  request: ModelCommercialOperationRequestV1,
): IntentPreviewGenerationEvidenceV1 {
  if (
    request.feature !== "intent.extract" ||
    request.requestedRoute !== "standard"
  )
    return invalid();
  return parseSinglePrimaryGeneration(value, request, invalid);
}

export function intentPreviewGenerationEvidenceV1(
  result: ModelCommercialInvocationResultV1,
  request: ModelCommercialOperationRequestV1,
): IntentPreviewGenerationEvidenceV1 {
  const parsed = parseModelCommercialInvocationResultV1(result, request);
  if (parsed.preDispatchNoUsageAttestation !== undefined) return invalid();
  return parseIntentPreviewGenerationEvidenceV1(
    {
      attempts: parsed.attempts,
      completedAt: parsed.completedAt,
      failureCategory: parsed.failureCategory,
      resultId: parsed.resultId,
      status: parsed.status,
    },
    request,
  );
}

/** Pure projection only. The host must authenticate the durable delivery state
 * before passing it here. Expiry never manufactures missing provider usage. */
export function intentPreviewCommercialOutcomeV1(input: {
  readonly generation: IntentPreviewGenerationEvidenceV1;
  readonly request: ModelCommercialOperationRequestV1;
  readonly delivery: "acknowledged" | "unconfirmed";
}): ModelCommercialInvocationResultV1 {
  const generated = parseIntentPreviewGenerationEvidenceV1(
    input.generation,
    input.request,
  );
  const delivery: unknown = Reflect.get(input, "delivery");
  if (delivery === "acknowledged") {
    if (
      generated.status !== "completed" ||
      generated.attempts.some(
        (attempt) => attempt.status !== "succeeded" || attempt.usage === null,
      )
    )
      return invalid();
    return { ...generated, usefulOutputDelivered: true };
  }
  if (delivery !== "unconfirmed") return invalid();
  return generated.status === "completed"
    ? {
        ...generated,
        failureCategory: "cloudmarkup.preview.delivery-unconfirmed",
        status: "internal-failure",
        usefulOutputDelivered: false,
      }
    : { ...generated, usefulOutputDelivered: false };
}
