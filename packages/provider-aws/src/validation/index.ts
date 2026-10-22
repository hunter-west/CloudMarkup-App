import { wafValidationDescriptor } from "../catalog/services/regional-waf.js";
import { createRegionalWafReadinessRule } from "./regional-waf-rule.js";
import {
  defineProviderValidationRuleRegistrationV1,
  type ProviderValidationRuleRegistrationV1,
} from "@cloudmarkup/provider-sdk";
import { auroraReadinessValidationRuleDescriptor } from "../catalog/validation-rules/aurora-postgres-readiness.js";
import { cloudfrontReadinessValidationRuleDescriptor } from "../catalog/validation-rules/cloudfront-readiness.js";
import { dnsReadinessValidationRuleDescriptor } from "../catalog/validation-rules/dns-acm-readiness.js";
import { ebsReadinessValidationRuleDescriptor } from "../catalog/validation-rules/ebs-readiness.js";
import { ec2ReadinessValidationRuleDescriptor } from "../catalog/validation-rules/ec2-readiness.js";
import { ecsReadinessValidationRuleDescriptor } from "../catalog/validation-rules/ecs-fargate-readiness.js";
import { elbReadinessValidationRuleDescriptor } from "../catalog/validation-rules/elb-readiness.js";
import { kmsKeyReadinessValidationRuleDescriptor } from "../catalog/validation-rules/kms-key-readiness.js";
import { rdsReadinessValidationRuleDescriptor } from "../catalog/validation-rules/rds-postgres-readiness.js";
import {
  s3BucketNameValidationRuleDescriptor,
  s3NotificationFiltersValidationRuleDescriptor,
} from "../catalog/validation-rules/s3-accuracy.js";
import { secretReadinessValidationRuleDescriptor } from "../catalog/validation-rules/secret-readiness.js";
import { createAuroraReadinessRuleV1 } from "./aurora-readiness-rule.js";
import { createCloudfrontReadinessRuleV1 } from "./cloudfront-readiness-rule.js";
import { createDnsReadinessRuleV1 } from "./dns-acm-readiness-rule.js";
import { createEbsReadinessRuleV1 } from "./ebs-readiness-rule.js";
import { createEc2ReadinessRuleV1 } from "./ec2-readiness-rule.js";
import { createEcsReadinessRuleV1 } from "./ecs-readiness-rule.js";
import { createElbReadinessRuleV1 } from "./elb-readiness-rule.js";
import { createKmsKeyReadinessRuleV1 } from "./kms-key-rule.js";
import { createRdsReadinessRuleV1 } from "./rds-readiness-rule.js";
import {
  createS3BucketNameRuleV1,
  createS3NotificationFiltersRuleV1,
} from "./s3-accuracy-rules.js";
import { createSecretReadinessRuleV1 } from "./secret-readiness-rule.js";

import { awsCatalogArtifactV1 } from "../catalog-v1-accessors.js";
import {
  AWS_FROZEN_MODEL_CATALOG_BINDING_V1,
  resolveAwsModelCatalogV1,
} from "../model-evaluation-catalog.js";
import {
  apiRouteAuthenticationValidationRuleDescriptor,
  compilerReadinessValidationRuleDescriptor,
  connectionCardinalityValidationRuleDescriptor,
  connectionQuestionsValidationRuleDescriptor,
  dynamoDbProtectionValidationRuleDescriptor,
  eventDeliveryValidationRuleDescriptor,
  eventTopologyValidationRuleDescriptor,
  iamPolicySafetyValidationRuleDescriptor,
  iamWildcardValidationRuleDescriptor,
  lambdaDynamoDbActionsValidationRuleDescriptor,
  lambdaExecutionRoleValidationRuleDescriptor,
  lambdaRuntimeBoundsValidationRuleDescriptor,
  lambdaTriggerCompatibilityValidationRuleDescriptor,
  lambdaVpcAccessValidationRuleDescriptor,
  logRetentionValidationRuleDescriptor,
  networkPlacementValidationRuleDescriptor,
  networkRoutingValidationRuleDescriptor,
  regionAvailabilityValidationRuleDescriptor,
  securityGroupPolicyValidationRuleDescriptor,
} from "../catalog/validation-rules/index.js";
import {
  createApiRouteAuthenticationRuleV1,
  createConnectionQuestionsRuleV1,
  createLambdaExecutionRoleRuleV1,
} from "./api-and-connection-rules.js";
import {
  createCompilerReadinessRuleV1,
  createRegionAvailabilityRuleV1,
} from "./catalog-readiness-rules.js";
import {
  createConnectionCardinalityRuleV1,
  createLambdaTriggerCompatibilityRuleV1,
} from "./connection-and-workload-rules.js";
import {
  createEventDeliveryRuleV1,
  createEventTopologyRuleV1,
} from "./event-driven-rules.js";
import { createIamPolicySafetyRuleV1 } from "./iam-policy-safety-rule.js";
import {
  createLambdaVpcAccessRuleV1,
  createNetworkPlacementRuleV1,
  createNetworkRoutingRuleV1,
  createSecurityGroupPolicyRuleV1,
} from "./networking-rules.js";
import type { AwsValidationCatalogV1 } from "./rule-helpers.js";
import {
  createDynamoDbProtectionRuleV1,
  createIamWildcardRuleV1,
  createLambdaDynamoDbActionsRuleV1,
  createLambdaRuntimeBoundsRuleV1,
  createLogRetentionRuleV1,
} from "./security-and-runtime-rules.js";

import { fsxReadinessValidationRuleDescriptor } from "../catalog/validation-rules/fsx-validation.js";
import { createFsxReadinessRuleV1 } from "./fsx-rules.js";

import { fsxStorageCapacityValidationRuleDescriptor } from "../catalog/validation-rules/fsx-storage-capacity.js";
import { createFsxStorageCapacityRuleV1 } from "./fsx-storage-capacity-rule.js";

export function createAwsValidationRuleRegistrationsV1(
  catalog: AwsValidationCatalogV1 = awsCatalogArtifactV1,
): readonly ProviderValidationRuleRegistrationV1[] {
  return Object.freeze([
    defineProviderValidationRuleRegistrationV1({
      descriptor: wafValidationDescriptor,
      rule: createRegionalWafReadinessRule(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: ebsReadinessValidationRuleDescriptor,
      rule: createEbsReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: elbReadinessValidationRuleDescriptor,
      rule: createElbReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: cloudfrontReadinessValidationRuleDescriptor,
      rule: createCloudfrontReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: dnsReadinessValidationRuleDescriptor,
      rule: createDnsReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: auroraReadinessValidationRuleDescriptor,
      rule: createAuroraReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: rdsReadinessValidationRuleDescriptor,
      rule: createRdsReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: ecsReadinessValidationRuleDescriptor,
      rule: createEcsReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: ec2ReadinessValidationRuleDescriptor,
      rule: createEc2ReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: secretReadinessValidationRuleDescriptor,
      rule: createSecretReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: kmsKeyReadinessValidationRuleDescriptor,
      rule: createKmsKeyReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: s3BucketNameValidationRuleDescriptor,
      rule: createS3BucketNameRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: s3NotificationFiltersValidationRuleDescriptor,
      rule: createS3NotificationFiltersRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: fsxStorageCapacityValidationRuleDescriptor,
      rule: createFsxStorageCapacityRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: fsxReadinessValidationRuleDescriptor,
      rule: createFsxReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: apiRouteAuthenticationValidationRuleDescriptor,
      rule: createApiRouteAuthenticationRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: iamWildcardValidationRuleDescriptor,
      rule: createIamWildcardRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: iamPolicySafetyValidationRuleDescriptor,
      rule: createIamPolicySafetyRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: lambdaExecutionRoleValidationRuleDescriptor,
      rule: createLambdaExecutionRoleRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: connectionCardinalityValidationRuleDescriptor,
      rule: createConnectionCardinalityRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: lambdaTriggerCompatibilityValidationRuleDescriptor,
      rule: createLambdaTriggerCompatibilityRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: lambdaDynamoDbActionsValidationRuleDescriptor,
      rule: createLambdaDynamoDbActionsRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: dynamoDbProtectionValidationRuleDescriptor,
      rule: createDynamoDbProtectionRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: logRetentionValidationRuleDescriptor,
      rule: createLogRetentionRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: lambdaRuntimeBoundsValidationRuleDescriptor,
      rule: createLambdaRuntimeBoundsRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: connectionQuestionsValidationRuleDescriptor,
      rule: createConnectionQuestionsRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: regionAvailabilityValidationRuleDescriptor,
      rule: createRegionAvailabilityRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: compilerReadinessValidationRuleDescriptor,
      rule: createCompilerReadinessRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: networkPlacementValidationRuleDescriptor,
      rule: createNetworkPlacementRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: networkRoutingValidationRuleDescriptor,
      rule: createNetworkRoutingRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: eventTopologyValidationRuleDescriptor,
      rule: createEventTopologyRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: eventDeliveryValidationRuleDescriptor,
      rule: createEventDeliveryRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: securityGroupPolicyValidationRuleDescriptor,
      rule: createSecurityGroupPolicyRuleV1(catalog),
    }),
    defineProviderValidationRuleRegistrationV1({
      descriptor: lambdaVpcAccessValidationRuleDescriptor,
      rule: createLambdaVpcAccessRuleV1(catalog),
    }),
  ]);
}

export const awsValidationRuleRegistrationsV1 =
  createAwsValidationRuleRegistrationsV1();

export const awsValidationRulesV1 = Object.freeze(
  awsValidationRuleRegistrationsV1.map((registration) => registration.rule),
);

/** Validation of the exact frozen model-evaluation input only. This does not
 * install historical rules for mutable projects or current-catalog admission. */
export function createAwsFrozenModelEvaluationRulesV1() {
  const { catalog } = resolveAwsModelCatalogV1(
    AWS_FROZEN_MODEL_CATALOG_BINDING_V1,
  );
  return Object.freeze(
    createAwsValidationRuleRegistrationsV1(catalog.artifact)
      .filter(
        ({ descriptor }) =>
          catalog.getValidationRule(descriptor.id) !== undefined,
      )
      .map(({ rule }) => rule),
  );
}

export type { AwsValidationCatalogV1 } from "./rule-helpers.js";
export {
  createCompilerReadinessRuleV1,
  createEventDeliveryRuleV1,
  createEventTopologyRuleV1,
  createLambdaVpcAccessRuleV1,
  createNetworkPlacementRuleV1,
  createNetworkRoutingRuleV1,
  createRegionAvailabilityRuleV1,
  createSecurityGroupPolicyRuleV1,
};
