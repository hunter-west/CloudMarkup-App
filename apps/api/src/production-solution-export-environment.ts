export const PRODUCTION_SOLUTION_EXPORT_PROFILE =
  "cloudformation-infrastructure-only-v1" as const;
export const PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH =
  "/opt/cloudmarkup-export/cloudmarkup-iac" as const;
export const PRODUCTION_SOLUTION_EXPORT_ICON_BUNDLE_PATH =
  "/opt/cloudmarkup-export/diagram-icons.json" as const;

export interface ProductionSolutionExportEnvironment {
  readonly enabled: boolean;
  readonly profile: typeof PRODUCTION_SOLUTION_EXPORT_PROFILE;
  readonly queue: {
    readonly queueArn: string;
    readonly queueUrl: string;
    readonly region: string;
  };
  readonly accountId: string;
  readonly databaseArn: string;
  readonly databaseName: string;
  readonly databaseSecretArn: string;
  readonly contentBucket: string;
  readonly documentPrefix: string;
  readonly compiler: {
    readonly executablePath: string;
    readonly executableSha256: string;
  };
  readonly iconBundlePath: string;
  readonly iconBundleSha256: string;
  readonly targetSettingsDigest: string;
}

const prefix = "CLOUDMARKUP_SOLUTION_EXPORT_";
const configurationNames = [
  "PROFILE",
  "QUEUE_ARN",
  "QUEUE_URL",
  "COMPILER_PATH",
  "COMPILER_SHA256",
  "ICON_BUNDLE_PATH",
  "ICON_BUNDLE_SHA256",
  "TARGET_SETTINGS_DIGEST",
] as const;
function unavailable(): never {
  throw new Error(
    "The hosted CloudFormation export configuration is unavailable.",
  );
}
function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0 || value !== value.trim())
    return unavailable();
  return value;
}
function digest(environment: NodeJS.ProcessEnv, name: string): string {
  const value = required(environment, prefix + name);
  if (!/^[a-f0-9]{64}$/u.test(value)) return unavailable();
  return value;
}

/** Configuration grants no tenant authority. A configured but disabled host
 * remains available for cancellation and durable terminal recovery. */
export function readProductionSolutionExportEnvironment(
  environment: NodeJS.ProcessEnv,
): ProductionSolutionExportEnvironment | undefined {
  const flag = environment["CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED"];
  if (flag !== undefined && flag !== "true" && flag !== "false")
    return unavailable();
  const configured = configurationNames.some(
    (name) => environment[prefix + name] !== undefined,
  );
  if (flag !== "true" && !configured) return undefined;
  if (flag === undefined) return unavailable();
  if (
    environment["CLOUDMARKUP_ENVIRONMENT"] !== "beta" ||
    environment["CLOUDMARKUP_EXPECTED_SCHEMA_VERSION"] !== "0138" ||
    required(environment, prefix + "PROFILE") !==
      PRODUCTION_SOLUTION_EXPORT_PROFILE ||
    required(environment, prefix + "COMPILER_PATH") !==
      PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH ||
    required(environment, prefix + "ICON_BUNDLE_PATH") !==
      PRODUCTION_SOLUTION_EXPORT_ICON_BUNDLE_PATH
  )
    return unavailable();
  const queueArn = required(environment, prefix + "QUEUE_ARN");
  const match =
    /^arn:aws:sqs:([a-z]{2}(?:-[a-z]+)+-[1-9][0-9]*):([0-9]{12}):cloudmarkup-beta-solution-exports\.fifo$/u.exec(
      queueArn,
    );
  const region = match?.[1];
  const accountId = match?.[2];
  if (region === undefined || accountId === undefined) return unavailable();
  const queueUrl = required(environment, prefix + "QUEUE_URL");
  if (
    queueUrl !==
      "https://sqs." +
        region +
        ".amazonaws.com/" +
        accountId +
        "/cloudmarkup-beta-solution-exports.fifo" ||
    environment["AWS_REGION"] !== region
  )
    return unavailable();
  const databaseArn = required(environment, "CLOUDMARKUP_DATABASE_ARN");
  const databaseSecretArn = required(
    environment,
    "CLOUDMARKUP_DATABASE_SECRET_ARN",
  );
  const databaseName = required(environment, "CLOUDMARKUP_DATABASE_NAME");
  const contentBucket = required(environment, "CLOUDMARKUP_CONTENT_BUCKET");
  const documentPrefix = required(
    environment,
    "CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX",
  );
  const targetSettingsDigest = required(
    environment,
    prefix + "TARGET_SETTINGS_DIGEST",
  );
  if (
    !databaseArn.startsWith(
      "arn:aws:rds:" + region + ":" + accountId + ":cluster:",
    ) ||
    !databaseSecretArn.startsWith(
      "arn:aws:secretsmanager:" + region + ":" + accountId + ":secret:",
    ) ||
    !/^[a-z][a-z0-9_]{0,62}$/u.test(databaseName) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(contentBucket) ||
    contentBucket.includes("..") ||
    documentPrefix !== "documents/v1/organizations/" ||
    !/^sha256:[a-f0-9]{64}$/u.test(targetSettingsDigest)
  )
    return unavailable();
  return Object.freeze({
    enabled: flag === "true",
    profile: PRODUCTION_SOLUTION_EXPORT_PROFILE,
    queue: Object.freeze({ queueArn, queueUrl, region }),
    accountId,
    databaseArn,
    databaseSecretArn,
    databaseName,
    contentBucket,
    documentPrefix,
    compiler: Object.freeze({
      executablePath: PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH,
      executableSha256: digest(environment, "COMPILER_SHA256"),
    }),
    iconBundlePath: PRODUCTION_SOLUTION_EXPORT_ICON_BUNDLE_PATH,
    iconBundleSha256: digest(environment, "ICON_BUNDLE_SHA256"),
    targetSettingsDigest,
  });
}
