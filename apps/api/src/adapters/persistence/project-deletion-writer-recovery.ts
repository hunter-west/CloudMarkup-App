import {
  cleanupHistoryId,
  confirmCleanupHistory,
  type CleanupHistoryEnvelope,
  type CleanupHistoryPort,
} from "../../application/project-cleanup-history.js";
import { ProjectDeletionRecoveryAuthority } from "./project-deletion-recovery-authority.js";
import { sql } from "./sql.js";
/** A returned single-attempt provider completion or a conditional never-issued
 * abort is the only authority to close an uncertain ordinary write. An issued
 * request with unknown outcome stays held indefinitely; HEAD/leases prove none. */
export async function recoverOneProjectDeletionWriter(input: {
  authority: ProjectDeletionRecoveryAuthority;
  history: CleanupHistoryPort;
}) {
  const { authority, history } = input,
    b = authority.binding;
  const rows = await authority.query(
    sql(
      "SELECT * FROM project_content_writes WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status<>'completed' ORDER BY created_at,write_id LIMIT 1",
      [b.organizationId, b.projectId],
    ),
  );
  const row = rows.rows[0];
  if (row === undefined) return { state: "idle" as const };
  // Envelope digest is retained in the SQL registration before issuance.
  const historyId = row["history_id"];
  if (typeof historyId !== "string") return { state: "held" as const };
  let record = await history.read(historyId);
  if (record?.envelope.kind !== "write") return { state: "held" as const };
  const e: CleanupHistoryEnvelope = record.envelope;
  if (
    cleanupHistoryId(e) !== historyId ||
    e.writeId !== row["write_id"] ||
    e.organizationId !== b.organizationId ||
    e.projectId !== b.projectId ||
    e.objectId !== row["object_id"] ||
    e.contentSha256 !== row["content_sha256"] ||
    e.principalId !== row["created_by_principal_id"] ||
    e.storageNamespace !== row["storage_namespace"]
  )
    throw Error("Writer completion binding mismatch.");
  if (record.state === "prepared") {
    await history.transition(e, "prepared", "aborted");
    await confirmCleanupHistory({ history, envelope: e, state: "aborted" });
    record = await history.read(historyId);
  }
  if (record?.state !== "completed" && record?.state !== "aborted")
    return { state: "held" as const };
  const terminal = record;
  await authority.transaction(async (tx) => {
    await tx.query(
      sql(
        `INSERT INTO project_content_write_completion_proofs(write_id,history_id,history_state,object_version)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [
          e.writeId,
          historyId,
          terminal.state,
          terminal.completion?.objectVersion ?? null,
        ],
      ),
    );
    const proof = await tx.query(
      sql(
        "SELECT history_id,history_state,object_version FROM project_content_write_completion_proofs WHERE write_id=$1",
        [e.writeId],
      ),
    );
    if (
      proof.rows.length !== 1 ||
      proof.rows[0]?.["history_id"] !== historyId ||
      proof.rows[0]["history_state"] !== terminal.state ||
      proof.rows[0]["object_version"] !==
        (terminal.completion?.objectVersion ?? null)
    )
      throw Error("Writer completion proof conflicts.");
    const result = await tx.query(
      sql(
        "UPDATE project_content_writes SET lifecycle_status='completed',finalized_at=clock_timestamp() WHERE write_id=$1 AND lifecycle_status IN('in-flight','uncertain') RETURNING write_id",
        [e.writeId],
      ),
    );
    if (result.rows.length !== 1) throw Error("Writer recovery changed.");
  });
  return { state: "recovered" as const };
}
