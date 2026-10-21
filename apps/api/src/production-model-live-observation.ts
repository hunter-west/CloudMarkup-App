import { readModelLiveObservationV2 } from "./model-live-observation.js";

/** Preserve the existing execution host's idempotent canonical reconciliation.
 * Restored historical observations use the separate existing-only reader. */
export function readProductionModelLiveObservationV2(
  input: Omit<Parameters<typeof readModelLiveObservationV2>[0], "terminalMode">,
) {
  return readModelLiveObservationV2({
    ...input,
    terminalMode: "recover-if-verified",
  });
}
