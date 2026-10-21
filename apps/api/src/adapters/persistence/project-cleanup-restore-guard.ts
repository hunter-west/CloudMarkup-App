import {
  readCompleteCleanupHistory,
  cleanupHistoryId,
  type CleanupHistoryRecord,
  type CleanupHistoryPort,
} from "../../application/project-cleanup-history.js";
import type { CleanupDatabaseIncarnationPort } from "./project-cleanup-incarnation.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
/** Retained external terminal history is checked before and after EVERY SQL
 * operation, including warm hosts. An older SQL snapshot cannot serve resurrected
 * project data or abort a committed deletion. Empty idle wake dispatch does no SQL.
 * Overflow/incomplete history or changed table incarnation fail closed. */
export class CleanupHistoryBoundDatabase implements SqlDatabase {
  readonly database: SqlDatabase;
  readonly history: CleanupHistoryPort;
  readonly assertSchema: (tx: SqlExecutor) => Promise<void>;
  readonly incarnation: CleanupDatabaseIncarnationPort;
  constructor(input: {
    database: SqlDatabase;
    history: CleanupHistoryPort;
    assertSchema: (tx: SqlExecutor) => Promise<void>;
    incarnation: CleanupDatabaseIncarnationPort;
  }) {
    Object.assign(this, input);
    this.database = input.database;
    this.history = input.history;
    this.assertSchema = input.assertSchema;
    this.incarnation = input.incarnation;
  }
  verify(tx: SqlExecutor, records: readonly CleanupHistoryRecord[]) {
    return this.#verify(tx, records, "ready");
  }
  /** Operator metadata audit only: this never permits runtime access. */
  verifyFrozenRestoreMetadata(
    tx: SqlExecutor,
    records: readonly CleanupHistoryRecord[],
  ) {
    return this.#verify(tx, records, "restoring");
  }
  async #verify(
    tx: SqlExecutor,
    records: readonly CleanupHistoryRecord[],
    expectedStatus: "ready" | "restoring",
  ) {
    await this.assertSchema(tx);
    const control = await tx.query(
      sql(
        "SELECT history_required,restore_status FROM project_cleanup_controls WHERE control_id='beta' FOR SHARE",
      ),
    );
    if (
      control.rows.length !== 1 ||
      control.rows[0]?.["history_required"] !== true ||
      control.rows[0]["restore_status"] !== expectedStatus
    )
      throw Error("Cleanup restore is quarantined.");
    for (const r of records) {
      const e = r.envelope;
      if (e.kind !== "write") {
        const w = e.wake;
        const p = await tx.query(
          sql(
            `SELECT p.lifecycle_status,p.record_version,to_char(p.deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_at,
          r.deletion_record_version,to_char(r.deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS receipt_requested_at
          FROM projects p LEFT JOIN project_content_erasure_receipts r USING(organization_id,project_id)
          WHERE p.organization_id=$1 AND p.project_id=$2 FOR SHARE OF p`,
            [w.organizationId, w.projectId],
          ),
        );
        const row = p.rows[0];
        if (p.rows.length !== 1 || row === undefined)
          throw Error("Deletion lineage is missing after restore.");
        if (e.kind === "admission") {
          const admission = await tx.query(
            sql(
              "SELECT lifecycle_status,wake_binding,principal_id,idempotency_key_sha256,request_sha256,expected_record_version FROM project_cleanup_admissions WHERE admission_id=$1",
              [e.wake.admissionId],
            ),
          );
          const a = admission.rows[0];
          if (
            admission.rows.length !== 1 ||
            a?.["wake_binding"] !== JSON.stringify(w) ||
            a["principal_id"] !== e.principalId ||
            a["idempotency_key_sha256"] !== e.idempotencyKeySha256 ||
            a["request_sha256"] !== e.requestSha256 ||
            Number(a["expected_record_version"]) !== e.expectedRecordVersion ||
            (r.state !== "prepared" && a["lifecycle_status"] !== r.state)
          )
            throw Error(
              "Retained admission history disagrees with SQL restore.",
            );
        }
        if (
          r.state === "committed" &&
          !(
            (row["lifecycle_status"] === "deletion-pending" &&
              Number(row["record_version"]) === w.recordVersion &&
              row["requested_at"] === w.deletionRequestedAt) ||
            (row["lifecycle_status"] === "deleted" &&
              Number(row["deletion_record_version"]) === w.recordVersion &&
              row["receipt_requested_at"] === w.deletionRequestedAt)
          )
        )
          throw Error("A retained deletion tombstone was rolled back.");
        if (
          r.state === "aborted" &&
          row["lifecycle_status"] === "deletion-pending" &&
          Number(row["record_version"]) === w.recordVersion &&
          row["requested_at"] === w.deletionRequestedAt
        )
          throw Error("An aborted admission cannot authorize erasure.");
      } else {
        const table =
          e.storageNamespace === "deletion-recovery"
            ? "project_deletion_recovery_objects"
            : "project_content_writes";
        const idColumn =
          e.storageNamespace === "deletion-recovery" ? "object_id" : "write_id";
        const current = await tx.query(
          sql(`SELECT * FROM ${table} WHERE ${idColumn}=$1`, [e.writeId]),
        );
        const row = current.rows[0];
        if (
          current.rows.length !== 1 ||
          row?.["history_id"] !== cleanupHistoryId(e) ||
          row["organization_id"] !== e.organizationId ||
          row["project_id"] !== e.projectId ||
          row["object_id"] !== e.objectId ||
          row["content_sha256"] !== e.contentSha256 ||
          row["created_by_principal_id"] !== e.principalId
        )
          throw Error("Writer history was rolled back or changed.");
        if (
          e.storageNamespace === "deletion-recovery"
            ? e.recovery === undefined ||
              row["job_id"] !== e.recovery.jobId ||
              Number(row["job_record_version"]) !==
                e.recovery.jobRecordVersion ||
              Number(row["deletion_record_version"]) !==
                e.recovery.deletionRecordVersion ||
              Number(row["size_bytes"]) !== e.sizeBytes ||
              row["media_type"] !== e.mediaType ||
              row["object_purpose"] !== e.purpose
            : row["storage_namespace"] !== e.storageNamespace
        )
          throw Error("Writer recovery lineage was changed.");
        if (
          row["lifecycle_status"] === "completed" &&
          !["completed", "aborted"].includes(r.state)
        )
          throw Error("Unknown issued writer cannot become complete.");
      }
    }
  }
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.incarnation.assertCurrent().then(() =>
      this.database.transaction(async (tx) => {
        await this.verify(tx, await readCompleteCleanupHistory(this.history));
        const value = await work(tx);
        await this.verify(tx, await readCompleteCleanupHistory(this.history));
        await this.incarnation.assertCurrent();
        return value;
      }),
    );
  }
  query<R extends SqlRow = SqlRow>(statement: SqlStatement) {
    return this.transaction((tx) => tx.query<R>(statement));
  }
  close() {
    return this.database.close();
  }
}
