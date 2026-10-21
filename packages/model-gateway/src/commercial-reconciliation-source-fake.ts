/* eslint-disable @typescript-eslint/require-await -- deterministic fakes implement asynchronous production ports without I/O. */

import type { CanonicalModelUsageEventV1 } from "./commercial-lifecycle.js";
import type {
  ModelCommercialReconciliationSource,
  ModelCommercialReservationReconciliationRecordV1,
} from "./commercial-reconciliation.js";

export class InMemoryModelCommercialReconciliationSource implements ModelCommercialReconciliationSource {
  #events: readonly CanonicalModelUsageEventV1[];
  #reservations: readonly ModelCommercialReservationReconciliationRecordV1[];

  public constructor(
    input: {
      readonly events?: readonly CanonicalModelUsageEventV1[];
      readonly reservations?: readonly ModelCommercialReservationReconciliationRecordV1[];
    } = {},
  ) {
    this.#events = input.events ?? [];
    this.#reservations = input.reservations ?? [];
  }

  public setEvents(events: readonly CanonicalModelUsageEventV1[]): void {
    this.#events = events;
  }

  public setReservations(
    reservations: readonly ModelCommercialReservationReconciliationRecordV1[],
  ): void {
    this.#reservations = reservations;
  }

  public async listCanonicalUsageEvents(): Promise<
    readonly CanonicalModelUsageEventV1[]
  > {
    return this.#events.map((event) => ({
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
    }));
  }

  public async listCreditReservations(): Promise<
    readonly ModelCommercialReservationReconciliationRecordV1[]
  > {
    return this.#reservations.map((reservation) => ({ ...reservation }));
  }
}
