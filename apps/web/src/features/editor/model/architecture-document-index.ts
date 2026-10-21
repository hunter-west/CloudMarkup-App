import type {
  ArchitectureDocument,
  ArchitectureEdge,
  ArchitectureNode,
} from "@cloudmarkup/domain";

export interface ArchitectureDocumentIndex {
  readonly nodesById: ReadonlyMap<string, ArchitectureNode>;
  readonly edgesById: ReadonlyMap<string, ArchitectureEdge>;
  readonly incidentEdges: ReadonlyMap<string, readonly ArchitectureEdge[]>;
}

/** One document only; consumers replace this index when its immutable input changes. */
export function createArchitectureDocumentIndex(
  document: ArchitectureDocument,
): ArchitectureDocumentIndex {
  const incidentEdges = new Map<string, ArchitectureEdge[]>();
  for (const edge of document.edges) {
    for (const id of new Set([
      edge.semantic.source.nodeId,
      edge.semantic.target.nodeId,
    ])) {
      const edges = incidentEdges.get(id) ?? [];
      edges.push(edge);
      incidentEdges.set(id, edges);
    }
  }
  return {
    nodesById: new Map(document.nodes.map((node) => [node.id, node])),
    edgesById: new Map(document.edges.map((edge) => [edge.id, edge])),
    incidentEdges,
  };
}
