import { cleanupRequired } from "./cleanup-required.js";
import { createHash } from "node:crypto";
import {
  readCompleteCleanupHistory,
  cleanupHistoryId,
  confirmCleanupHistory,
  parseCleanupHistoryEnvelope,
  type CleanupHistoryPort,
  type CleanupHistoryRecord,
} from "../../application/project-cleanup-history.js";
import {
  projectCleanupWake,
  parseProjectCleanupWake,
  type CleanupWakeLedger,
} from "../../application/project-cleanup-wake.js";
import { CleanupHistoryBoundDatabase } from "./project-cleanup-restore-guard.js";
import type { CleanupDatabaseIncarnationPort } from "./project-cleanup-incarnation.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Frozen operator cutover only. Enumerates pending AND already deleted legacy
 * tombstones plus every prior admission; completed wakes cannot remove history.
 * Rejects overflow instead of declaring a first page complete. */
export async function backfillRetainedCleanupHistory(input: {
  database: SqlDatabase;
  history: CleanupHistoryPort;
  ledger: Pick<CleanupWakeLedger, "put" | "get">;
  incarnation: CleanupDatabaseIncarnationPort;
  assertSchema: (tx: SqlExecutor) => Promise<void>;
  maximum?: number;
}) {
  const max = input.maximum ?? 1000;
  if (!Number.isSafeInteger(max) || max < 1 || max > 10000)
    throw Error("Invalid backfill bound.");
  await input.incarnation.assertCurrent();
  return input.database.transaction(async (tx) => {
    await input.assertSchema(tx);
    const c = await tx.query(
      sql(
        "SELECT admission_required FROM project_cleanup_controls WHERE control_id='beta' FOR UPDATE",
      ),
    );
    if (c.rows.length !== 1 || c.rows[0]?.["admission_required"] !== true)
      throw Error("Future admission coverage is not enforced.");
    const admissions = await tx.query(
      sql(
        "SELECT * FROM project_cleanup_admissions ORDER BY admission_id LIMIT $1",
        [max + 1],
      ),
    );
    const projects = await tx.query(
      sql(
        `SELECT p.organization_id,p.project_id,p.lifecycle_status,p.record_version,
      to_char(p.deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_at,
      r.deletion_record_version,to_char(r.deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS receipt_requested_at
      FROM projects p LEFT JOIN project_content_erasure_receipts r USING(organization_id,project_id)
      WHERE p.lifecycle_status IN('deletion-pending','deleted') ORDER BY p.organization_id,p.project_id LIMIT $1 FOR SHARE OF p`,
        [max + 1],
      ),
    );
    if (admissions.rows.length + projects.rows.length > max)
      throw Error("Backfill inventory exceeds its proof bound.");
    const records: CleanupHistoryRecord[] = [];
    for (const row of admissions.rows) {
      const wake = parseProjectCleanupWake(
        JSON.parse(String(row["wake_binding"])) as unknown,
      );
      if (wake.schemaVersion !== 2) throw Error("Invalid admission backfill.");
      const envelope = parseCleanupHistoryEnvelope({
        kind: "admission",
        wake,
        principalId: row["principal_id"],
        idempotencyKeySha256: row["idempotency_key_sha256"],
        requestSha256: row["request_sha256"],
        expectedRecordVersion: Number(row["expected_record_version"]),
      });
      const state = row["lifecycle_status"];
      if (state !== "prepared" && state !== "committed" && state !== "aborted")
        throw Error("Invalid admission state.");
      await input.history.prepare(envelope);
      if (state !== "prepared")
        await input.history.transition(envelope, "prepared", state);
      await confirmCleanupHistory({ history: input.history, envelope, state });
      records.push({ envelope, state });
    }
    for (const row of projects.rows) {
      const deleted = row["lifecycle_status"] === "deleted",
        version = Number(
          deleted ? row["deletion_record_version"] : row["record_version"],
        ),
        at = deleted ? row["receipt_requested_at"] : row["requested_at"];
      if (typeof at !== "string")
        throw Error("Legacy deletion receipt is missing.");
      const wake = projectCleanupWake({
        organizationId: String(row["organization_id"]),
        projectId: String(row["project_id"]),
        lifecycleStatus: "deletion-pending",
        recordVersion: version,
        deletionRequestedAt: at,
      });
      const admitted = records.find(
        (r) =>
          r.envelope.kind === "admission" &&
          r.state === "committed" &&
          r.envelope.wake.organizationId === wake.organizationId &&
          r.envelope.wake.projectId === wake.projectId &&
          r.envelope.wake.recordVersion === wake.recordVersion &&
          r.envelope.wake.deletionRequestedAt === wake.deletionRequestedAt,
      );
      if (admitted?.envelope.kind === "admission") {
        if (!deleted) {
          await input.ledger.put(admitted.envelope.wake);
          if (
            JSON.stringify(
              await input.ledger.get(admitted.envelope.wake.wakeId),
            ) !== JSON.stringify(admitted.envelope.wake)
          )
            throw Error("Admission wake readback failed.");
        }
        continue;
      }
      const envelope = parseCleanupHistoryEnvelope({
        kind: "legacy-deletion",
        wake,
      });
      await input.history.prepare(envelope);
      await input.history.transition(envelope, "prepared", "committed");
      await confirmCleanupHistory({
        history: input.history,
        envelope,
        state: "committed",
      });
      records.push({ envelope, state: "committed" });
      if (!deleted) {
        await input.ledger.put(wake);
        if (
          JSON.stringify(await input.ledger.get(wake.wakeId)) !==
          JSON.stringify(wake)
        )
          throw Error("Legacy wake readback failed.");
      }
    }
    await input.incarnation.assertCurrent();
    return { records: records.length, inventorySha256: hash(records) };
  });
}
/** SQL-only restore with all access/producers frozen and the original S3 bucket
 * unchanged. Imports complete external history, replays accepted tombstones, and
 * republishes wakes. Unknown preparations/issued writes, missing lineage or
 * canonical job/financial evidence keep quarantine; no amount/outcome is invented.
 * This does not claim recovery of independently restored S3 content or lost history. */
export async function replayRetainedCleanupHistory(input: {
  database: SqlDatabase;
  history: CleanupHistoryPort;
  ledger: Pick<CleanupWakeLedger, "put" | "get">;
  incarnation: CleanupDatabaseIncarnationPort;
  assertSchema: (tx: SqlExecutor) => Promise<void>;
}) {
  await input.incarnation.assertCurrent();
  const records = await readCompleteCleanupHistory(input.history);
  const status = await input.database.query(
    sql(
      "SELECT restore_status FROM project_cleanup_controls WHERE control_id='beta'",
    ),
  );
  if (
    status.rows.length !== 1 ||
    status.rows[0]?.["restore_status"] !== "restoring"
  )
    throw Error("Restore access must already be frozen.");
  const unresolved = records.filter(
    (r) => r.state === "prepared" || r.state === "issued",
  );
  // In particular a restored PREPARED journal cannot deadline-abort a lost
  // COMMIT response. Obtain trustworthy original WAL/external terminal evidence.
  if (unresolved.length !== 0)
    return {
      state: "quarantined" as const,
      unresolved: unresolved.length,
      inventorySha256: hash(records),
    };
  const ordered = [
    ...records.filter((r) => r.envelope.kind !== "write"),
    ...records.filter((r) => r.envelope.kind === "write"),
  ];
  for (const r of ordered) {
    const e = r.envelope,
      id = cleanupHistoryId(e);
    await confirmCleanupHistory({
      history: input.history,
      envelope: e,
      state: r.state,
    });
    await input.database.transaction(async (tx) => {
      await input.assertSchema(tx);
      await tx.query(
        sql(
          "INSERT INTO project_cleanup_restore_history(history_id,envelope,history_state) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [id, JSON.stringify(e), r.state],
        ),
      );
      const proof = await tx.query(
        sql(
          "SELECT envelope,history_state FROM project_cleanup_restore_history WHERE history_id=$1",
          [id],
        ),
      );
      if (
        proof.rows.length !== 1 ||
        proof.rows[0]?.["envelope"] !== JSON.stringify(e) ||
        proof.rows[0]["history_state"] !== r.state
      )
        throw Error("Restore history conflicts.");
      if (e.kind === "write") {
        if (e.storageNamespace === "deletion-recovery") {
          const recovery = e.recovery;
          if (recovery === undefined)
            throw Error("Recovery publication lineage is missing.");
          await tx.query(
            sql(
              `INSERT INTO project_cleanup_phases(organization_id,project_id,deletion_record_version,deletion_requested_at)
            SELECT organization_id,project_id,record_version,deletion_requested_at FROM projects WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status='deletion-pending' ON CONFLICT DO NOTHING`,
              [e.organizationId, e.projectId],
            ),
          );
          await tx.query(
            sql(
              `INSERT INTO project_deletion_recovery_objects(object_id,organization_id,project_id,job_id,job_record_version,deletion_record_version,content_sha256,size_bytes,object_purpose,media_type,created_by_principal_id,history_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
              [
                e.objectId,
                e.organizationId,
                e.projectId,
                recovery.jobId,
                recovery.jobRecordVersion,
                recovery.deletionRecordVersion,
                e.contentSha256,
                e.sizeBytes,
                e.purpose,
                e.mediaType,
                e.principalId,
                id,
              ],
            ),
          );
          await tx.query(
            sql(
              "INSERT INTO project_deletion_recovery_completion_proofs(object_id,history_id,history_state,object_version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
              [e.objectId, id, r.state, r.completion?.objectVersion ?? null],
            ),
          );
          if (r.state === "completed")
            await tx.query(
              sql(
                `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,storage_key,object_version,entity_tag,content_sha256,size_bytes,media_type,lifecycle_state,created_by_principal_id,published_at)
            VALUES($1,$2,$3,'s3',$4,$5,$6,$7,$8,$9,$10,'published',$11,clock_timestamp()) ON CONFLICT DO NOTHING`,
                [
                  e.objectId,
                  e.organizationId,
                  e.projectId,
                  e.purpose,
                  `documents/v1/organizations/v1/organizations/${e.organizationId}/projects/${e.projectId}/${e.purpose}/${e.objectId}/${e.contentSha256}`,
                  cleanupRequired(r.completion).objectVersion,
                  cleanupRequired(r.completion).entityTag ?? null,
                  e.contentSha256,
                  e.sizeBytes,
                  e.mediaType,
                  e.principalId,
                ],
              ),
            );
          await tx.query(
            sql(
              "UPDATE project_deletion_recovery_objects SET lifecycle_status=$2,finalized_at=clock_timestamp() WHERE object_id=$1 AND lifecycle_status IN('in-flight','uncertain')",
              [e.objectId, r.state],
            ),
          );
        } else {
          await tx.query(
            sql(
              "INSERT INTO project_content_write_scopes(organization_id,project_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
              [e.organizationId, e.projectId],
            ),
          );
          await tx.query(
            sql(
              "INSERT INTO project_content_writes(write_id,organization_id,project_id,storage_namespace,object_id,content_sha256,created_by_principal_id,history_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
              [
                e.writeId,
                e.organizationId,
                e.projectId,
                e.storageNamespace,
                e.objectId,
                e.contentSha256,
                e.principalId,
                id,
              ],
            ),
          );
          await tx.query(
            sql(
              "INSERT INTO project_content_write_completion_proofs(write_id,history_id,history_state,object_version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
              [e.writeId, id, r.state, r.completion?.objectVersion ?? null],
            ),
          );
          await tx.query(
            sql(
              "UPDATE project_content_writes SET lifecycle_status='completed',finalized_at=clock_timestamp() WHERE write_id=$1 AND lifecycle_status IN('in-flight','uncertain')",
              [e.writeId],
            ),
          );
        }
        return;
      }
      if (r.state !== "committed") return;
      const w = e.wake,
        p = await tx.query(
          sql(
            "SELECT lifecycle_status,record_version FROM projects WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
            [w.organizationId, w.projectId],
          ),
        );
      if (p.rows.length !== 1)
        throw Error("Deletion lineage cannot be fabricated.");
      if (p.rows[0]?.["lifecycle_status"] === "deleted") return;
      if (
        !["active", "archived", "deletion-pending"].includes(
          String(p.rows[0]?.["lifecycle_status"]),
        ) ||
        Number(p.rows[0]?.["record_version"]) > w.recordVersion
      )
        throw Error("Restore project history is contradictory.");
      if (e.kind === "admission") {
        await tx.query(
          sql(
            `INSERT INTO project_cleanup_admissions(admission_id,organization_id,project_id,principal_id,idempotency_key_sha256,request_sha256,expected_record_version,wake_binding,admission_deadline)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz) ON CONFLICT DO NOTHING`,
            [
              e.wake.admissionId,
              w.organizationId,
              w.projectId,
              e.principalId,
              e.idempotencyKeySha256,
              e.requestSha256,
              e.expectedRecordVersion,
              JSON.stringify(w),
              e.wake.admissionDeadline,
            ],
          ),
        );
      }
      await tx.query(
        sql(
          "UPDATE projects SET lifecycle_status='deletion-pending',record_version=$3,deletion_requested_at=$4::timestamptz,updated_at=GREATEST(updated_at,$4::timestamptz) WHERE organization_id=$1 AND project_id=$2",
          [
            w.organizationId,
            w.projectId,
            w.recordVersion,
            w.deletionRequestedAt,
          ],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO project_content_write_scopes(organization_id,project_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [w.organizationId, w.projectId],
        ),
      );
      await tx.query(
        sql(
          "UPDATE project_content_write_scopes SET closed_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND closed_at IS NULL",
          [w.organizationId, w.projectId],
        ),
      );
      if (e.kind === "admission")
        await tx.query(
          sql(
            "UPDATE project_cleanup_admissions SET lifecycle_status='committed',resolved_at=clock_timestamp() WHERE admission_id=$1 AND lifecycle_status='prepared'",
            [e.wake.admissionId],
          ),
        );
    });
    if (e.kind !== "write" && r.state === "committed") {
      await input.ledger.put(e.wake);
      if (
        JSON.stringify(await input.ledger.get(e.wake.wakeId)) !==
        JSON.stringify(e.wake)
      )
        throw Error("Restore wake readback failed.");
    }
  }
  const after = await readCompleteCleanupHistory(input.history);
  if (JSON.stringify(after) !== JSON.stringify(records))
    throw Error("Restore producers were not frozen.");
  await input.incarnation.assertCurrent();
  const guard = new CleanupHistoryBoundDatabase({ ...input });
  await input.database.transaction(async (tx) => {
    // Deletion metadata cannot attest missing canonical jobs or financial
    // evidence. Keep access frozen until those owners admit original proof.
    await guard.verifyFrozenRestoreMetadata(tx, records);
  });
  return {
    state: "replayed-quarantined" as const,
    requiresCanonicalEvidenceReview: true as const,
    records: records.length,
    inventorySha256: hash(records),
  };
}
