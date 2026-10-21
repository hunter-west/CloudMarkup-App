import {
  APPLICATION_GENERATOR_DIGEST,
  APPLICATION_GENERATOR_ID,
  APPLICATION_GENERATOR_VERSION,
  APPLICATION_RUNTIME_DESCRIPTOR,
  APPLICATION_RUNTIME_DIGEST,
  CURRENT_APPLICATION_CATALOG,
  LAMBDA_HANDLER,
  LAMBDA_RUNTIME,
  NODE_RUNTIME_FAMILY,
  NOTES_PATTERN_DIGEST,
  NOTES_PATTERN_ID,
  NOTES_PATTERN_VERSION,
  NOTES_TEMPLATE_DIGEST,
  NOTES_TEMPLATE_ID,
  NOTES_TEMPLATE_VERSION,
  SUPPORTED_RELATIONSHIPS,
  TYPESCRIPT_LANGUAGE_FAMILY,
} from "@cloudmarkup/application-generator";
import {
  applyGraphCommand,
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  applicationContractRecordV1Schema,
  applicationGenerationRequestV1Schema,
  architectureEdgeV1Schema,
  architectureNodeV1Schema,
  normalizeWorkloadBehaviorV2,
  workloadBehaviorV2Schema,
  type ApplicationContractRecordV1,
  type ApplicationGenerationRequestV1,
  type ArchitectureDocumentV3,
  type ServiceConfigurationRecord,
} from "@cloudmarkup/schemas";

export const REPAIR_SEED_EXTENSION_PATH =
  "application/src/functions/repair_seed_handler/extensions/custom.ts";
export const REPAIR_SEED_WORKLOAD_ID = "repair_seed_workload";
const at = "2026-09-12T00:00:00.000Z";
const actor = "repair_seed_author";
const revisionId = "repair_seed_architecture_revision_1";
const solutionRevisionId = "repair_seed_solution_revision_1";
const operationId = "repair_seed_read_note";
const pointId = "repair-seed.extension";
// Synthetic repair preparation uses the installed current catalog.
const catalog = CURRENT_APPLICATION_CATALOG;
const generator = {
  id: APPLICATION_GENERATOR_ID,
  version: APPLICATION_GENERATOR_VERSION,
  digest: APPLICATION_GENERATOR_DIGEST,
};
const runtime = {
  id: APPLICATION_RUNTIME_DESCRIPTOR.id,
  version: APPLICATION_RUNTIME_DESCRIPTOR.version,
  digest: APPLICATION_RUNTIME_DIGEST,
  runtimeFamily: APPLICATION_RUNTIME_DESCRIPTOR.runtimeFamily,
  languageFamily: APPLICATION_RUNTIME_DESCRIPTOR.languageFamily,
  runtime: APPLICATION_RUNTIME_DESCRIPTOR.runtime,
  handler: APPLICATION_RUNTIME_DESCRIPTOR.handler,
  moduleFormat: APPLICATION_RUNTIME_DESCRIPTOR.moduleFormat,
};
const provenance = {
  source: "designed",
  sourceReferenceIds: [],
  recordedAt: at,
  recordedBy: actor,
};

function reference(record: ApplicationContractRecordV1) {
  return {
    contractKind: record.contractKind,
    contractId: record.contractId,
    contractVersion: record.contractVersion,
    digest: getApplicationContractRecordContentHash(record),
  };
}

function ioReference(record: ApplicationContractRecordV1) {
  return {
    contractId: record.contractId,
    contractVersion: record.contractVersion,
    digest: getApplicationContractRecordContentHash(record),
  };
}

function contracts() {
  const entity = applicationContractRecordV1Schema.parse({
    contractKind: "data-entity",
    contractId: "repairseed.contracts.entity",
    contractVersion: "1.0.0",
    displayName: "Synthetic note",
    provenance,
    semanticName: "application.notes.entity",
    storageIntent: "persistent",
    fields: ["noteId", "body"].map((name) => ({
      name,
      fieldType: { kind: "scalar", scalarType: "string" },
      required: true,
      nullable: false,
      classification: "internal",
    })),
    indexes: [
      {
        indexId: "repair_seed_primary",
        name: "primary",
        kind: "primary",
        partitionFields: ["noteId"],
        sortFields: [],
      },
    ],
    supportedOperations: ["read"],
  });
  const auth = applicationContractRecordV1Schema.parse({
    contractKind: "auth",
    contractId: "repair-seed.contracts.auth",
    contractVersion: "1.0.0",
    displayName: "Synthetic note authorization",
    provenance,
    authenticationMethod: "oidc",
    claims: [
      {
        name: "sub",
        source: "identity-token",
        valueType: "string",
        required: true,
        sensitive: false,
      },
    ],
    roles: [
      {
        roleId: "repair_seed_member",
        displayName: "Member",
        claimRequirements: [{ claimName: "sub", match: "present" }],
      },
    ],
  });
  const route = applicationContractRecordV1Schema.parse({
    contractKind: "http-api",
    contractId: "repair-seed.contracts.read-route",
    contractVersion: "1.0.0",
    displayName: "Read synthetic note",
    provenance,
    method: "GET",
    pathTemplate: "/notes/{noteId}",
    request: {
      parameters: [
        {
          name: "noteId",
          location: "path",
          valueType: "string",
          required: true,
          sensitive: false,
        },
        {
          name: "x-correlation-id",
          location: "header",
          valueType: "string",
          required: false,
          sensitive: false,
        },
      ],
    },
    responses: [200, 400, 403, 404].map((statusCode) => ({
      statusCode,
      mediaType: "application/json",
      ...(statusCode === 200 ? { entity: reference(entity) } : {}),
      headers: [
        { name: "x-correlation-id", valueType: "string", required: true },
      ],
      description: "Fixed synthetic read response.",
    })),
    authentication: reference(auth),
  });
  const behavior = applicationContractRecordV1Schema.parse({
    contractKind: "behavior-operation",
    contractId: "repair-seed.contracts.read-operation",
    contractVersion: "1.0.0",
    displayName: "Read synthetic note behavior",
    provenance,
    capability: "application.notes.read",
    input: { kind: "contract-reference", reference: reference(entity) },
    output: { kind: "contract-reference", reference: reference(entity) },
    authorization: {
      authContract: reference(auth),
      permittedRoleIds: ["repair_seed_member"],
    },
    failureOutcomes: [
      "application.authorization",
      "application.validation",
      "application.not-found",
    ].map((category) => ({
      category,
      retryable: false,
      description: "Fixed synthetic read failure.",
    })),
  });
  const tests = (["unit", "contract"] as const).map((level) =>
    applicationContractRecordV1Schema.parse({
      contractKind: "test-case",
      contractId: `repair-seed.contracts.read-${level}-test`,
      contractVersion: "1.0.0",
      displayName: `Synthetic ${level} read contract`,
      provenance,
      level,
      target: reference(behavior),
      fixtureReferences: [],
      preconditions:
        level === "unit"
          ? [{ kind: "contract-available", contract: reference(entity) }]
          : [
              { kind: "contract-available", contract: reference(route) },
              {
                kind: "authenticated-role",
                authContract: reference(auth),
                roleId: "repair_seed_member",
              },
            ],
      expectations: [
        {
          expectationId: `repair_seed_${level}_validation`,
          kind: "error-category",
          category: "application.validation",
        },
        ...(level === "contract"
          ? [
              {
                expectationId: "repair_seed_contract_status",
                kind: "http-status",
                statusCode: 400,
              },
            ]
          : []),
      ],
    }),
  );
  return { entity, auth, route, behavior, tests };
}

function node(
  id: string,
  key: string,
  type: string,
  values: Record<
    string,
    ServiceConfigurationRecord["values"][keyof ServiceConfigurationRecord["values"]]
  >,
  x: number,
) {
  return architectureNodeV1Schema.parse({
    id,
    semantic: {
      deploymentKey: key,
      serviceType: type,
      resourceType: type,
      configuration: {
        schemaId: `${type}.config`,
        schemaVersion: "1.0.0",
        values,
      },
      lifecycle: { ownership: "user", origin: "user" },
    },
    presentation: { label: key, position: { x, y: 0 } },
  });
}
function edge(
  id: string,
  sourceId: string,
  sourcePort: string,
  targetId: string,
  targetPort: string,
  relationshipType: string,
  schemaId: string,
  values: Record<
    string,
    ServiceConfigurationRecord["values"][keyof ServiceConfigurationRecord["values"]]
  >,
) {
  return architectureEdgeV1Schema.parse({
    id,
    semantic: {
      source: { nodeId: sourceId, port: sourcePort },
      target: { nodeId: targetId, port: targetPort },
      relationshipType,
      configuration: { schemaId, schemaVersion: "1.0.0", values },
      lifecycle: { ownership: "user", origin: "user" },
    },
  });
}

/** Fixed host-authored graph. Every mutation uses the ordinary atomic command engine. */
function architecture(): ArchitectureDocumentV3 {
  const nestedRevision = {
    revisionId,
    revisionNumber: 1,
    createdAt: at,
    createdBy: actor,
  };
  const empty = parseArchitectureDocument({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 3,
    documentId: "repair_seed_document",
    architectureId: "repair_seed_architecture",
    revision: { ...nestedRevision, sourceDraftId: "repair_seed_draft" },
    provider: { id: "aws.cloudmarkup", region: "us-east-1" },
    catalog,
    compilerCompatibility: {
      inputContractVersion: 1,
      minimumCompilerVersion: "1.0.0",
      maximumCompilerVersionExclusive: "2.0.0",
    },
    metadata: {
      source: "template",
      serialization: {
        mediaType: "application/json",
        encoding: "utf-8",
        canonicalization: "cloudmarkup.canonical-json.v1",
      },
    },
    nodes: [],
    edges: [],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
    applicationContracts: {
      kind: "cloudmarkup.application-contracts",
      schemaVersion: 1,
      contractSetId: "repair_seed_contracts",
      documentId: "repair_seed_document",
      revision: nestedRevision,
      contracts: [],
    },
    externalResources: {
      kind: "cloudmarkup.external-resource-reference-document",
      schemaVersion: 1,
      documentId: "repair_seed_document",
      architectureId: "repair_seed_architecture",
      revision: nestedRevision,
      resources: [],
    },
    workloadBehavior: { contractVersion: 2, workloads: [] },
  });
  const c = contracts();
  const nodes = [
    node(
      "repair_seed_api",
      "repair_seed_api",
      "aws.apigateway.http-api",
      { jwtAuthorizationRequired: { kind: "boolean", value: true } },
      0,
    ),
    node(
      "repair_seed_function",
      "repair_seed_handler",
      "aws.lambda.function",
      {
        runtime: { kind: "string", value: LAMBDA_RUNTIME },
        handler: { kind: "string", value: LAMBDA_HANDLER },
      },
      200,
    ),
    node(
      "repair_seed_table",
      "repair_seed_table",
      "aws.dynamodb.table",
      {
        partitionKeyName: { kind: "string", value: "noteId" },
        partitionKeyType: { kind: "string", value: "S" },
      },
      400,
    ),
    node(
      "repair_seed_logs",
      "repair_seed_logs",
      "aws.cloudwatch.log-group",
      {},
      600,
    ),
  ];
  const edges = [
    edge(
      "repair_seed_api_read",
      "repair_seed_api",
      "aws.apigateway.route",
      "repair_seed_function",
      "aws.lambda.invocation",
      SUPPORTED_RELATIONSHIPS.apiInvokesLambda,
      "aws.apigateway.lambda-integration.connection",
      {
        routeKey: { kind: "string", value: "GET /notes/{noteId}" },
        payloadFormatVersion: { kind: "string", value: "2.0" },
      },
    ),
    edge(
      "repair_seed_read_table",
      "repair_seed_function",
      "aws.lambda.data-read",
      "repair_seed_table",
      "aws.dynamodb.data",
      SUPPORTED_RELATIONSHIPS.lambdaReadsDynamoDb,
      "aws.lambda.dynamodb-read.connection",
      { consistentRead: { kind: "boolean", value: false } },
    ),
    edge(
      "repair_seed_write_logs",
      "repair_seed_function",
      "aws.lambda.logs",
      "repair_seed_logs",
      "aws.cloudwatch.logs",
      SUPPORTED_RELATIONSHIPS.lambdaWritesLogs,
      "aws.lambda.log-group.connection",
      {},
    ),
  ];
  const workload = {
    id: REPAIR_SEED_WORKLOAD_ID,
    owningNodeId: "repair_seed_function",
    implementation: {
      mode: "generated-starter",
      runtimeFamily: NODE_RUNTIME_FAMILY,
      handler: LAMBDA_HANDLER,
      sourceOwnership: "cloudmarkup",
    },
    operations: [
      {
        id: operationId,
        capability: "application.notes.read",
        inputContract: {
          kind: "contract-reference",
          reference: ioReference(c.entity),
        },
        outputContract: {
          kind: "contract-reference",
          reference: ioReference(c.entity),
        },
      },
    ],
    behaviorContracts: [reference(c.behavior)],
    triggers: [
      {
        id: "repair_seed_read_trigger",
        edgeId: "repair_seed_api_read",
        targetOperationId: operationId,
      },
    ],
    downstreamActions: [
      {
        id: "repair_seed_read_action",
        edgeId: "repair_seed_read_table",
        sourceOperationId: operationId,
      },
    ],
    environment: [
      {
        id: "repair_seed_table_environment",
        name: "NOTES_TABLE_NAME",
        value: {
          kind: "node-attribute-reference",
          nodeId: "repair_seed_table",
          attribute: "aws.dynamodb.table.name",
        },
      },
    ],
    errorBehavior: { mode: "fail-invocation" },
    executionAssumptions: {
      timeout: { kind: "duration", milliseconds: 10000 },
      retry: { kind: "none" },
    },
    triggerDispatch: { mode: "single" },
    unresolvedRequirementIds: [],
    languageFamily: TYPESCRIPT_LANGUAGE_FAMILY,
    entrypoints: [
      {
        entrypointId: "repair_seed_read_entrypoint",
        kind: "request-handler",
        operationId,
        handler: LAMBDA_HANDLER,
      },
    ],
    httpRoutes: [
      {
        routeId: "repair_seed_read_route",
        method: "GET",
        pathTemplate: "/notes/{noteId}",
        operationId,
        triggerEdgeId: "repair_seed_api_read",
        contract: reference(c.route),
      },
    ],
    eventBindings: [],
    schedules: [],
    dataBindings: [
      {
        bindingId: "repair_seed_read_data",
        operationId,
        entity: reference(c.entity),
        dataOperation: "read",
        edgeId: "repair_seed_read_table",
      },
    ],
    authorization: [
      {
        bindingId: "repair_seed_read_authorization",
        authContract: reference(c.auth),
        operationIds: [operationId],
        permittedRoleIds: ["repair_seed_member"],
        deniedBehavior: "reject",
      },
    ],
    idempotency: [
      {
        policyId: "repair_seed_read_idempotency",
        mode: "not-required",
        operationIds: [operationId],
      },
    ],
    observability: { signals: ["logs"], healthChecks: [], smokeTests: [] },
    tests: c.tests.map((test) => {
      if (test.contractKind !== "test-case")
        throw Error("Fixed test contract unavailable.");
      return {
        bindingId: `repair_seed_${test.level}_test`,
        level: test.level,
        testCase: reference(test),
        requiredForCoverage: true,
      };
    }),
    sourceOwnership: [
      {
        declarationId: "repair_seed_extension_ownership",
        path: REPAIR_SEED_EXTENSION_PATH,
        pathKind: "file",
        ownership: "user-owned",
        ownerId: "repair-seed.owner",
        regeneration: "never",
        conflictBehavior: "preserve-user-content",
        semanticDiff: { strategy: "structured-language" },
      },
    ],
    extensionPoints: [
      {
        extensionPointId: pointId,
        path: REPAIR_SEED_EXTENSION_PATH,
        kind: "module",
        permittedOwnership: ["user-owned", "approved-extension"],
        conflictBehavior: "require-reviewed-resolution",
      },
    ],
    extensions: [],
    implementationRequirements: [],
    compatibility: {
      applicationGenerators: [
        {
          generatorId: APPLICATION_GENERATOR_ID,
          minimumVersion: APPLICATION_GENERATOR_VERSION,
          templateId: NOTES_TEMPLATE_ID,
          templateVersion: NOTES_TEMPLATE_VERSION,
          supportedModes: ["generated-starter"],
        },
      ],
      modelGateways: [],
    },
    provenance: { source: "manual", recordedAt: at, recordedBy: actor },
  };
  const target = {
    documentId: empty.documentId,
    architectureId: empty.architectureId,
    revisionId,
  };
  const envelope = (name: string) => ({
    schemaVersion: 1,
    commandId: `repair_seed_${name}`,
    inverseCommandId: `repair_seed_${name}_inverse`,
    origin: "user",
    target,
  });
  return applyGraphCommand(empty, {
    ...envelope("batch"),
    kind: "batch",
    commands: [
      ...nodes.map((entry, index) => ({
        ...envelope(`node_${String(index)}`),
        kind: "add-node",
        node: entry,
      })),
      ...edges.map((entry, index) => ({
        ...envelope(`edge_${String(index)}`),
        kind: "add-edge",
        edge: entry,
      })),
      {
        ...envelope("behavior"),
        kind: "replace-workload-and-application-contracts",
        expectedWorkloadBehavior: empty.workloadBehavior,
        workloadBehavior: normalizeWorkloadBehaviorV2(
          workloadBehaviorV2Schema.parse({
            contractVersion: 2,
            workloads: [workload],
          }),
        ),
        expectedApplicationContracts: empty.applicationContracts,
        applicationContracts: {
          ...empty.applicationContracts,
          contracts: [c.entity, c.auth, c.route, c.behavior, ...c.tests],
        },
      },
    ],
  }).document;
}

/** Fixed candidate projection matching the Go normalizer structure. Target ready
 * is a proposed valid-input projection, not an observed no-error result. Actual
 * stdin normalization parity is required before using this source as evidence. */
export function createRepairSeedGenerationRequestV1(): ApplicationGenerationRequestV1 {
  const document = architecture();
  const workloadBehavior = normalizeWorkloadBehaviorV2(
    document.workloadBehavior,
  );
  const workload = workloadBehavior.workloads[0];
  if (workload?.implementation.mode !== "generated-starter")
    throw Error("Fixed seed workload unavailable.");
  const contentHash = getArchitectureDocumentContentHash(document);
  const documentHash = getArchitectureDocumentCanonicalHash(document);
  const visualHash = getArchitectureDocumentVisualHash(document);
  const workloadHash = getWorkloadBehaviorContentHash(
    document.workloadBehavior,
  );
  const key = (id: string) => {
    const found = document.nodes.find((entry) => entry.id === id)?.semantic
      .deploymentKey;
    if (found === undefined) throw Error("Fixed normalized node unavailable.");
    return found;
  };
  const notApplicable = {
    state: "not-applicable",
    reason:
      "Fixed host-synthetic source construction has no execution or observed tool evidence.",
  };
  const solutionRevision = {
    kind: "cloudmarkup.solution-revision-manifest",
    contractVersion: 1,
    solutionRevisionId,
    createdAt: at,
    createdBy: actor,
    intent: notApplicable,
    architecture: {
      documentKind: "cloudmarkup.architecture-document",
      schemaVersion: 3,
      revisionId,
      contentHash,
      documentHash,
      visualHash,
    },
    workload: { contractVersion: 2, contentHash: workloadHash },
    contracts: {
      contractVersion: 1,
      contentHash: getApplicationContractsContentHash(
        document.applicationContracts,
      ),
      recordHashes: document.applicationContracts.contracts
        .map(getApplicationContractRecordContentHash)
        .sort(),
    },
    externalResources: {
      contractVersion: 1,
      contentHash: getExternalResourceReferenceContentHash(
        document.externalResources,
      ),
    },
    assumptions: [],
    unresolvedDecisionIds: [],
    repositoryObservations: [],
    issueIdsAtFreeze: [],
    evidenceIdsAtFreeze: [],
    aiExtensionIds: [],
    sourceOwnership: [],
    generationCoverage: {
      contractVersion: 1,
      solutionRevisionId,
      state: "infrastructure-only",
      missingRequirements: [
        "deterministic-application-generation",
        "application-build-and-tests",
        "application-security-checks",
      ],
      evidence: [],
      workloads: [],
    },
    versions: {
      catalog,
      applicationGenerator: { state: "pinned", tool: generator },
      compiler: notApplicable,
      diagramRenderer: notApplicable,
      importer: notApplicable,
      modelPrompt: notApplicable,
      policy: [],
    },
  };
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const resources = document.nodes
    .map(({ id, semantic }) => ({
      id,
      targetKey: key(id),
      deploymentKey: semantic.deploymentKey,
      serviceType: semantic.serviceType,
      resourceType: semantic.resourceType,
      configuration: semantic.configuration,
      lifecycle: semantic.lifecycle,
      workloadIds: id === workload.owningNodeId ? [workload.id] : [],
    }))
    .sort((a, b) =>
      compare(a.targetKey + "\u0000" + a.id, b.targetKey + "\u0000" + b.id),
    );
  const connections = document.edges.map(({ id, semantic }) => ({
    id,
    source: { ...semantic.source, targetKey: key(semantic.source.nodeId) },
    target: { ...semantic.target, targetKey: key(semantic.target.nodeId) },
    relationshipType: semantic.relationshipType,
    configuration: semantic.configuration,
    lifecycle: semantic.lifecycle,
  }));
  const connectionKey = (connection: (typeof connections)[number]) =>
    [
      connection.source.targetKey,
      connection.source.port,
      connection.target.targetKey,
      connection.target.port,
      connection.relationshipType,
      connection.id,
    ].join("\u0000");
  connections.sort((a, b) => compare(connectionKey(a), connectionKey(b)));
  const connectionFor = (edgeId: string) => {
    const connection = connections.find((entry) => entry.id === edgeId);
    if (connection === undefined)
      throw Error("Fixed normalized connection unavailable.");
    return connection;
  };
  const normalizedSolution = {
    contractVersion: 1,
    provenance: {
      architectureDocumentId: document.documentId,
      architectureId: document.architectureId,
      architectureRevisionId: revisionId,
      architectureContentHash: contentHash,
      architectureDocumentHash: documentHash,
      architectureVisualHash: visualHash,
      workloadContentHash: workloadHash,
      solutionRevisionId,
      catalog,
      providerId: document.provider.id,
      region: document.provider.region,
    },
    resources,
    connections,
    variables: [],
    outputs: [],
    policyAttachments: [],
    externalResources: [],
    target: {
      contractVersion: "1.0.0",
      reasons: [],
      renderingAvailable: true,
      state: "ready",
      target: "terraform",
    },
    workloads: [
      {
        id: workload.id,
        owningResource: {
          nodeId: workload.owningNodeId,
          targetKey: key(workload.owningNodeId),
        },
        implementationMode: workload.implementation.mode,
        runtimeFamily: workload.implementation.runtimeFamily,
        languageFamily: workload.languageFamily,
        handler: workload.implementation.handler,
        sourceOwner: workload.implementation.sourceOwnership,
        operations: workload.operations.map((operation) => ({
          id: operation.id,
          capability: operation.capability,
          ...(operation.inputContract.kind === "contract-reference"
            ? { inputContract: operation.inputContract.reference }
            : {}),
          ...(operation.outputContract.kind === "contract-reference"
            ? { outputContract: operation.outputContract.reference }
            : {}),
        })),
        triggers: workload.triggers.map((trigger) => ({
          id: trigger.id,
          edgeId: trigger.edgeId,
          operationId: trigger.targetOperationId,
          kind: "trigger",
          connection: connectionFor(trigger.edgeId),
        })),
        downstreamActions: workload.downstreamActions.map((action) => ({
          id: action.id,
          edgeId: action.edgeId,
          operationId: action.sourceOperationId,
          kind: "downstream-action",
          connection: connectionFor(action.edgeId),
        })),
        environment: workload.environment.map((binding) => {
          if (binding.value.kind !== "node-attribute-reference")
            throw Error("Fixed resource binding unavailable.");
          return {
            id: binding.id,
            name: binding.name,
            kind: binding.value.kind,
            resource: {
              nodeId: binding.value.nodeId,
              attribute: binding.value.attribute,
              targetKey: key(binding.value.nodeId),
            },
          };
        }),
        artifactInputs: [],
        artifactOutputs: [],
        generationCoverage: "custom-implementation-required",
        generatorReadiness: {
          state: "compatible-interface-only",
          reasons: ["APPLICATION_GENERATION_SEPARATE_BOUNDARY_AVAILABLE"],
          generator,
          templateId: NOTES_TEMPLATE_ID,
          templateVersion: NOTES_TEMPLATE_VERSION,
        },
        sourceOwnership: workload.sourceOwnership.map(
          ({ semanticDiff, ...ownership }) => ({
            ...ownership,
            semanticDiff: semanticDiff.strategy,
          }),
        ),
        extensionPoints: workload.extensionPoints.map(
          ({ extensionPointId, ...point }) => ({
            id: extensionPointId,
            ...point,
          }),
        ),
        targetReadiness: "application-artifact-evidence-incomplete",
        specification: workload,
      },
    ],
  };
  return applicationGenerationRequestV1Schema.parse({
    contractVersion: 1,
    architectureDocument: document,
    workloadBehavior,
    solutionRevision,
    normalizedSolution,
    generator,
    template: {
      id: NOTES_TEMPLATE_ID,
      version: NOTES_TEMPLATE_VERSION,
      digest: NOTES_TEMPLATE_DIGEST,
    },
    pattern: {
      id: NOTES_PATTERN_ID,
      version: NOTES_PATTERN_VERSION,
      digest: NOTES_PATTERN_DIGEST,
    },
    runtime,
    existingFiles: [],
  });
}
