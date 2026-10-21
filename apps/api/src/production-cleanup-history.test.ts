import { describe, expect, it } from "vitest";
import { readProductionCleanupHistory } from "./production-cleanup-history.js";
import { createProductionDatabase } from "./production-database.js";
const arn =
  "arn:aws:rds:us-east-1:123456789012:cluster:cloudmarkup-beta-postgresql";
const environment: NodeJS.ProcessEnv = {
  CLOUDMARKUP_ENVIRONMENT: "beta",
  AWS_REGION: "us-east-1",
  CLOUDMARKUP_ACCOUNT_ID: "123456789012",
  CLOUDMARKUP_CLEANUP_WAKE_ENABLED: "true",
  CLOUDMARKUP_CLEANUP_ADMISSION_ENABLED: "true",
  CLOUDMARKUP_DELETION_RECOVERY_ENABLED: "true",
  CLOUDMARKUP_CLEANUP_HISTORY_ENABLED: "true",
  CLOUDMARKUP_CLEANUP_HISTORY_TABLE_ID: "12345678-1234-1234-1234-123456789012",
  CLOUDMARKUP_CLEANUP_DATABASE_RESOURCE_ID: "cluster-ABCDEFGHIJKLMNOPQRSTUVWX",
  CLOUDMARKUP_DATABASE_ARN: arn,
  CLOUDMARKUP_CLEANUP_WAKE_TABLE: "cloudmarkup-beta-cleanup-wakes",
};
describe("production retained history profile", () => {
  it.each([undefined, "false"])("defaults remain disabled for %s", (flag) => {
    expect(
      readProductionCleanupHistory({
        CLOUDMARKUP_CLEANUP_HISTORY_ENABLED: flag,
      }),
    ).toBeUndefined();
  });
  it("accepts only the complete reviewed beta profile", () => {
    expect(readProductionCleanupHistory(environment)).toMatchObject({
      resourceId: environment["CLOUDMARKUP_CLEANUP_DATABASE_RESOURCE_ID"],
      table: "cloudmarkup-beta-cleanup-wakes",
    });
  });
  it.each([
    "CLOUDMARKUP_CLEANUP_WAKE_ENABLED",
    "CLOUDMARKUP_CLEANUP_ADMISSION_ENABLED",
    "CLOUDMARKUP_DELETION_RECOVERY_ENABLED",
    "CLOUDMARKUP_CLEANUP_HISTORY_TABLE_ID",
    "CLOUDMARKUP_CLEANUP_DATABASE_RESOURCE_ID",
    "CLOUDMARKUP_DATABASE_ARN",
  ])("rejects incomplete coupled profile %s", (key) => {
    expect(() =>
      readProductionCleanupHistory({ ...environment, [key]: undefined }),
    ).toThrow();
  });
  it.each(["api"] as const)(
    "%s cannot accept environment pins as authenticated identity",
    (host) => {
      expect(() =>
        createProductionDatabase(
          {
            database: "cloudmarkup",
            resourceArn: arn,
            secretArn:
              "arn:aws:secretsmanager:us-east-1:123456789012:secret:cloudmarkup-beta/database/admin-test",
          },
          environment,
          host,
        ),
      ).toThrow(/fresh authenticated/);
    },
  );
});
