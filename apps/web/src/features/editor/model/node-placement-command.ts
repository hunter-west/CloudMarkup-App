import {
  ParentConnectionError,
  prepareParentConnectionActions,
} from "@cloudmarkup/graph-preparation/parent-connection-command";
import {
  applyGraphCommand,
  type ArchitectureDocument,
  type ArchitectureNode,
  type GraphCommandApplicationResult,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  type GraphCommandActionV1,
  type GraphCommandV1,
} from "@cloudmarkup/schemas";

import {
  absoluteEditorNodePosition,
  BOUNDARY_CONTENT_BOTTOM,
  BOUNDARY_CONTENT_LEFT,
  BOUNDARY_CONTENT_TOP,
  BOUNDARY_MAXIMUM_HEIGHT,
  deriveArchitectureGeometry,
  EDITOR_GRID_SIZE,
  EditorGeometryError,
  relativeEditorPosition,
  snapEditorPoint,
  type EditorPoint,
} from "./architecture-geometry.js";
import type { EditorCatalog } from "./editor-catalog.js";
import {
  validateEditorNodePlacement,
  visualBoundaryParentId,
} from "./placement-rules.js";

export class EditorNodePlacementError extends Error {
  public readonly code:
    | "coordinate-invalid"
    | "duplicate-command-identity"
    | "geometry-overflow"
    | "placement-invalid"
    | "unknown-node";

  public constructor(code: EditorNodePlacementError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "EditorNodePlacementError";
  }
}

export interface PrepareEditorNodePlacementInput {
  readonly catalog: EditorCatalog;
  readonly createId: () => string;
  readonly document: ArchitectureDocument;
  readonly nodeId: string;
  readonly position?: EditorPoint;
  readonly positionSpace?: "absolute" | "stored";
  readonly targetParentNodeId: string | null;
}

export interface PrepareEditorNodeMoveInput {
  readonly catalog: EditorCatalog;
  readonly createId: () => string;
  readonly document: ArchitectureDocument;
  readonly nodeId: string;
  readonly position: EditorPoint;
}
export interface SuggestEditorNodePlacementPositionInput {
  readonly catalog: EditorCatalog;
  readonly document: ArchitectureDocument;
  readonly nodeId: string;
  readonly targetParentNodeId: string | null;
}

export type PreparedEditorNodePlacement =
  | {
      readonly absolutePosition: EditorPoint;
      readonly command: null;
      readonly parent: ArchitectureNode["semantic"]["parent"] | null;
      readonly position: EditorPoint;
    }
  | {
      readonly absolutePosition: EditorPoint;
      readonly command: GraphCommandV1;
      readonly parent: ArchitectureNode["semantic"]["parent"] | null;
      readonly position: EditorPoint;
    };

export interface EditorNodePlacementDispatchResult extends GraphCommandApplicationResult {
  readonly absolutePosition: EditorPoint;
  readonly command: GraphCommandV1 | null;
  readonly parent: ArchitectureNode["semantic"]["parent"] | null;
  readonly position: EditorPoint;
}

export type PreparedEditorNodeMove = PreparedEditorNodePlacement;
export type EditorNodeMoveDispatchResult = EditorNodePlacementDispatchResult;

/**
 * Chooses a readable, deterministic position for list/tree placement. Pointer
 * placement continues to use the reviewed drop coordinates. Moving to root
 * preserves the current absolute position; moving into another boundary uses
 * the next open vertical slot and falls back to a new column when required.
 */
export function suggestEditorNodePlacementAbsolutePosition(
  input: SuggestEditorNodePlacementPositionInput,
): EditorPoint {
  const node = input.document.nodes.find(
    (candidate) => candidate.id === input.nodeId,
  );
  if (node === undefined) {
    throw new EditorNodePlacementError(
      "unknown-node",
      "The selected node no longer exists.",
    );
  }
  const target =
    input.targetParentNodeId === null
      ? null
      : input.document.nodes.find(
          (candidate) => candidate.id === input.targetParentNodeId,
        );
  if (input.targetParentNodeId !== null && target === undefined) {
    throw new EditorNodePlacementError(
      "placement-invalid",
      "The selected boundary no longer exists.",
    );
  }
  const targetParentNodeId = target?.id ?? null;
  const placement = validateEditorNodePlacement(
    input.document,
    input.catalog,
    node.id,
    targetParentNodeId,
  );
  if (!placement.success) {
    throw new EditorNodePlacementError("placement-invalid", placement.message);
  }
  if (
    targetParentNodeId === null ||
    visualBoundaryParentId(input.document, input.catalog, node) ===
      targetParentNodeId
  ) {
    return absoluteEditorNodePosition(input.document, input.catalog, node.id);
  }

  if (target === null || target === undefined) {
    throw new EditorNodePlacementError(
      "placement-invalid",
      "The selected boundary no longer exists.",
    );
  }
  const geometry = deriveArchitectureGeometry(input.document, input.catalog);
  const targetAbsolute = absoluteEditorNodePosition(
    input.document,
    input.catalog,
    target.id,
  );
  const nodeSize = geometry.sizes.get(node.id);
  if (nodeSize === undefined) {
    throw new EditorNodePlacementError(
      "placement-invalid",
      "The selected node has no readable canvas geometry.",
    );
  }
  const siblings = input.document.nodes.flatMap((candidate) => {
    if (
      candidate.id === node.id ||
      visualBoundaryParentId(input.document, input.catalog, candidate) !==
        target.id
    ) {
      return [];
    }
    const size = geometry.sizes.get(candidate.id);
    return size === undefined ? [] : [{ node: candidate, size }];
  });
  const gap = EDITOR_GRID_SIZE * 4;
  let localPosition = {
    x: BOUNDARY_CONTENT_LEFT,
    y: siblings.reduce(
      (nextY, sibling) =>
        Math.max(
          nextY,
          sibling.node.presentation.position.y + sibling.size.height + gap,
        ),
      BOUNDARY_CONTENT_TOP,
    ),
  };
  if (
    localPosition.y + nodeSize.height + BOUNDARY_CONTENT_BOTTOM >
    BOUNDARY_MAXIMUM_HEIGHT
  ) {
    localPosition = {
      x: siblings.reduce(
        (nextX, sibling) =>
          Math.max(
            nextX,
            sibling.node.presentation.position.x + sibling.size.width + gap,
          ),
        BOUNDARY_CONTENT_LEFT,
      ),
      y: BOUNDARY_CONTENT_TOP,
    };
  }
  return snapEditorPoint({
    x: targetAbsolute.x + localPosition.x,
    y: targetAbsolute.y + localPosition.y,
  });
}

function commandTarget(document: ArchitectureDocument) {
  return {
    architectureId: document.architectureId,
    documentId: document.documentId,
    revisionId: document.revision.revisionId,
  };
}

function commandIdentityPair(createId: () => string): {
  readonly commandId: string;
  readonly inverseCommandId: string;
} {
  const commandId = createId();
  const inverseCommandId = createId();
  if (commandId === inverseCommandId) {
    throw new EditorNodePlacementError(
      "duplicate-command-identity",
      "Command and inverse command IDs must be distinct.",
    );
  }
  return { commandId, inverseCommandId };
}

function samePoint(left: EditorPoint, right: EditorPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function sameParent(
  left:
    | { readonly nodeId: string; readonly relationshipType: string }
    | null
    | undefined,
  right:
    | { readonly nodeId: string; readonly relationshipType: string }
    | null
    | undefined,
): boolean {
  return (
    left?.nodeId === right?.nodeId &&
    left?.relationshipType === right?.relationshipType
  );
}

function projectedDocument(
  document: ArchitectureDocument,
  nodeId: ArchitectureNode["id"],
  position: EditorPoint,
  parent: ArchitectureNode["semantic"]["parent"] | null,
): ArchitectureDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id !== nodeId) {
        return node;
      }
      const semantic = { ...node.semantic };
      if (parent === null) {
        delete semantic.parent;
      } else {
        semantic.parent = structuredClone(parent);
      }
      return {
        ...node,
        semantic,
        presentation: {
          ...node.presentation,
          position: structuredClone(position),
        },
      };
    }),
  };
}

function validateProjectedGeometry(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
): void {
  const geometry = (() => {
    try {
      return deriveArchitectureGeometry(document, catalog);
    } catch (error) {
      if (error instanceof EditorGeometryError) {
        throw new EditorNodePlacementError("coordinate-invalid", error.message);
      }
      throw error;
    }
  })();
  if (geometry.overflows.length > 0) {
    throw new EditorNodePlacementError(
      "geometry-overflow",
      geometry.overflows[0]?.message ??
        "The requested position does not fit inside the boundary.",
    );
  }
}

export function prepareEditorNodeMove(
  input: PrepareEditorNodeMoveInput,
): PreparedEditorNodeMove {
  const node = input.document.nodes.find(
    (candidate) => candidate.id === input.nodeId,
  );
  if (node === undefined) {
    throw new EditorNodePlacementError(
      "unknown-node",
      "The selected node no longer exists.",
    );
  }

  let position: EditorPoint;
  try {
    position = snapEditorPoint(input.position);
  } catch (error) {
    throw new EditorNodePlacementError(
      "coordinate-invalid",
      error instanceof Error
        ? error.message
        : "The requested position is invalid.",
    );
  }

  const parent =
    node.semantic.parent === undefined
      ? null
      : structuredClone(node.semantic.parent);
  const projected = projectedDocument(
    input.document,
    node.id,
    position,
    parent,
  );
  validateProjectedGeometry(projected, input.catalog);

  let absolutePosition: EditorPoint;
  try {
    absolutePosition = absoluteEditorNodePosition(
      projected,
      input.catalog,
      node.id,
    );
  } catch (error) {
    throw new EditorNodePlacementError(
      "coordinate-invalid",
      error instanceof Error
        ? error.message
        : "The requested position cannot be resolved safely.",
    );
  }

  if (samePoint(node.presentation.position, position)) {
    return {
      absolutePosition,
      command: null,
      parent,
      position,
    };
  }

  const parsed = parseGraphCommandV1({
    schemaVersion: 1,
    ...commandIdentityPair(input.createId),
    origin: "user",
    target: commandTarget(input.document),
    kind: "move-node",
    nodeId: node.id,
    expectedPosition: structuredClone(node.presentation.position),
    position: structuredClone(position),
  });
  if (parsed.kind !== "move-node") {
    throw new EditorNodePlacementError(
      "coordinate-invalid",
      "The position change could not be prepared safely.",
    );
  }

  return {
    absolutePosition,
    command: parsed,
    parent,
    position,
  };
}

export function prepareEditorNodePlacement(
  input: PrepareEditorNodePlacementInput,
): PreparedEditorNodePlacement {
  const commandIds = new Set<string>();
  const createUniqueCommandId = (): string => {
    const commandId = input.createId();
    if (commandIds.has(commandId)) {
      throw new EditorNodePlacementError(
        "duplicate-command-identity",
        "Every placement command and inverse command must use a distinct ID.",
      );
    }
    commandIds.add(commandId);
    return commandId;
  };
  const node = input.document.nodes.find(
    (candidate) => candidate.id === input.nodeId,
  );
  if (node === undefined) {
    throw new EditorNodePlacementError(
      "unknown-node",
      "The selected node no longer exists.",
    );
  }
  const targetParentNodeId =
    input.targetParentNodeId === null
      ? null
      : input.document.nodes.find(
          (candidate) => candidate.id === input.targetParentNodeId,
        )?.id;
  if (input.targetParentNodeId !== null && targetParentNodeId === undefined) {
    throw new EditorNodePlacementError(
      "placement-invalid",
      "The selected boundary no longer exists.",
    );
  }
  const resolvedTargetParentNodeId: ArchitectureNode["id"] | null =
    targetParentNodeId ?? null;

  const placement = validateEditorNodePlacement(
    input.document,
    input.catalog,
    node.id,
    resolvedTargetParentNodeId,
  );
  if (!placement.success) {
    throw new EditorNodePlacementError("placement-invalid", placement.message);
  }

  let absolutePosition: EditorPoint;
  try {
    absolutePosition =
      input.position === undefined
        ? absoluteEditorNodePosition(input.document, input.catalog, node.id)
        : input.positionSpace === "stored"
          ? resolvedTargetParentNodeId === null
            ? snapEditorPoint(input.position)
            : (() => {
                const parentAbsolute = absoluteEditorNodePosition(
                  input.document,
                  input.catalog,
                  resolvedTargetParentNodeId,
                );
                const stored = snapEditorPoint(input.position);
                return snapEditorPoint({
                  x: parentAbsolute.x + stored.x,
                  y: parentAbsolute.y + stored.y,
                });
              })()
          : snapEditorPoint(input.position);
  } catch (error) {
    throw new EditorNodePlacementError(
      "coordinate-invalid",
      error instanceof Error
        ? error.message
        : "The requested position is invalid.",
    );
  }

  let position: EditorPoint;
  try {
    position = snapEditorPoint(
      relativeEditorPosition(
        input.document,
        input.catalog,
        absolutePosition,
        resolvedTargetParentNodeId,
      ),
    );
  } catch (error) {
    throw new EditorNodePlacementError(
      "coordinate-invalid",
      error instanceof Error
        ? error.message
        : "The requested position cannot be converted safely.",
    );
  }

  const currentParent = node.semantic.parent ?? null;
  let nextParent = currentParent;
  let reparentAction: GraphCommandActionV1 | null = null;
  if (!sameParent(currentParent, placement.parent)) {
    const parsed = parseGraphCommandV1({
      schemaVersion: 1,
      ...commandIdentityPair(createUniqueCommandId),
      origin: "user",
      target: commandTarget(input.document),
      kind: "reparent-node",
      nodeId: node.id,
      expectedParent: structuredClone(currentParent),
      parent: structuredClone(placement.parent),
    });
    if (parsed.kind !== "reparent-node") {
      throw new EditorNodePlacementError(
        "placement-invalid",
        "The boundary change could not be prepared safely.",
      );
    }
    reparentAction = parsed;
    nextParent = parsed.parent ?? null;
  }
  const projected = projectedDocument(
    input.document,
    node.id,
    position,
    nextParent,
  );
  validateProjectedGeometry(projected, input.catalog);

  const actions: GraphCommandActionV1[] = [];
  if (!samePoint(node.presentation.position, position)) {
    const parsed = parseGraphCommandV1({
      schemaVersion: 1,
      ...commandIdentityPair(createUniqueCommandId),
      origin: "user",
      target: commandTarget(input.document),
      kind: "move-node",
      nodeId: node.id,
      expectedPosition: structuredClone(node.presentation.position),
      position: structuredClone(position),
    });
    if (parsed.kind !== "move-node") {
      throw new EditorNodePlacementError(
        "coordinate-invalid",
        "The position change could not be prepared safely.",
      );
    }
    actions.push(parsed);
  }
  if (reparentAction !== null) {
    actions.push(reparentAction);
  }
  try {
    actions.push(
      ...prepareParentConnectionActions({
        catalog: input.catalog,
        document: input.document,
        node,
        parent: nextParent,
        createId: createUniqueCommandId,
      }),
    );
  } catch (error) {
    if (error instanceof ParentConnectionError)
      throw new EditorNodePlacementError("placement-invalid", error.message);
    throw error;
  }

  if (actions.length === 0) {
    return {
      absolutePosition,
      command: null,
      parent: nextParent,
      position,
    };
  }

  const command =
    actions.length === 1
      ? parseGraphCommandV1(actions[0])
      : parseGraphCommandV1({
          schemaVersion: 1,
          ...commandIdentityPair(createUniqueCommandId),
          origin: "user",
          target: commandTarget(input.document),
          kind: "batch",
          commands: actions,
        });

  return {
    absolutePosition,
    command,
    parent: nextParent,
    position,
  };
}

export function dispatchEditorNodePlacement(
  input: PrepareEditorNodePlacementInput,
): EditorNodePlacementDispatchResult {
  const prepared = prepareEditorNodePlacement(input);
  if (prepared.command === null) {
    return {
      changes: [],
      document: input.document,
      inversion: {
        kind: "unavailable",
        reason: {
          code: "batch_contains_non_invertible_command",
          message: "No placement change was required.",
        },
      },
      absolutePosition: prepared.absolutePosition,
      command: null,
      parent: prepared.parent,
      position: prepared.position,
    };
  }
  return {
    ...applyGraphCommand(input.document, prepared.command),
    absolutePosition: prepared.absolutePosition,
    command: prepared.command,
    parent: prepared.parent,
    position: prepared.position,
  };
}

export function dispatchEditorNodeMove(
  input: PrepareEditorNodeMoveInput,
): EditorNodeMoveDispatchResult {
  const prepared = prepareEditorNodeMove(input);
  if (prepared.command === null) {
    return {
      changes: [],
      document: input.document,
      inversion: {
        kind: "unavailable",
        reason: {
          code: "batch_contains_non_invertible_command",
          message: "No position change was required.",
        },
      },
      absolutePosition: prepared.absolutePosition,
      command: null,
      parent: prepared.parent,
      position: prepared.position,
    };
  }
  return {
    ...applyGraphCommand(input.document, prepared.command),
    absolutePosition: prepared.absolutePosition,
    command: prepared.command,
    parent: prepared.parent,
    position: prepared.position,
  };
}
