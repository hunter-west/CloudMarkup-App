import {
  applyGraphCommand,
  type ArchitectureDocument,
  type GraphCommandApplicationResult,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  type RemoveEdgeCommandV1,
} from "@cloudmarkup/schemas";

export interface DisconnectEdgeCommandInput {
  readonly createId: () => string;
  readonly document: ArchitectureDocument;
  readonly edgeId: string;
}

export interface DisconnectEdgeCommandDispatchResult extends GraphCommandApplicationResult {
  readonly command: RemoveEdgeCommandV1;
}

export class DisconnectEdgeCommandError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DisconnectEdgeCommandError";
  }
}

/**
 * Prepares an exact, fail-closed removal for a user-owned edge. Generated and
 * adopted resources require their separate reviewed lifecycle workflows.
 */
export function createDisconnectEdgeCommand({
  createId,
  document,
  edgeId,
}: DisconnectEdgeCommandInput): RemoveEdgeCommandV1 {
  const edge = document.edges.find((candidate) => candidate.id === edgeId);
  if (edge === undefined) {
    throw new DisconnectEdgeCommandError(
      `Cannot disconnect unknown architecture edge "${edgeId}".`,
    );
  }
  if (edge.semantic.lifecycle.ownership === "generated") {
    throw new DisconnectEdgeCommandError(
      "Generated connections must be changed through their reviewed generated-resource workflow.",
    );
  }
  if (edge.semantic.lifecycle.ownership === "adopted") {
    throw new DisconnectEdgeCommandError(
      "Adopted connections are not removable from this connection dock.",
    );
  }

  const commandId = createId();
  const inverseCommandId = createId();
  if (commandId === inverseCommandId) {
    throw new DisconnectEdgeCommandError(
      "Disconnect command and inverse command IDs must be distinct.",
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
    kind: "remove-edge",
    edgeId: edge.id,
    expectedEdge: edge,
  });
  if (command.kind !== "remove-edge") {
    throw new DisconnectEdgeCommandError(
      "Expected the Graph Command parser to return a remove-edge command.",
    );
  }
  return command;
}

export function dispatchDisconnectEdgeCommand(
  input: DisconnectEdgeCommandInput,
): DisconnectEdgeCommandDispatchResult {
  const command = createDisconnectEdgeCommand(input);
  return {
    ...applyGraphCommand(input.document, command),
    command,
  };
}
