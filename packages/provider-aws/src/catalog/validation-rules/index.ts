import { fsxReadinessValidationRuleDescriptor } from "./fsx-validation.js";
export {
  apiRouteAuthenticationValidationRuleDescriptor,
  compilerReadinessValidationRuleDescriptor,
  connectionCardinalityValidationRuleDescriptor,
  connectionQuestionsValidationRuleDescriptor,
  dynamoDbProtectionValidationRuleDescriptor,
  iamPolicySafetyValidationRuleDescriptor,
  iamWildcardValidationRuleDescriptor,
  lambdaDynamoDbActionsValidationRuleDescriptor,
  lambdaExecutionRoleValidationRuleDescriptor,
  lambdaTriggerCompatibilityValidationRuleDescriptor,
  lambdaRuntimeBoundsValidationRuleDescriptor,
  logRetentionValidationRuleDescriptor,
  regionAvailabilityValidationRuleDescriptor,
} from "./notes-api-validation-rules.js";

import { awsNetworkingValidationRuleDescriptorsV1 } from "./networking-validation-rules.js";
import { awsEventDrivenValidationRuleDescriptorsV1 } from "./event-driven-validation-rules.js";
export {
  eventDeliveryValidationRuleDescriptor,
  eventTopologyValidationRuleDescriptor,
} from "./event-driven-validation-rules.js";
import {
  awsValidationRuleDescriptors0_8_0,
  awsValidationRuleDescriptorsV1 as awsNotesApiValidationRuleDescriptorsV1,
} from "./notes-api-validation-rules.js";

export {
  awsNetworkingValidationRuleDescriptorsV1,
  lambdaVpcAccessValidationRuleDescriptor,
  networkPlacementValidationRuleDescriptor,
  networkRoutingValidationRuleDescriptor,
  securityGroupPolicyValidationRuleDescriptor,
} from "./networking-validation-rules.js";

/** Immutable validation descriptors used to reproduce the exact 0.10.0 artifact. */
export const awsValidationRuleDescriptors0_10_0 = [
  ...awsNotesApiValidationRuleDescriptorsV1,
  ...awsNetworkingValidationRuleDescriptorsV1,
];

export const awsValidationRuleDescriptors0_16_0 = [
  ...awsValidationRuleDescriptors0_10_0,
  ...awsEventDrivenValidationRuleDescriptorsV1,
];

export { awsValidationRuleDescriptors0_8_0 };

export { fsxReadinessValidationRuleDescriptor } from "./fsx-validation.js";
export const awsValidationRuleDescriptors0_17_0 = [
  ...awsValidationRuleDescriptors0_16_0,
  fsxReadinessValidationRuleDescriptor,
];

import { fsxStorageCapacityValidationRuleDescriptor } from "./fsx-storage-capacity.js";
export { fsxStorageCapacityValidationRuleDescriptor } from "./fsx-storage-capacity.js";
export const awsValidationRuleDescriptors0_18_0 = [
  ...awsValidationRuleDescriptors0_17_0,
  fsxStorageCapacityValidationRuleDescriptor,
];

import {
  s3BucketNameValidationRuleDescriptor,
  s3NotificationFiltersValidationRuleDescriptor,
} from "./s3-accuracy.js";
export {
  s3BucketNameValidationRuleDescriptor,
  s3NotificationFiltersValidationRuleDescriptor,
} from "./s3-accuracy.js";
export const awsValidationRuleDescriptors0_19_0 = [
  ...awsValidationRuleDescriptors0_18_0,
  s3BucketNameValidationRuleDescriptor,
  s3NotificationFiltersValidationRuleDescriptor,
];

import { kmsKeyReadinessValidationRuleDescriptor } from "./kms-key-readiness.js";
export const awsValidationRuleDescriptors0_20_0 = [
  ...awsValidationRuleDescriptors0_19_0,
  kmsKeyReadinessValidationRuleDescriptor,
];

import { secretReadinessValidationRuleDescriptor } from "./secret-readiness.js";
export const awsValidationRuleDescriptors0_21_0 = [
  ...awsValidationRuleDescriptors0_20_0.map((descriptor) =>
    [
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.region-availability",
    ].includes(descriptor.id)
      ? {
          ...descriptor,
          serviceIds: [
            ...descriptor.serviceIds,
            "aws.secretsmanager.secret",
            ...(descriptor.serviceIds.some(
              (service) => service === "aws.kms.key",
            )
              ? []
              : ["aws.kms.key"]),
          ],
        }
      : descriptor,
  ),
  secretReadinessValidationRuleDescriptor,
];

import { ec2ReadinessValidationRuleDescriptor } from "./ec2-readiness.js";
export const awsValidationRuleDescriptors0_22_0 = [
  ...awsValidationRuleDescriptors0_21_0.map((d) =>
    [
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.region-availability",
    ].includes(d.id)
      ? {
          ...d,
          serviceIds: [
            ...d.serviceIds,
            "aws.ec2.instance",
            "aws.iam.instance-profile",
          ],
        }
      : d,
  ),
  ec2ReadinessValidationRuleDescriptor,
];

import { ecsReadinessValidationRuleDescriptor } from "./ecs-fargate-readiness.js";
import { ecsProperties } from "../services/ecs-fargate.js";
export const awsValidationRuleDescriptors0_23_0 = [
  ...awsValidationRuleDescriptors0_22_0.map((d) =>
    [
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.region-availability",
    ].includes(d.id)
      ? { ...d, serviceIds: [...d.serviceIds, ...Object.keys(ecsProperties)] }
      : d,
  ),
  ecsReadinessValidationRuleDescriptor,
];

import { rdsReadinessValidationRuleDescriptor } from "./rds-postgres-readiness.js";
import { rdsProperties } from "../services/rds-postgres.js";
export const awsValidationRuleDescriptors0_24_0 = [
  ...awsValidationRuleDescriptors0_23_0.map((d) =>
    [
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.region-availability",
    ].includes(d.id)
      ? { ...d, serviceIds: [...d.serviceIds, ...Object.keys(rdsProperties)] }
      : d,
  ),
  rdsReadinessValidationRuleDescriptor,
];

import { auroraReadinessValidationRuleDescriptor } from "./aurora-postgres-readiness.js";
import { auroraProperties } from "../services/aurora-postgres.js";
export const awsValidationRuleDescriptors0_25_0 = [
  ...awsValidationRuleDescriptors0_24_0.map((d) =>
    [
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.region-availability",
    ].includes(d.id)
      ? {
          ...d,
          serviceIds: [...d.serviceIds, ...Object.keys(auroraProperties)],
        }
      : d,
  ),
  auroraReadinessValidationRuleDescriptor,
];

import { dnsReadinessValidationRuleDescriptor } from "./dns-acm-readiness.js";
import { dnsProperties } from "../services/dns-acm.js";
export const awsValidationRuleDescriptors0_26_0 = [
  ...awsValidationRuleDescriptors0_25_0.map((d) =>
    [
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.region-availability",
    ].includes(d.id)
      ? { ...d, serviceIds: [...d.serviceIds, ...Object.keys(dnsProperties)] }
      : d,
  ),
  dnsReadinessValidationRuleDescriptor,
];

import { cloudfrontReadinessValidationRuleDescriptor } from "./cloudfront-readiness.js";
import { cloudfrontProperties } from "../services/cloudfront.js";
export const awsValidationRuleDescriptors0_27_0 = [
  ...awsValidationRuleDescriptors0_26_0.map((d) =>
    [
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.region-availability",
    ].includes(d.id)
      ? {
          ...d,
          serviceIds: [...d.serviceIds, ...Object.keys(cloudfrontProperties)],
        }
      : d,
  ),
  cloudfrontReadinessValidationRuleDescriptor,
];

import { elbReadinessValidationRuleDescriptor } from "./elb-readiness.js";
import { elbProperties } from "../services/elb.js";
export const awsValidationRuleDescriptors0_28_0 = [
  ...awsValidationRuleDescriptors0_27_0.map((d) =>
    [
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.region-availability",
    ].includes(d.id)
      ? { ...d, serviceIds: [...d.serviceIds, ...Object.keys(elbProperties)] }
      : d,
  ),
  elbReadinessValidationRuleDescriptor,
];

import { ebsReadinessValidationRuleDescriptor } from "./ebs-readiness.js";
import { ebsProperties } from "../services/ebs.js";
const awsValidationRuleDescriptorsBeforeWaf = [
  ...awsValidationRuleDescriptors0_28_0.map((d) =>
    [
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.region-availability",
    ].includes(d.id)
      ? { ...d, serviceIds: [...d.serviceIds, ...Object.keys(ebsProperties)] }
      : d,
  ),
  ebsReadinessValidationRuleDescriptor,
];

import {
  wafServices,
  wafValidationDescriptor,
} from "../services/regional-waf.js";
export const awsValidationRuleDescriptorsV1 = [
  ...awsValidationRuleDescriptorsBeforeWaf.map((d) =>
    [
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.region-availability",
    ].includes(d.id)
      ? { ...d, serviceIds: [...d.serviceIds, ...wafServices.map((s) => s.id)] }
      : d,
  ),
  wafValidationDescriptor,
];
