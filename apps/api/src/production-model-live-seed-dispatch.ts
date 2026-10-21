import type { ModelProviderHostSeedInvocationV3 } from "@cloudmarkup/model-gateway";
import type { PostgresModelLiveSequences } from "./adapters/persistence/model-live-sequences.js";
import type { ModelLiveBedrockHostConfigurationV2 } from "./adapters/persistence/model-live-runtime-host-evidence-codec.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import {
  dispatchProductionRepairV4,
  ProductionSeedDispatchError,
  type RepairDispatchTransport,
} from "./production-model-live-repair-dispatch.js";
export { ProductionSeedDispatchError } from "./production-model-live-repair-dispatch.js";
export type SeedFirstDispatchTransport = RepairDispatchTransport;
type Journal = Awaited<
  ReturnType<PostgresModelLiveSequences["createSeedDispatchJournalV4"]>
>;
/** Historical first-stage wrapper over the shared counted one-send transport. */
export async function executeProductionFirstSeedRepairV4(
  input: SeedFirstDispatchTransport & {
    readonly database: SqlDatabase;
    readonly configuration: ModelLiveBedrockHostConfigurationV2;
    readonly invocation: ModelProviderHostSeedInvocationV3;
    readonly journal: Journal;
    readonly authorizeCommercial: () => Promise<void>;
    readonly signal?: AbortSignal;
  },
) {
  const { result, observation } = await dispatchProductionRepairV4({
    ...input,
    kind: "first",
    assertCurrentDispatch: () => input.journal.assertCurrentDispatch(),
    recordDispatch: (claim, receipt) =>
      input.journal.recordFirstDispatch(claim, receipt),
    recordKnownUsage: (usage) => input.journal.recordKnownUsage(usage),
  });
  const validation = await input.journal.validateKnownResponse(result);
  if (validation.kind === "missing") throw new ProductionSeedDispatchError();
  return { kind: "validated" as const, observation, validation };
}
