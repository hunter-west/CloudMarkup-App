import { z } from "zod";

import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
} from "./architecture-document-v1.js";
import {
  modelGatewayOperationV1Schema,
  modelGatewayRoleV1Schema,
  modelRequestedModeV1Schema,
} from "./model-gateway-v1.js";
import {
  solutionRevisionIdSchema,
  solutionStableIdSchema,
} from "./solution-contract-common-v1.js";

const boundedIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u);
const nonnegativeCountSchema = z.number().int().nonnegative().max(10_000_000);
const positiveTokenLimitSchema = z.number().int().positive().max(10_000_000);

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

export const modelServiceLevelV1Schema = z.enum([
  "standard-design",
  "deep-design",
]);

export const modelRouteIdV1Schema = z.enum([
  "standard-design",
  "deep-design",
  "internal-escalation",
]);

export const modelEffortV1Schema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const modelPlanKeyV1Schema = z.enum(["starter", "pro"]);

export const modelCapabilityEnvironmentV1Schema = z.enum([
  "local",
  "test",
  "development",
  "staging",
  "production",
]);

export const modelUsageFieldV1Schema = z.enum([
  "input-units",
  "output-units",
  "cache-read-units",
  "cache-write-units",
  "thinking-units",
  "provider-request-id",
]);

export const modelCapabilityRecordV1Schema = z
  .object({
    acceptedEffortLevels: z.array(modelEffortV1Schema).min(1).max(5),
    adaptiveThinking: z
      .object({ required: z.boolean(), supported: z.boolean() })
      .strict(),
    capabilityVersion: semanticVersionSchema,
    contextLimitTokens: positiveTokenLimitSchema,
    costTier: z.enum(["low", "standard", "deep"]),
    enabledEnvironments: z.array(modelCapabilityEnvironmentV1Schema).max(5),
    enabledFeatureClasses: z
      .array(modelGatewayOperationV1Schema)
      .min(1)
      .max(64),
    enabledPlans: z.array(modelPlanKeyV1Schema).min(1).max(2),
    evaluation: z
      .object({
        evaluationPolicyId: namespacedIdentifierSchema,
        evaluationPolicyVersion: semanticVersionSchema,
        passed: z.boolean(),
        resultVersion: semanticVersionSchema,
        scoreBasisPoints: z.number().int().min(0).max(10_000),
      })
      .strict(),
    inferenceProfileId: boundedIdentifierSchema,
    inputModalities: z
      .array(z.enum(["text", "image"]))
      .min(1)
      .max(2),
    killSwitch: z
      .object({
        engaged: z.boolean(),
        reasonCode: namespacedIdentifierSchema.optional(),
      })
      .strict(),
    lifecycleState: z.enum(["candidate", "active", "deprecated", "disabled"]),
    maximumAttempts: z.number().int().min(1).max(2),
    maximumConcurrency: z.number().int().positive().max(10_000),
    maximumInputBytes: z
      .number()
      .int()
      .positive()
      .max(128 * 1_024 * 1_024),
    maximumOutputBytes: z
      .number()
      .int()
      .positive()
      .max(16 * 1_024 * 1_024),
    maximumOutputTokens: positiveTokenLimitSchema,
    modelConfigurationReference: namespacedIdentifierSchema,
    modelFamily: namespacedIdentifierSchema,
    modelId: boundedIdentifierSchema,
    modelVersion: z.string().trim().min(1).max(128),
    nativeStructuredOutputSupported: z.boolean(),
    outputModalities: z.array(z.literal("text")).length(1),
    pricingVersionReference: namespacedIdentifierSchema,
    promptCache: z
      .object({
        maximumCheckpoints: z.number().int().nonnegative().max(16),
        minimumCheckpointTokens: z.number().int().nonnegative(),
        supported: z.boolean(),
        supportedTtlSeconds: z
          .array(z.number().int().positive().max(86_400))
          .max(8),
      })
      .strict(),
    providerFamily: z.enum([
      "amazon-bedrock",
      "future-provider",
      "deterministic-fake",
    ]),
    providerId: namespacedIdentifierSchema,
    residency: z
      .object({
        geographyPolicy: namespacedIdentifierSchema,
        routeIdentifier: boundedIdentifierSchema,
      })
      .strict(),
    roles: z.array(modelGatewayRoleV1Schema).min(1).max(5),
    streamingSupported: z.boolean(),
    supportedModes: z
      .array(z.enum(["guided", "professional"]))
      .min(1)
      .max(2),
    timeoutMilliseconds: z
      .number()
      .int()
      .min(1_000)
      .max(15 * 60_000),
    toolUseSupported: z.boolean(),
    usageFieldsExpected: z.array(modelUsageFieldV1Schema).min(1).max(6),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [path, values] of [
      ["acceptedEffortLevels", value.acceptedEffortLevels],
      ["enabledEnvironments", value.enabledEnvironments],
      ["enabledFeatureClasses", value.enabledFeatureClasses],
      ["enabledPlans", value.enabledPlans],
      ["inputModalities", value.inputModalities],
      ["roles", value.roles],
      ["supportedModes", value.supportedModes],
      ["usageFieldsExpected", value.usageFieldsExpected],
    ] as const) {
      if (duplicateValues(values).length > 0) {
        context.addIssue({
          code: "custom",
          message: `${path} must not contain duplicates.`,
          path: [path],
        });
      }
    }
    if (value.maximumOutputTokens > value.contextLimitTokens) {
      context.addIssue({
        code: "custom",
        message: "Maximum output cannot exceed the context limit.",
        path: ["maximumOutputTokens"],
      });
    }
    if (value.adaptiveThinking.required && !value.adaptiveThinking.supported) {
      context.addIssue({
        code: "custom",
        message: "Required adaptive thinking must be supported.",
        path: ["adaptiveThinking"],
      });
    }
    if (
      value.promptCache.supported !==
      (value.promptCache.minimumCheckpointTokens > 0 &&
        value.promptCache.maximumCheckpoints > 0 &&
        value.promptCache.supportedTtlSeconds.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Prompt-cache support and its limits are contradictory.",
        path: ["promptCache"],
      });
    }
    if (!value.toolUseSupported && !value.nativeStructuredOutputSupported) {
      context.addIssue({
        code: "custom",
        message:
          "A machine-response capability requires tool use or native structured output.",
        path: ["toolUseSupported"],
      });
    }
    if (value.lifecycleState === "disabled" && !value.killSwitch.engaged) {
      context.addIssue({
        code: "custom",
        message: "A disabled model lifecycle requires an engaged kill switch.",
        path: ["killSwitch", "engaged"],
      });
    }
    if (
      value.killSwitch.engaged !==
      (value.killSwitch.reasonCode !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "An engaged kill switch requires exactly one safe reason code.",
        path: ["killSwitch"],
      });
    }
  });

export const modelCapabilityRegistryV1Schema = z
  .object({
    capabilities: z.array(modelCapabilityRecordV1Schema).min(1).max(256),
    contractVersion: z.literal(1),
    registryId: namespacedIdentifierSchema,
    registryVersion: semanticVersionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const references = value.capabilities.map(
      (capability) => capability.modelConfigurationReference,
    );
    if (duplicateValues(references).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Model configuration references must be unique.",
        path: ["capabilities"],
      });
    }
    const providerRoutes = value.capabilities.map(
      (capability) =>
        `${capability.providerId}\u0000${capability.modelId}\u0000${capability.inferenceProfileId}`,
    );
    if (duplicateValues(providerRoutes).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Provider, model, and inference routes must be unique.",
        path: ["capabilities"],
      });
    }
  });

export const modelRouteDefinitionV1Schema = z
  .object({
    allowedEffortLevels: z.array(modelEffortV1Schema).min(1).max(5),
    allowedRoles: z.array(modelGatewayRoleV1Schema).min(1).max(5),
    automaticEscalationRouteId: z.literal("internal-escalation").optional(),
    customerSelectablePlans: z.array(modelPlanKeyV1Schema).max(2),
    customerServiceLevel: modelServiceLevelV1Schema.optional(),
    customerVisible: z.boolean(),
    defaultEffort: modelEffortV1Schema,
    displayName: z.string().trim().min(1).max(64),
    enabled: z.boolean(),
    maximumAttempts: z.number().int().min(1).max(2),
    modelConfigurationReference: namespacedIdentifierSchema,
    promptCacheEnabled: z.boolean(),
    routeId: modelRouteIdV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedRoles: readonly z.output<typeof modelGatewayRoleV1Schema>[] =
      value.routeId === "standard-design"
        ? ["low-cost-extraction-help", "standard-planning-generation"]
        : value.routeId === "deep-design"
          ? ["deep-architecture-custom-generation"]
          : ["repair-escalation"];
    if (
      duplicateValues(value.allowedRoles).length > 0 ||
      value.allowedRoles.length !== expectedRoles.length ||
      expectedRoles.some((role) => !value.allowedRoles.includes(role))
    ) {
      context.addIssue({
        code: "custom",
        message: "The route identity requires its exact allowed role set.",
        path: ["allowedRoles"],
      });
    }
    if (!value.allowedEffortLevels.includes(value.defaultEffort)) {
      context.addIssue({
        code: "custom",
        message: "The default effort must be allowed by the route.",
        path: ["defaultEffort"],
      });
    }
    const expectedEfforts: readonly z.output<typeof modelEffortV1Schema>[] =
      value.routeId === "standard-design"
        ? ["medium", "high"]
        : ["high", "xhigh"];
    const expectedPlans: readonly z.output<typeof modelPlanKeyV1Schema>[] =
      value.routeId === "standard-design"
        ? ["starter", "pro"]
        : value.routeId === "deep-design"
          ? ["pro"]
          : [];
    const exactPolicyMismatch =
      value.allowedEffortLevels.length !== expectedEfforts.length ||
      expectedEfforts.some(
        (effort) => !value.allowedEffortLevels.includes(effort),
      ) ||
      value.customerSelectablePlans.length !== expectedPlans.length ||
      expectedPlans.some(
        (plan) => !value.customerSelectablePlans.includes(plan),
      ) ||
      value.defaultEffort !==
        (value.routeId === "standard-design" ? "medium" : "high") ||
      value.maximumAttempts !==
        (value.routeId === "internal-escalation" ? 1 : 2) ||
      value.automaticEscalationRouteId !==
        (value.routeId === "standard-design"
          ? "internal-escalation"
          : undefined);
    if (exactPolicyMismatch) {
      context.addIssue({
        code: "custom",
        message:
          "The route identity requires its exact effort, plan, attempt, default, and escalation policy.",
        path: ["routeId"],
      });
    }
    if (
      value.routeId === "internal-escalation" &&
      (value.customerVisible ||
        value.customerServiceLevel !== undefined ||
        value.customerSelectablePlans.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Internal escalation cannot be a customer product option.",
        path: ["routeId"],
      });
    }
    if (
      value.routeId !== "internal-escalation" &&
      (!value.customerVisible || value.customerServiceLevel === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Customer routes require one visible service level.",
        path: ["customerServiceLevel"],
      });
    }
    if (
      (value.routeId === "standard-design" &&
        value.customerServiceLevel !== "standard-design") ||
      (value.routeId === "deep-design" &&
        value.customerServiceLevel !== "deep-design")
    ) {
      context.addIssue({
        code: "custom",
        message: "The customer service level must match its route identity.",
        path: ["customerServiceLevel"],
      });
    }
  });

export const modelRouteRegistryV1Schema = z
  .object({
    capabilityRegistryId: namespacedIdentifierSchema,
    capabilityRegistryDigest: sha256DigestSchema,
    capabilityRegistryVersion: semanticVersionSchema,
    contractVersion: z.literal(1),
    routeRegistryId: namespacedIdentifierSchema,
    routeRegistryVersion: semanticVersionSchema,
    routes: z.array(modelRouteDefinitionV1Schema).length(3),
  })
  .strict()
  .superRefine((value, context) => {
    const routeIds = value.routes.map((route) => route.routeId);
    if (
      duplicateValues(routeIds).length > 0 ||
      modelRouteIdV1Schema.options.some(
        (routeId) => !routeIds.includes(routeId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "The route registry requires each exact v1 route once.",
        path: ["routes"],
      });
    }
  });

export const modelRoutingPreferenceV1Schema = z.enum([
  "automatic",
  "standard-design",
  "deep-design",
]);

export const modelValidationStateV1Schema = z.enum([
  "not-run",
  "passed",
  "failed-deterministic-validation",
  "failed-build",
  "failed-compiler",
  "failed-supported-coverage",
]);

export const modelExpectedOutputClassV1Schema = z.enum([
  "small-explanation",
  "structured-proposal",
  "repository-interpretation",
  "application-files",
  "iac-files",
  "repair",
]);

export const modelRoutingOperationClassV1Schema = z.enum([
  "extraction",
  "planning",
  "graph-operation",
  "repository-analysis",
  "explanation",
  "code-generation",
  "iac-generation",
  "repair",
]);

export const modelRoutingFeatureAuthorityV1 = {
  "intent.extract": {
    expectedOutputClass: "structured-proposal",
    operationClass: "extraction",
  },
  "requirements.blocking-questions": {
    expectedOutputClass: "structured-proposal",
    operationClass: "extraction",
  },
  "architecture.propose": {
    expectedOutputClass: "structured-proposal",
    operationClass: "planning",
  },
  "workload.propose": {
    expectedOutputClass: "structured-proposal",
    operationClass: "planning",
  },
  "external-resource.propose": {
    expectedOutputClass: "structured-proposal",
    operationClass: "planning",
  },
  "operations.propose": {
    expectedOutputClass: "structured-proposal",
    operationClass: "graph-operation",
  },
  "repository.interpret": {
    expectedOutputClass: "repository-interpretation",
    operationClass: "repository-analysis",
  },
  "issue.explain": {
    expectedOutputClass: "small-explanation",
    operationClass: "explanation",
  },
  "deterministic-fix.explain": {
    expectedOutputClass: "small-explanation",
    operationClass: "explanation",
  },
  "fix.propose": {
    expectedOutputClass: "application-files",
    operationClass: "code-generation",
  },
  "application-source.generate": {
    expectedOutputClass: "application-files",
    operationClass: "code-generation",
  },
  "iac-extension.generate": {
    expectedOutputClass: "iac-files",
    operationClass: "iac-generation",
  },
  "candidate.repair": {
    expectedOutputClass: "repair",
    operationClass: "repair",
  },
  "summary.plain-language": {
    expectedOutputClass: "small-explanation",
    operationClass: "explanation",
  },
  "summary.technical": {
    expectedOutputClass: "small-explanation",
    operationClass: "explanation",
  },
} as const satisfies Record<
  z.output<typeof modelGatewayOperationV1Schema>,
  {
    readonly expectedOutputClass: z.output<
      typeof modelExpectedOutputClassV1Schema
    >;
    readonly operationClass: z.output<
      typeof modelRoutingOperationClassV1Schema
    >;
  }
>;

export const modelRoutingRequestV1Schema = z
  .object({
    accountRegionComplexity: z.enum([
      "single-account-region",
      "multi-account",
      "multi-region",
      "multi-account-region",
    ]),
    creditAuthorization: z
      .object({
        acceptedEstimateMaximumCreditUnits: nonnegativeCountSchema.optional(),
        allowed: z.boolean(),
        availableCreditUnits: nonnegativeCountSchema,
        decisionId: solutionStableIdSchema,
        estimateAccepted: z.boolean(),
      })
      .strict(),
    currentValidationState: modelValidationStateV1Schema,
    customCodeRequirement: z.enum(["none", "supported", "custom"]),
    edgeCount: nonnegativeCountSchema,
    estimatedContextTokens: nonnegativeCountSchema,
    environment: modelCapabilityEnvironmentV1Schema,
    expectedOutputClass: modelExpectedOutputClassV1Schema,
    externalResourceCount: nonnegativeCountSchema,
    feature: modelGatewayOperationV1Schema,
    idempotencyKeyDigest: sha256DigestSchema,
    inputDigest: sha256DigestSchema,
    networkingComplexity: z.enum(["none", "basic", "complex", "hybrid"]),
    nodeCount: nonnegativeCountSchema,
    operationClass: modelRoutingOperationClassV1Schema,
    organizationId: solutionStableIdSchema,
    plan: z
      .object({
        entitlementDecisionId: solutionStableIdSchema,
        key: modelPlanKeyV1Schema,
        versionId: solutionStableIdSchema,
      })
      .strict(),
    principalId: solutionStableIdSchema,
    priorAttempt: z
      .object({
        diagnosticsDigest: sha256DigestSchema,
        escalationCount: z.number().int().min(0).max(1),
        originalAcceptedEstimateMaximumCreditUnits: nonnegativeCountSchema,
        originalCreditAuthorizationDecisionId: solutionStableIdSchema,
        originalInvocationId: solutionStableIdSchema,
        originalRoutingDecisionDigest: sha256DigestSchema,
        result: z.enum([
          "succeeded",
          "provider-failure",
          "validation-failure",
          "build-failure",
          "compiler-failure",
          "coverage-failure",
        ]),
        routeId: modelRouteIdV1Schema,
      })
      .strict()
      .optional(),
    projectId: solutionStableIdSchema,
    repositoryFileEstimate: nonnegativeCountSchema,
    repositoryTokenEstimate: nonnegativeCountSchema,
    requiredEvaluationPolicyId: namespacedIdentifierSchema,
    requiredEvaluationPolicyVersion: semanticVersionSchema,
    requestedMode: modelRequestedModeV1Schema,
    securityComplianceSensitivity: z.enum(["ordinary", "elevated", "high"]),
    selectedPreference: modelRoutingPreferenceV1Schema,
    serviceFamilyCount: nonnegativeCountSchema,
    scopeDigest: sha256DigestSchema,
    solutionRevisionId: solutionRevisionIdSchema.optional(),
    workloadCount: nonnegativeCountSchema,
    xhighEffortAuthorization: z
      .object({
        classification: z.enum([
          "difficult-repair",
          "approved-high-complexity-generation",
        ]),
        decisionId: solutionStableIdSchema,
        policyId: namespacedIdentifierSchema,
        policyVersion: semanticVersionSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const featureAuthority = modelRoutingFeatureAuthorityV1[value.feature];
    if (value.operationClass !== featureAuthority.operationClass) {
      context.addIssue({
        code: "custom",
        message:
          "The routing operation class must match the exact requested feature.",
        path: ["operationClass"],
      });
    }
    if (value.expectedOutputClass !== featureAuthority.expectedOutputClass) {
      context.addIssue({
        code: "custom",
        message:
          "The routing output class must match the exact requested feature.",
        path: ["expectedOutputClass"],
      });
    }
    if (
      value.creditAuthorization.estimateAccepted !==
      (value.creditAuthorization.acceptedEstimateMaximumCreditUnits !==
        undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Estimate acceptance requires the exact accepted high end.",
        path: ["creditAuthorization"],
      });
    }
    if (
      value.priorAttempt === undefined &&
      value.currentValidationState !== "not-run"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Every recorded validation state requires one exact prior attempt.",
        path: ["priorAttempt"],
      });
    }
    const exactPriorResultByState = {
      "failed-build": "build-failure",
      "failed-compiler": "compiler-failure",
      "failed-deterministic-validation": "validation-failure",
      "failed-supported-coverage": "coverage-failure",
      "not-run": "provider-failure",
      passed: "succeeded",
    } as const;
    if (
      value.priorAttempt !== undefined &&
      exactPriorResultByState[value.currentValidationState] !==
        value.priorAttempt.result
    ) {
      context.addIssue({
        code: "custom",
        message: "The validation state must map to the exact prior result.",
        path: ["priorAttempt", "result"],
      });
    }
    if (value.xhighEffortAuthorization !== undefined) {
      const difficultRepair =
        value.xhighEffortAuthorization.classification === "difficult-repair" &&
        value.operationClass === "repair" &&
        value.expectedOutputClass === "repair";
      const qualifyingGenerationComplexity =
        value.customCodeRequirement === "custom" ||
        value.securityComplianceSensitivity === "high" ||
        value.workloadCount >= 8 ||
        value.nodeCount >= 25 ||
        value.edgeCount >= 40 ||
        ["complex", "hybrid"].includes(value.networkingComplexity) ||
        value.accountRegionComplexity !== "single-account-region" ||
        value.repositoryTokenEstimate >= 120_000 ||
        value.repositoryFileEstimate >= 500;
      const approvedGeneration =
        value.xhighEffortAuthorization.classification ===
          "approved-high-complexity-generation" &&
        ["code-generation", "iac-generation"].includes(value.operationClass) &&
        ["application-files", "iac-files"].includes(
          value.expectedOutputClass,
        ) &&
        qualifyingGenerationComplexity;
      if (!difficultRepair && !approvedGeneration) {
        context.addIssue({
          code: "custom",
          message:
            "xhigh authorization must classify an exact difficult repair or qualifying high-complexity generation request.",
          path: ["xhighEffortAuthorization", "classification"],
        });
      }
    }
  });

export const modelRoutingReasonCodeV1Schema = z.enum([
  "user-selected-standard",
  "user-selected-deep",
  "standard-default",
  "complex-workloads",
  "complex-networking",
  "multi-account",
  "multi-region",
  "large-repository",
  "custom-code",
  "security-sensitive",
  "prior-validation-failure",
  "plan-denied",
  "credits-insufficient",
  "route-disabled",
  "evaluation-failed",
  "capability-mismatch",
  "context-limit-exceeded",
  "prior-attempt-not-eligible",
  "user-confirmation-required",
]);

const routingDecisionFields = z
  .object({
    automaticEscalationPermitted: z.boolean(),
    capabilityRegistryDigest: sha256DigestSchema,
    capabilityRegistryId: namespacedIdentifierSchema,
    capabilityRegistryVersion: semanticVersionSchema,
    contractVersion: z.literal(1),
    creditAuthorization: z
      .object({
        allowed: z.boolean(),
        decisionId: solutionStableIdSchema,
        estimateAccepted: z.boolean(),
      })
      .strict(),
    customerCharge: z
      .object({
        acceptedMaximumCreditUnits: nonnegativeCountSchema.optional(),
        incrementalEscalationCreditUnits: z.literal(0),
        policy: z.literal("accepted-estimate-cap"),
      })
      .strict(),
    effort: z.enum(["medium", "high", "xhigh"]),
    evaluationResultDigest: sha256DigestSchema,
    evaluationResultVersion: semanticVersionSchema,
    entitlement: z
      .object({
        allowed: z.boolean(),
        decisionId: solutionStableIdSchema,
        planKey: modelPlanKeyV1Schema,
        planVersionId: solutionStableIdSchema,
      })
      .strict(),
    estimateClass: z.enum(["small", "standard", "deep"]),
    evaluationPolicyId: namespacedIdentifierSchema,
    evaluationPolicyVersion: semanticVersionSchema,
    feature: modelGatewayOperationV1Schema,
    inferenceProfileId: boundedIdentifierSchema,
    maximumAttempts: z.number().int().min(1).max(2),
    maximumOutputTokens: positiveTokenLimitSchema,
    modelCapabilityVersion: semanticVersionSchema,
    modelCapabilityDigest: sha256DigestSchema,
    modelConfigurationReference: namespacedIdentifierSchema,
    modelFamily: boundedIdentifierSchema,
    modelId: boundedIdentifierSchema,
    modelVersion: z.string().trim().min(1).max(128),
    outcome: z.enum(["selected", "denied"]),
    pricingVersionReference: namespacedIdentifierSchema,
    promptCachePolicy: z
      .object({
        cacheKeyRequired: z.boolean(),
        enabled: z.boolean(),
        maximumCheckpoints: z.number().int().nonnegative().max(16),
        minimumCheckpointTokens: z.number().int().nonnegative(),
      })
      .strict(),
    providerId: namespacedIdentifierSchema,
    providerFamily: z.enum([
      "amazon-bedrock",
      "future-provider",
      "deterministic-fake",
    ]),
    reasonCodes: z.array(modelRoutingReasonCodeV1Schema).min(1).max(16),
    recommendedServiceLevel: modelServiceLevelV1Schema,
    requestedMode: modelRequestedModeV1Schema,
    routeId: modelRouteIdV1Schema,
    routeDefinitionDigest: sha256DigestSchema,
    routeRegistryId: namespacedIdentifierSchema,
    routeRegistryDigest: sha256DigestSchema,
    routeRegistryVersion: semanticVersionSchema,
    routingConfigurationDigest: sha256DigestSchema,
    requestBinding: z
      .object({
        idempotencyKeyDigest: sha256DigestSchema,
        inputDigest: sha256DigestSchema,
        routingRequestDigest: sha256DigestSchema,
        scopeDigest: sha256DigestSchema,
      })
      .strict(),
    timeoutMilliseconds: z
      .number()
      .int()
      .min(1_000)
      .max(15 * 60_000),
    userConfirmationRequired: z.boolean(),
    xhighEffortAuthorizationDecisionId: solutionStableIdSchema.optional(),
    escalation: z
      .object({
        diagnosticsDigest: sha256DigestSchema,
        originalAcceptedEstimateMaximumCreditUnits: nonnegativeCountSchema,
        originalCreditAuthorizationDecisionId: solutionStableIdSchema,
        originalInvocationId: solutionStableIdSchema,
        originalRoutingDecisionDigest: sha256DigestSchema,
        originalResult: z.enum([
          "validation-failure",
          "build-failure",
          "compiler-failure",
          "coverage-failure",
        ]),
        originalRouteId: z.literal("standard-design"),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Source-independent routing invariants; lineage is validated by its exact version. */
export function refineModelRoutingDecisionCommon(
  value: Pick<
    z.output<typeof routingDecisionFields>,
    | "reasonCodes"
    | "promptCachePolicy"
    | "outcome"
    | "entitlement"
    | "creditAuthorization"
    | "effort"
    | "xhighEffortAuthorizationDecisionId"
  >,
  context: z.RefinementCtx,
) {
  if (duplicateValues(value.reasonCodes).length > 0) {
    context.addIssue({
      code: "custom",
      message: "Routing reason codes must be unique.",
      path: ["reasonCodes"],
    });
  }
  if (
    value.promptCachePolicy.enabled !==
    (value.promptCachePolicy.cacheKeyRequired &&
      value.promptCachePolicy.maximumCheckpoints > 0 &&
      value.promptCachePolicy.minimumCheckpointTokens > 0)
  ) {
    context.addIssue({
      code: "custom",
      message: "The prompt-cache decision is contradictory.",
      path: ["promptCachePolicy"],
    });
  }
  if (
    value.outcome === "selected" &&
    (!value.entitlement.allowed || !value.creditAuthorization.allowed)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "A selected route requires entitlement and credit authorization.",
      path: ["outcome"],
    });
  }
  if (
    (value.effort === "xhigh") !==
    (value.xhighEffortAuthorizationDecisionId !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      message: "xhigh effort requires one exact trusted authorization.",
      path: ["xhighEffortAuthorizationDecisionId"],
    });
  }
}

export const modelRoutingDecisionV1Schema = routingDecisionFields.superRefine(
  (value, context) => {
    refineModelRoutingDecisionCommon(value, context);
    if (
      value.routeId === "internal-escalation" &&
      (value.maximumAttempts !== 1 ||
        value.automaticEscalationPermitted ||
        value.escalation === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Internal escalation must be single, terminal, and absorbed.",
        path: ["routeId"],
      });
    }
    if (
      value.routeId !== "internal-escalation" &&
      value.escalation !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Only internal escalation can bind original diagnostics.",
        path: ["escalation"],
      });
    }
  },
);

export const modelCacheKeyInputV1Schema = z
  .object({
    cacheScope: z.enum(["organization", "reviewed-shared-static"]),
    capabilityDigest: sha256DigestSchema,
    capabilityRegistryDigest: sha256DigestSchema,
    capabilityVersion: semanticVersionSchema,
    catalogScopeDigest: sha256DigestSchema,
    contentDigests: z.array(sha256DigestSchema).min(1).max(64),
    dataResidencyBoundary: namespacedIdentifierSchema,
    evaluationResultDigest: sha256DigestSchema,
    evaluationResultVersion: semanticVersionSchema,
    inferenceProfileId: boundedIdentifierSchema.optional(),
    inputDigest: sha256DigestSchema,
    modelId: boundedIdentifierSchema,
    modelVersion: z.string().trim().min(1).max(128),
    modelConfigurationReference: namespacedIdentifierSchema,
    organizationId: solutionStableIdSchema.optional(),
    organizationSafePolicyScope: namespacedIdentifierSchema,
    promptDigest: sha256DigestSchema,
    promptTemplateId: namespacedIdentifierSchema,
    promptTemplateVersion: semanticVersionSchema,
    providerId: namespacedIdentifierSchema,
    responseSchemaDigest: sha256DigestSchema,
    responseSchemaId: z.url().max(512),
    routeDefinitionDigest: sha256DigestSchema,
    routeRegistryDigest: sha256DigestSchema,
    routingConfigurationDigest: sha256DigestSchema,
    reviewedStaticContentPolicyId: namespacedIdentifierSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.cacheScope === "organization" &&
      (value.organizationId === undefined ||
        value.reviewedStaticContentPolicyId !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Organization cache keys require one tenant identity and cannot claim shared-static authority.",
        path: ["cacheScope"],
      });
    }
    if (
      value.cacheScope === "reviewed-shared-static" &&
      (value.organizationId !== undefined ||
        value.reviewedStaticContentPolicyId === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Shared cache keys require reviewed static-content authority and cannot contain tenant identity.",
        path: ["cacheScope"],
      });
    }
  });

export const modelRouteEstimateInputV1Schema = z
  .object({
    effort: modelEffortV1Schema,
    expectedAdaptiveThinkingOutputUnits: nonnegativeCountSchema,
    expectedCacheHitInputUnits: nonnegativeCountSchema,
    expectedCacheWriteInputUnits: nonnegativeCountSchema,
    expectedUncachedInputUnits: nonnegativeCountSchema,
    expectedVisibleOutputUnits: nonnegativeCountSchema,
    maximumAttempts: z.number().int().min(1).max(2),
    modelConfigurationReference: namespacedIdentifierSchema,
    operatingBufferBasisPoints: z.number().int().min(0).max(10_000),
    possibleEscalation: z.boolean(),
    pricingVersionReference: namespacedIdentifierSchema,
    routeId: modelRouteIdV1Schema,
  })
  .strict();

export const modelCreditEstimateRangeV1Schema = z
  .object({
    maximumCreditUnits: nonnegativeCountSchema,
    minimumCreditUnits: nonnegativeCountSchema,
    pricingVersionReference: namespacedIdentifierSchema,
  })
  .strict()
  .refine((value) => value.minimumCreditUnits <= value.maximumCreditUnits, {
    message: "The credit estimate range cannot be inverted.",
    path: ["maximumCreditUnits"],
  });

export const modelRoutingUiStateV1Schema = z
  .object({
    balanceCreditUnits: nonnegativeCountSchema,
    completed: z
      .object({
        cacheReadUnits: z.string().regex(/^(?:0|[1-9][0-9]{0,38})$/u),
        effort: modelEffortV1Schema,
        escalationUsed: z.boolean(),
        inputUnits: z.string().regex(/^(?:0|[1-9][0-9]{0,38})$/u),
        modelId: boundedIdentifierSchema,
        outputUnits: z.string().regex(/^(?:0|[1-9][0-9]{0,38})$/u),
        promptVersion: semanticVersionSchema,
        providerId: namespacedIdentifierSchema,
        routeId: modelRouteIdV1Schema,
        usedCreditUnits: nonnegativeCountSchema,
        validationState: modelValidationStateV1Schema,
      })
      .strict()
      .optional(),
    contractVersion: z.literal(1),
    estimate: modelCreditEstimateRangeV1Schema.optional(),
    expectedRelativeTime: z.enum(["shorter", "longer"]),
    options: z
      .array(
        z
          .object({
            available: z.boolean(),
            displayName: z.enum(["Standard Design", "Deep Design"]),
            serviceLevel: modelServiceLevelV1Schema,
            unavailableReason: modelRoutingReasonCodeV1Schema.optional(),
          })
          .strict(),
      )
      .length(2),
    reasonCode: modelRoutingReasonCodeV1Schema,
    recommendedServiceLevel: modelServiceLevelV1Schema,
    selectedServiceLevel: modelServiceLevelV1Schema,
  })
  .strict();

export type ModelCapabilityRecordV1 = z.output<
  typeof modelCapabilityRecordV1Schema
>;
export type ModelCapabilityRegistryV1 = z.output<
  typeof modelCapabilityRegistryV1Schema
>;
export type ModelRouteDefinitionV1 = z.output<
  typeof modelRouteDefinitionV1Schema
>;
export type ModelRouteRegistryV1 = z.output<typeof modelRouteRegistryV1Schema>;
export type ModelRoutingRequestV1 = z.output<
  typeof modelRoutingRequestV1Schema
>;
export type ModelRoutingDecisionV1 = z.output<
  typeof modelRoutingDecisionV1Schema
>;
export type ModelRoutingReasonCodeV1 = z.output<
  typeof modelRoutingReasonCodeV1Schema
>;
export type ModelRouteIdV1 = z.output<typeof modelRouteIdV1Schema>;
export type ModelEffortV1 = z.output<typeof modelEffortV1Schema>;
export type ModelServiceLevelV1 = z.output<typeof modelServiceLevelV1Schema>;
export type ModelCacheKeyInputV1 = z.output<typeof modelCacheKeyInputV1Schema>;
export type ModelRouteEstimateInputV1 = z.output<
  typeof modelRouteEstimateInputV1Schema
>;
export type ModelRoutingUiStateV1 = z.output<
  typeof modelRoutingUiStateV1Schema
>;
