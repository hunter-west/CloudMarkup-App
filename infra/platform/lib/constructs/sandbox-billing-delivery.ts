import { fileURLToPath } from "node:url";
import {
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_event_sources as lambdaEvents,
  aws_lambda_nodejs as lambdaNodejs,
  aws_logs as logs,
  aws_sqs as sqs,
} from "aws-cdk-lib";
import { Construct } from "constructs";

import {
  defineEnvironmentConfig,
  type EnvironmentConfig,
} from "../config/environment-config.js";
import { BETA_CDK_BOOTSTRAP } from "../beta-deployment-bootstrap.js";
import { edgeOriginEnvironment } from "../edge-origin-contract.js";

export interface SandboxBillingDeliveryProps {
  readonly config: EnvironmentConfig;
  readonly databaseArn: string;
  readonly databaseSecretArn: string;
  readonly originVerification: string;
  readonly webhookLogGroup: logs.ILogGroup;
  readonly workerLogGroup: logs.ILogGroup;
}

/** A beta-only, signed Stripe delivery lane; no customer-object or model access. */
export class SandboxBillingDelivery extends Construct {
  readonly queue: sqs.Queue;
  readonly deadLetterQueue: sqs.Queue;
  readonly webhookFunction: lambda.Function;
  readonly workerFunction: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    props: SandboxBillingDeliveryProps,
  ) {
    super(scope, id);
    const config = defineEnvironmentConfig(props.config);
    const stripe = config.integrations.stripe;
    if (!stripe.deliveryEnabled || !config.features.billing) {
      throw new TypeError("Sandbox delivery must be explicitly configured.");
    }
    const apiKeyArn = stripe.apiKeySecretArn;
    const signingArn = stripe.webhookSigningSecretArn;
    if (apiKeyArn === undefined || signingArn === undefined) {
      throw new TypeError("Sandbox delivery requires exact secret references.");
    }
    const prefix = "cloudmarkup-beta";
    const stack = Stack.of(this);
    const removalPolicy = RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE;
    // The owner-managed bootstrap owns these policies. Application delivery
    // may pass the exact roles but cannot create, mutate or widen them.
    const role = (id: string, roleName: string) =>
      iam.Role.fromRoleArn(
        this,
        id,
        stack.formatArn({
          service: "iam",
          region: "",
          resource: "role",
          resourceName: roleName,
        }),
        { mutable: false },
      );
    const webhookRole = role(
      "WebhookExecutionRole",
      BETA_CDK_BOOTSTRAP.billingWebhookRuntimeRoleName,
    );
    const workerRole = role(
      "WorkerExecutionRole",
      BETA_CDK_BOOTSTRAP.billingWorkerRuntimeRoleName,
    );
    this.deadLetterQueue = new sqs.Queue(this, "DeadLetterQueue", {
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      fifo: true,
      queueName: `${prefix}-billing-webhook-dlq.fifo`,
      removalPolicy,
      retentionPeriod: Duration.days(14),
    });
    this.queue = new sqs.Queue(this, "Queue", {
      contentBasedDeduplication: false,
      deadLetterQueue: {
        maxReceiveCount: config.limits.jobMaxReceiveCount,
        queue: this.deadLetterQueue,
      },
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      fifo: true,
      queueName: `${prefix}-billing-webhook.fifo`,
      removalPolicy,
      retentionPeriod: Duration.days(14),
      // Six times the bounded worker timeout; one record per batch avoids
      // spending the invocation window serially on ten provider refreshes.
      visibilityTimeout: Duration.seconds(360),
    });
    const common = {
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        format: lambdaNodejs.OutputFormat.CJS,
        minify: false,
        sourceMap: true,
        target: "node24",
      },
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      tracing: lambda.Tracing.ACTIVE,
    };
    this.webhookFunction = new lambdaNodejs.NodejsFunction(
      this,
      "WebhookFunction",
      {
        ...common,
        entry: fileURLToPath(
          new URL("../../runtime/billing-webhook.ts", import.meta.url),
        ),
        functionName: `${prefix}-billing-webhook`,
        logGroup: props.webhookLogGroup,
        memorySize: 256,
        reservedConcurrentExecutions: 2,
        role: webhookRole,
        timeout: Duration.seconds(10),
        environment: {
          ...edgeOriginEnvironment(props.originVerification),
          CLOUDMARKUP_ENVIRONMENT: "beta",
          CLOUDMARKUP_BILLING_ENABLED: "true",
          CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION: stripe.planMappingVersion,
          CLOUDMARKUP_BILLING_WEBHOOK_ENDPOINT_VERSION:
            stripe.webhookEndpointVersion,
          CLOUDMARKUP_BILLING_WEBHOOK_QUEUE_URL: this.queue.queueUrl,
          CLOUDMARKUP_STRIPE_ENVIRONMENT: stripe.environment,
          CLOUDMARKUP_STRIPE_WEBHOOK_SECRET_REFERENCE: signingArn,
          ...(stripe.previousWebhookSigningSecretArn === undefined
            ? {}
            : {
                CLOUDMARKUP_STRIPE_PREVIOUS_WEBHOOK_SECRET_REFERENCE:
                  stripe.previousWebhookSigningSecretArn,
              }),
          NODE_OPTIONS: "--enable-source-maps",
        },
      },
    );
    this.workerFunction = new lambdaNodejs.NodejsFunction(
      this,
      "WorkerFunction",
      {
        ...common,
        entry: fileURLToPath(
          new URL("../../runtime/billing-worker.ts", import.meta.url),
        ),
        functionName: `${prefix}-billing-worker`,
        logGroup: props.workerLogGroup,
        memorySize: 512,
        reservedConcurrentExecutions: 2,
        role: workerRole,
        timeout: Duration.seconds(60),
        environment: {
          CLOUDMARKUP_ENVIRONMENT: "beta",
          CLOUDMARKUP_BILLING_ENABLED: "true",
          CLOUDMARKUP_STRIPE_ENVIRONMENT: stripe.environment,
          CLOUDMARKUP_BILLING_WEBHOOK_QUEUE_ARN: this.queue.queueArn,
          CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION: stripe.planMappingVersion,
          CLOUDMARKUP_DATABASE_ARN: props.databaseArn,
          CLOUDMARKUP_DATABASE_SECRET_ARN: props.databaseSecretArn,
          CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
          CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN: apiKeyArn,
          CLOUDMARKUP_BILLING_CANCEL_URL: stripe.cancelUrl,
          CLOUDMARKUP_BILLING_PORTAL_RETURN_URL: stripe.portalReturnUrl,
          CLOUDMARKUP_BILLING_SUCCESS_URL: stripe.successUrl,
          STRIPE_PORTAL_CONFIGURATION_ID: stripe.portalConfigurationId ?? "",
          STRIPE_STARTER_PRICE_ID: stripe.starterPriceId ?? "",
          STRIPE_STARTER_PRODUCT_ID: stripe.starterProductId ?? "",
          STRIPE_PRO_PRICE_ID: stripe.proPriceId ?? "",
          STRIPE_PRO_PRODUCT_ID: stripe.proProductId ?? "",
          NODE_OPTIONS: "--enable-source-maps",
        },
      },
    );
    this.workerFunction.addEventSource(
      new lambdaEvents.SqsEventSource(this.queue, {
        batchSize: 1,
        maxConcurrency: 2,
        reportBatchItemFailures: true,
      }),
    );
    // Omit explicit resource tags for this mapping; the named worker and queues
    // retain their normal stage tags. CloudFormation can still propagate stack
    // tags independently, so the owner-managed bootstrap separately permits the
    // three mapping metadata actions in this account/Region. Unlike lifecycle
    // actions, those actions cannot be constrained by lambda:FunctionArn.
    for (const key of [
      "CloudMarkupConfigSchema",
      ...Object.keys(config.tags),
    ]) {
      Tags.of(this.workerFunction).remove(key, {
        includeResourceTypes: ["AWS::Lambda::EventSourceMapping"],
      });
    }
    // The stage supplies the owner-managed beta permissions boundary. This
    // construct never changes that boundary or the imported API runtime role.
    if (
      stack.account !== config.target.account ||
      stack.region !== config.target.region
    ) {
      throw new TypeError(
        "Sandbox delivery must use its exact configured stack target.",
      );
    }
  }
}
