import { describe, expect, it } from "vitest";
import type { JobAuditOutboxEntryV1 } from "@cloudmarkup/job-framework";
import type {
  SqlDatabase,
  SqlRow,
  SqlResult,
  SqlStatement,
} from "./adapters/persistence/sql.js";
import { ProductionSolutionExportAudit } from "./production-solution-export-audit.js";
const ownership = {
  organizationId: "org.synthetic",
  projectId: "project.synthetic",
};
function fixture(options: { missing?: boolean; collision?: boolean } = {}) {
  const statements: SqlStatement[] = [];
  let auditExists = options.collision === true;
  let delivered = false;
  const database: SqlDatabase = {
    close: () => Promise.resolve(),
    transaction: (work) => work(database),
    query: <TRow extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> => {
      statements.push(statement);
      const rows: SqlRow[] = statement.text.startsWith(
        "SELECT e.actor_principal_id",
      )
        ? options.missing
          ? []
          : [
              {
                actor_principal_id: null,
                event_kind: "job-failed",
                correlation_id: "corr.synthetic",
                target_id: "job.synthetic",
                target_kind: "job",
                occurred_at: "2026-09-12T12:00:00.000Z",
              },
            ]
        : statement.text.startsWith(
              "SELECT event_id FROM async_job_event_delivery_receipts",
            ) ||
            statement.text.startsWith(
              "SELECT creation_event_id FROM async_job_creation_claim_event_delivery_receipts",
            )
          ? delivered
            ? [{ event_id: "audit.synthetic" }]
            : []
          : [];
      if (statement.text.startsWith("INSERT INTO audit_events")) {
        if (auditExists) return Promise.resolve({ rows: [], rowCount: 0 });
        auditExists = true;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (
        statement.text.startsWith(
          "INSERT INTO async_job_event_delivery_receipts",
        ) ||
        statement.text.startsWith(
          "INSERT INTO async_job_creation_claim_event_delivery_receipts",
        )
      ) {
        delivered = true;
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: rows as TRow[], rowCount: rows.length });
    },
  };
  return {
    statements,
    audit: new ProductionSolutionExportAudit(database, ownership),
  };
}
describe("production export audit projection", () => {
  it("projects only existing canonical event metadata and records idempotent delivery", async () => {
    const f = fixture();
    await f.audit.project("job", "audit.synthetic");
    expect(f.statements[0]?.values).toEqual([
      "org.synthetic",
      "project.synthetic",
      "audit.synthetic",
    ]);
    expect(f.statements[0]?.text).toContain(
      "j.family='solution-export-orchestration'",
    );
    expect(f.statements[1]?.values).toContain("solution-export.job-failed");
    expect(f.statements[1]?.text).toContain("ON CONFLICT DO NOTHING");
    expect(f.statements[1]?.values).toContain("failed");
    expect(f.statements[1]?.values).toContain(
      "An immutable solution export lifecycle event was recorded.",
    );
    expect(f.statements[2]?.text).toContain(
      "INSERT INTO async_job_event_delivery_receipts",
    );
    expect(
      f.statements.some((statement) =>
        statement.text.includes("FROM audit_events"),
      ),
    ).toBe(false);
    await f.audit.project("job", "audit.synthetic");
    expect(f.statements[5]?.text).toContain(
      "SELECT event_id FROM async_job_event_delivery_receipts",
    );
    expect(f.statements).toHaveLength(6);
  });
  it("does not mark a colliding downstream identity delivered", async () => {
    const f = fixture({ collision: true });
    await expect(
      f.audit.project("job", "audit.synthetic"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(f.statements).toHaveLength(3);
  });
  it("replays creation-claim audit delivery through its exact immutable receipt", async () => {
    const f = fixture();
    await f.audit.project("creation-claim", "audit.synthetic");
    await f.audit.project("creation-claim", "audit.synthetic");
    expect(f.statements[2]?.text).toContain(
      "INSERT INTO async_job_creation_claim_event_delivery_receipts",
    );
    expect(f.statements[5]?.text).toContain(
      "SELECT creation_event_id FROM async_job_creation_claim_event_delivery_receipts",
    );
    expect(f.statements).toHaveLength(6);
  });
  it("cannot project an absent or cross-project canonical event", async () => {
    const f = fixture({ missing: true });
    await expect(
      f.audit.project("job", "audit.synthetic"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(f.statements).toHaveLength(1);
  });
  it("rejects a different tenant before SQL", async () => {
    const f = fixture();
    await expect(
      f.audit.append({
        kind: "job",
        event: { ownership: { ...ownership, organizationId: "org.other" } },
      } as JobAuditOutboxEntryV1),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(f.statements).toHaveLength(0);
  });
});
