/** Synthetic unit-test pricing and model data. Never live commercial or
 * provider authority. Shared by the actual coordinator and workflow tests. */
import {
  MODEL_COMMERCIAL_POLICY_VERSION,
  type CreditNormalizationPolicyVersionV1,
  type ModelProviderPricingVersionV1,
  type ModelUsageUnitsV1,
} from "@cloudmarkup/domain";
import type {
  ModelCommercialAuthorizationDecisionV1,
  ModelCommercialInvocationAttemptV1,
  ModelCommercialInvocationResultV1,
  ModelCommercialOperationRequestV1,
  ModelCommercialRouteV1,
} from "./commercial-lifecycle.js";
export const requestedAt = "2026-08-21T12:00:00.000Z";
export const completedAt = "2026-08-21T12:00:01.000Z";

export const standardRoute: ModelCommercialRouteV1 = {
  explanation: "Fast default analysis for routine design tasks.",
  inferenceProfileId: "profile_standard",
  label: "Standard Design",
  modelId: "claude_sonnet",
  modelVersion: "sonnet_config_v1",
  providerKey: "provider_test",
  route: "standard",
  routeId: "route_standard",
};

export const deepRoute: ModelCommercialRouteV1 = {
  explanation: "Larger-context analysis for in-depth design and generation.",
  inferenceProfileId: "profile_deep",
  label: "Deep Design",
  modelId: "claude_opus",
  modelVersion: "opus_config_v1",
  providerKey: "provider_test",
  route: "deep",
  routeId: "route_deep",
};

export function modelKey(route: ModelCommercialRouteV1): string {
  return [
    route.providerKey,
    route.modelId,
    route.modelVersion,
    route.inferenceProfileId ?? "",
  ].join("|");
}

export function usage(input = 100, output = 20): ModelUsageUnitsV1 {
  return {
    cacheReadUnits: 10,
    cacheWriteUnits: 5,
    inputUnits: input,
    outputUnits: output,
    providerSpecificUnits: [],
    totalUnits: input + output + 15,
  };
}

export function pricingFor(
  route: ModelCommercialRouteV1,
  pricingVersionId: string,
  inputRate = 1_000_000,
): ModelProviderPricingVersionV1 {
  return {
    cacheReadMicrosPerMillionUnits: 500_000,
    cacheWriteMicrosPerMillionUnits: 2_000_000,
    currencyCode: "USD",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveUntil: null,
    environment: "test",
    inferenceProfileId: route.inferenceProfileId,
    inputMicrosPerMillionUnits: inputRate,
    modelId: route.modelId,
    modelVersion: route.modelVersion,
    outputMicrosPerMillionUnits: 1_000_000,
    pricingVersionId,
    providerKey: route.providerKey,
    providerSpecificUnitRates: [
      { microsPerMillionUnits: 3_000_000, unitName: "images" },
    ],
    status: "enabled",
    version: MODEL_COMMERCIAL_POLICY_VERSION,
  };
}

export const normalizationPolicy: CreditNormalizationPolicyVersionV1 = {
  creditUnitMicros: 100,
  currencyCode: "USD",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: null,
  normalizationPolicyVersionId: "normalization_test_v1",
  operatingBufferBasisPoints: 0,
  status: "enabled",
  version: MODEL_COMMERCIAL_POLICY_VERSION,
};

export function authorization(
  input: Partial<ModelCommercialAuthorizationDecisionV1> = {},
): ModelCommercialAuthorizationDecisionV1 {
  return {
    allowed: true,
    allowedModelKeys: [modelKey(standardRoute), modelKey(deepRoute)],
    allowedRouteIds: [standardRoute.routeId, deepRoute.routeId],
    approvedRoutes: [standardRoute, deepRoute],
    availableCreditUnits: 100,
    chargingPolicyVersion: "cloudmarkup-charging-and-failure-v1",
    commercialState: "active",
    denialReason: null,
    entitlementPolicyVersion: "cloudmarkup-entitlements-v1",
    evaluatedAt: requestedAt,
    featureEntitled: true,
    featureRequests: { current: 0, maximum: 100 },
    maximumInputUnits: 10_000,
    maximumOutputUnits: 10_000,
    organizationConcurrentReservations: { current: 0, maximum: 10 },
    organizationId: "org_one",
    organizationStatus: "active",
    perUserRequests: { current: 0, maximum: 100 },
    planVersionId: "plan_pro_v1",
    ...input,
  };
}

export function request(
  input: Partial<ModelCommercialOperationRequestV1> = {},
): ModelCommercialOperationRequestV1 {
  const route = input.requestedRoute === "deep" ? deepRoute : standardRoute;
  return {
    confirmationRequired: route.route === "deep",
    environment: "test",
    estimateAccepted: route.route !== "deep",
    eventIdPrefix: "usage_workflow_one",
    expiresAt: "2026-08-21T13:00:00.000Z",
    feature: "ai-assisted-operations",
    idempotencyKey: "idem_workflow_one",
    includeTechnicalUnitDetail: true,
    jobId: "job_one",
    multiCallWorkflowId: "workflow_one",
    organizationId: "org_one",
    plannedCalls: [
      {
        kind: "primary",
        maximumUsage: usage(150, 35),
        minimumUsage: usage(25, 5),
        routeId: route.routeId,
      },
    ],
    projectId: "project_one",
    promptId: "prompt_architecture",
    promptVersion: "prompt_architecture_v1",
    requestedAt,
    requestedMaximumInputUnits: 1_000,
    requestedMaximumOutputUnits: 500,
    requestedRoute: route.route,
    requestId: "request_one",
    reservationId: "reservation_one",
    templateId: null,
    templateVersion: null,
    userId: "user_one",
    ...input,
  };
}

export function primaryPlannedCall(
  value: ModelCommercialOperationRequestV1 = request(),
): ModelCommercialOperationRequestV1["plannedCalls"][number] {
  const plannedCall = value.plannedCalls[0];
  if (plannedCall === undefined) {
    throw new Error("Missing planned commercial call fixture.");
  }
  return plannedCall;
}

export function attempt(
  input: {
    readonly attemptKind?: ModelCommercialInvocationAttemptV1["attemptKind"];
    readonly attemptNumber?: number;
    readonly retryOfAttemptId?: string | null;
    readonly route?: ModelCommercialRouteV1;
    readonly status?: ModelCommercialInvocationAttemptV1["status"];
    readonly usage?: ModelUsageUnitsV1 | null;
    readonly mayHaveBeenProcessed?: boolean;
    readonly suffix?: string;
  } = {},
): ModelCommercialInvocationAttemptV1 {
  const route = input.route ?? standardRoute;
  const status = input.status ?? "succeeded";
  const suffix = input.suffix ?? "one";
  return {
    attemptId: "attempt_" + suffix,
    attemptKind: input.attemptKind ?? "primary",
    attemptNumber: input.attemptNumber ?? 1,
    callId: "call_" + suffix,
    completedAt,
    failureCategory:
      status === "succeeded"
        ? null
        : status === "timed-out"
          ? "provider-timeout"
          : status,
    inferenceProfileId: route.inferenceProfileId,
    invocationId: "invocation_" + suffix,
    latencyMilliseconds: 1_000,
    mayHaveBeenProcessed: input.mayHaveBeenProcessed ?? true,
    modelId: route.modelId,
    modelVersion: route.modelVersion,
    promptId: "prompt_architecture",
    promptVersion: "prompt_architecture_v1",
    providerKey: route.providerKey,
    providerRequestId: "provider_request_" + suffix,
    retryOfAttemptId: input.retryOfAttemptId ?? null,
    routeId: route.routeId,
    startedAt: requestedAt,
    status,
    usage: input.usage === undefined ? usage() : input.usage,
    usageRecordId: "usage_record_" + suffix,
  };
}

export function invocation(
  input: Partial<ModelCommercialInvocationResultV1> = {},
): ModelCommercialInvocationResultV1 {
  return {
    attempts: [attempt()],
    completedAt,
    failureCategory: null,
    resultId: "result_one",
    status: "completed",
    usefulOutputDelivered: true,
    ...input,
  };
}
