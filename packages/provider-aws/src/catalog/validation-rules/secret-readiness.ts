import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import {
  secretDocumentation,
  secretReadinessRuleId,
} from "../services/secretsmanager-secret.js";
export const secretReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: secretReadinessRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: secretReadinessRuleId + ".evaluate",
    serviceIds: [
      "aws.secretsmanager.secret",
      "aws.kms.key",
      "aws.iam.policy-statement",
    ],
    documentation: secretDocumentation,
  });
