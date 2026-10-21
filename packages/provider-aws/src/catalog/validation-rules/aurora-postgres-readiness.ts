import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import {
  auroraRuleId,
  auroraDocumentation,
  auroraProperties,
} from "../services/aurora-postgres.js";
export const auroraReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: auroraRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: auroraRuleId + ".evaluate",
    serviceIds: [
      ...Object.keys(auroraProperties),
      "aws.rds.db-subnet-group",
      "aws.ec2.subnet",
      "aws.ec2.security-group",
    ],
    documentation: auroraDocumentation,
  });
