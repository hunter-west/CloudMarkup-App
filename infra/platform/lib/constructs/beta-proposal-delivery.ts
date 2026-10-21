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
  aws_sqs as sqs,
  type aws_logs as logs,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { BETA_CDK_BOOTSTRAP } from "../beta-deployment-bootstrap.js";

/** Uses the owner's explicitly scoped runtime role; no customer-cloud access. */
export class BetaProposalDelivery extends Construct {
  readonly environment: Readonly<Record<string, string>>;
  readonly workerFunction: lambda.Function;
  readonly queue: sqs.Queue;
  constructor(
    scope: Construct,
    id: string,
    props: {
      databaseArn: string;
      databaseSecretArn: string;
      contentBucketName: string;
      documentPrefix: string;
      logGroup: logs.ILogGroup;
      tags: Readonly<Record<string, string>>;
    },
  ) {
    super(scope, id);
    const stack = Stack.of(this);
    const dlq = new sqs.Queue(this, "DeadLetterQueue", {
      queueName: "cloudmarkup-beta-proposals-dlq.fifo",
      fifo: true,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      retentionPeriod: Duration.days(14),
    });
    this.queue = new sqs.Queue(this, "Queue", {
      queueName: "cloudmarkup-beta-proposals.fifo",
      fifo: true,
      contentBasedDeduplication: false,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
      visibilityTimeout: Duration.seconds(1500),
      retentionPeriod: Duration.days(1),
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    this.environment = {
      CLOUDMARKUP_BETA_PROPOSAL_QUEUE_ARN: this.queue.queueArn,
    };
    const role = iam.Role.fromRoleArn(
      this,
      "ExecutionRole",
      stack.formatArn({
        service: "iam",
        region: "",
        resource: "role",
        resourceName: BETA_CDK_BOOTSTRAP.betaProposalWorkerRuntimeRoleName,
      }),
      { mutable: false },
    );
    this.workerFunction = new lambdaNodejs.NodejsFunction(
      this,
      "WorkerFunction",
      {
        entry: fileURLToPath(
          new URL(
            "../../../../apps/api/src/production-beta-infrastructure-worker.ts",
            import.meta.url,
          ),
        ),
        handler: "handler",
        functionName: "cloudmarkup-beta-proposal-worker",
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        bundling: {
          format: lambdaNodejs.OutputFormat.CJS,
          target: "node24",
          minify: true,
          keepNames: true,
          sourceMap: true,
          sourcesContent: false,
        },
        role,
        logGroup: props.logGroup,
        memorySize: 1024,
        timeout: Duration.seconds(240),
        reservedConcurrentExecutions: 2,
        environment: {
          ...this.environment,
          CLOUDMARKUP_BETA_AI_ENABLED: "true",
          CLOUDMARKUP_ENVIRONMENT: "beta",
          CLOUDMARKUP_DATABASE_ARN: props.databaseArn,
          CLOUDMARKUP_DATABASE_SECRET_ARN: props.databaseSecretArn,
          CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
          CLOUDMARKUP_CONTENT_BUCKET: props.contentBucketName,
          CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX: props.documentPrefix,
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
    for (const key of ["CloudMarkupConfigSchema", ...Object.keys(props.tags)])
      Tags.of(this.workerFunction).remove(key, {
        includeResourceTypes: ["AWS::Lambda::EventSourceMapping"],
      });
  }
}
