import { optionalProductionDeletionRecovery } from "./production-deletion-recovery.js";
import { S3Client } from "@aws-sdk/client-s3";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { createProjectContentCleanup } from "./adapters/persistence/project-content-cleanup.js";
import { createProductionDatabase } from "./production-database.js";
import { createProductionCleanupIncarnation } from "./production-cleanup-incarnation.js";
import {
  PROJECT_CLEANUP_SCHEMA,
  assertCleanupSchema,
} from "./production-cleanup-schema.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import {
  createCleanupWakePorts,
  readCleanupWakeEnvironment,
} from "./production-project-cleanup-wake.js";

function invalid(): never {
  throw new Error("The project cleanup host configuration is invalid.");
}
function required(environment: NodeJS.ProcessEnv, key: string) {
  const value = environment[key]?.trim();
  if (value === undefined || value === "" || value !== environment[key])
    invalid();
  return value;
}
export function readProjectCleanupEnvironment(environment: NodeJS.ProcessEnv) {
  if (
    required(environment, "CLOUDMARKUP_ENVIRONMENT") !== "beta" ||
    required(environment, "CLOUDMARKUP_EXPECTED_SCHEMA_VERSION") !==
      PROJECT_CLEANUP_SCHEMA.version
  )
    invalid();
  const account = required(environment, "CLOUDMARKUP_ACCOUNT_ID");
  const region = required(environment, "AWS_REGION");
  if (!/^\d{12}$/u.test(account) || !/^[a-z]{2}-[a-z]+-\d$/u.test(region))
    invalid();
  const databaseArn = required(environment, "CLOUDMARKUP_DATABASE_ARN");
  const databaseSecretArn = required(
    environment,
    "CLOUDMARKUP_DATABASE_SECRET_ARN",
  );
  if (
    databaseArn !==
      "arn:aws:rds:" +
        region +
        ":" +
        account +
        ":cluster:cloudmarkup-beta-postgresql" ||
    !databaseSecretArn.startsWith(
      "arn:aws:secretsmanager:" +
        region +
        ":" +
        account +
        ":secret:cloudmarkup-beta/database/admin-",
    )
  )
    invalid();
  const bucket = required(environment, "CLOUDMARKUP_CONTENT_BUCKET");
  if (bucket !== "cloudmarkup-beta-" + account + "-" + region + "-content")
    invalid();
  const scheduleArn =
    "arn:aws:events:" +
    region +
    ":" +
    account +
    ":rule/cloudmarkup-beta-project-content-cleanup";
  if (
    required(environment, "CLOUDMARKUP_CLEANUP_SCHEDULE_ARN") !== scheduleArn ||
    required(environment, "CLOUDMARKUP_DATABASE_NAME") !== "cloudmarkup"
  )
    invalid();
  const enabled = required(environment, "CLOUDMARKUP_PROJECT_CLEANUP_ENABLED");
  if (enabled !== "true" && enabled !== "false") invalid();
  return {
    account,
    region,
    databaseArn,
    databaseSecretArn,
    bucket,
    scheduleArn,
    enabled: enabled === "true",
  };
}
type Cleanup = Pick<
  ReturnType<typeof createProjectContentCleanup>,
  "listPending" | "process"
>;
export function createProjectCleanupScheduledHandler(input: {
  readonly configuration: ReturnType<typeof readProjectCleanupEnvironment>;
  readonly database: SqlDatabase;
  readonly cleanup: Cleanup;
  readonly mirrorPending?: (candidate: {
    readonly organizationId: string;
    readonly projectId: string;
  }) => Promise<void>;
}) {
  const { configuration, database, cleanup } = input;
  return async (event: unknown) => {
    if (!configuration.enabled) return { enabled: false as const };
    if (event === null || typeof event !== "object" || Array.isArray(event))
      invalid();
    const value = event as Record<string, unknown>;
    if (
      value["source"] !== "aws.events" ||
      value["detail-type"] !== "Scheduled Event" ||
      value["account"] !== configuration.account ||
      value["region"] !== configuration.region ||
      !Array.isArray(value["resources"]) ||
      value["resources"].length !== 1 ||
      value["resources"][0] !== configuration.scheduleArn
    )
      invalid();
    await assertCleanupSchema(database);
    // One project per invocation bounds storage/API work; SQL rotates attempts
    // so a blocked or failing project does not starve later deletion requests.
    const candidates = await cleanup.listPending(1);
    let completed = 0,
      pending = 0;
    for (const candidate of candidates) {
      try {
        await input.mirrorPending?.(candidate);
      } catch {
        // Shadow publication never prevents the current canonical SQL recovery.
        console.warn(
          JSON.stringify({
            component: "project-cleanup-wake",
            outcome: "mirror-unavailable",
          }),
        );
      }
      const result = await cleanup.process(candidate);
      if (result.state === "completed") completed += 1;
      else pending += 1;
    }
    return {
      enabled: true as const,
      considered: candidates.length,
      completed,
      pending,
    };
  };
}

let scheduled:
  ReturnType<typeof createProjectCleanupScheduledHandler> | undefined;
/** Dedicated Lambda entry. No customer payload supplies a tenant, key or delete
 * command. The owner-authorized host uses the reviewed role, current schema
 * and durable writer fence before completing an existing deletion request. */
export async function handler(event: unknown) {
  if (scheduled === undefined) {
    const configuration = readProjectCleanupEnvironment(process.env);
    const requestHandler = { connectionTimeout: 5000, requestTimeout: 20000 };
    const database = createProductionDatabase(
      {
        database: "cloudmarkup",
        resourceArn: configuration.databaseArn,
        secretArn: configuration.databaseSecretArn,
        client: new RDSDataClient({ maxAttempts: 1, requestHandler }),
      },
      process.env,
      "cleanup",
      createProductionCleanupIncarnation(process.env),
    );
    const client = new S3Client({ maxAttempts: 1, requestHandler });
    const deletionRecovery = optionalProductionDeletionRecovery(
      process.env,
      database,
      { bucket: configuration.bucket, client },
    );
    const cleanup = createProjectContentCleanup({
      ...(deletionRecovery === undefined ? {} : { deletionRecovery }),
      database,
      client,
      bucket: configuration.bucket,
      expectedBucketOwner: configuration.account,
      // Match the current production S3ObjectStore prefixes exactly,
      // including its existing outer storage namespace.
      prefixes: {
        documents: "documents/v1/organizations/",
        artifacts: "artifacts/v1/organizations/",
        evidence: "evidence/v1/organizations/",
      },
    });
    const wakeConfiguration = readCleanupWakeEnvironment(process.env);
    const ports =
      wakeConfiguration === undefined
        ? undefined
        : () => createCleanupWakePorts(wakeConfiguration);
    scheduled = createProjectCleanupScheduledHandler({
      configuration,
      database,
      cleanup,
      ...(ports === undefined
        ? {}
        : {
            mirrorPending: async (candidate: {
              organizationId: string;
              projectId: string;
            }) => {
              const wake = await cleanup.wakeBinding(candidate);
              if (wake === null) return;
              const adapters = await ports();
              await adapters.ledger.put(wake);
              await adapters.publisher.send(wake.wakeId);
            },
          }),
    });
  }
  return scheduled(event);
}
