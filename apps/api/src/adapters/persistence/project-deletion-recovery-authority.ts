import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
import type { ProjectErasureBinding } from "./s3-project-content-eraser.js";
import {
  parseProjectCleanupWake,
  projectCleanupWake,
} from "../../application/project-cleanup-wake.js";
/** Exact system authority derived only from a committed tombstone. No normal
 * principal/worker execution permission is granted by this adapter. Scope lock
 * serializes recovery-write registration against permanent erasure phase. */
export class ProjectDeletionRecoveryAuthority implements SqlDatabase {
  readonly database: SqlDatabase;
  readonly binding: ProjectErasureBinding;
  constructor(database: SqlDatabase, binding: ProjectErasureBinding) {
    this.database = database;
    this.binding = Object.freeze(
      projectCleanupWake({ ...binding, lifecycleStatus: "deletion-pending" }),
    );
    parseProjectCleanupWake(this.binding);
  }
  async authorize(tx: SqlExecutor): Promise<void> {
    const b = this.binding;
    const scope = await tx.query(
      sql(
        "SELECT closed_at FROM project_content_write_scopes WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
        [b.organizationId, b.projectId],
      ),
    );
    if (scope.rows.length !== 1 || scope.rows[0]?.["closed_at"] == null)
      throw Error("Deletion write closure is unconfirmed.");
    const p = await tx.query(
      sql(
        `SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2
      AND lifecycle_status='deletion-pending' AND record_version=$3
      AND to_char(deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=$4 FOR UPDATE`,
        [b.organizationId, b.projectId, b.recordVersion, b.deletionRequestedAt],
      ),
    );
    if (p.rows.length !== 1)
      throw Error("Deletion recovery authority is unavailable.");
    await tx.query(
      sql(
        `INSERT INTO project_cleanup_phases(organization_id,project_id,deletion_record_version,deletion_requested_at)
      SELECT organization_id,project_id,record_version,deletion_requested_at FROM projects WHERE organization_id=$1 AND project_id=$2 ON CONFLICT DO NOTHING`,
        [b.organizationId, b.projectId],
      ),
    );
    const phase = await tx.query(
      sql(
        `SELECT phase FROM project_cleanup_phases WHERE organization_id=$1 AND project_id=$2
      AND deletion_record_version=$3 AND to_char(deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=$4 FOR UPDATE`,
        [b.organizationId, b.projectId, b.recordVersion, b.deletionRequestedAt],
      ),
    );
    if (phase.rows.length !== 1 || phase.rows[0]?.["phase"] !== "draining")
      throw Error("Deletion recovery publication is sealed.");
  }
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(async (tx) => {
      await this.authorize(tx);
      const result = await work(tx);
      await this.authorize(tx);
      return result;
    });
  }
  query<T extends SqlRow = SqlRow>(statement: SqlStatement) {
    return this.transaction((tx) => tx.query<T>(statement));
  }
  close() {
    return Promise.resolve();
  }
}

/** Once sealed, no recovery body may be registered. This must precede all S3
 * erasure I/O, including empty observations; stale recovery attempts reject. */
export async function sealProjectDeletionForErasure(
  authority: ProjectDeletionRecoveryAuthority,
): Promise<void> {
  await authority.database.transaction(async (tx) => {
    const b = authority.binding;
    const scope = await tx.query(
      sql(
        "SELECT closed_at FROM project_content_write_scopes WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
        [b.organizationId, b.projectId],
      ),
    );
    if (scope.rows.length !== 1 || scope.rows[0]?.["closed_at"] == null)
      throw Error("Deletion write closure is unconfirmed.");
    const phase = await tx.query(
      sql(
        `SELECT x.phase FROM project_cleanup_phases x JOIN projects p USING(organization_id,project_id)
      WHERE x.organization_id=$1 AND x.project_id=$2 AND x.deletion_record_version=$3
      AND to_char(x.deletion_requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=$4
      AND p.lifecycle_status='deletion-pending' AND p.record_version=x.deletion_record_version
      AND p.deletion_requested_at=x.deletion_requested_at FOR UPDATE OF x,p`,
        [b.organizationId, b.projectId, b.recordVersion, b.deletionRequestedAt],
      ),
    );
    if (
      phase.rows.length !== 1 ||
      !["draining", "erasing"].includes(String(phase.rows[0]?.["phase"]))
    )
      throw Error("Erasure phase is unconfirmed.");
    const blocked = await tx.query(
      sql(
        `SELECT EXISTS(SELECT 1 FROM project_deletion_recovery_objects
      WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status NOT IN('completed','aborted')) AS blocked`,
        [b.organizationId, b.projectId],
      ),
    );
    if (blocked.rows.length !== 1 || blocked.rows[0]?.["blocked"] !== false)
      throw Error("Recovery publication still blocks erasure.");
    await tx.query(
      sql(
        "UPDATE project_cleanup_phases SET phase='erasing' WHERE organization_id=$1 AND project_id=$2 AND phase='draining'",
        [b.organizationId, b.projectId],
      ),
    );
  });
}
