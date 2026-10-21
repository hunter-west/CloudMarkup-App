import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  admitHost,
  baseArgs,
  collectChild,
  completedContainer,
  createCommandDeadline,
  creationId,
  inspectContainer,
  parentReport,
  parseManifest,
  removeOwned,
  readClosedParentFailure,
  removeUncertainCreation,
} from "./native-normalization-proof.mjs";

const HASH = "a".repeat(64),
  OTHER = "b".repeat(64);
const RUN = "705eac5c-384a-434f-b730-c7fa4f5c1fd5";
const manifest = {
  kind: "cloudmarkup.anonymous-normalization-native-closure.v1",
  sourceCommit: "a".repeat(40),
  closureSha256: HASH,
  image: `node@sha256:${HASH}`,
  imageId: `sha256:${HASH}`,
  parent: { path: "/public/parent.mjs", sha256: HASH, bytes: 1 },
  launcher: { path: "/public/launcher", sha256: HASH, bytes: 1 },
  compiler: { path: "/public/compiler", sha256: HASH, bytes: 1 },
};
function container() {
  const mounts = [
    { source: "/public/parent.mjs", target: "/proof/parent.mjs" },
  ];
  return {
    expected: {
      name: "proof",
      runId: RUN,
      manifest,
      mounts,
      args: ["-i", "fixed"],
    },
    value: {
      Id: HASH,
      Name: "/proof",
      Image: manifest.imageId,
      Path: "/usr/bin/env",
      Args: ["-i", "fixed"],
      Config: {
        Image: manifest.image,
        User: "65532:65532",
        WorkingDir: "/",
        Labels: {
          "cloudmarkup.owner":
            "cloudmarkup.anonymous-normalization-native-proof.v1",
          "cloudmarkup.run": RUN,
        },
      },
      HostConfig: {
        NetworkMode: "none",
        ReadonlyRootfs: true,
        Privileged: false,
        CapAdd: null,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges=true"],
        LogConfig: { Type: "none" },
        Memory: 536870912,
        MemorySwap: 536870912,
        PidsLimit: 64,
        NanoCpus: 1000000000,
        Ulimits: [{ Name: "core", Soft: 0, Hard: 0 }],
        IpcMode: "none",
        PidMode: "",
        UTSMode: "",
        UsernsMode: "",
        Devices: [],
        DeviceRequests: [],
        Tmpfs: {},
        Links: null,
      },
      State: { Running: false, Status: "created" },
      NetworkSettings: { Networks: { none: {} } },
      Mounts: [
        {
          Type: "bind",
          Source: mounts[0].source,
          Destination: mounts[0].target,
          RW: false,
          Propagation: "rprivate",
        },
      ],
    },
  };
}
const host = {
  kernel: "6.14.0-native",
  bootId: RUN,
  swaps: "Filename\tType\tSize\tUsed\tPriority\n",
  limits:
    "Max core file size        0                    0                    bytes\n",
  corePattern: "core\n",
};

test("public preparation binds exact paths and image digest; no mutable/tag-only substitution", () => {
  assert.equal(parseManifest(manifest).compiler.sha256, HASH);
  for (const mutation of [
    (value) => {
      value.image = "node:24";
    },
    (value) => {
      value.extra = "private marker";
    },
    (value) => {
      value.parent.path = "relative";
    },
    (value) => {
      value.parent.path = "/public/a,b";
    },
    (value) => {
      value.compiler.bytes = 134217729;
    },
  ]) {
    const value = structuredClone(manifest);
    mutation(value);
    assert.throws(
      () => parseManifest(value),
      /Native normalization proof failed/u,
    );
  }
});
test("native host denies WSL, swap, piped core capture, nonzero hard core and malformed identities", () => {
  assert.equal(admitHost(host).bootId, RUN);
  for (const changed of [
    { kernel: "6.18-microsoft-WSL2" },
    { swaps: host.swaps + "/swap file 100 0 -1\n" },
    { corePattern: "|/host/collector %p" },
    { corePattern: "@receiver" },
    { limits: "Max core file size 0 unlimited bytes\n" },
    { bootId: "missing" },
  ])
    assert.throws(
      () => admitHost({ ...host, ...changed }),
      /Native normalization proof failed/u,
    );
});
test("admission examines real topology before start, not declared opt-in labels", () => {
  const valid = container();
  assert.equal(inspectContainer(valid.value, valid.expected), HASH);
  for (const mutate of [
    (v) => {
      v.HostConfig.NetworkMode = "host";
    },
    (v) => {
      v.HostConfig.ReadonlyRootfs = false;
    },
    (v) => {
      v.HostConfig.Privileged = true;
    },
    (v) => {
      v.HostConfig.CapAdd = ["SYS_ADMIN"];
    },
    (v) => {
      v.HostConfig.LogConfig.Type = "json-file";
    },
    (v) => {
      v.HostConfig.MemorySwap = -1;
    },
    (v) => {
      v.Mounts[0].RW = true;
    },
    (v) => {
      v.Mounts[0].Type = "volume";
    },
    (v) => {
      v.Mounts.push({
        Type: "bind",
        Source: "/var/run/docker.sock",
        Destination: "/var/run/docker.sock",
        RW: true,
      });
    },
    (v) => {
      v.State.Running = true;
    },
    (v) => {
      v.Image = `sha256:${OTHER}`;
    },
    (v) => {
      v.Args.push("private input");
    },
    (v) => {
      v.NetworkSettings.Networks.bridge = {};
    },
    (v) => {
      v.HostConfig.PidMode = "host";
    },
    (v) => {
      v.HostConfig.Tmpfs["/content"] = "rw";
    },
  ]) {
    const { value, expected } = container();
    mutate(value);
    assert.throws(
      () => inspectContainer(value, expected),
      /Native normalization proof failed/u,
    );
  }
});
test("create command has exact isolation and contains neither Docker socket nor a writable volume", () => {
  const args = baseArgs("proof", RUN);
  for (const item of [
    "--read-only",
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--log-driver",
    "--ulimit",
    "core=0:0",
  ])
    assert.ok(args.includes(item));
  assert.equal(
    args.some(
      (value) =>
        value.includes("docker.sock") ||
        value === "--privileged" ||
        value === "--volume",
    ),
    false,
  );
});
function reportFixture() {
  const admission = {
    runId: RUN,
    containerId: HASH,
    closureSha256: HASH,
    launcherSha256: HASH,
    compilerSha256: HASH,
  };
  const report = {
    kind: "cloudmarkup.anonymous-normalization-parent.v1",
    status: "passed",
    admissionSha256: HASH,
    ...admission,
    inputs: ["architecture", "workload", "solution-revision"].map((kind) => ({
      kind,
      byteLength: 2,
      sha256: HASH,
    })),
    stdoutBytes: 10,
    stdoutSha256: HASH,
    expectedModelDigest: `sha256:${HASH}`,
    observedModelDigest: `sha256:${HASH}`,
    equal: true,
    stderrBytes: 0,
    exitCode: 0,
  };
  return { admission, report };
}
test("metadata is exact, bounded, all-input bound, and cannot forward normalized content or stderr", () => {
  const fixture = reportFixture();
  const encode = (value) => Buffer.from(JSON.stringify(value) + "\n");
  assert.equal(
    parentReport(encode(fixture.report), fixture.admission, HASH).equal,
    true,
  );
  for (const mutate of [
    (v) => {
      v.containerId = OTHER;
    },
    (v) => {
      v.admissionSha256 = OTHER;
    },
    (v) => {
      v.inputs.reverse();
    },
    (v) => {
      v.observedModelDigest = `sha256:${OTHER}`;
    },
    (v) => {
      v.output = "PRIVATE_TEST_MARKER";
    },
    (v) => {
      v.stderr = "PRIVATE_TEST_MARKER";
    },
    (v) => {
      v.stdoutBytes = 2097153;
    },
    (v) => {
      v.exitCode = 1;
    },
    (v) => {
      v.equal = false;
    },
  ]) {
    const report = structuredClone(fixture.report);
    mutate(report);
    assert.throws(
      () => parentReport(encode(report), fixture.admission, HASH),
      /Native normalization proof failed/u,
    );
  }
  assert.throws(() =>
    parentReport(Buffer.alloc(8193), fixture.admission, HASH),
  );
});
test("actual failed subprocess and stderr cannot escape closed error; bounded output is joined", async () => {
  for (const code of [
    'process.stdout.write("PRIVATE_TEST_MARKER"); process.stderr.write("PRIVATE_TEST_MARKER"); process.exitCode=1;',
    'process.stderr.write("PRIVATE_TEST_MARKER");',
    'process.stdout.write("x".repeat(9000));',
  ]) {
    const child = spawn(process.execPath, ["-e", code], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {},
    });
    await assert.rejects(collectChild(child, "parent", 8192, 3000), (error) => {
      assert.equal(error.phase, "parent");
      assert.equal(String(error).includes("PRIVATE_TEST_MARKER"), false);
      assert.equal(
        JSON.stringify(error).includes("PRIVATE_TEST_MARKER"),
        false,
      );
      return true;
    });
    assert.notEqual(child.exitCode === null && child.signalCode === null, true);
  }
});
test("stalled public subprocess is killed and joined at its original deadline", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {},
  });
  await assert.rejects(
    collectChild(child, "parent", 8192, 100),
    /Native normalization proof failed/u,
  );
  assert.equal(child.signalCode, "SIGKILL");
});
test("cleanup deletes only exact label/image/ID, checks absence, and supports retry after removal", async () => {
  const current = container().value;
  const calls = [];
  const command = async (args) => {
    calls.push(args);
    if (args[0] === "inspect") return Buffer.from(JSON.stringify([current]));
    if (args[0] === "rm") return Buffer.from(HASH);
    return Buffer.from(calls.length === 1 ? HASH : "");
  };
  await removeOwned("proof", RUN, manifest, HASH, command);
  assert.deepEqual(
    calls.find((args) => args[0] === "rm"),
    ["rm", "--force", HASH],
  );
  assert.ok(calls.at(-1).includes(`id=${HASH}`));
  const retry = [];
  await removeOwned("proof", RUN, manifest, HASH, async (args) => {
    retry.push(args);
    return Buffer.from("");
  });
  assert.equal(retry.length, 2);
  current.Config.Labels["cloudmarkup.run"] = "another-owner";
  let removed = false;
  await assert.rejects(
    removeOwned("proof", RUN, manifest, HASH, async (args) => {
      if (args[0] === "inspect") return Buffer.from(JSON.stringify([current]));
      if (args[0] === "rm") removed = true;
      return Buffer.from(HASH);
    }),
  );
  assert.equal(removed, false);
});
test("failed absence confirmation remains a cleanup failure", async () => {
  const current = container().value;
  await assert.rejects(
    removeOwned("proof", RUN, manifest, HASH, async (args) =>
      args[0] === "inspect"
        ? Buffer.from(JSON.stringify([current]))
        : Buffer.from(HASH),
    ),
    /Native normalization proof failed/u,
  );
});

test("caller cancellation kills and joins the active fixed child without forwarding data", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      'process.stdout.write("PRIVATE_TEST_MARKER");setInterval(()=>{},1000)',
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: {} },
  );
  const abort = new AbortController();
  const completion = collectChild(child, "parent", 8192, 3000, abort.signal);
  abort.abort();
  await assert.rejects(completion, (error) => {
    assert.equal(error.phase, "parent");
    assert.equal(String(error).includes("PRIVATE_TEST_MARKER"), false);
    return true;
  });
  assert.equal(child.signalCode, "SIGKILL");
});

test("late successful close fails elapsed deadline even when timer has not run", async () => {
  let now = 100;
  const deadline = createCommandDeadline(15000, () => now);
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  child.kill = () => {
    killed = true;
  };
  const completion = collectChild(
    child,
    "parent",
    8192,
    15000,
    undefined,
    deadline,
  );
  child.stdout.write('{"fixed":"public"}');
  now += 15000; // Synchronous clock advance: real timer is still pending.
  child.emit("close", 0, null);
  await assert.rejects(completion, (error) => error.phase === "parent");
  assert.equal(killed, false);
  child.stdout.destroy();
  child.stderr.destroy();
});
test("command deadline preserves its original start and succeeds only strictly before expiry", () => {
  let now = 100;
  const deadline = createCommandDeadline(45000, () => now);
  now += 44999;
  assert.equal(deadline.isCurrent(), true);
  assert.equal(deadline.remainingMilliseconds(), 1);
  now += 1;
  assert.equal(deadline.isCurrent(), false);
  now = 99;
  assert.equal(deadline.isCurrent(), false);
});
test("known container ID cannot be replaced by an identical name/label/image", async () => {
  const current = container().value;
  current.Id = OTHER;
  let removed = false;
  await assert.rejects(
    removeOwned("proof", RUN, manifest, HASH, async (args) => {
      if (args[0] === "inspect") return Buffer.from(JSON.stringify([current]));
      if (args[0] === "rm") removed = true;
      return Buffer.from(OTHER);
    }),
    (error) => error.phase === "cleanup",
  );
  assert.equal(removed, false);
});
test("known-ID absence also checks a renamed original by full ID", async () => {
  const calls = [];
  await assert.rejects(
    removeOwned("proof", RUN, manifest, HASH, async (args) => {
      calls.push(args);
      return Buffer.from(args.includes(`id=${HASH}`) ? HASH : "");
    }),
    (error) => error.phase === "cleanup",
  );
  assert.equal(
    calls.some((args) => args[0] === "rm"),
    false,
  );
  assert.ok(calls.at(-1).includes(`id=${HASH}`));
});
test("uncertain creation has explicit owned-discovery cleanup, never a known-ID fallback", async () => {
  const current = container().value;
  const calls = [];
  await removeUncertainCreation("proof", RUN, manifest, async (args) => {
    calls.push(args);
    if (args[0] === "inspect") return Buffer.from(JSON.stringify([current]));
    if (args[0] === "rm") return Buffer.from(HASH);
    return Buffer.from(calls.length === 1 ? HASH : "");
  });
  assert.deepEqual(
    calls.find((args) => args[0] === "rm"),
    ["rm", "--force", HASH],
  );
  current.Config.Labels["cloudmarkup.run"] = "foreign-run";
  let removed = false;
  await assert.rejects(
    removeUncertainCreation("proof", RUN, manifest, async (args) => {
      if (args[0] === "inspect") return Buffer.from(JSON.stringify([current]));
      if (args[0] === "rm") removed = true;
      return Buffer.from(HASH);
    }),
  );
  assert.equal(removed, false);
});
test("creation identity requires a single full immutable container ID", () => {
  assert.equal(creationId(Buffer.from(HASH + "\n")), HASH);
  for (const value of [
    HASH.slice(0, 12),
    HASH + "\n" + OTHER,
    "PRIVATE_TEST_MARKER",
    "",
  ])
    assert.throws(() => creationId(Buffer.from(value)));
});

test("both probe and parent require the exact observed ID in genuinely exited state", () => {
  const passed = {
    Id: HASH,
    State: { Status: "exited", Running: false, ExitCode: 0, OOMKilled: false },
  };
  for (const phase of ["probe", "parent"]) {
    assert.doesNotThrow(() => completedContainer(passed, HASH, phase));
    // Docker's never-started created object may report Running=false/ExitCode=0.
    for (const status of [
      "created",
      "running",
      "paused",
      "restarting",
      "dead",
      undefined,
    ]) {
      assert.throws(
        () =>
          completedContainer(
            { ...passed, State: { ...passed.State, Status: status } },
            HASH,
            phase,
          ),
        (error) => error.phase === phase,
      );
    }
    assert.throws(
      () => completedContainer({ ...passed, Id: OTHER }, HASH, phase),
      (error) => error.phase === phase,
    );
    for (const fields of [
      { Running: true },
      { ExitCode: 1 },
      { OOMKilled: true },
    ])
      assert.throws(() =>
        completedContainer(
          { ...passed, State: { ...passed.State, ...fields } },
          HASH,
          phase,
        ),
      );
  }
});

test("failed parent diagnostics admit only the closed phase and never content", async () => {
  for (const phase of [
    "parent-admission",
    "launcher",
    "normalization",
    "normalization-execution",
    "normalization-result",
    "normalization-model",
    "parent-cleanup",
  ]) {
    const record = {
      kind: "cloudmarkup.anonymous-normalization-parent.v1",
      status: "failed",
      phase,
    };
    const bytes = Buffer.from(JSON.stringify(record) + "\n");
    assert.equal(readClosedParentFailure(bytes), phase);
    assert.throws(
      () => parentReport(bytes, {}, HASH),
      (error) => error.phase === "parent" && error.parentFailure === phase,
    );
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    const completion = collectChild(child, "parent", 8192, 1000);
    child.stdout.end(bytes);
    child.stderr.end();
    child.emit("close", 1, null);
    await assert.rejects(completion, (error) => {
      assert.equal(error.phase, "parent");
      assert.equal(error.parentFailure, phase);
      assert.equal(error.message, "Native normalization proof failed.");
      return true;
    });
    assert.equal(
      readClosedParentFailure(
        Buffer.from(
          JSON.stringify({ ...record, content: "PRIVATE_TEST_MARKER" }),
        ),
      ),
      null,
    );
    assert.equal(
      readClosedParentFailure(
        Buffer.from(
          JSON.stringify({ ...record, phase: "PRIVATE_TEST_MARKER" }),
        ),
      ),
      null,
    );
    assert.equal(
      readClosedParentFailure(
        Buffer.from(JSON.stringify({ ...record, status: "passed" })),
      ),
      null,
    );
  }
  assert.equal(
    readClosedParentFailure(Buffer.from("PRIVATE_TEST_MARKER")),
    null,
  );
  assert.equal(readClosedParentFailure(Buffer.alloc(1025)), null);
});
