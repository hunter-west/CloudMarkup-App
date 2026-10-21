import { createProductionCleanupHistory } from "./production-cleanup-history.js";
import { createBetaApplicationSourceModel } from "@cloudmarkup/model-gateway";
import { randomUUID } from "node:crypto";
import {
  observeSolutionExportStage,
  type SolutionExportDiagnostics,
} from "./solution-export-diagnostics.js";

const diagnostics: SolutionExportDiagnostics = (event) => {
  console.info(JSON.stringify(event));
};
import { S3Client } from "@aws-sdk/client-s3";
import type { JobQueuePublisherV1 } from "@cloudmarkup/job-framework";
import { createPinnedSolutionExportCompilerExecutor } from "./adapters/pinned-export-compiler.js";
import { createProductionDatabase } from "./production-database.js";
import { createProductionCleanupIncarnation } from "./production-cleanup-incarnation.js";
import { S3ObjectStore } from "./adapters/persistence/s3-object-store.js";
import { createProjectWriteFencedObjectStore } from "./adapters/persistence/project-content-write-fence.js";
import { PostgresSolutionExportDownloadRepository } from "./adapters/persistence/solution-export-download-repository.js";
import { parseSolutionExportExecutionEnvelope } from "./adapters/persistence/solution-export-initial-claim-authority.js";
import {
  exportRunEqual,
  exportRunUnavailable,
} from "./adapters/persistence/solution-export-run-codec.js";
import { readProductionSolutionExportEnvironment } from "./production-solution-export-environment.js";
import { loadProductionSolutionExportProfile } from "./production-solution-export-profile.js";
import { assertProductionSolutionExportRequest } from "./production-solution-export-host.js";
import { assertProductionSolutionExportStageAdmission } from "./production-solution-export-stage-admission.js";
import { ProductionSolutionExportAudit } from "./production-solution-export-audit.js";
import {
  createSolutionExportDeliveredWorker,
  createSolutionExportQueueHandler,
} from "./solution-export-consumer.js";

async function createWorker(environment: NodeJS.ProcessEnv) {
  const config = readProductionSolutionExportEnvironment(environment);
  if (config === undefined) exportRunUnavailable();
  const admitted = await loadProductionSolutionExportProfile(config);
  const database = createProductionDatabase(
    {
      database: config.databaseName,
      resourceArn: config.databaseArn,
      secretArn: config.databaseSecretArn,
    },
    environment,
    "export",
    createProductionCleanupIncarnation(environment),
  );
  const history = createProductionCleanupHistory(environment);
  const objectStore = createProjectWriteFencedObjectStore({
    database,
    storageNamespace: "documents",
    ...(history === undefined ? {} : { history }),
    delegate: new S3ObjectStore({
      requireDefinitiveStage: history !== undefined,
      bucket: config.contentBucket,
      keyPrefix: config.documentPrefix,
      client: new S3Client({
        region: config.queue.region,
        ...(history === undefined
          ? {}
          : {
              maxAttempts: 1,
              requestHandler: {
                connectionTimeout: 5000,
                requestTimeout: 20000,
              },
            }),
      }),
    }),
  });
  // Durable redelivery owns retry wakeup. This restricted host cannot start a
  // second transport delivery or execute general orchestration.
  const publisher: JobQueuePublisherV1 = {
    contractVersion: 1,
    publish: () =>
      Promise.reject(
        new Error("The original export delivery owns retry wakeup."),
      ),
  };
  return createSolutionExportQueueHandler({
    expectedQueueArn: config.queue.queueArn,
    diagnostics,
    worker: {
      async processEnvelope(value) {
        const envelope = parseSolutionExportExecutionEnvelope(value);
        const projectId = envelope.ownership.projectId;
        if (projectId === undefined) exportRunUnavailable();
        const ownership = {
          organizationId: envelope.ownership.organizationId,
          projectId,
        };
        const audit = new ProductionSolutionExportAudit(database, ownership);
        const worker = createSolutionExportDeliveredWorker({
          executionProfile: "cloudformation-infrastructure-only",
          applicationSourceModel: createBetaApplicationSourceModel(),
          diagnostics,
          database,
          objectStore,
          compiler: {
            executor: createPinnedSolutionExportCompilerExecutor(
              config.compiler,
            ),
          },
          diagram: admitted.diagram,
          assertCurrentStageAdmission: (input) =>
            assertProductionSolutionExportStageAdmission(
              input,
              admitted.targetSettings,
              config.enabled,
            ),
          assertRequestHostBinding: (request) => {
            assertProductionSolutionExportRequest(
              request,
              admitted.targetSettings,
            );
          },
          clock: { now: () => new Date() },
          audit,
          publisher,
          workerId: "worker.export." + randomUUID(),
          async readPreviousPackage(input, authority) {
            if (input.previous === undefined) exportRunUnavailable();
            const stored = await new PostgresSolutionExportDownloadRepository(
              authority,
              objectStore,
              authority,
              authority.ownership,
            ).getArtifact({
              ...authority.ownership,
              artifactId: input.previous.artifactId,
            });
            if (
              stored === null ||
              !exportRunEqual(stored.workflowPackage, input.previous)
            )
              exportRunUnavailable();
            return stored.verifiedArtifact;
          },
        });
        const result = await worker.processEnvelope(envelope);
        // Failed audit projection keeps the FIFO delivery for durable recovery.
        await observeSolutionExportStage(
          diagnostics,
          "audit",
          envelope.jobId,
          () => audit.flush(),
        );
        return result;
      },
    },
  });
}
let handler: ReturnType<typeof createWorker> | undefined;
/** Thin Lambda entry; disabled creation still permits cancellation and recovery. */
export async function solutionExportWorkerHandler(event: unknown) {
  handler ??= observeSolutionExportStage(
    diagnostics,
    "initialize",
    undefined,
    () => createWorker(process.env),
  ).catch((error: unknown) => {
    handler = undefined;
    throw error;
  });
  return (await handler)(event);
}
