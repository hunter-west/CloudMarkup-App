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

export interface ApplicationBuildProjectProps {
  readonly config: EnvironmentConfig;
  readonly names: PlatformResourceNames;
  readonly observability: ObservabilityStack;
  readonly serviceEndpoints: SharedBuildServiceEndpoints;
  readonly stateful: StatefulStack;
}

const buildCommand = "/opt/cloudmarkup/bin/application-build-service";

/**
 * Inert, synth-only CodeBuild definition for exact generated application builds.
 * It creates no trigger and grants no caller permission to start a build.
 */
export class ApplicationBuildProject extends Construct {
  public readonly project: codebuild.CfnProject;
  public readonly securityGroup: ec2.SecurityGroup;

  public constructor(
    scope: Construct,
    id: string,
    props: ApplicationBuildProjectProps,
  ) {
    super(scope, id);
    const stack = Stack.of(this);
    const inputPrefix = `${props.names.artifactPrefix}application-build/inputs/`;
    const outputPrefix = `${props.names.artifactPrefix}application-build/outputs/`;
    const evidencePrefix = `${props.names.evidencePrefix}application-build/`;
    const image = `${props.config.applicationBuild.image.repository}@${props.config.applicationBuild.image.digest}`;

    this.securityGroup = new ec2.SecurityGroup(this, "NetworkBoundary", {
      allowAllIpv6Outbound: false,
      allowAllOutbound: false,
      description:
        "No-public-egress boundary for CloudMarkup application builds",
      vpc: props.stateful.vpc,
    });

    const role = new iam.Role(this, "ServiceRole", {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      description:
        "CloudMarkup application-build role with no deployment, secret, or customer-role permissions",
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [
          `${props.observability.applicationBuildLogGroup.logGroupArn}:*`,
        ],
        sid: "WriteSanitizedBuildLogs",
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetBucketLocation"],
        resources: [props.stateful.contentBucket.bucketArn],
        sid: "ReadBuildBucketLocation",
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        resources: [
          props.stateful.contentBucket.arnForObjects(`${inputPrefix}*`),
        ],
        sid: "ReadImmutableBuildInputs",
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:PutObjectTagging"],
        resources: [
          props.stateful.contentBucket.arnForObjects(`${outputPrefix}*`),
          props.stateful.contentBucket.arnForObjects(`${evidencePrefix}*`),
        ],
        sid: "WriteBuildArtifactsAndEvidence",
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
            resourceName: "cloudmarkup/application-build",
            service: "ecr",
          }),
        ],
        sid: "PullApprovedApplicationBuildImage",
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
        sid: "AuthorizeApprovedBuildImagePull",
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
        sid: "UseIsolatedApplicationBuildNetwork",
      }),
    );

    props.serviceEndpoints.grantSandboxAccess({
      bucketArn: props.stateful.contentBucket.bucketArn,
      description: "Application build sandbox",
      logGroupArn: props.observability.applicationBuildLogGroup.logGroupArn,
      policySidPrefix: "ApplicationBuild",
      readObjectArns: [
        props.stateful.contentBucket.arnForObjects(`${inputPrefix}*`),
      ],
      role,
      securityGroup: this.securityGroup,
      writeObjectArns: [
        props.stateful.contentBucket.arnForObjects(`${outputPrefix}*`),
        props.stateful.contentBucket.arnForObjects(`${evidencePrefix}*`),
      ],
    });

    const limits = props.config.applicationBuild.limits;
    this.project = new codebuild.CfnProject(this, "Project", {
      artifacts: { type: "NO_ARTIFACTS" },
      autoRetryLimit: 0,
      badgeEnabled: false,
      cache: { type: "NO_CACHE" },
      concurrentBuildLimit: limits.concurrentBuilds,
      description:
        "Offline CloudMarkup generated application install, lint, type, test, scan, build, and package checks only",
      environment: {
        computeType: "BUILD_GENERAL1_MEDIUM",
        environmentVariables: [
          {
            name: "CLOUDMARKUP_CONTENT_BUCKET",
            type: "PLAINTEXT",
            value: props.stateful.contentBucket.bucketName,
          },
          {
            name: "CLOUDMARKUP_BUILD_INPUT_PREFIX",
            type: "PLAINTEXT",
            value: inputPrefix,
          },
          {
            name: "CLOUDMARKUP_BUILD_OUTPUT_PREFIX",
            type: "PLAINTEXT",
            value: outputPrefix,
          },
          {
            name: "CLOUDMARKUP_BUILD_EVIDENCE_PREFIX",
            type: "PLAINTEXT",
            value: evidencePrefix,
          },
          {
            name: "CLOUDMARKUP_BUILD_CPU_SECONDS",
            type: "PLAINTEXT",
            value: String(limits.cpuSeconds),
          },
          {
            name: "CLOUDMARKUP_BUILD_MEMORY_MIB",
            type: "PLAINTEXT",
            value: String(limits.memoryMiB),
          },
          {
            name: "CLOUDMARKUP_BUILD_MAX_ARTIFACT_BYTES",
            type: "PLAINTEXT",
            value: String(limits.maxArtifactBytes),
          },
          {
            name: "CLOUDMARKUP_BUILD_MAX_FILE_BYTES",
            type: "PLAINTEXT",
            value: String(limits.maxFileBytes),
          },
          {
            name: "CLOUDMARKUP_BUILD_MAX_FILES",
            type: "PLAINTEXT",
            value: String(limits.maxFiles),
          },
          {
            name: "CLOUDMARKUP_BUILD_MAX_MONTHLY_BUILD_MINUTES",
            type: "PLAINTEXT",
            value: String(limits.maxMonthlyBuildMinutes),
          },
          {
            name: "CLOUDMARKUP_BUILD_MAX_OUTPUT_BYTES",
            type: "PLAINTEXT",
            value: String(limits.maxOutputBytes),
          },
          {
            name: "CLOUDMARKUP_BUILD_MAX_PROCESSES",
            type: "PLAINTEXT",
            value: String(limits.maxProcesses),
          },
          {
            name: "CLOUDMARKUP_BUILD_MAX_TOTAL_FILE_BYTES",
            type: "PLAINTEXT",
            value: String(limits.maxTotalFileBytes),
          },
          {
            name: "CLOUDMARKUP_BUILD_WALL_TIME_MS",
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
          groupName: props.observability.applicationBuildLogGroup.logGroupName,
          status: "ENABLED",
          streamName: "build",
        },
        s3Logs: { status: "DISABLED" },
      },
      name: props.names.applicationBuildProject,
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
      props.observability.applicationBuildLogGroup,
      role,
      this.securityGroup,
      props.serviceEndpoints.logsEndpoint,
      props.serviceEndpoints.s3Endpoint,
    );
  }
}
