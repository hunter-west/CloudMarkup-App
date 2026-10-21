import {
  validateHostRepairArtifact,
  validateHostRepairObservation,
} from "./host-repair-observation-validation.js";
import {
  applicationGenerationRequestV1Schema,
  applicationGenerationResultV1Schema,
  applicationRepositoryPathV1Schema,
  asyncJobEnvironmentV1Schema,
  sha256DigestSchema,
  solutionRevisionManifestV1Schema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  applicationBuildDiagnosticV1Schema,
  applicationBuildFindingV1Schema,
  applicationBuildLimitsV1Schema,
  applicationBuildPolicyV1Schema,
  applicationBuildSourceFileV1Schema,
  applicationBuildStepSummaryV1Schema,
  applicationBuildTestSummaryV1Schema,
  applicationDependencyLockV1Schema,
} from "./contracts.js";
import { canonicalJson, sha256Digest } from "./security.js";

export const HOST_REPAIR_SEED_RECIPE_ID =
  "cloudmarkup.model-live.repair-seed.typescript-assignment";
export const HOST_REPAIR_SEED_EXTENSION_PATH =
  "application/src/functions/repair_seed_handler/extensions/custom.ts";
export const HOST_REPAIR_SEED_SUFFIXES = Object.freeze({
  "positive-control":
    "\n// Host-synthetic compiler control; not application behavior.\nexport const repairSeedTypeWitness: number = 1;\n",
  "invalid-seed":
    '\n// Host-synthetic compiler control; not application behavior.\nexport const repairSeedTypeWitness: number = "invalid";\n',
});
export const HOST_REPAIR_SEED_RECIPE_VERSION = "1.1.0";
export const HOST_REPAIR_SEED_SUFFIXES_BY_VERSION = Object.freeze({
  "1.0.0": HOST_REPAIR_SEED_SUFFIXES,
  "1.1.0": Object.freeze({
    ...HOST_REPAIR_SEED_SUFFIXES,
    "positive-control":
      "\n// Host-synthetic compiler control; not application behavior.\nexport const repairSeedTypeWitness: number = Math.abs(1);\n",
  }),
});
const recipeSchema = z
  .object({
    id: z.literal(HOST_REPAIR_SEED_RECIPE_ID),
    version: z.enum(["1.0.0", "1.1.0"]),
    digest: sha256DigestSchema,
  })
  .strict();
const filesSchema = z.array(applicationBuildSourceFileV1Schema).min(1).max(32);
const variantSchema = z
  .object({
    variant: z.enum(["positive-control", "invalid-seed"]),
    files: filesSchema,
    sourceTreeDigest: sha256DigestSchema,
    extensionContentDigest: sha256DigestSchema,
  })
  .strict();

/** Trusted host configuration, never an endpoint request or dispatch authority. */
export const applicationHostRepairSeedDefinitionV1Schema = z
  .object({
    kind: z.literal("cloudmarkup.model-live.repair-seed-source.v1"),
    origin: z.literal("fixed-host-synthetic"),
    authority: z.literal("unvalidated-source-only"),
    recipe: recipeSchema,
    generationRequest: applicationGenerationRequestV1Schema,
    deterministicScaffold: applicationGenerationResultV1Schema,
    extensionPath: z.literal(HOST_REPAIR_SEED_EXTENSION_PATH),
    baselineSourceDigest: sha256DigestSchema,
    positiveControl: variantSchema,
    invalidSeed: variantSchema,
  })
  .strict();

export const applicationHostRepairSeedProfileV1Schema = z
  .object({
    id: z.literal("cloudmarkup.application-build.host-repair-seed-nodejs24"),
    version: z.literal("1.0.0"),
    sourcePolicy: z.literal("fixed-host-repair-seed-only"),
    digest: sha256DigestSchema,
  })
  .strict()
  .superRefine(({ digest, ...body }, context) => {
    if (sha256Digest(canonicalJson(body)) !== digest) {
      context.addIssue({
        code: "custom",
        message: "The fixed host profile digest must match.",
      });
    }
  });

export function createApplicationHostRepairSeedProfileV1() {
  const body = {
    id: "cloudmarkup.application-build.host-repair-seed-nodejs24" as const,
    version: "1.0.0" as const,
    sourcePolicy: "fixed-host-repair-seed-only" as const,
  };
  return applicationHostRepairSeedProfileV1Schema.parse({
    ...body,
    digest: sha256Digest(canonicalJson(body)),
  });
}

// This is a new type. The original policy schema/profile enum is unchanged.
export const applicationHostRepairSeedPolicyV1Schema =
  applicationBuildPolicyV1Schema
    .omit({ profile: true })
    .extend({ profile: applicationHostRepairSeedProfileV1Schema })
    .strict();

export const applicationHostRepairSeedBuildRequestV1Schema = z
  .object({
    kind: z.literal("cloudmarkup.host-repair-seed-build.request"),
    contractVersion: z.literal(1),
    assessedAt: utcTimestampSchema,
    environment: asyncJobEnvironmentV1Schema,
    profile: applicationHostRepairSeedProfileV1Schema,
    limits: applicationBuildLimitsV1Schema,
    dependencyLock: applicationDependencyLockV1Schema,
    solutionRevision: solutionRevisionManifestV1Schema,
    solutionRevisionDigest: sha256DigestSchema,
    source: z
      .object({
        origin: z.literal("fixed-host-synthetic"),
        recipe: recipeSchema,
        variant: z.enum(["positive-control", "invalid-seed"]),
        deterministicScaffold: applicationGenerationResultV1Schema,
        baselineSourceDigest: sha256DigestSchema,
        extensionPath: z.literal(HOST_REPAIR_SEED_EXTENSION_PATH),
        extensionContentDigest: sha256DigestSchema,
        files: filesSchema,
        sourceTreeDigest: sha256DigestSchema,
      })
      .strict(),
  })
  .strict();

export const applicationHostRepairSeedBindingsV1Schema = z
  .object({
    requestDigest: sha256DigestSchema,
    recipeDigest: sha256DigestSchema,
    solutionRevisionDigest: sha256DigestSchema,
    generationArtifactDigest: sha256DigestSchema,
    originalBuildContractDigest: sha256DigestSchema,
    baselineSourceDigest: sha256DigestSchema,
    sourceTreeDigest: sha256DigestSchema,
    extensionContentDigest: sha256DigestSchema,
    dependencyLockDigest: sha256DigestSchema,
    policyDigest: sha256DigestSchema,
    imageDigest: sha256DigestSchema,
    helperDigest: sha256DigestSchema,
  })
  .strict();

export const applicationHostRepairSeedArtifactV1Schema = z
  .object({
    ownership: z.literal("host-synthetic-validation-artifact"),
    path: applicationRepositoryPathV1Schema,
    mediaType: z.enum([
      "application/json",
      "application/vnd.cyclonedx+json",
      "application/zip",
    ]),
    bytesBase64: z.string().min(1).max(22_369_624),
    checksum: sha256DigestSchema,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(16 * 1024 * 1024),
    bindings: applicationHostRepairSeedBindingsV1Schema,
  })
  .strict()
  .superRefine(validateHostRepairArtifact);

export { HOST_REPAIR_SEED_STEPS } from "./host-repair-observation-validation.js";

/** Parsing establishes structural consistency, never authentic tool execution. */
export const applicationHostRepairSeedBuildResultV1Schema = z
  .object({
    kind: z.literal("cloudmarkup.host-repair-seed-build.result"),
    contractVersion: z.literal(1),
    origin: z.literal("fixed-host-synthetic"),
    authority: z.literal("tool-observation-only"),
    state: z.enum(["passed", "failed", "error", "cancelled", "blocked"]),
    bindings: applicationHostRepairSeedBindingsV1Schema,
    steps: z.array(applicationBuildStepSummaryV1Schema).max(9),
    tests: z.array(applicationBuildTestSummaryV1Schema).max(2),
    diagnostics: z.array(applicationBuildDiagnosticV1Schema).max(256),
    findings: z.array(applicationBuildFindingV1Schema).max(256),
    artifacts: z.array(applicationHostRepairSeedArtifactV1Schema).max(3),
    cleanup: z.enum(["verified", "not-established"]),
    reproducibility: z.discriminatedUnion("state", [
      z.object({ state: z.literal("not-established") }).strict(),
      z
        .object({
          state: z.literal("verified"),
          firstArchiveChecksum: sha256DigestSchema,
          secondArchiveChecksum: sha256DigestSchema,
        })
        .strict(),
    ]),
    reportDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine(validateHostRepairObservation);

export function applicationHostRepairSeedRequestDigest(
  request: ApplicationHostRepairSeedBuildRequestV1,
) {
  return sha256Digest(
    canonicalJson(applicationHostRepairSeedBuildRequestV1Schema.parse(request)),
  );
}

export type ApplicationHostRepairSeedDefinitionV1 = z.output<
  typeof applicationHostRepairSeedDefinitionV1Schema
>;
export type ApplicationHostRepairSeedProfileV1 = z.output<
  typeof applicationHostRepairSeedProfileV1Schema
>;
export type ApplicationHostRepairSeedPolicyV1 = z.output<
  typeof applicationHostRepairSeedPolicyV1Schema
>;
export type ApplicationHostRepairSeedBuildRequestV1 = z.output<
  typeof applicationHostRepairSeedBuildRequestV1Schema
>;
export type ApplicationHostRepairSeedBuildResultV1 = z.output<
  typeof applicationHostRepairSeedBuildResultV1Schema
>;
export type ApplicationHostRepairSeedArtifactV1 = z.output<
  typeof applicationHostRepairSeedArtifactV1Schema
>;
