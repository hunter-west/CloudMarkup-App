import { utf8ByteLength } from "./security.js";

export interface UnifiedPatchLimits {
  readonly maximumHunks: number;
  readonly maximumOutputBytes: number;
}

const hunkHeaderPattern =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u;

function splitCanonicalLines(value: string): {
  readonly lines: readonly string[];
  readonly trailingNewline: boolean;
} {
  if (value.includes("\r")) {
    throw new Error("Unified patches and bases must use LF line endings.");
  }
  if (value.length === 0) return { lines: [], trailingNewline: false };
  const trailingNewline = value.endsWith("\n");
  const lines = value.split("\n");
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

function exactHeaderPath(header: string, prefix: "---" | "+++"): string {
  const marker = `${prefix} `;
  if (!header.startsWith(marker)) {
    throw new Error("Unified patch headers are missing or malformed.");
  }
  const value = header.slice(marker.length);
  if (value.includes("\t") || value.length === 0 || value === "/dev/null") {
    throw new Error("Unified patch headers must name one exact owned file.");
  }
  return value.startsWith("a/") || value.startsWith("b/")
    ? value.slice(2)
    : value;
}

export function applyExactUnifiedPatch(input: {
  readonly baseContent: string;
  readonly limits: UnifiedPatchLimits;
  readonly path: string;
  readonly unifiedDiff: string;
}): string {
  const base = splitCanonicalLines(input.baseContent);
  const patch = splitCanonicalLines(input.unifiedDiff);
  if (patch.lines.length < 3) {
    throw new Error("Unified patches require exact file headers and a hunk.");
  }
  const oldPath = exactHeaderPath(patch.lines[0] ?? "", "---");
  const newPath = exactHeaderPath(patch.lines[1] ?? "", "+++");
  if (oldPath !== input.path || newPath !== input.path) {
    throw new Error("Unified patch headers must match the exact owned path.");
  }

  const output: string[] = [];
  let sourceCursor = 0;
  let patchCursor = 2;
  let hunkCount = 0;
  while (patchCursor < patch.lines.length) {
    const header = patch.lines[patchCursor] ?? "";
    const match = hunkHeaderPattern.exec(header);
    if (match === null) {
      throw new Error("Unified patches may contain only bounded valid hunks.");
    }
    hunkCount += 1;
    if (hunkCount > input.limits.maximumHunks) {
      throw new Error("Unified patch exceeds the approved hunk limit.");
    }
    const oldStart = Number(match[1]);
    const oldCount = Number(match[2] ?? "1");
    const newCount = Number(match[4] ?? "1");
    const hunkSourceIndex = oldStart === 0 ? 0 : oldStart - 1;
    if (
      !Number.isSafeInteger(oldStart) ||
      !Number.isSafeInteger(oldCount) ||
      !Number.isSafeInteger(newCount) ||
      oldCount < 0 ||
      newCount < 0 ||
      hunkSourceIndex < sourceCursor ||
      hunkSourceIndex > base.lines.length
    ) {
      throw new Error("Unified patch hunks are out of range or overlap.");
    }
    output.push(...base.lines.slice(sourceCursor, hunkSourceIndex));
    sourceCursor = hunkSourceIndex;
    patchCursor += 1;

    let consumedOld = 0;
    let producedNew = 0;
    let operationCount = 0;
    while (
      patchCursor < patch.lines.length &&
      !hunkHeaderPattern.test(patch.lines[patchCursor] ?? "")
    ) {
      const line = patch.lines[patchCursor] ?? "";
      const operation = line[0];
      const text = line.slice(1);
      if (operation === "\\") {
        throw new Error("Changing final-newline state is not supported.");
      }
      if (operation !== " " && operation !== "+" && operation !== "-") {
        throw new Error("Unified patch hunks contain an invalid operation.");
      }
      operationCount += 1;
      if (operation === " " || operation === "-") {
        if (base.lines[sourceCursor] !== text) {
          throw new Error(
            "Unified patch context does not match the exact base.",
          );
        }
        sourceCursor += 1;
        consumedOld += 1;
      }
      if (operation === " " || operation === "+") {
        output.push(text);
        producedNew += 1;
      }
      patchCursor += 1;
    }
    if (
      operationCount === 0 ||
      consumedOld !== oldCount ||
      producedNew !== newCount
    ) {
      throw new Error("Unified patch hunk counts do not match its operations.");
    }
  }
  if (hunkCount === 0) {
    throw new Error("Unified patches require at least one bounded hunk.");
  }
  output.push(...base.lines.slice(sourceCursor));
  const result = `${output.join("\n")}${base.trailingNewline ? "\n" : ""}`;
  if (utf8ByteLength(result) > input.limits.maximumOutputBytes) {
    throw new Error("Patched candidate exceeds the approved output limit.");
  }
  return result;
}
