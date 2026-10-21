import {
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import {
  foundationEditorCatalog,
  loadFoundationArchitectureDocument,
} from "./foundation-editor-fixture.js";
import {
  dispatchEditorNodeMove,
  dispatchEditorNodePlacement,
  EditorNodePlacementError,
  prepareEditorNodePlacement,
} from "./node-placement-command.js";

function createIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `operation_placement_test_${String(sequence).padStart(4, "0")}`;
  };
}

function expectPlacementError(
  callback: () => unknown,
): EditorNodePlacementError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(EditorNodePlacementError);
    if (error instanceof EditorNodePlacementError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected node placement preparation to fail.");
}

describe("node placement Graph Commands", () => {
  it("moves an unknown catalog node without requiring placement support", () => {
    const document = loadFoundationArchitectureDocument();
    const beforeHashes = getArchitectureDocumentHashes(document);
    const result = dispatchEditorNodeMove({
      catalog: foundationEditorCatalog,
      createId: createIdFactory(),
      document,
      nodeId: "node_unknown",
      position: { x: 208, y: 104 },
    });
    const unknown = result.document.nodes.find(
      (node) => node.id === "node_unknown",
    );

    expect(result.changes.map((change) => change.kind)).toEqual(["node-moved"]);
    expect(unknown?.presentation.position).toEqual({ x: 208, y: 104 });
    expect(getArchitectureDocumentHashes(result.document).contentHash).toBe(
      beforeHashes.contentHash,
    );
    expect(getArchitectureDocumentHashes(result.document).visualHash).not.toBe(
      beforeHashes.visualHash,
    );
  });

  it("preserves an exact non-boundary semantic parent during a position-only move", () => {
    const document = loadFoundationArchitectureDocument();
    const associatedDocument = parseArchitectureDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === "node_application"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                parent: {
                  nodeId: "node_unknown",
                  relationshipType: "example.relationship.associated-with",
                },
              },
            }
          : node,
      ),
    });
    const beforeHashes = getArchitectureDocumentHashes(associatedDocument);
    const result = dispatchEditorNodeMove({
      catalog: foundationEditorCatalog,
      createId: createIdFactory(),
      document: associatedDocument,
      nodeId: "node_application",
      position: { x: 208, y: 208 },
    });
    const application = result.document.nodes.find(
      (node) => node.id === "node_application",
    );

    expect(application?.semantic.parent).toEqual({
      nodeId: "node_unknown",
      relationshipType: "example.relationship.associated-with",
    });
    expect(application?.presentation.position).toEqual({ x: 208, y: 208 });
    expect(getArchitectureDocumentHashes(result.document).contentHash).toBe(
      beforeHashes.contentHash,
    );
    expect(getArchitectureDocumentHashes(result.document).visualHash).not.toBe(
      beforeHashes.visualHash,
    );
  });

  it("does not normalize an invalid same-boundary relationship during a position-only move", () => {
    const document = loadFoundationArchitectureDocument();
    const invalidRelationshipDocument = parseArchitectureDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === "node_application"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                parent: {
                  nodeId: "node_zone",
                  relationshipType: "example.relationship.invalid-contained-by",
                },
              },
            }
          : node,
      ),
    });
    const beforeHashes = getArchitectureDocumentHashes(
      invalidRelationshipDocument,
    );
    const result = dispatchEditorNodeMove({
      catalog: foundationEditorCatalog,
      createId: createIdFactory(),
      document: invalidRelationshipDocument,
      nodeId: "node_application",
      position: { x: 208, y: 208 },
    });
    const application = result.document.nodes.find(
      (node) => node.id === "node_application",
    );

    expect(application?.semantic.parent).toEqual({
      nodeId: "node_zone",
      relationshipType: "example.relationship.invalid-contained-by",
    });
    expect(getArchitectureDocumentHashes(result.document).contentHash).toBe(
      beforeHashes.contentHash,
    );
    expect(getArchitectureDocumentHashes(result.document).visualHash).not.toBe(
      beforeHashes.visualHash,
    );
  });

  it("rejects a position-only move that would exceed boundary geometry", () => {
    const document = loadFoundationArchitectureDocument();
    const snapshot = structuredClone(document);

    const error = expectPlacementError(() =>
      dispatchEditorNodeMove({
        catalog: foundationEditorCatalog,
        createId: createIdFactory(),
        document,
        nodeId: "node_application",
        position: { x: 5_000, y: 4_000 },
      }),
    );

    expect(error.code).toBe("geometry-overflow");
    expect(document).toEqual(snapshot);
  });

  it("atomically preserves absolute position while moving a child to root", () => {
    const document = loadFoundationArchitectureDocument();
    const snapshot = structuredClone(document);
    const beforeHashes = getArchitectureDocumentHashes(document);
    const result = dispatchEditorNodePlacement({
      catalog: foundationEditorCatalog,
      createId: createIdFactory(),
      document,
      nodeId: "node_application",
      targetParentNodeId: null,
    });
    const application = result.document.nodes.find(
      (node) => node.id === "node_application",
    );

    expect(result.changes.map((change) => change.kind)).toEqual([
      "node-moved",
      "node-reparented",
      "batch-applied",
    ]);
    expect(application?.semantic.parent).toBeUndefined();
    expect(application?.presentation.position).toEqual({ x: 160, y: 360 });
    expect(result.absolutePosition).toEqual({ x: 160, y: 360 });
    expect(getArchitectureDocumentHashes(result.document).contentHash).not.toBe(
      beforeHashes.contentHash,
    );
    expect(document).toEqual(snapshot);
  });

  it("rejects an incompatible boundary without mutating the document", () => {
    const document = loadFoundationArchitectureDocument();
    const snapshot = structuredClone(document);

    const error = expectPlacementError(() =>
      prepareEditorNodePlacement({
        catalog: foundationEditorCatalog,
        createId: createIdFactory(),
        document,
        nodeId: "node_application",
        targetParentNodeId: "node_network",
      }),
    );
    expect(error.code).toBe("placement-invalid");
    expect(error.message).toContain("cannot be placed inside");
    expect(document).toEqual(snapshot);
  });

  it("rejects reparenting a boundary into its descendant", () => {
    const error = expectPlacementError(() =>
      prepareEditorNodePlacement({
        catalog: foundationEditorCatalog,
        createId: createIdFactory(),
        document: loadFoundationArchitectureDocument(),
        nodeId: "node_zone",
        targetParentNodeId: "node_application",
      }),
    );
    expect(error.code).toBe("placement-invalid");
    expect(error.message).toContain("descendants");
  });

  it("rejects a drop that would exceed the boundary maximum", () => {
    const error = expectPlacementError(() =>
      prepareEditorNodePlacement({
        catalog: foundationEditorCatalog,
        createId: createIdFactory(),
        document: loadFoundationArchitectureDocument(),
        nodeId: "node_application",
        position: { x: 5_000, y: 4_000 },
        positionSpace: "absolute",
        targetParentNodeId: "node_zone",
      }),
    );
    expect(error.code).toBe("geometry-overflow");
  });

  it("rejects a boundary move that would corrupt a descendant's absolute coordinates", () => {
    const document = loadFoundationArchitectureDocument();
    const snapshot = structuredClone(document);

    const error = expectPlacementError(() =>
      prepareEditorNodePlacement({
        catalog: foundationEditorCatalog,
        createId: createIdFactory(),
        document,
        nodeId: "node_network",
        position: { x: 999_952, y: 40 },
        positionSpace: "absolute",
        targetParentNodeId: null,
      }),
    );
    expect(error.code).toBe("coordinate-invalid");
    expect(document).toEqual(snapshot);
  });

  it("rejects command identity reuse anywhere in an atomic placement batch", () => {
    const identities = [
      "operation_placement_duplicate_1",
      "operation_placement_duplicate_2",
      "operation_placement_duplicate_1",
    ];

    const error = expectPlacementError(() =>
      prepareEditorNodePlacement({
        catalog: foundationEditorCatalog,
        createId: () =>
          identities.shift() ?? "operation_placement_duplicate_fallback",
        document: loadFoundationArchitectureDocument(),
        nodeId: "node_application",
        targetParentNodeId: null,
      }),
    );
    expect(error.code).toBe("duplicate-command-identity");
  });
});
