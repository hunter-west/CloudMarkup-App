import type {
  ProviderOwnedConfigurationSlotV1Input,
  ProviderServiceExtensionDefinitionV1Input,
  ProviderTargetReadinessV1,
} from "@cloudmarkup/provider-sdk";

function networkingServiceReadiness(
  serviceName: string,
  terraformTarget: "supported" | "not-applicable" = "supported",
): ProviderTargetReadinessV1 {
  const ambient = terraformTarget === "not-applicable";
  return {
    modeling: {
      status: "supported",
      reason: `${serviceName} has a reviewed typed graph service, exact semantic ports, and stable placement or association meaning.`,
    },
    configuration: {
      status: "supported",
      reason: `${serviceName} has a strict versioned configuration schema with reviewed defaults and field metadata.`,
    },
    validation: {
      status: "supported",
      reason: `${serviceName} participates in deterministic networking, routing, policy, or Lambda VPC-access validation as applicable.`,
    },
    terraform: {
      status: terraformTarget,
      reason: ambient
        ? `${serviceName} is ambient placement context rather than a Terraform-managed resource in this bounded catalog.`
        : `${serviceName} has an exact catalog mapping and deterministic reviewed Terraform renderer with negative, parse, golden, and reproducibility evidence.`,
    },
    cloudformation: {
      status: ambient ? "not-applicable" : "supported",
      reason: ambient
        ? `${serviceName} is ambient placement context rather than a CloudFormation-managed resource in this bounded catalog.`
        : `${serviceName} has an exact catalog mapping and deterministic reviewed CloudFormation renderer with semantic, negative, and reproducibility evidence.`,
    },
    generatedCode: {
      status: "not-applicable",
      reason: `${serviceName} is infrastructure or an infrastructure association and does not itself generate application source code.`,
    },
  };
}

function networkingSlotReadiness(slotName: string): ProviderTargetReadinessV1 {
  return {
    modeling: {
      status: "supported",
      reason: `${slotName} is modeled as one exact graph-backed owned configuration kind.`,
    },
    configuration: {
      status: "supported",
      reason: `${slotName} uses strict typed node configuration rather than raw provider state or arbitrary JSON.`,
    },
    validation: {
      status: "supported",
      reason: `${slotName} is covered by deterministic ownership, cardinality, placement, and policy validation as applicable.`,
    },
    terraform: {
      status: "supported",
      reason: `${slotName} has a graph-backed Terraform projection through the exact reviewed networking renderer.`,
    },
    cloudformation: {
      status: "supported",
      reason: `${slotName} has a graph-backed CloudFormation projection through the exact reviewed networking renderer.`,
    },
    generatedCode: {
      status: "not-applicable",
      reason: `${slotName} changes infrastructure configuration and never generates application source code.`,
    },
  };
}

function lambdaVpcAccessServiceReadiness(): ProviderTargetReadinessV1 {
  const readiness = networkingServiceReadiness(
    "Lambda VPC-access configuration",
  );
  return {
    ...readiness,
    terraform: {
      status: "supported",
      reason:
        "Lambda VPC-access configuration uses the reviewed owner-nested-block projection to render deterministic subnet and security-group references on the Lambda function; it deliberately has no standalone resource.",
    },
    cloudformation: {
      status: "supported",
      reason:
        "Lambda VPC-access configuration projects sorted graph associations into AWS::Lambda::Function.VpcConfig and deliberately has no false standalone resource.",
    },
  };
}

function lambdaVpcAccessSlotReadiness(): ProviderTargetReadinessV1 {
  const readiness = networkingSlotReadiness("Lambda VPC-access configuration");
  return {
    ...readiness,
    terraform: {
      status: "supported",
      reason:
        "The Lambda VPC-access slot projects sorted graph associations into the owning function's nested vpc_config block and never creates a false standalone resource.",
    },
    cloudformation: {
      status: "supported",
      reason:
        "The Lambda VPC-access slot projects sorted subnet and security-group references into AWS::Lambda::Function.VpcConfig and deliberately has no standalone resource.",
    },
  };
}

function subnetServiceReadiness(): ProviderTargetReadinessV1 {
  return {
    ...networkingServiceReadiness("VPC subnet"),
    cloudformation: {
      status: "supported",
      reason:
        "VPC subnet CloudFormation rendering deterministically resolves VpcId through the subnet's required Availability Zone and exact VPC ancestor.",
    },
  };
}

function securityGroupServiceReadiness(): ProviderTargetReadinessV1 {
  return networkingServiceReadiness("VPC security group");
}

function securityGroupEgressServiceReadiness(): ProviderTargetReadinessV1 {
  return {
    ...networkingServiceReadiness("Security-group egress rule"),
    cloudformation: {
      status: "supported",
      reason:
        "Security-group CloudFormation rendering explicitly suppresses default allow-all egress before emitting standalone narrow AWS::EC2::SecurityGroupEgress resources.",
    },
  };
}

function securityGroupEgressSlotReadiness(): ProviderTargetReadinessV1 {
  const readiness = networkingSlotReadiness("Security-group egress rules");
  return {
    ...readiness,
    cloudformation: {
      status: "supported" as const,
      reason:
        "Security-group egress configuration explicitly suppresses default allow-all egress before standalone narrow AWS::EC2::SecurityGroupEgress resources are emitted.",
    },
  };
}

export const awsRouteTableOwnedConfigurationSlotsV1: ProviderOwnedConfigurationSlotV1Input[] =
  [
    {
      id: "aws.ec2.route-table.slot.routes",
      slotVersion: "1.0.0",
      configurationKind: "aws.ec2.route-table.route",
      displayName: "Routes",
      description:
        "Typed destination routes owned by this route table, each with one reviewed gateway target.",
      graphBinding: {
        configurationServiceId: "aws.ec2.route",
        ownershipRelationshipType: "aws.ec2.route-table-owns-route",
      },
      cardinality: {
        minimum: 0,
        maximum: "many",
        enforcement: "provider-rule",
      },
      allowedOwnership: ["user", "generated"],
      generatedAdoption: "allowed",
      policyKinds: [],
      targetReadiness: networkingSlotReadiness("Route-table routes"),
      guidedExplanation:
        "Add routes here, then choose the one supported gateway target for each destination. Adopt any generated route before customizing it.",
      professionalExplanation:
        "Zero or more route configuration nodes bind to the owner through exact lifecycle provenance; generated routes require adoption before customization or independent deletion.",
    },
    {
      id: "aws.ec2.route-table.slot.subnet-associations",
      slotVersion: "1.0.0",
      configurationKind: "aws.ec2.route-table.subnet-association",
      displayName: "Subnet associations",
      description:
        "Explicit subnet associations owned by this route table, each selecting one subnet in the same VPC.",
      graphBinding: {
        configurationServiceId: "aws.ec2.route-table-association",
        ownershipRelationshipType:
          "aws.ec2.route-table-owns-subnet-association",
      },
      cardinality: {
        minimum: 0,
        maximum: "many",
        enforcement: "provider-rule",
      },
      allowedOwnership: ["user", "generated"],
      generatedAdoption: "allowed",
      policyKinds: [],
      targetReadiness: networkingSlotReadiness(
        "Route-table subnet associations",
      ),
      guidedExplanation:
        "Associate every supported subnet explicitly so people can see and review its routing instead of relying on an implicit main route table.",
      professionalExplanation:
        "Zero or more graph-backed association nodes each bind to one owner and one same-VPC subnet; generated provenance remains adoptable before customization.",
    },
  ];

export const awsSecurityGroupOwnedConfigurationSlotsV1: ProviderOwnedConfigurationSlotV1Input[] =
  [
    {
      id: "aws.ec2.security-group.slot.ingress-rules",
      slotVersion: "1.0.0",
      configurationKind: "aws.ec2.security-group.ingress-rule",
      displayName: "Ingress rules",
      description:
        "User-reviewed inbound protocol, port-range, and CIDR policy rules owned by this security group.",
      graphBinding: {
        configurationServiceId: "aws.ec2.security-group-ingress-rule",
        ownershipRelationshipType: "aws.ec2.security-group-owns-ingress-rule",
      },
      cardinality: {
        minimum: 0,
        maximum: "many",
        enforcement: "provider-rule",
      },
      allowedOwnership: ["user"],
      generatedAdoption: "not-applicable",
      policyKinds: [],
      targetReadiness: networkingSlotReadiness("Security-group ingress rules"),
      guidedExplanation:
        "Add only the inbound protocols, ports, and CIDR ranges the associated workload needs. Security groups are policies, not workload containers.",
      professionalExplanation:
        "Zero or more user-owned typed ingress configuration nodes retain explicit direction and are validated for bounded protocols, ports, and CIDR scope.",
    },
    {
      id: "aws.ec2.security-group.slot.egress-rules",
      slotVersion: "1.0.0",
      configurationKind: "aws.ec2.security-group.egress-rule",
      displayName: "Egress rules",
      description:
        "User-reviewed outbound protocol, port-range, and CIDR policy rules owned by this security group.",
      graphBinding: {
        configurationServiceId: "aws.ec2.security-group-egress-rule",
        ownershipRelationshipType: "aws.ec2.security-group-owns-egress-rule",
      },
      cardinality: {
        minimum: 0,
        maximum: "many",
        enforcement: "provider-rule",
      },
      allowedOwnership: ["user"],
      generatedAdoption: "not-applicable",
      policyKinds: [],
      targetReadiness: securityGroupEgressSlotReadiness(),
      guidedExplanation:
        "Add only the outbound protocols, ports, and CIDR ranges the workload needs; this catalog does not infer allow-all egress.",
      professionalExplanation:
        "Zero or more user-owned typed egress configuration nodes remain independently reviewable and retain exact lifecycle provenance.",
    },
  ];

export const awsGatewayVpcEndpointOwnedConfigurationSlotsV1: ProviderOwnedConfigurationSlotV1Input[] =
  [
    {
      id: "aws.ec2.gateway-vpc-endpoint.slot.resource-policy",
      slotVersion: "1.0.0",
      configurationKind: "aws.ec2.gateway-vpc-endpoint.resource-policy",
      displayName: "Endpoint policy",
      description:
        "The optional canonical resource policy that narrows use of this S3 or DynamoDB gateway endpoint.",
      graphBinding: {
        configurationServiceId: "aws.iam.policy-document",
        ownershipRelationshipType: "aws.ec2.gateway-endpoint-owns-policy",
      },
      cardinality: {
        minimum: 0,
        maximum: 1,
        enforcement: "provider-rule",
      },
      allowedOwnership: ["user"],
      generatedAdoption: "not-applicable",
      policyKinds: ["resource"],
      targetReadiness: networkingSlotReadiness(
        "Gateway VPC endpoint resource policy",
      ),
      guidedExplanation:
        "Add a reviewed endpoint policy only when you need to limit which S3 or DynamoDB actions, principals, or resources may use this endpoint.",
      professionalExplanation:
        "At most one user-owned canonical resource-policy document binds to the endpoint independently from its route-table associations; raw policy JSON is excluded.",
    },
  ];

/**
 * Add this slot to the established aws.lambda.function extension. It is kept
 * separate because this module contributes extensions for the fourteen new
 * service IDs and must not declare a duplicate Lambda service extension.
 */
export const awsLambdaVpcAccessOwnedConfigurationSlotsV1: ProviderOwnedConfigurationSlotV1Input[] =
  [
    {
      id: "aws.lambda.function.slot.vpc-access-configuration",
      slotVersion: "1.0.0",
      configurationKind: "aws.lambda.vpc-access-configuration",
      displayName: "VPC access",
      description:
        "The optional subnet and security-group association configuration owned by this Lambda function.",
      graphBinding: {
        configurationServiceId: "aws.lambda.vpc-access-configuration",
        ownershipRelationshipType: "aws.lambda.owns-vpc-access-configuration",
      },
      cardinality: {
        minimum: 0,
        maximum: 1,
        enforcement: "provider-rule",
      },
      allowedOwnership: ["user"],
      generatedAdoption: "not-applicable",
      policyKinds: [],
      targetReadiness: lambdaVpcAccessSlotReadiness(),
      guidedExplanation:
        "Select reviewed subnets and security groups here. Lambda remains a managed service outside the VPC rather than becoming contained by it.",
      professionalExplanation:
        "At most one user-owned graph configuration binds to the function; subnet and security-group selections remain separate same-VPC association edges.",
    },
  ];

/** Additive Prompt 41 service-extension entries for the fourteen new services. */
export const awsNetworkingServiceExtensionsV1: ProviderServiceExtensionDefinitionV1Input[] =
  [
    {
      serviceId: "aws.region.boundary",
      targetReadiness: networkingServiceReadiness(
        "AWS Region boundary",
        "not-applicable",
      ),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.ec2.vpc",
      targetReadiness: networkingServiceReadiness("Amazon VPC"),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.ec2.availability-zone",
      targetReadiness: networkingServiceReadiness(
        "Availability Zone boundary",
        "not-applicable",
      ),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.ec2.subnet",
      targetReadiness: subnetServiceReadiness(),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.ec2.route-table",
      targetReadiness: networkingServiceReadiness("VPC route table"),
      ownedConfigurationSlots: awsRouteTableOwnedConfigurationSlotsV1,
    },
    {
      serviceId: "aws.ec2.route",
      targetReadiness: networkingServiceReadiness("VPC route"),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.ec2.route-table-association",
      targetReadiness: networkingServiceReadiness(
        "Route-table subnet association",
      ),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.ec2.internet-gateway",
      targetReadiness: networkingServiceReadiness("Internet gateway"),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.ec2.nat-gateway",
      targetReadiness: networkingServiceReadiness("Zonal public NAT gateway"),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.ec2.gateway-vpc-endpoint",
      targetReadiness: networkingServiceReadiness("Gateway VPC endpoint"),
      ownedConfigurationSlots: awsGatewayVpcEndpointOwnedConfigurationSlotsV1,
    },
    {
      serviceId: "aws.ec2.security-group",
      targetReadiness: securityGroupServiceReadiness(),
      ownedConfigurationSlots: awsSecurityGroupOwnedConfigurationSlotsV1,
    },
    {
      serviceId: "aws.ec2.security-group-ingress-rule",
      targetReadiness: networkingServiceReadiness(
        "Security-group ingress rule",
      ),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.ec2.security-group-egress-rule",
      targetReadiness: securityGroupEgressServiceReadiness(),
      ownedConfigurationSlots: [],
    },
    {
      serviceId: "aws.lambda.vpc-access-configuration",
      targetReadiness: lambdaVpcAccessServiceReadiness(),
      ownedConfigurationSlots: [],
    },
  ];
