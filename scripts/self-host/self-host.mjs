import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const objectRoot = "/data/cloudmarkup/objects";
const volumeRestoreMarker = "/data/cloudmarkup/.restore-incomplete";
export class SelfHostError extends Error {}
export function fail(message) {
  throw new SelfHostError(message);
}
export function isMain(url) {
  return (
    process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url
  );
}
export async function cli(main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof SelfHostError ? error.message : "Self-host operation failed. Check the documented prerequisites; credentials and child output are withheld."}\n`,
    );
    process.exitCode = 1;
  }
}
export async function privateFile(path) {
  if (!path || !isAbsolute(path)) fail("A private absolute file is required.");
  let current = resolve(path);
  const leaf = await lstat(current);
  if (!leaf.isFile() || leaf.isSymbolicLink())
    fail("A regular private file is required.");
  while (true) {
    const state = await lstat(current);
    if (state.isSymbolicLink())
      fail("Symlinked private configuration is refused.");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path;
}
export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
// Child output is captured privately, never echoed on failure (SQL/config may
// contain secrets). Binary archive streams bypass capture and go only to files.
export function run(
  args,
  { input, output, env = process.env, cwd = root, timeoutMilliseconds } = {},
) {
  if (timeoutMilliseconds !== undefined)
    transportInteger(timeoutMilliseconds, 1, 30000);
  return new Promise((accept, reject) => {
    const child = spawn("docker", args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "",
      length = 0,
      streamError,
      forceTimer;
    const timer =
      timeoutMilliseconds === undefined
        ? undefined
        : setTimeout(() => {
            streamError = new Error("Container control operation timed out.");
            child.kill();
            forceTimer = setTimeout(() => child.kill("SIGKILL"), 800);
            reject(streamError);
          }, timeoutMilliseconds);
    const stop = (error) => {
      streamError = error;
      child.kill();
    };
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stderr.resume(); // Drain privately; never echo credential-bearing output.
    if (output) {
      output.on("error", stop);
      child.stdout.pipe(output, { end: false });
    } else
      child.stdout.on("data", (bytes) => {
        length += bytes.length;
        if (length > 1024 * 1024)
          stop(new Error("Child output exceeded its bound."));
        else stdout += bytes.toString("utf8");
      });
    if (input) {
      input.on("error", stop);
      child.stdin.on("error", stop);
      input.pipe(child.stdin);
    }
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      if (streamError || code !== 0)
        reject(new Error("Container operation failed."));
      else accept(stdout.trim());
    });
  });
}

function transportInteger(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    fail("Invalid local-owner transport bound.");
}
export function transportTarget(packet) {
  if (packet?.mode !== "local-owner" || packet.server?.host !== "127.0.0.1")
    fail("Transport requires the existing loopback local-owner server.");
  transportInteger(packet.server.port, 1, 65535);
  let origin;
  try {
    origin = new URL(packet.server.publicOrigin);
  } catch {
    fail("Transport requires a canonical literal loopback HTTP origin.");
  }
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.origin !== packet.server.publicOrigin
  )
    fail("Transport requires a canonical literal loopback HTTP origin.");
  const listenPort = Number(origin.port || "80");
  transportInteger(listenPort, 1, 65535);
  return Object.freeze({
    publicOrigin: origin.origin,
    listenPort,
    targetPort: packet.server.port,
  });
}

// Executed only inside the matched image. The production parser owns the full
// private document and Linux path semantics; only this redacted tuple leaves it.
export const transportConfigurationProgram = String.raw`
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { parseSelfHostConfiguration } from '@cloudmarkup/api/self-host-configuration';
try {
  const path = '/run/secrets/self_host_configuration';
  if (process.getuid() !== 10001 || process.env.CLOUDMARKUP_SELF_HOST_CONFIGURATION_FILE !== path) throw new Error();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let raw;
  try {
    const state = await file.stat();
    if (!state.isFile() || state.size > 1048576) throw new Error();
    const bytes = Buffer.alloc(1048577);
    let count = 0;
    while (count < bytes.length) {
      const read = await file.read(bytes, count, bytes.length - count, count);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    if (count > 1048576) throw new Error();
    raw = JSON.parse(bytes.subarray(0, count).toString('utf8'));
  } finally { await file.close(); }
  const config = parseSelfHostConfiguration(raw);
  if (config.identity.mode !== 'local-owner' || config.server.host !== '127.0.0.1') throw new Error();
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: config.server.port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error()); }, 2000);
    socket.once('error', () => { clearTimeout(timer); reject(new Error()); });
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(); });
  });
  const { host, port, publicOrigin } = config.server;
  process.stdout.write(JSON.stringify({ mode: config.identity.mode, server: { host, port, publicOrigin } }));
} catch { process.stderr.write('Local-owner transport preflight failed.\n'); process.exitCode = 1; }
`;

export const transportHelperProgram = String.raw`
import { createConnection } from 'node:net';
const [portText, connectText, idleText, totalText, nonce] = process.argv.slice(1);
const integer = (text, minimum, maximum) => {
  if (!/^[0-9]+$/.test(text ?? '')) throw new Error('Invalid transport bound.');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('Invalid transport bound.');
  return value;
};
const port = integer(portText, 1, 65535), connectMs = integer(connectText, 100, 5000);
const idleMs = integer(idleText, 100, 60000), totalMs = integer(totalText, 100, 120000);
if (!/^[a-f0-9]{32}$/.test(nonce ?? '')) throw new Error('Invalid transport identity.');
process.stderr.write('cloudmarkup-transport-started\n');
const socket = createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
const stop = () => { socket.destroy(); process.stdin.destroy(); process.stdout.end(); };
const connectTimer = setTimeout(stop, connectMs), totalTimer = setTimeout(stop, totalMs);
socket.setTimeout(idleMs, stop);
socket.on('error', () => { process.exitCode = 1; stop(); });
process.stdin.on('error', stop); process.stdout.on('error', stop);
socket.once('connect', () => {
  clearTimeout(connectTimer);
  process.stderr.write('cloudmarkup-transport-connected\n');
  process.stdin.pipe(socket); socket.pipe(process.stdout);
});
socket.once('close', () => { clearTimeout(connectTimer); clearTimeout(totalTimer); process.stdin.destroy(); process.stdout.end(); });
`;

// Read-only disappearance check. No PID lookup followed by a signal is used.
export const transportDisappearanceProgram = String.raw`
import { open, readdir, readFile } from 'node:fs/promises';
try {
  const [nonce, expected] = process.argv.slice(1);
  if (process.getuid() !== 10001 || !/^[a-f0-9]{32}$/.test(nonce ?? '')) throw new Error();
  const pids = (await readdir('/proc')).filter((pid) => /^[0-9]+$/.test(pid));
  if (pids.length > 4096) throw new Error();
  let matched = 0;
  for (const pid of pids) {
    let args;
    try {
      const file = await open('/proc/' + pid + '/cmdline', 'r');
      try {
        const buffer = Buffer.alloc(16385), result = await file.read(buffer, 0, buffer.length, 0);
        if (result.bytesRead > 16384) throw new Error();
        args = buffer.subarray(0, result.bytesRead).toString('utf8').split('\0');
      } finally { await file.close(); }
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') continue; throw error; }
    const index = args.indexOf('--eval');
    if (index >= 0 && args[index + 1] === expected && args.includes(nonce)) {
      const status = await readFile('/proc/' + pid + '/status', 'utf8');
      if (!/^Uid:\s+10001\s+10001\s+10001\s+10001$/m.test(status)) throw new Error();
      matched++;
    }
  }
  process.stdout.write(JSON.stringify({ matched }));
} catch { process.stderr.write('Transport cleanup could not be verified.\n'); process.exitCode = 1; }
`;

function transportAuthority(state, id, expectedImage, project, startedAt) {
  if (
    state?.Id !== id ||
    state.Image !== expectedImage ||
    state.State?.Running !== true ||
    state.State.Paused !== false ||
    state.State.Restarting !== false ||
    state.State.OOMKilled !== false ||
    state.State.Dead !== false ||
    state.State.Status !== "running" ||
    typeof state.State.StartedAt !== "string" ||
    !state.State.StartedAt ||
    (startedAt !== undefined && state.State.StartedAt !== startedAt) ||
    state.Config?.User !== "10001:10001" ||
    state.Config.Labels?.["com.docker.compose.project"] !== project ||
    state.Config.Labels?.["com.docker.compose.service"] !== "app" ||
    state.Config.Labels?.["com.docker.compose.oneoff"] !== "False"
  )
    fail("Pinned local-owner container authority changed or is unavailable.");
  return state.State.StartedAt;
}
export async function admitLocalOwnerTransport({
  exec = run,
  env = process.env,
} = {}) {
  const project = composeArgs([], env)[2];
  const control = (args) => exec(args, { env, timeoutMilliseconds: 5000 });
  const id = (
    await control(composeArgs(["ps", "--all", "--quiet", "app"], env))
  ).trim();
  if (!/^[a-f0-9]{64}$/.test(id))
    fail("One full running application container identity is required.");
  const expectedImage = imageId(
    await control([
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      env.CLOUDMARKUP_SELF_HOST_IMAGE ?? "cloudmarkup-self-host:local",
    ]),
  );
  const inspect = async () =>
    JSON.parse(
      await control([
        "inspect",
        "--type",
        "container",
        "--format",
        "{{json .}}",
        id,
      ]),
    );
  const startedAt = transportAuthority(
    await inspect(),
    id,
    expectedImage,
    project,
  );
  const labels = JSON.parse(
    await control([
      "image",
      "inspect",
      "--format",
      "{{json .Config.Labels}}",
      expectedImage,
    ]),
  );
  if (labels?.["com.cloudmarkup.browser-auth-mode"] !== "local-owner")
    fail(
      "A matched image with explicit local-owner browser attestation is required.",
    );
  const target = transportTarget(
    JSON.parse(
      await control([
        "exec",
        "--user",
        "10001:10001",
        "--workdir",
        "/opt/cloudmarkup/apps/api",
        id,
        "node",
        "--input-type=module",
        "--eval",
        transportConfigurationProgram,
      ]),
    ),
  );
  const verify = async () =>
    transportAuthority(await inspect(), id, expectedImage, project, startedAt);
  await verify();
  return Object.freeze({ id, imageId: expectedImage, ...target, verify });
}

export async function startLocalOwnerTransport({
  exec = run,
  launch = spawn,
  env = process.env,
  maxConnections = 16,
  connectMilliseconds = 2000,
  idleMilliseconds = 30000,
  totalMilliseconds = 120000,
} = {}) {
  transportInteger(maxConnections, 1, 16);
  transportInteger(connectMilliseconds, 100, 5000);
  transportInteger(idleMilliseconds, 100, 60000);
  transportInteger(totalMilliseconds, 100, 120000);
  const authority = await admitLocalOwnerTransport({ exec, env });
  const connections = new Set();
  let stopping = false,
    failure,
    stopPromise,
    finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  const spawnDocker = (args, interactive) =>
    launch("docker", args, {
      cwd: root,
      env,
      shell: false,
      windowsHide: true,
      stdio: [interactive ? "pipe" : "ignore", "pipe", "pipe"],
    });
  const verifyGone = async (nonce) => {
    const until = Date.now() + 3000;
    do {
      await authority.verify();
      const reply = JSON.parse(
        await exec(
          [
            "exec",
            "--user",
            "10001:10001",
            authority.id,
            "node",
            "--input-type=module",
            "--eval",
            transportDisappearanceProgram,
            nonce,
            transportHelperProgram,
          ],
          { env, timeoutMilliseconds: 1000 },
        ),
      );
      if (reply.matched === 0) return;
      if (reply.matched !== 1) fail("Transport helper cleanup is ambiguous.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < until);
    fail("Transport helper cleanup remains unconfirmed.");
  };
  const server = createServer(
    { allowHalfOpen: true, pauseOnConnect: true },
    (socket) => {
      if (stopping || connections.size >= maxConnections) {
        socket.destroy();
        return;
      }
      let child,
        closed = false,
        started = false,
        header = "",
        killTimer,
        forceTimer;
      const nonce = randomBytes(16).toString("hex");
      let settle;
      const completion = new Promise((resolve) => {
        settle = resolve;
      });
      const entry = { socket, completion };
      connections.add(entry);
      const abort = () => socket.destroy();
      const connectTimer = setTimeout(abort, connectMilliseconds);
      const totalTimer = setTimeout(abort, totalMilliseconds);
      socket.setTimeout(idleMilliseconds, abort);
      socket.on("error", abort);
      const complete = async (successful) => {
        if (closed) return;
        closed = true;
        clearTimeout(killTimer);
        clearTimeout(forceTimer);
        clearTimeout(connectTimer);
        clearTimeout(totalTimer);
        if (successful) {
          socket.end();
          socket.destroySoon();
        } else socket.destroy();
        try {
          if (child) {
            if (!started)
              fail("Transport helper start/cleanup was not confirmed.");
            await verifyGone(nonce);
          }
        } catch {
          failure ??= new SelfHostError(
            "Transport helper cleanup remains unconfirmed.",
          );
          void stop(failure);
        } finally {
          connections.delete(entry);
          settle();
        }
      };
      socket.once("close", () => {
        clearTimeout(connectTimer);
        clearTimeout(totalTimer);
        if (!child) return;
        socket.unpipe(child.stdin);
        child.stdout.unpipe(socket);
        child.stdin.end();
        if (!closed) {
          killTimer = setTimeout(() => child.kill(), 200);
          forceTimer = setTimeout(() => child.kill("SIGKILL"), 800);
        }
      });
      void (async () => {
        try {
          await authority.verify();
          if (socket.destroyed || stopping) {
            await complete(false);
            return;
          }
          child = spawnDocker(
            [
              "exec",
              "--interactive",
              "--user",
              "10001:10001",
              authority.id,
              "node",
              "--input-type=module",
              "--eval",
              transportHelperProgram,
              ...[
                authority.targetPort,
                connectMilliseconds,
                idleMilliseconds,
                totalMilliseconds,
              ].map(String),
              nonce,
            ],
            true,
          );
          child.on("error", abort);
          child.stdin.on("error", abort);
          child.stdout.on("error", abort);
          child.stderr.on("data", (bytes) => {
            if (header.length >= 96) return;
            header += bytes.subarray(0, 96 - header.length).toString("ascii");
            if (header.startsWith("cloudmarkup-transport-started\n"))
              started = true;
            if (
              header.startsWith(
                "cloudmarkup-transport-started\ncloudmarkup-transport-connected\n",
              )
            )
              clearTimeout(connectTimer);
          }); // Bounded constant control frames only; never logged or forwarded.
          child.stderr.resume();
          child.once("close", (code) => {
            void complete(code === 0);
          });
          socket.pipe(child.stdin);
          child.stdout.pipe(socket);
          socket.resume();
        } catch {
          abort();
          await complete(false);
          void stop(
            new SelfHostError("Pinned local-owner transport preflight failed."),
          );
        }
      })();
    },
  );
  let monitor,
    monitorCompletion = Promise.resolve(),
    monitorForceTimer;
  function stop(error) {
    if (error) failure ??= error;
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      const entries = [...connections];
      for (const entry of entries) entry.socket.destroy();
      const listenerClosed = new Promise((resolve) => server.close(resolve));
      monitor?.kill();
      if (monitor)
        monitorForceTimer = setTimeout(() => monitor.kill("SIGKILL"), 800);
      let timer;
      try {
        await Promise.race([
          Promise.all([
            listenerClosed,
            monitorCompletion,
            ...entries.map((entry) => entry.completion),
          ]),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new SelfHostError("Transport shutdown remains unconfirmed."),
                ),
              8000,
            );
          }),
        ]);
      } catch (error) {
        failure ??= error;
      } finally {
        clearTimeout(timer);
        clearTimeout(monitorForceTimer);
        finish();
      }
    })();
    return stopPromise;
  }
  server.on("error", () => {
    void stop(
      new SelfHostError("Literal loopback transport port is unavailable."),
    );
  });
  try {
    monitor = spawnDocker(["wait", authority.id], false);
    monitorCompletion = new Promise((resolve) =>
      monitor.once("close", resolve),
    );
    monitor.stdout.resume();
    monitor.stderr.resume();
    monitor.on("error", () => {
      void stop(new SelfHostError("Pinned container monitor is unavailable."));
    });
    monitor.once("close", () => {
      if (!stopping)
        void stop(new SelfHostError("Pinned application container stopped."));
    });
    await authority.verify();
    if (stopping)
      fail("Pinned local-owner transport stopped during admission.");
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: authority.listenPort }, resolve);
    });
    if (stopping)
      fail("Pinned local-owner transport stopped during admission.");
  } catch {
    await stop(new SelfHostError("Local-owner transport admission failed."));
    throw failure;
  }
  return {
    publicOrigin: authority.publicOrigin,
    address: server.address(),
    activeConnections: () => connections.size,
    stop,
    async wait() {
      await done;
      if (failure) throw failure;
    },
  };
}

async function foregroundTransport() {
  await doctor((args) => run(args, { timeoutMilliseconds: 5000 }));
  validateImagePins();
  await assertNoIncompleteRestore();
  const transport = await startLocalOwnerTransport();
  const stop = () => {
    void transport.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    process.stdout.write(
      `Loopback transport listening at ${transport.publicOrigin}. Verify application readiness and native image/browser/session acceptance separately.\n`,
    );
    await transport.wait();
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await transport.stop();
  }
}
export function composeArgs(args, env = process.env) {
  const project = env.CLOUDMARKUP_SELF_HOST_PROJECT ?? "cloudmarkup-self-host";
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project))
    fail("Invalid Compose project.");
  if (env.CLOUDMARKUP_RETAINED_HISTORY_VOLUME)
    fail("Retained history is not admitted by the standalone core profile.");
  const retained = env.CLOUDMARKUP_PROVIDER_DISPATCH_DIRECTORY;
  const approval = env.CLOUDMARKUP_PROVIDER_DISPATCH_CONFIGURATION_SOURCE;
  const configuredModels = retained !== undefined || approval !== undefined;
  if (
    configuredModels &&
    [retained, approval].some(
      (path) => typeof path !== "string" || !isAbsolute(path),
    )
  )
    fail(
      "Configured models require explicit independent dispatch storage and its offline approval file.",
    );
  return [
    "compose",
    "--project-name",
    project,
    "--file",
    join(root, "scripts/self-host/compose.yml"),
    ...(configuredModels
      ? ["--file", join(root, "scripts/self-host/compose.models.yml")]
      : []),
    ...args,
  ];
}
export async function compose(args, options = {}) {
  return run(composeArgs(args, options.env), options);
}
export function imageId(value) {
  if (!/^(sha256:)?[a-f0-9]{64}$/.test(value))
    fail("An exact container image identity is required.");
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}
export async function containerVersion(exec = run, env = process.env) {
  const id = imageId(
    await exec([
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      env.CLOUDMARKUP_SELF_HOST_IMAGE ?? "cloudmarkup-self-host:local",
    ]),
  );
  // No runtime config, network or durable volumes are needed to inspect the
  // packaged source in this exact image. Never fingerprint the host checkout
  // as if it were the old running application during an upgrade.
  const value = JSON.parse(
    await exec([
      "run",
      "--rm",
      "--read-only",
      "--network",
      "none",
      "--user",
      "10001:10001",
      "--entrypoint",
      "node",
      id,
      "scripts/self-host/self-host.mjs",
      "version",
    ]),
  );
  return {
    imageId: id,
    packagedVersion: {
      migrations: value.migrations,
      installationProfile: value.installationProfile,
      lockfileSha256: value.lockfileSha256,
      node: value.node,
      packageManager: value.packageManager,
    },
  };
}
export async function doctor(exec = run) {
  if ((await exec(["info", "--format", "{{.OSType}}"])).trim() !== "linux")
    fail("Linux containers are required.");
  await exec(["compose", "version", "--short"]);
  return {
    containerOS: "linux",
    durableMount: "Docker-managed named volume; actual runtime probe required",
  };
}
export function validateImagePins(env = process.env) {
  for (const key of [
    "CLOUDMARKUP_NODE_IMAGE",
    "CLOUDMARKUP_GO_IMAGE",
    "CLOUDMARKUP_POSTGRES_IMAGE",
  ]) {
    if (
      typeof env[key] !== "string" ||
      !/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(env[key])
    )
      fail("Reviewed immutable image references are required.");
  }
}
export async function validatePrivateLocations(env = process.env) {
  if (
    env.CLOUDMARKUP_PROVIDER_DISPATCH_DIRECTORY !== undefined ||
    env.CLOUDMARKUP_PROVIDER_DISPATCH_CONFIGURATION_SOURCE !== undefined
  ) {
    composeArgs([], env);
    await outsideRepository(env.CLOUDMARKUP_PROVIDER_DISPATCH_DIRECTORY);
    await privateDirectory(env.CLOUDMARKUP_PROVIDER_DISPATCH_DIRECTORY);
    await outsideRepository(
      env.CLOUDMARKUP_PROVIDER_DISPATCH_CONFIGURATION_SOURCE,
    );
    await privateFile(env.CLOUDMARKUP_PROVIDER_DISPATCH_CONFIGURATION_SOURCE);
  }
  for (const key of [
    "CLOUDMARKUP_SELF_HOST_CONFIGURATION_SOURCE",
    "CLOUDMARKUP_POSTGRES_OWNER_PASSWORD_FILE",
    "CLOUDMARKUP_MIGRATOR_PASSWORD_FILE",
    "CLOUDMARKUP_OPERATOR_CONFIGURATION_SOURCE",
    "CLOUDMARKUP_PROVISIONING_CONFIGURATION_SOURCE",
    "CLOUDMARKUP_OWNER_CONFIGURATION_SOURCE",
  ]) {
    await outsideRepository(env[key]);
    await privateFile(env[key]);
  }
  await outsideRepository(env.CLOUDMARKUP_RUNTIME_SECRETS_DIRECTORY);
  await privateDirectory(env.CLOUDMARKUP_RUNTIME_SECRETS_DIRECTORY);
  await outsideRepository(env.CLOUDMARKUP_DATABASE_SECRETS_DIRECTORY);
  await privateDirectory(env.CLOUDMARKUP_DATABASE_SECRETS_DIRECTORY);
}
export async function exclusive(work, env = process.env) {
  const directory = stateDirectory(env);
  await mkdir(directory, { recursive: true });
  const lock = join(directory, "operator.lock");
  const handle = await open(lock, "wx", 0o600);
  try {
    await handle.writeFile(`${process.pid}\n`);
    await handle.sync();
    return await work();
  } finally {
    await handle.close();
    await unlink(lock);
  }
}
export function stateDirectory(env = process.env) {
  return join(root, ".cache/self-host", composeArgs([], env)[2]);
}
export async function assertNoIncompleteRestore(env = process.env) {
  try {
    await access(join(stateDirectory(env), "restore-incomplete"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  fail("An incomplete restore requires operator reconciliation.");
}
export async function stopAndVerify(exec = compose, inspect = run) {
  const id = (await exec(["ps", "--all", "--quiet", "app"])).trim();
  if (!/^[a-f0-9]{12,64}$/.test(id))
    fail("An existing runtime container is required for a drain receipt.");
  await exec(["stop", "--timeout", "120", "app"]);
  const state = JSON.parse(
    await inspect(["inspect", "--format", "{{json .State}}", id]),
  );
  if (
    state.Running !== false ||
    state.ExitCode !== 0 ||
    state.OOMKilled !== false ||
    state.Status !== "exited"
  )
    fail("Runtime drain was not confirmed; backup/start refused.");
  return {
    cleanRuntimeExit: true,
    runtimeImageId: imageId(
      await inspect(["inspect", "--format", "{{.Image}}", id]),
    ),
  };
}
export async function assertStopped(exec = compose, inspect = run) {
  const id = (await exec(["ps", "--all", "--quiet", "app"])).trim();
  if (!id) return;
  if (!/^[a-f0-9]{12,64}$/.test(id))
    fail("Invalid runtime container identity.");
  const state = JSON.parse(
    await inspect(["inspect", "--format", "{{json .State}}", id]),
  );
  if (state.Running || state.Status === "restarting")
    fail("Stop the runtime first.");
}
export async function auditObjects({
  sync = false,
  path = objectRoot,
  allowRestore = false,
} = {}) {
  if (process.platform !== "linux")
    fail("Linux object-volume operations are required.");
  if (!allowRestore) {
    try {
      await lstat(volumeRestoreMarker);
    } catch (error) {
      if (error.code === "ENOENT")
        return auditObjects({ sync, path, allowRestore: true });
      throw error;
    }
    fail("Object volume has an incomplete restore.");
  }
  let ancestor = path;
  while (true) {
    const state = await lstat(ancestor);
    if (!state.isDirectory() || state.isSymbolicLink())
      fail("Unsupported object ancestry.");
    if (sync) {
      const h = await open(ancestor, "r");
      try {
        await h.sync();
      } finally {
        await h.close();
      }
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const inventory = { files: 0, directories: 0, v1Candidates: 0 };
  async function visit(directory) {
    for (const name of await readdir(directory)) {
      const file = join(directory, name),
        state = await lstat(file);
      if (state.isSymbolicLink()) fail("Symlinked object archive is refused.");
      if (state.isDirectory()) {
        inventory.directories++;
        await visit(file);
      } else if (state.isFile()) {
        inventory.files++;
        if (name.endsWith(".metadata.json")) inventory.v1Candidates++;
        if (sync) {
          const h = await open(file, "r");
          try {
            await h.sync();
          } finally {
            await h.close();
          }
        }
      } else fail("Nonregular object archive is refused.");
    }
    if (sync) {
      const h = await open(directory, "r");
      try {
        await h.sync();
      } finally {
        await h.close();
      }
    }
  }
  await visit(path);
  return inventory;
}
async function restoreVolumeMarker(complete) {
  if (process.platform !== "linux")
    fail("Linux object-volume operations are required.");
  await privateDirectory(dirname(volumeRestoreMarker));
  if (complete) {
    const state = await lstat(volumeRestoreMarker);
    if (!state.isFile() || state.isSymbolicLink())
      fail("Invalid restore marker.");
    await unlink(volumeRestoreMarker);
  } else {
    const handle = await open(volumeRestoreMarker, "wx", 0o600);
    try {
      await handle.writeFile("Restore incomplete. Keep runtime stopped.\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  const directory = await open(dirname(volumeRestoreMarker), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function outsideRepository(path) {
  if (!path || !isAbsolute(path))
    fail("An absolute external backup path is required.");
  const result = resolve(path),
    rel = relative(root, result);
  if (!rel || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)))
    fail("Backups must be outside the repository/build context.");
  await privateDirectory(dirname(result));
  return result;
}
export async function privateDirectory(path) {
  if (!path || !isAbsolute(path))
    fail("A private absolute directory is required.");
  let current = resolve(path);
  while (true) {
    const state = await lstat(current);
    if (!state.isDirectory() || state.isSymbolicLink())
      fail("A regular unsymlinked directory is required.");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export async function main(command = process.argv[2]) {
  if (command === "transport") {
    await foregroundTransport();
    return;
  }
  if (
    command === "storage-restore-begin" ||
    command === "storage-restore-complete"
  ) {
    await restoreVolumeMarker(command === "storage-restore-complete");
    return;
  }
  if (
    command === "storage-audit" ||
    command === "storage-sync" ||
    command === "storage-empty"
  ) {
    const result = await auditObjects({
      sync: command === "storage-sync",
      allowRestore: command === "storage-sync",
    });
    if (command === "storage-empty" && (result.files || result.directories))
      fail("Restore requires an empty volume.");
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "inspect" || command === "version") {
    const { inspectMigrations, inspectStandaloneProfile } =
      await import("./bootstrap.mjs");
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    process.stdout.write(
      `${JSON.stringify({ node: (await readFile(join(root, ".node-version"), "utf8")).trim(), packageManager: pkg.packageManager, lockfileSha256: await sha256(join(root, "pnpm-lock.yaml")), migrations: await inspectMigrations(), installationProfile: await inspectStandaloneProfile(), runtimeEntry: "apps/api/dist/self-host/server.js", containerQualification: "pending" }, null, 2)}\n`,
    );
    return;
  }
  if (command === "doctor") {
    process.stdout.write(`${JSON.stringify(await doctor())}\n`);
    return;
  }
  if (command === "status") {
    process.stdout.write(
      `${await compose(["ps", "--all", "--format", "json"])}\n`,
    );
    return;
  }
  if (
    ![
      "build",
      "postgres:start",
      "bootstrap",
      ...Object.keys(operatorServices).map((stage) => `operator:${stage}`),
      "owner:initialize",
      "models:initialize",
      "start",
      "stop",
      "restart",
    ].includes(command)
  )
    fail("Unknown self-host command.");
  await doctor();
  validateImagePins();
  await validatePrivateLocations();
  await exclusive(async () => {
    if (command === "build") {
      await compose(["build", "app"]);
      return;
    }
    if (command === "postgres:start") {
      await compose(["up", "--detach", "--wait", "postgres"]);
      return;
    }
    if (command === "bootstrap") {
      await assertStopped();
      await compose(["run", "--rm", "--no-deps", "-T", "operator", "apply"]);
      return;
    }
    if (
      command.startsWith("operator:") ||
      command === "owner:initialize" ||
      command === "models:initialize"
    ) {
      await assertStopped();
      if (
        command === "models:initialize" &&
        process.env.CLOUDMARKUP_PROVIDER_DISPATCH_DIRECTORY === undefined
      )
        fail("Independent dispatch storage must be explicitly selected.");
      await compose(operatorInvocation(command));
      return;
    }
    if (command === "stop") {
      await stopAndVerify();
      return;
    }
    if (command === "restart") await stopAndVerify();
    await assertNoIncompleteRestore();
    await privateFile(process.env.CLOUDMARKUP_SELF_HOST_CONFIGURATION_SOURCE);
    await privateDirectory(
      process.env.CLOUDMARKUP_RUNTIME_SECRETS_DIRECTORY ?? "",
    );
    await compose(["up", "--detach", "--wait", "postgres"]);
    const inventory = JSON.parse(
      await compose([
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "--entrypoint",
        "node",
        "app",
        "scripts/self-host/self-host.mjs",
        "storage-audit",
      ]),
    );
    if (inventory.v1Candidates !== 0)
      fail("Legacy V1 inventory needs a verified opt-in migration proposal.");
    await compose(["up", "--detach", "--no-build", "app"]);
    const id = (await compose(["ps", "--all", "--quiet", "app"])).trim();
    if (!/^[a-f0-9]{12,64}$/.test(id))
      fail("Runtime container was not created.");
    const state = JSON.parse(
      await run(["inspect", "--format", "{{json .State}}", id]),
    );
    if (state.Running !== true)
      fail(
        "Runtime exited during startup; check D's redacted configuration diagnostics.",
      );
    // Compose start is not application readiness or release qualification.
    process.stdout.write(
      "Container started. Verify D readiness, browser authentication and feature qualification before use.\n",
    );
  });
}
const operatorServices = Object.freeze({
  admin: "provisioner",
  "restore-roles": "provisioner",
  roles: "provisioner",
  acl: "permissions",
  check: "runtime-check",
});
/** Closed controller routing; neither configuration nor HTTP selects a service. */
export function operatorInvocation(command) {
  if (command === "owner:initialize")
    return ["run", "--rm", "--no-deps", "-T", "owner-initializer", "apply"];
  if (command === "models:initialize")
    return ["run", "--rm", "--no-deps", "-T", "models-history", "provision"];
  const stage =
    typeof command === "string" && command.startsWith("operator:")
      ? command.slice("operator:".length)
      : "";
  if (!Object.hasOwn(operatorServices, stage)) fail("Unknown operator stage.");
  return ["run", "--rm", "--no-deps", "-T", operatorServices[stage], stage];
}
if (isMain(import.meta.url)) void cli(() => main());
