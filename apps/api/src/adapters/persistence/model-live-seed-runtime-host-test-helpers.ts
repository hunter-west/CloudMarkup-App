import { syntheticSeedRuntimeFixtureV3 } from "@cloudmarkup/model-gateway/testing";
import {
  digestStructuredValue as digest,
  parseModelLiveSeedRuntimeExecutionV3,
  parseModelLiveSeedRuntimeExecutionV4,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceRuntimeAdmissionRequestV3Schema,
  modelLiveSequenceRuntimeAdmissionRequestV4Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV4Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
  modelLiveSeedRoutingDecisionV3Schema,
  modelRoutingRequestV1Schema,
  type ModelLiveSequenceInputV3,
} from "@cloudmarkup/schemas";
import type { prepareModelLiveSeedStageInputV3 } from "./model-live-runtime-host-evidence-codec.js";
function required<T>(value: T | undefined): T {
  if (value === undefined) throw Error("Missing synthetic seed runtime field");
  return value;
}
const hash = <T extends object>(value: T, key: string) => ({
  ...value,
  [key]: digest(
    Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)),
  ),
});
/** Synthetic metadata for actual host-fixture bytes. No canonical financial or
 * native validation fact is claimed by this test-only builder. */
export function seedRuntimeExecutionForPrepared(
  prepared: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
  stageInput: ModelLiveSequenceInputV3,
  lifetimeMilliseconds = 240000,
) {
  const base = syntheticSeedRuntimeFixtureV3().input;
  const { plan, selection, invocation, scope } = prepared;
  const descriptor = invocation.descriptor,
    route = required(descriptor.routing);
  const binding = required(
    plan.definition.cases.find((c) => c.caseId === stageInput.caseId),
  );
  const tuple = binding.authorityBinding.authorityTuple,
    policy = plan.definition.policy;
  const requestedAt = stageInput.issuedAt;
  const expiresAt = new Date(
    Math.min(
      Date.parse(requestedAt) + lifetimeMilliseconds,
      Date.parse(plan.expiresAt),
    ),
  ).toISOString();
  const stage = {
    evaluationCaseId: stageInput.caseId,
    evaluationCaseDigest: stageInput.caseDigest,
    liveEvaluationPlanDigest: plan.planDigest,
    liveEvaluationAuthorityDigest: plan.approval.approvalDigest,
    evaluationAuthorityTupleDigest: stageInput.authorityTupleDigest,
    selectionId: selection.selectionId,
    selectionDigest: selection.selectionDigest,
    stageId: stageInput.stageId,
    stageKey: stageInput.stageKey,
    invocationId: stageInput.invocationId,
    inputBindingDigest: stageInput.inputBindingDigest,
    preparedPayloadDigest: stageInput.preparedPayloadDigest,
  };
  const routingRequest = modelRoutingRequestV1Schema.parse({
    ...base.routingRequest,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    principalId: scope.userId,
    scopeDigest: digest(scope),
    inputDigest: stageInput.operationInputDigest,
    idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
    requestedMode: descriptor.requestedMode,
    environment: plan.definition.scope.environment,
    estimatedContextTokens: 100,
    plan: { ...base.routingRequest.plan, key: plan.definition.scope.plan },
    requiredEvaluationPolicyId: policy.evaluationRequirement.evaluationPolicyId,
    requiredEvaluationPolicyVersion:
      policy.evaluationRequirement.evaluationPolicyVersion,
  });
  const routingDecision = modelLiveSeedRoutingDecisionV3Schema.parse({
    ...base.routingDecision,
    seedInputBindingDigest: stageInput.inputBindingDigest,
    ...Object.fromEntries(
      [
        "providerFamily",
        "providerId",
        "modelId",
        "modelVersion",
        "inferenceProfileId",
      ].map((key) => [key, Reflect.get(descriptor, key)]),
    ),
    ...Object.fromEntries(
      [
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
      ].map((key) => [key, Reflect.get(route, key)]),
    ),
    modelCapabilityVersion: route.capabilityVersion,
    maximumOutputTokens: invocation.maximumOutputTokens,
    timeoutMilliseconds: invocation.timeoutMilliseconds,
    requestedMode: descriptor.requestedMode,
    routingConfigurationDigest: prepared.routingConfigurationDigest,
    entitlement: {
      ...base.routingDecision.entitlement,
      planKey: routingRequest.plan.key,
    },
    evaluationPolicyId: policy.evaluationRequirement.evaluationPolicyId,
    evaluationPolicyVersion:
      policy.evaluationRequirement.evaluationPolicyVersion,
    requestBinding: {
      inputDigest: stageInput.operationInputDigest,
      idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
      scopeDigest: routingRequest.scopeDigest,
      routingRequestDigest: digest(routingRequest),
    },
  });
  const commercialRequest = {
    ...base.commercialRequest,
    ...{
      organizationId: scope.organizationId,
      projectId: required(scope.projectId),
      userId: scope.userId,
    },
    environment: plan.definition.scope.environment,
    jobId: required(scope.jobId),
    requestedAt,
    expiresAt,
    idempotencyKey: "synthetic_seed_stage_idempotency",
    promptId: tuple.promptTemplateId,
    promptVersion: tuple.promptTemplateVersion,
    requestedMaximumOutputUnits: invocation.maximumOutputTokens,
    plannedCalls: base.commercialRequest.plannedCalls.map((call) => ({
      ...call,
      maximumUsage: {
        ...call.maximumUsage,
        outputUnits: invocation.maximumOutputTokens,
        totalUnits:
          call.maximumUsage.inputUnits + invocation.maximumOutputTokens,
      },
    })),
  };
  const admissionRequest =
    modelLiveSequenceRuntimeAdmissionRequestV3Schema.parse(
      hash(
        {
          ...base.admissionRequest,
          ...stage,
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          userId: scope.userId,
          plan: plan.definition.scope.plan,
          runtimePolicyDigest: policy.policyDigest,
          cacheKeyAuthority: policy.cacheKeyAuthority,
          inputDigest: stageInput.operationInputDigest,
          idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
          capabilityRegistryDigest: tuple.capabilityRegistryDigest,
          routeRegistryDigest: tuple.routeRegistryDigest,
          catalogDigest: tuple.catalogDigest,
          promptTemplateDigest: tuple.promptTemplateDigest,
          responseSchemaDigest: tuple.responseSchemaDigest,
          routingDecisionDigest: digest(routingDecision),
          requested: prepared.requested,
          commercialEstimate: hash(
            {
              ...base.admissionRequest.commercialEstimate,
              pricingVersionReference: route.pricingVersionReference,
            },
            "estimateDigest",
          ),
        },
        "requestDigest",
      ),
    );
  const admissionDecision =
    modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse(
      hash(
        {
          ...base.admissionDecision,
          ...stage,
          decidedAt: requestedAt,
          expiresAt,
          requestDigest: admissionRequest.requestDigest,
          routingDecisionDigest: admissionRequest.routingDecisionDigest,
          runtimePolicyDigest: policy.policyDigest,
          commercialEstimateDigest:
            admissionRequest.commercialEstimate.estimateDigest,
        },
        "decisionDigest",
      ),
    );
  const execution = {
    plan,
    selection,
    stageInput,
    admissionRequest,
    admissionDecision,
    routingRequest,
    routingDecision,
    commercialRequest,
  };
  parseModelLiveSeedRuntimeExecutionV3(execution);
  return execution;
}

/** Synthetic two-slot metadata for the same actual host-fixture bytes. */
export function seedRuntimeExecutionForPreparedV4(
  prepared: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
  stageInput: ModelLiveSequenceInputV3,
  lifetimeMilliseconds = 240000,
) {
  const base = seedRuntimeExecutionForPrepared(
    prepared,
    stageInput,
    lifetimeMilliseconds,
  );
  const descriptor = prepared.invocation.descriptor;
  const original = required(base.commercialRequest.plannedCalls[0]);
  const calls = [
    {
      ...original,
      minimumUsage: {
        ...original.minimumUsage,
        inputUnits: original.maximumUsage.inputUnits,
        totalUnits: original.maximumUsage.inputUnits,
      },
    },
    {
      ...original,
      minimumUsage: { ...original.minimumUsage, inputUnits: 0, totalUnits: 0 },
    },
  ];
  const commercialRequest = {
    ...base.commercialRequest,
    plannedCalls: calls,
    reservationId: descriptor.budgetDecisionId,
    requestedMaximumInputUnits: original.maximumUsage.inputUnits * 2,
    requestedMaximumOutputUnits: original.maximumUsage.outputUnits * 2,
  };
  const routingRequest = modelRoutingRequestV1Schema.parse({
    ...base.routingRequest,
    plan: {
      ...base.routingRequest.plan,
      entitlementDecisionId: descriptor.entitlementDecisionId,
    },
  });
  const routingDecision = modelLiveSeedRoutingDecisionV3Schema.parse({
    ...base.routingDecision,
    entitlement: {
      ...base.routingDecision.entitlement,
      decisionId: descriptor.entitlementDecisionId,
    },
    requestBinding: {
      ...base.routingDecision.requestBinding,
      routingRequestDigest: digest(routingRequest),
    },
  });
  const admissionRequest =
    modelLiveSequenceRuntimeAdmissionRequestV4Schema.parse(
      hash(
        {
          ...base.admissionRequest,
          contractVersion: 4,
          parentSequenceContractVersion: 3,
          canonicalPlannedCallsDigest: digest(calls),
          routingDecisionDigest: digest(routingDecision),
        },
        "requestDigest",
      ),
    );
  const admissionDecision =
    modelLiveSequenceRuntimeAdmissionDecisionV4Schema.parse(
      hash(
        {
          ...base.admissionDecision,
          contractVersion: 4,
          parentSequenceContractVersion: 3,
          canonicalPlannedCallsDigest: digest(calls),
          requestDigest: admissionRequest.requestDigest,
          routingDecisionDigest: admissionRequest.routingDecisionDigest,
          authorization: {
            ...base.admissionDecision.authorization,
            commercialReservationDecisionId: descriptor.budgetDecisionId,
            entitlementDecisionId: descriptor.entitlementDecisionId,
          },
        },
        "decisionDigest",
      ),
    );
  const execution = {
    ...base,
    commercialRequest,
    routingRequest,
    routingDecision,
    admissionRequest,
    admissionDecision,
  };
  parseModelLiveSeedRuntimeExecutionV4(execution);
  return execution;
}
