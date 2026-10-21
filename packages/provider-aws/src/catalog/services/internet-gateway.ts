import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const internetGateway = defineProviderServiceV1({
  id: "aws.ec2.internet-gateway",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "Internet gateway",
  description:
    "A VPC internet gateway associated with one VPC and targeted by reviewed public IPv4 routes.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.ec2.internet-gateway",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.internet-gateway",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.internet-gateway.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.internet-gateway.configuration:1.0.0",
      type: "object",
      title: "Internet gateway configuration",
      description:
        "A stable design name; VPC attachment and route targets remain explicit relationships.",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          default: "internet-gateway",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9 ._/-]*$",
        },
      },
      required: ["name"],
    },
    uiHints: [
      {
        property: "name",
        control: "text",
        label: "Internet gateway name",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.ec2.internet-gateway.vpc-attachment",
      displayName: "VPC attachment",
      description: "Accepts attachment to exactly one VPC.",
      direction: "input",
      capability: "aws.ec2.vpc.internet-gateway-attachment",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.internet-gateway.route-target",
      displayName: "Public route targets",
      description: "Accepts IPv4 routes that target this internet gateway.",
      direction: "input",
      capability: "aws.ec2.route.internet-gateway-target",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.network-placement",
    "aws.cloudmarkup.validation.network-routing",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Provides a VPC route target for public IPv4 internet connectivity.",
    guidedExplanation:
      "Attach one internet gateway to the VPC, then point only intended public-subnet routes at it. The gateway alone does not expose a workload: the resource also needs a suitable address, route, security-group policy, and listening application.",
    professionalExplanation:
      "Models the gateway separately from its VPC attachment and route references. Terraform renders the reviewed one-VPC attachment with deterministic ordering and Name-tag projection; CloudFormation attachment projection remains pending.",
    considerations: [
      "Connections: Attach the gateway to one VPC and target it only from route tables in that same VPC.",
      "Security: An internet route creates a path, not permission; public addresses, security groups, identity, and workload listeners still govern access.",
      "Cost: Internet gateways have no hourly charge, but public IPv4 addresses and internet data transfer can incur charges.",
      "Operations: Review attachment and route dependencies so gateway replacement cannot leave public subnets with black-hole routes.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.internet-gateway.documentation.overview",
        title: "Connect your VPC to the internet using an internet gateway",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.internet-gateway.unsupported.ipv6-egress-only",
      title: "Egress-only internet gateways",
      explanation:
        "IPv6 egress-only gateways, NAT64, and IPv6 route targets require separate reviewed resource semantics.",
    },
    {
      id: "aws.ec2.internet-gateway.unsupported.implicit-exposure",
      title: "Implicit public exposure",
      explanation:
        "Attachment never creates public routes, addresses, ingress rules, listeners, or workload exposure automatically.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.internet-gateway.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_internet_gateway",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.networking-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        { configurationKey: "name", targetName: "tags.Name" },
      ],
      portBindings: [
        {
          portId: "aws.ec2.internet-gateway.vpc-attachment",
          targetAttribute: "vpc_id",
        },
      ],
    },
    {
      mappingId: "aws.ec2.internet-gateway.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::InternetGateway",
      configurationBindings: [],
      portBindings: [],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound Amazon VPC internet-gateway availability inventory is bundled with this catalog.",
  },
});
