import { repairUsageObservationV4 } from "./model-live-repair-usage-observation-store.js";
/** Strict first-stage recovery, including known usage after authority withdrawal. */
export function firstSeedUsageObservationV4(
  input: Omit<Parameters<typeof repairUsageObservationV4>[0], "successor">,
) {
  const { tx, scope, execution, accounting, now, operation } = input;
  return repairUsageObservationV4({
    tx,
    scope,
    execution,
    accounting,
    now,
    operation,
  });
}
