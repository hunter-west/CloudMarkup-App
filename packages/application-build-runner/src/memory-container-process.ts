import { spawn } from "node:child_process";

import type {
  ApplicationBuildCommandResult,
  ApplicationBuildLimitsV1,
} from "./contracts.js";
import { MEMORY_PROTOCOL_MAX_BYTES } from "./memory-workspace-protocol.js";

export interface MemoryContainerProcessInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly limits: ApplicationBuildLimitsV1;
  readonly stdin?: Uint8Array;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}
export type MemoryContainerProcessRunner = (
  input: MemoryContainerProcessInput,
) => Promise<ApplicationBuildCommandResult>;

export const runMemoryContainerProcess: MemoryContainerProcessRunner = (
  input,
) => {
  if ((input.stdin?.byteLength ?? 0) > MEMORY_PROTOCOL_MAX_BYTES)
    return Promise.reject(
      new RangeError("Memory process input exceeds its bound."),
    );
  const maximum = input.maxOutputBytes ?? input.limits.maxOutputBytes;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum <= 0 ||
    maximum > MEMORY_PROTOCOL_MAX_BYTES
  )
    return Promise.reject(
      new RangeError("Memory process output limit is invalid."),
    );
  return new Promise((resolveResult) => {
    const environment: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR"]) {
      const value = process.env[name];
      if (value !== undefined) environment[name] = value;
    }
    const child = spawn(input.executable, [...input.args], {
      env: environment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let termination: ApplicationBuildCommandResult["termination"] = "completed";
    const isRunning = () => !settled && termination === "completed";
    const stop = (reason: ApplicationBuildCommandResult["termination"]) => {
      if (!isRunning()) return;
      termination = reason;
      child.stdin.destroy();
      child.kill("SIGKILL");
    };
    const abort = () => {
      stop("cancelled");
    };
    const timer = setTimeout(() => {
      stop("timeout");
    }, input.limits.wallTimeMilliseconds);
    timer.unref();
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      resolveResult({
        exitCode,
        termination,
        outputBytes,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    };
    const append = (chunks: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maximum) {
        stop("output-limit");
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      append(stderr, chunk);
    });
    child.stdin.on("error", () => {
      stop("unavailable");
    });
    child.once("error", () => {
      termination = "unavailable";
      finish(null);
    });
    child.once("close", (code) => {
      finish(code);
    });
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted === true) abort();
    void (async () => {
      const bytes = input.stdin ?? new Uint8Array();
      for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
        if (!isRunning()) return;
        await new Promise<void>((done, reject) => {
          child.stdin.write(
            bytes.subarray(offset, offset + 64 * 1024),
            (error) => {
              if (error) reject(error);
              else done();
            },
          );
        });
      }
      if (isRunning()) child.stdin.end();
    })().catch(() => {
      stop("unavailable");
    });
  });
};
