import assert from "node:assert/strict";
import test from "node:test";
import { betaTestInvocation, runtimeFiles } from "./run-beta-tests.mjs";

const env = {
  CLOUDMARKUP_TEST_DATABASE_URL: "postgresql://fixture@127.0.0.1/test",
};
test("beta selection cannot defer the complete real-time runtime gate", () => {
  const normal = betaTestInvocation("suite", ["--shard=2/8"], {
    ...env,
    CLOUDMARKUP_TEST_PROJECTS: '["web","ui"]',
  });
  assert.ok(normal.command.includes("--project=web"));
  assert.ok(normal.command.includes("--config=config/vitest-beta.config.mjs"));
  assert.equal(normal.command.includes("--coverage"), false);
  assert.equal(normal.env.npm_lifecycle_event, "test:beta");
  assert.equal(
    normal.env.CLOUDMARKUP_TEST_DEFER_EXTENDED_MODEL_ACCOUNTING,
    "false",
  );
  const runtime = betaTestInvocation("runtime", [], {
    ...normal.env,
    CLOUDMARKUP_TEST_DEFER_EXTENDED_MODEL_ACCOUNTING: "true",
  });
  for (const file of runtimeFiles) assert.ok(runtime.command.includes(file));
  assert.equal(
    runtime.command.some(
      (arg) =>
        arg.startsWith("--exclude") ||
        arg.startsWith("--config") ||
        arg.startsWith("--shard") ||
        arg === "--coverage",
    ),
    false,
  );
  assert.equal(
    runtime.env.CLOUDMARKUP_TEST_DEFER_EXTENDED_MODEL_ACCOUNTING,
    "false",
  );
});
test("scheduled coverage ignores impact selection and binds each report", () => {
  const coverage = betaTestInvocation("coverage", ["--shard=8/8"], {
    ...env,
    CLOUDMARKUP_TEST_PROJECTS: '["web"]',
  });
  assert.ok(coverage.command.includes("--coverage"));
  assert.ok(
    coverage.command.includes(
      "--outputFile.blob=.cache/vitest-shards/report-8.json",
    ),
  );
  assert.equal(
    coverage.command.some((arg) => arg.startsWith("--project=")),
    false,
  );
  assert.equal(coverage.env.npm_lifecycle_event, "test:coverage");
});
test("missing database, malformed selection and arbitrary filters fail closed", () => {
  for (const projects of ["null", '["web","web"]', '["--exclude=api"]', "{}"])
    assert.throws(() =>
      betaTestInvocation("suite", [], {
        ...env,
        CLOUDMARKUP_TEST_PROJECTS: projects,
      }),
    );
  assert.throws(() => betaTestInvocation("suite", [], {}));
  for (const args of [
    ["--shard=9/8"],
    ["--exclude=api"],
    ["--shard=1/8", "--shard=2/8"],
  ])
    assert.throws(() => betaTestInvocation("suite", args, env));
  assert.throws(() => betaTestInvocation("runtime", ["--shard=1/8"], env));
});

test("the CLI propagates a runner failure and refuses missing runners or fixtures", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtemp, mkdir, writeFile, unlink, rm } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { dirname, resolve } = await import("node:path");
  const directory = await mkdtemp(
    resolve(tmpdir(), "cloudmarkup-beta-runner-"),
  );
  const entry = resolve("scripts/run-beta-tests.mjs");
  const fake = resolve(directory, "node_modules/vitest/vitest.mjs");
  const run = (settings) =>
    spawnSync(process.execPath, [entry, "runtime"], {
      cwd: directory,
      env: settings,
      encoding: "utf8",
    });
  try {
    await mkdir(dirname(fake), { recursive: true });
    await writeFile(fake, "process.exitCode = 17;\n");
    assert.equal(run({ ...process.env, ...env }).status, 17);
    await unlink(fake);
    assert.notEqual(run({ ...process.env, ...env }).status, 0);
    assert.notEqual(
      run({ ...process.env, CLOUDMARKUP_TEST_DATABASE_URL: "" }).status,
      0,
    );
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
