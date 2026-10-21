import type {
  ArchitectureDocument,
  ArchitectureEdge,
  ArchitectureNode,
} from "@cloudmarkup/domain";

import type {
  EditorCatalog,
  EditorCatalogRelationship,
  EditorCatalogService,
} from "./editor-catalog.js";

/**
 * Catalog binding is exact or unavailable. Route and selection identifiers are
 * never enough to opt a document into another catalog's presentation facts.
 */
export function hasExactEditorCatalogBinding(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
): boolean {
  return (
    document.provider.id === catalog.providerId &&
    document.catalog.id === catalog.identity.id &&
    document.catalog.version === catalog.identity.version &&
    document.catalog.digest === catalog.identity.digest
  );
}

export function resolveExactEditorCatalogService(
  document: ArchitectureDocument,
  node: ArchitectureNode,
  catalog: EditorCatalog,
): EditorCatalogService | undefined {
  if (!hasExactEditorCatalogBinding(document, catalog)) {
    return undefined;
  }

  const matches = catalog.services.filter(
    (service) =>
      service.serviceType === node.semantic.serviceType &&
      service.resourceType === node.semantic.resourceType,
  );

  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Exact non-deployable resources remain in the Architecture Document but are
 * surfaced only through their owning resource. Unknown nodes remain visible
 * for recovery when the exact catalog is unavailable.
 */
export function isArchitectureNodeNormallyVisible(
  document: ArchitectureDocument,
  node: ArchitectureNode,
  catalog: EditorCatalog,
): boolean {
  return (
    resolveExactEditorCatalogService(document, node, catalog)?.deployable !==
    false
  );
}

export function normallyVisibleArchitectureNodes(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
): readonly ArchitectureNode[] {
  return document.nodes.filter((node) =>
    isArchitectureNodeNormallyVisible(document, node, catalog),
  );
}

export function isArchitectureEdgeNormallyVisible(
  document: ArchitectureDocument,
  edge: ArchitectureEdge,
  catalog: EditorCatalog,
): boolean {
  const visibleNodeIds = new Set(
    normallyVisibleArchitectureNodes(document, catalog).map((node) => node.id),
  );
  return (
    visibleNodeIds.has(edge.semantic.source.nodeId) &&
    visibleNodeIds.has(edge.semantic.target.nodeId)
  );
}

export function resolveExactEditorCatalogRelationship(
  document: ArchitectureDocument,
  edge: ArchitectureEdge,
  catalog: EditorCatalog,
  nodesById?: ReadonlyMap<string, ArchitectureNode>,
): EditorCatalogRelationship | undefined {
  if (!hasExactEditorCatalogBinding(document, catalog)) {
    return undefined;
  }

  const sourceNode =
    nodesById === undefined
      ? document.nodes.find((node) => node.id === edge.semantic.source.nodeId)
      : nodesById.get(edge.semantic.source.nodeId);
  const targetNode =
    nodesById === undefined
      ? document.nodes.find((node) => node.id === edge.semantic.target.nodeId)
      : nodesById.get(edge.semantic.target.nodeId);
  if (sourceNode === undefined || targetNode === undefined) {
    return undefined;
  }

  const sourceService = resolveExactEditorCatalogService(
    document,
    sourceNode,
    catalog,
  );
  const targetService = resolveExactEditorCatalogService(
    document,
    targetNode,
    catalog,
  );
  if (
    sourceService?.supportState !== "available" ||
    targetService?.supportState !== "available"
  ) {
    return undefined;
  }

  const sourcePorts = sourceService.ports.filter(
    (port) =>
      port.id === edge.semantic.source.port && port.direction === "output",
  );
  const targetPorts = targetService.ports.filter(
    (port) =>
      port.id === edge.semantic.target.port && port.direction === "input",
  );
  if (sourcePorts.length !== 1 || targetPorts.length !== 1) {
    return undefined;
  }

  const matches = (catalog.relationships ?? []).filter(
    (relationship) =>
      relationship.id === edge.semantic.relationshipType &&
      relationship.sourceServiceType === sourceNode.semantic.serviceType &&
      relationship.sourcePortId === edge.semantic.source.port &&
      relationship.targetServiceType === targetNode.semantic.serviceType &&
      relationship.targetPortId === edge.semantic.target.port,
  );

  return matches.length === 1 ? matches[0] : undefined;
}
