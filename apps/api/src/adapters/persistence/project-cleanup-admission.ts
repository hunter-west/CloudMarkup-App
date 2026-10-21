import {
  parseCleanupHistoryEnvelope,
  type CleanupAdmissionEnvelope,
} from "../../application/project-cleanup-history.js";
import { randomBytes } from "node:crypto";
import { RepositoryError } from "../../application/persistence.js";
import {
  parseProjectCleanupWake,
  projectCleanupAdmissionWake,
  type ProjectCleanupAdmissionWake,
} from "../../application/project-cleanup-wake.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

export interface CleanupAdmissionIdentity {
  readonly organizationId: string;
  readonly projectId: string;
  readonly principalId: string;
  readonly keySha256: string;
  readonly requestSha256: string;
  readonly expectedRecordVersion: number;
}
function conflict(): never {
  throw new RepositoryError(
    "idempotency-conflict",
    "The deletion admission cannot be completed.",
  );
}
function unavailable(): never {
  throw new RepositoryError(
    "persistence-unavailable",
    "The deletion admission is unavailable.",
  );
}
function decode(row: SqlRow): ProjectCleanupAdmissionWake {
  if (typeof row["wake_binding"] !== "string") unavailable();
  try {
    const wake = parseProjectCleanupWake(
      JSON.parse(row["wake_binding"]) as unknown,
    );
    if (wake.schemaVersion !== 2) unavailable();
    return wake;
  } catch {
    return unavailable();
  }
}
function state(row: SqlRow): "prepared" | "committed" | "aborted" {
  const value = row["lifecycle_status"];
  if (value !== "prepared" && value !== "committed" && value !== "aborted")
    unavailable();
  return value;
}

/** Requires admitted 0098 and the separately reviewed activation profile.
 * Lock order is always project, then admission, including worker resolution. */
export class PostgresCleanupAdmissionJournal {
  readonly #database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.#database = database;
  }

  /** Caller holds the project lock and has rechecked canonical authorization. */
  async prepare(
    tx: SqlExecutor,
    input: CleanupAdmissionIdentity,
  ): Promise<ProjectCleanupAdmissionWake> {
    const found = await tx.query(
      sql(
        `SELECT wake_binding,lifecycle_status,request_sha256,project_id,expected_record_version
       FROM project_cleanup_admissions WHERE organization_id=$1 AND principal_id=$2
       AND idempotency_key_sha256=$3 FOR UPDATE`,
        [input.organizationId, input.principalId, input.keySha256],
      ),
    );
    if (found.rows.length > 1) unavailable();
    const existing = found.rows[0];
    if (existing !== undefined) {
      const wake = decode(existing);
      if (
        existing["request_sha256"] !== input.requestSha256 ||
        existing["project_id"] !== input.projectId ||
        Number(existing["expected_record_version"]) !==
          input.expectedRecordVersion ||
        wake.organizationId !== input.organizationId ||
        wake.projectId !== input.projectId ||
        wake.recordVersion !== input.expectedRecordVersion + 1 ||
        state(existing) === "aborted"
      )
        conflict();
      return wake;
    }
    const result = await tx.query(
      sql(
        `SELECT record_version,lifecycle_status,
       to_char(GREATEST(date_trunc('milliseconds',clock_timestamp()),COALESCE((
         SELECT max((wake_binding::jsonb->>'deletionRequestedAt')::timestamptz) + interval '1 millisecond'
         FROM project_cleanup_admissions WHERE organization_id=$1 AND project_id=$2
           AND expected_record_version=$3),'-infinity'::timestamptz)) AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS requested_at
       FROM projects WHERE organization_id=$1 AND project_id=$2 FOR UPDATE`,
        [input.organizationId, input.projectId, input.expectedRecordVersion],
      ),
    );
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      row === undefined ||
      Number(row["record_version"]) !== input.expectedRecordVersion ||
      !["active", "archived"].includes(String(row["lifecycle_status"])) ||
      typeof row["requested_at"] !== "string"
    )
      throw new RepositoryError(
        "version-conflict",
        "The project changed before deletion admission.",
      );
    const wake = projectCleanupAdmissionWake({
      organizationId: input.organizationId,
      projectId: input.projectId,
      recordVersion: input.expectedRecordVersion + 1,
      deletionRequestedAt: row["requested_at"],
      admissionId: randomBytes(32).toString("hex"),
      admissionDeadline: new Date(
        Date.parse(row["requested_at"]) + 60_000,
      ).toISOString(),
    });
    const inserted = await tx.query(
      sql(
        `INSERT INTO project_cleanup_admissions(admission_id,organization_id,project_id,principal_id,
       idempotency_key_sha256,request_sha256,expected_record_version,wake_binding,admission_deadline)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz) RETURNING admission_id`,
        [
          wake.admissionId,
          input.organizationId,
          input.projectId,
          input.principalId,
          input.keySha256,
          input.requestSha256,
          input.expectedRecordVersion,
          JSON.stringify(wake),
          wake.admissionDeadline,
        ],
      ),
    );
    if (
      inserted.rows.length !== 1 ||
      inserted.rows[0]?.["admission_id"] !== wake.admissionId
    )
      unavailable();
    return wake;
  }

  async envelope(
    wake: ProjectCleanupAdmissionWake,
  ): Promise<CleanupAdmissionEnvelope> {
    const result = await this.#database.query(
      sql(
        "SELECT wake_binding,principal_id,idempotency_key_sha256,request_sha256,expected_record_version FROM project_cleanup_admissions WHERE admission_id=$1 AND organization_id=$2 AND project_id=$3",
        [wake.admissionId, wake.organizationId, wake.projectId],
      ),
    );
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      row === undefined ||
      JSON.stringify(decode(row)) !== JSON.stringify(wake)
    )
      unavailable();
    const envelope = parseCleanupHistoryEnvelope({
      kind: "admission",
      wake,
      principalId: row["principal_id"],
      idempotencyKeySha256: row["idempotency_key_sha256"],
      requestSha256: row["request_sha256"],
      expectedRecordVersion: Number(row["expected_record_version"]),
    });
    if (envelope.kind !== "admission") unavailable();
    return envelope;
  }

  async #lock(tx: SqlExecutor, input: ProjectCleanupAdmissionWake) {
    const wake = parseProjectCleanupWake(input);
    if (wake.schemaVersion !== 2) unavailable();
    const project = await tx.query(
      sql(
        "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
        [wake.organizationId, wake.projectId],
      ),
    );
    if (project.rows.length !== 1) unavailable();
    const found = await tx.query(
      sql(
        `SELECT wake_binding,lifecycle_status,clock_timestamp() >= admission_deadline AS expired
       FROM project_cleanup_admissions WHERE admission_id=$1 AND organization_id=$2 AND project_id=$3 FOR UPDATE`,
        [wake.admissionId, wake.organizationId, wake.projectId],
      ),
    );
    if (found.rows.length === 0) return undefined;
    const row = found.rows[0];
    if (
      found.rows.length !== 1 ||
      row === undefined ||
      JSON.stringify(decode(row)) !== JSON.stringify(wake) ||
      typeof row["expired"] !== "boolean"
    )
      unavailable();
    state(row);
    return row;
  }

  async assertCommittable(
    tx: SqlExecutor,
    wake: ProjectCleanupAdmissionWake,
  ): Promise<"prepared" | "committed"> {
    const row = await this.#lock(tx, wake);
    if (
      row === undefined ||
      state(row) === "aborted" ||
      (state(row) === "prepared" && row["expired"] === true)
    )
      conflict();
    const current = state(row);
    if (current === "aborted") conflict();
    return current;
  }

  async commit(
    tx: SqlExecutor,
    wake: ProjectCleanupAdmissionWake,
  ): Promise<void> {
    const updated = await tx.query(
      sql(
        `UPDATE project_cleanup_admissions SET lifecycle_status='committed',resolved_at=clock_timestamp()
       WHERE admission_id=$1 AND wake_binding=$2 AND lifecycle_status='prepared' RETURNING admission_id`,
        [wake.admissionId, JSON.stringify(wake)],
      ),
    );
    if (
      updated.rows.length !== 1 ||
      updated.rows[0]?.["admission_id"] !== wake.admissionId
    )
      unavailable();
  }

  /** Acknowledged transaction completion, never the deadline or an active
   * project alone, proves ABORTED. Lost commit responses leave the wake intact. */
  async resolve(
    wake: ProjectCleanupAdmissionWake,
    options: { readonly allowAbort?: boolean } = {},
  ): Promise<"prepared" | "committed" | "aborted" | "unconfirmed"> {
    return this.#database.transaction(async (tx) => {
      const row = await this.#lock(tx, wake);
      if (row === undefined) return "unconfirmed";
      if (
        state(row) !== "prepared" ||
        row["expired"] !== true ||
        options.allowAbort === false
      )
        return state(row);
      const result = await tx.query(
        sql(
          `UPDATE project_cleanup_admissions SET lifecycle_status='aborted',resolved_at=clock_timestamp()
         WHERE admission_id=$1 AND wake_binding=$2 AND lifecycle_status='prepared' RETURNING admission_id`,
          [wake.admissionId, JSON.stringify(wake)],
        ),
      );
      if (
        result.rows.length !== 1 ||
        result.rows[0]?.["admission_id"] !== wake.admissionId
      )
        unavailable();
      return "aborted";
    });
  }
}
