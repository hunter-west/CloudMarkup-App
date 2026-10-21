import { describe, expect, it } from "vitest";

import type {
  AmazonBedrockCapabilityProfileV1,
  ModelCapabilityV1,
  ModelProviderCapabilityProfileV1,
} from "./ports.js";
import { reviewedModelPromptRegistry } from "./prompts/registry.js";
import {
  ModelRoutingError,
  modelRoutingConfigurationV1Schema,
  selectModelRouteV1,
  type ModelRoutingConfigurationV1,
} from "./routing.js";
import { sha256Text } from "./security.js";
import { modelTestContext } from "./test-helpers.js";

function capability(
  role:
    | "low-cost-extraction-help"
    | "standard-planning-generation"
    | "deep-architecture-custom-generation"
    | "repair-escalation"
    | "fallback",
  modelId: string,
  input?: {
    readonly costTier?: "low" | "standard" | "deep";
    readonly evaluationPassed?: boolean;
    readonly modes?: readonly ("guided" | "professional")[];
  },
): ModelCapabilityV1 {
  const capabilityDigest = sha256Text(`capability:${modelId}`);
  const capabilityRegistryDigest = sha256Text("capability-registry:test");
  return {
    acceptedEffortLevels: ["low", "medium", "high", "xhigh", "max"] as const,
    capabilityDigest,
    capabilityRegistryDigest,
    capabilityRegistryId: "cloudmarkup.model-capabilities.test",
    capabilityRegistryVersion: "1.0.0",
    capabilityVersion: "1.0.0",
    costTier: input?.costTier ?? "standard",
    dataResidencyBoundary: "cloudmarkup.residency.test.v1",
    evaluation: {
      evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
      evaluationPolicyVersion: "1.0.0",
      passed: input?.evaluationPassed ?? true,
      resultDigest: sha256Text(`evaluation:${modelId}`),
      resultVersion: "1.0.0",
      scoreBasisPoints: input?.evaluationPassed === false ? 4_000 : 9_000,
    },
    maximumInputBytes: 1_000_000,
    maximumAttempts: 2,
    maximumOutputBytes: 500_000,
    maximumOutputTokens: 32_768,
    contextLimitTokens: 128_000,
    modelConfigurationReference: `cloudmarkup.model-configuration.${modelId}`,
    modelFamily: "anthropic.claude-test",
    modelId,
    modelVersion: "2026-08-20",
    operations: ["summary.technical" as const],
    pricingVersionReference: "cloudmarkup.pricing.test.v1",
    promptCache: {
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
      supported: false,
    },
    roles: [role],
    streamingSupported: false,
    structuredOutput: "tool-schema" as const,
    supportedModes: input?.modes ?? ["guided", "professional"],
    timeoutMilliseconds: 120_000,
    usageFieldsExpected: [
      "input-units",
      "output-units",
      "cache-read-units",
      "cache-write-units",
      "thinking-units",
      "provider-request-id",
    ],
  };
}

const bedrockProfile: AmazonBedrockCapabilityProfileV1 = {
  capabilities: [
    capability("low-cost-extraction-help", "bedrock.extract", {
      costTier: "low",
    }),
    capability("standard-planning-generation", "bedrock.standard"),
    capability("deep-architecture-custom-generation", "bedrock.deep", {
      costTier: "deep",
    }),
    capability("repair-escalation", "bedrock.repair", { costTier: "deep" }),
    capability("fallback", "bedrock.fallback", { costTier: "low" }),
  ],
  enabled: true,
  profileVersion: "1.0.0",
  providerFamily: "amazon-bedrock",
  providerId: "cloudmarkup.bedrock",
};

const routing: ModelRoutingConfigurationV1 =
  modelRoutingConfigurationV1Schema.parse({
    allowFallback: true,
    configurationId: "cloudmarkup.model-routes.test",
    configurationVersion: "1.0.0",
    routes: bedrockProfile.capabilities.map((entry) => ({
      candidates: [
        {
          modelId: entry.modelId,
          priority: 1,
          providerId: bedrockProfile.providerId,
        },
      ],
      role: entry.roles[0] ?? "fallback",
    })),
  });

describe("ModelGateway routing and prompt registry", () => {
  it("registers seven reviewed prompt families with stable complete operation ownership", () => {
    const templates = reviewedModelPromptRegistry.list();
    expect(templates).toHaveLength(7);
    expect(templates.map((template) => template.reviewed)).toEqual(
      Array(7).fill(true),
    );
    expect(
      templates.every((template) =>
        /^sha256:[0-9a-f]{64}$/u.test(template.digest),
      ),
    ).toBe(true);
    const operations = templates.flatMap((template) => template.operations);
    expect(new Set(operations).size).toBe(15);
    for (const operation of operations) {
      expect(reviewedModelPromptRegistry.get(operation)).not.toBeNull();
    }
  });

  it.each([
    ["low", "low-cost-extraction-help", "bedrock.extract"],
    ["standard", "standard-planning-generation", "bedrock.standard"],
    ["deep", "deep-architecture-custom-generation", "bedrock.deep"],
    ["repair", "repair-escalation", "bedrock.repair"],
  ] as const)(
    "selects configured %s routing by trusted complexity, not a requested model",
    (complexity, expectedRole, expectedModel) => {
      const context = {
        ...modelTestContext(`invocation_route_${complexity}`, complexity),
        requestedModel: "browser.claimed-model",
      };
      const selected = selectModelRouteV1({
        configuration: routing,
        context,
        operation: "summary.technical",
        profiles: [bedrockProfile],
      });
      expect(selected.role).toBe(expectedRole);
      expect(selected.capability.modelId).toBe(expectedModel);
      expect(selected.profile.providerFamily).toBe("amazon-bedrock");
    },
  );

  it("filters by entitlement, budget, requested mode, capability, and evaluation", () => {
    const deepBudgetBase = modelTestContext("invocation_budget", "deep");
    const deepBudgetDenied = {
      ...deepBudgetBase,
      budget: {
        ...deepBudgetBase.budget,
        maximumCostTier: "standard" as const,
      },
      entitlement: {
        ...deepBudgetBase.entitlement,
        allowedRoles: ["deep-architecture-custom-generation" as const],
      },
    };
    expect(() =>
      selectModelRouteV1({
        configuration: routing,
        context: deepBudgetDenied,
        operation: "summary.technical",
        profiles: [bedrockProfile],
      }),
    ).toThrow(ModelRoutingError);

    const failedEvaluationProfile: ModelProviderCapabilityProfileV1 = {
      ...bedrockProfile,
      capabilities: [
        capability("standard-planning-generation", "bedrock.standard", {
          evaluationPassed: false,
          modes: ["guided"],
        }),
      ],
    };
    expect(() =>
      selectModelRouteV1({
        configuration: routing,
        context: modelTestContext("invocation_evaluation", "standard"),
        operation: "summary.technical",
        profiles: [failedEvaluationProfile],
      }),
    ).toThrow(ModelRoutingError);
  });

  it("uses optional fallback only when it remains entitled, budgeted, and evaluated", () => {
    const profile: ModelProviderCapabilityProfileV1 = {
      ...bedrockProfile,
      capabilities: [
        capability("fallback", "bedrock.fallback", { costTier: "low" }),
      ],
    };
    const fallbackBase = modelTestContext("invocation_fallback", "standard");
    const context = {
      ...fallbackBase,
      entitlement: {
        ...fallbackBase.entitlement,
        allowedRoles: [
          "standard-planning-generation" as const,
          "fallback" as const,
        ],
      },
    };
    expect(
      selectModelRouteV1({
        configuration: routing,
        context,
        operation: "summary.technical",
        profiles: [profile],
      }).role,
    ).toBe("fallback");
  });

  it("strictly rejects unknown, duplicate, and non-finite routing configuration", () => {
    expect(
      modelRoutingConfigurationV1Schema.safeParse({
        ...routing,
        browserModelOverride: "bedrock.deep",
      }).success,
    ).toBe(false);
    expect(
      modelRoutingConfigurationV1Schema.safeParse({
        ...routing,
        routes: [...routing.routes, routing.routes[0]],
      }).success,
    ).toBe(false);
    const firstRoute = routing.routes[0];
    if (firstRoute === undefined) throw new Error("Missing routing fixture.");
    expect(
      modelRoutingConfigurationV1Schema.safeParse({
        ...routing,
        routes: [
          {
            ...firstRoute,
            candidates: [firstRoute.candidates[0], firstRoute.candidates[0]],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      modelRoutingConfigurationV1Schema.safeParse({
        ...routing,
        routes: [
          {
            ...firstRoute,
            candidates: firstRoute.candidates.map((candidate) => ({
              ...candidate,
              priority: Number.NaN,
            })),
          },
        ],
      }).success,
    ).toBe(false);
  });
});
