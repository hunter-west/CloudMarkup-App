import {
  sha256DigestSchema,
  type AsyncJobRecordV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import type { JobCreationClaimV1 } from "@cloudmarkup/job-framework";
import type { StoredObjectReference } from "../../application/persistence.js";
import type { StoredSolutionExportJob } from "../../application/solution-exports.js";
import { ApplicationError } from "../../application/errors.js";
import { DurableSolutionExportProducer } from "./solution-export-producer.js";
import { PostgresSolutionExportDownloadRepository } from "./solution-export-download-repository.js";
import { PostgresSolutionExportCancellation } from "./solution-export-cancellation.js";
import {
  EXPORT_ADMISSION_OPERATIONS as OP,
  exportAdmissionConflict,
  exportAdmissionHash,
  exportAdmissionJobId,
  exportAdmissionKey,
  parseExportAdmissionRow,
  parseExportAdmissionSelection,
  type ExportAdmissionOperation,
  type ExportAdmissionRow,
  type ExportAdmissionSelectionV1,
} from "./solution-export-admission-codec.js";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunInteger,
  exportRunText,
  exportRunUnavailable,
  parsePreparedExportRun,
} from "./solution-export-run-codec.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";
import {
  exportStoredObject,
  solutionExportWorkflowByteLimit,
} from "./solution-export-workflow-storage.js";

const utc = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const columns = `organization_id,operation_name,idempotency_key_sha256,request_sha256,principal_id,resource_kind,resource_id,lifecycle_status,${utc("created_at")} AS created_at,${utc("completed_at")} AS completed_at,${utc("expires_at")} AS expires_at`;
function pending(): never {
  throw new ApplicationError(
    "service_unavailable",
    "The original export admission is pending. Retry with the same Idempotency-Key.",
  );
}
interface Selected {
  readonly row: ExportAdmissionRow;
  readonly selection: ExportAdmissionSelectionV1;
  readonly object: StoredObjectReference;
}
interface ObservedRun {
  readonly record: StoredSolutionExportJob;
  readonly version: number;
  readonly rootVersion: number;
  readonly reusable: boolean;
  readonly artifact?: {
    readonly id: string;
    readonly expiresAt: string;
    readonly retained?: {
      readonly binding: SqlRow;
      readonly objects: readonly StoredObjectReference[];
    };
  };
}

/** Private operation journal. No generic idempotency row is itself execution authority. */
export class PostgresSolutionExportAdmission {
  readonly producer: DurableSolutionExportProducer;
  readonly downloads: PostgresSolutionExportDownloadRepository;
  constructor(producer: DurableSolutionExportProducer) {
    this.producer = producer;
    this.downloads = new PostgresSolutionExportDownloadRepository(
      producer.options.database,
      producer.options.objectStore,
      producer.options.principal,
      producer.options.ownership,
    );
  }
  #key(
    operation: ExportAdmissionOperation,
    fields: {
      readonly publicKeyDigest?: string;
      readonly primaryInputDigest?: string;
      readonly admissionGeneration?: number;
    },
  ): string {
    return exportAdmissionKey(operation, {
      organizationId: this.producer.authority.ownership.organizationId,
      ...(operation === OP.create || operation === OP.cancel
        ? { principalId: this.producer.authority.principal.principalId }
        : { projectId: this.producer.authority.ownership.projectId }),
      ...fields,
    });
  }
  async #row(
    tx: SqlExecutor,
    operation: ExportAdmissionOperation,
    key: string,
    lock = false,
  ): Promise<ExportAdmissionRow | null> {
    const result = await tx.query(
      sql(
        `SELECT ${columns} FROM idempotency_records WHERE organization_id=$1 AND operation_name=$2 AND idempotency_key_sha256=$3${lock ? " FOR UPDATE" : ""}`,
        [this.producer.authority.ownership.organizationId, operation, key],
      ),
    );
    if (result.rows.length > 1) exportRunUnavailable();
    return result.rows[0] === undefined
      ? null
      : parseExportAdmissionRow(result.rows[0]);
  }
  #transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const authority = this.producer.authority;
    return authority.database.transaction(async (tx) => {
      // Lock the project before the normal SHARE authority query, never upgrade after object I/O.
      await authority.currentAuthentication(tx);
      const project = await tx.query(
        sql(
          "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status='active' FOR UPDATE",
          [authority.ownership.organizationId, authority.ownership.projectId],
        ),
      );
      if (project.rows.length !== 1) exportRunUnavailable();
      await authority.authorize(tx);
      const result = await work(tx);
      await authority.currentAuthentication(tx);
      return result;
    });
  }
  async #load(row: ExportAdmissionRow): Promise<Selected> {
    const object = await this.producer.objects.metadata(row.resourceId);
    if (
      object?.state !== "published" ||
      object.reference.purpose !== "input-payload" ||
      object.reference.mediaType !== "application/json" ||
      object.reference.sizeBytes > 4 * 1024 * 1024
    )
      exportRunUnavailable();
    const selection = parseExportAdmissionSelection(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await this.producer.objects.read(object.reference),
        ),
      ) as unknown,
    );
    if (
      !exportRunEqual(
        {
          organizationId: selection.organizationId,
          projectId: selection.projectId,
        },
        this.producer.authority.ownership,
      ) ||
      this.producer.objects.identity(
        "export-selection",
        `sha256:${object.reference.contentSha256}`,
      ) !== object.reference.objectId
    )
      exportRunUnavailable();
    const exact = await this.#row(
      this.producer.authority,
      OP.selection,
      this.#key(OP.selection, {
        primaryInputDigest: selection.initialRecord.primaryInputDigest,
        admissionGeneration: selection.admissionGeneration,
      }),
    );
    if (
      exact?.resourceId !== row.resourceId ||
      exact.request !== object.reference.contentSha256 ||
      exact.principalId !== selection.createdByPrincipalId
    )
      exportRunUnavailable();
    if (selection.previousAdmission !== null) {
      const prior = await this.#row(
        this.producer.authority,
        OP.selection,
        this.#key(OP.selection, {
          primaryInputDigest: selection.initialRecord.primaryInputDigest,
          admissionGeneration: selection.previousAdmission.generation,
        }),
      );
      if (
        prior?.resourceId !== selection.previousAdmission.objectId ||
        prior.request !== selection.previousAdmission.digest.slice(7)
      )
        exportRunUnavailable();
    }
    if (
      row.operation === OP.primary &&
      (row.request !== selection.initialRecord.primaryInputDigest.slice(7) ||
        row.principalId !== selection.createdByPrincipalId)
    )
      exportRunUnavailable();
    if (
      row.operation === OP.create &&
      (row.request !== selection.initialRecord.requestIntentDigest.slice(7) ||
        row.principalId !== this.producer.authority.principal.principalId)
    )
      exportAdmissionConflict();
    await this.producer.authority.scope();
    return { row, selection, object: object.reference };
  }
  async findSelection(input: {
    readonly idempotencyKeyDigest: Sha256Digest;
    readonly requestIntentDigest: Sha256Digest;
  }): Promise<ExportAdmissionSelectionV1 | null> {
    sha256DigestSchema.parse(input.requestIntentDigest);
    const row = await this.#row(
      this.producer.authority,
      OP.create,
      this.#key(OP.create, { publicKeyDigest: input.idempotencyKeyDigest }),
    );
    if (row === null) return null;
    if (row.request !== input.requestIntentDigest.slice(7))
      exportAdmissionConflict();
    return (await this.#load(row)).selection;
  }
  async #metadata(
    tx: SqlExecutor,
    object: StoredObjectReference,
  ): Promise<void> {
    const result = await tx.query(
      sql(
        "SELECT object_id FROM stored_objects WHERE organization_id=$1 AND project_id=$2 AND object_id=$3 AND object_version=$4 AND content_sha256=$5 AND size_bytes=$6 AND lifecycle_state='published' AND object_purpose='input-payload' AND media_type='application/json' FOR SHARE",
        [
          object.owner.organizationId,
          object.owner.projectId ?? null,
          object.objectId,
          object.objectVersion,
          object.contentSha256,
          object.sizeBytes,
        ],
      ),
    );
    if (result.rows.length !== 1) exportRunUnavailable();
  }
  async #insert(
    tx: SqlExecutor,
    input: {
      operation: ExportAdmissionOperation;
      key: string;
      request: string;
      principalId: string;
      resourceId: string;
      completed?: boolean;
    },
  ): Promise<void> {
    await tx.query(
      sql(
        `INSERT INTO idempotency_records(organization_id,operation_name,idempotency_key_sha256,request_sha256,principal_id,resource_kind,resource_id,lifecycle_status,completed_at) VALUES($1,$2,$3,$4,$5,'export-selection',$6,$7,CASE WHEN $7::varchar='completed' THEN clock_timestamp() ELSE NULL END) ON CONFLICT DO NOTHING`,
        [
          this.producer.authority.ownership.organizationId,
          input.operation,
          input.key,
          input.request,
          input.principalId,
          input.resourceId,
          input.completed === true ? "completed" : "in-progress",
        ],
      ),
    );
    const current = await this.#row(tx, input.operation, input.key, true);
    if (
      current?.request !== input.request ||
      current.principalId !== input.principalId ||
      current.resourceId !== input.resourceId
    )
      exportAdmissionConflict();
  }
  async #retainedBinding(
    executor: SqlExecutor,
    record: StoredSolutionExportJob,
    rootVersion: number,
    runVersion: number,
    lock = false,
  ): Promise<SqlRow> {
    const binding = await executor.query(
      sql(
        `SELECT a.manifest_object_id,a.manifest_sha256,a.archive_object_id,a.archive_sha256,
        r.workflow_read_model_object_id,r.workflow_read_model_sha256,
        j.output_object_id,j.output_sha256,s.snapshot_object_id,s.snapshot_sha256,
        last_attempt.attempt_id,last_attempt.attempt_number,last_attempt.worker_reference,
        last_attempt.lifecycle_status AS attempt_state,${utc("last_attempt.completed_at")} AS attempt_completed_at
      FROM solution_export_artifacts a
      JOIN solution_export_runs r ON r.organization_id=a.organization_id AND r.project_id=a.project_id
        AND r.solution_export_run_id=a.solution_export_run_id
      JOIN async_jobs j ON j.organization_id=r.organization_id AND j.project_id=r.project_id AND j.job_id=r.root_job_id
      JOIN async_job_record_snapshots s ON s.organization_id=j.organization_id AND s.project_id=j.project_id
        AND s.job_id=j.job_id AND s.record_version=j.record_version
      JOIN async_job_attempts last_attempt ON last_attempt.organization_id=j.organization_id AND last_attempt.job_id=j.job_id
        AND last_attempt.attempt_number=(SELECT max(candidate.attempt_number) FROM async_job_attempts candidate
          WHERE candidate.organization_id=j.organization_id AND candidate.job_id=j.job_id)
      WHERE a.organization_id=$1 AND a.project_id=$2 AND a.solution_export_run_id=$3
        AND a.solution_export_artifact_id=$4 AND r.record_version=$5 AND j.record_version=$6${lock ? " FOR SHARE OF r,j,last_attempt" : ""}`,
        [
          record.organizationId,
          record.job.projectId,
          record.job.id,
          record.job.artifact?.artifactId ?? null,
          runVersion,
          rootVersion,
        ],
      ),
    );
    const row = binding.rows[0];
    if (binding.rows.length !== 1 || row === undefined) exportRunUnavailable();
    return row;
  }
  async #retainedObjects(
    record: StoredSolutionExportJob,
    root: AsyncJobRecordV1,
    runVersion: number,
  ): Promise<{
    readonly binding: SqlRow;
    readonly objects: readonly StoredObjectReference[];
  }> {
    const attempt = root.attempts.at(-1);
    if (attempt === undefined) exportRunUnavailable();
    const row = await this.#retainedBinding(
      this.producer.authority,
      record,
      root.recordVersion,
      runVersion,
    );
    const expected = [
      {
        id: exportRunText(row["manifest_object_id"]),
        digest: exportRunText(row["manifest_sha256"]),
        purpose: "artifact-manifest",
        mediaType: "application/json",
      },
      {
        id: exportRunText(row["archive_object_id"]),
        digest: exportRunText(row["archive_sha256"]),
        purpose: "export-package",
        mediaType: "application/zip",
      },
      {
        id: exportRunText(row["workflow_read_model_object_id"]),
        digest: exportRunText(row["workflow_read_model_sha256"]),
        purpose: "checkpoint-state",
        mediaType: "application/json",
      },
      {
        id: exportRunText(row["output_object_id"]),
        digest: exportRunText(row["output_sha256"]),
        purpose: "report",
        mediaType: "application/json",
      },
      {
        id: exportRunText(row["snapshot_object_id"]),
        digest: exportRunText(row["snapshot_sha256"]),
        purpose: "report",
        mediaType: "application/json",
      },
      {
        id: this.downloads.storage.identity("terminal-receipt", {
          jobId: root.jobId,
          attemptId: attempt.attemptId,
          value: null,
        }),
        purpose: "report",
        mediaType: "application/json",
      },
    ];
    const byId = new Map(expected.map((object) => [object.id, object]));
    if (byId.size !== expected.length) exportRunUnavailable();
    const objects = await this.producer.authority.query(
      sql(
        `SELECT * FROM stored_objects WHERE organization_id=$1 AND project_id=$2
        AND object_id IN ($3,$4,$5,$6,$7,$8) ORDER BY object_id`,
        [
          record.organizationId,
          record.job.projectId,
          ...expected.map((object) => object.id),
        ],
      ),
    );
    if (objects.rows.length !== expected.length) exportRunUnavailable();
    const references = objects.rows.map((object) => {
      const reference = exportStoredObject(object);
      const match = byId.get(reference.objectId);
      if (
        match === undefined ||
        object["lifecycle_state"] !== "published" ||
        reference.purpose !== match.purpose ||
        reference.mediaType !== match.mediaType ||
        (match.digest !== undefined &&
          reference.contentSha256 !== match.digest) ||
        reference.sizeBytes >
          solutionExportWorkflowByteLimit(
            reference.purpose,
            reference.mediaType,
          )
      )
        exportRunUnavailable();
      return reference;
    });
    return { binding: row, objects: references };
  }
  async #observe(
    selection: ExportAdmissionSelectionV1,
  ): Promise<ObservedRun | null> {
    const current = await this.producer.runs.getJob({
      ...this.producer.authority.ownership,
      jobId: selection.initialRecord.job.id,
    });
    if (current === null) return null;
    const record = current.record;
    const root = await this.producer.getRoot(record);
    if (root === null) exportRunUnavailable();
    if (
      ["succeeded", "failed", "canceled"].includes(root.state) &&
      root.state !== record.job.state
    ) {
      if (
        root.state === "canceled" &&
        record.createdByPrincipalId ===
          this.producer.authority.principal.principalId
      ) {
        await new PostgresSolutionExportCancellation(this.producer).project(
          root,
          record,
        );
        return this.#observe(selection);
      }
      pending();
    }
    const rootVersion = root.recordVersion;
    if (
      ["queued", "running", "cancellation-requested"].includes(record.job.state)
    )
      return {
        record,
        version: current.recordVersion,
        rootVersion,
        reusable: true,
      };
    if (record.job.state !== "succeeded")
      return {
        record,
        version: current.recordVersion,
        rootVersion,
        reusable: false,
      };
    const artifactId = record.job.artifact?.artifactId;
    if (artifactId === undefined) exportRunUnavailable();
    const metadata = await this.producer.authority.query(
      sql(
        `SELECT ${utc("retention_expires_at")} AS expires_at FROM solution_export_artifacts WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3 AND solution_export_artifact_id=$4`,
        [
          record.organizationId,
          record.job.projectId,
          record.job.id,
          artifactId,
        ],
      ),
    );
    if (metadata.rows.length !== 1) exportRunUnavailable();
    const expiresAt = exportRunText(metadata.rows[0]?.["expires_at"]);
    const now = this.producer.authority.clock().getTime();
    if (!Number.isFinite(now) || !Number.isFinite(Date.parse(expiresAt)))
      exportRunUnavailable();
    const reusable = Date.parse(expiresAt) > now;
    // Capture the exact metadata before immutable byte verification. The final
    // admission transaction locks/rechecks these rows; no object I/O runs there.
    const retained = reusable
      ? await this.#retainedObjects(record, root, current.recordVersion)
      : undefined;
    if (
      reusable &&
      (await this.downloads.getArtifact({
        ...this.producer.authority.ownership,
        artifactId,
      })) === null
    )
      exportRunUnavailable();
    return {
      record,
      version: current.recordVersion,
      rootVersion,
      reusable,
      artifact: {
        id: artifactId,
        expiresAt,
        ...(retained === undefined ? {} : { retained }),
      },
    };
  }
  async #sameObservation(
    tx: SqlExecutor,
    observation: ObservedRun | null,
    selection: ExportAdmissionSelectionV1,
  ): Promise<boolean> {
    const rows = await tx.query(
      sql(
        "SELECT record_version,lifecycle_status,root_job_id FROM solution_export_runs WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3 FOR SHARE",
        [
          selection.organizationId,
          selection.projectId,
          selection.initialRecord.job.id,
        ],
      ),
    );
    if (observation === null) return rows.rows.length === 0;
    const row = rows.rows[0];
    if (
      rows.rows.length !== 1 ||
      row?.["root_job_id"] !== observation.record.job.id ||
      exportRunInteger(row["record_version"]) !== observation.version ||
      row["lifecycle_status"] !== observation.record.job.state
    )
      return false;
    const root = await tx.query(
      sql(
        "SELECT job_id FROM async_jobs WHERE organization_id=$1 AND project_id=$2 AND job_id=$3 AND record_version=$4 FOR SHARE",
        [
          selection.organizationId,
          selection.projectId,
          observation.record.job.id,
          observation.rootVersion,
        ],
      ),
    );
    if (root.rows.length !== 1) return false;
    if (observation.artifact !== undefined) {
      const retentionQuery = sql(
        `SELECT retention_expires_at>clock_timestamp() AS retained FROM solution_export_artifacts WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3 AND solution_export_artifact_id=$4 AND retention_expires_at=$5::timestamptz FOR SHARE`,
        [
          selection.organizationId,
          selection.projectId,
          observation.record.job.id,
          observation.artifact.id,
          observation.artifact.expiresAt,
        ],
      );
      const artifact = await tx.query(retentionQuery);
      if (
        artifact.rows.length !== 1 ||
        artifact.rows[0]?.["retained"] !== observation.reusable
      )
        return false;
      if (observation.reusable) {
        const retained = observation.artifact.retained;
        if (retained?.objects.length !== 6) exportRunUnavailable();
        const currentBinding = await this.#retainedBinding(
          tx,
          observation.record,
          observation.rootVersion,
          observation.version,
          true,
        );
        if (!exportRunEqual(currentBinding, retained.binding)) return false;
        const references = retained.objects;
        // Project/authority and exact run/root are already locked. Sorted SHARE
        // locks fence SQL retirement even when that writer lacks a project lock.
        const published = await tx.query(
          sql(
            `SELECT * FROM stored_objects WHERE organization_id=$1 AND project_id=$2
            AND object_id IN ($3,$4,$5,$6,$7,$8) ORDER BY object_id FOR SHARE`,
            [
              selection.organizationId,
              selection.projectId,
              ...references.map((reference) => reference.objectId),
            ],
          ),
        );
        if (
          published.rows.length !== references.length ||
          published.rows.some(
            (row, index) =>
              row["lifecycle_state"] !== "published" ||
              !exportRunEqual(exportStoredObject(row), references[index]),
          )
        )
          return false;
        // A shared-object lock may have waited; do not reuse an artifact whose
        // verified retention expired during that newly introduced await.
        const retainedAfterLocks = await tx.query(retentionQuery);
        if (
          retainedAfterLocks.rows.length !== 1 ||
          retainedAfterLocks.rows[0]?.["retained"] !== true
        )
          return false;
      }
    }
    return true;
  }
  async #deniedWithoutRoot(
    selection: ExportAdmissionSelectionV1,
  ): Promise<JobCreationClaimV1 | null> {
    const claim = await this.producer.getCreationClaim(
      selection.initialRecord,
      selection.originalIdempotencyKeyDigest,
    );
    if (claim?.status !== "denied") return null;
    if ((await this.producer.getRoot(selection.initialRecord)) !== null)
      exportRunUnavailable();
    return claim;
  }
  async #confirmDenied(
    tx: SqlExecutor,
    selection: ExportAdmissionSelectionV1,
    claim: JobCreationClaimV1,
  ): Promise<boolean> {
    const exact = await tx.query(
      sql(
        "SELECT job_id FROM async_job_creation_claims WHERE organization_id=$1 AND project_id=$2 AND operation_id=$3 AND idempotency_key_sha256=$4 AND request_sha256=$5 AND actor_id=$6 AND job_id=$7 AND record_version=$8 AND claim_status='denied' FOR SHARE",
        [
          selection.organizationId,
          selection.projectId,
          claim.idempotency.operationId,
          claim.idempotency.keyDigest.slice(7),
          claim.idempotency.requestDigest.slice(7),
          selection.createdByPrincipalId,
          selection.initialRecord.job.id,
          claim.recordVersion,
        ],
      ),
    );
    const root = await tx.query(
      sql(
        "SELECT job_id FROM async_jobs WHERE organization_id=$1 AND project_id=$2 AND job_id=$3 FOR SHARE",
        [
          selection.organizationId,
          selection.projectId,
          selection.initialRecord.job.id,
        ],
      ),
    );
    const run = await tx.query(
      sql(
        "SELECT solution_export_run_id FROM solution_export_runs WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3 FOR SHARE",
        [
          selection.organizationId,
          selection.projectId,
          selection.initialRecord.job.id,
        ],
      ),
    );
    return (
      exact.rows.length === 1 && root.rows.length === 0 && run.rows.length === 0
    );
  }
  /** The selection transaction is the first durable choice, before any root claim. */
  async select(input: {
    readonly idempotencyKeyDigest: Sha256Digest;
    readonly record: StoredSolutionExportJob;
  }): Promise<ExportAdmissionSelectionV1> {
    const candidate = parsePreparedExportRun(input.record);
    const authority = this.producer.authority;
    if (
      candidate.createdByPrincipalId !== authority.principal.principalId ||
      !exportRunEqual(
        {
          organizationId: candidate.organizationId,
          projectId: candidate.job.projectId,
        },
        authority.ownership,
      )
    )
      exportRunUnavailable();
    const replay = await this.findSelection({
      idempotencyKeyDigest: input.idempotencyKeyDigest,
      requestIntentDigest: sha256DigestSchema.parse(
        candidate.requestIntentDigest,
      ),
    });
    if (replay !== null) return replay;
    const aliasKey = this.#key(OP.create, {
      publicKeyDigest: input.idempotencyKeyDigest,
    });
    const headKey = this.#key(OP.primary, {
      primaryInputDigest: candidate.primaryInputDigest,
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      const head = await this.#row(authority, OP.primary, headKey);
      const previous = head === null ? null : await this.#load(head);
      const observed =
        previous === null ? null : await this.#observe(previous.selection);
      const denied =
        previous !== null && observed === null
          ? await this.#deniedWithoutRoot(previous.selection)
          : null;
      const reuse =
        previous !== null &&
        (observed === null ? denied === null : observed.reusable);
      const sequence =
        previous === null
          ? 1
          : previous.selection.initialRecord.job.runSequence +
            (observed === null ? 0 : 1);
      const admissionGeneration =
        previous === null ? 1 : previous.selection.admissionGeneration + 1;
      let selected: ExportAdmissionSelectionV1;
      let object: StoredObjectReference;
      if (reuse) {
        selected = previous.selection;
        object = previous.object;
      } else {
        if (sequence > 1_000_000 || !Number.isSafeInteger(admissionGeneration))
          exportRunUnavailable();
        const jobId = exportAdmissionJobId({
          ...authority.ownership,
          primaryInputDigest: candidate.primaryInputDigest,
          admissionGeneration,
        });
        const predecessor =
          previous === null
            ? undefined
            : observed === null
              ? previous.selection.initialRecord.job.rerunOfJobId
              : previous.selection.initialRecord.job.id;
        selected = parseExportAdmissionSelection({
          contractVersion: 1,
          ...authority.ownership,
          createdByPrincipalId: authority.principal.principalId,
          originalIdempotencyKeyDigest: input.idempotencyKeyDigest,
          admissionGeneration,
          previousAdmission:
            previous === null
              ? null
              : {
                  generation: previous.selection.admissionGeneration,
                  objectId: previous.object.objectId,
                  digest: `sha256:${previous.object.contentSha256}`,
                },
          initialRecord: {
            ...candidate,
            job: {
              ...candidate.job,
              id: jobId,
              runSequence: sequence,
              ...(predecessor === undefined
                ? {}
                : { rerunOfJobId: predecessor }),
            },
            workflowSubmission: { ...candidate.workflowSubmission, jobId },
          },
        });
        const bytes = exportRunBytes(selected);
        object = await this.producer.objects.put(
          bytes,
          "input-payload",
          this.producer.objects.identity(
            "export-selection",
            exportAdmissionHash(selected),
          ),
        );
      }
      const committed = await this.#transaction(async (tx) => {
        const alias = await this.#row(tx, OP.create, aliasKey, true);
        if (alias !== null) {
          if (alias.request !== candidate.requestIntentDigest.slice(7))
            exportAdmissionConflict();
          return alias;
        }
        const currentHead = await this.#row(tx, OP.primary, headKey, true);
        if (!exportRunEqual(currentHead, head)) return false;
        if (
          previous !== null &&
          !(await this.#sameObservation(tx, observed, previous.selection))
        )
          return false;
        if (
          previous !== null &&
          denied !== null &&
          !(await this.#confirmDenied(tx, previous.selection, denied))
        )
          return false;
        await this.#metadata(tx, object);
        if (!reuse) {
          await this.#insert(tx, {
            operation: OP.selection,
            key: this.#key(OP.selection, {
              primaryInputDigest: candidate.primaryInputDigest,
              admissionGeneration,
            }),
            request: object.contentSha256,
            principalId: selected.createdByPrincipalId,
            resourceId: object.objectId,
          });
          if (currentHead === null)
            await this.#insert(tx, {
              operation: OP.primary,
              key: headKey,
              request: candidate.primaryInputDigest.slice(7),
              principalId: selected.createdByPrincipalId,
              resourceId: object.objectId,
              completed: true,
            });
          else {
            const changed = await tx.query(
              sql(
                "UPDATE idempotency_records SET resource_id=$4,principal_id=$5,completed_at=clock_timestamp() WHERE organization_id=$1 AND operation_name=$2 AND idempotency_key_sha256=$3 AND resource_id=$6 AND request_sha256=$7 AND lifecycle_status='completed' AND expires_at IS NULL",
                [
                  candidate.organizationId,
                  OP.primary,
                  headKey,
                  object.objectId,
                  selected.createdByPrincipalId,
                  currentHead.resourceId,
                  candidate.primaryInputDigest.slice(7),
                ],
              ),
            );
            if (changed.rowCount !== 1) exportRunUnavailable();
          }
        }
        await this.#insert(tx, {
          operation: OP.create,
          key: aliasKey,
          request: candidate.requestIntentDigest.slice(7),
          principalId: authority.principal.principalId,
          resourceId: object.objectId,
        });
        return true;
      });
      if (committed === false) continue;
      if (committed !== true) return (await this.#load(committed)).selection;
      await authority.scope();
      return selected;
    }
    return pending();
  }
  async resume(
    selectionInput: ExportAdmissionSelectionV1,
  ): Promise<StoredSolutionExportJob> {
    const selection = parseExportAdmissionSelection(selectionInput);
    const authority = this.producer.authority;
    const selectionKey = this.#key(OP.selection, {
      primaryInputDigest: selection.initialRecord.primaryInputDigest,
      admissionGeneration: selection.admissionGeneration,
    });
    const row = await this.#row(authority, OP.selection, selectionKey);
    if (
      row === null ||
      !exportRunEqual((await this.#load(row)).selection, selection)
    )
      exportRunUnavailable();
    let current = await this.producer.runs.getJob({
      ...authority.ownership,
      jobId: selection.initialRecord.job.id,
    });
    if (current === null) {
      if ((await this.#deniedWithoutRoot(selection)) !== null)
        throw new ApplicationError(
          "access_denied",
          "The original export admission was denied. A new request requires a new Idempotency-Key.",
        );
      if (selection.createdByPrincipalId !== authority.principal.principalId)
        pending();
      await this.producer.prepareSelected({
        record: selection.initialRecord,
        idempotencyKeyDigest: selection.originalIdempotencyKeyDigest,
      });
      current = await this.producer.runs.getJob({
        ...authority.ownership,
        jobId: selection.initialRecord.job.id,
      });
    }
    if (current === null) pending();
    const observed = await this.#observe(selection);
    if (
      observed === null ||
      !exportRunEqual(observed.record, current.record) ||
      observed.version !== current.recordVersion
    )
      pending();
    await this.#transaction(async (tx) => {
      const confirmed = await this.#row(tx, OP.selection, selectionKey, true);
      if (
        confirmed?.resourceId !== row.resourceId ||
        confirmed.request !== row.request
      )
        exportRunUnavailable();
      if (!(await this.#sameObservation(tx, observed, selection))) pending();
      await tx.query(
        sql(
          "UPDATE idempotency_records SET lifecycle_status='completed',completed_at=COALESCE(completed_at,clock_timestamp()) WHERE organization_id=$1 AND operation_name IN ($2,$3) AND resource_id=$4 AND expires_at IS NULL AND lifecycle_status IN ('in-progress','completed')",
          [selection.organizationId, OP.selection, OP.create, row.resourceId],
        ),
      );
    });
    // A committed queued projection is reusable by another authorized actor.
    // Only its original creator retries publication; no send acceptance is inferred here.
    if (
      current.record.job.state === "queued" &&
      selection.createdByPrincipalId === authority.principal.principalId &&
      !(await this.producer.dispatchSelected(current.record))
    )
      pending();
    await authority.scope();
    return current.record;
  }
}
