import {
  applicationHostRepairCandidatePolicyV1Schema,
  createApplicationHostRepairCandidateProfileV1,
} from "./host-repair-candidate-contracts.js";
import { createMemoryHostRepairCandidateContainerExecutorForTesting } from "./memory-container-executor.js";
import { readMemoryApplicationBuildFailure } from "./memory-workspace-diagnostics.js";
import * as hostFs from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { APPROVED_APPLICATION_BUILD_COMMANDS } from "./commands.js";
import {
  applicationBuildPolicyV1Schema,
  applicationBuildSourceFileV1Schema,
  applicationDependencyLockV1Schema,
  type ApplicationBuildSourceFileV1,
  type ApplicationBuildCommandResult,
} from "./contracts.js";
import {
  createMemoryApplicationBuildContainerExecutorForTesting,
  createMemoryHostRepairSeedContainerExecutorForTesting,
} from "./memory-container-executor.js";
import {
  applicationHostRepairSeedPolicyV1Schema,
  createApplicationHostRepairSeedProfileV1,
} from "./host-repair-seed-contracts.js";
import type {
  MemoryContainerProcessInput,
  MemoryContainerProcessRunner,
} from "./memory-container-process.js";
import {
  assertNoCoreDumps,
  assertNoSwap,
  assertTmpfsMount,
  temporaryMemoryBytes,
  decodeMemoryAuthority,
  encodeMemoryAuthority,
  MEMORY_WORKSPACE_PROTOCOL,
  MEMORY_CACHE_MAX_BYTES,
  memoryAuthoritySchema,
  memoryWorkspaceRequestSchema,
  type MemoryAuthority,
  type MemoryWorkspaceResponse,
} from "./memory-workspace-protocol.js";
import { canonicalJson, sha256Digest } from "./security.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const forbidden = () =>
    Promise.reject(
      new Error("Host content writes are forbidden in the memory executor."),
    );
  return {
    ...actual,
    writeFile: vi.fn(forbidden),
    mkdtemp: vi.fn(forbidden),
    mkdir: vi.fn(forbidden),
    rm: vi.fn(forbidden),
  };
});

const bootId = "00000000-0000-4000-8000-000000000001";
const token = "00000000-0000-4000-8000-000000000002";
const swaps = "Filename\tType\tSize\tUsed\tPriority\n";
const sentinel = "UNRETAINED-CANDIDATE-SENTINEL";
const helperDigest = sha256Digest(
  "synthetic helper identity; not real build evidence",
);
const owner = "cloudmarkup.application-memory-workspace.v1";
const pin = (id: string, version = "1.0.0") => ({
  id,
  version,
  digest: sha256Digest(id + version),
});

function fixture() {
  const profile = {
    id: "cloudmarkup.application-build.generated-nodejs24",
    sourcePolicy: "generated-only",
    version: "1.0.0",
  };
  const policy = applicationBuildPolicyV1Schema.parse({
    contractVersion: 1,
    builder: pin("cloudmarkup.application-builder"),
    container: {
      image: "cloudmarkup/application-build-memory",
      digest: sha256Digest("test image"),
      platform: "linux/amd64",
      pnpmStorePath: "/opt/cloudmarkup/pnpm-store",
    },
    dependencyCacheDigest: sha256Digest("test store"),
    defaultLimits: {
      cpuSeconds: 30,
      maxArtifactBytes: 65536,
      maxFileBytes: 4096,
      maxFiles: 32,
      maxOutputBytes: 65536,
      maxProcesses: 8,
      maxTotalFileBytes: 65536,
      memoryMiB: 512,
      wallTimeMilliseconds: 30000,
    },
    dependencyAllowlist: [
      { kind: "runtime", name: "example-runtime", version: "1.0.0" },
    ],
    dependencyDenylist: [],
    profile: { ...profile, digest: sha256Digest(canonicalJson(profile)) },
    scanner: pin("aquasecurity.trivy"),
    secretScanner: pin("aquasecurity.trivy-secret"),
    toolchain: [
      pin("runtime.nodejs", "24.18.0"),
      pin("package-manager.pnpm", "11.16.0"),
      pin("compiler.typescript", "6.0.3"),
      pin("test-runner.vitest", "4.1.10"),
      pin("packager.cloudmarkup-lambda-zip"),
    ],
  });
  const content = '{"name":"synthetic-memory-fixture","version":"1.0.0"}';
  const files: ApplicationBuildSourceFileV1[] = [
    {
      path: applicationBuildSourceFileV1Schema.shape.path.parse(
        "application/package.json",
      ),
      content,
      checksum: sha256Digest(content),
      mediaType: "application/json",
      ownership: "generated",
    },
    {
      path: applicationBuildSourceFileV1Schema.shape.path.parse(
        "application/src/index.ts",
      ),
      content: sentinel,
      checksum: sha256Digest(sentinel),
      mediaType: "text/typescript",
      ownership: "ai-authored",
    },
  ];
  const lockContent = "lockfileVersion: '9.0'\n";
  const lock = applicationDependencyLockV1Schema.parse({
    contractVersion: 1,
    cache: {
      digest: policy.dependencyCacheDigest,
      kind: "prepackaged-content-addressed",
      network: "deny",
    },
    lifecycleScripts: "deny",
    lockfileChecksum: sha256Digest(lockContent),
    lockfileContent: lockContent,
    lockfilePath: "application/pnpm-lock.yaml",
    packageManager: pin("package-manager.pnpm", "11.16.0"),
    packageManifestChecksum: sha256Digest(content),
    packages: [
      {
        name: "example-runtime",
        version: "1.0.0",
        kind: "runtime",
        integrity: "sha512-" + "A".repeat(86) + "==",
        tarballDigest: sha256Digest("test tarball"),
      },
    ],
  });
  return { policy, files, lock, limits: policy.defaultLimits };
}

function result(
  stdout = "",
  overrides: Partial<ApplicationBuildCommandResult> = {},
): ApplicationBuildCommandResult {
  return {
    exitCode: 0,
    termination: "completed",
    stdout,
    stderr: "",
    outputBytes: Buffer.byteLength(stdout),
    ...overrides,
  };
}
interface FakeVolume {
  Name: string;
  Driver: string;
  Scope: string;
  Labels: Record<string, string>;
  Options: Record<string, string>;
}
interface FakeContainer {
  name: string;
  args: readonly string[];
  running: boolean;
}
const valueAfter = (args: readonly string[], flag: string) =>
  args[args.indexOf(flag) + 1] ?? "";
function allValues(args: readonly string[], flag: string): string[] {
  return args.flatMap((value, index) =>
    value === flag ? [args[index + 1] ?? ""] : [],
  );
}
function keyValues(values: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    values.map((value) => {
      const at = value.indexOf("=");
      return [value.slice(0, at), value.slice(at + 1)];
    }),
  );
}

class Engine {
  helperFailure: string | undefined;
  readonly calls: MemoryContainerProcessInput[] = [];
  readonly volumes = new Map<string, FakeVolume>();
  readonly containers = new Map<string, FakeContainer>();
  readonly content = new Map<string, string>();
  readonly directories = new Map<string, number>();
  toolRuns = 0;
  helperChange: ((response: MemoryWorkspaceResponse) => unknown) | undefined;
  inspectChange: ((kind: string, input: unknown) => unknown) | undefined;
  toolChange: (() => void) | undefined;
  failRemoval = false;
  failHolderStart = false;
  failTemporaryRemoval = false;
  host = {
    platform: "linux",
    kernelBootId: bootId,
    kernelVersion: "6.12.0-synthetic",
    swaps,
    coreLimits: "Max core file size        0          0          bytes\n",
    corePattern: "core\n",
    diagnosticArguments: [] as string[],
  };

  private addFile(path: string, content: string) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1)
      this.directories.set(parts.slice(0, index).join("/"), 0o700);
    this.content.set(path, content);
  }
  private authority(): MemoryAuthority {
    return encodeMemoryAuthority({
      directories: this.directories,
      files: new Map(
        [...this.content].map(([path, content]) => [
          path,
          {
            digest: sha256Digest(content).slice(7),
            mode: 0o600,
            sizeBytes: Buffer.byteLength(content),
          },
        ]),
      ),
    });
  }
  inspectedContainer(container: FakeContainer) {
    const args = container.args,
      labels = keyValues(allValues(args, "--label"));
    const mounts = allValues(args, "--mount").map((value) => {
      const fields = value.split(","),
        values = keyValues(fields.filter((field) => field.includes("=")));
      return {
        Type: values["type"],
        Name: values["source"],
        Destination: values["target"],
        RW: !fields.includes("readonly"),
      };
    });
    return {
      Name: "/" + container.name,
      Config: {
        Image: args[args.indexOf("--entrypoint") + 2],
        User: valueAfter(args, "--user"),
        Labels: labels,
      },
      State: { Running: container.running },
      HostConfig: {
        NetworkMode: valueAfter(args, "--network"),
        ReadonlyRootfs: args.includes("--read-only"),
        Privileged: false,
        CapAdd: null,
        CapDrop: allValues(args, "--cap-drop"),
        SecurityOpt: allValues(args, "--security-opt"),
        LogConfig: { Type: valueAfter(args, "--log-driver") },
        Memory: Number(valueAfter(args, "--memory")),
        MemorySwap: Number(valueAfter(args, "--memory-swap")),
        PidsLimit: Number(valueAfter(args, "--pids-limit")),
        Binds: null,
        NanoCpus: Number(valueAfter(args, "--cpus")) * 1_000_000_000,
        Tmpfs: {},
        Ulimits: allValues(args, "--ulimit").map((value) => {
          const [Name, bounds = ""] = value.split("=");
          const [soft, hard] = bounds.split(":");
          return { Name, Soft: Number(soft), Hard: Number(hard) };
        }),
      },
      Mounts: mounts,
    };
  }
  readonly run: MemoryContainerProcessRunner = (input) => {
    this.calls.push(input);
    const args = input.args,
      kind = args[0],
      operation = args[1],
      name = args.at(-1) ?? "";
    if (kind === "info")
      return Promise.resolve(
        result(
          JSON.stringify({
            OSType: "linux",
            OperatingSystem: "Synthetic native Linux",
            KernelVersion: this.host.kernelVersion,
          }),
        ),
      );
    if (kind === "image")
      return Promise.resolve(
        result(
          JSON.stringify([
            {
              Id: "synthetic",
              Config: {
                Labels: {
                  "cloudmarkup.memory-workspace.sha256": helperDigest,
                  "cloudmarkup.memory-workspace.protocol": "1",
                },
                Volumes: null,
              },
            },
          ]),
        ),
      );
    if (operation === "ls") {
      const names =
        kind === "volume" ? this.volumes.keys() : this.containers.keys();
      return Promise.resolve(result([...names].join("\n")));
    }
    if (kind === "volume" && operation === "create") {
      this.volumes.set(name, {
        Name: name,
        Driver: valueAfter(args, "--driver"),
        Scope: "local",
        Labels: keyValues(allValues(args, "--label")),
        Options: keyValues(allValues(args, "--opt")),
      });
      return Promise.resolve(result(name));
    }
    if (operation === "inspect") {
      const entry =
        kind === "volume" ? this.volumes.get(name) : this.containers.get(name);
      if (entry === undefined)
        return Promise.resolve(result("", { exitCode: 1 }));
      const value =
        kind === "volume"
          ? entry
          : this.inspectedContainer(entry as FakeContainer);
      return Promise.resolve(
        result(
          JSON.stringify([this.inspectChange?.(kind ?? "", value) ?? value]),
        ),
      );
    }
    if (kind === "create") {
      const containerName = valueAfter(args, "--name");
      this.containers.set(containerName, {
        name: containerName,
        args,
        running: false,
      });
      return Promise.resolve(result(containerName));
    }
    if (operation === "rm") {
      if (
        this.failRemoval ||
        (kind === "volume" &&
          name.endsWith("-temporary") &&
          this.failTemporaryRemoval)
      )
        return Promise.resolve(result("", { exitCode: 1 }));
      if (kind === "volume") this.volumes.delete(name);
      else this.containers.delete(name);
      return Promise.resolve(result(name));
    }
    if (kind === "container" && operation === "start") {
      if (name.endsWith("-holder") && this.failHolderStart)
        return Promise.resolve(result("", { exitCode: 1 }));
      const container = this.containers.get(name);
      if (container === undefined)
        return Promise.resolve(result("", { exitCode: 1 }));
      container.running = true;
      if (!args.includes("--attach")) return Promise.resolve(result(name));
      const command = container.args.slice(
        container.args.indexOf("--entrypoint") + 3,
      );
      if (
        valueAfter(container.args, "--entrypoint") === "/usr/local/bin/node"
      ) {
        if (this.helperFailure !== undefined)
          return Promise.resolve(
            result("", { exitCode: 70, stderr: this.helperFailure }),
          );
        const request = memoryWorkspaceRequestSchema.parse(
          JSON.parse(
            Buffer.from(input.stdin ?? []).toString("utf8"),
          ) as unknown,
        );
        if (request.operation === "seed") {
          for (const file of request.files)
            this.addFile(file.path, file.content);
          this.addFile(request.lock.lockfilePath, request.lock.lockfileContent);
        }
        if (request.operation === "prune") {
          for (const path of this.content.keys())
            if (path.startsWith("application/node_modules/"))
              this.content.delete(path);
          for (const path of this.directories.keys())
            if (
              path === "application/node_modules" ||
              path.startsWith("application/node_modules/")
            )
              this.directories.delete(path);
        }
        const response: MemoryWorkspaceResponse = {
          kind: MEMORY_WORKSPACE_PROTOCOL,
          operation: request.operation,
          helperDigest,
          kernelBootId: bootId,
          ...(request.operation === "probe"
            ? {}
            : { authority: this.authority() }),
          ...(request.operation === "collect"
            ? {
                files: [...this.content]
                  .filter(
                    ([path]) =>
                      path.startsWith("application/dist/") ||
                      path.startsWith("application/node_modules/"),
                  )
                  .map(([path, content]) => ({
                    path,
                    bytesBase64: Buffer.from(content).toString("base64"),
                    checksum: sha256Digest(content),
                  })),
              }
            : {}),
        };
        return Promise.resolve(
          result(canonicalJson(this.helperChange?.(response) ?? response)),
        );
      }
      this.toolRuns += 1;
      if (command[0] === "install")
        this.addFile(
          "application/node_modules/example-runtime/package.json",
          '{"name":"example-runtime","version":"1.0.0"}',
        );
      if (command.includes("--sourceMap"))
        this.addFile(
          "application/dist/index.js",
          "export const syntheticFixture = true;\n",
        );
      this.toolChange?.();
      return Promise.resolve(result("{}"));
    }
    return Promise.reject(new Error("Unexpected synthetic engine command."));
  };
  executor(cacheBytes = 4096) {
    return createMemoryApplicationBuildContainerExecutorForTesting(
      {
        containerRuntimeExecutable: resolve("docker"),
        policy: fixture().policy,
        helperDigest,
        cacheBytes,
      },
      {
        runProcess: this.run,
        readHost: () => Promise.resolve(this.host),
        randomId: () => token,
      },
    );
  }
}

describe("memory-only application executor storage and transport", () => {
  it("admits the bounded frozen scanner cache and rejects larger or unaligned allocations", async () => {
    expect(MEMORY_CACHE_MAX_BYTES).toBe(1536 * 1024 * 1024);
    expect(MEMORY_CACHE_MAX_BYTES).toBeGreaterThan(
      1_382_703_104 + 64 * 1024 * 1024,
    );
    const engine = new Engine();
    const session = await engine
      .executor(MEMORY_CACHE_MAX_BYTES)
      .open(fixture());
    const cache = [...engine.volumes.values()].find((volume) =>
      volume.Name.endsWith("-cache"),
    );
    expect(cache?.Options["o"]).toContain(
      "size=" + String(MEMORY_CACHE_MAX_BYTES),
    );
    expect(cache?.Options["o"]).toContain("noswap");
    await session.dispose();
    expect(engine.volumes.size).toBe(0);
    for (const cacheBytes of [
      MEMORY_CACHE_MAX_BYTES + 4096,
      MEMORY_CACHE_MAX_BYTES - 1,
    ]) {
      expect(() => engine.executor(cacheBytes)).toThrow("bounded page-aligned");
      expect(
        memoryWorkspaceRequestSchema.safeParse({
          kind: MEMORY_WORKSPACE_PROTOCOL,
          kernelBootId: bootId,
          operation: "probe",
          limits: fixture().limits,
          cacheBytes,
        }).success,
      ).toBe(false);
    }
  });
  it.each([
    ["memory-workspace-failure:workspace-mount\n", "workspace-mount"],
    ["memory-workspace-failure:workspace-mount\nPRIVATE", undefined],
  ])(
    "records bounded workspace-open diagnostics and retains cleanup (%s)",
    async (stderr, helperStage) => {
      const engine = new Engine();
      engine.helperFailure = stderr;
      let failure: unknown;
      try {
        await engine.executor().open(fixture());
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(TypeError);
      expect(readMemoryApplicationBuildFailure(failure)).toEqual({
        workspaceStage: "probe",
        ...(helperStage === undefined ? {} : { helperStage }),
      });
      expect(
        JSON.stringify(readMemoryApplicationBuildFailure(failure)),
      ).not.toContain("PRIVATE");
      expect(engine.content.size).toBe(0);
      expect(engine.containers.size).toBe(0);
      expect(engine.volumes.size).toBe(0);
    },
  );

  it("keeps source in stdin, verifies memory configuration before seed, and preserves per-step readonly mounts", async () => {
    const engine = new Engine(),
      f = fixture();
    const session = await engine.executor().open(f);
    for (const command of Object.values(APPROVED_APPLICATION_BUILD_COMMANDS))
      await session.execute(command);
    const files = await session.readProducedFiles();
    expect(
      files.some((file) => file.path === "application/dist/index.js"),
    ).toBe(true);
    expect(engine.toolRuns).toBe(9);
    for (const write of [
      hostFs.writeFile,
      hostFs.mkdtemp,
      hostFs.mkdir,
      hostFs.rm,
    ])
      expect(write).not.toHaveBeenCalled();
    // Completed containers leave no temporary mount for a later step to reuse.
    expect(
      [...engine.volumes.keys()].filter((name) => name.endsWith("-temporary")),
    ).toEqual([`cloudmarkup-memory-app-${token}-holder-temporary`]);
    const createCalls = engine.calls.filter(
      (call) => call.args[0] === "create",
    );
    expect(
      createCalls.every((call) => !call.args.join(" ").includes(sentinel)),
    ).toBe(true);
    expect(
      engine.calls
        .filter((call) => call.stdin !== undefined)
        .some((call) =>
          Buffer.from(call.stdin ?? [])
            .toString("utf8")
            .includes(sentinel),
        ),
    ).toBe(true);
    const temporaryNames = createCalls.map(
      (call) => valueAfter(call.args, "--name") + "-temporary",
    );
    expect(new Set(temporaryNames).size).toBe(createCalls.length);
    for (const call of createCalls) {
      expect(call.args).not.toContain("--tmpfs");
      const temporary = allValues(call.args, "--mount").find((mount) =>
        mount.includes("target=/tmp,"),
      );
      expect(temporary).toBe(
        "type=volume,source=" +
          valueAfter(call.args, "--name") +
          "-temporary,target=/tmp,volume-nocopy",
      );
      const volume = engine.calls.find(
        (entry) =>
          entry.args[0] === "volume" &&
          entry.args[1] === "create" &&
          entry.args.at(-1) === valueAfter(call.args, "--name") + "-temporary",
      );
      expect(allValues(volume?.args ?? [], "--opt")).toContain(
        "o=size=65536,uid=65532,gid=65532,mode=0700,nosuid,nodev,noswap,noexec",
      );

      expect(call.args).toEqual(
        expect.arrayContaining([
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--log-driver",
          "none",
          "--user",
          "65532:65532",
        ]),
      );
      expect(
        allValues(call.args, "--mount").every((mount) =>
          mount.startsWith("type=volume,"),
        ),
      ).toBe(true);
      expect(Number(valueAfter(call.args, "--memory-swap"))).toBe(
        Number(valueAfter(call.args, "--memory")),
      );
    }
    for (const command of [
      APPROVED_APPLICATION_BUILD_COMMANDS.lint,
      APPROVED_APPLICATION_BUILD_COMMANDS.typecheck,
      APPROVED_APPLICATION_BUILD_COMMANDS.unitTests,
    ]) {
      const creation = createCalls.find(
        (call) =>
          valueAfter(call.args, "--entrypoint") ===
            "/opt/cloudmarkup/bin/" + command.executable &&
          call.args.slice(-command.args.length).join("\0") ===
            command.args.join("\0"),
      );
      expect(
        allValues(creation?.args ?? [], "--mount").find((mount) =>
          mount.includes("target=/workspace"),
        ),
      ).toContain(",readonly");
    }
    const messages = engine.calls.flatMap((call) =>
      call.stdin === undefined
        ? []
        : [
            memoryWorkspaceRequestSchema.parse(
              JSON.parse(Buffer.from(call.stdin).toString("utf8")) as unknown,
            ).operation,
          ],
    );
    expect(messages.slice(0, 2)).toEqual(["probe", "seed"]);
    await session.dispose();
    await session.dispose();
    expect(engine.containers.size).toBe(0);
    expect(engine.volumes.size).toBe(0);
  });
  it.each(["win32"])(
    "rejects %s before creating resources or transferring source",
    async (platform) => {
      const engine = new Engine();
      engine.host.platform = platform;
      await expect(engine.executor().open(fixture())).rejects.toThrow(
        "native Linux",
      );
      expect(engine.calls).toEqual([]);
    },
  );
  it("rejects active swap before any Docker operation", async () => {
    const engine = new Engine();
    engine.host.swaps += "/swapfile file 1024 0 -2\n";
    await expect(engine.executor().open(fixture())).rejects.toThrow(
      "no active swap",
    );
    expect(engine.calls).toEqual([]);
  });
  it.each(["helper", "kernel"])(
    "rejects substituted %s identity before source leaves memory",
    async (kind) => {
      const engine = new Engine();
      engine.helperChange = (response) => ({
        ...response,
        ...(kind === "helper"
          ? { helperDigest: sha256Digest("substituted") }
          : { kernelBootId: token }),
      });
      await expect(engine.executor().open(fixture())).rejects.toThrow(
        "identity or response",
      );
      expect(
        engine.calls.every(
          (call) =>
            !Buffer.from(call.stdin ?? [])
              .toString("utf8")
              .includes(sentinel),
        ),
      ).toBe(true);
      expect(engine.containers.size).toBe(0);
      expect(engine.volumes.size).toBe(0);
    },
  );
  it("cleans private temporary volumes when the holder cannot start, before sending source", async () => {
    const engine = new Engine();
    engine.failHolderStart = true;
    await expect(engine.executor().open(fixture())).rejects.toThrow(
      "control operation",
    );
    expect(engine.calls.every((call) => call.stdin === undefined)).toBe(true);
    expect(engine.containers.size).toBe(0);
    expect(engine.volumes.size).toBe(0);
  });
  it.each(["noswap", "noexec"])(
    "rejects a temporary volume missing %s before source staging",
    async (option) => {
      const engine = new Engine();
      engine.inspectChange = (kind, value) => {
        const volume = value as FakeVolume;
        return kind === "volume" && volume.Name.endsWith("-temporary")
          ? {
              ...volume,
              Options: {
                ...volume.Options,
                o: volume.Options["o"]?.replace("," + option, ""),
              },
            }
          : value;
      };
      await expect(engine.executor().open(fixture())).rejects.toThrow(
        "owned tmpfs",
      );
      expect(engine.calls.every((call) => call.stdin === undefined)).toBe(true);
      expect(
        engine.calls.some(
          (call) =>
            call.args[0] === "volume" &&
            call.args[1] === "rm" &&
            call.args.at(-1)?.endsWith("-temporary"),
        ),
      ).toBe(false);
    },
  );
  it("fails when a step's private temporary volume cannot be removed, then permits verified cleanup retry", async () => {
    const engine = new Engine();
    const session = await engine.executor().open(fixture());
    engine.failTemporaryRemoval = true;
    await expect(
      session.execute(APPROVED_APPLICATION_BUILD_COMMANDS.install),
    ).rejects.toThrow("control operation");
    await expect(session.readProducedFiles()).rejects.toThrow("unavailable");
    expect(
      [...engine.volumes.keys()].filter((name) => name.endsWith("-temporary"))
        .length,
    ).toBeGreaterThan(1);
    engine.failTemporaryRemoval = false;
    await session.dispose();
    expect(engine.containers.size).toBe(0);
    expect(engine.volumes.size).toBe(0);
  });
  it("rejects default disk volume options and does not remove an unverified volume", async () => {
    const engine = new Engine();
    engine.inspectChange = (kind, entry) =>
      kind === "volume" ? { ...(entry as FakeVolume), Options: {} } : entry;
    await expect(engine.executor().open(fixture())).rejects.toThrow(
      "owned tmpfs",
    );
    expect(engine.toolRuns).toBe(0);
    expect(
      engine.calls.some(
        (call) => call.args[0] === "volume" && call.args[1] === "rm",
      ),
    ).toBe(false);
  });
  it("rejects persisted Docker logging before source staging", async () => {
    const engine = new Engine();
    engine.inspectChange = (kind, value) => {
      if (kind !== "container") return value;
      const container = value as ReturnType<Engine["inspectedContainer"]>;
      return {
        ...container,
        HostConfig: {
          ...container.HostConfig,
          LogConfig: { Type: "json-file" },
        },
      };
    };
    await expect(engine.executor().open(fixture())).rejects.toThrow(
      "logging or execution controls",
    );
    expect(engine.calls.every((call) => call.stdin === undefined)).toBe(true);
    expect(engine.containers.size).toBe(0);
  });
  it("rejects mutated source after a real step boundary and never collects it", async () => {
    const engine = new Engine(),
      session = await engine.executor().open(fixture());
    engine.toolChange = () => {
      engine.content.set("application/src/index.ts", "unexpected modification");
    };
    await expect(
      session.execute(APPROVED_APPLICATION_BUILD_COMMANDS.install),
    ).rejects.toThrow("authority-bound file");
    await expect(session.readProducedFiles()).rejects.toThrow("unavailable");
    await session.dispose();
    expect(engine.volumes.size).toBe(0);
  });
  it.each(["core", "heap"])(
    "rejects %s persistence before creating resources",
    async (kind) => {
      const engine = new Engine();
      if (kind === "core")
        engine.host.coreLimits =
          "Max core file size        unlimited          unlimited          bytes\n";
      else
        engine.host.diagnosticArguments = ["--heapsnapshot-near-heap-limit=1"];
      await expect(engine.executor().open(fixture())).rejects.toThrow(
        /core dumps|heap snapshot/u,
      );
      expect(engine.calls).toEqual([]);
    },
  );
  it.each([
    "|/usr/bin/collector %P",
    "@/run/core-receiver",
    "",
    "future-receiver:unknown",
  ])(
    "rejects unreviewed core receiver policy before source admission",
    async (corePattern) => {
      const engine = new Engine();
      engine.host.corePattern = corePattern;
      await expect(engine.executor().open(fixture())).rejects.toThrow(
        "non-pipe core dump policy",
      );
      expect(engine.calls).toEqual([]);
    },
  );
  it.each(["checksum", "duplicate", "oversized", "lock"])(
    "rejects %s source admission before creating resources",
    async (kind) => {
      const engine = new Engine(),
        input = fixture();
      if (kind === "checksum") {
        const file = input.files[1];
        if (file === undefined) throw new Error("Missing fixture source");
        input.files[1] = { ...file, checksum: sha256Digest("different") };
      }
      if (kind === "duplicate") {
        const file = input.files[0];
        if (file === undefined) throw new Error("Missing fixture source");
        input.files.push(file);
      }
      if (kind === "oversized")
        input.limits = { ...input.limits, maxTotalFileBytes: 1 };
      if (kind === "lock")
        input.lock = {
          ...input.lock,
          lockfileChecksum: sha256Digest("different lock"),
        };
      await expect(engine.executor().open(input)).rejects.toThrow();
      expect(engine.calls).toEqual([]);
    },
  );
  it("rejects an added argument before any tool process", async () => {
    const engine = new Engine(),
      session = await engine.executor().open(fixture());
    await expect(
      session.execute({
        ...APPROVED_APPLICATION_BUILD_COMMANDS.install,
        args: [
          ...APPROVED_APPLICATION_BUILD_COMMANDS.install.args,
          "--registry=https://untrusted.invalid",
        ],
      }),
    ).rejects.toThrow("fixed approved");
    expect(engine.toolRuns).toBe(0);
    await session.dispose();
  });
  it("closes a failed collection against both repeat collect and further execution while permitting cleanup", async () => {
    const engine = new Engine(),
      session = await engine.executor().open(fixture());
    for (const command of Object.values(APPROVED_APPLICATION_BUILD_COMMANDS))
      await session.execute(command);
    engine.helperChange = (response) =>
      response.operation !== "collect"
        ? response
        : {
            ...response,
            files: response.files?.map((file) => ({
              ...file,
              checksum: sha256Digest("substituted output"),
            })),
          };
    await expect(session.readProducedFiles()).rejects.toThrow(
      "inspected bytes",
    );
    await expect(session.readProducedFiles()).rejects.toThrow("unavailable");
    await expect(
      session.execute(APPROVED_APPLICATION_BUILD_COMMANDS.lint),
    ).rejects.toThrow("unavailable");
    await session.dispose();
    expect(engine.containers.size).toBe(0);
    expect(engine.volumes.size).toBe(0);
  });
  it("fails cleanup visibly and permits exact cleanup retry without permitting more work", async () => {
    const engine = new Engine(),
      session = await engine.executor().open(fixture());
    engine.failRemoval = true;
    await expect(session.dispose()).rejects.toThrow("control operation failed");
    await expect(
      session.execute(APPROVED_APPLICATION_BUILD_COMMANDS.install),
    ).rejects.toThrow("unavailable");
    engine.failRemoval = false;
    await session.dispose();
    expect(engine.containers.size).toBe(0);
    expect(engine.volumes.size).toBe(0);
  });
  it("never removes a container whose current owner token differs", async () => {
    const engine = new Engine(),
      session = await engine.executor().open(fixture());
    engine.inspectChange = (kind, value) => {
      if (kind !== "container") return value;
      const container = value as ReturnType<Engine["inspectedContainer"]>;
      return {
        ...container,
        Config: {
          ...container.Config,
          Labels: {
            "cloudmarkup.owner": owner,
            "cloudmarkup.cleanup-token": bootId,
          },
        },
      };
    };
    await expect(session.dispose()).rejects.toThrow("ownership");
    expect(
      engine.calls
        .filter((call) => call.args[0] === "container" && call.args[1] === "rm")
        .every((call) => !call.args.at(-1)?.endsWith("-holder")),
    ).toBe(true);
  });
});

describe("actual memory filesystem admission protocol", () => {
  const mount =
    "31 20 0:40 / /workspace rw,nosuid,nodev - tmpfs tmpfs rw,size=4k,noswap,uid=65532,gid=65532";
  it("requires private temporary mounts to be bounded, non-swapping and non-executable", () => {
    const temporary = mount
      .replace("/workspace", "/tmp")
      .replace("rw,nosuid,nodev", "rw,nosuid,nodev,noexec");
    expect(() => {
      assertTmpfsMount(temporary, "/tmp", 4096, true);
    }).not.toThrow();
    for (const invalid of [
      temporary.replace(",noexec", ""),
      temporary.replace(",noswap", ""),
      temporary.replace("size=4k", "size=8k"),
    ])
      expect(() => {
        assertTmpfsMount(invalid, "/tmp", 4096, true);
      }).toThrow();
    expect(
      temporaryMemoryBytes({ ...fixture().limits, maxTotalFileBytes: 1 }),
    ).toBe(4096);
    expect(
      temporaryMemoryBytes({ ...fixture().limits, maxTotalFileBytes: 4097 }),
    ).toBe(8192);
  });
  it("accepts only exact tmpfs/no-swap mount information", () => {
    expect(() => {
      assertTmpfsMount(mount, "/workspace", 4096);
    }).not.toThrow();
    for (const bad of [
      mount.replace("tmpfs tmpfs", "ext4 /dev/sda1"),
      mount.replace(",noswap", ""),
      mount.replace("size=4k", "size=8k"),
      mount + "\n" + mount,
    ])
      expect(() => {
        assertTmpfsMount(bad, "/workspace", 4096);
      }).toThrow();
    expect(() => {
      assertNoSwap(swaps);
    }).not.toThrow();
    expect(() => {
      assertNoSwap("");
    }).toThrow();
    const coreLimits =
      "Max core file size        0          0          bytes\n";
    expect(() => {
      assertNoCoreDumps(coreLimits, "core\n");
    }).not.toThrow();
    expect(() => {
      assertNoCoreDumps(coreLimits, "core.%p\n");
    }).not.toThrow();
    for (const receiver of [
      "|/usr/bin/collector %P",
      "@/run/core",
      "",
      "core\nextra",
    ])
      expect(() => {
        assertNoCoreDumps(coreLimits, receiver);
      }).toThrow();
  });
  it("rejects duplicate, traversal and portable-collision authority entries", () => {
    const authority = { digest: "a".repeat(64), mode: 0o600, sizeBytes: 1 };
    for (const paths of [
      ["application/../escape"],
      ["application/a", "application/a"],
      ["application/A", "application/a"],
    ])
      expect(
        memoryAuthoritySchema.safeParse({
          directories: [],
          files: paths.map((path) => [path, authority]),
        }).success,
      ).toBe(false);
  });
  it("round-trips bounded authority without content or host paths", () => {
    const state = {
      directories: [["application", 0o700] as const],
      files: [
        [
          "application/a",
          { digest: "a".repeat(64), mode: 0o600, sizeBytes: 1 },
        ] as const,
      ],
    };
    const parsed = memoryAuthoritySchema.parse(state);
    expect(encodeMemoryAuthority(decodeMemoryAuthority(parsed))).toEqual(
      parsed,
    );
    expect(canonicalJson(parsed)).not.toContain(sentinel);
  });
});

describe("transient host-only memory factory and cancellation", () => {
  function hostExecutor(engine: Engine) {
    const policy = applicationHostRepairSeedPolicyV1Schema.parse({
      ...fixture().policy,
      profile: createApplicationHostRepairSeedProfileV1(),
    });
    return createMemoryHostRepairSeedContainerExecutorForTesting(
      {
        containerRuntimeExecutable: resolve("docker"),
        policy,
        helperDigest,
        cacheBytes: 4096,
      },
      {
        runProcess: engine.run,
        readHost: () => Promise.resolve(engine.host),
        randomId: () => token,
      },
    );
  }

  it("validates distinct policy branches without casting the host profile", () => {
    const engine = new Engine();
    const input = {
      containerRuntimeExecutable: resolve("docker"),
      policy: fixture().policy,
      helperDigest,
      cacheBytes: 4096,
    };
    const seam = {
      runProcess: engine.run,
      readHost: () => Promise.resolve(engine.host),
      randomId: () => token,
    };
    const host = {
      ...fixture().policy,
      profile: createApplicationHostRepairSeedProfileV1(),
    };
    expect(applicationBuildPolicyV1Schema.safeParse(host).success).toBe(false);
    expect(
      applicationHostRepairSeedPolicyV1Schema.safeParse(fixture().policy)
        .success,
    ).toBe(false);
    expect(() => {
      hostExecutor(engine);
    }).not.toThrow();
    const invalidOld = structuredClone(input.policy);
    invalidOld.profile.sourcePolicy = "user-provided-static-only";
    const invalidHost = applicationHostRepairSeedPolicyV1Schema.parse(host);
    invalidHost.profile.digest = sha256Digest("substituted host profile");
    expect(() => {
      createMemoryApplicationBuildContainerExecutorForTesting(
        { ...input, policy: invalidOld },
        seam,
      );
    }).toThrow();
    expect(() => {
      createMemoryHostRepairSeedContainerExecutorForTesting(
        { ...input, policy: invalidHost },
        seam,
      );
    }).toThrow();
    expect(engine.calls).toEqual([]);
  });

  it("rejects an already aborted open before host or container reads", async () => {
    const engine = new Engine();
    const abort = new AbortController();
    abort.abort();
    const readHost = vi.fn(() => Promise.resolve(engine.host));
    const executor = createMemoryApplicationBuildContainerExecutorForTesting(
      {
        containerRuntimeExecutable: resolve("docker"),
        policy: fixture().policy,
        helperDigest,
        cacheBytes: 4096,
      },
      { runProcess: engine.run, readHost, randomId: () => token },
    );
    await expect(
      executor.open({ ...fixture(), signal: abort.signal }),
    ).rejects.toThrow();
    expect(readHost).not.toHaveBeenCalled();
    expect(engine.calls).toEqual([]);
  });

  it.each(["probe", "seed"])(
    "cleans exact owned resources after cancellation during %s initialization",
    async (operation) => {
      const engine = new Engine();
      const abort = new AbortController();
      engine.helperChange = (response) => {
        if (response.operation === operation) abort.abort();
        return response;
      };
      await expect(
        hostExecutor(engine).open({ ...fixture(), signal: abort.signal }),
      ).rejects.toThrow();
      expect(engine.volumes.size).toBe(0);
      expect(engine.containers.size).toBe(0);
      expect(engine.toolRuns).toBe(0);
      if (operation === "probe")
        expect([...engine.content.values()]).not.toContain(sentinel);
      const cleanup = engine.calls.filter(
        (call) => call.limits.wallTimeMilliseconds === 5000,
      );
      expect(cleanup.length).toBeGreaterThan(0);
      expect(cleanup.every((call) => call.signal === undefined)).toBe(true);
    },
  );

  it("passes one lifetime signal through seed, inspect, prune and collection", async () => {
    const engine = new Engine();
    const abort = new AbortController();
    const session = await hostExecutor(engine).open({
      ...fixture(),
      signal: abort.signal,
    });
    for (const command of Object.values(APPROVED_APPLICATION_BUILD_COMMANDS))
      await session.execute(command, abort.signal);
    await session.readProducedFiles();
    await session.dispose();
    const requests = engine.calls.filter((call) => call.stdin !== undefined);
    for (const operation of ["seed", "inspect", "prune", "collect"]) {
      const calls = requests.filter((call) => {
        const raw: unknown = JSON.parse(
          Buffer.from(call.stdin ?? []).toString("utf8"),
        );
        return memoryWorkspaceRequestSchema.parse(raw).operation === operation;
      });
      expect(calls.length).toBeGreaterThan(0);
      expect(
        calls.every(
          (call) => call.signal !== undefined && !call.signal.aborted,
        ),
      ).toBe(true);
    }
    expect(engine.volumes.size).toBe(0);
    expect(engine.containers.size).toBe(0);
  });

  it("disposes after cancellation without sending further source or command data", async () => {
    const engine = new Engine();
    const abort = new AbortController();
    const session = await hostExecutor(engine).open({
      ...fixture(),
      signal: abort.signal,
    });
    const before = engine.calls.length;
    abort.abort();
    await expect(
      session.execute(
        APPROVED_APPLICATION_BUILD_COMMANDS.install,
        abort.signal,
      ),
    ).rejects.toThrow();
    await session.dispose();
    const after = engine.calls.slice(before);
    expect(
      after.every(
        (call) =>
          call.stdin === undefined &&
          call.signal === undefined &&
          call.limits.wallTimeMilliseconds === 5000,
      ),
    ).toBe(true);
    expect(engine.volumes.size).toBe(0);
    expect(engine.containers.size).toBe(0);
  });

  it("does not report initialization cleanup success when owned removal fails", async () => {
    const engine = new Engine();
    const abort = new AbortController();
    engine.helperChange = (response) => {
      if (response.operation === "probe") {
        engine.failRemoval = true;
        abort.abort();
      }
      return response;
    };
    await expect(
      hostExecutor(engine).open({ ...fixture(), signal: abort.signal }),
    ).rejects.toThrow();
    expect(engine.volumes.size + engine.containers.size).toBeGreaterThan(0);
  });
});

describe("bound repair candidate memory policy", () => {
  function candidateExecutor(engine: Engine) {
    const policy = applicationHostRepairCandidatePolicyV1Schema.parse({
      ...fixture().policy,
      profile: createApplicationHostRepairCandidateProfileV1(),
    });
    const executor = createMemoryHostRepairCandidateContainerExecutorForTesting(
      {
        containerRuntimeExecutable: resolve("docker"),
        policy,
        helperDigest,
        cacheBytes: 4096,
      },
      {
        runProcess: engine.run,
        readHost: () => Promise.resolve(engine.host),
        randomId: () => token,
      },
    );
    return { executor, policy };
  }
  it("uses the same RAM-only protocol and removes its owned resources", async () => {
    const engine = new Engine();
    const { executor, policy } = candidateExecutor(engine);
    expect(applicationBuildPolicyV1Schema.safeParse(policy).success).toBe(
      false,
    );
    expect(
      applicationHostRepairSeedPolicyV1Schema.safeParse(policy).success,
    ).toBe(false);
    const session = await executor.open(fixture());
    await session.execute(APPROVED_APPLICATION_BUILD_COMMANDS.install);
    await session.dispose();
    expect(engine.volumes.size).toBe(0);
    expect(hostFs.writeFile).not.toHaveBeenCalled();
    expect(
      engine.calls.some((call) =>
        call.args.some((arg) => arg.includes(sentinel)),
      ),
    ).toBe(false);
  });
  it("rejects a substituted candidate profile before native operations", () => {
    const engine = new Engine();
    const { policy } = candidateExecutor(engine);
    policy.profile.digest = sha256Digest("foreign candidate profile");
    expect(() =>
      createMemoryHostRepairCandidateContainerExecutorForTesting(
        {
          containerRuntimeExecutable: resolve("docker"),
          policy,
          helperDigest,
          cacheBytes: 4096,
        },
        {
          runProcess: engine.run,
          readHost: () => Promise.resolve(engine.host),
          randomId: () => token,
        },
      ),
    ).toThrow();
    expect(engine.calls).toEqual([]);
  });
});
