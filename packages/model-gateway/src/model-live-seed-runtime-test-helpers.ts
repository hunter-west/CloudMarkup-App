import {
  digestCanonicalValue,
  modelLiveSequenceRuntimeAdmissionRequestV3Schema,
  modelLiveSequenceRuntimeAdmissionDecisionV3Schema,
  modelLiveSeedRoutingDecisionV3Schema,
} from "@cloudmarkup/schemas";
import {
  syntheticSequenceFixtureV3,
  rehashSequenceTest as rehash,
} from "./model-live-sequence-test-helpers.js";
import {
  modelTestContext,
  modelTestRequests,
  modelTestRoutingRequest,
  modelTestRoutingDecision,
} from "./test-helpers.js";
import { sha256Text } from "./security.js";
import type { ModelLiveSeedRuntimeExecutionInputV3 } from "./model-live-seed-runtime-execution.js";
import type { ModelCommercialOperationRequestV1 } from "./commercial-lifecycle.js";
function present<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error("Missing synthetic runtime fixture value");
  return value;
}
/** Synthetic metadata only. This fixture authenticates no tenant, native
 * validation, model invocation, canonical price, reservation or approval. */
export function syntheticSeedRuntimeFixtureV3() {
  const f = syntheticSequenceFixtureV3({ runtimeRepairRoute: true });
  const stageInput = f.prepare(0);
  const binding = present(f.definition.cases[0]);
  const tuple = binding.authorityBinding.authorityTuple;
  const operation = present(
    modelTestRequests().find((r) => r.operation === "candidate.repair"),
  );
  const context = modelTestContext("synthetic_stage_invocation");
  const routingRequest = modelTestRoutingRequest(
    operation,
    {
      ...context,
      scope: { ...context.scope, ...f.v2.scope },
      idempotencyKeyDigest: sha256Text("synthetic_stage_idempotency"),
      evaluationPolicyId: f.policy.evaluationRequirement.evaluationPolicyId,
      evaluationPolicyVersion:
        f.policy.evaluationRequirement.evaluationPolicyVersion,
    },
    {
      environment: "development",
      inputDigest: stageInput.operationInputDigest,
    },
  );
  const {
    evaluationResultDigest: unusedDigest,
    evaluationResultVersion: unusedVersion,
    escalation: unusedEscalation,
    ...baseRoute
  } = modelTestRoutingDecision(routingRequest);
  void unusedDigest;
  void unusedVersion;
  void unusedEscalation;
  const routingDecision = modelLiveSeedRoutingDecisionV3Schema.parse({
    ...baseRoute,
    contractVersion: 3,
    recordKind: "model-live-seed-routing-decision",
    maximumAttempts: 1,
    seedInputBindingDigest: stageInput.inputBindingDigest,
    feature: operation.operation,
    automaticEscalationPermitted: false,
    capabilityRegistryDigest: tuple.capabilityRegistryDigest,
    routeRegistryDigest: tuple.routeRegistryDigest,
    routeId: binding.routeId,
    routeDefinitionDigest: tuple.routeDefinitionDigest,
    modelConfigurationReference: tuple.modelConfigurationReference,
    inferenceProfileId: tuple.inferenceProfileId,
    evaluationPolicyId: f.policy.evaluationRequirement.evaluationPolicyId,
    evaluationPolicyVersion:
      f.policy.evaluationRequirement.evaluationPolicyVersion,
    customerCharge: {
      acceptedMaximumCreditUnits: 1,
      incrementalEscalationCreditUnits: 0,
      policy: "accepted-estimate-cap",
    },
    pricingVersionReference:
      f.v2.request.commercialEstimate.pricingVersionReference,
    promptCachePolicy: {
      enabled: false,
      cacheKeyRequired: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
  });
  const { inputEvidenceDigest: legacy, ...base } = f.v2.request;
  void legacy;
  const stage = {
    evaluationCaseId: stageInput.caseId,
    evaluationCaseDigest: stageInput.caseDigest,
    evaluationAuthorityTupleDigest: stageInput.authorityTupleDigest,
    liveEvaluationPlanDigest: f.plan.planDigest,
    liveEvaluationAuthorityDigest: f.approval.approvalDigest,
    selectionId: stageInput.selectionId,
    selectionDigest: stageInput.selectionDigest,
    stageId: stageInput.stageId,
    stageKey: stageInput.stageKey,
    invocationId: stageInput.invocationId,
    inputBindingDigest: stageInput.inputBindingDigest,
    preparedPayloadDigest: stageInput.preparedPayloadDigest,
  };
  const admissionRequest =
    modelLiveSequenceRuntimeAdmissionRequestV3Schema.parse(
      rehash(
        {
          ...base,
          ...stage,
          contractVersion: 3,
          recordKind: "model-live-sequence-runtime-admission-request",
          operation: "candidate.repair",
          role: "repair-escalation",
          inputDigest: stageInput.operationInputDigest,
          idempotencyKeyDigest: routingRequest.idempotencyKeyDigest,
          runtimePolicyDigest: f.policy.policyDigest,
          routingDecisionDigest: digestCanonicalValue(routingDecision),
          catalogDigest: tuple.catalogDigest,
          promptTemplateDigest: tuple.promptTemplateDigest,
          responseSchemaDigest: tuple.responseSchemaDigest,
          capabilityRegistryDigest: tuple.capabilityRegistryDigest,
          routeRegistryDigest: tuple.routeRegistryDigest,
          requested: { ...base.requested, repairAttempts: 2 },
        },
        "requestDigest",
      ),
    );
  const now = f.observedAt;
  const expiresAt = new Date(Date.parse(now) + 240000).toISOString();
  const maximumUsage = {
    inputUnits: 100,
    outputUnits: 1000,
    totalUnits: 1100,
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    providerSpecificUnits: [],
  };
  const commercialRequest: ModelCommercialOperationRequestV1 = {
    confirmationRequired: false,
    estimateAccepted: true,
    environment: "development",
    eventIdPrefix: "synthetic_stage_event",
    expiresAt,
    feature: "candidate.repair",
    idempotencyKey: "synthetic_stage_idempotency",
    includeTechnicalUnitDetail: true,
    jobId: "synthetic_stage_job",
    multiCallWorkflowId: "synthetic_stage_workflow",
    organizationId: f.v2.scope.organizationId,
    projectId: f.v2.scope.projectId,
    userId: f.v2.scope.userId,
    plannedCalls: [
      {
        kind: "repair",
        routeId: binding.routeId,
        maximumUsage,
        minimumUsage: {
          ...maximumUsage,
          inputUnits: 1,
          outputUnits: 0,
          totalUnits: 1,
        },
      },
    ],
    promptId: tuple.promptTemplateId,
    promptVersion: tuple.promptTemplateVersion,
    requestedAt: now,
    requestedMaximumInputUnits: 100,
    requestedMaximumOutputUnits: 1000,
    requestedRoute: "deep",
    requestId: "synthetic_stage_request",
    reservationId: "synthetic_stage_reservation",
    templateId: null,
    templateVersion: null,
  };
  const admissionDecision =
    modelLiveSequenceRuntimeAdmissionDecisionV3Schema.parse(
      rehash(
        {
          ...stage,
          accountingAuthority: "canonical-commercial-v1",
          contractVersion: 3,
          recordKind: "model-live-sequence-runtime-admission-decision",
          decisionId: "synthetic_stage_admission",
          decidedAt: now,
          denialReasons: [],
          executionClass: "live-evaluation",
          expiresAt,
          invokeModel: true,
          outcome: "allowed",
          authorization: {
            commercialReservationDecisionId: commercialRequest.reservationId,
            concurrencyLeaseId: "synthetic_stage_lease",
            entitlementDecisionId: routingRequest.plan.entitlementDecisionId,
          },
          commercialEstimateDigest:
            admissionRequest.commercialEstimate.estimateDigest,
          requestDigest: admissionRequest.requestDigest,
          routingDecisionDigest: admissionRequest.routingDecisionDigest,
          runtimePolicyDigest: f.policy.policyDigest,
          writeAuthority: {
            compiler: false,
            deployment: false,
            github: false,
            payment: false,
            repository: false,
          },
        },
        "decisionDigest",
      ),
    );
  const input: ModelLiveSeedRuntimeExecutionInputV3 = {
    plan: f.plan,
    selection: f.selection,
    stageInput,
    admissionRequest,
    admissionDecision,
    routingRequest,
    routingDecision,
    commercialRequest,
  };
  return { f, input };
}
