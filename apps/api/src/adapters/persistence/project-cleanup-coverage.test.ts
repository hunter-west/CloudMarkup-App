import { describe, expect, it, vi } from "vitest";
import {
  projectCleanupAdmissionWake,
  projectCleanupWake,
  type ProjectCleanupWake,
} from "../../application/project-cleanup-wake.js";
import { proveProjectCleanupWakeCoverage } from "./project-cleanup-coverage.js";
import type { SqlDatabase, SqlResult, SqlRow, SqlStatement } from "./sql.js";
const wake = projectCleanupAdmissionWake({
  organizationId: "org_test",
  projectId: "project_test",
  recordVersion: 2,
  deletionRequestedAt: "2026-10-03T00:00:00.000Z",
  admissionDeadline: "2026-10-03T00:01:00.000Z",
  admissionId: "a".repeat(64),
});
function fixture() {
  let required = true;
  let rows: SqlRow[] = [
    {
      organization_id: wake.organizationId,
      project_id: wake.projectId,
      record_version: 2,
      requested_at: wake.deletionRequestedAt,
      wake_binding: JSON.stringify(wake),
      admission_status: "committed",
    },
  ];
  const statements: SqlStatement[] = [];
  let locked = false;
  const database: SqlDatabase = {
    query: <T extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<T>> => {
      statements.push(statement);
      expect(locked).toBe(true);
      const current = statement.text.includes("project_cleanup_controls")
        ? [{ admission_required: required }]
        : rows;
      return Promise.resolve({
        rows: current as T[],
        rowCount: current.length,
      });
    },
    transaction: async (work) => {
      locked = true;
      try {
        return await work(database);
      } finally {
        locked = false;
      }
    },
    close: () => Promise.resolve(),
  };
  let observed: ProjectCleanupWake | null = wake;
  const get = vi.fn(() => {
    expect(locked).toBe(true);
    return Promise.resolve(observed);
  });
  const assertSchema = vi.fn().mockResolvedValue(undefined);
  const run = (maximumPending?: number) =>
    proveProjectCleanupWakeCoverage({
      database,
      ledger: { get },
      assertSchema,
      ...(maximumPending === undefined ? {} : { maximumPending }),
    });
  return {
    run,
    get,
    assertSchema,
    statements,
    setRequired: (value: boolean) => {
      required = value;
    },
    setRows: (value: SqlRow[]) => {
      rows = value;
    },
    setObserved: (value: ProjectCleanupWake | null) => {
      observed = value;
    },
  };
}
describe("source-bound cleanup coverage operator proof", () => {
  it("requires future admission enforcement even when SQL is empty", async () => {
    const f = fixture();
    f.setRequired(false);
    f.setRows([]);
    expect(await f.run()).toEqual({
      covered: false,
      pending: 0,
      reason: "admission-not-required",
    });
    expect(f.get).not.toHaveBeenCalled();
  });
  it("strongly checks every pending exact admission with project/control locks", async () => {
    const f = fixture();
    expect(await f.run()).toEqual({ covered: true, pending: 1 });
    expect(f.get).toHaveBeenCalledWith(wake.wakeId);
    expect(f.statements[0]?.text).toContain("FOR SHARE");
    expect(f.statements[1]?.text).toContain("FOR SHARE OF p");
  });
  it("admits an empty inventory only with enforced future admission", async () => {
    const f = fixture();
    f.setRows([]);
    expect(await f.run()).toEqual({ covered: true, pending: 0 });
    expect(f.get).not.toHaveBeenCalled();
  });
  it("refuses truncated backlog rather than treating one page as coverage", async () => {
    const f = fixture();
    f.setRows([{}, {}]);
    expect(await f.run(1)).toEqual({
      covered: false,
      pending: 2,
      reason: "backlog-exceeds-bound",
    });
    expect(f.get).not.toHaveBeenCalled();
  });
  it("retains missing or different valid wakes as uncovered", async () => {
    const f = fixture();
    f.setObserved(null);
    expect((await f.run()).covered).toBe(false);
    f.setObserved(
      projectCleanupWake({ ...wake, lifecycleStatus: "deletion-pending" }),
    );
    expect((await f.run()).covered).toBe(false);
  });
  it("covers prior default admissions only with their exact retained shadow wake", async () => {
    const f = fixture();
    f.setRows([
      {
        organization_id: wake.organizationId,
        project_id: wake.projectId,
        record_version: 2,
        requested_at: wake.deletionRequestedAt,
        wake_binding: null,
        admission_status: null,
      },
    ]);
    f.setObserved(
      projectCleanupWake({ ...wake, lifecycleStatus: "deletion-pending" }),
    );
    expect(await f.run()).toEqual({ covered: true, pending: 1 });
  });
  it("rejects prepared admissions and canonical binding mismatches", async () => {
    const f = fixture();
    f.setRows([
      {
        organization_id: wake.organizationId,
        project_id: wake.projectId,
        record_version: 2,
        requested_at: wake.deletionRequestedAt,
        wake_binding: JSON.stringify(wake),
        admission_status: "prepared",
      },
    ]);
    await expect(f.run()).rejects.toThrow();
    expect(f.get).not.toHaveBeenCalled();
    f.setRows([
      {
        organization_id: wake.organizationId,
        project_id: wake.projectId,
        record_version: 3,
        requested_at: wake.deletionRequestedAt,
        wake_binding: JSON.stringify(wake),
        admission_status: "committed",
      },
    ]);
    await expect(f.run()).rejects.toThrow();
    expect(f.get).not.toHaveBeenCalled();
  });
  it("fails on schema/ledger outages without certifying coverage", async () => {
    const f = fixture();
    f.assertSchema.mockRejectedValueOnce(Error("Schema mismatch"));
    await expect(f.run()).rejects.toThrow();
    expect(f.get).not.toHaveBeenCalled();
    f.get.mockRejectedValueOnce(Error("Ledger unavailable"));
    await expect(f.run()).rejects.toThrow();
  });
});
