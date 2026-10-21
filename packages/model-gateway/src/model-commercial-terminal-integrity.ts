import { validateModelUsageUnitsV1 } from "@cloudmarkup/domain";
import { sha256DigestSchema } from "@cloudmarkup/schemas";
import { z } from "zod";
import type { ModelCommercialOperationRequestV1 } from "./commercial-lifecycle.js";
import {
  MODEL_COMMERCIAL_SAFE_FAILURE_CODES,
  parseModelCommercialInvocationResultV1,
} from "./commercial-lifecycle.js";
import {
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
} from "./security.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z
  .string()
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
  );
const failure = z
  .string()
  .refine((value) =>
    MODEL_COMMERCIAL_SAFE_FAILURE_CODES.some((code) => code === value),
  )
  .nullable();
const units = z
  .object({
    inputUnits: integer,
    outputUnits: integer,
    cacheReadUnits: integer,
    cacheWriteUnits: integer,
    totalUnits: integer,
    providerSpecificUnits: z
      .array(z.object({ unitName: id, units: integer }).strict())
      .max(32),
  })
  .strict()
  .refine((value) => {
    try {
      validateModelUsageUnitsV1(value);
      return true;
    } catch {
      return false;
    }
  });
const route = z.enum(["standard", "deep"]);
const estimate = z
  .object({
    minimumCreditUnits: integer,
    maximumCreditUnits: integer,
    requiresConfirmation: z.boolean(),
  })
  .strict()
  .refine((v) => v.minimumCreditUnits <= v.maximumCreditUnits);
const response = z
  .object({
    compensationStatus: z.enum([
      "not-required",
      "pending",
      "applied",
      "failed",
    ]),
    completedCreditUnits: integer.nullable(),
    denialReason: z.null(),
    estimate,
    reconciliationState: z.literal("not-required"),
    reservationAccepted: z.literal(true),
    reservationId: id,
    route,
    routeExplanation: z.string().min(1).max(512),
    routeLabel: z.enum(["Standard Design", "Deep Design"]),
    state: z.enum(["completed", "released", "compensated"]),
    technicalUnits: units.nullable(),
    version: z.literal(1),
  })
  .strict();
const attempt = z
  .object({
    attemptId: id,
    attemptKind: z.enum([
      "primary",
      "automatic-retry",
      "system-escalation",
      "repair",
    ]),
    attemptNumber: integer.min(1),
    callId: id,
    completedAt: instant,
    estimatedProviderCostMicros: integer,
    failureCategory: failure,
    inferenceProfileId: id.nullable(),
    invocationId: id,
    latencyMilliseconds: integer,
    mayHaveBeenProcessed: z.boolean(),
    modelId: id,
    modelVersion: id,
    normalizationPolicyVersionId: id,
    pricingVersionId: id,
    promptId: id,
    promptVersion: id,
    providerKey: id,
    providerRequestId: id.nullable(),
    retryOfAttemptId: id.nullable(),
    routeId: id,
    startedAt: instant,
    status: z.enum([
      "succeeded",
      "provider-failure",
      "timed-out",
      "cancelled",
      "internal-failure",
    ]),
    usage: units,
    usageRecordId: id,
  })
  .strict();
const event = z
  .object({
    attempts: z.array(attempt).max(32),
    cacheReadUnits: integer,
    cacheWriteUnits: integer,
    chargedCreditUnits: integer,
    compensatedCreditUnits: integer,
    completedAt: instant.nullable(),
    environment: z.enum(["development", "test", "staging", "production"]),
    estimatedProviderCostMicros: integer,
    eventId: id,
    failureCategory: failure,
    feature: id,
    idempotencyKey: id,
    inferenceProfileId: id.nullable(),
    inputUnits: integer,
    jobId: id,
    latencyMilliseconds: integer,
    modelId: id,
    modelVersion: id,
    multiCallWorkflowId: id,
    normalizationPolicyVersionId: id,
    occurredAt: instant,
    organizationId: id,
    outputUnits: integer,
    pricingVersionId: id,
    projectId: id,
    promptId: id,
    promptVersion: id,
    providerKey: id,
    providerSpecificUnits: z
      .array(z.object({ unitName: id, units: integer }).strict())
      .max(32),
    reconciliationState: z.literal("not-required"),
    requestId: id,
    reservationId: id,
    reservedCreditUnits: integer,
    route,
    routeId: id,
    startedAt: instant.nullable(),
    status: z.enum([
      "completed",
      "released",
      "provider-failure",
      "cancelled",
      "internal-failure",
      "compensated",
    ]),
    templateId: id.nullable(),
    templateVersion: id.nullable(),
    totalUnits: integer,
    userId: id,
    version: z.literal(1),
  })
  .strict();
const outcome = z
  .object({
    actualCreditUnits: integer,
    event,
    kind: z.enum(["settlement", "release"]),
    response,
  })
  .strict();
export const canonicalModelTerminalMetadataSchema = z
  .object({
    kind: z.literal("verified"),
    requestDigest: sha256DigestSchema,
    reservationId: id,
    dispatchIntentId: id,
    pricingAuthorityDigest: sha256DigestSchema,
    outcome,
  })
  .strict();
/** Version-independent financial integrity after an explicit authority parser. */
export function assertCanonicalModelTerminalIntegrity(
  parsed: z.output<typeof canonicalModelTerminalMetadataSchema>,
  request: ModelCommercialOperationRequestV1,
): void {
  const e = parsed.outcome.event,
    r = parsed.outcome.response;
  const technical = {
    inputUnits: e.inputUnits,
    outputUnits: e.outputUnits,
    cacheReadUnits: e.cacheReadUnits,
    cacheWriteUnits: e.cacheWriteUnits,
    totalUnits: e.totalUnits,
    providerSpecificUnits: e.providerSpecificUnits,
  };
  const settled = parsed.outcome.kind === "settlement",
    compensated = e.compensatedCreditUnits > 0;
  if (
    new TextEncoder().encode(JSON.stringify(parsed)).length > 16384 ||
    inspectModelValueForSecretCandidatesV1(parsed).detectedValueCount !== 0 ||
    parsed.requestDigest !== digestStructuredValue(request) ||
    parsed.reservationId !== request.reservationId ||
    e.reservationId !== request.reservationId ||
    e.organizationId !== request.organizationId ||
    e.projectId !== request.projectId ||
    e.userId !== request.userId ||
    e.requestId !== request.requestId ||
    e.multiCallWorkflowId !== request.multiCallWorkflowId ||
    e.jobId !== request.jobId ||
    e.feature !== request.feature ||
    e.promptId !== request.promptId ||
    e.promptVersion !== request.promptVersion ||
    e.templateId !== request.templateId ||
    e.templateVersion !== request.templateVersion ||
    e.eventId !== request.eventIdPrefix + "_" + parsed.outcome.kind ||
    e.idempotencyKey !== request.idempotencyKey + ":" + parsed.outcome.kind ||
    request.plannedCalls.length !== 1 ||
    request.plannedCalls[0]?.kind !== "primary" ||
    request.plannedCalls[0].routeId !== e.routeId ||
    e.route !== request.requestedRoute ||
    r.routeLabel !==
      (request.requestedRoute === "standard"
        ? "Standard Design"
        : "Deep Design") ||
    r.compensationStatus !== (compensated ? "applied" : "not-required") ||
    r.state !==
      (compensated ? "compensated" : settled ? "completed" : "released") ||
    (settled &&
      (e.status !== (compensated ? "compensated" : "completed") ||
        e.failureCategory !== (compensated ? "estimate-overrun" : null))) ||
    (!settled &&
      !["provider-failure", "cancelled", "internal-failure"].includes(
        e.status,
      )) ||
    digestStructuredValue(r.technicalUnits) !==
      digestStructuredValue(
        request.includeTechnicalUnitDetail ? technical : null,
      ) ||
    e.environment !== request.environment ||
    r.reservationId !== request.reservationId ||
    r.route !== e.route ||
    r.estimate.maximumCreditUnits !== e.reservedCreditUnits ||
    r.completedCreditUnits !== e.chargedCreditUnits ||
    parsed.outcome.actualCreditUnits !==
      e.chargedCreditUnits + e.compensatedCreditUnits ||
    e.chargedCreditUnits > e.reservedCreditUnits ||
    (parsed.outcome.kind === "release" && e.chargedCreditUnits !== 0) ||
    (parsed.outcome.kind === "settlement" &&
      e.chargedCreditUnits !==
        Math.min(parsed.outcome.actualCreditUnits, e.reservedCreditUnits))
  )
    throw new TypeError("Canonical model terminal metadata is contradictory.");
  validateModelUsageUnitsV1(e);
  // Reuse the real coordinator's exact attempt, safe-code and admitted usage
  // bounds. Pricing and tenant authority still come only from the host journal.
  parseModelCommercialInvocationResultV1(
    {
      attempts: e.attempts.map(
        ({
          estimatedProviderCostMicros,
          pricingVersionId,
          normalizationPolicyVersionId,
          ...raw
        }) => {
          void estimatedProviderCostMicros;
          void pricingVersionId;
          void normalizationPolicyVersionId;
          return raw;
        },
      ),
      completedAt: e.completedAt,
      failureCategory: settled ? null : e.failureCategory,
      resultId: e.eventId,
      status: settled ? "completed" : e.status,
      usefulOutputDelivered: settled,
    },
    request,
  );
  if (e.attempts.length > 1)
    throw new TypeError("Terminal recovery supports one primary attempt only.");
  const a = e.attempts[0];
  if (a === undefined) {
    if (
      settled ||
      e.totalUnits !== 0 ||
      e.providerSpecificUnits.length !== 0 ||
      e.estimatedProviderCostMicros !== 0 ||
      parsed.outcome.actualCreditUnits !== 0 ||
      e.startedAt !== null ||
      e.latencyMilliseconds !== 0
    )
      throw new TypeError("Terminal no-dispatch projection is contradictory.");
  } else if (
    a.attemptKind !== "primary" ||
    a.attemptNumber !== 1 ||
    a.retryOfAttemptId !== null ||
    a.routeId !== e.routeId ||
    a.providerKey !== e.providerKey ||
    a.modelId !== e.modelId ||
    a.modelVersion !== e.modelVersion ||
    a.inferenceProfileId !== e.inferenceProfileId ||
    a.promptId !== e.promptId ||
    a.promptVersion !== e.promptVersion ||
    a.pricingVersionId !== e.pricingVersionId ||
    a.normalizationPolicyVersionId !== e.normalizationPolicyVersionId ||
    digestStructuredValue(a.usage) !== digestStructuredValue(technical) ||
    a.estimatedProviderCostMicros !== e.estimatedProviderCostMicros ||
    a.startedAt !== e.startedAt ||
    a.completedAt !== e.completedAt ||
    a.latencyMilliseconds !== e.latencyMilliseconds ||
    (settled && a.status !== "succeeded")
  )
    throw new TypeError("Terminal attempt projection is contradictory.");
}
