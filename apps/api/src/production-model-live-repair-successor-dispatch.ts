import type { PostgresModelLiveSequences } from "./adapters/persistence/model-live-sequences.js";
import type { ModelLiveBedrockHostConfigurationV2 } from "./adapters/persistence/model-live-runtime-host-evidence-codec.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import {
  dispatchProductionRepairV4,
  type RepairDispatchTransport,
} from "./production-model-live-repair-dispatch.js";
type FirstJournal = Awaited<
  ReturnType<PostgresModelLiveSequences["createSeedDispatchJournalV4"]>
>;
type Journal = Awaited<
  ReturnType<FirstJournal["createSuccessorDispatchJournal"]>
>;
export class ProductionFinalRepairDispatchError extends Error {
  readonly code = "model-live.final-repair-dispatch-unavailable";
  constructor() {
    super("The final repair dispatch is unavailable.");
    this.name = "ProductionFinalRepairDispatchError";
  }
}
/** Only the authenticated retained journal supplies the issued final request and
 * original token ceilings. Owns SDK response, usage and native receipt together. */
export async function executeProductionFinalSeedRepairV4(
  input: RepairDispatchTransport & {
    readonly database: SqlDatabase;
    readonly configuration: ModelLiveBedrockHostConfigurationV2;
    readonly journal: Journal;
    readonly authorizeCommercial: () => Promise<void>;
    readonly signal?: AbortSignal;
  },
) {
  try {
    input.journal.claimExecution();
    const { result, observation } = await dispatchProductionRepairV4({
      ...input,
      kind: "final",
      invocation: input.journal.invocation,
      reservedTokenCeiling: input.journal.reservedTokenCeiling,
      assertCurrentDispatch: () => input.journal.assertCurrentDispatch(),
      recordDispatch: (claim, receipt) =>
        input.journal.recordFinalDispatch(claim, receipt),
      recordKnownUsage: (usage) => input.journal.recordKnownUsage(usage),
    });
    const validation = await input.journal.validateKnownResponse(result);
    if (validation.kind === "missing")
      throw new ProductionFinalRepairDispatchError();
    return { kind: "validated" as const, observation, validation };
  } catch {
    throw new ProductionFinalRepairDispatchError();
  }
}
