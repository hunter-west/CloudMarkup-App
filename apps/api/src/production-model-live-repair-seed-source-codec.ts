import {
  applicationBuildSourceFileV1Schema,
  applicationBuildSourceTreeDigest,
  sha256Digest,
} from "@cloudmarkup/application-build-runner";
import {
  applicationGenerationRequestV1Schema,
  applicationGenerationResultV1Schema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import {
  HOST_REPAIR_SEED_RECIPE_ID,
  HOST_REPAIR_SEED_RECIPE_VERSION,
  HOST_REPAIR_SEED_SUFFIXES_BY_VERSION,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import { REPAIR_SEED_EXTENSION_PATH } from "./production-model-live-repair-seed-definition.js";

export const REPAIR_SEED_RECIPE_ID = HOST_REPAIR_SEED_RECIPE_ID;
export const REPAIR_SEED_RECIPE_VERSION = HOST_REPAIR_SEED_RECIPE_VERSION;
export const REPAIR_SEED_SOURCE_MAX_BYTES = 1024 * 1024;
export const REPAIR_SEED_CONTROL_SUFFIX =
  HOST_REPAIR_SEED_SUFFIXES_BY_VERSION[REPAIR_SEED_RECIPE_VERSION][
    "positive-control"
  ];
export const REPAIR_SEED_INVALID_SUFFIX =
  HOST_REPAIR_SEED_SUFFIXES_BY_VERSION[REPAIR_SEED_RECIPE_VERSION][
    "invalid-seed"
  ];

const variantSchema = z
  .object({
    variant: z.enum(["positive-control", "invalid-seed"]),
    files: z.array(applicationBuildSourceFileV1Schema).min(1).max(32),
    sourceTreeDigest: sha256DigestSchema,
    extensionContentDigest: sha256DigestSchema,
  })
  .strict();

/** Closed in-memory source only. This codec is not execution or receipt authority. */
export const productionRepairSeedSourceV1Schema = z
  .object({
    kind: z.literal("cloudmarkup.model-live.repair-seed-source.v1"),
    origin: z.literal("fixed-host-synthetic"),
    authority: z.literal("unvalidated-source-only"),
    recipe: z
      .object({
        id: z.literal(REPAIR_SEED_RECIPE_ID),
        version: z.literal(REPAIR_SEED_RECIPE_VERSION),
        digest: sha256DigestSchema,
      })
      .strict(),
    generationRequest: applicationGenerationRequestV1Schema,
    deterministicScaffold: applicationGenerationResultV1Schema,
    extensionPath: z.literal(REPAIR_SEED_EXTENSION_PATH),
    baselineSourceDigest: sha256DigestSchema,
    positiveControl: variantSchema,
    invalidSeed: variantSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const reject = () => {
      context.addIssue({
        code: "custom",
        message: "The exact fixed unvalidated source is required.",
      });
    };
    const scaffold = value.deterministicScaffold.artifact.sourceFiles;
    const baseline = scaffold.find((file) => file.path === value.extensionPath);
    if (
      baseline === undefined ||
      !("content" in baseline) ||
      typeof baseline.content !== "string" ||
      baseline.ownership !== "user-owned"
    ) {
      reject();
      return;
    }
    if (
      value.positiveControl.variant !== "positive-control" ||
      value.invalidSeed.variant !== "invalid-seed"
    )
      reject();
    for (const [variant, suffix] of [
      [value.positiveControl, REPAIR_SEED_CONTROL_SUFFIX],
      [value.invalidSeed, REPAIR_SEED_INVALID_SUFFIX],
    ] as const) {
      const extension = variant.files.find(
        (file) => file.path === value.extensionPath,
      );
      if (
        extension?.ownership !== "user-owned" ||
        extension.content !== baseline.content + suffix ||
        extension.checksum !== variant.extensionContentDigest ||
        variant.sourceTreeDigest !==
          applicationBuildSourceTreeDigest(variant.files)
      )
        reject();
      if (
        variant.files.length !== scaffold.length ||
        new Set(variant.files.map((file) => file.path)).size !==
          variant.files.length
      )
        reject();
      for (const file of variant.files) {
        const original = scaffold.find((entry) => entry.path === file.path);
        if (
          sha256Digest(file.content) !== file.checksum ||
          original === undefined ||
          !("content" in original) ||
          original.mediaType !== file.mediaType ||
          original.ownership !== file.ownership
        )
          reject();
        if (
          file.path !== value.extensionPath &&
          (original === undefined ||
            !("content" in original) ||
            original.content !== file.content ||
            original.checksum !== file.checksum)
        )
          reject();
      }
    }
    const request = value.generationRequest;
    if (
      request.existingFiles.length !== 0 ||
      request.workloadBehavior.workloads.length !== 1 ||
      request.solutionRevision.aiExtensionIds.length !== 0 ||
      request.solutionRevision.evidenceIdsAtFreeze.length !== 0 ||
      request.solutionRevision.issueIdsAtFreeze.length !== 0
    )
      reject();
    for (const workload of request.workloadBehavior.workloads) {
      if (
        workload.implementation.mode !== "generated-starter" ||
        workload.provenance.source !== "manual" ||
        workload.extensions.length !== 0 ||
        workload.compatibility.modelGateways.length !== 0
      )
        reject();
    }
  });

export type ProductionRepairSeedSourceV1 = z.output<
  typeof productionRepairSeedSourceV1Schema
>;
export type FixedHostSeedVariantV1 = z.output<typeof variantSchema>;

export class ProductionRepairSeedSourceError extends Error {
  readonly code = "model-live.repair-seed-source-unavailable";
  constructor() {
    super("The fixed unvalidated repair source is unavailable.");
    this.name = "ProductionRepairSeedSourceError";
  }
}
