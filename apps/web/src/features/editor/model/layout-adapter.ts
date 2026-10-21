export const MAX_LAYOUT_DIMENSION = 100_000;
export const MAX_LAYOUT_COORDINATE = 1_000_000;

export type LayoutPortDirection = "input" | "output";

export interface LayoutPort {
  readonly id: string;
  readonly direction: LayoutPortDirection;
}

export interface LayoutNode {
  readonly id: string;
  readonly parentId?: string;
  readonly width: number;
  readonly height: number;
  readonly ports: readonly LayoutPort[];
}

export interface LayoutEdgeEndpoint {
  readonly nodeId: string;
  readonly portId: string;
}

export interface LayoutEdge {
  readonly id: string;
  readonly source: LayoutEdgeEndpoint;
  readonly target: LayoutEdgeEndpoint;
}

/**
 * Provider-neutral, flat input to an automatic-layout adapter.
 *
 * Parent relationships are visual containment projections that have already
 * passed semantic placement validation. An adapter may build a nested engine
 * graph, but it cannot reinterpret or change those relationships.
 */
export interface LayoutRequest {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
}

export interface CanonicalLayoutRequest {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
}

export interface LayoutPosition {
  readonly nodeId: string;
  readonly parentId: string | null;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
}

/**
 * Only parent-relative node positions cross the adapter boundary. Engine
 * sections, port coordinates, dimensions, options, and worker state remain
 * transient.
 */
export interface LayoutResult {
  readonly positions: readonly LayoutPosition[];
}

export interface LayoutRunOptions {
  readonly signal?: AbortSignal;
}

export interface LayoutAdapter {
  layout(
    request: LayoutRequest,
    options?: LayoutRunOptions,
  ): Promise<LayoutResult>;
}

export type LayoutAdapterErrorCode =
  "aborted" | "engine-failed" | "invalid-request" | "invalid-result";

export class LayoutAdapterError extends Error {
  public readonly code: LayoutAdapterErrorCode;
  public readonly path: string;

  public constructor(
    code: LayoutAdapterErrorCode,
    path: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LayoutAdapterError";
    this.code = code;
    this.path = path;
  }
}

export class LayoutCanceledError extends LayoutAdapterError {
  public constructor() {
    super(
      "aborted",
      "$",
      "Automatic layout was canceled. No positions were returned.",
    );
    this.name = "LayoutCanceledError";
  }
}

export function isLayoutCanceledError(
  error: unknown,
): error is LayoutCanceledError {
  return error instanceof LayoutCanceledError;
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

function invalidRequest(path: string, message: string): never {
  throw new LayoutAdapterError("invalid-request", path, message);
}

function requireStableId(value: string, path: string): void {
  if (value.trim().length === 0) {
    invalidRequest(path, "Layout identities must not be empty.");
  }
}

function requireDimension(value: number, path: string): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_LAYOUT_DIMENSION) {
    invalidRequest(
      path,
      `Layout dimensions must be finite, positive, and no greater than ${String(
        MAX_LAYOUT_DIMENSION,
      )}.`,
    );
  }
}

function cloneCanonicalPort(port: LayoutPort): LayoutPort {
  return Object.freeze({
    direction: port.direction,
    id: port.id,
  });
}

function cloneCanonicalNode(node: LayoutNode): LayoutNode {
  return Object.freeze({
    height: node.height,
    id: node.id,
    ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
    ports: Object.freeze(
      [...node.ports]
        .sort((left, right) => compareText(left.id, right.id))
        .map(cloneCanonicalPort),
    ),
    width: node.width,
  });
}

function cloneCanonicalEndpoint(
  endpoint: LayoutEdgeEndpoint,
): LayoutEdgeEndpoint {
  return Object.freeze({
    nodeId: endpoint.nodeId,
    portId: endpoint.portId,
  });
}

function cloneCanonicalEdge(edge: LayoutEdge): LayoutEdge {
  return Object.freeze({
    id: edge.id,
    source: cloneCanonicalEndpoint(edge.source),
    target: cloneCanonicalEndpoint(edge.target),
  });
}

function validateNodes(
  nodes: readonly LayoutNode[],
): ReadonlyMap<string, LayoutNode> {
  const byId = new Map<string, LayoutNode>();

  nodes.forEach((node, nodeIndex) => {
    const nodePath = `$.nodes[${String(nodeIndex)}]`;
    requireStableId(node.id, `${nodePath}.id`);
    requireDimension(node.width, `${nodePath}.width`);
    requireDimension(node.height, `${nodePath}.height`);

    if (byId.has(node.id)) {
      invalidRequest(`${nodePath}.id`, "Layout node IDs must be unique.");
    }
    byId.set(node.id, node);

    const portIds = new Set<string>();
    node.ports.forEach((port, portIndex) => {
      const portPath = `${nodePath}.ports[${String(portIndex)}]`;
      requireStableId(port.id, `${portPath}.id`);
      if (portIds.has(port.id)) {
        invalidRequest(
          `${portPath}.id`,
          "Port IDs must be unique within a layout node.",
        );
      }
      portIds.add(port.id);
    });
  });

  nodes.forEach((node, nodeIndex) => {
    if (node.parentId === undefined) {
      return;
    }
    const path = `$.nodes[${String(nodeIndex)}].parentId`;
    requireStableId(node.parentId, path);
    if (node.parentId === node.id) {
      invalidRequest(path, "A layout node cannot be its own parent.");
    }
    if (!byId.has(node.parentId)) {
      invalidRequest(path, "A layout parent must reference an existing node.");
    }
  });

  for (const node of nodes) {
    const seen = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId !== undefined) {
      if (seen.has(parentId)) {
        invalidRequest(
          `$.nodes.${node.id}.parentId`,
          "Layout parent relationships must not form a cycle.",
        );
      }
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  }

  return byId;
}

function validateEdges(
  edges: readonly LayoutEdge[],
  nodesById: ReadonlyMap<string, LayoutNode>,
): void {
  const edgeIds = new Set<string>();

  edges.forEach((edge, edgeIndex) => {
    const edgePath = `$.edges[${String(edgeIndex)}]`;
    requireStableId(edge.id, `${edgePath}.id`);
    if (edgeIds.has(edge.id)) {
      invalidRequest(`${edgePath}.id`, "Layout edge IDs must be unique.");
    }
    edgeIds.add(edge.id);

    const sourceNode = nodesById.get(edge.source.nodeId);
    const targetNode = nodesById.get(edge.target.nodeId);
    if (sourceNode === undefined) {
      invalidRequest(
        `${edgePath}.source.nodeId`,
        "A layout edge source must reference an existing node.",
      );
    }
    if (targetNode === undefined) {
      invalidRequest(
        `${edgePath}.target.nodeId`,
        "A layout edge target must reference an existing node.",
      );
    }

    const sourcePort = sourceNode.ports.find(
      (port) => port.id === edge.source.portId,
    );
    const targetPort = targetNode.ports.find(
      (port) => port.id === edge.target.portId,
    );
    if (sourcePort === undefined) {
      invalidRequest(
        `${edgePath}.source.portId`,
        "A layout edge source must reference an existing typed port.",
      );
    }
    if (targetPort === undefined) {
      invalidRequest(
        `${edgePath}.target.portId`,
        "A layout edge target must reference an existing typed port.",
      );
    }
    if (sourcePort.direction !== "output") {
      invalidRequest(
        `${edgePath}.source.portId`,
        "A layout edge source must reference an output port.",
      );
    }
    if (targetPort.direction !== "input") {
      invalidRequest(
        `${edgePath}.target.portId`,
        "A layout edge target must reference an input port.",
      );
    }
  });
}

function parentFirstNodes(
  nodes: readonly LayoutNode[],
  nodesById: ReadonlyMap<string, LayoutNode>,
): readonly LayoutNode[] {
  const childrenByParent = new Map<string | null, LayoutNode[]>();
  for (const node of nodes) {
    const parentId = node.parentId ?? null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => compareText(left.id, right.id));
  }

  const ordered: LayoutNode[] = [];
  function visit(node: LayoutNode): void {
    ordered.push(node);
    for (const child of childrenByParent.get(node.id) ?? []) {
      visit(child);
    }
  }
  for (const root of childrenByParent.get(null) ?? []) {
    visit(root);
  }

  if (ordered.length !== nodesById.size) {
    invalidRequest(
      "$.nodes",
      "Every layout node must be reachable from exactly one root.",
    );
  }
  return ordered;
}

/**
 * Validates and canonicalizes request ordering without mutating caller data.
 * Roots and siblings use stable ID order; every parent precedes its descendants.
 */
export function canonicalizeLayoutRequest(
  request: LayoutRequest,
): CanonicalLayoutRequest {
  const nodesById = validateNodes(request.nodes);
  validateEdges(request.edges, nodesById);

  return Object.freeze({
    nodes: Object.freeze(
      parentFirstNodes(request.nodes, nodesById).map(cloneCanonicalNode),
    ),
    edges: Object.freeze(
      [...request.edges]
        .sort((left, right) => compareText(left.id, right.id))
        .map(cloneCanonicalEdge),
    ),
  });
}
