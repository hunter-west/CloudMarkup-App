import { cleanupRequired } from "./cleanup-required.js";
import { describe, it, expect, vi } from "vitest";
import { CleanupHistoryBoundDatabase } from "./project-cleanup-restore-guard.js";
import { createCleanupDatabaseIncarnationVerifier } from "./project-cleanup-incarnation.js";
import { projectCleanupAdmissionWake } from "../../application/project-cleanup-wake.js";
import {
  cleanupHistoryId,
  type CleanupHistoryPort,
  type CleanupHistoryRecord,
} from "../../application/project-cleanup-history.js";
import { replayRetainedCleanupHistory } from "./project-cleanup-history-restore.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
  type SqlResult,
} from "./sql.js";
const wake = projectCleanupAdmissionWake({
  organizationId: "org_test",
  projectId: "project_test",
  recordVersion: 2,
  deletionRequestedAt: "2026-10-03T00:00:00.000Z",
  admissionId: "a".repeat(64),
  admissionDeadline: "2026-10-03T00:01:00.000Z",
});
const record: CleanupHistoryRecord = {
  envelope: {
    kind: "admission",
    wake,
    principalId: "principal_test",
    idempotencyKeySha256: "b".repeat(64),
    requestSha256: "c".repeat(64),
    expectedRecordVersion: 1,
  },
  state: "committed",
};
function fixture() {
  let projectState = "deletion-pending",
    admissionState = "committed",
    required = true,
    status = "ready",
    present = true;
  const rows = (s: SqlStatement): readonly SqlRow[] =>
    s.text.includes("project_cleanup_controls")
      ? [{ history_required: required, restore_status: status }]
      : s.text.includes("FROM projects")
        ? present
          ? [
              {
                lifecycle_status: projectState,
                record_version: 2,
                requested_at: wake.deletionRequestedAt,
                deletion_record_version: 2,
                receipt_requested_at: wake.deletionRequestedAt,
              },
            ]
          : []
        : s.text.includes("FROM project_cleanup_admissions")
          ? [
              {
                lifecycle_status: admissionState,
                wake_binding: JSON.stringify(wake),
                principal_id: "principal_test",
                idempotency_key_sha256: "b".repeat(64),
                request_sha256: "c".repeat(64),
                expected_record_version: 1,
              },
            ]
          : [];
  const query = vi.fn(rows),
    database: SqlDatabase = {
      query: <T extends SqlRow>(s: SqlStatement): Promise<SqlResult<T>> => {
        const r = query(s);
        return Promise.resolve({ rows: r as T[], rowCount: r.length });
      },
      transaction: async (work) => work(database),
      close: () => Promise.resolve(),
    };
  let current: CleanupHistoryRecord = record;
  const history: CleanupHistoryPort = {
    prepare: () => Promise.resolve(),
    transition: () => Promise.resolve(),
    read: () => Promise.resolve(current),
    page: async (shard) =>
      await Promise.resolve({
        records:
          shard ===
          parseInt(cleanupRequired(cleanupHistoryId(record.envelope)[0]), 16) %
            4
            ? [current]
            : [],
      }),
  };
  const arn =
      "arn:aws:rds:us-east-1:123456789012:cluster:cloudmarkup-beta-postgresql",
    resourceId = "cluster-ABCDEFGHIJKLMNOPQRSTUVWX",
    describe = vi.fn(() =>
      Promise.resolve({ clusters: [{ arn, resourceId }] }),
    );
  const incarnation = createCleanupDatabaseIncarnationVerifier({
      expectedArn: arn,
      expectedResourceId: resourceId,
      describe,
    }),
    assertSchema = vi.fn(() => Promise.resolve());
  const guard = new CleanupHistoryBoundDatabase({
    database,
    history,
    incarnation,
    assertSchema,
  });
  return {
    guard,
    database,
    history,
    incarnation,
    assertSchema,
    describe,
    query,
    setProject: (v: string) => {
      projectState = v;
    },
    setAdmission: (v: string) => {
      admissionState = v;
    },
    setRecord: (v: CleanupHistoryRecord) => {
      current = v;
    },
    setStatus: (v: string) => {
      status = v;
    },
    disable: () => {
      required = false;
    },
    missing: () => {
      present = false;
    },
  };
}
describe("monotonic cleanup restore fencing", () => {
  it("a committed original binding permits work and freshly verifies before/after", async () => {
    const f = fixture(),
      work = vi.fn(() => Promise.resolve("result"));
    expect(await f.guard.transaction(work)).toBe("result");
    expect(work).toHaveBeenCalledOnce();
    expect(f.describe).toHaveBeenCalledTimes(2);
    expect(f.assertSchema).toHaveBeenCalledTimes(2);
  });
  it("a restored active project cannot serve resurrected data", async () => {
    const f = fixture();
    f.setProject("active");
    const work = vi.fn();
    await expect(f.guard.transaction(work)).rejects.toThrow(/tombstone/);
    expect(work).not.toHaveBeenCalled();
  });
  it("a restored PREPARED journal cannot abort externally committed deletion", async () => {
    const f = fixture();
    f.setAdmission("prepared");
    const abort = vi.fn();
    await expect(f.guard.transaction(abort)).rejects.toThrow(/disagrees/);
    expect(abort).not.toHaveBeenCalled();
  });
  it("missing lineage, disabled history and restore freeze each reject before work", async () => {
    for (const mode of ["missing", "disabled", "restoring"]) {
      const f = fixture();
      if (mode === "missing") f.missing();
      if (mode === "disabled") f.disable();
      if (mode === "restoring") f.setStatus("restoring");
      const work = vi.fn();
      await expect(f.guard.transaction(work)).rejects.toThrow();
      expect(work).not.toHaveBeenCalled();
    }
  });
  it("a matching deleted receipt survives completion of the outstanding wake", async () => {
    const f = fixture();
    f.setProject("deleted");
    await expect(
      f.guard.query(sql("SELECT ordinary_request")),
    ).resolves.toMatchObject({ rowCount: 0 });
  });
  it("an incarnation changed before execution blocks even an identical restored preparation", async () => {
    const f = fixture();
    f.setRecord({ ...record, state: "prepared" });
    f.setAdmission("prepared");
    f.describe.mockResolvedValue({
      clusters: [
        {
          arn: "arn:aws:rds:us-east-1:123456789012:cluster:cloudmarkup-beta-postgresql",
          resourceId: "cluster-OTHERABCDEFGHIJKLMNOPQRST",
        },
      ],
    });
    const work = vi.fn();
    await expect(f.guard.transaction(work)).rejects.toThrow(/incarnation/);
    expect(work).not.toHaveBeenCalled();
  });
  it("an incarnation change after work discards the result without replay", async () => {
    const f = fixture();
    f.describe
      .mockResolvedValueOnce(await f.describe())
      .mockResolvedValueOnce({ clusters: [] });
    f.describe.mockClear();
    const work = vi.fn(() => Promise.resolve("sensitive body"));
    await expect(f.guard.transaction(work)).rejects.toThrow();
    expect(work).toHaveBeenCalledOnce();
  });
  it("history changed during SQL work cannot expose a stale result", async () => {
    const f = fixture();
    const work = vi.fn(async () => {
      await Promise.resolve();
      f.setProject("active");
      return "sensitive";
    });
    await expect(f.guard.transaction(work)).rejects.toThrow();
    expect(work).toHaveBeenCalledOnce();
  });
  it("unknown preparations keep explicit restore quarantine and never execute replay SQL", async () => {
    const f = fixture();
    f.setStatus("restoring");
    f.setRecord({ ...record, state: "prepared" });
    f.query.mockClear();
    const result = await replayRetainedCleanupHistory({
      ...f,
      ledger: { put: vi.fn(), get: vi.fn() },
    });
    expect(result.state).toBe("quarantined");
    expect(
      f.query.mock.calls.every(
        ([s]) => !s.text.startsWith("INSERT") && !s.text.startsWith("UPDATE"),
      ),
    ).toBe(true);
  });
});
