import {
  getArchitectureDocumentContentHash,
  getArchitectureDocumentHashes,
  getArchitectureSemanticProjection,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import type { EditorCatalog } from "./editor-catalog.js";
import {
  foundationEditorCatalog,
  loadFoundationArchitectureDocument,
} from "./foundation-editor-fixture.js";
import {
  AddServiceCommandCreationError,
  createAddServiceCommand,
  createStableServiceNodeIdentity,
  dispatchAddServiceCommand,
  resolveServiceCreationAvailability,
} from "./add-service-command.js";

function createIdFactory(prefix = "operation_catalog_test"): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}_${String(sequence).padStart(4, "0")}`;
  };
}

function expectAddServiceError(
  callback: () => unknown,
): AddServiceCommandCreationError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(AddServiceCommandCreationError);
    if (error instanceof AddServiceCommandCreationError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected add-service command creation to fail.");
}

describe("add service Graph Commands", () => {
  it("creates a user-owned node from exact safe catalog defaults without mutating inputs", () => {
    const document = loadAwsEditorArchitectureDocument();
    const documentSnapshot = structuredClone(document);
    const service = awsEditorCatalog.services.find(
      (candidate) => candidate.serviceType === "aws.apigateway.http-api",
    );
    if (service?.configuration.defaults.kind !== "ready") {
      throw new Error("Expected API Gateway to have validated defaults.");
    }
    const defaultsSnapshot = structuredClone(
      service.configuration.defaults.values,
    );
    const result = dispatchAddServiceCommand({
      catalog: awsEditorCatalog,

      createId: createIdFactory(),
      document,
      serviceId: service.serviceType,
    });
    const node = result.document.nodes.find(
      (candidate) => candidate.id === result.nodeId,
    );

    expect(node).toMatchObject({
      id: "node_apigateway_http_api",
      semantic: {
        deploymentKey: "apigateway_http_api",
        serviceType: "aws.apigateway.http-api",
        resourceType: "aws.apigateway.http-api",
        configuration: {
          schemaId: "aws.apigateway.http-api.configuration",
          schemaVersion: "1.0.0",
          values: defaultsSnapshot,
        },
        lifecycle: {
          ownership: "user",
          origin: "user",
        },
      },
      presentation: {
        label: "API Gateway HTTP API",
      },
    });
    expect(document).toEqual(documentSnapshot);
    expect(service.configuration.defaults.values).toEqual(defaultsSnapshot);
  });

  it("routes owner-managed graph configuration away from independent creation", () => {
    const availability = resolveServiceCreationAvailability(
      loadAwsEditorArchitectureDocument(),
      awsEditorCatalog,
      "aws.iam.policy-statement",
    );

    expect(availability).toEqual({
      code: "service-unavailable",
      enabled: false,
      reason:
        "This graph-backed configuration is created and managed under its owning resource.",
    });
  });

  it("uses the exact catalog parent for an app client and rejects ambiguous parents", () => {
    const document = loadAwsEditorArchitectureDocument();
    const availability = resolveServiceCreationAvailability(
      document,
      awsEditorCatalog,
      "aws.cognito.user-pool-client",
    );
    if (!availability.enabled) {
      throw new Error("Expected the fixture user pool to be a valid parent.");
    }

    expect(availability.parent).toEqual({
      nodeId: "node_identity",
      relationshipType: "aws.cognito.contains-app-client",
    });
    const prepared = createAddServiceCommand({
      catalog: awsEditorCatalog,

      createId: createIdFactory(),
      document,
      serviceId: "aws.cognito.user-pool-client",
    });
    expect(prepared.node.semantic.parent).toEqual({
      nodeId: "node_identity",
      relationshipType: "aws.cognito.contains-app-client",
    });

    const secondPool = dispatchAddServiceCommand({
      catalog: awsEditorCatalog,

      createId: createIdFactory("operation_second_pool"),
      document,
      serviceId: "aws.cognito.user-pool",
    });
    expect(
      resolveServiceCreationAvailability(
        secondPool.document,
        awsEditorCatalog,
        "aws.cognito.user-pool-client",
      ),
    ).toEqual({
      code: "parent-ambiguous",
      enabled: false,
      reason:
        "More than one valid parent exists. Parent selection is required before this service can be added.",
    });
  });

  it("fails closed when one parent service has multiple placement relationships", () => {
    const ambiguousCatalog: EditorCatalog = {
      ...awsEditorCatalog,
      services: awsEditorCatalog.services.map((service) =>
        service.serviceType === "aws.cognito.user-pool-client"
          ? {
              ...service,
              placement: {
                ...service.placement,
                allowedParents: [
                  ...service.placement.allowedParents,
                  {
                    relationshipType: "aws.cognito.alternate-app-client",
                    serviceType: "aws.cognito.user-pool",
                  },
                ],
              },
            }
          : service,
      ),
    };

    expect(
      resolveServiceCreationAvailability(
        loadAwsEditorArchitectureDocument(),
        ambiguousCatalog,
        "aws.cognito.user-pool-client",
      ),
    ).toEqual({
      code: "parent-ambiguous",
      enabled: false,
      reason:
        "More than one valid relationship can place this service under the available parent. Relationship selection is required before this service can be added.",
    });
  });

  it("fails closed when Region placement requires provider runtime behavior", () => {
    const providerDefinedCatalog: EditorCatalog = {
      ...awsEditorCatalog,
      services: awsEditorCatalog.services.map((service) =>
        service.serviceType === "aws.lambda.function"
          ? {
              ...service,
              placement: {
                ...service.placement,
                regionConstraint: "provider-defined",
              },
            }
          : service,
      ),
    };

    expect(
      resolveServiceCreationAvailability(
        loadAwsEditorArchitectureDocument(),
        providerDefinedCatalog,
        "aws.lambda.function",
      ),
    ).toEqual({
      code: "service-unavailable",
      enabled: false,
      reason:
        "This service uses provider-defined Region placement that this editor cannot evaluate safely.",
    });
  });

  it("does not treat a fallback node with a matching service ID as a valid parent", () => {
    const document = loadAwsEditorArchitectureDocument();
    const mismatchedParentDocument = parseArchitectureDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === "node_identity"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                resourceType: "aws.cognito.unknown-resource",
              },
            }
          : node,
      ),
    });

    expect(
      resolveServiceCreationAvailability(
        mismatchedParentDocument,
        awsEditorCatalog,
        "aws.cognito.user-pool-client",
      ),
    ).toEqual({
      code: "parent-unavailable",
      enabled: false,
      reason: "Add a parent first: Cognito user pool.",
    });
  });

  it("allocates stable unique identities for multiple instances", () => {
    const document = loadAwsEditorArchitectureDocument();
    expect(
      createStableServiceNodeIdentity(document, "aws.lambda.function"),
    ).toEqual({
      deploymentKey: "lambda_function",
      nodeId: "node_lambda_function",
      ordinal: 1,
    });

    const createId = createIdFactory("operation_multiple_lambda");
    const first = dispatchAddServiceCommand({
      catalog: awsEditorCatalog,

      createId,
      document,
      serviceId: "aws.lambda.function",
    });
    const second = dispatchAddServiceCommand({
      catalog: awsEditorCatalog,

      createId,
      document: first.document,
      serviceId: "aws.lambda.function",
    });

    expect(first.nodeId).toBe("node_lambda_function");
    expect(first.deploymentKey).toBe("lambda_function");
    expect(second.nodeId).toBe("node_lambda_function_2");
    expect(second.deploymentKey).toBe("lambda_function_2");
    expect(
      second.document.nodes.find((node) => node.id === second.nodeId)
        ?.presentation.label,
    ).toBe("Lambda function 2");
  });

  it("stores new visual-boundary children in parent-relative coordinates", () => {
    const foundationDocument = loadFoundationArchitectureDocument();
    const document = parseArchitectureDocument({
      ...foundationDocument,
      edges: [],
      nodes: foundationDocument.nodes.filter(
        (node) => node.id === "node_network",
      ),
    });
    const prepared = createAddServiceCommand({
      catalog: foundationEditorCatalog,
      createId: createIdFactory("operation_nested_default"),
      document,
      serviceId: "example.zone",
    });
    const explicit = createAddServiceCommand({
      catalog: foundationEditorCatalog,
      createId: createIdFactory("operation_nested_explicit"),
      document,
      position: { x: 200, y: 240 },
      serviceId: "example.zone",
    });

    expect(prepared.node.semantic.parent).toEqual({
      nodeId: "node_network",
      relationshipType: "example.relationship.contained-by",
    });
    expect(prepared.position).toEqual({ x: 32, y: 160 });
    expect(explicit.position).toEqual({ x: 120, y: 200 });
  });

  it("rejects an explicit add outside the selected boundary", () => {
    const foundationDocument = loadFoundationArchitectureDocument();
    const document = parseArchitectureDocument({
      ...foundationDocument,
      edges: [],
      nodes: foundationDocument.nodes.filter(
        (node) => node.id === "node_network",
      ),
    });

    const error = expectAddServiceError(() =>
      createAddServiceCommand({
        catalog: foundationEditorCatalog,
        createId: createIdFactory("operation_nested_overflow"),
        document,
        position: { x: 10_000, y: 10_000 },
        serviceId: "example.zone",
      }),
    );

    expect(error.code).toBe("invalid-position");
  });

  it("requires distinct command and inverse identities", () => {
    const prepared = createAddServiceCommand({
      catalog: awsEditorCatalog,

      createId: createIdFactory("operation_unique_command"),
      document: loadAwsEditorArchitectureDocument(),
      serviceId: "aws.cloudwatch.log-group",
    });

    expect(prepared.command.commandId).not.toBe(
      prepared.command.inverseCommandId,
    );
    expect(() =>
      createAddServiceCommand({
        catalog: awsEditorCatalog,

        createId: () => "operation_duplicate",
        document: loadAwsEditorArchitectureDocument(),
        serviceId: "aws.cloudwatch.log-group",
      }),
    ).toThrow(AddServiceCommandCreationError);
    try {
      createAddServiceCommand({
        catalog: awsEditorCatalog,

        createId: () => "operation_duplicate",
        document: loadAwsEditorArchitectureDocument(),
        serviceId: "aws.cloudwatch.log-group",
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: "duplicate-command-identity",
      });
    }
  });

  it("keeps semantic content identical across Add-button, keyboard, and drag creation inputs", () => {
    const document = loadAwsEditorArchitectureDocument();
    const addButton = dispatchAddServiceCommand({
      catalog: awsEditorCatalog,

      createId: createIdFactory("operation_creation_method"),
      document,
      serviceId: "aws.cloudwatch.log-group",
    });
    const keyboard = dispatchAddServiceCommand({
      catalog: awsEditorCatalog,

      createId: createIdFactory("operation_creation_method"),
      document,
      serviceId: "aws.cloudwatch.log-group",
    });
    const drag = dispatchAddServiceCommand({
      catalog: awsEditorCatalog,

      createId: createIdFactory("operation_creation_method"),
      document,
      position: { x: 960, y: 640 },
      serviceId: "aws.cloudwatch.log-group",
    });

    expect(getArchitectureSemanticProjection(keyboard.document)).toEqual(
      getArchitectureSemanticProjection(addButton.document),
    );
    expect(getArchitectureSemanticProjection(drag.document)).toEqual(
      getArchitectureSemanticProjection(addButton.document),
    );
    expect(getArchitectureDocumentContentHash(keyboard.document)).toBe(
      getArchitectureDocumentContentHash(addButton.document),
    );
    expect(getArchitectureDocumentContentHash(drag.document)).toBe(
      getArchitectureDocumentContentHash(addButton.document),
    );
    expect(keyboard.nodeId).toBe(addButton.nodeId);
    expect(drag.nodeId).toBe(addButton.nodeId);
    expect(
      keyboard.document.nodes.find((node) => node.id === keyboard.nodeId)
        ?.semantic,
    ).toEqual(
      addButton.document.nodes.find((node) => node.id === addButton.nodeId)
        ?.semantic,
    );
    expect(
      drag.document.nodes.find((node) => node.id === drag.nodeId)?.semantic,
    ).toEqual(
      addButton.document.nodes.find((node) => node.id === addButton.nodeId)
        ?.semantic,
    );
    expect(getArchitectureDocumentHashes(keyboard.document).visualHash).toBe(
      getArchitectureDocumentHashes(addButton.document).visualHash,
    );
    expect(getArchitectureDocumentHashes(drag.document).visualHash).not.toBe(
      getArchitectureDocumentHashes(addButton.document).visualHash,
    );
  });
});
