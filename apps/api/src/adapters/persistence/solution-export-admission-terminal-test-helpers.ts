import {
  DefaultJobFailureClassifier,
  InMemoryJobHandlerRegistry,
  InMemoryJobOrchestrationDecisionPort,
  JobWorker,
  type JobAuditPort,
  type JobHandlerV1,
  type JobIdGenerator,
  type JobQueue,
} from "@cloudmarkup/job-framework";
import {
  serializeCanonicalJson,
  utcTimestampSchema,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import { terraformValidationRequestV1Schema } from "@cloudmarkup/terraform-validation-runner";
import type { ObjectStore } from "../../application/persistence.js";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";
import type { StoredSolutionExportJob } from "../../application/solution-exports.js";
import { createDurableSolutionExportHandler } from "../../solution-export-worker.js";
import { PostgresAsyncJobRepository } from "./async-job-repository.js";
import {
  SolutionExportPublicationReadiness,
  type DurableSolutionExportProducer,
} from "./solution-export-producer.js";
import {
  exportTerminalIconRegistry,
  exportTerminalIconSet,
  syntheticBoundValidationResult,
} from "./solution-export-terminal-test-helpers.js";
import {
  solutionExportExecutionIdentity,
  type SolutionExportExecutionIdentity,
} from "./solution-export-worker-authority.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

interface AdmissionTerminalFixture {
  readonly worker: JobWorker;
  readonly repository: PostgresAsyncJobRepository;
  readonly calls: { compiler: number; validation: number; build: number };
  execute(): Promise<{
    readonly root: AsyncJobRecordV1;
    readonly execution: SolutionExportExecutionIdentity;
  }>;
}

/** Real worker, checkpoints, generator, renderer, packager and PG lifecycle.
 * Only compiler/validator execution results are synthetic injected test inputs;
 * this does not claim a Go/Terraform process or a hosted executor was run. */
export async function admissionTerminalFixture(input: {
  readonly database: SqlDatabase;
  readonly producer: DurableSolutionExportProducer;
  readonly objectStore: ObjectStore;
  readonly record: StoredSolutionExportJob;
  readonly compilation: unknown;
  readonly queue: JobQueue;
  readonly audit: JobAuditPort;
  readonly ids: JobIdGenerator;
}): Promise<AdmissionTerminalFixture> {
  const queued = await input.producer.getRoot(input.record);
  if (queued?.state !== "queued")
    throw new Error("The selected genuine queued root is required.");
  const binding = createSolutionExportRunInsertionBindingV1(
    input.record.workflowSubmission,
  );
  const repository = new PostgresAsyncJobRepository({
    database: input.database,
    objects: input.producer.objects.jobPort(
      binding.orchestrationInputObjectId,
      queued.inputDigest,
    ),
    ownership: queued.ownership,
  });
  const settings =
    input.record.workflowSubmission.request.targetSettings.stageDescriptors;
  if (!("terraformValidation" in settings))
    throw new Error("The admission fixture requires the Terraform target.");
  const clock = { now: () => new Date() };
  const calls = { compiler: 0, validation: 0, build: 0 };
  const handler = createDurableSolutionExportHandler({
    database: input.database,
    objectStore: input.objectStore,
    compiler: {
      executor: {
        execute: () => {
          calls.compiler++;
          return Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: serializeCanonicalJson(input.compilation),
            termination: "completed" as const,
          });
        },
      },
    },
    validation: {
      approvedSettings: settings.terraformValidation,
      runner: {
        run: (request) => {
          calls.validation++;
          return Promise.resolve(
            syntheticBoundValidationResult(
              terraformValidationRequestV1Schema.parse(request),
              settings.terraformValidation,
            ),
          );
        },
      },
    },
    applicationBuild: {
      approvedSettings: settings.applicationBuild,
      runner: {
        run: () => {
          calls.build++;
          return Promise.reject(
            new Error("Infrastructure-only must not build applications."),
          );
        },
      },
    },
    diagram: {
      catalog: exportTerminalIconRegistry.catalog,
      iconSet: exportTerminalIconSet,
    },
    clock,
  });
  let execution: SolutionExportExecutionIdentity | undefined;
  const observed: JobHandlerV1 = {
    ...handler,
    async execute(record, context) {
      execution = solutionExportExecutionIdentity(record);
      return handler.execute(record, context);
    },
  };
  const worker = new JobWorker({
    audit: input.audit,
    clock,
    ids: input.ids,
    queue: input.queue,
    repository,
    publicationReadiness: new SolutionExportPublicationReadiness(
      input.producer.authority,
      input.producer.objects,
      input.producer.runs,
    ),
    handlers: new InMemoryJobHandlerRegistry([observed]),
    orchestration: new InMemoryJobOrchestrationDecisionPort(),
    failureClassifier: new DefaultJobFailureClassifier(),
  });
  return {
    worker,
    repository,
    calls,
    async execute() {
      const root = await worker.runNext("worker.admission-terminal", 300_000);
      if (root === null || execution === undefined)
        throw new Error("The genuine selected worker attempt did not execute.");
      return { root, execution };
    },
  };
}

const RETENTION_SELECT =
  "SELECT retention_expires_at>clock_timestamp() AS retained FROM solution_export_artifacts WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3 AND solution_export_artifact_id=$4 AND retention_expires_at=$5::timestamptz FOR SHARE";

/** Thirty days do not elapse in this test. Only this exact locked read receives
 * a deterministic as-of clock; PG evaluates the real immutable row and predicate.
 * Every other query is forwarded unchanged, including auth/lease clock checks. */
export function admissionRetentionAsOf(
  database: SqlDatabase,
  asOf: string,
): {
  readonly database: SqlDatabase;
  readonly intercepted: { original: SqlStatement; executed: SqlStatement }[];
} {
  utcTimestampSchema.parse(asOf);
  const intercepted: { original: SqlStatement; executed: SqlStatement }[] = [];
  function wrap(executor: SqlExecutor): SqlExecutor {
    return {
      query<TRow extends SqlRow>(statement: SqlStatement) {
        if (statement.text === RETENTION_SELECT) {
          if (statement.values.length !== 5)
            throw new Error("The exact retention query parameters changed.");
          const executed = sql(
            statement.text.replace("clock_timestamp()", "$6::timestamptz"),
            [...statement.values, asOf],
          );
          intercepted.push({ original: statement, executed });
          return executor.query<TRow>(executed);
        }
        if (
          statement.text.includes("AS retained FROM solution_export_artifacts")
        )
          throw new Error(
            "Refusing an unrecognized retention clock substitution.",
          );
        return executor.query<TRow>(statement);
      },
    };
  }
  return {
    intercepted,
    database: {
      ...wrap(database),
      transaction: (work) => database.transaction((tx) => work(wrap(tx))),
      close: () => Promise.resolve(),
    },
  };
}
