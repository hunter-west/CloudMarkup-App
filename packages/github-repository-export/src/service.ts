import { randomBytes, randomUUID } from "node:crypto";

import {
  NO_CREDENTIAL_PULL_REQUEST_WORKFLOW_PATH,
  SOLUTION_EXPORT_PRIVILEGED_REPOSITORY_WORKFLOW_PATHS,
  SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT,
  SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS,
  solutionExportManifestV1Schema,
  verifySolutionExportArtifact,
  type SolutionExportArtifactV1,
  type SolutionExportManifestV1,
  type SolutionExportOwnershipKindV1,
} from "@cloudmarkup/solution-export";
import type { Sha256Digest } from "@cloudmarkup/schemas";

import {
  GITHUB_REPOSITORY_EXPORT_LIMITS,
  gitHubBranchNameSchema,
  gitHubDestinationFolderSchema,
  gitHubInstallationLinkIntentReceiptSchema,
  gitHubInstallationLinkIntentSchema,
  gitHubInstallationLinkStateSchema,
  gitHubExportPreviewSchema,
  gitHubExportReceiptSchema,
  gitHubInstallationRecordSchema,
  gitHubPreviousExportAuthorityV1Schema,
  gitHubRepositoryRecordSchema,
  type GitHubAppRepositoryPermissions,
  type GitHubExportFileChange,
  type GitHubExportIssue,
  type GitHubExportPreview,
  type GitHubExportReceipt,
  type GitHubInstallationLinkIntentReceipt,
  type GitHubPreviousExportAuthorityFileV1,
  type GitHubPreviousExportAuthorityPayloadV1,
  type GitHubPreviousExportAuthorityV1,
  type GitHubExportSemanticDiff,
  type GitHubInstallationRecord,
  type GitHubRepositoryBranch,
  type GitHubRepositoryRecord,
} from "./contracts.js";
import { GitHubExportError, safeGitHubExportError } from "./errors.js";
import type {
  ApprovedSolutionPackageRecord,
  GitHubInstallationLinkCallbackVerifier,
  GitHubAppAdapter,
  GitHubExportAuditSink,
  GitHubExportProgressSink,
  GitHubExportStore,
  GitHubFileMutation,
  GitHubRepositoryDescriptor,
  GitHubRepositorySnapshot,
  StoredGitHubExportExecution,
} from "./ports.js";
import {
  assertNoCaseFoldCollisions,
  canonicalDigest,
  destinationPath,
  inspectApprovedPackage,
  isLikelyBinary,
  isWorkflowPath,
  validateFeatureBranch,
  sha256Digest,
} from "./security.js";

const decoder = new TextDecoder("utf-8", { fatal: true });

const READ_PERMISSIONS: GitHubAppRepositoryPermissions = {
  contents: "read",
  metadata: "read",
  pullRequests: "none",
  workflows: "none",
};
const SENSITIVE_PLAN_WORKFLOW_PATH =
  ".github/workflows/cloudmarkup-plan.yml" as const;

function workflowSnapshotPaths(
  artifact: SolutionExportArtifactV1,
): readonly string[] {
  return [
    ...new Set([
      ...SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS,
      ...(artifact.manifest.repositoryWorkflows?.files.map(
        ({ path }) => path,
      ) ?? []),
      ...artifact.files
        .filter(({ path }) => isWorkflowPath(path))
        .map(({ path }) => path),
    ]),
  ].sort((left, right) => left.localeCompare(right, "en"));
}

function candidateSnapshotPaths(input: {
  readonly artifact: SolutionExportArtifactV1;
  readonly destinationFolder: string;
  readonly includeWorkflows: boolean;
}): readonly string[] {
  return input.artifact.files
    .filter(({ path }) => input.includeWorkflows || !isWorkflowPath(path))
    .map(({ path }) => destinationPath(path, input.destinationFolder))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function includesPrivilegedCustomerCiWorkflow(
  paths: readonly string[],
): boolean {
  return SOLUTION_EXPORT_PRIVILEGED_REPOSITORY_WORKFLOW_PATHS.some((path) =>
    paths.includes(path),
  );
}

function includesSensitiveReviewedPlanWorkflow(
  artifact: SolutionExportArtifactV1,
): boolean {
  return (
    artifact.manifest.repositoryWorkflows?.files.some(
      ({ path }) => path === SENSITIVE_PLAN_WORKFLOW_PATH,
    ) ?? false
  );
}

function writePermissions(
  includeWorkflows: boolean,
): GitHubAppRepositoryPermissions {
  return {
    contents: "write",
    metadata: "read",
    pullRequests: "write",
    workflows: includeWorkflows ? "write" : "none",
  };
}

function levelAtLeast(actual: string, required: string): boolean {
  const rank = { none: 0, read: 1, write: 2 } as const;
  return (
    rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
  );
}

function permissionsAllow(
  actual: GitHubAppRepositoryPermissions,
  required: GitHubAppRepositoryPermissions,
): boolean {
  return (
    levelAtLeast(actual.contents, required.contents) &&
    levelAtLeast(actual.metadata, required.metadata) &&
    levelAtLeast(actual.pullRequests, required.pullRequests) &&
    levelAtLeast(actual.workflows, required.workflows)
  );
}

function issue(
  code: string,
  message: string,
  severity: GitHubExportIssue["severity"],
  path?: string,
): GitHubExportIssue {
  return { code, message, ...(path === undefined ? {} : { path }), severity };
}

function descriptor(
  record: GitHubRepositoryRecord,
  repositoryOwnerId: number,
): GitHubRepositoryDescriptor {
  return {
    archived: record.archived,
    defaultBranch: record.defaultBranch,
    disabled: record.disabled,
    installationId: record.installationId,
    name: record.name,
    nodeId: record.nodeId,
    owner: record.owner,
    ownerId: repositoryOwnerId,
    private: record.private,
    pushedAt: record.pushedAt,
    repositoryId: record.repositoryId,
  };
}

function publicRepository(
  organizationId: string,
  integrationId: string,
  repository: GitHubRepositoryDescriptor,
  now: string,
): GitHubRepositoryRecord {
  return gitHubRepositoryRecordSchema.parse({
    archived: repository.archived,
    defaultBranch: repository.defaultBranch,
    disabled: repository.disabled,
    installationId: repository.installationId,
    integrationId,
    name: repository.name,
    nodeId: repository.nodeId,
    organizationId,
    owner: repository.owner,
    private: repository.private,
    pushedAt: repository.pushedAt,
    repositoryId: repository.repositoryId,
    updatedAt: now,
  });
}

function parsePreviousManifest(
  snapshot: GitHubRepositorySnapshot,
  destinationFolder: string,
): SolutionExportManifestV1 | null {
  const path = destinationPath(
    "cloudmarkup/cloudmarkup.manifest.json",
    destinationFolder,
  );
  const file = snapshot.files.find((candidate) => candidate.path === path);
  if (file === undefined) return null;
  try {
    return solutionExportManifestV1Schema.parse(
      JSON.parse(decoder.decode(file.bytes)),
    );
  } catch {
    return null;
  }
}

function relativePackagePath(
  path: string,
  destinationFolder: string,
): string | null {
  if (isWorkflowPath(path)) return path;
  if (destinationFolder === "") return path;
  const prefix = `${destinationFolder}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function previousOwnership(
  manifest: SolutionExportManifestV1,
  packagePath: string,
): SolutionExportOwnershipKindV1 | undefined {
  if (packagePath === "cloudmarkup/cloudmarkup.manifest.json") {
    return "generated-replaceable";
  }
  return manifest.files.find(({ path }) => path === packagePath)?.ownership;
}

function semanticDiff(
  current: SolutionExportManifestV1 | null,
  proposed: SolutionExportManifestV1,
): GitHubExportSemanticDiff {
  const changed = (path: string) => {
    const proposedEntry = proposed.files.find((entry) => entry.path === path);
    const currentEntry = current?.files.find((entry) => entry.path === path);
    return proposedEntry?.semanticChecksum !== currentEntry?.semanticChecksum;
  };
  const prefixChanged = (prefix: string) => {
    const left = (current?.files ?? [])
      .filter(({ path }) => path.startsWith(prefix))
      .map(({ path, semanticChecksum }) => ({ path, semanticChecksum }));
    const right = proposed.files
      .filter(({ path }) => path.startsWith(prefix))
      .map(({ path, semanticChecksum }) => ({ path, semanticChecksum }));
    return canonicalDigest(left) !== canonicalDigest(right);
  };
  return {
    applicationChanged: prefixChanged("application/"),
    architectureChanged: changed("cloudmarkup/architecture.json"),
    diagramChanged: prefixChanged("diagram/"),
    evidenceChanged: prefixChanged("evidence/"),
    externalResourcesChanged: changed("cloudmarkup/external-resources.json"),
    generatorChanged:
      canonicalDigest(current?.tools.generator ?? null) !==
      canonicalDigest(proposed.tools.generator),
    infrastructureChanged: prefixChanged("infrastructure/"),
    lockChanged: changed("cloudmarkup/cloudmarkup.lock.json"),
    solutionRevisionChanged:
      current?.solutionRevision.digest !== proposed.solutionRevision.digest,
    workloadChanged: changed("cloudmarkup/workloads.json"),
  };
}

function snapshotDigest(snapshot: GitHubRepositorySnapshot): Sha256Digest {
  return canonicalDigest({
    baseCommitSha: snapshot.baseCommitSha,
    files: snapshot.files
      .map(({ digest, path }) => ({ digest, path }))
      .sort((left, right) => left.path.localeCompare(right.path, "en")),
    repositoryId: snapshot.repositoryId,
    repositoryOwnerId: snapshot.repositoryOwnerId,
    treeSha: snapshot.treeSha,
  });
}

const MANAGED_EXPORT_OWNERSHIP = new Set<SolutionExportOwnershipKindV1>([
  "architecture-as-code-source",
  "generated-replaceable",
  "generated-build-artifact",
  "evidence-artifact",
]);

function isManagedExportOwnership(
  ownership: SolutionExportOwnershipKindV1,
): ownership is GitHubPreviousExportAuthorityFileV1["ownership"] {
  return MANAGED_EXPORT_OWNERSHIP.has(ownership);
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function authorityPayload(
  authority: GitHubPreviousExportAuthorityV1,
): GitHubPreviousExportAuthorityPayloadV1 {
  const { authorityDigest: ignored, ...payload } = authority;
  void ignored;
  return payload;
}

function withoutTerminalEvidence(
  record: StoredGitHubExportExecution,
): Omit<StoredGitHubExportExecution, "authority" | "receipt"> {
  const {
    authority: ignoredAuthority,
    receipt: ignoredReceipt,
    ...remaining
  } = record;
  void ignoredAuthority;
  void ignoredReceipt;
  return remaining;
}

function hasValidAuthorityDigests(
  authority: GitHubPreviousExportAuthorityV1,
): boolean {
  const parsed = gitHubPreviousExportAuthorityV1Schema.safeParse(authority);
  const destinationPrefix =
    authority.destinationFolder.length === 0
      ? ""
      : `${authority.destinationFolder}/`;
  return (
    parsed.success &&
    authority.files.every(({ path, workflow }) => {
      const reviewedWorkflow =
        SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS.some(
          (reviewedPath) => reviewedPath === path,
        );
      if (workflow) return reviewedWorkflow;
      if (reviewedWorkflow) return false;
      if (destinationPrefix.length > 0 && !path.startsWith(destinationPrefix)) {
        return false;
      }
      const packagePath =
        destinationPrefix.length === 0
          ? path
          : path.slice(destinationPrefix.length);
      return !packagePath.startsWith(SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT);
    }) &&
    authority.inventoryDigest === canonicalDigest(authority.files) &&
    authority.authorityDigest === canonicalDigest(authorityPayload(authority))
  );
}

function succeededReceiptForReplay(
  record: StoredGitHubExportExecution,
): GitHubExportReceipt | null {
  const receipt = gitHubExportReceiptSchema.safeParse(record.receipt);
  const authority = gitHubPreviousExportAuthorityV1Schema.safeParse(
    record.authority,
  );
  if (
    record.state !== "succeeded" ||
    !record.branchCreated ||
    record.failureCode !== undefined ||
    record.commitSha === undefined ||
    !receipt.success ||
    !authority.success ||
    !hasValidAuthorityDigests(authority.data)
  ) {
    return null;
  }
  return authority.data.executionId === record.executionId &&
    receipt.data.executionId === record.executionId &&
    authority.data.organizationId === record.organizationId &&
    receipt.data.organizationId === record.organizationId &&
    authority.data.projectId === record.projectId &&
    receipt.data.projectId === record.projectId &&
    authority.data.previewDigest === record.previewDigest &&
    receipt.data.previewDigest === record.previewDigest &&
    authority.data.artifactDigest === record.artifactDigest &&
    authority.data.commitSha === record.commitSha &&
    receipt.data.commitSha === record.commitSha &&
    authority.data.completedAt === receipt.data.completedAt &&
    record.updatedAt === receipt.data.completedAt &&
    authority.data.pullRequestNumber === receipt.data.pullRequestNumber &&
    authority.data.pullRequestUrl === receipt.data.pullRequestUrl &&
    authority.data.repositoryId === receipt.data.repositoryId &&
    authority.data.featureBranch === receipt.data.branch
    ? receipt.data
    : null;
}

function executionMatchesReplayRequest(
  record: StoredGitHubExportExecution,
  input: {
    readonly idempotencyKeyDigest: Sha256Digest;
    readonly organizationId: string;
    readonly previewDigest: Sha256Digest;
    readonly previewId: string;
    readonly principalId: string;
    readonly projectId: string;
  },
): boolean {
  return (
    record.createdByPrincipalId === input.principalId &&
    record.idempotencyKeyDigest === input.idempotencyKeyDigest &&
    record.organizationId === input.organizationId &&
    record.previewDigest === input.previewDigest &&
    record.previewId === input.previewId &&
    record.projectId === input.projectId
  );
}

function authorityMatchesTarget(
  authority: GitHubPreviousExportAuthorityV1,
  target: {
    readonly baseBranch: string;
    readonly destinationFolder: string;
    readonly installationId: number;
    readonly integrationId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly repositoryId: number;
    readonly repositoryName: string;
    readonly repositoryOwner: string;
    readonly repositoryOwnerId: number;
  },
): boolean {
  return (
    authority.baseBranch === target.baseBranch &&
    authority.destinationFolder === target.destinationFolder &&
    authority.installationId === target.installationId &&
    authority.integrationId === target.integrationId &&
    authority.organizationId === target.organizationId &&
    authority.projectId === target.projectId &&
    authority.repositoryId === target.repositoryId &&
    authority.repositoryName === target.repositoryName &&
    authority.repositoryOwner === target.repositoryOwner &&
    authority.repositoryOwnerId === target.repositoryOwnerId
  );
}

function authorityReference(authority: GitHubPreviousExportAuthorityV1) {
  return {
    authorityDigest: authority.authorityDigest,
    authorityId: authority.executionId,
    inventoryDigest: authority.inventoryDigest,
  } as const;
}

function buildChanges(input: {
  readonly artifact: SolutionExportArtifactV1;
  readonly destinationFolder: string;
  readonly includeWorkflows: boolean;
  readonly previousAuthority: GitHubPreviousExportAuthorityV1 | null;
  readonly snapshot: GitHubRepositorySnapshot;
}): {
  readonly changes: readonly GitHubExportFileChange[];
  readonly issues: readonly GitHubExportIssue[];
  readonly previousManifest: SolutionExportManifestV1 | null;
} {
  const {
    artifact,
    destinationFolder,
    includeWorkflows,
    previousAuthority,
    snapshot,
  } = input;
  const issues: GitHubExportIssue[] = inspectApprovedPackage(artifact).map(
    (item) => issue(item.code, item.message, "error", item.path),
  );
  const previousManifest = parsePreviousManifest(snapshot, destinationFolder);
  const candidates = artifact.files.filter(
    ({ path }) => includeWorkflows || !isWorkflowPath(path),
  );
  const paths = candidates.map(({ path }) =>
    destinationPath(path, destinationFolder),
  );
  const affectedPaths = new Set(paths);
  for (const { path } of snapshot.files) affectedPaths.add(path);
  assertNoCaseFoldCollisions([...affectedPaths]);
  const currentByPath = new Map(
    snapshot.files.map((file) => [file.path, file] as const),
  );
  const authorityByPath = new Map(
    previousAuthority?.files.map((file) => [file.path, file] as const) ?? [],
  );
  const changes: GitHubExportFileChange[] = [];
  let priorAuthorityMissing = false;

  for (const file of candidates) {
    const path = destinationPath(file.path, destinationFolder);
    const current = currentByPath.get(path);
    const binary = isLikelyBinary(file);
    if (
      binary &&
      file.bytes.byteLength >
        GITHUB_REPOSITORY_EXPORT_LIMITS.repositoryBinaryBytes
    ) {
      issues.push(
        issue(
          "repository-binary-policy-blocked",
          "A binary file exceeds the configured repository export policy.",
          "error",
          path,
        ),
      );
    }
    if (current === undefined) {
      changes.push({
        action: "add",
        binary,
        ownership: file.ownership,
        path,
        proposedDigest: file.checksum,
        reason:
          "This approved package file does not exist on the selected base.",
        sizeBytes: file.bytes.byteLength,
        workflow: isWorkflowPath(path),
      });
      continue;
    }
    if (current.digest === file.checksum) {
      changes.push({
        action: "unchanged",
        binary,
        currentDigest: current.digest,
        ownership: file.ownership,
        path,
        proposedDigest: file.checksum,
        reason: "Repository bytes already match the approved package.",
        sizeBytes: file.bytes.byteLength,
        workflow: isWorkflowPath(path),
      });
      continue;
    }
    const authoritative = authorityByPath.get(path);
    if (
      authoritative?.checksum === current.digest &&
      authoritative.ownership === file.ownership &&
      isManagedExportOwnership(file.ownership)
    ) {
      changes.push({
        action: "modify",
        binary,
        currentDigest: current.digest,
        ownership: file.ownership,
        path,
        proposedDigest: file.checksum,
        reason:
          "The repository bytes exactly match the verified previous successful export.",
        sizeBytes: file.bytes.byteLength,
        workflow: isWorkflowPath(path),
      });
      continue;
    }
    if (authoritative === undefined) priorAuthorityMissing = true;
    else {
      issues.push(
        issue(
          "user-or-unmanaged-file-conflict",
          "Existing content or ownership differs from the verified previous successful export.",
          "error",
          path,
        ),
      );
    }
    changes.push({
      action: "preserve",
      binary,
      currentDigest: current.digest,
      ownership: authoritative?.ownership ?? "repository-unmanaged",
      path,
      proposedDigest: file.checksum,
      reason:
        "CloudMarkup will not overwrite this file without an exact verified previous-export checksum and managed ownership.",
      sizeBytes: current.bytes.byteLength,
      workflow: isWorkflowPath(path),
    });
  }

  const proposedPaths = new Set(paths);
  for (const current of snapshot.files) {
    if (proposedPaths.has(current.path)) continue;
    const omittedWorkflow = isWorkflowPath(current.path) && !includeWorkflows;
    const authoritative = authorityByPath.get(current.path);
    if (
      !omittedWorkflow &&
      authoritative?.checksum === current.digest &&
      isManagedExportOwnership(authoritative.ownership)
    ) {
      changes.push({
        action: "delete",
        binary: isLikelyBinary(current),
        currentDigest: current.digest,
        ownership: authoritative.ownership,
        path: current.path,
        reason:
          "This managed file exactly matches the verified previous export and is absent from the approved package.",
        sizeBytes: current.bytes.byteLength,
        workflow: isWorkflowPath(current.path),
      });
      continue;
    }

    const packagePath = relativePackagePath(current.path, destinationFolder);
    const observedOwnership =
      packagePath === null || previousManifest === null
        ? undefined
        : previousOwnership(previousManifest, packagePath);
    const reviewedWorkflow =
      SOLUTION_EXPORT_REVIEWED_REPOSITORY_WORKFLOW_PATHS.some(
        (path) => path === current.path,
      );
    if (
      !omittedWorkflow &&
      (authoritative !== undefined ||
        reviewedWorkflow ||
        (observedOwnership !== undefined &&
          isManagedExportOwnership(observedOwnership)))
    ) {
      if (authoritative === undefined) priorAuthorityMissing = true;
      else {
        issues.push(
          issue(
            "user-or-unmanaged-file-conflict",
            "Existing content differs from the verified previous successful export.",
            "error",
            current.path,
          ),
        );
      }
    }
    changes.push({
      action: "preserve",
      binary: isLikelyBinary(current),
      currentDigest: current.digest,
      ownership: authoritative?.ownership ?? "repository-unmanaged",
      path: current.path,
      reason: omittedWorkflow
        ? "Workflow files were explicitly omitted and will not be changed."
        : "Unrelated, user-owned, changed, or unauthorized repository content is preserved.",
      sizeBytes: current.bytes.byteLength,
      workflow: isWorkflowPath(current.path),
    });
  }

  if (priorAuthorityMissing) {
    issues.push(
      issue(
        "previous-export-authority-missing",
        "A verified previous successful export is required before replacing or removing managed files.",
        "error",
      ),
    );
  }
  return {
    changes: changes.sort((left, right) => compareUtf16(left.path, right.path)),
    issues,
    previousManifest,
  };
}

function mutationsFor(
  artifact: SolutionExportArtifactV1,
  preview: GitHubExportPreview,
): readonly GitHubFileMutation[] {
  const candidateByPath = new Map(
    artifact.files
      .filter(({ path }) => preview.includeWorkflows || !isWorkflowPath(path))
      .map(
        (file) =>
          [
            destinationPath(file.path, preview.destinationFolder),
            file,
          ] as const,
      ),
  );
  return preview.changes.flatMap((change): readonly GitHubFileMutation[] => {
    if (change.action === "delete")
      return [{ path: change.path, type: "delete" }];
    if (change.action !== "add" && change.action !== "modify") return [];
    const file = candidateByPath.get(change.path);
    if (file === undefined) throw new GitHubExportError("artifact-invalid");
    return [{ bytes: file.bytes, path: change.path, type: "upsert" }];
  });
}

function assertAuthoritativeMutations(input: {
  readonly artifact: SolutionExportArtifactV1;
  readonly authority: GitHubPreviousExportAuthorityV1 | null;
  readonly preview: GitHubExportPreview;
  readonly snapshot: GitHubRepositorySnapshot;
}): void {
  const currentByPath = new Map(
    input.snapshot.files.map((file) => [file.path, file] as const),
  );
  const authorityByPath = new Map(
    input.authority?.files.map((file) => [file.path, file] as const) ?? [],
  );
  const candidateByPath = new Map(
    input.artifact.files
      .filter(
        ({ path }) => input.preview.includeWorkflows || !isWorkflowPath(path),
      )
      .map(
        (file) =>
          [
            destinationPath(file.path, input.preview.destinationFolder),
            file,
          ] as const,
      ),
  );
  for (const change of input.preview.changes) {
    if (change.action !== "modify" && change.action !== "delete") continue;
    const current = currentByPath.get(change.path);
    const authoritative = authorityByPath.get(change.path);
    if (
      current === undefined ||
      authoritative?.checksum !== current.digest ||
      authoritative.checksum !== change.currentDigest ||
      authoritative.ownership !== change.ownership ||
      !isManagedExportOwnership(authoritative.ownership)
    ) {
      throw new GitHubExportError("repository-changed");
    }
    const candidate = candidateByPath.get(change.path);
    if (
      change.action === "modify"
        ? candidate === undefined ||
          candidate.checksum !== change.proposedDigest ||
          candidate.ownership !== authoritative.ownership
        : candidate !== undefined
    ) {
      throw new GitHubExportError("artifact-invalid");
    }
  }
}

function managedInventoryAfterSuccess(
  artifact: SolutionExportArtifactV1,
  preview: GitHubExportPreview,
  previousAuthority: GitHubPreviousExportAuthorityV1 | null,
): readonly GitHubPreviousExportAuthorityFileV1[] {
  const files = new Map<string, GitHubPreviousExportAuthorityFileV1>();
  const changesByPath = new Map(
    preview.changes.map((change) => [change.path, change] as const),
  );
  const previousByPath = new Map(
    previousAuthority?.files.map((file) => [file.path, file] as const) ?? [],
  );
  for (const file of artifact.files) {
    if (
      (!preview.includeWorkflows && isWorkflowPath(file.path)) ||
      !isManagedExportOwnership(file.ownership)
    ) {
      continue;
    }
    const path = destinationPath(file.path, preview.destinationFolder);
    const change = changesByPath.get(path);
    const previous = previousByPath.get(path);
    const alreadyManaged =
      previous?.ownership === file.ownership &&
      (change?.action === "modify"
        ? previous.checksum === change.currentDigest
        : change?.action === "unchanged" &&
          previous.checksum === file.checksum);
    if (change?.action !== "add" && !alreadyManaged) continue;
    files.set(path, {
      checksum: file.checksum,
      ownership: file.ownership,
      path,
      workflow: isWorkflowPath(path),
    });
  }
  if (!preview.includeWorkflows) {
    for (const file of previousAuthority?.files ?? []) {
      if (file.workflow) files.set(file.path, file);
    }
  }
  return [...files.values()].sort((left, right) =>
    compareUtf16(left.path, right.path),
  );
}

function createPreviousExportAuthority(input: {
  readonly artifact: SolutionExportArtifactV1;
  readonly completedAt: string;
  readonly commitSha: GitHubExportReceipt["commitSha"];
  readonly executionId: string;
  readonly installation: GitHubInstallationRecord;
  readonly preview: GitHubExportPreview;
  readonly previousAuthority: GitHubPreviousExportAuthorityV1 | null;
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string;
  readonly repository: GitHubRepositoryRecord;
}): GitHubPreviousExportAuthorityV1 {
  const files = managedInventoryAfterSuccess(
    input.artifact,
    input.preview,
    input.previousAuthority,
  );
  const payload: GitHubPreviousExportAuthorityPayloadV1 = {
    artifactDigest: input.preview.artifactDigest,
    artifactId: input.preview.artifactId,
    baseBranch: input.preview.baseBranch,
    commitSha: input.commitSha,
    completedAt: input.completedAt,
    contractVersion: 1,
    destinationFolder: input.preview.destinationFolder,
    executionId: input.executionId,
    featureBranch: input.preview.featureBranch,
    files: [...files],
    installationId: input.installation.installationId,
    integrationId: input.preview.integrationId,
    inventoryDigest: canonicalDigest(files),
    kind: "github-previous-export-authority",
    organizationId: input.preview.organizationId,
    previewDigest: input.preview.previewDigest,
    projectId: input.preview.projectId,
    pullRequestNumber: input.pullRequestNumber,
    pullRequestUrl: input.pullRequestUrl,
    repositoryId: input.repository.repositoryId,
    repositoryName: input.repository.name,
    repositoryOwner: input.repository.owner,
    repositoryOwnerId: input.installation.accountId,
  };
  return gitHubPreviousExportAuthorityV1Schema.parse({
    ...payload,
    authorityDigest: canonicalDigest(payload),
  });
}

function installationSetupUrl(
  baseUrl: string | undefined,
  state: string,
): string {
  if (baseUrl === undefined) {
    throw new GitHubExportError("service-unavailable", { transient: true });
  }
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/apps\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?\/installations\/new$/u.test(
        url.pathname,
      )
    ) {
      throw new Error("invalid installation URL");
    }
    url.searchParams.set("state", state);
    return url.toString();
  } catch {
    throw new GitHubExportError("service-unavailable", { transient: true });
  }
}

export interface GitHubRepositoryExportServiceOptions {
  readonly artifactRepository?: {
    getApprovedPackage(input: {
      readonly artifactId: string;
      readonly organizationId: string;
      readonly projectId: string;
    }): Promise<ApprovedSolutionPackageRecord | null>;
  };
  readonly attemptIdFactory?: () => string;
  readonly audit: GitHubExportAuditSink;
  readonly installationLinkCallbackVerifier?: GitHubInstallationLinkCallbackVerifier;
  readonly installationSetupUrl?: string;
  readonly linkIntentIdFactory?: () => string;
  readonly linkStateFactory?: () => string;
  readonly clock?: () => Date;
  readonly github: GitHubAppAdapter;
  readonly idFactory: (kind: "execution" | "integration" | "preview") => string;
  readonly progress: GitHubExportProgressSink;
  readonly store: GitHubExportStore;
}

export class GitHubRepositoryExportService {
  readonly #artifacts: GitHubRepositoryExportServiceOptions["artifactRepository"];
  readonly #attemptIdFactory: () => string;
  readonly #audit: GitHubExportAuditSink;
  readonly #clock: () => Date;
  readonly #callbackVerifier:
    GitHubInstallationLinkCallbackVerifier | undefined;
  readonly #github: GitHubAppAdapter;
  readonly #idFactory: GitHubRepositoryExportServiceOptions["idFactory"];
  readonly #progress: GitHubExportProgressSink;
  readonly #installationSetupUrl: string | undefined;
  readonly #linkIntentIdFactory: () => string;
  readonly #linkStateFactory: () => string;
  readonly #store: GitHubExportStore;

  constructor(options: GitHubRepositoryExportServiceOptions) {
    this.#artifacts = options.artifactRepository;
    this.#attemptIdFactory = options.attemptIdFactory ?? randomUUID;
    this.#audit = options.audit;
    this.#clock = options.clock ?? (() => new Date());
    this.#github = options.github;
    this.#callbackVerifier = options.installationLinkCallbackVerifier;
    this.#installationSetupUrl = options.installationSetupUrl;
    this.#linkIntentIdFactory =
      options.linkIntentIdFactory ?? (() => `githublink_${randomUUID()}`);
    this.#linkStateFactory =
      options.linkStateFactory ?? (() => randomBytes(32).toString("base64url"));
    this.#idFactory = options.idFactory;
    this.#progress = options.progress;
    this.#store = options.store;
  }

  async listInstallations(input: {
    readonly organizationId: string;
  }): Promise<readonly GitHubInstallationRecord[]> {
    const installations = await this.#store.listInstallations(input);
    return [...installations].sort(
      (left, right) =>
        left.accountLogin.localeCompare(right.accountLogin, "en") ||
        left.integrationId.localeCompare(right.integrationId, "en"),
    );
  }

  async createInstallationLinkIntent(input: {
    readonly correlationId: string;
    readonly organizationId: string;
    readonly principalId: string;
  }): Promise<GitHubInstallationLinkIntentReceipt> {
    const createdAt = this.#clock();
    const state = gitHubInstallationLinkStateSchema.parse(
      this.#linkStateFactory(),
    );
    const receipt = gitHubInstallationLinkIntentReceiptSchema.parse({
      expiresAt: new Date(
        createdAt.getTime() +
          GITHUB_REPOSITORY_EXPORT_LIMITS.installationLinkSeconds * 1_000,
      ).toISOString(),
      installationUrl: installationSetupUrl(this.#installationSetupUrl, state),
      intentId: this.#linkIntentIdFactory(),
      state,
    });
    const record = gitHubInstallationLinkIntentSchema.parse({
      createdAt: createdAt.toISOString(),
      expiresAt: receipt.expiresAt,
      intentId: receipt.intentId,
      organizationId: input.organizationId,
      principalId: input.principalId,
      state: "pending",
      stateDigest: sha256Digest(state),
    });
    const reserved = await this.#store.reserveInstallationLinkIntent(record);
    if (!reserved.created) {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    await this.#audit.record({
      action: "github.installation-link.created",
      correlationId: input.correlationId,
      occurredAt: record.createdAt,
      organizationId: input.organizationId,
      outcome: "succeeded",
      principalId: input.principalId,
      summary: "Short-lived GitHub App installation link created.",
      targetId: record.intentId,
      targetKind: "installation",
    });
    return receipt;
  }

  async #recoverTransientInstallationLinkFailure(input: {
    readonly error: unknown;
    readonly intentId: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly stateDigest: Sha256Digest;
  }): Promise<never> {
    const safe = safeGitHubExportError(input.error);
    if (!safe.transient) throw safe;
    let release: "completed" | "expired" | "invalid" | "released";
    try {
      release = await this.#store.releaseInstallationLinkIntent({
        intentId: input.intentId,
        now: this.#clock().toISOString(),
        organizationId: input.organizationId,
        principalId: input.principalId,
        stateDigest: input.stateDigest,
      });
    } catch {
      throw new GitHubExportError("service-unavailable", {
        transient: true,
      });
    }
    if (release === "expired") {
      throw new GitHubExportError("installation-link-expired");
    }
    if (release === "invalid") {
      throw new GitHubExportError("service-unavailable", {
        transient: true,
      });
    }
    // "released" safely reopens the exact intent. "completed" deliberately
    // leaves a committed result intact so the next retry reads that result.
    throw safe;
  }

  async completeInstallationLink(input: {
    readonly callbackReceipt: string;
    readonly correlationId: string;
    readonly intentId: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly sessionId?: string;
  }): Promise<GitHubInstallationRecord> {
    const now = this.#clock().toISOString();
    if (this.#callbackVerifier === undefined) {
      await this.#audit.record({
        action: "github.installation-link.verification-unavailable",
        correlationId: input.correlationId,
        occurredAt: now,
        organizationId: input.organizationId,
        outcome: "failed",
        principalId: input.principalId,
        summary: "GitHub installation callback verification is unavailable.",
        targetId: input.intentId,
        targetKind: "installation",
      });
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    let callback;
    try {
      callback = await this.#callbackVerifier.verifyCallbackReceipt(
        input.callbackReceipt,
        {
          intentId: input.intentId,
          organizationId: input.organizationId,
          principalId: input.principalId,
          ...(input.sessionId === undefined
            ? {}
            : { sessionId: input.sessionId }),
        },
      );
      gitHubInstallationLinkStateSchema.parse(callback.state);
      const setupAction: unknown = callback.setupAction;
      if (setupAction !== "install") throw new Error("invalid action");
    } catch {
      await this.#audit.record({
        action: "github.installation-link.denied",
        correlationId: input.correlationId,
        occurredAt: now,
        organizationId: input.organizationId,
        outcome: "denied",
        principalId: input.principalId,
        summary: "GitHub installation callback verification failed.",
        targetId: input.intentId,
        targetKind: "installation",
      });
      throw new GitHubExportError("installation-link-invalid");
    }
    const stateDigest = sha256Digest(callback.state);
    let consumed: Awaited<
      ReturnType<GitHubExportStore["consumeInstallationLinkIntent"]>
    >;
    try {
      consumed = await this.#store.consumeInstallationLinkIntent({
        intentId: input.intentId,
        now,
        organizationId: input.organizationId,
        principalId: input.principalId,
        stateDigest,
      });
    } catch (error) {
      return this.#recoverTransientInstallationLinkFailure({
        error,
        intentId: input.intentId,
        organizationId: input.organizationId,
        principalId: input.principalId,
        stateDigest,
      });
    }
    if (
      consumed.outcome === "expired" ||
      consumed.outcome === "invalid" ||
      consumed.outcome === "replayed"
    ) {
      await this.#audit.record({
        action: "github.installation-link.denied",
        correlationId: input.correlationId,
        occurredAt: now,
        organizationId: input.organizationId,
        outcome: "denied",
        principalId: input.principalId,
        summary: "GitHub installation link completion was denied.",
        targetId: input.intentId,
        targetKind: "installation",
      });
    }
    if (consumed.outcome === "expired") {
      throw new GitHubExportError("installation-link-expired");
    }
    if (consumed.outcome === "invalid") {
      throw new GitHubExportError("installation-link-invalid");
    }
    if (consumed.outcome === "replayed") {
      throw new GitHubExportError("installation-link-replayed");
    }
    if (consumed.outcome === "completed") {
      const integrationId = consumed.record.completedIntegrationId;
      if (
        integrationId === undefined ||
        consumed.record.completedInstallationId !== callback.installationId
      ) {
        throw new GitHubExportError("installation-link-invalid");
      }
      const completed = await this.#store.getInstallation({
        integrationId,
        organizationId: input.organizationId,
      });
      if (completed?.installationId !== callback.installationId) {
        throw new GitHubExportError("service-unavailable", { transient: true });
      }
      try {
        await this.#audit.record({
          action: "github.installation-link.recovered",
          correlationId: input.correlationId,
          occurredAt: this.#clock().toISOString(),
          organizationId: input.organizationId,
          outcome: "succeeded",
          principalId: input.principalId,
          summary:
            "Completed GitHub App installation link recovered idempotently.",
          targetId: completed.integrationId,
          targetKind: "installation",
        });
      } catch (error) {
        const safe = safeGitHubExportError(error);
        throw safe.transient
          ? safe
          : new GitHubExportError("service-unavailable", { transient: true });
      }
      return completed;
    }
    try {
      const descriptor = await this.#github.inspectInstallation(
        callback.installationId,
      );
      if (descriptor.installationId !== callback.installationId) {
        throw new GitHubExportError("installation-link-invalid");
      }
      if (
        callback.verifiedAccount !== undefined &&
        (descriptor.accountId !== callback.verifiedAccount.accountId ||
          descriptor.accountType !== callback.verifiedAccount.accountType ||
          descriptor.repositorySelection !==
            callback.verifiedAccount.repositorySelection ||
          descriptor.suspended)
      ) {
        throw new GitHubExportError("installation-link-invalid");
      }
      const existing = await this.#store.getInstallationByInstallationId(
        callback.installationId,
      );
      if (
        existing !== null &&
        existing.organizationId !== input.organizationId
      ) {
        await this.#audit.record({
          action: "github.installation-link.denied",
          correlationId: input.correlationId,
          occurredAt: now,
          organizationId: input.organizationId,
          outcome: "denied",
          principalId: input.principalId,
          summary: "GitHub App installation belongs to another organization.",
          targetId: input.intentId,
          targetKind: "installation",
        });
        throw new GitHubExportError("installation-link-invalid");
      }
      const completedAt = this.#clock().toISOString();
      const record = gitHubInstallationRecordSchema.parse({
        accountId: descriptor.accountId,
        accountLogin: descriptor.accountLogin,
        accountType: descriptor.accountType,
        createdAt: existing?.createdAt ?? completedAt,
        installationId: descriptor.installationId,
        permissions: descriptor.permissions,
        repositorySelection: descriptor.repositorySelection,
        integrationId:
          existing?.integrationId ?? this.#idFactory("integration"),
        organizationId: input.organizationId,
        status: descriptor.suspended ? "suspended" : "connected",
        updatedAt: completedAt,
      });
      await this.#store.finalizeInstallationLink({
        installation: record,
        intentId: input.intentId,
        now: completedAt,
        organizationId: input.organizationId,
        principalId: input.principalId,
        stateDigest,
      });
      await this.#audit.record({
        action: "github.installation.linked",
        correlationId: input.correlationId,
        occurredAt: completedAt,
        organizationId: input.organizationId,
        outcome: "succeeded",
        principalId: input.principalId,
        summary: "Verified GitHub App installation linked to the organization.",
        targetId: record.integrationId,
        targetKind: "installation",
      });
      return record;
    } catch (error) {
      return this.#recoverTransientInstallationLinkFailure({
        error,
        intentId: input.intentId,
        organizationId: input.organizationId,
        principalId: input.principalId,
        stateDigest,
      });
    }
  }

  /** The pre-intent installation-ID authority is deliberately hard blocked. */
  async linkInstallation(input: {
    readonly correlationId: string;
    readonly installationId: number;
    readonly organizationId: string;
    readonly principalId: string;
  }): Promise<never> {
    await this.#audit.record({
      action: "github.installation.legacy-link-denied",
      correlationId: input.correlationId,
      occurredAt: this.#clock().toISOString(),
      organizationId: input.organizationId,
      outcome: "denied",
      principalId: input.principalId,
      summary: "Direct installation-ID linking is disabled.",
      targetKind: "installation",
    });
    throw new GitHubExportError("installation-link-invalid");
  }

  async discoverRepositories(input: {
    readonly correlationId: string;
    readonly integrationId: string;
    readonly organizationId: string;
    readonly principalId: string;
  }): Promise<readonly GitHubRepositoryRecord[]> {
    const installation = await this.#requireInstallation(input);
    if (!permissionsAllow(installation.permissions, READ_PERMISSIONS)) {
      throw new GitHubExportError("github-permission-denied");
    }
    const now = this.#clock().toISOString();
    const repositories = await this.#github.withInstallationSession(
      {
        installationId: installation.installationId,
        permissions: READ_PERMISSIONS,
      },
      (session) => session.listRepositories(),
    );
    const records = repositories.map((repository) =>
      publicRepository(
        input.organizationId,
        input.integrationId,
        repository,
        now,
      ),
    );
    await this.#store.saveRepositories({
      installationId: installation.installationId,
      integrationId: input.integrationId,
      organizationId: input.organizationId,
      repositories: records,
    });
    return records;
  }

  async discoverBranches(input: {
    readonly integrationId: string;
    readonly organizationId: string;
    readonly repositoryId: number;
  }): Promise<readonly GitHubRepositoryBranch[]> {
    const installation = await this.#requireInstallation(input);
    const repository = await this.#requireRepository(input);
    return this.#github.withInstallationSession(
      {
        installationId: installation.installationId,
        permissions: READ_PERMISSIONS,
        repositoryIds: [repository.repositoryId],
      },
      (session) =>
        session.listBranches(descriptor(repository, installation.accountId)),
    );
  }

  async createPreview(input: {
    readonly artifactId: string;
    readonly baseBranch: string;
    readonly correlationId: string;
    readonly destinationFolder: string;
    readonly featureBranch: string;
    readonly includeWorkflows: boolean;
    readonly integrationId: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly projectId: string;
    readonly repositoryId: number;
  }): Promise<GitHubExportPreview> {
    const installation = await this.#requireInstallation(input);
    const repository = await this.#requireRepository(input);
    const artifactRecord = await this.#requireArtifact(input);
    const artifact = artifactRecord.artifact;
    if (verifySolutionExportArtifact(artifact).length > 0) {
      throw new GitHubExportError("artifact-invalid");
    }
    gitHubDestinationFolderSchema.parse(input.destinationFolder);
    const baseBranch = gitHubBranchNameSchema.parse(input.baseBranch);
    const featureBranch = gitHubBranchNameSchema.parse(input.featureBranch);
    validateFeatureBranch(featureBranch, repository.defaultBranch);
    const artifactWorkflowPaths = artifact.files
      .filter(({ path }) => isWorkflowPath(path))
      .map(({ path }) => path);
    const workflowPaths = workflowSnapshotPaths(artifact);
    const candidatePaths = candidateSnapshotPaths({
      artifact,
      destinationFolder: input.destinationFolder,
      includeWorkflows: input.includeWorkflows,
    });
    const sensitivePlanWorkflow =
      includesSensitiveReviewedPlanWorkflow(artifact);
    const issues: GitHubExportIssue[] = [];
    const repositoryWorkflows = artifact.manifest.repositoryWorkflows;
    const boundRepository =
      repositoryWorkflows?.repository.state === "bound"
        ? repositoryWorkflows.repository
        : undefined;
    if (
      repositoryWorkflows !== undefined &&
      (repositoryWorkflows.files.length !== artifactWorkflowPaths.length ||
        repositoryWorkflows.files.some((entry) => {
          const file = artifact.files.find(({ path }) => path === entry.path);
          return (
            file?.checksum !== entry.checksum ||
            file.semanticChecksum !== entry.semanticChecksum
          );
        }))
    ) {
      issues.push(
        issue(
          "repository-workflow-inventory-mismatch",
          "Reviewed workflow inventory does not match the exact approved workflow files.",
          "error",
        ),
      );
    }
    if (
      !artifactWorkflowPaths.includes(NO_CREDENTIAL_PULL_REQUEST_WORKFLOW_PATH)
    ) {
      issues.push(
        issue(
          "credentialless-workflow-missing",
          "The approved package does not include its no-credential pull-request validation workflow.",
          "error",
          NO_CREDENTIAL_PULL_REQUEST_WORKFLOW_PATH,
        ),
      );
    }
    if (
      input.includeWorkflows &&
      includesPrivilegedCustomerCiWorkflow(artifactWorkflowPaths) &&
      boundRepository === undefined
    ) {
      issues.push(
        issue(
          "repository-workflow-binding-missing",
          "A privileged customer CI workflow is missing its exact repository and destination binding.",
          "error",
        ),
      );
    }
    if (
      input.includeWorkflows &&
      boundRepository !== undefined &&
      boundRepository.destinationFolder !== input.destinationFolder
    ) {
      issues.push(
        issue(
          "repository-workflow-destination-mismatch",
          "Reviewed workflows can only be exported to the exact approved destination folder.",
          "error",
        ),
      );
    }
    if (
      input.includeWorkflows &&
      boundRepository !== undefined &&
      (boundRepository.owner !== repository.owner ||
        boundRepository.name !== repository.name ||
        boundRepository.repositoryId !== String(repository.repositoryId) ||
        boundRepository.repositoryOwnerId !== String(installation.accountId) ||
        boundRepository.defaultBranch !== repository.defaultBranch)
    ) {
      issues.push(
        issue(
          "repository-workflow-repository-mismatch",
          "Reviewed workflows can only be exported to the exact approved repository identity and default branch.",
          "error",
        ),
      );
    }
    if (
      input.includeWorkflows &&
      installation.permissions.workflows !== "write"
    ) {
      issues.push(
        issue(
          "workflow-permission-unavailable",
          "Including workflow files requires the GitHub App Workflows permission. CloudMarkup will not change App permissions.",
          "error",
        ),
      );
    }
    if (!input.includeWorkflows && artifactWorkflowPaths.length > 0) {
      issues.push(
        issue(
          "workflow-files-omitted",
          "The export can proceed, but pull-request validation is not ready because workflow files were omitted.",
          "warning",
        ),
      );
    }
    await this.#progress.record({
      at: this.#clock().toISOString(),
      message:
        "Reading the selected base and calculating the complete repository diff.",
      organizationId: input.organizationId,
      projectId: input.projectId,
      stage: "preview",
      state: "running",
    });
    const inspection = await this.#github.withInstallationSession(
      {
        installationId: installation.installationId,
        permissions: READ_PERMISSIONS,
        repositoryIds: [repository.repositoryId],
      },
      async (session) => {
        const liveRepository = (await session.listRepositories()).find(
          ({ repositoryId }) => repositoryId === repository.repositoryId,
        );
        if (liveRepository === undefined) {
          throw new GitHubExportError("repository-not-found");
        }
        const snapshot = await session.readSnapshot({
          candidatePaths,
          baseBranch,
          destinationFolder: input.destinationFolder,
          repository: liveRepository,
          workflowPaths,
        });
        return { liveRepository, snapshot };
      },
    );
    const { liveRepository, snapshot } = inspection;
    if (
      liveRepository.repositoryId !== repository.repositoryId ||
      liveRepository.owner !== repository.owner ||
      liveRepository.ownerId !== installation.accountId ||
      liveRepository.name !== repository.name ||
      liveRepository.defaultBranch !== repository.defaultBranch ||
      snapshot.repositoryId !== repository.repositoryId ||
      snapshot.repositoryOwner !== repository.owner ||
      snapshot.repositoryOwnerId !== liveRepository.ownerId ||
      snapshot.repositoryName !== repository.name ||
      snapshot.defaultBranch !== repository.defaultBranch
    ) {
      throw new GitHubExportError("repository-changed");
    }
    const previousAuthority =
      await this.#store.findLatestPreviousExportAuthority({
        baseBranch,
        destinationFolder: input.destinationFolder,
        installationId: installation.installationId,
        integrationId: input.integrationId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        repositoryId: repository.repositoryId,
        repositoryOwnerId: installation.accountId,
      });
    if (
      previousAuthority !== null &&
      (!hasValidAuthorityDigests(previousAuthority) ||
        !authorityMatchesTarget(previousAuthority, {
          baseBranch,
          destinationFolder: input.destinationFolder,
          installationId: installation.installationId,
          integrationId: input.integrationId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          repositoryId: repository.repositoryId,
          repositoryName: repository.name,
          repositoryOwner: repository.owner,
          repositoryOwnerId: installation.accountId,
        }))
    ) {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    if (
      input.includeWorkflows &&
      sensitivePlanWorkflow &&
      !liveRepository.private
    ) {
      issues.push(
        issue(
          "public-repository-plan-workflow-denied",
          "The reviewed plan workflow can only be exported to a private repository.",
          "error",
          SENSITIVE_PLAN_WORKFLOW_PATH,
        ),
      );
    }
    const built = buildChanges({
      artifact,
      destinationFolder: input.destinationFolder,
      includeWorkflows: input.includeWorkflows,
      previousAuthority,
      snapshot,
    });
    issues.push(...built.issues);
    const semantic = semanticDiff(built.previousManifest, artifact.manifest);
    if (built.previousManifest !== null) {
      issues.push(
        issue(
          "repository-manifest-unverified",
          "Repository manifest details are observed for review only and do not grant overwrite or removal authority.",
          "warning",
        ),
      );
    }
    if (semantic.generatorChanged && built.previousManifest !== null) {
      issues.push(
        issue(
          "generator-lock-mismatch",
          "The approved package uses a different generator pin than the observed repository manifest; review the semantic and lock changes.",
          "warning",
          destinationPath(
            "cloudmarkup/cloudmarkup.lock.json",
            input.destinationFolder,
          ),
        ),
      );
    }
    const workflowFilesByPath = new Map<
      string,
      {
        readonly digest: Sha256Digest;
        readonly path: string;
      }
    >();
    if (input.includeWorkflows) {
      for (const { checksum: digest, path } of repositoryWorkflows?.files ??
        artifact.files.filter(({ path }) => isWorkflowPath(path))) {
        workflowFilesByPath.set(path, { digest, path });
      }
      for (const change of built.changes) {
        if (
          change.action === "delete" &&
          change.workflow &&
          change.currentDigest !== undefined
        ) {
          workflowFilesByPath.set(change.path, {
            digest: change.currentDigest,
            path: change.path,
          });
        }
      }
    }
    const workflowFiles = [...workflowFilesByPath.values()].sort(
      (left, right) => compareUtf16(left.path, right.path),
    );
    const now = this.#clock();
    const projection = {
      artifactDigest: artifact.zipDigest,
      artifactId: input.artifactId,
      baseBranch,
      baseCommitSha: snapshot.baseCommitSha,
      changes: built.changes,
      createdAt: now.toISOString(),
      ...(repositoryWorkflows === undefined ? {} : { repositoryWorkflows }),
      destinationFolder: input.destinationFolder,
      expiresAt: new Date(
        now.getTime() + GITHUB_REPOSITORY_EXPORT_LIMITS.previewSeconds * 1_000,
      ).toISOString(),
      featureBranch,
      includeWorkflows: input.includeWorkflows,
      integrationId: input.integrationId,
      issues,
      organizationId: input.organizationId,
      ...(previousAuthority === null
        ? {}
        : { previousExportAuthority: authorityReference(previousAuthority) }),
      previewId: this.#idFactory("preview"),
      projectId: input.projectId,
      ready: !issues.some(({ severity }) => severity === "error"),
      repositoryId: repository.repositoryId,
      repositoryName: repository.name,
      repositoryOwner: repository.owner,
      semanticDiff: semantic,
      snapshotDigest: snapshotDigest(snapshot),
      workflowFiles,
    };
    const preview = gitHubExportPreviewSchema.parse({
      ...projection,
      previewDigest: canonicalDigest(projection),
    });
    await this.#store.savePreview({
      createdByPrincipalId: input.principalId,
      preview,
      request: {
        artifactId: input.artifactId,
        baseBranch,
        destinationFolder: input.destinationFolder,
        featureBranch,
        includeWorkflows: input.includeWorkflows,
        integrationId: input.integrationId,
        repositoryId: input.repositoryId,
      },
    });
    await this.#audit.record({
      action: "github.export.previewed",
      correlationId: input.correlationId,
      occurredAt: now.toISOString(),
      organizationId: input.organizationId,
      outcome: preview.ready ? "succeeded" : "failed",
      principalId: input.principalId,
      summary: preview.ready
        ? "Complete GitHub repository diff is ready for review."
        : "GitHub repository diff has blocking issues.",
      targetId: preview.previewId,
      targetKind: "preview",
    });
    return preview;
  }

  async execute(input: {
    readonly confirmedWorkflowFiles: readonly {
      readonly digest: Sha256Digest;
      readonly path: string;
    }[];
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly organizationId: string;
    readonly previewDigest: Sha256Digest;
    readonly previewId: string;
    readonly principalId: string;
    readonly projectId: string;
  }): Promise<GitHubExportReceipt> {
    const idempotencyKeyDigest = canonicalDigest({
      idempotencyKey: input.idempotencyKey,
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
    const replayRequest = {
      idempotencyKeyDigest,
      organizationId: input.organizationId,
      previewDigest: input.previewDigest,
      previewId: input.previewId,
      principalId: input.principalId,
      projectId: input.projectId,
    } as const;
    const existingExecution = await this.#store.getExecutionByIdempotency({
      idempotencyKeyDigest,
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
    if (existingExecution !== null) {
      if (!executionMatchesReplayRequest(existingExecution, replayRequest)) {
        throw new GitHubExportError("invalid-request");
      }
      if (existingExecution.state === "succeeded") {
        const receipt = succeededReceiptForReplay(existingExecution);
        if (receipt === null) {
          throw new GitHubExportError("service-unavailable", {
            transient: true,
          });
        }
        return receipt;
      }
    }

    const stored = await this.#store.getPreview(input);
    if (stored?.preview.previewDigest !== input.previewDigest) {
      throw new GitHubExportError("preview-expired");
    }
    const preview = stored.preview;
    if (!preview.ready) throw new GitHubExportError("preview-blocked");
    if (Date.parse(preview.expiresAt) <= this.#clock().getTime()) {
      throw new GitHubExportError("preview-expired");
    }
    if (
      preview.includeWorkflows &&
      canonicalDigest(input.confirmedWorkflowFiles) !==
        canonicalDigest(preview.workflowFiles)
    ) {
      throw new GitHubExportError("workflow-confirmation-required");
    }
    if (!preview.includeWorkflows && input.confirmedWorkflowFiles.length > 0) {
      throw new GitHubExportError("invalid-request");
    }

    const installation = await this.#requireInstallation({
      integrationId: preview.integrationId,
      organizationId: input.organizationId,
    });
    const permissions = writePermissions(preview.includeWorkflows);
    if (!permissionsAllow(installation.permissions, permissions)) {
      throw new GitHubExportError("github-permission-denied");
    }
    const repository = await this.#requireRepository({
      integrationId: preview.integrationId,
      organizationId: input.organizationId,
      repositoryId: preview.repositoryId,
    });
    if (
      repository.owner !== preview.repositoryOwner ||
      repository.name !== preview.repositoryName
    ) {
      throw new GitHubExportError("repository-changed");
    }
    validateFeatureBranch(preview.featureBranch, repository.defaultBranch);
    const artifactRecord = await this.#requireArtifact({
      artifactId: preview.artifactId,
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
    if (
      artifactRecord.artifact.zipDigest !== preview.artifactDigest ||
      verifySolutionExportArtifact(artifactRecord.artifact).length > 0
    ) {
      throw new GitHubExportError("artifact-invalid");
    }

    const repositoryWorkflows =
      artifactRecord.artifact.manifest.repositoryWorkflows;
    const boundRepository =
      repositoryWorkflows?.repository.state === "bound"
        ? repositoryWorkflows.repository
        : undefined;
    const artifactWorkflowPaths = artifactRecord.artifact.files
      .filter(({ path }) => isWorkflowPath(path))
      .map(({ path }) => path);
    const sensitivePlanWorkflow = includesSensitiveReviewedPlanWorkflow(
      artifactRecord.artifact,
    );
    if (
      preview.includeWorkflows &&
      includesPrivilegedCustomerCiWorkflow(artifactWorkflowPaths) &&
      boundRepository === undefined
    ) {
      throw new GitHubExportError("artifact-invalid");
    }
    if (
      preview.includeWorkflows &&
      canonicalDigest(preview.repositoryWorkflows ?? null) !==
        canonicalDigest(repositoryWorkflows ?? null)
    ) {
      throw new GitHubExportError("repository-changed");
    }
    if (
      preview.includeWorkflows &&
      boundRepository !== undefined &&
      (boundRepository.owner !== repository.owner ||
        boundRepository.name !== repository.name ||
        boundRepository.repositoryId !== String(repository.repositoryId) ||
        boundRepository.repositoryOwnerId !== String(installation.accountId) ||
        boundRepository.defaultBranch !== repository.defaultBranch ||
        boundRepository.destinationFolder !== preview.destinationFolder)
    ) {
      throw new GitHubExportError("repository-changed");
    }

    let previousAuthority: GitHubPreviousExportAuthorityV1 | null = null;
    if (preview.previousExportAuthority !== undefined) {
      previousAuthority = await this.#store.getPreviousExportAuthority({
        authorityId: preview.previousExportAuthority.authorityId,
        organizationId: input.organizationId,
        projectId: input.projectId,
      });
      if (
        previousAuthority === null ||
        !hasValidAuthorityDigests(previousAuthority) ||
        canonicalDigest(authorityReference(previousAuthority)) !==
          canonicalDigest(preview.previousExportAuthority) ||
        !authorityMatchesTarget(previousAuthority, {
          baseBranch: preview.baseBranch,
          destinationFolder: preview.destinationFolder,
          installationId: installation.installationId,
          integrationId: preview.integrationId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          repositoryId: repository.repositoryId,
          repositoryName: repository.name,
          repositoryOwner: repository.owner,
          repositoryOwnerId: installation.accountId,
        })
      ) {
        throw new GitHubExportError("preview-expired");
      }
    } else if (
      preview.changes.some(
        ({ action }) => action === "modify" || action === "delete",
      )
    ) {
      throw new GitHubExportError("preview-expired");
    }

    const attemptId = this.#attemptIdFactory();
    const now = this.#clock().toISOString();
    const claim = await this.#store.reserveExecution({
      attemptId,
      record: {
        artifactDigest: preview.artifactDigest,
        branchCreated: false,
        createdByPrincipalId: input.principalId,
        executionId: this.#idFactory("execution"),
        idempotencyKeyDigest,
        organizationId: input.organizationId,
        previewDigest: preview.previewDigest,
        previewId: preview.previewId,
        projectId: input.projectId,
        recordVersion: 1,
        state: "running",
        updatedAt: now,
      },
    });
    if (
      claim.outcome === "conflict" ||
      claim.record.createdByPrincipalId !== input.principalId ||
      claim.record.artifactDigest !== preview.artifactDigest ||
      claim.record.previewDigest !== preview.previewDigest ||
      claim.record.previewId !== preview.previewId ||
      claim.record.idempotencyKeyDigest !== idempotencyKeyDigest ||
      claim.record.organizationId !== input.organizationId ||
      claim.record.projectId !== input.projectId
    ) {
      throw new GitHubExportError("invalid-request");
    }
    if (claim.outcome === "in-progress") {
      throw new GitHubExportError("export-in-progress", {
        retryAfterSeconds: 2,
        transient: true,
      });
    }
    if (claim.outcome === "terminal") {
      if (claim.record.state === "succeeded") {
        const receipt = succeededReceiptForReplay(claim.record);
        if (receipt !== null) return receipt;
        throw new GitHubExportError("service-unavailable", { transient: true });
      }
      if (claim.record.failureCode !== undefined) {
        throw new GitHubExportError(claim.record.failureCode);
      }
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    let execution = claim.record;
    if (execution.state !== "running" || execution.receipt !== undefined) {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    const mutations = mutationsFor(artifactRecord.artifact, preview);
    const succeededReceiptFromStaleSave = (
      record: StoredGitHubExportExecution,
    ): GitHubExportReceipt | undefined => {
      if (
        !executionMatchesReplayRequest(record, replayRequest) ||
        record.artifactDigest !== preview.artifactDigest
      ) {
        throw new GitHubExportError("invalid-request");
      }
      if (record.state !== "succeeded") return undefined;
      const receipt = succeededReceiptForReplay(record);
      if (receipt === null) {
        throw new GitHubExportError("service-unavailable", { transient: true });
      }
      return receipt;
    };

    const saveOwned = async (
      next: typeof execution,
    ): Promise<GitHubExportReceipt | undefined> => {
      const saved = await this.#store.saveExecution({
        attemptId,
        record: next,
      });
      execution = saved.record;
      if (saved.outcome === "saved") return undefined;
      const receipt = succeededReceiptFromStaleSave(saved.record);
      if (receipt !== undefined) return receipt;
      throw new GitHubExportError("export-in-progress", {
        retryAfterSeconds: 2,
        transient: true,
      });
    };

    try {
      return await this.#github.withInstallationSession(
        {
          installationId: installation.installationId,
          permissions,
          repositoryIds: [repository.repositoryId],
        },
        async (session) => {
          await this.#progress.record({
            at: this.#clock().toISOString(),
            executionId: execution.executionId,
            message: "Checking the selected base and repository files again.",
            organizationId: input.organizationId,
            projectId: input.projectId,
            stage: "stale-check",
            state: "running",
          });
          const workflowPaths = workflowSnapshotPaths(artifactRecord.artifact);
          const candidatePaths = candidateSnapshotPaths({
            artifact: artifactRecord.artifact,
            destinationFolder: preview.destinationFolder,
            includeWorkflows: preview.includeWorkflows,
          });
          const liveRepository = (await session.listRepositories()).find(
            ({ repositoryId }) => repositoryId === repository.repositoryId,
          );
          if (
            liveRepository?.repositoryId !== repository.repositoryId ||
            liveRepository.owner !== repository.owner ||
            liveRepository.ownerId !== installation.accountId ||
            liveRepository.name !== repository.name ||
            liveRepository.defaultBranch !== repository.defaultBranch
          ) {
            throw new GitHubExportError("repository-changed");
          }
          if (
            preview.includeWorkflows &&
            sensitivePlanWorkflow &&
            !liveRepository.private
          ) {
            throw new GitHubExportError("public-repository-workflow-denied");
          }
          const current = await session.readSnapshot({
            candidatePaths,
            baseBranch: preview.baseBranch,
            destinationFolder: preview.destinationFolder,
            repository: liveRepository,
            workflowPaths,
          });
          if (
            current.repositoryId !== repository.repositoryId ||
            current.repositoryOwner !== repository.owner ||
            current.repositoryOwnerId !== liveRepository.ownerId ||
            current.repositoryName !== repository.name ||
            current.defaultBranch !== repository.defaultBranch ||
            current.baseCommitSha !== preview.baseCommitSha ||
            snapshotDigest(current) !== preview.snapshotDigest
          ) {
            throw new GitHubExportError("repository-changed");
          }
          const rebuilt = buildChanges({
            artifact: artifactRecord.artifact,
            destinationFolder: preview.destinationFolder,
            includeWorkflows: preview.includeWorkflows,
            previousAuthority,
            snapshot: current,
          });
          if (
            canonicalDigest(rebuilt.changes) !==
            canonicalDigest(preview.changes)
          ) {
            throw new GitHubExportError("repository-changed");
          }
          assertAuthoritativeMutations({
            artifact: artifactRecord.artifact,
            authority: previousAuthority,
            preview,
            snapshot: current,
          });

          let branch = await session.findBranch({
            branch: preview.featureBranch,
            repository: liveRepository,
          });
          if (branch === null) {
            await session.createBranch({
              baseCommitSha: preview.baseCommitSha,
              branch: preview.featureBranch,
              repository: liveRepository,
            });
            const canonical = await saveOwned({
              ...execution,
              branchCreated: true,
              updatedAt: this.#clock().toISOString(),
            });
            if (canonical !== undefined) return canonical;
            branch = { sha: preview.baseCommitSha };
          } else if (!execution.branchCreated) {
            throw new GitHubExportError("branch-conflict");
          }

          let commitSha = execution.commitSha;
          commitSha ??= await session.createCommit({
            branch: preview.featureBranch,
            expectedHeadSha: preview.baseCommitSha,
            message: `Export Solution ${artifactRecord.artifact.manifest.solutionRevision.id}`,
            mutations,
            repository: liveRepository,
          });
          const canonicalAfterCommit = await saveOwned({
            ...execution,
            branchCreated: true,
            commitSha,
            updatedAt: this.#clock().toISOString(),
          });
          if (canonicalAfterCommit !== undefined) return canonicalAfterCommit;

          branch = await session.findBranch({
            branch: preview.featureBranch,
            repository: liveRepository,
          });
          if (branch?.sha !== commitSha) {
            throw new GitHubExportError("repository-changed");
          }
          const existingPullRequest = await session.findPullRequest({
            baseBranch: preview.baseBranch,
            featureBranch: preview.featureBranch,
            repository: liveRepository,
          });
          const base = await session.findBranch({
            branch: preview.baseBranch,
            repository: liveRepository,
          });
          branch = await session.findBranch({
            branch: preview.featureBranch,
            repository: liveRepository,
          });
          if (
            base?.sha !== preview.baseCommitSha ||
            branch?.sha !== commitSha
          ) {
            throw new GitHubExportError("repository-changed");
          }
          const mergeBaseSha = await session.findMergeBase({
            baseCommitSha: base.sha,
            headCommitSha: branch.sha,
            repository: liveRepository,
          });
          if (mergeBaseSha !== preview.baseCommitSha) {
            throw new GitHubExportError("repository-changed");
          }
          const pullRequest =
            existingPullRequest ??
            (await session.createPullRequest({
              baseBranch: preview.baseBranch,
              body: "This pull request contains the exact reviewed CloudMarkup Solution package. It does not deploy or merge automatically.",
              featureBranch: preview.featureBranch,
              repository: liveRepository,
              title: `CloudMarkup Solution ${artifactRecord.artifact.manifest.solutionRevision.id}`,
            }));
          const completedAt = this.#clock().toISOString();
          const receipt = gitHubExportReceiptSchema.parse({
            branch: preview.featureBranch,
            commitSha,
            completedAt,
            executionId: execution.executionId,
            organizationId: input.organizationId,
            previewDigest: preview.previewDigest,
            projectId: input.projectId,
            pullRequestNumber: pullRequest.number,
            pullRequestUrl: pullRequest.url,
            repositoryId: repository.repositoryId,
          });
          const authority = createPreviousExportAuthority({
            artifact: artifactRecord.artifact,
            completedAt,
            commitSha,
            executionId: execution.executionId,
            installation,
            preview,
            previousAuthority,
            pullRequestNumber: pullRequest.number,
            pullRequestUrl: pullRequest.url,
            repository,
          });
          const { failureCode: ignoredFailure, ...successfulExecution } =
            execution;
          void ignoredFailure;
          const canonicalAfterSuccess = await saveOwned({
            ...successfulExecution,
            authority,
            receipt,
            state: "succeeded",
            updatedAt: completedAt,
          });
          if (canonicalAfterSuccess !== undefined) return canonicalAfterSuccess;

          await this.#progress.record({
            at: completedAt,
            executionId: execution.executionId,
            message:
              "Feature branch, complete commit, and pull request created.",
            organizationId: input.organizationId,
            projectId: input.projectId,
            stage: "complete",
            state: "succeeded",
          });
          await this.#audit.record({
            action: "github.export.pull-request-created",
            correlationId: input.correlationId,
            occurredAt: completedAt,
            organizationId: input.organizationId,
            outcome: "succeeded",
            principalId: input.principalId,
            summary:
              "Approved Solution package committed to a feature branch and opened as a pull request.",
            targetId: execution.executionId,
            targetKind: "export",
          });
          return receipt;
        },
      );
    } catch (error) {
      const safe = safeGitHubExportError(error);
      const failed = withoutTerminalEvidence(execution);
      const saved = await this.#store.saveExecution({
        attemptId,
        record: {
          ...failed,
          failureCode: safe.code,
          state: safe.transient ? "failed-transient" : "failed-permanent",
          updatedAt: this.#clock().toISOString(),
        },
      });
      execution = saved.record;
      if (saved.outcome === "stale") {
        const receipt = succeededReceiptFromStaleSave(saved.record);
        if (receipt !== undefined) return receipt;
        throw new GitHubExportError("export-in-progress", {
          retryAfterSeconds: 2,
          transient: true,
        });
      }
      await this.#audit.record({
        action: "github.export.failed",
        correlationId: input.correlationId,
        occurredAt: execution.updatedAt,
        organizationId: input.organizationId,
        outcome: "failed",
        principalId: input.principalId,
        summary: safe.message,
        targetId: execution.executionId,
        targetKind: "export",
      });
      throw safe;
    }
  }

  async #requireArtifact(input: {
    readonly artifactId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<ApprovedSolutionPackageRecord> {
    if (this.#artifacts === undefined) {
      throw new GitHubExportError("service-unavailable");
    }
    const artifact = await this.#artifacts.getApprovedPackage(input);
    if (artifact === null) throw new GitHubExportError("artifact-invalid");
    return artifact;
  }

  async #requireInstallation(input: {
    readonly integrationId: string;
    readonly organizationId: string;
  }): Promise<GitHubInstallationRecord> {
    const installation = await this.#store.getInstallation(input);
    if (installation === null)
      throw new GitHubExportError("integration-not-found");
    if (installation.status !== "connected") {
      throw new GitHubExportError("installation-revoked");
    }
    return installation;
  }

  async #requireRepository(input: {
    readonly integrationId: string;
    readonly organizationId: string;
    readonly repositoryId: number;
  }): Promise<GitHubRepositoryRecord> {
    const repository = await this.#store.getRepository(input);
    if (repository === null || repository.archived || repository.disabled) {
      throw new GitHubExportError("repository-not-found");
    }
    return repository;
  }
}
