import { describe, expect, it, vi } from "vitest";
import { exportRunFixture } from "./solution-export-run-test-helpers.js";
import { PostgresSolutionExportDownloadRepository } from "./solution-export-download-repository.js";
import { SolutionExportWorkerAuthority } from "./solution-export-worker-authority.js";
import type { SqlDatabase } from "./sql.js";
import type { ObjectStore } from "../../application/persistence.js";

function fixture() {
  const f = exportRunFixture("cloudformation");
  const query = vi.fn(() =>
    Promise.reject(new Error("No grant SQL may execute for worker reads.")),
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
  return { f, query, database, authority, objects: {} as ObjectStore };
}
describe("worker access to prior verified export packages", () => {
  it("cannot use artifact-read authority to obtain a browser download grant", async () => {
    const f = fixture();
    const reader = new PostgresSolutionExportDownloadRepository(
      f.database,
      f.objects,
      f.authority,
      f.authority.ownership,
    );
    await expect(
      reader.getDownloadGrant({
        ...f.authority.ownership,
        artifactId: "artifact.synthetic",
        grantId: "grant.synthetic",
        principalId: f.f.principal.principalId,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(f.query).not.toHaveBeenCalled();
  });
  it("rejects a foreign project even when a concrete worker authority was supplied", () => {
    const f = fixture();
    expect(
      () =>
        new PostgresSolutionExportDownloadRepository(
          f.database,
          f.objects,
          f.authority,
          { ...f.authority.ownership, projectId: "project.foreign" },
        ),
    ).toThrow("unavailable");
    expect(f.query).not.toHaveBeenCalled();
  });
});
