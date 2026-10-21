import type {
  ValidationAffectedLocation,
  ValidationFindingCandidate,
} from "@cloudmarkup/domain";
import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";
import {
  securityGroupDescriptionPattern,
  securityGroupRuleDescriptionPattern,
} from "../catalog/services/security-group-description.js";

import {
  lambdaVpcAccessValidationRuleDescriptor,
  networkPlacementValidationRuleDescriptor,
  networkRoutingValidationRuleDescriptor,
  securityGroupPolicyValidationRuleDescriptor,
} from "../catalog/validation-rules/networking-validation-rules.js";
import {
  defineAwsValidationRuleV1,
  edgeLocation,
  finding,
  isLowerEnvironment,
  literalBoolean,
  literalInteger,
  literalString,
  nodeConfigurationLocation,
  nodeLocation,
  type AwsValidationCatalogV1,
  type AwsValidationDocument,
  type AwsValidationEdge,
  type AwsValidationNode,
} from "./rule-helpers.js";

interface IndexedNode {
  readonly node: AwsValidationNode;
  readonly index: number;
}

interface IndexedEdge {
  readonly edge: AwsValidationEdge;
  readonly index: number;
}

interface Ipv4Cidr {
  readonly start: number;
  readonly end: number;
  readonly prefix: number;
}

const REGION = "aws.region.boundary";
const VPC = "aws.ec2.vpc";
const AVAILABILITY_ZONE = "aws.ec2.availability-zone";
const SUBNET = "aws.ec2.subnet";
const ROUTE_TABLE = "aws.ec2.route-table";
const ROUTE = "aws.ec2.route";
const ROUTE_TABLE_ASSOCIATION = "aws.ec2.route-table-association";
const INTERNET_GATEWAY = "aws.ec2.internet-gateway";
const NAT_GATEWAY = "aws.ec2.nat-gateway";
const GATEWAY_ENDPOINT = "aws.ec2.gateway-vpc-endpoint";
const SECURITY_GROUP = "aws.ec2.security-group";
const SECURITY_GROUP_INGRESS_RULE = "aws.ec2.security-group-ingress-rule";
const SECURITY_GROUP_EGRESS_RULE = "aws.ec2.security-group-egress-rule";
const IAM_POLICY_DOCUMENT = "aws.iam.policy-document";
const LAMBDA_FUNCTION = "aws.lambda.function";
const LAMBDA_VPC_CONFIGURATION = "aws.lambda.vpc-access-configuration";

const networkingServices = new Set([
  REGION,
  VPC,
  AVAILABILITY_ZONE,
  SUBNET,
  ROUTE_TABLE,
  ROUTE,
  ROUTE_TABLE_ASSOCIATION,
  INTERNET_GATEWAY,
  NAT_GATEWAY,
  GATEWAY_ENDPOINT,
  SECURITY_GROUP,
  SECURITY_GROUP_INGRESS_RULE,
  SECURITY_GROUP_EGRESS_RULE,
  LAMBDA_VPC_CONFIGURATION,
]);

const RELATIONSHIPS = Object.freeze({
  regionContainsVpc: "aws.region.contains-vpc",
  vpcContainsAvailabilityZone: "aws.ec2.vpc-contains-availability-zone",
  availabilityZoneContainsSubnet: "aws.ec2.availability-zone-contains-subnet",
  vpcContainsRouteTable: "aws.ec2.vpc-contains-route-table",
  subnetContainsNatGateway: "aws.ec2.subnet-contains-nat-gateway",
  vpcContainsGatewayEndpoint: "aws.ec2.vpc-contains-gateway-endpoint",
  routeTableOwnsRoute: "aws.ec2.route-table-owns-route",
  routeTableOwnsSubnetAssociation:
    "aws.ec2.route-table-owns-subnet-association",
  routeTableAssociationTargetsSubnet:
    "aws.ec2.route-table-association-targets-subnet",
  vpcAttachesInternetGateway: "aws.ec2.vpc-attaches-internet-gateway",
  routeTargetsInternetGateway: "aws.ec2.route-targets-internet-gateway",
  routeTargetsNatGateway: "aws.ec2.route-targets-nat-gateway",
  gatewayEndpointAssociatesRouteTable:
    "aws.ec2.gateway-endpoint-associates-route-table",
  gatewayEndpointOwnsPolicy: "aws.ec2.gateway-endpoint-owns-policy",
  vpcAssociatesSecurityGroup: "aws.ec2.vpc-associates-security-group",
  securityGroupOwnsIngressRule: "aws.ec2.security-group-owns-ingress-rule",
  securityGroupOwnsEgressRule: "aws.ec2.security-group-owns-egress-rule",
  lambdaOwnsVpcConfiguration: "aws.lambda.owns-vpc-access-configuration",
  lambdaVpcAccessUsesSubnet: "aws.lambda.vpc-access-uses-subnet",
  lambdaVpcAccessUsesSecurityGroup: "aws.lambda.vpc-access-uses-security-group",
  roleAssumedByLambda: "aws.iam.role-assumed-by-lambda",
  roleOwnsManagedPolicyAttachment:
    "aws.iam.role-owns-managed-policy-attachment",
});

const requiredParentByService = new Map<
  string,
  {
    readonly parentService: string;
    readonly relationship: string;
    readonly edgeDirection: "parent-to-child" | "child-to-parent";
  }
>([
  [
    VPC,
    {
      parentService: REGION,
      relationship: RELATIONSHIPS.regionContainsVpc,
      edgeDirection: "parent-to-child",
    },
  ],
  [
    AVAILABILITY_ZONE,
    {
      parentService: VPC,
      relationship: RELATIONSHIPS.vpcContainsAvailabilityZone,
      edgeDirection: "parent-to-child",
    },
  ],
  [
    SUBNET,
    {
      parentService: AVAILABILITY_ZONE,
      relationship: RELATIONSHIPS.availabilityZoneContainsSubnet,
      edgeDirection: "parent-to-child",
    },
  ],
  [
    ROUTE_TABLE,
    {
      parentService: VPC,
      relationship: RELATIONSHIPS.vpcContainsRouteTable,
      edgeDirection: "parent-to-child",
    },
  ],
  [
    ROUTE,
    {
      parentService: ROUTE_TABLE,
      relationship: RELATIONSHIPS.routeTableOwnsRoute,
      edgeDirection: "child-to-parent",
    },
  ],
  [
    ROUTE_TABLE_ASSOCIATION,
    {
      parentService: ROUTE_TABLE,
      relationship: RELATIONSHIPS.routeTableOwnsSubnetAssociation,
      edgeDirection: "child-to-parent",
    },
  ],
  [
    NAT_GATEWAY,
    {
      parentService: SUBNET,
      relationship: RELATIONSHIPS.subnetContainsNatGateway,
      edgeDirection: "parent-to-child",
    },
  ],
  [
    GATEWAY_ENDPOINT,
    {
      parentService: VPC,
      relationship: RELATIONSHIPS.vpcContainsGatewayEndpoint,
      edgeDirection: "parent-to-child",
    },
  ],
  [
    SECURITY_GROUP_INGRESS_RULE,
    {
      parentService: SECURITY_GROUP,
      relationship: RELATIONSHIPS.securityGroupOwnsIngressRule,
      edgeDirection: "child-to-parent",
    },
  ],
  [
    SECURITY_GROUP_EGRESS_RULE,
    {
      parentService: SECURITY_GROUP,
      relationship: RELATIONSHIPS.securityGroupOwnsEgressRule,
      edgeDirection: "child-to-parent",
    },
  ],
  [
    LAMBDA_VPC_CONFIGURATION,
    {
      parentService: LAMBDA_FUNCTION,
      relationship: RELATIONSHIPS.lambdaOwnsVpcConfiguration,
      edgeDirection: "child-to-parent",
    },
  ],
]);

const requiredVpcAssociationByService = new Map<string, string>([
  [INTERNET_GATEWAY, RELATIONSHIPS.vpcAttachesInternetGateway],
  [SECURITY_GROUP, RELATIONSHIPS.vpcAssociatesSecurityGroup],
]);

function indexedNodes(document: AwsValidationDocument): readonly IndexedNode[] {
  return document.nodes.map((node, index) => ({ node, index }));
}

function indexedEdges(document: AwsValidationDocument): readonly IndexedEdge[] {
  return document.edges.map((edge, index) => ({ edge, index }));
}

function nodeMap(
  document: AwsValidationDocument,
): ReadonlyMap<string, IndexedNode> {
  return new Map(
    indexedNodes(document).map((entry) => [String(entry.node.id), entry]),
  );
}

export function parseIpv4Cidr(
  value: string | undefined,
  minimumPrefix = 0,
  maximumPrefix = 32,
): Ipv4Cidr | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/u.exec(
    value,
  );
  if (match === null) {
    return undefined;
  }
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (
    octets.some(
      (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
    ) ||
    !Number.isInteger(prefix) ||
    prefix < minimumPrefix ||
    prefix > maximumPrefix
  ) {
    return undefined;
  }
  const [firstOctet, secondOctet, thirdOctet, fourthOctet] = octets;
  if (
    firstOctet === undefined ||
    secondOctet === undefined ||
    thirdOctet === undefined ||
    fourthOctet === undefined
  ) {
    return undefined;
  }
  const address =
    firstOctet * 2 ** 24 +
    secondOctet * 2 ** 16 +
    thirdOctet * 2 ** 8 +
    fourthOctet;
  const blockSize = 2 ** (32 - prefix);
  const start = Math.floor(address / blockSize) * blockSize;
  if (start !== address) {
    return undefined;
  }
  return { start, end: start + blockSize - 1, prefix };
}

function vpcIdForNode(
  node: AwsValidationNode,
  nodes: ReadonlyMap<string, IndexedNode>,
  document: AwsValidationDocument,
): string | undefined {
  const associationRelationship = requiredVpcAssociationByService.get(
    String(node.semantic.serviceType),
  );
  if (associationRelationship !== undefined) {
    const associations = indexedEdges(document).filter(
      ({ edge }) =>
        edge.semantic.relationshipType === associationRelationship &&
        edge.semantic.target.nodeId === node.id,
    );
    if (associations.length !== 1) {
      return undefined;
    }
    const sourceId = String(associations[0]?.edge.semantic.source.nodeId);
    return nodes.get(sourceId)?.node.semantic.serviceType === VPC
      ? sourceId
      : undefined;
  }

  let current: AwsValidationNode | undefined = node;
  const visited = new Set<string>();
  while (current !== undefined && !visited.has(String(current.id))) {
    visited.add(String(current.id));
    if (current.semantic.serviceType === VPC) {
      return String(current.id);
    }
    const parentId: string | undefined = current.semantic.parent?.nodeId;
    current = parentId === undefined ? undefined : nodes.get(parentId)?.node;
  }
  return undefined;
}

function availabilityZoneIdForSubnet(
  subnet: AwsValidationNode,
  nodes: ReadonlyMap<string, IndexedNode>,
): string | undefined {
  const parentId = subnet.semantic.parent?.nodeId;
  const parent =
    parentId === undefined ? undefined : nodes.get(String(parentId));
  return parent?.node.semantic.serviceType === AVAILABILITY_ZONE
    ? String(parent.node.id)
    : undefined;
}

function affectedEdges(
  entries: readonly IndexedEdge[],
): readonly ValidationAffectedLocation[] {
  return entries.map(({ edge, index }) => edgeLocation(edge, index));
}

function parentBackingEdges(
  document: AwsValidationDocument,
  child: AwsValidationNode,
  parentId: string,
  relationship: string,
  direction: "parent-to-child" | "child-to-parent",
): readonly IndexedEdge[] {
  return indexedEdges(document).filter(({ edge }) => {
    if (edge.semantic.relationshipType !== relationship) {
      return false;
    }
    return direction === "parent-to-child"
      ? String(edge.semantic.source.nodeId) === parentId &&
          edge.semantic.target.nodeId === child.id
      : edge.semantic.source.nodeId === child.id &&
          String(edge.semantic.target.nodeId) === parentId;
  });
}

export function createNetworkPlacementRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = networkPlacementValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const nodes = nodeMap(document);
      const findings: ValidationFindingCandidate[] = [];
      for (const { node, index } of indexedNodes(document)) {
        const serviceType = String(node.semantic.serviceType);
        if (!networkingServices.has(serviceType)) continue;
        const service = catalog.services.find(
          (entry) => entry.id === serviceType,
        );
        if (service === undefined) continue;
        const result = validateProviderConfigurationV1(
          service.configuration,
          node.semantic.configuration.values,
        );
        if (result.success) continue;
        for (const issue of result.issues) {
          const property = /^\$\.values\.([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(
            issue.path,
          )?.[1];
          findings.push(
            finding(descriptor, {
              code: "aws.validation.network-configuration-invalid",
              severity: "error",
              title:
                "Networking configuration does not satisfy its catalog field",
              beginnerExplanation:
                "Correct the indicated networking setting before exporting. Declared values are never replaced automatically.",
              technicalExplanation: issue.message,
              affected: [
                property === undefined
                  ? nodeLocation(node, index, ".semantic.configuration.values")
                  : nodeConfigurationLocation(node, index, property),
              ],
            }),
          );
        }
      }
      const regions = indexedNodes(document).filter(
        ({ node }) => node.semantic.serviceType === REGION,
      );
      const vpcs = indexedNodes(document).filter(
        ({ node }) => node.semantic.serviceType === VPC,
      );

      if (regions.length > 1) {
        findings.push(
          finding(descriptor, {
            code: "aws.validation.region-boundary-cardinality",
            severity: "error",
            title: "Architecture has more than one AWS Region boundary",
            beginnerExplanation:
              "This Architecture Document is pinned to one AWS Region, so keep one matching Region boundary.",
            technicalExplanation:
              "Architecture Document provider context is single-Region; multiple aws.region.boundary nodes would create ambiguous placement.",
            affected: regions.map(({ node, index }) =>
              nodeLocation(node, index),
            ),
          }),
        );
      }

      for (const { node, index } of regions) {
        if (node.semantic.parent !== undefined) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.network-root-placement-invalid",
              severity: "error",
              title: "AWS Region boundary must stay at the architecture root",
              beginnerExplanation:
                "Move the Region boundary to the top level; it cannot be placed inside another resource.",
              technicalExplanation:
                "aws.region.boundary has required root placement and cannot carry semantic.parent.",
              affected: [nodeLocation(node, index, ".semantic.parent")],
            }),
          );
        }
        if (
          literalString(node.semantic.configuration.values, "regionName") !==
          document.provider.region
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.region-boundary-provider-mismatch",
              severity: "error",
              title: "Region boundary does not match the document Region",
              beginnerExplanation:
                "Choose the same Region shown in the architecture settings.",
              technicalExplanation:
                "The Region boundary regionName must exactly equal Architecture Document provider.region.",
              affected: [nodeConfigurationLocation(node, index, "regionName")],
            }),
          );
        }
      }

      for (const { node, index } of indexedNodes(document)) {
        const expected = requiredParentByService.get(
          String(node.semantic.serviceType),
        );
        if (expected !== undefined) {
          const parentId = node.semantic.parent?.nodeId;
          if (parentId === undefined) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.network-parent-missing",
                severity: "error",
                title:
                  "Network concept is missing its required owner or boundary",
                beginnerExplanation:
                  "Place this item in its required Region, VPC, Availability Zone, subnet, or owner section.",
                technicalExplanation: `The ${String(node.semantic.serviceType)} service requires parent ${expected.parentService} through ${expected.relationship}.`,
                affected: [nodeLocation(node, index, ".semantic.parent")],
              }),
            );
            continue;
          }
          const parent = nodes.get(String(parentId));
          if (
            parent?.node.semantic.serviceType !== expected.parentService ||
            node.semantic.parent?.relationshipType !== expected.relationship
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.network-parent-invalid",
                severity: "error",
                title:
                  "Network concept is placed under the wrong owner or boundary",
                beginnerExplanation:
                  "Move this item to the required network section instead of using layout as an association.",
                technicalExplanation: `Expected parent service ${expected.parentService} through ${expected.relationship}; provider placement never infers association from canvas nesting.`,
                affected: [nodeLocation(node, index, ".semantic.parent")],
              }),
            );
            continue;
          }
          const backing = parentBackingEdges(
            document,
            node,
            String(parentId),
            expected.relationship,
            expected.edgeDirection,
          );
          if (backing.length !== 1) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.network-parent-edge-invalid",
                severity: "error",
                title:
                  "Network placement needs one exact semantic relationship",
                beginnerExplanation:
                  "Reconnect this item to its owner or boundary so placement and the reviewed relationship agree.",
                technicalExplanation:
                  "The semantic parent tuple must be backed by exactly one correctly directed typed edge; layout alone has no deployment meaning.",
                affected:
                  backing.length === 0
                    ? [nodeLocation(node, index, ".semantic.parent")]
                    : affectedEdges(backing),
              }),
            );
          }
        }

        const associationRelationship = requiredVpcAssociationByService.get(
          String(node.semantic.serviceType),
        );
        if (associationRelationship !== undefined) {
          if (node.semantic.parent !== undefined) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.network-association-false-containment",
                severity: "error",
                title: "VPC association must not be modeled as containment",
                beginnerExplanation:
                  "Keep this item outside the VPC boundary and use its explicit VPC connection.",
                technicalExplanation:
                  "Internet gateways and security groups are VPC-associated resources; semantic.parent is reserved for real containment or owned configuration.",
                affected: [nodeLocation(node, index, ".semantic.parent")],
              }),
            );
          }

          const associations = indexedEdges(document).filter(
            ({ edge }) =>
              edge.semantic.relationshipType === associationRelationship &&
              edge.semantic.target.nodeId === node.id,
          );
          const validAssociations = associations.filter(({ edge }) => {
            const source = nodes.get(String(edge.semantic.source.nodeId));
            return source?.node.semantic.serviceType === VPC;
          });
          if (associations.length !== 1 || validAssociations.length !== 1) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.network-vpc-association-invalid",
                severity: "error",
                title: "Network resource needs one exact VPC association",
                beginnerExplanation:
                  "Connect this item to exactly one VPC without placing it inside the VPC boundary.",
                technicalExplanation: `The ${String(node.semantic.serviceType)} service requires one incoming ${associationRelationship} edge from an aws.ec2.vpc source.`,
                affected:
                  associations.length === 0
                    ? [nodeLocation(node, index)]
                    : affectedEdges(associations),
              }),
            );
          }
        }

        if (
          node.semantic.serviceType === LAMBDA_FUNCTION ||
          node.semantic.serviceType === "aws.dynamodb.table"
        ) {
          const parentId = node.semantic.parent?.nodeId;
          const parentService =
            parentId === undefined
              ? undefined
              : nodes.get(String(parentId))?.node.semantic.serviceType;
          if (
            parentService === VPC ||
            parentService === AVAILABILITY_ZONE ||
            parentService === SUBNET ||
            parentService === SECURITY_GROUP
          ) {
            findings.push(
              finding(descriptor, {
                code:
                  node.semantic.serviceType === LAMBDA_FUNCTION
                    ? "aws.validation.lambda-vpc-false-containment"
                    : "aws.validation.managed-service-vpc-containment",
                severity: "error",
                title:
                  node.semantic.serviceType === LAMBDA_FUNCTION
                    ? "Lambda VPC access must be an association"
                    : "Managed AWS service must remain outside the customer VPC",
                beginnerExplanation:
                  node.semantic.serviceType === LAMBDA_FUNCTION
                    ? "Keep the function outside the VPC and use its VPC access configuration to select subnets and security groups."
                    : "Move this managed service outside the VPC; a gateway endpoint provides private access without moving the service inside.",
                technicalExplanation:
                  "Provider network access is graph-backed configuration and association, not service containment or canvas nesting.",
                affected: [nodeLocation(node, index, ".semantic.parent")],
              }),
            );
          }
        }

        if (node.semantic.serviceType === AVAILABILITY_ZONE) {
          const zoneName = literalString(
            node.semantic.configuration.values,
            "zoneName",
          );
          const suffix = zoneName?.slice(document.provider.region.length);
          if (
            zoneName === undefined ||
            !zoneName.startsWith(document.provider.region) ||
            suffix === undefined ||
            !/^[a-z]$/u.test(suffix)
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.availability-zone-region-mismatch",
                severity: "error",
                title:
                  "Availability Zone does not belong to the selected Region",
                beginnerExplanation:
                  "Choose a standard Availability Zone in this architecture's AWS Region.",
                technicalExplanation:
                  "The bounded catalog accepts standard Region AZ names only; Local Zones, Wavelength Zones, and inferred live inventories are unsupported.",
                affected: [nodeConfigurationLocation(node, index, "zoneName")],
              }),
            );
          }
        }
      }

      for (const { node, index } of vpcs) {
        if (
          literalBoolean(
            node.semantic.configuration.values,
            "enableDnsHostnames",
          ) === true &&
          literalBoolean(
            node.semantic.configuration.values,
            "enableDnsSupport",
          ) === false
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.vpc-dns-hostnames-require-support",
              severity: "error",
              title: "VPC DNS hostnames require DNS support",
              beginnerExplanation:
                "Enable DNS support before enabling DNS hostnames, or explicitly disable DNS hostnames.",
              technicalExplanation:
                "AWS requires enableDnsSupport=true when enableDnsHostnames=true. Declared DNS settings are never changed automatically.",
              affected: [
                nodeConfigurationLocation(node, index, "enableDnsHostnames"),
                nodeConfigurationLocation(node, index, "enableDnsSupport"),
              ],
            }),
          );
        }
        const cidr = literalString(
          node.semantic.configuration.values,
          "cidrBlock",
        );
        if (parseIpv4Cidr(cidr, 16, 28) === undefined) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.vpc-cidr-invalid",
              severity: "error",
              title: "VPC IPv4 CIDR block is invalid",
              beginnerExplanation:
                "Use a canonical IPv4 network between /16 and /28 for this VPC.",
              technicalExplanation:
                "The bounded VPC model requires a canonical AWS-supported primary IPv4 CIDR block and does not infer normalization.",
              affected: [nodeConfigurationLocation(node, index, "cidrBlock")],
            }),
          );
        }
      }

      const validSubnets = indexedNodes(document).flatMap((entry) => {
        if (entry.node.semantic.serviceType !== SUBNET) {
          return [];
        }
        const cidrValue = literalString(
          entry.node.semantic.configuration.values,
          "cidrBlock",
        );
        const cidr = parseIpv4Cidr(cidrValue, 16, 28);
        if (cidr === undefined) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.subnet-cidr-invalid",
              severity: "error",
              title: "Subnet IPv4 CIDR block is invalid",
              beginnerExplanation:
                "Use a canonical IPv4 subnet network between /16 and /28.",
              technicalExplanation:
                "The bounded subnet model accepts one canonical AWS-supported IPv4 CIDR block.",
              affected: [
                nodeConfigurationLocation(entry.node, entry.index, "cidrBlock"),
              ],
            }),
          );
          return [];
        }
        const vpcId = vpcIdForNode(entry.node, nodes, document);
        const vpc = vpcId === undefined ? undefined : nodes.get(vpcId);
        const vpcCidr =
          vpc === undefined
            ? undefined
            : parseIpv4Cidr(
                literalString(
                  vpc.node.semantic.configuration.values,
                  "cidrBlock",
                ),
                16,
                28,
              );
        if (
          vpcCidr !== undefined &&
          (cidr.start < vpcCidr.start || cidr.end > vpcCidr.end)
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.subnet-cidr-outside-vpc",
              severity: "error",
              title: "Subnet CIDR falls outside its VPC",
              beginnerExplanation:
                "Choose a subnet range contained within the parent VPC range.",
              technicalExplanation:
                "AWS requires every subnet IPv4 CIDR to be equal to or a subset of an associated VPC CIDR.",
              affected: [
                nodeConfigurationLocation(entry.node, entry.index, "cidrBlock"),
              ],
            }),
          );
        }
        return [{ ...entry, cidr, vpcId }];
      });

      for (const [leftIndex, left] of validSubnets.entries()) {
        if (left.vpcId === undefined) {
          continue;
        }
        for (const right of validSubnets.slice(leftIndex + 1)) {
          if (
            right.vpcId !== left.vpcId ||
            left.cidr.end < right.cidr.start ||
            right.cidr.end < left.cidr.start
          ) {
            continue;
          }
          findings.push(
            finding(descriptor, {
              code: "aws.validation.subnet-cidr-overlap",
              severity: "error",
              title: "Subnets in one VPC have overlapping CIDR blocks",
              beginnerExplanation:
                "Give these subnets separate, non-overlapping address ranges.",
              technicalExplanation:
                "AWS rejects overlapping subnet CIDR blocks within one VPC.",
              affected: [
                nodeConfigurationLocation(left.node, left.index, "cidrBlock"),
                nodeConfigurationLocation(right.node, right.index, "cidrBlock"),
              ],
            }),
          );
        }
      }

      const zonesByVpc = new Map<string, Set<string>>();
      for (const { node } of validSubnets) {
        const vpcId = vpcIdForNode(node, nodes, document);
        const zoneId = availabilityZoneIdForSubnet(node, nodes);
        if (vpcId === undefined || zoneId === undefined) {
          continue;
        }
        const zones = zonesByVpc.get(vpcId) ?? new Set<string>();
        zones.add(zoneId);
        zonesByVpc.set(vpcId, zones);
      }
      for (const { node, index } of vpcs) {
        const zones = zonesByVpc.get(String(node.id));
        if (zones !== undefined && zones.size < 2) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.vpc-single-availability-zone",
              severity: isLowerEnvironment(context.environment)
                ? "recommendation"
                : "warning",
              title: "VPC subnet placement uses only one Availability Zone",
              beginnerExplanation:
                "Add a second Availability Zone when the workload needs to continue through a zone failure.",
              technicalExplanation:
                "The VPC has modeled subnets in fewer than two distinct Availability Zone boundaries; this is advisory and no topology is generated automatically.",
              affected: [nodeLocation(node, index)],
            }),
          );
        }
      }

      return findings;
    },
  });
}

function relationshipEdges(
  document: AwsValidationDocument,
  relationship: string,
): readonly IndexedEdge[] {
  return indexedEdges(document).filter(
    ({ edge }) => edge.semantic.relationshipType === relationship,
  );
}

export function createNetworkRoutingRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = networkRoutingValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const nodes = nodeMap(document);
      const findings: ValidationFindingCandidate[] = [];
      const associationOwners = relationshipEdges(
        document,
        RELATIONSHIPS.routeTableOwnsSubnetAssociation,
      );
      const associationTargets = relationshipEdges(
        document,
        RELATIONSHIPS.routeTableAssociationTargetsSubnet,
      );
      const routeOwners = relationshipEdges(
        document,
        RELATIONSHIPS.routeTableOwnsRoute,
      );
      const routeTargets = [
        ...relationshipEdges(
          document,
          RELATIONSHIPS.routeTargetsInternetGateway,
        ),
        ...relationshipEdges(document, RELATIONSHIPS.routeTargetsNatGateway),
      ];
      const internetGatewayAttachments = relationshipEdges(
        document,
        RELATIONSHIPS.vpcAttachesInternetGateway,
      );

      for (const { node, index } of indexedNodes(document)) {
        if (node.semantic.serviceType === ROUTE_TABLE_ASSOCIATION) {
          const owners = associationOwners.filter(
            ({ edge }) => edge.semantic.source.nodeId === node.id,
          );
          const targets = associationTargets.filter(
            ({ edge }) => edge.semantic.source.nodeId === node.id,
          );
          if (owners.length !== 1 || targets.length !== 1) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.route-table-association-incomplete",
                severity: "error",
                title:
                  "Subnet association needs one route table and one subnet",
                beginnerExplanation:
                  "Choose exactly one route table and one subnet for this association.",
                technicalExplanation:
                  "A canonical association configuration requires one owner edge to aws.ec2.route-table and one target edge to aws.ec2.subnet.",
                affected: [nodeLocation(node, index)],
              }),
            );
          } else {
            const ownerNode = nodes.get(
              String(owners[0]?.edge.semantic.target.nodeId),
            )?.node;
            const targetNode = nodes.get(
              String(targets[0]?.edge.semantic.target.nodeId),
            )?.node;
            if (
              ownerNode?.semantic.serviceType !== ROUTE_TABLE ||
              targetNode?.semantic.serviceType !== SUBNET ||
              vpcIdForNode(ownerNode, nodes, document) === undefined ||
              vpcIdForNode(ownerNode, nodes, document) !==
                vpcIdForNode(targetNode, nodes, document)
            ) {
              findings.push(
                finding(descriptor, {
                  code: "aws.validation.route-table-association-vpc-mismatch",
                  severity: "error",
                  title: "Route table and subnet must belong to the same VPC",
                  beginnerExplanation:
                    "Associate this subnet with a route table from its own VPC.",
                  technicalExplanation:
                    "The route-table owner and subnet target do not resolve to one exact VPC ancestry closure.",
                  affected: affectedEdges([...owners, ...targets]),
                }),
              );
            }
          }
        }

        if (node.semantic.serviceType === ROUTE) {
          const owners = routeOwners.filter(
            ({ edge }) => edge.semantic.source.nodeId === node.id,
          );
          const targets = routeTargets.filter(
            ({ edge }) => edge.semantic.source.nodeId === node.id,
          );
          if (owners.length !== 1 || targets.length !== 1) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.route-owner-target-incomplete",
                severity: "error",
                title: "Route needs one route table and one supported target",
                beginnerExplanation:
                  "Choose one owning route table and either its VPC internet gateway or a supported NAT gateway.",
                technicalExplanation:
                  "A canonical route configuration requires one owner edge and exactly one reviewed IGW or NAT target edge.",
                affected: [nodeLocation(node, index)],
              }),
            );
          } else {
            const owner = nodes.get(
              String(owners[0]?.edge.semantic.target.nodeId),
            )?.node;
            const target = nodes.get(
              String(targets[0]?.edge.semantic.target.nodeId),
            )?.node;
            const targetRelationship =
              targets[0]?.edge.semantic.relationshipType;
            const expectedTargetService =
              targetRelationship === RELATIONSHIPS.routeTargetsInternetGateway
                ? INTERNET_GATEWAY
                : targetRelationship === RELATIONSHIPS.routeTargetsNatGateway
                  ? NAT_GATEWAY
                  : undefined;
            if (target?.semantic.serviceType !== expectedTargetService) {
              findings.push(
                finding(descriptor, {
                  code: "aws.validation.route-target-service-mismatch",
                  severity: "error",
                  title:
                    "Route target relationship does not match the gateway type",
                  beginnerExplanation:
                    "Reconnect this route using the internet-gateway or NAT-gateway target that matches the selected resource.",
                  technicalExplanation:
                    "The internet-gateway relationship must target aws.ec2.internet-gateway and the NAT-gateway relationship must target aws.ec2.nat-gateway.",
                  affected: affectedEdges(targets),
                }),
              );
            } else if (
              owner?.semantic.serviceType !== ROUTE_TABLE ||
              vpcIdForNode(owner, nodes, document) === undefined ||
              vpcIdForNode(owner, nodes, document) !==
                (target === undefined
                  ? undefined
                  : vpcIdForNode(target, nodes, document))
            ) {
              findings.push(
                finding(descriptor, {
                  code: "aws.validation.route-target-vpc-mismatch",
                  severity: "error",
                  title: "Route target must belong to the route table VPC",
                  beginnerExplanation:
                    "Choose a gateway from the same VPC as this route table.",
                  technicalExplanation:
                    "The route owner and reviewed target do not resolve to one exact VPC ancestry closure.",
                  affected: affectedEdges([...owners, ...targets]),
                }),
              );
            }
          }
          if (
            parseIpv4Cidr(
              literalString(
                node.semantic.configuration.values,
                "destinationIpv4Cidr",
              ),
            ) === undefined
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.route-destination-invalid",
                severity: "error",
                title: "Route destination is not a canonical IPv4 CIDR block",
                beginnerExplanation:
                  "Enter a valid destination such as 0.0.0.0/0.",
                technicalExplanation:
                  "The bounded route model supports one canonical IPv4 CIDR destination and does not normalize ambiguous input.",
                affected: [
                  nodeConfigurationLocation(node, index, "destinationIpv4Cidr"),
                ],
              }),
            );
          }
        }

        if (node.semantic.serviceType === NAT_GATEWAY) {
          const parentId = node.semantic.parent?.nodeId;
          const parent =
            parentId === undefined
              ? undefined
              : nodes.get(String(parentId))?.node;
          if (
            parent?.semantic.serviceType !== SUBNET ||
            literalString(
              parent.semantic.configuration.values,
              "accessTier",
            ) !== "public" ||
            literalString(
              node.semantic.configuration.values,
              "connectivityType",
            ) !== "public" ||
            literalString(
              node.semantic.configuration.values,
              "availabilityMode",
            ) !== "zonal"
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.nat-gateway-mode-unsupported",
                severity: "error",
                title: "NAT gateway is outside the supported zonal public mode",
                beginnerExplanation:
                  "Place a public, zonal NAT gateway in a public subnet. Regional and private NAT modes are not supported yet.",
                technicalExplanation:
                  "Prompt 41 models only availabilityMode=zonal and connectivityType=public with exact public-subnet placement.",
                affected: [nodeLocation(node, index)],
              }),
            );
          }
          findings.push(
            finding(descriptor, {
              code: "aws.validation.nat-gateway-endpoint-choice",
              severity: "cost-warning",
              title:
                "Review NAT gateway cost and gateway endpoint alternatives",
              beginnerExplanation:
                "NAT gateways have recurring and data-processing charges. S3 and DynamoDB gateway endpoints may avoid this path for those services.",
              technicalExplanation:
                "This zonal NAT gateway has hourly and per-data processing cost; same-Region S3/DynamoDB gateway endpoints have no additional endpoint charge and use managed prefix-list routes.",
              affected: [nodeLocation(node, index)],
            }),
          );
        }
      }

      const subnetAssociationTargets = new Map<string, IndexedEdge[]>();
      for (const target of associationTargets) {
        const source = nodes.get(String(target.edge.semantic.source.nodeId));
        if (source?.node.semantic.serviceType !== ROUTE_TABLE_ASSOCIATION) {
          continue;
        }
        const key = String(target.edge.semantic.target.nodeId);
        const entries = subnetAssociationTargets.get(key) ?? [];
        entries.push(target);
        subnetAssociationTargets.set(key, entries);
      }
      for (const { node, index } of indexedNodes(document).filter(
        ({ node }) => node.semantic.serviceType === SUBNET,
      )) {
        const associations =
          subnetAssociationTargets.get(String(node.id)) ?? [];
        if (associations.length !== 1) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.subnet-route-table-association-invalid",
              severity: "error",
              title: "Subnet needs one explicit route table association",
              beginnerExplanation:
                "Choose exactly one route table. Implicit use of the VPC main route table is not supported in this catalog.",
              technicalExplanation:
                "The bounded model requires one graph-backed aws.ec2.route-table-association target per subnet.",
              affected:
                associations.length === 0
                  ? [nodeLocation(node, index)]
                  : affectedEdges(associations),
            }),
          );
          continue;
        }
        const associationNodeId = String(
          associations[0]?.edge.semantic.source.nodeId,
        );
        const owner = associationOwners.find(
          ({ edge }) =>
            String(edge.semantic.source.nodeId) === associationNodeId,
        );
        const tableId = String(owner?.edge.semantic.target.nodeId ?? "");
        const ownedRoutes = routeOwners
          .filter(({ edge }) => String(edge.semantic.target.nodeId) === tableId)
          .flatMap(({ edge }) => {
            const routeNode = nodes.get(String(edge.semantic.source.nodeId));
            return routeNode?.node.semantic.serviceType === ROUTE
              ? [routeNode]
              : [];
          });
        const defaultRoutes = ownedRoutes.filter(
          ({ node: route }) =>
            literalString(
              route.semantic.configuration.values,
              "destinationIpv4Cidr",
            ) === "0.0.0.0/0",
        );
        const defaultTargetEdges = defaultRoutes.flatMap(({ node: route }) =>
          routeTargets.filter(
            ({ edge }) => edge.semantic.source.nodeId === route.id,
          ),
        );
        const accessTier = literalString(
          node.semantic.configuration.values,
          "accessTier",
        );
        const internetTargets = defaultTargetEdges.filter(
          ({ edge }) =>
            edge.semantic.relationshipType ===
            RELATIONSHIPS.routeTargetsInternetGateway,
        );
        const subnetVpcId = vpcIdForNode(node, nodes, document);
        const attachedInternetGateways = internetGatewayAttachments.filter(
          ({ edge }) => {
            if (
              subnetVpcId === undefined ||
              String(edge.semantic.source.nodeId) !== subnetVpcId
            ) {
              return false;
            }
            return (
              nodes.get(String(edge.semantic.target.nodeId))?.node.semantic
                .serviceType === INTERNET_GATEWAY
            );
          },
        );
        if (
          accessTier === "public" &&
          subnetVpcId !== undefined &&
          attachedInternetGateways.length === 0
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.public-subnet-internet-gateway-missing",
              severity: "error",
              title: "Public subnet VPC has no attached internet gateway",
              beginnerExplanation:
                "Attach one internet gateway to this VPC before adding the public subnet's default route.",
              technicalExplanation:
                "The subnet resolves to a VPC with no exact aws.ec2.vpc-attaches-internet-gateway relationship; validation never invents the gateway or attachment.",
              affected: [nodeConfigurationLocation(node, index, "accessTier")],
            }),
          );
        } else if (accessTier === "public" && internetTargets.length !== 1) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.public-subnet-internet-route-invalid",
              severity: "error",
              title:
                "Public subnet needs one default route to its internet gateway",
              beginnerExplanation:
                "Add one 0.0.0.0/0 route from this subnet's route table to the VPC internet gateway.",
              technicalExplanation:
                "Public intent is defined by one exact default IPv4 route to an IGW attached to the same VPC; mapPublicIpOnLaunch alone is not routing.",
              affected: [nodeConfigurationLocation(node, index, "accessTier")],
            }),
          );
        }
        if (
          accessTier === "private" &&
          literalBoolean(
            node.semantic.configuration.values,
            "mapPublicIpOnLaunch",
          ) === true
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.private-subnet-public-ip-assignment",
              severity: "cost-warning",
              title: "Private subnet auto-assigns public IPv4 addresses",
              beginnerExplanation:
                "Turn off automatic public IPv4 assignment for private workloads; it adds address cost and does not provide internet access without public routing.",
              technicalExplanation:
                "accessTier=private conflicts with mapPublicIpOnLaunch=true; the address alone grants no reachability, but it creates cost and future exposure risk if routing changes.",
              affected: [
                nodeConfigurationLocation(node, index, "mapPublicIpOnLaunch"),
              ],
            }),
          );
        }
        if (accessTier === "private" && internetTargets.length > 0) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.private-subnet-direct-internet-route",
              severity: "error",
              title:
                "Private subnet must not route directly to an internet gateway",
              beginnerExplanation:
                "Remove the direct internet-gateway route. Use a NAT gateway for outbound internet access or a gateway endpoint for S3 and DynamoDB.",
              technicalExplanation:
                "A direct IGW default route contradicts accessTier=private; private egress must remain an explicit NAT or endpoint choice.",
              affected: affectedEdges(internetTargets),
            }),
          );
        }

        for (const natTarget of defaultTargetEdges.filter(
          ({ edge }) =>
            edge.semantic.relationshipType ===
            RELATIONSHIPS.routeTargetsNatGateway,
        )) {
          const nat = nodes.get(String(natTarget.edge.semantic.target.nodeId));
          const natSubnetId = nat?.node.semantic.parent?.nodeId;
          const natSubnet =
            natSubnetId === undefined
              ? undefined
              : nodes.get(String(natSubnetId))?.node;
          const sourceAz = availabilityZoneIdForSubnet(node, nodes);
          const natAz =
            natSubnet === undefined
              ? undefined
              : availabilityZoneIdForSubnet(natSubnet, nodes);
          if (
            sourceAz !== undefined &&
            natAz !== undefined &&
            sourceAz !== natAz
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.nat-gateway-cross-az-route",
                severity: "cost-warning",
                title:
                  "Private subnet routes through a NAT gateway in another AZ",
                beginnerExplanation:
                  "For stronger resilience and lower cross-zone transfer risk, use a NAT gateway in the same Availability Zone when that tradeoff is appropriate.",
                technicalExplanation:
                  "A zonal NAT gateway shared across AZs can add cross-AZ data transfer cost and creates an AZ dependency; no extra NAT is generated automatically because that also adds hourly cost.",
                affected: [edgeLocation(natTarget.edge, natTarget.index)],
              }),
            );
          }
        }
      }

      const routesByTableAndDestination = new Map<string, IndexedNode[]>();
      for (const owner of routeOwners) {
        const route = nodes.get(String(owner.edge.semantic.source.nodeId));
        if (route?.node.semantic.serviceType !== ROUTE) {
          continue;
        }
        const destination = literalString(
          route.node.semantic.configuration.values,
          "destinationIpv4Cidr",
        );
        if (destination === undefined) {
          continue;
        }
        const key = `${String(owner.edge.semantic.target.nodeId)}\u0000${destination}`;
        const entries = routesByTableAndDestination.get(key) ?? [];
        entries.push(route);
        routesByTableAndDestination.set(key, entries);
      }
      for (const duplicates of routesByTableAndDestination.values()) {
        if (duplicates.length < 2) {
          continue;
        }
        findings.push(
          finding(descriptor, {
            code: "aws.validation.route-destination-duplicate",
            severity: "error",
            title: "Route table has duplicate destinations",
            beginnerExplanation:
              "Keep one route for this exact destination in the route table.",
            technicalExplanation:
              "Canonical route ownership permits only one route node per route-table and destinationIpv4Cidr pair.",
            affected: duplicates.map(({ node, index }) =>
              nodeConfigurationLocation(node, index, "destinationIpv4Cidr"),
            ),
          }),
        );
      }

      const endpointAssociations = relationshipEdges(
        document,
        RELATIONSHIPS.gatewayEndpointAssociatesRouteTable,
      );
      const endpointPolicies = relationshipEdges(
        document,
        RELATIONSHIPS.gatewayEndpointOwnsPolicy,
      );
      const endpointByTableAndService = new Map<string, IndexedEdge[]>();
      for (const { node, index } of indexedNodes(document).filter(
        ({ node }) => node.semantic.serviceType === GATEWAY_ENDPOINT,
      )) {
        const service = literalString(
          node.semantic.configuration.values,
          "service",
        );
        const endpointType = literalString(
          node.semantic.configuration.values,
          "endpointType",
        );
        const policyMode = literalString(
          node.semantic.configuration.values,
          "policyMode",
        );
        if (
          (service !== "s3" && service !== "dynamodb") ||
          endpointType !== "Gateway" ||
          (policyMode !== "full-access" && policyMode !== "restricted")
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.gateway-endpoint-mode-unsupported",
              severity: "error",
              title: "VPC endpoint is outside the supported gateway mode",
              beginnerExplanation:
                "Choose an S3 or DynamoDB Gateway endpoint. Interface endpoints and other endpoint modes are not supported here.",
              technicalExplanation:
                "The bounded contract accepts endpointType=Gateway, service=s3|dynamodb, and an explicit full-access or restricted policy mode.",
              affected: [nodeLocation(node, index)],
            }),
          );
        }
        const policyEdges = endpointPolicies.filter(
          ({ edge }) => edge.semantic.target.nodeId === node.id,
        );
        const canonicalPolicyEdges = policyEdges.filter(({ edge }) => {
          const policy = nodes.get(String(edge.semantic.source.nodeId))?.node;
          return (
            policy?.semantic.serviceType === IAM_POLICY_DOCUMENT &&
            policy.semantic.parent?.nodeId === node.id &&
            policy.semantic.parent.relationshipType ===
              RELATIONSHIPS.gatewayEndpointOwnsPolicy &&
            policy.semantic.lifecycle.ownership === "user"
          );
        });
        const policyModeMismatch =
          (policyMode === "restricted" &&
            (policyEdges.length !== 1 || canonicalPolicyEdges.length !== 1)) ||
          (policyMode === "full-access" && policyEdges.length !== 0);
        if (policyModeMismatch) {
          const restricted = policyMode === "restricted";
          findings.push(
            finding(descriptor, {
              code: "aws.validation.gateway-endpoint-policy-mode-mismatch",
              severity: "security-error",
              title: restricted
                ? "Restricted gateway endpoint needs one owned policy"
                : "Full-access gateway endpoint must not own a policy",
              beginnerExplanation: restricted
                ? "Connect exactly one reviewed endpoint policy before using restricted access."
                : "Remove the endpoint-policy connection or change to restricted access after reviewing that policy.",
              technicalExplanation:
                "policyMode=restricted requires exactly one user-owned aws.iam.policy-document through aws.ec2.gateway-endpoint-owns-policy; policyMode=full-access requires no endpoint-policy edge.",
              affected: [
                nodeConfigurationLocation(node, index, "policyMode"),
                ...affectedEdges(policyEdges),
              ],
            }),
          );
        }
        const associations = endpointAssociations.filter(
          ({ edge }) => edge.semantic.source.nodeId === node.id,
        );
        if (associations.length === 0) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.gateway-endpoint-route-table-missing",
              severity: "error",
              title: "Gateway endpoint needs at least one route table",
              beginnerExplanation:
                "Select the route tables whose subnets should use this endpoint.",
              technicalExplanation:
                "AWS adds and owns a managed prefix-list route only for route tables explicitly associated with the gateway endpoint.",
              affected: [nodeLocation(node, index)],
            }),
          );
        }
        for (const association of associations) {
          const table = nodes.get(
            String(association.edge.semantic.target.nodeId),
          );
          if (
            table?.node.semantic.serviceType !== ROUTE_TABLE ||
            vpcIdForNode(node, nodes, document) === undefined ||
            vpcIdForNode(node, nodes, document) !==
              vpcIdForNode(table.node, nodes, document)
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.gateway-endpoint-route-table-vpc-mismatch",
                severity: "error",
                title: "Gateway endpoint route table belongs to another VPC",
                beginnerExplanation:
                  "Select route tables from the same VPC as this gateway endpoint.",
                technicalExplanation:
                  "Gateway endpoint and associated route table must resolve to one exact VPC ancestry closure.",
                affected: [edgeLocation(association.edge, association.index)],
              }),
            );
          }
          if (service !== undefined) {
            const key = `${String(association.edge.semantic.target.nodeId)}\u0000${service}`;
            const entries = endpointByTableAndService.get(key) ?? [];
            entries.push(association);
            endpointByTableAndService.set(key, entries);
          }
        }
      }
      for (const duplicates of endpointByTableAndService.values()) {
        if (duplicates.length < 2) {
          continue;
        }
        findings.push(
          finding(descriptor, {
            code: "aws.validation.gateway-endpoint-service-duplicate",
            severity: "error",
            title:
              "Route table has duplicate gateway endpoints for one service",
            beginnerExplanation:
              "Keep one S3 and one DynamoDB gateway-endpoint route per route table.",
            technicalExplanation:
              "AWS does not allow multiple endpoint routes for the same S3 or DynamoDB service in one route table.",
            affected: affectedEdges(duplicates),
          }),
        );
      }

      return findings;
    },
  });
}

function securityRuleKey(node: AwsValidationNode): string {
  const values = node.semantic.configuration.values;
  return JSON.stringify({
    direction: node.semantic.serviceType,
    protocol: literalString(values, "protocol"),
    fromPort: literalInteger(values, "fromPort"),
    toPort: literalInteger(values, "toPort"),
    peer:
      literalString(values, "sourceIpv4Cidr") ??
      literalString(values, "destinationIpv4Cidr"),
  });
}

function portRangeIsInvalid(
  protocol: string | undefined,
  fromPort: number | undefined,
  toPort: number | undefined,
): boolean {
  if (protocol === "-1") {
    return !(
      (fromPort === undefined && toPort === undefined) ||
      (fromPort === -1 && toPort === -1)
    );
  }
  if (protocol === "tcp" || protocol === "udp") {
    return (
      fromPort === undefined ||
      toPort === undefined ||
      fromPort < 0 ||
      toPort > 65_535 ||
      fromPort > toPort
    );
  }
  if (protocol === "icmp") {
    return (
      fromPort === undefined ||
      toPort === undefined ||
      fromPort < -1 ||
      fromPort > 255 ||
      toPort < -1 ||
      toPort > 255 ||
      (fromPort === -1 && toPort !== -1)
    );
  }
  return true;
}

export function createSecurityGroupPolicyRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  const descriptor = securityGroupPolicyValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const nodes = nodeMap(document);
      const findings: ValidationFindingCandidate[] = [];
      const ownerRelationships: readonly string[] = [
        RELATIONSHIPS.securityGroupOwnsIngressRule,
        RELATIONSHIPS.securityGroupOwnsEgressRule,
      ] as const;
      const ownerEdges = indexedEdges(document).filter(({ edge }) =>
        ownerRelationships.includes(String(edge.semantic.relationshipType)),
      );
      const keysByOwner = new Map<string, Map<string, IndexedNode>>();
      const namesByVpc = new Map<string, IndexedNode>();

      for (const entry of indexedNodes(document)) {
        const { node, index } = entry;
        const ingress =
          node.semantic.serviceType === SECURITY_GROUP_INGRESS_RULE;
        const egress = node.semantic.serviceType === SECURITY_GROUP_EGRESS_RULE;
        const group = node.semantic.serviceType === SECURITY_GROUP;
        if (group || ingress || egress) {
          const description = literalString(
            node.semantic.configuration.values,
            "description",
          );
          if (
            description === undefined ||
            description.length < 1 ||
            description.length > 255 ||
            !new RegExp(
              group
                ? securityGroupDescriptionPattern
                : securityGroupRuleDescriptionPattern,
              "u",
            ).test(description)
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.security-group-description-invalid",
                severity: "error",
                title: "Use a supported security group description",
                beginnerExplanation:
                  "Use 1-255 AWS-supported ASCII letters, digits, spaces or punctuation without line breaks. Ampersands are allowed only for the group, not its rules.",
                technicalExplanation:
                  "Group and rule descriptions use different AWS character sets. Correct the saved value explicitly; export never sanitizes it.",
                affected: [
                  nodeConfigurationLocation(node, index, "description"),
                ],
              }),
            );
          }
        }
        if (group) {
          const groupName = literalString(
            node.semantic.configuration.values,
            "groupName",
          );
          const associations = indexedEdges(document).filter(
            ({ edge }) =>
              edge.semantic.relationshipType ===
                RELATIONSHIPS.vpcAssociatesSecurityGroup &&
              edge.semantic.target.nodeId === node.id,
          );
          const vpc =
            associations.length === 1
              ? nodes.get(String(associations[0]?.edge.semantic.source.nodeId))
              : undefined;
          if (groupName && vpc?.node.semantic.serviceType === VPC) {
            const key =
              String(vpc.node.id) + "\u0000" + groupName.toLowerCase();
            const previous = namesByVpc.get(key);
            if (previous) {
              findings.push(
                finding(descriptor, {
                  code: "aws.validation.security-group-name-duplicate",
                  severity: "error",
                  title: "Security group names must be unique within a VPC",
                  beginnerExplanation:
                    "Give each security group in this VPC a different name. Changing letter case does not make a name unique.",
                  technicalExplanation:
                    "AWS compares security group names case-insensitively within the associated VPC. Names and associations are never rewritten automatically.",
                  affected: [
                    nodeConfigurationLocation(
                      previous.node,
                      previous.index,
                      "groupName",
                    ),
                    nodeConfigurationLocation(node, index, "groupName"),
                  ],
                }),
              );
            } else namesByVpc.set(key, entry);
          }
        }
        if (!ingress && !egress) {
          continue;
        }
        const expectedRelationship = ingress
          ? RELATIONSHIPS.securityGroupOwnsIngressRule
          : RELATIONSHIPS.securityGroupOwnsEgressRule;
        const owners = ownerEdges.filter(
          ({ edge }) => edge.semantic.source.nodeId === node.id,
        );
        const owner =
          owners.length === 1
            ? nodes.get(String(owners[0]?.edge.semantic.target.nodeId))
            : undefined;
        if (
          owners.length !== 1 ||
          owners[0]?.edge.semantic.relationshipType !== expectedRelationship ||
          owner?.node.semantic.serviceType !== SECURITY_GROUP
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.security-group-rule-owner-invalid",
              severity: "security-error",
              title: "Security group rule has an invalid owner slot",
              beginnerExplanation:
                "Place this rule in exactly one matching inbound or outbound section of a security group.",
              technicalExplanation:
                "Ingress and egress configurations require one exact direction-specific owner edge; security groups remain associated policies, not containers for workloads.",
              affected:
                owners.length === 0
                  ? [nodeLocation(node, index)]
                  : affectedEdges(owners),
            }),
          );
        } else {
          const ownerId = String(owner.node.id);
          const key = securityRuleKey(node);
          const keys =
            keysByOwner.get(ownerId) ?? new Map<string, IndexedNode>();
          const previous = keys.get(key);
          if (previous !== undefined) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.security-group-rule-duplicate",
                severity: "warning",
                title: "Security group contains an equivalent duplicate rule",
                beginnerExplanation:
                  "Remove one duplicate so the policy is easier to review.",
                technicalExplanation:
                  "Direction, protocol, port range, and CIDR normalize to an existing rule in the same security group.",
                affected: [
                  nodeLocation(previous.node, previous.index),
                  nodeLocation(node, index),
                ],
              }),
            );
          } else {
            keys.set(key, entry);
            keysByOwner.set(ownerId, keys);
          }
        }

        const values = node.semantic.configuration.values;
        const protocol = literalString(values, "protocol");
        const fromPort = literalInteger(values, "fromPort");
        const toPort = literalInteger(values, "toPort");
        if (portRangeIsInvalid(protocol, fromPort, toPort)) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.security-group-port-range-invalid",
              severity: "error",
              title: "Security group protocol and port range do not agree",
              beginnerExplanation:
                "Choose a valid TCP, UDP, ICMP, or all-traffic rule with the matching port fields.",
              technicalExplanation:
                "TCP/UDP require an ordered 0-65535 range, ICMP uses bounded type/code values, and all traffic must not carry a scoped port range.",
              affected: [nodeConfigurationLocation(node, index, "fromPort")],
            }),
          );
        }
        const cidrKey = ingress ? "sourceIpv4Cidr" : "destinationIpv4Cidr";
        const cidr = literalString(values, cidrKey);
        if (parseIpv4Cidr(cidr) === undefined) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.security-group-cidr-invalid",
              severity: "error",
              title: "Security group rule CIDR is invalid",
              beginnerExplanation:
                "Enter a canonical IPv4 source or destination range.",
              technicalExplanation:
                "The bounded rule model supports canonical IPv4 CIDR peers only; IPv6, prefix-list, and security-group peers are explicit unsupported modes.",
              affected: [nodeConfigurationLocation(node, index, cidrKey)],
            }),
          );
        }
        if (ingress && cidr === "0.0.0.0/0") {
          const includesAdminPort =
            fromPort !== undefined &&
            toPort !== undefined &&
            ((fromPort <= 22 && toPort >= 22) ||
              (fromPort <= 3389 && toPort >= 3389));
          if (protocol === "-1" || includesAdminPort) {
            findings.push(
              finding(descriptor, {
                code: includesAdminPort
                  ? "aws.validation.security-group-admin-ingress-open"
                  : "aws.validation.security-group-all-ingress-open",
                severity: "security-error",
                title: includesAdminPort
                  ? "Administrative port is open to every IPv4 address"
                  : "All inbound traffic is open to every IPv4 address",
                beginnerExplanation:
                  "Limit this inbound rule to the specific sources and ports that need access.",
                technicalExplanation:
                  "An ingress peer of 0.0.0.0/0 combined with all protocols or SSH/RDP exposure violates the bounded least-access policy.",
                affected: [nodeConfigurationLocation(node, index, cidrKey)],
              }),
            );
          } else {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.security-group-broad-ingress",
                severity: isLowerEnvironment(context.environment)
                  ? "recommendation"
                  : "warning",
                title: "Inbound rule accepts traffic from every IPv4 address",
                beginnerExplanation:
                  "Confirm that this port must be public, and narrow the source range when possible.",
                technicalExplanation:
                  "AWS recommends authorizing only the specific source ranges required; broad web ingress can be intentional but requires review.",
                affected: [nodeConfigurationLocation(node, index, cidrKey)],
              }),
            );
          }
        }
        if (egress && cidr === "0.0.0.0/0" && protocol === "-1") {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.security-group-broad-egress",
              severity: isLowerEnvironment(context.environment)
                ? "recommendation"
                : "warning",
              title: "Security group allows all outbound IPv4 traffic",
              beginnerExplanation:
                "Confirm that the workload needs unrestricted outbound access, or narrow the destination and protocol.",
              technicalExplanation:
                "Stateful security groups permit return traffic automatically; unrestricted egress is nonblocking but should be an explicit reviewed policy choice.",
              affected: [nodeConfigurationLocation(node, index, cidrKey)],
            }),
          );
        }
      }

      return findings;
    },
  });
}

type LambdaVpcEgressRequirement =
  "none" | "internet" | "s3" | "dynamodb" | "s3-and-dynamodb";

function lambdaVpcEgressRequirement(
  node: AwsValidationNode,
): LambdaVpcEgressRequirement | undefined {
  const value = literalString(
    node.semantic.configuration.values,
    "egressRequirement",
  );
  return value === "none" ||
    value === "internet" ||
    value === "s3" ||
    value === "dynamodb" ||
    value === "s3-and-dynamodb"
    ? value
    : undefined;
}

function routeTableIdForSubnet(
  document: AwsValidationDocument,
  nodes: ReadonlyMap<string, IndexedNode>,
  subnetId: string,
): string | undefined {
  const targets = relationshipEdges(
    document,
    RELATIONSHIPS.routeTableAssociationTargetsSubnet,
  ).filter(({ edge }) => String(edge.semantic.target.nodeId) === subnetId);
  if (targets.length !== 1) {
    return undefined;
  }
  const associationId = String(targets[0]?.edge.semantic.source.nodeId);
  const owners = relationshipEdges(
    document,
    RELATIONSHIPS.routeTableOwnsSubnetAssociation,
  ).filter(({ edge }) => String(edge.semantic.source.nodeId) === associationId);
  if (owners.length !== 1) {
    return undefined;
  }
  const routeTableId = String(owners[0]?.edge.semantic.target.nodeId);
  return nodes.get(routeTableId)?.node.semantic.serviceType === ROUTE_TABLE
    ? routeTableId
    : undefined;
}

function routeTableHasValidInternetGatewayDefault(
  document: AwsValidationDocument,
  nodes: ReadonlyMap<string, IndexedNode>,
  routeTableId: string,
  vpcId: string,
): boolean {
  const routeTable = nodes.get(routeTableId)?.node;
  if (
    routeTable?.semantic.serviceType !== ROUTE_TABLE ||
    vpcIdForNode(routeTable, nodes, document) !== vpcId
  ) {
    return false;
  }
  const defaultRouteIds = new Set(
    relationshipEdges(document, RELATIONSHIPS.routeTableOwnsRoute)
      .filter(
        ({ edge }) => String(edge.semantic.target.nodeId) === routeTableId,
      )
      .flatMap(({ edge }) => {
        const route = nodes.get(String(edge.semantic.source.nodeId))?.node;
        return route?.semantic.serviceType === ROUTE &&
          literalString(
            route.semantic.configuration.values,
            "destinationIpv4Cidr",
          ) === "0.0.0.0/0"
          ? [String(route.id)]
          : [];
      }),
  );
  return relationshipEdges(
    document,
    RELATIONSHIPS.routeTargetsInternetGateway,
  ).some(({ edge }) => {
    if (!defaultRouteIds.has(String(edge.semantic.source.nodeId))) {
      return false;
    }
    const gateway = nodes.get(String(edge.semantic.target.nodeId))?.node;
    return (
      gateway?.semantic.serviceType === INTERNET_GATEWAY &&
      vpcIdForNode(gateway, nodes, document) === vpcId
    );
  });
}

function routeTableHasValidNatDefault(
  document: AwsValidationDocument,
  nodes: ReadonlyMap<string, IndexedNode>,
  routeTableId: string,
): boolean {
  const routeTable = nodes.get(routeTableId)?.node;
  const routeTableVpcId =
    routeTable === undefined
      ? undefined
      : vpcIdForNode(routeTable, nodes, document);
  if (routeTableVpcId === undefined) {
    return false;
  }
  const routeIds = new Set(
    relationshipEdges(document, RELATIONSHIPS.routeTableOwnsRoute)
      .filter(
        ({ edge }) => String(edge.semantic.target.nodeId) === routeTableId,
      )
      .flatMap(({ edge }) => {
        const route = nodes.get(String(edge.semantic.source.nodeId))?.node;
        return route?.semantic.serviceType === ROUTE &&
          literalString(
            route.semantic.configuration.values,
            "destinationIpv4Cidr",
          ) === "0.0.0.0/0"
          ? [String(route.id)]
          : [];
      }),
  );
  return relationshipEdges(document, RELATIONSHIPS.routeTargetsNatGateway).some(
    ({ edge }) => {
      if (!routeIds.has(String(edge.semantic.source.nodeId))) {
        return false;
      }
      const nat = nodes.get(String(edge.semantic.target.nodeId))?.node;
      const natSubnetId = nat?.semantic.parent?.nodeId;
      const natSubnet =
        natSubnetId === undefined
          ? undefined
          : nodes.get(String(natSubnetId))?.node;
      const natSubnetRouteTableId =
        natSubnet === undefined
          ? undefined
          : routeTableIdForSubnet(document, nodes, String(natSubnet.id));
      return (
        nat?.semantic.serviceType === NAT_GATEWAY &&
        literalString(nat.semantic.configuration.values, "connectivityType") ===
          "public" &&
        literalString(nat.semantic.configuration.values, "availabilityMode") ===
          "zonal" &&
        natSubnet?.semantic.serviceType === SUBNET &&
        literalString(natSubnet.semantic.configuration.values, "accessTier") ===
          "public" &&
        vpcIdForNode(nat, nodes, document) === routeTableVpcId &&
        natSubnetRouteTableId !== undefined &&
        routeTableHasValidInternetGatewayDefault(
          document,
          nodes,
          natSubnetRouteTableId,
          routeTableVpcId,
        )
      );
    },
  );
}

function routeTableGatewayEndpointServices(
  document: AwsValidationDocument,
  nodes: ReadonlyMap<string, IndexedNode>,
  routeTableId: string,
): ReadonlySet<"s3" | "dynamodb"> {
  const routeTable = nodes.get(routeTableId)?.node;
  const routeTableVpcId =
    routeTable === undefined
      ? undefined
      : vpcIdForNode(routeTable, nodes, document);
  const services = new Set<"s3" | "dynamodb">();
  if (routeTableVpcId === undefined) {
    return services;
  }
  for (const { edge } of relationshipEdges(
    document,
    RELATIONSHIPS.gatewayEndpointAssociatesRouteTable,
  )) {
    if (String(edge.semantic.target.nodeId) !== routeTableId) {
      continue;
    }
    const endpoint = nodes.get(String(edge.semantic.source.nodeId))?.node;
    const service =
      endpoint === undefined
        ? undefined
        : literalString(endpoint.semantic.configuration.values, "service");
    if (
      endpoint?.semantic.serviceType === GATEWAY_ENDPOINT &&
      literalString(endpoint.semantic.configuration.values, "endpointType") ===
        "Gateway" &&
      vpcIdForNode(endpoint, nodes, document) === routeTableVpcId &&
      (service === "s3" || service === "dynamodb")
    ) {
      services.add(service);
    }
  }
  return services;
}

function routeTableSatisfiesEgressRequirement(
  document: AwsValidationDocument,
  nodes: ReadonlyMap<string, IndexedNode>,
  routeTableId: string,
  requirement: Exclude<LambdaVpcEgressRequirement, "none">,
): boolean {
  if (routeTableHasValidNatDefault(document, nodes, routeTableId)) {
    return true;
  }
  if (requirement === "internet") {
    return false;
  }
  const endpointServices = routeTableGatewayEndpointServices(
    document,
    nodes,
    routeTableId,
  );
  return requirement === "s3"
    ? endpointServices.has("s3")
    : requirement === "dynamodb"
      ? endpointServices.has("dynamodb")
      : endpointServices.has("s3") && endpointServices.has("dynamodb");
}

function hasLambdaVpcManagedPolicy(
  document: AwsValidationDocument,
  nodes: ReadonlyMap<string, IndexedNode>,
  lambdaId: string,
): boolean {
  const roleIds = document.edges
    .filter(
      (edge) =>
        edge.semantic.relationshipType === RELATIONSHIPS.roleAssumedByLambda &&
        String(edge.semantic.target.nodeId) === lambdaId,
    )
    .map((edge) => String(edge.semantic.source.nodeId));
  if (roleIds.length !== 1) {
    return false;
  }
  return document.edges.some((edge) => {
    if (
      edge.semantic.relationshipType !==
        RELATIONSHIPS.roleOwnsManagedPolicyAttachment ||
      String(edge.semantic.target.nodeId) !== roleIds[0]
    ) {
      return false;
    }
    const attachment = nodes.get(String(edge.semantic.source.nodeId))?.node;
    return (
      attachment?.semantic.serviceType ===
        "aws.iam.managed-policy-attachment" &&
      literalString(
        attachment.semantic.configuration.values,
        "attachmentKind",
      ) === "managed-policy-attachment" &&
      literalString(
        attachment.semantic.configuration.values,
        "managedPolicyReference",
      ) === "aws-managed:service-role/AWSLambdaVPCAccessExecutionRole"
    );
  });
}

export function createLambdaVpcAccessRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = lambdaVpcAccessValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const nodes = nodeMap(document);
      const findings: ValidationFindingCandidate[] = [];
      const ownerEdges = relationshipEdges(
        document,
        RELATIONSHIPS.lambdaOwnsVpcConfiguration,
      );
      const subnetEdges = relationshipEdges(
        document,
        RELATIONSHIPS.lambdaVpcAccessUsesSubnet,
      );
      const securityGroupEdges = relationshipEdges(
        document,
        RELATIONSHIPS.lambdaVpcAccessUsesSecurityGroup,
      );

      for (const { node, index } of indexedNodes(document).filter(
        ({ node }) => node.semantic.serviceType === LAMBDA_VPC_CONFIGURATION,
      )) {
        const owners = ownerEdges.filter(
          ({ edge }) => edge.semantic.source.nodeId === node.id,
        );
        const owner =
          owners.length === 1
            ? nodes.get(String(owners[0]?.edge.semantic.target.nodeId))
            : undefined;
        if (
          owners.length !== 1 ||
          owner?.node.semantic.serviceType !== LAMBDA_FUNCTION
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-vpc-owner-invalid",
              severity: "error",
              title: "Lambda VPC access configuration needs one function owner",
              beginnerExplanation:
                "Attach this configuration to exactly one Lambda function.",
              technicalExplanation:
                "A graph-backed VPC access configuration requires one aws.lambda.owns-vpc-access-configuration edge and never contains the function inside the VPC.",
              affected:
                owners.length === 0
                  ? [nodeLocation(node, index)]
                  : affectedEdges(owners),
            }),
          );
        }

        const selectedSubnets = subnetEdges.filter(
          ({ edge }) => edge.semantic.source.nodeId === node.id,
        );
        const selectedSecurityGroups = securityGroupEdges.filter(
          ({ edge }) => edge.semantic.source.nodeId === node.id,
        );
        if (selectedSubnets.length < 1 || selectedSubnets.length > 16) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-vpc-subnet-cardinality-invalid",
              severity: "error",
              title: "Lambda VPC access needs between 1 and 16 subnets",
              beginnerExplanation:
                "Select at least one and at most sixteen subnets; two private subnets in different Availability Zones are recommended for resilient workloads.",
              technicalExplanation:
                "The exact subnet-association set is outside the bounded Lambda VPC configuration cardinality.",
              affected:
                selectedSubnets.length === 0
                  ? [nodeLocation(node, index)]
                  : affectedEdges(selectedSubnets),
            }),
          );
        }
        if (
          selectedSecurityGroups.length < 1 ||
          selectedSecurityGroups.length > 5
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-vpc-security-group-cardinality-invalid",
              severity: "security-error",
              title: "Lambda VPC access needs between 1 and 5 security groups",
              beginnerExplanation:
                "Select at least one and at most five reviewed security groups.",
              technicalExplanation:
                "The exact security-group association set is outside the bounded Lambda VPC configuration cardinality.",
              affected:
                selectedSecurityGroups.length === 0
                  ? [nodeLocation(node, index)]
                  : affectedEdges(selectedSecurityGroups),
            }),
          );
        }

        const selectedSubnetNodes = selectedSubnets.flatMap(({ edge }) => {
          const target = nodes.get(String(edge.semantic.target.nodeId));
          return target?.node.semantic.serviceType === SUBNET ? [target] : [];
        });
        const selectedSecurityGroupNodes = selectedSecurityGroups.flatMap(
          ({ edge }) => {
            const target = nodes.get(String(edge.semantic.target.nodeId));
            return target?.node.semantic.serviceType === SECURITY_GROUP
              ? [target]
              : [];
          },
        );
        const egressRequirement = lambdaVpcEgressRequirement(node);
        if (egressRequirement !== undefined && egressRequirement !== "none") {
          const unsatisfiedSubnetEdges = selectedSubnets.filter(({ edge }) => {
            const subnet = nodes.get(String(edge.semantic.target.nodeId))?.node;
            if (subnet?.semantic.serviceType !== SUBNET) {
              return true;
            }
            const routeTableId = routeTableIdForSubnet(
              document,
              nodes,
              String(subnet.id),
            );
            return (
              routeTableId === undefined ||
              !routeTableSatisfiesEgressRequirement(
                document,
                nodes,
                routeTableId,
                egressRequirement,
              )
            );
          });
          if (unsatisfiedSubnetEdges.length > 0) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.lambda-vpc-egress-requirement-unsatisfied",
                severity: "error",
                title:
                  "Lambda subnets do not provide the required outbound path",
                beginnerExplanation:
                  "Add reviewed NAT routing or the required S3/DynamoDB gateway endpoint to every selected subnet. Choose None only when isolation is intentional.",
                technicalExplanation:
                  "The explicit Lambda VPC egressRequirement is not satisfied by an exact same-VPC public NAT default route or the required gateway-endpoint route-table associations; validation never invents a route, endpoint, or cost choice.",
                affected: [
                  nodeConfigurationLocation(node, index, "egressRequirement"),
                  ...affectedEdges(unsatisfiedSubnetEdges),
                ],
              }),
            );
          }
        }
        const vpcIds = new Set(
          [...selectedSubnetNodes, ...selectedSecurityGroupNodes]
            .map(({ node: target }) => vpcIdForNode(target, nodes, document))
            .filter((vpcId): vpcId is string => vpcId !== undefined),
        );
        if (
          selectedSubnetNodes.length !== selectedSubnets.length ||
          selectedSecurityGroupNodes.length !== selectedSecurityGroups.length ||
          vpcIds.size !== 1
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-vpc-association-vpc-mismatch",
              severity: "error",
              title: "Lambda subnets and security groups must share one VPC",
              beginnerExplanation:
                "Choose subnets and security groups from the same VPC.",
              technicalExplanation:
                "Every typed Lambda VPC association must resolve to one exact VPC ancestry closure; missing and cross-VPC targets fail closed.",
              affected:
                selectedSubnets.length + selectedSecurityGroups.length === 0
                  ? [nodeLocation(node, index)]
                  : affectedEdges([
                      ...selectedSubnets,
                      ...selectedSecurityGroups,
                    ]),
            }),
          );
        }

        const zones = new Set(
          selectedSubnetNodes
            .map(({ node: subnet }) =>
              availabilityZoneIdForSubnet(subnet, nodes),
            )
            .filter((zoneId): zoneId is string => zoneId !== undefined),
        );
        if (selectedSubnetNodes.length > 0 && zones.size < 2) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-vpc-single-availability-zone",
              severity: isLowerEnvironment(context.environment)
                ? "recommendation"
                : "warning",
              title: "Lambda VPC access uses fewer than two Availability Zones",
              beginnerExplanation:
                "Select private subnets in at least two Availability Zones when the function needs zone resilience.",
              technicalExplanation:
                "AWS recommends multi-AZ subnet selection for high availability; this remains advisory because topology and cost choices require user review.",
              affected: affectedEdges(selectedSubnets),
            }),
          );
        }

        const publicSubnetIds = new Set(
          selectedSubnetNodes
            .filter(
              ({ node: subnet }) =>
                literalString(
                  subnet.semantic.configuration.values,
                  "accessTier",
                ) === "public",
            )
            .map(({ node: subnet }) => String(subnet.id)),
        );
        const publicAssociations = selectedSubnets.filter(({ edge }) =>
          publicSubnetIds.has(String(edge.semantic.target.nodeId)),
        );
        if (publicAssociations.length > 0) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-vpc-public-subnet-no-internet",
              severity: "warning",
              title:
                "Public subnet does not give Lambda direct internet access",
              beginnerExplanation:
                "Use private subnets with a reviewed NAT route when this function needs public internet access.",
              technicalExplanation:
                "Lambda Hyperplane ENIs do not receive public IP addresses; selecting a subnet with an IGW route does not by itself provide internet connectivity.",
              affected: affectedEdges(publicAssociations),
            }),
          );
        }

        if (
          literalBoolean(
            node.semantic.configuration.values,
            "ipv6AllowedForDualStack",
          ) !== false
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-vpc-ipv6-mode-unsupported",
              severity: "error",
              title: "Lambda dual-stack IPv6 mode is not supported",
              beginnerExplanation:
                "Keep outbound IPv6 disabled in this IPv4-only catalog version.",
              technicalExplanation:
                "Prompt 41 has no reviewed IPv6 CIDR, egress-only gateway, or dual-stack route contract, so ipv6AllowedForDualStack must be false.",
              affected: [
                nodeConfigurationLocation(
                  node,
                  index,
                  "ipv6AllowedForDualStack",
                ),
              ],
            }),
          );
        }

        if (
          owner?.node !== undefined &&
          !hasLambdaVpcManagedPolicy(document, nodes, String(owner.node.id))
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-vpc-eni-permission-missing",
              severity: "error",
              title: "Lambda execution role lacks reviewed VPC ENI permissions",
              beginnerExplanation:
                "Attach the reviewed Lambda VPC access policy to the function's execution role before configuring VPC access.",
              technicalExplanation:
                "No exact aws-managed:service-role/AWSLambdaVPCAccessExecutionRole attachment is owned by the function's one execution role; permission intent is never generated as an auto-fix.",
              affected: [nodeLocation(node, index)],
            }),
          );
        }
      }

      return findings;
    },
  });
}
