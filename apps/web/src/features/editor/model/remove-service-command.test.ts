import {
  applyGraphCommand,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { awsConnectionResolverV1 } from "@cloudmarkup/provider-aws";
import { describe, expect, it } from "vitest";

import { loadAwsNetworkingVisualArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { loadFoundationArchitectureDocument } from "./foundation-editor-fixture.js";
import {
  prepareServiceRemoval,
  ServiceRemovalError,
} from "./remove-service-command.js";

function ids() {
  let index = 0;
  return () => `operation_remove_service_${String(++index).padStart(4, "0")}`;
}

describe("service removal command", () => {
  it("removes a user service and its relationship atomically with Undo", () => {
    const document = loadFoundationArchitectureDocument();
    const preview = prepareServiceRemoval({
      connectionResolver: awsConnectionResolverV1,
      createId: ids(),
      document,
      nodeId: "node_unknown",
    });
    expect(preview.connectionCount).toBe(1);
    expect(preview.command.kind).toBe("batch");
    const result = applyGraphCommand(document, preview.command);
    expect(
      result.document.nodes.some((node) => node.id === "node_unknown"),
    ).toBe(false);
    expect(
      result.document.edges.some(
        (edge) => edge.id === "edge_unknown_application",
      ),
    ).toBe(false);
    expect(
      result.document.nodes.find((node) => node.id === "node_application"),
    ).toEqual(document.nodes.find((node) => node.id === "node_application"));
    expect(result.inversion.kind).toBe("available");
    if (result.inversion.kind === "available")
      expect(
        applyGraphCommand(result.document, result.inversion.command)
          .document.nodes.map((node) => node.id)
          .sort(),
      ).toEqual(document.nodes.map((node) => node.id).sort());
  });

  it("rejects a boundary with child services before preparing a command", () => {
    expect(() =>
      prepareServiceRemoval({
        createId: ids(),
        document: loadFoundationArchitectureDocument(),
        nodeId: "node_network",
      }),
    ).toThrow("Move or remove services inside this boundary");
  });

  it("fails closed when an output still references the service", () => {
    const base = loadFoundationArchitectureDocument();
    const document = parseArchitectureDocument({
      ...base,
      outputs: [
        {
          id: "output_unknown",
          key: "unknown",
          valueType: "string",
          sensitive: false,
          source: {
            kind: "node-attribute",
            nodeId: "node_unknown",
            attribute: "example.resource-id",
          },
        },
      ],
    });
    expect(() =>
      prepareServiceRemoval({
        createId: ids(),
        document,
        nodeId: "node_unknown",
      }),
    ).toThrow(ServiceRemovalError);
    expect(document.nodes.some((node) => node.id === "node_unknown")).toBe(
      true,
    );
  });

  it("uses the version-bound resolver to remove generated connections", () => {
    const document = loadAwsNetworkingVisualArchitectureDocument();
    const preview = prepareServiceRemoval({
      connectionResolver: awsConnectionResolverV1,
      createId: ids(),
      document,
      nodeId: "node_public_route_association_b",
    });
    expect(preview.releasedResourceCount).toBeGreaterThan(0);
    const result = applyGraphCommand(document, preview.command);
    expect(
      result.document.nodes.some((node) => node.id === preview.nodeId),
    ).toBe(false);
    expect(result.inversion.kind).toBe("available");
  });
});
