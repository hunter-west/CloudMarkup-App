import { cleanupRequired } from "./cleanup-required.js";
import type { CleanupHistoryPort } from "../../application/project-cleanup-history.js";
import { parseAsyncJobRecordV1 } from "@cloudmarkup/schemas";
import { cancelAsyncJobForProjectDeletionV1 } from "@cloudmarkup/domain";
import { asyncJobTrustedContextV1Schema } from "@cloudmarkup/schemas";
import type { ObjectStore } from "../../application/persistence.js";
import { projectInjectedSolutionExportResult } from "../../application/solution-export-projection.js";
import {
  exportRunBytes,
  exportRunText,
  exportRunInteger,
  exportRunEqual,
  parseStoredExportRun,
} from "./solution-export-run-codec.js";
import { ProjectDeletionRecoveryAuthority } from "./project-deletion-recovery-authority.js";
import { ProjectDeletionCanonicalObjects } from "./project-deletion-canonical-objects.js";
import { deletionExportObjects } from "./project-deletion-export-objects.js";
import { ProjectDeletionExportTerminalAuthority } from "./project-deletion-export-authority.js";
import { PostgresSolutionExportTerminalRepository } from "./solution-export-terminal-repository.js";
import { solutionExportExecutionIdentitySchema } from "./solution-export-terminal-codec.js";
import { SolutionExportWorkflowStorage } from "./solution-export-workflow-storage.js";
import { sql } from "./sql.js";
/** One bounded terminal export. Cancellation is derived by replaying the exact
 * persisted domain deletion command. All other outcomes use the existing
 * immutable worker/orphan receipt and archive verification algorithm. */
export async function recoverOneProjectDeletionExport(input: {
  authority: ProjectDeletionRecoveryAuthority;
  store: ObjectStore;
  history?: CleanupHistoryPort;
}) {
  const { authority, store } = input,
    b = authority.binding;
  const rows = await authority.query(
    sql(
      `SELECT x.*,j.record_version AS job_version,j.lifecycle_status AS job_state,j.input_sha256 AS job_input_sha256,
    s.snapshot_object_id,t.prior_snapshot_object_id,t.command_at,a.attempt_id,a.attempt_number,a.worker_reference
    FROM solution_export_runs x JOIN async_jobs j ON j.organization_id=x.organization_id AND j.job_id=x.root_job_id AND j.project_id=x.project_id
    JOIN async_job_record_snapshots s ON s.organization_id=j.organization_id AND s.job_id=j.job_id AND s.record_version=j.record_version
    LEFT JOIN project_deletion_job_terminals t ON t.organization_id=j.organization_id AND t.job_id=j.job_id AND t.terminal_record_version=j.record_version
    LEFT JOIN async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id
      AND a.attempt_number=(SELECT max(last.attempt_number) FROM async_job_attempts last WHERE last.organization_id=j.organization_id AND last.job_id=j.job_id)
    WHERE x.organization_id=$1 AND x.project_id=$2 AND x.lifecycle_status NOT IN('succeeded','failed','canceled')
      AND j.lifecycle_status IN('succeeded','failed','canceled','expired') ORDER BY x.created_at,x.solution_export_run_id LIMIT 1`,
      [b.organizationId, b.projectId],
    ),
  );
  const row = rows.rows[0];
  if (row === undefined) return { state: "idle" as const };
  const actor = exportRunText(row["created_by_principal_id"]),
    jobId = exportRunText(row["root_job_id"]);
  const hydrated = new ProjectDeletionCanonicalObjects(
    authority,
    store,
    [],
    input.history,
  );
  const rootId = exportRunText(row["snapshot_object_id"]);
  await hydrated.preload(rootId, actor);
  const metadata = await authority.query(
    sql("SELECT * FROM stored_objects WHERE object_id=$1", [rootId]),
  );
  const { exportStoredObject } =
    await import("./solution-export-workflow-storage.js");
  const root = parseAsyncJobRecordV1(
    JSON.parse(
      new TextDecoder().decode(
        await hydrated.read(
          exportStoredObject(cleanupRequired(metadata.rows[0])),
          actor,
        ),
      ),
    ),
  );
  if (
    root.jobId !== jobId ||
    root.recordVersion !== exportRunInteger(row["job_version"]) ||
    root.inputDigest !== `sha256:${exportRunText(row["job_input_sha256"])}` ||
    root.state !== row["job_state"] ||
    root.ownership.organizationId !== b.organizationId ||
    root.ownership.projectId !== b.projectId ||
    root.idempotency.actorId !== actor
  )
    throw Error("Deletion export root mismatch.");
  const wrapped = deletionExportObjects({
    authority,
    delegate: store,
    jobId,
    jobRecordVersion: root.recordVersion,
    actorId: actor,
    ...(input.history === undefined ? {} : { history: input.history }),
  });
  if (row["prior_snapshot_object_id"] != null) {
    const priorMetadata = await authority.query(
      sql(
        "SELECT * FROM stored_objects WHERE object_id=$1 AND lifecycle_state='published'",
        [exportRunText(row["prior_snapshot_object_id"])],
      ),
    );
    if (
      priorMetadata.rows.length !== 1 ||
      root.state !== "canceled" ||
      root.completedAt === undefined
    )
      throw Error("Deletion cancellation proof unavailable.");
    const prior = parseAsyncJobRecordV1(
      JSON.parse(
        new TextDecoder().decode(
          await hydrated.read(
            exportStoredObject(cleanupRequired(priorMetadata.rows[0])),
            actor,
          ),
        ),
      ),
    );
    const replay = cancelAsyncJobForProjectDeletionV1({
      job: prior,
      context: asyncJobTrustedContextV1Schema.parse({
        actor: { kind: "system", reason: "retention" },
        ownership: prior.ownership,
        correlationId: prior.correlationId,
      }),
      at: root.completedAt,
      expectedInputDigest: prior.inputDigest,
      expectedRecordVersion: prior.recordVersion,
      deletion: {
        recordVersion: b.recordVersion,
        requestedAt: b.deletionRequestedAt,
      },
    });
    if (!exportRunEqual(replay.job, root))
      throw Error("Deletion cancellation command replay mismatch.");
    const objectAuthority = {
      permission: "exports.run" as const,
      ownership: { organizationId: b.organizationId, projectId: b.projectId },
      query: authority.query.bind(authority),
      transaction: authority.transaction.bind(authority),
      scope: () =>
        Promise.resolve({
          organizationId: b.organizationId,
          principalId: actor,
          membershipId: "membership.retention",
          sessionId: "session.retention",
          roleKey: "retention",
          capabilities: [],
          correlationId: root.correlationId,
        }),
    };
    const storage = new SolutionExportWorkflowStorage(objectAuthority, wrapped);
    const snapshot = await storage.metadata(
      exportRunText(row["workflow_read_model_object_id"]),
    );
    if (
      snapshot?.state !== "published" ||
      snapshot.reference.contentSha256 !== row["workflow_read_model_sha256"]
    )
      throw Error("Deletion export snapshot mismatch.");
    const prepared = parseStoredExportRun(
      await storage.readJson(snapshot.reference),
    );
    if (
      prepared.job.state !== row["lifecycle_status"] ||
      prepared.job.id !== jobId ||
      prepared.createdByPrincipalId !== actor ||
      prepared.primaryInputDigest !== root.inputDigest
    )
      throw Error("Deletion export binding mismatch.");
    const projected = projectInjectedSolutionExportResult({
      material: {
        completedAt: root.completedAt,
        retentionExpiresAt: new Date(
          Date.parse(root.completedAt) + 30 * 86400000,
        ).toISOString(),
        stored: prepared,
      },
      submission: prepared.workflowSubmission,
      result: { outcome: { outcome: "canceled" } },
    });
    const next = await storage.put(
      exportRunBytes(projected.job),
      "checkpoint-state",
      "application/json",
    );
    await authority.transaction(async (tx) => {
      const updated = await tx.query(
        sql(
          `UPDATE solution_export_runs SET lifecycle_status='canceled',progress_message=$7,
        completed_at=$4::timestamptz,updated_at=$4::timestamptz,cancellation_requested_at=$8::timestamptz,cancellation_acknowledged_at=$4::timestamptz,
        workflow_read_model_object_id=$5,workflow_read_model_sha256=$6,record_version=record_version+1
        WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3 AND record_version=$9
        AND workflow_read_model_object_id=$10 AND lifecycle_status=$11
        AND EXISTS(SELECT 1 FROM async_jobs j WHERE j.organization_id=$1 AND j.job_id=$3 AND j.record_version=$12 AND j.lifecycle_status='canceled') RETURNING solution_export_run_id`,
          [
            b.organizationId,
            b.projectId,
            jobId,
            cleanupRequired(root.completedAt),
            next.objectId,
            next.contentSha256,
            projected.job.job.progress.message,
            projected.job.job.cancellation.requestedAt ??
              cleanupRequired(root.completedAt),
            exportRunInteger(row["record_version"]),
            snapshot.reference.objectId,
            String(row["lifecycle_status"]),
            root.recordVersion,
          ],
        ),
      );
      if (updated.rows.length !== 1)
        throw Error("Deletion export CAS changed.");
    });
  } else {
    const identity = solutionExportExecutionIdentitySchema.parse({
      organizationId: b.organizationId,
      projectId: b.projectId,
      jobId,
      actorId: actor,
      inputDigest: root.inputDigest,
      attemptId: exportRunText(row["attempt_id"]),
      attemptNumber: exportRunInteger(row["attempt_number"]),
      workerId: exportRunText(row["worker_reference"]),
    });
    await new PostgresSolutionExportTerminalRepository(
      authority.database,
      wrapped,
      identity,
      new ProjectDeletionExportTerminalAuthority(authority, identity),
    ).reconcile(root);
  }
  return { state: "recovered" as const, jobId };
}
