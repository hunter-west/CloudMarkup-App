import { fileURLToPath } from "node:url";
import {
  Duration,
  Stack,
  aws_events as events,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNodejs,
  type aws_logs as logs,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { BETA_CDK_BOOTSTRAP } from "../beta-deployment-bootstrap.js";

/** Owner-authorized beta cleanup. Exact tenant prefixes and the durable write
 * fence admit only previously authorized project deletions. */
export class ProjectContentCleanup extends Construct {
  readonly workerFunction: lambda.Function;
  readonly schedule: events.CfnRule;
  constructor(
    scope: Construct,
    id: string,
    props: {
      readonly account: string;
      readonly region: string;
      readonly databaseArn: string;
      readonly databaseSecretArn: string;
      readonly contentBucketName: string;
      readonly logGroup: logs.ILogGroup;
    },
  ) {
    super(scope, id);
    const stack = Stack.of(this);
    if (stack.account !== props.account || stack.region !== props.region) {
      throw new TypeError(
        "Project cleanup must use the exact beta stack target.",
      );
    }
    const name = "cloudmarkup-beta-project-content-cleanup";
    const scheduleArn = `arn:aws:events:${props.region}:${props.account}:rule/${name}`;
    const role = iam.Role.fromRoleArn(
      this,
      "ExecutionRole",
      stack.formatArn({
        service: "iam",
        region: "",
        resource: "role",
        resourceName: BETA_CDK_BOOTSTRAP.projectCleanupRuntimeRoleName,
      }),
      { mutable: false },
    );
    this.workerFunction = new lambdaNodejs.NodejsFunction(
      this,
      "WorkerFunction",
      {
        architecture: lambda.Architecture.ARM_64,
        bundling: {
          format: lambdaNodejs.OutputFormat.CJS,
          minify: false,
          sourceMap: true,
          sourcesContent: false,
          // The release verifier inspects schemaChecksum; retain identifiers.
          esbuildArgs: { "--minify-whitespace": true },
          target: "node24",
        },
        entry: fileURLToPath(
          new URL("../../runtime/project-content-cleanup.ts", import.meta.url),
        ),
        functionName: name,
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_24_X,
        logGroup: props.logGroup,
        role,
        memorySize: 512,
        reservedConcurrentExecutions: 1,
        timeout: Duration.minutes(5),
        tracing: lambda.Tracing.DISABLED,
        environment: {
          CLOUDMARKUP_ENVIRONMENT: "beta",
          CLOUDMARKUP_ACCOUNT_ID: props.account,
          CLOUDMARKUP_DATABASE_ARN: props.databaseArn,
          CLOUDMARKUP_DATABASE_SECRET_ARN: props.databaseSecretArn,
          CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
          CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
          CLOUDMARKUP_CONTENT_BUCKET: props.contentBucketName,
          CLOUDMARKUP_CLEANUP_SCHEDULE_ARN: scheduleArn,
          CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: "true",
          NODE_OPTIONS: "--enable-source-maps",
        },
      },
    );
    this.schedule = new events.CfnRule(this, "Schedule", {
      name,
      scheduleExpression: "rate(1 minute)",
      state: "ENABLED",
      targets: [
        {
          id: "ProjectContentCleanup",
          arn: this.workerFunction.functionArn,
          retryPolicy: {
            maximumEventAgeInSeconds: 300,
            maximumRetryAttempts: 0,
          },
        },
      ],
    });
    this.workerFunction.addPermission("ExactSchedule", {
      principal: new iam.ServicePrincipal("events.amazonaws.com"),
      sourceAccount: props.account,
      sourceArn: scheduleArn,
    });
  }
}
