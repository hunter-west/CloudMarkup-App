import { describe, expect, it } from "vitest";

import {
  BedrockEnvironmentConfigurationError,
  createBedrockRoutingConfigurationV1,
  parseBedrockEnvironmentConfigurationV1,
  reviewedBedrockConfigurationV1Schema,
  reviewedBedrockLiveEvaluationConfigurationV2Schema,
  prepareBedrockLiveEvaluationConfigurationV2,
} from "./bedrock-configuration.js";
import {
  bedrockModelCapabilityRegistryV1,
  selectModelRoutingDecisionV1,
} from "./bedrock-routing.js";
import { digestStructuredValue } from "./security.js";
import {
  modelRoutingConfigurationV1Schema,
  selectModelRouteV1,
} from "./routing.js";
import {
  modelTestContext,
  modelTestRequests,
  modelTestRoutingRequest,
} from "./test-helpers.js";

function candidateConfiguration() {
  const normal = configuration();
  return reviewedBedrockLiveEvaluationConfigurationV2Schema.parse({
    ...normal,
    contractVersion: 2,
    executionClass: "live-evaluation",
    recordKind: "bedrock-live-evaluation-configuration",
    routes: normal.routes.map((route) => {
      const modelId =
        route.route === "standard"
          ? "anthropic.claude-sonnet-4-6"
          : "anthropic.claude-opus-4-6-v1";
      return {
        ...route,
        capability: {
          ...route.capability,
          modelId,
          inferenceProfileId: "global." + modelId,
          lifecycleState: "candidate",
          nativeStructuredOutputSupported: false,
          maximumOutputTokens: 64000,
          evaluation: {
            ...route.capability.evaluation,
            passed: false,
            scoreBasisPoints: 0,
          },
        },
      };
    }),
  });
}
const asOf = "2026-08-21T12:00:00.000Z";
describe("explicit candidate Bedrock evaluation configuration", () => {
  it("prepares both reviewed 4.6 transports while preserving every unevaluated capability fact", () => {
    const input = candidateConfiguration(),
      before = structuredClone(input);
    const prepared = prepareBedrockLiveEvaluationConfigurationV2({
      asOf,
      configuration: input,
    });
    expect(prepared).toMatchObject({
      contractVersion: 2,
      executionClass: "live-evaluation",
    });
    expect(prepared.capabilityRegistry.capabilities).toEqual(
      input.routes.map((r) => r.capability),
    );
    expect(
      prepared.profile.capabilities.map((c) => c.evaluation.passed),
    ).toEqual([false, false]);
    expect(
      prepared.profile.capabilities.map((c) => c.evaluation.scoreBasisPoints),
    ).toEqual([0, 0]);
    expect(prepared.runtimeRoutes.map((r) => r.toolChoiceMode)).toEqual([
      "auto",
      "auto",
    ]);
    expect(prepared.runtimeRoutes.map((r) => r.invocationTarget)).toEqual([
      "global.anthropic.claude-sonnet-4-6",
      "global.anthropic.claude-opus-4-6-v1",
    ]);
    expect(input).toEqual(before);
  });
  it("cannot be parsed as normal environment activation, even after removing its version tags", () => {
    const candidate = candidateConfiguration();
    expect(() =>
      parseBedrockEnvironmentConfigurationV1({
        CLOUDMARKUP_MODEL_PROVIDER_MODE: "bedrock",
        CLOUDMARKUP_BEDROCK_ROUTE_CONFIGURATION_JSON: JSON.stringify(candidate),
      }),
    ).toThrow(BedrockEnvironmentConfigurationError);
    const {
      executionClass: ignoredClass,
      recordKind: ignoredKind,
      ...raw
    } = candidate;
    void ignoredClass;
    void ignoredKind;
    const downgraded = { ...raw, contractVersion: 1 as const };
    expect(() =>
      reviewedBedrockConfigurationV1Schema.parse(downgraded),
    ).toThrow();
    expect(() =>
      createBedrockRoutingConfigurationV1({ asOf, configuration: downgraded }),
    ).toThrow();
    expect(parseBedrockEnvironmentConfigurationV1({})).toEqual({
      mode: "fake",
    });
  });
  it("remains denied by both normal deterministic routing and the normal gateway selector", () => {
    const configuration = candidateConfiguration();
    const prepared = prepareBedrockLiveEvaluationConfigurationV2({
      asOf,
      configuration,
    });
    const context = modelTestContext("synthetic_candidate_config");
    const request = modelTestRequests().find(
      (r) => r.operation === "architecture.propose",
    );
    if (request === undefined) throw Error("Missing synthetic request.");
    const routingRequest = modelTestRoutingRequest(request, context, {
      environment: "development",
    });
    const routing = modelRoutingConfigurationV1Schema.parse({
      allowFallback: false,
      configurationId: "synthetic.candidate.routing",
      configurationVersion: "1.0.0",
      routes: prepared.capabilityRegistry.capabilities.flatMap((capability) =>
        capability.roles.map((role) => ({
          role,
          candidates: [
            {
              modelId: capability.modelId,
              inferenceProfileId: capability.inferenceProfileId,
              providerId: capability.providerId,
              priority: 0,
            },
          ],
        })),
      ),
    });
    const decision = selectModelRoutingDecisionV1({
      capabilityRegistry: prepared.capabilityRegistry,
      routeRegistry: prepared.routeRegistry,
      request: routingRequest,
      routingConfigurationDigest: digestStructuredValue(routing),
    });
    expect(decision.outcome).toBe("denied");
    expect(decision.reasonCodes).toContain("evaluation-failed");
    expect(() =>
      selectModelRouteV1({
        configuration: routing,
        context,
        operation: request.operation,
        profiles: [prepared.profile],
      }),
    ).toThrow("No entitled, budgeted, evaluated model route");
  });
  it.each(["candidate", "active"] as const)(
    "preserves an honest failed evaluation for %s review",
    (state) => {
      const configuration = candidateConfiguration();
      for (const route of configuration.routes) {
        route.capability.lifecycleState = state;
        route.capability.evaluation.scoreBasisPoints = 4300;
      }
      const prepared = prepareBedrockLiveEvaluationConfigurationV2({
        asOf,
        configuration,
      });
      expect(
        prepared.capabilityRegistry.capabilities.map((c) => ({
          state: c.lifecycleState,
          evaluation: c.evaluation,
        })),
      ).toEqual(
        configuration.routes.map((r) => ({
          state: r.capability.lifecycleState,
          evaluation: r.capability.evaluation,
        })),
      );
      expect(
        prepared.profile.capabilities.every((c) => !c.evaluation.passed),
      ).toBe(true);
    },
  );
  it.each([
    "deprecated",
    "disabled",
    "killed",
    "provider",
    "role",
    "region",
    "streaming",
    "duplicate",
    "extension",
  ] as const)(
    "rejects %s configuration instead of weakening the provider boundary",
    (kind) => {
      const configuration = candidateConfiguration(),
        route = configuration.routes[0];
      if (route === undefined) throw Error("Missing synthetic route.");
      if (kind === "deprecated") route.capability.lifecycleState = "deprecated";
      if (kind === "disabled") {
        route.capability.lifecycleState = "disabled";
        route.capability.killSwitch.engaged = true;
      }
      if (kind === "killed") route.capability.killSwitch.engaged = true;
      if (kind === "provider")
        Reflect.set(
          route.capability,
          "providerId",
          "synthetic.foreign-provider",
        );
      if (kind === "role") route.capability.roles = ["fallback"];
      if (kind === "region") route.selectedRegion = "eu-west-1";
      if (kind === "streaming") {
        route.transport = "converse-stream";
        route.capability.streamingSupported = false;
      }
      if (kind === "duplicate")
        configuration.routes = [route, structuredClone(route)];
      if (kind === "extension")
        Reflect.set(configuration, "operatorApproved", true);
      expect(() =>
        prepareBedrockLiveEvaluationConfigurationV2({ asOf, configuration }),
      ).toThrow();
    },
  );
  it.each(["2026-07-31T23:59:59.999Z", "2026-09-01T00:00:00.000Z", "invalid"])(
    "denies unavailable configuration time %s",
    (time) => {
      expect(() =>
        prepareBedrockLiveEvaluationConfigurationV2({
          asOf: time,
          configuration: candidateConfiguration(),
        }),
      ).toThrow(BedrockEnvironmentConfigurationError);
    },
  );
  it("denies mixed provider regions even when each route supports its selected region", () => {
    const configuration = candidateConfiguration(),
      deep = configuration.routes[1];
    if (deep === undefined) throw Error("Missing synthetic Deep route.");
    deep.selectedRegion = "us-west-2";
    expect(() =>
      prepareBedrockLiveEvaluationConfigurationV2({ asOf, configuration }),
    ).toThrow(BedrockEnvironmentConfigurationError);
  });
  it("detaches the prepared metadata from subsequent caller changes", () => {
    const configuration = candidateConfiguration();
    const prepared = prepareBedrockLiveEvaluationConfigurationV2({
      asOf,
      configuration,
    });
    const digest = digestStructuredValue(prepared);
    configuration.routes[0]?.supportedRegions.push("eu-west-1");
    const route = configuration.routes[0];
    if (route !== undefined) route.capability.evaluation.passed = true;
    expect(digestStructuredValue(prepared)).toBe(digest);
  });
});

function configuration() {
  const standard = bedrockModelCapabilityRegistryV1.capabilities[0];
  const deep = bedrockModelCapabilityRegistryV1.capabilities[1];
  if (standard === undefined || deep === undefined)
    throw new Error("missing capability fixtures");
  return reviewedBedrockConfigurationV1Schema.parse({
    capabilityRegistryVersion: "2.0.0",
    contractVersion: 1,
    routeRegistryVersion: "2.0.0",
    routes: [
      {
        approvedModelClass: "sonnet",
        capability: {
          ...standard,
          enabledEnvironments: ["development"],
          evaluation: {
            ...standard.evaluation,
            passed: true,
            scoreBasisPoints: 10_000,
          },
          inferenceProfileId: "configured.profile.standard",
          killSwitch: { engaged: false },
          lifecycleState: "active",
          modelConfigurationReference: "cloudmarkup.bedrock.standard.v1",
          modelFamily: "configured.model-family.standard",
          modelId: "configured.model.standard",
          modelVersion: "configured-standard-version",
          nativeStructuredOutputSupported: true,
          pricingVersionReference: "cloudmarkup.pricing.configured-standard.v1",
        },
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        effectiveUntil: "2026-09-01T00:00:00.000Z",
        retentionPolicy: "application-content-not-retained",
        route: "standard",
        selectedRegion: "us-east-1",
        supportedRegions: ["us-east-1", "us-west-2"],
        transport: "converse",
      },
      {
        approvedModelClass: "opus",
        capability: {
          ...deep,
          enabledEnvironments: ["development"],
          evaluation: {
            ...deep.evaluation,
            passed: true,
            scoreBasisPoints: 10_000,
          },
          inferenceProfileId: "configured.profile.deep",
          killSwitch: { engaged: false },
          lifecycleState: "active",
          modelConfigurationReference: "cloudmarkup.bedrock.deep.v1",
          modelFamily: "configured.model-family.deep",
          modelId: "configured.model.deep",
          modelVersion: "configured-deep-version",
          nativeStructuredOutputSupported: false,
          pricingVersionReference: "cloudmarkup.pricing.configured-deep.v1",
        },
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        effectiveUntil: "2026-09-01T00:00:00.000Z",
        retentionPolicy: "application-content-not-retained",
        route: "deep",
        selectedRegion: "us-east-1",
        supportedRegions: ["us-east-1", "us-west-2"],
        transport: "converse-stream",
      },
    ],
  });
}

describe("reviewed Bedrock environment configuration", () => {
  it("keeps the deterministic fake as the default and requires explicit live JSON", () => {
    expect(parseBedrockEnvironmentConfigurationV1({})).toEqual({
      mode: "fake",
    });
    expect(() =>
      parseBedrockEnvironmentConfigurationV1({
        CLOUDMARKUP_MODEL_PROVIDER_MODE: "bedrock",
      }),
    ).toThrow(BedrockEnvironmentConfigurationError);
    expect(() =>
      parseBedrockEnvironmentConfigurationV1({
        CLOUDMARKUP_BEDROCK_ROUTE_CONFIGURATION_JSON: "not-json",
        CLOUDMARKUP_MODEL_PROVIDER_MODE: "bedrock",
      }),
    ).toThrow(BedrockEnvironmentConfigurationError);
  });

  it("builds only configured Standard and Deep routes and exact invocation targets", () => {
    const reviewed = configuration();
    const parsed = parseBedrockEnvironmentConfigurationV1({
      CLOUDMARKUP_BEDROCK_ROUTE_CONFIGURATION_JSON: JSON.stringify(reviewed),
      CLOUDMARKUP_MODEL_PROVIDER_MODE: "bedrock",
    });
    if (parsed.reviewedConfiguration === undefined)
      throw new Error("missing reviewed config");
    const created = createBedrockRoutingConfigurationV1({
      asOf: "2026-08-21T12:00:00.000Z",
      configuration: parsed.reviewedConfiguration,
    });
    expect(
      created.runtimeRoutes.map((route) => route.invocationTarget),
    ).toEqual(["configured.profile.standard", "configured.profile.deep"]);
    expect(created.routeRegistry.routes.map((route) => route.routeId)).toEqual([
      "standard-design",
      "deep-design",
      "internal-escalation",
    ]);
    expect(created.profile.capabilities).toHaveLength(2);
    expect(
      created.runtimeRoutes.every(
        (route) => route.toolChoiceMode === undefined,
      ),
    ).toBe(true);
    expect(created.runtimeRoutes.map((route) => route.thinkingMode)).toEqual([
      "adaptive",
      "adaptive",
    ]);
  });

  it.each(["anthropic.claude-opus-4-6", "anthropic.claude-opus-4-6-v1"])(
    "uses reviewed adaptive auto tool transport with Opus %s",
    (opusModelId) => {
      const reviewed = configuration();
      for (const route of reviewed.routes) {
        route.capability.modelId =
          route.route === "standard"
            ? "anthropic.claude-sonnet-4-6"
            : opusModelId;
        route.capability.nativeStructuredOutputSupported = false;
      }
      const created = createBedrockRoutingConfigurationV1({
        asOf: "2026-08-21T12:00:00.000Z",
        configuration: reviewed,
      });
      expect(
        created.runtimeRoutes.map((route) => ({
          thinkingMode: route.thinkingMode,
          toolChoiceMode: route.toolChoiceMode,
        })),
      ).toEqual([
        { thinkingMode: "adaptive", toolChoiceMode: "auto" },
        { thinkingMode: "adaptive", toolChoiceMode: "auto" },
      ]);
    },
  );

  it("fails closed for expired records, Region mismatch, and an engaged kill switch", () => {
    const reviewed = configuration();
    expect(() =>
      createBedrockRoutingConfigurationV1({
        asOf: "2026-09-01T00:00:00.000Z",
        configuration: reviewed,
      }),
    ).toThrow(BedrockEnvironmentConfigurationError);
    expect(
      reviewedBedrockConfigurationV1Schema.safeParse({
        ...reviewed,
        routes: reviewed.routes.map((route, index) =>
          index === 0
            ? {
                ...route,
                capability: {
                  ...route.capability,
                  killSwitch: {
                    engaged: true,
                    reasonCode: "cloudmarkup.kill-switch.manual",
                  },
                },
              }
            : { ...route, selectedRegion: "us-west-2" },
        ),
      }).success,
    ).toBe(false);
  });
});
