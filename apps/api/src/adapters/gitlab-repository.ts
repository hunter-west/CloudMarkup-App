import { createHash } from "node:crypto";
import { z } from "zod";
import {
  GitLabProviderError,
  gitLabSecretText,
  withGitLabOperation,
  type GitLabOperation,
  type GitLabTransportOptions,
} from "./gitlab-http.js";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const branch = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.startsWith("refs/") &&
      !value.endsWith(".") &&
      !value.includes("..") &&
      !value.includes("@{") &&
      !Array.from(value).some(
        (character) =>
          character.charCodeAt(0) <= 32 ||
          character.charCodeAt(0) === 127 ||
          "~^:?*[\\".includes(character),
      ) &&
      value
        .split("/")
        .every(
          (segment) =>
            segment !== "" &&
            !segment.startsWith(".") &&
            !segment.endsWith(".lock"),
        ),
  );
const exportBranch = z.string().regex(/^cloudmarkup\/export-[a-f0-9]{32}$/u);
const path = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9._ /-]+$/u)
  .refine((value) =>
    value
      .split("/")
      .every(
        (part) =>
          part.length > 0 &&
          part === part.trim() &&
          part !== "." &&
          part !== ".." &&
          part.toLowerCase() !== ".git" &&
          !part.endsWith(".") &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      ),
  );
const access = z
  .object({ access_level: z.number().int().nonnegative() })
  .nullable();
const project = z.object({
  id,
  path_with_namespace: z.string().min(3).max(1024),
  default_branch: branch.nullable(),
  archived: z.boolean(),
  empty_repo: z.boolean(),
  permissions: z.object({ project_access: access, group_access: access }),
});
const branchResponse = z.object({
  name: branch,
  protected: z.boolean(),
  commit: z.object({ id: sha }),
});
const commit = z.object({
  id: sha,
  parent_ids: z.array(sha).max(8),
  message: z.string().max(65536),
});
const treeEntry = z.object({
  id: sha,
  path: z.string().min(1).max(4096),
  type: z.enum(["blob", "tree", "commit"]),
  mode: z.enum(["100644", "100755", "120000", "040000", "160000"]),
});
const file = z.object({
  file_path: z.string(),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(1024 * 1024),
  encoding: z.literal("base64"),
  content: z.string().max(1398104),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  blob_id: sha,
  commit_id: sha,
  last_commit_id: sha,
  execute_filemode: z.boolean(),
});
const mergeRequest = z.object({
  iid: id,
  source_project_id: id,
  target_project_id: id,
  source_branch: branch,
  target_branch: branch,
  sha,
  state: z.enum(["opened", "closed", "merged", "locked"]),
  draft: z.boolean(),
});

export interface GitLabProject {
  readonly projectId: number;
  readonly pathWithNamespace: string;
  readonly defaultBranch: string | null;
  readonly archived: boolean;
  readonly empty: boolean;
  readonly accessLevel: number;
  readonly url: string;
}
export interface GitLabTreeEntry {
  readonly path: string;
  readonly objectId: string;
  readonly type: "blob" | "tree" | "commit";
  readonly mode: "100644" | "100755" | "120000" | "040000" | "160000";
}
export interface GitLabCommit {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly message: string;
}
export interface GitLabMergeRequest {
  readonly number: number;
  readonly sha: string;
  readonly state: "opened" | "closed" | "merged" | "locked";
  readonly draft: boolean;
  readonly url: string;
}
export type GitLabFileChange =
  | {
      readonly action: "create" | "update";
      readonly path: string;
      readonly bytes: Uint8Array;
      readonly executable: boolean;
    }
  | { readonly action: "delete"; readonly path: string };

function parse<T>(schema: z.ZodType<T>, value: unknown, provider = false): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new GitLabProviderError(
      provider ? "uncertain" : "not-sent",
      provider ? "unavailable" : "invalid-input",
    );
  return result.data;
}
function projectDescriptor(value: z.output<typeof project>): GitLabProject {
  // Display names can change. All API authority uses the immutable numeric ID.
  if (
    !value.path_with_namespace
      .split("/")
      .every(
        (part) =>
          /^[A-Za-z0-9_.-]+$/u.test(part) && part !== "." && part !== "..",
      )
  )
    throw new GitLabProviderError("uncertain", "unavailable");
  return {
    projectId: value.id,
    pathWithNamespace: value.path_with_namespace,
    defaultBranch: value.default_branch,
    archived: value.archived,
    empty: value.empty_repo,
    accessLevel: Math.max(
      value.permissions.group_access?.access_level ?? 0,
      value.permissions.project_access?.access_level ?? 0,
    ),
    url: `https://gitlab.com/${value.path_with_namespace}`,
  };
}
function nextPage(
  value: string | null,
  current: number,
  count: number,
): number | null {
  if (value !== null && value !== "") {
    if (!/^[1-9][0-9]*$/u.test(value) || Number(value) !== current + 1)
      throw new GitLabProviderError("uncertain", "unavailable");
    return current + 1;
  }
  // A full page without pagination headers is not proof of completeness.
  return value === null && count === 100 ? current + 1 : null;
}
function commitDescriptor(value: z.output<typeof commit>): GitLabCommit {
  return { sha: value.id, parents: value.parent_ids, message: value.message };
}

/** OAuth token is server-owned and scoped by current connection admission, never a pasted user token. */
export class GitLabRepositoryAdapter {
  readonly #options: GitLabTransportOptions;
  readonly #readToken: () => Promise<Uint8Array>;
  constructor(
    options: GitLabTransportOptions & {
      readonly readAccessToken: () => Promise<Uint8Array>;
    },
  ) {
    this.#options = Object.freeze({ ...options });
    this.#readToken = options.readAccessToken;
  }
  async #run<T>(
    run: (operation: GitLabOperation, token: Uint8Array) => Promise<T>,
  ): Promise<T> {
    return withGitLabOperation(this.#options, async (operation) => {
      // The connection store returns a fresh decrypted buffer on each operation.
      const token = await this.#readToken();
      try {
        gitLabSecretText(token);
        return await run(operation, token);
      } finally {
        token.fill(0);
      }
    });
  }
  async listProjects(pageNumber = 1): Promise<{
    readonly projects: readonly GitLabProject[];
    readonly nextPage: number | null;
  }> {
    const page = parse(z.number().int().min(1).max(200), pageNumber);
    return this.#run(async (operation, token) => {
      const response = await operation.request({
        method: "GET",
        path: `/api/v4/projects?membership=true&min_access_level=30&archived=false&per_page=100&page=${String(page)}&order_by=id&sort=asc`,
        token,
        successStatus: 200,
        maxBytes: 4 * 1024 * 1024,
      });
      const projects = parse(
        z.array(project).max(100),
        response?.value,
        true,
      ).map(projectDescriptor);
      if (
        new Set(projects.map((item) => item.projectId)).size !== projects.length
      )
        throw new GitLabProviderError("uncertain", "unavailable");
      return {
        projects,
        nextPage: nextPage(response?.nextPage ?? null, page, projects.length),
      };
    });
  }
  readProject(projectId: number): Promise<GitLabProject> {
    const projectIdValue = parse(id, projectId);
    return this.#run((operation, token) =>
      this.#project(operation, token, projectIdValue),
    );
  }
  async #project(
    operation: GitLabOperation,
    token: Uint8Array,
    projectId: number,
  ): Promise<GitLabProject> {
    const result = projectDescriptor(
      parse(
        project,
        (
          await operation.request({
            method: "GET",
            path: `/api/v4/projects/${String(projectId)}`,
            token,
            successStatus: 200,
            maxBytes: 131072,
          })
        )?.value,
        true,
      ),
    );
    if (result.projectId !== projectId)
      throw new GitLabProviderError("uncertain", "access-denied");
    return result;
  }
  readBranch(
    projectId: number,
    branchName: string,
  ): Promise<{ readonly sha: string; readonly protected: boolean } | null> {
    const projectIdValue = parse(id, projectId);
    const name = parse(branch, branchName);
    return this.#run((operation, token) =>
      this.#branch(operation, token, projectIdValue, name),
    );
  }
  async #branch(
    operation: GitLabOperation,
    token: Uint8Array,
    projectId: number,
    name: string,
  ) {
    const response = await operation.request({
      method: "GET",
      path: `/api/v4/projects/${String(projectId)}/repository/branches/${encodeURIComponent(name)}`,
      token,
      successStatus: 200,
      allowMissing: true,
    });
    if (response === null) return null;
    const result = parse(branchResponse, response.value, true);
    if (result.name !== name)
      throw new GitLabProviderError("uncertain", "unavailable");
    return { sha: result.commit.id, protected: result.protected };
  }
  readCommit(projectId: number, commitSha: string): Promise<GitLabCommit> {
    const projectIdValue = parse(id, projectId);
    const revision = parse(sha, commitSha);
    return this.#run((operation, token) =>
      this.#commit(operation, token, projectIdValue, revision),
    );
  }
  async #commit(
    operation: GitLabOperation,
    token: Uint8Array,
    projectId: number,
    revision: string,
  ) {
    const result = parse(
      commit,
      (
        await operation.request({
          method: "GET",
          path: `/api/v4/projects/${String(projectId)}/repository/commits/${revision}`,
          token,
          successStatus: 200,
          maxBytes: 131072,
        })
      )?.value,
      true,
    );
    if (result.id !== revision)
      throw new GitLabProviderError("uncertain", "unavailable");
    return commitDescriptor(result);
  }
  readTree(
    projectId: number,
    commitSha: string,
  ): Promise<readonly GitLabTreeEntry[]> {
    const projectIdValue = parse(id, projectId);
    const revision = parse(sha, commitSha);
    return this.#run(async (operation, token) => {
      const entries: GitLabTreeEntry[] = [];
      const paths = new Set<string>();
      for (let page = 1; page <= 201; page += 1) {
        const response = await operation.request({
          method: "GET",
          path: `/api/v4/projects/${String(projectIdValue)}/repository/tree?ref=${revision}&recursive=true&per_page=100&page=${String(page)}`,
          token,
          successStatus: 200,
          maxBytes: 1024 * 1024,
        });
        const batch = parse(z.array(treeEntry).max(100), response?.value, true);
        for (const entry of batch) {
          if (
            paths.has(entry.path) ||
            entries.length >= 20000 ||
            (entry.type === "tree"
              ? entry.mode !== "040000"
              : entry.type === "commit"
                ? entry.mode !== "160000"
                : !["100644", "100755", "120000"].includes(entry.mode))
          )
            throw new GitLabProviderError("uncertain", "unavailable");
          paths.add(entry.path);
          entries.push({
            path: entry.path,
            objectId: entry.id,
            mode: entry.mode,
            type: entry.type,
          });
        }
        if (nextPage(response?.nextPage ?? null, page, batch.length) === null)
          return entries;
      }
      throw new GitLabProviderError("uncertain", "unavailable");
    });
  }
  readFile(input: {
    readonly projectId: number;
    readonly commitSha: string;
    readonly path: string;
    readonly expectedBlobSha: string;
  }): Promise<{
    readonly bytes: Uint8Array;
    readonly executable: boolean;
    readonly lastCommitSha: string;
  }> {
    const request = parse(
      z
        .object({ projectId: id, commitSha: sha, path, expectedBlobSha: sha })
        .strict(),
      input,
    );
    return this.#run(async (operation, token) => {
      const value = parse(
        file,
        (
          await operation.request({
            method: "GET",
            path: `/api/v4/projects/${String(request.projectId)}/repository/files/${encodeURIComponent(request.path)}?ref=${request.commitSha}`,
            token,
            successStatus: 200,
            maxBytes: 2 * 1024 * 1024,
          })
        )?.value,
        true,
      );
      const bytes = Buffer.from(value.content, "base64");
      const hash = createHash("sha256").update(bytes).digest("hex");
      const blob = createHash("sha1")
        .update(`blob ${String(bytes.byteLength)}\0`)
        .update(bytes)
        .digest("hex");
      if (
        value.file_path !== request.path ||
        value.commit_id !== request.commitSha ||
        value.blob_id !== request.expectedBlobSha ||
        value.size !== bytes.byteLength ||
        bytes.toString("base64") !== value.content ||
        hash !== value.content_sha256 ||
        blob !== value.blob_id
      )
        throw new GitLabProviderError("uncertain", "unavailable");
      return {
        bytes,
        executable: value.execute_filemode,
        lastCommitSha: value.last_commit_id,
      };
    });
  }
  /** Returns a provisional commit identity. The workflow must read back its complete tree and approved bytes. */
  createExportCommit(input: {
    readonly projectId: number;
    readonly baseSha: string;
    readonly branch: string;
    readonly changes: readonly GitLabFileChange[];
  }): Promise<GitLabCommit> {
    const metadata = parse(
      z.object({ projectId: id, baseSha: sha, branch: exportBranch }).strict(),
      {
        projectId: input.projectId,
        baseSha: input.baseSha,
        branch: input.branch,
      },
    );
    const parsedChanges = parse(
      z
        .array(
          z.discriminatedUnion("action", [
            z
              .object({
                action: z.enum(["create", "update"]),
                path,
                bytes: z
                  .instanceof(Uint8Array)
                  .refine((value) => value.byteLength <= 1024 * 1024),
                executable: z.boolean(),
              })
              .strict(),
            z.object({ action: z.literal("delete"), path }).strict(),
          ]),
        )
        .min(1)
        .max(512),
      input.changes,
    );
    const paths = new Set<string>();
    let totalBytes = 0;
    const actions = parsedChanges.map((change) => {
      const name = parse(path, change.path);
      const folded = name.normalize("NFC").toLowerCase();
      if (
        paths.has(folded) ||
        [...paths].some(
          (existing) =>
            folded.startsWith(existing + "/") ||
            existing.startsWith(folded + "/"),
        )
      )
        throw new GitLabProviderError("not-sent", "invalid-input");
      paths.add(folded);
      if (change.action === "delete")
        return { action: "delete", file_path: name };
      if ((totalBytes += change.bytes.byteLength) > 2 * 1024 * 1024)
        throw new GitLabProviderError("not-sent", "invalid-input");
      return {
        action: change.action,
        file_path: name,
        encoding: "base64",
        content: Buffer.from(change.bytes).toString("base64"),
        execute_filemode: change.executable,
      };
    });
    const message = `Cloud Markup export ${metadata.branch.slice("cloudmarkup/export-".length)}\n\n[skip ci]\n`;
    const body = JSON.stringify({
      branch: metadata.branch,
      start_sha: metadata.baseSha,
      force: false,
      commit_message: message,
      actions: actions.flatMap((action) =>
        action.action === "update"
          ? [
              action,
              {
                action: "chmod",
                file_path: action.file_path,
                execute_filemode: action.execute_filemode,
              },
            ]
          : [action],
      ),
    });
    return this.#run(async (operation, token) => {
      const repository = await this.#project(
        operation,
        token,
        metadata.projectId,
      );
      if (
        repository.archived ||
        repository.empty ||
        repository.accessLevel < 30 ||
        repository.defaultBranch === metadata.branch
      )
        throw new GitLabProviderError("not-sent", "access-denied");
      if (
        await this.#branch(
          operation,
          token,
          metadata.projectId,
          metadata.branch,
        )
      )
        throw new GitLabProviderError("not-sent", "conflict");
      await this.#commit(
        operation,
        token,
        metadata.projectId,
        metadata.baseSha,
      );
      const result = parse(
        commit,
        (
          await operation.request({
            method: "POST",
            path: `/api/v4/projects/${String(metadata.projectId)}/repository/commits`,
            body,
            contentType: "application/json",
            token,
            successStatus: 201,
            maxBytes: 131072,
          })
        )?.value,
        true,
      );
      if (
        result.parent_ids.length !== 1 ||
        result.parent_ids[0] !== metadata.baseSha ||
        result.message !== message ||
        result.id === metadata.baseSha
      )
        throw new GitLabProviderError("uncertain", "conflict");
      const readback = await this.#commit(
        operation,
        token,
        metadata.projectId,
        result.id,
      );
      const head = await this.#branch(
        operation,
        token,
        metadata.projectId,
        metadata.branch,
      );
      if (
        readback.parents.length !== 1 ||
        readback.parents[0] !== metadata.baseSha ||
        readback.message !== message ||
        head?.sha !== result.id ||
        head.protected
      )
        throw new GitLabProviderError("uncertain", "conflict");
      return readback;
    });
  }
  /** Read-only acknowledgement recovery. Missing is uncertainty, never permission to repeat a write. */
  findMergeRequest(input: {
    readonly projectId: number;
    readonly branch: string;
    readonly baseBranch: string;
    readonly expectedHeadSha: string;
  }): Promise<GitLabMergeRequest | null> {
    const request = parse(
      z
        .object({
          projectId: id,
          branch: exportBranch,
          baseBranch: branch,
          expectedHeadSha: sha,
        })
        .strict(),
      input,
    );
    return this.#run(async (operation, token) => {
      const repository = await this.#project(
        operation,
        token,
        request.projectId,
      );
      const query = new URLSearchParams({
        source_branch: request.branch,
        target_branch: request.baseBranch,
        state: "all",
        per_page: "100",
        page: "1",
      });
      const response = await operation.request({
        method: "GET",
        path:
          "/api/v4/projects/" +
          String(request.projectId) +
          "/merge_requests?" +
          query.toString(),
        token,
        successStatus: 200,
        maxBytes: 131072,
      });
      const candidates = parse(
        z.array(mergeRequest).max(1),
        response?.value,
        true,
      );
      if (response?.nextPage)
        throw new GitLabProviderError("uncertain", "conflict");
      const value = candidates[0];
      if (!value) return null;
      if (
        value.source_project_id !== request.projectId ||
        value.target_project_id !== request.projectId ||
        value.source_branch !== request.branch ||
        value.target_branch !== request.baseBranch ||
        value.sha !== request.expectedHeadSha
      )
        throw new GitLabProviderError("uncertain", "conflict");
      return {
        number: value.iid,
        sha: value.sha,
        state: value.state,
        draft: value.draft,
        url: repository.url + "/-/merge_requests/" + String(value.iid),
      };
    });
  }
  createMergeRequest(input: {
    readonly projectId: number;
    readonly branch: string;
    readonly baseBranch: string;
    readonly expectedHeadSha: string;
  }): Promise<GitLabMergeRequest> {
    const request = parse(
      z
        .object({
          projectId: id,
          branch: exportBranch,
          baseBranch: branch,
          expectedHeadSha: sha,
        })
        .strict(),
      input,
    );
    if (request.branch === request.baseBranch)
      throw new GitLabProviderError("not-sent", "invalid-input");
    return this.#run(async (operation, token) => {
      const repository = await this.#project(
        operation,
        token,
        request.projectId,
      );
      if (
        repository.archived ||
        repository.empty ||
        repository.accessLevel < 30
      )
        throw new GitLabProviderError("not-sent", "access-denied");
      const head = await this.#branch(
        operation,
        token,
        request.projectId,
        request.branch,
      );
      if (head?.sha !== request.expectedHeadSha || head.protected)
        throw new GitLabProviderError("not-sent", "conflict");
      const value = parse(
        mergeRequest,
        (
          await operation.request({
            method: "POST",
            path: `/api/v4/projects/${String(request.projectId)}/merge_requests`,
            token,
            successStatus: 201,
            contentType: "application/json",
            body: JSON.stringify({
              source_branch: request.branch,
              target_branch: request.baseBranch,
              title: "Draft: Cloud Markup export",
              description: `Review the Cloud Markup export at commit ${request.expectedHeadSha}. No merge or deployment was requested.`,
              remove_source_branch: false,
              squash: false,
              allow_collaboration: false,
            }),
          })
        )?.value,
        true,
      );
      const after = await this.#branch(
        operation,
        token,
        request.projectId,
        request.branch,
      );
      if (
        value.source_project_id !== request.projectId ||
        value.target_project_id !== request.projectId ||
        value.source_branch !== request.branch ||
        value.target_branch !== request.baseBranch ||
        value.sha !== request.expectedHeadSha ||
        value.state !== "opened" ||
        !value.draft ||
        after?.sha !== request.expectedHeadSha ||
        after.protected
      )
        throw new GitLabProviderError("uncertain", "conflict");
      return {
        number: value.iid,
        sha: value.sha,
        state: value.state,
        draft: value.draft,
        url: `${repository.url}/-/merge_requests/${String(value.iid)}`,
      };
    });
  }
}
