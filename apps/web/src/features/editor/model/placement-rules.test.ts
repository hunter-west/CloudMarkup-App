import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import type { EditorCatalog } from "./editor-catalog.js";
import {
  foundationEditorCatalog,
  loadFoundationArchitectureDocument,
} from "./foundation-editor-fixture.js";
import {
  listEditorNodePlacementOptions,
  resolveServiceCreationAvailability,
  validateEditorNodePlacement,
  visualBoundaryParentId,
} from "./placement-rules.js";

describe("editor placement rules", () => {
  it("retains a generated node's current boundary without advertising disallowed moves", () => {
    const document = loadFoundationArchitectureDocument();
    const generatedDocument = parseArchitectureDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === "node_application"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                lifecycle: {
                  ownership: "generated",
                  origin: "connection-rule",
                  provenance: {
                    generatorKind: "connection-rule",
                    generatorId: "example.generator.placement",
                    generatorVersion: "1.0.0",
                    operationId: "operation_generated_placement",
                    dependentNodeIds: [],
                    dependentEdgeIds: [],
                  },
                },
              },
            }
          : node,
      ),
    });
    const application = generatedDocument.nodes.find(
      (node) => node.id === "node_application",
    );
    const zone = generatedDocument.nodes.find(
      (node) => node.id === "node_zone",
    );
    if (application === undefined || zone === undefined) {
      throw new Error("Expected the generated application and zone nodes.");
    }

    expect(
      listEditorNodePlacementOptions(
        generatedDocument,
        foundationEditorCatalog,
        application.id,
      ).map((option) => option.parentNodeId),
    ).toEqual(["node_zone"]);
    expect(
      validateEditorNodePlacement(
        generatedDocument,
        foundationEditorCatalog,
        application.id,
        null,
      ),
    ).toMatchObject({
      code: "generated-requires-adoption",
      success: false,
    });
    expect(
      validateEditorNodePlacement(
        generatedDocument,
        foundationEditorCatalog,
        application.id,
        zone.id,
        { allowExistingGeneratedPlacement: true },
      ),
    ).toMatchObject({
      parent: {
        nodeId: "node_zone",
        relationshipType: "example.relationship.contained-by",
      },
      success: true,
    });
    expect(
      visualBoundaryParentId(
        generatedDocument,
        foundationEditorCatalog,
        application,
      ),
    ).toBe("node_zone");
  });

  it("uses one relationship-ambiguity policy for creation and reparenting", () => {
    const document = loadFoundationArchitectureDocument();
    const ambiguousCatalog: EditorCatalog = {
      ...foundationEditorCatalog,
      services: foundationEditorCatalog.services.map((service) =>
        service.serviceType === "example.compute"
          ? {
              ...service,
              placement: {
                ...service.placement,
                allowedParents: [
                  ...service.placement.allowedParents,
                  {
                    relationshipType:
                      "example.relationship.alternate-contained-by",
                    serviceType: "example.zone",
                  },
                ],
                rootPlacement: "forbidden",
              },
            }
          : service,
      ),
    };
    const detachedDocument = parseArchitectureDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === "node_application"
          ? {
              ...node,
              semantic: {
                configuration: node.semantic.configuration,
                deploymentKey: node.semantic.deploymentKey,
                lifecycle: node.semantic.lifecycle,
                resourceType: node.semantic.resourceType,
                serviceType: node.semantic.serviceType,
              },
            }
          : node,
      ),
    });
    const detachedApplication = detachedDocument.nodes.find(
      (node) => node.id === "node_application",
    );
    const detachedZone = detachedDocument.nodes.find(
      (node) => node.id === "node_zone",
    );
    if (detachedApplication === undefined || detachedZone === undefined) {
      throw new Error("Expected the detached application and zone nodes.");
    }

    expect(
      validateEditorNodePlacement(
        detachedDocument,
        ambiguousCatalog,
        detachedApplication.id,
        detachedZone.id,
      ),
    ).toMatchObject({
      code: "parent-ambiguous",
      success: false,
    });
    expect(
      resolveServiceCreationAvailability(
        detachedDocument,
        ambiguousCatalog,
        "example.compute",
      ),
    ).toMatchObject({
      code: "parent-ambiguous",
      enabled: false,
    });
  });

  it("fails closed when an existing parent relationship is not catalog-allowed", () => {
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
    const application = invalidRelationshipDocument.nodes.find(
      (node) => node.id === "node_application",
    );
    const zone = invalidRelationshipDocument.nodes.find(
      (node) => node.id === "node_zone",
    );
    if (application === undefined || zone === undefined) {
      throw new Error("Expected the application and zone nodes.");
    }

    expect(
      validateEditorNodePlacement(
        invalidRelationshipDocument,
        foundationEditorCatalog,
        application.id,
        zone.id,
      ),
    ).toMatchObject({
      code: "parent-unavailable",
      success: false,
    });
    expect(
      visualBoundaryParentId(
        invalidRelationshipDocument,
        foundationEditorCatalog,
        application,
      ),
    ).toBeNull();
  });
});
