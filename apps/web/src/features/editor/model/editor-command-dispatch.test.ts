import {
  GraphCommandApplicationError,
  applyGraphCommand,
  getArchitectureDocumentHashes,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import {
  MoveNodeCommandCreationError,
  createMoveNodeCommand,
  dispatchMoveNodeCommand,
} from "./move-node-command.js";
import { loadFoundationArchitectureDocument } from "./foundation-editor-fixture.js";

function createSequentialIds(prefix: string): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  };
}

describe("move-node command dispatch", () => {
  it("creates a version-bound command with injected distinct IDs and exact position", () => {
    const document = loadFoundationArchitectureDocument();
    const command = createMoveNodeCommand({
      document,
      nodeId: "node_application",
      position: { x: 310, y: 210 },
      createId: createSequentialIds("operation_move"),
    });

    expect(command).toEqual({
      schemaVersion: 1,
      commandId: "operation_move_1",
      inverseCommandId: "operation_move_2",
      origin: "user",
      target: {
        documentId: "doc_manual_canvas_foundation",
        architectureId: "architecture_manual_canvas_foundation",
        revisionId: "revision_manual_canvas_0001",
      },
      kind: "move-node",
      nodeId: "node_application",
      expectedPosition: { x: 40, y: 160 },
      position: { x: 310, y: 210 },
    });
  });

  it("dispatches movement only through the domain engine without mutating the input", () => {
    const document = loadFoundationArchitectureDocument();
    const result = dispatchMoveNodeCommand({
      document,
      nodeId: "node_application",
      position: { x: 310, y: 210 },
      createId: createSequentialIds("operation_dispatch"),
    });

    expect(
      document.nodes.find((node) => node.id === "node_application")
        ?.presentation.position,
    ).toEqual({ x: 40, y: 160 });
    expect(
      result.document.nodes.find((node) => node.id === "node_application")
        ?.presentation.position,
    ).toEqual({ x: 310, y: 210 });
    expect(result.changes).toEqual([
      {
        kind: "node-moved",
        commandId: "operation_dispatch_1",
        nodeId: "node_application",
        from: { x: 40, y: 160 },
        to: { x: 310, y: 210 },
      },
    ]);
  });

  it("preserves the semantic content hash while changing the visual hash", () => {
    const document = loadFoundationArchitectureDocument();
    const before = getArchitectureDocumentHashes(document);
    const result = dispatchMoveNodeCommand({
      document,
      nodeId: "node_application",
      position: { x: 311, y: 211 },
      createId: createSequentialIds("operation_hash"),
    });
    const after = getArchitectureDocumentHashes(result.document);

    expect(after.contentHash).toBe(before.contentHash);
    expect(after.visualHash).not.toBe(before.visualHash);
  });

  it("retains exact preconditions so stale movement fails closed", () => {
    const document = loadFoundationArchitectureDocument();
    const staleCommand = createMoveNodeCommand({
      document,
      nodeId: "node_application",
      position: { x: 500, y: 300 },
      createId: createSequentialIds("operation_stale"),
    });
    const interveningMove = dispatchMoveNodeCommand({
      document,
      nodeId: "node_application",
      position: { x: 320, y: 220 },
      createId: createSequentialIds("operation_intervening"),
    });

    try {
      applyGraphCommand(interveningMove.document, staleCommand);
      throw new Error("Expected the stale move command to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphCommandApplicationError);
      expect((error as GraphCommandApplicationError).issues).toContainEqual({
        code: "precondition_failed",
        path: "$.expectedPosition",
        message: "Node position no longer matches the expected value.",
      });
    }
  });

  it("rejects unknown nodes and duplicate command identities before dispatch", () => {
    const document = loadFoundationArchitectureDocument();

    expect(() =>
      createMoveNodeCommand({
        document,
        nodeId: "node_missing",
        position: { x: 10, y: 20 },
        createId: createSequentialIds("operation_missing"),
      }),
    ).toThrow(MoveNodeCommandCreationError);
    expect(() =>
      createMoveNodeCommand({
        document,
        nodeId: "node_application",
        position: { x: 10, y: 20 },
        createId: () => "operation_duplicate",
      }),
    ).toThrow("Move command and inverse command IDs must be distinct.");
  });
});
