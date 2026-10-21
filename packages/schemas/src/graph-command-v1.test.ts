import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  parseArchitectureDocumentV1Json,
  parseGraphCommandV1,
} from "./index.js";
import { GraphCommandSchemaError } from "./graph-command-validation.js";

async function representativeDocument() {
  return parseArchitectureDocumentV1Json(
    await readFile(
      new URL(
        "../../test-fixtures/fixtures/architecture-document/v1/valid/representative.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

describe("Graph Command v1 schema", () => {
  it("parses a strict versioned command", async () => {
    const document = await representativeDocument();
    const node = document.nodes[0];
    if (node === undefined) {
      throw new Error("Representative fixture must contain a node.");
    }

    const command = parseGraphCommandV1({
      schemaVersion: 1,
      commandId: "operation_move_schema",
      inverseCommandId: "operation_move_schema_inverse",
      origin: "user",
      target: {
        documentId: document.documentId,
        architectureId: document.architectureId,
        revisionId: document.revision.revisionId,
      },
      kind: "move-node",
      nodeId: node.id,
      expectedPosition: node.presentation.position,
      position: { x: 100, y: 200 },
    });

    expect(command.kind).toBe("move-node");
    expect(command.schemaVersion).toBe(1);
  });

  it("requires an exact generated-resource release disposition", async () => {
    const document = await representativeDocument();
    const generatedNode = document.nodes.find(
      (node) => node.semantic.lifecycle.ownership === "generated",
    );
    if (generatedNode?.semantic.lifecycle.ownership !== "generated") {
      throw new Error("Representative fixture must contain a generated node.");
    }

    const release = {
      schemaVersion: 1,
      commandId: "operation_release_schema",
      inverseCommandId: "operation_release_schema_inverse",
      origin: "connection-rule",
      target: {
        documentId: document.documentId,
        architectureId: document.architectureId,
        revisionId: document.revision.revisionId,
      },
      kind: "release-generated-resource",
      resource: { kind: "node", nodeId: generatedNode.id },
      expectedLifecycle: generatedNode.semantic.lifecycle,
      dependencies: [],
    };

    for (const requiredDisposition of ["removed", "retained"] as const) {
      const command = parseGraphCommandV1({
        ...release,
        requiredDisposition,
      });
      if (command.kind !== "release-generated-resource") {
        throw new Error("Expected a generated-resource release command.");
      }
      expect(command.requiredDisposition).toBe(requiredDisposition);
    }

    expect(() => parseGraphCommandV1(release)).toThrow(GraphCommandSchemaError);
    expect(() =>
      parseGraphCommandV1({
        ...release,
        requiredDisposition: "deleted",
      }),
    ).toThrow(GraphCommandSchemaError);
  });

  it("rejects unsupported versions, unknown fields, and nested batches safely", async () => {
    const document = await representativeDocument();
    const target = {
      documentId: document.documentId,
      architectureId: document.architectureId,
      revisionId: document.revision.revisionId,
    };
    const move = {
      schemaVersion: 1,
      commandId: "operation_nested_move",
      inverseCommandId: "operation_nested_move_inverse",
      origin: "user",
      target,
      kind: "move-node",
      nodeId: "node_network",
      expectedPosition: { x: 80, y: 40 },
      position: { x: 81, y: 41 },
    };

    expect(() => parseGraphCommandV1({ ...move, schemaVersion: 2 })).toThrow(
      GraphCommandSchemaError,
    );

    expect.assertions(4);
    try {
      parseGraphCommandV1({
        ...move,
        untrustedValue: "must-not-appear-in-errors",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(GraphCommandSchemaError);
      expect((error as Error).message).not.toContain(
        "must-not-appear-in-errors",
      );
    }

    expect(() =>
      parseGraphCommandV1({
        schemaVersion: 1,
        commandId: "operation_outer_batch",
        inverseCommandId: "operation_outer_batch_inverse",
        origin: "user",
        target,
        kind: "batch",
        commands: [
          {
            schemaVersion: 1,
            commandId: "operation_inner_batch",
            inverseCommandId: "operation_inner_batch_inverse",
            origin: "user",
            target,
            kind: "batch",
            commands: [move],
          },
        ],
      }),
    ).toThrow(GraphCommandSchemaError);
  });
});
