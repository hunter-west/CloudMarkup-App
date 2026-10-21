import {
  modelLiveRuntimeAdmissionRequestV2Schema,
  type ModelLiveRuntimeAdmissionRequestV2,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  parseModelLiveCommercialInvocationEvidenceV2,
  type ModelLiveCommercialInvocationRecoveryPortV2,
} from "./model-live-invocation-recovery.js";
import {
  parseModelLiveCommercialVerifiedTerminalV2,
  type ModelLiveCommercialTerminalRecoveryPortV2,
} from "./model-live-commercial-terminal-recovery.js";
import {
  calculateModelProviderCostV1,
  normalizeModelProviderCostToCreditsV1,
  selectCreditNormalizationPolicyVersionV1,
  selectModelProviderPricingVersionV1,
  type CreditNormalizationPolicyVersionV1,
  type ModelCommercialEnvironmentV1,
  type ModelProviderPricingVersionV1,
  type ModelUsageUnitsV1,
} from "@cloudmarkup/domain";
import {
  digestStructuredValue,
  sha256Text,
  inspectModelValueForSecretCandidatesV1,
} from "./security.js";
import {
  parseModelCommercialVerifiedTerminalV1,
  type ModelCommercialTerminalRecoveryPortV1,
} from "./model-commercial-terminal-recovery.js";

export const MODEL_COMMERCIAL_LIFECYCLE_VERSION = 1 as const;

export const MODEL_COMMERCIAL_SAFE_FAILURE_CODES = [
  "callback-outcome-unknown",
  "cloudmarkup.runtime.result-sanitization-failed",
  "cloudmarkup.preview.delivery-unconfirmed",
  "cloudmarkup.model-evaluation.validation-unavailable",
  "cloudmarkup.solution-planner.rejected",
  "estimate-overrun",
  "host-attested-pre-dispatch-no-usage",
  "missing-provider-usage",
  "model-gateway.canceled",
  "model-gateway.internal-error",
  "model-gateway.invalid-output",
  "model-gateway.invalid-usage",
  "model-gateway.missing-usage",
  "model-gateway.provider-error",
  "model-provider.canceled",
  "model-provider.invalid-usage",
  "model-provider.metering-failed",
  "model-provider.missing-usage",
  "model-provider.no-usage",
  "model-provider.timeout",
  "cancelled",
  "internal-failure",
  "provider-error",
  "provider-failure",
  "provider-timeout",
  "reservation-expired-before-dispatch",
  "unsafe-provider-receipt",
] as const;

export type ModelCommercialSafeFailureCodeV1 =
  (typeof MODEL_COMMERCIAL_SAFE_FAILURE_CODES)[number];

export const MODEL_COMMERCIAL_DENIAL_REASONS = [
  "commercial-state-unavailable",
  "organization-suspended",
  "plan-not-entitled",
  "route-not-allowed",
  "model-not-allowed",
  "pricing-unavailable",
  "confirmation-required",
  "insufficient-credits",
  "per-user-request-limit-reached",
  "organization-concurrent-reservation-limit-reached",
  "feature-limit-reached",
  "maximum-input-exceeded",
  "maximum-output-exceeded",
  "reservation-denied",
  "cross-tenant-denied",
] as const;

export type ModelCommercialDenialReasonV1 =
  (typeof MODEL_COMMERCIAL_DENIAL_REASONS)[number];

export type ModelCommercialRouteKindV1 = "standard" | "deep";
export type ModelCommercialAttemptKindV1 =
  "primary" | "automatic-retry" | "system-escalation" | "repair";

export interface ModelCommercialRouteV1 {
  readonly explanation: string;
  readonly inferenceProfileId: string | null;
  readonly label: "Standard Design" | "Deep Design";
  readonly modelId: string;
  readonly modelVersion: string;
  readonly providerKey: string;
  readonly route: ModelCommercialRouteKindV1;
  readonly routeId: string;
}

export interface ModelCommercialLimitSnapshotV1 {
  readonly current: number;
  readonly maximum: number;
}

export interface ModelCommercialAuthorizationDecisionV1 {
  readonly allowed: boolean;
  readonly allowedModelKeys: readonly string[];
  readonly allowedRouteIds: readonly string[];
  readonly approvedRoutes: readonly ModelCommercialRouteV1[];
  readonly availableCreditUnits: number;
  readonly chargingPolicyVersion: string;
  readonly commercialState: "active" | "unavailable";
  readonly denialReason: ModelCommercialDenialReasonV1 | null;
  readonly entitlementPolicyVersion: string;
  readonly evaluatedAt: string;
  readonly featureEntitled: boolean;
  readonly featureRequests: ModelCommercialLimitSnapshotV1;
  readonly maximumInputUnits: number;
  readonly maximumOutputUnits: number;
  readonly organizationConcurrentReservations: ModelCommercialLimitSnapshotV1;
  readonly organizationId: string;
  readonly organizationStatus: "active" | "suspended";
  readonly perUserRequests: ModelCommercialLimitSnapshotV1;
  readonly planVersionId: string;
}

export interface ModelCommercialEstimateCallV1 {
  readonly kind: ModelCommercialAttemptKindV1;
  readonly maximumUsage: ModelUsageUnitsV1;
  readonly minimumUsage: ModelUsageUnitsV1;
  readonly routeId: string;
}

export interface ModelCommercialPreDispatchNoUsageAttestationV1 {
  readonly attestationId: string;
  readonly authority: "host-dispatch-v1";
  readonly dispatchIntentId: string;
  readonly multiCallWorkflowId: string;
  readonly noUsageObserved: true;
  readonly organizationId: string;
  readonly projectId: string;
  readonly providerDispatchStarted: false;
  readonly reservationId: string;
  readonly verifierId: string;
  readonly verifierVersion: string;
}

export interface ModelCommercialHostAttestationPortV1 {
  verifyPreDispatchNoUsage(input: {
    readonly attestation: ModelCommercialPreDispatchNoUsageAttestationV1;
    readonly expected: {
      readonly dispatchIntentId: string;
      readonly multiCallWorkflowId: string;
      readonly organizationId: string;
      readonly projectId: string;
      readonly reservationId: string;
    };
  }): Promise<boolean>;
}

export interface ModelCommercialDispatchIntentV1 {
  readonly dispatchIntentId: string;
  readonly recordedAt: string;
}

/** Host-owned metadata-only recovery. Implementations authenticate a durable
 * dispatch/output/delivery journal; arbitrary caller outcomes are not evidence.
 * Pending delivery must not irreversibly become unknown usage. */
export interface ModelCommercialInvocationRecoveryPortV1 {
  recoverVerified(input: {
    readonly dispatchIntent: ModelCommercialDispatchIntentV1;
    readonly request: ModelCommercialOperationRequestV1;
  }): Promise<
    | { readonly kind: "unavailable" }
    | { readonly kind: "pending" }
    | {
        readonly kind: "verified";
        readonly authority: "intent-preview-delivery-v1";
        readonly dispatchIntentId: string;
        readonly requestDigest: string;
        readonly result: ModelCommercialInvocationResultV1;
      }
  >;
}

export interface ModelCommercialCoordinatorPreDispatchProofV1 {
  readonly authority: "coordinator-host-clock-v1";
  readonly dispatchIntentId: string;
  readonly multiCallWorkflowId: string;
  readonly observedAt: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly proofId: string;
  readonly reason: "reservation-expired-before-dispatch";
  readonly reservationId: string;
}

export interface ModelCommercialHostInvocationReceiptV1 {
  readonly dispatchIntentId: string;
  readonly dispatchedAt: string;
  readonly preDispatchProof: ModelCommercialCoordinatorPreDispatchProofV1 | null;
  readonly receiptId: string;
  readonly receivedAt: string;
  readonly result: ModelCommercialInvocationResultV1;
}

export interface ModelCommercialOperationRequestV1 {
  readonly confirmationRequired: boolean;
  readonly estimateAccepted: boolean;
  readonly eventIdPrefix: string;
  readonly expiresAt: string;
  readonly feature: string;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly multiCallWorkflowId: string;
  readonly organizationId: string;
  readonly plannedCalls: readonly ModelCommercialEstimateCallV1[];
  readonly projectId: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly requestedAt: string;
  readonly requestedMaximumInputUnits: number;
  readonly requestedMaximumOutputUnits: number;
  readonly requestedRoute: ModelCommercialRouteKindV1;
  readonly requestId: string;
  readonly reservationId: string;
  readonly templateId: string | null;
  readonly templateVersion: string | null;
  readonly userId: string;
  readonly includeTechnicalUnitDetail: boolean;
  readonly environment: ModelCommercialEnvironmentV1;
}

export interface ModelCommercialInvocationAttemptV1 {
  readonly attemptId: string;
  readonly attemptKind: ModelCommercialAttemptKindV1;
  readonly attemptNumber: number;
  readonly callId: string;
  readonly completedAt: string;
  readonly failureCategory: string | null;
  readonly invocationId: string;
  readonly latencyMilliseconds: number;
  readonly mayHaveBeenProcessed: boolean;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly inferenceProfileId: string | null;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly providerKey: string;
  readonly providerRequestId: string | null;
  readonly retryOfAttemptId: string | null;
  readonly routeId: string;
  readonly startedAt: string;
  readonly status:
    | "succeeded"
    | "provider-failure"
    | "timed-out"
    | "cancelled"
    | "internal-failure";
  readonly usage: ModelUsageUnitsV1 | null;
  readonly usageRecordId: string;
}

export interface ModelCommercialInvocationResultV1 {
  readonly attempts: readonly ModelCommercialInvocationAttemptV1[];
  readonly completedAt: string;
  readonly failureCategory: string | null;
  readonly preDispatchNoUsageAttestation?: ModelCommercialPreDispatchNoUsageAttestationV1;
  readonly resultId: string;
  readonly status:
    | "completed"
    | "provider-failure"
    | "timeout"
    | "cancelled"
    | "internal-failure";
  readonly usefulOutputDelivered: boolean;
}

export interface PricedModelCommercialAttemptV1 extends ModelCommercialInvocationAttemptV1 {
  readonly estimatedProviderCostMicros: number;
  readonly normalizationPolicyVersionId: string;
  readonly pricingVersionId: string;
  readonly usage: ModelUsageUnitsV1;
}

export type ModelUsageReconciliationStateV1 =
  | "not-required"
  | "pending-missing-usage"
  | "pending-settlement"
  | "reconciled";

export type ModelCommercialCompensationStatusV1 =
  "not-required" | "pending" | "applied" | "failed";

export type CanonicalModelUsageEventStatusV1 =
  | "reserved"
  | "completed"
  | "released"
  | "provider-failure"
  | "cancelled"
  | "internal-failure"
  | "reconciliation-required"
  | "compensated";

export interface CanonicalModelUsageEventV1 {
  readonly attempts: readonly PricedModelCommercialAttemptV1[];
  readonly cacheReadUnits: number;
  readonly cacheWriteUnits: number;
  readonly chargedCreditUnits: number;
  readonly compensatedCreditUnits: number;
  readonly completedAt: string | null;
  readonly environment: ModelCommercialEnvironmentV1;
  readonly estimatedProviderCostMicros: number;
  readonly eventId: string;
  readonly failureCategory: string | null;
  readonly feature: string;
  readonly idempotencyKey: string;
  readonly inferenceProfileId: string | null;
  readonly inputUnits: number;
  readonly jobId: string;
  readonly latencyMilliseconds: number;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly multiCallWorkflowId: string;
  readonly normalizationPolicyVersionId: string;
  readonly occurredAt: string;
  readonly organizationId: string;
  readonly outputUnits: number;
  readonly pricingVersionId: string;
  readonly projectId: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly providerKey: string;
  readonly providerSpecificUnits: ModelUsageUnitsV1["providerSpecificUnits"];
  readonly reconciliationState: ModelUsageReconciliationStateV1;
  readonly requestId: string;
  readonly reservationId: string;
  readonly reservedCreditUnits: number;
  readonly route: ModelCommercialRouteKindV1;
  readonly routeId: string;
  readonly startedAt: string | null;
  readonly status: CanonicalModelUsageEventStatusV1;
  readonly templateId: string | null;
  readonly templateVersion: string | null;
  readonly totalUnits: number;
  readonly userId: string;
  readonly version: typeof MODEL_COMMERCIAL_LIFECYCLE_VERSION;
}

export interface ModelCommercialCreditEstimateV1 {
  readonly maximumCreditUnits: number;
  readonly minimumCreditUnits: number;
  readonly requiresConfirmation: boolean;
}

export interface ModelCommercialReservationResultV1 {
  readonly accepted: boolean;
  readonly denialReason: ModelCommercialDenialReasonV1 | null;
  readonly replayed: boolean;
  readonly reservationId: string;
}

export interface ModelCommercialCapacityReservationV1 {
  readonly featureRequests: ModelCommercialLimitSnapshotV1;
  readonly organizationConcurrentReservations: ModelCommercialLimitSnapshotV1;
  readonly perUserRequests: ModelCommercialLimitSnapshotV1;
}

export interface ModelCommercialReservationIntentV1 {
  readonly authority: "canonical-commercial-reservation-intent-v1";
  readonly capacityDigest: string;
  readonly eventDigest: string;
  readonly expiresAt: string;
  readonly intentId: string;
  readonly recordedAt: string;
  readonly requestedCreditUnits: number;
  readonly reservationId: string;
}

export type ModelCommercialReservationAccountingStatusV1 =
  "active" | "denied" | "expired" | "released" | "settled";

export interface ModelCommercialReservationReceiptV1 {
  readonly accountingStatus: ModelCommercialReservationAccountingStatusV1;
  readonly authority: "canonical-commercial-reservation-receipt-v1";
  readonly intentId: string;
  readonly receivedAt: string;
  readonly receiptId: string;
  readonly result: ModelCommercialReservationResultV1;
}

export type ModelCommercialReservationRecoveryResultV1 =
  | {
      readonly accountingStatus: ModelCommercialReservationAccountingStatusV1;
      readonly kind: "found";
      readonly result: ModelCommercialReservationResultV1;
    }
  | { readonly kind: "not-found" };

export interface ModelCommercialAccountingPort {
  /** Atomically acquires credit and bounded request/concurrency capacity. */
  reserve(input: {
    readonly capacity: ModelCommercialCapacityReservationV1;
    readonly event: CanonicalModelUsageEventV1;
    readonly expiresAt: string;
    readonly intent: ModelCommercialReservationIntentV1;
    readonly requestedCreditUnits: number;
  }): Promise<ModelCommercialReservationResultV1>;
  /** Read/replay only: this method must never create a reservation. */
  recoverExistingReservation(input: {
    readonly capacity: ModelCommercialCapacityReservationV1;
    readonly event: CanonicalModelUsageEventV1;
    readonly expiresAt: string;
    readonly intent: ModelCommercialReservationIntentV1;
    readonly requestedCreditUnits: number;
  }): Promise<ModelCommercialReservationRecoveryResultV1>;
  settle(input: {
    readonly actualCreditUnits: number;
    readonly chargedCreditUnits: number;
    readonly event: CanonicalModelUsageEventV1;
  }): Promise<{ readonly replayed: boolean }>;
  release(input: {
    readonly event: CanonicalModelUsageEventV1;
  }): Promise<{ readonly replayed: boolean }>;
  markReconciliationRequired(input: {
    readonly event: CanonicalModelUsageEventV1;
  }): Promise<{ readonly replayed: boolean }>;
}

export interface ModelCommercialAuthorizationPort {
  resolve(
    request: ModelCommercialOperationRequestV1,
  ): Promise<ModelCommercialAuthorizationDecisionV1>;
}

export interface ModelCommercialVerifiedScopeV1 {
  readonly authority: "verified-principal-scope-v1";
  readonly organizationId: string;
  readonly projectId: string;
  readonly tenantScopeDigest: string;
  readonly userId: string;
}

export interface ModelCommercialScopeResolverV1 {
  resolve(input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly userId: string;
  }): Promise<ModelCommercialVerifiedScopeV1>;
}

export function digestModelCommercialVerifiedScopeV1(input: {
  readonly organizationId: string;
  readonly projectId: string;
  readonly userId: string;
}): string {
  return digestStructuredValue({
    authority: "verified-principal-scope-v1",
    organizationId: input.organizationId,
    projectId: input.projectId,
    userId: input.userId,
  });
}

export interface ModelCommercialPricingPort {
  listCreditNormalizationPolicies(): Promise<
    readonly CreditNormalizationPolicyVersionV1[]
  >;
  listProviderPricingVersions(): Promise<
    readonly ModelProviderPricingVersionV1[]
  >;
}

export interface ModelCommercialPricingRoutePinV1 {
  readonly normalizationPolicy: CreditNormalizationPolicyVersionV1;
  readonly normalizationPolicyDigest: string;
  readonly pricingVersion: ModelProviderPricingVersionV1;
  readonly pricingVersionDigest: string;
  readonly routeId: string;
}

export interface ModelCommercialPricingAuthorityV1 {
  readonly authorityDigest: string;
  readonly capturedAt: string;
  readonly normalizationPolicyCatalogDigest: string;
  readonly pricingCatalogDigest: string;
  readonly routePins: readonly ModelCommercialPricingRoutePinV1[];
}

export interface ModelCommercialWorkflowExecutionLeaseV1 {
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly fencingToken: string;
  readonly leaseId: string;
}

export type ModelCommercialWorkflowStateV1 =
  | "claimed"
  | "reserved"
  | "invoked"
  | "settlement-pending"
  | "reconciliation-required"
  | "terminal";

export interface ModelCommercialResolvedContextV1 {
  readonly authorization: ModelCommercialAuthorizationDecisionV1;
  readonly estimateResult: {
    readonly estimate: ModelCommercialCreditEstimateV1;
    readonly maximumEstimatedProviderCostMicros: number;
    readonly normalizationPolicyVersionId: string;
    readonly primaryPricingVersionId: string;
    readonly pricingAuthority: ModelCommercialPricingAuthorityV1;
  };
  readonly reservationOccurredAt: string;
  readonly selectedRoute: ModelCommercialRouteV1;
}

export interface ModelCommercialWorkflowRecordV1 {
  readonly dispatchIntent: ModelCommercialDispatchIntentV1 | null;
  readonly fingerprint: string;
  readonly invocationReceipt: ModelCommercialHostInvocationReceiptV1 | null;
  readonly invocationResult: ModelCommercialInvocationResultV1 | null;
  readonly request: ModelCommercialOperationRequestV1;
  readonly reservationIntent: ModelCommercialReservationIntentV1 | null;
  readonly reservationReceipt: ModelCommercialReservationReceiptV1 | null;
  readonly revision: number;
  readonly resolvedContext: ModelCommercialResolvedContextV1 | null;
  readonly response: ModelCommercialLifecycleResponseV1 | null;
  readonly state: ModelCommercialWorkflowStateV1;
}

export interface ModelCommercialWorkflowStore {
  claimExecution(input: {
    readonly fingerprint: string;
    readonly leaseExpiresAt: string;
    readonly recoveryOnly: boolean;
    readonly request: ModelCommercialOperationRequestV1;
    readonly tenantScopeDigest: string;
    readonly trustedNow: string;
  }): Promise<
    | {
        readonly kind: "acquired";
        readonly lease: ModelCommercialWorkflowExecutionLeaseV1;
        readonly record: ModelCommercialWorkflowRecordV1;
      }
    | { readonly kind: "conflict" }
    | { readonly kind: "in-progress" }
    | { readonly kind: "missing" }
    | {
        readonly kind: "terminal";
        readonly response: ModelCommercialLifecycleResponseV1;
      }
  >;
  compareAndSet(input: {
    readonly expectedRevision: number;
    readonly lease: ModelCommercialWorkflowExecutionLeaseV1;
    readonly record: ModelCommercialWorkflowRecordV1;
    readonly tenantScopeDigest: string;
    readonly trustedNow: string;
  }): Promise<ModelCommercialWorkflowRecordV1>;
  releaseExecution(input: {
    readonly lease: ModelCommercialWorkflowExecutionLeaseV1;
    readonly multiCallWorkflowId: string;
    readonly tenantScopeDigest: string;
  }): Promise<void>;
}

export interface ModelCommercialInvocationContextV1 {
  readonly acceptedMaximumCreditUnits: number;
  readonly acceptedMaximumEstimatedProviderCostMicros: number;
  readonly dispatchIntentId: string;
  readonly multiCallWorkflowId: string;
  readonly normalizationPolicyCatalogDigest: string;
  readonly normalizationPolicyVersionReference: string;
  readonly pricingAuthorityDigest: string;
  readonly pricingCatalogDigest: string;
  readonly pricingVersionReference: string;
  readonly reservationId: string;
  readonly route: ModelCommercialRouteV1;
}

export type ModelCommercialLifecycleStateV1 =
  | "denied"
  | "estimate-confirmation-required"
  | "reservation-denied"
  | "completed"
  | "released"
  | "compensated"
  | "settlement-pending"
  | "reconciliation-required";

export interface ModelCommercialTechnicalUnitDetailV1 {
  readonly cacheReadUnits: number;
  readonly cacheWriteUnits: number;
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly providerSpecificUnits: ModelUsageUnitsV1["providerSpecificUnits"];
  readonly totalUnits: number;
}

export interface ModelCommercialLifecycleResponseV1 {
  readonly compensationStatus: ModelCommercialCompensationStatusV1;
  readonly completedCreditUnits: number | null;
  readonly denialReason: ModelCommercialDenialReasonV1 | null;
  readonly estimate: ModelCommercialCreditEstimateV1 | null;
  readonly reconciliationState: ModelUsageReconciliationStateV1;
  readonly reservationAccepted: boolean;
  readonly reservationId: string | null;
  readonly route: ModelCommercialRouteKindV1 | null;
  readonly routeExplanation: string | null;
  readonly routeLabel: ModelCommercialRouteV1["label"] | null;
  readonly state: ModelCommercialLifecycleStateV1;
  readonly technicalUnits: ModelCommercialTechnicalUnitDetailV1 | null;
  readonly version: typeof MODEL_COMMERCIAL_LIFECYCLE_VERSION;
}

export type ModelCommercialInvokeCallback = (
  context: ModelCommercialInvocationContextV1,
) => Promise<ModelCommercialInvocationResultV1>;

export type ModelCommercialLifecycleErrorCode =
  | "dependency-failure"
  | "idempotency-conflict"
  | "invalid-input"
  | "policy-violation";

export class ModelCommercialLifecycleError extends Error {
  public readonly code: ModelCommercialLifecycleErrorCode;

  public constructor(code: ModelCommercialLifecycleErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ModelCommercialLifecycleError";
  }
}

function fail(code: ModelCommercialLifecycleErrorCode, message: string): never {
  throw new ModelCommercialLifecycleError(code, message);
}

function assertSafeNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("invalid-input", label + " must be a nonnegative safe integer.");
  }
}

function checkedAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    fail("invalid-input", label + " exceeds the supported integer range.");
  }
  return result;
}

function parseInstant(value: string, label: string): number {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) {
    fail("invalid-input", label + " must be a canonical UTC timestamp.");
  }
  return instant;
}

function exactCommercialRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).some((key) => typeof key !== "string")
  ) {
    fail("invalid-input", `${label} must be an exact object.`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    requiredKeys.some(
      (key) => !Object.prototype.hasOwnProperty.call(record, key),
    ) ||
    keys.some((key) => !allowed.has(key))
  ) {
    fail("invalid-input", `${label} contains missing or unknown fields.`);
  }
  return record;
}

function commercialString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    fail("invalid-input", `${label}.${key} must be a string.`);
  }
  return value;
}

function commercialNullableString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string | null {
  const value = record[key];
  if (value !== null && typeof value !== "string") {
    fail("invalid-input", `${label}.${key} must be a string or null.`);
  }
  return value;
}

function commercialBoolean(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    fail("invalid-input", `${label}.${key} must be a boolean.`);
  }
  return value;
}

function commercialNumber(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== "number") {
    fail("invalid-input", `${label}.${key} must be a number.`);
  }
  return value;
}

function commercialArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    fail("invalid-input", `${label}.${key} must be an array.`);
  }
  return value;
}

function commercialEnum<T extends string>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  values: readonly T[],
  label: string,
): T {
  const value = commercialString(record, key, label);
  const selected = values.find((candidate) => candidate === value);
  if (selected === undefined) {
    fail("invalid-input", `${label}.${key} is not allow-listed.`);
  }
  return selected;
}

function assertCommercialProjectionSafe(value: unknown, label: string): void {
  if (inspectModelValueForSecretCandidatesV1(value).detectedValueCount > 0) {
    fail("invalid-input", `${label} contains a secret candidate.`);
  }
}

function projectCommercialVerifiedScope(
  value: unknown,
): ModelCommercialVerifiedScopeV1 {
  const record = exactCommercialRecord(
    value,
    ["authority", "organizationId", "projectId", "tenantScopeDigest", "userId"],
    [],
    "verifiedCommercialScope",
  );
  if (record["authority"] !== "verified-principal-scope-v1") {
    fail("policy-violation", "The verified commercial scope is invalid.");
  }
  const projected = {
    authority: "verified-principal-scope-v1" as const,
    organizationId: commercialString(
      record,
      "organizationId",
      "verifiedCommercialScope",
    ),
    projectId: commercialString(record, "projectId", "verifiedCommercialScope"),
    tenantScopeDigest: commercialString(
      record,
      "tenantScopeDigest",
      "verifiedCommercialScope",
    ),
    userId: commercialString(record, "userId", "verifiedCommercialScope"),
  } satisfies ModelCommercialVerifiedScopeV1;
  if (
    projected.tenantScopeDigest !==
    digestModelCommercialVerifiedScopeV1(projected)
  ) {
    fail("policy-violation", "The verified commercial scope is stale.");
  }
  assertCommercialProjectionSafe(projected, "verifiedCommercialScope");
  return projected;
}

function projectProviderSpecificUsageUnit(
  value: unknown,
): ModelUsageUnitsV1["providerSpecificUnits"][number] {
  const record = exactCommercialRecord(
    value,
    ["unitName", "units"],
    [],
    "providerSpecificUnit",
  );
  const unitName = commercialString(record, "unitName", "providerSpecificUnit");
  const units = commercialNumber(record, "units", "providerSpecificUnit");
  assertOpaqueCommercialId(unitName, "providerSpecificUnit.unitName");
  assertSafeNonnegativeInteger(units, "providerSpecificUnit.units");
  return { unitName, units };
}

function projectCommercialUsage(
  value: unknown,
  label: string,
): ModelUsageUnitsV1 {
  const record = exactCommercialRecord(
    value,
    [
      "cacheReadUnits",
      "cacheWriteUnits",
      "inputUnits",
      "outputUnits",
      "providerSpecificUnits",
      "totalUnits",
    ],
    [],
    label,
  );
  const cacheReadUnits = commercialNumber(record, "cacheReadUnits", label);
  const cacheWriteUnits = commercialNumber(record, "cacheWriteUnits", label);
  const inputUnits = commercialNumber(record, "inputUnits", label);
  const outputUnits = commercialNumber(record, "outputUnits", label);
  const totalUnits = commercialNumber(record, "totalUnits", label);
  for (const [key, units] of [
    ["cacheReadUnits", cacheReadUnits],
    ["cacheWriteUnits", cacheWriteUnits],
    ["inputUnits", inputUnits],
    ["outputUnits", outputUnits],
    ["totalUnits", totalUnits],
  ] as const) {
    assertSafeNonnegativeInteger(units, `${label}.${key}`);
  }
  const providerSpecificUnits = commercialArray(
    record,
    "providerSpecificUnits",
    label,
  ).map(projectProviderSpecificUsageUnit);
  if (
    new Set(providerSpecificUnits.map((unit) => unit.unitName)).size !==
    providerSpecificUnits.length
  ) {
    fail(
      "invalid-input",
      `${label}.providerSpecificUnits contains duplicates.`,
    );
  }
  if (
    totalUnits !==
    cacheReadUnits + cacheWriteUnits + inputUnits + outputUnits
  ) {
    fail("invalid-input", `${label}.totalUnits is inconsistent.`);
  }
  const projected = {
    cacheReadUnits,
    cacheWriteUnits,
    inputUnits,
    outputUnits,
    providerSpecificUnits,
    totalUnits,
  } satisfies ModelUsageUnitsV1;
  assertCommercialProjectionSafe(projected, label);
  return projected;
}

function projectEstimateCall(value: unknown): ModelCommercialEstimateCallV1 {
  const record = exactCommercialRecord(
    value,
    ["kind", "maximumUsage", "minimumUsage", "routeId"],
    [],
    "plannedCall",
  );
  const projected = {
    kind: commercialEnum(
      record,
      "kind",
      ["primary", "automatic-retry", "system-escalation", "repair"],
      "plannedCall",
    ),
    maximumUsage: projectCommercialUsage(
      record["maximumUsage"],
      "plannedCall.maximumUsage",
    ),
    minimumUsage: projectCommercialUsage(
      record["minimumUsage"],
      "plannedCall.minimumUsage",
    ),
    routeId: commercialString(record, "routeId", "plannedCall"),
  } satisfies ModelCommercialEstimateCallV1;
  assertOpaqueCommercialId(projected.routeId, "plannedCall.routeId");
  return projected;
}

function projectCommercialOperationRequest(
  value: unknown,
): ModelCommercialOperationRequestV1 {
  const record = exactCommercialRecord(
    value,
    [
      "confirmationRequired",
      "environment",
      "estimateAccepted",
      "eventIdPrefix",
      "expiresAt",
      "feature",
      "idempotencyKey",
      "includeTechnicalUnitDetail",
      "jobId",
      "multiCallWorkflowId",
      "organizationId",
      "plannedCalls",
      "projectId",
      "promptId",
      "promptVersion",
      "requestedAt",
      "requestedMaximumInputUnits",
      "requestedMaximumOutputUnits",
      "requestedRoute",
      "requestId",
      "reservationId",
      "templateId",
      "templateVersion",
      "userId",
    ],
    [],
    "commercialRequest",
  );
  const projected = {
    confirmationRequired: commercialBoolean(
      record,
      "confirmationRequired",
      "commercialRequest",
    ),
    environment: commercialEnum(
      record,
      "environment",
      ["development", "test", "staging", "production"],
      "commercialRequest",
    ),
    estimateAccepted: commercialBoolean(
      record,
      "estimateAccepted",
      "commercialRequest",
    ),
    eventIdPrefix: commercialString(
      record,
      "eventIdPrefix",
      "commercialRequest",
    ),
    expiresAt: commercialString(record, "expiresAt", "commercialRequest"),
    feature: commercialString(record, "feature", "commercialRequest"),
    idempotencyKey: commercialString(
      record,
      "idempotencyKey",
      "commercialRequest",
    ),
    includeTechnicalUnitDetail: commercialBoolean(
      record,
      "includeTechnicalUnitDetail",
      "commercialRequest",
    ),
    jobId: commercialString(record, "jobId", "commercialRequest"),
    multiCallWorkflowId: commercialString(
      record,
      "multiCallWorkflowId",
      "commercialRequest",
    ),
    organizationId: commercialString(
      record,
      "organizationId",
      "commercialRequest",
    ),
    plannedCalls: commercialArray(
      record,
      "plannedCalls",
      "commercialRequest",
    ).map(projectEstimateCall),
    projectId: commercialString(record, "projectId", "commercialRequest"),
    promptId: commercialString(record, "promptId", "commercialRequest"),
    promptVersion: commercialString(
      record,
      "promptVersion",
      "commercialRequest",
    ),
    requestedAt: commercialString(record, "requestedAt", "commercialRequest"),
    requestedMaximumInputUnits: commercialNumber(
      record,
      "requestedMaximumInputUnits",
      "commercialRequest",
    ),
    requestedMaximumOutputUnits: commercialNumber(
      record,
      "requestedMaximumOutputUnits",
      "commercialRequest",
    ),
    requestedRoute: commercialEnum(
      record,
      "requestedRoute",
      ["standard", "deep"],
      "commercialRequest",
    ),
    requestId: commercialString(record, "requestId", "commercialRequest"),
    reservationId: commercialString(
      record,
      "reservationId",
      "commercialRequest",
    ),
    templateId: commercialNullableString(
      record,
      "templateId",
      "commercialRequest",
    ),
    templateVersion: commercialNullableString(
      record,
      "templateVersion",
      "commercialRequest",
    ),
    userId: commercialString(record, "userId", "commercialRequest"),
  } satisfies ModelCommercialOperationRequestV1;
  assertSafeNonnegativeInteger(
    projected.requestedMaximumInputUnits,
    "commercialRequest.requestedMaximumInputUnits",
  );
  assertSafeNonnegativeInteger(
    projected.requestedMaximumOutputUnits,
    "commercialRequest.requestedMaximumOutputUnits",
  );
  parseInstant(projected.requestedAt, "commercialRequest.requestedAt");
  parseInstant(projected.expiresAt, "commercialRequest.expiresAt");
  assertCommercialProjectionSafe(projected, "commercialRequest");
  return projected;
}

function projectPreDispatchAttestation(
  value: unknown,
): ModelCommercialPreDispatchNoUsageAttestationV1 {
  const record = exactCommercialRecord(
    value,
    [
      "attestationId",
      "authority",
      "dispatchIntentId",
      "multiCallWorkflowId",
      "noUsageObserved",
      "organizationId",
      "projectId",
      "providerDispatchStarted",
      "reservationId",
      "verifierId",
      "verifierVersion",
    ],
    [],
    "preDispatchAttestation",
  );
  if (
    record["authority"] !== "host-dispatch-v1" ||
    record["noUsageObserved"] !== true ||
    record["providerDispatchStarted"] !== false
  ) {
    fail("invalid-input", "The pre-dispatch attestation is invalid.");
  }
  const projected = {
    attestationId: commercialString(
      record,
      "attestationId",
      "preDispatchAttestation",
    ),
    authority: "host-dispatch-v1" as const,
    dispatchIntentId: commercialString(
      record,
      "dispatchIntentId",
      "preDispatchAttestation",
    ),
    multiCallWorkflowId: commercialString(
      record,
      "multiCallWorkflowId",
      "preDispatchAttestation",
    ),
    noUsageObserved: true as const,
    organizationId: commercialString(
      record,
      "organizationId",
      "preDispatchAttestation",
    ),
    projectId: commercialString(record, "projectId", "preDispatchAttestation"),
    providerDispatchStarted: false as const,
    reservationId: commercialString(
      record,
      "reservationId",
      "preDispatchAttestation",
    ),
    verifierId: commercialString(
      record,
      "verifierId",
      "preDispatchAttestation",
    ),
    verifierVersion: commercialString(
      record,
      "verifierVersion",
      "preDispatchAttestation",
    ),
  } satisfies ModelCommercialPreDispatchNoUsageAttestationV1;
  assertCommercialProjectionSafe(projected, "preDispatchAttestation");
  return projected;
}

/** Strict content-free attempt shape only; the coordinator validates workflow bounds. */
export function parseModelCommercialInvocationAttemptV1(
  value: unknown,
): ModelCommercialInvocationAttemptV1 {
  const record = exactCommercialRecord(
    value,
    [
      "attemptId",
      "attemptKind",
      "attemptNumber",
      "callId",
      "completedAt",
      "failureCategory",
      "inferenceProfileId",
      "invocationId",
      "latencyMilliseconds",
      "mayHaveBeenProcessed",
      "modelId",
      "modelVersion",
      "promptId",
      "promptVersion",
      "providerKey",
      "providerRequestId",
      "retryOfAttemptId",
      "routeId",
      "startedAt",
      "status",
      "usage",
      "usageRecordId",
    ],
    [],
    "invocationAttempt",
  );
  const usageValue = record["usage"];
  const projected = {
    attemptId: commercialString(record, "attemptId", "invocationAttempt"),
    attemptKind: commercialEnum(
      record,
      "attemptKind",
      ["primary", "automatic-retry", "system-escalation", "repair"],
      "invocationAttempt",
    ),
    attemptNumber: commercialNumber(
      record,
      "attemptNumber",
      "invocationAttempt",
    ),
    callId: commercialString(record, "callId", "invocationAttempt"),
    completedAt: commercialString(record, "completedAt", "invocationAttempt"),
    failureCategory: commercialNullableString(
      record,
      "failureCategory",
      "invocationAttempt",
    ),
    inferenceProfileId: commercialNullableString(
      record,
      "inferenceProfileId",
      "invocationAttempt",
    ),
    invocationId: commercialString(record, "invocationId", "invocationAttempt"),
    latencyMilliseconds: commercialNumber(
      record,
      "latencyMilliseconds",
      "invocationAttempt",
    ),
    mayHaveBeenProcessed: commercialBoolean(
      record,
      "mayHaveBeenProcessed",
      "invocationAttempt",
    ),
    modelId: commercialString(record, "modelId", "invocationAttempt"),
    modelVersion: commercialString(record, "modelVersion", "invocationAttempt"),
    promptId: commercialString(record, "promptId", "invocationAttempt"),
    promptVersion: commercialString(
      record,
      "promptVersion",
      "invocationAttempt",
    ),
    providerKey: commercialString(record, "providerKey", "invocationAttempt"),
    providerRequestId: commercialNullableString(
      record,
      "providerRequestId",
      "invocationAttempt",
    ),
    retryOfAttemptId: commercialNullableString(
      record,
      "retryOfAttemptId",
      "invocationAttempt",
    ),
    routeId: commercialString(record, "routeId", "invocationAttempt"),
    startedAt: commercialString(record, "startedAt", "invocationAttempt"),
    status: commercialEnum(
      record,
      "status",
      [
        "succeeded",
        "provider-failure",
        "timed-out",
        "cancelled",
        "internal-failure",
      ],
      "invocationAttempt",
    ),
    usage:
      usageValue === null
        ? null
        : projectCommercialUsage(usageValue, "invocationAttempt.usage"),
    usageRecordId: commercialString(
      record,
      "usageRecordId",
      "invocationAttempt",
    ),
  } satisfies ModelCommercialInvocationAttemptV1;
  assertSafeNonnegativeInteger(
    projected.attemptNumber,
    "invocationAttempt.attemptNumber",
  );
  assertSafeNonnegativeInteger(
    projected.latencyMilliseconds,
    "invocationAttempt.latencyMilliseconds",
  );
  assertCommercialProjectionSafe(projected, "invocationAttempt");
  return projected;
}

function projectInvocationResult(
  value: unknown,
): ModelCommercialInvocationResultV1 {
  const record = exactCommercialRecord(
    value,
    [
      "attempts",
      "completedAt",
      "failureCategory",
      "resultId",
      "status",
      "usefulOutputDelivered",
    ],
    ["preDispatchNoUsageAttestation"],
    "invocationResult",
  );
  const attempts = commercialArray(record, "attempts", "invocationResult").map(
    parseModelCommercialInvocationAttemptV1,
  );
  const completedAt = commercialString(
    record,
    "completedAt",
    "invocationResult",
  );
  const failureCategory = commercialNullableString(
    record,
    "failureCategory",
    "invocationResult",
  );
  const resultId = commercialString(record, "resultId", "invocationResult");
  const status = commercialEnum(
    record,
    "status",
    [
      "completed",
      "provider-failure",
      "timeout",
      "cancelled",
      "internal-failure",
    ],
    "invocationResult",
  );
  const usefulOutputDelivered = commercialBoolean(
    record,
    "usefulOutputDelivered",
    "invocationResult",
  );
  const attestationValue = record["preDispatchNoUsageAttestation"];
  const projected =
    attestationValue === undefined
      ? {
          attempts,
          completedAt,
          failureCategory,
          resultId,
          status,
          usefulOutputDelivered,
        }
      : {
          attempts,
          completedAt,
          failureCategory,
          preDispatchNoUsageAttestation:
            projectPreDispatchAttestation(attestationValue),
          resultId,
          status,
          usefulOutputDelivered,
        };
  assertCommercialProjectionSafe(projected, "invocationResult");
  return projected;
}

/** Parsing content-free evidence grants no dispatch or accounting authority. */
export function parseModelCommercialInvocationResultV1(
  value: unknown,
  request: ModelCommercialOperationRequestV1,
): ModelCommercialInvocationResultV1 {
  const result = projectInvocationResult(value);
  assertCandidateInvocationResult(result, request);
  return result;
}

function coordinatorProofDraft(input: {
  readonly dispatchIntentId: string;
  readonly multiCallWorkflowId: string;
  readonly observedAt: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly reservationId: string;
}) {
  return {
    authority: "coordinator-host-clock-v1" as const,
    dispatchIntentId: input.dispatchIntentId,
    multiCallWorkflowId: input.multiCallWorkflowId,
    observedAt: input.observedAt,
    organizationId: input.organizationId,
    projectId: input.projectId,
    reason: "reservation-expired-before-dispatch" as const,
    reservationId: input.reservationId,
  };
}

function makeCoordinatorPreDispatchProof(input: {
  readonly dispatchIntentId: string;
  readonly multiCallWorkflowId: string;
  readonly observedAt: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly reservationId: string;
}): ModelCommercialCoordinatorPreDispatchProofV1 {
  const draft = coordinatorProofDraft(input);
  return {
    authority: draft.authority,
    dispatchIntentId: draft.dispatchIntentId,
    multiCallWorkflowId: draft.multiCallWorkflowId,
    observedAt: draft.observedAt,
    organizationId: draft.organizationId,
    projectId: draft.projectId,
    proofId: `predispatch_proof_${digestStructuredValue(draft).slice(
      "sha256:".length,
      "sha256:".length + 48,
    )}`,
    reason: draft.reason,
    reservationId: draft.reservationId,
  };
}

function projectCoordinatorPreDispatchProof(
  value: unknown,
): ModelCommercialCoordinatorPreDispatchProofV1 {
  const record = exactCommercialRecord(
    value,
    [
      "authority",
      "dispatchIntentId",
      "multiCallWorkflowId",
      "observedAt",
      "organizationId",
      "projectId",
      "proofId",
      "reason",
      "reservationId",
    ],
    [],
    "coordinatorPreDispatchProof",
  );
  if (
    record["authority"] !== "coordinator-host-clock-v1" ||
    record["reason"] !== "reservation-expired-before-dispatch"
  ) {
    fail("invalid-input", "The coordinator pre-dispatch proof is invalid.");
  }
  const draft = coordinatorProofDraft({
    dispatchIntentId: commercialString(
      record,
      "dispatchIntentId",
      "coordinatorPreDispatchProof",
    ),
    multiCallWorkflowId: commercialString(
      record,
      "multiCallWorkflowId",
      "coordinatorPreDispatchProof",
    ),
    observedAt: commercialString(
      record,
      "observedAt",
      "coordinatorPreDispatchProof",
    ),
    organizationId: commercialString(
      record,
      "organizationId",
      "coordinatorPreDispatchProof",
    ),
    projectId: commercialString(
      record,
      "projectId",
      "coordinatorPreDispatchProof",
    ),
    reservationId: commercialString(
      record,
      "reservationId",
      "coordinatorPreDispatchProof",
    ),
  });
  const projected = {
    authority: draft.authority,
    dispatchIntentId: draft.dispatchIntentId,
    multiCallWorkflowId: draft.multiCallWorkflowId,
    observedAt: draft.observedAt,
    organizationId: draft.organizationId,
    projectId: draft.projectId,
    proofId: commercialString(record, "proofId", "coordinatorPreDispatchProof"),
    reason: draft.reason,
    reservationId: draft.reservationId,
  } satisfies ModelCommercialCoordinatorPreDispatchProofV1;
  if (projected.proofId !== makeCoordinatorPreDispatchProof(draft).proofId) {
    fail("invalid-input", "The coordinator pre-dispatch proof is stale.");
  }
  assertCommercialProjectionSafe(projected, "coordinatorPreDispatchProof");
  return projected;
}

function projectHostInvocationReceipt(
  value: unknown,
): ModelCommercialHostInvocationReceiptV1 {
  const record = exactCommercialRecord(
    value,
    [
      "dispatchIntentId",
      "dispatchedAt",
      "preDispatchProof",
      "receiptId",
      "receivedAt",
      "result",
    ],
    [],
    "hostInvocationReceipt",
  );
  const proofValue = record["preDispatchProof"];
  const projected = {
    dispatchIntentId: commercialString(
      record,
      "dispatchIntentId",
      "hostInvocationReceipt",
    ),
    dispatchedAt: commercialString(
      record,
      "dispatchedAt",
      "hostInvocationReceipt",
    ),
    preDispatchProof:
      proofValue === null
        ? null
        : projectCoordinatorPreDispatchProof(proofValue),
    receiptId: commercialString(record, "receiptId", "hostInvocationReceipt"),
    receivedAt: commercialString(record, "receivedAt", "hostInvocationReceipt"),
    result: projectInvocationResult(record["result"]),
  } satisfies ModelCommercialHostInvocationReceiptV1;
  const dispatchedAt = parseInstant(
    projected.dispatchedAt,
    "hostInvocationReceipt.dispatchedAt",
  );
  const receivedAt = parseInstant(
    projected.receivedAt,
    "hostInvocationReceipt.receivedAt",
  );
  const expectedReceiptId = `receipt_${digestStructuredValue({
    dispatchIntentId: projected.dispatchIntentId,
    receivedAt: projected.receivedAt,
    resultId: projected.result.resultId,
  }).slice("sha256:".length, "sha256:".length + 48)}`;
  if (
    receivedAt < dispatchedAt ||
    projected.receiptId !== expectedReceiptId ||
    (projected.preDispatchProof !== null &&
      (projected.preDispatchProof.dispatchIntentId !==
        projected.dispatchIntentId ||
        projected.preDispatchProof.observedAt !== projected.receivedAt ||
        projected.result.attempts.length !== 0 ||
        projected.result.failureCategory !==
          "reservation-expired-before-dispatch" ||
        projected.result.status !== "internal-failure" ||
        projected.result.usefulOutputDelivered))
  ) {
    fail("invalid-input", "The host invocation receipt is invalid.");
  }
  assertCommercialProjectionSafe(projected, "hostInvocationReceipt");
  return projected;
}

function operationFingerprint(
  request: ModelCommercialOperationRequestV1,
): Sha256Digest {
  return digestStructuredValue(request);
}

/** Metadata identity only. No tenant authentication, commercial authorization,
 * reservation or dispatch is implied by projecting a well-formed request. */
export function projectModelCommercialOperationIdentityV1(
  input: ModelCommercialOperationRequestV1,
): { readonly requestId: string; readonly fingerprint: Sha256Digest } {
  const request = projectCommercialOperationRequest(input);
  assertCommercialRequestIdentifiers(request);
  if (
    parseInstant(request.expiresAt, "expiresAt") <=
    parseInstant(request.requestedAt, "requestedAt")
  ) {
    fail("invalid-input", "Reservation expiration must follow the request.");
  }
  return {
    requestId: request.requestId,
    fingerprint: operationFingerprint(request),
  };
}

function routeModelKey(route: ModelCommercialRouteV1): string {
  return [
    route.providerKey,
    route.modelId,
    route.modelVersion,
    route.inferenceProfileId ?? "",
  ].join("|");
}

function denialResponse(
  reason: ModelCommercialDenialReasonV1,
  route: ModelCommercialRouteV1 | null,
  estimate: ModelCommercialCreditEstimateV1 | null,
  state: "denied" | "estimate-confirmation-required" | "reservation-denied",
): ModelCommercialLifecycleResponseV1 {
  return {
    compensationStatus: "not-required",
    completedCreditUnits: null,
    denialReason: reason,
    estimate,
    reconciliationState: "not-required",
    reservationAccepted: false,
    reservationId: null,
    route: route?.route ?? null,
    routeExplanation: route?.explanation ?? null,
    routeLabel: route?.label ?? null,
    state,
    technicalUnits: null,
    version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
  };
}

function validateLimit(
  snapshot: ModelCommercialLimitSnapshotV1,
  denialReason: ModelCommercialDenialReasonV1,
): ModelCommercialDenialReasonV1 | null {
  assertSafeNonnegativeInteger(snapshot.current, "limit.current");
  assertSafeNonnegativeInteger(snapshot.maximum, "limit.maximum");
  return snapshot.current + 1 > snapshot.maximum ? denialReason : null;
}

function selectRoute(
  request: ModelCommercialOperationRequestV1,
  authorization: ModelCommercialAuthorizationDecisionV1,
): ModelCommercialRouteV1 | ModelCommercialDenialReasonV1 {
  const route = authorization.approvedRoutes.find(
    (candidate) => candidate.route === request.requestedRoute,
  );
  if (
    route === undefined ||
    !authorization.allowedRouteIds.includes(route.routeId)
  ) {
    return "route-not-allowed";
  }
  if (!authorization.allowedModelKeys.includes(routeModelKey(route))) {
    return "model-not-allowed";
  }
  return route;
}

function preInvocationDenial(
  request: ModelCommercialOperationRequestV1,
  authorization: ModelCommercialAuthorizationDecisionV1,
): ModelCommercialDenialReasonV1 | null {
  if (!authorization.allowed) {
    return authorization.denialReason ?? "commercial-state-unavailable";
  }
  if (authorization.organizationId !== request.organizationId) {
    return "cross-tenant-denied";
  }
  if (authorization.commercialState !== "active") {
    return "commercial-state-unavailable";
  }
  if (authorization.organizationStatus === "suspended") {
    return "organization-suspended";
  }
  if (!authorization.featureEntitled) {
    return "plan-not-entitled";
  }
  if (request.requestedMaximumInputUnits > authorization.maximumInputUnits) {
    return "maximum-input-exceeded";
  }
  if (request.requestedMaximumOutputUnits > authorization.maximumOutputUnits) {
    return "maximum-output-exceeded";
  }
  return (
    validateLimit(
      authorization.perUserRequests,
      "per-user-request-limit-reached",
    ) ??
    validateLimit(
      authorization.organizationConcurrentReservations,
      "organization-concurrent-reservation-limit-reached",
    ) ??
    validateLimit(authorization.featureRequests, "feature-limit-reached")
  );
}

interface EstimateResult {
  readonly estimate: ModelCommercialCreditEstimateV1;
  readonly maximumEstimatedProviderCostMicros: number;
  readonly normalizationPolicyVersionId: string;
  readonly primaryPricingVersionId: string;
  readonly pricingAuthority: ModelCommercialPricingAuthorityV1;
}

function orderedPricingVersions(
  values: readonly ModelProviderPricingVersionV1[],
): readonly ModelProviderPricingVersionV1[] {
  return [...values].sort((left, right) =>
    left.pricingVersionId.localeCompare(right.pricingVersionId),
  );
}

function orderedNormalizationPolicies(
  values: readonly CreditNormalizationPolicyVersionV1[],
): readonly CreditNormalizationPolicyVersionV1[] {
  return [...values].sort((left, right) =>
    left.normalizationPolicyVersionId.localeCompare(
      right.normalizationPolicyVersionId,
    ),
  );
}

function assertPricingAuthority(
  authority: ModelCommercialPricingAuthorityV1,
): void {
  const withoutDigest = {
    capturedAt: authority.capturedAt,
    normalizationPolicyCatalogDigest:
      authority.normalizationPolicyCatalogDigest,
    pricingCatalogDigest: authority.pricingCatalogDigest,
    routePins: authority.routePins,
  };
  if (
    authority.authorityDigest !== digestStructuredValue(withoutDigest) ||
    new Set(authority.routePins.map((pin) => pin.routeId)).size !==
      authority.routePins.length ||
    authority.routePins.some(
      (pin) =>
        pin.pricingVersionDigest !==
          digestStructuredValue(pin.pricingVersion) ||
        pin.normalizationPolicyDigest !==
          digestStructuredValue(pin.normalizationPolicy),
    )
  ) {
    fail("policy-violation", "The pinned pricing authority is invalid.");
  }
}

async function calculateEstimate(
  request: ModelCommercialOperationRequestV1,
  authorization: ModelCommercialAuthorizationDecisionV1,
  pricingPort: ModelCommercialPricingPort,
  primaryRoute: ModelCommercialRouteV1,
  capturedAt: string,
): Promise<EstimateResult> {
  if (request.plannedCalls.length === 0) {
    fail("invalid-input", "At least one estimated model call is required.");
  }
  parseInstant(capturedAt, "capturedAt");
  const pricingVersions = orderedPricingVersions(
    await pricingPort.listProviderPricingVersions(),
  );
  const policies = orderedNormalizationPolicies(
    await pricingPort.listCreditNormalizationPolicies(),
  );
  let minimumCreditUnits = 0;
  let maximumCreditUnits = 0;
  let maximumEstimatedProviderCostMicros = 0;
  let normalizationPolicyVersionId: string | null = null;
  let primaryPricingVersionId: string | null = null;
  const routePins = new Map<string, ModelCommercialPricingRoutePinV1>();
  for (const call of request.plannedCalls) {
    const route = authorization.approvedRoutes.find(
      (candidate) => candidate.routeId === call.routeId,
    );
    if (
      route === undefined ||
      !authorization.allowedRouteIds.includes(route.routeId) ||
      !authorization.allowedModelKeys.includes(routeModelKey(route))
    ) {
      fail("policy-violation", "An estimated call uses an unapproved route.");
    }
    if (call.kind === "primary" && route.routeId !== primaryRoute.routeId) {
      fail(
        "invalid-input",
        "The primary estimate must use the selected route.",
      );
    }
    const pricing = selectModelProviderPricingVersionV1(pricingVersions, {
      at: capturedAt,
      environment: request.environment,
      inferenceProfileId: route.inferenceProfileId,
      modelId: route.modelId,
      modelVersion: route.modelVersion,
      providerKey: route.providerKey,
    });
    const policy = selectCreditNormalizationPolicyVersionV1(
      policies,
      capturedAt,
      pricing.currencyCode,
    );
    const minimum = normalizeModelProviderCostToCreditsV1(
      calculateModelProviderCostV1(pricing, call.minimumUsage),
      policy,
    );
    const maximumProviderCost = calculateModelProviderCostV1(
      pricing,
      call.maximumUsage,
    );
    const maximum = normalizeModelProviderCostToCreditsV1(
      maximumProviderCost,
      policy,
    );
    minimumCreditUnits = checkedAdd(
      minimumCreditUnits,
      minimum.cloudMarkupCreditUnits,
      "minimumCreditUnits",
    );
    maximumCreditUnits = checkedAdd(
      maximumCreditUnits,
      maximum.cloudMarkupCreditUnits,
      "maximumCreditUnits",
    );
    maximumEstimatedProviderCostMicros = checkedAdd(
      maximumEstimatedProviderCostMicros,
      maximumProviderCost.estimatedProviderCostMicros,
      "maximumEstimatedProviderCostMicros",
    );
    normalizationPolicyVersionId ??= policy.normalizationPolicyVersionId;
    if (normalizationPolicyVersionId !== policy.normalizationPolicyVersionId) {
      fail(
        "policy-violation",
        "One estimate cannot span multiple credit-normalization policies.",
      );
    }
    const pin = {
      normalizationPolicy: structuredClone(policy),
      normalizationPolicyDigest: digestStructuredValue(policy),
      pricingVersion: structuredClone(pricing),
      pricingVersionDigest: digestStructuredValue(pricing),
      routeId: route.routeId,
    } satisfies ModelCommercialPricingRoutePinV1;
    const existingPin = routePins.get(route.routeId);
    if (
      existingPin !== undefined &&
      digestStructuredValue(existingPin) !== digestStructuredValue(pin)
    ) {
      fail("policy-violation", "One route cannot use multiple pricing pins.");
    }
    routePins.set(route.routeId, pin);
    if (route.routeId === primaryRoute.routeId) {
      primaryPricingVersionId ??= pricing.pricingVersionId;
    }
  }
  if (
    maximumCreditUnits <= 0 ||
    minimumCreditUnits > maximumCreditUnits ||
    normalizationPolicyVersionId === null ||
    primaryPricingVersionId === null
  ) {
    fail("invalid-input", "The conservative credit estimate is invalid.");
  }
  const pricingAuthorityWithoutDigest = {
    capturedAt,
    normalizationPolicyCatalogDigest: digestStructuredValue(policies),
    pricingCatalogDigest: digestStructuredValue(pricingVersions),
    routePins: [...routePins.values()].sort((left, right) =>
      left.routeId.localeCompare(right.routeId),
    ),
  };
  const pricingAuthority = {
    ...pricingAuthorityWithoutDigest,
    authorityDigest: digestStructuredValue(pricingAuthorityWithoutDigest),
  } satisfies ModelCommercialPricingAuthorityV1;
  assertPricingAuthority(pricingAuthority);
  return {
    estimate: {
      maximumCreditUnits,
      minimumCreditUnits,
      requiresConfirmation: request.confirmationRequired,
    },
    maximumEstimatedProviderCostMicros,
    normalizationPolicyVersionId,
    primaryPricingVersionId,
    pricingAuthority,
  };
}

function zeroUnits(): ModelCommercialTechnicalUnitDetailV1 {
  return {
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    inputUnits: 0,
    outputUnits: 0,
    providerSpecificUnits: [],
    totalUnits: 0,
  };
}

function makeEvent(input: {
  readonly attempts: readonly PricedModelCommercialAttemptV1[];
  readonly chargedCreditUnits: number;
  readonly compensatedCreditUnits: number;
  readonly completedAt: string | null;
  readonly estimatedProviderCostMicros: number;
  readonly eventSuffix: string;
  readonly failureCategory: string | null;
  readonly normalizationPolicyVersionId: string;
  readonly occurredAt: string;
  readonly pricingVersionId: string;
  readonly reconciliationState: ModelUsageReconciliationStateV1;
  readonly request: ModelCommercialOperationRequestV1;
  readonly reservedCreditUnits: number;
  readonly route: ModelCommercialRouteV1;
  readonly status: CanonicalModelUsageEventStatusV1;
  readonly units: ModelCommercialTechnicalUnitDetailV1;
}): CanonicalModelUsageEventV1 {
  const startedAt =
    input.attempts.length === 0
      ? null
      : input.attempts.reduce(
          (earliest, attempt) =>
            parseInstant(attempt.startedAt, "startedAt") <
            parseInstant(earliest, "startedAt")
              ? attempt.startedAt
              : earliest,
          input.attempts[0]?.startedAt ?? input.occurredAt,
        );
  const latencyMilliseconds = input.attempts.reduce(
    (total, attempt) =>
      checkedAdd(total, attempt.latencyMilliseconds, "latencyMilliseconds"),
    0,
  );
  return {
    attempts: input.attempts,
    cacheReadUnits: input.units.cacheReadUnits,
    cacheWriteUnits: input.units.cacheWriteUnits,
    chargedCreditUnits: input.chargedCreditUnits,
    compensatedCreditUnits: input.compensatedCreditUnits,
    completedAt: input.completedAt,
    environment: input.request.environment,
    estimatedProviderCostMicros: input.estimatedProviderCostMicros,
    eventId: input.request.eventIdPrefix + "_" + input.eventSuffix,
    failureCategory: input.failureCategory,
    feature: input.request.feature,
    idempotencyKey: input.request.idempotencyKey + ":" + input.eventSuffix,
    inferenceProfileId: input.route.inferenceProfileId,
    inputUnits: input.units.inputUnits,
    jobId: input.request.jobId,
    latencyMilliseconds,
    modelId: input.route.modelId,
    modelVersion: input.route.modelVersion,
    multiCallWorkflowId: input.request.multiCallWorkflowId,
    normalizationPolicyVersionId: input.normalizationPolicyVersionId,
    occurredAt: input.occurredAt,
    organizationId: input.request.organizationId,
    outputUnits: input.units.outputUnits,
    pricingVersionId: input.pricingVersionId,
    projectId: input.request.projectId,
    promptId: input.request.promptId,
    promptVersion: input.request.promptVersion,
    providerKey: input.route.providerKey,
    providerSpecificUnits: input.units.providerSpecificUnits,
    reconciliationState: input.reconciliationState,
    requestId: input.request.requestId,
    reservationId: input.request.reservationId,
    reservedCreditUnits: input.reservedCreditUnits,
    route: input.route.route,
    routeId: input.route.routeId,
    startedAt,
    status: input.status,
    templateId: input.request.templateId,
    templateVersion: input.request.templateVersion,
    totalUnits: input.units.totalUnits,
    userId: input.request.userId,
    version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
  };
}

function reservationIntentDraft(input: {
  readonly capacity: ModelCommercialCapacityReservationV1;
  readonly event: CanonicalModelUsageEventV1;
  readonly expiresAt: string;
  readonly recordedAt: string;
  readonly requestedCreditUnits: number;
}) {
  return {
    authority: "canonical-commercial-reservation-intent-v1" as const,
    capacityDigest: digestStructuredValue(input.capacity),
    eventDigest: digestStructuredValue(input.event),
    expiresAt: input.expiresAt,
    recordedAt: input.recordedAt,
    requestedCreditUnits: input.requestedCreditUnits,
    reservationId: input.event.reservationId,
  };
}

function makeReservationIntent(input: {
  readonly capacity: ModelCommercialCapacityReservationV1;
  readonly event: CanonicalModelUsageEventV1;
  readonly expiresAt: string;
  readonly recordedAt: string;
  readonly requestedCreditUnits: number;
}): ModelCommercialReservationIntentV1 {
  const draft = reservationIntentDraft(input);
  return {
    ...draft,
    intentId: `commercial_reservation_intent_${digestStructuredValue(
      draft,
    ).slice("sha256:".length, "sha256:".length + 48)}`,
  };
}

function projectReservationIntent(
  value: unknown,
): ModelCommercialReservationIntentV1 {
  const record = exactCommercialRecord(
    value,
    [
      "authority",
      "capacityDigest",
      "eventDigest",
      "expiresAt",
      "intentId",
      "recordedAt",
      "requestedCreditUnits",
      "reservationId",
    ],
    [],
    "commercialReservationIntent",
  );
  if (record["authority"] !== "canonical-commercial-reservation-intent-v1") {
    fail(
      "idempotency-conflict",
      "The reservation intent authority is invalid.",
    );
  }
  const projected = {
    authority: "canonical-commercial-reservation-intent-v1" as const,
    capacityDigest: commercialString(
      record,
      "capacityDigest",
      "commercialReservationIntent",
    ),
    eventDigest: commercialString(
      record,
      "eventDigest",
      "commercialReservationIntent",
    ),
    expiresAt: commercialString(
      record,
      "expiresAt",
      "commercialReservationIntent",
    ),
    intentId: commercialString(
      record,
      "intentId",
      "commercialReservationIntent",
    ),
    recordedAt: commercialString(
      record,
      "recordedAt",
      "commercialReservationIntent",
    ),
    requestedCreditUnits: commercialNumber(
      record,
      "requestedCreditUnits",
      "commercialReservationIntent",
    ),
    reservationId: commercialString(
      record,
      "reservationId",
      "commercialReservationIntent",
    ),
  } satisfies ModelCommercialReservationIntentV1;
  parseInstant(projected.expiresAt, "commercialReservationIntent.expiresAt");
  parseInstant(projected.recordedAt, "commercialReservationIntent.recordedAt");
  assertSafeNonnegativeInteger(
    projected.requestedCreditUnits,
    "commercialReservationIntent.requestedCreditUnits",
  );
  assertOpaqueCommercialId(
    projected.intentId,
    "commercialReservationIntent.intentId",
  );
  assertOpaqueCommercialId(
    projected.reservationId,
    "commercialReservationIntent.reservationId",
  );
  const draft = {
    authority: projected.authority,
    capacityDigest: projected.capacityDigest,
    eventDigest: projected.eventDigest,
    expiresAt: projected.expiresAt,
    recordedAt: projected.recordedAt,
    requestedCreditUnits: projected.requestedCreditUnits,
    reservationId: projected.reservationId,
  };
  if (
    projected.intentId !==
    `commercial_reservation_intent_${digestStructuredValue(draft).slice(
      "sha256:".length,
      "sha256:".length + 48,
    )}`
  ) {
    fail("idempotency-conflict", "The reservation intent digest is stale.");
  }
  assertCommercialProjectionSafe(projected, "commercialReservationIntent");
  return projected;
}

function assertReservationIntentMatches(input: {
  readonly capacity: ModelCommercialCapacityReservationV1;
  readonly event: CanonicalModelUsageEventV1;
  readonly expiresAt: string;
  readonly intent: ModelCommercialReservationIntentV1;
  readonly requestedCreditUnits: number;
}): ModelCommercialReservationIntentV1 {
  const intent = projectReservationIntent(input.intent);
  const expected = makeReservationIntent({
    capacity: input.capacity,
    event: input.event,
    expiresAt: input.expiresAt,
    recordedAt: intent.recordedAt,
    requestedCreditUnits: input.requestedCreditUnits,
  });
  if (digestStructuredValue(intent) !== digestStructuredValue(expected)) {
    fail(
      "idempotency-conflict",
      "The reservation intent does not match this workflow.",
    );
  }
  return intent;
}

/** Pure projection of the coordinator's already-recorded reservation intent.
 * Persistence adapters must authenticate the workflow independently; this
 * function neither authorizes a tenant nor creates a reservation. */
export function projectModelCommercialReservationV1(
  record: ModelCommercialWorkflowRecordV1,
): Parameters<ModelCommercialAccountingPort["reserve"]>[0] {
  const context = record.resolvedContext;
  if (context === null || record.reservationIntent === null) {
    return fail(
      "idempotency-conflict",
      "The workflow has no reservation intent.",
    );
  }
  assertPricingAuthority(context.estimateResult.pricingAuthority);
  const event = makeEvent({
    attempts: [],
    chargedCreditUnits: 0,
    compensatedCreditUnits: 0,
    completedAt: null,
    estimatedProviderCostMicros: 0,
    eventSuffix: "reservation",
    failureCategory: null,
    normalizationPolicyVersionId:
      context.estimateResult.normalizationPolicyVersionId,
    occurredAt: context.reservationOccurredAt,
    pricingVersionId: context.estimateResult.primaryPricingVersionId,
    reconciliationState: "not-required",
    request: record.request,
    reservedCreditUnits: context.estimateResult.estimate.maximumCreditUnits,
    route: context.selectedRoute,
    status: "reserved",
    units: zeroUnits(),
  });
  const capacity = {
    featureRequests: context.authorization.featureRequests,
    organizationConcurrentReservations:
      context.authorization.organizationConcurrentReservations,
    perUserRequests: context.authorization.perUserRequests,
  };
  const projected = {
    capacity,
    event,
    expiresAt: record.request.expiresAt,
    intent: record.reservationIntent,
    requestedCreditUnits: context.estimateResult.estimate.maximumCreditUnits,
  };
  return structuredClone({
    ...projected,
    intent: assertReservationIntentMatches(projected),
  });
}

function projectReservationResult(
  value: unknown,
): ModelCommercialReservationResultV1 {
  const record = exactCommercialRecord(
    value,
    ["accepted", "denialReason", "replayed", "reservationId"],
    [],
    "commercialReservationResult",
  );
  const accepted = commercialBoolean(
    record,
    "accepted",
    "commercialReservationResult",
  );
  const denialValue = record["denialReason"];
  const denialReason =
    denialValue === null
      ? null
      : commercialEnum(
          record,
          "denialReason",
          MODEL_COMMERCIAL_DENIAL_REASONS,
          "commercialReservationResult",
        );
  const projected = {
    accepted,
    denialReason,
    replayed: commercialBoolean(
      record,
      "replayed",
      "commercialReservationResult",
    ),
    reservationId: commercialString(
      record,
      "reservationId",
      "commercialReservationResult",
    ),
  } satisfies ModelCommercialReservationResultV1;
  if (accepted !== (denialReason === null)) {
    fail("invalid-input", "The canonical reservation result is inconsistent.");
  }
  assertOpaqueCommercialId(
    projected.reservationId,
    "commercialReservationResult.reservationId",
  );
  assertCommercialProjectionSafe(projected, "commercialReservationResult");
  return projected;
}

function projectReservationAccountingStatus(
  value: unknown,
): ModelCommercialReservationAccountingStatusV1 {
  const statuses = [
    "active",
    "denied",
    "expired",
    "released",
    "settled",
  ] as const;
  const status = statuses.find((candidate) => candidate === value);
  if (status === undefined) {
    fail("invalid-input", "The canonical reservation status is invalid.");
  }
  return status;
}

function reservationReceiptDraft(input: {
  readonly accountingStatus: ModelCommercialReservationAccountingStatusV1;
  readonly intent: ModelCommercialReservationIntentV1;
  readonly receivedAt: string;
  readonly result: ModelCommercialReservationResultV1;
}) {
  return {
    accountingStatus: input.accountingStatus,
    authority: "canonical-commercial-reservation-receipt-v1" as const,
    intentId: input.intent.intentId,
    receivedAt: input.receivedAt,
    result: projectReservationResult(input.result),
  };
}

function assertReservationAccountingStatusMatchesResult(input: {
  readonly accountingStatus: ModelCommercialReservationAccountingStatusV1;
  readonly result: ModelCommercialReservationResultV1;
}): void {
  if (input.result.accepted === (input.accountingStatus === "denied")) {
    fail(
      "idempotency-conflict",
      "The reservation receipt accounting status is inconsistent.",
    );
  }
}

function makeReservationReceipt(input: {
  readonly accountingStatus: ModelCommercialReservationAccountingStatusV1;
  readonly intent: ModelCommercialReservationIntentV1;
  readonly receivedAt: string;
  readonly result: ModelCommercialReservationResultV1;
}): ModelCommercialReservationReceiptV1 {
  parseInstant(input.receivedAt, "commercial reservation receipt receivedAt");
  const draft = reservationReceiptDraft(input);
  assertReservationAccountingStatusMatchesResult(draft);
  return {
    ...draft,
    receiptId: `commercial_reservation_receipt_${digestStructuredValue(
      draft,
    ).slice("sha256:".length, "sha256:".length + 48)}`,
  };
}

function projectReservationReceipt(
  value: unknown,
): ModelCommercialReservationReceiptV1 {
  const record = exactCommercialRecord(
    value,
    [
      "accountingStatus",
      "authority",
      "intentId",
      "receivedAt",
      "receiptId",
      "result",
    ],
    [],
    "commercialReservationReceipt",
  );
  if (record["authority"] !== "canonical-commercial-reservation-receipt-v1") {
    fail(
      "idempotency-conflict",
      "The reservation receipt authority is invalid.",
    );
  }
  const accountingStatus = commercialEnum(
    record,
    "accountingStatus",
    ["active", "denied", "expired", "released", "settled"] as const,
    "commercialReservationReceipt",
  );
  const intentId = commercialString(
    record,
    "intentId",
    "commercialReservationReceipt",
  );
  const receivedAt = commercialString(
    record,
    "receivedAt",
    "commercialReservationReceipt",
  );
  const receiptId = commercialString(
    record,
    "receiptId",
    "commercialReservationReceipt",
  );
  parseInstant(receivedAt, "commercialReservationReceipt.receivedAt");
  assertOpaqueCommercialId(intentId, "commercialReservationReceipt.intentId");
  assertOpaqueCommercialId(receiptId, "commercialReservationReceipt.receiptId");
  const result = projectReservationResult(record["result"]);
  const draft = {
    accountingStatus,
    authority: "canonical-commercial-reservation-receipt-v1" as const,
    intentId,
    receivedAt,
    result,
  };
  const projected = {
    ...draft,
    receiptId,
  } satisfies ModelCommercialReservationReceiptV1;
  assertReservationAccountingStatusMatchesResult(projected);
  if (
    receiptId !==
    `commercial_reservation_receipt_${digestStructuredValue(draft).slice(
      "sha256:".length,
      "sha256:".length + 48,
    )}`
  ) {
    fail("idempotency-conflict", "The reservation receipt digest is stale.");
  }
  assertCommercialProjectionSafe(projected, "commercialReservationReceipt");
  return projected;
}

function assertReservationReceiptMatches(input: {
  readonly intent: ModelCommercialReservationIntentV1;
  readonly receipt: ModelCommercialReservationReceiptV1;
}): ModelCommercialReservationReceiptV1 {
  const receipt = projectReservationReceipt(input.receipt);
  if (
    receipt.intentId !== input.intent.intentId ||
    receipt.result.reservationId !== input.intent.reservationId
  ) {
    fail(
      "idempotency-conflict",
      "The reservation receipt does not match its intent.",
    );
  }
  return receipt;
}
const OPAQUE_COMMERCIAL_ID =
  /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const CREDENTIAL_SHAPED_COMMERCIAL_ID =
  /(?:^|[._:-])(?:api[-_]?key|credential|password|private[-_]?key|secret|token)(?:$|[._:-])/iu;
const MAX_COMMERCIAL_ATTEMPTS = 32;
const MODEL_COMMERCIAL_EXECUTION_LEASE_MILLISECONDS = 5 * 60 * 1000;

function assertCommercialRequestIdentifiers(
  request: ModelCommercialOperationRequestV1,
): void {
  for (const [label, value] of [
    ["eventIdPrefix", request.eventIdPrefix],
    ["feature", request.feature],
    ["idempotencyKey", request.idempotencyKey],
    ["jobId", request.jobId],
    ["multiCallWorkflowId", request.multiCallWorkflowId],
    ["organizationId", request.organizationId],
    ["projectId", request.projectId],
    ["promptId", request.promptId],
    ["promptVersion", request.promptVersion],
    ["requestId", request.requestId],
    ["reservationId", request.reservationId],
    ["userId", request.userId],
  ] as const) {
    assertOpaqueCommercialId(value, label);
  }
  if (request.templateId !== null) {
    assertOpaqueCommercialId(request.templateId, "templateId");
  }
  if (request.templateVersion !== null) {
    assertOpaqueCommercialId(request.templateVersion, "templateVersion");
  }
  if (
    request.plannedCalls.length === 0 ||
    request.plannedCalls.length > MAX_COMMERCIAL_ATTEMPTS
  ) {
    fail("invalid-input", "The planned call count is invalid.");
  }
  for (const call of request.plannedCalls) {
    assertOpaqueCommercialId(call.routeId, "planned routeId");
  }
}

function assertOpaqueCommercialId(value: string, label: string): void {
  if (
    !OPAQUE_COMMERCIAL_ID.test(value) ||
    CREDENTIAL_SHAPED_COMMERCIAL_ID.test(value) ||
    inspectModelValueForSecretCandidatesV1(value).detectedValueCount > 0
  ) {
    fail("invalid-input", `${label} must be a bounded opaque identifier.`);
  }
}

function isSafeFailureCode(
  value: string | null,
): value is ModelCommercialSafeFailureCodeV1 | null {
  return (
    value === null ||
    MODEL_COMMERCIAL_SAFE_FAILURE_CODES.some((candidate) => candidate === value)
  );
}

function assertCandidateInvocationResult(
  result: ModelCommercialInvocationResultV1,
  request: ModelCommercialOperationRequestV1,
): void {
  assertOpaqueCommercialId(result.resultId, "resultId");
  if (
    result.attempts.length > MAX_COMMERCIAL_ATTEMPTS ||
    result.attempts.length > request.plannedCalls.length ||
    !isSafeFailureCode(result.failureCategory) ||
    (result.status === "completed") !== (result.failureCategory === null) ||
    result.usefulOutputDelivered !== (result.status === "completed")
  ) {
    fail(
      "invalid-input",
      "The invocation result is not a safe closed outcome.",
    );
  }
  const attemptIds = new Set<string>();
  const callIds = new Set<string>();
  const usageRecordIds = new Set<string>();
  const providerRequestIds = new Set<string>();
  result.attempts.forEach((attempt, index) => {
    for (const [label, value] of [
      ["attemptId", attempt.attemptId],
      ["callId", attempt.callId],
      ["invocationId", attempt.invocationId],
      ["usageRecordId", attempt.usageRecordId],
    ] as const) {
      assertOpaqueCommercialId(value, label);
    }
    if (attempt.providerRequestId !== null) {
      assertOpaqueCommercialId(attempt.providerRequestId, "providerRequestId");
    }
    if (attempt.retryOfAttemptId !== null) {
      assertOpaqueCommercialId(attempt.retryOfAttemptId, "retryOfAttemptId");
    }
    const expectedPrevious = result.attempts[index - 1]?.attemptId ?? null;
    const plannedCall = request.plannedCalls[index];
    if (plannedCall === undefined) {
      fail("invalid-input", "Invocation attempt evidence is invalid.");
    }
    if (
      attempt.attemptKind !== plannedCall.kind ||
      attempt.routeId !== plannedCall.routeId ||
      attempt.attemptNumber !== index + 1 ||
      attempt.retryOfAttemptId !== expectedPrevious ||
      attemptIds.has(attempt.attemptId) ||
      callIds.has(attempt.callId) ||
      usageRecordIds.has(attempt.usageRecordId) ||
      (attempt.providerRequestId !== null &&
        providerRequestIds.has(attempt.providerRequestId)) ||
      !isSafeFailureCode(attempt.failureCategory) ||
      (attempt.status === "succeeded") !==
        (attempt.failureCategory === null && attempt.usage !== null) ||
      (attempt.usage !== null && !attempt.mayHaveBeenProcessed)
    ) {
      fail("invalid-input", "Invocation attempt evidence is invalid.");
    }
    attemptIds.add(attempt.attemptId);
    callIds.add(attempt.callId);
    usageRecordIds.add(attempt.usageRecordId);
    if (attempt.providerRequestId !== null) {
      providerRequestIds.add(attempt.providerRequestId);
    }
    if (attempt.usage !== null) {
      const maximum = plannedCall.maximumUsage;
      const usageWithinMaximum =
        attempt.usage.cacheReadUnits <= maximum.cacheReadUnits &&
        attempt.usage.cacheWriteUnits <= maximum.cacheWriteUnits &&
        attempt.usage.inputUnits <= maximum.inputUnits &&
        attempt.usage.outputUnits <= maximum.outputUnits &&
        attempt.usage.totalUnits <= maximum.totalUnits;
      const maximumProviderUnits = new Map(
        maximum.providerSpecificUnits.map((unit) => [
          unit.unitName,
          unit.units,
        ]),
      );
      const providerUsageWithinMaximum =
        attempt.usage.providerSpecificUnits.every(
          (unit) =>
            maximumProviderUnits.has(unit.unitName) &&
            unit.units <= (maximumProviderUnits.get(unit.unitName) ?? -1),
        );
      if (!usageWithinMaximum || !providerUsageWithinMaximum) {
        fail(
          "invalid-input",
          "Invocation usage exceeds its planned call maximum.",
        );
      }
    }
  });
  if (
    result.usefulOutputDelivered &&
    !result.attempts.some(
      (attempt) => attempt.status === "succeeded" && attempt.usage !== null,
    )
  ) {
    fail("invalid-input", "Useful output requires successful usage evidence.");
  }
}

function canonicalHostTimedAttempt(input: {
  readonly attempt: ModelCommercialInvocationAttemptV1;
  readonly completedAt: string;
  readonly latencyMilliseconds: number;
  readonly startedAt: string;
}): ModelCommercialInvocationAttemptV1 {
  const attempt = input.attempt;
  return {
    attemptId: attempt.attemptId,
    attemptKind: attempt.attemptKind,
    attemptNumber: attempt.attemptNumber,
    callId: attempt.callId,
    completedAt: input.completedAt,
    failureCategory: attempt.failureCategory,
    inferenceProfileId: attempt.inferenceProfileId,
    invocationId: attempt.invocationId,
    latencyMilliseconds: input.latencyMilliseconds,
    mayHaveBeenProcessed: attempt.mayHaveBeenProcessed,
    modelId: attempt.modelId,
    modelVersion: attempt.modelVersion,
    promptId: attempt.promptId,
    promptVersion: attempt.promptVersion,
    providerKey: attempt.providerKey,
    providerRequestId: attempt.providerRequestId,
    retryOfAttemptId: attempt.retryOfAttemptId,
    routeId: attempt.routeId,
    startedAt: input.startedAt,
    status: attempt.status,
    usage: attempt.usage,
    usageRecordId: attempt.usageRecordId,
  };
}

function hostCanonicalReceipt(input: {
  readonly candidate: unknown;
  readonly dispatchIntent: ModelCommercialDispatchIntentV1;
  readonly receivedAt: string;
  readonly request: ModelCommercialOperationRequestV1;
}): ModelCommercialHostInvocationReceiptV1 {
  const candidate = projectInvocationResult(input.candidate);
  assertCandidateInvocationResult(candidate, input.request);
  const dispatchedAt = input.dispatchIntent.recordedAt;
  const receivedAtMillis = parseInstant(input.receivedAt, "receivedAt");
  const dispatchedAtMillis = parseInstant(dispatchedAt, "dispatchedAt");
  if (receivedAtMillis < dispatchedAtMillis) {
    fail("invalid-input", "A host receipt cannot precede dispatch intent.");
  }
  const hostLatency = receivedAtMillis - dispatchedAtMillis;
  const attempts = candidate.attempts.map((attempt, index) =>
    canonicalHostTimedAttempt({
      attempt,
      completedAt: input.receivedAt,
      latencyMilliseconds: index === 0 ? hostLatency : 0,
      startedAt: dispatchedAt,
    }),
  );
  const result =
    candidate.preDispatchNoUsageAttestation === undefined
      ? {
          attempts,
          completedAt: input.receivedAt,
          failureCategory: candidate.failureCategory,
          resultId: candidate.resultId,
          status: candidate.status,
          usefulOutputDelivered: candidate.usefulOutputDelivered,
        }
      : {
          attempts,
          completedAt: input.receivedAt,
          failureCategory: candidate.failureCategory,
          preDispatchNoUsageAttestation:
            candidate.preDispatchNoUsageAttestation,
          resultId: candidate.resultId,
          status: candidate.status,
          usefulOutputDelivered: candidate.usefulOutputDelivered,
        };
  const receiptId = `receipt_${digestStructuredValue({
    dispatchIntentId: input.dispatchIntent.dispatchIntentId,
    receivedAt: input.receivedAt,
    resultId: result.resultId,
  }).slice("sha256:".length, "sha256:".length + 48)}`;
  return projectHostInvocationReceipt({
    dispatchIntentId: input.dispatchIntent.dispatchIntentId,
    dispatchedAt,
    preDispatchProof: null,
    receiptId,
    receivedAt: input.receivedAt,
    result,
  });
}

function fixedUncertainReceipt(input: {
  readonly dispatchIntent: ModelCommercialDispatchIntentV1;
  readonly failureCode: "callback-outcome-unknown" | "unsafe-provider-receipt";
  readonly receivedAt: string;
  readonly request: ModelCommercialOperationRequestV1;
}): ModelCommercialHostInvocationReceiptV1 {
  const resultId = `result_${digestStructuredValue({
    dispatchIntentId: input.dispatchIntent.dispatchIntentId,
    failureCode: input.failureCode,
    multiCallWorkflowId: input.request.multiCallWorkflowId,
  }).slice("sha256:".length, "sha256:".length + 48)}`;
  return hostCanonicalReceipt({
    candidate: {
      attempts: [],
      completedAt: input.receivedAt,
      failureCategory: input.failureCode,
      resultId,
      status: "internal-failure",
      usefulOutputDelivered: false,
    },
    dispatchIntent: input.dispatchIntent,
    receivedAt: input.receivedAt,
    request: input.request,
  });
}

function fixedHostPreDispatchReceipt(input: {
  readonly dispatchIntent: ModelCommercialDispatchIntentV1;
  readonly receivedAt: string;
  readonly request: ModelCommercialOperationRequestV1;
}): ModelCommercialHostInvocationReceiptV1 {
  const failureCode = "reservation-expired-before-dispatch" as const;
  const resultId = `result_${digestStructuredValue({
    dispatchIntentId: input.dispatchIntent.dispatchIntentId,
    failureCode,
    reservationId: input.request.reservationId,
  }).slice("sha256:".length, "sha256:".length + 48)}`;
  const receipt = hostCanonicalReceipt({
    candidate: {
      attempts: [],
      completedAt: input.receivedAt,
      failureCategory: failureCode,
      resultId,
      status: "internal-failure",
      usefulOutputDelivered: false,
    },
    dispatchIntent: input.dispatchIntent,
    receivedAt: input.receivedAt,
    request: input.request,
  });
  return projectHostInvocationReceipt({
    dispatchIntentId: receipt.dispatchIntentId,
    dispatchedAt: receipt.dispatchedAt,
    preDispatchProof: makeCoordinatorPreDispatchProof({
      dispatchIntentId: input.dispatchIntent.dispatchIntentId,
      multiCallWorkflowId: input.request.multiCallWorkflowId,
      observedAt: input.receivedAt,
      organizationId: input.request.organizationId,
      projectId: input.request.projectId,
      reservationId: input.request.reservationId,
    }),
    receiptId: receipt.receiptId,
    receivedAt: receipt.receivedAt,
    result: receipt.result,
  });
}
function exactCommercialLiteral(value: unknown, expected: string): boolean {
  return typeof value === "string" && value === expected;
}

function coordinatorPreDispatchProofMatches(input: {
  readonly dispatchIntent: ModelCommercialDispatchIntentV1;
  readonly proof: ModelCommercialCoordinatorPreDispatchProofV1;
  readonly receipt: ModelCommercialHostInvocationReceiptV1;
  readonly request: ModelCommercialOperationRequestV1;
}): boolean {
  return (
    exactCommercialLiteral(
      input.proof.authority,
      "coordinator-host-clock-v1",
    ) &&
    exactCommercialLiteral(
      input.proof.reason,
      "reservation-expired-before-dispatch",
    ) &&
    input.proof.dispatchIntentId === input.dispatchIntent.dispatchIntentId &&
    input.proof.dispatchIntentId === input.receipt.dispatchIntentId &&
    input.proof.observedAt === input.receipt.receivedAt &&
    input.proof.multiCallWorkflowId === input.request.multiCallWorkflowId &&
    input.proof.organizationId === input.request.organizationId &&
    input.proof.projectId === input.request.projectId &&
    input.proof.reservationId === input.request.reservationId &&
    input.receipt.result.attempts.length === 0 &&
    input.receipt.result.failureCategory ===
      "reservation-expired-before-dispatch" &&
    input.receipt.result.status === "internal-failure" &&
    !input.receipt.result.usefulOutputDelivered
  );
}
interface PricedInvocationResult {
  readonly actualCreditUnits: number;
  readonly attempts: readonly PricedModelCommercialAttemptV1[];
  readonly estimatedProviderCostMicros: number;
  readonly normalizationPolicyVersionId: string;
  readonly primaryPricingVersionId: string;
  readonly units: ModelCommercialTechnicalUnitDetailV1;
}

function priceInvocation(
  request: ModelCommercialOperationRequestV1,
  authorization: ModelCommercialAuthorizationDecisionV1,
  receipt: ModelCommercialHostInvocationReceiptV1,
  primaryRoute: ModelCommercialRouteV1,
  pricingAuthority: ModelCommercialPricingAuthorityV1,
  preDispatchNoUsageVerified: boolean,
  maximumEstimatedProviderCostMicros: number,
): PricedInvocationResult | null {
  assertPricingAuthority(pricingAuthority);
  const result = receipt.result;
  if (result.attempts.length === 0 && !preDispatchNoUsageVerified) {
    return null;
  }
  const pricedAttempts: PricedModelCommercialAttemptV1[] = [];
  let actualCreditUnits = 0;
  let estimatedProviderCostMicros = 0;
  let normalizationPolicyVersionId: string | null = null;
  let primaryPricingVersionId: string | null = null;
  const providerSpecificUnits = new Map<string, number>();
  let cacheReadUnits = 0;
  let cacheWriteUnits = 0;
  let inputUnits = 0;
  let outputUnits = 0;
  for (const attempt of result.attempts) {
    const route = authorization.approvedRoutes.find(
      (candidate) => candidate.routeId === attempt.routeId,
    );
    const pin = pricingAuthority.routePins.find(
      (candidate) => candidate.routeId === attempt.routeId,
    );
    if (
      route === undefined ||
      pin === undefined ||
      !authorization.allowedRouteIds.includes(route.routeId) ||
      !authorization.allowedModelKeys.includes(routeModelKey(route)) ||
      route.providerKey !== attempt.providerKey ||
      route.modelId !== attempt.modelId ||
      route.modelVersion !== attempt.modelVersion ||
      route.inferenceProfileId !== attempt.inferenceProfileId ||
      attempt.promptId !== request.promptId ||
      attempt.promptVersion !== request.promptVersion ||
      pin.pricingVersion.providerKey !== route.providerKey ||
      pin.pricingVersion.modelId !== route.modelId ||
      pin.pricingVersion.modelVersion !== route.modelVersion ||
      pin.pricingVersion.inferenceProfileId !== route.inferenceProfileId ||
      pin.pricingVersion.environment !== request.environment ||
      pin.normalizationPolicy.currencyCode !== pin.pricingVersion.currencyCode
    ) {
      fail(
        "policy-violation",
        "Attempt evidence does not match its pinned route and pricing authority.",
      );
    }
    if (attempt.usage === null) {
      return null;
    }
    const normalized = normalizeModelProviderCostToCreditsV1(
      calculateModelProviderCostV1(pin.pricingVersion, attempt.usage),
      pin.normalizationPolicy,
    );
    actualCreditUnits = checkedAdd(
      actualCreditUnits,
      normalized.cloudMarkupCreditUnits,
      "actualCreditUnits",
    );
    estimatedProviderCostMicros = checkedAdd(
      estimatedProviderCostMicros,
      normalized.estimatedProviderCostMicros,
      "estimatedProviderCostMicros",
    );
    normalizationPolicyVersionId ??=
      pin.normalizationPolicy.normalizationPolicyVersionId;
    if (
      normalizationPolicyVersionId !==
      pin.normalizationPolicy.normalizationPolicyVersionId
    ) {
      fail(
        "policy-violation",
        "One workflow cannot settle across normalization pins.",
      );
    }
    if (route.routeId === primaryRoute.routeId) {
      primaryPricingVersionId ??= pin.pricingVersion.pricingVersionId;
    }
    cacheReadUnits = checkedAdd(
      cacheReadUnits,
      attempt.usage.cacheReadUnits,
      "cacheReadUnits",
    );
    cacheWriteUnits = checkedAdd(
      cacheWriteUnits,
      attempt.usage.cacheWriteUnits,
      "cacheWriteUnits",
    );
    inputUnits = checkedAdd(inputUnits, attempt.usage.inputUnits, "inputUnits");
    outputUnits = checkedAdd(
      outputUnits,
      attempt.usage.outputUnits,
      "outputUnits",
    );
    for (const unit of attempt.usage.providerSpecificUnits) {
      providerSpecificUnits.set(
        unit.unitName,
        checkedAdd(
          providerSpecificUnits.get(unit.unitName) ?? 0,
          unit.units,
          "providerSpecificUnits." + unit.unitName,
        ),
      );
    }
    if (estimatedProviderCostMicros > maximumEstimatedProviderCostMicros) {
      fail(
        "policy-violation",
        "Invocation cost exceeds its accepted pinned maximum.",
      );
    }
    pricedAttempts.push({
      attemptId: attempt.attemptId,
      attemptKind: attempt.attemptKind,
      attemptNumber: attempt.attemptNumber,
      callId: attempt.callId,
      completedAt: attempt.completedAt,
      estimatedProviderCostMicros: normalized.estimatedProviderCostMicros,
      failureCategory: attempt.failureCategory,
      inferenceProfileId: attempt.inferenceProfileId,
      invocationId: attempt.invocationId,
      latencyMilliseconds: attempt.latencyMilliseconds,
      mayHaveBeenProcessed: attempt.mayHaveBeenProcessed,
      modelId: attempt.modelId,
      modelVersion: attempt.modelVersion,
      normalizationPolicyVersionId:
        pin.normalizationPolicy.normalizationPolicyVersionId,
      pricingVersionId: pin.pricingVersion.pricingVersionId,
      promptId: attempt.promptId,
      promptVersion: attempt.promptVersion,
      providerKey: attempt.providerKey,
      providerRequestId: attempt.providerRequestId,
      retryOfAttemptId: attempt.retryOfAttemptId,
      routeId: attempt.routeId,
      startedAt: attempt.startedAt,
      status: attempt.status,
      usage: attempt.usage,
      usageRecordId: attempt.usageRecordId,
    });
  }
  if (
    result.usefulOutputDelivered &&
    (pricedAttempts.length === 0 ||
      normalizationPolicyVersionId === null ||
      primaryPricingVersionId === null)
  ) {
    return null;
  }
  const totalUnits = [
    cacheReadUnits,
    cacheWriteUnits,
    inputUnits,
    outputUnits,
  ].reduce((total, units) => checkedAdd(total, units, "totalUnits"), 0);
  const primaryPin = pricingAuthority.routePins.find(
    (pin) => pin.routeId === primaryRoute.routeId,
  );
  if (primaryPin === undefined) {
    fail("policy-violation", "The primary pricing pin is missing.");
  }
  return {
    actualCreditUnits,
    attempts: pricedAttempts,
    estimatedProviderCostMicros,
    normalizationPolicyVersionId:
      normalizationPolicyVersionId ??
      primaryPin.normalizationPolicy.normalizationPolicyVersionId,
    primaryPricingVersionId:
      primaryPricingVersionId ?? primaryPin.pricingVersion.pricingVersionId,
    units: {
      cacheReadUnits,
      cacheWriteUnits,
      inputUnits,
      outputUnits,
      providerSpecificUnits: [...providerSpecificUnits.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([unitName, units]) => ({ unitName, units })),
      totalUnits,
    },
  };
}

function completedResponse(input: {
  readonly compensationStatus: ModelCommercialCompensationStatusV1;
  readonly completedCreditUnits: number | null;
  readonly estimate: ModelCommercialCreditEstimateV1;
  readonly reconciliationState: ModelUsageReconciliationStateV1;
  readonly request: ModelCommercialOperationRequestV1;
  readonly route: ModelCommercialRouteV1;
  readonly state: Exclude<
    ModelCommercialLifecycleStateV1,
    "denied" | "estimate-confirmation-required" | "reservation-denied"
  >;
  readonly units: ModelCommercialTechnicalUnitDetailV1 | null;
}): ModelCommercialLifecycleResponseV1 {
  return {
    compensationStatus: input.compensationStatus,
    completedCreditUnits: input.completedCreditUnits,
    denialReason: null,
    estimate: input.estimate,
    reconciliationState: input.reconciliationState,
    reservationAccepted: true,
    reservationId: input.request.reservationId,
    route: input.route.route,
    routeExplanation: input.route.explanation,
    routeLabel: input.route.label,
    state: input.state,
    technicalUnits: input.request.includeTechnicalUnitDetail
      ? input.units
      : null,
    version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
  };
}

/** Project a pending review from an independently authenticated active
 * reservation. The completed output must be authenticated by the host. This
 * pure projection grants no authority and records no charge or usage. */
export function projectModelCommercialPendingReviewV2(
  record: ModelCommercialWorkflowRecordV1,
): ModelCommercialLifecycleResponseV1 {
  const context = record.resolvedContext;
  if (
    context === null ||
    record.state !== "reserved" ||
    record.dispatchIntent === null ||
    record.invocationReceipt !== null ||
    record.invocationResult !== null ||
    record.response !== null ||
    record.reservationReceipt === null ||
    record.fingerprint !== digestStructuredValue(record.request)
  ) {
    return fail(
      "policy-violation",
      "The pending review has no active reservation.",
    );
  }
  const reservation = projectModelCommercialReservationV1(record);
  const receipt = assertReservationReceiptMatches({
    intent: reservation.intent,
    receipt: record.reservationReceipt,
  });
  if (!receipt.result.accepted || receipt.accountingStatus !== "active") {
    return fail(
      "policy-violation",
      "The pending review has no active reservation.",
    );
  }
  assertOpaqueCommercialId(
    record.dispatchIntent.dispatchIntentId,
    "pendingReview.dispatchIntentId",
  );
  parseInstant(record.dispatchIntent.recordedAt, "pendingReview.recordedAt");
  return structuredClone(
    completedResponse({
      compensationStatus: "not-required",
      completedCreditUnits: null,
      estimate: context.estimateResult.estimate,
      reconciliationState: "pending-settlement",
      request: record.request,
      route: context.selectedRoute,
      state: "settlement-pending",
      units: null,
    }),
  );
}

/** A deterministic projection, never independent authorization or usage proof. */
export interface ModelCommercialTerminalOutcomeV1 {
  readonly actualCreditUnits: number;
  readonly event: CanonicalModelUsageEventV1;
  readonly kind: "settlement" | "release" | "reconciliation-required";
  readonly response: ModelCommercialLifecycleResponseV1;
}

/** Metadata projection for an independently verified host recovery result.
 * Does not mutate or replace the original immutable workflow receipt. */
export function projectModelCommercialRecoveredInvocationRecordV1(
  record: ModelCommercialWorkflowRecordV1,
  result: ModelCommercialInvocationResultV1,
  receivedAt: string,
): ModelCommercialWorkflowRecordV1 {
  if (
    record.dispatchIntent === null ||
    record.reservationReceipt?.result.accepted !== true
  )
    return fail(
      "policy-violation",
      "Recovery requires an existing canonical dispatch.",
    );
  const receipt = hostCanonicalReceipt({
    candidate: parseModelCommercialInvocationResultV1(result, record.request),
    dispatchIntent: record.dispatchIntent,
    receivedAt,
    request: record.request,
  });
  return structuredClone({
    ...record,
    invocationReceipt: receipt,
    invocationResult: receipt.result,
    state: "invoked",
    response: null,
  });
}

/** Reproduce the coordinator outcome using authenticated recorded evidence and
 * immutable reservation pins. The caller independently verifies any no-dispatch
 * proof; this pure helper grants no tenant, dispatch, or accounting authority. */
export function projectModelCommercialTerminalOutcomeV1(
  record: ModelCommercialWorkflowRecordV1,
  preDispatchNoUsageVerified = false,
): ModelCommercialTerminalOutcomeV1 {
  const context = record.resolvedContext;
  const receipt = record.invocationReceipt;
  if (
    context === null ||
    receipt === null ||
    record.dispatchIntent === null ||
    record.reservationReceipt?.result.accepted !== true ||
    record.dispatchIntent.dispatchIntentId !== receipt.dispatchIntentId
  ) {
    return fail(
      "policy-violation",
      "Terminal accounting evidence is incomplete.",
    );
  }
  const request = record.request;
  const parsedReceipt = projectHostInvocationReceipt(receipt);
  assertCandidateInvocationResult(parsedReceipt.result, request);
  const { authorization, estimateResult, selectedRoute } = context;
  const priced = priceInvocation(
    request,
    authorization,
    parsedReceipt,
    selectedRoute,
    estimateResult.pricingAuthority,
    preDispatchNoUsageVerified,
    estimateResult.maximumEstimatedProviderCostMicros,
  );
  const result = parsedReceipt.result;
  const delivered = priced !== null && result.usefulOutputDelivered;
  const charged = delivered
    ? Math.min(
        priced.actualCreditUnits,
        estimateResult.estimate.maximumCreditUnits,
      )
    : 0;
  const compensated = priced === null ? 0 : priced.actualCreditUnits - charged;
  const kind =
    priced === null
      ? "reconciliation-required"
      : delivered
        ? "settlement"
        : "release";
  const status: CanonicalModelUsageEventStatusV1 =
    priced === null
      ? "reconciliation-required"
      : delivered
        ? compensated > 0
          ? "compensated"
          : "completed"
        : result.status === "provider-failure" || result.status === "timeout"
          ? "provider-failure"
          : result.status === "cancelled"
            ? "cancelled"
            : "internal-failure";
  const event = makeEvent({
    attempts: priced?.attempts ?? [],
    chargedCreditUnits: charged,
    compensatedCreditUnits: compensated,
    completedAt: parsedReceipt.receivedAt,
    estimatedProviderCostMicros: priced?.estimatedProviderCostMicros ?? 0,
    eventSuffix:
      kind === "reconciliation-required" ? "reconciliation_required" : kind,
    failureCategory:
      priced === null
        ? (result.failureCategory ?? "missing-provider-usage")
        : delivered
          ? compensated > 0
            ? "estimate-overrun"
            : null
          : result.failureCategory,
    normalizationPolicyVersionId:
      priced?.normalizationPolicyVersionId ??
      estimateResult.normalizationPolicyVersionId,
    occurredAt: parsedReceipt.receivedAt,
    pricingVersionId:
      priced?.primaryPricingVersionId ?? estimateResult.primaryPricingVersionId,
    reconciliationState:
      priced === null ? "pending-missing-usage" : "not-required",
    request,
    reservedCreditUnits: estimateResult.estimate.maximumCreditUnits,
    route: selectedRoute,
    status,
    units: priced?.units ?? zeroUnits(),
  });
  return structuredClone({
    actualCreditUnits: priced?.actualCreditUnits ?? 0,
    event,
    kind,
    response: completedResponse({
      compensationStatus:
        priced === null
          ? "pending"
          : compensated > 0
            ? "applied"
            : "not-required",
      completedCreditUnits: priced === null ? null : charged,
      estimate: estimateResult.estimate,
      reconciliationState:
        priced === null ? "pending-missing-usage" : "not-required",
      request,
      route: selectedRoute,
      state:
        priced === null
          ? "reconciliation-required"
          : delivered
            ? compensated > 0
              ? "compensated"
              : "completed"
            : compensated > 0
              ? "compensated"
              : "released",
      units: priced?.units ?? null,
    }),
  });
}

export interface ModelCommercialCoordinatorDependenciesV1 {
  readonly accounting: ModelCommercialAccountingPort;
  readonly attestations: ModelCommercialHostAttestationPortV1;
  readonly authorization: ModelCommercialAuthorizationPort;
  readonly now: () => string;
  readonly pricing: ModelCommercialPricingPort;
  readonly scopeResolver: ModelCommercialScopeResolverV1;
  readonly workflows: ModelCommercialWorkflowStore;
  readonly invocationRecovery?: ModelCommercialInvocationRecoveryPortV1;
  readonly terminalRecovery?: ModelCommercialTerminalRecoveryPortV1;
}
interface LiveCoordinatorRecovery {
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly admissionRequest: ModelLiveRuntimeAdmissionRequestV2;
  readonly invocationRecovery: ModelLiveCommercialInvocationRecoveryPortV2;
  readonly terminalRecovery: ModelLiveCommercialTerminalRecoveryPortV2;
}
/** Shared canonical algorithm; only explicit public wrappers select recovery authority. */
class ModelCommercialLifecycleEngine {
  readonly #liveRecovery: LiveCoordinatorRecovery | undefined;
  readonly #accounting: ModelCommercialAccountingPort;
  readonly #attestations: ModelCommercialHostAttestationPortV1;
  readonly #authorization: ModelCommercialAuthorizationPort;
  readonly #now: () => string;
  readonly #pricing: ModelCommercialPricingPort;
  readonly #scopeResolver: ModelCommercialScopeResolverV1;
  readonly #workflows: ModelCommercialWorkflowStore;
  readonly #invocationRecovery:
    ModelCommercialInvocationRecoveryPortV1 | undefined;
  readonly #terminalRecovery: ModelCommercialTerminalRecoveryPortV1 | undefined;

  public constructor(input: {
    readonly dependencies: ModelCommercialCoordinatorDependenciesV1;
    readonly liveRecovery?: LiveCoordinatorRecovery;
  }) {
    const { dependencies } = input;
    this.#liveRecovery = input.liveRecovery;
    this.#accounting = dependencies.accounting;
    this.#attestations = dependencies.attestations;
    this.#authorization = dependencies.authorization;
    this.#now = dependencies.now;
    this.#pricing = dependencies.pricing;
    this.#scopeResolver = dependencies.scopeResolver;
    this.#workflows = dependencies.workflows;
    this.#invocationRecovery = dependencies.invocationRecovery;
    this.#terminalRecovery = dependencies.terminalRecovery;
  }

  #trustedNow(): string {
    const value = this.#now();
    parseInstant(value, "trusted host time");
    return value;
  }

  #leaseExpiresAt(acquiredAt: string): string {
    return new Date(
      parseInstant(acquiredAt, "commercial lease acquiredAt") +
        MODEL_COMMERCIAL_EXECUTION_LEASE_MILLISECONDS,
    ).toISOString();
  }

  #assertUnexpired(request: ModelCommercialOperationRequestV1): string {
    const now = this.#trustedNow();
    if (
      parseInstant(now, "trusted host time") >=
      parseInstant(request.expiresAt, "expiresAt")
    ) {
      fail("invalid-input", "The commercial request has expired.");
    }
    return now;
  }

  async #recoverInvocationReceipt(
    dispatchIntent: ModelCommercialDispatchIntentV1,
    request: ModelCommercialOperationRequestV1,
  ): Promise<ModelCommercialHostInvocationReceiptV1 | null> {
    const live = this.#liveRecovery;
    if (live !== undefined) {
      const recovered = await live.invocationRecovery.recoverVerified({
        dispatchIntent,
        request,
        admissionRequest: live.admissionRequest,
      });
      if (recovered.kind !== "verified") {
        const metadata = exactCommercialRecord(
          recovered,
          ["kind"],
          [],
          "live invocation recovery",
        );
        if (metadata["kind"] === "pending")
          fail(
            "dependency-failure",
            "Live evaluation validation is not terminal.",
          );
        if (metadata["kind"] !== "unavailable")
          fail("policy-violation", "Live invocation recovery is unavailable.");
        return null;
      }
      const verified = parseModelLiveCommercialInvocationEvidenceV2(
        recovered,
        request,
        dispatchIntent,
        live.admissionRequest,
      );
      return hostCanonicalReceipt({
        candidate: verified.result,
        dispatchIntent,
        receivedAt: this.#trustedNow(),
        request,
      });
    }
    const recovered = await this.#invocationRecovery?.recoverVerified({
      dispatchIntent,
      request,
    });
    if (recovered?.kind === "pending") {
      fail("dependency-failure", "Preview delivery evidence is not terminal.");
    }
    if (recovered?.kind !== "verified") return null;
    const evidence = exactCommercialRecord(
      recovered,
      ["kind", "authority", "dispatchIntentId", "requestDigest", "result"],
      [],
      "preview recovery",
    );
    if (
      evidence["authority"] !== "intent-preview-delivery-v1" ||
      recovered.dispatchIntentId !== dispatchIntent.dispatchIntentId ||
      recovered.requestDigest !== digestStructuredValue(request)
    ) {
      fail(
        "policy-violation",
        "Preview recovery evidence is not bound to this dispatch.",
      );
    }
    return hostCanonicalReceipt({
      candidate: parseModelCommercialInvocationResultV1(
        recovered.result,
        request,
      ),
      dispatchIntent,
      receivedAt: this.#trustedNow(),
      request,
    });
  }

  async #verifyPreDispatchAttestation(input: {
    readonly attestation: ModelCommercialPreDispatchNoUsageAttestationV1;
    readonly dispatchIntent: ModelCommercialDispatchIntentV1;
    readonly request: ModelCommercialOperationRequestV1;
  }): Promise<boolean> {
    try {
      for (const [label, value] of [
        ["attestationId", input.attestation.attestationId],
        ["dispatchIntentId", input.attestation.dispatchIntentId],
        ["verifierId", input.attestation.verifierId],
        ["verifierVersion", input.attestation.verifierVersion],
      ] as const) {
        assertOpaqueCommercialId(value, label);
      }
      const rawAttestation = input.attestation as unknown as Readonly<
        Record<string, unknown>
      >;
      if (
        rawAttestation["authority"] !== "host-dispatch-v1" ||
        input.attestation.dispatchIntentId !==
          input.dispatchIntent.dispatchIntentId ||
        input.attestation.multiCallWorkflowId !==
          input.request.multiCallWorkflowId ||
        input.attestation.organizationId !== input.request.organizationId ||
        input.attestation.projectId !== input.request.projectId ||
        input.attestation.reservationId !== input.request.reservationId ||
        rawAttestation["noUsageObserved"] !== true ||
        rawAttestation["providerDispatchStarted"] !== false
      ) {
        return false;
      }
      return await this.#attestations.verifyPreDispatchNoUsage({
        attestation: input.attestation,
        expected: {
          dispatchIntentId: input.dispatchIntent.dispatchIntentId,
          multiCallWorkflowId: input.request.multiCallWorkflowId,
          organizationId: input.request.organizationId,
          projectId: input.request.projectId,
          reservationId: input.request.reservationId,
        },
      });
    } catch {
      return false;
    }
  }

  async #executeInternal(
    request: ModelCommercialOperationRequestV1,
    invoke: ModelCommercialInvokeCallback | null,
    mode: "dispatch-authorized" | "recovery-only",
  ): Promise<ModelCommercialLifecycleResponseV1> {
    request = projectCommercialOperationRequest(request);
    assertCommercialRequestIdentifiers(request);
    parseInstant(request.requestedAt, "requestedAt");
    if (
      parseInstant(request.expiresAt, "expiresAt") <=
      parseInstant(request.requestedAt, "requestedAt")
    ) {
      fail("invalid-input", "Reservation expiration must follow the request.");
    }
    const verifiedScope = projectCommercialVerifiedScope(
      await this.#scopeResolver.resolve({
        organizationId: request.organizationId,
        projectId: request.projectId,
        userId: request.userId,
      }),
    );
    if (
      verifiedScope.organizationId !== request.organizationId ||
      verifiedScope.projectId !== request.projectId ||
      verifiedScope.userId !== request.userId
    ) {
      fail("policy-violation", "The commercial request scope is not verified.");
    }
    const fingerprint = operationFingerprint(request);
    const live = this.#liveRecovery;
    if (
      live !== undefined &&
      fingerprint !== operationFingerprint(live.commercialRequest)
    )
      fail(
        "policy-violation",
        "Live commercial execution is bound to one immutable request.",
      );
    if (
      mode === "recovery-only" &&
      (live !== undefined || this.#terminalRecovery !== undefined)
    ) {
      const terminal =
        live === undefined
          ? await this.#terminalRecovery?.recoverVerified({
              request,
              requestDigest: fingerprint,
            })
          : await live.terminalRecovery.recoverVerified({
              request,
              requestDigest: fingerprint,
              admissionRequest: live.admissionRequest,
            });
      if (terminal?.kind === "verified") {
        const checked =
          live === undefined
            ? parseModelCommercialVerifiedTerminalV1(terminal, request)
            : parseModelLiveCommercialVerifiedTerminalV2(
                terminal,
                request,
                live.admissionRequest,
              );
        return checked.outcome.response;
      }
      const unavailable = exactCommercialRecord(
        terminal,
        ["kind"],
        [],
        "terminal recovery",
      );
      if (unavailable["kind"] !== "unavailable")
        fail("policy-violation", "Terminal recovery is unavailable.");
    }
    const claimAt = this.#trustedNow();
    const claim = await this.#workflows.claimExecution({
      fingerprint,
      leaseExpiresAt: this.#leaseExpiresAt(claimAt),
      recoveryOnly: mode === "recovery-only",
      request,
      tenantScopeDigest: verifiedScope.tenantScopeDigest,
      trustedNow: claimAt,
    });
    if (claim.kind === "conflict") {
      fail("idempotency-conflict", "The workflow identity was reused.");
    }
    if (claim.kind === "in-progress") {
      fail("idempotency-conflict", "The workflow is already in progress.");
    }
    if (claim.kind === "terminal") {
      return claim.response;
    }
    if (claim.kind === "missing") {
      return denialResponse(
        "reservation-denied",
        null,
        null,
        "reservation-denied",
      );
    }
    const { lease } = claim;
    let record = claim.record;
    const save = async (
      next: ModelCommercialWorkflowRecordV1,
    ): Promise<void> => {
      record = await this.#workflows.compareAndSet({
        expectedRevision: record.revision,
        lease,
        record: { ...next, revision: record.revision },
        tenantScopeDigest: verifiedScope.tenantScopeDigest,
        trustedNow: this.#trustedNow(),
      });
    };
    const finish = async (
      response: ModelCommercialLifecycleResponseV1,
      state: ModelCommercialWorkflowStateV1,
    ): Promise<ModelCommercialLifecycleResponseV1> => {
      await save({ ...record, response, state });
      return response;
    };

    try {
      const persistedRecovery =
        record.resolvedContext !== null && record.reservationIntent !== null;
      if (!persistedRecovery && mode !== "recovery-only") {
        this.#assertUnexpired(request);
      }
      let resolvedContext = record.resolvedContext;
      if (resolvedContext === null && mode === "recovery-only") {
        return await finish(
          denialResponse(
            "reservation-denied",
            null,
            null,
            "reservation-denied",
          ),
          "terminal",
        );
      }
      if (resolvedContext === null) {
        const authorization = await this.#authorization.resolve(request);
        const initialDenial = preInvocationDenial(request, authorization);
        if (initialDenial !== null) {
          return await finish(
            denialResponse(initialDenial, null, null, "denied"),
            "terminal",
          );
        }
        const selectedRoute = selectRoute(request, authorization);
        if (typeof selectedRoute === "string") {
          return await finish(
            denialResponse(selectedRoute, null, null, "denied"),
            "terminal",
          );
        }
        try {
          const capturedAt = this.#assertUnexpired(request);
          const estimateResult = await calculateEstimate(
            request,
            authorization,
            this.#pricing,
            selectedRoute,
            capturedAt,
          );
          const reservationOccurredAt = this.#assertUnexpired(request);
          resolvedContext = {
            authorization,
            estimateResult,
            reservationOccurredAt,
            selectedRoute,
          };
          await save({ ...record, resolvedContext });
        } catch (error) {
          if (
            error instanceof ModelCommercialLifecycleError &&
            error.code === "invalid-input" &&
            error.message === "The commercial request has expired."
          ) {
            throw error;
          }
          return await finish(
            denialResponse(
              "pricing-unavailable",
              selectedRoute,
              null,
              "denied",
            ),
            "terminal",
          );
        }
      }
      const {
        authorization,
        estimateResult,
        reservationOccurredAt,
        selectedRoute,
      } = resolvedContext;
      assertPricingAuthority(estimateResult.pricingAuthority);
      if (request.confirmationRequired && !request.estimateAccepted) {
        return await finish(
          denialResponse(
            "confirmation-required",
            selectedRoute,
            estimateResult.estimate,
            "estimate-confirmation-required",
          ),
          "terminal",
        );
      }
      if (
        authorization.availableCreditUnits <
        estimateResult.estimate.maximumCreditUnits
      ) {
        return await finish(
          denialResponse(
            "insufficient-credits",
            selectedRoute,
            estimateResult.estimate,
            "denied",
          ),
          "terminal",
        );
      }

      const reservationEvent = makeEvent({
        attempts: [],
        chargedCreditUnits: 0,
        compensatedCreditUnits: 0,
        completedAt: null,
        estimatedProviderCostMicros: 0,
        eventSuffix: "reservation",
        failureCategory: null,
        normalizationPolicyVersionId:
          estimateResult.normalizationPolicyVersionId,
        occurredAt: reservationOccurredAt,
        pricingVersionId: estimateResult.primaryPricingVersionId,
        reconciliationState: "not-required",
        request,
        reservedCreditUnits: estimateResult.estimate.maximumCreditUnits,
        route: selectedRoute,
        status: "reserved",
        units: zeroUnits(),
      });
      const reservationCapacity = {
        featureRequests: authorization.featureRequests,
        organizationConcurrentReservations:
          authorization.organizationConcurrentReservations,
        perUserRequests: authorization.perUserRequests,
      } satisfies ModelCommercialCapacityReservationV1;
      const hadReservationIntent = record.reservationIntent !== null;
      let reservationIntent = record.reservationIntent;
      if (reservationIntent === null) {
        if (mode === "recovery-only") {
          return await finish(
            denialResponse(
              "reservation-denied",
              selectedRoute,
              estimateResult.estimate,
              "reservation-denied",
            ),
            "terminal",
          );
        }
        const intentRecordedAt = this.#assertUnexpired(request);
        reservationIntent = makeReservationIntent({
          capacity: reservationCapacity,
          event: reservationEvent,
          expiresAt: request.expiresAt,
          recordedAt: intentRecordedAt,
          requestedCreditUnits: estimateResult.estimate.maximumCreditUnits,
        });
        await save({ ...record, reservationIntent });
      } else {
        reservationIntent = assertReservationIntentMatches({
          capacity: reservationCapacity,
          event: reservationEvent,
          expiresAt: request.expiresAt,
          intent: reservationIntent,
          requestedCreditUnits: estimateResult.estimate.maximumCreditUnits,
        });
      }

      const hadReservationReceipt = record.reservationReceipt !== null;
      let reservationReceipt = record.reservationReceipt;
      if (reservationReceipt === null) {
        let reservationAccountingStatus: ModelCommercialReservationAccountingStatusV1 | null =
          null;
        let reservationResult: ModelCommercialReservationResultV1 | null = null;
        if (hadReservationIntent) {
          const recovered = await this.#accounting.recoverExistingReservation({
            capacity: reservationCapacity,
            event: reservationEvent,
            expiresAt: request.expiresAt,
            intent: reservationIntent,
            requestedCreditUnits: estimateResult.estimate.maximumCreditUnits,
          });
          if (recovered.kind === "found") {
            reservationAccountingStatus = projectReservationAccountingStatus(
              recovered.accountingStatus,
            );
            reservationResult = projectReservationResult(recovered.result);
            if (!reservationResult.replayed) {
              fail(
                "idempotency-conflict",
                "Reservation recovery did not return a canonical replay.",
              );
            }
          }
        }
        if (reservationResult === null) {
          if (
            mode === "recovery-only" ||
            parseInstant(this.#trustedNow(), "trusted host time") >=
              parseInstant(request.expiresAt, "expiresAt")
          ) {
            return await finish(
              denialResponse(
                "reservation-denied",
                selectedRoute,
                estimateResult.estimate,
                "reservation-denied",
              ),
              "terminal",
            );
          }
          this.#assertUnexpired(request);
          reservationResult = projectReservationResult(
            await this.#accounting.reserve({
              capacity: reservationCapacity,
              event: reservationEvent,
              expiresAt: request.expiresAt,
              intent: reservationIntent,
              requestedCreditUnits: estimateResult.estimate.maximumCreditUnits,
            }),
          );
          reservationAccountingStatus = reservationResult.accepted
            ? "active"
            : "denied";
        }
        if (
          reservationAccountingStatus === null ||
          reservationResult.reservationId !== request.reservationId
        ) {
          fail(
            "idempotency-conflict",
            "The reservation result identity is stale.",
          );
        }
        reservationReceipt = makeReservationReceipt({
          accountingStatus: reservationAccountingStatus,
          intent: reservationIntent,
          receivedAt: this.#trustedNow(),
          result: reservationResult,
        });
        await save({ ...record, reservationIntent, reservationReceipt });
      } else {
        reservationReceipt = assertReservationReceiptMatches({
          intent: reservationIntent,
          receipt: reservationReceipt,
        });
      }
      if (mode === "recovery-only" && hadReservationReceipt) {
        const recovered = await this.#accounting.recoverExistingReservation({
          capacity: reservationCapacity,
          event: reservationEvent,
          expiresAt: request.expiresAt,
          intent: reservationIntent,
          requestedCreditUnits: estimateResult.estimate.maximumCreditUnits,
        });
        if (recovered.kind !== "found") {
          fail(
            "idempotency-conflict",
            "The persisted reservation is missing canonical accounting state.",
          );
        }
        const recoveredStatus = projectReservationAccountingStatus(
          recovered.accountingStatus,
        );
        const recoveredResult = projectReservationResult(recovered.result);
        if (
          !recoveredResult.replayed ||
          recoveredResult.accepted !== reservationReceipt.result.accepted ||
          recoveredResult.denialReason !==
            reservationReceipt.result.denialReason ||
          recoveredResult.reservationId !==
            reservationReceipt.result.reservationId ||
          recoveredResult.reservationId !== request.reservationId
        ) {
          fail(
            "idempotency-conflict",
            "The persisted reservation does not match canonical accounting state.",
          );
        }
        reservationReceipt = makeReservationReceipt({
          accountingStatus: recoveredStatus,
          intent: reservationIntent,
          receivedAt: this.#trustedNow(),
          result: recoveredResult,
        });
        await save({ ...record, reservationReceipt });
      }
      const reservation = reservationReceipt.result;
      if (
        reservation.accepted &&
        (reservationReceipt.accountingStatus === "expired" ||
          reservationReceipt.accountingStatus === "released")
      ) {
        return await finish(
          completedResponse({
            compensationStatus: "not-required",
            completedCreditUnits: 0,
            estimate: estimateResult.estimate,
            reconciliationState: "not-required",
            request,
            route: selectedRoute,
            state: "released",
            units: zeroUnits(),
          }),
          "terminal",
        );
      }
      if (
        reservation.accepted &&
        reservationReceipt.accountingStatus === "settled"
      ) {
        return await finish(
          completedResponse({
            compensationStatus: "pending",
            completedCreditUnits: null,
            estimate: estimateResult.estimate,
            reconciliationState: "pending-missing-usage",
            request,
            route: selectedRoute,
            state: "reconciliation-required",
            units: null,
          }),
          "reconciliation-required",
        );
      }
      if (!reservation.accepted) {
        return await finish(
          denialResponse(
            reservation.denialReason ?? "reservation-denied",
            selectedRoute,
            estimateResult.estimate,
            "reservation-denied",
          ),
          "terminal",
        );
      }
      if (record.state === "claimed") {
        await save({
          ...record,
          reservationIntent,
          reservationReceipt,
          resolvedContext,
          state: "reserved",
        });
      }
      let receipt = record.invocationReceipt;
      let preDispatchNoUsageVerified = false;
      if (receipt === null) {
        const previousIntent = record.dispatchIntent;
        if (previousIntent !== null) {
          receipt =
            (await this.#recoverInvocationReceipt(previousIntent, request)) ??
            fixedUncertainReceipt({
              dispatchIntent: previousIntent,
              failureCode: "callback-outcome-unknown",
              receivedAt: this.#trustedNow(),
              request,
            });
          await save({
            ...record,
            invocationReceipt: receipt,
            invocationResult: receipt.result,
            state: "invoked",
          });
        } else {
          const intentRecordedAt = this.#trustedNow();
          const dispatchIntent = {
            dispatchIntentId: `dispatch_${digestStructuredValue({
              fencingToken: lease.fencingToken,
              multiCallWorkflowId: request.multiCallWorkflowId,
              reservationId: request.reservationId,
            }).slice("sha256:".length, "sha256:".length + 48)}`,
            recordedAt: intentRecordedAt,
          } satisfies ModelCommercialDispatchIntentV1;
          await save({ ...record, dispatchIntent });
          const immediatelyBeforeDispatch = this.#trustedNow();
          if (
            parseInstant(immediatelyBeforeDispatch, "trusted host time") >=
            parseInstant(request.expiresAt, "expiresAt")
          ) {
            receipt = fixedHostPreDispatchReceipt({
              dispatchIntent,
              receivedAt: immediatelyBeforeDispatch,
              request,
            });
          } else if (mode === "recovery-only" || invoke === null) {
            receipt = fixedUncertainReceipt({
              dispatchIntent,
              failureCode: "callback-outcome-unknown",
              receivedAt: immediatelyBeforeDispatch,
              request,
            });
          } else {
            try {
              const candidate = await invoke({
                acceptedMaximumCreditUnits:
                  estimateResult.estimate.maximumCreditUnits,
                acceptedMaximumEstimatedProviderCostMicros:
                  estimateResult.maximumEstimatedProviderCostMicros,
                dispatchIntentId: dispatchIntent.dispatchIntentId,
                multiCallWorkflowId: request.multiCallWorkflowId,
                normalizationPolicyCatalogDigest:
                  estimateResult.pricingAuthority
                    .normalizationPolicyCatalogDigest,
                normalizationPolicyVersionReference:
                  estimateResult.normalizationPolicyVersionId,
                pricingAuthorityDigest:
                  estimateResult.pricingAuthority.authorityDigest,
                pricingCatalogDigest:
                  estimateResult.pricingAuthority.pricingCatalogDigest,
                pricingVersionReference: estimateResult.primaryPricingVersionId,
                reservationId: request.reservationId,
                route: selectedRoute,
              });
              const receivedAt = this.#trustedNow();
              if (
                this.#liveRecovery !== undefined &&
                candidate.preDispatchNoUsageAttestation === undefined
              ) {
                // Fresh evaluation completion also comes from the authenticated
                // journal. A callback cannot invent validator or usage authority.
                receipt = await this.#recoverInvocationReceipt(
                  dispatchIntent,
                  request,
                );
                receipt ??= fixedUncertainReceipt({
                  dispatchIntent,
                  failureCode: "callback-outcome-unknown",
                  receivedAt,
                  request,
                });
                // The journal is authoritative even when a callback differs.
                // Canonical host timing is projected once from the dispatch.
              } else {
                try {
                  receipt = hostCanonicalReceipt({
                    candidate,
                    dispatchIntent,
                    receivedAt,
                    request,
                  });
                } catch {
                  receipt = fixedUncertainReceipt({
                    dispatchIntent,
                    failureCode: "unsafe-provider-receipt",
                    receivedAt,
                    request,
                  });
                }
              }
            } catch {
              receipt =
                (await this.#recoverInvocationReceipt(
                  dispatchIntent,
                  request,
                )) ??
                fixedUncertainReceipt({
                  dispatchIntent,
                  failureCode: "callback-outcome-unknown",
                  receivedAt: this.#trustedNow(),
                  request,
                });
            }
          }
          await save({
            ...record,
            dispatchIntent,
            invocationReceipt: receipt,
            invocationResult: receipt.result,
            state: "invoked",
          });
        }
      }

      receipt = projectHostInvocationReceipt(receipt);
      const dispatchIntent = record.dispatchIntent;
      if (dispatchIntent?.dispatchIntentId !== receipt.dispatchIntentId) {
        fail("idempotency-conflict", "The host dispatch receipt is stale.");
      }
      const proof = receipt.preDispatchProof;
      if (proof !== null) {
        preDispatchNoUsageVerified = coordinatorPreDispatchProofMatches({
          dispatchIntent,
          proof,
          receipt,
          request,
        });
        if (!preDispatchNoUsageVerified) {
          receipt = fixedUncertainReceipt({
            dispatchIntent,
            failureCode: "unsafe-provider-receipt",
            receivedAt: receipt.receivedAt,
            request,
          });
          await save({
            ...record,
            invocationReceipt: receipt,
            invocationResult: receipt.result,
          });
        }
      }
      const attestation = receipt.result.preDispatchNoUsageAttestation;
      if (attestation !== undefined) {
        const attestationVerified = await this.#verifyPreDispatchAttestation({
          attestation,
          dispatchIntent,
          request,
        });
        if (!attestationVerified) {
          preDispatchNoUsageVerified = false;
          receipt = fixedUncertainReceipt({
            dispatchIntent,
            failureCode: "unsafe-provider-receipt",
            receivedAt: receipt.receivedAt,
            request,
          });
          await save({
            ...record,
            invocationReceipt: receipt,
            invocationResult: receipt.result,
          });
        } else {
          preDispatchNoUsageVerified = true;
        }
      }

      let priced: PricedInvocationResult | null;
      try {
        priced = priceInvocation(
          request,
          authorization,
          receipt,
          selectedRoute,
          estimateResult.pricingAuthority,
          preDispatchNoUsageVerified,
          estimateResult.maximumEstimatedProviderCostMicros,
        );
      } catch {
        receipt = fixedUncertainReceipt({
          dispatchIntent,
          failureCode: "unsafe-provider-receipt",
          receivedAt: receipt.receivedAt,
          request,
        });
        await save({
          ...record,
          invocationReceipt: receipt,
          invocationResult: receipt.result,
        });
        priced = null;
      }
      const invocationResult = receipt.result;
      if (priced === null) {
        const event = makeEvent({
          attempts: [],
          chargedCreditUnits: 0,
          compensatedCreditUnits: 0,
          completedAt: receipt.receivedAt,
          estimatedProviderCostMicros: 0,
          eventSuffix: "reconciliation_required",
          failureCategory:
            invocationResult.failureCategory ?? "missing-provider-usage",
          normalizationPolicyVersionId:
            estimateResult.normalizationPolicyVersionId,
          occurredAt: receipt.receivedAt,
          pricingVersionId: estimateResult.primaryPricingVersionId,
          reconciliationState: "pending-missing-usage",
          request,
          reservedCreditUnits: estimateResult.estimate.maximumCreditUnits,
          route: selectedRoute,
          status: "reconciliation-required",
          units: zeroUnits(),
        });
        await this.#accounting.markReconciliationRequired({ event });
        return await finish(
          completedResponse({
            compensationStatus: "pending",
            completedCreditUnits: null,
            estimate: estimateResult.estimate,
            reconciliationState: "pending-missing-usage",
            request,
            route: selectedRoute,
            state: "reconciliation-required",
            units: null,
          }),
          "reconciliation-required",
        );
      }

      if (invocationResult.usefulOutputDelivered) {
        const chargedCreditUnits = Math.min(
          priced.actualCreditUnits,
          estimateResult.estimate.maximumCreditUnits,
        );
        const compensatedCreditUnits = Math.max(
          0,
          priced.actualCreditUnits - chargedCreditUnits,
        );
        const event = makeEvent({
          attempts: priced.attempts,
          chargedCreditUnits,
          compensatedCreditUnits,
          completedAt: receipt.receivedAt,
          estimatedProviderCostMicros: priced.estimatedProviderCostMicros,
          eventSuffix: "settlement",
          failureCategory:
            compensatedCreditUnits > 0 ? "estimate-overrun" : null,
          normalizationPolicyVersionId: priced.normalizationPolicyVersionId,
          occurredAt: receipt.receivedAt,
          pricingVersionId: priced.primaryPricingVersionId,
          reconciliationState: "not-required",
          request,
          reservedCreditUnits: estimateResult.estimate.maximumCreditUnits,
          route: selectedRoute,
          status: compensatedCreditUnits > 0 ? "compensated" : "completed",
          units: priced.units,
        });
        try {
          await this.#accounting.settle({
            actualCreditUnits: priced.actualCreditUnits,
            chargedCreditUnits,
            event,
          });
        } catch {
          await save({
            ...record,
            response: null,
            state: "settlement-pending",
          });
          return completedResponse({
            compensationStatus:
              compensatedCreditUnits > 0 ? "pending" : "not-required",
            completedCreditUnits: null,
            estimate: estimateResult.estimate,
            reconciliationState: "pending-settlement",
            request,
            route: selectedRoute,
            state: "settlement-pending",
            units: priced.units,
          });
        }
        return await finish(
          completedResponse({
            compensationStatus:
              compensatedCreditUnits > 0 ? "applied" : "not-required",
            completedCreditUnits: chargedCreditUnits,
            estimate: estimateResult.estimate,
            reconciliationState: "not-required",
            request,
            route: selectedRoute,
            state: compensatedCreditUnits > 0 ? "compensated" : "completed",
            units: priced.units,
          }),
          "terminal",
        );
      }

      const status: CanonicalModelUsageEventStatusV1 =
        invocationResult.status === "provider-failure" ||
        invocationResult.status === "timeout"
          ? "provider-failure"
          : invocationResult.status === "cancelled"
            ? "cancelled"
            : "internal-failure";
      const releaseEvent = makeEvent({
        attempts: priced.attempts,
        chargedCreditUnits: 0,
        compensatedCreditUnits: priced.actualCreditUnits,
        completedAt: receipt.receivedAt,
        estimatedProviderCostMicros: priced.estimatedProviderCostMicros,
        eventSuffix: "release",
        failureCategory: invocationResult.failureCategory,
        normalizationPolicyVersionId: priced.normalizationPolicyVersionId,
        occurredAt: receipt.receivedAt,
        pricingVersionId: priced.primaryPricingVersionId,
        reconciliationState: "not-required",
        request,
        reservedCreditUnits: estimateResult.estimate.maximumCreditUnits,
        route: selectedRoute,
        status,
        units: priced.units,
      });
      await this.#accounting.release({ event: releaseEvent });
      return await finish(
        completedResponse({
          compensationStatus:
            priced.actualCreditUnits > 0 ? "applied" : "not-required",
          completedCreditUnits: 0,
          estimate: estimateResult.estimate,
          reconciliationState: "not-required",
          request,
          route: selectedRoute,
          state: priced.actualCreditUnits > 0 ? "compensated" : "released",
          units: priced.units,
        }),
        "terminal",
      );
    } finally {
      await this.#workflows.releaseExecution({
        lease,
        multiCallWorkflowId: request.multiCallWorkflowId,
        tenantScopeDigest: verifiedScope.tenantScopeDigest,
      });
    }
  }

  public async execute(
    request: ModelCommercialOperationRequestV1,
    invoke: ModelCommercialInvokeCallback,
  ): Promise<ModelCommercialLifecycleResponseV1> {
    return await this.#safeExecute(request, invoke, "dispatch-authorized");
  }

  /** Recovery-only: never reserves a missing workflow and never invokes a model. */
  public async recover(
    request: ModelCommercialOperationRequestV1,
  ): Promise<ModelCommercialLifecycleResponseV1> {
    return await this.#safeExecute(request, null, "recovery-only");
  }

  async #safeExecute(
    request: ModelCommercialOperationRequestV1,
    invoke: ModelCommercialInvokeCallback | null,
    mode: "dispatch-authorized" | "recovery-only",
  ): Promise<ModelCommercialLifecycleResponseV1> {
    try {
      return await this.#executeInternal(request, invoke, mode);
    } catch (error) {
      if (error instanceof ModelCommercialLifecycleError) {
        throw error;
      }
      throw new ModelCommercialLifecycleError(
        "dependency-failure",
        "The commercial lifecycle dependency is unavailable.",
      );
    }
  }
}

/** Existing normal coordinator. Undeclared live-recovery options cannot select V2. */
export class ModelCommercialLifecycleCoordinator extends ModelCommercialLifecycleEngine {
  constructor(input: ModelCommercialCoordinatorDependenciesV1) {
    super({ dependencies: input });
  }
}
/** Host-owned V2 coordinator. Metadata binding is not operator approval or dispatch
 * authority; the live runtime host must authenticate current execution separately.
 * Both fresh completion and recovery require the exact live journal authority. */
export class ModelLiveCommercialLifecycleCoordinatorV2 extends ModelCommercialLifecycleEngine {
  constructor(
    input: Omit<
      ModelCommercialCoordinatorDependenciesV1,
      "invocationRecovery" | "terminalRecovery"
    > &
      LiveCoordinatorRecovery,
  ) {
    const commercialRequest = projectCommercialOperationRequest(
      input.commercialRequest,
    );
    assertCommercialRequestIdentifiers(commercialRequest);
    const admissionRequest = modelLiveRuntimeAdmissionRequestV2Schema.parse(
      input.admissionRequest,
    );
    if (
      commercialRequest.organizationId !== admissionRequest.organizationId ||
      commercialRequest.projectId !== admissionRequest.projectId ||
      commercialRequest.userId !== admissionRequest.userId ||
      commercialRequest.feature !== admissionRequest.operation ||
      sha256Text(commercialRequest.idempotencyKey) !==
        admissionRequest.idempotencyKeyDigest ||
      commercialRequest.requestedMaximumOutputUnits !==
        admissionRequest.requested.outputTokens ||
      commercialRequest.plannedCalls.length !== 1 ||
      commercialRequest.plannedCalls[0]?.kind !== "primary"
    )
      fail("policy-violation", "Live commercial metadata is contradictory.");
    super({
      dependencies: {
        accounting: input.accounting,
        attestations: input.attestations,
        authorization: input.authorization,
        now: input.now,
        pricing: input.pricing,
        scopeResolver: input.scopeResolver,
        workflows: input.workflows,
      },
      liveRecovery: {
        commercialRequest,
        admissionRequest,
        invocationRecovery: input.invocationRecovery,
        terminalRecovery: input.terminalRecovery,
      },
    });
  }
}
