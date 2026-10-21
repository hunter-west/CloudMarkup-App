import type {
  ArchitectureDocument,
  ArchitectureNode,
} from "@cloudmarkup/domain";
import {
  BOUNDARY_CONTENT_TOP,
  BOUNDARY_CONTENT_LEFT,
  BOUNDARY_CONTENT_RIGHT,
  BOUNDARY_CONTENT_BOTTOM,
  BOUNDARY_MAXIMUM_WIDTH,
  canonicalArchitectureNodeSize,
  snapEditorPoint,
  type EditorSize,
} from "./architecture-geometry.js";
import { normallyVisibleArchitectureNodes } from "@cloudmarkup/graph-preparation/catalog-selection";
import type { EditorCatalog } from "./editor-catalog.js";
import type { LayoutPosition, LayoutResult } from "./layout-adapter.js";
import { visualBoundaryParentId } from "./placement-rules.js";

/** Resolve collisions after all proposed children have established their final
 * boundary sizes. Existing positions are preferred; only colliding siblings move.
 * Returned positions must still pass the normal version-bound layout command. */
export function separateArchitectureLayout(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  existingNodeIds: ReadonlySet<string>,
  generatedNodeGap = 48,
): LayoutResult {
  const groups = new Map<string | null, ArchitectureNode[]>();
  for (const node of normallyVisibleArchitectureNodes(document, catalog)) {
    const parent = visualBoundaryParentId(document, catalog, node);
    groups.set(parent, [...(groups.get(parent) ?? []), node]);
  }
  const positions: LayoutPosition[] = [];
  if (
    !Number.isFinite(generatedNodeGap) ||
    generatedNodeGap < 48 ||
    generatedNodeGap > 256
  )
    throw new Error("Generated layout gap must be between 48 and 256 pixels.");
  interface Placed {
    existing: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
  }
  function placeGroup(parentId: string | null): Placed[] {
    const siblings = [...(groups.get(parentId) ?? [])].sort(
      (a, b) =>
        Number(existingNodeIds.has(b.id)) - Number(existingNodeIds.has(a.id)) ||
        a.presentation.position.y - b.presentation.position.y ||
        a.presentation.position.x - b.presentation.position.x ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const placed: Placed[] = [];
    for (const node of siblings) {
      const children = placeGroup(node.id);
      const minimum = canonicalArchitectureNodeSize(document, catalog, node);
      const size: EditorSize = {
        width: Math.max(
          minimum.width,
          ...children.map(
            (child) => child.x + child.width + BOUNDARY_CONTENT_RIGHT,
          ),
        ),
        height: Math.max(
          minimum.height,
          ...children.map(
            (child) => child.y + child.height + BOUNDARY_CONTENT_BOTTOM,
          ),
        ),
      };
      const origin =
        parentId === null
          ? { x: 80, y: 80 }
          : { x: BOUNDARY_CONTENT_LEFT, y: BOUNDARY_CONTENT_TOP };
      let point = snapEditorPoint(
        parentId === null
          ? node.presentation.position
          : {
              x: Math.max(origin.x, node.presentation.position.x),
              y: Math.max(origin.y, node.presentation.position.y),
            },
      );
      const maximumRight =
        parentId === null
          ? Math.max(1536, point.x + size.width)
          : BOUNDARY_MAXIMUM_WIDTH - BOUNDARY_CONTENT_RIGHT;
      const gapFor = (other: Placed) =>
        existingNodeIds.has(node.id) && other.existing ? 48 : generatedNodeGap;
      const overlaps = (other: Placed) =>
        point.x < other.x + other.width + gapFor(other) &&
        point.x + size.width + gapFor(other) > other.x &&
        point.y < other.y + other.height + gapFor(other) &&
        point.y + size.height + gapFor(other) > other.y;
      let collision = placed.find(overlaps);
      while (collision) {
        point = snapEditorPoint({
          x: collision.x + collision.width + gapFor(collision),
          y: point.y,
        });
        if (point.x + size.width > maximumRight)
          point = snapEditorPoint({
            x: origin.x,
            y:
              Math.max(...placed.map((other) => other.y + other.height)) +
              generatedNodeGap,
          });
        collision = placed.find(overlaps);
      }
      placed.push({
        ...point,
        ...size,
        existing: existingNodeIds.has(node.id),
      });
      positions.push({ nodeId: node.id, parentId, position: point });
    }
    return placed;
  }
  placeGroup(null);
  return { positions };
}
