import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import { elbRuleId, elbProperties, elbDocumentation } from "../services/elb.js";
export const elbReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: elbRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: elbRuleId + ".evaluate",
    serviceIds: [
      ...Object.keys(elbProperties),
      "aws.ec2.vpc",
      "aws.ec2.subnet",
      "aws.ec2.security-group",
      "aws.ec2.instance",
      "aws.ecs.service",
      "aws.acm.public-dns-certificate",
    ],
    documentation: elbDocumentation,
  });
