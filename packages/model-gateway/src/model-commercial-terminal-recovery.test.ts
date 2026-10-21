import { describe, expect, it } from "vitest";

import {
  MODEL_COMMERCIAL_POLICY_VERSION,
  type CreditNormalizationPolicyVersionV1,
  type ModelProviderPricingVersionV1,
  type ModelUsageUnitsV1,
} from "@cloudmarkup/domain";

import {
  ModelCommercialLifecycleCoordinator,
  ModelLiveCommercialLifecycleCoordinatorV2,
  type ModelCommercialDispatchIntentV1,
  projectModelCommercialRecoveredInvocationRecordV1,
  projectModelCommercialTerminalOutcomeV1,
  type ModelCommercialAuthorizationDecisionV1,
  type ModelCommercialInvocationAttemptV1,
  type ModelCommercialInvocationContextV1,
  type ModelCommercialInvocationResultV1,
  type ModelCommercialOperationRequestV1,
  type ModelCommercialRouteV1,
  type ModelCommercialWorkflowRecordV1,
} from "./commercial-lifecycle.js";
import {
  InMemoryCanonicalModelCommercialAccounting,
  InMemoryModelCommercialAuthorization,
  InMemoryModelCommercialHostAttestations,
  InMemoryModelCommercialPricing,
  InMemoryModelCommercialScopeResolver,
  InMemoryModelCommercialWorkflowStore,
} from "./commercial-lifecycle-fakes.js";
import { parseModelCommercialVerifiedTerminalV1 } from "./model-commercial-terminal-recovery.js";
import { digestStructuredValue, sha256Text } from "./security.js";
import { parseModelLiveCommercialVerifiedTerminalV2 } from "./model-live-commercial-terminal-recovery.js";
import { syntheticLiveEvaluationFixtureV2 } from "./model-live-evaluation-fakes.js";
import { parseModelLiveCommercialInvocationEvidenceV2 } from "./model-live-invocation-recovery.js";
import { modelLiveRuntimeAdmissionRequestV2Schema } from "@cloudmarkup/schemas";

const requestedAt = "2026-08-21T12:00:00.000Z";
const completedAt = "2026-08-21T12:00:01.000Z";
const route: ModelCommercialRouteV1 = {
  explanation: "Standard analysis for the synthetic recovery fixture.",
  inferenceProfileId: "profile_standard",
  label: "Standard Design",
  modelId: "model_standard",
  modelVersion: "model_v1",
  providerKey: "provider_test",
  route: "standard",
  routeId: "route_standard",
};
const normalization: CreditNormalizationPolicyVersionV1 = {
  creditUnitMicros: 100,
  currencyCode: "USD",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: null,
  normalizationPolicyVersionId: "normalization_test_v1",
  operatingBufferBasisPoints: 0,
  status: "enabled",
  version: MODEL_COMMERCIAL_POLICY_VERSION,
};
const pricing: ModelProviderPricingVersionV1 = {
  cacheReadMicrosPerMillionUnits: 500_000,
  cacheWriteMicrosPerMillionUnits: 2_000_000,
  currencyCode: "USD",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: null,
  environment: "test",
  inferenceProfileId: route.inferenceProfileId,
  inputMicrosPerMillionUnits: 1_000_000,
  modelId: route.modelId,
  modelVersion: route.modelVersion,
  outputMicrosPerMillionUnits: 1_000_000,
  pricingVersionId: "pricing_standard_v1",
  providerKey: route.providerKey,
  providerSpecificUnitRates: [],
  status: "enabled",
  version: MODEL_COMMERCIAL_POLICY_VERSION,
};

function requireFixture<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("Expected complete coordinator-produced test evidence.");
  }
  return value;
}

function usage(input = 100, output = 20): ModelUsageUnitsV1 {
  return {
    cacheReadUnits: 10,
    cacheWriteUnits: 5,
    inputUnits: input,
    outputUnits: output,
    providerSpecificUnits: [],
    totalUnits: input + output + 15,
  };
}

function request(): ModelCommercialOperationRequestV1 {
  return {
    confirmationRequired: false,
    environment: "test",
    estimateAccepted: true,
    eventIdPrefix: "usage_workflow_one",
    expiresAt: "2026-08-21T13:00:00.000Z",
    feature: "intent.extract",
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
    promptId: "prompt_intent",
    promptVersion: "prompt_intent_v1",
    requestedAt,
    requestedMaximumInputUnits: 1_000,
    requestedMaximumOutputUnits: 500,
    requestedRoute: route.route,
    requestId: "request_one",
    reservationId: "reservation_one",
    templateId: "template_one",
    templateVersion: "template_v1",
    userId: "user_one",
  };
}

function authorization(): ModelCommercialAuthorizationDecisionV1 {
  return {
    allowed: true,
    allowedModelKeys: [
      [
        route.providerKey,
        route.modelId,
        route.modelVersion,
        route.inferenceProfileId ?? "",
      ].join("|"),
    ],
    allowedRouteIds: [route.routeId],
    approvedRoutes: [route],
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
  };
}

function attempt(
  changes: Partial<ModelCommercialInvocationAttemptV1> = {},
): ModelCommercialInvocationAttemptV1 {
  return {
    attemptId: "attempt_one",
    attemptKind: "primary",
    attemptNumber: 1,
    callId: "call_one",
    completedAt,
    failureCategory: null,
    inferenceProfileId: route.inferenceProfileId,
    invocationId: "invocation_one",
    latencyMilliseconds: 1_000,
    mayHaveBeenProcessed: true,
    modelId: route.modelId,
    modelVersion: route.modelVersion,
    promptId: "prompt_intent",
    promptVersion: "prompt_intent_v1",
    providerKey: route.providerKey,
    providerRequestId: "provider_request_one",
    retryOfAttemptId: null,
    routeId: route.routeId,
    startedAt: requestedAt,
    status: "succeeded",
    usage: usage(),
    usageRecordId: "usage_record_one",
    ...changes,
  };
}

function invocation(
  changes: Partial<ModelCommercialInvocationResultV1> = {},
): ModelCommercialInvocationResultV1 {
  return {
    attempts: [attempt()],
    completedAt,
    failureCategory: null,
    resultId: "result_one",
    status: "completed",
    usefulOutputDelivered: true,
    ...changes,
  };
}

async function runCoordinator(
  result:
    | ModelCommercialInvocationResultV1
    | ((
        context: ModelCommercialInvocationContextV1,
      ) => ModelCommercialInvocationResultV1) = invocation(),
  operation = request(),
  providerPricing = pricing,
  commercialAuthorization = authorization(),
) {
  let now = requestedAt;
  const accounting = new InMemoryCanonicalModelCommercialAccounting({
    org_one: 100,
  });
  const workflows = new InMemoryModelCommercialWorkflowStore();
  const coordinator = new ModelCommercialLifecycleCoordinator({
    accounting,
    attestations: new InMemoryModelCommercialHostAttestations(),
    authorization: new InMemoryModelCommercialAuthorization(
      commercialAuthorization,
    ),
    now: () => now,
    pricing: new InMemoryModelCommercialPricing({
      policies: [normalization],
      pricing: [providerPricing],
    }),
    scopeResolver: new InMemoryModelCommercialScopeResolver(),
    workflows,
  });
  let calls = 0;
  const response = await coordinator.execute(operation, (context) => {
    calls++;
    now = completedAt;
    return Promise.resolve(
      typeof result === "function" ? result(context) : result,
    );
  });
  const record = workflows.get(operation.multiCallWorkflowId);
  if (record === null)
    throw new Error("Expected a coordinator-produced workflow.");
  return {
    accounting,
    invocationCount: () => calls,
    coordinator,
    operation,
    record,
    response,
  };
}

function envelope(
  record: ModelCommercialWorkflowRecordV1,
  noUsageVerified = false,
) {
  if (record.dispatchIntent === null || record.resolvedContext === null) {
    throw new Error(
      "Expected the actual coordinator's immutable dispatch pins.",
    );
  }
  return {
    kind: "verified",
    authority: "canonical-model-terminal-v1",
    requestDigest: digestStructuredValue(record.request),
    reservationId: record.request.reservationId,
    dispatchIntentId: record.dispatchIntent.dispatchIntentId,
    pricingAuthorityDigest:
      record.resolvedContext.estimateResult.pricingAuthority.authorityDigest,
    outcome: projectModelCommercialTerminalOutcomeV1(record, noUsageVerified),
  };
}

const terminalCases = [
  {
    name: "completed delivery",
    result: invocation(),
    kind: "settlement",
    state: "completed",
  },
  {
    name: "known timeout usage",
    result: invocation({
      attempts: [
        attempt({ status: "timed-out", failureCategory: "provider-timeout" }),
      ],
      failureCategory: "provider-timeout",
      status: "timeout",
      usefulOutputDelivered: false,
    }),
    kind: "release",
    state: "compensated",
  },
  {
    name: "known cancelled usage",
    result: invocation({
      attempts: [
        attempt({ status: "cancelled", failureCategory: "cancelled" }),
      ],
      failureCategory: "cancelled",
      status: "cancelled",
      usefulOutputDelivered: false,
    }),
    kind: "release",
    state: "compensated",
  },
  {
    name: "known provider failure usage",
    result: invocation({
      attempts: [
        attempt({
          status: "provider-failure",
          failureCategory: "provider-failure",
        }),
      ],
      failureCategory: "provider-failure",
      status: "provider-failure",
      usefulOutputDelivered: false,
    }),
    kind: "release",
    state: "compensated",
  },
] as const;

describe("canonical terminal projection parity", () => {
  it("matches an attested no-dispatch release only with independently verified proof", async () => {
    const test = await runCoordinator((context) =>
      invocation({
        attempts: [],
        failureCategory: "host-attested-pre-dispatch-no-usage",
        preDispatchNoUsageAttestation: {
          attestationId: "attestation_one",
          authority: "host-dispatch-v1",
          dispatchIntentId: context.dispatchIntentId,
          multiCallWorkflowId: "workflow_one",
          noUsageObserved: true,
          organizationId: "org_one",
          projectId: "project_one",
          providerDispatchStarted: false,
          reservationId: "reservation_one",
          verifierId: "cloudmarkup.host-dispatch",
          verifierVersion: "1",
        },
        status: "internal-failure",
        usefulOutputDelivered: false,
      }),
    );
    expect(projectModelCommercialTerminalOutcomeV1(test.record).kind).toBe(
      "reconciliation-required",
    );
    const projected = projectModelCommercialTerminalOutcomeV1(
      test.record,
      true,
    );
    expect(projected.kind).toBe("release");
    expect(projected.actualCreditUnits).toBe(0);
    expect(projected.response).toEqual(test.response);
    expect(projected.response.state).toBe("released");
    expect(projected.event).toEqual(test.accounting.events.at(-1));
    expect(
      parseModelCommercialVerifiedTerminalV1(
        envelope(test.record, true),
        test.operation,
      ).outcome,
    ).toEqual(projected);
  });

  it("preserves the caller's technical-usage visibility without changing accounting", async () => {
    const test = await runCoordinator(invocation(), {
      ...request(),
      includeTechnicalUnitDetail: false,
    });
    const value = envelope(test.record);
    expect(value.outcome.response).toEqual(test.response);
    expect(value.outcome.response.technicalUnits).toBeNull();
    expect(value.outcome.event.totalUnits).toBeGreaterThan(0);
    expect(
      parseModelCommercialVerifiedTerminalV1(value, test.operation),
    ).toEqual(value);
  });

  it.each(terminalCases)(
    "matches the real coordinator for $name",
    async ({ result, kind, state }) => {
      const test = await runCoordinator(result);
      const before = structuredClone(test.record);
      const projected = projectModelCommercialTerminalOutcomeV1(test.record);
      expect(projected.kind).toBe(kind);
      expect(projected.response.state).toBe(state);
      expect(projected.response).toEqual(test.response);
      expect(projected.event).toEqual(test.accounting.events.at(-1));
      expect(projected.actualCreditUnits).toBe(
        projected.event.chargedCreditUnits +
          projected.event.compensatedCreditUnits,
      );
      expect(
        parseModelCommercialVerifiedTerminalV1(
          envelope(test.record),
          test.operation,
        ).outcome,
      ).toEqual(projected);
      expect(test.record).toEqual(before);
      await expect(test.coordinator.recover(test.operation)).resolves.toEqual(
        test.response,
      );
      expect(test.accounting.events).toHaveLength(2);
      expect(test.accounting.reserveCalls).toBe(1);
      expect(test.invocationCount()).toBe(1);
    },
  );

  it("keeps unknown usage held and never parses it as a verified terminal result", async () => {
    const test = await runCoordinator(
      invocation({
        attempts: [
          attempt({
            status: "timed-out",
            failureCategory: "provider-timeout",
            usage: null,
          }),
        ],
        failureCategory: "provider-timeout",
        status: "timeout",
        usefulOutputDelivered: false,
      }),
    );
    const projected = projectModelCommercialTerminalOutcomeV1(test.record);
    expect(projected.kind).toBe("reconciliation-required");
    expect(projected.response).toEqual(test.response);
    expect(projected.event).toEqual(test.accounting.events.at(-1));
    expect(
      test.accounting.getReservationStatus(
        test.operation,
        test.operation.reservationId,
      ),
    ).toBe("active");
    expect(() =>
      parseModelCommercialVerifiedTerminalV1(
        envelope(test.record),
        test.operation,
      ),
    ).toThrow();
  });

  it("does not invent terminal evidence from an incomplete or mismatched workflow", async () => {
    const { record } = await runCoordinator();
    for (const key of [
      "resolvedContext",
      "invocationReceipt",
      "dispatchIntent",
      "reservationReceipt",
    ] as const) {
      expect(() =>
        projectModelCommercialTerminalOutcomeV1({ ...record, [key]: null }),
      ).toThrow();
    }
    expect(() =>
      projectModelCommercialTerminalOutcomeV1({
        ...record,
        invocationReceipt: {
          ...requireFixture(record.invocationReceipt),
          dispatchIntentId: "dispatch_other",
        },
      }),
    ).toThrow();
  });

  it("projects a recovered invocation without mutating the retained original receipt", async () => {
    const test = await runCoordinator();
    const before = structuredClone(test.record);
    const receivedAt = "2026-08-21T12:00:02.000Z";
    const recovered = projectModelCommercialRecoveredInvocationRecordV1(
      test.record,
      invocation(),
      receivedAt,
    );
    expect(recovered.state).toBe("invoked");
    expect(recovered.response).toBeNull();
    expect(recovered.request).toEqual(test.operation);
    expect(recovered.dispatchIntent).toEqual(test.record.dispatchIntent);
    expect(recovered.invocationReceipt?.receivedAt).toBe(receivedAt);
    expect(
      projectModelCommercialTerminalOutcomeV1(recovered).event.occurredAt,
    ).toBe(receivedAt);
    expect(test.record).toEqual(before);
    expect(() =>
      projectModelCommercialRecoveredInvocationRecordV1(
        { ...test.record, dispatchIntent: null },
        invocation(),
        receivedAt,
      ),
    ).toThrow();
  });
});

type MutableEnvelope = ReturnType<typeof envelope>;
interface Mutation {
  readonly name: string;
  readonly change: (value: MutableEnvelope) => unknown;
}
const malformed: readonly Mutation[] = [
  { name: "unavailable envelope", change: () => ({ kind: "unavailable" }) },
  {
    name: "unrecognized authority",
    change: (v) => ({ ...v, authority: "browser-terminal-v1" }),
  },
  {
    name: "extra envelope field",
    change: (v) => ({ ...v, candidate: "unaccepted content" }),
  },
  {
    name: "extra event field",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        event: { ...v.outcome.event, providerBody: "raw" },
      },
    }),
  },
  {
    name: "extra attempt field",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        event: {
          ...v.outcome.event,
          attempts: [{ ...v.outcome.event.attempts[0], output: "raw" }],
        },
      },
    }),
  },
  {
    name: "malformed request digest",
    change: (v) => ({ ...v, requestDigest: "not-a-digest" }),
  },
  {
    name: "substituted request digest",
    change: (v) => ({
      ...v,
      requestDigest: digestStructuredValue({ unrelated: true }),
    }),
  },
  {
    name: "malformed pricing digest",
    change: (v) => ({ ...v, pricingAuthorityDigest: "not-a-digest" }),
  },
  {
    name: "malformed dispatch identity",
    change: (v) => ({ ...v, dispatchIntentId: "not an opaque id" }),
  },
  {
    name: "substituted envelope reservation",
    change: (v) => ({ ...v, reservationId: "reservation_other" }),
  },
  {
    name: "unsafe integer",
    change: (v) => ({
      ...v,
      outcome: { ...v.outcome, actualCreditUnits: Number.MAX_SAFE_INTEGER + 1 },
    }),
  },
  {
    name: "negative usage",
    change: (v) => ({
      ...v,
      outcome: { ...v.outcome, event: { ...v.outcome.event, inputUnits: -1 } },
    }),
  },
  {
    name: "contradictory usage total",
    change: (v) => ({
      ...v,
      outcome: { ...v.outcome, event: { ...v.outcome.event, totalUnits: 1 } },
    }),
  },
  {
    name: "noncanonical timestamp",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        event: { ...v.outcome.event, occurredAt: "2026-08-21" },
      },
    }),
  },
  {
    name: "mismatched response credits",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        response: { ...v.outcome.response, completedCreditUnits: 0 },
      },
    }),
  },
  {
    name: "mismatched accepted maximum",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        response: {
          ...v.outcome.response,
          estimate: {
            ...requireFixture(v.outcome.response.estimate),
            maximumCreditUnits: 999,
          },
        },
      },
    }),
  },
  {
    name: "release that still charges",
    change: (v) => ({ ...v, outcome: { ...v.outcome, kind: "release" } }),
  },
  {
    name: "contradictory actual and compensation",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        actualCreditUnits: v.outcome.actualCreditUnits + 1,
      },
    }),
  },
  {
    name: "unconfirmed reconciliation",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        response: {
          ...v.outcome.response,
          reconciliationState: "pending-settlement",
        },
      },
    }),
  },
  {
    name: "nonterminal response",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        response: { ...v.outcome.response, state: "settlement-pending" },
      },
    }),
  },
  {
    name: "unknown failure code",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        event: { ...v.outcome.event, failureCategory: "unknown-provider-code" },
      },
    }),
  },
  {
    name: "contradictory terminal status",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        event: { ...v.outcome.event, status: "cancelled" },
      },
    }),
  },
  {
    name: "contradictory response state",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        response: { ...v.outcome.response, state: "released" },
      },
    }),
  },
  {
    name: "contradictory route label",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        response: { ...v.outcome.response, routeLabel: "Deep Design" },
      },
    }),
  },
  {
    name: "contradictory visible usage",
    change: (v) => ({
      ...v,
      outcome: {
        ...v.outcome,
        response: { ...v.outcome.response, technicalUnits: usage(1, 1) },
      },
    }),
  },
];

describe("strict verified terminal recovery envelope", () => {
  it.each([
    ["providerKey", "provider_other"],
    ["modelId", "model_other"],
    ["modelVersion", "model_other_v1"],
    ["inferenceProfileId", "profile_other"],
    ["promptId", "prompt_other"],
    ["promptVersion", "prompt_other_v1"],
    ["pricingVersionId", "pricing_other"],
    ["normalizationPolicyVersionId", "normalization_other"],
    ["routeId", "route_other"],
    ["attemptNumber", 2],
    ["startedAt", completedAt],
    ["mayHaveBeenProcessed", false],
    ["failureCategory", "provider-failure"],
  ] as const)(
    "rejects contradictory attempt %s",
    async (field, substituted) => {
      const test = await runCoordinator();
      const value = envelope(test.record);
      expect(
        parseModelCommercialVerifiedTerminalV1(value, test.operation),
      ).toEqual(value);
      const original = value.outcome.event.attempts[0];
      expect(original).toBeDefined();
      expect(() =>
        parseModelCommercialVerifiedTerminalV1(
          {
            ...value,
            outcome: {
              ...value.outcome,
              event: {
                ...value.outcome.event,
                attempts: [{ ...original, [field]: substituted }],
              },
            },
          },
          test.operation,
        ),
      ).toThrow();
    },
  );

  it("rejects a synthetic secret-bearing value even in an otherwise valid display field", async () => {
    const test = await runCoordinator();
    const value = envelope(test.record);
    expect(() =>
      parseModelCommercialVerifiedTerminalV1(
        {
          ...value,
          outcome: {
            ...value.outcome,
            response: {
              ...value.outcome.response,
              routeExplanation: "Bearer abcdefghijklmnopqrstuvwxyz012345",
            },
          },
        },
        test.operation,
      ),
    ).toThrow();
  });

  it.each(
    malformed.filter(
      ({ name }) =>
        !["malformed request digest", "contradictory route label"].includes(
          name,
        ),
    ),
  )("rejects $name", async ({ change }) => {
    const test = await runCoordinator();
    const value = envelope(test.record);
    expect(
      parseModelCommercialVerifiedTerminalV1(value, test.operation),
    ).toEqual(value);
    expect(() =>
      parseModelCommercialVerifiedTerminalV1(change(value), test.operation),
    ).toThrow();
  });

  it.each([
    "organizationId",
    "projectId",
    "userId",
    "reservationId",
    "requestId",
    "multiCallWorkflowId",
    "jobId",
    "feature",
    "promptId",
    "promptVersion",
    "templateId",
    "templateVersion",
    "eventId",
    "idempotencyKey",
  ] as const)(
    "rejects substituted event %s while keeping the original request digest",
    async (field) => {
      const test = await runCoordinator();
      const value = envelope(test.record);
      expect(
        parseModelCommercialVerifiedTerminalV1(value, test.operation),
      ).toEqual(value);
      expect(() =>
        parseModelCommercialVerifiedTerminalV1(
          {
            ...value,
            outcome: {
              ...value.outcome,
              event: { ...value.outcome.event, [field]: "other_identity" },
            },
          },
          test.operation,
        ),
      ).toThrow();
    },
  );

  it("binds every request field even when the event's tenant is unchanged", async () => {
    const test = await runCoordinator();
    expect(() =>
      parseModelCommercialVerifiedTerminalV1(envelope(test.record), {
        ...test.operation,
        includeTechnicalUnitDetail: false,
      }),
    ).toThrow();
  });

  it("returns a detached parsed snapshot, never authority for an untrusted host port", async () => {
    const test = await runCoordinator();
    const value = envelope(test.record);
    const parsed = parseModelCommercialVerifiedTerminalV1(
      value,
      test.operation,
    );
    expect(parsed).toEqual(value);
    expect(parsed).not.toBe(value);
    expect(parsed.outcome.event).not.toBe(value.outcome.event);
  });
});

/** Synthetic metadata parity only. These envelopes are never host ledger evidence. */
async function liveTerminalFixture(
  routeMode: "standard" | "deep" = "standard",
) {
  const source = syntheticLiveEvaluationFixtureV2({
    organizationId: "org_one",
    projectId: "project_one",
    userId: "user_one",
  });
  const selectedRoute: ModelCommercialRouteV1 = {
    ...route,
    route: routeMode,
    routeId: routeMode === "deep" ? "deep-design" : route.routeId,
    label: routeMode === "deep" ? "Deep Design" : "Standard Design",
  };
  const test = await runCoordinator(
    invocation({ attempts: [attempt({ routeId: selectedRoute.routeId })] }),
    {
      ...request(),
      feature: source.request.operation,
      requestedRoute: routeMode,
      plannedCalls: request().plannedCalls.map((call) => ({
        ...call,
        routeId: selectedRoute.routeId,
      })),
    },
    { ...pricing, pricingVersionId: "cloudmarkup.synthetic.pricing" },
    {
      ...authorization(),
      approvedRoutes: [selectedRoute],
      allowedRouteIds: [selectedRoute.routeId],
    },
  );
  const original = envelope(test.record);
  const estimateResult = requireFixture(
    test.record.resolvedContext,
  ).estimateResult;
  const estimate = {
    canonicalAuthority: "canonical-commercial-v1",
    estimatedMicroUsd: estimateResult.maximumEstimatedProviderCostMicros,
    maximumCreditUnits: requireFixture(original.outcome.response.estimate)
      .maximumCreditUnits,
    pricingVersionReference: original.outcome.event.pricingVersionId,
  };
  const { requestDigest: previousDigest, ...metadata } = source.request;
  void previousDigest;
  const body = {
    ...metadata,
    idempotencyKeyDigest: sha256Text(test.operation.idempotencyKey),
    requested: {
      ...source.request.requested,
      outputTokens: test.operation.requestedMaximumOutputUnits,
    },
    commercialEstimate: {
      ...estimate,
      estimateDigest: digestStructuredValue(estimate),
    },
  };
  const admission = modelLiveRuntimeAdmissionRequestV2Schema.parse({
    ...body,
    requestDigest: digestStructuredValue(body),
  });
  const value = {
    ...original,
    authority: "canonical-model-live-terminal-v2",
    evaluation: {
      runtimeRequestDigest: admission.requestDigest,
      liveEvaluationPlanDigest: admission.liveEvaluationPlanDigest,
      liveEvaluationAuthorityDigest: admission.liveEvaluationAuthorityDigest,
      evaluationCaseId: admission.evaluationCaseId,
      evaluationCaseDigest: admission.evaluationCaseDigest,
    },
  };
  return { test, original, admission, value };
}
describe("explicit live evaluation terminal recovery metadata", () => {
  it.each(["standard", "deep"] as const)(
    "shares canonical %s usage integrity with an exact V2 admission binding",
    async (routeMode) => {
      const f = await liveTerminalFixture(routeMode);
      const parsed = parseModelLiveCommercialVerifiedTerminalV2(
        f.value,
        f.test.operation,
        f.admission,
      );
      expect(parsed).toEqual(f.value);
      expect(parsed.outcome.response).toEqual(f.test.response);
      expect(parsed.outcome.event.route).toBe(routeMode);
      expect(parsed.outcome.response.routeLabel).toBe(
        routeMode === "deep" ? "Deep Design" : "Standard Design",
      );
      expect(() =>
        parseModelCommercialVerifiedTerminalV1(f.value, f.test.operation),
      ).toThrow();
      expect(() =>
        parseModelLiveCommercialVerifiedTerminalV2(
          f.original,
          f.test.operation,
          f.admission,
        ),
      ).toThrow();
    },
  );
  it.each([
    "runtimeRequestDigest",
    "liveEvaluationPlanDigest",
    "liveEvaluationAuthorityDigest",
    "evaluationCaseId",
    "evaluationCaseDigest",
  ] as const)("rejects a substituted evaluation %s", async (key) => {
    const f = await liveTerminalFixture();
    const value = {
      ...f.value,
      evaluation: {
        ...f.value.evaluation,
        [key]:
          key === "evaluationCaseId"
            ? "case_other"
            : digestStructuredValue("other evaluation"),
      },
    };
    expect(() =>
      parseModelLiveCommercialVerifiedTerminalV2(
        value,
        f.test.operation,
        f.admission,
      ),
    ).toThrow();
  });
  it("rejects self-rehashed admission metadata for a different tenant", async () => {
    const f = await liveTerminalFixture();
    const { requestDigest: previousDigest, ...metadata } = f.admission;
    void previousDigest;
    const body = { ...metadata, userId: "user_other" };
    const admission = modelLiveRuntimeAdmissionRequestV2Schema.parse({
      ...body,
      requestDigest: digestStructuredValue(body),
    });
    const value = {
      ...f.value,
      evaluation: {
        ...f.value.evaluation,
        runtimeRequestDigest: admission.requestDigest,
      },
    };
    expect(() =>
      parseModelLiveCommercialVerifiedTerminalV2(
        value,
        f.test.operation,
        admission,
      ),
    ).toThrow();
  });
  it("rejects altered technical units and temporary content in terminal metadata", async () => {
    const f = await liveTerminalFixture();
    for (const value of [
      { ...f.value, promptText: "Synthetic unaccepted prompt" },
      {
        ...f.value,
        outcome: {
          ...f.value.outcome,
          event: { ...f.value.outcome.event, inputUnits: 999 },
        },
      },
      { ...f.value, outcome: { ...f.value.outcome, actualCreditUnits: 999 } },
    ])
      expect(() =>
        parseModelLiveCommercialVerifiedTerminalV2(
          value,
          f.test.operation,
          f.admission,
        ),
      ).toThrow();
  });
});

/** Synthetic port metadata over the real shared coordinator. Not actual validator issuance. */
async function liveCoordinatorFixture(mode: "standard" | "deep" = "standard") {
  const f = await liveTerminalFixture(mode);
  const context = requireFixture(f.test.record.resolvedContext);
  const pin = requireFixture(
    context.estimateResult.pricingAuthority.routePins[0],
  );
  const accounting = new InMemoryCanonicalModelCommercialAccounting({
    org_one: 100,
  });
  const workflows = new InMemoryModelCommercialWorkflowStore();
  const dependencies = {
    accounting,
    workflows,
    attestations: new InMemoryModelCommercialHostAttestations(),
    authorization: new InMemoryModelCommercialAuthorization(
      context.authorization,
    ),
    now: () => completedAt,
    pricing: new InMemoryModelCommercialPricing({
      policies: [pin.normalizationPolicy],
      pricing: [pin.pricingVersion],
    }),
    scopeResolver: new InMemoryModelCommercialScopeResolver(),
  };
  const state: {
    journal: "verified" | "unavailable" | "pending";
    terminal: boolean;
    journalReads: number;
  } = { journal: "verified", terminal: false, journalReads: 0 };
  const result = requireFixture(f.test.record.invocationResult);
  const options = {
    ...dependencies,
    commercialRequest: f.test.operation,
    admissionRequest: f.admission,
    invocationRecovery: {
      recoverVerified: (input: {
        dispatchIntent: ModelCommercialDispatchIntentV1;
      }) => {
        state.journalReads++;
        return Promise.resolve(
          state.journal === "verified"
            ? parseModelLiveCommercialInvocationEvidenceV2(
                {
                  kind: "verified",
                  authority: "canonical-model-live-invocation-v2",
                  requestDigest: digestStructuredValue(f.test.operation),
                  dispatchIntentId: input.dispatchIntent.dispatchIntentId,
                  evaluation: f.value.evaluation,
                  source: "validated-output",
                  outputDigest: digestStructuredValue(
                    "synthetic structured output",
                  ),
                  validationReceiptDigest: digestStructuredValue(
                    "synthetic validator receipt",
                  ),
                  result,
                },
                f.test.operation,
                input.dispatchIntent,
                f.admission,
              )
            : { kind: state.journal },
        );
      },
    },
    terminalRecovery: {
      recoverVerified: () =>
        Promise.resolve(
          state.terminal
            ? parseModelLiveCommercialVerifiedTerminalV2(
                f.value,
                f.test.operation,
                f.admission,
              )
            : { kind: "unavailable" as const },
        ),
    },
  };
  return {
    ...f,
    dependencies,
    options,
    state,
    accounting,
    workflows,
    result,
    coordinator: new ModelLiveCommercialLifecycleCoordinatorV2(options),
  };
}

describe("live invocation evidence cannot manufacture journal authority", () => {
  it.each([
    "normal-authority",
    "foreign-request",
    "foreign-dispatch",
    "foreign-runtime",
    "foreign-plan",
    "foreign-approval",
    "foreign-case-id",
    "foreign-case-digest",
    "no-output",
    "no-validator",
    "unknown-usage",
    "failed-label",
    "no-delivery",
    "content-field",
    "output-content",
    "no-dispatch-attestation",
  ])("rejects %s substitution", async (change) => {
    const f = await liveCoordinatorFixture();
    const dispatch = requireFixture(f.test.record.dispatchIntent);
    const original = await f.options.invocationRecovery.recoverVerified({
      dispatchIntent: dispatch,
    });
    if (original.kind !== "verified")
      throw Error("Synthetic fixture unavailable.");
    let candidate: unknown = original;
    const foreign = digestStructuredValue("foreign synthetic binding");
    const bindingKey: Record<string, keyof typeof original.evaluation> = {
      "foreign-runtime": "runtimeRequestDigest",
      "foreign-plan": "liveEvaluationPlanDigest",
      "foreign-approval": "liveEvaluationAuthorityDigest",
      "foreign-case-id": "evaluationCaseId",
      "foreign-case-digest": "evaluationCaseDigest",
    };
    const key = bindingKey[change];
    if (key !== undefined)
      candidate = {
        ...original,
        evaluation: {
          ...original.evaluation,
          [key]: key === "evaluationCaseId" ? "foreign_case" : foreign,
        },
      };
    else if (change === "normal-authority")
      candidate = { ...original, authority: "intent-preview-delivery-v1" };
    else if (change === "foreign-request")
      candidate = { ...original, requestDigest: foreign };
    else if (change === "foreign-dispatch")
      candidate = { ...original, dispatchIntentId: "foreign_dispatch" };
    else if (change === "no-output")
      candidate = { ...original, outputDigest: null };
    else if (change === "no-validator")
      candidate = { ...original, validationReceiptDigest: null };
    else if (change === "failed-label")
      candidate = { ...original, source: "failed-generation" };
    else if (change === "content-field")
      candidate = { ...original, prompt: "untrusted content" };
    else if (change === "output-content")
      candidate = {
        ...original,
        outputDigest: { response: "untrusted content" },
      };
    else if (change === "no-delivery")
      candidate = {
        ...original,
        result: { ...original.result, usefulOutputDelivered: false },
      };
    else if (change === "no-dispatch-attestation")
      candidate = {
        ...original,
        result: { ...original.result, preDispatchNoUsageAttestation: {} },
      };
    else if (change === "unknown-usage")
      candidate = {
        ...original,
        result: {
          ...original.result,
          attempts: original.result.attempts.map((a) => ({
            ...a,
            usage: null,
          })),
        },
      };
    else throw Error("Missing mutation.");
    expect(() =>
      parseModelLiveCommercialInvocationEvidenceV2(
        candidate,
        f.test.operation,
        dispatch,
        f.admission,
      ),
    ).toThrow();
  });
  it("accepts a known failed generation only without validation or useful output claims", async () => {
    const f = await liveCoordinatorFixture("deep");
    const dispatch = requireFixture(f.test.record.dispatchIntent);
    const original = await f.options.invocationRecovery.recoverVerified({
      dispatchIntent: dispatch,
    });
    if (original.kind !== "verified")
      throw Error("Synthetic fixture unavailable.");
    const failed = {
      ...original,
      source: "failed-generation",
      outputDigest: null,
      validationReceiptDigest: null,
      result: {
        ...original.result,
        usefulOutputDelivered: false,
        status: "internal-failure",
        failureCategory: "model-gateway.internal-error",
      },
    };
    expect(
      parseModelLiveCommercialInvocationEvidenceV2(
        failed,
        f.test.operation,
        dispatch,
        f.admission,
      ),
    ).toMatchObject({
      source: "failed-generation",
      result: { usefulOutputDelivered: false, status: "internal-failure" },
    });
    expect(() =>
      parseModelLiveCommercialInvocationEvidenceV2(
        { ...failed, outputDigest: original.outputDigest },
        f.test.operation,
        dispatch,
        f.admission,
      ),
    ).toThrow();
  });
  it("recovers the actual journal result after a contradictory callback without a second dispatch", async () => {
    const f = await liveCoordinatorFixture();
    let calls = 0;
    const response = await f.coordinator.execute(f.test.operation, () => {
      calls++;
      return Promise.resolve({
        ...f.result,
        resultId: "contradictory_callback",
      });
    });
    expect(response.state).toBe("completed");
    expect(
      f.workflows.get(f.test.operation.multiCallWorkflowId)?.invocationResult,
    ).toMatchObject({
      resultId: f.result.resultId,
      usefulOutputDelivered: true,
      attempts: [{ usage: f.result.attempts[0]?.usage }],
    });
    expect(f.state.journalReads).toBe(1);
    expect(calls).toBe(1);
    expect(f.accounting.reserveCalls).toBe(1);
  });
});

describe("explicit live commercial coordinator recovery", () => {
  it.each(["standard", "deep"] as const)(
    "settles %s only after journal verification",
    async (mode) => {
      const f = await liveCoordinatorFixture(mode);
      const response = await f.coordinator.execute(f.test.operation, () =>
        Promise.resolve(f.result),
      );
      expect(response.state).toBe("completed");
      expect(response.route).toBe(mode);
      expect(f.state.journalReads).toBeGreaterThan(0);
      expect(f.accounting.reserveCalls).toBe(1);
      expect(f.accounting.events).toHaveLength(2);
      expect(await f.coordinator.recover(f.test.operation)).toEqual(response);
      expect(f.accounting.events).toHaveLength(2);
    },
  );
  it("holds credits when a success callback has no authenticated journal", async () => {
    const f = await liveCoordinatorFixture();
    f.state.journal = "unavailable";
    const result = await f.coordinator.execute(f.test.operation, () =>
      Promise.resolve(f.result),
    );
    expect(result.state).toBe("reconciliation-required");
    expect(
      f.accounting.getReservationStatus(
        f.test.operation,
        f.test.operation.reservationId,
      ),
    ).toBe("active");
    expect(f.accounting.events.some((e) => e.chargedCreditUnits > 0)).toBe(
      false,
    );
  });
  it("keeps pending validation retryable without invoking or reserving twice", async () => {
    const f = await liveCoordinatorFixture();
    f.state.journal = "pending";
    let calls = 0;
    await expect(
      f.coordinator.execute(f.test.operation, () => {
        calls++;
        return Promise.resolve(f.result);
      }),
    ).rejects.toMatchObject({ code: "dependency-failure" });
    expect(f.workflows.get(f.test.operation.multiCallWorkflowId)).toMatchObject(
      {
        invocationReceipt: null,
        invocationResult: null,
      },
    );
    f.state.journal = "verified";
    expect((await f.coordinator.recover(f.test.operation)).state).toBe(
      "completed",
    );
    expect(calls).toBe(1);
    expect(f.accounting.reserveCalls).toBe(1);
  });
  it("replays verified V2 terminal metadata without workflow or accounting writes", async () => {
    const f = await liveCoordinatorFixture("deep");
    f.state.terminal = true;
    expect(await f.coordinator.recover(f.test.operation)).toEqual(
      f.test.response,
    );
    expect(f.accounting.reserveCalls).toBe(0);
    expect(f.accounting.events).toHaveLength(0);
    expect(f.workflows.get(f.test.operation.multiCallWorkflowId)).toBeNull();
    expect(f.state.journalReads).toBe(0);
  });
  it("rejects a changed request before any financial write", async () => {
    const f = await liveCoordinatorFixture();
    await expect(
      f.coordinator.execute(
        { ...f.test.operation, requestId: "other_request" },
        () => Promise.resolve(f.result),
      ),
    ).rejects.toMatchObject({ code: "policy-violation" });
    expect(f.accounting.reserveCalls).toBe(0);
    expect(f.accounting.events).toHaveLength(0);
  });
  it("does not select live recovery through undeclared normal-constructor options", async () => {
    const f = await liveCoordinatorFixture();
    const normal = new ModelCommercialLifecycleCoordinator({
      ...f.dependencies,
      ...{ liveRecovery: f.options },
    });
    expect(
      (await normal.execute(f.test.operation, () => Promise.resolve(f.result)))
        .state,
    ).toBe("completed");
    expect(f.state.journalReads).toBe(0);
  });
  it.each(["idempotencyKey", "requestedMaximumOutputUnits"] as const)(
    "rejects a substituted live constructor %s",
    async (key) => {
      const f = await liveCoordinatorFixture();
      expect(
        () =>
          new ModelLiveCommercialLifecycleCoordinatorV2({
            ...f.options,
            commercialRequest: {
              ...f.test.operation,
              [key]: key === "idempotencyKey" ? "other_idempotency" : 999,
            },
          }),
      ).toThrow();
      expect(f.accounting.reserveCalls).toBe(0);
    },
  );
});
