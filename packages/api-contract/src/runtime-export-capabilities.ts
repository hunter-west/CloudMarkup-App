import { z } from "zod";

/** Public display capabilities only; job admission still verifies current eligibility. */
export const runtimeExportCapabilitiesV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    exports: z.union([
      z
        .object({
          targets: z.tuple([]),
          workload: z.null(),
          maximumBytes: z.literal(4_194_304),
        })
        .strict(),
      z
        .object({
          targets: z.tuple([z.literal("cloudformation")]),
          workload: z.literal("infrastructure-only"),
          maximumBytes: z.literal(4_194_304),
        })
        .strict(),
    ]),
  })
  .strict();

export type RuntimeExportCapabilitiesV1 = z.output<
  typeof runtimeExportCapabilitiesV1Schema
>;
