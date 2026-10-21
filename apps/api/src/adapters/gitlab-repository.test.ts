import { httpText } from "./gitlab-test-helpers.js";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  GitLabRepositoryAdapter,
  type GitLabFileChange,
} from "./gitlab-repository.js";

const base = "a".repeat(40);
const head = "b".repeat(40);
const branch = `cloudmarkup/export-${"c".repeat(32)}`;
const message = `Cloud Markup export ${"c".repeat(32)}\n\n[skip ci]\n`;
const project = {
  id: 8,
  path_with_namespace: "synthetic-group/repository",
  default_branch: "main",
  archived: false,
  empty_repo: false,
  permissions: { project_access: { access_level: 40 }, group_access: null },
};
const baseCommit = { id: base, parent_ids: [], message: "synthetic base\n" };
const headCommit = { id: head, parent_ids: [base], message };
const headBranch = { name: branch, protected: false, commit: { id: head } };
const mergeRequest = {
  iid: 4,
  source_project_id: 8,
  target_project_id: 8,
  source_branch: branch,
  target_branch: "main",
  sha: head,
  state: "opened",
  draft: true,
};
const bytes = new TextEncoder().encode("synthetic infrastructure\n");
const blob = createHash("sha1")
  .update(`blob ${String(bytes.byteLength)}\0`)
  .update(bytes)
  .digest("hex");
const file = {
  file_path: "infra/main.tf",
  size: bytes.byteLength,
  encoding: "base64",
  content: Buffer.from(bytes).toString("base64"),
  content_sha256: createHash("sha256").update(bytes).digest("hex"),
  blob_id: blob,
  commit_id: base,
  last_commit_id: base,
  execute_filemode: false,
};
const changes: readonly GitLabFileChange[] = [
  { action: "create", path: "infra/main.tf", bytes, executable: false },
];

function fixture(responses: readonly Response[] = []) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const buffers: Uint8Array[] = [];
  const admission = vi.fn(() => Promise.resolve());
  const readAccessToken = vi.fn(() => {
    const token = new TextEncoder().encode("synthetic-access-for-gitlab-tests");
    buffers.push(token);
    return Promise.resolve(token);
  });
  const adapter = new GitLabRepositoryAdapter({
    fetch,
    readAccessToken,
    assertCurrentAdmission: admission,
  });
  return { adapter, fetch, buffers, admission, readAccessToken };
}
const missing = () => Response.json({}, { status: 404 });
const createResponses = () => [
  Response.json(project),
  missing(),
  Response.json(baseCommit),
  Response.json(headCommit, { status: 201 }),
  Response.json(headCommit),
  Response.json(headBranch),
];
const createInput = { projectId: 8, baseSha: base, branch, changes };

describe("GitLab pinned repository adapter", () => {
  it("lists explicitly selectable projects without following provider URLs", async () => {
    const { adapter, fetch } = fixture([
      Response.json([project], {
        headers: { "x-next-page": "2", link: "https://evil.invalid/page" },
      }),
    ]);
    expect(await adapter.listProjects()).toMatchObject({
      projects: [
        {
          projectId: 8,
          accessLevel: 40,
          url: "https://gitlab.com/synthetic-group/repository",
        },
      ],
      nextPage: 2,
    });
    expect(httpText(fetch.mock.calls[0]?.[0])).toContain("membership=true");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not accept a substituted numeric project identity", async () => {
    const { adapter } = fixture([Response.json({ ...project, id: 9 })]);
    await expect(adapter.readProject(8)).rejects.toMatchObject({
      problem: "access-denied",
    });
  });
  it("encodes an exact branch and verifies its returned name", async () => {
    const { adapter, fetch } = fixture([Response.json(headBranch)]);
    expect(await adapter.readBranch(8, branch)).toEqual({
      sha: head,
      protected: false,
    });
    expect(httpText(fetch.mock.calls[0]?.[0])).toContain(
      "cloudmarkup%2Fexport-",
    );
    await expect(
      fixture([
        Response.json({ ...headBranch, name: "main" }),
      ]).adapter.readBranch(8, branch),
    ).rejects.toMatchObject({ outcome: "uncertain" });
  });
  it("reads exact file bytes with SHA-256 and Git blob verification", async () => {
    const { adapter, fetch, buffers } = fixture([Response.json(file)]);
    const result = await adapter.readFile({
      projectId: 8,
      commitSha: base,
      path: file.file_path,
      expectedBlobSha: blob,
    });
    expect(result.bytes).toEqual(Buffer.from(bytes));
    expect(result.executable).toBe(false);
    expect(httpText(fetch.mock.calls[0]?.[0])).toBe(
      `https://gitlab.com/api/v4/projects/8/repository/files/infra%2Fmain.tf?ref=${base}`,
    );
    expect(buffers.every((value) => value.every((byte) => byte === 0))).toBe(
      true,
    );
  });
  it.each([
    { ...file, file_path: "infra/other.tf" },
    { ...file, commit_id: head },
    { ...file, blob_id: head },
    { ...file, content_sha256: "d".repeat(64) },
    { ...file, size: bytes.byteLength + 1 },
    { ...file, content: file.content + "\n" },
    {
      ...file,
      content: Buffer.from("transformed provider bytes").toString("base64"),
      size: Buffer.byteLength("transformed provider bytes"),
      content_sha256: createHash("sha256")
        .update("transformed provider bytes")
        .digest("hex"),
    },
  ])(
    "rejects substituted, transformed or corrupt file content",
    async (value) => {
      await expect(
        fixture([Response.json(value)]).adapter.readFile({
          projectId: 8,
          commitSha: base,
          path: file.file_path,
          expectedBlobSha: blob,
        }),
      ).rejects.toMatchObject({ outcome: "uncertain" });
    },
  );
  it("paginates complete metadata at one immutable SHA before source selection", async () => {
    const { adapter, fetch } = fixture([
      Response.json(
        [{ id: base, path: "infra", type: "tree", mode: "040000" }],
        { headers: { "x-next-page": "2" } },
      ),
      Response.json(
        [{ id: blob, path: file.file_path, type: "blob", mode: "100644" }],
        { headers: { "x-next-page": "" } },
      ),
    ]);
    expect(await adapter.readTree(8, base)).toEqual([
      { path: "infra", objectId: base, mode: "040000", type: "tree" },
      { path: file.file_path, objectId: blob, mode: "100644", type: "blob" },
    ]);
    expect(
      fetch.mock.calls.every(([url]) => httpText(url).includes(`ref=${base}`)),
    ).toBe(true);
  });
  it.each(
    ["1", "3", "https://evil.invalid", "2x"].filter((_, index) => index !== 2),
  )(
    "rejects an unbounded or repeated pagination instruction %s",
    async (next) => {
      const { adapter, fetch } = fixture([
        Response.json([], { headers: { "x-next-page": next } }),
      ]);
      await expect(adapter.readTree(8, base)).rejects.toMatchObject({
        outcome: "uncertain",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("does not mistake a full page with omitted headers for the complete tree", async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({
      id: blob,
      path: `infra/file-${String(index)}.tf`,
      type: "blob",
      mode: "100644",
    }));
    const { adapter, fetch } = fixture([
      Response.json(first),
      Response.json([]),
    ]);
    expect(await adapter.readTree(8, base)).toHaveLength(100);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    [{ id: blob, path: file.file_path, type: "tree", mode: "100644" }],
    [
      { id: blob, path: file.file_path, type: "blob", mode: "100644" },
      { id: head, path: file.file_path, type: "blob", mode: "100644" },
    ],
  ])("rejects inconsistent or duplicated tree metadata", async (...entries) => {
    await expect(
      fixture([Response.json(entries)]).adapter.readTree(8, base),
    ).rejects.toMatchObject({ outcome: "uncertain" });
  });
  it("writes one fixed-base commit on a fresh export branch and verifies its ancestry and head", async () => {
    const { adapter, fetch } = fixture(createResponses());
    expect(await adapter.createExportCommit(createInput)).toEqual({
      sha: head,
      parents: [base],
      message,
    });
    const mutations = fetch.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(mutations).toHaveLength(1);
    expect(JSON.parse(httpText(mutations[0]?.[1]?.body))).toEqual({
      branch,
      start_sha: base,
      force: false,
      commit_message: message,
      actions: [
        {
          action: "create",
          file_path: file.file_path,
          content: file.content,
          encoding: "base64",
          execute_filemode: false,
        },
      ],
    });
  });
  it("uses an explicit chmod action because GitLab updates preserve file modes", async () => {
    const { adapter, fetch } = fixture(createResponses());
    await adapter.createExportCommit({
      ...createInput,
      changes: [
        { action: "update", path: file.file_path, bytes, executable: true },
      ],
    });
    const body = JSON.parse(
      httpText(
        fetch.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body,
      ),
    ) as { actions: unknown[] };
    expect(body.actions).toContainEqual({
      action: "chmod",
      file_path: file.file_path,
      execute_filemode: true,
    });
  });
  it("snapshots file bytes and metadata before asynchronous admission", async () => {
    const mutableBytes = new Uint8Array(bytes);
    const input = {
      ...createInput,
      changes: [
        {
          action: "create" as const,
          path: file.file_path,
          bytes: mutableBytes,
          executable: false,
        },
      ],
    };
    const { adapter, fetch } = fixture(createResponses());
    const result = adapter.createExportCommit(input);
    mutableBytes.fill(0);
    input.branch = "main";
    const firstChange = input.changes[0];
    if (!firstChange) throw Error("Missing test change");
    firstChange.path = "unapproved.txt";
    await result;
    const body = JSON.parse(
      httpText(
        fetch.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body,
      ),
    ) as { branch: string; actions: { content: string; file_path: string }[] };
    expect(body.branch).toBe(branch);
    expect(body.actions[0]).toMatchObject({
      file_path: file.file_path,
      content: file.content,
    });
  });
  it("never writes an already existing branch", async () => {
    const { adapter, fetch } = fixture([
      Response.json(project),
      Response.json(headBranch),
    ]);
    await expect(adapter.createExportCommit(createInput)).rejects.toMatchObject(
      { problem: "conflict" },
    );
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
      false,
    );
  });
  it.each([
    { ...project, archived: true },
    { ...project, empty_repo: true },
    { ...project, default_branch: branch },
    {
      ...project,
      permissions: { project_access: { access_level: 20 }, group_access: null },
    },
  ])("denies an ineligible repository before writing", async (value) => {
    const { adapter, fetch } = fixture([Response.json(value)]);
    await expect(adapter.createExportCommit(createInput)).rejects.toMatchObject(
      { problem: "access-denied" },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retains uncertainty without a second write after the commit acknowledgment is lost", async () => {
    const { adapter, fetch } = fixture(createResponses().slice(0, 3));
    fetch.mockRejectedValueOnce(Error("private source detail"));
    await expect(adapter.createExportCommit(createInput)).rejects.toMatchObject(
      { outcome: "uncertain" },
    );
    expect(
      fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
  it.each([
    { ...headCommit, parent_ids: [head] },
    { ...headCommit, parent_ids: [base, head] },
    { ...headCommit, message: "unapproved" },
  ])("rejects changed commit ancestry or intent", async (value) => {
    const { adapter } = fixture([
      ...createResponses().slice(0, 3),
      Response.json(value, { status: 201 }),
    ]);
    await expect(adapter.createExportCommit(createInput)).rejects.toMatchObject(
      { outcome: "uncertain", problem: "conflict" },
    );
  });
  it("does not overwrite a concurrent commit found during readback", async () => {
    const { adapter, fetch } = fixture([
      ...createResponses().slice(0, 5),
      Response.json({ ...headBranch, commit: { id: "d".repeat(40) } }),
    ]);
    await expect(adapter.createExportCommit(createInput)).rejects.toMatchObject(
      { outcome: "uncertain", problem: "conflict" },
    );
    expect(
      fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
  it.each([
    "../escape",
    "/absolute",
    ".git/config",
    "infra/AUX.txt",
    "infra/file.",
    "infra/%2e%2e/file",
    "infra//file",
    "infra/back\\slash",
  ])("rejects unsafe change path %s before credential access", (path) => {
    const { adapter, readAccessToken } = fixture();
    expect(() =>
      adapter.createExportCommit({
        ...createInput,
        changes: [{ action: "delete", path }],
      }),
    ).toThrow();
    expect(readAccessToken).not.toHaveBeenCalled();
  });
  it.each([
    ["infra/file", "INFRA/file"],
    ["infra/file", "infra/file/child"],
  ])("rejects ambiguous or colliding change paths", (...paths) => {
    expect(() =>
      fixture().adapter.createExportCommit({
        ...createInput,
        changes: paths.map((path) => ({ action: "delete", path })),
      }),
    ).toThrow();
  });
  it("creates only a draft merge request without auto-merge or branch deletion", async () => {
    const { adapter, fetch } = fixture([
      Response.json(project),
      Response.json(headBranch),
      Response.json(mergeRequest, { status: 201 }),
      Response.json(headBranch),
    ]);
    expect(
      await adapter.createMergeRequest({
        projectId: 8,
        branch,
        baseBranch: "main",
        expectedHeadSha: head,
      }),
    ).toMatchObject({
      number: 4,
      state: "opened",
      draft: true,
      url: "https://gitlab.com/synthetic-group/repository/-/merge_requests/4",
    });
    expect(JSON.parse(httpText(fetch.mock.calls[2]?.[1]?.body))).toMatchObject({
      remove_source_branch: false,
      squash: false,
      allow_collaboration: false,
    });
    expect(httpText(fetch.mock.calls[2]?.[1]?.body)).not.toContain(
      "auto_merge",
    );
  });
  it.each([
    { ...mergeRequest, target_project_id: 9 },
    { ...mergeRequest, sha: base },
    { ...mergeRequest, draft: false },
    { ...mergeRequest, target_branch: "unapproved" },
  ])("rejects a substituted merge-request identity", async (value) => {
    const { adapter } = fixture([
      Response.json(project),
      Response.json(headBranch),
      Response.json(value, { status: 201 }),
      Response.json(headBranch),
    ]);
    await expect(
      adapter.createMergeRequest({
        projectId: 8,
        branch,
        baseBranch: "main",
        expectedHeadSha: head,
      }),
    ).rejects.toMatchObject({ outcome: "uncertain", problem: "conflict" });
  });
  it("recovers one exact merge request without repeating a write", async () => {
    const { adapter, fetch } = fixture([
      Response.json(project),
      Response.json([mergeRequest]),
    ]);
    expect(
      await adapter.findMergeRequest({
        projectId: 8,
        branch,
        baseBranch: "main",
        expectedHeadSha: head,
      }),
    ).toMatchObject({ number: 4, sha: head });
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
      true,
    );
  });
  it("leaves a missing acknowledgement unresolved", async () => {
    const { adapter, fetch } = fixture([
      Response.json(project),
      Response.json([]),
    ]);
    expect(
      await adapter.findMergeRequest({
        projectId: 8,
        branch,
        baseBranch: "main",
        expectedHeadSha: head,
      }),
    ).toBeNull();
    expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
      true,
    );
  });
  it.each(["closed", "merged"])(
    "reports a recovered %s request without reopening it",
    async (state) => {
      const { adapter, fetch } = fixture([
        Response.json(project),
        Response.json([{ ...mergeRequest, state }]),
      ]);
      expect(
        await adapter.findMergeRequest({
          projectId: 8,
          branch,
          baseBranch: "main",
          expectedHeadSha: head,
        }),
      ).toMatchObject({ state });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
  it("rejects ambiguous recovered requests", async () => {
    const { adapter } = fixture([
      Response.json(project),
      Response.json([mergeRequest, { ...mergeRequest, iid: 5 }]),
    ]);
    await expect(
      adapter.findMergeRequest({
        projectId: 8,
        branch,
        baseBranch: "main",
        expectedHeadSha: head,
      }),
    ).rejects.toMatchObject({ outcome: "uncertain" });
  });
  it("rejects a recovered request for a substituted commit", async () => {
    const { adapter } = fixture([
      Response.json(project),
      Response.json([{ ...mergeRequest, sha: base }]),
    ]);
    await expect(
      adapter.findMergeRequest({
        projectId: 8,
        branch,
        baseBranch: "main",
        expectedHeadSha: head,
      }),
    ).rejects.toMatchObject({ outcome: "uncertain", problem: "conflict" });
  });
});
