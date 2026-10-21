import {
  digestModelCommercialVerifiedScopeV1,
  digestStructuredValue,
  parseIntentPreviewGenerationEvidenceV1,
  type IntentPreviewGenerationEvidenceV1,
  type ModelCommercialInvocationContextV1,
  type ModelCommercialOperationRequestV1,
} from "@cloudmarkup/model-gateway";
import {
  sha256DigestSchema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import {
  AiIntentPreviewError,
  type AiIntentPreviewBindingV1,
} from "../../application/ai-intent-preview-journal.js";
import { parseScope } from "./model-runtime-invocation-codec.js";
import {
  parseWorkflowRequest,
  workflowIdSchema,
  workflowInstantSchema,
} from "./model-commercial-workflow-codec.js";

export const aiPreviewTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
export const aiPreviewProofSchema = z
  .object({
    contractVersion: z.literal(1),
    invocationId: workflowIdSchema,
    outputDigest: sha256DigestSchema,
    expiresAt: workflowInstantSchema,
    token: aiPreviewTokenSchema,
  })
  .strict();
export function previewFailure(): never {
  throw new AiIntentPreviewError();
}
export function previewAssert(value: boolean): asserts value {
  if (!value) previewFailure();
}
/** Keep parser details and arbitrary supplied values out of adapter errors. */
export function previewChecked<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return previewFailure();
  }
}
export function previewJson(value: unknown, maximumBytes = 8192): string {
  const serialized = serializeCanonicalJson(value);
  previewAssert(new TextEncoder().encode(serialized).length <= maximumBytes);
  return serialized;
}
export function previewSame(left: unknown, right: unknown): boolean {
  return digestStructuredValue(left) === digestStructuredValue(right);
}
export function previewReadJson(value: unknown): unknown {
  try {
    return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  } catch {
    return previewFailure();
  }
}
export function previewScope(binding: AiIntentPreviewBindingV1) {
  previewAssert(binding.scope.projectId !== undefined);
  const identities = {
    organizationId: binding.scope.organizationId,
    projectId: binding.scope.projectId,
    userId: binding.scope.userId,
  };
  return {
    ...identities,
    authority: "verified-principal-scope-v1" as const,
    tenantScopeDigest: digestModelCommercialVerifiedScopeV1(identities),
  };
}
export function parsePreviewBinding(value: unknown): AiIntentPreviewBindingV1 {
  const exact = z
    .object({
      contractVersion: z.literal(1),
      scope: z.unknown(),
      request: z.unknown(),
      invocationId: workflowIdSchema,
      idempotencyKeyDigest: sha256DigestSchema,
      inputDigest: sha256DigestSchema,
      previewBindingDigest: sha256DigestSchema,
    })
    .strict()
    .parse(value);
  const scope = parseScope(exact.scope);
  previewAssert(scope.projectId !== undefined && scope.jobId !== undefined);
  const request = parseWorkflowRequest(exact.request, {
    authority: "verified-principal-scope-v1",
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    tenantScopeDigest: digestModelCommercialVerifiedScopeV1({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      userId: scope.userId,
    }),
  });
  previewAssert(
    request.feature === "intent.extract" &&
      request.requestedRoute === "standard" &&
      request.plannedCalls.length === 1 &&
      request.plannedCalls[0]?.kind === "primary" &&
      request.plannedCalls[0].routeId === "standard-design" &&
      request.jobId === scope.jobId,
  );
  const parsed = { ...exact, scope, request };
  previewJson(parsed, 16384);
  return parsed;
}
export function previewGeneration(
  value: unknown,
  request: ModelCommercialOperationRequestV1,
): IntentPreviewGenerationEvidenceV1 {
  const parsed = parseIntentPreviewGenerationEvidenceV1(
    previewReadJson(value),
    request,
  );
  previewJson(parsed);
  return parsed;
}
export function previewCallback(
  value: ModelCommercialInvocationContextV1,
): ModelCommercialInvocationContextV1 {
  const id = workflowIdSchema;
  const digest = sha256DigestSchema;
  const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
  const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u);
  const parsed = z
    .object({
      acceptedMaximumCreditUnits: units,
      acceptedMaximumEstimatedProviderCostMicros: units,
      dispatchIntentId: id,
      multiCallWorkflowId: id,
      normalizationPolicyCatalogDigest: digest,
      normalizationPolicyVersionReference: identifier,
      pricingAuthorityDigest: digest,
      pricingCatalogDigest: digest,
      pricingVersionReference: identifier,
      reservationId: id,
      route: z
        .object({
          explanation: z.string().min(1).max(1000),
          inferenceProfileId: identifier.nullable(),
          label: z.literal("Standard Design"),
          modelId: identifier,
          modelVersion: identifier,
          providerKey: identifier,
          route: z.literal("standard"),
          routeId: z.literal("standard-design"),
        })
        .strict(),
    })
    .strict()
    .parse(value);
  previewJson(parsed);
  return parsed;
}
