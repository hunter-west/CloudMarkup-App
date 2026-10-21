import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

/** A graph-owned route configuration rendered only through its route table. */
export const route = defineProviderServiceV1({
  id: "aws.ec2.route",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "Route",
  description:
    "One IPv4 destination route owned by a route table and connected to exactly one supported gateway target.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.ec2.route",
    deployable: false,
  },
  iconId: null,
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.ec2.route-table",
        relationshipType: "aws.ec2.route-table-owns-route",
      },
    ],
    maximumDepth: 4,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.route.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.route.configuration:1.0.0",
      type: "object",
      title: "Route configuration",
      description:
        "One IPv4 destination; the selected semantic target supplies the gateway identifier.",
      additionalProperties: false,
      properties: {
        destinationIpv4Cidr: {
          type: "string",
          default: "0.0.0.0/0",
          minLength: 9,
          maxLength: 18,
          pattern:
            "^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}/(?:[0-9]|[12][0-9]|3[0-2])$",
        },
      },
      required: ["destinationIpv4Cidr"],
    },
    uiHints: [
      {
        property: "destinationIpv4Cidr",
        control: "text",
        label: "Destination IPv4 CIDR",
        helpText:
          "0.0.0.0/0 is a default route. Use a narrower CIDR whenever the target path does not need all IPv4 destinations.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
    ],
  },
  ports: [
    {
      id: "aws.ec2.route.route-table",
      displayName: "Route table",
      description: "Provides this route to its owning route table.",
      direction: "output",
      capability: "aws.ec2.route-table.route-member",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.route.internet-gateway-target",
      displayName: "Internet gateway target",
      description: "Targets one internet gateway for public IPv4 routing.",
      direction: "output",
      capability: "aws.ec2.route.internet-gateway-target",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.ec2.route.nat-gateway-target",
      displayName: "NAT gateway target",
      description: "Targets one NAT gateway for outbound IPv4 routing.",
      direction: "output",
      capability: "aws.ec2.route.nat-gateway-target",
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
      "Sends one IPv4 destination range to one reviewed internet or NAT gateway target.",
    guidedExplanation:
      "A route matches a destination range and chooses the next hop. A public subnet typically sends 0.0.0.0/0 to an internet gateway; a private subnet can send it to a NAT gateway for outbound IPv4 access. Choose exactly one target.",
    professionalExplanation:
      "This nondeployable owned configuration projects to a standalone route resource for each target. Validation enforces one route-table owner, exactly one supported gateway target, compatible VPC placement, and destination uniqueness.",
    considerations: [
      "Connections: Attach the route to one table and choose exactly one internet-gateway or NAT-gateway target.",
      "Security: A 0.0.0.0/0 route is broad reachability, not authorization; pair it with least-privilege security and workload controls.",
      "Cost: NAT processing, public IPv4 use, cross-zone paths, and data transfer can make the selected target materially expensive.",
      "Operations: Detect duplicate destinations, black-hole targets, and target replacement before treating a subnet as reachable.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.route.documentation.routes",
        title: "Routes in a route table",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html#route-table-routes",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.route.unsupported.ipv6-and-prefix-lists",
      title: "IPv6 and prefix-list destinations",
      explanation:
        "IPv6 destinations, managed prefix lists, and NAT64 require separate destination and target semantics.",
    },
    {
      id: "aws.ec2.route.unsupported.advanced-targets",
      title: "Advanced route targets",
      explanation:
        "Transit, VPN, peering, network-interface, instance, carrier, local, egress-only, and Network Firewall targets are outside this slice.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.route.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_route",
      projection: {
        kind: "owned-resource",
        rendererContractId: "cloudmarkup.iac.networking-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        {
          configurationKey: "destinationIpv4Cidr",
          targetName: "destination_cidr_block",
        },
      ],
      portBindings: [
        {
          portId: "aws.ec2.route.route-table",
          targetAttribute: "route_table_id",
        },
        {
          portId: "aws.ec2.route.internet-gateway-target",
          targetAttribute: "gateway_id",
        },
        {
          portId: "aws.ec2.route.nat-gateway-target",
          targetAttribute: "nat_gateway_id",
        },
      ],
    },
    {
      mappingId: "aws.ec2.route.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::Route",
      configurationBindings: [
        {
          configurationKey: "destinationIpv4Cidr",
          targetName: "DestinationCidrBlock",
        },
      ],
      portBindings: [
        {
          portId: "aws.ec2.route.route-table",
          targetAttribute: "RouteTableId",
        },
        {
          portId: "aws.ec2.route.internet-gateway-target",
          targetAttribute: "GatewayId",
        },
        {
          portId: "aws.ec2.route.nat-gateway-target",
          targetAttribute: "NatGatewayId",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound Amazon VPC route availability inventory is bundled with this catalog.",
  },
});
