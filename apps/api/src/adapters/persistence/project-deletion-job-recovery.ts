import type { CleanupHistoryPort } from "../../application/project-cleanup-history.js";
import { cancelAsyncJobForProjectDeletionV1 } from "@cloudmarkup/domain";
import { createJobAuditOutboxEntryV1 } from "@cloudmarkup/job-framework";
import {
  asyncJobTrustedContextV1Schema,
  asyncJobTrustedOwnershipV1Schema,
} from "@cloudmarkup/schemas";
import { PostgresAsyncJobRepository } from "./async-job-repository.js";
import { ProjectDeletionRecoveryAuthority } from "./project-deletion-recovery-authority.js";
import { ProjectDeletionCanonicalObjects } from "./project-deletion-canonical-objects.js";
import type { ObjectStore } from "../../application/persistence.js";
import { bytesOf } from "./async-job-repository-codec.js";
import { sql, type SqlDatabase } from "./sql.js";
/** One bounded root/child per invocation. Canonical hydration and publication
 * finish before SQL CAS locks; no nested transport call may run under them.
 * Existing terminal outcomes, input/output and reservation links remain intact. */
export async function recoverOneProjectDeletionJob(input: {
  readonly authority: ProjectDeletionRecoveryAuthority;
  readonly store: ObjectStore;
  readonly history?: CleanupHistoryPort;
}) {
  const { authority, store } = input,
    b = authority.binding;
  const candidate = await authority.query(
    sql(
      `SELECT j.job_id,j.created_by_principal_id,j.input_object_id,j.output_object_id,s.snapshot_object_id,
    to_char(GREATEST(clock_timestamp(),j.updated_at,p.deletion_requested_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
    FROM async_jobs j JOIN projects p ON p.organization_id=j.organization_id AND p.project_id=j.project_id
    JOIN async_job_record_snapshots s ON s.organization_id=j.organization_id AND s.job_id=j.job_id AND s.record_version=j.record_version
    WHERE j.organization_id=$1 AND j.project_id=$2 AND j.lifecycle_status NOT IN('succeeded','failed','canceled','expired','superseded')
    AND NOT EXISTS(SELECT 1 FROM async_job_attempts a JOIN async_jobs r USING(organization_id,job_id)
      WHERE r.organization_id=j.organization_id AND r.project_id=j.project_id AND a.lifecycle_status='running' AND a.lease_expires_at>clock_timestamp())
    ORDER BY j.created_at,j.job_id LIMIT 1`,
      [b.organizationId, b.projectId],
    ),
  );
  const row = candidate.rows[0];
  if (candidate.rows.length === 0) return { state: "idle" as const };
  if (
    candidate.rows.length !== 1 ||
    typeof row?.["job_id"] !== "string" ||
    typeof row["created_by_principal_id"] !== "string" ||
    typeof row["observed_at"] !== "string"
  )
    throw Error("Deletion job authority is invalid.");
  const hydration = new ProjectDeletionCanonicalObjects(
    authority,
    store,
    [],
    input.history,
  );
  for (const key of [
    "snapshot_object_id",
    "input_object_id",
    "output_object_id",
  ] as const) {
    const id = row[key];
    if (id === null && key === "output_object_id") continue;
    if (typeof id !== "string")
      throw Error("Deletion snapshot identity is invalid.");
    await hydration.preload(id, row["created_by_principal_id"]);
  }
  const repository = new PostgresAsyncJobRepository({
    database: authority,
    objects: hydration.jobPort(),
    ownership: asyncJobTrustedOwnershipV1Schema.parse({
      organizationId: b.organizationId,
      projectId: b.projectId,
    }),
  });
  const prior = await repository.get(row["job_id"]);
  if (prior === null) throw Error("Deletion job disappeared.");
  const context = asyncJobTrustedContextV1Schema.parse({
    actor: { kind: "system", reason: "retention" },
    correlationId: prior.correlationId,
    ownership: prior.ownership,
  });
  const result = cancelAsyncJobForProjectDeletionV1({
    job: prior,
    context,
    at: row["observed_at"],
    expectedInputDigest: prior.inputDigest,
    expectedRecordVersion: prior.recordVersion,
    deletion: {
      recordVersion: b.recordVersion,
      requestedAt: b.deletionRequestedAt,
    },
  });
  if (result.transition === undefined) return { state: "unchanged" as const };
  const plan = {
    bytes: bytesOf(result.job),
    purpose: "report" as const,
    jobId: prior.jobId,
    jobRecordVersion: prior.recordVersion,
    createdByPrincipalId: row["created_by_principal_id"],
  };
  const publication = new ProjectDeletionCanonicalObjects(
    authority,
    store,
    [plan],
    input.history,
  );
  publication.importHydration(hydration);
  const published = await publication.publish(publication.identity(plan));
  const terminalDatabase: SqlDatabase = {
    query: authority.query.bind(authority),
    close: authority.close.bind(authority),
    transaction: (work) =>
      authority.transaction(async (tx) => {
        const value = await work(tx);
        await tx.query(
          sql(
            `INSERT INTO project_deletion_job_terminals(organization_id,project_id,job_id,deletion_record_version,
        prior_record_version,terminal_record_version,prior_snapshot_object_id,terminal_snapshot_object_id,command_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)`,
            [
              b.organizationId,
              b.projectId,
              prior.jobId,
              b.recordVersion,
              prior.recordVersion,
              result.job.recordVersion,
              String(row["snapshot_object_id"]),
              published.objectId,
              String(row["observed_at"]),
            ],
          ),
        );
        return value;
      }),
  };
  const finalRepository = new PostgresAsyncJobRepository({
    database: terminalDatabase,
    objects: publication.jobPort(),
    ownership: prior.ownership,
  });
  await finalRepository.saveWithAudit(result.job, prior.recordVersion, [
    createJobAuditOutboxEntryV1({
      actor: context.actor,
      eventType:
        result.job.state === "canceled" ? "job-canceled" : "job-expired",
      record: result.job,
      occurredAt: row["observed_at"],
      transition: result.transition,
    }),
  ]);
  return { state: "recovered" as const, jobId: prior.jobId };
}
