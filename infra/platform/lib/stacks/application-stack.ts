import { cloudMarkupManagedLoginBranding } from "../cognito-branding.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CfnOutput,
  CustomResource,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_apigateway as apigateway,
  aws_cognito as cognito,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_event_sources as lambdaEvents,
  aws_lambda_nodejs as lambdaNodejs,
  aws_secretsmanager as secretsmanager,
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as sfnTasks,
  aws_sqs as sqs,
  aws_wafv2 as wafv2,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

import { BETA_CDK_BOOTSTRAP } from "../beta-deployment-bootstrap.js";
import { BetaProposalDelivery } from "../constructs/beta-proposal-delivery.js";
import { SolutionExportDelivery } from "../constructs/solution-export-delivery.js";
import { createBetaApiRuntimeCode } from "../beta-api-runtime-asset.js";
import { createRepositoryImportParserLayer } from "../repository-import-parser-asset.js";
import type { EnvironmentConfig } from "../config/environment-config.js";
import {
  EDGE_ORIGIN_HEADER_NAME,
  edgeOriginEnvironment,
} from "../edge-origin-contract.js";
import type { PlatformResourceNames } from "../platform-names.js";
import { ApplicationBuildProject } from "../constructs/application-build-project.js";
import { SharedBuildServiceEndpoints } from "../constructs/shared-build-service-endpoints.js";
import { SandboxBillingDelivery } from "../constructs/sandbox-billing-delivery.js";
import { ProjectContentCleanup } from "../constructs/project-content-cleanup.js";
import { ProjectCleanupWake } from "../constructs/project-cleanup-wake.js";
import { TerraformValidationProject } from "../constructs/terraform-validation-project.js";
import type { ObservabilityStack } from "./observability-stack.js";
import type { StatefulStack } from "./stateful-stack.js";

export const DATABASE_MIGRATION_EXPECTED_VERSION = "0138";
export const DATABASE_MIGRATION_MANIFEST_SHA256 =
  "bc316cae6997880786ecf27fee40f43f997669cfd521356dc942adca9d849a16";

const API_GATEWAY_SECURITY_RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "'no-store'",
  "Content-Security-Policy":
    "'default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none''",
  "Content-Type": "'application/json; charset=UTF-8'",
  "Cross-Origin-Opener-Policy": "'same-origin'",
  "Cross-Origin-Resource-Policy": "'same-origin'",
  "Permissions-Policy":
    "'camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), publickey-credentials-get=(), usb=()'",
  "Referrer-Policy": "'no-referrer'",
  "Strict-Transport-Security": "'max-age=63072000; includeSubDomains; preload'",
  "X-Content-Type-Options": "'nosniff'",
  "X-Frame-Options": "'DENY'",
});

function gatewayErrorTemplate(
  code: "access_denied" | "authentication_required",
  message: string,
): string {
  return JSON.stringify({
    apiVersion: "v1",
    error: {
      code,
      correlationId: "$context.requestId",
      message,
    },
  });
}

function checkedMigrationManifest(): string {
  const manifest = readFileSync(
    fileURLToPath(
      new URL("../../../../apps/api/migrations/manifest.json", import.meta.url),
    ),
  );
  const source = manifest.toString("utf8");
  const digest = createHash("sha256").update(manifest).digest("hex");
  if (digest !== DATABASE_MIGRATION_MANIFEST_SHA256) {
    throw new TypeError(
      "The database migration manifest changed without updating the reviewed deployment checksum.",
    );
  }
  const parsed = JSON.parse(source) as {
    readonly migrations?: readonly { readonly version?: string }[];
  };
  if (`${JSON.stringify(parsed, null, 2)}\n` !== source) {
    throw new TypeError(
      "The database migration manifest must use the reviewed canonical JSON encoding.",
    );
  }
  if (
    parsed.migrations?.at(-1)?.version !== DATABASE_MIGRATION_EXPECTED_VERSION
  ) {
    throw new TypeError(
      "The database migration manifest does not end at the reviewed schema version.",
    );
  }
  return source;
}

export interface ApplicationStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly names: PlatformResourceNames;
  readonly observability: ObservabilityStack;
  readonly stateful: StatefulStack;
}

function featureEnvironment(
  config: EnvironmentConfig,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(config.features).map(([name, enabled]) => [
      `CLOUDMARKUP_FEATURE_${name.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}`,
      String(enabled),
    ]),
  );
}

/**
 * Product ingress and asynchronous delivery primitives. The API bundle is the
 * current fail-closed modular-monolith shell. The billing ingress verifies raw
 * test-mode Stripe requests and enqueues only a normalized safe envelope; the
 * queue processor remains a separately reviewed composition boundary.
 */
export class ApplicationStack extends Stack {
  public readonly api: apigateway.RestApi;
  public readonly apiStage: apigateway.Stage;
  public readonly apiFunction: lambda.Function;
  public readonly applicationBuild?: ApplicationBuildProject;
  public readonly buildServiceEndpoints?: SharedBuildServiceEndpoints;
  public readonly billingWebhookDeadLetterQueue?: sqs.Queue;
  public readonly billingWebhookFunction?: lambda.Function;
  public readonly billingWebhookQueue?: sqs.Queue;
  public readonly billingWorkerFunction?: lambda.Function;
  public readonly solutionExportDelivery?: SolutionExportDelivery;
  public readonly projectCleanupFunction?: lambda.Function;
  public readonly databaseMigratorFunction: lambda.Function;
  public readonly jobQueue?: sqs.Queue;
  public readonly jobStateMachine?: sfn.StateMachine;
  public readonly jobWorkerFunction?: lambda.Function;
  public readonly terraformValidation?: TerraformValidationProject;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  public constructor(
    scope: Construct,
    id: string,
    props: ApplicationStackProps,
  ) {
    super(scope, id, props);

    const removalPolicy =
      props.config.lifecycle.removalPolicy === "retain"
        ? RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE
        : RemovalPolicy.DESTROY;
    const edgeOriginVerification =
      props.stateful.edgeOriginVerificationSecret.secretValue.unsafeUnwrap();
    const databaseSecret = props.stateful.cluster.secret;
    if (databaseSecret === undefined) {
      throw new TypeError("The platform database must own a generated secret.");
    }
    const firstBeta = props.config.environment === "beta";
    const runtimeRoles = firstBeta
      ? {
          apiFunction: iam.Role.fromRoleArn(
            this,
            "BetaApiRuntimeRole",
            this.formatArn({
              region: "",
              resource: "role",
              resourceName: BETA_CDK_BOOTSTRAP.apiRuntimeRoleName,
              service: "iam",
            }),
            { mutable: false },
          ),
          databaseMigratorFunction: iam.Role.fromRoleArn(
            this,
            "BetaDatabaseMigratorRuntimeRole",
            this.formatArn({
              region: "",
              resource: "role",
              resourceName: BETA_CDK_BOOTSTRAP.databaseMigratorRuntimeRoleName,
              service: "iam",
            }),
            { mutable: false },
          ),
        }
      : undefined;
    if (!firstBeta) {
      const buildVpc = props.stateful.vpc;
      this.buildServiceEndpoints = new SharedBuildServiceEndpoints(
        this,
        "BuildServiceEndpoints",
        { vpc: buildVpc },
      );
      this.applicationBuild = new ApplicationBuildProject(
        this,
        "ApplicationBuild",
        {
          config: props.config,
          names: props.names,
          observability: props.observability,
          serviceEndpoints: this.buildServiceEndpoints,
          stateful: props.stateful,
        },
      );
      this.terraformValidation = new TerraformValidationProject(
        this,
        "TerraformValidation",
        {
          config: props.config,
          names: props.names,
          observability: props.observability,
          serviceEndpoints: this.buildServiceEndpoints,
          stateful: props.stateful,
        },
      );
    }

    const accountAccess = props.config.accountAccess ?? {
      schemaVersion: 1,
      managedLogin: false,
      registrationEnabled: false,
    };
    this.userPool = new cognito.UserPool(this, "Users", {
      ...(accountAccess.managedLogin
        ? { featurePlan: cognito.FeaturePlan.ESSENTIALS }
        : {}),
      keepOriginal: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,

      autoVerify: { email: true },
      deletionProtection:
        props.config.environment === "beta"
          ? false
          : props.config.lifecycle.deletionProtection,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: {
        minLength: 14,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true,
        tempPasswordValidity: Duration.days(3),
      },
      removalPolicy,
      selfSignUpEnabled: accountAccess.registrationEnabled,
      signInAliases: { email: true },
      userPoolName: props.names.userPool,
    });
    this.userPoolDomain = this.userPool.addDomain("HostedDomain", {
      cognitoDomain: {
        domainPrefix: props.names.userPoolDomainPrefix,
      },
      managedLoginVersion: accountAccess.managedLogin
        ? cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN
        : cognito.ManagedLoginVersion.CLASSIC_HOSTED_UI,
    });
    const apiScope = new cognito.ResourceServerScope({
      scopeDescription: "Access the CloudMarkup product API",
      scopeName: "access",
    });
    const resourceServer = this.userPool.addResourceServer(
      "ApiResourceServer",
      {
        identifier: "cloudmarkup-api",
        scopes: [apiScope],
      },
    );
    const webOrigin =
      props.config.domain === undefined
        ? "http://localhost:5173"
        : `https://${props.config.domain.domainName}`;
    this.userPoolClient = this.userPool.addClient("WebClient", {
      accessTokenValidity: Duration.minutes(30),
      authFlows: { userSrp: true },
      enableTokenRevocation: true,
      generateSecret: false,
      idTokenValidity: Duration.minutes(30),
      oAuth: {
        callbackUrls: [`${webOrigin}/auth/callback`],
        flows: { authorizationCodeGrant: true },
        logoutUrls: [webOrigin],
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.resourceServer(resourceServer, apiScope),
          ...(accountAccess.managedLogin
            ? [cognito.OAuthScope.COGNITO_ADMIN]
            : []),
        ],
      },
      preventUserExistenceErrors: true,
      refreshTokenValidity: Duration.days(7),
      userPoolClientName: props.names.userPoolClient,
    });

    if (accountAccess.managedLogin) {
      const branding = new cognito.CfnManagedLoginBranding(
        this,
        "AccountLoginBranding",
        {
          userPoolId: this.userPool.userPoolId,
          clientId: this.userPoolClient.userPoolClientId,
          ...cloudMarkupManagedLoginBranding(),
        },
      );
      branding.node.addDependency(this.userPoolDomain);
    }

    const ownedApiRole =
      runtimeRoles === undefined
        ? this.lambdaRole(
            "ApiExecutionRole",
            props.observability.apiFunctionLogGroup.logGroupArn,
          )
        : undefined;
    const apiRole = runtimeRoles?.apiFunction ?? ownedApiRole;
    const ownedMigrationRole =
      runtimeRoles === undefined
        ? this.lambdaLogRole(
            "DatabaseMigratorExecutionRole",
            props.observability.databaseMigratorLogGroup.logGroupArn,
          )
        : undefined;
    const migrationRole =
      runtimeRoles?.databaseMigratorFunction ?? ownedMigrationRole;
    if (apiRole === undefined || migrationRole === undefined) {
      throw new TypeError("Application runtime roles could not be resolved.");
    }
    if (ownedMigrationRole !== undefined) {
      ownedMigrationRole.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "rds-data:BeginTransaction",
            "rds-data:CommitTransaction",
            "rds-data:ExecuteStatement",
            "rds-data:RollbackTransaction",
          ],
          resources: [props.stateful.cluster.clusterArn],
        }),
      );
      ownedMigrationRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [databaseSecret.secretArn],
        }),
      );
    }
    checkedMigrationManifest();
    this.databaseMigratorFunction = new lambdaNodejs.NodejsFunction(
      this,
      "DatabaseMigratorFunction",
      {
        architecture: lambda.Architecture.ARM_64,
        bundling: {
          format: lambdaNodejs.OutputFormat.CJS,
          loader: { ".sql": "text" },
          minify: false,
          sourceMap: true,
          target: "node24",
        },
        entry: fileURLToPath(
          new URL("../../runtime/database-migrator.ts", import.meta.url),
        ),
        environment: {
          CLOUDMARKUP_DATABASE_ARN: props.stateful.cluster.clusterArn,
          CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
          CLOUDMARKUP_DATABASE_SECRET_ARN: databaseSecret.secretArn,
          CLOUDMARKUP_MIGRATION_EXPECTED_VERSION:
            DATABASE_MIGRATION_EXPECTED_VERSION,
          CLOUDMARKUP_MIGRATION_MANIFEST_SHA256:
            DATABASE_MIGRATION_MANIFEST_SHA256,
          NODE_OPTIONS: "--enable-source-maps",
        },
        functionName: props.names.databaseMigratorFunction,
        handler: "handler",
        logGroup: props.observability.databaseMigratorLogGroup,
        memorySize: 512,
        reservedConcurrentExecutions: 1,
        role: migrationRole,
        runtime: lambda.Runtime.NODEJS_24_X,
        timeout: Duration.minutes(15),
      },
    );
    this.databaseMigratorFunction.addPermission(
      "CloudFormationCustomResourceInvocation",
      {
        principal: new iam.ServicePrincipal("cloudformation.amazonaws.com"),
        sourceAccount: this.account,
        sourceArn: this.formatArn({
          resource: "stack",
          resourceName: `${this.stackName}/*`,
          service: "cloudformation",
        }),
      },
    );
    const databaseMigration = new CustomResource(this, "DatabaseMigration", {
      properties: {
        ExpectedSchemaVersion: DATABASE_MIGRATION_EXPECTED_VERSION,
        ManifestSha256: DATABASE_MIGRATION_MANIFEST_SHA256,
      },
      serviceToken: this.databaseMigratorFunction.functionArn,
    });

    if (props.config.integrations.solutionExport?.enabled === true) {
      const logGroup = props.observability.solutionExportWorkerLogGroup;
      if (logGroup === undefined)
        throw new TypeError(
          "Restricted export logs must exist before the application stack.",
        );
      this.solutionExportDelivery = new SolutionExportDelivery(
        this,
        "SolutionExport",
        {
          config: props.config,
          databaseArn: props.stateful.cluster.clusterArn,
          databaseSecretArn: databaseSecret.secretArn,
          contentBucketName: props.stateful.contentBucket.bucketName,
          logGroup,
        },
      );
      this.solutionExportDelivery.workerFunction.node.addDependency(
        databaseMigration,
      );
      new CfnOutput(this, "SolutionExportDelivery", {
        description: "Versioned restricted infrastructure export composition.",
        value: "cloudformation-export-v1",
      });
    }
    const betaProposals =
      firstBeta && props.config.integrations.solutionExport?.enabled
        ? new BetaProposalDelivery(this, "BetaProposals", {
            databaseArn: props.stateful.cluster.clusterArn,
            databaseSecretArn: databaseSecret.secretArn,
            contentBucketName: props.stateful.contentBucket.bucketName,
            documentPrefix: props.names.documentPrefix,
            logGroup: props.observability.jobWorkerLogGroup,
            tags: props.config.tags,
          })
        : undefined;
    betaProposals?.workerFunction.node.addDependency(databaseMigration);
    const repositoryParser =
      firstBeta && props.config.integrations.github.connectionsEnabled
        ? createRepositoryImportParserLayer(this)
        : undefined;
    this.apiFunction = new lambdaNodejs.NodejsFunction(this, "ApiFunction", {
      ...(firstBeta ? { code: createBetaApiRuntimeCode() } : {}),
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        format: lambdaNodejs.OutputFormat.CJS,
        minify: false,
        sourceMap: true,
        // Retain stack mappings without duplicating every source body in Lambda.
        sourcesContent: false,
        target: "node24",
      },
      entry: fileURLToPath(
        new URL(
          firstBeta
            ? "../../../../apps/api/src/production-lambda.ts"
            : "../../../../apps/api/src/lambda.ts",
          import.meta.url,
        ),
      ),
      environment: {
        ...edgeOriginEnvironment(edgeOriginVerification),
        ...(betaProposals?.environment ?? {}),
        CLOUDMARKUP_BETA_AI_ENABLED:
          firstBeta && props.config.integrations.solutionExport?.enabled
            ? "true"
            : "false",
        CLOUDMARKUP_CONTENT_BUCKET: props.stateful.contentBucket.bucketName,
        CLOUDMARKUP_DATABASE_ARN: props.stateful.cluster.clusterArn,
        CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
        CLOUDMARKUP_DATABASE_SECRET_ARN: databaseSecret.secretArn,
        CLOUDMARKUP_ENVIRONMENT: props.config.environment,
        ...(props.config.integrations.stripe.deliveryEnabled
          ? {
              CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION:
                props.config.integrations.stripe.planMappingVersion,
            }
          : {}),
        ...(props.config.integrations.stripe.sessionsEnabled
          ? {
              CLOUDMARKUP_BILLING_SESSIONS_ENABLED: "true",
              CLOUDMARKUP_BILLING_ENABLED: "true",
              CLOUDMARKUP_STRIPE_ENVIRONMENT:
                props.config.integrations.stripe.environment,
              ...(props.config.integrations.stripe.environment === "live"
                ? { CLOUDMARKUP_CREDIT_TOP_UPS_ENABLED: "true" }
                : {}),
              CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN:
                props.config.integrations.stripe.apiKeySecretArn ?? "",
              CLOUDMARKUP_STRIPE_PORTAL_CONFIGURATION_REFERENCE:
                props.config.integrations.stripe.portalConfigurationId ?? "",
            }
          : {}),
        ...(repositoryParser?.environment ?? {}),
        ...(this.solutionExportDelivery?.environment ?? {}),
        CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: String(
          props.config.integrations.github.connectionsEnabled,
        ),
        ...(props.config.integrations.github.connectionsEnabled
          ? {
              CLOUDMARKUP_GITHUB_APP_ID:
                props.config.integrations.github.appId ?? "",
              CLOUDMARKUP_GITHUB_APP_SLUG:
                props.config.integrations.github.appSlug ?? "",
              CLOUDMARKUP_GITHUB_CLIENT_ID:
                props.config.integrations.github.clientId ?? "",
              CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_ARN:
                props.config.integrations.github.privateKeySecretArn ?? "",
              CLOUDMARKUP_GITHUB_CLIENT_SECRET_ARN:
                props.config.integrations.github.clientSecretArn ?? "",
              ...(props.config.integrations.github.clientSecretJsonField ===
              undefined
                ? {}
                : {
                    CLOUDMARKUP_GITHUB_CLIENT_SECRET_JSON_FIELD:
                      props.config.integrations.github.clientSecretJsonField,
                  }),
            }
          : {}),
        ...(firstBeta
          ? {
              CLOUDMARKUP_EXPECTED_SCHEMA_VERSION:
                DATABASE_MIGRATION_EXPECTED_VERSION,
              CLOUDMARKUP_RUNTIME_COMPOSITION: "production-v1",
            }
          : { CLOUDMARKUP_DEPLOYMENT_SHELL: "true" }),
        ...(props.config.features.githubExport
          ? {
              CLOUDMARKUP_GITHUB_APP_ID:
                props.config.integrations.github.appId ?? "",
              CLOUDMARKUP_GITHUB_WEBHOOK_SECRET_NAME:
                props.config.integrations.github.webhookSecretName,
            }
          : {}),
        CLOUDMARKUP_OBJECT_ARTIFACT_PREFIX: props.names.artifactPrefix,
        CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX: props.names.documentPrefix,
        CLOUDMARKUP_OBJECT_EVIDENCE_PREFIX: props.names.evidencePrefix,
        CLOUDMARKUP_ACCOUNT_ACCESS: this.toJsonString(accountAccess),
        CLOUDMARKUP_ACCOUNT_SECURITY: this.toJsonString(
          props.config.accountSecurity ?? {
            schemaVersion: 1,
            recoveryContact: null,
          },
        ),
        CLOUDMARKUP_PUBLIC_RUNTIME_CONFIG: this.toJsonString({
          authentication: {
            callbackUrl: `${webOrigin}/auth/callback`,
            clientId: this.userPoolClient.userPoolClientId,
            domain: this.userPoolDomain.baseUrl(),
            logoutUrl: webOrigin,
            provider: "cognito",
            scopes: ["openid", "profile", "cloudmarkup-api/access"],
          },
          schemaVersion: 1,
        }),
        COGNITO_APP_CLIENT_ID: this.userPoolClient.userPoolClientId,
        COGNITO_ISSUER: this.userPool.userPoolProviderUrl,
        COGNITO_REQUIRED_SCOPE: "cloudmarkup-api/access",
        COGNITO_USER_POOL_ID: this.userPool.userPoolId,
        NODE_OPTIONS: "--enable-source-maps",
        // Production reads the explicit activation settings above. The generic
        // deployment-shell metadata is redundant and exceeds Lambda's 4 KiB budget.
        ...(firstBeta ? {} : featureEnvironment(props.config)),
      },
      functionName: props.names.apiFunction,
      handler: firstBeta ? "index.handler" : "handler",
      logGroup: props.observability.apiFunctionLogGroup,
      memorySize: 1_024,
      reservedConcurrentExecutions: props.config.limits.apiConcurrency,
      role: apiRole,
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: Duration.seconds(props.config.limits.apiTimeoutSeconds),
      tracing: lambda.Tracing.ACTIVE,
    });
    if (repositoryParser !== undefined)
      this.apiFunction.addLayers(repositoryParser.layer);
    if (this.solutionExportDelivery !== undefined)
      this.apiFunction.addLayers(this.solutionExportDelivery.layer);
    this.apiFunction.node.addDependency(databaseMigration);
    // New proposal/source versions must reach capable workers before API
    // composition advertises support or admits browser submissions.
    if (betaProposals !== undefined)
      this.apiFunction.node.addDependency(betaProposals.workerFunction);
    if (this.solutionExportDelivery !== undefined)
      this.apiFunction.node.addDependency(
        this.solutionExportDelivery.workerFunction,
      );

    if (ownedApiRole !== undefined) {
      if (props.config.integrations.github.connectionsEnabled) {
        ownedApiRole.addToPolicy(
          new iam.PolicyStatement({
            actions: ["secretsmanager:GetSecretValue"],
            conditions: {
              StringEquals: { "secretsmanager:VersionStage": "AWSCURRENT" },
            },
            resources: [
              props.config.integrations.github.privateKeySecretArn ?? "",
              props.config.integrations.github.clientSecretArn ?? "",
            ],
          }),
        );
      }
      this.addApplicationDataPermissions(
        ownedApiRole,
        props,
        databaseSecret.secretArn,
      );
    }
    if (!firstBeta) {
      const billingRole = this.lambdaRole(
        "BillingWebhookExecutionRole",
        props.observability.billingWebhookLogGroup.logGroupArn,
      );
      const workerRole = this.lambdaRole(
        "JobWorkerExecutionRole",
        props.observability.jobWorkerLogGroup.logGroupArn,
      );
      this.billingWebhookDeadLetterQueue = new sqs.Queue(
        this,
        "BillingWebhookDeadLetterQueue",
        {
          enforceSSL: true,
          encryption: sqs.QueueEncryption.SQS_MANAGED,
          fifo: true,
          queueName: `${props.names.prefix}-billing-webhook-dlq.fifo`,
          removalPolicy,
          retentionPeriod: Duration.days(14),
        },
      );
      this.billingWebhookQueue = new sqs.Queue(this, "BillingWebhookQueue", {
        contentBasedDeduplication: false,
        deadLetterQueue: {
          maxReceiveCount: props.config.limits.jobMaxReceiveCount,
          queue: this.billingWebhookDeadLetterQueue,
        },
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        fifo: true,
        queueName: `${props.names.prefix}-billing-webhook.fifo`,
        removalPolicy,
        retentionPeriod: Duration.days(14),
        visibilityTimeout: Duration.seconds(120),
      });

      this.billingWebhookFunction = new lambdaNodejs.NodejsFunction(
        this,
        "BillingWebhookFunction",
        {
          architecture: lambda.Architecture.ARM_64,
          bundling: {
            format: lambdaNodejs.OutputFormat.CJS,
            minify: false,
            sourceMap: true,
            target: "node24",
          },
          entry: fileURLToPath(
            new URL("../../runtime/billing-webhook.ts", import.meta.url),
          ),
          environment: {
            ...edgeOriginEnvironment(edgeOriginVerification),
            CLOUDMARKUP_BILLING_ENABLED: String(props.config.features.billing),
            CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION:
              props.config.integrations.stripe.planMappingVersion,
            CLOUDMARKUP_BILLING_WEBHOOK_ENDPOINT_VERSION:
              props.config.integrations.stripe.webhookEndpointVersion,
            CLOUDMARKUP_BILLING_WEBHOOK_QUEUE_URL:
              this.billingWebhookQueue.queueUrl,
            ...(props.config.features.billing
              ? {
                  CLOUDMARKUP_STRIPE_ENVIRONMENT:
                    props.config.integrations.stripe.environment,
                  ...(props.config.integrations.stripe
                    .previousWebhookSigningSecretName === undefined
                    ? {}
                    : {
                        CLOUDMARKUP_STRIPE_PREVIOUS_WEBHOOK_SECRET_REFERENCE:
                          props.config.integrations.stripe
                            .previousWebhookSigningSecretName,
                      }),
                  CLOUDMARKUP_STRIPE_WEBHOOK_SECRET_REFERENCE:
                    props.config.integrations.stripe.webhookSigningSecretName,
                }
              : {}),
            NODE_OPTIONS: "--enable-source-maps",
          },
          functionName: props.names.billingWebhookFunction,
          handler: "handler",
          logGroup: props.observability.billingWebhookLogGroup,
          memorySize: 256,
          reservedConcurrentExecutions: 2,
          role: billingRole,
          runtime: lambda.Runtime.NODEJS_24_X,
          timeout: Duration.seconds(10),
          tracing: lambda.Tracing.ACTIVE,
        },
      );
      this.billingWebhookQueue.grantSendMessages(billingRole);

      const deadLetterQueue = new sqs.Queue(this, "JobDeadLetterQueue", {
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        fifo: true,
        queueName: props.names.deadLetterQueue,
        removalPolicy,
        retentionPeriod: Duration.days(14),
      });
      this.jobQueue = new sqs.Queue(this, "JobQueue", {
        deadLetterQueue: {
          maxReceiveCount: props.config.limits.jobMaxReceiveCount,
          queue: deadLetterQueue,
        },
        enforceSSL: true,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        fifo: true,
        queueName: props.names.jobQueue,
        removalPolicy,
        retentionPeriod: Duration.days(14),
        visibilityTimeout: Duration.seconds(
          props.config.limits.jobVisibilityTimeoutSeconds,
        ),
      });

      this.jobWorkerFunction = new lambdaNodejs.NodejsFunction(
        this,
        "JobWorkerFunction",
        {
          architecture: lambda.Architecture.ARM_64,
          bundling: {
            format: lambdaNodejs.OutputFormat.CJS,
            minify: false,
            sourceMap: true,
            target: "node24",
          },
          entry: fileURLToPath(
            new URL("../../runtime/job-worker.ts", import.meta.url),
          ),
          environment: {
            CLOUDMARKUP_CONTENT_BUCKET: props.stateful.contentBucket.bucketName,
            CLOUDMARKUP_DEPLOYMENT_SHELL: "true",
            CLOUDMARKUP_ENVIRONMENT: props.config.environment,
            ...(props.config.features.githubExport
              ? {
                  CLOUDMARKUP_GITHUB_APP_ID:
                    props.config.integrations.github.appId ?? "",
                  CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_NAME:
                    props.config.integrations.github.privateKeySecretName,
                }
              : {}),
            NODE_OPTIONS: "--enable-source-maps",
            ...featureEnvironment(props.config),
          },
          functionName: props.names.jobWorkerFunction,
          handler: "handler",
          logGroup: props.observability.jobWorkerLogGroup,
          memorySize: props.config.limits.workerMemoryMiB,
          reservedConcurrentExecutions: props.config.limits.workerConcurrency,
          role: workerRole,
          runtime: lambda.Runtime.NODEJS_24_X,
          timeout: Duration.seconds(props.config.limits.workerTimeoutSeconds),
          tracing: lambda.Tracing.ACTIVE,
        },
      );
      this.jobWorkerFunction.addEventSource(
        new lambdaEvents.SqsEventSource(this.jobQueue, {
          batchSize: 10,
          maxConcurrency: props.config.limits.workerConcurrency,
          reportBatchItemFailures: true,
        }),
      );

      const dispatchJob = new sfnTasks.SqsSendMessage(this, "DispatchJob", {
        messageBody: sfn.TaskInput.fromObject({
          correlationId: sfn.JsonPath.stringAt("$.correlationId"),
          jobId: sfn.JsonPath.stringAt("$.jobId"),
          schemaVersion: 1,
        }),
        messageDeduplicationId: sfn.JsonPath.stringAt("$.jobId"),
        messageGroupId: "cloudmarkup-jobs",
        queue: this.jobQueue,
      });
      this.jobStateMachine = new sfn.StateMachine(this, "JobDispatch", {
        definitionBody: sfn.DefinitionBody.fromChainable(dispatchJob),
        logs: {
          destination: props.observability.jobStateMachineLogGroup,
          includeExecutionData: false,
          level: sfn.LogLevel.ERROR,
        },
        removalPolicy,
        stateMachineName: props.names.jobStateMachine,
        stateMachineType: sfn.StateMachineType.STANDARD,
        timeout: Duration.minutes(5),
        tracingEnabled: true,
      });

      if (ownedApiRole === undefined) {
        throw new TypeError(
          "Non-beta optional integrations require a stack-owned API role.",
        );
      }
      this.addOptionalIntegrationPermissions(
        ownedApiRole,
        workerRole,
        billingRole,
        props,
      );
    }

    if (firstBeta) {
      const logGroup = props.observability.projectCleanupLogGroup;
      if (logGroup === undefined)
        throw new TypeError("Beta cleanup requires its owned log group.");
      const cleanup = new ProjectContentCleanup(this, "ProjectContentCleanup", {
        account: props.config.target.account,
        region: props.config.target.region,
        databaseArn: props.stateful.cluster.clusterArn,
        databaseSecretArn: databaseSecret.secretArn,
        contentBucketName: props.names.contentBucket,
        logGroup,
      });
      this.projectCleanupFunction = cleanup.workerFunction;
      this.projectCleanupFunction.node.addDependency(databaseMigration);
      if (
        props.config.integrations.projectCleanupWake?.preparationEnabled ===
        true
      ) {
        const table = props.stateful.cleanupWakeTable;
        if (table === undefined)
          throw new TypeError(
            "Cleanup wake preparation requires its retained table.",
          );
        new ProjectCleanupWake(this, "CleanupWakeShadow", {
          account: props.config.target.account,
          region: props.config.target.region,
          tableStreamArn: table.attrStreamArn,
          databaseArn: props.stateful.cluster.clusterArn,
          databaseSecretArn: databaseSecret.secretArn,
          contentBucketName: props.names.contentBucket,
          logGroup,
          notifyFunctions: [this.apiFunction, cleanup.workerFunction],
        });
      }
    }

    if (firstBeta && props.config.integrations.stripe.deliveryEnabled) {
      const workerLogGroup = props.observability.billingWorkerLogGroup;
      if (workerLogGroup === undefined) {
        throw new TypeError(
          "Sandbox billing requires its owned worker log group.",
        );
      }
      const billing = new SandboxBillingDelivery(
        this,
        "SandboxBillingDelivery",
        {
          config: props.config,
          databaseArn: props.stateful.cluster.clusterArn,
          databaseSecretArn: databaseSecret.secretArn,
          originVerification: edgeOriginVerification,
          webhookLogGroup: props.observability.billingWebhookLogGroup,
          workerLogGroup,
        },
      );
      this.billingWebhookDeadLetterQueue = billing.deadLetterQueue;
      this.billingWebhookQueue = billing.queue;
      this.billingWebhookFunction = billing.webhookFunction;
      this.billingWorkerFunction = billing.workerFunction;
      this.billingWorkerFunction.node.addDependency(databaseMigration);
      const billingDeliveryOutput = new CfnOutput(
        this,
        "SandboxBillingDeliveryOutput",
        {
          description:
            "Versioned Stripe sandbox delivery composition; not checkout or live billing authority.",
          value: "stripe-test-fifo-v1",
        },
      );
      billingDeliveryOutput.overrideLogicalId("SandboxBillingDelivery");
    }

    const ingress = this.createRestApi(props, edgeOriginVerification);
    this.api = ingress.api;
    this.apiStage = ingress.stage;
    this.apiStage.node.addDependency(databaseMigration);
    this.api.latestDeployment?.node.addDependency(databaseMigration);
    new CfnOutput(this, "CognitoUserPoolId", {
      description: "Cognito user pool identifier; not a credential.",
      value: this.userPool.userPoolId,
    });
    new CfnOutput(this, "CognitoPublicClientId", {
      description: "Public SPA client identifier; the client has no secret.",
      value: this.userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, "CognitoDomain", {
      description: "Cognito managed-login HTTPS origin.",
      value: this.userPoolDomain.baseUrl(),
    });
    new CfnOutput(this, "CognitoCallbackUrl", {
      description: "Exact authorization-code callback URL.",
      value: `${webOrigin}/auth/callback`,
    });
    new CfnOutput(this, "CognitoLogoutUrl", {
      description: "Exact post-logout application URL.",
      value: webOrigin,
    });
    new CfnOutput(this, "DirectOriginProtection", {
      description: props.config.features.waf
        ? "Regional WAF rejects direct execute-api requests before integration unless the generated edge marker is present."
        : "The Lambda integration rejects direct execute-api requests unless the generated edge marker is present.",
      value: props.config.features.waf
        ? "regional-waf-secrets-manager-edge-marker-required"
        : "lambda-secrets-manager-edge-marker-required",
    });
    new CfnOutput(this, "DatabaseMigrationExpectedVersion", {
      description: "Expected checked database schema version.",
      value: DATABASE_MIGRATION_EXPECTED_VERSION,
    });
    new CfnOutput(this, "DatabaseMigrationManifestSha256", {
      description: "SHA-256 of the checked migration manifest.",
      value: DATABASE_MIGRATION_MANIFEST_SHA256,
    });
    new CfnOutput(this, "DatabaseMigrationAppliedVersion", {
      description:
        "Schema version reported by the successful checksum-bound migration custom resource.",
      value: databaseMigration.getAttString("AppliedVersion"),
    });
    new CfnOutput(this, "DatabaseMigrationAppliedManifestSha256", {
      description:
        "Migration manifest digest reported by the successful custom resource.",
      value: databaseMigration.getAttString("ManifestSha256"),
    });
    new CfnOutput(this, "DatabaseMigrationCount", {
      description:
        "Number of reviewed migrations validated by the custom resource.",
      value: databaseMigration.getAttString("MigrationCount"),
    });
  }

  private lambdaLogRole(id: string, logGroupArn: string): iam.Role {
    const role = new iam.Role(this, id, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: `CloudMarkup ${id} with no customer-account trust`,
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`${logGroupArn}:*`],
      }),
    );
    return role;
  }

  private lambdaRole(id: string, logGroupArn: string): iam.Role {
    const role = this.lambdaLogRole(id, logGroupArn);
    // X-Ray ingestion APIs require Resource "*"; no business-data action is
    // included in this documented service-level exception.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["xray:PutTelemetryRecords", "xray:PutTraceSegments"],
        resources: ["*"],
      }),
    );
    return role;
  }

  private addApplicationDataPermissions(
    apiRole: iam.Role,
    props: ApplicationStackProps,
    databaseSecretArn: string,
  ): void {
    apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "rds-data:BeginTransaction",
          "rds-data:CommitTransaction",
          "rds-data:ExecuteStatement",
          "rds-data:RollbackTransaction",
        ],
        resources: [props.stateful.cluster.clusterArn],
      }),
    );
    apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [databaseSecretArn],
      }),
    );
    apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetBucketVersioning"],
        resources: [props.stateful.contentBucket.bucketArn],
      }),
    );
    apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:DeleteObjectVersion",
          "s3:GetObject",
          "s3:GetObjectTagging",
          "s3:GetObjectVersion",
          "s3:GetObjectVersionTagging",
          "s3:PutObject",
          "s3:PutObjectTagging",
          "s3:PutObjectVersionTagging",
        ],
        resources: [
          props.stateful.contentBucket.arnForObjects(
            `${props.names.documentPrefix}*`,
          ),
          props.stateful.contentBucket.arnForObjects(
            `${props.names.artifactPrefix}*`,
          ),
          props.stateful.contentBucket.arnForObjects(
            `${props.names.evidencePrefix}*`,
          ),
        ],
      }),
    );
  }

  private addOptionalIntegrationPermissions(
    apiRole: iam.Role,
    workerRole: iam.Role,
    billingRole: iam.Role,
    props: ApplicationStackProps,
  ): void {
    if (props.config.features.billing) {
      const stripeWebhookSecret = secretsmanager.Secret.fromSecretNameV2(
        this,
        "StripeWebhookSecretReference",
        props.config.integrations.stripe.webhookSigningSecretName,
      );
      stripeWebhookSecret.grantRead(billingRole);
      const previousWebhookSecret =
        props.config.integrations.stripe.previousWebhookSigningSecretName;
      if (previousWebhookSecret !== undefined) {
        secretsmanager.Secret.fromSecretNameV2(
          this,
          "StripePreviousWebhookSecretReference",
          previousWebhookSecret,
        ).grantRead(billingRole);
      }
    }
    if (props.config.features.githubExport) {
      const githubPrivateKey = secretsmanager.Secret.fromSecretNameV2(
        this,
        "GithubPrivateKeyReference",
        props.config.integrations.github.privateKeySecretName,
      );
      const githubWebhookSecret = secretsmanager.Secret.fromSecretNameV2(
        this,
        "GithubWebhookSecretReference",
        props.config.integrations.github.webhookSecretName,
      );
      githubPrivateKey.grantRead(workerRole);
      githubWebhookSecret.grantRead(apiRole);
    }
    if (props.config.features.aiAuthoring) {
      workerRole.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            "bedrock:InvokeModel",
            "bedrock:InvokeModelWithResponseStream",
          ],
          resources: [
            ...props.config.integrations.bedrock.modelArns,
            ...props.config.integrations.bedrock.inferenceProfileArns,
          ],
        }),
      );
    }
  }

  private createRestApi(
    props: ApplicationStackProps,
    edgeOriginVerification: string,
  ): Readonly<{ api: apigateway.RestApi; stage: apigateway.Stage }> {
    const betaApiGatewayLogRole =
      props.config.environment === "beta"
        ? iam.Role.fromRoleArn(
            this,
            "BetaApiGatewayLoggingRole",
            this.formatArn({
              region: "",
              resource: "role",
              resourceName: BETA_CDK_BOOTSTRAP.apiGatewayLoggingRoleName,
              service: "iam",
            }),
            { mutable: false },
          )
        : undefined;
    const ownedApiGatewayLogRole =
      betaApiGatewayLogRole === undefined
        ? new iam.Role(this, "ApiGatewayLogRole", {
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
            description:
              "CloudMarkup API Gateway access-log delivery to the exact reviewed log group",
            roleName: `${props.names.prefix}-api-gateway-logging`,
          })
        : undefined;
    const apiGatewayLogRole = betaApiGatewayLogRole ?? ownedApiGatewayLogRole;
    if (apiGatewayLogRole === undefined) {
      throw new TypeError("API Gateway logging role could not be resolved.");
    }
    if (ownedApiGatewayLogRole !== undefined) {
      ownedApiGatewayLogRole.applyRemovalPolicy(
        RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      );
      ownedApiGatewayLogRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["logs:DescribeLogStreams"],
          resources: [props.observability.apiAccessLogGroup.logGroupArn],
        }),
      );
      ownedApiGatewayLogRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [`${props.observability.apiAccessLogGroup.logGroupArn}:*`],
        }),
      );
    }
    const apiGatewayAccount = new apigateway.CfnAccount(
      this,
      "ApiGatewayAccount",
      { cloudWatchRoleArn: apiGatewayLogRole.roleArn },
    );
    apiGatewayAccount.applyRemovalPolicy(
      RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    );

    const api = new apigateway.RestApi(this, "RestApi", {
      binaryMediaTypes: ["application/zip"],
      cloudWatchRole: false,
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(
          props.observability.apiAccessLogGroup,
        ),
        accessLogFormat: apigateway.AccessLogFormat.custom(
          '{"apiId":"$context.apiId","correlationId":"$context.requestId",' +
            '"extendedRequestId":"$context.extendedRequestId",' +
            '"method":"$context.httpMethod",' +
            '"routeKey":"$context.httpMethod $context.resourcePath",' +
            '"status":$context.status}',
        ),
        dataTraceEnabled: false,
        metricsEnabled: true,
        stageName: props.config.environment,
        throttlingBurstLimit: props.config.limits.apiBurst,
        throttlingRateLimit: props.config.limits.apiRate,
      },
      description: "CloudMarkup modular-monolith API ingress",
      disableExecuteApiEndpoint: false,
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      restApiName: props.names.api,
    });
    if (!api.node.tryRemoveChild("Endpoint")) {
      throw new TypeError("The raw REST API endpoint output was not found.");
    }
    api.deploymentStage.node.addDependency(apiGatewayAccount);
    api.addGatewayResponse("UnauthorizedResponse", {
      responseHeaders: API_GATEWAY_SECURITY_RESPONSE_HEADERS,
      statusCode: "401",
      templates: {
        "application/json": gatewayErrorTemplate(
          "authentication_required",
          "Authentication is required.",
        ),
      },
      type: apigateway.ResponseType.UNAUTHORIZED,
    });
    api.addGatewayResponse("AccessDeniedResponse", {
      responseHeaders: API_GATEWAY_SECURITY_RESPONSE_HEADERS,
      statusCode: "403",
      templates: {
        "application/json": gatewayErrorTemplate(
          "access_denied",
          "Access is denied.",
        ),
      },
      type: apigateway.ResponseType.ACCESS_DENIED,
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        authorizerName: "CloudMarkupAccessToken",
        cognitoUserPools: [this.userPool],
        identitySource: apigateway.IdentitySource.header("Authorization"),
      },
    );
    const apiIntegration = new apigateway.LambdaIntegration(this.apiFunction, {
      allowTestInvoke: false,
      proxy: true,
      timeout: Duration.seconds(props.config.limits.apiTimeoutSeconds),
    });
    const protectedMethod: apigateway.MethodOptions = {
      authorizationScopes: ["cloudmarkup-api/access"],
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
    };
    const publicMethod: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.NONE,
    };

    const v1 = api.root.addResource("v1");
    v1.addMethod("ANY", apiIntegration, protectedMethod);
    v1.addProxy({
      anyMethod: true,
      defaultIntegration: apiIntegration,
      defaultMethodOptions: protectedMethod,
    });
    api.root
      .addResource("health")
      .addMethod("GET", apiIntegration, publicMethod);
    api.root
      .addResource("ready")
      .addMethod("GET", apiIntegration, publicMethod);
    api.root
      .resourceForPath("openapi/v1.json")
      .addMethod("GET", apiIntegration, publicMethod);
    api.root
      .addResource("runtime-config")
      .addMethod("GET", apiIntegration, publicMethod);
    // Cookie/PKCE exchange must reach the same-origin transport without an
    // access token. The handler owns exact Origin/JSON/header checks and
    // verified Cognito identity; product routes retain their authorizer.
    for (const operation of [
      "exchange",
      "restore",
      "cancel",
      "logout",
    ] as const) {
      api.root
        .resourceForPath("auth/session/v1/" + operation)
        .addMethod("POST", apiIntegration, publicMethod);
    }
    const webhooks = api.root.addResource("webhooks");
    // Public redirects carry no tenant identity and cannot complete a link.
    // The adapter rejects them with 503 until the separate connection flag is on.
    const githubCallbacks = api.root.addResource("github");
    githubCallbacks
      .addResource("setup")
      .addMethod("GET", apiIntegration, publicMethod);
    githubCallbacks
      .addResource("callback")
      .addMethod("GET", apiIntegration, publicMethod);
    if (this.billingWebhookFunction !== undefined) {
      const billingIntegration = new apigateway.LambdaIntegration(
        this.billingWebhookFunction,
        {
          allowTestInvoke: false,
          proxy: true,
          timeout: Duration.seconds(10),
        },
      );
      webhooks
        .addResource("stripe")
        .addMethod("POST", billingIntegration, publicMethod);
    }
    webhooks
      .addResource("github")
      .addMethod("POST", apiIntegration, publicMethod);

    if (props.config.features.waf) {
      const regionalWebAcl = new wafv2.CfnWebACL(this, "RegionalOriginAccess", {
        defaultAction: { allow: {} },
        description:
          "Reject direct API Gateway traffic before an application integration is invoked",
        name: `${props.names.prefix}-regional-origin-access`,
        rules: [
          {
            action: { block: {} },
            name: "RequireCloudFrontOriginMarker",
            priority: 0,
            statement: {
              notStatement: {
                statement: {
                  byteMatchStatement: {
                    fieldToMatch: {
                      // Pinned CDK models SingleHeader as `any`; CloudFormation
                      // therefore requires the wire-format property name here.
                      singleHeader: { Name: EDGE_ORIGIN_HEADER_NAME },
                    },
                    positionalConstraint: "EXACTLY",
                    searchString: edgeOriginVerification,
                    textTransformations: [{ priority: 0, type: "NONE" }],
                  },
                },
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: "RequireCloudFrontOriginMarker",
              sampledRequestsEnabled: false,
            },
          },
        ],
        scope: "REGIONAL",
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${props.names.prefix}-regional-origin-access`,
          sampledRequestsEnabled: false,
        },
      });
      new wafv2.CfnWebACLAssociation(this, "RegionalOriginAssociation", {
        resourceArn: api.deploymentStage.stageArn,
        webAclArn: regionalWebAcl.attrArn,
      });
    }

    return Object.freeze({ api, stage: api.deploymentStage });
  }
}
