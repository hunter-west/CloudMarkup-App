import {
  SolutionExportWorkerAuthority,
  type SolutionExportExecutionIdentity,
} from "./solution-export-worker-authority.js";
import { ProjectDeletionRecoveryAuthority } from "./project-deletion-recovery-authority.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import { sql, type SqlExecutor } from "./sql.js";
/** Terminal projection only. A tombstone never grants a worker lease, actor role,
 * execution permission or new artifact compilation. */
export class ProjectDeletionExportTerminalAuthority extends SolutionExportWorkerAuthority {
  readonly deletion: ProjectDeletionRecoveryAuthority;
  constructor(
    deletion: ProjectDeletionRecoveryAuthority,
    identity: SolutionExportExecutionIdentity,
  ) {
    super(deletion.database, identity, "terminal");
    this.deletion = deletion;
    if (
      identity.organizationId !== deletion.binding.organizationId ||
      identity.projectId !== deletion.binding.projectId
    )
      throw Error("Deletion export scope mismatch.");
  }
  override async authorize(
    tx: SqlExecutor,
  ): Promise<AuthorizedOrganizationScope> {
    await this.deletion.authorize(tx);
    const i = this.identity;
    const result = await tx.query(
      sql(
        `SELECT j.correlation_id FROM solution_export_runs x JOIN async_jobs j
      ON j.organization_id=x.organization_id AND j.project_id=x.project_id AND j.job_id=x.root_job_id
      JOIN async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id
      WHERE x.organization_id=$1 AND x.project_id=$2 AND x.solution_export_run_id=$3
      AND x.created_by_principal_id=$4 AND j.created_by_principal_id=$4 AND j.idempotency_actor_id=$4
      AND j.family='solution-export-orchestration' AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL
      AND j.input_sha256=$5 AND j.input_object_id=x.orchestration_input_object_id AND j.input_sha256=x.orchestration_input_sha256
      AND j.solution_revision_id=x.solution_revision_id AND j.solution_manifest_sha256=x.solution_manifest_sha256
      AND a.attempt_id=$6 AND a.attempt_number=$7 AND a.worker_reference=$8
      AND a.attempt_number=(SELECT max(last.attempt_number) FROM async_job_attempts last WHERE last.organization_id=j.organization_id AND last.job_id=j.job_id)
      AND j.completed_at IS NOT NULL AND a.completed_at=j.completed_at
      AND ((j.lifecycle_status IN('succeeded','failed','canceled') AND a.lifecycle_status=j.lifecycle_status)
        OR (j.lifecycle_status='failed' AND a.lifecycle_status='orphaned') OR (j.lifecycle_status='expired' AND a.lifecycle_status='canceled'))
      AND (j.lifecycle_status<>'succeeded' OR j.cancellation_requested_at IS NULL) FOR SHARE OF j,a,x`,
        [
          i.organizationId,
          i.projectId,
          i.jobId,
          i.actorId,
          i.inputDigest.slice(7),
          i.attemptId,
          i.attemptNumber,
          i.workerId,
        ],
      ),
    );
    if (
      result.rows.length !== 1 ||
      typeof result.rows[0]?.["correlation_id"] !== "string"
    )
      throw Error("Canonical terminal export proof is unavailable.");
    return {
      organizationId: i.organizationId,
      principalId: i.actorId,
      membershipId: "membership.retention",
      sessionId: "session.retention",
      roleKey: "retention",
      capabilities: [],
      correlationId: result.rows[0]["correlation_id"],
    };
  }
}
