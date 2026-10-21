import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import { ebsRuleId, ebsProperties, ebsDocumentation } from "../services/ebs.js";
export const ebsReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: ebsRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: ebsRuleId + ".evaluate",
    serviceIds: [
      ...Object.keys(ebsProperties),
      "aws.ec2.availability-zone",
      "aws.ec2.instance",
      "aws.kms.key",
    ],
    documentation: ebsDocumentation,
  });
