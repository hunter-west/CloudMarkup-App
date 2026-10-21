import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "./application/errors.js";
import {
  observeSolutionExportStage,
  recordSolutionExportDiagnostic,
  solutionExportFailureReason,
  type SolutionExportDiagnostics,
} from "./solution-export-diagnostics.js";

describe("safe export diagnostics", () => {
  it("identifies a dependency denial without leaking error or customer content", async () => {
    const sink = vi.fn<SolutionExportDiagnostics>();
    const error = Object.assign(
      new Error("secret credential, SQL and customer source"),
      { name: "AccessDeniedException" },
    );
    await expect(
      observeSolutionExportStage(sink, "inspect", "private-job-id", () =>
        Promise.reject(error),
      ),
    ).rejects.toBe(error);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[1]?.[0]).toMatchObject({
      event: "solution-export-worker",
      version: 1,
      stage: "inspect",
      outcome: "failed",
      reason: "dependency-access-denied",

      reference: createHash("sha256").update("private-job-id").digest("hex"),
    });
    expect(typeof sink.mock.calls[1]?.[0]?.durationMilliseconds).toBe("number");
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(
      /credential|customer|private-job-id|SQL/u,
    );
  });
  it("does not let failed telemetry change execution or acknowledgement", async () => {
    const sink = () => {
      throw Error("sink unavailable");
    };
    await expect(
      observeSolutionExportStage(sink, "claim", "job", () =>
        Promise.resolve("claimed"),
      ),
    ).resolves.toBe("claimed");
    expect(() => {
      recordSolutionExportDiagnostic(sink, "delivery", "pending", "message");
    }).not.toThrow();
    const error = Error("original");
    await expect(
      observeSolutionExportStage(sink, "claim", "job", () =>
        Promise.reject(error),
      ),
    ).rejects.toBe(error);
  });
  it.each([
    [new ApplicationError("conflict", "private"), "stale-execution"],
    [new ApplicationError("access_denied", "private"), "authorization-denied"],
    [
      Object.assign(Error("private"), { name: "TimeoutError" }),
      "dependency-timeout",
    ],
    [
      Object.assign(Error("private"), {
        name: "Untrusted error name with source",
      }),
      "unexpected-failure",
    ],
    [{ name: "AccessDeniedException", token: "private" }, "unexpected-failure"],
  ])("uses only the fixed safe failure vocabulary", (error, reason) => {
    expect(solutionExportFailureReason(error)).toBe(reason);
  });
});
