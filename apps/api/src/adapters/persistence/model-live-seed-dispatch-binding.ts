import { parseModelLiveSeedRuntimeExecutionV4 } from "@cloudmarkup/model-gateway";
import {
  modelLiveSeedInvocationDescriptorV3Schema,
  type ModelLiveSeedInvocationDescriptorV3,
} from "@cloudmarkup/schemas";
import { prepareBoundRepairDispatchV4 } from "./model-live-repair-dispatch-platform-binding.js";

/** Strict historical first-stage entry. Its private journal owns current authority. */
export function prepareFirstSeedDispatchV4(
  input: Omit<
    Parameters<typeof prepareBoundRepairDispatchV4>[0],
    "stage" | "ordinal" | "descriptor"
  > & {
    readonly descriptor: ModelLiveSeedInvocationDescriptorV3;
  },
) {
  const execution = parseModelLiveSeedRuntimeExecutionV4(input.execution);
  const descriptor = modelLiveSeedInvocationDescriptorV3Schema.parse(
    input.descriptor,
  );
  return prepareBoundRepairDispatchV4({
    ...input,
    execution,
    descriptor,
    stage: execution.stageInput,
    ordinal: 1,
  });
}
