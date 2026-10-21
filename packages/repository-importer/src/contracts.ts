import {
  activeIssueV1Schema,
  architectureDocumentV3Schema,
  evidenceRecordV1Schema,
  namespacedIdentifierSchema,
  observedSolutionV1Schema,
  reconciliationProposalV1Schema,
  repositoryCommitShaSchema,
  repositoryRelativePathSchema,
  repositorySnapshotV1Schema,
  semanticVersionSchema,
  sha256DigestSchema,
  solutionRevisionManifestV1Schema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { providerCatalogArtifactV1Schema } from "@cloudmarkup/provider-sdk";
import { z } from "zod";

export const REPOSITORY_IMPORTER_ID =
  "cloudmarkup.repository-importer" as const;
export const REPOSITORY_IMPORTER_VERSION = "1.0.2" as const;
export const REPOSITORY_IMPORT_LIMITS = Object.freeze({
  files: 4_096,
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  pathBytes: 240,
  facts: 50_000,
  diagnostics: 10_000,
} as const);

const stableIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const safeSummarySchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !/(?:[A-Za-z]:\\|file:\/\/|https?:\/\/|token\s*[=:]|secret\s*[=:]|password\s*[=:])/iu.test(
        value,
      ),
    "Summary cannot expose URLs, local paths, or secret-like values.",
  );

export const repositoryImportProfileV1Schema = z
  .object({
    contractVersion: z.literal(1),
    profileId: namespacedIdentifierSchema,
    profileVersion: semanticVersionSchema,
    importedAt: utcTimestampSchema,
    commitSha: repositoryCommitShaSchema,
    snapshotId: stableIdSchema,
    observedSolutionId: stableIdSchema,
    sourceId: namespacedIdentifierSchema,
    sourceDescriptor: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/u),
    selectedPaths: z
      .array(z.union([z.literal("."), repositoryRelativePathSchema]))
      .min(1)
      .max(128),
    limits: z
      .object({
        maximumFileCount: z
          .number()
          .int()
          .positive()
          .max(REPOSITORY_IMPORT_LIMITS.files),
        maximumFileBytes: z
          .number()
          .int()
          .positive()
          .max(REPOSITORY_IMPORT_LIMITS.fileBytes),
        maximumTotalBytes: z
          .number()
          .int()
          .positive()
          .max(REPOSITORY_IMPORT_LIMITS.totalBytes),
      })
      .strict(),
  })
  .strict();

export const repositoryImportRequestV1Schema = z
  .object({
    contractVersion: z.literal(1),
    profile: repositoryImportProfileV1Schema,
    approvedArchitecture: architectureDocumentV3Schema,
    solutionRevision: solutionRevisionManifestV1Schema,
    catalog: providerCatalogArtifactV1Schema,
  })
  .strict();

export const repositoryImportDiagnosticV1Schema = z
  .object({
    code: z.string().regex(/^cloudmarkup\.import\.[a-z0-9-]+$/u),
    severity: z.enum(["information", "warning", "error"]),
    summary: safeSummarySchema,
    path: repositoryRelativePathSchema.optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    factId: stableIdSchema.optional(),
  })
  .strict();

const sourceReferenceSchema = z
  .object({
    path: repositoryRelativePathSchema,
    evidenceId: stableIdSchema,
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  })
  .strict();

const factBase = {
  factId: stableIdSchema,
  logicalKey: z.string().min(1).max(512),
  digest: sha256DigestSchema,
  semanticIntentDigest: sha256DigestSchema.optional(),
  source: sourceReferenceSchema,
  parser: z
    .object({ id: namespacedIdentifierSchema, version: semanticVersionSchema })
    .strict(),
  confidence: z.enum(["confirmed", "unresolved"]),
  target: z.enum([
    "cloudmarkup",
    "terraform",
    "terraform-show-json",
    "cloudformation",
    "cdk-synth",
    "application-manifest",
    "workflow",
  ]),
  providerId: namespacedIdentifierSchema.optional(),
  ownership: z.enum(["generated", "user-owned", "external", "unknown"]),
  diagnostics: z.array(repositoryImportDiagnosticV1Schema).max(64),
} as const;

const referenceSchema = z.string().min(1).max(512);
export const repositoryImportedFactV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      ...factBase,
      kind: z.literal("resource"),
      resourceType: namespacedIdentifierSchema,
      serviceType: namespacedIdentifierSchema.optional(),
      deploymentIdentifier: z.string().min(1).max(256).optional(),
      configurationDigest: sha256DigestSchema,
      references: z.array(referenceSchema).max(256),
      external: z.boolean(),
      reviewedPublicExposure: z.enum(["none", "private", "public"]).optional(),
    })
    .strict(),
  z
    .object({
      ...factBase,
      kind: z.literal("connection"),
      relationshipType: namespacedIdentifierSchema,
      sourceKey: referenceSchema,
      targetKey: referenceSchema,
      configurationDigest: sha256DigestSchema,
    })
    .strict(),
  z
    .object({
      ...factBase,
      kind: z.literal("variable"),
      variableType: z.string().min(1).max(128).optional(),
      sensitive: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...factBase,
      kind: z.literal("output"),
      sensitive: z.boolean(),
      references: z.array(referenceSchema).max(256),
    })
    .strict(),
  z
    .object({
      ...factBase,
      kind: z.literal("policy"),
      effect: z.enum(["allow", "deny", "mixed", "unresolved"]),
      actions: z.array(z.string().min(1).max(256)).max(1_024),
      resourceScope: z.enum(["specific", "wildcard", "unresolved"]),
    })
    .strict(),
  z
    .object({
      ...factBase,
      kind: z.literal("workload-binding"),
      workloadId: stableIdSchema.optional(),
      handler: z.string().min(1).max(512).optional(),
      environmentBindingNames: z.array(stableIdSchema).max(256),
    })
    .strict(),
  z
    .object({
      ...factBase,
      kind: z.literal("workflow"),
      generates: z.boolean(),
      plans: z.boolean(),
      deploys: z.boolean(),
      checksDrift: z.boolean(),
      actionUses: z
        .array(
          z
            .string()
            .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[A-Za-z0-9._-]+$/u),
        )
        .max(256),
    })
    .strict(),
  z
    .object({
      ...factBase,
      kind: z.literal("generated-file"),
      path: repositoryRelativePathSchema,
      expectedChecksum: sha256DigestSchema,
      actualChecksum: sha256DigestSchema.optional(),
    })
    .strict(),
]);

export const repositoryConformanceDifferenceKindV1Schema = z.enum([
  "matches",
  "designed-but-not-observed",
  "observed-but-not-designed",
  "external-resource",
  "unmanaged-resource",
  "configuration-mismatch",
  "connection-mismatch",
  "application-binding-mismatch",
  "iam-expansion",
  "iam-reduction",
  "ownership-mismatch",
  "generated-file-drift",
  "unsupported-unresolved-import",
]);

export const repositoryConformanceDifferenceV1Schema = z
  .object({
    differenceId: stableIdSchema,
    kind: repositoryConformanceDifferenceKindV1Schema,
    severity: z.enum(["information", "warning", "error"]),
    summary: safeSummarySchema,
    designTargetId: stableIdSchema.optional(),
    observedFactIds: z.array(stableIdSchema).max(256),
    evidenceIds: z.array(stableIdSchema).max(256),
    digest: sha256DigestSchema,
  })
  .strict();

export const hclInspectionResultV1Schema = z
  .object({
    contractVersion: z.literal(1),
    parser: z
      .object({
        id: namespacedIdentifierSchema,
        version: semanticVersionSchema,
      })
      .strict(),
    succeeded: z.boolean(),
    diagnostics: z
      .array(
        z
          .object({
            code: z.literal("HCL_PARSE_DIAGNOSTIC"),
            severity: z.enum(["warning", "error"]),
            range: z
              .object({
                startLine: z.number().int().positive(),
                startColumn: z.number().int().positive(),
                endLine: z.number().int().positive(),
                endColumn: z.number().int().positive(),
              })
              .strict(),
          })
          .strict(),
      )
      .max(10_000),
    blocks: z
      .array(
        z
          .object({
            type: stableIdSchema,
            labels: z.array(stableIdSchema).max(16),
            blockPath: z.array(stableIdSchema).min(1).max(64),
            range: z
              .object({
                startLine: z.number().int().positive(),
                startColumn: z.number().int().positive(),
                endLine: z.number().int().positive(),
                endColumn: z.number().int().positive(),
              })
              .strict(),
            attributes: z
              .array(
                z
                  .object({
                    name: stableIdSchema,
                    expressionKind: z.enum([
                      "literal",
                      "reference",
                      "template",
                      "collection",
                      "function",
                      "conditional",
                      "for-expression",
                      "splat",
                      "index",
                      "operator",
                      "parenthesized",
                      "unknown",
                    ]),
                    expressionDigest: sha256DigestSchema,
                    references: z.array(referenceSchema).max(256),
                    range: z
                      .object({
                        startLine: z.number().int().positive(),
                        startColumn: z.number().int().positive(),
                        endLine: z.number().int().positive(),
                        endColumn: z.number().int().positive(),
                      })
                      .strict(),
                  })
                  .strict(),
              )
              .max(4_096),
          })
          .strict(),
      )
      .max(20_000),
  })
  .strict();

export const repositoryImportResultV1Schema = z
  .object({
    contractVersion: z.literal(1),
    kind: z.literal("cloudmarkup.repository-import-result"),
    snapshot: repositorySnapshotV1Schema,
    observedSolution: observedSolutionV1Schema,
    facts: z
      .array(repositoryImportedFactV1Schema)
      .max(REPOSITORY_IMPORT_LIMITS.facts),
    differences: z
      .array(repositoryConformanceDifferenceV1Schema)
      .max(REPOSITORY_IMPORT_LIMITS.facts),
    issues: z.array(activeIssueV1Schema).max(10_000),
    evidence: evidenceRecordV1Schema,
    proposal: reconciliationProposalV1Schema.optional(),
    diagnostics: z
      .array(repositoryImportDiagnosticV1Schema)
      .max(REPOSITORY_IMPORT_LIMITS.diagnostics),
    resultDigest: sha256DigestSchema,
  })
  .strict();

export type RepositoryImportProfileV1 = z.output<
  typeof repositoryImportProfileV1Schema
>;
export type RepositoryImportRequestV1 = z.output<
  typeof repositoryImportRequestV1Schema
>;
export type RepositoryImportDiagnosticV1 = z.output<
  typeof repositoryImportDiagnosticV1Schema
>;
export type RepositoryImportedFactV1 = z.output<
  typeof repositoryImportedFactV1Schema
>;
export type RepositoryConformanceDifferenceV1 = z.output<
  typeof repositoryConformanceDifferenceV1Schema
>;
export type HCLInspectionResultV1 = z.output<
  typeof hclInspectionResultV1Schema
>;
export type RepositoryImportResultV1 = z.output<
  typeof repositoryImportResultV1Schema
>;
