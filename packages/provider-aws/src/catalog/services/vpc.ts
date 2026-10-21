import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const vpc = defineProviderServiceV1({
  id: "aws.ec2.vpc",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "Virtual private cloud",
  description:
    "An IPv4 AWS VPC boundary with explicit DNS posture and reviewed networking associations.",
  nodeKind: {
    kind: "boundary",
    boundaryType: "aws.ec2.vpc",
    containmentModel: "provider-semantic",
  },
  iconId: "aws.cloudmarkup.icons.vpc",
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.region.boundary",
        relationshipType: "aws.region.contains-vpc",
      },
    ],
    maximumDepth: 2,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.vpc.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.vpc.configuration:1.0.0",
      type: "object",
      title: "VPC configuration",
      description:
        "A bounded IPv4 CIDR, DNS posture, and default-tenancy configuration for one VPC.",
      additionalProperties: false,
      properties: {
        cidrBlock: {
          type: "string",
          default: "10.0.0.0/16",
          minLength: 9,
          maxLength: 18,
          pattern:
            "^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}/(?:[0-9]|[12][0-9]|3[0-2])$",
        },
        enableDnsSupport: { type: "boolean", default: true },
        enableDnsHostnames: { type: "boolean", default: true },
        instanceTenancy: {
          type: "string",
          enum: ["default"],
          default: "default",
        },
      },
      required: [
        "cidrBlock",
        "enableDnsSupport",
        "enableDnsHostnames",
        "instanceTenancy",
      ],
    },
    uiHints: [
      {
        property: "cidrBlock",
        control: "text",
        label: "IPv4 CIDR block",
        helpText:
          "Choose a private, non-overlapping address range with room for every planned subnet and future growth.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "enableDnsSupport",
        control: "checkbox",
        label: "Enable DNS resolution",
        helpText: "Required for normal Route 53 Resolver behavior in the VPC.",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "enableDnsHostnames",
        control: "checkbox",
        label: "Enable DNS hostnames",
        helpText:
          "Assign AWS-provided DNS hostnames when the resource and address type support them.",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "instanceTenancy",
        control: "select",
        label: "Instance tenancy",
        helpText:
          "This catalog intentionally supports only shared default tenancy.",
        order: 3,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
    ],
  },
  ports: [
    {
      id: "aws.ec2.vpc.region",
      displayName: "Region",
      description: "Accepts the Region boundary that contains this VPC.",
      direction: "input",
      capability: "aws.region.vpc-placement",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.vpc.availability-zone-placement",
      displayName: "Availability Zones",
      description: "Places Availability Zone boundaries in this VPC.",
      direction: "output",
      capability: "aws.ec2.vpc.availability-zone-placement",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.vpc.route-table-placement",
      displayName: "Route tables",
      description: "Places explicit route tables in this VPC.",
      direction: "output",
      capability: "aws.ec2.vpc.route-table-placement",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.vpc.gateway-endpoint-placement",
      displayName: "Gateway endpoints",
      description: "Places S3 or DynamoDB gateway endpoints in this VPC.",
      direction: "output",
      capability: "aws.ec2.vpc.gateway-endpoint-placement",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.vpc.internet-gateway-attachment",
      displayName: "Internet gateway",
      description: "Associates at most one internet gateway with this VPC.",
      direction: "output",
      capability: "aws.ec2.vpc.internet-gateway-attachment",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.ec2.vpc.security-group-association",
      displayName: "Security groups",
      description:
        "Associates security-group policies with resources in this VPC.",
      direction: "output",
      capability: "aws.ec2.vpc.security-group-association",
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
      "Defines the private IPv4 address boundary for an application's regional network.",
    guidedExplanation:
      "A VPC is the top-level customer network inside one Region. Put Availability Zones and their subnets inside it, then attach route tables, gateways, endpoints, and security-group policies through their explicit relationships.",
    professionalExplanation:
      "Models one default-tenancy IPv4 VPC with DNS support and hostname controls. Containment covers only Region, Availability Zone, subnet, route-table, and gateway-endpoint placement; gateways and security groups remain associations rather than children.",
    considerations: [
      "Connections: Contain AZs and route tables, then use explicit associations for internet gateways and security groups.",
      "Security: Avoid overlapping CIDRs, keep DNS settings deliberate, and treat routing and security groups as separate controls.",
      "Cost: The VPC itself has no hourly charge, but NAT gateways, endpoints, addresses, and cross-zone data paths can cost money.",
      "Operations: Reserve address space for multiple AZs and growth; changing a primary CIDR later can require replacement or migration.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.vpc.documentation.overview",
        title: "What is Amazon VPC?",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.vpc.unsupported.ipv6-and-secondary-cidrs",
      title: "IPv6 and secondary CIDR blocks",
      explanation:
        "IPv6-only networking, IPAM allocation, secondary CIDRs, and IPv6 egress controls need separate reviewed semantics.",
    },
    {
      id: "aws.ec2.vpc.unsupported.dedicated-tenancy",
      title: "Dedicated tenancy and custom DHCP options",
      explanation:
        "Dedicated or host tenancy, DHCP option sets, default-resource adoption, peering, transit, VPN, and Network Firewall are outside this slice.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.vpc.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_vpc",
      configurationBindings: [
        { configurationKey: "cidrBlock", targetName: "cidr_block" },
        {
          configurationKey: "enableDnsSupport",
          targetName: "enable_dns_support",
        },
        {
          configurationKey: "enableDnsHostnames",
          targetName: "enable_dns_hostnames",
        },
        {
          configurationKey: "instanceTenancy",
          targetName: "instance_tenancy",
        },
      ],
      portBindings: [],
    },
    {
      mappingId: "aws.ec2.vpc.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::VPC",
      configurationBindings: [
        { configurationKey: "cidrBlock", targetName: "CidrBlock" },
        {
          configurationKey: "enableDnsSupport",
          targetName: "EnableDnsSupport",
        },
        {
          configurationKey: "enableDnsHostnames",
          targetName: "EnableDnsHostnames",
        },
        {
          configurationKey: "instanceTenancy",
          targetName: "InstanceTenancy",
        },
      ],
      portBindings: [],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound Amazon VPC regional availability dataset is bundled with this catalog.",
  },
});
