import { randomUUID } from "node:crypto";
import { isProviderDirectExportFundingReferenceV1 } from "./application/provider-direct-export-funding.js";
import {
  observeSolutionExportStage,
  recordSolutionExportDiagnostic,
  type SolutionExportDiagnostics,
  type SolutionExportStage,
} from "./solution-export-diagnostics.js";
import { deriveAsyncJobQueueEnvelopeV1 } from "@cloudmarkup/domain";
import {
  DefaultJobFailureClassifier,
  JobWorker,
  type JobAuditPort,
  type JobQueuePublisherV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobTrustedContextV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  type AsyncJobQueueEnvelopeV1,
} from "@cloudmarkup/schemas";
import { ApplicationError } from "./application/errors.js";
import {
  createDurableSolutionExportHandler,
  type DurableSolutionExportHandlerOptions,
} from "./solution-export-worker.js";
import { PostgresAsyncJobRepository } from "./adapters/persistence/async-job-repository.js";
import {
  createSolutionExportExecutionRepository,
  reconcileOrphanedSolutionExport,
} from "./adapters/persistence/solution-export-execution-repository.js";
import { claimSolutionExport } from "./adapters/persistence/solution-export-initial-claim.js";
import { parseSolutionExportExecutionEnvelope } from "./adapters/persistence/solution-export-initial-claim-authority.js";
import { SolutionExportProducerObjects } from "./adapters/persistence/solution-export-producer-objects.js";
import {
  exportRunInteger,
  exportRunText,
  exportRunUnavailable,
} from "./adapters/persistence/solution-export-run-codec.js";
import { PostgresSolutionExportTerminalRecovery } from "./adapters/persistence/solution-export-terminal-recovery.js";
import { PostgresSolutionExportTerminalRepository } from "./adapters/persistence/solution-export-terminal-repository.js";
import {
  solutionExportExecutionIdentity,
  SolutionExportWorkerAuthority,
} from "./adapters/persistence/solution-export-worker-authority.js";
import { sql } from "./adapters/persistence/sql.js";

export type SolutionExportDeliveryResult =
  | { readonly state: "completed"; readonly jobId: string }
  | { readonly state: "pending"; readonly jobId: string };

/** One FIFO delivery remains unacknowledged through due retries. Each attempt
 * is derived from the current verified root and admitted by the real atomic
 * claim, rather than trusting an older message's version or retry counters.
 * Terminal reconciliation must succeed before the transport may acknowledge. */
export function createSolutionExportDeliveredWorker(
  options: DurableSolutionExportHandlerOptions & {
    readonly audit: JobAuditPort;
    readonly publisher: JobQueuePublisherV1;
    readonly workerId: string;
    readonly diagnostics?: SolutionExportDiagnostics;
  },
) {
  const handler = createDurableSolutionExportHandler(options);
  const recovery = new PostgresSolutionExportTerminalRecovery(
    options.database,
    options.objectStore,
  );

  async function inspect(envelope: AsyncJobQueueEnvelopeV1) {
    const result = await options.database.query(
      sql(
        `SELECT j.lifecycle_status,j.record_version,j.attempt_count,j.entitlement_decision_reference,
        j.created_by_principal_id,a.attempt_id,a.worker_reference,
        a.lease_expires_at <= clock_timestamp() AS lease_expired,
        x.orchestration_input_object_id
      FROM async_jobs j JOIN solution_export_runs x
        ON x.organization_id=j.organization_id AND x.project_id=j.project_id
        AND x.root_job_id=j.job_id AND x.solution_export_run_id=j.job_id
      LEFT JOIN async_job_attempts a ON a.organization_id=j.organization_id
        AND a.job_id=j.job_id AND a.attempt_number=j.attempt_count
      WHERE j.organization_id=$1 AND j.project_id=$2 AND j.job_id=$3
        AND j.family='solution-export-orchestration' AND j.root_job_id=j.job_id
        AND j.parent_job_id IS NULL AND j.input_sha256=$4 AND j.correlation_id=$5
        AND j.record_version >= $6 AND j.attempt_count >= $7
        AND j.created_by_principal_id=x.created_by_principal_id
        AND j.idempotency_actor_id=x.created_by_principal_id`,
        [
          envelope.ownership.organizationId,
          envelope.ownership.projectId ?? null,
          envelope.jobId,
          envelope.inputDigest.slice(7),
          envelope.correlationId,
          envelope.recordVersion,
          envelope.attemptNumber - 1,
        ],
      ),
    );
    if (result.rows.length !== 1 || result.rows[0] === undefined)
      exportRunUnavailable();
    const reference = result.rows[0]["entitlement_decision_reference"];
    const direct =
      typeof reference === "string" &&
      isProviderDirectExportFundingReferenceV1(reference);
    if (options.fundingSource === "provider-direct" ? !direct : direct)
      exportRunUnavailable();
    return result.rows[0];
  }

  return {
    async processEnvelope(
      value: unknown,
    ): Promise<SolutionExportDeliveryResult> {
      const original = parseSolutionExportExecutionEnvelope(value);
      const observe = <T>(stage: SolutionExportStage, work: () => Promise<T>) =>
        observeSolutionExportStage(
          options.diagnostics,
          stage,
          original.jobId,
          work,
        );
      const row = await observe("inspect", () => inspect(original));
      const state = row["lifecycle_status"];
      if (
        ["succeeded", "failed", "canceled", "expired"].includes(String(state))
      ) {
        const terminal = await observe("recover", () =>
          recovery.recover(
            asyncJobTrustedContextV1Schema.parse({
              actor: { kind: "system", reason: "orphan-reconciler" },
              correlationId: original.correlationId,
              ownership: original.ownership,
            }),
            original.jobId,
          ),
        );
        if (!["succeeded", "failed", "canceled"].includes(terminal.job.state))
          exportRunUnavailable();
        return { state: "completed", jobId: original.jobId };
      }
      if (state === "running") {
        if (row["lease_expired"] === true) {
          const projectId = original.ownership.projectId;
          if (projectId === undefined) exportRunUnavailable();
          await observe("recover", () =>
            reconcileOrphanedSolutionExport({
              database: options.database,
              objectStore: options.objectStore,
              identity: {
                jobId: original.jobId,
                organizationId: original.ownership.organizationId,
                projectId,
                inputDigest: original.inputDigest,
                actorId: exportRunText(row["created_by_principal_id"]),
                attemptId: exportRunText(row["attempt_id"]),
                attemptNumber: exportRunInteger(row["attempt_count"]),
                workerId: exportRunText(row["worker_reference"]),
              },
            }),
          );
        }
        return { state: "pending", jobId: original.jobId };
      }
      if (state !== "queued") exportRunUnavailable();
      let envelope = original;
      if (exportRunInteger(row["record_version"]) !== original.recordVersion) {
        const projectId = original.ownership.projectId;
        if (projectId === undefined) exportRunUnavailable();
        const authority = new SolutionExportWorkerAuthority(
          options.database,
          {
            jobId: original.jobId,
            organizationId: original.ownership.organizationId,
            projectId,
            inputDigest: original.inputDigest,
            actorId: exportRunText(row["created_by_principal_id"]),
            attemptId: exportRunText(row["attempt_id"]),
            attemptNumber: exportRunInteger(row["attempt_count"]),
            workerId: exportRunText(row["worker_reference"]),
          },
          "lifecycle",
        );
        const objects = new SolutionExportProducerObjects(
          authority,
          options.objectStore,
        );
        const root = await new PostgresAsyncJobRepository({
          database: authority,
          ownership: asyncJobTrustedOwnershipV1Schema.parse(
            authority.ownership,
          ),
          objects: objects.jobPort(
            exportRunText(row["orchestration_input_object_id"]),
            original.inputDigest,
          ),
        }).get(original.jobId);
        if (root?.state !== "queued") exportRunUnavailable();
        envelope = deriveAsyncJobQueueEnvelopeV1(root);
      }
      // SQL claim independently rechecks database time after metadata locks.
      if (Date.parse(envelope.availableAt) > options.clock.now().getTime())
        return { state: "pending", jobId: original.jobId };
      const claimed = await observe("claim", () =>
        claimSolutionExport({
          database: options.database,
          objectStore: options.objectStore,
          envelope,
          workerId: options.workerId,
        }),
      );
      const identity = solutionExportExecutionIdentity(claimed);
      const repository = await observe("hydrate", () =>
        createSolutionExportExecutionRepository({
          database: options.database,
          objectStore: options.objectStore,
          claimed,
        }),
      );
      const worker = new JobWorker({
        audit: options.audit,
        clock: options.clock,
        handlers: {
          get: (family) => (family === handler.family ? handler : null),
        },
        failureClassifier: new DefaultJobFailureClassifier(),
        ids: { nextId: (kind) => `${kind}.${randomUUID()}` },
        orchestration: {
          record: () =>
            Promise.reject(
              new ApplicationError(
                "conflict",
                "An immutable export root cannot act on a parent.",
              ),
            ),
        },
        publisher: options.publisher,
        repository,
        // The original delivery owns retry wakeup until terminal reconciliation.
        // No readiness port is supplied to publish an additional delivery.
      });
      const completed = await observe("execute", () =>
        worker.runClaimed(claimed, options.workerId, 300_000),
      );
      if (completed.state === "queued")
        return { state: "pending", jobId: original.jobId };
      await observe("reconcile", () =>
        new PostgresSolutionExportTerminalRepository(
          options.database,
          options.objectStore,
          identity,
        ).reconcile(completed),
      );
      return { state: "completed", jobId: original.jobId };
    },
  };
}

/** Source validation happens for the entire bounded batch before any SQL or
 * executor call. FIFO ordering retains the failed record and every later item. */
export function createSolutionExportQueueHandler(options: {
  readonly expectedQueueArn: string;
  readonly diagnostics?: SolutionExportDiagnostics;
  readonly worker: ReturnType<typeof createSolutionExportDeliveredWorker>;
}) {
  if (
    !/^arn:aws:sqs:[a-z0-9-]+:\d{12}:cloudmarkup-(?:(?:beta|dev|staging|prod)-jobs|beta-solution-exports)\.fifo$/u.test(
      options.expectedQueueArn,
    )
  )
    throw new Error("The export queue configuration is invalid.");
  return async (event: unknown) => {
    if (typeof event !== "object" || event === null || Array.isArray(event))
      exportRunUnavailable();
    const raw: unknown = (event as Record<string, unknown>)["Records"];
    if (!Array.isArray(raw) || raw.length > 10) exportRunUnavailable();
    const ids = new Set<string>();
    const records = raw.map((value: unknown) => {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        exportRunUnavailable();
      const row = value as Record<string, unknown>;
      const id = row["messageId"],
        body = row["body"];
      if (
        typeof id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(id) ||
        ids.has(id) ||
        typeof body !== "string" ||
        Buffer.byteLength(body, "utf8") > 8192 ||
        row["eventSource"] !== "aws:sqs" ||
        row["eventSourceARN"] !== options.expectedQueueArn
      )
        exportRunUnavailable();
      ids.add(id);
      return { id, body };
    });
    for (const [index, record] of records.entries()) {
      try {
        recordSolutionExportDiagnostic(
          options.diagnostics,
          "delivery",
          "started",
          record.id,
        );
        const result = await options.worker.processEnvelope(
          JSON.parse(record.body) as unknown,
        );
        recordSolutionExportDiagnostic(
          options.diagnostics,
          "delivery",
          result.state,
          record.id,
        );
        if (result.state === "completed") continue;
      } catch (error) {
        recordSolutionExportDiagnostic(
          options.diagnostics,
          "delivery",
          "failed",
          record.id,
          undefined,
          error,
        );
      }
      return {
        batchItemFailures: records
          .slice(index)
          .map(({ id }) => ({ itemIdentifier: id })),
      };
    }
    return { batchItemFailures: [] };
  };
}
