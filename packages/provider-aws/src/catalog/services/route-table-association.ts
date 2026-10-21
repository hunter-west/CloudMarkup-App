import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

/** A graph-owned association rendered only with its route table and subnet. */
export const routeTableAssociation = defineProviderServiceV1({
  id: "aws.ec2.route-table-association",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "Subnet route-table association",
  description:
    "An explicit association between one route table and one subnet in the same VPC.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.ec2.route-table-association",
    deployable: false,
  },
  iconId: null,
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.ec2.route-table",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
      },
    ],
    maximumDepth: 4,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.route-table-association.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.route-table-association.configuration:1.0.0",
      type: "object",
      title: "Subnet route-table association configuration",
      description:
        "The owner and target graph references carry the complete bounded association.",
      additionalProperties: false,
      properties: {},
      required: [],
    },
    uiHints: [],
  },
  ports: [
    {
      id: "aws.ec2.route-table-association.route-table",
      displayName: "Route table",
      description: "Provides this association to its owning route table.",
      direction: "output",
      capability: "aws.ec2.route-table.subnet-association",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.route-table-association.subnet",
      displayName: "Subnet",
      description: "Targets the one subnet that uses the route table.",
      direction: "output",
      capability: "aws.ec2.subnet.route-table-association",
      category: "network-and-security",
      cardinality: "one",
      required: true,
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
      "Assigns one explicit route table to one subnet without treating either resource as the other's container.",
    guidedExplanation:
      "Connect a route table to a subnet through this association. The subnet then follows that table's routes. Keeping the association explicit makes public/private behavior reviewable and avoids relying on the VPC's implicit main route table.",
    professionalExplanation:
      "This nondeployable graph concept projects to a standalone subnet route-table association. Owner and target edges are required, same-VPC placement is validated, and replacement never silently changes another subnet's routing policy.",
    considerations: [
      "Connections: Select exactly one owning route table and one target subnet in the same VPC.",
      "Security: Review the table's effective routes before association because the change can add or remove reachable network paths.",
      "Cost: The association has no direct charge, but its selected NAT, endpoint, public, and cross-zone routes can incur cost.",
      "Operations: Preview replacement and preserve the previous association until the reviewed graph operation succeeds atomically.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.route-table-association.documentation.explicit",
        title: "Subnet route table associations",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.route-table-association.unsupported.gateway-association",
      title: "Gateway route-table associations",
      explanation:
        "Internet-gateway and virtual-private-gateway route-table edge associations are distinct AWS concepts outside this slice.",
    },
    {
      id: "aws.ec2.route-table-association.unsupported.main-table-replacement",
      title: "Main route-table replacement",
      explanation:
        "This concept does not replace the VPC main route table or adopt an implicit main-table association.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.route-table-association.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_route_table_association",
      projection: {
        kind: "owned-resource",
        rendererContractId: "cloudmarkup.iac.networking-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [],
      portBindings: [
        {
          portId: "aws.ec2.route-table-association.route-table",
          targetAttribute: "route_table_id",
        },
        {
          portId: "aws.ec2.route-table-association.subnet",
          targetAttribute: "subnet_id",
        },
      ],
    },
    {
      mappingId: "aws.ec2.route-table-association.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::SubnetRouteTableAssociation",
      configurationBindings: [],
      portBindings: [
        {
          portId: "aws.ec2.route-table-association.route-table",
          targetAttribute: "RouteTableId",
        },
        {
          portId: "aws.ec2.route-table-association.subnet",
          targetAttribute: "SubnetId",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound Amazon VPC route-association availability inventory is bundled with this catalog.",
  },
});
