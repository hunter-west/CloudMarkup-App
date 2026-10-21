import { z } from "zod";

import { sha256DigestSchema } from "@cloudmarkup/schemas";
import {
  SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT,
  SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS,
  solutionExportRepositoryWorkflowsV1Schema,
} from "@cloudmarkup/solution-export/contracts";
import { inspectExportPath } from "@cloudmarkup/solution-export/security";

export const GITHUB_REPOSITORY_EXPORT_LIMITS = Object.freeze({
  authorityFiles: 4_096,
  destinationBytes: 240,
  fileBytes: 32 * 1024 * 1024,
  files: 2_048,
  installationLinkSeconds: 10 * 60,
  previewSeconds: 30 * 60,
  repositoryBinaryBytes: 16 * 1024 * 1024,
  repositorySnapshotBytes: 128 * 1024 * 1024,
  repositoryTreeEntries: 20_000,
  webhookBytes: 1024 * 1024,
  webhookReplaySeconds: 24 * 60 * 60,
});

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const gitShaSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const repositoryNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/);
function hasForbiddenGitBranchCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit <= 0x20 ||
      codeUnit === 0x7f ||
      "~^:?*[\\".includes(value.charAt(index))
    ) {
      return true;
    }
  }
  return false;
}
const branchNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("refs/") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.includes("..") &&
      !value.includes("//") &&
      !hasForbiddenGitBranchCharacter(value) &&
      !value
        .split("/")
        .some((part) => part.startsWith(".") || part.endsWith(".lock")),
    "Must be a safe full Git reference name without the refs/heads prefix.",
  );

export const gitHubDestinationFolderSchema = z
  .string()
  .max(GITHUB_REPOSITORY_EXPORT_LIMITS.destinationBytes)
  .refine((path) => path === path.trim(), "Must not contain outer whitespace.")
  .refine((path) => !path.startsWith("/"), "Must be repository-relative.")
  .refine((path) => !path.endsWith("/"), "Must not end with a separator.")
  .refine((path) => !path.includes("\\"), "Must use POSIX separators.")
  .refine((path) => !path.includes("//"), "Must not contain empty segments.")
  .refine((path) => !path.includes("%"), "Encoded path syntax is not allowed.")
  .refine((path) => !path.includes(":"), "Drive and ADS syntax is not allowed.")
  .refine((path) => !path.includes("\0"), "NUL bytes are not allowed.")
  .refine(
    (path) =>
      path === "" ||
      path
        .split("/")
        .every(
          (segment) =>
            segment !== "." &&
            segment !== ".." &&
            segment.toLowerCase() !== ".git" &&
            /^[A-Za-z0-9._-]+$/.test(segment),
        ),
    "Must contain only portable safe path segments.",
  );

const PREVIOUS_EXPORT_AUTHORITY_PATH_MAX_BYTES = 512;

const gitHubPreviousExportAuthorityPathV1Schema = z
  .string()
  .min(1)
  .max(PREVIOUS_EXPORT_AUTHORITY_PATH_MAX_BYTES)
  .refine((path) => path === path.trim(), "Must not contain outer whitespace.")
  .refine((path) => !path.startsWith("/"), "Must be repository-relative.")
  .refine((path) => !path.endsWith("/"), "Must not end with a separator.")
  .refine((path) => !path.includes("\\"), "Must use POSIX separators.")
  .refine((path) => !path.includes("//"), "Must not contain empty segments.")
  .refine((path) => !path.includes("%"), "Encoded path syntax is not allowed.")
  .refine((path) => !path.includes(":"), "Drive and ADS syntax is not allowed.")
  .refine((path) => !path.includes("\0"), "NUL bytes are not allowed.")
  .refine(
    (path) =>
      path
        .split("/")
        .every(
          (segment) =>
            segment !== "." &&
            segment !== ".." &&
            segment.toLowerCase() !== ".git" &&
            /^[A-Za-z0-9._-]+$/.test(segment),
        ),
    "Must contain only portable safe path segments.",
  );

export const gitHubAppPermissionLevelSchema = z.enum(["none", "read", "write"]);

export const gitHubAppRepositoryPermissionsSchema = z
  .object({
    contents: gitHubAppPermissionLevelSchema,
    metadata: gitHubAppPermissionLevelSchema,
    pullRequests: gitHubAppPermissionLevelSchema,
    workflows: gitHubAppPermissionLevelSchema,
  })
  .strict();

export const gitHubInstallationRecordSchema = z
  .object({
    accountId: z.number().int().positive(),
    accountLogin: repositoryNameSchema,
    accountType: z.enum(["Organization", "User"]),
    createdAt: z.iso.datetime(),
    integrationId: opaqueIdSchema,
    installationId: z.number().int().positive(),
    organizationId: opaqueIdSchema,
    permissions: gitHubAppRepositoryPermissionsSchema,
    repositorySelection: z.enum(["all", "selected"]),
    status: z.enum([
      "connected",
      "reauthorization-required",
      "suspended",
      "deleted",
    ]),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const gitHubInstallationLinkStateSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const gitHubInstallationLinkIntentSchema = z
  .object({
    completedInstallationId: z.number().int().positive().optional(),
    completedIntegrationId: opaqueIdSchema.optional(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    intentId: opaqueIdSchema,
    organizationId: opaqueIdSchema,
    principalId: opaqueIdSchema,
    state: z.enum(["pending", "consumed", "completed"]),
    stateDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const hasCompletion =
      value.completedInstallationId !== undefined ||
      value.completedIntegrationId !== undefined;
    if (value.state === "completed") {
      if (
        value.completedInstallationId === undefined ||
        value.completedIntegrationId === undefined
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Completed link intents require the exact installation result.",
        });
      }
    } else if (hasCompletion) {
      context.addIssue({
        code: "custom",
        message:
          "Only completed link intents may include an installation result.",
      });
    }
    if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Link intent expiry must be after creation.",
        path: ["expiresAt"],
      });
    }
  });

export const gitHubInstallationLinkIntentReceiptSchema = z
  .object({
    expiresAt: z.iso.datetime(),
    installationUrl: z.url().startsWith("https://github.com/apps/"),
    intentId: opaqueIdSchema,
    state: gitHubInstallationLinkStateSchema,
  })
  .strict();

export const gitHubRepositoryRecordSchema = z
  .object({
    archived: z.boolean(),
    defaultBranch: branchNameSchema,
    disabled: z.boolean(),
    installationId: z.number().int().positive(),
    integrationId: opaqueIdSchema,
    name: repositoryNameSchema,
    nodeId: z.string().min(1).max(255),
    organizationId: opaqueIdSchema,
    owner: repositoryNameSchema,
    private: z.boolean(),
    pushedAt: z.iso.datetime().nullable(),
    repositoryId: z.number().int().positive(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const gitHubRepositoryBranchSchema = z
  .object({
    name: branchNameSchema,
    protected: z.boolean(),
    sha: gitShaSchema,
  })
  .strict();

export const gitHubExportIssueSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9-]{2,127}$/),
    message: z.string().min(1).max(500),
    path: z.string().min(1).max(512).optional(),
    severity: z.enum(["error", "warning", "info"]),
  })
  .strict();

export const gitHubExportFileChangeSchema = z
  .object({
    action: z.enum(["add", "delete", "modify", "preserve", "unchanged"]),
    binary: z.boolean(),
    currentDigest: sha256DigestSchema.optional(),
    ownership: z.enum([
      "architecture-as-code-source",
      "generated-replaceable",
      "ai-generated-review-required",
      "user-owned-extension",
      "user-provided",
      "generated-build-artifact",
      "evidence-artifact",
      "repository-unmanaged",
    ]),
    path: z.string().min(1).max(512),
    proposedDigest: sha256DigestSchema.optional(),
    reason: z.string().min(1).max(500),
    sizeBytes: z.number().int().nonnegative(),
    workflow: z.boolean(),
  })
  .strict();

export const gitHubExportSemanticDiffSchema = z
  .object({
    applicationChanged: z.boolean(),
    architectureChanged: z.boolean(),
    diagramChanged: z.boolean(),
    evidenceChanged: z.boolean(),
    externalResourcesChanged: z.boolean(),
    generatorChanged: z.boolean(),
    infrastructureChanged: z.boolean(),
    lockChanged: z.boolean(),
    solutionRevisionChanged: z.boolean(),
    workloadChanged: z.boolean(),
  })
  .strict();

const gitHubPreviousExportManagedOwnershipV1Schema = z.enum([
  "architecture-as-code-source",
  "generated-replaceable",
  "generated-build-artifact",
  "evidence-artifact",
]);

export const gitHubPreviousExportAuthorityFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    ownership: gitHubPreviousExportManagedOwnershipV1Schema,
    path: gitHubPreviousExportAuthorityPathV1Schema,
    workflow: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.workflow !== value.path.startsWith(".github/workflows/")) {
      context.addIssue({
        code: "custom",
        message:
          "The workflow flag must exactly match the GitHub workflow path root.",
        path: ["workflow"],
      });
    }
  });

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addPreviousExportAuthorityInventoryIssues(
  files: readonly { readonly path: string }[],
  context: z.RefinementCtx,
): void {
  const portablePaths = new Set<string>();
  files.forEach((file, index) => {
    if (
      index > 0 &&
      compareUtf16(files[index - 1]?.path ?? "", file.path) >= 0
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Previous-export authority files must be strictly sorted by UTF-16 path order.",
        path: ["files", index, "path"],
      });
    }
    const portablePath = file.path.normalize("NFC").toLowerCase();
    if (portablePaths.has(portablePath)) {
      context.addIssue({
        code: "custom",
        message:
          "Previous-export authority paths must be unique across portable filesystems.",
        path: ["files", index, "path"],
      });
    }
    portablePaths.add(portablePath);
  });
}

function addPreviousExportAuthorityScopeIssues(
  value: {
    readonly destinationFolder: string;
    readonly files: readonly {
      readonly path: string;
      readonly workflow: boolean;
    }[];
  },
  context: z.RefinementCtx,
): void {
  const destinationPrefix =
    value.destinationFolder.length === 0 ? "" : `${value.destinationFolder}/`;
  value.files.forEach((file, index) => {
    if (
      file.workflow &&
      !SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS.some(
        (reviewedPath) => reviewedPath === file.path,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Workflow authority is limited to exact reviewed repository workflow paths.",
        path: ["files", index, "path"],
      });
    } else if (
      !file.workflow &&
      destinationPrefix.length > 0 &&
      !file.path.startsWith(destinationPrefix)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Non-workflow authority paths must remain inside the exact destination folder.",
        path: ["files", index, "path"],
      });
    }
    if (
      !file.workflow &&
      (destinationPrefix.length === 0 ||
        file.path.startsWith(destinationPrefix))
    ) {
      const packagePath =
        destinationPrefix.length === 0
          ? file.path
          : file.path.slice(destinationPrefix.length);
      if (packagePath.startsWith(SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT)) {
        context.addIssue({
          code: "custom",
          message:
            "Repository workflow authority requires an exact reviewed root workflow path and workflow classification.",
          path: ["files", index, "path"],
        });
        return;
      }
      const pathIssue = inspectExportPath(
        packagePath,
        PREVIOUS_EXPORT_AUTHORITY_PATH_MAX_BYTES,
      );
      if (pathIssue !== undefined) {
        context.addIssue({
          code: "custom",
          message:
            "Previous-export authority paths must satisfy the canonical Solution export path policy: " +
            pathIssue.message,
          path: ["files", index, "path"],
        });
      }
    }
  });
}

const gitHubPreviousExportAuthorityPayloadV1Shape = {
  artifactDigest: sha256DigestSchema,
  artifactId: opaqueIdSchema,
  baseBranch: branchNameSchema,
  commitSha: gitShaSchema,
  completedAt: z.iso.datetime(),
  contractVersion: z.literal(1),
  destinationFolder: gitHubDestinationFolderSchema,
  executionId: opaqueIdSchema,
  featureBranch: branchNameSchema,
  files: z
    .array(gitHubPreviousExportAuthorityFileV1Schema)
    .max(GITHUB_REPOSITORY_EXPORT_LIMITS.authorityFiles),
  installationId: z.number().int().positive(),
  integrationId: opaqueIdSchema,
  inventoryDigest: sha256DigestSchema,
  kind: z.literal("github-previous-export-authority"),
  organizationId: opaqueIdSchema,
  previewDigest: sha256DigestSchema,
  projectId: opaqueIdSchema,
  pullRequestNumber: z.number().int().positive(),
  pullRequestUrl: z.url().startsWith("https://"),
  repositoryId: z.number().int().positive(),
  repositoryName: repositoryNameSchema,
  repositoryOwner: repositoryNameSchema,
  repositoryOwnerId: z.number().int().positive(),
} as const;

export const gitHubPreviousExportAuthorityPayloadV1Schema = z
  .object(gitHubPreviousExportAuthorityPayloadV1Shape)
  .strict()
  .superRefine((value, context) => {
    addPreviousExportAuthorityInventoryIssues(value.files, context);
    addPreviousExportAuthorityScopeIssues(value, context);
  });

export const gitHubPreviousExportAuthorityV1Schema = z
  .object({
    ...gitHubPreviousExportAuthorityPayloadV1Shape,
    authorityDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addPreviousExportAuthorityInventoryIssues(value.files, context);
    addPreviousExportAuthorityScopeIssues(value, context);
  });

export const gitHubPreviousExportAuthorityReferenceV1Schema = z
  .object({
    authorityDigest: sha256DigestSchema,
    authorityId: opaqueIdSchema,
    inventoryDigest: sha256DigestSchema,
  })
  .strict();

export const gitHubExportPreviewSchema = z
  .object({
    artifactDigest: sha256DigestSchema,
    artifactId: opaqueIdSchema,
    baseBranch: branchNameSchema,
    baseCommitSha: gitShaSchema,
    changes: z.array(gitHubExportFileChangeSchema).max(4_096),
    createdAt: z.iso.datetime(),
    repositoryWorkflows: solutionExportRepositoryWorkflowsV1Schema.optional(),
    destinationFolder: gitHubDestinationFolderSchema,
    expiresAt: z.iso.datetime(),
    featureBranch: branchNameSchema,
    includeWorkflows: z.boolean(),
    integrationId: opaqueIdSchema,
    issues: z.array(gitHubExportIssueSchema).max(512),
    organizationId: opaqueIdSchema,
    previousExportAuthority:
      gitHubPreviousExportAuthorityReferenceV1Schema.optional(),
    previewDigest: sha256DigestSchema,
    previewId: opaqueIdSchema,
    projectId: opaqueIdSchema,
    ready: z.boolean(),
    repositoryId: z.number().int().positive(),
    repositoryName: repositoryNameSchema,
    repositoryOwner: repositoryNameSchema,
    semanticDiff: gitHubExportSemanticDiffSchema,
    snapshotDigest: sha256DigestSchema,
    workflowFiles: z
      .array(
        z
          .object({
            digest: sha256DigestSchema,
            path: z.string().min(1).max(512),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();

export const gitHubExportReceiptSchema = z
  .object({
    branch: branchNameSchema,
    commitSha: gitShaSchema,
    completedAt: z.iso.datetime(),
    executionId: opaqueIdSchema,
    organizationId: opaqueIdSchema,
    previewDigest: sha256DigestSchema,
    projectId: opaqueIdSchema,
    pullRequestNumber: z.number().int().positive(),
    pullRequestUrl: z.url().startsWith("https://"),
    repositoryId: z.number().int().positive(),
  })
  .strict();

export type GitHubAppRepositoryPermissions = z.output<
  typeof gitHubAppRepositoryPermissionsSchema
>;
export type GitHubInstallationRecord = z.output<
  typeof gitHubInstallationRecordSchema
>;
export type GitHubRepositoryRecord = z.output<
  typeof gitHubRepositoryRecordSchema
>;
export type GitHubInstallationLinkIntent = z.output<
  typeof gitHubInstallationLinkIntentSchema
>;
export type GitHubInstallationLinkIntentReceipt = z.output<
  typeof gitHubInstallationLinkIntentReceiptSchema
>;
export type GitHubRepositoryBranch = z.output<
  typeof gitHubRepositoryBranchSchema
>;
export type GitHubExportIssue = z.output<typeof gitHubExportIssueSchema>;
export type GitHubExportFileChange = z.output<
  typeof gitHubExportFileChangeSchema
>;
export type GitHubExportSemanticDiff = z.output<
  typeof gitHubExportSemanticDiffSchema
>;
export type GitHubPreviousExportAuthorityFileV1 = z.output<
  typeof gitHubPreviousExportAuthorityFileV1Schema
>;
export type GitHubPreviousExportAuthorityPayloadV1 = z.output<
  typeof gitHubPreviousExportAuthorityPayloadV1Schema
>;
export type GitHubPreviousExportAuthorityV1 = z.output<
  typeof gitHubPreviousExportAuthorityV1Schema
>;
export type GitHubPreviousExportAuthorityReferenceV1 = z.output<
  typeof gitHubPreviousExportAuthorityReferenceV1Schema
>;
export type GitHubExportPreview = z.output<typeof gitHubExportPreviewSchema>;
export type GitHubExportReceipt = z.output<typeof gitHubExportReceiptSchema>;
export type GitSha = z.output<typeof gitShaSchema>;

export const gitHubBranchNameSchema = branchNameSchema;
export const gitHubRepositoryNameSchema = repositoryNameSchema;
export const gitHubOpaqueIdSchema = opaqueIdSchema;
export const gitHubShaSchema = gitShaSchema;
