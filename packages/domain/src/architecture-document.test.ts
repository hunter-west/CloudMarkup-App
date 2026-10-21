import { readFile } from "node:fs/promises";

import {
  parseArchitectureDocumentV1Json,
  type ArchitectureNodeV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  ArchitectureDocumentSemanticError,
  getArchitectureSemanticProjection,
  parseArchitectureDocument,
  validateArchitectureDocumentSemantics,
} from "./index.js";

async function readFixture(path: string): Promise<string> {
  return readFile(
    new URL(
      `../../test-fixtures/fixtures/architecture-document/v1/${path}`,
      import.meta.url,
    ),
    "utf8",
  );
}

describe("Architecture Document domain validation", () => {
  it("accepts the representative document", async () => {
    const document = parseArchitectureDocument(
      JSON.parse(await readFixture("valid/representative.json")) as unknown,
    );

    expect(document.schemaVersion).toBe(3);
    expect(document.applicationContracts.contracts).toEqual([]);
    expect(document.externalResources.resources).toEqual([]);
    expect(document.workloadBehavior).toEqual({
      contractVersion: 2,
      workloads: [],
    });
    expect(validateArchitectureDocumentSemantics(document)).toEqual([]);
  });

  it("rejects duplicate node IDs in the explicit semantic stage", async () => {
    const structurallyValid = parseArchitectureDocumentV1Json(
      await readFixture("invalid/duplicate-node-id.json"),
    );

    expect(validateArchitectureDocumentSemantics(structurallyValid)).toEqual([
      expect.objectContaining({
        code: "duplicate_node_id",
        path: "$.nodes[1]",
      }),
    ]);
    expect(() => parseArchitectureDocument(structurallyValid)).toThrow(
      ArchitectureDocumentSemanticError,
    );
  });

  it("rejects duplicate stable IDs in every document collection", async () => {
    const valid = parseArchitectureDocumentV1Json(
      await readFixture("valid/representative.json"),
    );
    const [node] = valid.nodes;
    const [edge] = valid.edges;
    const [variable] = valid.variables;
    const [output] = valid.outputs;
    const [assumption] = valid.assumptions;
    const [requirement] = valid.unresolvedRequirements;

    if (
      node === undefined ||
      edge === undefined ||
      variable === undefined ||
      output === undefined ||
      assumption === undefined ||
      requirement === undefined
    ) {
      throw new Error("Representative fixture must populate every collection.");
    }

    const duplicateAll = parseArchitectureDocumentV1Json(
      JSON.stringify({
        ...valid,
        nodes: [...valid.nodes, node],
        edges: [...valid.edges, edge],
        variables: [...valid.variables, variable],
        outputs: [...valid.outputs, output],
        assumptions: [...valid.assumptions, assumption],
        unresolvedRequirements: [...valid.unresolvedRequirements, requirement],
      }),
    );

    expect(
      validateArchitectureDocumentSemantics(duplicateAll).map(
        (issue) => issue.code,
      ),
    ).toEqual(
      expect.arrayContaining([
        "duplicate_assumption_id",
        "duplicate_edge_id",
        "duplicate_node_id",
        "duplicate_output_id",
        "duplicate_requirement_id",
        "duplicate_variable_id",
      ]),
    );
  });

  it("reports broken parent and edge references deterministically", async () => {
    const structurallyValid = parseArchitectureDocumentV1Json(
      await readFixture("invalid/broken-references.json"),
    );

    expect(
      validateArchitectureDocumentSemantics(structurallyValid).map(
        (issue) => issue.code,
      ),
    ).toEqual([
      "broken_edge_source_reference",
      "broken_edge_target_reference",
      "broken_parent_reference",
    ]);
  });

  it("rejects self-parenting with a useful, value-safe error", async () => {
    const input = JSON.parse(
      await readFixture("invalid/self-parent.json"),
    ) as unknown;

    expect.assertions(4);
    try {
      parseArchitectureDocument(input);
    } catch (error) {
      expect(error).toBeInstanceOf(ArchitectureDocumentSemanticError);
      const semanticError = error as ArchitectureDocumentSemanticError;
      expect(semanticError.issues).toEqual([
        expect.objectContaining({
          code: "self_parent",
          path: "$.nodes[0].semantic.parent.nodeId",
        }),
      ]);
      expect(semanticError.message).toContain("[self_parent]");
      expect(semanticError.message).not.toContain("node_self");
    }
  });

  it("rejects duplicate and self-referential generated provenance", async () => {
    const valid = parseArchitectureDocumentV1Json(
      await readFixture("valid/representative.json"),
    );
    const generatedIndex = valid.nodes.findIndex(
      (node) => node.semantic.lifecycle.ownership === "generated",
    );
    const generated = valid.nodes[generatedIndex];
    if (generated?.semantic.lifecycle.ownership !== "generated") {
      throw new Error("Representative fixture must contain a generated node.");
    }
    const lifecycle = generated.semantic.lifecycle;
    const invalidGenerated: ArchitectureNodeV1 = {
      ...generated,
      semantic: {
        ...generated.semantic,
        lifecycle: {
          ...lifecycle,
          provenance: {
            ...lifecycle.provenance,
            dependentNodeIds: [
              generated.id,
              generated.id,
              ...lifecycle.provenance.dependentNodeIds,
            ],
          },
        },
      },
    };

    const invalid = parseArchitectureDocumentV1Json(
      JSON.stringify({
        ...valid,
        nodes: valid.nodes.map((node, index) =>
          index === generatedIndex ? invalidGenerated : node,
        ),
      }),
    );

    expect(
      validateArchitectureDocumentSemantics(invalid).map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining([
        "duplicate_generated_node_reference",
        "self_generated_node_reference",
      ]),
    );
  });

  it("excludes labels, positions, and incidental array order from semantics", async () => {
    const original = parseArchitectureDocument(
      JSON.parse(await readFixture("valid/representative.json")) as unknown,
    );
    const changedPresentation = parseArchitectureDocument({
      ...original,
      nodes: [...original.nodes].reverse().map((node, index) => ({
        ...node,
        presentation: {
          label: `Relabeled ${String(index)}`,
          position: {
            x: node.presentation.position.x + 1000,
            y: node.presentation.position.y - 1000,
          },
        },
      })),
      edges: [...original.edges].reverse(),
    });

    expect(getArchitectureSemanticProjection(changedPresentation)).toEqual(
      getArchitectureSemanticProjection(original),
    );
  });
});
