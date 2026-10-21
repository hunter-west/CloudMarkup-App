import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { isApprovedInvocation } from "./commands.js";
import {
  terraformValidationPolicyV1Schema,
  type TerraformValidationLimitsV1,
  type TerraformValidationPolicyV1,
  type ValidationCommandInvocation,
  type ValidationCommandResult,
  type ValidationWorkspaceExecutor,
  type ValidationWorkspaceSession,
} from "./contracts.js";
import {
  inspectValidationInputWorkspace,
  TERRAFORM_VALIDATION_RUNTIME_GID,
  TERRAFORM_VALIDATION_RUNTIME_UID,
  validationVolumeName,
} from "./local-container-workspace.js";

export interface LocalPinnedContainerExecutorConfig {
  readonly containerRuntimeExecutable: string;
  readonly policy: TerraformValidationPolicyV1;
}

type TerraformValidationHostProcessRunner = (
  executable: string,
  args: readonly string[],
  limits: TerraformValidationLimitsV1,
  signal?: AbortSignal,
) => Promise<ValidationCommandResult>;

type TerraformValidationDirectoryRemover = (path: string) => Promise<void>;

function runtimeEnvironment(): NodeJS.ProcessEnv {
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
  limits: TerraformValidationLimitsV1,
  signal?: AbortSignal,
): Promise<ValidationCommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn(executable, [...args], {
      env: runtimeEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let termination: ValidationCommandResult["termination"] = "completed";
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolveResult({ exitCode, outputBytes, stderr, stdout, termination });
    };
    const stop = (reason: ValidationCommandResult["termination"]) => {
      if (settled) return;
      termination = reason;
      child.kill("SIGKILL");
    };
    const append = (stream: "stderr" | "stdout", chunk: Buffer) => {
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

function imageReference(policy: TerraformValidationPolicyV1): string {
  return `${policy.container.image}@${policy.container.digest}`;
}

function boundedTmpfs(limits: TerraformValidationLimitsV1): string {
  return `/tmp:rw,noexec,nosuid,nodev,size=${String(
    Math.min(limits.maxTotalFileBytes, 64 * 1024 * 1024),
  )}`;
}

function validationContainerArgs(input: {
  readonly cleanupToken: string;
  readonly containerName: string;
  readonly limits: TerraformValidationLimitsV1;
  readonly policy: TerraformValidationPolicyV1;
  readonly volumeName: string;
}): string[] {
  return [
    "run",
    "--rm",
    "--name",
    input.containerName,
    "--label",
    "cloudmarkup.cleanup-token=" + input.cleanupToken,
    "--pull",
    "never",
    "--platform",
    input.policy.container.platform,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    String(input.limits.maxProcesses),
    "--memory",
    `${String(input.limits.memoryMiB)}m`,
    "--cpus",
    "1.0",
    "--ulimit",
    `cpu=${String(input.limits.cpuSeconds)}:${String(input.limits.cpuSeconds)}`,
    "--tmpfs",
    boundedTmpfs(input.limits),
    "--user",
    `${String(TERRAFORM_VALIDATION_RUNTIME_UID)}:${String(
      TERRAFORM_VALIDATION_RUNTIME_GID,
    )}`,
    "--workdir",
    "/workspace/infrastructure",
    "--mount",
    `type=volume,source=${input.volumeName},target=/workspace,volume-nocopy`,
    "--env",
    "CHECKPOINT_DISABLE=1",
    "--env",
    "HOME=/tmp",
    "--env",
    "TF_IN_AUTOMATION=1",
    "--env",
    `TF_CLI_CONFIG_FILE=${input.policy.container.terraformCliConfigPath}`,
  ];
}

function commandSucceeded(result: ValidationCommandResult): boolean {
  return result.termination === "completed" && result.exitCode === 0;
}

function exactEngineNameIsListed(output: string, name: string): boolean {
  return output
    .split(/\r?\n/gu)
    .map((entry) => entry.trim())
    .some((entry) => entry === name);
}

async function assertExactVolumeAbsent(input: {
  readonly limits: TerraformValidationLimitsV1;
  readonly runProcess: TerraformValidationHostProcessRunner;
  readonly runtime: string;
  readonly volumeName: string;
}): Promise<void> {
  const collision = await input.runProcess(
    input.runtime,
    [
      "volume",
      "ls",
      "--format",
      "{{.Name}}",
      "--filter",
      "name=" + input.volumeName,
    ],
    input.limits,
  );
  if (!commandSucceeded(collision)) {
    throw new TypeError("Validation workspace volume collision lookup failed.");
  }
  if (exactEngineNameIsListed(collision.stdout, input.volumeName)) {
    throw new TypeError("Validation workspace volume already exists.");
  }
}

async function removeExactContainer(input: {
  readonly cleanupToken: string;
  readonly containerName: string;
  readonly limits: TerraformValidationLimitsV1;
  readonly runProcess: TerraformValidationHostProcessRunner;
  readonly runtime: string;
}): Promise<void> {
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
    input.limits,
  );
  if (!commandSucceeded(initialListing)) {
    throw new TypeError("Validation container cleanup lookup failed.");
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
    input.limits,
  );
  if (
    !commandSucceeded(ownership) ||
    ownership.stdout.trim() !== input.cleanupToken
  ) {
    throw new TypeError("Validation container cleanup ownership check failed.");
  }
  const removal = await input.runProcess(
    input.runtime,
    ["rm", "--force", input.containerName],
    input.limits,
  );
  const verification = await input.runProcess(
    input.runtime,
    listingArgs,
    input.limits,
  );
  const absenceVerified =
    commandSucceeded(verification) &&
    !exactEngineNameIsListed(verification.stdout, input.containerName);
  if (!commandSucceeded(removal) || !absenceVerified) {
    throw new TypeError(
      commandSucceeded(removal)
        ? "Validation container cleanup verification failed."
        : "Validation container cleanup failed.",
    );
  }
}

async function removeExactVolume(input: {
  readonly cleanupToken: string;
  readonly limits: TerraformValidationLimitsV1;
  readonly runProcess: TerraformValidationHostProcessRunner;
  readonly runtime: string;
  readonly volumeName: string;
}): Promise<void> {
  const listingArgs = [
    "volume",
    "ls",
    "--format",
    "{{.Name}}",
    "--filter",
    "name=" + input.volumeName,
  ];
  const initialListing = await input.runProcess(
    input.runtime,
    listingArgs,
    input.limits,
  );
  if (!commandSucceeded(initialListing)) {
    throw new TypeError("Validation workspace volume cleanup lookup failed.");
  }
  if (!exactEngineNameIsListed(initialListing.stdout, input.volumeName)) {
    return;
  }
  const ownership = await input.runProcess(
    input.runtime,
    [
      "volume",
      "inspect",
      "--format",
      '{{ index .Labels "cloudmarkup.cleanup-token" }}',
      input.volumeName,
    ],
    input.limits,
  );
  if (
    !commandSucceeded(ownership) ||
    ownership.stdout.trim() !== input.cleanupToken
  ) {
    throw new TypeError(
      "Validation workspace volume cleanup ownership check failed.",
    );
  }
  const removal = await input.runProcess(
    input.runtime,
    ["volume", "rm", "--force", input.volumeName],
    input.limits,
  );
  const verification = await input.runProcess(
    input.runtime,
    listingArgs,
    input.limits,
  );
  const absenceVerified =
    commandSucceeded(verification) &&
    !exactEngineNameIsListed(verification.stdout, input.volumeName);
  if (!commandSucceeded(removal) || !absenceVerified) {
    throw new TypeError(
      commandSucceeded(removal)
        ? "Validation workspace volume cleanup verification failed."
        : "Validation workspace volume cleanup failed.",
    );
  }
}

async function cleanupExactValidationEngineResources(input: {
  readonly cleanupToken: string;
  readonly containerNames: readonly string[];
  readonly limits: TerraformValidationLimitsV1;
  readonly runProcess: TerraformValidationHostProcessRunner;
  readonly runtime: string;
  readonly volumeName: string;
}): Promise<void> {
  const cleanupLimits = {
    ...input.limits,
    wallTimeMilliseconds: 10_000,
  };
  let cleanupFailed = !/^[a-f0-9-]{36}$/u.test(input.cleanupToken);
  for (const containerName of input.containerNames) {
    if (!/^cloudmarkup-[a-z0-9_.-]+$/u.test(containerName)) {
      cleanupFailed = true;
      continue;
    }
    try {
      await removeExactContainer({
        cleanupToken: input.cleanupToken,
        containerName,
        limits: cleanupLimits,
        runProcess: input.runProcess,
        runtime: input.runtime,
      });
    } catch {
      cleanupFailed = true;
    }
  }
  if (!/^cloudmarkup-[a-z0-9_.-]+$/u.test(input.volumeName)) {
    cleanupFailed = true;
  } else {
    try {
      await removeExactVolume({
        cleanupToken: input.cleanupToken,
        limits: cleanupLimits,
        runProcess: input.runProcess,
        runtime: input.runtime,
        volumeName: input.volumeName,
      });
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) {
    throw new TypeError("Validation workspace engine cleanup failed.");
  }
}

async function cleanupFailedValidationOpen(
  input: {
    readonly cleanupToken: string;
    readonly limits: TerraformValidationLimitsV1;
    readonly root: string;
    readonly runtime: string;
    readonly volumeCleanupRequired: boolean;
    readonly volumeName: string;
  },
  seam: {
    readonly removeDirectory: TerraformValidationDirectoryRemover;
    readonly runProcess: TerraformValidationHostProcessRunner;
  },
): Promise<void> {
  const expectedPrefix = resolve(tmpdir(), "cloudmarkup-terraform-validation-");
  if (!input.root.startsWith(expectedPrefix)) {
    throw new TypeError(
      "Refusing to remove an unexpected validation workspace.",
    );
  }
  if (input.volumeCleanupRequired) {
    await cleanupExactValidationEngineResources({
      cleanupToken: input.cleanupToken,
      containerNames: [input.volumeName + "-stage"],
      limits: input.limits,
      runProcess: seam.runProcess,
      runtime: input.runtime,
      volumeName: input.volumeName,
    });
  }
  await seam.removeDirectory(input.root);
}

class LocalContainerSession implements ValidationWorkspaceSession {
  readonly #cleanupToken: string;
  readonly #config: LocalPinnedContainerExecutorConfig;
  readonly #limits: TerraformValidationLimitsV1;
  readonly #volumeName: string;
  readonly #containerName: string;
  #disposed = false;

  public constructor(
    config: LocalPinnedContainerExecutorConfig,
    cleanupToken: string,
    volumeName: string,
    limits: TerraformValidationLimitsV1,
  ) {
    this.#config = config;
    this.#cleanupToken = cleanupToken;
    this.#volumeName = volumeName;
    this.#limits = limits;
    this.#containerName = volumeName.replace(
      "cloudmarkup-terraform-validation-",
      "cloudmarkup-validation-",
    );
  }

  public async execute(
    invocation: ValidationCommandInvocation,
    signal?: AbortSignal,
  ): Promise<ValidationCommandResult> {
    if (this.#disposed)
      throw new TypeError("Validation workspace is disposed.");
    if (!isApprovedInvocation(invocation)) {
      throw new TypeError(
        "Validation command binary or arguments are not approved.",
      );
    }
    const policy = this.#config.policy;
    const common = validationContainerArgs({
      cleanupToken: this.#cleanupToken,
      containerName: this.#containerName,
      limits: this.#limits,
      policy,
      volumeName: this.#volumeName,
    });
    const result = await runHostProcess(
      this.#config.containerRuntimeExecutable,
      [
        ...common,
        imageReference(policy),
        invocation.executable,
        ...invocation.args,
      ],
      this.#limits,
      signal,
    );
    if (result.termination === "completed") {
      const inspection = await runHostProcess(
        this.#config.containerRuntimeExecutable,
        [
          ...validationContainerArgs({
            cleanupToken: this.#cleanupToken,
            containerName: `${this.#containerName}-inspect`,
            limits: this.#limits,
            policy,
            volumeName: this.#volumeName,
          }),
          "--entrypoint",
          "/opt/cloudmarkup/bin/terraform-validation-stage",
          imageReference(policy),
          "inspect",
        ],
        this.#limits,
        signal,
      );
      if (!commandSucceeded(inspection)) {
        throw new TypeError(
          "Validation workspace failed its bounded output inspection.",
        );
      }
    }
    return result;
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) return;
    const runtime = this.#config.containerRuntimeExecutable;
    await cleanupExactValidationEngineResources({
      cleanupToken: this.#cleanupToken,
      containerNames: [
        this.#containerName,
        this.#containerName + "-inspect",
        this.#volumeName + "-stage",
      ],
      limits: this.#limits,
      runProcess: runHostProcess,
      runtime,
      volumeName: this.#volumeName,
    });
    this.#disposed = true;
  }
}

export function createLocalPinnedContainerExecutor(
  input: LocalPinnedContainerExecutorConfig,
): ValidationWorkspaceExecutor {
  if (!isAbsolute(input.containerRuntimeExecutable)) {
    throw new TypeError(
      "Container runtime executable must be an absolute trusted path.",
    );
  }
  const runtimeName = basename(input.containerRuntimeExecutable).toLowerCase();
  if (
    !new Set(["docker", "docker.exe", "podman", "podman.exe"]).has(runtimeName)
  ) {
    throw new TypeError(
      "Container runtime executable must be an allow-listed Docker or Podman binary.",
    );
  }
  if (/[,\r\n]/u.test(tmpdir())) {
    throw new TypeError(
      "Temporary root cannot be represented as an exact container mount.",
    );
  }
  const policy = terraformValidationPolicyV1Schema.parse(input.policy);
  const config = { ...input, policy };
  return {
    async open({ files, limits, providerLock }) {
      const root = await mkdtemp(
        join(tmpdir(), "cloudmarkup-terraform-validation-"),
      );
      const volumeName = validationVolumeName(root);
      const cleanupToken = randomUUID();
      const runtime = config.containerRuntimeExecutable;
      let volumeCleanupRequired = false;
      try {
        for (const file of files) {
          const path = resolve(root, file.path);
          const local = path.slice(root.length + 1);
          if (
            local.length === 0 ||
            local.startsWith("..") ||
            resolve(root, local) !== path
          ) {
            throw new TypeError(
              "Validation workspace path escapes its exact root.",
            );
          }
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, file.content, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
        }
        const lockPath = resolve(root, "infrastructure/.terraform.lock.hcl");
        await writeFile(lockPath, providerLock.content, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await inspectValidationInputWorkspace(root, limits);

        await assertExactVolumeAbsent({
          limits,
          runProcess: runHostProcess,
          runtime,
          volumeName,
        });
        const created = await runHostProcess(
          runtime,
          [
            "volume",
            "create",
            "--label",
            "cloudmarkup.owner=terraform-validation",
            "--label",
            "cloudmarkup.cleanup-token=" + cleanupToken,
            "--name",
            volumeName,
          ],
          limits,
        );
        if (!commandSucceeded(created)) {
          volumeCleanupRequired = created.termination !== "completed";
          throw new TypeError("Validation workspace volume creation failed.");
        }
        volumeCleanupRequired = true;
        const staged = await runHostProcess(
          runtime,
          [
            "run",
            "--rm",
            "--name",
            volumeName + "-stage",
            "--label",
            "cloudmarkup.cleanup-token=" + cleanupToken,
            "--pull",
            "never",
            "--platform",
            policy.container.platform,
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--cap-add",
            "CHOWN",
            "--cap-add",
            "DAC_OVERRIDE",
            "--security-opt",
            "no-new-privileges:true",
            "--pids-limit",
            String(Math.min(limits.maxProcesses, 16)),
            "--memory",
            `${String(Math.min(limits.memoryMiB, 512))}m`,
            "--cpus",
            "1.0",
            "--tmpfs",
            boundedTmpfs(limits),
            "--user",
            "0:0",
            "--mount",
            `type=bind,source=${root},target=/input,readonly`,
            "--mount",
            `type=volume,source=${volumeName},target=/workspace,volume-nocopy`,
            "--entrypoint",
            "/opt/cloudmarkup/bin/terraform-validation-stage",
            imageReference(policy),
            "prepare",
          ],
          limits,
        );
        if (!commandSucceeded(staged)) {
          throw new TypeError("Validation workspace staging failed safely.");
        }
        await rm(root, { force: true, recursive: true });
        return new LocalContainerSession(
          config,
          cleanupToken,
          volumeName,
          limits,
        );
      } catch (error) {
        try {
          await cleanupFailedValidationOpen(
            {
              cleanupToken,
              limits,
              root,
              runtime,
              volumeCleanupRequired,
              volumeName,
            },
            {
              removeDirectory: (path) =>
                rm(path, { force: true, recursive: true }),
              runProcess: runHostProcess,
            },
          );
        } catch {
          throw new TypeError("Validation workspace cleanup failed.");
        }
        throw error;
      }
    },
  };
}

/** @internal Cleanup regression seam; not exported from the package root. */
export function cleanupFailedValidationOpenForTesting(
  input: {
    readonly cleanupToken: string;
    readonly limits: TerraformValidationLimitsV1;
    readonly root: string;
    readonly runtime: string;
    readonly volumeCleanupRequired: boolean;
    readonly volumeName: string;
  },
  seam: {
    readonly removeDirectory: TerraformValidationDirectoryRemover;
    readonly runProcess: TerraformValidationHostProcessRunner;
  },
): Promise<void> {
  return cleanupFailedValidationOpen(input, seam);
}

/** @internal Collision-probe regression seam; not exported from the package root. */
export function assertExactVolumeAbsentForTesting(
  input: {
    readonly limits: TerraformValidationLimitsV1;
    readonly runtime: string;
    readonly volumeName: string;
  },
  runProcess: TerraformValidationHostProcessRunner,
): Promise<void> {
  return assertExactVolumeAbsent({ ...input, runProcess });
}
