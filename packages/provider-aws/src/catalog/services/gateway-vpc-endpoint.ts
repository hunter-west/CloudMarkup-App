import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const gatewayVpcEndpoint = defineProviderServiceV1({
  id: "aws.ec2.gateway-vpc-endpoint",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "Gateway VPC endpoint",
  description:
    "An S3 or DynamoDB gateway endpoint associated with selected VPC route tables and an optional reviewed resource policy.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.ec2.gateway-vpc-endpoint",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.gateway-vpc-endpoint",
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.ec2.vpc",
        relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
      },
    ],
    maximumDepth: 3,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.gateway-vpc-endpoint.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.gateway-vpc-endpoint.configuration:1.0.0",
      type: "object",
      title: "Gateway VPC endpoint configuration",
      description:
        "A bounded S3 or DynamoDB gateway endpoint with an explicit policy posture.",
      additionalProperties: false,
      properties: {
        service: {
          type: "string",
          enum: ["s3", "dynamodb"],
          default: "s3",
        },
        endpointType: {
          type: "string",
          enum: ["Gateway"],
          default: "Gateway",
        },
        policyMode: {
          type: "string",
          enum: ["full-access", "restricted"],
        },
      },
      required: ["service", "endpointType", "policyMode"],
    },
    uiHints: [
      {
        property: "service",
        control: "select",
        label: "AWS managed service",
        helpText:
          "Gateway endpoints are limited to Amazon S3 and DynamoDB in the endpoint's Region.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "endpointType",
        control: "select",
        label: "Endpoint type",
        helpText:
          "Gateway is fixed; interface and resource endpoints have different networking and cost semantics.",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "policyMode",
        control: "select",
        label: "Endpoint policy",
        helpText:
          "Choose full access explicitly or connect a restricted graph-backed resource policy; no policy posture is assumed.",
        order: 2,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.ec2.gateway-vpc-endpoint.vpc",
      displayName: "VPC",
      description: "Accepts the VPC that contains this endpoint.",
      direction: "input",
      capability: "aws.ec2.vpc.gateway-endpoint-placement",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.gateway-vpc-endpoint.resource-policy",
      displayName: "Resource policy",
      description:
        "Accepts one graph-backed restricted endpoint policy when selected.",
      direction: "input",
      capability: "aws.ec2.gateway-vpc-endpoint.resource-policy",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.ec2.gateway-vpc-endpoint.route-table-association",
      displayName: "Route tables",
      description:
        "Associates the endpoint-managed service route with selected route tables.",
      direction: "output",
      capability: "aws.ec2.gateway-vpc-endpoint.route-table-association",
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
    "aws.cloudmarkup.validation.network-routing",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Routes selected VPC traffic to regional S3 or DynamoDB without using an internet or NAT gateway path.",
    guidedExplanation:
      "Choose S3 or DynamoDB, select the route tables that should use the endpoint, and make a deliberate policy choice. The managed service stays outside your VPC; AWS adds a service prefix-list route to each selected table.",
    professionalExplanation:
      "Models a same-Region Gateway endpoint with route-table bindings and a policy-mode discriminator. The reviewed Terraform projection derives the regional service_name deterministically from the short S3 or DynamoDB choice; CloudFormation projection remains metadata-only.",
    considerations: [
      "Connections: Select one VPC and at least one route table; the S3 or DynamoDB service itself remains outside the VPC boundary.",
      "Security: Use a restricted endpoint policy and resource policy controls when full service access is not intended.",
      "Cost: Gateway endpoints have no hourly endpoint charge, and they can avoid NAT processing for supported regional service traffic.",
      "Operations: Update every required route table and remember that endpoint removal also removes its managed service routes.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.gateway-vpc-endpoint.documentation.overview",
        title: "Gateway endpoints for Amazon S3 and DynamoDB",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.gateway-vpc-endpoint.unsupported.interface-endpoints",
      title: "Interface and resource endpoints",
      explanation:
        "Interface endpoints, endpoint network interfaces, private DNS, resource endpoints, and custom endpoint services need separate semantics.",
    },
    {
      id: "aws.ec2.gateway-vpc-endpoint.unsupported.cross-region",
      title: "Cross-Region and arbitrary-service endpoints",
      explanation:
        "Only same-Region S3 and DynamoDB gateway services are accepted; custom service names and cross-Region service routes are rejected.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.gateway-vpc-endpoint.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_vpc_endpoint",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.networking-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        {
          configurationKey: "endpointType",
          targetName: "vpc_endpoint_type",
        },
        {
          configurationKey: "service",
          targetName: "service_name",
        },
      ],
      semanticConfigurationKeys: ["policyMode"],
      portBindings: [
        {
          portId: "aws.ec2.gateway-vpc-endpoint.vpc",
          targetAttribute: "vpc_id",
        },
        {
          portId: "aws.ec2.gateway-vpc-endpoint.resource-policy",
          targetAttribute: "policy",
        },
        {
          portId: "aws.ec2.gateway-vpc-endpoint.route-table-association",
          targetAttribute: "route_table_ids",
        },
      ],
    },
    {
      mappingId: "aws.ec2.gateway-vpc-endpoint.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::VPCEndpoint",
      configurationBindings: [
        {
          configurationKey: "endpointType",
          targetName: "VpcEndpointType",
        },
      ],
      portBindings: [
        {
          portId: "aws.ec2.gateway-vpc-endpoint.vpc",
          targetAttribute: "VpcId",
        },
        {
          portId: "aws.ec2.gateway-vpc-endpoint.resource-policy",
          targetAttribute: "PolicyDocument",
        },
        {
          portId: "aws.ec2.gateway-vpc-endpoint.route-table-association",
          targetAttribute: "RouteTableIds",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound S3 and DynamoDB gateway-endpoint regional availability inventory is bundled with this catalog.",
  },
});
