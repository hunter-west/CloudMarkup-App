import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  classifyMemoryImageBuildFailure,
  createMemoryProofCheckpoint,
  encodeMemoryProofFailure,
  memoryProofCommandFailure,
  readMemoryProofFailure,
} from "./memory-proof-diagnostics.mjs";

test("fixed stages preserve the first failed operation without error text", () => {
  const checkpoint = createMemoryProofCheckpoint();
  checkpoint.enter("build-1");
  checkpoint.capture("execute", "compile");
  checkpoint.capture("dispose");
  checkpoint.result("error");
  const encoded = encodeMemoryProofFailure(
    checkpoint.failure(new Error("PRIVATE_SOURCE")),
  );
  assert.deepEqual(readMemoryProofFailure(encoded), {
    stage: "build-1",
    reason: "failed",
    operation: "execute",
    step: "compile",
  });
  assert.doesNotMatch(encoded, /PRIVATE_SOURCE/u);
  assert.throws(() => checkpoint.enter("PRIVATE_STAGE"));
  assert.throws(() => checkpoint.capture("PRIVATE_OPERATION"));
  assert.throws(() => checkpoint.result("PRIVATE_STATE"));
  assert.throws(() => checkpoint.result("failed", "PRIVATE_STEP"));
});

test("command failures reveal only classified reason and current stage", () => {
  for (const [error, reason] of [
    [{ code: "ETIMEDOUT", stderr: "PRIVATE" }, "timeout"],
    [{ code: "ENOBUFS", stdout: "PRIVATE" }, "output-limit"],
    [{ code: "ENOENT", path: "PRIVATE" }, "unavailable"],
    [{ status: 7, stderr: "PRIVATE" }, "command-exit"],
    [{ signal: "SIGKILL", stdout: "PRIVATE" }, "command-signal"],
    [new Error("PRIVATE"), "failed"],
  ]) {
    const checkpoint = createMemoryProofCheckpoint("helper-image-build");
    const encoded = encodeMemoryProofFailure(
      checkpoint.failure(memoryProofCommandFailure(error, false)),
    );
    assert.deepEqual(readMemoryProofFailure(encoded), {
      stage: "helper-image-build",
      reason,
    });
    assert.doesNotMatch(encoded, /PRIVATE/u);
  }
});

test("child diagnostics are closed, bounded and never admit captured output", () => {
  const valid = {
    stage: "build-2",
    reason: "failed",
    state: "failed",
    step: "unit-tests",
  };
  const encoded = "memory-proof-failure:" + JSON.stringify(valid) + "\n";
  const checkpoint = createMemoryProofCheckpoint("child-execution");
  assert.deepEqual(
    readMemoryProofFailure(
      encodeMemoryProofFailure(
        checkpoint.failure(
          memoryProofCommandFailure({ stderr: encoded, status: 1 }, true),
        ),
      ),
    ),
    valid,
  );
  for (const bad of [
    "PRIVATE_STDERR",
    "x".repeat(1025),
    encoded + "PRIVATE_SUFFIX",
    "memory-proof-failure:null",
    "memory-proof-failure:[]",
    ...[
      { stdout: "PRIVATE" },
      { stage: "PRIVATE" },
      { reason: "PRIVATE" },
      { operation: "PRIVATE" },
      { step: "PRIVATE" },
      { state: "PRIVATE" },
    ].map(
      (patch) =>
        "memory-proof-failure:" + JSON.stringify({ ...valid, ...patch }),
    ),
  ]) {
    assert.equal(readMemoryProofFailure(bad), undefined);
    const output = encodeMemoryProofFailure(
      checkpoint.failure(
        memoryProofCommandFailure({ stderr: bad, status: 1 }, true),
      ),
    );
    assert.deepEqual(readMemoryProofFailure(output), {
      stage: "child-execution",
      reason: "command-exit",
    });
    assert.doesNotMatch(output, /PRIVATE/u);
  }
  assert.deepEqual(
    readMemoryProofFailure(encodeMemoryProofFailure(new Error("PRIVATE"))),
    { stage: "bootstrap", reason: "failed" },
  );
});

test("actual failed subprocess forwards only an exact closed child diagnostic", () => {
  const moduleUrl = new URL(
    "./beta-memory-application-verification.mjs",
    import.meta.url,
  ).href;
  const diagnosticsUrl = new URL(
    "./memory-proof-diagnostics.mjs",
    import.meta.url,
  ).href;
  const diagnostic =
    "memory-proof-failure:" +
    JSON.stringify({ stage: "build-1", reason: "failed", operation: "open" }) +
    "\n";
  for (const stderr of [diagnostic, diagnostic + "PRIVATE_STDERR"]) {
    const child =
      'process.stdout.write("PRIVATE_STDOUT");process.stderr.write(' +
      JSON.stringify(stderr) +
      ");process.exit(7)";
    const source =
      "import {runMemoryProofCommand} from " +
      JSON.stringify(moduleUrl) +
      ";import {createMemoryProofCheckpoint,encodeMemoryProofFailure} from " +
      JSON.stringify(diagnosticsUrl) +
      ';const checkpoint=createMemoryProofCheckpoint("child-execution");try {runMemoryProofCommand(process.execPath,["-e",' +
      JSON.stringify(child) +
      "],{proof:true});process.exitCode=2;}catch(error){process.stdout.write(encodeMemoryProofFailure(checkpoint.failure(error)))}";
    const actual = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        encoding: "utf8",
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      },
    );
    assert.equal(actual.status, 0);
    assert.equal(actual.stderr, "");
    assert.deepEqual(
      readMemoryProofFailure(actual.stdout),
      stderr === diagnostic
        ? { stage: "build-1", reason: "failed", operation: "open" }
        : { stage: "child-execution", reason: "command-exit" },
    );
    assert.doesNotMatch(actual.stdout, /PRIVATE/u);
  }
});

test("image diagnostics require the preparation stage and bounded exit status", () => {
  for (const message of [
    "PRIVATE",
    null,
    "x".repeat(8 * 1024 * 1024 + 1) + "no space left on device",
  ])
    assert.equal(classifyMemoryImageBuildFailure(message), "unclassified");

  const value = {
    stage: "helper-image-build",
    reason: "command-exit",
    imageBuildFailure: "disk-capacity",
    exitStatus: 1,
  };
  const encode = (input) =>
    "memory-proof-failure:" + JSON.stringify(input) + "\n";
  assert.deepEqual(readMemoryProofFailure(encode(value)), value);
  for (const patch of [
    { stage: "build-1" },
    { stage: "child-execution" },
    { reason: "timeout" },
    { imageBuildFailure: "PRIVATE" },
    { imageBuildFailure: null },
    { exitStatus: 0 },
    { exitStatus: -1 },
    { exitStatus: 256 },
    { exitStatus: 1.5 },
    { exitStatus: "1" },
    { exitStatus: null },
    { stderr: "PRIVATE" },
  ])
    assert.equal(
      readMemoryProofFailure(encode({ ...value, ...patch })),
      undefined,
    );
  const { imageBuildFailure: ignored, ...withoutClassification } = value;
  assert.equal(ignored, "disk-capacity");
  assert.equal(
    readMemoryProofFailure(encode(withoutClassification)),
    undefined,
  );
  for (const status of [null, -1, 0, 256, "1", 1.5]) {
    const checkpoint = createMemoryProofCheckpoint("base-image-build");
    const actual = readMemoryProofFailure(
      encodeMemoryProofFailure(
        checkpoint.failure(
          memoryProofCommandFailure(
            { status, stderr: "no space left on device PRIVATE" },
            false,
            true,
          ),
        ),
      ),
    );
    assert.equal(actual.imageBuildFailure, "disk-capacity");
    assert.equal(Object.hasOwn(actual, "exitStatus"), false);
  }
  const checkpoint = createMemoryProofCheckpoint("child-execution");
  const ordinary = readMemoryProofFailure(
    encodeMemoryProofFailure(
      checkpoint.failure(
        memoryProofCommandFailure(
          { status: 1, stderr: "no space left on device PRIVATE" },
          false,
        ),
      ),
    ),
  );
  assert.deepEqual(ordinary, {
    stage: "child-execution",
    reason: "command-exit",
  });
});

test("actual trusted image subprocess emits classification without captured content", () => {
  const moduleUrl = new URL(
    "./beta-memory-application-verification.mjs",
    import.meta.url,
  ).href;
  const diagnosticsUrl = new URL(
    "./memory-proof-diagnostics.mjs",
    import.meta.url,
  ).href;
  const child =
    'process.stdout.write("PRIVATE_STDOUT");process.stderr.write("PRIVATE_PATH: failed to resolve source metadata: pull access denied");process.exit(7)';
  const source =
    "import {runMemoryProofCommand} from " +
    JSON.stringify(moduleUrl) +
    ";import {createMemoryProofCheckpoint,encodeMemoryProofFailure} from " +
    JSON.stringify(diagnosticsUrl) +
    ';const checkpoint=createMemoryProofCheckpoint("helper-image-build");try {runMemoryProofCommand(process.execPath,["-e",' +
    JSON.stringify(child) +
    "],{imageBuild:true});process.exitCode=2;}catch(error){process.stdout.write(encodeMemoryProofFailure(checkpoint.failure(error)))}";
  const actual = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    },
  );
  assert.equal(actual.status, 0);
  assert.equal(actual.stderr, "");
  assert.deepEqual(readMemoryProofFailure(actual.stdout), {
    stage: "helper-image-build",
    reason: "command-exit",
    imageBuildFailure: "registry-access-denied",
    exitStatus: 7,
  });
  assert.doesNotMatch(actual.stdout, /PRIVATE/u);
});

test("candidate child cannot forward image-preparation metadata", () => {
  const checkpoint = createMemoryProofCheckpoint("child-execution");
  const encoded =
    "memory-proof-failure:" +
    JSON.stringify({
      stage: "helper-image-build",
      reason: "command-exit",
      imageBuildFailure: "disk-capacity",
      exitStatus: 1,
    }) +
    "\n";
  const actual = readMemoryProofFailure(
    encodeMemoryProofFailure(
      checkpoint.failure(
        memoryProofCommandFailure({ status: 1, stderr: encoded }, true, true),
      ),
    ),
  );
  assert.deepEqual(actual, {
    stage: "child-execution",
    reason: "command-exit",
  });
  const timeout = createMemoryProofCheckpoint("helper-image-build");
  const timedOut = readMemoryProofFailure(
    encodeMemoryProofFailure(
      timeout.failure(
        memoryProofCommandFailure(
          { status: 1, code: "ETIMEDOUT", stderr: "PRIVATE" },
          false,
          true,
        ),
      ),
    ),
  );
  assert.deepEqual(timedOut, {
    stage: "helper-image-build",
    reason: "timeout",
    imageBuildFailure: "unclassified",
  });
});

test("workspace diagnostics preserve only finite open and helper stages", () => {
  const checkpoint = createMemoryProofCheckpoint("build-1");
  checkpoint.capture("open", undefined, {
    workspaceStage: "probe",
    helperStage: "workspace-mount",
  });
  const encoded = encodeMemoryProofFailure(
    checkpoint.failure(new Error("PRIVATE")),
  );
  assert.deepEqual(readMemoryProofFailure(encoded), {
    stage: "build-1",
    reason: "failed",
    operation: "open",
    workspaceStage: "probe",
    helperStage: "workspace-mount",
  });
  assert.doesNotMatch(encoded, /PRIVATE/u);
  for (const patch of [
    { workspaceStage: "PRIVATE" },
    { helperStage: "PRIVATE" },
    { stdout: "PRIVATE" },
    { operation: "execute" },
    { workspaceStage: "image", helperStage: "core" },
    { stage: "helper-image-build" },
    { workspaceStage: undefined, helperStage: "core" },
  ])
    assert.equal(
      readMemoryProofFailure(
        "memory-proof-failure:" +
          JSON.stringify({ ...readMemoryProofFailure(encoded), ...patch }),
      ),
      undefined,
    );
  assert.throws(() =>
    checkpoint.capture("open", undefined, { stdout: "PRIVATE" }),
  );
  assert.throws(() =>
    checkpoint.capture("execute", undefined, { workspaceStage: "probe" }),
  );
});
