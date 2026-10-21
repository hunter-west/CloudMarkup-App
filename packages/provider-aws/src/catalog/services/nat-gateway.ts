import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const natGateway = defineProviderServiceV1({
  id: "aws.ec2.nat-gateway",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "NAT gateway",
  description:
    "A zonal public NAT gateway that gives private IPv4 subnets reviewed outbound internet paths.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.ec2.nat-gateway",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.nat-gateway",
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.ec2.subnet",
        relationshipType: "aws.ec2.subnet-contains-nat-gateway",
      },
    ],
    maximumDepth: 5,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.nat-gateway.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.nat-gateway.configuration:1.0.0",
      type: "object",
      title: "NAT gateway configuration",
      description:
        "A bounded public, zonal NAT gateway using one explicit Elastic IP allocation.",
      additionalProperties: false,
      properties: {
        allocationId: {
          type: "string",
          minLength: 13,
          maxLength: 64,
          pattern: "^eipalloc-[0-9a-f]+$",
        },
        connectivityType: {
          type: "string",
          enum: ["public"],
          default: "public",
        },
        availabilityMode: {
          type: "string",
          enum: ["zonal"],
          default: "zonal",
        },
      },
      required: ["allocationId", "connectivityType", "availabilityMode"],
    },
    uiHints: [
      {
        property: "allocationId",
        control: "text",
        label: "Elastic IP allocation ID",
        helpText:
          "Enter the stable eipalloc identifier for a reviewed Elastic IP; credentials and account lookups are never accepted.",
        order: 0,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "connectivityType",
        control: "select",
        label: "Connectivity type",
        helpText: "Only public NAT gateways are supported in this slice.",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "availabilityMode",
        control: "select",
        label: "Availability mode",
        helpText:
          "Zonal NAT should be paired with private subnets in the same Availability Zone for resilient, cost-aware routing.",
        order: 2,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
    ],
  },
  ports: [
    {
      id: "aws.ec2.nat-gateway.subnet",
      displayName: "Public subnet",
      description:
        "Accepts placement in one public subnet with an internet-gateway route.",
      direction: "input",
      capability: "aws.ec2.subnet.nat-gateway-placement",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.nat-gateway.route-target",
      displayName: "Private routes",
      description: "Accepts private-subnet IPv4 routes targeting this gateway.",
      direction: "input",
      capability: "aws.ec2.route.nat-gateway-target",
      category: "network-and-security",
      cardinality: "many",
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
      "Provides managed outbound IPv4 translation for private subnets through a public subnet.",
    guidedExplanation:
      "Place a public NAT gateway in a public subnet, then route private-subnet internet traffic to it. For resilience and lower cross-zone traffic, use one zonal gateway per active Availability Zone. Prefer gateway endpoints for S3 or DynamoDB traffic that does not need NAT.",
    professionalExplanation:
      "Models only public zonal NAT with one Elastic IP allocation. Validation checks the public-subnet internet-gateway path, same-VPC route targets, and AZ affinity; regional and private NAT remain explicit unsupported modes.",
    considerations: [
      "Connections: Place NAT in a public subnet and target it from private route tables in the same VPC, preferably the same AZ.",
      "Security: NAT permits return traffic for outbound connections but is not an ingress control or a replacement for security groups.",
      "Cost: NAT has hourly and per-gigabyte charges; cross-zone routing adds cost, while S3/DynamoDB gateway endpoints can reduce NAT use.",
      "Operations: Use one gateway per active AZ when resilience requires it and monitor port, address, route, and gateway health limits.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.nat-gateway.documentation.basics",
        title: "NAT gateway basics",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.nat-gateway.unsupported.private-and-regional",
      title: "Private and regional NAT modes",
      explanation:
        "Private NAT gateways and newer regional availability mode require separate placement, address, route, and readiness semantics.",
    },
    {
      id: "aws.ec2.nat-gateway.unsupported.advanced-addressing",
      title: "Advanced addressing and NAT64",
      explanation:
        "Secondary private addresses, multiple Elastic IP allocations, IPv6 NAT64, and customer-managed NAT instances are outside this slice.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.nat-gateway.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_nat_gateway",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.networking-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        { configurationKey: "allocationId", targetName: "allocation_id" },
        {
          configurationKey: "connectivityType",
          targetName: "connectivity_type",
        },
        {
          configurationKey: "availabilityMode",
          targetName: "availability_mode",
        },
      ],
      portBindings: [
        {
          portId: "aws.ec2.nat-gateway.subnet",
          targetAttribute: "subnet_id",
        },
      ],
    },
    {
      mappingId: "aws.ec2.nat-gateway.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::NatGateway",
      configurationBindings: [
        { configurationKey: "allocationId", targetName: "AllocationId" },
        {
          configurationKey: "connectivityType",
          targetName: "ConnectivityType",
        },
        {
          configurationKey: "availabilityMode",
          targetName: "AvailabilityMode",
        },
      ],
      portBindings: [
        {
          portId: "aws.ec2.nat-gateway.subnet",
          targetAttribute: "SubnetId",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound NAT gateway regional availability inventory is bundled with this catalog.",
  },
});
