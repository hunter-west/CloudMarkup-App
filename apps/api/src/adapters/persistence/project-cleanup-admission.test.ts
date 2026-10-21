import { describe, expect, it, vi } from "vitest";
import { permissionsForRole } from "../../application/authorization.js";
import {
  createAdmissionCleanupWakeAuthority,
  createCleanupWakeProcessor,
  parseProjectCleanupWake,
  projectCleanupAdmissionWake,
  type CleanupWakeLedger,
  type ProjectCleanupAdmissionWake,
  type ProjectCleanupWake,
} from "../../application/project-cleanup-wake.js";
import { PostgresCleanupAdmissionJournal } from "./project-cleanup-admission.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

const requested = "2026-10-03T00:00:00.000Z";
const scope = {
  organizationId: "org_test",
  projectId: "project_test",
  principalId: "principal_test",
  membershipId: "membership_test",
  sessionId: "session_test",
  correlationId: "correlation_test",
  roleKey: "owner",
  capabilities: permissionsForRole("owner"),
};
const request = {
  projectId: scope.projectId,
  expectedRecordVersion: 1,
  idempotencyKey: "synthetic-deletion-key",
  requestSha256: "a".repeat(64),
};
interface Admission {
  wake: ProjectCleanupAdmissionWake;
  state: "prepared" | "committed" | "aborted";
  request: string;
  key: string;
}
/** Transactional simulation only. Genuine PostgreSQL lock/trigger proof is a
 * separate coordinator gate; no live database or cloud target is used here. */
function fixture() {
  let now = Date.parse(requested);
  let authorized = true;
  let committed = {
    admission: undefined as Admission | undefined,
    idempotency: false,
    project: {
      project_id: scope.projectId,
      organization_id: scope.organizationId,
      name: "Synthetic",
      description: null,
      lifecycle_status: "active",
      record_version: 1,
      current_draft_id: "draft_test",
      latest_revision_id: null,
      deletion_requested_at: null as string | null,
      created_at: requested,
      updated_at: requested,
    },
  };
  let failure: "before" | "ambiguous" | undefined;
  let tail = Promise.resolve();
  const statements: SqlStatement[] = [];
  function execute(
    current: typeof committed,
    statement: SqlStatement,
  ): readonly SqlRow[] {
    statements.push(statement);
    const { text, values: v } = statement;
    if (text.includes("FROM memberships m"))
      return authorized
        ? [{ membership_id: scope.membershipId, role_key: "owner" }]
        : [];
    if (text.includes("SELECT project_id FROM projects"))
      return v[0] === scope.organizationId && v[1] === scope.projectId
        ? [{ project_id: scope.projectId }]
        : [];
    if (
      text.includes("FROM project_cleanup_admissions") &&
      text.includes("request_sha256")
    ) {
      const a = current.admission;
      return a === undefined || a.key !== v[2]
        ? []
        : [
            {
              wake_binding: JSON.stringify(a.wake),
              lifecycle_status: a.state,
              request_sha256: a.request,
              project_id: scope.projectId,
              expected_record_version: 1,
            },
          ];
    }
    if (text.includes("SELECT record_version,lifecycle_status"))
      return [{ ...current.project, requested_at: requested }];
    if (text.includes("INSERT INTO project_cleanup_admissions")) {
      const wake = parseProjectCleanupWake(JSON.parse(String(v[7])) as unknown);
      if (wake.schemaVersion !== 2) throw Error("Expected admission");
      current.admission = {
        wake,
        state: "prepared",
        request: String(v[5]),
        key: String(v[4]),
      };
      return [{ admission_id: wake.admissionId }];
    }
    if (
      text.includes("FROM project_cleanup_admissions") &&
      text.includes("AS expired")
    ) {
      const a = current.admission;
      return a === undefined ||
        a.wake.admissionId !== v[0] ||
        a.wake.organizationId !== v[1] ||
        a.wake.projectId !== v[2]
        ? []
        : [
            {
              wake_binding: JSON.stringify(a.wake),
              lifecycle_status: a.state,
              expired: now >= Date.parse(a.wake.admissionDeadline),
            },
          ];
    }
    if (text.includes("UPDATE project_cleanup_admissions")) {
      const a = current.admission;
      if (a?.state !== "prepared" || JSON.stringify(a.wake) !== v[1]) return [];
      a.state = text.includes("lifecycle_status='aborted'")
        ? "aborted"
        : "committed";
      return [{ admission_id: a.wake.admissionId }];
    }
    if (text.includes("SELECT request_sha256"))
      return current.idempotency
        ? [
            {
              request_sha256: request.requestSha256,
              resource_id: scope.projectId,
            },
          ]
        : [];
    if (text.includes("INSERT INTO idempotency_records")) {
      current.idempotency = true;
      return [];
    }
    if (
      text.includes("UPDATE projects") &&
      text.includes("RETURNING project_id")
    ) {
      if (
        current.project.record_version !== v[3] ||
        current.project.lifecycle_status === "deletion-pending"
      )
        return [];
      current.project = {
        ...current.project,
        lifecycle_status: "deletion-pending",
        record_version: 2,
        deletion_requested_at: String(v[5]),
      };
      return [current.project];
    }
    if (
      text.includes("FROM projects") &&
      text.includes("SELECT project_id, organization_id")
    )
      return [current.project];
    if (
      text.includes("UPDATE idempotency_records") ||
      text.includes("INSERT INTO audit_events")
    )
      return [];
    throw Error("Unexpected admission SQL");
  }
  const database: SqlDatabase = {
    query: <T extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<T>> => {
      const rows = execute(committed, statement) as T[];
      return Promise.resolve({ rows, rowCount: rows.length });
    },
    async transaction(work) {
      const previous = tail;
      let release: () => void = () => {
        throw Error("Transaction release was not initialized");
      };
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        const current = structuredClone(committed);
        const tx: SqlExecutor = {
          query: <T extends SqlRow>(
            statement: SqlStatement,
          ): Promise<SqlResult<T>> => {
            const rows = execute(current, statement) as T[];
            return Promise.resolve({ rows, rowCount: rows.length });
          },
        };
        const result = await work(tx);
        const outcome = failure;
        failure = undefined;
        if (outcome === "before") throw Error("Before commit");
        committed = current;
        if (outcome === "ambiguous") throw Error("Lost commit response");
        return result;
      } finally {
        release();
      }
    },
    close: () => Promise.resolve(),
  };
  const wakes = new Map<string, ProjectCleanupWake>();
  const ledger: CleanupWakeLedger = {
    put: (wake) => {
      wakes.set(wake.wakeId, wake);
      return Promise.resolve();
    },
    get: (id) => Promise.resolve(wakes.get(id) ?? null),
    page: () => Promise.resolve({ wakes: [...wakes.values()] }),
    cursor: () => Promise.resolve(undefined),
    advance: () => Promise.resolve(),
    claim: () => Promise.resolve(true),
    release: () => Promise.resolve(),
    complete: (wake) => {
      wakes.delete(wake.wakeId);
      return Promise.resolve();
    },
  };
  const publisher = { send: vi.fn().mockResolvedValue(undefined) };
  const repository = new PostgresCloudMarkupRepository(database, {
    cleanupWakeAdmission: { ledger, publisher },
  });
  const journal = new PostgresCleanupAdmissionJournal(database);
  const cleanup = {
    inspect: vi.fn().mockResolvedValue("pending"),
    process: vi.fn().mockResolvedValue({ state: "pending" }),
  };
  const authority = createAdmissionCleanupWakeAuthority({
    resolve: (wake) => journal.resolve(wake),
    cleanup,
  });
  const process = createCleanupWakeProcessor({
    enabled: true,
    ledger,
    authority,
    clock: () => now,
    token: () => "b".repeat(32),
  });
  return {
    database,
    ledger,
    wakes,
    publisher,
    repository,
    journal,
    cleanup,
    process,
    statements,
    run: () => repository.deleteProject(scope, request),
    state: () => committed,
    admission: () => {
      if (committed.admission === undefined) throw Error("Admission missing");
      return committed.admission;
    },
    expire: () => {
      now += 60_000;
    },
    deny: () => {
      authorized = false;
    },
    failCommit: (outcome: "before" | "ambiguous") => {
      failure = outcome;
    },
  };
}

describe("durable deletion admission on transactional synthetic ports", () => {
  it("publishes and proves a durable wake before the atomic deletion/journal commit", async () => {
    const f = fixture();
    const original = f.ledger.put.bind(f.ledger);
    f.ledger.put = async (wake) => {
      expect(f.state().project.lifecycle_status).toBe("active");
      expect(f.state().admission?.state).toBe("prepared");
      await original(wake);
    };
    expect((await f.run()).lifecycleStatus).toBe("deletion-pending");
    expect(f.state().admission?.state).toBe("committed");
    expect(f.wakes.size).toBe(1);
    expect(f.state().project.deletion_requested_at).toBe(
      f.state().admission?.wake.deletionRequestedAt,
    );
    f.ledger.put = original;
    const replay = await f.run();
    expect(replay.recordVersion).toBe(2);
    expect(f.wakes.size).toBe(1);
  });
  it.each(["put", "readback"] as const)(
    "fails closed when durable %s cannot be proved",
    async (stage) => {
      const f = fixture();
      if (stage === "put")
        f.ledger.put = () => Promise.reject(Error("Unavailable"));
      else f.ledger.get = () => Promise.resolve(null);
      await expect(f.run()).rejects.toMatchObject({
        code: "persistence-unavailable",
      });
      expect(f.state().project.lifecycle_status).toBe("active");
      expect(f.state().admission?.state).toBe("prepared");
      expect(f.publisher.send).not.toHaveBeenCalled();
    },
  );
  it("retains early PREPARED wakes and never invokes erasure", async () => {
    const f = fixture();
    const put = f.ledger.put.bind(f.ledger);
    f.ledger.put = async (wake) => {
      await put(wake);
      expect((await f.process(wake.wakeId)).state).toBe("pending");
      expect(f.cleanup.process).not.toHaveBeenCalled();
      expect(f.wakes.has(wake.wakeId)).toBe(true);
    };
    await f.run();
  });
  it("recovers a lost queue kick from retained committed intent", async () => {
    const f = fixture();
    f.publisher.send.mockRejectedValue(Error("Queue unavailable"));
    expect((await f.run()).lifecycleStatus).toBe("deletion-pending");
    const wake = f.admission().wake;
    expect((await f.process(wake.wakeId)).state).toBe("pending");
    expect(f.cleanup.process).toHaveBeenCalledOnce();
    expect(f.wakes.has(wake.wakeId)).toBe(true);
  });
  it.each(["before", "ambiguous"] as const)(
    "retains wake after %s deletion commit outcome without replay",
    async (outcome) => {
      const f = fixture();
      const put = f.ledger.put.bind(f.ledger);
      f.ledger.put = async (wake) => {
        await put(wake);
        f.failCommit(outcome);
      };
      await expect(f.run()).rejects.toThrow();
      expect(f.wakes.size).toBe(1);
      expect(f.publisher.send).not.toHaveBeenCalled();
      expect(f.state().admission?.state).toBe(
        outcome === "before" ? "prepared" : "committed",
      );
      expect(
        f.statements.filter(
          (s) =>
            s.text.includes("UPDATE projects") &&
            s.text.includes("RETURNING project_id"),
        ),
      ).toHaveLength(1);
    },
  );
  it("seals expired admission under the same locks before clearing a wake and rejects late commit", async () => {
    const f = fixture();
    const put = f.ledger.put.bind(f.ledger);
    f.ledger.put = async (wake) => {
      await put(wake);
      f.expire();
      expect((await f.process(wake.wakeId)).state).toBe("aborted");
    };
    await expect(f.run()).rejects.toThrow();
    expect(f.state().admission?.state).toBe("aborted");
    expect(f.state().project.lifecycle_status).toBe("active");
    expect(f.wakes.size).toBe(0);
    expect(f.cleanup.process).not.toHaveBeenCalled();
    await expect(f.run()).rejects.toThrow();
  });
  it("cannot remove a wake after ambiguous abort until persisted ABORTED is read again", async () => {
    const f = fixture();
    const put = f.ledger.put.bind(f.ledger);
    f.ledger.put = async (wake) => {
      await put(wake);
      f.failCommit("before");
    };
    await expect(f.run()).rejects.toThrow();
    const wake = f.admission().wake;
    f.expire();
    f.failCommit("ambiguous");
    await expect(f.process(wake.wakeId)).rejects.toThrow();
    expect(f.state().admission?.state).toBe("aborted");
    expect(f.wakes.size).toBe(1);
    expect((await f.process(wake.wakeId)).state).toBe("aborted");
    expect(f.wakes.size).toBe(0);
  });
  it("retains a committed wake after expiry; time never cancels real deletion", async () => {
    const f = fixture();
    await f.run();
    f.expire();
    expect((await f.process(f.admission().wake.wakeId)).state).toBe("pending");
    expect(f.state().admission?.state).toBe("committed");
    expect(f.wakes.size).toBe(1);
  });
  it("rechecks current authorization after publication and rolls back deletion on revocation", async () => {
    const f = fixture();
    const put = f.ledger.put.bind(f.ledger);
    f.ledger.put = async (wake) => {
      await put(wake);
      f.deny();
    };
    await expect(f.run()).rejects.toThrow();
    expect(f.state().project.lifecycle_status).toBe("active");
    expect(f.wakes.size).toBe(1);
  });
  it("denies initial unauthorized admission before any wake publication", async () => {
    const f = fixture();
    f.deny();
    await expect(f.run()).rejects.toThrow();
    expect(f.state().admission).toBeUndefined();
    expect(f.wakes.size).toBe(0);
  });
  it("denies a project under a different tenant before publishing a wake", async () => {
    const f = fixture();
    await expect(
      f.repository.deleteProject(
        { ...scope, organizationId: "org_other" },
        request,
      ),
    ).rejects.toThrow();
    expect(f.state().admission).toBeUndefined();
    expect(f.wakes.size).toBe(0);
  });
  it("rejects durable readback for a different valid binding", async () => {
    const f = fixture();
    f.ledger.get = () =>
      Promise.resolve(
        projectCleanupAdmissionWake({
          organizationId: scope.organizationId,
          projectId: "project_other",
          recordVersion: 2,
          deletionRequestedAt: requested,
          admissionDeadline: "2026-10-03T00:01:00.000Z",
          admissionId: "c".repeat(64),
        }),
      );
    await expect(f.run()).rejects.toThrow();
    expect(f.state().project.lifecycle_status).toBe("active");
    expect(f.publisher.send).not.toHaveBeenCalled();
  });
  it("rejects changed idempotency request binding", async () => {
    const f = fixture();
    await f.run();
    await expect(
      f.repository.deleteProject(scope, {
        ...request,
        requestSha256: "c".repeat(64),
      }),
    ).rejects.toThrow();
    expect(f.wakes.size).toBe(1);
  });
  it("does not reinterpret a legacy deletion as a committed prepared admission", async () => {
    const f = fixture();
    const put = f.ledger.put.bind(f.ledger);
    f.ledger.put = async (wake) => {
      await put(wake);
      f.state().idempotency = true;
      f.state().project.lifecycle_status = "deletion-pending";
      f.state().project.record_version = 2;
      f.state().project.deletion_requested_at = "2026-10-03T00:00:01.000Z";
    };
    await expect(f.run()).rejects.toMatchObject({
      code: "idempotency-conflict",
    });
    expect(f.admission().state).toBe("prepared");
    expect(f.wakes.size).toBe(1);
  });
  it("rejects replay when canonical deletion binding differs from committed admission", async () => {
    const f = fixture();
    await f.run();
    f.state().project.deletion_requested_at = "2026-10-03T00:00:01.000Z";
    await expect(f.run()).rejects.toMatchObject({
      code: "idempotency-conflict",
    });
    expect(f.wakes.size).toBe(1);
  });
  it("retains a wake when the admission row is missing or its immutable binding differs", async () => {
    const f = fixture();
    await f.run();
    const wake = f.admission().wake;
    const binding = {
      organizationId: wake.organizationId,
      projectId: wake.projectId,
      recordVersion: wake.recordVersion,
      deletionRequestedAt: wake.deletionRequestedAt,
      admissionId: wake.admissionId,
      admissionDeadline: wake.admissionDeadline,
    };
    const other = projectCleanupAdmissionWake({
      ...binding,
      admissionId: "c".repeat(64),
    });
    expect(await f.journal.resolve(other)).toBe("unconfirmed");
    const changed = projectCleanupAdmissionWake({
      ...binding,
      admissionDeadline: "2026-10-03T00:02:00.000Z",
    });
    await expect(f.journal.resolve(changed)).rejects.toThrow();
    expect(f.wakes.size).toBe(1);
  });
  it("simulated concurrent retries converge on one admission and one lifecycle update", async () => {
    const f = fixture();
    const results = await Promise.all([f.run(), f.run()]);
    expect(results.map((r) => r.recordVersion)).toEqual([2, 2]);
    expect(f.wakes.size).toBe(1);
    expect(
      f.statements.filter(
        (s) =>
          s.text.includes("UPDATE projects") &&
          s.text.includes("RETURNING project_id"),
      ),
    ).toHaveLength(1);
  });
});
