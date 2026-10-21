import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";
import { connectedPerformanceDocument } from "./beta-performance-fixture.js";
import { mapArchitectureDocumentToFlow } from "./model/index.js";

function measure<T>(operation: () => T): {
  readonly elapsedMilliseconds: number;
  readonly result: T;
} {
  const started = performance.now();
  const result = operation();
  return {
    elapsedMilliseconds: Math.round((performance.now() - started) * 100) / 100,
    result,
  };
}

describe("Prompt 49 representative editor performance contract", () => {
  it("profiles connected graphs and deterministic high fanout within unchanged schema bounds", () => {
    const observations = [];
    for (const size of [
      { nodes: 1_000, edges: 2_000 },
      { nodes: 500, edges: 499, highFanout: true },
    ]) {
      const document = connectedPerformanceDocument(
        size.nodes,
        size.edges,
        size.highFanout,
      );
      const projection = measure(() =>
        mapArchitectureDocumentToFlow(document, awsEditorCatalog),
      );
      expect(projection.result.nodes).toHaveLength(size.nodes);
      expect(projection.result.edges).toHaveLength(size.edges);
      expect(
        new Set(
          document.edges.map(
            (edge) =>
              `${edge.semantic.source.nodeId}:${edge.semantic.target.nodeId}`,
          ),
        ).size,
      ).toBe(size.edges);
      for (const edge of projection.result.edges) {
        expect(edge.data?.relationship.kind).toBe("catalog");
        expect(edge.data?.sourceDockRank).toBeLessThan(
          edge.data?.sourceDockCount ?? 0,
        );
        expect(edge.data?.targetDockRank).toBeLessThan(
          edge.data?.targetDockCount ?? 0,
        );
      }
      if (size.highFanout === true) {
        expect(
          projection.result.edges.map((edge) => edge.data?.sourceDockRank),
        ).toEqual(Array.from({ length: size.edges }, (_, index) => index));
        expect(
          projection.result.edges.every(
            (edge) =>
              edge.data?.sourceDockCount === size.edges &&
              edge.data.targetDockRank === 0 &&
              edge.data.targetDockCount === 1,
          ),
        ).toBe(true);
      }
      observations.push({
        ...size,
        projection: projection.elapsedMilliseconds,
        serializedBytes: new TextEncoder().encode(
          serializeCanonicalJson(document),
        ).byteLength,
      });
    }
    console.info("Connected editor projection observation", observations);
  });
});
