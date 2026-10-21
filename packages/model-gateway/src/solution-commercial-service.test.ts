import { describe, expect, it } from "vitest";

import {
  MODEL_COMMERCIAL_POLICY_VERSION,
  type CreditNormalizationPolicyVersionV1,
  type ModelProviderPricingVersionV1,
} from "@cloudmarkup/domain";
import { modelRoutingDecisionV1Schema } from "@cloudmarkup/schemas";

import {
  ModelCommercialLifecycleCoordinator,
  type ModelCommercialAuthorizationDecisionV1,
  type ModelCommercialOperationRequestV1,
  type ModelCommercialRouteV1,
} from "./commercial-lifecycle.js";
import {
  InMemoryCanonicalModelCommercialAccounting,
  InMemoryModelCommercialAuthorization,
  InMemoryModelCommercialHostAttestations,
  InMemoryModelCommercialPricing,
  InMemoryModelCommercialScopeResolver,
  InMemoryModelCommercialWorkflowStore,
} from "./commercial-lifecycle-fakes.js";
import { reviewedModelPromptRegistry } from "./prompts/registry.js";
import {
  InMemorySolutionPlanningResultEvidenceStoreV1,
  ModelSolutionCommercialServiceV1,
  type SolutionPlanningExecutionPortV1,
} from "./solution-commercial-service.js";
import type { SolutionProposalPlannerResultV1 } from "./solution-planner.js";
import {
  modelTestContext,
  modelTestRequests,
  modelTestRoutingDecision,
  modelTestRoutingRequest,
  testSolutionRevision,
} from "./test-helpers.js";

const requestedAt = "2026-08-22T12:00:00.000Z";

function operationRequest() {
  const request = modelTestRequests().find(
    (candidate) => candidate.operation === "operations.propose",
  );
  if (request === undefined) {
    throw new Error("Missing operations request.");
  }
  return request;
}

function planningRequest() {
  const modelRequest = operationRequest();
  const baseContext = modelTestContext("invocation_commercial_solution");
  const routingRequest = modelTestRoutingRequest(modelRequest, baseContext);
  const routingDecision = modelRoutingDecisionV1Schema.parse({
    ...modelTestRoutingDecision(routingRequest),
    feature: "operations.propose",
  });
  return {
    createdAt: requestedAt,
    gatewayContext: {
      ...baseContext,
      routingDecision,
      routingRequest,
    },
    maximumRepairAttempts: 0 as const,
    modelRequest,
    solutionRevisionId: testSolutionRevision.solutionRevisionId,
    validationEnvironment: "development" as const,
  };
}

function route(): ModelCommercialRouteV1 {
  const decision = planningRequest().gatewayContext.routingDecision;
  if (decision.outcome !== "selected") throw new Error("Missing test route.");
  return {
    explanation: "Fast default analysis for routine design tasks.",
    inferenceProfileId: decision.inferenceProfileId,
    label: "Standard Design",
    modelId: decision.modelId,
    modelVersion: decision.modelVersion,
    providerKey: decision.providerId,
    route: "standard",
    routeId: decision.routeId,
  };
}

function modelKey(value: ModelCommercialRouteV1): string {
  return [
    value.providerKey,
    value.modelId,
    value.modelVersion,
    value.inferenceProfileId ?? "",
  ].join("|");
}

function authorization(allowed = true): ModelCommercialAuthorizationDecisionV1 {
  const approvedRoute = route();
  return {
    allowed,
    allowedModelKeys: [modelKey(approvedRoute)],
    allowedRouteIds: [approvedRoute.routeId],
    approvedRoutes: [approvedRoute],
    availableCreditUnits: allowed ? 100 : 0,
    chargingPolicyVersion: "cloudmarkup-charging-and-failure-v1",
    commercialState: "active",
    denialReason: allowed ? null : "insufficient-credits",
    entitlementPolicyVersion: "cloudmarkup-entitlements-v1",
    evaluatedAt: requestedAt,
    featureEntitled: allowed,
    featureRequests: { current: 0, maximum: 100 },
    maximumInputUnits: 10_000,
    maximumOutputUnits: 10_000,
    organizationConcurrentReservations: { current: 0, maximum: 10 },
    organizationId: "organization_test",
    organizationStatus: "active",
    perUserRequests: { current: 0, maximum: 100 },
    planVersionId: "plan_pro_v1",
  };
}

const normalizationPolicy: CreditNormalizationPolicyVersionV1 = {
  creditUnitMicros: 100,
  currencyCode: "USD",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: null,
  normalizationPolicyVersionId: "normalization_assistant_v1",
  operatingBufferBasisPoints: 0,
  status: "enabled",
  version: MODEL_COMMERCIAL_POLICY_VERSION,
};

function pricing(): ModelProviderPricingVersionV1 {
  const approvedRoute = route();
  return {
    cacheReadMicrosPerMillionUnits: 500_000,
    cacheWriteMicrosPerMillionUnits: 2_000_000,
    currencyCode: "USD",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveUntil: null,
    environment: "test",
    inferenceProfileId: approvedRoute.inferenceProfileId,
    inputMicrosPerMillionUnits: 1_000_000,
    modelId: approvedRoute.modelId,
    modelVersion: approvedRoute.modelVersion,
    outputMicrosPerMillionUnits: 1_000_000,
    pricingVersionId: "pricing_assistant_v1",
    providerKey: approvedRoute.providerKey,
    providerSpecificUnitRates: [],
    status: "enabled",
    version: MODEL_COMMERCIAL_POLICY_VERSION,
  };
}

function commercialRequest(): ModelCommercialOperationRequestV1 {
  const prompt = reviewedModelPromptRegistry.get("operations.propose");
  if (prompt === null) throw new Error("Missing reviewed prompt.");
  const maximumUsage = {
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    inputUnits: 1_000,
    outputUnits: 500,
    providerSpecificUnits: [],
    totalUnits: 1_500,
  };
  return {
    confirmationRequired: false,
    environment: "test",
    estimateAccepted: true,
    eventIdPrefix: "assistant_commercial_event",
    expiresAt: "2026-08-22T13:00:00.000Z",
    feature: "operations.propose",
    idempotencyKey: "assistant_commercial_idempotency",
    includeTechnicalUnitDetail: true,
    jobId: "job_test",
    multiCallWorkflowId: "assistant_commercial_workflow",
    organizationId: "organization_test",
    plannedCalls: [
      {
        kind: "primary",
        maximumUsage,
        minimumUsage: {
          ...maximumUsage,
          inputUnits: 1,
          outputUnits: 1,
          totalUnits: 2,
        },
        routeId: "standard-design",
      },
    ],
    projectId: "project_test",
    promptId: prompt.templateId,
    promptVersion: prompt.version,
    requestedAt,
    requestedMaximumInputUnits: 1_000,
    requestedMaximumOutputUnits: 500,
    requestedRoute: "standard",
    requestId: "assistant_commercial_request",
    reservationId: "assistant_commercial_reservation",
    templateId: null,
    templateVersion: null,
    userId: "user_test",
  };
}

class RejectedPlanner implements SolutionPlanningExecutionPortV1 {
  public calls = 0;

  public propose(): Promise<SolutionProposalPlannerResultV1> {
    this.calls += 1;
    return Promise.resolve({
      attempts: 1,
      contractVersion: 1,
      diagnostics: [
        {
          code: "cloudmarkup.solution-planner.invalid-proposal",
          message: "The proposal was rejected deterministically.",
          path: "$.batches[0]",
        },
      ],
      disposition: "rejected",
      writeAuthority: "none",
    });
  }
}

function harness(allowed = true) {
  const accounting = new InMemoryCanonicalModelCommercialAccounting({
    organization_test: 100,
  });
  const planner = new RejectedPlanner();
  const coordinator = new ModelCommercialLifecycleCoordinator({
    accounting,
    attestations: new InMemoryModelCommercialHostAttestations(),
    authorization: new InMemoryModelCommercialAuthorization(
      authorization(allowed),
    ),
    now: () => requestedAt,
    pricing: new InMemoryModelCommercialPricing({
      policies: [normalizationPolicy],
      pricing: [pricing()],
    }),
    scopeResolver: new InMemoryModelCommercialScopeResolver(),
    workflows: new InMemoryModelCommercialWorkflowStore(),
  });
  return {
    accounting,
    planner,
    service: new ModelSolutionCommercialServiceV1({
      commercial: coordinator,
      planner,
      resultEvidence: new InMemorySolutionPlanningResultEvidenceStoreV1(),
      usageEvidence: {
        listByMultiCallWorkflowId: () => Promise.resolve([]),
      },
    }),
  };
}

describe("ModelSolutionCommercialServiceV1", () => {
  it("does not call planning when entitlement or credits deny reservation", async () => {
    const test = harness(false);
    const result = await test.service.execute(
      commercialRequest(),
      planningRequest(),
    );

    expect(result.commercial.state).toBe("denied");
    expect(result.plannerResult).toBeNull();
    expect(result.issues[0]).toMatchObject({
      category: "commercial-denial",
      severity: "blocking",
    });
    expect(test.planner.calls).toBe(0);
    expect(test.accounting.events).toHaveLength(0);
  });

  it("reconciles a rejected proposal without usage and replays without another model call", async () => {
    const test = harness();
    const request = commercialRequest();
    const planning = planningRequest();
    const first = await test.service.execute(request, planning);
    const duplicate = await test.service.execute(request, planning);

    expect(first.plannerResult?.disposition).toBe("rejected");
    expect(first.commercial).toMatchObject({
      reconciliationState: "pending-missing-usage",
      state: "reconciliation-required",
    });
    expect(duplicate).toEqual(first);
    expect(test.planner.calls).toBe(1);
    expect(test.accounting.events).toHaveLength(2);
    expect(test.accounting.events.at(-1)).toMatchObject({
      chargedCreditUnits: 0,
      failureCategory: "cloudmarkup.solution-planner.rejected",
      status: "reconciliation-required",
    });
  });
});
