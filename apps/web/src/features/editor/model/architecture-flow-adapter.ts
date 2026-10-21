import {
  createArchitectureDocumentIndex,
  type ArchitectureDocumentIndex,
} from "./architecture-document-index.js";
import type {
  ArchitectureDocument,
  ArchitectureEdge,
  ArchitectureNode,
} from "@cloudmarkup/domain";
import type { Edge, Node } from "@xyflow/react";

import type {
  EditorCatalog,
  EditorCatalogPort,
  EditorCatalogService,
  EditorConnectionGroupCategory,
  EditorConnectionDockSide,
  EditorConnectionGroup,
  EditorNodeKind,
  EditorPortDirection,
} from "./editor-catalog.js";
import {
  editorConnectionGroupForPort,
  editorDockHandleId,
  resolveEditorConnectionGroups,
} from "./connection-docks.js";
import {
  hasExactEditorCatalogBinding,
  resolveExactEditorCatalogRelationship,
  resolveExactEditorCatalogService,
} from "@cloudmarkup/graph-preparation/catalog-selection";
import {
  createArchitectureGeometryContext,
  type ArchitectureGeometry,
  type BoundaryGeometryOverflow,
} from "./architecture-geometry.js";
import {
  architectureBoundaryLevel,
  isVisualContainmentEdge,
  projectArchitectureAssociationBadges,
  projectArchitectureEducation,
  projectArchitectureOwnedConfigurationSummaries,
  projectArchitecturePrimaryFacts,
  type ArchitectureAssociationBadge,
  type ArchitectureBoundaryLevel,
  type ArchitectureEducationPresentation,
  type ArchitectureOwnedConfigurationSummary,
  type ArchitecturePresentationFact,
} from "./architecture-presentation-projection.js";

type ProjectionIndex = ReturnType<typeof createArchitectureGeometryContext> &
  ArchitectureDocumentIndex;

const UNKNOWN_ICON_ID = "cloudmarkup.icon.unknown";

/**
 * Reviewed presentation-only translations from exact catalog-authored source
 * port names to short edge purposes. The adapter deliberately does not infer
 * meaning from provider IDs, relationship IDs, or capability IDs.
 */
const CONCISE_EDGE_PURPOSE_BY_SOURCE_PORT_DISPLAY_NAME: Readonly<
  Record<string, string>
> = {
  "App client registration": "Registers client",
  "Assumable role": "Provides role",
  "Data read": "Reads",
  "Data write": "Writes",
  "DynamoDB resource": "Scopes access",
  "JWT audience": "Provides audience",
  "JWT issuer": "Provides authentication",
  Logging: "Sends logs",
  "Network client": "Uses network",
  "Role policy": "Attaches policy",
  "Route invocation": "Invokes",
  Telemetry: "Sends metrics",
};

export type ArchitectureCatalogBinding =
  | {
      readonly kind: "exact";
    }
  | {
      readonly kind: "mismatch";
      readonly label: "Catalog unavailable";
      readonly detail: string;
    };

export type ArchitectureNodeSupport =
  | {
      readonly kind: "available";
      readonly label: string;
      readonly detail: string;
    }
  | {
      readonly kind: "unsupported";
      readonly label: string;
      readonly detail: string;
    }
  | {
      readonly kind: "unknown";
      readonly label: "Unknown resource";
      readonly detail: string;
    };

export interface ArchitecturePortData {
  readonly id: string;
  readonly groupId: string;
  readonly handleId: string;
  readonly label: string;
  readonly displayName: string;
  readonly description: string;
  readonly direction: EditorPortDirection;
  readonly capability: string | null;
  readonly category: import("./editor-catalog.js").EditorConnectionCategory;
  readonly cardinality: "one" | "many" | null;
  readonly required: boolean | null;
  readonly actionable: boolean;
  readonly hasExistingEdge: boolean;
  readonly binding: "catalog" | "edge-reference";
}

export interface ArchitectureConnectionGroupData {
  readonly allowsMultipleEdges: boolean;
  readonly cardinality: EditorConnectionGroup["cardinality"];
  readonly category: EditorConnectionGroupCategory;
  readonly containsExclusiveRelationships: boolean;
  readonly currentEdgeIds: readonly string[];
  readonly description: string;
  readonly direction: EditorConnectionGroup["direction"];
  readonly exclusivePortIds: readonly string[];
  readonly guidedAssistance: string;
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly portIds: readonly string[];
  readonly ports: readonly ArchitecturePortData[];
  readonly professionalMetadata: string;
  readonly side: EditorConnectionDockSide;
}

export type ArchitectureNodeData = {
  readonly associationBadges: readonly ArchitectureAssociationBadge[];
  readonly architectureNodeId: ArchitectureNode["id"];
  readonly boundaryLevel: ArchitectureBoundaryLevel | null;
  readonly childNodeIds: readonly ArchitectureNode["id"][];
  readonly childCount: number;
  readonly declaredNodeKind?: EditorNodeKind;
  readonly deploymentKey: ArchitectureNode["semantic"]["deploymentKey"];
  readonly connectionGroups: readonly ArchitectureConnectionGroupData[];
  readonly description: string;
  readonly education: ArchitectureEducationPresentation | null;
  readonly fallbackReason: "unknown-service" | "unsupported-service" | null;
  readonly iconId: string | null;
  readonly label: string;
  readonly lifecycleLabel: string;
  readonly lifecycleOwnership: ArchitectureNode["semantic"]["lifecycle"]["ownership"];
  readonly nodeKind: "resource" | "boundary" | "fallback";
  readonly parentNodeId: ArchitectureNode["id"] | null;
  readonly ownedConfigurationSummaries: readonly ArchitectureOwnedConfigurationSummary[];
  readonly ports: readonly ArchitecturePortData[];
  readonly primaryFacts: readonly ArchitecturePresentationFact[];
  readonly resourceType: ArchitectureNode["semantic"]["resourceType"];
  readonly serviceName: string;
  readonly serviceType: ArchitectureNode["semantic"]["serviceType"];
  readonly support: ArchitectureNodeSupport;
} & Record<string, unknown>;

export type ArchitectureRelationshipBinding =
  | {
      readonly kind: "catalog";
      readonly description: string;
    }
  | {
      readonly kind: "generic";
      readonly description: string;
    };

export type ArchitectureEdgeData = {
  readonly architectureEdgeId: ArchitectureEdge["id"];
  readonly label: string;
  readonly lifecycleOwnership: ArchitectureEdge["semantic"]["lifecycle"]["ownership"];
  readonly relationship: ArchitectureRelationshipBinding;
  readonly relationshipType: ArchitectureEdge["semantic"]["relationshipType"];
  readonly sourceConnectionGroupId: string;
  readonly sourceDockCount: number;
  readonly sourceDockRank: number;
  readonly sourceDockSide: EditorConnectionDockSide;
  readonly sourcePortId: ArchitectureEdge["semantic"]["source"]["port"];
  readonly sourceLabel: string;
  readonly targetConnectionGroupId: string;
  readonly targetDockCount: number;
  readonly targetDockRank: number;
  readonly targetDockSide: EditorConnectionDockSide;
  readonly targetPortId: ArchitectureEdge["semantic"]["target"]["port"];
  readonly targetLabel: string;
  readonly isGenericFallback: boolean;
  readonly visualRole: "association" | "containment" | "relationship";
} & Record<string, unknown>;

export type ArchitectureFlowNode = Node<
  ArchitectureNodeData,
  "resource" | "boundary" | "fallback"
> & {
  readonly ariaLabel: string;
};

export type ArchitectureFlowEdge = Edge<ArchitectureEdgeData, "semantic"> & {
  readonly ariaLabel: string;
};

export interface ArchitectureFlowModel {
  readonly catalogBinding: ArchitectureCatalogBinding;
  readonly geometryOverflows: readonly BoundaryGeometryOverflow[];
  readonly nodes: readonly ArchitectureFlowNode[];
  readonly edges: readonly ArchitectureFlowEdge[];
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function referencedPortsForNode(
  nodeId: ArchitectureNode["id"],
  edges: readonly ArchitectureEdge[],
): readonly ArchitecturePortData[] {
  const references = new Map<string, ArchitecturePortData>();

  for (const edge of [...edges].sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    if (edge.semantic.source.nodeId === nodeId) {
      const portId = edge.semantic.source.port;
      if (!references.has(portId)) {
        references.set(portId, {
          id: portId,
          groupId: "other",
          handleId: editorDockHandleId("other", "output"),
          label: `Unverified port: ${portId}`,
          displayName: `Unverified port: ${portId}`,
          description:
            "This output port is referenced by the document but is not available in the bound catalog.",
          direction: "output",
          capability: null,
          category: "other",
          cardinality: null,
          required: null,
          actionable: false,
          hasExistingEdge: true,
          binding: "edge-reference",
        });
      }
    }

    if (edge.semantic.target.nodeId === nodeId) {
      const portId = edge.semantic.target.port;
      if (!references.has(portId)) {
        references.set(portId, {
          id: portId,
          groupId: "other",
          handleId: editorDockHandleId("other", "input"),
          label: `Unverified port: ${portId}`,
          displayName: `Unverified port: ${portId}`,
          description:
            "This input port is referenced by the document but is not available in the bound catalog.",
          direction: "input",
          capability: null,
          category: "other",
          cardinality: null,
          required: null,
          actionable: false,
          hasExistingEdge: true,
          binding: "edge-reference",
        });
      }
    }
  }

  return [...references.values()].sort((left, right) =>
    compareText(left.id, right.id),
  );
}

function catalogPorts(
  service: EditorCatalogService,
  nodeId: ArchitectureNode["id"],
  edges: readonly ArchitectureEdge[],
): readonly ArchitecturePortData[] {
  const ports = new Map<string, ArchitecturePortData>();
  const groupIdByPortId = new Map(
    resolveEditorConnectionGroups(service).flatMap((group) =>
      group.portIds.map((portId) => [portId, group.id] as const),
    ),
  );
  const referencedPorts = referencedPortsForNode(nodeId, edges);
  const referencedPortIds = new Set(
    referencedPorts.map((referencedPort) => referencedPort.id),
  );

  for (const port of service.ports) {
    const exactDefinitions = service.ports.filter(
      (candidate) => candidate.id === port.id,
    );
    if (exactDefinitions.length === 1 && !ports.has(port.id)) {
      const groupId = groupIdByPortId.get(port.id);
      ports.set(
        port.id,
        mapCatalogPort(
          port,
          referencedPortIds.has(port.id),
          groupId ?? "other",
          groupId !== undefined,
        ),
      );
    }
  }

  for (const referencedPort of referencedPorts) {
    if (!ports.has(referencedPort.id)) {
      ports.set(referencedPort.id, referencedPort);
    }
  }

  return [...ports.values()].sort((left, right) =>
    compareText(left.id, right.id),
  );
}

function mapCatalogPort(
  port: EditorCatalogPort,
  hasExistingEdge: boolean,
  groupId: string,
  groupIsValid: boolean,
): ArchitecturePortData {
  return {
    id: port.id,
    groupId,
    handleId: editorDockHandleId(groupId, port.direction),
    label: port.displayName,
    displayName: port.displayName,
    description: port.description,
    direction: port.direction,
    capability: port.capability,
    category: port.category,
    cardinality: port.cardinality,
    required: port.required,
    actionable: groupIsValid && port.connectionSupport === "supported",
    hasExistingEdge,
    binding: "catalog",
  };
}

function groupCurrentEdgeIds(
  nodeId: ArchitectureNode["id"],
  portIds: readonly string[],
  edges: readonly ArchitectureEdge[],
): readonly string[] {
  const ports = new Set(portIds);
  return edges
    .filter(
      (edge) =>
        (edge.semantic.source.nodeId === nodeId &&
          ports.has(edge.semantic.source.port)) ||
        (edge.semantic.target.nodeId === nodeId &&
          ports.has(edge.semantic.target.port)),
    )
    .map((edge) => edge.id)
    .sort(compareText);
}

function connectionGroupsForNode(
  service: EditorCatalogService | undefined,
  nodeId: ArchitectureNode["id"],
  ports: readonly ArchitecturePortData[],
  edges: readonly ArchitectureEdge[],
): readonly ArchitectureConnectionGroupData[] {
  const groups =
    service === undefined
      ? ports.length === 0
        ? []
        : [
            {
              allowsMultipleEdges: true,
              cardinality: {
                enforcement: "semantic-port" as const,
                maximum: "many" as const,
                minimum: 0 as const,
              },
              category: "other" as const,
              containsExclusiveRelationships: false,
              description:
                "Ports referenced by the document but unavailable in the exact catalog.",
              direction: "mixed" as const,
              exclusivePortIds: [],
              guidedAssistance:
                "Review these connections after restoring the exact bound catalog.",
              id: "other",
              label: "Unverified connections",
              order: 0,
              portIds: ports.map((port) => port.id),
              professionalMetadata:
                "Exact semantic ports retained from the Architecture Document.",
              side: "bottom" as const,
            },
          ]
      : resolveEditorConnectionGroups(service);

  return groups.map((group) => ({
    allowsMultipleEdges: group.allowsMultipleEdges,
    cardinality: group.cardinality,
    category: group.category,
    containsExclusiveRelationships: group.containsExclusiveRelationships,
    currentEdgeIds: groupCurrentEdgeIds(nodeId, group.portIds, edges),
    description: group.description,
    direction: group.direction,
    exclusivePortIds: group.exclusivePortIds,
    guidedAssistance: group.guidedAssistance,
    id: group.id,
    label: group.label,
    order: group.order,
    portIds: group.portIds,
    ports: ports.filter((port) => group.portIds.includes(port.id)),
    professionalMetadata: group.professionalMetadata,
    side: group.side,
  }));
}

function lifecycleLabel(
  ownership: ArchitectureNode["semantic"]["lifecycle"]["ownership"],
): string {
  switch (ownership) {
    case "user":
      return "User-owned";
    case "generated":
      return "Generated";
    case "adopted":
      return "Adopted";
  }
}

function nodeAccessibleLabel(
  data: ArchitectureNodeData,
  index: ProjectionIndex,
): string {
  const parent =
    data.parentNodeId === null
      ? undefined
      : index.nodesById.get(data.parentNodeId);
  // Stable IDs and full configuration remain available in the inspector. The
  // canvas name lets keyboard and screen-reader users scan the service list.
  return [
    data.label,
    data.serviceName,
    data.support.label,
    data.lifecycleLabel,
    ...(parent === undefined ? [] : ["In " + parent.presentation.label]),
    ...(data.childCount === 0
      ? []
      : [
          `Contains ${String(data.childCount)} ${data.childCount === 1 ? "item" : "items"}`,
        ]),
  ].join(". ");
}

function edgeAccessibleLabel(
  edge: ArchitectureEdge,
  data: ArchitectureEdgeData,
): string {
  return [
    data.label,
    `Relationship type ${data.relationshipType}`,
    `From ${data.sourceLabel}, port ${data.sourcePortId}`,
    `To ${data.targetLabel}, port ${data.targetPortId}`,
    `Architecture relationship ${data.architectureEdgeId}`,
    lifecycleLabel(edge.semantic.lifecycle.ownership),
    `Visual role ${data.visualRole}`,
    data.relationship.description,
  ].join(". ");
}

function availableNodeData(
  node: ArchitectureNode,
  service: EditorCatalogService,
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  index: ProjectionIndex,
): ArchitectureNodeData {
  const support: ArchitectureNodeSupport =
    service.supportState === "available"
      ? {
          kind: "available",
          label: service.supportLabel,
          detail: service.supportDetail,
        }
      : {
          kind: "unsupported",
          label: service.supportLabel,
          detail: service.supportDetail,
        };

  const children = (index.childrenByParentId.get(node.id) ?? []).map(
    (child) => child.id,
  );
  const fallbackReason =
    service.supportState === "unsupported" ? "unsupported-service" : null;
  const renderedNodeKind =
    service.supportState === "unsupported" ? "fallback" : service.nodeKind;
  const edges = index.incidentEdges.get(node.id) ?? [];
  const ports = catalogPorts(service, node.id, edges);
  const connectionGroups = connectionGroupsForNode(
    service,
    node.id,
    ports,
    edges,
  );

  return {
    associationBadges: projectArchitectureAssociationBadges(
      document,
      catalog,
      connectionGroups,
    ),
    architectureNodeId: node.id,
    boundaryLevel: architectureBoundaryLevel(document, catalog, node),
    childNodeIds: children,
    childCount: children.length,
    declaredNodeKind: service.nodeKind,
    deploymentKey: node.semantic.deploymentKey,
    connectionGroups,
    description: service.description,
    education: projectArchitectureEducation(service),
    fallbackReason,
    iconId: service.iconId,
    label: node.presentation.label,
    lifecycleLabel: lifecycleLabel(node.semantic.lifecycle.ownership),
    lifecycleOwnership: node.semantic.lifecycle.ownership,
    nodeKind: renderedNodeKind,
    parentNodeId: node.semantic.parent?.nodeId ?? null,
    ownedConfigurationSummaries: projectArchitectureOwnedConfigurationSummaries(
      document,
      catalog,
      node,
      service,
    ),
    ports,
    primaryFacts: projectArchitecturePrimaryFacts(node, service),
    resourceType: node.semantic.resourceType,
    serviceName: service.displayName,
    serviceType: node.semantic.serviceType,
    support,
  };
}

function unknownNodeData(
  node: ArchitectureNode,
  catalogIsExact: boolean,
  index: ProjectionIndex,
): ArchitectureNodeData {
  const children = (index.childrenByParentId.get(node.id) ?? []).map(
    (child) => child.id,
  );
  const edges = index.incidentEdges.get(node.id) ?? [];
  const ports = referencedPortsForNode(node.id, edges);

  return {
    associationBadges: [],
    architectureNodeId: node.id,
    boundaryLevel: null,
    childNodeIds: children,
    childCount: children.length,
    deploymentKey: node.semantic.deploymentKey,
    connectionGroups: connectionGroupsForNode(undefined, node.id, ports, edges),
    description: catalogIsExact
      ? "No unique exact service and resource definition exists in the bound catalog."
      : "The document catalog identity does not exactly match the supplied editor catalog.",
    iconId: UNKNOWN_ICON_ID,
    education: null,
    label: node.presentation.label,
    lifecycleLabel: lifecycleLabel(node.semantic.lifecycle.ownership),
    lifecycleOwnership: node.semantic.lifecycle.ownership,
    fallbackReason: "unknown-service",
    nodeKind: "fallback",
    parentNodeId: node.semantic.parent?.nodeId ?? null,
    ownedConfigurationSummaries: [],
    ports,
    primaryFacts: [],
    resourceType: node.semantic.resourceType,
    serviceName: "Unknown resource",
    serviceType: node.semantic.serviceType,
    support: {
      kind: "unknown",
      label: "Unknown resource",
      detail: catalogIsExact
        ? "The document remains visible, but this resource cannot use catalog-specific presentation."
        : "The document remains visible with generic presentation until its exact catalog is available.",
    },
  };
}

function nodeType(
  service: EditorCatalogService | undefined,
): ArchitectureFlowNode["type"] {
  if (service === undefined || service.supportState === "unsupported") {
    return "fallback";
  }
  return service.nodeKind;
}

function mapNode(
  node: ArchitectureNode,
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  catalogIsExact: boolean,
  geometry: ArchitectureGeometry,
  index: ProjectionIndex,
  positionOverrides:
    ReadonlyMap<string, { readonly x: number; readonly y: number }> | undefined,
): ArchitectureFlowNode {
  const service = index.servicesByNodeId.get(node.id);
  const data =
    service === undefined
      ? unknownNodeData(node, catalogIsExact, index)
      : availableNodeData(node, service, document, catalog, index);
  const parentId = index.parentsByNodeId.get(node.id) ?? null;
  const size = geometry.sizes.get(node.id);

  return {
    id: node.id,
    type: nodeType(service),
    position: positionOverrides?.get(node.id) ?? {
      x: node.presentation.position.x,
      y: node.presentation.position.y,
    },
    ...(parentId === null ? {} : { parentId }),
    data,
    focusable: true,
    selectable: true,
    deletable: false,
    connectable:
      service !== undefined && data.ports.some((port) => port.actionable),
    ariaLabel: nodeAccessibleLabel(data, index),
    zIndex: service?.nodeKind === "boundary" ? 0 : 1,
    draggable: true,
    ...(size === undefined
      ? {}
      : {
          initialHeight: size.height,
          initialWidth: size.width,
          style: {
            height: size.height,
            width: size.width,
          },
        }),
  };
}

function conciseEdgeLabel(
  edge: ArchitectureEdge,
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  catalogIsExact: boolean,
  index: ProjectionIndex,
): string {
  if (!catalogIsExact) {
    return "Relationship";
  }

  const sourceNode = index.nodesById.get(edge.semantic.source.nodeId);
  if (sourceNode === undefined) {
    return "Relationship";
  }

  const sourcePorts =
    resolveExactEditorCatalogService(
      document,
      sourceNode,
      catalog,
    )?.ports.filter(
      (port) =>
        port.id === edge.semantic.source.port && port.direction === "output",
    ) ?? [];
  const sourcePortDisplayName =
    sourcePorts.length === 1 ? sourcePorts[0]?.displayName : undefined;
  if (sourcePortDisplayName === undefined) {
    return "Relationship";
  }

  return (
    CONCISE_EDGE_PURPOSE_BY_SOURCE_PORT_DISPLAY_NAME[sourcePortDisplayName] ??
    sourcePortDisplayName
  );
}

function endpointConnectionGroup(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  catalogIsExact: boolean,
  nodeId: ArchitectureNode["id"],
  portId: string,
  index: ProjectionIndex,
): { readonly id: string; readonly side: EditorConnectionDockSide } {
  if (!catalogIsExact) {
    return { id: "other", side: "bottom" };
  }
  const node = index.nodesById.get(nodeId);
  if (node === undefined) {
    return { id: "other", side: "bottom" };
  }
  const service = resolveExactEditorCatalogService(document, node, catalog);
  if (service === undefined) {
    return { id: "other", side: "bottom" };
  }
  const group = editorConnectionGroupForPort(service, portId);
  return group === undefined
    ? { id: "other", side: "bottom" }
    : { id: group.id, side: group.side };
}

function mapEdge(
  edge: ArchitectureEdge,
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  catalogIsExact: boolean,
  index: ProjectionIndex,
): ArchitectureFlowEdge {
  const relationship = catalogIsExact
    ? resolveExactEditorCatalogRelationship(
        document,
        edge,
        catalog,
        index.nodesById,
      )
    : undefined;
  const label =
    relationship === undefined
      ? "Relationship"
      : (relationship.presentationLabel ??
        conciseEdgeLabel(edge, document, catalog, catalogIsExact, index));
  const relationshipBinding: ArchitectureRelationshipBinding =
    relationship === undefined
      ? {
          kind: "generic",
          description:
            "No unique exact relationship presentation exists in the bound catalog.",
        }
      : {
          kind: "catalog",
          description: relationship.description,
        };
  const sourceLabel =
    index.nodesById.get(edge.semantic.source.nodeId)?.presentation.label ??
    edge.semantic.source.nodeId;
  const targetLabel =
    index.nodesById.get(edge.semantic.target.nodeId)?.presentation.label ??
    edge.semantic.target.nodeId;
  const visualRole = isVisualContainmentEdge(document, catalog, edge)
    ? ("containment" as const)
    : relationship?.category === "network-and-security"
      ? ("association" as const)
      : ("relationship" as const);

  const sourceGroup = endpointConnectionGroup(
    document,
    catalog,
    catalogIsExact,
    edge.semantic.source.nodeId,
    edge.semantic.source.port,
    index,
  );
  const targetGroup = endpointConnectionGroup(
    document,
    catalog,
    catalogIsExact,
    edge.semantic.target.nodeId,
    edge.semantic.target.port,
    index,
  );
  const data: ArchitectureEdgeData = {
    architectureEdgeId: edge.id,
    label,
    lifecycleOwnership: edge.semantic.lifecycle.ownership,
    relationship: relationshipBinding,
    relationshipType: edge.semantic.relationshipType,
    sourceConnectionGroupId: sourceGroup.id,
    sourceDockCount: 1,
    sourceDockRank: 0,
    sourceDockSide: sourceGroup.side,
    sourcePortId: edge.semantic.source.port,
    sourceLabel,
    targetConnectionGroupId: targetGroup.id,
    targetDockCount: 1,
    targetDockRank: 0,
    targetDockSide: targetGroup.side,
    targetPortId: edge.semantic.target.port,
    targetLabel,
    isGenericFallback: relationship === undefined,
    visualRole,
  };

  return {
    id: edge.id,
    type: "semantic",
    source: edge.semantic.source.nodeId,
    target: edge.semantic.target.nodeId,
    sourceHandle: editorDockHandleId(sourceGroup.id, "output"),
    targetHandle: editorDockHandleId(targetGroup.id, "input"),
    label,
    data,
    deletable: false,
    focusable: true,
    selectable: true,
    reconnectable: false,
    ariaLabel: edgeAccessibleLabel(edge, data),
  };
}

function withDeterministicDockFanout(
  edges: readonly ArchitectureFlowEdge[],
): readonly ArchitectureFlowEdge[] {
  interface Bucket {
    count: number;
    ranks: Map<string, number>;
  }
  const sourceBuckets = new Map<string, Bucket>();
  const targetBuckets = new Map<string, Bucket>();
  for (const edge of edges) {
    for (const [buckets, key] of [
      [sourceBuckets, edge.source + ":" + (edge.sourceHandle ?? "")],
      [targetBuckets, edge.target + ":" + (edge.targetHandle ?? "")],
    ] as const) {
      const bucket = buckets.get(key) ?? {
        count: 0,
        ranks: new Map<string, number>(),
      };
      if (!bucket.ranks.has(edge.id)) bucket.ranks.set(edge.id, bucket.count);
      bucket.count += 1;
      buckets.set(key, bucket);
    }
  }
  return edges.map((edge) => {
    if (edge.data === undefined) return edge;
    const source = sourceBuckets.get(
      edge.source + ":" + (edge.sourceHandle ?? ""),
    );
    const target = targetBuckets.get(
      edge.target + ":" + (edge.targetHandle ?? ""),
    );
    return {
      ...edge,
      data: {
        ...edge.data,
        sourceDockCount: source?.count ?? 1,
        sourceDockRank: source?.ranks.get(edge.id) ?? 0,
        targetDockCount: target?.count ?? 1,
        targetDockRank: target?.ranks.get(edge.id) ?? 0,
      },
    };
  });
}

export function createArchitectureFlowProjection(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
) {
  const topology = createArchitectureGeometryContext(document, catalog);
  const index: ProjectionIndex = {
    ...createArchitectureDocumentIndex(document),
    ...topology,
  };
  const catalogIsExact = hasExactEditorCatalogBinding(document, catalog);
  const geometry = topology.geometry();
  const model: ArchitectureFlowModel = {
    catalogBinding: catalogIsExact
      ? { kind: "exact" }
      : {
          kind: "mismatch",
          label: "Catalog unavailable",
          detail:
            "The supplied editor catalog does not exactly match the document catalog identity.",
        },
    geometryOverflows: geometry.overflows,
    nodes: topology.orderedNodes
      .filter((node) => topology.visibleNodeIds.has(node.id))
      .map((node) =>
        mapNode(
          node,
          document,
          catalog,
          catalogIsExact,
          geometry,
          index,
          undefined,
        ),
      ),
    edges: withDeterministicDockFanout(
      [...document.edges]
        .filter(
          (edge) =>
            topology.visibleNodeIds.has(edge.semantic.source.nodeId) &&
            topology.visibleNodeIds.has(edge.semantic.target.nodeId),
        )
        .sort((left, right) => compareText(left.id, right.id))
        .map((edge) => mapEdge(edge, document, catalog, catalogIsExact, index)),
    ),
  };
  return {
    model,
    validatePositions: topology.validatePositions,
    projectPositions(
      overrides: ReadonlyMap<
        string,
        { readonly x: number; readonly y: number }
      >,
    ): ArchitectureFlowModel {
      if (overrides.size === 0) return model;
      const geometry = topology.geometry(overrides);
      return {
        ...model,
        geometryOverflows: geometry.overflows,
        nodes: model.nodes.map((node) => {
          const position = overrides.get(node.id) ?? node.position;
          const architectureNode = index.nodesById.get(node.id);
          const size =
            architectureNode === undefined
              ? undefined
              : geometry.sizes.get(architectureNode.id);
          if (
            position.x === node.position.x &&
            position.y === node.position.y &&
            size?.width === node.initialWidth &&
            size?.height === node.initialHeight
          )
            return node;
          return {
            ...node,
            position,
            ...(size === undefined
              ? {}
              : {
                  initialWidth: size.width,
                  initialHeight: size.height,
                  style: {
                    ...node.style,
                    height: size.height,
                    width: size.width,
                  },
                }),
          };
        }),
      };
    },
  };
}

export function mapArchitectureDocumentToFlow(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  positionOverrides?: ReadonlyMap<
    string,
    { readonly x: number; readonly y: number }
  >,
): ArchitectureFlowModel {
  const projection = createArchitectureFlowProjection(document, catalog);
  return positionOverrides === undefined
    ? projection.model
    : projection.projectPositions(positionOverrides);
}
