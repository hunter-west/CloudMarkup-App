import type { ModelUsageUnitsV1 } from "@cloudmarkup/domain";
import type { NormalizedModelUsageV1 } from "@cloudmarkup/schemas";
import type { ModelCommercialInvocationAttemptV1 } from "./commercial-lifecycle.js";

function exactSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(
      "Normalized model usage exceeds commercial integer limits.",
    );
  return parsed;
}

/** Internal unit arithmetic; callers select the reviewed provider's billing
 * semantics. Thinking already included in output must never be billed twice. */
export function commercialUnits(
  usage: NormalizedModelUsageV1,
  thinking: "provider-specific" | "included-in-output" = "provider-specific",
): ModelUsageUnitsV1 {
  const inputUnits = exactSafeInteger(usage.inputUnits);
  const outputUnits = exactSafeInteger(usage.outputUnits);
  const cacheReadUnits = exactSafeInteger(usage.cacheReadUnits);
  const cacheWriteUnits = exactSafeInteger(usage.cacheWriteUnits);
  const thinkingUnits = exactSafeInteger(usage.thinkingUnits);
  const totalUnits =
    inputUnits + outputUnits + cacheReadUnits + cacheWriteUnits;
  if (
    !Number.isSafeInteger(totalUnits) ||
    (thinking === "included-in-output" && thinkingUnits > outputUnits)
  )
    throw new Error("Normalized model usage total exceeds commercial limits.");
  return {
    cacheReadUnits,
    cacheWriteUnits,
    inputUnits,
    outputUnits,
    totalUnits,
    providerSpecificUnits:
      thinking === "provider-specific" && thinkingUnits > 0
        ? [{ unitName: "thinking-units", units: thinkingUnits }]
        : [],
  };
}
export function attemptStatus(
  result: NormalizedModelUsageV1["result"],
): ModelCommercialInvocationAttemptV1["status"] {
  switch (result) {
    case "succeeded":
      return "succeeded";
    case "provider-error":
      return "provider-failure";
    case "canceled":
      return "cancelled";
    case "invalid-output":
      return "internal-failure";
  }
}
