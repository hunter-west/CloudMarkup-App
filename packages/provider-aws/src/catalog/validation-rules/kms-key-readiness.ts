import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import { kmsDocumentation, kmsReadinessRuleId } from "../services/kms-key.js";
export const kmsKeyReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: kmsReadinessRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: kmsReadinessRuleId + ".evaluate",
    serviceIds: [
      "aws.kms.key",
      "aws.iam.policy-document",
      "aws.iam.policy-statement",
    ],
    documentation: kmsDocumentation,
  });
