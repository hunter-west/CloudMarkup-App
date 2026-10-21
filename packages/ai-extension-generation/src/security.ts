import { safeRelativePathSchema } from "@cloudmarkup/schemas";
import { inspectModelValueForSecretCandidatesV1 } from "@cloudmarkup/model-gateway";
import {
  digestCanonicalValue,
  portablePathKey,
  sha256Text,
  utf8ByteLength,
} from "./presentation-support.js";

const forbiddenPortableSegments = new Set([
  "aux",
  "con",
  "nul",
  "prn",
  ...Array.from({ length: 9 }, (_, index) => `com${String(index + 1)}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${String(index + 1)}`),
]);

const forbiddenApplicationSourcePatterns = [
  /\b(?:node:)?child_process\b/u,
  /\b(?:node:)?cluster\b/u,
  /\b(?:node:)?vm\b/u,
  /\b(?:node:)?worker_threads\b/u,
  /\b(?:eval|Function)\s*\(/u,
  /\b(?:exec|execFile|fork|spawn|spawnSync)\s*\(/u,
  /\bprocess\s*\.\s*(?:binding|dlopen)\s*\(/u,
] as const;

const bidiOrForbiddenControlPattern =
  // eslint-disable-next-line no-control-regex -- these exact code points are the security boundary being rejected.
  /[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;

export { digestCanonicalValue, portablePathKey, sha256Text, utf8ByteLength };

export function stableRecordId(prefix: string, value: unknown): string {
  return `${prefix}-${digestCanonicalValue(value).slice("sha256:".length, 38)}`;
}

export function validatePortableCandidatePath(pathInput: unknown): string {
  const path = safeRelativePathSchema.parse(pathInput);
  if (path !== path.normalize("NFC")) {
    throw new Error("Candidate paths must already use NFC normalization.");
  }
  if (utf8ByteLength(path) > 240) {
    throw new Error("Candidate paths exceed the approved portable byte limit.");
  }
  for (const segment of path.split("/")) {
    const basename = segment.split(".", 1)[0]?.toLowerCase() ?? "";
    if (
      segment.endsWith(".") ||
      segment.endsWith(" ") ||
      segment.includes(":") ||
      forbiddenPortableSegments.has(basename)
    ) {
      throw new Error(
        "Candidate paths are not portable across supported hosts.",
      );
    }
  }
  return path;
}

export type CandidateContentKind =
  "application" | "terraform" | "cloudformation";

export function candidateContentSafetyDiagnostics(
  content: string,
  kind: CandidateContentKind,
): readonly string[] {
  const diagnostics: string[] = [];
  if (content.includes("\r")) {
    diagnostics.push("Candidate text must use canonical LF line endings.");
  }
  if (bidiOrForbiddenControlPattern.test(content)) {
    diagnostics.push("Candidate text contains a forbidden control character.");
  }
  const encoded = new TextEncoder().encode(content);
  if (new TextDecoder("utf-8", { fatal: true }).decode(encoded) !== content) {
    diagnostics.push("Candidate text is not canonical UTF-8.");
  }
  if (inspectModelValueForSecretCandidatesV1(content).detectedValueCount > 0) {
    diagnostics.push(
      "Candidate text contains a secret or credential candidate.",
    );
  }
  if (
    kind === "application" &&
    forbiddenApplicationSourcePatterns.some((pattern) => pattern.test(content))
  ) {
    diagnostics.push(
      "Candidate source requests forbidden process or dynamic-code authority.",
    );
  }
  return Object.freeze(diagnostics);
}

export function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    right.every((value) => leftSet.has(value))
  );
}
