import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, test } from "vitest";

import {
  baseEnvironmentConfig,
  defineEnvironmentConfig,
  type EnvironmentConfig,
} from "../lib/config/environment-config.js";
import { createDevEnvironmentConfig } from "../lib/config/environments/dev.js";
import { CloudMarkupStage } from "../lib/stages/cloudmarkup-stage.js";
import { createTemplateTestApp } from "./template-test-app.js";

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends object ? Mutable<T[Key]> : T[Key];
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object.");
  }
  return value as Record<string, unknown>;
}

function properties(
  template: Template,
  type: string,
): Record<string, unknown>[] {
  return Object.values(template.findResources(type)).map((resource) =>
    record(record(resource)["Properties"]),
  );
}

function actions(statement: Record<string, unknown>): string[] {
  const value = statement["Action"];
  return typeof value === "string"
    ? [value]
    : Array.isArray(value) && value.every((entry) => typeof entry === "string")
      ? value
      : [];
}

let application: Template;
let observability: Template;

beforeAll(() => {
  const stage = new CloudMarkupStage(
    createTemplateTestApp(),
    "ApplicationBuildFixture",
    { config: createDevEnvironmentConfig() },
  );
  application = Template.fromStack(stage.application);
  observability = Template.fromStack(stage.observability);
}, 120_000);

describe("application build CodeBuild sandbox", () => {
  test("is pinned, unprivileged, bounded, inert, and separate from Terraform validation", () => {
    const project = properties(application, "AWS::CodeBuild::Project").find(
      (candidate) => candidate["Name"] === "cloudmarkup-dev-application-build",
    );
    expect(project).toBeDefined();
    if (project === undefined) throw new TypeError("Project is required.");
    expect(project).toEqual(
      expect.objectContaining({
        Artifacts: { Type: "NO_ARTIFACTS" },
        AutoRetryLimit: 0,
        BadgeEnabled: false,
        Cache: { Type: "NO_CACHE" },
        ConcurrentBuildLimit: 1,
        Name: "cloudmarkup-dev-application-build",
        QueuedTimeoutInMinutes: 10,
        TimeoutInMinutes: 30,
      }),
    );
    const environment = record(project["Environment"]);
    expect(environment).toEqual(
      expect.objectContaining({
        ComputeType: "BUILD_GENERAL1_MEDIUM",
        Image:
          "000000000000.dkr.ecr.us-east-1.amazonaws.com/cloudmarkup/application-build@sha256:2a3b4c5d6e7f8901123456789abcdef02a3b4c5d6e7f8901123456789abcdef0",
        ImagePullCredentialsType: "SERVICE_ROLE",
        PrivilegedMode: false,
        Type: "LINUX_CONTAINER",
      }),
    );
    const variables = environment["EnvironmentVariables"];
    if (!Array.isArray(variables))
      throw new TypeError("Variables are required.");
    const byName = new Map(
      variables.map((entry) => {
        const variable = record(entry);
        return [variable["Name"], variable["Value"]] as const;
      }),
    );
    expect(byName.get("CLOUDMARKUP_BUILD_CPU_SECONDS")).toBe("300");
    expect(byName.get("CLOUDMARKUP_BUILD_MEMORY_MIB")).toBe("4096");
    expect(byName.get("CLOUDMARKUP_BUILD_MAX_ARTIFACT_BYTES")).toBe("67108864");
    expect(byName.get("CLOUDMARKUP_BUILD_MAX_MONTHLY_BUILD_MINUTES")).toBe(
      "600",
    );
    expect(
      [...byName.keys()].some((name) => String(name).startsWith("AWS_")),
    ).toBe(false);
    expect(JSON.parse(String(record(project["Source"])["BuildSpec"]))).toEqual({
      phases: {
        build: { commands: ["/opt/cloudmarkup/bin/application-build-service"] },
      },
      version: "0.2",
    });
    expect(record(project["Source"])["Type"]).toBe("NO_SOURCE");
    expect(JSON.stringify(project)).not.toMatch(
      /\b(?:terraform\s+(?:apply|plan)|cdk\s+deploy|aws\s+lambda\s+update)\b/iu,
    );
  });

  test("uses a distinct least-privilege role and isolated artifact prefixes", () => {
    const role = Object.entries(
      application.findResources("AWS::IAM::Role"),
    ).find(([, resource]) =>
      JSON.stringify(resource).includes("application-build role"),
    );
    expect(role).toBeDefined();
    const logicalId = role?.[0];
    if (logicalId === undefined) throw new TypeError("Role is required.");
    const policies = properties(application, "AWS::IAM::Policy").filter(
      (policy) => JSON.stringify(policy["Roles"]).includes(logicalId),
    );
    const statements = policies.flatMap((policy) => {
      const raw = record(policy["PolicyDocument"])["Statement"];
      if (!Array.isArray(raw)) throw new TypeError("Statements are required.");
      return raw.map(record);
    });
    const allowedActions = statements.flatMap(actions);
    expect(allowedActions).toEqual(
      expect.arrayContaining([
        "ec2:CreateNetworkInterface",
        "ecr:BatchGetImage",
        "logs:PutLogEvents",
        "s3:GetObjectVersion",
        "s3:PutObject",
      ]),
    );
    expect(allowedActions).not.toEqual(
      expect.arrayContaining([
        "sts:AssumeRole",
        "iam:PassRole",
        "secretsmanager:GetSecretValue",
        "cloudformation:CreateStack",
        "lambda:UpdateFunctionCode",
        "codebuild:StartBuild",
      ]),
    );
    const serialized = JSON.stringify(policies);
    expect(serialized).toContain(
      "artifacts/v1/organizations/application-build/inputs/",
    );
    expect(serialized).toContain(
      "artifacts/v1/organizations/application-build/outputs/",
    );
    expect(serialized).toContain(
      "evidence/v1/organizations/application-build/",
    );
    expect(serialized).not.toContain("terraform-validation/inputs/");
    expect(serialized).not.toContain("documents/v1/organizations/");
  });

  test("has no public egress, trigger, or deployment permission", () => {
    expect(properties(application, "AWS::EC2::VPCEndpoint")).toHaveLength(2);
    expect(JSON.stringify(application.toJSON())).not.toContain(
      '"CidrIp":"0.0.0.0/0"',
    );
    expect(application.findResources("AWS::Events::Rule")).toEqual({});
    expect(JSON.stringify(application.toJSON())).not.toContain(
      '"codebuild:StartBuild"',
    );
    expect(
      properties(observability, "AWS::Logs::LogGroup").some(
        (group) =>
          group["LogGroupName"] ===
            "/aws/codebuild/cloudmarkup-dev-application-build" &&
          group["RetentionInDays"] === 30,
      ),
    ).toBe(true);
  });
});

describe("application build platform configuration", () => {
  test.each([
    [
      "image digest",
      (config: Mutable<EnvironmentConfig>) => {
        config.applicationBuild.image.digest = "latest";
      },
    ],
    [
      "image repository",
      (config: Mutable<EnvironmentConfig>) => {
        config.applicationBuild.image.repository =
          "111122223333.dkr.ecr.us-east-1.amazonaws.com/cloudmarkup/application-build";
      },
    ],
    [
      "wall time",
      (config: Mutable<EnvironmentConfig>) => {
        config.applicationBuild.limits.wallTimeMilliseconds =
          config.applicationBuild.limits.timeoutMinutes * 60_000;
      },
    ],
    [
      "concurrency",
      (config: Mutable<EnvironmentConfig>) => {
        config.applicationBuild.limits.concurrentBuilds = 11;
      },
    ],
  ])("rejects an invalid %s", (_label, mutate) => {
    const config = structuredClone(
      baseEnvironmentConfig("dev", {
        account: "000000000000",
        region: "us-east-1",
      }),
    ) as Mutable<EnvironmentConfig>;
    if (_label === "wall time") {
      config.applicationBuild.limits.timeoutMinutes = 15;
      config.applicationBuild.limits.wallTimeMilliseconds = 899_999;
      const valid = defineEnvironmentConfig(config);
      expect(valid.applicationBuild.limits).toMatchObject({
        timeoutMinutes: 15,
        wallTimeMilliseconds: 899_999,
      });
    }
    mutate(config);
    expect(() => defineEnvironmentConfig(config)).toThrow(
      _label === "wall time"
        ? /^Invalid CloudMarkup environment configuration: Application command wall time must remain below the CodeBuild timeout\.$/u
        : /Invalid CloudMarkup environment configuration/u,
    );
  });
});
