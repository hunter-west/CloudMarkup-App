import { describe, expect, it } from "vitest";
import { ApplicationError } from "../../application/errors.js";
import {
  applyAsyncJobLifecycleCommandV1,
  createAsyncJobRecordV1,
  DEFAULT_ASYNC_JOB_LIMITS_V1,
} from "@cloudmarkup/domain";
import {
  asyncJobAttemptIdSchema,
  asyncJobIdSchema,
  asyncJobTrustedContextV1Schema,
  asyncJobWorkerIdSchema,
  namespacedIdentifierSchema,
} from "@cloudmarkup/schemas";
import { solutionExportRootAdmissionCommand } from "../../application/solution-export-root-admission.js";
import { exportRunFixture } from "./solution-export-run-test-helpers.js";
import {
  exportRunBytes,
  exportRunSha,
  parseStoredExportRun,
  parsePreparedExportRun,
} from "./solution-export-run-codec.js";
import { solutionExportExecutionIdentity } from "./solution-export-worker-authority.js";
import {
  parseSolutionExportOrphanReceipt,
  projectSolutionExportOrphanTerminal,
  solutionExportOrphanTransition,
  verifySolutionExportOrphanReceipt,
} from "./solution-export-orphan-receipt.js";
import { parseSolutionExportTerminalReceipt } from "./solution-export-terminal-codec.js";

function fixture(
  kind:
    | "attempts"
    | "runtime"
    | "expired"
    | "cancel"
    | "retry"
    | "expired-cancel" = "attempts",
) {
  const f = exportRunFixture("cloudformation");
  const admission = solutionExportRootAdmissionCommand(
    f.record,
    f.idempotencyKeyDigest,
  );
  const at = (seconds: number) =>
    new Date(Date.parse(f.record.job.createdAt) + seconds * 1000).toISOString();
  const context = asyncJobTrustedContextV1Schema.parse({
    actor: { kind: "principal", actorId: f.record.createdByPrincipalId },
    correlationId: "correlation.orphan-proof",
    ownership: {
      organizationId: f.record.organizationId,
      projectId: f.record.job.projectId,
    },
  });
  const queued = createAsyncJobRecordV1({
    context,
    createdAt: at(0),
    expiresAt: at(kind.startsWith("expired") ? 3 : 3600),
    jobId: asyncJobIdSchema.parse(f.record.job.id),
    input: admission.request.input,
    inputDigest: admission.inputDigest,
    inputSizeBytes: admission.request.inputSizeBytes,
    idempotency: admission.idempotency,
    reservation: { state: "none" },
    limits: {
      ...DEFAULT_ASYNC_JOB_LIMITS_V1,
      attemptCount: kind === "attempts" ? 1 : 3,
      runtimeSeconds: kind === "runtime" ? 1 : 300,
    },
  }).job;
  let prior = applyAsyncJobLifecycleCommandV1(queued, {
    kind: "claim",
    at: at(1),
    expectedInputDigest: queued.inputDigest,
    expectedRecordVersion: queued.recordVersion,
    attemptId: asyncJobAttemptIdSchema.parse("attempt.orphan-proof"),
    workerId: asyncJobWorkerIdSchema.parse("worker.orphan-proof"),
    leaseExpiresAt: at(2),
    dependencies: [],
    handler: {
      family: "solution-export-orchestration",
      handlerId: namespacedIdentifierSchema.parse(
        "cloudmarkup.solution-export.workflow",
      ),
      handlerVersion: "1.0.0",
      resumePolicy: "restart-from-input",
    },
  }).job;
  if (kind === "cancel" || kind === "expired-cancel")
    prior = applyAsyncJobLifecycleCommandV1(prior, {
      kind: "request-cancellation",
      at: at(1.5),
      context,
      expectedInputDigest: prior.inputDigest,
      expectedRecordVersion: prior.recordVersion,
    }).job;
  const result = solutionExportOrphanTransition(prior, at(10));
  const raw = {
    contractVersion: 1,
    kind: "cloudmarkup.solution-export-orphan-terminal-receipt",
    execution: solutionExportExecutionIdentity(prior),
    prepared: f.record,
    priorRecordVersion: prior.recordVersion,
    priorSnapshot: {
      contractVersion: 1,
      objectId: "object.orphan-prior",
      purpose: "report",
      mediaType: "application/json",
      sizeBytes: exportRunBytes(prior).length,
      digest: `sha256:${exportRunSha(exportRunBytes(prior))}`,
    },
    reconciledAt: at(10),
    terminalState: result.job.state,
    terminalRootDigest: `sha256:${exportRunSha(exportRunBytes(result.job))}`,
  };
  return { ...f, at, prior, result, raw };
}

describe("distinct canonical export orphan settlement receipt", () => {
  it.each(["attempts", "runtime"] as const)(
    "retains the actual %s limit failure without workflow evidence or a download",
    (kind) => {
      const f = fixture(kind);
      const receipt = parseSolutionExportOrphanReceipt(f.raw);
      const verified = verifySolutionExportOrphanReceipt(
        receipt,
        f.prior,
        f.result.job,
      );
      expect(verified.job.state).toBe("failed");
      expect(verified.job.attempts.at(-1)?.state).toBe("orphaned");
      expect(verified.job.failure?.code).toBe(
        kind === "attempts"
          ? "cloudmarkup.job.attempt-limit-exceeded"
          : "cloudmarkup.job.runtime-limit-exceeded",
      );
      const publicJob = projectSolutionExportOrphanTerminal(
        receipt,
        f.prior,
        f.result.job,
      ).job;
      expect(publicJob.state).toBe("failed");
      expect(publicJob.artifact).toBeUndefined();
      expect(publicJob.evidence).toEqual([]);
      expect(publicJob.diagnostics).toEqual([
        expect.objectContaining({
          code: verified.job.failure?.code,
          stage: "publication",
          severity: "error",
        }),
      ]);
      expect(
        publicJob.stages.find(
          ({ stage }) => stage === "cloudformation-validation",
        )?.status,
      ).toBe("pending");
      expect(
        publicJob.stages.find(({ stage }) => stage === "publication")?.status,
      ).toBe("failed");
    },
  );
  it("retains canonical expiry without inventing a root failure or worker validation result", () => {
    const f = fixture("expired");
    const receipt = parseSolutionExportOrphanReceipt(f.raw);
    expect(f.result.job.state).toBe("expired");
    expect(f.result.job.attempts.at(-1)?.state).toBe("canceled");
    expect(f.result.job.failure).toBeUndefined();
    const projected = projectSolutionExportOrphanTerminal(
      receipt,
      f.prior,
      f.result.job,
    );
    expect(projected.job.state).toBe("failed");
    expect(projected.job.diagnostics[0]?.code).toBe("cloudmarkup.job.expired");
    expect(projected.job.progress.message).toContain("expired");
    expect(projected.job.artifact).toBeUndefined();
  });
  it("acknowledges the original cancellation after lease expiry", () => {
    const f = fixture("cancel");
    const projected = projectSolutionExportOrphanTerminal(
      parseSolutionExportOrphanReceipt(f.raw),
      f.prior,
      f.result.job,
    );
    expect(projected.job.state).toBe("canceled");
    expect(projected.job.cancellation).toEqual({
      state: "acknowledged",
      requestedAt: f.at(1.5),
    });
    expect(projected.job.evidence).toEqual([]);
    expect(projected.job.artifact).toBeUndefined();
  });
  it("retains a requested cancellation when canonical expiry wins without claiming acknowledgement", () => {
    const f = fixture("expired-cancel");
    const projected = projectSolutionExportOrphanTerminal(
      parseSolutionExportOrphanReceipt(f.raw),
      f.prior,
      f.result.job,
    );
    expect(f.result.job.state).toBe("expired");
    expect(projected.job.state).toBe("failed");
    expect(projected.job.cancellation).toEqual({
      state: "requested",
      requestedAt: f.at(1.5),
    });
    expect(parseStoredExportRun(projected)).toEqual(projected);
    expect(() => parsePreparedExportRun(projected)).toThrow();
  });
  it("never relabels a valid retry as terminal settlement", () => {
    const f = fixture("retry");
    expect(f.result.job.state).toBe("queued");
    expect(() => parseSolutionExportOrphanReceipt(f.raw)).toThrow();
    expect(() =>
      verifySolutionExportOrphanReceipt(
        { ...f.raw, terminalState: "failed" },
        f.prior,
      ),
    ).toThrow();
  });
  it("refuses a live worker lease", () => {
    const f = fixture();
    expect(() => solutionExportOrphanTransition(f.prior, f.at(1.5))).toThrow();
  });
  it.each([
    "jobId",
    "organizationId",
    "projectId",
    "attemptId",
    "attemptNumber",
    "workerId",
    "actorId",
    "inputDigest",
  ] as const)("rejects substituted execution %s", (field) => {
    const f = fixture();
    const value =
      field === "attemptNumber"
        ? 2
        : field === "inputDigest"
          ? `sha256:${"0".repeat(64)}`
          : "other.orphan";
    expect(() =>
      verifySolutionExportOrphanReceipt(
        { ...f.raw, execution: { ...f.raw.execution, [field]: value } },
        f.prior,
      ),
    ).toThrow();
  });
  it.each([
    { priorRecordVersion: 999 },
    { reconciledAt: "2000-01-01T00:00:00.000Z" },
    { terminalRootDigest: `sha256:${"0".repeat(64)}` },
    { terminalState: "canceled" },
    { result: { outcome: { outcome: "succeeded" } } },
    { retained: { archiveObject: {} } },
  ])("rejects altered proof or fabricated workflow fields %j", (patch) => {
    const f = fixture();
    expect(() =>
      verifySolutionExportOrphanReceipt(
        { ...f.raw, ...patch },
        f.prior,
        f.result.job,
      ),
    ).toThrow();
  });
  it("requires exact immutable prior bytes and terminal bytes", () => {
    const f = fixture();
    expect(() =>
      verifySolutionExportOrphanReceipt(
        f.raw,
        { ...f.prior, recordVersion: f.prior.recordVersion + 1 },
        f.result.job,
      ),
    ).toThrow();
    expect(() =>
      verifySolutionExportOrphanReceipt(f.raw, f.prior, {
        ...f.result.job,
        failure: { ...f.result.job.failure, code: "other.failure" },
      }),
    ).toThrow();
    expect(() =>
      verifySolutionExportOrphanReceipt(
        {
          ...f.raw,
          priorSnapshot: {
            ...f.raw.priorSnapshot,
            sizeBytes: f.raw.priorSnapshot.sizeBytes + 1,
          },
        },
        f.prior,
      ),
    ).toThrow();
  });
  it("does not change or impersonate the ordinary worker terminal receipt contract", () => {
    const f = fixture();
    expect(() => parseSolutionExportTerminalReceipt(f.raw)).toThrow();
    expect(() =>
      parseSolutionExportOrphanReceipt({
        contractVersion: 1,
        kind: "cloudmarkup.solution-export-terminal-receipt",
        execution: f.raw.execution,
        prepared: f.record,
        result: { outcome: { outcome: "canceled" } },
      }),
    ).toThrow();
  });
  it("rejects oversized proof before decoding", () => {
    const f = fixture();
    expect(parseSolutionExportOrphanReceipt(f.raw)).toEqual(f.raw);
    const oversized = { ...f.raw, padding: "x".repeat(4 * 1024 * 1024) };
    expect(exportRunBytes(oversized).byteLength).toBeGreaterThan(
      4 * 1024 * 1024,
    );
    let error: unknown;
    try {
      parseSolutionExportOrphanReceipt(oversized);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error).toMatchObject({
      code: "service_unavailable",
      status: 503,
      message: "The prepared export journal is unavailable.",
    });
  });
});
