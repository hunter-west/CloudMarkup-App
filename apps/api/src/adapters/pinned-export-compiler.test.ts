import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  solutionExportCompilerArgs,
  type SolutionExportCompilerCommandExecutor,
} from "@cloudmarkup/solution-export-workflow";
import { createPinnedSolutionExportCompilerExecutor } from "./pinned-export-compiler.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const executableBytes = Buffer.from(
  "Synthetic pinned compiler bytes; spawn is mocked.",
);
const digest = createHash("sha256").update(executableBytes).digest("hex");
type Command = Parameters<SolutionExportCompilerCommandExecutor["execute"]>[0];
function command(): Command {
  return {
    executable: "cloudmarkup-iac",
    args: solutionExportCompilerArgs("terraform"),
    files: {
      "architecture.json": "{}",
      "solution-revision.json": "{}",
      "workload.json": "{}",
    },
    limits: { maxOutputBytes: 1024, timeoutMilliseconds: 100 },
    signal: new AbortController().signal,
  };
}
function processFixture() {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => process.emit("close", null));
      return true;
    }),
  });
  vi.mocked(spawn).mockReturnValue(process as never);
  return process;
}
describe("pinned export compiler process boundary", () => {
  let root: string;
  let executablePath: string;
  beforeEach(async () => {
    vi.resetAllMocks();
    root = await mkdtemp(join(tmpdir(), "cloudmarkup-compiler-test-"));
    executablePath = join(root, "released-compiler");
    await writeFile(executablePath, executableBytes);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  function executor(pin = digest) {
    return createPinnedSolutionExportCompilerExecutor({
      executablePath,
      executableSha256: pin,
      temporaryRoot: root,
    });
  }
  it("runs only copied pinned bytes and fixed arguments with no environment, then removes inputs", async () => {
    const child = processFixture();
    vi.mocked(spawn).mockImplementation((...args: Parameters<typeof spawn>) => {
      expect(args[0]).not.toBe(executablePath);
      expect(args[1]).toEqual(solutionExportCompilerArgs("terraform"));
      expect(args[2]).toMatchObject({
        env: {},
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      queueMicrotask(() => {
        child.stdout.write("verified result");
        child.stderr.write("bounded diagnostic");
        child.emit("close", 0);
      });
      return child as never;
    });
    expect(await executor().execute(command())).toMatchObject({
      termination: "completed",
      exitCode: 0,
      stdout: "verified result",
      stderr: "bounded diagnostic",
    });
    expect(await readdir(root)).toEqual(["released-compiler"]);
    expect(await readFile(executablePath)).toEqual(executableBytes);
  });
  it.each(["wrong-digest", "changed-binary"])(
    "rejects %s before launching or publishing temporary inputs",
    async (kind) => {
      if (kind === "changed-binary")
        await writeFile(executablePath, "substituted compiler");
      await expect(
        executor(kind === "wrong-digest" ? "f".repeat(64) : digest).execute(
          command(),
        ),
      ).rejects.toThrow();
      expect(spawn).not.toHaveBeenCalled();
      expect(await readdir(root)).toEqual(["released-compiler"]);
    },
  );
  it.each([
    { executable: "shell" },
    { args: ["compile", "--output", "../foreign"] },
    { files: { "../foreign": "{}" } },
    { limits: { maxOutputBytes: 1024, timeoutMilliseconds: 30001 } },
    { limits: { maxOutputBytes: 0, timeoutMilliseconds: 100 } },
  ])(
    "rejects command or limit substitution before launch: %j",
    async (changes) => {
      await expect(
        executor().execute({ ...command(), ...changes } as Command),
      ).rejects.toThrow();
      expect(spawn).not.toHaveBeenCalled();
      expect(await readdir(root)).toEqual(["released-compiler"]);
    },
  );
  it("bounds combined output, kills the process and cleans its directory", async () => {
    const child = processFixture();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.write("a".repeat(800));
        child.stderr.write("b".repeat(800));
      });
      return child as never;
    });
    expect(await executor().execute(command())).toMatchObject({
      termination: "output-limit",
      stdout: "",
      stderr: "",
    });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(await readdir(root)).toEqual(["released-compiler"]);
  });
  it("cancels before dispatch without creating a directory", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await executor().execute({ ...command(), signal: controller.signal }),
    ).toMatchObject({ termination: "cancelled" });
    expect(spawn).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual(["released-compiler"]);
  });
  it("terminates a running process at its deadline and cleans inputs", async () => {
    const child = processFixture();
    expect(
      await executor().execute({
        ...command(),
        limits: { maxOutputBytes: 1024, timeoutMilliseconds: 10 },
      }),
    ).toMatchObject({ termination: "timeout" });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(await readdir(root)).toEqual(["released-compiler"]);
  });
  it("terminates on cancellation and removes its listener after close", async () => {
    const controller = new AbortController(),
      child = processFixture();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => {
        controller.abort();
      });
      return child as never;
    });
    expect(
      await executor().execute({ ...command(), signal: controller.signal }),
    ).toMatchObject({ termination: "cancelled" });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(await readdir(root)).toEqual(["released-compiler"]);
  });
  it("cleans a failed process start without exposing its internal error", async () => {
    const child = processFixture();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() =>
        child.emit("error", new Error("Synthetic internal path")),
      );
      return child as never;
    });
    expect(await executor().execute(command())).toMatchObject({
      termination: "unavailable",
      stdout: "",
      stderr: "",
    });
    expect(await readdir(root)).toEqual(["released-compiler"]);
  });
});
