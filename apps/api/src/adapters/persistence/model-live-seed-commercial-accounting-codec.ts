import { aggregateModelUsageUnitsV1 } from "@cloudmarkup/domain";
import {
  digestStructuredValue,
  inspectModelLiveSequenceV3,
  type ModelCommercialWorkflowRecordV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSeedRoutingDecisionV3Schema,
  type ModelLiveSequencePlanV3,
  type ModelLiveSequenceSelectionV3,
  type ModelLiveSequenceInputV3,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import {
  accountingAssert,
  modelAccountingBindingSchema,
  verifyModelAccountingCommonBinding,
} from "./model-commercial-accounting-codec.js";
import {
  parseSeedRuntimeRecord,
  parseSeedRuntimeRecordV4,
  type SeedRuntimeAdmissionRecordV4,
  type SeedRuntimeAdmissionRecordV3,
} from "./model-live-seed-runtime-admission-codec.js";

export const MODEL_SEED_ACCOUNTING_WINDOW_MAPPING =
  "seed-evaluation-runtime-windows-v3";
export const MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING =
  "seed-sequence-runtime-windows-v4";
export const modelSeedAccountingBindingSchema = modelAccountingBindingSchema
  .extend({
    routingDecision: modelLiveSeedRoutingDecisionV3Schema,
  })
  .strict();
export type ModelSeedAccountingBinding = z.output<
  typeof modelSeedAccountingBindingSchema
>;
const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);

/** Exact persisted metadata join only. The closed sequence host must load these
 * issued rows and require current authority in the canonical transaction.
 * This function neither accepts an estimate nor grants credits or a model send. */
export function verifyModelSeedAccountingRuntime(
  workflow: ModelCommercialWorkflowRecordV1,
  rawRuntime: SeedRuntimeAdmissionRecordV3,
  rawBinding: ModelSeedAccountingBinding,
  rawPlan: ModelLiveSequencePlanV3,
  rawSelection: ModelLiveSequenceSelectionV3,
  rawInput: ModelLiveSequenceInputV3,
): void {
  verifySeedAccountingBindings(
    workflow,
    parseSeedRuntimeRecord(rawRuntime, workflow.request),
    rawBinding,
    rawPlan,
    rawSelection,
    rawInput,
  );
}

export function verifyModelSeedSequenceAccountingRuntimeV4(
  workflow: ModelCommercialWorkflowRecordV1,
  rawRuntime: SeedRuntimeAdmissionRecordV4,
  rawBinding: ModelSeedAccountingBinding,
  rawPlan: ModelLiveSequencePlanV3,
  rawSelection: ModelLiveSequenceSelectionV3,
  rawInput: ModelLiveSequenceInputV3,
): void {
  verifySeedAccountingBindings(
    workflow,
    parseSeedRuntimeRecordV4(rawRuntime, workflow.request),
    rawBinding,
    rawPlan,
    rawSelection,
    rawInput,
  );
}

function verifySeedAccountingBindings(
  workflow: ModelCommercialWorkflowRecordV1,
  runtime: SeedRuntimeAdmissionRecordV3 | SeedRuntimeAdmissionRecordV4,
  rawBinding: ModelSeedAccountingBinding,
  rawPlan: ModelLiveSequencePlanV3,
  rawSelection: ModelLiveSequenceSelectionV3,
  rawInput: ModelLiveSequenceInputV3,
): void {
  const plan = modelLiveSequencePlanV3Schema.parse(rawPlan);
  const selection = modelLiveSequenceSelectionV3Schema.parse(rawSelection);
  const input = modelLiveSequenceInputV3Schema.parse(rawInput);
  const binding = modelSeedAccountingBindingSchema.parse(rawBinding);
  const request = workflow.request;
  verifyModelAccountingCommonBinding(workflow, runtime, binding);
  const projection = inspectModelLiveSequenceV3({
    plan,
    selection,
    inputs: [input],
    dispatches: [],
    outcomes: [],
    observedAt: input.issuedAt,
  });
  accountingAssert(
    input.stageKey === "repair-1" &&
      projection.cases.some(
        (entry) =>
          entry.caseId === input.caseId &&
          entry.stageId === input.stageId &&
          entry.state === "requires-dispatch-admission",
      ),
  );
  const definition = plan.definition;
  const entry = definition.cases.find(
    (candidate) => candidate.caseId === input.caseId,
  );
  const context = workflow.resolvedContext;
  accountingAssert(entry !== undefined && context !== null);
  const tuple = entry.authorityBinding.authorityTuple;
  const routing = binding.routingDecision;
  const route = context.selectedRoute;
  const call = request.plannedCalls[0];
  const invocations = runtime.request.contractVersion === 4 ? 2 : 1;
  const usage = aggregateModelUsageUnitsV1(
    request.plannedCalls.map((entry) => entry.maximumUsage),
  );
  const planned = runtime.liveAuthorityReservation.planned;
  const windows = definition.policy.requestWindows;
  for (const key of [
    "selectionId",
    "selectionDigest",
    "stageId",
    "stageKey",
    "invocationId",
    "inputBindingDigest",
    "preparedPayloadDigest",
  ] as const)
    accountingAssert(runtime.request[key] === input[key]);
  accountingAssert(
    workflow.fingerprint === digestStructuredValue(request) &&
      runtime.decision.outcome === "allowed" &&
      runtime.decision.invokeModel &&
      runtime.request.liveEvaluationPlanDigest === plan.planDigest &&
      runtime.request.liveEvaluationAuthorityDigest ===
        plan.approval.approvalDigest &&
      runtime.request.evaluationCaseId === input.caseId &&
      runtime.request.evaluationCaseDigest === input.caseDigest &&
      runtime.request.inputDigest === input.operationInputDigest &&
      runtime.request.evaluationAuthorityTupleDigest ===
        entry.authorityBinding.authorityTupleDigest &&
      runtime.request.runtimePolicyDigest === definition.policy.policyDigest &&
      same(
        runtime.request.cacheKeyAuthority,
        definition.policy.cacheKeyAuthority,
      ) &&
      same(runtime.liveAuthorityReservation.limits, definition.limits) &&
      request.organizationId === definition.scope.organizationId &&
      request.projectId === definition.scope.projectId &&
      request.userId === definition.scope.userId &&
      request.environment === definition.scope.environment &&
      runtime.request.plan === definition.scope.plan &&
      request.feature === tuple.operation &&
      request.feature === "candidate.repair" &&
      request.promptId === tuple.promptTemplateId &&
      request.promptVersion === tuple.promptTemplateVersion &&
      runtime.request.catalogDigest === tuple.catalogDigest &&
      runtime.request.promptTemplateDigest === tuple.promptTemplateDigest &&
      runtime.request.responseSchemaDigest === tuple.responseSchemaDigest &&
      runtime.request.role === tuple.role &&
      Date.parse(request.requestedAt) >= Date.parse(input.issuedAt) &&
      Date.parse(request.expiresAt) <= Date.parse(plan.expiresAt) &&
      request.plannedCalls.length === invocations &&
      call?.kind === "repair" &&
      planned.invocations === invocations &&
      call.routeId === entry.routeId &&
      route.routeId === entry.routeId &&
      routing.routeId === entry.routeId &&
      routing.outcome === "selected" &&
      routing.feature === tuple.operation &&
      routing.seedInputBindingDigest === input.inputBindingDigest &&
      digestStructuredValue(routing) ===
        runtime.request.routingDecisionDigest &&
      routing.capabilityRegistryDigest === tuple.capabilityRegistryDigest &&
      routing.capabilityRegistryDigest ===
        runtime.request.capabilityRegistryDigest &&
      routing.modelConfigurationReference ===
        tuple.modelConfigurationReference &&
      routing.routeDefinitionDigest === tuple.routeDefinitionDigest &&
      routing.routeRegistryDigest === tuple.routeRegistryDigest &&
      routing.routeRegistryDigest === runtime.request.routeRegistryDigest &&
      routing.inferenceProfileId === tuple.inferenceProfileId &&
      routing.requestBinding.inputDigest === runtime.request.inputDigest &&
      routing.requestBinding.idempotencyKeyDigest ===
        runtime.request.idempotencyKeyDigest &&
      routing.entitlement.planKey === definition.scope.plan &&
      routing.entitlement.planVersionId ===
        context.authorization.planVersionId &&
      routing.entitlement.allowed &&
      routing.creditAuthorization.allowed &&
      routing.creditAuthorization.estimateAccepted &&
      request.estimateAccepted &&
      !request.confirmationRequired &&
      !routing.userConfirmationRequired &&
      routing.customerCharge.acceptedMaximumCreditUnits ===
        runtime.request.commercialEstimate.maximumCreditUnits &&
      routing.evaluationPolicyId ===
        definition.policy.evaluationRequirement.evaluationPolicyId &&
      routing.evaluationPolicyVersion ===
        definition.policy.evaluationRequirement.evaluationPolicyVersion &&
      routing.pricingVersionReference ===
        runtime.request.commercialEstimate.pricingVersionReference &&
      routing.maximumOutputTokens * invocations ===
        request.requestedMaximumOutputUnits &&
      route.modelId === routing.modelId &&
      route.modelVersion === routing.modelVersion &&
      route.providerKey === routing.providerId &&
      route.inferenceProfileId === routing.inferenceProfileId &&
      route.route === request.requestedRoute &&
      request.requestedRoute === "deep" &&
      usage.inputUnits === planned.inputTokens &&
      usage.outputUnits === planned.outputTokens &&
      usage.cacheReadUnits === planned.cacheReadTokens &&
      usage.cacheWriteUnits === planned.cacheWriteTokens &&
      usage.totalUnits === planned.totalTokens &&
      request.plannedCalls.every(
        (entryCall) =>
          entryCall.kind === "repair" &&
          entryCall.routeId === entry.routeId &&
          entryCall.maximumUsage.providerSpecificUnits.length === 0 &&
          entryCall.minimumUsage.providerSpecificUnits.length === 0 &&
          entryCall.minimumUsage.cacheReadUnits === 0 &&
          entryCall.minimumUsage.cacheWriteUnits === 0,
      ) &&
      planned.cacheReadTokens === 0 &&
      planned.cacheWriteTokens === 0 &&
      request.requestedMaximumInputUnits === planned.inputTokens &&
      request.requestedMaximumOutputUnits === planned.outputTokens &&
      context.authorization.featureRequests.maximum <=
        windows.organization.maximumRequests &&
      context.authorization.perUserRequests.maximum <=
        windows.user.maximumRequests &&
      context.authorization.organizationConcurrentReservations.maximum <=
        windows.organization.maximumConcurrentJobs,
  );
  if (runtime.request.contractVersion === 4) {
    const second = request.plannedCalls[1];
    const perStage = (value: number) =>
      Math.floor(value / selection.stages.length);
    accountingAssert(
      runtime.request.canonicalPlannedCallsDigest ===
        digestStructuredValue(request.plannedCalls) &&
        second !== undefined &&
        call.minimumUsage.inputUnits === call.maximumUsage.inputUnits &&
        call.minimumUsage.outputUnits === 0 &&
        second.minimumUsage.totalUnits === 0 &&
        routing.maximumOutputTokens ===
          runtime.request.requested.outputTokens &&
        request.plannedCalls.every(
          (entryCall) =>
            entryCall.maximumUsage.inputUnits > 0 &&
            entryCall.maximumUsage.inputUnits <=
              perStage(definition.limits.maximumInputTokens) &&
            entryCall.maximumUsage.outputUnits ===
              routing.maximumOutputTokens &&
            entryCall.maximumUsage.outputUnits <=
              perStage(definition.limits.maximumOutputTokens),
        ),
    );
  }
}
