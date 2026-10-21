import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsNetworkingVisualArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import {
  EditorNodePlacementError,
  prepareEditorNodePlacement,
} from "./node-placement-command.js";

function sequentialIds(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}_${String(++sequence).padStart(4, "0")}`;
}

function expectPlacementError(
  callback: () => unknown,
): EditorNodePlacementError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(EditorNodePlacementError);
    if (error instanceof EditorNodePlacementError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected networking placement to fail closed.");
}

describe("AWS networking placement commands", () => {
  it("rejects VPC, subnet, and root drop targets before mutation so a subnet still belongs to exactly one AZ", () => {
    for (const targetParentNodeId of [
      "node_network_vpc",
      "node_private_subnet_b",
      null,
    ] as const) {
      const document = loadAwsNetworkingVisualArchitectureDocument();
      const snapshot = structuredClone(document);
      const error = expectPlacementError(() =>
        prepareEditorNodePlacement({
          catalog: awsEditorCatalog,
          createId: sequentialIds("operation_invalid_subnet_drop"),
          document,
          nodeId: "node_public_subnet_a",
          targetParentNodeId,
        }),
      );

      expect(error.code).toBe("placement-invalid");
      expect(document).toEqual(snapshot);
      expect(
        document.nodes.find((node) => node.id === "node_public_subnet_a")
          ?.semantic.parent,
      ).toEqual({
        nodeId: "node_availability_zone_a",
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      });
    }
  });

  it("keeps security groups and managed services root-associated rather than accepting false containment", () => {
    for (const nodeId of [
      "node_application_security_group",
      "node_application_table",
      "node_networked_lambda",
    ] as const) {
      const document = loadAwsNetworkingVisualArchitectureDocument();
      const error = expectPlacementError(() =>
        prepareEditorNodePlacement({
          catalog: awsEditorCatalog,
          createId: sequentialIds("operation_invalid_managed_drop"),
          document,
          nodeId,
          targetParentNodeId: "node_network_vpc",
        }),
      );
      expect(error.code).toBe("placement-invalid");
      expect(
        document.nodes.find((node) => node.id === nodeId)?.semantic.parent,
      ).toBeUndefined();
    }
  });
});
