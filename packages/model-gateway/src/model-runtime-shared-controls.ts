import type {
  ModelRuntimeAdmissionRequestV1,
  ModelRuntimeControlPolicyV1,
  ModelRoutingDecisionV1,
  ModelRoutingRequestV1,
  ModelRuntimeStateSnapshotV1,
} from "@cloudmarkup/schemas";
import type { ModelRuntimeLiveAuthorityReservationV1 } from "./model-runtime-controls.js";
import {
  ModelRuntimeControlError,
  orderedReasons,
  type ModelRuntimeDenialReasonV1,
} from "./model-runtime-errors.js";

function allAllowed(
  requested: readonly string[],
  allowed: readonly string[],
): boolean {
  return requested.every((value) => allowed.includes(value));
}

/** Report-independent controls over already authenticated and validated metadata.
 * This projection grants no execution, approval or commercial authority. */
export function expectedSharedStaticDenialReasons(input: {
  readonly admissionRequest: Pick<
    ModelRuntimeAdmissionRequestV1,
    "organizationId" | "userId" | "operation" | "plan" | "role" | "requested"
  >;
  readonly policy: Pick<
    ModelRuntimeControlPolicyV1,
    | "administrativeSuspensions"
    | "killSwitches"
    | "featureEntitlements"
    | "allowlists"
    | "limits"
  >;
  readonly routingDecision: Pick<
    ModelRoutingDecisionV1,
    "routeId" | "modelConfigurationReference" | "maximumOutputTokens"
  > & {
    readonly entitlement: Pick<
      ModelRoutingDecisionV1["entitlement"],
      "allowed"
    >;
    readonly creditAuthorization: Pick<
      ModelRoutingDecisionV1["creditAuthorization"],
      "allowed"
    >;
  };
  readonly routingRequest: {
    readonly creditAuthorization: Pick<
      ModelRoutingRequestV1["creditAuthorization"],
      "allowed"
    >;
  };
}): readonly ModelRuntimeDenialReasonV1[] {
  const { admissionRequest, policy, routingDecision } = input;
  const reasons = new Set<ModelRuntimeDenialReasonV1>();
  const requested = admissionRequest.requested;
  if (
    policy.administrativeSuspensions.some(
      (entry) =>
        (entry.scope === "organization" &&
          entry.scopeId === admissionRequest.organizationId) ||
        (entry.scope === "user" && entry.scopeId === admissionRequest.userId),
    )
  ) {
    reasons.add("administratively-suspended");
  }
  if (
    policy.killSwitches.global.engaged ||
    policy.killSwitches.capabilitySwitches.some(
      (entry) =>
        entry.operation === admissionRequest.operation && entry.engaged,
    )
  ) {
    reasons.add("capability-killed");
  }
  const planEntitlement = policy.featureEntitlements.find(
    (entry) => entry.plan === admissionRequest.plan,
  );
  if (
    !planEntitlement?.features.includes(admissionRequest.operation) ||
    !routingDecision.entitlement.allowed
  ) {
    reasons.add("feature-not-entitled");
  }
  if (
    !routingDecision.creditAuthorization.allowed ||
    !input.routingRequest.creditAuthorization.allowed
  ) {
    reasons.add("insufficient-credits");
  }
  if (
    !policy.allowlists.routes.includes(routingDecision.routeId) ||
    !policy.allowlists.roles.includes(admissionRequest.role) ||
    !policy.allowlists.modelConfigurationReferences.includes(
      routingDecision.modelConfigurationReference,
    )
  ) {
    reasons.add("model-not-allow-listed");
  }
  if (
    requested.promptBytes > policy.limits.maximumPromptBytes ||
    requested.repositoryBytes > policy.limits.maximumRepositoryBytes ||
    requested.repositoryFiles > policy.limits.maximumRepositoryFiles ||
    requested.fileCount > policy.limits.maximumFiles ||
    requested.nodeCount > policy.limits.maximumNodes ||
    requested.edgeCount > policy.limits.maximumEdges
  ) {
    reasons.add("input-limit-exceeded");
  }
  if (
    requested.outputBytes > policy.limits.maximumOutputBytes ||
    requested.outputTokens > policy.limits.maximumOutputTokens ||
    requested.outputTokens > routingDecision.maximumOutputTokens
  ) {
    reasons.add("output-limit-exceeded");
  }
  if (requested.repairAttempts > policy.limits.maximumRepairAttempts) {
    reasons.add("repair-limit-exceeded");
  }
  if (!allAllowed(requested.dependencyNames, policy.allowlists.dependencies)) {
    reasons.add("dependency-not-allow-listed");
  }
  if (!allAllowed(requested.providerSources, policy.allowlists.providers)) {
    reasons.add("provider-not-allow-listed");
  }
  if (!allAllowed(requested.moduleSources, policy.allowlists.modules)) {
    reasons.add("module-not-allow-listed");
  }
  return orderedReasons(reasons);
}

export function expectedRuntimeDenialReasons(input: {
  readonly liveAuthorityReservation:
    ModelRuntimeLiveAuthorityReservationV1 | undefined;
  readonly policy: Pick<ModelRuntimeControlPolicyV1, "requestWindows">;
  readonly replayDenialReasons: readonly ModelRuntimeDenialReasonV1[];
  readonly runtimeState: Pick<
    ModelRuntimeStateSnapshotV1,
    "windows" | "liveAuthorityUsage" | "idempotencyReplay"
  >;
}): readonly ModelRuntimeDenialReasonV1[] {
  const reasons = new Set<ModelRuntimeDenialReasonV1>();
  if (input.runtimeState.idempotencyReplay) {
    return orderedReasons(new Set(input.replayDenialReasons));
  }
  if (
    input.runtimeState.windows.user.requestCount >=
      input.policy.requestWindows.user.maximumRequests ||
    input.runtimeState.windows.organization.requestCount >=
      input.policy.requestWindows.organization.maximumRequests
  ) {
    reasons.add("request-limit-exceeded");
  }
  if (
    input.runtimeState.windows.user.activeConcurrentJobs >=
      input.policy.requestWindows.user.maximumConcurrentJobs ||
    input.runtimeState.windows.organization.activeConcurrentJobs >=
      input.policy.requestWindows.organization.maximumConcurrentJobs
  ) {
    reasons.add("concurrency-limit-exceeded");
  }
  const reservation = input.liveAuthorityReservation;
  const usage = input.runtimeState.liveAuthorityUsage;
  if ((reservation === undefined) !== (usage === undefined)) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
  if (reservation !== undefined && usage !== undefined) {
    if (usage.authorityDigest !== reservation.authorityDigest) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    if (
      usage.activeConcurrentJobs >= reservation.limits.maximumConcurrentJobs
    ) {
      reasons.add("concurrency-limit-exceeded");
    }
    if (
      usage.reservedInvocations + reservation.planned.invocations >
        reservation.limits.maximumInvocations ||
      usage.reservedInputTokens + reservation.planned.inputTokens >
        reservation.limits.maximumInputTokens ||
      usage.reservedOutputTokens + reservation.planned.outputTokens >
        reservation.limits.maximumOutputTokens ||
      usage.reservedTotalTokens + reservation.planned.totalTokens >
        reservation.limits.maximumTotalTokens ||
      usage.reservedCreditUnits + reservation.planned.creditUnits >
        reservation.limits.maximumCreditUnits ||
      usage.reservedEstimatedMicroUsd + reservation.planned.estimatedMicroUsd >
        reservation.limits.maximumEstimatedMicroUsd
    ) {
      reasons.add("live-evaluation-not-authorized");
    }
  }
  return orderedReasons(reasons);
}
