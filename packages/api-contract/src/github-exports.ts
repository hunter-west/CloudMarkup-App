import {
  namespacedIdentifierSchema,
  repositoryRelativePathSchema,
  semanticVersionSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  createDataEnvelopeSchema,
  createListEnvelopeSchema,
  createOpaqueIdentifierSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./common.js";
import {
  integrationIdSchema,
  organizationIdSchema,
  projectIdSchema,
} from "./resources.js";
import { solutionExportArtifactIdSchema } from "./solution-exports.js";

export const githubExportPreviewIdSchema =
  createOpaqueIdentifierSchema("githubpreview");
export const githubExportExecutionIdSchema =
  createOpaqueIdentifierSchema("githubexport");
export const githubInstallationLinkIntentIdSchema =
  createOpaqueIdentifierSchema("githublink");

export const githubRepositoryIdSchema = z.coerce.number().int().positive();
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
export const githubBranchNameSchema = z
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
      !hasForbiddenGitBranchCharacter(value),
    "Must be a safe Git branch name.",
  );
const githubDestinationFolderSchema = z
  .string()
  .max(240)
  .refine((value) => value === value.trim())
  .refine((value) => !value.startsWith("/") && !value.endsWith("/"))
  .refine((value) => !value.includes("\\") && !value.includes("//"))
  .refine((value) => !value.includes("%") && !value.includes(":"))
  .refine(
    (value) =>
      value === "" ||
      value
        .split("/")
        .every(
          (segment) =>
            segment !== "." &&
            segment !== ".." &&
            segment.toLowerCase() !== ".git" &&
            /^[A-Za-z0-9._-]+$/.test(segment),
        ),
  );
const githubNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/);
export const gitShaSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);

const githubInstallationLinkStateSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const createGithubAppInstallationLinkIntentV1Schema = z
  .object({
    contractVersion: z.literal(1),
  })
  .strict();

export const completeGithubAppInstallationLinkV1Schema = z
  .object({
    callbackReceipt: z
      .string()
      .min(32)
      .max(2_048)
      .regex(/^[A-Za-z0-9._~-]+$/),
    contractVersion: z.literal(1),
    intentId: githubInstallationLinkIntentIdSchema,
  })
  .strict();

export const githubInstallationLinkIntentV1Schema = z
  .object({
    expiresAt: utcTimestampSchema,
    installationUrl: z.url(),
    intentId: githubInstallationLinkIntentIdSchema,
    state: githubInstallationLinkStateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const match =
      /^https:\/\/github\.com\/apps\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?\/installations\/new\?state=([A-Za-z0-9_-]+)$/u.exec(
        value.installationUrl,
      );
    if (match?.[1] !== value.state) {
      context.addIssue({
        code: "custom",
        message:
          "Installation URL must be the configured GitHub App URL bound to state.",
        path: ["installationUrl"],
      });
    }
  });

export const githubInstallationPathV1Schema = z
  .object({ organizationId: organizationIdSchema })
  .strict();

export const githubIntegrationPathV1Schema = z
  .object({
    integrationId: integrationIdSchema,
    organizationId: organizationIdSchema,
  })
  .strict();

export const githubRepositoryPathV1Schema = githubIntegrationPathV1Schema
  .extend({ repositoryId: githubRepositoryIdSchema })
  .strict();

export const githubAppPermissionsV1Schema = z
  .object({
    contents: z.enum(["none", "read", "write"]),
    metadata: z.enum(["none", "read", "write"]),
    pullRequests: z.enum(["none", "read", "write"]),
    workflows: z.enum(["none", "read", "write"]),
  })
  .strict();

export const githubInstallationV1Schema = z
  .object({
    accountId: z.number().int().positive(),
    accountLogin: githubNameSchema,
    accountType: z.enum(["Organization", "User"]),
    createdAt: utcTimestampSchema,
    integrationId: integrationIdSchema,
    installationId: z.number().int().positive(),
    organizationId: organizationIdSchema,
    permissions: githubAppPermissionsV1Schema,
    repositorySelection: z.enum(["all", "selected"]),
    status: z.enum([
      "connected",
      "reauthorization-required",
      "suspended",
      "deleted",
    ]),
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const githubRepositoryV1Schema = z
  .object({
    archived: z.boolean(),
    defaultBranch: githubBranchNameSchema,
    disabled: z.boolean(),
    installationId: z.number().int().positive(),
    integrationId: integrationIdSchema,
    name: githubNameSchema,
    nodeId: z.string().min(1).max(255),
    organizationId: organizationIdSchema,
    owner: githubNameSchema,
    private: z.boolean(),
    pushedAt: utcTimestampSchema.nullable(),
    repositoryId: githubRepositoryIdSchema,
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const githubBranchV1Schema = z
  .object({
    name: githubBranchNameSchema,
    protected: z.boolean(),
    sha: gitShaSchema,
  })
  .strict();

export const createGithubExportPreviewV1Schema = z
  .object({
    artifactId: solutionExportArtifactIdSchema,
    baseBranch: githubBranchNameSchema,
    contractVersion: z.literal(1),
    destinationFolder: githubDestinationFolderSchema,
    featureBranch: githubBranchNameSchema,
    includeWorkflows: z.boolean(),
    integrationId: integrationIdSchema,
    repositoryId: githubRepositoryIdSchema,
  })
  .strict();

export const executeGithubExportV1Schema = z
  .object({
    confirmedWorkflowFiles: z
      .array(
        z
          .object({
            digest: sha256DigestSchema,
            path: z.string().min(1).max(512),
          })
          .strict(),
      )
      .max(32),
    contractVersion: z.literal(1),
    previewDigest: sha256DigestSchema,
    previewId: githubExportPreviewIdSchema,
  })
  .strict();

export const githubExportIssueV1Schema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9-]{2,127}$/),
    message: z.string().min(1).max(500),
    path: z.string().min(1).max(512).optional(),
    severity: z.enum(["error", "warning", "info"]),
  })
  .strict();

export const githubExportFileChangeV1Schema = z
  .object({
    action: z.enum(["add", "delete", "modify", "preserve", "unchanged"]),
    binary: z.boolean(),
    currentDigest: sha256DigestSchema.optional(),
    ownership: z.enum([
      "architecture-as-code-source",
      "generated-replaceable",
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

export const githubExportSemanticDiffV1Schema = z
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

const githubExportStableIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "Must be a stable ID.");
const githubExportCanonicalNumericIdSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/, "Use the canonical decimal GitHub ID.");
function hasForbiddenReviewControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}
const githubExportReviewValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !hasForbiddenReviewControlCharacter(value), {
    message: "Review values cannot contain control characters.",
  });
const githubExportReviewMessageSchema = z.string().trim().min(1).max(512);
const githubExportWorkflowPathSchema = z.enum([
  ".github/workflows/cloudmarkup-deploy.yml",
  ".github/workflows/cloudmarkup-drift.yml",
  ".github/workflows/cloudmarkup-plan.yml",
  ".github/workflows/cloudmarkup-smoke.yml",
  ".github/workflows/cloudmarkup-validate.yml",
]);
const githubExportPackagePathSchema = repositoryRelativePathSchema.refine(
  (path) =>
    path !== "cloudmarkup/cloudmarkup.manifest.json" &&
    !path.startsWith(".github/workflows/"),
  "Package bindings must name package-local, non-workflow files.",
);
const githubExportToolPinSchema = z
  .object({
    digest: sha256DigestSchema,
    id: namespacedIdentifierSchema,
    version: semanticVersionSchema,
  })
  .strict();
const githubExportProvenanceSchema = z
  .object({
    producer: githubExportToolPinSchema,
    solutionRevisionId: githubExportStableIdSchema,
    sourceReferences: z
      .array(
        z
          .object({
            id: githubExportStableIdSchema,
            kind: z.enum([
              "application-artifact",
              "architecture",
              "artifact",
              "contract",
              "edge",
              "environment-binding",
              "evidence",
              "export",
              "extension",
              "operation",
              "policy",
              "resource",
              "solution-revision",
              "workload",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(2_048),
  })
  .strict();
const githubExportRepositoryWorkflowReviewSchema = z
  .object({
    environments: z
      .array(
        z
          .object({
            approvedRefs: z.array(githubExportReviewValueSchema).max(32),
            githubEnvironment: githubExportReviewValueSchema,
            id: githubExportStableIdSchema,
            protected: z.boolean(),
            smokeBaseUrlDigest: sha256DigestSchema,
            requiredApprovals: z.number().int().nonnegative().max(16),
            workspace: githubExportReviewValueSchema,
          })
          .strict(),
      )
      .max(32),
    permissions: z
      .array(
        z
          .object({
            access: z.enum(["none", "read", "write"]),
            explanation: githubExportReviewMessageSchema,
            scope: githubExportReviewValueSchema,
            workflowPath: githubExportWorkflowPathSchema,
          })
          .strict(),
      )
      .max(128),
    roles: z
      .array(
        z
          .object({
            audience: githubExportReviewValueSchema,
            environment: githubExportReviewValueSchema,
            purpose: githubExportReviewValueSchema,
            reference: githubExportReviewValueSchema,
            subject: githubExportReviewValueSchema,
            variable: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
          })
          .strict(),
      )
      .max(64),
    secrets: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
            purpose: githubExportReviewValueSchema,
          })
          .strict(),
      )
      .max(128),
    triggers: z
      .array(
        z
          .object({
            events: z.array(githubExportReviewValueSchema).min(1).max(16),
            workflowPath: githubExportWorkflowPathSchema,
          })
          .strict(),
      )
      .max(32),
    variables: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
            purpose: githubExportReviewValueSchema,
          })
          .strict(),
      )
      .max(128),
    workflows: z
      .array(
        z
          .object({
            environmentScoped: z.boolean(),
            path: githubExportWorkflowPathSchema,
            purpose: githubExportReviewValueSchema,
          })
          .strict(),
      )
      .min(1)
      .max(5),
    warnings: z
      .array(
        z
          .object({
            code: githubExportStableIdSchema,
            message: githubExportReviewMessageSchema,
          })
          .strict(),
      )
      .max(256),
  })
  .strict();

export const githubExportRepositoryWorkflowsV1Schema = z
  .object({
    configDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
    dependencyLockDigests: z
      .array(
        z
          .object({
            digest: sha256DigestSchema,
            id: githubExportStableIdSchema,
          })
          .strict(),
      )
      .min(1)
      .max(64),
    files: z
      .array(
        z
          .object({
            checksum: sha256DigestSchema,
            mediaType: z.literal("application/yaml"),
            ownership: z.literal("generated-replaceable"),
            path: githubExportWorkflowPathSchema,
            provenance: githubExportProvenanceSchema,
            semanticChecksum: sha256DigestSchema,
            sizeBytes: z
              .number()
              .int()
              .nonnegative()
              .max(32 * 1_024 * 1_024),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    generator: githubExportToolPinSchema,
    inclusionPolicy: z.literal(
      "explicit-workflow-permission-and-confirmation-required",
    ),
    kind: z.literal("cloudmarkup.reviewed-repository-workflows"),
    pinRegistryDigest: sha256DigestSchema,
    policyDigest: sha256DigestSchema,
    repository: z.discriminatedUnion("state", [
      z
        .object({
          defaultBranch: githubBranchNameSchema,
          destinationFolder: githubDestinationFolderSchema,
          name: githubNameSchema,
          owner: githubNameSchema,
          repositoryId: githubExportCanonicalNumericIdSchema,
          repositoryOwnerId: githubExportCanonicalNumericIdSchema,
          state: z.literal("bound"),
        })
        .strict(),
      z
        .object({
          destinationFolder: z.literal(""),
          state: z.literal("portable-unbound"),
        })
        .strict(),
    ]),
    requiredPackageTrees: z
      .array(
        z
          .object({
            files: z
              .array(
                z
                  .object({
                    checksum: sha256DigestSchema,
                    path: githubExportPackagePathSchema,
                  })
                  .strict(),
              )
              .min(1)
              .max(256),
            root: githubExportPackagePathSchema,
          })
          .strict(),
      )
      .max(32),
    resultDigest: sha256DigestSchema,
    review: githubExportRepositoryWorkflowReviewSchema,
    solutionRevision: z
      .object({
        digest: sha256DigestSchema,
        id: githubExportStableIdSchema,
      })
      .strict(),
    validator: githubExportToolPinSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const environmentIds = new Set(
      value.review.environments.map(({ id }) => id),
    );
    value.review.roles.forEach((role, index) => {
      if (!environmentIds.has(role.environment)) {
        context.addIssue({
          code: "custom",
          message: "OIDC roles must reference a declared environment.",
          path: ["review", "roles", index, "environment"],
        });
      }
    });
    value.files.forEach((file, index) => {
      if (
        file.provenance.solutionRevisionId !== value.solutionRevision.id ||
        file.provenance.producer.id !== value.generator.id ||
        file.provenance.producer.version !== value.generator.version ||
        file.provenance.producer.digest !== value.generator.digest
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Workflow inventory provenance must bind its revision and generator.",
          path: ["files", index, "provenance"],
        });
      }
    });
  });

export const githubExportPreviewV1Schema = z
  .object({
    artifactDigest: sha256DigestSchema,
    artifactId: solutionExportArtifactIdSchema,
    baseBranch: githubBranchNameSchema,
    baseCommitSha: gitShaSchema,
    changes: z.array(githubExportFileChangeV1Schema).max(4_096),
    createdAt: utcTimestampSchema,
    destinationFolder: githubDestinationFolderSchema,
    expiresAt: utcTimestampSchema,
    featureBranch: githubBranchNameSchema,
    includeWorkflows: z.boolean(),
    integrationId: integrationIdSchema,
    issues: z.array(githubExportIssueV1Schema).max(512),
    organizationId: organizationIdSchema,
    previewDigest: sha256DigestSchema,
    previousExportAuthority: z
      .object({
        authorityDigest: sha256DigestSchema,
        authorityId: githubExportExecutionIdSchema,
        inventoryDigest: sha256DigestSchema,
      })
      .strict()
      .optional(),
    previewId: githubExportPreviewIdSchema,
    projectId: projectIdSchema,
    ready: z.boolean(),
    repositoryId: githubRepositoryIdSchema,
    repositoryWorkflows: githubExportRepositoryWorkflowsV1Schema.optional(),
    repositoryName: githubNameSchema,
    repositoryOwner: githubNameSchema,
    semanticDiff: githubExportSemanticDiffV1Schema,
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

export const githubExportReceiptV1Schema = z
  .object({
    branch: githubBranchNameSchema,
    commitSha: gitShaSchema,
    completedAt: utcTimestampSchema,
    executionId: githubExportExecutionIdSchema,
    organizationId: organizationIdSchema,
    previewDigest: sha256DigestSchema,
    projectId: projectIdSchema,
    pullRequestNumber: z.number().int().positive(),
    pullRequestUrl: z.url().startsWith("https://"),
    repositoryId: githubRepositoryIdSchema,
  })
  .strict();

export const githubInstallationResponseV1Schema = createDataEnvelopeSchema(
  githubInstallationV1Schema,
);
export const githubInstallationLinkIntentResponseV1Schema =
  createDataEnvelopeSchema(githubInstallationLinkIntentV1Schema);

export const githubInstallationListResponseV1Schema = createListEnvelopeSchema(
  githubInstallationV1Schema,
);
export const githubRepositoryListResponseV1Schema = createListEnvelopeSchema(
  githubRepositoryV1Schema,
);
export const githubBranchListResponseV1Schema =
  createListEnvelopeSchema(githubBranchV1Schema);
export const githubExportPreviewResponseV1Schema = createDataEnvelopeSchema(
  githubExportPreviewV1Schema,
);
export const githubExportReceiptResponseV1Schema = createDataEnvelopeSchema(
  githubExportReceiptV1Schema,
);

export type CreateGithubAppInstallationLinkIntentV1 = z.output<
  typeof createGithubAppInstallationLinkIntentV1Schema
>;
export type CompleteGithubAppInstallationLinkV1 = z.output<
  typeof completeGithubAppInstallationLinkV1Schema
>;
export type GithubInstallationLinkIntentV1 = z.output<
  typeof githubInstallationLinkIntentV1Schema
>;
export type CreateGithubExportPreviewV1 = z.output<
  typeof createGithubExportPreviewV1Schema
>;
export type ExecuteGithubExportV1 = z.output<
  typeof executeGithubExportV1Schema
>;
export type GithubInstallationV1 = z.output<typeof githubInstallationV1Schema>;
export type GithubRepositoryV1 = z.output<typeof githubRepositoryV1Schema>;
export type GithubBranchV1 = z.output<typeof githubBranchV1Schema>;
export type GithubExportRepositoryWorkflowsV1 = z.output<
  typeof githubExportRepositoryWorkflowsV1Schema
>;
export type GithubExportPreviewV1 = z.output<
  typeof githubExportPreviewV1Schema
>;
export type GithubExportReceiptV1 = z.output<
  typeof githubExportReceiptV1Schema
>;
