import { describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  modelGatewayOperationV1Schema,
} from "@cloudmarkup/schemas";
import {
  BEDROCK_MODEL_REGISTRATIONS_V1,
  BEDROCK_REGISTERED_MODEL_IDS_V1,
  getBedrockModelRegistrationV1,
  selectBedrockEvaluationModelV1,
  usesBedrockAdaptiveAutoToolChoiceV1,
  type RegisteredBedrockModelIdV1,
  type BedrockModelSelectionReasonV1,
} from "./bedrock-model-registry.js";

const sonnet = "anthropic.claude-sonnet-4-6",
  opus = "anthropic.claude-opus-4-6-v1";
function input(modelId: RegisteredBedrockModelIdV1 = sonnet) {
  const registration = getBedrockModelRegistrationV1(modelId);
  return {
    modelId,
    expectedRegistrationDigest: registration.registrationDigest,
    inferenceProfileId: registration.inferenceProfileId,
    routeClass: registration.routeClass,
    sourceRegion: registration.sourceRegion,
    transport: "converse",
    operation: "intent.extract",
    thinkingMode: "adaptive",
    structuredOutputStrategy: "schema-only-response-tool",
    maximumOutputTokens: registration.maximumOutputTokens,
  };
}
describe("reviewed Bedrock model implementation registrations", () => {
  it("pins the existing four canonical models and their exact GLOBAL profiles", () => {
    expect(BEDROCK_REGISTERED_MODEL_IDS_V1).toEqual([
      "anthropic.claude-sonnet-5",
      "anthropic.claude-opus-5",
      sonnet,
      opus,
    ]);
    expect(
      BEDROCK_MODEL_REGISTRATIONS_V1.map((entry) => entry.modelId),
    ).toEqual(BEDROCK_REGISTERED_MODEL_IDS_V1);
    expect(
      BEDROCK_MODEL_REGISTRATIONS_V1.map((entry) => entry.inferenceProfileId),
    ).toEqual([
      "global.anthropic.claude-sonnet-5",
      "global.anthropic.claude-opus-5",
      "global.anthropic.claude-sonnet-4-6",
      "global.anthropic.claude-opus-4-6-v1",
    ]);
    expect(
      BEDROCK_MODEL_REGISTRATIONS_V1.map((entry) => entry.registrationDigest),
    ).toEqual([
      "sha256:5ca6f54d123251ca483babfd428d866ba62f012e3d188e52f9c1246b03db6672",
      "sha256:d1e0e8cc1a72d1579f4b35aa01a9367ba1aa450204443891b6da2fb34332f079",
      "sha256:23ab87afa63e081d45dce6e1f6aaa15fc1f773cc0d9737ff6a114e58c2d7e115",
      "sha256:2720ac436e75c0114029eb08864482939002fb74013882fa9ddf2799005b4444",
    ]);
    expect(
      new Set(
        BEDROCK_MODEL_REGISTRATIONS_V1.map((entry) => entry.registrationDigest),
      ).size,
    ).toBe(4);
  });
  it.each(["anthropic.claude-sonnet-4-6"] as const)(
    "deeply freezes %s and binds complete metadata identity",
    (modelId) => {
      const record = getBedrockModelRegistrationV1(modelId);
      const { registrationDigest, ...body } = record;
      expect(registrationDigest).toBe(digestCanonicalValue(body));
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.pricingSnapshot)).toBe(true);
      expect(Object.isFrozen(record.offerDimensions)).toBe(true);
      expect(Object.isFrozen(record.implementedOperations)).toBe(true);
      expect(Object.isFrozen(record.transports)).toBe(true);
      expect(
        Reflect.set(
          record.pricingSnapshot,
          "validUntil",
          "2099-01-01T00:00:00.000Z",
        ),
      ).toBe(false);
      expect(Reflect.set(record, "maximumOutputTokens", 9_999_999)).toBe(false);
      expect(record.implementedOperations).toEqual(
        modelGatewayOperationV1Schema.options,
      );
      expect(record.fullInputWindowCeilingTokens).toBe(1_048_576);
    },
  );
  it("keeps registry lists immutable", () => {
    expect(Reflect.set(BEDROCK_REGISTERED_MODEL_IDS_V1, "0", "changed")).toBe(
      false,
    );
    expect(Reflect.set(BEDROCK_MODEL_REGISTRATIONS_V1, "0", {})).toBe(false);
  });
  it("preserves historical pricing windows, rates and model-specific output ceilings", () => {
    expect(
      BEDROCK_MODEL_REGISTRATIONS_V1.map((r) => ({
        model: r.modelId,
        output: r.maximumOutputTokens,
        from: r.pricingSnapshot.validFrom,
        until: r.pricingSnapshot.validUntil,
        rates: [
          r.pricingSnapshot.inputMicroUsdPerMillion,
          r.pricingSnapshot.outputMicroUsdPerMillion,
          r.pricingSnapshot.cacheReadMicroUsdPerMillion,
          r.pricingSnapshot.cacheWrite5mMicroUsdPerMillion,
          r.pricingSnapshot.cacheWrite1hMicroUsdPerMillion,
        ],
      })),
    ).toEqual([
      {
        model: "anthropic.claude-sonnet-5",
        output: 131_072,
        from: "2026-09-05T00:00:00.000Z",
        until: "2026-09-12T00:00:00.000Z",
        rates: [2_000_000, 10_000_000, 200_000, 2_500_000, 4_000_000],
      },
      {
        model: "anthropic.claude-opus-5",
        output: 131_072,
        from: "2026-09-05T00:00:00.000Z",
        until: "2026-09-12T00:00:00.000Z",
        rates: [5_000_000, 25_000_000, 500_000, 6_250_000, 10_000_000],
      },
      {
        model: sonnet,
        output: 64_000,
        from: "2026-09-09T00:00:00.000Z",
        until: "2026-09-16T00:00:00.000Z",
        rates: [3_000_000, 15_000_000, 300_000, 3_750_000, 6_000_000],
      },
      {
        model: opus,
        output: 128_000,
        from: "2026-09-09T00:00:00.000Z",
        until: "2026-09-16T00:00:00.000Z",
        rates: [5_000_000, 25_000_000, 500_000, 6_250_000, 10_000_000],
      },
    ]);
  });
  it.each([sonnet, opus] as const)(
    "selects %s configuration without activation or readiness authority",
    (modelId) => {
      for (const transport of ["converse", "converse-stream"]) {
        const result = selectBedrockEvaluationModelV1({
          ...input(modelId),
          transport,
        });
        expect(result).toEqual({
          status: "supported-configuration",
          registration: getBedrockModelRegistrationV1(modelId),
          accountReadiness: "unverified",
          normalActivation: false,
        });
      }
    },
  );
  it.each(["anthropic.claude-sonnet-5", "anthropic.claude-opus-5"] as const)(
    "denies %s test selection while its token-count path is unavailable",
    (modelId) => {
      expect(selectBedrockEvaluationModelV1(input(modelId))).toEqual({
        status: "unsupported",
        reason: "token-counting-unavailable",
      });
    },
  );
  const changes: readonly [
    Record<string, unknown>,
    BedrockModelSelectionReasonV1,
  ][] = [
    [{ extra: true }, "invalid-selection"],
    [{ modelId: "unknown" }, "unregistered-model"],
    [
      { expectedRegistrationDigest: digestCanonicalValue({ changed: true }) },
      "registration-changed",
    ],
    [
      { inferenceProfileId: "global.anthropic.claude-opus-4-6-v1" },
      "profile-mismatch",
    ],
    [{ routeClass: "deep" }, "route-class-mismatch"],
    [{ sourceRegion: "us-west-2" }, "source-region-unsupported"],
    [{ transport: "mantle" }, "transport-unsupported"],
    [{ operation: "execute.shell" }, "operation-unsupported"],
    [{ thinkingMode: "disabled" }, "thinking-unsupported"],
    [
      { structuredOutputStrategy: "native-structured-output" },
      "structured-output-unsupported",
    ],
    [{ maximumOutputTokens: 64_001 }, "output-limit-exceeded"],
    [{ maximumOutputTokens: -1 }, "invalid-selection"],
  ];
  it.each(changes)("rejects changed selection %j with %s", (change, reason) => {
    expect(selectBedrockEvaluationModelV1({ ...input(), ...change })).toEqual({
      status: "unsupported",
      reason,
    });
  });
  it.each([
    "__proto__",
    "constructor",
    "anthropic.claude-opus-4-6",
    "global." + sonnet,
  ])("never treats %s as a canonical model", (modelId) => {
    expect(getBedrockModelRegistrationV1(modelId)).toBeUndefined();
    expect(selectBedrockEvaluationModelV1({ ...input(), modelId })).toEqual({
      status: "unsupported",
      reason: "unregistered-model",
    });
  });
  it("preserves the transport-only compatibility alias without making it selectable", () => {
    expect(usesBedrockAdaptiveAutoToolChoiceV1(sonnet)).toBe(true);
    expect(usesBedrockAdaptiveAutoToolChoiceV1(opus)).toBe(true);
    expect(
      usesBedrockAdaptiveAutoToolChoiceV1("anthropic.claude-opus-4-6"),
    ).toBe(true);
    expect(usesBedrockAdaptiveAutoToolChoiceV1("anthropic.claude-opus-5")).toBe(
      false,
    );
    expect(usesBedrockAdaptiveAutoToolChoiceV1("unknown")).toBe(false);
  });
  it.each([
    null,
    { modelId: sonnet },
    { ...input(), providerCredentials: "not accepted" },
  ])(
    "rejects malformed or extra authority input %# without echoing it",
    (value) => {
      expect(selectBedrockEvaluationModelV1(value)).toEqual({
        status: "unsupported",
        reason: "invalid-selection",
      });
    },
  );
});
