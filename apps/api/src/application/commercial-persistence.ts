import type { ChargingPolicyScenarioV1 } from "@cloudmarkup/domain";
import type { AuthorizedOrganizationScope } from "./persistence.js";

/**
 * Base-10 integer text at the application/adapter boundary. PostgreSQL BIGINT
 * values are deliberately not coerced through JavaScript number.
 */
export type DecimalIntegerString = string;

export interface TrustedCommercialAccountingContext {
  readonly actorId: string;
  readonly authority: "internal-accounting";
  readonly correlationId: string;
  readonly organizationId: string;
}
export interface TrustedCommercialReservationContext extends TrustedCommercialAccountingContext {
  readonly actingPrincipalId: string;
}

export interface TrustedCommercialAdministrationContext {
  readonly actorId: string;
  readonly actorPrincipalId: string;
  readonly authority: "internal-administration";
  readonly correlationId: string;
  readonly organizationId: string;
}

export type TrustedCommercialMutationContext =
  TrustedCommercialAccountingContext | TrustedCommercialAdministrationContext;

export interface CommercialBillingAccountRecord {
  readonly billingAccountId: string;
  readonly expensiveOperationsEnabled: boolean;
  readonly lifecycleStatus: "active" | "suspended" | "closed";
  readonly organizationId: string;
  readonly recordVersion: DecimalIntegerString;
}

export interface CreateCommercialBillingAccountInput {
  readonly billingAccountId: string;
}
export interface UpdateCommercialBillingAccountInput {
  readonly expectedRecordVersion: DecimalIntegerString;
  readonly expensiveOperationsEnabled: boolean;
  readonly lifecycleStatus: "active" | "suspended" | "closed";
}

export interface CommercialSubscriptionProjectionInput {
  readonly providerEnvironment?: "test" | "live";
  readonly billableSeatQuantity: DecimalIntegerString;
  readonly billingProvider: string;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodEnd?: string;
  readonly currentPeriodId?: string;
  readonly currentPeriodStart?: string;
  readonly effectiveAt: string;
  readonly expectedRecordVersion: DecimalIntegerString;
  readonly lastProviderEventReference?: string;
  readonly normalizedStatus:
    "pending" | "active" | "past-due" | "paused" | "canceled" | "incomplete";
  readonly planVersionId: string;
  readonly providerCustomerReference: string;
  readonly providerEventPosition?: string;
  readonly providerPriceReference?: string;
  readonly providerProductReference?: string;
  readonly providerSubscriptionReference: string;
  readonly subscriptionProjectionId: string;
}

export interface CommercialSubscriptionProjectionRecord extends Omit<
  CommercialSubscriptionProjectionInput,
  "expectedRecordVersion"
> {
  readonly billingAccountId: string;
  readonly organizationId: string;
  readonly recordVersion: DecimalIntegerString;
}

export interface CommercialEntitlementSnapshotInput {
  readonly effectiveAt: string;
  readonly entitlementPolicyVersion: string;
  readonly entitlementSnapshotId: string;
  readonly expensiveOperationsEnabled: boolean;
  readonly expectedRecordVersion: DecimalIntegerString;
  readonly planVersionId: string;
  readonly sourceRecordVersion: DecimalIntegerString;
  readonly subscriptionProjectionId?: string;
}

export interface CommercialEntitlementSnapshotRecord extends Omit<
  CommercialEntitlementSnapshotInput,
  "expectedRecordVersion"
> {
  readonly billingAccountId: string;
  readonly organizationId: string;
  readonly recordVersion: DecimalIntegerString;
}

export type CreditGrantKind =
  "one-time" | "monthly" | "promotional" | "purchased" | "administrative";
export interface ProviderPricingVersionInput {
  readonly cachedInputMicrosPerMillionTokens?: DecimalIntegerString;
  readonly costCurrency: string;
  readonly creditConversionDenominator: DecimalIntegerString;
  readonly creditConversionNumerator: DecimalIntegerString;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly inputMicrosPerMillionTokens: DecimalIntegerString;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly outputMicrosPerMillionTokens: DecimalIntegerString;
  readonly pricingVersionId: string;
  readonly providerKey: string;
}

export interface ProviderPricingVersionRecord extends ProviderPricingVersionInput {
  readonly createdAt: string;
}

export interface CommercialPlanPriceRecord {
  readonly amountMicros: DecimalIntegerString;
  readonly billingInterval: "month";
  readonly currency: string;
  readonly status: "beta-example" | "proposed";
}

export type CreditGrantExpirationPolicyInput =
  | {
      readonly expiresAt: string;
      readonly kind: "expires-at";
      readonly policyVersion: string;
    }
  | {
      readonly kind: "does-not-expire";
      readonly policyVersion: string;
    }
  | {
      readonly kind: "unresolved";
    };

export interface CreditGrantSubscriptionPeriodInput {
  readonly endsAt: string;
  readonly periodId: string;
  readonly startsAt: string;
}

export interface CreateCreditGrantInput {
  readonly chargingPolicyVersion: string;
  readonly consumptionPriority: DecimalIntegerString;
  readonly creditGrantId: string;
  readonly creditUnits: DecimalIntegerString;
  readonly expirationPolicy: CreditGrantExpirationPolicyInput;
  readonly grantKind: CreditGrantKind;
  readonly grantPolicyVersion: string;
  readonly idempotencyKey: string;
  readonly ledgerEntryId: string;
  readonly planVersionId?: string;
  readonly reasonCode: string;
  readonly relatedLedgerEntryId?: string;
  readonly safeReason?: string;
  readonly sourceReference?: string;
  readonly startsAt: string;
  readonly subscriptionPeriod?: CreditGrantSubscriptionPeriodInput;
}

export interface CreditGrantRecord extends Omit<
  CreateCreditGrantInput,
  | "chargingPolicyVersion"
  | "idempotencyKey"
  | "ledgerEntryId"
  | "reasonCode"
  | "relatedLedgerEntryId"
  | "safeReason"
> {
  readonly billingAccountId: string;
  readonly organizationId: string;
}

export interface ReserveCreditsInput {
  readonly chargingPolicyVersion: string;
  readonly entitlementPolicyVersion: string;
  readonly expiresAt: string;
  readonly featureKey: string;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly planVersionId: string;
  readonly pricingVersionId: string;
  readonly projectId: string;
  readonly providerKey: string;
  readonly requestId: string;
  readonly requestSha256: string;
  readonly requestedCreditUnits: DecimalIntegerString;
  readonly reservationId: string;
}

export interface CreditReservationAllocationRecord {
  readonly allocationSequence: DecimalIntegerString;
  readonly creditGrantId: string;
  readonly reservedCreditUnits: DecimalIntegerString;
  readonly settledCreditUnits: DecimalIntegerString;
}

export interface CreditReservationRecord {
  readonly actingPrincipalId: string;
  readonly allocations: readonly CreditReservationAllocationRecord[];
  readonly billingAccountId: string;
  readonly createdAt: string;
  readonly chargingPolicyVersion: string;
  readonly entitlementPolicyVersion: string;
  readonly entitlementSnapshotId: string;
  readonly expiresAt: string;
  readonly featureKey: string;
  readonly jobId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly organizationId: string;
  readonly planVersionId: string;
  readonly pricingVersionId: string;
  readonly projectId: string;
  readonly providerKey: string;
  readonly recordVersion: DecimalIntegerString;
  readonly requestId: string;
  readonly requestedCreditUnits: DecimalIntegerString;
  readonly reservationId: string;
  readonly reservedCreditUnits: DecimalIntegerString;
  readonly status: "active" | "settled" | "released" | "expired";
  readonly terminalAt?: string;
  readonly terminalLedgerEntryId?: string;
}

/** The model-only scenario is admitted exclusively by the terminal evidence
 * bridge, never by the legacy public settlement input. */
export type ChargingScenario =
  | ChargingPolicyScenarioV1
  | "model-preview-delivered-v1"
  | "model-evaluation-recorded-v2";

export interface ProviderUsageMetricsInput {
  readonly cachedInputTokenCount?: DecimalIntegerString;
  readonly estimatedProviderCostMicros?: DecimalIntegerString;
  readonly inputTokenCount?: DecimalIntegerString;
  readonly latencyMilliseconds?: DecimalIntegerString;
  readonly modelId?: string;
  readonly modelVersion?: string;
  readonly outputTokenCount?: DecimalIntegerString;
  readonly providerKey?: string;
  readonly providerCostCurrency?: string;
  readonly providerRequestId?: string;
}

export interface SettleCreditReservationInput extends ProviderUsageMetricsInput {
  readonly actualNormalizedCreditUnits: DecimalIntegerString;
  readonly chargingScenario:
    | "proposal-delivered-user-rejected"
    | "system-required-repair"
    | "beta-ai-output-delivered-v1";
  readonly chargingPolicyVersion: string;
  readonly customerChargeCreditUnits: DecimalIntegerString;
  readonly idempotencyKey: string;
  readonly ledgerEntryId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly pricingVersionId: string;
  readonly providerKey: string;
  readonly reasonCode: string;
  readonly requestId: string;
  readonly requestSha256: string;
  readonly reservationId: string;
}

export interface ReleaseCreditReservationInput extends ProviderUsageMetricsInput {
  readonly chargingScenario:
    | "user-cancelled-before-invocation"
    | "provider-failure-before-useful-output"
    | "cloudmarkup-internal-failure";
  readonly chargingPolicyVersion: string;
  readonly idempotencyKey: string;
  readonly ledgerEntryId: string;
  readonly pricingVersionId?: string;
  readonly reasonCode: string;
  readonly requestId: string;
  readonly requestSha256: string;
  readonly reservationId: string;
  readonly safeReason?: string;
}

export interface ExpireCreditReservationInput {
  readonly chargingPolicyVersion: string;
  readonly idempotencyKey: string;
  readonly ledgerEntryId: string;
  readonly requestSha256: string;
  readonly reservationId: string;
}

export interface AppendCreditAdjustmentInput {
  /** Optional exact grant for a bounded debit; positive adjustments cannot select it. */
  readonly creditGrantId?: string;
  readonly adjustmentCreditUnits: DecimalIntegerString;
  readonly chargingPolicyVersion: string;
  readonly idempotencyKey: string;
  readonly ledgerEntryId: string;
  readonly reasonCode: string;
  readonly relatedLedgerEntryId: string;
  readonly safeReason: string;
}

export interface CreditBalanceRecord {
  readonly asOf: string;
  readonly activeGrantedCreditUnits: DecimalIntegerString;
  readonly availableCreditUnits: DecimalIntegerString;
  readonly compensatedCreditUnits: DecimalIntegerString;
  readonly debitAdjustmentCreditUnits: DecimalIntegerString;
  readonly netAdjustmentCreditUnits: DecimalIntegerString;
  readonly exhausted: boolean;
  readonly expiredCreditUnits: DecimalIntegerString;
  readonly ledgerThroughEventId?: string;
  readonly organizationId: string;
  readonly reservedCreditUnits: DecimalIntegerString;
  readonly settledCreditUnits: DecimalIntegerString;
  readonly totalGrantedCreditUnits: DecimalIntegerString;
  readonly unresolvedCreditUnits: DecimalIntegerString;
}

export interface CreditOverviewRecord {
  readonly balance: CreditBalanceRecord;
  readonly availableByKind: {
    readonly monthly: DecimalIntegerString;
    readonly purchased: DecimalIntegerString;
    readonly other: DecimalIntegerString;
  };
  readonly nextExpiration: {
    readonly at: string;
    readonly creditUnits: DecimalIntegerString;
  } | null;
}

export interface UsageLedgerAllocationRecord {
  readonly allocationSequence: DecimalIntegerString;
  readonly creditAdjustmentUnits: DecimalIntegerString;
  readonly creditGrantId: string;
  readonly expiredCreditUnits: DecimalIntegerString;
  readonly releasedCreditUnits: DecimalIntegerString;
  readonly reservedCreditUnits: DecimalIntegerString;
  readonly settledCreditUnits: DecimalIntegerString;
}

export interface UsageLedgerEntryRecord extends ProviderUsageMetricsInput {
  readonly actingPrincipalId?: string;
  readonly allocations?: readonly UsageLedgerAllocationRecord[];
  readonly chargingScenario:
    ChargingScenario | "beta-ai-output-delivered-v1" | null;
  readonly chargingPolicyVersion: string;
  readonly creditAdjustmentUnits: DecimalIntegerString;
  readonly creditGrantId?: string;
  readonly entryKind:
    | "grant"
    | "reservation"
    | "settlement"
    | "release"
    | "expiration"
    | "provider-failure"
    | "adjustment";
  readonly entitlementPolicyVersion?: string;
  readonly expiredCreditUnits: DecimalIntegerString;
  readonly featureKey?: string;
  readonly grantedCreditUnits: DecimalIntegerString;
  readonly idempotencyKeySha256: string;
  readonly jobId?: string;
  readonly ledgerEntryId: string;
  readonly normalizedCreditUnits?: DecimalIntegerString;
  readonly occurredAt: string;
  readonly organizationId: string;
  readonly outcome:
    | "granted"
    | "reserved"
    | "useful-output-delivered"
    | "no-useful-output"
    | "released"
    | "expired"
    | "provider-failure"
    | "internal-failure"
    | "canceled"
    | "adjusted"
    | "compensated";
  readonly planVersionId?: string;
  readonly pricingVersionId?: string;
  readonly projectId?: string;
  readonly reasonCode: string;
  readonly safeReason?: string;
  readonly recordedByActorId: string;
  readonly recordedByActorKind:
    "principal" | "internal-accounting" | "internal-administration";
  readonly relatedLedgerEntryId?: string;
  readonly releasedCreditUnits: DecimalIntegerString;
  readonly requestId?: string;
  readonly reservationId?: string;
  readonly reservedCreditUnits: DecimalIntegerString;
  readonly settledCreditUnits: DecimalIntegerString;
}

export interface UsageCreditTotalsRecord {
  readonly compensatedCreditUnits: DecimalIntegerString;
  readonly debitAdjustmentCreditUnits: DecimalIntegerString;
  readonly expiredReservationCreditUnits: DecimalIntegerString;
  readonly netAdjustmentCreditUnits: DecimalIntegerString;
  readonly releasedCreditUnits: DecimalIntegerString;
  readonly reservedCreditUnits: DecimalIntegerString;
  readonly settledCreditUnits: DecimalIntegerString;
}

export interface FeatureUsageSummaryRecord {
  readonly creditTotals: UsageCreditTotalsRecord;
  readonly feature: string;
  readonly requestCount: DecimalIntegerString;
}

export interface UsageSummaryRecord {
  readonly asOf: string;
  readonly byFeature: readonly FeatureUsageSummaryRecord[];
  readonly creditTotals: UsageCreditTotalsRecord;
  readonly customerCompensatedEventCount: DecimalIntegerString;
  readonly eventCount: DecimalIntegerString;
  readonly organizationId: string;
  readonly periodEndsAt: string;
  readonly periodStartsAt: string;
  readonly providerReportedEventCount: DecimalIntegerString;
  readonly requestCount: DecimalIntegerString;
}

export interface SeatUsageRecord {
  readonly asOf: string;
  readonly activeMembersByRole: Readonly<{
    readonly administrator: DecimalIntegerString;
    readonly editor: DecimalIntegerString;
    readonly owner: DecimalIntegerString;
    readonly viewer: DecimalIntegerString;
  }>;
  readonly billableCandidateRoles: readonly (
    "owner" | "administrator" | "editor"
  )[];
  readonly billableSeatLimit: DecimalIntegerString;
  readonly billableSeatQuantity: DecimalIntegerString;
  readonly includedBillableSeatQuantity: DecimalIntegerString;
  readonly organizationId: string;
  readonly overBillableSeatLimit: boolean;
  readonly pendingInvitationQuantityExcluded: DecimalIntegerString;
  readonly planVersionId: string;
  readonly viewerLimit: DecimalIntegerString;
  readonly viewerQuantity: DecimalIntegerString;
}

export interface CurrentPlanEntitlementRecord {
  readonly enabled: boolean;
  readonly feature: string;
  readonly source:
    "plan" | "subscription" | "promotion" | "administrative" | "kill-switch";
}

export interface CurrentPlanLimitRecord {
  readonly key: string;
  readonly maximum: DecimalIntegerString;
  readonly period:
    "none" | "subscription-period" | "calendar-month" | "rolling-day";
  readonly scope: "organization" | "member" | "project";
  readonly unit: "count" | "credits" | "jobs" | "requests" | "seats";
}

export interface CurrentPlanEntitlementsRecord {
  readonly trial?: {
    readonly id: string;
    readonly expiresAt: string;
    readonly state: "active" | "expired" | "revoked";
  };
  readonly asOf: string;
  readonly billingAccountState: "active" | "suspended" | "closed";
  readonly entitlements: readonly CurrentPlanEntitlementRecord[];
  readonly expensiveOperationsEnabled: boolean;
  readonly limits: readonly CurrentPlanLimitRecord[];
  readonly organizationId: string;
  readonly organizationState: "active" | "suspended";
  readonly plan: Readonly<{
    readonly commercialStatus: "proposed";
    readonly displayName: string;
    readonly effectiveFrom: string;
    readonly effectiveUntil?: string;
    readonly id: string;
    readonly key: string;
    readonly price: CommercialPlanPriceRecord;
    readonly version: DecimalIntegerString;
    readonly versionId: string;
  }>;
  readonly subscription:
    | Readonly<{ readonly state: "not-subscribed" }>
    | Readonly<{
        readonly cancelAtPeriodEnd: boolean;
        readonly currentPeriodEndsAt?: string;
        readonly currentPeriodStartsAt?: string;
        readonly projectionVersion: DecimalIntegerString;
        readonly state:
          | "pending"
          | "active"
          | "past-due"
          | "paused"
          | "canceled"
          | "incomplete";
      }>;
}

export interface CreditGrantSummaryRecord {
  readonly availableCreditUnits: DecimalIntegerString;
  readonly adjustmentCreditUnits: DecimalIntegerString;
  readonly consumedCreditUnits: DecimalIntegerString;
  readonly consumptionPriority: DecimalIntegerString;
  readonly expirationPolicy: "fixed" | "none" | "undecided";
  readonly expirationPolicyVersion?: string;
  readonly expiresAt?: string;
  readonly expiredCreditUnits: DecimalIntegerString;
  readonly fundingCreditUnits: DecimalIntegerString;
  readonly grantPolicyVersion: string;
  readonly grantedCreditUnits: DecimalIntegerString;
  readonly id: string;
  readonly kind: CreditGrantKind;
  readonly planVersionId?: string;
  readonly reservedCreditUnits: DecimalIntegerString;
  readonly startsAt: string;
  readonly status: "scheduled" | "active" | "exhausted" | "expired";
}

export interface CreditGrantExpirationSummaryRecord {
  readonly asOf: string;
  readonly expiringCreditUnits: DecimalIntegerString;
  readonly grants: readonly CreditGrantSummaryRecord[];
  readonly nextExpirationAt?: string;
  readonly organizationId: string;
  readonly windowEndsAt: string;
}

export interface CommercialPersistenceRepository {
  appendCompensatingAdjustment(
    context: TrustedCommercialAdministrationContext,
    input: AppendCreditAdjustmentInput,
  ): Promise<UsageLedgerEntryRecord>;
  createBillingAccount(
    context: TrustedCommercialAdministrationContext,
    input: CreateCommercialBillingAccountInput,
  ): Promise<CommercialBillingAccountRecord>;
  createProviderPricingVersion(
    context: TrustedCommercialAdministrationContext,
    input: ProviderPricingVersionInput,
  ): Promise<ProviderPricingVersionRecord>;
  createCreditGrant(
    context: TrustedCommercialMutationContext,
    input: CreateCreditGrantInput,
  ): Promise<CreditGrantRecord>;
  expireReservation(
    context: TrustedCommercialAccountingContext,
    input: ExpireCreditReservationInput,
  ): Promise<CreditReservationRecord>;
  getCreditBalance(
    scope: AuthorizedOrganizationScope,
  ): Promise<CreditBalanceRecord>;
  getCreditGrantExpirationSummary(
    scope: AuthorizedOrganizationScope,
    windowEndsAt: string,
  ): Promise<CreditGrantExpirationSummaryRecord>;
  getCurrentPlanEntitlements(
    scope: AuthorizedOrganizationScope,
  ): Promise<CurrentPlanEntitlementsRecord>;
  getProviderPricingVersion(
    context: TrustedCommercialAdministrationContext,
    pricingVersionId: string,
  ): Promise<ProviderPricingVersionRecord | null>;
  getSeatUsage(scope: AuthorizedOrganizationScope): Promise<SeatUsageRecord>;
  getUsageEntry(
    scope: AuthorizedOrganizationScope,
    ledgerEntryId: string,
  ): Promise<UsageLedgerEntryRecord | null>;
  getUsageSummary(
    scope: AuthorizedOrganizationScope,
    from: string,
    until: string,
  ): Promise<UsageSummaryRecord>;
  releaseReservation(
    context: TrustedCommercialAccountingContext,
    input: ReleaseCreditReservationInput,
  ): Promise<CreditReservationRecord>;
  reserveCredits(
    context: AuthorizedOrganizationScope | TrustedCommercialReservationContext,
    input: ReserveCreditsInput,
  ): Promise<CreditReservationRecord>;
  settleReservation(
    context: TrustedCommercialAccountingContext,
    input: SettleCreditReservationInput,
  ): Promise<CreditReservationRecord>;
  updateBillingAccount(
    context: TrustedCommercialAdministrationContext,
    input: UpdateCommercialBillingAccountInput,
  ): Promise<CommercialBillingAccountRecord>;
  updateEntitlementSnapshot(
    context: TrustedCommercialMutationContext,
    input: CommercialEntitlementSnapshotInput,
  ): Promise<CommercialEntitlementSnapshotRecord>;
  updateSubscriptionProjection(
    context: TrustedCommercialMutationContext,
    input: CommercialSubscriptionProjectionInput,
  ): Promise<CommercialSubscriptionProjectionRecord>;
}

export type CommercialPersistenceErrorCode =
  | "access-denied"
  | "entitlement-denied"
  | "idempotency-conflict"
  | "insufficient-credits"
  | "invalid-input"
  | "not-found"
  | "reservation-terminal"
  | "version-conflict";

export class CommercialPersistenceError extends Error {
  readonly code: CommercialPersistenceErrorCode;

  constructor(code: CommercialPersistenceErrorCode, safeMessage: string) {
    super(safeMessage);
    this.code = code;
    this.name = "CommercialPersistenceError";
  }
}
