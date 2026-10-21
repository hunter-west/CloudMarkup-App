import { sha256DigestSchema } from "@cloudmarkup/schemas";
import { z } from "zod";
import {
  applicationHostRepairCandidateBuildRequestV1Schema,
  applicationHostRepairCandidateBuildResultV1Schema,
  applicationHostRepairCandidateLineageV1Schema,
  applicationHostRepairCandidateManifestV1Schema,
} from "./host-repair-candidate-contracts.js";
import {
  validateHostRepairManifest,
  validateHostRepairObservation,
} from "./host-repair-observation-validation.js";

/** Metadata alone never establishes actual execution or authorizes another stage. */
export const applicationHostRepairSuccessorLineageV2Schema =
  applicationHostRepairCandidateLineageV1Schema
    .extend({
      predecessorRequestDigest: sha256DigestSchema,
      predecessorReportDigest: sha256DigestSchema,
      predecessorLineageDigest: sha256DigestSchema,
    })
    .strict();
export const applicationHostRepairSuccessorBuildRequestV2Schema = z
  .object({
    ...applicationHostRepairCandidateBuildRequestV1Schema.shape,
    contractVersion: z.literal(2),
    source: z
      .object({
        ...applicationHostRepairCandidateBuildRequestV1Schema.shape.source
          .shape,
        origin: z.literal("model-successor-of-host-repair"),
        lineage: applicationHostRepairSuccessorLineageV2Schema,
      })
      .strict(),
  })
  .strict();
export const applicationHostRepairSuccessorBuildResultV2Schema = z
  .object({
    ...applicationHostRepairCandidateBuildResultV1Schema.shape,
    contractVersion: z.literal(2),
    origin: z.literal("model-successor-of-host-repair"),
  })
  .strict()
  .superRefine(validateHostRepairObservation);
export const applicationHostRepairSuccessorManifestV2Schema = z
  .object({
    ...applicationHostRepairCandidateManifestV1Schema.shape,
    contractVersion: z.literal(2),
    origin: z.literal("model-successor-of-host-repair"),
  })
  .strict()
  .superRefine(validateHostRepairManifest);
export function generateApplicationHostRepairSuccessorV2JsonSchema() {
  return {
    $id: "https://schemas.cloudmarkup.dev/application-host-repair-successor/v2.schema.json",
    ...z.toJSONSchema(
      z.union([
        applicationHostRepairSuccessorBuildRequestV2Schema,
        applicationHostRepairSuccessorBuildResultV2Schema,
        applicationHostRepairSuccessorManifestV2Schema,
      ]),
      { io: "input", target: "draft-2020-12" },
    ),
  };
}
export type ApplicationHostRepairSuccessorLineageV2 = z.output<
  typeof applicationHostRepairSuccessorLineageV2Schema
>;
export type ApplicationHostRepairSuccessorBuildRequestV2 = z.output<
  typeof applicationHostRepairSuccessorBuildRequestV2Schema
>;
export type ApplicationHostRepairSuccessorBuildResultV2 = z.output<
  typeof applicationHostRepairSuccessorBuildResultV2Schema
>;
