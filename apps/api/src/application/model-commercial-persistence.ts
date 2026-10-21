import type {
  TrustedCommercialAccountingContext,
  TrustedCommercialAdministrationContext,
  DecimalIntegerString,
} from "./commercial-persistence.js";
import type { AuthorizedOrganizationScope } from "./persistence.js";

export type ModelCommercialEnvironment =
  "development" | "test" | "staging" | "production";

export interface ModelProviderSpecificUnitRateInput {
  readonly microsPerMillionUnits: DecimalIntegerString;
  readonly unitName: string;
}

export interface CreateModelProviderPricingVersionInput {
  readonly cacheReadMicrosPerMillionUnits?: DecimalIntegerString;
  readonly cacheWriteMicrosPerMillionUnits?: DecimalIntegerString;
  readonly costCurrency: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly environment: ModelCommercialEnvironment;
  readonly inferenceProfileId?: string;
  readonly inputMicrosPerMillionUnits: DecimalIntegerString;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly outputMicrosPerMillionUnits: DecimalIntegerString;
  readonly pricingVersionId: string;
  readonly providerKey: string;
  readonly providerSpecificUnitRates: readonly ModelProviderSpecificUnitRateInput[];
  readonly status: "enabled" | "disabled-pricing-unavailable";
}

export interface ModelProviderPricingVersionRecord extends CreateModelProviderPricingVersionInput {
  readonly createdAt: string;
}

export interface CreateCreditNormalizationPolicyVersionInput {
  readonly costCurrency: string;
  readonly creditUnitMicros: DecimalIntegerString;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly normalizationPolicyVersionId: string;
  readonly operatingBufferBasisPoints: DecimalIntegerString;
  readonly status: "enabled" | "disabled";
}

export interface CreditNormalizationPolicyVersionRecord extends CreateCreditNormalizationPolicyVersionInput {
  readonly createdAt: string;
}

export interface ModelProviderSpecificUsageUnitInput {
  readonly unitName: string;
  readonly units: DecimalIntegerString;
}

export interface ModelUsageAttemptPersistenceInput {
  readonly attemptId: string;
  readonly attemptKind:
    "primary" | "automatic-retry" | "system-escalation" | "repair";
  readonly attemptNumber: DecimalIntegerString;
  readonly callId: string;
  readonly completedAt: string;
  readonly estimatedProviderCostMicros: DecimalIntegerString;
  readonly failureCategory?: string;
  readonly inferenceProfileId?: string;
  readonly invocationId: string;
  readonly latencyMilliseconds: DecimalIntegerString;
  readonly mayHaveBeenProcessed: boolean;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly normalizationPolicyVersionId: string;
  readonly pricingVersionId: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly providerKey: string;
  readonly providerRequestId?: string;
  readonly retryOfAttemptId?: string;
  readonly routeId: string;
  readonly startedAt: string;
  readonly status:
    | "succeeded"
    | "provider-failure"
    | "timed-out"
    | "cancelled"
    | "internal-failure";
  readonly usage: ModelUsageUnitsPersistenceInput;
  readonly usageRecordId: string;
}

export interface ModelUsageUnitsPersistenceInput {
  readonly cacheReadUnits: DecimalIntegerString;
  readonly cacheWriteUnits: DecimalIntegerString;
  readonly inputUnits: DecimalIntegerString;
  readonly outputUnits: DecimalIntegerString;
  readonly providerSpecificUnits: readonly ModelProviderSpecificUsageUnitInput[];
  readonly totalUnits: DecimalIntegerString;
}

export interface AppendModelUsageEventDetailInput extends ModelUsageUnitsPersistenceInput {
  readonly attempts: readonly ModelUsageAttemptPersistenceInput[];
  readonly chargedCreditUnits: DecimalIntegerString;
  readonly compensatedCreditUnits: DecimalIntegerString;
  readonly completedAt?: string;
  readonly environment: ModelCommercialEnvironment;
  readonly estimatedProviderCostMicros: DecimalIntegerString;
  readonly failureCategory?: string;
  readonly inferenceProfileId?: string;
  readonly ledgerEntryId: string;
  readonly modelUsageEventId: string;
  readonly modelUsageIdempotencyKeySha256: string;
  readonly modelRoute: "standard" | "deep";
  readonly modelRouteId: string;
  readonly multiCallWorkflowId: string;
  readonly normalizationPolicyVersionId: string;
  readonly occurredAt: string;
  readonly pricingVersionId: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly reconciliationState:
    | "not-required"
    | "pending-missing-usage"
    | "pending-settlement"
    | "reconciled";
  readonly reservedCreditUnits: DecimalIntegerString;
  readonly startedAt?: string;
  readonly status:
    | "reserved"
    | "completed"
    | "released"
    | "provider-failure"
    | "cancelled"
    | "internal-failure"
    | "reconciliation-required"
    | "compensated";
  readonly templateId?: string;
  readonly templateVersion?: string;
}

export interface ModelUsageEventDetailRecord extends AppendModelUsageEventDetailInput {
  readonly featureKey: string;
  readonly jobId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly providerKey: string;
  readonly requestId: string;
  readonly reservationId: string;
  readonly userId: string;
}

export interface ModelCommercialReconciliationCandidateRecord {
  readonly expiresAt?: string;
  readonly ledgerEntryId?: string;
  readonly multiCallWorkflowId: string;
  readonly organizationId: string;
  readonly reconciliationState:
    "pending-missing-usage" | "pending-settlement" | "expired-open";
  readonly reservationId: string;
}

export interface ModelCommercialPersistenceRepository {
  appendUsageEventDetail(
    context: TrustedCommercialAccountingContext,
    input: AppendModelUsageEventDetailInput,
  ): Promise<ModelUsageEventDetailRecord>;
  createCreditNormalizationPolicyVersion(
    context: TrustedCommercialAdministrationContext,
    input: CreateCreditNormalizationPolicyVersionInput,
  ): Promise<CreditNormalizationPolicyVersionRecord>;
  createModelProviderPricingVersion(
    context: TrustedCommercialAdministrationContext,
    input: CreateModelProviderPricingVersionInput,
  ): Promise<ModelProviderPricingVersionRecord>;
  getCreditNormalizationPolicyVersion(
    context: TrustedCommercialAccountingContext,
    normalizationPolicyVersionId: string,
  ): Promise<CreditNormalizationPolicyVersionRecord | null>;
  getModelProviderPricingVersion(
    context: TrustedCommercialAccountingContext,
    pricingVersionId: string,
  ): Promise<ModelProviderPricingVersionRecord | null>;
  getUsageEventDetail(
    scope: AuthorizedOrganizationScope,
    modelUsageEventId: string,
  ): Promise<ModelUsageEventDetailRecord | null>;
  listReconciliationCandidates(
    context: TrustedCommercialAccountingContext,
    asOf: string,
  ): Promise<readonly ModelCommercialReconciliationCandidateRecord[]>;
}
