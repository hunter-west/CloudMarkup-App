import { createHash } from "node:crypto";

import {
  applicationRepositoryPathV1Schema,
  sha256DigestSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import type {
  ApplicationBuildDiagnosticV1,
  ApplicationBuildReferenceV1,
  ApplicationBuildSourceFileV1,
} from "./contracts.js";

const encoder = new TextEncoder();
const forbiddenPathSegments = new Set([
  ".aws",
  ".cache",
  ".env",
  ".git",
  ".pnpm-store",
  ".terraform",
  "coverage",
  "node_modules",
]);
const forbiddenPackageManagerFiles = new Set([
  ".npmrc",
  ".pnpmfile.cjs",
  ".yarnrc",
  ".yarnrc.yml",
  "pnpm-workspace.yaml",
]);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/u,
  /\b(?:sk_(?:live|test)_|whsec_)[A-Za-z0-9_]{8,}\b/u,
] as const;
const localPathPatterns = [
  /(?:^|[\s"'])\/[Uu]sers\//u,
  /(?:^|[\s"'])[A-Za-z]:\\(?:Users|Documents|Windows)\\/u,
  /(?:^|[\s"'])\/(?:home|tmp|var\/tmp)\//u,
] as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareUtf16(left, right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), undefined, 2)}\n`;
}

export function compareUtf16(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function sha256Digest(value: string | Uint8Array): Sha256Digest {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  );
}

export function utf8Bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

export function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function stripAnsiControlSequences(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value.codePointAt(index) === 27 && value[index + 1] === "[") {
      let cursor = index + 2;
      while (/[0-9;]/u.test(value[cursor] ?? "")) cursor += 1;
      if (/[A-Za-z]/u.test(value[cursor] ?? "")) {
        index = cursor;
        continue;
      }
    }
    output += value[index] ?? "";
  }
  return output;
}

export function sanitizeToolText(value: string, maximum = 2_000): string {
  const withoutAnsi = stripAnsiControlSequences(value);
  const withoutControls = Array.from(withoutAnsi)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (codePoint < 32 && character !== "\\n" && character !== "\\t") ||
        codePoint === 127
        ? " "
        : character;
    })
    .join("");
  let output = withoutControls
    .replaceAll(
      /(?:[A-Za-z]:\\|\/)(?:[^\s"']+[\\/])+[^\s"']*/gu,
      "[redacted-path]",
    )
    .replaceAll(/(?:AKIA|ASIA)[A-Z0-9]{16}/gu, "[redacted-secret]")
    .replaceAll(
      /(?:ghp_|github_pat_|sk_(?:live|test)_|whsec_)[A-Za-z0-9_]{8,}/gu,
      "[redacted-secret]",
    )
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (output.length === 0)
    output = "Build tool returned no safe diagnostic text.";
  return output.slice(0, maximum);
}

export function sourcePathIssue(path: string): string | undefined {
  const parsed = applicationRepositoryPathV1Schema.safeParse(path);
  if (!parsed.success)
    return "Source path is not repository-relative and safe.";
  const segments = path.split("/");
  if (
    segments.some((segment) => forbiddenPathSegments.has(segment.toLowerCase()))
  ) {
    return "Source path uses a forbidden environment, cache, dependency, or repository segment.";
  }
  if (
    segments.some((segment) =>
      forbiddenPackageManagerFiles.has(segment.toLowerCase()),
    )
  ) {
    return "Source path uses a forbidden package-manager configuration or hook file.";
  }
  if (/\.(?:tfstate|tfplan|map)$/iu.test(path)) {
    return "Source path uses a forbidden state, plan, or source-map extension.";
  }
  return undefined;
}

export function outputPathIssue(path: string): string | undefined {
  if (
    path.length === 0 ||
    path.length > 512 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    path.includes(String.fromCodePoint(0))
  ) {
    return "Build output path is not repository-relative and safe.";
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9@._-]+$/u.test(segment) ||
        segment.toLowerCase() === ".env" ||
        segment.toLowerCase() === ".git",
    )
  ) {
    return "Build output path uses an unsafe or forbidden segment.";
  }
  return undefined;
}

export function contentSecurityIssue(
  content: string,
): "secret" | "local-path" | undefined {
  if (secretPatterns.some((pattern) => pattern.test(content))) return "secret";
  if (localPathPatterns.some((pattern) => pattern.test(content)))
    return "local-path";
  return undefined;
}

export function referenceForFile(
  solutionRevisionId: string,
  file: ApplicationBuildSourceFileV1 | undefined,
  workloadId?: string,
): ApplicationBuildReferenceV1 {
  return {
    contractIds: [],
    operationIds: [],
    ...(file === undefined ? {} : { path: file.path }),
    solutionRevisionId,
    ...(workloadId === undefined ? {} : { workloadId }),
  };
}

export function diagnostic(input: {
  readonly code: string;
  readonly detail: string;
  readonly file?: ApplicationBuildSourceFileV1;
  readonly severity?: "error" | "warning" | "info";
  readonly solutionRevisionId: string;
  readonly source: ApplicationBuildDiagnosticV1["source"];
  readonly summary: string;
  readonly workloadId?: string;
}): ApplicationBuildDiagnosticV1 {
  return {
    code: input.code as ApplicationBuildDiagnosticV1["code"],
    detail: sanitizeToolText(input.detail),
    references: referenceForFile(
      input.solutionRevisionId,
      input.file,
      input.workloadId,
    ),
    severity: input.severity ?? "error",
    source: input.source,
    summary: sanitizeToolText(input.summary, 500),
  };
}

export function sortedDiagnostics(
  diagnostics: readonly ApplicationBuildDiagnosticV1[],
): ApplicationBuildDiagnosticV1[] {
  return [...diagnostics].sort((left, right) => {
    for (const [a, b] of [
      [left.severity, right.severity],
      [left.source, right.source],
      [left.references.path ?? "", right.references.path ?? ""],
      [left.code, right.code],
      [left.summary, right.summary],
    ] as const) {
      const order = compareUtf16(a, b);
      if (order !== 0) return order;
    }
    return 0;
  });
}
