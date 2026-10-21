import { describe, expect, it } from "vitest";

import {
  canonicalModelCommercialUsageEventV1Schema,
  creditNormalizationPolicyVersionV1Schema,
  modelCommercialLifecycleResponseV1Schema,
  modelProviderPricingVersionV1Schema,
  modelUsageSummaryV1Schema,
} from "./model-commercial-lifecycle.js";

describe("Prompt 34A model commercial API contracts", () => {
  it("accepts a safe completed lifecycle response without pricing internals", () => {
    const parsed = modelCommercialLifecycleResponseV1Schema.parse({
      compensationStatus: "not-required",
      completedCreditUnits: 2,
      contractVersion: 1,
      denialReason: null,
      estimate: {
        maximumCreditUnits: 4,
        minimumCreditUnits: 1,
        requiresConfirmation: false,
      },
      reconciliationState: "not-required",
      reservation: {
        reservationId: "reservation_one",
        status: "accepted",
      },
      route: {
        explanation: "Fast default analysis for routine design tasks.",
        label: "Standard Design",
        route: "standard",
      },
      state: "completed",
      technicalUnits: {
        cacheReadUnits: 10,
        cacheWriteUnits: 5,
        inputUnits: 100,
        outputUnits: 20,
        providerSpecificUnits: [],
        totalUnits: 135,
      },
    });
    expect(parsed.completedCreditUnits).toBe(2);
    expect(parsed).not.toHaveProperty("estimatedProviderCostMicros");
    expect(parsed).not.toHaveProperty("operatingBufferBasisPoints");
    expect(parsed).not.toHaveProperty("creditUnitMicros");
  });

  it("requires a confirmed estimate state to carry a stable denial reason", () => {
    expect(
      modelCommercialLifecycleResponseV1Schema.safeParse({
        compensationStatus: "not-required",
        completedCreditUnits: null,
        contractVersion: 1,
        denialReason: null,
        estimate: {
          maximumCreditUnits: 4,
          minimumCreditUnits: 1,
          requiresConfirmation: true,
        },
        reconciliationState: "not-required",
        reservation: { status: "not-requested" },
        route: {
          explanation: "In-depth design and generation analysis.",
          label: "Deep Design",
          route: "deep",
        },
        state: "estimate-confirmation-required",
        technicalUnits: null,
      }).success,
    ).toBe(false);
  });

  it("records full technical usage provenance and rejects raw content", () => {
    const technicalEvent = {
      attempts: [
        {
          attemptId: "attempt_one",
          attemptKind: "primary",
          attemptNumber: 1,
          callId: "call_one",
          completedAt: "2026-08-21T12:00:01.000Z",
          estimatedProviderCostMicros: "135",
          failureCategory: null,
          inferenceProfileId: "profile_standard",
          invocationId: "invocation_one",
          latencyMilliseconds: 1_000,
          mayHaveBeenProcessed: true,
          modelId: "claude_sonnet",
          modelVersion: "sonnet_config_v1",
          normalizationPolicyVersionId: "normalization_v1",
          pricingVersionId: "pricing_standard_v1",
          promptId: "prompt_architecture",
          promptVersion: "prompt_architecture_v1",
          providerKey: "provider-test",
          providerRequestId: "provider_request_one",
          retryOfAttemptId: null,
          routeId: "route_standard",
          startedAt: "2026-08-21T12:00:00.000Z",
          status: "succeeded",
          usage: {
            cacheReadUnits: 10,
            cacheWriteUnits: 5,
            inputUnits: 100,
            outputUnits: 20,
            providerSpecificUnits: [],
            totalUnits: 135,
          },
          usageRecordId: "usage_record_one",
        },
      ],
      chargedCreditUnits: 2,
      compensatedCreditUnits: 0,
      completedAt: "2026-08-21T12:00:01.000Z",
      contractVersion: 1,
      environment: "test",
      estimatedProviderCostMicros: "135",
      eventId: "usage_one",
      failureCategory: null,
      feature: "ai-assisted-operations",
      idempotencyKey: "idem_one",
      inferenceProfileId: "profile_standard",
      jobId: "job_one",
      modelId: "claude_sonnet",
      modelVersion: "sonnet_config_v1",
      multiCallWorkflowId: "workflow_one",
      normalizationPolicyVersionId: "normalization_v1",
      occurredAt: "2026-08-21T12:00:01.000Z",
      organizationId: "org_one",
      pricingVersionId: "pricing_standard_v1",
      projectId: "project_one",
      promptId: "prompt_architecture",
      promptVersion: "prompt_architecture_v1",
      providerKey: "provider-test",
      reconciliationState: "not-required",
      requestId: "request_one",
      reservationId: "reservation_one",
      reservedCreditUnits: 4,
      route: "standard",
      routeId: "route_standard",
      status: "completed",
      technicalUnits: {
        cacheReadUnits: 10,
        cacheWriteUnits: 5,
        inputUnits: 100,
        outputUnits: 20,
        providerSpecificUnits: [],
        totalUnits: 135,
      },
      templateId: null,
      templateVersion: null,
      userId: "principal_one",
    };
    expect(
      canonicalModelCommercialUsageEventV1Schema.safeParse(technicalEvent)
        .success,
    ).toBe(true);
    expect(
      canonicalModelCommercialUsageEventV1Schema.safeParse({
        ...technicalEvent,
        rawPrompt: "secret customer prompt",
      }).success,
    ).toBe(false);
    expect(
      canonicalModelCommercialUsageEventV1Schema.safeParse({
        ...technicalEvent,
        rawResponse: "secret provider response",
      }).success,
    ).toBe(false);
  });

  it("keeps pricing and normalization as separate versioned internal contracts", () => {
    expect(
      modelProviderPricingVersionV1Schema.safeParse({
        cacheReadMicrosPerMillionUnits: "500000",
        cacheWriteMicrosPerMillionUnits: "2000000",
        contractVersion: 1,
        currencyCode: "USD",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveUntil: null,
        environment: "test",
        inferenceProfileId: "profile_standard",
        inputMicrosPerMillionUnits: "1000000",
        modelId: "claude_sonnet",
        modelVersion: "sonnet_config_v1",
        outputMicrosPerMillionUnits: "1000000",
        pricingVersionId: "pricing_standard_v1",
        providerKey: "provider-test",
        providerSpecificUnitRates: [
          {
            microsPerMillionUnits: "3000000",
            unitName: "request-unit",
          },
        ],
        status: "disabled-pricing-unavailable",
      }).success,
    ).toBe(true);
    expect(
      creditNormalizationPolicyVersionV1Schema.safeParse({
        contractVersion: 1,
        creditUnitMicros: "0",
        currencyCode: "USD",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveUntil: null,
        normalizationPolicyVersionId: "normalization_v1",
        operatingBufferBasisPoints: 1_000,
        status: "enabled",
      }).success,
    ).toBe(false);
  });

  it("exposes safe usage summaries without provider cost or conversion policy", () => {
    const summary = modelUsageSummaryV1Schema.parse({
      asOf: "2026-08-21T13:00:00.000Z",
      contractVersion: 1,
      organizationId: "org_one",
      periodEndsAt: "2026-08-21T13:00:00.000Z",
      periodStartsAt: "2026-08-21T12:00:00.000Z",
      rows: [
        {
          chargedCreditUnits: 2,
          compensatedCreditUnits: 0,
          environment: "test",
          eventCount: 1,
          feature: "ai-assisted-operations",
          requestCount: 1,
          route: "standard",
        },
      ],
    });
    expect(JSON.stringify(summary)).not.toMatch(
      /estimatedProviderCost|operatingBuffer|creditUnitMicros/u,
    );

    for (const [field, value] of [
      ["estimatedProviderCostMicros", "1"],
      ["operatingBufferBasisPoints", 1_000],
      ["creditUnitMicros", "1"],
    ] as const) {
      expect(
        modelUsageSummaryV1Schema.safeParse({ ...summary, [field]: value })
          .success,
      ).toBe(false);
      expect(
        modelUsageSummaryV1Schema.safeParse({
          ...summary,
          rows: summary.rows.map((row) => ({ ...row, [field]: value })),
        }).success,
      ).toBe(false);
    }
  });
});
