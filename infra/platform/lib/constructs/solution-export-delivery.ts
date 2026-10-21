import {
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_event_sources as lambdaEvents,
  aws_sqs as sqs,
  type aws_logs as logs,
} from "aws-cdk-lib";
import { Construct } from "constructs";

import { BETA_CDK_BOOTSTRAP } from "../beta-deployment-bootstrap.js";
import type { EnvironmentConfig } from "../config/environment-config.js";
import {
  createSolutionExportRuntimeLayer,
  createSolutionExportWorkerCode,
} from "../solution-export-runtime-asset.js";

/** Exact immutable infrastructure-only export transport. Imported roles remain
 * owner-managed; the request API publishes and this consumer cannot publish. */
export class SolutionExportDelivery extends Construct {
  readonly queue: sqs.Queue;
  readonly deadLetterQueue: sqs.Queue;
  readonly workerFunction: lambda.Function;
  readonly layer: lambda.LayerVersion;
  readonly environment: Readonly<Record<string, string>>;

  constructor(
    scope: Construct,
    id: string,
    props: {
      readonly config: EnvironmentConfig;
      readonly databaseArn: string;
      readonly databaseSecretArn: string;
      readonly contentBucketName: string;
      readonly logGroup: logs.ILogGroup;
    },
  ) {
    super(scope, id);
    const stack = Stack.of(this);
    if (
      props.config.environment !== "beta" ||
      props.config.integrations.solutionExport?.enabled !== true ||
      stack.account !== props.config.target.account ||
      stack.region !== props.config.target.region
    )
      throw new TypeError(
        "Restricted exports require the exact admitted beta configuration.",
      );
    const removalPolicy = RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE;
    this.deadLetterQueue = new sqs.Queue(this, "DeadLetterQueue", {
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      fifo: true,
      queueName: "cloudmarkup-beta-solution-exports-dlq.fifo",
      removalPolicy,
      retentionPeriod: Duration.days(14),
    });
    this.queue = new sqs.Queue(this, "Queue", {
      contentBasedDeduplication: false,
      deadLetterQueue: { maxReceiveCount: 5, queue: this.deadLetterQueue },
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      fifo: true,
      queueName: "cloudmarkup-beta-solution-exports.fifo",
      removalPolicy,
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.seconds(3600),
    });
    const runtime = createSolutionExportRuntimeLayer(this);
    this.layer = runtime.layer;
    this.environment = {
      ...runtime.environment,
      CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_ARN: this.queue.queueArn,
      CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_URL: this.queue.queueUrl,
    };
    const role = iam.Role.fromRoleArn(
      this,
      "ExecutionRole",
      stack.formatArn({
        service: "iam",
        region: "",
        resource: "role",
        resourceName: BETA_CDK_BOOTSTRAP.solutionExportWorkerRuntimeRoleName,
      }),
      { mutable: false },
    );
    this.workerFunction = new lambda.Function(this, "WorkerFunction", {
      architecture: lambda.Architecture.ARM_64,
      code: createSolutionExportWorkerCode(),
      functionName: "cloudmarkup-beta-solution-export-worker",
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      logGroup: props.logGroup,
      role,
      layers: [runtime.layer],
      memorySize: 1024,
      reservedConcurrentExecutions: 2,
      timeout: Duration.seconds(600),
      tracing: lambda.Tracing.DISABLED,
      environment: {
        ...this.environment,
        CLOUDMARKUP_ENVIRONMENT: "beta",
        CLOUDMARKUP_DATABASE_ARN: props.databaseArn,
        CLOUDMARKUP_DATABASE_SECRET_ARN: props.databaseSecretArn,
        CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
        CLOUDMARKUP_CONTENT_BUCKET: props.contentBucketName,
        CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX: "documents/v1/organizations/",
        CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
        NODE_OPTIONS: "--enable-source-maps",
      },
    });
    this.workerFunction.addEventSource(
      new lambdaEvents.SqsEventSource(this.queue, {
        batchSize: 1,
        maxConcurrency: 2,
        reportBatchItemFailures: true,
      }),
    );
    for (const key of [
      "CloudMarkupConfigSchema",
      ...Object.keys(props.config.tags),
    ])
      Tags.of(this.workerFunction).remove(key, {
        includeResourceTypes: ["AWS::Lambda::EventSourceMapping"],
      });
  }
}
