import { z } from "zod";
import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
} from "./architecture-document-v1.js";
import { digestCanonicalValue } from "./canonical-digest.js";
import { solutionStableIdSchema } from "./solution-contract-common-v1.js";
import {
  modelRuntimeAdmissionRequestV1Schema,
  modelRuntimeAdmissionDecisionV1Schema,
  modelRuntimeControlPolicyV1Schema,
} from "./model-evaluation-v1.js";
import { refineModelRuntimeControlCollections } from "./model-runtime-control-collections.js";
import { refineModelRuntimeAdmissionDecision } from "./model-runtime-admission-decision-validation.js";

const policy = modelRuntimeControlPolicyV1Schema.shape;
const request = modelRuntimeAdmissionRequestV1Schema.shape;

/** Report-independent controls for a future host-owned live evaluation.
 * Data validation only: neither a parsed policy nor its digest authorizes a
 * provider call, issues operator approval, prices usage or promotes a model.
 * Exact per-case model/route/prompt/schema/catalog tuples belong to the issued
 * evaluation plan, so one policy can cover the full frozen case matrix. */
export const modelLiveRuntimeControlPolicyV2Schema = z
  .object({
    administrativeSuspensions: policy.administrativeSuspensions,
    allowlists: policy.allowlists,
    cacheKeyAuthority: policy.cacheKeyAuthority,
    canonicalCommercialAuthority: policy.canonicalCommercialAuthority,
    contractVersion: z.literal(2),
    evaluationRequirement: z
      .object({
        datasetId: namespacedIdentifierSchema,
        datasetVersion: semanticVersionSchema,
        datasetDigest: sha256DigestSchema,
        datasetCaseDigests: z.array(sha256DigestSchema).min(1).max(21),
        evaluationPolicyDigest: sha256DigestSchema,
        evaluationPolicyId: namespacedIdentifierSchema,
        evaluationPolicyVersion: semanticVersionSchema,
        minimumDeterministicQualityBasisPoints:
          policy.evaluationGate.shape.minimumDeterministicQualityBasisPoints,
      })
      .strict(),
    featureEntitlements: policy.featureEntitlements,
    killSwitches: policy.killSwitches,
    limits: policy.limits,
    liveEvaluation: policy.liveEvaluation,
    policyDigest: sha256DigestSchema,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    recordKind: z.literal("model-live-runtime-control-policy"),
    requestWindows: policy.requestWindows,
    safety: policy.safety,
  })
  .strict()
  .superRefine((value, context) => {
    refineModelRuntimeControlCollections(value, context);
    const cases = value.evaluationRequirement.datasetCaseDigests;
    if (new Set(cases).size !== cases.length)
      context.addIssue({
        code: "custom",
        message:
          "Live evaluation must bind unique frozen cases in canonical order.",
        path: ["evaluationRequirement", "datasetCaseDigests"],
      });
    const { policyDigest, ...metadata } = value;
    if (policyDigest !== digestCanonicalValue(metadata))
      context.addIssue({
        code: "custom",
        message:
          "Live policy digest must bind every report-independent control and evaluation requirement.",
        path: ["policyDigest"],
      });
  });

export type ModelLiveRuntimeControlPolicyV2 = z.output<
  typeof modelLiveRuntimeControlPolicyV2Schema
>;
export function digestModelLiveRuntimeControlPolicyV2(
  value: Omit<ModelLiveRuntimeControlPolicyV2, "policyDigest">,
) {
  return digestCanonicalValue(value);
}

/** Evaluation-only proposal metadata. The future host must authenticate the
 * issued plan/approval, exact frozen case and current policy before inspecting
 * or claiming shared runtime capacity or entering canonical commercial work.
 * V1 normal-runtime readers intentionally reject this distinct format. */
export const modelLiveRuntimeAdmissionRequestV2Schema = z
  .object({
    capabilityRegistryDigest: request.capabilityRegistryDigest,
    cacheKeyAuthority: request.cacheKeyAuthority,
    catalogDigest: request.catalogDigest,
    commercialEstimate: request.commercialEstimate,
    contractVersion: z.literal(2),
    evaluationAuthorityTupleDigest: request.evaluationAuthorityTupleDigest,
    evaluationCaseDigest: sha256DigestSchema,
    evaluationCaseId: solutionStableIdSchema,
    executionClass: z.literal("live-evaluation"),
    idempotencyKeyDigest: request.idempotencyKeyDigest,
    inputDigest: request.inputDigest,
    inputEvidenceDigest: request.inputEvidenceDigest,
    liveEvaluationAuthorityDigest: sha256DigestSchema,
    liveEvaluationPlanDigest: sha256DigestSchema,
    operation: request.operation,
    organizationId: request.organizationId,
    plan: request.plan,
    projectId: request.projectId,
    promptTemplateDigest: request.promptTemplateDigest,
    recordKind: z.literal("model-live-runtime-admission-request"),
    requested: request.requested,
    requestDigest: request.requestDigest,
    responseSchemaDigest: request.responseSchemaDigest,
    role: request.role,
    routeRegistryDigest: request.routeRegistryDigest,
    routingDecisionDigest: request.routingDecisionDigest,
    runtimePolicyDigest: sha256DigestSchema,
    userId: request.userId,
  })
  .strict()
  .superRefine((value, context) => {
    const { requestDigest, ...metadata } = value;
    if (requestDigest !== digestCanonicalValue(metadata))
      context.addIssue({
        code: "custom",
        message:
          "Live admission must bind the exact tenant, frozen case, issued plan, policy, input evidence and commercial estimate.",
        path: ["requestDigest"],
      });
  });

export type ModelLiveRuntimeAdmissionRequestV2 = z.output<
  typeof modelLiveRuntimeAdmissionRequestV2Schema
>;
export function digestModelLiveRuntimeAdmissionRequestV2(
  value: Omit<ModelLiveRuntimeAdmissionRequestV2, "requestDigest">,
) {
  return digestCanonicalValue(value);
}

const decision = modelRuntimeAdmissionDecisionV1Schema.shape;

/** Report-free live outcome metadata. Only the future shared runtime store can
 * issue a decision and a fenced lease after authenticating current operator
 * approval, input evidence, routing and canonical commercial authority. */
export const modelLiveRuntimeAdmissionDecisionV2Schema = z
  .object({
    accountingAuthority: decision.accountingAuthority,
    authorization: decision.authorization,
    commercialEstimateDigest: decision.commercialEstimateDigest,
    contractVersion: z.literal(2),
    decisionDigest: decision.decisionDigest,
    decisionId: decision.decisionId,
    decidedAt: decision.decidedAt,
    denialReasons: decision.denialReasons,
    evaluationAuthorityTupleDigest: decision.evaluationAuthorityTupleDigest,
    evaluationCaseDigest: sha256DigestSchema,
    evaluationCaseId: solutionStableIdSchema,
    executionClass: z.literal("live-evaluation"),
    expiresAt: decision.expiresAt,
    invokeModel: decision.invokeModel,
    liveEvaluationAuthorityDigest: sha256DigestSchema,
    liveEvaluationPlanDigest: sha256DigestSchema,
    outcome: decision.outcome,
    recordKind: z.literal("model-live-runtime-admission-decision"),
    requestDigest: decision.requestDigest,
    routingDecisionDigest: decision.routingDecisionDigest,
    runtimePolicyDigest: decision.runtimePolicyDigest,
    safeError: decision.safeError,
    writeAuthority: decision.writeAuthority,
  })
  .strict()
  .superRefine(refineModelRuntimeAdmissionDecision);

export type ModelLiveRuntimeAdmissionDecisionV2 = z.output<
  typeof modelLiveRuntimeAdmissionDecisionV2Schema
>;
export function digestModelLiveRuntimeAdmissionDecisionV2(
  value: Omit<ModelLiveRuntimeAdmissionDecisionV2, "decisionDigest">,
) {
  return digestCanonicalValue(value);
}
