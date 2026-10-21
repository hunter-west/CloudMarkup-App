import { createHash } from "node:crypto";
import { solutionExportJobV1Schema } from "@cloudmarkup/api-contract";
import {
  serializeCanonicalJson,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { solutionExportWorkflowRequestV1Schema } from "@cloudmarkup/solution-export-workflow/contracts";
import { z } from "zod";
import { ApplicationError } from "../../application/errors.js";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";
import type { StoredSolutionExportJob } from "../../application/solution-exports.js";
import type { StoredObjectReference } from "../../application/persistence.js";
import type { SqlRow, SqlValue } from "./sql.js";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const EXPORT_RUN_SNAPSHOT_LIMIT = 4 * 1024 * 1024;
export const EXPORT_RUN_TERRAFORM_PROFILE =
  "cloudmarkup.export.terraform-nodejs24-v1";
export function exportRunTargetProfile(
  target: "terraform" | "cloudformation",
): string {
  return target === "terraform"
    ? EXPORT_RUN_TERRAFORM_PROFILE
    : "cloudmarkup.export.cloudformation-nodejs24-v1";
}
const recordSchema = z
  .object({
    createdByPrincipalId: identifier,
    primaryInputDigest: sha256DigestSchema,
    requestIntentDigest: sha256DigestSchema,
    job: solutionExportJobV1Schema,
    organizationId: identifier,
    targetProfileId: identifier,
    workflowSubmission: z
      .object({
        createdByPrincipalId: identifier,
        entitlementDecisionReference: identifier,
        jobId: identifier,
        organizationId: identifier,
        previousArtifactId: identifier.optional(),
        projectId: identifier,
        primaryInputDigest: sha256DigestSchema,
        request: solutionExportWorkflowRequestV1Schema,
        requestDigest: sha256DigestSchema,
      })
      .strict(),
  })
  .strict();

export function exportRunUnavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "The prepared export journal is unavailable.",
  );
}
export function exportRunConflict(): never {
  throw new ApplicationError(
    "conflict",
    "The prepared export changed. Read its current state before retrying.",
  );
}
export function exportRunBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(serializeCanonicalJson(value));
}
export function exportRunSha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function exportRunEqual(left: unknown, right: unknown): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}
export function exportRunInteger(value: unknown): number {
  const parsed =
    typeof value === "bigint" ||
    (typeof value === "string" && /^[1-9][0-9]*$/u.test(value))
      ? Number(value)
      : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1)
    exportRunUnavailable();
  return parsed;
}
export function exportRunText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) exportRunUnavailable();
  return value;
}
export function exportRunTimestamp(value: unknown): string {
  const parsed = exportRunText(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(parsed) ||
    new Date(parsed).toISOString() !== parsed
  )
    exportRunUnavailable();
  return parsed;
}

/** Internal checkpoint body, not a new public job/worker authority. */
export function parsePreparedExportRun(
  value: unknown,
): StoredSolutionExportJob {
  return parseExportRun(value, true);
}

/** Terminal reads use the same immutable bindings; prepared insertion remains restricted. */
export function parseStoredExportRun(value: unknown): StoredSolutionExportJob {
  return parseExportRun(value, false);
}

function parseExportRun(
  value: unknown,
  preparedOnly: boolean,
): StoredSolutionExportJob {
  const parsed = recordSchema.parse(value);
  const record = parsed as StoredSolutionExportJob;
  const submission = record.workflowSubmission;
  const binding = createSolutionExportRunInsertionBindingV1(submission);
  const job = record.job;
  const request = submission.request;
  if (
    record.targetProfileId !==
      exportRunTargetProfile(request.targetSettings.target) ||
    request.targetProfileId !== record.targetProfileId ||
    job.target.profileId !== record.targetProfileId ||
    (job.progress.currentStage === "terraform-validation" &&
      request.targetSettings.target !== "terraform") ||
    (job.progress.currentStage === "cloudformation-validation" &&
      request.targetSettings.target !== "cloudformation") ||
    submission.organizationId !== record.organizationId ||
    submission.projectId !== job.projectId ||
    submission.createdByPrincipalId !== record.createdByPrincipalId ||
    submission.jobId !== job.id ||
    record.primaryInputDigest !== binding.primaryInputSha256 ||
    job.requestDigest !== binding.requestSha256 ||
    job.target.settingsDigest !== binding.targetSettingsSha256 ||
    job.target.exportName !== request.exportName ||
    job.target.applicationSource !== request.applicationSource ||
    !exportRunEqual(job.target.environment, request.environment) ||
    !exportRunEqual(job.solutionRevision, {
      manifestDigest: request.subject.manifestDigest,
      manifestRecordId: request.subject.manifestRecordId,
      solutionRevisionId: request.subject.solutionRevisionId,
    }) ||
    (job.previousArtifactId ?? null) !==
      (submission.previousArtifactId ?? null) ||
    (preparedOnly &&
      (!["queued", "running", "cancellation-requested"].includes(job.state) ||
        job.artifact !== undefined ||
        job.completedAt !== undefined ||
        job.applicationVerification !== undefined ||
        job.applicationVerifications !== undefined ||
        job.progress.currentStage === "diagram-rendering" ||
        job.progress.completedStages > 7 ||
        job.cancellation.state === "acknowledged")) ||
    (job.state === "cancellation-requested" &&
      job.cancellation.state !== "requested") ||
    (job.cancellation.state === "requested" &&
      job.state !== "cancellation-requested" &&
      (preparedOnly || job.state !== "failed")) ||
    Date.parse(job.updatedAt) < Date.parse(job.createdAt)
  )
    exportRunUnavailable();
  if (exportRunBytes(record).length > EXPORT_RUN_SNAPSHOT_LIMIT)
    exportRunUnavailable();
  return record;
}

/** Only polling state may vary; all creation/source/coverage commitments remain immutable. */
export function immutableExportRun(record: StoredSolutionExportJob): unknown {
  const {
    cancellation: _cancellation,
    pollAfterMilliseconds: _poll,
    progress: _progress,
    stages: _stages,
    state: _state,
    updatedAt: _updated,
    ...job
  } = record.job;
  void _cancellation;
  void _poll;
  void _progress;
  void _stages;
  void _state;
  void _updated;
  return { ...record, job };
}

export function exportRunFields(
  record: StoredSolutionExportJob,
  idempotencyKeyDigest: string,
): Readonly<Record<string, SqlValue>> {
  const binding = createSolutionExportRunInsertionBindingV1(
    record.workflowSubmission,
  );
  const job = record.job;
  return {
    solution_export_run_id: job.id,
    organization_id: record.organizationId,
    project_id: job.projectId,
    root_job_id: job.id,
    solution_revision_id: job.solutionRevision.solutionRevisionId,
    solution_manifest_record_id: job.solutionRevision.manifestRecordId,
    solution_manifest_subject_id: job.solutionRevision.solutionRevisionId,
    solution_manifest_sha256: job.solutionRevision.manifestDigest.slice(7),
    environment_id: job.target.environment.environmentId ?? null,
    environment_type: job.target.environment.environmentType,
    target_profile_id: record.targetProfileId,
    target_settings_sha256: binding.sqlDigests.targetSettingsSha256,
    export_name: job.target.exportName,
    orchestration_input_object_id: binding.orchestrationInputObjectId,
    orchestration_input_sha256: binding.sqlDigests.orchestrationInputSha256,
    workflow_request_object_id: binding.workflowRequestObjectId,
    request_sha256: binding.sqlDigests.requestSha256,
    primary_input_sha256: binding.sqlDigests.primaryInputSha256,
    run_sequence: job.runSequence,
    rerun_of_run_id: job.rerunOfJobId ?? null,
    request_intent_sha256: record.requestIntentDigest.slice(7),
    idempotency_key_sha256: sha256DigestSchema
      .parse(idempotencyKeyDigest)
      .slice(7),
    entitlement_decision_reference:
      record.workflowSubmission.entitlementDecisionReference,
    previous_artifact_id: job.previousArtifactId ?? null,
    lifecycle_status: job.state,
    progress_stage: job.progress.currentStage ?? null,
    progress_completed_stages: job.progress.completedStages,
    progress_message: job.progress.message,
    cancellation_requested_at: job.cancellation.requestedAt ?? null,
    cancellation_acknowledged_at:
      job.cancellation.state === "acknowledged"
        ? (job.completedAt ?? null)
        : null,
    completed_at: job.completedAt ?? null,
    created_by_principal_id: record.createdByPrincipalId,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

export function verifyExportRunProjection(
  row: SqlRow,
  record: StoredSolutionExportJob,
): void {
  const fields = exportRunFields(
    record,
    `sha256:${exportRunText(row["idempotency_key_sha256"])}`,
  );
  for (const [key, value] of Object.entries(fields)) {
    const actual = row[key];
    if (typeof value === "number") {
      if (
        value === 0
          ? String(actual) !== "0"
          : exportRunInteger(actual) !== value
      )
        exportRunUnavailable();
    } else if (actual !== value) exportRunUnavailable();
  }
  exportRunInteger(row["record_version"]);
}

export function exportRunObject(
  row: SqlRow,
  prefix: "snapshot" | "request" | "input",
): StoredObjectReference {
  const storageProvider = row[`${prefix}_storage_provider`];
  if (
    storageProvider !== "s3" &&
    storageProvider !== "filesystem" &&
    storageProvider !== "memory"
  )
    exportRunUnavailable();
  return {
    objectId: exportRunText(row[`${prefix}_object_id`]),
    objectVersion: exportRunText(row[`${prefix}_object_version`]),
    contentSha256: exportRunText(row[`${prefix}_sha256`]),
    sizeBytes: exportRunInteger(row[`${prefix}_size_bytes`]),
    storageKey: exportRunText(row[`${prefix}_storage_key`]),
    storageProvider,
    purpose: prefix === "snapshot" ? "checkpoint-state" : "input-payload",
    mediaType: "application/json",
    owner: {
      organizationId: exportRunText(row["organization_id"]),
      projectId: exportRunText(row["project_id"]),
    },
    ...(row[`${prefix}_entity_tag`] === null
      ? {}
      : { entityTag: exportRunText(row[`${prefix}_entity_tag`]) }),
  };
}
