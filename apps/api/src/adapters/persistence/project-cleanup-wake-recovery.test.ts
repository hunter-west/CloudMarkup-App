import { createHash } from "node:crypto";
import { ListObjectVersionsCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { createProjectContentCleanup } from "./project-content-cleanup.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import { permissionsForRole } from "../../application/authorization.js";
import {
  createCleanupWakeProcessor,
  projectCleanupWake,
  type CleanupWakeLedger,
} from "../../application/project-cleanup-wake.js";
import type { SqlDatabase, SqlRow, SqlStatement, SqlResult } from "./sql.js";
const requested = "2026-10-02T00:00:00.000Z";
const wake = projectCleanupWake({
  organizationId: "org_test",
  projectId: "project_test",
  recordVersion: 2,
  lifecycleStatus: "deletion-pending",
  deletionRequestedAt: requested,
});
function databaseWith(
  read: (statement: SqlStatement) => readonly SqlRow[],
): SqlDatabase {
  const database: SqlDatabase = {
    query: <T extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<T>> => {
      const rows = read(statement);
      return Promise.resolve({ rows: rows as T[], rowCount: rows.length });
    },
    transaction: async (work) => work(database),
    close: () => Promise.resolve(),
  };
  return database;
}
function recoveryFixture(
  blocker: "export" | "job" | "credit" | "uncertain" | undefined,
  receiptCommit?: "before" | "ambiguous",
) {
  const statements: SqlStatement[] = [];
  let closed = false,
    deleted = false,
    receipt: string | undefined;
  let blocked = blocker !== undefined;
  let bindingVersion = 2;
  const database = databaseWith((statement) => {
    statements.push(statement);
    const text = statement.text;
    if (text.includes("p.record_version,to_char"))
      return [
        {
          lifecycle_status: deleted ? "deleted" : "deletion-pending",
          record_version: deleted ? 3 : 2,
          requested_at: requested,
          deletion_record_version: receipt === undefined ? null : 2,
          receipt_requested_at: receipt === undefined ? null : requested,
          storage_configuration_sha256: receipt ?? null,
        },
      ];
    if (text.includes("SELECT p.lifecycle_status,r.storage"))
      return [
        {
          lifecycle_status: deleted ? "deleted" : "deletion-pending",
          storage_configuration_sha256: receipt ?? null,
        },
      ];
    if (text.includes("SELECT closed_at FROM"))
      return [{ closed_at: closed ? requested : null }];
    if (text.includes("UPDATE project_content_write_scopes")) {
      closed = true;
      return [];
    }
    if (text.includes("SELECT record_version,to_char"))
      return [{ record_version: bindingVersion, requested_at: requested }];
    if (text.includes("AS pending")) {
      expect(text).toContain("solution_export_runs");
      expect(text).toContain("credit_reservations");
      expect(text).toContain("async_jobs");
      expect(text).toContain("project_content_writes");
      return [{ pending: blocked }];
    }
    if (text.includes("AS object_count"))
      return [{ object_count: "0", unsupported: "0" }];
    if (text.includes("SELECT record_version FROM projects"))
      return [{ record_version: 2 }];
    if (text.includes("INSERT INTO project_content_erasure_receipts")) {
      if (receiptCommit === "before") throw Error("Receipt write unavailable");
      receipt = String(statement.values[2]);
      return [];
    }
    if (text.includes("UPDATE projects SET lifecycle_status='deleted'")) {
      deleted = true;
      return [];
    }
    if (
      text.startsWith("INSERT INTO project_content_write_scopes") ||
      text.startsWith("UPDATE projects SET content_cleanup_attempted_at") ||
      text.includes("UPDATE stored_objects SET") ||
      text.includes("UPDATE project_environments SET")
    )
      return [];
    throw Error("Unexpected SQL in recovery fixture");
  });
  const transact = database.transaction.bind(database);
  database.transaction = async (work) => {
    const result = await transact(work);
    if (receiptCommit === "ambiguous" && deleted)
      throw Error("Lost receipt commit response");
    return result;
  };
  const send = vi.fn((command: unknown) => {
    expect(command).toBeInstanceOf(ListObjectVersionsCommand);
    return Promise.resolve({
      Name: (command as ListObjectVersionsCommand).input.Bucket,
      Prefix: (command as ListObjectVersionsCommand).input.Prefix,
      Versions: [],
      DeleteMarkers: [],
      IsTruncated: false,
    });
  });
  const cleanup = createProjectContentCleanup({
    database,
    client: { send } as unknown as S3Client,
    bucket: "synthetic-bucket",
    expectedBucketOwner: "123456789012",
    prefixes: {
      documents: "documents",
      artifacts: "artifacts",
      evidence: "evidence",
    },
  });
  let retained = true;
  const complete = vi.fn(() => {
    retained = false;
    return Promise.resolve();
  });
  const ledger: CleanupWakeLedger = {
    put: () => Promise.resolve(),
    get: () => Promise.resolve(retained ? wake : null),
    page: () => Promise.resolve({ wakes: [] }),
    cursor: () => Promise.resolve(undefined),
    advance: () => Promise.resolve(),
    claim: () => Promise.resolve(true),
    release: () => Promise.resolve(),
    complete,
  };
  const process = createCleanupWakeProcessor({
    enabled: true,
    ledger,
    authority: {
      inspect: cleanup.inspectWake.bind(cleanup),
      process: (current) =>
        cleanup.process({
          organizationId: current.organizationId,
          projectId: current.projectId,
          deletionBinding: current,
        }),
    },
    clock: () => 0,
    token: () => "a".repeat(32),
  });
  return {
    process,
    send,
    complete,
    statements,
    cleanup,
    retained: () => retained,
    reconcile: () => {
      blocked = false;
    },
    changeBindingVersion: (value: number) => {
      bindingVersion = value;
    },
    changeReceipt: (value: string) => {
      receipt = value;
    },
    forceDeleted: () => {
      deleted = true;
    },
  };
}
describe("cleanup wake reuses canonical intent, fence and receipt", () => {
  it("retains evidence after absence verification when the SQL receipt cannot commit", async () => {
    const f = recoveryFixture(undefined, "before");
    expect((await f.process(wake.wakeId)).state).toBe("pending");
    expect(f.send).toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.retained()).toBe(true);
  });
  it("converges an ambiguous receipt commit only through matching SQL readback", async () => {
    const f = recoveryFixture(undefined, "ambiguous");
    expect((await f.process(wake.wakeId)).state).toBe("completed");
    expect(f.complete).toHaveBeenCalledOnce();
    expect(f.retained()).toBe(false);
  });
  it("retains a wake and refuses erasure when the binding changes between inspection and locked admission", async () => {
    const f = recoveryFixture(undefined);
    f.changeBindingVersion(3);
    await expect(f.process(wake.wakeId)).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.retained()).toBe(true);
  });
  it.each(["export"] as const)(
    "retains a blocked %s until canonical reconciliation permits existing erasure",
    async (blocker) => {
      const f = recoveryFixture(blocker);
      expect((await f.process(wake.wakeId)).state).toBe("pending");
      expect(f.send).not.toHaveBeenCalled();
      expect(f.complete).not.toHaveBeenCalled();
      expect(f.retained()).toBe(true);
      expect(
        f.statements.some((statement) =>
          /UPDATE (solution_export_runs|credit_reservations|async_jobs|project_content_writes)/u.test(
            statement.text,
          ),
        ),
      ).toBe(false);
      // The existing owner settles the blocker. The wake worker invents no outcome.
      f.reconcile();
      expect((await f.process(wake.wakeId)).state).toBe("completed");
      expect(f.send).toHaveBeenCalled();
      expect(f.complete).toHaveBeenCalledOnce();
      expect(f.retained()).toBe(false);
    },
  );
  it("retains a wake for a deleted row with missing or incompatible receipt", async () => {
    const f = recoveryFixture(undefined);
    f.forceDeleted();
    expect((await f.process(wake.wakeId)).state).toBe("pending");
    f.changeReceipt("a".repeat(64));
    expect((await f.process(wake.wakeId)).state).toBe("pending");
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("requires exact receipt version and timestamp as well as the current storage digest", async () => {
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          policyVersion: 1,
          bucket: "synthetic-bucket",
          expectedBucketOwner: "123456789012",
          prefixes: [
            { name: "documents", prefix: "documents" },
            { name: "artifacts", prefix: "artifacts" },
            { name: "evidence", prefix: "evidence" },
          ],
        }),
      )
      .digest("hex");
    const row: Record<string, unknown> = {
      lifecycle_status: "deleted",
      record_version: 3,
      requested_at: requested,
      deletion_record_version: 2,
      receipt_requested_at: requested,
      storage_configuration_sha256: digest,
    };
    const send = vi.fn();
    const cleanup = createProjectContentCleanup({
      database: databaseWith(() => [row]),
      client: { send } as unknown as S3Client,
      bucket: "synthetic-bucket",
      expectedBucketOwner: "123456789012",
      prefixes: {
        documents: "documents",
        artifacts: "artifacts",
        evidence: "evidence",
      },
    });
    expect(await cleanup.inspectWake(wake)).toBe("completed");
    row["deletion_record_version"] = 3;
    expect(await cleanup.inspectWake(wake)).toBe("unconfirmed");
    row["deletion_record_version"] = 2;
    row["receipt_requested_at"] = "2026-10-02T00:00:01.000Z";
    expect(await cleanup.inspectWake(wake)).toBe("unconfirmed");
    expect(send).not.toHaveBeenCalled();
  });
});
describe("deletion shadow observer commit boundary", () => {
  function fixture(outcome: "before" | "ambiguous" | "committed") {
    let committed = false;
    const observer = vi.fn(() => {
      expect(committed).toBe(true);
      return Promise.reject(Error("Ledger unavailable"));
    });
    const statements: SqlStatement[] = [];
    const database = databaseWith((statement) => {
      statements.push(statement);
      const text = statement.text;
      if (text.includes("SELECT project_id FROM projects"))
        return [{ project_id: "project_test" }];
      if (text.includes("FROM memberships m"))
        return [{ membership_id: "membership_test", role_key: "owner" }];
      if (text.includes("SELECT request_sha256")) return [];
      if (
        text.includes("UPDATE projects") &&
        text.includes("RETURNING project_id")
      )
        return [
          {
            project_id: "project_test",
            organization_id: "org_test",
            name: "Synthetic",
            description: null,
            lifecycle_status: "deletion-pending",
            record_version: 2,
            current_draft_id: "draft_test",
            latest_revision_id: null,
            deletion_requested_at: requested,
            created_at: requested,
            updated_at: requested,
          },
        ];
      if (
        text.includes("idempotency_records") ||
        text.includes("INSERT INTO audit_events")
      )
        return [];
      throw Error("Unexpected deletion SQL");
    });
    database.transaction = async (work) => {
      if (outcome === "before") throw Error("Unavailable before commit");
      const result = await work(database);
      committed = true;
      if (outcome === "ambiguous") throw Error("Lost commit response");
      return result;
    };
    const repository = new PostgresCloudMarkupRepository(database, {
      onProjectDeletionCommitted: observer,
    });
    const run = () =>
      repository.deleteProject(
        {
          organizationId: "org_test",
          principalId: "principal_test",
          membershipId: "membership_test",
          sessionId: "session_test",
          correlationId: "correlation_test",
          roleKey: "owner",
          capabilities: permissionsForRole("owner"),
        },
        {
          projectId: "project_test",
          expectedRecordVersion: 1,
          idempotencyKey: "synthetic-idempotency-key",
          requestSha256: "a".repeat(64),
        },
      );
    return { run, observer, statements };
  }
  it.each(["before", "ambiguous"] as const)(
    "does not publish on %s commit outcomes or replay SQL",
    async (outcome) => {
      const f = fixture(outcome);
      await expect(f.run()).rejects.toThrow();
      expect(f.observer).not.toHaveBeenCalled();
      expect(
        f.statements.filter((statement) =>
          statement.text.includes("RETURNING project_id"),
        ).length,
      ).toBe(outcome === "before" ? 0 : 1);
    },
  );
  it("preserves a confirmed deletion result when publication is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const f = fixture("committed");
      expect((await f.run()).lifecycleStatus).toBe("deletion-pending");
      expect(f.observer).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        JSON.stringify({
          component: "project-cleanup-wake",
          outcome: "notification-unavailable",
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
