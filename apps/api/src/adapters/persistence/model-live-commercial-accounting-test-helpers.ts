import {
  digestStructuredValue,
  sha256Text,
  type ModelLiveRuntimeControlExecutionInputV2,
  type ModelCommercialRouteV1,
  type ModelCommercialAuthorizationDecisionV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveEvaluationDefinitionV2Schema,
  modelEvaluationAuthorityTupleV1Schema,
  modelLiveEvaluationApprovalV2Schema,
  modelLiveEvaluationPlanV2Schema,
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelLiveRuntimeAdmissionDecisionV2Schema,
  modelRoutingDecisionV1Schema,
  modelRuntimeStateSnapshotV1Schema,
  modelLiveRuntimeControlPolicyV2Schema,
  type ModelLiveEvaluationPlanV2,
  type ModelLiveEvaluationDefinitionV2,
  type ModelRoutingDecisionV1,
  type ModelRuntimeInputEvidenceV1,
} from "@cloudmarkup/schemas";
import { modelAccountingFixture } from "./model-commercial-accounting-test-helpers.js";
import { liveRuntimeAdmissionFixture } from "./model-live-runtime-admission-test-helpers.js";
import {
  commercialRequest,
  commercialScope,
} from "./model-commercial-workflow-test-helpers.js";
import { admissionScopeDigest } from "./model-runtime-admission-codec.js";
import { parseLiveRuntimeRecord } from "./model-live-runtime-admission-codec.js";
import { modelLiveAccountingBindingSchema } from "./model-live-commercial-accounting-codec.js";

export function rehashLiveAccountingTestMetadata(
  raw: object,
  digestKey: string,
) {
  const body = Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== digestKey),
  );
  return { ...body, [digestKey]: digestStructuredValue(body) };
}
/** Synthetic coordinator-produced metadata; never issued approval, real pricing,
 * provider usage, validator evidence or terminal accounting authority. */
export interface LiveAccountingTestHost {
  /** Test-only extension after genuine approval, before request/routing preparation. */
  afterPlanIssued?(plan: ModelLiveEvaluationPlanV2): Promise<void>;
  readonly fullBetaEvaluationSource?: boolean;
  selectCaseId?(): string;
  selectPricingVersionId?(): string;
  bindRuntimeIdentity?(
    input: Omit<
      ModelLiveRuntimeControlExecutionInputV2,
      "routingRequest" | "promptCacheKey"
    >,
  ): { readonly fingerprint: string; readonly tenantScopeDigest: string };
  prepareDefinition(
    definition: ModelLiveEvaluationDefinitionV2,
    source: ReturnType<typeof liveRuntimeAdmissionFixture>,
  ): ModelLiveEvaluationDefinitionV2;
  selectRoute(): ModelCommercialRouteV1;
  bindRouting(
    routing: ModelRoutingDecisionV1,
    authority: {
      readonly plan: ModelLiveEvaluationPlanV2;
      readonly workflow: Awaited<
        ReturnType<typeof modelAccountingFixture>
      >["record"];
    },
  ): ModelRoutingDecisionV1;
  issueInput(input: {
    plan: ModelLiveEvaluationPlanV2;
    workflow: Awaited<ReturnType<typeof modelAccountingFixture>>["record"];
    routingDecision: ModelRoutingDecisionV1;
  }): Promise<ModelRuntimeInputEvidenceV1>;
}
export async function modelLiveAccountingFixture(
  input: Parameters<typeof liveRuntimeAdmissionFixture>[0] & {
    readonly expiresAfterMilliseconds?: number;
  } = {},
  issue?: (
    configuration: Pick<
      ReturnType<typeof liveRuntimeAdmissionFixture>,
      "definition" | "dataset" | "policy"
    >,
  ) => Promise<ModelLiveEvaluationPlanV2>,
  routeMode: "standard" | "deep" = "standard",
  commercialPolicy?: Pick<
    ModelCommercialAuthorizationDecisionV1,
    "planVersionId" | "chargingPolicyVersion" | "entitlementPolicyVersion"
  >,
  host?: LiveAccountingTestHost,
) {
  const sourceInput = {
    ...input,
    ...(host?.fullBetaEvaluationSource === true
      ? { fullBetaEvaluationSource: true }
      : {}),
  };
  let f = liveRuntimeAdmissionFixture(sourceInput);
  const first = f.plan.definition.cases[0];
  if (first === undefined) throw Error("Missing synthetic frozen case.");
  let tuple = modelEvaluationAuthorityTupleV1Schema.parse({
    ...first.authorityBinding.authorityTuple,
    inferenceProfileId: "cloudmarkup.synthetic.profile",
  });
  let entry: ModelLiveEvaluationDefinitionV2["cases"][number] = {
    ...first,
    routeId: routeMode === "deep" ? "deep-design" : "standard-design",
    authorityBinding: {
      authorityTuple: tuple,
      authorityTupleDigest: digestStructuredValue(tuple),
    },
  };
  const policy = modelLiveRuntimeControlPolicyV2Schema.parse(
    rehashLiveAccountingTestMetadata(
      {
        ...f.plan.definition.policy,
        allowlists: {
          ...f.plan.definition.policy.allowlists,
          routes:
            routeMode === "deep"
              ? ["standard-design", "deep-design"]
              : ["standard-design"],
        },
      },
      "policyDigest",
    ),
  );
  let definition = modelLiveEvaluationDefinitionV2Schema.parse(
    rehashLiveAccountingTestMetadata(
      {
        ...f.plan.definition,
        policy,
        cases: [entry, ...f.plan.definition.cases.slice(1)],
      },
      "definitionDigest",
    ),
  );
  if (host !== undefined) {
    definition = host.prepareDefinition(definition, f);
    const selectedCaseId = host.selectCaseId?.();
    const configuredCase =
      selectedCaseId === undefined
        ? definition.cases[0]
        : definition.cases.find((entry) => entry.caseId === selectedCaseId);
    if (configuredCase === undefined)
      throw Error("Missing synthetic host case.");
    entry = configuredCase;
    tuple = configuredCase.authorityBinding.authorityTuple;
  }
  const approval = modelLiveEvaluationApprovalV2Schema.parse(
    rehashLiveAccountingTestMetadata(
      {
        ...f.plan.approval,
        definitionDigest: definition.definitionDigest,
      },
      "approvalDigest",
    ),
  );
  let plan = modelLiveEvaluationPlanV2Schema.parse(
    rehashLiveAccountingTestMetadata(
      {
        ...f.plan,
        definition,
        approval,
      },
      "planDigest",
    ),
  );
  if (issue !== undefined) {
    plan = await issue({
      definition,
      dataset: f.dataset,
      policy: definition.policy,
    });
  }
  f = liveRuntimeAdmissionFixture({ ...sourceInput, now: plan.issuedAt }, plan);
  const route: ModelCommercialRouteV1 = host?.selectRoute() ?? {
    explanation: "Synthetic evaluation accounting fixture.",
    inferenceProfileId: tuple.inferenceProfileId ?? null,
    label: routeMode === "deep" ? "Deep Design" : "Standard Design",
    modelId: "cloudmarkup.synthetic.model",
    modelVersion: "synthetic",
    providerKey: "cloudmarkup.synthetic.provider",
    route: routeMode,
    routeId: entry.routeId,
  };
  const scope = commercialScope(
    f.scope.organizationId,
    f.scope.projectId,
    f.scope.userId,
  );
  const initial = commercialRequest(scope, f.now);
  const prepared = {
    ...initial,
    requestedRoute: routeMode,
    feature: tuple.operation,
    environment: definition.scope.environment,
    promptId: tuple.promptTemplateId,
    promptVersion: tuple.promptTemplateVersion,
    plannedCalls: initial.plannedCalls.map((call) => ({
      ...call,
      routeId: route.routeId,
    })),
  };
  const fixture = await modelAccountingFixture(
    f.now,
    scope,
    "",
    {
      featureRequests: {
        current: 0,
        maximum: definition.policy.requestWindows.organization.maximumRequests,
      },
      perUserRequests: {
        current: 0,
        maximum: definition.policy.requestWindows.user.maximumRequests,
      },
      organizationConcurrentReservations: {
        current: 0,
        maximum:
          definition.policy.requestWindows.organization.maximumConcurrentJobs,
      },
    },
    {
      request: prepared,
      route,
      ...(input.expiresAfterMilliseconds === undefined
        ? {}
        : { expiresAfterMilliseconds: input.expiresAfterMilliseconds }),
      pricing: {
        environment: definition.scope.environment,
        ...(host?.selectPricingVersionId === undefined
          ? {}
          : { pricingVersionId: host.selectPricingVersionId() }),
      },
      ...(commercialPolicy === undefined
        ? {}
        : { authorization: commercialPolicy }),
    },
  );
  if (fixture.request.feature !== tuple.operation)
    throw Error("Expected the exact synthetic evaluation operation.");
  const workflow = fixture.record;
  const context = workflow.resolvedContext;
  const call = workflow.request.plannedCalls[0];
  if (context === null || call === undefined)
    throw Error("Missing coordinator estimate.");
  const h = digestStructuredValue("synthetic metadata");
  let routingDecision = modelRoutingDecisionV1Schema.parse({
    automaticEscalationPermitted: false,
    capabilityRegistryDigest: tuple.capabilityRegistryDigest,
    capabilityRegistryId: "cloudmarkup.synthetic.capabilities",
    capabilityRegistryVersion: "1.0.0",
    contractVersion: 1,
    creditAuthorization: {
      allowed: true,
      decisionId: "synthetic_credit",
      estimateAccepted: true,
    },
    customerCharge: {
      acceptedMaximumCreditUnits: fixture.input.requestedCreditUnits,
      incrementalEscalationCreditUnits: 0,
      policy: "accepted-estimate-cap",
    },
    effort: "medium",
    evaluationResultDigest: h,
    evaluationResultVersion: "1.0.0",
    entitlement: {
      allowed: true,
      decisionId: "synthetic_entitlement",
      planKey: definition.scope.plan,
      planVersionId: context.authorization.planVersionId,
    },
    estimateClass: "standard",
    evaluationPolicyId:
      definition.policy.evaluationRequirement.evaluationPolicyId,
    evaluationPolicyVersion:
      definition.policy.evaluationRequirement.evaluationPolicyVersion,
    feature: tuple.operation,
    inferenceProfileId: tuple.inferenceProfileId,
    maximumAttempts: 1,
    maximumOutputTokens: workflow.request.requestedMaximumOutputUnits,
    modelCapabilityVersion: "1.0.0",
    modelCapabilityDigest: h,
    modelConfigurationReference: tuple.modelConfigurationReference,
    modelFamily: "cloudmarkup.synthetic.family",
    modelId: route.modelId,
    modelVersion: route.modelVersion,
    outcome: "selected",
    pricingVersionReference: context.estimateResult.primaryPricingVersionId,
    promptCachePolicy: {
      cacheKeyRequired: false,
      enabled: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
    providerId: route.providerKey,
    providerFamily: "deterministic-fake",
    reasonCodes: ["standard-default"],
    recommendedServiceLevel: route.routeId,
    requestedMode: "guided",
    routeId: entry.routeId,
    routeDefinitionDigest: tuple.routeDefinitionDigest,
    routeRegistryId: "cloudmarkup.synthetic.routes",
    routeRegistryDigest: tuple.routeRegistryDigest,
    routeRegistryVersion: "1.0.0",
    routingConfigurationDigest: h,
    requestBinding: {
      idempotencyKeyDigest: sha256Text(workflow.request.idempotencyKey),
      inputDigest: entry.invocationInputDigest,
      routingRequestDigest: h,
      scopeDigest: digestStructuredValue(f.scope),
    },
    timeoutMilliseconds: 120000,
    userConfirmationRequired: false,
  });
  if (host !== undefined)
    routingDecision = host.bindRouting(routingDecision, { plan, workflow });
  const hostEvidence = await host?.issueInput({
    plan,
    workflow,
    routingDecision,
  });
  const estimateBody = {
    canonicalAuthority: "canonical-commercial-v1",
    estimatedMicroUsd:
      context.estimateResult.maximumEstimatedProviderCostMicros,
    maximumCreditUnits: fixture.input.requestedCreditUnits,
    pricingVersionReference: context.estimateResult.primaryPricingVersionId,
  };
  const request = modelLiveRuntimeAdmissionRequestV2Schema.parse(
    rehashLiveAccountingTestMetadata(
      {
        ...f.request,
        ...(hostEvidence === undefined
          ? {}
          : {
              capabilityRegistryDigest: tuple.capabilityRegistryDigest,
              routeRegistryDigest: tuple.routeRegistryDigest,
              catalogDigest: tuple.catalogDigest,
              operation: tuple.operation,
              role: tuple.role,
              promptTemplateDigest: tuple.promptTemplateDigest,
              responseSchemaDigest: tuple.responseSchemaDigest,
              inputDigest: entry.invocationInputDigest,
              inputEvidenceDigest: hostEvidence.evidenceDigest,
            }),
        evaluationCaseId: entry.caseId,
        evaluationCaseDigest: entry.caseDigest,
        liveEvaluationPlanDigest: plan.planDigest,
        liveEvaluationAuthorityDigest: plan.approval.approvalDigest,
        evaluationAuthorityTupleDigest:
          entry.authorityBinding.authorityTupleDigest,
        idempotencyKeyDigest: sha256Text(workflow.request.idempotencyKey),
        routingDecisionDigest: digestStructuredValue(routingDecision),
        requested: {
          ...(hostEvidence?.requested ?? f.request.requested),
          outputTokens: workflow.request.requestedMaximumOutputUnits,
        },
        commercialEstimate: {
          ...estimateBody,
          estimateDigest: digestStructuredValue(estimateBody),
        },
      },
      "requestDigest",
    ),
  );
  const decision = modelLiveRuntimeAdmissionDecisionV2Schema.parse(
    rehashLiveAccountingTestMetadata(
      {
        ...f.decision,
        requestDigest: request.requestDigest,
        evaluationCaseId: request.evaluationCaseId,
        evaluationCaseDigest: request.evaluationCaseDigest,
        routingDecisionDigest: request.routingDecisionDigest,
        commercialEstimateDigest: request.commercialEstimate.estimateDigest,
        liveEvaluationPlanDigest: plan.planDigest,
        liveEvaluationAuthorityDigest: plan.approval.approvalDigest,
        evaluationAuthorityTupleDigest:
          entry.authorityBinding.authorityTupleDigest,
        authorization: {
          ...f.decision.authorization,
          ...(hostEvidence === undefined
            ? {}
            : {
                entitlementDecisionId: routingDecision.entitlement.decisionId,
              }),
          commercialReservationDecisionId: workflow.request.reservationId,
        },
      },
      "decisionDigest",
    ),
  );
  const originalSnapshot = modelRuntimeStateSnapshotV1Schema.parse(
    rehashLiveAccountingTestMetadata(
      {
        ...f.emptySnapshot(),
        requestDigest: request.requestDigest,
        liveAuthorityUsage: {
          ...f.emptySnapshot().liveAuthorityUsage,
          authorityDigest: plan.approval.approvalDigest,
        },
      },
      "snapshotDigest",
    ),
  );
  if (host?.bindRuntimeIdentity !== undefined && hostEvidence === undefined)
    throw Error("Missing exact synthetic runtime evidence.");
  const identity =
    hostEvidence === undefined
      ? undefined
      : host?.bindRuntimeIdentity?.({
          plan,
          commercialRequest: workflow.request,
          admissionRequest: request,
          admissionDecision: decision,
          routingDecision,
          inputEvidence: hostEvidence,
        });
  const runtime = parseLiveRuntimeRecord(
    {
      ...f.record(),
      request,
      decision,
      originalSnapshot,
      tenantScopeDigest:
        identity?.tenantScopeDigest ?? admissionScopeDigest(request),
      commercialExpiresAt: workflow.request.expiresAt,
      fingerprint:
        identity?.fingerprint ??
        digestStructuredValue({ synthetic: true, request }),
      liveAuthorityReservation: {
        authorityDigest: plan.approval.approvalDigest,
        limits: definition.limits,
        planned: {
          cacheReadTokens: call.maximumUsage.cacheReadUnits,
          cacheWriteTokens: call.maximumUsage.cacheWriteUnits,
          creditUnits: fixture.input.requestedCreditUnits,
          estimatedMicroUsd: estimateBody.estimatedMicroUsd,
          inputTokens: call.maximumUsage.inputUnits,
          invocations: 1,
          outputTokens: call.maximumUsage.outputUnits,
          totalTokens: call.maximumUsage.totalUnits,
        },
      },
    },
    f.scope,
  );
  const binding = modelLiveAccountingBindingSchema.parse({
    workflowId: workflow.request.multiCallWorkflowId,
    workflowFingerprint: workflow.fingerprint,
    runtimeScopeDigest: runtime.tenantScopeDigest,
    runtimeFingerprint: runtime.fingerprint,
    routingDecision,
  });
  return { plan, workflow, runtime, binding, fixture, source: f };
}
