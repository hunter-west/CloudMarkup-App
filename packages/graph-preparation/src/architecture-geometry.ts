import type {
  ArchitectureDocument,
  ArchitectureNode,
} from "@cloudmarkup/domain";

import { resolveExactEditorCatalogService } from "./catalog-selection.js";
import type { EditorCatalog, EditorCatalogService } from "./editor-catalog.js";
import { visualBoundaryParentId } from "./placement-rules.js";

export interface EditorPoint {
  readonly x: number;
  readonly y: number;
}

export interface EditorSize {
  readonly height: number;
  readonly width: number;
}

export interface BoundaryGeometryOverflow {
  readonly boundaryNodeId: ArchitectureNode["id"];
  readonly message: string;
}

export interface ArchitectureGeometry {
  readonly overflows: readonly BoundaryGeometryOverflow[];
  readonly sizes: ReadonlyMap<ArchitectureNode["id"], EditorSize>;
}

export class EditorGeometryError extends Error {
  public readonly code:
    | "ambiguous-boundary-target"
    | "coordinate-out-of-range"
    | "cycle"
    | "missing-node"
    | "non-finite-coordinate";

  public constructor(code: EditorGeometryError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "EditorGeometryError";
  }
}

export const EDITOR_GRID_SIZE = 8;
export const RESOURCE_NODE_HEIGHT = 96;
export const RESOURCE_NODE_WIDTH = 160;
export const BOUNDARY_MINIMUM_WIDTH = 352;
export const BOUNDARY_MINIMUM_HEIGHT = 256;
export const BOUNDARY_MAXIMUM_WIDTH = 4_096;
export const BOUNDARY_MAXIMUM_HEIGHT = 3_072;
export const BOUNDARY_CONTENT_LEFT = 32;
export const BOUNDARY_CONTENT_TOP = 160;
export const BOUNDARY_CONTENT_RIGHT = 32;
export const BOUNDARY_CONTENT_BOTTOM = 32;
export const MAXIMUM_EDITOR_COORDINATE = 1_000_000;

const resourcePlacementAnchorX = RESOURCE_NODE_WIDTH / 2;
const resourcePlacementAnchorY = RESOURCE_NODE_HEIGHT / 2;

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function checkedCoordinate(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new EditorGeometryError(
      "non-finite-coordinate",
      `${label} must be finite.`,
    );
  }
  if (Math.abs(value) > MAXIMUM_EDITOR_COORDINATE) {
    throw new EditorGeometryError(
      "coordinate-out-of-range",
      `${label} exceeds the supported editor coordinate range.`,
    );
  }
  return value;
}

export function checkedEditorPoint(
  point: EditorPoint,
  label = "Position",
): EditorPoint {
  return {
    x: checkedCoordinate(point.x, `${label} x`),
    y: checkedCoordinate(point.y, `${label} y`),
  };
}

export function snapEditorPoint(point: EditorPoint): EditorPoint {
  const checked = checkedEditorPoint(point);
  return checkedEditorPoint({
    x: Math.round(checked.x / EDITOR_GRID_SIZE) * EDITOR_GRID_SIZE,
    y: Math.round(checked.y / EDITOR_GRID_SIZE) * EDITOR_GRID_SIZE,
  });
}

export function canonicalServiceNodeSize(
  service: EditorCatalogService | undefined,
  serviceType: string,
): EditorSize {
  // Retain the service-type argument for callers that bind imported/unknown
  // resources; compact presentation no longer derives geometry from its text.
  void serviceType;
  if (service?.nodeKind === "boundary") {
    return {
      height: BOUNDARY_MINIMUM_HEIGHT,
      width: BOUNDARY_MINIMUM_WIDTH,
    };
  }

  return {
    height: RESOURCE_NODE_HEIGHT,
    width: RESOURCE_NODE_WIDTH,
  };
}

export function canonicalArchitectureNodeSize(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  node: ArchitectureNode,
): EditorSize {
  return canonicalServiceNodeSize(
    resolveExactEditorCatalogService(document, node, catalog),
    node.semantic.serviceType,
  );
}

function pointForNode(
  node: ArchitectureNode,
  overrides: ReadonlyMap<string, EditorPoint> | undefined,
): EditorPoint {
  return checkedEditorPoint(
    overrides?.get(node.id) ?? node.presentation.position,
    `Node ${node.id} position`,
  );
}

export function absoluteEditorNodePosition(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  nodeId: ArchitectureNode["id"],
  positionOverrides?: ReadonlyMap<string, EditorPoint>,
): EditorPoint {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const seen = new Set<ArchitectureNode["id"]>();

  function visit(currentId: ArchitectureNode["id"]): EditorPoint {
    if (seen.has(currentId)) {
      throw new EditorGeometryError(
        "cycle",
        "Cannot resolve coordinates through a parent cycle.",
      );
    }
    const node = nodes.get(currentId);
    if (node === undefined) {
      throw new EditorGeometryError(
        "missing-node",
        `Node ${currentId} does not exist.`,
      );
    }
    seen.add(currentId);
    const local = pointForNode(node, positionOverrides);
    const parentId = visualBoundaryParentId(document, catalog, node);
    const absolute =
      parentId === null
        ? local
        : (() => {
            const parent = visit(parentId);
            return checkedEditorPoint(
              {
                x: parent.x + local.x,
                y: parent.y + local.y,
              },
              `Node ${node.id} absolute position`,
            );
          })();
    seen.delete(currentId);
    return absolute;
  }

  return visit(nodeId);
}

export function relativeEditorPosition(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  absolutePosition: EditorPoint,
  parentNodeId: ArchitectureNode["id"] | null,
  positionOverrides?: ReadonlyMap<string, EditorPoint>,
): EditorPoint {
  const absolute = checkedEditorPoint(absolutePosition);
  if (parentNodeId === null) {
    return absolute;
  }
  const parent = absoluteEditorNodePosition(
    document,
    catalog,
    parentNodeId,
    positionOverrides,
  );
  return checkedEditorPoint({
    x: absolute.x - parent.x,
    y: absolute.y - parent.y,
  });
}

function visualDepth(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  node: ArchitectureNode,
): number {
  const nodes = new Map(
    document.nodes.map((candidate) => [candidate.id, candidate]),
  );
  const seen = new Set<ArchitectureNode["id"]>();
  let depth = 0;
  let current: ArchitectureNode | undefined = node;
  while (current !== undefined) {
    if (seen.has(current.id)) {
      throw new EditorGeometryError(
        "cycle",
        "Cannot order nodes through a parent cycle.",
      );
    }
    seen.add(current.id);
    const parentId = visualBoundaryParentId(document, catalog, current);
    if (parentId === null) {
      return depth;
    }
    depth += 1;
    current = nodes.get(parentId);
  }
  return depth;
}

export function parentFirstArchitectureNodes(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
): readonly ArchitectureNode[] {
  return createArchitectureGeometryContext(document, catalog).orderedNodes;
}

export function validateAbsoluteEditorPositions(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  positionOverrides?: ReadonlyMap<string, EditorPoint>,
): void {
  createArchitectureGeometryContext(document, catalog).validatePositions(
    positionOverrides,
  );
}

export function deriveArchitectureGeometry(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  positionOverrides?: ReadonlyMap<string, EditorPoint>,
): ArchitectureGeometry {
  return createArchitectureGeometryContext(document, catalog).geometry(
    positionOverrides,
  );
}

export function deepestBoundaryAtPosition(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  nodeId: ArchitectureNode["id"],
  absolutePosition: EditorPoint,
  positionOverrides?: ReadonlyMap<string, EditorPoint>,
): ArchitectureNode["id"] | null {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    throw new EditorGeometryError(
      "missing-node",
      "The dragged node is missing.",
    );
  }
  const boundaryPositionOverrides =
    positionOverrides === undefined ? undefined : new Map(positionOverrides);
  boundaryPositionOverrides?.delete(nodeId);
  const geometry = deriveArchitectureGeometry(
    document,
    catalog,
    boundaryPositionOverrides,
  );
  const nodeSize =
    geometry.sizes.get(node.id) ??
    canonicalArchitectureNodeSize(document, catalog, node);
  const service = resolveExactEditorCatalogService(document, node, catalog);
  // Resource hit-testing stays on the compact header anchor so disclosures and
  // education never change a drop target. Boundaries use their full center.
  const placementAnchor = checkedEditorPoint({
    x:
      absolutePosition.x +
      (service?.nodeKind === "boundary"
        ? nodeSize.width / 2
        : Math.min(nodeSize.width / 2, resourcePlacementAnchorX)),
    y:
      absolutePosition.y +
      (service?.nodeKind === "boundary"
        ? nodeSize.height / 2
        : Math.min(nodeSize.height / 2, resourcePlacementAnchorY)),
  });
  const nodesById = new Map(
    document.nodes.map((candidate) => [candidate.id, candidate]),
  );

  function isVisualDescendant(candidate: ArchitectureNode): boolean {
    const seen = new Set<ArchitectureNode["id"]>();
    let current: ArchitectureNode | undefined = candidate;
    while (current !== undefined) {
      if (seen.has(current.id)) {
        return true;
      }
      seen.add(current.id);
      const parentId = visualBoundaryParentId(document, catalog, current);
      if (parentId === null) {
        return false;
      }
      if (parentId === nodeId) {
        return true;
      }
      current = nodesById.get(parentId);
    }
    return false;
  }

  const candidates = document.nodes
    .filter((candidate) => {
      if (candidate.id === nodeId || isVisualDescendant(candidate)) {
        return false;
      }
      const service = resolveExactEditorCatalogService(
        document,
        candidate,
        catalog,
      );
      if (service?.nodeKind !== "boundary") {
        return false;
      }
      const position = absoluteEditorNodePosition(
        document,
        catalog,
        candidate.id,
        boundaryPositionOverrides,
      );
      const size = geometry.sizes.get(candidate.id);
      return (
        size !== undefined &&
        placementAnchor.x >= position.x &&
        placementAnchor.x <= position.x + size.width &&
        placementAnchor.y >= position.y &&
        placementAnchor.y <= position.y + size.height
      );
    })
    .sort((left, right) => {
      const depthDifference =
        visualDepth(document, catalog, right) -
        visualDepth(document, catalog, left);
      return depthDifference === 0
        ? compareText(left.id, right.id)
        : depthDifference;
    });

  const deepestCandidate = candidates[0];
  if (deepestCandidate === undefined) {
    return null;
  }
  const deepestCandidateDepth = visualDepth(
    document,
    catalog,
    deepestCandidate,
  );
  const equallyDeepCandidates = candidates.filter(
    (candidate) =>
      visualDepth(document, catalog, candidate) === deepestCandidateDepth,
  );
  if (equallyDeepCandidates.length > 1) {
    const boundaryLabels = new Intl.ListFormat("en-US", {
      style: "long",
      type: "conjunction",
    }).format(
      equallyDeepCandidates.map((candidate) => candidate.presentation.label),
    );
    throw new EditorGeometryError(
      "ambiguous-boundary-target",
      `This position overlaps multiple equally specific boundaries: ${boundaryLabels}. Choose a boundary from the Architecture list.`,
    );
  }

  return deepestCandidate.id;
}

/** Readonly topology bound to one immutable document/catalog pair, never global. */
export function createArchitectureGeometryContext(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
) {
  const nodesById = new Map<string, ArchitectureNode>(
    document.nodes.map((node) => [node.id, node]),
  );
  const servicesByNodeId = new Map<
    string,
    ReturnType<typeof resolveExactEditorCatalogService>
  >(
    document.nodes.map((node) => [
      node.id,
      resolveExactEditorCatalogService(document, node, catalog),
    ]),
  );
  const parentsByNodeId = new Map<string, string | null>(
    document.nodes.map((node) => [
      node.id,
      visualBoundaryParentId(document, catalog, node),
    ]),
  );
  const visibleNodeIds = new Set(
    document.nodes
      .filter((node) => servicesByNodeId.get(node.id)?.deployable !== false)
      .map((node) => node.id),
  );
  const childrenByParentId = new Map<string, ArchitectureNode[]>();
  for (const node of document.nodes) {
    const parentId = parentsByNodeId.get(node.id);
    if (
      parentId === null ||
      parentId === undefined ||
      !visibleNodeIds.has(node.id)
    )
      continue;
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(node);
    childrenByParentId.set(parentId, children);
  }
  const compareId = (left: ArchitectureNode, right: ArchitectureNode) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  for (const children of childrenByParentId.values()) children.sort(compareId);
  const depths = new Map<string, number>();
  const activeDepths = new Set<string>();
  function depth(id: string): number {
    const existing = depths.get(id);
    if (existing !== undefined) return existing;
    if (activeDepths.has(id))
      throw new EditorGeometryError(
        "cycle",
        "Cannot order nodes through a parent cycle.",
      );
    activeDepths.add(id);
    const parentId = parentsByNodeId.get(id);
    const result =
      parentId === null || parentId === undefined
        ? 0
        : 1 + (nodesById.has(parentId) ? depth(parentId) : 0);
    activeDepths.delete(id);
    depths.set(id, result);
    return result;
  }
  const orderedNodes = [...document.nodes].sort(
    (left, right) => depth(left.id) - depth(right.id) || compareId(left, right),
  );

  function positions(
    overrides?: ReadonlyMap<string, EditorPoint>,
    allNodes = true,
  ): void {
    const absolute = new Map<string, EditorPoint>();
    const active = new Set<string>();
    function visit(id: string): EditorPoint {
      const existing = absolute.get(id);
      if (existing !== undefined) return existing;
      if (active.has(id))
        throw new EditorGeometryError(
          "cycle",
          "Cannot resolve coordinates through a parent cycle.",
        );
      const node = nodesById.get(id);
      if (node === undefined)
        throw new EditorGeometryError(
          "missing-node",
          `Node ${id} does not exist.`,
        );
      active.add(id);
      const local = checkedEditorPoint(
        overrides?.get(id) ?? node.presentation.position,
        `Node ${id} position`,
      );
      const parentId = parentsByNodeId.get(id);
      const parent =
        parentId === null || parentId === undefined
          ? undefined
          : visit(parentId);
      const result =
        parent === undefined
          ? local
          : checkedEditorPoint(
              { x: parent.x + local.x, y: parent.y + local.y },
              `Node ${id} absolute position`,
            );
      active.delete(id);
      absolute.set(id, result);
      return result;
    }
    for (const node of document.nodes)
      if (allNodes || visibleNodeIds.has(node.id)) visit(node.id);
  }

  function geometry(
    overrides?: ReadonlyMap<string, EditorPoint>,
  ): ArchitectureGeometry {
    positions(overrides, false);
    const sizes = new Map<ArchitectureNode["id"], EditorSize>();
    const overflows: BoundaryGeometryOverflow[] = [];
    const active = new Set<string>();
    function sizeFor(node: ArchitectureNode): EditorSize {
      const existing = sizes.get(node.id);
      if (existing !== undefined) return existing;
      if (active.has(node.id))
        throw new EditorGeometryError(
          "cycle",
          "Cannot size boundaries through a parent cycle.",
        );
      active.add(node.id);
      const service = servicesByNodeId.get(node.id);
      let size = canonicalServiceNodeSize(service, node.semantic.serviceType);
      if (service?.nodeKind === "boundary") {
        let width = BOUNDARY_MINIMUM_WIDTH;
        let height = BOUNDARY_MINIMUM_HEIGHT;
        for (const child of childrenByParentId.get(node.id) ?? []) {
          const point = checkedEditorPoint(
            overrides?.get(child.id) ?? child.presentation.position,
            `Node ${child.id} position`,
          );
          const childSize = sizeFor(child);
          if (point.x < BOUNDARY_CONTENT_LEFT || point.y < BOUNDARY_CONTENT_TOP)
            overflows.push({
              boundaryNodeId: node.id,
              message: `${child.presentation.label} must remain inside the boundary content area.`,
            });
          width = Math.max(
            width,
            point.x + childSize.width + BOUNDARY_CONTENT_RIGHT,
          );
          height = Math.max(
            height,
            point.y + childSize.height + BOUNDARY_CONTENT_BOTTOM,
          );
        }
        if (width > BOUNDARY_MAXIMUM_WIDTH || height > BOUNDARY_MAXIMUM_HEIGHT)
          overflows.push({
            boundaryNodeId: node.id,
            message: `${node.presentation.label} cannot expand beyond ${String(BOUNDARY_MAXIMUM_WIDTH)} by ${String(BOUNDARY_MAXIMUM_HEIGHT)}.`,
          });
        size = {
          height: Math.min(
            BOUNDARY_MAXIMUM_HEIGHT,
            Math.ceil(height / EDITOR_GRID_SIZE) * EDITOR_GRID_SIZE,
          ),
          width: Math.min(
            BOUNDARY_MAXIMUM_WIDTH,
            Math.ceil(width / EDITOR_GRID_SIZE) * EDITOR_GRID_SIZE,
          ),
        };
      }
      active.delete(node.id);
      sizes.set(node.id, size);
      return size;
    }
    for (const node of orderedNodes
      .filter((node) => visibleNodeIds.has(node.id))
      .toReversed())
      sizeFor(node);
    return { overflows: Object.freeze(overflows), sizes };
  }
  return {
    nodesById: nodesById as ReadonlyMap<string, ArchitectureNode>,
    servicesByNodeId: servicesByNodeId as ReadonlyMap<
      string,
      ReturnType<typeof resolveExactEditorCatalogService>
    >,
    parentsByNodeId: parentsByNodeId as ReadonlyMap<string, string | null>,
    childrenByParentId: childrenByParentId as ReadonlyMap<
      string,
      readonly ArchitectureNode[]
    >,
    visibleNodeIds: visibleNodeIds as ReadonlySet<string>,
    orderedNodes: orderedNodes as readonly ArchitectureNode[],
    validatePositions: positions,
    geometry,
  };
}
