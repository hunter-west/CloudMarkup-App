import { sha256DigestSchema } from "@cloudmarkup/schemas";
import { z } from "zod";
import { applicationLambdaArtifactManifestV1Schema } from "./contracts.js";
import { applicationHostRepairSeedBindingsV1Schema } from "./host-repair-seed-contracts.js";
import { outputPathIssue } from "./security.js";
import { validateHostRepairManifest } from "./host-repair-observation-validation.js";

const hostArchivePathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9@._/-]+$/u)
  .refine(
    (path) => outputPathIssue(path) === undefined,
    "A safe ZIP-relative output path is required.",
  );

/** Host validation metadata only; deliberately incompatible with normal artifacts. */
export const applicationHostRepairSeedManifestV1Schema = z
  .object({
    kind: z.literal("cloudmarkup.host-repair-seed-artifact-manifest"),
    contractVersion: z.literal(1),
    origin: z.literal("fixed-host-synthetic"),
    authority: z.literal("host-validation-only"),
    bindings: applicationHostRepairSeedBindingsV1Schema,
    runtime: applicationLambdaArtifactManifestV1Schema.shape.runtime,
    archive: z
      .object({
        checksum: sha256DigestSchema,
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(16 * 1024 * 1024),
        entrypoint: z.literal("index.js"),
      })
      .strict(),
    files: z
      .array(
        z
          .object({
            path: hostArchivePathSchema,
            checksum: sha256DigestSchema,
            sizeBytes: z
              .number()
              .int()
              .nonnegative()
              .max(16 * 1024 * 1024),
          })
          .strict(),
      )
      .min(1)
      .max(4096),
    manifestDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine(validateHostRepairManifest);

export function generateApplicationHostRepairSeedManifestV1JsonSchema() {
  return {
    $id: "https://schemas.cloudmarkup.dev/application-host-repair-seed-manifest/v1.schema.json",
    ...z.toJSONSchema(applicationHostRepairSeedManifestV1Schema, {
      io: "input",
      target: "draft-2020-12",
    }),
  };
}
export type ApplicationHostRepairSeedManifestV1 = z.output<
  typeof applicationHostRepairSeedManifestV1Schema
>;
