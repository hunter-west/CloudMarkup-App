import type {
  EnvironmentName,
  EnvironmentTarget,
} from "./config/environment-config.js";

export interface PlatformResourceNames {
  readonly accessLogBucket: string;
  readonly alarmTopic: string;
  readonly api: string;
  readonly apiAccessLogGroup: string;
  readonly apiFunction: string;
  readonly apiFunctionLogGroup: string;
  readonly applicationBuildLogGroup: string;
  readonly applicationBuildProject: string;
  readonly artifactPrefix: string;
  readonly billingWebhookFunction: string;
  readonly billingWebhookLogGroup: string;
  readonly contentBucket: string;
  readonly databaseCluster: string;
  readonly databaseMigratorFunction: string;
  readonly databaseMigratorLogGroup: string;
  readonly databaseSecret: string;
  readonly deadLetterQueue: string;
  readonly documentPrefix: string;
  readonly evidencePrefix: string;
  readonly edgeOriginVerificationSecret: string;
  readonly jobQueue: string;
  readonly jobStateMachine: string;
  readonly jobStateMachineLogGroup: string;
  readonly jobWorkerFunction: string;
  readonly jobWorkerLogGroup: string;
  readonly terraformValidationLogGroup: string;
  readonly terraformValidationProject: string;
  readonly prefix: string;
  readonly userPool: string;
  readonly userPoolClient: string;
  readonly userPoolDomainPrefix: string;
  readonly webAssetsBucket: string;
}

export function createPlatformResourceNames(
  environment: EnvironmentName,
  target: EnvironmentTarget,
): PlatformResourceNames {
  const prefix = `cloudmarkup-${environment}`;
  const globallyUniqueSuffix = `${target.account}-${target.region}`;
  return {
    accessLogBucket: `${prefix}-${globallyUniqueSuffix}-access-logs`,
    alarmTopic: `${prefix}-alarms`,
    api: `${prefix}-api`,
    apiAccessLogGroup: `/aws/apigateway/${prefix}-api`,
    apiFunction: `${prefix}-api`,
    apiFunctionLogGroup: `/aws/lambda/${prefix}-api`,
    applicationBuildLogGroup: `/aws/codebuild/${prefix}-application-build`,
    applicationBuildProject: `${prefix}-application-build`,
    artifactPrefix: "artifacts/v1/organizations/",
    billingWebhookFunction: `${prefix}-billing-webhook`,
    billingWebhookLogGroup: `/aws/lambda/${prefix}-billing-webhook`,
    contentBucket: `${prefix}-${globallyUniqueSuffix}-content`,
    databaseCluster: `${prefix}-postgresql`,
    databaseMigratorFunction: `${prefix}-database-migrator`,
    databaseMigratorLogGroup: `/aws/lambda/${prefix}-database-migrator`,
    databaseSecret: `${prefix}/database/admin`,
    deadLetterQueue: `${prefix}-jobs-dlq.fifo`,
    documentPrefix: "documents/v1/organizations/",
    evidencePrefix: "evidence/v1/organizations/",
    edgeOriginVerificationSecret: `${prefix}/edge/origin-verification`,
    jobQueue: `${prefix}-jobs.fifo`,
    jobStateMachine: `${prefix}-jobs`,
    jobStateMachineLogGroup: `/aws/vendedlogs/states/${prefix}-jobs`,
    jobWorkerFunction: `${prefix}-job-worker`,
    jobWorkerLogGroup: `/aws/lambda/${prefix}-job-worker`,
    terraformValidationLogGroup: `/aws/codebuild/${prefix}-terraform-validation`,
    terraformValidationProject: `${prefix}-terraform-validation`,
    prefix,
    userPool: `${prefix}-users`,
    userPoolClient: `${prefix}-web`,
    userPoolDomainPrefix: `${prefix}-${target.account}`,
    webAssetsBucket: `${prefix}-${globallyUniqueSuffix}-web`,
  };
}
