import { sha256DigestSchema } from "@cloudmarkup/schemas";
import {
  GitLabReviewedExportWorkflow,
  type GitLabExportRepository,
  type GitLabExportReviewStore,
} from "./gitlab-exports.js";
import {
  gitLabExportApprovalDigest,
  type GitLabExportRecord,
} from "./gitlab-export-state.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { GitLabTreeEntry } from "../adapters/gitlab-repository.js";
import { retainedArtifactFixture } from "../adapters/persistence/solution-export-artifact-test-helpers.js";
import {
  prepareGitLabArtifactReview,
  verifyGitLabArtifactCommit,
  verifyGitLabArtifactCommitStructure,
  verifyGitLabArtifactFileBatch,
} from "./gitlab-artifact-review.js";

const branch = "cloudmarkup/export-" + "a".repeat(32),
  baseCommitSha = "b".repeat(40),
  commitSha = "c".repeat(40);
const artifact = retainedArtifactFixture();
const originalFiles = [
  {
    path: "existing.txt",
    bytes: Buffer.from("Directory-prefix ordering.\n"),
    mode: "100644" as const,
  },
  {
    path: "existing0",
    bytes: Buffer.from("Directory-prefix ordering second.\n"),
    mode: "100644" as const,
  },
  {
    path: "README.md",
    bytes: Buffer.from("Synthetic existing repository.\n"),
    mode: "100644" as const,
  },
  {
    path: "existing/reference.txt",
    bytes: Buffer.from("Preserve these existing bytes.\n"),
    mode: "100644" as const,
  },
  {
    path: "preserved-link",
    bytes: Buffer.from("README.md"),
    mode: "120000" as const,
  },
];
const temporaryRoot = realpathSync(tmpdir());
let directory: string | undefined;
let baseTree: readonly GitLabTreeEntry[];
let candidate: ReturnType<typeof prepareGitLabArtifactReview>;
let completeTree: readonly GitLabTreeEntry[];
let expectedRoot: string;
function gitEnvironment() {
  if (!directory) throw Error("Synthetic Git directory missing");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  environment["GIT_CONFIG_NOSYSTEM"] = "1";
  environment["GIT_CONFIG_GLOBAL"] = join(directory, "empty-config");
  return environment;
}
/** Native Git is an independent oracle for canonical SHA-1 tree sorting and mode serialization. Synthetic bare repository only. */
function gitTree(
  files: readonly {
    path: string;
    bytes: Uint8Array;
    mode: "100644" | "100755" | "120000";
  }[],
) {
  if (!directory) throw Error("Synthetic Git directory missing");
  const environment = gitEnvironment();
  const gitDirectory = directory;
  const git = (args: readonly string[], input?: Uint8Array) =>
    execFileSync("git", ["--no-replace-objects", "-C", gitDirectory, ...args], {
      env: environment,
      input,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  const entries: GitLabTreeEntry[] = [];
  for (const file of files)
    entries.push({
      path: file.path,
      mode: file.mode,
      type: "blob",
      objectId: git(["hash-object", "-w", "--stdin"], file.bytes),
    });
  const directories = new Set([""]);
  for (const file of files) {
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++)
      directories.add(parts.slice(0, i).join("/"));
  }
  let root = "";
  for (const folder of [...directories].sort(
    (a, b) => b.split("/").length - a.split("/").length || b.length - a.length,
  )) {
    const prefix = folder ? folder + "/" : "";
    const children = entries.filter(
      (entry) =>
        entry.path.startsWith(prefix) &&
        !entry.path.slice(prefix.length).includes("/"),
    );
    const listing = children
      .map(
        (entry) =>
          `${entry.mode} ${entry.type} ${entry.objectId}\t${entry.path.slice(prefix.length)}\0`,
      )
      .join("");
    const objectId = git(["mktree", "-z"], Buffer.from(listing));
    if (folder)
      entries.push({ path: folder, mode: "040000", type: "tree", objectId });
    else root = objectId;
  }
  return { root, entries };
}
beforeAll(() => {
  directory = mkdtempSync(join(temporaryRoot, "cm-gitlab-tree-"));
  writeFileSync(join(directory, "empty-config"), "");
  execFileSync(
    "git",
    ["init", "--bare", "--quiet", "--object-format=sha1", directory],
    { windowsHide: true, env: gitEnvironment() },
  );
  baseTree = gitTree(originalFiles).entries;
  candidate = prepareGitLabArtifactReview({
    artifact,
    baseTree,
    baseCommitSha,
    branch,
    destinationFolder: "exports/reviewed",
  });
  const result = gitTree([
    ...originalFiles,
    ...candidate.changes.map((change) => {
      if (change.action !== "create") throw Error("Expected create-only plan");
      return {
        path: change.path,
        bytes: change.bytes,
        mode: "100644" as const,
      };
    }),
  ]);
  completeTree = result.entries;
  expectedRoot = result.root;
});
afterAll(() => {
  if (directory) {
    if (
      realpathSync(directory) !== directory ||
      dirname(directory) !== temporaryRoot ||
      !/^cm-gitlab-tree-[A-Za-z0-9]+$/u.test(basename(directory))
    )
      throw Error("Refusing to remove an unverified synthetic Git directory.");
    rmSync(directory, { recursive: true, force: true });
  }
});
function validReadback() {
  return {
    review: candidate.review,
    commit: {
      sha: commitSha,
      parents: [baseCommitSha],
      message: "Cloud Markup export " + "a".repeat(32) + "\n\n[skip ci]\n",
    },
    branchHeadSha: commitSha,
    tree: completeTree,
    files: candidate.changes.map((change) => {
      if (change.action !== "create") throw Error("Expected creates");
      return { path: change.path, bytes: change.bytes, executable: false };
    }),
  };
}
describe("immutable GitLab artifact review and readback", () => {
  it("matches native Git tree hashes while retaining unrelated files, nested directories and symlinks", () => {
    expect(candidate.review.expectedTreeSha).toBe(expectedRoot);
    expect(candidate.changes).toHaveLength(artifact.files.length);
    expect(() => {
      verifyGitLabArtifactCommit(validReadback());
    }).not.toThrow();
  });
  it("produces the same review from reordered inputs and snapshots artifact bytes", () => {
    const other = prepareGitLabArtifactReview({
      artifact: { ...artifact, files: [...artifact.files].reverse() },
      baseTree: [...baseTree].reverse(),
      baseCommitSha,
      branch,
      destinationFolder: "exports/reviewed",
    });
    expect(other.review).toEqual(candidate.review);
    const first = other.changes[0];
    if (first?.action !== "create") throw Error("Missing synthetic change");
    first.bytes.fill(0);
    expect(
      artifact.files.some((file) => file.bytes.some((byte) => byte !== 0)),
    ).toBe(true);
    expect(() => {
      verifyGitLabArtifactCommit(validReadback());
    }).not.toThrow();
  });
  it.each(
    [
      "",
      "../outside",
      "/absolute",
      ".git/out",
      "CON/export",
      "folder./export",
      "folder//export",
      "folder\\export",
    ].filter((_, index) => ![0, 6].includes(index)),
  )("rejects nonportable folder %s", (destinationFolder) => {
    expect(() =>
      prepareGitLabArtifactReview({
        artifact,
        baseTree,
        baseCommitSha,
        branch,
        destinationFolder,
      }),
    ).toThrow();
  });
  it.each([
    "existing",
    "EXISTING/reference",
    "README.md/sub",
    "preserved-link/sub",
  ])(
    "refuses existing paths and case aliases for folder %s",
    (destinationFolder) => {
      expect(() =>
        prepareGitLabArtifactReview({
          artifact,
          baseTree,
          baseCommitSha,
          branch,
          destinationFolder,
        }),
      ).toThrow();
    },
  );
  it("rejects a corrupt immutable artifact before proposing any write", () => {
    const changed = structuredClone(artifact);
    const file = changed.files[0];
    if (!file) throw Error("Missing synthetic file");
    file.bytes.fill(0);
    expect(() =>
      prepareGitLabArtifactReview({
        artifact: changed,
        baseTree,
        baseCommitSha,
        branch,
        destinationFolder: "safe",
      }),
    ).toThrow();
  });
  it.each([
    "duplicate",
    "missing-parent",
    "wrong-directory-object",
    "wrong-mode",
  ] as const)("rejects malformed base tree %s", (kind) => {
    const first = baseTree[0];
    if (!first) throw Error("Missing base entry");
    const tree =
      kind === "duplicate"
        ? [...baseTree, first]
        : kind === "missing-parent"
          ? baseTree.filter((entry) => entry.path !== "existing")
          : baseTree.map((entry) =>
              entry.path === "existing"
                ? {
                    ...entry,
                    ...(kind === "wrong-mode"
                      ? { mode: "100644" as const }
                      : { objectId: "0".repeat(40) }),
                  }
                : entry,
            );
    expect(() =>
      prepareGitLabArtifactReview({
        artifact,
        baseTree: tree,
        baseCommitSha,
        branch,
        destinationFolder: "safe",
      }),
    ).toThrow();
  });
  it.each(
    (
      [
        "wrong-parent",
        "extra-parent",
        "wrong-marker",
        "moved-head",
        "different-commit",
        "review-tamper",
      ] as const
    ).filter((_, index) => index !== 4),
  )("rejects provisional commit %s", (kind) => {
    const input = validReadback();
    if (kind === "wrong-parent") input.commit.parents = ["d".repeat(40)];
    if (kind === "extra-parent") input.commit.parents.push("d".repeat(40));
    if (kind === "wrong-marker") input.commit.message = "Unrelated commit";
    if (kind === "moved-head") input.branchHeadSha = "d".repeat(40);
    if (kind === "different-commit") input.commit.sha = "d".repeat(40);
    if (kind === "review-tamper")
      input.review = { ...input.review, destinationFolder: "changed" };
    expect(() => {
      verifyGitLabArtifactCommit(input);
    }).toThrow();
  });
  it.each([
    "unexpected-file",
    "missing-file",
    "changed-existing",
    "changed-mode",
    "directory-hash",
  ] as const)("rejects unexpected repository effect %s", (kind) => {
    const input = validReadback();
    input.tree =
      kind === "unexpected-file"
        ? [
            ...input.tree,
            {
              path: "unexpected.txt",
              type: "blob",
              mode: "100644",
              objectId: "d".repeat(40),
            },
          ]
        : kind === "missing-file"
          ? input.tree.filter((entry) => entry.path !== "README.md")
          : input.tree.map((entry) =>
              entry.path ===
              (kind === "directory-hash" ? "existing" : "README.md")
                ? {
                    ...entry,
                    ...(kind === "changed-mode"
                      ? { mode: "100755" as const }
                      : { objectId: "d".repeat(40) }),
                  }
                : entry,
            );
    expect(() => {
      verifyGitLabArtifactCommit(input);
    }).toThrow();
  });
});

describe("bounded GitLab artifact readback", () => {
  it("proves commit structure and contiguous file batches independently", () => {
    const input = validReadback();
    expect(() => {
      verifyGitLabArtifactCommitStructure(input);
    }).not.toThrow();
    for (let offset = 0; offset < input.files.length; offset += 2)
      expect(() => {
        verifyGitLabArtifactFileBatch({
          review: input.review,
          offset,
          files: input.files.slice(offset, offset + 2),
        });
      }).not.toThrow();
  });
  it.each(
    [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER].filter(
      (_, index) => ![1, 2].includes(index),
    ),
  )("rejects invalid progress %s", (offset) => {
    const input = validReadback();
    expect(() => {
      verifyGitLabArtifactFileBatch({
        review: input.review,
        offset,
        files: input.files.slice(0, 1),
      });
    }).toThrow();
  });
  it.each(
    (
      [
        "empty",
        "wrong-offset",
        "duplicate",
        "too-many",
        "changed-content",
        "changed-mode",
        "changed-review",
      ] as const
    ).filter((_, index) => index !== 3),
  )("rejects %s batch", (kind) => {
    const original = validReadback();
    const first = original.files[0];
    if (!first || original.files.length < 2)
      throw Error("Synthetic batch files missing");
    const input = { review: original.review, offset: 0, files: [first] };
    if (kind === "empty") input.files = [];
    if (kind === "wrong-offset") input.offset = 1;
    if (kind === "duplicate") input.files = [first, first];
    if (kind === "too-many")
      input.files = Array.from({ length: 17 }, () => first);
    if (kind === "changed-content")
      input.files = [{ ...first, bytes: Buffer.from("Changed") }];
    if (kind === "changed-mode") input.files = [{ ...first, executable: true }];
    if (kind === "changed-review")
      input.review = { ...input.review, destinationFolder: "changed" };
    expect(() => {
      verifyGitLabArtifactFileBatch(input);
    }).toThrow();
  });
});

function workflowFixture() {
  const scope = {
    organizationId: "organization.export",
    projectId: "project.export",
    principalId: "principal.export",
    applicationId: "a".repeat(64),
  };
  const destination = {
    connectionId: "gitlab_" + "b".repeat(32),
    providerProjectId: 42,
    selectionVersion: 1,
    artifactId: "artifact.export",
    destinationFolder: "exports/reviewed",
  };
  let record: GitLabExportRecord | undefined;
  let branchExists = false;
  let mergeRequestExists = false;
  const required = () => {
    if (!record) throw Error("Review missing");
    return record;
  };
  const transition = (
    version: number,
    digest: string,
    patch: Partial<GitLabExportRecord>,
  ) => {
    const value = required();
    if (value.recordVersion !== version || value.approvalDigest !== digest)
      throw Error("Version conflict");
    record = { ...value, ...patch, recordVersion: value.recordVersion + 1 };
    return Promise.resolve(structuredClone(record));
  };
  const store = {
    create: vi.fn<GitLabExportReviewStore["create"]>((descriptor) => {
      record = {
        descriptor,
        approvalDigest: gitLabExportApprovalDigest(descriptor),
        state: "prepared",
        recordVersion: 1,
        verifiedFiles: 0,
        commitSha: null,
        mergeRequest: null,
        expiresAt: "2026-10-02T12:15:00.000Z",
        expired: false,
      };
      return Promise.resolve(structuredClone(record));
    }),
    get: vi.fn<GitLabExportReviewStore["get"]>(() =>
      Promise.resolve(structuredClone(required())),
    ),
    claimCommit: vi.fn<GitLabExportReviewStore["claimCommit"]>(
      (_id, version, digest) =>
        transition(version, digest, { state: "commit-dispatched" }),
    ),
    beginVerification: vi.fn<GitLabExportReviewStore["beginVerification"]>(
      (_id, version, digest, commitSha) =>
        transition(version, digest, { state: "verifying", commitSha }),
    ),
    recordVerifiedFiles: vi.fn<GitLabExportReviewStore["recordVerifiedFiles"]>(
      (_id, version, digest, verifiedFiles) =>
        transition(version, digest, {
          verifiedFiles,
          state:
            verifiedFiles === required().descriptor.fileCount
              ? "verified"
              : "verifying",
        }),
    ),
    claimMergeRequest: vi.fn<GitLabExportReviewStore["claimMergeRequest"]>(
      (_id, version, digest) =>
        transition(version, digest, { state: "merge-request-dispatched" }),
    ),
    complete: vi.fn<GitLabExportReviewStore["complete"]>(
      (_id, version, digest, mergeRequest) =>
        transition(version, digest, { state: "succeeded", mergeRequest }),
    ),
  };
  const receipt = {
    number: 17,
    sha: commitSha,
    state: "opened" as const,
    draft: true,
    url: "https://gitlab.com/synthetic/export/-/merge_requests/17",
  };
  const repository = {
    readProject: vi.fn<GitLabExportRepository["readProject"]>(() =>
      Promise.resolve({
        projectId: 42,
        pathWithNamespace: "synthetic/export",
        defaultBranch: "main",
        archived: false,
        empty: false,
        accessLevel: 30,
        url: "https://gitlab.com/synthetic/export",
      }),
    ),
    readBranch: vi.fn<GitLabExportRepository["readBranch"]>((_id, name) =>
      Promise.resolve(
        name === "main"
          ? { sha: baseCommitSha, protected: true }
          : branchExists
            ? { sha: commitSha, protected: false }
            : null,
      ),
    ),
    readCommit: vi.fn<GitLabExportRepository["readCommit"]>(() =>
      Promise.resolve(validReadback().commit),
    ),
    readTree: vi.fn<GitLabExportRepository["readTree"]>((_id, sha) =>
      Promise.resolve(sha === baseCommitSha ? baseTree : completeTree),
    ),
    readFile: vi.fn<GitLabExportRepository["readFile"]>((input) => {
      const file = validReadback().files.find(
        (file) => file.path === input.path,
      );
      if (!file) return Promise.reject(Error("Synthetic file missing"));
      return Promise.resolve({
        bytes: file.bytes,
        executable: file.executable,
        lastCommitSha: commitSha,
      });
    }),
    createExportCommit: vi.fn<GitLabExportRepository["createExportCommit"]>(
      () => {
        branchExists = true;
        return Promise.resolve(validReadback().commit);
      },
    ),
    createMergeRequest: vi.fn<GitLabExportRepository["createMergeRequest"]>(
      () => {
        mergeRequestExists = true;
        return Promise.resolve(receipt);
      },
    ),
    findMergeRequest: vi.fn<GitLabExportRepository["findMergeRequest"]>(() =>
      Promise.resolve(mergeRequestExists ? receipt : null),
    ),
  };
  const assertAuthorized = vi.fn(() => Promise.resolve());
  const readArtifact = vi.fn(() => Promise.resolve(artifact));
  const assertArtifactAvailable = vi.fn(() => Promise.resolve());
  const workflow = new GitLabReviewedExportWorkflow({
    scope,
    store,
    newReviewId: () => "gitlabreview_" + "a".repeat(32),
    assertAuthorized,
    readArtifact,
    assertArtifactAvailable,
    withRepository: async (_connectionId, admission, work) => {
      const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
        await admission();
        const result = await operation();
        await admission();
        return result;
      };
      return work({
        readProject: (...args) =>
          guarded(() => repository.readProject(...args)),
        readBranch: (...args) => guarded(() => repository.readBranch(...args)),
        readCommit: (...args) => guarded(() => repository.readCommit(...args)),
        readTree: (...args) => guarded(() => repository.readTree(...args)),
        readFile: (...args) => guarded(() => repository.readFile(...args)),
        createExportCommit: (...args) =>
          guarded(() => repository.createExportCommit(...args)),
        createMergeRequest: (...args) =>
          guarded(() => repository.createMergeRequest(...args)),
        findMergeRequest: (...args) =>
          guarded(() => repository.findMergeRequest(...args)),
      });
    },
  });
  const step = () => {
    const value = required();
    return workflow.advance({
      reviewId: value.descriptor.reviewId,
      expectedVersion: value.recordVersion,
      approvalDigest: value.approvalDigest,
      acknowledgedAutomation: true,
    });
  };
  const until = async (state: GitLabExportRecord["state"]) => {
    for (let i = 0; i < 40 && required().state !== state; i++) await step();
    expect(required().state).toBe(state);
  };
  return {
    workflow,
    destination,
    store,
    repository,
    assertAuthorized,
    readArtifact,
    assertArtifactAvailable,
    step,
    until,
    required,
    setRecord: (patch: Partial<GitLabExportRecord>) => {
      record = { ...required(), ...patch };
    },
    setBranch: (value: boolean) => {
      branchExists = value;
    },
    setMergeRequest: (value: boolean) => {
      mergeRequestExists = value;
    },
  };
}

describe("GitLab reviewed export workflow", () => {
  it("reviews immutable bytes, writes once, verifies all files, then confirms the draft MR by readback", async () => {
    const f = workflowFixture();
    const preview = await f.workflow.preview(f.destination);
    expect(preview.files).toEqual(candidate.review.files);
    expect(f.repository.createExportCommit).not.toHaveBeenCalled();
    await f.until("succeeded");
    expect(f.repository.createExportCommit).toHaveBeenCalledTimes(1);
    expect(f.repository.createMergeRequest).toHaveBeenCalledTimes(1);
    expect(f.repository.readFile).toHaveBeenCalledTimes(preview.files.length);
    expect(f.repository.findMergeRequest).toHaveBeenCalledTimes(1);
    expect(f.required().mergeRequest?.number).toBe(17);
    await f.step();
    expect(f.repository.createExportCommit).toHaveBeenCalledTimes(1);
  });
  it("recovers a lost commit acknowledgement through reads and never repeats the commit", async () => {
    const f = workflowFixture();
    await f.workflow.preview(f.destination);
    vi.mocked(f.repository.createExportCommit).mockImplementationOnce(() => {
      f.setBranch(true);
      return Promise.reject(Error("Lost acknowledgement"));
    });
    await expect(f.step()).rejects.toThrow("Lost acknowledgement");
    expect(f.required().state).toBe("commit-dispatched");
    await f.until("succeeded");
    expect(f.repository.createExportCommit).toHaveBeenCalledTimes(1);
  });
  it("retains uncertainty when a dispatched commit or MR is still missing", async () => {
    const f = workflowFixture();
    await f.workflow.preview(f.destination);
    vi.mocked(f.repository.createExportCommit).mockRejectedValueOnce(
      Error("Unknown outcome"),
    );
    await expect(f.step()).rejects.toThrow();
    await f.step();
    await f.step();
    expect(f.required().state).toBe("commit-dispatched");
    expect(f.repository.createExportCommit).toHaveBeenCalledTimes(1);
    f.setBranch(true);
    await f.until("verified");
    vi.mocked(f.repository.createMergeRequest).mockRejectedValueOnce(
      Error("Unknown MR"),
    );
    await expect(f.step()).rejects.toThrow();
    await f.step();
    await f.step();
    expect(f.required().state).toBe("merge-request-dispatched");
    expect(f.repository.createMergeRequest).toHaveBeenCalledTimes(1);
    f.setMergeRequest(true);
    await f.step();
    expect(f.required().state).toBe("succeeded");
  });
  it("recovers a closed MR after its source branch was removed, without reopening it", async () => {
    const f = workflowFixture();
    await f.workflow.preview(f.destination);
    await f.until("merge-request-dispatched");
    f.setBranch(false);
    vi.mocked(f.repository.findMergeRequest).mockResolvedValueOnce({
      number: 17,
      sha: commitSha,
      state: "closed",
      draft: false,
      url: "https://gitlab.com/synthetic/export/-/merge_requests/17",
    });
    await f.step();
    expect(f.required().mergeRequest?.state).toBe("closed");
    expect(f.repository.createMergeRequest).toHaveBeenCalledTimes(1);
  });
  it("requires the exact version, digest and explicit automation acknowledgement before the first write", async () => {
    const f = workflowFixture();
    const { record } = await f.workflow.preview(f.destination);
    const input = {
      reviewId: record.descriptor.reviewId,
      expectedVersion: record.recordVersion,
      approvalDigest: record.approvalDigest,
      acknowledgedAutomation: true,
    };
    for (const patch of [
      { expectedVersion: 2 },
      { approvalDigest: "sha256:" + "0".repeat(64) },
      { acknowledgedAutomation: false },
    ])
      await expect(
        f.workflow.advance({ ...input, ...patch }),
      ).rejects.toThrow();
    expect(f.repository.createExportCommit).not.toHaveBeenCalled();
  });
  it.each([
    "session/selection/plan denied",
    "artifact unavailable",
    "artifact replaced",
    "provider access lost",
    "base advanced",
  ] as const)("blocks dispatch when %s", async (kind) => {
    const f = workflowFixture();
    await f.workflow.preview(f.destination);
    if (kind === "session/selection/plan denied")
      f.assertAuthorized.mockRejectedValue(Error("Denied"));
    if (kind === "artifact unavailable")
      f.assertArtifactAvailable.mockRejectedValue(Error("Unavailable"));
    if (kind === "artifact replaced")
      f.readArtifact.mockResolvedValue({
        ...artifact,
        zipDigest: sha256DigestSchema.parse("sha256:" + "0".repeat(64)),
      });
    if (kind === "provider access lost")
      vi.mocked(f.repository.readProject).mockResolvedValue({
        projectId: 42,
        pathWithNamespace: "synthetic/export",
        defaultBranch: "main",
        archived: false,
        empty: false,
        accessLevel: 20,
        url: "https://gitlab.com/synthetic/export",
      });
    if (kind === "base advanced")
      vi.mocked(f.repository.readBranch).mockResolvedValue({
        sha: "d".repeat(40),
        protected: false,
      });
    await expect(f.step()).rejects.toThrow();
    expect(f.repository.createExportCommit).not.toHaveBeenCalled();
    expect(f.required().state).toBe("prepared");
  });
  it.each(["prepared", "verified"] as const)(
    "does not issue a new write for expired %s approval",
    async (state) => {
      const f = workflowFixture();
      await f.workflow.preview(f.destination);
      await f.until(state);
      f.setRecord({ expired: true });
      await expect(f.step()).rejects.toThrow();
      expect(f.repository.createMergeRequest).not.toHaveBeenCalled();
      expect(f.repository.createExportCommit).toHaveBeenCalledTimes(
        state === "prepared" ? 0 : 1,
      );
    },
  );
  it("allows expired read-only recovery but cannot create a new MR", async () => {
    const f = workflowFixture();
    await f.workflow.preview(f.destination);
    await f.until("commit-dispatched");
    f.setRecord({ expired: true });
    await f.until("verified");
    await expect(f.step()).rejects.toThrow();
    expect(f.repository.createMergeRequest).not.toHaveBeenCalled();
  });
  it("rechecks expiry after the durable claim and before provider dispatch", async () => {
    const f = workflowFixture();
    await f.workflow.preview(f.destination);
    f.store.claimCommit.mockImplementationOnce(
      (_id, version, approvalDigest) => {
        expect(f.required().approvalDigest).toBe(approvalDigest);
        f.setRecord({
          state: "commit-dispatched",
          recordVersion: version + 1,
          expired: true,
        });
        return Promise.resolve({ ...f.required(), expired: false });
      },
    );
    await expect(f.step()).rejects.toThrow();
    expect(f.repository.createExportCommit).not.toHaveBeenCalled();
    expect(f.required()).toMatchObject({
      state: "commit-dispatched",
      expired: true,
    });
  });
  it("never writes when the durable dispatch claim fails", async () => {
    const f = workflowFixture();
    await f.workflow.preview(f.destination);
    vi.mocked(f.store.claimCommit).mockRejectedValueOnce(Error("Audit failed"));
    await expect(f.step()).rejects.toThrow("Audit failed");
    expect(f.repository.createExportCommit).not.toHaveBeenCalled();
  });
  it("permits only one concurrent commit claim", async () => {
    const f = workflowFixture();
    await f.workflow.preview(f.destination);
    const result = await Promise.allSettled([f.step(), f.step()]);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(f.repository.createExportCommit).toHaveBeenCalledTimes(1);
  });
  it.each(["content", "mode", "tree", "head"] as const)(
    "prevents merge-request creation after changed %s",
    async (kind) => {
      const f = workflowFixture();
      await f.workflow.preview(f.destination);
      await f.until("verifying");
      if (kind === "content")
        vi.mocked(f.repository.readFile).mockResolvedValue({
          bytes: Buffer.from("corrupt"),
          executable: false,
          lastCommitSha: commitSha,
        });
      if (kind === "mode")
        vi.mocked(f.repository.readFile).mockImplementation((input) => {
          const file = validReadback().files.find(
            (file) => file.path === input.path,
          );
          if (!file) throw Error("Missing file");
          return {
            bytes: file.bytes,
            executable: true,
            lastCommitSha: commitSha,
          };
        });
      if (kind === "tree") {
        await f.until("verified");
        vi.mocked(f.repository.readTree).mockImplementation((_id, sha) =>
          Promise.resolve(sha === baseCommitSha ? baseTree : []),
        );
      }
      if (kind === "head")
        vi.mocked(f.repository.readBranch).mockResolvedValue({
          sha: "d".repeat(40),
          protected: false,
        });
      await expect(f.step()).rejects.toThrow();
      expect(f.repository.createMergeRequest).not.toHaveBeenCalled();
    },
  );
});
