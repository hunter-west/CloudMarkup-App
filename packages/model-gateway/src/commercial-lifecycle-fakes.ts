/* eslint-disable @typescript-eslint/require-await -- deterministic fakes implement asynchronous production ports without I/O. */

import { digestModelCommercialVerifiedScopeV1 } from "./commercial-lifecycle.js";
import { digestStructuredValue } from "./security.js";
import type {
  CanonicalModelUsageEventV1,
  ModelCommercialAccountingPort,
  ModelCommercialAuthorizationDecisionV1,
  ModelCommercialAuthorizationPort,
  ModelCommercialCapacityReservationV1,
  ModelCommercialDenialReasonV1,
  ModelCommercialHostAttestationPortV1,
  ModelCommercialOperationRequestV1,
  ModelCommercialPricingPort,
  ModelCommercialReservationAccountingStatusV1,
  ModelCommercialReservationIntentV1,
  ModelCommercialReservationRecoveryResultV1,
  ModelCommercialReservationResultV1,
  ModelCommercialScopeResolverV1,
  ModelCommercialVerifiedScopeV1,
  ModelCommercialWorkflowExecutionLeaseV1,
  ModelCommercialWorkflowRecordV1,
  ModelCommercialWorkflowStore,
} from "./commercial-lifecycle.js";
import type {
  CreditNormalizationPolicyVersionV1,
  ModelProviderPricingVersionV1,
} from "@cloudmarkup/domain";

interface FakeReservationOutcome {
  readonly capacityDigest: string;
  readonly event: CanonicalModelUsageEventV1;
  readonly expiresAt: string;
  readonly intentId: string;
  readonly requestedCreditUnits: number;
  readonly result: ModelCommercialReservationResultV1;
}

interface FakeReservation {
  readonly capacityDigest: string;
  readonly event: CanonicalModelUsageEventV1;
  readonly expiresAt: string;
  readonly intentId: string;
  readonly featureCapacityKey: string;
  readonly organizationCapacityKey: string;
  readonly requestedCreditUnits: number;
  readonly reservationId: string;
  readonly organizationId: string;
  readonly userCapacityKey: string;
  status: "active" | "settled" | "released" | "expired";
}

function cloneEvent(
  event: CanonicalModelUsageEventV1,
): CanonicalModelUsageEventV1 {
  return {
    ...event,
    attempts: event.attempts.map((attempt) => ({
      ...attempt,
      usage: {
        ...attempt.usage,
        providerSpecificUnits: attempt.usage.providerSpecificUnits.map(
          (unit) => ({ ...unit }),
        ),
      },
    })),
    providerSpecificUnits: event.providerSpecificUnits.map((unit) => ({
      ...unit,
    })),
  };
}

function eventFingerprint(event: CanonicalModelUsageEventV1): string {
  return JSON.stringify(event);
}

type CanonicalModelUsageEventScopeV1 = Pick<
  CanonicalModelUsageEventV1,
  "organizationId" | "projectId" | "userId"
>;

function tenantScopedAccountingKey(
  scope: CanonicalModelUsageEventScopeV1,
  opaqueId: string,
): string {
  return `${digestModelCommercialVerifiedScopeV1(scope)}\u0000${opaqueId}`;
}

export class InMemoryModelCommercialHostAttestations implements ModelCommercialHostAttestationPortV1 {
  #allowed = true;

  public setAllowed(allowed: boolean): void {
    this.#allowed = allowed;
  }

  public async verifyPreDispatchNoUsage(
    input: Parameters<
      ModelCommercialHostAttestationPortV1["verifyPreDispatchNoUsage"]
    >[0],
  ): Promise<boolean> {
    return (
      this.#allowed &&
      input.attestation.verifierId === "cloudmarkup.host-dispatch" &&
      input.attestation.verifierVersion === "1" &&
      input.attestation.dispatchIntentId === input.expected.dispatchIntentId &&
      input.attestation.multiCallWorkflowId ===
        input.expected.multiCallWorkflowId &&
      input.attestation.organizationId === input.expected.organizationId &&
      input.attestation.projectId === input.expected.projectId &&
      input.attestation.reservationId === input.expected.reservationId
    );
  }
}

export class InMemoryModelCommercialAuthorization implements ModelCommercialAuthorizationPort {
  #decision: ModelCommercialAuthorizationDecisionV1;
  #resolveCount = 0;

  public constructor(decision: ModelCommercialAuthorizationDecisionV1) {
    this.#decision = decision;
  }

  public get resolveCount(): number {
    return this.#resolveCount;
  }

  public setDecision(decision: ModelCommercialAuthorizationDecisionV1): void {
    this.#decision = decision;
  }

  public async resolve(
    _request: ModelCommercialOperationRequestV1,
  ): Promise<ModelCommercialAuthorizationDecisionV1> {
    this.#resolveCount += 1;
    void _request;
    return {
      ...this.#decision,
      allowedModelKeys: [...this.#decision.allowedModelKeys],
      allowedRouteIds: [...this.#decision.allowedRouteIds],
      approvedRoutes: this.#decision.approvedRoutes.map((route) => ({
        ...route,
      })),
    };
  }
}

export class InMemoryModelCommercialPricing implements ModelCommercialPricingPort {
  #policies: readonly CreditNormalizationPolicyVersionV1[];
  #pricing: readonly ModelProviderPricingVersionV1[];

  public constructor(input: {
    readonly policies: readonly CreditNormalizationPolicyVersionV1[];
    readonly pricing: readonly ModelProviderPricingVersionV1[];
  }) {
    this.#policies = input.policies;
    this.#pricing = input.pricing;
  }

  public setPolicies(
    policies: readonly CreditNormalizationPolicyVersionV1[],
  ): void {
    this.#policies = policies;
  }

  public setPricing(pricing: readonly ModelProviderPricingVersionV1[]): void {
    this.#pricing = pricing;
  }

  public async listCreditNormalizationPolicies(): Promise<
    readonly CreditNormalizationPolicyVersionV1[]
  > {
    return this.#policies.map((policy) => ({ ...policy }));
  }

  public async listProviderPricingVersions(): Promise<
    readonly ModelProviderPricingVersionV1[]
  > {
    return this.#pricing.map((pricing) => ({
      ...pricing,
      providerSpecificUnitRates: pricing.providerSpecificUnitRates.map(
        (rate) => ({ ...rate }),
      ),
    }));
  }
}

export class InMemoryModelCommercialScopeResolver implements ModelCommercialScopeResolverV1 {
  readonly #fixedScope: Omit<
    ModelCommercialVerifiedScopeV1,
    "authority" | "tenantScopeDigest"
  > | null;

  public constructor(
    fixedScope: Omit<
      ModelCommercialVerifiedScopeV1,
      "authority" | "tenantScopeDigest"
    > | null = null,
  ) {
    this.#fixedScope = fixedScope;
  }

  public async resolve(input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly userId: string;
  }): Promise<ModelCommercialVerifiedScopeV1> {
    const scope = this.#fixedScope ?? input;
    return {
      authority: "verified-principal-scope-v1",
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      tenantScopeDigest: digestModelCommercialVerifiedScopeV1(scope),
      userId: scope.userId,
    };
  }
}

interface InMemoryCommercialWorkflowEntryV1 {
  lease: ModelCommercialWorkflowExecutionLeaseV1 | null;
  record: ModelCommercialWorkflowRecordV1;
}

export class InMemoryModelCommercialWorkflowStore implements ModelCommercialWorkflowStore {
  readonly #records = new Map<string, InMemoryCommercialWorkflowEntryV1>();
  #nextFence = 1;

  public async claimExecution(input: {
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
        readonly response: NonNullable<
          ModelCommercialWorkflowRecordV1["response"]
        >;
      }
  > {
    const trustedNow = Date.parse(input.trustedNow);
    const leaseExpiresAt = Date.parse(input.leaseExpiresAt);
    if (
      !Number.isFinite(trustedNow) ||
      !Number.isFinite(leaseExpiresAt) ||
      leaseExpiresAt <= trustedNow
    ) {
      throw new Error("Model commercial workflow lease time is invalid.");
    }
    const key = this.#key(
      input.tenantScopeDigest,
      input.request.multiCallWorkflowId,
    );
    const existing = this.#records.get(key);
    if (existing !== undefined) {
      if (existing.record.fingerprint !== input.fingerprint) {
        return { kind: "conflict" };
      }
      if (existing.record.response !== null) {
        return {
          kind: "terminal",
          response: structuredClone(existing.record.response),
        };
      }
      if (existing.lease !== null) {
        if (trustedNow < Date.parse(existing.lease.expiresAt)) {
          return { kind: "in-progress" };
        }
        existing.lease = null;
      }
      const lease = this.#newLease(key, input.trustedNow, input.leaseExpiresAt);
      existing.lease = lease;
      return {
        kind: "acquired",
        lease,
        record: structuredClone(existing.record),
      };
    }
    if (input.recoveryOnly) {
      return { kind: "missing" };
    }
    const record: ModelCommercialWorkflowRecordV1 = {
      dispatchIntent: null,
      fingerprint: input.fingerprint,
      invocationReceipt: null,
      invocationResult: null,
      request: structuredClone(input.request),
      reservationIntent: null,
      reservationReceipt: null,
      resolvedContext: null,
      response: null,
      revision: 0,
      state: "claimed",
    };
    const lease = this.#newLease(key, input.trustedNow, input.leaseExpiresAt);
    this.#records.set(key, { lease, record });
    return { kind: "acquired", lease, record: structuredClone(record) };
  }

  public async compareAndSet(input: {
    readonly expectedRevision: number;
    readonly lease: ModelCommercialWorkflowExecutionLeaseV1;
    readonly record: ModelCommercialWorkflowRecordV1;
    readonly tenantScopeDigest: string;
    readonly trustedNow: string;
  }): Promise<ModelCommercialWorkflowRecordV1> {
    const key = this.#key(
      input.tenantScopeDigest,
      input.record.request.multiCallWorkflowId,
    );
    const existing = this.#records.get(key);
    if (
      existing === undefined ||
      existing.lease?.leaseId !== input.lease.leaseId ||
      existing.lease.fencingToken !== input.lease.fencingToken ||
      existing.lease.acquiredAt !== input.lease.acquiredAt ||
      existing.lease.expiresAt !== input.lease.expiresAt ||
      !Number.isFinite(Date.parse(input.trustedNow)) ||
      Date.parse(input.trustedNow) >= Date.parse(input.lease.expiresAt) ||
      existing.record.revision !== input.expectedRevision ||
      input.record.revision !== input.expectedRevision ||
      existing.record.fingerprint !== input.record.fingerprint
    ) {
      throw new Error("Model commercial workflow fencing conflict.");
    }
    const next = structuredClone({
      ...input.record,
      revision: input.expectedRevision + 1,
    });
    existing.record = next;
    return structuredClone(next);
  }

  public async releaseExecution(input: {
    readonly lease: ModelCommercialWorkflowExecutionLeaseV1;
    readonly multiCallWorkflowId: string;
    readonly tenantScopeDigest: string;
  }): Promise<void> {
    const existing = this.#records.get(
      this.#key(input.tenantScopeDigest, input.multiCallWorkflowId),
    );
    if (
      existing === undefined ||
      existing.lease?.leaseId !== input.lease.leaseId ||
      existing.lease.fencingToken !== input.lease.fencingToken ||
      existing.lease.acquiredAt !== input.lease.acquiredAt ||
      existing.lease.expiresAt !== input.lease.expiresAt
    ) {
      throw new Error("Model commercial workflow fencing conflict.");
    }
    existing.lease = null;
  }

  public get(
    multiCallWorkflowId: string,
    tenantScopeDigest?: string,
  ): ModelCommercialWorkflowRecordV1 | null {
    const record =
      tenantScopeDigest === undefined
        ? [...this.#records.values()].find(
            (entry) =>
              entry.record.request.multiCallWorkflowId === multiCallWorkflowId,
          )?.record
        : this.#records.get(this.#key(tenantScopeDigest, multiCallWorkflowId))
            ?.record;
    return record === undefined ? null : structuredClone(record);
  }

  #key(tenantScopeDigest: string, multiCallWorkflowId: string): string {
    return `${tenantScopeDigest}\u0000${multiCallWorkflowId}`;
  }

  #newLease(
    key: string,
    acquiredAt: string,
    expiresAt: string,
  ): ModelCommercialWorkflowExecutionLeaseV1 {
    const fence = this.#nextFence;
    this.#nextFence += 1;
    return {
      acquiredAt,
      expiresAt,
      fencingToken: `fence_${String(fence)}`,
      leaseId: `commercial_lease_${String(fence)}_${key.slice(0, 48)}`,
    };
  }
}

export class InMemoryCanonicalModelCommercialAccounting implements ModelCommercialAccountingPort {
  readonly #balances = new Map<string, number>();
  readonly #charged = new Map<string, number>();
  readonly #featureRequests = new Map<string, number>();
  readonly #events: CanonicalModelUsageEventV1[] = [];
  readonly #eventsByTenantIdempotencyKey = new Map<
    string,
    CanonicalModelUsageEventV1
  >();
  readonly #organizationConcurrentReservations = new Map<string, number>();
  readonly #perUserRequests = new Map<string, number>();
  readonly #reservationOutcomesByTenantIntent = new Map<
    string,
    FakeReservationOutcome
  >();
  readonly #reservationsByTenantReservation = new Map<
    string,
    FakeReservation
  >();
  #failSettlementCount = 0;
  #nextRecoveryFault: "not-found" | "reservation-id" | "status-result" | null =
    null;
  public recoverExistingReservationCalls = 0;
  public releaseCalls = 0;
  public reserveCalls = 0;

  public constructor(
    organizationCreditBalances: Readonly<Record<string, number>>,
  ) {
    for (const [organizationId, creditUnits] of Object.entries(
      organizationCreditBalances,
    )) {
      if (!Number.isSafeInteger(creditUnits) || creditUnits < 0) {
        throw new Error("Fake organization credit balances must be safe.");
      }
      this.#balances.set(organizationId, creditUnits);
      this.#charged.set(organizationId, 0);
    }
  }

  public get events(): readonly CanonicalModelUsageEventV1[] {
    return this.#events.map(cloneEvent);
  }

  public failNextSettlements(count = 1): void {
    this.#failSettlementCount = count;
  }

  public failNextRecoveryAsNotFound(): void {
    this.#nextRecoveryFault = "not-found";
  }

  public tamperNextRecoveryReservationId(): void {
    this.#nextRecoveryFault = "reservation-id";
  }

  public tamperNextRecoveryStatusResultPair(): void {
    this.#nextRecoveryFault = "status-result";
  }

  public getAvailableCreditUnits(organizationId: string): number {
    const balance = this.#balances.get(organizationId) ?? 0;
    const charged = this.#charged.get(organizationId) ?? 0;
    const reserved = [...this.#reservationsByTenantReservation.values()]
      .filter(
        (reservation) =>
          reservation.organizationId === organizationId &&
          reservation.status === "active",
      )
      .reduce(
        (total, reservation) => total + reservation.requestedCreditUnits,
        0,
      );
    return balance - charged - reserved;
  }

  public getReservationStatus(
    scope: CanonicalModelUsageEventScopeV1,
    reservationId: string,
  ): FakeReservation["status"] | null {
    return (
      this.#reservationsByTenantReservation.get(
        tenantScopedAccountingKey(scope, reservationId),
      )?.status ?? null
    );
  }

  public async reserve(input: {
    readonly capacity: ModelCommercialCapacityReservationV1;
    readonly event: CanonicalModelUsageEventV1;
    readonly expiresAt: string;
    readonly intent: ModelCommercialReservationIntentV1;
    readonly requestedCreditUnits: number;
  }): Promise<ModelCommercialReservationResultV1> {
    this.reserveCalls += 1;
    const capacityDigest = digestStructuredValue(input.capacity);
    if (
      input.intent.capacityDigest !== capacityDigest ||
      input.intent.eventDigest !== digestStructuredValue(input.event) ||
      input.intent.expiresAt !== input.expiresAt ||
      input.intent.requestedCreditUnits !== input.requestedCreditUnits ||
      input.intent.reservationId !== input.event.reservationId
    ) {
      throw new Error("Reservation intent does not match canonical input.");
    }
    const priorOutcome = this.#reservationOutcomesByTenantIntent.get(
      tenantScopedAccountingKey(input.event, input.intent.intentId),
    );
    if (priorOutcome !== undefined) {
      this.#assertReservationOutcomeMatches(priorOutcome, input);
      return { ...priorOutcome.result, replayed: true };
    }
    const existing = this.#reservationsByTenantReservation.get(
      tenantScopedAccountingKey(input.event, input.event.reservationId),
    );
    if (existing !== undefined) {
      throw new Error("Reservation identity conflict.");
    }
    const featureCapacityKey = [
      input.event.organizationId,
      input.event.feature,
    ].join("\u0000");
    const organizationCapacityKey = input.event.organizationId;
    const userCapacityKey = [
      input.event.organizationId,
      input.event.userId,
    ].join("\u0000");
    const capacityDenial = this.#capacityDenial(input.capacity, {
      featureCapacityKey,
      organizationCapacityKey,
      userCapacityKey,
    });
    if (capacityDenial !== null) {
      const result = {
        accepted: false,
        denialReason: capacityDenial,
        replayed: false,
        reservationId: input.event.reservationId,
      } satisfies ModelCommercialReservationResultV1;
      this.#rememberReservationOutcome(input, result);
      return result;
    }
    if (
      this.getAvailableCreditUnits(input.event.organizationId) <
      input.requestedCreditUnits
    ) {
      const result = {
        accepted: false,
        denialReason: "insufficient-credits" as const,
        replayed: false,
        reservationId: input.event.reservationId,
      } satisfies ModelCommercialReservationResultV1;
      this.#rememberReservationOutcome(input, result);
      return result;
    }
    this.#increment(this.#featureRequests, featureCapacityKey);
    this.#increment(
      this.#organizationConcurrentReservations,
      organizationCapacityKey,
    );
    this.#increment(this.#perUserRequests, userCapacityKey);
    this.#reservationsByTenantReservation.set(
      tenantScopedAccountingKey(input.event, input.event.reservationId),
      {
        capacityDigest,
        event: cloneEvent(input.event),
        expiresAt: input.expiresAt,
        intentId: input.intent.intentId,
        featureCapacityKey,
        organizationCapacityKey,
        organizationId: input.event.organizationId,
        requestedCreditUnits: input.requestedCreditUnits,
        reservationId: input.event.reservationId,
        status: "active",
        userCapacityKey,
      },
    );
    this.#append(input.event);
    const result = {
      accepted: true,
      denialReason: null,
      replayed: false,
      reservationId: input.event.reservationId,
    } satisfies ModelCommercialReservationResultV1;
    this.#rememberReservationOutcome(input, result);
    return result;
  }

  public async recoverExistingReservation(input: {
    readonly capacity: ModelCommercialCapacityReservationV1;
    readonly event: CanonicalModelUsageEventV1;
    readonly expiresAt: string;
    readonly intent: ModelCommercialReservationIntentV1;
    readonly requestedCreditUnits: number;
  }): Promise<ModelCommercialReservationRecoveryResultV1> {
    this.recoverExistingReservationCalls += 1;
    const recoveryFault = this.#nextRecoveryFault;
    this.#nextRecoveryFault = null;
    if (recoveryFault === "not-found") {
      return { kind: "not-found" };
    }
    const outcome = this.#reservationOutcomesByTenantIntent.get(
      tenantScopedAccountingKey(input.event, input.intent.intentId),
    );
    if (outcome === undefined) {
      return { kind: "not-found" };
    }
    this.#assertReservationOutcomeMatches(outcome, input);
    let accountingStatus: ModelCommercialReservationAccountingStatusV1 =
      "denied";
    if (outcome.result.accepted) {
      const reservation = this.#reservationsByTenantReservation.get(
        tenantScopedAccountingKey(input.event, outcome.result.reservationId),
      );
      if (reservation === undefined) {
        throw new Error(
          "Accepted reservation recovery is missing accounting state.",
        );
      }
      accountingStatus = reservation.status;
    }
    return {
      accountingStatus:
        recoveryFault === "status-result" ? "denied" : accountingStatus,
      kind: "found",
      result: {
        ...outcome.result,
        replayed: true,
        reservationId:
          recoveryFault === "reservation-id"
            ? "reservation_mismatched"
            : outcome.result.reservationId,
      },
    };
  }

  #assertReservationOutcomeMatches(
    outcome: FakeReservationOutcome,
    input: {
      readonly capacity: ModelCommercialCapacityReservationV1;
      readonly event: CanonicalModelUsageEventV1;
      readonly expiresAt: string;
      readonly intent: ModelCommercialReservationIntentV1;
      readonly requestedCreditUnits: number;
    },
  ): void {
    if (
      outcome.capacityDigest !== digestStructuredValue(input.capacity) ||
      outcome.intentId !== input.intent.intentId ||
      outcome.expiresAt !== input.expiresAt ||
      outcome.requestedCreditUnits !== input.requestedCreditUnits ||
      eventFingerprint(outcome.event) !== eventFingerprint(input.event)
    ) {
      throw new Error(
        "Existing reservation outcome does not match recovery authority.",
      );
    }
  }

  #rememberReservationOutcome(
    input: {
      readonly capacity: ModelCommercialCapacityReservationV1;
      readonly event: CanonicalModelUsageEventV1;
      readonly expiresAt: string;
      readonly intent: ModelCommercialReservationIntentV1;
      readonly requestedCreditUnits: number;
    },
    result: ModelCommercialReservationResultV1,
  ): void {
    this.#reservationOutcomesByTenantIntent.set(
      tenantScopedAccountingKey(input.event, input.intent.intentId),
      {
        capacityDigest: digestStructuredValue(input.capacity),
        event: cloneEvent(input.event),
        expiresAt: input.expiresAt,
        intentId: input.intent.intentId,
        requestedCreditUnits: input.requestedCreditUnits,
        result: structuredClone(result),
      },
    );
  }

  public async settle(input: {
    readonly actualCreditUnits: number;
    readonly chargedCreditUnits: number;
    readonly event: CanonicalModelUsageEventV1;
  }): Promise<{ readonly replayed: boolean }> {
    if (this.#replay(input.event)) {
      return { replayed: true };
    }
    if (this.#failSettlementCount > 0) {
      this.#failSettlementCount -= 1;
      throw new Error("Synthetic settlement failure.");
    }
    const reservation = this.#activeOwnedReservation(input.event);
    if (
      input.chargedCreditUnits > reservation.requestedCreditUnits ||
      input.chargedCreditUnits > input.actualCreditUnits
    ) {
      throw new Error("Settlement cannot exceed reserved or actual credits.");
    }
    this.#releaseActiveConcurrency(reservation);
    reservation.status = "settled";
    this.#charged.set(
      reservation.organizationId,
      (this.#charged.get(reservation.organizationId) ?? 0) +
        input.chargedCreditUnits,
    );
    this.#append(input.event);
    return { replayed: false };
  }

  public async release(input: {
    readonly event: CanonicalModelUsageEventV1;
  }): Promise<{ readonly replayed: boolean }> {
    this.releaseCalls += 1;
    if (this.#replay(input.event)) {
      return { replayed: true };
    }
    const reservation = this.#activeOwnedReservation(input.event);
    this.#releaseActiveConcurrency(reservation);
    reservation.status = "released";
    this.#append(input.event);
    return { replayed: false };
  }

  public async markReconciliationRequired(input: {
    readonly event: CanonicalModelUsageEventV1;
  }): Promise<{ readonly replayed: boolean }> {
    if (this.#replay(input.event)) {
      return { replayed: true };
    }
    this.#activeOwnedReservation(input.event);
    this.#append(input.event);
    return { replayed: false };
  }

  #capacityDenial(
    capacity: ModelCommercialCapacityReservationV1,
    keys: {
      readonly featureCapacityKey: string;
      readonly organizationCapacityKey: string;
      readonly userCapacityKey: string;
    },
  ): ModelCommercialDenialReasonV1 | null {
    for (const snapshot of [
      capacity.featureRequests,
      capacity.organizationConcurrentReservations,
      capacity.perUserRequests,
    ]) {
      if (
        !Number.isSafeInteger(snapshot.current) ||
        snapshot.current < 0 ||
        !Number.isSafeInteger(snapshot.maximum) ||
        snapshot.maximum < 0
      ) {
        throw new Error("Commercial capacity snapshots must be safe.");
      }
    }
    if (
      Math.max(
        capacity.perUserRequests.current,
        this.#perUserRequests.get(keys.userCapacityKey) ?? 0,
      ) +
        1 >
      capacity.perUserRequests.maximum
    ) {
      return "per-user-request-limit-reached";
    }
    if (
      Math.max(
        capacity.organizationConcurrentReservations.current,
        this.#organizationConcurrentReservations.get(
          keys.organizationCapacityKey,
        ) ?? 0,
      ) +
        1 >
      capacity.organizationConcurrentReservations.maximum
    ) {
      return "organization-concurrent-reservation-limit-reached";
    }
    if (
      Math.max(
        capacity.featureRequests.current,
        this.#featureRequests.get(keys.featureCapacityKey) ?? 0,
      ) +
        1 >
      capacity.featureRequests.maximum
    ) {
      return "feature-limit-reached";
    }
    return null;
  }

  #increment(values: Map<string, number>, key: string): void {
    values.set(key, (values.get(key) ?? 0) + 1);
  }

  #releaseActiveConcurrency(reservation: FakeReservation): void {
    const active =
      this.#organizationConcurrentReservations.get(
        reservation.organizationCapacityKey,
      ) ?? 0;
    if (active < 1) {
      throw new Error("Commercial concurrency capacity is inconsistent.");
    }
    if (active === 1) {
      this.#organizationConcurrentReservations.delete(
        reservation.organizationCapacityKey,
      );
    } else {
      this.#organizationConcurrentReservations.set(
        reservation.organizationCapacityKey,
        active - 1,
      );
    }
  }

  #activeOwnedReservation(event: CanonicalModelUsageEventV1): FakeReservation {
    const reservation = this.#reservationsByTenantReservation.get(
      tenantScopedAccountingKey(event, event.reservationId),
    );
    if (reservation === undefined) {
      throw new Error("Cross-tenant reservation mutation denied.");
    }
    if (reservation.status !== "active") {
      throw new Error("Reservation is already terminal.");
    }
    return reservation;
  }

  #replay(event: CanonicalModelUsageEventV1): boolean {
    const existing = this.#eventsByTenantIdempotencyKey.get(
      tenantScopedAccountingKey(event, event.idempotencyKey),
    );
    if (existing === undefined) {
      return false;
    }
    if (eventFingerprint(existing) !== eventFingerprint(event)) {
      throw new Error("Canonical usage idempotency conflict.");
    }
    return true;
  }

  #append(event: CanonicalModelUsageEventV1): void {
    const clone = cloneEvent(event);
    this.#events.push(clone);
    this.#eventsByTenantIdempotencyKey.set(
      tenantScopedAccountingKey(event, event.idempotencyKey),
      clone,
    );
  }
}

export function deniedModelCommercialAuthorization(
  reason: ModelCommercialDenialReasonV1,
  organizationId: string,
): ModelCommercialAuthorizationDecisionV1 {
  return {
    allowed: false,
    allowedModelKeys: [],
    allowedRouteIds: [],
    approvedRoutes: [],
    availableCreditUnits: 0,
    chargingPolicyVersion: "cloudmarkup-charging-and-failure-v1",
    commercialState: "active",
    denialReason: reason,
    entitlementPolicyVersion: "cloudmarkup-entitlements-v1",
    evaluatedAt: "2026-08-21T12:00:00.000Z",
    featureEntitled: false,
    featureRequests: { current: 0, maximum: 0 },
    maximumInputUnits: 0,
    maximumOutputUnits: 0,
    organizationConcurrentReservations: { current: 0, maximum: 0 },
    organizationId,
    organizationStatus: "active",
    perUserRequests: { current: 0, maximum: 0 },
    planVersionId: "plan_denied",
  };
}
