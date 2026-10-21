import {
  digestCanonicalValue,
  modelEvaluationDatasetV1Schema,
  modelLiveEvaluationDefinitionV2Schema,
  modelLiveEvaluationPlanV2Schema,
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelLiveRuntimeControlPolicyV2Schema,
  modelRuntimeInputEvidenceV1Schema,
  utcTimestampSchema,
  type ModelLiveEvaluationDefinitionV2,
  type ModelLiveEvaluationPlanV2,
  type ModelLiveRuntimeAdmissionRequestV2,
} from "@cloudmarkup/schemas";
import { inspectModelValueForSecretCandidatesV1 } from "./security.js";

export class ModelLiveEvaluationPlanError extends Error {
  readonly code = "model-live-evaluation.authority-unavailable";
  constructor() {
    super(
      "Current, exact operator approval is required for this live evaluation.",
    );
    this.name = "ModelLiveEvaluationPlanError";
  }
}
function requireBinding(value: boolean): asserts value {
  if (!value) throw new ModelLiveEvaluationPlanError();
}
function same(left: unknown, right: unknown) {
  return digestCanonicalValue(left) === digestCanonicalValue(right);
}
function checked<T>(work: () => T): T {
  try {
    return work();
  } catch {
    throw new ModelLiveEvaluationPlanError();
  }
}

/** Verifies configured metadata against the actual frozen source. It neither
 * approves a definition nor authenticates a caller, plan or current policy. */
export function validateModelLiveEvaluationDefinitionV2(input: {
  readonly definition: unknown;
  readonly dataset: unknown;
  readonly expectedPolicy: unknown;
}): ModelLiveEvaluationDefinitionV2 {
  return checked(() => {
    const definition = modelLiveEvaluationDefinitionV2Schema.parse(
      input.definition,
    );
    const dataset = modelEvaluationDatasetV1Schema.parse(input.dataset);
    const policy = modelLiveRuntimeControlPolicyV2Schema.parse(
      input.expectedPolicy,
    );
    const requirement = policy.evaluationRequirement;
    requireBinding(
      same(definition.policy, policy) &&
        dataset.datasetId === requirement.datasetId &&
        dataset.datasetVersion === requirement.datasetVersion &&
        dataset.datasetDigest === requirement.datasetDigest &&
        same(
          dataset.cases.map((c) => c.caseDigest),
          requirement.datasetCaseDigests,
        ) &&
        inspectModelValueForSecretCandidatesV1(definition)
          .detectedValueCount === 0 &&
        inspectModelValueForSecretCandidatesV1(dataset).detectedValueCount ===
          0,
    );
    for (const [index, binding] of definition.cases.entries()) {
      const frozenCase = dataset.cases[index];
      requireBinding(
        binding.caseId === frozenCase?.caseId &&
          binding.caseDigest === frozenCase.caseDigest &&
          binding.sourceInputDigest ===
            digestCanonicalValue(frozenCase.input) &&
          binding.authorityBinding.authorityTuple.operation ===
            frozenCase.expected.authorityRequirement.operation &&
          binding.authorityBinding.authorityTuple.role ===
            frozenCase.expected.authorityRequirement.role,
      );
    }
    return definition;
  });
}

/** Binding validation after the host authenticates the issued/current plan and
 * input evidence. observedAt MUST be trusted service time. This helper alone
 * grants no approval, lease, commercial reservation or model invocation. */
export function validateModelLiveEvaluationRequestV2(input: {
  readonly request: unknown;
  readonly plan: unknown;
  readonly inputEvidence: unknown;
  readonly observedAt: string;
}): {
  readonly plan: ModelLiveEvaluationPlanV2;
  readonly request: ModelLiveRuntimeAdmissionRequestV2;
} {
  return checked(() => {
    const plan = modelLiveEvaluationPlanV2Schema.parse(input.plan);
    const request = modelLiveRuntimeAdmissionRequestV2Schema.parse(
      input.request,
    );
    const evidence = modelRuntimeInputEvidenceV1Schema.parse(
      input.inputEvidence,
    );
    const now = Date.parse(utcTimestampSchema.parse(input.observedAt));
    const definition = plan.definition;
    const scope = definition.scope;
    const policy = definition.policy;
    const binding = definition.cases.find(
      (c) => c.caseId === request.evaluationCaseId,
    );
    requireBinding(
      binding !== undefined &&
        now >= Date.parse(plan.issuedAt) &&
        now < Date.parse(plan.expiresAt) &&
        request.liveEvaluationPlanDigest === plan.planDigest &&
        request.liveEvaluationAuthorityDigest ===
          plan.approval.approvalDigest &&
        request.runtimePolicyDigest === policy.policyDigest &&
        request.organizationId === scope.organizationId &&
        request.projectId === scope.projectId &&
        request.userId === scope.userId &&
        request.plan === scope.plan &&
        same(request.cacheKeyAuthority, policy.cacheKeyAuthority) &&
        request.evaluationCaseDigest === binding.caseDigest &&
        request.inputDigest === binding.invocationInputDigest &&
        request.evaluationAuthorityTupleDigest ===
          binding.authorityBinding.authorityTupleDigest,
    );
    const tuple = binding.authorityBinding.authorityTuple;
    requireBinding(
      request.capabilityRegistryDigest === tuple.capabilityRegistryDigest &&
        request.routeRegistryDigest === tuple.routeRegistryDigest &&
        request.catalogDigest === tuple.catalogDigest &&
        request.operation === tuple.operation &&
        request.role === tuple.role &&
        request.promptTemplateDigest === tuple.promptTemplateDigest &&
        request.responseSchemaDigest === tuple.responseSchemaDigest,
    );
    requireBinding(
      evidence.evidenceDigest === request.inputEvidenceDigest &&
        evidence.organizationId === scope.organizationId &&
        evidence.projectId === scope.projectId &&
        evidence.userId === scope.userId &&
        evidence.inputDigest === request.inputDigest &&
        evidence.operation === request.operation &&
        same(evidence.requested, request.requested) &&
        inspectModelValueForSecretCandidatesV1(request).detectedValueCount ===
          0 &&
        inspectModelValueForSecretCandidatesV1(evidence).detectedValueCount ===
          0,
    );
    requireBinding(
      !policy.killSwitches.global.engaged &&
        !policy.killSwitches.capabilitySwitches.some(
          (c) => c.operation === tuple.operation && c.engaged,
        ) &&
        !policy.administrativeSuspensions.some(
          (s) =>
            s.scopeId ===
            (s.scope === "organization" ? scope.organizationId : scope.userId),
        ),
    );
    return { plan, request };
  });
}
