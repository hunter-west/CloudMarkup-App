import {
  parseAsyncJobRecordV1,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import { permissionsForRole } from "../../application/authorization.js";
import { ApplicationError } from "../../application/errors.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import {
  exportRunText,
  exportRunUnavailable,
} from "./solution-export-run-codec.js";
import { solutionExportExecutionIdentitySchema } from "./solution-export-terminal-codec.js";
import { solutionExportCanonicalExecutionRole } from "./solution-export-canonical-execution-role.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

export interface SolutionExportExecutionIdentity {
  readonly jobId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly workerId: string;
  readonly actorId: string;
  readonly inputDigest: string;
}

export function solutionExportExecutionIdentity(
  input: AsyncJobRecordV1,
): SolutionExportExecutionIdentity {
  const root = parseAsyncJobRecordV1(input);
  const attempt = root.attempts.at(-1);
  if (
    root.family !== "solution-export-orchestration" ||
    root.input.family !== "solution-export-orchestration" ||
    root.state !== "running" ||
    root.ownership.projectId === undefined ||
    attempt?.state !== "running" ||
    attempt.lease === undefined
  )
    exportRunUnavailable();
  return Object.freeze({
    jobId: root.jobId,
    organizationId: root.ownership.organizationId,
    projectId: root.ownership.projectId,
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    workerId: attempt.lease.workerId,
    actorId: root.idempotency.actorId,
    inputDigest: root.inputDigest,
  });
}

/** Privileged worker authority is derived from an admitted root, never a JWT or payload tenant. */
export class SolutionExportWorkerAuthority implements SqlDatabase {
  readonly permission = "exports.run" as const;
  readonly ownership: {
    readonly organizationId: string;
    readonly projectId: string;
  };
  readonly identity: SolutionExportExecutionIdentity;
  readonly database: SqlDatabase;
  readonly mode:
    | "execution"
    | "terminal"
    | "lifecycle"
    | "orphan-retry"
    | "orphan-reconcile";
  constructor(
    database: SqlDatabase,
    identity: SolutionExportExecutionIdentity,
    mode:
      | "execution"
      | "terminal"
      | "lifecycle"
      | "orphan-retry"
      | "orphan-reconcile" = "execution",
  ) {
    this.database = database;
    this.mode = mode;
    this.identity = Object.freeze(
      solutionExportExecutionIdentitySchema.parse(identity),
    );
    this.ownership = Object.freeze({
      organizationId: identity.organizationId,
      projectId: identity.projectId,
    });
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  async authorize(tx: SqlExecutor): Promise<AuthorizedOrganizationScope> {
    const id = this.identity;
    const result = await tx.query(
      sql(
        `SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json,
      j.correlation_id,j.lifecycle_status AS root_state,a.lifecycle_status AS attempt_state,
      a.lease_expires_at > clock_timestamp() AS lease_current,
      (j.expires_at IS NULL OR j.expires_at > clock_timestamp()) AS job_current,
      j.cancellation_requested_at IS NOT NULL AS cancellation_requested
      FROM solution_export_runs x
      JOIN async_jobs j ON j.organization_id=x.organization_id AND j.project_id=x.project_id AND j.job_id=x.root_job_id
      JOIN async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id
      JOIN projects p ON p.organization_id=x.organization_id AND p.project_id=x.project_id AND p.lifecycle_status='active'
      JOIN principals actor ON actor.principal_id=x.created_by_principal_id AND actor.lifecycle_status='active'
      JOIN memberships m ON m.organization_id=x.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
      JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
      WHERE x.organization_id=$1 AND x.project_id=$2 AND x.solution_export_run_id=$3
        AND x.created_by_principal_id=$4 AND j.created_by_principal_id=$4 AND j.idempotency_actor_id=$4
        AND j.family='solution-export-orchestration' AND j.input_sha256=$5
        AND j.solution_revision_id=x.solution_revision_id AND j.solution_manifest_sha256=x.solution_manifest_sha256
        AND j.input_object_id=x.orchestration_input_object_id AND j.input_sha256=x.orchestration_input_sha256
        AND a.attempt_id=$6 AND a.attempt_number=$7 AND a.worker_reference=$8
        AND a.attempt_number=(SELECT max(current_attempt.attempt_number) FROM async_job_attempts current_attempt
          WHERE current_attempt.organization_id=j.organization_id AND current_attempt.job_id=j.job_id)
      FOR SHARE OF p,actor,m,o,r`,
        [
          id.organizationId,
          id.projectId,
          id.jobId,
          id.actorId,
          id.inputDigest.slice(7),
          id.attemptId,
          id.attemptNumber,
          id.workerId,
        ],
      ),
    );
    const row = result.rows[0];
    const role = solutionExportCanonicalExecutionRole(result.rows);
    const terminal =
      ["succeeded", "failed", "canceled"].includes(
        exportRunText(row?.["root_state"]),
      ) && row?.["root_state"] === row?.["attempt_state"];
    const orphanTerminal =
      (row?.["root_state"] === "failed" &&
        row["attempt_state"] === "orphaned") ||
      (row?.["root_state"] === "expired" &&
        row["attempt_state"] === "canceled");
    const running =
      row?.["root_state"] === "running" &&
      row["attempt_state"] === "running" &&
      row["lease_current"] === true &&
      row["job_current"] === true;
    const valid =
      this.mode === "execution"
        ? running && row["cancellation_requested"] === false
        : this.mode === "terminal"
          ? terminal || orphanTerminal
          : this.mode === "orphan-reconcile"
            ? (row?.["root_state"] === "running" &&
                row["attempt_state"] === "running" &&
                row["lease_current"] === false) ||
              (row?.["root_state"] === "queued" &&
                row["attempt_state"] === "orphaned" &&
                row["job_current"] === true &&
                row["cancellation_requested"] === false) ||
              orphanTerminal ||
              (terminal && row?.["root_state"] === "canceled")
            : this.mode === "orphan-retry"
              ? row?.["job_current"] === true &&
                row["cancellation_requested"] === false &&
                ((row["root_state"] === "running" &&
                  row["attempt_state"] === "running" &&
                  row["lease_current"] === false) ||
                  (row["root_state"] === "queued" &&
                    row["attempt_state"] === "orphaned"))
              : running ||
                terminal ||
                (row?.["root_state"] === "queued" &&
                  ["failed", "orphaned"].includes(
                    String(row["attempt_state"]),
                  ) &&
                  row["job_current"] === true &&
                  row["cancellation_requested"] === false);
    if (!valid)
      throw new ApplicationError(
        "conflict",
        "The export execution is no longer current.",
      );
    return {
      organizationId: id.organizationId,
      principalId: id.actorId,
      sessionId: `worker.${id.attemptId}`,
      correlationId: exportRunText(row?.["correlation_id"]),
      membershipId: exportRunText(row?.["membership_id"]),
      roleKey: role,
      capabilities: permissionsForRole(role),
    };
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
  scope(): Promise<AuthorizedOrganizationScope> {
    return this.database.transaction((tx) => this.authorize(tx));
  }
}
