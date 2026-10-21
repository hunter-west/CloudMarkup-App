import {
  asyncJobIdSchema,
  asyncJobTrustedContextV1Schema,
  parseAsyncJobRecordV1,
  type AsyncJobTrustedContextV1,
} from "@cloudmarkup/schemas";
import { ApplicationError } from "../../application/errors.js";
import type { ObjectStore } from "../../application/persistence.js";
import type { StoredSolutionExportJob } from "../../application/solution-exports.js";
import {
  exportRunEqual,
  exportRunInteger,
  exportRunText,
  exportRunUnavailable,
} from "./solution-export-run-codec.js";
import { solutionExportExecutionIdentitySchema } from "./solution-export-terminal-codec.js";
import { PostgresSolutionExportTerminalRepository } from "./solution-export-terminal-repository.js";
import { SolutionExportWorkerAuthority } from "./solution-export-worker-authority.js";
import { sql, type SqlDatabase, type SqlRow } from "./sql.js";

function recoveryScope(input: AsyncJobTrustedContextV1): {
  readonly organizationId: string;
  readonly projectId: string;
} {
  const context = asyncJobTrustedContextV1Schema.parse(input);
  if (
    context.actor.kind !== "system" ||
    context.actor.reason !== "orphan-reconciler" ||
    context.ownership.projectId === undefined
  )
    throw new ApplicationError(
      "access_denied",
      "Export recovery requires an exact trusted reconciler scope.",
    );
  return Object.freeze({
    organizationId: context.ownership.organizationId,
    projectId: context.ownership.projectId,
  });
}

/** Internal host-only adapter, never an HTTP request context decoder. The host
 * supplies the existing trusted exact-project reconciler context. SQL reloads
 * the creating principal and completed worker identity; no caller identity,
 * retained in-process lease or object contents establish that authority. */
export class PostgresSolutionExportTerminalRecovery {
  readonly #database: SqlDatabase;
  readonly #objects: ObjectStore;
  constructor(database: SqlDatabase, objects: ObjectStore) {
    this.#database = database;
    this.#objects = objects;
  }

  async #candidates(
    scope: { readonly organizationId: string; readonly projectId: string },
    jobId: string | null,
    limit: number,
  ): Promise<readonly SqlRow[]> {
    const result = await this.#database.query(
      sql(
        `SELECT j.job_id,j.record_version,j.input_sha256,j.created_by_principal_id,
          j.lifecycle_status,a.attempt_id,a.attempt_number,a.worker_reference,
          s.snapshot_object_id,s.snapshot_sha256
        FROM solution_export_runs x
        JOIN async_jobs j ON j.organization_id=x.organization_id AND j.project_id=x.project_id AND j.job_id=x.root_job_id
        JOIN async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id
          AND a.attempt_number=(SELECT max(last_attempt.attempt_number) FROM async_job_attempts last_attempt
            WHERE last_attempt.organization_id=j.organization_id AND last_attempt.job_id=j.job_id)
        JOIN async_job_record_snapshots s ON s.organization_id=j.organization_id AND s.project_id=j.project_id
          AND s.job_id=j.job_id AND s.record_version=j.record_version
        JOIN stored_objects o ON o.organization_id=s.organization_id AND o.project_id=s.project_id
          AND o.object_id=s.snapshot_object_id AND o.content_sha256=s.snapshot_sha256
          AND o.lifecycle_state='published' AND o.object_purpose='report' AND o.media_type='application/json'
          AND o.size_bytes BETWEEN 0 AND 4194304
        JOIN projects p ON p.organization_id=j.organization_id AND p.project_id=j.project_id AND p.lifecycle_status='active'
        JOIN principals actor ON actor.principal_id=j.created_by_principal_id AND actor.lifecycle_status='active'
        JOIN memberships m ON m.organization_id=j.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
        JOIN organizations org ON org.organization_id=m.organization_id AND org.lifecycle_status='active'
        JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
          AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
          AND 'exports.run'=ANY(r.capabilities)
        WHERE j.organization_id=$1 AND j.project_id=$2 AND ($3::varchar IS NULL OR j.job_id=$3::varchar)
          AND j.family='solution-export-orchestration' AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL
          AND x.solution_export_run_id=j.job_id AND x.created_by_principal_id=j.created_by_principal_id
          AND j.idempotency_actor_id=j.created_by_principal_id
          AND j.solution_revision_id=x.solution_revision_id AND j.solution_manifest_sha256=x.solution_manifest_sha256
          AND j.input_object_id=x.orchestration_input_object_id AND j.input_sha256=x.orchestration_input_sha256
          AND j.lifecycle_status IN ('succeeded','failed','canceled','expired')
          AND (a.lifecycle_status=j.lifecycle_status OR (j.lifecycle_status='failed' AND a.lifecycle_status='orphaned') OR (j.lifecycle_status='expired' AND a.lifecycle_status='canceled'))
          AND j.completed_at IS NOT NULL AND a.completed_at=j.completed_at AND a.worker_reference IS NOT NULL
          AND (j.lifecycle_status<>'succeeded' OR j.cancellation_requested_at IS NULL)
          AND ($3::varchar IS NOT NULL OR x.lifecycle_status NOT IN ('succeeded','failed','canceled'))
        ORDER BY j.completed_at,j.job_id LIMIT $4`,
        [scope.organizationId, scope.projectId, jobId, limit],
      ),
    );
    if (result.rows.length > limit) exportRunUnavailable();
    return result.rows;
  }

  /** Ownership, canonical permission, terminal state and current immutable
   * snapshot are filtered before the bounded limit. This reads no object body. */
  async list(
    context: AsyncJobTrustedContextV1,
    limit = 25,
  ): Promise<readonly string[]> {
    const scope = recoveryScope(context);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new ApplicationError(
        "invalid_request",
        "Export recovery limit must be an integer between 1 and 100.",
      );
    return Object.freeze(
      (await this.#candidates(scope, null, limit)).map((row) =>
        asyncJobIdSchema.parse(row["job_id"]),
      ),
    );
  }

  /** A missing/stale/corrupt receipt is unavailable, never fabricated failure
   * or successful publication. Repeated exact recovery delegates the existing
   * terminal repository's immutable CAS/artifact replay checks. */
  async recover(
    context: AsyncJobTrustedContextV1,
    jobIdInput: string,
  ): Promise<StoredSolutionExportJob> {
    const scope = recoveryScope(context);
    const jobId = asyncJobIdSchema.parse(jobIdInput);
    const rows = await this.#candidates(scope, jobId, 1);
    const row = rows[0];
    if (rows.length !== 1 || row === undefined)
      throw new ApplicationError("not_found", "The export is unavailable.");
    const identity = solutionExportExecutionIdentitySchema.parse({
      ...scope,
      jobId,
      actorId: exportRunText(row["created_by_principal_id"]),
      attemptId: exportRunText(row["attempt_id"]),
      attemptNumber: exportRunInteger(row["attempt_number"]),
      workerId: exportRunText(row["worker_reference"]),
      inputDigest: `sha256:${exportRunText(row["input_sha256"])}`,
    });
    const terminal = new PostgresSolutionExportTerminalRepository(
      this.#database,
      this.#objects,
      identity,
    );
    // Existing terminal authority rechecks current canonical actor and all
    // exact root/attempt/input bindings on both sides of each object I/O.
    const authority: SolutionExportWorkerAuthority = terminal.authority;
    await authority.scope();
    const snapshot = await terminal.storage.metadata(
      exportRunText(row["snapshot_object_id"]),
    );
    if (
      snapshot?.state !== "published" ||
      snapshot.reference.purpose !== "report" ||
      snapshot.reference.mediaType !== "application/json" ||
      snapshot.reference.contentSha256 !== row["snapshot_sha256"]
    )
      exportRunUnavailable();
    const root = parseAsyncJobRecordV1(
      await terminal.storage.readJson(snapshot.reference),
    );
    if (
      root.jobId !== jobId ||
      root.recordVersion !== exportRunInteger(row["record_version"]) ||
      root.state !== row["lifecycle_status"] ||
      !exportRunEqual(root.ownership, scope)
    )
      exportRunUnavailable();
    return terminal.reconcile(root);
  }
}
