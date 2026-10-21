import { describe, expect, it } from "vitest";
import {
  BETA_AI_PRICING,
  BETA_AI_PRICING_V1,
  betaAiPricingVersion,
  betaAiActualUsage,
  betaAiEstimate,
} from "./beta-ai-pricing.js";

describe("reviewed beta AI credit conversion", () => {
  it("pins Sonnet 4.6 Global Standard to one USD cent per credit without markup", () => {
    expect(BETA_AI_PRICING.pricingVersionId).toBe(
      "pricing_beta_sonnet46_global_20260930_v2",
    );
    expect(
      betaAiActualUsage({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadInputTokens: 0,
      }),
    ).toEqual({
      providerCostMicros: "18000000",
      creditUnits: "1800",
    });
  });
  it("rounds provider cost and customer credits upward exactly once", () => {
    expect(
      betaAiActualUsage({
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 0,
      }),
    ).toEqual({
      providerCostMicros: "10500",
      creditUnits: "2",
    });
    expect(
      betaAiActualUsage({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    ).toEqual({
      providerCostMicros: "0",
      creditUnits: "0",
    });
  });
  it("prices cache reads separately and bounds the temporary hold", () => {
    expect(
      betaAiActualUsage({
        inputTokens: 1000,
        outputTokens: 0,
        cacheReadInputTokens: 10_000,
      }),
    ).toEqual({
      providerCostMicros: "6000",
      creditUnits: "1",
    });
    expect(betaAiEstimate(64_000, 12_000)).toEqual({
      estimatedCreditUnits: "14",
      reservedCreditUnits: "100",
    });
  });
  it("rejects malformed usage and estimates before financial arithmetic", () => {
    expect(() =>
      betaAiActualUsage({
        inputTokens: -1,
        outputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    ).toThrow();
    expect(() => betaAiEstimate(Number.NaN, 4096)).toThrow();
  });
});

it("preserves historical policy and prices four dollars as 400 new credits", () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadInputTokens: 0,
  };
  expect(betaAiActualUsage(usage).creditUnits).toBe("300");
  expect(betaAiActualUsage(usage, BETA_AI_PRICING_V1).creditUnits).toBe("390");
  expect(
    betaAiActualUsage({
      inputTokens: 0,
      outputTokens: 266_666,
      cacheReadInputTokens: 0,
    }).creditUnits,
  ).toBe("400");
  expect(
    betaAiPricingVersion(
      BETA_AI_PRICING_V1.pricingVersionId,
      BETA_AI_PRICING_V1.chargingPolicyVersion,
    ),
  ).toBe(BETA_AI_PRICING_V1);
  expect(() =>
    betaAiPricingVersion("unknown", BETA_AI_PRICING.chargingPolicyVersion),
  ).toThrow();
});
