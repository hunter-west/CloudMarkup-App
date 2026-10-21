import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareMemoryApplicationImage } from "./prepare-memory-application-image.mjs";
const base = "cloudmarkup-application-build@sha256:" + "a".repeat(64);

test("actual helper bundle starts and emits only closed invalid-input metadata", async () => {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const cache = resolve(root, ".cache");
  await mkdir(cache, { recursive: true });
  const owned = await mkdtemp(resolve(cache, "memory-helper-diagnostic-test-"));
  assert.ok(owned.startsWith(cache + sep));
  try {
    const output = resolve(owned, "context");
    await prepareMemoryApplicationImage({
      repositoryRoot: root,
      output,
      baseImage: base,
    });
    const executable = resolve(output, "memory-workspace-v1.mjs");
    const common = {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 65536,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      windowsHide: true,
    };
    assert.equal(
      execFileSync(process.execPath, [executable, "hold", "1000"], common),
      "",
    );
    let failure;
    try {
      execFileSync(process.execPath, [executable, "probe"], {
        ...common,
        input: "PRIVATE_INVALID_JSON",
      });
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.status, 70);
    assert.equal(failure?.stdout, "");
    assert.equal(failure?.stderr, "memory-workspace-failure:input\n");
  } finally {
    assert.ok(owned.startsWith(cache + sep));
    await rm(owned, { recursive: true, force: true });
  }
});
