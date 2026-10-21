import { z } from "zod";

import {
  modelGatewayRoleV1Schema,
  serializeCanonicalJson,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  type ModelEffortV1,
  type ModelGatewayOperationV1,
  type ModelGatewayRoleV1,
  type ModelRouteDefinitionV1,
  type ModelRoutingDecisionV1,
  type ModelRoutingRequestV1,
} from "@cloudmarkup/schemas";

import type {
  ModelCapabilityV1,
  ModelGatewayInvocationContextV1,
  ModelProviderCapabilityProfileV1,
} from "./ports.js";

const boundedRouteIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u);

export const modelRouteCandidateV1Schema = z
  .object({
    inferenceProfileId: boundedRouteIdentifierSchema.optional(),
    modelId: boundedRouteIdentifierSchema,
    priority: z.number().int().nonnegative().max(10_000),
    providerId: namespacedIdentifierSchema,
  })
  .strict();

export const modelRoleRouteV1Schema = z
  .object({
    candidates: z.array(modelRouteCandidateV1Schema).min(1).max(32),
    role: modelGatewayRoleV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const candidateKeys = value.candidates.map(
      (candidate) =>
        `${candidate.providerId}\u0000${candidate.modelId}\u0000${candidate.inferenceProfileId ?? ""}`,
    );
    if (new Set(candidateKeys).size !== candidateKeys.length) {
      context.addIssue({
        code: "custom",
        message:
          "A role route cannot repeat the same provider model candidate.",
        path: ["candidates"],
      });
    }
  });

export const modelRoutingConfigurationV1Schema = z
  .object({
    allowFallback: z.boolean(),
    configurationId: namespacedIdentifierSchema,
    configurationVersion: semanticVersionSchema,
    routes: z.array(modelRoleRouteV1Schema).min(1).max(5),
  })
  .strict()
  .superRefine((value, context) => {
    const roles = value.routes.map((route) => route.role);
    if (new Set(roles).size !== roles.length) {
      context.addIssue({
        code: "custom",
        message: "A routing configuration cannot repeat one role route.",
        path: ["routes"],
      });
    }
  });

export type ModelRouteCandidateV1 = z.output<
  typeof modelRouteCandidateV1Schema
>;
export type ModelRoleRouteV1 = z.output<typeof modelRoleRouteV1Schema>;
export type ModelRoutingConfigurationV1 = z.output<
  typeof modelRoutingConfigurationV1Schema
>;

export interface SelectedModelRouteV1 {
  readonly capability: ModelCapabilityV1;
  readonly profile: ModelProviderCapabilityProfileV1;
  readonly role: ModelGatewayRoleV1;
}

export class ModelRoutingError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "ModelRoutingError";
    this.code = code;
  }
}

const costTierRank = Object.freeze({ low: 1, standard: 2, deep: 3 } as const);

function compareUtf16CodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isModelPromptCacheEligibleV1(input: {
  readonly capability: Pick<ModelCapabilityV1, "promptCache">;
  readonly request: Pick<ModelRoutingRequestV1, "estimatedContextTokens">;
  readonly route: Pick<ModelRouteDefinitionV1, "promptCacheEnabled">;
}): boolean {
  return (
    input.route.promptCacheEnabled &&
    input.capability.promptCache.supported &&
    input.request.estimatedContextTokens >=
      input.capability.promptCache.minimumCheckpointTokens
  );
}

export function requiredModelEffortV1(
  route: ModelRouteDefinitionV1,
  request: ModelRoutingRequestV1,
): ModelEffortV1 {
  if (route.routeId !== "standard-design") {
    return request.xhighEffortAuthorization === undefined
      ? route.defaultEffort
      : "xhigh";
  }
  const smallGraphOperation =
    request.operationClass === "graph-operation" &&
    request.expectedOutputClass === "structured-proposal" &&
    request.accountRegionComplexity === "single-account-region" &&
    request.customCodeRequirement === "none" &&
    request.securityComplianceSensitivity === "ordinary" &&
    ["none", "basic"].includes(request.networkingComplexity) &&
    request.nodeCount <= 10 &&
    request.edgeCount <= 12 &&
    request.serviceFamilyCount <= 4 &&
    request.workloadCount <= 4 &&
    request.externalResourceCount <= 4;
  return ["planning", "code-generation", "iac-generation", "repair"].includes(
    request.operationClass,
  ) ||
    (request.operationClass === "graph-operation" && !smallGraphOperation)
    ? "high"
    : "medium";
}

export function requiredModelRoleForDecisionV1(
  decision: Pick<ModelRoutingDecisionV1, "routeId">,
  request: Pick<ModelRoutingRequestV1, "operationClass">,
): ModelGatewayRoleV1 {
  if (decision.routeId === "deep-design") {
    return "deep-architecture-custom-generation";
  }
  if (decision.routeId === "internal-escalation") {
    return "repair-escalation";
  }
  return ["extraction", "explanation"].includes(request.operationClass)
    ? "low-cost-extraction-help"
    : "standard-planning-generation";
}

function requiredRole(
  complexity: ModelGatewayInvocationContextV1["complexity"],
): ModelGatewayRoleV1 {
  switch (complexity) {
    case "low":
      return "low-cost-extraction-help";
    case "standard":
      return "standard-planning-generation";
    case "deep":
      return "deep-architecture-custom-generation";
    case "repair":
      return "repair-escalation";
  }
}

function routeCandidates(
  role: ModelGatewayRoleV1,
  configuration: ModelRoutingConfigurationV1,
): readonly ModelRouteCandidateV1[] {
  const route = configuration.routes.find(
    (candidate) => candidate.role === role,
  );
  if (route === undefined) return [];
  return [...route.candidates].sort(
    (left, right) =>
      left.priority - right.priority ||
      compareUtf16CodeUnits(left.providerId, right.providerId) ||
      compareUtf16CodeUnits(left.modelId, right.modelId) ||
      compareUtf16CodeUnits(
        left.inferenceProfileId ?? "",
        right.inferenceProfileId ?? "",
      ),
  );
}

function findCapability(
  candidate: ModelRouteCandidateV1,
  role: ModelGatewayRoleV1,
  operation: ModelGatewayOperationV1,
  context: ModelGatewayInvocationContextV1,
  profiles: readonly ModelProviderCapabilityProfileV1[],
  eligible: (capability: ModelCapabilityV1) => boolean = (capability) =>
    capability.evaluation.passed,
): SelectedModelRouteV1 | null {
  const profile = profiles.find(
    (value) => value.enabled && value.providerId === candidate.providerId,
  );
  if (profile === undefined) return null;
  const capability = profile.capabilities.find(
    (value) =>
      value.modelId === candidate.modelId &&
      value.inferenceProfileId === candidate.inferenceProfileId &&
      value.roles.includes(role) &&
      value.operations.includes(operation) &&
      value.supportedModes.includes(context.requestedMode) &&
      eligible(value) &&
      value.evaluation.evaluationPolicyId === context.evaluationPolicyId &&
      value.evaluation.evaluationPolicyVersion ===
        context.evaluationPolicyVersion &&
      costTierRank[value.costTier] <=
        costTierRank[context.budget.maximumCostTier],
  );
  return capability === undefined ? null : { capability, profile, role };
}

export function selectModelRouteV1(input: {
  readonly configuration: ModelRoutingConfigurationV1;
  readonly context: ModelGatewayInvocationContextV1;
  readonly operation: ModelGatewayOperationV1;
  readonly profiles: readonly ModelProviderCapabilityProfileV1[];
}): SelectedModelRouteV1 {
  if (!input.context.entitlement.allowed) {
    throw new ModelRoutingError(
      "model-gateway.entitlement-denied",
      "Model assistance is not entitled for this request.",
    );
  }
  if (!input.context.budget.allowed) {
    throw new ModelRoutingError(
      "model-gateway.budget-denied",
      "Model assistance is outside the approved budget.",
    );
  }

  const primaryRole = requiredRole(input.context.complexity);
  const roles = input.configuration.allowFallback
    ? ([primaryRole, "fallback"] as const)
    : ([primaryRole] as const);
  for (const role of roles) {
    if (!input.context.entitlement.allowedRoles.includes(role)) continue;
    for (const candidate of routeCandidates(role, input.configuration)) {
      const selected = findCapability(
        candidate,
        role,
        input.operation,
        input.context,
        input.profiles,
      );
      if (selected !== null) return selected;
    }
  }

  throw new ModelRoutingError(
    "model-gateway.no-evaluated-route",
    "No entitled, budgeted, evaluated model route supports this operation.",
  );
}

interface DecisionRouteInput {
  readonly configuration: ModelRoutingConfigurationV1;
  readonly context: ModelGatewayInvocationContextV1;
  readonly decision: ModelRoutingDecisionV1;
  readonly operation: ModelGatewayOperationV1;
  readonly profiles: readonly ModelProviderCapabilityProfileV1[];
  readonly request: ModelRoutingRequestV1;
}
export function selectModelRouteForDecisionV1(
  input: DecisionRouteInput,
): SelectedModelRouteV1 {
  return selectDecisionRoute(input);
}

/** Pure exact-profile selection after V2 preparation. No approval or provider
 * authority; only the explicit live gateway calls this after host authentication. */
export function selectPreparedModelLiveRouteV2(
  input: DecisionRouteInput & {
    readonly preparedCapability: ModelCapabilityV1;
  },
): SelectedModelRouteV1 {
  return selectDecisionRoute(
    input,
    (capability) =>
      serializeCanonicalJson(capability) ===
      serializeCanonicalJson(input.preparedCapability),
  );
}

function selectDecisionRoute(
  input: DecisionRouteInput,
  eligible?: (capability: ModelCapabilityV1) => boolean,
): SelectedModelRouteV1 {
  if (!input.context.entitlement.allowed) {
    throw new ModelRoutingError(
      "model-gateway.entitlement-denied",
      "Model assistance is not entitled for this request.",
    );
  }
  if (!input.context.budget.allowed) {
    throw new ModelRoutingError(
      "model-gateway.budget-denied",
      "Model assistance is outside the approved budget.",
    );
  }
  const role = requiredModelRoleForDecisionV1(input.decision, input.request);
  if (!input.context.entitlement.allowedRoles.includes(role)) {
    throw new ModelRoutingError(
      "model-gateway.entitlement-denied",
      "The exact routed model role is not currently entitled.",
    );
  }
  const candidate = routeCandidates(role, input.configuration).find(
    (value) =>
      value.providerId === input.decision.providerId &&
      value.modelId === input.decision.modelId &&
      value.inferenceProfileId === input.decision.inferenceProfileId,
  );
  if (candidate !== undefined) {
    const selected = findCapability(
      candidate,
      role,
      input.operation,
      input.context,
      input.profiles,
      eligible,
    );
    if (selected !== null) return selected;
  }
  throw new ModelRoutingError(
    "model-gateway.no-evaluated-route",
    "No currently entitled, budgeted, evaluated capability matches the exact routing decision.",
  );
}
