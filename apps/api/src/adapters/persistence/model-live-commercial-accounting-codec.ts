import {
  digestStructuredValue,
  type ModelCommercialWorkflowRecordV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveEvaluationPlanV2Schema,
  modelRoutingDecisionV1Schema,
  type ModelLiveEvaluationPlanV2,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import {
  accountingAssert,
  modelAccountingBindingSchema,
  verifyModelAccountingCommonBinding,
} from "./model-commercial-accounting-codec.js";
import {
  parseLiveRuntimeRecord,
  type LiveRuntimeAdmissionRecord,
} from "./model-live-runtime-admission-codec.js";

export const MODEL_LIVE_ACCOUNTING_WINDOW_MAPPING =
  "live-evaluation-runtime-windows-v2";
export const modelLiveAccountingBindingSchema = modelAccountingBindingSchema
  .extend({
    routingDecision: modelRoutingDecisionV1Schema,
  })
  .strict();
export type ModelLiveAccountingBinding = z.output<
  typeof modelLiveAccountingBindingSchema
>;
const same = (left: unknown, right: unknown) =>
  digestStructuredValue(left) === digestStructuredValue(right);

/** Exact metadata join, never proof of operator approval, provider usage or payment.
 * The host must authenticate the issued plan in the same canonical transaction;
 * new reservations additionally require current approval before commit.
 * Initially one primary call per frozen case; no retry/escalation or extra units. */
export function verifyModelLiveAccountingRuntime(
  workflow: ModelCommercialWorkflowRecordV1,
  rawRuntime: LiveRuntimeAdmissionRecord,
  rawBinding: ModelLiveAccountingBinding,
  rawPlan: ModelLiveEvaluationPlanV2,
): void {
  const plan = modelLiveEvaluationPlanV2Schema.parse(rawPlan);
  const binding = modelLiveAccountingBindingSchema.parse(rawBinding);
  const request = workflow.request;
  const runtime = parseLiveRuntimeRecord(rawRuntime, request);
  verifyModelAccountingCommonBinding(workflow, runtime, binding);
  const definition = plan.definition;
  const entry = definition.cases.find(
    (candidate) => candidate.caseId === runtime.request.evaluationCaseId,
  );
  const context = workflow.resolvedContext;
  accountingAssert(entry !== undefined && context !== null);
  const tuple = entry.authorityBinding.authorityTuple;
  const routing = binding.routingDecision;
  const route = context.selectedRoute;
  const call = request.plannedCalls[0];
  const planned = runtime.liveAuthorityReservation.planned;
  const windows = definition.policy.requestWindows;
  accountingAssert(
    workflow.fingerprint === digestStructuredValue(request) &&
      runtime.decision.outcome === "allowed" &&
      runtime.decision.invokeModel &&
      runtime.request.liveEvaluationPlanDigest === plan.planDigest &&
      runtime.request.liveEvaluationAuthorityDigest ===
        plan.approval.approvalDigest &&
      runtime.request.evaluationCaseDigest === entry.caseDigest &&
      runtime.request.inputDigest === entry.invocationInputDigest &&
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
      request.promptId === tuple.promptTemplateId &&
      request.promptVersion === tuple.promptTemplateVersion &&
      runtime.request.catalogDigest === tuple.catalogDigest &&
      runtime.request.promptTemplateDigest === tuple.promptTemplateDigest &&
      runtime.request.responseSchemaDigest === tuple.responseSchemaDigest &&
      runtime.request.role === tuple.role &&
      Date.parse(request.requestedAt) >= Date.parse(plan.issuedAt) &&
      Date.parse(request.expiresAt) <= Date.parse(plan.expiresAt) &&
      request.plannedCalls.length === 1 &&
      call?.kind === "primary" &&
      planned.invocations === 1 &&
      call.routeId === entry.routeId &&
      route.routeId === entry.routeId &&
      routing.routeId === entry.routeId &&
      routing.outcome === "selected" &&
      routing.feature === tuple.operation &&
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
      routing.customerCharge.acceptedMaximumCreditUnits ===
        runtime.request.commercialEstimate.maximumCreditUnits &&
      routing.evaluationPolicyId ===
        definition.policy.evaluationRequirement.evaluationPolicyId &&
      routing.evaluationPolicyVersion ===
        definition.policy.evaluationRequirement.evaluationPolicyVersion &&
      routing.pricingVersionReference ===
        runtime.request.commercialEstimate.pricingVersionReference &&
      routing.maximumOutputTokens >= request.requestedMaximumOutputUnits &&
      route.modelId === routing.modelId &&
      route.modelVersion === routing.modelVersion &&
      route.providerKey === routing.providerId &&
      route.inferenceProfileId === routing.inferenceProfileId &&
      route.route === request.requestedRoute &&
      ((entry.routeId === "standard-design" &&
        request.requestedRoute === "standard") ||
        (entry.routeId === "deep-design" &&
          request.requestedRoute === "deep")) &&
      call.maximumUsage.inputUnits === planned.inputTokens &&
      call.maximumUsage.outputUnits === planned.outputTokens &&
      call.maximumUsage.cacheReadUnits === planned.cacheReadTokens &&
      call.maximumUsage.cacheWriteUnits === planned.cacheWriteTokens &&
      call.maximumUsage.totalUnits === planned.totalTokens &&
      call.maximumUsage.providerSpecificUnits.length === 0 &&
      call.minimumUsage.providerSpecificUnits.length === 0 &&
      request.requestedMaximumInputUnits === planned.inputTokens &&
      request.requestedMaximumOutputUnits === planned.outputTokens &&
      context.authorization.featureRequests.maximum <=
        windows.organization.maximumRequests &&
      context.authorization.perUserRequests.maximum <=
        windows.user.maximumRequests &&
      context.authorization.organizationConcurrentReservations.maximum <=
        windows.organization.maximumConcurrentJobs,
  );
}
