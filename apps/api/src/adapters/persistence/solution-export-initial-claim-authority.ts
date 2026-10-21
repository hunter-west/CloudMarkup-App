import {
  asyncJobQueueEnvelopeV1Schema,
  asyncJobTrustedContextV1Schema,
  sha256DigestSchema,
  type AsyncJobQueueEnvelopeV1,
  type AsyncJobTrustedContextV1,
} from "@cloudmarkup/schemas";
import type { OrganizationRole } from "../../application/authorization.js";
import { ApplicationError } from "../../application/errors.js";
import { solutionExportCanonicalExecutionRole } from "./solution-export-canonical-execution-role.js";
import {
  exportRunInteger,
  exportRunText,
} from "./solution-export-run-codec.js";
import { sql, type SqlExecutor } from "./sql.js";

export interface SolutionExportInitialClaimBinding {
  readonly context: AsyncJobTrustedContextV1;
  readonly envelope: AsyncJobQueueEnvelopeV1;
  readonly membershipId: string;
  readonly role: OrganizationRole;
  readonly runRecordVersion: number;
  readonly rootSnapshot: {
    readonly objectId: string;
    readonly digest: string;
    readonly sizeBytes: number;
  };
}

function unavailable(): never {
  throw new ApplicationError(
    "not_found",
    "The export execution is unavailable.",
  );
}
function stale(): never {
  throw new ApplicationError(
    "conflict",
    "The export delivery is no longer current.",
  );
}

/** Initial attempt only: retry/resume availability must not be approximated here. */
export function parseSolutionExportInitialEnvelope(
  input: unknown,
): AsyncJobQueueEnvelopeV1 {
  const envelope = parseSolutionExportExecutionEnvelope(input);
  if (envelope.attemptNumber !== 1)
    throw new ApplicationError(
      "invalid_request",
      "An initial export delivery is required.",
    );
  return envelope;
}

export function parseSolutionExportExecutionEnvelope(
  input: unknown,
): AsyncJobQueueEnvelopeV1 {
  const envelope = asyncJobQueueEnvelopeV1Schema.parse(input);
  if (
    envelope.family !== "solution-export-orchestration" ||
    envelope.ownership.projectId === undefined ||
    !Number.isSafeInteger(envelope.recordVersion) ||
    envelope.recordVersion >= Number.MAX_SAFE_INTEGER
  )
    throw new ApplicationError(
      "invalid_request",
      "A valid export delivery is required.",
    );
  return envelope;
}

/**
 * Metadata-only initial-claim authority, NOT a claim operation or consumer.
 *
 * tx MUST be the same live transaction used by the subsequent existing domain
 * claim + PostgresAsyncJobRepository CAS/audit commit. A return value is diagnostic
 * binding data, not reusable authorization after that transaction ends. Hydration
 * and full prepared-source byte verification remain the caller's separate duty.
 * Call after those reads and immediately before claim; do not perform S3 I/O here.
 *
 * Lock order: exact project SHARE; root UPDATE; prepared run and current creator
 * authority SHARE; completed original claim and immutable versioned snapshot
 * read under the root lock; exact stored-object rows in sorted identity order SHARE. Project SHARE
 * blocks lifecycle mutation while remaining compatible with FK KEY SHARE.
 *
 * The original HTTP session is deliberately absent: ADR0026 durable authority
 * derives the original principal from storage and rechecks its CURRENT canonical
 * rights. This neither fabricates PrincipalContext nor labels queued work running.
 */
export async function authorizeSolutionExportInitialClaim(
  tx: SqlExecutor,
  input: unknown,
): Promise<SolutionExportInitialClaimBinding> {
  return authorizeSolutionExportClaim(
    tx,
    parseSolutionExportInitialEnvelope(input),
  );
}

/** Initial and retry claims share immutable source and current creator checks.
 * Retries additionally require the exact persisted failed attempt and due time. */
export async function authorizeSolutionExportClaim(
  tx: SqlExecutor,
  input: unknown,
): Promise<SolutionExportInitialClaimBinding> {
  const envelope = parseSolutionExportExecutionEnvelope(input);
  const { organizationId, projectId } = envelope.ownership;
  const project = await tx.query(
    sql(
      "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status='active' FOR SHARE",
      [organizationId, projectId ?? null],
    ),
  );
  if (project.rows.length !== 1) unavailable();
  // Fresh statement after root lock: a winning contender's current version and
  // matching committed snapshot must be visible at READ COMMITTED.
  const locked = await tx.query(
    sql(
      "SELECT job_id FROM async_jobs WHERE organization_id=$1 AND project_id=$2 AND job_id=$3 FOR UPDATE",
      [organizationId, projectId ?? null, envelope.jobId],
    ),
  );
  if (locked.rows.length !== 1) unavailable();
  const result = await tx.query(
    sql(
      `SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json,
      j.created_by_principal_id AS actor_id,j.correlation_id,j.record_version,
      x.record_version AS run_record_version,
      j.lifecycle_status AS root_state,x.lifecycle_status AS run_state,
      j.attempt_count,j.interaction_state,
      j.cancellation_requested_at IS NOT NULL AS root_canceled,
      x.cancellation_requested_at IS NOT NULL AS run_canceled,
      j.input_sha256,
      to_char(COALESCE((SELECT a.retry_not_before FROM async_job_attempts a
        WHERE a.organization_id=j.organization_id AND a.job_id=j.job_id
          AND a.attempt_number=j.attempt_count AND a.lifecycle_status IN ('failed','orphaned')
          AND a.retry_disposition='retry'),j.queued_at)
        AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS queued_at
     FROM solution_export_runs x
     JOIN async_jobs j ON j.organization_id=x.organization_id AND j.project_id=x.project_id
       AND j.job_id=x.root_job_id AND j.job_id=x.solution_export_run_id
     JOIN principals actor ON actor.principal_id=x.created_by_principal_id AND actor.lifecycle_status='active'
     JOIN memberships m ON m.organization_id=x.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
     JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
     JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
     WHERE x.organization_id=$1 AND x.project_id=$2 AND x.solution_export_run_id=$3
       AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL
       AND j.family='solution-export-orchestration' AND j.subject_kind='solution-revision'
       AND j.created_by_actor_kind='principal' AND j.idempotency_scope='solution-export-jobs.create'
       AND j.created_by_principal_id=x.created_by_principal_id AND j.idempotency_actor_id=x.created_by_principal_id
       AND j.solution_revision_id=x.solution_revision_id
       AND j.solution_manifest_record_id=x.solution_manifest_record_id AND j.solution_manifest_sha256=x.solution_manifest_sha256
       AND j.environment_type=x.environment_type AND j.environment_id IS NOT DISTINCT FROM x.environment_id
       AND j.input_object_id=x.orchestration_input_object_id AND j.input_sha256=x.orchestration_input_sha256
       AND j.entitlement_decision_reference=x.entitlement_decision_reference
     FOR SHARE OF x,actor,m,o,r`,
      [organizationId, projectId ?? null, envelope.jobId],
    ),
  );
  const role = solutionExportCanonicalExecutionRole(result.rows);
  const row = result.rows[0];
  if (row === undefined) unavailable();
  if (
    row["root_state"] !== "queued" ||
    row["run_state"] !== "queued" ||
    (envelope.attemptNumber === 1
      ? row["attempt_count"] !== 0 &&
        row["attempt_count"] !== "0" &&
        row["attempt_count"] !== 0n
      : exportRunInteger(row["attempt_count"]) !==
        envelope.attemptNumber - 1) ||
    row["interaction_state"] !== "none" ||
    row["root_canceled"] !== false ||
    row["run_canceled"] !== false ||
    exportRunInteger(row["record_version"]) !== envelope.recordVersion ||
    row["correlation_id"] !== envelope.correlationId ||
    row["queued_at"] !== envelope.availableAt ||
    row["input_sha256"] !== envelope.inputDigest.slice(7)
  )
    stale();
  // This statement takes a fresh READ COMMITTED snapshot after the root UPDATE
  // lock. The completed claim cannot transition again; its identity reservation
  // FK prevents removal while the root exists. Record snapshots reject UPDATE
  // and DELETE and are unique by root/version. Thus these exact binding rows
  // need no row lock (which requires UPDATE privilege even for FOR SHARE).
  // Keep mutable root/run/creator and published-object locks through the CAS.
  const prepared = await tx.query(
    sql(
      `SELECT s.snapshot_object_id,s.snapshot_sha256,s.snapshot_size_bytes,
      x.workflow_read_model_object_id,x.workflow_read_model_sha256,
      x.workflow_request_object_id,x.request_sha256,
      x.orchestration_input_object_id,x.orchestration_input_sha256,
      m.content_object_id AS manifest_object_id,m.content_sha256 AS manifest_sha256
     FROM async_jobs j
     JOIN solution_export_runs x ON x.organization_id=j.organization_id AND x.project_id=j.project_id
       AND x.root_job_id=j.job_id AND x.solution_export_run_id=j.job_id
     JOIN async_job_creation_claims c ON c.organization_id=j.organization_id AND c.project_id=j.project_id
       AND c.job_id=j.job_id AND c.actor_id=j.created_by_principal_id
       AND c.operation_id='solution-export-jobs.create' AND c.claim_status='completed' AND c.entitlement_outcome='allowed'
       AND c.entitlement_decision_reference=j.entitlement_decision_reference
       AND c.idempotency_key_sha256=j.idempotency_key_sha256 AND c.request_sha256=j.idempotency_request_sha256
     JOIN async_job_record_snapshots s ON s.organization_id=j.organization_id AND s.project_id=j.project_id
       AND s.job_id=j.job_id AND s.record_version=j.record_version
     JOIN solution_records m ON m.organization_id=x.organization_id AND m.project_id=x.project_id
       AND m.solution_record_id=x.solution_manifest_record_id AND m.record_kind='solution-revision-manifest'
       AND m.subject_id=x.solution_revision_id AND m.content_sha256=x.solution_manifest_sha256
     WHERE j.organization_id=$1 AND j.project_id=$2 AND j.job_id=$3
       AND (SELECT count(*) FROM async_job_attempts a
         WHERE a.organization_id=j.organization_id AND a.job_id=j.job_id)=j.attempt_count
       AND (j.attempt_count=0 OR EXISTS (SELECT 1 FROM async_job_attempts a
         WHERE a.organization_id=j.organization_id AND a.job_id=j.job_id
           AND a.attempt_number=j.attempt_count AND a.lifecycle_status IN ('failed','orphaned')
           AND a.retry_disposition='retry' AND a.retry_not_before IS NOT NULL))`,
      [organizationId, projectId ?? null, envelope.jobId],
    ),
  );
  const exact = prepared.rows[0];
  if (prepared.rows.length !== 1 || exact === undefined) unavailable();
  const expected = [
    {
      objectId: exportRunText(exact["snapshot_object_id"]),
      digest: exportRunText(exact["snapshot_sha256"]),
      purpose: "report",
      size: exportRunInteger(exact["snapshot_size_bytes"]),
    },
    {
      objectId: exportRunText(exact["workflow_read_model_object_id"]),
      digest: exportRunText(exact["workflow_read_model_sha256"]),
      purpose: "checkpoint-state",
    },
    {
      objectId: exportRunText(exact["workflow_request_object_id"]),
      digest: exportRunText(exact["request_sha256"]),
      purpose: "input-payload",
    },
    {
      objectId: exportRunText(exact["orchestration_input_object_id"]),
      digest: exportRunText(exact["orchestration_input_sha256"]),
      purpose: "input-payload",
    },
    {
      objectId: exportRunText(exact["manifest_object_id"]),
      digest: exportRunText(exact["manifest_sha256"]),
      purpose: "solution-revision-manifest",
    },
  ];
  const ids = [...new Set(expected.map((value) => value.objectId))].sort();
  // A JSON parameter avoids interpolating delivery-derived identifiers into SQL.
  const objects = await tx.query(
    sql(
      `SELECT object_id,content_sha256,object_purpose,size_bytes,media_type,lifecycle_state
     FROM stored_objects WHERE organization_id=$1 AND project_id=$2
       AND object_id IN (SELECT jsonb_array_elements_text($3::jsonb))
     ORDER BY object_id FOR SHARE`,
      [organizationId, projectId ?? null, JSON.stringify(ids)],
    ),
  );
  if (objects.rows.length !== ids.length) unavailable();
  for (const reference of expected) {
    const object = objects.rows.find(
      (value) => value["object_id"] === reference.objectId,
    );
    if (
      object?.["content_sha256"] !== reference.digest ||
      object["object_purpose"] !== reference.purpose ||
      object["media_type"] !== "application/json" ||
      object["lifecycle_state"] !== "published" ||
      exportRunInteger(object["size_bytes"]) > 4 * 1024 * 1024 ||
      ("size" in reference &&
        exportRunInteger(object["size_bytes"]) !== reference.size)
    )
      unavailable();
  }
  // Recheck time after every potentially-blocking metadata lock.
  const current = await tx.query(
    sql(
      `SELECT (j.expires_at IS NULL OR j.expires_at > clock_timestamp())
        AND j.queued_at <= clock_timestamp() AND (j.attempt_count=0 OR EXISTS (
          SELECT 1 FROM async_job_attempts a WHERE a.organization_id=j.organization_id
            AND a.job_id=j.job_id AND a.attempt_number=j.attempt_count
            AND a.lifecycle_status IN ('failed','orphaned') AND a.retry_disposition='retry'
            AND a.retry_not_before <= clock_timestamp())) AS current
     FROM async_jobs j WHERE j.organization_id=$1 AND j.project_id=$2 AND j.job_id=$3`,
      [organizationId, projectId ?? null, envelope.jobId],
    ),
  );
  if (current.rows[0]?.["current"] !== true) stale();
  const context = asyncJobTrustedContextV1Schema.parse({
    actor: { kind: "principal", actorId: exportRunText(row["actor_id"]) },
    correlationId: envelope.correlationId,
    ownership: envelope.ownership,
  });
  return {
    context,
    envelope,
    role,
    membershipId: exportRunText(row["membership_id"]),
    runRecordVersion: exportRunInteger(row["run_record_version"]),
    rootSnapshot: {
      objectId: exportRunText(exact["snapshot_object_id"]),
      digest: sha256DigestSchema.parse(
        `sha256:${exportRunText(exact["snapshot_sha256"])}`,
      ),
      sizeBytes: exportRunInteger(exact["snapshot_size_bytes"]),
    },
  };
}
