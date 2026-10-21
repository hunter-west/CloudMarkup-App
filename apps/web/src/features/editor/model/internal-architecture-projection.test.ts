import {
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import {
  foundationEditorCatalog,
  loadFoundationArchitectureDocument,
} from "./foundation-editor-fixture.js";
import { mapArchitectureDocumentToFlow } from "./architecture-flow-adapter.js";
import { createArchitectureLayoutRequest } from "./architecture-layout.js";

describe("normal architecture projection", () => {
  it("retains non-deployable graph configuration in hashes while omitting its canvas, tree, and layout projection", () => {
    const base = loadFoundationArchitectureDocument();
    const templateEdge = base.edges[0];
    const templateNode = base.nodes.find(
      (node) => node.id === templateEdge?.semantic.source.nodeId,
    );
    const templateService = foundationEditorCatalog.services.find(
      (service) =>
        service.serviceType === templateNode?.semantic.serviceType &&
        service.resourceType === templateNode.semantic.resourceType,
    );
    if (
      templateEdge === undefined ||
      templateNode === undefined ||
      templateService === undefined
    ) {
      throw new Error("Expected a foundation source node and exact service.");
    }

    const hiddenNodeId = "node_internal_policy";
    const hiddenEdgeId = "edge_internal_policy_owner";
    const document = parseArchitectureDocument({
      ...structuredClone(base),
      nodes: [
        ...structuredClone(base.nodes),
        {
          ...structuredClone(templateNode),
          id: hiddenNodeId,
          semantic: {
            ...structuredClone(templateNode.semantic),
            deploymentKey: "internal_policy",
            resourceType: "example.internal.policy",
            serviceType: "example.internal.policy",
          },
          presentation: {
            ...structuredClone(templateNode.presentation),
            label: "Internal policy",
            position: structuredClone(templateNode.presentation.position),
          },
        },
      ],
      edges: [
        ...structuredClone(base.edges),
        {
          ...structuredClone(templateEdge),
          id: hiddenEdgeId,
          semantic: {
            ...structuredClone(templateEdge.semantic),
            relationshipType: "example.internal-policy-owner",
            source: {
              ...structuredClone(templateEdge.semantic.source),
              nodeId: hiddenNodeId,
            },
          },
        },
      ],
    });
    const catalog = {
      ...foundationEditorCatalog,
      services: [
        ...foundationEditorCatalog.services,
        {
          ...templateService,
          deployable: false,
          iconId: null,
          resourceType: "example.internal.policy",
          serviceType: "example.internal.policy",
        },
      ],
    };
    const hashes = getArchitectureDocumentHashes(document);
    const model = mapArchitectureDocumentToFlow(document, catalog);
    const layout = createArchitectureLayoutRequest(document, catalog);

    expect(document.nodes.some((node) => node.id === hiddenNodeId)).toBe(true);
    expect(document.edges.some((edge) => edge.id === hiddenEdgeId)).toBe(true);
    expect(getArchitectureDocumentHashes(document)).toEqual(hashes);
    expect(hashes.contentHash).not.toBe(
      getArchitectureDocumentHashes(base).contentHash,
    );
    expect(model.nodes.some((node) => node.id === hiddenNodeId)).toBe(false);
    expect(model.edges.some((edge) => edge.id === hiddenEdgeId)).toBe(false);
    expect(layout.nodes.some((node) => node.id === hiddenNodeId)).toBe(false);
    expect(layout.edges.some((edge) => edge.id === hiddenEdgeId)).toBe(false);
  });
});
