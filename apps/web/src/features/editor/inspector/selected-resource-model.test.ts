import {
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { resolveSelectedResourceInspectorModel } from "./selected-resource-model.js";

function lambdaNode(document: ArchitectureDocument) {
  const node = document.nodes.find(
    (candidate) => candidate.semantic.serviceType === "aws.lambda.function",
  );
  if (node === undefined) {
    throw new TypeError("Expected the deterministic Lambda fixture node.");
  }
  return node;
}

function withLambdaTableRelationship(
  document: ArchitectureDocument,
): ArchitectureDocument {
  const lambda = lambdaNode(document);
  const table = document.nodes.find(
    (node) => node.semantic.serviceType === "aws.dynamodb.table",
  );
  const relationship = awsEditorCatalog.relationships?.find(
    (candidate) => candidate.id === "aws.lambda.reads-dynamodb-table",
  );
  if (table === undefined || relationship === undefined) {
    throw new TypeError("Expected the Lambda-to-DynamoDB catalog fixture.");
  }

  return parseArchitectureDocument({
    ...document,
    edges: [
      {
        id: "edge_lambda_table_access",
        semantic: {
          configuration: {
            schemaId: relationship.configuration.schemaId,
            schemaVersion: relationship.configuration.schemaVersion,
            values: {
              consistentRead: { kind: "boolean", value: false },
            },
          },
          lifecycle: {
            origin: "user",
            ownership: "user",
          },
          relationshipType: relationship.id,
          source: {
            nodeId: lambda.id,
            port: relationship.sourcePortId,
          },
          target: {
            nodeId: table.id,
            port: relationship.targetPortId,
          },
        },
      },
    ],
  });
}

describe("selected-resource inspector model safe fallbacks", () => {
  it("projects the exact source-free v2 workload owned by a selected node", () => {
    const document = loadAwsEditorArchitectureDocument();
    const lambda = lambdaNode(document);

    const resolution = resolveSelectedResourceInspectorModel(
      document,
      awsEditorCatalog,
      { id: lambda.id, kind: "node" },
    );

    expect(resolution.kind).toBe("ready");
    if (resolution.kind !== "ready" || resolution.model.kind !== "node") {
      throw new TypeError("Expected a ready Lambda node Inspector model.");
    }
    expect(resolution.model.workloadContractVersion).toBe(2);
    expect(resolution.model.workload).toMatchObject({
      id: "workload_notes_api_handler",
      owningNodeId: lambda.id,
      implementation: {
        handler: "index.handler",
        mode: "user-provided",
        runtimeFamily: "aws.lambda.runtime-family.nodejs24",
        sourceOwnership: "user",
      },
      triggerDispatch: { mode: "single" },
    });
    expect(JSON.stringify(resolution.model.workload)).not.toContain(
      "sourceCode",
    );
  });

  it("reports a selected resource that is no longer in the document", () => {
    const document = loadAwsEditorArchitectureDocument();
    const before = structuredClone(document);

    const resolution = resolveSelectedResourceInspectorModel(
      document,
      awsEditorCatalog,
      {
        id: "node_removed",
        kind: "node",
      },
    );

    expect(resolution).toEqual({
      kind: "unavailable",
      reason:
        "The selected resource is no longer present in this Architecture Document.",
      title: "Resource unavailable",
    });
    expect(document).toEqual(before);
  });

  it("keeps an unknown imported resource visible but unavailable", () => {
    const document = loadAwsEditorArchitectureDocument();
    const unknownNode = document.nodes.find(
      (node) => node.id === "node_imported_unknown",
    );
    if (unknownNode === undefined) {
      throw new TypeError("Expected the deterministic unknown-node fixture.");
    }

    const resolution = resolveSelectedResourceInspectorModel(
      document,
      awsEditorCatalog,
      {
        id: unknownNode.id,
        kind: "node",
      },
    );

    expect(resolution).toEqual({
      kind: "unavailable",
      reason:
        "This resource is not described by the exact provider catalog bound to the document. Its existing data remains untouched.",
      title: "Imported resource",
    });
  });

  it("fails closed when a selected resource schema does not match the catalog", () => {
    const base = loadAwsEditorArchitectureDocument();
    const lambda = lambdaNode(base);
    const document = parseArchitectureDocument({
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === lambda.id
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  schemaVersion: "9.9.9",
                },
              },
            }
          : node,
      ),
    });

    const resolution = resolveSelectedResourceInspectorModel(
      document,
      awsEditorCatalog,
      {
        id: lambda.id,
        kind: "node",
      },
    );

    expect(resolution).toEqual({
      kind: "unavailable",
      reason:
        "This resource uses a configuration schema version that the bound catalog cannot edit safely.",
      title: "Notes API handler",
    });
  });

  it("does not infer an unresolved selected relationship", () => {
    const document = withLambdaTableRelationship(
      loadAwsEditorArchitectureDocument(),
    );
    const edge = document.edges[0];
    if (edge === undefined) {
      throw new TypeError("Expected the deterministic relationship fixture.");
    }
    const catalogWithoutRelationships = {
      ...awsEditorCatalog,
      relationships: [],
    };
    const before = structuredClone(document);

    const resolution = resolveSelectedResourceInspectorModel(
      document,
      catalogWithoutRelationships,
      {
        id: edge.id,
        kind: "edge",
      },
    );

    expect(resolution).toEqual({
      kind: "unavailable",
      reason:
        "The bound catalog has no exact relationship descriptor for these typed endpoints. No compatibility is inferred.",
      title: "aws.lambda.reads-dynamodb-table",
    });
    expect(document).toEqual(before);
  });
});
