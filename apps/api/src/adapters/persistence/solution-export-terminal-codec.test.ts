import { describe, expect, it } from "vitest";
import { exportRunFixture } from "./solution-export-run-test-helpers.js";
import { parseSolutionExportTerminalReceipt } from "./solution-export-terminal-codec.js";

function fixture() {
  const f = exportRunFixture();
  return {
    contractVersion: 1,
    kind: "cloudmarkup.solution-export-terminal-receipt",
    execution: {
      jobId: f.record.job.id,
      organizationId: f.record.organizationId,
      projectId: f.record.job.projectId,
      attemptId: "attempt.synthetic",
      attemptNumber: 1,
      workerId: "worker.synthetic",
      actorId: f.record.createdByPrincipalId,
      inputDigest: f.binding.orchestrationInputSha256,
    },
    prepared: f.record,
    result: { outcome: { outcome: "canceled" } },
  };
}
describe("immutable export terminal receipt projection", () => {
  it("roundtrips and clones one exact prepared execution without inventing retained output", () => {
    const input = fixture();
    const parsed = parseSolutionExportTerminalReceipt(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.prepared).not.toBe(input.prepared);
    expect(parsed.retained).toBeUndefined();
  });
  it.each([
    "jobId",
    "organizationId",
    "projectId",
    "actorId",
    "inputDigest",
  ] as const)("rejects changed %s ownership or immutable input", (field) => {
    const input = fixture();
    expect(() =>
      parseSolutionExportTerminalReceipt({
        ...input,
        execution: {
          ...input.execution,
          [field]:
            field === "inputDigest"
              ? `sha256:${"0".repeat(64)}`
              : "other.synthetic",
        },
      }),
    ).toThrow();
  });
  it("accepts only the declared safe failure envelope", () => {
    const input = fixture();
    const failure = {
      classification: "permanent",
      code: "export.synthetic-failure",
      publicMessage: "job-input-invalid",
    };
    expect(
      parseSolutionExportTerminalReceipt({
        ...input,
        result: { outcome: { outcome: "failed", failure } },
      }).result.outcome.outcome,
    ).toBe("failed");
    expect(() =>
      parseSolutionExportTerminalReceipt({
        ...input,
        result: {
          outcome: {
            outcome: "failed",
            failure: { ...failure, rawError: "untrusted detail" },
          },
        },
      }),
    ).toThrow();
  });
  it("rejects unknown receipt, execution and result fields", () => {
    const input = fixture();
    for (const value of [
      { ...input, extra: true },
      { ...input, execution: { ...input.execution, extra: true } },
      { ...input, result: { ...input.result, extra: true } },
    ])
      expect(() => parseSolutionExportTerminalReceipt(value)).toThrow();
  });
  it("rejects success without actual workflow output and retained archive bindings", () => {
    const input = fixture();
    expect(() =>
      parseSolutionExportTerminalReceipt({
        ...input,
        result: { outcome: { outcome: "succeeded" } },
      }),
    ).toThrow();
  });
  it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid attempt number %s",
    (attemptNumber) => {
      const input = fixture();
      expect(() =>
        parseSolutionExportTerminalReceipt({
          ...input,
          execution: { ...input.execution, attemptNumber },
        }),
      ).toThrow();
    },
  );
  it("rejects more than four MiB before projecting untrusted receipt fields", () => {
    expect(() =>
      parseSolutionExportTerminalReceipt({
        ...fixture(),
        oversize: "x".repeat(4 * 1024 * 1024),
      }),
    ).toThrow();
  });
});
