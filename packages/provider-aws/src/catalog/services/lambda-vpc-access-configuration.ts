import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

/** A graph-owned Lambda association rendered only through its function. */
export const lambdaVpcAccessConfiguration = defineProviderServiceV1({
  id: "aws.lambda.vpc-access-configuration",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "Lambda VPC access configuration",
  description:
    "An owned Lambda configuration that selects reviewed subnets and security groups without pretending the function is contained by the VPC.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.lambda.vpc-access-configuration",
    deployable: false,
  },
  iconId: null,
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.lambda.function",
        relationshipType: "aws.lambda.owns-vpc-access-configuration",
      },
    ],
    maximumDepth: 2,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.lambda.vpc-access-configuration.configuration",
    schemaVersion: "1.1.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.lambda.vpc-access-configuration.configuration:1.1.0",
      type: "object",
      title: "Lambda VPC access configuration",
      description:
        "A bounded IPv4-only posture; graph relationships carry function, subnet, and security-group selections.",
      additionalProperties: false,
      properties: {
        egressRequirement: {
          type: "string",
          enum: ["none", "internet", "s3", "dynamodb", "s3-and-dynamodb"],
          default: "none",
        },
        ipv6AllowedForDualStack: {
          type: "boolean",
          const: false,
          default: false,
        },
      },
      required: ["egressRequirement", "ipv6AllowedForDualStack"],
    },
    uiHints: [
      {
        property: "egressRequirement",
        control: "select",
        label: "Required outbound access",
        helpText:
          "Keep None for intentional isolation. Otherwise require reviewed NAT routing or the matching S3/DynamoDB gateway endpoint for every selected subnet.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "ipv6AllowedForDualStack",
        control: "checkbox",
        label: "Allow outbound IPv6",
        helpText:
          "Fixed off because dual-stack subnet selection and IPv6 egress routing are outside this catalog slice.",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
    ],
  },
  ports: [
    {
      id: "aws.lambda.vpc-access-configuration.function",
      displayName: "Lambda function",
      description: "Provides this owned configuration to one Lambda function.",
      direction: "output",
      capability: "aws.lambda.vpc-access",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.lambda.vpc-access-configuration.subnet",
      displayName: "Subnets",
      description:
        "Selects one or more private-intent subnets for Lambda network interfaces.",
      direction: "output",
      capability: "aws.lambda.vpc-access.subnet",
      category: "network-and-security",
      cardinality: "many",
      required: true,
    },
    {
      id: "aws.lambda.vpc-access-configuration.security-group",
      displayName: "Security groups",
      description:
        "Selects one or more security groups for Lambda network interfaces.",
      direction: "output",
      capability: "aws.lambda.vpc-access.security-group",
      category: "network-and-security",
      cardinality: "many",
      required: true,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.lambda-vpc-access",
    "aws.cloudmarkup.validation.network-placement",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Associates one Lambda function with reviewed VPC subnets and security groups.",
    guidedExplanation:
      "Use this configuration only when the function must reach resources through a VPC. Select subnets in multiple Availability Zones and at least one security group. Keep outbound access set to None for intentional isolation; otherwise every selected subnet needs reviewed NAT routing or the matching service endpoint.",
    professionalExplanation:
      "This graph-only owned configuration projects subnet and security-group associations to the function's reviewed Terraform vpc_config block. egressRequirement is workload intent used by validation and application evidence, not a fabricated Lambda source or provider argument. The configuration does not represent service containment or a standalone provider resource, and CloudFormation projection remains pending.",
    considerations: [
      "Connections: Own the configuration from one function and select subnets plus security groups from one VPC across multiple AZs.",
      "Security: Scope security-group egress and the Lambda VPC access managed permission; VPC placement is not an authorization boundary.",
      "Cost: VPC networking can add NAT, public IPv4, endpoint, cross-zone, and data-processing charges to function traffic.",
      "Operations: Use multiple AZs, preserve enough subnet addresses for managed interfaces, and test cold starts plus egress failures.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.vpc-access-configuration.documentation.overview",
        title: "Connecting outbound traffic to resources in a VPC",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.lambda.vpc-access-configuration.unsupported.dual-stack",
      title: "Dual-stack and IPv6-only access",
      explanation:
        "IPv6 outbound access, IPv6-only subnets, and dual-stack routing require a later reviewed configuration and validation contract.",
    },
    {
      id: "aws.lambda.vpc-access-configuration.unsupported.false-containment",
      title: "Lambda service containment",
      explanation:
        "The Lambda service remains AWS-managed outside the customer VPC; this configuration only associates managed network interfaces.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.lambda.vpc-access-configuration.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "nested-block",
      providerSource: "hashicorp/aws",
      ownerServiceId: "aws.lambda.function",
      ownerRelationshipType: "aws.lambda.owns-vpc-access-configuration",
      blockName: "vpc_config",
      projection: {
        kind: "owner-nested-block",
        rendererContractId: "cloudmarkup.iac.networking-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        {
          configurationKey: "ipv6AllowedForDualStack",
          targetName: "ipv6_allowed_for_dual_stack",
        },
      ],
      semanticConfigurationKeys: ["egressRequirement"],
      portBindings: [
        {
          portId: "aws.lambda.vpc-access-configuration.subnet",
          targetAttribute: "subnet_ids",
        },
        {
          portId: "aws.lambda.vpc-access-configuration.security-group",
          targetAttribute: "security_group_ids",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound Lambda VPC networking availability inventory is bundled with this catalog.",
  },
});
