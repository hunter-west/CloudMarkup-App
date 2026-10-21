import { awsWafServiceExtensions } from "./regional-waf-presentation.js";
import { awsEbsServiceExtensions } from "./ebs-presentation.js";
import { awsElbServiceExtensions } from "./elb-presentation.js";
import { awsCloudfrontServiceExtensions } from "./cloudfront-presentation.js";
import { awsDnsServiceExtensions } from "./dns-acm-presentation.js";
import { awsAuroraServiceExtensions } from "./aurora-presentation.js";
import { awsRdsServiceExtensions } from "./rds-presentation.js";
import { awsEcsServiceExtensions } from "./ecs-presentation.js";
import { awsEc2ServiceExtensions } from "./ec2-presentation.js";
import { awsSecretServiceExtension } from "./secrets-presentation.js";
import { awsKmsServiceExtension } from "./kms-presentation.js";
import { awsFsxServiceExtensions } from "./fsx-presentation.js";
import {
  defineProviderServiceExtensionSourceV1,
  type ProviderCatalogArtifactV1,
  type ProviderOwnedConfigurationSlotV1Input,
  type ProviderServiceExtensionDefinitionV1Input,
  type ProviderServiceExtensionSourceV1,
  type ProviderTargetReadinessV1,
} from "@cloudmarkup/provider-sdk";
import { awsEventDrivenServiceExtensionsV1 } from "./event-driven-service-extension.js";

import {
  awsLambdaVpcAccessOwnedConfigurationSlotsV1,
  awsNetworkingServiceExtensionsV1,
} from "./networking-service-extension.js";

function serviceReadiness(
  serviceName: string,
  generatedCode: ProviderTargetReadinessV1["generatedCode"]["status"] = "not-applicable",
): ProviderTargetReadinessV1 {
  return {
    modeling: {
      status: "supported",
      reason: `${serviceName} has a reviewed typed graph service and exact semantic ports in this catalog.`,
    },
    configuration: {
      status: "supported",
      reason: `${serviceName} has a strict versioned configuration schema and reviewed field metadata.`,
    },
    validation: {
      status: "supported",
      reason: `${serviceName} participates in deterministic catalog-bound validation for its current bounded behavior.`,
    },
    terraform: {
      status: "supported",
      reason: `${serviceName} has deterministic Terraform generation for the bounded notes-API family.`,
    },
    cloudformation: {
      status: "supported",
      reason: `${serviceName} has deterministic native CloudFormation generation for the bounded initial serverless/auth/data family.`,
    },
    generatedCode: {
      status: generatedCode,
      reason:
        generatedCode === "supported"
          ? `${serviceName} participates in exact reviewed deterministic application generation and Lambda artifact build contracts.`
          : generatedCode === "pending"
            ? `${serviceName} application-code generation is reserved for a later reviewed prompt.`
            : `${serviceName} does not itself require application-code generation.`,
    },
  };
}

function policySlotReadiness(slotName: string): ProviderTargetReadinessV1 {
  return {
    modeling: {
      status: "supported",
      reason: `${slotName} is modeled as an exact graph-backed owned configuration.`,
    },
    configuration: {
      status: "supported",
      reason: `${slotName} uses typed policy or attachment configuration rather than arbitrary JSON.`,
    },
    validation: {
      status: "supported",
      reason: `${slotName} is covered by deterministic policy-kind, ownership, and cardinality validation.`,
    },
    terraform: {
      status: "supported",
      reason: `${slotName} is deterministically rendered from its exact graph-owned configuration and provenance.`,
    },
    cloudformation: {
      status: "supported",
      reason: `${slotName} is deterministically rendered into native CloudFormation IAM or Lambda-permission properties from exact graph provenance.`,
    },
    generatedCode: {
      status: "not-applicable",
      reason: `${slotName} affects infrastructure permissions, not application source generation.`,
    },
  };
}

const roleOwnedConfigurationSlots: ProviderOwnedConfigurationSlotV1Input[] = [
  {
    id: "aws.iam.role.slot.trust-policy",
    slotVersion: "1.0.0",
    configurationKind: "aws.iam.policy.trust",
    displayName: "Trust policy",
    description:
      "The one policy document controlling who or what may assume this role.",
    graphBinding: {
      configurationServiceId: "aws.iam.policy-document",
      ownershipRelationshipType: "aws.iam.role-owns-trust-policy",
    },
    cardinality: {
      minimum: 1,
      maximum: 1,
      enforcement: "provider-rule",
    },
    allowedOwnership: ["user", "generated"],
    generatedAdoption: "allowed",
    policyKinds: ["trust"],
    targetReadiness: policySlotReadiness("IAM role trust policy"),
    guidedExplanation:
      "This required policy controls who or what may use the role.",
    professionalExplanation:
      "Exactly one trust-policy document is bound through the role trust slot; generated lifecycle provenance remains adoptable before customization.",
  },
  {
    id: "aws.iam.role.slot.custom-inline-policy",
    slotVersion: "1.0.0",
    configurationKind: "aws.iam.policy.identity-inline",
    displayName: "Custom inline policies",
    description: "User-authored identity policy documents owned by this role.",
    graphBinding: {
      configurationServiceId: "aws.iam.policy-document",
      ownershipRelationshipType: "aws.iam.role-owns-inline-policy",
    },
    cardinality: {
      minimum: 0,
      maximum: "many",
      enforcement: "provider-rule",
    },
    allowedOwnership: ["user"],
    generatedAdoption: "not-applicable",
    policyKinds: ["identity-inline"],
    targetReadiness: policySlotReadiness("IAM role custom inline policy"),
    guidedExplanation:
      "These are permissions you explicitly add and connection cleanup never owns them.",
    professionalExplanation:
      "Zero or more user-owned identity-inline documents remain outside every generated connection cleanup closure.",
  },
  {
    id: "aws.iam.role.slot.generated-permission",
    slotVersion: "1.0.0",
    configurationKind: "aws.iam.policy.generated-permission",
    displayName: "Generated permissions",
    description:
      "Connection-generated identity policy documents owned by this role.",
    graphBinding: {
      configurationServiceId: "aws.iam.policy-document",
      ownershipRelationshipType: "aws.iam.role-owns-generated-permission",
    },
    cardinality: {
      minimum: 0,
      maximum: "many",
      enforcement: "provider-rule",
    },
    allowedOwnership: ["generated"],
    generatedAdoption: "allowed",
    policyKinds: ["generated-permission"],
    targetReadiness: policySlotReadiness("IAM role generated permission"),
    guidedExplanation:
      "CloudMarkup creates these because the role or its workload is connected to another service.",
    professionalExplanation:
      "Zero or more generated-permission documents retain exact source-edge provenance and require adoption before customization.",
  },
  {
    id: "aws.iam.role.slot.managed-policy",
    slotVersion: "1.0.0",
    configurationKind: "aws.iam.policy.managed-policy-attachment",
    displayName: "Managed policies",
    description: "Reviewed managed-policy references attached to this role.",
    graphBinding: {
      configurationServiceId: "aws.iam.managed-policy-attachment",
      ownershipRelationshipType: "aws.iam.role-owns-managed-policy-attachment",
    },
    cardinality: {
      minimum: 0,
      maximum: "many",
      enforcement: "provider-rule",
    },
    allowedOwnership: ["user"],
    generatedAdoption: "not-applicable",
    policyKinds: ["managed-policy-attachment"],
    targetReadiness: policySlotReadiness("IAM role managed policy"),
    guidedExplanation:
      "Attach zero or more reviewed managed policies when their full permission sets are appropriate.",
    professionalExplanation:
      "Managed-policy attachment nodes use deliberate reviewed references and remain distinct from inline policy documents.",
  },
  {
    id: "aws.iam.role.slot.permissions-boundary",
    slotVersion: "1.0.0",
    configurationKind: "aws.iam.policy.permissions-boundary",
    displayName: "Permissions boundary",
    description:
      "The optional managed-policy reference limiting this role's maximum permissions.",
    graphBinding: {
      configurationServiceId: "aws.iam.managed-policy-attachment",
      ownershipRelationshipType: "aws.iam.role-owns-permissions-boundary",
    },
    cardinality: {
      minimum: 0,
      maximum: 1,
      enforcement: "provider-rule",
    },
    allowedOwnership: ["user"],
    generatedAdoption: "not-applicable",
    policyKinds: ["permissions-boundary"],
    targetReadiness: policySlotReadiness("IAM role permissions boundary"),
    guidedExplanation:
      "This optional boundary limits the maximum permissions the role can receive.",
    professionalExplanation:
      "At most one user-owned permissions-boundary attachment is permitted and it grants no permissions by itself.",
  },
];

const lambdaOwnedConfigurationSlots: ProviderOwnedConfigurationSlotV1Input[] = [
  {
    id: "aws.lambda.function.slot.invocation-permission",
    slotVersion: "1.0.0",
    configurationKind: "aws.lambda.invocation-permission",
    displayName: "Invocation permissions",
    description:
      "Service-specific grants allowing reviewed callers to invoke this function.",
    graphBinding: {
      configurationServiceId: "aws.iam.policy-document",
      ownershipRelationshipType: "aws.lambda.owns-invocation-permission",
    },
    cardinality: {
      minimum: 0,
      maximum: "many",
      enforcement: "provider-rule",
    },
    allowedOwnership: ["generated"],
    generatedAdoption: "allowed",
    policyKinds: ["service-grant"],
    targetReadiness: policySlotReadiness("Lambda invocation permission"),
    guidedExplanation:
      "CloudMarkup creates these grants when a supported service needs permission to call the function.",
    professionalExplanation:
      "Zero or more generated service-grant policy documents retain exact caller, relationship, and source-edge provenance.",
  },
  ...awsLambdaVpcAccessOwnedConfigurationSlotsV1,
];

const awsServiceExtensionsV1: ProviderServiceExtensionDefinitionV1Input[] = [
  {
    serviceId: "aws.apigateway.http-api",
    targetReadiness: serviceReadiness("API Gateway HTTP API"),
    ownedConfigurationSlots: [],
  },
  {
    serviceId: "aws.cloudwatch.log-group",
    targetReadiness: serviceReadiness("CloudWatch log group"),
    ownedConfigurationSlots: [],
  },
  {
    serviceId: "aws.cloudwatch.metric-alarm",
    targetReadiness: serviceReadiness("CloudWatch metric alarm"),
    ownedConfigurationSlots: [],
  },
  {
    serviceId: "aws.cognito.user-pool",
    targetReadiness: serviceReadiness("Cognito user pool"),
    ownedConfigurationSlots: [],
  },
  {
    serviceId: "aws.cognito.user-pool-client",
    targetReadiness: serviceReadiness("Cognito user-pool app client"),
    ownedConfigurationSlots: [],
  },
  {
    serviceId: "aws.dynamodb.table",
    targetReadiness: serviceReadiness("DynamoDB table"),
    ownedConfigurationSlots: [],
  },
  {
    serviceId: "aws.iam.managed-policy-attachment",
    targetReadiness: serviceReadiness("IAM managed-policy attachment"),
    ownedConfigurationSlots: [],
  },
  {
    serviceId: "aws.iam.policy-condition",
    targetReadiness: serviceReadiness("IAM policy condition"),
    ownedConfigurationSlots: [],
  },
  {
    serviceId: "aws.iam.policy-document",
    targetReadiness: serviceReadiness("IAM policy document"),
    ownedConfigurationSlots: [],
  },
  {
    serviceId: "aws.iam.policy-statement",
    targetReadiness: serviceReadiness("IAM policy statement"),
    ownedConfigurationSlots: [],
  },
  {
    serviceId: "aws.iam.role",
    targetReadiness: serviceReadiness("IAM role"),
    ownedConfigurationSlots: roleOwnedConfigurationSlots,
  },
  {
    serviceId: "aws.lambda.function",
    targetReadiness: serviceReadiness("Lambda function", "supported"),
    ownedConfigurationSlots: lambdaOwnedConfigurationSlots,
  },
  ...awsNetworkingServiceExtensionsV1,
  ...awsEventDrivenServiceExtensionsV1,
  ...awsFsxServiceExtensions,
  awsKmsServiceExtension,
  awsSecretServiceExtension,
  ...awsEc2ServiceExtensions,
  ...awsEcsServiceExtensions,
  ...awsRdsServiceExtensions,
  ...awsAuroraServiceExtensions,
  ...awsDnsServiceExtensions,
  ...awsCloudfrontServiceExtensions,
  ...awsEbsServiceExtensions,
  ...awsWafServiceExtensions,
  ...awsElbServiceExtensions,
];

export function createAwsProviderServiceExtensionSourceV1(
  catalog: ProviderCatalogArtifactV1,
): ProviderServiceExtensionSourceV1 {
  return defineProviderServiceExtensionSourceV1({
    contractVersion: 1,
    catalog: {
      id: catalog.catalog.id,
      version: catalog.catalog.version,
      digest: catalog.digest,
    },
    services: awsServiceExtensionsV1,
  });
}
