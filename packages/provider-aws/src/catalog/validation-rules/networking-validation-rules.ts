import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";

const awsPublisher = "Amazon Web Services";

export const networkPlacementValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.network-placement",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: "aws.cloudmarkup.validation.evaluate-network-placement",
    serviceIds: [
      "aws.dynamodb.table",
      "aws.ec2.availability-zone",
      "aws.ec2.gateway-vpc-endpoint",
      "aws.ec2.internet-gateway",
      "aws.ec2.nat-gateway",
      "aws.ec2.route",
      "aws.ec2.route-table",
      "aws.ec2.route-table-association",
      "aws.ec2.security-group",
      "aws.ec2.security-group-egress-rule",
      "aws.ec2.security-group-ingress-rule",
      "aws.ec2.subnet",
      "aws.ec2.vpc",
      "aws.lambda.function",
      "aws.lambda.vpc-access-configuration",
      "aws.region.boundary",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.vpc.documentation.network-placement-validation",
        title: "What is Amazon VPC?",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html",
      },
      {
        kind: "official",
        id: "aws.vpc.documentation.subnet-cidr-validation",
        title: "Subnet CIDR blocks",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html",
      },
    ],
  });

export const networkRoutingValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.network-routing",
    interfaceVersion: 1,
    ruleVersion: "1.1.0",
    implementationId: "aws.cloudmarkup.validation.evaluate-network-routing",
    serviceIds: [
      "aws.ec2.gateway-vpc-endpoint",
      "aws.ec2.internet-gateway",
      "aws.ec2.nat-gateway",
      "aws.ec2.route",
      "aws.ec2.route-table",
      "aws.ec2.route-table-association",
      "aws.ec2.subnet",
      "aws.ec2.vpc",
      "aws.iam.policy-document",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.vpc.documentation.subnet-route-table-validation",
        title: "Subnet route tables",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html",
      },
      {
        kind: "official",
        id: "aws.vpc.documentation.gateway-endpoint-validation",
        title: "Gateway endpoints",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html",
      },
      {
        kind: "official",
        id: "aws.vpc.documentation.nat-cost-validation",
        title: "Pricing for NAT gateways",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-pricing.html",
      },
    ],
  });

export const securityGroupPolicyValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.security-group-policy",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId:
      "aws.cloudmarkup.validation.evaluate-security-group-policy",
    serviceIds: [
      "aws.ec2.security-group",
      "aws.ec2.security-group-egress-rule",
      "aws.ec2.security-group-ingress-rule",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.vpc.documentation.security-group-rule-validation",
        title: "Configure security group rules",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/working-with-security-group-rules.html",
      },
    ],
  });

export const lambdaVpcAccessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: "aws.cloudmarkup.validation.lambda-vpc-access",
    interfaceVersion: 1,
    ruleVersion: "1.1.0",
    implementationId: "aws.cloudmarkup.validation.evaluate-lambda-vpc-access",
    serviceIds: [
      "aws.ec2.gateway-vpc-endpoint",
      "aws.ec2.nat-gateway",
      "aws.ec2.route",
      "aws.ec2.route-table",
      "aws.ec2.route-table-association",
      "aws.ec2.vpc",
      "aws.ec2.security-group",
      "aws.ec2.subnet",
      "aws.iam.managed-policy-attachment",
      "aws.iam.role",
      "aws.lambda.function",
      "aws.lambda.vpc-access-configuration",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.vpc-access-validation",
        title: "Giving Lambda functions access to resources in an Amazon VPC",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html",
      },
      {
        kind: "official",
        id: "aws.lambda.documentation.vpc-internet-validation",
        title: "Enable internet access for VPC-connected Lambda functions",
        publisher: awsPublisher,
        url: "https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc-internet.html",
      },
    ],
  });

export const awsNetworkingValidationRuleDescriptorsV1 = [
  networkPlacementValidationRuleDescriptor,
  networkRoutingValidationRuleDescriptor,
  securityGroupPolicyValidationRuleDescriptor,
  lambdaVpcAccessValidationRuleDescriptor,
];
