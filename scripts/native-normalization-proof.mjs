import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { constants } from "node:fs";
import {
  open,
  readFile,
  writeFile,
  mkdtemp,
  lstat,
  realpath,
  rm,
  rmdir,
  chmod,
} from "node:fs/promises";
import { resolve, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const OWNER = "cloudmarkup.anonymous-normalization-native-proof.v1";
const ADMISSION = "cloudmarkup.anonymous-normalization-parent-admission.v1";
const PARENT = "cloudmarkup.anonymous-normalization-parent.v1";
const ENV = {
  PATH: "/usr/bin:/bin",
  HOME: "/nonexistent",
  DOCKER_CONFIG: "/nonexistent",
};
const PARENT_ARGS = [
  "-i",
  "PATH=/usr/local/bin:/usr/bin:/bin",
  "HOME=/nonexistent",
  "GOTRACEBACK=none",
  "/usr/local/bin/node",
  "/proof/parent.mjs",
];
const SHA = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const PHASES = new Set([
  "preparation",
  "host-admission",
  "probe",
  "container-admission",
  "parent",
  "cleanup",
]);
const PARENT_PHASES = new Set([
  "parent-admission",
  "launcher",
  "normalization",
  "normalization-execution",
  "normalization-result",
  "normalization-model",
  "parent-cleanup",
]);
export function readClosedParentFailure(bytes) {
  if (bytes.length > 1024) return null;
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    return exactKeys(value, ["kind", "status", "phase"]) &&
      value.kind === PARENT &&
      value.status === "failed" &&
      PARENT_PHASES.has(value.phase)
      ? value.phase
      : null;
  } catch {
    return null;
  }
}
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export class ProofFailure extends Error {
  constructor(phase, parentFailure = null) {
    super("Native normalization proof failed.");
    this.phase = PHASES.has(phase) ? phase : "preparation";
    this.parentFailure =
      phase === "parent" && PARENT_PHASES.has(parentFailure)
        ? parentFailure
        : null;
  }
}
const requireValue = (condition, phase = "preparation") => {
  if (!condition) throw new ProofFailure(phase);
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function exactKeys(value, keys) {
  return (
    object(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}
function parse(bytes, phase) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ProofFailure(phase);
  }
}
export function parseManifest(value) {
  requireValue(
    exactKeys(value, [
      "kind",
      "sourceCommit",
      "closureSha256",
      "image",
      "imageId",
      "parent",
      "launcher",
      "compiler",
    ]),
  );
  requireValue(
    value.kind === "cloudmarkup.anonymous-normalization-native-closure.v1" &&
      /^[a-f0-9]{40}$/u.test(value.sourceCommit) &&
      SHA.test(value.closureSha256) &&
      /^node@sha256:[a-f0-9]{64}$/u.test(value.image) &&
      /^sha256:[a-f0-9]{64}$/u.test(value.imageId),
  );
  for (const key of ["parent", "launcher", "compiler"]) {
    const item = value[key];
    requireValue(
      exactKeys(item, ["path", "sha256", "bytes"]) &&
        typeof item.path === "string" &&
        isAbsolute(item.path) &&
        !/[\r\n,]/u.test(item.path) &&
        SHA.test(item.sha256) &&
        Number.isSafeInteger(item.bytes) &&
        item.bytes > 0 &&
        item.bytes <= (key === "parent" ? 33554432 : 134217728),
    );
  }
  requireValue(
    new Set([value.parent.path, value.launcher.path, value.compiler.path])
      .size === 3,
  );
  return value;
}
async function boundedFile(path, maximum) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    requireValue(stat.isFile() && stat.size > 0 && stat.size <= maximum);
    const bytes = await file.readFile();
    requireValue(bytes.length === stat.size);
    return bytes;
  } finally {
    await file.close();
  }
}
export async function preparePublicClosure(manifestPath, manifestSha) {
  requireValue(isAbsolute(manifestPath) && SHA.test(manifestSha));
  const bytes = await boundedFile(manifestPath, 16384);
  requireValue(sha(bytes) === manifestSha);
  const manifest = parseManifest(parse(bytes, "preparation"));
  for (const key of ["parent", "launcher", "compiler"]) {
    const item = manifest[key];
    // No symlinked path component and no content write/build here. These are
    // already reviewed public build outputs, independently pinned by manifest.
    requireValue((await realpath(item.path)) === item.path);
    const publicBytes = await boundedFile(item.path, item.bytes);
    requireValue(
      publicBytes.length === item.bytes && sha(publicBytes) === item.sha256,
    );
    if (key !== "parent")
      requireValue(((await lstat(item.path)).mode & 0o111) !== 0);
  }
  return manifest;
}
export function admitHost(value) {
  requireValue(
    exactKeys(value, ["kernel", "bootId", "swaps", "limits", "corePattern"]),
    "host-admission",
  );
  requireValue(
    typeof value.kernel === "string" &&
      value.kernel.length > 0 &&
      value.kernel.length < 256 &&
      !/microsoft|wsl|linuxkit/iu.test(value.kernel) &&
      UUID.test(value.bootId),
    "host-admission",
  );
  requireValue(
    typeof value.swaps === "string" &&
      value.swaps.trim().split(/\r?\n/u).length === 1 &&
      /^Filename\s+Type\s+Size\s+Used\s+Priority$/u.test(value.swaps.trim()),
    "host-admission",
  );
  requireValue(
    typeof value.limits === "string" &&
      /^Max core file size\s+0\s+0\s+bytes\s*$/mu.test(value.limits) &&
      /^(?:core|core\.%p)\n?$/u.test(value.corePattern),
    "host-admission",
  );
  return { bootId: value.bootId, kernelSha256: sha(value.kernel) };
}
async function readHost() {
  requireValue(
    process.platform === "linux" && process.arch === "x64",
    "host-admission",
  );
  requireValue(
    process.execArgv.length === 0 && !process.env.NODE_OPTIONS,
    "host-admission",
  );
  requireValue(
    (await lstat("/var/run/docker.sock")).isSocket(),
    "host-admission",
  );
  const names = [
    "/proc/sys/kernel/osrelease",
    "/proc/sys/kernel/random/boot_id",
    "/proc/swaps",
    "/proc/self/limits",
    "/proc/sys/kernel/core_pattern",
  ];
  const values = await Promise.all(names.map((name) => readFile(name, "utf8")));
  return {
    kernel: values[0].trim(),
    bootId: values[1].trim(),
    swaps: values[2],
    limits: values[3],
    corePattern: values[4],
  };
}
// Fixed public probe only. It runs before any factory/input and sees no tool or
// source mounts. Its output stays bounded and is reduced to boot/kernel hashes.
const PROBE =
  'const f=require("node:fs");const r=p=>f.readFileSync(p,"utf8");process.stdout.write(JSON.stringify({kernel:r("/proc/sys/kernel/osrelease").trim(),bootId:r("/proc/sys/kernel/random/boot_id").trim(),swaps:r("/proc/swaps"),limits:r("/proc/self/limits"),corePattern:r("/proc/sys/kernel/core_pattern")}));';

export function createCommandDeadline(timeout, now = () => performance.now()) {
  requireValue(Number.isFinite(timeout) && timeout > 0);
  const started = now();
  requireValue(Number.isFinite(started));
  const expires = started + timeout;
  return {
    isCurrent() {
      const value = now();
      return Number.isFinite(value) && value >= started && value < expires;
    },
    remainingMilliseconds() {
      const value = now();
      return Number.isFinite(value) && value >= started
        ? Math.max(0, expires - value)
        : 0;
    },
  };
}
export async function collectChild(
  child,
  phase,
  maximum,
  timeout,
  signal,
  deadline = createCommandDeadline(timeout),
) {
  let bytes = Buffer.alloc(0),
    stderrBytes = 0,
    failed = false;
  const stop = () => {
    failed = true;
    child.kill("SIGKILL");
  };
  const timer = setTimeout(stop, deadline.remainingMilliseconds());
  if (signal?.aborted) stop();
  signal?.addEventListener("abort", stop, { once: true });
  child.on("error", stop);
  child.stdout.on("data", (chunk) => {
    if (bytes.length + chunk.length > maximum) {
      stop();
      return;
    }
    bytes = Buffer.concat([bytes, chunk]);
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > 65536) stop();
  });
  child.stdout.on("error", stop);
  child.stderr.on("error", stop);
  try {
    const outcome = await new Promise((resolve) =>
      child.once("close", (code, signal) => resolve({ code, signal })),
    );
    // A failed parent can provide only its closed phase, never content or raw stderr.
    if (
      phase === "parent" &&
      !failed &&
      deadline.isCurrent() &&
      outcome.code === 1 &&
      outcome.signal === null &&
      stderrBytes === 0
    ) {
      throw new ProofFailure(phase, readClosedParentFailure(bytes));
    }
    requireValue(
      !failed &&
        deadline.isCurrent() &&
        outcome.code === 0 &&
        outcome.signal === null &&
        (phase !== "parent" || stderrBytes === 0),
      phase,
    );
    // stderr is never retained or forwarded. Successful public Docker commands
    // may emit harmless fixed warnings; candidate parent must emit none itself.
    return bytes;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
export async function runDocker(
  args,
  phase,
  maximum = 2097152,
  timeout = 15000,
  signal,
) {
  requireValue(!signal?.aborted, phase);
  const deadline = createCommandDeadline(timeout);
  const child = spawn(
    "/usr/bin/docker",
    ["--host", "unix:///var/run/docker.sock", ...args],
    {
      shell: false,
      env: ENV,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: "/",
    },
  );
  return collectChild(child, phase, maximum, timeout, signal, deadline);
}
export function baseArgs(name, runId) {
  return [
    "create",
    "--name",
    name,
    "--label",
    `cloudmarkup.owner=${OWNER}`,
    "--label",
    `cloudmarkup.run=${runId}`,
    "--pull",
    "never",
    "--network",
    "none",
    "--read-only",
    "--user",
    "65532:65532",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges=true",
    "--log-driver",
    "none",
    "--cpus",
    "1",
    "--memory",
    "512m",
    "--memory-swap",
    "512m",
    "--pids-limit",
    "64",
    "--ulimit",
    "core=0:0",
    "--ipc",
    "none",
    "--workdir",
    "/",
    "--entrypoint",
    "/usr/bin/env",
  ];
}
export function inspectContainer(value, expected) {
  const { name, runId, manifest, mounts, args } = expected;
  requireValue(
    object(value) &&
      SHA.test(value.Id) &&
      value.Name === `/${name}` &&
      value.Image === manifest.imageId &&
      value.Config?.Image === manifest.image &&
      value.Config.Labels?.["cloudmarkup.owner"] === OWNER &&
      value.Config.Labels?.["cloudmarkup.run"] === runId,
    "container-admission",
  );
  const h = value.HostConfig,
    core = h?.Ulimits?.find((item) => item.Name === "core");
  requireValue(
    object(h) &&
      (h.CapAdd === null || (Array.isArray(h.CapAdd) && h.CapAdd.length === 0)),
    "container-admission",
  );
  requireValue(
    h.NetworkMode === "none" &&
      h.ReadonlyRootfs === true &&
      h.Privileged === false &&
      JSON.stringify(h.CapDrop) === '["ALL"]' &&
      JSON.stringify(h.SecurityOpt) === '["no-new-privileges=true"]' &&
      h.LogConfig?.Type === "none" &&
      h.Memory === 536870912 &&
      h.MemorySwap === 536870912 &&
      h.PidsLimit === 64 &&
      h.NanoCpus === 1000000000 &&
      core?.Soft === 0 &&
      core.Hard === 0 &&
      h.IpcMode === "none" &&
      !h.PidMode &&
      !h.UTSMode &&
      !h.UsernsMode &&
      (h.Devices?.length ?? 0) === 0 &&
      (h.DeviceRequests?.length ?? 0) === 0 &&
      Object.keys(h.Tmpfs ?? {}).length === 0 &&
      (h.Links?.length ?? 0) === 0 &&
      value.Config.User === "65532:65532" &&
      value.Config.WorkingDir === "/" &&
      value.Path === "/usr/bin/env" &&
      JSON.stringify(value.Args) === JSON.stringify(args) &&
      value.State?.Running === false &&
      value.State?.Status === "created",
    "container-admission",
  );
  requireValue(
    Array.isArray(value.Mounts) && value.Mounts.length === mounts.length,
    "container-admission",
  );
  for (const expectedMount of mounts)
    requireValue(
      value.Mounts.some(
        (mount) =>
          mount.Type === "bind" &&
          mount.Source === expectedMount.source &&
          mount.Destination === expectedMount.target &&
          mount.RW === false &&
          mount.Propagation === "rprivate",
      ),
      "container-admission",
    );
  const networks = Object.keys(value.NetworkSettings?.Networks ?? {});
  requireValue(
    networks.length === 1 && networks[0] === "none",
    "container-admission",
  );
  return value.Id;
}
export function completedContainer(value, knownId, phase) {
  requireValue(
    SHA.test(knownId) &&
      value?.Id === knownId &&
      value.State?.Status === "exited" &&
      value.State.Running === false &&
      value.State.ExitCode === 0 &&
      value.State.OOMKilled === false,
    phase,
  );
}
async function inspect(id, phase, command = runDocker) {
  const result = parse(await command(["inspect", id], phase), phase);
  requireValue(Array.isArray(result) && result.length === 1, phase);
  return result[0];
}
export function parentReport(bytes, admission, admissionSha256) {
  requireValue(bytes.length <= 8192 && bytes.at(-1) === 10, "parent");
  const failedPhase = readClosedParentFailure(bytes);
  if (failedPhase !== null) throw new ProofFailure("parent", failedPhase);
  const value = parse(bytes, "parent");
  requireValue(
    exactKeys(value, [
      "kind",
      "status",
      "admissionSha256",
      "runId",
      "containerId",
      "closureSha256",
      "launcherSha256",
      "compilerSha256",
      "inputs",
      "stdoutBytes",
      "stdoutSha256",
      "expectedModelDigest",
      "observedModelDigest",
      "equal",
      "stderrBytes",
      "exitCode",
    ]),
    "parent",
  );
  requireValue(
    value.kind === PARENT &&
      value.status === "passed" &&
      value.admissionSha256 === admissionSha256 &&
      value.runId === admission.runId &&
      value.containerId === admission.containerId &&
      value.closureSha256 === admission.closureSha256 &&
      value.launcherSha256 === admission.launcherSha256 &&
      value.compilerSha256 === admission.compilerSha256 &&
      value.equal === true &&
      value.stderrBytes === 0 &&
      value.exitCode === 0 &&
      Number.isSafeInteger(value.stdoutBytes) &&
      value.stdoutBytes > 0 &&
      value.stdoutBytes <= 2097152 &&
      SHA.test(value.stdoutSha256) &&
      /^sha256:[a-f0-9]{64}$/u.test(value.expectedModelDigest) &&
      value.expectedModelDigest === value.observedModelDigest,
    "parent",
  );
  requireValue(
    Array.isArray(value.inputs) && value.inputs.length === 3,
    "parent",
  );
  for (const [index, kind] of [
    "architecture",
    "workload",
    "solution-revision",
  ].entries()) {
    const input = value.inputs[index];
    requireValue(
      exactKeys(input, ["kind", "byteLength", "sha256"]) &&
        input.kind === kind &&
        Number.isSafeInteger(input.byteLength) &&
        input.byteLength > 0 &&
        input.byteLength <= 1048576 &&
        SHA.test(input.sha256),
      "parent",
    );
  }
  return value;
}
async function cleanupOwned(name, runId, manifest, knownId, command) {
  const ids = (
    await command(
      [
        "container",
        "ls",
        "-a",
        "--no-trunc",
        "--filter",
        `name=^/${name}$`,
        "--format",
        "{{.ID}}",
      ],
      "cleanup",
      4096,
    )
  )
    .toString()
    .trim();
  if (!ids) {
    if (knownId !== null) {
      const remaining = (
        await command(
          [
            "container",
            "ls",
            "-a",
            "--no-trunc",
            "--filter",
            `id=${knownId}`,
            "--format",
            "{{.ID}}",
          ],
          "cleanup",
          4096,
        )
      )
        .toString()
        .trim();
      requireValue(remaining === "", "cleanup");
    }
    return;
  }
  requireValue(SHA.test(ids), "cleanup");
  const list = parse(await command(["inspect", name], "cleanup"), "cleanup");
  requireValue(Array.isArray(list) && list.length === 1, "cleanup");
  const current = list[0];
  requireValue(
    current.Name === `/${name}` &&
      current.Config?.Labels?.["cloudmarkup.owner"] === OWNER &&
      current.Config.Labels?.["cloudmarkup.run"] === runId &&
      current.Image === manifest.imageId &&
      SHA.test(current.Id) &&
      ids === current.Id &&
      (knownId === null || current.Id === knownId),
    "cleanup",
  );
  await command(["rm", "--force", current.Id], "cleanup", 4096);
  const remaining = (
    await command(
      [
        "container",
        "ls",
        "-a",
        "--no-trunc",
        "--filter",
        `id=${current.Id}`,
        "--format",
        "{{.ID}}",
      ],
      "cleanup",
      4096,
    )
  )
    .toString()
    .trim();
  requireValue(remaining === "", "cleanup");
}
// Normal cleanup never substitutes a freshly discovered same-name container.
export async function removeOwned(
  name,
  runId,
  manifest,
  knownId,
  command = runDocker,
) {
  requireValue(SHA.test(knownId), "cleanup");
  return cleanupOwned(name, runId, manifest, knownId, command);
}
// Only a create attempt without a returned/inspected full ID may use this path.
export async function removeUncertainCreation(
  name,
  runId,
  manifest,
  command = runDocker,
) {
  return cleanupOwned(name, runId, manifest, null, command);
}
export function creationId(bytes) {
  const value = bytes.toString("utf8").trim();
  requireValue(SHA.test(value), "container-admission");
  return value;
}

export async function supervise(manifestPath, manifestSha, recordDirectory) {
  requireValue(
    isAbsolute(recordDirectory) &&
      (await realpath(recordDirectory)) === recordDirectory,
  );
  const abort = new AbortController();
  const interrupt = () => {
    abort.abort();
  };
  const command = (args, stage, maximum, timeout) =>
    runDocker(args, stage, maximum, timeout, abort.signal);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  let phase = "preparation",
    failure = null,
    parentFailure = null,
    cleanup = "not-created",
    result;
  const runId = randomUUID(),
    name = `cloudmarkup-normalize-${runId}`,
    probeName = `${name}-probe`;
  let manifest,
    scratch,
    attempted = false,
    probeAttempted = false,
    admissionRecord;
  let proofId = null,
    probeId = null;
  try {
    manifest = await preparePublicClosure(manifestPath, manifestSha);
    requireValue(
      isAbsolute(recordDirectory) &&
        (await realpath(recordDirectory)) === recordDirectory,
    );
    phase = "host-admission";
    const host = await readHost(),
      hostIdentity = admitHost(host);
    const engine = parse(
      await command(["info", "--format", "{{json .}}"], phase),
      phase,
    );
    requireValue(
      engine.OSType === "linux" &&
        engine.KernelVersion === host.kernel &&
        typeof engine.ID === "string" &&
        engine.ID.length > 0,
      phase,
    );
    const image = parse(
      await command(["image", "inspect", manifest.image], phase),
      phase,
    );
    requireValue(
      Array.isArray(image) &&
        image.length === 1 &&
        image[0].Id === manifest.imageId &&
        image[0].Os === "linux" &&
        image[0].Architecture === "amd64" &&
        image[0].RepoDigests?.includes(manifest.image) &&
        Object.keys(image[0].Config?.Volumes ?? {}).length === 0,
      phase,
    );
    phase = "probe";
    const probeArgs = [
      "-i",
      "PATH=/usr/local/bin:/usr/bin:/bin",
      "HOME=/nonexistent",
      "GOTRACEBACK=none",
      "/usr/local/bin/node",
      "-e",
      PROBE,
    ];
    probeAttempted = true;
    probeId = creationId(
      await command(
        [...baseArgs(probeName, runId), manifest.image, ...probeArgs],
        phase,
        4096,
      ),
    );
    const probeInspection = await inspect(probeId, phase, command);
    requireValue(
      inspectContainer(probeInspection, {
        name: probeName,
        runId,
        manifest,
        mounts: [],
        args: probeArgs,
      }) === probeId,
      phase,
    );
    const probe = parse(
      await command(["start", "--attach", probeId], phase, 16384),
      phase,
    );
    const probeIdentity = admitHost(probe);
    requireValue(
      probeIdentity.bootId === hostIdentity.bootId &&
        probeIdentity.kernelSha256 === hostIdentity.kernelSha256,
      phase,
    );
    const endedProbe = await inspect(probeId, phase, command);
    completedContainer(endedProbe, probeId, phase);
    await removeOwned(probeName, runId, manifest, probeId);
    probeAttempted = false;
    // Only metadata is written to the host. The actual parent factory has not run.
    scratch = await mkdtemp(
      resolve(recordDirectory, "native-normalization-admission-"),
    );
    const admissionPath = resolve(scratch, "admission.json");
    await writeFile(admissionPath, "{}\n", { mode: 0o644 });
    const mounts = [
      { source: manifest.parent.path, target: "/proof/parent.mjs" },
      { source: manifest.launcher.path, target: "/proof/launcher" },
      { source: manifest.compiler.path, target: "/proof/compiler" },
      { source: admissionPath, target: "/proof/admission.json" },
    ];
    phase = "container-admission";
    attempted = true;
    proofId = creationId(
      await command(
        [
          ...baseArgs(name, runId),
          ...mounts.flatMap((mount) => [
            "--mount",
            `type=bind,source=${mount.source},target=${mount.target},readonly,bind-propagation=rprivate`,
          ]),
          manifest.image,
          ...PARENT_ARGS,
        ],
        phase,
        4096,
      ),
    );
    const inspected = await inspect(proofId, phase, command);
    const containerId = inspectContainer(inspected, {
      name,
      runId,
      manifest,
      mounts,
      args: PARENT_ARGS,
    });
    requireValue(containerId === proofId, phase);
    const admission = {
      kind: ADMISSION,
      runId,
      containerId,
      imageDigest: manifest.image,
      imageId: manifest.imageId,
      daemonIdSha256: sha(engine.ID),
      ...hostIdentity,
      closureSha256: manifest.closureSha256,
      parentSha256: manifest.parent.sha256,
      launcherSha256: manifest.launcher.sha256,
      compilerSha256: manifest.compiler.sha256,
    };
    const admissionBytes = Buffer.from(JSON.stringify(admission) + "\n");
    // Same inode: the unstarted container already holds this exact RO bind.
    await writeFile(admissionPath, admissionBytes);
    await chmod(admissionPath, 0o444);
    requireValue(
      sha(await readFile(admissionPath)) === sha(admissionBytes),
      phase,
    );
    await preparePublicClosure(manifestPath, manifestSha);
    const before = admitHost(await readHost());
    requireValue(
      before.bootId === hostIdentity.bootId &&
        before.kernelSha256 === hostIdentity.kernelSha256,
      phase,
    );
    // Retain the actual inspected fields in sanitized metadata before admission.
    admissionRecord = {
      admission,
      admissionSha256: sha(admissionBytes),
      sourceCommit: manifest.sourceCommit,
      manifestSha256: manifestSha,
      containerId,
      imageId: inspected.Image,
      inspectedMounts: inspected.Mounts.map((mount) => ({
        source: mount.Source,
        target: mount.Destination,
        type: mount.Type,
        readonly: !mount.RW,
        propagation: mount.Propagation,
      })),
      controls: {
        network: inspected.HostConfig.NetworkMode,
        readonlyRoot: inspected.HostConfig.ReadonlyRootfs,
        user: inspected.Config.User,
        capDrop: inspected.HostConfig.CapDrop,
        securityOpt: inspected.HostConfig.SecurityOpt,
        logDriver: inspected.HostConfig.LogConfig.Type,
        memory: inspected.HostConfig.Memory,
        memorySwap: inspected.HostConfig.MemorySwap,
        nanoCpus: inspected.HostConfig.NanoCpus,
        pids: inspected.HostConfig.PidsLimit,
        core: inspected.HostConfig.Ulimits,
      },
      nativeProbe: {
        containerId: probeInspection.Id,
        ...probeIdentity,
        cleanup: "removed-and-absence-checked",
      },
    };
    await writeFile(
      resolve(recordDirectory, `${runId}.admission.json`),
      JSON.stringify(admissionRecord, null, 2) + "\n",
      { flag: "wx" },
    );
    phase = "parent";
    const bytes = await command(
      ["start", "--attach", containerId],
      phase,
      8192,
      45000,
    );
    result = parentReport(bytes, admission, sha(admissionBytes));
    const ended = await inspect(containerId, phase, command);
    completedContainer(ended, containerId, phase);
    const after = admitHost(await readHost());
    requireValue(
      after.bootId === hostIdentity.bootId &&
        after.kernelSha256 === hostIdentity.kernelSha256,
      phase,
    );
    await preparePublicClosure(manifestPath, manifestSha);
  } catch (error) {
    failure = error instanceof ProofFailure ? error.phase : phase;
    parentFailure = error instanceof ProofFailure ? error.parentFailure : null;
  } finally {
    try {
      if (manifest && attempted) {
        if (proofId !== null) await removeOwned(name, runId, manifest, proofId);
        else await removeUncertainCreation(name, runId, manifest);
      }
      if (manifest && probeAttempted) {
        if (probeId !== null)
          await removeOwned(probeName, runId, manifest, probeId);
        else await removeUncertainCreation(probeName, runId, manifest);
      }
      cleanup =
        attempted || probeAttempted
          ? "removed-and-absence-checked"
          : "not-created";
      if (scratch) {
        requireValue(
          dirname(scratch) === recordDirectory &&
            scratch.startsWith(
              resolve(recordDirectory, "native-normalization-admission-"),
            ),
          "cleanup",
        );
        // Only the exact task-owned metadata file/directory; no recursive delete.
        await rm(resolve(scratch, "admission.json"));
        await rmdir(scratch);
      }
    } catch {
      cleanup = "unresolved";
      failure ??= "cleanup";
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
  }
  if (abort.signal.aborted) failure ??= phase;
  const report = {
    kind: "cloudmarkup.anonymous-normalization-native-proof.v1",
    runId,
    status: failure === null ? "passed" : "failed",
    failurePhase: failure,
    parentFailure,
    interrupted: abort.signal.aborted,
    cleanup,
    admissionSha256: admissionRecord?.admissionSha256 ?? null,
    result: failure === null ? result : null,
  };
  // Only validated metadata reaches a retained file; arbitrary command output never does.
  await writeFile(
    resolve(recordDirectory, `${runId}.result.json`),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stdout.on("error", () => {
    process.exitCode = 1;
  });
  try {
    requireValue(
      process.argv.length === 8 &&
        process.argv[2] === "--manifest" &&
        process.argv[4] === "--manifest-sha256" &&
        process.argv[6] === "--records",
    );
    const report = await supervise(
      process.argv[3],
      process.argv[5],
      process.argv[7],
    );
    process.stdout.write(
      JSON.stringify({
        status: report.status,
        failurePhase: report.failurePhase,
        parentFailure: report.parentFailure,
        cleanup: report.cleanup,
      }) + "\n",
    );
    if (report.status !== "passed") process.exitCode = 1;
  } catch {
    process.exitCode = 1;
    process.stdout.write('{"status":"failed","failurePhase":"preparation"}\n');
  }
}
