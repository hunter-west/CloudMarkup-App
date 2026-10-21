import {
  digestModelCommercialVerifiedScopeV1,
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
  modelUsageToCommercialAttemptV1,
  parseModelLiveGenerationEvidenceV2,
  type ModelCommercialInvocationContextV1,
  type ModelCommercialOperationRequestV1,
  type ModelLiveGenerationEvidenceV2,
} from "@cloudmarkup/model-gateway";
import {
  modelInvocationScopeV1Schema,
  normalizedModelUsageV1Schema,
  sha256DigestSchema,
  serializeCanonicalJson,
  solutionStableIdSchema,
  type ModelLiveRuntimeAdmissionRequestV2,
} from "@cloudmarkup/schemas";
import { z } from "zod";

export class ModelLiveJournalError extends Error {
  readonly code = "model-live.journal-unavailable";
  constructor() {
    super("Live evaluation metadata is unavailable or contradictory.");
    this.name = "ModelLiveJournalError";
  }
}
export function liveJournalAssert(value: boolean): asserts value {
  if (!value) throw new ModelLiveJournalError();
}
export const liveJournalBindingSchema = z
  .object({
    contractVersion: z.literal(2),
    scope: modelInvocationScopeV1Schema,
    requestDigest: sha256DigestSchema,
    runtimeRequestDigest: sha256DigestSchema,
    accountingBindingDigest: sha256DigestSchema,
    liveEvaluationPlanDigest: sha256DigestSchema,
    liveEvaluationAuthorityDigest: sha256DigestSchema,
    evaluationCaseId: solutionStableIdSchema,
    evaluationCaseDigest: sha256DigestSchema,
    invocationId: solutionStableIdSchema,
    claimAuthorityDigest: sha256DigestSchema,
    inputDigest: sha256DigestSchema,
    idempotencyKeyDigest: sha256DigestSchema,
  })
  .strict()
  .refine(
    (v) => v.scope.projectId !== undefined && v.scope.jobId !== undefined,
  );
export type ModelLiveJournalBindingV2 = z.output<
  typeof liveJournalBindingSchema
>;
export function liveJournalJson(value: unknown, maximumBytes = 4096): string {
  const encoded = serializeCanonicalJson(value);
  liveJournalAssert(
    new TextEncoder().encode(encoded).length <= maximumBytes &&
      inspectModelValueForSecretCandidatesV1(value).detectedValueCount === 0,
  );
  return encoded;
}
export function liveJournalRead(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}
export const liveJournalSame = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);
export function liveJournalScope(binding: ModelLiveJournalBindingV2) {
  liveJournalAssert(binding.scope.projectId !== undefined);
  const identity = {
    organizationId: binding.scope.organizationId,
    projectId: binding.scope.projectId,
    userId: binding.scope.userId,
  };
  return {
    ...identity,
    authority: "verified-principal-scope-v1" as const,
    tenantScopeDigest: digestModelCommercialVerifiedScopeV1(identity),
  };
}
export function liveJournalUsage(
  value: unknown,
  binding: ModelLiveJournalBindingV2,
  callback: ModelCommercialInvocationContextV1,
  request: ModelCommercialOperationRequestV1,
  admission: ModelLiveRuntimeAdmissionRequestV2,
) {
  const usage = normalizedModelUsageV1Schema.parse(value);
  liveJournalAssert(
    usage.attemptNumber === 1 &&
      usage.feature === request.feature &&
      usage.invocationId === binding.invocationId &&
      usage.inputDigest === binding.inputDigest &&
      usage.idempotencyKeyDigest === binding.idempotencyKeyDigest &&
      liveJournalSame(usage.scope, binding.scope) &&
      usage.routing?.routingDecisionDigest ===
        admission.routingDecisionDigest &&
      usage.routing.routeId === callback.route.routeId &&
      usage.routing.acceptedMaximumCreditUnits ===
        callback.acceptedMaximumCreditUnits &&
      usage.modelId === callback.route.modelId &&
      usage.modelVersion === callback.route.modelVersion &&
      usage.providerId === callback.route.providerKey &&
      (usage.inferenceProfileId ?? null) ===
        callback.route.inferenceProfileId &&
      usage.promptTemplateId === request.promptId &&
      usage.promptVersion === request.promptVersion,
  );
  liveJournalJson(usage);
  liveJournalGeneration(
    usage,
    binding,
    request,
    admission,
    usage.result !== "succeeded",
  );
  return usage;
}
export function liveJournalGeneration(
  usage: z.output<typeof normalizedModelUsageV1Schema>,
  binding: ModelLiveJournalBindingV2,
  request: ModelCommercialOperationRequestV1,
  admission: ModelLiveRuntimeAdmissionRequestV2,
  failed: boolean,
): ModelLiveGenerationEvidenceV2 {
  return parseModelLiveGenerationEvidenceV2(
    {
      attempts: [modelUsageToCommercialAttemptV1(usage)],
      completedAt: usage.completedAt,
      failureCategory: failed ? "model-gateway.internal-error" : null,
      resultId:
        "result_" +
        digestStructuredValue({
          invocationId: binding.invocationId,
          multiCallWorkflowId: request.multiCallWorkflowId,
        }).slice(7, 55),
      status: failed ? "internal-failure" : "completed",
    },
    request,
    admission,
  );
}
