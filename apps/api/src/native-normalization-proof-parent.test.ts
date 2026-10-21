import { describe, expect, it } from "vitest";
import { goCompilationResultV1Schema } from "@cloudmarkup/solution-export-workflow/contracts";
import { createProductionRepairSeedSourceV1 } from "./production-model-live-repair-seed-source.js";
import {
  acceptReady,
  admissionSchema,
  checkReadonlyMounts,
  ClosedProofFailure,
  closedFailure,
  createParentDeadline,
  encodeFrames,
  sha,
  verifyNormalizedOutput,
  WIRE_KIND,
} from "./native-normalization-proof-parent.js";

const HASH = "a".repeat(64),
  BOOT = "705eac5c-384a-434f-b730-c7fa4f5c1fd5";
const admission = admissionSchema.parse({
  kind: "cloudmarkup.anonymous-normalization-parent-admission.v1",
  runId: BOOT,
  containerId: HASH,
  imageDigest: `node@sha256:${HASH}`,
  imageId: `sha256:${HASH}`,
  daemonIdSha256: HASH,
  bootId: BOOT,
  kernelSha256: HASH,
  closureSha256: HASH,
  parentSha256: HASH,
  launcherSha256: HASH,
  compilerSha256: HASH,
});
const ready = {
  kind: WIRE_KIND,
  phase: "ready",
  compilerSha256: HASH,
  kernelBootId: BOOT,
};
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("private native-normalization proof parent", () => {
  it("rejects unbound, extra or malformed READY before the caller can generate frames", () => {
    expect(() => {
      acceptReady(encoded(ready), admission);
    }).not.toThrow();
    for (const value of [
      { ...ready, compilerSha256: "b".repeat(64) },
      { ...ready, kernelBootId: "unknown" },
      { ...ready, arbitraryContent: "PRIVATE_TEST_MARKER" },
      { ...ready, phase: "result" },
    ])
      expect(() => {
        acceptReady(encoded(value), admission);
      }).toThrow();
    expect(() => {
      acceptReady(Buffer.alloc(1025), admission);
    }).toThrow();
    expect(() => {
      acceptReady(Buffer.from("PRIVATE_TEST_MARKER"), admission);
    }).toThrow();
  });
  it("encodes exactly three canonical bounded hash frames and rejects oversized documents", () => {
    const result = encodeFrames([{ b: 2, a: 1 }, {}, {}]);
    expect(result.wire.subarray(0, 8).toString()).toBe("CMNORM1\n");
    const expected = Buffer.from('{\n  "a": 1,\n  "b": 2\n}\n');
    expect(result.identities[0]?.sha256).toBe(sha(expected));
    expect(result.wire.readUInt32BE(8)).toBe(expected.length);
    expect(result.wire.subarray(44, 44 + expected.length)).toEqual(expected);
    expect(() => encodeFrames([{}, {}])).toThrow();
    expect(() => encodeFrames(["x".repeat(1048576), {}, {}])).toThrow();
  });
  it("requires actual read-only mounts for root and all four admitted public files", () => {
    const paths = [
      "/",
      "/proof/parent.mjs",
      "/proof/launcher",
      "/proof/compiler",
      "/proof/admission.json",
    ];
    const rows = paths.map(
      (path, i) =>
        `${String(i + 1)} 1 0:1 / ${path} ro,relatime - overlay overlay ro`,
    );
    expect(() => {
      checkReadonlyMounts(rows.join("\n"));
    }).not.toThrow();
    expect(() => {
      checkReadonlyMounts(
        rows.join("\n").replace("/proof/compiler ro", "/proof/compiler rw"),
      );
    }).toThrow();
    expect(() => {
      checkReadonlyMounts(rows.slice(0, -1).join("\n"));
    }).toThrow();
    expect(() => {
      checkReadonlyMounts(
        [...rows, "8 1 0:1 / /proof/compiler rw - tmpfs tmpfs rw"].join("\n"),
      );
    }).toThrow();
  });
  it("compares every normalized model field and exact wrapper/output identities", () => {
    // Fixed public fixture only. This test does not execute Go or establish normalization evidence.
    const source = createProductionRepairSeedSourceV1();
    const expected = source.generationRequest.normalizedSolution;
    const compilation = goCompilationResultV1Schema.parse({
      contractVersion: 1,
      diagnostics: [],
      model: expected,
      compiler: {
        id: "cloudmarkup.iac-compiler",
        version: "1.2.1",
        digest:
          "sha256:2c25a5610c825d171a167a38201c3090aa2278071ddd648bb957e67b7b98f203",
      },
    });
    const submission = encodeFrames([
      source.generationRequest.architectureDocument,
      source.generationRequest.workloadBehavior,
      source.generationRequest.solutionRevision,
    ]);
    function envelope(value: unknown, extra: Record<string, unknown> = {}) {
      const output = encoded(value);
      return Buffer.concat([
        encoded({
          kind: WIRE_KIND,
          phase: "result",
          compilerSha256: HASH,
          inputs: submission.identities,
          stdoutBytes: output.length,
          stdoutSha256: sha(output),
          stderrBytes: 0,
          ...extra,
        }),
        Buffer.from("\n"),
        output,
      ]);
    }
    expect(
      verifyNormalizedOutput(
        envelope(compilation),
        admission,
        submission.identities,
        expected,
      ).equal,
    ).toBe(true);
    expect(() =>
      verifyNormalizedOutput(
        envelope(compilation),
        admission,
        submission.identities,
        { ...expected, solutionRevisionId: "different-original-revision" },
      ),
    ).toThrow(expect.objectContaining({ phase: "normalization-model" }));
    expect(() =>
      verifyNormalizedOutput(
        envelope(compilation, { stdoutSha256: "b".repeat(64) }),
        admission,
        submission.identities,
        expected,
      ),
    ).toThrow();
    expect(() =>
      verifyNormalizedOutput(
        envelope(compilation, { inputs: [...submission.identities].reverse() }),
        admission,
        submission.identities,
        expected,
      ),
    ).toThrow();
    expect(() =>
      verifyNormalizedOutput(
        envelope(compilation, { stderrBytes: 1 }),
        admission,
        submission.identities,
        expected,
      ),
    ).toThrow();
    expect(() =>
      verifyNormalizedOutput(
        envelope({
          ...compilation,
          compiler: { ...compilation.compiler, version: "1.0.0" },
        }),
        admission,
        submission.identities,
        expected,
      ),
    ).toThrow();
  });
  it("never propagates an error message, stack, schema issue, output or arbitrary phase", () => {
    expect(closedFailure(new Error("PRIVATE_TEST_MARKER"))).toEqual({
      kind: "cloudmarkup.anonymous-normalization-parent.v1",
      status: "failed",
      phase: "parent-admission",
    });
    const error = new ClosedProofFailure("normalization");
    expect(JSON.stringify(closedFailure(error))).not.toContain("stack");
    expect(closedFailure(error).phase).toBe("normalization");
  });
});

describe("the actual parent 32-second success deadline", () => {
  it("denies synchronous overrun even before a timer callback can run", () => {
    let now = 100;
    const deadline = createParentDeadline(() => now);
    expect(deadline.remainingMilliseconds()).toBe(32000);
    deadline.assertCurrent("normalization");
    now += 32000;
    expect(() => {
      deadline.assertCurrent("normalization");
    }).toThrow(ClosedProofFailure);
  });
  it("denies expiry during final awaited host checks without waiting 32 seconds", async () => {
    let now = 100;
    const deadline = createParentDeadline(() => now);
    now += 31999;
    deadline.assertCurrent("parent-cleanup");
    await Promise.resolve();
    now += 1;
    expect(() => {
      deadline.assertCurrent("parent-cleanup");
    }).toThrow(ClosedProofFailure);
  });
  it("keeps the original start and denies invalid or backward clock values", () => {
    let now = 100;
    const deadline = createParentDeadline(() => now);
    now += 10;
    expect(deadline.remainingMilliseconds()).toBe(31990);
    now = 99;
    expect(() => {
      deadline.assertCurrent("launcher");
    }).toThrow(ClosedProofFailure);
    now = Number.NaN;
    expect(() => {
      deadline.assertCurrent("launcher");
    }).toThrow(ClosedProofFailure);
  });
});
