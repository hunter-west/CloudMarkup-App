import {
  applyGraphCommand,
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import {
  createDisconnectEdgeCommand,
  DisconnectEdgeCommandError,
  dispatchDisconnectEdgeCommand,
} from "./disconnect-edge-command.js";
import { loadFoundationArchitectureDocument } from "./foundation-editor-fixture.js";

function idFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `operation_disconnect_edge_${String(sequence).padStart(4, "0")}`;
  };
}

describe("disconnect edge Graph Command", () => {
  it("removes only the exact user-owned edge and provides a safe inverse", () => {
    const document = loadFoundationArchitectureDocument();
    const edgeId = "edge_unknown_application";
    const beforeHashes = getArchitectureDocumentHashes(document);
    const result = dispatchDisconnectEdgeCommand({
      createId: idFactory(),
      document,
      edgeId,
    });

    expect(result.command).toMatchObject({
      edgeId,
      kind: "remove-edge",
      expectedEdge: document.edges.find((edge) => edge.id === edgeId),
    });
    expect(result.changes).toEqual([
      expect.objectContaining({ edgeId, kind: "edge-removed" }),
    ]);
    expect(result.document).toEqual({
      ...document,
      edges: document.edges.filter((edge) => edge.id !== edgeId),
    });
    expect(result.document.nodes).toEqual(document.nodes);
    expect(result.document.variables).toEqual(document.variables);
    expect(result.document.outputs).toEqual(document.outputs);
    expect(result.document.revision).toEqual(document.revision);
    expect(getArchitectureDocumentHashes(result.document).visualHash).toBe(
      beforeHashes.visualHash,
    );

    if (result.inversion.kind !== "available") {
      throw new Error("Expected disconnect to provide a safe inverse.");
    }
    expect(
      applyGraphCommand(result.document, result.inversion.command).document,
    ).toEqual(document);
  });

  it("preserves another exact edge sharing the same target dock", () => {
    const foundation = loadFoundationArchitectureDocument();
    const application = foundation.nodes.find(
      (node) => node.id === "node_application",
    );
    const attached = foundation.edges.find(
      (edge) => edge.id === "edge_application_network",
    );
    if (application === undefined || attached === undefined) {
      throw new Error("Expected the foundation connection fixtures.");
    }
    const secondApplication = {
      ...structuredClone(application),
      id: "node_application_second",
      semantic: {
        ...structuredClone(application.semantic),
        deploymentKey: "application_second",
      },
      presentation: {
        ...structuredClone(application.presentation),
        label: "Application two",
        position: { x: 720, y: 328 },
      },
    };
    const secondEdge = {
      ...structuredClone(attached),
      id: "edge_application_second_network",
      semantic: {
        ...structuredClone(attached.semantic),
        source: {
          ...structuredClone(attached.semantic.source),
          nodeId: secondApplication.id,
        },
      },
    };
    const document = parseArchitectureDocument({
      ...foundation,
      nodes: [...foundation.nodes, secondApplication],
      edges: [...foundation.edges, secondEdge],
    });
    expect(secondEdge.semantic.target).toEqual(attached.semantic.target);

    const result = dispatchDisconnectEdgeCommand({
      createId: idFactory(),
      document,
      edgeId: attached.id,
    });

    expect(result.document.edges).not.toContainEqual(attached);
    expect(result.document.edges).toContainEqual(secondEdge);
    expect(result.document.nodes).toEqual(document.nodes);
  });

  it.each(["generated", "adopted"] as const)(
    "refuses %s edge cleanup from the direct disconnect path",
    (ownership) => {
      const document = loadFoundationArchitectureDocument();
      const edgeId = "edge_application_network";
      const provenance = {
        generatorKind: "connection-rule" as const,
        generatorId: "example.generator.connection",
        generatorVersion: "1.0.0",
        operationId: "operation_generated_connection",
        dependentNodeIds: [],
        dependentEdgeIds: [],
      };
      const restrictedDocument = {
        ...document,
        edges: document.edges.map((edge) =>
          edge.id !== edgeId
            ? edge
            : {
                ...edge,
                semantic: {
                  ...edge.semantic,
                  lifecycle:
                    ownership === "generated"
                      ? {
                          ownership,
                          origin: "connection-rule",
                          provenance,
                        }
                      : {
                          ownership,
                          origin: "connection-rule",
                          provenance,
                          adoptedBy: "actor_editor_user",
                          adoptedAt: "2026-08-02T00:00:00.000Z",
                        },
                },
              },
        ),
      } as unknown as ArchitectureDocument;

      expect(() =>
        createDisconnectEdgeCommand({
          createId: idFactory(),
          document: restrictedDocument,
          edgeId,
        }),
      ).toThrow(DisconnectEdgeCommandError);
    },
  );
});
