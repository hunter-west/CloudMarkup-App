import { defineProviderValidationRuleDescriptorV1 } from "@cloudmarkup/provider-sdk";
import {
  ecsRuleId,
  ecsDocumentation,
  ecsProperties,
} from "../services/ecs-fargate.js";
export const ecsReadinessValidationRuleDescriptor =
  defineProviderValidationRuleDescriptorV1({
    id: ecsRuleId,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: ecsRuleId + ".evaluate",
    serviceIds: [
      ...Object.keys(ecsProperties),
      "aws.iam.role",
      "aws.ec2.subnet",
      "aws.ec2.security-group",
      "aws.cloudwatch.log-group",
      "aws.secretsmanager.secret",
    ],
    documentation: ecsDocumentation,
  });
