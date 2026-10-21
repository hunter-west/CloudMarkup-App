import {
  applyGraphCommand,
  type ArchitectureDocument,
  type ArchitectureNode,
  type GraphCommandApplicationResult,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  type MoveNodeCommandV1,
} from "@cloudmarkup/schemas";

export interface MoveNodePosition {
  readonly x: number;
  readonly y: number;
}

export interface MoveNodeCommandInput {
  readonly document: ArchitectureDocument;
  readonly nodeId: ArchitectureNode["id"] | string;
  readonly position: MoveNodePosition;
  readonly createId: () => string;
}

export class MoveNodeCommandCreationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MoveNodeCommandCreationError";
  }
}

export function createMoveNodeCommand({
  createId,
  document,
  nodeId,
  position,
}: MoveNodeCommandInput): MoveNodeCommandV1 {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    throw new MoveNodeCommandCreationError(
      `Cannot move unknown architecture node "${nodeId}".`,
    );
  }

  const commandId = createId();
  const inverseCommandId = createId();
  if (commandId === inverseCommandId) {
    throw new MoveNodeCommandCreationError(
      "Move command and inverse command IDs must be distinct.",
    );
  }

  const command = parseGraphCommandV1({
    schemaVersion: 1,
    commandId,
    inverseCommandId,
    origin: "user",
    target: {
      documentId: document.documentId,
      architectureId: document.architectureId,
      revisionId: document.revision.revisionId,
    },
    kind: "move-node",
    nodeId: node.id,
    expectedPosition: {
      x: node.presentation.position.x,
      y: node.presentation.position.y,
    },
    position: {
      x: position.x,
      y: position.y,
    },
  });

  if (command.kind !== "move-node") {
    throw new MoveNodeCommandCreationError(
      "Expected the graph command parser to return a move-node command.",
    );
  }

  return command;
}

export function dispatchMoveNodeCommand(
  input: MoveNodeCommandInput,
): GraphCommandApplicationResult {
  return applyGraphCommand(input.document, createMoveNodeCommand(input));
}
