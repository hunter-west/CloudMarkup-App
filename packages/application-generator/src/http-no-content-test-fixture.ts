import {
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getWorkloadBehaviorContentHash,
  getExternalResourceReferenceContentHash,
} from "@cloudmarkup/domain";
import {
  applicationContractRecordV1Schema,
  applicationGenerationRequestV1Schema,
  architectureDocumentV3Schema,
  type ApplicationContractRecordV1,
  type ApplicationGenerationRequestV1,
  type ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";
import { sha256Digest } from "./constants.js";
import {
  HTTP_NO_CONTENT_CAPABILITY,
  HTTP_NO_CONTENT_RELEASE_V1,
} from "./http-no-content-release.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw Error("Synthetic fixture input is missing.");
  return value;
}
function reference(record: ApplicationContractRecordV1) {
  return {
    contractKind: record.contractKind,
    contractId: record.contractId,
    contractVersion: record.contractVersion,
    digest: getApplicationContractRecordContentHash(record),
  };
}

/** Synthetic normalization for unit tests only; never a native compiler/build receipt. */
export function rebindHttpNoContentFixture(
  base: ApplicationGenerationRequestV1,
  architecture: ArchitectureDocumentV3,
): ApplicationGenerationRequestV1 {
  const workload = required(architecture.workloadBehavior.workloads[0]);
  const normalizedWorkload = required(base.normalizedSolution.workloads[0]);
  const target = (id: string) =>
    required(architecture.nodes.find((node) => node.id === id)).semantic
      .deploymentKey;
  const configuration = (
    value: ArchitectureDocumentV3["nodes"][number]["semantic"]["configuration"],
  ) => ({
    schemaId: value.schemaId,
    schemaVersion: value.schemaVersion,
    values: value.values,
  });
  const architectureContentHash =
    getArchitectureDocumentContentHash(architecture);
  const architectureDocumentHash =
    getArchitectureDocumentCanonicalHash(architecture);
  const architectureVisualHash =
    getArchitectureDocumentVisualHash(architecture);
  const workloadContentHash = getWorkloadBehaviorContentHash(
    architecture.workloadBehavior,
  );
  return applicationGenerationRequestV1Schema.parse({
    ...base,
    architectureDocument: architecture,
    workloadBehavior: architecture.workloadBehavior,
    ...HTTP_NO_CONTENT_RELEASE_V1,
    solutionRevision: {
      ...base.solutionRevision,
      architecture: {
        ...base.solutionRevision.architecture,
        revisionId: architecture.revision.revisionId,
        contentHash: architectureContentHash,
        documentHash: architectureDocumentHash,
        visualHash: architectureVisualHash,
      },
      workload: { contractVersion: 2, contentHash: workloadContentHash },
      externalResources: {
        contractVersion: 1,
        contentHash: getExternalResourceReferenceContentHash(
          architecture.externalResources,
        ),
      },
      contracts: {
        contractVersion: 1,
        contentHash: getApplicationContractsContentHash(
          architecture.applicationContracts,
        ),
        recordHashes: architecture.applicationContracts.contracts
          .map(getApplicationContractRecordContentHash)
          .sort(),
      },
      versions: {
        ...base.solutionRevision.versions,
        applicationGenerator: {
          state: "pinned",
          tool: HTTP_NO_CONTENT_RELEASE_V1.generator,
        },
      },
    },
    normalizedSolution: {
      ...base.normalizedSolution,
      provenance: {
        ...base.normalizedSolution.provenance,
        architectureDocumentId: architecture.documentId,
        architectureId: architecture.architectureId,
        architectureRevisionId: architecture.revision.revisionId,
        catalog: architecture.catalog,
        providerId: architecture.provider.id,
        region: architecture.provider.region,
        architectureContentHash,
        architectureDocumentHash,
        architectureVisualHash,
        workloadContentHash,
      },
      resources: architecture.nodes.map((node) => ({
        id: node.id,
        targetKey: target(node.id),
        deploymentKey: node.semantic.deploymentKey,
        serviceType: node.semantic.serviceType,
        resourceType: node.semantic.resourceType,
        configuration: configuration(node.semantic.configuration),
        lifecycle: node.semantic.lifecycle,
        ...(node.semantic.parent === undefined
          ? {}
          : {
              parent: {
                nodeId: node.semantic.parent.nodeId,
                targetKey: target(node.semantic.parent.nodeId),
                relationshipType: node.semantic.parent.relationshipType,
              },
            }),
        workloadIds: node.id === workload.owningNodeId ? [workload.id] : [],
      })),
      connections: architecture.edges.map((edge) => ({
        id: edge.id,
        source: {
          ...edge.semantic.source,
          targetKey: target(edge.semantic.source.nodeId),
        },
        target: {
          ...edge.semantic.target,
          targetKey: target(edge.semantic.target.nodeId),
        },
        relationshipType: edge.semantic.relationshipType,
        configuration: configuration(edge.semantic.configuration),
        lifecycle: edge.semantic.lifecycle,
      })),
      workloads: [
        {
          ...normalizedWorkload,
          owningResource: {
            nodeId: workload.owningNodeId,
            targetKey: target(workload.owningNodeId),
          },
          specification: workload,
          operations: workload.operations.map((operation) => ({
            id: operation.id,
            capability: operation.capability,
          })),
          triggers: workload.triggers.map((trigger) => ({
            id: trigger.id,
            edgeId: trigger.edgeId,
            operationId: trigger.targetOperationId,
            kind: "architecture-edge",
          })),
          downstreamActions: [],
          environment: [],
          sourceOwnership: [],
          extensionPoints: [],
          generatorReadiness: {
            state: "ready",
            reasons: [],
            generator: HTTP_NO_CONTENT_RELEASE_V1.generator,
            templateId: HTTP_NO_CONTENT_RELEASE_V1.template.id,
            templateVersion: HTTP_NO_CONTENT_RELEASE_V1.template.version,
          },
        },
      ],
    },
  });
}
export function createHttpNoContentFixtureFromBase(
  base: ApplicationGenerationRequestV1,
): ApplicationGenerationRequestV1 {
  const architecture = base.architectureDocument;
  const prior = required(architecture.workloadBehavior.workloads[0]);
  const auth = required(
    architecture.applicationContracts.contracts.find(
      (contract) => contract.contractKind === "auth",
    ),
  );
  const oldRoute = required(
    architecture.applicationContracts.contracts.find(
      (contract) => contract.contractKind === "http-api",
    ),
  );
  const oldBehavior = required(
    architecture.applicationContracts.contracts.find(
      (contract) => contract.contractKind === "behavior-operation",
    ),
  );
  const oldTest = required(
    architecture.applicationContracts.contracts.find(
      (contract) => contract.contractKind === "test-case",
    ),
  );
  const route = applicationContractRecordV1Schema.parse({
    ...oldRoute,
    method: "GET",
    pathTemplate: "/status",
    request: { parameters: [] },
    responses: [204, 400, 401, 403, 404].map((statusCode) => ({
      statusCode,
      headers: [],
      description: "Empty response.",
    })),
    authentication: reference(auth),
  });
  const behavior = applicationContractRecordV1Schema.parse({
    ...oldBehavior,
    capability: HTTP_NO_CONTENT_CAPABILITY,
    input: { kind: "none" },
    output: { kind: "none" },
    failureOutcomes: [
      "application.authorization",
      "application.not-found",
      "application.validation",
    ].map((category) => ({
      category,
      retryable: false,
      description: "Declared failure.",
    })),
  });
  const tests = (["unit", "contract"] as const).map((level) =>
    applicationContractRecordV1Schema.parse({
      ...oldTest,
      contractId: `contracts.http.no-content-${level}`,
      level,
      target: reference(behavior),
      preconditions:
        level === "unit"
          ? []
          : [
              { kind: "contract-available", contract: reference(route) },
              {
                kind: "authenticated-role",
                authContract: reference(auth),
                roleId: "role_member",
              },
            ],
      expectations: [
        level === "unit"
          ? {
              expectationId: "expect_authorization",
              kind: "error-category",
              category: "application.authorization",
            }
          : {
              expectationId: "expect_no_content",
              kind: "http-status",
              statusCode: 204,
            },
      ],
    }),
  );
  const workload = {
    ...prior,
    implementation: {
      ...prior.implementation,
      supportedPattern: {
        patternId: HTTP_NO_CONTENT_RELEASE_V1.pattern.id,
        patternVersion: HTTP_NO_CONTENT_RELEASE_V1.pattern.version,
        digest: HTTP_NO_CONTENT_RELEASE_V1.pattern.digest,
      },
    },
    provenance: {
      source: "deterministic-generator",
      generatorId: HTTP_NO_CONTENT_RELEASE_V1.generator.id,
      generatorVersion: HTTP_NO_CONTENT_RELEASE_V1.generator.version,
      inputDigest: sha256Digest(
        "synthetic explicit authenticated GET /status with empty HTTP 204",
      ),
    },
    operations: prior.operations.map((operation) => ({
      ...operation,
      capability: HTTP_NO_CONTENT_CAPABILITY,
      inputContract: { kind: "none" },
      outputContract: { kind: "none" },
    })),
    behaviorContracts: [reference(behavior)],
    httpRoutes: prior.httpRoutes.map((binding) => ({
      ...binding,
      method: "GET",
      pathTemplate: "/status",
      contract: reference(route),
    })),
    dataBindings: [],
    downstreamActions: [],
    environment: [],
    sourceOwnership: [],
    extensionPoints: [],
    tests: tests.map((test, index) => ({
      bindingId: `test_no_content_${String(index)}`,
      level: index === 0 ? "unit" : "contract",
      testCase: reference(test),
      requiredForCoverage: true,
    })),
    compatibility: {
      ...prior.compatibility,
      applicationGenerators: [
        {
          generatorId: HTTP_NO_CONTENT_RELEASE_V1.generator.id,
          minimumVersion: HTTP_NO_CONTENT_RELEASE_V1.generator.version,
          templateId: HTTP_NO_CONTENT_RELEASE_V1.template.id,
          templateVersion: HTTP_NO_CONTENT_RELEASE_V1.template.version,
          supportedModes: ["complete-supported-pattern"],
        },
      ],
    },
  };
  const api = required(
    architecture.nodes.find(
      (node) => node.semantic.resourceType === "aws.apigateway.http-api",
    ),
  );
  const integration = required(
    architecture.edges.find((edge) => edge.semantic.source.nodeId === api.id),
  );
  const nodes = architecture.nodes
    .filter((node) => node.semantic.resourceType !== "aws.dynamodb.table")
    .map((node) =>
      node.id === api.id
        ? {
            ...node,
            semantic: {
              ...node.semantic,
              configuration: {
                ...node.semantic.configuration,
                values: {
                  jwtAuthorizationRequired: { kind: "boolean", value: true },
                  corsEnabled: { kind: "boolean", value: false },
                },
              },
            },
          }
        : node,
    );
  const providers = [
    {
      id: "node_auth_pool",
      key: "auth_pool",
      resourceType: "aws.cognito.user-pool",
      relationship: "aws.cognito.provides-jwt-issuer",
      schema: "aws.cognito.jwt-issuer.connection",
      values: {
        identitySource: {
          kind: "string",
          value: "$request.header.Authorization",
        },
        authorizerName: { kind: "string", value: "httpJwt" },
      },
    },
    {
      id: "node_auth_client",
      key: "auth_client",
      resourceType: "aws.cognito.user-pool-client",
      relationship: "aws.cognito.provides-jwt-audience",
      schema: "aws.cognito.jwt-audience.connection",
      values: {},
    },
  ];
  const edges = architecture.edges
    .filter((edge) => !edge.semantic.relationshipType.includes("dynamodb"))
    .map((edge) =>
      edge.id === integration.id
        ? {
            ...edge,
            semantic: {
              ...edge.semantic,
              configuration: {
                ...edge.semantic.configuration,
                values: {
                  ...edge.semantic.configuration.values,
                  routeKey: { kind: "string", value: "GET /status" },
                },
              },
            },
          }
        : edge,
    );
  const document = architectureDocumentV3Schema.parse({
    ...architecture,
    nodes: [
      ...nodes,
      ...providers.map((provider) => ({
        ...api,
        id: provider.id,
        semantic: {
          ...api.semantic,
          deploymentKey: provider.key,
          serviceType: "aws.cognito",
          resourceType: provider.resourceType,
          configuration: { ...api.semantic.configuration, values: {} },
        },
      })),
    ],
    edges: [
      ...edges,
      ...providers.map((provider) => ({
        ...integration,
        id: `edge_${provider.key}_api`,
        semantic: {
          ...integration.semantic,
          source: { ...integration.semantic.source, nodeId: provider.id },
          target: { ...integration.semantic.target, nodeId: api.id },
          relationshipType: provider.relationship,
          configuration: {
            schemaId: provider.schema,
            schemaVersion: "1.0.0",
            values: provider.values,
          },
        },
      })),
    ],
    applicationContracts: {
      ...architecture.applicationContracts,
      contracts: [auth, route, behavior, ...tests],
    },
    workloadBehavior: { contractVersion: 2, workloads: [workload] },
  });
  return rebindHttpNoContentFixture(base, document);
}
