import {
  defineProviderConnectionRuleV1,
  providerServiceConfigurationV1Schema,
  type ProviderConnectionRuleDescriptorV1,
  type ProviderConnectionRuleDescriptorV1Input,
} from "@cloudmarkup/provider-sdk";

const connectionLifecycle = {
  provenance: "connection-rule",
  deletion: "release-generated-resources",
  adoption: "required-before-customization",
  sharedResource: "retain-while-referenced",
} as const;

type ConnectionInput = ProviderConnectionRuleDescriptorV1Input;
type OfficialDocumentation = Extract<
  ConnectionInput["education"]["documentation"][number],
  { readonly kind: "official" }
>;

interface NetworkingConnectionDefinition {
  readonly id: string;
  readonly source: ConnectionInput["source"];
  readonly target: ConnectionInput["target"];
  readonly maximumConnectionsPerSource: number;
  readonly maximumConnectionsPerTarget: number;
  readonly maximumConnectionsPerEndpointPair?: number;
  readonly implementation: ConnectionInput["implementation"];
  readonly validationRuleIds: ConnectionInput["validationRuleIds"];
  readonly title: string;
  readonly summary: string;
  readonly guidedExplanation: string;
  readonly professionalExplanation: string;
  readonly costConsideration: string;
  readonly operationsConsideration: string;
  readonly documentation: OfficialDocumentation;
}

function emptyConnectionConfiguration(
  ruleId: string,
  title: string,
): ConnectionInput["configuration"] {
  const schemaId = `${ruleId}.connection`;
  return providerServiceConfigurationV1Schema.parse({
    schemaId,
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `urn:cloudmarkup:configuration:${schemaId}:1.0.0`,
      type: "object",
      title,
      description:
        "The exact graph endpoints and their typed node configuration carry this relationship; no duplicate provider identifiers or transient attachment values are stored on the edge.",
      additionalProperties: false,
      properties: {},
      required: [],
    },
    uiHints: [],
  });
}

function networkingConnection(
  definition: NetworkingConnectionDefinition,
): ProviderConnectionRuleDescriptorV1 {
  return defineProviderConnectionRuleV1({
    id: definition.id,
    ruleVersion: "1.0.0",
    relationshipType: definition.id,
    category: "network-and-security",
    source: definition.source,
    target: definition.target,
    maximumConnectionsPerSource: definition.maximumConnectionsPerSource,
    maximumConnectionsPerTarget: definition.maximumConnectionsPerTarget,
    maximumConnectionsPerEndpointPair:
      definition.maximumConnectionsPerEndpointPair ?? 1,
    configuration: emptyConnectionConfiguration(
      definition.id,
      definition.title,
    ),
    questions: [],
    supportingChanges: [],
    iamEffects: [],
    missingInformationFindings: [],
    lifecycle: connectionLifecycle,
    implementation: definition.implementation,
    validationRuleIds: definition.validationRuleIds,
    education: {
      summary: definition.summary,
      guidedExplanation: definition.guidedExplanation,
      professionalExplanation: definition.professionalExplanation,
      considerations: [
        "Connections: The exact source and destination ports preserve placement or association meaning without turning an association into false containment.",
        "Security: This relationship grants no IAM permission and stores no account identifier, credential, secret, or raw provider configuration.",
        definition.costConsideration,
        definition.operationsConsideration,
      ],
      documentation: [definition.documentation],
    },
  });
}

function canonicalPlacementOperation(
  reason: string,
): ConnectionInput["implementation"] {
  return {
    status: "not-implemented",
    reason: `Canonical placement operations apply this relationship through reviewed Graph Command preconditions and atomic reparenting; the free-form connection resolver cannot create or move boundaries. ${reason}`,
  };
}

function canonicalOwnedConfigurationOperation(
  reason: string,
): ConnectionInput["implementation"] {
  return {
    status: "not-implemented",
    reason: `The structured owned-configuration workflow applies this exact owner slot through reviewed canonical Graph Command operations; it is not a free-form connection recipe. ${reason}`,
  };
}

function canonicalPolicyOperation(
  reason: string,
): ConnectionInput["implementation"] {
  return {
    status: "not-implemented",
    reason: `The structured policy workflow applies this exact resource-policy owner slot through reviewed canonical Graph Command operations; it is not a free-form connection recipe. ${reason}`,
  };
}

function implemented(
  implementationId: string,
): ConnectionInput["implementation"] {
  return {
    status: "implemented",
    interfaceVersion: 1,
    implementationId,
  };
}

const networkPlacementValidationIds: ConnectionInput["validationRuleIds"] = [
  "aws.cloudmarkup.validation.connection-cardinality",
  "aws.cloudmarkup.validation.network-placement",
];
const networkRoutingValidationIds: ConnectionInput["validationRuleIds"] = [
  "aws.cloudmarkup.validation.connection-cardinality",
  "aws.cloudmarkup.validation.network-routing",
];
const securityGroupValidationIds: ConnectionInput["validationRuleIds"] = [
  "aws.cloudmarkup.validation.connection-cardinality",
  "aws.cloudmarkup.validation.security-group-policy",
];
const lambdaVpcValidationIds: ConnectionInput["validationRuleIds"] = [
  "aws.cloudmarkup.validation.connection-cardinality",
  "aws.cloudmarkup.validation.lambda-vpc-access",
];

const vpcDocumentation = {
  kind: "official",
  id: "aws.ec2.documentation.vpc-relationships",
  title: "What is Amazon VPC?",
  publisher: "Amazon Web Services",
  url: "https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html",
} as const;
const availabilityZoneDocumentation = {
  kind: "official",
  id: "aws.ec2.documentation.availability-zones",
  title: "AWS Regions and Availability Zones",
  publisher: "Amazon Web Services",
  url: "https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html",
} as const;
const subnetDocumentation = {
  kind: "official",
  id: "aws.ec2.documentation.subnets",
  title: "Configure subnets",
  publisher: "Amazon Web Services",
  url: "https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html",
} as const;
const routeTableDocumentation = {
  kind: "official",
  id: "aws.ec2.documentation.route-tables",
  title: "Route tables",
  publisher: "Amazon Web Services",
  url: "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html",
} as const;
const internetGatewayDocumentation = {
  kind: "official",
  id: "aws.ec2.documentation.internet-gateways",
  title: "Connect to the internet using an internet gateway",
  publisher: "Amazon Web Services",
  url: "https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html",
} as const;
const natGatewayDocumentation = {
  kind: "official",
  id: "aws.ec2.documentation.nat-gateways",
  title: "NAT gateway basics",
  publisher: "Amazon Web Services",
  url: "https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html",
} as const;
const gatewayEndpointDocumentation = {
  kind: "official",
  id: "aws.ec2.documentation.gateway-endpoints",
  title: "Gateway endpoints",
  publisher: "Amazon Web Services",
  url: "https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html",
} as const;
const endpointPolicyDocumentation = {
  kind: "official",
  id: "aws.ec2.documentation.endpoint-policies",
  title: "Control access to VPC endpoints using endpoint policies",
  publisher: "Amazon Web Services",
  url: "https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html",
} as const;
const securityGroupDocumentation = {
  kind: "official",
  id: "aws.ec2.documentation.security-groups",
  title: "Control traffic to your AWS resources using security groups",
  publisher: "Amazon Web Services",
  url: "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html",
} as const;
const lambdaVpcDocumentation = {
  kind: "official",
  id: "aws.lambda.documentation.vpc-access",
  title: "Configure a Lambda function to connect to a VPC",
  publisher: "Amazon Web Services",
  url: "https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html",
} as const;

export const regionContainsVpc = networkingConnection({
  id: "aws.region.contains-vpc",
  source: {
    serviceId: "aws.region.boundary",
    portId: "aws.region.boundary.vpc-placement",
  },
  target: { serviceId: "aws.ec2.vpc", portId: "aws.ec2.vpc.region" },
  maximumConnectionsPerSource: 100,
  maximumConnectionsPerTarget: 1,
  implementation: canonicalPlacementOperation(
    "The document Region remains authoritative and validation rejects a mismatched boundary.",
  ),
  validationRuleIds: networkPlacementValidationIds,
  title: "Region VPC placement",
  summary: "Places one VPC inside the document's AWS Region boundary.",
  guidedExplanation:
    "Place the VPC in the Region boundary selected for this architecture. The boundary helps people read the diagram; it does not create a second Region setting.",
  professionalExplanation:
    "Binds one VPC parent to the exact Region boundary while the Architecture Document provider Region remains the canonical regional value.",
  costConsideration:
    "Cost: Region placement changes latency, availability, and service pricing context, but this edge itself creates no billable resource.",
  operationsConsideration:
    "Operations: Reparenting is an explicit reviewed operation and must preserve the VPC, its descendants, stable IDs, and same-Region invariants.",
  documentation: vpcDocumentation,
});

export const vpcContainsAvailabilityZone = networkingConnection({
  id: "aws.ec2.vpc-contains-availability-zone",
  source: {
    serviceId: "aws.ec2.vpc",
    portId: "aws.ec2.vpc.availability-zone-placement",
  },
  target: {
    serviceId: "aws.ec2.availability-zone",
    portId: "aws.ec2.availability-zone.vpc",
  },
  maximumConnectionsPerSource: 100,
  maximumConnectionsPerTarget: 1,
  implementation: canonicalPlacementOperation(
    "An Availability Zone boundary belongs to exactly one VPC view in this catalog.",
  ),
  validationRuleIds: networkPlacementValidationIds,
  title: "VPC Availability Zone placement",
  summary: "Places an Availability Zone boundary inside one VPC.",
  guidedExplanation:
    "Use Availability Zone boundaries to separate subnets that can continue operating when another zone has a problem.",
  professionalExplanation:
    "Provides a deterministic VPC-to-zone placement parent used by subnet topology validation; it does not claim that a VPC owns the AWS Availability Zone.",
  costConsideration:
    "Cost: Zone placement can affect cross-zone data transfer and NAT routing costs; review traffic paths across every connected zone.",
  operationsConsideration:
    "Operations: Multi-AZ recommendations are validation findings, while the placement edge records only the exact selected zone boundary.",
  documentation: availabilityZoneDocumentation,
});

export const availabilityZoneContainsSubnet = networkingConnection({
  id: "aws.ec2.availability-zone-contains-subnet",
  source: {
    serviceId: "aws.ec2.availability-zone",
    portId: "aws.ec2.availability-zone.subnet-placement",
  },
  target: {
    serviceId: "aws.ec2.subnet",
    portId: "aws.ec2.subnet.availability-zone",
  },
  maximumConnectionsPerSource: 100,
  maximumConnectionsPerTarget: 1,
  implementation: canonicalPlacementOperation(
    "A subnet belongs to exactly one Availability Zone and cannot be reparented implicitly.",
  ),
  validationRuleIds: networkPlacementValidationIds,
  title: "Availability Zone subnet placement",
  summary:
    "Places one public or private subnet in exactly one Availability Zone.",
  guidedExplanation:
    "Choose the one Availability Zone for this subnet. Public or private intent comes from its access tier and reviewed routes, not from the visual boundary alone.",
  professionalExplanation:
    "Records the subnet's exclusive zone parent; deterministic validation checks Region, VPC ancestry, CIDR overlap, and routing posture separately.",
  costConsideration:
    "Cost: Subnet placement influences cross-zone traffic charges and zonal NAT choices even though the containment edge has no direct price.",
  operationsConsideration:
    "Operations: Moving a subnet between zones changes deployment meaning and therefore requires explicit review rather than a layout-only drag.",
  documentation: subnetDocumentation,
});

export const vpcContainsRouteTable = networkingConnection({
  id: "aws.ec2.vpc-contains-route-table",
  source: {
    serviceId: "aws.ec2.vpc",
    portId: "aws.ec2.vpc.route-table-placement",
  },
  target: {
    serviceId: "aws.ec2.route-table",
    portId: "aws.ec2.route-table.vpc",
  },
  maximumConnectionsPerSource: 100,
  maximumConnectionsPerTarget: 1,
  implementation: canonicalPlacementOperation(
    "A route table is scoped to exactly one VPC and uses explicit subnet associations.",
  ),
  validationRuleIds: networkRoutingValidationIds,
  title: "VPC route table placement",
  summary: "Scopes one route table to exactly one VPC.",
  guidedExplanation:
    "Keep the route table in the VPC whose subnets it controls, then associate each subnet explicitly so no hidden main-table behavior is assumed.",
  professionalExplanation:
    "Binds route-table VPC scope without implying a subnet association; route and association configurations remain independently reviewed graph facts.",
  costConsideration:
    "Cost: Route tables are not priced by this edge, but their selected NAT, endpoint, and cross-zone targets can create material charges.",
  operationsConsideration:
    "Operations: Main-route-table inheritance is intentionally unsupported; every supported subnet association must be explicit in the graph.",
  documentation: routeTableDocumentation,
});

export const subnetContainsNatGateway = networkingConnection({
  id: "aws.ec2.subnet-contains-nat-gateway",
  source: {
    serviceId: "aws.ec2.subnet",
    portId: "aws.ec2.subnet.nat-gateway-placement",
  },
  target: {
    serviceId: "aws.ec2.nat-gateway",
    portId: "aws.ec2.nat-gateway.subnet",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 1,
  implementation: canonicalPlacementOperation(
    "This slice supports one zonal public NAT gateway in a public subnet; regional and private NAT modes are explicit exclusions.",
  ),
  validationRuleIds: networkRoutingValidationIds,
  title: "Public subnet NAT gateway placement",
  summary: "Places one supported zonal public NAT gateway in a public subnet.",
  guidedExplanation:
    "Place the NAT gateway in a public subnet that can reach the internet gateway. Private subnets can then choose it for outbound IPv4 access.",
  professionalExplanation:
    "Constrains the supported NAT posture to one zonal public NAT per public subnet; public routing, allocation, same-VPC, and cross-zone findings remain validator-owned.",
  costConsideration:
    "Cost: NAT gateways have hourly and data-processing charges, and cross-zone routing to a NAT can add transfer cost; compare gateway endpoints first.",
  operationsConsideration:
    "Operations: Use one NAT in each workload zone when resilience justifies the cost; regional NAT and private connectivity are outside this version.",
  documentation: natGatewayDocumentation,
});

export const vpcContainsGatewayEndpoint = networkingConnection({
  id: "aws.ec2.vpc-contains-gateway-endpoint",
  source: {
    serviceId: "aws.ec2.vpc",
    portId: "aws.ec2.vpc.gateway-endpoint-placement",
  },
  target: {
    serviceId: "aws.ec2.gateway-vpc-endpoint",
    portId: "aws.ec2.gateway-vpc-endpoint.vpc",
  },
  maximumConnectionsPerSource: 16,
  maximumConnectionsPerTarget: 1,
  implementation: canonicalPlacementOperation(
    "The endpoint belongs to one VPC while S3 and DynamoDB remain external managed services.",
  ),
  validationRuleIds: networkRoutingValidationIds,
  title: "VPC gateway endpoint placement",
  summary: "Scopes one S3 or DynamoDB gateway endpoint to a VPC.",
  guidedExplanation:
    "Add the endpoint to the VPC, then choose the route tables that should reach S3 or DynamoDB without sending that traffic through a NAT gateway.",
  professionalExplanation:
    "Binds the gateway endpoint's VPC scope while preserving S3 and DynamoDB as managed services outside customer-controlled VPC containment.",
  costConsideration:
    "Cost: Gateway endpoints can avoid NAT processing for supported service traffic; this relationship makes no broader PrivateLink pricing claim.",
  operationsConsideration:
    "Operations: The endpoint service, route-table associations, and optional resource policy are separately visible and reviewed facts.",
  documentation: gatewayEndpointDocumentation,
});

export const routeTableOwnsRoute = networkingConnection({
  id: "aws.ec2.route-table-owns-route",
  source: {
    serviceId: "aws.ec2.route",
    portId: "aws.ec2.route.route-table",
  },
  target: {
    serviceId: "aws.ec2.route-table",
    portId: "aws.ec2.route-table.route",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 100,
  implementation: canonicalOwnedConfigurationOperation(
    "The route node stores its destination and exactly one reviewed target association.",
  ),
  validationRuleIds: networkRoutingValidationIds,
  title: "Route table route ownership",
  summary: "Owns one typed route configuration from a route table.",
  guidedExplanation:
    "Add routes from the route table's Routes menu. Each route keeps its destination and selected internet or NAT target together for review.",
  professionalExplanation:
    "Binds a graph-backed route configuration to one route-table slot with user/generated lifecycle, exact target edges, and adoption-before-customization semantics.",
  costConsideration:
    "Cost: The route itself is not priced, but choosing NAT, cross-zone, or external targets can change data-processing and transfer charges.",
  operationsConsideration:
    "Operations: Route replacement and cleanup preserve stable provenance and never remove a user-owned route as a side effect of another connection.",
  documentation: routeTableDocumentation,
});

export const routeTableOwnsSubnetAssociation = networkingConnection({
  id: "aws.ec2.route-table-owns-subnet-association",
  source: {
    serviceId: "aws.ec2.route-table-association",
    portId: "aws.ec2.route-table-association.route-table",
  },
  target: {
    serviceId: "aws.ec2.route-table",
    portId: "aws.ec2.route-table.subnet-association",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 100,
  implementation: canonicalOwnedConfigurationOperation(
    "The association node must also target exactly one subnet in the same VPC.",
  ),
  validationRuleIds: networkRoutingValidationIds,
  title: "Route table subnet-association ownership",
  summary: "Owns one explicit subnet association from a route table.",
  guidedExplanation:
    "Associate every supported subnet explicitly. This keeps its selected route table visible instead of relying on an unseen main route table.",
  professionalExplanation:
    "Binds a route-table-association configuration to one owner slot; a separate exact edge identifies its one subnet target.",
  costConsideration:
    "Cost: Association is not directly priced, but the chosen table determines NAT, endpoint, internet, and cross-zone traffic paths.",
  operationsConsideration:
    "Operations: Replacement is reviewed atomically so a subnet never silently switches to a different route table.",
  documentation: routeTableDocumentation,
});

export const securityGroupOwnsIngressRule = networkingConnection({
  id: "aws.ec2.security-group-owns-ingress-rule",
  source: {
    serviceId: "aws.ec2.security-group-ingress-rule",
    portId: "aws.ec2.security-group-ingress-rule.security-group",
  },
  target: {
    serviceId: "aws.ec2.security-group",
    portId: "aws.ec2.security-group.ingress-rule",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 100,
  implementation: canonicalOwnedConfigurationOperation(
    "Ingress rules are associated policy configurations and never contain workloads.",
  ),
  validationRuleIds: securityGroupValidationIds,
  title: "Security group ingress-rule ownership",
  summary: "Associates one typed inbound traffic rule with a security group.",
  guidedExplanation:
    "Add only the inbound protocol, port range, and source the workload needs. The security group is a policy association, not a box that contains the workload.",
  professionalExplanation:
    "Binds one graph-backed ingress policy configuration to its security group with explicit lifecycle, bounded CIDR inputs, and deterministic rule validation.",
  costConsideration:
    "Cost: Security-group rules are not directly priced, but overly broad access can expose billable or sensitive workloads to unwanted traffic.",
  operationsConsideration:
    "Operations: Review rule changes independently and preserve user-owned rules when unrelated network associations are removed.",
  documentation: securityGroupDocumentation,
});

export const securityGroupOwnsEgressRule = networkingConnection({
  id: "aws.ec2.security-group-owns-egress-rule",
  source: {
    serviceId: "aws.ec2.security-group-egress-rule",
    portId: "aws.ec2.security-group-egress-rule.security-group",
  },
  target: {
    serviceId: "aws.ec2.security-group",
    portId: "aws.ec2.security-group.egress-rule",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 100,
  implementation: canonicalOwnedConfigurationOperation(
    "Egress rules are associated policy configurations and never contain workloads.",
  ),
  validationRuleIds: securityGroupValidationIds,
  title: "Security group egress-rule ownership",
  summary: "Associates one typed outbound traffic rule with a security group.",
  guidedExplanation:
    "Keep outbound access as narrow as the workload allows. Review protocol, port range, and destination under the security group's policy details.",
  professionalExplanation:
    "Binds one graph-backed egress policy configuration to its security group with explicit lifecycle and deterministic CIDR/protocol/port validation.",
  costConsideration:
    "Cost: Rules are not directly priced, but permitted outbound paths can use NAT gateways, cross-zone links, or paid external services.",
  operationsConsideration:
    "Operations: Default allow-all egress is not inferred; every supported egress rule remains an explicit reviewed configuration.",
  documentation: securityGroupDocumentation,
});

export const lambdaOwnsVpcAccessConfiguration = networkingConnection({
  id: "aws.lambda.owns-vpc-access-configuration",
  source: {
    serviceId: "aws.lambda.vpc-access-configuration",
    portId: "aws.lambda.vpc-access-configuration.function",
  },
  target: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.vpc-access",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 1,
  implementation: canonicalOwnedConfigurationOperation(
    "The configuration associates selected subnets and security groups without placing the Lambda service inside a VPC boundary.",
  ),
  validationRuleIds: lambdaVpcValidationIds,
  title: "Lambda VPC-access configuration ownership",
  summary:
    "Attaches one reviewed VPC-access configuration to a Lambda function.",
  guidedExplanation:
    "Configure VPC access on the function, then select its subnets and security groups. The function remains a managed Lambda service rather than becoming contained by the VPC.",
  professionalExplanation:
    "Binds at most one graph-backed VPC configuration to the Lambda owner slot; subnet and security-group associations remain separate exact edges.",
  costConsideration:
    "Cost: VPC access can route outbound traffic through NAT gateways and cross-zone paths; gateway endpoints may avoid NAT cost for S3 or DynamoDB.",
  operationsConsideration:
    "Operations: Multi-AZ subnet selection and same-VPC security groups are validated before stronger readiness is claimed.",
  documentation: lambdaVpcDocumentation,
});

export const gatewayEndpointOwnsPolicy = networkingConnection({
  id: "aws.ec2.gateway-endpoint-owns-policy",
  source: {
    serviceId: "aws.iam.policy-document",
    portId: "aws.iam.policy-document.gateway-endpoint-resource-policy",
  },
  target: {
    serviceId: "aws.ec2.gateway-vpc-endpoint",
    portId: "aws.ec2.gateway-vpc-endpoint.resource-policy",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 1,
  implementation: canonicalPolicyOperation(
    "The endpoint policy is optional, user-owned, and must remain a canonical resource policy rather than raw JSON.",
  ),
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.iam-policy-safety",
    "aws.cloudmarkup.validation.network-routing",
  ],
  title: "Gateway endpoint resource-policy ownership",
  summary:
    "Associates one optional canonical resource policy with a gateway endpoint.",
  guidedExplanation:
    "Use an endpoint policy only when you need to narrow which S3 or DynamoDB actions and resources may use this endpoint. Review it like any other resource policy.",
  professionalExplanation:
    "Binds at most one user-owned canonical resource policy document to the endpoint; policy validation remains separate from route-table association.",
  costConsideration:
    "Cost: The policy is not priced, but it can constrain access to billable data operations; it cannot turn an unsupported endpoint service into a supported one.",
  operationsConsideration:
    "Operations: Policy changes use the canonical policy workflow and never accept pasted raw policy JSON or silently broaden access.",
  documentation: endpointPolicyDocumentation,
});

export const routeTableAssociationTargetsSubnet = networkingConnection({
  id: "aws.ec2.route-table-association-targets-subnet",
  source: {
    serviceId: "aws.ec2.route-table-association",
    portId: "aws.ec2.route-table-association.subnet",
  },
  target: {
    serviceId: "aws.ec2.subnet",
    portId: "aws.ec2.subnet.route-table-association",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 1,
  implementation: implemented("aws.ec2.resolve-route-table-association-subnet"),
  validationRuleIds: networkRoutingValidationIds,
  title: "Route table association subnet target",
  summary: "Targets one subnet from one explicit route-table association.",
  guidedExplanation:
    "Choose the one subnet controlled by this association. The route table owner and subnet target must belong to the same VPC.",
  professionalExplanation:
    "Adds the direct association-target edge only; node-owned configuration stores no duplicate subnet or route-table identifier.",
  costConsideration:
    "Cost: The edge is not priced, but it selects the route paths whose NAT, endpoint, and transfer costs apply to the subnet.",
  operationsConsideration:
    "Operations: Cardinality prevents two explicit route-table associations from targeting the same subnet in this supported mode.",
  documentation: routeTableDocumentation,
});

export const vpcAttachesInternetGateway = networkingConnection({
  id: "aws.ec2.vpc-attaches-internet-gateway",
  source: {
    serviceId: "aws.ec2.vpc",
    portId: "aws.ec2.vpc.internet-gateway-attachment",
  },
  target: {
    serviceId: "aws.ec2.internet-gateway",
    portId: "aws.ec2.internet-gateway.vpc-attachment",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 1,
  implementation: implemented(
    "aws.ec2.resolve-vpc-internet-gateway-attachment",
  ),
  validationRuleIds: networkRoutingValidationIds,
  title: "VPC internet-gateway attachment",
  summary: "Attaches one internet gateway to one VPC.",
  guidedExplanation:
    "Attach the internet gateway to the VPC before a public subnet route can use it. Attachment alone does not make any subnet public.",
  professionalExplanation:
    "Adds the exact VPC attachment edge with one-to-one cardinality; route-table validation separately proves public routing intent.",
  costConsideration:
    "Cost: Internet-gateway attachment is not priced by this relationship, but public transfer and connected services can incur charges.",
  operationsConsideration:
    "Operations: Removing the attachment cannot silently remove or rewrite route configurations that still reference the gateway.",
  documentation: internetGatewayDocumentation,
});

export const routeTargetsInternetGateway = networkingConnection({
  id: "aws.ec2.route-targets-internet-gateway",
  source: {
    serviceId: "aws.ec2.route",
    portId: "aws.ec2.route.internet-gateway-target",
  },
  target: {
    serviceId: "aws.ec2.internet-gateway",
    portId: "aws.ec2.internet-gateway.route-target",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 100,
  implementation: implemented("aws.ec2.resolve-route-internet-gateway-target"),
  validationRuleIds: networkRoutingValidationIds,
  title: "Route internet-gateway target",
  summary: "Targets an attached internet gateway from one route.",
  guidedExplanation:
    "Use this target for a public route only when the route table, subnet, gateway, and VPC all agree. A default route is visible and never inferred.",
  professionalExplanation:
    "Adds the direct route-target edge; destination CIDR remains on the route node and same-VPC attachment validation fails closed.",
  costConsideration:
    "Cost: Review public data transfer and exposure; an endpoint or private path may be safer or less expensive for service traffic.",
  operationsConsideration:
    "Operations: A route may choose exactly one supported target, and changing target type requires an explicit reviewed operation.",
  documentation: internetGatewayDocumentation,
});

export const routeTargetsNatGateway = networkingConnection({
  id: "aws.ec2.route-targets-nat-gateway",
  source: {
    serviceId: "aws.ec2.route",
    portId: "aws.ec2.route.nat-gateway-target",
  },
  target: {
    serviceId: "aws.ec2.nat-gateway",
    portId: "aws.ec2.nat-gateway.route-target",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 100,
  implementation: implemented("aws.ec2.resolve-route-nat-gateway-target"),
  validationRuleIds: networkRoutingValidationIds,
  title: "Route NAT-gateway target",
  summary:
    "Targets a supported zonal public NAT gateway from one private route.",
  guidedExplanation:
    "Use a NAT target when a private subnet needs outbound IPv4 access that a gateway endpoint cannot provide. Prefer a NAT in the same Availability Zone.",
  professionalExplanation:
    "Adds the direct route-target edge; validators enforce private routing intent, public NAT placement, same VPC, and cross-zone cost warnings.",
  costConsideration:
    "Cost: NAT hourly, processing, and cross-zone transfer charges can be significant; use S3 or DynamoDB gateway endpoints for eligible traffic.",
  operationsConsideration:
    "Operations: A route may choose exactly one supported target; regional NAT, private NAT, and IPv6 egress-only modes remain unsupported.",
  documentation: natGatewayDocumentation,
});

export const gatewayEndpointAssociatesRouteTable = networkingConnection({
  id: "aws.ec2.gateway-endpoint-associates-route-table",
  source: {
    serviceId: "aws.ec2.gateway-vpc-endpoint",
    portId: "aws.ec2.gateway-vpc-endpoint.route-table-association",
  },
  target: {
    serviceId: "aws.ec2.route-table",
    portId: "aws.ec2.route-table.gateway-endpoint-association",
  },
  maximumConnectionsPerSource: 100,
  maximumConnectionsPerTarget: 16,
  implementation: implemented(
    "aws.ec2.resolve-gateway-endpoint-route-table-association",
  ),
  validationRuleIds: networkRoutingValidationIds,
  title: "Gateway endpoint route-table association",
  summary: "Associates an S3 or DynamoDB gateway endpoint with a route table.",
  guidedExplanation:
    "Choose every route table whose subnets should use this gateway endpoint. The managed service stays outside the VPC while eligible traffic uses the endpoint route.",
  professionalExplanation:
    "Adds one exact endpoint-to-route-table association edge; endpoint service identity and same-VPC ancestry remain node and validation facts.",
  costConsideration:
    "Cost: Gateway endpoints can reduce NAT processing for supported S3 or DynamoDB traffic; unrelated traffic still needs its own route.",
  operationsConsideration:
    "Operations: Association updates preserve exact route-table selection and never mutate the endpoint policy or managed service resources.",
  documentation: gatewayEndpointDocumentation,
});

export const vpcAssociatesSecurityGroup = networkingConnection({
  id: "aws.ec2.vpc-associates-security-group",
  source: {
    serviceId: "aws.ec2.vpc",
    portId: "aws.ec2.vpc.security-group-association",
  },
  target: {
    serviceId: "aws.ec2.security-group",
    portId: "aws.ec2.security-group.vpc",
  },
  maximumConnectionsPerSource: 100,
  maximumConnectionsPerTarget: 1,
  implementation: implemented("aws.ec2.resolve-vpc-security-group-association"),
  validationRuleIds: securityGroupValidationIds,
  title: "VPC security-group association",
  summary: "Scopes one security group to exactly one VPC.",
  guidedExplanation:
    "Associate the security group with the VPC where its selected network interfaces will live. Workloads use it as policy; they are never placed inside it.",
  professionalExplanation:
    "Adds the exact VPC scope edge with one-VPC-per-group cardinality and no containment semantics for associated workloads.",
  costConsideration:
    "Cost: The association is not directly priced, but allowed traffic can reach resources and network paths with separate charges.",
  operationsConsideration:
    "Operations: Rule ownership and Lambda association remain separate facts so VPC scope changes cannot silently rewrite policy.",
  documentation: securityGroupDocumentation,
});

export const lambdaVpcAccessUsesSubnet = networkingConnection({
  id: "aws.lambda.vpc-access-uses-subnet",
  source: {
    serviceId: "aws.lambda.vpc-access-configuration",
    portId: "aws.lambda.vpc-access-configuration.subnet",
  },
  target: {
    serviceId: "aws.ec2.subnet",
    portId: "aws.ec2.subnet.lambda-vpc-access",
  },
  maximumConnectionsPerSource: 16,
  maximumConnectionsPerTarget: 100,
  implementation: implemented("aws.lambda.resolve-vpc-access-subnet"),
  validationRuleIds: lambdaVpcValidationIds,
  title: "Lambda VPC-access subnet association",
  summary: "Selects one subnet for a Lambda VPC-access configuration.",
  guidedExplanation:
    "Select private subnets in more than one Availability Zone when the workload needs resilient VPC access. Internet access still depends on their routes.",
  professionalExplanation:
    "Adds the exact configuration-to-subnet association; validators enforce same-VPC selection, subnet access posture, and multi-AZ recommendations.",
  costConsideration:
    "Cost: Subnet routes can introduce NAT and cross-zone charges; use same-zone paths and gateway endpoints when appropriate.",
  operationsConsideration:
    "Operations: Changing the selected subnet set is an association update and never reparents or contains the managed Lambda function.",
  documentation: lambdaVpcDocumentation,
});

export const lambdaVpcAccessUsesSecurityGroup = networkingConnection({
  id: "aws.lambda.vpc-access-uses-security-group",
  source: {
    serviceId: "aws.lambda.vpc-access-configuration",
    portId: "aws.lambda.vpc-access-configuration.security-group",
  },
  target: {
    serviceId: "aws.ec2.security-group",
    portId: "aws.ec2.security-group.lambda-vpc-access",
  },
  maximumConnectionsPerSource: 5,
  maximumConnectionsPerTarget: 100,
  implementation: implemented("aws.lambda.resolve-vpc-access-security-group"),
  validationRuleIds: lambdaVpcValidationIds,
  title: "Lambda VPC-access security-group association",
  summary: "Selects one security group for a Lambda VPC-access configuration.",
  guidedExplanation:
    "Choose security groups that allow only the traffic this function needs. The groups remain associated policies scoped to the same VPC as the selected subnets.",
  professionalExplanation:
    "Adds the exact configuration-to-security-group association; same-VPC and rule-policy checks remain deterministic validation facts.",
  costConsideration:
    "Cost: Security-group association is not directly priced, but its permitted paths can use NAT, endpoint, cross-zone, or external services.",
  operationsConsideration:
    "Operations: Updating selected groups never reparents the function or copies ingress and egress rules into Lambda configuration.",
  documentation: lambdaVpcDocumentation,
});

export const awsNetworkingConnectionRulesV1 = [
  regionContainsVpc,
  vpcContainsAvailabilityZone,
  availabilityZoneContainsSubnet,
  vpcContainsRouteTable,
  subnetContainsNatGateway,
  vpcContainsGatewayEndpoint,
  routeTableOwnsRoute,
  routeTableOwnsSubnetAssociation,
  securityGroupOwnsIngressRule,
  securityGroupOwnsEgressRule,
  lambdaOwnsVpcAccessConfiguration,
  gatewayEndpointOwnsPolicy,
  routeTableAssociationTargetsSubnet,
  vpcAttachesInternetGateway,
  routeTargetsInternetGateway,
  routeTargetsNatGateway,
  gatewayEndpointAssociatesRouteTable,
  vpcAssociatesSecurityGroup,
  lambdaVpcAccessUsesSubnet,
  lambdaVpcAccessUsesSecurityGroup,
];
