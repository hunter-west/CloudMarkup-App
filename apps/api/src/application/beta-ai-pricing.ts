/** Reviewed Amazon Bedrock Global Standard offer, observed 2026-09-25.
 * Replace this version, rather than editing it, when the provider or model changes. */
export const BETA_AI_PRICING_V1 = Object.freeze({
  providerKey: "anthropic",
  modelId: "anthropic.claude-sonnet-4-6",
  modelVersion: "claude-sonnet-4-6",
  pricingVersionId: "pricing_beta_sonnet46_global_20260925_v1",
  chargingPolicyVersion: "beta-ai-cent-markup30-v1",
  inputMicrosPerMillionTokens: 3_000_000n,
  outputMicrosPerMillionTokens: 15_000_000n,
  cachedInputMicrosPerMillionTokens: 300_000n,
  creditConversionNumerator: 13n,
  creditConversionDenominator: 100_000n,
});

/** New usage follows the owner-approved one-cent provider-cost conversion.
 * Historical reservations retain the immutable v1 policy. */
export const BETA_AI_PRICING = Object.freeze({
  ...BETA_AI_PRICING_V1,
  pricingVersionId: "pricing_beta_sonnet46_global_20260930_v2",
  chargingPolicyVersion: "beta-ai-cent-v2",
  creditConversionNumerator: 1n,
  creditConversionDenominator: 10_000n,
});
export function betaAiPricingVersion(
  pricingVersionId: unknown,
  chargingPolicyVersion: unknown,
) {
  const pricing = [BETA_AI_PRICING_V1, BETA_AI_PRICING].find(
    (p) =>
      p.pricingVersionId === pricingVersionId &&
      p.chargingPolicyVersion === chargingPolicyVersion,
  );
  if (!pricing)
    throw new Error("The reserved AI pricing policy is unavailable.");
  return pricing;
}

const ceilDiv = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator - 1n) / denominator;

export function betaAiActualUsage(
  input: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadInputTokens: number;
  },
  pricing: typeof BETA_AI_PRICING | typeof BETA_AI_PRICING_V1 = BETA_AI_PRICING,
) {
  if (
    [input.inputTokens, input.outputTokens, input.cacheReadInputTokens].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  )
    throw new Error("The provider usage cannot be priced.");
  const providerCostMicros = ceilDiv(
    BigInt(input.inputTokens) * pricing.inputMicrosPerMillionTokens +
      BigInt(input.outputTokens) * pricing.outputMicrosPerMillionTokens +
      BigInt(input.cacheReadInputTokens) *
        pricing.cachedInputMicrosPerMillionTokens,
    1_000_000n,
  );
  return {
    providerCostMicros: providerCostMicros.toString(),
    creditUnits: (providerCostMicros === 0n
      ? 0n
      : ceilDiv(
          providerCostMicros * pricing.creditConversionNumerator,
          pricing.creditConversionDenominator,
        )
    ).toString(),
  };
}

/** Approximate estimate based on request bytes and half the output limit.
 * Callers include system instructions, catalog and tool schema. This is not a
 * token count or quote; 100 credits are held until exact provider usage settles. */
export function betaAiEstimate(inputBytes: number, maxOutputTokens: number) {
  if (
    !Number.isSafeInteger(inputBytes) ||
    inputBytes < 0 ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 1
  )
    throw new Error("The AI request estimate is invalid.");
  const estimatedInputTokens = Math.ceil(inputBytes / 4);
  const estimatedOutputTokens = Math.ceil(maxOutputTokens / 2);
  const estimated = betaAiActualUsage({
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
    cacheReadInputTokens: 0,
  });
  return {
    estimatedCreditUnits: estimated.creditUnits,
    reservedCreditUnits: "100",
  };
}
