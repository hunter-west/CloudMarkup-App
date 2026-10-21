import { projectModelLiveRoutingConfiguration } from "./adapters/persistence/model-live-routing-configuration.js";
import {
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  prepareModelLiveRoutingDecisionV2,
  prepareModelLiveRuntimeExecutionV2,
  digestStructuredValue,
  sha256Text,
  type ModelGatewayInvocationContextV1,
  type ModelCommercialOperationRequestV1,
} from "@cloudmarkup/model-gateway";
import {
  modelInvocationDescriptorV1Schema,
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelRoutingRequestV1Schema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { prepareProductionModelLiveInputV2 } from "./production-model-live-preparation.js";
import { PostgresModelLiveRuntimeAdmissionStore } from "./adapters/persistence/model-live-runtime-admission-store.js";
import { PostgresModelLiveRuntimeHostEvidence } from "./adapters/persistence/model-live-runtime-host-evidence.js";
import { PostgresModelLiveRoutingAuthority } from "./adapters/persistence/model-live-routing-authority.js";
import { modelReadNumber } from "./adapters/persistence/model-commercial-read-host-codec.js";
import { parseScope } from "./adapters/persistence/model-runtime-invocation-codec.js";
import { sql } from "./adapters/persistence/sql.js";

type CountedInput = Parameters<typeof prepareProductionModelLiveInputV2>[0];
const same = (left: unknown, right: unknown) =>
  digestStructuredValue(left) === digestStructuredValue(right);
function requireRequest(value: boolean): asserts value {
  if (!value)
    throw new Error("Current counted evaluation request is unavailable.");
}

/** Build commercial and admission metadata from the real issued plan, full SDK
 * count, canonical prices/entitlements/balance and actual capacity inspection.
 * The source is a host-created exact frozen request/descriptor/context in RAM,
 * never a browser authority object. Its immutable scope/request/routing facts
 * are checked; its budget and entitlement amounts are replaced by canonical
 * observations. This still requires a workflow-specific frozen input producer.
 * No reservation, inference, report, normal activation or content persistence.
 * Approval of this bounded evaluation is authenticated by the actual plan store;
 * it is not user consent for any normal customer workflow. */
export async function prepareProductionModelLiveRequestV2(
  input: CountedInput & {
    readonly context: ModelGatewayInvocationContextV1;
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
  },
) {
  const source = structuredClone(input.invocation);
  const originalContext = structuredClone(input.context);
  const scope = parseScope(source.descriptor.scope);
  const ids = structuredClone(input.ids);
  const reference = {
    definitionId: input.definitionId,
    planDigest: input.planDigest,
  };
  const now = input.now ?? (() => new Date());
  requireRequest(scope.projectId !== undefined && scope.jobId !== undefined);
  requireRequest(
    originalContext.routingRequest !== undefined &&
      originalContext.routingRequest.priorAttempt === undefined &&
      originalContext.routingRequest.xhighEffortAuthorization === undefined &&
      originalContext.xhighEffortAuthorization === undefined &&
      same(originalContext.scope, scope) &&
      source.descriptor.invocationId === originalContext.invocationId &&
      source.descriptor.idempotencyKeyDigest === sha256Text(ids.idempotencyKey),
  );
  const first = await prepareProductionModelLiveInputV2(input);
  const preparedSource = await input.plans.withIssuedMetadata(
    reference,
    async ({ plan, transaction, requireCurrentApproval }) => {
      await requireCurrentApproval();
      requireRequest(
        !input.signal?.aborted &&
          same(await input.resolveCurrentConfiguration(), input.configuration),
      );
      const stamp = utcTimestampSchema.parse(
        (
          await transaction.query(
            sql(
              "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
            ),
          )
        ).rows[0]?.["now"],
      );
      const configured =
        input.configuration.contractVersion === 1
          ? createBedrockRoutingConfigurationV1({
              configuration: input.configuration,
              asOf: stamp,
            })
          : prepareBedrockLiveEvaluationConfigurationV2({
              configuration: input.configuration,
              asOf: stamp,
            });
      const binding = plan.definition.cases.find(
        (entry) => entry.caseId === input.caseId,
      );
      requireRequest(
        binding !== undefined && binding.routeId !== "internal-escalation",
      );
      const tuple = binding.authorityBinding.authorityTuple;
      const routing = projectModelLiveRoutingConfiguration(configured);
      const routingRequest = modelRoutingRequestV1Schema.parse({
        ...originalContext.routingRequest,
        creditAuthorization: {
          acceptedEstimateMaximumCreditUnits: first.maximumCreditUnits,
          allowed:
            first.snapshot.featureEnabled &&
            modelReadNumber(first.snapshot.balance.availableCreditUnits) >=
              first.maximumCreditUnits,
          availableCreditUnits: modelReadNumber(
            first.snapshot.balance.availableCreditUnits,
          ),
          decisionId: ids.reservationId,
          estimateAccepted: true,
        },
        estimatedContextTokens: first.count.inputTokens,
        environment: plan.definition.scope.environment,
        idempotencyKeyDigest: sha256Text(ids.idempotencyKey),
        inputDigest: source.descriptor.inputDigest,
        feature: source.request.operation,
        organizationId: scope.organizationId,
        principalId: scope.userId,
        projectId: scope.projectId,
        scopeDigest: digestStructuredValue(scope),
        plan: {
          entitlementDecisionId:
            first.snapshot.entitlement.entitlementSnapshotId,
          key: first.snapshot.entitlement.planKey,
          versionId: first.snapshot.entitlement.planVersionId,
        },
        requiredEvaluationPolicyId:
          plan.definition.policy.evaluationRequirement.evaluationPolicyId,
        requiredEvaluationPolicyVersion:
          plan.definition.policy.evaluationRequirement.evaluationPolicyVersion,
        requestedMode: source.request.requestedMode,
        selectedPreference: binding.routeId,
      });
      const decision = prepareModelLiveRoutingDecisionV2({
        capabilityRegistry: configured.capabilityRegistry,
        routeRegistry: configured.routeRegistry,
        request: routingRequest,
        routingConfigurationDigest: digestStructuredValue(routing),
        plan,
        caseId: input.caseId,
        observedAt: stamp,
        maximumOutputTokens: source.maximumOutputTokens,
        timeoutMilliseconds: source.timeoutMilliseconds,
      });
      requireRequest(
        decision.outcome === "selected" &&
          source.descriptor.routing !== undefined,
      );
      const context: ModelGatewayInvocationContextV1 = {
        ...originalContext,
        requestedMode: source.request.requestedMode,
        idempotencyKeyDigest: routingRequest.idempotencyKeyDigest,
        evaluationPolicyId: routingRequest.requiredEvaluationPolicyId,
        evaluationPolicyVersion: routingRequest.requiredEvaluationPolicyVersion,
        entitlement: {
          allowed:
            decision.entitlement.allowed && first.snapshot.featureEnabled,
          allowedRoles: [tuple.role],
          decisionId: routingRequest.plan.entitlementDecisionId,
          planKey: routingRequest.plan.key,
          planVersionId: routingRequest.plan.versionId,
        },
        budget: {
          ...routingRequest.creditAuthorization,
          maximumCostTier:
            binding.routeId === "deep-design" ? "deep" : "standard",
        },
        routingRequest,
        routingDecision: decision,
      };
      const invocation = {
        ...source,
        descriptor: modelInvocationDescriptorV1Schema.parse({
          ...source.descriptor,
          budgetDecisionId: context.budget.decisionId,
          entitlementDecisionId: context.entitlement.decisionId,
          routing: {
            ...source.descriptor.routing,
            acceptedMaximumCreditUnits: first.maximumCreditUnits,
            routingConfigurationDigest: digestStructuredValue(routing),
            routingDecisionDigest: digestStructuredValue(decision),
          },
        }),
      };
      return { invocation, context, routing, plan, binding };
    },
  );
  // Count the final invocation again: the first count prices preparation, while
  // this receipt is bound to the final descriptor. Do not relabel a provisional
  // receipt as evidence for different metadata, even when wire bytes coincide.
  const counted = await prepareProductionModelLiveInputV2({
    ...input,
    invocation: preparedSource.invocation,
  });
  requireRequest(
    counted.count.inputTokens === first.count.inputTokens &&
      counted.maximumCreditUnits === first.maximumCreditUnits &&
      counted.maximumEstimatedProviderCostMicros ===
        first.maximumEstimatedProviderCostMicros &&
      same(counted.snapshot.price, first.snapshot.price) &&
      same(counted.snapshot.normalization, first.snapshot.normalization) &&
      same(counted.snapshot.entitlement, first.snapshot.entitlement),
  );
  const { plan, binding, context, invocation, routing } = preparedSource;
  const tuple = binding.authorityBinding.authorityTuple;
  const commercialRequest: ModelCommercialOperationRequestV1 = {
    confirmationRequired: false,
    estimateAccepted: true,
    eventIdPrefix: ids.eventIdPrefix,
    idempotencyKey: ids.idempotencyKey,
    multiCallWorkflowId: ids.multiCallWorkflowId,
    requestId: ids.requestId,
    reservationId: ids.reservationId,
    expiresAt: counted.expiresAt,
    requestedAt: counted.snapshot.observedAt,
    feature: invocation.request.operation,
    jobId: scope.jobId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    plannedCalls: [counted.plannedCall],
    promptId: tuple.promptTemplateId,
    promptVersion: tuple.promptTemplateVersion,
    requestedMaximumInputUnits: counted.requestedMaximumInputUnits,
    requestedMaximumOutputUnits: counted.requestedMaximumOutputUnits,
    requestedRoute: binding.routeId === "deep-design" ? "deep" : "standard",
    templateId: null,
    templateVersion: null,
    includeTechnicalUnitDetail: true,
    environment: plan.definition.scope.environment,
  };
  const estimate = {
    canonicalAuthority: "canonical-commercial-v1",
    estimatedMicroUsd: counted.maximumEstimatedProviderCostMicros,
    maximumCreditUnits: counted.maximumCreditUnits,
    pricingVersionReference: counted.snapshot.price.pricingVersionId,
  };
  const requestBody = {
    capabilityRegistryDigest: tuple.capabilityRegistryDigest,
    cacheKeyAuthority: plan.definition.policy.cacheKeyAuthority,
    catalogDigest: tuple.catalogDigest,
    commercialEstimate: {
      ...estimate,
      estimateDigest: digestStructuredValue(estimate),
    },
    contractVersion: 2,
    evaluationAuthorityTupleDigest:
      binding.authorityBinding.authorityTupleDigest,
    evaluationCaseDigest: binding.caseDigest,
    evaluationCaseId: binding.caseId,
    executionClass: "live-evaluation",
    idempotencyKeyDigest: context.idempotencyKeyDigest,
    inputDigest: invocation.descriptor.inputDigest,
    inputEvidenceDigest: counted.inputEvidence.evidenceDigest,
    liveEvaluationAuthorityDigest: plan.approval.approvalDigest,
    liveEvaluationPlanDigest: plan.planDigest,
    operation: tuple.operation,
    organizationId: scope.organizationId,
    plan: plan.definition.scope.plan,
    projectId: scope.projectId,
    promptTemplateDigest: tuple.promptTemplateDigest,
    recordKind: "model-live-runtime-admission-request",
    requested: counted.inputEvidence.requested,
    responseSchemaDigest: tuple.responseSchemaDigest,
    role: tuple.role,
    routeRegistryDigest: tuple.routeRegistryDigest,
    routingDecisionDigest: digestStructuredValue(context.routingDecision),
    runtimePolicyDigest: plan.definition.policy.policyDigest,
    userId: scope.userId,
  };
  const admissionRequest = modelLiveRuntimeAdmissionRequestV2Schema.parse({
    ...requestBody,
    requestDigest: digestStructuredValue(requestBody),
  });
  requireRequest(
    context.routingRequest !== undefined &&
      context.routingDecision !== undefined,
  );
  const evidence = new PostgresModelLiveRuntimeHostEvidence({
    plans: input.plans,
    scope,
    configuration: input.configuration,
    ...reference,
    caseId: input.caseId,
  });
  const authority = new PostgresModelLiveRoutingAuthority({
    plans: input.plans,
    evidence,
    configuration: input.configuration,
    resolveCurrentConfiguration: input.resolveCurrentConfiguration,
    context,
    invocation,
    routing,
    inputEvidence: counted.inputEvidence,
    ...reference,
    caseId: input.caseId,
  });
  const candidate = {
    plan,
    routingRequest: context.routingRequest,
    routingDecision: context.routingDecision,
  };
  const authorize = async () => {
    requireRequest(
      !input.signal?.aborted && now().getTime() < Date.parse(counted.expiresAt),
    );
    await authority.resolve({
      candidate,
      request: admissionRequest,
      inputEvidence: counted.inputEvidence,
      purpose: "execution",
    });
  };
  await authorize();
  const observedAt = now().toISOString();
  const execution = await prepareModelLiveRuntimeExecutionV2({
    metadata: {
      ...candidate,
      admissionRequest,
      commercialRequest: { ...commercialRequest, requestedAt: observedAt },
      inputEvidence: counted.inputEvidence,
    },
    store: new PostgresModelLiveRuntimeAdmissionStore({
      database: input.database,
      scope: {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        userId: scope.userId,
      },
      plans: input.plans,
      ...reference,
    }),
    decisionId: ids.admissionDecisionId,
    concurrencyLeaseId: ids.concurrencyLeaseId,
    observedAt,
  });
  await authorize();
  return { prepared: { execution, context, invocation, routing }, counted };
}
