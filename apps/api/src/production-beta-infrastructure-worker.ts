import { createProductionCleanupHistory } from "./production-cleanup-history.js";
import { S3Client } from "@aws-sdk/client-s3";
import { createBetaInfrastructureModel } from "@cloudmarkup/model-gateway";
import { createBetaInfrastructureApplication } from "./application/beta-infrastructure.js";
import { createBetaInfrastructureWorker } from "./beta-infrastructure-worker.js";
import { createProductionDatabase } from "./production-database.js";
import { createProductionCleanupIncarnation } from "./production-cleanup-incarnation.js";
import { S3ObjectStore } from "./adapters/persistence/s3-object-store.js";
import { createProjectWriteFencedObjectStore } from "./adapters/persistence/project-content-write-fence.js";
import { SqsJobPublisherV1 } from "./adapters/sqs-job-publisher.js";
import { betaProposalQueueTarget } from "./production-beta-proposals.js";
import { z } from "zod";
import { betaProposalCommandPreparerV1 } from "./application/beta-proposal-command-preparer.js";

const eventSchema = z.object({
  Records: z
    .array(
      z.object({
        messageId: z.string().min(1).max(128),
        eventSource: z.literal("aws:sqs"),
        eventSourceARN: z.string(),
        body: z.string().max(65536),
      }),
    )
    .min(1)
    .max(1),
});
let worker: ReturnType<typeof createBetaInfrastructureWorker> | undefined;
export async function handler(event: unknown) {
  const records = eventSchema.parse(event).Records;
  const target = betaProposalQueueTarget(process.env);
  if (!target || records.some((r) => r.eventSourceARN !== target.queueArn))
    throw new Error("Invalid proposal delivery source.");
  if (!worker) {
    const required = (key: string) => {
      const value = process.env[key];
      if (!value)
        throw new Error("Proposal worker configuration is unavailable.");
      return value;
    };
    const database = createProductionDatabase(
      {
        database: required("CLOUDMARKUP_DATABASE_NAME"),
        resourceArn: required("CLOUDMARKUP_DATABASE_ARN"),
        secretArn: required("CLOUDMARKUP_DATABASE_SECRET_ARN"),
      },
      process.env,
      "proposal",
      createProductionCleanupIncarnation(process.env),
    );
    const history = createProductionCleanupHistory(process.env);
    const objectStore = createProjectWriteFencedObjectStore({
      database,
      storageNamespace: "documents",
      ...(history === undefined ? {} : { history }),
      delegate: new S3ObjectStore({
        requireDefinitiveStage: history !== undefined,
        bucket: required("CLOUDMARKUP_CONTENT_BUCKET"),
        keyPrefix: required("CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX"),
        client: new S3Client({
          region: target.region,
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
    worker = createBetaInfrastructureWorker({
      database,
      objectStore,
      onFailure: (diagnostic) => {
        console.error(
          JSON.stringify({ event: "beta-proposal-failed", ...diagnostic }),
        );
      },
      proposals: createBetaInfrastructureApplication({
        applicability: { preparer: betaProposalCommandPreparerV1 },
        model: createBetaInfrastructureModel({
          onFailure: (reason, diagnostic) => {
            console.error(
              JSON.stringify({
                event: "beta-proposal-model-failed",
                reason,
                ...(diagnostic ?? {}),
              }),
            );
          },
        }),
      }),
      publisher: (ownership) =>
        new SqsJobPublisherV1({
          target,
          ownership,
          family: "architecture-proposal",
        }),
    });
  }
  const failures: { itemIdentifier: string }[] = [];
  for (const record of records) {
    try {
      if ((await worker.process(JSON.parse(record.body))) !== "completed")
        failures.push({ itemIdentifier: record.messageId });
    } catch {
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}
