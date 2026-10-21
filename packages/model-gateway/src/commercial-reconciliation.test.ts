import { describe, expect, it } from "vitest";

import {
  MODEL_COMMERCIAL_LIFECYCLE_VERSION,
  type CanonicalModelUsageEventV1,
} from "./commercial-lifecycle.js";
import { InMemoryModelCommercialReconciliation } from "./commercial-reconciliation-fake.js";
import { InMemoryModelCommercialReconciliationSource } from "./commercial-reconciliation-source-fake.js";

function event(
  input: Partial<CanonicalModelUsageEventV1> = {},
): CanonicalModelUsageEventV1 {
  return {
    attempts: [],
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    chargedCreditUnits: 2,
    compensatedCreditUnits: 0,
    completedAt: "2026-08-21T12:00:01.000Z",
    environment: "test",
    estimatedProviderCostMicros: 150,
    eventId: "usage_one",
    failureCategory: null,
    feature: "ai-assisted-operations",
    idempotencyKey: "idem_one",
    inferenceProfileId: "profile_standard",
    inputUnits: 100,
    jobId: "job_one",
    latencyMilliseconds: 1_000,
    modelId: "claude_sonnet",
    modelVersion: "sonnet_config_v1",
    multiCallWorkflowId: "workflow_one",
    normalizationPolicyVersionId: "normalization_v1",
    occurredAt: "2026-08-21T12:00:01.000Z",
    organizationId: "org_one",
    outputUnits: 20,
    pricingVersionId: "pricing_standard_v1",
    projectId: "project_one",
    promptId: "prompt_one",
    promptVersion: "prompt_one_v1",
    providerKey: "provider_test",
    providerSpecificUnits: [],
    reconciliationState: "not-required",
    requestId: "request_one",
    reservationId: "reservation_one",
    reservedCreditUnits: 3,
    route: "standard",
    routeId: "route_standard",
    startedAt: "2026-08-21T12:00:00.000Z",
    status: "completed",
    templateId: null,
    templateVersion: null,
    totalUnits: 120,
    userId: "user_one",
    version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
    ...input,
  };
}

describe("model commercial reconciliation fake", () => {
  it("reconciles aggregate provider cost without changing customer credits", async () => {
    const source = new InMemoryModelCommercialReconciliationSource({
      events: [
        event(),
        event({
          eventId: "usage_two",
          idempotencyKey: "idem_two",
          organizationId: "org_two",
          estimatedProviderCostMicros: 50,
        }),
      ],
    });
    const reconciliation = new InMemoryModelCommercialReconciliation(source);

    await expect(
      reconciliation.reconcileProviderCostAggregate({
        currencyCode: "USD",
        periodEndsAt: "2026-08-22T00:00:00.000Z",
        periodStartsAt: "2026-08-21T00:00:00.000Z",
        providerKey: "provider_test",
        providerReportedCostMicros: 210,
      }),
    ).resolves.toEqual({
      currencyCode: "USD",
      differenceMicros: 10,
      estimatedLedgerCostMicros: 200,
      eventCount: 2,
      organizationCount: 2,
      providerKey: "provider_test",
      providerReportedCostMicros: 210,
      state: "difference-detected",
    });
  });

  it("finds missing usage and open or expired reservations", async () => {
    const source = new InMemoryModelCommercialReconciliationSource({
      events: [
        event({
          eventId: "usage_missing",
          idempotencyKey: "idem_missing",
          reconciliationState: "pending-missing-usage",
          status: "reconciliation-required",
        }),
      ],
      reservations: [
        {
          expiresAt: "2026-08-21T13:00:00.000Z",
          multiCallWorkflowId: "workflow_one",
          organizationId: "org_one",
          reservationId: "reservation_one",
          reservedCreditUnits: 3,
          status: "active",
        },
        {
          expiresAt: "2026-08-21T11:00:00.000Z",
          multiCallWorkflowId: "workflow_expired",
          organizationId: "org_one",
          reservationId: "reservation_expired",
          reservedCreditUnits: 4,
          status: "active",
        },
      ],
    });
    const reconciliation = new InMemoryModelCommercialReconciliation(source);

    await expect(
      reconciliation.findMissingUsage({ organizationId: "org_one" }),
    ).resolves.toEqual([
      {
        eventId: "usage_missing",
        multiCallWorkflowId: "workflow_one",
        organizationId: "org_one",
        reservationId: "reservation_one",
        state: "pending-missing-usage",
      },
    ]);
    await expect(
      reconciliation.findOpenReservations({
        asOf: "2026-08-21T12:00:00.000Z",
        organizationId: "org_one",
      }),
    ).resolves.toEqual([
      {
        expiresAt: "2026-08-21T13:00:00.000Z",
        multiCallWorkflowId: "workflow_one",
        organizationId: "org_one",
        reservationId: "reservation_one",
        reservedCreditUnits: 3,
        state: "open",
      },
      {
        expiresAt: "2026-08-21T11:00:00.000Z",
        multiCallWorkflowId: "workflow_expired",
        organizationId: "org_one",
        reservationId: "reservation_expired",
        reservedCreditUnits: 4,
        state: "expired-open",
      },
    ]);
  });

  it("reports by route/provider/model/feature/environment and detects outliers", async () => {
    const source = new InMemoryModelCommercialReconciliationSource({
      events: [
        event(),
        event({
          chargedCreditUnits: 3,
          compensatedCreditUnits: 2,
          environment: "production",
          estimatedProviderCostMicros: 500,
          eventId: "usage_deep",
          failureCategory: "estimate-overrun",
          idempotencyKey: "idem_deep",
          latencyMilliseconds: 5_000,
          modelId: "claude_opus",
          route: "deep",
          routeId: "route_deep",
          status: "compensated",
        }),
      ],
    });
    const reconciliation = new InMemoryModelCommercialReconciliation(source);

    const report = await reconciliation.reportUsage({
      dimensions: ["route", "provider", "model", "feature", "environment"],
      periodEndsAt: "2026-08-22T00:00:00.000Z",
      periodStartsAt: "2026-08-21T00:00:00.000Z",
    });
    expect(report).toHaveLength(2);
    expect(report[1]).toMatchObject({
      chargedCreditUnits: 3,
      compensatedCreditUnits: 2,
      environment: "production",
      estimatedProviderCostMicros: 500,
      eventCount: 1,
      modelId: "claude_opus",
      route: "deep",
    });

    await expect(
      reconciliation.findOutliers({
        maximumEstimatedProviderCostMicros: 300,
        maximumLatencyMilliseconds: 3_000,
      }),
    ).resolves.toEqual([
      {
        estimatedProviderCostMicros: 500,
        eventId: "usage_deep",
        latencyMilliseconds: 5_000,
        multiCallWorkflowId: "workflow_one",
        organizationId: "org_one",
        reasons: ["provider-cost", "latency", "credit-estimate-overrun"],
      },
    ]);
  });

  it("reconciles customer-credit compensation independently from provider cost", async () => {
    const source = new InMemoryModelCommercialReconciliationSource({
      events: [
        event({
          compensatedCreditUnits: 2,
          eventId: "usage_compensated",
          idempotencyKey: "idem_compensated",
          status: "compensated",
        }),
        event({
          compensatedCreditUnits: 3,
          eventId: "usage_pending",
          idempotencyKey: "idem_pending",
          reconciliationState: "pending-settlement",
          status: "compensated",
        }),
      ],
    });
    const reconciliation = new InMemoryModelCommercialReconciliation(source);
    await expect(
      reconciliation.reconcileCustomerCreditCompensation({}),
    ).resolves.toEqual({
      compensatedCreditUnits: 5,
      compensatedEventCount: 2,
      pendingEventCount: 1,
      state: "pending",
    });
  });
});
