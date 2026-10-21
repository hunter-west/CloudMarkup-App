import { z } from "zod";
import {
  observedSolutionV1Schema,
  solutionRevisionIdSchema,
} from "@cloudmarkup/schemas";

import {
  createDataEnvelopeSchema,
  createListEnvelopeSchema,
  createOpaqueIdentifierSchema,
  entityTagSchema,
  idempotencyHeadersV1Schema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./common.js";
import {
  githubBranchNameSchema,
  githubRepositoryIdSchema,
  gitShaSchema,
} from "./github-exports.js";
import { integrationIdSchema, projectIdSchema } from "./resources.js";
import { projectEditingLeaseProofV1Schema } from "./project-editing-leases.js";

export const githubRepositoryImportIdSchema =
  createOpaqueIdentifierSchema("githubimport");

const repositoryPathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => value === value.trim())
  .refine((value) => value === "." || !value.startsWith("/"))
  .refine((value) => value === "." || !value.endsWith("/"))
  .refine((value) => !value.includes("\\") && !value.includes("//"))
  .refine((value) => !value.includes(":") && !value.includes("%"))
  .refine(
    (value) =>
      value === "." ||
      value
        .split("/")
        .every(
          (segment) =>
            segment !== "." &&
            segment !== ".." &&
            segment.toLowerCase() !== ".git" &&
            /^[A-Za-z0-9._@+-]+$/u.test(segment),
        ),
  );

const repositoryFilePathSchema = repositoryPathSchema.refine(
  (value) => value !== ".",
  "A file path cannot select the repository root.",
);

const safeIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);

export const githubRepositoryImportPathV1Schema = z
  .object({
    importId: githubRepositoryImportIdSchema,
    projectId: projectIdSchema,
  })
  .strict();

export const githubRepositoryImportListQueryV1Schema = z
  .object({
    repositoryId: z
      .string()
      .regex(/^[1-9][0-9]{0,19}$/u)
      .optional(),
  })
  .strict();

export const createGithubRepositoryImportV1Schema = z
  .object({
    branch: githubBranchNameSchema,
    commitSha: gitShaSchema,
    contractVersion: z.literal(1),
    ignoredPaths: z.array(repositoryPathSchema).max(128),
    integrationId: integrationIdSchema,
    previousImportId: githubRepositoryImportIdSchema.optional(),
    repositoryId: githubRepositoryIdSchema,
    requestedMode: z.enum(["guided", "professional"]),
    selectedPaths: z.array(repositoryPathSchema).min(1).max(128),
  })
  .strict();

export const discoverGithubRepositoryV1Schema =
  createGithubRepositoryImportV1Schema.pick({
    branch: true,
    commitSha: true,
    contractVersion: true,
    ignoredPaths: true,
    integrationId: true,
    repositoryId: true,
    selectedPaths: true,
  });

export const githubRepositoryDiscoveryV1Schema = z
  .object({
    contractVersion: z.literal(1),
    branch: githubBranchNameSchema,
    branchHeadSha: gitShaSchema,
    branchChangedSinceSelection: z.boolean(),
    commitSha: gitShaSchema,
    integrationId: integrationIdSchema,
    projectId: projectIdSchema,
    repositoryId: githubRepositoryIdSchema,
    treeSha: gitShaSchema,
    files: z
      .array(
        z
          .object({
            gitBlobSha: gitShaSchema,
            path: repositoryFilePathSchema,
            sizeBytes: z
              .number()
              .int()
              .nonnegative()
              .max(8 * 1024 * 1024),
          })
          .strict(),
      )
      .max(4096),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.branchChangedSinceSelection !==
      (value.branchHeadSha !== value.commitSha)
    ) {
      context.addIssue({
        code: "custom",
        path: ["branchChangedSinceSelection"],
        message: "Branch context must match the selected commit.",
      });
    }
    if (
      value.files.reduce((total, file) => total + file.sizeBytes, 0) >
        128 * 1024 * 1024 ||
      new Set(value.files.map((file) => file.path.toLowerCase())).size !==
        value.files.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message:
          "File inventory exceeds safe bounds or contains duplicate paths.",
      });
    }
  });
export const githubRepositoryDiscoveryResponseV1Schema =
  createDataEnvelopeSchema(githubRepositoryDiscoveryV1Schema);
export type DiscoverGithubRepositoryV1 = z.output<
  typeof discoverGithubRepositoryV1Schema
>;
export type GithubRepositoryDiscoveryV1 = z.output<
  typeof githubRepositoryDiscoveryV1Schema
>;

export const githubRepositoryImportFileV1Schema = z
  .object({
    digest: sha256DigestSchema,
    path: repositoryFilePathSchema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(8 * 1024 * 1024),
  })
  .strict();

export const githubRepositoryImportIgnoredFileV1Schema = z
  .object({
    path: repositoryFilePathSchema,
    reason: z.enum([
      "explicitly-ignored",
      "sensitive-path",
      "unsupported-file-type",
    ]),
  })
  .strict();

export const githubRepositoryImportFileDifferenceV1Schema = z
  .object({
    action: z.enum(["added", "modified", "removed", "unchanged"]),
    currentDigest: sha256DigestSchema.optional(),
    path: repositoryFilePathSchema,
    previousDigest: sha256DigestSchema.optional(),
  })
  .strict();

export const githubRepositorySemanticDifferenceV1Schema = z
  .object({
    designTargetId: safeIdentifierSchema.optional(),
    digest: sha256DigestSchema,
    differenceId: safeIdentifierSchema,
    evidenceIds: z.array(safeIdentifierSchema).max(256),
    kind: z.enum([
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
    ]),
    severity: z.enum(["information", "warning", "error"]),
    observedFactIds: z.array(safeIdentifierSchema).max(256),
    operationId: safeIdentifierSchema.optional(),
    operationKind: z
      .enum([
        "accept-observed-graph-change",
        "accept-observed-domain-change",
        "keep-observed-only",
        "mark-intentionally-external",
        "update-generated-output-to-design",
        "ignore-observation",
        "resolve-ambiguous-mapping",
        "remove-stale-imported-evidence",
      ])
      .optional(),
    summary: z.string().min(1).max(512),
  })
  .strict();

export const githubRepositoryImportEvidenceV1Schema = z
  .object({
    confidence: z.enum(["confirmed", "unresolved"]),
    evidenceId: safeIdentifierSchema,
    fileDigest: sha256DigestSchema,
    path: repositoryFilePathSchema,
    startLine: z.number().int().positive(),
  })
  .strict();

export const githubRepositoryInferenceClaimV1Schema = z
  .object({
    category: z.enum([
      "resource",
      "connection",
      "workload",
      "external-resource",
      "source-ownership",
      "workflow",
      "diagnostic",
    ]),
    claimId: safeIdentifierSchema,
    confidenceBasisPoints: z.number().int().min(0).max(10_000),
    evidenceIds: z.array(safeIdentifierSchema).min(1).max(256),
    observedOnly: z.literal(true),
    summary: z.string().min(1).max(500),
  })
  .strict();

export const githubRepositoryImportIssueV1Schema = z
  .object({
    evidenceIds: z.array(safeIdentifierSchema).max(256),
    issueId: safeIdentifierSchema,
    lifecycle: z.literal("current"),
    severity: z.enum([
      "security-error",
      "error",
      "cost-warning",
      "warning",
      "recommendation",
      "educational-note",
    ]),
    source: z.literal("repository-import-mismatch"),
    summary: z.string().min(1).max(500),
  })
  .strict();

export const githubRepositoryImportV1Schema = z
  .object({
    branch: githubBranchNameSchema,
    branchChangedSinceSelection: z.boolean().optional(),
    branchHeadSha: gitShaSchema,
    commitSha: gitShaSchema,
    completedAt: utcTimestampSchema.optional(),
    createdAt: utcTimestampSchema,
    fileDifferences: z
      .array(githubRepositoryImportFileDifferenceV1Schema)
      .max(8_192),
    files: z.array(githubRepositoryImportFileV1Schema).max(4_096),
    ignoredFiles: z.array(githubRepositoryImportIgnoredFileV1Schema).max(4_096),
    ignoredPaths: z.array(repositoryPathSchema).max(128),
    importId: githubRepositoryImportIdSchema,
    inferenceClaims: z.array(githubRepositoryInferenceClaimV1Schema).max(2_048),
    issues: z.array(githubRepositoryImportIssueV1Schema).max(10_000),
    previousImportId: githubRepositoryImportIdSchema.optional(),
    projectId: projectIdSchema,
    observedSolution: observedSolutionV1Schema.optional(),
    comparisonSolutionRevisionId: solutionRevisionIdSchema.optional(),
    recordVersion: z.number().int().positive(),
    repositoryId: githubRepositoryIdSchema,
    repositoryName: z.string().min(1).max(100),
    repositoryOwner: z.string().min(1).max(100),
    selectedPaths: z.array(repositoryPathSchema).min(1).max(128),
    semanticDifferences: z
      .array(githubRepositorySemanticDifferenceV1Schema)
      .max(50_000),
    snapshotDigest: sha256DigestSchema.optional(),
    snapshotId: safeIdentifierSchema,
    sourceEvidence: z.array(githubRepositoryImportEvidenceV1Schema).max(50_000),
    state: z.enum([
      "running",
      "succeeded",
      "failed-transient",
      "failed-permanent",
    ]),
    trigger: z.enum(["manual", "webhook"]),
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const reviewGithubRepositoryImportV1Schema = z
  .object({
    contractVersion: z.literal(1),
    decision: z.enum([
      "accept-into-design",
      "keep-observed",
      "mark-external",
      "regenerate",
      "ignore",
      "reject",
    ]),
    expectedSnapshotDigest: sha256DigestSchema,
    draftAcceptance: z
      .object({
        expectedDraftEtag: entityTagSchema,
        editingLease: projectEditingLeaseProofV1Schema,
      })
      .strict()
      .optional(),
    operationId: safeIdentifierSchema,
    reason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "ignore" && value.reason === undefined) {
      context.addIssue({
        code: "custom",
        message: "Ignoring repository evidence requires a reason.",
        path: ["reason"],
      });
    }
  });

export const githubRepositoryReconciliationReviewV1Schema = z
  .object({
    decision: reviewGithubRepositoryImportV1Schema.shape.decision,
    designChanged: z.boolean(),
    importId: githubRepositoryImportIdSchema,
    operationId: safeIdentifierSchema,
    receiptId: safeIdentifierSchema,
    reviewedAt: utcTimestampSchema,
    snapshotDigest: sha256DigestSchema,
  })
  .strict();

export const createGithubRepositoryRefreshSubscriptionV1Schema = z
  .object({
    branch: githubBranchNameSchema,
    contractVersion: z.literal(1),
    enabled: z.boolean(),
    events: z.array(z.literal("push")).min(1).max(1),
    ignoredPaths: z.array(repositoryPathSchema).max(128),
    integrationId: integrationIdSchema,
    repositoryId: githubRepositoryIdSchema,
    selectedPaths: z.array(repositoryPathSchema).min(1).max(128),
  })
  .strict();

export const githubRepositoryRefreshSubscriptionV1Schema = z
  .object({
    branch: githubBranchNameSchema,
    enabled: z.boolean(),
    events: z.array(z.literal("push")).length(1),
    integrationId: integrationIdSchema,
    projectId: projectIdSchema,
    repositoryId: githubRepositoryIdSchema,
    subscriptionId: createOpaqueIdentifierSchema("githubrefresh"),
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const githubRepositoryImportResponseV1Schema = createDataEnvelopeSchema(
  githubRepositoryImportV1Schema,
);
export const githubRepositoryImportListResponseV1Schema =
  createListEnvelopeSchema(githubRepositoryImportV1Schema);
export const githubRepositoryReconciliationReviewResponseV1Schema =
  createDataEnvelopeSchema(githubRepositoryReconciliationReviewV1Schema);
export const githubRepositoryRefreshSubscriptionResponseV1Schema =
  createDataEnvelopeSchema(githubRepositoryRefreshSubscriptionV1Schema);

export { idempotencyHeadersV1Schema };

export type CreateGithubRepositoryImportV1 = z.output<
  typeof createGithubRepositoryImportV1Schema
>;
export type GithubRepositoryImportV1 = z.output<
  typeof githubRepositoryImportV1Schema
>;
export type ReviewGithubRepositoryImportV1 = z.output<
  typeof reviewGithubRepositoryImportV1Schema
>;
export type GithubRepositoryReconciliationReviewV1 = z.output<
  typeof githubRepositoryReconciliationReviewV1Schema
>;
export type CreateGithubRepositoryRefreshSubscriptionV1 = z.output<
  typeof createGithubRepositoryRefreshSubscriptionV1Schema
>;
export type GithubRepositoryRefreshSubscriptionV1 = z.output<
  typeof githubRepositoryRefreshSubscriptionV1Schema
>;
