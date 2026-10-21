import { createHash } from "node:crypto";

import {
  billingMonthlyCreditsForPlanVersion,
  billingPlanKeyForVersion,
  billingPlanVersionForMapping,
  isBillingPlanMappingVersion,
  isBillingMappedPlanVersionId,
} from "./billing-plan-mapping.js";

export const CONTROLLED_BETA_COMMERCIAL_OPERATIONS_VERSION =
  "cloudmarkup-commercial-operations-2026-08-28-v1" as const;

export const BILLING_RECONCILIATION_FINDING_CODES = [
  "open-reservation",
  "expired-open-reservation",
  "duplicate-usage",
  "missing-usage",
  "provider-usage-without-settlement",
  "provider-aggregate-ledger-mismatch",
  "missing-monthly-grant",
  "subscription-period-boundary-mismatch",
  "negative-or-impossible-balance",
  "outlier-usage",
  "starter-pro-mapping-mismatch",
  "pending-compensation",
  "route-distribution-outlier",
  "repair-cost-outlier",
] as const;

export type BillingReconciliationFindingCode =
  (typeof BILLING_RECONCILIATION_FINDING_CODES)[number];
export type BillingReconciliationConfidence =
  "exact" | "aggregate" | "estimated";
export type BillingReconciliationSource =
  | "canonical-ledger"
  | "subscription-projection"
  | "provider-aggregate"
  | "reviewed-configuration"
  | "combined";

export interface BillingReconciliationFinding {
  readonly code: BillingReconciliationFindingCode;
  readonly confidence: BillingReconciliationConfidence;
  readonly evidenceReferences: readonly string[];
  readonly findingId: string;
  readonly message: string;
  readonly organizationId: string;
  readonly severity: "info" | "warning" | "critical";
  readonly source: BillingReconciliationSource;
}

export interface BillingReconciliationSnapshot {
  readonly asOf: string;
  readonly balances: Readonly<{
    readonly adjustmentCreditUnits: number;
    readonly availableCreditUnits: number;
    readonly grantedCreditUnits: number;
    readonly reservedCreditUnits: number;
    readonly settledCreditUnits: number;
  }>;
  readonly configuredRoutes: readonly Readonly<{
    readonly maximumBasisPoints: number;
    readonly minimumBasisPoints: number;
    readonly route: "low-cost" | "standard" | "deep" | "repair";
  }>[];
  readonly grants: readonly Readonly<{
    readonly creditUnits: number;
    readonly endsAt: string;
    readonly grantId: string;
    readonly periodId: string;
    readonly planKey: "starter" | "pro";
    readonly startsAt: string;
  }>[];
  readonly organizationId: string;
  readonly planMapping: Readonly<{
    readonly actualMonthlyCreditUnits: number;
    readonly expectedMonthlyCreditUnits: 200 | 1000 | 1250;
    /** Canonical period plan identity, when available; never a browser selection. */
    readonly planVersionId?: string;
    readonly planKey: "starter" | "pro";
    readonly planMappingVersion: string;
  }>;
  readonly providerAggregate: Readonly<{
    readonly confidence: "aggregate" | "estimated";
    readonly estimatedCostMicros: number;
    readonly periodEndsAt: string;
    readonly periodStartsAt: string;
    readonly providerKey: string;
    readonly sourceReference: string;
  }> | null;
  readonly reservations: readonly Readonly<{
    readonly expiresAt: string;
    readonly reservationId: string;
    readonly status: "active" | "settled" | "released" | "expired";
  }>[];
  readonly subscriptionPeriod: Readonly<{
    readonly endsAt: string;
    readonly periodId: string;
    readonly startsAt: string;
  }> | null;
  readonly thresholds: Readonly<{
    readonly maximumProviderCostMicrosPerRequest: number;
    readonly maximumRepairCostMicrosPerRequest: number;
  }>;
  readonly usage: readonly Readonly<{
    readonly attemptKind:
      "primary" | "automatic-retry" | "system-escalation" | "repair";
    readonly compensationState: "not-required" | "pending" | "applied";
    readonly providerCostMicros: number;
    readonly providerRequestId: string | null;
    readonly reservationId: string;
    readonly route: "low-cost" | "standard" | "deep" | "repair";
    readonly settlementState: "open" | "settled" | "released";
    readonly usageRecordId: string;
  }>[];
}

export interface BillingReconciliationReport {
  readonly asOf: string;
  readonly findings: readonly BillingReconciliationFinding[];
  readonly organizationId: string;
  readonly version: typeof CONTROLLED_BETA_COMMERCIAL_OPERATIONS_VERSION;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;

function fail(message: string): never {
  throw new BillingOperationsError("invalid-input", message);
}

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) fail(label + " is invalid.");
}

function instant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(label + " is invalid.");
  return parsed;
}

function safeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    fail(label + " must be a safe integer.");
  }
}

function nonnegative(value: number, label: string): void {
  safeInteger(value, label);
  if (value < 0) {
    fail(label + " must be nonnegative.");
  }
}

function finding(input: {
  readonly code: BillingReconciliationFindingCode;
  readonly confidence: BillingReconciliationConfidence;
  readonly evidenceReferences: readonly string[];
  readonly message: string;
  readonly organizationId: string;
  readonly severity: BillingReconciliationFinding["severity"];
  readonly source: BillingReconciliationSource;
}): BillingReconciliationFinding {
  const evidenceReferences = [...new Set(input.evidenceReferences)].sort();
  const findingId =
    "billing_finding_" +
    createHash("sha256")
      .update(
        [
          input.organizationId,
          input.code,
          input.source,
          ...evidenceReferences,
        ].join("\u001f"),
      )
      .digest("hex")
      .slice(0, 40);
  return Object.freeze({ ...input, evidenceReferences, findingId });
}

function validateSnapshot(input: BillingReconciliationSnapshot): void {
  assertIdentifier(input.organizationId, "organizationId");
  instant(input.asOf, "asOf");
  assertIdentifier(input.planMapping.planMappingVersion, "planMappingVersion");
  for (const [label, value] of Object.entries(input.balances)) {
    safeInteger(value, label);
  }
  nonnegative(
    input.planMapping.actualMonthlyCreditUnits,
    "actualMonthlyCreditUnits",
  );
  nonnegative(
    input.planMapping.expectedMonthlyCreditUnits,
    "expectedMonthlyCreditUnits",
  );
  nonnegative(
    input.thresholds.maximumProviderCostMicrosPerRequest,
    "maximumProviderCostMicrosPerRequest",
  );
  nonnegative(
    input.thresholds.maximumRepairCostMicrosPerRequest,
    "maximumRepairCostMicrosPerRequest",
  );
  for (const route of input.configuredRoutes) {
    nonnegative(route.minimumBasisPoints, "minimumBasisPoints");
    nonnegative(route.maximumBasisPoints, "maximumBasisPoints");
    if (
      route.maximumBasisPoints > 10_000 ||
      route.minimumBasisPoints > route.maximumBasisPoints
    ) {
      fail("The configured route distribution is invalid.");
    }
  }
}

export function reconcileBillingUsageV1(
  input: BillingReconciliationSnapshot,
): BillingReconciliationReport {
  validateSnapshot(input);
  const findings: BillingReconciliationFinding[] = [];
  const asOf = instant(input.asOf, "asOf");
  const add = (
    details: Omit<BillingReconciliationFinding, "findingId" | "organizationId">,
  ): void => {
    findings.push(
      finding({ ...details, organizationId: input.organizationId }),
    );
  };

  for (const reservation of input.reservations) {
    assertIdentifier(reservation.reservationId, "reservationId");
    if (reservation.status !== "active") continue;
    const expired =
      instant(reservation.expiresAt, "reservation expiresAt") <= asOf;
    add({
      code: expired ? "expired-open-reservation" : "open-reservation",
      confidence: "exact",
      evidenceReferences: [reservation.reservationId],
      message: expired
        ? "A canonical reservation is still open after its dispatch deadline. Reconcile it; time alone does not release credits."
        : "A canonical reservation remains open and must reach an evidenced terminal state.",
      severity: expired ? "critical" : "info",
      source: "canonical-ledger",
    });
  }

  const providerRequests = new Map<string, string[]>();
  let ledgerProviderCostMicros = 0;
  const routeCounts = new Map<string, number>();
  for (const usage of input.usage) {
    assertIdentifier(usage.usageRecordId, "usageRecordId");
    assertIdentifier(usage.reservationId, "reservationId");
    nonnegative(usage.providerCostMicros, "providerCostMicros");
    ledgerProviderCostMicros += usage.providerCostMicros;
    routeCounts.set(usage.route, (routeCounts.get(usage.route) ?? 0) + 1);
    if (
      usage.providerRequestId === null &&
      usage.settlementState === "settled"
    ) {
      add({
        code: "missing-usage",
        confidence: "exact",
        evidenceReferences: [usage.usageRecordId, usage.reservationId],
        message:
          "A settled ledger record is missing its provider request evidence.",
        severity: "critical",
        source: "canonical-ledger",
      });
    }
    if (usage.providerRequestId !== null) {
      assertIdentifier(usage.providerRequestId, "providerRequestId");
      const records = providerRequests.get(usage.providerRequestId) ?? [];
      records.push(usage.usageRecordId);
      providerRequests.set(usage.providerRequestId, records);
      if (usage.settlementState !== "settled") {
        add({
          code: "provider-usage-without-settlement",
          confidence: "exact",
          evidenceReferences: [usage.providerRequestId, usage.usageRecordId],
          message:
            "Provider usage exists without a matching settled canonical ledger state.",
          severity: "critical",
          source: "combined",
        });
      }
    }
    if (
      usage.providerCostMicros >
      input.thresholds.maximumProviderCostMicrosPerRequest
    ) {
      add({
        code: "outlier-usage",
        confidence: "estimated",
        evidenceReferences: [usage.usageRecordId],
        message:
          "Estimated provider cost exceeds the reviewed per-request outlier threshold.",
        severity: "warning",
        source: "combined",
      });
    }
    if (
      usage.attemptKind === "repair" &&
      usage.providerCostMicros >
        input.thresholds.maximumRepairCostMicrosPerRequest
    ) {
      add({
        code: "repair-cost-outlier",
        confidence: "estimated",
        evidenceReferences: [usage.usageRecordId],
        message:
          "AI custom-generation repair cost exceeds its reviewed threshold.",
        severity: "warning",
        source: "combined",
      });
    }
    if (usage.compensationState === "pending") {
      add({
        code: "pending-compensation",
        confidence: "exact",
        evidenceReferences: [usage.usageRecordId, usage.reservationId],
        message: "A canonical compensation event remains unapplied.",
        severity: "warning",
        source: "canonical-ledger",
      });
    }
  }

  for (const [providerRequestId, usageRecordIds] of providerRequests) {
    if (usageRecordIds.length > 1) {
      add({
        code: "duplicate-usage",
        confidence: "exact",
        evidenceReferences: [providerRequestId, ...usageRecordIds],
        message: "Multiple usage records reference the same provider request.",
        severity: "critical",
        source: "canonical-ledger",
      });
    }
  }

  if (
    input.providerAggregate !== null &&
    input.providerAggregate.estimatedCostMicros !== ledgerProviderCostMicros
  ) {
    nonnegative(
      input.providerAggregate.estimatedCostMicros,
      "provider aggregate estimatedCostMicros",
    );
    add({
      code: "provider-aggregate-ledger-mismatch",
      confidence: input.providerAggregate.confidence,
      evidenceReferences: [input.providerAggregate.sourceReference],
      message:
        "Aggregate provider cost differs from normalized ledger estimates. This is aggregate evidence, not exact per-request provider reconciliation.",
      severity: "warning",
      source: "provider-aggregate",
    });
  }

  const configuredPlan = isBillingPlanMappingVersion(
    input.planMapping.planMappingVersion,
  )
    ? billingPlanVersionForMapping(
        input.planMapping.planMappingVersion,
        input.planMapping.planKey,
      )
    : null;
  const selectedPlan = input.planMapping.planVersionId ?? configuredPlan;
  const reviewedMonthlyCreditUnits =
    configuredPlan !== null &&
    isBillingMappedPlanVersionId(selectedPlan) &&
    billingPlanKeyForVersion(selectedPlan) === input.planMapping.planKey
      ? billingMonthlyCreditsForPlanVersion(selectedPlan)
      : null;
  const period = input.subscriptionPeriod;
  const matchingGrant =
    period === null
      ? undefined
      : input.grants.find((grant) => grant.periodId === period.periodId);
  if (period !== null) {
    if (matchingGrant === undefined) {
      add({
        code: "missing-monthly-grant",
        confidence: "exact",
        evidenceReferences: [period.periodId],
        message:
          "The verified subscription period has no idempotent monthly credit grant.",
        severity: "critical",
        source: "combined",
      });
    } else if (
      matchingGrant.startsAt !== period.startsAt ||
      matchingGrant.endsAt !== period.endsAt
    ) {
      add({
        code: "subscription-period-boundary-mismatch",
        confidence: "exact",
        evidenceReferences: [matchingGrant.grantId, period.periodId],
        message:
          "The monthly grant boundaries differ from the verified subscription period.",
        severity: "critical",
        source: "combined",
      });
    }
  }

  if (
    input.planMapping.actualMonthlyCreditUnits !== reviewedMonthlyCreditUnits ||
    input.planMapping.expectedMonthlyCreditUnits !==
      reviewedMonthlyCreditUnits ||
    !isBillingPlanMappingVersion(input.planMapping.planMappingVersion) ||
    (matchingGrant !== undefined &&
      (matchingGrant.creditUnits !== reviewedMonthlyCreditUnits ||
        matchingGrant.planKey !== input.planMapping.planKey))
  ) {
    add({
      code: "starter-pro-mapping-mismatch",
      confidence: "exact",
      evidenceReferences: [
        input.planMapping.planMappingVersion,
        ...(matchingGrant === undefined ? [] : [matchingGrant.grantId]),
      ],
      message:
        "The active Starter/Pro mapping version, allocation, or matching period grant does not match its reviewed versioned credit allowance.",
      severity: "critical",
      source: "reviewed-configuration",
    });
  }

  const balanceValues = Object.values(input.balances);
  const maximumAvailable =
    input.balances.grantedCreditUnits + input.balances.adjustmentCreditUnits;
  const allocated =
    input.balances.availableCreditUnits + input.balances.reservedCreditUnits;
  if (
    balanceValues.some((value) => value < 0) ||
    !Number.isSafeInteger(maximumAvailable) ||
    !Number.isSafeInteger(allocated) ||
    allocated > maximumAvailable ||
    input.balances.settledCreditUnits > maximumAvailable
  ) {
    add({
      code: "negative-or-impossible-balance",
      confidence: "exact",
      evidenceReferences: [input.organizationId],
      message:
        "Derived credit totals are impossible under the append-only grant and ledger model.",
      severity: "critical",
      source: "canonical-ledger",
    });
  }

  const usageCount = input.usage.length;
  if (usageCount > 0) {
    for (const configured of input.configuredRoutes) {
      const basisPoints = Math.floor(
        ((routeCounts.get(configured.route) ?? 0) * 10_000) / usageCount,
      );
      if (
        basisPoints < configured.minimumBasisPoints ||
        basisPoints > configured.maximumBasisPoints
      ) {
        add({
          code: "route-distribution-outlier",
          confidence: "exact",
          evidenceReferences: [configured.route],
          message: `Configured ${configured.route} route distribution is outside its reviewed range.`,
          severity: "warning",
          source: "combined",
        });
      }
    }
  }

  return Object.freeze({
    asOf: input.asOf,
    findings: Object.freeze(
      findings.sort((left, right) =>
        left.findingId === right.findingId
          ? 0
          : left.findingId < right.findingId
            ? -1
            : 1,
      ),
    ),
    organizationId: input.organizationId,
    version: CONTROLLED_BETA_COMMERCIAL_OPERATIONS_VERSION,
  });
}

export const BILLING_SUPPORT_PERMISSIONS = [
  "commercial-projection.read",
  "commercial-usage.read",
  "billing-event.replay",
  "credit-adjustment.issue",
  "expensive-operations.suspend",
  "billing-reconciliation.run",
] as const;
export type BillingSupportPermission =
  (typeof BILLING_SUPPORT_PERMISSIONS)[number];

export interface BillingSupportActor {
  readonly actorId: string;
  readonly actorPrincipalId: string;
  readonly authorizedOrganizationIds: readonly string[];
  readonly permissions: readonly BillingSupportPermission[];
}

export interface SafeBillingProjectionView {
  readonly billingAccountId: string;
  readonly expensiveOperationsEnabled: boolean;
  readonly lastProviderEventReference: string | null;
  readonly organizationId: string;
  readonly planKey: "starter" | "pro" | "unknown";
  readonly projectionUpdatedAt: string;
  readonly subscriptionState:
    "pending" | "active" | "past-due" | "paused" | "canceled" | "incomplete";
}

export interface SafeBillingUsageView {
  readonly availableCreditUnits: number;
  readonly organizationId: string;
  readonly periodEndsAt: string;
  readonly periodStartsAt: string;
  readonly reservedCreditUnits: number;
  readonly settledCreditUnits: number;
}

export interface BillingOperationsPort {
  appendCreditAdjustment(input: {
    readonly actorId: string;
    readonly actorPrincipalId: string;
    readonly creditUnits: number;
    readonly idempotencyKey: string;
    readonly organizationId: string;
    readonly reasonCode: string;
    readonly relatedReference: string;
  }): Promise<Readonly<{ readonly adjustmentId: string }>>;
  getProjection(
    organizationId: string,
  ): Promise<SafeBillingProjectionView | null>;
  getUsage(organizationId: string): Promise<SafeBillingUsageView | null>;
  replayKnownEvent(input: {
    readonly expectedPayloadSha256: string;
    readonly idempotencyKey: string;
    readonly organizationId: string;
    readonly providerEventReference: string;
  }): Promise<
    Readonly<{
      readonly status: "applied" | "duplicate" | "ignored-out-of-order";
    }>
  >;
  setExpensiveOperationsSuspended(input: {
    readonly organizationId: string;
    readonly reasonCode: string;
    readonly suspended: boolean;
  }): Promise<void>;
}

export interface BillingOperationsAuditSink {
  readonly append: (
    event: Readonly<{
      readonly action: string;
      readonly actorId: string;
      readonly actorPrincipalId: string;
      readonly idempotencyKeySha256: string | null;
      readonly organizationId: string;
      readonly outcome: "succeeded" | "denied" | "failed";
      readonly reasonCode: string;
    }>,
  ) => Promise<void>;
}

export type BillingOperationsErrorCode =
  "access-denied" | "invalid-input" | "not-found";

export class BillingOperationsError extends Error {
  readonly code: BillingOperationsErrorCode;

  constructor(code: BillingOperationsErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "BillingOperationsError";
  }
}

export class ControlledBetaBillingOperations {
  readonly #audit: BillingOperationsAuditSink;
  readonly #port: BillingOperationsPort;

  constructor(input: {
    readonly audit: BillingOperationsAuditSink;
    readonly port: BillingOperationsPort;
  }) {
    this.#audit = input.audit;
    this.#port = input.port;
  }

  #authorize(
    actor: BillingSupportActor,
    permission: BillingSupportPermission,
    organizationId: string,
  ): void {
    assertIdentifier(actor.actorId, "actorId");
    assertIdentifier(actor.actorPrincipalId, "actorPrincipalId");
    if (
      actor.authorizedOrganizationIds.length === 0 ||
      actor.authorizedOrganizationIds.length > 256 ||
      new Set(actor.authorizedOrganizationIds).size !==
        actor.authorizedOrganizationIds.length ||
      actor.authorizedOrganizationIds.some(
        (candidate) => !identifierPattern.test(candidate),
      ) ||
      !actor.authorizedOrganizationIds.includes(organizationId) ||
      !actor.permissions.includes(permission)
    ) {
      throw new BillingOperationsError(
        "access-denied",
        "The billing support operation is not available.",
      );
    }
  }

  async viewProjection(
    actor: BillingSupportActor,
    organizationId: string,
  ): Promise<SafeBillingProjectionView> {
    assertIdentifier(organizationId, "organizationId");
    this.#authorize(actor, "commercial-projection.read", organizationId);
    const projection = await this.#port.getProjection(organizationId);
    if (projection?.organizationId !== organizationId) {
      throw new BillingOperationsError(
        "not-found",
        "The billing projection is not available.",
      );
    }
    const safe = Object.freeze({
      billingAccountId: projection.billingAccountId,
      expensiveOperationsEnabled: projection.expensiveOperationsEnabled,
      lastProviderEventReference: projection.lastProviderEventReference,
      organizationId: projection.organizationId,
      planKey: projection.planKey,
      projectionUpdatedAt: projection.projectionUpdatedAt,
      subscriptionState: projection.subscriptionState,
    });
    await this.#audit.append({
      action: "commercial-projection.read",
      actorId: actor.actorId,
      actorPrincipalId: actor.actorPrincipalId,
      idempotencyKeySha256: null,
      organizationId,
      outcome: "succeeded",
      reasonCode: "support-view",
    });
    return safe;
  }

  async viewUsage(
    actor: BillingSupportActor,
    organizationId: string,
  ): Promise<SafeBillingUsageView> {
    assertIdentifier(organizationId, "organizationId");
    this.#authorize(actor, "commercial-usage.read", organizationId);
    const usage = await this.#port.getUsage(organizationId);
    if (usage?.organizationId !== organizationId) {
      throw new BillingOperationsError(
        "not-found",
        "The billing usage view is not available.",
      );
    }
    const safe = Object.freeze({
      availableCreditUnits: usage.availableCreditUnits,
      organizationId: usage.organizationId,
      periodEndsAt: usage.periodEndsAt,
      periodStartsAt: usage.periodStartsAt,
      reservedCreditUnits: usage.reservedCreditUnits,
      settledCreditUnits: usage.settledCreditUnits,
    });
    await this.#audit.append({
      action: "commercial-usage.read",
      actorId: actor.actorId,
      actorPrincipalId: actor.actorPrincipalId,
      idempotencyKeySha256: null,
      organizationId,
      outcome: "succeeded",
      reasonCode: "support-view",
    });
    return safe;
  }

  async replayKnownEvent(
    actor: BillingSupportActor,
    input: {
      readonly expectedPayloadSha256: string;
      readonly idempotencyKey: string;
      readonly organizationId: string;
      readonly providerEventReference: string;
    },
  ): Promise<
    Readonly<{
      readonly status: "applied" | "duplicate" | "ignored-out-of-order";
    }>
  > {
    assertIdentifier(input.organizationId, "organizationId");
    this.#authorize(actor, "billing-event.replay", input.organizationId);
    assertIdentifier(input.providerEventReference, "providerEventReference");
    assertIdentifier(input.idempotencyKey, "idempotencyKey");
    if (!sha256Pattern.test(input.expectedPayloadSha256)) {
      fail("expectedPayloadSha256 is invalid.");
    }
    const result = await this.#port.replayKnownEvent(input);
    await this.#audit.append({
      action: "billing-event.replay",
      actorId: actor.actorId,
      actorPrincipalId: actor.actorPrincipalId,
      idempotencyKeySha256: createHash("sha256")
        .update(input.idempotencyKey)
        .digest("hex"),
      organizationId: input.organizationId,
      outcome: "succeeded",
      reasonCode: "known-provider-event-replay",
    });
    return result;
  }

  async issueCreditAdjustment(
    actor: BillingSupportActor,
    input: {
      readonly creditUnits: number;
      readonly idempotencyKey: string;
      readonly organizationId: string;
      readonly reasonCode: string;
      readonly relatedReference: string;
    },
  ): Promise<Readonly<{ readonly adjustmentId: string }>> {
    assertIdentifier(input.organizationId, "organizationId");
    this.#authorize(actor, "credit-adjustment.issue", input.organizationId);
    if (!Number.isSafeInteger(input.creditUnits) || input.creditUnits === 0) {
      fail("creditUnits must be a nonzero safe integer.");
    }
    for (const [label, value] of Object.entries({
      idempotencyKey: input.idempotencyKey,
      organizationId: input.organizationId,
      reasonCode: input.reasonCode,
      relatedReference: input.relatedReference,
    }))
      assertIdentifier(value, label);
    const result = await this.#port.appendCreditAdjustment({
      ...input,
      actorId: actor.actorId,
      actorPrincipalId: actor.actorPrincipalId,
    });
    await this.#audit.append({
      action: "credit-adjustment.issue",
      actorId: actor.actorId,
      actorPrincipalId: actor.actorPrincipalId,
      idempotencyKeySha256: createHash("sha256")
        .update(input.idempotencyKey)
        .digest("hex"),
      organizationId: input.organizationId,
      outcome: "succeeded",
      reasonCode: input.reasonCode,
    });
    return result;
  }

  async setExpensiveOperationsSuspended(
    actor: BillingSupportActor,
    input: {
      readonly organizationId: string;
      readonly reasonCode: string;
      readonly suspended: boolean;
    },
  ): Promise<void> {
    assertIdentifier(input.organizationId, "organizationId");
    this.#authorize(
      actor,
      "expensive-operations.suspend",
      input.organizationId,
    );
    assertIdentifier(input.reasonCode, "reasonCode");
    await this.#port.setExpensiveOperationsSuspended(input);
    await this.#audit.append({
      action: "expensive-operations.suspend",
      actorId: actor.actorId,
      actorPrincipalId: actor.actorPrincipalId,
      idempotencyKeySha256: null,
      organizationId: input.organizationId,
      outcome: "succeeded",
      reasonCode: input.reasonCode,
    });
  }
}

export interface BillingReconciliationSnapshotPort {
  readonly listOrganizationIds: (asOf: string) => Promise<readonly string[]>;
  readonly loadSnapshot: (
    organizationId: string,
    asOf: string,
  ) => Promise<BillingReconciliationSnapshot>;
  readonly recordReport: (report: BillingReconciliationReport) => Promise<void>;
}

export class BillingReconciliationCoordinator {
  readonly #audit: BillingOperationsAuditSink;
  readonly #port: BillingReconciliationSnapshotPort;

  constructor(
    port: BillingReconciliationSnapshotPort,
    audit: BillingOperationsAuditSink,
  ) {
    this.#audit = audit;
    this.#port = port;
  }

  async runScheduled(
    asOf: string,
  ): Promise<readonly BillingReconciliationReport[]> {
    instant(asOf, "asOf");
    const organizationIds = [
      ...new Set(await this.#port.listOrganizationIds(asOf)),
    ].sort();
    const reports: BillingReconciliationReport[] = [];
    for (const organizationId of organizationIds) {
      assertIdentifier(organizationId, "organizationId");
      const snapshot = await this.#port.loadSnapshot(organizationId, asOf);
      if (
        snapshot.organizationId !== organizationId ||
        snapshot.asOf !== asOf
      ) {
        fail("The reconciliation snapshot scope is invalid.");
      }
      const report = reconcileBillingUsageV1(snapshot);
      await this.#port.recordReport(report);
      reports.push(report);
    }
    return Object.freeze(reports);
  }

  async runForOrganization(
    actor: BillingSupportActor,
    organizationId: string,
    asOf: string,
  ): Promise<BillingReconciliationReport> {
    assertIdentifier(actor.actorId, "actorId");
    assertIdentifier(actor.actorPrincipalId, "actorPrincipalId");
    assertIdentifier(organizationId, "organizationId");
    if (
      actor.authorizedOrganizationIds.length === 0 ||
      actor.authorizedOrganizationIds.length > 256 ||
      new Set(actor.authorizedOrganizationIds).size !==
        actor.authorizedOrganizationIds.length ||
      actor.authorizedOrganizationIds.some(
        (candidate) => !identifierPattern.test(candidate),
      ) ||
      !actor.authorizedOrganizationIds.includes(organizationId) ||
      !actor.permissions.includes("billing-reconciliation.run")
    ) {
      throw new BillingOperationsError(
        "access-denied",
        "The billing support operation is not available.",
      );
    }
    const snapshot = await this.#port.loadSnapshot(organizationId, asOf);
    if (snapshot.organizationId !== organizationId || snapshot.asOf !== asOf) {
      fail("The reconciliation snapshot scope is invalid.");
    }
    const report = reconcileBillingUsageV1(snapshot);
    await this.#port.recordReport(report);
    await this.#audit.append({
      action: "billing-reconciliation.run",
      actorId: actor.actorId,
      actorPrincipalId: actor.actorPrincipalId,
      idempotencyKeySha256: null,
      organizationId,
      outcome: "succeeded",
      reasonCode: "operator-reconciliation",
    });
    return report;
  }
}
