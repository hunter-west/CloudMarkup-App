import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { isApprovedApplicationBuildInvocation } from "./commands.js";
import {
  applicationBuildPolicyV1Schema,
  type ApplicationBuildCommandInvocation,
  type ApplicationBuildCommandResult,
  type ApplicationDependencyLockV1,
  type ApplicationBuildLimitsV1,
  type ApplicationBuildPolicyV1,
  type ApplicationBuildProducedFile,
  type ApplicationBuildWorkspaceExecutor,
  type ApplicationBuildWorkspaceSession,
} from "./contracts.js";

import {
  assertExactAuthority,
  assertWorkspaceAuthority,
  collectRuntimeDependencyFiles,
  ensureWithin,
  inspectWorkspace,
  subtreeAuthority,
  type WorkspaceAuthority,
} from "./workspace-authority.js";

export interface LocalApplicationBuildContainerConfig {
  readonly containerRuntimeExecutable: string;
  readonly policy: ApplicationBuildPolicyV1;
}

type ApplicationBuildHostProcessRunner = (
  executable: string,
  args: readonly string[],
  limits: ApplicationBuildLimitsV1,
  signal?: AbortSignal,
) => Promise<ApplicationBuildCommandResult>;

type ApplicationBuildDirectoryRemover = (path: string) => Promise<void>;

interface ResolvedLocalApplicationBuildContainerConfig extends LocalApplicationBuildContainerConfig {
  readonly containerUser: string;
  readonly runProcess: ApplicationBuildHostProcessRunner;
}

const applicationBuildContainerExecutableByName = new Map<string, string>([
  ["eslint", "/opt/cloudmarkup/bin/eslint"],
  ["pnpm", "/opt/cloudmarkup/bin/pnpm"],
  ["trivy", "/opt/cloudmarkup/bin/trivy"],
  ["tsc", "/opt/cloudmarkup/bin/tsc"],
  ["vitest", "/opt/cloudmarkup/bin/vitest"],
]);

export interface LocalApplicationBuildContainerTestSeam {
  readonly containerUser: string;
  readonly runProcess: ApplicationBuildHostProcessRunner;
}

function unprivilegedContainerUser(): string {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) return "65532:65532";
  if (
    !Number.isSafeInteger(uid) ||
    !Number.isSafeInteger(gid) ||
    uid <= 0 ||
    gid <= 0
  ) {
    throw new TypeError(
      "Application build container requires an unprivileged host UID and GID.",
    );
  }
  return `${String(uid)}:${String(gid)}`;
}

function hostEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR"]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function runHostProcess(
  executable: string,
  args: readonly string[],
  limits: ApplicationBuildLimitsV1,
  signal?: AbortSignal,
): Promise<ApplicationBuildCommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn(executable, [...args], {
      env: hostEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let termination: ApplicationBuildCommandResult["termination"] = "completed";
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolveResult({ exitCode, outputBytes, stderr, stdout, termination });
    };
    const stop = (reason: ApplicationBuildCommandResult["termination"]) => {
      if (settled) return;
      termination = reason;
      child.kill("SIGKILL");
    };
    const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > limits.maxOutputBytes) {
        stop("output-limit");
        return;
      }
      if (stream === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => {
      append("stdout", chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      append("stderr", chunk);
    });
    child.once("error", () => {
      termination = "unavailable";
      finish(null);
    });
    child.once("close", (code) => {
      finish(code);
    });
    const abort = () => {
      stop("cancelled");
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted === true) abort();
    const timer = setTimeout(() => {
      stop("timeout");
    }, limits.wallTimeMilliseconds);
    timer.unref();
  });
}

function applicationBuildCommandSucceeded(
  result: ApplicationBuildCommandResult,
): boolean {
  return result.termination === "completed" && result.exitCode === 0;
}

function exactEngineNameIsListed(output: string, name: string): boolean {
  return output
    .split(/\r?\n/gu)
    .map((entry) => entry.trim())
    .some((entry) => entry === name);
}

async function removeExactApplicationBuildContainer(input: {
  readonly cleanupToken: string;
  readonly containerName: string;
  readonly limits: ApplicationBuildLimitsV1;
  readonly runProcess: ApplicationBuildHostProcessRunner;
  readonly runtime: string;
}): Promise<void> {
  const cleanupLimits = {
    ...input.limits,
    wallTimeMilliseconds: 5_000,
  };
  const listingArgs = [
    "container",
    "ls",
    "--all",
    "--format",
    "{{.Names}}",
    "--filter",
    "name=" + input.containerName,
  ];
  const initialListing = await input.runProcess(
    input.runtime,
    listingArgs,
    cleanupLimits,
  );
  if (!applicationBuildCommandSucceeded(initialListing)) {
    throw new TypeError("Application build container cleanup lookup failed.");
  }
  if (!exactEngineNameIsListed(initialListing.stdout, input.containerName)) {
    return;
  }
  const ownership = await input.runProcess(
    input.runtime,
    [
      "container",
      "inspect",
      "--format",
      '{{ index .Config.Labels "cloudmarkup.cleanup-token" }}',
      input.containerName,
    ],
    cleanupLimits,
  );
  if (
    !applicationBuildCommandSucceeded(ownership) ||
    ownership.stdout.trim() !== input.cleanupToken
  ) {
    throw new TypeError(
      "Application build container cleanup ownership check failed.",
    );
  }
  const removal = await input.runProcess(
    input.runtime,
    ["rm", "--force", input.containerName],
    cleanupLimits,
  );
  const verification = await input.runProcess(
    input.runtime,
    listingArgs,
    cleanupLimits,
  );
  const absenceVerified =
    applicationBuildCommandSucceeded(verification) &&
    !exactEngineNameIsListed(verification.stdout, input.containerName);
  if (!applicationBuildCommandSucceeded(removal) || !absenceVerified) {
    throw new TypeError(
      applicationBuildCommandSucceeded(removal)
        ? "Application build container cleanup verification failed."
        : "Application build container cleanup failed.",
    );
  }
}

async function cleanupLocalApplicationBuildResources(
  input: {
    readonly cleanupToken: string;
    readonly containerName: string;
    readonly limits: ApplicationBuildLimitsV1;
    readonly root: string;
    readonly runtime: string;
    readonly scannerCacheRoot: string;
  },
  seam: {
    readonly removeDirectory: ApplicationBuildDirectoryRemover;
    readonly runProcess: ApplicationBuildHostProcessRunner;
  },
): Promise<void> {
  const expectedPrefix = resolve(tmpdir(), "cloudmarkup-application-build-");
  const expectedCachePrefix = resolve(
    tmpdir(),
    "cloudmarkup-application-build-trivy-",
  );
  if (!input.root.startsWith(expectedPrefix))
    throw new TypeError("Refusing to remove an unexpected build workspace.");
  if (!input.scannerCacheRoot.startsWith(expectedCachePrefix))
    throw new TypeError("Refusing to remove an unexpected scanner cache.");
  if (
    !/^cloudmarkup-application-build-[a-z0-9_.-]+$/u.test(input.containerName)
  ) {
    throw new TypeError("Refusing to remove an unexpected build container.");
  }
  if (!/^[a-f0-9-]{36}$/u.test(input.cleanupToken)) {
    throw new TypeError("Refusing an unexpected build cleanup token.");
  }

  await removeExactApplicationBuildContainer({
    cleanupToken: input.cleanupToken,
    containerName: input.containerName,
    limits: input.limits,
    runProcess: seam.runProcess,
    runtime: input.runtime,
  });
  const removals = await Promise.allSettled([
    seam.removeDirectory(input.root),
    seam.removeDirectory(input.scannerCacheRoot),
  ]);
  if (removals.some(({ status }) => status === "rejected")) {
    throw new TypeError("Application build workspace cleanup failed.");
  }
}

class LocalApplicationBuildSession implements ApplicationBuildWorkspaceSession {
  readonly #cleanupToken: string;
  readonly #config: ResolvedLocalApplicationBuildContainerConfig;
  readonly #containerName: string;
  readonly #limits: ApplicationBuildLimitsV1;
  readonly #lock: ApplicationDependencyLockV1;
  readonly #root: string;
  readonly #scannerCacheRoot: string;
  readonly #sourceAuthority: WorkspaceAuthority;
  #compiledAuthority: WorkspaceAuthority | undefined;
  #disposed = false;
  #installedAuthority: WorkspaceAuthority | undefined;
  #productionPruned = false;

  public constructor(
    config: ResolvedLocalApplicationBuildContainerConfig,
    root: string,
    scannerCacheRoot: string,
    limits: ApplicationBuildLimitsV1,
    lock: ApplicationDependencyLockV1,
    sourceAuthority: WorkspaceAuthority,
  ) {
    this.#config = config;
    this.#root = root;
    this.#scannerCacheRoot = scannerCacheRoot;
    this.#limits = limits;
    this.#lock = lock;
    this.#sourceAuthority = sourceAuthority;
    this.#cleanupToken = randomUUID();
    this.#containerName = `cloudmarkup-application-build-${basename(root)
      .replace(/[^a-z0-9_.-]/giu, "-")
      .toLowerCase()}`;
  }

  public async execute(
    invocation: ApplicationBuildCommandInvocation,
    signal?: AbortSignal,
  ): Promise<ApplicationBuildCommandResult> {
    if (this.#disposed)
      throw new TypeError("Application build workspace is disposed.");
    if (!isApprovedApplicationBuildInvocation(invocation)) {
      throw new TypeError(
        "Application build command binary or arguments are not approved.",
      );
    }
    const containerExecutable = applicationBuildContainerExecutableByName.get(
      invocation.executable,
    );
    if (containerExecutable === undefined) {
      throw new TypeError(
        "Application build command binary has no approved container entrypoint.",
      );
    }
    if (invocation.step === "production-prune") {
      if (
        this.#installedAuthority === undefined ||
        this.#compiledAuthority === undefined
      )
        throw new TypeError(
          "Production dependencies require a completed build.",
        );
      const current = await inspectWorkspace(this.#root, this.#limits);
      assertWorkspaceAuthority(current, this.#sourceAuthority, [
        "application/node_modules",
        "application/dist",
      ]);
      assertExactAuthority(
        current,
        this.#installedAuthority,
        "application/node_modules",
      );
      assertExactAuthority(
        current,
        this.#compiledAuthority,
        "application/dist",
      );
      const installedRoot = resolve(this.#root, "application/node_modules");
      ensureWithin(this.#root, installedRoot);
      await rm(installedRoot, { recursive: true, force: true });
    }
    const policy = this.#config.policy;
    const image = `${policy.container.image}@${policy.container.digest}`;
    const scannerCacheArgs =
      invocation.executable === "trivy"
        ? [
            "--mount",
            `type=bind,source=${this.#scannerCacheRoot},target=/tmp/cloudmarkup-trivy-cache`,
          ]
        : [];
    const args = [
      "run",
      "--rm",
      "--name",
      this.#containerName,
      "--label",
      "cloudmarkup.cleanup-token=" + this.#cleanupToken,
      "--pull",
      "never",
      "--platform",
      policy.container.platform,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--pids-limit",
      String(this.#limits.maxProcesses),
      "--memory",
      `${String(this.#limits.memoryMiB)}m`,
      "--cpus",
      "1.0",
      "--ulimit",
      `cpu=${String(this.#limits.cpuSeconds)}:${String(this.#limits.cpuSeconds)}`,
      "--tmpfs",
      `/tmp:rw,noexec,nosuid,nodev,size=${String(Math.min(this.#limits.maxTotalFileBytes, 128 * 1024 * 1024))}`,
      "--user",
      this.#config.containerUser,
      "--workdir",
      "/workspace",
      "--mount",
      `type=bind,source=${this.#root},target=/workspace${
        new Set(["install", "compile", "production-prune"]).has(invocation.step)
          ? ""
          : ",readonly"
      }`,
      ...scannerCacheArgs,
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
      containerExecutable,
      image,
      ...invocation.args,
    ];
    const result = await this.#config.runProcess(
      this.#config.containerRuntimeExecutable,
      args,
      this.#limits,
      signal,
    );
    const workspace = await inspectWorkspace(this.#root, this.#limits);
    const generatedRoots = [
      ...(this.#installedAuthority === undefined
        ? invocation.step === "install"
          ? ["application/node_modules"]
          : []
        : ["application/node_modules"]),
      ...(invocation.step === "compile" || this.#compiledAuthority !== undefined
        ? ["application/dist"]
        : []),
    ];
    assertWorkspaceAuthority(workspace, this.#sourceAuthority, generatedRoots);
    if (
      this.#installedAuthority !== undefined &&
      invocation.step !== "production-prune"
    ) {
      assertExactAuthority(
        workspace,
        this.#installedAuthority,
        "application/node_modules",
      );
    }
    if (this.#compiledAuthority !== undefined) {
      assertExactAuthority(
        workspace,
        this.#compiledAuthority,
        "application/dist",
      );
    }
    const passed = result.termination === "completed" && result.exitCode === 0;
    if (passed && invocation.step === "install") {
      const installed = subtreeAuthority(workspace, "application/node_modules");
      if (!installed.directories.has("application/node_modules")) {
        throw new TypeError(
          "Application dependency installation produced no node_modules tree.",
        );
      }
      this.#installedAuthority = installed;
    }
    if (passed && invocation.step === "compile") {
      const compiled = subtreeAuthority(workspace, "application/dist");
      if (!compiled.directories.has("application/dist")) {
        throw new TypeError("Application compilation produced no dist tree.");
      }
      this.#compiledAuthority = compiled;
    }
    if (passed && invocation.step === "production-prune") {
      this.#productionPruned = true;
    }
    return result;
  }

  public async readProducedFiles(): Promise<
    readonly ApplicationBuildProducedFile[]
  > {
    if (this.#disposed)
      throw new TypeError("Application build workspace is disposed.");
    const workspace = await inspectWorkspace(this.#root, this.#limits);
    assertWorkspaceAuthority(workspace, this.#sourceAuthority, [
      "application/dist",
      "application/node_modules",
    ]);
    if (this.#compiledAuthority === undefined || !this.#productionPruned) {
      throw new TypeError(
        "Application build output was read before compile and prune completed.",
      );
    }
    assertExactAuthority(
      workspace,
      this.#compiledAuthority,
      "application/dist",
    );
    const output: ApplicationBuildProducedFile[] = [];
    for (const prefix of ["application/dist"]) {
      const target = resolve(this.#root, prefix);
      ensureWithin(this.#root, target);
      let entries;
      try {
        entries = await readdir(target, {
          recursive: true,
          withFileTypes: true,
        });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const path = resolve(entry.parentPath, entry.name);
        ensureWithin(this.#root, path);
        const stats = await lstat(path);
        const relativePath = relative(this.#root, path).split(sep).join("/");
        if (stats.isSymbolicLink()) {
          output.push({
            bytes: new Uint8Array(),
            kind: "symlink",
            path: relativePath,
          });
        } else if (!stats.isFile()) {
          if (!stats.isDirectory())
            output.push({
              bytes: new Uint8Array(),
              kind: "device-file",
              path: relativePath,
            });
        } else {
          output.push({
            bytes: await readFile(path),
            kind: "regular-file",
            path: relativePath,
          });
        }
      }
    }
    output.push(
      ...(await collectRuntimeDependencyFiles(this.#root, this.#lock)),
    );
    return output.sort((left, right) =>
      left.path < right.path ? -1 : left.path === right.path ? 0 : 1,
    );
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) return;
    await cleanupLocalApplicationBuildResources(
      {
        cleanupToken: this.#cleanupToken,
        containerName: this.#containerName,
        limits: this.#limits,
        root: this.#root,
        runtime: this.#config.containerRuntimeExecutable,
        scannerCacheRoot: this.#scannerCacheRoot,
      },
      {
        removeDirectory: (path) => rm(path, { force: true, recursive: true }),
        runProcess: this.#config.runProcess,
      },
    );
    this.#disposed = true;
  }
}

function createLocalApplicationBuildContainerExecutorWithRunner(
  input: LocalApplicationBuildContainerConfig,
  seam: LocalApplicationBuildContainerTestSeam,
): ApplicationBuildWorkspaceExecutor {
  if (!isAbsolute(input.containerRuntimeExecutable)) {
    throw new TypeError(
      "Container runtime executable must be an absolute trusted path.",
    );
  }
  if (
    !new Set(["docker", "docker.exe", "podman", "podman.exe"]).has(
      basename(input.containerRuntimeExecutable).toLowerCase(),
    )
  ) {
    throw new TypeError(
      "Container runtime must be an allow-listed Docker or Podman binary.",
    );
  }
  if (/[,\r\n]/u.test(tmpdir()))
    throw new TypeError(
      "Temporary root cannot be represented as an exact container mount.",
    );
  const policy = applicationBuildPolicyV1Schema.parse(input.policy);
  const config: ResolvedLocalApplicationBuildContainerConfig = {
    ...input,
    containerUser: seam.containerUser,
    policy,
    runProcess: seam.runProcess,
  };
  return {
    async open({ files, limits, lock }) {
      const root = await mkdtemp(
        join(tmpdir(), "cloudmarkup-application-build-"),
      );
      let scannerCacheRoot;
      try {
        scannerCacheRoot = await mkdtemp(
          join(tmpdir(), "cloudmarkup-application-build-trivy-"),
        );
        for (const file of files) {
          const path = resolve(root, file.path);
          ensureWithin(root, path);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, file.content, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
        }
        const lockPath = resolve(root, lock.lockfilePath);
        ensureWithin(root, lockPath);
        await mkdir(dirname(lockPath), { recursive: true });
        await writeFile(lockPath, lock.lockfileContent, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        const sourceAuthority = await inspectWorkspace(root, limits);
        return new LocalApplicationBuildSession(
          config,
          root,
          scannerCacheRoot,
          limits,
          lock,
          sourceAuthority,
        );
      } catch (error) {
        await Promise.all([
          rm(root, { force: true, recursive: true }),
          ...(scannerCacheRoot === undefined
            ? []
            : [rm(scannerCacheRoot, { force: true, recursive: true })]),
        ]);
        throw error;
      }
    },
  };
}

export function createLocalApplicationBuildContainerExecutor(
  input: LocalApplicationBuildContainerConfig,
): ApplicationBuildWorkspaceExecutor {
  return createLocalApplicationBuildContainerExecutorWithRunner(input, {
    containerUser: unprivilegedContainerUser(),
    runProcess: runHostProcess,
  });
}

/** @internal Test-only process seam; not exported from the package root. */
export function createLocalApplicationBuildContainerExecutorForTesting(
  input: LocalApplicationBuildContainerConfig,
  seam: LocalApplicationBuildContainerTestSeam,
): ApplicationBuildWorkspaceExecutor {
  if (!/^[1-9][0-9]*:[1-9][0-9]*$/u.test(seam.containerUser)) {
    throw new TypeError(
      "Application build test seam requires an unprivileged numeric UID and GID.",
    );
  }
  return createLocalApplicationBuildContainerExecutorWithRunner(input, seam);
}

/** @internal Cleanup regression seam; not exported from the package root. */
export function cleanupLocalApplicationBuildResourcesForTesting(
  input: {
    readonly cleanupToken: string;
    readonly containerName: string;
    readonly limits: ApplicationBuildLimitsV1;
    readonly root: string;
    readonly runtime: string;
    readonly scannerCacheRoot: string;
  },
  seam: {
    readonly removeDirectory: ApplicationBuildDirectoryRemover;
    readonly runProcess: ApplicationBuildHostProcessRunner;
  },
): Promise<void> {
  return cleanupLocalApplicationBuildResources(input, seam);
}
