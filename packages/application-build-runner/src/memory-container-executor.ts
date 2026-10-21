import {
  applicationHostRepairCandidatePolicyV1Schema,
  type ApplicationHostRepairCandidatePolicyV1,
} from "./host-repair-candidate-contracts.js";
import {
  applicationHostRepairSeedPolicyV1Schema,
  type ApplicationHostRepairSeedPolicyV1,
} from "./host-repair-seed-contracts.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { z } from "zod";

import { isApprovedApplicationBuildInvocation } from "./commands.js";
import {
  applicationBuildLimitsV1Schema,
  applicationBuildPolicyV1Schema,
  applicationBuildSourceFileV1Schema,
  applicationDependencyLockV1Schema,
  type ApplicationBuildCommandInvocation,
  type ApplicationBuildCommandResult,
  type ApplicationBuildLimitsV1,
  type ApplicationBuildPolicyV1,
  type ApplicationBuildProducedFile,
  type ApplicationBuildWorkspaceExecutor,
  type ApplicationBuildWorkspaceSession,
  type ApplicationDependencyLockV1,
} from "./contracts.js";
import {
  runMemoryContainerProcess,
  type MemoryContainerProcessRunner,
} from "./memory-container-process.js";
import {
  assertNoCoreDumps,
  assertNoSwap,
  decodeMemoryAuthority,
  encodeMemoryAuthority,
  kernelBootIdSchema,
  MEMORY_CACHE_ROOT,
  MEMORY_CACHE_MAX_BYTES,
  MEMORY_PROTOCOL_MAX_BYTES,
  MEMORY_WORKSPACE_HELPER,
  MEMORY_WORKSPACE_PROTOCOL,
  MEMORY_WORKSPACE_ROOT,
  MEMORY_TEMPORARY_ROOT,
  temporaryMemoryBytes,
  memoryResponseLimit,
  memoryWorkspaceRequestSchema,
  memoryWorkspaceResponseSchema,
  validateMemorySeed,
  workspaceMemoryBytes,
  type MemoryWorkspaceRequest,
  type MemoryWorkspaceResponse,
} from "./memory-workspace-protocol.js";
import { canonicalJson, sha256Digest } from "./security.js";
import {
  parseMemoryWorkspaceHelperFailure,
  recordMemoryApplicationBuildFailure,
  type MemoryWorkspaceOpenStage,
} from "./memory-workspace-diagnostics.js";
import {
  assertExactAuthority,
  assertWorkspaceAuthority,
  subtreeAuthority,
  type WorkspaceAuthority,
} from "./workspace-authority.js";

const OWNER = "cloudmarkup.application-memory-workspace.v1";
const HELPER_LABEL = "cloudmarkup.memory-workspace.sha256";
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const labelsSchema = z.record(z.string(), z.string());
const engineSchema = z.object({
  OSType: z.string(),
  OperatingSystem: z.string(),
  KernelVersion: z.string(),
});
const imageSchema = z
  .array(
    z.object({
      Id: z.string(),
      Config: z.object({
        Labels: labelsSchema,
        Volumes: z.record(z.string(), z.unknown()).nullable().optional(),
      }),
    }),
  )
  .length(1);
const volumeSchema = z
  .array(
    z.object({
      Name: z.string(),
      Driver: z.string(),
      Scope: z.string(),
      Labels: labelsSchema,
      Options: z.record(z.string(), z.string()),
    }),
  )
  .length(1);
const containerSchema = z
  .array(
    z.object({
      Name: z.string(),
      Config: z.object({
        Image: z.string(),
        User: z.string(),
        Labels: labelsSchema,
      }),
      State: z.object({ Running: z.boolean() }),
      HostConfig: z.object({
        NetworkMode: z.string(),
        ReadonlyRootfs: z.boolean(),
        Privileged: z.boolean(),
        CapAdd: z.array(z.string()).nullable(),
        CapDrop: z.array(z.string()),
        SecurityOpt: z.array(z.string()),
        LogConfig: z.object({ Type: z.string() }),
        Memory: z.number(),
        MemorySwap: z.number(),
        PidsLimit: z.number(),
        NanoCpus: z.number(),
        Tmpfs: z.record(z.string(), z.string()).nullable().optional(),
        Ulimits: z.array(
          z.object({ Name: z.string(), Soft: z.number(), Hard: z.number() }),
        ),
        Binds: z.array(z.string()).nullable(),
      }),
      Mounts: z.array(
        z.object({
          Type: z.string(),
          Name: z.string().optional(),
          Destination: z.string(),
          RW: z.boolean(),
        }),
      ),
    }),
  )
  .length(1);

export interface MemoryApplicationBuildContainerConfig {
  readonly containerRuntimeExecutable: string;
  readonly policy: ApplicationBuildPolicyV1;
  /** SHA-256 of the exact installed successor helper bundle; never a candidate value. */
  readonly helperDigest: string;
  readonly cacheBytes: number;
}

export interface MemoryHostRepairSeedContainerConfig extends Omit<
  MemoryApplicationBuildContainerConfig,
  "policy"
> {
  readonly policy: ApplicationHostRepairSeedPolicyV1;
}
export interface MemoryHostRepairCandidateContainerConfig extends Omit<
  MemoryApplicationBuildContainerConfig,
  "policy"
> {
  readonly policy: ApplicationHostRepairCandidatePolicyV1;
}
interface MemoryIsolationConfig extends Omit<
  MemoryApplicationBuildContainerConfig,
  "policy"
> {
  readonly container: ApplicationBuildPolicyV1["container"];
}

interface NativeMemoryHost {
  readonly platform: string;
  readonly kernelBootId: string;
  readonly kernelVersion: string;
  readonly swaps: string;
  readonly coreLimits: string;
  readonly corePattern: string;
  readonly diagnosticArguments: readonly string[];
}

async function readNativeMemoryHost(): Promise<NativeMemoryHost> {
  if (process.platform !== "linux")
    throw new TypeError(
      "Memory-only builds require a native Linux runner; Docker Desktop is not admitted.",
    );
  return {
    platform: process.platform,
    kernelBootId: (
      await readFile("/proc/sys/kernel/random/boot_id", "utf8")
    ).trim(),
    kernelVersion: (
      await readFile("/proc/sys/kernel/osrelease", "utf8")
    ).trim(),
    swaps: await readFile("/proc/swaps", "utf8"),
    coreLimits: await readFile("/proc/self/limits", "utf8"),
    corePattern: await readFile("/proc/sys/kernel/core_pattern", "utf8"),
    diagnosticArguments: [
      ...process.execArgv,
      process.env["NODE_OPTIONS"] ?? "",
    ],
  };
}

function admitNativeMemoryHost(host: NativeMemoryHost): string {
  if (
    host.platform !== "linux" ||
    /microsoft|wsl|linuxkit/iu.test(host.kernelVersion)
  )
    throw new TypeError(
      "Memory execution requires native Linux, not a host-paged Docker VM.",
    );
  assertNoSwap(host.swaps);
  assertNoCoreDumps(host.coreLimits, host.corePattern);
  if (
    host.diagnosticArguments.some((argument) =>
      /--(?:heap-prof|heapsnapshot|build-snapshot)(?:[=\s-]|$)/u.test(argument),
    )
  )
    throw new TypeError(
      "Memory-only execution cannot run with automatic heap snapshot persistence.",
    );
  return kernelBootIdSchema.parse(host.kernelBootId);
}

/** Call before receiving temporary candidate bytes; this is not a durable receipt. */
export async function assertMemoryApplicationBuildHost(): Promise<void> {
  admitNativeMemoryHost(await readNativeMemoryHost());
}

interface MemoryExecutorSeam {
  readonly runProcess: MemoryContainerProcessRunner;
  readonly readHost: () => Promise<NativeMemoryHost>;
  readonly randomId: () => string;
}

function passed(result: ApplicationBuildCommandResult): boolean {
  return result.termination === "completed" && result.exitCode === 0;
}
function listed(text: string, name: string): boolean {
  return text.split(/\r?\n/u).some((line) => line.trim() === name);
}
function tmpfsOptions(bytes: number, noexec = false): Record<string, string> {
  return {
    type: "tmpfs",
    device: "tmpfs",
    o: `size=${String(bytes)},uid=65532,gid=65532,mode=0700,nosuid,nodev,noswap${noexec ? ",noexec" : ""}`,
  };
}
function exactLabels(labels: Record<string, string>, token: string): boolean {
  return (
    labels["cloudmarkup.owner"] === OWNER &&
    labels["cloudmarkup.cleanup-token"] === token
  );
}

class MemoryApplicationBuildSession implements ApplicationBuildWorkspaceSession {
  readonly #config: MemoryIsolationConfig;
  readonly #signal: AbortSignal | undefined;
  readonly #seam: MemoryExecutorSeam;
  readonly #limits: ApplicationBuildLimitsV1;
  readonly #lock: ApplicationDependencyLockV1;
  readonly #bootId: string;
  readonly #token: string;
  readonly #workspace: string;
  readonly #cache: string;
  readonly #holder: string;
  readonly #containers = new Set<string>();
  readonly #volumes = new Map<
    string,
    { readonly bytes: number; readonly noexec: boolean }
  >();
  #sequence = 0;
  #source: WorkspaceAuthority | undefined;
  #installed: WorkspaceAuthority | undefined;
  #compiled: WorkspaceAuthority | undefined;
  #pruned = false;
  #closed = false;
  #failed = false;
  #busy = false;

  constructor(
    config: MemoryIsolationConfig,
    seam: MemoryExecutorSeam,
    limits: ApplicationBuildLimitsV1,
    lock: ApplicationDependencyLockV1,
    bootId: string,
    signal?: AbortSignal,
  ) {
    this.#config = config;
    this.#seam = seam;
    this.#limits = limits;
    this.#lock = lock;
    this.#bootId = bootId;
    this.#signal = signal;
    this.#token = kernelBootIdSchema.parse(seam.randomId());
    const prefix = `cloudmarkup-memory-app-${this.#token}`;
    this.#workspace = `${prefix}-workspace`;
    this.#cache = `${prefix}-cache`;
    this.#holder = `${prefix}-holder`;
  }

  #image(): string {
    return `${this.#config.container.image}@${this.#config.container.digest}`;
  }
  #control(
    args: readonly string[],
    stdin?: Uint8Array,
    maximum = this.#limits.maxOutputBytes,
    signal?: AbortSignal,
    cleanup = false,
  ): Promise<ApplicationBuildCommandResult> {
    const signals = [this.#signal, signal].filter(
      (value): value is AbortSignal => value !== undefined,
    );
    const active =
      cleanup || signals.length === 0 ? undefined : AbortSignal.any(signals);
    if (active?.aborted === true)
      return Promise.resolve({
        exitCode: null,
        outputBytes: 0,
        stderr: "",
        stdout: "",
        termination: "cancelled",
      });
    return this.#seam.runProcess({
      executable: this.#config.containerRuntimeExecutable,
      args,
      limits: cleanup
        ? { ...this.#limits, wallTimeMilliseconds: 5000 }
        : this.#limits,
      ...(stdin === undefined ? {} : { stdin }),
      maxOutputBytes: maximum,
      ...(active === undefined ? {} : { signal: active }),
    });
  }
  async #required(args: readonly string[], cleanup = false): Promise<string> {
    const result = await this.#control(
      args,
      undefined,
      this.#limits.maxOutputBytes,
      undefined,
      cleanup,
    );
    if (!passed(result))
      throw new TypeError("Memory container control operation failed closed.");
    return result.stdout;
  }
  async #host(): Promise<void> {
    if (admitNativeMemoryHost(await this.#seam.readHost()) !== this.#bootId)
      throw new TypeError(
        "Memory-only host identity changed or is unavailable.",
      );
  }
  async #absent(
    kind: "container" | "volume",
    name: string,
    cleanup = false,
  ): Promise<boolean> {
    const args =
      kind === "container"
        ? [
            "container",
            "ls",
            "--all",
            "--format",
            "{{.Names}}",
            "--filter",
            `name=${name}`,
          ]
        : ["volume", "ls", "--format", "{{.Name}}", "--filter", `name=${name}`];
    return !listed(await this.#required(args, cleanup), name);
  }
  async #volume(
    name: string,
    bytes: number,
    noexec = false,
    cleanup = false,
  ): Promise<void> {
    const [volume] = volumeSchema.parse(
      JSON.parse(
        await this.#required(["volume", "inspect", name], cleanup),
      ) as unknown,
    );
    if (
      volume?.Name !== name ||
      volume.Driver !== "local" ||
      volume.Scope !== "local" ||
      !exactLabels(volume.Labels, this.#token) ||
      canonicalJson(volume.Options) !==
        canonicalJson(tmpfsOptions(bytes, noexec))
    )
      throw new TypeError(
        "Memory workspace volume is not the exact owned tmpfs configuration.",
      );
  }
  async #createVolume(
    name: string,
    bytes: number,
    noexec = false,
  ): Promise<void> {
    if (!(await this.#absent("volume", name)))
      throw new TypeError("Memory workspace resource name already exists.");
    this.#volumes.set(name, { bytes, noexec });
    await this.#required([
      "volume",
      "create",
      "--driver",
      "local",
      "--label",
      `cloudmarkup.owner=${OWNER}`,
      "--label",
      `cloudmarkup.cleanup-token=${this.#token}`,
      ...Object.entries(tmpfsOptions(bytes, noexec)).flatMap(([key, value]) => [
        "--opt",
        `${key}=${value}`,
      ]),
      name,
    ]);
    await this.#volume(name, bytes, noexec);
  }
  #containerArgs(
    name: string,
    entrypoint: string,
    args: readonly string[],
    writable: boolean,
    cacheWritable: boolean,
  ): string[] {
    const memory = this.#limits.memoryMiB * 1024 * 1024;
    return [
      "create",
      "--name",
      name,
      "--label",
      `cloudmarkup.owner=${OWNER}`,
      "--label",
      `cloudmarkup.cleanup-token=${this.#token}`,
      "--pull",
      "never",
      "--platform",
      this.#config.container.platform,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--log-driver",
      "none",
      "--pids-limit",
      String(this.#limits.maxProcesses),
      "--memory",
      String(memory),
      "--memory-swap",
      String(memory),
      "--cpus",
      "1.0",
      "--ulimit",
      `cpu=${String(this.#limits.cpuSeconds)}:${String(this.#limits.cpuSeconds)}`,
      "--ulimit",
      "core=0:0",
      "--mount",
      `type=volume,source=${name}-temporary,target=${MEMORY_TEMPORARY_ROOT},volume-nocopy`,
      "--user",
      "65532:65532",
      "--workdir",
      MEMORY_WORKSPACE_ROOT,
      "--interactive",
      "--mount",
      `type=volume,source=${this.#workspace},target=${MEMORY_WORKSPACE_ROOT},volume-nocopy${writable ? "" : ",readonly"}`,
      "--mount",
      `type=volume,source=${this.#cache},target=${MEMORY_CACHE_ROOT},volume-nocopy${cacheWritable ? "" : ",readonly"}`,
      "--env",
      "CI=1",
      "--env",
      "COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
      "--env",
      "HOME=/tmp",
      "--env",
      "NPM_CONFIG_AUDIT=false",
      "--env",
      "NPM_CONFIG_FUND=false",
      "--env",
      "NPM_CONFIG_IGNORE_SCRIPTS=true",
      "--entrypoint",
      entrypoint,
      this.#image(),
      ...args,
    ];
  }
  async #container(
    name: string,
    writable: boolean,
    cacheWritable: boolean,
  ): Promise<boolean> {
    await this.#volume(
      `${name}-temporary`,
      temporaryMemoryBytes(this.#limits),
      true,
    );
    const [container] = containerSchema.parse(
      JSON.parse(
        await this.#required(["container", "inspect", name]),
      ) as unknown,
    );
    if (container === undefined)
      throw new TypeError("Memory container is unavailable.");
    const host = container.HostConfig;
    const exactLimit = (name: string, value: number) =>
      host.Ulimits.filter(
        (limit) =>
          limit.Name === name && limit.Soft === value && limit.Hard === value,
      ).length === 1;
    const volumes = container.Mounts.filter((mount) => mount.Type === "volume");
    const match = (destination: string, volume: string, rw: boolean) =>
      volumes.filter(
        (mount) =>
          mount.Destination === destination &&
          mount.Name === volume &&
          mount.RW === rw,
      ).length === 1;
    if (
      container.Name !== `/${name}` ||
      container.Config.Image !== this.#image() ||
      container.Config.User !== "65532:65532" ||
      !exactLabels(container.Config.Labels, this.#token) ||
      host.NetworkMode !== "none" ||
      !host.ReadonlyRootfs ||
      host.Privileged ||
      (host.CapAdd?.length ?? 0) !== 0 ||
      host.CapDrop.length !== 1 ||
      host.CapDrop[0]?.toUpperCase() !== "ALL" ||
      host.SecurityOpt.length !== 1 ||
      !host.SecurityOpt.some(
        (option) =>
          option === "no-new-privileges" || option === "no-new-privileges:true",
      ) ||
      host.LogConfig.Type !== "none" ||
      host.Memory !== this.#limits.memoryMiB * 1024 * 1024 ||
      host.MemorySwap !== host.Memory ||
      host.PidsLimit !== this.#limits.maxProcesses ||
      host.NanoCpus !== 1_000_000_000 ||
      !exactLimit("core", 0) ||
      !exactLimit("cpu", this.#limits.cpuSeconds) ||
      Object.keys(host.Tmpfs ?? {}).length !== 0 ||
      (host.Binds?.length ?? 0) !== 0 ||
      volumes.length !== 3 ||
      !match(MEMORY_TEMPORARY_ROOT, `${name}-temporary`, true) ||
      !match(MEMORY_WORKSPACE_ROOT, this.#workspace, writable) ||
      !match(MEMORY_CACHE_ROOT, this.#cache, cacheWritable) ||
      container.Mounts.some((mount) => mount.Type !== "volume")
    )
      throw new TypeError(
        "Memory container storage, logging or execution controls do not match admission.",
      );
    return container.State.Running;
  }
  async #removeContainer(name: string): Promise<void> {
    if (await this.#absent("container", name, true)) {
      this.#containers.delete(name);
      await this.#removeVolume(`${name}-temporary`);
      return;
    }
    const [container] = containerSchema.parse(
      JSON.parse(
        await this.#required(["container", "inspect", name], true),
      ) as unknown,
    );
    if (
      container?.Name !== `/${name}` ||
      !exactLabels(container.Config.Labels, this.#token)
    )
      throw new TypeError("Memory container cleanup ownership does not match.");
    await this.#required(["container", "rm", "--force", name], true);
    if (!(await this.#absent("container", name, true)))
      throw new TypeError("Memory container cleanup was not verified.");
    this.#containers.delete(name);
    await this.#removeVolume(`${name}-temporary`);
  }
  async #createContainer(
    name: string,
    entrypoint: string,
    args: readonly string[],
    writable: boolean,
    cacheWritable: boolean,
  ): Promise<void> {
    if (!(await this.#absent("container", name)))
      throw new TypeError("Memory container resource name already exists.");
    // A private local-driver tmpfs preserves noswap without Docker's
    // --tmpfs option parser, which rejects that Linux option. No reuse.
    await this.#createVolume(
      `${name}-temporary`,
      temporaryMemoryBytes(this.#limits),
      true,
    );
    this.#containers.add(name);
    await this.#required(
      this.#containerArgs(name, entrypoint, args, writable, cacheWritable),
    );
    await this.#container(name, writable, cacheWritable);
  }
  async #run(
    entrypoint: string,
    args: readonly string[],
    writable: boolean,
    cacheWritable: boolean,
    stdin?: Uint8Array,
    maximum = this.#limits.maxOutputBytes,
    signal?: AbortSignal,
  ): Promise<ApplicationBuildCommandResult> {
    await this.#host();
    await this.#volume(this.#workspace, workspaceMemoryBytes(this.#limits));
    await this.#volume(this.#cache, this.#config.cacheBytes);
    if (!(await this.#container(this.#holder, true, true)))
      throw new TypeError("Memory workspace holder expired.");
    this.#sequence += 1;
    const name = `${this.#workspace}-step-${String(this.#sequence)}`;
    try {
      await this.#createContainer(
        name,
        entrypoint,
        args,
        writable,
        cacheWritable,
      );
      return await this.#control(
        ["container", "start", "--attach", "--interactive", name],
        stdin,
        maximum,
        signal,
      );
    } finally {
      await this.#removeContainer(name);
    }
  }
  #header(): Pick<
    MemoryWorkspaceRequest,
    "kind" | "kernelBootId" | "limits" | "cacheBytes"
  > {
    return {
      kind: MEMORY_WORKSPACE_PROTOCOL,
      kernelBootId: this.#bootId,
      limits: this.#limits,
      cacheBytes: this.#config.cacheBytes,
    };
  }
  async #helper(
    request: MemoryWorkspaceRequest,
  ): Promise<MemoryWorkspaceResponse> {
    const input = Buffer.from(
      canonicalJson(memoryWorkspaceRequestSchema.parse(request)),
      "utf8",
    );
    if (input.byteLength > MEMORY_PROTOCOL_MAX_BYTES)
      throw new RangeError(
        "Memory workspace input exceeds its protocol bound.",
      );
    const result = await this.#run(
      "/usr/local/bin/node",
      [MEMORY_WORKSPACE_HELPER, request.operation],
      request.operation === "seed" || request.operation === "prune",
      false,
      input,
      memoryResponseLimit(this.#limits, request.operation === "collect"),
    );
    if (!passed(result) || result.stderr !== "") {
      const failure = new TypeError("Memory workspace helper failed closed.");
      const helperStage = parseMemoryWorkspaceHelperFailure(result.stderr);
      if (helperStage !== undefined)
        recordMemoryApplicationBuildFailure(failure, { helperStage });
      throw failure;
    }
    let response: MemoryWorkspaceResponse;
    try {
      response = memoryWorkspaceResponseSchema.parse(
        JSON.parse(result.stdout) as unknown,
      );
    } catch {
      throw new TypeError(
        "Memory workspace helper returned an invalid bounded protocol response.",
      );
    }
    if (
      response.operation !== request.operation ||
      response.helperDigest !== this.#config.helperDigest ||
      response.kernelBootId !== this.#bootId
    )
      throw new TypeError(
        "Memory workspace helper identity or response does not match.",
      );
    return response;
  }
  async #inspect(): Promise<WorkspaceAuthority> {
    const response = await this.#helper({
      ...this.#header(),
      operation: "inspect",
    });
    if (response.authority === undefined)
      throw new TypeError("Memory workspace inspection is missing.");
    return decodeMemoryAuthority(response.authority);
  }
  async initialize(
    files: Parameters<ApplicationBuildWorkspaceExecutor["open"]>[0]["files"],
  ): Promise<void> {
    let stage: MemoryWorkspaceOpenStage = "engine";
    try {
      const host = await this.#seam.readHost();
      const engine = engineSchema.parse(
        JSON.parse(
          await this.#required(["info", "--format", "{{json .}}"]),
        ) as unknown,
      );
      if (
        engine.OSType !== "linux" ||
        /docker desktop|microsoft|wsl|linuxkit/iu.test(
          engine.OperatingSystem + " " + engine.KernelVersion,
        ) ||
        engine.KernelVersion !== host.kernelVersion
      )
        throw new TypeError(
          "Memory-only Docker must share the admitted native Linux kernel; Desktop and remote engines are not admitted.",
        );
      stage = "image";
      const [image] = imageSchema.parse(
        JSON.parse(
          await this.#required(["image", "inspect", this.#image()]),
        ) as unknown,
      );
      if (
        image?.Config.Labels[HELPER_LABEL] !== this.#config.helperDigest ||
        image.Config.Labels["cloudmarkup.memory-workspace.protocol"] !== "1" ||
        Object.keys(image.Config.Volumes ?? {}).length !== 0
      )
        throw new TypeError(
          "The exact successor memory helper image is not admitted.",
        );
      stage = "workspace-volume";
      await this.#createVolume(
        this.#workspace,
        workspaceMemoryBytes(this.#limits),
      );
      stage = "cache-volume";
      await this.#createVolume(this.#cache, this.#config.cacheBytes);
      stage = "holder-create";
      await this.#createContainer(
        this.#holder,
        "/usr/local/bin/node",
        [
          MEMORY_WORKSPACE_HELPER,
          "hold",
          String(this.#limits.wallTimeMilliseconds * 12),
        ],
        true,
        true,
      );
      stage = "holder-start";
      await this.#required(["container", "start", this.#holder]);
      // Verify actual kernel mounts and installed helper bytes before sending any source.
      stage = "probe";
      await this.#helper({ ...this.#header(), operation: "probe" });
      stage = "seed";
      const seeded = await this.#helper({
        ...this.#header(),
        operation: "seed",
        files: [...files],
        lock: this.#lock,
      });
      stage = "seed-authority";
      if (seeded.authority === undefined)
        throw new TypeError("Memory seed authority is missing.");
      this.#source = decodeMemoryAuthority(seeded.authority);
      const expected = [
        ...files,
        {
          path: this.#lock.lockfilePath,
          content: this.#lock.lockfileContent,
          checksum: this.#lock.lockfileChecksum,
        },
      ];
      if (this.#source.files.size !== expected.length)
        throw new TypeError(
          "Memory seed does not contain the exact source files.",
        );
      for (const file of expected) {
        const actual = this.#source.files.get(file.path);
        if (
          actual?.digest !== file.checksum.slice(7) ||
          actual.sizeBytes !== Buffer.byteLength(file.content) ||
          actual.mode !== 0o600
        )
          throw new TypeError(
            "Memory seed bytes do not match the original source.",
          );
      }
    } catch (error) {
      recordMemoryApplicationBuildFailure(error, { workspaceStage: stage });
      throw error;
    }
  }
  #enter(): void {
    if (
      this.#closed ||
      this.#failed ||
      this.#busy ||
      this.#source === undefined
    )
      throw new TypeError("Memory workspace is unavailable or already in use.");
    this.#busy = true;
  }
  async execute(
    invocation: ApplicationBuildCommandInvocation,
    signal?: AbortSignal,
  ): Promise<ApplicationBuildCommandResult> {
    if (!isApprovedApplicationBuildInvocation(invocation))
      throw new TypeError(
        "Memory build command is outside the fixed approved sequence.",
      );
    this.#enter();
    try {
      const source = this.#source;
      if (source === undefined)
        throw new TypeError("Memory source authority is unavailable.");
      if (invocation.step === "production-prune") {
        if (
          this.#installed === undefined ||
          this.#compiled === undefined ||
          this.#pruned
        )
          throw new TypeError("Memory prune requires one completed build.");
        const current = await this.#inspect();
        assertWorkspaceAuthority(current, source, [
          "application/node_modules",
          "application/dist",
        ]);
        assertExactAuthority(
          current,
          this.#installed,
          "application/node_modules",
        );
        assertExactAuthority(current, this.#compiled, "application/dist");
        await this.#helper({
          ...this.#header(),
          operation: "prune",
          expected: encodeMemoryAuthority(current),
        });
      }
      const writable =
        invocation.step === "install" ||
        invocation.step === "compile" ||
        invocation.step === "production-prune";
      const result = await this.#run(
        `/opt/cloudmarkup/bin/${invocation.executable}`,
        invocation.args,
        writable,
        invocation.executable === "trivy",
        undefined,
        this.#limits.maxOutputBytes,
        signal,
      );
      const workspace = await this.#inspect();
      const generated = [
        ...(this.#installed !== undefined || invocation.step === "install"
          ? ["application/node_modules"]
          : []),
        ...(this.#compiled !== undefined || invocation.step === "compile"
          ? ["application/dist"]
          : []),
      ];
      assertWorkspaceAuthority(workspace, source, generated);
      if (
        this.#installed !== undefined &&
        invocation.step !== "production-prune"
      )
        assertExactAuthority(
          workspace,
          this.#installed,
          "application/node_modules",
        );
      if (this.#compiled !== undefined)
        assertExactAuthority(workspace, this.#compiled, "application/dist");
      if (passed(result) && invocation.step === "install") {
        this.#installed = subtreeAuthority(
          workspace,
          "application/node_modules",
        );
        if (!this.#installed.directories.has("application/node_modules"))
          throw new TypeError(
            "Memory dependency installation produced no node_modules.",
          );
      }
      if (passed(result) && invocation.step === "compile") {
        this.#compiled = subtreeAuthority(workspace, "application/dist");
        if (!this.#compiled.directories.has("application/dist"))
          throw new TypeError("Memory compilation produced no dist tree.");
      }
      if (passed(result) && invocation.step === "production-prune")
        this.#pruned = true;
      if (!passed(result)) this.#failed = true;
      return result;
    } catch (error) {
      this.#failed = true;
      throw error;
    } finally {
      this.#busy = false;
    }
  }
  async readProducedFiles(): Promise<readonly ApplicationBuildProducedFile[]> {
    this.#enter();
    try {
      if (
        this.#source === undefined ||
        this.#compiled === undefined ||
        !this.#pruned
      )
        throw new TypeError(
          "Memory artifacts require completed compile and production prune.",
        );
      const current = await this.#inspect();
      assertWorkspaceAuthority(current, this.#source, [
        "application/dist",
        "application/node_modules",
      ]);
      assertExactAuthority(current, this.#compiled, "application/dist");
      const response = await this.#helper({
        ...this.#header(),
        operation: "collect",
        expected: encodeMemoryAuthority(current),
        lock: this.#lock,
      });
      const result: ApplicationBuildProducedFile[] = [];
      let bytes = 0;
      const paths = new Set<string>();
      for (const file of response.files ?? []) {
        const content = Buffer.from(file.bytesBase64, "base64");
        const authority = current.files.get(file.path);
        bytes += content.byteLength;
        if (
          paths.has(file.path) ||
          !/^(?:application\/dist\/|application\/node_modules\/)/u.test(
            file.path,
          ) ||
          content.toString("base64") !== file.bytesBase64 ||
          sha256Digest(content) !== file.checksum ||
          authority?.digest !== file.checksum.slice(7) ||
          authority.sizeBytes !== content.byteLength ||
          bytes > this.#limits.maxArtifactBytes
        )
          throw new TypeError(
            "Collected memory artifacts do not match the exact inspected bytes.",
          );
        paths.add(file.path);
        result.push({ path: file.path, bytes: content, kind: "regular-file" });
      }
      return result;
    } catch (error) {
      this.#failed = true;
      throw error;
    } finally {
      this.#busy = false;
    }
  }
  async #removeVolume(name: string): Promise<void> {
    const profile = this.#volumes.get(name);
    if (profile === undefined) return;
    if (await this.#absent("volume", name, true)) {
      this.#volumes.delete(name);
      return;
    }
    await this.#volume(name, profile.bytes, profile.noexec, true);
    await this.#required(["volume", "rm", name], true);
    if (!(await this.#absent("volume", name, true)))
      throw new TypeError("Memory volume cleanup was not verified.");
    this.#volumes.delete(name);
  }
  async dispose(): Promise<void> {
    if (this.#busy)
      throw new TypeError(
        "Memory workspace cannot be disposed during an active operation.",
      );
    this.#closed = true;
    // A failed cleanup remains retryable; only exact owned names are considered.
    for (const name of [...this.#containers].reverse())
      await this.#removeContainer(name);
    for (const name of [...this.#volumes.keys()].reverse())
      await this.#removeVolume(name);
  }
}

function createExecutor(
  input: MemoryIsolationConfig,
  seam: MemoryExecutorSeam,
): ApplicationBuildWorkspaceExecutor {
  if (
    !isAbsolute(input.containerRuntimeExecutable) ||
    !new Set(["docker", "docker.exe"]).has(
      basename(input.containerRuntimeExecutable).toLowerCase(),
    )
  )
    throw new TypeError(
      "Memory execution requires an absolute trusted Docker binary.",
    );
  const config = {
    ...input,
    container: applicationBuildPolicyV1Schema.shape.container.parse(
      input.container,
    ),
    helperDigest: digestSchema.parse(input.helperDigest),
  };
  if (
    !Number.isSafeInteger(config.cacheBytes) ||
    config.cacheBytes < 4096 ||
    config.cacheBytes > MEMORY_CACHE_MAX_BYTES ||
    config.cacheBytes % 4096 !== 0
  )
    throw new TypeError(
      "Memory cache requires an exact bounded page-aligned size.",
    );
  return {
    async open(input) {
      // Read the live AbortSignal getter after each awaited admission boundary.
      const cancelled = () => input.signal?.aborted === true;
      if (cancelled())
        throw new TypeError("Memory workspace was cancelled before admission.");
      const host = await seam.readHost();
      const bootId = admitNativeMemoryHost(host);
      if (cancelled())
        throw new TypeError("Memory workspace was cancelled during admission.");
      const limits = applicationBuildLimitsV1Schema.parse(input.limits);
      const lock = applicationDependencyLockV1Schema.parse(input.lock);
      const files = input.files.map((file) =>
        applicationBuildSourceFileV1Schema.parse(file),
      );
      validateMemorySeed({
        kind: MEMORY_WORKSPACE_PROTOCOL,
        operation: "seed",
        kernelBootId: bootId,
        cacheBytes: config.cacheBytes,
        limits,
        lock,
        files,
      });
      const session = new MemoryApplicationBuildSession(
        config,
        seam,
        limits,
        lock,
        bootId,
        input.signal,
      );
      try {
        await session.initialize(files);
        if (cancelled())
          throw new TypeError(
            "Memory workspace was cancelled during initialization.",
          );
        return session;
      } catch (error) {
        try {
          await session.dispose();
        } catch (cleanupError) {
          recordMemoryApplicationBuildFailure(cleanupError, {
            workspaceStage: "cleanup",
          });
          throw cleanupError;
        }
        throw error;
      }
    },
  };
}

function historicalIsolation(
  input: MemoryApplicationBuildContainerConfig,
): MemoryIsolationConfig {
  const { policy, ...rest } = input;
  return {
    ...rest,
    container: applicationBuildPolicyV1Schema.parse(policy).container,
  };
}
function hostIsolation(
  input: MemoryHostRepairSeedContainerConfig,
): MemoryIsolationConfig {
  const { policy, ...rest } = input;
  return {
    ...rest,
    container: applicationHostRepairSeedPolicyV1Schema.parse(policy).container,
  };
}
const productionSeam: MemoryExecutorSeam = {
  runProcess: runMemoryContainerProcess,
  readHost: readNativeMemoryHost,
  randomId: randomUUID,
};
export function createMemoryApplicationBuildContainerExecutor(
  input: MemoryApplicationBuildContainerConfig,
): ApplicationBuildWorkspaceExecutor {
  return createExecutor(historicalIsolation(input), productionSeam);
}
/** Separate transient host policy. Historical profile parsing is unchanged. */
export function createMemoryHostRepairSeedContainerExecutor(
  input: MemoryHostRepairSeedContainerConfig,
): ApplicationBuildWorkspaceExecutor {
  return createExecutor(hostIsolation(input), productionSeam);
}
/** Internal test seams; absent from the package entry points. */
export function createMemoryApplicationBuildContainerExecutorForTesting(
  input: MemoryApplicationBuildContainerConfig,
  seam: MemoryExecutorSeam,
): ApplicationBuildWorkspaceExecutor {
  return createExecutor(historicalIsolation(input), seam);
}
export function createMemoryHostRepairSeedContainerExecutorForTesting(
  input: MemoryHostRepairSeedContainerConfig,
  seam: MemoryExecutorSeam,
): ApplicationBuildWorkspaceExecutor {
  return createExecutor(hostIsolation(input), seam);
}

function candidateIsolation(
  input: MemoryHostRepairCandidateContainerConfig,
): MemoryIsolationConfig {
  const { policy, ...rest } = input;
  return {
    ...rest,
    container:
      applicationHostRepairCandidatePolicyV1Schema.parse(policy).container,
  };
}
export function createMemoryHostRepairCandidateContainerExecutor(
  input: MemoryHostRepairCandidateContainerConfig,
): ApplicationBuildWorkspaceExecutor {
  return createExecutor(candidateIsolation(input), productionSeam);
}
export function createMemoryHostRepairCandidateContainerExecutorForTesting(
  input: MemoryHostRepairCandidateContainerConfig,
  seam: MemoryExecutorSeam,
): ApplicationBuildWorkspaceExecutor {
  return createExecutor(candidateIsolation(input), seam);
}
