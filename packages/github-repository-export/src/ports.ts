import type { Sha256Digest } from "@cloudmarkup/schemas";
import type { SolutionExportArtifactV1 } from "@cloudmarkup/solution-export";

import type {
  GitHubAppRepositoryPermissions,
  GitHubExportPreview,
  GitHubExportReceipt,
  GitHubInstallationLinkIntent,
  GitHubInstallationRecord,
  GitHubPreviousExportAuthorityV1,
  GitHubRepositoryBranch,
  GitHubRepositoryRecord,
  GitSha,
} from "./contracts.js";
import type { GitHubExportErrorCode } from "./errors.js";

export interface GitHubAppConfiguration {
  readonly apiBaseUrl: string;
  readonly apiVersion: string;
  readonly appId: string;
  readonly privateKeySecretReference: string;
  readonly userAgent: string;
  readonly webhookSecretReference: string;
}

export interface SecretConfigurationResolver {
  /** Returns a fresh mutable buffer. The caller must zero it immediately. */
  resolveSecret(reference: string): Promise<Uint8Array>;
}

export interface GitHubInstallationDescriptor {
  readonly accountId: number;
  readonly accountLogin: string;
  readonly accountType: "Organization" | "User";
  readonly installationId: number;
  readonly permissions: GitHubAppRepositoryPermissions;
  readonly repositorySelection: "all" | "selected";
  readonly suspended: boolean;
}

export interface GitHubRepositoryDescriptor {
  readonly archived: boolean;
  readonly defaultBranch: string;
  readonly disabled: boolean;
  readonly installationId: number;
  readonly name: string;
  readonly nodeId: string;
  readonly owner: string;
  readonly ownerId: number;
  readonly private: boolean;
  readonly pushedAt: string | null;
  readonly repositoryId: number;
}

export interface GitHubRepositorySnapshotFile {
  readonly bytes: Uint8Array;
  readonly digest: Sha256Digest;
  readonly gitBlobSha: GitSha;
  readonly path: string;
}

export interface GitHubRepositorySnapshot {
  readonly baseBranch: string;
  readonly baseCommitSha: GitSha;
  readonly defaultBranch: string;
  readonly files: readonly GitHubRepositorySnapshotFile[];
  readonly repositoryId: number;
  readonly repositoryName: string;
  readonly repositoryOwner: string;
  readonly repositoryOwnerId: number;
  readonly treeSha: GitSha;
}

export interface GitHubRepositoryImportIgnoredFile {
  readonly path: string;
  readonly reason:
    "explicitly-ignored" | "sensitive-path" | "unsupported-file-type";
}

export interface GitHubPinnedRepositorySnapshot extends Omit<
  GitHubRepositorySnapshot,
  "baseCommitSha"
> {
  readonly branch: string;
  readonly branchHeadSha: GitSha;
  readonly commitSha: GitSha;
  readonly ignoredFiles: readonly GitHubRepositoryImportIgnoredFile[];
}

export interface GitHubPinnedRepositoryDiscovery {
  readonly branch: string;
  readonly branchHeadSha: GitSha;
  readonly commitSha: GitSha;
  readonly files: readonly {
    readonly gitBlobSha: GitSha;
    readonly path: string;
    readonly sizeBytes: number;
  }[];
  readonly repositoryId: number;
  readonly treeSha: GitSha;
}

export interface GitHubFileMutation {
  readonly bytes?: Uint8Array;
  readonly path: string;
  readonly type: "delete" | "upsert";
}

export interface GitHubPullRequestDescriptor {
  readonly number: number;
  readonly url: string;
}

export interface GitHubInstallationSession {
  createBranch(input: {
    readonly baseCommitSha: GitSha;
    readonly branch: string;
    readonly repository: GitHubRepositoryDescriptor;
  }): Promise<void>;
  createCommit(input: {
    readonly branch: string;
    readonly expectedHeadSha: GitSha;
    readonly message: string;
    readonly mutations: readonly GitHubFileMutation[];
    readonly repository: GitHubRepositoryDescriptor;
  }): Promise<GitSha>;
  createPullRequest(input: {
    readonly baseBranch: string;
    readonly body: string;
    readonly featureBranch: string;
    readonly repository: GitHubRepositoryDescriptor;
    readonly title: string;
  }): Promise<GitHubPullRequestDescriptor>;
  findBranch(input: {
    readonly branch: string;
    readonly repository: GitHubRepositoryDescriptor;
  }): Promise<{ readonly sha: GitSha } | null>;
  findPullRequest(input: {
    readonly baseBranch: string;
    readonly featureBranch: string;
    readonly repository: GitHubRepositoryDescriptor;
  }): Promise<GitHubPullRequestDescriptor | null>;
  findMergeBase(input: {
    readonly baseCommitSha: GitSha;
    readonly headCommitSha: GitSha;
    readonly repository: GitHubRepositoryDescriptor;
  }): Promise<GitSha>;
  listBranches(
    repository: GitHubRepositoryDescriptor,
  ): Promise<readonly GitHubRepositoryBranch[]>;
  listRepositories(): Promise<readonly GitHubRepositoryDescriptor[]>;
  readSnapshot(input: {
    readonly candidatePaths: readonly string[];
    readonly baseBranch: string;
    readonly destinationFolder: string;
    readonly repository: GitHubRepositoryDescriptor;
    readonly workflowPaths: readonly string[];
  }): Promise<GitHubRepositorySnapshot>;
  discoverPinnedFiles(input: {
    readonly branch: string;
    readonly commitSha: GitSha;
    readonly ignoredPaths: readonly string[];
    readonly repository: GitHubRepositoryDescriptor;
    readonly selectedPaths: readonly string[];
  }): Promise<GitHubPinnedRepositoryDiscovery>;
  readPinnedSnapshot(input: {
    readonly branch: string;
    readonly commitSha: GitSha;
    readonly ignoredPaths: readonly string[];
    readonly repository: GitHubRepositoryDescriptor;
    readonly selectedPaths: readonly string[];
  }): Promise<GitHubPinnedRepositorySnapshot>;
}

export interface GitHubAppAdapter {
  inspectInstallation(
    installationId: number,
  ): Promise<GitHubInstallationDescriptor>;
  withInstallationSession<T>(
    input: {
      readonly installationId: number;
      readonly permissions: GitHubAppRepositoryPermissions;
      readonly repositoryIds?: readonly number[];
    },
    operation: (session: GitHubInstallationSession) => Promise<T>,
  ): Promise<T>;
  withRepositoryReadSession<T>(
    input: {
      readonly installationId: number;
      readonly repositoryIds: readonly number[];
    },
    operation: (
      session: Pick<
        GitHubInstallationSession,
        | "listBranches"
        | "listRepositories"
        | "readPinnedSnapshot"
        | "discoverPinnedFiles"
      >,
    ) => Promise<T>,
  ): Promise<T>;
}

export interface VerifiedGitHubInstallationLinkCallback {
  readonly verifiedAccount?: {
    readonly accountId: number;
    readonly accountType: "Organization" | "User";
    readonly repositorySelection: "selected";
  };
  readonly installationId: number;
  readonly setupAction: "install";
  readonly state: string;
}

/**
 * Verifies a host-issued receipt for the exact GitHub redirect callback.
 * Implementations must fail closed; a caller-provided installation ID is not proof.
 * Verification of the same exact opaque receipt must be idempotent until its
 * bound link intent expires so a transient post-verification failure can be
 * retried safely. Neither the verifier nor this service may persist, log, or
 * expose the opaque receipt after verification.
 */
export interface GitHubInstallationLinkCallbackVerifier {
  verifyCallbackReceipt(
    callbackReceipt: string,
    context?: {
      readonly intentId: string;
      readonly organizationId: string;
      readonly principalId: string;
      readonly sessionId?: string;
    },
  ): Promise<VerifiedGitHubInstallationLinkCallback>;
}

export interface ApprovedSolutionPackageRecord {
  readonly artifact: SolutionExportArtifactV1;
  readonly artifactId: string;
  readonly organizationId: string;
  readonly projectId: string;
}

export interface ApprovedSolutionPackageRepository {
  getApprovedPackage(input: {
    readonly artifactId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<ApprovedSolutionPackageRecord | null>;
}

export interface StoredGitHubExportPreview {
  readonly createdByPrincipalId: string;
  readonly preview: GitHubExportPreview;
  readonly request: {
    readonly artifactId: string;
    readonly baseBranch: string;
    readonly destinationFolder: string;
    readonly featureBranch: string;
    readonly includeWorkflows: boolean;
    readonly integrationId: string;
    readonly repositoryId: number;
  };
}

export interface StoredGitHubExportExecution {
  readonly authority?: GitHubPreviousExportAuthorityV1;
  readonly artifactDigest: Sha256Digest;
  readonly branchCreated: boolean;
  readonly commitSha?: GitSha;
  readonly createdByPrincipalId: string;
  readonly executionId: string;
  readonly failureCode?: GitHubExportErrorCode;
  readonly idempotencyKeyDigest: Sha256Digest;
  readonly organizationId: string;
  readonly previewDigest: Sha256Digest;
  readonly previewId: string;
  readonly projectId: string;
  readonly receipt?: GitHubExportReceipt;
  readonly recordVersion: number;
  readonly state:
    "running" | "succeeded" | "failed-transient" | "failed-permanent";
  readonly updatedAt: string;
}

export interface GitHubWebhookDeliveryRecord {
  readonly deliveryId: string;
  readonly event: string;
  readonly payloadDigest: Sha256Digest;
  readonly processedAt?: string;
  readonly receivedAt: string;
  readonly state: "received" | "processed" | "ignored" | "failed";
}

export type GitHubExportExecutionClaim =
  | Readonly<{ outcome: "acquired"; record: StoredGitHubExportExecution }>
  | Readonly<{
      outcome: "conflict" | "in-progress" | "terminal";
      record: StoredGitHubExportExecution;
    }>;

export type GitHubExportExecutionSave = Readonly<{
  outcome: "saved" | "stale";
  record: StoredGitHubExportExecution;
}>;

export interface GitHubPreviousExportAuthorityTarget {
  readonly baseBranch: string;
  readonly destinationFolder: string;
  readonly installationId: number;
  readonly integrationId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly repositoryId: number;
  readonly repositoryOwnerId: number;
}

export interface GitHubExportStore {
  /** Atomically saves the installation and completes the exact consumed intent. */
  finalizeInstallationLink(input: {
    readonly installation: GitHubInstallationRecord;
    readonly intentId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly stateDigest: Sha256Digest;
  }): Promise<void>;
  consumeInstallationLinkIntent(input: {
    readonly intentId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly stateDigest: Sha256Digest;
  }): Promise<
    | {
        readonly outcome: "consumed";
        readonly record: GitHubInstallationLinkIntent;
      }
    | {
        readonly outcome: "completed";
        readonly record: GitHubInstallationLinkIntent;
      }
    | { readonly outcome: "expired" | "invalid" | "replayed" }
  >;
  /**
   * Releases only the exact, still-unexpired consumed intent after a transient
   * post-consume failure. A completed intent is an idempotent no-op.
   */
  releaseInstallationLinkIntent(input: {
    readonly intentId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly stateDigest: Sha256Digest;
  }): Promise<"completed" | "expired" | "invalid" | "released">;
  getExecutionByIdempotency(input: {
    readonly idempotencyKeyDigest: Sha256Digest;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<StoredGitHubExportExecution | null>;
  getInstallation(input: {
    readonly integrationId: string;
    readonly organizationId: string;
  }): Promise<GitHubInstallationRecord | null>;
  getInstallationByInstallationId(
    installationId: number,
  ): Promise<GitHubInstallationRecord | null>;
  listInstallations(input: {
    readonly organizationId: string;
  }): Promise<readonly GitHubInstallationRecord[]>;
  getPreview(input: {
    readonly organizationId: string;
    readonly previewId: string;
    readonly projectId: string;
  }): Promise<StoredGitHubExportPreview | null>;
  getRepository(input: {
    readonly integrationId: string;
    readonly organizationId: string;
    readonly repositoryId: number;
  }): Promise<GitHubRepositoryRecord | null>;
  findLatestPreviousExportAuthority(
    input: GitHubPreviousExportAuthorityTarget,
  ): Promise<GitHubPreviousExportAuthorityV1 | null>;
  getPreviousExportAuthority(input: {
    readonly authorityId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<GitHubPreviousExportAuthorityV1 | null>;
  reserveExecution(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubExportExecution;
  }): Promise<GitHubExportExecutionClaim>;
  reserveInstallationLinkIntent(record: GitHubInstallationLinkIntent): Promise<{
    readonly created: boolean;
    readonly record: GitHubInstallationLinkIntent;
  }>;
  reserveWebhookDelivery(record: GitHubWebhookDeliveryRecord): Promise<{
    readonly created: boolean;
    readonly record: GitHubWebhookDeliveryRecord;
  }>;
  saveExecution(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubExportExecution;
  }): Promise<GitHubExportExecutionSave>;
  saveInstallation(record: GitHubInstallationRecord): Promise<void>;
  savePreview(record: StoredGitHubExportPreview): Promise<void>;
  saveRepositories(input: {
    readonly integrationId: string;
    readonly installationId: number;
    readonly organizationId: string;
    readonly repositories: readonly GitHubRepositoryRecord[];
  }): Promise<void>;
  updateInstallationStatus(input: {
    readonly installationId: number;
    readonly status: GitHubInstallationRecord["status"];
    readonly updatedAt: string;
  }): Promise<void>;
  updateRepositoryLifecycle(input: {
    readonly installationId: number;
    readonly repositoryId: number;
    readonly state: "deleted" | "transferred";
    readonly updatedAt: string;
  }): Promise<void>;
  updateWebhookDelivery(record: GitHubWebhookDeliveryRecord): Promise<void>;
}

export interface GitHubExportAuditEvent {
  readonly action: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly organizationId?: string;
  readonly outcome: "denied" | "failed" | "succeeded";
  readonly principalId?: string;
  readonly summary: string;
  readonly targetId?: string;
  readonly targetKind:
    "installation" | "preview" | "repository" | "webhook" | "export";
}

export interface GitHubExportAuditSink {
  record(event: GitHubExportAuditEvent): Promise<void>;
}

export interface GitHubExportProgressEvent {
  readonly at: string;
  readonly executionId?: string;
  readonly message: string;
  readonly organizationId: string;
  readonly projectId?: string;
  readonly stage:
    | "authorization"
    | "discovery"
    | "preview"
    | "stale-check"
    | "branch"
    | "commit"
    | "pull-request"
    | "complete";
  readonly state: "failed" | "running" | "succeeded";
}

export interface GitHubExportProgressSink {
  record(event: GitHubExportProgressEvent): Promise<void>;
}
