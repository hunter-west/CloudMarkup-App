import { z } from "zod";

import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import { repositoryRelativePathSchema } from "./repository-ownership-v1.js";
import { repositorySnapshotIdSchema } from "./solution-contract-common-v1.js";

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const repositorySegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const localDescriptorPattern = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/;
const gitReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const exactCommitShaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function isPrintableOneLineText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return false;
    }
  }

  return true;
}

const opaqueRepositorySnapshotIdSchema = z
  .string()
  .regex(opaqueIdPattern, "Must be a stable opaque identifier.");
const boundedOneLineTextSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(isPrintableOneLineText, "Must be bounded printable one-line text.");

export const repositorySourceEvidenceIdSchema =
  opaqueRepositorySnapshotIdSchema.brand<"RepositorySourceEvidenceId">();
export const repositoryParseFindingIdSchema =
  opaqueRepositorySnapshotIdSchema.brand<"RepositoryParseFindingId">();
export const repositoryInferredRelationshipIdSchema =
  opaqueRepositorySnapshotIdSchema.brand<"RepositoryInferredRelationshipId">();
export const repositoryPathRuleIdSchema =
  opaqueRepositorySnapshotIdSchema.brand<"RepositoryPathRuleId">();

/** Full immutable Git object IDs only; abbreviated SHAs are never accepted. */
export const repositoryCommitShaSchema = z
  .string()
  .regex(
    exactCommitShaPattern,
    "Must be an exact lowercase 40- or 64-character Git commit SHA.",
  )
  .brand<"RepositoryCommitSha">();

export const repositorySelectionPathSchema = z.union([
  z.literal("."),
  repositoryRelativePathSchema,
]);

export const repositorySourceV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("integration"),
      integrationId: namespacedIdentifierSchema,
      owner: z.string().regex(repositorySegmentPattern),
      name: z.string().regex(repositorySegmentPattern),
    })
    .strict(),
  z
    .object({
      kind: z.literal("local"),
      sourceId: namespacedIdentifierSchema,
      descriptor: z.string().regex(localDescriptorPattern),
    })
    .strict(),
]);

const repositoryNamedRevisionV1Schema = z
  .object({
    name: z
      .string()
      .regex(gitReferencePattern)
      .refine(
        (name) =>
          !name.includes("..") &&
          !name.includes("@{") &&
          !name.includes("//") &&
          !name.endsWith("/") &&
          !name.endsWith(".lock"),
        "Must be a bounded valid Git reference name.",
      ),
  })
  .strict();

export const repositoryRevisionSelectorV1Schema = z.discriminatedUnion("kind", [
  repositoryNamedRevisionV1Schema
    .extend({ kind: z.literal("branch") })
    .strict(),
  repositoryNamedRevisionV1Schema.extend({ kind: z.literal("tag") }).strict(),
  z.object({ kind: z.literal("detached") }).strict(),
]);

export const repositoryPathSelectionV1Schema = z
  .object({
    ruleId: repositoryPathRuleIdSchema,
    path: repositorySelectionPathSchema,
    scope: z.enum(["file", "directory", "subtree"]),
  })
  .strict();

export const repositoryIgnoreRuleV1Schema = z
  .object({
    ruleId: repositoryPathRuleIdSchema,
    path: repositoryRelativePathSchema,
    scope: z.enum(["file", "directory", "subtree"]),
    reason: boundedOneLineTextSchema,
  })
  .strict();

export const repositoryDetectedFileKindV1Schema = z.enum([
  "infrastructure-as-code",
  "application-source",
  "workflow",
  "contract",
  "configuration",
  "diagram",
  "documentation",
  "other",
]);

export const repositorySourceFileV1Schema = z
  .object({
    path: repositoryRelativePathSchema,
    checksum: sha256DigestSchema,
    sizeBytes: z.number().int().nonnegative().max(1_073_741_824),
    detectedKinds: z
      .array(repositoryDetectedFileKindV1Schema)
      .min(1)
      .max(repositoryDetectedFileKindV1Schema.options.length),
  })
  .strict();

export const repositoryDetectedTypeV1Schema = z
  .object({
    category: z.enum(["iac", "application", "workflow"]),
    typeId: namespacedIdentifierSchema,
    detectorId: namespacedIdentifierSchema,
    detectorVersion: semanticVersionSchema,
    evidenceIds: z.array(repositorySourceEvidenceIdSchema).min(1).max(256),
  })
  .strict();

export const repositorySourceLocationV1Schema = z
  .object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    startColumn: z.number().int().positive().optional(),
    endColumn: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((location, context) => {
    if (location.endLine < location.startLine) {
      context.addIssue({
        code: "custom",
        path: ["endLine"],
        message: "End line cannot precede start line.",
      });
    }
    if (
      location.startLine === location.endLine &&
      location.startColumn !== undefined &&
      location.endColumn !== undefined &&
      location.endColumn < location.startColumn
    ) {
      context.addIssue({
        code: "custom",
        path: ["endColumn"],
        message: "End column cannot precede start column on the same line.",
      });
    }
  });

export const repositorySourceEvidenceV1Schema = z
  .object({
    evidenceId: repositorySourceEvidenceIdSchema,
    path: repositoryRelativePathSchema,
    fileChecksum: sha256DigestSchema,
    location: repositorySourceLocationV1Schema,
    evidenceKind: z.enum([
      "declaration",
      "reference",
      "dependency",
      "generated-marker",
      "configuration",
      "diagnostic",
    ]),
    factDigest: sha256DigestSchema,
  })
  .strict();

export const repositoryParseCertaintyV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("deterministic"),
      confidence: z.literal(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("inferred"),
      confidence: z.number().gt(0).lt(1),
      methodId: namespacedIdentifierSchema,
      methodVersion: semanticVersionSchema,
    })
    .strict(),
]);

export const repositoryParseFindingV1Schema = z
  .object({
    findingId: repositoryParseFindingIdSchema,
    parserId: namespacedIdentifierSchema,
    parserVersion: semanticVersionSchema,
    category: z.enum([
      "resource",
      "connection",
      "workload",
      "external-resource",
      "source-ownership",
      "workflow",
      "diagnostic",
    ]),
    status: z.enum(["confirmed", "inferred", "unresolved", "unsupported"]),
    severity: z.enum(["information", "warning", "error"]),
    summary: boundedOneLineTextSchema,
    certainty: repositoryParseCertaintyV1Schema,
    evidenceIds: z.array(repositorySourceEvidenceIdSchema).min(1).max(256),
  })
  .strict();

export const repositoryInferredRelationshipV1Schema = z
  .object({
    relationshipId: repositoryInferredRelationshipIdSchema,
    sourceObservationKey: opaqueRepositorySnapshotIdSchema,
    targetObservationKey: opaqueRepositorySnapshotIdSchema,
    relationshipType: namespacedIdentifierSchema,
    confidence: z.number().gt(0).lt(1),
    evidenceIds: z.array(repositorySourceEvidenceIdSchema).min(1).max(256),
  })
  .strict();

export const repositoryUnsupportedFileV1Schema = z
  .object({
    path: repositoryRelativePathSchema,
    checksum: sha256DigestSchema,
    reason: z.enum([
      "unsupported-type",
      "parse-error",
      "redacted",
      "size-limit",
      "binary",
      "encrypted",
      "ambiguous",
    ]),
    detail: boundedOneLineTextSchema,
  })
  .strict();

export const repositoryRedactionResultV1Schema = z
  .object({
    status: z.enum(["not-required", "applied", "rejected"]),
    redactedFileCount: z.number().int().nonnegative(),
    redactedValueCount: z.number().int().nonnegative(),
    categories: z
      .array(
        z.enum([
          "credential-candidate",
          "secret-candidate",
          "personal-data",
          "sensitive-content",
        ]),
      )
      .max(4),
  })
  .strict();

export const repositorySizeLimitResultV1Schema = z
  .object({
    status: z.enum(["within-limits", "partially-included", "rejected"]),
    configured: z
      .object({
        maximumFileCount: z.number().int().positive().max(100_000),
        maximumFileBytes: z.number().int().positive().max(1_073_741_824),
        maximumTotalBytes: z.number().int().positive().max(10_737_418_240),
      })
      .strict(),
    scannedFileCount: z.number().int().nonnegative().max(100_000),
    scannedBytes: z.number().int().nonnegative().max(10_737_418_240),
    includedFileCount: z.number().int().nonnegative().max(100_000),
    excludedFileCount: z.number().int().nonnegative().max(100_000),
  })
  .strict();

function addDuplicateIssues(
  values: readonly string[],
  path: (string | number)[],
  context: z.RefinementCtx,
) {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: `Duplicate stable value ${value}.`,
      });
    }
    seen.add(value);
  }
}

export const repositorySnapshotV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotId: repositorySnapshotIdSchema,
    source: repositorySourceV1Schema,
    revision: z
      .object({
        selector: repositoryRevisionSelectorV1Schema,
        commitSha: repositoryCommitShaSchema,
      })
      .strict(),
    importedAt: utcTimestampSchema,
    importer: z
      .object({
        importerId: namespacedIdentifierSchema,
        importerVersion: semanticVersionSchema,
      })
      .strict(),
    selectedPaths: z.array(repositoryPathSelectionV1Schema).min(1).max(512),
    ignoreRules: z.array(repositoryIgnoreRuleV1Schema).max(1_024),
    files: z.array(repositorySourceFileV1Schema).max(20_000),
    detectedTypes: z.array(repositoryDetectedTypeV1Schema).max(256),
    redaction: repositoryRedactionResultV1Schema,
    sizeLimits: repositorySizeLimitResultV1Schema,
    evidence: z.array(repositorySourceEvidenceV1Schema).max(50_000),
    parseFindings: z.array(repositoryParseFindingV1Schema).max(20_000),
    inferredRelationships: z
      .array(repositoryInferredRelationshipV1Schema)
      .max(20_000),
    unsupportedFiles: z.array(repositoryUnsupportedFileV1Schema).max(20_000),
    snapshotDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    addDuplicateIssues(
      snapshot.selectedPaths.map((selection) => selection.ruleId),
      ["selectedPaths"],
      context,
    );
    addDuplicateIssues(
      snapshot.ignoreRules.map((rule) => rule.ruleId),
      ["ignoreRules"],
      context,
    );
    addDuplicateIssues(
      snapshot.files.map((file) => file.path),
      ["files"],
      context,
    );
    addDuplicateIssues(
      snapshot.evidence.map((evidence) => evidence.evidenceId),
      ["evidence"],
      context,
    );
    addDuplicateIssues(
      snapshot.parseFindings.map((finding) => finding.findingId),
      ["parseFindings"],
      context,
    );
    addDuplicateIssues(
      snapshot.inferredRelationships.map(
        (relationship) => relationship.relationshipId,
      ),
      ["inferredRelationships"],
      context,
    );

    const files = new Map(snapshot.files.map((file) => [file.path, file]));
    const evidenceIds = new Set<string>(
      snapshot.evidence.map((evidence) => evidence.evidenceId),
    );
    for (const [index, evidence] of snapshot.evidence.entries()) {
      const file = files.get(evidence.path);
      if (file?.checksum !== evidence.fileChecksum) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "fileChecksum"],
          message: "Evidence must bind to an included file and exact checksum.",
        });
      }
    }
    const checkedEvidenceReferences: {
      path: (string | number)[];
      evidenceIds: readonly string[];
    }[] = [
      ...snapshot.detectedTypes.map((detected, index) => ({
        path: ["detectedTypes", index, "evidenceIds"],
        evidenceIds: detected.evidenceIds,
      })),
      ...snapshot.parseFindings.map((finding, index) => ({
        path: ["parseFindings", index, "evidenceIds"],
        evidenceIds: finding.evidenceIds,
      })),
      ...snapshot.inferredRelationships.map((relationship, index) => ({
        path: ["inferredRelationships", index, "evidenceIds"],
        evidenceIds: relationship.evidenceIds,
      })),
    ];
    for (const reference of checkedEvidenceReferences) {
      for (const [index, evidenceId] of reference.evidenceIds.entries()) {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            path: [...reference.path, index],
            message: `Unknown repository evidence ID ${evidenceId}.`,
          });
        }
      }
    }
    for (const [index, unsupported] of snapshot.unsupportedFiles.entries()) {
      const file = files.get(unsupported.path);
      if (file?.checksum !== unsupported.checksum) {
        context.addIssue({
          code: "custom",
          path: ["unsupportedFiles", index, "checksum"],
          message:
            "Unsupported-file records must bind to an included file and exact checksum.",
        });
      }
    }
    if (snapshot.sizeLimits.includedFileCount !== snapshot.files.length) {
      context.addIssue({
        code: "custom",
        path: ["sizeLimits", "includedFileCount"],
        message:
          "Included file count must equal the checksummed file inventory.",
      });
    }
    if (
      snapshot.files.some(
        (file) =>
          file.sizeBytes > snapshot.sizeLimits.configured.maximumFileBytes,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Included files cannot exceed the recorded per-file limit.",
      });
    }
  });

export type RepositoryCommitSha = z.output<typeof repositoryCommitShaSchema>;
export type RepositorySourceV1 = z.output<typeof repositorySourceV1Schema>;
export type RepositorySourceEvidenceV1 = z.output<
  typeof repositorySourceEvidenceV1Schema
>;
export type RepositoryParseFindingV1 = z.output<
  typeof repositoryParseFindingV1Schema
>;
export type RepositoryInferredRelationshipV1 = z.output<
  typeof repositoryInferredRelationshipV1Schema
>;
export type RepositorySnapshotV1 = z.output<typeof repositorySnapshotV1Schema>;
