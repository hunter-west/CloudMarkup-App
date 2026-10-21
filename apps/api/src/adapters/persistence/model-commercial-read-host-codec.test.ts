import { describe, expect, it } from "vitest";
import { digestStructuredValue, sha256Text } from "@cloudmarkup/model-gateway";
import type {
  CreditNormalizationPolicyVersionRecord,
  ModelProviderPricingVersionRecord,
} from "../../application/model-commercial-persistence.js";
import {
  modelReadNumber,
  parseModelCommercialReadSelectors,
  parseModelLiveCommercialReadSelectors,
  parseModelLiveSequenceCommercialReadSelectorsV3,
  projectModelReadNormalization,
  projectModelReadPrice,
} from "./model-commercial-read-host-codec.js";

const price: ModelProviderPricingVersionRecord = {
  pricingVersionId: "pricing.synthetic",
  providerKey: "cloudmarkup.amazon-bedrock",
  modelId: "model.synthetic",
  modelVersion: "1",
  inferenceProfileId: "global.synthetic",
  environment: "test",
  costCurrency: "USD",
  effectiveFrom: "2026-09-07T00:00:00+00:00",
  createdAt: "2026-09-07T00:00:00Z",
  status: "enabled",
  inputMicrosPerMillionUnits: "1200000",
  outputMicrosPerMillionUnits: "3000000",
  cacheReadMicrosPerMillionUnits: "120000",
  cacheWriteMicrosPerMillionUnits: "1500000",
  providerSpecificUnitRates: [
    { unitName: "thinking-units", microsPerMillionUnits: "1" },
  ],
};
const normalization: CreditNormalizationPolicyVersionRecord = {
  normalizationPolicyVersionId: "normalization.synthetic",
  costCurrency: "USD",
  effectiveFrom: "2026-09-07T00:00:00Z",
  createdAt: "2026-09-07T00:00:00Z",
  status: "enabled",
  creditUnitMicros: "10000",
  operatingBufferBasisPoints: "3000",
};
const selectors = () => ({
  contractVersion: 1,
  pricingVersionId: price.pricingVersionId,
  pricingVersionDigest: digestStructuredValue(projectModelReadPrice(price)),
  normalizationPolicyVersionId: normalization.normalizationPolicyVersionId,
  normalizationPolicyDigest: digestStructuredValue(
    projectModelReadNormalization(normalization),
  ),
  runtimePolicyId: "policy.synthetic",
  runtimePolicyVersion: "1.0.0",
  runtimePolicyDigest: sha256Text("synthetic policy"),
  routeId: "standard-design",
  routeDefinitionDigest: sha256Text("synthetic route"),
  modelConfigurationReference: "config.synthetic",
});

describe("closed canonical commercial read selectors and price projection", () => {
  it("keeps V3 internal repair selectors separate from both historical entry points", () => {
    const value = {
      ...selectors(),
      contractVersion: 3,
      executionClass: "live-evaluation",
      routeId: "internal-escalation",
    };
    expect(parseModelLiveSequenceCommercialReadSelectorsV3(value)).toEqual(
      value,
    );
    expect(() => parseModelCommercialReadSelectors(value)).toThrow();
    expect(() => parseModelLiveCommercialReadSelectors(value)).toThrow();
    expect(() =>
      parseModelLiveSequenceCommercialReadSelectorsV3(selectors()),
    ).toThrow();
    expect(() =>
      parseModelLiveSequenceCommercialReadSelectorsV3({
        ...value,
        routeId: "standard-design",
      }),
    ).toThrow();
    expect(() =>
      parseModelLiveSequenceCommercialReadSelectorsV3({
        ...value,
        availableCreditUnits: 100000,
      }),
    ).toThrow();
    let accessed = false;
    Object.defineProperty(value, "pricingVersionId", {
      enumerable: true,
      get: () => {
        accessed = true;
        return price.pricingVersionId;
      },
    });
    expect(() =>
      parseModelLiveSequenceCommercialReadSelectorsV3(value),
    ).toThrow();
    expect(accessed).toBe(false);
  });
  it("clones exact selector metadata without granting or supplying authority", () => {
    const value = selectors();
    const parsed = parseModelCommercialReadSelectors(value);
    expect(parsed).toEqual(value);
    expect(parsed).not.toBe(value);
  });
  it.each([
    "unknown",
    "symbol",
    "accessor",
    "hidden",
    "prototype",
    "version",
    "route",
  ])("rejects %s selector drift", (kind) => {
    const value = selectors();
    if (kind === "unknown")
      Object.assign(value, { availableCreditUnits: 100000 });
    if (kind === "symbol") Object.assign(value, { [Symbol("hidden")]: true });
    if (kind === "accessor")
      Object.defineProperty(value, "pricingVersionId", {
        enumerable: true,
        get: () => {
          throw new Error("Accessor must not execute.");
        },
      });
    if (kind === "hidden")
      Object.defineProperty(value, "hidden", { value: true });
    if (kind === "prototype") Object.setPrototypeOf(value, { grant: true });
    if (kind === "version") value.contractVersion = 2;
    if (kind === "route") value.routeId = "deep-design";
    expect(() => parseModelCommercialReadSelectors(value)).toThrow(
      "Current model commercial authority is unavailable.",
    );
  });
  it.each([
    "-1",
    "1.0",
    "1e3",
    "01",
    "9007199254740992",
    "",
    1,
    null,
    undefined,
  ])("rejects unsafe or noncanonical numeric input %s", (value) => {
    expect(() => modelReadNumber(value)).toThrow();
  });
  it("retains every canonical rate, nullable dimension, and exact normalized digest", () => {
    const projected = projectModelReadPrice(price);
    expect(projected).toEqual({
      version: 1,
      pricingVersionId: price.pricingVersionId,
      providerKey: price.providerKey,
      modelId: price.modelId,
      modelVersion: price.modelVersion,
      inferenceProfileId: price.inferenceProfileId,
      environment: "test",
      currencyCode: "USD",
      effectiveFrom: "2026-09-07T00:00:00.000Z",
      effectiveUntil: null,
      status: "enabled",
      inputMicrosPerMillionUnits: 1200000,
      outputMicrosPerMillionUnits: 3000000,
      cacheReadMicrosPerMillionUnits: 120000,
      cacheWriteMicrosPerMillionUnits: 1500000,
      providerSpecificUnitRates: [
        { unitName: "thinking-units", microsPerMillionUnits: 1 },
      ],
    });
    expect(digestStructuredValue(projected)).toBe(
      selectors().pricingVersionDigest,
    );
    expect(projectModelReadNormalization(normalization)).toEqual({
      version: 1,
      normalizationPolicyVersionId: normalization.normalizationPolicyVersionId,
      currencyCode: "USD",
      effectiveFrom: "2026-09-07T00:00:00.000Z",
      effectiveUntil: null,
      status: "enabled",
      creditUnitMicros: 10000,
      operatingBufferBasisPoints: 3000,
    });
  });
  it("preserves unavailable optional rates and rejects duplicate reviewed units", () => {
    const {
      inferenceProfileId,
      cacheReadMicrosPerMillionUnits,
      cacheWriteMicrosPerMillionUnits,
      ...without
    } = price;
    expect([
      inferenceProfileId,
      cacheReadMicrosPerMillionUnits,
      cacheWriteMicrosPerMillionUnits,
    ]).toHaveLength(3);
    expect(projectModelReadPrice(without)).toMatchObject({
      inferenceProfileId: null,
      cacheReadMicrosPerMillionUnits: null,
      cacheWriteMicrosPerMillionUnits: null,
    });
    expect(() =>
      projectModelReadPrice({
        ...price,
        providerSpecificUnitRates: [
          ...price.providerSpecificUnitRates,
          ...price.providerSpecificUnitRates,
        ],
      }),
    ).toThrow();
    expect(() =>
      projectModelReadNormalization({
        ...normalization,
        creditUnitMicros: "0",
      }),
    ).toThrow();
    expect(() =>
      projectModelReadPrice({
        ...price,
        effectiveUntil: "2026-09-06T00:00:00Z",
      }),
    ).toThrow();
  });
});

describe("explicit live commercial selectors retain the closed V1 parser", () => {
  const live = () => ({
    ...selectors(),
    contractVersion: 2,
    executionClass: "live-evaluation",
  });
  it.each(["standard-design", "deep-design"])(
    "accepts only exact V2 metadata for %s",
    (routeId) => {
      const value = { ...live(), routeId };
      expect(parseModelLiveCommercialReadSelectors(value)).toEqual(value);
      expect(parseModelLiveCommercialReadSelectors(value)).not.toBe(value);
      expect(() => parseModelCommercialReadSelectors(value)).toThrow();
    },
  );
  it.each([
    "unknown",
    "symbol",
    "accessor",
    "hidden",
    "prototype",
    "version",
    "execution",
    "route",
  ])("rejects live %s drift", (kind) => {
    const value = live();
    if (kind === "unknown")
      Object.assign(value, { availableCreditUnits: 100000 });
    if (kind === "symbol") Object.assign(value, { [Symbol("hidden")]: true });
    if (kind === "accessor")
      Object.defineProperty(value, "pricingVersionId", {
        enumerable: true,
        get: () => {
          throw Error("Accessor must never run.");
        },
      });
    if (kind === "hidden")
      Object.defineProperty(value, "hidden", { value: true });
    if (kind === "prototype") Object.setPrototypeOf(value, { grant: true });
    if (kind === "version") value.contractVersion = 1;
    if (kind === "execution") value.executionClass = "normal";
    if (kind === "route") value.routeId = "internal-escalation";
    expect(() => parseModelLiveCommercialReadSelectors(value)).toThrow(
      "Current model commercial authority is unavailable.",
    );
  });
  it("refuses normal V1 metadata in the explicit live parser", () => {
    expect(() => parseModelLiveCommercialReadSelectors(selectors())).toThrow();
  });
});
