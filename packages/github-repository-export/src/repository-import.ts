import type { z } from "zod";

import type {
  ReconciliationOperationV1,
  Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  modelRepositoryInterpretationResponseV1Schema,
  repositoryCommitShaSchema,
} from "@cloudmarkup/schemas";
import type {
  RepositoryImportRequestV1,
  RepositoryImportResultV1,
} from "@cloudmarkup/repository-importer";
import { repositoryImportRequestV1Schema } from "@cloudmarkup/repository-importer";

import type { GitHubRepositoryImportIgnoredReason } from "./repository-import-security.js";
import {
  GITHUB_REPOSITORY_IMPORT_LIMITS,
  assertGitHubRepositoryImportScope,
  isApplicationSourcePath,
  sanitizeRepositorySourceText,
} from "./repository-import-security.js";
import type {
  GitHubAppAdapter,
  GitHubExportAuditSink,
  GitHubExportStore,
  GitHubPinnedRepositorySnapshot,
  GitHubPinnedRepositoryDiscovery,
  GitHubRepositoryDescriptor,
  GitHubRepositorySnapshotFile,
} from "./ports.js";
import type { GitHubRepositoryRecord, GitSha } from "./contracts.js";
import { GitHubExportError, safeGitHubExportError } from "./errors.js";
import { canonicalDigest } from "./security.js";

type ModelRepositoryInterpretationResponseV1 = z.output<
  typeof modelRepositoryInterpretationResponseV1Schema
>;

export const GITHUB_REPOSITORY_IMPORT_OPERATION =
  "cloudmarkup.github.repository-import" as const;
export const GITHUB_REPOSITORY_IMPORT_VERSION = "1.0.0" as const;

export type GitHubRepositoryImportTrigger = "manual" | "webhook";

export interface GitHubRepositoryImportInput {
  readonly branch: string;
  readonly commitSha: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly ignoredPaths: readonly string[];
  readonly integrationId: string;
  readonly organizationId: string;
  readonly previousImportId?: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly repositoryId: number;
  readonly requestedMode: "guided" | "professional";
  readonly selectedPaths: readonly string[];
  readonly trigger: GitHubRepositoryImportTrigger;
}

export interface GitHubRepositoryImportFile {
  readonly digest: Sha256Digest;
  readonly path: string;
  readonly sizeBytes: number;
}

export interface GitHubRepositoryImportIgnoredPath {
  readonly path: string;
  readonly reason: GitHubRepositoryImportIgnoredReason;
}

export interface GitHubRepositoryFileDifference {
  readonly action: "added" | "modified" | "removed" | "unchanged";
  readonly currentDigest?: Sha256Digest;
  readonly path: string;
  readonly previousDigest?: Sha256Digest;
}

export interface GitHubRepositoryInferenceClaim {
  readonly category:
    | "resource"
    | "connection"
    | "workload"
    | "external-resource"
    | "source-ownership"
    | "workflow"
    | "diagnostic";
  readonly claimId: string;
  readonly confidenceBasisPoints: number;
  readonly evidenceIds: readonly string[];
  readonly summary: string;
}

export interface GitHubRepositoryInferenceActiveIssue {
  readonly claimId: string;
  readonly confidenceBasisPoints: number;
  readonly evidenceIds: readonly string[];
  readonly issueId: string;
  readonly lifecycle: "current";
  readonly source: "repository-import-mismatch";
  readonly summary: string;
}

export interface GitHubRepositoryImportArtifactSet {
  readonly branchChangedSinceSelection: boolean;
  readonly fileDifferences: readonly GitHubRepositoryFileDifference[];
  readonly files: readonly GitHubRepositoryImportFile[];
  readonly ignoredFiles: readonly GitHubRepositoryImportIgnoredPath[];
  readonly importResult: RepositoryImportResultV1;
  readonly inferenceClaims: readonly GitHubRepositoryInferenceClaim[];
  readonly inferenceIssues: readonly GitHubRepositoryInferenceActiveIssue[];
}

export interface StoredGitHubRepositoryImport {
  readonly branch: string;
  readonly branchHeadSha: GitSha;
  readonly commitSha: GitSha;
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly createdByPrincipalId: string;
  readonly failureCode?: string;
  readonly idempotencyDigest: Sha256Digest;
  readonly ignoredPaths: readonly string[];
  readonly importId: string;
  readonly integrationId: string;
  readonly organizationId: string;
  readonly previousImportId?: string;
  readonly projectId: string;
  readonly recordVersion: number;
  readonly repositoryId: number;
  readonly repositoryName: string;
  readonly repositoryOwner: string;
  readonly result?: GitHubRepositoryImportArtifactSet;
  readonly selectedPaths: readonly string[];
  readonly snapshotDigest?: Sha256Digest;
  readonly snapshotId: string;
  readonly state:
    "running" | "succeeded" | "failed-transient" | "failed-permanent";
  readonly trigger: GitHubRepositoryImportTrigger;
  readonly updatedAt: string;
}

export type GitHubRepositoryImportClaim =
  | Readonly<{ outcome: "acquired"; record: StoredGitHubRepositoryImport }>
  | Readonly<{
      outcome: "in-progress" | "terminal";
      record: StoredGitHubRepositoryImport;
    }>;

export interface GitHubRepositoryImportStore {
  getImport(input: {
    readonly importId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<StoredGitHubRepositoryImport | null>;
  getReviewByIdempotency(input: {
    readonly idempotencyDigest: Sha256Digest;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<GitHubRepositoryReconciliationReview | null>;
  listImports(input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly repositoryId?: number;
  }): Promise<readonly StoredGitHubRepositoryImport[]>;
  reserveImport(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubRepositoryImport;
  }): Promise<GitHubRepositoryImportClaim>;
  saveImport(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubRepositoryImport;
  }): Promise<"saved" | "stale">;
  saveReview(
    record: GitHubRepositoryReconciliationReview,
  ): Promise<GitHubRepositoryReconciliationReview>;
}

export interface GitHubRepositoryImportContextPort {
  load(input: {
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<Omit<RepositoryImportRequestV1, "profile"> | null>;
}

export interface GitHubRepositoryImportRunner {
  /**
   * Materializes only these already-validated files into an isolated temporary
   * directory, invokes the repository importer, and removes the directory in a finally block.
   */
  importPinnedSnapshot(input: {
    readonly files: readonly GitHubRepositorySnapshotFile[];
    readonly request: RepositoryImportRequestV1;
  }): Promise<RepositoryImportResultV1>;
}

export interface GitHubRepositoryInterpretationPort {
  interpret(input: {
    readonly commitSha: GitSha;
    readonly evidence: readonly {
      readonly content: string;
      readonly evidenceId: string;
      readonly fileChecksum: Sha256Digest;
      readonly location: {
        readonly endLine: number;
        readonly startLine: number;
      };
      readonly path: string;
      readonly redacted: boolean;
    }[];
    readonly idempotencyDigest: Sha256Digest;
    readonly organizationId: string;
    readonly privateRepository: boolean;
    readonly principalId: string;
    readonly projectId: string;
    readonly repositorySnapshotDigest: Sha256Digest;
    readonly repositorySnapshotId: string;
    readonly requestedMode: "guided" | "professional";
  }): Promise<ModelRepositoryInterpretationResponseV1>;
}

export interface GitHubRepositoryCanonicalReconciler {
  review(input: {
    readonly decision:
      | "accept-into-design"
      | "keep-observed"
      | "mark-external"
      | "ignore"
      | "reject";
    readonly idempotencyDigest: Sha256Digest;
    readonly operation: ReconciliationOperationV1;
    readonly organizationId: string;
    readonly principalId: string;
    readonly projectId: string;
    readonly reason?: string;
  }): Promise<{ readonly designChanged: boolean; readonly receiptId: string }>;
}

export interface GitHubRepositoryRegenerationPort {
  createExportPreview(input: {
    readonly idempotencyDigest: Sha256Digest;
    readonly organizationId: string;
    readonly principalId: string;
    readonly projectId: string;
    readonly repositoryId: number;
    readonly sourceImportId: string;
  }): Promise<{ readonly exportPreviewId: string }>;
}

export interface GitHubRepositoryReconciliationReview {
  readonly decision:
    | "accept-into-design"
    | "keep-observed"
    | "mark-external"
    | "regenerate"
    | "ignore"
    | "reject";
  readonly designChanged: boolean;
  readonly idempotencyDigest: Sha256Digest;
  readonly importId: string;
  readonly operationId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly reason?: string;
  readonly receiptId: string;
  readonly reviewedAt: string;
  readonly reviewedByPrincipalId: string;
  readonly snapshotDigest: Sha256Digest;
}

export interface ReviewGitHubRepositoryImportInput {
  readonly correlationId: string;
  readonly decision: GitHubRepositoryReconciliationReview["decision"];
  readonly expectedSnapshotDigest: Sha256Digest;
  readonly idempotencyKey: string;
  readonly importId: string;
  readonly operationId: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly reason?: string;
}

export interface GitHubRepositoryImportProgressEvent {
  readonly at: string;
  readonly importId: string;
  readonly message: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly stage:
    | "authorization"
    | "acquisition"
    | "deterministic-import"
    | "interpretation"
    | "persistence"
    | "complete";
  readonly state: "failed" | "running" | "succeeded";
}

export interface GitHubRepositoryImportProgressSink {
  record(event: GitHubRepositoryImportProgressEvent): Promise<void>;
}

export type GitHubRepositoryDiscoveryInput = Pick<
  GitHubRepositoryImportInput,
  | "branch"
  | "commitSha"
  | "ignoredPaths"
  | "integrationId"
  | "organizationId"
  | "repositoryId"
  | "selectedPaths"
>;

export interface GitHubRepositoryImportService {
  discoverRepository(
    input: GitHubRepositoryDiscoveryInput,
  ): Promise<GitHubPinnedRepositoryDiscovery>;
  importRepository(
    input: GitHubRepositoryImportInput,
  ): Promise<StoredGitHubRepositoryImport>;
  listImports(input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly repositoryId?: number;
  }): Promise<readonly StoredGitHubRepositoryImport[]>;
  review(
    input: ReviewGitHubRepositoryImportInput,
  ): Promise<GitHubRepositoryReconciliationReview>;
}

function repositoryDescriptor(
  record: GitHubRepositoryRecord,
  descriptor: GitHubRepositoryDescriptor,
): GitHubRepositoryDescriptor {
  if (
    record.repositoryId !== descriptor.repositoryId ||
    record.installationId !== descriptor.installationId ||
    record.owner !== descriptor.owner ||
    record.name !== descriptor.name
  ) {
    throw new GitHubExportError("repository-not-found");
  }
  if (descriptor.archived || descriptor.disabled) {
    throw new GitHubExportError("repository-not-found");
  }
  return descriptor;
}

function fileInventory(
  snapshot: GitHubPinnedRepositorySnapshot,
): readonly GitHubRepositoryImportFile[] {
  return snapshot.files.map((file) => ({
    digest: file.digest,
    path: file.path,
    sizeBytes: file.bytes.byteLength,
  }));
}

function fileDifferences(
  previous: readonly GitHubRepositoryImportFile[],
  current: readonly GitHubRepositoryImportFile[],
): readonly GitHubRepositoryFileDifference[] {
  const left = new Map(previous.map((file) => [file.path, file] as const));
  const right = new Map(current.map((file) => [file.path, file] as const));
  return [...new Set([...left.keys(), ...right.keys()])]
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((path) => {
      const before = left.get(path);
      const after = right.get(path);
      if (before === undefined && after !== undefined) {
        return { action: "added" as const, currentDigest: after.digest, path };
      }
      if (before !== undefined && after === undefined) {
        return {
          action: "removed" as const,
          path,
          previousDigest: before.digest,
        };
      }
      if (before === undefined || after === undefined) {
        throw new GitHubExportError("service-unavailable");
      }
      return {
        action:
          before.digest === after.digest
            ? ("unchanged" as const)
            : ("modified" as const),
        currentDigest: after.digest,
        path,
        previousDigest: before.digest,
      };
    });
}

function unresolvedApplicationEvidence(input: {
  readonly result: RepositoryImportResultV1;
  readonly snapshot: GitHubPinnedRepositorySnapshot;
}): readonly {
  readonly content: string;
  readonly evidenceId: string;
  readonly fileChecksum: Sha256Digest;
  readonly location: { readonly endLine: number; readonly startLine: number };
  readonly path: string;
  readonly redacted: boolean;
}[] {
  const files = new Map(input.snapshot.files.map((file) => [file.path, file]));
  const evidence = new Map<
    string,
    {
      readonly content: string;
      readonly evidenceId: string;
      readonly fileChecksum: Sha256Digest;
      readonly location: {
        readonly endLine: number;
        readonly startLine: number;
      };
      readonly path: string;
      readonly redacted: boolean;
    }
  >();
  for (const fact of input.result.facts) {
    if (
      fact.confidence !== "unresolved" ||
      (fact.kind !== "connection" && fact.kind !== "workload-binding") ||
      !isApplicationSourcePath(fact.source.path)
    ) {
      continue;
    }
    const file = files.get(fact.source.path);
    if (file === undefined) continue;
    const sanitized = sanitizeRepositorySourceText(file.bytes);
    evidence.set(fact.source.evidenceId, {
      content: sanitized.content,
      evidenceId: fact.source.evidenceId,
      fileChecksum: file.digest,
      location: {
        endLine: Math.max(
          fact.source.line,
          sanitized.content.split("\n").length,
        ),
        startLine: fact.source.line,
      },
      path: fact.source.path,
      redacted: sanitized.redacted,
    });
  }
  return [...evidence.values()]
    .sort((left, right) =>
      left.evidenceId.localeCompare(right.evidenceId, "en"),
    )
    .slice(0, GITHUB_REPOSITORY_IMPORT_LIMITS.excerpts);
}

function validateInference(
  response: ModelRepositoryInterpretationResponseV1,
  evidence: readonly {
    readonly evidenceId: string;
    readonly fileChecksum: Sha256Digest;
    readonly path: string;
  }[],
): {
  readonly claims: readonly GitHubRepositoryInferenceClaim[];
  readonly issues: readonly GitHubRepositoryInferenceActiveIssue[];
} {
  const parsed = modelRepositoryInterpretationResponseV1Schema.parse(response);
  const allowed = new Map(evidence.map((item) => [item.evidenceId, item]));
  const claims = parsed.claims.map((claim) => {
    const evidenceIds = claim.evidenceReferences.map((reference) => {
      const expected = allowed.get(reference.referenceId);
      if (
        expected === undefined ||
        (reference.path !== undefined && reference.path !== expected.path) ||
        (reference.digest !== undefined &&
          reference.digest !== expected.fileChecksum)
      ) {
        throw new GitHubExportError("ungrounded-claim");
      }
      return reference.referenceId;
    });
    if (evidenceIds.length === 0) {
      throw new GitHubExportError("ungrounded-claim");
    }
    return {
      category: claim.category,
      claimId: claim.claimId,
      confidenceBasisPoints: claim.confidence.basisPoints,
      evidenceIds: [...new Set(evidenceIds)].sort(),
      summary: claim.summary,
    };
  });
  return {
    claims,
    issues: claims.map((claim) => ({
      claimId: claim.claimId,
      confidenceBasisPoints: claim.confidenceBasisPoints,
      evidenceIds: claim.evidenceIds,
      issueId: `repository-inference.${claim.claimId}`,
      lifecycle: "current",
      source: "repository-import-mismatch",
      summary:
        "Inferred repository relationship requires user review: " +
        claim.summary,
    })),
  };
}

function operationFor(
  record: StoredGitHubRepositoryImport,
  operationId: string,
): ReconciliationOperationV1 {
  const operation = record.result?.importResult.proposal?.operations.find(
    (candidate) => candidate.operationId === operationId,
  );
  if (operation === undefined) throw new GitHubExportError("invalid-request");
  return operation;
}

function assertDecisionMatchesOperation(
  decision: ReviewGitHubRepositoryImportInput["decision"],
  operation: ReconciliationOperationV1,
): void {
  if (
    (decision === "accept-into-design" &&
      operation.kind !== "accept-observed-graph-change" &&
      operation.kind !== "accept-observed-domain-change") ||
    (decision === "mark-external" &&
      operation.kind !== "mark-intentionally-external") ||
    (decision === "regenerate" &&
      operation.kind !== "update-generated-output-to-design") ||
    (decision === "ignore" && operation.kind !== "ignore-observation")
  ) {
    throw new GitHubExportError("invalid-request");
  }
}

export function createGitHubRepositoryImportService(options: {
  readonly audit: GitHubExportAuditSink;
  readonly clock?: () => Date;
  readonly context: GitHubRepositoryImportContextPort;
  readonly directory: Pick<
    GitHubExportStore,
    "getInstallation" | "getRepository"
  >;
  readonly github: GitHubAppAdapter;
  readonly id?: () => string;
  readonly importer: GitHubRepositoryImportRunner;
  readonly interpreter?: GitHubRepositoryInterpretationPort;
  readonly progress: GitHubRepositoryImportProgressSink;
  readonly reconciler: GitHubRepositoryCanonicalReconciler;
  readonly regeneration: GitHubRepositoryRegenerationPort;
  readonly store: GitHubRepositoryImportStore;
}): GitHubRepositoryImportService {
  const clock = options.clock ?? (() => new Date());
  const id = options.id ?? (() => crypto.randomUUID());

  async function progress(
    input: GitHubRepositoryImportInput,
    importId: string,
    stage:
      | "authorization"
      | "acquisition"
      | "deterministic-import"
      | "interpretation"
      | "persistence"
      | "complete",
    state: "failed" | "running" | "succeeded",
  ): Promise<void> {
    await options.progress.record({
      at: clock().toISOString(),
      importId,
      message: `Repository import ${stage} ${state}.`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      stage,
      state,
    });
  }

  return Object.freeze({
    async discoverRepository(
      supplied: GitHubRepositoryDiscoveryInput,
    ): Promise<GitHubPinnedRepositoryDiscovery> {
      const input = structuredClone(supplied);
      assertGitHubRepositoryImportScope(input);
      const commitSha = repositoryCommitShaSchema.parse(input.commitSha);
      const installation = await options.directory.getInstallation({
        integrationId: input.integrationId,
        organizationId: input.organizationId,
      });
      const repository = await options.directory.getRepository({
        integrationId: input.integrationId,
        organizationId: input.organizationId,
        repositoryId: input.repositoryId,
      });
      if (
        installation === null ||
        repository === null ||
        installation.status !== "connected"
      ) {
        throw new GitHubExportError("integration-not-found");
      }
      if (
        installation.permissions.contents === "none" ||
        installation.permissions.metadata === "none"
      ) {
        throw new GitHubExportError("github-permission-denied");
      }
      return options.github.withRepositoryReadSession(
        {
          installationId: installation.installationId,
          repositoryIds: [input.repositoryId],
        },
        async (session) => {
          const repositories = await session.listRepositories();
          const descriptor = repositories.find(
            (candidate) => candidate.repositoryId === input.repositoryId,
          );
          if (descriptor === undefined)
            throw new GitHubExportError("repository-not-found");
          return session.discoverPinnedFiles({
            branch: input.branch,
            commitSha,
            ignoredPaths: input.ignoredPaths,
            selectedPaths: input.selectedPaths,
            repository: repositoryDescriptor(repository, descriptor),
          });
        },
      );
    },
    async importRepository(
      raw: GitHubRepositoryImportInput,
    ): Promise<StoredGitHubRepositoryImport> {
      assertGitHubRepositoryImportScope(raw);
      const commitSha = repositoryCommitShaSchema.parse(raw.commitSha);
      const now = clock().toISOString();
      let importId = `githubimport_${id()}`;
      let snapshotId = `repository-snapshot.${id()}`;
      const idempotencyDigest = canonicalDigest({
        branch: raw.branch,
        commitSha,
        idempotencyKey: raw.idempotencyKey,
        ignoredPaths: [...raw.ignoredPaths].sort(),
        integrationId: raw.integrationId,
        operation: GITHUB_REPOSITORY_IMPORT_OPERATION,
        organizationId: raw.organizationId,
        previousImportId: raw.previousImportId ?? null,
        projectId: raw.projectId,
        repositoryId: raw.repositoryId,
        selectedPaths: [...raw.selectedPaths].sort(),
        trigger: raw.trigger,
        version: GITHUB_REPOSITORY_IMPORT_VERSION,
      });
      const existingPrevious =
        raw.previousImportId === undefined
          ? null
          : await options.store.getImport({
              importId: raw.previousImportId,
              organizationId: raw.organizationId,
              projectId: raw.projectId,
            });
      if (
        raw.previousImportId !== undefined &&
        (existingPrevious?.state !== "succeeded" ||
          existingPrevious.repositoryId !== raw.repositoryId)
      ) {
        throw new GitHubExportError("invalid-request");
      }

      const installation = await options.directory.getInstallation({
        integrationId: raw.integrationId,
        organizationId: raw.organizationId,
      });
      const repository = await options.directory.getRepository({
        integrationId: raw.integrationId,
        organizationId: raw.organizationId,
        repositoryId: raw.repositoryId,
      });
      if (
        installation === null ||
        repository === null ||
        installation.status !== "connected"
      ) {
        throw new GitHubExportError("integration-not-found");
      }
      if (
        installation.permissions.contents === "none" ||
        installation.permissions.metadata === "none"
      ) {
        throw new GitHubExportError("github-permission-denied");
      }
      const running: StoredGitHubRepositoryImport = {
        branch: raw.branch,
        branchHeadSha: commitSha,
        commitSha,
        createdAt: now,
        createdByPrincipalId: raw.principalId,
        idempotencyDigest,
        ignoredPaths: [...raw.ignoredPaths],
        importId,
        integrationId: raw.integrationId,
        organizationId: raw.organizationId,
        ...(raw.previousImportId === undefined
          ? {}
          : { previousImportId: raw.previousImportId }),
        projectId: raw.projectId,
        recordVersion: 1,
        repositoryId: raw.repositoryId,
        repositoryName: repository.name,
        repositoryOwner: repository.owner,
        selectedPaths: [...raw.selectedPaths],
        snapshotId,
        state: "running",
        trigger: raw.trigger,
        updatedAt: now,
      };
      const attemptId = id();
      const claim = await options.store.reserveImport({
        attemptId,
        record: running,
      });
      if (claim.outcome === "terminal") return claim.record;
      if (claim.outcome === "in-progress") {
        throw new GitHubExportError("import-in-progress", { transient: true });
      }

      importId = claim.record.importId;
      snapshotId = claim.record.snapshotId;
      await progress(raw, importId, "authorization", "succeeded");
      try {
        const context = await options.context.load({
          organizationId: raw.organizationId,
          projectId: raw.projectId,
        });
        if (context === null) throw new GitHubExportError("invalid-request");
        await progress(raw, importId, "acquisition", "running");
        const acquired = await options.github.withRepositoryReadSession(
          {
            installationId: installation.installationId,
            repositoryIds: [raw.repositoryId],
          },
          async (session) => {
            const repositories = await session.listRepositories();
            const descriptor = repositories.find(
              (candidate) => candidate.repositoryId === raw.repositoryId,
            );
            if (descriptor === undefined) {
              throw new GitHubExportError("repository-not-found");
            }
            return session.readPinnedSnapshot({
              branch: raw.branch,
              commitSha,
              ignoredPaths: raw.ignoredPaths,
              repository: repositoryDescriptor(repository, descriptor),
              selectedPaths: raw.selectedPaths,
            });
          },
        );
        await progress(raw, importId, "acquisition", "succeeded");

        await progress(raw, importId, "deterministic-import", "running");
        const importerRequest = repositoryImportRequestV1Schema.parse({
          ...context,
          profile: {
            commitSha,
            contractVersion: 1,
            importedAt: now,
            limits: {
              maximumFileBytes: GITHUB_REPOSITORY_IMPORT_LIMITS.fileBytes,
              maximumFileCount: GITHUB_REPOSITORY_IMPORT_LIMITS.files,
              maximumTotalBytes: GITHUB_REPOSITORY_IMPORT_LIMITS.totalBytes,
            },
            observedSolutionId: `observed-solution.${id()}`,
            profileId: "cloudmarkup.github.repository-import",
            profileVersion: GITHUB_REPOSITORY_IMPORT_VERSION,
            selectedPaths: [...raw.selectedPaths],
            snapshotId,
            sourceDescriptor: "GitHub repository",
            sourceId: "cloudmarkup.github-app",
          },
        });
        const importResult = await options.importer.importPinnedSnapshot({
          files: acquired.files,
          request: importerRequest,
        });
        if (
          importResult.snapshot.revision.commitSha !== commitSha ||
          importResult.snapshot.snapshotId !== snapshotId
        ) {
          throw new GitHubExportError("service-unavailable");
        }
        await progress(raw, importId, "deterministic-import", "succeeded");

        const evidence = unresolvedApplicationEvidence({
          result: importResult,
          snapshot: acquired,
        });
        let inferenceClaims: readonly GitHubRepositoryInferenceClaim[] = [];
        let inferenceIssues: readonly GitHubRepositoryInferenceActiveIssue[] =
          [];
        if (evidence.length > 0 && options.interpreter !== undefined) {
          await progress(raw, importId, "interpretation", "running");
          const interpretation = await options.interpreter.interpret({
            commitSha,
            evidence,
            idempotencyDigest,
            organizationId: raw.organizationId,
            privateRepository: repository.private,
            principalId: raw.principalId,
            projectId: raw.projectId,
            repositorySnapshotDigest: importResult.snapshot.snapshotDigest,
            repositorySnapshotId: importResult.snapshot.snapshotId,
            requestedMode: raw.requestedMode,
          });
          const validated = validateInference(interpretation, evidence);
          inferenceClaims = validated.claims;
          inferenceIssues = validated.issues;
          await progress(raw, importId, "interpretation", "succeeded");
        }

        const files = fileInventory(acquired);
        const artifacts: GitHubRepositoryImportArtifactSet = {
          branchChangedSinceSelection: acquired.branchHeadSha !== commitSha,
          fileDifferences: fileDifferences(
            existingPrevious?.result?.files ?? [],
            files,
          ),
          files,
          ignoredFiles: acquired.ignoredFiles,
          importResult,
          inferenceClaims,
          inferenceIssues,
        };
        const completedAt = clock().toISOString();
        const completed: StoredGitHubRepositoryImport = {
          ...claim.record,
          branchHeadSha: acquired.branchHeadSha,
          completedAt,
          recordVersion: claim.record.recordVersion + 1,
          result: artifacts,
          snapshotDigest: importResult.snapshot.snapshotDigest,
          state: "succeeded",
          updatedAt: completedAt,
        };
        await progress(raw, importId, "persistence", "running");
        const saved = await options.store.saveImport({
          attemptId,
          record: completed,
        });
        if (saved !== "saved")
          throw new GitHubExportError("import-in-progress");
        await progress(raw, importId, "persistence", "succeeded");
        await options.audit.record({
          action: "github.repository-import.completed",
          correlationId: raw.correlationId,
          occurredAt: completedAt,
          organizationId: raw.organizationId,
          outcome: "succeeded",
          principalId: raw.principalId,
          summary:
            "Imported one exact GitHub commit into immutable observed evidence.",
          targetId: importId,
          targetKind: "repository",
        });
        await progress(raw, importId, "complete", "succeeded");
        return completed;
      } catch (error) {
        const safe = safeGitHubExportError(error);
        const failedAt = clock().toISOString();
        await options.store.saveImport({
          attemptId,
          record: {
            ...claim.record,
            failureCode: safe.code,
            recordVersion: claim.record.recordVersion + 1,
            state: safe.transient ? "failed-transient" : "failed-permanent",
            updatedAt: failedAt,
          },
        });
        await options.audit.record({
          action: "github.repository-import.failed",
          correlationId: raw.correlationId,
          occurredAt: failedAt,
          organizationId: raw.organizationId,
          outcome: "failed",
          principalId: raw.principalId,
          summary: "GitHub repository import failed safely.",
          targetId: importId,
          targetKind: "repository",
        });
        await progress(raw, importId, "complete", "failed");
        throw safe;
      }
    },

    listImports(input: {
      readonly organizationId: string;
      readonly projectId: string;
      readonly repositoryId?: number;
    }) {
      return options.store.listImports(input);
    },

    async review(
      raw: ReviewGitHubRepositoryImportInput,
    ): Promise<GitHubRepositoryReconciliationReview> {
      const normalizedReason = raw.reason?.trim();
      const idempotencyDigest = canonicalDigest({
        decision: raw.decision,
        expectedSnapshotDigest: raw.expectedSnapshotDigest,
        idempotencyKey: raw.idempotencyKey,
        importId: raw.importId,
        operation: GITHUB_REPOSITORY_IMPORT_OPERATION,
        operationId: raw.operationId,
        organizationId: raw.organizationId,
        principalId: raw.principalId,
        projectId: raw.projectId,
        purpose: "reconciliation-review",
        reason: normalizedReason ?? null,
      });
      const existingReview = await options.store.getReviewByIdempotency({
        idempotencyDigest,
        organizationId: raw.organizationId,
        projectId: raw.projectId,
      });
      if (existingReview !== null) {
        if (
          existingReview.importId !== raw.importId ||
          existingReview.operationId !== raw.operationId ||
          existingReview.decision !== raw.decision ||
          existingReview.snapshotDigest !== raw.expectedSnapshotDigest ||
          existingReview.reviewedByPrincipalId !== raw.principalId ||
          existingReview.reason !== normalizedReason
        ) {
          throw new GitHubExportError("invalid-request");
        }
        return existingReview;
      }
      const record = await options.store.getImport({
        importId: raw.importId,
        organizationId: raw.organizationId,
        projectId: raw.projectId,
      });
      if (
        record?.state !== "succeeded" ||
        record.snapshotDigest !== raw.expectedSnapshotDigest
      ) {
        throw new GitHubExportError("repository-changed");
      }
      const operation = operationFor(record, raw.operationId);
      assertDecisionMatchesOperation(raw.decision, operation);
      if (
        raw.decision === "ignore" &&
        (normalizedReason === undefined || normalizedReason === "")
      ) {
        throw new GitHubExportError("invalid-request");
      }

      const installationId = (
        await options.directory.getRepository({
          integrationId: record.integrationId,
          organizationId: raw.organizationId,
          repositoryId: record.repositoryId,
        })
      )?.installationId;
      if (installationId === undefined) {
        throw new GitHubExportError("repository-not-found");
      }
      await options.github.withRepositoryReadSession(
        { installationId, repositoryIds: [record.repositoryId] },
        async (session) => {
          const repository = (await session.listRepositories()).find(
            (candidate) => candidate.repositoryId === record.repositoryId,
          );
          if (repository === undefined) {
            throw new GitHubExportError("repository-not-found");
          }
          const branch = (await session.listBranches(repository)).find(
            (candidate) => candidate.name === record.branch,
          );
          if (branch?.sha !== record.branchHeadSha) {
            throw new GitHubExportError("repository-changed");
          }
        },
      );

      let receipt: {
        readonly designChanged: boolean;
        readonly receiptId: string;
      };
      if (raw.decision === "regenerate") {
        const exportPreview = await options.regeneration.createExportPreview({
          idempotencyDigest,
          organizationId: raw.organizationId,
          principalId: raw.principalId,
          projectId: raw.projectId,
          repositoryId: record.repositoryId,
          sourceImportId: record.importId,
        });
        receipt = {
          designChanged: false,
          receiptId: exportPreview.exportPreviewId,
        };
      } else {
        receipt = await options.reconciler.review({
          idempotencyDigest,
          decision: raw.decision,
          operation,
          organizationId: raw.organizationId,
          principalId: raw.principalId,
          projectId: raw.projectId,
          ...(normalizedReason === undefined
            ? {}
            : { reason: normalizedReason }),
        });
      }
      const reviewedAt = clock().toISOString();
      const review: GitHubRepositoryReconciliationReview = {
        decision: raw.decision,
        designChanged: receipt.designChanged,
        importId: record.importId,
        idempotencyDigest,
        operationId: operation.operationId,
        organizationId: raw.organizationId,
        projectId: raw.projectId,
        ...(normalizedReason === undefined ? {} : { reason: normalizedReason }),
        receiptId: receipt.receiptId,
        reviewedAt,
        reviewedByPrincipalId: raw.principalId,
        snapshotDigest: raw.expectedSnapshotDigest,
      };
      const savedReview = await options.store.saveReview(review);
      await options.audit.record({
        action: `github.repository-import.reconciliation.${raw.decision}`,
        correlationId: raw.correlationId,
        occurredAt: savedReview.reviewedAt,
        organizationId: raw.organizationId,
        outcome: "succeeded",
        principalId: raw.principalId,
        summary:
          raw.decision === "regenerate"
            ? "Created a reviewed export preview; no repository write occurred."
            : "Recorded one reviewed repository reconciliation operation.",
        targetId: record.importId,
        targetKind: "repository",
      });
      return savedReview;
    },
  });
}
