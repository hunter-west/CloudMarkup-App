import { CleanupHistoryBoundDatabase } from "./adapters/persistence/project-cleanup-restore-guard.js";
import type { CleanupDatabaseIncarnationPort } from "./adapters/persistence/project-cleanup-incarnation.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import {
  readProductionCleanupHistory,
  createProductionCleanupHistory,
} from "./production-cleanup-history.js";
import {
  assertCleanupSchema,
  CLEANUP_ADMISSION_SCHEMA,
} from "./production-cleanup-schema.js";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import {
  RdsDataApiDatabase,
  type RdsDataApiDatabaseConfig,
  type RdsDataApiResumeRetryPolicy,
} from "./adapters/persistence/rds-data-driver.js";

export type ProductionDatabaseHost =
  "api" | "billing" | "proposal" | "export" | "cleanup" | "cleanup-wake";
const resumeBudgets: Readonly<Record<ProductionDatabaseHost, number>> = {
  api: 20_000,
  billing: 30_000,
  proposal: 45_000,
  export: 45_000,
  cleanup: 45_000,
  "cleanup-wake": 45_000,
};

/** Explicit host preparation only. A confirmed DatabaseResumingException can
 * retry before a transaction exists; driver transaction/ambiguity rules remain
 * authoritative. Native acceptance must establish the host's total budget. */
export function readProductionResumePolicy(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly host: ProductionDatabaseHost;
  readonly database: string;
  readonly resourceArn: string;
}): RdsDataApiResumeRetryPolicy | undefined {
  const flag = input.environment["CLOUDMARKUP_AURORA_RESUME_ENABLED"];
  if (flag === undefined || flag === "false") return undefined;
  if (
    flag !== "true" ||
    input.environment["CLOUDMARKUP_ENVIRONMENT"] !== "beta" ||
    input.database !== "cloudmarkup" ||
    !/^arn:aws:rds:[a-z]{2}-[a-z]+-\d:\d{12}:cluster:cloudmarkup-beta-postgresql$/u.test(
      input.resourceArn,
    )
  )
    throw new Error("The database resume host configuration is invalid.");
  return Object.freeze({
    maxElapsedMilliseconds: resumeBudgets[input.host],
    maxAttempts: 20,
  });
}

/** Absent/false flags retain the original client and driver configuration. */
export function createProductionDatabase(
  configuration: RdsDataApiDatabaseConfig,
  environment: NodeJS.ProcessEnv,
  host: ProductionDatabaseHost,
  incarnation?: CleanupDatabaseIncarnationPort,
): SqlDatabase {
  const resumeRetry = readProductionResumePolicy({
    ...configuration,
    environment,
    host,
  });
  const historyConfiguration = readProductionCleanupHistory(environment);
  if (
    historyConfiguration !== undefined &&
    (incarnation?.expectedArn !== configuration.resourceArn ||
      incarnation.expectedResourceId !== historyConfiguration.resourceId ||
      environment["CLOUDMARKUP_DATABASE_ARN"] !== configuration.resourceArn)
  )
    throw Error(
      "Cleanup history requires a fresh authenticated database-incarnation verifier.",
    );
  const wrap = (database: RdsDataApiDatabase): SqlDatabase => {
    if (historyConfiguration === undefined) return database;
    const history = createProductionCleanupHistory(environment);
    if (history === undefined || incarnation === undefined)
      throw Error("Cleanup restore authority is unavailable.");
    return new CleanupHistoryBoundDatabase({
      database,
      history,
      incarnation,
      assertSchema: (tx) => assertCleanupSchema(tx, CLEANUP_ADMISSION_SCHEMA),
    });
  };
  if (resumeRetry === undefined)
    return wrap(new RdsDataApiDatabase(configuration));
  const region = configuration.resourceArn.split(":")[3];
  if (region === undefined)
    throw new Error("The database resume region is invalid.");
  return wrap(
    new RdsDataApiDatabase({
      ...configuration,
      resumeRetry,
      client:
        configuration.client ??
        new RDSDataClient({
          region,
          maxAttempts: 1,
          requestHandler: {
            connectionTimeout: 5_000,
            requestTimeout: resumeRetry.maxElapsedMilliseconds,
          },
        }),
    }),
  );
}
