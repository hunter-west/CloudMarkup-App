import {
  applyGraphCommand,
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { awsConnectionResolverV1 } from "@cloudmarkup/provider-aws";
import { nodeIdSchema, type ConfigurationValue } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsNetworkingVisualArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import {
  prepareConnectionCompatibilityRequest,
  projectConnectionCandidates,
  projectConnectionPreview,
} from "./connection-workflow.js";

type TaggedValues = Readonly<Record<string, Readonly<ConfigurationValue>>>;

function serviceConfiguration(serviceId: string, overrides: TaggedValues = {}) {
  const service = awsEditorCatalog.services.find(
    (candidate) => candidate.serviceType === serviceId,
  );
  if (service?.configuration.defaults.kind !== "ready") {
    throw new TypeError(`Missing defaults for ${serviceId}.`);
  }
  const result = service.configuration.validate({
    ...service.configuration.defaults.values,
    ...overrides,
  });
  if (!result.success) {
    throw new TypeError(`Invalid test configuration for ${serviceId}.`);
  }
  return {
    schemaId: service.configuration.schemaId,
    schemaVersion: service.configuration.schemaVersion,
    values: result.values,
  };
}

function relationshipConfiguration(ruleId: string) {
  const relationship = awsEditorCatalog.relationships?.find(
    (candidate) => candidate.descriptorId === ruleId,
  );
  if (relationship?.configuration.defaults.kind !== "ready") {
    throw new TypeError(`Missing relationship defaults for ${ruleId}.`);
  }
  return {
    schemaId: relationship.configuration.schemaId,
    schemaVersion: relationship.configuration.schemaVersion,
    values: relationship.configuration.defaults.values,
  };
}

function testNode(
  id: string,
  serviceId: string,
  x: number,
  y: number,
  parent?: { readonly nodeId: string; readonly relationshipType: string },
) {
  const service = awsEditorCatalog.services.find(
    (candidate) => candidate.serviceType === serviceId,
  );
  if (service === undefined) {
    throw new TypeError(`Unknown test service ${serviceId}.`);
  }
  return {
    id,
    semantic: {
      deploymentKey: id,
      serviceType: service.serviceType,
      resourceType: service.resourceType,
      configuration: serviceConfiguration(serviceId),
      ...(parent === undefined ? {} : { parent }),
      lifecycle: {
        ownership: "user",
        origin: "user",
      },
    },
    presentation: {
      label: service.displayName,
      position: { x, y },
    },
  };
}

function createConnectionDocument(): ArchitectureDocument {
  return parseArchitectureDocument({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 1,
    documentId: "document_connection_workflow",
    architectureId: "architecture_connection_workflow",
    revision: {
      revisionId: "revision_connection_workflow",
      revisionNumber: 1,
      createdAt: "2026-07-29T12:00:00Z",
      createdBy: "actor_connection_test",
      sourceDraftId: "draft_connection_workflow",
    },
    provider: {
      id: awsEditorCatalog.providerId,
      region: "us-east-1",
    },
    catalog: {
      id: awsEditorCatalog.identity.id,
      version: awsEditorCatalog.identity.version,
      digest: awsEditorCatalog.identity.digest,
    },
    compilerCompatibility: {
      inputContractVersion: 1,
      minimumCompilerVersion: "1.0.0",
      maximumCompilerVersionExclusive: "2.0.0",
    },
    metadata: {
      source: "user",
      serialization: {
        mediaType: "application/json",
        encoding: "utf-8",
        canonicalization: "cloudmarkup.canonical-json.v1",
      },
    },
    nodes: [
      testNode("api", "aws.apigateway.http-api", 0, 0),
      testNode("lambda", "aws.lambda.function", 280, 0),
      testNode("table", "aws.dynamodb.table", 560, 0),
      testNode("role", "aws.iam.role", 280, 280),
      testNode("pool", "aws.cognito.user-pool", 0, 280),
      testNode("client", "aws.cognito.user-pool-client", 0, 560, {
        nodeId: "pool",
        relationshipType: "aws.cognito.contains-app-client",
      }),
    ],
    edges: [
      {
        id: "role_lambda",
        semantic: {
          source: {
            nodeId: "role",
            port: "aws.iam.role.assumable-role",
          },
          target: {
            nodeId: "lambda",
            port: "aws.lambda.function.execution-role",
          },
          relationshipType: "aws.iam.role-assumed-by-lambda",
          configuration: relationshipConfiguration(
            "aws.iam.role-assumed-by-lambda",
          ),
          lifecycle: {
            ownership: "user",
            origin: "user",
          },
        },
      },
    ],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
  });
}

function exactCandidates(
  document: ArchitectureDocument,
  source: { readonly nodeId: string; readonly portId: string },
  target: { readonly nodeId: string; readonly portId: string },
) {
  const result = awsConnectionResolverV1.listCompatible({
    anchor: source,
    anchorRole: "source",
    counterpart: target,
    document,
  });
  return {
    result,
    projected: projectConnectionCandidates(
      document,
      awsEditorCatalog,
      result.candidates,
    ),
  };
}

describe("connection workflow model", () => {
  it("omits an invalid SQS self candidate while keeping distinct queues identifiable and resolvable", () => {
    const document = parseArchitectureDocument({
      ...createConnectionDocument(),
      nodes: [
        testNode("queue_a", "aws.sqs.queue", 0, 0),
        testNode("queue_b", "aws.sqs.queue", 280, 0),
      ],
      edges: [],
    });
    const before = structuredClone(document);
    const result = awsConnectionResolverV1.listCompatible({
      document,
      anchor: { nodeId: "queue_a", portId: "aws.sqs.queue.redrive" },
      anchorRole: "source",
    });
    const self = result.candidates.find(
      (candidate) => candidate.source.nodeId === candidate.target.nodeId,
    );
    expect(self).toBeDefined();
    if (self === undefined) throw Error("Expected the reported self candidate");
    const rejected = awsConnectionResolverV1.resolve({
      document,
      operationId: "self_dlq",
      ruleId: self.rule.id,
      source: self.source,
      target: self.target,
      configuration: relationshipConfiguration(self.rule.id).values,
    });
    expect(rejected).toMatchObject({
      success: false,
      findings: [
        expect.objectContaining({
          code: "cloudmarkup.connection.preview-rejected",
        }),
      ],
    });
    expect(document).toEqual(before);
    const projected = projectConnectionCandidates(
      document,
      awsEditorCatalog,
      result.candidates,
    );
    expect(projected).toHaveLength(1);
    const distinct = projected[0];
    if (distinct === undefined)
      throw Error("Expected the distinct destination queue");
    expect(distinct.source.nodeLabel).toBe("SQS queue (queue_a)");
    expect(distinct.target.nodeLabel).toBe("SQS queue (queue_b)");
    const resolved = awsConnectionResolverV1.resolve({
      document,
      operationId: "distinct_dlq",
      ruleId: distinct.relationship.descriptorId,
      source: {
        nodeId: distinct.source.nodeId,
        portId: distinct.source.portId,
      },
      target: {
        nodeId: distinct.target.nodeId,
        portId: distinct.target.portId,
      },
      configuration: relationshipConfiguration(
        distinct.relationship.descriptorId,
      ).values,
    });
    expect(resolved.success).toBe(true);
    expect(document).toEqual(before);
  });
  it.each([
    ["api", "lambda"],
    ["lambda", "api"],
  ])(
    "discovers typed direction for a service-pair drag from %s to %s",
    (sourceNodeId, targetNodeId) => {
      const document = createConnectionDocument();
      const before = structuredClone(document);
      const prepared = prepareConnectionCompatibilityRequest(document, {
        kind: "node-pair",
        sourceNodeId,
        targetNodeId,
      });
      if (prepared === undefined) throw Error("Expected pair request");
      const result = awsConnectionResolverV1.listCompatible(prepared.request);
      const candidates = projectConnectionCandidates(
        document,
        awsEditorCatalog,
        result.candidates,
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        source: { nodeId: "api", portId: "aws.apigateway.http-api.invocation" },
        target: {
          nodeId: "lambda",
          portId: "aws.lambda.function.synchronous-invocation",
        },
      });
      expect(document).toEqual(before);
    },
  );
  it("projects the exact API Gateway to Lambda direction and rejects the reverse", () => {
    const document = createConnectionDocument();
    const source = {
      nodeId: "api",
      portId: "aws.apigateway.http-api.invocation",
    };
    const target = {
      nodeId: "lambda",
      portId: "aws.lambda.function.synchronous-invocation",
    };
    const prepared = prepareConnectionCompatibilityRequest(document, {
      kind: "endpoints",
      source,
      target,
    });
    const { result, projected } = exactCandidates(document, source, target);

    expect(prepared).toMatchObject({
      editingEdgeId: null,
      request: {
        anchor: source,
        anchorRole: "source",
        counterpart: target,
      },
    });
    expect(result.findings).toEqual([]);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      relationship: {
        descriptorId: "aws.apigateway.http-api-invokes-lambda",
        id: "aws.apigateway.integrates-lambda",
      },
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    });

    const reverse = awsConnectionResolverV1.listCompatible({
      anchor: target,
      anchorRole: "source",
      counterpart: source,
      document,
    });
    expect(reverse.candidates).toEqual([]);
    expect(reverse.findings).toEqual([
      expect.objectContaining({
        code: "cloudmarkup.connection.unsupported-direction",
        severity: "error",
      }),
    ]);
  });

  it("preserves descriptor-only candidates and their rule-engine findings", () => {
    const document = createConnectionDocument();
    const source = {
      nodeId: "pool",
      portId: "aws.cognito.user-pool.app-client-parent",
    };
    const target = {
      nodeId: "client",
      portId: "aws.cognito.user-pool-client.user-pool",
    };
    const { result, projected } = exactCandidates(document, source, target);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.rule.implementation.status).toBe(
      "not-implemented",
    );
    expect(result.candidates[0]?.findings).toEqual([
      expect.objectContaining({
        code: "cloudmarkup.connection.rule-not-implemented",
        severity: "error",
      }),
    ]);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      findings: [
        {
          code: "cloudmarkup.connection.rule-not-implemented",
          guidedMessage:
            "This catalog relationship is descriptive only and cannot be added automatically.",
          path: "$.ruleId",
          professionalMessage:
            "The connection descriptor intentionally has no registered resolver implementation.",
          severity: "error",
        },
      ],
      relationship: {
        descriptorId: "aws.cognito.user-pool-configures-app-client",
        implementation: {
          status: "not-implemented",
        },
      },
      source,
      target,
    });
  });

  it("does not reinterpret resolver compatibility from presentation support state", () => {
    const document = createConnectionDocument();
    const result = awsConnectionResolverV1.listCompatible({
      anchor: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      anchorRole: "source",
      counterpart: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      document,
    });
    const presentationOnlyCatalog = {
      ...awsEditorCatalog,
      services: awsEditorCatalog.services.map((service) =>
        service.serviceType === "aws.apigateway.http-api"
          ? { ...service, supportState: "unsupported" as const }
          : service,
      ),
    };

    expect(
      projectConnectionCandidates(
        document,
        presentationOnlyCatalog,
        result.candidates,
      ),
    ).toHaveLength(1);
  });

  it("fails candidate projection closed for a mismatched editor catalog binding", () => {
    const document = createConnectionDocument();
    const result = awsConnectionResolverV1.listCompatible({
      anchor: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      anchorRole: "source",
      counterpart: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      document,
    });
    const mismatchedCatalog = {
      ...awsEditorCatalog,
      identity: {
        ...awsEditorCatalog.identity,
        version: "999.0.0",
      },
    };

    expect(result.candidates).toHaveLength(1);
    expect(
      projectConnectionCandidates(
        document,
        mismatchedCatalog,
        result.candidates,
      ),
    ).toEqual([]);
  });

  it("projects API questions, reviewed defaults, permission, and generated provenance from the resolver", () => {
    const document = createConnectionDocument();
    const { projected } = exactCandidates(
      document,
      {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    );
    const candidate = projected[0];
    if (candidate === undefined) {
      throw new TypeError("Expected the API to Lambda candidate.");
    }

    expect(
      candidate.relationship.questions.map((question) => [
        question.property,
        question.answer.kind,
      ]),
    ).toEqual([
      ["timeoutMilliseconds", "catalog-default"],
      ["payloadFormatVersion", "catalog-default"],
      ["routeKey", "required-user-input"],
    ]);

    const resolved = awsConnectionResolverV1.resolve({
      configuration: {
        routeKey: { kind: "string", value: "GET /notes" },
      },
      document,
      operationId: "api_connect",
      ruleId: candidate.relationship.descriptorId,
      source: {
        nodeId: candidate.source.nodeId,
        portId: candidate.source.portId,
      },
      target: {
        nodeId: candidate.target.nodeId,
        portId: candidate.target.portId,
      },
    });
    expect(resolved.success).toBe(true);
    if (!resolved.success) {
      return;
    }

    const relationships = awsEditorCatalog.relationships;
    if (relationships === undefined) {
      throw new TypeError("Expected the AWS relationship projection.");
    }
    const presentationCatalogWithConflictingPermission = {
      ...awsEditorCatalog,
      relationships: relationships.map((relationship) =>
        relationship.descriptorId === "aws.apigateway.http-api-invokes-lambda"
          ? {
              ...relationship,
              iamEffects: relationship.iamEffects.map((effect) => ({
                ...effect,
                actions: ["lambda:DeleteFunction"],
                principal: "conflicting.presentation.example",
              })),
            }
          : relationship,
      ),
    };
    const preview = projectConnectionPreview(
      presentationCatalogWithConflictingPermission,
      candidate,
      resolved,
      document,
    );
    expect(preview.configuration).toMatchObject({
      payloadFormatVersion: { kind: "string", value: "2.0" },
      routeKey: { kind: "string", value: "GET /notes" },
      timeoutMilliseconds: { kind: "integer", value: 10_000 },
    });
    expect(preview.iamEffects).toEqual([
      expect.objectContaining({
        actions: ["lambda:InvokeFunction"],
        principal: "apigateway.amazonaws.com",
        resourceScope: "target-node",
      }),
    ]);
    expect(JSON.stringify(preview.iamEffects)).not.toContain(
      "conflicting.presentation.example",
    );
    expect(
      preview.generatedResources.map((resource) => ({
        id: resource.id,
        kind: resource.kind,
      })),
    ).toEqual([
      { id: "api_connect.edge.connection", kind: "edge" },
      {
        id: "api_connect.node.lambda-service-grant-document",
        kind: "node",
      },
      { id: "api_connect.node.lambda-service-grant", kind: "node" },
      {
        id: "api_connect.edge.lambda-service-grant-owner",
        kind: "edge",
      },
      {
        id: "api_connect.edge.lambda-service-grant-statement",
        kind: "edge",
      },
      {
        id: "api_connect.edge.lambda-service-grant-scope",
        kind: "edge",
      },
    ]);
    const directConnectionLifecycle = {
      dependentEdgeIds: [],
      dependentNodeIds: ["api", "lambda"],
      generatorId: "aws.apigateway.http-api-invokes-lambda",
      generatorVersion: "1.0.0",
      operationId: "api_connect",
      ownership: "generated",
    };
    const policyLifecycle = {
      ...directConnectionLifecycle,
      dependentEdgeIds: ["api_connect.edge.connection"],
      dependentNodeIds: [],
    };
    expect(preview.generatedResources[0]).toMatchObject({
      configuration: {
        schemaId: "aws.apigateway.lambda-integration.connection",
        schemaVersion: "1.0.0",
        values: {
          payloadFormatVersion: { kind: "string", value: "2.0" },
          routeKey: { kind: "string", value: "GET /notes" },
          timeoutMilliseconds: { kind: "integer", value: 10_000 },
        },
      },
      id: "api_connect.edge.connection",
      kind: "edge",
      lifecycle: directConnectionLifecycle,
      relationshipType: "aws.apigateway.integrates-lambda",
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    });
    expect(preview.generatedResources[1]).toMatchObject({
      configuration: {
        schemaId: "aws.iam.policy-document.configuration",
        schemaVersion: "1.0.0",
        values: {
          policyKind: { kind: "string", value: "service-grant" },
          policyName: {
            kind: "string",
            value: "ApiGatewayInvokePermission",
          },
        },
      },
      id: "api_connect.node.lambda-service-grant-document",
      kind: "node",
      lifecycle: policyLifecycle,
      resourceType: "aws.iam.policy-document",
      serviceType: "aws.iam.policy-document",
    });
    expect(preview.generatedResources[2]).toMatchObject({
      configuration: {
        schemaId: "aws.iam.policy-statement.configuration",
        schemaVersion: "2.0.0",
        values: {
          actions: { kind: "string-list", value: ["lambda:InvokeFunction"] },
          effect: { kind: "string", value: "allow" },
          principalKind: { kind: "string", value: "service" },
          principals: {
            kind: "string-list",
            value: ["apigateway.amazonaws.com"],
          },
          resourceExpressions: { kind: "string-list", value: [] },
          resourceNode: {
            attribute: "aws.lambda.function.arn",
            kind: "node-reference",
            nodeId: "lambda",
          },
          statementId: {
            kind: "string",
            value: "ApiGatewayInvokePermission",
          },
        },
      },
      id: "api_connect.node.lambda-service-grant",
      kind: "node",
      lifecycle: policyLifecycle,
      resourceType: "aws.iam.policy-statement",
      serviceType: "aws.iam.policy-statement",
    });
    expect(preview.generatedResources[3]).toMatchObject({
      id: "api_connect.edge.lambda-service-grant-owner",
      kind: "edge",
      lifecycle: policyLifecycle,
      relationshipType: "aws.lambda.owns-invocation-permission",
      source: {
        nodeId: "api_connect.node.lambda-service-grant-document",
        portId: "aws.iam.policy-document.lambda-service-grant",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.invocation-permission",
      },
    });
    expect(preview.generatedResources[4]).toMatchObject({
      id: "api_connect.edge.lambda-service-grant-statement",
      kind: "edge",
      lifecycle: policyLifecycle,
      relationshipType: "aws.iam.policy-contains-statement",
      source: {
        nodeId: "api_connect.node.lambda-service-grant",
        portId: "aws.iam.policy-statement.policy-document",
      },
      target: {
        nodeId: "api_connect.node.lambda-service-grant-document",
        portId: "aws.iam.policy-document.statement",
      },
    });
    expect(preview.generatedResources[5]).toMatchObject({
      id: "api_connect.edge.lambda-service-grant-scope",
      kind: "edge",
      lifecycle: policyLifecycle,
      relationshipType: "aws.iam.authorizes-lambda-function",
      source: {
        nodeId: "api_connect.node.lambda-service-grant",
        portId: "aws.iam.policy-statement.lambda-resource",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.policy-resource",
      },
    });
    expect(
      preview.commands.map((command) => ({
        kind: command.kind,
        targetResourceIds: command.targetResourceIds,
      })),
    ).toEqual([
      {
        kind: "add-edge",
        targetResourceIds: ["api_connect.edge.connection"],
      },
      {
        kind: "add-node",
        targetResourceIds: ["api_connect.node.lambda-service-grant-document"],
      },
      {
        kind: "add-node",
        targetResourceIds: ["api_connect.node.lambda-service-grant"],
      },
      {
        kind: "add-edge",
        targetResourceIds: ["api_connect.edge.lambda-service-grant-owner"],
      },
      {
        kind: "add-edge",
        targetResourceIds: ["api_connect.edge.lambda-service-grant-statement"],
      },
      {
        kind: "add-edge",
        targetResourceIds: ["api_connect.edge.lambda-service-grant-scope"],
      },
    ]);
    const danglingResult = {
      ...resolved,
      generatedResources: [
        ...resolved.generatedResources,
        {
          kind: "node" as const,
          nodeId: nodeIdSchema.parse("missing_resource"),
        },
      ],
    };
    expect(() =>
      projectConnectionPreview(
        presentationCatalogWithConflictingPermission,
        candidate,
        danglingResult,
        document,
      ),
    ).toThrow("incomplete generated-resource preview");
    expect(document.edges).toHaveLength(1);
  });

  it("rejects a resolver result whose batch and deterministic preview differ", () => {
    const document = createConnectionDocument();
    const { projected } = exactCandidates(
      document,
      {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    );
    const candidate = projected[0];
    if (candidate === undefined) {
      throw new TypeError("Expected the API to Lambda candidate.");
    }
    const resolved = awsConnectionResolverV1.resolve({
      configuration: {
        routeKey: { kind: "string", value: "GET /notes" },
      },
      document,
      operationId: "mismatched_preview",
      ruleId: candidate.relationship.descriptorId,
      source: {
        nodeId: candidate.source.nodeId,
        portId: candidate.source.portId,
      },
      target: {
        nodeId: candidate.target.nodeId,
        portId: candidate.target.portId,
      },
    });
    if (!resolved.success) {
      throw new TypeError("Expected a successful connection resolution.");
    }

    expect(() =>
      projectConnectionPreview(
        awsEditorCatalog,
        candidate,
        {
          ...resolved,
          preview: {
            ...resolved.preview,
            changes: [],
          },
        },
        document,
      ),
    ).toThrow("does not match its deterministic connection preview");
    expect(document.edges).toHaveLength(1);
  });

  it("rejects a resolver preview for different same-service endpoints", () => {
    const baseDocument = createConnectionDocument();
    const document = parseArchitectureDocument({
      ...baseDocument,
      nodes: [
        ...baseDocument.nodes,
        testNode("lambda_two", "aws.lambda.function", 840, 0),
      ],
    });
    const { projected } = exactCandidates(
      document,
      {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    );
    const candidate = projected[0];
    if (candidate === undefined) {
      throw new TypeError("Expected the selected API to Lambda candidate.");
    }
    const resolved = awsConnectionResolverV1.resolve({
      configuration: {
        routeKey: { kind: "string", value: "GET /alternate" },
      },
      document,
      operationId: "wrong_endpoint",
      ruleId: candidate.relationship.descriptorId,
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda_two",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    });
    if (!resolved.success) {
      throw new TypeError("Expected a successful connection resolution.");
    }

    expect(() =>
      projectConnectionPreview(awsEditorCatalog, candidate, resolved, document),
    ).toThrow("does not match the selected exact connection endpoints");
    expect(document.edges).toHaveLength(1);
  });

  it("retargets one generated association through the pinned rule as one invertible batch", () => {
    const original = loadAwsNetworkingVisualArchitectureDocument();
    const releasedTarget = awsConnectionResolverV1.cleanup({
      connectionEdgeId: "net_pub_a_route_assoc.edge.connection",
      document: original,
      operationId: "release_public_a_target",
    });
    expect(releasedTarget.success).toBe(true);
    if (!releasedTarget.success) {
      return;
    }
    const document = releasedTarget.preview.document;
    const edgeId = "net_pub_b_route_assoc.edge.connection";
    const prepared = prepareConnectionCompatibilityRequest(document, {
      edgeId,
      kind: "edge-retarget",
      retainedEndpoint: "source",
    });
    expect(prepared).toMatchObject({
      editingEdgeId: edgeId,
      preferredRuleId: "aws.ec2.route-table-association-targets-subnet",
      requiredRuleId: "aws.ec2.route-table-association-targets-subnet",
      request: {
        anchor: {
          nodeId: "node_public_route_association_b",
          portId: "aws.ec2.route-table-association.subnet",
        },
        anchorRole: "source",
        excludingConnectionEdgeId: edgeId,
      },
    });
    expect(prepared?.request).not.toHaveProperty("counterpart");
    if (prepared === undefined) {
      throw new TypeError("Expected a generated-edge retarget request.");
    }
    if (prepared.editingEdgeId === null) {
      throw new TypeError("Expected a generated-edge retarget request.");
    }

    const reversePrepared = prepareConnectionCompatibilityRequest(document, {
      edgeId,
      kind: "edge-retarget",
      retainedEndpoint: "target",
    });
    expect(reversePrepared).toMatchObject({
      editingEdgeId: edgeId,
      preferredRuleId: "aws.ec2.route-table-association-targets-subnet",
      request: {
        anchor: {
          nodeId: "node_public_subnet_b",
          portId: "aws.ec2.subnet.route-table-association",
        },
        anchorRole: "target",
        excludingConnectionEdgeId: edgeId,
      },
    });
    expect(reversePrepared?.request).not.toHaveProperty("counterpart");

    const compatibility = awsConnectionResolverV1.listCompatible(
      prepared.request,
    );
    const candidates = projectConnectionCandidates(
      document,
      awsEditorCatalog,
      compatibility.candidates,
      prepared.editingEdgeId,
    ).filter(
      (candidate) =>
        candidate.relationship.descriptorId === prepared.preferredRuleId &&
        !candidate.findings.some((finding) => finding.severity === "error"),
    );
    expect(candidates.map((candidate) => candidate.target.nodeId)).toEqual([
      "node_public_subnet_a",
      "node_public_subnet_b",
    ]);
    const replacement = candidates.find(
      (candidate) => candidate.target.nodeId === "node_public_subnet_a",
    );
    if (replacement === undefined) {
      throw new TypeError("Expected the released subnet target candidate.");
    }
    const beforePlacement = document.nodes.map((node) => ({
      id: node.id,
      parent: node.semantic.parent,
      position: node.presentation.position,
    }));
    const edited = awsConnectionResolverV1.edit({
      configuration: {},
      connectionEdgeId: prepared.editingEdgeId,
      document,
      operationId: "retarget_public_b_to_a",
      ruleId: replacement.relationship.descriptorId,
      source: {
        nodeId: replacement.source.nodeId,
        portId: replacement.source.portId,
      },
      target: {
        nodeId: replacement.target.nodeId,
        portId: replacement.target.portId,
      },
    });
    expect(edited.success).toBe(true);
    if (!edited.success) {
      return;
    }
    expect(edited.batch).toMatchObject({
      kind: "batch",
      origin: "connection-rule",
    });
    expect(edited.batch.commands.map((command) => command.kind)).toEqual([
      "release-generated-resource",
      "add-edge",
    ]);
    expect(
      edited.preview.document.edges.find((edge) => edge.id === edgeId),
    ).toMatchObject({
      id: edgeId,
      semantic: {
        lifecycle: {
          ownership: "generated",
          provenance: {
            generatorId: "aws.ec2.route-table-association-targets-subnet",
            generatorKind: "connection-rule",
            operationId: "net_pub_b_route_assoc",
          },
        },
        source: { nodeId: "node_public_route_association_b" },
        target: { nodeId: "node_public_subnet_a" },
      },
    });
    expect(
      edited.preview.document.nodes.map((node) => ({
        id: node.id,
        parent: node.semantic.parent,
        position: node.presentation.position,
      })),
    ).toEqual(beforePlacement);

    const applied = applyGraphCommand(document, edited.batch);
    expect(applied.document).toEqual(edited.preview.document);
    expect(applied.inversion.kind).toBe("available");
    if (applied.inversion.kind !== "available") {
      throw new TypeError("Expected an invertible atomic retarget batch.");
    }
    const restored = applyGraphCommand(
      applied.document,
      applied.inversion.command,
    ).document;
    expect(getArchitectureDocumentHashes(restored)).toEqual(
      getArchitectureDocumentHashes(document),
    );
  });

  it("keeps explicit DynamoDB read and write relationships simultaneous and preserves read identities during edit", () => {
    const document = createConnectionDocument();
    const { projected: readCandidates } = exactCandidates(
      document,
      {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-read",
      },
      {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
    );
    const readCandidate = readCandidates[0];
    if (readCandidate === undefined) {
      throw new TypeError("Expected the Lambda data-read candidate.");
    }
    expect(readCandidate.cardinality).toMatchObject({
      endpointPair: { maximum: 1, used: 0 },
      sourcePort: { maximum: null, used: 0 },
      sourceRule: { maximum: 16, used: 0 },
    });
    const read = awsConnectionResolverV1.resolve({
      configuration: {
        consistentRead: { kind: "boolean", value: false },
      },
      document,
      operationId: "table_read",
      ruleId: readCandidate.relationship.descriptorId,
      source: {
        nodeId: readCandidate.source.nodeId,
        portId: readCandidate.source.portId,
      },
      target: {
        nodeId: readCandidate.target.nodeId,
        portId: readCandidate.target.portId,
      },
    });
    expect(read.success).toBe(true);
    if (!read.success) {
      return;
    }

    const preparedEdit = prepareConnectionCompatibilityRequest(
      read.preview.document,
      { edgeId: "table_read.edge.connection", kind: "edge" },
    );
    if (preparedEdit === undefined) {
      throw new TypeError("Expected an edit compatibility request.");
    }
    if (preparedEdit.editingEdgeId === null) {
      throw new TypeError("Expected an edit compatibility request.");
    }
    expect(preparedEdit.requiredRuleId).toBeNull();
    const editCompatibility = awsConnectionResolverV1.listCompatible(
      preparedEdit.request,
    );
    const createProjection = projectConnectionCandidates(
      read.preview.document,
      awsEditorCatalog,
      editCompatibility.candidates,
    );
    const editProjection = projectConnectionCandidates(
      read.preview.document,
      awsEditorCatalog,
      editCompatibility.candidates,
      preparedEdit.editingEdgeId,
    );
    expect(createProjection[0]?.cardinality.endpointPair).toEqual({
      maximum: 1,
      used: 1,
    });
    expect(editProjection[0]?.cardinality.endpointPair).toEqual({
      maximum: 1,
      used: 0,
    });

    const { projected: writeCandidates } = exactCandidates(
      read.preview.document,
      {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
    );
    const writeCandidate = writeCandidates[0];
    if (writeCandidate === undefined) {
      throw new TypeError("Expected the Lambda data-write candidate.");
    }
    const write = awsConnectionResolverV1.resolve({
      configuration: {},
      document: read.preview.document,
      operationId: "table_write",
      ruleId: writeCandidate.relationship.descriptorId,
      source: {
        nodeId: writeCandidate.source.nodeId,
        portId: writeCandidate.source.portId,
      },
      target: {
        nodeId: writeCandidate.target.nodeId,
        portId: writeCandidate.target.portId,
      },
    });
    expect(write.success).toBe(true);
    if (!write.success) {
      return;
    }
    expect(read.iamEffects[0]?.actions).toEqual([
      "dynamodb:GetItem",
      "dynamodb:Query",
    ]);
    expect(write.iamEffects[0]?.actions).toEqual([
      "dynamodb:DeleteItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]);
    expect(JSON.stringify(write.iamEffects)).not.toContain("*");
    expect(
      read.generatedResources.map((resource) =>
        resource.kind === "node" ? resource.nodeId : resource.edgeId,
      ),
    ).toEqual([
      "table_read.edge.connection",
      "table_read.node.dynamodb-policy-document",
      "table_read.node.dynamodb-policy",
      "table_read.edge.policy-role",
      "table_read.edge.policy-document-statement",
      "table_read.edge.policy-table",
    ]);
    const readPolicyLifecycle = {
      ownership: "generated",
      origin: "connection-rule",
      provenance: {
        dependentEdgeIds: ["table_read.edge.connection"],
        dependentNodeIds: [],
        generatorId: "aws.lambda.reads-dynamodb-table",
        generatorKind: "connection-rule",
        generatorVersion: "1.0.0",
        operationId: "table_read",
      },
    };
    expect(
      read.preview.document.nodes.find(
        (node) => node.id === "table_read.node.dynamodb-policy-document",
      ),
    ).toMatchObject({
      semantic: {
        configuration: {
          schemaId: "aws.iam.policy-document.configuration",
          schemaVersion: "1.0.0",
          values: {
            policyKind: { kind: "string", value: "generated-permission" },
            policyName: { kind: "string", value: "DynamoDbReadAccess" },
          },
        },
        lifecycle: readPolicyLifecycle,
        parent: {
          nodeId: "role",
          relationshipType: "aws.iam.role-owns-generated-permission",
        },
        resourceType: "aws.iam.policy-document",
        serviceType: "aws.iam.policy-document",
      },
    });
    expect(
      read.preview.document.nodes.find(
        (node) => node.id === "table_read.node.dynamodb-policy",
      ),
    ).toMatchObject({
      semantic: {
        configuration: {
          schemaId: "aws.iam.policy-statement.configuration",
          schemaVersion: "2.0.0",
          values: {
            actions: {
              kind: "string-list",
              value: ["dynamodb:GetItem", "dynamodb:Query"],
            },
            effect: { kind: "string", value: "allow" },
            principalKind: { kind: "string", value: "none" },
            principals: { kind: "string-list", value: [] },
            resourceExpressions: { kind: "string-list", value: [] },
            resourceNode: {
              attribute: "aws.dynamodb.table.arn",
              kind: "node-reference",
              nodeId: "table",
            },
            statementId: { kind: "string", value: "DynamoDbReadAccess" },
          },
        },
        lifecycle: readPolicyLifecycle,
        parent: {
          nodeId: "table_read.node.dynamodb-policy-document",
          relationshipType: "aws.iam.policy-contains-statement",
        },
        resourceType: "aws.iam.policy-statement",
        serviceType: "aws.iam.policy-statement",
      },
    });
    expect(
      read.preview.document.edges
        .filter((edge) => edge.id.startsWith("table_read.edge.policy-"))
        .map((edge) => ({
          id: edge.id,
          lifecycle: edge.semantic.lifecycle,
          relationshipType: edge.semantic.relationshipType,
          source: edge.semantic.source,
          target: edge.semantic.target,
        })),
    ).toEqual([
      {
        id: "table_read.edge.policy-role",
        lifecycle: readPolicyLifecycle,
        relationshipType: "aws.iam.role-owns-generated-permission",
        source: {
          nodeId: "table_read.node.dynamodb-policy-document",
          port: "aws.iam.policy-document.role-generated-permission",
        },
        target: { nodeId: "role", port: "aws.iam.role.generated-permission" },
      },
      {
        id: "table_read.edge.policy-document-statement",
        lifecycle: readPolicyLifecycle,
        relationshipType: "aws.iam.policy-contains-statement",
        source: {
          nodeId: "table_read.node.dynamodb-policy",
          port: "aws.iam.policy-statement.policy-document",
        },
        target: {
          nodeId: "table_read.node.dynamodb-policy-document",
          port: "aws.iam.policy-document.statement",
        },
      },
      {
        id: "table_read.edge.policy-table",
        lifecycle: readPolicyLifecycle,
        relationshipType: "aws.iam.authorizes-dynamodb-table",
        source: {
          nodeId: "table_read.node.dynamodb-policy",
          port: "aws.iam.policy-statement.dynamodb-resource",
        },
        target: {
          nodeId: "table",
          port: "aws.dynamodb.table.policy-resource",
        },
      },
    ]);
    expect(read.configuration).toMatchObject({
      consistentRead: { kind: "boolean", value: false },
    });
    expect(
      write.preview.document.edges
        .filter(
          (edge) =>
            edge.semantic.relationshipType ===
              "aws.lambda.reads-dynamodb-table" ||
            edge.semantic.relationshipType ===
              "aws.lambda.writes-dynamodb-table",
        )
        .map((edge) => edge.semantic.relationshipType)
        .sort(),
    ).toEqual([
      "aws.lambda.reads-dynamodb-table",
      "aws.lambda.writes-dynamodb-table",
    ]);
    const writePreview = projectConnectionPreview(
      awsEditorCatalog,
      writeCandidate,
      write,
      read.preview.document,
    );
    expect(
      writePreview.iamRequirements.map((requirement) => ({
        actions: requirement.actions,
        effectId: requirement.effectId,
        ruleId: requirement.ruleId,
        sourceEdgeId: requirement.sourceEdgeId,
      })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actions: ["dynamodb:GetItem", "dynamodb:Query"],
          effectId: "aws.lambda.iam.dynamodb-read",
          ruleId: "aws.lambda.reads-dynamodb-table",
          sourceEdgeId: "table_read.edge.connection",
        }),
        expect.objectContaining({
          actions: [
            "dynamodb:DeleteItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
          ],
          effectId: "aws.lambda.iam.dynamodb-write",
          ruleId: "aws.lambda.writes-dynamodb-table",
          sourceEdgeId: "table_write.edge.connection",
        }),
      ]),
    );

    const edited = awsConnectionResolverV1.edit({
      configuration: {
        consistentRead: { kind: "boolean", value: true },
      },
      connectionEdgeId: "table_read.edge.connection",
      document: write.preview.document,
      operationId: "edit_table_read",
      ruleId: readCandidate.relationship.descriptorId,
      source: {
        nodeId: readCandidate.source.nodeId,
        portId: readCandidate.source.portId,
      },
      target: {
        nodeId: readCandidate.target.nodeId,
        portId: readCandidate.target.portId,
      },
    });
    expect(edited.success).toBe(true);
    if (!edited.success) {
      return;
    }
    expect(
      write.preview.document.nodes.filter((node) =>
        node.id.startsWith("table_write."),
      ),
    ).toHaveLength(2);
    expect(
      write.preview.document.edges.filter((edge) =>
        edge.id.startsWith("table_write."),
      ),
    ).toHaveLength(4);
    expect(
      edited.preview.document.nodes.filter((node) =>
        node.id.startsWith("table_write."),
      ),
    ).toEqual(
      write.preview.document.nodes.filter((node) =>
        node.id.startsWith("table_write."),
      ),
    );
    expect(
      edited.preview.document.edges.filter((edge) =>
        edge.id.startsWith("table_write."),
      ),
    ).toEqual(
      write.preview.document.edges.filter((edge) =>
        edge.id.startsWith("table_write."),
      ),
    );
    expect(
      edited.generatedResources.map((resource) =>
        resource.kind === "node" ? resource.nodeId : resource.edgeId,
      ),
    ).toEqual(
      read.generatedResources.map((resource) =>
        resource.kind === "node" ? resource.nodeId : resource.edgeId,
      ),
    );
    expect(edited.iamEffects[0]?.actions).toEqual(read.iamEffects[0]?.actions);
    expect(
      edited.preview.document.edges.some(
        (edge) => edge.id === "table_read.edge.connection",
      ),
    ).toBe(true);
    expect(
      edited.preview.document.nodes.find(
        (node) => node.id === "table_read.node.dynamodb-policy",
      )?.semantic.configuration.values,
    ).toMatchObject({
      actions: {
        kind: "string-list",
        value: read.iamEffects[0]?.actions,
      },
    });
  });
});
