import { z } from "zod";
import {
  modelCandidateRepairResponseV1Schema,
  modelCandidateBundleV1Schema,
  modelFileCandidateV1Schema,
} from "./model-gateway-v1.js";

/** Model supplies exact patch bytes and copies existing input references. The
 * deterministic host computes the resulting file digest after applying them.
 * This never relabels a V1 model-supplied digest or accepts source ownership. */
export const modelHostSeedPatchResponseV2Schema = z
  .object({
    ...modelCandidateRepairResponseV1Schema.shape,
    contractVersion: z.literal(2),
    resultDigestAuthority: z.literal("deterministic-host"),
    candidateBundle: z
      .object({
        ...modelCandidateBundleV1Schema.shape,
        candidates: z
          .array(
            modelFileCandidateV1Schema.options[1]
              .omit({ proposedResultDigest: true })
              .strict(),
          )
          .length(1),
        dependencies: modelCandidateBundleV1Schema.shape.dependencies.length(0),
      })
      .strict(),
  })
  .strict();
export type ModelHostSeedPatchResponseV2 = z.output<
  typeof modelHostSeedPatchResponseV2Schema
>;
