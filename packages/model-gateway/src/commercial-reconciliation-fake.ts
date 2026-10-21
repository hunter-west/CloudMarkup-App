import type { CanonicalModelUsageEventV1 } from "./commercial-lifecycle.js";
import type {
  CustomerCreditCompensationReconciliationV1,
  MissingModelUsageFindingV1,
  ModelCommercialReconciliationPort,
  ModelCommercialReconciliationSource,
  ModelUsageOutlierFindingV1,
  ModelUsageReportRowV1,
  OpenModelReservationFindingV1,
  ProviderCostAggregateReconciliationInputV1,
  ProviderCostAggregateReconciliationResultV1,
} from "./commercial-reconciliation.js";

function inPeriod(
  event: CanonicalModelUsageEventV1,
  from: string,
  until: string,
): boolean {
  const occurredAt = Date.parse(event.occurredAt);
  return occurredAt >= Date.parse(from) && occurredAt < Date.parse(until);
}

function checkedTotal(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) {
    throw new Error("Reconciliation total exceeds the safe integer range.");
  }
  return total;
}

export class InMemoryModelCommercialReconciliation implements ModelCommercialReconciliationPort {
  readonly #source: ModelCommercialReconciliationSource;

  public constructor(source: ModelCommercialReconciliationSource) {
    this.#source = source;
  }

  public async reconcileProviderCostAggregate(
    input: ProviderCostAggregateReconciliationInputV1,
  ): Promise<ProviderCostAggregateReconciliationResultV1> {
    const events = (await this.#source.listCanonicalUsageEvents()).filter(
      (event) =>
        event.providerKey === input.providerKey &&
        inPeriod(event, input.periodStartsAt, input.periodEndsAt) &&
        event.status !== "reserved",
    );
    const estimatedLedgerCostMicros = checkedTotal(
      events.map((event) => event.estimatedProviderCostMicros),
    );
    const differenceMicros =
      input.providerReportedCostMicros - estimatedLedgerCostMicros;
    return {
      currencyCode: input.currencyCode,
      differenceMicros,
      estimatedLedgerCostMicros,
      eventCount: events.length,
      organizationCount: new Set(events.map((event) => event.organizationId))
        .size,
      providerKey: input.providerKey,
      providerReportedCostMicros: input.providerReportedCostMicros,
      state: differenceMicros === 0 ? "matched" : "difference-detected",
    };
  }

  public async findMissingUsage(input: {
    readonly organizationId?: string;
  }): Promise<readonly MissingModelUsageFindingV1[]> {
    return (await this.#source.listCanonicalUsageEvents())
      .filter(
        (event) =>
          event.reconciliationState === "pending-missing-usage" &&
          (input.organizationId === undefined ||
            event.organizationId === input.organizationId),
      )
      .map((event) => ({
        eventId: event.eventId,
        multiCallWorkflowId: event.multiCallWorkflowId,
        organizationId: event.organizationId,
        reservationId: event.reservationId,
        state: "pending-missing-usage",
      }));
  }

  public async findOpenReservations(input: {
    readonly asOf: string;
    readonly organizationId?: string;
  }): Promise<readonly OpenModelReservationFindingV1[]> {
    const asOf = Date.parse(input.asOf);
    return (await this.#source.listCreditReservations())
      .filter(
        (reservation) =>
          reservation.status === "active" &&
          (input.organizationId === undefined ||
            reservation.organizationId === input.organizationId),
      )
      .map((reservation) => ({
        expiresAt: reservation.expiresAt,
        multiCallWorkflowId: reservation.multiCallWorkflowId,
        organizationId: reservation.organizationId,
        reservationId: reservation.reservationId,
        reservedCreditUnits: reservation.reservedCreditUnits,
        state:
          Date.parse(reservation.expiresAt) <= asOf ? "expired-open" : "open",
      }));
  }

  public async findOutliers(input: {
    readonly maximumEstimatedProviderCostMicros: number;
    readonly maximumLatencyMilliseconds: number;
    readonly organizationId?: string;
  }): Promise<readonly ModelUsageOutlierFindingV1[]> {
    const findings: ModelUsageOutlierFindingV1[] = [];
    for (const event of await this.#source.listCanonicalUsageEvents()) {
      if (
        event.status === "reserved" ||
        (input.organizationId !== undefined &&
          event.organizationId !== input.organizationId)
      ) {
        continue;
      }
      const reasons: ModelUsageOutlierFindingV1["reasons"][number][] = [];
      if (
        event.estimatedProviderCostMicros >
        input.maximumEstimatedProviderCostMicros
      ) {
        reasons.push("provider-cost");
      }
      if (event.latencyMilliseconds > input.maximumLatencyMilliseconds) {
        reasons.push("latency");
      }
      if (event.failureCategory === "estimate-overrun") {
        reasons.push("credit-estimate-overrun");
      }
      if (reasons.length > 0) {
        findings.push({
          eventId: event.eventId,
          estimatedProviderCostMicros: event.estimatedProviderCostMicros,
          latencyMilliseconds: event.latencyMilliseconds,
          multiCallWorkflowId: event.multiCallWorkflowId,
          organizationId: event.organizationId,
          reasons,
        });
      }
    }
    return findings;
  }

  public async reportUsage(input: {
    readonly dimensions: readonly (
      "route" | "provider" | "model" | "feature" | "environment"
    )[];
    readonly organizationId?: string;
    readonly periodEndsAt: string;
    readonly periodStartsAt: string;
  }): Promise<readonly ModelUsageReportRowV1[]> {
    const requested = new Set(input.dimensions);
    const rows = new Map<string, ModelUsageReportRowV1>();
    for (const event of await this.#source.listCanonicalUsageEvents()) {
      if (
        event.status === "reserved" ||
        !inPeriod(event, input.periodStartsAt, input.periodEndsAt) ||
        (input.organizationId !== undefined &&
          event.organizationId !== input.organizationId)
      ) {
        continue;
      }
      const row: ModelUsageReportRowV1 = {
        chargedCreditUnits: event.chargedCreditUnits,
        compensatedCreditUnits: event.compensatedCreditUnits,
        environment: event.environment,
        estimatedProviderCostMicros: event.estimatedProviderCostMicros,
        eventCount: 1,
        feature: event.feature,
        modelId: event.modelId,
        providerKey: event.providerKey,
        route: event.route,
      };
      const key = JSON.stringify([
        requested.has("route") ? row.route : "*",
        requested.has("provider") ? row.providerKey : "*",
        requested.has("model") ? row.modelId : "*",
        requested.has("feature") ? row.feature : "*",
        requested.has("environment") ? row.environment : "*",
      ]);
      const existing = rows.get(key);
      if (existing === undefined) {
        rows.set(key, row);
      } else {
        rows.set(key, {
          ...existing,
          chargedCreditUnits: checkedTotal([
            existing.chargedCreditUnits,
            row.chargedCreditUnits,
          ]),
          compensatedCreditUnits: checkedTotal([
            existing.compensatedCreditUnits,
            row.compensatedCreditUnits,
          ]),
          estimatedProviderCostMicros: checkedTotal([
            existing.estimatedProviderCostMicros,
            row.estimatedProviderCostMicros,
          ]),
          eventCount: existing.eventCount + 1,
        });
      }
    }
    return [...rows.values()];
  }

  public async reconcileCustomerCreditCompensation(input: {
    readonly organizationId?: string;
  }): Promise<CustomerCreditCompensationReconciliationV1> {
    const compensated = (await this.#source.listCanonicalUsageEvents()).filter(
      (event) =>
        event.compensatedCreditUnits > 0 &&
        (input.organizationId === undefined ||
          event.organizationId === input.organizationId),
    );
    const pendingEventCount = compensated.filter(
      (event) =>
        event.reconciliationState !== "not-required" &&
        event.reconciliationState !== "reconciled",
    ).length;
    return {
      compensatedCreditUnits: checkedTotal(
        compensated.map((event) => event.compensatedCreditUnits),
      ),
      compensatedEventCount: compensated.length,
      pendingEventCount,
      state: pendingEventCount === 0 ? "reconciled" : "pending",
    };
  }
}
