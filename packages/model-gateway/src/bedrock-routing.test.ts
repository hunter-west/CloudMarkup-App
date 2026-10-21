import { describe, expect, it } from "vitest";

import {
  modelCacheKeyInputV1Schema,
  modelCapabilityRegistryV1Schema,
  modelRouteRegistryV1Schema,
  modelRoutingRequestV1Schema,
  sha256DigestSchema,
  type ModelCapabilityRegistryV1,
  type ModelRoutingRequestV1,
} from "@cloudmarkup/schemas";

import {
  ModelRoutingPolicyError,
  bedrockModelCapabilityRegistryV1,
  bedrockModelRouteRegistryV1,
  createModelRouteEstimateInputV1,
  modelCacheKeyDigestV1,
  selectModelRoutingDecisionV1 as selectTrustedModelRoutingDecisionV1,
  validateModelRoutingConfigurationV1,
} from "./bedrock-routing.js";
import { digestStructuredValue } from "./security.js";

const digestA = sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);

function selectModelRoutingDecisionV1(
  input: Omit<
    Parameters<typeof selectTrustedModelRoutingDecisionV1>[0],
    "routingConfigurationDigest"
  >,
) {
  const capabilityRegistry =
    input.capabilityRegistry ?? bedrockModelCapabilityRegistryV1;
  const routeRegistry =
    input.routeRegistry ??
    modelRouteRegistryV1Schema.parse({
      ...bedrockModelRouteRegistryV1,
      capabilityRegistryDigest: digestStructuredValue(capabilityRegistry),
    });
  return selectTrustedModelRoutingDecisionV1({
    ...input,
    capabilityRegistry,
    routeRegistry,
    routingConfigurationDigest: digestA,
  });
}

function evaluatedRegistry(): ModelCapabilityRegistryV1 {
  return modelCapabilityRegistryV1Schema.parse({
    ...bedrockModelCapabilityRegistryV1,
    capabilities: bedrockModelCapabilityRegistryV1.capabilities.map(
      (capability) => ({
        ...capability,
        evaluation: {
          ...capability.evaluation,
          passed: true,
          scoreBasisPoints: 9_500,
        },
        lifecycleState: "active",
      }),
    ),
  });
}

function routingRequest(input?: {
  readonly accepted?: boolean;
  readonly creditsAllowed?: boolean;
  readonly plan?: "starter" | "pro";
  readonly preference?: "automatic" | "standard-design" | "deep-design";
}): ModelRoutingRequestV1 {
  const accepted = input?.accepted ?? true;
  return modelRoutingRequestV1Schema.parse({
    accountRegionComplexity: "single-account-region",
    creditAuthorization: {
      ...(accepted ? { acceptedEstimateMaximumCreditUnits: 40 } : {}),
      allowed: input?.creditsAllowed ?? true,
      availableCreditUnits: 500,
      decisionId: "credit_decision_test",
      estimateAccepted: accepted,
    },
    currentValidationState: "not-run",
    customCodeRequirement: "none",
    edgeCount: 4,
    environment: "production",
    estimatedContextTokens: 20_000,
    expectedOutputClass: "structured-proposal",
    externalResourceCount: 0,
    feature: "architecture.propose",
    idempotencyKeyDigest: digestA,
    inputDigest: digestA,
    networkingComplexity: "basic",
    nodeCount: 5,
    operationClass: "planning",
    organizationId: "organization_test",
    plan: {
      entitlementDecisionId: "entitlement_decision_test",
      key: input?.plan ?? "starter",
      versionId: "plan_version_test",
    },
    principalId: "principal_test",
    projectId: "project_test",
    repositoryFileEstimate: 20,
    repositoryTokenEstimate: 5_000,
    requiredEvaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
    requiredEvaluationPolicyVersion: "1.0.0",
    requestedMode: "guided",
    securityComplianceSensitivity: "ordinary",
    selectedPreference: input?.preference ?? "automatic",
    serviceFamilyCount: 3,
    scopeDigest: digestA,
    workloadCount: 1,
  });
}

describe("Amazon Bedrock model routing v1", () => {
  it("keeps the exact production records as unevaluated candidates", () => {
    expect(
      bedrockModelCapabilityRegistryV1.capabilities.map((capability) => ({
        inferenceProfileId: capability.inferenceProfileId,
        modelId: capability.modelId,
        nativeStructuredOutputSupported:
          capability.nativeStructuredOutputSupported,
        passed: capability.evaluation.passed,
        state: capability.lifecycleState,
      })),
    ).toEqual([
      {
        inferenceProfileId: "configured.profile.standard.required",
        modelId: "configured.model.standard.required",
        nativeStructuredOutputSupported: false,
        passed: false,
        state: "candidate",
      },
      {
        inferenceProfileId: "configured.profile.deep.required",
        modelId: "configured.model.deep.required",
        nativeStructuredOutputSupported: false,
        passed: false,
        state: "candidate",
      },
    ]);
    const denied = selectModelRoutingDecisionV1({
      request: routingRequest(),
    });
    expect(denied.outcome).toBe("denied");
    expect(denied.reasonCodes).toContain("evaluation-failed");
  });

  it("selects Sonnet Standard for Starter and Opus Deep only for confirmed Pro", () => {
    const capabilities = evaluatedRegistry();
    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: capabilities,
        request: routingRequest(),
      }),
    ).toMatchObject({
      capabilityRegistryId: "cloudmarkup.model-capabilities.amazon-bedrock",
      effort: "high",
      evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
      modelFamily: "configured.model-family.standard",
      modelId: "configured.model.standard.required",
      outcome: "selected",
      routeId: "standard-design",
      routeRegistryId: "cloudmarkup.model-routes.amazon-bedrock",
    });

    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: capabilities,
        request: routingRequest({ plan: "pro", preference: "deep-design" }),
      }),
    ).toMatchObject({
      effort: "high",
      inferenceProfileId: "configured.profile.deep.required",
      modelId: "configured.model.deep.required",
      outcome: "selected",
      routeId: "deep-design",
      userConfirmationRequired: false,
    });
  });

  it("derives effort from route defaults and reserves xhigh for trusted difficult Deep policy", () => {
    const capabilities = evaluatedRegistry();
    const explanation = modelRoutingRequestV1Schema.parse({
      ...routingRequest(),
      expectedOutputClass: "small-explanation",
      feature: "issue.explain",
      operationClass: "explanation",
    });
    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: capabilities,
        request: explanation,
      }).effort,
    ).toBe("medium");

    const difficultDeep = modelRoutingRequestV1Schema.parse({
      ...routingRequest({ plan: "pro", preference: "deep-design" }),
      customCodeRequirement: "custom",
      expectedOutputClass: "application-files",
      feature: "application-source.generate",
      operationClass: "code-generation",
      xhighEffortAuthorization: {
        classification: "approved-high-complexity-generation",
        decisionId: "effort_decision_test",
        policyId: "cloudmarkup.model-effort.difficult.v1",
        policyVersion: "1.0.0",
      },
    });
    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: capabilities,
        request: difficultDeep,
      }).effort,
    ).toBe("xhigh");
    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: capabilities,
        request: {
          ...difficultDeep,
          xhighEffortAuthorization: undefined,
        },
      }).effort,
    ).toBe("high");
    expect(
      modelRoutingRequestV1Schema.safeParse({
        ...explanation,
        plan: {
          ...explanation.plan,
          key: "pro",
        },
        selectedPreference: "deep-design",
        xhighEffortAuthorization: {
          classification: "approved-high-complexity-generation",
          decisionId: "effort_decision_invalid",
          policyId: "cloudmarkup.model-effort.difficult.v1",
          policyVersion: "1.0.0",
        },
      }).success,
    ).toBe(false);
  });

  it("uses medium effort for bounded graph operations and high effort once graph complexity grows", () => {
    const capabilities = evaluatedRegistry();
    const smallGraphOperation = modelRoutingRequestV1Schema.parse({
      ...routingRequest(),
      edgeCount: 6,
      expectedOutputClass: "structured-proposal",
      feature: "operations.propose",
      nodeCount: 8,
      operationClass: "graph-operation",
      serviceFamilyCount: 3,
    });
    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: capabilities,
        request: smallGraphOperation,
      }).effort,
    ).toBe("medium");

    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: capabilities,
        request: modelRoutingRequestV1Schema.parse({
          ...smallGraphOperation,
          nodeCount: 11,
        }),
      }).effort,
    ).toBe("high");
  });

  it("enables prompt caching only at the capability checkpoint threshold", () => {
    const capabilities = evaluatedRegistry();
    const belowThreshold = modelRoutingRequestV1Schema.parse({
      ...routingRequest(),
      estimatedContextTokens: 4_095,
    });
    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: capabilities,
        request: belowThreshold,
      }).promptCachePolicy,
    ).toEqual({
      cacheKeyRequired: false,
      enabled: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    });

    const atThreshold = modelRoutingRequestV1Schema.parse({
      ...belowThreshold,
      estimatedContextTokens: 4_096,
    });
    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: capabilities,
        request: atThreshold,
      }).promptCachePolicy,
    ).toEqual({
      cacheKeyRequired: true,
      enabled: true,
      maximumCheckpoints: 4,
      minimumCheckpointTokens: 4_096,
    });
  });

  it("denies Starter Deep, unconfirmed Deep, and credit-denied work", () => {
    const capabilities = evaluatedRegistry();
    const starter = selectModelRoutingDecisionV1({
      capabilityRegistry: capabilities,
      request: routingRequest({ preference: "deep-design" }),
    });
    expect(starter.outcome).toBe("denied");
    expect(starter.reasonCodes).toContain("plan-denied");

    const unconfirmed = selectModelRoutingDecisionV1({
      capabilityRegistry: capabilities,
      request: routingRequest({
        accepted: false,
        plan: "pro",
        preference: "deep-design",
      }),
    });
    expect(unconfirmed.outcome).toBe("denied");
    expect(unconfirmed.reasonCodes).toContain("user-confirmation-required");

    const credits = selectModelRoutingDecisionV1({
      capabilityRegistry: capabilities,
      request: routingRequest({ creditsAllowed: false }),
    });
    expect(credits.outcome).toBe("denied");
    expect(credits.reasonCodes).toContain("credits-insufficient");
  });

  it("recommends rather than silently selecting Deep for complex automatic work", () => {
    const complex = modelRoutingRequestV1Schema.parse({
      ...routingRequest({ plan: "pro" }),
      accountRegionComplexity: "multi-account-region",
      customCodeRequirement: "custom",
      networkingComplexity: "hybrid",
      nodeCount: 30,
      repositoryTokenEstimate: 200_000,
      securityComplianceSensitivity: "high",
      workloadCount: 10,
    });
    const decision = selectModelRoutingDecisionV1({
      capabilityRegistry: evaluatedRegistry(),
      request: complex,
    });
    expect(decision.routeId).toBe("standard-design");
    expect(decision.recommendedServiceLevel).toBe("deep-design");
    expect(decision.reasonCodes).toEqual(
      expect.arrayContaining([
        "complex-workloads",
        "complex-networking",
        "multi-account",
        "multi-region",
        "large-repository",
        "custom-code",
        "security-sensitive",
      ]),
    );
  });

  it("allows exactly one absorbed Opus escalation after a deterministic Standard failure", () => {
    const failed = modelRoutingRequestV1Schema.parse({
      ...routingRequest(),
      currentValidationState: "failed-build",
      priorAttempt: {
        diagnosticsDigest: digestA,
        escalationCount: 0,
        originalAcceptedEstimateMaximumCreditUnits: 40,
        originalCreditAuthorizationDecisionId: "credit_decision_test",
        originalInvocationId: "invocation_standard_prior_test",
        originalRoutingDecisionDigest: digestA,
        result: "build-failure",
        routeId: "standard-design",
      },
    });
    const decision = selectModelRoutingDecisionV1({
      capabilityRegistry: evaluatedRegistry(),
      request: failed,
    });
    expect(decision).toMatchObject({
      automaticEscalationPermitted: false,
      customerCharge: { incrementalEscalationCreditUnits: 0 },
      escalation: {
        diagnosticsDigest: digestA,
        originalResult: "build-failure",
        originalRouteId: "standard-design",
      },
      maximumAttempts: 1,
      effort: "high",
      modelId: "configured.model.deep.required",
      outcome: "selected",
      routeId: "internal-escalation",
    });
    const explicitlyDifficultRepair = modelRoutingRequestV1Schema.parse({
      ...failed,
      expectedOutputClass: "repair",
      feature: "candidate.repair",
      operationClass: "repair",
      xhighEffortAuthorization: {
        classification: "difficult-repair",
        decisionId: "effort_decision_repair",
        policyId: "cloudmarkup.model-effort.difficult.v1",
        policyVersion: "1.0.0",
      },
    });
    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: evaluatedRegistry(),
        request: explicitlyDifficultRepair,
      }),
    ).toMatchObject({
      effort: "xhigh",
      outcome: "selected",
      routeId: "internal-escalation",
      xhighEffortAuthorizationDecisionId: "effort_decision_repair",
    });
    expect(
      modelRoutingRequestV1Schema.safeParse({
        ...failed,
        priorAttempt: {
          ...failed.priorAttempt,
          result: "validation-failure",
        },
      }).success,
    ).toBe(false);

    const exhausted = modelRoutingRequestV1Schema.parse({
      ...failed,
      priorAttempt: { ...failed.priorAttempt, escalationCount: 1 },
    });
    const exhaustedDecision = selectModelRoutingDecisionV1({
      capabilityRegistry: evaluatedRegistry(),
      request: exhausted,
    });
    expect(exhaustedDecision).toMatchObject({
      automaticEscalationPermitted: false,
      outcome: "denied",
      routeId: "standard-design",
    });
    expect(exhaustedDecision.reasonCodes).toContain(
      "prior-attempt-not-eligible",
    );

    const failedEscalation = modelRoutingRequestV1Schema.parse({
      ...routingRequest(),
      currentValidationState: "failed-build",
      priorAttempt: {
        diagnosticsDigest: digestA,
        escalationCount: 1,
        originalAcceptedEstimateMaximumCreditUnits: 40,
        originalCreditAuthorizationDecisionId: "credit_decision_test",
        originalInvocationId: "invocation_standard_prior_test",
        originalRoutingDecisionDigest: digestA,
        result: "build-failure",
        routeId: "internal-escalation",
      },
    });
    const failedEscalationDecision = selectModelRoutingDecisionV1({
      capabilityRegistry: evaluatedRegistry(),
      request: failedEscalation,
    });
    expect(failedEscalationDecision).toMatchObject({
      automaticEscalationPermitted: false,
      outcome: "denied",
    });
    expect(failedEscalationDecision.reasonCodes).toContain(
      "prior-attempt-not-eligible",
    );

    const unacceptedEstimate = modelRoutingRequestV1Schema.parse({
      ...failed,
      creditAuthorization: {
        allowed: true,
        availableCreditUnits: 500,
        decisionId: "credit_decision_unaccepted",
        estimateAccepted: false,
      },
    });
    const unacceptedDecision = selectModelRoutingDecisionV1({
      capabilityRegistry: evaluatedRegistry(),
      request: unacceptedEstimate,
    });
    expect(unacceptedDecision).toMatchObject({
      automaticEscalationPermitted: false,
      outcome: "denied",
      routeId: "standard-design",
    });
    expect(unacceptedDecision.reasonCodes).toContain(
      "prior-attempt-not-eligible",
    );

    const increasedCap = modelRoutingRequestV1Schema.parse({
      ...failed,
      creditAuthorization: {
        ...failed.creditAuthorization,
        acceptedEstimateMaximumCreditUnits: 41,
      },
    });
    const increasedCapDecision = selectModelRoutingDecisionV1({
      capabilityRegistry: evaluatedRegistry(),
      request: increasedCap,
    });
    expect(increasedCapDecision.outcome).toBe("denied");
    expect(increasedCapDecision.reasonCodes).toContain(
      "prior-attempt-not-eligible",
    );
  });

  it("denies a route whose estimated input plus bounded output exceeds context", () => {
    const request = modelRoutingRequestV1Schema.parse({
      ...routingRequest(),
      estimatedContextTokens: 980_000,
    });
    const decision = selectModelRoutingDecisionV1({
      capabilityRegistry: evaluatedRegistry(),
      request,
    });
    expect(decision.outcome).toBe("denied");
    expect(decision.reasonCodes).toContain("context-limit-exceeded");
  });

  it("fails closed for configuration drift, kill switches, environment mismatch, and unknown fields", () => {
    const drift = modelRouteRegistryV1Schema.parse({
      ...bedrockModelRouteRegistryV1,
      capabilityRegistryVersion: "2.0.0",
    });
    expect(() => {
      validateModelRoutingConfigurationV1({
        capabilityRegistry: evaluatedRegistry(),
        routeRegistry: drift,
      });
    }).toThrow(ModelRoutingPolicyError);

    const killed = modelCapabilityRegistryV1Schema.parse({
      ...evaluatedRegistry(),
      capabilities: evaluatedRegistry().capabilities.map((capability, index) =>
        index === 0
          ? {
              ...capability,
              killSwitch: {
                engaged: true,
                reasonCode: "cloudmarkup.model-route.disabled",
              },
            }
          : capability,
      ),
    });
    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: killed,
        request: routingRequest(),
      }).reasonCodes,
    ).toContain("route-disabled");

    const local = modelRoutingRequestV1Schema.parse({
      ...routingRequest(),
      environment: "local",
    });
    expect(
      selectModelRoutingDecisionV1({
        capabilityRegistry: evaluatedRegistry(),
        request: local,
      }).reasonCodes,
    ).toContain("capability-mismatch");
    expect(
      modelRoutingRequestV1Schema.safeParse({
        ...routingRequest(),
        browserClaimedModel: "configured.model.deep.required",
      }).success,
    ).toBe(false);

    const noToolUse = modelCapabilityRegistryV1Schema.parse({
      ...evaluatedRegistry(),
      capabilities: evaluatedRegistry().capabilities.map((capability, index) =>
        index === 0
          ? {
              ...capability,
              nativeStructuredOutputSupported: true,
              toolUseSupported: false,
            }
          : capability,
      ),
    });
    const noToolUseRoutes = modelRouteRegistryV1Schema.parse({
      ...bedrockModelRouteRegistryV1,
      capabilityRegistryDigest: digestStructuredValue(noToolUse),
    });
    expect(() => {
      validateModelRoutingConfigurationV1({
        capabilityRegistry: noToolUse,
        routeRegistry: noToolUseRoutes,
      });
    }).not.toThrow();
  });

  it("rejects every same-version mutation of the exact route policy", () => {
    const deep = bedrockModelRouteRegistryV1.routes.find(
      (route) => route.routeId === "deep-design",
    );
    const standard = bedrockModelRouteRegistryV1.routes.find(
      (route) => route.routeId === "standard-design",
    );
    const internal = bedrockModelRouteRegistryV1.routes.find(
      (route) => route.routeId === "internal-escalation",
    );
    if (deep === undefined || standard === undefined || internal === undefined)
      throw new Error("Missing exact route fixtures.");
    const mutations = [
      { ...deep, allowedEffortLevels: ["high", "xhigh", "max"] },
      { ...deep, customerSelectablePlans: ["starter", "pro"] },
      { ...deep, defaultEffort: "xhigh" },
      { ...standard, maximumAttempts: 1 },
      { ...standard, customerSelectablePlans: ["pro"] },
      { ...internal, maximumAttempts: 2 },
      { ...internal, customerSelectablePlans: ["pro"] },
    ];
    for (const mutation of mutations) {
      expect(
        modelRouteRegistryV1Schema.safeParse({
          ...bedrockModelRouteRegistryV1,
          routes: bedrockModelRouteRegistryV1.routes.map((route) =>
            route.routeId === mutation.routeId ? mutation : route,
          ),
        }).success,
      ).toBe(false);
    }
  });

  it("changes canonical decision provenance for same-version capability and evaluation drift", () => {
    const baselineRegistry = evaluatedRegistry();
    const baseline = selectModelRoutingDecisionV1({
      capabilityRegistry: baselineRegistry,
      request: routingRequest(),
    });
    const driftedRegistry = modelCapabilityRegistryV1Schema.parse({
      ...baselineRegistry,
      capabilities: baselineRegistry.capabilities.map((capability, index) =>
        index === 0
          ? {
              ...capability,
              evaluation: {
                ...capability.evaluation,
                resultVersion: "1.0.1",
                scoreBasisPoints: capability.evaluation.scoreBasisPoints - 1,
              },
              maximumOutputTokens: capability.maximumOutputTokens - 1,
            }
          : capability,
      ),
    });
    const drifted = selectModelRoutingDecisionV1({
      capabilityRegistry: driftedRegistry,
      request: routingRequest(),
    });
    expect(drifted.evaluationResultVersion).toBe("1.0.1");
    expect(drifted.evaluationResultDigest).not.toBe(
      baseline.evaluationResultDigest,
    );
    expect(drifted.modelCapabilityDigest).not.toBe(
      baseline.modelCapabilityDigest,
    );
    expect(drifted.capabilityRegistryDigest).not.toBe(
      baseline.capabilityRegistryDigest,
    );
  });

  it("never selects max effort and produces route-pinned estimate input", () => {
    const decisions = [
      routingRequest(),
      routingRequest({ plan: "pro", preference: "deep-design" }),
    ].map((request) =>
      selectModelRoutingDecisionV1({
        capabilityRegistry: evaluatedRegistry(),
        request,
      }),
    );
    expect(decisions.map((decision) => decision.effort)).not.toContain("max");
    const firstDecision = decisions.at(0);
    expect(firstDecision).toBeDefined();
    if (firstDecision === undefined)
      throw new Error("Missing routing decision.");
    expect(
      createModelRouteEstimateInputV1({
        decision: firstDecision,
        expectedAdaptiveThinkingOutputUnits: 1_000,
        expectedCacheHitInputUnits: 4_000,
        expectedCacheWriteInputUnits: 2_000,
        expectedUncachedInputUnits: 20_000,
        expectedVisibleOutputUnits: 8_000,
        operatingBufferBasisPoints: 1_000,
      }),
    ).toMatchObject({
      modelConfigurationReference: "cloudmarkup.bedrock.standard.v1",
      possibleEscalation: true,
      routeId: "standard-design",
    });
  });

  it("derives deterministic cache hashes that remain tenant and version scoped", () => {
    const base = modelCacheKeyInputV1Schema.parse({
      cacheScope: "organization",
      capabilityDigest: digestA,
      capabilityRegistryDigest: digestA,
      capabilityVersion: "1.0.0",
      catalogScopeDigest: digestA,
      contentDigests: [digestA],
      dataResidencyBoundary: "cloudmarkup.residency.us-geography.v1",
      evaluationResultDigest: digestA,
      evaluationResultVersion: "1.0.0",
      inferenceProfileId: "configured.profile.standard.required",
      inputDigest: digestA,
      modelConfigurationReference: "cloudmarkup.bedrock.standard.v1",
      modelId: "configured.model.standard.required",
      modelVersion: "configured-at-runtime",
      organizationId: "organization-a",
      organizationSafePolicyScope: "cloudmarkup.prompt-cache.organization.v1",
      promptDigest: digestA,
      promptTemplateId: "cloudmarkup.prompt.architecture-planning",
      promptTemplateVersion: "1.0.0",
      providerId: "cloudmarkup.amazon-bedrock",
      responseSchemaDigest: digestA,
      responseSchemaId:
        "https://schemas.cloudmarkup.com/model-response-tools/cloudmarkup_architecture_proposal_v1/v1.schema.json",
      routeDefinitionDigest: digestA,
      routeRegistryDigest: digestA,
      routingConfigurationDigest: digestA,
    });
    const first = modelCacheKeyDigestV1(base);
    expect(modelCacheKeyDigestV1(base)).toBe(first);
    expect(
      modelCacheKeyDigestV1(
        modelCacheKeyInputV1Schema.parse({
          ...base,
          organizationId: "organization-b",
        }),
      ),
    ).not.toBe(first);
    expect(
      modelCacheKeyInputV1Schema.safeParse({
        ...base,
        cacheScope: "reviewed-shared-static",
        organizationId: undefined,
      }).success,
    ).toBe(false);
    expect(
      modelCacheKeyDigestV1(
        modelCacheKeyInputV1Schema.parse({
          ...base,
          modelVersion: "5.1",
        }),
      ),
    ).not.toBe(first);
  });
});
