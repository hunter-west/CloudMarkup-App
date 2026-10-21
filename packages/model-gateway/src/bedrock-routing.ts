import {
  modelCacheKeyInputV1Schema,
  modelCapabilityRegistryV1Schema,
  modelGatewayOperationV1Schema,
  modelLiveEvaluationPlanV2Schema,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSeedRoutingDecisionV3Schema,
  type ModelLiveSequencePlanV3,
  type ModelLiveSequenceSelectionV3,
  type ModelLiveSequenceInputV3,
  type ModelLiveSeedRoutingDecisionV3,
  utcTimestampSchema,
  type ModelLiveEvaluationPlanV2,
  modelRouteEstimateInputV1Schema,
  modelRouteRegistryV1Schema,
  modelRoutingDecisionV1Schema,
  modelRoutingRequestV1Schema,
  type ModelCapabilityRecordV1,
  type ModelCapabilityRegistryV1,
  type ModelCacheKeyInputV1,
  type ModelEffortV1,
  type ModelRouteDefinitionV1,
  type ModelRouteEstimateInputV1,
  type ModelRouteIdV1,
  type ModelRouteRegistryV1,
  type ModelRoutingDecisionV1,
  type ModelRoutingReasonCodeV1,
  type ModelRoutingRequestV1,
  type ModelServiceLevelV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import { digestStructuredValue } from "./security.js";
import { inspectModelLiveSequenceV3 } from "./model-live-evaluation-sequence.js";
import {
  isModelPromptCacheEligibleV1,
  requiredModelEffortV1,
  requiredModelRoleForDecisionV1,
} from "./routing.js";
import type {
  ModelCapabilityV1,
  ModelRoutingDecisionEvaluatorV1,
} from "./ports.js";

const allOperations = modelGatewayOperationV1Schema.options;

// This disabled candidate registry is deterministic compatibility evidence for
// routing-policy tests. Runtime Bedrock capability records are built only from
// the reviewed environment configuration in bedrock-configuration.ts.
const bedrockCapabilityRecords = [
  {
    acceptedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    adaptiveThinking: { required: true, supported: true },
    capabilityVersion: "1.0.0",
    contextLimitTokens: 1_000_000,
    costTier: "standard",
    enabledEnvironments: ["staging", "production"],
    enabledFeatureClasses: allOperations,
    enabledPlans: ["starter", "pro"],
    evaluation: {
      evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
      evaluationPolicyVersion: "1.0.0",
      passed: false,
      resultVersion: "1.0.0",
      scoreBasisPoints: 0,
    },
    inferenceProfileId: "configured.profile.standard.required",
    inputModalities: ["text", "image"],
    killSwitch: { engaged: false },
    lifecycleState: "candidate",
    maximumAttempts: 2,
    maximumConcurrency: 8,
    maximumInputBytes: 32 * 1_024 * 1_024,
    maximumOutputBytes: 4 * 1_024 * 1_024,
    maximumOutputTokens: 131_072,
    modelConfigurationReference: "cloudmarkup.bedrock.standard.v1",
    modelFamily: "configured.model-family.standard",
    modelId: "configured.model.standard.required",
    modelVersion: "configured-at-runtime",
    nativeStructuredOutputSupported: false,
    outputModalities: ["text"],
    pricingVersionReference: "cloudmarkup.pricing.unavailable.standard",
    promptCache: {
      maximumCheckpoints: 4,
      minimumCheckpointTokens: 4_096,
      supported: true,
      supportedTtlSeconds: [300, 3_600],
    },
    providerFamily: "amazon-bedrock",
    providerId: "cloudmarkup.amazon-bedrock",
    residency: {
      geographyPolicy: "cloudmarkup.residency.us-geography.v1",
      routeIdentifier: "configured.profile.standard.required",
    },
    roles: ["low-cost-extraction-help", "standard-planning-generation"],
    streamingSupported: true,
    supportedModes: ["guided", "professional"],
    timeoutMilliseconds: 120_000,
    toolUseSupported: true,
    usageFieldsExpected: [
      "input-units",
      "output-units",
      "cache-read-units",
      "cache-write-units",
      "thinking-units",
      "provider-request-id",
    ],
  },
  {
    acceptedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    adaptiveThinking: { required: false, supported: true },
    capabilityVersion: "1.0.0",
    contextLimitTokens: 1_000_000,
    costTier: "deep",
    enabledEnvironments: ["staging", "production"],
    enabledFeatureClasses: allOperations,
    enabledPlans: ["starter", "pro"],
    evaluation: {
      evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
      evaluationPolicyVersion: "1.0.0",
      passed: false,
      resultVersion: "1.0.0",
      scoreBasisPoints: 0,
    },
    inferenceProfileId: "configured.profile.deep.required",
    inputModalities: ["text", "image"],
    killSwitch: { engaged: false },
    lifecycleState: "candidate",
    maximumAttempts: 2,
    maximumConcurrency: 4,
    maximumInputBytes: 32 * 1_024 * 1_024,
    maximumOutputBytes: 4 * 1_024 * 1_024,
    maximumOutputTokens: 131_072,
    modelConfigurationReference: "cloudmarkup.bedrock.deep.v1",
    modelFamily: "configured.model-family.deep",
    modelId: "configured.model.deep.required",
    modelVersion: "configured-at-runtime",
    nativeStructuredOutputSupported: false,
    outputModalities: ["text"],
    pricingVersionReference: "cloudmarkup.pricing.unavailable.deep",
    promptCache: {
      maximumCheckpoints: 4,
      minimumCheckpointTokens: 512,
      supported: true,
      supportedTtlSeconds: [300, 3_600],
    },
    providerFamily: "amazon-bedrock",
    providerId: "cloudmarkup.amazon-bedrock",
    residency: {
      geographyPolicy: "cloudmarkup.residency.us-geography.v1",
      routeIdentifier: "configured.profile.deep.required",
    },
    roles: ["deep-architecture-custom-generation", "repair-escalation"],
    streamingSupported: true,
    supportedModes: ["guided", "professional"],
    timeoutMilliseconds: 300_000,
    toolUseSupported: true,
    usageFieldsExpected: [
      "input-units",
      "output-units",
      "cache-read-units",
      "cache-write-units",
      "thinking-units",
      "provider-request-id",
    ],
  },
];

export const bedrockModelCapabilityRegistryV1 =
  modelCapabilityRegistryV1Schema.parse({
    capabilities: bedrockCapabilityRecords,
    contractVersion: 1,
    registryId: "cloudmarkup.model-capabilities.amazon-bedrock",
    registryVersion: "1.0.0",
  });

export const bedrockModelRouteRegistryV1 = modelRouteRegistryV1Schema.parse({
  capabilityRegistryDigest: digestStructuredValue(
    bedrockModelCapabilityRegistryV1,
  ),
  capabilityRegistryId: bedrockModelCapabilityRegistryV1.registryId,
  capabilityRegistryVersion: bedrockModelCapabilityRegistryV1.registryVersion,
  contractVersion: 1,
  routeRegistryId: "cloudmarkup.model-routes.amazon-bedrock",
  routeRegistryVersion: "1.0.0",
  routes: [
    {
      allowedEffortLevels: ["medium", "high"],
      allowedRoles: [
        "low-cost-extraction-help",
        "standard-planning-generation",
      ],
      automaticEscalationRouteId: "internal-escalation",
      customerSelectablePlans: ["starter", "pro"],
      customerServiceLevel: "standard-design",
      customerVisible: true,
      defaultEffort: "medium",
      displayName: "Standard Design",
      enabled: true,
      maximumAttempts: 2,
      modelConfigurationReference: "cloudmarkup.bedrock.standard.v1",
      promptCacheEnabled: true,
      routeId: "standard-design",
    },
    {
      allowedEffortLevels: ["high", "xhigh"],
      allowedRoles: ["deep-architecture-custom-generation"],
      customerSelectablePlans: ["pro"],
      customerServiceLevel: "deep-design",
      customerVisible: true,
      defaultEffort: "high",
      displayName: "Deep Design",
      enabled: true,
      maximumAttempts: 2,
      modelConfigurationReference: "cloudmarkup.bedrock.deep.v1",
      promptCacheEnabled: true,
      routeId: "deep-design",
    },
    {
      allowedEffortLevels: ["high", "xhigh"],
      allowedRoles: ["repair-escalation"],
      customerSelectablePlans: [],
      customerVisible: false,
      defaultEffort: "high",
      displayName: "Internal escalation",
      enabled: true,
      maximumAttempts: 1,
      modelConfigurationReference: "cloudmarkup.bedrock.deep.v1",
      promptCacheEnabled: true,
      routeId: "internal-escalation",
    },
  ],
});

export class ModelRoutingPolicyError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "ModelRoutingPolicyError";
    this.code = code;
  }
}

function routeById(
  registry: ModelRouteRegistryV1,
  routeId: ModelRouteIdV1,
): ModelRouteDefinitionV1 {
  const route = registry.routes.find(
    (candidate) => candidate.routeId === routeId,
  );
  if (route === undefined) {
    throw new ModelRoutingPolicyError(
      "model-routing.configuration-invalid",
      "The route registry does not contain the required route.",
    );
  }
  return route;
}

function capabilityForRoute(
  route: ModelRouteDefinitionV1,
  registry: ModelCapabilityRegistryV1,
): ModelCapabilityRecordV1 {
  const capability = registry.capabilities.find(
    (candidate) =>
      candidate.modelConfigurationReference ===
      route.modelConfigurationReference,
  );
  if (capability === undefined) {
    throw new ModelRoutingPolicyError(
      "model-routing.configuration-invalid",
      "A route references an unknown model capability.",
    );
  }
  return capability;
}

export function validateModelRoutingConfigurationV1(input: {
  readonly capabilityRegistry: ModelCapabilityRegistryV1;
  readonly routeRegistry: ModelRouteRegistryV1;
}): void {
  const capabilities = modelCapabilityRegistryV1Schema.safeParse(
    input.capabilityRegistry,
  );
  const routes = modelRouteRegistryV1Schema.safeParse(input.routeRegistry);
  if (!capabilities.success || !routes.success) {
    throw new ModelRoutingPolicyError(
      "model-routing.configuration-invalid",
      "The model routing configuration does not match the strict v1 contracts.",
    );
  }
  if (
    routes.data.capabilityRegistryId !== capabilities.data.registryId ||
    routes.data.capabilityRegistryVersion !==
      capabilities.data.registryVersion ||
    routes.data.capabilityRegistryDigest !==
      digestStructuredValue(capabilities.data)
  ) {
    throw new ModelRoutingPolicyError(
      "model-routing.configuration-drift",
      "The route and capability registry versions do not match.",
    );
  }
  for (const route of routes.data.routes) {
    const capability = capabilityForRoute(route, capabilities.data);
    if (
      route.maximumAttempts > capability.maximumAttempts ||
      route.allowedEffortLevels.some(
        (effort) => !capability.acceptedEffortLevels.includes(effort),
      ) ||
      route.allowedRoles.some((role) => !capability.roles.includes(role)) ||
      (!capability.toolUseSupported &&
        !capability.nativeStructuredOutputSupported) ||
      (route.promptCacheEnabled && !capability.promptCache.supported)
    ) {
      throw new ModelRoutingPolicyError(
        "model-routing.configuration-contradiction",
        "A route exceeds the limits or structured response channel declared by its model capability.",
      );
    }
  }
}

function isInternalEscalation(request: ModelRoutingRequestV1): boolean {
  return (
    request.creditAuthorization.allowed &&
    request.creditAuthorization.estimateAccepted &&
    request.creditAuthorization.acceptedEstimateMaximumCreditUnits !==
      undefined &&
    request.creditAuthorization.decisionId ===
      request.priorAttempt?.originalCreditAuthorizationDecisionId &&
    request.creditAuthorization.acceptedEstimateMaximumCreditUnits ===
      request.priorAttempt.originalAcceptedEstimateMaximumCreditUnits &&
    request.priorAttempt.routeId === "standard-design" &&
    request.priorAttempt.escalationCount === 0 &&
    [
      "validation-failure",
      "build-failure",
      "compiler-failure",
      "coverage-failure",
    ].includes(request.priorAttempt.result) &&
    request.currentValidationState.startsWith("failed-")
  );
}

function complexityReasons(
  request: ModelRoutingRequestV1,
): readonly ModelRoutingReasonCodeV1[] {
  const reasons: ModelRoutingReasonCodeV1[] = [];
  if (
    request.workloadCount >= 8 ||
    request.nodeCount >= 25 ||
    request.edgeCount >= 40
  )
    reasons.push("complex-workloads");
  if (["complex", "hybrid"].includes(request.networkingComplexity))
    reasons.push("complex-networking");
  if (
    ["multi-account", "multi-account-region"].includes(
      request.accountRegionComplexity,
    )
  )
    reasons.push("multi-account");
  if (
    ["multi-region", "multi-account-region"].includes(
      request.accountRegionComplexity,
    )
  )
    reasons.push("multi-region");
  if (
    request.repositoryTokenEstimate >= 120_000 ||
    request.repositoryFileEstimate >= 500
  )
    reasons.push("large-repository");
  if (request.customCodeRequirement === "custom") reasons.push("custom-code");
  if (request.securityComplianceSensitivity === "high")
    reasons.push("security-sensitive");
  return reasons;
}

function selectedEffort(
  route: ModelRouteDefinitionV1,
  capability: ModelCapabilityRecordV1,
  request: ModelRoutingRequestV1,
): ModelEffortV1 {
  const requestedEffort = requiredModelEffortV1(route, request);
  if (
    route.allowedEffortLevels.includes(requestedEffort) &&
    capability.acceptedEffortLevels.includes(requestedEffort)
  ) {
    return requestedEffort;
  }
  throw new ModelRoutingPolicyError(
    "model-routing.configuration-contradiction",
    "The selected effort is not supported by both the route and capability.",
  );
}

function outputLimit(
  request: ModelRoutingRequestV1,
  capability: ModelCapabilityRecordV1,
): number {
  const requested =
    request.expectedOutputClass === "small-explanation"
      ? 8_192
      : ["application-files", "iac-files", "repair"].includes(
            request.expectedOutputClass,
          )
        ? 131_072
        : 32_768;
  return Math.min(requested, capability.maximumOutputTokens);
}

interface RoutingDecisionInput {
  readonly capabilityRegistry?: ModelCapabilityRegistryV1;
  readonly request: ModelRoutingRequestV1;
  readonly routeRegistry?: ModelRouteRegistryV1;
  readonly routingConfigurationDigest: Sha256Digest;
}
export function selectModelRoutingDecisionV1(
  input: RoutingDecisionInput,
): ModelRoutingDecisionV1 {
  return selectRoutingDecision(input);
}

export interface ModelLiveRoutingPreparationInputV2 {
  readonly capabilityRegistry: ModelCapabilityRegistryV1;
  readonly routeRegistry: ModelRouteRegistryV1;
  readonly request: ModelRoutingRequestV1;
  readonly routingConfigurationDigest: Sha256Digest;
  readonly plan: ModelLiveEvaluationPlanV2;
  readonly caseId: string;
  readonly observedAt: string;
  readonly maximumOutputTokens: number;
  readonly timeoutMilliseconds: number;
}

/** Pure preparation only. Self-authored or rehashed plan metadata grants no
 * execution authority. The live host must authenticate actual issuance,
 * current approval and exact input before admission and final HTTP dispatch. */
export function prepareModelLiveRoutingDecisionV2(
  input: ModelLiveRoutingPreparationInputV2,
): ModelRoutingDecisionV1 {
  const plan = modelLiveEvaluationPlanV2Schema.parse(input.plan);
  const request = modelRoutingRequestV1Schema.parse(input.request);
  const capabilityRegistry = modelCapabilityRegistryV1Schema.parse(
    input.capabilityRegistry,
  );
  const routeRegistry = modelRouteRegistryV1Schema.parse(input.routeRegistry);
  const now = Date.parse(utcTimestampSchema.parse(input.observedAt));
  const binding = plan.definition.cases.find((c) => c.caseId === input.caseId);
  const policy = plan.definition.policy;
  const scope = plan.definition.scope;
  const route = routeRegistry.routes.find(
    (r) => r.routeId === binding?.routeId,
  );
  const tuple = binding?.authorityBinding.authorityTuple;
  const capability = capabilityRegistry.capabilities.find(
    (c) => c.modelConfigurationReference === tuple?.modelConfigurationReference,
  );
  if (
    binding === undefined ||
    tuple === undefined ||
    route === undefined ||
    capability === undefined ||
    binding.routeId === "internal-escalation" ||
    request.priorAttempt !== undefined ||
    now < Date.parse(plan.issuedAt) ||
    now >= Date.parse(plan.expiresAt) ||
    request.organizationId !== scope.organizationId ||
    request.projectId !== scope.projectId ||
    request.principalId !== scope.userId ||
    request.environment !== scope.environment ||
    request.plan.key !== scope.plan ||
    request.inputDigest !== binding.invocationInputDigest ||
    request.feature !== tuple.operation ||
    request.requiredEvaluationPolicyId !==
      policy.evaluationRequirement.evaluationPolicyId ||
    request.requiredEvaluationPolicyVersion !==
      policy.evaluationRequirement.evaluationPolicyVersion ||
    digestStructuredValue(capabilityRegistry) !==
      tuple.capabilityRegistryDigest ||
    digestStructuredValue(routeRegistry) !== tuple.routeRegistryDigest ||
    digestStructuredValue(route) !== tuple.routeDefinitionDigest ||
    route.modelConfigurationReference !== tuple.modelConfigurationReference ||
    capability.inferenceProfileId !== tuple.inferenceProfileId ||
    capability.providerFamily === "deterministic-fake" ||
    !["candidate", "active"].includes(capability.lifecycleState) ||
    !Number.isSafeInteger(input.maximumOutputTokens) ||
    input.maximumOutputTokens < 1 ||
    input.maximumOutputTokens >
      Math.min(
        capability.maximumOutputTokens,
        policy.limits.maximumOutputTokens,
        plan.definition.limits.maximumOutputTokens,
      ) ||
    request.estimatedContextTokens >
      plan.definition.limits.maximumInputTokens ||
    !Number.isSafeInteger(input.timeoutMilliseconds) ||
    input.timeoutMilliseconds < 1 ||
    input.timeoutMilliseconds > capability.timeoutMilliseconds ||
    input.timeoutMilliseconds > Date.parse(plan.expiresAt) - now ||
    policy.killSwitches.global.engaged ||
    policy.killSwitches.capabilitySwitches.some(
      (c) => c.operation === tuple.operation && c.engaged,
    ) ||
    policy.administrativeSuspensions.some(
      (s) =>
        s.scopeId ===
        (s.scope === "organization" ? scope.organizationId : scope.userId),
    )
  )
    throw new ModelRoutingPolicyError(
      "model-routing.live-binding-mismatch",
      "The exact live evaluation case, configuration and bounded request are required.",
    );
  const decision = selectRoutingDecision(
    {
      capabilityRegistry,
      routeRegistry,
      request,
      routingConfigurationDigest: input.routingConfigurationDigest,
    },
    {
      maximumOutputTokens: input.maximumOutputTokens,
      timeoutMilliseconds: input.timeoutMilliseconds,
    },
  );
  if (
    decision.routeId !== binding.routeId ||
    requiredModelRoleForDecisionV1(decision, request) !== tuple.role
  )
    throw new ModelRoutingPolicyError(
      "model-routing.live-binding-mismatch",
      "The selected route and role must match the exact frozen evaluation case.",
    );
  return decision;
}

export interface ModelLiveSeedRoutingPreparationInputV3 extends Omit<
  ModelLiveRoutingPreparationInputV2,
  "plan" | "caseId"
> {
  readonly plan: ModelLiveSequencePlanV3;
  readonly selection: ModelLiveSequenceSelectionV3;
  readonly stageInput: ModelLiveSequenceInputV3;
}

/** Pure first-seed routing from exact issued lineage and configured registries.
 * A prior seed validation failure is not a prior model attempt or quality report. */
export function prepareModelLiveSeedRoutingDecisionV3(
  input: ModelLiveSeedRoutingPreparationInputV3,
): ModelLiveSeedRoutingDecisionV3 {
  const plan = modelLiveSequencePlanV3Schema.parse(input.plan);
  const selection = modelLiveSequenceSelectionV3Schema.parse(input.selection);
  const stageInput = modelLiveSequenceInputV3Schema.parse(input.stageInput);
  const projection = inspectModelLiveSequenceV3({
    plan,
    selection,
    inputs: [stageInput],
    dispatches: [],
    outcomes: [],
    observedAt: stageInput.issuedAt,
  });
  const request = modelRoutingRequestV1Schema.parse(input.request);
  const capabilityRegistry = modelCapabilityRegistryV1Schema.parse(
    input.capabilityRegistry,
  );
  const routeRegistry = modelRouteRegistryV1Schema.parse(input.routeRegistry);
  const now = Date.parse(utcTimestampSchema.parse(input.observedAt));
  const binding = plan.definition.cases.find(
    (c) => c.caseId === stageInput.caseId,
  );
  const policy = plan.definition.policy;
  const scope = plan.definition.scope;
  const route = routeRegistry.routes.find(
    (r) => r.routeId === binding?.routeId,
  );
  const tuple = binding?.authorityBinding.authorityTuple;
  const capability = capabilityRegistry.capabilities.find(
    (c) => c.modelConfigurationReference === tuple?.modelConfigurationReference,
  );
  if (
    binding === undefined ||
    tuple === undefined ||
    route === undefined ||
    capability === undefined ||
    binding.routeId !== "internal-escalation" ||
    stageInput.stageKey !== "repair-1" ||
    !projection.cases.some(
      (c) =>
        c.caseId === stageInput.caseId &&
        c.stageId === stageInput.stageId &&
        c.state === "requires-dispatch-admission",
    ) ||
    request.xhighEffortAuthorization !== undefined ||
    !capability.roles.includes("repair-escalation") ||
    request.priorAttempt !== undefined ||
    now < Date.parse(stageInput.issuedAt) ||
    now >= Date.parse(plan.expiresAt) ||
    request.organizationId !== scope.organizationId ||
    request.projectId !== scope.projectId ||
    request.principalId !== scope.userId ||
    request.environment !== scope.environment ||
    request.plan.key !== scope.plan ||
    request.inputDigest !== stageInput.operationInputDigest ||
    request.feature !== tuple.operation ||
    request.requiredEvaluationPolicyId !==
      policy.evaluationRequirement.evaluationPolicyId ||
    request.requiredEvaluationPolicyVersion !==
      policy.evaluationRequirement.evaluationPolicyVersion ||
    digestStructuredValue(capabilityRegistry) !==
      tuple.capabilityRegistryDigest ||
    digestStructuredValue(routeRegistry) !== tuple.routeRegistryDigest ||
    digestStructuredValue(route) !== tuple.routeDefinitionDigest ||
    route.modelConfigurationReference !== tuple.modelConfigurationReference ||
    capability.inferenceProfileId !== tuple.inferenceProfileId ||
    capability.providerFamily === "deterministic-fake" ||
    !["candidate", "active"].includes(capability.lifecycleState) ||
    !Number.isSafeInteger(input.maximumOutputTokens) ||
    input.maximumOutputTokens < 1 ||
    input.maximumOutputTokens >
      Math.min(
        capability.maximumOutputTokens,
        policy.limits.maximumOutputTokens,
        plan.definition.limits.maximumOutputTokens,
      ) ||
    request.estimatedContextTokens >
      plan.definition.limits.maximumInputTokens ||
    !Number.isSafeInteger(input.timeoutMilliseconds) ||
    input.timeoutMilliseconds < 1 ||
    input.timeoutMilliseconds > capability.timeoutMilliseconds ||
    input.timeoutMilliseconds > Date.parse(plan.expiresAt) - now ||
    policy.killSwitches.global.engaged ||
    policy.killSwitches.capabilitySwitches.some(
      (c) => c.operation === tuple.operation && c.engaged,
    ) ||
    policy.administrativeSuspensions.some(
      (s) =>
        s.scopeId ===
        (s.scope === "organization" ? scope.organizationId : scope.userId),
    )
  )
    throw new ModelRoutingPolicyError(
      "model-routing.live-binding-mismatch",
      "The exact live evaluation case, configuration and bounded request are required.",
    );
  const decision = selectRoutingDecision(
    {
      capabilityRegistry,
      routeRegistry,
      request,
      routingConfigurationDigest: input.routingConfigurationDigest,
    },
    {
      maximumOutputTokens: input.maximumOutputTokens,
      timeoutMilliseconds: input.timeoutMilliseconds,
    },
    { inputBindingDigest: stageInput.inputBindingDigest },
  );
  if (requiredModelRoleForDecisionV1(decision, request) !== tuple.role)
    throw new ModelRoutingPolicyError(
      "model-routing.live-binding-mismatch",
      "The selected route and role must match the exact frozen evaluation case.",
    );
  return decision;
}

interface LiveRoutingBounds {
  readonly maximumOutputTokens: number;
  readonly timeoutMilliseconds: number;
}
interface SeedRoutingBinding {
  readonly inputBindingDigest: Sha256Digest;
}
function selectRoutingDecision(
  input: RoutingDecisionInput,
  live?: LiveRoutingBounds,
): ModelRoutingDecisionV1;
function selectRoutingDecision(
  input: RoutingDecisionInput,
  live: LiveRoutingBounds,
  seed: SeedRoutingBinding,
): ModelLiveSeedRoutingDecisionV3;
function selectRoutingDecision(
  input: RoutingDecisionInput,
  live?: LiveRoutingBounds,
  seed?: SeedRoutingBinding,
): ModelRoutingDecisionV1 | ModelLiveSeedRoutingDecisionV3 {
  const request = modelRoutingRequestV1Schema.parse(input.request);
  const capabilityRegistry =
    input.capabilityRegistry ?? bedrockModelCapabilityRegistryV1;
  const routeRegistry = input.routeRegistry ?? bedrockModelRouteRegistryV1;
  validateModelRoutingConfigurationV1({ capabilityRegistry, routeRegistry });

  const escalation = seed !== undefined || isInternalEscalation(request);
  const priorAttemptNotEligible =
    request.priorAttempt !== undefined && !escalation;
  const routeId: ModelRouteIdV1 = escalation
    ? "internal-escalation"
    : request.selectedPreference === "deep-design"
      ? "deep-design"
      : "standard-design";
  const route = routeById(routeRegistry, routeId);
  const capability = capabilityForRoute(route, capabilityRegistry);
  const recommendationReasons = complexityReasons(request);
  const recommendedServiceLevel: ModelServiceLevelV1 =
    escalation || recommendationReasons.length > 0
      ? "deep-design"
      : "standard-design";
  const reasons: ModelRoutingReasonCodeV1[] = escalation
    ? ["prior-validation-failure"]
    : request.selectedPreference === "deep-design"
      ? ["user-selected-deep", ...recommendationReasons]
      : request.selectedPreference === "standard-design"
        ? ["user-selected-standard"]
        : recommendationReasons.length > 0
          ? [...recommendationReasons]
          : ["standard-default"];
  if (priorAttemptNotEligible) reasons.push("prior-attempt-not-eligible");

  const entitlementAllowed =
    escalation || route.customerSelectablePlans.includes(request.plan.key);
  if (!entitlementAllowed) reasons.push("plan-denied");
  const creditAllowed = request.creditAuthorization.allowed;
  if (!creditAllowed) reasons.push("credits-insufficient");
  const confirmationRequired =
    (routeId === "deep-design" || seed !== undefined) &&
    !request.creditAuthorization.estimateAccepted;
  if (confirmationRequired) reasons.push("user-confirmation-required");
  if (!route.enabled || capability.killSwitch.engaged)
    reasons.push("route-disabled");
  if (
    (live === undefined
      ? capability.lifecycleState !== "active" || !capability.evaluation.passed
      : !["candidate", "active"].includes(capability.lifecycleState)) ||
    capability.evaluation.evaluationPolicyId !==
      request.requiredEvaluationPolicyId ||
    capability.evaluation.evaluationPolicyVersion !==
      request.requiredEvaluationPolicyVersion
  )
    reasons.push("evaluation-failed");
  if (
    !capability.enabledEnvironments.includes(request.environment) ||
    !capability.enabledFeatureClasses.includes(request.feature) ||
    !capability.supportedModes.includes(request.requestedMode) ||
    !capability.enabledPlans.includes(request.plan.key)
  )
    reasons.push("capability-mismatch");

  const maximumOutputTokens =
    live?.maximumOutputTokens ?? outputLimit(request, capability);
  if (
    request.estimatedContextTokens >
    capability.contextLimitTokens - maximumOutputTokens
  ) {
    reasons.push("context-limit-exceeded");
  }

  const deniedReasons = new Set<ModelRoutingReasonCodeV1>([
    "plan-denied",
    "credits-insufficient",
    "route-disabled",
    "evaluation-failed",
    "capability-mismatch",
    "context-limit-exceeded",
    "prior-attempt-not-eligible",
    "user-confirmation-required",
  ]);
  const outcome = reasons.some((reason) => deniedReasons.has(reason))
    ? "denied"
    : "selected";
  const effort = selectedEffort(route, capability, request);
  const promptCacheEnabled =
    live === undefined &&
    isModelPromptCacheEligibleV1({
      capability,
      request,
      route,
    });

  const projection = {
    automaticEscalationPermitted:
      live === undefined &&
      outcome === "selected" &&
      routeId === "standard-design" &&
      route.automaticEscalationRouteId === "internal-escalation" &&
      request.priorAttempt === undefined &&
      request.creditAuthorization.estimateAccepted &&
      request.creditAuthorization.acceptedEstimateMaximumCreditUnits !==
        undefined,
    capabilityRegistryDigest: digestStructuredValue(capabilityRegistry),
    capabilityRegistryId: capabilityRegistry.registryId,
    capabilityRegistryVersion: capabilityRegistry.registryVersion,
    contractVersion: 1,
    creditAuthorization: {
      allowed: creditAllowed,
      decisionId: request.creditAuthorization.decisionId,
      estimateAccepted: request.creditAuthorization.estimateAccepted,
    },
    customerCharge: {
      ...(request.creditAuthorization.acceptedEstimateMaximumCreditUnits ===
      undefined
        ? {}
        : {
            acceptedMaximumCreditUnits:
              request.creditAuthorization.acceptedEstimateMaximumCreditUnits,
          }),
      incrementalEscalationCreditUnits: 0,
      policy: "accepted-estimate-cap",
    },
    effort,
    evaluationResultDigest: digestStructuredValue(capability.evaluation),
    evaluationResultVersion: capability.evaluation.resultVersion,
    entitlement: {
      allowed: entitlementAllowed,
      decisionId: request.plan.entitlementDecisionId,
      planKey: request.plan.key,
      planVersionId: request.plan.versionId,
    },
    estimateClass:
      routeId === "standard-design"
        ? request.expectedOutputClass === "small-explanation"
          ? "small"
          : "standard"
        : "deep",
    evaluationPolicyId: capability.evaluation.evaluationPolicyId,
    evaluationPolicyVersion: capability.evaluation.evaluationPolicyVersion,
    feature: request.feature,
    inferenceProfileId: capability.inferenceProfileId,
    maximumAttempts:
      live === undefined
        ? Math.min(route.maximumAttempts, capability.maximumAttempts)
        : 1,
    maximumOutputTokens,
    modelCapabilityDigest: digestStructuredValue(capability),
    modelCapabilityVersion: capability.capabilityVersion,
    modelConfigurationReference: capability.modelConfigurationReference,
    modelFamily: capability.modelFamily,
    modelId: capability.modelId,
    modelVersion: capability.modelVersion,
    outcome,
    pricingVersionReference: capability.pricingVersionReference,
    promptCachePolicy: {
      cacheKeyRequired: promptCacheEnabled,
      enabled: promptCacheEnabled,
      maximumCheckpoints: promptCacheEnabled
        ? capability.promptCache.maximumCheckpoints
        : 0,
      minimumCheckpointTokens: promptCacheEnabled
        ? capability.promptCache.minimumCheckpointTokens
        : 0,
    },
    providerFamily: capability.providerFamily,
    providerId: capability.providerId,
    reasonCodes: [...new Set(reasons)],
    recommendedServiceLevel,
    requestedMode: request.requestedMode,
    routeId,
    routeDefinitionDigest: digestStructuredValue(route),
    routeRegistryId: routeRegistry.routeRegistryId,
    routeRegistryDigest: digestStructuredValue(routeRegistry),
    routeRegistryVersion: routeRegistry.routeRegistryVersion,
    routingConfigurationDigest: input.routingConfigurationDigest,
    requestBinding: {
      idempotencyKeyDigest: request.idempotencyKeyDigest,
      inputDigest: request.inputDigest,
      routingRequestDigest: digestStructuredValue(request),
      scopeDigest: request.scopeDigest,
    },
    timeoutMilliseconds:
      live?.timeoutMilliseconds ?? capability.timeoutMilliseconds,
    userConfirmationRequired: confirmationRequired,
    ...(effort === "xhigh" && request.xhighEffortAuthorization !== undefined
      ? {
          xhighEffortAuthorizationDecisionId:
            request.xhighEffortAuthorization.decisionId,
        }
      : {}),
    ...(escalation && request.priorAttempt !== undefined
      ? {
          escalation: {
            diagnosticsDigest: request.priorAttempt.diagnosticsDigest,
            originalAcceptedEstimateMaximumCreditUnits:
              request.priorAttempt.originalAcceptedEstimateMaximumCreditUnits,
            originalCreditAuthorizationDecisionId:
              request.priorAttempt.originalCreditAuthorizationDecisionId,
            originalInvocationId: request.priorAttempt.originalInvocationId,
            originalResult: request.priorAttempt.result,
            originalRouteId: "standard-design",
            originalRoutingDecisionDigest:
              request.priorAttempt.originalRoutingDecisionDigest,
          },
        }
      : {}),
  };
  if (seed !== undefined) {
    const {
      evaluationResultDigest,
      evaluationResultVersion,
      escalation: priorAttempt,
      ...fields
    } = projection;
    void evaluationResultDigest;
    void evaluationResultVersion;
    void priorAttempt;
    return modelLiveSeedRoutingDecisionV3Schema.parse({
      ...fields,
      contractVersion: 3,
      recordKind: "model-live-seed-routing-decision",
      seedInputBindingDigest: seed.inputBindingDigest,
    });
  }
  return modelRoutingDecisionV1Schema.parse(projection);
}

export function createModelRoutingDecisionEvaluatorV1(input: {
  readonly capabilityRegistry: ModelCapabilityRegistryV1;
  readonly routeRegistry: ModelRouteRegistryV1;
}): ModelRoutingDecisionEvaluatorV1 {
  return createRoutingDecisionEvaluator(input, selectModelRoutingDecisionV1);
}

/** Bound, pure evaluator for one explicitly prepared case; not an approval port. */
export function createModelLiveRoutingDecisionEvaluatorV2(
  input: ModelLiveRoutingPreparationInputV2,
): ModelRoutingDecisionEvaluatorV1 {
  const bound = structuredClone(input);
  const prepared = prepareModelLiveRoutingDecisionV2(bound);
  return createRoutingDecisionEvaluator(bound, (evaluationInput) => {
    if (
      digestStructuredValue(evaluationInput.request) !==
        digestStructuredValue(bound.request) ||
      evaluationInput.routingConfigurationDigest !==
        bound.routingConfigurationDigest
    )
      throw new ModelRoutingPolicyError(
        "model-routing.live-binding-mismatch",
        "The live evaluator only accepts its exact prepared request and routing configuration.",
      );
    return modelRoutingDecisionV1Schema.parse(prepared);
  });
}

function createRoutingDecisionEvaluator(
  input: {
    readonly capabilityRegistry: ModelCapabilityRegistryV1;
    readonly routeRegistry: ModelRouteRegistryV1;
  },
  select: (input: RoutingDecisionInput) => ModelRoutingDecisionV1,
): ModelRoutingDecisionEvaluatorV1 {
  const capabilityRegistry = modelCapabilityRegistryV1Schema.parse(
    input.capabilityRegistry,
  );
  const routeRegistry = modelRouteRegistryV1Schema.parse(input.routeRegistry);
  validateModelRoutingConfigurationV1({ capabilityRegistry, routeRegistry });
  return Object.freeze({
    evaluate(
      evaluationInput: Parameters<
        ModelRoutingDecisionEvaluatorV1["evaluate"]
      >[0],
    ) {
      const decision = select({
        capabilityRegistry,
        request: evaluationInput.request,
        routeRegistry,
        routingConfigurationDigest: evaluationInput.routingConfigurationDigest,
      });
      const capabilityRecord = capabilityForRoute(
        routeById(routeRegistry, decision.routeId),
        capabilityRegistry,
      );
      const capability: ModelCapabilityV1 = Object.freeze({
        acceptedEffortLevels: capabilityRecord.acceptedEffortLevels,
        capabilityDigest: digestStructuredValue(capabilityRecord),
        capabilityRegistryDigest: digestStructuredValue(capabilityRegistry),
        capabilityRegistryId: capabilityRegistry.registryId,
        capabilityRegistryVersion: capabilityRegistry.registryVersion,
        capabilityVersion: capabilityRecord.capabilityVersion,
        contextLimitTokens: capabilityRecord.contextLimitTokens,
        costTier: capabilityRecord.costTier,
        dataResidencyBoundary: capabilityRecord.residency.geographyPolicy,
        evaluation: {
          evaluationPolicyId: capabilityRecord.evaluation.evaluationPolicyId,
          evaluationPolicyVersion:
            capabilityRecord.evaluation.evaluationPolicyVersion,
          passed: capabilityRecord.evaluation.passed,
          resultDigest: digestStructuredValue(capabilityRecord.evaluation),
          resultVersion: capabilityRecord.evaluation.resultVersion,
          scoreBasisPoints: capabilityRecord.evaluation.scoreBasisPoints,
        },
        inferenceProfileId: capabilityRecord.inferenceProfileId,
        maximumAttempts: capabilityRecord.maximumAttempts,
        maximumInputBytes: capabilityRecord.maximumInputBytes,
        maximumOutputBytes: capabilityRecord.maximumOutputBytes,
        maximumOutputTokens: capabilityRecord.maximumOutputTokens,
        modelConfigurationReference:
          capabilityRecord.modelConfigurationReference,
        modelFamily: capabilityRecord.modelFamily,
        modelId: capabilityRecord.modelId,
        modelVersion: capabilityRecord.modelVersion,
        operations: capabilityRecord.enabledFeatureClasses,
        pricingVersionReference: capabilityRecord.pricingVersionReference,
        promptCache: {
          maximumCheckpoints: capabilityRecord.promptCache.maximumCheckpoints,
          minimumCheckpointTokens:
            capabilityRecord.promptCache.minimumCheckpointTokens,
          supported: capabilityRecord.promptCache.supported,
        },
        roles: capabilityRecord.roles,
        streamingSupported: capabilityRecord.streamingSupported,
        structuredOutput: capabilityRecord.nativeStructuredOutputSupported
          ? "native-json-schema"
          : "tool-schema",
        supportedModes: capabilityRecord.supportedModes,
        timeoutMilliseconds: capabilityRecord.timeoutMilliseconds,
        usageFieldsExpected: capabilityRecord.usageFieldsExpected,
      });
      return Object.freeze({ capability, decision });
    },
  });
}

export function modelCacheKeyDigestV1(
  input: ModelCacheKeyInputV1,
): Sha256Digest {
  return digestStructuredValue(modelCacheKeyInputV1Schema.parse(input));
}

export function createModelRouteEstimateInputV1(input: {
  readonly decision: ModelRoutingDecisionV1;
  readonly expectedAdaptiveThinkingOutputUnits: number;
  readonly expectedCacheHitInputUnits: number;
  readonly expectedCacheWriteInputUnits: number;
  readonly expectedUncachedInputUnits: number;
  readonly expectedVisibleOutputUnits: number;
  readonly operatingBufferBasisPoints: number;
}): ModelRouteEstimateInputV1 {
  return modelRouteEstimateInputV1Schema.parse({
    effort: input.decision.effort,
    expectedAdaptiveThinkingOutputUnits:
      input.expectedAdaptiveThinkingOutputUnits,
    expectedCacheHitInputUnits: input.expectedCacheHitInputUnits,
    expectedCacheWriteInputUnits: input.expectedCacheWriteInputUnits,
    expectedUncachedInputUnits: input.expectedUncachedInputUnits,
    expectedVisibleOutputUnits: input.expectedVisibleOutputUnits,
    maximumAttempts: input.decision.maximumAttempts,
    modelConfigurationReference: input.decision.modelConfigurationReference,
    operatingBufferBasisPoints: input.operatingBufferBasisPoints,
    possibleEscalation: input.decision.automaticEscalationPermitted,
    pricingVersionReference: input.decision.pricingVersionReference,
    routeId: input.decision.routeId,
  });
}
