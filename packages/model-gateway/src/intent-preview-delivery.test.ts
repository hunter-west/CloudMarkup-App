import { describe, expect, it } from "vitest";
import type {
  ModelCommercialInvocationResultV1,
  ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";
import {
  intentPreviewCommercialOutcomeV1,
  intentPreviewGenerationEvidenceV1,
  parseIntentPreviewGenerationEvidenceV1,
} from "./intent-preview-delivery.js";

function fixture() {
  const startedAt = "2026-09-06T12:00:00.000Z";
  const completedAt = "2026-09-06T12:00:01.000Z";
  const usage = {
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    inputUnits: 20,
    outputUnits: 10,
    providerSpecificUnits: [],
    totalUnits: 30,
  };
  const request: ModelCommercialOperationRequestV1 = {
    confirmationRequired: false,
    environment: "test",
    estimateAccepted: true,
    eventIdPrefix: "event.synthetic.preview",
    expiresAt: "2026-09-06T12:05:00.000Z",
    feature: "intent.extract",
    idempotencyKey: "synthetic-preview-key",
    includeTechnicalUnitDetail: true,
    jobId: "preview.synthetic",
    multiCallWorkflowId: "workflow.synthetic",
    organizationId: "organization.synthetic",
    plannedCalls: [
      {
        kind: "primary",
        maximumUsage: usage,
        minimumUsage: usage,
        routeId: "route.synthetic.standard",
      },
    ],
    projectId: "project.synthetic",
    promptId: "prompt.synthetic.intent",
    promptVersion: "1.0.0",
    requestedAt: startedAt,
    requestedMaximumInputUnits: 20,
    requestedMaximumOutputUnits: 10,
    requestedRoute: "standard",
    requestId: "request.synthetic",
    reservationId: "reservation.synthetic",
    templateId: null,
    templateVersion: null,
    userId: "user.synthetic",
  };
  const result: ModelCommercialInvocationResultV1 = {
    attempts: [
      {
        attemptId: "attempt.synthetic",
        attemptKind: "primary",
        attemptNumber: 1,
        callId: "call.synthetic",
        completedAt,
        failureCategory: null,
        inferenceProfileId: "profile.synthetic",
        invocationId: "invocation.synthetic",
        latencyMilliseconds: 1000,
        mayHaveBeenProcessed: true,
        modelId: "model.synthetic",
        modelVersion: "1.0.0",
        promptId: request.promptId,
        promptVersion: request.promptVersion,
        providerKey: "provider.synthetic",
        providerRequestId: "provider.request.synthetic",
        retryOfAttemptId: null,
        routeId: "route.synthetic.standard",
        startedAt,
        status: "succeeded",
        usage,
        usageRecordId: "usage.synthetic",
      },
    ],
    completedAt,
    failureCategory: null,
    resultId: "result.synthetic",
    status: "completed",
    usefulOutputDelivered: true,
  };
  return { request, result };
}

describe("memory-only Intent generation versus delivery evidence", () => {
  it("records strict generation metadata without claiming customer delivery or carrying content", () => {
    const { request, result } = fixture();
    const generated = intentPreviewGenerationEvidenceV1(result, request);
    expect(Object.keys(generated).sort()).toEqual([
      "attempts",
      "completedAt",
      "failureCategory",
      "resultId",
      "status",
    ]);
    expect(generated).not.toHaveProperty("usefulOutputDelivered");
    expect(generated).not.toHaveProperty("preDispatchNoUsageAttestation");
    expect(generated).not.toHaveProperty("candidate");
    expect(parseIntentPreviewGenerationEvidenceV1(generated, request)).toEqual(
      generated,
    );
    expect(generated.attempts).not.toBe(result.attempts);
  });
  it("acknowledgement yields delivered success only with already known exact successful usage", () => {
    const { request, result } = fixture();
    const generation = intentPreviewGenerationEvidenceV1(result, request);
    expect(
      intentPreviewCommercialOutcomeV1({
        generation,
        request,
        delivery: "acknowledged",
      }),
    ).toEqual(result);
  });
  it("unconfirmed delivery selects the existing non-useful internal-failure customer outcome while preserving known provider usage", () => {
    const { request, result } = fixture();
    const generation = intentPreviewGenerationEvidenceV1(result, request);
    const outcome = intentPreviewCommercialOutcomeV1({
      generation,
      request,
      delivery: "unconfirmed",
    });
    expect(outcome).toEqual({
      ...result,
      status: "internal-failure",
      usefulOutputDelivered: false,
      failureCategory: "cloudmarkup.preview.delivery-unconfirmed",
    });
    expect(outcome.attempts[0]?.usage).toEqual(result.attempts[0]?.usage);
    expect(outcome.attempts[0]?.mayHaveBeenProcessed).toBe(true);
    expect(generation.status).toBe("completed");
  });
  it("does not manufacture provider usage or no-dispatch proof from a timeout or lost delivery", () => {
    const { request, result } = fixture();
    const attempt = result.attempts[0];
    if (attempt === undefined) throw new Error("Missing synthetic attempt.");
    const unknown = {
      ...result,
      attempts: [
        {
          ...attempt,
          status: "timed-out" as const,
          failureCategory: "provider-timeout",
          usage: null,
        },
      ],
      status: "internal-failure" as const,
      failureCategory: "provider-timeout",
      usefulOutputDelivered: false,
    };
    const generation = intentPreviewGenerationEvidenceV1(unknown, request);
    const outcome = intentPreviewCommercialOutcomeV1({
      generation,
      request,
      delivery: "unconfirmed",
    });
    expect(outcome).toEqual(unknown);
    expect(outcome.attempts[0]?.usage).toBeNull();
    expect(outcome.attempts[0]?.mayHaveBeenProcessed).toBe(true);
    expect(outcome).not.toHaveProperty("preDispatchNoUsageAttestation");
    expect(() =>
      intentPreviewCommercialOutcomeV1({
        generation,
        request,
        delivery: "acknowledged",
      }),
    ).toThrow();
  });
  it.each([
    "usefulOutputDelivered",
    "preDispatchNoUsageAttestation",
    "candidate",
    "prompt",
  ])("rejects a generation record carrying forbidden %s", (key) => {
    const { request, result } = fixture();
    const generation = intentPreviewGenerationEvidenceV1(result, request);
    expect(() =>
      parseIntentPreviewGenerationEvidenceV1(
        { ...generation, [key]: true },
        request,
      ),
    ).toThrow();
  });
  it.each([null, [], {}, "metadata"])(
    "rejects malformed generation metadata %s",
    (value) => {
      expect(() =>
        parseIntentPreviewGenerationEvidenceV1(value, fixture().request),
      ).toThrow();
    },
  );
  it("rejects missing required fields and nested content even when top-level keys are exact", () => {
    const { request, result } = fixture();
    const generation = intentPreviewGenerationEvidenceV1(result, request);
    const { failureCategory: ignored, ...missing } = generation;
    void ignored;
    expect(() =>
      parseIntentPreviewGenerationEvidenceV1(missing, request),
    ).toThrow();
    expect(() =>
      parseIntentPreviewGenerationEvidenceV1(
        {
          ...generation,
          attempts: generation.attempts.map((attempt) => ({
            ...attempt,
            response: "Synthetic candidate",
          })),
        },
        request,
      ),
    ).toThrow();
  });
  it("rejects other operations, Deep routes, extra planned calls and a repaired generation", () => {
    const { request, result } = fixture();
    const generation = intentPreviewGenerationEvidenceV1(result, request);
    for (const candidate of [
      { ...request, feature: "architecture.propose" },
      { ...request, requestedRoute: "deep" as const },
      {
        ...request,
        plannedCalls: [...request.plannedCalls, ...request.plannedCalls],
      },
      {
        ...request,
        plannedCalls: request.plannedCalls.map((call) => ({
          ...call,
          kind: "repair" as const,
        })),
      },
    ])
      expect(() =>
        parseIntentPreviewGenerationEvidenceV1(generation, candidate),
      ).toThrow();
    expect(() =>
      parseIntentPreviewGenerationEvidenceV1(
        {
          ...generation,
          attempts: [...generation.attempts, ...generation.attempts],
        },
        request,
      ),
    ).toThrow();
  });
});
