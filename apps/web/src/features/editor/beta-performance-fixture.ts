import {
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";

import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";
import {
  loadAwsEditorArchitectureDocument,
  loadBlankAwsEditorArchitectureDocument,
} from "../../provider-catalog/aws-editor-fixture.js";

/** Synthetic, deterministic input shared by local performance and browser probes. */
export function connectedPerformanceDocument(
  nodeCount: number,
  edgeCount: number,
  highFanout = false,
): ArchitectureDocument {
  const seed = loadBlankAwsEditorArchitectureDocument();
  const source = loadAwsEditorArchitectureDocument();
  const lambda = source.nodes.find(
    (node) => node.semantic.serviceType === "aws.lambda.function",
  );
  const table = source.nodes.find(
    (node) => node.semantic.serviceType === "aws.dynamodb.table",
  );
  const relationship = awsEditorCatalog.relationships?.find(
    (entry) =>
      entry.sourceServiceType === "aws.lambda.function" &&
      entry.targetServiceType === "aws.dynamodb.table" &&
      entry.configuration.defaults.kind === "ready",
  );
  if (
    lambda === undefined ||
    table === undefined ||
    relationship?.configuration.defaults.kind !== "ready"
  ) {
    throw new Error(
      "The connected probe requires exact Lambda and DynamoDB definitions.",
    );
  }
  const sourceCount = highFanout ? 1 : Math.floor(nodeCount / 2);
  const targetCount = nodeCount - sourceCount;
  if (
    !Number.isInteger(nodeCount) ||
    !Number.isInteger(edgeCount) ||
    sourceCount < 1 ||
    targetCount < 1 ||
    edgeCount < 0 ||
    edgeCount > sourceCount * targetCount
  ) {
    throw new Error(
      "The connected probe requires unique supported endpoint pairs.",
    );
  }
  const nodes = Array.from({ length: nodeCount }, (_, index) => {
    const template = index < sourceCount ? lambda : table;
    const suffix = String(index + 1).padStart(4, "0");
    return {
      ...structuredClone(template),
      id: `node_connected_${suffix}`,
      presentation: {
        label: `Probe ${index < sourceCount ? "Lambda" : "table"} ${suffix}`,
        position: {
          x: 80 + (index % 20) * 224,
          y: 80 + Math.floor(index / 20) * 128,
        },
      },
      semantic: {
        ...structuredClone(template.semantic),
        deploymentKey: `connected_${suffix}`,
      },
    };
  });
  const defaults = relationship.configuration.defaults.values;
  return parseArchitectureDocument({
    ...structuredClone(seed),
    nodes,
    edges: Array.from({ length: edgeCount }, (_, index) => ({
      id: `edge_connected_${String(index + 1).padStart(4, "0")}`,
      semantic: {
        source: {
          nodeId: nodes[highFanout ? 0 : index % sourceCount]?.id,
          port: relationship.sourcePortId,
        },
        target: {
          nodeId:
            nodes[
              sourceCount +
                (highFanout
                  ? index
                  : (Math.floor(index / sourceCount) + (index % sourceCount)) %
                    targetCount)
            ]?.id,
          port: relationship.targetPortId,
        },
        relationshipType: relationship.id,
        configuration: {
          schemaId: relationship.configuration.schemaId,
          schemaVersion: relationship.configuration.schemaVersion,
          values: structuredClone(defaults),
        },
        lifecycle: { ownership: "user", origin: "template" },
      },
    })),
  });
}
