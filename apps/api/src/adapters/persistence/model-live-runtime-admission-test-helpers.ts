import {
  digestStructuredValue,
  type ModelLiveRuntimeAdmissionClaimV2,
  type ModelLiveRuntimeAdmissionTerminalV2,
} from "@cloudmarkup/model-gateway";
import { syntheticLiveEvaluationFixtureV2 } from "@cloudmarkup/model-gateway/testing";
import {
  modelLiveRuntimeAdmissionDecisionV2Schema,
  modelLiveRuntimeAdmissionRequestV2Schema,
  type ModelLiveEvaluationPlanV2,
  modelRuntimeStateSnapshotV1Schema,
  type ModelRuntimeStateSnapshotV1,
} from "@cloudmarkup/schemas";
import {
  admissionScopeDigest,
  runtimeWindow,
} from "./model-runtime-admission-codec.js";
import { liveRuntimeCapacityReservationSchema } from "./model-live-runtime-admission-codec.js";
import { runtimeAdmissionFixture } from "./model-runtime-admission-test-helpers.js";

/** Synthetic metadata only; never production approval, evaluation or settlement evidence. */
export function liveRuntimeAdmissionFixture(
  input: Parameters<typeof syntheticLiveEvaluationFixtureV2>[0] = {},
  issuedPlan?: ModelLiveEvaluationPlanV2,
  idempotency = "synthetic live idempotency",
) {
  const source = syntheticLiveEvaluationFixtureV2(input);
  const plan = issuedPlan ?? source.plan;
  const { requestDigest: oldRequestDigest, ...requestMetadata } =
    source.request;
  void oldRequestDigest;
  const requestBody = {
    ...requestMetadata,
    idempotencyKeyDigest: digestStructuredValue(idempotency),
    liveEvaluationAuthorityDigest: plan.approval.approvalDigest,
    liveEvaluationPlanDigest: plan.planDigest,
    runtimePolicyDigest: plan.definition.policy.policyDigest,
  };
  const request = modelLiveRuntimeAdmissionRequestV2Schema.parse({
    ...requestBody,
    requestDigest: digestStructuredValue(requestBody),
  });
  const f = {
    ...source,
    request,
    plan,
    approval: plan.approval,
    definition: plan.definition,
    policy: plan.definition.policy,
  };
  const { now } = f;
  const scope = {
    organizationId: request.organizationId,
    projectId: request.projectId,
    userId: request.userId,
  };
  const expiresAt = new Date(Date.parse(now) + 240000).toISOString();
  const leaseId = "live_concurrency_synthetic";
  const decisionBody = {
    accountingAuthority: "canonical-commercial-v1",
    authorization: {
      commercialReservationDecisionId: "reservation.synthetic",
      concurrencyLeaseId: leaseId,
      entitlementDecisionId: "entitlement.synthetic",
    },
    commercialEstimateDigest: request.commercialEstimate.estimateDigest,
    contractVersion: 2,
    decisionId: "live_admission_synthetic",
    decidedAt: now,
    denialReasons: [],
    evaluationAuthorityTupleDigest: request.evaluationAuthorityTupleDigest,
    evaluationCaseDigest: request.evaluationCaseDigest,
    evaluationCaseId: request.evaluationCaseId,
    liveEvaluationAuthorityDigest: request.liveEvaluationAuthorityDigest,
    liveEvaluationPlanDigest: request.liveEvaluationPlanDigest,
    executionClass: "live-evaluation",
    expiresAt,
    invokeModel: true,
    outcome: "allowed",
    recordKind: "model-live-runtime-admission-decision",
    requestDigest: request.requestDigest,
    routingDecisionDigest: request.routingDecisionDigest,
    runtimePolicyDigest: request.runtimePolicyDigest,
    writeAuthority: {
      compiler: false,
      deployment: false,
      github: false,
      payment: false,
      repository: false,
    },
  };
  const decision = modelLiveRuntimeAdmissionDecisionV2Schema.parse({
    ...decisionBody,
    decisionDigest: digestStructuredValue(decisionBody),
  });
  const reservation = liveRuntimeCapacityReservationSchema.parse({
    authorityDigest: f.approval.approvalDigest,
    limits: f.definition.limits,
    planned: {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      creditUnits: request.commercialEstimate.maximumCreditUnits,
      estimatedMicroUsd: request.commercialEstimate.estimatedMicroUsd,
      inputTokens: 100,
      invocations: 1,
      outputTokens: request.requested.outputTokens,
      totalTokens: 100 + request.requested.outputTokens,
    },
  });
  const state = {
    ...scope,
    decidedAt: now,
    idempotencyKeyDigest: request.idempotencyKeyDigest,
    liveAuthorityReservation: reservation,
    organizationWindowSeconds:
      f.policy.requestWindows.organization.windowSeconds,
    requestDigest: request.requestDigest,
    runtimePolicyDigest: request.runtimePolicyDigest,
    tenantScopeDigest: admissionScopeDigest(request),
    userWindowSeconds: f.policy.requestWindows.user.windowSeconds,
  };
  function emptySnapshot() {
    const bounds = runtimeWindow(now, state.userWindowSeconds);
    const window = {
      activeConcurrentJobs: 0,
      requestCount: 0,
      windowStartedAt: bounds.startsAt,
      windowEndsAt: bounds.endsAt,
    };
    const body = {
      activeConcurrencyLeaseIds: [],
      capturedAt: now,
      contractVersion: 1,
      idempotencyReplay: false,
      ...scope,
      liveAuthorityUsage: {
        activeConcurrentJobs: 0,
        authorityDigest: reservation.authorityDigest,
        reservedCacheReadTokens: 0,
        reservedCacheWriteTokens: 0,
        reservedCreditUnits: 0,
        reservedEstimatedMicroUsd: 0,
        reservedInputTokens: 0,
        reservedInvocations: 0,
        reservedOutputTokens: 0,
        reservedTotalTokens: 0,
      },
      policyDigest: request.runtimePolicyDigest,
      recordKind: "model-runtime-state-snapshot",
      requestDigest: request.requestDigest,
      snapshotId: "runtime_snapshot_live_synthetic",
      windows: { organization: window, user: window },
    };
    return modelRuntimeStateSnapshotV1Schema.parse({
      ...body,
      snapshotDigest: digestStructuredValue(body),
    });
  }
  function claim(
    snapshot: ModelRuntimeStateSnapshotV1,
  ): ModelLiveRuntimeAdmissionClaimV2 {
    return {
      ...state,
      admissionRequest: request,
      admissionDecision: decision,
      acquire: true,
      claimOutbox: [],
      commercialExpiresAt: expiresAt,
      executionLeaseExpiresAt: expiresAt,
      fingerprint: digestStructuredValue({ synthetic: true, request }),
      leaseId,
      limits: {
        maximumConcurrentOrganizationJobs:
          f.policy.requestWindows.organization.maximumConcurrentJobs,
        maximumConcurrentUserJobs:
          f.policy.requestWindows.user.maximumConcurrentJobs,
        maximumOrganizationRequests:
          f.policy.requestWindows.organization.maximumRequests,
        maximumUserRequests: f.policy.requestWindows.user.maximumRequests,
      },
      snapshotDigest: snapshot.snapshotDigest,
      snapshotId: snapshot.snapshotId,
    };
  }
  const terminal: ModelLiveRuntimeAdmissionTerminalV2 = {
    admission: decision,
    commercial: runtimeAdmissionFixture().terminal.commercial,
    output: null,
  };
  function record() {
    const claimInput = claim(emptySnapshot());
    return {
      request,
      decision,
      originalSnapshot: emptySnapshot(),
      liveAuthorityReservation: reservation,
      fingerprint: claimInput.fingerprint,
      tenantScopeDigest: state.tenantScopeDigest,
      commercialExpiresAt: expiresAt,
      concurrencyLeaseId: leaseId,
      revision: 0,
      recoveryRequired: false,
      executionLease: {
        acquiredAt: now,
        expiresAt,
        executionLeaseId: "runtime_execution_live_synthetic",
        fencingToken: "runtime_fence_1",
        recoveryOnly: false,
        revision: 0,
      },
      pending: null,
      terminal: null,
    };
  }
  return {
    ...f,
    scope,
    decision,
    state,
    reservation,
    emptySnapshot,
    claim,
    terminal,
    record,
  };
}
