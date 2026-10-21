import { aws_ec2 as ec2, aws_iam as iam } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface SharedBuildServiceEndpointsProps {
  readonly vpc: ec2.IVpc;
}

export interface BuildSandboxEndpointAccess {
  readonly bucketArn: string;
  readonly description: string;
  readonly logGroupArn: string;
  readonly policySidPrefix: string;
  readonly readObjectArns: readonly string[];
  readonly role: iam.IRole;
  readonly securityGroup: ec2.ISecurityGroup;
  readonly writeObjectArns: readonly string[];
}

/**
 * Shared private-DNS endpoints for the isolated platform build sandboxes.
 * Endpoint policies retain role-specific object prefixes and log destinations;
 * sharing these endpoints does not grant either sandbox access to the other.
 */
export class SharedBuildServiceEndpoints extends Construct {
  public readonly logsEndpoint: ec2.InterfaceVpcEndpoint;
  public readonly s3Endpoint: ec2.InterfaceVpcEndpoint;
  public readonly securityGroup: ec2.SecurityGroup;

  public constructor(
    scope: Construct,
    id: string,
    props: SharedBuildServiceEndpointsProps,
  ) {
    super(scope, id);

    this.securityGroup = new ec2.SecurityGroup(this, "NetworkBoundary", {
      allowAllIpv6Outbound: false,
      allowAllOutbound: false,
      description:
        "Accept HTTPS only from approved CloudMarkup build sandboxes",
      vpc: props.vpc,
    });
    const endpointSubnets = {
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    } as const;
    this.s3Endpoint = new ec2.InterfaceVpcEndpoint(this, "S3Endpoint", {
      privateDnsEnabled: true,
      securityGroups: [this.securityGroup],
      service: ec2.InterfaceVpcEndpointAwsService.S3,
      subnets: endpointSubnets,
      vpc: props.vpc,
    });
    this.logsEndpoint = new ec2.InterfaceVpcEndpoint(
      this,
      "CloudWatchLogsEndpoint",
      {
        privateDnsEnabled: true,
        securityGroups: [this.securityGroup],
        service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
        subnets: endpointSubnets,
        vpc: props.vpc,
      },
    );
  }

  public grantSandboxAccess(access: BuildSandboxEndpointAccess): void {
    this.securityGroup.addIngressRule(
      access.securityGroup,
      ec2.Port.tcp(443),
      `${access.description} to approved AWS service endpoints`,
    );
    access.securityGroup.addEgressRule(
      this.securityGroup,
      ec2.Port.tcp(443),
      "Approved S3 and CloudWatch Logs endpoints only",
    );
    const principal = new iam.ArnPrincipal(access.role.roleArn);
    this.s3Endpoint.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetBucketLocation"],
        principals: [principal],
        resources: [access.bucketArn],
        sid: `${access.policySidPrefix}ReadBucketLocation`,
      }),
    );
    this.s3Endpoint.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        principals: [principal],
        resources: [...access.readObjectArns],
        sid: `${access.policySidPrefix}ReadInputs`,
      }),
    );
    this.s3Endpoint.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:PutObjectTagging"],
        principals: [principal],
        resources: [...access.writeObjectArns],
        sid: `${access.policySidPrefix}WriteOutputs`,
      }),
    );
    this.logsEndpoint.addToPolicy(
      new iam.PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        principals: [principal],
        resources: [`${access.logGroupArn}:*`],
        sid: `${access.policySidPrefix}WriteLogs`,
      }),
    );
  }
}
