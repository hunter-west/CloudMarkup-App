import { fileURLToPath } from "node:url";
import {
  Duration,
  RemovalPolicy,
  Stack,
  aws_events as events,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_sqs as sqs,
  type aws_logs as logs,
} from "aws-cdk-lib";
import { Construct } from "constructs";

/** Inactive shadow preparation. Imported roles must be provisioned separately. */
export class ProjectCleanupWake extends Construct {
  readonly dispatcher: lambda.Function;
  readonly worker: lambda.Function;
  constructor(
    scope: Construct,
    id: string,
    props: {
      readonly account: string;
      readonly region: string;
      readonly tableStreamArn: string;
      readonly databaseArn: string;
      readonly databaseSecretArn: string;
      readonly contentBucketName: string;
      readonly logGroup: logs.ILogGroup;
      readonly notifyFunctions: readonly lambda.Function[];
      readonly code?: lambda.Code;
    },
  ) {
    super(scope, id);
    const stack = Stack.of(this);
    if (stack.account !== props.account || stack.region !== props.region)
      throw new TypeError("Cleanup wake target must match beta.");
    const name = "cloudmarkup-beta-cleanup-wakes";
    const dlq = new sqs.Queue(this, "DeadLetters", {
      queueName: `${name}-dead-letters`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const queue = new sqs.Queue(this, "Queue", {
      queueName: name,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.minutes(30),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const scheduleArn = `arn:aws:events:${props.region}:${props.account}:rule/cloudmarkup-beta-cleanup-wake-dispatch`;
    const environment = {
      CLOUDMARKUP_CLEANUP_WAKE_ENABLED: "false",
      CLOUDMARKUP_CLEANUP_WAKE_TABLE: name,
      CLOUDMARKUP_CLEANUP_WAKE_STREAM_ARN: props.tableStreamArn,
      CLOUDMARKUP_CLEANUP_WAKE_QUEUE_URL: queue.queueUrl,
      CLOUDMARKUP_CLEANUP_WAKE_SCHEDULE_ARN: scheduleArn,
      CLOUDMARKUP_ENVIRONMENT: "beta",
      CLOUDMARKUP_ACCOUNT_ID: props.account,
      CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
      CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: "true",
      CLOUDMARKUP_DATABASE_ARN: props.databaseArn,
      CLOUDMARKUP_DATABASE_SECRET_ARN: props.databaseSecretArn,
      CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
      CLOUDMARKUP_CONTENT_BUCKET: props.contentBucketName,
      CLOUDMARKUP_CLEANUP_SCHEDULE_ARN: `arn:aws:events:${props.region}:${props.account}:rule/cloudmarkup-beta-project-content-cleanup`,
    };
    const makeFunction = (
      kind: "Dispatch" | "Worker",
      handler: string,
      concurrency: number,
    ) => {
      const role = iam.Role.fromRoleArn(
        this,
        `${kind}Role`,
        `arn:aws:iam::${props.account}:role/CloudMarkup-Beta-Cleanup-Wake-${kind}-Runtime`,
        { mutable: false },
      );
      const common = {
        role,
        environment,
        logGroup: props.logGroup,
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 512,
        timeout: Duration.minutes(5),
        reservedConcurrentExecutions: concurrency,
        tracing: lambda.Tracing.DISABLED,
        functionName: `cloudmarkup-beta-cleanup-wake-${kind.toLowerCase()}`,
      };
      return props.code === undefined
        ? new nodejs.NodejsFunction(this, kind, {
            ...common,
            handler,
            entry: fileURLToPath(
              new URL(
                "../../../../apps/api/src/production-project-cleanup-wake.ts",
                import.meta.url,
              ),
            ),
            bundling: {
              format: nodejs.OutputFormat.CJS,
              target: "node24",
              sourceMap: true,
              minify: false,
            },
          })
        : new lambda.Function(this, kind, {
            ...common,
            code: props.code,
            handler: `index.${handler}`,
          });
    };
    this.dispatcher = makeFunction("Dispatch", "dispatchHandler", 1);
    this.worker = makeFunction("Worker", "workerHandler", 2);
    for (const fn of props.notifyFunctions)
      for (const [key, value] of Object.entries(environment))
        fn.addEnvironment(key, value);
    new events.CfnRule(this, "DispatchSchedule", {
      name: "cloudmarkup-beta-cleanup-wake-dispatch",
      scheduleExpression: "rate(1 minute)",
      state: "DISABLED",
      targets: [
        {
          id: "WakeDispatch",
          arn: this.dispatcher.functionArn,
          retryPolicy: {
            maximumEventAgeInSeconds: 300,
            maximumRetryAttempts: 0,
          },
        },
      ],
    });
    // No convenience event-source or grants: mappings and runtime are inactive.
    new lambda.CfnEventSourceMapping(this, "StreamTrigger", {
      enabled: false,
      eventSourceArn: props.tableStreamArn,
      functionName: this.dispatcher.functionArn,
      startingPosition: "LATEST",
      batchSize: 100,
      filterCriteria: {
        filters: [
          {
            pattern: JSON.stringify({
              eventName: ["INSERT"],
              dynamodb: { Keys: { PK: { S: [{ prefix: "WAKE#" }] } } },
            }),
          },
        ],
      },
    });
    new lambda.CfnEventSourceMapping(this, "QueueTrigger", {
      enabled: false,
      eventSourceArn: queue.queueArn,
      functionName: this.worker.functionArn,
      batchSize: 1,
      functionResponseTypes: ["ReportBatchItemFailures"],
      scalingConfig: { maximumConcurrency: 2 },
    });
  }
}
