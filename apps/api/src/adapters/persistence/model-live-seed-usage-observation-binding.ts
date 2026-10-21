import {
  modelLiveSeedInvocationDescriptorV3Schema,
  type ModelLiveSeedInvocationDescriptorV3,
} from "@cloudmarkup/schemas";
import { prepareRepairUsageObservationV4 } from "./model-live-repair-usage-observation-binding.js";

/** Strict first-stage projection; caller must load the actual issued metadata. */
export function prepareFirstSeedUsageObservationV4(
  input: Omit<
    Parameters<typeof prepareRepairUsageObservationV4>[0],
    "descriptor" | "ordinal" | "predecessor"
  > & {
    readonly descriptor: ModelLiveSeedInvocationDescriptorV3;
  },
) {
  return prepareRepairUsageObservationV4({
    ...input,
    descriptor: modelLiveSeedInvocationDescriptorV3Schema.parse(
      input.descriptor,
    ),
    ordinal: 1,
    predecessor: null,
  });
}
