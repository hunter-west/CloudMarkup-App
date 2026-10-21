import { cleanupRequired } from "./cleanup-required.js";
import type { ObjectStore } from "../../application/persistence.js";
import {
  cleanupHistoryId,
  confirmCleanupHistory,
  type CleanupHistoryPort,
} from "../../application/project-cleanup-history.js";
import {
  ProjectDeletionRecoveryAuthority,
  sealProjectDeletionForErasure,
} from "./project-deletion-recovery-authority.js";
import { recoverOneProjectDeletionWriter } from "./project-deletion-writer-recovery.js";
import { recoverOneProjectDeletionJob } from "./project-deletion-job-recovery.js";
import { recoverOneProjectDeletionExport } from "./project-deletion-export-recovery.js";
import { recoverOneProjectDeletionCredit } from "./project-deletion-credit-recovery.js";
import type { ProjectErasureBinding } from "./s3-project-content-eraser.js";
import { sql, type SqlDatabase } from "./sql.js";
/** A bounded cleanup invocation advances at most one canonical work item. Unknown
 * financial/provider outcomes stay held. Final phase seal is committed before
 * any S3 erasure; no ordinary authority or process timer is reopened. */
export function createProjectDeletionRecovery(input: {
  database: SqlDatabase;
  objects: ObjectStore;
  history: CleanupHistoryPort;
}) {
  async function recoverPublication(
    authority: ProjectDeletionRecoveryAuthority,
  ) {
    const b = authority.binding,
      rows = await authority.query(
        sql(
          "SELECT * FROM project_deletion_recovery_objects WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status IN('in-flight','uncertain') ORDER BY created_at,object_id LIMIT 1",
          [b.organizationId, b.projectId],
        ),
      );
    const row = rows.rows[0];
    if (row === undefined) return "idle" as const;
    const id = row["history_id"];
    if (typeof id !== "string") return "held" as const;
    let record = await input.history.read(id);
    if (record?.envelope.kind !== "write") return "held" as const;
    const e = record.envelope;
    if (
      cleanupHistoryId(e) !== id ||
      e.storageNamespace !== "deletion-recovery" ||
      e.recovery?.jobId !== row["job_id"] ||
      e.recovery?.jobRecordVersion !== Number(row["job_record_version"]) ||
      e.recovery.deletionRecordVersion !== b.recordVersion ||
      e.objectId !== row["object_id"] ||
      e.organizationId !== b.organizationId ||
      e.projectId !== b.projectId ||
      e.writeId !== row["object_id"] ||
      e.contentSha256 !== row["content_sha256"] ||
      e.principalId !== row["created_by_principal_id"] ||
      e.sizeBytes !== Number(row["size_bytes"]) ||
      e.purpose !== row["object_purpose"] ||
      e.mediaType !== row["media_type"]
    )
      throw Error("Recovery write history mismatch.");
    if (record.state === "prepared") {
      await input.history.transition(e, "prepared", "aborted");
      await confirmCleanupHistory({
        history: input.history,
        envelope: e,
        state: "aborted",
      });
      record = await input.history.read(id);
    }
    if (record?.state !== "completed" && record?.state !== "aborted")
      return "held" as const;
    const terminal = record;
    await authority.transaction(async (tx) => {
      await tx.query(
        sql(
          "INSERT INTO project_deletion_recovery_completion_proofs(object_id,history_id,history_state,object_version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [
            e.objectId,
            id,
            terminal.state,
            terminal.completion?.objectVersion ?? null,
          ],
        ),
      );
      const proof = await tx.query(
        sql(
          "SELECT * FROM project_deletion_recovery_completion_proofs WHERE object_id=$1",
          [e.objectId],
        ),
      );
      if (
        proof.rows.length !== 1 ||
        proof.rows[0]?.["history_id"] !== id ||
        proof.rows[0]["history_state"] !== terminal.state ||
        proof.rows[0]["object_version"] !==
          (terminal.completion?.objectVersion ?? null)
      )
        throw Error("Recovery completion proof conflicts.");
      if (terminal.state === "completed")
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
              cleanupRequired(terminal.completion).objectVersion,
              cleanupRequired(terminal.completion).entityTag ?? null,
              e.contentSha256,
              e.sizeBytes,
              e.mediaType,
              e.principalId,
            ],
          ),
        );
      const changed = await tx.query(
        sql(
          "UPDATE project_deletion_recovery_objects SET lifecycle_status=$2,finalized_at=clock_timestamp() WHERE object_id=$1 AND lifecycle_status IN('in-flight','uncertain') RETURNING object_id",
          [e.objectId, terminal.state],
        ),
      );
      if (changed.rows.length !== 1)
        throw Error("Recovery completion CAS changed.");
    });
    return "recovered" as const;
  }
  return {
    async drain(binding: ProjectErasureBinding): Promise<boolean> {
      const phase = await input.database.query(
        sql(
          "SELECT phase,deletion_record_version,to_char(deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS requested_at FROM project_cleanup_phases WHERE organization_id=$1 AND project_id=$2",
          [binding.organizationId, binding.projectId],
        ),
      );
      if (phase.rows[0]?.["phase"] === "erasing") {
        if (
          Number(phase.rows[0]["deletion_record_version"]) !==
            binding.recordVersion ||
          phase.rows[0]["requested_at"] !== binding.deletionRequestedAt
        )
          throw Error("Erasure binding changed.");
        return true;
      }
      const authority = new ProjectDeletionRecoveryAuthority(
        input.database,
        binding,
      );
      await authority.transaction(() => Promise.resolve());
      const ordinary = await recoverOneProjectDeletionWriter({
        authority,
        history: input.history,
      });
      if (ordinary.state !== "idle") return false;
      if ((await recoverPublication(authority)) !== "idle") return false;
      const job = await recoverOneProjectDeletionJob({
        authority,
        store: input.objects,
        history: input.history,
      });
      if (job.state !== "idle") return false;
      const exported = await recoverOneProjectDeletionExport({
        authority,
        store: input.objects,
        history: input.history,
      });
      if (exported.state !== "idle") return false;
      const credit = await recoverOneProjectDeletionCredit(authority);
      if (credit.state !== "idle") return false;
      await sealProjectDeletionForErasure(authority);
      return true;
    },
    async assertSealed(binding: ProjectErasureBinding) {
      const result = await input.database.query(
        sql(
          `SELECT p.project_id FROM project_cleanup_phases x JOIN projects p USING(organization_id,project_id)
      WHERE x.organization_id=$1 AND x.project_id=$2 AND x.phase='erasing' AND x.deletion_record_version=$3
      AND to_char(x.deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=$4
      AND p.lifecycle_status='deletion-pending' AND p.record_version=x.deletion_record_version AND p.deletion_requested_at=x.deletion_requested_at`,
          [
            binding.organizationId,
            binding.projectId,
            binding.recordVersion,
            binding.deletionRequestedAt,
          ],
        ),
      );
      if (result.rows.length !== 1)
        throw Error("Recovery erasure seal is unavailable.");
    },
  };
}
