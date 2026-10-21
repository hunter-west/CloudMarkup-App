import { aggregateModelUsageUnitsV1 } from "@cloudmarkup/domain";
import {
  digestStructuredValue,
  parseModelLiveSeedRuntimeExecutionV3,
  parseModelLiveSeedRuntimeExecutionV4,
  projectModelLiveSeedRuntimeExecutionIdentityV4,
  projectModelCommercialOperationIdentityV1,
  type ModelLiveSeedRuntimeExecutionInputV4,
  type ModelCommercialOperationRequestV1,
  type ModelLiveSeedRuntimeAdmissionClaimV4,
  projectModelLiveSeedRuntimeExecutionIdentityV3,
  sha256Text,
  type ModelLiveSeedRuntimeExecutionInputV3,
  type ModelRuntimeLiveAuthorityReservationV1,
  type ModelLiveSeedRuntimeAdmissionClaimV3,
  type ModelRuntimeStateSnapshotRequestV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceRuntimeAdmissionRequestV3Schema,
  modelLiveSequenceRuntimeAdmissionRequestV4Schema,
  type ModelLiveSequenceRuntimeAdmissionRequestV4,
  type ModelLiveSequenceRuntimeAdmissionDecisionV4,
  type ModelLiveSequencePlanV3,
  type ModelLiveSequenceInputV3,
  type ModelLiveSequenceRuntimeAdmissionRequestV3,
  type ModelLiveSequenceRuntimeAdmissionDecisionV3,
} from "@cloudmarkup/schemas";
import { parseSeedRuntimeStateRequest } from "./model-live-seed-runtime-admission-codec.js";
import {
  admissionAssert,
  admissionScopeDigest,
} from "./model-runtime-admission-codec.js";
import type { prepareModelLiveSeedStageInputV3 } from "./model-live-runtime-host-evidence-codec.js";
const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);

/** Pure comparison only. The closed sequence host supplies actual reconstructed
 * preparation and issued rows before using this binding in its transaction. */
export function bindPreparedSeedRuntime(
  supplied: ModelLiveSeedRuntimeExecutionInputV3,
  prepared: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
  issued: ModelLiveSequenceInputV3,
) {
  const execution = parseModelLiveSeedRuntimeExecutionV3(supplied);
  assertPreparedSeedRuntime(execution, prepared, issued);
  return {
    execution,
    identity: projectModelLiveSeedRuntimeExecutionIdentityV3(supplied),
  };
}
export function bindPreparedSeedRuntimeV4(
  supplied: ModelLiveSeedRuntimeExecutionInputV4,
  prepared: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
  issued: ModelLiveSequenceInputV3,
) {
  const execution = parseModelLiveSeedRuntimeExecutionV4(supplied);
  assertPreparedSeedRuntime(execution, prepared, issued);
  return {
    execution,
    identity: projectModelLiveSeedRuntimeExecutionIdentityV4(supplied),
  };
}
function assertPreparedSeedRuntime(
  execution:
    | ReturnType<typeof parseModelLiveSeedRuntimeExecutionV3>
    | ReturnType<typeof parseModelLiveSeedRuntimeExecutionV4>,
  prepared: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
  issued: ModelLiveSequenceInputV3,
) {
  const {
    admissionRequest: request,
    routingRequest,
    routingDecision: route,
    commercialRequest: commercial,
  } = execution;
  const { descriptor } = prepared.invocation;
  const routing = descriptor.routing;
  admissionAssert(
    same(execution.plan, prepared.plan) &&
      same(execution.selection, prepared.selection) &&
      same(execution.stageInput, issued) &&
      same(request.requested, prepared.requested) &&
      descriptor.invocationId === request.invocationId &&
      descriptor.inputDigest === request.inputDigest &&
      descriptor.idempotencyKeyDigest === request.idempotencyKeyDigest &&
      sha256Text(commercial.idempotencyKey) === request.idempotencyKeyDigest &&
      commercial.jobId === prepared.scope.jobId &&
      commercial.environment === prepared.plan.definition.scope.environment &&
      routingRequest.scopeDigest === digestStructuredValue(prepared.scope) &&
      routingRequest.environment ===
        prepared.plan.definition.scope.environment &&
      routingRequest.priorAttempt === undefined &&
      routingRequest.xhighEffortAuthorization === undefined &&
      route.xhighEffortAuthorizationDecisionId === undefined &&
      route.routingConfigurationDigest ===
        prepared.routingConfigurationDigest &&
      route.maximumOutputTokens === prepared.invocation.maximumOutputTokens &&
      route.timeoutMilliseconds === prepared.invocation.timeoutMilliseconds &&
      route.requestedMode === descriptor.requestedMode &&
      same(prepared.invocation.promptCachePolicy, route.promptCachePolicy),
  );
  for (const key of [
    "providerFamily",
    "providerId",
    "modelId",
    "modelVersion",
    "inferenceProfileId",
  ] as const)
    admissionAssert(route[key] === descriptor[key]);
  for (const key of [
    "effort",
    "routeId",
    "modelConfigurationReference",
    "modelFamily",
    "pricingVersionReference",
    "modelCapabilityDigest",
    "capabilityRegistryId",
    "capabilityRegistryDigest",
    "capabilityRegistryVersion",
    "routeRegistryId",
    "routeRegistryVersion",
    "routeRegistryDigest",
    "routeDefinitionDigest",
  ] as const)
    admissionAssert(route[key] === routing[key]);
  admissionAssert(route.modelCapabilityVersion === routing.capabilityVersion);
  if (request.contractVersion === 4)
    admissionAssert(
      descriptor.budgetDecisionId === commercial.reservationId &&
        descriptor.entitlementDecisionId ===
          routingRequest.plan.entitlementDecisionId,
    );
}
export interface SeedRuntimeStoreBinding {
  readonly plan: ModelLiveSequencePlanV3;
  readonly request: ModelLiveSequenceRuntimeAdmissionRequestV3;
  readonly decision: ModelLiveSequenceRuntimeAdmissionDecisionV3;
  readonly liveAuthorityReservation: ModelRuntimeLiveAuthorityReservationV1;
  readonly fingerprint: string;
  readonly tenantScopeDigest: string;
}

export interface SeedRuntimeStoreBindingV4 extends Omit<
  SeedRuntimeStoreBinding,
  "request" | "decision"
> {
  readonly request: ModelLiveSequenceRuntimeAdmissionRequestV4;
  readonly decision: ModelLiveSequenceRuntimeAdmissionDecisionV4;
}
export type SeedRuntimeCapacityBindingV4 = Pick<
  SeedRuntimeStoreBindingV4,
  "plan" | "request" | "liveAuthorityReservation" | "tenantScopeDigest"
>;

/** Capacity observation has no decision or executable identity. It binds only
 * an actual issued first-stage request to current authenticated tenant state. */
export type SeedRuntimeCapacityBinding = Pick<
  SeedRuntimeStoreBinding,
  "plan" | "request" | "liveAuthorityReservation" | "tenantScopeDigest"
>;
export function bindPreparedSeedCapacity(
  rawRequest: ModelLiveSequenceRuntimeAdmissionRequestV3,
  rawState: ModelRuntimeStateSnapshotRequestV1,
  prepared: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
  issued: ModelLiveSequenceInputV3,
): SeedRuntimeCapacityBinding {
  return bindPreparedSeedCapacityMetadata(
    modelLiveSequenceRuntimeAdmissionRequestV3Schema.parse(rawRequest),
    rawState,
    prepared,
    issued,
  );
}

/** V4 capacity comparison additionally binds the exact declared two-call
 * commercial list. The closed host still supplies actual source and current
 * SQL authority; neither this digest nor an inspection grants a reservation. */
export function bindPreparedSeedCapacityV4(
  rawRequest: ModelLiveSequenceRuntimeAdmissionRequestV4,
  rawState: ModelRuntimeStateSnapshotRequestV1,
  prepared: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
  issued: ModelLiveSequenceInputV3,
  commercial: ModelCommercialOperationRequestV1,
): SeedRuntimeCapacityBindingV4 {
  const request =
    modelLiveSequenceRuntimeAdmissionRequestV4Schema.parse(rawRequest);
  projectModelCommercialOperationIdentityV1(commercial);
  const binding = bindPreparedSeedCapacityMetadata(
    request,
    rawState,
    prepared,
    issued,
  );
  const planned = binding.liveAuthorityReservation.planned;
  const usage = aggregateModelUsageUnitsV1(
    commercial.plannedCalls.map((call) => call.maximumUsage),
  );
  admissionAssert(
    commercial.plannedCalls.length === 2 &&
      digestStructuredValue(commercial.plannedCalls) ===
        request.canonicalPlannedCallsDigest &&
      commercial.plannedCalls.every(
        (call) =>
          call.kind === "repair" &&
          call.routeId === prepared.invocation.descriptor.routing.routeId,
      ) &&
      commercial.organizationId === prepared.scope.organizationId &&
      commercial.projectId === prepared.scope.projectId &&
      commercial.userId === prepared.scope.userId &&
      commercial.jobId === prepared.scope.jobId &&
      commercial.feature === request.operation &&
      commercial.environment === prepared.plan.definition.scope.environment &&
      commercial.requestedRoute === "deep" &&
      commercial.reservationId ===
        prepared.invocation.descriptor.budgetDecisionId &&
      sha256Text(commercial.idempotencyKey) === request.idempotencyKeyDigest &&
      Date.parse(commercial.requestedAt) === Date.parse(rawState.decidedAt) &&
      Date.parse(commercial.expiresAt) > Date.parse(commercial.requestedAt) &&
      Date.parse(commercial.expiresAt) <= Date.parse(prepared.plan.expiresAt) &&
      commercial.requestedMaximumInputUnits === usage.inputUnits &&
      commercial.requestedMaximumOutputUnits === usage.outputUnits &&
      planned.inputTokens === usage.inputUnits &&
      planned.outputTokens === usage.outputUnits &&
      planned.totalTokens === usage.totalUnits &&
      planned.cacheReadTokens === usage.cacheReadUnits &&
      planned.cacheWriteTokens === usage.cacheWriteUnits &&
      usage.providerSpecificUnits.length === 0,
  );
  return binding;
}

function bindPreparedSeedCapacityMetadata<
  Request extends
    | ModelLiveSequenceRuntimeAdmissionRequestV3
    | ModelLiveSequenceRuntimeAdmissionRequestV4,
>(
  request: Request,
  rawState: ModelRuntimeStateSnapshotRequestV1,
  prepared: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
  issued: ModelLiveSequenceInputV3,
) {
  const invocations = request.contractVersion === 4 ? 2 : 1;
  const { plan, selection, invocation, scope } = prepared;
  const state = parseSeedRuntimeStateRequest(rawState, {
    organizationId: scope.organizationId,
    projectId: invocation.descriptor.scope.projectId,
    userId: scope.userId,
  });
  const policy = plan.definition.policy;
  const descriptor = invocation.descriptor;
  const route = descriptor.routing;
  const selected = plan.definition.cases.find(
    (entry) => entry.caseId === issued.caseId,
  );
  admissionAssert(selected !== undefined);
  const tuple = selected.authorityBinding.authorityTuple;
  const expected = {
    evaluationCaseId: issued.caseId,
    evaluationCaseDigest: issued.caseDigest,
    evaluationAuthorityTupleDigest: issued.authorityTupleDigest,
    liveEvaluationPlanDigest: plan.planDigest,
    liveEvaluationAuthorityDigest: plan.approval.approvalDigest,
    selectionId: selection.selectionId,
    selectionDigest: selection.selectionDigest,
    stageId: issued.stageId,
    stageKey: issued.stageKey,
    invocationId: issued.invocationId,
    inputBindingDigest: issued.inputBindingDigest,
    preparedPayloadDigest: issued.preparedPayloadDigest,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    plan: plan.definition.scope.plan,
    runtimePolicyDigest: policy.policyDigest,
    inputDigest: descriptor.inputDigest,
    idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
    capabilityRegistryDigest: tuple.capabilityRegistryDigest,
    routeRegistryDigest: tuple.routeRegistryDigest,
    catalogDigest: tuple.catalogDigest,
    operation: tuple.operation,
    role: tuple.role,
    promptTemplateDigest: tuple.promptTemplateDigest,
    responseSchemaDigest: tuple.responseSchemaDigest,
  };
  for (const key of Object.keys(expected) as (keyof typeof expected)[])
    admissionAssert(request[key] === expected[key]);
  admissionAssert(
    same(request.requested, prepared.requested) &&
      same(request.cacheKeyAuthority, policy.cacheKeyAuthority) &&
      request.commercialEstimate.pricingVersionReference ===
        route.pricingVersionReference &&
      Date.parse(state.decidedAt) >= Date.parse(issued.issuedAt) &&
      Date.parse(state.decidedAt) < Date.parse(plan.expiresAt),
  );
  const reservation = state.liveAuthorityReservation;
  admissionAssert(
    reservation.authorityDigest === plan.approval.approvalDigest &&
      same(reservation.limits, plan.definition.limits) &&
      reservation.planned.creditUnits ===
        request.commercialEstimate.maximumCreditUnits &&
      reservation.planned.estimatedMicroUsd ===
        request.commercialEstimate.estimatedMicroUsd &&
      reservation.planned.outputTokens ===
        prepared.requested.outputTokens * invocations &&
      reservation.planned.invocations === invocations &&
      reservation.planned.cacheReadTokens === 0 &&
      reservation.planned.cacheWriteTokens === 0,
  );
  const binding = {
    plan,
    request,
    liveAuthorityReservation: reservation,
    tenantScopeDigest: admissionScopeDigest(request),
  };
  bindSeedRuntimeStoreState(binding, state);
  return binding;
}

export function bindSeedRuntimeStoreState(
  binding: Omit<SeedRuntimeCapacityBinding, "request"> & {
    readonly request:
      | ModelLiveSequenceRuntimeAdmissionRequestV3
      | ModelLiveSequenceRuntimeAdmissionRequestV4;
  },
  state: ModelRuntimeStateSnapshotRequestV1,
) {
  const { request, plan } = binding,
    policy = plan.definition.policy;
  admissionAssert(
    state.organizationId === request.organizationId &&
      state.projectId === request.projectId &&
      state.userId === request.userId &&
      state.idempotencyKeyDigest === request.idempotencyKeyDigest &&
      state.tenantScopeDigest === binding.tenantScopeDigest &&
      state.requestDigest === request.requestDigest &&
      state.runtimePolicyDigest === policy.policyDigest &&
      state.organizationWindowSeconds ===
        policy.requestWindows.organization.windowSeconds &&
      state.userWindowSeconds === policy.requestWindows.user.windowSeconds &&
      same(state.liveAuthorityReservation, binding.liveAuthorityReservation),
  );
}
function decisionIdentity(
  decision:
    | ModelLiveSequenceRuntimeAdmissionDecisionV3
    | ModelLiveSequenceRuntimeAdmissionDecisionV4,
) {
  const { decidedAt, expiresAt, decisionDigest, ...identity } = decision;
  void decidedAt;
  void expiresAt;
  void decisionDigest;
  return identity;
}
export function bindSeedRuntimeStoreClaim(
  binding: SeedRuntimeStoreBinding,
  claim: ModelLiveSeedRuntimeAdmissionClaimV3,
) {
  bindSeedRuntimeStoreClaimMetadata(binding, claim);
}
export function bindSeedRuntimeStoreClaimV4(
  binding: SeedRuntimeStoreBindingV4,
  claim: ModelLiveSeedRuntimeAdmissionClaimV4,
) {
  bindSeedRuntimeStoreClaimMetadata(binding, claim);
}
function bindSeedRuntimeStoreClaimMetadata(
  binding: SeedRuntimeStoreBinding | SeedRuntimeStoreBindingV4,
  claim:
    ModelLiveSeedRuntimeAdmissionClaimV3 | ModelLiveSeedRuntimeAdmissionClaimV4,
) {
  bindSeedRuntimeStoreState(binding, claim);
  const windows = binding.plan.definition.policy.requestWindows;
  admissionAssert(
    same(claim.admissionRequest, binding.request) &&
      same(
        decisionIdentity(claim.admissionDecision),
        decisionIdentity(binding.decision),
      ) &&
      claim.fingerprint === binding.fingerprint &&
      same(claim.limits, {
        maximumConcurrentOrganizationJobs:
          windows.organization.maximumConcurrentJobs,
        maximumConcurrentUserJobs: windows.user.maximumConcurrentJobs,
        maximumOrganizationRequests: windows.organization.maximumRequests,
        maximumUserRequests: windows.user.maximumRequests,
      }) &&
      Date.parse(claim.admissionDecision.decidedAt) <=
        Date.parse(claim.decidedAt) &&
      Date.parse(claim.commercialExpiresAt) <=
        Date.parse(binding.plan.expiresAt) &&
      (claim.admissionDecision.expiresAt === undefined ||
        Date.parse(claim.admissionDecision.expiresAt) <=
          Date.parse(binding.plan.expiresAt)),
  );
}
