import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import {
  awsFsxServices,
  fsxDocumentation,
  fsxValidationRuleId,
} from "../services/fsx.js";
export const fsxReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: fsxValidationRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: fsxValidationRuleId + ".evaluate",
    serviceIds: [
      ...awsFsxServices.map((s) => s.id),
      "aws.ec2.subnet",
      "aws.ec2.security-group",
      "aws.s3.bucket",
    ],
    documentation: fsxDocumentation,
  });
