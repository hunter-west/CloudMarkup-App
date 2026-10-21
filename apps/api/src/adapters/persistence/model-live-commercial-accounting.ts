import type {
  ModelCommercialAccountingPort,
  ModelLiveCommercialTerminalRecoveryPortV2,
} from "@cloudmarkup/model-gateway";
import {
  createModelLiveAccountingEngine,
  type ModelLiveAccountingOptions,
} from "./model-live-commercial-reservations.js";

/** Explicit V2 canonical accounting. Actual immutable case validation receipts
 * settle recorded evaluations; quality failure never activates a model.
 * Known journal failures and original no-dispatch expiry proofs can release.
 * Completed known usage without validation compensates after canonical expiry.
 * Unknown usage retains its hold. */
export class PostgresModelLiveCommercialAccounting
  implements
    ModelCommercialAccountingPort,
    ModelLiveCommercialTerminalRecoveryPortV2
{
  readonly #engine;
  constructor(input: ModelLiveAccountingOptions) {
    this.#engine = createModelLiveAccountingEngine(input);
  }
  reserve(input: Parameters<ModelCommercialAccountingPort["reserve"]>[0]) {
    return this.#engine.reserve(input);
  }
  recoverExistingReservation(
    input: Parameters<
      ModelCommercialAccountingPort["recoverExistingReservation"]
    >[0],
  ) {
    return this.#engine.recoverExistingReservation(input);
  }
  settle(input: Parameters<ModelCommercialAccountingPort["settle"]>[0]) {
    return this.#engine.settle(input);
  }
  release(input: Parameters<ModelCommercialAccountingPort["release"]>[0]) {
    return this.#engine.release(input);
  }
  markReconciliationRequired(
    input: Parameters<
      ModelCommercialAccountingPort["markReconciliationRequired"]
    >[0],
  ) {
    return this.#engine.markReconciliationRequired(input);
  }
  recoverVerified(
    input: Parameters<
      ModelLiveCommercialTerminalRecoveryPortV2["recoverVerified"]
    >[0],
  ) {
    return this.#engine.recoverLiveVerified(input);
  }
  /** Existing canonical terminal verification without settlement/release or
   * reconciliation writes. Missing terminal metadata remains unavailable. */
  readVerified(
    input: Parameters<
      ModelLiveCommercialTerminalRecoveryPortV2["recoverVerified"]
    >[0],
  ) {
    return this.#engine.readLiveVerified(input);
  }
}
