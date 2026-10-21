import {
  Stack,
  aws_codebuild as codebuild,
  aws_ec2 as ec2,
  aws_iam as iam,
} from "aws-cdk-lib";
import { Construct } from "constructs";

import type { EnvironmentConfig } from "../config/environment-config.js";
import type { PlatformResourceNames } from "../platform-names.js";
import type { ObservabilityStack } from "../stacks/observability-stack.js";
import type { StatefulStack } from "../stacks/stateful-stack.js";
import type { SharedBuildServiceEndpoints } from "./shared-build-service-endpoints.js";

export interface TerraformValidationProjectProps {
  readonly config: EnvironmentConfig;
  readonly names: PlatformResourceNames;
  readonly observability: ObservabilityStack;
  readonly serviceEndpoints: SharedBuildServiceEndpoints;
  readonly stateful: StatefulStack;
}

const buildCommand = "/opt/cloudmarkup/bin/terraform-validation-service";

/**
 * Inert, synth-only CodeBuild definition for bounded offline Terraform checks.
 * A later authorized worker may submit immutable object references; this
 * construct creates no trigger and grants no caller permission to start it.
 */
export class TerraformValidationProject extends Construct {
  public readonly project: codebuild.CfnProject;
  public readonly securityGroup: ec2.SecurityGroup;

  public constructor(
    scope: Construct,
    id: string,
    props: TerraformValidationProjectProps,
  ) {
    super(scope, id);

    const stack = Stack.of(this);
    const inputPrefix = `${props.names.artifactPrefix}terraform-validation/inputs/`;
    const evidencePrefix = `${props.names.evidencePrefix}terraform-validation/`;
    const image = `${props.config.terraformValidation.image.repository}@${props.config.terraformValidation.image.digest}`;

    this.securityGroup = new ec2.SecurityGroup(this, "NetworkBoundary", {
      allowAllIpv6Outbound: false,
      allowAllOutbound: false,
      description:
        "No-egress boundary for CloudMarkup Terraform static validation",
      vpc: props.stateful.vpc,
    });

    const role = new iam.Role(this, "ServiceRole", {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      description:
        "CloudMarkup Terraform static-validation role with no deployment or customer-role permissions",
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [
          `${props.observability.terraformValidationLogGroup.logGroupArn}:*`,
        ],
        sid: "WriteSanitizedValidationLogs",
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetBucketLocation"],
        resources: [props.stateful.contentBucket.bucketArn],
        sid: "ReadValidationBucketLocation",
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        resources: [
          props.stateful.contentBucket.arnForObjects(`${inputPrefix}*`),
        ],
        sid: "ReadImmutableValidationInputs",
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:PutObjectTagging"],
        resources: [
          props.stateful.contentBucket.arnForObjects(`${evidencePrefix}*`),
        ],
        sid: "WriteValidationEvidence",
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ],
        resources: [
          stack.formatArn({
            resource: "repository",
            resourceName: "cloudmarkup/terraform-validation",
            service: "ecr",
          }),
        ],
        sid: "PullApprovedValidationImage",
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
        sid: "AuthorizeApprovedValidationImagePull",
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ec2:CreateNetworkInterface",
          "ec2:DeleteNetworkInterface",
          "ec2:DescribeDhcpOptions",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSubnets",
          "ec2:DescribeVpcs",
        ],
        conditions: {
          StringEquals: { "aws:RequestedRegion": stack.region },
        },
        resources: ["*"],
        sid: "UseIsolatedValidationNetwork",
      }),
    );

    props.serviceEndpoints.grantSandboxAccess({
      bucketArn: props.stateful.contentBucket.bucketArn,
      description: "Terraform validation sandbox",
      logGroupArn: props.observability.terraformValidationLogGroup.logGroupArn,
      policySidPrefix: "TerraformValidation",
      readObjectArns: [
        props.stateful.contentBucket.arnForObjects(`${inputPrefix}*`),
      ],
      role,
      securityGroup: this.securityGroup,
      writeObjectArns: [
        props.stateful.contentBucket.arnForObjects(`${evidencePrefix}*`),
      ],
    });

    const limits = props.config.terraformValidation.limits;
    this.project = new codebuild.CfnProject(this, "Project", {
      artifacts: { type: "NO_ARTIFACTS" },
      autoRetryLimit: 0,
      badgeEnabled: false,
      cache: { type: "NO_CACHE" },
      concurrentBuildLimit: limits.concurrentBuilds,
      description:
        "Offline CloudMarkup Terraform formatting, initialization, validation, lint, and static-security checks only",
      environment: {
        computeType: "BUILD_GENERAL1_SMALL",
        environmentVariables: [
          {
            name: "CLOUDMARKUP_CONTENT_BUCKET",
            type: "PLAINTEXT",
            value: props.stateful.contentBucket.bucketName,
          },
          {
            name: "CLOUDMARKUP_VALIDATION_EVIDENCE_PREFIX",
            type: "PLAINTEXT",
            value: evidencePrefix,
          },
          {
            name: "CLOUDMARKUP_VALIDATION_INPUT_PREFIX",
            type: "PLAINTEXT",
            value: inputPrefix,
          },
          {
            name: "CLOUDMARKUP_VALIDATION_CPU_SECONDS",
            type: "PLAINTEXT",
            value: String(limits.cpuSeconds),
          },
          {
            name: "CLOUDMARKUP_VALIDATION_MEMORY_MIB",
            type: "PLAINTEXT",
            value: String(limits.memoryMiB),
          },
          {
            name: "CLOUDMARKUP_VALIDATION_MAX_MONTHLY_BUILD_MINUTES",
            type: "PLAINTEXT",
            value: String(limits.maxMonthlyBuildMinutes),
          },
          {
            name: "CLOUDMARKUP_VALIDATION_MAX_PROCESSES",
            type: "PLAINTEXT",
            value: String(limits.maxProcesses),
          },
          {
            name: "CLOUDMARKUP_VALIDATION_MAX_FILE_BYTES",
            type: "PLAINTEXT",
            value: String(limits.maxFileBytes),
          },
          {
            name: "CLOUDMARKUP_VALIDATION_MAX_FILES",
            type: "PLAINTEXT",
            value: String(limits.maxFiles),
          },
          {
            name: "CLOUDMARKUP_VALIDATION_MAX_OUTPUT_BYTES",
            type: "PLAINTEXT",
            value: String(limits.maxOutputBytes),
          },
          {
            name: "CLOUDMARKUP_VALIDATION_MAX_TOTAL_FILE_BYTES",
            type: "PLAINTEXT",
            value: String(limits.maxTotalFileBytes),
          },
          {
            name: "CLOUDMARKUP_VALIDATION_WALL_TIME_MS",
            type: "PLAINTEXT",
            value: String(limits.wallTimeMilliseconds),
          },
        ],
        image,
        imagePullCredentialsType: "SERVICE_ROLE",
        privilegedMode: false,
        type: "LINUX_CONTAINER",
      },
      fileSystemLocations: [],
      logsConfig: {
        cloudWatchLogs: {
          groupName:
            props.observability.terraformValidationLogGroup.logGroupName,
          status: "ENABLED",
          streamName: "validation",
        },
        s3Logs: { status: "DISABLED" },
      },
      name: props.names.terraformValidationProject,
      queuedTimeoutInMinutes: limits.queuedTimeoutMinutes,
      serviceRole: role.roleArn,
      source: {
        buildSpec: JSON.stringify({
          phases: { build: { commands: [buildCommand] } },
          version: "0.2",
        }),
        type: "NO_SOURCE",
      },
      timeoutInMinutes: limits.timeoutMinutes,
      vpcConfig: {
        securityGroupIds: [this.securityGroup.securityGroupId],
        subnets: props.stateful.vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }).subnetIds,
        vpcId: props.stateful.vpc.vpcId,
      },
    });
    this.project.node.addDependency(
      props.observability.terraformValidationLogGroup,
      role,
      this.securityGroup,
      props.serviceEndpoints.logsEndpoint,
      props.serviceEndpoints.s3Endpoint,
    );
  }
}
