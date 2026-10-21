import {
  validateCreditNormalizationPolicyVersionV1,
  validateModelProviderPricingVersionV1,
  validateModelUsageUnitsV1,
} from "@cloudmarkup/domain";
import {
  MODEL_COMMERCIAL_DENIAL_REASONS,
  MODEL_COMMERCIAL_SAFE_FAILURE_CODES,
  digestModelCommercialVerifiedScopeV1,
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
  type ModelCommercialOperationRequestV1,
  type ModelCommercialLifecycleResponseV1,
  type ModelCommercialVerifiedScopeV1,
  type ModelCommercialWorkflowRecordV1,
} from "@cloudmarkup/model-gateway";
import {
  serializeCanonicalJson,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

// Data API returns at most 64 KiB per database row. Canonical metadata is capped
// at 16 KiB; SQL separately caps JSONB's whitespace-expanded text at 32 KiB,
// leaving ample space for the bounded identity/digest/lease columns.
export const COMMERCIAL_WORKFLOW_MAXIMUM_BYTES = 16384;
export class ModelCommercialWorkflowPersistenceError extends Error {
  readonly code = "model-commercial.persistence-invalid";
  constructor() {
    super("Commercial workflow persistence is unavailable or contradictory.");
    this.name = "ModelCommercialWorkflowPersistenceError";
  }
}
export function workflowFailure(): never {
  throw new ModelCommercialWorkflowPersistenceError();
}
export const workflowIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const workflowInstantSchema = z.string().refine((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
});
const instant = workflowInstantSchema;
const digest = sha256DigestSchema;
const environment = z.enum(["development", "test", "staging", "production"]);
const failure = z.enum(MODEL_COMMERCIAL_SAFE_FAILURE_CODES).nullable();
const denial = z.enum(MODEL_COMMERCIAL_DENIAL_REASONS).nullable();
const routeKind = z.enum(["standard", "deep"]);
const attemptKind = z.enum([
  "primary",
  "automatic-retry",
  "system-escalation",
  "repair",
]);
const usage = z
  .object({
    cacheReadUnits: integer,
    cacheWriteUnits: integer,
    inputUnits: integer,
    outputUnits: integer,
    totalUnits: integer,
    providerSpecificUnits: z
      .array(z.object({ unitName: identifier, units: integer }).strict())
      .max(32),
  })
  .strict()
  .refine((value) =>
    valid(() => {
      validateModelUsageUnitsV1(value);
    }),
  );
const estimate = z
  .object({
    maximumCreditUnits: integer,
    minimumCreditUnits: integer,
    requiresConfirmation: z.boolean(),
  })
  .strict()
  .refine((value) => value.minimumCreditUnits <= value.maximumCreditUnits);
const route = z
  .object({
    explanation: z.string().min(1).max(512),
    inferenceProfileId: identifier.nullable(),
    label: z.enum(["Standard Design", "Deep Design"]),
    modelId: identifier,
    modelVersion: identifier,
    providerKey: identifier,
    routeId: workflowIdSchema,
    route: routeKind,
  })
  .strict();
const limit = z.object({ current: integer, maximum: integer }).strict();
const authorization = z
  .object({
    allowed: z.boolean(),
    allowedModelKeys: z.array(z.string().min(1).max(1024)).max(32),
    allowedRouteIds: z.array(workflowIdSchema).max(32),
    approvedRoutes: z.array(route).max(32),
    availableCreditUnits: integer,
    chargingPolicyVersion: identifier,
    commercialState: z.enum(["active", "unavailable"]),
    denialReason: denial,
    entitlementPolicyVersion: identifier,
    evaluatedAt: instant,
    featureEntitled: z.boolean(),
    featureRequests: limit,
    maximumInputUnits: integer,
    maximumOutputUnits: integer,
    organizationConcurrentReservations: limit,
    organizationId: workflowIdSchema,
    organizationStatus: z.enum(["active", "suspended"]),
    perUserRequests: limit,
    planVersionId: identifier,
  })
  .strict();
const plannedCall = z
  .object({
    kind: attemptKind,
    maximumUsage: usage,
    minimumUsage: usage,
    routeId: workflowIdSchema,
  })
  .strict();
export const workflowRequestSchema = z
  .object({
    confirmationRequired: z.boolean(),
    environment,
    estimateAccepted: z.boolean(),
    eventIdPrefix: workflowIdSchema,
    expiresAt: instant,
    feature: workflowIdSchema,
    idempotencyKey: workflowIdSchema,
    includeTechnicalUnitDetail: z.boolean(),
    jobId: workflowIdSchema,
    multiCallWorkflowId: workflowIdSchema,
    organizationId: workflowIdSchema,
    plannedCalls: z.array(plannedCall).min(1).max(32),
    projectId: workflowIdSchema,
    promptId: workflowIdSchema,
    promptVersion: workflowIdSchema,
    requestedAt: instant,
    requestedMaximumInputUnits: integer,
    requestedMaximumOutputUnits: integer,
    requestedRoute: routeKind,
    requestId: workflowIdSchema,
    reservationId: workflowIdSchema,
    templateId: workflowIdSchema.nullable(),
    templateVersion: workflowIdSchema.nullable(),
    userId: workflowIdSchema,
  })
  .strict();
const attestation = z
  .object({
    attestationId: workflowIdSchema,
    authority: z.literal("host-dispatch-v1"),
    dispatchIntentId: workflowIdSchema,
    multiCallWorkflowId: workflowIdSchema,
    organizationId: workflowIdSchema,
    projectId: workflowIdSchema,
    reservationId: workflowIdSchema,
    verifierId: workflowIdSchema,
    verifierVersion: workflowIdSchema,
    noUsageObserved: z.literal(true),
    providerDispatchStarted: z.literal(false),
  })
  .strict();
const dispatch = z
  .object({ dispatchIntentId: workflowIdSchema, recordedAt: instant })
  .strict();
const proof = z
  .object({
    authority: z.literal("coordinator-host-clock-v1"),
    dispatchIntentId: workflowIdSchema,
    multiCallWorkflowId: workflowIdSchema,
    observedAt: instant,
    organizationId: workflowIdSchema,
    projectId: workflowIdSchema,
    proofId: workflowIdSchema,
    reservationId: workflowIdSchema,
    reason: z.literal("reservation-expired-before-dispatch"),
  })
  .strict();
const attempt = z
  .object({
    attemptId: workflowIdSchema,
    attemptKind,
    attemptNumber: integer.min(1),
    callId: workflowIdSchema,
    completedAt: instant,
    failureCategory: failure,
    invocationId: workflowIdSchema,
    latencyMilliseconds: integer,
    mayHaveBeenProcessed: z.boolean(),
    modelId: identifier,
    modelVersion: identifier,
    inferenceProfileId: identifier.nullable(),
    promptId: workflowIdSchema,
    promptVersion: workflowIdSchema,
    providerKey: identifier,
    providerRequestId: workflowIdSchema.nullable(),
    retryOfAttemptId: workflowIdSchema.nullable(),
    routeId: workflowIdSchema,
    startedAt: instant,
    status: z.enum([
      "succeeded",
      "provider-failure",
      "timed-out",
      "cancelled",
      "internal-failure",
    ]),
    usage: usage.nullable(),
    usageRecordId: workflowIdSchema,
  })
  .strict();
const invocationResult = z
  .object({
    attempts: z.array(attempt).max(32),
    completedAt: instant,
    failureCategory: failure,
    preDispatchNoUsageAttestation: attestation.optional(),
    resultId: workflowIdSchema,
    status: z.enum([
      "completed",
      "provider-failure",
      "timeout",
      "cancelled",
      "internal-failure",
    ]),
    usefulOutputDelivered: z.boolean(),
  })
  .strict()
  .transform(({ preDispatchNoUsageAttestation, ...value }) => ({
    ...value,
    ...(preDispatchNoUsageAttestation === undefined
      ? {}
      : { preDispatchNoUsageAttestation }),
  }));
const invocationReceipt = z
  .object({
    dispatchIntentId: workflowIdSchema,
    dispatchedAt: instant,
    receiptId: workflowIdSchema,
    receivedAt: instant,
    preDispatchProof: proof.nullable(),
    result: invocationResult,
  })
  .strict();
const reservationIntent = z
  .object({
    authority: z.literal("canonical-commercial-reservation-intent-v1"),
    capacityDigest: digest,
    eventDigest: digest,
    expiresAt: instant,
    intentId: workflowIdSchema,
    recordedAt: instant,
    reservationId: workflowIdSchema,
    requestedCreditUnits: integer,
  })
  .strict();
const reservationReceipt = z
  .object({
    accountingStatus: z.enum([
      "active",
      "denied",
      "expired",
      "released",
      "settled",
    ]),
    authority: z.literal("canonical-commercial-reservation-receipt-v1"),
    intentId: workflowIdSchema,
    receivedAt: instant,
    receiptId: workflowIdSchema,
    result: z
      .object({
        accepted: z.boolean(),
        denialReason: denial,
        replayed: z.boolean(),
        reservationId: workflowIdSchema,
      })
      .strict(),
  })
  .strict();
const pricing = z
  .object({
    cacheReadMicrosPerMillionUnits: integer.nullable(),
    cacheWriteMicrosPerMillionUnits: integer.nullable(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/u),
    effectiveFrom: instant,
    effectiveUntil: instant.nullable(),
    environment,
    inferenceProfileId: identifier.nullable(),
    inputMicrosPerMillionUnits: integer,
    modelId: identifier,
    modelVersion: identifier,
    outputMicrosPerMillionUnits: integer,
    pricingVersionId: identifier,
    providerKey: identifier,
    providerSpecificUnitRates: z
      .array(
        z
          .object({ microsPerMillionUnits: integer, unitName: identifier })
          .strict(),
      )
      .max(32),
    status: z.enum(["enabled", "disabled-pricing-unavailable"]),
    version: z.literal(1),
  })
  .strict()
  .refine((value) =>
    valid(() => {
      validateModelProviderPricingVersionV1(value);
    }),
  );
const normalization = z
  .object({
    creditUnitMicros: integer.min(1),
    currencyCode: z.string().regex(/^[A-Z]{3}$/u),
    effectiveFrom: instant,
    effectiveUntil: instant.nullable(),
    normalizationPolicyVersionId: identifier,
    operatingBufferBasisPoints: integer,
    status: z.enum(["enabled", "disabled"]),
    version: z.literal(1),
  })
  .strict()
  .refine((value) =>
    valid(() => {
      validateCreditNormalizationPolicyVersionV1(value);
    }),
  );
const pricingAuthority = z
  .object({
    authorityDigest: digest,
    capturedAt: instant,
    normalizationPolicyCatalogDigest: digest,
    pricingCatalogDigest: digest,
    routePins: z
      .array(
        z
          .object({
            normalizationPolicy: normalization,
            normalizationPolicyDigest: digest,
            pricingVersion: pricing,
            pricingVersionDigest: digest,
            routeId: workflowIdSchema,
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .refine((value) => {
    const { authorityDigest, ...body } = value;
    return (
      authorityDigest === digestStructuredValue(body) &&
      value.routePins.every(
        (pin) =>
          pin.normalizationPolicyDigest ===
            digestStructuredValue(pin.normalizationPolicy) &&
          pin.pricingVersionDigest ===
            digestStructuredValue(pin.pricingVersion),
      )
    );
  });
const context = z
  .object({
    authorization,
    estimateResult: z
      .object({
        estimate,
        maximumEstimatedProviderCostMicros: integer,
        normalizationPolicyVersionId: identifier,
        primaryPricingVersionId: identifier,
        pricingAuthority,
      })
      .strict(),
    reservationOccurredAt: instant,
    selectedRoute: route,
  })
  .strict();
const response = z
  .object({
    compensationStatus: z.enum([
      "not-required",
      "pending",
      "applied",
      "failed",
    ]),
    completedCreditUnits: integer.nullable(),
    denialReason: denial,
    estimate: estimate.nullable(),
    reconciliationState: z.enum([
      "not-required",
      "pending-missing-usage",
      "pending-settlement",
      "reconciled",
    ]),
    reservationAccepted: z.boolean(),
    reservationId: workflowIdSchema.nullable(),
    route: routeKind.nullable(),
    routeExplanation: z.string().min(1).max(512).nullable(),
    routeLabel: z.enum(["Standard Design", "Deep Design"]).nullable(),
    state: z.enum([
      "denied",
      "estimate-confirmation-required",
      "reservation-denied",
      "completed",
      "released",
      "compensated",
      "settlement-pending",
      "reconciliation-required",
    ]),
    technicalUnits: usage.nullable(),
    version: z.literal(1),
  })
  .strict();
/** Strict metadata projection shared by durable runtime terminals. This does
 * not authenticate a settlement or mutate the canonical commercial ledger. */
export function parseCommercialWorkflowResponseMetadata(
  value: unknown,
): ModelCommercialLifecycleResponseV1 {
  return response.parse(value);
}
const recordSchema = z
  .object({
    dispatchIntent: dispatch.nullable(),
    fingerprint: digest,
    invocationReceipt: invocationReceipt.nullable(),
    invocationResult: invocationResult.nullable(),
    request: workflowRequestSchema,
    reservationIntent: reservationIntent.nullable(),
    reservationReceipt: reservationReceipt.nullable(),
    revision: integer,
    resolvedContext: context.nullable(),
    response: response.nullable(),
    state: z.enum([
      "claimed",
      "reserved",
      "invoked",
      "settlement-pending",
      "reconciliation-required",
      "terminal",
    ]),
  })
  .strict();
export const workflowLeaseSchema = z
  .object({
    acquiredAt: instant,
    expiresAt: instant,
    fencingToken: z.string().regex(/^[1-9][0-9]{0,15}$/u),
    leaseId: workflowIdSchema,
  })
  .strict()
  .refine(
    (value) => Date.parse(value.acquiredAt) < Date.parse(value.expiresAt),
  );
const scopeSchema = z
  .object({
    authority: z.literal("verified-principal-scope-v1"),
    organizationId: workflowIdSchema,
    projectId: workflowIdSchema,
    userId: workflowIdSchema,
    tenantScopeDigest: digest,
  })
  .strict();
function valid(work: () => void): boolean {
  try {
    work();
    return true;
  } catch {
    return false;
  }
}
export function workflowJson(value: unknown): string {
  const json = serializeCanonicalJson(value);
  if (
    new TextEncoder().encode(json).byteLength >
      COMMERCIAL_WORKFLOW_MAXIMUM_BYTES ||
    inspectModelValueForSecretCandidatesV1(value).detectedValueCount !== 0
  )
    workflowFailure();
  return json;
}
export function workflowSame(left: unknown, right: unknown): boolean {
  return digestStructuredValue(left) === digestStructuredValue(right);
}
export function parseWorkflowScope(
  value: unknown,
): ModelCommercialVerifiedScopeV1 {
  const parsed = scopeSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.tenantScopeDigest !==
      digestModelCommercialVerifiedScopeV1(parsed.data)
  )
    return workflowFailure();
  workflowJson(parsed.data);
  return parsed.data;
}
export function parseWorkflowRequest(
  value: unknown,
  scope: ModelCommercialVerifiedScopeV1,
): ModelCommercialOperationRequestV1 {
  const parsed = workflowRequestSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.organizationId !== scope.organizationId ||
    parsed.data.projectId !== scope.projectId ||
    parsed.data.userId !== scope.userId
  )
    return workflowFailure();
  workflowJson(parsed.data);
  return parsed.data;
}
export function parseWorkflowRecord(
  value: unknown,
  scope: ModelCommercialVerifiedScopeV1,
): ModelCommercialWorkflowRecordV1 {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) return workflowFailure();
  const record = parsed.data;
  const request = parseWorkflowRequest(record.request, scope);
  workflowJson(record);
  if (
    record.fingerprint !== digestStructuredValue(request) ||
    (record.resolvedContext !== null &&
      record.resolvedContext.authorization.organizationId !==
        scope.organizationId) ||
    (record.reservationIntent !== null &&
      (record.resolvedContext === null ||
        record.reservationIntent.reservationId !== request.reservationId ||
        record.reservationIntent.expiresAt !== request.expiresAt)) ||
    (record.reservationReceipt !== null &&
      (record.reservationReceipt.intentId !==
        record.reservationIntent?.intentId ||
        record.reservationReceipt.result.reservationId !==
          request.reservationId)) ||
    (record.dispatchIntent !== null &&
      record.reservationReceipt?.result.accepted !== true) ||
    (record.invocationReceipt === null) !==
      (record.invocationResult === null) ||
    (record.invocationReceipt !== null &&
      (record.dispatchIntent?.dispatchIntentId !==
        record.invocationReceipt.dispatchIntentId ||
        !workflowSame(
          record.invocationReceipt.result,
          record.invocationResult,
        ))) ||
    (record.response?.reservationAccepted === true &&
      record.response.reservationId !== request.reservationId) ||
    (record.state === "terminal" ||
      record.state === "reconciliation-required") !==
      (record.response !== null) ||
    (["invoked", "settlement-pending"].includes(record.state) &&
      record.invocationReceipt === null) ||
    (record.state === "reserved" &&
      record.reservationReceipt?.result.accepted !== true)
  )
    return workflowFailure();
  for (const evidence of [
    record.invocationReceipt?.preDispatchProof,
    record.invocationResult?.preDispatchNoUsageAttestation,
  ]) {
    if (
      evidence != null &&
      (evidence.organizationId !== request.organizationId ||
        evidence.projectId !== request.projectId ||
        evidence.multiCallWorkflowId !== request.multiCallWorkflowId ||
        evidence.reservationId !== request.reservationId ||
        evidence.dispatchIntentId !== record.dispatchIntent?.dispatchIntentId)
    )
      workflowFailure();
  }
  return record;
}
/** Evidence may only accumulate, except the coordinator's fail-closed receipt
 * downgrade. The database retains every prior revision even for that downgrade. */
export function assertWorkflowTransition(
  before: ModelCommercialWorkflowRecordV1,
  after: ModelCommercialWorkflowRecordV1,
): void {
  if (
    before.response !== null ||
    before.fingerprint !== after.fingerprint ||
    !workflowSame(before.request, after.request)
  )
    workflowFailure();
  for (const key of [
    "resolvedContext",
    "reservationIntent",
    "dispatchIntent",
  ] as const) {
    if (before[key] !== null && !workflowSame(before[key], after[key]))
      workflowFailure();
  }
  const oldReservation = before.reservationReceipt;
  const newReservation = after.reservationReceipt;
  if (
    oldReservation !== null &&
    (oldReservation.intentId !== newReservation?.intentId ||
      oldReservation.result.accepted !== newReservation.result.accepted ||
      oldReservation.result.denialReason !==
        newReservation.result.denialReason ||
      oldReservation.result.reservationId !==
        newReservation.result.reservationId ||
      (oldReservation.result.replayed && !newReservation.result.replayed) ||
      (oldReservation.accountingStatus !== "active" &&
        oldReservation.accountingStatus !== newReservation.accountingStatus) ||
      Date.parse(newReservation.receivedAt) <
        Date.parse(oldReservation.receivedAt))
  )
    workflowFailure();
  const oldReceipt = before.invocationReceipt;
  const nextReceipt = after.invocationReceipt;
  if (oldReceipt !== null && !workflowSame(oldReceipt, nextReceipt)) {
    if (
      nextReceipt?.dispatchIntentId !== oldReceipt.dispatchIntentId ||
      nextReceipt.dispatchedAt !== oldReceipt.dispatchedAt ||
      nextReceipt.receivedAt !== oldReceipt.receivedAt ||
      nextReceipt.preDispatchProof !== null ||
      nextReceipt.result.preDispatchNoUsageAttestation !== undefined ||
      nextReceipt.result.failureCategory !== "unsafe-provider-receipt" ||
      nextReceipt.result.usefulOutputDelivered ||
      nextReceipt.result.status !== "internal-failure" ||
      nextReceipt.result.attempts.length !== 0
    )
      workflowFailure();
  }
  const rank = {
    claimed: 0,
    reserved: 1,
    invoked: 2,
    "settlement-pending": 3,
    "reconciliation-required": 4,
    terminal: 4,
  };
  if (rank[after.state] < rank[before.state]) workflowFailure();
}
