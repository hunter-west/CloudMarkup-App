import type {
  ProviderConnectionRelationshipLabelV1Input,
  ProviderServiceConnectionPresentationV1Input,
} from "@cloudmarkup/provider-sdk";

type PresentationDock =
  ProviderServiceConnectionPresentationV1Input["docks"][number];

function dock(definition: PresentationDock): PresentationDock {
  return definition;
}

/**
 * Additive Prompt 41 presentations. The catalog assembler spreads these beside
 * the established service presentations so every semantic port remains visible
 * exactly once without putting deployment meaning in editor-only dock IDs.
 */
export const awsNetworkingServiceConnectionPresentationsV1: ProviderServiceConnectionPresentationV1Input[] =
  [
    {
      serviceId: "aws.region.boundary",
      docks: [
        dock({
          id: "aws.region.boundary.dock.vpc-placement",
          category: "networking",
          label: "VPCs",
          description: "VPC boundaries placed in this AWS Region.",
          placement: "right",
          order: 0,
          directionPolicy: "output-only",
          portIds: ["aws.region.boundary.vpc-placement"],
          cardinality: {
            minimum: 0,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "Add the VPCs that belong in this Region. Region placement does not discover or contact an AWS account.",
          professionalExplanation:
            "Groups exact Region-to-VPC containment edges; the Region value remains a modeled placement fact rather than live provider state.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.vpc",
      docks: [
        dock({
          id: "aws.ec2.vpc.dock.region",
          category: "networking",
          label: "Region",
          description: "The one Region boundary containing this VPC.",
          placement: "left",
          order: 0,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.vpc.region"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Place this VPC in one Region before adding its zones and subnets.",
          professionalExplanation:
            "Requires one exact Region containment edge and preserves stable graph identity independently of canvas layout.",
        }),
        dock({
          id: "aws.ec2.vpc.dock.placement",
          category: "networking",
          label: "Network resources",
          description:
            "Availability Zones, route tables, and gateway endpoints placed in this VPC.",
          placement: "right",
          order: 0,
          directionPolicy: "output-only",
          portIds: [
            "aws.ec2.vpc.availability-zone-placement",
            "aws.ec2.vpc.route-table-placement",
            "aws.ec2.vpc.gateway-endpoint-placement",
          ],
          cardinality: {
            minimum: 0,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "Build the VPC from visible zones, route tables, and optional S3 or DynamoDB endpoints.",
          professionalExplanation:
            "Aggregates three exact containment capabilities while retaining their separate relationship types and validations.",
        }),
        dock({
          id: "aws.ec2.vpc.dock.associations",
          category: "networking",
          label: "Associations",
          description:
            "The optional internet gateway and security-group policies associated with this VPC.",
          placement: "right",
          order: 1,
          directionPolicy: "output-only",
          portIds: [
            "aws.ec2.vpc.internet-gateway-attachment",
            "aws.ec2.vpc.security-group-association",
          ],
          cardinality: {
            minimum: 0,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Attach at most one internet gateway and associate the security groups used by resources in this VPC.",
          professionalExplanation:
            "Combines one exclusive gateway attachment with repeatable policy associations without treating security groups as containers.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.availability-zone",
      docks: [
        dock({
          id: "aws.ec2.availability-zone.dock.vpc",
          category: "networking",
          label: "VPC",
          description:
            "The one VPC boundary containing this Availability Zone.",
          placement: "left",
          order: 0,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.availability-zone.vpc"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Place this zone inside the VPC whose subnets it will organize.",
          professionalExplanation:
            "Requires one exact VPC containment edge; the catalog records a zone name without account discovery.",
        }),
        dock({
          id: "aws.ec2.availability-zone.dock.subnets",
          category: "networking",
          label: "Subnets",
          description: "Subnets placed in this one Availability Zone.",
          placement: "right",
          order: 0,
          directionPolicy: "output-only",
          portIds: ["aws.ec2.availability-zone.subnet-placement"],
          cardinality: {
            minimum: 0,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "Add public or private subnets for this zone, then configure their explicit routing.",
          professionalExplanation:
            "Represents exact AZ-to-subnet placement; access tier remains a subnet fact validated against routes.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.subnet",
      docks: [
        dock({
          id: "aws.ec2.subnet.dock.availability-zone",
          category: "networking",
          label: "Availability Zone",
          description: "The one Availability Zone containing this subnet.",
          placement: "left",
          order: 0,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.subnet.availability-zone"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation: "Choose the one zone where this subnet belongs.",
          professionalExplanation:
            "Enforces a single exact AZ placement independently from the subnet's public or private access-tier label.",
        }),
        dock({
          id: "aws.ec2.subnet.dock.route-table",
          category: "networking",
          label: "Route table",
          description:
            "The one explicit route-table association for this subnet.",
          placement: "left",
          order: 1,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.subnet.route-table-association"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Associate one visible route table. Implicit main-table routing is outside this bounded model.",
          professionalExplanation:
            "Requires one explicit association node, enabling deterministic route evaluation and stale-relationship checks.",
        }),
        dock({
          id: "aws.ec2.subnet.dock.lambda-vpc-access",
          category: "networking",
          label: "Lambda access",
          description:
            "Lambda VPC-access configurations selecting this subnet.",
          placement: "left",
          order: 2,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.subnet.lambda-vpc-access"],
          cardinality: {
            minimum: 0,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "See which Lambda functions select this subnet without placing the Lambda service inside the VPC.",
          professionalExplanation:
            "Shows repeatable configuration associations; same-VPC and multi-AZ recommendations remain validation-owned.",
        }),
        dock({
          id: "aws.ec2.subnet.dock.nat-gateways",
          category: "networking",
          label: "NAT gateways",
          description: "Zonal public NAT gateways placed in this subnet.",
          placement: "right",
          order: 0,
          directionPolicy: "output-only",
          portIds: ["aws.ec2.subnet.nat-gateway-placement"],
          cardinality: {
            minimum: 0,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Place a zonal public NAT gateway in a public subnet only when private subnets need outbound internet access.",
          professionalExplanation:
            "Models zonal public NAT placement only; regional and private NAT modes remain explicitly unsupported.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.route-table",
      docks: [
        dock({
          id: "aws.ec2.route-table.dock.vpc",
          category: "networking",
          label: "VPC",
          description: "The VPC that owns this route table.",
          placement: "left",
          order: 0,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.route-table.vpc"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Place this route table in the VPC whose subnet traffic it controls.",
          professionalExplanation:
            "Requires one exact VPC ownership edge before routes or associations are evaluated.",
        }),
        dock({
          id: "aws.ec2.route-table.dock.routes",
          category: "networking",
          label: "Routes",
          description: "Typed routes owned by this route table.",
          placement: "left",
          order: 1,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.route-table.route"],
          cardinality: {
            minimum: 0,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "Add destinations and choose an internet gateway or NAT gateway target for each supported route.",
          professionalExplanation:
            "Exposes graph-backed route configurations; destination facts live on route nodes and targets remain exact edges.",
        }),
        dock({
          id: "aws.ec2.route-table.dock.associations",
          category: "networking",
          label: "Associations",
          description:
            "Subnet associations and gateway endpoints using this route table.",
          placement: "left",
          order: 2,
          directionPolicy: "input-only",
          portIds: [
            "aws.ec2.route-table.subnet-association",
            "aws.ec2.route-table.gateway-endpoint-association",
          ],
          cardinality: {
            minimum: 0,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "Review which subnets use this table and which S3 or DynamoDB endpoints add routes to it.",
          professionalExplanation:
            "Combines explicit subnet-association ownership and endpoint association while preserving distinct relationship types.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.route",
      docks: [
        dock({
          id: "aws.ec2.route.dock.route-table",
          category: "networking",
          label: "Route table",
          description: "The one route table that owns this route.",
          placement: "right",
          order: 0,
          directionPolicy: "output-only",
          portIds: ["aws.ec2.route.route-table"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Keep this destination with the one route table that owns it.",
          professionalExplanation:
            "Binds the configuration node to exactly one owner slot with explicit lifecycle provenance.",
        }),
        dock({
          id: "aws.ec2.route.dock.target",
          category: "networking",
          label: "Target",
          description: "The one supported internet or NAT gateway target.",
          placement: "right",
          order: 1,
          directionPolicy: "output-only",
          portIds: [
            "aws.ec2.route.internet-gateway-target",
            "aws.ec2.route.nat-gateway-target",
          ],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Choose either an internet gateway for public routing or a NAT gateway for supported private outbound routing.",
          professionalExplanation:
            "Groups two mutually exclusive target capabilities; validation requires exactly one target edge for each route.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.route-table-association",
      docks: [
        dock({
          id: "aws.ec2.route-table-association.dock.bindings",
          category: "networking",
          label: "Route table & subnet",
          description:
            "The route table owner and exact subnet selected by this association.",
          placement: "right",
          order: 0,
          directionPolicy: "output-only",
          portIds: [
            "aws.ec2.route-table-association.route-table",
            "aws.ec2.route-table-association.subnet",
          ],
          cardinality: {
            minimum: 1,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Connect this association to one route table and one subnet in the same VPC.",
          professionalExplanation:
            "Two individually exclusive ports form one reviewed association; validation rejects missing or cross-VPC endpoints.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.internet-gateway",
      docks: [
        dock({
          id: "aws.ec2.internet-gateway.dock.vpc",
          category: "networking",
          label: "VPC",
          description: "The one VPC attached to this internet gateway.",
          placement: "left",
          order: 0,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.internet-gateway.vpc-attachment"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Attach this internet gateway to one VPC before using it in public routes.",
          professionalExplanation:
            "Represents one exact VPC attachment; attaching the gateway alone never makes a subnet public.",
        }),
        dock({
          id: "aws.ec2.internet-gateway.dock.routes",
          category: "networking",
          label: "Routes",
          description: "Public routes that target this internet gateway.",
          placement: "left",
          order: 1,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.internet-gateway.route-target"],
          cardinality: {
            minimum: 0,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "Review the route tables that send supported public traffic through this gateway.",
          professionalExplanation:
            "Accepts repeatable exact route targets; public-subnet classification also requires route and addressing checks.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.nat-gateway",
      docks: [
        dock({
          id: "aws.ec2.nat-gateway.dock.subnet",
          category: "networking",
          label: "Public subnet",
          description: "The public subnet containing this zonal NAT gateway.",
          placement: "left",
          order: 0,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.nat-gateway.subnet"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Place this public NAT gateway in one public subnet, ideally one per Availability Zone that needs resilient egress.",
          professionalExplanation:
            "Models one zonal public-subnet placement; regional and private NAT gateway modes remain unsupported.",
        }),
        dock({
          id: "aws.ec2.nat-gateway.dock.routes",
          category: "networking",
          label: "Private routes",
          description: "Private-subnet routes that use this NAT gateway.",
          placement: "left",
          order: 1,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.nat-gateway.route-target"],
          cardinality: {
            minimum: 0,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "Connect only private routes that need outbound internet access; prefer gateway endpoints for supported S3 or DynamoDB paths.",
          professionalExplanation:
            "Accepts repeatable exact route targets; same-zone design is recommended to reduce cross-zone dependency and transfer cost.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.gateway-vpc-endpoint",
      docks: [
        dock({
          id: "aws.ec2.gateway-vpc-endpoint.dock.vpc",
          category: "networking",
          label: "VPC",
          description:
            "The VPC containing this S3 or DynamoDB gateway endpoint.",
          placement: "left",
          order: 0,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.gateway-vpc-endpoint.vpc"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Place the endpoint in one VPC while keeping S3 or DynamoDB outside the customer VPC boundary.",
          professionalExplanation:
            "Requires one exact VPC containment edge; the managed target service remains ambient and is selected by configuration.",
        }),
        dock({
          id: "aws.ec2.gateway-vpc-endpoint.dock.policy",
          category: "identity",
          label: "Endpoint policy",
          description:
            "The optional canonical resource policy owned by this endpoint.",
          placement: "left",
          order: 1,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.gateway-vpc-endpoint.resource-policy"],
          cardinality: {
            minimum: 0,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Add a reviewed endpoint policy only when you need to narrow access beyond the service's default endpoint behavior.",
          professionalExplanation:
            "Accepts at most one user-owned canonical resource-policy document; raw JSON policy state is not modeled.",
        }),
        dock({
          id: "aws.ec2.gateway-vpc-endpoint.dock.route-tables",
          category: "networking",
          label: "Route tables",
          description: "Route tables associated with this gateway endpoint.",
          placement: "right",
          order: 0,
          directionPolicy: "output-only",
          portIds: ["aws.ec2.gateway-vpc-endpoint.route-table-association"],
          cardinality: {
            minimum: 1,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "Choose the route tables whose subnets should reach S3 or DynamoDB without a NAT gateway path.",
          professionalExplanation:
            "Requires one or more exact route-table associations; generated provider-managed prefix-list routes remain provenance-aware.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.security-group",
      docks: [
        dock({
          id: "aws.ec2.security-group.dock.vpc",
          category: "networking",
          label: "VPC",
          description:
            "The VPC with which this security-group policy is associated.",
          placement: "left",
          order: 0,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.security-group.vpc"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Associate this security group with one VPC. It controls traffic but does not contain workloads.",
          professionalExplanation:
            "Requires one exact VPC association and preserves security-group semantics as policy rather than placement.",
        }),
        dock({
          id: "aws.ec2.security-group.dock.lambda-vpc-access",
          category: "networking",
          label: "Lambda access",
          description:
            "Lambda VPC-access configurations selecting this policy.",
          placement: "left",
          order: 1,
          directionPolicy: "input-only",
          portIds: ["aws.ec2.security-group.lambda-vpc-access"],
          cardinality: {
            minimum: 0,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "See which Lambda VPC-access configurations use this security group.",
          professionalExplanation:
            "Shows repeatable same-VPC policy associations without implying managed-service containment.",
        }),
        dock({
          id: "aws.ec2.security-group.dock.rules",
          category: "networking",
          label: "Traffic rules",
          description:
            "Typed ingress and egress rules owned by this security group.",
          placement: "left",
          order: 2,
          directionPolicy: "input-only",
          portIds: [
            "aws.ec2.security-group.ingress-rule",
            "aws.ec2.security-group.egress-rule",
          ],
          cardinality: {
            minimum: 0,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "Add only the inbound and outbound protocols, ports, and CIDR ranges the workload needs.",
          professionalExplanation:
            "Aggregates graph-backed ingress and egress policy configurations while retaining exact direction and lifecycle provenance.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.security-group-ingress-rule",
      docks: [
        dock({
          id: "aws.ec2.security-group-ingress-rule.dock.security-group",
          category: "networking",
          label: "Security group",
          description: "The one security group that owns this ingress rule.",
          placement: "right",
          order: 0,
          directionPolicy: "output-only",
          portIds: ["aws.ec2.security-group-ingress-rule.security-group"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Keep this inbound rule with the one security group whose traffic it controls.",
          professionalExplanation:
            "Binds one typed ingress configuration to exactly one security-group owner slot.",
        }),
      ],
    },
    {
      serviceId: "aws.ec2.security-group-egress-rule",
      docks: [
        dock({
          id: "aws.ec2.security-group-egress-rule.dock.security-group",
          category: "networking",
          label: "Security group",
          description: "The one security group that owns this egress rule.",
          placement: "right",
          order: 0,
          directionPolicy: "output-only",
          portIds: ["aws.ec2.security-group-egress-rule.security-group"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Keep this outbound rule with the one security group whose traffic it controls.",
          professionalExplanation:
            "Binds one typed egress configuration to exactly one security-group owner slot.",
        }),
      ],
    },
    {
      serviceId: "aws.lambda.vpc-access-configuration",
      docks: [
        dock({
          id: "aws.lambda.vpc-access-configuration.dock.function",
          category: "networking",
          label: "Lambda function",
          description:
            "The one Lambda function that owns this VPC-access configuration.",
          placement: "right",
          order: 0,
          directionPolicy: "output-only",
          portIds: ["aws.lambda.vpc-access-configuration.function"],
          cardinality: {
            minimum: 1,
            maximum: 1,
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: false,
          containsExclusiveRelationships: true,
          guidedExplanation:
            "Attach these network selections to one Lambda function without moving the managed Lambda service inside the VPC.",
          professionalExplanation:
            "Binds one graph-backed association configuration to one Lambda owner slot with no false containment.",
        }),
        dock({
          id: "aws.lambda.vpc-access-configuration.dock.network-selections",
          category: "networking",
          label: "Subnets & security groups",
          description:
            "The subnets and security groups selected for Lambda VPC access.",
          placement: "right",
          order: 1,
          directionPolicy: "output-only",
          portIds: [
            "aws.lambda.vpc-access-configuration.subnet",
            "aws.lambda.vpc-access-configuration.security-group",
          ],
          cardinality: {
            minimum: 1,
            maximum: "many",
            enforcement: "provider-rule",
          },
          allowsMultipleEdges: true,
          containsExclusiveRelationships: false,
          guidedExplanation:
            "Select subnets in at least two Availability Zones when resilience needs it, plus only the security groups the function requires.",
          professionalExplanation:
            "Groups repeatable exact selection edges; deterministic validation requires same-VPC endpoints and at least one subnet and security group.",
        }),
      ],
    },
  ];

export const awsNetworkingRelationshipLabelsV1: ProviderConnectionRelationshipLabelV1Input[] =
  [
    { ruleId: "aws.region.contains-vpc", label: "Contains VPC" },
    {
      ruleId: "aws.ec2.vpc-contains-availability-zone",
      label: "Contains zone",
    },
    {
      ruleId: "aws.ec2.availability-zone-contains-subnet",
      label: "Contains subnet",
    },
    {
      ruleId: "aws.ec2.vpc-contains-route-table",
      label: "Contains route table",
    },
    {
      ruleId: "aws.ec2.subnet-contains-nat-gateway",
      label: "Contains NAT gateway",
    },
    {
      ruleId: "aws.ec2.vpc-contains-gateway-endpoint",
      label: "Contains endpoint",
    },
    {
      ruleId: "aws.ec2.route-table-owns-route",
      label: "Owns route",
    },
    {
      ruleId: "aws.ec2.route-table-owns-subnet-association",
      label: "Owns association",
    },
    {
      ruleId: "aws.ec2.security-group-owns-ingress-rule",
      label: "Owns ingress rule",
    },
    {
      ruleId: "aws.ec2.security-group-owns-egress-rule",
      label: "Owns egress rule",
    },
    {
      ruleId: "aws.lambda.owns-vpc-access-configuration",
      label: "Uses VPC access",
    },
    {
      ruleId: "aws.ec2.gateway-endpoint-owns-policy",
      label: "Uses endpoint policy",
    },
    {
      ruleId: "aws.ec2.route-table-association-targets-subnet",
      label: "Associates subnet",
    },
    {
      ruleId: "aws.ec2.vpc-attaches-internet-gateway",
      label: "Attaches gateway",
    },
    {
      ruleId: "aws.ec2.route-targets-internet-gateway",
      label: "Routes to internet",
    },
    {
      ruleId: "aws.ec2.route-targets-nat-gateway",
      label: "Routes through NAT",
    },
    {
      ruleId: "aws.ec2.gateway-endpoint-associates-route-table",
      label: "Adds endpoint route",
    },
    {
      ruleId: "aws.ec2.vpc-associates-security-group",
      label: "Associates policy",
    },
    {
      ruleId: "aws.lambda.vpc-access-uses-subnet",
      label: "Uses subnet",
    },
    {
      ruleId: "aws.lambda.vpc-access-uses-security-group",
      label: "Uses security group",
    },
  ];
