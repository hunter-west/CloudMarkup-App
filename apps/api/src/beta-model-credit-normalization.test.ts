import {
  ModelCommercialPolicyError,
  calculateModelProviderCostV1,
  estimateModelCreditRangeV1,
  normalizeModelProviderCostToCreditsV1,
  selectCreditNormalizationPolicyVersionV1,
  validateCreditNormalizationPolicyHistoryV1,
  type ModelProviderCostV1,
  type ModelProviderPricingVersionV1,
  type ModelUsageUnitsV1,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";
import { betaModelCreditNormalizationPolicyV1 as policy } from "./beta-model-credit-normalization.js";

const emptyUsage: ModelUsageUnitsV1 = Object.freeze({
  cacheReadUnits: 0,
  cacheWriteUnits: 0,
  inputUnits: 0,
  outputUnits: 0,
  providerSpecificUnits: [],
  totalUnits: 0,
});
const cost = (estimatedProviderCostMicros: number): ModelProviderCostV1 => ({
  currencyCode: "USD",
  estimatedProviderCostMicros,
  pricingVersionId: "synthetic-pricing-v1",
  usage: emptyUsage,
});
function normalize(micros: number) {
  return normalizeModelProviderCostToCreditsV1(cost(micros), policy);
}

describe("owner-approved beta credit normalization", () => {
  it("pins one immutable policy after approval without an activation switch", () => {
    expect(policy).toEqual({
      creditUnitMicros: 10_000,
      currencyCode: "USD",
      effectiveFrom: "2026-09-07T12:23:22.000Z",
      effectiveUntil: null,
      normalizationPolicyVersionId:
        "cloudmarkup.credit-normalization.beta-usd-cent-markup30.2026-09-07.v1",
      operatingBufferBasisPoints: 3_000,
      status: "enabled",
      version: 1,
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() => {
      validateCreditNormalizationPolicyHistoryV1([policy]);
    }).not.toThrow();
    expect(
      selectCreditNormalizationPolicyVersionV1(
        [policy],
        policy.effectiveFrom,
        "USD",
      ),
    ).toEqual(policy);
    expect(() =>
      selectCreditNormalizationPolicyVersionV1(
        [policy],
        "2026-09-07T12:23:21.999Z",
        "USD",
      ),
    ).toThrow(ModelCommercialPolicyError);
  });

  it.each([
    [1, 1],
    [7_692, 1],
    [7_693, 2],
    [10_000, 2],
    [99_999, 13],
    [100_000, 13],
    [100_001, 14],
    [1_000_000, 130],
    [50_000_000, 6_500],
  ])("converts %i provider micro-USD into %i credits", (micros, credits) => {
    expect(normalize(micros).cloudMarkupCreditUnits).toBe(credits);
  });

  it("preserves zero and charges markup on provider cost, not margin or rounded base credits", () => {
    expect(normalize(0)).toEqual({
      ...cost(0),
      cloudMarkupCreditUnits: 0,
      normalizationPolicyVersionId: policy.normalizationPolicyVersionId,
      normalizedCostMicros: 0,
      operatingBufferMicros: 0,
    });
    expect(normalize(30_000)).toMatchObject({
      cloudMarkupCreditUnits: 4,
      estimatedProviderCostMicros: 30_000,
      normalizedCostMicros: 39_000,
      operatingBufferMicros: 9_000,
    });
    // Rounding USD 0.007 first to one credit and then adding markup would be two.
    expect(normalize(7_000).cloudMarkupCreditUnits).toBe(1);
  });

  it("matches the exact rational formula across deterministic safe-integer inputs", () => {
    const maximum = (BigInt(Number.MAX_SAFE_INTEGER) * 10n) / 13n;
    for (let index = 0n; index <= 2_048n; index += 1n) {
      const micros = (maximum * index) / 2_048n;
      const result = normalize(Number(micros));
      expect(BigInt(result.cloudMarkupCreditUnits)).toBe(
        (micros * 13n + 99_999n) / 100_000n,
      );
      expect(BigInt(result.operatingBufferMicros)).toBe(
        (micros * 3n + 9n) / 10n,
      );
      expect(BigInt(result.normalizedCostMicros)).toBe(
        (micros * 13n + 9n) / 10n,
      );
      expect(result.estimatedProviderCostMicros).toBe(Number(micros));
    }
  });

  it("uses exact wide intermediates but rejects an unsafe normalized monetary result", () => {
    const maximum = Number((BigInt(Number.MAX_SAFE_INTEGER) * 10n) / 13n);
    expect(maximum * 13).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(normalize(maximum).normalizedCostMicros)).toBe(
      true,
    );
    expect(() => normalize(maximum + 1)).toThrow(ModelCommercialPolicyError);
    expect(() => normalize(Number.MAX_SAFE_INTEGER)).toThrow(
      ModelCommercialPolicyError,
    );
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid provider cost %s without rounding or coercing it",
    (micros) => {
      expect(() => normalize(micros)).toThrow(ModelCommercialPolicyError);
    },
  );

  it("does not substitute a currency or bypass an unavailable policy", () => {
    expect(() =>
      normalizeModelProviderCostToCreditsV1(
        { ...cost(1), currencyCode: "EUR" },
        policy,
      ),
    ).toThrow(ModelCommercialPolicyError);
    expect(() =>
      normalizeModelProviderCostToCreditsV1(cost(1), {
        ...policy,
        status: "disabled",
      }),
    ).toThrow(ModelCommercialPolicyError);
  });

  it("preserves the complete synthetic provider-cost estimate separately from customer credits", () => {
    // Synthetic rates only: all input, output, cache and provider-specific units
    // remain in the provider ceiling before normalization. No live rate claim.
    const pricing: ModelProviderPricingVersionV1 = {
      cacheReadMicrosPerMillionUnits: 1_000_000,
      cacheWriteMicrosPerMillionUnits: 1_000_000,
      currencyCode: "USD",
      effectiveFrom: policy.effectiveFrom,
      effectiveUntil: null,
      environment: "test",
      inferenceProfileId: null,
      inputMicrosPerMillionUnits: 1_000_000,
      modelId: "synthetic-model",
      modelVersion: "synthetic-model-v1",
      outputMicrosPerMillionUnits: 1_000_000,
      pricingVersionId: "synthetic-pricing-v1",
      providerKey: "synthetic-provider",
      providerSpecificUnitRates: [
        { microsPerMillionUnits: 1_000_000, unitName: "request-unit" },
      ],
      status: "enabled",
      version: 1,
    };
    const usage: ModelUsageUnitsV1 = {
      cacheReadUnits: 100_000,
      cacheWriteUnits: 100_000,
      inputUnits: 200_000,
      outputUnits: 200_000,
      providerSpecificUnits: [{ unitName: "request-unit", units: 100_000 }],
      totalUnits: 600_000,
    };
    const providerCost = calculateModelProviderCostV1(pricing, usage);
    const before = structuredClone({ providerCost, usage, pricing });
    expect(providerCost.estimatedProviderCostMicros).toBe(700_000);
    expect(
      normalizeModelProviderCostToCreditsV1(providerCost, policy),
    ).toMatchObject({
      estimatedProviderCostMicros: 700_000,
      normalizedCostMicros: 910_000,
      operatingBufferMicros: 210_000,
      cloudMarkupCreditUnits: 91,
      pricingVersionId: pricing.pricingVersionId,
      usage,
    });
    expect(
      estimateModelCreditRangeV1(pricing, policy, emptyUsage, usage),
    ).toEqual({
      maximumCreditUnits: 91,
      minimumCreditUnits: 0,
      normalizationPolicyVersionId: policy.normalizationPolicyVersionId,
      pricingVersionId: pricing.pricingVersionId,
    });
    expect({ providerCost, usage, pricing }).toEqual(before);
  });
});
