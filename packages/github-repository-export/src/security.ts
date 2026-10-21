import { createHash } from "node:crypto";

import {
  serializeCanonicalJson,
  sha256DigestSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import type {
  SolutionExportArtifactV1,
  SolutionExportFileV1,
} from "@cloudmarkup/solution-export";

import {
  GITHUB_REPOSITORY_EXPORT_LIMITS,
  gitHubDestinationFolderSchema,
} from "./contracts.js";
import { GitHubExportError } from "./errors.js";

const WORKFLOW_PREFIX = ".github/workflows/";
const REQUIRED_PACKAGE_PATHS = [
  "README.md",
  "cloudmarkup/architecture.json",
  "cloudmarkup/cloudmarkup.lock.json",
  "cloudmarkup/external-resources.json",
  "cloudmarkup/cloudmarkup.manifest.json",
  "cloudmarkup/solution.json",
  "cloudmarkup/workloads.json",
] as const;

export function sha256Digest(value: Uint8Array | string): Sha256Digest {
  return sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(value).digest("hex")}`,
  );
}

export function canonicalDigest(value: unknown): Sha256Digest {
  return sha256Digest(serializeCanonicalJson(value));
}

export function isWorkflowPath(path: string): boolean {
  return (
    path.startsWith(WORKFLOW_PREFIX) && path.length > WORKFLOW_PREFIX.length
  );
}

export function destinationPath(
  packagePath: string,
  destinationFolder: string,
): string {
  const folder = gitHubDestinationFolderSchema.parse(destinationFolder);
  if (isWorkflowPath(packagePath)) return packagePath;
  return folder === "" ? packagePath : `${folder}/${packagePath}`;
}

export function validateFeatureBranch(
  branch: string,
  defaultBranch: string,
): void {
  if (branch === defaultBranch) {
    throw new GitHubExportError("destination-invalid");
  }
  if (branch.startsWith("refs/") || branch.toLowerCase() === "head") {
    throw new GitHubExportError("destination-invalid");
  }
}

export function inspectApprovedPackage(
  artifact: SolutionExportArtifactV1,
): readonly {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}[] {
  const issues: { code: string; message: string; path?: string }[] = [];
  const paths = new Set(artifact.files.map(({ path }) => path));
  for (const path of REQUIRED_PACKAGE_PATHS) {
    if (!paths.has(path)) {
      issues.push({
        code: "required-package-file-missing",
        message: "The approved Solution package is missing a required file.",
        path,
      });
    }
  }
  if (![...paths].some((path) => path.startsWith("infrastructure/"))) {
    issues.push({
      code: "infrastructure-files-missing",
      message:
        "The approved Solution package has no generated infrastructure files.",
    });
  }
  if (
    artifact.manifest.application !== null &&
    !paths.has("application/manifest.json")
  ) {
    issues.push({
      code: "application-manifest-missing",
      message:
        "Supported generated application source requires its package manifest.",
      path: "application/manifest.json",
    });
  }
  if (artifact.manifest.diagram !== null) {
    const diagramPaths = artifact.manifest.diagram.files.map(
      ({ path }) => path,
    );
    for (const path of diagramPaths) {
      if (!paths.has(path)) {
        issues.push({
          code: "diagram-source-mismatch",
          message: "Diagram metadata and approved package bytes do not match.",
          path,
        });
      }
    }
  }
  for (const file of artifact.files) {
    if (file.bytes.byteLength > GITHUB_REPOSITORY_EXPORT_LIMITS.fileBytes) {
      issues.push({
        code: "file-too-large",
        message: "A package file exceeds the GitHub export byte limit.",
        path: file.path,
      });
    }
    if (file.mediaType === "text/markdown") {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
      if (/\]\((?:https?:\/\/|\/)[^)]*diagram\//i.test(text)) {
        issues.push({
          code: "diagram-path-not-relative",
          message:
            "Documentation must reference exported diagrams with relative paths.",
          path: file.path,
        });
      }
    }
  }
  return issues;
}

export function isLikelyBinary(
  file: SolutionExportFileV1 | { readonly bytes: Uint8Array },
): boolean {
  const sample = file.bytes.subarray(0, Math.min(file.bytes.byteLength, 8_192));
  return sample.includes(0);
}

export interface GitHubRepositoryTreePathMetadata {
  readonly mode: string;
  readonly path: string;
  readonly type: "blob" | "commit" | "tree";
}

function portablePath(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function properPathAncestors(path: string): readonly string[] {
  const segments = path.split("/");
  const ancestors: string[] = [];
  for (let length = 1; length < segments.length; length += 1) {
    ancestors.push(segments.slice(0, length).join("/"));
  }
  return ancestors;
}

function rememberPortablePath(paths: Map<string, string>, path: string): void {
  const key = portablePath(path);
  const previous = paths.get(key);
  if (previous !== undefined && previous !== path) {
    throw new GitHubExportError("destination-invalid");
  }
  paths.set(key, path);
}

/**
 * Checks full recursive tree metadata before any affected blob bytes are read.
 * Candidate and reviewed-workflow paths are regular files; their ancestors are
 * directories. Unrelated repository trees remain outside the content scope.
 */
export function assertGitHubRepositoryTreePathSafety(input: {
  readonly candidatePaths: readonly string[];
  readonly destinationFolder: string;
  readonly entries: readonly GitHubRepositoryTreePathMetadata[];
  readonly workflowPaths: readonly string[];
}): void {
  const targetPaths = [
    ...new Set([...input.candidatePaths, ...input.workflowPaths]),
  ];
  const portableTargets = new Map<string, string>();
  const portableTargetAncestors = new Map<string, string>();
  for (const target of targetPaths) {
    rememberPortablePath(portableTargets, target);
    for (const ancestor of properPathAncestors(target)) {
      rememberPortablePath(portableTargetAncestors, ancestor);
    }
  }
  for (const target of targetPaths) {
    for (const ancestor of properPathAncestors(target)) {
      const portableTarget = portableTargets.get(portablePath(ancestor));
      if (portableTarget !== undefined) {
        if (portableTarget !== ancestor) {
          throw new GitHubExportError("destination-invalid");
        }
        throw new GitHubExportError("path-conflict");
      }
    }
  }

  const destinationPrefixes = new Map<string, string>();
  if (input.destinationFolder !== "") {
    for (const prefix of [
      ...properPathAncestors(input.destinationFolder),
      input.destinationFolder,
    ]) {
      rememberPortablePath(destinationPrefixes, prefix);
    }
  }

  const affectedPortablePaths = new Map<string, string>();
  for (const entry of input.entries) {
    const entryPortable = portablePath(entry.path);
    const entryAncestors = properPathAncestors(entry.path);
    let affected = input.destinationFolder === "";

    if (input.destinationFolder !== "") {
      const destinationPrefix = `${input.destinationFolder}/`;
      const portableDestinationPrefix = `${portablePath(input.destinationFolder)}/`;
      if (
        entry.path === input.destinationFolder ||
        entry.path.startsWith(destinationPrefix) ||
        entryPortable === portablePath(input.destinationFolder) ||
        entryPortable.startsWith(portableDestinationPrefix)
      ) {
        affected = true;
      }
      for (const prefix of [...entryAncestors, entry.path]) {
        const expected = destinationPrefixes.get(portablePath(prefix));
        if (expected !== undefined && expected !== prefix) {
          throw new GitHubExportError("destination-invalid");
        }
      }
      if (
        (entry.path === input.destinationFolder ||
          input.destinationFolder.startsWith(`${entry.path}/`)) &&
        entry.type !== "tree"
      ) {
        throw new GitHubExportError("path-conflict");
      }
    }

    const portableTarget = portableTargets.get(entryPortable);
    if (portableTarget !== undefined) {
      affected = true;
      if (portableTarget !== entry.path) {
        throw new GitHubExportError("destination-invalid");
      }
      if (entry.type !== "blob") {
        throw new GitHubExportError("path-conflict");
      }
    }

    const portableTargetAncestor = portableTargetAncestors.get(entryPortable);
    if (portableTargetAncestor !== undefined) {
      affected = true;
      if (portableTargetAncestor !== entry.path) {
        throw new GitHubExportError("destination-invalid");
      }
      if (entry.type !== "tree") {
        throw new GitHubExportError("path-conflict");
      }
    }

    for (const ancestor of entryAncestors) {
      const portableAncestor = portablePath(ancestor);
      const targetAtAncestor = portableTargets.get(portableAncestor);
      if (targetAtAncestor !== undefined) {
        affected = true;
        if (targetAtAncestor !== ancestor) {
          throw new GitHubExportError("destination-invalid");
        }
        throw new GitHubExportError("path-conflict");
      }
      const expectedAncestor = portableTargetAncestors.get(portableAncestor);
      if (expectedAncestor !== undefined) {
        affected = true;
        if (expectedAncestor !== ancestor) {
          throw new GitHubExportError("destination-invalid");
        }
      }
    }

    if (affected) {
      const previous = affectedPortablePaths.get(entryPortable);
      if (previous !== undefined && previous !== entry.path) {
        throw new GitHubExportError("destination-invalid");
      }
      affectedPortablePaths.set(entryPortable, entry.path);
    }
  }
}

export function assertNoCaseFoldCollisions(paths: readonly string[]): void {
  const seen = new Set<string>();
  for (const path of paths) {
    const key = path.normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new GitHubExportError("destination-invalid");
    seen.add(key);
  }
}
