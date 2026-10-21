import {
  digestStructuredValue as digest,
  parseModelLiveSeedRuntimeExecutionV4,
  projectModelLiveSeedRuntimeExecutionIdentityV4,
  type ModelLiveSeedRuntimeAdmissionClaimV4,
  type ModelLiveSeedRuntimeAdmissionTerminalV4,
} from "@cloudmarkup/model-gateway";
import { syntheticSeedSequenceRuntimeFixtureV4 } from "@cloudmarkup/model-gateway/testing";
import {
  modelRuntimeStateSnapshotV1Schema,
  type ModelRuntimeStateSnapshotV1,
} from "@cloudmarkup/schemas";
import { seedRuntimeAdmissionFixture } from "./model-live-seed-runtime-admission-test-helpers.js";

/** Synthetic comparison fixture only. No actual row, count, approval or
 * financial event is converted into successor authority. */
export function seedSequenceRuntimeAdmissionFixtureV4() {
  const old = seedRuntimeAdmissionFixture();
  const input = syntheticSeedSequenceRuntimeFixtureV4();
  const execution = parseModelLiveSeedRuntimeExecutionV4(input);
  const identity = projectModelLiveSeedRuntimeExecutionIdentityV4(input);
  const request = execution.admissionRequest,
    decision = execution.admissionDecision;
  const scope = {
    organizationId: request.organizationId,
    projectId: request.projectId,
    userId: request.userId,
  };
  const state = {
    ...old.state,
    ...scope,
    liveAuthorityReservation: execution.liveAuthorityReservation,
    requestDigest: request.requestDigest,
    tenantScopeDigest: identity.tenantScopeDigest,
  };
  function emptySnapshot() {
    const { snapshotDigest, ...body } = old.emptySnapshot();
    void snapshotDigest;
    const updated = { ...body, ...scope, requestDigest: request.requestDigest };
    return modelRuntimeStateSnapshotV1Schema.parse({
      ...updated,
      snapshotDigest: digest(updated),
    });
  }
  function claim(
    snapshot: ModelRuntimeStateSnapshotV1 = emptySnapshot(),
  ): ModelLiveSeedRuntimeAdmissionClaimV4 {
    const { deniedTerminal, ...base } = old.claim(snapshot);
    void deniedTerminal;
    return {
      ...base,
      ...state,
      admissionRequest: request,
      admissionDecision: decision,
      fingerprint: identity.fingerprint,
      commercialExpiresAt: execution.commercialRequest.expiresAt,
      executionLeaseExpiresAt: execution.commercialRequest.expiresAt,
    };
  }
  function record() {
    return {
      ...old.record(),
      request,
      decision,
      originalSnapshot: emptySnapshot(),
      liveAuthorityReservation: execution.liveAuthorityReservation,
      fingerprint: identity.fingerprint,
      tenantScopeDigest: identity.tenantScopeDigest,
    };
  }
  const terminal: ModelLiveSeedRuntimeAdmissionTerminalV4 = {
    admission: decision,
    commercial: old.terminal.commercial,
    output: null,
  };
  return {
    execution,
    scope,
    request,
    decision,
    state,
    emptySnapshot,
    claim,
    record,
    terminal,
  };
}
