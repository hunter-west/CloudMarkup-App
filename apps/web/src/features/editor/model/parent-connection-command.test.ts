import {
  prepareResourceRepair,
  applyPreparedResourceRepair,
} from "./resource-repair-command.js";
import {
  applyGraphCommand,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { dispatchAddServiceCommand } from "./add-service-command.js";
import {
  dispatchEditorNodeMove,
  dispatchEditorNodePlacement,
} from "./node-placement-command.js";

function setup() {
  let sequence = 0;
  const base = loadAwsEditorArchitectureDocument();
  return {
    catalog: awsEditorCatalog,
    createId: () => `operation_parent_${String(++sequence).padStart(5, "0")}`,
    document: parseArchitectureDocument({
      ...base,
      nodes: [],
      edges: [],
      workloadBehavior: { ...base.workloadBehavior, workloads: [] },
    }),
  };
}
function network() {
  const input = setup();
  const region = dispatchAddServiceCommand({
    ...input,
    serviceId: "aws.region.boundary",
  });
  const vpc = dispatchAddServiceCommand({
    ...input,
    document: region.document,
    serviceId: "aws.ec2.vpc",
  });
  const first = dispatchAddServiceCommand({
    ...input,
    document: vpc.document,
    serviceId: "aws.ec2.availability-zone",
    parentNodeId: vpc.nodeId,
    configurationValues: {
      zoneName: { kind: "string", value: input.document.provider.region + "a" },
    },
  });
  const second = dispatchAddServiceCommand({
    ...input,
    document: first.document,
    serviceId: "aws.ec2.availability-zone",
    parentNodeId: vpc.nodeId,
    configurationValues: {
      zoneName: { kind: "string", value: input.document.provider.region + "b" },
    },
  });
  const subnet = dispatchAddServiceCommand({
    ...input,
    document: second.document,
    serviceId: "aws.ec2.subnet",
    parentNodeId: first.nodeId,
  });
  return { input, region, vpc, first, second, subnet };
}
describe("catalog parent and workload creation", () => {
  it("creates each typed parent edge and undoes the complete addition atomically", () => {
    const { input, second, subnet } = network();
    for (const node of subnet.document.nodes.filter(
      ({ semantic }) => semantic.parent !== undefined,
    )) {
      const matching = subnet.document.edges.filter(
        ({ semantic }) =>
          semantic.relationshipType ===
            node.semantic.parent?.relationshipType &&
          ((semantic.source.nodeId === node.id &&
            semantic.target.nodeId === node.semantic.parent.nodeId) ||
            (semantic.target.nodeId === node.id &&
              semantic.source.nodeId === node.semantic.parent.nodeId)),
      );
      expect(matching).toHaveLength(1);
    }
    expect(subnet.inversion.kind).toBe("available");
    if (subnet.inversion.kind !== "available")
      throw Error("Expected atomic inverse");
    expect(
      applyGraphCommand(subnet.document, subnet.inversion.command).document,
    ).toEqual(second.document);
    expect(input.document.nodes).toHaveLength(0);
  });
  it("creates an infrastructure-only Lambda workload without inventing application behavior", () => {
    const input = setup();
    const added = dispatchAddServiceCommand({
      ...input,
      serviceId: "aws.lambda.function",
    });
    expect(added.document.workloadBehavior.workloads).toMatchObject([
      {
        owningNodeId: added.nodeId,
        implementation: { mode: "infrastructure-only" },
        operations: [],
        triggers: [],
        sourceOwnership: [],
      },
    ]);
    expect(added.inversion.kind).toBe("available");
    if (added.inversion.kind !== "available")
      throw Error("Expected atomic inverse");
    expect(
      applyGraphCommand(added.document, added.inversion.command).document,
    ).toEqual(input.document);
  });
  it("updates the exact parent edge on explicit reparent and preserves it during visual moves", () => {
    const { input, second, subnet } = network();
    const moved = dispatchEditorNodeMove({
      ...input,
      document: subnet.document,
      nodeId: subnet.nodeId,
      position: { x: 64, y: 208 },
    });
    expect(moved.document.edges).toEqual(subnet.document.edges);
    const placed = dispatchEditorNodePlacement({
      ...input,
      document: subnet.document,
      nodeId: subnet.nodeId,
      targetParentNodeId: second.nodeId,
      position: { x: 64, y: 208 },
      positionSpace: "stored",
    });
    const parentEdge = placed.document.edges.find(
      ({ id }) => id === "edge_parent_" + subnet.nodeId,
    );
    expect(parentEdge?.semantic.source.nodeId).toBe(second.nodeId);
    expect(placed.inversion.kind).toBe("available");
    if (placed.inversion.kind !== "available")
      throw Error("Expected atomic inverse");
    expect(
      applyGraphCommand(placed.document, placed.inversion.command).document,
    ).toEqual(subnet.document);
  });
  it("requires explicit lifecycle review before changing a generated parent edge", () => {
    const { input, second, subnet } = network();
    const document = parseArchitectureDocument({
      ...subnet.document,
      edges: subnet.document.edges.map((edge) =>
        edge.id === "edge_parent_" + subnet.nodeId
          ? {
              ...edge,
              semantic: {
                ...edge.semantic,
                lifecycle: {
                  ownership: "generated",
                  origin: "connection-rule",
                  provenance: {
                    generatorKind: "connection-rule",
                    generatorId: "aws.ec2.synthetic-parent",
                    generatorVersion: "1.0.0",
                    operationId: input.createId(),
                    dependentNodeIds: [subnet.nodeId],
                    dependentEdgeIds: [],
                  },
                },
              },
            }
          : edge,
      ),
    });
    const before = structuredClone(document);
    expect(() =>
      dispatchEditorNodePlacement({
        ...input,
        document,
        nodeId: subnet.nodeId,
        targetParentNodeId: second.nodeId,
        position: { x: 64, y: 208 },
        positionSpace: "stored",
      }),
    ).toThrow("generated or adopted parent connection");
    expect(document).toEqual(before);
  });
  it("fails closed on ambiguous parent edges and leaves the original graph unchanged", () => {
    const { input, second, subnet } = network();
    const edge = subnet.document.edges.find(
      ({ id }) => id === "edge_parent_" + subnet.nodeId,
    );
    if (edge === undefined) throw Error("Expected parent edge");
    const corrupt = parseArchitectureDocument({
      ...subnet.document,
      edges: [
        ...subnet.document.edges,
        { ...edge, id: "edge_duplicate_parent" },
      ],
    });
    const before = structuredClone(corrupt);
    expect(() =>
      dispatchEditorNodePlacement({
        ...input,
        document: corrupt,
        nodeId: subnet.nodeId,
        targetParentNodeId: second.nodeId,
        position: { x: 64, y: 208 },
        positionSpace: "stored",
      }),
    ).toThrow("conflicting parent");
    expect(corrupt).toEqual(before);
  });
});

describe("reviewed existing-resource repair", () => {
  it("repairs only the missing parent edge, rejects stale review, and preserves undo", () => {
    const { input, subnet } = network();
    const document = parseArchitectureDocument({
      ...subnet.document,
      edges: subnet.document.edges.filter(
        ({ id }) => id !== "edge_parent_" + subnet.nodeId,
      ),
    });
    const prepared = prepareResourceRepair({
      ...input,
      document,
      nodeId: subnet.nodeId,
      kind: "parent-connection",
    });
    expect(prepared).not.toBeNull();
    if (prepared === null) throw Error("expected repair");
    const applied = applyPreparedResourceRepair(document, prepared);
    expect(applied.document).toEqual(subnet.document);
    expect(applied.document.nodes).toEqual(document.nodes);
    expect(() =>
      applyPreparedResourceRepair(subnet.document, prepared),
    ).toThrow("design changed");
    if (applied.inversion.kind !== "available") throw Error("expected undo");
    expect(
      applyGraphCommand(applied.document, applied.inversion.command).document,
    ).toEqual(document);
    expect(
      prepareResourceRepair({
        ...input,
        document: applied.document,
        nodeId: subnet.nodeId,
        kind: "parent-connection",
      }),
    ).toBeNull();
  });
  it("preserves declared application intent and requires the exact catalog", () => {
    const input = setup();
    const added = dispatchAddServiceCommand({
      ...input,
      serviceId: "aws.lambda.function",
    });
    expect(() =>
      prepareResourceRepair({
        ...input,
        document: added.document,
        nodeId: added.nodeId,
        kind: "infrastructure-workload",
      }),
    ).toThrow("already has implementation intent");
    expect(() =>
      prepareResourceRepair({
        ...input,
        catalog: {
          ...input.catalog,
          identity: { ...input.catalog.identity, version: "999.0.0" },
        },
        document: added.document,
        nodeId: added.nodeId,
        kind: "infrastructure-workload",
      }),
    ).toThrow("exact catalog");
  });
});
