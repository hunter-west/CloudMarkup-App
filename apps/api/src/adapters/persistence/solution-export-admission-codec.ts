import { createSolutionExportJobV1Schema } from "@cloudmarkup/api-contract";
import { sha256DigestSchema, type Sha256Digest } from "@cloudmarkup/schemas";
import { ApplicationError } from "../../application/errors.js";
import {
  solutionExportRequestIntentDigest,
  type StoredSolutionExportJob,
} from "../../application/solution-exports.js";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunInteger,
  exportRunSha,
  exportRunText,
  exportRunTimestamp,
  exportRunUnavailable,
  parsePreparedExportRun,
} from "./solution-export-run-codec.js";
import type { SqlRow } from "./sql.js";

export const EXPORT_ADMISSION_OPERATIONS = Object.freeze({
  selection: "solution-export.selection.v1",
  primary: "solution-export.primary.v1",
  create: "solution-export.create.v1",
  cancel: "solution-export.cancel.v1",
} as const);
export type ExportAdmissionOperation =
  (typeof EXPORT_ADMISSION_OPERATIONS)[keyof typeof EXPORT_ADMISSION_OPERATIONS];
export interface ExportAdmissionSelectionV1 {
  readonly contractVersion: 1;
  readonly organizationId: string;
  readonly projectId: string;
  readonly createdByPrincipalId: string;
  readonly originalIdempotencyKeyDigest: Sha256Digest;
  readonly admissionGeneration: number;
  readonly previousAdmission: {
    readonly generation: number;
    readonly objectId: string;
    readonly digest: Sha256Digest;
  } | null;
  readonly initialRecord: StoredSolutionExportJob;
}
export interface ExportAdmissionRow {
  readonly organizationId: string;
  readonly operation: ExportAdmissionOperation;
  readonly key: string;
  readonly request: string;
  readonly principalId: string;
  readonly resourceId: string;
  readonly state: "in-progress" | "completed";
  readonly createdAt: string;
  readonly completedAt: string | null;
}
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export function exportAdmissionId(value: unknown): string {
  const text = exportRunText(value);
  if (!identifier.test(text)) exportRunUnavailable();
  return text;
}
export function exportAdmissionHash(value: unknown): Sha256Digest {
  return sha256DigestSchema.parse(
    `sha256:${exportRunSha(exportRunBytes(value))}`,
  );
}
export function exportAdmissionJobId(input: {
  readonly organizationId: string;
  readonly projectId: string;
  readonly primaryInputDigest: string;
  readonly admissionGeneration: number;
}): string {
  exportRunInteger(input.admissionGeneration);
  return `solutionexport_admission_${exportAdmissionHash({ contractVersion: 1, ...input }).slice(7)}`;
}
export function exportAdmissionConflict(): never {
  throw new ApplicationError(
    "idempotency_key_reused",
    "The Idempotency-Key was already used for a different export request.",
  );
}
/** Reject executable/object-prototype input before any schema getter can run. */
function dataOnly(
  value: unknown,
  depth = 0,
  budget = { remaining: 100_000 },
): void {
  if (--budget.remaining < 0 || depth > 64) exportRunUnavailable();
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") exportRunUnavailable();
  if (Object.getOwnPropertySymbols(value).length !== 0) exportRunUnavailable();
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    exportRunUnavailable();
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (Array.isArray(value) && key === "length") continue;
    if (!("value" in descriptor) || !descriptor.enumerable)
      exportRunUnavailable();
    dataOnly(descriptor.value, depth + 1, budget);
  }
}
export function parseExportAdmissionSelection(
  value: unknown,
): ExportAdmissionSelectionV1 {
  dataOnly(value);
  if (value === null || typeof value !== "object" || Array.isArray(value))
    exportRunUnavailable();
  const object = value as Record<string, unknown>;
  if (
    !exportRunEqual(
      Object.keys(object).sort(),
      [
        "admissionGeneration",
        "previousAdmission",
        "contractVersion",
        "createdByPrincipalId",
        "initialRecord",
        "organizationId",
        "originalIdempotencyKeyDigest",
        "projectId",
      ].sort(),
    ) ||
    object["contractVersion"] !== 1
  )
    exportRunUnavailable();
  if (exportRunBytes(value).length > 4 * 1024 * 1024) exportRunUnavailable();
  const record = parsePreparedExportRun(object["initialRecord"]);
  const organizationId = exportAdmissionId(object["organizationId"]);
  const projectId = exportAdmissionId(object["projectId"]);
  const createdByPrincipalId = exportAdmissionId(
    object["createdByPrincipalId"],
  );
  const originalIdempotencyKeyDigest = sha256DigestSchema.parse(
    object["originalIdempotencyKeyDigest"],
  );
  if (typeof object["admissionGeneration"] !== "number") exportRunUnavailable();
  const admissionGeneration = exportRunInteger(object["admissionGeneration"]);
  let previousAdmission: ExportAdmissionSelectionV1["previousAdmission"] = null;
  if (admissionGeneration === 1) {
    if (object["previousAdmission"] !== null) exportRunUnavailable();
  } else {
    const prior = object["previousAdmission"];
    if (
      typeof prior !== "object" ||
      prior === null ||
      Array.isArray(prior) ||
      !exportRunEqual(Object.keys(prior).sort(), [
        "digest",
        "generation",
        "objectId",
      ])
    )
      exportRunUnavailable();
    const fields = prior as Record<string, unknown>;
    if (fields["generation"] !== admissionGeneration - 1)
      exportRunUnavailable();
    previousAdmission = {
      generation: admissionGeneration - 1,
      objectId: exportAdmissionId(fields["objectId"]),
      digest: sha256DigestSchema.parse(fields["digest"]),
    };
  }
  const request = createSolutionExportJobV1Schema.parse({
    contractVersion: 1,
    solutionRevisionId: record.job.solutionRevision.solutionRevisionId,
    environment: record.job.target.environment,
    exportName: record.job.target.exportName,
    targetProfileId: record.targetProfileId,
    diagram: record.job.target.diagram,
    ...(record.job.target.applicationSource === undefined
      ? {}
      : { applicationSource: record.job.target.applicationSource }),
  });
  if (
    record.job.state !== "queued" ||
    record.job.cancellation.state !== "none" ||
    record.organizationId !== organizationId ||
    record.job.projectId !== projectId ||
    record.createdByPrincipalId !== createdByPrincipalId ||
    record.requestIntentDigest !==
      solutionExportRequestIntentDigest({
        organizationId,
        projectId,
        request,
      })
  )
    exportRunUnavailable();
  const sequence = exportRunInteger(record.job.runSequence);
  if (
    sequence > 1_000_000 ||
    sequence > admissionGeneration ||
    (sequence === 1) !== (record.job.rerunOfJobId === undefined) ||
    record.job.rerunOfJobId === record.job.id
  )
    exportRunUnavailable();
  if (
    record.job.id !==
    exportAdmissionJobId({
      organizationId,
      projectId,
      primaryInputDigest: record.primaryInputDigest,
      admissionGeneration,
    })
  )
    exportRunUnavailable();
  return {
    contractVersion: 1,
    organizationId,
    projectId,
    createdByPrincipalId,
    originalIdempotencyKeyDigest,
    admissionGeneration,
    previousAdmission,
    initialRecord: record,
  };
}
export function exportAdmissionKey(
  operation: ExportAdmissionOperation,
  input: {
    readonly organizationId: string;
    readonly projectId?: string;
    readonly principalId?: string;
    readonly publicKeyDigest?: string;
    readonly primaryInputDigest?: string;
    readonly admissionGeneration?: number;
  },
): string {
  if (
    !Object.values(EXPORT_ADMISSION_OPERATIONS).some(
      (candidate) => candidate === operation,
    )
  )
    exportRunUnavailable();
  exportAdmissionId(input.organizationId);
  if (
    operation === EXPORT_ADMISSION_OPERATIONS.create ||
    operation === EXPORT_ADMISSION_OPERATIONS.cancel
  ) {
    exportAdmissionId(input.principalId);
    sha256DigestSchema.parse(input.publicKeyDigest);
    if (
      input.projectId !== undefined ||
      input.primaryInputDigest !== undefined ||
      input.admissionGeneration !== undefined
    )
      exportRunUnavailable();
  } else {
    exportAdmissionId(input.projectId);
    sha256DigestSchema.parse(input.primaryInputDigest);
    if (input.principalId !== undefined || input.publicKeyDigest !== undefined)
      exportRunUnavailable();
    if (operation === EXPORT_ADMISSION_OPERATIONS.selection)
      exportRunInteger(input.admissionGeneration);
    else if (input.admissionGeneration !== undefined) exportRunUnavailable();
  }
  return exportAdmissionHash({ contractVersion: 1, operation, ...input }).slice(
    7,
  );
}
export function parseExportAdmissionRow(row: SqlRow): ExportAdmissionRow {
  const operation = exportRunText(row["operation_name"]);
  if (
    !Object.values(EXPORT_ADMISSION_OPERATIONS).some(
      (value) => value === operation,
    )
  )
    exportRunUnavailable();
  const state = row["lifecycle_status"];
  const completedAt =
    row["completed_at"] === null
      ? null
      : exportRunTimestamp(row["completed_at"]);
  if (
    (state !== "in-progress" && state !== "completed") ||
    (state === "completed") !== (completedAt !== null) ||
    row["expires_at"] !== null ||
    row["resource_kind"] !==
      (operation === EXPORT_ADMISSION_OPERATIONS.cancel
        ? "solution-export-job"
        : "export-selection")
  )
    exportRunUnavailable();
  const createdAt = exportRunTimestamp(row["created_at"]);
  if (completedAt !== null && completedAt < createdAt) exportRunUnavailable();
  return {
    organizationId: exportAdmissionId(row["organization_id"]),
    operation: operation as ExportAdmissionOperation,
    key: sha256DigestSchema
      .parse(`sha256:${exportRunText(row["idempotency_key_sha256"])}`)
      .slice(7),
    request: sha256DigestSchema
      .parse(`sha256:${exportRunText(row["request_sha256"])}`)
      .slice(7),
    principalId: exportAdmissionId(row["principal_id"]),
    resourceId: exportAdmissionId(row["resource_id"]),
    state,
    createdAt,
    completedAt,
  };
}
