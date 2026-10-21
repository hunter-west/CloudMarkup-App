import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { runMemoryContainerProcess } from "./memory-container-process.js";
import type { ApplicationBuildLimitsV1 } from "./contracts.js";

const limits: ApplicationBuildLimitsV1 = {
  cpuSeconds: 1,
  maxArtifactBytes: 1024,
  maxFileBytes: 1024,
  maxFiles: 8,
  maxOutputBytes: 1024,
  maxProcesses: 8,
  maxTotalFileBytes: 4096,
  memoryMiB: 128,
  wallTimeMilliseconds: 1000,
};

class Child extends EventEmitter {
  readonly chunks: Buffer[] = [];
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new Writable({
    highWaterMark: 1,
    write: (chunk: Buffer, _encoding, done) => {
      this.chunks.push(Buffer.from(chunk));
      setImmediate(done);
    },
  });
  readonly kill = vi.fn(() => {
    this.emit("close", null);
    return true;
  });
}

describe("bounded memory-only process transport", () => {
  it("streams candidate bytes through backpressured stdin and never args or environment", async () => {
    const child = new Child();
    spawnMock.mockReturnValueOnce(child);
    const input = Buffer.from("memory-only-candidate".repeat(10_000));
    const result = runMemoryContainerProcess({
      executable: "/usr/bin/docker",
      args: [
        "container",
        "start",
        "--attach",
        "--interactive",
        "owned-control-id",
      ],
      limits,
      stdin: input,
    });
    await new Promise<void>((done) => {
      child.stdin.once("finish", done);
    });
    child.emit("close", 0);
    expect((await result).termination).toBe("completed");
    expect(Buffer.concat(child.chunks)).toEqual(input);
    expect(child.chunks.every((chunk) => chunk.byteLength <= 64 * 1024)).toBe(
      true,
    );
    const invocation = spawnMock.mock.calls.at(-1) as [
      string,
      string[],
      { env: Record<string, string>; shell: boolean; stdio: string[] },
    ];
    expect(JSON.stringify(invocation)).not.toContain("memory-only-candidate");
    expect(invocation[2].shell).toBe(false);
    expect(invocation[2].stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(
      Object.keys(invocation[2].env).every((key) =>
        ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR"].includes(key),
      ),
    ).toBe(true);
  });
  it("decodes UTF-8 only after bounded chunks are assembled", async () => {
    const child = new Child();
    spawnMock.mockReturnValueOnce(child);
    const promise = runMemoryContainerProcess({
      executable: "/usr/bin/docker",
      args: ["version"],
      limits,
    });
    const bytes = Buffer.from("A\u{1f680}B");
    child.stdout.write(bytes.subarray(0, 3));
    child.stdout.write(bytes.subarray(3));
    child.emit("close", 0);
    expect((await promise).stdout).toBe("A\u{1f680}B");
  });
  it("kills on combined stdout/stderr overflow without retaining the overflowing chunk", async () => {
    const child = new Child();
    spawnMock.mockReturnValueOnce(child);
    const promise = runMemoryContainerProcess({
      executable: "/usr/bin/docker",
      args: ["version"],
      limits,
      maxOutputBytes: 4,
    });
    child.stdout.write(Buffer.from("123"));
    child.stderr.write(Buffer.from("45"));
    const result = await promise;
    expect(result.termination).toBe("output-limit");
    expect(result.outputBytes).toBe(5);
    expect(result.stdout).toBe("123");
    expect(result.stderr).toBe("");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("cancels before writing stdin and reports actual cancellation", async () => {
    const child = new Child();
    spawnMock.mockReturnValueOnce(child);
    const controller = new AbortController();
    controller.abort();
    const result = await runMemoryContainerProcess({
      executable: "/usr/bin/docker",
      args: ["version"],
      limits,
      stdin: Buffer.from("never-written"),
      signal: controller.signal,
    });
    expect(result.termination).toBe("cancelled");
    expect(child.chunks).toEqual([]);
  });
  it("reports timeout rather than successful process exit", async () => {
    vi.useFakeTimers();
    try {
      const child = new Child();
      spawnMock.mockReturnValueOnce(child);
      const promise = runMemoryContainerProcess({
        executable: "/usr/bin/docker",
        args: ["version"],
        limits,
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect((await promise).termination).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });
  it("reports a broken input pipe as unavailable without exposing input", async () => {
    const child = new Child();
    spawnMock.mockReturnValueOnce(child);
    const promise = runMemoryContainerProcess({
      executable: "/usr/bin/docker",
      args: ["version"],
      limits,
      stdin: Buffer.from("unretained-candidate"),
    });
    child.stdin.emit("error", new Error("synthetic closed pipe"));
    const result = await promise;
    expect(result.termination).toBe("unavailable");
    expect(result.stderr).not.toContain("unretained-candidate");
  });
});
