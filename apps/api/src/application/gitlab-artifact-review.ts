import { createHash } from "node:crypto";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import {
  verifySolutionExportArtifact,
  type SolutionExportArtifactV1,
} from "@cloudmarkup/solution-export";
import { z } from "zod";
import type {
  GitLabCommit,
  GitLabFileChange,
  GitLabTreeEntry,
} from "../adapters/gitlab-repository.js";
import { ApplicationError } from "./errors.js";

const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const branch = z.string().regex(/^cloudmarkup\/export-[a-f0-9]{32}$/u);
const portablePath = z
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
const treeSchema = z
  .array(
    z
      .object({
        path: z
          .string()
          .min(1)
          .max(4096)
          .refine(
            (value) =>
              !value.includes("\0") &&
              value
                .split("/")
                .every((part) => part !== "" && part !== "." && part !== ".."),
          ),
        objectId: sha,
        type: z.enum(["blob", "tree", "commit"]),
        mode: z.enum(["100644", "100755", "120000", "040000", "160000"]),
      })
      .strict(),
  )
  .max(20000);
function fail(message: string): never {
  throw new ApplicationError("conflict", message);
}
const digest = (value: Uint8Array | string) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
const parent = (path: string) =>
  path.slice(0, Math.max(0, path.lastIndexOf("/")));
const name = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const folded = (path: string) => path.normalize("NFC").toLowerCase();
const sortPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
function gitObject(kind: "blob" | "tree", bytes: Uint8Array): string {
  return createHash("sha1")
    .update(kind + " " + String(bytes.length) + "\0")
    .update(bytes)
    .digest("hex");
}
/** Complete recursive trees must contain each directory, exactly once, with consistent object modes. */
function inspectTree(
  input: readonly GitLabTreeEntry[],
): Map<string, GitLabTreeEntry> {
  const result = treeSchema.safeParse(input);
  if (!result.success)
    fail("The GitLab repository tree could not be verified.");
  const map = new Map<string, GitLabTreeEntry>();
  for (const entry of result.data) {
    if (
      map.has(entry.path) ||
      (entry.type === "tree"
        ? entry.mode !== "040000"
        : entry.type === "commit"
          ? entry.mode !== "160000"
          : !["100644", "100755", "120000"].includes(entry.mode))
    )
      fail("The GitLab repository tree could not be verified.");
    map.set(entry.path, entry);
  }
  for (const entry of map.values())
    if (parent(entry.path) && map.get(parent(entry.path))?.type !== "tree")
      fail("The GitLab repository tree is incomplete.");
  return map;
}
/** Git orders directory entries as if their names end in a slash. No repository file is executed. */
function treeHashes(map: Map<string, GitLabTreeEntry>): Map<string, string> {
  const children = new Map<string, GitLabTreeEntry[]>();
  for (const entry of map.values()) {
    const key = parent(entry.path),
      items = children.get(key) ?? [];
    items.push(entry);
    children.set(key, items);
  }
  const hashes = new Map<string, string>();
  const directories = [
    "",
    ...Array.from(map.values())
      .filter((entry) => entry.type === "tree")
      .map((entry) => entry.path),
  ].sort(
    (a, b) => b.split("/").length - a.split("/").length || b.length - a.length,
  );
  for (const directory of directories) {
    const entries = [...(children.get(directory) ?? [])].sort((a, b) =>
      Buffer.compare(
        Buffer.from(name(a.path) + (a.type === "tree" ? "/" : "")),
        Buffer.from(name(b.path) + (b.type === "tree" ? "/" : "")),
      ),
    );
    const bytes = Buffer.concat(
      entries.map((entry) => {
        const objectId =
          entry.type === "tree" ? hashes.get(entry.path) : entry.objectId;
        if (!objectId) fail("The GitLab repository tree is incomplete.");
        return Buffer.concat([
          Buffer.from(
            (entry.type === "tree" ? "40000" : entry.mode) +
              " " +
              name(entry.path) +
              "\0",
          ),
          Buffer.from(objectId, "hex"),
        ]);
      }),
    );
    hashes.set(directory, gitObject("tree", bytes));
  }
  return hashes;
}
export interface GitLabArtifactReview {
  readonly schemaVersion: 1;
  readonly baseCommitSha: string;
  readonly branch: string;
  readonly destinationFolder: string;
  readonly artifactManifestDigest: string;
  readonly artifactZipDigest: string;
  readonly baseTreeDigest: string;
  readonly expectedTreeSha: string;
  readonly reviewDigest: string;
  readonly files: readonly {
    readonly path: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly blobSha: string;
    readonly mode: "100644";
  }[];
}
/** Deterministic local preparation only. Authorization and durable approval must wrap its use. */
export function prepareGitLabArtifactReview(input: {
  readonly artifact: SolutionExportArtifactV1;
  readonly baseTree: readonly GitLabTreeEntry[];
  readonly baseCommitSha: string;
  readonly branch: string;
  readonly destinationFolder: string;
}): {
  readonly review: GitLabArtifactReview;
  readonly changes: readonly GitLabFileChange[];
} {
  if (
    !sha.safeParse(input.baseCommitSha).success ||
    !branch.safeParse(input.branch).success ||
    !portablePath.safeParse(input.destinationFolder).success
  )
    throw new ApplicationError(
      "invalid_request",
      "Choose a portable, non-empty GitLab export folder.",
    );
  if (
    input.artifact.files.length < 1 ||
    input.artifact.files.length > 512 ||
    verifySolutionExportArtifact(input.artifact).length > 0
  )
    fail("The immutable export artifact could not be verified for GitLab.");
  const base = inspectTree(input.baseTree),
    baseHashes = treeHashes(base);
  for (const entry of base.values())
    if (entry.type === "tree" && baseHashes.get(entry.path) !== entry.objectId)
      fail(
        "The GitLab repository tree content does not match its directory objects.",
      );
  const destination = folded(input.destinationFolder);
  for (const entry of base.values()) {
    const key = folded(entry.path);
    if (key === destination || key.startsWith(destination + "/"))
      fail(
        "Choose an empty export folder. Existing repository files will not be overwritten.",
      );
    if (
      destination.startsWith(key + "/") &&
      (entry.type !== "tree" ||
        !input.destinationFolder.startsWith(entry.path + "/"))
    )
      fail("The export folder conflicts with an existing repository path.");
  }
  const expected = new Map(base),
    paths = new Set<string>();
  let total = 0;
  const changes: GitLabFileChange[] = [];
  const files = input.artifact.files
    .map((file) => {
      const path = input.destinationFolder + "/" + file.path;
      if (
        !portablePath.safeParse(path).success ||
        file.bytes.length > 1048576 ||
        (total += file.bytes.length) > 2097152
      )
        fail(
          "GitLab exports support at most 512 portable files, 1 MiB per file and 2 MiB in total.",
        );
      const key = folded(path);
      if (
        paths.has(key) ||
        [...paths].some(
          (other) => key.startsWith(other + "/") || other.startsWith(key + "/"),
        )
      )
        fail("The export contains conflicting file paths.");
      paths.add(key);
      const bytes = Uint8Array.from(file.bytes),
        blobSha = gitObject("blob", bytes);
      changes.push({ action: "create", path, bytes, executable: false });
      expected.set(path, {
        path,
        type: "blob",
        mode: "100644",
        objectId: blobSha,
      });
      for (
        let directory = parent(path);
        directory;
        directory = parent(directory)
      )
        if (!expected.has(directory))
          expected.set(directory, {
            path: directory,
            type: "tree",
            mode: "040000",
            objectId: "0".repeat(40),
          });
      return {
        path,
        sizeBytes: bytes.length,
        sha256: digest(bytes),
        blobSha,
        mode: "100644" as const,
      };
    })
    .sort(sortPath);
  if (expected.size > 20000)
    fail("The resulting GitLab repository exceeds the supported tree limit.");
  const review = {
    schemaVersion: 1 as const,
    baseCommitSha: input.baseCommitSha,
    branch: input.branch,
    destinationFolder: input.destinationFolder,
    artifactManifestDigest: input.artifact.manifestDigest,
    artifactZipDigest: input.artifact.zipDigest,
    baseTreeDigest: digest(
      serializeCanonicalJson([...base.values()].sort(sortPath)),
    ),
    expectedTreeSha: treeHashes(expected).get("") ?? "",
    files,
  };
  return {
    review: { ...review, reviewDigest: digest(serializeCanonicalJson(review)) },
    changes: changes.sort(sortPath),
  };
}

function assertReview(review: GitLabArtifactReview): void {
  const { reviewDigest, ...body } = review;
  if (digest(serializeCanonicalJson(body)) !== reviewDigest)
    fail("The GitLab export commit does not match its approved review.");
}
export interface GitLabExportedFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly executable: boolean;
}
/** Verify the full immutable commit/tree before starting or finishing bounded file readback. */
export function verifyGitLabArtifactCommitStructure(input: {
  readonly review: GitLabArtifactReview;
  readonly commit: GitLabCommit;
  readonly branchHeadSha: string;
  readonly tree: readonly GitLabTreeEntry[];
}): void {
  const { review } = input;
  assertReview(review);
  if (
    !sha.safeParse(input.commit.sha).success ||
    input.commit.sha !== input.branchHeadSha ||
    input.commit.parents.length !== 1 ||
    input.commit.parents[0] !== review.baseCommitSha ||
    input.commit.message !==
      "Cloud Markup export " +
        review.branch.slice("cloudmarkup/export-".length) +
        "\n\n[skip ci]\n"
  )
    fail("The GitLab export commit does not match its approved review.");
  const tree = inspectTree(input.tree),
    hashes = treeHashes(tree);
  if (
    hashes.get("") !== review.expectedTreeSha ||
    [...tree.values()].some(
      (entry) =>
        entry.type === "tree" && hashes.get(entry.path) !== entry.objectId,
    )
  )
    fail("The GitLab export changed unexpected files or file modes.");
  for (const approved of review.files) {
    const entry = tree.get(approved.path);
    if (
      entry?.type !== "blob" ||
      entry.mode !== "100644" ||
      entry.objectId !== approved.blobSha
    )
      fail("The GitLab exported content does not match the approved artifact.");
  }
}
/** Each batch proves the next contiguous 1..16 files. Only durable compare-and-swap may advance its offset. */
export function verifyGitLabArtifactFileBatch(input: {
  readonly review: GitLabArtifactReview;
  readonly offset: number;
  readonly files: readonly GitLabExportedFile[];
}): void {
  const { review, files, offset } = input;
  assertReview(review);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    files.length < 1 ||
    files.length > 16 ||
    offset + files.length > review.files.length ||
    new Set(files.map((file) => file.path)).size !== files.length
  )
    fail("The GitLab exported files could not be completely verified.");
  const actualFiles = new Map(files.map((file) => [file.path, file]));
  for (const approved of review.files.slice(offset, offset + files.length)) {
    const actual = actualFiles.get(approved.path);
    if (
      !actual ||
      actual.executable ||
      actual.bytes.length !== approved.sizeBytes ||
      digest(actual.bytes) !== approved.sha256 ||
      gitObject("blob", actual.bytes) !== approved.blobSha
    )
      fail("The GitLab exported content does not match the approved artifact.");
  }
}
/** Complete proof convenience; the resumable workflow stores only individually verified contiguous batches. */
export function verifyGitLabArtifactCommit(
  input: Parameters<typeof verifyGitLabArtifactCommitStructure>[0] & {
    readonly files: readonly GitLabExportedFile[];
  },
): void {
  verifyGitLabArtifactCommitStructure(input);
  if (
    input.files.length !== input.review.files.length ||
    new Set(input.files.map((file) => file.path)).size !== input.files.length
  )
    fail("The GitLab exported files could not be completely verified.");
  const files = new Map(input.files.map((file) => [file.path, file]));
  const ordered = input.review.files.map((approved) => {
    const file = files.get(approved.path);
    if (!file)
      fail("The GitLab exported content does not match the approved artifact.");
    return file;
  });
  for (let offset = 0; offset < ordered.length; offset += 16)
    verifyGitLabArtifactFileBatch({
      review: input.review,
      offset,
      files: ordered.slice(offset, offset + 16),
    });
}
