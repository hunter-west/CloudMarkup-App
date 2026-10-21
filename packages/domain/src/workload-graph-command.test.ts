import { readFile } from "node:fs/promises";

import {
  parseArchitectureDocumentV2Json,
  serializeArchitectureDocumentV3,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  GraphCommandApplicationError,
  applyGraphCommand,
  parseArchitectureDocument,
} from "./index.js";

async function representativeDocument() {
  const document = parseArchitectureDocumentV2Json(
    await readFile(
      new URL(
        "../../test-fixtures/fixtures/architecture-document/v2/valid/representative.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return parseArchitectureDocument(document);
}

describe("Graph Command v1 workload reference safety", () => {
  it("preserves populated workload behavior through a successful command and its inverse", async () => {
    const document = await representativeDocument();
    const node = document.nodes.find(
      (candidate) => candidate.id === "node_worker",
    );
    if (node === undefined) {
      throw new Error("Representative fixture must contain the worker node.");
    }
    const before = serializeArchitectureDocumentV3(document);

    const moved = applyGraphCommand(document, {
      schemaVersion: 1,
      commandId: "operation_move_workload_owner",
      inverseCommandId: "operation_restore_workload_owner",
      origin: "user",
      target: {
        documentId: document.documentId,
        architectureId: document.architectureId,
        revisionId: document.revision.revisionId,
      },
      kind: "move-node",
      nodeId: node.id,
      expectedPosition: node.presentation.position,
      position: {
        x: node.presentation.position.x + 20,
        y: node.presentation.position.y + 20,
      },
    });

    expect(moved.document.workloadBehavior).toEqual(document.workloadBehavior);
    expect(moved.inversion.kind).toBe("available");
    if (moved.inversion.kind !== "available") {
      throw new Error("Expected the move command to have an inverse.");
    }

    const restored = applyGraphCommand(moved.document, moved.inversion.command);
    expect(serializeArchitectureDocumentV3(restored.document)).toBe(before);
  });

  it("fails closed when removing an edge bound by workload behavior", async () => {
    const document = await representativeDocument();
    const edge = document.edges.find(
      (candidate) => candidate.id === "edge_trigger",
    );
    if (edge === undefined) {
      throw new Error("Representative fixture must contain the trigger edge.");
    }
    const before = serializeArchitectureDocumentV3(document);

    expect(() =>
      applyGraphCommand(document, {
        schemaVersion: 1,
        commandId: "operation_remove_bound_edge",
        inverseCommandId: "operation_restore_bound_edge",
        origin: "user",
        target: {
          documentId: document.documentId,
          architectureId: document.architectureId,
          revisionId: document.revision.revisionId,
        },
        kind: "remove-edge",
        edgeId: edge.id,
        expectedEdge: edge,
      }),
    ).toThrow(GraphCommandApplicationError);

    try {
      applyGraphCommand(document, {
        schemaVersion: 1,
        commandId: "operation_remove_bound_edge_again",
        inverseCommandId: "operation_restore_bound_edge_again",
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
    } catch (error) {
      expect(error).toBeInstanceOf(GraphCommandApplicationError);
      expect((error as GraphCommandApplicationError).issues).toEqual([
        expect.objectContaining({ code: "resource_has_dependents" }),
      ]);
    }
    expect(serializeArchitectureDocumentV3(document)).toBe(before);
  });

  it("keeps a failed batch atomic when a later removal reaches a workload binding", async () => {
    const document = await representativeDocument();
    const edge = document.edges.find(
      (candidate) => candidate.id === "edge_trigger",
    );
    const node = document.nodes.find(
      (candidate) => candidate.id === "node_worker",
    );
    if (edge === undefined || node === undefined) {
      throw new Error(
        "Representative fixture must contain worker and trigger.",
      );
    }
    const before = serializeArchitectureDocumentV3(document);

    expect(() =>
      applyGraphCommand(document, {
        schemaVersion: 1,
        commandId: "operation_bound_batch",
        inverseCommandId: "operation_bound_batch_inverse",
        origin: "user",
        target: {
          documentId: document.documentId,
          architectureId: document.architectureId,
          revisionId: document.revision.revisionId,
        },
        kind: "batch",
        commands: [
          {
            schemaVersion: 1,
            commandId: "operation_move_before_bound_remove",
            inverseCommandId: "operation_move_before_bound_remove_inverse",
            origin: "user",
            target: {
              documentId: document.documentId,
              architectureId: document.architectureId,
              revisionId: document.revision.revisionId,
            },
            kind: "move-node",
            nodeId: node.id,
            expectedPosition: node.presentation.position,
            position: {
              x: node.presentation.position.x + 20,
              y: node.presentation.position.y + 20,
            },
          },
          {
            schemaVersion: 1,
            commandId: "operation_remove_bound_in_batch",
            inverseCommandId: "operation_restore_bound_in_batch",
            origin: "user",
            target: {
              documentId: document.documentId,
              architectureId: document.architectureId,
              revisionId: document.revision.revisionId,
            },
            kind: "remove-edge",
            edgeId: edge.id,
            expectedEdge: edge,
          },
        ],
      }),
    ).toThrow(GraphCommandApplicationError);
    expect(serializeArchitectureDocumentV3(document)).toBe(before);
  });
});
