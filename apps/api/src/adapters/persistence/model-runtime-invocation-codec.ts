import { createHash } from "node:crypto";

import {
  digestStructuredValue,
  type ModelGatewayResultV1,
  type ModelInvocationClaimV1,
} from "@cloudmarkup/model-gateway";
import {
  modelGatewayOperationV1Schema,
  modelGatewayResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  modelInvocationScopeV1Schema,
  normalizedModelUsageV1Schema,
  serializeCanonicalJson,
  sha256DigestSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { z } from "zod";

export const MODEL_RESULT_MAXIMUM_BYTES = 16 * 1024 * 1024;
export type ModelInvocationScope = ModelGatewayResultV1["descriptor"]["scope"];
export interface ModelResultObjectReference {
  readonly objectId: string;
  readonly digest: Sha256Digest;
  readonly sizeBytes: number;
}
export class ModelRuntimePersistenceError extends Error {
  readonly code = "model-runtime.persistence-invalid";
  constructor() {
    super(
      "The model invocation persistence state is unavailable or contradictory.",
    );
    this.name = "ModelRuntimePersistenceError";
  }
}
export function persistenceFailure(): never {
  throw new ModelRuntimePersistenceError();
}
export const invocationClaimSchema = z
  .object({
    authorityDigest: sha256DigestSchema,
    idempotencyKeyDigest: sha256DigestSchema,
    inputDigest: sha256DigestSchema,
    invocationId: modelInvocationDescriptorV1Schema.shape.invocationId,
    escalation: z
      .object({
        feature: modelGatewayOperationV1Schema,
        lineageDigest: sha256DigestSchema,
        originalAcceptedEstimateMaximumCreditUnits: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
        originalCreditAuthorizationDecisionId: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u),
        originalInvocationId:
          modelInvocationDescriptorV1Schema.shape.invocationId,
        originalRoutingDecisionDigest: sha256DigestSchema,
        scopeDigest: sha256DigestSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
const resultSchema = z
  .object({
    descriptor: modelInvocationDescriptorV1Schema,
    redaction: z
      .object({
        categories: z
          .array(z.enum(["credential-candidate", "secret-candidate"]))
          .max(2),
        redactedValueCount: z.number().int().nonnegative(),
      })
      .strict(),
    response: modelGatewayResponseV1Schema,
    usage: normalizedModelUsageV1Schema,
  })
  .strict();
export const resultObjectSchema = z
  .object({
    objectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    digest: sha256DigestSchema,
    sizeBytes: z.number().int().min(1).max(MODEL_RESULT_MAXIMUM_BYTES),
  })
  .strict();
export function parseClaim(value: unknown): ModelInvocationClaimV1 {
  const parsed = invocationClaimSchema.safeParse(value);
  if (!parsed.success) return persistenceFailure();
  return parsed.data as ModelInvocationClaimV1;
}
export function parseScope(value: unknown): ModelInvocationScope {
  const parsed = modelInvocationScopeV1Schema.safeParse(value);
  if (!parsed.success) return persistenceFailure();
  return parsed.data;
}
export function same(left: unknown, right: unknown): boolean {
  return digestStructuredValue(left) === digestStructuredValue(right);
}
export function hex(value: Sha256Digest): string {
  return value.slice("sha256:".length);
}
export function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(serializeCanonicalJson(value));
}
export function digestBytes(bytes: Uint8Array): Sha256Digest {
  return sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  );
}
export function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    return persistenceFailure();
  }
}
export function parseResult(
  value: unknown,
  claim: ModelInvocationClaimV1,
  scope: ModelInvocationScope,
): ModelGatewayResultV1 {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) return persistenceFailure();
  const result = parsed.data;
  const descriptor = result.descriptor;
  const usage = result.usage;
  const provenance = result.response.provenance;
  if (
    !same(descriptor.scope, scope) ||
    !same(usage.scope, scope) ||
    descriptor.invocationId !== claim.invocationId ||
    usage.invocationId !== claim.invocationId ||
    descriptor.inputDigest !== claim.inputDigest ||
    usage.inputDigest !== claim.inputDigest ||
    descriptor.idempotencyKeyDigest !== claim.idempotencyKeyDigest ||
    usage.idempotencyKeyDigest !== claim.idempotencyKeyDigest ||
    result.response.operation !== descriptor.feature ||
    usage.feature !== descriptor.feature ||
    provenance.gatewayId !== "cloudmarkup.model-gateway" ||
    (claim.escalation !== undefined) !==
      (descriptor.routing?.routeId === "internal-escalation") ||
    (claim.escalation !== undefined &&
      (claim.escalation.feature !== descriptor.feature ||
        claim.escalation.scopeDigest !== digestStructuredValue(scope) ||
        claim.escalation.originalAcceptedEstimateMaximumCreditUnits !==
          descriptor.routing?.acceptedMaximumCreditUnits)) ||
    usage.result !== "succeeded" ||
    !same(usage.routing ?? null, descriptor.routing ?? null) ||
    [
      "providerId",
      "modelId",
      "modelVersion",
      "promptTemplateId",
      "promptVersion",
      "inferenceProfileId",
    ].some(
      (key) =>
        (usage as Record<string, unknown>)[key] !==
        (descriptor as Record<string, unknown>)[key],
    ) ||
    [
      "invocationId",
      "inputDigest",
      "providerId",
      "modelId",
      "modelVersion",
      "promptTemplateId",
      "promptVersion",
      "promptDigest",
      "inferenceProfileId",
    ].some(
      (key) =>
        (provenance as Record<string, unknown>)[key] !==
        (descriptor as Record<string, unknown>)[key],
    )
  )
    return persistenceFailure();
  return result;
}
export function validEscalation(
  claim: ModelInvocationClaimV1,
  original: ModelGatewayResultV1 | null,
): boolean {
  const escalation = claim.escalation;
  if (escalation === undefined || original === null) return false;
  const { lineageDigest, ...lineage } = escalation;
  const descriptor = original.descriptor;
  return (
    lineageDigest ===
      digestStructuredValue({ ...lineage, inputDigest: claim.inputDigest }) &&
    descriptor.feature === escalation.feature &&
    descriptor.inputDigest === claim.inputDigest &&
    digestStructuredValue(descriptor.scope) === escalation.scopeDigest &&
    descriptor.budgetDecisionId ===
      escalation.originalCreditAuthorizationDecisionId &&
    descriptor.routing?.routeId === "standard-design" &&
    descriptor.routing.acceptedMaximumCreditUnits ===
      escalation.originalAcceptedEstimateMaximumCreditUnits &&
    descriptor.routing.routingDecisionDigest ===
      escalation.originalRoutingDecisionDigest
  );
}
