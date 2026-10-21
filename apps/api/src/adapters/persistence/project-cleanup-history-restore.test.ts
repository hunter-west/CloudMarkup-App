import { cleanupRequired } from "./cleanup-required.js";
import { describe, expect, it, vi } from "vitest";
import {
  backfillRetainedCleanupHistory,
  replayRetainedCleanupHistory,
} from "./project-cleanup-history-restore.js";
import {
  projectCleanupAdmissionWake,
  type ProjectCleanupWake,
} from "../../application/project-cleanup-wake.js";
import {
  cleanupHistoryId,
  type CleanupHistoryEnvelope,
  type CleanupHistoryPort,
  type CleanupHistoryRecord,
} from "../../application/project-cleanup-history.js";
import { createCleanupDatabaseIncarnationVerifier } from "./project-cleanup-incarnation.js";
import type { SqlDatabase, SqlRow, SqlStatement, SqlResult } from "./sql.js";
const wake = projectCleanupAdmissionWake({
  organizationId: "org_test",
  projectId: "project_test",
  recordVersion: 2,
  deletionRequestedAt: "2026-10-03T00:00:00.000Z",
  admissionId: "a".repeat(64),
  admissionDeadline: "2026-10-03T00:01:00.000Z",
});
function fixture() {
  let required = true,
    status = "restoring";
  const records = new Map<string, CleanupHistoryRecord>(),
    wakes = new Map<string, ProjectCleanupWake>();
  const admission = {
    wake_binding: JSON.stringify(wake),
    principal_id: "principal_test",
    idempotency_key_sha256: "b".repeat(64),
    request_sha256: "c".repeat(64),
    expected_record_version: 1,
    lifecycle_status: "committed",
  };
  const projects: SqlRow[] = [
    {
      organization_id: "org_test",
      project_id: "project_test",
      lifecycle_status: "deletion-pending",
      record_version: 2,
      requested_at: wake.deletionRequestedAt,
    },
  ];
  const query = vi.fn(async (s: SqlStatement): Promise<SqlResult> => {
    await Promise.resolve();
    const rows: SqlRow[] = s.text.includes("SELECT history_required")
      ? [{ history_required: true, restore_status: status }]
      : s.text.includes("SELECT admission_required")
        ? [{ admission_required: required }]
        : s.text.includes("SELECT restore_status")
          ? [{ restore_status: status }]
          : s.text.includes("SELECT * FROM project_cleanup_admissions")
            ? [admission]
            : s.text.includes("FROM projects p LEFT JOIN")
              ? projects
              : [];
    return { rows, rowCount: rows.length };
  });
  const database: SqlDatabase = {
    query: <T extends SqlRow>(s: SqlStatement) =>
      query(s) as Promise<SqlResult<T>>,
    transaction: async (work) => work(database),
    close: () => Promise.resolve(),
  };
  const history: CleanupHistoryPort = {
    prepare: async (envelope) => {
      await Promise.resolve();
      records.set(cleanupHistoryId(envelope), { envelope, state: "prepared" });
    },
    transition: async (envelope, _from, state, completion) => {
      await Promise.resolve();
      records.set(cleanupHistoryId(envelope), {
        envelope,
        state,
        ...(completion === undefined ? {} : { completion }),
      });
    },
    read: (id) => Promise.resolve(records.get(id) ?? null),
    page: async (shard) =>
      await Promise.resolve({
        records: [...records.values()].filter(
          (r) =>
            parseInt(cleanupRequired(cleanupHistoryId(r.envelope)[0]), 16) %
              4 ===
            shard,
        ),
      }),
  };
  const ledger = {
    put: vi.fn(async (w: ProjectCleanupWake) => {
      await Promise.resolve();
      wakes.set(w.wakeId, w);
    }),
    get: vi.fn((id: string) => Promise.resolve(wakes.get(id) ?? null)),
  };
  const arn =
      "arn:aws:rds:us-east-1:123456789012:cluster:cloudmarkup-beta-postgresql",
    resourceId = "cluster-ABCDEFGHIJKLMNOPQRSTUVWX",
    describe = vi.fn(() =>
      Promise.resolve({ clusters: [{ arn, resourceId }] }),
    ),
    incarnation = createCleanupDatabaseIncarnationVerifier({
      expectedArn: arn,
      expectedResourceId: resourceId,
      describe,
    });
  const assertSchema = vi.fn(() => Promise.resolve());
  return {
    database,
    history,
    ledger,
    incarnation,
    assertSchema,
    describe,
    query,
    records,
    wakes,
    projects,
    disable: () => {
      required = false;
    },
    unfreeze: () => {
      status = "ready";
    },
  };
}
describe("retained history frozen operator boundary", () => {
  it("backfills committed admission and its exact pending V2 wake with fresh identity before/after", async () => {
    const f = fixture();
    expect((await backfillRetainedCleanupHistory(f)).records).toBe(1);
    expect(await f.ledger.get(wake.wakeId)).toEqual(wake);
    expect([...f.records.values()][0]?.state).toBe("committed");
    expect(f.describe).toHaveBeenCalledTimes(2);
    expect(f.assertSchema).toHaveBeenCalledOnce();
  });
  it("retains already erased legacy deletion receipts without creating outstanding wakes", async () => {
    const f = fixture();
    f.projects.push({
      organization_id: "org_test",
      project_id: "project_erased",
      lifecycle_status: "deleted",
      record_version: 3,
      deletion_record_version: 2,
      receipt_requested_at: wake.deletionRequestedAt,
    });
    expect((await backfillRetainedCleanupHistory(f)).records).toBe(2);
    expect(
      [...f.records.values()].some(
        (r) =>
          r.envelope.kind === "legacy-deletion" &&
          r.envelope.wake.projectId === "project_erased" &&
          r.state === "committed",
      ),
    ).toBe(true);
    expect(f.wakes.size).toBe(1);
  });
  it("refuses first-page coverage when complete bounded inventory overflows", async () => {
    const f = fixture();
    await expect(
      backfillRetainedCleanupHistory({ ...f, maximum: 1 }),
    ).rejects.toThrow(/bound/);
    expect(f.records.size).toBe(0);
    expect(f.ledger.put).not.toHaveBeenCalled();
  });
  it("refuses historical backfill without future SQL admission enforcement", async () => {
    const f = fixture();
    f.disable();
    await expect(backfillRetainedCleanupHistory(f)).rejects.toThrow(
      /Future admission/,
    );
    expect(f.records.size).toBe(0);
  });
  it("failed strong pending wake readback cannot produce a coverage receipt", async () => {
    const f = fixture();
    f.ledger.get.mockResolvedValue(null);
    await expect(backfillRetainedCleanupHistory(f)).rejects.toThrow(/readback/);
  });
  it("successful metadata replay leaves access quarantined until canonical evidence review", async () => {
    const f = fixture();
    const result = await replayRetainedCleanupHistory(f);
    expect(result.state).toBe("replayed-quarantined");
    expect(
      "requiresCanonicalEvidenceReview" in result &&
        result.requiresCanonicalEvidenceReview,
    ).toBe(true);
    expect(
      f.query.mock.calls.some(([s]) =>
        s.text.includes("restore_status='ready'"),
      ),
    ).toBe(false);
  });
  it("replaced database blocks restore before any SQL or durable wake mutation", async () => {
    const f = fixture();
    f.describe.mockResolvedValue({ clusters: [] });
    await expect(replayRetainedCleanupHistory(f)).rejects.toThrow(
      /incarnation/,
    );
    expect(f.query).not.toHaveBeenCalled();
    expect(f.ledger.put).not.toHaveBeenCalled();
  });
  it("restore must remain explicitly frozen before importing any retained record", async () => {
    const f = fixture();
    f.unfreeze();
    await expect(replayRetainedCleanupHistory(f)).rejects.toThrow(/frozen/);
    expect(
      f.query.mock.calls.every(
        ([s]) => !s.text.startsWith("INSERT") && !s.text.startsWith("UPDATE"),
      ),
    ).toBe(true);
  });
  it("unknown issued writes remain quarantined without synthetic completion or SQL replay", async () => {
    const f = fixture();
    const e: CleanupHistoryEnvelope = {
      kind: "write",
      writeId: "write_test",
      organizationId: "org_test",
      projectId: "project_test",
      objectId: "object_test",
      contentSha256: "d".repeat(64),
      sizeBytes: 2,
      purpose: "report",
      mediaType: "application/json",
      storageNamespace: "documents",
      principalId: "principal_test",
    };
    f.records.set(cleanupHistoryId(e), { envelope: e, state: "issued" });
    expect((await replayRetainedCleanupHistory(f)).state).toBe("quarantined");
    expect(
      f.query.mock.calls.every(
        ([s]) => !s.text.startsWith("INSERT") && !s.text.startsWith("UPDATE"),
      ),
    ).toBe(true);
    expect(f.ledger.put).not.toHaveBeenCalled();
  });
});
