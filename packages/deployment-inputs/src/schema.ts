import { z } from "zod";

export const DEPLOYMENT_INPUTS_SCHEMA_VERSION = 1 as const;

const stableIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/u);
const awsAccountIdSchema = z.string().regex(/^\d{12}$/u);
const awsRegionSchema = z
  .string()
  .min(9)
  .max(32)
  .regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u);
const awsArnSchema = z
  .string()
  .min(20)
  .max(2_048)
  .regex(
    /^arn:(?:aws|aws-cn|aws-us-gov):[a-z0-9-]+:[a-z0-9-]*:\d{0,12}:[A-Za-z0-9_./:=+@*-]+$/u,
  );
const iamRoleArnSchema = awsArnSchema.regex(
  /:iam::\d{12}:role\/[A-Za-z0-9_+=,.@/-]+$/u,
);
const secretsManagerReferenceSchema = z
  .string()
  .min(3)
  .max(2_048)
  .refine(
    (value) =>
      /^cloudmarkup(?:\/(?:beta|dev|staging|prod)|-(?:beta|dev|staging|prod))\/[a-z0-9][a-z0-9/_-]{1,126}$/u.test(
        value,
      ) ||
      /^arn:(?:aws|aws-cn|aws-us-gov):secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/u.test(
        value,
      ),
    "Use an exact Cloud Markup logical secret name or Secrets Manager ARN.",
  );
const environmentVariableSchema = z
  .string()
  .min(3)
  .max(96)
  .regex(/^CLOUDMARKUP_[A-Z0-9_]+$/u);
const hostnameSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/u,
  );
const httpsUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => value.startsWith("https://"), "Use an HTTPS URL.");
const contactSchema = z
  .object({
    email: z.email().max(320),
    escalationReference: stableIdSchema,
  })
  .strict();
const decisionSchema = z
  .object({
    evidenceReference: stableIdSchema,
    owner: z.string().min(2).max(160),
    status: z.enum(["approved", "pending"]),
  })
  .strict();
const secretReferenceSchema = z
  .object({
    localEnvironmentVariable: environmentVariableSchema,
    secretsManagerReference: secretsManagerReferenceSchema,
  })
  .strict();
const quotaReviewSchema = z
  .object({
    evidenceReference: stableIdSchema,
    quotaCode: z.string().min(2).max(128),
    requestedValue: z.number().positive(),
    serviceCode: z.string().min(2).max(128),
    status: z.enum(["approved", "pending", "not-required"]),
  })
  .strict();

const awsConfigurationSchema = z
  .object({
    accountId: awsAccountIdSchema,
    enabledRegions: z.array(awsRegionSchema).min(1).max(32),
    partition: z.enum(["aws", "aws-cn", "aws-us-gov"]),
    platformDeployment: z
      .object({
        approval: decisionSchema,
        githubEnvironment: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
        oidcProviderArn: awsArnSchema.regex(/:iam::\d{12}:oidc-provider\//u),
        repository: z
          .object({
            approvedBranches: z
              .array(z.string().min(1).max(160))
              .min(1)
              .max(16),
            id: z.string().regex(/^[1-9][0-9]{0,19}$/u),
            name: z.string().min(1).max(100),
            owner: z.string().min(1).max(100),
            ownerId: z.string().regex(/^[1-9][0-9]{0,19}$/u),
          })
          .strict(),
        roleArn: iamRoleArnSchema,
        subject: z.string().min(10).max(512),
      })
      .strict(),
    primaryRegion: awsRegionSchema,
    quotaReviews: z.array(quotaReviewSchema).min(1).max(128),
  })
  .strict();

const domainConfigurationSchema = z
  .object({
    apiDomain: hostnameSchema,
    applicationDomain: hostnameSchema,
    certificateArn: awsArnSchema.regex(/:acm:[a-z0-9-]+:\d{12}:certificate\//u),
    dnsOwner: contactSchema,
    hostedZoneId: z.string().regex(/^Z[A-Z0-9]{1,63}$/u),
    privacyUrl: httpsUrlSchema,
    rootDomain: hostnameSchema,
    securityUrl: httpsUrlSchema,
    supportUrl: httpsUrlSchema,
    termsUrl: httpsUrlSchema,
  })
  .strict();

const cognitoConfigurationSchema = z
  .object({
    callbackUrls: z.array(httpsUrlSchema).min(1).max(20),
    email: z
      .object({
        fromAddress: z.email().max(320),
        sendingMode: z.enum(["cognito-default", "ses-reviewed"]),
      })
      .strict(),
    logoutUrls: z.array(httpsUrlSchema).min(1).max(20),
    mfa: z.enum(["required", "optional", "off-beta-blocked"]),
    recovery: z.enum(["verified-email-only", "admin-assisted-reviewed"]),
    session: z
      .object({
        accessTokenMinutes: z.number().int().min(5).max(60),
        idTokenMinutes: z.number().int().min(5).max(60),
        refreshTokenDays: z.number().int().min(1).max(30),
      })
      .strict(),
    signInIdentifiers: z
      .array(z.enum(["email", "username"]))
      .min(1)
      .max(2),
  })
  .strict();

const dataConfigurationSchema = z
  .object({
    backup: z
      .object({
        retentionDays: z.number().int().min(1).max(35),
        restoreDrill: decisionSchema,
      })
      .strict(),
    database: z
      .object({
        credentials: z
          .object({
            management: z.literal("rds-managed-secret"),
            secretReference: secretsManagerReferenceSchema,
          })
          .strict(),
        deletionProtection: z.boolean(),
        engine: z.literal("aurora-postgresql"),
        region: awsRegionSchema,
      })
      .strict(),
    deletion: z
      .object({
        completionObjective: decisionSchema,
        productionServiceAvailable: z.literal(false),
      })
      .strict(),
    residency: z
      .object({
        allowedRegions: z.array(awsRegionSchema).min(1).max(32),
        decision: decisionSchema,
      })
      .strict(),
    retention: z
      .object({
        applicationArtifactsDays: z.number().int().min(1).max(365),
        auditDays: z.number().int().min(30).max(3_653),
        evidenceDays: z.number().int().min(30).max(3_653),
        logsDays: z.number().int().min(1).max(365),
        privateRepositoryCacheHours: z.number().int().min(1).max(24),
        rawModelContent: z.literal("disabled"),
      })
      .strict(),
    storage: z
      .object({
        encryption: z.enum(["sse-s3", "sse-kms-reviewed"]),
        region: awsRegionSchema,
        versioning: z.literal(true),
      })
      .strict(),
  })
  .strict();

const usageFieldSchema = z.enum([
  "inputTokens",
  "outputTokens",
  "cacheReadInputTokens",
  "cacheWriteInputTokens",
]);

const bedrockCapabilitySchema = z
  .object({
    adaptiveThinking: z.boolean(),
    caching: z
      .object({
        maximumCheckpoints: z.number().int().min(0).max(16),
        supported: z.boolean(),
      })
      .strict(),
    contextLimitTokens: z.number().int().min(1_024).max(2_000_000),
    id: stableIdSchema,
    inferenceProfileArn: awsArnSchema
      .regex(/:bedrock:[a-z0-9-]+:\d{12}:(?:application-)?inference-profile\//u)
      .nullable(),
    inferenceProfileId: z
      .string()
      .min(3)
      .max(2_048)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/u)
      .nullable(),
    modelArn: awsArnSchema.regex(/:bedrock:[a-z0-9-]*::foundation-model\//u),
    modelFamily: z.string().min(2).max(160),
    modelId: z
      .string()
      .min(3)
      .max(2_048)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/u),
    modelVersion: z.string().min(1).max(160),
    outputLimitTokens: z.number().int().min(256).max(200_000),
    residency: z.enum([
      "single-region",
      "geographic-cross-region",
      "global-cross-region",
    ]),
    selectedRegion: awsRegionSchema,
    streaming: z.boolean(),
    structuredOutput: z.enum(["native-json-schema", "tool-schema"]),
    thinking: z.boolean(),
    toolUse: z.boolean(),
    usageFields: z.array(usageFieldSchema).min(2).max(4),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.inferenceProfileArn === null) !==
      (value.inferenceProfileId === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Inference-profile ID and ARN must be configured together.",
        path: ["inferenceProfileId"],
      });
    }
    if (value.outputLimitTokens > value.contextLimitTokens) {
      context.addIssue({
        code: "custom",
        message: "Output limit cannot exceed the model context limit.",
        path: ["outputLimitTokens"],
      });
    }
    if (!value.caching.supported && value.caching.maximumCheckpoints !== 0) {
      context.addIssue({
        code: "custom",
        message:
          "A capability without caching must use zero cache checkpoints.",
        path: ["caching", "maximumCheckpoints"],
      });
    }
  });

const bedrockRouteSchema = z
  .object({
    allowedFeatures: z.array(stableIdSchema).min(1).max(32),
    allowedPlans: z.array(z.enum(["starter", "pro"])).max(2),
    capabilityId: stableIdSchema,
    enabled: z.boolean(),
    maximumAttempts: z.number().int().min(1).max(3),
    maximumConcurrency: z.number().int().min(1).max(100),
    maximumOutputTokens: z.number().int().min(256).max(100_000),
    thinkingEffort: z.enum(["none", "low", "medium", "high", "adaptive"]),
    timeoutMilliseconds: z.number().int().min(1_000).max(300_000),
  })
  .strict();

const bedrockConfigurationSchema = z
  .object({
    apiCredentialPolicy: z.literal("aws-iam-only-no-api-key"),
    capabilities: z.array(bedrockCapabilitySchema).min(1).max(16),
    costControls: z
      .object({
        administrativeSuspension: z.boolean(),
        alarmThresholdPercent: z.number().int().min(1).max(100),
        killSwitch: z.boolean(),
        monthlyBudgetUsd: z.number().positive().max(1_000_000),
      })
      .strict(),
    dataResidencyDecision: decisionSchema,
    enabled: z.boolean(),
    inferenceMode: z.enum([
      "single-region",
      "geographic-cross-region",
      "global-cross-region",
    ]),
    plans: z
      .object({
        pro: z.array(stableIdSchema).min(1).max(32),
        starter: z.array(stableIdSchema).min(1).max(32),
      })
      .strict(),
    prerequisites: z
      .object({
        modelAccess: decisionSchema,
        quotas: decisionSchema,
        terms: decisionSchema,
      })
      .strict(),
    pricing: z
      .object({
        effectiveDate: z.iso.date(),
        sourceUrl: httpsUrlSchema,
        version: semverSchema,
      })
      .strict(),
    primaryRegion: awsRegionSchema,
    retention: z
      .object({
        applicationContent: z.literal("not-retained"),
        providerPolicyReference: stableIdSchema,
      })
      .strict(),
    routes: z
      .object({
        deep: bedrockRouteSchema,
        fallback: bedrockRouteSchema,
        lowCost: bedrockRouteSchema,
        repair: bedrockRouteSchema,
        standard: bedrockRouteSchema,
        strictStructuredOutput: bedrockRouteSchema,
      })
      .strict(),
    workerIam: z
      .object({
        actions: z
          .array(
            z.enum([
              "bedrock:InvokeModel",
              "bedrock:InvokeModelWithResponseStream",
            ]),
          )
          .min(1)
          .max(2),
        invocationResourceArns: z.array(awsArnSchema).min(1).max(64),
        roleArn: iamRoleArnSchema,
      })
      .strict(),
  })
  .strict();

const stripePlanMappingSchema = z
  .object({
    credits: z.number().int(),
    priceId: z.string().regex(/^price_[A-Za-z0-9]{8,}$/u),
    productId: z.string().regex(/^prod_[A-Za-z0-9]{8,}$/u),
  })
  .strict();

const stripeModeMappingSchema = z.discriminatedUnion("configured", [
  z.object({ configured: z.literal(false) }).strict(),
  z
    .object({
      configured: z.literal(true),
      pro: stripePlanMappingSchema,
      starter: stripePlanMappingSchema,
    })
    .strict(),
]);

const stripeConfigurationSchema = z
  .object({
    apiKey: secretReferenceSchema,
    browserPublishableKeyIdentifier: environmentVariableSchema.nullable(),
    businessDecisions: z
      .object({
        refund: decisionSchema,
        tax: decisionSchema,
        terms: decisionSchema,
      })
      .strict(),
    cancellationPolicy: z.enum([
      "period-end-default",
      "operator-approved-immediate",
    ]),
    cancelUrl: httpsUrlSchema,
    currency: z.string().regex(/^[A-Z]{3}$/u),
    enabled: z.boolean(),
    graceHours: z.number().int().min(0).max(720),
    mappingVersion: semverSchema,
    mode: z.enum(["test", "live"]),
    planMappings: z
      .object({ live: stripeModeMappingSchema, test: stripeModeMappingSchema })
      .strict(),
    portalReturnUrl: httpsUrlSchema,
    successUrl: httpsUrlSchema,
    trialPolicy: z.literal("no-trial"),
    webhookEndpointVersion: semverSchema,
    webhookSigningSecret: secretReferenceSchema,
    webhookSigningSecretPrevious: secretReferenceSchema.nullable(),
  })
  .strict();

const permissionLevelSchema = z.enum(["none", "read", "write"]);
const githubPermissionSetSchema = z
  .object({
    contents: permissionLevelSchema,
    metadata: permissionLevelSchema,
    pullRequests: permissionLevelSchema,
    workflows: permissionLevelSchema,
  })
  .strict();

const githubConfigurationSchema = z
  .object({
    appId: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    callbackUrl: httpsUrlSchema,
    clientId: z
      .string()
      .min(8)
      .max(64)
      .regex(/^[A-Za-z0-9_.-]+$/u),
    clientSecret: secretReferenceSchema,
    export: z
      .object({ enabled: z.boolean(), permissions: githubPermissionSetSchema })
      .strict(),
    import: z
      .object({ enabled: z.boolean(), permissions: githubPermissionSetSchema })
      .strict(),
    privateKey: secretReferenceSchema,
    setupUrl: httpsUrlSchema,
    webhookSecret: secretReferenceSchema,
    webhookUrl: httpsUrlSchema,
    workflowExport: z
      .object({ enabled: z.boolean(), permissions: githubPermissionSetSchema })
      .strict(),
  })
  .strict();

const repositorySyncConfigurationSchema = z
  .object({
    allowedOrganizations: z.array(z.string().min(1).max(100)).min(1).max(64),
    allowedRepositories: z
      .array(z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u))
      .min(1)
      .max(256),
    branchPolicy: z
      .object({
        allowDefaultBranchDiscovery: z.boolean(),
        allowedBranches: z.array(z.string().min(1).max(160)).min(1).max(64),
        requireExactCommit: z.literal(true),
      })
      .strict(),
    importLimits: z
      .object({
        allowedFileExtensions: z
          .array(z.string().regex(/^\.[a-z0-9.]+$/u))
          .min(1)
          .max(64),
        maxFileBytes: z
          .number()
          .int()
          .min(1)
          .max(8 * 1024 * 1024),
        maxFiles: z.number().int().min(1).max(4_096),
        maxPathBytes: z.number().int().min(1).max(240),
        maxSelectedPaths: z.number().int().min(1).max(128),
        maxTotalBytes: z
          .number()
          .int()
          .min(1)
          .max(128 * 1024 * 1024),
        maxTreeEntries: z.number().int().min(1).max(20_000),
      })
      .strict(),
    privateContentCache: z.literal("tenant-isolated-no-cross-tenant"),
    redaction: z.literal("required-before-storage-or-model"),
    retentionHours: z.number().int().min(1).max(24),
    webhookRefreshEvents: z
      .array(z.enum(["push"]))
      .min(1)
      .max(1),
  })
  .strict();

const customerCiRoleSchema = z
  .object({
    roleArn: iamRoleArnSchema,
    trustPolicyEvidenceReference: stableIdSchema,
  })
  .strict();

const customerCiCdConfigurationSchema = z
  .object({
    attestation: z
      .object({
        artifactSigning: z.enum(["required", "extension-point-disabled"]),
        provenance: z.literal("required"),
      })
      .strict(),
    backend: z
      .object({
        bucket: z
          .string()
          .min(3)
          .max(63)
          .regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/u),
        encryption: z.literal("required"),
        keyPrefix: z.string().min(1).max(512),
        kmsKeyArn: awsArnSchema.regex(/:kms:[a-z0-9-]+:\d{12}:key\//u),
        locking: z.literal("s3-native-lockfile"),
        region: awsRegionSchema,
        useLockfile: z.literal(true),
        workspaceKeyPrefix: z.string().min(1).max(128),
      })
      .strict(),
    deployment: z
      .object({
        concurrency: z.number().int().min(1).max(4),
        windows: z.array(z.string().min(3).max(160)).min(1).max(16),
      })
      .strict(),
    drift: z
      .object({
        issueRouting: z.string().min(3).max(160),
        schedule: z
          .string()
          .regex(
            /^(?:0?[0-9]|[1-5][0-9]) (?:0?[0-9]|1[0-9]|2[0-3]) \* \* [0-6]$/u,
          ),
      })
      .strict(),
    github: z
      .object({
        environments: z
          .array(
            z
              .object({
                allowedBranches: z
                  .array(z.string().min(1).max(160))
                  .min(1)
                  .max(16),
                name: z.string().min(1).max(64),
                protected: z.boolean(),
                requiredReviewers: z.number().int().min(0).max(6),
              })
              .strict(),
          )
          .min(1)
          .max(3),
      })
      .strict(),
    oidc: z
      .object({
        providerArn: awsArnSchema.regex(/:iam::\d{12}:oidc-provider\//u),
        repository: z
          .object({
            id: z.string().regex(/^[1-9][0-9]{0,19}$/u),
            name: z.string().min(1).max(100),
            owner: z.string().min(1).max(100),
            ownerId: z.string().regex(/^[1-9][0-9]{0,19}$/u),
          })
          .strict(),
        subjectMode: z.literal("immutable-owner-and-repository-ids"),
        subjectPrefix: z.string().min(20).max(384),
      })
      .strict(),
    plan: z
      .object({
        artifactRetentionDays: z.number().int().min(1).max(30),
        exactApprovedPlanRequired: z.literal(true),
        expiresAfterMinutes: z.number().int().min(15).max(1_440),
      })
      .strict(),
    roles: z
      .object({
        deploy: customerCiRoleSchema,
        drift: customerCiRoleSchema,
        ephemeral: customerCiRoleSchema.nullable(),
        plan: customerCiRoleSchema,
      })
      .strict(),
    rollbackPolicy: z.literal(
      "application-specific-reviewed-rollback-or-forward-fix",
    ),
    smokeEndpoints: z.array(httpsUrlSchema).min(1).max(16),
    target: z
      .object({ accountId: awsAccountIdSchema, region: awsRegionSchema })
      .strict(),
  })
  .strict();

const platformLimitsSchema = z
  .object({
    alarms: z.array(stableIdSchema).min(1).max(128),
    approvers: z.array(z.string().min(2).max(160)).min(1).max(32),
    budgets: z
      .object({
        monthlyPlatformUsd: z.number().positive().max(10_000_000),
        notificationThresholdPercent: z.number().int().min(1).max(100),
      })
      .strict(),
    concurrency: z
      .object({
        applicationBuilds: z.number().int().min(1).max(10),
        modelInvocations: z.number().int().min(1).max(100),
        terraformValidation: z.number().int().min(1).max(10),
      })
      .strict(),
    incidents: z
      .object({
        escalationReference: stableIdSchema,
        rpoHours: z.number().int().min(0).max(168).nullable(),
        rtoHours: z.number().int().min(0).max(168).nullable(),
        recoveryDecision: decisionSchema,
      })
      .strict(),
    resources: z
      .object({
        maxArchitectureNodes: z.number().int().min(1).max(500),
        maxExportBytes: z
          .number()
          .int()
          .min(1)
          .max(256 * 1024 * 1024),
        maxFilesPerExport: z.number().int().min(1).max(20_000),
        maxModelInputBytes: z
          .number()
          .int()
          .min(1)
          .max(4 * 1024 * 1024),
        maxModelOutputBytes: z
          .number()
          .int()
          .min(1)
          .max(2 * 1024 * 1024),
        maxPlanResources: z.number().int().min(1).max(2_000),
        maxProjectsPerOrganization: z.number().int().min(1).max(10_000),
        maxRepositoriesPerOrganization: z.number().int().min(1).max(256),
        maxRepairAttempts: z.number().int().min(0).max(2),
        maxWorkloadOperations: z.number().int().min(1).max(128),
      })
      .strict(),
    waf: z
      .object({
        apiRequestsPerFiveMinutes: z.number().int().min(10).max(2_000_000_000),
        enabled: z.boolean(),
        webhookRequestsPerFiveMinutes: z
          .number()
          .int()
          .min(10)
          .max(2_000_000_000),
      })
      .strict(),
  })
  .strict();

const featureFlagsSchema = z
  .object({
    ai: z.boolean(),
    aiCustomGeneration: z.boolean(),
    applicationBuild: z.boolean(),
    beta: z.boolean(),
    billing: z.boolean(),
    cloudFormation: z.boolean(),
    customerDeploy: z.boolean(),
    customerDrift: z.boolean(),
    customerPlan: z.boolean(),
    githubExport: z.boolean(),
    repositoryImport: z.boolean(),
    scanners: z.boolean(),
    terraform: z.boolean(),
    workflowExport: z.boolean(),
  })
  .strict();

const optionalProviderConfigurationSchema = z
  .object({
    adapters: z
      .array(
        z
          .object({
            approval: decisionSchema,
            enabled: z.literal(true),
            providerId: stableIdSchema.refine(
              (value) => value !== "cloudmarkup.amazon-bedrock",
              "Amazon Bedrock is configured through the primary runtime boundary.",
            ),
            secret: secretReferenceSchema,
          })
          .strict(),
      )
      .max(4),
    enabled: z.boolean(),
  })
  .strict();

export const deploymentInputsV1StructuralSchema = z
  .object({
    aws: awsConfigurationSchema,
    cognito: cognitoConfigurationSchema,
    contacts: z
      .object({
        account: contactSchema,
        billing: contactSchema,
        privacy: contactSchema,
        security: contactSchema,
        support: contactSchema,
        terms: contactSchema,
      })
      .strict(),
    customerCiCd: customerCiCdConfigurationSchema,
    data: dataConfigurationSchema,
    domains: domainConfigurationSchema,
    environment: z
      .object({
        name: z.enum(["beta", "dev", "staging", "prod"]),
        stage: z.enum(["beta", "development", "staging", "production"]),
      })
      .strict(),
    features: featureFlagsSchema,
    github: githubConfigurationSchema,
    modelRuntime: z
      .object({
        amazonBedrock: bedrockConfigurationSchema,
        optionalProviders: optionalProviderConfigurationSchema,
        providerBoundary: z.literal("provider-neutral-model-gateway-v1"),
      })
      .strict(),
    platformLimits: platformLimitsSchema,
    repositorySync: repositorySyncConfigurationSchema,
    schemaVersion: z.literal(DEPLOYMENT_INPUTS_SCHEMA_VERSION),
    stripe: stripeConfigurationSchema,
  })
  .strict();

export function platformDeploymentOidcProviderArnV1(
  partition: "aws" | "aws-cn" | "aws-us-gov",
  accountId: string,
): string {
  return `arn:${partition}:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com`;
}

export function platformDeploymentOidcSubjectV1(
  owner: string,
  ownerId: string,
  repository: string,
  repositoryId: string,
  githubEnvironment: string,
): string {
  return `repo:${owner}@${ownerId}/${repository}@${repositoryId}:environment:${githubEnvironment}`;
}

export const deploymentInputsV1Schema =
  deploymentInputsV1StructuralSchema.superRefine((data, context) => {
    const platformDeployment = data.aws.platformDeployment;
    if (
      platformDeployment.oidcProviderArn !==
      platformDeploymentOidcProviderArnV1(
        data.aws.partition,
        data.aws.accountId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Platform deployment must use the exact GitHub Actions OIDC provider in the platform account.",
        path: ["aws", "platformDeployment", "oidcProviderArn"],
      });
    }
    const repository = platformDeployment.repository;
    if (
      platformDeployment.subject !==
      platformDeploymentOidcSubjectV1(
        repository.owner,
        repository.ownerId,
        repository.name,
        repository.id,
        platformDeployment.githubEnvironment,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Platform deployment OIDC subject must exactly bind immutable owner and repository IDs plus the reviewed GitHub Environment.",
        path: ["aws", "platformDeployment", "subject"],
      });
    }
  });

export type DeploymentInputsV1 = z.output<typeof deploymentInputsV1Schema>;
