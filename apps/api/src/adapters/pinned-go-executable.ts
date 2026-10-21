import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SolutionExportCompilerCommandExecutor } from "@cloudmarkup/solution-export-workflow/contracts";

type Command = Parameters<SolutionExportCompilerCommandExecutor["execute"]>[0];
type Result = Awaited<
  ReturnType<SolutionExportCompilerCommandExecutor["execute"]>
>;
const prefix = "cloudmarkup-export-compile-";

function unavailable(): never {
  throw new Error("The pinned export compiler is unavailable.");
}

export function executeProcess(
  executable: string,
  directory: string,
  input: Pick<Command, "args" | "limits" | "signal"> & {
    readonly stdin?: Uint8Array;
  },
): Promise<Result> {
  if (input.signal.aborted)
    return Promise.resolve({
      exitCode: null,
      stdout: "",
      stderr: "",
      termination: "cancelled",
    });
  return new Promise((done) => {
    // No inherited credentials, proxy settings, PATH, shell or customer-selected command.
    const child = spawn(executable, [...input.args], {
      cwd: directory,
      env: {},
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let termination: Result["termination"] = "completed";
    let total = 0;
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    const stop = (reason: Result["termination"]) => {
      if (termination !== "completed") return;
      termination = reason;
      child.kill("SIGKILL");
    };
    const capture = (destination: Buffer[]) => (bytes: Buffer) => {
      if (termination !== "completed") return;
      total += bytes.byteLength;
      if (total > input.limits.maxOutputBytes) stop("output-limit");
      else destination.push(Buffer.from(bytes));
    };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    const abort = () => {
      stop("cancelled");
    };
    const timer = setTimeout(() => {
      stop("timeout");
    }, input.limits.timeoutMilliseconds);
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();
    child.once("error", () => {
      stop("unavailable");
    });
    child.stdin.on("error", () => {
      stop("unavailable");
    });
    child.stdin.end(input.stdin);
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", abort);
      done({
        exitCode,
        termination,
        stdout:
          termination === "completed"
            ? Buffer.concat(stdout).toString("utf8")
            : "",
        stderr:
          termination === "completed"
            ? Buffer.concat(stderr).toString("utf8")
            : "",
      });
    });
  });
}

/** Host-owned release path + independently pinned digest. Verified bytes are
 * copied into a private invocation directory, preventing a later source-path
 * replacement from selecting another program. This adapter only runs the pure
 * Go compiler; isolated Terraform/application execution belongs to other ports. */
export interface PinnedCompilerConfiguration {
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly temporaryRoot?: string;
}

async function pinnedExecutableBytes(
  executablePath: string,
  expectedDigest: string,
): Promise<Buffer> {
  if (!isAbsolute(executablePath) || !/^[a-f0-9]{64}$/u.test(expectedDigest))
    unavailable();
  const stat = await lstat(executablePath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > 64 * 1024 * 1024
  )
    unavailable();
  const bytes = await readFile(executablePath);
  if (
    bytes.byteLength !== stat.size ||
    createHash("sha256").update(bytes).digest("hex") !== expectedDigest
  )
    unavailable();
  return bytes;
}

/** Readiness checks actual pinned bytes without executing or staging a program.
 * Execution still copies those same verified bytes into its private directory. */
export async function verifyPinnedGoExecutableBytes(
  configuration: PinnedCompilerConfiguration,
): Promise<void> {
  await pinnedExecutableBytes(
    configuration.executablePath,
    configuration.executableSha256,
  );
}

export function createPinnedGoInvocation(
  configuration: PinnedCompilerConfiguration,
) {
  if (
    !isAbsolute(configuration.executablePath) ||
    !/^[a-f0-9]{64}$/u.test(configuration.executableSha256) ||
    (configuration.temporaryRoot !== undefined &&
      !isAbsolute(configuration.temporaryRoot))
  )
    unavailable();
  // Capture trusted configuration once. Caller mutation cannot change a release pin.
  const executablePath = configuration.executablePath;
  const expectedDigest = configuration.executableSha256;
  const temporaryRoot = configuration.temporaryRoot ?? tmpdir();
  return async <T>(
    run: (executable: string, directory: string) => Promise<T>,
  ): Promise<T> => {
    const executableBytes = await pinnedExecutableBytes(
      executablePath,
      expectedDigest,
    );
    const base = await realpath(temporaryRoot);
    const directory = await mkdtemp(join(base, prefix));
    try {
      const executable = join(
        directory,
        process.platform === "win32"
          ? "cloudmarkup-iac.exe"
          : "cloudmarkup-iac",
      );
      await writeFile(executable, executableBytes, {
        flag: "wx",
        mode: process.platform === "win32" ? 0o600 : 0o500,
      });
      return await run(executable, directory);
    } finally {
      // Only the exact private directory created by this invocation is removed.
      const local = relative(base, resolve(directory));
      if (
        !basename(directory).startsWith(prefix) ||
        local === "" ||
        local.startsWith("..") ||
        isAbsolute(local) ||
        local.includes(sep) ||
        (await realpath(directory)) !== directory
      )
        unavailable();
      await rm(directory, { recursive: true, force: false, maxRetries: 3 });
    }
  };
}
