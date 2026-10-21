import { describe, expect, it } from "vitest";

import {
  MODEL_COMMERCIAL_POLICY_VERSION,
  ModelCommercialPolicyError,
  aggregateModelUsageUnitsV1,
  calculateModelProviderCostV1,
  estimateModelCreditRangeV1,
  normalizeModelProviderCostToCreditsV1,
  selectCreditNormalizationPolicyVersionV1,
  selectModelProviderPricingVersionV1,
  validateCreditNormalizationPolicyHistoryV1,
  validateModelProviderPricingHistoryV1,
  type CreditNormalizationPolicyVersionV1,
  type ModelProviderPricingVersionV1,
  type ModelUsageUnitsV1,
} from "./model-commercial-policy.js";

const pricing: ModelProviderPricingVersionV1 = {
  cacheReadMicrosPerMillionUnits: 500_000,
  cacheWriteMicrosPerMillionUnits: 2_000_000,
  currencyCode: "USD",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: "2027-01-01T00:00:00.000Z",
  environment: "test",
  inferenceProfileId: "profile_standard",
  inputMicrosPerMillionUnits: 1_000_000,
  modelId: "model_standard",
  modelVersion: "model_standard_v1",
  outputMicrosPerMillionUnits: 1_000_000,
  pricingVersionId: "pricing_standard_2026",
  providerKey: "provider_test",
  providerSpecificUnitRates: [
    { microsPerMillionUnits: 3_000_000, unitName: "request-unit" },
  ],
  status: "enabled",
  version: MODEL_COMMERCIAL_POLICY_VERSION,
};

const policy: CreditNormalizationPolicyVersionV1 = {
  creditUnitMicros: 100,
  currencyCode: "USD",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: "2027-01-01T00:00:00.000Z",
  normalizationPolicyVersionId: "credit_policy_2026",
  operatingBufferBasisPoints: 1_000,
  status: "enabled",
  version: MODEL_COMMERCIAL_POLICY_VERSION,
};

const usage: ModelUsageUnitsV1 = {
  cacheReadUnits: 10,
  cacheWriteUnits: 2,
  inputUnits: 100,
  outputUnits: 20,
  providerSpecificUnits: [{ unitName: "request-unit", units: 1 }],
  totalUnits: 132,
};

function expectPolicyError(
  action: () => unknown,
  code: ModelCommercialPolicyError["code"],
): void {
  try {
    action();
    throw new Error("Expected model commercial policy error.");
  } catch (error) {
    expect(error).toBeInstanceOf(ModelCommercialPolicyError);
    expect((error as ModelCommercialPolicyError).code).toBe(code);
  }
}

describe("model provider pricing and credit normalization", () => {
  it("prices cache and provider-specific units with integer micros", () => {
    const providerCost = calculateModelProviderCostV1(pricing, usage);
    expect(providerCost.estimatedProviderCostMicros).toBe(132);

    const normalized = normalizeModelProviderCostToCreditsV1(
      providerCost,
      policy,
    );
    expect(normalized.operatingBufferMicros).toBe(14);
    expect(normalized.normalizedCostMicros).toBe(146);
    expect(normalized.cloudMarkupCreditUnits).toBe(2);
  });

  it("selects the historical versions effective at execution time", () => {
    const laterPricing: ModelProviderPricingVersionV1 = {
      ...pricing,
      effectiveFrom: "2027-01-01T00:00:00.000Z",
      effectiveUntil: null,
      pricingVersionId: "pricing_standard_2027",
    };
    const laterPolicy: CreditNormalizationPolicyVersionV1 = {
      ...policy,
      effectiveFrom: "2027-01-01T00:00:00.000Z",
      effectiveUntil: null,
      normalizationPolicyVersionId: "credit_policy_2027",
    };

    expect(
      selectModelProviderPricingVersionV1([pricing, laterPricing], {
        at: "2026-08-21T12:00:00.000Z",
        environment: "test",
        inferenceProfileId: "profile_standard",
        modelId: "model_standard",
        modelVersion: "model_standard_v1",
        providerKey: "provider_test",
      }).pricingVersionId,
    ).toBe(pricing.pricingVersionId);
    expect(
      selectCreditNormalizationPolicyVersionV1(
        [policy, laterPolicy],
        "2026-08-21T12:00:00.000Z",
        "USD",
      ).normalizationPolicyVersionId,
    ).toBe(policy.normalizationPolicyVersionId);
  });

  it("rejects overlapping immutable histories and disabled pricing", () => {
    expectPolicyError(() => {
      validateModelProviderPricingHistoryV1([
        pricing,
        { ...pricing, pricingVersionId: "pricing_overlap" },
      ]);
    }, "overlapping-effective-range");
    expectPolicyError(() => {
      validateCreditNormalizationPolicyHistoryV1([
        policy,
        {
          ...policy,
          normalizationPolicyVersionId: "credit_policy_overlap",
        },
      ]);
    }, "overlapping-effective-range");
    expectPolicyError(
      () =>
        selectModelProviderPricingVersionV1(
          [{ ...pricing, status: "disabled-pricing-unavailable" }],
          {
            at: "2026-08-21T12:00:00.000Z",
            environment: "test",
            inferenceProfileId: "profile_standard",
            modelId: "model_standard",
            modelVersion: "model_standard_v1",
            providerKey: "provider_test",
          },
        ),
      "pricing-unavailable",
    );
  });

  it("calculates a rounded-up estimate and aggregates multi-call units", () => {
    expect(
      estimateModelCreditRangeV1(
        pricing,
        policy,
        {
          cacheReadUnits: 0,
          cacheWriteUnits: 0,
          inputUnits: 10,
          outputUnits: 10,
          providerSpecificUnits: [{ unitName: "request-unit", units: 0 }],
          totalUnits: 20,
        },
        usage,
      ),
    ).toEqual({
      maximumCreditUnits: 2,
      minimumCreditUnits: 1,
      normalizationPolicyVersionId: policy.normalizationPolicyVersionId,
      pricingVersionId: pricing.pricingVersionId,
    });

    expect(aggregateModelUsageUnitsV1([usage, usage])).toEqual({
      cacheReadUnits: 20,
      cacheWriteUnits: 4,
      inputUnits: 200,
      outputUnits: 40,
      providerSpecificUnits: [{ unitName: "request-unit", units: 2 }],
      totalUnits: 264,
    });
  });
});
