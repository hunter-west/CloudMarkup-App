import {
  applyGraphCommand,
  getArchitectureDocumentHashes,
  type ArchitectureDocument,
  type ArchitectureDocumentHashes,
  type ArchitectureNode,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  type GraphCommandActionV1,
  type GraphCommandV1,
} from "@cloudmarkup/schemas";

import {
  deriveArchitectureGeometry,
  EditorGeometryError,
  snapEditorPoint,
  type EditorPoint,
} from "./architecture-geometry.js";
import { mapArchitectureDocumentToFlow } from "./architecture-flow-adapter.js";
import { normallyVisibleArchitectureNodes } from "@cloudmarkup/graph-preparation/catalog-selection";
import type { EditorCatalog } from "./editor-catalog.js";
import type { LayoutRequest, LayoutResult } from "./layout-adapter.js";
import { visualBoundaryParentId } from "./placement-rules.js";

export class ArchitectureLayoutError extends Error {
  public readonly code:
    | "batch-too-large"
    | "duplicate-command-identity"
    | "invalid-result"
    | "semantic-change"
    | "stale-preview";

  public constructor(code: ArchitectureLayoutError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ArchitectureLayoutError";
  }
}

export interface ArchitectureLayoutChange {
  readonly from: EditorPoint;
  readonly nodeId: ArchitectureNode["id"];
  readonly nodeLabel: string;
  readonly parentNodeId: ArchitectureNode["id"] | null;
  readonly to: EditorPoint;
}

export interface PreparedArchitectureLayout {
  readonly baseHashes: ArchitectureDocumentHashes;
  readonly changes: readonly ArchitectureLayoutChange[];
  readonly command: GraphCommandV1;
  readonly positions: ReadonlyMap<string, EditorPoint>;
  readonly previewHashes: ArchitectureDocumentHashes;
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
    throw new ArchitectureLayoutError(
      "duplicate-command-identity",
      "Layout command and inverse command IDs must be distinct.",
    );
  }
  return { commandId, inverseCommandId };
}

function moveAction(
  document: ArchitectureDocument,
  node: ArchitectureNode,
  position: EditorPoint,
  createId: () => string,
): GraphCommandActionV1 {
  const parsed = parseGraphCommandV1({
    schemaVersion: 1,
    ...commandIdentityPair(createId),
    origin: "user",
    target: commandTarget(document),
    kind: "move-node",
    nodeId: node.id,
    expectedPosition: structuredClone(node.presentation.position),
    position: structuredClone(position),
  });
  if (parsed.kind !== "move-node") {
    throw new ArchitectureLayoutError(
      "invalid-result",
      "Expected a move-node command for an automatic-layout position.",
    );
  }
  return parsed;
}

export function createArchitectureLayoutRequest(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
): LayoutRequest {
  const model = mapArchitectureDocumentToFlow(document, catalog);
  const geometry = deriveArchitectureGeometry(document, catalog);
  if (geometry.overflows.length > 0) {
    throw new ArchitectureLayoutError(
      "invalid-result",
      geometry.overflows[0]?.message ??
        "The current boundary geometry is invalid.",
    );
  }
  const visibleEdgeIds = new Set(model.edges.map((edge) => edge.id));

  return {
    nodes: model.nodes.map((node) => {
      const size = geometry.sizes.get(node.data.architectureNodeId);
      if (size === undefined) {
        throw new ArchitectureLayoutError(
          "invalid-result",
          `Layout geometry is unavailable for ${node.id}.`,
        );
      }
      return {
        height: size.height,
        id: node.id,
        ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
        ports: node.data.ports.map((port) => ({
          direction: port.direction,
          id: port.id,
        })),
        width: size.width,
      };
    }),
    edges: [...document.edges]
      .filter((edge) => visibleEdgeIds.has(edge.id))
      .sort((left, right) => compareText(left.id, right.id))
      .map((edge) => ({
        id: edge.id,
        source: {
          nodeId: edge.semantic.source.nodeId,
          portId: edge.semantic.source.port,
        },
        target: {
          nodeId: edge.semantic.target.nodeId,
          portId: edge.semantic.target.port,
        },
      })),
  };
}

function validateLayoutPositions(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  result: LayoutResult,
): ReadonlyMap<string, EditorPoint> {
  const visibleNodes = normallyVisibleArchitectureNodes(document, catalog);
  if (result.positions.length !== visibleNodes.length) {
    throw new ArchitectureLayoutError(
      "invalid-result",
      "Automatic layout did not return every visible architecture node.",
    );
  }

  const positions = new Map<string, EditorPoint>();
  const nodes: ReadonlyMap<string, ArchitectureNode> = new Map(
    visibleNodes.map((node) => [node.id, node]),
  );
  for (const candidate of result.positions) {
    const node = nodes.get(candidate.nodeId);
    if (node === undefined || positions.has(candidate.nodeId)) {
      throw new ArchitectureLayoutError(
        "invalid-result",
        "Automatic layout returned an unknown or duplicate node.",
      );
    }
    const expectedParent = visualBoundaryParentId(document, catalog, node);
    if (candidate.parentId !== expectedParent) {
      throw new ArchitectureLayoutError(
        "invalid-result",
        "Automatic layout changed a semantic boundary relationship.",
      );
    }
    try {
      positions.set(node.id, snapEditorPoint(candidate.position));
    } catch (error) {
      if (error instanceof EditorGeometryError) {
        throw new ArchitectureLayoutError("invalid-result", error.message);
      }
      throw error;
    }
  }

  const geometry = (() => {
    try {
      return deriveArchitectureGeometry(document, catalog, positions);
    } catch (error) {
      if (error instanceof EditorGeometryError) {
        throw new ArchitectureLayoutError("invalid-result", error.message);
      }
      throw error;
    }
  })();
  if (geometry.overflows.length > 0) {
    throw new ArchitectureLayoutError(
      "invalid-result",
      geometry.overflows[0]?.message ??
        "Automatic layout exceeded a boundary's maximum dimensions.",
    );
  }

  const canonicalPositions = new Map<string, EditorPoint>();
  for (const node of [...visibleNodes].sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    const position = positions.get(node.id);
    if (position !== undefined) {
      canonicalPositions.set(node.id, position);
    }
  }
  return canonicalPositions;
}

export function prepareArchitectureLayout(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  result: LayoutResult,
  createId: () => string,
): PreparedArchitectureLayout | null {
  const positions = validateLayoutPositions(document, catalog, result);
  const changes = normallyVisibleArchitectureNodes(document, catalog)
    .slice()
    .sort((left, right) => compareText(left.id, right.id))
    .flatMap((node): ArchitectureLayoutChange[] => {
      const position = positions.get(node.id);
      if (
        position === undefined ||
        (position.x === node.presentation.position.x &&
          position.y === node.presentation.position.y)
      ) {
        return [];
      }
      return [
        {
          from: structuredClone(node.presentation.position),
          nodeId: node.id,
          nodeLabel: node.presentation.label,
          parentNodeId: visualBoundaryParentId(document, catalog, node),
          to: structuredClone(position),
        },
      ];
    });

  if (changes.length === 0) {
    return null;
  }
  if (changes.length > 256) {
    throw new ArchitectureLayoutError(
      "batch-too-large",
      "Automatic layout would move more than 256 nodes, so this bounded editor cannot apply it atomically.",
    );
  }

  const commandIds = new Set<string>();
  const createUniqueCommandId = (): string => {
    const commandId = createId();
    if (commandIds.has(commandId)) {
      throw new ArchitectureLayoutError(
        "duplicate-command-identity",
        "Every layout command and inverse command must use a distinct ID.",
      );
    }
    commandIds.add(commandId);
    return commandId;
  };
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const actions = changes.map((change) => {
    const node = nodes.get(change.nodeId);
    if (node === undefined) {
      throw new ArchitectureLayoutError(
        "invalid-result",
        "A layout node disappeared before command preparation.",
      );
    }
    return moveAction(document, node, change.to, createUniqueCommandId);
  });
  const firstAction = actions[0];
  if (firstAction === undefined) {
    throw new ArchitectureLayoutError(
      "invalid-result",
      "Automatic layout did not produce a position command.",
    );
  }
  const command: GraphCommandV1 =
    actions.length === 1
      ? firstAction
      : parseGraphCommandV1({
          schemaVersion: 1,
          ...commandIdentityPair(createUniqueCommandId),
          origin: "user",
          target: commandTarget(document),
          kind: "batch",
          commands: actions,
        });
  const previewDocument = applyGraphCommand(document, command).document;
  const baseHashes = getArchitectureDocumentHashes(document);
  const previewHashes = getArchitectureDocumentHashes(previewDocument);
  if (baseHashes.contentHash !== previewHashes.contentHash) {
    throw new ArchitectureLayoutError(
      "semantic-change",
      "Automatic layout attempted to change architecture semantics.",
    );
  }

  return {
    baseHashes,
    changes: Object.freeze(changes),
    command,
    positions,
    previewHashes,
  };
}

export function applyPreparedArchitectureLayout(
  document: ArchitectureDocument,
  prepared: PreparedArchitectureLayout,
) {
  const result = applyGraphCommand(document, prepared.command);
  const currentHashes = getArchitectureDocumentHashes(document);
  if (
    currentHashes.contentHash !== prepared.baseHashes.contentHash ||
    currentHashes.visualHash !== prepared.baseHashes.visualHash
  ) {
    throw new ArchitectureLayoutError(
      "stale-preview",
      "The architecture changed after this layout preview.",
    );
  }
  const hashes = getArchitectureDocumentHashes(result.document);
  if (hashes.contentHash !== prepared.baseHashes.contentHash) {
    throw new ArchitectureLayoutError(
      "semantic-change",
      "Applied layout changed architecture semantics.",
    );
  }
  return result;
}
