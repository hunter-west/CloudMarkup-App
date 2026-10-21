import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { z } from "zod";
import {
  assertMemoryApplicationBuildHost,
  canonicalJson,
} from "@cloudmarkup/application-build-runner";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { goCompilationResultV1Schema } from "@cloudmarkup/solution-export-workflow/contracts";
import { createProductionRepairSeedSourceV1 } from "./production-model-live-repair-seed-source.js";

const SHA = z.string().regex(/^[a-f0-9]{64}$/u);
const BOOT = z.uuid();
export const PARENT_KIND = "cloudmarkup.anonymous-normalization-parent.v1";
export const WIRE_KIND = "cloudmarkup.anonymous-normalization.v1";
export const admissionSchema = z
  .object({
    kind: z.literal("cloudmarkup.anonymous-normalization-parent-admission.v1"),
    runId: BOOT,
    containerId: SHA,
    imageDigest: z.string().regex(/^node@sha256:[a-f0-9]{64}$/u),
    imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    daemonIdSha256: SHA,
    bootId: BOOT,
    kernelSha256: SHA,
    closureSha256: SHA,
    parentSha256: SHA,
    launcherSha256: SHA,
    compilerSha256: SHA,
  })
  .strict();
export type Admission = z.infer<typeof admissionSchema>;
export type FailurePhase =
  | "parent-admission"
  | "launcher"
  | "normalization"
  | "normalization-execution"
  | "normalization-result"
  | "normalization-model"
  | "parent-cleanup";
export class ClosedProofFailure extends Error {
  readonly phase: FailurePhase;
  constructor(phase: FailurePhase) {
    super("Native normalization proof failed.");
    this.phase = phase;
  }
}
// Private deterministic clock seam; never supplied by the proof input. The
// same 32-second window covers launcher spawn through the final success check.
export function createParentDeadline(
  now: () => number = () => performance.now(),
) {
  const started = now();
  check(Number.isFinite(started), "launcher");
  const expires = started + 32000;
  function current(phase: FailurePhase): number {
    const observed = now();
    check(
      Number.isFinite(observed) && observed >= started && observed < expires,
      phase,
    );
    return observed;
  }
  return {
    assertCurrent(phase: FailurePhase): void {
      current(phase);
    },
    remainingMilliseconds(): number {
      const observed = now();
      return Number.isFinite(observed) && observed >= started
        ? Math.max(0, expires - observed)
        : 0;
    },
  };
}

export function sha(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function check(value: boolean, phase: FailurePhase): asserts value {
  if (!value) throw new ClosedProofFailure(phase);
}
function json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new ClosedProofFailure("normalization");
  }
}
const inputIdentity = z
  .object({
    kind: z.enum(["architecture", "workload", "solution-revision"]),
    byteLength: z.number().int().min(1).max(1048576),
    sha256: SHA,
  })
  .strict();
const resultSchema = z
  .object({
    kind: z.literal(WIRE_KIND),
    phase: z.literal("result"),
    compilerSha256: SHA,
    inputs: z.array(inputIdentity).length(3),
    stdoutBytes: z.number().int().min(1).max(2097152),
    stdoutSha256: SHA,
    stderrBytes: z.literal(0),
  })
  .strict();
const readySchema = z
  .object({
    kind: z.literal(WIRE_KIND),
    phase: z.literal("ready"),
    compilerSha256: SHA,
    kernelBootId: BOOT,
  })
  .strict();

export function acceptReady(bytes: Buffer, admission: Admission): void {
  check(bytes.byteLength <= 1024, "launcher");
  const parsed = readySchema.safeParse(json(bytes));
  check(
    parsed.success &&
      parsed.data.compilerSha256 === admission.compilerSha256 &&
      parsed.data.kernelBootId === admission.bootId,
    "launcher",
  );
}
export function encodeFrames(values: readonly unknown[]) {
  check(values.length === 3, "normalization");
  const names = ["architecture", "workload", "solution-revision"] as const;
  const chunks = [Buffer.from("CMNORM1\n", "ascii")];
  const identities = values.map((value, index) => {
    const bytes = Buffer.from(canonicalJson(value), "utf8");
    check(bytes.length > 0 && bytes.length <= 1048576, "normalization");
    const hash = sha(bytes),
      length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    chunks.push(length, Buffer.from(hash, "hex"), bytes);
    return { kind: names[index], byteLength: bytes.length, sha256: hash };
  });
  const wire = Buffer.concat(chunks);
  for (const chunk of chunks) chunk.fill(0);
  return { wire, identities };
}
export function verifyNormalizedOutput(
  wire: Buffer,
  admission: Admission,
  submitted: ReturnType<typeof encodeFrames>["identities"],
  expectedModel: unknown,
) {
  const newline = wire.indexOf(10);
  check(newline > 0 && newline <= 2048, "normalization-result");
  const parsedMetadata = resultSchema.safeParse(
    json(wire.subarray(0, newline)),
  );
  check(parsedMetadata.success, "normalization-result");
  const metadata = parsedMetadata.data,
    output = wire.subarray(newline + 1);
  check(
    metadata.compilerSha256 === admission.compilerSha256 &&
      canonicalJson(metadata.inputs) === canonicalJson(submitted) &&
      metadata.stdoutBytes === output.length &&
      metadata.stdoutSha256 === sha(output),
    "normalization-result",
  );
  const parsed = goCompilationResultV1Schema.safeParse(json(output));
  check(parsed.success, "normalization-result");
  const observed = parsed.data;
  check(
    observed.compiler.id === "cloudmarkup.iac-compiler" &&
      observed.compiler.version === "1.2.1" &&
      observed.compiler.digest ===
        "sha256:2c25a5610c825d171a167a38201c3090aa2278071ddd648bb957e67b7b98f203" &&
      observed.artifact === undefined &&
      observed.model !== undefined &&
      (observed.diagnostics ?? []).every((item) => item.severity !== "error"),
    "normalization-result",
  );
  const expectedModelDigest = digestCanonicalValue(expectedModel);
  const observedModelDigest = digestCanonicalValue(observed.model);
  check(expectedModelDigest === observedModelDigest, "normalization-model");
  return {
    inputs: metadata.inputs,
    stdoutBytes: output.length,
    stdoutSha256: metadata.stdoutSha256,
    expectedModelDigest,
    observedModelDigest,
    equal: true as const,
  };
}

// The supervisor inspects the actual Docker mounts and image identity first.
// This second check requires actual read-only filesystem mounts, not chmod.
export function checkReadonlyMounts(mountinfo: string): void {
  const mounts = mountinfo
    .trim()
    .split("\n")
    .map((line) => {
      const fields = line.split(" ");
      return { path: fields[4], flags: fields[5]?.split(",") ?? [] };
    });
  for (const path of [
    "/",
    "/proof/parent.mjs",
    "/proof/launcher",
    "/proof/compiler",
    "/proof/admission.json",
  ]) {
    const matching = mounts.filter((mount) => mount.path === path);
    check(
      matching.length === 1 && matching[0]?.flags.includes("ro") === true,
      "parent-admission",
    );
  }
}
async function verifyPublicFile(path: string, digest: string, maximum: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    check(
      info.isFile() && info.size > 0 && info.size <= maximum,
      "parent-admission",
    );
    const bytes = await file.readFile();
    check(sha(bytes) === digest, "parent-admission");
    return file;
  } catch {
    await file.close();
    throw new ClosedProofFailure("parent-admission");
  }
}
async function admitParent() {
  check(
    process.platform === "linux" && process.arch === "x64",
    "parent-admission",
  );
  check(
    Object.keys(process.env).sort().join(",") === "GOTRACEBACK,HOME,PATH" &&
      process.env["GOTRACEBACK"] === "none" &&
      process.env["HOME"] === "/nonexistent" &&
      process.env["PATH"] === "/usr/local/bin:/usr/bin:/bin" &&
      process.execArgv.length === 0,
    "parent-admission",
  );
  await assertMemoryApplicationBuildHost();
  checkReadonlyMounts(await readFile("/proc/self/mountinfo", "utf8"));
  const bytes = await readFile("/proof/admission.json");
  check(bytes.length <= 16384, "parent-admission");
  const parsed = admissionSchema.safeParse(json(bytes));
  check(parsed.success, "parent-admission");
  const admission = parsed.data;
  check(
    (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim() ===
      admission.bootId &&
      sha((await readFile("/proc/sys/kernel/osrelease", "utf8")).trim()) ===
        admission.kernelSha256,
    "parent-admission",
  );
  const parent = await verifyPublicFile(
    "/proof/parent.mjs",
    admission.parentSha256,
    33554432,
  );
  await parent.close();
  const compiler = await verifyPublicFile(
    "/proof/compiler",
    admission.compilerSha256,
    134217728,
  );
  await compiler.close(); // Launcher independently opens, hashes and holds compiler through exec.
  return { admission, admissionSha256: sha(bytes) };
}

export async function runNativeNormalizationParent() {
  let phase: FailurePhase = "parent-admission";
  try {
    const { admission, admissionSha256 } = await admitParent();
    const executable = await verifyPublicFile(
      "/proof/launcher",
      admission.launcherSha256,
      134217728,
    );
    const deadline = createParentDeadline();
    try {
      phase = "launcher";
      deadline.assertCurrent(phase);
      const child = spawn(
        "/proc/self/fd/3",
        [
          "--compiler",
          "/proof/compiler",
          "--compiler-sha256",
          admission.compilerSha256,
        ],
        {
          shell: false,
          stdio: ["pipe", "pipe", "pipe", executable.fd],
          env: { GOTRACEBACK: "none" },
          cwd: "/",
        },
      );
      check(
        child.stdin !== null && child.stdout !== null && child.stderr !== null,
        "launcher",
      );
      const input = child.stdin,
        output = child.stdout,
        diagnostic = child.stderr;
      let submitted: ReturnType<typeof encodeFrames> | undefined;
      let expectedModel: unknown;
      let wire: Buffer = Buffer.alloc(0),
        outputBytes = 0,
        diagnosticBytes = 0;
      const state = { ready: false, failed: false };
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        state.failed = true;
        input.destroy();
        child.kill("SIGTERM");
        killTimer ??= setTimeout(() => {
          child.kill("SIGKILL");
        }, 1000);
      };
      const timer = setTimeout(stop, deadline.remainingMilliseconds());
      const finished = new Promise<{
        code: number | null;
        signal: string | null;
      }>((resolve) => {
        child.once("error", stop);
        child.once("close", (code, signal) => {
          resolve({ code, signal });
        });
      });
      input.on("error", stop);
      output.on("error", stop);
      diagnostic.on("error", stop);
      diagnostic.on("data", (chunk: Buffer) => {
        diagnosticBytes += chunk.length;
        if (diagnosticBytes > 65536) stop(); // Never retain content.
      });
      output.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > 2097152 + 4096) {
          stop();
          return;
        }
        wire = Buffer.concat([wire, chunk]);
        if (state.ready || state.failed) return;
        const newline = wire.indexOf(10);
        if (newline < 0) {
          if (wire.length > 1024) stop();
          return;
        }
        try {
          check(wire.length === newline + 1, "launcher");
          acceptReady(wire.subarray(0, newline), admission);
          wire.fill(0);
          wire = Buffer.alloc(0);
          state.ready = true;
          phase = "normalization";
          // This is the only factory call. Actual launcher admission/probe precedes it.
          deadline.assertCurrent(phase);
          const source = createProductionRepairSeedSourceV1();
          deadline.assertCurrent(phase);
          expectedModel = source.generationRequest.normalizedSolution;
          submitted = encodeFrames([
            source.generationRequest.architectureDocument,
            source.generationRequest.workloadBehavior,
            source.generationRequest.solutionRevision,
          ]);
          deadline.assertCurrent(phase);
          phase = "normalization-execution";
          input.end(submitted.wire, () => {
            submitted?.wire.fill(0);
          });
        } catch {
          stop();
        }
      });
      try {
        const outcome = await finished;
        deadline.assertCurrent(phase);
        check(
          !state.failed &&
            state.ready &&
            submitted !== undefined &&
            outcome.code === 0 &&
            outcome.signal === null &&
            diagnosticBytes === 0,
          phase,
        );
        phase = "normalization-result";
        const result = verifyNormalizedOutput(
          wire,
          admission,
          submitted.identities,
          expectedModel,
        );
        deadline.assertCurrent(phase);
        phase = "parent-cleanup";
        await assertMemoryApplicationBuildHost();
        checkReadonlyMounts(await readFile("/proc/self/mountinfo", "utf8"));
        check(
          (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim() ===
            admission.bootId,
          "parent-cleanup",
        );
        const passed = {
          kind: PARENT_KIND,
          status: "passed" as const,
          admissionSha256,
          runId: admission.runId,
          containerId: admission.containerId,
          closureSha256: admission.closureSha256,
          launcherSha256: admission.launcherSha256,
          compilerSha256: admission.compilerSha256,
          ...result,
          stderrBytes: 0 as const,
          exitCode: 0 as const,
        };
        // Timers can run during post-check awaits or be delayed by synchronous
        // validation; elapsed monotonic time is the final success authority.
        check(!state.failed, phase);
        deadline.assertCurrent(phase);
        return passed;
      } finally {
        clearTimeout(timer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        submitted?.wire.fill(0);
        wire.fill(0);
        input.destroy();
        output.destroy();
        diagnostic.destroy();
      }
    } finally {
      await executable.close();
      deadline.assertCurrent("parent-cleanup");
    }
  } catch (error) {
    throw new ClosedProofFailure(
      error instanceof ClosedProofFailure ? error.phase : phase,
    );
  }
}

export function closedFailure(error: unknown) {
  return {
    kind: PARENT_KIND,
    status: "failed" as const,
    phase:
      error instanceof ClosedProofFailure ? error.phase : "parent-admission",
  };
}
