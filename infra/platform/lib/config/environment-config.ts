import {
  accountSecurityConfigurationV1Schema,
  type AccountSecurityConfigurationV1,
} from "@cloudmarkup/api/identity";

export const ENVIRONMENT_CONFIG_SCHEMA_VERSION = 1 as const;

export type EnvironmentName = "beta" | "dev" | "prod" | "staging";
export type RemovalPolicyName = "destroy" | "retain";

export interface EnvironmentTarget {
  readonly account: string;
  readonly region: string;
}

export interface DomainConfiguration {
  readonly certificateArn: string;
  readonly createDnsRecords: boolean;
  readonly domainName: string;
  readonly hostedZoneId?: string;
  readonly hostedZoneName?: string;
  readonly wafWebAclArn?: string;
  readonly wafWebAclMetricName?: string;
}

export interface EnvironmentConfig {
  readonly accountSecurity?: AccountSecurityConfigurationV1;
  readonly accountAccess?: {
    readonly schemaVersion: 1;
    readonly managedLogin: boolean;
    readonly registrationEnabled: boolean;
  };
  readonly schemaVersion: typeof ENVIRONMENT_CONFIG_SCHEMA_VERSION;
  readonly environment: EnvironmentName;
  readonly target: EnvironmentTarget;
  readonly domain?: DomainConfiguration;
  readonly lifecycle: {
    readonly deletionProtection: boolean;
    readonly removalPolicy: RemovalPolicyName;
  };
  readonly database: {
    readonly autoPauseMinutes?: number;
    /** Preparation only: absent/false preserves the always-on beta profile. */
    readonly betaAutoPauseEnabled?: boolean;
    readonly backupRetentionDays: number;
    readonly maxCapacityAcu: number;
    readonly minCapacityAcu: number;
  };
  readonly retention: {
    readonly accessLogsDays: number;
    readonly artifactDays: number;
    readonly evidence: "retain";
    readonly logsDays: number;
    readonly noncurrentObjectVersionsDays: number;
  };
  readonly budget: {
    readonly alarmThresholdPercent: number;
    readonly anomalyThresholdUsd: number;
    readonly monthlyLimitUsd: number;
  };
  readonly limits: {
    readonly apiBurst: number;
    readonly apiConcurrency: number;
    readonly apiRate: number;
    readonly apiTimeoutSeconds: number;
    readonly jobMaxReceiveCount: number;
    readonly jobVisibilityTimeoutSeconds: number;
    readonly wafApiRequestsPerFiveMinutes: number;
    readonly wafWebhookRequestsPerFiveMinutes: number;
    readonly workerConcurrency: number;
    readonly workerMemoryMiB: number;
    readonly workerTimeoutSeconds: number;
  };
  readonly features: {
    readonly aiAuthoring: boolean;
    readonly applicationGeneration: boolean;
    readonly betaAccess: boolean;
    readonly billing: boolean;
    readonly githubExport: boolean;
    readonly planDeploymentWorkflowExport: boolean;
    readonly staticValidation: boolean;
    readonly waf: boolean;
  };
  readonly applicationBuild: {
    readonly image: {
      readonly digest: string;
      readonly repository: string;
    };
    readonly limits: {
      readonly concurrentBuilds: number;
      readonly cpuSeconds: number;
      readonly maxArtifactBytes: number;
      readonly maxFileBytes: number;
      readonly maxFiles: number;
      readonly maxMonthlyBuildMinutes: number;
      readonly maxOutputBytes: number;
      readonly maxProcesses: number;
      readonly maxTotalFileBytes: number;
      readonly memoryMiB: number;
      readonly queuedTimeoutMinutes: number;
      readonly timeoutMinutes: number;
      readonly wallTimeMilliseconds: number;
    };
  };
  readonly terraformValidation: {
    readonly image: {
      readonly digest: string;
      readonly repository: string;
    };
    readonly limits: {
      readonly concurrentBuilds: number;
      readonly cpuSeconds: number;
      readonly maxFileBytes: number;
      readonly maxFiles: number;
      readonly maxMonthlyBuildMinutes: number;
      readonly maxOutputBytes: number;
      readonly maxProcesses: number;
      readonly maxTotalFileBytes: number;
      readonly memoryMiB: number;
      readonly queuedTimeoutMinutes: number;
      readonly timeoutMinutes: number;
      readonly wallTimeMilliseconds: number;
    };
  };
  readonly integrations: {
    /** Disabled shadow resources only; never permits idle SQL suppression. */
    readonly projectCleanupWake?: { readonly preparationEnabled: boolean };
    /** Absence preserves the historical disabled runtime profile. */
    readonly solutionExport?: { readonly enabled: boolean };
    readonly bedrock: {
      readonly inferenceProfileArns: readonly string[];
      readonly modelArns: readonly string[];
    };
    readonly github: {
      readonly appId?: string;
      readonly appSlug?: string;
      readonly clientId?: string;
      readonly clientSecretArn?: string;
      readonly clientSecretJsonField?: string;
      readonly connectionsEnabled: boolean;
      readonly privateKeySecretArn?: string;
      readonly privateKeySecretName: string;
      readonly webhookSecretName: string;
    };
    readonly stripe: {
      readonly apiKeySecretArn?: string;
      readonly apiKeySecretName: string;
      readonly cancellationPolicy: "period-end-default";
      readonly cancelUrl: string;
      readonly currency: "USD";
      readonly deliveryEnabled: boolean;
      readonly environment: "test" | "live";
      readonly graceHours: number;
      readonly planMappingVersion: string;
      readonly portalConfigurationId?: string;
      readonly portalReturnUrl: string;
      readonly previousWebhookSigningSecretName?: string;
      readonly previousWebhookSigningSecretArn?: string;
      readonly proCreditUnits: 1000;
      readonly proPriceId?: string;
      readonly proProductId?: string;
      readonly starterCreditUnits: 200;
      readonly sessionsEnabled: boolean;
      readonly starterPriceId?: string;
      readonly starterProductId?: string;
      readonly successUrl: string;
      readonly trialPolicy: "no-trial";
      readonly webhookEndpointVersion: string;
      readonly webhookSigningSecretName: string;
      readonly webhookSigningSecretArn?: string;
    };
  };
  readonly tags: Readonly<Record<string, string>>;
}

const awsAccountPattern = /^\d{12}$/u;
const awsRegionPattern = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u;
const arnPattern =
  /^arn:(aws|aws-us-gov|aws-cn):([a-z0-9-]+):([a-z0-9-]*):(\d{0,12}):([A-Za-z0-9_./:=+@-]+)$/u;
const secretNamePattern =
  /^cloudmarkup\/(beta|dev|staging|prod)\/[a-z0-9][a-z0-9/_-]{1,126}$/u;
const safeIdentifierPattern = /^[A-Za-z0-9_./:+@=-]{1,255}$/u;
const cloudWatchRetentionDays = new Set([
  1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827,
  2192, 2557, 2922, 3288, 3653,
]);
const forbiddenSecretKeyFragments = [
  "accesskey",
  "apikey",
  "authorization",
  "clientsecret",
  "credential",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "secretkey",
  "secretvalue",
  "sessiontoken",
  "token",
] as const;
const forbiddenSecretValuePatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bghp_[A-Za-z0-9]{20,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/u,
  /\bwhsec_[A-Za-z0-9_]{8,}\b/u,
];
const environmentFeatureKeys = [
  "aiAuthoring",
  "applicationGeneration",
  "betaAccess",
  "billing",
  "githubExport",
  "planDeploymentWorkflowExport",
  "staticValidation",
  "waf",
] as const;

interface ParsedArn {
  readonly account: string;
  readonly partition: "aws" | "aws-cn" | "aws-us-gov";
  readonly region: string;
  readonly resource: string;
  readonly service: string;
}

function fail(message: string): never {
  throw new TypeError(
    `Invalid CloudMarkup environment configuration: ${message}`,
  );
}

function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(
      `${label} must be an integer from ${String(minimum)} through ${String(maximum)}.`,
    );
  }
}

function assertPositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${label} must be a positive finite number.`);
  }
}

function parseArn(value: string, service: string, label: string): ParsedArn {
  const match = arnPattern.exec(value);
  if (match?.[2] !== service) {
    fail(`${label} must be a bounded ${service} ARN.`);
  }
  const [, partition, parsedService, region, account, resource] = match;
  if (
    partition === undefined ||
    region === undefined ||
    account === undefined ||
    resource === undefined
  ) {
    fail(`${label} must be a complete ${service} ARN.`);
  }
  return {
    account,
    partition: partition as ParsedArn["partition"],
    region,
    resource,
    service: parsedService,
  };
}

function targetPartition(target: EnvironmentTarget): ParsedArn["partition"] {
  if (target.region.startsWith("us-gov-")) return "aws-us-gov";
  if (target.region.startsWith("cn-")) return "aws-cn";
  return "aws";
}

function expectedApplicationBuildRepository(target: EnvironmentTarget): string {
  const candidate: unknown = target;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("account" in candidate) ||
    typeof candidate.account !== "string" ||
    !("region" in candidate) ||
    typeof candidate.region !== "string"
  ) {
    return "invalid.invalid/cloudmarkup/application-build";
  }
  const dnsSuffix = target.region.startsWith("cn-")
    ? "amazonaws.com.cn"
    : "amazonaws.com";
  return `${target.account}.dkr.ecr.${target.region}.${dnsSuffix}/cloudmarkup/application-build`;
}

function expectedTerraformValidationRepository(
  target: EnvironmentTarget,
): string {
  const candidate: unknown = target;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("account" in candidate) ||
    typeof candidate.account !== "string" ||
    !("region" in candidate) ||
    typeof candidate.region !== "string"
  ) {
    return "invalid.invalid/cloudmarkup/terraform-validation";
  }
  const dnsSuffix = target.region.startsWith("cn-")
    ? "amazonaws.com.cn"
    : "amazonaws.com";
  return `${target.account}.dkr.ecr.${target.region}.${dnsSuffix}/cloudmarkup/terraform-validation`;
}

function validateApplicationBuildConfig(config: EnvironmentConfig): void {
  const build = config.applicationBuild;
  if (
    build.image.repository !== expectedApplicationBuildRepository(config.target)
  ) {
    fail(
      "applicationBuild.image.repository must be the exact target-account and target-Region build repository.",
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(build.image.digest)) {
    fail("applicationBuild.image.digest must be an exact SHA-256 digest.");
  }
  const integerLimits = [
    ["concurrentBuilds", 1, 10],
    ["cpuSeconds", 1, 600],
    ["maxArtifactBytes", 1, 64 * 1024 * 1024],
    ["maxFileBytes", 1, 4 * 1024 * 1024],
    ["maxFiles", 1, 20_000],
    ["maxMonthlyBuildMinutes", 1, 100_000],
    ["maxOutputBytes", 1, 2 * 1024 * 1024],
    ["maxProcesses", 1, 128],
    ["maxTotalFileBytes", 1, 128 * 1024 * 1024],
    ["memoryMiB", 128, 8_192],
    ["queuedTimeoutMinutes", 5, 480],
    ["timeoutMinutes", 5, 480],
    ["wallTimeMilliseconds", 1_000, 900_000],
  ] as const;
  for (const [name, minimum, maximum] of integerLimits) {
    assertIntegerInRange(
      build.limits[name],
      minimum,
      maximum,
      `applicationBuild.limits.${name}`,
    );
  }
  if (
    build.limits.wallTimeMilliseconds >=
    build.limits.timeoutMinutes * 60_000
  ) {
    fail(
      "Application command wall time must remain below the CodeBuild timeout.",
    );
  }
}

function validateTerraformValidationConfig(config: EnvironmentConfig): void {
  const validation = config.terraformValidation;
  if (
    validation.image.repository !==
    expectedTerraformValidationRepository(config.target)
  ) {
    fail(
      "terraformValidation.image.repository must be the exact target-account and target-Region validation repository.",
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(validation.image.digest)) {
    fail("terraformValidation.image.digest must be an exact SHA-256 digest.");
  }
  assertIntegerInRange(
    validation.limits.concurrentBuilds,
    1,
    10,
    "terraformValidation.limits.concurrentBuilds",
  );
  assertIntegerInRange(
    validation.limits.cpuSeconds,
    1,
    120,
    "terraformValidation.limits.cpuSeconds",
  );
  assertIntegerInRange(
    validation.limits.maxFileBytes,
    1,
    4 * 1024 * 1024,
    "terraformValidation.limits.maxFileBytes",
  );
  assertIntegerInRange(
    validation.limits.maxFiles,
    1,
    512,
    "terraformValidation.limits.maxFiles",
  );
  assertIntegerInRange(
    validation.limits.maxMonthlyBuildMinutes,
    1,
    100_000,
    "terraformValidation.limits.maxMonthlyBuildMinutes",
  );
  assertIntegerInRange(
    validation.limits.maxOutputBytes,
    1,
    2 * 1024 * 1024,
    "terraformValidation.limits.maxOutputBytes",
  );
  assertIntegerInRange(
    validation.limits.maxProcesses,
    1,
    64,
    "terraformValidation.limits.maxProcesses",
  );
  assertIntegerInRange(
    validation.limits.maxTotalFileBytes,
    1,
    16 * 1024 * 1024,
    "terraformValidation.limits.maxTotalFileBytes",
  );
  assertIntegerInRange(
    validation.limits.memoryMiB,
    128,
    4_096,
    "terraformValidation.limits.memoryMiB",
  );
  assertIntegerInRange(
    validation.limits.queuedTimeoutMinutes,
    5,
    480,
    "terraformValidation.limits.queuedTimeoutMinutes",
  );
  assertIntegerInRange(
    validation.limits.timeoutMinutes,
    5,
    480,
    "terraformValidation.limits.timeoutMinutes",
  );
  assertIntegerInRange(
    validation.limits.wallTimeMilliseconds,
    1_000,
    300_000,
    "terraformValidation.limits.wallTimeMilliseconds",
  );
  if (
    validation.limits.wallTimeMilliseconds >=
    validation.limits.timeoutMinutes * 60_000
  ) {
    fail(
      "Terraform command wall time must remain below the CodeBuild timeout.",
    );
  }
}

function assertBooleanRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object with exact boolean keys.`);
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpectedKeys)) {
    fail(`${label} must contain only the exact supported keys.`);
  }
  if (Object.values(record).some((entry) => typeof entry !== "boolean")) {
    fail(`${label} values must be booleans.`);
  }
}

function assertBedrockModelArn(value: string, target: EnvironmentTarget): void {
  const parsed = parseArn(value, "bedrock", "integrations.bedrock.modelArns");
  if (
    parsed.partition !== targetPartition(target) ||
    parsed.account !== "" ||
    !awsRegionPattern.test(parsed.region) ||
    targetPartition({ ...target, region: parsed.region }) !==
      parsed.partition ||
    !/^foundation-model\/[A-Za-z0-9][A-Za-z0-9._:-]{0,2047}$/u.test(
      parsed.resource,
    )
  ) {
    fail(
      "integrations.bedrock.modelArns must contain exact foundation-model ARNs in the target partition.",
    );
  }
}

function assertBedrockInferenceProfileArn(
  value: string,
  target: EnvironmentTarget,
): void {
  const parsed = parseArn(
    value,
    "bedrock",
    "integrations.bedrock.inferenceProfileArns",
  );
  if (
    parsed.partition !== targetPartition(target) ||
    parsed.account !== target.account ||
    parsed.region !== target.region ||
    !/^(?:inference-profile|application-inference-profile)\/[A-Za-z0-9][A-Za-z0-9:.-]{0,2047}$/u.test(
      parsed.resource,
    )
  ) {
    fail(
      "integrations.bedrock.inferenceProfileArns must contain exact target-account and target-Region inference-profile ARNs.",
    );
  }
}

function assertSecretReference(
  value: unknown,
  environment: EnvironmentName,
  label: string,
): void {
  if (typeof value !== "string") {
    fail(label + " must be a logical secret name for the exact environment.");
  }
  const match = secretNamePattern.exec(value);
  if (match?.[1] !== environment) {
    fail(`${label} must be a logical secret name for the exact environment.`);
  }
}

function assertNoLiteralSecrets(value: unknown, path = "configuration"): void {
  if (typeof value === "string") {
    if (forbiddenSecretValuePatterns.some((pattern) => pattern.test(value))) {
      fail(`${path} contains a literal secret value.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertNoLiteralSecrets(entry, `${path}[${String(index)}]`);
    });
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
    const isReferenceKey =
      normalizedKey.endsWith("secretarn") ||
      normalizedKey.endsWith("secretname") ||
      normalizedKey.endsWith("secretreference");
    const isLiteralSecretKey = forbiddenSecretKeyFragments.some(
      (fragment) =>
        normalizedKey === fragment || normalizedKey.endsWith(fragment),
    );
    if (!isReferenceKey && isLiteralSecretKey) {
      fail(`${path}.${key} is a literal-secret field.`);
    }
    assertNoLiteralSecrets(entry, `${path}.${key}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function validateEnvironmentConfig(config: EnvironmentConfig): void {
  assertNoLiteralSecrets(config);
  if (
    config.accountSecurity !== undefined &&
    !accountSecurityConfigurationV1Schema.safeParse(config.accountSecurity)
      .success
  )
    fail(
      "accountSecurity must contain an exact versioned recovery contact or null.",
    );
  const access: unknown = config.accountAccess;
  if (
    access !== undefined &&
    (typeof access !== "object" ||
      access === null ||
      Array.isArray(access) ||
      Object.keys(access).sort().join(",") !==
        "managedLogin,registrationEnabled,schemaVersion" ||
      !("schemaVersion" in access) ||
      access.schemaVersion !== 1 ||
      !("managedLogin" in access) ||
      typeof access.managedLogin !== "boolean" ||
      !("registrationEnabled" in access) ||
      typeof access.registrationEnabled !== "boolean" ||
      (access.registrationEnabled && !access.managedLogin))
  )
    fail(
      "accountAccess must contain exact versioned registration and managed-login settings.",
    );
  const schemaVersion: unknown = config.schemaVersion;
  if (schemaVersion !== ENVIRONMENT_CONFIG_SCHEMA_VERSION) {
    fail("schemaVersion must be 1.");
  }
  const environment: unknown = config.environment;
  if (
    typeof environment !== "string" ||
    !new Set<string>(["beta", "dev", "staging", "prod"]).has(environment)
  ) {
    fail("environment must be beta, dev, staging, or prod.");
  }
  const target: unknown = config.target;
  if (
    typeof target !== "object" ||
    target === null ||
    !("account" in target) ||
    typeof target.account !== "string" ||
    !awsAccountPattern.test(target.account)
  ) {
    fail("target.account must be a 12-digit AWS account ID.");
  }
  if (
    !("region" in target) ||
    typeof target.region !== "string" ||
    !awsRegionPattern.test(target.region)
  ) {
    fail("target.region must be an explicit AWS Region.");
  }
  assertBooleanRecord(config.features, environmentFeatureKeys, "features");
  const deletionProtection: unknown = config.lifecycle.deletionProtection;
  if (typeof deletionProtection !== "boolean") {
    fail("lifecycle.deletionProtection must be a boolean.");
  }
  const removalPolicy: unknown = config.lifecycle.removalPolicy;
  if (removalPolicy !== "retain" && removalPolicy !== "destroy") {
    fail("lifecycle.removalPolicy must be retain or destroy.");
  }
  const requiresDurableState =
    config.environment === "beta" || config.environment === "prod";
  if (
    requiresDurableState &&
    (!config.lifecycle.deletionProtection ||
      config.lifecycle.removalPolicy !== "retain")
  ) {
    fail(
      "beta and production require deletion protection and retain removal policy.",
    );
  }

  const { database } = config;
  const wake: unknown = config.integrations.projectCleanupWake;
  if (
    wake !== undefined &&
    (typeof wake !== "object" ||
      wake === null ||
      Object.keys(wake).length !== 1 ||
      !("preparationEnabled" in wake) ||
      typeof wake.preparationEnabled !== "boolean" ||
      config.environment !== "beta")
  ) {
    fail(
      "integrations.projectCleanupWake must be an exact beta-only preparation Boolean.",
    );
  }
  if (
    config.integrations.projectCleanupWake?.preparationEnabled === true &&
    (database.minCapacityAcu < 0.5 ||
      database.betaAutoPauseEnabled === true ||
      database.autoPauseMinutes !== undefined)
  ) {
    fail("Cleanup wake shadow preparation requires always-on SQL recovery.");
  }
  if (
    database.betaAutoPauseEnabled !== undefined &&
    (typeof database.betaAutoPauseEnabled !== "boolean" ||
      config.environment !== "beta")
  ) {
    fail("database.betaAutoPauseEnabled must be a beta-only Boolean opt-in.");
  }
  for (const [label, capacity] of [
    ["database.minCapacityAcu", database.minCapacityAcu],
    ["database.maxCapacityAcu", database.maxCapacityAcu],
  ] as const) {
    if (
      !Number.isFinite(capacity) ||
      capacity < 0 ||
      capacity > 256 ||
      capacity * 2 !== Math.round(capacity * 2)
    ) {
      fail(`${label} must be a half-ACU value from 0 through 256.`);
    }
  }
  if (database.maxCapacityAcu <= database.minCapacityAcu) {
    fail("database.maxCapacityAcu must exceed database.minCapacityAcu.");
  }
  assertIntegerInRange(
    database.backupRetentionDays,
    1,
    35,
    "database.backupRetentionDays",
  );
  if (database.autoPauseMinutes !== undefined) {
    assertIntegerInRange(
      database.autoPauseMinutes,
      5,
      1_440,
      "database.autoPauseMinutes",
    );
    if (database.minCapacityAcu !== 0) {
      fail("database auto-pause requires a minimum capacity of 0 ACU.");
    }
  }
  if (requiresDurableState && database.backupRetentionDays < 7) {
    fail("beta and production database backups require at least seven days.");
  }
  const betaAutoPause =
    config.environment === "beta" && database.betaAutoPauseEnabled === true;
  if (
    betaAutoPause &&
    (database.minCapacityAcu !== 0 || database.autoPauseMinutes === undefined)
  ) {
    fail(
      "beta auto-pause requires an explicit zero minimum and pause interval.",
    );
  }
  if (
    requiresDurableState &&
    !betaAutoPause &&
    (database.minCapacityAcu < 0.5 || database.autoPauseMinutes !== undefined)
  ) {
    fail("beta and production databases cannot pause or scale to zero.");
  }

  if (!cloudWatchRetentionDays.has(config.retention.logsDays)) {
    fail("retention.logsDays must be a supported CloudWatch retention value.");
  }
  if (!cloudWatchRetentionDays.has(config.retention.accessLogsDays)) {
    fail(
      "retention.accessLogsDays must be a supported CloudWatch retention value.",
    );
  }
  assertIntegerInRange(
    config.retention.artifactDays,
    1,
    3_653,
    "retention.artifactDays",
  );
  assertIntegerInRange(
    config.retention.noncurrentObjectVersionsDays,
    1,
    3_653,
    "retention.noncurrentObjectVersionsDays",
  );
  const evidenceRetention: unknown = config.retention.evidence;
  if (evidenceRetention !== "retain") {
    fail("Evidence retention must remain retain in Prompt 27.");
  }

  assertPositiveNumber(config.budget.monthlyLimitUsd, "budget.monthlyLimitUsd");
  assertPositiveNumber(
    config.budget.anomalyThresholdUsd,
    "budget.anomalyThresholdUsd",
  );
  if (config.budget.anomalyThresholdUsd > config.budget.monthlyLimitUsd) {
    fail("budget.anomalyThresholdUsd cannot exceed the monthly budget.");
  }
  assertIntegerInRange(
    config.budget.alarmThresholdPercent,
    1,
    100,
    "budget.alarmThresholdPercent",
  );
  assertIntegerInRange(config.limits.apiBurst, 1, 10_000, "limits.apiBurst");
  assertIntegerInRange(
    config.limits.apiConcurrency,
    1,
    1_000,
    "limits.apiConcurrency",
  );
  assertIntegerInRange(config.limits.apiRate, 1, 10_000, "limits.apiRate");
  assertIntegerInRange(
    config.limits.apiTimeoutSeconds,
    1,
    29,
    "limits.apiTimeoutSeconds",
  );
  assertIntegerInRange(
    config.limits.jobMaxReceiveCount,
    1,
    100,
    "limits.jobMaxReceiveCount",
  );
  assertIntegerInRange(
    config.limits.jobVisibilityTimeoutSeconds,
    30,
    43_200,
    "limits.jobVisibilityTimeoutSeconds",
  );
  assertIntegerInRange(
    config.limits.wafApiRequestsPerFiveMinutes,
    10,
    2_000_000_000,
    "limits.wafApiRequestsPerFiveMinutes",
  );
  assertIntegerInRange(
    config.limits.wafWebhookRequestsPerFiveMinutes,
    10,
    2_000_000_000,
    "limits.wafWebhookRequestsPerFiveMinutes",
  );
  if (
    config.limits.wafWebhookRequestsPerFiveMinutes >
    config.limits.wafApiRequestsPerFiveMinutes
  ) {
    fail(
      "limits.wafWebhookRequestsPerFiveMinutes cannot exceed the aggregate API rate control.",
    );
  }
  assertIntegerInRange(
    config.limits.workerConcurrency,
    2,
    1_000,
    "limits.workerConcurrency",
  );
  assertIntegerInRange(
    config.limits.workerMemoryMiB,
    128,
    10_240,
    "limits.workerMemoryMiB",
  );
  assertIntegerInRange(
    config.limits.workerTimeoutSeconds,
    1,
    900,
    "limits.workerTimeoutSeconds",
  );
  if (
    config.limits.jobVisibilityTimeoutSeconds <=
    config.limits.workerTimeoutSeconds
  ) {
    fail("job visibility timeout must exceed the worker timeout.");
  }
  validateApplicationBuildConfig(config);
  validateTerraformValidationConfig(config);

  const { integrations } = config;
  assertSecretReference(
    integrations.stripe.apiKeySecretName,
    config.environment,
    "integrations.stripe.apiKeySecretName",
  );
  assertSecretReference(
    integrations.stripe.webhookSigningSecretName,
    config.environment,
    "integrations.stripe.webhookSigningSecretName",
  );
  if (integrations.stripe.previousWebhookSigningSecretName !== undefined) {
    assertSecretReference(
      integrations.stripe.previousWebhookSigningSecretName,
      config.environment,
      "integrations.stripe.previousWebhookSigningSecretName",
    );
    if (
      integrations.stripe.previousWebhookSigningSecretName ===
      integrations.stripe.webhookSigningSecretName
    ) {
      fail(
        "Stripe current and previous webhook secret references must differ.",
      );
    }
  }
  if (
    !["test", "live"].includes(integrations.stripe.environment) ||
    (integrations.stripe.environment === "live" &&
      !integrations.stripe.deliveryEnabled)
  ) {
    fail(
      "Stripe live mode requires the reviewed signed-delivery configuration.",
    );
  }
  const stripe = integrations.stripe;
  if (
    typeof stripe.deliveryEnabled !== "boolean" ||
    typeof stripe.sessionsEnabled !== "boolean"
  ) {
    fail("Stripe delivery and session activation require explicit booleans.");
  }
  if (stripe.sessionsEnabled && !stripe.deliveryEnabled) {
    fail("Stripe sessions require the reviewed signed-delivery composition.");
  }
  if (stripe.deliveryEnabled) {
    if (config.environment !== "beta" || !config.features.billing) {
      fail("Stripe delivery requires beta and the billing feature flag.");
    }
    if (config.domain?.domainName !== "beta.example.invalid") {
      fail("Stripe delivery requires the reviewed beta HTTPS origin.");
    }
    if (stripe.graceHours !== 0) {
      fail("Stripe delivery requires zero grace hours.");
    }
    // Keep the deployment adapter aligned with the exact reviewed production
    // billing/session contracts; syntactically valid replacement IDs are not
    // evidence that another Stripe account or endpoint has been reviewed.
    const reviewedSandbox = {
      apiKeySecretArn:
        "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/api-key-EX0004",
      webhookEndpointVersion: "cloudmarkup-stripe-webhook-2026-08-28-v1",
      starterProductId: "prod_ExampleStarterTest",
      starterPriceId: "price_ExampleStarterTest",
      proProductId: "prod_ExampleProTest",
      proPriceId: "price_ExampleProTest",
      portalConfigurationId: "bpc_ExampleTest",
      cancelUrl: "https://beta.example.invalid/organizations",
      successUrl: "https://beta.example.invalid/organizations",
      portalReturnUrl: "https://beta.example.invalid/organizations",
    } as const;
    const reviewed =
      stripe.environment === "live"
        ? {
            ...reviewedSandbox,
            apiKeySecretArn:
              "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/api-key-EX0003",
            starterProductId: "prod_ExampleStarterLive",
            starterPriceId: "price_ExampleStarterLive",
            proProductId: "prod_ExampleProLive",
            proPriceId: "price_ExampleProLive",
            portalConfigurationId: "bpc_ExampleLive",
          }
        : reviewedSandbox;
    if (
      stripe.environment === "live" &&
      (stripe.webhookSigningSecretArn !==
        "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/webhook-signing-secret-EX0005" ||
        stripe.previousWebhookSigningSecretArn !== undefined ||
        stripe.planMappingVersion !==
          "cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4")
    )
      fail(
        "Live delivery requires its reviewed signing secret and credit mapping.",
      );
    for (const key of Object.keys(reviewed) as (keyof typeof reviewed)[]) {
      if (stripe[key] !== reviewed[key])
        fail(`Stripe delivery requires the reviewed ${key}.`);
    }
    if (stripe.sessionsEnabled && config.limits.apiTimeoutSeconds < 25) {
      fail(
        "Stripe sessions require at least 25 seconds for bounded provider operations.",
      );
    }
    for (const [field, name, optional] of [
      ["apiKeySecretArn", stripe.apiKeySecretName, false],
      ["webhookSigningSecretArn", stripe.webhookSigningSecretName, false],
      [
        "previousWebhookSigningSecretArn",
        stripe.previousWebhookSigningSecretName,
        true,
      ],
    ] as const) {
      const value = stripe[field];
      if (optional && value === undefined && name === undefined) continue;
      if (typeof value !== "string" || name === undefined) {
        fail(`Stripe ${field} requires an exact named secret ARN.`);
      }
      const parsed = parseArn(value, "secretsmanager", `Stripe ${field}`);
      if (
        parsed.account !== config.target.account ||
        parsed.region !== config.target.region ||
        parsed.partition !== targetPartition(config.target) ||
        !parsed.resource.startsWith(`secret:${name}-`) ||
        !/^[A-Za-z0-9]{6}$/u.test(
          parsed.resource.slice(`secret:${name}-`.length),
        )
      ) {
        fail(
          `Stripe ${field} must bind the exact target-account, Region and configured secret name.`,
        );
      }
    }
    if (
      stripe.apiKeySecretArn === stripe.webhookSigningSecretArn ||
      stripe.apiKeySecretArn === stripe.previousWebhookSigningSecretArn ||
      stripe.webhookSigningSecretArn === stripe.previousWebhookSigningSecretArn
    ) {
      fail("Stripe API and signing secret references must be distinct.");
    }
  }

  assertIntegerInRange(
    integrations.stripe.graceHours,
    0,
    720,
    "integrations.stripe.graceHours",
  );
  for (const [label, value] of [
    ["planMappingVersion", integrations.stripe.planMappingVersion],
    ["webhookEndpointVersion", integrations.stripe.webhookEndpointVersion],
  ] as const) {
    if (!safeIdentifierPattern.test(value)) {
      fail("Stripe " + label + " is invalid.");
    }
  }
  if (
    integrations.stripe.planMappingVersion !==
      "cloudmarkup-starter-pro-mapping-2026-08-28-v1" &&
    integrations.stripe.planMappingVersion !==
      "cloudmarkup-starter-pro-sharing-mapping-2026-09-07-v2" &&
    integrations.stripe.planMappingVersion !==
      "cloudmarkup-starter-pro-export-mapping-2026-09-12-v3" &&
    integrations.stripe.planMappingVersion !==
      "cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4"
  ) {
    fail("Stripe planMappingVersion is not a reviewed mapping.");
  }
  for (const [label, value] of [
    ["cancelUrl", integrations.stripe.cancelUrl],
    ["portalReturnUrl", integrations.stripe.portalReturnUrl],
    ["successUrl", integrations.stripe.successUrl],
  ] as const) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      fail("Stripe " + label + " is invalid.");
    }
    const loopback =
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      (parsed.protocol !== "https:" && !loopback)
    ) {
      fail(
        "Stripe " + label + " must use HTTPS except for loopback development.",
      );
    }
  }
  assertSecretReference(
    integrations.github.privateKeySecretName,
    config.environment,
    "integrations.github.privateKeySecretName",
  );
  assertSecretReference(
    integrations.github.webhookSecretName,
    config.environment,
    "integrations.github.webhookSecretName",
  );
  integrations.bedrock.modelArns.forEach((arn) => {
    assertBedrockModelArn(arn, config.target);
  });
  integrations.bedrock.inferenceProfileArns.forEach((arn) => {
    assertBedrockInferenceProfileArn(arn, config.target);
  });
  if (
    config.features.aiAuthoring &&
    integrations.bedrock.modelArns.length === 0 &&
    integrations.bedrock.inferenceProfileArns.length === 0
  ) {
    fail(
      "AI authoring requires exact Bedrock model or inference-profile ARNs.",
    );
  }
  const stripeRequired: readonly unknown[] = [
    integrations.stripe.portalConfigurationId,
    integrations.stripe.proPriceId,
    integrations.stripe.proProductId,
    integrations.stripe.starterPriceId,
    integrations.stripe.starterProductId,
  ];
  if (
    config.features.billing &&
    stripeRequired.some((value) => value === undefined)
  ) {
    fail("billing requires reviewed Stripe Product, Price, and Portal IDs.");
  }
  stripeRequired.forEach((value) => {
    if (
      value !== undefined &&
      (typeof value !== "string" || !safeIdentifierPattern.test(value))
    ) {
      fail("Stripe identifiers must use the bounded identifier grammar.");
    }
  });
  const githubAppId: unknown = integrations.github.appId;
  if (
    githubAppId !== undefined &&
    (typeof githubAppId !== "string" || !/^\d{1,20}$/u.test(githubAppId))
  ) {
    fail("GitHub App identifiers must be numeric strings.");
  }
  if (config.features.githubExport && githubAppId === undefined) {
    fail("GitHub export requires a numeric GitHub App identifier.");
  }
  const github = integrations.github;
  if (typeof github.connectionsEnabled !== "boolean") {
    fail("integrations.github.connectionsEnabled must be an explicit boolean.");
  }
  for (const [label, value] of [
    ["privateKeySecretArn", github.privateKeySecretArn],
    ["clientSecretArn", github.clientSecretArn],
  ] as const) {
    if (value === undefined && !github.connectionsEnabled) continue;
    if (typeof value !== "string")
      fail(`integrations.github.${label} must be an exact secret ARN.`);
    const parsed = parseArn(
      value,
      "secretsmanager",
      `integrations.github.${label}`,
    );
    if (
      parsed.account !== config.target.account ||
      parsed.region !== config.target.region ||
      parsed.partition !== targetPartition(config.target) ||
      !/^secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/u.test(parsed.resource)
    )
      fail(
        `integrations.github.${label} must be an exact target-account and target-Region secret ARN.`,
      );
  }
  if (
    github.appSlug !== undefined &&
    (typeof github.appSlug !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,99}$/u.test(github.appSlug))
  ) {
    fail("integrations.github.appSlug must be a bounded GitHub App slug.");
  }
  if (
    github.clientId !== undefined &&
    (typeof github.clientId !== "string" ||
      !/^Iv[0-9A-Za-z]{10,100}$/u.test(github.clientId))
  ) {
    fail(
      "integrations.github.clientId must be a GitHub App client identifier.",
    );
  }
  if (
    github.clientSecretJsonField !== undefined &&
    (typeof github.clientSecretJsonField !== "string" ||
      !/^[A-Za-z0-9 _-]{1,128}$/u.test(github.clientSecretJsonField))
  ) {
    fail(
      "integrations.github.clientSecretJsonField must be a bounded field name, not a secret value.",
    );
  }
  if (github.connectionsEnabled) {
    if (
      githubAppId === undefined ||
      Number(githubAppId) <= 0 ||
      !Number.isSafeInteger(Number(githubAppId)) ||
      github.appSlug === undefined ||
      github.clientId === undefined
    ) {
      fail(
        "GitHub connections require an exact GitHub App, slug and client identifier.",
      );
    }
    if (config.domain === undefined)
      fail("GitHub connections require an explicit public HTTPS domain.");
    if (github.clientSecretArn === github.privateKeySecretArn)
      fail("GitHub connections require two distinct secret ARNs.");
    if (config.limits.apiTimeoutSeconds < 25)
      fail(
        "GitHub connections require at least 25 seconds for the bounded authorization exchange.",
      );
  }
  const solutionExport: unknown = integrations.solutionExport;
  if (solutionExport !== undefined) {
    if (
      solutionExport === null ||
      typeof solutionExport !== "object" ||
      Object.keys(solutionExport).length !== 1 ||
      !("enabled" in solutionExport) ||
      typeof solutionExport.enabled !== "boolean"
    )
      fail(
        "Solution export configuration requires exactly one explicit enabled boolean.",
      );
    if (
      solutionExport.enabled &&
      (config.environment !== "beta" ||
        config.target.account !== "000000000000" ||
        config.target.region !== "us-east-1" ||
        config.domain?.domainName !== "beta.example.invalid" ||
        !github.connectionsEnabled ||
        !integrations.stripe.deliveryEnabled ||
        config.features.aiAuthoring ||
        config.features.githubExport ||
        config.features.planDeploymentWorkflowExport ||
        config.features.applicationGeneration ||
        config.features.staticValidation ||
        (integrations.stripe.planMappingVersion !==
          "cloudmarkup-starter-pro-export-mapping-2026-09-12-v3" &&
          integrations.stripe.planMappingVersion !==
            "cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4"))
    )
      fail(
        "CloudFormation infrastructure export requires the exact restricted beta runtime profile.",
      );
  }
  if (config.features.waf && config.target.region !== "us-east-1") {
    fail(
      "WAF-enabled environments require a us-east-1 target until cross-Region CloudFront WAF observability is implemented.",
    );
  }

  if (config.environment === "beta") {
    if (config.domain === undefined) {
      fail("beta requires an explicit HTTPS domain and certificate.");
    }
    if (
      !config.features.betaAccess ||
      config.features.applicationGeneration ||
      config.features.staticValidation ||
      !config.features.waf
    ) {
      fail(
        "beta requires beta access and WAF controls while hosted application generation and static validation remain disabled.",
      );
    }
  }

  if (config.domain !== undefined) {
    const createDnsRecords: unknown = config.domain.createDnsRecords;
    if (typeof createDnsRecords !== "boolean") {
      fail("domain.createDnsRecords must be a boolean.");
    }
    if (
      config.domain.domainName.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(
        config.domain.domainName,
      )
    ) {
      fail("domain.domainName must be a normalized DNS name.");
    }
    const { hostedZoneId, hostedZoneName } = config.domain;
    if (
      config.domain.createDnsRecords &&
      (hostedZoneId === undefined || hostedZoneName === undefined)
    ) {
      fail("automatic DNS records require an exact hosted zone ID and name.");
    }
    if (hostedZoneName !== undefined) {
      if (
        hostedZoneName.length > 253 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
          hostedZoneName,
        ) ||
        (config.domain.domainName !== hostedZoneName &&
          !config.domain.domainName.endsWith(`.${hostedZoneName}`))
      ) {
        fail(
          "the domain must belong to the normalized configured hosted zone.",
        );
      }
    }
    if (
      hostedZoneId !== undefined &&
      !/^Z[A-Z0-9]{1,31}$/u.test(hostedZoneId)
    ) {
      fail("domain.hostedZoneId is invalid.");
    }
    const certificate = parseArn(
      config.domain.certificateArn,
      "acm",
      "domain.certificateArn",
    );
    if (
      certificate.partition !== targetPartition(config.target) ||
      certificate.region !== "us-east-1" ||
      certificate.account !== config.target.account ||
      !/^certificate\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
        certificate.resource,
      )
    ) {
      fail(
        "CloudFront certificate ARN must be an exact us-east-1 certificate in the target account and partition.",
      );
    }
    const wafWebAclArn: unknown = config.domain.wafWebAclArn;
    const wafWebAclMetricName: unknown = config.domain.wafWebAclMetricName;
    if ((wafWebAclArn === undefined) !== (wafWebAclMetricName === undefined)) {
      fail(
        "domain.wafWebAclArn and domain.wafWebAclMetricName must be supplied together.",
      );
    }
    if (
      wafWebAclMetricName !== undefined &&
      (typeof wafWebAclMetricName !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(wafWebAclMetricName) ||
        /^(?:all|default_action)$/iu.test(wafWebAclMetricName))
    ) {
      fail(
        "domain.wafWebAclMetricName must be a bounded, non-reserved AWS WAF CloudWatch metric name.",
      );
    }
    if (wafWebAclArn !== undefined) {
      if (typeof wafWebAclArn !== "string") {
        fail("domain.wafWebAclArn must be a bounded wafv2 ARN.");
      }
      const webAcl = parseArn(wafWebAclArn, "wafv2", "domain.wafWebAclArn");
      if (
        webAcl.partition !== targetPartition(config.target) ||
        webAcl.region !== "us-east-1" ||
        webAcl.account !== config.target.account ||
        !/^global\/webacl\/[A-Za-z0-9_-]{1,128}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
          webAcl.resource,
        )
      ) {
        fail(
          "CloudFront Web ACL ARN must be an exact us-east-1 global web ACL in the target account and partition.",
        );
      }
    }
  }

  if (config.tags["Environment"] !== config.environment) {
    fail("tags.Environment must match the exact environment overlay.");
  }
  if (Object.keys(config.tags).length === 0) fail("tags cannot be empty.");
  for (const [key, value] of Object.entries(config.tags)) {
    const tagValue: unknown = value;
    if (
      key.length === 0 ||
      key.length > 128 ||
      key.toLowerCase().startsWith("aws:") ||
      typeof tagValue !== "string" ||
      tagValue.length === 0 ||
      tagValue.length > 256
    ) {
      fail("tags must be nonempty, bounded, and outside the aws: namespace.");
    }
  }
}

export function defineEnvironmentConfig(
  input: EnvironmentConfig,
): EnvironmentConfig {
  const clone = structuredClone(input);
  validateEnvironmentConfig(clone);
  return deepFreeze(clone);
}

export const DEFAULT_DISABLED_FEATURES: EnvironmentConfig["features"] =
  deepFreeze({
    aiAuthoring: false,
    applicationGeneration: false,
    betaAccess: false,
    billing: false,
    githubExport: false,
    planDeploymentWorkflowExport: false,
    staticValidation: false,
    waf: false,
  });

export function baseEnvironmentConfig(
  environment: EnvironmentName,
  target: EnvironmentTarget,
): EnvironmentConfig {
  const durable = environment === "beta" || environment === "prod";
  const beta = environment === "beta";
  return {
    accountAccess: {
      schemaVersion: 1,
      managedLogin: true,
      registrationEnabled: false,
    },
    budget: {
      alarmThresholdPercent: 80,
      monthlyLimitUsd: environment === "prod" ? 500 : beta ? 250 : 100,
      anomalyThresholdUsd: environment === "prod" ? 50 : beta ? 25 : 10,
    },
    database: {
      backupRetentionDays: durable ? 14 : 1,
      maxCapacityAcu: environment === "prod" ? 8 : beta ? 4 : 2,
      minCapacityAcu: durable ? 0.5 : 0,
      ...(durable ? {} : { autoPauseMinutes: 15 }),
    },
    environment,
    features: { ...DEFAULT_DISABLED_FEATURES },
    integrations: {
      bedrock: { inferenceProfileArns: [], modelArns: [] },
      github: {
        connectionsEnabled: false,
        privateKeySecretName: `cloudmarkup/${environment}/github/app-private-key`,
        webhookSecretName: `cloudmarkup/${environment}/github/webhook-secret`,
      },
      stripe: {
        apiKeySecretName: `cloudmarkup/${environment}/stripe/api-key`,
        cancellationPolicy: "period-end-default",
        cancelUrl: "http://127.0.0.1:4173/settings/billing?checkout=canceled",
        currency: "USD",
        deliveryEnabled: false,
        environment: "test",
        graceHours: 0,
        planMappingVersion: "cloudmarkup-starter-pro-mapping-2026-08-28-v1",
        portalReturnUrl: "http://127.0.0.1:4173/settings/billing",
        proCreditUnits: 1000,
        sessionsEnabled: false,
        starterCreditUnits: 200,
        successUrl: "http://127.0.0.1:4173/settings/billing?checkout=success",
        trialPolicy: "no-trial",
        webhookEndpointVersion: "cloudmarkup-stripe-webhook-2026-08-28-v1",
        webhookSigningSecretName: `cloudmarkup/${environment}/stripe/webhook-signing-secret`,
      },
    },
    lifecycle: {
      deletionProtection: durable,
      removalPolicy: durable ? "retain" : "destroy",
    },
    limits: {
      apiBurst: environment === "prod" ? 500 : beta ? 200 : 100,
      apiConcurrency: environment === "prod" ? 50 : beta ? 25 : 10,
      apiRate: environment === "prod" ? 250 : beta ? 100 : 50,
      apiTimeoutSeconds: 15,
      jobMaxReceiveCount: 5,
      jobVisibilityTimeoutSeconds: 360,
      wafApiRequestsPerFiveMinutes:
        environment === "prod" ? 10_000 : beta ? 5_000 : 2_000,
      wafWebhookRequestsPerFiveMinutes:
        environment === "prod" ? 2_000 : beta ? 1_000 : 500,
      workerConcurrency: environment === "prod" ? 25 : beta ? 10 : 5,
      workerMemoryMiB: 1_024,
      workerTimeoutSeconds: 300,
    },
    retention: {
      accessLogsDays: environment === "prod" ? 365 : beta ? 90 : 30,
      artifactDays: environment === "prod" ? 365 : beta ? 90 : 30,
      evidence: "retain",
      logsDays: environment === "prod" ? 365 : beta ? 90 : 30,
      noncurrentObjectVersionsDays:
        environment === "prod" ? 365 : beta ? 90 : 30,
    },
    schemaVersion: ENVIRONMENT_CONFIG_SCHEMA_VERSION,
    tags: {
      Environment: environment,
      ManagedBy: "CloudMarkup-CDK",
      Project: "CloudMarkup",
    },
    applicationBuild: {
      image: {
        digest:
          "sha256:2a3b4c5d6e7f8901123456789abcdef02a3b4c5d6e7f8901123456789abcdef0",
        repository: expectedApplicationBuildRepository(target),
      },
      limits: {
        concurrentBuilds: 1,
        cpuSeconds: 300,
        maxArtifactBytes: 64 * 1024 * 1024,
        maxFileBytes: 4 * 1024 * 1024,
        maxFiles: 20_000,
        maxMonthlyBuildMinutes:
          environment === "prod" ? 4_000 : beta ? 1_200 : 600,
        maxOutputBytes: 2 * 1024 * 1024,
        maxProcesses: 64,
        maxTotalFileBytes: 128 * 1024 * 1024,
        memoryMiB: 4_096,
        queuedTimeoutMinutes: 10,
        timeoutMinutes: 30,
        wallTimeMilliseconds: 600_000,
      },
    },
    terraformValidation: {
      image: {
        digest:
          "sha256:1f2e3d4c5b6a79800123456789abcdef1f2e3d4c5b6a79800123456789abcdef",
        repository: expectedTerraformValidationRepository(target),
      },
      limits: {
        concurrentBuilds: 1,
        cpuSeconds: 60,
        maxFileBytes: 2 * 1024 * 1024,
        maxFiles: 256,
        maxMonthlyBuildMinutes:
          environment === "prod" ? 2_000 : beta ? 600 : 300,
        maxOutputBytes: 1024 * 1024,
        maxProcesses: 32,
        maxTotalFileBytes: 16 * 1024 * 1024,
        memoryMiB: 1_024,
        queuedTimeoutMinutes: 10,
        timeoutMinutes: 15,
        wallTimeMilliseconds: 120_000,
      },
    },
    target,
  };
}
