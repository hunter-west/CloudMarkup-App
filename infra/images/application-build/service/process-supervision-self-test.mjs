import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";

import { reapContainerProcessesForTesting } from "./executor.mjs";

const marker = `/tmp/cloudmarkup-process-supervision-${process.pid}.txt`;

async function markerSize() {
  try {
    return (await readFile(marker)).byteLength;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function waitForMarker() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await markerSize()) >= 2) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
  throw new TypeError("Detached process did not write its bounded marker.");
}

async function main() {
  assert.equal(process.platform, "linux");
  assert.equal(
    process.pid,
    1,
    "Supervisor self-test must own container PID 1.",
  );
  await rm(marker, { force: true });
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const { appendFileSync } = require("node:fs"); setInterval(() => appendFileSync(${JSON.stringify(marker)}, "x"), 2);`,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  try {
    await waitForMarker();
    await reapContainerProcessesForTesting();
    const sealedSize = await markerSize();
    assert.ok(sealedSize >= 2);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    assert.equal(await markerSize(), sealedSize);
    process.stdout.write("process-supervision-self-test: passed\n");
  } finally {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // The supervisor already reaped the detached process.
    }
    await rm(marker, { force: true });
  }
}

await main();
