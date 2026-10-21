import { createProductionCleanupHistory } from "./production-cleanup-history.js";
import { confirmCleanupHistory } from "./application/project-cleanup-history.js";
import { optionalProductionDeletionRecovery } from "./production-deletion-recovery.js";
import { randomBytes } from "node:crypto";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { z } from "zod";
import {
  createCleanupWakeDispatcher,
  createCleanupWakeNotifier,
  createCleanupWakeProcessor,
  createAdmissionCleanupWakeAuthority,
  type CleanupWakeLedger,
  type CleanupWakePublisher,
  type CleanupWakeAdmissionPorts,
} from "./application/project-cleanup-wake.js";
import type { ProjectRecord } from "./application/persistence.js";
import { createProjectContentCleanup } from "./adapters/persistence/project-content-cleanup.js";
import { createProductionDatabase } from "./production-database.js";
import { createProductionCleanupIncarnation } from "./production-cleanup-incarnation.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import {
  assertCleanupSchema,
  CLEANUP_ADMISSION_SCHEMA,
} from "./production-cleanup-schema.js";
import { PostgresCleanupAdmissionJournal } from "./adapters/persistence/project-cleanup-admission.js";
import { readProjectCleanupEnvironment } from "./production-project-content-cleanup.js";

function invalid(): never {
  throw new Error("The cleanup wake host configuration is invalid.");
}
export function readCleanupWakeEnvironment(environment: NodeJS.ProcessEnv) {
  const flag = environment["CLOUDMARKUP_CLEANUP_WAKE_ENABLED"];
  if (flag === undefined || flag === "false") return undefined;
  if (flag !== "true") invalid();
  const cleanup = readProjectCleanupEnvironment(environment);
  if (!cleanup.enabled) invalid();
  const table = "cloudmarkup-beta-cleanup-wakes";
  const queueUrl = `https://sqs.${cleanup.region}.amazonaws.com/${cleanup.account}/${table}`;
  const queueArn = `arn:aws:sqs:${cleanup.region}:${cleanup.account}:${table}`;
  const scheduleArn = `arn:aws:events:${cleanup.region}:${cleanup.account}:rule/cloudmarkup-beta-cleanup-wake-dispatch`;
  const streamArn = environment["CLOUDMARKUP_CLEANUP_WAKE_STREAM_ARN"];
  if (
    environment["CLOUDMARKUP_CLEANUP_WAKE_TABLE"] !== table ||
    environment["CLOUDMARKUP_CLEANUP_WAKE_QUEUE_URL"] !== queueUrl ||
    environment["CLOUDMARKUP_CLEANUP_WAKE_SCHEDULE_ARN"] !== scheduleArn ||
    typeof streamArn !== "string" ||
    !streamArn.startsWith(
      `arn:aws:dynamodb:${cleanup.region}:${cleanup.account}:table/${table}/stream/`,
    ) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/u.test(
      streamArn.split("/stream/")[1] ?? "",
    )
  )
    invalid();
  return { ...cleanup, table, queueUrl, queueArn, scheduleArn, streamArn };
}
type Configuration = NonNullable<ReturnType<typeof readCleanupWakeEnvironment>>;
export async function createCleanupWakePorts(
  configuration: Configuration,
): Promise<{ ledger: CleanupWakeLedger; publisher: CleanupWakePublisher }> {
  const [{ DynamoDBClient }, { DynamoDbCleanupWakeLedger }] = await Promise.all(
    [
      import("@aws-sdk/client-dynamodb"),
      import("./adapters/persistence/dynamodb-cleanup-wake-ledger.js"),
    ],
  );
  const requestHandler = { connectionTimeout: 2_000, requestTimeout: 5_000 };
  const ledger = new DynamoDbCleanupWakeLedger({
    table: configuration.table,
    client: new DynamoDBClient({
      region: configuration.region,
      maxAttempts: 1,
      requestHandler,
    }),
  });
  const client = new SQSClient({
    region: configuration.region,
    maxAttempts: 1,
    requestHandler,
  });
  return {
    ledger,
    publisher: {
      async send(wakeId) {
        if (!/^[a-f0-9]{64}$/u.test(wakeId)) invalid();
        const result = await client.send(
          new SendMessageCommand({
            QueueUrl: configuration.queueUrl,
            MessageBody: JSON.stringify({ schemaVersion: 1, wakeId }),
          }),
        );
        if (
          typeof result.MessageId !== "string" ||
          result.MessageId.length === 0
        )
          invalid();
      },
    },
  };
}
export function optionalCleanupWakeObserver(
  environment: NodeJS.ProcessEnv,
): ((project: ProjectRecord) => Promise<void>) | undefined {
  const configuration = readCleanupWakeEnvironment(environment);
  if (configuration === undefined) return undefined;
  let ports: ReturnType<typeof createCleanupWakePorts> | undefined;
  return async (project) => {
    ports ??= createCleanupWakePorts(configuration);
    try {
      await createCleanupWakeNotifier({ enabled: true, ...(await ports) })(
        project,
      );
    } catch (error) {
      ports = undefined;
      throw error;
    }
  };
}
/** Production wiring is false/absent by default. Opt-in verifies the exact
 * registered source schema before accepting ledger or queue work. */
export function optionalCleanupWakeAdmission(
  environment: NodeJS.ProcessEnv,
  database: SqlDatabase,
): CleanupWakeAdmissionPorts | undefined {
  const flag = environment["CLOUDMARKUP_CLEANUP_ADMISSION_ENABLED"];
  if (flag === undefined || flag === "false") return undefined;
  if (flag !== "true") invalid();
  const configuration = readCleanupWakeEnvironment(environment);
  if (configuration === undefined) invalid();
  const schema = CLEANUP_ADMISSION_SCHEMA;
  const history = createProductionCleanupHistory(environment);
  if (history === undefined) invalid();
  let ports: ReturnType<typeof createCleanupWakePorts> | undefined;
  const read = async () => {
    await assertCleanupSchema(database, schema);
    ports ??= createCleanupWakePorts(configuration);
    try {
      return await ports;
    } catch (error) {
      ports = undefined;
      throw error;
    }
  };
  return {
    ledger: {
      put: async (wake) => (await read()).ledger.put(wake),
      get: async (id) => (await read()).ledger.get(id),
    },
    publisher: { send: async (id) => (await read()).publisher.send(id) },
    history,
  };
}
const queueRecord = z
  .object({
    messageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
    eventSource: z.literal("aws:sqs"),
    eventSourceARN: z.string(),
    awsRegion: z.string(),
    body: z.string().max(160),
  })
  .loose();
const body = z
  .object({
    schemaVersion: z.literal(1),
    wakeId: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export function createCleanupWakeQueueHandler(input: {
  readonly configuration: Configuration;
  readonly process: (wakeId: string) => Promise<unknown>;
}) {
  return async (event: unknown) => {
    const batch = z
      .object({ Records: z.array(queueRecord).min(1).max(10) })
      .strict()
      .parse(event);
    const parsed = batch.Records.map((record) => {
      if (
        record.eventSourceARN !== input.configuration.queueArn ||
        record.awsRegion !== input.configuration.region
      )
        invalid();
      return {
        messageId: record.messageId,
        wakeId: body.parse(JSON.parse(record.body) as unknown).wakeId,
      };
    });
    const failures: { itemIdentifier: string }[] = [];
    for (const record of parsed) {
      try {
        await input.process(record.wakeId);
      } catch {
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}
export function createCleanupWakeDispatchHandler(input: {
  readonly configuration: Configuration;
  readonly dispatch: () => Promise<unknown>;
}) {
  return async (event: unknown) => {
    if (event === null || typeof event !== "object" || Array.isArray(event))
      invalid();
    const value = event as Record<string, unknown>;
    const scheduled =
      value["source"] === "aws.events" &&
      value["detail-type"] === "Scheduled Event" &&
      value["account"] === input.configuration.account &&
      value["region"] === input.configuration.region &&
      Array.isArray(value["resources"]) &&
      value["resources"].length === 1 &&
      value["resources"][0] === input.configuration.scheduleArn;
    const records = value["Records"];
    const streamed =
      Array.isArray(records) &&
      records.length > 0 &&
      records.length <= 100 &&
      records.every((record: unknown) => {
        if (
          record === null ||
          typeof record !== "object" ||
          Array.isArray(record)
        )
          return false;
        const entry = record as Record<string, unknown>;
        return (
          entry["eventSource"] === "aws:dynamodb" &&
          entry["eventName"] === "INSERT" &&
          entry["eventSourceARN"] === input.configuration.streamArn &&
          entry["awsRegion"] === input.configuration.region
        );
      });
    if (!scheduled && !streamed) invalid();
    return input.dispatch(); // Events are hints; authority is strongly read from the ledger and SQL.
  };
}
let dispatchHost:
  ReturnType<typeof createCleanupWakeDispatchHandler> | undefined;
export async function dispatchHandler(event: unknown) {
  const configuration = readCleanupWakeEnvironment(process.env);
  if (configuration === undefined) return { enabled: false };
  dispatchHost ??= createCleanupWakeDispatchHandler({
    configuration,
    dispatch: createCleanupWakeDispatcher({
      enabled: true,
      ...(await createCleanupWakePorts(configuration)),
    }),
  });
  return dispatchHost(event);
}
let queueHost: ReturnType<typeof createCleanupWakeQueueHandler> | undefined;
export async function workerHandler(event: unknown) {
  const configuration = readCleanupWakeEnvironment(process.env);
  if (configuration === undefined) invalid(); // Never acknowledge queued wakes while disabled.
  if (queueHost === undefined) {
    const adapters = await createCleanupWakePorts(configuration);
    const requestHandler = { connectionTimeout: 5_000, requestTimeout: 20_000 };
    const database = createProductionDatabase(
      {
        database: "cloudmarkup",
        resourceArn: configuration.databaseArn,
        secretArn: configuration.databaseSecretArn,
        client: new RDSDataClient({ maxAttempts: 1, requestHandler }),
      },
      process.env,
      "cleanup-wake",
      createProductionCleanupIncarnation(process.env),
    );
    const deletionRecovery = optionalProductionDeletionRecovery(
      process.env,
      database,
      {
        bucket: configuration.bucket,
        client: new S3Client({ maxAttempts: 1, requestHandler }),
      },
    );
    const cleanup = createProjectContentCleanup({
      ...(deletionRecovery === undefined ? {} : { deletionRecovery }),
      database,
      client: new S3Client({ maxAttempts: 1, requestHandler }),
      bucket: configuration.bucket,
      expectedBucketOwner: configuration.account,
      prefixes: {
        documents: "documents/v1/organizations/",
        artifacts: "artifacts/v1/organizations/",
        evidence: "evidence/v1/organizations/",
      },
    });
    const assertSchema = () => assertCleanupSchema(database);
    const inspect = async (wake: Parameters<typeof cleanup.inspectWake>[0]) => {
      await assertSchema();
      return cleanup.inspectWake(wake);
    };
    queueHost = createCleanupWakeQueueHandler({
      configuration,
      process: createCleanupWakeProcessor({
        enabled: true,
        ledger: adapters.ledger,
        authority: createAdmissionCleanupWakeAuthority({
          resolve: async (wake) => {
            await assertSchema();
            const journal = new PostgresCleanupAdmissionJournal(database),
              history = createProductionCleanupHistory(process.env);
            const state = await journal.resolve(wake);
            if (
              history !== undefined &&
              (state === "committed" || state === "aborted")
            ) {
              const envelope = await journal.envelope(wake);
              await history.transition(envelope, "prepared", state);
              await confirmCleanupHistory({ history, envelope, state });
            }
            return state;
          },
          cleanup: {
            inspect,
            process: (wake) =>
              cleanup.process({
                organizationId: wake.organizationId,
                projectId: wake.projectId,
                deletionBinding: wake,
              }),
          },
        }),
        clock: Date.now,
        token: () => randomBytes(16).toString("hex"),
      }),
    });
  }
  return queueHost(event);
}
