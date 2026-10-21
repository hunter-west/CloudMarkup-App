import { describe, expect, it, vi } from "vitest";
import {
  commercialChargingScenarioV1Schema,
  settlementChargingScenarioV1Schema,
} from "@cloudmarkup/api-contract";
import { modelProviderKeyPattern } from "./model-provider-key.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";

describe("model-only provider namespaces", () => {
  it.each([
    "a",
    "a-",
    "a".repeat(64),
    "cloudmarkup.amazon-bedrock",
    "vendor.model.family-v1",
  ])("retains canonical model key %s", (key) => {
    expect(modelProviderKeyPattern.test(key)).toBe(true);
  });
  it.each([
    "",
    ".vendor",
    "vendor.",
    "vendor..model",
    "vendor.-model",
    "vendor.2model",
    "Vendor.model",
    "vendor_model",
    "vendor/model",
    "a".repeat(65),
  ])("refuses ambiguous or unbounded model key %s", (key) => {
    expect(modelProviderKeyPattern.test(key)).toBe(false);
  });
  it("keeps the old public pricing and charging decoders closed", async () => {
    const query = vi.fn<() => void>();
    const transaction = vi.fn<() => void>();
    const repository = new PostgresCommercialPersistenceRepository({
      query: () => {
        query();
        return Promise.reject(new Error("Unexpected synthetic SQL."));
      },
      transaction: () => {
        transaction();
        return Promise.reject(new Error("Unexpected synthetic transaction."));
      },
      close: () => Promise.resolve(),
    });
    await expect(
      repository.createProviderPricingVersion(
        {
          authority: "internal-administration",
          actorId: "synthetic_admin",
          actorPrincipalId: "principal_test",
          organizationId: "org_test",
          correlationId: "correlation_test",
        },
        {
          pricingVersionId: "price_test",
          providerKey: "cloudmarkup.amazon-bedrock",
          modelId: "model_test",
          modelVersion: "version_test",
          costCurrency: "USD",
          creditConversionDenominator: "1",
          creditConversionNumerator: "1",
          inputMicrosPerMillionTokens: "1",
          outputMicrosPerMillionTokens: "1",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
        },
      ),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(
      commercialChargingScenarioV1Schema.safeParse("model-preview-delivered-v1")
        .success,
    ).toBe(false);
    expect(
      settlementChargingScenarioV1Schema.safeParse("model-preview-delivered-v1")
        .success,
    ).toBe(false);
    expect(
      settlementChargingScenarioV1Schema.safeParse("system-required-repair")
        .success,
    ).toBe(true);
  });
});
