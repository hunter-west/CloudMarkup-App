import {
  namespacedIdentifierSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type NormalizedModelUsageV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  InMemoryCanonicalModelCommercialAccounting,
  InMemoryModelCommercialAuthorization,
  InMemoryModelCommercialHostAttestations,
  InMemoryModelCommercialPricing,
  InMemoryModelCommercialScopeResolver,
  InMemoryModelCommercialWorkflowStore,
} from "./commercial-lifecycle-fakes.js";
import {
  ModelCommercialLifecycleCoordinator,
  type ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";
import {
  ModelIntentCommercialServiceV1,
  type IntentModelResultV1,
  type ModelUsageEvidenceSourceV1,
} from "./intent-commercial-service.js";
import type { ModelGateway, ModelGatewayInvocationContextV1 } from "./ports.js";
import { reviewedModelPromptRegistry } from "./prompts/registry.js";
import { sha256Text } from "./security.js";
import { modelTestRequests } from "./test-helpers.js";

const requestedAt = utcTimestampSchema.parse("2026-08-21T12:00:00.000Z");
const completedAt = utcTimestampSchema.parse("2026-08-21T12:00:00.100Z");
const providerId = namespacedIdentifierSchema.parse(
  "cloudmarkup.amazon-bedrock",
);
const modelId = namespacedIdentifierSchema.parse("configured.model.standard");
const modelVersion = "configured-standard-version";
const profileId = namespacedIdentifierSchema.parse(
  "configured.profile.standard",
);
const routeId = "standard-design";

function modelRequest() {
  const request = modelTestRequests().find(
    (candidate) => candidate.operation === "intent.extract",
  );
  if (request === undefined) throw new Error("missing Intent fixture");
  return request;
}

function commercialRequest(): ModelCommercialOperationRequestV1 {
  const prompt = reviewedModelPromptRegistry.get("intent.extract");
  if (prompt === null) throw new Error("missing prompt");
  const minimumUsage = {
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    inputUnits: 1,
    outputUnits: 1,
    providerSpecificUnits: [],
    totalUnits: 2,
  };
  const maximumUsage = {
    cacheReadUnits: 10,
    cacheWriteUnits: 10,
    inputUnits: 100,
    outputUnits: 50,
    providerSpecificUnits: [],
    totalUnits: 170,
  };
  return {
    confirmationRequired: false,
    environment: "test",
    estimateAccepted: true,
    eventIdPrefix: "event_intent_test",
    expiresAt: "2026-08-21T12:05:00.000Z",
    feature: "intent.extract",
    idempotencyKey: "idempotency_intent_test",
    includeTechnicalUnitDetail: true,
    jobId: "job_intent_test",
    multiCallWorkflowId: "workflow_intent_test",
    organizationId: "organization_intent_test",
    plannedCalls: [{ kind: "primary", maximumUsage, minimumUsage, routeId }],
    projectId: "project_intent_test",
    promptId: prompt.templateId,
    promptVersion: prompt.version,
    requestedAt,
    requestedMaximumInputUnits: 100,
    requestedMaximumOutputUnits: 50,
    requestedRoute: "standard",
    requestId: "request_intent_test",
    reservationId: "reservation_intent_test",
    templateId: null,
    templateVersion: null,
    userId: "user_intent_test",
  };
}

function context(): ModelGatewayInvocationContextV1 {
  return {
    budget: {
      acceptedEstimateMaximumCreditUnits: 100,
      allowed: true,
      availableCreditUnits: 100,
      decisionId: "budget_intent_test",
      estimateAccepted: true,
      maximumCostTier: "standard",
    },
    complexity: "standard",
    entitlement: {
      allowed: true,
      allowedRoles: [
        "low-cost-extraction-help",
        "standard-planning-generation",
      ],
      decisionId: "entitlement_intent_test",
      planKey: "pro",
      planVersionId: "plan_intent_test",
    },
    evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
    evaluationPolicyVersion: "1.0.0",
    idempotencyKeyDigest: sha256Text("intent-idempotency"),
    invocationId: "invocation_intent_test",
    requestedMode: "guided",
    routingDecision: {
      feature: "intent.extract",
      inferenceProfileId: profileId,
      modelId,
      modelVersion,
      outcome: "selected",
      providerId,
      requestedMode: "guided",
      routeId,
    } as never,
    routingRequest: {} as never,
    scope: {
      jobId: "job_intent_test",
      organizationId: "organization_intent_test",
      projectId: "project_intent_test",
      userId: "user_intent_test",
    },
  };
}

function authorization(availableCreditUnits = 100) {
  return {
    allowed: true,
    allowedModelKeys: [`${providerId}|${modelId}|${modelVersion}|${profileId}`],
    allowedRouteIds: [routeId],
    approvedRoutes: [
      {
        explanation: "Configured Standard analysis.",
        inferenceProfileId: profileId,
        label: "Standard Design" as const,
        modelId,
        modelVersion,
        providerKey: providerId,
        route: "standard" as const,
        routeId,
      },
    ],
    availableCreditUnits,
    chargingPolicyVersion: "charging.v1",
    commercialState: "active" as const,
    denialReason: null,
    entitlementPolicyVersion: "entitlement.v1",
    evaluatedAt: requestedAt,
    featureEntitled: true,
    featureRequests: { current: 0, maximum: 10 },
    maximumInputUnits: 1_000,
    maximumOutputUnits: 1_000,
    organizationConcurrentReservations: { current: 0, maximum: 10 },
    organizationId: "organization_intent_test",
    organizationStatus: "active" as const,
    perUserRequests: { current: 0, maximum: 10 },
    planVersionId: "plan_intent_test",
  };
}

function usage(): NormalizedModelUsageV1 {
  const request = commercialRequest();
  return {
    attemptNumber: 1,
    cacheReadUnits: "2",
    cacheWriteUnits: "1",
    completedAt,
    contractVersion: 1,
    durationMilliseconds: 100,
    feature: "intent.extract",
    idempotencyKeyDigest: sha256Text("intent-idempotency"),
    inferenceProfileId: profileId,
    inputDigest: sha256Text("intent-input"),
    inputUnits: "10",
    invocationId: "invocation_intent_test" as never,
    modelId,
    modelVersion,
    outputUnits: "5",
    promptTemplateId: request.promptId as never,
    promptVersion: request.promptVersion as never,
    providerId,
    providerRequestId: "provider-request-intent-test",
    result: "succeeded",
    routing: { routeId } as never,
    scope: context().scope,
    startedAt: requestedAt,
    thinkingUnits: "0",
    usageRecordId: solutionStableIdSchema.parse("model_usage_intent_test"),
  };
}

function harness(
  input: {
    readonly availableCredits?: number;
    readonly gatewayErrorCode?: string;
    readonly gatewaySafeErrorCode?: string;
    readonly usage?: readonly NormalizedModelUsageV1[];
  } = {},
) {
  const accounting = new InMemoryCanonicalModelCommercialAccounting({
    organization_intent_test: input.availableCredits ?? 100,
  });
  const commercial = new ModelCommercialLifecycleCoordinator({
    accounting,
    attestations: new InMemoryModelCommercialHostAttestations(),
    authorization: new InMemoryModelCommercialAuthorization(
      authorization(input.availableCredits ?? 100),
    ),
    now: () => requestedAt,
    pricing: new InMemoryModelCommercialPricing({
      policies: [
        {
          creditUnitMicros: 1_000,
          currencyCode: "USD",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          effectiveUntil: "2027-01-01T00:00:00.000Z",
          normalizationPolicyVersionId: "normalization_intent_2026",
          operatingBufferBasisPoints: 1_000,
          status: "enabled",
          version: 1,
        },
      ],
      pricing: [
        {
          cacheReadMicrosPerMillionUnits: 100,
          cacheWriteMicrosPerMillionUnits: 100,
          currencyCode: "USD",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          effectiveUntil: "2027-01-01T00:00:00.000Z",
          environment: "test",
          inferenceProfileId: profileId,
          inputMicrosPerMillionUnits: 1_000,
          modelId,
          modelVersion,
          outputMicrosPerMillionUnits: 2_000,
          pricingVersionId: "pricing_intent_2026",
          providerKey: providerId,
          providerSpecificUnitRates: [],
          status: "enabled",
          version: 1,
        },
      ],
    }),
    scopeResolver: new InMemoryModelCommercialScopeResolver(),
    workflows: new InMemoryModelCommercialWorkflowStore(),
  });
  let completedResult: IntentModelResultV1 | null = null;
  const invoke = vi.fn(() => {
    expect(
      accounting.getReservationStatus(
        commercialRequest(),
        "reservation_intent_test",
      ),
    ).toBe("active");
    if (input.gatewayErrorCode !== undefined)
      throw Object.assign(new Error("safe"), { code: input.gatewayErrorCode });
    if (input.gatewaySafeErrorCode !== undefined)
      throw Object.assign(new Error("safe"), {
        safeCode: input.gatewaySafeErrorCode,
      });
    completedResult = {
      descriptor: {} as never,
      redaction: { categories: [], redactedValueCount: 0 },
      response: {} as never,
      usage: {} as never,
    } satisfies IntentModelResultV1;
    return Promise.resolve(completedResult);
  });
  const gateway = { invoke } as unknown as ModelGateway;
  const usageEvidence: ModelUsageEvidenceSourceV1 = {
    listByInvocationId: () => Promise.resolve(input.usage ?? [usage()]),
  };
  return {
    accounting,
    invoke,
    service: new ModelIntentCommercialServiceV1({
      clock: { now: () => new Date(completedAt) },
      commercial,
      gateway,
      resultEvidence: {
        loadCompleted: () => Promise.resolve(completedResult),
      },
      usageEvidence,
    }),
  };
}

describe("Prompt 34A Intent commercial orchestration", () => {
  it("reserves before invocation, settles normalized usage, and replays without another call", async () => {
    const current = harness();
    const first = await current.service.execute(
      commercialRequest(),
      modelRequest(),
      context(),
    );
    expect(first.commercial.state).toBe("completed");
    expect(current.invoke).toHaveBeenCalledTimes(1);
    expect(
      current.accounting.getReservationStatus(
        commercialRequest(),
        "reservation_intent_test",
      ),
    ).toBe("settled");
    const second = await current.service.execute(
      commercialRequest(),
      modelRequest(),
      context(),
    );
    expect(second.commercial).toEqual(first.commercial);
    expect(second.modelResult).toEqual(first.modelResult);
    expect(current.invoke).toHaveBeenCalledTimes(1);
  });

  it("hard-denies insufficient credits before any provider invocation", async () => {
    const current = harness({ availableCredits: 0 });
    const result = await current.service.execute(
      commercialRequest(),
      modelRequest(),
      context(),
    );
    expect(result.commercial.denialReason).toBe("insufficient-credits");
    expect(current.invoke).not.toHaveBeenCalled();
  });

  it("marks timeout with missing usage for reconciliation instead of assuming it is free", async () => {
    const current = harness({
      gatewayErrorCode: "model-provider.timeout",
      usage: [],
    });
    const result = await current.service.execute(
      commercialRequest(),
      modelRequest(),
      context(),
    );
    expect(result.commercial.state).toBe("reconciliation-required");
    expect(result.commercial.reconciliationState).toBe("pending-missing-usage");
    expect(current.accounting.events.at(-1)).toMatchObject({
      failureCategory: "model-provider.timeout",
      status: "reconciliation-required",
    });
  });

  it("preserves an adapter safeCode and reconciles unknown timed-out usage", async () => {
    const current = harness({
      gatewaySafeErrorCode: "model-provider.timeout",
      usage: [],
    });
    const result = await current.service.execute(
      commercialRequest(),
      modelRequest(),
      context(),
    );
    expect(result.commercial.state).toBe("reconciliation-required");
    expect(current.accounting.events.at(-1)).toMatchObject({
      failureCategory: "model-provider.timeout",
    });
  });
});
