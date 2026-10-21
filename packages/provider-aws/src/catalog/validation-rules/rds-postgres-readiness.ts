import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import {
  rdsRuleId,
  rdsDocumentation,
  rdsProperties,
} from "../services/rds-postgres.js";
export const rdsReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: rdsRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: rdsRuleId + ".evaluate",
    serviceIds: [
      ...Object.keys(rdsProperties),
      "aws.ec2.subnet",
      "aws.ec2.security-group",
    ],
    documentation: rdsDocumentation,
  });
