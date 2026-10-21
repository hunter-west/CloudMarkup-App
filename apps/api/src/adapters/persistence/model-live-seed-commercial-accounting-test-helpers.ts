import { seedSequenceRuntimeAdmissionFixtureV4 } from "./model-live-seed-runtime-admission-v4-test-helpers.js";
import {
  digestStructuredValue as digest,
  parseModelLiveSeedRuntimeExecutionV3,
  parseModelLiveSeedRuntimeExecutionV4,
  projectModelLiveSeedRuntimeExecutionIdentityV4,
  type ModelLiveSeedRuntimeExecutionInputV4,
  projectModelLiveSeedRuntimeExecutionIdentityV3,
  type ModelCommercialRouteV1,
  type ModelLiveSeedRuntimeExecutionInputV3,
} from "@cloudmarkup/model-gateway";
import {
  syntheticSeedRuntimeFixtureV3,
  syntheticSeedSequenceRuntimeFixtureV4,
} from "@cloudmarkup/model-gateway/testing";
import {
  modelLiveSeedRoutingDecisionV3Schema,
  modelRoutingRequestV1Schema,
  modelLiveSequenceRuntimeAdmissionRequestV3Schema,
  modelLiveSequenceRuntimeAdmissionRequestV4Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV4Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
  modelRuntimeStateSnapshotV1Schema,
} from "@cloudmarkup/schemas";
import { modelAccountingFixture } from "./model-commercial-accounting-test-helpers.js";
import { commercialScope } from "./model-commercial-workflow-test-helpers.js";
import { seedRuntimeAdmissionFixture } from "./model-live-seed-runtime-admission-test-helpers.js";
import {
  parseSeedRuntimeRecord,
  parseSeedRuntimeRecordV4,
} from "./model-live-seed-runtime-admission-codec.js";
import { runtimeWindow } from "./model-runtime-admission-codec.js";
import { modelSeedAccountingBindingSchema } from "./model-live-seed-commercial-accounting-codec.js";
type SeedAccountingOptions = Pick<
  NonNullable<Parameters<typeof modelAccountingFixture>[4]>,
  "pricing" | "normalization" | "authorization"
>;
const rehash = <T extends object>(value: T, key: string) => ({
  ...value,
  [key]: digest(
    Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)),
  ),
});
/** The real coordinator produces synthetic reservation metadata. An optional
 * prepared host fixture and canonical test price do not establish live usage. */
export async function seedAccountingFixture(
  supplied?: ModelLiveSeedRuntimeExecutionInputV3,
  options: SeedAccountingOptions = {},
) {
  const initial = supplied ?? syntheticSeedRuntimeFixtureV3().input;
  const {
    plan,
    selection,
    stageInput,
    scope,
    windows,
    fixture,
    workflow,
    routingRequest,
    routingDecision,
    commercialEstimate,
  } = await seedAccountingContext(initial, options);
  const request = modelLiveSequenceRuntimeAdmissionRequestV3Schema.parse(
    rehash(
      {
        ...initial.admissionRequest,
        routingDecisionDigest: digest(routingDecision),
        commercialEstimate,
      },
      "requestDigest",
    ),
  );
  const decision = modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse(
    rehash(
      {
        ...initial.admissionDecision,
        routingDecisionDigest: request.routingDecisionDigest,
        requestDigest: request.requestDigest,
        commercialEstimateDigest: request.commercialEstimate.estimateDigest,
      },
      "decisionDigest",
    ),
  );
  const execution = {
    ...initial,
    routingRequest,
    routingDecision,
    commercialRequest: workflow.request,
    admissionRequest: request,
    admissionDecision: decision,
  };
  const parsed = parseModelLiveSeedRuntimeExecutionV3(execution);
  const identity = projectModelLiveSeedRuntimeExecutionIdentityV3(execution);
  const original = seedRuntimeAdmissionFixture().record();
  const emptyWindow = (seconds: number) => {
    const bounds = runtimeWindow(decision.decidedAt, seconds);
    return {
      activeConcurrentJobs: 0,
      requestCount: 0,
      windowStartedAt: bounds.startsAt,
      windowEndsAt: bounds.endsAt,
    };
  };
  const originalSnapshot = modelRuntimeStateSnapshotV1Schema.parse(
    rehash(
      {
        ...original.originalSnapshot,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        userId: scope.userId,
        capturedAt: decision.decidedAt,
        requestDigest: request.requestDigest,
        policyDigest: request.runtimePolicyDigest,
        windows: {
          organization: emptyWindow(windows.organization.windowSeconds),
          user: emptyWindow(windows.user.windowSeconds),
        },
        liveAuthorityUsage: {
          ...original.originalSnapshot.liveAuthorityUsage,
          authorityDigest: plan.approval.approvalDigest,
        },
      },
      "snapshotDigest",
    ),
  );
  const runtime = parseSeedRuntimeRecord(
    {
      ...original,
      request,
      decision,
      originalSnapshot,
      ...identity,
      commercialExpiresAt: workflow.request.expiresAt,
      concurrencyLeaseId: decision.authorization.concurrencyLeaseId,
      executionLease: {
        ...original.executionLease,
        acquiredAt: decision.decidedAt,
        expiresAt: workflow.request.expiresAt,
      },
      liveAuthorityReservation: parsed.liveAuthorityReservation,
    },
    scope,
  );
  const binding = modelSeedAccountingBindingSchema.parse({
    workflowId: workflow.request.multiCallWorkflowId,
    workflowFingerprint: workflow.fingerprint,
    runtimeScopeDigest: runtime.tenantScopeDigest,
    runtimeFingerprint: runtime.fingerprint,
    routingDecision,
  });
  return {
    fixture,
    workflow,
    runtime,
    binding,
    plan,
    selection,
    stageInput,
    execution,
    identity,
  };
}

export async function seedSequenceAccountingFixtureV4(
  supplied?: ModelLiveSeedRuntimeExecutionInputV4,
  options: SeedAccountingOptions = {},
) {
  const initial = supplied ?? syntheticSeedSequenceRuntimeFixtureV4();
  const {
    plan,
    selection,
    stageInput,
    scope,
    windows,
    fixture,
    workflow,
    routingRequest,
    routingDecision,
    commercialEstimate,
  } = await seedAccountingContext(initial, options);
  const request = modelLiveSequenceRuntimeAdmissionRequestV4Schema.parse(
    rehash(
      {
        ...initial.admissionRequest,
        routingDecisionDigest: digest(routingDecision),
        commercialEstimate,
      },
      "requestDigest",
    ),
  );
  const decision = modelLiveSequenceRuntimeAdmissionDecisionV4Schema.parse(
    rehash(
      {
        ...initial.admissionDecision,
        routingDecisionDigest: request.routingDecisionDigest,
        requestDigest: request.requestDigest,
        commercialEstimateDigest: request.commercialEstimate.estimateDigest,
      },
      "decisionDigest",
    ),
  );
  const execution = {
    ...initial,
    routingRequest,
    routingDecision,
    commercialRequest: workflow.request,
    admissionRequest: request,
    admissionDecision: decision,
  };
  const parsed = parseModelLiveSeedRuntimeExecutionV4(execution);
  const identity = projectModelLiveSeedRuntimeExecutionIdentityV4(execution);
  const original = seedSequenceRuntimeAdmissionFixtureV4().record();
  const emptyWindow = (seconds: number) => {
    const bounds = runtimeWindow(decision.decidedAt, seconds);
    return {
      activeConcurrentJobs: 0,
      requestCount: 0,
      windowStartedAt: bounds.startsAt,
      windowEndsAt: bounds.endsAt,
    };
  };
  const originalSnapshot = modelRuntimeStateSnapshotV1Schema.parse(
    rehash(
      {
        ...original.originalSnapshot,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        userId: scope.userId,
        capturedAt: decision.decidedAt,
        requestDigest: request.requestDigest,
        policyDigest: request.runtimePolicyDigest,
        windows: {
          organization: emptyWindow(windows.organization.windowSeconds),
          user: emptyWindow(windows.user.windowSeconds),
        },
        liveAuthorityUsage: {
          ...original.originalSnapshot.liveAuthorityUsage,
          authorityDigest: plan.approval.approvalDigest,
        },
      },
      "snapshotDigest",
    ),
  );
  const runtime = parseSeedRuntimeRecordV4(
    {
      ...original,
      request,
      decision,
      originalSnapshot,
      ...identity,
      commercialExpiresAt: workflow.request.expiresAt,
      concurrencyLeaseId: decision.authorization.concurrencyLeaseId,
      executionLease: {
        ...original.executionLease,
        acquiredAt: decision.decidedAt,
        expiresAt: workflow.request.expiresAt,
      },
      liveAuthorityReservation: parsed.liveAuthorityReservation,
    },
    scope,
  );
  const binding = modelSeedAccountingBindingSchema.parse({
    workflowId: workflow.request.multiCallWorkflowId,
    workflowFingerprint: workflow.fingerprint,
    runtimeScopeDigest: runtime.tenantScopeDigest,
    runtimeFingerprint: runtime.fingerprint,
    routingDecision,
  });
  return {
    fixture,
    workflow,
    runtime,
    binding,
    plan,
    selection,
    stageInput,
    execution,
    identity,
  };
}

async function seedAccountingContext(
  initial:
    ModelLiveSeedRuntimeExecutionInputV3 | ModelLiveSeedRuntimeExecutionInputV4,
  options: SeedAccountingOptions,
) {
  const { plan, selection, stageInput } = initial;
  const routing = initial.routingDecision;
  const route: ModelCommercialRouteV1 = {
    explanation: "Synthetic first-seed accounting fixture.",
    inferenceProfileId: routing.inferenceProfileId,
    label: "Deep Design",
    modelId: routing.modelId,
    modelVersion: routing.modelVersion,
    providerKey: routing.providerId,
    route: "deep",
    routeId: routing.routeId,
  };
  const scope = commercialScope(
    plan.definition.scope.organizationId,
    plan.definition.scope.projectId,
    plan.definition.scope.userId,
  );
  const windows = plan.definition.policy.requestWindows;
  const fixture = await modelAccountingFixture(
    initial.commercialRequest.requestedAt,
    scope,
    "",
    {
      featureRequests: {
        current: 0,
        maximum: windows.organization.maximumRequests,
      },
      perUserRequests: { current: 0, maximum: windows.user.maximumRequests },
      organizationConcurrentReservations: {
        current: 0,
        maximum: windows.organization.maximumConcurrentJobs,
      },
    },
    {
      request: initial.commercialRequest,
      ...(initial.admissionRequest.contractVersion === 4
        ? {
            expiresAfterMilliseconds:
              Date.parse(initial.commercialRequest.expiresAt) -
              Date.parse(initial.commercialRequest.requestedAt),
          }
        : {}),
      route,
      pricing: {
        environment: plan.definition.scope.environment,
        ...options.pricing,
      },
      ...(options.normalization === undefined
        ? {}
        : { normalization: options.normalization }),
      authorization: {
        planVersionId: routing.entitlement.planVersionId,
        ...(initial.admissionRequest.contractVersion === 4
          ? {
              maximumInputUnits:
                initial.commercialRequest.requestedMaximumInputUnits,
              maximumOutputUnits:
                initial.commercialRequest.requestedMaximumOutputUnits,
            }
          : {}),
        ...options.authorization,
      },
    },
  );
  const workflow = fixture.record;
  const context = workflow.resolvedContext;
  if (context === null) throw Error("Missing synthetic coordinator context");
  const routingRequest = modelRoutingRequestV1Schema.parse({
    ...initial.routingRequest,
    plan: {
      ...initial.routingRequest.plan,
      versionId: context.authorization.planVersionId,
    },
    creditAuthorization: {
      ...initial.routingRequest.creditAuthorization,
      acceptedEstimateMaximumCreditUnits: fixture.input.requestedCreditUnits,
    },
  });
  const routingDecision = modelLiveSeedRoutingDecisionV3Schema.parse({
    ...routing,
    maximumOutputTokens:
      initial.admissionRequest.contractVersion === 4
        ? initial.admissionRequest.requested.outputTokens
        : workflow.request.requestedMaximumOutputUnits,
    entitlement: {
      ...routing.entitlement,
      planVersionId: context.authorization.planVersionId,
    },
    requestBinding: {
      ...routing.requestBinding,
      routingRequestDigest: digest(routingRequest),
    },
    pricingVersionReference: context.estimateResult.primaryPricingVersionId,
    customerCharge: {
      ...routing.customerCharge,
      acceptedMaximumCreditUnits: fixture.input.requestedCreditUnits,
    },
  });
  const commercialEstimate = rehash(
    {
      canonicalAuthority: "canonical-commercial-v1",
      estimatedMicroUsd:
        context.estimateResult.maximumEstimatedProviderCostMicros,
      maximumCreditUnits: fixture.input.requestedCreditUnits,
      pricingVersionReference: context.estimateResult.primaryPricingVersionId,
    },
    "estimateDigest",
  );
  return {
    plan,
    selection,
    stageInput,
    scope,
    windows,
    fixture,
    workflow,
    routingRequest,
    routingDecision,
    commercialEstimate,
  };
}
