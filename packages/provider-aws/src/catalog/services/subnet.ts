import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const subnet = defineProviderServiceV1({
  id: "aws.ec2.subnet",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "Subnet",
  description:
    "A public- or private-intent IPv4 subnet boundary placed in exactly one Availability Zone.",
  nodeKind: {
    kind: "boundary",
    boundaryType: "aws.ec2.subnet",
    containmentModel: "provider-semantic",
  },
  iconId: "aws.cloudmarkup.icons.subnet",
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.ec2.availability-zone",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
    ],
    maximumDepth: 4,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.subnet.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.subnet.configuration:1.0.0",
      type: "object",
      title: "Subnet configuration",
      description:
        "A bounded IPv4 range, route-derived access intent, and address-assignment posture.",
      additionalProperties: false,
      properties: {
        cidrBlock: {
          type: "string",
          default: "10.0.1.0/24",
          minLength: 9,
          maxLength: 18,
          pattern:
            "^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}/(?:[0-9]|[12][0-9]|3[0-2])$",
        },
        accessTier: {
          type: "string",
          enum: ["public", "private"],
          default: "private",
        },
        mapPublicIpOnLaunch: { type: "boolean", default: false },
        assignIpv6AddressOnCreation: {
          type: "boolean",
          const: false,
          default: false,
        },
      },
      required: [
        "cidrBlock",
        "accessTier",
        "mapPublicIpOnLaunch",
        "assignIpv6AddressOnCreation",
      ],
    },
    uiHints: [
      {
        property: "cidrBlock",
        control: "text",
        label: "IPv4 CIDR block",
        helpText:
          "Choose a non-overlapping range inside the VPC CIDR. AWS reserves five addresses in every subnet.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "accessTier",
        control: "select",
        label: "Access tier",
        helpText:
          "Public or private is design intent that validation derives from the associated route table, not from this label alone.",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "mapPublicIpOnLaunch",
        control: "checkbox",
        label: "Auto-assign public IPv4 addresses",
        helpText:
          "This affects launched interfaces but does not make a subnet public without an internet-gateway route.",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "assignIpv6AddressOnCreation",
        control: "checkbox",
        label: "Auto-assign IPv6 addresses",
        helpText:
          "IPv6 assignment is fixed off because IPv6 routing is outside this catalog slice.",
        order: 3,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.ec2.subnet.availability-zone",
      displayName: "Availability Zone",
      description: "Accepts the one Availability Zone containing this subnet.",
      direction: "input",
      capability: "aws.ec2.availability-zone.subnet-placement",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.subnet.route-table-association",
      displayName: "Route-table association",
      description: "Accepts one explicit route-table association.",
      direction: "input",
      capability: "aws.ec2.subnet.route-table-association",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.subnet.lambda-vpc-access",
      displayName: "Lambda VPC access",
      description:
        "Accepts Lambda VPC access configurations that select this subnet.",
      direction: "input",
      capability: "aws.lambda.vpc-access.subnet",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.subnet.nat-gateway-placement",
      displayName: "NAT gateways",
      description: "Places zonal public NAT gateways in this subnet.",
      direction: "output",
      capability: "aws.ec2.subnet.nat-gateway-placement",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.lambda-vpc-access",
    "aws.cloudmarkup.validation.network-placement",
    "aws.cloudmarkup.validation.network-routing",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Partitions a VPC address range within one zone and receives one explicit routing policy.",
    guidedExplanation:
      "A subnet belongs to exactly one Availability Zone. Its public or private behavior comes from the associated route table: public routes point to an internet gateway, while private IPv4 egress commonly points to a NAT gateway or uses a gateway endpoint for S3 or DynamoDB.",
    professionalExplanation:
      "Models an IPv4 subnet with route-derived access intent and explicit route-table association. Public-IP assignment is independent of public routing, and IPv6 auto-assignment is fixed off until the provider has reviewed dual-stack semantics. Terraform uses the reviewed Availability Zone-to-VPC ancestry projection; CloudFormation ancestry projection remains pending.",
    considerations: [
      "Connections: Associate exactly one route table, keep the subnet in one AZ, and place a zonal NAT gateway only in a public subnet.",
      "Security: Public-IP assignment does not grant reachability; routes, security groups, workload listeners, and identity all still apply.",
      "Cost: Public IPv4 addresses, NAT processing, and cross-zone traffic can cost money; gateway endpoints can avoid some NAT data paths.",
      "Operations: Use parallel subnets across multiple AZs and verify that each private subnet has a resilient intended egress path.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.subnet.documentation.basics",
        title: "Configure subnets for your VPC",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.subnet.unsupported.ipv6-and-special-zones",
      title: "IPv6 and special-zone subnets",
      explanation:
        "IPv6-only, dual-stack assignment, Local Zone, Wavelength Zone, and Outpost subnet modes need separate reviewed semantics.",
    },
    {
      id: "aws.ec2.subnet.unsupported.implicit-public-status",
      title: "Implicit public or private status",
      explanation:
        "The access-tier label and public-IP toggle never replace semantic route-table evaluation or create routes automatically.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.subnet.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_subnet",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.networking-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        { configurationKey: "cidrBlock", targetName: "cidr_block" },
        {
          configurationKey: "mapPublicIpOnLaunch",
          targetName: "map_public_ip_on_launch",
        },
        {
          configurationKey: "assignIpv6AddressOnCreation",
          targetName: "assign_ipv6_address_on_creation",
        },
      ],
      semanticConfigurationKeys: ["accessTier"],
      portBindings: [
        {
          portId: "aws.ec2.subnet.availability-zone",
          targetAttribute: "availability_zone",
        },
      ],
    },
    {
      mappingId: "aws.ec2.subnet.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::Subnet",
      configurationBindings: [
        { configurationKey: "cidrBlock", targetName: "CidrBlock" },
        {
          configurationKey: "mapPublicIpOnLaunch",
          targetName: "MapPublicIpOnLaunch",
        },
        {
          configurationKey: "assignIpv6AddressOnCreation",
          targetName: "AssignIpv6AddressOnCreation",
        },
      ],
      portBindings: [
        {
          portId: "aws.ec2.subnet.availability-zone",
          targetAttribute: "AvailabilityZone",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound Amazon VPC subnet availability inventory is bundled with this catalog.",
  },
});
