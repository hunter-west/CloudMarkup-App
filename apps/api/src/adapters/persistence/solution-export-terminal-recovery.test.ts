import { describe, expect, it, vi } from "vitest";
import { asyncJobTrustedContextV1Schema } from "@cloudmarkup/schemas";
import { InMemoryObjectStore } from "./memory-object-store.js";
import { PostgresSolutionExportTerminalRecovery } from "./solution-export-terminal-recovery.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

const context = asyncJobTrustedContextV1Schema.parse({
  actor: { kind: "system", reason: "orphan-reconciler" },
  correlationId: "correlation.recovery",
  ownership: { organizationId: "org.recovery", projectId: "project.recovery" },
});
function fixture() {
  const query = vi.fn<(statement: SqlStatement) => void>();
  const executor: SqlExecutor = {
    query<TRow extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      query(statement);
      return Promise.resolve({ rowCount: 0, rows: [] });
    },
  };
  const database: SqlDatabase = {
    query: <TRow extends SqlRow>(statement: SqlStatement) =>
      executor.query<TRow>(statement),
    transaction: (work) => work(executor),
    close: () => Promise.resolve(),
  };
  const objects = new InMemoryObjectStore();
  const open = vi.spyOn(objects, "open");
  return {
    query,
    open,
    recovery: new PostgresSolutionExportTerminalRecovery(database, objects),
  };
}
describe("exact-scope export terminal recovery", () => {
  it("filters exact ownership, canonical actor, committed root and current snapshot before a bounded limit", async () => {
    const h = fixture();
    expect(await h.recovery.list(context, 1)).toEqual([]);
    const statement = h.query.mock.calls[0]?.[0];
    expect(statement?.values).toEqual([
      "org.recovery",
      "project.recovery",
      null,
      1,
    ]);
    expect(statement?.text).toContain(
      "j.organization_id=$1 AND j.project_id=$2",
    );
    expect(statement?.text).toContain(
      "r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)",
    );
    expect(statement?.text).toContain("'exports.run'=ANY(r.capabilities)");
    expect(statement?.text).toContain("s.record_version=j.record_version");
    expect(statement?.text).toContain("a.worker_reference IS NOT NULL");
    expect(statement?.text).toContain("a.completed_at=j.completed_at");
    expect(statement?.text).toContain("o.size_bytes BETWEEN 0 AND 4194304");
    expect(statement?.text).toContain(
      "ORDER BY j.completed_at,j.job_id LIMIT $4",
    );
    expect(h.open).not.toHaveBeenCalled();
  });
  it.each([0, 101, 1.5, Number.NaN])(
    "rejects invalid limit %s before SQL",
    async (limit) => {
      const h = fixture();
      await expect(h.recovery.list(context, limit)).rejects.toMatchObject({
        code: "invalid_request",
      });
      expect(h.query).not.toHaveBeenCalled();
    },
  );
  it.each([
    { kind: "principal", actorId: "principal.example" },
    { kind: "worker", workerId: "worker.example" },
    { kind: "system", reason: "scheduler" },
    { kind: "system", reason: "retention" },
  ])(
    "rejects other trusted actor kinds before discovery or recovery: %j",
    async (actor) => {
      const h = fixture();
      const denied = asyncJobTrustedContextV1Schema.parse({
        ...context,
        actor,
      });
      await expect(h.recovery.list(denied)).rejects.toMatchObject({
        code: "access_denied",
      });
      await expect(
        h.recovery.recover(denied, "job.example"),
      ).rejects.toMatchObject({ code: "access_denied" });
      expect(h.query).not.toHaveBeenCalled();
    },
  );
  it("rejects tenant-only context without an exact project", async () => {
    const h = fixture();
    const denied = asyncJobTrustedContextV1Schema.parse({
      ...context,
      ownership: { organizationId: "org.recovery" },
    });
    await expect(h.recovery.list(denied)).rejects.toMatchObject({
      code: "access_denied",
    });
    expect(h.query).not.toHaveBeenCalled();
  });
  it("does not fetch bytes or fabricate a record for unavailable terminal identity", async () => {
    const h = fixture();
    await expect(
      h.recovery.recover(context, "job.example"),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(h.query.mock.calls[0]?.[0].values).toEqual([
      "org.recovery",
      "project.recovery",
      "job.example",
      1,
    ]);
    expect(h.open).not.toHaveBeenCalled();
  });
  it("rejects malformed selectors before SQL", async () => {
    const h = fixture();
    await expect(h.recovery.recover(context, "../foreign")).rejects.toThrow();
    expect(h.query).not.toHaveBeenCalled();
  });
});
