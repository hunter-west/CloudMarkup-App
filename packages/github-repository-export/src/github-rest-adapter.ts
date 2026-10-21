import { createHash, createPrivateKey, createSign } from "node:crypto";

import { z } from "zod";

import {
  GITHUB_REPOSITORY_EXPORT_LIMITS,
  gitHubAppRepositoryPermissionsSchema,
  gitHubBranchNameSchema,
  gitHubShaSchema,
  type GitHubAppRepositoryPermissions,
  type GitSha,
} from "./contracts.js";
import { GitHubExportError } from "./errors.js";
import type {
  GitHubAppAdapter,
  GitHubAppConfiguration,
  GitHubFileMutation,
  GitHubInstallationDescriptor,
  GitHubInstallationSession,
  GitHubPinnedRepositorySnapshot,
  GitHubPinnedRepositoryDiscovery,
  GitHubRepositoryDescriptor,
  GitHubRepositorySnapshot,
  SecretConfigurationResolver,
} from "./ports.js";
import {
  assertGitHubRepositoryTreePathSafety,
  sha256Digest,
} from "./security.js";
import {
  assertGitHubRepositoryImportScope,
  classifyGitHubRepositoryImportPath,
  GITHUB_REPOSITORY_IMPORT_LIMITS,
  gitHubRepositoryImportPathSchema,
} from "./repository-import-security.js";

export type GitHubFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

const installationSchema = z
  .object({
    account: z
      .object({
        id: z.number().int().positive(),
        login: z.string().min(1).max(100),
        type: z.enum(["Organization", "User"]),
      })
      .loose(),
    id: z.number().int().positive(),
    permissions: z.record(z.string(), z.string()),
    repository_selection: z.enum(["all", "selected"]),
    suspended_at: z.string().nullable().optional(),
  })
  .loose();

const repositorySchema = z
  .object({
    archived: z.boolean(),
    default_branch: gitHubBranchNameSchema,
    disabled: z.boolean(),
    id: z.number().int().positive(),
    name: z.string().min(1).max(100),
    node_id: z.string().min(1).max(255),
    owner: z
      .object({
        id: z.number().int().positive(),
        login: z.string().min(1).max(100),
      })
      .loose(),
    private: z.boolean(),
    pushed_at: z.string().nullable(),
  })
  .loose();

const branchSchema = z
  .object({
    commit: z.object({ sha: gitHubShaSchema }).loose(),
    name: gitHubBranchNameSchema,
    protected: z.boolean(),
  })
  .loose();

const refSchema = z
  .object({ object: z.object({ sha: gitHubShaSchema }).loose() })
  .loose();
const commitSchema = z
  .object({
    parents: z
      .array(z.object({ sha: gitHubShaSchema }).loose())
      .max(8)
      .optional(),
    sha: gitHubShaSchema,
    tree: z.object({ sha: gitHubShaSchema }).loose(),
  })
  .loose();
const treeSchema = z
  .object({
    sha: gitHubShaSchema,
    tree: z
      .array(
        z
          .object({
            mode: z.string(),
            path: z.string().min(1).max(512),
            sha: gitHubShaSchema.nullable(),
            size: z.number().int().nonnegative().optional(),
            type: z.enum(["blob", "commit", "tree"]),
          })
          .loose(),
      )
      .max(100_000),
    truncated: z.boolean(),
  })
  .loose();
const blobSchema = z
  .object({
    content: z.string(),
    encoding: z.literal("base64"),
    sha: gitHubShaSchema,
    size: z.number().int().nonnegative(),
  })
  .loose();
const tokenSchema = z
  .object({
    expires_at: z.iso.datetime(),
    token: z.string().min(20).max(1_024),
  })
  .loose();
const pullRequestSchema = z
  .object({
    html_url: z.url().startsWith("https://"),
    number: z.number().int().positive(),
  })
  .loose();
const comparisonSchema = z
  .object({
    merge_base_commit: z.object({ sha: gitHubShaSchema }).loose(),
  })
  .loose();

const GITHUB_API_REQUEST_TIMEOUT_MS = 10_000;

function base64Url(value: Uint8Array | string): string {
  return Buffer.from(value).toString("base64url");
}

function permissionsFromGitHub(value: Record<string, string>) {
  const level = (name: string) => {
    const candidate = value[name] ?? "none";
    return candidate === "read" || candidate === "write" ? candidate : "none";
  };
  return gitHubAppRepositoryPermissionsSchema.parse({
    contents: level("contents"),
    metadata: level("metadata") === "none" ? "read" : level("metadata"),
    pullRequests: level("pull_requests"),
    workflows: level("workflows"),
  });
}

function permissionsForGitHub(
  value: GitHubAppRepositoryPermissions,
): Record<string, string> {
  const permissions: Record<string, string> = {};
  for (const [name, level] of Object.entries({
    contents: value.contents,
    metadata: value.metadata,
    pull_requests: value.pullRequests,
    workflows: value.workflows,
  })) {
    if (level !== "none") permissions[name] = level;
  }
  return permissions;
}

function repositoryDescriptor(
  installationId: number,
  value: z.output<typeof repositorySchema>,
): GitHubRepositoryDescriptor {
  return {
    archived: value.archived,
    defaultBranch: value.default_branch,
    disabled: value.disabled,
    installationId,
    name: value.name,
    nodeId: value.node_id,
    owner: value.owner.login,
    ownerId: value.owner.id,
    private: value.private,
    pushedAt: value.pushed_at,
    repositoryId: value.id,
  };
}

function refPath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function repoPath(repository: GitHubRepositoryDescriptor): string {
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
}

function gitBlobSha(bytes: Uint8Array, expectedSha: GitSha): string {
  const algorithm = expectedSha.length === 40 ? "sha1" : "sha256";
  return createHash(algorithm)
    .update(`blob ${String(bytes.byteLength)}\0`)
    .update(bytes)
    .digest("hex");
}

class DisposableToken {
  readonly #bytes: Uint8Array;
  constructor(token: string) {
    this.#bytes = new TextEncoder().encode(token);
  }
  authorizationHeader(): string {
    return `Bearer ${new TextDecoder().decode(this.#bytes)}`;
  }
  dispose(): void {
    this.#bytes.fill(0);
  }
}

export class GitHubRestAppAdapter implements GitHubAppAdapter {
  readonly #apiBaseUrl: URL;
  readonly #clock: () => Date;
  readonly #configuration: Omit<
    GitHubAppConfiguration,
    "webhookSecretReference"
  >;
  readonly #fetch: GitHubFetch;
  readonly #secrets: SecretConfigurationResolver;
  readonly #authorizeBeforeRequest: (() => Promise<void>) | undefined;

  constructor(options: {
    /** Production request scopes recheck current authority after secret/signing I/O. */
    readonly authorizeBeforeRequest?: () => Promise<void>;
    readonly clock?: () => Date;
    // Existing full App configurations remain source-compatible; REST-only
    // connections neither require nor resolve a webhook signing secret.
    readonly configuration:
      | GitHubAppConfiguration
      | Omit<GitHubAppConfiguration, "webhookSecretReference">;
    readonly fetch?: GitHubFetch;
    readonly secrets: SecretConfigurationResolver;
  }) {
    this.#clock = options.clock ?? (() => new Date());
    this.#configuration = options.configuration;
    this.#fetch = options.fetch ?? fetch;
    this.#secrets = options.secrets;
    this.#authorizeBeforeRequest = options.authorizeBeforeRequest;
    if (!/^\d{1,20}$/.test(this.#configuration.appId)) {
      throw new GitHubExportError("invalid-request");
    }
    let base: URL;
    try {
      base = new URL(this.#configuration.apiBaseUrl);
    } catch {
      throw new GitHubExportError("invalid-request");
    }
    if (
      base.protocol !== "https:" ||
      base.username !== "" ||
      base.password !== "" ||
      base.search !== "" ||
      base.hash !== "" ||
      base.pathname !== "/"
    ) {
      throw new GitHubExportError("invalid-request");
    }
    this.#apiBaseUrl = base;
  }

  async inspectInstallation(
    installationId: number,
  ): Promise<GitHubInstallationDescriptor> {
    const jwt = await this.#createAppJwt();
    try {
      const response = await this.#request(
        `/app/installations/${String(installationId)}`,
        { method: "GET" },
        `Bearer ${jwt}`,
      );
      const value = installationSchema.parse(await response.json());
      return {
        accountId: value.account.id,
        accountLogin: value.account.login,
        accountType: value.account.type,
        installationId: value.id,
        permissions: permissionsFromGitHub(value.permissions),
        repositorySelection: value.repository_selection,
        suspended: value.suspended_at != null,
      };
    } finally {
      // The JWT is short lived, request scoped, and never returned or persisted.
    }
  }

  async withInstallationSession<T>(
    input: {
      readonly installationId: number;
      readonly permissions: GitHubAppRepositoryPermissions;
      readonly repositoryIds?: readonly number[];
    },
    operation: (session: GitHubInstallationSession) => Promise<T>,
  ): Promise<T> {
    const jwt = await this.#createAppJwt();
    const response = await this.#request(
      `/app/installations/${String(input.installationId)}/access_tokens`,
      {
        body: JSON.stringify({
          permissions: permissionsForGitHub(input.permissions),
          ...(input.repositoryIds === undefined
            ? {}
            : { repository_ids: input.repositoryIds }),
        }),
        method: "POST",
      },
      `Bearer ${jwt}`,
    );
    const tokenResponse = tokenSchema.parse(await response.json());
    const expiresAt = Date.parse(tokenResponse.expires_at);
    if (
      expiresAt <= this.#clock().getTime() ||
      expiresAt > this.#clock().getTime() + 61 * 60 * 1_000
    ) {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    const token = new DisposableToken(tokenResponse.token);
    try {
      return await operation(this.#session(input.installationId, token));
    } finally {
      token.dispose();
    }
  }

  async withRepositoryReadSession<T>(
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
      throw new GitHubExportError("invalid-request");
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

  async #createAppJwt(): Promise<string> {
    const secret = await this.#secrets.resolveSecret(
      this.#configuration.privateKeySecretReference,
    );
    try {
      const now = Math.floor(this.#clock().getTime() / 1_000);
      const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
      const payload = base64Url(
        JSON.stringify({
          exp: now + 540,
          iat: now - 60,
          iss: this.#configuration.appId,
        }),
      );
      const signingInput = `${header}.${payload}`;
      const privateKey = createPrivateKey({
        format: "pem",
        key: Buffer.from(secret),
      });
      const signer = createSign("RSA-SHA256");
      signer.update(signingInput);
      signer.end();
      return `${signingInput}.${base64Url(signer.sign(privateKey))}`;
    } catch {
      throw new GitHubExportError("secret-unavailable");
    } finally {
      secret.fill(0);
    }
  }

  #session(
    installationId: number,
    token: DisposableToken,
  ): GitHubInstallationSession {
    const request = (path: string, init: RequestInit = {}) =>
      this.#request(path, init, token.authorizationHeader());
    return {
      createBranch: async ({ baseCommitSha, branch, repository }) => {
        await request(`${repoPath(repository)}/git/refs`, {
          body: JSON.stringify({
            ref: `refs/heads/${branch}`,
            sha: baseCommitSha,
          }),
          method: "POST",
        });
      },
      createCommit: async ({
        branch,
        expectedHeadSha,
        message,
        mutations,
        repository,
      }) =>
        this.#createCommit(
          request,
          repository,
          branch,
          expectedHeadSha,
          message,
          mutations,
        ),
      createPullRequest: async ({
        baseBranch,
        body,
        featureBranch,
        repository,
        title,
      }) => {
        const response = await request(`${repoPath(repository)}/pulls`, {
          body: JSON.stringify({
            base: baseBranch,
            body,
            head: featureBranch,
            maintainer_can_modify: false,
            title,
          }),
          method: "POST",
        });
        const pullRequest = pullRequestSchema.parse(await response.json());
        return { number: pullRequest.number, url: pullRequest.html_url };
      },
      findBranch: async ({ branch, repository }) => {
        const response = await this.#requestAllowNotFound(
          `${repoPath(repository)}/git/ref/heads/${refPath(branch)}`,
          token.authorizationHeader(),
        );
        if (response === null) return null;
        return { sha: refSchema.parse(await response.json()).object.sha };
      },
      findPullRequest: async ({ baseBranch, featureBranch, repository }) => {
        const query = new URLSearchParams({
          base: baseBranch,
          head: `${repository.owner}:${featureBranch}`,
          per_page: "2",
          state: "open",
        });
        const response = await request(
          `${repoPath(repository)}/pulls?${query.toString()}`,
        );
        const values = z
          .array(pullRequestSchema)
          .max(2)
          .parse(await response.json());
        const match = values[0];
        return match === undefined
          ? null
          : { number: match.number, url: match.html_url };
      },
      findMergeBase: async ({ baseCommitSha, headCommitSha, repository }) => {
        const response = await request(
          `${repoPath(repository)}/compare/${baseCommitSha}...${headCommitSha}`,
        );
        return comparisonSchema.parse(await response.json()).merge_base_commit
          .sha;
      },
      listBranches: async (repository) => {
        const values = await this.#paginate(
          `${repoPath(repository)}/branches`,
          token.authorizationHeader(),
          branchSchema,
        );
        return values.map((branch) => ({
          name: branch.name,
          protected: branch.protected,
          sha: branch.commit.sha,
        }));
      },
      listRepositories: async () => {
        const values: z.output<typeof repositorySchema>[] = [];
        for (let page = 1; page <= 100; page += 1) {
          const response = await request(
            `/installation/repositories?per_page=100&page=${String(page)}`,
          );
          const payload = z
            .object({ repositories: z.array(repositorySchema).max(100) })
            .loose()
            .parse(await response.json());
          values.push(...payload.repositories);
          if (payload.repositories.length < 100) break;
          if (page === 100) throw new GitHubExportError("service-unavailable");
        }
        return values.map((value) =>
          repositoryDescriptor(installationId, value),
        );
      },
      readSnapshot: async ({
        candidatePaths,
        baseBranch,
        destinationFolder,
        repository,
        workflowPaths,
      }) =>
        this.#readSnapshot(
          request,
          repository,
          baseBranch,
          destinationFolder,
          candidatePaths,
          workflowPaths,
        ),
      discoverPinnedFiles: async ({ repository, ...input }) => {
        const snapshot = await this.#readPinnedTree(request, repository, input);
        let totalBytes = 0;
        const files = snapshot.selected.map((entry) => {
          if (entry.sha === null || entry.size === undefined) {
            throw new GitHubExportError("import-blocked");
          }
          totalBytes += entry.size;
          if (totalBytes > GITHUB_REPOSITORY_IMPORT_LIMITS.totalBytes) {
            throw new GitHubExportError("import-blocked");
          }
          return {
            gitBlobSha: entry.sha,
            path: entry.path,
            sizeBytes: entry.size,
          };
        });
        return {
          branch: snapshot.branch,
          branchHeadSha: snapshot.branchHeadSha,
          commitSha: snapshot.commitSha,
          files,
          repositoryId: repository.repositoryId,
          treeSha: snapshot.treeSha,
        } satisfies GitHubPinnedRepositoryDiscovery;
      },
      readPinnedSnapshot: async ({
        branch,
        commitSha,
        ignoredPaths,
        repository,
        selectedPaths,
      }) =>
        this.#readPinnedSnapshot(request, repository, {
          branch,
          commitSha,
          ignoredPaths,
          selectedPaths,
        }),
    };
  }

  async #readPinnedTree(
    request: (path: string, init?: RequestInit) => Promise<Response>,
    repository: GitHubRepositoryDescriptor,
    input: {
      readonly branch: string;
      readonly commitSha: GitSha;
      readonly ignoredPaths: readonly string[];
      readonly selectedPaths: readonly string[];
    },
  ) {
    assertGitHubRepositoryImportScope(input);
    const branch = gitHubBranchNameSchema.parse(input.branch);
    const commitSha = gitHubShaSchema.parse(input.commitSha);
    const ref = refSchema.parse(
      await (
        await request(
          `${repoPath(repository)}/git/ref/heads/${refPath(branch)}`,
        )
      ).json(),
    );
    const commit = commitSchema.parse(
      await (
        await request(`${repoPath(repository)}/git/commits/${commitSha}`)
      ).json(),
    );
    if (commit.sha !== commitSha) {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    const tree = treeSchema.parse(
      await (
        await request(
          `${repoPath(repository)}/git/trees/${commit.tree.sha}?recursive=1`,
        )
      ).json(),
    );
    if (
      tree.sha !== commit.tree.sha ||
      tree.truncated ||
      tree.tree.length > GITHUB_REPOSITORY_IMPORT_LIMITS.treeEntries
    ) {
      throw new GitHubExportError("import-blocked");
    }

    const portablePaths = new Map<string, string>();
    const selected = [];
    const ignoredFiles = [];
    for (const entry of tree.tree) {
      const parsedPath = gitHubRepositoryImportPathSchema.safeParse(entry.path);
      if (!parsedPath.success || entry.path === ".")
        throw new GitHubExportError("import-blocked");
      const portable = entry.path.normalize("NFC").toLowerCase();
      const existing = portablePaths.get(portable);
      if (existing !== undefined) {
        throw new GitHubExportError("import-blocked");
      }
      portablePaths.set(portable, entry.path);
      const classification = classifyGitHubRepositoryImportPath({
        ignoredPaths: input.ignoredPaths,
        path: entry.path,
        selectedPaths: input.selectedPaths,
      });
      if (classification === "outside-scope") continue;
      if (entry.type === "tree") {
        if (entry.mode !== "040000" || entry.sha === null)
          throw new GitHubExportError("import-blocked");
        continue;
      }
      if (
        entry.mode === "120000" ||
        entry.mode === "160000" ||
        entry.type === "commit"
      ) {
        throw new GitHubExportError("import-blocked");
      }
      if (classification !== "selected") {
        ignoredFiles.push({ path: entry.path, reason: classification });
        continue;
      }
      if (
        entry.sha === null ||
        (entry.mode !== "100644" && entry.mode !== "100755")
      ) {
        throw new GitHubExportError("import-blocked");
      }
      if ((entry.size ?? 0) > GITHUB_REPOSITORY_IMPORT_LIMITS.fileBytes) {
        throw new GitHubExportError("import-blocked");
      }
      selected.push(entry);
    }
    if (selected.length > GITHUB_REPOSITORY_IMPORT_LIMITS.files) {
      throw new GitHubExportError("import-blocked");
    }

    return {
      branch,
      branchHeadSha: ref.object.sha,
      commitSha,
      ignoredFiles: ignoredFiles.sort((left, right) =>
        left.path.localeCompare(right.path, "en"),
      ),
      selected: selected.sort((left, right) =>
        left.path.localeCompare(right.path, "en"),
      ),
      treeSha: tree.sha,
    };
  }

  async #readPinnedSnapshot(
    request: (path: string, init?: RequestInit) => Promise<Response>,
    repository: GitHubRepositoryDescriptor,
    input: {
      readonly branch: string;
      readonly commitSha: GitSha;
      readonly ignoredPaths: readonly string[];
      readonly selectedPaths: readonly string[];
    },
  ): Promise<GitHubPinnedRepositorySnapshot> {
    const snapshot = await this.#readPinnedTree(request, repository, input);
    let totalBytes = 0;
    const files = [];
    for (const entry of snapshot.selected) {
      if (entry.sha === null)
        throw new GitHubExportError("service-unavailable");
      const blob = blobSchema.parse(
        await (
          await request(`${repoPath(repository)}/git/blobs/${entry.sha}`)
        ).json(),
      );
      if (
        blob.sha !== entry.sha ||
        blob.size > GITHUB_REPOSITORY_IMPORT_LIMITS.fileBytes ||
        (entry.size !== undefined && entry.size !== blob.size)
      ) {
        throw new GitHubExportError("service-unavailable", { transient: true });
      }
      const encoded = blob.content.replaceAll("\n", "");
      if (
        Buffer.byteLength(encoded, "ascii") >
        Math.ceil((GITHUB_REPOSITORY_IMPORT_LIMITS.fileBytes * 4) / 3) + 4
      ) {
        throw new GitHubExportError("import-blocked");
      }
      const decoded = Buffer.from(encoded, "base64");
      if (decoded.toString("base64") !== encoded) {
        throw new GitHubExportError("service-unavailable", { transient: true });
      }
      const bytes = new Uint8Array(decoded);
      if (
        bytes.byteLength !== blob.size ||
        gitBlobSha(bytes, blob.sha) !== blob.sha
      ) {
        throw new GitHubExportError("service-unavailable");
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > GITHUB_REPOSITORY_IMPORT_LIMITS.totalBytes) {
        throw new GitHubExportError("import-blocked");
      }
      files.push({
        bytes,
        digest: sha256Digest(bytes),
        gitBlobSha: blob.sha,
        path: entry.path,
      });
    }

    return {
      baseBranch: snapshot.branch,
      branch: snapshot.branch,
      branchHeadSha: snapshot.branchHeadSha,
      commitSha: snapshot.commitSha,
      defaultBranch: repository.defaultBranch,
      files,
      ignoredFiles: snapshot.ignoredFiles,
      repositoryId: repository.repositoryId,
      repositoryName: repository.name,
      repositoryOwner: repository.owner,
      repositoryOwnerId: repository.ownerId,
      treeSha: snapshot.treeSha,
    };
  }

  async #readSnapshot(
    request: (path: string, init?: RequestInit) => Promise<Response>,
    repository: GitHubRepositoryDescriptor,
    baseBranch: string,
    destinationFolder: string,
    candidatePaths: readonly string[],
    workflowPaths: readonly string[],
  ): Promise<GitHubRepositorySnapshot> {
    const ref = refSchema.parse(
      await (
        await request(
          `${repoPath(repository)}/git/ref/heads/${refPath(baseBranch)}`,
        )
      ).json(),
    );
    const commit = commitSchema.parse(
      await (
        await request(`${repoPath(repository)}/git/commits/${ref.object.sha}`)
      ).json(),
    );
    if (commit.sha !== ref.object.sha) {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    const tree = treeSchema.parse(
      await (
        await request(
          `${repoPath(repository)}/git/trees/${commit.tree.sha}?recursive=1`,
        )
      ).json(),
    );
    if (tree.sha !== commit.tree.sha) {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    if (
      tree.truncated ||
      tree.tree.length > GITHUB_REPOSITORY_EXPORT_LIMITS.repositoryTreeEntries
    ) {
      throw new GitHubExportError("preview-blocked");
    }
    assertGitHubRepositoryTreePathSafety({
      candidatePaths,
      destinationFolder,
      entries: tree.tree,
      workflowPaths,
    });
    const prefix = destinationFolder === "" ? "" : `${destinationFolder}/`;
    const scoped = tree.tree.filter(
      (entry) =>
        (prefix === "" ? true : entry.path.startsWith(prefix)) ||
        workflowPaths.includes(entry.path),
    );
    if (scoped.some(({ mode }) => mode === "120000" || mode === "160000")) {
      throw new GitHubExportError("preview-blocked");
    }
    const affected = scoped.filter(({ type }) => type === "blob");
    let totalBytes = 0;
    const files = [];
    for (const entry of affected) {
      if (entry.sha === null)
        throw new GitHubExportError("service-unavailable");
      if ((entry.size ?? 0) > GITHUB_REPOSITORY_EXPORT_LIMITS.fileBytes) {
        throw new GitHubExportError("preview-blocked");
      }
      const blob = blobSchema.parse(
        await (
          await request(`${repoPath(repository)}/git/blobs/${entry.sha}`)
        ).json(),
      );
      if (
        blob.sha !== entry.sha ||
        blob.size > GITHUB_REPOSITORY_EXPORT_LIMITS.fileBytes ||
        (entry.size !== undefined && entry.size !== blob.size)
      ) {
        throw new GitHubExportError("service-unavailable", { transient: true });
      }
      const encoded = blob.content.replaceAll("\n", "");
      if (
        Buffer.byteLength(encoded, "ascii") >
        Math.ceil((GITHUB_REPOSITORY_EXPORT_LIMITS.fileBytes * 4) / 3) + 4
      ) {
        throw new GitHubExportError("preview-blocked");
      }
      const decoded = Buffer.from(encoded, "base64");
      if (decoded.toString("base64") !== encoded) {
        throw new GitHubExportError("service-unavailable", { transient: true });
      }
      const bytes = new Uint8Array(decoded);
      if (
        bytes.byteLength !== blob.size ||
        gitBlobSha(bytes, blob.sha) !== blob.sha
      ) {
        throw new GitHubExportError("service-unavailable");
      }
      totalBytes += bytes.byteLength;
      if (
        totalBytes > GITHUB_REPOSITORY_EXPORT_LIMITS.repositorySnapshotBytes
      ) {
        throw new GitHubExportError("preview-blocked");
      }
      files.push({
        bytes,
        digest: sha256Digest(bytes),
        gitBlobSha: blob.sha,
        path: entry.path,
      });
    }
    return {
      baseBranch,
      baseCommitSha: ref.object.sha,
      defaultBranch: repository.defaultBranch,
      files,
      repositoryId: repository.repositoryId,
      repositoryName: repository.name,
      repositoryOwner: repository.owner,
      repositoryOwnerId: repository.ownerId,
      treeSha: tree.sha,
    };
  }

  async #createCommit(
    request: (path: string, init?: RequestInit) => Promise<Response>,
    repository: GitHubRepositoryDescriptor,
    branch: string,
    expectedHeadSha: GitSha,
    message: string,
    mutations: readonly GitHubFileMutation[],
  ): Promise<GitSha> {
    const parent = commitSchema.parse(
      await (
        await request(`${repoPath(repository)}/git/commits/${expectedHeadSha}`)
      ).json(),
    );
    if (parent.sha !== expectedHeadSha) {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    const entries = [];
    for (const mutation of mutations) {
      if (mutation.type === "delete") {
        entries.push({
          mode: "100644",
          path: mutation.path,
          sha: null,
          type: "blob",
        });
        continue;
      }
      if (mutation.bytes === undefined)
        throw new GitHubExportError("artifact-invalid");
      const response = await request(`${repoPath(repository)}/git/blobs`, {
        body: JSON.stringify({
          content: Buffer.from(mutation.bytes).toString("base64"),
          encoding: "base64",
        }),
        method: "POST",
      });
      const blob = z
        .object({ sha: gitHubShaSchema })
        .loose()
        .parse(await response.json());
      if (gitBlobSha(mutation.bytes, blob.sha) !== blob.sha) {
        throw new GitHubExportError("service-unavailable", { transient: true });
      }
      entries.push({
        mode: "100644",
        path: mutation.path,
        sha: blob.sha,
        type: "blob",
      });
    }
    const treeResponse = await request(`${repoPath(repository)}/git/trees`, {
      body: JSON.stringify({ base_tree: parent.tree.sha, tree: entries }),
      method: "POST",
    });
    const tree = z
      .object({ sha: gitHubShaSchema })
      .loose()
      .parse(await treeResponse.json());
    const currentRef = refSchema.parse(
      await (
        await request(
          `${repoPath(repository)}/git/ref/heads/${refPath(branch)}`,
        )
      ).json(),
    );
    if (currentRef.object.sha !== expectedHeadSha) {
      const currentCommit = commitSchema.parse(
        await (
          await request(
            `${repoPath(repository)}/git/commits/${currentRef.object.sha}`,
          )
        ).json(),
      );
      if (
        currentCommit.sha !== currentRef.object.sha ||
        currentCommit.tree.sha !== tree.sha ||
        currentCommit.parents?.length !== 1 ||
        currentCommit.parents[0]?.sha !== expectedHeadSha
      ) {
        throw new GitHubExportError("repository-changed");
      }
      return currentRef.object.sha;
    }
    const commitResponse = await request(
      `${repoPath(repository)}/git/commits`,
      {
        body: JSON.stringify({
          message,
          parents: [expectedHeadSha],
          tree: tree.sha,
        }),
        method: "POST",
      },
    );
    const commit = z
      .object({ sha: gitHubShaSchema })
      .loose()
      .parse(await commitResponse.json());
    await request(`${repoPath(repository)}/git/refs/heads/${refPath(branch)}`, {
      body: JSON.stringify({ force: false, sha: commit.sha }),
      method: "PATCH",
    });
    return commit.sha;
  }

  async #paginate<T>(
    path: string,
    authorization: string,
    schema: z.ZodType<T>,
  ): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const response = await this.#request(
        `${path}${separator}per_page=100&page=${String(page)}`,
        { method: "GET" },
        authorization,
      );
      const batch = z
        .array(schema)
        .max(100)
        .parse(await response.json());
      values.push(...batch);
      if (batch.length < 100) return values;
    }
    throw new GitHubExportError("service-unavailable");
  }

  async #requestAllowNotFound(
    path: string,
    authorization: string,
  ): Promise<Response | null> {
    const response = await this.#fetchResponse(path, {
      headers: this.#headers(authorization),
      method: "GET",
    });
    if (response.status === 404) return null;
    this.#assertResponse(response);
    return response;
  }

  async #request(
    path: string,
    init: RequestInit,
    authorization: string,
  ): Promise<Response> {
    const response = await this.#fetchResponse(path, {
      ...init,
      headers: {
        ...this.#headers(authorization),
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
    });
    this.#assertResponse(response);
    return response;
  }

  async #fetchResponse(path: string, init: RequestInit): Promise<Response> {
    const url = new URL(path, this.#apiBaseUrl);
    if (url.origin !== this.#apiBaseUrl.origin) {
      throw new GitHubExportError("invalid-request");
    }
    let response: Response;
    await this.#authorizeBeforeRequest?.();
    try {
      response = await this.#fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(GITHUB_API_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    if (response.redirected) {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    if (response.url !== "") {
      let responseUrl: URL;
      try {
        responseUrl = new URL(response.url);
      } catch {
        throw new GitHubExportError("service-unavailable", {
          transient: true,
        });
      }
      if (
        responseUrl.origin !== this.#apiBaseUrl.origin ||
        responseUrl.href !== url.href
      ) {
        throw new GitHubExportError("service-unavailable", {
          transient: true,
        });
      }
    }
    return response;
  }

  #headers(authorization: string): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      authorization,
      "user-agent": this.#configuration.userAgent,
      "x-github-api-version": this.#configuration.apiVersion,
    };
  }

  #assertResponse(response: Response): void {
    if (response.ok) return;
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (
      response.status === 429 ||
      (response.status === 403 && remaining === "0")
    ) {
      const retryAfter = Number.parseInt(
        response.headers.get("retry-after") ?? "60",
        10,
      );
      throw new GitHubExportError("rate-limited", {
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 60,
        transient: true,
      });
    }
    if (response.status === 401)
      throw new GitHubExportError("installation-revoked");
    if (response.status === 403)
      throw new GitHubExportError("github-permission-denied");
    if (response.status === 404)
      throw new GitHubExportError("repository-not-found");
    if (response.status === 409 || response.status === 422) {
      throw new GitHubExportError("branch-conflict");
    }
    if (response.status >= 500) {
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
    throw new GitHubExportError("service-unavailable");
  }
}
