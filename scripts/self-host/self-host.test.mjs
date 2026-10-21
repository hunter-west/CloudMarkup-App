import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, createServer } from "node:net";
import test from "node:test";
import { promisify } from "node:util";
import {
  auditObjects,
  admitLocalOwnerTransport,
  composeArgs,
  containerVersion,
  doctor,
  outsideRepository,
  operatorInvocation,
  privateFile,
  root,
  stopAndVerify,
  startLocalOwnerTransport,
  transportConfigurationProgram,
  transportDisappearanceProgram,
  transportHelperProgram,
  transportTarget,
  validateImagePins,
  validatePrivateLocations,
} from "./self-host.mjs";

test("operator routing admits only the closed privileged stages and keeps restore preparation outside runtime startup", () => {
  for (const [command, service, stage] of [
    ["operator:admin", "provisioner", "admin"],
    ["operator:restore-roles", "provisioner", "restore-roles"],
    ["operator:roles", "provisioner", "roles"],
    ["operator:acl", "permissions", "acl"],
    ["operator:check", "runtime-check", "check"],
    ["owner:initialize", "owner-initializer", "apply"],
    ["models:initialize", "models-history", "provision"],
  ])
    assert.deepEqual(operatorInvocation(command), [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      service,
      stage,
    ]);
  for (const command of [
    "start",
    "bootstrap",
    "operator:app",
    "operator:__proto__",
    "operator:constructor",
    "operator:restore-roles;start",
    null,
  ])
    assert.throws(() => operatorInvocation(command), /Unknown operator stage/);
});

test("doctor refuses Windows containers and accepts a synthetic Linux engine", async () => {
  await assert.rejects(
    doctor(async () => "windows"),
    /Linux containers/,
  );
  const calls = [];
  assert.equal(
    (
      await doctor(async (args) => {
        calls.push(args);
        return args[0] === "info" ? "linux" : "2.40.0";
      })
    ).containerOS,
    "linux",
  );
  assert.deepEqual(
    calls.map((args) => args[0]),
    ["info", "compose"],
  );
});

test("configured-model overlay requires both explicit private inputs and preserves the default core Compose invocation", () => {
  const env = { CLOUDMARKUP_SELF_HOST_PROJECT: "synthetic-models" };
  const core = composeArgs(["up", "app"], env);
  assert.equal(
    core.includes(join(root, "scripts/self-host/compose.models.yml")),
    false,
  );
  const settings = {
    CLOUDMARKUP_PROVIDER_DISPATCH_DIRECTORY: join(
      tmpdir(),
      "independent-dispatch",
    ),
    CLOUDMARKUP_PROVIDER_DISPATCH_CONFIGURATION_SOURCE: join(
      tmpdir(),
      "dispatch-approval.json",
    ),
  };
  const selected = composeArgs(["up", "app"], { ...env, ...settings });
  assert.deepEqual(selected.slice(3), [
    "--file",
    join(root, "scripts/self-host/compose.yml"),
    "--file",
    join(root, "scripts/self-host/compose.models.yml"),
    "up",
    "app",
  ]);
  for (const invalid of [
    {
      CLOUDMARKUP_PROVIDER_DISPATCH_DIRECTORY:
        settings.CLOUDMARKUP_PROVIDER_DISPATCH_DIRECTORY,
    },
    { ...settings, CLOUDMARKUP_PROVIDER_DISPATCH_DIRECTORY: "../objects" },
    { ...settings, CLOUDMARKUP_PROVIDER_DISPATCH_CONFIGURATION_SOURCE: "" },
  ])
    assert.throws(
      () => composeArgs([], { ...env, ...invalid }),
      /explicit independent dispatch/,
    );
});

const transportContainer = "a".repeat(64),
  transportImage = `sha256:${"b".repeat(64)}`;
function transportFixture({ publicPort = 4317, targetPort = 3000 } = {}) {
  const state = {
    Id: transportContainer,
    Image: transportImage,
    State: {
      Running: true,
      Paused: false,
      Restarting: false,
      OOMKilled: false,
      Dead: false,
      Status: "running",
      StartedAt: "2026-10-13T00:00:00Z",
    },
    Config: {
      User: "10001:10001",
      Labels: {
        "com.docker.compose.project": "transport-fixture",
        "com.docker.compose.service": "app",
        "com.docker.compose.oneoff": "False",
      },
    },
  };
  const packet = {
    mode: "local-owner",
    server: {
      host: "127.0.0.1",
      port: targetPort,
      publicOrigin: `http://127.0.0.1:${publicPort}`,
    },
  };
  const labels = { "com.cloudmarkup.browser-auth-mode": "local-owner" };
  const calls = [],
    children = [],
    closed = new Set();
  let monitor;
  const env = {
    ...process.env,
    CLOUDMARKUP_SELF_HOST_PROJECT: "transport-fixture",
    CLOUDMARKUP_SELF_HOST_IMAGE: "synthetic:matched",
  };
  const exec = async (args) => {
    calls.push(args);
    if (args[0] === "compose") return transportContainer;
    if (args[0] === "image")
      return args[3] === "{{.Id}}" ? transportImage : JSON.stringify(labels);
    if (args[0] === "inspect") return JSON.stringify(state);
    if (args.includes(transportConfigurationProgram)) {
      assert.deepEqual(args, [
        "exec",
        "--user",
        "10001:10001",
        "--workdir",
        "/opt/cloudmarkup/apps/api",
        transportContainer,
        "node",
        "--input-type=module",
        "--eval",
        transportConfigurationProgram,
      ]);
      return JSON.stringify(packet);
    }
    if (args.includes(transportDisappearanceProgram))
      return JSON.stringify({
        matched: children.some((child) => !closed.has(child)) ? 1 : 0,
      });
    throw new Error("Unexpected synthetic control call");
  };
  const launch = (file, args, options) => {
    assert.equal(file, "docker");
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    calls.push(args);
    if (args[0] === "wait") {
      assert.deepEqual(args, ["wait", transportContainer]);
      monitor = spawn(
        process.execPath,
        ["--eval", "setInterval(() => {}, 10000)"],
        { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      return monitor;
    }
    assert.deepEqual(args.slice(0, 8), [
      "exec",
      "--interactive",
      "--user",
      "10001:10001",
      transportContainer,
      "node",
      "--input-type=module",
      "--eval",
    ]);
    assert.equal(args[8], transportHelperProgram);
    assert.match(args.at(-1), /^[a-f0-9]{32}$/);
    const child = spawn(process.execPath, args.slice(6), {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(child);
    child.once("close", () => closed.add(child));
    return child;
  };
  return {
    state,
    packet,
    labels,
    calls,
    children,
    closed,
    env,
    exec,
    launch,
    monitor: () => monitor,
  };
}

test("transport refuses unowned/changed containers, image or browser mode and unsafe tuple", async () => {
  const edits = [
    (f) => {
      f.state.State.Paused = true;
    },
    (f) => {
      f.state.State.Running = false;
    },
    (f) => {
      f.state.Image = `sha256:${"c".repeat(64)}`;
    },
    (f) => {
      f.state.Config.Labels["com.docker.compose.project"] = "peer";
    },
    (f) => {
      f.state.Config.Labels["com.docker.compose.service"] = "operator";
    },
    (f) => {
      f.state.Config.User = "0";
    },
    (f) => {
      delete f.labels["com.cloudmarkup.browser-auth-mode"];
    },
    (f) => {
      f.labels["com.cloudmarkup.browser-auth-mode"] = "cognito";
    },
    (f) => {
      f.packet.mode = "cognito";
    },
    (f) => {
      f.packet.server.host = "0.0.0.0";
    },
  ];
  for (const edit of edits) {
    const fixture = transportFixture();
    edit(fixture);
    await assert.rejects(admitLocalOwnerTransport(fixture));
  }
  for (const publicOrigin of [
    "http://localhost:4317",
    "http://0.0.0.0:4317",
    "https://127.0.0.1:4317",
    "http://127.0.0.1:04317",
    "http://127.0.0.1:4317/",
    "http://127.0.0.1:4317/path",
    "http://user@127.0.0.1:4317",
    "http://example.invalid",
  ]) {
    const fixture = transportFixture();
    fixture.packet.server.publicOrigin = publicOrigin;
    assert.throws(() => transportTarget(fixture.packet));
  }
  for (const port of [0, -1, 65536, "3000", NaN]) {
    const fixture = transportFixture();
    fixture.packet.server.port = port;
    assert.throws(() => transportTarget(fixture.packet));
  }
  const fixture = transportFixture(),
    admitted = await admitLocalOwnerTransport(fixture);
  assert.equal(admitted.id, transportContainer);
  assert.equal(admitted.listenPort, 4317);
  assert.equal(
    fixture.calls.find((args) => args[3] === "{{json .Config.Labels}}")[4],
    transportImage,
  );
  fixture.state.State.StartedAt = "replacement";
  await assert.rejects(admitted.verify());
  assert.match(
    transportConfigurationProgram,
    /@cloudmarkup\/api\/self-host-configuration/,
  );
  assert.doesNotMatch(
    transportConfigurationProgram,
    /apps\/api\/src|console\.log\(raw/,
  );
});

async function transportEcho() {
  const sockets = new Set(),
    server = createServer({ allowHalfOpen: true }, (socket) => {
      sockets.add(socket);
      const chunks = [];
      socket.on("data", (bytes) => chunks.push(bytes));
      socket.on("end", () => socket.end(Buffer.concat(chunks)));
      socket.on("error", () => socket.destroy());
      socket.once("close", () => sockets.delete(socket));
    });
  server.listen({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  return {
    port: server.address().port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
async function unusedLoopbackPort() {
  const server = createServer();
  server.listen({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test(
  "transport preserves actual binary pipes/backpressure/half-close and reaps Windows proof children",
  { timeout: 15000 },
  async () => {
    const target = await transportEcho(),
      fixture = transportFixture({
        publicPort: await unusedLoopbackPort(),
        targetPort: target.port,
      });
    const transport = await startLocalOwnerTransport(fixture);
    try {
      assert.equal(transport.address.address, "127.0.0.1");
      const client = createConnection({
          host: "127.0.0.1",
          port: transport.address.port,
          allowHalfOpen: true,
        }),
        chunks = [];
      client.on("data", (bytes) => chunks.push(bytes));
      const ended = once(client, "end");
      await once(client, "connect");
      const payload = Buffer.alloc(2 * 1024 * 1024);
      for (let index = 0; index < payload.length; index++)
        payload[index] = index % 256;
      client.end(payload);
      await ended;
      assert.deepEqual(Buffer.concat(chunks), payload);
      client.destroy();
    } finally {
      await transport.stop();
      await target.close();
    }
    await transport.wait();
    assert.equal(transport.activeConnections(), 0);
    assert.equal(fixture.closed.size, fixture.children.length);
  },
);

test(
  "transport caps connections, expires idle clients and disposes its actual wait child",
  { timeout: 15000 },
  async () => {
    const target = await transportEcho(),
      fixture = transportFixture({
        publicPort: await unusedLoopbackPort(),
        targetPort: target.port,
      });
    const transport = await startLocalOwnerTransport({
      ...fixture,
      maxConnections: 1,
      idleMilliseconds: 350,
    });
    const first = createConnection({
      host: "127.0.0.1",
      port: transport.address.port,
    });
    first.on("error", () => undefined);
    try {
      const closed = once(first, "close");
      await once(first, "connect");
      const second = createConnection({
        host: "127.0.0.1",
        port: transport.address.port,
      });
      second.on("error", () => undefined);
      await once(second, "close");
      assert.equal(fixture.children.length, 1);
      await closed;
    } finally {
      first.destroy();
      await transport.stop();
      await target.close();
    }
    await transport.wait();
    assert.equal(transport.activeConnections(), 0);
    assert.notEqual(fixture.monitor().signalCode, null);
  },
);

test(
  "transport refuses occupied ports and invalid limits before serving and stops on replacement",
  { timeout: 15000 },
  async () => {
    const target = await transportEcho(),
      fixture = transportFixture({
        publicPort: target.port,
        targetPort: target.port,
      });
    try {
      await assert.rejects(
        startLocalOwnerTransport(fixture),
        /unavailable|admission/,
      );
    } finally {
      await target.close();
    }
    const invalid = transportFixture();
    await assert.rejects(
      startLocalOwnerTransport({ ...invalid, maxConnections: 0 }),
      /bound/,
    );
    assert.equal(invalid.calls.length, 0);
    const running = transportFixture({
        publicPort: await unusedLoopbackPort(),
      }),
      transport = await startLocalOwnerTransport(running);
    try {
      running.state.Id = "c".repeat(64);
      const client = createConnection({
        host: "127.0.0.1",
        port: transport.address.port,
      });
      client.on("error", () => undefined);
      await once(client, "close");
      await assert.rejects(transport.wait(), /preflight/);
      assert.equal(running.children.length, 0);
    } finally {
      await transport.stop();
    }
  },
);

test(
  "unconfirmed inner-helper disappearance closes ingress without claiming Docker cleanup",
  { timeout: 15000 },
  async (context) => {
    const target = await transportEcho(),
      fixture = transportFixture({
        publicPort: await unusedLoopbackPort(),
        targetPort: target.port,
      });
    const original = fixture.exec;
    fixture.exec = (args, options) =>
      args.includes(transportDisappearanceProgram)
        ? Promise.resolve('{"matched":2}')
        : original(args, options);
    const transport = await startLocalOwnerTransport(fixture);
    let client;
    context.after(async () => {
      client?.destroy();
      await transport.stop();
      await target.close();
    });
    try {
      client = createConnection({
        host: "127.0.0.1",
        port: transport.address.port,
      });
      client.on("error", () => undefined);
      client.resume();
      client.end("synthetic");
      await once(client, "close");
      await assert.rejects(transport.wait(), /unconfirmed/);
    } finally {
      client.destroy();
      await transport.stop();
    }
  },
);
test("Compose uses its pinned core recipe and refuses unadmitted retained history", async () => {
  assert.throws(() =>
    composeArgs([], { CLOUDMARKUP_SELF_HOST_PROJECT: "../peer" }),
  );
  assert.throws(() =>
    composeArgs([], { CLOUDMARKUP_SELF_HOST_PROJECT: "--host" }),
  );
  const args = composeArgs(["up", "app"], {
    CLOUDMARKUP_SELF_HOST_PROJECT: "synthetic-route",
  });
  assert.equal(args[2], "synthetic-route");
  assert.equal(args[4], join(root, "scripts/self-host/compose.yml"));
  assert.deepEqual(args.slice(5), ["up", "app"]);
  const env = { CLOUDMARKUP_SELF_HOST_PROJECT: "synthetic-route" };
  assert.deepEqual(
    composeArgs(["up", "app"], {
      ...env,
      CLOUDMARKUP_RETAINED_HISTORY_VOLUME: "",
    }),
    args,
  );
  for (const name of [
    "../peer",
    "operator-retained-history",
    "synthetic-route_objects",
  ])
    assert.throws(
      () =>
        composeArgs([], { ...env, CLOUDMARKUP_RETAINED_HISTORY_VOLUME: name }),
      /not admitted by the standalone core profile/,
    );
});
for (const state of [
  { Running: true, ExitCode: 0, OOMKilled: false, Status: "running" },
  { Running: false, ExitCode: 137, OOMKilled: false, Status: "exited" },
  { Running: false, ExitCode: 0, OOMKilled: true, Status: "exited" },
  { Running: false, ExitCode: 0, OOMKilled: false, Status: "dead" },
])
  test(`backup drain refuses ${JSON.stringify(state)}`, async () => {
    await assert.rejects(
      stopAndVerify(
        async (args) => (args[0] === "ps" ? "a".repeat(64) : ""),
        async () => JSON.stringify(state),
      ),
      /not confirmed/,
    );
  });
test("clean drain uses the configured aggregate SIGTERM grace before a receipt", async () => {
  const order = [];
  const receipt = await stopAndVerify(
    async (args) => {
      order.push(args);
      return args[0] === "ps" ? "b".repeat(64) : "";
    },
    async (args) => {
      order.push("inspect");
      if (args[2] === "{{.Image}}") return `sha256:${"b".repeat(64)}`;
      return JSON.stringify({
        Running: false,
        ExitCode: 0,
        OOMKilled: false,
        Status: "exited",
      });
    },
  );
  assert.equal(receipt.cleanRuntimeExit, true);
  assert.deepEqual(order[1], ["stop", "--timeout", "120", "app"]);
  assert.equal(order[2], "inspect");
});
test("container fingerprint reads the exact image without secrets, network or volumes", async () => {
  const calls = [],
    id = `sha256:${"c".repeat(64)}`;
  const result = await containerVersion(
    async (args) => {
      calls.push(args);
      return args[0] === "image"
        ? id
        : JSON.stringify({
            migrations: { count: 118 },
            lockfileSha256: "synthetic",
            node: "24.18.0",
            packageManager: "pnpm@11.16.0",
          });
    },
    { CLOUDMARKUP_SELF_HOST_IMAGE: "synthetic:old" },
  );
  assert.equal(result.imageId, id);
  assert.equal(result.packagedVersion.node, "24.18.0");
  assert.equal(calls[1].includes("none"), true);
  assert.equal(calls[1].includes("--volume"), false);
  assert.equal(calls[1].includes("--env"), false);
  assert.equal(calls[1].includes(id), true);
});
test("unstarted/missing runtime is not a drain receipt", async () => {
  await assert.rejects(
    stopAndVerify(async () => ""),
    /existing runtime/,
  );
});
test("image tags alone cannot pass the immutable release pin check", () => {
  assert.throws(() =>
    validateImagePins({ CLOUDMARKUP_NODE_IMAGE: "node:24.18.0-bookworm-slim" }),
  );
  validateImagePins(
    Object.fromEntries(
      ["NODE", "GO", "POSTGRES"].map((key) => [
        `CLOUDMARKUP_${key}_IMAGE`,
        `synthetic:1@sha256:${"a".repeat(64)}`,
      ]),
    ),
  );
});
test("private files and backup containment are checked without printing contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cm-route-test-"));
  try {
    const file = join(directory, "private.json");
    await writeFile(file, "synthetic private data");
    assert.equal(await privateFile(file), file);
    await assert.rejects(privateFile(directory));
    await assert.rejects(outsideRepository(join(root, "..lookalike")));
    await assert.rejects(outsideRepository(join(root, "backups/new")));
    assert.equal(
      await outsideRepository(join(directory, "new")),
      join(directory, "new"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("build validation refuses configured leaf links into the source context", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "cm-route-links-"));
  try {
    const file = join(directory, "private.json"),
      secrets = join(directory, "secrets");
    await writeFile(file, "synthetic configuration");
    await mkdir(secrets);
    const env = {
      CLOUDMARKUP_SELF_HOST_CONFIGURATION_SOURCE: file,
      CLOUDMARKUP_OPERATOR_CONFIGURATION_SOURCE: file,
      CLOUDMARKUP_PROVISIONING_CONFIGURATION_SOURCE: file,
      CLOUDMARKUP_OWNER_CONFIGURATION_SOURCE: file,
      CLOUDMARKUP_POSTGRES_OWNER_PASSWORD_FILE: file,
      CLOUDMARKUP_MIGRATOR_PASSWORD_FILE: file,
      CLOUDMARKUP_RUNTIME_SECRETS_DIRECTORY: secrets,
      CLOUDMARKUP_DATABASE_SECRETS_DIRECTORY: secrets,
    };
    await validatePrivateLocations(env);
    const linkedFile = join(directory, "linked-file");
    try {
      await symlink(join(root, "package.json"), linkedFile, "file");
    } catch (error) {
      if (error.code === "EPERM" || error.code === "EACCES") {
        context.skip(
          "File symlink creation unavailable; require real Linux execution.",
        );
        return;
      }
      throw error;
    }
    for (const key of [
      "CLOUDMARKUP_SELF_HOST_CONFIGURATION_SOURCE",
      "CLOUDMARKUP_OPERATOR_CONFIGURATION_SOURCE",
      "CLOUDMARKUP_PROVISIONING_CONFIGURATION_SOURCE",
      "CLOUDMARKUP_OWNER_CONFIGURATION_SOURCE",
      "CLOUDMARKUP_POSTGRES_OWNER_PASSWORD_FILE",
      "CLOUDMARKUP_MIGRATOR_PASSWORD_FILE",
    ])
      await assert.rejects(
        validatePrivateLocations({ ...env, [key]: linkedFile }),
        /private file/,
      );
    const linkedDirectory = join(directory, "linked-directory");
    await symlink(
      root,
      linkedDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      validatePrivateLocations({
        ...env,
        CLOUDMARKUP_RUNTIME_SECRETS_DIRECTORY: linkedDirectory,
      }),
      /unsymlinked directory/,
    );
    await assert.rejects(
      validatePrivateLocations({
        ...env,
        CLOUDMARKUP_DATABASE_SECRETS_DIRECTORY: linkedDirectory,
      }),
      /unsymlinked directory/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test(
  "native Windows audit cannot masquerade as Linux fsync qualification",
  { skip: process.platform === "linux" },
  async () => {
    await assert.rejects(
      auditObjects({ path: root, sync: true }),
      /Linux object-volume/,
    );
  },
);
test("Dockerfile-specific context excludes credential/state/cache sentinels and retains shared source", async () => {
  const patterns = (
    await readFile(
      join(root, "scripts/self-host/Dockerfile.dockerignore"),
      "utf8",
    )
  )
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"));
  function excluded(path) {
    return patterns.some((pattern) => {
      const regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*\//g, "@@OPTIONAL@@")
        .replace(/\*\*/g, "@@ANY@@")
        .replace(/\*/g, "[^/]*")
        .replace(/@@OPTIONAL@@/g, "(?:.*/)?")
        .replace(/@@ANY@@/g, ".*");
      return new RegExp(`^${regex}(?:/.*)?$`).test(path);
    });
  }
  for (const path of [
    ".git/config",
    ".env",
    "apps/api/.env.provider",
    "private/secrets/provider.txt",
    ".aws/credentials",
    "objects/published/envelope",
    "postgres-data/PG_VERSION",
    "node_modules/pg/index.js",
    "packages/domain/dist/index.js",
    ".cache/admission/lease",
    "backups/receipt.json",
  ])
    assert.equal(excluded(path), true, path);
  for (const path of [
    "package.json",
    "pnpm-lock.yaml",
    "apps/api/src/self-host/server.ts",
    "apps/api/migrations/0136_model_private_runtime_definitions.sql",
    "apps/web/src/main.tsx",
    "services/iac-compiler/go.mod",
    "packages/model-gateway/src/provider-credentials.ts",
  ])
    assert.equal(excluded(path), false, path);
  const dockerfile = await readFile(
    join(root, "scripts/self-host/Dockerfile"),
    "utf8",
  );
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /pnpm build:backend && pnpm build:web/);
  assert.match(dockerfile, /USER 10001:10001/);
  assert.match(
    dockerfile,
    /^FROM \$\{NODE_IMAGE\} AS runtime\r?\nARG CLOUDMARKUP_BROWSER_AUTH_MODE\r?\nLABEL com\.cloudmarkup\.browser-auth-mode=\$\{CLOUDMARKUP_BROWSER_AUTH_MODE\}/mu,
  );
  const browserBuildSettings =
    "ENV VITE_CLOUDMARKUP_AUTH_MODE=${CLOUDMARKUP_BROWSER_AUTH_MODE} VITE_CLOUDMARKUP_API_BASE_URL=/api";
  assert.match(dockerfile, /^ARG CLOUDMARKUP_BROWSER_AUTH_MODE=local-owner$/mu);
  assert.equal(dockerfile.includes(browserBuildSettings), true);
  assert.equal(
    dockerfile.indexOf(browserBuildSettings) <
      dockerfile.indexOf("pnpm build:backend"),
    true,
  );
  assert.doesNotMatch(dockerfile, /VITE_[A-Z_]*(?:PROOF|TOKEN|PASSWORD|KEY)/);
  assert.doesNotMatch(
    dockerfile,
    /local-server|vite preview|ARG .*KEY|ARG .*PASSWORD/,
  );
  const compose = await readFile(
    join(root, "scripts/self-host/compose.yml"),
    "utf8",
  );
  assert.doesNotMatch(compose, /^\s+ports:/mu);
  assert.match(compose, /objects:\/data\/cloudmarkup/);
  assert.doesNotMatch(
    compose,
    /docker\.sock|privileged:|CLOUDMARKUP_DATABASE_URL/,
  );
  const section = (name) => {
    const match = new RegExp(
      `^  ${name}:\\r?\\n[\\s\\S]*?(?=^  [a-z][a-z-]*:|^secrets:)`,
      "mu",
    ).exec(compose);
    assert.ok(match, `Missing ${name} service`);
    return match[0];
  };
  const appSection = section("app");
  assert.doesNotMatch(
    appSection,
    /postgres_owner_password|migrator_password|operator_configuration/,
  );
  assert.doesNotMatch(
    section("runtime-check"),
    /postgres_owner_password|migrator_password|objects:\/data/,
  );
  assert.doesNotMatch(
    section("permissions"),
    /postgres_owner_password|CLOUDMARKUP_RUNTIME_SECRETS_DIRECTORY/,
  );
  assert.doesNotMatch(
    section("owner-initializer"),
    /postgres_owner_password|CLOUDMARKUP_RUNTIME_SECRETS_DIRECTORY/,
  );
  assert.match(
    section("owner-initializer"),
    /scripts\/self-host\/initialize-owner\.mjs/,
  );
  for (const name of [
    "provisioner",
    "permissions",
    "runtime-check",
    "owner-initializer",
  ])
    assert.match(section(name), /command: \["inspect"\]/);
});

test("shared Dockerfile accepts only local-owner or Cognito browser builds", async () => {
  const dockerfile = await readFile(
    join(root, "scripts/self-host/Dockerfile"),
    "utf8",
  );
  const buildStage =
    /^FROM \$\{NODE_IMAGE\} AS build\r?\n([\s\S]*?)^FROM /mu.exec(dockerfile);
  assert.ok(buildStage, "Missing shared build stage");
  assert.match(
    buildStage[1],
    /^ARG CLOUDMARKUP_BROWSER_AUTH_MODE=local-owner$/mu,
  );
  const validator = /^RUN node -e '([^'\r\n]+)'$/mu.exec(buildStage[1]);
  assert.ok(validator, "Missing executable browser mode validator");
  assert.equal(
    buildStage[1].indexOf("ARG CLOUDMARKUP_BROWSER_AUTH_MODE=local-owner") <
      validator.index && validator.index < buildStage[1].indexOf("COPY . ./"),
    true,
  );
  const run = promisify(execFile);
  const validate = (mode) => {
    const env = { ...process.env };
    delete env.CLOUDMARKUP_BROWSER_AUTH_MODE;
    if (mode !== undefined) env.CLOUDMARKUP_BROWSER_AUTH_MODE = mode;
    return run(process.execPath, ["-e", validator[1]], {
      env,
      windowsHide: true,
      maxBuffer: 8192,
    });
  };
  for (const mode of ["local-owner", "cognito"]) {
    assert.deepEqual(await validate(mode), { stdout: "", stderr: "" });
  }
  for (const mode of [
    undefined,
    "",
    "Cognito",
    "local-owner ",
    "legacy",
    "local-owner;cognito",
    '$(printf "unexpected")',
  ]) {
    await assert.rejects(validate(mode), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      assert.equal(
        error.stderr,
        "CLOUDMARKUP_BROWSER_AUTH_MODE must be local-owner or cognito.\n",
      );
      return true;
    });
  }
});
