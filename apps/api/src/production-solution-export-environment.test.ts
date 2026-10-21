import { describe, expect, it } from "vitest";
import {
  PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH,
  PRODUCTION_SOLUTION_EXPORT_ICON_BUNDLE_PATH,
  PRODUCTION_SOLUTION_EXPORT_PROFILE,
  readProductionSolutionExportEnvironment,
} from "./production-solution-export-environment.js";

const region = "us-east-1";
const account = "123456789012";
function environment(): NodeJS.ProcessEnv {
  return {
    AWS_REGION: region,
    CLOUDMARKUP_ENVIRONMENT: "beta",
    CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
    CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED: "true",
    CLOUDMARKUP_SOLUTION_EXPORT_PROFILE: PRODUCTION_SOLUTION_EXPORT_PROFILE,
    CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_ARN:
      "arn:aws:sqs:" +
      region +
      ":" +
      account +
      ":cloudmarkup-beta-solution-exports.fifo",
    CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_URL:
      "https://sqs." +
      region +
      ".amazonaws.com/" +
      account +
      "/cloudmarkup-beta-solution-exports.fifo",
    CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_PATH:
      PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH,
    CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_SHA256: "a".repeat(64),
    CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_PATH:
      PRODUCTION_SOLUTION_EXPORT_ICON_BUNDLE_PATH,
    CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_SHA256: "b".repeat(64),
    CLOUDMARKUP_SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST:
      "sha256:" + "c".repeat(64),
    CLOUDMARKUP_DATABASE_ARN:
      "arn:aws:rds:" + region + ":" + account + ":cluster:synthetic",
    CLOUDMARKUP_DATABASE_SECRET_ARN:
      "arn:aws:secretsmanager:" + region + ":" + account + ":secret:synthetic",
    CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
    CLOUDMARKUP_CONTENT_BUCKET: "cloudmarkup-beta-synthetic-content",
    CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX: "documents/v1/organizations/",
  };
}

describe("restricted production export configuration", () => {
  it("defaults to unavailable without a configured host", () => {
    expect(readProductionSolutionExportEnvironment({})).toBeUndefined();
    expect(
      readProductionSolutionExportEnvironment({
        CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED: "false",
      }),
    ).toBeUndefined();
  });
  it("binds the exact FIFO destination, release files and database account", () => {
    const input = environment();
    const result = readProductionSolutionExportEnvironment(input);
    expect(result).toMatchObject({
      enabled: true,
      profile: PRODUCTION_SOLUTION_EXPORT_PROFILE,
      accountId: account,
      queue: {
        region,
        queueArn: input["CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_ARN"],
      },
      compiler: {
        executablePath: PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH,
        executableSha256: "a".repeat(64),
      },
      targetSettingsDigest: "sha256:" + "c".repeat(64),
    });
    input["CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_ARN"] = "changed";
    expect(result?.queue.queueArn).not.toBe("changed");
    expect(Object.isFrozen(result?.queue)).toBe(true);
  });
  it("retains configured cancellation and recovery bindings when creation is disabled", () => {
    const input = environment();
    input["CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED"] = "false";
    expect(readProductionSolutionExportEnvironment(input)?.enabled).toBe(false);
  });
  it.each([
    ["CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED", "yes"],
    ["CLOUDMARKUP_SOLUTION_EXPORT_PROFILE", "full"],
    ["CLOUDMARKUP_ENVIRONMENT", "prod"],
    ["CLOUDMARKUP_EXPECTED_SCHEMA_VERSION", "0054"],
    ["CLOUDMARKUP_EXPECTED_SCHEMA_VERSION", "0055"],
    ["CLOUDMARKUP_EXPECTED_SCHEMA_VERSION", "0056"],
    ["CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX", "documents"],
    ["AWS_REGION", "us-west-2"],
    [
      "CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_ARN",
      "arn:aws:sqs:us-east-1:123456789012:cloudmarkup-beta-job",
    ],
    [
      "CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_URL",
      "https://sqs.us-east-1.amazonaws.com/999999999999/cloudmarkup-beta-solution-exports.fifo",
    ],
    ["CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_URL", "http://localhost/queue"],
    [
      "CLOUDMARKUP_DATABASE_ARN",
      "arn:aws:rds:us-east-1:999999999999:cluster:synthetic",
    ],
    [
      "CLOUDMARKUP_DATABASE_SECRET_ARN",
      "arn:aws:secretsmanager:us-west-2:123456789012:secret:synthetic",
    ],
    ["CLOUDMARKUP_DATABASE_NAME", "cloudmarkup; SELECT 1"],
    ["CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_PATH", "/tmp/customer-program"],
    ["CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_SHA256", "A".repeat(64)],
    [
      "CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_PATH",
      "/tmp/customer-icons.json",
    ],
    ["CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_SHA256", "missing"],
    ["CLOUDMARKUP_SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST", "c".repeat(64)],
    ["CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX", "../documents"],
  ])("rejects mismatched %s", (name, value) => {
    expect(() =>
      readProductionSolutionExportEnvironment({
        ...environment(),
        [name]: value,
      }),
    ).toThrow("configuration is unavailable");
  });
  it("rejects partial configuration and missing enablement instead of guessing", () => {
    for (const name of Object.keys(environment())) {
      const input = environment();
      Reflect.deleteProperty(input, name);
      expect(() => readProductionSolutionExportEnvironment(input)).toThrow(
        "configuration is unavailable",
      );
    }
  });
});
