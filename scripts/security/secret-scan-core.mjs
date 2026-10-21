import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

export const SECRET_SCAN_LIMITS = Object.freeze({
  maximumDepth: 64,
  // Expanded OpenAPI schemas are about 8.2 MiB; scan all bytes instead of exempting them.
  maximumFileSize: 16 * 1024 * 1024,
  maximumFiles: 100_000,
  maximumFindings: 256,
  maximumReportedSkips: 32,
});

export const SECRET_PATTERNS = Object.freeze([
  {
    label: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  },
  {
    label: "GitHub token",
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9_]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/gu,
  },
  {
    label: "private key",
    pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/gu,
  },
  {
    label: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/gu,
  },
  {
    label: "Stripe secret or restricted API key",
    pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{8,255}\b/gu,
  },
  {
    label: "Stripe webhook signing secret",
    pattern: /\bwhsec_[A-Za-z0-9]{8,255}\b/gu,
  },
]);

export const DEFAULT_IGNORED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".pnpm-store",
  ".turbo",
  "cdk.out",
  "coverage",
  "dist",
  "node_modules",
  "storybook-static",
  "tmp",
]);

export const REVIEWED_SECRET_FIXTURE_EXCEPTIONS = new Set([
  [
    "infra/platform/test/environment-config.test.ts",
    "Stripe secret or restricted API key",
    "034f3af82c34d981de4ccec2ec68fa9ea8feb379ab49286b5880682b59c64661",
  ].join("\u0000"),
  [
    "packages/model-gateway/src/model-runtime-controls.test.ts",
    "GitHub token",
    "7ec2d2a7820db632211cbc4c8d05bef6d6469b4e8da24742bcc3be1af8f28ca9",
  ].join("\u0000"),
]);

function compareUtf16(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

export function findSecretPatterns(
  text,
  path = "unknown",
  maximum = SECRET_SCAN_LIMITS.maximumFindings + 1,
) {
  const findings = [];
  const newlineOffsets = [];
  for (
    let index = text.indexOf("\n");
    index >= 0;
    index = text.indexOf("\n", index + 1)
  ) {
    newlineOffsets.push(index);
  }
  const lineAt = (offset) => {
    let low = 0;
    let high = newlineOffsets.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((newlineOffsets[middle] ?? Number.POSITIVE_INFINITY) < offset) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low + 1;
  };
  patterns: for (const { label, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const line = lineAt(match.index);
      findings.push({
        label,
        line,
        matchDigest: createHash("sha256").update(match[0]).digest("hex"),
        path,
      });
      if (findings.length >= maximum) break patterns;
    }
  }
  return findings.sort((left, right) =>
    compareUtf16(
      `${left.path}\u0000${String(left.line).padStart(12, "0")}\u0000${left.label}`,
      `${right.path}\u0000${String(right.line).padStart(12, "0")}\u0000${right.label}`,
    ),
  );
}

export async function scanSecretDirectory(
  rootInput,
  {
    ignoredDirectoryNames = DEFAULT_IGNORED_DIRECTORY_NAMES,
    limits = SECRET_SCAN_LIMITS,
    reviewedFixtureExceptions = REVIEWED_SECRET_FIXTURE_EXCEPTIONS,
  } = {},
) {
  const root = resolve(rootInput);
  const files = [];
  const skipped = [];
  let visitedEntries = 0;

  const walk = async (directory, depth) => {
    if (depth > limits.maximumDepth) {
      throw new Error(
        "Secret scan directory depth exceeds its reviewed limit.",
      );
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareUtf16(left.name, right.name));
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > limits.maximumFiles * 4) {
        throw new Error("Secret scan entry count exceeds its reviewed limit.");
      }
      if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
        continue;
      }
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
      } else if (entry.isFile()) {
        files.push(path);
        if (files.length > limits.maximumFiles) {
          throw new Error("Secret scan file count exceeds its reviewed limit.");
        }
      } else {
        skipped.push({
          path: normalizePath(root, path),
          reason: "non-regular",
        });
      }
    }
  };

  await walk(root, 0);
  const findings = [];
  const coverageErrors = [];
  let scannedFiles = 0;
  for (const path of files) {
    const displayPath = normalizePath(root, path);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      skipped.push({ path: displayPath, reason: "non-regular" });
      continue;
    }
    if (stat.size > limits.maximumFileSize) {
      coverageErrors.push({ path: displayPath, reason: "oversized" });
      continue;
    }
    const content = await readFile(path);
    if (
      content.byteLength !== stat.size ||
      content.byteLength > limits.maximumFileSize
    ) {
      coverageErrors.push({
        path: displayPath,
        reason: "changed-or-oversized",
      });
      continue;
    }
    if (content.includes(0)) {
      skipped.push({ path: displayPath, reason: "binary" });
      continue;
    }
    scannedFiles += 1;
    findings.push(
      ...findSecretPatterns(content.toString("utf8"), displayPath).filter(
        ({ label, matchDigest }) =>
          !reviewedFixtureExceptions.has(
            [displayPath, label, matchDigest].join("\u0000"),
          ),
      ),
    );
    if (findings.length > limits.maximumFindings) {
      findings.length = limits.maximumFindings;
      return {
        coverageErrors: coverageErrors.sort((left, right) =>
          compareUtf16(left.path, right.path),
        ),
        findingOverflow: true,
        findings,
        scannedFiles,
        skipped: skipped.sort((left, right) =>
          compareUtf16(left.path, right.path),
        ),
      };
    }
  }
  return {
    coverageErrors: coverageErrors.sort((left, right) =>
      compareUtf16(left.path, right.path),
    ),
    findingOverflow: false,
    findings: findings.sort((left, right) =>
      compareUtf16(
        `${left.path}\u0000${String(left.line).padStart(12, "0")}\u0000${left.label}`,
        `${right.path}\u0000${String(right.line).padStart(12, "0")}\u0000${right.label}`,
      ),
    ),
    scannedFiles,
    skipped: skipped.sort((left, right) => compareUtf16(left.path, right.path)),
  };
}

function boundedEntries(entries, maximum) {
  return {
    entries: entries.slice(0, maximum),
    omitted: Math.max(0, entries.length - maximum),
  };
}

export function formatSecretScanResult(
  result,
  maximumReportedSkips = SECRET_SCAN_LIMITS.maximumReportedSkips,
) {
  const lines = [];
  if (result.findings.length > 0) {
    lines.push("Potential secrets found:");
    for (const finding of result.findings) {
      lines.push(`${finding.path}:${String(finding.line)}: ${finding.label}`);
    }
    if (result.findingOverflow) {
      lines.push(
        "Additional findings were omitted at the reviewed reporting limit.",
      );
    }
  }
  if (result.coverageErrors.length > 0) {
    lines.push("Secret scan coverage failed closed for unscanned files:");
    const bounded = boundedEntries(result.coverageErrors, maximumReportedSkips);
    for (const entry of bounded.entries) {
      lines.push(`${entry.path}: ${entry.reason}`);
    }
    if (bounded.omitted > 0) {
      lines.push(
        `${String(bounded.omitted)} additional coverage failure(s) omitted.`,
      );
    }
  }
  if (result.skipped.length > 0) {
    lines.push("Secret scan explicitly skipped non-text inputs:");
    const bounded = boundedEntries(result.skipped, maximumReportedSkips);
    for (const entry of bounded.entries) {
      lines.push(`${entry.path}: ${entry.reason}`);
    }
    if (bounded.omitted > 0) {
      lines.push(`${String(bounded.omitted)} additional skip(s) omitted.`);
    }
  }
  if (result.findings.length === 0 && result.coverageErrors.length === 0) {
    lines.push(
      `security:secrets: no high-confidence secret patterns found in ${String(result.scannedFiles)} text file(s); ${String(result.skipped.length)} non-text input(s) were explicitly skipped.`,
    );
  }
  return `${lines.join("\n")}\n`;
}
