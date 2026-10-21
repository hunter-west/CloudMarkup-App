import { canonicalJson, sha256Digest } from "./constants.js";
import type { NormalizedSolutionInput } from "./resolver.js";

export const APPLICATION_REACHABILITY_BINDING_ID =
  "cloudmarkup.application-reachability-binding" as const;
export const APPLICATION_REACHABILITY_BINDING_VERSION = "1.0.0" as const;

export const APPLICATION_REACHABILITY_CATALOG_BINDING = Object.freeze({
  id: "aws.cloudmarkup.notes-api-catalog",
  version: "0.10.0",
  digest:
    "sha256:17627252eb47c7f2a031ca04e90545e4775c0e0b598bd05b4fe4a0889fcd018d",
});

export const APPLICATION_REACHABILITY_BINDING_DESCRIPTOR = Object.freeze({
  contractVersion: 1 as const,
  id: APPLICATION_REACHABILITY_BINDING_ID,
  version: APPLICATION_REACHABILITY_BINDING_VERSION,
  catalog: APPLICATION_REACHABILITY_CATALOG_BINDING,
  capabilityVocabulary: [
    "internet-egress",
    "key-value-database-api",
    "object-storage-api",
  ] as const,
  acceptedBindings: [
    "aws.ec2.availability-zone-contains-subnet",
    "aws.ec2.gateway-endpoint-associates-route-table",
    "aws.ec2.route-table-association-targets-subnet",
    "aws.ec2.route-table-owns-route",
    "aws.ec2.route-table-owns-subnet-association",
    "aws.ec2.route-targets-internet-gateway",
    "aws.ec2.route-targets-nat-gateway",
    "aws.ec2.subnet-contains-nat-gateway",
    "aws.ec2.vpc-attaches-internet-gateway",
    "aws.ec2.vpc-contains-availability-zone",
    "aws.ec2.vpc-contains-gateway-endpoint",
    "aws.ec2.vpc-contains-route-table",
    "aws.lambda.owns-vpc-access-configuration",
    "aws.lambda.vpc-access-uses-security-group",
    "aws.lambda.vpc-access-uses-subnet",
  ] as const,
});

export const APPLICATION_REACHABILITY_BINDING_DIGEST = sha256Digest(
  canonicalJson(APPLICATION_REACHABILITY_BINDING_DESCRIPTOR),
);

export type ApplicationReachabilityCapabilityV1 =
  "internet-egress" | "key-value-database-api" | "object-storage-api";

export type ApplicationReachabilityPathV1 =
  "private-service-endpoint" | "reviewed-public-egress";

export interface ApplicationReachabilitySourceReferenceV1 {
  readonly id: string;
  readonly kind:
    | "normalized-configuration"
    | "normalized-connection"
    | "normalized-resource"
    | "normalized-workload";
  readonly path?: string;
}

export interface ApplicationReachabilityAssumptionV1 {
  readonly assumptionId: string;
  readonly capability: ApplicationReachabilityCapabilityV1;
  readonly expectedPath: ApplicationReachabilityPathV1;
  readonly state: "declared" | "unresolved";
  readonly sourceReferences: readonly ApplicationReachabilitySourceReferenceV1[];
}

export interface ApplicationWorkloadReachabilityBindingV1 {
  readonly workloadId: string;
  readonly networkAttachment:
    "customer-network-interface" | "provider-managed-network";
  readonly outboundRequirement:
    | "internet"
    | "key-value-database"
    | "none"
    | "not-declared"
    | "object-storage"
    | "object-storage-and-key-value-database";
  readonly assumptions: readonly ApplicationReachabilityAssumptionV1[];
  readonly sourceReferences: readonly ApplicationReachabilitySourceReferenceV1[];
}

export interface ApplicationReachabilityBindingArtifactV1 {
  readonly contractVersion: 1;
  readonly kind: "cloudmarkup.application-reachability-assumptions";
  readonly binding: {
    readonly id: typeof APPLICATION_REACHABILITY_BINDING_ID;
    readonly version: typeof APPLICATION_REACHABILITY_BINDING_VERSION;
    readonly digest: `sha256:${string}`;
  };
  readonly catalog: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly normalizedSolutionDigest: `sha256:${string}`;
  readonly solutionRevisionId: string;
  readonly workloads: readonly ApplicationWorkloadReachabilityBindingV1[];
}

export interface ApplicationReachabilityBindingResultV1 {
  readonly contractVersion: 1;
  readonly artifact: ApplicationReachabilityBindingArtifactV1;
  readonly artifactDigest: `sha256:${string}`;
}

export class ApplicationReachabilityBindingError extends Error {
  readonly code: string;
  readonly sourcePath: string;

  constructor(code: string, message: string, sourcePath: string) {
    super(message);
    this.name = "ApplicationReachabilityBindingError";
    this.code = code;
    this.sourcePath = sourcePath;
  }
}

const RESOURCE = Object.freeze({
  availabilityZone: "aws.ec2.availability-zone",
  gatewayEndpoint: "aws.ec2.gateway-vpc-endpoint",
  internetGateway: "aws.ec2.internet-gateway",
  lambda: "aws.lambda.function",
  lambdaVpcConfiguration: "aws.lambda.vpc-access-configuration",
  natGateway: "aws.ec2.nat-gateway",
  route: "aws.ec2.route",
  routeTable: "aws.ec2.route-table",
  routeTableAssociation: "aws.ec2.route-table-association",
  securityGroup: "aws.ec2.security-group",
  subnet: "aws.ec2.subnet",
  vpc: "aws.ec2.vpc",
});

const RELATIONSHIP = Object.freeze({
  availabilityZoneSubnet: "aws.ec2.availability-zone-contains-subnet",
  endpointRouteTable: "aws.ec2.gateway-endpoint-associates-route-table",
  lambdaConfigurationOwner: "aws.lambda.owns-vpc-access-configuration",
  lambdaSecurityGroup: "aws.lambda.vpc-access-uses-security-group",
  lambdaSubnet: "aws.lambda.vpc-access-uses-subnet",
  routeInternetGateway: "aws.ec2.route-targets-internet-gateway",
  routeNatGateway: "aws.ec2.route-targets-nat-gateway",
  routeOwner: "aws.ec2.route-table-owns-route",
  routeTableAssociationOwner: "aws.ec2.route-table-owns-subnet-association",
  routeTableAssociationSubnet: "aws.ec2.route-table-association-targets-subnet",
  subnetNatGateway: "aws.ec2.subnet-contains-nat-gateway",
  vpcAvailabilityZone: "aws.ec2.vpc-contains-availability-zone",
  vpcGatewayEndpoint: "aws.ec2.vpc-contains-gateway-endpoint",
  vpcInternetGateway: "aws.ec2.vpc-attaches-internet-gateway",
  vpcRouteTable: "aws.ec2.vpc-contains-route-table",
});

type NormalizedResource = NormalizedSolutionInput["resources"][number];
type NormalizedConnection = NormalizedSolutionInput["connections"][number];

function compareUtf16(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stableNormalizedSolutionDigest(
  solution: NormalizedSolutionInput,
): `sha256:${string}` {
  return sha256Digest(
    canonicalJson({
      ...solution,
      connections: [...solution.connections].sort((left, right) =>
        compareUtf16(left.id, right.id),
      ),
      resources: [...solution.resources].sort((left, right) =>
        compareUtf16(left.id, right.id),
      ),
      workloads: [...solution.workloads].sort((left, right) =>
        compareUtf16(left.id, right.id),
      ),
    }),
  );
}

function requireUniqueIds(
  values: readonly { readonly id: string }[],
  path: string,
): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (value.id.length === 0 || ids.has(value.id)) {
      throw new ApplicationReachabilityBindingError(
        "APPLICATION_REACHABILITY_NORMALIZED_ID_INVALID",
        "Normalized reachability input requires nonempty unique stable IDs.",
        path,
      );
    }
    ids.add(value.id);
  }
}

function literalValue(resource: NormalizedResource, key: string): unknown {
  const value = resource.configuration.values[key];
  if (value === undefined) return undefined;
  if (
    (value.kind === "string" && typeof value.value === "string") ||
    (value.kind === "boolean" && typeof value.value === "boolean")
  )
    return value.value;
  return undefined;
}

function referenceKey(
  reference: ApplicationReachabilitySourceReferenceV1,
): string {
  return `${reference.kind}\u0000${reference.id}\u0000${reference.path ?? ""}`;
}

function references(
  values: readonly ApplicationReachabilitySourceReferenceV1[],
): readonly ApplicationReachabilitySourceReferenceV1[] {
  const unique = new Map<string, ApplicationReachabilitySourceReferenceV1>();
  for (const value of values) unique.set(referenceKey(value), value);
  return [...unique.values()].sort((left, right) =>
    compareUtf16(referenceKey(left), referenceKey(right)),
  );
}

function resourceReference(
  resource: NormalizedResource,
  path?: string,
): ApplicationReachabilitySourceReferenceV1 {
  return {
    id: resource.id,
    kind:
      path === undefined ? "normalized-resource" : "normalized-configuration",
    ...(path === undefined ? {} : { path }),
  };
}

function connectionReference(
  connection: NormalizedConnection,
): ApplicationReachabilitySourceReferenceV1 {
  return { id: connection.id, kind: "normalized-connection" };
}

function relationshipFrom(
  solution: NormalizedSolutionInput,
  sourceId: string,
  relationshipType: string,
): readonly NormalizedConnection[] {
  return solution.connections
    .filter(
      (connection) =>
        connection.source.nodeId === sourceId &&
        connection.relationshipType === relationshipType,
    )
    .sort((left, right) => compareUtf16(left.id, right.id));
}

function resourceById(
  resources: ReadonlyMap<string, NormalizedResource>,
  id: string,
  resourceType: string,
): NormalizedResource | undefined {
  const resource = resources.get(id);
  return resource?.resourceType === resourceType ? resource : undefined;
}

type NormalizedParentReference = NonNullable<NormalizedResource["parent"]> & {
  readonly relationshipType?: string;
};

interface ExactParentPlacement {
  readonly connection: NormalizedConnection;
  readonly parent: NormalizedResource;
}

function exactParentPlacement(
  solution: NormalizedSolutionInput,
  resources: ReadonlyMap<string, NormalizedResource>,
  child: NormalizedResource,
  parentResourceType: string,
  relationshipType: string,
): ExactParentPlacement | undefined {
  const parentReference = child.parent as NormalizedParentReference | undefined;
  if (parentReference?.relationshipType !== relationshipType) return undefined;
  const parent = resourceById(
    resources,
    parentReference.nodeId,
    parentResourceType,
  );
  if (parent === undefined) return undefined;
  if (
    parent.serviceType !== parentResourceType ||
    parentReference.targetKey !== parent.targetKey
  ) {
    return undefined;
  }
  const connections = solution.connections.filter(
    (connection) =>
      connection.relationshipType === relationshipType &&
      connection.source.nodeId === parent.id &&
      connection.source.targetKey === parent.targetKey &&
      connection.target.nodeId === child.id &&
      connection.target.targetKey === child.targetKey,
  );
  return connections.length === 1 && connections[0] !== undefined
    ? { connection: connections[0], parent }
    : undefined;
}

interface VpcPlacement {
  readonly references: readonly ApplicationReachabilitySourceReferenceV1[];
  readonly vpc: NormalizedResource;
}

function subnetVpcPlacement(
  solution: NormalizedSolutionInput,
  resources: ReadonlyMap<string, NormalizedResource>,
  subnet: NormalizedResource,
): VpcPlacement | undefined {
  const availabilityZonePlacement = exactParentPlacement(
    solution,
    resources,
    subnet,
    RESOURCE.availabilityZone,
    RELATIONSHIP.availabilityZoneSubnet,
  );
  if (availabilityZonePlacement === undefined) return undefined;
  const vpcPlacement = exactParentPlacement(
    solution,
    resources,
    availabilityZonePlacement.parent,
    RESOURCE.vpc,
    RELATIONSHIP.vpcAvailabilityZone,
  );
  if (vpcPlacement === undefined) return undefined;
  return {
    references: references([
      resourceReference(subnet),
      connectionReference(availabilityZonePlacement.connection),
      resourceReference(availabilityZonePlacement.parent),
      connectionReference(vpcPlacement.connection),
      resourceReference(vpcPlacement.parent),
    ]),
    vpc: vpcPlacement.parent,
  };
}

function routeTableVpcPlacement(
  solution: NormalizedSolutionInput,
  resources: ReadonlyMap<string, NormalizedResource>,
  routeTable: NormalizedResource,
): VpcPlacement | undefined {
  const placement = exactParentPlacement(
    solution,
    resources,
    routeTable,
    RESOURCE.vpc,
    RELATIONSHIP.vpcRouteTable,
  );
  return placement === undefined
    ? undefined
    : {
        references: references([
          resourceReference(routeTable),
          connectionReference(placement.connection),
          resourceReference(placement.parent),
        ]),
        vpc: placement.parent,
      };
}

interface SelectedRouteTables {
  readonly complete: boolean;
  readonly references: readonly ApplicationReachabilitySourceReferenceV1[];
  readonly routeTableIds: readonly string[];
}

function selectedRouteTables(
  solution: NormalizedSolutionInput,
  resources: ReadonlyMap<string, NormalizedResource>,
  subnetIds: readonly string[],
): SelectedRouteTables {
  const routeTableIds: string[] = [];
  const sourceReferences: ApplicationReachabilitySourceReferenceV1[] = [];
  let complete = subnetIds.length > 0;
  for (const subnetId of subnetIds) {
    const targetEdges = solution.connections.filter(
      (connection) =>
        connection.relationshipType ===
          RELATIONSHIP.routeTableAssociationSubnet &&
        connection.target.nodeId === subnetId,
    );
    if (targetEdges.length !== 1) {
      complete = false;
      continue;
    }
    const targetEdge = targetEdges[0];
    const association =
      targetEdge === undefined
        ? undefined
        : resourceById(
            resources,
            targetEdge.source.nodeId,
            RESOURCE.routeTableAssociation,
          );
    const associationTargetEdges =
      association === undefined
        ? []
        : relationshipFrom(
            solution,
            association.id,
            RELATIONSHIP.routeTableAssociationSubnet,
          );
    const ownerEdges =
      association === undefined
        ? []
        : relationshipFrom(
            solution,
            association.id,
            RELATIONSHIP.routeTableAssociationOwner,
          );
    const routeTable =
      ownerEdges.length === 1 && ownerEdges[0] !== undefined
        ? resourceById(
            resources,
            ownerEdges[0].target.nodeId,
            RESOURCE.routeTable,
          )
        : undefined;
    if (
      targetEdge === undefined ||
      association === undefined ||
      associationTargetEdges.length !== 1 ||
      associationTargetEdges[0]?.id !== targetEdge.id ||
      ownerEdges[0] === undefined ||
      routeTable === undefined
    ) {
      complete = false;
      continue;
    }
    routeTableIds.push(routeTable.id);
    sourceReferences.push(
      connectionReference(targetEdge),
      resourceReference(association),
      connectionReference(ownerEdges[0]),
      resourceReference(routeTable),
    );
  }
  return {
    complete,
    references: references(sourceReferences),
    routeTableIds: [...new Set(routeTableIds)].sort(compareUtf16),
  };
}

function requiredCapabilities(
  requirement: string,
): readonly ApplicationReachabilityCapabilityV1[] {
  switch (requirement) {
    case "internet":
      return ["internet-egress"];
    case "s3":
      return ["object-storage-api"];
    case "dynamodb":
      return ["key-value-database-api"];
    case "s3-and-dynamodb":
      return ["key-value-database-api", "object-storage-api"];
    case "none":
      return [];
    default:
      throw new ApplicationReachabilityBindingError(
        "APPLICATION_REACHABILITY_REQUIREMENT_UNSUPPORTED",
        "The normalized Lambda network configuration uses an unsupported outbound requirement.",
        "$.resources.configuration.values.egressRequirement",
      );
  }
}

function endpointService(
  capability: ApplicationReachabilityCapabilityV1,
): "dynamodb" | "s3" | undefined {
  if (capability === "object-storage-api") return "s3";
  if (capability === "key-value-database-api") return "dynamodb";
  return undefined;
}

function endpointAssumption(
  solution: NormalizedSolutionInput,
  resources: ReadonlyMap<string, NormalizedResource>,
  workloadId: string,
  configuration: NormalizedResource,
  capability: ApplicationReachabilityCapabilityV1,
  routeTables: SelectedRouteTables,
): ApplicationReachabilityAssumptionV1 {
  const service = endpointService(capability);
  const routeTablePlacements = routeTables.routeTableIds.map((routeTableId) => {
    const routeTable = resourceById(
      resources,
      routeTableId,
      RESOURCE.routeTable,
    );
    return routeTable === undefined
      ? undefined
      : routeTableVpcPlacement(solution, resources, routeTable);
  });
  const matchingEndpoints = solution.resources.filter(
    (resource) =>
      resource.resourceType === RESOURCE.gatewayEndpoint &&
      resource.serviceType === RESOURCE.gatewayEndpoint &&
      resource.configuration.schemaId ===
        "aws.ec2.gateway-vpc-endpoint.configuration" &&
      resource.configuration.schemaVersion === "1.0.0" &&
      literalValue(resource, "endpointType") === "Gateway" &&
      literalValue(resource, "service") === service,
  );
  const endpointReferences: ApplicationReachabilitySourceReferenceV1[] = [];
  let exactEndpointCoversEveryRouteTable = false;
  for (const endpoint of matchingEndpoints) {
    endpointReferences.push(resourceReference(endpoint));
    const endpointPlacement = exactParentPlacement(
      solution,
      resources,
      endpoint,
      RESOURCE.vpc,
      RELATIONSHIP.vpcGatewayEndpoint,
    );
    if (endpointPlacement === undefined) continue;
    endpointReferences.push(
      connectionReference(endpointPlacement.connection),
      resourceReference(endpointPlacement.parent),
    );
    for (const placement of routeTablePlacements) {
      if (placement !== undefined) {
        endpointReferences.push(...placement.references);
      }
    }
    const routeTablesShareEndpointVpc = routeTablePlacements.every(
      (placement) => placement?.vpc.id === endpointPlacement.parent.id,
    );
    if (!routeTablesShareEndpointVpc) continue;
    const routeTableAssociations = relationshipFrom(
      solution,
      endpoint.id,
      RELATIONSHIP.endpointRouteTable,
    ).filter((connection) => {
      const routeTable = resourceById(
        resources,
        connection.target.nodeId,
        RESOURCE.routeTable,
      );
      return (
        connection.source.targetKey === endpoint.targetKey &&
        connection.target.targetKey === routeTable?.targetKey
      );
    });
    endpointReferences.push(...routeTableAssociations.map(connectionReference));
    if (
      routeTables.routeTableIds.every(
        (routeTableId) =>
          routeTableAssociations.filter(
            (connection) => connection.target.nodeId === routeTableId,
          ).length === 1,
      )
    ) {
      exactEndpointCoversEveryRouteTable = true;
    }
  }
  const declared =
    routeTables.complete &&
    routeTables.routeTableIds.length > 0 &&
    exactEndpointCoversEveryRouteTable;
  return {
    assumptionId: `reachability_${sha256Digest(
      canonicalJson({ capability, workloadId }),
    ).slice(7, 31)}`,
    capability,
    expectedPath: "private-service-endpoint",
    state: declared ? "declared" : "unresolved",
    sourceReferences: references([
      resourceReference(
        configuration,
        "$.configuration.values.egressRequirement",
      ),
      ...routeTables.references,
      ...endpointReferences,
    ]),
  };
}

interface NetworkPathProof {
  readonly complete: boolean;
  readonly references: readonly ApplicationReachabilitySourceReferenceV1[];
}

function natInternetPath(
  solution: NormalizedSolutionInput,
  resources: ReadonlyMap<string, NormalizedResource>,
  nat: NormalizedResource,
  expectedVpcId: string,
): NetworkPathProof {
  const sourceReferences: ApplicationReachabilitySourceReferenceV1[] = [
    resourceReference(nat),
  ];
  const natPlacement = exactParentPlacement(
    solution,
    resources,
    nat,
    RESOURCE.subnet,
    RELATIONSHIP.subnetNatGateway,
  );
  if (natPlacement === undefined) {
    return { complete: false, references: references(sourceReferences) };
  }
  const natSubnet = natPlacement.parent;
  sourceReferences.push(
    connectionReference(natPlacement.connection),
    resourceReference(natSubnet),
  );
  const subnetPlacement = subnetVpcPlacement(solution, resources, natSubnet);
  if (subnetPlacement === undefined) {
    return { complete: false, references: references(sourceReferences) };
  }
  sourceReferences.push(...subnetPlacement.references);
  if (subnetPlacement.vpc.id !== expectedVpcId) {
    return { complete: false, references: references(sourceReferences) };
  }

  const routeTables = selectedRouteTables(solution, resources, [natSubnet.id]);
  sourceReferences.push(...routeTables.references);
  if (!routeTables.complete || routeTables.routeTableIds.length !== 1) {
    return { complete: false, references: references(sourceReferences) };
  }
  const routeTable = resourceById(
    resources,
    routeTables.routeTableIds[0] ?? "",
    RESOURCE.routeTable,
  );
  const routeTablePlacement =
    routeTable === undefined
      ? undefined
      : routeTableVpcPlacement(solution, resources, routeTable);
  if (routeTablePlacement !== undefined) {
    sourceReferences.push(...routeTablePlacement.references);
  }
  if (
    routeTable === undefined ||
    routeTablePlacement?.vpc.id !== expectedVpcId
  ) {
    return { complete: false, references: references(sourceReferences) };
  }

  const routeOwnerEdges = solution.connections.filter(
    (connection) =>
      connection.relationshipType === RELATIONSHIP.routeOwner &&
      connection.target.nodeId === routeTable.id,
  );
  let eligibleRouteCount = 0;
  for (const ownerEdge of routeOwnerEdges) {
    const route = resourceById(
      resources,
      ownerEdge.source.nodeId,
      RESOURCE.route,
    );
    if (route === undefined) continue;
    if (
      route.serviceType !== RESOURCE.route ||
      literalValue(route, "destinationIpv4Cidr") !== "0.0.0.0/0"
    ) {
      continue;
    }
    sourceReferences.push(
      connectionReference(ownerEdge),
      resourceReference(route),
    );
    const exactOwnerEdges = relationshipFrom(
      solution,
      route.id,
      RELATIONSHIP.routeOwner,
    );
    if (
      exactOwnerEdges.length !== 1 ||
      exactOwnerEdges[0]?.id !== ownerEdge.id
    ) {
      continue;
    }
    const gatewayEdges = relationshipFrom(
      solution,
      route.id,
      RELATIONSHIP.routeInternetGateway,
    );
    const gateway =
      gatewayEdges.length === 1 && gatewayEdges[0] !== undefined
        ? resourceById(
            resources,
            gatewayEdges[0].target.nodeId,
            RESOURCE.internetGateway,
          )
        : undefined;
    if (gateway === undefined || gatewayEdges[0] === undefined) continue;
    if (gateway.serviceType !== RESOURCE.internetGateway) {
      continue;
    }
    sourceReferences.push(
      connectionReference(gatewayEdges[0]),
      resourceReference(gateway),
    );
    const attachmentEdges = solution.connections.filter(
      (connection) =>
        connection.relationshipType === RELATIONSHIP.vpcInternetGateway &&
        connection.target.nodeId === gateway.id,
    );
    const attachment =
      attachmentEdges.length === 1 ? attachmentEdges[0] : undefined;
    const attachedVpc =
      attachment === undefined
        ? undefined
        : resourceById(resources, attachment.source.nodeId, RESOURCE.vpc);
    if (attachment !== undefined) {
      sourceReferences.push(connectionReference(attachment));
    }
    if (attachedVpc !== undefined) {
      sourceReferences.push(resourceReference(attachedVpc));
    }
    if (
      attachment === undefined ||
      attachedVpc?.id !== expectedVpcId ||
      attachment.source.targetKey !== attachedVpc.targetKey ||
      attachment.target.targetKey !== gateway.targetKey
    ) {
      continue;
    }
    eligibleRouteCount += 1;
  }
  return {
    complete: eligibleRouteCount === 1,
    references: references(sourceReferences),
  };
}

function internetAssumption(
  solution: NormalizedSolutionInput,
  resources: ReadonlyMap<string, NormalizedResource>,
  workloadId: string,
  configuration: NormalizedResource,
  routeTables: SelectedRouteTables,
  subnetIds: readonly string[],
): ApplicationReachabilityAssumptionV1 {
  const sourceReferences: ApplicationReachabilitySourceReferenceV1[] = [
    resourceReference(
      configuration,
      "$.configuration.values.egressRequirement",
    ),
    ...routeTables.references,
  ];
  const subnetPlacements = subnetIds.map((subnetId) => {
    const subnet = resourceById(resources, subnetId, RESOURCE.subnet);
    return subnet === undefined
      ? undefined
      : subnetVpcPlacement(solution, resources, subnet);
  });
  for (const placement of subnetPlacements) {
    if (placement !== undefined) sourceReferences.push(...placement.references);
  }
  const workloadVpcIds = [
    ...new Set(
      subnetPlacements.flatMap((placement) =>
        placement === undefined ? [] : [placement.vpc.id],
      ),
    ),
  ];
  const workloadVpcId =
    subnetPlacements.every((placement) => placement !== undefined) &&
    workloadVpcIds.length === 1
      ? workloadVpcIds[0]
      : undefined;
  let complete =
    routeTables.complete &&
    routeTables.routeTableIds.length > 0 &&
    workloadVpcId !== undefined;
  for (const routeTableId of routeTables.routeTableIds) {
    const routeTable = resourceById(
      resources,
      routeTableId,
      RESOURCE.routeTable,
    );
    const routeTablePlacement =
      routeTable === undefined
        ? undefined
        : routeTableVpcPlacement(solution, resources, routeTable);
    if (routeTablePlacement !== undefined) {
      sourceReferences.push(...routeTablePlacement.references);
    }
    if (
      routeTable === undefined ||
      routeTablePlacement?.vpc.id !== workloadVpcId
    ) {
      complete = false;
      continue;
    }
    const routeOwnerEdges = solution.connections.filter(
      (connection) =>
        connection.relationshipType === RELATIONSHIP.routeOwner &&
        connection.target.nodeId === routeTableId,
    );
    let eligibleRouteCount = 0;
    for (const ownerEdge of routeOwnerEdges) {
      const route = resourceById(
        resources,
        ownerEdge.source.nodeId,
        RESOURCE.route,
      );
      if (route === undefined) continue;
      if (
        route.serviceType !== RESOURCE.route ||
        literalValue(route, "destinationIpv4Cidr") !== "0.0.0.0/0"
      ) {
        continue;
      }
      sourceReferences.push(
        connectionReference(ownerEdge),
        resourceReference(route),
      );
      const exactOwnerEdges = relationshipFrom(
        solution,
        route.id,
        RELATIONSHIP.routeOwner,
      );
      if (
        exactOwnerEdges.length !== 1 ||
        exactOwnerEdges[0]?.id !== ownerEdge.id
      ) {
        continue;
      }
      const natEdges = relationshipFrom(
        solution,
        route.id,
        RELATIONSHIP.routeNatGateway,
      );
      const nat =
        natEdges.length === 1 && natEdges[0] !== undefined
          ? resourceById(
              resources,
              natEdges[0].target.nodeId,
              RESOURCE.natGateway,
            )
          : undefined;
      if (nat === undefined || natEdges[0] === undefined) continue;
      if (nat.serviceType !== RESOURCE.natGateway) continue;
      sourceReferences.push(
        connectionReference(natEdges[0]),
        resourceReference(nat),
      );
      if (workloadVpcId === undefined) continue;
      const natPath = natInternetPath(solution, resources, nat, workloadVpcId);
      sourceReferences.push(...natPath.references);
      if (natPath.complete) eligibleRouteCount += 1;
    }
    if (eligibleRouteCount !== 1) complete = false;
  }
  return {
    assumptionId: `reachability_${sha256Digest(
      canonicalJson({ capability: "internet-egress", workloadId }),
    ).slice(7, 31)}`,
    capability: "internet-egress",
    expectedPath: "reviewed-public-egress",
    state: complete ? "declared" : "unresolved",
    sourceReferences: references(sourceReferences),
  };
}

function workloadBinding(
  solution: NormalizedSolutionInput,
  resources: ReadonlyMap<string, NormalizedResource>,
  workload: NormalizedSolutionInput["workloads"][number],
): ApplicationWorkloadReachabilityBindingV1 {
  const owner = resourceById(
    resources,
    workload.owningResource.nodeId,
    RESOURCE.lambda,
  );
  if (owner === undefined) {
    throw new ApplicationReachabilityBindingError(
      "APPLICATION_REACHABILITY_OWNER_UNSUPPORTED",
      "Reachability bindings currently require an exact normalized Lambda workload owner.",
      `$.workloads[${workload.id}].owningResource`,
    );
  }
  const ownerEdges = solution.connections.filter(
    (connection) =>
      connection.relationshipType === RELATIONSHIP.lambdaConfigurationOwner &&
      connection.target.nodeId === owner.id,
  );
  if (ownerEdges.length === 0) {
    return {
      workloadId: workload.id,
      networkAttachment: "provider-managed-network",
      outboundRequirement: "not-declared",
      assumptions: [],
      sourceReferences: [
        { id: workload.id, kind: "normalized-workload" },
        resourceReference(owner),
      ],
    };
  }
  if (ownerEdges.length !== 1 || ownerEdges[0] === undefined) {
    throw new ApplicationReachabilityBindingError(
      "APPLICATION_REACHABILITY_CONFIGURATION_AMBIGUOUS",
      "A workload may bind at most one normalized network-access configuration.",
      `$.workloads[${workload.id}]`,
    );
  }
  const configuration = resourceById(
    resources,
    ownerEdges[0].source.nodeId,
    RESOURCE.lambdaVpcConfiguration,
  );
  if (
    configuration?.configuration.schemaId !==
      "aws.lambda.vpc-access-configuration.configuration" ||
    configuration.configuration.schemaVersion !== "1.1.0" ||
    literalValue(configuration, "ipv6AllowedForDualStack") !== false
  ) {
    throw new ApplicationReachabilityBindingError(
      "APPLICATION_REACHABILITY_CONFIGURATION_UNSUPPORTED",
      "The network-access configuration must use the exact reviewed IPv4-only binding schema.",
      `$.resources[${ownerEdges[0].source.nodeId}].configuration`,
    );
  }
  const requirement = literalValue(configuration, "egressRequirement");
  if (typeof requirement !== "string") {
    throw new ApplicationReachabilityBindingError(
      "APPLICATION_REACHABILITY_REQUIREMENT_REQUIRED",
      "The network-access configuration must declare its normalized outbound requirement.",
      `$.resources[${configuration.id}].configuration.values.egressRequirement`,
    );
  }
  const subnetEdges = relationshipFrom(
    solution,
    configuration.id,
    RELATIONSHIP.lambdaSubnet,
  );
  const securityGroupEdges = relationshipFrom(
    solution,
    configuration.id,
    RELATIONSHIP.lambdaSecurityGroup,
  );
  const subnetIds = subnetEdges
    .filter(
      (edge) =>
        resourceById(resources, edge.target.nodeId, RESOURCE.subnet) !==
        undefined,
    )
    .map((edge) => edge.target.nodeId);
  const securityGroupsValid = securityGroupEdges.every(
    (edge) =>
      resourceById(resources, edge.target.nodeId, RESOURCE.securityGroup) !==
      undefined,
  );
  if (
    subnetEdges.length === 0 ||
    subnetIds.length !== subnetEdges.length ||
    securityGroupEdges.length === 0 ||
    !securityGroupsValid
  ) {
    throw new ApplicationReachabilityBindingError(
      "APPLICATION_REACHABILITY_ASSOCIATION_INCOMPLETE",
      "A network-attached workload requires exact normalized subnet and security-policy associations.",
      `$.resources[${configuration.id}]`,
    );
  }
  const routeTables = selectedRouteTables(
    solution,
    resources,
    [...new Set(subnetIds)].sort(compareUtf16),
  );
  const assumptions = requiredCapabilities(requirement).map((capability) =>
    capability === "internet-egress"
      ? internetAssumption(
          solution,
          resources,
          workload.id,
          configuration,
          routeTables,
          [...new Set(subnetIds)].sort(compareUtf16),
        )
      : endpointAssumption(
          solution,
          resources,
          workload.id,
          configuration,
          capability,
          routeTables,
        ),
  );
  const outboundRequirement =
    requirement === "s3"
      ? "object-storage"
      : requirement === "dynamodb"
        ? "key-value-database"
        : requirement === "s3-and-dynamodb"
          ? "object-storage-and-key-value-database"
          : requirement;
  return {
    workloadId: workload.id,
    networkAttachment: "customer-network-interface",
    outboundRequirement: outboundRequirement as Exclude<
      ApplicationWorkloadReachabilityBindingV1["outboundRequirement"],
      "not-declared"
    >,
    assumptions: [...assumptions].sort((left, right) =>
      compareUtf16(left.capability, right.capability),
    ),
    sourceReferences: references([
      { id: workload.id, kind: "normalized-workload" },
      resourceReference(owner),
      connectionReference(ownerEdges[0]),
      resourceReference(configuration),
      ...subnetEdges.map(connectionReference),
      ...securityGroupEdges.map(connectionReference),
    ]),
  };
}

function artifactInvalid(): never {
  throw new ApplicationReachabilityBindingError(
    "APPLICATION_REACHABILITY_ARTIFACT_INVALID",
    "The application reachability artifact failed its exact version or digest binding, or its bounded shape is invalid.",
    "$",
  );
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expectedCapabilities(
  outboundRequirement: unknown,
): readonly ApplicationReachabilityCapabilityV1[] | undefined {
  switch (outboundRequirement) {
    case "internet":
      return ["internet-egress"];
    case "key-value-database":
      return ["key-value-database-api"];
    case "object-storage":
      return ["object-storage-api"];
    case "object-storage-and-key-value-database":
      return ["key-value-database-api", "object-storage-api"];
    case "none":
    case "not-declared":
      return [];
    default:
      return undefined;
  }
}

function validSourceReferences(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 256) return false;
  const values: readonly unknown[] = value;
  const keys = new Set<string>();
  return values.every((candidate) => {
    if (!record(candidate)) return false;
    const id = candidate["id"];
    const kind = candidate["kind"];
    const path = candidate["path"];
    const valid =
      typeof id === "string" &&
      id.length > 0 &&
      id.length <= 512 &&
      typeof kind === "string" &&
      [
        "normalized-configuration",
        "normalized-connection",
        "normalized-resource",
        "normalized-workload",
      ].includes(kind) &&
      (path === undefined ||
        (typeof path === "string" && path.length > 0 && path.length <= 1_000));
    const key = valid ? `${kind}\u0000${id}\u0000${path ?? ""}` : "";
    if (!valid || keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function validWorkloadArtifact(value: unknown): boolean {
  if (!record(value)) return false;
  const workloadId = value["workloadId"];
  const outboundRequirement = value["outboundRequirement"];
  const networkAttachment = value["networkAttachment"];
  const assumptionsValue = value["assumptions"];
  const sourceReferences = value["sourceReferences"];
  const expected = expectedCapabilities(outboundRequirement);
  if (
    typeof workloadId !== "string" ||
    workloadId.length === 0 ||
    workloadId.length > 512 ||
    expected === undefined ||
    !Array.isArray(assumptionsValue) ||
    assumptionsValue.length > 3
  ) {
    return false;
  }
  const assumptions: readonly unknown[] = assumptionsValue;
  const actual: ApplicationReachabilityCapabilityV1[] = [];
  const expectedAttachment =
    outboundRequirement === "not-declared"
      ? "provider-managed-network"
      : "customer-network-interface";
  const assumptionIds = new Set<string>();
  for (const value of assumptions) {
    if (!record(value)) return false;
    const assumptionId = value["assumptionId"];
    const capability = value["capability"];
    const expectedPath = value["expectedPath"];
    const state = value["state"];
    if (
      typeof assumptionId !== "string" ||
      assumptionId.length === 0 ||
      assumptionId.length > 512 ||
      assumptionIds.has(assumptionId) ||
      (capability !== "internet-egress" &&
        capability !== "key-value-database-api" &&
        capability !== "object-storage-api") ||
      (state !== "declared" && state !== "unresolved") ||
      (capability === "internet-egress"
        ? expectedPath !== "reviewed-public-egress"
        : expectedPath !== "private-service-endpoint") ||
      !validSourceReferences(value["sourceReferences"])
    ) {
      return false;
    }
    assumptionIds.add(assumptionId);
    actual.push(capability);
  }
  return (
    networkAttachment === expectedAttachment &&
    canonicalJson(actual) === canonicalJson(expected) &&
    validSourceReferences(sourceReferences)
  );
}

export function assertApplicationReachabilityBindingResultV1(
  value: unknown,
): asserts value is ApplicationReachabilityBindingResultV1 {
  const digestPattern = /^sha256:[0-9a-f]{64}$/;
  if (!record(value)) artifactInvalid();
  const contractVersion = value["contractVersion"];
  const artifactDigest = value["artifactDigest"];
  const artifact = value["artifact"];
  if (!record(artifact)) artifactInvalid();
  const binding = artifact["binding"];
  const catalog = artifact["catalog"];
  const workloadsValue = artifact["workloads"];
  if (!record(binding) || !record(catalog) || !Array.isArray(workloadsValue)) {
    artifactInvalid();
  }
  const workloads: readonly unknown[] = workloadsValue;
  const workloadIds: string[] = [];
  for (const workload of workloads) {
    if (!validWorkloadArtifact(workload) || !record(workload)) {
      artifactInvalid();
    }
    const workloadId = workload["workloadId"];
    if (typeof workloadId !== "string") artifactInvalid();
    workloadIds.push(workloadId);
  }
  const solutionRevisionId = artifact["solutionRevisionId"];
  const normalizedSolutionDigest = artifact["normalizedSolutionDigest"];
  const catalogId = catalog["id"];
  const catalogVersion = catalog["version"];
  const catalogDigest = catalog["digest"];
  if (
    contractVersion !== 1 ||
    artifact["contractVersion"] !== 1 ||
    typeof solutionRevisionId !== "string" ||
    solutionRevisionId.length === 0 ||
    solutionRevisionId.length > 512 ||
    typeof normalizedSolutionDigest !== "string" ||
    !digestPattern.test(normalizedSolutionDigest) ||
    catalogId !== APPLICATION_REACHABILITY_CATALOG_BINDING.id ||
    catalogVersion !== APPLICATION_REACHABILITY_CATALOG_BINDING.version ||
    catalogDigest !== APPLICATION_REACHABILITY_CATALOG_BINDING.digest ||
    typeof catalogId !== "string" ||
    catalogId.length === 0 ||
    typeof catalogVersion !== "string" ||
    catalogVersion.length === 0 ||
    typeof catalogDigest !== "string" ||
    !digestPattern.test(catalogDigest) ||
    workloads.length > 1_000 ||
    artifact["kind"] !== "cloudmarkup.application-reachability-assumptions" ||
    binding["id"] !== APPLICATION_REACHABILITY_BINDING_ID ||
    binding["version"] !== APPLICATION_REACHABILITY_BINDING_VERSION ||
    binding["digest"] !== APPLICATION_REACHABILITY_BINDING_DIGEST ||
    typeof artifactDigest !== "string" ||
    !digestPattern.test(artifactDigest) ||
    artifactDigest !== sha256Digest(canonicalJson(artifact)) ||
    new Set(workloadIds).size !== workloadIds.length
  ) {
    artifactInvalid();
  }
}

/**
 * Projects application reachability assumptions from exact normalized graph
 * bindings. It emits no source, executes nothing, and does not claim that a
 * declared route has been observed in a customer environment.
 */
export function deriveApplicationReachabilityBindingV1(
  normalizedSolution: NormalizedSolutionInput,
): ApplicationReachabilityBindingResultV1 {
  if (
    normalizedSolution.contractVersion !== 1 ||
    normalizedSolution.provenance.solutionRevisionId === undefined ||
    normalizedSolution.provenance.solutionRevisionId.length === 0
  ) {
    throw new ApplicationReachabilityBindingError(
      "APPLICATION_REACHABILITY_PROVENANCE_REQUIRED",
      "Reachability projection requires an immutable normalized-model v1 Solution Revision binding.",
      "$.provenance.solutionRevisionId",
    );
  }
  const catalog = normalizedSolution.provenance.catalog;
  if (
    catalog.id !== APPLICATION_REACHABILITY_CATALOG_BINDING.id ||
    catalog.version !== APPLICATION_REACHABILITY_CATALOG_BINDING.version ||
    catalog.digest !== APPLICATION_REACHABILITY_CATALOG_BINDING.digest
  ) {
    throw new ApplicationReachabilityBindingError(
      "APPLICATION_REACHABILITY_CATALOG_UNSUPPORTED",
      "Reachability projection requires the exact approved AWS networking catalog identity.",
      "$.provenance.catalog",
    );
  }
  if (
    normalizedSolution.resources.length > 2_000 ||
    normalizedSolution.connections.length > 10_000 ||
    normalizedSolution.workloads.length > 1_000
  ) {
    throw new ApplicationReachabilityBindingError(
      "APPLICATION_REACHABILITY_INPUT_LIMIT_EXCEEDED",
      "Normalized reachability input exceeds the reviewed record limits.",
      "$",
    );
  }
  requireUniqueIds(normalizedSolution.resources, "$.resources");
  requireUniqueIds(normalizedSolution.connections, "$.connections");
  requireUniqueIds(normalizedSolution.workloads, "$.workloads");
  const resources = new Map(
    normalizedSolution.resources.map((resource) => [resource.id, resource]),
  );
  const workloads = normalizedSolution.workloads
    .map((workload) => workloadBinding(normalizedSolution, resources, workload))
    .sort((left, right) => compareUtf16(left.workloadId, right.workloadId));
  const artifact: ApplicationReachabilityBindingArtifactV1 = {
    contractVersion: 1,
    kind: "cloudmarkup.application-reachability-assumptions",
    binding: {
      id: APPLICATION_REACHABILITY_BINDING_ID,
      version: APPLICATION_REACHABILITY_BINDING_VERSION,
      digest: APPLICATION_REACHABILITY_BINDING_DIGEST,
    },
    catalog: normalizedSolution.provenance.catalog,
    normalizedSolutionDigest:
      stableNormalizedSolutionDigest(normalizedSolution),
    solutionRevisionId: normalizedSolution.provenance.solutionRevisionId,
    workloads,
  };
  const result: ApplicationReachabilityBindingResultV1 = {
    contractVersion: 1,
    artifact,
    artifactDigest: sha256Digest(canonicalJson(artifact)),
  };
  assertApplicationReachabilityBindingResultV1(result);
  return result;
}
