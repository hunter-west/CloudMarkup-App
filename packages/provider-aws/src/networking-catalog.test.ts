import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";
import {
  ProviderConnectionPresentationCompilationError,
  compileProviderCatalogV1,
  compileProviderConnectionPresentationV1,
  compileProviderServiceExtensionV1,
} from "@cloudmarkup/provider-sdk/compiler";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import { createAwsConnectionPresentationSourceV1 } from "./catalog/connection-presentation.js";
import { awsNetworkingConnectionRulesV1 } from "./catalog/connections/networking-connections.js";
import {
  awsGatewayVpcEndpointOwnedConfigurationSlotsV1,
  awsLambdaVpcAccessOwnedConfigurationSlotsV1,
  awsNetworkingServiceExtensionsV1,
  awsRouteTableOwnedConfigurationSlotsV1,
  awsSecurityGroupOwnedConfigurationSlotsV1,
} from "./catalog/networking-service-extension.js";
import { createAwsProviderServiceExtensionSourceV1 } from "./catalog/service-extension.js";
import { awsServicesV1 } from "./catalog/services/index.js";
import { awsCatalogSourceV1 } from "./catalog/source.js";

const networkingServiceIds = [
  "aws.region.boundary",
  "aws.ec2.vpc",
  "aws.ec2.availability-zone",
  "aws.ec2.subnet",
  "aws.ec2.route-table",
  "aws.ec2.route",
  "aws.ec2.route-table-association",
  "aws.ec2.internet-gateway",
  "aws.ec2.nat-gateway",
  "aws.ec2.gateway-vpc-endpoint",
  "aws.ec2.security-group",
  "aws.ec2.security-group-ingress-rule",
  "aws.ec2.security-group-egress-rule",
  "aws.lambda.vpc-access-configuration",
] as const;

type NetworkingServiceId = (typeof networkingServiceIds)[number];

const additionalExpectedNetworkPortIds: Record<string, readonly string[]> = {
  "aws.ec2.availability-zone": ["aws.ec2.availability-zone.ebs-volume"],
  "aws.ec2.vpc": ["aws.ec2.vpc.alb", "aws.ec2.vpc.alb-target-group"],
  "aws.ec2.subnet": ["aws.ec2.subnet.alb"],
  "aws.ec2.security-group": [
    "aws.ec2.security-group.alb",
    "aws.ec2.security-group.alb-access-source",
    "aws.ec2.security-group.alb-access-target",
  ],
};
const networkingServiceIdSet = new Set<string>(networkingServiceIds);

function requireService(serviceId: string) {
  const service = awsServicesV1.find((candidate) => candidate.id === serviceId);
  if (service === undefined) {
    throw new TypeError(`Missing networking service ${serviceId}.`);
  }
  return service;
}

function compilePresentation(
  source: Parameters<typeof compileProviderConnectionPresentationV1>[0],
  catalog: Parameters<typeof compileProviderConnectionPresentationV1>[1],
) {
  try {
    return compileProviderConnectionPresentationV1(source, catalog);
  } catch (error) {
    if (error instanceof ProviderConnectionPresentationCompilationError) {
      throw new TypeError(
        `Networking presentation contract failed: ${JSON.stringify(
          error.issues,
        )}`,
      );
    }
    throw error;
  }
}

function stringValue(value: string): ConfigurationValue {
  return { kind: "string", value };
}

function booleanValue(value: boolean): ConfigurationValue {
  return { kind: "boolean", value };
}

interface ExpectedPort {
  readonly id: string;
  readonly direction: "input" | "output";
  readonly cardinality: "one" | "many";
  readonly required: boolean;
}

const expectedPorts: Readonly<
  Record<NetworkingServiceId, readonly ExpectedPort[]>
> = {
  "aws.region.boundary": [
    {
      id: "aws.region.boundary.vpc-placement",
      direction: "output",
      cardinality: "many",
      required: false,
    },
  ],
  "aws.ec2.vpc": [
    {
      id: "aws.ec2.vpc.region",
      direction: "input",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.vpc.availability-zone-placement",
      direction: "output",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.vpc.route-table-placement",
      direction: "output",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.vpc.gateway-endpoint-placement",
      direction: "output",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.vpc.internet-gateway-attachment",
      direction: "output",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.ec2.vpc.security-group-association",
      direction: "output",
      cardinality: "many",
      required: false,
    },
  ],
  "aws.ec2.availability-zone": [
    {
      id: "aws.ec2.availability-zone.vpc",
      direction: "input",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.availability-zone.subnet-placement",
      direction: "output",
      cardinality: "many",
      required: false,
    },
  ],
  "aws.ec2.subnet": [
    {
      id: "aws.ec2.subnet.availability-zone",
      direction: "input",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.subnet.route-table-association",
      direction: "input",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.subnet.lambda-vpc-access",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.subnet.nat-gateway-placement",
      direction: "output",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.ec2.subnet.fsx",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.subnet.instance",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.subnet.ecs-service",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.subnet.rds-subnet-group",
      direction: "input",
      cardinality: "many",
      required: false,
    },
  ],
  "aws.ec2.route-table": [
    {
      id: "aws.ec2.route-table.vpc",
      direction: "input",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.route-table.route",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.route-table.subnet-association",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.route-table.gateway-endpoint-association",
      direction: "input",
      cardinality: "many",
      required: false,
    },
  ],
  "aws.ec2.route": [
    {
      id: "aws.ec2.route.route-table",
      direction: "output",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.route.internet-gateway-target",
      direction: "output",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.ec2.route.nat-gateway-target",
      direction: "output",
      cardinality: "one",
      required: false,
    },
  ],
  "aws.ec2.route-table-association": [
    {
      id: "aws.ec2.route-table-association.route-table",
      direction: "output",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.route-table-association.subnet",
      direction: "output",
      cardinality: "one",
      required: true,
    },
  ],
  "aws.ec2.internet-gateway": [
    {
      id: "aws.ec2.internet-gateway.vpc-attachment",
      direction: "input",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.internet-gateway.route-target",
      direction: "input",
      cardinality: "many",
      required: false,
    },
  ],
  "aws.ec2.nat-gateway": [
    {
      id: "aws.ec2.nat-gateway.subnet",
      direction: "input",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.nat-gateway.route-target",
      direction: "input",
      cardinality: "many",
      required: false,
    },
  ],
  "aws.ec2.gateway-vpc-endpoint": [
    {
      id: "aws.ec2.gateway-vpc-endpoint.vpc",
      direction: "input",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.gateway-vpc-endpoint.resource-policy",
      direction: "input",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.ec2.gateway-vpc-endpoint.route-table-association",
      direction: "output",
      cardinality: "many",
      required: true,
    },
  ],
  "aws.ec2.security-group": [
    {
      id: "aws.ec2.security-group.vpc",
      direction: "input",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.security-group.lambda-vpc-access",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.security-group.ingress-rule",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.security-group.egress-rule",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.security-group.fsx",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.security-group.instance",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.security-group.ecs-service",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.security-group.rds-instance",
      direction: "input",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.security-group.aurora-cluster",
      direction: "input",
      cardinality: "many",
      required: false,
    },
  ],
  "aws.ec2.security-group-ingress-rule": [
    {
      id: "aws.ec2.security-group-ingress-rule.security-group",
      direction: "output",
      cardinality: "one",
      required: true,
    },
  ],
  "aws.ec2.security-group-egress-rule": [
    {
      id: "aws.ec2.security-group-egress-rule.security-group",
      direction: "output",
      cardinality: "one",
      required: true,
    },
  ],
  "aws.lambda.vpc-access-configuration": [
    {
      id: "aws.lambda.vpc-access-configuration.function",
      direction: "output",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.lambda.vpc-access-configuration.subnet",
      direction: "output",
      cardinality: "many",
      required: true,
    },
    {
      id: "aws.lambda.vpc-access-configuration.security-group",
      direction: "output",
      cardinality: "many",
      required: true,
    },
  ],
};

const expectedConnectionEndpoints = {
  "aws.region.contains-vpc": [
    "aws.region.boundary",
    "aws.region.boundary.vpc-placement",
    "aws.ec2.vpc",
    "aws.ec2.vpc.region",
    100,
    1,
  ],
  "aws.ec2.vpc-contains-availability-zone": [
    "aws.ec2.vpc",
    "aws.ec2.vpc.availability-zone-placement",
    "aws.ec2.availability-zone",
    "aws.ec2.availability-zone.vpc",
    100,
    1,
  ],
  "aws.ec2.availability-zone-contains-subnet": [
    "aws.ec2.availability-zone",
    "aws.ec2.availability-zone.subnet-placement",
    "aws.ec2.subnet",
    "aws.ec2.subnet.availability-zone",
    100,
    1,
  ],
  "aws.ec2.vpc-contains-route-table": [
    "aws.ec2.vpc",
    "aws.ec2.vpc.route-table-placement",
    "aws.ec2.route-table",
    "aws.ec2.route-table.vpc",
    100,
    1,
  ],
  "aws.ec2.subnet-contains-nat-gateway": [
    "aws.ec2.subnet",
    "aws.ec2.subnet.nat-gateway-placement",
    "aws.ec2.nat-gateway",
    "aws.ec2.nat-gateway.subnet",
    1,
    1,
  ],
  "aws.ec2.vpc-contains-gateway-endpoint": [
    "aws.ec2.vpc",
    "aws.ec2.vpc.gateway-endpoint-placement",
    "aws.ec2.gateway-vpc-endpoint",
    "aws.ec2.gateway-vpc-endpoint.vpc",
    16,
    1,
  ],
  "aws.ec2.route-table-owns-route": [
    "aws.ec2.route",
    "aws.ec2.route.route-table",
    "aws.ec2.route-table",
    "aws.ec2.route-table.route",
    1,
    100,
  ],
  "aws.ec2.route-table-owns-subnet-association": [
    "aws.ec2.route-table-association",
    "aws.ec2.route-table-association.route-table",
    "aws.ec2.route-table",
    "aws.ec2.route-table.subnet-association",
    1,
    100,
  ],
  "aws.ec2.security-group-owns-ingress-rule": [
    "aws.ec2.security-group-ingress-rule",
    "aws.ec2.security-group-ingress-rule.security-group",
    "aws.ec2.security-group",
    "aws.ec2.security-group.ingress-rule",
    1,
    100,
  ],
  "aws.ec2.security-group-owns-egress-rule": [
    "aws.ec2.security-group-egress-rule",
    "aws.ec2.security-group-egress-rule.security-group",
    "aws.ec2.security-group",
    "aws.ec2.security-group.egress-rule",
    1,
    100,
  ],
  "aws.lambda.owns-vpc-access-configuration": [
    "aws.lambda.vpc-access-configuration",
    "aws.lambda.vpc-access-configuration.function",
    "aws.lambda.function",
    "aws.lambda.function.vpc-access",
    1,
    1,
  ],
  "aws.ec2.gateway-endpoint-owns-policy": [
    "aws.iam.policy-document",
    "aws.iam.policy-document.gateway-endpoint-resource-policy",
    "aws.ec2.gateway-vpc-endpoint",
    "aws.ec2.gateway-vpc-endpoint.resource-policy",
    1,
    1,
  ],
  "aws.ec2.route-table-association-targets-subnet": [
    "aws.ec2.route-table-association",
    "aws.ec2.route-table-association.subnet",
    "aws.ec2.subnet",
    "aws.ec2.subnet.route-table-association",
    1,
    1,
  ],
  "aws.ec2.vpc-attaches-internet-gateway": [
    "aws.ec2.vpc",
    "aws.ec2.vpc.internet-gateway-attachment",
    "aws.ec2.internet-gateway",
    "aws.ec2.internet-gateway.vpc-attachment",
    1,
    1,
  ],
  "aws.ec2.route-targets-internet-gateway": [
    "aws.ec2.route",
    "aws.ec2.route.internet-gateway-target",
    "aws.ec2.internet-gateway",
    "aws.ec2.internet-gateway.route-target",
    1,
    100,
  ],
  "aws.ec2.route-targets-nat-gateway": [
    "aws.ec2.route",
    "aws.ec2.route.nat-gateway-target",
    "aws.ec2.nat-gateway",
    "aws.ec2.nat-gateway.route-target",
    1,
    100,
  ],
  "aws.ec2.gateway-endpoint-associates-route-table": [
    "aws.ec2.gateway-vpc-endpoint",
    "aws.ec2.gateway-vpc-endpoint.route-table-association",
    "aws.ec2.route-table",
    "aws.ec2.route-table.gateway-endpoint-association",
    100,
    16,
  ],
  "aws.ec2.vpc-associates-security-group": [
    "aws.ec2.vpc",
    "aws.ec2.vpc.security-group-association",
    "aws.ec2.security-group",
    "aws.ec2.security-group.vpc",
    100,
    1,
  ],
  "aws.lambda.vpc-access-uses-subnet": [
    "aws.lambda.vpc-access-configuration",
    "aws.lambda.vpc-access-configuration.subnet",
    "aws.ec2.subnet",
    "aws.ec2.subnet.lambda-vpc-access",
    16,
    100,
  ],
  "aws.lambda.vpc-access-uses-security-group": [
    "aws.lambda.vpc-access-configuration",
    "aws.lambda.vpc-access-configuration.security-group",
    "aws.ec2.security-group",
    "aws.ec2.security-group.lambda-vpc-access",
    5,
    100,
  ],
} as const;

const implementedNetworkingRuleIds = [
  "aws.ec2.route-table-association-targets-subnet",
  "aws.ec2.vpc-attaches-internet-gateway",
  "aws.ec2.route-targets-internet-gateway",
  "aws.ec2.route-targets-nat-gateway",
  "aws.ec2.gateway-endpoint-associates-route-table",
  "aws.ec2.vpc-associates-security-group",
  "aws.lambda.vpc-access-uses-subnet",
  "aws.lambda.vpc-access-uses-security-group",
] as const;

describe("AWS networking catalog contracts", () => {
  it("defines the exact fourteen concepts with stable node, icon, and placement semantics", () => {
    expect(
      awsServicesV1
        .filter((service) => networkingServiceIdSet.has(service.id))
        .map((service) => service.id),
    ).toEqual(networkingServiceIds);

    const boundaryIcons = {
      "aws.region.boundary": "aws.cloudmarkup.icons.region",
      "aws.ec2.vpc": "aws.cloudmarkup.icons.vpc",
      "aws.ec2.availability-zone": "aws.cloudmarkup.icons.availability-zone",
      "aws.ec2.subnet": "aws.cloudmarkup.icons.subnet",
    } as const;
    for (const [serviceId, iconId] of Object.entries(boundaryIcons)) {
      expect(requireService(serviceId)).toMatchObject({
        id: serviceId,
        nodeKind: {
          kind: "boundary",
          boundaryType: serviceId,
          containmentModel: "provider-semantic",
        },
        iconId,
      });
    }

    const resourceSemantics = {
      "aws.ec2.route-table": [true, "aws.cloudmarkup.icons.route-table"],
      "aws.ec2.route": [false, null],
      "aws.ec2.route-table-association": [false, null],
      "aws.ec2.internet-gateway": [
        true,
        "aws.cloudmarkup.icons.internet-gateway",
      ],
      "aws.ec2.nat-gateway": [true, "aws.cloudmarkup.icons.nat-gateway"],
      "aws.ec2.gateway-vpc-endpoint": [
        true,
        "aws.cloudmarkup.icons.gateway-vpc-endpoint",
      ],
      "aws.ec2.security-group": [true, "aws.cloudmarkup.icons.security-group"],
      "aws.ec2.security-group-ingress-rule": [false, null],
      "aws.ec2.security-group-egress-rule": [false, null],
      "aws.lambda.vpc-access-configuration": [false, null],
    } as const;
    for (const [serviceId, [deployable, iconId]] of Object.entries(
      resourceSemantics,
    )) {
      expect(requireService(serviceId)).toMatchObject({
        id: serviceId,
        nodeKind: {
          kind: "resource",
          resourceType: serviceId,
          deployable,
        },
        iconId,
      });
    }

    const placements = {
      "aws.region.boundary": {
        rootPlacement: "required",
        allowedParentTypes: [],
        regionConstraint: "provider-defined",
      },
      "aws.ec2.vpc": {
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
      "aws.ec2.availability-zone": {
        rootPlacement: "forbidden",
        allowedParentTypes: [
          {
            serviceId: "aws.ec2.vpc",
            relationshipType: "aws.ec2.vpc-contains-availability-zone",
          },
        ],
        maximumDepth: 3,
        regionConstraint: "same-region",
      },
      "aws.ec2.subnet": {
        rootPlacement: "forbidden",
        allowedParentTypes: [
          {
            serviceId: "aws.ec2.availability-zone",
            relationshipType: "aws.ec2.availability-zone-contains-subnet",
          },
        ],
        maximumDepth: 4,
        regionConstraint: "same-region",
      },
      "aws.ec2.route-table": {
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
      "aws.ec2.route": {
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
      "aws.ec2.route-table-association": {
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
      "aws.ec2.internet-gateway": {
        rootPlacement: "allowed",
        allowedParentTypes: [],
        regionConstraint: "same-region",
      },
      "aws.ec2.nat-gateway": {
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
      "aws.ec2.gateway-vpc-endpoint": {
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
      "aws.ec2.security-group": {
        rootPlacement: "allowed",
        allowedParentTypes: [],
        regionConstraint: "same-region",
      },
      "aws.ec2.security-group-ingress-rule": {
        rootPlacement: "forbidden",
        allowedParentTypes: [
          {
            serviceId: "aws.ec2.security-group",
            relationshipType: "aws.ec2.security-group-owns-ingress-rule",
          },
        ],
        maximumDepth: 2,
        regionConstraint: "same-region",
      },
      "aws.ec2.security-group-egress-rule": {
        rootPlacement: "forbidden",
        allowedParentTypes: [
          {
            serviceId: "aws.ec2.security-group",
            relationshipType: "aws.ec2.security-group-owns-egress-rule",
          },
        ],
        maximumDepth: 2,
        regionConstraint: "same-region",
      },
      "aws.lambda.vpc-access-configuration": {
        rootPlacement: "forbidden",
        allowedParentTypes: [
          {
            serviceId: "aws.lambda.function",
            relationshipType: "aws.lambda.owns-vpc-access-configuration",
          },
        ],
        maximumDepth: 2,
        regionConstraint: "same-region",
      },
    } as const;
    for (const [serviceId, placement] of Object.entries(placements)) {
      expect(requireService(serviceId).placement).toEqual(placement);
    }
  });

  it("keeps strict schemas, reviewed defaults, and explicit unsupported modes", () => {
    const configurationContracts = {
      "aws.region.boundary": {
        properties: ["regionName"],
        defaults: {},
      },
      "aws.ec2.vpc": {
        properties: [
          "cidrBlock",
          "enableDnsSupport",
          "enableDnsHostnames",
          "instanceTenancy",
        ],
        defaults: {
          cidrBlock: "10.0.0.0/16",
          enableDnsSupport: true,
          enableDnsHostnames: true,
          instanceTenancy: "default",
        },
      },
      "aws.ec2.availability-zone": {
        properties: ["zoneName"],
        defaults: {},
      },
      "aws.ec2.subnet": {
        properties: [
          "cidrBlock",
          "accessTier",
          "mapPublicIpOnLaunch",
          "assignIpv6AddressOnCreation",
        ],
        defaults: {
          cidrBlock: "10.0.1.0/24",
          accessTier: "private",
          mapPublicIpOnLaunch: false,
          assignIpv6AddressOnCreation: false,
        },
      },
      "aws.ec2.route-table": {
        properties: ["name"],
        defaults: { name: "application-routes" },
      },
      "aws.ec2.route": {
        properties: ["destinationIpv4Cidr"],
        defaults: { destinationIpv4Cidr: "0.0.0.0/0" },
      },
      "aws.ec2.route-table-association": {
        properties: [],
        defaults: {},
      },
      "aws.ec2.internet-gateway": {
        properties: ["name"],
        defaults: { name: "internet-gateway" },
      },
      "aws.ec2.nat-gateway": {
        properties: ["allocationId", "connectivityType", "availabilityMode"],
        defaults: { connectivityType: "public", availabilityMode: "zonal" },
      },
      "aws.ec2.gateway-vpc-endpoint": {
        properties: ["service", "endpointType", "policyMode"],
        defaults: { service: "s3", endpointType: "Gateway" },
      },
      "aws.ec2.security-group": {
        properties: ["groupName", "description"],
        defaults: {
          groupName: "application-security-group",
          description: "Reviewed application traffic",
        },
      },
      "aws.ec2.security-group-ingress-rule": {
        properties: [
          "protocol",
          "fromPort",
          "toPort",
          "sourceIpv4Cidr",
          "description",
        ],
        defaults: {
          protocol: "tcp",
          fromPort: 443,
          toPort: 443,
          description: "Reviewed inbound traffic",
        },
      },
      "aws.ec2.security-group-egress-rule": {
        properties: [
          "protocol",
          "fromPort",
          "toPort",
          "destinationIpv4Cidr",
          "description",
        ],
        defaults: {
          protocol: "tcp",
          fromPort: 443,
          toPort: 443,
          description: "Reviewed outbound traffic",
        },
      },
      "aws.lambda.vpc-access-configuration": {
        properties: ["egressRequirement", "ipv6AllowedForDualStack"],
        defaults: {
          egressRequirement: "none",
          ipv6AllowedForDualStack: false,
        },
      },
    } as const;

    for (const [serviceId, contract] of Object.entries(
      configurationContracts,
    )) {
      const configuration = requireService(serviceId).configuration;
      const properties = Object.keys(configuration.jsonSchema.properties);
      const defaults = Object.fromEntries(
        Object.entries(configuration.jsonSchema.properties)
          .filter(([, property]) => "default" in property)
          .map(([propertyName, property]) => [
            propertyName,
            "default" in property ? property.default : undefined,
          ]),
      );

      expect(configuration.jsonSchema.additionalProperties, serviceId).toBe(
        false,
      );
      expect(properties, serviceId).toEqual(contract.properties);
      expect(configuration.jsonSchema.required, serviceId).toEqual(
        contract.properties,
      );
      expect(
        configuration.uiHints.map((hint) => hint.property),
        serviceId,
      ).toEqual(contract.properties);
      expect(defaults, serviceId).toEqual(contract.defaults);
    }

    const validRequiredValues: Readonly<
      Partial<
        Record<
          NetworkingServiceId,
          Readonly<Record<string, ConfigurationValue>>
        >
      >
    > = {
      "aws.region.boundary": { regionName: stringValue("us-east-1") },
      "aws.ec2.availability-zone": { zoneName: stringValue("us-east-1a") },
      "aws.ec2.nat-gateway": {
        allocationId: stringValue("eipalloc-0123456789abcdef0"),
      },
      "aws.ec2.gateway-vpc-endpoint": {
        policyMode: stringValue("restricted"),
      },
      "aws.ec2.security-group-ingress-rule": {
        sourceIpv4Cidr: stringValue("10.0.0.0/8"),
      },
      "aws.ec2.security-group-egress-rule": {
        destinationIpv4Cidr: stringValue("10.0.0.0/8"),
      },
    };
    for (const serviceId of networkingServiceIds) {
      const result = validateProviderConfigurationV1(
        requireService(serviceId).configuration,
        validRequiredValues[serviceId] ?? {},
      );
      expect(result.success, serviceId).toBe(true);
      if (result.success) {
        expect(Object.keys(result.values), serviceId).toEqual(
          [...configurationContracts[serviceId].properties].sort(),
        );
      }
    }

    for (const serviceId of [
      "aws.ec2.security-group",
      "aws.ec2.security-group-ingress-rule",
      "aws.ec2.security-group-egress-rule",
    ] as const) {
      const configuration = requireService(serviceId).configuration;
      const description =
        "AZaz09 ._-:/()#,@[]+=;{}!$*" +
        (serviceId === "aws.ec2.security-group" ? "&" : "");
      const values = {
        ...validRequiredValues[serviceId],
        description: stringValue(description),
      };
      expect(
        validateProviderConfigurationV1(configuration, values).success,
      ).toBe(true);
      const invalid = ["é", "bad\n"];
      if (serviceId !== "aws.ec2.security-group") invalid.push("bad&");
      for (const description of invalid) {
        const result = validateProviderConfigurationV1(configuration, {
          ...values,
          description: stringValue(description),
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.issues).toEqual([
            expect.objectContaining({
              path: "$.values.description",
              code: "invalid-value",
            }),
          ]);
        }
      }
    }

    const rejectedModes = [
      {
        id: "dedicated VPC tenancy",
        serviceId: "aws.ec2.vpc",
        values: { instanceTenancy: stringValue("dedicated") },
        path: "$.values.instanceTenancy",
        code: "invalid-value",
      },
      {
        id: "subnet IPv6 assignment",
        serviceId: "aws.ec2.subnet",
        values: { assignIpv6AddressOnCreation: booleanValue(true) },
        path: "$.values.assignIpv6AddressOnCreation",
        code: "invalid-value",
      },
      {
        id: "private NAT gateway",
        serviceId: "aws.ec2.nat-gateway",
        values: {
          allocationId: stringValue("eipalloc-0123456789abcdef0"),
          connectivityType: stringValue("private"),
        },
        path: "$.values.connectivityType",
        code: "invalid-value",
      },
      {
        id: "regional NAT gateway",
        serviceId: "aws.ec2.nat-gateway",
        values: {
          allocationId: stringValue("eipalloc-0123456789abcdef0"),
          availabilityMode: stringValue("regional"),
        },
        path: "$.values.availabilityMode",
        code: "invalid-value",
      },
      {
        id: "interface VPC endpoint",
        serviceId: "aws.ec2.gateway-vpc-endpoint",
        values: {
          endpointType: stringValue("Interface"),
          policyMode: stringValue("full-access"),
        },
        path: "$.values.endpointType",
        code: "invalid-value",
      },
      {
        id: "unsupported endpoint service",
        serviceId: "aws.ec2.gateway-vpc-endpoint",
        values: {
          service: stringValue("sqs"),
          policyMode: stringValue("full-access"),
        },
        path: "$.values.service",
        code: "invalid-value",
      },
      {
        id: "unsupported ingress protocol",
        serviceId: "aws.ec2.security-group-ingress-rule",
        values: {
          protocol: stringValue("sctp"),
          sourceIpv4Cidr: stringValue("10.0.0.0/8"),
        },
        path: "$.values.protocol",
        code: "invalid-value",
      },
      {
        id: "Lambda dual-stack access",
        serviceId: "aws.lambda.vpc-access-configuration",
        values: { ipv6AllowedForDualStack: booleanValue(true) },
        path: "$.values.ipv6AllowedForDualStack",
        code: "invalid-value",
      },
      {
        id: "unreviewed Lambda egress requirement",
        serviceId: "aws.lambda.vpc-access-configuration",
        values: {
          egressRequirement: stringValue("arbitrary-service"),
        },
        path: "$.values.egressRequirement",
        code: "invalid-value",
      },
      {
        id: "unreviewed provider field",
        serviceId: "aws.ec2.vpc",
        values: { customerCloudCredential: stringValue("forbidden") },
        path: "$.values.customerCloudCredential",
        code: "unknown-property",
      },
    ] as const;
    for (const testCase of rejectedModes) {
      const result = validateProviderConfigurationV1(
        requireService(testCase.serviceId).configuration,
        testCase.values,
      );
      expect(result.success, testCase.id).toBe(false);
      if (!result.success) {
        expect(result.issues, testCase.id).toEqual([
          expect.objectContaining({
            code: testCase.code,
            path: testCase.path,
          }),
        ]);
        expect(JSON.stringify(result.issues), testCase.id).not.toContain(
          "forbidden",
        );
      }
    }

    expect(
      networkingServiceIds.flatMap((serviceId) =>
        requireService(serviceId).unsupportedCapabilities.map(
          (capability) => capability.id,
        ),
      ),
    ).toEqual([
      "aws.region.boundary.unsupported.live-discovery",
      "aws.region.boundary.unsupported.edge-zone-containment",
      "aws.ec2.vpc.unsupported.ipv6-and-secondary-cidrs",
      "aws.ec2.vpc.unsupported.dedicated-tenancy",
      "aws.ec2.availability-zone.unsupported.zone-id-portability",
      "aws.ec2.availability-zone.unsupported.extended-zones",
      "aws.ec2.subnet.unsupported.ipv6-and-special-zones",
      "aws.ec2.subnet.unsupported.implicit-public-status",
      "aws.ec2.route-table.unsupported.main-table-adoption",
      "aws.ec2.route-table.unsupported.propagation",
      "aws.ec2.route.unsupported.ipv6-and-prefix-lists",
      "aws.ec2.route.unsupported.advanced-targets",
      "aws.ec2.route-table-association.unsupported.gateway-association",
      "aws.ec2.route-table-association.unsupported.main-table-replacement",
      "aws.ec2.internet-gateway.unsupported.ipv6-egress-only",
      "aws.ec2.internet-gateway.unsupported.implicit-exposure",
      "aws.ec2.nat-gateway.unsupported.private-and-regional",
      "aws.ec2.nat-gateway.unsupported.advanced-addressing",
      "aws.ec2.gateway-vpc-endpoint.unsupported.interface-endpoints",
      "aws.ec2.gateway-vpc-endpoint.unsupported.cross-region",
      "aws.ec2.security-group.unsupported.inline-and-default-rules",
      "aws.ec2.security-group.unsupported.shared-and-cross-vpc",
      "aws.ec2.security-group-ingress-rule.unsupported.non-cidr-sources",
      "aws.ec2.security-group-ingress-rule.unsupported.inline-rules",
      "aws.ec2.security-group-egress-rule.unsupported.non-cidr-destinations",
      "aws.ec2.security-group-egress-rule.unsupported.implicit-default-egress",
      "aws.lambda.vpc-access-configuration.unsupported.dual-stack",
      "aws.lambda.vpc-access-configuration.unsupported.false-containment",
    ]);
  });

  it("assigns every semantic port an exact direction and cardinality", () => {
    for (const serviceId of networkingServiceIds) {
      const ports = requireService(serviceId).ports.map(
        ({ id, direction, cardinality, required }) => ({
          id,
          direction,
          cardinality,
          required,
        }),
      );
      expect(ports, serviceId).toEqual([
        ...expectedPorts[serviceId],
        ...(additionalExpectedNetworkPortIds[serviceId] ?? []).map((id) => ({
          id,
          direction: "input",
          cardinality: "many",
          required: false,
        })),
      ]);
    }

    const lambda = requireService("aws.lambda.function");
    expect(lambda.placement).toMatchObject({
      rootPlacement: "allowed",
      allowedParentTypes: [],
    });
    expect(
      lambda.ports.find((port) => port.id === "aws.lambda.function.vpc-access"),
    ).toMatchObject({
      direction: "input",
      cardinality: "one",
      required: false,
    });
  });

  it("declares exactly twenty typed relationships and only eight direct association recipes", async () => {
    expect(awsNetworkingConnectionRulesV1).toHaveLength(20);
    expect(awsNetworkingConnectionRulesV1.map((rule) => rule.id)).toEqual(
      Object.keys(expectedConnectionEndpoints),
    );

    for (const rule of awsNetworkingConnectionRulesV1) {
      const expected =
        expectedConnectionEndpoints[
          rule.id as keyof typeof expectedConnectionEndpoints
        ];
      expect(expected, rule.id).toBeDefined();
      const [
        sourceServiceId,
        sourcePortId,
        targetServiceId,
        targetPortId,
        maximumConnectionsPerSource,
        maximumConnectionsPerTarget,
      ] = expected;

      expect(rule, rule.id).toMatchObject({
        relationshipType: rule.id,
        category: "network-and-security",
        source: { serviceId: sourceServiceId, portId: sourcePortId },
        target: { serviceId: targetServiceId, portId: targetPortId },
        maximumConnectionsPerSource,
        maximumConnectionsPerTarget,
        maximumConnectionsPerEndpointPair: 1,
        lifecycle: {
          provenance: "connection-rule",
          deletion: "release-generated-resources",
          adoption: "required-before-customization",
          sharedResource: "retain-while-referenced",
        },
        configuration: {
          jsonSchema: {
            additionalProperties: false,
            properties: {},
            required: [],
          },
        },
        questions: [],
        supportingChanges: [],
        iamEffects: [],
      });
      expect(
        requireService(sourceServiceId).ports.find(
          (port) => port.id === sourcePortId,
        ),
        `${rule.id} source`,
      ).toMatchObject({ direction: "output" });
      expect(
        requireService(targetServiceId).ports.find(
          (port) => port.id === targetPortId,
        ),
        `${rule.id} target`,
      ).toMatchObject({ direction: "input" });
    }

    expect(
      awsNetworkingConnectionRulesV1
        .filter((rule) => rule.implementation.status === "implemented")
        .map((rule) => rule.id),
    ).toEqual(implementedNetworkingRuleIds);

    const currentCatalog = compileProviderCatalogV1(awsCatalogSourceV1);
    vi.doMock("./catalog-v1-accessors.js", () => ({
      awsCatalogArtifactV1: currentCatalog.artifact,
      awsCatalogV1: undefined,
    }));
    const { awsConnectionRuleRegistrationsV1 } =
      await import("./connection-resolution.js");
    vi.doUnmock("./catalog-v1-accessors.js");

    const networkingRegistrations = awsConnectionRuleRegistrationsV1.filter(
      (registration) =>
        implementedNetworkingRuleIds.includes(
          registration.ruleId as (typeof implementedNetworkingRuleIds)[number],
        ),
    );
    expect(
      networkingRegistrations.map((registration) => registration.ruleId),
    ).toEqual(implementedNetworkingRuleIds);
    for (const registration of networkingRegistrations) {
      const descriptor = awsNetworkingConnectionRulesV1.find(
        (rule) => rule.id === registration.ruleId,
      );
      expect(descriptor?.implementation).toMatchObject({
        status: "implemented",
        interfaceVersion: registration.interfaceVersion,
        implementationId: registration.implementationId,
      });
      expect(registration.resolve(undefined as never)).toEqual({
        success: true,
        commands: [],
        generatedResources: [],
      });
    }
  });

  it("models route, policy, security-group, and Lambda configuration through exact owner slots", () => {
    expect(awsRouteTableOwnedConfigurationSlotsV1).toMatchObject([
      {
        id: "aws.ec2.route-table.slot.routes",
        graphBinding: {
          configurationServiceId: "aws.ec2.route",
          ownershipRelationshipType: "aws.ec2.route-table-owns-route",
        },
        cardinality: { minimum: 0, maximum: "many" },
        allowedOwnership: ["user", "generated"],
        generatedAdoption: "allowed",
        policyKinds: [],
      },
      {
        id: "aws.ec2.route-table.slot.subnet-associations",
        graphBinding: {
          configurationServiceId: "aws.ec2.route-table-association",
          ownershipRelationshipType:
            "aws.ec2.route-table-owns-subnet-association",
        },
        cardinality: { minimum: 0, maximum: "many" },
        allowedOwnership: ["user", "generated"],
        generatedAdoption: "allowed",
        policyKinds: [],
      },
    ]);
    expect(awsSecurityGroupOwnedConfigurationSlotsV1).toMatchObject([
      {
        id: "aws.ec2.security-group.slot.ingress-rules",
        graphBinding: {
          configurationServiceId: "aws.ec2.security-group-ingress-rule",
          ownershipRelationshipType: "aws.ec2.security-group-owns-ingress-rule",
        },
        allowedOwnership: ["user"],
        generatedAdoption: "not-applicable",
        policyKinds: [],
      },
      {
        id: "aws.ec2.security-group.slot.egress-rules",
        graphBinding: {
          configurationServiceId: "aws.ec2.security-group-egress-rule",
          ownershipRelationshipType: "aws.ec2.security-group-owns-egress-rule",
        },
        allowedOwnership: ["user"],
        generatedAdoption: "not-applicable",
        policyKinds: [],
      },
    ]);
    expect(awsGatewayVpcEndpointOwnedConfigurationSlotsV1).toMatchObject([
      {
        id: "aws.ec2.gateway-vpc-endpoint.slot.resource-policy",
        graphBinding: {
          configurationServiceId: "aws.iam.policy-document",
          ownershipRelationshipType: "aws.ec2.gateway-endpoint-owns-policy",
        },
        cardinality: { minimum: 0, maximum: 1 },
        allowedOwnership: ["user"],
        generatedAdoption: "not-applicable",
        policyKinds: ["resource"],
      },
    ]);
    expect(awsLambdaVpcAccessOwnedConfigurationSlotsV1).toMatchObject([
      {
        id: "aws.lambda.function.slot.vpc-access-configuration",
        graphBinding: {
          configurationServiceId: "aws.lambda.vpc-access-configuration",
          ownershipRelationshipType: "aws.lambda.owns-vpc-access-configuration",
        },
        cardinality: { minimum: 0, maximum: 1 },
        allowedOwnership: ["user"],
        generatedAdoption: "not-applicable",
        policyKinds: [],
      },
    ]);

    expect(
      requireService("aws.ec2.security-group").placement.allowedParentTypes,
    ).toEqual([]);
    expect(
      requireService("aws.ec2.security-group-ingress-rule").placement
        .allowedParentTypes,
    ).toEqual([
      {
        serviceId: "aws.ec2.security-group",
        relationshipType: "aws.ec2.security-group-owns-ingress-rule",
      },
    ]);
    expect(
      awsNetworkingConnectionRulesV1.some(
        (rule) =>
          rule.id.includes("security-group") && rule.id.includes("contains"),
      ),
    ).toBe(false);
    expect(
      awsNetworkingConnectionRulesV1.some(
        (rule) =>
          rule.id.includes("lambda") &&
          (rule.id.includes("contains-vpc") ||
            rule.id.includes("vpc-contains-lambda")),
      ),
    ).toBe(false);
  });

  it("keeps routing choices human-readable, cost-aware, and target-explicit", () => {
    const subnetEducation = JSON.stringify(
      requireService("aws.ec2.subnet").education,
    ).toLowerCase();
    expect(subnetEducation).toContain("public");
    expect(subnetEducation).toContain("private");
    expect(subnetEducation).toContain("route table");
    expect(subnetEducation).toContain("multiple az");
    expect(subnetEducation).toContain("availability zone-to-vpc ancestry");
    const subnet = requireService("aws.ec2.subnet");
    expect(
      subnet.mappings.find((mapping) => mapping.target === "terraform"),
    ).toMatchObject({
      implementationStatus: "implemented",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.networking-terraform",
      },
    });
    expect(
      subnet.mappings.find((mapping) => mapping.target === "cloudformation")
        ?.implementationStatus,
    ).toBe("implemented");

    expect(
      Object.fromEntries(
        subnet.mappings.map((mapping) => [
          mapping.target,
          mapping.portBindings,
        ]),
      ),
    ).toEqual({
      cloudformation: [
        {
          portId: "aws.ec2.subnet.availability-zone",
          targetAttribute: "AvailabilityZone",
        },
        { portId: "aws.ec2.subnet.fsx", targetAttribute: "Ref" },
      ],
      terraform: [
        {
          portId: "aws.ec2.subnet.availability-zone",
          targetAttribute: "availability_zone",
        },
        { portId: "aws.ec2.subnet.fsx", targetAttribute: "id" },
      ],
    });

    const securityGroupEducation = JSON.stringify(
      requireService("aws.ec2.security-group").education,
    ).toLowerCase();
    expect(securityGroupEducation).toContain("default outbound ipv4/ipv6");
    expect(securityGroupEducation).toContain("suppress");
    const securityGroupDefaultEgressLimitation = requireService(
      "aws.ec2.security-group",
    ).unsupportedCapabilities.find(
      (capability) =>
        capability.id ===
        "aws.ec2.security-group.unsupported.inline-and-default-rules",
    );
    expect(securityGroupDefaultEgressLimitation?.explanation).toMatch(
      /localhost-only placeholder suppresses AWS defaults at creation/u,
    );

    const natEducation = JSON.stringify(
      requireService("aws.ec2.nat-gateway").education,
    ).toLowerCase();
    expect(natEducation).toContain("hourly");
    expect(natEducation).toContain("per-gigabyte");
    expect(natEducation).toContain("cross-zone");
    expect(natEducation).toContain(
      "one zonal gateway per active availability zone",
    );

    const endpointEducation = JSON.stringify(
      requireService("aws.ec2.gateway-vpc-endpoint").education,
    ).toLowerCase();
    expect(endpointEducation).toContain("s3");
    expect(endpointEducation).toContain("dynamodb");
    expect(endpointEducation).toContain(
      "without using an internet or nat gateway",
    );
    expect(endpointEducation).toContain("no hourly");

    const egressEducation = JSON.stringify(
      requireService("aws.ec2.security-group-egress-rule").education,
    ).toLowerCase();
    expect(egressEducation).toContain("cloudformation");
    expect(egressEducation).toContain("default outbound ipv4/ipv6");
    expect(egressEducation).toContain("standalone");
    const egressDefaultLimitation = requireService(
      "aws.ec2.security-group-egress-rule",
    ).unsupportedCapabilities.find(
      (capability) =>
        capability.id ===
        "aws.ec2.security-group-egress-rule.unsupported.implicit-default-egress",
    );
    expect(egressDefaultLimitation?.explanation).toMatch(
      /suppresses creation defaults with an explicit localhost-only placeholder/u,
    );

    const lambdaEducation = JSON.stringify(
      requireService("aws.lambda.vpc-access-configuration").education,
    ).toLowerCase();
    expect(lambdaEducation).toContain("does not represent service containment");
    expect(lambdaEducation).toContain("nat routing");
    expect(lambdaEducation).toContain("matching service endpoint");

    for (const serviceId of networkingServiceIds) {
      const service = requireService(serviceId);
      expect(service.education.documentation, serviceId).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "official" })]),
      );
      expect(service.education.considerations, serviceId).toHaveLength(4);
      const ambient =
        serviceId === "aws.region.boundary" ||
        serviceId === "aws.ec2.availability-zone";
      expect(
        service.mappings.find((mapping) => mapping.target === "terraform")
          ?.implementationStatus,
        serviceId,
      ).toBe(ambient ? undefined : "implemented");
      expect(
        service.mappings.find((mapping) => mapping.target === "cloudformation")
          ?.implementationStatus,
        serviceId,
      ).toBe(
        ambient || serviceId === "aws.lambda.vpc-access-configuration"
          ? undefined
          : "implemented",
      );
    }
    expect(
      ["aws.region.boundary", "aws.ec2.availability-zone"].map(
        (serviceId) => requireService(serviceId).mappings,
      ),
    ).toEqual([[], []]);

    for (const extension of awsNetworkingServiceExtensionsV1) {
      const ambient =
        extension.serviceId === "aws.region.boundary" ||
        extension.serviceId === "aws.ec2.availability-zone";
      expect(
        extension.targetReadiness.modeling.status,
        extension.serviceId,
      ).toBe("supported");
      expect(
        extension.targetReadiness.configuration.status,
        extension.serviceId,
      ).toBe("supported");
      expect(
        extension.targetReadiness.validation.status,
        extension.serviceId,
      ).toBe("supported");
      expect(
        extension.targetReadiness.terraform.status,
        extension.serviceId,
      ).toBe(ambient ? "not-applicable" : "supported");
      expect(
        extension.targetReadiness.cloudformation.status,
        extension.serviceId,
      ).toBe(ambient ? "not-applicable" : "supported");
      expect(
        extension.targetReadiness.generatedCode.status,
        extension.serviceId,
      ).toBe("not-applicable");
    }

    const lambdaVpcAccess = requireService(
      "aws.lambda.vpc-access-configuration",
    );
    expect(lambdaVpcAccess.mappings).toEqual([
      expect.objectContaining({
        target: "terraform",
        kind: "nested-block",
        blockName: "vpc_config",
        ownerServiceId: "aws.lambda.function",
        ownerRelationshipType: "aws.lambda.owns-vpc-access-configuration",
        implementationStatus: "implemented",
      }),
    ]);
    const lambdaVpcAccessExtension = awsNetworkingServiceExtensionsV1.find(
      (extension) =>
        extension.serviceId === "aws.lambda.vpc-access-configuration",
    );
    expect(lambdaVpcAccessExtension).toBeDefined();
    const lambdaTerraformReadiness =
      lambdaVpcAccessExtension?.targetReadiness.terraform;
    expect(lambdaTerraformReadiness?.status).toBe("supported");
    expect(lambdaTerraformReadiness?.reason.toLowerCase()).toContain("nested");
    expect(lambdaTerraformReadiness?.reason.toLowerCase()).toContain(
      "no standalone resource",
    );
    const lambdaCloudFormationReadiness =
      lambdaVpcAccessExtension?.targetReadiness.cloudformation;
    expect(lambdaCloudFormationReadiness?.status).toBe("supported");
    expect(lambdaCloudFormationReadiness?.reason.toLowerCase()).toContain(
      "no false standalone resource",
    );

    const lambdaVpcAccessSlot = awsLambdaVpcAccessOwnedConfigurationSlotsV1[0];
    expect(lambdaVpcAccessSlot).toBeDefined();
    expect(lambdaVpcAccessSlot?.targetReadiness.terraform.status).toBe(
      "supported",
    );
    expect(
      lambdaVpcAccessSlot?.targetReadiness.terraform.reason.toLowerCase(),
    ).toContain("nested vpc_config");
    expect(lambdaVpcAccessSlot?.targetReadiness.cloudformation.status).toBe(
      "supported",
    );
  });

  it("keeps exact 0.10 Terraform readiness without erasing existing service support", () => {
    const catalog = compileProviderCatalogV1(awsCatalogSourceV1);
    const extension = compileProviderServiceExtensionV1(
      createAwsProviderServiceExtensionSourceV1(catalog.artifact),
      catalog.artifact,
    );

    expect(catalog.artifact.catalog.version).toBe("0.30.0");
    expect(
      catalog.artifact.services
        .find((service) => service.id === "aws.apigateway.http-api")
        ?.mappings.find((mapping) => mapping.target === "terraform")
        ?.implementationStatus,
    ).toBe("implemented");

    for (const serviceId of networkingServiceIds) {
      const service = extension.artifact.services.find(
        (candidate) => candidate.serviceId === serviceId,
      );
      expect(service, serviceId).toBeDefined();
      const ambient =
        serviceId === "aws.region.boundary" ||
        serviceId === "aws.ec2.availability-zone";
      expect(service?.targetReadiness.terraform.status, serviceId).toBe(
        ambient ? "not-applicable" : "supported",
      );
      if (!ambient) {
        expect(
          service?.targetReadiness.terraform.reason.toLowerCase(),
          serviceId,
        ).toContain("reviewed");
      }
      for (const slot of service?.ownedConfigurationSlots ?? []) {
        expect(slot.targetReadiness.terraform.status, slot.id).toBe(
          "supported",
        );
      }
    }
  });

  it("binds every networking port to one stable dock and compiles deterministically", () => {
    const firstCatalog = compileProviderCatalogV1(awsCatalogSourceV1);
    const secondCatalog = compileProviderCatalogV1(awsCatalogSourceV1);
    expect(firstCatalog.hash).toBe(secondCatalog.hash);
    expect(firstCatalog.canonicalJson).toBe(secondCatalog.canonicalJson);
    expect(firstCatalog.artifact.catalog.version).toBe("0.30.0");
    expect(
      firstCatalog.artifact.services
        .filter((service) => networkingServiceIdSet.has(service.id))
        .map((service) => service.id),
    ).toEqual([...networkingServiceIds].sort());
    expect(
      firstCatalog.artifact.connectionRules
        .filter((rule) => Object.hasOwn(expectedConnectionEndpoints, rule.id))
        .map((rule) => rule.id),
    ).toEqual(Object.keys(expectedConnectionEndpoints).sort());

    const presentationSource = createAwsConnectionPresentationSourceV1(
      firstCatalog.artifact,
    );
    const firstPresentation = compilePresentation(
      presentationSource,
      firstCatalog.artifact,
    );
    const secondPresentation = compilePresentation(
      createAwsConnectionPresentationSourceV1(secondCatalog.artifact),
      secondCatalog.artifact,
    );
    expect(firstPresentation.hash).toBe(secondPresentation.hash);
    expect(firstPresentation.canonicalJson).toBe(
      secondPresentation.canonicalJson,
    );

    for (const serviceId of networkingServiceIds) {
      const servicePresentation = firstPresentation.artifact.services.find(
        (service) => service.serviceId === serviceId,
      );
      expect(servicePresentation, serviceId).toBeDefined();
      const assignedPortIds =
        servicePresentation?.docks.flatMap((dock) => dock.portIds) ?? [];
      expect([...assignedPortIds].sort(), serviceId).toEqual(
        [
          ...expectedPorts[serviceId].map((port) => port.id),
          ...(additionalExpectedNetworkPortIds[serviceId] ?? []),
        ].sort(),
      );
      expect(new Set(assignedPortIds).size, serviceId).toBe(
        assignedPortIds.length,
      );
      for (const dock of servicePresentation?.docks ?? []) {
        expect(String(dock.id).startsWith(`${serviceId}.dock.`), dock.id).toBe(
          true,
        );
        expect(dock.placement, dock.id).toBe(
          dock.directionPolicy === "input-only" ? "left" : "right",
        );
      }
    }

    const firstExtension = compileProviderServiceExtensionV1(
      createAwsProviderServiceExtensionSourceV1(firstCatalog.artifact),
      firstCatalog.artifact,
    );
    const secondExtension = compileProviderServiceExtensionV1(
      createAwsProviderServiceExtensionSourceV1(secondCatalog.artifact),
      secondCatalog.artifact,
    );
    expect(firstExtension.hash).toBe(secondExtension.hash);
    expect(firstExtension.canonicalJson).toBe(secondExtension.canonicalJson);
    expect(firstExtension.artifact.catalog).toEqual({
      id: firstCatalog.artifact.catalog.id,
      version: firstCatalog.artifact.catalog.version,
      digest: firstCatalog.artifact.digest,
    });
  });
});
