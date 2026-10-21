import { createHash } from "node:crypto";

import { hashCanonicalValue } from "@cloudmarkup/domain";
import {
  JobFrameworkError,
  type JobCreationClaimV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobCorrelationIdSchema,
  asyncJobIdempotencyClaimV1Schema,
  asyncJobIdSchema,
  asyncJobInputV1Schema,
  asyncJobLimitsV1Schema,
  asyncJobOrchestrationV1Schema,
  asyncJobPublicFailureMessageV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  namespacedIdentifierSchema,
  serializeCanonicalJson,
  sha256DigestSchema,
  utcTimestampSchema,
  type AsyncJobArtifactReferenceV1,
  type AsyncJobRecordV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import type { SqlRow, SqlValue } from "./sql.js";

export type JobSqlFields = Readonly<Record<string, SqlValue>>;
const jobTimestampColumns = new Set([
  "cancellation_acknowledged_at",
  "cancellation_requested_at",
  "claimed_at",
  "completed_at",
  "created_at",
  "expires_at",
  "heartbeat_at",
  "interaction_received_at",
  "interaction_requested_at",
  "lease_expires_at",
  "occurred_at",
  "progress_updated_at",
  "published_at",
  "queued_at",
  "reserved_at",
  "retry_not_before",
  "started_at",
  "transition_at",
  "updated_at",
]);

/** Bind program-owned job projections with explicit SQL timestamp types.
 * Other strings keep their declared column semantics; values are never guessed. */
export function jobSqlParameter(column: string, index: number): string {
  const parameter = "$" + String(index + 1);
  return jobTimestampColumns.has(column)
    ? parameter + "::timestamptz"
    : parameter;
}

export interface JobObjectReference {
  readonly objectId: string;
  readonly digest: Sha256Digest;
  readonly sizeBytes: number;
}

const denialSchema = z
  .object({
    code: namespacedIdentifierSchema,
    publicMessage: asyncJobPublicFailureMessageV1Schema,
  })
  .strict();
export const jobClaimSnapshotSchema = z
  .object({
    claimedAt: utcTimestampSchema,
    correlationId: asyncJobCorrelationIdSchema,
    creation: z
      .object({
        expiresAt: utcTimestampSchema.optional(),
        input: asyncJobInputV1Schema,
        inputDigest: sha256DigestSchema,
        inputSizeBytes: z.number().int().nonnegative(),
        limits: asyncJobLimitsV1Schema,
        orchestration: asyncJobOrchestrationV1Schema,
        reservationRequested: z.boolean(),
      })
      .strict(),
    denial: denialSchema.nullable(),
    entitlementDecision: z
      .object({
        allowed: z.boolean(),
        decisionReference: z.string().min(1).max(128),
        denialCode: namespacedIdentifierSchema.optional(),
        publicMessage: asyncJobPublicFailureMessageV1Schema.optional(),
      })
      .strict()
      .nullable(),
    idempotency: asyncJobIdempotencyClaimV1Schema,
    jobId: asyncJobIdSchema,
    ownership: asyncJobTrustedOwnershipV1Schema,
    recordVersion: z.number().int().positive(),
    reservationDecision: z
      .object({
        allowed: z.boolean(),
        reservationId: z.string().min(1).max(128).optional(),
        denialCode: namespacedIdentifierSchema.optional(),
        publicMessage: asyncJobPublicFailureMessageV1Schema.optional(),
      })
      .strict()
      .nullable(),
    status: z.enum(["claimed", "completed", "denied"]),
    updatedAt: utcTimestampSchema,
  })
  .strict()
  .transform((claim): JobCreationClaimV1 => {
    const { expiresAt, ...creation } = claim.creation;
    const entitlement = claim.entitlementDecision;
    const reservation = claim.reservationDecision;
    return {
      ...claim,
      creation: {
        ...creation,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      },
      entitlementDecision:
        entitlement === null
          ? null
          : {
              allowed: entitlement.allowed,
              decisionReference: entitlement.decisionReference,
              ...(entitlement.denialCode === undefined
                ? {}
                : { denialCode: entitlement.denialCode }),
              ...(entitlement.publicMessage === undefined
                ? {}
                : { publicMessage: entitlement.publicMessage }),
            },
      reservationDecision:
        reservation === null
          ? null
          : {
              allowed: reservation.allowed,
              ...(reservation.reservationId === undefined
                ? {}
                : { reservationId: reservation.reservationId }),
              ...(reservation.denialCode === undefined
                ? {}
                : { denialCode: reservation.denialCode }),
              ...(reservation.publicMessage === undefined
                ? {}
                : { publicMessage: reservation.publicMessage }),
            },
    };
  });

export function persistenceFailure(code = "job.persistence-integrity"): never {
  throw new JobFrameworkError(
    code,
    "The durable job state could not be verified.",
  );
}
export function hex(digest: Sha256Digest): string {
  return digest.slice(7);
}
export function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(serializeCanonicalJson(value));
}
export function digestBytes(bytes: Uint8Array): Sha256Digest {
  return sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  );
}
export function same(left: unknown, right: unknown): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}
export function textColumn(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") return persistenceFailure();
  return value;
}
export function numberColumn(row: SqlRow, column: string): number {
  const value = row[column];
  const result = typeof value === "string" ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result))
    return persistenceFailure();
  return result;
}
function normalizedTimestamp(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) return persistenceFailure();
    return utcTimestampSchema.parse(value.toISOString());
  }
  if (typeof value !== "string") return persistenceFailure();
  // RDS Data API emits UTC TIMESTAMPTZ without a zone. Recognize only its
  // SQL spelling explicitly; never interpret an unzoned ISO string locally.
  const sqlUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/u.test(
    value,
  );
  const zoned =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/u.test(
      value,
    );
  if (!sqlUtc && !zoned) return persistenceFailure();
  const iso = sqlUtc
    ? `${value.replace(" ", "T")}Z`
    : value.replace(" ", "T").replace(/([+-]\d{2})$/u, "$1:00");
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return persistenceFailure();
  return utcTimestampSchema.parse(date.toISOString());
}
export function timestampColumn(row: SqlRow, column: string): string {
  return normalizedTimestamp(row[column]);
}
export function verifyProjection(row: SqlRow, fields: JobSqlFields): void {
  for (const [column, expected] of Object.entries(fields)) {
    const actual = row[column];
    const normalized =
      actual instanceof Date
        ? actual.toISOString()
        : typeof expected === "number" && typeof actual === "string"
          ? Number(actual)
          : actual;
    if (
      typeof expected === "string" &&
      column.endsWith("_at") &&
      typeof normalized === "string"
    ) {
      if (normalizedTimestamp(expected) !== normalizedTimestamp(normalized))
        persistenceFailure();
    } else if (normalized !== expected) persistenceFailure();
  }
}
export function objectFromRow(
  row: SqlRow,
  prefix: "input" | "output" | "snapshot",
): JobObjectReference {
  return {
    objectId: textColumn(row, `${prefix}_object_id`),
    digest: sha256DigestSchema.parse(
      `sha256:${textColumn(row, `${prefix}_sha256`)}`,
    ),
    sizeBytes: numberColumn(
      row,
      prefix === "input" ? "inline_input_size_bytes" : `${prefix}_size_bytes`,
    ),
  };
}

export function inputProjection(
  creation: JobCreationClaimV1["creation"],
  input: JobObjectReference,
): JobSqlFields {
  const subject = creation.input.subject;
  const environment =
    "environment" in creation.input ? creation.input.environment : undefined;
  const references: number[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (
      typeof item["objectId"] === "string" &&
      typeof item["sizeBytes"] === "number"
    ) {
      references.push(item["sizeBytes"]);
      return;
    }
    Object.values(item).forEach(visit);
  };
  visit(creation.input);
  return {
    family: creation.input.family,
    subject_kind: subject.kind,
    draft_id: subject.kind === "draft" ? subject.draftId : null,
    draft_version: subject.kind === "draft" ? subject.draftVersion : null,
    draft_strong_etag: subject.kind === "draft" ? subject.etag : null,
    draft_content_sha256:
      subject.kind === "draft" ? hex(subject.contentDigest) : null,
    solution_revision_id:
      subject.kind === "solution-revision" ? subject.solutionRevisionId : null,
    solution_manifest_record_id:
      subject.kind === "solution-revision" ? subject.manifestRecordId : null,
    solution_manifest_sha256:
      subject.kind === "solution-revision" ? hex(subject.manifestDigest) : null,
    environment_id: environment?.environmentId ?? null,
    environment_type: environment?.environmentType ?? null,
    input_object_id: input.objectId,
    input_sha256: hex(creation.inputDigest),
    inline_input_size_bytes: creation.inputSizeBytes,
    referenced_input_size_bytes: references.reduce(
      (sum, size) => sum + size,
      0,
    ),
    root_job_id: creation.orchestration.rootJobId,
    parent_job_id: creation.orchestration.parentJobId ?? null,
    parent_failure_policy: creation.orchestration.failurePolicy,
    max_attempts: creation.limits.attemptCount,
    max_runtime_seconds: creation.limits.runtimeSeconds,
    max_referenced_input_bytes: creation.limits.referencedInputBytes,
    max_inline_input_bytes: creation.limits.inlineInputBytes,
    max_output_bytes: creation.limits.outputBytes,
    max_checkpoint_bytes: creation.limits.checkpointBytes,
    max_checkpoints: creation.limits.checkpointCount,
    max_artifacts: creation.limits.artifactCount,
    expires_at: creation.expiresAt ?? null,
  };
}
export function claimProjection(
  claim: JobCreationClaimV1,
  input: JobObjectReference,
): JobSqlFields {
  return {
    organization_id: claim.ownership.organizationId,
    project_id: claim.ownership.projectId ?? null,
    operation_id: claim.idempotency.operationId,
    idempotency_key_sha256: hex(claim.idempotency.keyDigest),
    request_sha256: hex(claim.idempotency.requestDigest),
    actor_id: claim.idempotency.actorId,
    correlation_id: claim.correlationId,
    job_id: claim.jobId,
    creation_plan_contract_version: 1,
    creation_plan_sha256: hex(hashCanonicalValue(claim.creation)),
    ...inputProjection(claim.creation, input),
    reservation_requested: claim.creation.reservationRequested,
    claim_status: claim.status,
    entitlement_outcome:
      claim.entitlementDecision === null
        ? null
        : claim.entitlementDecision.allowed
          ? "allowed"
          : "denied",
    entitlement_decision_reference:
      claim.entitlementDecision?.decisionReference ?? null,
    entitlement_denial_code: claim.entitlementDecision?.denialCode ?? null,
    entitlement_public_message:
      claim.entitlementDecision?.publicMessage ?? null,
    reservation_outcome:
      claim.reservationDecision === null
        ? null
        : claim.reservationDecision.allowed
          ? "allowed"
          : "denied",
    reservation_reference: claim.reservationDecision?.reservationId ?? null,
    reservation_denial_code: claim.reservationDecision?.denialCode ?? null,
    reservation_public_message:
      claim.reservationDecision?.publicMessage ?? null,
    denial_code: claim.denial?.code ?? null,
    denial_public_message: claim.denial?.publicMessage ?? null,
    claimed_at: claim.claimedAt,
    updated_at: claim.updatedAt,
    record_version: claim.recordVersion,
  };
}

export function artifactsOf(
  record: AsyncJobRecordV1,
): readonly AsyncJobArtifactReferenceV1[] {
  if (record.output === undefined) return [];
  return Object.values(record.output).filter(
    (value): value is AsyncJobArtifactReferenceV1 =>
      value !== null &&
      typeof value === "object" &&
      "artifactId" in value &&
      "availability" in value,
  );
}

export function recordProjection(
  record: AsyncJobRecordV1,
  input: JobObjectReference,
  output: JobObjectReference | null,
  entitlementReference: string,
): JobSqlFields {
  const interaction =
    record.interaction.state === "none" ? undefined : record.interaction;
  const response =
    interaction?.state === "user-input-received"
      ? interaction.userResponse
      : undefined;
  const cancel =
    record.cancellation.state === "none" ? undefined : record.cancellation;
  return {
    ...inputProjection(
      {
        input: record.input,
        inputDigest: record.inputDigest,
        inputSizeBytes: record.inputSizeBytes,
        limits: record.limits,
        orchestration: record.orchestration,
        reservationRequested: record.reservation.state === "reserved",
        ...(record.expiresAt === undefined
          ? {}
          : { expiresAt: record.expiresAt }),
      },
      input,
    ),
    job_id: record.jobId,
    organization_id: record.ownership.organizationId,
    project_id: record.ownership.projectId ?? null,
    storage_contract_version: 1,
    job_contract_version: 1,
    lifecycle_status: record.state,
    output_object_id: output?.objectId ?? null,
    output_sha256: output === null ? null : hex(output.digest),
    output_size_bytes: output?.sizeBytes ?? null,
    measured_output_size_bytes: record.outputSizeBytes ?? null,
    idempotency_scope: record.idempotency.operationId,
    idempotency_key_sha256: hex(record.idempotency.keyDigest),
    idempotency_actor_id: record.idempotency.actorId,
    idempotency_request_sha256: hex(record.idempotency.requestDigest),
    correlation_id: record.correlationId,
    entitlement_decision_reference: entitlementReference,
    reservation_reference:
      record.reservation.state === "reserved"
        ? record.reservation.reservationId
        : null,
    progress_phase: record.progress?.phase ?? null,
    progress_sequence: record.progress?.sequence ?? null,
    progress_completed_units: record.progress?.completedUnits ?? null,
    progress_total_units: record.progress?.totalUnits ?? null,
    progress_message_key: record.progress?.messageKey ?? null,
    progress_updated_at: record.progress?.updatedAt ?? null,
    attempt_count: record.attempts.length,
    checkpoint_count: record.checkpoints.length,
    artifact_count: artifactsOf(record).length,
    cancellation_requested_at: cancel?.requestedAt ?? null,
    cancellation_requested_by: cancel?.requestedBy ?? null,
    cancellation_acknowledged_at:
      cancel?.state === "acknowledged" ? cancel.acknowledgedAt : null,
    interaction_state: record.interaction.state,
    interaction_id: interaction?.interactionId ?? null,
    interaction_checkpoint_id: interaction?.checkpointId ?? null,
    interaction_handler_id: interaction?.handlerId ?? null,
    interaction_handler_version: interaction?.handlerVersion ?? null,
    interaction_requested_at: interaction?.requestedAt ?? null,
    interaction_response_object_id: response?.objectId ?? null,
    interaction_response_sha256:
      response === undefined ? null : hex(response.digest),
    interaction_response_size_bytes: response?.sizeBytes ?? null,
    interaction_received_at:
      interaction?.state === "user-input-received"
        ? interaction.receivedAt
        : null,
    latest_checkpoint_id: record.latestCheckpointId ?? null,
    superseded_by_job_id: record.supersededByJobId ?? null,
    safe_failure_code: record.failure?.code ?? null,
    failure_classification: record.failure?.classification ?? null,
    internal_error_id: record.failure?.internalErrorId ?? null,
    public_failure_message: record.failure?.publicMessage ?? null,
    failure_retry_after_seconds: record.failure?.retryAfterSeconds ?? null,
    created_by_actor_kind: "principal",
    created_by_actor_reference: record.idempotency.actorId,
    created_by_principal_id: record.idempotency.actorId,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    queued_at: record.queuedAt,
    started_at: record.startedAt ?? null,
    completed_at: record.completedAt ?? null,
    record_version: record.recordVersion,
  };
}

export function immutableRecordAuthority(record: AsyncJobRecordV1): unknown {
  return {
    contractVersion: record.contractVersion,
    correlationId: record.correlationId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    family: record.family,
    idempotency: record.idempotency,
    input: record.input,
    inputDigest: record.inputDigest,
    inputSizeBytes: record.inputSizeBytes,
    jobId: record.jobId,
    limits: record.limits,
    orchestration: record.orchestration,
    ownership: record.ownership,
    queuedAt: record.queuedAt,
    reservation: record.reservation,
  };
}
