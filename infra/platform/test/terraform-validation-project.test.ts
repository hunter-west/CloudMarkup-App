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

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function unknownArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value as unknown[];
}

function properties(
  template: Template,
  type: string,
): Record<string, unknown>[] {
  return Object.values(template.findResources(type)).map((resource) =>
    record(record(resource, "resource")["Properties"], "resource properties"),
  );
}

function literalActions(statement: Record<string, unknown>): string[] {
  const action = statement["Action"];
  return typeof action === "string"
    ? [action]
    : Array.isArray(action) &&
        action.every((entry) => typeof entry === "string")
      ? action
      : [];
}

function endpointStatements(
  endpoint: Record<string, unknown>,
): Record<string, unknown>[] {
  const policy = record(endpoint["PolicyDocument"], "endpoint policy");
  const statements = policy["Statement"];
  if (!Array.isArray(statements)) {
    throw new TypeError("endpoint policy statements are required");
  }
  return statements.map((statement) =>
    record(statement, "endpoint policy statement"),
  );
}

let application: Template;
let observability: Template;

beforeAll(() => {
  const stage = new CloudMarkupStage(
    createTemplateTestApp(),
    "TerraformValidationFixture",
    { config: createDevEnvironmentConfig() },
  );
  application = Template.fromStack(stage.application);
  observability = Template.fromStack(stage.observability);
}, 120_000);

describe("Terraform validation CodeBuild sandbox", () => {
  test("uses one pinned, unprivileged, bounded, no-source validation project", () => {
    const projects = properties(application, "AWS::CodeBuild::Project").filter(
      (project) => project["Name"] === "cloudmarkup-dev-terraform-validation",
    );
    expect(projects).toHaveLength(1);
    const project = projects[0];
    if (project === undefined) throw new TypeError("project is required");

    expect(project).toEqual(
      expect.objectContaining({
        Artifacts: { Type: "NO_ARTIFACTS" },
        AutoRetryLimit: 0,
        BadgeEnabled: false,
        Cache: { Type: "NO_CACHE" },
        ConcurrentBuildLimit: 1,
        Name: "cloudmarkup-dev-terraform-validation",
        QueuedTimeoutInMinutes: 10,
        TimeoutInMinutes: 15,
      }),
    );
    const environment = record(project["Environment"], "environment");
    expect(environment).toEqual(
      expect.objectContaining({
        ComputeType: "BUILD_GENERAL1_SMALL",
        Image:
          "000000000000.dkr.ecr.us-east-1.amazonaws.com/cloudmarkup/terraform-validation@sha256:1f2e3d4c5b6a79800123456789abcdef1f2e3d4c5b6a79800123456789abcdef",
        ImagePullCredentialsType: "SERVICE_ROLE",
        PrivilegedMode: false,
        Type: "LINUX_CONTAINER",
      }),
    );
    const variables = environment["EnvironmentVariables"];
    if (!Array.isArray(variables)) {
      throw new TypeError("environment variables are required");
    }
    const byName = new Map(
      variables.map((entry) => {
        const variable = record(entry, "environment variable");
        return [variable["Name"], variable["Value"]] as const;
      }),
    );
    expect(byName.get("CLOUDMARKUP_VALIDATION_CPU_SECONDS")).toBe("60");
    expect(byName.get("CLOUDMARKUP_VALIDATION_MEMORY_MIB")).toBe("1024");
    expect(byName.get("CLOUDMARKUP_VALIDATION_MAX_OUTPUT_BYTES")).toBe(
      "1048576",
    );
    expect(byName.get("CLOUDMARKUP_VALIDATION_MAX_MONTHLY_BUILD_MINUTES")).toBe(
      "300",
    );
    expect(
      [...byName.keys()].some((key) => String(key).startsWith("AWS_")),
    ).toBe(false);

    const source = record(project["Source"], "source");
    expect(source["Type"]).toBe("NO_SOURCE");
    expect(JSON.parse(String(source["BuildSpec"]))).toEqual({
      phases: {
        build: {
          commands: ["/opt/cloudmarkup/bin/terraform-validation-service"],
        },
      },
      version: "0.2",
    });
    expect(JSON.stringify(project)).not.toMatch(
      /\b(?:terraform\s+(?:apply|plan)|cdk\s+deploy)\b/iu,
    );
  });

  test("shares exactly two private endpoints while preserving both sandboxes' bounded access", () => {
    const projects = properties(application, "AWS::CodeBuild::Project");
    const buildProjects = projects.filter((candidate) =>
      new Set([
        "cloudmarkup-dev-application-build",
        "cloudmarkup-dev-terraform-validation",
      ]).has(String(candidate["Name"])),
    );
    expect(buildProjects).toHaveLength(2);
    const projectSecurityGroups = buildProjects.map((project) => {
      const vpc = record(project["VpcConfig"], "VPC configuration");
      expect(vpc["SecurityGroupIds"]).toHaveLength(1);
      expect(vpc["Subnets"]).toHaveLength(2);
      const securityGroups = unknownArray(
        vpc["SecurityGroupIds"],
        "project security groups",
      );
      const securityGroup = securityGroups[0];
      if (securityGroup === undefined) {
        throw new TypeError("project security group is required");
      }
      return securityGroup;
    });
    expect(
      new Set(projectSecurityGroups.map((group) => JSON.stringify(group))).size,
    ).toBe(2);

    const endpoints = properties(application, "AWS::EC2::VPCEndpoint");
    expect(endpoints).toHaveLength(2);
    expect(
      endpoints.every((endpoint) => endpoint["PrivateDnsEnabled"] === true),
    ).toBe(true);
    const s3Endpoint = endpoints.find((endpoint) =>
      JSON.stringify(endpoint["ServiceName"]).includes(".s3"),
    );
    const logsEndpoint = endpoints.find((endpoint) =>
      JSON.stringify(endpoint["ServiceName"]).includes(".logs"),
    );
    expect(s3Endpoint).toBeDefined();
    expect(logsEndpoint).toBeDefined();
    if (s3Endpoint === undefined || logsEndpoint === undefined) {
      throw new TypeError("both shared endpoints are required");
    }
    const endpointSecurityGroups = endpoints.map((endpoint) =>
      unknownArray(endpoint["SecurityGroupIds"], "endpoint security groups"),
    );
    expect(endpointSecurityGroups[0]).toEqual(endpointSecurityGroups[1]);
    const sharedGroups = endpointSecurityGroups[0];
    const sharedSecurityGroup = sharedGroups?.[0];
    if (sharedSecurityGroup === undefined) {
      throw new TypeError("shared endpoint security group is required");
    }

    const egress = properties(application, "AWS::EC2::SecurityGroupEgress");
    expect(egress).toHaveLength(2);
    expect(
      egress.every(
        (entry) =>
          entry["FromPort"] === 443 &&
          entry["IpProtocol"] === "tcp" &&
          entry["ToPort"] === 443,
      ),
    ).toBe(true);
    expect(
      egress.every(
        (entry) =>
          JSON.stringify(entry["DestinationSecurityGroupId"]) ===
          JSON.stringify(sharedSecurityGroup),
      ),
    ).toBe(true);
    expect(
      new Set(egress.map((entry) => JSON.stringify(entry["GroupId"]))),
    ).toEqual(
      new Set(projectSecurityGroups.map((group) => JSON.stringify(group))),
    );

    const ingress = properties(application, "AWS::EC2::SecurityGroupIngress");
    expect(ingress).toHaveLength(2);
    expect(
      ingress.every(
        (entry) =>
          entry["FromPort"] === 443 &&
          entry["IpProtocol"] === "tcp" &&
          entry["ToPort"] === 443 &&
          JSON.stringify(entry["GroupId"]) ===
            JSON.stringify(sharedSecurityGroup),
      ),
    ).toBe(true);
    expect(
      new Set(
        ingress.map((entry) => JSON.stringify(entry["SourceSecurityGroupId"])),
      ),
    ).toEqual(
      new Set(projectSecurityGroups.map((group) => JSON.stringify(group))),
    );

    const s3Statements = endpointStatements(s3Endpoint);
    expect(new Set(s3Statements.map((statement) => statement["Sid"]))).toEqual(
      new Set([
        "ApplicationBuildReadBucketLocation",
        "ApplicationBuildReadInputs",
        "ApplicationBuildWriteOutputs",
        "TerraformValidationReadBucketLocation",
        "TerraformValidationReadInputs",
        "TerraformValidationWriteOutputs",
      ]),
    );
    const logsStatements = endpointStatements(logsEndpoint);
    expect(
      new Set(logsStatements.map((statement) => statement["Sid"])),
    ).toEqual(
      new Set(["ApplicationBuildWriteLogs", "TerraformValidationWriteLogs"]),
    );

    const bySid = new Map(
      [...s3Statements, ...logsStatements].map((statement) => [
        String(statement["Sid"]),
        statement,
      ]),
    );
    for (const [sid, roleMarker, forbiddenRoleMarker] of [
      ["ApplicationBuildReadBucketLocation", "ApplicationBuild", "Terraform"],
      ["ApplicationBuildReadInputs", "ApplicationBuild", "Terraform"],
      ["ApplicationBuildWriteOutputs", "ApplicationBuild", "Terraform"],
      ["ApplicationBuildWriteLogs", "ApplicationBuild", "Terraform"],
      [
        "TerraformValidationReadBucketLocation",
        "TerraformValidation",
        "ApplicationBuild",
      ],
      [
        "TerraformValidationReadInputs",
        "TerraformValidation",
        "ApplicationBuild",
      ],
      [
        "TerraformValidationWriteOutputs",
        "TerraformValidation",
        "ApplicationBuild",
      ],
      [
        "TerraformValidationWriteLogs",
        "TerraformValidation",
        "ApplicationBuild",
      ],
    ] as const) {
      const statement = bySid.get(sid);
      expect(statement).toBeDefined();
      const principal = JSON.stringify(statement?.["Principal"]);
      expect(principal).toContain(roleMarker);
      expect(principal).not.toContain(forbiddenRoleMarker);
    }

    const applicationRead = JSON.stringify(
      bySid.get("ApplicationBuildReadInputs"),
    );
    const applicationWrite = JSON.stringify(
      bySid.get("ApplicationBuildWriteOutputs"),
    );
    const validationRead = JSON.stringify(
      bySid.get("TerraformValidationReadInputs"),
    );
    const validationWrite = JSON.stringify(
      bySid.get("TerraformValidationWriteOutputs"),
    );
    expect(applicationRead).toContain("application-build/inputs/");
    expect(applicationRead).not.toContain("terraform-validation/");
    expect(applicationWrite).toContain("application-build/outputs/");
    expect(applicationWrite).toContain(
      "evidence/v1/organizations/application-build/",
    );
    expect(applicationWrite).not.toContain("terraform-validation/");
    expect(validationRead).toContain("terraform-validation/inputs/");
    expect(validationRead).not.toContain("application-build/");
    expect(validationWrite).toContain(
      "evidence/v1/organizations/terraform-validation/",
    );
    expect(validationWrite).not.toContain("application-build/");
    expect(JSON.stringify(bySid.get("ApplicationBuildWriteLogs"))).toContain(
      "ApplicationBuildLogs",
    );
    expect(JSON.stringify(bySid.get("TerraformValidationWriteLogs"))).toContain(
      "TerraformValidationLogs",
    );
    expect(JSON.stringify(application.toJSON())).not.toContain(
      '"CidrIp":"0.0.0.0/0"',
    );
  });

  test("uses exact platform-only IAM without deployment or customer-role access", () => {
    const roles = Object.entries(application.findResources("AWS::IAM::Role"));
    const validationRole = roles.find(([, resource]) => {
      const serialized = JSON.stringify(resource);
      return (
        serialized.includes("codebuild.amazonaws.com") &&
        serialized.includes("Terraform static-validation")
      );
    });
    expect(validationRole).toBeDefined();
    const logicalId = validationRole?.[0];
    if (logicalId === undefined) throw new TypeError("role is required");

    const policies = properties(application, "AWS::IAM::Policy").filter(
      (policy) => JSON.stringify(policy["Roles"]).includes(logicalId),
    );
    const statements = policies.flatMap((policy) => {
      const document = record(policy["PolicyDocument"], "policy document");
      const raw = document["Statement"];
      if (!Array.isArray(raw)) throw new TypeError("statements are required");
      return raw.map((entry) => record(entry, "statement"));
    });
    const actions = statements.flatMap(literalActions);
    expect(actions).toEqual(
      expect.arrayContaining([
        "ec2:CreateNetworkInterface",
        "ecr:BatchGetImage",
        "logs:PutLogEvents",
        "s3:GetObjectVersion",
        "s3:PutObject",
      ]),
    );
    expect(actions).not.toEqual(
      expect.arrayContaining([
        "sts:AssumeRole",
        "cloudformation:CreateStack",
        "codebuild:StartBuild",
        "iam:PassRole",
      ]),
    );
    expect(actions.some((action) => action.includes("*"))).toBe(false);

    const wildcardStatements = statements.filter(
      (statement) => statement["Resource"] === "*",
    );
    expect(wildcardStatements).toHaveLength(2);
    const eniStatement = wildcardStatements.find((statement) =>
      literalActions(statement).includes("ec2:CreateNetworkInterface"),
    );
    expect(eniStatement?.["Condition"]).toEqual({
      StringEquals: { "aws:RequestedRegion": "us-east-1" },
    });

    const serialized = JSON.stringify(policies);
    expect(serialized).toContain(
      "artifacts/v1/organizations/terraform-validation/inputs/",
    );
    expect(serialized).toContain(
      "evidence/v1/organizations/terraform-validation/",
    );
    expect(serialized).not.toContain("documents/v1/organizations/");
  });

  test("owns a bounded log group and creates no invocation trigger", () => {
    expect(
      properties(observability, "AWS::Logs::LogGroup").some(
        (group) =>
          group["LogGroupName"] ===
            "/aws/codebuild/cloudmarkup-dev-terraform-validation" &&
          group["RetentionInDays"] === 30,
      ),
    ).toBe(true);
    expect(application.findResources("AWS::Events::Rule")).toEqual({});
    expect(JSON.stringify(application.toJSON())).not.toContain(
      '"codebuild:StartBuild"',
    );
  });
});

describe("Terraform validation platform configuration", () => {
  test.each([
    [
      "image digest",
      (config: Mutable<EnvironmentConfig>) => {
        config.terraformValidation.image.digest = "latest";
      },
    ],
    [
      "image repository",
      (config: Mutable<EnvironmentConfig>) => {
        config.terraformValidation.image.repository =
          "111122223333.dkr.ecr.us-east-1.amazonaws.com/cloudmarkup/terraform-validation";
      },
    ],
    [
      "command wall time",
      (config: Mutable<EnvironmentConfig>) => {
        config.terraformValidation.limits.wallTimeMilliseconds =
          config.terraformValidation.limits.timeoutMinutes * 60_000;
      },
    ],
    [
      "concurrency",
      (config: Mutable<EnvironmentConfig>) => {
        config.terraformValidation.limits.concurrentBuilds = 11;
      },
    ],
  ])("rejects an invalid %s", (_label, mutate) => {
    const config = structuredClone(
      baseEnvironmentConfig("dev", {
        account: "000000000000",
        region: "us-east-1",
      }),
    ) as Mutable<EnvironmentConfig>;
    mutate(config);
    expect(() => defineEnvironmentConfig(config)).toThrow(
      /Invalid CloudMarkup environment configuration/u,
    );
  });
});
