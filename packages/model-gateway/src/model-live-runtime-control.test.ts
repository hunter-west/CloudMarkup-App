import { prepareModelLiveRuntimeExecutionV2 } from "./model-live-runtime-preparation.js";
import { vi, describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelLiveRuntimeAdmissionDecisionV2Schema,
  modelRoutingDecisionV1Schema,
  modelRuntimeStateSnapshotV1Schema,
  type ModelRuntimeStateSnapshotV1,
  type ModelRuntimeHostEvidenceV1,
  modelRuntimeHostEvidenceV1Schema,
} from "@cloudmarkup/schemas";
import { syntheticLiveEvaluationFixtureV2 } from "./model-live-evaluation-fakes.js";
import {
  modelTestContext,
  modelTestRequests,
  modelTestRoutingRequest,
  modelTestRoutingDecision,
} from "./test-helpers.js";
import {
  ModelLiveRuntimeControlServiceV2,
  type ModelLiveRuntimeAuthorityPurposeV2,
} from "./model-live-runtime-control.js";
import {
  type ModelLiveRuntimeControlExecutionInputV2,
  projectModelLiveRuntimeExecutionIdentityV2,
} from "./model-live-runtime-execution-metadata.js";
import type {
  ModelLiveRuntimeAdmissionStoreV2,
  ModelLiveRuntimeAdmissionClaimV2,
  ModelLiveRuntimeAdmissionTerminalV2,
  ModelLiveRuntimeAdmissionClaimResultV2,
} from "./model-live-runtime-admission.js";
import type {
  ModelRuntimeCanonicalCommercialPortV1,
  ModelRuntimeHostEvidenceVerifierV1,
  ModelRuntimeTelemetryOutboxEntryV1,
  ModelRuntimeTelemetryPortV1,
} from "./model-runtime-controls.js";
import {
  MODEL_COMMERCIAL_LIFECYCLE_VERSION,
  type ModelCommercialOperationRequestV1,
  type ModelCommercialInvocationContextV1,
  type ModelCommercialInvocationResultV1,
  type ModelCommercialLifecycleResponseV1,
} from "./commercial-lifecycle.js";
import { sha256Text } from "./security.js";

/** Synthetic orchestration fixtures only. They authenticate no production
 * caller, operator, provider usage, validator or financial receipt. */
function liveRuntimeExecutionHarness() {
  const f = syntheticLiveEvaluationFixtureV2();
  const binding = f.plan.definition.cases[0];
  if (binding === undefined) throw Error("Missing synthetic case");
  const tuple = binding.authorityBinding.authorityTuple;
  const operation = modelTestRequests().find(
    (r) => r.operation === tuple.operation,
  );
  if (operation === undefined) throw Error("Missing synthetic operation");
  const context = modelTestContext("live_invocation_synthetic");
  const routingRequest = modelTestRoutingRequest(
    operation,
    {
      ...context,
      scope: { ...context.scope, ...f.scope },
      idempotencyKeyDigest: sha256Text("synthetic_live_idempotency"),
      evaluationPolicyId: f.policy.evaluationRequirement.evaluationPolicyId,
      evaluationPolicyVersion:
        f.policy.evaluationRequirement.evaluationPolicyVersion,
    },
    { environment: "development", inputDigest: f.request.inputDigest },
  );
  const routingDecision = modelRoutingDecisionV1Schema.parse({
    ...modelTestRoutingDecision(routingRequest),
    feature: operation.operation,
    automaticEscalationPermitted: false,
    capabilityRegistryDigest: tuple.capabilityRegistryDigest,
    routeRegistryDigest: tuple.routeRegistryDigest,
    routeDefinitionDigest: tuple.routeDefinitionDigest,
    modelConfigurationReference: tuple.modelConfigurationReference,
    inferenceProfileId: tuple.inferenceProfileId,
    evaluationPolicyId: f.policy.evaluationRequirement.evaluationPolicyId,
    evaluationPolicyVersion:
      f.policy.evaluationRequirement.evaluationPolicyVersion,
    customerCharge: {
      acceptedMaximumCreditUnits: 1,
      incrementalEscalationCreditUnits: 0,
      policy: "accepted-estimate-cap",
    },
    pricingVersionReference:
      f.request.commercialEstimate.pricingVersionReference,
    promptCachePolicy: {
      enabled: false,
      cacheKeyRequired: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
  });
  const { requestDigest: discarded, ...requestData } = f.request;
  void discarded;
  const requestBody = {
    ...requestData,
    idempotencyKeyDigest: routingRequest.idempotencyKeyDigest,
    routingDecisionDigest: digestCanonicalValue(routingDecision),
  };
  const admissionRequest = modelLiveRuntimeAdmissionRequestV2Schema.parse({
    ...requestBody,
    requestDigest: digestCanonicalValue(requestBody),
  });
  const expiresAt = new Date(Date.parse(f.now) + 240000).toISOString();
  const maximumUsage = {
    inputUnits: 100,
    outputUnits: f.request.requested.outputTokens,
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    providerSpecificUnits: [],
    totalUnits: 100 + f.request.requested.outputTokens,
  };
  const commercialRequest: ModelCommercialOperationRequestV1 = {
    confirmationRequired: false,
    estimateAccepted: true,
    environment: "development",
    eventIdPrefix: "live_event",
    expiresAt,
    feature: operation.operation,
    idempotencyKey: "synthetic_live_idempotency",
    includeTechnicalUnitDetail: true,
    jobId: "live_job",
    multiCallWorkflowId: "live_workflow",
    organizationId: f.scope.organizationId,
    projectId: f.scope.projectId,
    userId: f.scope.userId,
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
        routeId: routingDecision.routeId,
      },
    ],
    promptId: tuple.promptTemplateId,
    promptVersion: tuple.promptTemplateVersion,
    requestedAt: f.now,
    requestedMaximumInputUnits: 100,
    requestedMaximumOutputUnits: f.request.requested.outputTokens,
    requestedRoute: "standard",
    requestId: "live_request",
    reservationId: "live_reservation",
    templateId: null,
    templateVersion: null,
  };
  const decisionBody = {
    accountingAuthority: "canonical-commercial-v1",
    authorization: {
      commercialReservationDecisionId: commercialRequest.reservationId,
      concurrencyLeaseId: "live_lease",
      entitlementDecisionId: routingRequest.plan.entitlementDecisionId,
    },
    commercialEstimateDigest:
      admissionRequest.commercialEstimate.estimateDigest,
    contractVersion: 2,
    decisionId: "live_admission",
    decidedAt: f.now,
    denialReasons: [],
    evaluationAuthorityTupleDigest:
      admissionRequest.evaluationAuthorityTupleDigest,
    evaluationCaseDigest: admissionRequest.evaluationCaseDigest,
    evaluationCaseId: admissionRequest.evaluationCaseId,
    executionClass: "live-evaluation",
    expiresAt,
    invokeModel: true,
    liveEvaluationAuthorityDigest:
      admissionRequest.liveEvaluationAuthorityDigest,
    liveEvaluationPlanDigest: admissionRequest.liveEvaluationPlanDigest,
    outcome: "allowed",
    recordKind: "model-live-runtime-admission-decision",
    requestDigest: admissionRequest.requestDigest,
    routingDecisionDigest: admissionRequest.routingDecisionDigest,
    runtimePolicyDigest: f.policy.policyDigest,
    writeAuthority: {
      compiler: false,
      deployment: false,
      github: false,
      payment: false,
      repository: false,
    },
  };
  const admissionDecision = modelLiveRuntimeAdmissionDecisionV2Schema.parse({
    ...decisionBody,
    decisionDigest: digestCanonicalValue(decisionBody),
  });
  const input: ModelLiveRuntimeControlExecutionInputV2 = {
    admissionDecision,
    admissionRequest,
    commercialRequest,
    inputEvidence: f.inputEvidence,
    plan: f.plan,
    routingDecision,
    routingRequest,
  };
  const usage = {
    ...maximumUsage,
    inputUnits: 20,
    outputUnits: 10,
    totalUnits: 30,
  };
  const invocation: ModelCommercialInvocationResultV1 = {
    attempts: [
      {
        attemptId: "live_attempt",
        attemptKind: "primary",
        attemptNumber: 1,
        callId: "live_call",
        completedAt: f.now,
        failureCategory: "cloudmarkup.synthetic.failure",
        invocationId: "live_invocation",
        latencyMilliseconds: 10,
        mayHaveBeenProcessed: true,
        modelId: routingDecision.modelId,
        modelVersion: routingDecision.modelVersion,
        inferenceProfileId: routingDecision.inferenceProfileId,
        promptId: commercialRequest.promptId,
        promptVersion: commercialRequest.promptVersion,
        providerKey: routingDecision.providerId,
        providerRequestId: "live_provider_request",
        retryOfAttemptId: null,
        routeId: routingDecision.routeId,
        startedAt: f.now,
        status: "provider-failure",
        usage,
        usageRecordId: "live_usage",
      },
    ],
    completedAt: f.now,
    failureCategory: "cloudmarkup.synthetic.failure",
    resultId: "live_result",
    status: "provider-failure",
    usefulOutputDelivered: false,
  };
  const callback: ModelCommercialInvocationContextV1 = {
    acceptedMaximumCreditUnits: 1,
    acceptedMaximumEstimatedProviderCostMicros: 1000,
    dispatchIntentId: "live_dispatch",
    multiCallWorkflowId: commercialRequest.multiCallWorkflowId,
    normalizationPolicyCatalogDigest: sha256Text("synthetic normalization"),
    normalizationPolicyVersionReference: "cloudmarkup.synthetic.normalization",
    pricingAuthorityDigest: sha256Text("synthetic pricing"),
    pricingCatalogDigest: sha256Text("synthetic catalog"),
    pricingVersionReference:
      admissionRequest.commercialEstimate.pricingVersionReference,
    reservationId: commercialRequest.reservationId,
    route: {
      explanation: "Synthetic route",
      label: "Standard Design",
      route: "standard",
      routeId: routingDecision.routeId,
      modelId: routingDecision.modelId,
      modelVersion: routingDecision.modelVersion,
      providerKey: routingDecision.providerId,
      inferenceProfileId: routingDecision.inferenceProfileId,
    },
  };
  const response: ModelCommercialLifecycleResponseV1 = {
    compensationStatus: "not-required",
    completedCreditUnits: 0,
    denialReason: null,
    estimate: {
      minimumCreditUnits: 1,
      maximumCreditUnits: 1,
      requiresConfirmation: false,
    },
    reconciliationState: "not-required",
    reservationAccepted: true,
    reservationId: commercialRequest.reservationId,
    route: "standard",
    routeExplanation: "Synthetic route",
    routeLabel: "Standard Design",
    state: "released",
    technicalUnits: usage,
    version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
  };
  const state = {
    now: f.now,
    current: true,
    inputAuthenticated: true,
    leaseCurrent: true,
    replay: false,
    recoveryLease: false,
    responseMode: "released" as ModelCommercialLifecycleResponseV1["state"],
    claim: null as ModelLiveRuntimeAdmissionClaimV2 | null,
    terminal: null as ModelLiveRuntimeAdmissionTerminalV2 | null,
    pending: null as ModelLiveRuntimeAdmissionTerminalV2 | null,
    purposes: [] as ModelLiveRuntimeAuthorityPurposeV2[],
    snapshotPatch: {} as Partial<ModelRuntimeStateSnapshotV1>,
    outbox: [] as ModelRuntimeTelemetryOutboxEntryV1[],
    actualInvocation: null as ModelCommercialInvocationResultV1 | null,
    authenticatedOutputs: new Map<string, ModelRuntimeHostEvidenceV1>(),
  };
  const lease = () => ({
    acquiredAt: state.now,
    executionLeaseId: "live_execution",
    expiresAt: new Date(Date.parse(state.now) + 300000).toISOString(),
    fencingToken: "live_fence",
    recoveryOnly: state.recoveryLease,
    revision: 1,
  });
  const store = {
    inspect: vi.fn<ModelLiveRuntimeAdmissionStoreV2["inspect"]>((request) => {
      const window = {
        activeConcurrentJobs: 0,
        requestCount: 0,
        windowStartedAt: f.now,
        windowEndsAt: f.plan.expiresAt,
      };
      const body = {
        activeConcurrencyLeaseIds: [],
        capturedAt: request.decidedAt,
        contractVersion: 1,
        idempotencyReplay: state.replay,
        organizationId: request.organizationId,
        projectId: request.projectId,
        userId: request.userId,
        policyDigest: request.runtimePolicyDigest,
        requestDigest: request.requestDigest,
        recordKind: "model-runtime-state-snapshot",
        snapshotId: "live_snapshot",
        windows: { organization: window, user: window },
        liveAuthorityUsage: {
          activeConcurrentJobs: 0,
          authorityDigest: f.approval.approvalDigest,
          reservedCacheReadTokens: 0,
          reservedCacheWriteTokens: 0,
          reservedCreditUnits: 0,
          reservedEstimatedMicroUsd: 0,
          reservedInputTokens: 0,
          reservedInvocations: 0,
          reservedOutputTokens: 0,
          reservedTotalTokens: 0,
        },
        ...state.snapshotPatch,
      };
      return Promise.resolve(
        modelRuntimeStateSnapshotV1Schema.parse({
          ...body,
          snapshotDigest: digestCanonicalValue(body),
        }),
      );
    }),
    claim: vi.fn<ModelLiveRuntimeAdmissionStoreV2["claim"]>(
      async (claim): Promise<ModelLiveRuntimeAdmissionClaimResultV2> => {
        state.claim = claim;
        state.outbox.push(...claim.claimOutbox);
        if (state.terminal !== null)
          return { kind: "duplicate-terminal", terminal: state.terminal };
        return {
          kind: "claimed",
          admissionDecision: claim.admissionDecision,
          executionLease: lease(),
          pending: state.pending,
          snapshot: await store.inspect(claim),
        };
      },
    ),
    assertExecutionLease: vi.fn<
      ModelLiveRuntimeAdmissionStoreV2["assertExecutionLease"]
    >(() => {
      if (!state.leaseCurrent)
        return Promise.reject(Error("Synthetic lost lease"));
      return Promise.resolve();
    }),
    checkpointPendingAndRelease: vi.fn<
      ModelLiveRuntimeAdmissionStoreV2["checkpointPendingAndRelease"]
    >((request) => {
      state.pending = request.pending;
      state.outbox.push(...request.pendingOutbox);
      return Promise.resolve();
    }),
    completeAndRelease: vi.fn<
      ModelLiveRuntimeAdmissionStoreV2["completeAndRelease"]
    >((request) => {
      state.terminal = request.terminal;
      state.outbox.push(...request.terminalOutbox);
      return Promise.resolve();
    }),
    release: vi.fn<ModelLiveRuntimeAdmissionStoreV2["release"]>(() => {
      return Promise.resolve();
    }),
    listPendingOutbox: vi.fn<
      ModelLiveRuntimeAdmissionStoreV2["listPendingOutbox"]
    >(() => Promise.resolve([...state.outbox])),
    acknowledgeOutbox: vi.fn<
      ModelLiveRuntimeAdmissionStoreV2["acknowledgeOutbox"]
    >((request) => {
      state.outbox = state.outbox.filter(
        (e) => e.outboxId !== request.outboxId,
      );
      return Promise.resolve();
    }),
    appendOperationalOutbox:
      vi.fn<ModelLiveRuntimeAdmissionStoreV2["appendOperationalOutbox"]>(),
    readOperationalExecutionBinding:
      vi.fn<
        ModelLiveRuntimeAdmissionStoreV2["readOperationalExecutionBinding"]
      >(),
  } satisfies ModelLiveRuntimeAdmissionStoreV2;
  const commercial = {
    execute: vi.fn<ModelRuntimeCanonicalCommercialPortV1["execute"]>(
      async (_request, invoke) => {
        state.actualInvocation = await invoke(callback);
        return { ...structuredClone(response), state: state.responseMode };
      },
    ),
    recover: vi.fn<ModelRuntimeCanonicalCommercialPortV1["recover"]>(() =>
      Promise.resolve({
        ...structuredClone(response),
        state: state.responseMode,
      }),
    ),
  };
  const evidenceVerifier = {
    verifyInputEvidence: vi.fn<
      ModelRuntimeHostEvidenceVerifierV1["verifyInputEvidence"]
    >((request) =>
      Promise.resolve(
        state.inputAuthenticated &&
          digestCanonicalValue(request.evidence) ===
            digestCanonicalValue(f.inputEvidence),
      ),
    ),
    verify: vi.fn<ModelRuntimeHostEvidenceVerifierV1["verify"]>((request) =>
      Promise.resolve(
        digestCanonicalValue(
          state.authenticatedOutputs.get(request.evidence.evidenceDigest) ??
            null,
        ) === digestCanonicalValue(request.evidence),
      ),
    ),
    verifyOperationalOutcome: vi.fn<
      ModelRuntimeHostEvidenceVerifierV1["verifyOperationalOutcome"]
    >(() => Promise.resolve(false)),
  };
  const resolve = vi.fn(
    (
      request: Parameters<
        import("./model-live-runtime-control.js").ModelLiveRuntimeAuthorityResolverV2["resolve"]
      >[0],
    ) => {
      state.purposes.push(request.purpose);
      if (!state.current && request.purpose !== "recovery")
        return Promise.reject(Error("Synthetic withdrawn approval"));
      return Promise.resolve(
        structuredClone({
          plan: input.plan,
          routingDecision: input.routingDecision,
          routingRequest: input.routingRequest,
        }),
      );
    },
  );
  const telemetry = {
    publish: vi.fn<ModelRuntimeTelemetryPortV1["publish"]>(() => {
      return Promise.resolve();
    }),
  };
  const service = new ModelLiveRuntimeControlServiceV2({
    authorityResolver: { resolve },
    commercial,
    evidenceVerifier,
    store,
    telemetry,
    now: () => state.now,
  });
  return {
    f,
    input,
    state,
    store,
    commercial,
    evidenceVerifier,
    resolve,
    telemetry,
    service,
    invocation,
    response,
    callback,
  };
}

describe("explicit V2 runtime execution", () => {
  it("uses the shared lease, callback, usage and terminal lifecycle with final dispatch authority", async () => {
    const h = liveRuntimeExecutionHarness();
    expect(
      projectModelLiveRuntimeExecutionIdentityV2(h.input).fingerprint,
    ).toMatch(/^sha256:/u);
    const invoke = vi.fn(
      async (
        context: Parameters<Parameters<typeof h.service.execute>[1]>[0],
      ) => {
        await context.assertCurrentExecution?.();
        expect(await context.assertCurrentDispatch?.()).toEqual({
          expiresAt: h.input.commercialRequest.expiresAt,
        });
        return { commercial: h.invocation, output: null };
      },
    );
    const result = await h.service.execute(h.input, invoke);
    expect(result.commercial?.state).toBe("released");
    expect(result.output).toBeNull();
    expect(h.state.purposes).toEqual(["execution", "dispatch"]);
    expect(h.commercial.execute).toHaveBeenCalledOnce();
    expect(h.commercial.recover).not.toHaveBeenCalled();
    expect(h.store.completeAndRelease).toHaveBeenCalledOnce();
    expect(h.state.claim?.fingerprint).toBe(
      projectModelLiveRuntimeExecutionIdentityV2(h.input).fingerprint,
    );
    expect(h.state.claim?.liveAuthorityReservation.planned).toMatchObject({
      invocations: 1,
      inputTokens: 100,
      outputTokens: 1000,
    });
    const audits = h.telemetry.publish.mock.calls.map(([entry]) => entry.audit);
    expect(JSON.stringify(audits)).toContain(h.input.plan.planDigest);
    expect(JSON.stringify(audits)).not.toContain("evaluationReportDigest");
  });

  it.each([
    "input",
    "initial-approval",
    "authority",
    "commercial-environment",
    "under-reserved-output",
    "extra-provider-call",
    "snapshot",
    "estimate",
    "case",
    "tenant",
    "report",
  ] as const)(
    "rejects substituted or unavailable %s before commercial execution",
    async (kind) => {
      const h = liveRuntimeExecutionHarness();
      let input = structuredClone(h.input);
      if (kind === "input") h.state.inputAuthenticated = false;
      if (kind === "commercial-environment")
        input = {
          ...input,
          commercialRequest: {
            ...input.commercialRequest,
            environment: "production",
          },
        };
      if (kind === "extra-provider-call")
        input = {
          ...input,
          commercialRequest: {
            ...input.commercialRequest,
            plannedCalls: [
              ...input.commercialRequest.plannedCalls,
              ...input.commercialRequest.plannedCalls,
            ],
          },
        };
      if (kind === "under-reserved-output")
        input = {
          ...input,
          commercialRequest: {
            ...input.commercialRequest,
            plannedCalls: input.commercialRequest.plannedCalls.map((call) => ({
              ...call,
              maximumUsage: {
                ...call.maximumUsage,
                outputUnits: 1,
                totalUnits: call.maximumUsage.inputUnits + 1,
              },
            })),
          },
        };
      if (kind === "initial-approval") h.state.current = false;
      if (kind === "authority")
        h.resolve.mockImplementation(() =>
          Promise.resolve({
            plan: h.input.plan,
            routingDecision: {
              ...h.input.routingDecision,
              modelId: "changed.model",
            },
            routingRequest: h.input.routingRequest,
          }),
        );
      if (kind === "snapshot")
        h.state.snapshotPatch = { organizationId: "other_organization" };
      if (kind === "estimate")
        input = {
          ...input,
          commercialRequest: {
            ...input.commercialRequest,
            requestedMaximumOutputUnits: 999,
          },
        };
      if (["case", "tenant"].includes(kind)) {
        const { requestDigest: _digest, ...metadata } = input.admissionRequest;
        void _digest;
        const body = {
          ...metadata,
          ...(kind === "case"
            ? { evaluationCaseId: "other_case" }
            : { userId: "other_user" }),
        };
        input = {
          ...input,
          admissionRequest: modelLiveRuntimeAdmissionRequestV2Schema.parse({
            ...body,
            requestDigest: digestCanonicalValue(body),
          }),
        };
      }
      if (kind === "report")
        Object.assign(input, {
          evaluationReport: {
            reportDigest: h.input.admissionRequest.inputDigest,
          },
        });
      await expect(h.service.execute(input, vi.fn())).rejects.toThrow();
      expect(h.commercial.execute).not.toHaveBeenCalled();
      expect(h.commercial.recover).not.toHaveBeenCalled();
      expect(h.store.claim).not.toHaveBeenCalled();
    },
  );

  it.each(["revoked", "lease", "expired", "changed-route"] as const)(
    "fails the final dispatch check when %s",
    async (kind) => {
      const h = liveRuntimeExecutionHarness();
      const sent = vi.fn();
      await expect(
        h.service.execute(h.input, async (context) => {
          if (kind === "revoked") h.state.current = false;
          if (kind === "lease") h.state.leaseCurrent = false;
          if (kind === "expired")
            h.state.now = h.input.commercialRequest.expiresAt;
          if (kind === "changed-route")
            h.resolve.mockImplementation(() =>
              Promise.resolve({
                plan: h.input.plan,
                routingDecision: {
                  ...h.input.routingDecision,
                  modelId: "changed.model",
                },
                routingRequest: h.input.routingRequest,
              }),
            );
          await context.assertCurrentDispatch?.();
          sent();
          return { commercial: h.invocation, output: null };
        }),
      ).rejects.toThrow();
      expect(sent).not.toHaveBeenCalled();
      expect(h.store.release).toHaveBeenCalledOnce();
      expect(h.store.completeAndRelease).not.toHaveBeenCalled();
    },
  );

  it("recovers historical accounting after approval expiry without an invocation callback", async () => {
    const h = liveRuntimeExecutionHarness();
    h.state.now = new Date(
      Date.parse(h.input.plan.expiresAt) + 1000,
    ).toISOString();
    h.state.current = false;
    h.state.replay = true;
    h.state.recoveryLease = true;
    const result = await h.service.recover(h.input);
    expect(result.commercial?.state).toBe("released");
    expect(h.state.purposes).toEqual(["recovery"]);
    expect(h.commercial.recover).toHaveBeenCalledOnce();
    expect(h.commercial.execute).not.toHaveBeenCalled();
  });

  it("does not create a new admission during recovery", async () => {
    const h = liveRuntimeExecutionHarness();
    await expect(h.service.recover(h.input)).rejects.toThrow();
    expect(h.store.claim).not.toHaveBeenCalled();
    expect(h.commercial.recover).not.toHaveBeenCalled();
  });

  it("rejects a fresh execution lease supplied to historical recovery and releases it", async () => {
    const h = liveRuntimeExecutionHarness();
    h.state.replay = true;
    await expect(h.service.recover(h.input)).rejects.toThrow();
    expect(h.store.release).toHaveBeenCalledOnce();
    expect(h.commercial.execute).not.toHaveBeenCalled();
    expect(h.commercial.recover).not.toHaveBeenCalled();
  });

  it("checkpoints pending validation and resumes accounting only", async () => {
    const h = liveRuntimeExecutionHarness();
    h.state.responseMode = "settlement-pending";
    const first = await h.service.execute(h.input, () =>
      Promise.resolve({
        commercial: h.invocation,
        output: null,
      }),
    );
    expect(first.commercial?.state).toBe("settlement-pending");
    expect(h.store.checkpointPendingAndRelease).toHaveBeenCalledOnce();
    h.state.replay = true;
    h.state.recoveryLease = true;
    h.state.current = false;
    h.state.responseMode = "released";
    const recovered = await h.service.recover(h.input);
    expect(recovered.commercial?.state).toBe("released");
    expect(h.commercial.execute).toHaveBeenCalledOnce();
    expect(h.commercial.recover).toHaveBeenCalledOnce();
  });

  it("replays the original terminal without commercial execution", async () => {
    const h = liveRuntimeExecutionHarness();
    h.state.replay = true;
    h.state.current = false;
    h.state.terminal = {
      admission: h.input.admissionDecision,
      commercial: h.response,
      output: null,
    };
    const result = await h.service.recover(h.input);
    expect(result.replayed).toBe(true);
    expect(h.commercial.execute).not.toHaveBeenCalled();
    expect(h.commercial.recover).not.toHaveBeenCalled();
  });

  it("rejects a changed canonical admission and releases the acquired lease", async () => {
    const h = liveRuntimeExecutionHarness();
    const claim = h.store.claim.getMockImplementation();
    h.store.claim.mockImplementation(async (input) => {
      const result = await claim?.(input);
      if (result?.kind !== "claimed") throw Error("Missing fixture claim");
      const { decisionDigest: _digest, ...body } = result.admissionDecision;
      void _digest;
      const changed = {
        ...body,
        authorization: {
          ...body.authorization,
          concurrencyLeaseId: "substituted_lease",
        },
      };
      return {
        ...result,
        admissionDecision: modelLiveRuntimeAdmissionDecisionV2Schema.parse({
          ...changed,
          decisionDigest: digestCanonicalValue(changed),
        }),
      };
    });
    await expect(h.service.execute(h.input, vi.fn())).rejects.toThrow();
    expect(h.store.release).toHaveBeenCalledOnce();
    expect(h.commercial.execute).not.toHaveBeenCalled();
  });

  it("keeps the original immutable commercial request when the caller mutates its object during authentication", async () => {
    const h = liveRuntimeExecutionHarness();
    const original = structuredClone(h.input.commercialRequest);
    const resolve = h.resolve.getMockImplementation();
    h.resolve.mockImplementation(async (request) => {
      Object.assign(h.input.commercialRequest, {
        reservationId: "caller_mutated",
      });
      const result = await resolve?.(request);
      if (result === undefined) throw Error("Missing fixture resolver");
      return result;
    });
    await h.service.execute(h.input, () =>
      Promise.resolve({
        commercial: h.invocation,
        output: null,
      }),
    );
    expect(h.commercial.execute.mock.calls[0]?.[0]).toEqual(original);
  });
});

function verifiedSyntheticOutput(
  h: ReturnType<typeof liveRuntimeExecutionHarness>,
) {
  const request = h.input.admissionRequest;
  const outputDigest = digestCanonicalValue({
    synthetic: "already sanitized output",
  });
  const evidence = (
    evidenceKind: "allow-listed-operations" | "source-ownership",
  ) => {
    const body = {
      catalogDigest: request.catalogDigest,
      contractVersion: 1,
      evidenceId: "live_output_" + evidenceKind,
      evidenceKind,
      inputDigest: request.inputDigest,
      operation: request.operation,
      organizationId: request.organizationId,
      projectId: request.projectId,
      outputBytes: 100,
      outputDigest,
      outputTokens: 10,
      passed: true,
      recordKind: "model-runtime-host-evidence",
      responseSchemaDigest: request.responseSchemaDigest,
      runtimePolicyDigest: request.runtimePolicyDigest,
      verifierId: "cloudmarkup.synthetic.verifier",
      verifierVersion: "1.0.0",
    };
    const record = modelRuntimeHostEvidenceV1Schema.parse({
      ...body,
      evidenceDigest: digestCanonicalValue(body),
    });
    h.state.authenticatedOutputs.set(record.evidenceDigest, record);
    return record;
  };
  return {
    allowListedOperationsEvidence: evidence("allow-listed-operations"),
    noRawSensitiveContent: true as const,
    outputBytes: 100,
    outputDigest,
    outputTokens: 10,
    resultSanitized: true as const,
    secretRedactionApplied: true as const,
    sourceOwnershipEvidence: evidence("source-ownership"),
    structuredOutputValidated: true as const,
  };
}
describe("V2 output acceptance and shared control compatibility", () => {
  it("rejects a deterministic fake route even when all comparison digests are rebound", () => {
    const h = liveRuntimeExecutionHarness();
    const routingDecision = {
      ...h.input.routingDecision,
      providerFamily: "deterministic-fake" as const,
    };
    const { requestDigest: oldRequest, ...requestBody } =
      h.input.admissionRequest;
    void oldRequest;
    const requestMetadata = {
      ...requestBody,
      routingDecisionDigest: digestCanonicalValue(routingDecision),
    };
    const admissionRequest = modelLiveRuntimeAdmissionRequestV2Schema.parse({
      ...requestMetadata,
      requestDigest: digestCanonicalValue(requestMetadata),
    });
    const { decisionDigest: oldDecision, ...decisionBody } =
      h.input.admissionDecision;
    void oldDecision;
    const decisionMetadata = {
      ...decisionBody,
      requestDigest: admissionRequest.requestDigest,
      routingDecisionDigest: admissionRequest.routingDecisionDigest,
    };
    const admissionDecision = modelLiveRuntimeAdmissionDecisionV2Schema.parse({
      ...decisionMetadata,
      decisionDigest: digestCanonicalValue(decisionMetadata),
    });
    expect(() =>
      projectModelLiveRuntimeExecutionIdentityV2({
        ...h.input,
        routingDecision,
        admissionRequest,
        admissionDecision,
      }),
    ).toThrow();
  });

  it("requires current approval and authenticates both actual issued output records", async () => {
    const h = liveRuntimeExecutionHarness();
    const output = verifiedSyntheticOutput(h);
    h.state.responseMode = "completed";
    const commercial = {
      ...h.invocation,
      status: "completed" as const,
      usefulOutputDelivered: true,
      failureCategory: null,
    };
    const result = await h.service.execute(h.input, () =>
      Promise.resolve({
        commercial,
        output,
      }),
    );
    expect(result.output).toEqual(output);
    expect(h.evidenceVerifier.verify).toHaveBeenCalledTimes(2);
    expect(h.state.purposes).toEqual(["execution", "output"]);
  });
  it("rejects self-authored output evidence before marking it useful", async () => {
    const h = liveRuntimeExecutionHarness();
    const output = verifiedSyntheticOutput(h);
    h.state.authenticatedOutputs.clear();
    const commercial = {
      ...h.invocation,
      status: "completed" as const,
      usefulOutputDelivered: true,
      failureCategory: null,
    };
    const result = await h.service.execute(h.input, () =>
      Promise.resolve({
        commercial,
        output,
      }),
    );
    expect(result.output).toBeNull();
    expect(h.state.actualInvocation).toMatchObject({
      status: "internal-failure",
      usefulOutputDelivered: false,
    });
  });
  it("withholds output when approval is withdrawn after generation", async () => {
    const h = liveRuntimeExecutionHarness();
    const output = verifiedSyntheticOutput(h);
    await expect(
      h.service.execute(h.input, () => {
        h.state.current = false;
        return Promise.resolve({
          commercial: {
            ...h.invocation,
            status: "completed",
            usefulOutputDelivered: true,
          },
          output,
        });
      }),
    ).rejects.toThrow();
    expect(h.store.completeAndRelease).not.toHaveBeenCalled();
    expect(h.store.release).toHaveBeenCalledOnce();
    expect(h.evidenceVerifier.verify).not.toHaveBeenCalled();
  });
  it("preserves known failed usage when approval is withdrawn after dispatch", async () => {
    const h = liveRuntimeExecutionHarness();
    const result = await h.service.execute(h.input, () => {
      h.state.current = false;
      return Promise.resolve({ commercial: h.invocation, output: null });
    });
    expect(result.commercial?.state).toBe("released");
    expect(h.state.actualInvocation?.attempts[0]?.usage).toEqual(
      h.invocation.attempts[0]?.usage,
    );
    expect(h.state.purposes).toEqual(["execution"]);
  });
  it("applies the shared request-window denial before claiming commercial work", async () => {
    const h = liveRuntimeExecutionHarness();
    const request = {
      decidedAt: h.state.now,
      organizationId: h.f.scope.organizationId,
      projectId: h.f.scope.projectId,
      userId: h.f.scope.userId,
      runtimePolicyDigest: h.f.policy.policyDigest,
      requestDigest: h.input.admissionRequest.requestDigest,
    };
    const snapshot = await h.store.inspect({
      ...request,
      idempotencyKeyDigest: h.input.admissionRequest.idempotencyKeyDigest,
      tenantScopeDigest: projectModelLiveRuntimeExecutionIdentityV2(h.input)
        .tenantScopeDigest,
      organizationWindowSeconds: 3600,
      userWindowSeconds: 3600,
      liveAuthorityReservation: {
        authorityDigest: h.f.approval.approvalDigest,
        limits: h.f.definition.limits,
        planned: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          creditUnits: 1,
          estimatedMicroUsd: 1000,
          inputTokens: 100,
          invocations: 1,
          outputTokens: 1000,
          totalTokens: 1100,
        },
      },
    });
    h.state.snapshotPatch = {
      windows: {
        ...snapshot.windows,
        user: {
          ...snapshot.windows.user,
          requestCount: h.f.policy.requestWindows.user.maximumRequests,
        },
      },
    };
    await expect(h.service.execute(h.input, vi.fn())).rejects.toThrow();
    expect(h.store.claim).not.toHaveBeenCalled();
    expect(h.commercial.execute).not.toHaveBeenCalled();
  });
});

/** Synthetic metadata checks only; actual SQL preparation is covered in API integration. */
describe("live runtime decision preparation", () => {
  it("derives a fresh decision without claiming capacity or invoking", async () => {
    const f = liveRuntimeExecutionHarness();
    const { admissionDecision, ...metadata } = f.input;
    const prepared = await prepareModelLiveRuntimeExecutionV2({
      metadata,
      store: f.store,
      observedAt: f.state.now,
      decisionId: "prepared_decision",
      concurrencyLeaseId: "prepared_lease",
    });
    expect(prepared.admissionDecision.outcome).toBe("allowed");
    expect(
      prepared.admissionDecision.authorization.commercialReservationDecisionId,
    ).toBe(metadata.commercialRequest.reservationId);
    expect(prepared.admissionDecision.decisionDigest).not.toBe(
      admissionDecision.decisionDigest,
    );
    expect(f.store.claim).not.toHaveBeenCalled();
    expect(f.commercial.execute).not.toHaveBeenCalled();
  });
  it("retains actual capacity denial without granting a lease", async () => {
    const f = liveRuntimeExecutionHarness();
    f.state.snapshotPatch = {
      liveAuthorityUsage: {
        activeConcurrentJobs:
          f.input.plan.definition.limits.maximumConcurrentJobs,
        authorityDigest: f.input.plan.approval.approvalDigest,
        reservedCacheReadTokens: 0,
        reservedCacheWriteTokens: 0,
        reservedCreditUnits: 0,
        reservedEstimatedMicroUsd: 0,
        reservedInputTokens: 0,
        reservedInvocations: 0,
        reservedOutputTokens: 0,
        reservedTotalTokens: 0,
      },
    };
    const { admissionDecision, ...metadata } = f.input;
    void admissionDecision;
    const prepared = await prepareModelLiveRuntimeExecutionV2({
      metadata,
      store: f.store,
      observedAt: f.state.now,
      decisionId: "prepared_denied",
      concurrencyLeaseId: "unused_lease",
    });
    expect(prepared.admissionDecision.denialReasons).toContain(
      "concurrency-limit-exceeded",
    );
    expect(prepared.admissionDecision.outcome).toBe("denied");
    expect(prepared.admissionDecision.authorization).toEqual({});
    expect(f.store.claim).not.toHaveBeenCalled();
  });
  it("requires original metadata for replay and rejects cross-tenant snapshots", async () => {
    const f = liveRuntimeExecutionHarness();
    const { admissionDecision, ...metadata } = f.input;
    void admissionDecision;
    const input = {
      metadata,
      store: f.store,
      observedAt: f.state.now,
      decisionId: "prepared_decision",
      concurrencyLeaseId: "prepared_lease",
    };
    f.state.replay = true;
    await expect(prepareModelLiveRuntimeExecutionV2(input)).rejects.toThrow();
    f.state.replay = false;
    f.state.snapshotPatch = { organizationId: "another_organization" };
    await expect(prepareModelLiveRuntimeExecutionV2(input)).rejects.toThrow();
    expect(f.store.claim).not.toHaveBeenCalled();
  });
});
