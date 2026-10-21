import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  formatSecretScanResult,
  scanSecretDirectory,
  SECRET_SCAN_LIMITS,
} from "./secret-scan-core.mjs";

async function withTemporaryRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-secret-scan-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("detects Stripe API and webhook secrets without retaining values", async () => {
  await withTemporaryRoot(async (root) => {
    const apiKey = ["sk", "live", "A".repeat(24)].join("_");
    const webhookSecret = ["whsec", "B".repeat(24)].join("_");
    await writeFile(join(root, "billing.txt"), `${apiKey}\n${webhookSecret}\n`);

    const result = await scanSecretDirectory(root);
    assert.deepEqual(
      result.findings.map(({ label, line, path }) => ({ label, line, path })),
      [
        {
          label: "Stripe secret or restricted API key",
          line: 1,
          path: "billing.txt",
        },
        {
          label: "Stripe webhook signing secret",
          line: 2,
          path: "billing.txt",
        },
      ],
    );
    const output = formatSecretScanResult(result);
    assert.doesNotMatch(output, new RegExp(apiKey, "u"));
    assert.doesNotMatch(output, new RegExp(webhookSecret, "u"));
  });
});

test("reports binary skips explicitly and bounds skip details", async () => {
  await withTemporaryRoot(async (root) => {
    await writeFile(join(root, "binary-a.bin"), Buffer.from([0, 1, 2]));
    await writeFile(join(root, "binary-b.bin"), Buffer.from([0, 3, 4]));
    await writeFile(join(root, "safe.txt"), "safe\n");

    const result = await scanSecretDirectory(root);
    assert.equal(result.skipped.length, 2);
    const output = formatSecretScanResult(result, 1);
    assert.match(output, /binary-a\.bin: binary/u);
    assert.match(output, /1 additional skip\(s\) omitted/u);
    assert.match(output, /1 text file\(s\)/u);
  });
});

test("fails closed and reports files beyond the configured byte bound", async () => {
  await withTemporaryRoot(async (root) => {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "large.txt"), "x".repeat(17));
    const result = await scanSecretDirectory(root, {
      limits: { ...SECRET_SCAN_LIMITS, maximumFileSize: 16 },
    });

    assert.deepEqual(result.coverageErrors, [
      { path: "nested/large.txt", reason: "oversized" },
    ]);
    assert.match(
      formatSecretScanResult(result),
      /coverage failed closed for unscanned files/u,
    );
  });
});

test("reviewed fake-secret exceptions are path, label, and content-digest bound", async () => {
  await withTemporaryRoot(async (root) => {
    const fake = ["whsec", "E".repeat(24)].join("_");
    await writeFile(join(root, "fixture.txt"), `${fake}\n`);
    const initial = await scanSecretDirectory(root);
    const finding = initial.findings[0];
    assert.ok(finding);
    const exception = new Set([
      ["fixture.txt", finding.label, finding.matchDigest].join("\u0000"),
    ]);
    const reviewed = await scanSecretDirectory(root, {
      reviewedFixtureExceptions: exception,
    });
    assert.deepEqual(reviewed.findings, []);

    await writeFile(join(root, "fixture.txt"), `${fake}changed\n`);
    const changed = await scanSecretDirectory(root, {
      reviewedFixtureExceptions: exception,
    });
    assert.equal(changed.findings.length, 1);
  });
});

test("bounds high-density findings before formatting", async () => {
  await withTemporaryRoot(async (root) => {
    const values = Array.from({ length: 300 }, (_, index) =>
      ["whsec", String(index).padStart(8, "0")].join("_"),
    );
    await writeFile(join(root, "dense.txt"), `${values.join("\n")}\n`);
    const result = await scanSecretDirectory(root);
    assert.equal(result.findings.length, SECRET_SCAN_LIMITS.maximumFindings);
    assert.equal(result.findingOverflow, true);
  });
});

test("scans secrets past eight MiB in expanded API contracts", async () => {
  await withTemporaryRoot(async (root) => {
    const fake = ["whsec", "L".repeat(24)].join("_");
    await writeFile(
      join(root, "large-contract.json"),
      " ".repeat(8 * 1024 * 1024) + "\n" + fake,
    );
    const result = await scanSecretDirectory(root);
    assert.deepEqual(result.coverageErrors, []);
    assert.equal(result.scannedFiles, 1);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].line, 2);
    assert.doesNotMatch(formatSecretScanResult(result), new RegExp(fake, "u"));
  });
});
