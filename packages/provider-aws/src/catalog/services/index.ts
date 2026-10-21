import { awsFsxServices, extendServiceForFsx } from "./fsx.js";
import type { ProviderServiceDefinitionV1 } from "@cloudmarkup/provider-sdk";

import { apiGatewayHttpApi } from "./api-gateway-http-api.js";
import { availabilityZone } from "./availability-zone.js";
import { cloudWatchLogGroup } from "./cloudwatch-log-group.js";
import { cloudWatchMetricAlarm } from "./cloudwatch-metric-alarm.js";
import { cognitoUserPool } from "./cognito-user-pool.js";
import { cognitoUserPoolClient } from "./cognito-user-pool-client.js";
import { dynamodbTable } from "./dynamodb-table.js";
import {
  eventBridgeBus,
  eventBridgeRule,
  eventBridgeTarget,
  eventBridgeRule0_11_0,
} from "./eventbridge-eventing.js";
import { gatewayVpcEndpoint } from "./gateway-vpc-endpoint.js";
import { iamManagedPolicyAttachment } from "./iam-managed-policy-attachment.js";
import {
  iamPolicyCondition,
  iamPolicyCondition0_16_0,
} from "./iam-policy-condition.js";
import {
  iamPolicyDocument,
  iamPolicyDocument0_16_0,
} from "./iam-policy-document.js";
import {
  iamPolicyStatement,
  iamPolicyStatement0_16_0,
} from "./iam-policy-statement.js";
import { iamRole } from "./iam-role.js";
import { internetGateway } from "./internet-gateway.js";
import { lambdaFunction } from "./lambda-function.js";
import { lambdaVpcAccessConfiguration } from "./lambda-vpc-access-configuration.js";
import { natGateway } from "./nat-gateway.js";
import { regionBoundary } from "./region-boundary.js";
import { route } from "./route.js";
import { routeTable } from "./route-table.js";
import { routeTableAssociation } from "./route-table-association.js";
import { securityGroup } from "./security-group.js";
import { securityGroupEgressRule } from "./security-group-egress-rule.js";
import {
  s3Bucket,
  s3BucketCorsConfiguration,
  s3BucketLifecycleConfiguration,
  s3BucketNotificationConfiguration,
} from "./s3-eventing.js";
import { snsSubscription, snsTopic } from "./sns-eventing.js";
import { sqsQueue, sqsRedriveConfiguration } from "./sqs-eventing.js";
import {
  stepFunctionsStateMachine,
  stepFunctionsStateMachine0_11_0,
} from "./step-functions-eventing.js";
import { securityGroupIngressRule } from "./security-group-ingress-rule.js";
import { subnet } from "./subnet.js";
import { vpc } from "./vpc.js";

const awsEventServices0_11_0: ProviderServiceDefinitionV1[] = [
  s3Bucket,
  s3BucketLifecycleConfiguration,
  s3BucketCorsConfiguration,
  s3BucketNotificationConfiguration,
  sqsQueue,
  sqsRedriveConfiguration,
  snsTopic,
  snsSubscription,
  eventBridgeBus,
  eventBridgeRule0_11_0,
  eventBridgeTarget,
  stepFunctionsStateMachine0_11_0,
];

/** Immutable service definitions used to reproduce the exact 0.11.0 artifact. */
export const awsServices0_11_0: ProviderServiceDefinitionV1[] = [
  apiGatewayHttpApi,
  lambdaFunction,
  dynamodbTable,
  cognitoUserPool,
  cognitoUserPoolClient,
  iamRole,
  iamPolicyDocument,
  iamManagedPolicyAttachment,
  iamPolicyStatement,
  iamPolicyCondition,
  cloudWatchLogGroup,
  cloudWatchMetricAlarm,
  regionBoundary,
  vpc,
  availabilityZone,
  subnet,
  routeTable,
  route,
  routeTableAssociation,
  internetGateway,
  natGateway,
  gatewayVpcEndpoint,
  securityGroup,
  securityGroupIngressRule,
  securityGroupEgressRule,
  lambdaVpcAccessConfiguration,
  ...awsEventServices0_11_0,
];

function terraformReadyEventService(
  service: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  return {
    ...service,
    mappings: service.mappings.map((mapping) =>
      mapping.target === "terraform"
        ? { ...mapping, implementationStatus: "implemented" as const }
        : mapping,
    ),
  };
}

export const awsServices0_13_0: ProviderServiceDefinitionV1[] = [
  ...awsServices0_11_0.slice(0, -awsEventServices0_11_0.length),
  ...awsEventServices0_11_0.map((service) =>
    terraformReadyEventService(
      service.id === "aws.eventbridge.rule"
        ? eventBridgeRule
        : service.id === "aws.stepfunctions.state-machine"
          ? stepFunctionsStateMachine
          : service,
    ),
  ),
];

const cloudFormationServerlessServiceIds = new Set([
  "aws.apigateway.http-api",
  "aws.cloudwatch.log-group",
  "aws.cloudwatch.metric-alarm",
  "aws.cognito.user-pool",
  "aws.cognito.user-pool-client",
  "aws.dynamodb.table",
  "aws.iam.managed-policy-attachment",
  "aws.iam.policy-condition",
  "aws.iam.policy-document",
  "aws.iam.policy-statement",
  "aws.iam.role",
  "aws.lambda.function",
]);

const cloudFormationCuratedServiceIds = new Set([
  ...cloudFormationServerlessServiceIds,
  "aws.ec2.vpc",
  "aws.ec2.subnet",
  "aws.ec2.route-table",
  "aws.ec2.route",
  "aws.ec2.route-table-association",
  "aws.ec2.internet-gateway",
  "aws.ec2.nat-gateway",
  "aws.ec2.gateway-vpc-endpoint",
  "aws.ec2.security-group",
  "aws.ec2.security-group-ingress-rule",
  "aws.ec2.security-group-egress-rule",
  "aws.s3.bucket",
  "aws.s3.bucket-lifecycle-configuration",
  "aws.s3.bucket-cors-configuration",
  "aws.s3.bucket-notification-configuration",
  "aws.sqs.queue",
  "aws.sqs.redrive-configuration",
  "aws.sns.topic",
  "aws.sns.subscription",
  "aws.eventbridge.event-bus",
  "aws.eventbridge.rule",
  "aws.eventbridge.target",
  "aws.stepfunctions.state-machine",
]);

const cloudFormationOwnedResourceServiceIds = new Set([
  "aws.ec2.route",
  "aws.ec2.route-table-association",
  "aws.ec2.security-group-ingress-rule",
  "aws.ec2.security-group-egress-rule",
  "aws.sns.subscription",
]);

type CompilerMapping = ProviderServiceDefinitionV1["mappings"][number];

function currentCloudFormationMapping(
  service: ProviderServiceDefinitionV1,
  mapping: CompilerMapping,
): CompilerMapping {
  if (
    mapping.target !== "cloudformation" ||
    !cloudFormationCuratedServiceIds.has(service.id)
  ) {
    return mapping;
  }
  if (
    cloudFormationOwnedResourceServiceIds.has(service.id) &&
    mapping.projection === undefined
  ) {
    return {
      ...mapping,
      implementationStatus: "implemented",
      projection: {
        kind: "owned-resource",
        rendererContractId: mapping.mappingId,
        rendererContractVersion: service.definitionVersion,
        generatedResourceTypes: [],
      },
    };
  }
  return { ...mapping, implementationStatus: "implemented" };
}

export const awsServices0_15_0: ProviderServiceDefinitionV1[] =
  awsServices0_13_0.map((service) => ({
    ...service,
    mappings: service.mappings.map((mapping) =>
      currentCloudFormationMapping(service, mapping),
    ),
  }));

const correctedPolicyPlacement = [
  iamPolicyDocument0_16_0,
  iamPolicyStatement0_16_0,
  iamPolicyCondition0_16_0,
];
export const awsServices0_16_0: ProviderServiceDefinitionV1[] =
  awsServices0_15_0.map((service) => {
    const correction = correctedPolicyPlacement.find(
      (candidate) => candidate.id === service.id,
    );
    return correction
      ? {
          ...service,
          definitionVersion: correction.definitionVersion,
          placement: correction.placement,
        }
      : service;
  });

export const awsServices0_17_0: ProviderServiceDefinitionV1[] = [
  ...awsServices0_16_0.map(extendServiceForFsx),
  ...awsFsxServices,
];

import { withFsxCapacityAccuracy } from "./fsx-capacity.js";
export const awsServices0_18_0: ProviderServiceDefinitionV1[] =
  awsServices0_17_0.map(withFsxCapacityAccuracy);

import { withS3Accuracy } from "./s3-accuracy.js";
export const awsServices0_19_0: ProviderServiceDefinitionV1[] =
  awsServices0_18_0.map(withS3Accuracy);
import { kmsKey, extendServiceForKms } from "./kms-key.js";
export const awsServices0_20_0: ProviderServiceDefinitionV1[] = [
  ...awsServices0_19_0.map(extendServiceForKms),
  kmsKey,
];

import {
  secretsManagerSecret,
  extendServiceForSecrets,
} from "./secretsmanager-secret.js";
export const awsServices0_21_0: ProviderServiceDefinitionV1[] = [
  ...awsServices0_20_0.map(extendServiceForSecrets),
  secretsManagerSecret,
];

import {
  ec2Instance,
  iamInstanceProfile,
  extendServiceForEc2,
} from "./ec2-compute.js";
export const awsServices0_22_0: ProviderServiceDefinitionV1[] = [
  ...awsServices0_21_0.map(extendServiceForEc2),
  ec2Instance,
  iamInstanceProfile,
];

import { awsEcsServices, extendServiceForEcs } from "./ecs-fargate.js";
export const awsServices0_23_0: ProviderServiceDefinitionV1[] = [
  ...awsServices0_22_0.map(extendServiceForEcs),
  ...awsEcsServices,
];

import { awsRdsServices, extendServiceForRds } from "./rds-postgres.js";
export const awsServices0_24_0: ProviderServiceDefinitionV1[] = [
  ...awsServices0_23_0.map(extendServiceForRds),
  ...awsRdsServices,
];

import {
  awsAuroraServices,
  extendServiceForAurora,
} from "./aurora-postgres.js";
export const awsServices0_25_0: ProviderServiceDefinitionV1[] = [
  ...awsServices0_24_0.map(extendServiceForAurora),
  ...awsAuroraServices,
];

import { awsDnsServices } from "./dns-acm.js";
export const awsServices0_26_0: ProviderServiceDefinitionV1[] = [
  ...awsServices0_25_0,
  ...awsDnsServices,
];

import {
  awsCloudfrontServices,
  extendServiceForCloudfront,
} from "./cloudfront.js";
export const awsServices0_27_0: ProviderServiceDefinitionV1[] = [
  ...awsServices0_26_0.map(extendServiceForCloudfront),
  ...awsCloudfrontServices,
];

import { awsElbServices, extendServiceForElb } from "./elb.js";
export const awsServices0_28_0: ProviderServiceDefinitionV1[] = [
  ...awsServices0_27_0.map(extendServiceForElb),
  ...awsElbServices,
];

import { awsEbsServices, extendServiceForEbs } from "./ebs.js";
const awsServicesBeforeWaf: ProviderServiceDefinitionV1[] = [
  ...awsServices0_28_0.map(extendServiceForEbs),
  ...awsEbsServices,
];

import { wafServices, extendServiceForRegionalWaf } from "./regional-waf.js";
export const awsServicesV1: ProviderServiceDefinitionV1[] = [
  ...awsServicesBeforeWaf.map(extendServiceForRegionalWaf),
  ...wafServices,
];
