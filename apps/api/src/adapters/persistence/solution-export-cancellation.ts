import type { AsyncJobRecordV1, Sha256Digest } from "@cloudmarkup/schemas";
import type { StoredSolutionExportJob } from "../../application/solution-exports.js";
import { ApplicationError } from "../../application/errors.js";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";
import type { DurableSolutionExportProducer } from "./solution-export-producer.js";
import {
  EXPORT_ADMISSION_OPERATIONS,
  exportAdmissionConflict,
  exportAdmissionHash,
  exportAdmissionKey,
  parseExportAdmissionRow,
} from "./solution-export-admission-codec.js";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunText,
  exportRunUnavailable,
  parseStoredExportRun,
} from "./solution-export-run-codec.js";
import { sql, type SqlExecutor } from "./sql.js";

const operation = EXPORT_ADMISSION_OPERATIONS.cancel;
const utc = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
/** Root-first cancellation with recoverable projection; never a substitute terminal receipt. */
export class PostgresSolutionExportCancellation {
  readonly producer: DurableSolutionExportProducer;
  constructor(producer: DurableSolutionExportProducer) {
    this.producer = producer;
  }
  #transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const authority = this.producer.authority;
    return authority.database.transaction(async (tx) => {
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
  async #bind(
    tx: SqlExecutor,
    record: StoredSolutionExportJob,
    key: string,
    request: string,
  ): Promise<void> {
    const existing = await tx.query(
      sql(
        `SELECT organization_id,operation_name,idempotency_key_sha256,request_sha256,principal_id,resource_kind,resource_id,lifecycle_status,${utc("created_at")} AS created_at,${utc("completed_at")} AS completed_at,${utc("expires_at")} AS expires_at FROM idempotency_records WHERE organization_id=$1 AND operation_name=$2 AND idempotency_key_sha256=$3 FOR UPDATE`,
        [record.organizationId, operation, key],
      ),
    );
    if (existing.rows.length === 0) {
      await tx.query(
        sql(
          "INSERT INTO idempotency_records(organization_id,operation_name,idempotency_key_sha256,request_sha256,principal_id,resource_kind,resource_id) VALUES($1,$2,$3,$4,$5,'solution-export-job',$6) ON CONFLICT DO NOTHING",
          [
            record.organizationId,
            operation,
            key,
            request,
            record.createdByPrincipalId,
            record.job.id,
          ],
        ),
      );
      return this.#bind(tx, record, key, request);
    }
    if (existing.rows.length !== 1) exportRunUnavailable();
    const found = parseExportAdmissionRow(existing.rows[0] ?? {});
    if (
      found.resourceId !== record.job.id ||
      found.request !== request ||
      found.principalId !== record.createdByPrincipalId
    )
      exportAdmissionConflict();
  }
  async project(
    root: AsyncJobRecordV1,
    recordInput: StoredSolutionExportJob,
  ): Promise<StoredSolutionExportJob> {
    const selector = {
      ...this.producer.authority.ownership,
      jobId: recordInput.job.id,
    };
    const current = await this.producer.runs.getJob(selector);
    if (
      current === null ||
      !exportRunEqual(
        current.record.workflowSubmission,
        recordInput.workflowSubmission,
      )
    )
      exportRunUnavailable();
    if (["succeeded", "failed", "canceled"].includes(current.record.job.state))
      return current.record;
    if (
      root.cancellation.state === "none" ||
      !["queued", "running", "canceled"].includes(root.state)
    )
      throw new ApplicationError(
        "service_unavailable",
        "The export terminal projection is still pending. Retry with the same Idempotency-Key.",
      );
    const canceled = root.state === "canceled";
    const { pollAfterMilliseconds: _poll, ...job } = current.record.job;
    const { currentStage, ...progress } = job.progress;
    void _poll;
    const stoppedStage =
      currentStage ??
      job.stages.find(
        (stage) => stage.status === "pending" || stage.status === "running",
      )?.stage;
    if (canceled && stoppedStage === undefined) exportRunUnavailable();
    const next = parseStoredExportRun({
      ...current.record,
      job: {
        ...job,
        state: canceled ? "canceled" : "cancellation-requested",
        cancellation: {
          state: canceled ? "acknowledged" : "requested",
          requestedAt: root.cancellation.requestedAt,
        },
        updatedAt: root.updatedAt,
        ...(canceled ? { completedAt: root.completedAt } : {}),
        ...(canceled ? {} : { pollAfterMilliseconds: 500 }),
        stages: canceled
          ? job.stages.map((stage) =>
              stage.stage === stoppedStage
                ? {
                    ...stage,
                    status: "canceled",
                    completedAt: root.completedAt,
                  }
                : stage,
            )
          : job.stages,
        progress: {
          ...progress,
          ...(!canceled && currentStage !== undefined ? { currentStage } : {}),
          message: canceled
            ? "The export was canceled."
            : "Cancellation has been requested.",
        },
      },
    });
    if (exportRunEqual(current.record, next)) return current.record;
    const bytes = exportRunBytes(next);
    const snapshot = await this.producer.objects.put(
      bytes,
      "checkpoint-state",
      this.producer.objects.identity("run-snapshot", exportAdmissionHash(next)),
    );
    const binding = createSolutionExportRunInsertionBindingV1(
      next.workflowSubmission,
    );
    const request = await this.producer.objects.metadata(
      binding.workflowRequestObjectId,
    );
    const input = await this.producer.objects.metadata(
      binding.orchestrationInputObjectId,
    );
    if (request?.state !== "published" || input?.state !== "published")
      exportRunUnavailable();
    const keys = await this.producer.authority.query(
      sql(
        "SELECT idempotency_key_sha256 FROM solution_export_runs WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3",
        [next.organizationId, next.job.projectId, next.job.id],
      ),
    );
    if (keys.rows.length !== 1) exportRunUnavailable();
    const committed = await this.producer.runs.commitCancellationProjection({
      expectedRecordVersion: current.recordVersion,
      expectedState: current.record.job.state,
      root,
      prepared: {
        record: next,
        snapshot,
        workflowRequest: request.reference,
        orchestrationInput: input.reference,
        idempotencyKeyDigest: `sha256:${exportRunText(keys.rows[0]?.["idempotency_key_sha256"])}`,
      },
    });
    if (!committed)
      throw new ApplicationError(
        "conflict",
        "The export changed during cancellation. Retry with the same Idempotency-Key.",
      );
    await this.producer.authority.scope();
    return next;
  }
  async cancel(input: {
    readonly idempotencyKeyDigest: Sha256Digest;
    readonly record: StoredSolutionExportJob;
  }): Promise<StoredSolutionExportJob> {
    const record = parseStoredExportRun(input.record);
    const authority = this.producer.authority;
    if (
      record.createdByPrincipalId !== authority.principal.principalId ||
      !exportRunEqual(
        {
          organizationId: record.organizationId,
          projectId: record.job.projectId,
        },
        authority.ownership,
      )
    )
      throw new ApplicationError(
        "access_denied",
        "This action is not available for the current account.",
      );
    const key = exportAdmissionKey(operation, {
      organizationId: record.organizationId,
      principalId: authority.principal.principalId,
      publicKeyDigest: input.idempotencyKeyDigest,
    });
    const request = exportAdmissionHash({
      contractVersion: 1,
      ...authority.ownership,
      jobId: record.job.id,
    }).slice(7);
    await this.#transaction((tx) => this.#bind(tx, record, key, request));
    const root = await this.producer.cancelRoot(record);
    const projected = await this.project(root, record);
    await this.#transaction(async (tx) => {
      await this.#bind(tx, projected, key, request);
      const current = await tx.query(
        sql(
          "SELECT solution_export_run_id FROM solution_export_runs WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3 AND lifecycle_status=$4 AND updated_at=$5::timestamptz FOR SHARE",
          [
            projected.organizationId,
            projected.job.projectId,
            projected.job.id,
            projected.job.state,
            projected.job.updatedAt,
          ],
        ),
      );
      if (current.rows.length !== 1) exportRunUnavailable();
      const changed = await tx.query(
        sql(
          "UPDATE idempotency_records SET lifecycle_status='completed',completed_at=COALESCE(completed_at,clock_timestamp()) WHERE organization_id=$1 AND operation_name=$2 AND idempotency_key_sha256=$3 AND request_sha256=$4 AND resource_id=$5 AND principal_id=$6 AND expires_at IS NULL",
          [
            projected.organizationId,
            operation,
            key,
            request,
            projected.job.id,
            projected.createdByPrincipalId,
          ],
        ),
      );
      if (changed.rowCount !== 1) exportRunUnavailable();
    });
    return projected;
  }
}
