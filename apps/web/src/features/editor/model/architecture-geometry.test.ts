import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import {
  BOUNDARY_CONTENT_BOTTOM,
  BOUNDARY_CONTENT_LEFT,
  BOUNDARY_CONTENT_RIGHT,
  BOUNDARY_CONTENT_TOP,
  BOUNDARY_MAXIMUM_HEIGHT,
  BOUNDARY_MAXIMUM_WIDTH,
  BOUNDARY_MINIMUM_HEIGHT,
  BOUNDARY_MINIMUM_WIDTH,
  EDITOR_GRID_SIZE,
  EditorGeometryError,
  RESOURCE_NODE_WIDTH,
  absoluteEditorNodePosition,
  checkedEditorPoint,
  deepestBoundaryAtPosition,
  deriveArchitectureGeometry,
  relativeEditorPosition,
  validateAbsoluteEditorPositions,
} from "./architecture-geometry.js";
import type { EditorCatalog, EditorCatalogService } from "./editor-catalog.js";
import {
  foundationArchitectureInput,
  foundationEditorCatalog,
  loadFoundationArchitectureDocument,
} from "./foundation-editor-fixture.js";

function documentWithNodePosition(
  nodeId: string,
  position: { readonly x: number; readonly y: number },
) {
  return parseArchitectureDocument({
    ...foundationArchitectureInput,
    nodes: foundationArchitectureInput.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            presentation: {
              ...node.presentation,
              position,
            },
          }
        : node,
    ),
  });
}

function expectGeometryError(callback: () => unknown): EditorGeometryError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(EditorGeometryError);
    if (error instanceof EditorGeometryError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected editor geometry validation to fail.");
}

describe("architecture boundary geometry", () => {
  it("round-trips parent-relative coordinates through nested boundaries", () => {
    const document = loadFoundationArchitectureDocument();
    const zone = document.nodes.find((node) => node.id === "node_zone");
    if (zone === undefined) {
      throw new Error("The fixture zone is required.");
    }

    expect(
      absoluteEditorNodePosition(document, foundationEditorCatalog, zone.id),
    ).toEqual({ x: 120, y: 200 });
    const application = document.nodes.find(
      (node) => node.id === "node_application",
    );
    if (application === undefined) {
      throw new Error("The fixture application is required.");
    }
    const absolute = absoluteEditorNodePosition(
      document,
      foundationEditorCatalog,
      application.id,
    );

    expect(absolute).toEqual({ x: 160, y: 360 });
    expect(
      relativeEditorPosition(
        document,
        foundationEditorCatalog,
        absolute,
        application.semantic.parent?.nodeId ?? null,
      ),
    ).toEqual(application.presentation.position);
  });

  it("moves nested descendants visually without rewriting their local records", () => {
    const before = loadFoundationArchitectureDocument();
    const after = documentWithNodePosition("node_network", {
      x: 208,
      y: 152,
    });
    const expectedDelta = { x: 128, y: 112 };

    for (const nodeId of ["node_zone", "node_application"] as const) {
      const beforeNode = before.nodes.find((node) => node.id === nodeId);
      const afterNode = after.nodes.find((node) => node.id === nodeId);
      if (beforeNode === undefined || afterNode === undefined) {
        throw new Error(`The nested fixture node ${nodeId} is required.`);
      }
      const beforeAbsolute = absoluteEditorNodePosition(
        before,
        foundationEditorCatalog,
        beforeNode.id,
      );
      const afterAbsolute = absoluteEditorNodePosition(
        after,
        foundationEditorCatalog,
        afterNode.id,
      );

      expect(afterAbsolute).toEqual({
        x: beforeAbsolute.x + expectedDelta.x,
        y: beforeAbsolute.y + expectedDelta.y,
      });
      expect(afterNode.presentation.position).toEqual(
        beforeNode.presentation.position,
      );
      expect(afterNode.semantic).toEqual(beforeNode.semantic);
    }
  });

  it("expands nested boundaries deterministically within bounded dimensions", () => {
    const baseline = loadFoundationArchitectureDocument();
    const expanded = documentWithNodePosition("node_application", {
      x: 400,
      y: 200,
    });
    const baselineGeometry = deriveArchitectureGeometry(
      baseline,
      foundationEditorCatalog,
    );
    const first = deriveArchitectureGeometry(expanded, foundationEditorCatalog);
    const second = deriveArchitectureGeometry(
      expanded,
      foundationEditorCatalog,
    );
    const baselineZoneId = baseline.nodes.find(
      (node) => node.id === "node_zone",
    )?.id;
    const expandedZoneId = expanded.nodes.find(
      (node) => node.id === "node_zone",
    )?.id;
    if (baselineZoneId === undefined || expandedZoneId === undefined) {
      throw new Error("The nested boundary fixture is required.");
    }
    const baselineZone = baselineGeometry.sizes.get(baselineZoneId);
    const expandedZone = first.sizes.get(expandedZoneId);

    expect(first).toEqual(second);
    expect(first.overflows).toEqual([]);
    expect(expandedZone?.width).toBeGreaterThan(
      baselineZone?.width ?? BOUNDARY_MINIMUM_WIDTH,
    );
    expect(expandedZone?.height).toBeGreaterThan(
      baselineZone?.height ?? BOUNDARY_MINIMUM_HEIGHT,
    );
    expect(expandedZone?.width).toBeLessThanOrEqual(BOUNDARY_MAXIMUM_WIDTH);
    expect(expandedZone?.height).toBeLessThanOrEqual(BOUNDARY_MAXIMUM_HEIGHT);
  });

  it("rejects boundary overflow instead of corrupting coordinates", () => {
    const document = documentWithNodePosition("node_application", {
      x: BOUNDARY_MAXIMUM_WIDTH,
      y: BOUNDARY_MAXIMUM_HEIGHT,
    });
    const geometry = deriveArchitectureGeometry(
      document,
      foundationEditorCatalog,
    );

    expect(
      geometry.overflows.some(
        (overflow) =>
          overflow.boundaryNodeId === "node_zone" &&
          overflow.message.includes("cannot expand beyond"),
      ),
    ).toBe(true);
  });

  it("fails closed for non-finite and out-of-range coordinates", () => {
    const nonFiniteError = expectGeometryError(() =>
      checkedEditorPoint({ x: Number.NaN, y: 0 }),
    );
    const outOfRangeError = expectGeometryError(() =>
      checkedEditorPoint({ x: 1_000_001, y: 0 }),
    );

    expect(nonFiniteError.code).toBe("non-finite-coordinate");
    expect(outOfRangeError.code).toBe("coordinate-out-of-range");
  });

  it("rejects accumulated absolute coordinates outside the supported range", () => {
    const document = documentWithNodePosition("node_network", {
      x: 999_952,
      y: 40,
    });

    const error = expectGeometryError(() => {
      deriveArchitectureGeometry(document, foundationEditorCatalog);
    });

    expect(error.code).toBe("coordinate-out-of-range");
  });

  it("rejects an accumulated drag preview before it enters projection state", () => {
    const document = loadFoundationArchitectureDocument();
    const previews = new Map([["node_network", { x: 999_952, y: 40 }]]);

    const error = expectGeometryError(() => {
      validateAbsoluteEditorPositions(
        document,
        foundationEditorCatalog,
        previews,
      );
    });

    expect(error.code).toBe("coordinate-out-of-range");
    expect(document.nodes[0]?.presentation.position).toEqual({ x: 80, y: 40 });
  });
});

const nestedBoundaryTypes = {
  region: "example.boundary.region",
  vpc: "example.boundary.network",
  zone: "example.boundary.zone",
  subnet: "example.boundary.subnet",
} as const;

function createNestedBoundaryService(
  template: EditorCatalogService,
  input: {
    readonly displayName: string;
    readonly maximumDepth: number;
    readonly parentServiceType?: string;
    readonly serviceType: string;
  },
): EditorCatalogService {
  const resourceType = `${input.serviceType}.resource`;
  const rootPlacement =
    input.parentServiceType === undefined ? "required" : "forbidden";
  return {
    ...template,
    advancedSearchTerms: [input.serviceType, resourceType],
    category:
      rootPlacement === "required"
        ? {
            guidedLabel: "Add directly",
            id: "root-placeable",
            professionalLabel: "Root-placeable",
          }
        : {
            guidedLabel: "Add inside a boundary",
            id: "parent-required",
            professionalLabel: "Parent required",
          },
    configuration: {
      ...template.configuration,
      schemaId: `${resourceType}-config`,
    },
    description: `${input.displayName} synthetic boundary.`,
    displayName: input.displayName,
    placement: {
      allowedParents:
        input.parentServiceType === undefined
          ? []
          : [
              {
                relationshipType: "example.relationship.contained-by",
                serviceType: input.parentServiceType,
              },
            ],
      maximumDepth: input.maximumDepth,
      regionConstraint: "not-applicable",
      rootPlacement,
    },
    resourceType,
    searchText:
      `${input.displayName} ${input.serviceType} ${resourceType}`.toLocaleLowerCase(
        "en-US",
      ),
    serviceType: input.serviceType,
  };
}

function createNestedBoundaryCatalog(): EditorCatalog {
  const template = foundationEditorCatalog.services.find(
    (service) => service.serviceType === "example.network",
  );
  if (template === undefined) {
    throw new Error("The synthetic boundary service is required.");
  }

  return {
    ...foundationEditorCatalog,
    services: [
      createNestedBoundaryService(template, {
        displayName: "Region",
        maximumDepth: 1,
        serviceType: nestedBoundaryTypes.region,
      }),
      createNestedBoundaryService(template, {
        displayName: "Network",
        maximumDepth: 2,
        parentServiceType: nestedBoundaryTypes.region,
        serviceType: nestedBoundaryTypes.vpc,
      }),
      createNestedBoundaryService(template, {
        displayName: "Zone",
        maximumDepth: 3,
        parentServiceType: nestedBoundaryTypes.vpc,
        serviceType: nestedBoundaryTypes.zone,
      }),
      createNestedBoundaryService(template, {
        displayName: "Subnet",
        maximumDepth: 4,
        parentServiceType: nestedBoundaryTypes.zone,
        serviceType: nestedBoundaryTypes.subnet,
      }),
    ],
  };
}

function createNestedBoundaryDocument(
  positionOverrides: Readonly<
    Record<string, { readonly x: number; readonly y: number }>
  > = {},
) {
  const node = (
    id: string,
    label: string,
    serviceType: string,
    position: { readonly x: number; readonly y: number },
    parentNodeId?: string,
  ) => {
    const resourceType = `${serviceType}.resource`;
    return {
      id,
      semantic: {
        configuration: {
          schemaId: `${resourceType}-config`,
          schemaVersion: "1.0.0",
          values: {},
        },
        deploymentKey: id.replace(/^node_/, ""),
        lifecycle: {
          origin: "template",
          ownership: "user",
        },
        ...(parentNodeId === undefined
          ? {}
          : {
              parent: {
                nodeId: parentNodeId,
                relationshipType: "example.relationship.contained-by",
              },
            }),
        resourceType,
        serviceType,
      },
      presentation: {
        label,
        position: positionOverrides[id] ?? position,
      },
    };
  };

  return parseArchitectureDocument({
    ...foundationArchitectureInput,
    edges: [],
    nodes: [
      node("node_region", "Region", nestedBoundaryTypes.region, {
        x: 80,
        y: 40,
      }),
      node(
        "node_vpc",
        "Network",
        nestedBoundaryTypes.vpc,
        { x: 32, y: 160 },
        "node_region",
      ),
      node(
        "node_zone_a",
        "Zone A",
        nestedBoundaryTypes.zone,
        { x: 32, y: 160 },
        "node_vpc",
      ),
      node(
        "node_subnet_a_public",
        "Subnet A public",
        nestedBoundaryTypes.subnet,
        { x: 32, y: 160 },
        "node_zone_a",
      ),
      node(
        "node_subnet_a_private",
        "Subnet A private",
        nestedBoundaryTypes.subnet,
        { x: 416, y: 160 },
        "node_zone_a",
      ),
      node(
        "node_zone_b",
        "Zone B",
        nestedBoundaryTypes.zone,
        { x: 864, y: 160 },
        "node_vpc",
      ),
      node(
        "node_subnet_b_public",
        "Subnet B public",
        nestedBoundaryTypes.subnet,
        { x: 32, y: 160 },
        "node_zone_b",
      ),
      node(
        "node_subnet_b_private",
        "Subnet B private",
        nestedBoundaryTypes.subnet,
        { x: 416, y: 160 },
        "node_zone_b",
      ),
    ],
  });
}

function nestedBoundarySize(
  geometry: ReturnType<typeof deriveArchitectureGeometry>,
  nodeId: string,
) {
  return [...geometry.sizes].find(
    ([candidateId]) => candidateId === nodeId,
  )?.[1];
}

describe("compact nested boundary geometry", () => {
  it("fits a four-level multi-branch hierarchy without overflow", () => {
    const catalog = createNestedBoundaryCatalog();
    const document = createNestedBoundaryDocument();
    const first = deriveArchitectureGeometry(document, catalog);
    const second = deriveArchitectureGeometry(document, catalog);

    expect(first).toEqual(second);
    expect(first.overflows).toEqual([]);
    expect(nestedBoundarySize(first, "node_subnet_a_public")).toEqual({
      height: BOUNDARY_MINIMUM_HEIGHT,
      width: BOUNDARY_MINIMUM_WIDTH,
    });
    expect(nestedBoundarySize(first, "node_zone_a")).toEqual({
      height: 448,
      width: 800,
    });
    expect(nestedBoundarySize(first, "node_vpc")).toEqual({
      height: 640,
      width: 1_696,
    });
    expect(nestedBoundarySize(first, "node_region")).toEqual({
      height: 832,
      width: 1_760,
    });
  });

  it("resizes every affected ancestor when a nested branch grows", () => {
    const catalog = createNestedBoundaryCatalog();
    const baseline = deriveArchitectureGeometry(
      createNestedBoundaryDocument(),
      catalog,
    );
    const expanded = deriveArchitectureGeometry(
      createNestedBoundaryDocument({
        node_subnet_b_private: { x: 720, y: 512 },
      }),
      catalog,
    );

    expect(expanded.overflows).toEqual([]);
    expect(nestedBoundarySize(expanded, "node_zone_a")).toEqual(
      nestedBoundarySize(baseline, "node_zone_a"),
    );
    for (const nodeId of ["node_zone_b", "node_vpc", "node_region"] as const) {
      const before = nestedBoundarySize(baseline, nodeId);
      const after = nestedBoundarySize(expanded, nodeId);
      expect(after?.width).toBeGreaterThan(before?.width ?? 0);
      expect(after?.height).toBeGreaterThan(before?.height ?? 0);
    }
  });

  it("keeps an empty boundary compact while reserving readable content space", () => {
    const catalog = createNestedBoundaryCatalog();
    const geometry = deriveArchitectureGeometry(
      createNestedBoundaryDocument(),
      catalog,
    );
    const leafSize = nestedBoundarySize(geometry, "node_subnet_a_public");

    expect(BOUNDARY_MINIMUM_WIDTH % EDITOR_GRID_SIZE).toBe(0);
    expect(BOUNDARY_MINIMUM_HEIGHT % EDITOR_GRID_SIZE).toBe(0);
    expect(BOUNDARY_MINIMUM_WIDTH).toBeGreaterThanOrEqual(
      BOUNDARY_CONTENT_LEFT + RESOURCE_NODE_WIDTH + BOUNDARY_CONTENT_RIGHT,
    );
    expect(BOUNDARY_MINIMUM_HEIGHT).toBeGreaterThanOrEqual(
      BOUNDARY_CONTENT_TOP + BOUNDARY_CONTENT_BOTTOM + 64,
    );
    expect(leafSize).toEqual({
      height: BOUNDARY_MINIMUM_HEIGHT,
      width: BOUNDARY_MINIMUM_WIDTH,
    });
  });

  it("reports a bounded maximum violation in a deeply nested branch", () => {
    const catalog = createNestedBoundaryCatalog();
    const geometry = deriveArchitectureGeometry(
      createNestedBoundaryDocument({
        node_subnet_b_private: {
          x: BOUNDARY_MAXIMUM_WIDTH,
          y: BOUNDARY_MAXIMUM_HEIGHT,
        },
      }),
      catalog,
    );

    expect(
      geometry.overflows.some(
        (overflow) =>
          overflow.boundaryNodeId === "node_zone_b" &&
          overflow.message.includes("cannot expand beyond 4096 by 3072"),
      ),
    ).toBe(true);
    expect(nestedBoundarySize(geometry, "node_zone_b")).toEqual({
      height: BOUNDARY_MAXIMUM_HEIGHT,
      width: BOUNDARY_MAXIMUM_WIDTH,
    });
  });

  it("fails closed when an anchor intersects overlapping sibling boundaries at the same deepest depth", () => {
    const catalog = createNestedBoundaryCatalog();
    const document = createNestedBoundaryDocument({
      node_zone_b: { x: 32, y: 160 },
    });
    const draggedNode = document.nodes.find(
      (candidate) => candidate.id === "node_subnet_a_public",
    );
    if (draggedNode === undefined) {
      throw new Error("The dragged subnet fixture is required.");
    }

    const error = expectGeometryError(() =>
      deepestBoundaryAtPosition(document, catalog, draggedNode.id, {
        x: 144,
        y: 272,
      }),
    );

    expect(error.code).toBe("ambiguous-boundary-target");
    expect(error.message).toBe(
      "This position overlaps multiple equally specific boundaries: Zone A and Zone B. Choose a boundary from the Architecture list.",
    );
  });

  it("selects the unique deepest target in an unambiguous nested hierarchy", () => {
    const catalog = createNestedBoundaryCatalog();
    const document = createNestedBoundaryDocument();
    const draggedNode = document.nodes.find(
      (candidate) => candidate.id === "node_subnet_b_private",
    );
    if (draggedNode === undefined) {
      throw new Error("The dragged subnet fixture is required.");
    }

    expect(
      deepestBoundaryAtPosition(document, catalog, draggedNode.id, {
        x: 176,
        y: 520,
      }),
    ).toBe("node_subnet_a_public");
  });
});
