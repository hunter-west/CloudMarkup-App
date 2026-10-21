import { createHash } from "node:crypto";

import type { SolutionExportArtifactV1 } from "@cloudmarkup/solution-export";
import type { Sha256Digest } from "@cloudmarkup/schemas";

import {
  gitHubInstallationRecordSchema,
  gitHubPreviousExportAuthorityV1Schema,
} from "./contracts.js";
import type {
  GitHubAppRepositoryPermissions,
  GitHubExportReceipt,
  GitHubInstallationLinkIntent,
  GitHubInstallationRecord,
  GitHubPreviousExportAuthorityV1,
  GitHubRepositoryBranch,
  GitHubRepositoryRecord,
  GitSha,
} from "./contracts.js";
import { GitHubExportError } from "./errors.js";
import type {
  ApprovedSolutionPackageRecord,
  ApprovedSolutionPackageRepository,
  GitHubAppAdapter,
  GitHubExportAuditEvent,
  GitHubExportAuditSink,
  GitHubExportProgressEvent,
  GitHubExportProgressSink,
  GitHubExportStore,
  GitHubInstallationLinkCallbackVerifier,
  GitHubInstallationDescriptor,
  GitHubInstallationSession,
  GitHubPullRequestDescriptor,
  GitHubPreviousExportAuthorityTarget,
  GitHubRepositoryDescriptor,
  GitHubRepositorySnapshot,
  GitHubWebhookDeliveryRecord,
  StoredGitHubExportExecution,
  StoredGitHubExportPreview,
  VerifiedGitHubInstallationLinkCallback,
} from "./ports.js";
import {
  assertGitHubRepositoryTreePathSafety,
  canonicalDigest,
  sha256Digest,
  type GitHubRepositoryTreePathMetadata,
} from "./security.js";
import {
  assertGitHubRepositoryImportScope,
  classifyGitHubRepositoryImportPath,
  GITHUB_REPOSITORY_IMPORT_LIMITS,
  gitHubRepositoryImportPathSchema,
} from "./repository-import-security.js";

function sha(value: unknown): GitSha {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

function fileMapsEqual(
  left: ReadonlyMap<string, Uint8Array>,
  right: ReadonlyMap<string, Uint8Array>,
): boolean {
  if (left.size !== right.size) return false;
  return [...left].every(([path, bytes]) => {
    const candidate = right.get(path);
    return (
      candidate !== undefined && sha256Digest(candidate) === sha256Digest(bytes)
    );
  });
}

function deleteFakePath(files: Map<string, Uint8Array>, path: string): void {
  for (const candidate of files.keys()) {
    if (candidate === path || candidate.startsWith(`${path}/`)) {
      files.delete(candidate);
    }
  }
}

function upsertFakeFile(
  files: Map<string, Uint8Array>,
  path: string,
  bytes: Uint8Array,
): void {
  for (const candidate of files.keys()) {
    if (
      candidate === path ||
      candidate.startsWith(`${path}/`) ||
      path.startsWith(`${candidate}/`)
    ) {
      files.delete(candidate);
    }
  }
  files.set(path, new Uint8Array(bytes));
}

function fakeTreePathMetadata(
  files: ReadonlyMap<string, Uint8Array>,
): readonly GitHubRepositoryTreePathMetadata[] {
  const entries = new Map<string, GitHubRepositoryTreePathMetadata>();
  for (const path of [...files.keys()].sort()) {
    for (const ancestor of properFakePathAncestors(path)) {
      const existing = entries.get(ancestor);
      if (existing?.type === "blob") {
        throw new GitHubExportError("path-conflict");
      }
      entries.set(ancestor, { mode: "040000", path: ancestor, type: "tree" });
    }
    if (entries.get(path)?.type === "tree") {
      throw new GitHubExportError("path-conflict");
    }
    entries.set(path, { mode: "100644", path, type: "blob" });
  }
  return [...entries.values()];
}

function properFakePathAncestors(path: string): readonly string[] {
  const segments = path.split("/");
  return segments
    .slice(0, -1)
    .map((_, index) => segments.slice(0, index + 1).join("/"));
}

function repositoryKey(owner: string, name: string): string {
  return `${owner.toLowerCase()}/${name.toLowerCase()}`;
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface FakeBranchState {
  readonly files: Map<string, Uint8Array>;
  parentSha?: GitSha;
  sha: GitSha;
}

interface FakeRepositoryState {
  readonly branches: Map<string, FakeBranchState>;
  readonly commits: Map<GitSha, ReadonlyMap<string, Uint8Array>>;
  descriptor: GitHubRepositoryDescriptor;
  readonly protectedBranches: Set<string>;
  readonly protectedBranchPrefixes: readonly string[];
}

export type FakeGitHubFailurePoint =
  | "create-branch"
  | "create-commit-after-update"
  | "create-pull-request-after-create"
  | "inspect-installation"
  | "list-branches"
  | "list-repositories"
  | "open-session"
  | "read-pinned-snapshot"
  | "read-snapshot";

export class FakeGitHubAppAdapter implements GitHubAppAdapter {
  readonly requestedSessions: {
    readonly installationId: number;
    readonly permissions: GitHubAppRepositoryPermissions;
    readonly repositoryIds?: readonly number[];
  }[] = [];
  sessionsClosed = 0;
  sessionsOpened = 0;
  readonly #failures = new Map<FakeGitHubFailurePoint, number>();
  readonly #rateLimits = new Map<FakeGitHubFailurePoint, number>();
  #headMutationAfterPullRequestLookup:
    { readonly bytes: Uint8Array; readonly path: string } | undefined;
  #baseMutationAfterPullRequestLookup:
    { readonly bytes: Uint8Array; readonly path: string } | undefined;
  #nextMergeBaseSha: GitSha | undefined;
  readonly #installations = new Map<number, GitHubInstallationDescriptor>();
  readonly #pullRequests = new Map<string, GitHubPullRequestDescriptor>();
  readonly #repositories = new Map<string, FakeRepositoryState>();
  #sessionHold:
    | {
        readonly entered: ReturnType<typeof deferred>;
        readonly release: ReturnType<typeof deferred>;
      }
    | undefined;

  addInstallation(descriptor: GitHubInstallationDescriptor): void {
    this.#installations.set(descriptor.installationId, descriptor);
  }

  revokeInstallation(installationId: number): void {
    this.#installations.delete(installationId);
  }

  rateLimitNext(point: FakeGitHubFailurePoint, count = 1): void {
    this.#rateLimits.set(point, count);
  }

  addRepository(
    descriptor: GitHubRepositoryDescriptor,
    branches: Readonly<
      Record<string, Readonly<Record<string, Uint8Array | string>>>
    >,
    protectedBranches: readonly string[] = [],
    protectedBranchPrefixes: readonly string[] = [],
  ): void {
    const branchStates = new Map<string, FakeBranchState>();
    const commits = new Map<GitSha, ReadonlyMap<string, Uint8Array>>();
    for (const [branch, files] of Object.entries(branches)) {
      const bytes = new Map(
        Object.entries(files).map(([path, value]) => [
          path,
          typeof value === "string" ? new TextEncoder().encode(value) : value,
        ]),
      );
      const commitSha = sha({ branch, files: [...bytes] });
      branchStates.set(branch, {
        files: bytes,
        sha: commitSha,
      });
      commits.set(
        commitSha,
        new Map(
          [...bytes].map(
            ([path, value]) => [path, new Uint8Array(value)] as const,
          ),
        ),
      );
    }
    this.#repositories.set(repositoryKey(descriptor.owner, descriptor.name), {
      branches: branchStates,
      commits,
      descriptor,
      protectedBranches: new Set(protectedBranches),
      protectedBranchPrefixes: [...protectedBranchPrefixes],
    });
  }

  branchFiles(
    owner: string,
    name: string,
    branch: string,
  ): ReadonlyMap<string, Uint8Array> {
    const state = this.#repositories.get(repositoryKey(owner, name));
    const files = state?.branches.get(branch)?.files;
    if (files === undefined)
      throw new GitHubExportError("repository-not-found");
    return new Map(
      [...files].map(([path, bytes]) => [path, new Uint8Array(bytes)] as const),
    );
  }

  setFile(
    owner: string,
    name: string,
    branch: string,
    path: string,
    value: Uint8Array | string,
  ): void {
    const state = this.#repositories.get(repositoryKey(owner, name));
    const branchState = state?.branches.get(branch);
    if (branchState === undefined)
      throw new GitHubExportError("repository-not-found");
    const previousSha = branchState.sha;
    upsertFakeFile(
      branchState.files,
      path,
      typeof value === "string" ? new TextEncoder().encode(value) : value,
    );
    branchState.sha = sha({
      parent: previousSha,
      files: [...branchState.files].map(([filePath, bytes]) => [
        filePath,
        sha256Digest(bytes),
      ]),
    });
    branchState.parentSha = previousSha;
    state?.commits.set(
      branchState.sha,
      new Map(
        [...branchState.files].map(
          ([filePath, bytes]) => [filePath, new Uint8Array(bytes)] as const,
        ),
      ),
    );
  }

  setRepositoryPrivate(owner: string, name: string, value: boolean): void {
    const state = this.#repositories.get(repositoryKey(owner, name));
    if (state === undefined) {
      throw new GitHubExportError("repository-not-found");
    }
    state.descriptor = {
      ...state.descriptor,
      private: value,
    };
  }

  setRepositoryIdentity(
    owner: string,
    name: string,
    identity: {
      readonly ownerId?: number;
      readonly repositoryId?: number;
    },
  ): void {
    const state = this.#repositories.get(repositoryKey(owner, name));
    if (state === undefined) {
      throw new GitHubExportError("repository-not-found");
    }
    state.descriptor = {
      ...state.descriptor,
      ...(identity.ownerId === undefined ? {} : { ownerId: identity.ownerId }),
      ...(identity.repositoryId === undefined
        ? {}
        : { repositoryId: identity.repositoryId }),
    };
  }

  get pullRequestCount(): number {
    return this.#pullRequests.size;
  }

  changeFeatureHeadAfterNextPullRequestLookup(
    path: string,
    value: Uint8Array | string,
  ): void {
    this.#headMutationAfterPullRequestLookup = {
      bytes:
        typeof value === "string" ? new TextEncoder().encode(value) : value,
      path,
    };
  }

  changeBaseHeadAfterNextPullRequestLookup(
    path: string,
    value: Uint8Array | string,
  ): void {
    this.#baseMutationAfterPullRequestLookup = {
      bytes:
        typeof value === "string" ? new TextEncoder().encode(value) : value,
      path,
    };
  }

  returnMergeBaseOnce(value: GitSha): void {
    this.#nextMergeBaseSha = value;
  }

  failNext(point: FakeGitHubFailurePoint, count = 1): void {
    this.#failures.set(point, count);
  }

  holdNextInstallationSession(): Promise<void> {
    if (this.#sessionHold !== undefined) {
      throw new Error("A fake GitHub installation session is already held.");
    }
    const entered = deferred();
    this.#sessionHold = { entered, release: deferred() };
    return entered.promise;
  }

  releaseHeldInstallationSession(): void {
    const hold = this.#sessionHold;
    if (hold === undefined) {
      throw new Error("No fake GitHub installation session is held.");
    }
    hold.release.resolve();
  }

  inspectInstallation(
    installationId: number,
  ): Promise<GitHubInstallationDescriptor> {
    this.#throwIfFailed("inspect-installation");
    const installation = this.#installations.get(installationId);
    if (installation === undefined) {
      return Promise.reject(new GitHubExportError("installation-revoked"));
    }
    return Promise.resolve(installation);
  }

  async withInstallationSession<T>(
    input: {
      readonly installationId: number;
      readonly permissions: GitHubAppRepositoryPermissions;
      readonly repositoryIds?: readonly number[];
    },
    operation: (session: GitHubInstallationSession) => Promise<T>,
  ): Promise<T> {
    this.#throwIfFailed("open-session");
    if (!this.#installations.has(input.installationId)) {
      throw new GitHubExportError("installation-revoked");
    }
    this.sessionsOpened += 1;
    this.requestedSessions.push(input);
    const hold = this.#sessionHold;
    if (hold !== undefined) {
      hold.entered.resolve();
      await hold.release.promise;
      if (this.#sessionHold === hold) this.#sessionHold = undefined;
    }
    try {
      return await operation(this.#session(input));
    } finally {
      this.sessionsClosed += 1;
    }
  }

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
  ): Promise<T> {
    if (input.repositoryIds.length !== 1) {
      return Promise.reject(new GitHubExportError("invalid-request"));
    }
    return this.withInstallationSession(
      {
        installationId: input.installationId,
        permissions: {
          contents: "read",
          metadata: "read",
          pullRequests: "none",
          workflows: "none",
        },
        repositoryIds: input.repositoryIds,
      },
      operation,
    );
  }

  #session(input: {
    readonly installationId: number;
    readonly repositoryIds?: readonly number[];
  }): GitHubInstallationSession {
    const accessible = () =>
      [...this.#repositories.values()].filter(
        ({ descriptor }) =>
          descriptor.installationId === input.installationId &&
          (input.repositoryIds === undefined ||
            input.repositoryIds.includes(descriptor.repositoryId)),
      );
    const stateFor = (repository: GitHubRepositoryDescriptor) => {
      const state = this.#repositories.get(
        repositoryKey(repository.owner, repository.name),
      );
      if (
        state?.descriptor.repositoryId !== repository.repositoryId ||
        !accessible().includes(state)
      ) {
        throw new GitHubExportError("repository-not-found");
      }
      return state;
    };
    const session: GitHubInstallationSession = {
      createBranch: ({ baseCommitSha, branch, repository }) => {
        this.#throwIfFailed("create-branch");
        const state = stateFor(repository);
        if (state.branches.has(branch)) {
          return Promise.reject(new GitHubExportError("branch-conflict"));
        }
        const base = [...state.branches.values()].find(
          ({ sha: candidate }) => candidate === baseCommitSha,
        );
        if (base === undefined) {
          return Promise.reject(new GitHubExportError("repository-changed"));
        }
        state.branches.set(branch, {
          files: new Map(base.files),
          sha: baseCommitSha,
        });
        if (
          state.protectedBranchPrefixes.some((prefix) =>
            branch.startsWith(prefix),
          )
        ) {
          state.protectedBranches.add(branch);
        }
        return Promise.resolve();
      },
      createCommit: ({ branch, expectedHeadSha, mutations, repository }) => {
        const state = stateFor(repository);
        const branchState = state.branches.get(branch);
        const base = [...state.branches.values()].find(
          ({ sha: candidate }) => candidate === expectedHeadSha,
        );
        if (branchState === undefined || base === undefined) {
          return Promise.reject(new GitHubExportError("repository-changed"));
        }
        const expectedFiles = new Map(
          [...base.files].map(
            ([path, bytes]) => [path, new Uint8Array(bytes)] as const,
          ),
        );
        for (const mutation of mutations) {
          if (mutation.type === "delete")
            deleteFakePath(expectedFiles, mutation.path);
          else if (mutation.bytes !== undefined) {
            upsertFakeFile(expectedFiles, mutation.path, mutation.bytes);
          }
        }
        if (branchState.sha !== expectedHeadSha) {
          if (
            branchState.parentSha !== expectedHeadSha ||
            !fileMapsEqual(branchState.files, expectedFiles)
          ) {
            return Promise.reject(new GitHubExportError("repository-changed"));
          }
          return Promise.resolve(branchState.sha);
        }
        if (state.protectedBranches.has(branch)) {
          return Promise.reject(
            new GitHubExportError("github-permission-denied"),
          );
        }
        branchState.files.clear();
        for (const [path, bytes] of expectedFiles) {
          branchState.files.set(path, new Uint8Array(bytes));
        }
        branchState.parentSha = expectedHeadSha;
        branchState.sha = sha({
          parent: expectedHeadSha,
          files: [...branchState.files].map(([path, bytes]) => [
            path,
            sha256Digest(bytes),
          ]),
        });
        const commitSha = branchState.sha;
        state.commits.set(
          commitSha,
          new Map(
            [...branchState.files].map(
              ([path, bytes]) => [path, new Uint8Array(bytes)] as const,
            ),
          ),
        );
        this.#throwIfFailed("create-commit-after-update");
        return Promise.resolve(commitSha);
      },
      createPullRequest: ({ baseBranch, featureBranch, repository }) => {
        const state = stateFor(repository);
        if (
          !state.branches.has(baseBranch) ||
          !state.branches.has(featureBranch)
        ) {
          return Promise.reject(new GitHubExportError("repository-changed"));
        }
        const key = `${String(repository.repositoryId)}:${baseBranch}:${featureBranch}`;
        if (this.#pullRequests.has(key)) {
          return Promise.reject(new GitHubExportError("branch-conflict"));
        }
        const pullRequest = {
          number: this.#pullRequests.size + 1,
          url: `https://github.example/${repository.owner}/${repository.name}/pull/${String(this.#pullRequests.size + 1)}`,
        };
        this.#pullRequests.set(key, pullRequest);
        this.#throwIfFailed("create-pull-request-after-create");
        return Promise.resolve(pullRequest);
      },
      findBranch: ({ branch, repository }) => {
        const branchState = stateFor(repository).branches.get(branch);
        return Promise.resolve(
          branchState === undefined ? null : { sha: branchState.sha },
        );
      },
      findPullRequest: ({ baseBranch, featureBranch, repository }) => {
        const pullRequest =
          this.#pullRequests.get(
            `${String(repository.repositoryId)}:${baseBranch}:${featureBranch}`,
          ) ?? null;
        const baseMutation = this.#baseMutationAfterPullRequestLookup;
        if (baseMutation !== undefined) {
          this.#baseMutationAfterPullRequestLookup = undefined;
          const branchState = stateFor(repository).branches.get(baseBranch);
          if (branchState === undefined) {
            return Promise.reject(new GitHubExportError("repository-changed"));
          }
          const previousSha = branchState.sha;
          upsertFakeFile(
            branchState.files,
            baseMutation.path,
            baseMutation.bytes,
          );
          branchState.sha = sha({
            parent: previousSha,
            files: [...branchState.files].map(([path, bytes]) => [
              path,
              sha256Digest(bytes),
            ]),
          });
          branchState.parentSha = previousSha;
        }
        const mutation = this.#headMutationAfterPullRequestLookup;
        if (mutation !== undefined) {
          this.#headMutationAfterPullRequestLookup = undefined;
          const branchState = stateFor(repository).branches.get(featureBranch);
          if (branchState === undefined) {
            return Promise.reject(new GitHubExportError("repository-changed"));
          }
          const previousSha = branchState.sha;
          upsertFakeFile(branchState.files, mutation.path, mutation.bytes);
          branchState.sha = sha({
            parent: previousSha,
            files: [...branchState.files].map(([path, bytes]) => [
              path,
              sha256Digest(bytes),
            ]),
          });
          branchState.parentSha = previousSha;
        }
        return Promise.resolve(pullRequest);
      },
      findMergeBase: ({ baseCommitSha, headCommitSha, repository }) => {
        const override = this.#nextMergeBaseSha;
        if (override !== undefined) {
          this.#nextMergeBaseSha = undefined;
          return Promise.resolve(override);
        }
        const head = [...stateFor(repository).branches.values()].find(
          ({ sha: candidate }) => candidate === headCommitSha,
        );
        if (
          head === undefined ||
          (head.sha !== baseCommitSha && head.parentSha !== baseCommitSha)
        ) {
          return Promise.reject(new GitHubExportError("repository-changed"));
        }
        return Promise.resolve(baseCommitSha);
      },
      listBranches: (repository) => {
        this.#throwIfFailed("list-branches");
        const state = stateFor(repository);
        return Promise.resolve(
          [...state.branches].map(([name, branch]): GitHubRepositoryBranch => ({
            name,
            protected: state.protectedBranches.has(name),
            sha: branch.sha,
          })),
        );
      },
      listRepositories: () => {
        this.#throwIfFailed("list-repositories");
        return Promise.resolve(
          accessible().map(({ descriptor }) => descriptor),
        );
      },
      discoverPinnedFiles: async (input) => {
        // This in-memory fake already owns all bytes; no provider blob read occurs.
        const snapshot = await session.readPinnedSnapshot(input);
        return {
          branch: snapshot.branch,
          branchHeadSha: snapshot.branchHeadSha,
          commitSha: snapshot.commitSha,
          files: snapshot.files.map(({ path, gitBlobSha, bytes }) => ({
            path,
            gitBlobSha,
            sizeBytes: bytes.byteLength,
          })),
          repositoryId: snapshot.repositoryId,
          treeSha: snapshot.treeSha,
        };
      },
      readPinnedSnapshot: ({
        branch,
        commitSha,
        ignoredPaths,
        repository,
        selectedPaths,
      }) => {
        this.#throwIfFailed("read-pinned-snapshot");
        assertGitHubRepositoryImportScope({ ignoredPaths, selectedPaths });
        const state = stateFor(repository);
        const branchState = state.branches.get(branch);
        const commitFiles = state.commits.get(commitSha);
        if (branchState === undefined || commitFiles === undefined) {
          return Promise.reject(new GitHubExportError("repository-not-found"));
        }
        const entries = fakeTreePathMetadata(commitFiles);
        if (entries.length > GITHUB_REPOSITORY_IMPORT_LIMITS.treeEntries) {
          return Promise.reject(new GitHubExportError("import-blocked"));
        }
        const portable = new Map<string, string>();
        const files = [];
        const ignoredFiles = [];
        let totalBytes = 0;
        for (const [path, bytes] of [...commitFiles].sort(([left], [right]) =>
          left.localeCompare(right, "en"),
        )) {
          if (!gitHubRepositoryImportPathSchema.safeParse(path).success) {
            return Promise.reject(new GitHubExportError("import-blocked"));
          }
          const key = path.normalize("NFC").toLowerCase();
          const existing = portable.get(key);
          if (existing !== undefined && existing !== path) {
            return Promise.reject(new GitHubExportError("import-blocked"));
          }
          portable.set(key, path);
          const classification = classifyGitHubRepositoryImportPath({
            ignoredPaths,
            path,
            selectedPaths,
          });
          if (classification === "outside-scope") continue;
          if (classification !== "selected") {
            ignoredFiles.push({ path, reason: classification });
            continue;
          }
          if (bytes.byteLength > GITHUB_REPOSITORY_IMPORT_LIMITS.fileBytes) {
            return Promise.reject(new GitHubExportError("import-blocked"));
          }
          totalBytes += bytes.byteLength;
          if (totalBytes > GITHUB_REPOSITORY_IMPORT_LIMITS.totalBytes) {
            return Promise.reject(new GitHubExportError("import-blocked"));
          }
          files.push({
            bytes: new Uint8Array(bytes),
            digest: sha256Digest(bytes),
            gitBlobSha: sha({ path, digest: sha256Digest(bytes) }),
            path,
          });
        }
        if (files.length > GITHUB_REPOSITORY_IMPORT_LIMITS.files) {
          return Promise.reject(new GitHubExportError("import-blocked"));
        }
        return Promise.resolve({
          baseBranch: branch,
          branch,
          branchHeadSha: branchState.sha,
          commitSha,
          defaultBranch: repository.defaultBranch,
          files,
          ignoredFiles,
          repositoryId: repository.repositoryId,
          repositoryName: repository.name,
          repositoryOwner: repository.owner,
          repositoryOwnerId: repository.ownerId,
          treeSha: sha(
            [...commitFiles].map(([path, bytes]) => ({
              digest: sha256Digest(bytes),
              path,
            })),
          ),
        });
      },
      readSnapshot: ({
        candidatePaths,
        baseBranch,
        destinationFolder,
        repository,
        workflowPaths,
      }) => {
        this.#throwIfFailed("read-snapshot");
        const state = stateFor(repository);
        const branch = state.branches.get(baseBranch);
        if (branch === undefined) {
          return Promise.reject(new GitHubExportError("repository-not-found"));
        }
        assertGitHubRepositoryTreePathSafety({
          candidatePaths,
          destinationFolder,
          entries: fakeTreePathMetadata(branch.files),
          workflowPaths,
        });
        const prefix = destinationFolder === "" ? "" : `${destinationFolder}/`;
        const files = [...branch.files]
          .filter(
            ([path]) =>
              (prefix === ""
                ? !path.startsWith(".git/")
                : path.startsWith(prefix)) || workflowPaths.includes(path),
          )
          .map(([path, bytes]) => ({
            bytes: new Uint8Array(bytes),
            digest: sha256Digest(bytes),
            gitBlobSha: sha({ path, digest: sha256Digest(bytes) }),
            path,
          }));
        const snapshot: GitHubRepositorySnapshot = {
          baseBranch,
          baseCommitSha: branch.sha,
          defaultBranch: repository.defaultBranch,
          files,
          repositoryId: repository.repositoryId,
          repositoryName: repository.name,
          repositoryOwner: repository.owner,
          repositoryOwnerId: repository.ownerId,
          treeSha: sha(
            [...branch.files]
              .sort(([left], [right]) => left.localeCompare(right, "en"))
              .map(([path, bytes]) => ({
                digest: sha256Digest(bytes),
                path,
              })),
          ),
        };
        return Promise.resolve(snapshot);
      },
    };
    return session;
  }

  #throwIfFailed(point: FakeGitHubFailurePoint): void {
    const limited = this.#rateLimits.get(point) ?? 0;
    if (limited > 0) {
      this.#rateLimits.set(point, limited - 1);
      throw new GitHubExportError("rate-limited", {
        retryAfterSeconds: 60,
        transient: true,
      });
    }
    const remaining = this.#failures.get(point) ?? 0;
    if (remaining <= 0) return;
    this.#failures.set(point, remaining - 1);
    throw new GitHubExportError("service-unavailable", { transient: true });
  }
}

export class FakeGitHubInstallationLinkCallbackVerifier implements GitHubInstallationLinkCallbackVerifier {
  readonly #receipts = new Map<
    string,
    VerifiedGitHubInstallationLinkCallback
  >();

  addReceipt(
    receipt: string,
    callback: VerifiedGitHubInstallationLinkCallback,
  ): void {
    this.#receipts.set(receipt, callback);
  }

  verifyCallbackReceipt(
    receipt: string,
  ): Promise<VerifiedGitHubInstallationLinkCallback> {
    const callback = this.#receipts.get(receipt);
    if (callback === undefined)
      throw new GitHubExportError("installation-link-invalid");
    return Promise.resolve(callback);
  }
}

type StoredSucceededGitHubExportExecution = StoredGitHubExportExecution & {
  readonly authority: GitHubPreviousExportAuthorityV1;
  readonly commitSha: GitSha;
  readonly receipt: GitHubExportReceipt;
  readonly state: "succeeded";
};

function hasValidSucceededAuthorityBinding(
  record: StoredGitHubExportExecution,
): record is StoredSucceededGitHubExportExecution {
  if (
    record.state !== "succeeded" ||
    !record.branchCreated ||
    record.commitSha === undefined ||
    record.receipt === undefined ||
    record.authority === undefined ||
    !gitHubPreviousExportAuthorityV1Schema.safeParse(record.authority).success
  ) {
    return false;
  }
  const { authority, receipt } = record;
  const { authorityDigest: ignoredAuthorityDigest, ...authorityPayload } =
    authority;
  void ignoredAuthorityDigest;
  return (
    authority.inventoryDigest === canonicalDigest(authority.files) &&
    authority.authorityDigest === canonicalDigest(authorityPayload) &&
    authority.executionId === record.executionId &&
    receipt.executionId === record.executionId &&
    authority.organizationId === record.organizationId &&
    receipt.organizationId === record.organizationId &&
    authority.projectId === record.projectId &&
    receipt.projectId === record.projectId &&
    authority.previewDigest === record.previewDigest &&
    receipt.previewDigest === record.previewDigest &&
    authority.artifactDigest === record.artifactDigest &&
    authority.commitSha === record.commitSha &&
    receipt.commitSha === record.commitSha &&
    authority.completedAt === receipt.completedAt &&
    record.updatedAt === receipt.completedAt &&
    authority.pullRequestNumber === receipt.pullRequestNumber &&
    authority.pullRequestUrl === receipt.pullRequestUrl &&
    authority.repositoryId === receipt.repositoryId &&
    authority.featureBranch === receipt.branch
  );
}

export class InMemoryGitHubExportStore implements GitHubExportStore {
  #consumeInstallationLinkFailure: "after-commit" | "before-commit" | undefined;
  #finalizeInstallationLinkFailure:
    "after-commit" | "before-commit" | undefined;
  readonly #executionAttempts = new Map<string, string>();

  readonly installationLinkIntents = new Map<
    string,
    GitHubInstallationLinkIntent
  >();
  readonly executions = new Map<string, StoredGitHubExportExecution>();
  readonly installations = new Map<string, GitHubInstallationRecord>();
  readonly previews = new Map<string, StoredGitHubExportPreview>();
  readonly repositories = new Map<string, GitHubRepositoryRecord>();
  readonly webhooks = new Map<string, GitHubWebhookDeliveryRecord>();

  failNextInstallationLinkConsumption(
    point: "after-commit" | "before-commit",
  ): void {
    this.#consumeInstallationLinkFailure = point;
  }

  failNextInstallationLinkFinalization(
    point: "after-commit" | "before-commit",
  ): void {
    this.#finalizeInstallationLinkFailure = point;
  }

  finalizeInstallationLink(input: {
    readonly installation: GitHubInstallationRecord;
    readonly intentId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly stateDigest: Sha256Digest;
  }): Promise<void> {
    const installation = gitHubInstallationRecordSchema.parse(
      input.installation,
    );
    const intent = this.installationLinkIntents.get(input.intentId);
    if (
      installation.organizationId !== input.organizationId ||
      intent?.state !== "consumed" ||
      intent.organizationId !== input.organizationId ||
      intent.principalId !== input.principalId ||
      intent.stateDigest !== input.stateDigest ||
      Date.parse(intent.expiresAt) <= Date.parse(input.now)
    ) {
      throw new GitHubExportError("installation-link-invalid");
    }
    const installationCollision = [...this.installations.values()].find(
      (record) => record.installationId === installation.installationId,
    );
    if (
      installationCollision !== undefined &&
      (installationCollision.organizationId !== input.organizationId ||
        installationCollision.integrationId !== installation.integrationId)
    ) {
      throw new GitHubExportError("installation-link-invalid");
    }
    const integrationCollision = this.installations.get(
      `${input.organizationId}:${installation.integrationId}`,
    );
    if (
      integrationCollision !== undefined &&
      integrationCollision.installationId !== installation.installationId
    ) {
      throw new GitHubExportError("installation-link-invalid");
    }
    if (this.#finalizeInstallationLinkFailure === "before-commit") {
      this.#finalizeInstallationLinkFailure = undefined;
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    this.installations.set(
      `${installation.organizationId}:${installation.integrationId}`,
      installation,
    );
    this.installationLinkIntents.set(input.intentId, {
      ...intent,
      completedInstallationId: installation.installationId,
      completedIntegrationId: installation.integrationId,
      state: "completed",
    });
    if (this.#finalizeInstallationLinkFailure === "after-commit") {
      this.#finalizeInstallationLinkFailure = undefined;
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    return Promise.resolve();
  }

  releaseInstallationLinkIntent(input: {
    readonly intentId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly stateDigest: Sha256Digest;
  }): Promise<"completed" | "expired" | "invalid" | "released"> {
    const record = this.installationLinkIntents.get(input.intentId);
    if (
      record?.organizationId !== input.organizationId ||
      record.principalId !== input.principalId ||
      record.stateDigest !== input.stateDigest
    ) {
      return Promise.resolve("invalid");
    }
    if (record.state === "completed") return Promise.resolve("completed");
    if (Date.parse(record.expiresAt) <= Date.parse(input.now)) {
      return Promise.resolve("expired");
    }
    if (record.state === "pending") return Promise.resolve("released");
    this.installationLinkIntents.set(input.intentId, {
      ...record,
      state: "pending",
    });
    return Promise.resolve("released");
  }

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
  > {
    const record = this.installationLinkIntents.get(input.intentId);
    if (
      record?.organizationId !== input.organizationId ||
      record.principalId !== input.principalId ||
      record.stateDigest !== input.stateDigest
    ) {
      return Promise.resolve({ outcome: "invalid" });
    }
    if (record.state === "completed") {
      return Promise.resolve({ outcome: "completed", record });
    }
    if (record.state !== "pending") {
      return Promise.resolve({ outcome: "replayed" });
    }
    if (Date.parse(record.expiresAt) <= Date.parse(input.now)) {
      return Promise.resolve({ outcome: "expired" });
    }
    if (this.#consumeInstallationLinkFailure === "before-commit") {
      this.#consumeInstallationLinkFailure = undefined;
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    const consumed: GitHubInstallationLinkIntent = {
      ...record,
      state: "consumed",
    };
    this.installationLinkIntents.set(input.intentId, consumed);
    if (this.#consumeInstallationLinkFailure === "after-commit") {
      this.#consumeInstallationLinkFailure = undefined;
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    return Promise.resolve({ outcome: "consumed", record: consumed });
  }

  getExecutionByIdempotency(input: {
    readonly idempotencyKeyDigest: Sha256Digest;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<StoredGitHubExportExecution | null> {
    return Promise.resolve(
      this.executions.get(
        `${input.organizationId}:${input.projectId}:${input.idempotencyKeyDigest}`,
      ) ?? null,
    );
  }

  getInstallation(input: {
    readonly integrationId: string;
    readonly organizationId: string;
  }): Promise<GitHubInstallationRecord | null> {
    return Promise.resolve(
      this.installations.get(
        `${input.organizationId}:${input.integrationId}`,
      ) ?? null,
    );
  }

  getInstallationByInstallationId(
    installationId: number,
  ): Promise<GitHubInstallationRecord | null> {
    return Promise.resolve(
      [...this.installations.values()].find(
        (record) => record.installationId === installationId,
      ) ?? null,
    );
  }

  listInstallations(input: {
    readonly organizationId: string;
  }): Promise<readonly GitHubInstallationRecord[]> {
    return Promise.resolve(
      [...this.installations.values()].filter(
        (record) => record.organizationId === input.organizationId,
      ),
    );
  }

  getPreview(input: {
    readonly organizationId: string;
    readonly previewId: string;
    readonly projectId: string;
  }): Promise<StoredGitHubExportPreview | null> {
    return Promise.resolve(
      this.previews.get(
        `${input.organizationId}:${input.projectId}:${input.previewId}`,
      ) ?? null,
    );
  }

  getRepository(input: {
    readonly integrationId: string;
    readonly organizationId: string;
    readonly repositoryId: number;
  }): Promise<GitHubRepositoryRecord | null> {
    return Promise.resolve(
      this.repositories.get(
        `${input.organizationId}:${input.integrationId}:${String(input.repositoryId)}`,
      ) ?? null,
    );
  }

  findLatestPreviousExportAuthority(
    input: GitHubPreviousExportAuthorityTarget,
  ): Promise<GitHubPreviousExportAuthorityV1 | null> {
    const matches = [...this.executions.values()]
      .filter(hasValidSucceededAuthorityBinding)
      .map(({ authority }) => authority)
      .filter(
        (authority) =>
          authority.baseBranch === input.baseBranch &&
          authority.destinationFolder === input.destinationFolder &&
          authority.installationId === input.installationId &&
          authority.integrationId === input.integrationId &&
          authority.organizationId === input.organizationId &&
          authority.projectId === input.projectId &&
          authority.repositoryId === input.repositoryId &&
          authority.repositoryOwnerId === input.repositoryOwnerId,
      )
      .sort((left, right) =>
        left.completedAt === right.completedAt
          ? right.executionId < left.executionId
            ? -1
            : right.executionId > left.executionId
              ? 1
              : 0
          : right.completedAt < left.completedAt
            ? -1
            : 1,
      );
    return Promise.resolve(matches[0] ?? null);
  }

  getPreviousExportAuthority(input: {
    readonly authorityId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<GitHubPreviousExportAuthorityV1 | null> {
    const authority = [...this.executions.values()]
      .filter(hasValidSucceededAuthorityBinding)
      .filter(
        (record) =>
          record.organizationId === input.organizationId &&
          record.projectId === input.projectId,
      )
      .map(({ authority }) => authority)
      .find((candidate) => candidate.executionId === input.authorityId);
    return Promise.resolve(authority ?? null);
  }

  reserveExecution(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubExportExecution;
  }): ReturnType<GitHubExportStore["reserveExecution"]> {
    const { attemptId, record } = input;
    const key = `${record.organizationId}:${record.projectId}:${record.idempotencyKeyDigest}`;
    const existing = this.executions.get(key);
    if (existing === undefined) {
      if (
        record.state !== "running" ||
        record.recordVersion !== 1 ||
        record.receipt !== undefined ||
        record.authority !== undefined ||
        record.failureCode !== undefined
      ) {
        throw new GitHubExportError("invalid-request");
      }
      this.executions.set(key, record);
      this.#executionAttempts.set(key, attemptId);
      return Promise.resolve({ outcome: "acquired", record });
    }
    if (
      existing.createdByPrincipalId !== record.createdByPrincipalId ||
      existing.previewId !== record.previewId ||
      existing.previewDigest !== record.previewDigest ||
      existing.artifactDigest !== record.artifactDigest
    ) {
      return Promise.resolve({ outcome: "conflict", record: existing });
    }
    if (existing.state === "running") {
      return Promise.resolve({ outcome: "in-progress", record: existing });
    }
    if (existing.state === "succeeded") {
      if (!hasValidSucceededAuthorityBinding(existing)) {
        throw new GitHubExportError("service-unavailable", { transient: true });
      }
      return Promise.resolve({ outcome: "terminal", record: existing });
    }
    if (existing.state === "failed-permanent") {
      if (
        existing.failureCode === undefined ||
        existing.receipt !== undefined ||
        existing.authority !== undefined
      ) {
        throw new GitHubExportError("service-unavailable", { transient: true });
      }
      return Promise.resolve({ outcome: "terminal", record: existing });
    }
    const {
      authority: ignoredAuthority,
      failureCode: ignoredFailure,
      receipt: ignoredReceipt,
      ...retryable
    } = existing;
    void ignoredAuthority;
    void ignoredFailure;
    void ignoredReceipt;
    const reclaimed: StoredGitHubExportExecution = {
      ...retryable,
      recordVersion: existing.recordVersion + 1,
      state: "running",
      updatedAt: record.updatedAt,
    };
    this.executions.set(key, reclaimed);
    this.#executionAttempts.set(key, attemptId);
    return Promise.resolve({ outcome: "acquired", record: reclaimed });
  }

  reserveInstallationLinkIntent(record: GitHubInstallationLinkIntent): Promise<{
    readonly created: boolean;
    readonly record: GitHubInstallationLinkIntent;
  }> {
    const existing = this.installationLinkIntents.get(record.intentId);
    const digestCollision = [...this.installationLinkIntents.values()].find(
      (candidate) => candidate.stateDigest === record.stateDigest,
    );
    const collision = existing ?? digestCollision;
    if (collision !== undefined) {
      return Promise.resolve({
        created: false,
        record: collision,
      });
    }
    this.installationLinkIntents.set(record.intentId, record);
    return Promise.resolve({ created: true, record });
  }

  reserveWebhookDelivery(record: GitHubWebhookDeliveryRecord): Promise<{
    readonly created: boolean;
    readonly record: GitHubWebhookDeliveryRecord;
  }> {
    const existing = this.webhooks.get(record.deliveryId);
    if (
      existing?.state === "failed" &&
      existing.event === record.event &&
      existing.payloadDigest === record.payloadDigest
    ) {
      const { processedAt, ...failed } = existing;
      void processedAt;
      const reclaimed: GitHubWebhookDeliveryRecord = {
        ...failed,
        state: "received",
      };
      this.webhooks.set(record.deliveryId, reclaimed);
      return Promise.resolve({ created: true, record: reclaimed });
    }
    if (existing !== undefined) {
      return Promise.resolve({ created: false, record: existing });
    }
    this.webhooks.set(record.deliveryId, record);
    return Promise.resolve({ created: true, record });
  }

  saveExecution(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubExportExecution;
  }): ReturnType<GitHubExportStore["saveExecution"]> {
    const { attemptId, record } = input;
    const key = `${record.organizationId}:${record.projectId}:${record.idempotencyKeyDigest}`;
    const existing = this.executions.get(key);
    if (existing === undefined) {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    const stale =
      this.#executionAttempts.get(key) !== attemptId ||
      existing.state !== "running" ||
      existing.createdByPrincipalId !== record.createdByPrincipalId ||
      existing.executionId !== record.executionId ||
      existing.previewId !== record.previewId ||
      existing.previewDigest !== record.previewDigest ||
      existing.artifactDigest !== record.artifactDigest ||
      existing.recordVersion !== record.recordVersion;
    if (stale) return Promise.resolve({ outcome: "stale", record: existing });

    const validRunning =
      record.state === "running" &&
      record.receipt === undefined &&
      record.authority === undefined &&
      record.failureCode === undefined;
    const validSuccess =
      hasValidSucceededAuthorityBinding(record) &&
      record.failureCode === undefined;
    const validFailure =
      (record.state === "failed-transient" ||
        record.state === "failed-permanent") &&
      record.receipt === undefined &&
      record.authority === undefined &&
      record.failureCode !== undefined;
    if (!validRunning && !validSuccess && !validFailure) {
      throw new GitHubExportError("invalid-request");
    }
    const saved: StoredGitHubExportExecution = {
      ...record,
      recordVersion: record.recordVersion + 1,
    };
    this.executions.set(key, saved);
    if (saved.state !== "running") this.#executionAttempts.delete(key);
    return Promise.resolve({ outcome: "saved", record: saved });
  }

  saveInstallation(record: GitHubInstallationRecord): Promise<void> {
    this.installations.set(
      `${record.organizationId}:${record.integrationId}`,
      record,
    );
    return Promise.resolve();
  }

  savePreview(record: StoredGitHubExportPreview): Promise<void> {
    this.previews.set(
      `${record.preview.organizationId}:${record.preview.projectId}:${record.preview.previewId}`,
      record,
    );
    return Promise.resolve();
  }

  saveRepositories(input: {
    readonly integrationId: string;
    readonly installationId: number;
    readonly organizationId: string;
    readonly repositories: readonly GitHubRepositoryRecord[];
  }): Promise<void> {
    for (const repository of input.repositories) {
      this.repositories.set(
        `${input.organizationId}:${input.integrationId}:${String(repository.repositoryId)}`,
        repository,
      );
    }
    return Promise.resolve();
  }

  updateInstallationStatus(input: {
    readonly installationId: number;
    readonly status: GitHubInstallationRecord["status"];
    readonly updatedAt: string;
  }): Promise<void> {
    for (const [key, record] of this.installations) {
      if (record.installationId === input.installationId) {
        this.installations.set(key, {
          ...record,
          status: input.status,
          updatedAt: input.updatedAt,
        });
      }
    }
    return Promise.resolve();
  }

  updateRepositoryLifecycle(input: {
    readonly installationId: number;
    readonly repositoryId: number;
    readonly state: "deleted" | "transferred";
    readonly updatedAt: string;
  }): Promise<void> {
    for (const [key, record] of this.repositories) {
      if (
        record.installationId === input.installationId &&
        record.repositoryId === input.repositoryId
      ) {
        this.repositories.set(key, {
          ...record,
          disabled: true,
          updatedAt: input.updatedAt,
        });
      }
    }
    return Promise.resolve();
  }

  updateWebhookDelivery(record: GitHubWebhookDeliveryRecord): Promise<void> {
    this.webhooks.set(record.deliveryId, record);
    return Promise.resolve();
  }
}

export class InMemoryApprovedSolutionPackageRepository implements ApprovedSolutionPackageRepository {
  readonly records = new Map<string, ApprovedSolutionPackageRecord>();

  add(input: {
    readonly artifact: SolutionExportArtifactV1;
    readonly artifactId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): void {
    this.records.set(
      `${input.organizationId}:${input.projectId}:${input.artifactId}`,
      input,
    );
  }

  getApprovedPackage(input: {
    readonly artifactId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<ApprovedSolutionPackageRecord | null> {
    return Promise.resolve(
      this.records.get(
        `${input.organizationId}:${input.projectId}:${input.artifactId}`,
      ) ?? null,
    );
  }
}

export class RecordingGitHubExportAuditSink implements GitHubExportAuditSink {
  #failureAction: string | undefined;
  readonly events: GitHubExportAuditEvent[] = [];

  failNext(action: string): void {
    this.#failureAction = action;
  }

  record(event: GitHubExportAuditEvent): Promise<void> {
    if (this.#failureAction === event.action) {
      this.#failureAction = undefined;
      return Promise.reject(
        new GitHubExportError("service-unavailable", { transient: true }),
      );
    }
    this.events.push(event);
    return Promise.resolve();
  }
}

export class RecordingGitHubExportProgressSink implements GitHubExportProgressSink {
  readonly events: GitHubExportProgressEvent[] = [];
  record(event: GitHubExportProgressEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export function receiptDigest(receipt: GitHubExportReceipt): Sha256Digest {
  return canonicalDigest(receipt);
}

export * from "./conformance-actions-fakes.js";
export * from "./repository-import-fakes.js";
