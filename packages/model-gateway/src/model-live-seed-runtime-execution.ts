import { z } from "zod";
import {
  digestCanonicalValue,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceRuntimeAdmissionRequestV3Schema,
  modelLiveSequenceRuntimeAdmissionRequestV4Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV4Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
  modelLiveSeedRoutingDecisionV3Schema,
  modelRoutingRequestV1Schema,
  type ModelLiveSequencePlanV3,
  type ModelLiveSequenceSelectionV3,
  type ModelLiveSequenceInputV3,
  type ModelLiveSequenceRuntimeAdmissionRequestV3,
  type ModelLiveSequenceRuntimeAdmissionRequestV4,
  type ModelLiveSequenceRuntimeAdmissionDecisionV4,
  type ModelLiveSequenceRuntimeAdmissionDecisionV3,
  type ModelLiveSeedRoutingDecisionV3,
  type ModelRoutingRequestV1,
} from "@cloudmarkup/schemas";
import {
  projectModelCommercialOperationIdentityV1,
  type ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";
import { inspectModelLiveSequenceV3 } from "./model-live-evaluation-sequence.js";
import {
  assertCommercialBindings,
  assertCommercialScopeBindings,
  assertRuntimeRoutingBindings,
  plannedMaximums,
  tenantScopeDigest,
} from "./model-runtime-execution-bindings.js";
import { ModelRuntimeControlError } from "./model-runtime-errors.js";
import { expectedSharedStaticDenialReasons } from "./model-runtime-shared-controls.js";
import { inspectModelValueForSecretCandidatesV1 } from "./security.js";

export interface ModelLiveSeedRuntimeExecutionInputV3 {
  readonly plan: ModelLiveSequencePlanV3;
  readonly selection: ModelLiveSequenceSelectionV3;
  readonly stageInput: ModelLiveSequenceInputV3;
  readonly admissionRequest: ModelLiveSequenceRuntimeAdmissionRequestV3;
  readonly admissionDecision: ModelLiveSequenceRuntimeAdmissionDecisionV3;
  readonly routingRequest: ModelRoutingRequestV1;
  readonly routingDecision: ModelLiveSeedRoutingDecisionV3;
  readonly commercialRequest: ModelCommercialOperationRequestV1;
}
export interface ModelLiveSeedRuntimeExecutionInputV4 extends Omit<
  ModelLiveSeedRuntimeExecutionInputV3,
  "admissionRequest" | "admissionDecision"
> {
  readonly admissionRequest: ModelLiveSequenceRuntimeAdmissionRequestV4;
  readonly admissionDecision: ModelLiveSequenceRuntimeAdmissionDecisionV4;
}
const metadata = z
  .object({
    plan: modelLiveSequencePlanV3Schema,
    selection: modelLiveSequenceSelectionV3Schema,
    stageInput: modelLiveSequenceInputV3Schema,
    admissionRequest: modelLiveSequenceRuntimeAdmissionRequestV3Schema,
    admissionDecision: modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
    routingRequest: modelRoutingRequestV1Schema,
    routingDecision: modelLiveSeedRoutingDecisionV3Schema,
  })
  .strict();
const sequenceMetadata = metadata
  .extend({
    admissionRequest: modelLiveSequenceRuntimeAdmissionRequestV4Schema,
    admissionDecision: modelLiveSequenceRuntimeAdmissionDecisionV4Schema,
  })
  .strict();
type SeedRuntimeMetadata =
  z.output<typeof metadata> | z.output<typeof sequenceMetadata>;

function requireBinding(condition: boolean): asserts condition {
  if (!condition)
    throw new ModelRuntimeControlError("routing-authority-mismatch");
}
function promptCacheDisabled(cache: { readonly enabled: boolean }): boolean {
  return !cache.enabled;
}
function same(left: unknown, right: unknown) {
  return digestCanonicalValue(left) === digestCanonicalValue(right);
}

/** First fixed-seed stage metadata only. The authenticated host must reconstruct
 * actual RAM input/resources, verify issued rows and current authority, and
 * acquire canonical credits and aggregate capacity. This parser grants none of
 * them. Stage two requires a separate genuine predecessor/outcome composition;
 * historical V1/V2 readers and their primary-call recovery remain unchanged. */
export function parseModelLiveSeedRuntimeExecutionV3(
  supplied: ModelLiveSeedRuntimeExecutionInputV3,
) {
  return parseSeedRuntimeExecution(supplied, metadata);
}

/** Whole-case two-slot metadata with actual first-send resources. No runtime or
 * financial authority is issued by this comparison reader. */
export function parseModelLiveSeedRuntimeExecutionV4(
  supplied: ModelLiveSeedRuntimeExecutionInputV4,
) {
  return parseSeedRuntimeExecution(supplied, sequenceMetadata);
}

function parseSeedRuntimeExecution<Metadata extends SeedRuntimeMetadata>(
  supplied:
    ModelLiveSeedRuntimeExecutionInputV3 | ModelLiveSeedRuntimeExecutionInputV4,
  reader: { parse(value: unknown): Metadata },
) {
  try {
    const { commercialRequest: rawCommercial, ...rawMetadata } = supplied;
    const parsed = reader.parse(rawMetadata);
    projectModelCommercialOperationIdentityV1(rawCommercial);
    const commercialRequest = structuredClone(rawCommercial);
    const {
      plan,
      selection,
      stageInput,
      admissionRequest: request,
      admissionDecision: decision,
      routingDecision,
      routingRequest,
    } = parsed;
    requireBinding(
      request.contractVersion === decision.contractVersion &&
        stageInput.stageKey === "repair-1" &&
        routingDecision.seedInputBindingDigest ===
          stageInput.inputBindingDigest,
    );
    // Historical integrity uses the issued input's time. Current trusted time,
    // revocation and configuration must be checked again by the runtime host.
    const projection = inspectModelLiveSequenceV3({
      plan,
      selection,
      inputs: [stageInput],
      dispatches: [],
      outcomes: [],
      observedAt: stageInput.issuedAt,
    });
    requireBinding(
      projection.cases.some(
        (entry) =>
          entry.caseId === stageInput.caseId &&
          entry.stageId === stageInput.stageId &&
          entry.state === "requires-dispatch-admission",
      ),
    );
    const binding = plan.definition.cases.find(
      (entry) => entry.caseId === stageInput.caseId,
    );
    requireBinding(binding !== undefined);
    const tuple = binding.authorityBinding.authorityTuple;
    const policy = plan.definition.policy;
    const scope = plan.definition.scope;
    const expected = {
      evaluationCaseId: stageInput.caseId,
      evaluationCaseDigest: stageInput.caseDigest,
      evaluationAuthorityTupleDigest: stageInput.authorityTupleDigest,
      liveEvaluationPlanDigest: plan.planDigest,
      liveEvaluationAuthorityDigest: plan.approval.approvalDigest,
      selectionId: selection.selectionId,
      selectionDigest: selection.selectionDigest,
      stageId: stageInput.stageId,
      stageKey: stageInput.stageKey,
      invocationId: stageInput.invocationId,
      inputBindingDigest: stageInput.inputBindingDigest,
      preparedPayloadDigest: stageInput.preparedPayloadDigest,
    };
    for (const key of Object.keys(expected) as (keyof typeof expected)[])
      requireBinding(
        request[key] === expected[key] && decision[key] === expected[key],
      );
    requireBinding(
      request.organizationId === scope.organizationId &&
        request.projectId === scope.projectId &&
        request.userId === scope.userId &&
        request.plan === scope.plan &&
        request.inputDigest === stageInput.operationInputDigest &&
        request.runtimePolicyDigest === policy.policyDigest &&
        same(request.cacheKeyAuthority, policy.cacheKeyAuthority) &&
        request.capabilityRegistryDigest === tuple.capabilityRegistryDigest &&
        request.routeRegistryDigest === tuple.routeRegistryDigest &&
        request.catalogDigest === tuple.catalogDigest &&
        request.operation === tuple.operation &&
        request.role === tuple.role &&
        request.promptTemplateDigest === tuple.promptTemplateDigest &&
        request.responseSchemaDigest === tuple.responseSchemaDigest &&
        Date.parse(decision.decidedAt) >= Date.parse(stageInput.issuedAt) &&
        Date.parse(decision.decidedAt) < Date.parse(plan.expiresAt) &&
        (decision.expiresAt === undefined ||
          Date.parse(decision.expiresAt) <= Date.parse(plan.expiresAt)),
    );
    assertRuntimeRoutingBindings({
      ...parsed,
      policy,
      evaluationRequirement: {
        ...policy.evaluationRequirement,
        capabilityRegistryDigest: tuple.capabilityRegistryDigest,
        routeRegistryDigest: tuple.routeRegistryDigest,
      },
    });
    const liveEvaluationAuthority = {
      expiresAt: plan.expiresAt,
      limits: plan.definition.limits,
    };
    if (request.contractVersion === 4 && decision.contractVersion === 4)
      assertSequenceCommercialBindings({
        ...parsed,
        admissionRequest: request,
        admissionDecision: decision,
        commercialRequest,
      });
    else
      assertCommercialBindings({
        ...parsed,
        commercialRequest,
        policy,
        liveEvaluationAuthority,
      });
    const planned = plannedMaximums(commercialRequest);
    requireBinding(
      routingDecision.providerFamily !== "deterministic-fake" &&
        routingRequest.environment === scope.environment &&
        commercialRequest.environment === scope.environment &&
        routingDecision.routeId === binding.routeId &&
        routingDecision.modelConfigurationReference ===
          tuple.modelConfigurationReference &&
        routingDecision.routeDefinitionDigest === tuple.routeDefinitionDigest &&
        routingDecision.inferenceProfileId === tuple.inferenceProfileId &&
        commercialRequest.promptId === tuple.promptTemplateId &&
        commercialRequest.promptVersion === tuple.promptTemplateVersion &&
        promptCacheDisabled(routingDecision.promptCachePolicy) &&
        (request.contractVersion === 4 || planned.invocations === 1) &&
        commercialRequest.plannedCalls[0]?.kind === "repair" &&
        (request.contractVersion === 4 ||
          planned.outputTokens === request.requested.outputTokens) &&
        commercialRequest.plannedCalls.every((call) =>
          [call.minimumUsage, call.maximumUsage].every(
            (usage) =>
              usage.cacheReadUnits === 0 &&
              usage.cacheWriteUnits === 0 &&
              usage.providerSpecificUnits.length === 0,
          ),
        ) &&
        inspectModelValueForSecretCandidatesV1(parsed).detectedValueCount === 0,
    );
    if (decision.outcome === "allowed")
      requireBinding(
        expectedSharedStaticDenialReasons({ ...parsed, policy }).length === 0 &&
          routingDecision.outcome === "selected" &&
          !routingDecision.userConfirmationRequired &&
          decision.authorization.entitlementDecisionId ===
            routingRequest.plan.entitlementDecisionId &&
          commercialRequest.estimateAccepted &&
          !commercialRequest.confirmationRequired,
      );
    return {
      ...parsed,
      commercialRequest,
      policy,
      liveEvaluationAuthority,
      liveAuthorityReservation: {
        authorityDigest: plan.approval.approvalDigest,
        limits: plan.definition.limits,
        planned: {
          ...planned,
          creditUnits: request.commercialEstimate.maximumCreditUnits,
          estimatedMicroUsd: request.commercialEstimate.estimatedMicroUsd,
        },
      },
    };
  } catch {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}
/** Comparison identity only; not an admission, input receipt or reservation.
 * Retains the exact stage/input selection while allowing the established
 * decision/commercial clock refresh during metadata-only recovery. */
export function projectModelLiveSeedRuntimeExecutionIdentityV3(
  input: ModelLiveSeedRuntimeExecutionInputV3,
) {
  return projectSeedRuntimeIdentity(
    parseModelLiveSeedRuntimeExecutionV3(input),
  );
}
export function projectModelLiveSeedRuntimeExecutionIdentityV4(
  input: ModelLiveSeedRuntimeExecutionInputV4,
) {
  return projectSeedRuntimeIdentity(
    parseModelLiveSeedRuntimeExecutionV4(input),
  );
}
function projectSeedRuntimeIdentity(
  parsed:
    | ReturnType<typeof parseModelLiveSeedRuntimeExecutionV3>
    | ReturnType<typeof parseModelLiveSeedRuntimeExecutionV4>,
) {
  const omit = (value: object, keys: readonly string[]) =>
    Object.fromEntries(
      Object.entries(value).filter(([key]) => !keys.includes(key)),
    );
  return {
    fingerprint: digestCanonicalValue({
      admissionDecision: omit(parsed.admissionDecision, [
        "decidedAt",
        "decisionDigest",
        "expiresAt",
      ]),
      admissionRequest: parsed.admissionRequest,
      commercialRequest: omit(parsed.commercialRequest, [
        "requestedAt",
        "expiresAt",
      ]),
      plan: parsed.plan,
      selection: parsed.selection,
      stageInput: parsed.stageInput,
      routingRequest: parsed.routingRequest,
      routingDecision: parsed.routingDecision,
    }),
    tenantScopeDigest: tenantScopeDigest(parsed.admissionRequest),
  };
}

function assertSequenceCommercialBindings(
  input: ModelLiveSeedRuntimeExecutionInputV4,
) {
  const {
    admissionRequest: request,
    admissionDecision: decision,
    commercialRequest: commercial,
    routingDecision: route,
    routingRequest,
    plan,
    selection,
  } = input;
  const planned = assertCommercialScopeBindings({
    ...input,
    policy: plan.definition.policy,
    liveEvaluationAuthority: {
      expiresAt: plan.expiresAt,
      limits: plan.definition.limits,
    },
  });
  const calls = commercial.plannedCalls;
  const first = calls[0],
    second = calls[1];
  const limits = plan.definition.limits;
  const perStage = (value: number) =>
    Math.floor(value / selection.stages.length);
  const perCase = (value: number) =>
    Math.floor(value / plan.definition.cases.length);
  requireBinding(
    request.canonicalPlannedCallsDigest === digestCanonicalValue(calls) &&
      decision.canonicalPlannedCallsDigest ===
        request.canonicalPlannedCallsDigest &&
      planned.invocations === 2 &&
      calls.length === 2 &&
      first !== undefined &&
      second !== undefined &&
      request.requested.repairAttempts === 2 &&
      first.minimumUsage.inputUnits === first.maximumUsage.inputUnits &&
      first.maximumUsage.inputUnits === routingRequest.estimatedContextTokens &&
      first.minimumUsage.outputUnits === 0 &&
      second.minimumUsage.totalUnits === 0 &&
      calls.every(
        (call) =>
          call.kind === "repair" &&
          call.maximumUsage.inputUnits > 0 &&
          call.maximumUsage.inputUnits <= perStage(limits.maximumInputTokens) &&
          call.maximumUsage.outputUnits === request.requested.outputTokens &&
          call.maximumUsage.outputUnits === route.maximumOutputTokens &&
          call.maximumUsage.outputUnits <=
            perStage(limits.maximumOutputTokens) &&
          call.maximumUsage.outputUnits <=
            plan.definition.policy.limits.maximumOutputTokens,
      ) &&
      planned.inputTokens === commercial.requestedMaximumInputUnits &&
      planned.outputTokens === commercial.requestedMaximumOutputUnits &&
      planned.inputTokens <= perCase(limits.maximumInputTokens) &&
      planned.outputTokens <= perCase(limits.maximumOutputTokens) &&
      planned.totalTokens <= perCase(limits.maximumTotalTokens) &&
      request.commercialEstimate.maximumCreditUnits <=
        perCase(limits.maximumCreditUnits) &&
      request.commercialEstimate.estimatedMicroUsd <=
        perCase(limits.maximumEstimatedMicroUsd) &&
      Date.parse(commercial.expiresAt) - Date.parse(commercial.requestedAt) <=
        300000 &&
      route.timeoutMilliseconds * 2 <
        Date.parse(commercial.expiresAt) - Date.parse(commercial.requestedAt),
  );
}
