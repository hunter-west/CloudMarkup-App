import {
  modelLiveSeedInvocationDescriptorV3Schema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import { applicationBuildPolicyV1Schema } from "./contracts.js";
import {
  applicationHostRepairSeedBuildRequestV1Schema,
  applicationHostRepairSeedBindingsV1Schema,
  applicationHostRepairSeedArtifactV1Schema,
  applicationHostRepairSeedBuildResultV1Schema,
} from "./host-repair-seed-contracts.js";
import { applicationHostRepairSeedManifestV1Schema } from "./host-repair-seed-manifest.js";
import {
  validateHostRepairManifest,
  validateHostRepairArtifact,
  validateHostRepairObservation,
} from "./host-repair-observation-validation.js";
import { canonicalJson, sha256Digest } from "./security.js";

export const applicationHostRepairCandidateProfileV1Schema = z
  .object({
    id: z.literal(
      "cloudmarkup.application-build.host-repair-candidate-nodejs24",
    ),
    version: z.literal("1.0.0"),
    sourcePolicy: z.literal("one-bound-fixed-host-extension-repair"),
    digest: sha256DigestSchema,
  })
  .strict()
  .superRefine(({ digest, ...body }, context) => {
    if (sha256Digest(canonicalJson(body)) !== digest)
      context.addIssue({
        code: "custom",
        message: "The repair candidate profile digest must match.",
      });
  });
export function createApplicationHostRepairCandidateProfileV1() {
  const body = {
    id: "cloudmarkup.application-build.host-repair-candidate-nodejs24",
    version: "1.0.0",
    sourcePolicy: "one-bound-fixed-host-extension-repair",
  };
  return applicationHostRepairCandidateProfileV1Schema.parse({
    ...body,
    digest: sha256Digest(canonicalJson(body)),
  });
}
export const applicationHostRepairCandidatePolicyV1Schema =
  applicationBuildPolicyV1Schema
    .omit({ profile: true })
    .extend({ profile: applicationHostRepairCandidateProfileV1Schema })
    .strict();

/** Digest metadata is not proof of provider dispatch or tenant authorization. */
export const applicationHostRepairCandidateLineageV1Schema = z
  .object({
    baseDigest: sha256DigestSchema,
    inputDigest: sha256DigestSchema,
    invocationId: modelLiveSeedInvocationDescriptorV3Schema.shape.invocationId,
    patchDigest: sha256DigestSchema,
    responseDigest: sha256DigestSchema,
  })
  .strict();
export const applicationHostRepairCandidateBuildRequestV1Schema = z
  .object({
    ...applicationHostRepairSeedBuildRequestV1Schema.shape,
    kind: z.literal("cloudmarkup.host-repair-candidate-build.request"),
    profile: applicationHostRepairCandidateProfileV1Schema,
    source: z
      .object({
        ...applicationHostRepairSeedBuildRequestV1Schema.shape.source.shape,
        origin: z.literal("model-repair-of-fixed-host-seed"),
        variant: z.literal("model-repair"),
        lineage: applicationHostRepairCandidateLineageV1Schema,
      })
      .strict(),
  })
  .strict();
export const applicationHostRepairCandidateBindingsV1Schema =
  applicationHostRepairSeedBindingsV1Schema
    .extend({
      baseSeedRequestDigest: sha256DigestSchema,
      repairLineageDigest: sha256DigestSchema,
    })
    .strict();
export const applicationHostRepairCandidateArtifactV1Schema = z
  .object({
    ...applicationHostRepairSeedArtifactV1Schema.shape,
    ownership: z.literal("host-repair-candidate-validation-artifact"),
    bindings: applicationHostRepairCandidateBindingsV1Schema,
  })
  .strict()
  .superRefine(validateHostRepairArtifact);
export const applicationHostRepairCandidateBuildResultV1Schema = z
  .object({
    ...applicationHostRepairSeedBuildResultV1Schema.shape,
    kind: z.literal("cloudmarkup.host-repair-candidate-build.result"),
    origin: z.literal("model-repair-of-fixed-host-seed"),
    bindings: applicationHostRepairCandidateBindingsV1Schema,
    artifacts: z.array(applicationHostRepairCandidateArtifactV1Schema).max(3),
  })
  .strict()
  .superRefine(validateHostRepairObservation);

export const applicationHostRepairCandidateManifestV1Schema = z
  .object({
    ...applicationHostRepairSeedManifestV1Schema.shape,
    kind: z.literal("cloudmarkup.host-repair-candidate-artifact-manifest"),
    origin: z.literal("model-repair-of-fixed-host-seed"),
    bindings: applicationHostRepairCandidateBindingsV1Schema,
  })
  .strict()
  .superRefine(validateHostRepairManifest);

export function generateApplicationHostRepairCandidateV1JsonSchema() {
  return {
    $id: "https://schemas.cloudmarkup.dev/application-host-repair-candidate/v1.schema.json",
    ...z.toJSONSchema(
      z.union([
        applicationHostRepairCandidateBuildRequestV1Schema,
        applicationHostRepairCandidateBuildResultV1Schema,
        applicationHostRepairCandidatePolicyV1Schema,
        applicationHostRepairCandidateManifestV1Schema,
      ]),
      { io: "input", target: "draft-2020-12" },
    ),
  };
}
export type ApplicationHostRepairCandidateLineageV1 = z.output<
  typeof applicationHostRepairCandidateLineageV1Schema
>;
export type ApplicationHostRepairCandidatePolicyV1 = z.output<
  typeof applicationHostRepairCandidatePolicyV1Schema
>;
export type ApplicationHostRepairCandidateBuildRequestV1 = z.output<
  typeof applicationHostRepairCandidateBuildRequestV1Schema
>;
export type ApplicationHostRepairCandidateBuildResultV1 = z.output<
  typeof applicationHostRepairCandidateBuildResultV1Schema
>;
