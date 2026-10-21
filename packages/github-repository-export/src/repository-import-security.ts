import { Buffer } from "node:buffer";

import { z } from "zod";

import { GitHubExportError } from "./errors.js";

export const GITHUB_REPOSITORY_IMPORT_LIMITS = Object.freeze({
  excerpts: 256,
  excerptBytes: 16 * 1_024,
  fileBytes: 8 * 1024 * 1024,
  files: 4_096,
  ignoredPaths: 128,
  pathBytes: 240,
  selectedPaths: 128,
  totalBytes: 128 * 1024 * 1024,
  treeEntries: 20_000,
});

const portableSegment = /^[A-Za-z0-9._@+-]+$/u;

export const gitHubRepositoryImportPathSchema = z
  .string()
  .min(1)
  .max(GITHUB_REPOSITORY_IMPORT_LIMITS.pathBytes)
  .refine((value) => value === value.trim(), "Outer whitespace is not allowed.")
  .refine(
    (value) => !value.startsWith("/"),
    "Path must be repository-relative.",
  )
  .refine(
    (value) => !value.endsWith("/"),
    "Path must not end with a separator.",
  )
  .refine((value) => !value.includes("\\"), "Path must use POSIX separators.")
  .refine(
    (value) => !value.includes("//"),
    "Empty path segments are not allowed.",
  )
  .refine(
    (value) => !value.includes(":"),
    "Drive and ADS syntax are not allowed.",
  )
  .refine(
    (value) => !value.includes("%"),
    "Encoded path syntax is not allowed.",
  )
  .refine((value) => !value.includes("\0"), "NUL bytes are not allowed.")
  .refine(
    (value) =>
      value === "." ||
      value
        .split("/")
        .every(
          (segment) =>
            segment !== "." &&
            segment !== ".." &&
            segment.toLowerCase() !== ".git" &&
            portableSegment.test(segment),
        ),
    "Path must contain only portable safe segments.",
  );

export type GitHubRepositoryImportIgnoredReason =
  "explicitly-ignored" | "sensitive-path" | "unsupported-file-type";

const supportedFileNames = new Set([
  "dockerfile",
  "makefile",
  "package.json",
  "serverless.yml",
  "serverless.yaml",
]);
const supportedExtensions = [
  ".cfn.json",
  ".cfn.yaml",
  ".cfn.yml",
  ".tf",
  ".tf.json",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".java",
  ".kt",
  ".kts",
  ".cs",
  ".rs",
  ".rb",
  ".php",
  ".swift",
  ".md",
];
const sensitiveFilePattern =
  /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx)|terraform\.tfstate(?:\.backup)?)$/iu;
const ignoredDirectoryPattern =
  /(?:^|\/)(?:\.git|node_modules|vendor|dist|build|coverage|\.terraform|\.next|\.cache)(?:\/|$)/iu;

function isWithin(path: string, selected: string): boolean {
  return (
    selected === "." || path === selected || path.startsWith(`${selected}/`)
  );
}

export function classifyGitHubRepositoryImportPath(input: {
  readonly ignoredPaths: readonly string[];
  readonly path: string;
  readonly selectedPaths: readonly string[];
}): "selected" | GitHubRepositoryImportIgnoredReason | "outside-scope" {
  const path = gitHubRepositoryImportPathSchema.parse(input.path);
  const selected = input.selectedPaths.map((candidate) =>
    gitHubRepositoryImportPathSchema.parse(candidate),
  );
  const ignored = input.ignoredPaths.map((candidate) =>
    gitHubRepositoryImportPathSchema.parse(candidate),
  );
  if (!selected.some((candidate) => isWithin(path, candidate))) {
    return "outside-scope";
  }
  if (ignored.some((candidate) => isWithin(path, candidate))) {
    return "explicitly-ignored";
  }
  if (ignoredDirectoryPattern.test(path) || sensitiveFilePattern.test(path)) {
    return "sensitive-path";
  }
  const lower = path.toLowerCase();
  const basename = lower.slice(lower.lastIndexOf("/") + 1);
  if (
    !supportedFileNames.has(basename) &&
    !supportedExtensions.some((extension) => lower.endsWith(extension))
  ) {
    return "unsupported-file-type";
  }
  return "selected";
}

export function assertGitHubRepositoryImportScope(input: {
  readonly ignoredPaths: readonly string[];
  readonly selectedPaths: readonly string[];
}): void {
  if (
    input.selectedPaths.length === 0 ||
    input.selectedPaths.length >
      GITHUB_REPOSITORY_IMPORT_LIMITS.selectedPaths ||
    input.ignoredPaths.length > GITHUB_REPOSITORY_IMPORT_LIMITS.ignoredPaths
  ) {
    throw new GitHubExportError("invalid-request");
  }
  const parsePath = (path: string): string => {
    const parsed = gitHubRepositoryImportPathSchema.safeParse(path);
    if (!parsed.success) {
      throw new GitHubExportError("import-blocked");
    }
    return parsed.data;
  };
  const selected = input.selectedPaths.map(parsePath);
  const ignored = input.ignoredPaths.map(parsePath);
  const portable = new Map<string, string>();
  for (const path of [...selected, ...ignored]) {
    const key = path.normalize("NFC").toLowerCase();
    const existing = portable.get(key);
    if (existing !== undefined && existing !== path) {
      throw new GitHubExportError("import-blocked");
    }
    portable.set(key, path);
  }
}

const secretAssignment =
  /\b(?:api[_-]?key|access[_-]?key|client[_-]?secret|password|private[_-]?key|secret|token)\b\s*[:=]\s*(?:["']?)[^\s,"'}]+/giu;
const bearerToken = /\b(?:Bearer\s+)[A-Za-z0-9._~+/-]{12,}={0,2}/giu;
const privateKey =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu;

export function sanitizeRepositorySourceText(bytes: Uint8Array): {
  readonly content: string;
  readonly redacted: boolean;
} {
  if (bytes.byteLength > GITHUB_REPOSITORY_IMPORT_LIMITS.excerptBytes) {
    throw new GitHubExportError("import-blocked");
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GitHubExportError("import-blocked");
  }
  if (content.includes("\0")) throw new GitHubExportError("import-blocked");
  const redacted = content
    .replace(privateKey, "[REDACTED_PRIVATE_KEY]")
    .replace(bearerToken, "Bearer [REDACTED]")
    .replace(secretAssignment, (match) => {
      const separator = match.includes(":") ? ":" : "=";
      const key = match.slice(0, match.indexOf(separator)).trim();
      return `${key}${separator}[REDACTED]`;
    });
  if (
    Buffer.byteLength(redacted, "utf8") >
    GITHUB_REPOSITORY_IMPORT_LIMITS.excerptBytes
  ) {
    throw new GitHubExportError("import-blocked");
  }
  return { content: redacted, redacted: redacted !== content };
}

export function isApplicationSourcePath(path: string): boolean {
  const lower = path.toLowerCase();
  return [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".java",
    ".kt",
    ".kts",
    ".cs",
    ".rs",
    ".rb",
    ".php",
    ".swift",
  ].some((extension) => lower.endsWith(extension));
}
