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
    const request = input.prepared.workflowSubmission.request;
    const object = {
      contractVersion: 1,
      digest: `sha256:${"a".repeat(64)}`,
      mediaType: "application/zip",
      objectId: "object.archive",
      purpose: "export-package",
      sizeBytes: 10,
    };
    const verifiedPackage = {
      artifactId: "artifact.archive",
      availability: { state: "available" },
      object,
    };
    const artifact = {
      artifactId: verifiedPackage.artifactId,
      digest: object.digest,
      kind: "export-package",
      archiveFileName: "synthetic.zip",
      manifestDigest: request.subject.manifestDigest,
      mediaType: object.mediaType,
      sizeBytes: object.sizeBytes,
      object,
    };
    const valid = parseSolutionExportTerminalReceipt({
      ...input,
      result: {
        outcome: {
          outcome: "succeeded",
          outputSizeBytes: 10,
          output: {
            contractVersion: 1,
            family: "solution-export-orchestration",
            evidenceRecords: [],
            verifiedPackage,
          },
        },
        persistedOutput: {
          contractVersion: 1,
          artifact,
          diff: {
            contractVersion: 1,
            currentDigest: object.digest,
            state: "no-baseline",
            entries: [],
          },
          evidenceRecords: [],
          verifiedPackage,
        },
        readModel: {
          contractVersion: 1,
          artifact,
          diagnostics: [],
          downloadPolicy: {
            state: "eligible",
            artifactId: verifiedPackage.artifactId,
            digest: object.digest,
            maxGrantSeconds: 60,
          },
          environment: request.environment,
          evidenceRecords: [],
          evidenceSemantics: [],
          jobId: input.execution.jobId,
          requestDigest: input.prepared.workflowSubmission.requestDigest,
          stageReports: [],
          stages: [],
          state: "succeeded",
          subject: request.subject,
          targetProfileId: request.targetProfileId,
          targetSettingsDigest: request.targetSettings.digest,
          warnings: [],
        },
      },
      retained: {
        manifestObjectId: "object.manifest",
        archiveObject: object,
        archiveFileName: "synthetic.zip",
        fileCount: 0,
      },
    });
    expect(valid.result.outcome.outcome).toBe("succeeded");
    expect(valid.retained).toBeDefined();
    for (const retained of [
      undefined,
      {
        ...valid.retained,
        archiveObject: { ...object, objectId: "object.other-archive" },
      },
    ]) {
      expect(() =>
        parseSolutionExportTerminalReceipt({ ...valid, retained }),
      ).toThrow("The terminal receipt must bind one exact prepared execution.");
    }
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
