import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const routeTable = defineProviderServiceV1({
  id: "aws.ec2.route-table",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "Route table",
  description:
    "An explicit VPC route table that owns routes and reviewed subnet or gateway-endpoint associations.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.ec2.route-table",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.route-table",
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.ec2.vpc",
        relationshipType: "aws.ec2.vpc-contains-route-table",
      },
    ],
    maximumDepth: 3,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.route-table.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.route-table.configuration:1.0.0",
      type: "object",
      title: "Route table configuration",
      description:
        "A stable design name for one explicit route table; routes and associations remain separate graph concepts.",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          default: "application-routes",
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
        label: "Route table name",
        helpText:
          "Use a purpose-based name such as public-ingress or private-application.",
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
      id: "aws.ec2.route-table.vpc",
      displayName: "VPC",
      description: "Accepts the VPC that owns this route table.",
      direction: "input",
      capability: "aws.ec2.vpc.route-table-placement",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.route-table.route",
      displayName: "Routes",
      description: "Accepts routes owned by this table.",
      direction: "input",
      capability: "aws.ec2.route-table.route-member",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.route-table.subnet-association",
      displayName: "Subnet associations",
      description: "Accepts explicit subnet associations owned by this table.",
      direction: "input",
      capability: "aws.ec2.route-table.subnet-association",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.route-table.gateway-endpoint-association",
      displayName: "Gateway endpoint associations",
      description:
        "Accepts S3 or DynamoDB gateway-endpoint route-table associations.",
      direction: "input",
      capability: "aws.ec2.gateway-vpc-endpoint.route-table-association",
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
      "Groups destination routes and assigns one routing policy to selected subnets.",
    guidedExplanation:
      "A route table answers where traffic should go. Add explicit routes, then associate the table with each subnet that should use that policy. A subnet uses one route table at a time; S3 and DynamoDB gateway endpoints also add managed routes to selected tables.",
    professionalExplanation:
      "Models an explicit VPC route table with child route and association configurations. The VPC's implicit main route table is not silently adopted, and subnet plus gateway-endpoint bindings remain typed associations rather than containment.",
    considerations: [
      "Connections: Own explicit routes and associate each intended subnet; gateway endpoints bind only to selected route tables.",
      "Security: A route enables a path but does not authorize traffic; security groups, endpoint policies, and workload controls still apply.",
      "Cost: Route tables and routes have no separate hourly charge, but chosen NAT, endpoint, cross-zone, and transfer paths may cost money.",
      "Operations: Keep public and private policies distinct, avoid ambiguous main-table reliance, and review every default route target.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.route-table.documentation.overview",
        title: "Route tables for your VPC",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.route-table.unsupported.main-table-adoption",
      title: "Implicit main route-table adoption",
      explanation:
        "This slice models explicit route tables and associations; it does not mutate or adopt an account's implicit main route table.",
    },
    {
      id: "aws.ec2.route-table.unsupported.propagation",
      title: "Route propagation and advanced targets",
      explanation:
        "VPN, transit-gateway, prefix-list, carrier, local-gateway, peering, Network Firewall, and propagated routes are outside this slice.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.route-table.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_route_table",
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
          portId: "aws.ec2.route-table.vpc",
          targetAttribute: "vpc_id",
        },
      ],
    },
    {
      mappingId: "aws.ec2.route-table.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::RouteTable",
      configurationBindings: [],
      portBindings: [
        {
          portId: "aws.ec2.route-table.vpc",
          targetAttribute: "VpcId",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound Amazon VPC route-table availability inventory is bundled with this catalog.",
  },
});
