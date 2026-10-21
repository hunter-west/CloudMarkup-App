import type {
  JobAuditPort,
  JobAuditOutboxEntryV1,
} from "@cloudmarkup/job-framework";
import { asyncJobTrustedOwnershipV1Schema } from "@cloudmarkup/schemas";
import {
  exportRunEqual,
  exportRunText,
  exportRunUnavailable,
} from "./adapters/persistence/solution-export-run-codec.js";
import { sql, type SqlDatabase } from "./adapters/persistence/sql.js";

/** Projects committed metadata only; source payloads never become audit text. */
export class ProductionSolutionExportAudit implements JobAuditPort {
  readonly #database: SqlDatabase;
  readonly #family: "solution-export-orchestration" | "architecture-proposal";
  readonly #ownership: {
    readonly organizationId: string;
    readonly projectId: string;
  };
  constructor(
    database: SqlDatabase,
    ownership: { readonly organizationId: string; readonly projectId: string },
    family:
      | "solution-export-orchestration"
      | "architecture-proposal" = "solution-export-orchestration",
  ) {
    this.#database = database;
    if (
      !["solution-export-orchestration", "architecture-proposal"].includes(
        family,
      )
    )
      exportRunUnavailable();
    this.#family = family;
    const parsed = asyncJobTrustedOwnershipV1Schema.parse(ownership);
    if (parsed.projectId === undefined) exportRunUnavailable();
    this.#ownership = Object.freeze({
      organizationId: parsed.organizationId,
      projectId: parsed.projectId,
    });
  }
  async append(entry: JobAuditOutboxEntryV1): Promise<void> {
    if (!exportRunEqual(entry.event.ownership, this.#ownership))
      exportRunUnavailable();
    await this.project(entry.kind, entry.event.eventId);
  }
  async project(
    kind: JobAuditOutboxEntryV1["kind"],
    eventId: string,
  ): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(eventId))
      exportRunUnavailable();
    await this.#database.transaction(async (tx) => {
      const source = await tx.query(
        sql(
          kind === "job"
            ? `SELECT e.actor_principal_id,e.event_kind,e.correlation_id,e.job_id AS target_id,
          'job' AS target_kind,to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at
        FROM async_job_events e JOIN async_jobs j ON j.organization_id=e.organization_id AND j.job_id=e.job_id
        WHERE e.organization_id=$1 AND j.project_id=$2 AND e.event_id=$3
          AND j.family='${this.#family}' AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL`
            : `SELECT e.actor_principal_id,e.event_kind,e.correlation_id,e.project_id AS target_id,
          'project' AS target_kind,to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at
        FROM async_job_creation_claim_events e JOIN async_job_creation_claims c ON c.organization_id=e.organization_id
          AND c.project_id=e.project_id AND c.operation_id=e.operation_id AND c.idempotency_key_sha256=e.idempotency_key_sha256
        WHERE e.organization_id=$1 AND e.project_id=$2 AND e.creation_event_id=$3
          AND c.family='${this.#family}'`,
          [this.#ownership.organizationId, this.#ownership.projectId, eventId],
        ),
      );
      const row = source.rows[0];
      if (source.rows.length !== 1 || row === undefined) exportRunUnavailable();
      const eventKind = exportRunText(row["event_kind"]);
      const outcome = eventKind.includes("denied")
        ? "denied"
        : eventKind === "job-failed"
          ? "failed"
          : "succeeded";
      const values = [
        eventId,
        this.#ownership.organizationId,
        row["actor_principal_id"] === null
          ? null
          : exportRunText(row["actor_principal_id"]),
        (this.#family === "architecture-proposal"
          ? "beta-proposal."
          : "solution-export.") + eventKind,
        exportRunText(row["target_kind"]),
        exportRunText(row["target_id"]),
        outcome,
        this.#family === "architecture-proposal"
          ? "An AI diagram proposal lifecycle event was recorded."
          : "An immutable solution export lifecycle event was recorded.",
        exportRunText(row["correlation_id"]),
        exportRunText(row["occurred_at"]),
      ];
      const inserted = await tx.query(
        sql(
          `INSERT INTO audit_events(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id,occurred_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz) ON CONFLICT DO NOTHING`,
          values,
        ),
      );
      if (inserted.rowCount !== 0 && inserted.rowCount !== 1)
        exportRunUnavailable();
      const table =
        kind === "job"
          ? "async_job_event_delivery_receipts"
          : "async_job_creation_claim_event_delivery_receipts";
      const key = kind === "job" ? "event_id" : "creation_event_id";
      if (inserted.rowCount === 0) {
        // Both records are immutable. This component commits the audit row and
        // receipt in one transaction, so an exact source-owned receipt proves
        // an earlier completed projection. A bare audit ID collision fails.
        const delivered = await tx.query(
          sql(
            `SELECT ${key} FROM ${table} WHERE ${key}=$1 AND organization_id=$2`,
            [eventId, this.#ownership.organizationId],
          ),
        );
        if (delivered.rows.length !== 1) exportRunUnavailable();
        return;
      }
      await tx.query(
        sql(
          `INSERT INTO ${table}(${key},organization_id,project_id,published_at) VALUES($1,$2,$3,clock_timestamp()) ON CONFLICT(${key}) DO NOTHING`,
          [eventId, this.#ownership.organizationId, this.#ownership.projectId],
        ),
      );
    });
  }
  async flush(): Promise<void> {
    const rows = await this.#database.query(
      sql(
        `SELECT e.event_id,'job' AS kind FROM async_job_events e
      JOIN async_jobs j ON j.organization_id=e.organization_id AND j.job_id=e.job_id
      WHERE e.organization_id=$1 AND j.project_id=$2 AND j.family='${this.#family}'
        AND NOT EXISTS(SELECT 1 FROM async_job_event_delivery_receipts r WHERE r.organization_id=e.organization_id AND r.event_id=e.event_id)
      UNION ALL SELECT e.creation_event_id AS event_id,'creation-claim' AS kind FROM async_job_creation_claim_events e
      JOIN async_job_creation_claims c ON c.organization_id=e.organization_id AND c.project_id=e.project_id
        AND c.operation_id=e.operation_id AND c.idempotency_key_sha256=e.idempotency_key_sha256
      WHERE e.organization_id=$1 AND e.project_id=$2 AND c.family='${this.#family}'
        AND NOT EXISTS(SELECT 1 FROM async_job_creation_claim_event_delivery_receipts r WHERE r.organization_id=e.organization_id AND r.creation_event_id=e.creation_event_id)
      ORDER BY event_id LIMIT 100`,
        [this.#ownership.organizationId, this.#ownership.projectId],
      ),
    );
    for (const row of rows.rows) {
      const kind = row["kind"];
      if (kind !== "job" && kind !== "creation-claim") exportRunUnavailable();
      await this.project(kind, exportRunText(row["event_id"]));
    }
  }
}
