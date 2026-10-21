import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationError } from "./application/errors.js";
import { exportRunFixture } from "./adapters/persistence/solution-export-run-test-helpers.js";
import { SolutionExportWorkerAuthority } from "./adapters/persistence/solution-export-worker-authority.js";
import { PostgresSolutionExportTargetPolicy } from "./adapters/persistence/solution-export-target-policy.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { assertProductionSolutionExportStageAdmission } from "./production-solution-export-stage-admission.js";
function fixture() {
  const f = exportRunFixture("cloudformation");
  const query = vi.fn(() =>
    Promise.reject(new Error("Only the canonical policy spy may run.")),
  );
  const database: SqlDatabase = {
    query,
    transaction: (work) => work(database),
    close: () => Promise.resolve(),
  };
  const authority = new SolutionExportWorkerAuthority(database, {
    jobId: f.record.job.id,
    organizationId: f.record.organizationId,
    projectId: f.record.job.projectId,
    actorId: f.principal.principalId,
    inputDigest: f.binding.orchestrationInputSha256,
    attemptId: "attempt.synthetic",
    attemptNumber: 1,
    workerId: "worker.synthetic",
  });
  return {
    ...f,
    query,
    authority,
    input: { prepared: f.record, authority, stage: "render-diagram" as const },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
});
describe("current hosted export stage admission", () => {
  it("denies disabled host execution before commercial or stage work without removing recovery", async () => {
    const f = fixture();
    const evaluate = vi.spyOn(
      PostgresSolutionExportTargetPolicy.prototype,
      "evaluateForWorker",
    );
    await expect(
      assertProductionSolutionExportStageAdmission(
        f.input,
        f.record.workflowSubmission.request.targetSettings,
        false,
      ),
    ).rejects.toMatchObject({
      failure: {
        classification: "permanent",
        code: "cloudmarkup.export.host-disabled",
        publicMessage: "export-input-invalid",
        stage: "render-diagram",
      },
    });
    expect(evaluate).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
  });
  it("uses the real worker policy entry and keeps the original immutable decision", async () => {
    const f = fixture();
    const prior = f.record.workflowSubmission.entitlementDecisionReference;
    const evaluate = vi
      .spyOn(PostgresSolutionExportTargetPolicy.prototype, "evaluateForWorker")
      .mockResolvedValue({
        entitlementDecisionReference: "export-decision.current",
        targetSettings: f.record.workflowSubmission.request.targetSettings,
      });
    await assertProductionSolutionExportStageAdmission(
      f.input,
      f.record.workflowSubmission.request.targetSettings,
    );
    expect(evaluate).toHaveBeenCalledOnce();
    const input = evaluate.mock.calls[0]?.[0];
    expect(input).not.toHaveProperty("principal");
    expect(input?.binding.manifestDigest).toBe(
      f.record.job.solutionRevision.manifestDigest,
    );
    expect(input?.binding.workflowSources).toEqual(
      f.record.workflowSubmission.request.sources,
    );
    expect(f.record.workflowSubmission.entitlementDecisionReference).toBe(
      prior,
    );
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each(["access_denied", "service_unavailable"] as const)(
    "retains a sanitized permanent %s result at the actual stage",
    async (code) => {
      const f = fixture();
      vi.spyOn(
        PostgresSolutionExportTargetPolicy.prototype,
        "evaluateForWorker",
      ).mockRejectedValue(
        new ApplicationError(code, "Private commercial details."),
      );
      await expect(
        assertProductionSolutionExportStageAdmission(
          f.input,
          f.record.workflowSubmission.request.targetSettings,
        ),
      ).rejects.toMatchObject({
        failure: {
          classification: "permanent",
          stage: "render-diagram",
          code: "cloudmarkup.export.current-commercial-admission-denied",
          publicMessage: "export-input-invalid",
        },
      });
    },
  );
  it("preserves infrastructure failures for the existing bounded retry classifier", async () => {
    const f = fixture(),
      failure = new Error("Database temporarily unavailable.");
    vi.spyOn(
      PostgresSolutionExportTargetPolicy.prototype,
      "evaluateForWorker",
    ).mockRejectedValue(failure);
    await expect(
      assertProductionSolutionExportStageAdmission(
        f.input,
        f.record.workflowSubmission.request.targetSettings,
      ),
    ).rejects.toBe(failure);
  });
});
