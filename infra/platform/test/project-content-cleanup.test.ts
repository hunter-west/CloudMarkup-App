import { Stack, aws_logs as logs } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ProjectContentCleanup } from "../lib/constructs/project-content-cleanup.js";
import { createTemplateTestApp } from "./template-test-app.js";

describe("authorized beta project cleanup infrastructure", () => {
  it("enables both guarded activation controls, uses an immutable role and admits only its exact schedule", () => {
    const account = "000000000000",
      region = "us-east-1";
    const stack = new Stack(createTemplateTestApp(), "CleanupFixture", {
      env: { account, region },
    });
    const name = "cloudmarkup-beta-project-content-cleanup";
    new ProjectContentCleanup(stack, "Cleanup", {
      account,
      region,
      databaseArn: `arn:aws:rds:${region}:${account}:cluster:cloudmarkup-beta-postgresql`,
      databaseSecretArn: `arn:aws:secretsmanager:${region}:${account}:secret:cloudmarkup-beta/database/admin-ABC123`,
      contentBucketName: `cloudmarkup-beta-${account}-${region}-content`,
      logGroup: logs.LogGroup.fromLogGroupName(
        stack,
        "Logs",
        `/aws/lambda/${name}`,
      ),
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::IAM::Role", 0);
    template.resourceCountIs("AWS::IAM::Policy", 0);
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.resourceCountIs("AWS::Events::Rule", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: name,
      Timeout: 300,
      ReservedConcurrentExecutions: 1,
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Role: {
        "Fn::Join": [
          "",
          [
            "arn:",
            { Ref: "AWS::Partition" },
            `:iam::${account}:role/CloudMarkup-Beta-Project-Cleanup-Runtime`,
          ],
        ],
      },
      Environment: {
        Variables: Match.objectLike({
          CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: "true",
          CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
          CLOUDMARKUP_CONTENT_BUCKET: `cloudmarkup-beta-${account}-${region}-content`,
        }),
      },
    });
    template.hasResourceProperties("AWS::Events::Rule", {
      Name: name,
      State: "ENABLED",
      ScheduleExpression: "rate(1 minute)",
      Targets: [
        Match.objectLike({
          RetryPolicy: {
            MaximumEventAgeInSeconds: 300,
            MaximumRetryAttempts: 0,
          },
        }),
      ],
    });
    template.resourceCountIs("AWS::Lambda::Permission", 1);
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com",
      SourceAccount: account,
      SourceArn: `arn:aws:events:${region}:${account}:rule/${name}`,
    });
    expect(JSON.stringify(template.toJSON())).not.toMatch(
      /FunctionUrl|bedrock:|s3:PutObject|secretsmanager:GetSecretValue/u,
    );
  }, 30_000);
});
