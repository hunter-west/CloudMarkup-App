import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { awsConnectionPresentationV1 } from "@cloudmarkup/provider-aws/connection-presentation";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import {
  foundationArchitectureInput,
  foundationEditorCatalog,
  loadFoundationArchitectureDocument,
} from "./foundation-editor-fixture.js";
import { resolveEditorConnectionGroups } from "./connection-docks.js";
import {
  createArchitectureFlowProjection,
  mapArchitectureDocumentToFlow,
} from "./architecture-flow-adapter.js";

const AWS_EDGE_PURPOSE_LABEL_CASES = [
  ["App client registration", "Registers client"],
  ["Assumable role", "Provides role"],
  ["Data read", "Reads"],
  ["Data write", "Writes"],
  ["DynamoDB resource", "Scopes access"],
  ["JWT audience", "Provides audience"],
  ["JWT issuer", "Provides authentication"],
  ["Logging", "Sends logs"],
  ["Role policy", "Attaches policy"],
  ["Route invocation", "Invokes"],
  ["Telemetry", "Sends metrics"],
] as const;

const CONCISE_EDGE_PURPOSE_LABEL_CASES = [
  ...AWS_EDGE_PURPOSE_LABEL_CASES,
  ["Network client", "Uses network"],
] as const;

function catalogWithFoundationSourcePortDisplayName(displayName: string) {
  return {
    ...foundationEditorCatalog,
    services: foundationEditorCatalog.services.map((service) => ({
      ...service,
      ports: service.ports.map((port) =>
        port.id === "example.port.network-client"
          ? { ...port, displayName }
          : port,
      ),
    })),
  };
}

describe("mapArchitectureDocumentToFlow", () => {
  it("reuses presentation and unrelated nodes/edges while previewing ancestor geometry", () => {
    const document = loadFoundationArchitectureDocument();
    const projection = createArchitectureFlowProjection(
      document,
      foundationEditorCatalog,
    );
    const base = projection.model;
    const positions = new Map([["node_application", { x: 480, y: 240 }]]);
    projection.validatePositions(positions);
    const preview = projection.projectPositions(positions);
    const moved = preview.nodes.find((node) => node.id === "node_application");
    const original = base.nodes.find((node) => node.id === "node_application");
    expect(moved?.position).toEqual({ x: 480, y: 240 });
    expect(moved?.data).toBe(original?.data);
    expect(preview.edges).toBe(base.edges);
    expect(preview.nodes.find((node) => node.id === "node_unknown")).toBe(
      base.nodes.find((node) => node.id === "node_unknown"),
    );
    expect(
      preview.nodes.find((node) => node.id === "node_zone")?.initialWidth,
    ).toBe(672);
    expect(projection.projectPositions(new Map())).toBe(base);
    expect(
      document.nodes.find((node) => node.id === "node_application")
        ?.presentation.position,
    ).toEqual({ x: 40, y: 160 });
  });

  it("rejects non-finite and accumulated out-of-range preview coordinates", () => {
    const projection = createArchitectureFlowProjection(
      loadFoundationArchitectureDocument(),
      foundationEditorCatalog,
    );
    expect(() => {
      projection.validatePositions(
        new Map([["node_application", { x: Number.NaN, y: 160 }]]),
      );
    }).toThrow("must be finite");
    expect(() => {
      projection.validatePositions(
        new Map([["node_network", { x: 999_999, y: 80 }]]),
      );
    }).toThrow("exceeds the supported editor coordinate range");
  });
  it("maps exact identities, explicit node kinds, typed handles, and stable IDs", () => {
    const document = loadFoundationArchitectureDocument();
    const flow = mapArchitectureDocumentToFlow(
      document,
      foundationEditorCatalog,
    );

    expect(flow.catalogBinding).toEqual({ kind: "exact" });
    expect(flow.nodes.map((node) => node.id)).toEqual([
      "node_network",
      "node_unknown",
      "node_unsupported",
      "node_zone",
      "node_application",
    ]);
    expect(flow.edges.map((edge) => edge.id)).toEqual([
      "edge_application_network",
      "edge_unknown_application",
    ]);

    const application = flow.nodes.find(
      (node) => node.id === "node_application",
    );
    const network = flow.nodes.find((node) => node.id === "node_network");
    const zone = flow.nodes.find((node) => node.id === "node_zone");
    const attachment = flow.edges.find(
      (edge) => edge.id === "edge_application_network",
    );

    expect(application).toMatchObject({
      id: "node_application",
      type: "resource",
      connectable: true,
      draggable: true,
      parentId: "node_zone",
      position: { x: 40, y: 160 },
      data: {
        architectureNodeId: "node_application",
        nodeKind: "resource",
        fallbackReason: null,
        parentNodeId: "node_zone",
      },
    });
    expect(application?.data.ports).toEqual([
      expect.objectContaining({
        id: "example.port.network-client",
        groupId: "network-and-security",
        handleId: "dock:network-and-security:output",
        direction: "output",
        capability: "example.capability.network-client",
        cardinality: "one",
        category: "network-and-security",
        actionable: true,
        hasExistingEdge: true,
        binding: "catalog",
      }),
      expect.objectContaining({
        id: "example.port.request",
        groupId: "invokes-another-workload",
        handleId: "dock:invokes-another-workload:input",
        direction: "input",
        capability: "example.capability.request",
        cardinality: "many",
        category: "invokes-another-workload",
        actionable: false,
        hasExistingEdge: true,
        binding: "catalog",
      }),
    ]);
    expect(application?.data.connectionGroups).toEqual([
      expect.objectContaining({
        currentEdgeIds: ["edge_unknown_application"],
        id: "invokes-another-workload",
        portIds: ["example.port.request"],
        side: "left",
      }),
      expect.objectContaining({
        currentEdgeIds: ["edge_application_network"],
        id: "network-and-security",
        portIds: ["example.port.network-client"],
        side: "right",
      }),
    ]);
    expect(network).toMatchObject({
      id: "node_network",
      type: "boundary",
      draggable: true,
      data: {
        nodeKind: "boundary",
        childCount: 1,
        childNodeIds: ["node_zone"],
      },
    });
    expect(network === undefined ? true : "parentId" in network).toBe(false);
    expect(zone).toMatchObject({
      id: "node_zone",
      type: "boundary",
      parentId: "node_network",
      position: { x: 40, y: 160 },
      data: {
        childCount: 1,
        childNodeIds: ["node_application"],
        nodeKind: "boundary",
        parentNodeId: "node_network",
      },
    });
    expect(attachment).toMatchObject({
      id: "edge_application_network",
      source: "node_application",
      target: "node_network",
      sourceHandle: "dock:network-and-security:output",
      targetHandle: "dock:network-and-security:input",
      data: {
        label: "Uses network",
        sourceConnectionGroupId: "network-and-security",
        sourceDockCount: 1,
        sourceDockRank: 0,
        sourceDockSide: "right",
        targetDockSide: "left",
        sourcePortId: "example.port.network-client",
        sourceLabel: "Application",
        targetConnectionGroupId: "network-and-security",
        targetDockCount: 1,
        targetDockRank: 0,
        targetPortId: "example.port.network-segment",
        targetLabel: "Application network",
        isGenericFallback: false,
      },
    });
  });

  it("projects catalog-authored dock sides into nodes and exact edge endpoints", () => {
    const authoredSideCatalog = {
      ...foundationEditorCatalog,
      services: foundationEditorCatalog.services.map((service) => ({
        ...service,
        connectionGroups: resolveEditorConnectionGroups(service).map((group) =>
          group.id === "network-and-security"
            ? {
                ...group,
                side:
                  service.serviceType === "example.compute"
                    ? ("top" as const)
                    : service.serviceType === "example.network"
                      ? ("bottom" as const)
                      : group.side,
              }
            : group,
        ),
      })),
    };
    const flow = mapArchitectureDocumentToFlow(
      loadFoundationArchitectureDocument(),
      authoredSideCatalog,
    );

    expect(
      flow.nodes
        .find((node) => node.id === "node_application")
        ?.data.connectionGroups.find(
          (group) => group.id === "network-and-security",
        ),
    ).toMatchObject({ side: "top" });
    expect(
      flow.nodes
        .find((node) => node.id === "node_network")
        ?.data.connectionGroups.find(
          (group) => group.id === "network-and-security",
        ),
    ).toMatchObject({ side: "bottom" });
    expect(
      flow.edges.find((edge) => edge.id === "edge_application_network"),
    ).toMatchObject({
      data: { sourceDockSide: "top", targetDockSide: "bottom" },
    });
  });

  it("covers every current AWS relationship with its generated concise label", () => {
    expect(
      (awsEditorCatalog.relationships ?? [])
        .map((relationship) => ({
          label: relationship.presentationLabel,
          ruleId: relationship.descriptorId,
        }))
        .sort((left, right) => left.ruleId.localeCompare(right.ruleId)),
    ).toEqual(
      awsConnectionPresentationV1.artifact.relationshipLabels
        .map((relationship) => ({
          label: relationship.label,
          ruleId: relationship.ruleId,
        }))
        .sort((left, right) => left.ruleId.localeCompare(right.ruleId)),
    );
  });

  it.each(CONCISE_EDGE_PURPOSE_LABEL_CASES)(
    'presents exact source port "%s" as purpose "%s"',
    (sourcePortDisplayName, expectedLabel) => {
      const flow = mapArchitectureDocumentToFlow(
        loadFoundationArchitectureDocument(),
        catalogWithFoundationSourcePortDisplayName(sourcePortDisplayName),
      );
      const attachment = flow.edges.find(
        (edge) => edge.id === "edge_application_network",
      );

      expect(attachment).toMatchObject({
        label: expectedLabel,
        data: {
          label: expectedLabel,
          sourcePortId: "example.port.network-client",
          relationship: { kind: "catalog" },
          isGenericFallback: false,
        },
      });
    },
  );

  it("preserves an unreviewed exact source-port name without inferring meaning", () => {
    const flow = mapArchitectureDocumentToFlow(
      loadFoundationArchitectureDocument(),
      catalogWithFoundationSourcePortDisplayName("Future exact connection"),
    );
    const attachment = flow.edges.find(
      (edge) => edge.id === "edge_application_network",
    );

    expect(attachment).toMatchObject({
      label: "Future exact connection",
      data: {
        label: "Future exact connection",
        sourcePortId: "example.port.network-client",
        relationship: { kind: "catalog" },
        isGenericFallback: false,
      },
    });
  });

  it("renders unknown and catalog-defined unsupported resources as visible fallbacks", () => {
    const flow = mapArchitectureDocumentToFlow(
      loadFoundationArchitectureDocument(),
      foundationEditorCatalog,
    );
    const unknown = flow.nodes.find((node) => node.id === "node_unknown");
    const unsupported = flow.nodes.find(
      (node) => node.id === "node_unsupported",
    );

    expect(unknown).toMatchObject({
      type: "fallback",
      draggable: true,
      data: {
        label: "Imported resource",
        serviceName: "Unknown resource",
        nodeKind: "fallback",
        fallbackReason: "unknown-service",
        support: {
          kind: "unknown",
          label: "Unknown resource",
        },
      },
    });
    expect(unknown?.data.ports).toEqual([
      expect.objectContaining({
        id: "example.port.mystery-output",
        groupId: "other",
        handleId: "dock:other:output",
        label: "Unverified port: example.port.mystery-output",
        direction: "output",
        capability: null,
        cardinality: null,
        hasExistingEdge: true,
        binding: "edge-reference",
      }),
    ]);
    expect(unknown?.data.connectionGroups).toEqual([
      expect.objectContaining({
        direction: "mixed",
        id: "other",
        portIds: ["example.port.mystery-output"],
        side: "bottom",
      }),
    ]);
    expect(unsupported).toMatchObject({
      type: "fallback",
      connectable: false,
      draggable: true,
      data: {
        serviceName: "Legacy resource",
        declaredNodeKind: "resource",
        nodeKind: "fallback",
        fallbackReason: "unsupported-service",
        support: {
          kind: "unsupported",
          label: "Unsupported",
        },
      },
    });
  });

  it("uses generic labeled edges without inferring relationship meaning from IDs", () => {
    const flow = mapArchitectureDocumentToFlow(
      loadFoundationArchitectureDocument(),
      foundationEditorCatalog,
    );
    const generic = flow.edges.find(
      (edge) => edge.id === "edge_unknown_application",
    );

    expect(generic).toMatchObject({
      label: "Relationship",
      sourceHandle: "dock:other:output",
      targetHandle: "dock:invokes-another-workload:input",
      data: {
        label: "Relationship",
        relationshipType: "example.relationship.unspecified",
        sourceConnectionGroupId: "other",
        sourceDockSide: "bottom",
        targetConnectionGroupId: "invokes-another-workload",
        targetDockSide: "left",
        isGenericFallback: true,
        relationship: {
          kind: "generic",
        },
      },
    });
  });

  it("requires exact provider and catalog identity before using catalog presentation", () => {
    const mismatchedProvider = parseArchitectureDocument({
      ...foundationArchitectureInput,
      provider: {
        ...foundationArchitectureInput.provider,
        id: "different.cloud",
      },
    });
    const flow = mapArchitectureDocumentToFlow(
      mismatchedProvider,
      foundationEditorCatalog,
    );

    expect(flow.catalogBinding).toMatchObject({
      kind: "mismatch",
      label: "Catalog unavailable",
    });
    expect(flow.nodes.every((node) => node.type === "fallback")).toBe(true);
    expect(
      flow.nodes.every(
        (node) => node.data.fallbackReason === "unknown-service",
      ),
    ).toBe(true);
    expect(
      flow.edges.every((edge) => edge.data?.isGenericFallback === true),
    ).toBe(true);
    expect(
      flow.edges.map((edge) => ({
        sourceDockSide: edge.data?.sourceDockSide,
        targetDockSide: edge.data?.targetDockSide,
      })),
    ).toEqual([
      { sourceDockSide: "bottom", targetDockSide: "bottom" },
      { sourceDockSide: "bottom", targetDockSide: "bottom" },
    ]);
  });

  it("does not advertise invalid semantic parents as visual boundary children", () => {
    const document = parseArchitectureDocument({
      ...foundationArchitectureInput,
      nodes: foundationArchitectureInput.nodes.map((node) =>
        node.id === "node_application"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                parent: {
                  nodeId: "node_network",
                  relationshipType: "example.relationship.contained-by",
                },
              },
            }
          : node,
      ),
    });
    const flow = mapArchitectureDocumentToFlow(
      document,
      foundationEditorCatalog,
    );
    const network = flow.nodes.find((node) => node.id === "node_network");
    const zone = flow.nodes.find((node) => node.id === "node_zone");
    const application = flow.nodes.find(
      (node) => node.id === "node_application",
    );

    expect(network?.data.childNodeIds).toEqual(["node_zone"]);
    expect(zone?.data.childNodeIds).toEqual([]);
    expect(application?.data.parentNodeId).toBe("node_network");
    expect(application === undefined ? true : "parentId" in application).toBe(
      false,
    );

    const invalidRelationshipDocument = parseArchitectureDocument({
      ...foundationArchitectureInput,
      nodes: foundationArchitectureInput.nodes.map((candidate) =>
        candidate.id === "node_application"
          ? {
              ...candidate,
              semantic: {
                ...candidate.semantic,
                parent: {
                  nodeId: "node_zone",
                  relationshipType: "example.relationship.invalid-contained-by",
                },
              },
            }
          : candidate,
      ),
    });
    const invalidRelationshipFlow = mapArchitectureDocumentToFlow(
      invalidRelationshipDocument,
      foundationEditorCatalog,
    );
    const invalidRelationshipApplication = invalidRelationshipFlow.nodes.find(
      (candidate) => candidate.id === "node_application",
    );
    const invalidRelationshipZone = invalidRelationshipFlow.nodes.find(
      (candidate) => candidate.id === "node_zone",
    );

    expect(invalidRelationshipZone?.data.childNodeIds).toEqual([]);
    expect(invalidRelationshipApplication?.data.parentNodeId).toBe("node_zone");
    expect(
      invalidRelationshipApplication === undefined
        ? true
        : "parentId" in invalidRelationshipApplication,
    ).toBe(false);
  });

  it("binds relationship presentation only to exact endpoint services and ports", () => {
    const flow = mapArchitectureDocumentToFlow(
      loadFoundationArchitectureDocument(),
      {
        ...foundationEditorCatalog,
        relationships: (foundationEditorCatalog.relationships ?? []).map(
          (relationship) => ({
            ...relationship,
            targetPortId: "example.port.different-target",
          }),
        ),
      },
    );
    const attachment = flow.edges.find(
      (edge) => edge.id === "edge_application_network",
    );

    expect(attachment).toMatchObject({
      label: "Relationship",
      data: {
        isGenericFallback: true,
        relationship: { kind: "generic" },
      },
    });

    const mismatchedResource = parseArchitectureDocument({
      ...foundationArchitectureInput,
      nodes: foundationArchitectureInput.nodes.map((node) =>
        node.id === "node_application"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                resourceType: "example.compute.different-resource",
              },
            }
          : node,
      ),
    });
    const resourceMismatchFlow = mapArchitectureDocumentToFlow(
      mismatchedResource,
      foundationEditorCatalog,
    );

    expect(
      resourceMismatchFlow.edges.find(
        (edge) => edge.id === "edge_application_network",
      ),
    ).toMatchObject({
      label: "Relationship",
      data: {
        isGenericFallback: true,
        relationship: { kind: "generic" },
      },
    });
  });

  it("keeps edge endpoints stable when grouped port rows are reordered or relabeled", () => {
    const document = loadFoundationArchitectureDocument();
    const baseline = mapArchitectureDocumentToFlow(
      document,
      foundationEditorCatalog,
    );
    const changedPresentationCatalog = {
      ...foundationEditorCatalog,
      services: foundationEditorCatalog.services.map((service) =>
        service.serviceType === "example.compute"
          ? {
              ...service,
              ports: [...service.ports].reverse().map((port) => ({
                ...port,
                displayName: `Renamed ${port.displayName}`,
              })),
            }
          : service,
      ),
    };
    const remapped = mapArchitectureDocumentToFlow(
      document,
      changedPresentationCatalog,
    );
    const endpoint = (flow: typeof baseline) =>
      flow.edges.find((edge) => edge.id === "edge_application_network");

    expect(endpoint(remapped)).toMatchObject({
      sourceHandle: endpoint(baseline)?.sourceHandle,
      targetHandle: endpoint(baseline)?.targetHandle,
      data: {
        sourcePortId: "example.port.network-client",
        targetPortId: "example.port.network-segment",
      },
    });
  });

  it("assigns deterministic rank and count metadata to edges sharing a dock", () => {
    const firstAttachment = foundationArchitectureInput.edges[0];
    const document = parseArchitectureDocument({
      ...foundationArchitectureInput,
      edges: [
        ...foundationArchitectureInput.edges,
        {
          ...firstAttachment,
          id: "edge_application_network_copy",
        },
      ],
    });
    const reversed = parseArchitectureDocument({
      ...document,
      edges: [...document.edges].reverse(),
    });
    const projection = (input: typeof document) =>
      mapArchitectureDocumentToFlow(input, foundationEditorCatalog)
        .edges.filter(
          (edge) =>
            edge.source === "node_application" &&
            edge.sourceHandle === "dock:network-and-security:output",
        )
        .map((edge) => ({
          id: edge.id,
          sourceDockCount: edge.data?.sourceDockCount,
          sourceDockRank: edge.data?.sourceDockRank,
          targetDockCount: edge.data?.targetDockCount,
          targetDockRank: edge.data?.targetDockRank,
        }));

    expect(projection(document)).toEqual([
      {
        id: "edge_application_network",
        sourceDockCount: 2,
        sourceDockRank: 0,
        targetDockCount: 2,
        targetDockRank: 0,
      },
      {
        id: "edge_application_network_copy",
        sourceDockCount: 2,
        sourceDockRank: 1,
        targetDockCount: 2,
        targetDockRank: 1,
      },
    ]);
    expect(projection(reversed)).toEqual(projection(document));
  });

  it("sorts view models without rewriting any domain identity", () => {
    const document = loadFoundationArchitectureDocument();
    const reordered = parseArchitectureDocument({
      ...document,
      nodes: [...document.nodes].reverse(),
      edges: [...document.edges].reverse(),
    });

    const baseline = mapArchitectureDocumentToFlow(
      document,
      foundationEditorCatalog,
    );
    const remapped = mapArchitectureDocumentToFlow(
      reordered,
      foundationEditorCatalog,
    );

    expect(remapped.nodes.map((node) => node.id)).toEqual(
      baseline.nodes.map((node) => node.id),
    );
    expect(remapped.edges.map((edge) => edge.id)).toEqual(
      baseline.edges.map((edge) => edge.id),
    );
    expect(
      remapped.nodes.flatMap((node) => node.data.ports.map((port) => port.id)),
    ).toEqual(
      baseline.nodes.flatMap((node) => node.data.ports.map((port) => port.id)),
    );
  });
});

describe("loadFoundationArchitectureDocument", () => {
  it("uses catalog-consistent nested boundaries and parent-relative positions", () => {
    const document = loadFoundationArchitectureDocument();
    const network = document.nodes.find((node) => node.id === "node_network");
    const zone = document.nodes.find((node) => node.id === "node_zone");
    const application = document.nodes.find(
      (node) => node.id === "node_application",
    );
    const networkService = foundationEditorCatalog.services.find(
      (service) => service.serviceType === "example.network",
    );
    const zoneService = foundationEditorCatalog.services.find(
      (service) => service.serviceType === "example.zone",
    );
    const applicationService = foundationEditorCatalog.services.find(
      (service) => service.serviceType === "example.compute",
    );

    expect(network?.semantic.parent).toBeUndefined();
    expect(networkService?.placement).toEqual({
      allowedParents: [],
      maximumDepth: 1,
      regionConstraint: "not-applicable",
      rootPlacement: "required",
    });
    expect(zone).toMatchObject({
      semantic: {
        parent: {
          nodeId: "node_network",
          relationshipType: "example.relationship.contained-by",
        },
      },
      presentation: { position: { x: 40, y: 160 } },
    });
    expect(zoneService?.placement).toEqual({
      allowedParents: [
        {
          relationshipType: "example.relationship.contained-by",
          serviceType: "example.network",
        },
      ],
      maximumDepth: 2,
      regionConstraint: "not-applicable",
      rootPlacement: "forbidden",
    });
    expect(application).toMatchObject({
      semantic: {
        parent: {
          nodeId: "node_zone",
          relationshipType: "example.relationship.contained-by",
        },
      },
      presentation: { position: { x: 40, y: 160 } },
    });
    expect(applicationService?.placement).toEqual({
      allowedParents: [
        {
          relationshipType: "example.relationship.contained-by",
          serviceType: "example.zone",
        },
      ],
      maximumDepth: 3,
      regionConstraint: "not-applicable",
      rootPlacement: "allowed",
    });
  });

  it("returns a fresh deterministic document for every load", () => {
    const first = loadFoundationArchitectureDocument();
    const firstApplication = first.nodes.find(
      (node) => node.id === "node_application",
    );
    if (firstApplication === undefined) {
      throw new Error("The foundation fixture must contain the application.");
    }
    firstApplication.presentation.position.x = 999;

    const second = loadFoundationArchitectureDocument();

    expect(
      second.nodes.find((node) => node.id === "node_application")?.presentation
        .position,
    ).toEqual({ x: 40, y: 160 });
  });
});
