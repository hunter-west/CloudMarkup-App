import {
  digestStructuredValue,
  parseModelLiveSeedRuntimeExecutionV3,
  type ModelLiveSeedRuntimeAdmissionClaimV3,
  type ModelLiveSeedRuntimeAdmissionTerminalV3,
} from "@cloudmarkup/model-gateway";
import { syntheticSeedRuntimeFixtureV3 } from "@cloudmarkup/model-gateway/testing";
import {
  modelRuntimeStateSnapshotV1Schema,
  type ModelRuntimeStateSnapshotV1,
} from "@cloudmarkup/schemas";
import {
  admissionScopeDigest,
  runtimeWindow,
} from "./model-runtime-admission-codec.js";
import { runtimeAdmissionFixture } from "./model-runtime-admission-test-helpers.js";
function present<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error("Missing synthetic seed runtime field");
  return value;
}
/** Synthetic metadata only; no actual tenant, approval, validation, invocation
 * or financial fact is asserted by this fixture. */
export function seedRuntimeAdmissionFixture() {
  const { f: sequence, input: execution } = syntheticSeedRuntimeFixtureV3();
  const request = execution.admissionRequest;
  const decision = execution.admissionDecision;
  const now = decision.decidedAt;
  const f = { ...sequence, request, now };
  const scope = {
    organizationId: request.organizationId,
    projectId: request.projectId,
    userId: request.userId,
  };
  const expiresAt = present(decision.expiresAt);
  const leaseId = present(decision.authorization.concurrencyLeaseId);
  const reservation =
    parseModelLiveSeedRuntimeExecutionV3(execution).liveAuthorityReservation;
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
  ): ModelLiveSeedRuntimeAdmissionClaimV3 {
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
  const terminal: ModelLiveSeedRuntimeAdmissionTerminalV3 = {
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
