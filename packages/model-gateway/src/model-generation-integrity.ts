import {
  ModelCommercialLifecycleError,
  parseModelCommercialInvocationResultV1,
  type ModelCommercialInvocationResultV1,
  type ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";

/** Generation metadata only. This makes no delivery, validation or financial claim. */
export type ModelGenerationMetadata = Omit<
  ModelCommercialInvocationResultV1,
  "usefulOutputDelivered" | "preDispatchNoUsageAttestation"
>;
export function parseSinglePrimaryGeneration(
  value: unknown,
  request: ModelCommercialOperationRequestV1,
  invalid: () => never = () => {
    throw new ModelCommercialLifecycleError(
      "policy-violation",
      "Memory-only generation evidence is unavailable or contradictory.",
    );
  },
): ModelGenerationMetadata {
  if (
    request.plannedCalls.length !== 1 ||
    request.plannedCalls[0]?.kind !== "primary" ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return invalid();
  const raw = value as Record<string, unknown>;
  const keys = [
    "attempts",
    "completedAt",
    "failureCategory",
    "resultId",
    "status",
  ];
  if (
    Object.keys(raw).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(raw, key))
  )
    return invalid();
  const parsed = parseModelCommercialInvocationResultV1(
    { ...raw, usefulOutputDelivered: raw["status"] === "completed" },
    request,
  );
  if (
    parsed.attempts.length !== 1 ||
    parsed.attempts[0]?.attemptKind !== "primary"
  )
    return invalid();
  return {
    attempts: parsed.attempts,
    completedAt: parsed.completedAt,
    failureCategory: parsed.failureCategory,
    resultId: parsed.resultId,
    status: parsed.status,
  };
}
