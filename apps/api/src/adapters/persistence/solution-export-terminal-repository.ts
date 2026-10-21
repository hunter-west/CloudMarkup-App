import {
  parseAsyncJobRecordV1,
  sha256DigestSchema,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import type {
  ObjectPurpose,
  ObjectStore,
  StoredObjectReference,
} from "../../application/persistence.js";
import { projectInjectedSolutionExportResult } from "../../application/solution-export-projection.js";
import type { StoredSolutionExportJob } from "../../application/solution-exports.js";
import { SolutionExportArtifactObjects } from "./solution-export-artifact-objects.js";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunInteger,
  exportRunSha,
  exportRunText,
  exportRunUnavailable,
  immutableExportRun,
  parsePreparedExportRun,
  parseStoredExportRun,
} from "./solution-export-run-codec.js";
import { loadSolutionExportOrphanReceipt } from "./solution-export-orphan-objects.js";
import { projectSolutionExportOrphanTerminal } from "./solution-export-orphan-receipt.js";
import { parseSolutionExportTerminalReceipt } from "./solution-export-terminal-codec.js";
import {
  SolutionExportWorkerAuthority,
  type SolutionExportExecutionIdentity,
} from "./solution-export-worker-authority.js";
import {
  SolutionExportWorkflowStorage,
  solutionExportWorkflowByteLimit,
} from "./solution-export-workflow-storage.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

const utc = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
function previewPurpose(ownership: string): ObjectPurpose {
  switch (ownership) {
    case "architecture-as-code-source":
    case "user-owned-extension":
    case "user-provided":
      return "input-payload";
    case "generated-replaceable":
      return "generated-source";
    case "evidence-artifact":
      return "evidence";
    default:
      return exportRunUnavailable();
  }
}

/** Reconciliation is separate from the JobWorker's root/audit commit. No artifact is
 * inserted until the exact terminal root and immutable receipt agree. */
export class PostgresSolutionExportTerminalRepository {
  readonly authority: SolutionExportWorkerAuthority;
  readonly storage: SolutionExportWorkflowStorage;
  constructor(
    database: SqlDatabase,
    objects: ObjectStore,
    execution: SolutionExportExecutionIdentity,
    terminalAuthority?: SolutionExportWorkerAuthority,
  ) {
    if (
      terminalAuthority !== undefined &&
      (terminalAuthority.mode !== "terminal" ||
        !exportRunEqual(terminalAuthority.identity, execution))
    )
      exportRunUnavailable();
    this.authority =
      terminalAuthority ??
      new SolutionExportWorkerAuthority(database, execution, "terminal");
    this.storage = new SolutionExportWorkflowStorage(this.authority, objects);
  }
  async #root(tx: SqlExecutor, root: AsyncJobRecordV1): Promise<SqlRow> {
    const id = this.authority.identity;
    const result = await tx.query(
      sql(
        `SELECT j.output_sha256,j.safe_failure_code,j.failure_classification,j.public_failure_message,j.cancellation_requested_at,s.snapshot_sha256,${utc("j.completed_at")} AS completed_at
      FROM async_jobs j
      JOIN async_job_record_snapshots s ON s.organization_id=j.organization_id AND s.project_id=j.project_id
        AND s.job_id=j.job_id AND s.record_version=j.record_version
      JOIN stored_objects o ON o.organization_id=s.organization_id AND o.project_id=s.project_id AND o.object_id=s.snapshot_object_id
        AND o.content_sha256=s.snapshot_sha256 AND o.lifecycle_state='published' AND o.object_purpose='report'
      JOIN async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id
        AND a.attempt_id=$8 AND a.attempt_number=$9 AND a.worker_reference=$10
        AND (a.lifecycle_status=j.lifecycle_status OR (j.lifecycle_status='failed' AND a.lifecycle_status='orphaned') OR (j.lifecycle_status='expired' AND a.lifecycle_status='canceled'))
        AND a.attempt_number=(SELECT max(last_attempt.attempt_number) FROM async_job_attempts last_attempt
          WHERE last_attempt.organization_id=j.organization_id AND last_attempt.job_id=j.job_id)
      WHERE j.organization_id=$1 AND j.project_id=$2 AND j.job_id=$3
        AND j.record_version=$4 AND j.lifecycle_status=$5 AND j.input_sha256=$6
        AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL AND j.family='solution-export-orchestration'
        AND j.created_by_principal_id=$7 AND j.idempotency_actor_id=$7 FOR UPDATE OF j FOR SHARE OF a,o`,
        [
          id.organizationId,
          id.projectId,
          id.jobId,
          root.recordVersion,
          root.state,
          id.inputDigest.slice(7),
          id.actorId,
          id.attemptId,
          id.attemptNumber,
          id.workerId,
        ],
      ),
    );
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      row?.["snapshot_sha256"] !== exportRunSha(exportRunBytes(root)) ||
      row["completed_at"] !== root.completedAt ||
      row["output_sha256"] !==
        (root.output === undefined
          ? null
          : exportRunSha(exportRunBytes(root.output))) ||
      row["safe_failure_code"] !== (root.failure?.code ?? null) ||
      row["failure_classification"] !==
        (root.failure?.classification ?? null) ||
      row["public_failure_message"] !== (root.failure?.publicMessage ?? null) ||
      (root.state === "succeeded" && row["cancellation_requested_at"] !== null)
    )
      exportRunUnavailable();
    return row;
  }
  async #run(tx: SqlExecutor): Promise<SqlRow> {
    const id = this.authority.identity;
    const found = await tx.query(
      sql(
        `SELECT * FROM solution_export_runs
      WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3 FOR UPDATE`,
        [id.organizationId, id.projectId, id.jobId],
      ),
    );
    if (found.rows.length !== 1 || found.rows[0] === undefined)
      exportRunUnavailable();
    return found.rows[0];
  }
  async #published(objectId: string): Promise<StoredObjectReference> {
    const object = await this.storage.metadata(objectId);
    if (
      object?.state !== "published" ||
      object.reference.sizeBytes >
        solutionExportWorkflowByteLimit(
          object.reference.purpose,
          object.reference.mediaType,
        )
    )
      exportRunUnavailable();
    return object.reference;
  }
  async reconcile(input: AsyncJobRecordV1): Promise<StoredSolutionExportJob> {
    const root = parseAsyncJobRecordV1(input);
    const id = this.authority.identity;
    const attempt = root.attempts.at(-1);
    if (
      root.jobId !== id.jobId ||
      !exportRunEqual(root.ownership, this.authority.ownership) ||
      root.idempotency.actorId !== id.actorId ||
      root.inputDigest !== id.inputDigest ||
      root.completedAt === undefined ||
      !["succeeded", "failed", "canceled", "expired"].includes(root.state) ||
      attempt?.attemptId !== id.attemptId ||
      attempt.attemptNumber !== id.attemptNumber ||
      !(
        attempt.state === root.state ||
        (root.state === "failed" && attempt.state === "orphaned") ||
        (root.state === "expired" && attempt.state === "canceled")
      )
    )
      exportRunUnavailable();
    const before = await this.authority.transaction(async (tx) => {
      await this.#root(tx, root);
      return this.#run(tx);
    });
    const orphan = await loadSolutionExportOrphanReceipt(
      this.storage,
      id,
      root,
    );
    let receipt:
      ReturnType<typeof parseSolutionExportTerminalReceipt> | undefined;
    if (orphan === null) {
      // Ordinary worker receipts still require identical root/attempt terminal
      // states. Orphan/expiry pairs can only use their distinct canonical proof.
      if (root.state === "expired" || attempt.state !== root.state)
        exportRunUnavailable();
      const receiptId = this.storage.identity("terminal-receipt", {
        jobId: id.jobId,
        attemptId: id.attemptId,
        value: null,
      });
      const receiptObject = await this.#published(receiptId);
      if (receiptObject.purpose !== "report") exportRunUnavailable();
      receipt = parseSolutionExportTerminalReceipt(
        await this.storage.readJson(receiptObject),
      );
      if (
        !exportRunEqual(receipt.execution, id) ||
        receipt.result.outcome.outcome !== root.state ||
        (receipt.result.outcome.outcome === "succeeded" &&
          !exportRunEqual(receipt.result.outcome.output, root.output)) ||
        (receipt.result.outcome.outcome === "failed" &&
          !exportRunEqual(receipt.result.outcome.failure, root.failure))
      )
        exportRunUnavailable();
    }
    const prepared = orphan?.receipt.prepared ?? receipt?.prepared;
    if (prepared === undefined) exportRunUnavailable();
    const snapshot = await this.#published(
      exportRunText(before["workflow_read_model_object_id"]),
    );
    if (
      snapshot.purpose !== "checkpoint-state" ||
      snapshot.contentSha256 !== before["workflow_read_model_sha256"]
    )
      exportRunUnavailable();
    const prior = parseStoredExportRun(await this.storage.readJson(snapshot));
    if (prior.job.state !== before["lifecycle_status"]) exportRunUnavailable();
    const completedAt = root.completedAt;
    // Fixed from the committed root, never from reconciliation wall time or a caller's requested expiry.
    const retentionExpiresAt = new Date(
      Date.parse(completedAt) + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const retained = receipt?.retained;
    const manifest =
      retained === undefined
        ? undefined
        : await this.#published(retained.manifestObjectId);
    const archive =
      retained === undefined
        ? undefined
        : await this.#published(retained.archiveObject.objectId);
    const verifiedArtifact =
      retained === undefined || manifest === undefined || archive === undefined
        ? undefined
        : await new SolutionExportArtifactObjects(this.storage.store).read(
            {
              archive,
              manifest,
              archiveFileName: retained.archiveFileName,
              fileCount: retained.fileCount,
              organizationId: id.organizationId,
              projectId: id.projectId,
              solutionRevisionId:
                prepared.job.solutionRevision.solutionRevisionId,
              solutionRevisionDigest: sha256DigestSchema.parse(
                prepared.job.solutionRevision.manifestDigest,
              ),
            },
            () => this.authority.scope(),
          );
    const projected =
      orphan !== null
        ? {
            state: "terminal" as const,
            job: projectSolutionExportOrphanTerminal(
              orphan.receipt,
              orphan.prior,
              root,
            ),
          }
        : receipt === undefined
          ? exportRunUnavailable()
          : projectInjectedSolutionExportResult({
              material: {
                completedAt,
                retentionExpiresAt,
                stored: prepared,
                ...(verifiedArtifact === undefined ? {} : { verifiedArtifact }),
              },
              result: {
                outcome: receipt.result.outcome,
                ...(receipt.result.persistedOutput === undefined
                  ? {}
                  : { persistedOutput: receipt.result.persistedOutput }),
                ...(receipt.result.readModel === undefined
                  ? {}
                  : { readModel: receipt.result.readModel }),
              },
              submission: prepared.workflowSubmission,
            });
    if (["succeeded", "failed", "canceled"].includes(prior.job.state)) {
      if (!exportRunEqual(prior, projected.job)) exportRunUnavailable();
      await this.authority.transaction(async (tx) => {
        await this.#root(tx, root);
        const current = await this.#run(tx);
        if (current["workflow_read_model_object_id"] !== snapshot.objectId)
          exportRunUnavailable();
        await this.#artifactReplay(tx, projected.job);
      });
      return projected.job;
    }
    if (
      !exportRunEqual(
        immutableExportRun(parsePreparedExportRun(prior)),
        immutableExportRun(prepared),
      )
    )
      exportRunUnavailable();
    const next = await this.storage.put(
      exportRunBytes(projected.job),
      "checkpoint-state",
      "application/json",
    );
    const coverage = await this.storage.put(
      exportRunBytes(projected.job.job.generationCoverage),
      "evidence",
      "application/json",
    );
    const evidence = await this.storage.put(
      exportRunBytes(projected.job.job.evidence),
      "evidence",
      "application/json",
    );
    const diagnostics = await this.storage.put(
      exportRunBytes(projected.job.job.diagnostics),
      "validation-report",
      "application/json",
    );
    const previews = new Map<string, StoredObjectReference>();
    if (projected.state === "succeeded")
      for (const file of projected.artifact.artifact.files) {
        if (!file.previewAvailable) continue;
        const bytes = projected.artifact.fileContents.get(file.id);
        if (
          bytes === undefined ||
          exportRunSha(bytes) !== file.checksum.slice(7)
        )
          exportRunUnavailable();
        previews.set(
          file.id,
          await this.storage.put(
            bytes,
            previewPurpose(file.ownership),
            file.mediaType,
          ),
        );
      }
    await this.authority.transaction(async (tx) => {
      await this.#root(tx, root);
      const current = await this.#run(tx);
      if (current["workflow_read_model_object_id"] === next.objectId) {
        await this.#artifactReplay(tx, projected.job);
        return;
      }
      if (
        exportRunInteger(current["record_version"]) !==
          exportRunInteger(before["record_version"]) ||
        current["workflow_read_model_object_id"] !== snapshot.objectId ||
        current["lifecycle_status"] !== prior.job.state
      )
        exportRunUnavailable();
      const job = projected.job.job;
      const updated = await tx.query(
        sql(
          `UPDATE solution_export_runs SET lifecycle_status=$4,progress_stage=$5,
        progress_completed_stages=$6,progress_message=$7,completed_at=$8::timestamptz,updated_at=$8::timestamptz,
        cancellation_requested_at=$9::timestamptz,cancellation_acknowledged_at=$10::timestamptz,
        workflow_read_model_object_id=$11,workflow_read_model_sha256=$12,generation_coverage_object_id=$13,generation_coverage_sha256=$14,
        evidence_object_id=$15,evidence_sha256=$16,diagnostics_object_id=$17,diagnostics_sha256=$18,record_version=record_version+1
        WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3 AND record_version=$19 RETURNING solution_export_run_id`,
          [
            id.organizationId,
            id.projectId,
            id.jobId,
            job.state,
            job.progress.currentStage ?? null,
            job.progress.completedStages,
            job.progress.message,
            completedAt,
            job.cancellation.requestedAt ?? null,
            job.cancellation.state === "acknowledged" ? completedAt : null,
            next.objectId,
            next.contentSha256,
            coverage.objectId,
            coverage.contentSha256,
            evidence.objectId,
            evidence.contentSha256,
            diagnostics.objectId,
            diagnostics.contentSha256,
            exportRunInteger(before["record_version"]),
          ],
        ),
      );
      if (updated.rows.length !== 1) exportRunUnavailable();
      if (projected.state === "succeeded") {
        if (manifest === undefined || archive === undefined)
          exportRunUnavailable();
        const artifact = projected.artifact.artifact;
        await tx.query(
          sql(
            `INSERT INTO solution_export_artifacts(solution_export_artifact_id,organization_id,project_id,
          solution_export_run_id,solution_revision_id,manifest_object_id,manifest_sha256,manifest_size_bytes,archive_object_id,
          archive_sha256,archive_file_name,file_count,size_bytes,retention_expires_at,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::timestamptz)`,
            [
              artifact.id,
              id.organizationId,
              id.projectId,
              id.jobId,
              artifact.solutionRevisionId,
              manifest.objectId,
              manifest.contentSha256,
              manifest.sizeBytes,
              archive.objectId,
              archive.contentSha256,
              artifact.archiveFileName,
              artifact.fileCount,
              artifact.sizeBytes,
              retentionExpiresAt,
              completedAt,
            ],
          ),
        );
        for (const file of artifact.files)
          await tx.query(
            sql(
              `INSERT INTO solution_export_artifact_files(solution_export_file_id,
          organization_id,project_id,solution_export_artifact_id,repository_path,media_type,ownership,content_sha256,
          semantic_sha256,size_bytes,preview_available,content_object_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz)`,
              [
                file.id,
                id.organizationId,
                id.projectId,
                artifact.id,
                file.path,
                file.mediaType,
                file.ownership,
                file.checksum.slice(7),
                file.semanticChecksum.slice(7),
                file.sizeBytes,
                file.previewAvailable,
                previews.get(file.id)?.objectId ?? null,
                completedAt,
              ],
            ),
          );
      }
    });
    return projected.job;
  }
  async #artifactReplay(
    tx: SqlExecutor,
    record: StoredSolutionExportJob,
  ): Promise<void> {
    const id = this.authority.identity;
    const found = await tx.query(
      sql(
        "SELECT solution_export_artifact_id,archive_sha256,manifest_sha256 FROM solution_export_artifacts WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3",
        [id.organizationId, id.projectId, id.jobId],
      ),
    );
    if (record.job.artifact === undefined) {
      if (found.rows.length !== 0) exportRunUnavailable();
      return;
    }
    const row = found.rows[0];
    if (
      found.rows.length !== 1 ||
      row?.["solution_export_artifact_id"] !== record.job.artifact.artifactId ||
      sha256DigestSchema.parse(
        `sha256:${exportRunText(row["archive_sha256"])}`,
      ) !== record.job.artifact.digest ||
      sha256DigestSchema.parse(
        `sha256:${exportRunText(row["manifest_sha256"])}`,
      ) !== record.job.artifact.manifestDigest
    )
      exportRunUnavailable();
  }
}
