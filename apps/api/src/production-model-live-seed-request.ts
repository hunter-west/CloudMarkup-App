import {
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  prepareModelLiveSeedRoutingDecisionV3,
  prepareModelLiveSeedRuntimeExecutionV3,
  prepareModelLiveSeedRuntimeExecutionV4,
  digestStructuredValue,
  type ModelCommercialOperationRequestV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceRuntimeAdmissionRequestV3Schema,
  modelLiveSequenceRuntimeAdmissionRequestV4Schema,
  modelRoutingRequestV1Schema,
} from "@cloudmarkup/schemas";
import { calculateSeedSequenceBudgetV4 } from "./production-model-live-seed-sequence-budget.js";
import { prepareProductionSeedRepairCountV3 } from "./production-model-live-seed-counted-preparation.js";
import { projectModelLiveRoutingConfiguration } from "./adapters/persistence/model-live-routing-configuration.js";
import { modelReadNumber } from "./adapters/persistence/model-commercial-read-host-codec.js";
import { sequenceSelectionReferenceSchema } from "./adapters/persistence/model-live-sequence-authority-codec.js";

type CountedInput = Parameters<typeof prepareProductionSeedRepairCountV3>[0];
const same = (left: unknown, right: unknown) =>
  digestStructuredValue(left) === digestStructuredValue(right);
function requirePrepared(condition: boolean): asserts condition {
  if (!condition)
    throw new Error("Current first-seed request preparation is unavailable.");
}

/** Private fixed-seed host composition. Reconstructs and authenticates source
 * through the closed sequence host, counts the final static payload once, and builds
 * routing/commercial/runtime metadata from current canonical observations.
 * An issued evaluation approval covers only its bounded evaluation estimate.
 * No runtime claim, canonical reservation, model inference or promotion occurs.
 * An existing input returns metadata only and cannot resurrect lost RAM. */
type ProductionSeedRequestInput = Omit<
  CountedInput,
  "invocation" | "configuration"
> & {
  readonly requestedMode: "guided" | "professional";
  readonly jobId: string;
  readonly maximumOutputBytes: number;
  readonly maximumOutputTokens: number;
  readonly timeoutMilliseconds: number;
  readonly ids: Pick<
    ModelCommercialOperationRequestV1,
    | "eventIdPrefix"
    | "idempotencyKey"
    | "multiCallWorkflowId"
    | "requestId"
    | "reservationId"
  > & {
    readonly admissionDecisionId: string;
    readonly concurrencyLeaseId: string;
  };
};

async function prepareProductionSeedSource(input: ProductionSeedRequestInput) {
  const ids = structuredClone(input.ids);
  const reference = sequenceSelectionReferenceSchema.parse(input.reference);
  const planReference = {
    definitionId: reference.definitionId,
    planDigest: reference.planDigest,
  };
  const now = input.now ?? (() => new Date());
  const active = (expiresAt?: string) => {
    requirePrepared(!input.signal?.aborted);
    if (expiresAt !== undefined) {
      const observed = now().getTime();
      requirePrepared(
        Number.isFinite(observed) && observed < Date.parse(expiresAt),
      );
    }
  };
  active();

  const { invocation, configuration } =
    await input.sequences.prepareSeedRepairInvocation(
      {
        reference,
        caseId: input.caseId,
        requestedMode: input.requestedMode,
        selectors: input.selectors,
        controls: {
          jobId: input.jobId,
          idempotencyKey: ids.idempotencyKey,
          reservationId: ids.reservationId,
          maximumOutputBytes: input.maximumOutputBytes,
          maximumOutputTokens: input.maximumOutputTokens,
          timeoutMilliseconds: input.timeoutMilliseconds,
        },
      },
      input.signal,
    );
  const plan = await input.sequences.requireCurrent(planReference);
  const selection = await input.sequences.requireCurrentSelection(reference);
  const counted = await prepareProductionSeedRepairCountV3({
    ...input,
    invocation,
    configuration,
    reference,
  });
  requirePrepared(
    invocation.descriptor.entitlementDecisionId ===
      counted.snapshot.entitlement.entitlementSnapshotId &&
      invocation.descriptor.budgetDecisionId === ids.reservationId,
  );
  active(counted.expiresAt);
  const stageRequest = { reference, caseId: input.caseId, invocation };
  const issued = await input.sequences.issueSeedRepairInput(
    stageRequest,
    input.signal,
  );
  if (issued.kind === "existing") return issued;
  requirePrepared(
    issued.record.preparedPayloadDigest === counted.count.invocationDigest &&
      same(issued.invocation, invocation) &&
      issued.configurationDigest === counted.snapshot.configurationDigest,
  );
  active(counted.expiresAt);
  const current = await input.sequences.readSeedRepairCommercialPreflight(
    { ...stageRequest, selectors: input.selectors },
    input.signal,
  );
  requirePrepared(
    same(current.price, counted.snapshot.price) &&
      same(current.normalization, counted.snapshot.normalization) &&
      same(current.entitlement, counted.snapshot.entitlement) &&
      current.featureEnabled &&
      modelReadNumber(current.balance.availableCreditUnits) >=
        counted.maximumCreditUnits &&
      current.planDigest === plan.planDigest &&
      current.selectionId === selection.selectionId &&
      current.selectionDigest === selection.selectionDigest &&
      current.preparedPayloadDigest === counted.count.invocationDigest &&
      current.configurationDigest === counted.snapshot.configurationDigest,
  );
  const expiresAt = new Date(
    Math.min(
      Date.parse(counted.expiresAt),
      Date.parse(current.expiresAt),
      Date.parse(plan.expiresAt),
    ),
  ).toISOString();
  active(expiresAt);
  const observedAt = current.observedAt;
  requirePrepared(Date.parse(observedAt) >= Date.parse(issued.record.issuedAt));
  return {
    kind: "issued" as const,
    reference,
    ids,
    invocation,
    configuration,
    plan,
    selection,
    counted,
    issued,
    current,
    active,
    observedAt,
    expiresAt,
  };
}

export async function prepareProductionSeedRepairRequestV3(
  input: ProductionSeedRequestInput,
) {
  const source = await prepareProductionSeedSource(input);
  if (source.kind === "existing") return source;
  const {
    ids,
    invocation,
    plan,
    selection,
    counted,
    issued,
    active,
    observedAt,
    expiresAt,
  } = source;
  const stageRequest = {
    reference: source.reference,
    caseId: input.caseId,
    invocation,
  };
  const { body, routing, routingRequest, routingDecision, commercialRequest } =
    prepareSeedRuntimeMetadata(input, source, {
      ...counted,
      expiresAt,
      plannedCalls: [counted.plannedCall],
    });
  const admissionRequest =
    modelLiveSequenceRuntimeAdmissionRequestV3Schema.parse({
      ...body,
      requestDigest: digestStructuredValue(body),
    });
  const execution = await prepareModelLiveSeedRuntimeExecutionV3({
    metadata: {
      plan,
      selection,
      stageInput: issued.record,
      admissionRequest,
      routingRequest,
      routingDecision,
      commercialRequest,
    },
    observedAt,
    decisionId: ids.admissionDecisionId,
    concurrencyLeaseId: ids.concurrencyLeaseId,
    store: {
      inspect: (state) =>
        input.sequences.inspectSeedRuntimeCapacity(
          {
            ...stageRequest,
            request: admissionRequest,
            state,
          },
          input.signal,
        ),
    },
  });
  active(expiresAt);
  const store = await input.sequences.createSeedRuntimeAdmission(
    { ...stageRequest, execution },
    input.signal,
  );
  active(expiresAt);
  return {
    kind: "prepared" as const,
    execution,
    invocation,
    route: issued.route,
    routing,
    store,
    counted,
  };
}

type PreparedSeedSource = Extract<
  Awaited<ReturnType<typeof prepareProductionSeedSource>>,
  { kind: "issued" }
>;
function prepareSeedRuntimeMetadata(
  input: ProductionSeedRequestInput,
  source: PreparedSeedSource,
  budget: Pick<
    ModelCommercialOperationRequestV1,
    | "plannedCalls"
    | "expiresAt"
    | "requestedMaximumInputUnits"
    | "requestedMaximumOutputUnits"
  > & {
    readonly maximumCreditUnits: number;
    readonly maximumEstimatedProviderCostMicros: number;
  },
) {
  const {
    ids,
    invocation,
    configuration,
    plan,
    selection,
    counted,
    issued,
    current,
    observedAt,
  } = source;
  const configured =
    configuration.contractVersion === 1
      ? createBedrockRoutingConfigurationV1({
          configuration: configuration,
          asOf: observedAt,
        })
      : prepareBedrockLiveEvaluationConfigurationV2({
          configuration: configuration,
          asOf: observedAt,
        });
  requirePrepared(
    digestStructuredValue(configuration) === current.configurationDigest,
  );
  const routing = projectModelLiveRoutingConfiguration(configured);
  const binding = plan.definition.cases.find(
    (entry) => entry.caseId === input.caseId,
  );
  requirePrepared(binding?.routeId === "internal-escalation");
  const tuple = binding.authorityBinding.authorityTuple;
  const scope = invocation.descriptor.scope;
  const routingRequest = modelRoutingRequestV1Schema.parse({
    accountRegionComplexity: "single-account-region",
    creditAuthorization: {
      acceptedEstimateMaximumCreditUnits: budget.maximumCreditUnits,
      allowed: true,
      availableCreditUnits: modelReadNumber(
        current.balance.availableCreditUnits,
      ),
      decisionId: ids.reservationId,
      estimateAccepted: true,
    },
    // This is the first model call. Its actual seed-validation failure is bound
    // separately by the issued stage input, never represented as a prior call.
    currentValidationState: "not-run",
    customCodeRequirement: "custom",
    edgeCount: current.requested.edgeCount,
    estimatedContextTokens: counted.count.inputTokens,
    environment: plan.definition.scope.environment,
    expectedOutputClass: "repair",
    externalResourceCount: 0,
    feature: invocation.request.operation,
    idempotencyKeyDigest: invocation.descriptor.idempotencyKeyDigest,
    inputDigest: invocation.descriptor.inputDigest,
    networkingComplexity: "none",
    nodeCount: current.requested.nodeCount,
    operationClass: "repair",
    organizationId: scope.organizationId,
    plan: {
      entitlementDecisionId: current.entitlement.entitlementSnapshotId,
      key: current.entitlement.planKey,
      versionId: current.entitlement.planVersionId,
    },
    principalId: scope.userId,
    projectId: scope.projectId,
    repositoryFileEstimate: current.requested.repositoryFiles,
    repositoryTokenEstimate: counted.count.inputTokens,
    requiredEvaluationPolicyId:
      plan.definition.policy.evaluationRequirement.evaluationPolicyId,
    requiredEvaluationPolicyVersion:
      plan.definition.policy.evaluationRequirement.evaluationPolicyVersion,
    requestedMode: invocation.request.requestedMode,
    securityComplianceSensitivity: "ordinary",
    selectedPreference: "automatic",
    serviceFamilyCount: 0,
    scopeDigest: digestStructuredValue(scope),
    workloadCount: 0,
  });
  const routingDecision = prepareModelLiveSeedRoutingDecisionV3({
    capabilityRegistry: configured.capabilityRegistry,
    routeRegistry: configured.routeRegistry,
    routingConfigurationDigest: digestStructuredValue(routing),
    request: routingRequest,
    plan,
    selection,
    stageInput: issued.record,
    observedAt,
    maximumOutputTokens: invocation.maximumOutputTokens,
    timeoutMilliseconds: invocation.timeoutMilliseconds,
  });
  requirePrepared(routingDecision.outcome === "selected");
  const commercialRequest = seedCommercialRequest(input, source, budget);
  const estimate = {
    canonicalAuthority: "canonical-commercial-v1",
    estimatedMicroUsd: budget.maximumEstimatedProviderCostMicros,
    maximumCreditUnits: budget.maximumCreditUnits,
    pricingVersionReference: current.price.pricingVersionId,
  };
  const body = {
    capabilityRegistryDigest: tuple.capabilityRegistryDigest,
    cacheKeyAuthority: plan.definition.policy.cacheKeyAuthority,
    catalogDigest: tuple.catalogDigest,
    commercialEstimate: {
      ...estimate,
      estimateDigest: digestStructuredValue(estimate),
    },
    contractVersion: 3,
    evaluationAuthorityTupleDigest:
      binding.authorityBinding.authorityTupleDigest,
    evaluationCaseDigest: binding.caseDigest,
    evaluationCaseId: binding.caseId,
    executionClass: "live-evaluation",
    idempotencyKeyDigest: invocation.descriptor.idempotencyKeyDigest,
    inputDigest: invocation.descriptor.inputDigest,
    liveEvaluationAuthorityDigest: plan.approval.approvalDigest,
    liveEvaluationPlanDigest: plan.planDigest,
    operation: tuple.operation,
    organizationId: scope.organizationId,
    plan: plan.definition.scope.plan,
    projectId: scope.projectId,
    promptTemplateDigest: tuple.promptTemplateDigest,
    recordKind: "model-live-sequence-runtime-admission-request",
    requested: current.requested,
    responseSchemaDigest: tuple.responseSchemaDigest,
    role: tuple.role,
    routeRegistryDigest: tuple.routeRegistryDigest,
    routingDecisionDigest: digestStructuredValue(routingDecision),
    runtimePolicyDigest: plan.definition.policy.policyDigest,
    userId: scope.userId,
    selectionId: selection.selectionId,
    selectionDigest: selection.selectionDigest,
    stageId: issued.record.stageId,
    stageKey: issued.record.stageKey,
    invocationId: issued.record.invocationId,
    inputBindingDigest: issued.record.inputBindingDigest,
    preparedPayloadDigest: issued.record.preparedPayloadDigest,
  };
  return { body, routing, routingRequest, routingDecision, commercialRequest };
}

function seedCommercialRequest(
  input: ProductionSeedRequestInput,
  source: PreparedSeedSource,
  budget: Pick<
    ModelCommercialOperationRequestV1,
    | "plannedCalls"
    | "expiresAt"
    | "requestedMaximumInputUnits"
    | "requestedMaximumOutputUnits"
  >,
): ModelCommercialOperationRequestV1 {
  const { ids, invocation, plan, observedAt } = source;
  const binding = plan.definition.cases.find(
    (entry) => entry.caseId === input.caseId,
  );
  requirePrepared(binding !== undefined);
  const tuple = binding.authorityBinding.authorityTuple;
  const scope = invocation.descriptor.scope;
  return {
    confirmationRequired: false,
    estimateAccepted: true,
    eventIdPrefix: ids.eventIdPrefix,
    idempotencyKey: ids.idempotencyKey,
    multiCallWorkflowId: ids.multiCallWorkflowId,
    requestId: ids.requestId,
    reservationId: ids.reservationId,
    expiresAt: budget.expiresAt,
    requestedAt: observedAt,
    feature: invocation.request.operation,
    jobId: scope.jobId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    plannedCalls: budget.plannedCalls,
    promptId: tuple.promptTemplateId,
    promptVersion: tuple.promptTemplateVersion,
    requestedMaximumInputUnits: budget.requestedMaximumInputUnits,
    requestedMaximumOutputUnits: budget.requestedMaximumOutputUnits,
    requestedRoute: "deep",
    templateId: null,
    templateVersion: null,
    includeTechnicalUnitDetail: true,
    environment: plan.definition.scope.environment,
  };
}

/** Actual counted two-slot request with read-only capacity preparation and a
 * closed runtime store. Claims, canonical reservation and dispatch are separate. */
export async function prepareProductionSeedSequenceRequestV4(
  input: ProductionSeedRequestInput,
) {
  const source = await prepareProductionSeedSource(input);
  if (source.kind === "existing") return source;
  source.active(source.counted.expiresAt);
  const budget = calculateSeedSequenceBudgetV4({
    ...source,
    caseId: input.caseId,
    observedAt: (input.now ?? (() => new Date()))().toISOString(),
  });
  const { body, routing, routingRequest, routingDecision, commercialRequest } =
    prepareSeedRuntimeMetadata(input, source, budget);
  const requestBody = {
    ...body,
    contractVersion: 4,
    parentSequenceContractVersion: 3,
    canonicalPlannedCallsDigest: digestStructuredValue(
      commercialRequest.plannedCalls,
    ),
  };
  const admissionRequest =
    modelLiveSequenceRuntimeAdmissionRequestV4Schema.parse({
      ...requestBody,
      requestDigest: digestStructuredValue(requestBody),
    });
  const stageRequest = {
    reference: source.reference,
    caseId: input.caseId,
    invocation: source.invocation,
  };
  const execution = await prepareModelLiveSeedRuntimeExecutionV4({
    metadata: {
      plan: source.plan,
      selection: source.selection,
      stageInput: source.issued.record,
      admissionRequest,
      routingRequest,
      routingDecision,
      commercialRequest,
    },
    observedAt: source.observedAt,
    decisionId: source.ids.admissionDecisionId,
    concurrencyLeaseId: source.ids.concurrencyLeaseId,
    store: {
      inspect: (state) =>
        input.sequences.inspectSeedRuntimeCapacityV4(
          {
            ...stageRequest,
            request: admissionRequest,
            state,
            commercialRequest,
          },
          input.signal,
        ),
    },
  });
  source.active(source.counted.expiresAt);
  const store = await input.sequences.createSeedRuntimeAdmissionV4(
    { ...stageRequest, execution },
    input.signal,
  );
  source.active(source.counted.expiresAt);
  return {
    kind: "prepared" as const,
    execution,
    invocation: source.invocation,
    route: source.issued.route,
    routing,
    store,
    counted: source.counted,
    budget,
  };
}
