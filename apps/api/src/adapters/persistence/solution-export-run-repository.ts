import {
  sha256DigestSchema,
  parseAsyncJobRecordV1,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import {
  isOrganizationRole,
  permissionsForRole,
} from "../../application/authorization.js";
import { ApplicationError } from "../../application/errors.js";
import type { PrincipalContext } from "../../application/ports.js";
import {
  ObjectStoreError,
  type AuthorizedOrganizationScope,
  type ObjectStore,
  type StoredObjectReference,
} from "../../application/persistence.js";
import type { StoredSolutionExportJob } from "../../application/solution-exports.js";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";
import { solutionExportRootAdmissionCommand } from "../../application/solution-export-root-admission.js";
import { jobSqlParameter } from "./async-job-repository-codec.js";
import { assertObjectReference } from "./object-store-common.js";
import { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import { SolutionExportProducerObjects } from "./solution-export-producer-objects.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";
import {
  EXPORT_RUN_SNAPSHOT_LIMIT,
  exportRunBytes,
  exportRunConflict,
  exportRunEqual,
  exportRunFields,
  exportRunInteger,
  exportRunObject,
  exportRunText,
  exportRunUnavailable,
  immutableExportRun,
  parsePreparedExportRun,
  parseStoredExportRun,
  verifyExportRunProjection,
  exportRunSha,
} from "./solution-export-run-codec.js";

export interface PreparedSolutionExportRun {
  readonly record: StoredSolutionExportJob;
  readonly idempotencyKeyDigest: string;
  /** Already-published, canonical checkpoint containing exactly record. */
  readonly snapshot: StoredObjectReference;
  readonly workflowRequest: StoredObjectReference;
  readonly orchestrationInput: StoredObjectReference;
}
export interface PersistedSolutionExportRun {
  readonly record: StoredSolutionExportJob;
  readonly recordVersion: number;
}
type Permission = "artifacts.read" | "exports.run";
interface Selector {
  readonly organizationId: string;
  readonly projectId: string;
  readonly jobId: string;
}
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
function notFound(): never {
  throw new ApplicationError(
    "not_found",
    "The requested resource is unavailable.",
  );
}
function idempotencyConflict(): never {
  throw new ApplicationError(
    "idempotency_key_reused",
    "The Idempotency-Key was already used for a different prepared export.",
  );
}
const utc = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const objectColumns = (["snapshot", "request", "input"] as const)
  .map((prefix) => {
    const alias =
      prefix === "snapshot" ? "s" : prefix === "request" ? "w" : "i";
    return (
      [
        "object_id",
        "object_version",
        "size_bytes",
        "storage_key",
        "storage_provider",
        "entity_tag",
      ]
        .map((column) => `${alias}.${column} AS ${prefix}_${column}`)
        .join(",") + `,${alias}.content_sha256 AS ${prefix}_sha256`
    );
  })
  .join(",");
const runSelect = `SELECT r.solution_export_run_id,r.organization_id,r.project_id,r.root_job_id,
 r.storage_contract_version,r.api_contract_version,r.solution_revision_id,r.solution_manifest_record_id,
 r.solution_manifest_record_kind,r.solution_manifest_subject_id,r.solution_manifest_sha256,r.environment_id,
 r.environment_type,r.target_profile_id,r.target_settings_sha256,r.export_name,
 r.orchestration_input_object_id,r.orchestration_input_sha256,r.workflow_request_object_id,r.primary_input_sha256,
 r.run_sequence,r.rerun_of_run_id,r.request_intent_sha256,r.idempotency_key_sha256,
 r.entitlement_decision_reference,r.previous_artifact_id,r.lifecycle_status,r.progress_stage,
 r.progress_completed_stages,r.progress_message,r.generation_coverage_object_id,r.generation_coverage_sha256,
 r.diagnostics_object_id,r.diagnostics_sha256,r.evidence_object_id,r.evidence_sha256,
 r.workflow_read_model_object_id,r.workflow_read_model_sha256,r.created_by_principal_id,r.record_version, ${utc("r.created_at")} AS created_at, ${utc("r.updated_at")} AS updated_at,
 ${utc("r.completed_at")} AS completed_at, ${utc("r.cancellation_requested_at")} AS cancellation_requested_at,
 ${utc("r.cancellation_acknowledged_at")} AS cancellation_acknowledged_at, ${objectColumns}
 FROM solution_export_runs r
 JOIN stored_objects s ON s.organization_id=r.organization_id AND s.project_id=r.project_id AND s.object_id=r.workflow_read_model_object_id AND s.content_sha256=r.workflow_read_model_sha256 AND s.object_purpose='checkpoint-state' AND s.media_type='application/json' AND s.lifecycle_state='published'
 JOIN stored_objects w ON w.organization_id=r.organization_id AND w.project_id=r.project_id AND w.object_id=r.workflow_request_object_id AND w.content_sha256=r.request_sha256 AND w.object_purpose='input-payload' AND w.media_type='application/json' AND w.lifecycle_state='published'
 JOIN stored_objects i ON i.organization_id=r.organization_id AND i.project_id=r.project_id AND i.object_id=r.orchestration_input_object_id AND i.content_sha256=r.orchestration_input_sha256 AND i.object_purpose='input-payload' AND i.media_type='application/json' AND i.lifecycle_state='published'
 WHERE r.organization_id=$1 AND r.project_id=$2 AND r.solution_export_run_id=$3`;

/** Prepared metadata only. Does not create root jobs, dispatch work, or publish artifacts. */
export class PostgresSolutionExportRunRepository {
  readonly #database: SqlDatabase;
  readonly #objects: ObjectStore;
  readonly #principal: PrincipalContext;
  readonly #clock: () => Date;
  readonly #localRestrictedInsert: boolean;
  constructor(options: {
    readonly database: SqlDatabase;
    readonly objectStore: ObjectStore;
    readonly principal: PrincipalContext;
    readonly clock?: () => Date;
    readonly localRestrictedInsert?: boolean;
  }) {
    this.#database = options.database;
    this.#objects = options.objectStore;
    this.#principal = structuredClone(options.principal);
    this.#clock = options.clock ?? (() => new Date());
    this.#localRestrictedInsert = options.localRestrictedInsert === true;
  }
  #authentication(): void {
    const now = this.#clock().getTime();
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(Date.parse(this.#principal.expiresAt)) ||
      Date.parse(this.#principal.expiresAt) <= now
    )
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
  }
  async #authorize(
    tx: SqlExecutor,
    selector: Selector,
    permission: Permission,
  ): Promise<AuthorizedOrganizationScope> {
    this.#authentication();
    if (
      ![
        selector.organizationId,
        selector.projectId,
        selector.jobId,
        this.#principal.principalId,
      ].every((value) => id.test(value))
    )
      notFound();
    // Project-first serialization agrees with lifecycle/editor mutations. No object I/O occurs here.
    const project = await tx.query(
      sql(
        `SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status='active' FOR ${permission === "exports.run" ? "UPDATE" : "SHARE"}`,
        [selector.organizationId, selector.projectId],
      ),
    );
    if (project.rows.length !== 1) notFound();
    const result = await tx.query(
      sql(
        `SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json FROM memberships m
      JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
      JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
      WHERE m.principal_id=$1 AND m.organization_id=$2 AND m.lifecycle_status='active' FOR SHARE OF m,p,o,r`,
        [this.#principal.principalId, selector.organizationId],
      ),
    );
    const row = result.rows[0];
    const role = row?.["role_key"];
    if (
      result.rows.length !== 1 ||
      typeof role !== "string" ||
      !isOrganizationRole(role)
    )
      notFound();
    let capabilities: unknown;
    try {
      capabilities = JSON.parse(
        exportRunText(row?.["capabilities_json"]),
      ) as unknown;
    } catch {
      exportRunUnavailable();
    }
    if (
      !Array.isArray(capabilities) ||
      capabilities.some((value: unknown) => typeof value !== "string") ||
      !exportRunEqual(
        capabilities.map((value: unknown) => exportRunText(value)).sort(),
        [...permissionsForRole(role)].sort(),
      )
    )
      exportRunUnavailable();
    if (!permissionsForRole(role).includes(permission))
      throw new ApplicationError(
        "access_denied",
        "This action is not available for the current account.",
      );
    await this.#authenticationAtDatabase(tx);
    return {
      organizationId: selector.organizationId,
      principalId: this.#principal.principalId,
      sessionId: this.#principal.sessionId,
      correlationId: this.#principal.correlationId,
      membershipId: exportRunText(row?.["membership_id"]),
      roleKey: role,
      capabilities: permissionsForRole(role),
    };
  }
  async #authenticationAtDatabase(tx: SqlExecutor): Promise<void> {
    this.#authentication();
    const result = await tx.query(
      sql("SELECT $1::timestamptz > clock_timestamp() AS authenticated", [
        this.#principal.expiresAt,
      ]),
    );
    if (result.rows[0]?.["authenticated"] !== true)
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
  }
  async #boundary<T>(
    selector: Selector,
    permission: Permission,
    work: (tx: SqlExecutor, scope: AuthorizedOrganizationScope) => Promise<T>,
  ): Promise<T> {
    return this.#database.transaction(async (tx) => {
      const scope = await this.#authorize(tx, selector, permission);
      const result = await work(tx, scope);
      await this.#authenticationAtDatabase(tx);
      return result;
    });
  }
  async #objectMetadata(
    tx: SqlExecutor,
    scope: AuthorizedOrganizationScope,
    selector: Selector,
    object: StoredObjectReference,
    purpose: "input-payload" | "checkpoint-state",
  ): Promise<void> {
    assertObjectReference(scope, object);
    if (
      object.owner.projectId !== selector.projectId ||
      object.purpose !== purpose ||
      object.mediaType !== "application/json" ||
      !Number.isSafeInteger(object.sizeBytes) ||
      object.sizeBytes < 1 ||
      object.sizeBytes > EXPORT_RUN_SNAPSHOT_LIMIT
    )
      exportRunUnavailable();
    const found = await tx.query(
      sql(
        `SELECT object_id FROM stored_objects WHERE organization_id=$1 AND project_id=$2 AND object_id=$3
      AND content_sha256=$4 AND size_bytes=$5 AND media_type='application/json' AND object_purpose=$6 AND object_version=$7
      AND storage_provider=$8 AND storage_key=$9 AND entity_tag IS NOT DISTINCT FROM $10 AND lifecycle_state='published' FOR SHARE`,
        [
          selector.organizationId,
          selector.projectId,
          object.objectId,
          object.contentSha256,
          object.sizeBytes,
          purpose,
          object.objectVersion,
          object.storageProvider,
          object.storageKey,
          object.entityTag ?? null,
        ],
      ),
    );
    if (found.rows.length !== 1) exportRunUnavailable();
  }
  async #readObject(
    selector: Selector,
    permission: Permission,
    object: StoredObjectReference,
    purpose: "input-payload" | "checkpoint-state",
  ): Promise<unknown> {
    if (!id.test(selector.jobId)) notFound();
    if (object.purpose !== purpose) exportRunUnavailable();
    // Use the same exact-reference, byte-bound and before/after authorization
    // checks as producer reads; mutations retain their project UPDATE boundary.
    const objects = new SolutionExportProducerObjects(
      new SolutionExportRequestAuthority(
        this.#database,
        this.#principal,
        {
          organizationId: selector.organizationId,
          projectId: selector.projectId,
        },
        permission,
        this.#clock,
      ),
      this.#objects,
    );
    const bytes = await objects.read(object).catch((error: unknown) => {
      if (
        error instanceof ObjectStoreError &&
        error.code === "content-mismatch"
      )
        return exportRunUnavailable();
      throw error;
    });
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown;
    } catch {
      return exportRunUnavailable();
    }
  }
  #selector(record: StoredSolutionExportJob): Selector {
    return {
      organizationId: record.organizationId,
      projectId: record.job.projectId,
      jobId: record.job.id,
    };
  }
  async #verifyPrepared(
    prepared: PreparedSolutionExportRun,
    permission: Permission,
  ): Promise<void> {
    const record = parseStoredExportRun(prepared.record);
    const selector = this.#selector(record);
    sha256DigestSchema.parse(prepared.idempotencyKeyDigest);
    const binding = createSolutionExportRunInsertionBindingV1(
      record.workflowSubmission,
    );
    if (
      prepared.workflowRequest.objectId !== binding.workflowRequestObjectId ||
      prepared.orchestrationInput.objectId !==
        binding.orchestrationInputObjectId ||
      prepared.workflowRequest.contentSha256 !==
        binding.sqlDigests.requestSha256 ||
      prepared.orchestrationInput.contentSha256 !==
        binding.sqlDigests.orchestrationInputSha256
    )
      exportRunUnavailable();
    for (const [reference, purpose, expected] of [
      [prepared.snapshot, "checkpoint-state", record],
      [prepared.workflowRequest, "input-payload", binding.workflowRequest],
      [
        prepared.orchestrationInput,
        "input-payload",
        binding.orchestrationInput,
      ],
    ] as const) {
      const body = await this.#readObject(
        selector,
        permission,
        reference,
        purpose,
      );
      if (
        !exportRunEqual(body, expected) ||
        exportRunSha(exportRunBytes(expected)) !== reference.contentSha256
      )
        exportRunUnavailable();
    }
  }
  async #root(
    tx: SqlExecutor,
    record: StoredSolutionExportJob,
    idempotencyKeyDigest: string,
  ): Promise<void> {
    const admission = solutionExportRootAdmissionCommand(
      record,
      idempotencyKeyDigest,
    );
    const binding = createSolutionExportRunInsertionBindingV1(
      record.workflowSubmission,
    );
    const found = await tx.query(
      sql(
        `SELECT j.lifecycle_status,${utc("j.cancellation_requested_at")} AS cancellation_requested_at,j.cancellation_requested_by,${utc("j.completed_at")} AS completed_at
      FROM async_jobs j JOIN solution_records m ON m.organization_id=j.organization_id AND m.project_id=j.project_id AND m.solution_record_id=j.solution_manifest_record_id
      JOIN stored_objects o ON o.organization_id=m.organization_id AND o.project_id=m.project_id AND o.object_id=m.content_object_id AND o.content_sha256=m.content_sha256 AND o.lifecycle_state='published'
      JOIN async_job_creation_claims c ON c.organization_id=j.organization_id AND c.job_id=j.job_id AND c.claim_status='completed' AND c.entitlement_outcome='allowed'
      WHERE j.organization_id=$1 AND j.project_id=$2 AND j.job_id=$3 AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL
      AND j.family='solution-export-orchestration' AND j.subject_kind='solution-revision' AND j.solution_revision_id=$4 AND j.solution_manifest_record_id=$5 AND j.solution_manifest_sha256=$6
      AND m.record_kind='solution-revision-manifest' AND m.subject_id=$4 AND m.content_sha256=$6
      AND j.environment_type=$7 AND j.environment_id IS NOT DISTINCT FROM $8 AND j.input_object_id=$9 AND j.input_sha256=$10
      AND j.entitlement_decision_reference=$11 AND j.idempotency_actor_id=$12 AND c.actor_id=j.idempotency_actor_id
      AND c.operation_id='solution-export-jobs.create' AND c.entitlement_decision_reference=j.entitlement_decision_reference
      AND c.project_id=j.project_id AND j.idempotency_key_sha256=$13 AND j.idempotency_request_sha256=$14
      AND j.created_by_actor_kind='principal' AND j.created_by_principal_id=$12 AND j.created_at=$15::timestamptz
      AND o.object_id=$16 AND o.size_bytes=$17 AND o.object_purpose='solution-revision-manifest' AND o.media_type='application/json'
      AND (j.expires_at IS NULL OR j.expires_at > clock_timestamp()) FOR SHARE OF j,o,c`,
        [
          record.organizationId,
          record.job.projectId,
          record.job.id,
          record.job.solutionRevision.solutionRevisionId,
          record.job.solutionRevision.manifestRecordId,
          record.job.solutionRevision.manifestDigest.slice(7),
          record.job.target.environment.environmentType,
          record.job.target.environment.environmentId ?? null,
          binding.orchestrationInputObjectId,
          binding.sqlDigests.orchestrationInputSha256,
          record.workflowSubmission.entitlementDecisionReference,
          record.createdByPrincipalId,
          admission.idempotency.keyDigest.slice(7),
          admission.idempotency.requestDigest.slice(7),
          record.job.createdAt,
          record.workflowSubmission.request.sources.solutionRevision.objectId,
          record.workflowSubmission.request.sources.solutionRevision.sizeBytes,
        ],
      ),
    );
    const row = found.rows[0];
    if (found.rows.length !== 1 || row === undefined) exportRunUnavailable();
    if (record.job.state === "cancellation-requested") {
      if (
        row["cancellation_requested_at"] !==
          record.job.cancellation.requestedAt ||
        row["cancellation_requested_by"] !== record.createdByPrincipalId ||
        !["queued", "running"].includes(String(row["lifecycle_status"]))
      )
        exportRunConflict();
    } else if (
      record.job.state === "canceled" &&
      record.job.cancellation.state === "acknowledged"
    ) {
      if (
        row["lifecycle_status"] !== "canceled" ||
        row["cancellation_requested_at"] !==
          record.job.cancellation.requestedAt ||
        row["cancellation_requested_by"] !== record.createdByPrincipalId ||
        row["completed_at"] !== record.job.completedAt
      )
        exportRunConflict();
    } else if (
      row["lifecycle_status"] !== record.job.state ||
      row["cancellation_requested_at"] !== null
    )
      exportRunConflict();
  }
  async #metadata(
    tx: SqlExecutor,
    scope: AuthorizedOrganizationScope,
    prepared: PreparedSolutionExportRun,
  ): Promise<void> {
    const selector = this.#selector(prepared.record);
    await this.#objectMetadata(
      tx,
      scope,
      selector,
      prepared.snapshot,
      "checkpoint-state",
    );
    await this.#objectMetadata(
      tx,
      scope,
      selector,
      prepared.workflowRequest,
      "input-payload",
    );
    await this.#objectMetadata(
      tx,
      scope,
      selector,
      prepared.orchestrationInput,
      "input-payload",
    );
  }
  /** Revalidates the genuine allowed root and immutable SQL commitments for dispatch. */
  async assertPreparedRoot(
    record: StoredSolutionExportJob,
    idempotencyKeyDigest: string,
  ): Promise<void> {
    const exact = parsePreparedExportRun(record);
    await this.#boundary(this.#selector(exact), "exports.run", (tx) =>
      this.#root(tx, exact, idempotencyKeyDigest),
    );
  }
  async #load(selector: Selector): Promise<SqlRow | undefined> {
    return this.#boundary(
      selector,
      "artifacts.read",
      async (tx) =>
        (
          await tx.query(
            sql(runSelect, [
              selector.organizationId,
              selector.projectId,
              selector.jobId,
            ]),
          )
        ).rows[0],
    );
  }
  async getJob(
    selectorInput: Selector,
  ): Promise<PersistedSolutionExportRun | null> {
    const selector = structuredClone(selectorInput);
    const row = await this.#load(selector);
    if (row === undefined) return null;
    const snapshot = exportRunObject(row, "snapshot");
    const record = parseStoredExportRun(
      await this.#readObject(
        selector,
        "artifacts.read",
        snapshot,
        "checkpoint-state",
      ),
    );
    const prepared = {
      record,
      snapshot,
      idempotencyKeyDigest: `sha256:${exportRunText(row["idempotency_key_sha256"])}`,
      workflowRequest: exportRunObject(row, "request"),
      orchestrationInput: exportRunObject(row, "input"),
    };
    verifyExportRunProjection(row, record);
    await this.#verifyPrepared(prepared, "artifacts.read");
    const final = await this.#load(selector);
    if (final === undefined || !exportRunEqual(row, final)) exportRunConflict();
    return { record, recordVersion: exportRunInteger(row["record_version"]) };
  }
  async insertPreparedRun(input: PreparedSolutionExportRun): Promise<{
    readonly created: boolean;
    readonly run: PersistedSolutionExportRun;
  }> {
    const prepared = structuredClone(input);
    const record = parsePreparedExportRun(prepared.record);
    if (
      record.createdByPrincipalId !== this.#principal.principalId ||
      record.job.state !== "queued"
    )
      exportRunConflict();
    await this.#verifyPrepared(prepared, "exports.run");
    const selector = this.#selector(record);
    const created = await this.#boundary(
      selector,
      "exports.run",
      async (tx, scope) => {
        const existing = await tx.query(
          sql(
            "SELECT solution_export_run_id,project_id,request_intent_sha256,workflow_request_object_id,idempotency_key_sha256 FROM solution_export_runs WHERE organization_id=$1 AND created_by_principal_id=$2 AND idempotency_key_sha256=$3 FOR UPDATE",
            [
              record.organizationId,
              record.createdByPrincipalId,
              sha256DigestSchema.parse(prepared.idempotencyKeyDigest).slice(7),
            ],
          ),
        );
        const prior = existing.rows[0];
        if (prior !== undefined) {
          if (
            prior["solution_export_run_id"] !== record.job.id ||
            prior["project_id"] !== record.job.projectId ||
            prior["request_intent_sha256"] !==
              record.requestIntentDigest.slice(7) ||
            prior["workflow_request_object_id"] !==
              prepared.workflowRequest.objectId
          )
            idempotencyConflict();
          return false;
        }
        await this.#root(tx, record, prepared.idempotencyKeyDigest);
        await this.#metadata(tx, scope, prepared);
        const fields = {
          ...exportRunFields(record, prepared.idempotencyKeyDigest),
          workflow_read_model_object_id: prepared.snapshot.objectId,
          workflow_read_model_sha256: prepared.snapshot.contentSha256,
        };
        const columns = Object.keys(fields);
        const rootAdmission = this.#localRestrictedInsert
          ? solutionExportRootAdmissionCommand(
              record,
              prepared.idempotencyKeyDigest,
            )
          : undefined;
        const inserted = await tx.query(
          rootAdmission !== undefined
            ? sql(
                "SELECT cloudmarkup_ordinary_private.insert_solution_export_run_v1($1::jsonb,$2::text,$3::text) AS solution_export_run_id",
                [
                  JSON.stringify(fields),
                  rootAdmission.idempotency.keyDigest.slice(7),
                  rootAdmission.idempotency.requestDigest.slice(7),
                ],
              )
            : sql(
                `INSERT INTO solution_export_runs (${columns.join(",")}) VALUES (${columns.map(jobSqlParameter).join(",")}) ON CONFLICT DO NOTHING RETURNING solution_export_run_id`,
                Object.values(fields),
              ),
        );
        if (inserted.rows.length !== 1) exportRunConflict();
        return true;
      },
    );
    const run = await this.getJob(selector);
    if (run === null) exportRunUnavailable();
    // Replays cannot replace an already-admitted immutable submission or baseline.
    if (
      !exportRunEqual(
        immutableExportRun(run.record),
        immutableExportRun(record),
      )
    )
      idempotencyConflict();
    return { created, run };
  }
  async compareAndSaveJob(input: {
    readonly expectedRecordVersion: number;
    readonly expectedState: StoredSolutionExportJob["job"]["state"];
    readonly prepared: PreparedSolutionExportRun;
  }): Promise<boolean> {
    const prepared = structuredClone(input.prepared);
    const next = parsePreparedExportRun(prepared.record);
    const expectedVersion = exportRunInteger(input.expectedRecordVersion);
    const selector = this.#selector(next);
    if (next.createdByPrincipalId !== this.#principal.principalId)
      throw new ApplicationError(
        "access_denied",
        "This action is not available for the current account.",
      );
    const current = await this.getJob(selector);
    if (current === null) notFound();
    if (
      current.recordVersion !== expectedVersion ||
      current.record.job.state !== input.expectedState
    )
      return false;
    if (
      !exportRunEqual(
        immutableExportRun(current.record),
        immutableExportRun(next),
      ) ||
      Date.parse(next.job.updatedAt) <=
        Date.parse(current.record.job.updatedAt) ||
      current.record.job.state === "cancellation-requested" ||
      (current.record.job.state === "running" && next.job.state === "queued")
    )
      exportRunConflict();
    await this.#verifyPrepared(prepared, "exports.run");
    return this.#boundary(selector, "exports.run", async (tx, scope) => {
      await this.#root(tx, next, prepared.idempotencyKeyDigest);
      await this.#metadata(tx, scope, prepared);
      const changed = await tx.query(
        sql(
          `UPDATE solution_export_runs SET lifecycle_status=$4,progress_stage=$5,progress_completed_stages=$6,progress_message=$7,
       cancellation_requested_at=$8::timestamptz,updated_at=$9::timestamptz,record_version=record_version+1,workflow_read_model_object_id=$10,workflow_read_model_sha256=$11
       WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3 AND record_version=$12 AND lifecycle_status=$13 AND idempotency_key_sha256=$14 RETURNING record_version`,
          [
            selector.organizationId,
            selector.projectId,
            selector.jobId,
            next.job.state,
            next.job.progress.currentStage ?? null,
            next.job.progress.completedStages,
            next.job.progress.message,
            next.job.cancellation.requestedAt ?? null,
            next.job.updatedAt,
            prepared.snapshot.objectId,
            prepared.snapshot.contentSha256,
            expectedVersion,
            input.expectedState,
            sha256DigestSchema.parse(prepared.idempotencyKeyDigest).slice(7),
          ],
        ),
      );
      return changed.rows.length === 1;
    });
  }
  /** Exact real-root cancellation projection, including queued roots without an attempt/receipt.
   * This path cannot register an artifact or project success/failure. */
  async commitCancellationProjection(input: {
    readonly expectedRecordVersion: number;
    readonly expectedState: StoredSolutionExportJob["job"]["state"];
    readonly root: AsyncJobRecordV1;
    readonly prepared: PreparedSolutionExportRun;
  }): Promise<boolean> {
    const root = parseAsyncJobRecordV1(input.root);
    const next = parseStoredExportRun(input.prepared.record);
    const selector = this.#selector(next);
    if (
      next.createdByPrincipalId !== this.#principal.principalId ||
      !["cancellation-requested", "canceled"].includes(next.job.state) ||
      next.job.artifact !== undefined ||
      root.jobId !== next.job.id ||
      root.idempotency.actorId !== next.createdByPrincipalId ||
      !exportRunEqual(root.ownership, {
        organizationId: next.organizationId,
        projectId: next.job.projectId,
      }) ||
      root.cancellation.state === "none" ||
      root.cancellation.requestedAt !== next.job.cancellation.requestedAt ||
      root.updatedAt !== next.job.updatedAt
    )
      exportRunUnavailable();
    if (
      (root.state === "canceled") !== (next.job.state === "canceled") ||
      (root.state === "canceled" &&
        (root.completedAt !== next.job.completedAt ||
          next.job.cancellation.state !== "acknowledged")) ||
      (root.state !== "canceled" && !["queued", "running"].includes(root.state))
    )
      exportRunUnavailable();
    const binding = createSolutionExportRunInsertionBindingV1(
      next.workflowSubmission,
    );
    if (!exportRunEqual(root.input, binding.orchestrationInput))
      exportRunUnavailable();
    const current = await this.getJob(selector);
    if (current === null) notFound();
    if (exportRunEqual(current.record, next)) return true;
    if (
      current.recordVersion !== input.expectedRecordVersion ||
      current.record.job.state !== input.expectedState ||
      ["succeeded", "failed", "canceled"].includes(current.record.job.state)
    )
      return false;
    const immutable = (record: StoredSolutionExportJob) => {
      const { completedAt: _completed, ...job } = record.job;
      void _completed;
      return immutableExportRun({ ...record, job });
    };
    if (
      !exportRunEqual(immutable(current.record), immutable(next)) ||
      next.job.updatedAt < current.record.job.updatedAt
    )
      exportRunConflict();
    await this.#verifyPrepared(input.prepared, "exports.run");
    return this.#boundary(selector, "exports.run", async (tx, scope) => {
      await this.#root(tx, next, input.prepared.idempotencyKeyDigest);
      await this.#metadata(tx, scope, input.prepared);
      const exactRoot = await tx.query(
        sql(
          `SELECT j.job_id FROM async_jobs j
        JOIN async_job_record_snapshots s ON s.organization_id=j.organization_id AND s.job_id=j.job_id AND s.record_version=j.record_version
        JOIN stored_objects o ON o.organization_id=j.organization_id AND o.project_id=j.project_id AND o.object_id=s.snapshot_object_id AND o.content_sha256=s.snapshot_sha256 AND o.lifecycle_state='published'
        WHERE j.organization_id=$1 AND j.project_id=$2 AND j.job_id=$3 AND j.record_version=$4 AND s.snapshot_sha256=$5 FOR SHARE OF j,o`,
          [
            next.organizationId,
            next.job.projectId,
            next.job.id,
            root.recordVersion,
            exportRunSha(exportRunBytes(root)),
          ],
        ),
      );
      if (exactRoot.rows.length !== 1) return false;
      const changed = await tx.query(
        sql(
          `UPDATE solution_export_runs SET lifecycle_status=$4,cancellation_requested_at=$5::timestamptz,cancellation_acknowledged_at=$6::timestamptz,completed_at=$7::timestamptz,updated_at=$8::timestamptz,record_version=record_version+1,workflow_read_model_object_id=$9,workflow_read_model_sha256=$10,progress_message=$11,progress_stage=$14
        WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3 AND record_version=$12 AND lifecycle_status=$13 RETURNING record_version`,
          [
            next.organizationId,
            next.job.projectId,
            next.job.id,
            next.job.state,
            next.job.cancellation.requestedAt ?? null,
            next.job.state === "canceled"
              ? (next.job.completedAt ?? null)
              : null,
            next.job.completedAt ?? null,
            next.job.updatedAt,
            input.prepared.snapshot.objectId,
            input.prepared.snapshot.contentSha256,
            next.job.progress.message,
            input.expectedRecordVersion,
            input.expectedState,
            next.job.progress.currentStage ?? null,
          ],
        ),
      );
      return changed.rows.length === 1;
    });
  }
}
