import {
  GraphCommandApplicationError,
  applyGraphCommand,
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import {
  ArchitectureLayoutError,
  applyPreparedArchitectureLayout,
  createArchitectureLayoutRequest,
  prepareArchitectureLayout,
} from "./architecture-layout.js";
import {
  foundationEditorCatalog,
  loadFoundationArchitectureDocument,
} from "./foundation-editor-fixture.js";
import type { LayoutResult } from "./layout-adapter.js";
import { createMoveNodeCommand } from "./move-node-command.js";

function createSequentialIds(prefix = "operation_layout"): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}_${String(sequence).padStart(4, "0")}`;
  };
}

function createLayoutResult(
  document: ArchitectureDocument,
  overrides: Readonly<
    Record<string, { readonly x: number; readonly y: number }>
  > = {},
): LayoutResult {
  const request = createArchitectureLayoutRequest(
    document,
    foundationEditorCatalog,
  );
  const documentNodes: ReadonlyMap<
    string,
    ArchitectureDocument["nodes"][number]
  > = new Map(document.nodes.map((node) => [node.id, node]));

  return {
    positions: request.nodes.map((node) => {
      const documentNode = documentNodes.get(node.id);
      if (documentNode === undefined) {
        throw new Error(`Missing fixture node ${node.id}.`);
      }
      return {
        nodeId: node.id,
        parentId: node.parentId ?? null,
        position:
          overrides[node.id] ??
          structuredClone(documentNode.presentation.position),
      };
    }),
  };
}

function expectArchitectureLayoutError(
  callback: () => unknown,
): ArchitectureLayoutError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(ArchitectureLayoutError);
    if (error instanceof ArchitectureLayoutError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the layout result to be rejected.");
}

function expectInvalidResult(callback: () => unknown): void {
  expect(expectArchitectureLayoutError(callback).code).toBe("invalid-result");
}

describe("architecture automatic-layout commands", () => {
  it("projects nested parents, fixed dimensions, typed ports, and exact edge endpoints deterministically", () => {
    const document = loadFoundationArchitectureDocument();

    const first = createArchitectureLayoutRequest(
      document,
      foundationEditorCatalog,
    );
    const second = createArchitectureLayoutRequest(
      document,
      foundationEditorCatalog,
    );

    expect(second).toEqual(first);
    expect(first.nodes.map((node) => [node.id, node.parentId ?? null])).toEqual(
      [
        ["node_network", null],
        ["node_unknown", null],
        ["node_unsupported", null],
        ["node_zone", "node_network"],
        ["node_application", "node_zone"],
      ],
    );
    expect(
      first.nodes.find((node) => node.id === "node_application")?.ports,
    ).toEqual([
      {
        direction: "output",
        id: "example.port.network-client",
      },
      {
        direction: "input",
        id: "example.port.request",
      },
    ]);
    expect(first.edges).toEqual([
      {
        id: "edge_application_network",
        source: {
          nodeId: "node_application",
          portId: "example.port.network-client",
        },
        target: {
          nodeId: "node_network",
          portId: "example.port.network-segment",
        },
      },
      {
        id: "edge_unknown_application",
        source: {
          nodeId: "node_unknown",
          portId: "example.port.mystery-output",
        },
        target: {
          nodeId: "node_application",
          portId: "example.port.request",
        },
      },
    ]);
    for (const node of first.nodes) {
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    }
  });

  it("prepares one deterministic atomic batch and persists only snapped positions", () => {
    const document = loadFoundationArchitectureDocument();
    const result = createLayoutResult(document, {
      node_application: { x: 51, y: 173 },
      node_unknown: { x: 883, y: 179 },
    });

    const prepared = prepareArchitectureLayout(
      document,
      foundationEditorCatalog,
      {
        positions: [...result.positions].reverse(),
      },
      createSequentialIds(),
    );
    const repeated = prepareArchitectureLayout(
      document,
      foundationEditorCatalog,
      result,
      createSequentialIds(),
    );

    expect(prepared).not.toBeNull();
    expect(repeated).not.toBeNull();
    if (prepared === null || repeated === null) {
      throw new Error("Expected a non-empty layout preview.");
    }

    expect(prepared.command).toEqual(repeated.command);
    expect([...prepared.positions]).toEqual([...repeated.positions]);
    expect(prepared.command).toEqual({
      schemaVersion: 1,
      commandId: "operation_layout_0005",
      inverseCommandId: "operation_layout_0006",
      origin: "user",
      target: {
        architectureId: "architecture_manual_canvas_foundation",
        documentId: "doc_manual_canvas_foundation",
        revisionId: "revision_manual_canvas_0001",
      },
      kind: "batch",
      commands: [
        {
          schemaVersion: 1,
          commandId: "operation_layout_0001",
          inverseCommandId: "operation_layout_0002",
          origin: "user",
          target: {
            architectureId: "architecture_manual_canvas_foundation",
            documentId: "doc_manual_canvas_foundation",
            revisionId: "revision_manual_canvas_0001",
          },
          kind: "move-node",
          nodeId: "node_application",
          expectedPosition: { x: 40, y: 160 },
          position: { x: 48, y: 176 },
        },
        {
          schemaVersion: 1,
          commandId: "operation_layout_0003",
          inverseCommandId: "operation_layout_0004",
          origin: "user",
          target: {
            architectureId: "architecture_manual_canvas_foundation",
            documentId: "doc_manual_canvas_foundation",
            revisionId: "revision_manual_canvas_0001",
          },
          kind: "move-node",
          nodeId: "node_unknown",
          expectedPosition: { x: 860, y: 170 },
          position: { x: 880, y: 176 },
        },
      ],
    });

    const applied = applyPreparedArchitectureLayout(document, prepared);
    expect(
      applied.document.nodes.find((node) => node.id === "node_application")
        ?.presentation.position,
    ).toEqual({ x: 48, y: 176 });
    expect(
      applied.document.nodes.find((node) => node.id === "node_unknown")
        ?.presentation.position,
    ).toEqual({ x: 880, y: 176 });
    expect(applied.document.nodes.map((node) => node.semantic)).toEqual(
      document.nodes.map((node) => node.semantic),
    );
  });

  it("preserves the semantic hash while changing the visual hash", () => {
    const document = loadFoundationArchitectureDocument();
    const prepared = prepareArchitectureLayout(
      document,
      foundationEditorCatalog,
      createLayoutResult(document, {
        node_application: { x: 64, y: 192 },
      }),
      createSequentialIds("operation_layout_hash"),
    );
    if (prepared === null) {
      throw new Error("Expected a non-empty layout preview.");
    }

    const before = getArchitectureDocumentHashes(document);
    const after = getArchitectureDocumentHashes(
      applyPreparedArchitectureLayout(document, prepared).document,
    );

    expect(prepared.baseHashes).toEqual(before);
    expect(prepared.previewHashes.contentHash).toBe(before.contentHash);
    expect(prepared.previewHashes.visualHash).not.toBe(before.visualHash);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.visualHash).toBe(prepared.previewHashes.visualHash);
  });

  it("rejects missing, duplicate, unknown, reparenting, non-finite, and overflowing results", () => {
    const document = loadFoundationArchitectureDocument();
    const valid = createLayoutResult(document);

    expectInvalidResult(() =>
      prepareArchitectureLayout(
        document,
        foundationEditorCatalog,
        { positions: valid.positions.slice(1) },
        createSequentialIds(),
      ),
    );
    expectInvalidResult(() =>
      prepareArchitectureLayout(
        document,
        foundationEditorCatalog,
        {
          positions: [
            ...valid.positions.slice(0, -1),
            valid.positions[0] ?? {
              nodeId: "node_missing",
              parentId: null,
              position: { x: 0, y: 0 },
            },
          ],
        },
        createSequentialIds(),
      ),
    );
    expectInvalidResult(() =>
      prepareArchitectureLayout(
        document,
        foundationEditorCatalog,
        {
          positions: valid.positions.map((position) =>
            position.nodeId === "node_application"
              ? { ...position, nodeId: "node_missing" }
              : position,
          ),
        },
        createSequentialIds(),
      ),
    );
    expectInvalidResult(() =>
      prepareArchitectureLayout(
        document,
        foundationEditorCatalog,
        {
          positions: valid.positions.map((position) =>
            position.nodeId === "node_application"
              ? { ...position, parentId: null }
              : position,
          ),
        },
        createSequentialIds(),
      ),
    );
    expectInvalidResult(() =>
      prepareArchitectureLayout(
        document,
        foundationEditorCatalog,
        {
          positions: valid.positions.map((position) =>
            position.nodeId === "node_application"
              ? {
                  ...position,
                  position: { x: Number.NaN, y: position.position.y },
                }
              : position,
          ),
        },
        createSequentialIds(),
      ),
    );
    expectInvalidResult(() =>
      prepareArchitectureLayout(
        document,
        foundationEditorCatalog,
        {
          positions: valid.positions.map((position) =>
            position.nodeId === "node_application"
              ? { ...position, position: { x: 2, y: 2 } }
              : position,
          ),
        },
        createSequentialIds(),
      ),
    );
    expectInvalidResult(() =>
      prepareArchitectureLayout(
        document,
        foundationEditorCatalog,
        {
          positions: valid.positions.map((position) =>
            position.nodeId === "node_network"
              ? { ...position, position: { x: 999_952, y: 40 } }
              : position,
          ),
        },
        createSequentialIds(),
      ),
    );
  });

  it("fails closed on stale position preconditions without applying the prepared batch", () => {
    const document = loadFoundationArchitectureDocument();
    const prepared = prepareArchitectureLayout(
      document,
      foundationEditorCatalog,
      createLayoutResult(document, {
        node_application: { x: 64, y: 192 },
      }),
      createSequentialIds("operation_layout_stale"),
    );
    if (prepared === null) {
      throw new Error("Expected a non-empty layout preview.");
    }

    const intervening = applyGraphCommand(
      document,
      createMoveNodeCommand({
        createId: createSequentialIds("operation_intervening"),
        document,
        nodeId: "node_application",
        position: { x: 72, y: 200 },
      }),
    );

    try {
      applyPreparedArchitectureLayout(intervening.document, prepared);
      throw new Error("Expected stale layout preconditions to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphCommandApplicationError);
      if (!(error instanceof GraphCommandApplicationError)) {
        throw error;
      }
      expect(error.issues).toContainEqual({
        code: "precondition_failed",
        message: "Node position no longer matches the expected value.",
        path: "$.commands[0].expectedPosition",
      });
    }
    expect(
      intervening.document.nodes.find((node) => node.id === "node_unknown")
        ?.presentation.position,
    ).toEqual({ x: 860, y: 170 });
  });

  it("rejects a preview after an unrelated visual change", () => {
    const foundationDocument = loadFoundationArchitectureDocument();
    const document = parseArchitectureDocument({
      ...foundationDocument,
      nodes: foundationDocument.nodes.map((node) =>
        node.id === "node_unknown"
          ? {
              ...node,
              presentation: {
                ...node.presentation,
                position: { x: 864, y: 168 },
              },
            }
          : node,
      ),
    });
    const prepared = prepareArchitectureLayout(
      document,
      foundationEditorCatalog,
      createLayoutResult(document, {
        node_application: { x: 64, y: 192 },
      }),
      createSequentialIds("operation_layout_unrelated_stale"),
    );
    if (prepared === null) {
      throw new Error("Expected a non-empty layout preview.");
    }

    const intervening = applyGraphCommand(
      document,
      createMoveNodeCommand({
        createId: createSequentialIds("operation_unrelated_move"),
        document,
        nodeId: "node_unknown",
        position: { x: 904, y: 192 },
      }),
    ).document;

    const error = expectArchitectureLayoutError(() =>
      applyPreparedArchitectureLayout(intervening, prepared),
    );
    expect(error.code).toBe("stale-preview");
    expect(
      intervening.nodes.find((node) => node.id === "node_application")
        ?.presentation.position,
    ).toEqual({ x: 40, y: 160 });
  });

  it("rejects command identity reuse anywhere in an atomic layout batch", () => {
    const document = loadFoundationArchitectureDocument();
    const identities = [
      "operation_layout_duplicate_1",
      "operation_layout_duplicate_2",
      "operation_layout_duplicate_1",
    ];

    try {
      prepareArchitectureLayout(
        document,
        foundationEditorCatalog,
        createLayoutResult(document, {
          node_application: { x: 64, y: 192 },
        }),
        () => identities.shift() ?? "operation_layout_duplicate_fallback",
      );
      throw new Error("Expected duplicate layout command IDs to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureLayoutError);
      if (!(error instanceof ArchitectureLayoutError)) {
        throw error;
      }
      expect(error.code).toBe("duplicate-command-identity");
    }
  });
});
