import type {
  CanonicalModelUsageEventV1,
  ModelCommercialRouteKindV1,
  ModelUsageReconciliationStateV1,
} from "./commercial-lifecycle.js";

export interface ModelCommercialReservationReconciliationRecordV1 {
  readonly expiresAt: string;
  readonly multiCallWorkflowId: string;
  readonly organizationId: string;
  readonly reservationId: string;
  readonly reservedCreditUnits: number;
  readonly status: "active" | "settled" | "released" | "expired";
}

export interface ProviderCostAggregateReconciliationInputV1 {
  readonly currencyCode: string;
  readonly periodEndsAt: string;
  readonly periodStartsAt: string;
  readonly providerKey: string;
  readonly providerReportedCostMicros: number;
}

export interface ProviderCostAggregateReconciliationResultV1 {
  readonly currencyCode: string;
  readonly differenceMicros: number;
  readonly estimatedLedgerCostMicros: number;
  readonly eventCount: number;
  readonly organizationCount: number;
  readonly providerKey: string;
  readonly providerReportedCostMicros: number;
  readonly state: "matched" | "difference-detected";
}

export interface MissingModelUsageFindingV1 {
  readonly eventId: string;
  readonly multiCallWorkflowId: string;
  readonly organizationId: string;
  readonly reservationId: string;
  readonly state: Extract<
    ModelUsageReconciliationStateV1,
    "pending-missing-usage"
  >;
}

export interface OpenModelReservationFindingV1 {
  readonly expiresAt: string;
  readonly multiCallWorkflowId: string;
  readonly organizationId: string;
  readonly reservationId: string;
  readonly reservedCreditUnits: number;
  readonly state: "open" | "expired-open";
}

export interface ModelUsageOutlierFindingV1 {
  readonly eventId: string;
  readonly estimatedProviderCostMicros: number;
  readonly latencyMilliseconds: number;
  readonly multiCallWorkflowId: string;
  readonly organizationId: string;
  readonly reasons: readonly (
    "provider-cost" | "latency" | "credit-estimate-overrun"
  )[];
}

export type ModelUsageReportDimensionV1 =
  "route" | "provider" | "model" | "feature" | "environment";

export interface ModelUsageReportRowV1 {
  readonly chargedCreditUnits: number;
  readonly compensatedCreditUnits: number;
  readonly estimatedProviderCostMicros: number;
  readonly eventCount: number;
  readonly feature: string;
  readonly modelId: string;
  readonly providerKey: string;
  readonly route: ModelCommercialRouteKindV1;
  readonly environment: string;
}

export interface CustomerCreditCompensationReconciliationV1 {
  readonly compensatedCreditUnits: number;
  readonly compensatedEventCount: number;
  readonly pendingEventCount: number;
  readonly state: "reconciled" | "pending";
}

export interface ModelCommercialReconciliationPort {
  reconcileProviderCostAggregate(
    input: ProviderCostAggregateReconciliationInputV1,
  ): Promise<ProviderCostAggregateReconciliationResultV1>;
  findMissingUsage(input: {
    readonly organizationId?: string;
  }): Promise<readonly MissingModelUsageFindingV1[]>;
  findOpenReservations(input: {
    readonly asOf: string;
    readonly organizationId?: string;
  }): Promise<readonly OpenModelReservationFindingV1[]>;
  findOutliers(input: {
    readonly maximumEstimatedProviderCostMicros: number;
    readonly maximumLatencyMilliseconds: number;
    readonly organizationId?: string;
  }): Promise<readonly ModelUsageOutlierFindingV1[]>;
  reportUsage(input: {
    readonly dimensions: readonly ModelUsageReportDimensionV1[];
    readonly organizationId?: string;
    readonly periodEndsAt: string;
    readonly periodStartsAt: string;
  }): Promise<readonly ModelUsageReportRowV1[]>;
  reconcileCustomerCreditCompensation(input: {
    readonly organizationId?: string;
  }): Promise<CustomerCreditCompensationReconciliationV1>;
}

export interface ModelCommercialReconciliationSource {
  listCanonicalUsageEvents(): Promise<readonly CanonicalModelUsageEventV1[]>;
  listCreditReservations(): Promise<
    readonly ModelCommercialReservationReconciliationRecordV1[]
  >;
}
