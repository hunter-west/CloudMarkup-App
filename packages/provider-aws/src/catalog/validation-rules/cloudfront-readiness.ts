import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import {
  cloudfrontRuleId,
  cloudfrontProperties,
  cloudfrontDocumentation,
} from "../services/cloudfront.js";
export const cloudfrontReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: cloudfrontRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: cloudfrontRuleId + ".evaluate",
    serviceIds: [
      ...Object.keys(cloudfrontProperties),
      "aws.s3.bucket",
      "aws.acm.public-dns-certificate",
    ],
    documentation: cloudfrontDocumentation,
  });
