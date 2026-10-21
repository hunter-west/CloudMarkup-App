import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDbCleanupHistory } from "./adapters/persistence/dynamodb-cleanup-history.js";
/** Defaults off. Full history mode is an inseparable admission/recovery profile;
 * values come from reviewed deployment outputs, never an HTTP request. */
export function readProductionCleanupHistory(environment: NodeJS.ProcessEnv) {
  const flag = environment["CLOUDMARKUP_CLEANUP_HISTORY_ENABLED"];
  if (flag === undefined || flag === "false") return undefined;
  const region = environment["AWS_REGION"],
    account = environment["CLOUDMARKUP_ACCOUNT_ID"],
    tableId = environment["CLOUDMARKUP_CLEANUP_HISTORY_TABLE_ID"],
    resourceId = environment["CLOUDMARKUP_CLEANUP_DATABASE_RESOURCE_ID"];
  if (
    flag !== "true" ||
    environment["CLOUDMARKUP_ENVIRONMENT"] !== "beta" ||
    environment["CLOUDMARKUP_CLEANUP_WAKE_ENABLED"] !== "true" ||
    environment["CLOUDMARKUP_CLEANUP_ADMISSION_ENABLED"] !== "true" ||
    environment["CLOUDMARKUP_DELETION_RECOVERY_ENABLED"] !== "true" ||
    typeof region !== "string" ||
    !/^[a-z]{2}-[a-z]+-\d$/u.test(region) ||
    typeof account !== "string" ||
    !/^\d{12}$/u.test(account) ||
    typeof tableId !== "string" ||
    !/^[a-f0-9-]{36}$/u.test(tableId) ||
    typeof resourceId !== "string" ||
    !/^cluster-[A-Za-z0-9]{16,64}$/u.test(resourceId) ||
    environment["CLOUDMARKUP_DATABASE_ARN"] !==
      `arn:aws:rds:${region}:${account}:cluster:cloudmarkup-beta-postgresql` ||
    environment["CLOUDMARKUP_CLEANUP_WAKE_TABLE"] !==
      "cloudmarkup-beta-cleanup-wakes"
  )
    throw Error("Cleanup history activation configuration is invalid.");
  return {
    region,
    account,
    table: "cloudmarkup-beta-cleanup-wakes",
    tableId,
    resourceId,
  };
}
export function createProductionCleanupHistory(environment: NodeJS.ProcessEnv) {
  const configuration = readProductionCleanupHistory(environment);
  if (configuration === undefined) return undefined;
  return new DynamoDbCleanupHistory({
    table: configuration.table,
    expectedTableId: configuration.tableId,
    client: new DynamoDBClient({
      region: configuration.region,
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
    }),
  });
}
