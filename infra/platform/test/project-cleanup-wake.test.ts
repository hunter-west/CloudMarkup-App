import { Stack, aws_lambda as lambda, aws_logs as logs } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import {
  defineEnvironmentConfig,
  type EnvironmentConfig,
} from "../lib/config/environment-config.js";
import { createBetaEnvironmentConfig } from "../lib/config/environments/beta.js";
import { createPlatformResourceNames } from "../lib/platform-names.js";
import { StatefulStack } from "../lib/stacks/stateful-stack.js";
import { ApplicationStack } from "../lib/stacks/application-stack.js";
import { ObservabilityStack } from "../lib/stacks/observability-stack.js";
import { ProjectCleanupWake } from "../lib/constructs/project-cleanup-wake.js";
import { createTemplateTestApp } from "./template-test-app.js";
const account = "000000000000",
  region = "us-east-1";
function config() {
  return createBetaEnvironmentConfig({
    target: { account, region },
    domain: {
      certificateArn: `arn:aws:acm:${region}:${account}:certificate/11111111-2222-3333-4444-555555555555`,
      createDnsRecords: false,
      domainName: "beta.example.invalid",
    },
  });
}
function stacks(input: EnvironmentConfig) {
  const app = createTemplateTestApp();
  const validated = defineEnvironmentConfig(input);
  const names = createPlatformResourceNames("beta", validated.target);
  const observability = new ObservabilityStack(app, "ObservabilityFixture", {
    config: validated,
    names,
    env: validated.target,
  });
  const stateful = new StatefulStack(app, "StatefulFixture", {
    config: validated,
    names,
    env: validated.target,
  });
  const application = new ApplicationStack(app, "ApplicationFixture", {
    config: validated,
    names,
    stateful,
    observability,
    env: validated.target,
  });
  return {
    stateful: Template.fromStack(stateful),
    application: Template.fromStack(application),
  };
}
describe("disabled durable cleanup wake preparation", () => {
  it("absent and false gates preserve full stateful and application templates and minute recovery", () => {
    const base = config();
    const absent = stacks(base);
    const disabled = stacks({
      ...base,
      integrations: {
        ...base.integrations,
        projectCleanupWake: { preparationEnabled: false },
      },
    });
    expect(disabled.stateful.toJSON()).toEqual(absent.stateful.toJSON());
    expect(disabled.application.toJSON()).toEqual(absent.application.toJSON());
    absent.stateful.resourceCountIs("AWS::DynamoDB::Table", 0);
    absent.application.hasResourceProperties("AWS::Events::Rule", {
      Name: "cloudmarkup-beta-project-content-cleanup",
      State: "ENABLED",
      ScheduleExpression: "rate(1 minute)",
    });
  }, 30_000);
  it("gated table has protected retained metadata, PITR and no TTL or index", () => {
    const base = config();
    const template = stacks({
      ...base,
      integrations: {
        ...base.integrations,
        projectCleanupWake: { preparationEnabled: true },
      },
    }).stateful;
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: {
        TableName: "cloudmarkup-beta-cleanup-wakes",
        BillingMode: "PAY_PER_REQUEST",
        DeletionProtectionEnabled: true,
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
          RecoveryPeriodInDays: 14,
        },
        SSESpecification: { SSEEnabled: true },
        StreamSpecification: { StreamViewType: "NEW_IMAGE" },
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
      },
    });
    expect(
      JSON.stringify(template.findResources("AWS::DynamoDB::Table")),
    ).not.toMatch(/TimeToLive|GlobalSecondary|LocalSecondary/u);
    template.hasResourceProperties("AWS::RDS::DBCluster", {
      ServerlessV2ScalingConfiguration: { MinCapacity: 0.5, MaxCapacity: 4 },
    });
  }, 30_000);
  it("preparation has no IAM or invocation grants and keeps every new trigger and runtime disabled", () => {
    const stack = new Stack(createTemplateTestApp(), "WakeFixture", {
      env: { account, region },
    });
    new ProjectCleanupWake(stack, "Wake", {
      account,
      region,
      tableStreamArn: `arn:aws:dynamodb:${region}:${account}:table/cloudmarkup-beta-cleanup-wakes/stream/2026-10-02T00:00:00.000`,
      databaseArn: `arn:aws:rds:${region}:${account}:cluster:cloudmarkup-beta-postgresql`,
      databaseSecretArn: `arn:aws:secretsmanager:${region}:${account}:secret:cloudmarkup-beta/database/admin-ABC123`,
      contentBucketName: `cloudmarkup-beta-${account}-${region}-content`,
      logGroup: logs.LogGroup.fromLogGroupName(
        stack,
        "Logs",
        "/aws/lambda/cloudmarkup-beta-project-content-cleanup",
      ),
      notifyFunctions: [],
      code: lambda.Code.fromInline(
        "exports.dispatchHandler = async () => ({enabled:false}); exports.workerHandler = async () => { throw Error('Disabled'); };",
      ),
    });
    const template = Template.fromStack(stack);
    for (const type of [
      "AWS::IAM::Role",
      "AWS::IAM::Policy",
      "AWS::Lambda::Permission",
      "AWS::SQS::QueuePolicy",
    ])
      template.resourceCountIs(type, 0);
    template.resourceCountIs("AWS::Lambda::Function", 2);
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 2);
    template.allResourcesProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          CLOUDMARKUP_CLEANUP_WAKE_ENABLED: "false",
          CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
          CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: "true",
        }),
      },
    });
    template.allResourcesProperties("AWS::Lambda::EventSourceMapping", {
      Enabled: false,
    });
    template.hasResourceProperties("AWS::Events::Rule", {
      State: "DISABLED",
      ScheduleExpression: "rate(1 minute)",
    });
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      BatchSize: 1,
      ScalingConfig: { MaximumConcurrency: 2 },
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: 2,
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
    });
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "cloudmarkup-beta-cleanup-wakes",
      SqsManagedSseEnabled: true,
      VisibilityTimeout: 1800,
    });
  });
  it("rejects shadow plus auto-pause and malformed preparation objects", () => {
    const base = config();
    const integration = {
      ...base.integrations,
      projectCleanupWake: { preparationEnabled: true },
    };
    expect(() =>
      defineEnvironmentConfig({
        ...base,
        integrations: integration,
        database: {
          ...base.database,
          betaAutoPauseEnabled: true,
          minCapacityAcu: 0,
          autoPauseMinutes: 5,
        },
      }),
    ).toThrow(/SQL recovery/u);
    expect(() =>
      defineEnvironmentConfig({
        ...base,
        integrations: {
          ...base.integrations,
          projectCleanupWake: { preparationEnabled: "true" } as unknown as {
            preparationEnabled: boolean;
          },
        },
      }),
    ).toThrow();
    expect(() =>
      defineEnvironmentConfig({
        ...base,
        integrations: {
          ...base.integrations,
          projectCleanupWake: { preparationEnabled: false, extra: true } as {
            preparationEnabled: boolean;
          },
        },
      }),
    ).toThrow();
  });
});
