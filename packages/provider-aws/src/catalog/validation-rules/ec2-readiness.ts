import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import {
  ec2Documentation,
  ec2ReadinessRuleId,
} from "../services/ec2-compute.js";
export const ec2ReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: ec2ReadinessRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: ec2ReadinessRuleId + ".evaluate",
    serviceIds: [
      "aws.ec2.instance",
      "aws.iam.instance-profile",
      "aws.iam.role",
      "aws.ec2.subnet",
      "aws.ec2.security-group",
      "aws.kms.key",
    ],
    documentation: ec2Documentation,
  });
