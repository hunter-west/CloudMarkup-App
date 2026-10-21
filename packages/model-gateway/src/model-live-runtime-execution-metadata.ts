import { z } from "zod";
import {
  modelCacheKeyInputV1Schema,
  modelLiveEvaluationPlanV2Schema,
  modelLiveRuntimeAdmissionDecisionV2Schema,
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelRoutingDecisionV1Schema,
  modelRoutingRequestV1Schema,
  modelRuntimeInputEvidenceV1Schema,
  type ModelCacheKeyInputV1,
  type ModelLiveEvaluationPlanV2,
  type ModelLiveRuntimeAdmissionDecisionV2,
  type ModelLiveRuntimeAdmissionRequestV2,
  type ModelRoutingDecisionV1,
  type ModelRoutingRequestV1,
  type ModelRuntimeInputEvidenceV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  projectModelCommercialOperationIdentityV1,
  type ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";
import { validateModelLiveEvaluationRequestV2 } from "./model-live-evaluation-plan.js";
import {
  assertCommercialBindings,
  assertInputEvidenceBindings,
  assertRuntimeCacheBindings,
  assertRuntimeRoutingBindings,
  plannedMaximums,
  tenantScopeDigest,
} from "./model-runtime-execution-bindings.js";
import { ModelRuntimeControlError } from "./model-runtime-errors.js";
import {
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
} from "./security.js";

export interface ModelLiveRuntimeAuthorityBundleV2 {
  readonly plan: ModelLiveEvaluationPlanV2;
  readonly routingDecision: ModelRoutingDecisionV1;
  readonly routingRequest: ModelRoutingRequestV1;
}
export interface ModelLiveRuntimeControlExecutionInputV2 extends ModelLiveRuntimeAuthorityBundleV2 {
  readonly admissionDecision: ModelLiveRuntimeAdmissionDecisionV2;
  readonly admissionRequest: ModelLiveRuntimeAdmissionRequestV2;
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly inputEvidence: ModelRuntimeInputEvidenceV1;
  readonly promptCacheKey?: ModelCacheKeyInputV1;
}
const executionMetadata = z
  .object({
    admissionDecision: modelLiveRuntimeAdmissionDecisionV2Schema,
    admissionRequest: modelLiveRuntimeAdmissionRequestV2Schema,
    inputEvidence: modelRuntimeInputEvidenceV1Schema,
    plan: modelLiveEvaluationPlanV2Schema,
    promptCacheKey: modelCacheKeyInputV1Schema.optional(),
    routingDecision: modelRoutingDecisionV1Schema,
    routingRequest: modelRoutingRequestV1Schema,
  })
  .strict();

export function assertLiveRuntimeDecisionBinding(
  decision: ModelLiveRuntimeAdmissionDecisionV2,
  request: ModelLiveRuntimeAdmissionRequestV2,
): void {
  if (
    decision.requestDigest !== request.requestDigest ||
    decision.commercialEstimateDigest !==
      request.commercialEstimate.estimateDigest ||
    decision.runtimePolicyDigest !== request.runtimePolicyDigest ||
    decision.routingDecisionDigest !== request.routingDecisionDigest ||
    decision.evaluationAuthorityTupleDigest !==
      request.evaluationAuthorityTupleDigest ||
    decision.evaluationCaseDigest !== request.evaluationCaseDigest ||
    decision.evaluationCaseId !== request.evaluationCaseId ||
    decision.liveEvaluationAuthorityDigest !==
      request.liveEvaluationAuthorityDigest ||
    decision.liveEvaluationPlanDigest !== request.liveEvaluationPlanDigest
  )
    throw new ModelRuntimeControlError("routing-authority-mismatch");
}

/** Exact comparison and bounds only. Issued plans, current approval, tenant,
 * input evidence and commercial authority still require real host authentication. */
export function parseLiveRuntimeExecutionInput(
  supplied: ModelLiveRuntimeControlExecutionInputV2,
) {
  try {
    const { commercialRequest: rawCommercial, ...rawMetadata } = supplied;
    const parsed = executionMetadata.parse(rawMetadata);
    projectModelCommercialOperationIdentityV1(rawCommercial);
    const commercialRequest = structuredClone(rawCommercial);
    const {
      plan,
      admissionRequest,
      admissionDecision,
      routingDecision,
      routingRequest,
    } = parsed;
    // Historical identity validates at issuance; execution/dispatch separately
    // authenticate current approval and trusted time. Recovery cannot dispatch.
    validateModelLiveEvaluationRequestV2({
      request: admissionRequest,
      plan,
      inputEvidence: parsed.inputEvidence,
      observedAt: plan.issuedAt,
    });
    const binding = plan.definition.cases.find(
      (c) => c.caseId === admissionRequest.evaluationCaseId,
    );
    if (binding === undefined)
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    const tuple = binding.authorityBinding.authorityTuple;
    const policy = plan.definition.policy;
    const liveEvaluationAuthority = {
      expiresAt: plan.expiresAt,
      limits: plan.definition.limits,
    };
    assertLiveRuntimeDecisionBinding(admissionDecision, admissionRequest);
    assertInputEvidenceBindings(parsed);
    assertRuntimeRoutingBindings({
      ...parsed,
      policy,
      evaluationRequirement: {
        ...policy.evaluationRequirement,
        capabilityRegistryDigest: tuple.capabilityRegistryDigest,
        routeRegistryDigest: tuple.routeRegistryDigest,
      },
    });
    assertRuntimeCacheBindings({
      admissionRequest,
      cacheKey: parsed.promptCacheKey,
      policy,
      tuple,
      promptTemplateDigest: tuple.promptTemplateDigest,
      routingDecision,
    });
    assertCommercialBindings({
      ...parsed,
      commercialRequest,
      policy,
      liveEvaluationAuthority,
    });
    if (
      routingDecision.providerFamily === "deterministic-fake" ||
      routingRequest.environment !== plan.definition.scope.environment ||
      commercialRequest.environment !== plan.definition.scope.environment ||
      routingDecision.routeId !== binding.routeId ||
      routingDecision.modelConfigurationReference !==
        tuple.modelConfigurationReference ||
      routingDecision.routeDefinitionDigest !== tuple.routeDefinitionDigest ||
      routingDecision.inferenceProfileId !== tuple.inferenceProfileId ||
      commercialRequest.promptId !== tuple.promptTemplateId ||
      commercialRequest.promptVersion !== tuple.promptTemplateVersion ||
      inspectModelValueForSecretCandidatesV1(parsed).detectedValueCount !== 0
    )
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    const planned = plannedMaximums(commercialRequest);
    if (
      planned.invocations !== 1 ||
      commercialRequest.plannedCalls[0]?.kind !== "primary" ||
      planned.outputTokens !== admissionRequest.requested.outputTokens
    )
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    const liveAuthorityReservation = {
      authorityDigest: plan.approval.approvalDigest,
      limits: plan.definition.limits,
      planned: {
        ...planned,
        creditUnits: admissionRequest.commercialEstimate.maximumCreditUnits,
        estimatedMicroUsd:
          admissionRequest.commercialEstimate.estimatedMicroUsd,
      },
    };
    return {
      ...parsed,
      commercialRequest,
      policy,
      liveEvaluationAuthority,
      liveAuthorityReservation,
    };
  } catch {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}
export type ParsedLiveRuntimeExecution = ReturnType<
  typeof parseLiveRuntimeExecutionInput
>;
export function liveRuntimeExecutionFingerprint(
  input: ParsedLiveRuntimeExecution,
): Sha256Digest {
  const decision = Object.fromEntries(
    Object.entries(input.admissionDecision).filter(
      ([key]) => !["decidedAt", "decisionDigest", "expiresAt"].includes(key),
    ),
  );
  const commercial = Object.fromEntries(
    Object.entries(input.commercialRequest).filter(
      ([key]) => !["expiresAt", "requestedAt"].includes(key),
    ),
  );
  return digestStructuredValue({
    admissionDecision: decision,
    admissionRequest: input.admissionRequest,
    commercialRequest: commercial,
    inputEvidence: input.inputEvidence,
    plan: input.plan,
    promptCacheKey: input.promptCacheKey,
    routingDecision: input.routingDecision,
    routingRequest: input.routingRequest,
  });
}
/** Metadata identity only; never an approval, reservation or execution lease. */
export function projectModelLiveRuntimeExecutionIdentityV2(
  input: ModelLiveRuntimeControlExecutionInputV2,
) {
  const parsed = parseLiveRuntimeExecutionInput(input);
  return {
    fingerprint: liveRuntimeExecutionFingerprint(parsed),
    tenantScopeDigest: tenantScopeDigest(parsed.admissionRequest),
  };
}
