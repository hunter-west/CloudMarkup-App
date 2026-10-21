import {
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";
import {
  applicationContractRecordV1Schema,
  applicationGenerationRequestV1Schema,
  architectureDocumentV3Schema,
  type ApplicationContractRecordV1,
  type ApplicationGenerationRequestV1,
  type ExistingApplicationFileV1,
} from "@cloudmarkup/schemas";
import { CURRENT_APPLICATION_CATALOG } from "./constants.js";
import { createHttpNoContentFixtureFromBase } from "./http-no-content-test-fixture.js";
import { sourceDescriptor } from "./source-emitter.js";

import {
  APPLICATION_GENERATOR_ID,
  APPLICATION_GENERATOR_VERSION,
  APPLICATION_RUNTIME_DIGEST,
  APPLICATION_RUNTIME_ID,
  APPLICATION_RUNTIME_VERSION,
  EVENT_APPLICATION_GENERATOR_DIGEST,
  EVENT_APPLICATION_GENERATOR_ID,
  EVENT_APPLICATION_GENERATOR_VERSION,
  EVENT_APPLICATION_PATTERN_DIGEST,
  EVENT_APPLICATION_PATTERN_ID,
  EVENT_APPLICATION_PATTERN_VERSION,
  EVENT_APPLICATION_TEMPLATE_DIGEST,
  EVENT_APPLICATION_TEMPLATE_ID,
  EVENT_APPLICATION_TEMPLATE_VERSION,
  EVENT_TRIGGER_DISPATCHER_ID,
  EVENT_TRIGGER_DISPATCHER_VERSION,
  LAMBDA_HANDLER,
  LAMBDA_RUNTIME,
  NODE_RUNTIME_FAMILY,
  SUPPORTED_EVENT_RELATIONSHIPS,
  SUPPORTED_RELATIONSHIPS,
  TYPESCRIPT_LANGUAGE_FAMILY,
  sha256Digest,
} from "./constants.js";

export type FixtureMode =
  | "infrastructure-only"
  | "user-provided"
  | "generated-starter"
  | "complete-supported-pattern"
  | "ai-assisted-custom"
  | "external-artifact";

export type FixtureOperation = "create" | "read" | "update" | "delete" | "list";

type FixtureCatalog = Readonly<{
  id: string;
  version: string;
  digest: string;
}>;

export interface NotesRequestOptions {
  readonly identifierSafeGenerator?: boolean;
  readonly entityContractId?: string;
  readonly catalog?: FixtureCatalog;
  readonly mode?: FixtureMode;
  readonly operations?: readonly FixtureOperation[];
  readonly allowEmptyOperations?: boolean;
  readonly behaviorFailureMismatchFor?: FixtureOperation;
  readonly behaviorInputMismatchFor?: FixtureOperation;
  readonly collidingOperationPathKeys?: boolean;
  readonly invalidRouteShapeFor?: FixtureOperation;
  readonly invalidTestTargetFor?: FixtureOperation;
  readonly invalidWorkloadShape?: boolean;
  readonly nonBlockingImplementationRequirement?: boolean;
  readonly normalizedLifecycleTamper?: boolean;
  readonly normalizedTargetKeyTamper?: boolean;
  readonly unsupportedAuthRule?: boolean;
  readonly existingFiles?: readonly ExistingApplicationFileV1[];
  readonly duplicateCompatibility?: boolean;
  readonly incompatibleMultipleInputs?: boolean;
  readonly includeExternalResource?: boolean;
  readonly includeSecretBinding?: boolean;
  readonly maliciousLabels?: boolean;
  readonly missingBehaviorFor?: FixtureOperation;
  readonly reverseCollections?: boolean;
  readonly separateTables?: boolean;
  readonly unresolvedBehavior?: boolean;
  readonly workloadId?: string;
}

const timestamp = "2026-08-17T12:00:00Z";
const solutionRevisionId = "solution_notes_revision_1";
const provenance = {
  source: "designed",
  sourceReferenceIds: ["requirement_notes_api"],
  recordedAt: timestamp,
  recordedBy: "actor_fixture",
} as const;

const targetKeyByNode = {
  node_notes_api: "notes_api",
  node_notes_function: "notes_handler",
  node_notes_table: "notes_table",
  node_notes_archive: "notes_archive",
  node_notes_logs: "notes_logs",
} as const;

function compareUtf16(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function reverseIf<T>(values: readonly T[], reverse: boolean): T[] {
  return reverse ? [...values].reverse() : [...values];
}

function contractReference<
  TKind extends ApplicationContractRecordV1["contractKind"],
>(contract: Extract<ApplicationContractRecordV1, { contractKind: TKind }>) {
  return {
    contractKind: contract.contractKind,
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    digest: getApplicationContractRecordContentHash(contract),
  };
}

function parseContract<
  TKind extends ApplicationContractRecordV1["contractKind"],
>(
  contractKind: TKind,
  value: unknown,
): Extract<ApplicationContractRecordV1, { contractKind: TKind }> {
  const parsed = applicationContractRecordV1Schema.parse(value);
  if (parsed.contractKind !== contractKind) {
    throw new Error("Unexpected contract kind.");
  }
  return parsed as Extract<
    ApplicationContractRecordV1,
    { contractKind: TKind }
  >;
}

function ioReference(contract: ApplicationContractRecordV1) {
  return {
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    digest: getApplicationContractRecordContentHash(contract),
  };
}

function routeShape(operation: FixtureOperation) {
  switch (operation) {
    case "create":
      return { method: "POST", pathTemplate: "/notes", success: 201 } as const;
    case "read":
      return {
        method: "GET",
        pathTemplate: "/notes/{noteId}",
        success: 200,
      } as const;
    case "update":
      return {
        method: "PUT",
        pathTemplate: "/notes/{noteId}",
        success: 200,
      } as const;
    case "delete":
      return {
        method: "DELETE",
        pathTemplate: "/notes/{noteId}",
        success: 204,
      } as const;
    case "list":
      return { method: "GET", pathTemplate: "/notes", success: 200 } as const;
  }
}

function makeContracts(
  operations: readonly FixtureOperation[],
  options: NotesRequestOptions,
) {
  const entity = parseContract("data-entity", {
    contractKind: "data-entity",
    contractId: options.entityContractId ?? "contracts.notes.entity",
    contractVersion: "1.0.0",
    displayName: "Note",
    provenance,
    semanticName: "application.notes.entity",
    storageIntent: "persistent",
    fields: [
      {
        name: "noteId",
        fieldType: { kind: "scalar", scalarType: "string" },
        required: true,
        nullable: false,
        classification: "internal",
      },
      {
        name: "body",
        fieldType: { kind: "scalar", scalarType: "string" },
        required: true,
        nullable: false,
        classification: "confidential",
      },
      {
        name: "tags",
        fieldType: {
          kind: "scalar-list",
          itemType: "string",
          minimumItems: 1,
          maximumItems: 3,
        },
        required: false,
        nullable: false,
        classification: "internal",
      },
    ],
    indexes: [
      {
        indexId: "index_notes_primary",
        name: "primary",
        kind: "primary",
        partitionFields: ["noteId"],
        sortFields: [],
      },
    ],
    supportedOperations: ["create", "read", "update", "delete", "list"],
  });
  const auth = parseContract("auth", {
    contractKind: "auth",
    contractId: "contracts.notes.auth",
    contractVersion: "1.0.0",
    displayName: "Notes authorization",
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
        roleId: "role_member",
        displayName: "Member",
        claimRequirements: [
          options.unsupportedAuthRule
            ? { claimName: "sub", match: "equals", expectedValue: "member" }
            : { claimName: "sub", match: "present" },
        ],
      },
    ],
  });
  const entityRef = contractReference(entity);
  const authRef = contractReference(auth);
  const correlationHeader = {
    name: "x-correlation-id",
    valueType: "string" as const,
    required: true,
  };
  const routes = operations.map((operation) => {
    const shape = routeShape(operation);
    const needsBody = operation === "create" || operation === "update";
    const needsPath =
      operation === "read" || operation === "update" || operation === "delete";
    return parseContract("http-api", {
      contractKind: "http-api",
      contractId: `contracts.notes.${operation}-route`,
      contractVersion: "1.0.0",
      displayName: `${operation} note route`,
      provenance,
      method: shape.method,
      pathTemplate: shape.pathTemplate,
      request: {
        parameters: [
          ...(needsPath
            ? [
                {
                  name: "noteId",
                  location: "path" as const,
                  valueType: "string" as const,
                  required: true,
                  sensitive: false,
                },
              ]
            : []),
          {
            name: "x-correlation-id",
            location: "header" as const,
            valueType: "string" as const,
            required: false,
            sensitive: false,
          },
        ],
        ...(needsBody
          ? {
              body: {
                mediaType: "application/json",
                entity: entityRef,
                required: true,
              },
            }
          : {}),
      },
      responses: [
        {
          statusCode: shape.success,
          ...(operation === "delete"
            ? {}
            : { mediaType: "application/json", entity: entityRef }),
          headers: [correlationHeader],
          description: "The operation succeeded.",
        },
        {
          statusCode: 400,
          mediaType: "application/json",
          headers: [correlationHeader],
          description: "The request was invalid.",
        },
        ...(options.invalidRouteShapeFor === operation
          ? []
          : [
              {
                statusCode: 403,
                mediaType: "application/json" as const,
                headers: [correlationHeader],
                description: "The principal is not authorized.",
              },
            ]),
        ...(operation === "create" || operation === "list"
          ? []
          : [
              {
                statusCode: 404,
                mediaType: "application/json" as const,
                headers: [correlationHeader],
                description: "The note was not found.",
              },
            ]),
      ],
      authentication: authRef,
    });
  });
  const behaviors = operations.map((operation) =>
    parseContract("behavior-operation", {
      contractKind: "behavior-operation" as const,
      contractId: `contracts.notes.${operation}-operation`,
      contractVersion: "1.0.0",
      displayName: `${operation} note behavior`,
      provenance,
      capability: `application.notes.${operation}`,
      input:
        options.behaviorInputMismatchFor === operation ||
        (options.incompatibleMultipleInputs &&
          operations.indexOf(operation) > 0)
          ? ({ kind: "none" } as const)
          : ({ kind: "contract-reference", reference: entityRef } as const),
      output:
        operation === "delete"
          ? ({ kind: "none" } as const)
          : ({ kind: "contract-reference", reference: entityRef } as const),
      authorization: {
        authContract: authRef,
        permittedRoleIds: ["role_member"],
      },
      failureOutcomes: [
        {
          category:
            options.behaviorFailureMismatchFor === operation
              ? "application.validation.failed"
              : "application.authorization",
          retryable: false,
          description: "The authenticated principal is not permitted.",
        },
        ...([
          {
            category: "application.validation",
            retryable: false,
            description: "The request does not satisfy the contract.",
          },
        ] as const),
        ...(operation === "create"
          ? []
          : [
              {
                category: "application.not-found",
                retryable: false,
                description: "The requested note was not found.",
              },
            ]),
      ],
    }),
  );
  const tests = behaviors.flatMap((behavior, index) => {
    const operation = operations[index];
    const route = routes[index];
    if (operation === undefined || route === undefined) {
      throw new Error("A route and behavior are required for every operation.");
    }
    const target =
      options.invalidTestTargetFor === operation
        ? contractReference(route)
        : contractReference(behavior);
    return (["unit", "contract"] as const).map((level) =>
      parseContract("test-case", {
        contractKind: "test-case" as const,
        contractId: `contracts.notes.${operation}-${level}-test`,
        contractVersion: "1.0.0",
        displayName: `${level} ${operation} note test`,
        provenance,
        level,
        target,
        preconditions:
          level === "unit"
            ? [{ kind: "contract-available" as const, contract: entityRef }]
            : [
                {
                  kind: "contract-available" as const,
                  contract: contractReference(route),
                },
                {
                  kind: "authenticated-role" as const,
                  authContract: authRef,
                  roleId: "role_member",
                },
              ],
        fixtureReferences: [],
        expectations:
          level === "unit"
            ? [
                {
                  expectationId: `expect_${operation}_unit_validation`,
                  kind: "error-category" as const,
                  category: "application.validation",
                },
              ]
            : [
                {
                  expectationId: `expect_${operation}_contract_validation`,
                  kind: "error-category" as const,
                  category: "application.validation",
                },
                {
                  expectationId: `expect_${operation}_contract_status`,
                  kind: "http-status" as const,
                  statusCode: 400,
                },
              ],
      }),
    );
  });
  return { entity, auth, routes, behaviors, tests };
}

function implementationFor(mode: FixtureMode, descriptor = sourceDescriptor()) {
  switch (mode) {
    case "infrastructure-only":
      return { mode } as const;
    case "user-provided":
      return {
        mode,
        runtimeFamily: NODE_RUNTIME_FAMILY,
        handler: LAMBDA_HANDLER,
        sourceOwnership: "user",
      } as const;
    case "generated-starter":
      return {
        mode,
        runtimeFamily: NODE_RUNTIME_FAMILY,
        handler: LAMBDA_HANDLER,
        sourceOwnership: "cloudmarkup",
      } as const;
    case "complete-supported-pattern":
      return {
        mode,
        runtimeFamily: NODE_RUNTIME_FAMILY,
        handler: LAMBDA_HANDLER,
        sourceOwnership: "cloudmarkup",
        supportedPattern: {
          patternId: descriptor.pattern.id,
          patternVersion: descriptor.pattern.version,
          digest: descriptor.pattern.digest,
        },
      } as const;
    case "ai-assisted-custom":
      return {
        mode,
        runtimeFamily: NODE_RUNTIME_FAMILY,
        handler: LAMBDA_HANDLER,
        sourceOwnership: "ai-authored",
        extension: {
          extensionId: "extension.notes.custom",
          extensionContractVersion: 1,
          digest: sha256Digest("synthetic reviewed extension"),
          ownership: "ai-authored",
          validationEvidenceIds: ["evidence_parse_static"],
        },
      } as const;
    case "external-artifact":
      return {
        mode,
        runtimeFamily: NODE_RUNTIME_FAMILY,
        handler: LAMBDA_HANDLER,
        sourceOwnership: "external",
        artifact: {
          artifactId: "artifact_notes_external",
          digest: sha256Digest("synthetic external artifact"),
        },
      } as const;
  }
}

function makeNode(
  id: keyof typeof targetKeyByNode,
  deploymentKey: string,
  serviceType: string,
  resourceType: string,
  schemaId: string,
  values: Readonly<Record<string, unknown>>,
  label: string,
  position: { readonly x: number; readonly y: number },
) {
  return {
    id,
    semantic: {
      deploymentKey,
      serviceType,
      resourceType,
      configuration: {
        schemaId,
        schemaVersion:
          schemaId === "aws.iam.role.configuration" ||
          schemaId === "aws.iam.policy-statement.configuration"
            ? "2.0.0"
            : "1.0.0",
        values,
      },
      lifecycle: { ownership: "user", origin: "user" },
    },
    presentation: { label, position },
  };
}

function makeEdge(
  id: string,
  sourceNodeId: keyof typeof targetKeyByNode,
  sourcePort: string,
  targetNodeId: keyof typeof targetKeyByNode,
  targetPort: string,
  relationshipType: string,
  schemaId: string,
  values: Readonly<Record<string, unknown>>,
) {
  return {
    id,
    semantic: {
      source: { nodeId: sourceNodeId, port: sourcePort },
      target: { nodeId: targetNodeId, port: targetPort },
      relationshipType,
      configuration: { schemaId, schemaVersion: "1.0.0", values },
      lifecycle: { ownership: "user", origin: "user" },
    },
  };
}

function normalizedConfiguration(configuration: {
  readonly schemaId: string;
  readonly schemaVersion: string;
  readonly values: Readonly<Record<string, unknown>>;
}) {
  return configuration;
}

/**
 * Builds one strict, fully hash-bound Architecture v3 + Workload v2 + immutable
 * Solution Revision + Go normalized-model v1 request. No label or display text
 * is used as a semantic key.
 */
export function createNotesGenerationRequest(
  options: NotesRequestOptions = {},
): ApplicationGenerationRequestV1 {
  const descriptor = sourceDescriptor(
    APPLICATION_GENERATOR_ID,
    options.identifierSafeGenerator ? "1.1.0" : APPLICATION_GENERATOR_VERSION,
  );
  const catalog = options.catalog ?? CURRENT_APPLICATION_CATALOG;
  const mode = options.mode ?? "complete-supported-pattern";
  const operations = options.operations ?? ["create"];
  const workloadId = options.workloadId ?? "workload_notes_api";
  if (operations.length === 0 && !options.allowEmptyOperations)
    throw new Error("The fixture requires at least one operation.");
  const reverse = options.reverseCollections ?? false;
  const contracts = makeContracts(operations, options);
  const routeByOperation = new Map(
    operations.map((operation, index) => {
      const route = contracts.routes[index];
      if (route === undefined) {
        throw new Error("The fixture requires one route per operation.");
      }
      return [operation, route] as const;
    }),
  );
  const tableFor = (operation: FixtureOperation) =>
    options.separateTables && operation !== operations[0]
      ? "node_notes_archive"
      : "node_notes_table";
  const tableNameFor = (nodeId: string) =>
    nodeId === "node_notes_archive"
      ? "NOTES_ARCHIVE_TABLE_NAME"
      : "NOTES_TABLE_NAME";

  const nodes = [
    makeNode(
      "node_notes_api",
      "notes_api",
      "aws.apigateway",
      "aws.apigateway.http-api",
      "aws.apigateway.http-api.config",
      {},
      options.maliciousLabels
        ? "</script><script>displayOnly()</script>"
        : "Notes API",
      { x: 0, y: 0 },
    ),
    makeNode(
      "node_notes_function",
      "notes_handler",
      "aws.lambda",
      "aws.lambda.function",
      "aws.lambda.function.config",
      {
        runtime: { kind: "string", value: LAMBDA_RUNTIME },
        handler: { kind: "string", value: LAMBDA_HANDLER },
      },
      options.maliciousLabels
        ? "${process.env.SECRET_DO_NOT_READ}"
        : "Notes handler",
      { x: 200, y: 0 },
    ),
    makeNode(
      "node_notes_table",
      "notes_table",
      "aws.dynamodb",
      "aws.dynamodb.table",
      "aws.dynamodb.table.config",
      {
        partitionKeyName: { kind: "string", value: "noteId" },
        partitionKeyType: { kind: "string", value: "S" },
      },
      "Notes table",
      { x: 400, y: 0 },
    ),
    ...(options.separateTables
      ? [
          makeNode(
            "node_notes_archive",
            "notes_archive",
            "aws.dynamodb",
            "aws.dynamodb.table",
            "aws.dynamodb.table.config",
            {
              partitionKeyName: { kind: "string", value: "noteId" },
              partitionKeyType: { kind: "string", value: "S" },
            },
            "Notes archive",
            { x: 400, y: 150 },
          ),
        ]
      : []),
    makeNode(
      "node_notes_logs",
      "notes_logs",
      "aws.cloudwatch",
      "aws.cloudwatch.log-group",
      "aws.cloudwatch.log-group.config",
      {},
      "Notes logs",
      { x: 400, y: 300 },
    ),
  ];

  const operationEdges = operations.flatMap((operation) => {
    const shape = routeShape(operation);
    const tableNodeId = tableFor(operation);
    const dataRelationship =
      operation === "read"
        ? SUPPORTED_RELATIONSHIPS.lambdaReadsDynamoDb
        : SUPPORTED_RELATIONSHIPS.lambdaWritesDynamoDb;
    return [
      makeEdge(
        `edge_api_${operation}`,
        "node_notes_api",
        "aws.apigateway.route",
        "node_notes_function",
        "aws.lambda.invocation",
        SUPPORTED_RELATIONSHIPS.apiInvokesLambda,
        "aws.apigateway.lambda-integration.connection",
        {
          routeKey: {
            kind: "string",
            value: `${shape.method} ${shape.pathTemplate}`,
          },
          payloadFormatVersion: { kind: "string", value: "2.0" },
        },
      ),
      makeEdge(
        `edge_${operation}_table`,
        "node_notes_function",
        operation === "read" ? "aws.lambda.data-read" : "aws.lambda.data-write",
        tableNodeId,
        "aws.dynamodb.data",
        dataRelationship,
        operation === "read"
          ? "aws.lambda.dynamodb-read.connection"
          : "aws.lambda.dynamodb-write.connection",
        operation === "read"
          ? { consistentRead: { kind: "boolean", value: false } }
          : {},
      ),
    ];
  });
  const logEdge = makeEdge(
    "edge_function_logs",
    "node_notes_function",
    "aws.lambda.logs",
    "node_notes_logs",
    "aws.cloudwatch.logs",
    SUPPORTED_RELATIONSHIPS.lambdaWritesLogs,
    "aws.lambda.log-group.connection",
    {},
  );
  const edges = [...operationEdges, logEdge];

  const entityIo = ioReference(contracts.entity);
  const operationId = (operation: FixtureOperation) =>
    options.collidingOperationPathKeys && operation === "read"
      ? "operation:create_note"
      : `operation_${operation}_note`;
  const workloadOperations = operations.map((operation, index) => ({
    id: operationId(operation),
    capability: `application.notes.${operation}`,
    inputContract:
      options.incompatibleMultipleInputs && index > 0
        ? ({ kind: "none" } as const)
        : ({ kind: "contract-reference", reference: entityIo } as const),
    outputContract:
      operation === "delete"
        ? ({ kind: "none" } as const)
        : ({ kind: "contract-reference", reference: entityIo } as const),
  }));
  const environment = [
    ...[...new Set(operations.map(tableFor))].map((tableNodeId, index) => ({
      id: `environment_table_${String(index + 1)}`,
      name: tableNameFor(tableNodeId),
      value: {
        kind: "node-attribute-reference" as const,
        nodeId: tableNodeId,
        attribute: "aws.dynamodb.table.name",
      },
    })),
    {
      id: "environment_stage",
      name: "APP_STAGE",
      value: {
        kind: "variable-reference" as const,
        variableId: "variable_stage",
      },
    },
    ...(options.includeSecretBinding
      ? [
          {
            id: "environment_signing_secret",
            name: "SIGNING_SECRET",
            value: {
              kind: "secret-reference" as const,
              reference: "secret_fixture_marker_never_embed",
            },
          },
        ]
      : []),
  ];
  const extension = {
    extensionId: "extension.notes.custom",
    extensionContractVersion: 1 as const,
    digest: sha256Digest("synthetic reviewed extension"),
    ownership: "ai-authored" as const,
    validationEvidenceIds: ["evidence_parse_static"],
  };
  const compatibility = {
    generatorId: descriptor.generator.id,
    minimumVersion: descriptor.generator.version,
    templateId: descriptor.template.id,
    templateVersion: descriptor.template.version,
    supportedModes: [
      "generated-starter",
      "complete-supported-pattern",
    ] as const,
  };
  const promptDigest = sha256Digest("synthetic model prompt");
  const workload = {
    id: workloadId,
    owningNodeId: "node_notes_function",
    implementation: implementationFor(mode, descriptor),
    operations: reverseIf(workloadOperations, reverse),
    behaviorContracts: reverseIf(
      contracts.behaviors
        .filter((_, index) => operations[index] !== options.missingBehaviorFor)
        .map((contract) => contractReference(contract)),
      reverse,
    ),
    triggers: reverseIf(
      operations.map((operation) => ({
        id: `trigger_${operation}`,
        edgeId: `edge_api_${operation}`,
        targetOperationId: operationId(operation),
      })),
      reverse,
    ),
    downstreamActions: reverseIf(
      operations.map((operation) => ({
        id: `action_${operation}_table`,
        edgeId: `edge_${operation}_table`,
        sourceOperationId: operationId(operation),
      })),
      reverse,
    ),
    environment: reverseIf(environment, reverse),
    errorBehavior: { mode: "fail-invocation" },
    executionAssumptions: {
      timeout: { kind: "duration", milliseconds: 10_000 },
      retry: { kind: "none" },
    },
    triggerDispatch: { mode: "single" },
    unresolvedRequirementIds: options.unresolvedBehavior
      ? ["requirement_custom_behavior"]
      : [],
    languageFamily: TYPESCRIPT_LANGUAGE_FAMILY,
    entrypoints: reverseIf(
      operations.map((operation) => ({
        entrypointId: `entrypoint_${operation}`,
        kind:
          options.invalidWorkloadShape && operation === operations[0]
            ? ("background-worker" as const)
            : ("request-handler" as const),
        operationId: operationId(operation),
        handler: LAMBDA_HANDLER,
      })),
      reverse,
    ),
    httpRoutes: reverseIf(
      operations.map((operation) => {
        const route = routeByOperation.get(operation);
        if (route === undefined)
          throw new Error(`Missing route for ${operation}`);
        const shape = routeShape(operation);
        return {
          routeId: `route_${operation}_note`,
          method: shape.method,
          pathTemplate: shape.pathTemplate,
          operationId: operationId(operation),
          triggerEdgeId: `edge_api_${operation}`,
          contract: contractReference(route),
        };
      }),
      reverse,
    ),
    eventBindings: [],
    schedules: [],
    dataBindings: reverseIf(
      operations.map((operation) => ({
        bindingId: `data_${operation}_note`,
        operationId: operationId(operation),
        entity: contractReference(contracts.entity),
        dataOperation: operation,
        edgeId: `edge_${operation}_table`,
      })),
      reverse,
    ),
    authorization: reverseIf(
      operations.map((operation) => ({
        bindingId: `authorization_${operation}_member`,
        authContract: contractReference(contracts.auth),
        operationIds: [operationId(operation)],
        permittedRoleIds: ["role_member"],
        deniedBehavior: "reject" as const,
      })),
      reverse,
    ),
    idempotency: operations.map((operation) => ({
      policyId: `idempotency_${operation}`,
      mode: "not-required" as const,
      operationIds: [operationId(operation)],
    })),
    observability: { signals: ["logs"], healthChecks: [], smokeTests: [] },
    tests: reverseIf(
      contracts.tests.map((test, index) => {
        const operation = operations[Math.floor(index / 2)];
        if (operation === undefined) throw new Error("Missing test operation.");
        return {
          bindingId: `test_${test.level}_${operation}_note`,
          level: test.level,
          testCase: contractReference(test),
          requiredForCoverage: true,
        };
      }),
      reverse,
    ),
    sourceOwnership: [
      {
        declarationId: "ownership_notes_extension",
        path: "application/src/functions/notes_handler/extensions/custom.ts",
        pathKind: "file",
        ownership: "user-owned",
        ownerId: "application.notes.owner",
        regeneration: "never",
        conflictBehavior: "preserve-user-content",
        semanticDiff: { strategy: "structured-language" },
      },
    ],
    extensionPoints: [
      {
        extensionPointId: "application.notes.extensions",
        path: "application/src/functions/notes_handler/extensions/custom.ts",
        kind: "module",
        permittedOwnership: ["user-owned", "approved-extension"],
        conflictBehavior: "require-reviewed-resolution",
      },
    ],
    extensions: mode === "ai-assisted-custom" ? [extension] : [],
    implementationRequirements: [
      ...(options.unresolvedBehavior
        ? [
            {
              implementationRequirementId: "implementation_custom_behavior",
              architectureRequirementId: "requirement_custom_behavior",
              summary: "A synthetic unsupported behavior remains user-owned.",
              blocking: true,
              affectedContractReferences: [],
            },
          ]
        : []),
      ...(options.nonBlockingImplementationRequirement
        ? [
            {
              implementationRequirementId: "implementation_review_note",
              summary: "A synthetic non-blocking implementation note remains.",
              blocking: false,
              affectedContractReferences: [],
            },
          ]
        : []),
    ],
    compatibility: {
      applicationGenerators:
        mode === "generated-starter" || mode === "complete-supported-pattern"
          ? options.duplicateCompatibility
            ? [compatibility, compatibility]
            : [compatibility]
          : [],
      modelGateways:
        mode === "ai-assisted-custom"
          ? [
              {
                modelGatewayContractVersion: "1.0.0",
                modelFamily: "model.synthetic",
                promptTemplateId: "prompt.notes.custom",
                promptVersion: "1.0.0",
                promptDigest,
                supportedMode: "ai-assisted-custom",
                requiredValidation: [
                  "parse",
                  "static-analysis",
                  "build",
                  "unit-test",
                  "contract-test",
                  "security",
                ],
              },
            ]
          : [],
    },
    provenance:
      mode === "ai-assisted-custom"
        ? {
            source: "ai-assisted",
            modelGatewayId: "model-gateway.synthetic",
            modelProviderId: "model-provider.synthetic",
            modelId: "synthetic-model",
            promptTemplateId: "prompt.notes.custom",
            promptVersion: "1.0.0",
            promptDigest,
            outputDigest: extension.digest,
            acceptedAt: timestamp,
            acceptedBy: "actor_fixture",
          }
        : {
            source: "deterministic-generator",
            generatorId: descriptor.generator.id,
            generatorVersion: descriptor.generator.version,
            inputDigest: sha256Digest("synthetic workload input"),
          },
  };

  const revision = {
    revisionId: "revision_notes_1",
    revisionNumber: 1,
    createdAt: timestamp,
    createdBy: "actor_fixture",
    sourceDraftId: "draft_notes_1",
  };
  const applicationContractRecords = [
    contracts.entity,
    contracts.auth,
    ...contracts.routes,
    ...contracts.behaviors,
    ...contracts.tests,
  ];
  const externalResource = {
    id: "external_notes_audit",
    displayName: "Synthetic audit endpoint",
    capability: "application.audit.write",
    resourceType: "external.audit.endpoint",
    architectureNodeIds: ["node_notes_function"],
    provider: {
      state: "known",
      providerId: "external.synthetic",
      serviceFamily: "external.audit",
    },
    scope: { region: "synthetic-region-1" },
    addresses: [
      {
        addressId: "address_audit_url",
        kind: "url",
        value: "https://audit.invalid/v1/events",
      },
    ],
    lifecycle: {
      ownershipState: "third-party-service-api",
      lifecycleAuthority: "third-party-owner",
      behavior: {
        create: "forbidden",
        reference: "required",
        import: "unsupported",
        dataSource: "allowed",
      },
      iacTargets: [{ target: "terraform", readiness: "reference-ready" }],
    },
    interfaces: [],
    dataClassifications: ["internal"],
    trustBoundary: "public-internet",
    availability: { assumption: "best-effort" },
    evidence: [],
    extractedCandidates: [],
    unresolvedInformation: [],
  };
  const architectureDocument = architectureDocumentV3Schema.parse({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 3,
    documentId: "document_notes_api",
    architectureId: "architecture_notes_api",
    revision,
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
    nodes: reverseIf(nodes, reverse),
    edges: reverseIf(edges, reverse),
    variables: [
      {
        id: "variable_stage",
        key: "stage",
        valueType: "string",
        required: false,
        defaultValue: { kind: "string", value: "test" },
      },
    ],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: options.unresolvedBehavior
      ? [
          {
            id: "requirement_custom_behavior",
            statement: "A synthetic behavior needs an implementation.",
            category: "functional",
            blocking: true,
            origin: "user",
          },
        ]
      : [],
    applicationContracts: {
      kind: "cloudmarkup.application-contracts",
      schemaVersion: 1,
      contractSetId: "contracts_notes_api",
      documentId: "document_notes_api",
      revision: {
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
      },
      contracts: reverseIf(applicationContractRecords, reverse),
    },
    externalResources: {
      kind: "cloudmarkup.external-resource-reference-document",
      schemaVersion: 1,
      documentId: "document_notes_api",
      architectureId: "architecture_notes_api",
      revision: {
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
      },
      resources: options.includeExternalResource ? [externalResource] : [],
    },
    workloadBehavior: { contractVersion: 2, workloads: [workload] },
  });

  const canonicalWorkload = architectureDocument.workloadBehavior.workloads[0];
  if (canonicalWorkload === undefined)
    throw new Error("Missing canonical fixture workload.");
  const normalizedTargetKey = (nodeId: keyof typeof targetKeyByNode): string =>
    options.normalizedTargetKeyTamper && nodeId === "node_notes_function"
      ? "tampered_notes_handler"
      : targetKeyByNode[nodeId];
  const normalizedResources = architectureDocument.nodes.map((node) => ({
    id: node.id,
    targetKey: normalizedTargetKey(node.id as keyof typeof targetKeyByNode),
    deploymentKey: node.semantic.deploymentKey,
    serviceType: node.semantic.serviceType,
    resourceType: node.semantic.resourceType,
    configuration: normalizedConfiguration(node.semantic.configuration),
    lifecycle:
      options.normalizedLifecycleTamper && node.id === "node_notes_function"
        ? { ...node.semantic.lifecycle, origin: "tampered" }
        : node.semantic.lifecycle,
    workloadIds:
      node.id === canonicalWorkload.owningNodeId ? [canonicalWorkload.id] : [],
  }));
  const normalizedConnections = architectureDocument.edges.map((edge) => ({
    id: edge.id,
    source: {
      nodeId: edge.semantic.source.nodeId,
      port: edge.semantic.source.port,
      targetKey: normalizedTargetKey(
        edge.semantic.source.nodeId as keyof typeof targetKeyByNode,
      ),
    },
    target: {
      nodeId: edge.semantic.target.nodeId,
      port: edge.semantic.target.port,
      targetKey: normalizedTargetKey(
        edge.semantic.target.nodeId as keyof typeof targetKeyByNode,
      ),
    },
    relationshipType: edge.semantic.relationshipType,
    configuration: normalizedConfiguration(edge.semantic.configuration),
    lifecycle: edge.semantic.lifecycle,
  }));
  const normalizedEnvironment = canonicalWorkload.environment.map((binding) => {
    if (binding.value.kind === "variable-reference") {
      return {
        id: binding.id,
        name: binding.name,
        kind: binding.value.kind,
        variableId: binding.value.variableId,
      };
    }
    if (binding.value.kind === "secret-reference") {
      return {
        id: binding.id,
        name: binding.name,
        kind: binding.value.kind,
        secretReference: binding.value.reference,
      };
    }
    return {
      id: binding.id,
      name: binding.name,
      kind: binding.value.kind,
      resource: {
        nodeId: binding.value.nodeId,
        attribute: binding.value.attribute,
        targetKey: normalizedTargetKey(
          binding.value.nodeId as keyof typeof targetKeyByNode,
        ),
      },
    };
  });
  const architectureContentHash =
    getArchitectureDocumentContentHash(architectureDocument);
  const architectureDocumentHash =
    getArchitectureDocumentCanonicalHash(architectureDocument);
  const architectureVisualHash =
    getArchitectureDocumentVisualHash(architectureDocument);
  const workloadContentHash = getWorkloadBehaviorContentHash(
    architectureDocument.workloadBehavior,
  );
  const contractsContentHash = getApplicationContractsContentHash(
    architectureDocument.applicationContracts,
  );
  const externalResourcesContentHash = getExternalResourceReferenceContentHash(
    architectureDocument.externalResources,
  );
  const generator = {
    id: descriptor.generator.id,
    version: descriptor.generator.version,
    digest: descriptor.generator.digest,
  } as const;
  const normalizedSolution = {
    contractVersion: 1,
    provenance: {
      architectureDocumentId: architectureDocument.documentId,
      architectureId: architectureDocument.architectureId,
      architectureRevisionId: architectureDocument.revision.revisionId,
      architectureContentHash,
      architectureDocumentHash,
      architectureVisualHash,
      workloadContentHash,
      solutionRevisionId,
      catalog,
      providerId: architectureDocument.provider.id,
      region: architectureDocument.provider.region,
    },
    resources: reverseIf(normalizedResources, reverse),
    connections: reverseIf(normalizedConnections, reverse),
    variables: [
      {
        id: "variable_stage",
        key: "stage",
        valueType: "string",
        required: false,
        defaultValue: { kind: "string", value: "test" },
      },
    ],
    outputs: [],
    policyAttachments: [],
    externalResources: options.includeExternalResource
      ? [
          {
            id: externalResource.id,
            resourceType: externalResource.resourceType,
            architectureNodes: [
              {
                nodeId: "node_notes_function",
                targetKey: normalizedTargetKey("node_notes_function"),
              },
            ],
            addresses: externalResource.addresses.map((address) => ({
              id: address.addressId,
              kind: address.kind,
              value: address.value,
            })),
            ownershipState: externalResource.lifecycle.ownershipState,
            lifecycleAuthority: externalResource.lifecycle.lifecycleAuthority,
            behavior: externalResource.lifecycle.behavior,
            targets: externalResource.lifecycle.iacTargets,
          },
        ]
      : [],
    target: {
      contractVersion: "1.0.0",
      reasons: [],
      renderingAvailable: true,
      state: "ready",
      target: "terraform",
    },
    workloads: [
      {
        id: canonicalWorkload.id,
        owningResource: {
          nodeId: canonicalWorkload.owningNodeId,
          targetKey: normalizedTargetKey("node_notes_function"),
        },
        implementationMode: canonicalWorkload.implementation.mode,
        ...(canonicalWorkload.implementation.mode === "infrastructure-only"
          ? {}
          : {
              runtimeFamily: canonicalWorkload.implementation.runtimeFamily,
              handler: canonicalWorkload.implementation.handler,
            }),
        ...(canonicalWorkload.languageFamily === undefined
          ? {}
          : { languageFamily: canonicalWorkload.languageFamily }),
        sourceOwner:
          canonicalWorkload.implementation.mode === "infrastructure-only"
            ? "none"
            : canonicalWorkload.implementation.sourceOwnership,
        operations: canonicalWorkload.operations.map((operation) => ({
          id: operation.id,
          capability: operation.capability,
          ...(operation.inputContract.kind === "contract-reference"
            ? { inputContract: operation.inputContract.reference }
            : {}),
          ...(operation.outputContract.kind === "contract-reference"
            ? { outputContract: operation.outputContract.reference }
            : {}),
        })),
        triggers: canonicalWorkload.triggers.map((trigger) => ({
          id: trigger.id,
          edgeId: trigger.edgeId,
          operationId: trigger.targetOperationId,
          kind: "architecture-edge",
        })),
        downstreamActions: canonicalWorkload.downstreamActions.map(
          (action) => ({
            id: action.id,
            edgeId: action.edgeId,
            operationId: action.sourceOperationId,
            kind: "architecture-edge",
          }),
        ),
        environment: normalizedEnvironment,
        artifactInputs: [],
        artifactOutputs: [],
        generationCoverage: "application-generation-required",
        generatorReadiness: {
          state: "ready",
          reasons: [],
          generator,
          templateId: descriptor.template.id,
          templateVersion: descriptor.template.version,
        },
        sourceOwnership: canonicalWorkload.sourceOwnership.map((ownership) => ({
          declarationId: ownership.declarationId,
          path: ownership.path,
          pathKind: ownership.pathKind,
          ownership: ownership.ownership,
          ownerId: ownership.ownerId,
          regeneration: ownership.regeneration,
          conflictBehavior: ownership.conflictBehavior,
          semanticDiff: ownership.semanticDiff.strategy,
          ...(ownership.baselineDigest === undefined
            ? {}
            : { baselineDigest: ownership.baselineDigest }),
          ...(ownership.extensionPointId === undefined
            ? {}
            : { extensionPointId: ownership.extensionPointId }),
        })),
        extensionPoints: canonicalWorkload.extensionPoints.map((point) => ({
          id: point.extensionPointId,
          path: point.path,
          kind: point.kind,
          permittedOwnership: point.permittedOwnership,
          conflictBehavior: point.conflictBehavior,
        })),
        targetReadiness: "ready",
        specification: canonicalWorkload,
      },
    ],
  };
  const solutionRevision = {
    kind: "cloudmarkup.solution-revision-manifest",
    contractVersion: 1,
    solutionRevisionId,
    createdAt: timestamp,
    createdBy: "actor_fixture",
    intent: {
      state: "not-applicable",
      reason:
        "This synthetic fixture directly exercises deterministic generation.",
    },
    architecture: {
      documentKind: "cloudmarkup.architecture-document",
      schemaVersion: 3,
      revisionId: architectureDocument.revision.revisionId,
      contentHash: architectureContentHash,
      documentHash: architectureDocumentHash,
      visualHash: architectureVisualHash,
    },
    workload: { contractVersion: 2, contentHash: workloadContentHash },
    contracts: {
      contractVersion: 1,
      contentHash: contractsContentHash,
      recordHashes: architectureDocument.applicationContracts.contracts
        .map(getApplicationContractRecordContentHash)
        .sort(compareUtf16),
    },
    externalResources: {
      contractVersion: 1,
      contentHash: externalResourcesContentHash,
    },
    assumptions: [],
    unresolvedDecisionIds: [],
    repositoryObservations: [],
    issueIdsAtFreeze: [],
    evidenceIdsAtFreeze: [],
    aiExtensionIds:
      mode === "ai-assisted-custom" ? ["extension.notes.custom"] : [],
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
      compiler: {
        state: "not-applicable",
        reason: "The strict normalized model is supplied as immutable input.",
      },
      diagramRenderer: {
        state: "not-applicable",
        reason: "Diagram rendering is outside source generation.",
      },
      importer: {
        state: "not-applicable",
        reason: "No repository import is used by the synthetic fixture.",
      },
      modelPrompt: {
        state: "not-applicable",
        reason: "The deterministic generator never calls a model.",
      },
      policy: [],
    },
  };

  return applicationGenerationRequestV1Schema.parse({
    contractVersion: 1,
    architectureDocument,
    workloadBehavior: architectureDocument.workloadBehavior,
    solutionRevision,
    normalizedSolution,
    generator,
    template: {
      id: descriptor.template.id,
      version: descriptor.template.version,
      digest: descriptor.template.digest,
    },
    pattern: {
      id: descriptor.pattern.id,
      version: descriptor.pattern.version,
      digest: descriptor.pattern.digest,
    },
    runtime: {
      id: APPLICATION_RUNTIME_ID,
      version: APPLICATION_RUNTIME_VERSION,
      digest: APPLICATION_RUNTIME_DIGEST,
      runtimeFamily: NODE_RUNTIME_FAMILY,
      languageFamily: TYPESCRIPT_LANGUAGE_FAMILY,
      runtime: LAMBDA_RUNTIME,
      handler: LAMBDA_HANDLER,
      moduleFormat: "esm",
    },
    existingFiles: options.existingFiles ?? [],
  });
}

export type EventFixturePattern =
  | "s3-image-metadata"
  | "sqs-consumer-dlq"
  | "sns-fanout-consumer"
  | "eventbridge-scheduled"
  | "eventbridge-target"
  | "step-functions-task";

export interface EventRequestOptions {
  readonly catalog?: FixtureCatalog;
  readonly pattern: EventFixturePattern;
  readonly instanceId?: "primary" | "secondary";
  readonly mode?: "generated-starter" | "complete-supported-pattern";
  readonly existingFiles?: readonly ExistingApplicationFileV1[];
  readonly wrongDirection?: boolean;
  readonly missingDlq?: boolean;
  readonly fifoQueue?: boolean;
  readonly invalidDispatcher?: boolean;
  readonly invalidTimeout?: boolean;
  readonly mismatchedTimeout?: boolean;
  readonly excessiveTimeout?: boolean;
  readonly unresolvedRetry?: boolean;
  readonly mismatchedStepRetry?: boolean;
  readonly includeSecretBinding?: boolean;
  readonly invalidS3MetadataKey?: boolean;
  readonly invalidS3MetadataOperations?: boolean;
  readonly invalidS3MetadataShape?: boolean;
  readonly invalidS3MetadataStorage?: boolean;
  readonly invalidScheduledPayload?: boolean;
  readonly snsSqsUpstreamDelivery?: "raw" | "wrapped";
  readonly unsupportedFilter?: boolean;
}

function eventFixtureShape(
  pattern: EventFixturePattern,
  mismatchedStepRetry = false,
) {
  switch (pattern) {
    case "s3-image-metadata":
      return {
        sourceService: "aws.s3",
        sourceResource: "aws.s3.bucket",
        relationship: SUPPORTED_EVENT_RELATIONSHIPS.s3NotifiesLambda,
        sourcePort: "aws.s3.bucket.notifications",
        targetPort: "aws.lambda.function.asynchronous-invocation",
        schemaId: "aws.s3.notification.connection",
        configuration: {
          eventType: { kind: "string", value: "OBJECT_CREATED" },
          filterPrefix: { kind: "string", value: "incoming/" },
          filterSuffix: { kind: "string", value: ".jpg" },
          deliverySemantics: {
            kind: "string",
            value: "AT_LEAST_ONCE_UNORDERED",
          },
        },
        transportKind: "event" as const,
      };
    case "sqs-consumer-dlq":
      return {
        sourceService: "aws.sqs",
        sourceResource: "aws.sqs.queue",
        relationship: SUPPORTED_EVENT_RELATIONSHIPS.sqsTriggersLambda,
        sourcePort: "aws.sqs.queue.event-source",
        targetPort: "aws.lambda.function.event-source",
        schemaId: "aws.sqs.lambda-consumer.connection",
        configuration: {
          batchSize: { kind: "integer", value: 10 },
          batchingWindowSeconds: { kind: "integer", value: 0 },
          maximumConcurrency: { kind: "integer", value: 10 },
          partialBatchResponse: { kind: "boolean", value: true },
          deliverySemantics: { kind: "string", value: "AT_LEAST_ONCE" },
        },
        transportKind: "message" as const,
      };
    case "sns-fanout-consumer":
      return {
        sourceService: "aws.sns",
        sourceResource: "aws.sns.subscription",
        relationship: SUPPORTED_EVENT_RELATIONSHIPS.snsInvokesLambda,
        sourcePort: "aws.sns.subscription.lambda-delivery",
        targetPort: "aws.lambda.function.asynchronous-invocation",
        schemaId: "aws.eventing.delivery.connection",
        configuration: {
          deliverySemantics: { kind: "string", value: "AT_LEAST_ONCE" },
        },
        transportKind: "event" as const,
      };
    case "eventbridge-scheduled":
    case "eventbridge-target":
      return {
        sourceService: "aws.eventbridge",
        sourceResource: "aws.eventbridge.target",
        relationship: SUPPORTED_EVENT_RELATIONSHIPS.eventBridgeInvokesLambda,
        sourcePort: "aws.eventbridge.target.lambda",
        targetPort: "aws.lambda.function.asynchronous-invocation",
        schemaId: "aws.eventing.delivery.connection",
        configuration: {
          deliverySemantics: { kind: "string", value: "AT_LEAST_ONCE" },
        },
        transportKind: "event" as const,
      };
    case "step-functions-task":
      return {
        sourceService: "aws.stepfunctions",
        sourceResource: "aws.stepfunctions.state-machine",
        relationship: SUPPORTED_EVENT_RELATIONSHIPS.stepFunctionsInvokesLambda,
        sourcePort: "aws.stepfunctions.state-machine.lambda-task",
        targetPort: "aws.lambda.function.synchronous-invocation",
        schemaId: "aws.stepfunctions.lambda-task.connection",
        configuration: {
          taskTimeoutSeconds: { kind: "integer", value: 30 },
          retryMode: { kind: "string", value: "BOUNDED_EXPONENTIAL" },
          maximumAttempts: {
            kind: "integer",
            value: mismatchedStepRetry ? 3 : 5,
          },
        },
        transportKind: "event" as const,
      };
  }
}

function eventFixtureCapability(pattern: EventFixturePattern): string {
  switch (pattern) {
    case "s3-image-metadata":
      return "cloudmarkup.event.s3-record-metadata";
    case "sqs-consumer-dlq":
      return "cloudmarkup.event.sqs-consume";
    case "sns-fanout-consumer":
      return "cloudmarkup.event.sns-consume";
    case "eventbridge-scheduled":
      return "cloudmarkup.event.schedule-run";
    case "eventbridge-target":
      return "cloudmarkup.event.eventbridge-consume";
    case "step-functions-task":
      return "cloudmarkup.event.step-functions-task";
  }
}

function requiredEventFixtureValue<T>(
  value: T | undefined,
  description: string,
): T {
  if (value === undefined)
    throw new Error(`Missing event fixture ${description}.`);
  return value;
}
export function createEventGenerationRequest(
  options: EventRequestOptions,
): ApplicationGenerationRequestV1 {
  const base = createNotesGenerationRequest({
    mode: "complete-supported-pattern",
    operations: ["create"],
  });
  const catalog = options.catalog ?? CURRENT_APPLICATION_CATALOG;
  const mode = options.mode ?? "complete-supported-pattern";
  const shape = eventFixtureShape(options.pattern, options.mismatchedStepRetry);
  const instanceSuffix =
    options.instanceId === undefined ? "" : `_${options.instanceId}`;
  const deploymentKey = `event_${options.pattern.replace(/-/g, "_")}${instanceSuffix}`;
  const namespace =
    options.instanceId === undefined
      ? options.pattern
      : `${options.pattern}.${options.instanceId}`;
  const workloadId = `workload_${deploymentKey}`;
  const operationId = `operation_${deploymentKey}`;
  const sourceNodeId = `node_source_${deploymentKey}`;
  const triggerEdgeId = `edge_trigger_${deploymentKey}`;
  const lambdaNodeTemplate = structuredClone(
    requiredEventFixtureValue(
      base.architectureDocument.nodes.find(
        (node) => node.id === "node_notes_function",
      ),
      "Lambda node",
    ),
  );
  const lambdaNode = {
    ...lambdaNodeTemplate,
    semantic: {
      ...lambdaNodeTemplate.semantic,
      configuration: {
        ...lambdaNodeTemplate.semantic.configuration,
        values: {
          ...lambdaNodeTemplate.semantic.configuration.values,
          timeoutSeconds: {
            kind: "integer" as const,
            value: options.excessiveTimeout
              ? 31
              : options.mismatchedTimeout
                ? 10
                : 30,
          },
        },
      },
    },
  };
  const logNode = structuredClone(
    requiredEventFixtureValue(
      base.architectureDocument.nodes.find(
        (node) => node.id === "node_notes_logs",
      ),
      "log node",
    ),
  );
  const tableNode = structuredClone(
    requiredEventFixtureValue(
      base.architectureDocument.nodes.find(
        (node) => node.id === "node_notes_table",
      ),
      "metadata table node",
    ),
  );
  const logEdge = structuredClone(
    requiredEventFixtureValue(
      base.architectureDocument.edges.find(
        (edge) => edge.id === "edge_function_logs",
      ),
      "log edge",
    ),
  );
  const dataEdge = structuredClone(
    requiredEventFixtureValue(
      base.architectureDocument.edges.find(
        (edge) => edge.id === "edge_create_table",
      ),
      "metadata data edge",
    ),
  );
  const sourceNode = {
    id: sourceNodeId,
    semantic: {
      deploymentKey: `${deploymentKey}_source`,
      serviceType: shape.sourceService,
      resourceType: shape.sourceResource,
      configuration: {
        schemaId: `${shape.sourceResource}.config`,
        schemaVersion: "1.0.0",
        values:
          options.pattern === "sqs-consumer-dlq"
            ? {
                queueType: {
                  kind: "string" as const,
                  value: options.fifoQueue ? "FIFO" : "STANDARD",
                },
              }
            : {},
      },
      lifecycle: { ownership: "user", origin: "user" },
    },
    presentation: { label: "Typed event source", position: { x: 0, y: 0 } },
  };
  const dlqNode = {
    id: `node_dlq_${deploymentKey}`,
    semantic: {
      deploymentKey: `${deploymentKey}_dlq`,
      serviceType: "aws.sqs",
      resourceType: "aws.sqs.queue",
      configuration: {
        schemaId: "aws.sqs.queue.config",
        schemaVersion: "1.0.0",
        values: {
          queueType: { kind: "string", value: "STANDARD" },
        },
      },
      lifecycle: { ownership: "user", origin: "user" },
    },
    presentation: { label: "Consumer DLQ", position: { x: 0, y: 180 } },
  };
  const snsSubscriptionNode = {
    id: "node_sns_subscription_" + deploymentKey,
    semantic: {
      deploymentKey: deploymentKey + "_sns_subscription",
      serviceType: "aws.sns.subscription",
      resourceType: "aws.sns.subscription",
      configuration: {
        schemaId: "aws.sns.subscription.configuration",
        schemaVersion: "1.0.0",
        values: {
          subscriptionName: { kind: "string", value: "queue-consumer" },
          protocol: { kind: "string", value: "SQS" },
          rawMessageDelivery: {
            kind: "boolean",
            value: options.snsSqsUpstreamDelivery === "raw",
          },
          filterScope: { kind: "string", value: "NONE" },
          filterKeys: { kind: "string-list", value: [] },
          retryPolicy: { kind: "string", value: "SERVICE_MANAGED" },
          deliverySemantics: { kind: "string", value: "AT_LEAST_ONCE" },
        },
      },
      lifecycle: { ownership: "user", origin: "user" },
    },
    presentation: {
      label: "SNS queue subscription",
      position: { x: -180, y: 0 },
    },
  };
  const triggerEdge = {
    id: triggerEdgeId,
    semantic: {
      source: { nodeId: sourceNodeId, port: shape.sourcePort },
      target: {
        nodeId: "node_notes_function",
        port: shape.targetPort,
      },
      relationshipType: shape.relationship,
      configuration: {
        schemaId: shape.schemaId,
        schemaVersion: "1.0.0",
        values: {
          ...shape.configuration,
          ...(options.unsupportedFilter
            ? { arbitraryFilterJson: { kind: "string", value: "{*}" } }
            : {}),
        },
      },
      lifecycle: { ownership: "user", origin: "user" },
    },
  };
  const dlqEdge = {
    id: `edge_dlq_${deploymentKey}`,
    semantic: {
      source: {
        nodeId: sourceNodeId,
        port: "aws.sqs.queue.redrive",
      },
      target: {
        nodeId: dlqNode.id,
        port: "aws.sqs.queue.dead-letter-target",
      },
      relationshipType: SUPPORTED_EVENT_RELATIONSHIPS.sqsUsesDeadLetterQueue,
      configuration: {
        schemaId: "aws.sqs.redrive.connection",
        schemaVersion: "1.0.0",
        values: {
          maximumReceiveCount: { kind: "integer", value: 5 },
          replayMode: { kind: "string", value: "MANUAL_REVIEW" },
        },
      },
      lifecycle: { ownership: "user", origin: "user" },
    },
  };
  const snsSubscriptionEdge = {
    id: "edge_sns_subscription_" + deploymentKey,
    semantic: {
      source: {
        nodeId: snsSubscriptionNode.id,
        port: "aws.sns.subscription.queue-delivery",
      },
      target: {
        nodeId: sourceNodeId,
        port: "aws.sqs.queue.message-send",
      },
      relationshipType: SUPPORTED_EVENT_RELATIONSHIPS.snsSubscriptionSendsToSqs,
      configuration: {
        schemaId: "aws.eventing.delivery.connection",
        schemaVersion: "1.0.0",
        values: {
          deliverySemantics: { kind: "string", value: "AT_LEAST_ONCE" },
        },
      },
      lifecycle: { ownership: "user", origin: "user" },
    },
  };
  const payloadFields =
    options.pattern === "s3-image-metadata"
      ? [
          ["bucket", "string", true],
          ["key", "string", true],
          ["eTag", "string", true],
          ["size", "integer", true],
          ["versionId", "string", true],
          ["sequencer", "string", true],
          ...(options.invalidS3MetadataShape
            ? [["businessTransform", "string", true]]
            : []),
        ]
      : [
          ["eventId", "string", true],
          ["correlationId", "string", false],
          ...(options.invalidScheduledPayload &&
          options.pattern === "eventbridge-scheduled"
            ? [["tenantId", "string", true]]
            : []),
        ];
  const payload = parseContract("data-entity", {
    contractKind: "data-entity",
    contractId: `contracts.${namespace}.payload`,
    contractVersion: "1.0.0",
    displayName: "Curated event payload",
    provenance,
    semanticName: `application.${namespace}.payload`,
    storageIntent:
      options.pattern === "s3-image-metadata" &&
      !options.invalidS3MetadataStorage
        ? "persistent"
        : "transient",
    fields: payloadFields.map(([name, scalarType, required]) => ({
      name,
      fieldType: { kind: "scalar", scalarType },
      required,
      nullable: false,
      classification: "internal",
    })),
    indexes: [
      {
        indexId: `index_${deploymentKey}_primary`,
        name: "primary",
        kind: "primary",
        partitionFields: [
          options.pattern === "s3-image-metadata"
            ? options.invalidS3MetadataKey
              ? "bucket"
              : "key"
            : "eventId",
        ],
        sortFields: [],
      },
    ],
    supportedOperations:
      options.pattern === "s3-image-metadata"
        ? options.invalidS3MetadataOperations
          ? ["consume"]
          : ["create", "consume"]
        : ["consume"],
  });
  const eventContract = parseContract("event-message", {
    contractKind: "event-message",
    contractId: `contracts.${namespace}.event`,
    contractVersion: "1.0.0",
    displayName: "Curated event envelope",
    provenance,
    transportKind: shape.transportKind,
    semanticName: `application.${namespace}.event`,
    payload: contractReference(payload),
    headers: [],
    delivery: {
      ordering: "not-guaranteed",
      duplicates: "possible",
      delivery: "at-least-once",
    },
  });
  const eventReference = contractReference(eventContract);
  const payloadReference = contractReference(payload);
  const eventIo = ioReference(eventContract);
  const payloadIo = ioReference(payload);
  const behavior = parseContract("behavior-operation", {
    contractKind: "behavior-operation",
    contractId: `contracts.${namespace}.behavior`,
    contractVersion: "1.0.0",
    displayName: "Curated event behavior",
    provenance,
    capability: eventFixtureCapability(options.pattern),
    input: { kind: "contract-reference", reference: eventReference },
    output:
      options.pattern === "step-functions-task"
        ? { kind: "contract-reference", reference: payloadReference }
        : { kind: "none" },
    failureOutcomes: [
      {
        category: "application.validation",
        retryable: false,
        description: "The typed event contract was not satisfied.",
      },
    ],
  });
  const behaviorReference = contractReference(behavior);
  const tests = (["unit", "contract"] as const).map((level) =>
    parseContract("test-case", {
      contractKind: "test-case",
      contractId: `contracts.${namespace}.test.${level}`,
      contractVersion: "1.0.0",
      displayName: `${level} event contract test`,
      provenance,
      level,
      target: behaviorReference,
      preconditions: [
        {
          kind: "contract-available",
          contract: level === "unit" ? payloadReference : eventReference,
        },
      ],
      fixtureReferences: [],
      expectations:
        level === "unit"
          ? [
              {
                expectationId: "expect_unit_payload_conformance",
                kind: "contract-conformance",
                contract: payloadReference,
              },
            ]
          : [
              {
                expectationId: "expect_contract_validation",
                kind: "error-category",
                category: "application.validation",
              },
            ],
    }),
  );
  const environment = [
    {
      id: "environment_stage",
      name: "APP_STAGE",
      value: { kind: "variable-reference", variableId: "variable_stage" },
    },
    ...(options.pattern === "s3-image-metadata"
      ? [
          {
            id: "environment_metadata_table",
            name: "METADATA_TABLE_NAME",
            value: {
              kind: "node-attribute-reference",
              nodeId: "node_notes_table",
              attribute: "aws.dynamodb.table.name",
            },
          },
        ]
      : []),
    ...(options.includeSecretBinding
      ? [
          {
            id: "environment_runtime_secret",
            name: "RUNTIME_SECRET",
            value: {
              kind: "secret-reference",
              reference: "secret_reference_not_a_value",
            },
          },
        ]
      : []),
  ];
  const extensionPath = `application/src/functions/${deploymentKey}/extensions/custom.ts`;
  const workload = {
    id: workloadId,
    owningNodeId: "node_notes_function",
    implementation:
      mode === "complete-supported-pattern"
        ? {
            mode,
            runtimeFamily: NODE_RUNTIME_FAMILY,
            handler: LAMBDA_HANDLER,
            sourceOwnership: "cloudmarkup",
            supportedPattern: {
              patternId: EVENT_APPLICATION_PATTERN_ID,
              patternVersion: EVENT_APPLICATION_PATTERN_VERSION,
              digest: EVENT_APPLICATION_PATTERN_DIGEST,
            },
          }
        : {
            mode,
            runtimeFamily: NODE_RUNTIME_FAMILY,
            handler: LAMBDA_HANDLER,
            sourceOwnership: "cloudmarkup",
          },
    operations: [
      {
        id: operationId,
        capability: eventFixtureCapability(options.pattern),
        inputContract: {
          kind: "contract-reference",
          reference: eventIo,
        },
        outputContract:
          options.pattern === "step-functions-task"
            ? { kind: "contract-reference", reference: payloadIo }
            : { kind: "none" },
      },
    ],
    behaviorContracts: [behaviorReference],
    triggers: [
      {
        id: `trigger_${deploymentKey}`,
        edgeId: triggerEdgeId,
        targetOperationId: operationId,
      },
    ],
    downstreamActions:
      options.pattern === "s3-image-metadata"
        ? [
            {
              id: "action_metadata_table",
              edgeId: "edge_create_table",
              sourceOperationId: operationId,
            },
          ]
        : [],
    environment,
    errorBehavior: {
      mode:
        options.pattern === "sqs-consumer-dlq" ? "continue" : "fail-invocation",
    },
    executionAssumptions: {
      timeout: options.invalidTimeout
        ? { kind: "unresolved" }
        : {
            kind: "duration",
            milliseconds: options.excessiveTimeout ? 31_000 : 30_000,
          },
      retry: options.unresolvedRetry
        ? { kind: "unresolved" }
        : { kind: "bounded", maximumAttempts: 5 },
    },
    triggerDispatch: options.invalidDispatcher
      ? { mode: "single" }
      : {
          mode: "generated-supported",
          dispatcherId: EVENT_TRIGGER_DISPATCHER_ID,
          dispatcherVersion: EVENT_TRIGGER_DISPATCHER_VERSION,
          dispatcherOperationId: operationId,
        },
    unresolvedRequirementIds: [],
    languageFamily: TYPESCRIPT_LANGUAGE_FAMILY,
    entrypoints: [
      {
        entrypointId: `entrypoint_${deploymentKey}`,
        kind:
          options.pattern === "sqs-consumer-dlq"
            ? "message-handler"
            : options.pattern === "eventbridge-scheduled"
              ? "schedule-handler"
              : options.pattern === "step-functions-task"
                ? "background-worker"
                : "event-handler",
        operationId,
        handler: LAMBDA_HANDLER,
      },
    ],
    httpRoutes: [],
    eventBindings: [
      {
        bindingId: `event_${deploymentKey}`,
        direction: options.wrongDirection ? "outbound" : "inbound",
        transportKind: shape.transportKind,
        operationId,
        edgeId: triggerEdgeId,
        contract: eventReference,
      },
    ],
    schedules:
      options.pattern === "eventbridge-scheduled"
        ? [
            {
              bindingId: `schedule_${deploymentKey}`,
              operationId,
              triggerEdgeId,
              schedule: { kind: "interval", seconds: 300 },
            },
          ]
        : [],
    dataBindings:
      options.pattern === "s3-image-metadata"
        ? [
            {
              bindingId: "data_metadata",
              operationId,
              entity: payloadReference,
              dataOperation: "create",
              edgeId: "edge_create_table",
            },
          ]
        : [],
    authorization: [],
    idempotency: [
      {
        policyId: `idempotency_${deploymentKey}`,
        mode: "not-required",
        operationIds: [operationId],
      },
    ],
    observability: { signals: ["logs"], healthChecks: [], smokeTests: [] },
    tests: tests.map((test) => ({
      bindingId: `test_${test.level}_${deploymentKey}`,
      level: test.level,
      testCase: contractReference(test),
      requiredForCoverage: true,
    })),
    sourceOwnership: [
      {
        declarationId: `ownership_${deploymentKey}_extension`,
        path: extensionPath,
        pathKind: "file",
        ownership: "user-owned",
        ownerId: `application.${namespace}.owner`,
        regeneration: "never",
        conflictBehavior: "preserve-user-content",
        semanticDiff: { strategy: "structured-language" },
      },
    ],
    extensionPoints: [
      {
        extensionPointId: `application.${namespace}.extensions`,
        path: extensionPath,
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
          generatorId: EVENT_APPLICATION_GENERATOR_ID,
          minimumVersion: EVENT_APPLICATION_GENERATOR_VERSION,
          templateId: EVENT_APPLICATION_TEMPLATE_ID,
          templateVersion: EVENT_APPLICATION_TEMPLATE_VERSION,
          supportedModes: ["generated-starter", "complete-supported-pattern"],
        },
      ],
      modelGateways: [],
    },
    provenance: {
      source: "deterministic-generator",
      generatorId: EVENT_APPLICATION_GENERATOR_ID,
      generatorVersion: EVENT_APPLICATION_GENERATOR_VERSION,
      inputDigest: sha256Digest(`fixture:${options.pattern}`),
    },
  };
  const revision = {
    revisionId: `revision_${deploymentKey}_1`,
    revisionNumber: 1,
    createdAt: timestamp,
    createdBy: "actor_fixture",
    sourceDraftId: `draft_${deploymentKey}_1`,
  };
  const nodes = [
    { ...lambdaNode, semantic: { ...lambdaNode.semantic, deploymentKey } },
    logNode,
    sourceNode,
    ...(options.pattern === "s3-image-metadata"
      ? [
          {
            ...tableNode,
            semantic: {
              ...tableNode.semantic,
              configuration: {
                ...tableNode.semantic.configuration,
                values: {
                  ...tableNode.semantic.configuration.values,
                  partitionKeyName: { kind: "string", value: "key" },
                },
              },
            },
          },
        ]
      : []),
    ...(options.pattern === "sqs-consumer-dlq" ? [dlqNode] : []),
    ...(options.pattern === "sqs-consumer-dlq" &&
    options.snsSqsUpstreamDelivery !== undefined
      ? [snsSubscriptionNode]
      : []),
  ];
  const edges = [
    triggerEdge,
    logEdge,
    ...(options.pattern === "s3-image-metadata" ? [dataEdge] : []),
    ...(options.pattern === "sqs-consumer-dlq" && !options.missingDlq
      ? [dlqEdge]
      : []),
    ...(options.pattern === "sqs-consumer-dlq" &&
    options.snsSqsUpstreamDelivery !== undefined
      ? [snsSubscriptionEdge]
      : []),
  ];
  const contractRecords = [payload, eventContract, behavior, ...tests];
  const architectureDocument = architectureDocumentV3Schema.parse({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 3,
    documentId: `document_${deploymentKey}`,
    architectureId: `architecture_${deploymentKey}`,
    revision,
    provider: { id: "aws.cloudmarkup", region: "us-east-1" },
    catalog,
    compilerCompatibility: {
      inputContractVersion: 1,
      minimumCompilerVersion: "1.0.0",
      maximumCompilerVersionExclusive: "2.0.0",
    },
    metadata: base.architectureDocument.metadata,
    nodes,
    edges,
    variables: base.architectureDocument.variables,
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
    applicationContracts: {
      kind: "cloudmarkup.application-contracts",
      schemaVersion: 1,
      contractSetId: `contracts_${deploymentKey}`,
      documentId: `document_${deploymentKey}`,
      revision: {
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
      },
      contracts: contractRecords,
    },
    externalResources: {
      kind: "cloudmarkup.external-resource-reference-document",
      schemaVersion: 1,
      documentId: `document_${deploymentKey}`,
      architectureId: `architecture_${deploymentKey}`,
      revision: {
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
      },
      resources: [],
    },
    workloadBehavior: { contractVersion: 2, workloads: [workload] },
  });
  const canonicalWorkload = requiredEventFixtureValue(
    architectureDocument.workloadBehavior.workloads[0],
    "canonical workload",
  );
  const targetKeys = new Map(
    architectureDocument.nodes.map((node) => [
      node.id,
      node.semantic.deploymentKey,
    ]),
  );
  const targetKeyFor = (
    nodeId: (typeof architectureDocument.nodes)[number]["id"],
  ): string =>
    requiredEventFixtureValue(targetKeys.get(nodeId), `target key ${nodeId}`);

  const normalizedEnvironment = canonicalWorkload.environment.map((binding) =>
    binding.value.kind === "variable-reference"
      ? {
          id: binding.id,
          name: binding.name,
          kind: binding.value.kind,
          variableId: binding.value.variableId,
        }
      : binding.value.kind === "secret-reference"
        ? {
            id: binding.id,
            name: binding.name,
            kind: binding.value.kind,
            secretReference: binding.value.reference,
          }
        : {
            id: binding.id,
            name: binding.name,
            kind: binding.value.kind,
            resource: {
              nodeId: binding.value.nodeId,
              attribute: binding.value.attribute,
              targetKey: targetKeyFor(binding.value.nodeId),
            },
          },
  );
  const architectureContentHash =
    getArchitectureDocumentContentHash(architectureDocument);
  const architectureDocumentHash =
    getArchitectureDocumentCanonicalHash(architectureDocument);
  const architectureVisualHash =
    getArchitectureDocumentVisualHash(architectureDocument);
  const workloadContentHash = getWorkloadBehaviorContentHash(
    architectureDocument.workloadBehavior,
  );
  const contractsContentHash = getApplicationContractsContentHash(
    architectureDocument.applicationContracts,
  );
  const externalResourcesContentHash = getExternalResourceReferenceContentHash(
    architectureDocument.externalResources,
  );
  const generator = {
    id: EVENT_APPLICATION_GENERATOR_ID,
    version: EVENT_APPLICATION_GENERATOR_VERSION,
    digest: EVENT_APPLICATION_GENERATOR_DIGEST,
  } as const;
  const normalizedSolution = {
    contractVersion: 1,
    provenance: {
      architectureDocumentId: architectureDocument.documentId,
      architectureId: architectureDocument.architectureId,
      architectureRevisionId: architectureDocument.revision.revisionId,
      architectureContentHash,
      architectureDocumentHash,
      architectureVisualHash,
      workloadContentHash,
      solutionRevisionId,
      catalog,
      providerId: architectureDocument.provider.id,
      region: architectureDocument.provider.region,
    },
    resources: architectureDocument.nodes.map((node) => ({
      id: node.id,
      targetKey: targetKeyFor(node.id),
      deploymentKey: node.semantic.deploymentKey,
      serviceType: node.semantic.serviceType,
      resourceType: node.semantic.resourceType,
      configuration: node.semantic.configuration,
      lifecycle: node.semantic.lifecycle,
      workloadIds:
        node.id === canonicalWorkload.owningNodeId
          ? [canonicalWorkload.id]
          : [],
    })),
    connections: architectureDocument.edges.map((edge) => ({
      id: edge.id,
      source: {
        nodeId: edge.semantic.source.nodeId,
        port: edge.semantic.source.port,
        targetKey: targetKeyFor(edge.semantic.source.nodeId),
      },
      target: {
        nodeId: edge.semantic.target.nodeId,
        port: edge.semantic.target.port,
        targetKey: targetKeyFor(edge.semantic.target.nodeId),
      },
      relationshipType: edge.semantic.relationshipType,
      configuration: edge.semantic.configuration,
      lifecycle: edge.semantic.lifecycle,
    })),
    variables: base.normalizedSolution.variables,
    outputs: [],
    policyAttachments: [],
    externalResources: [],
    target: base.normalizedSolution.target,
    workloads: [
      {
        id: canonicalWorkload.id,
        owningResource: {
          nodeId: canonicalWorkload.owningNodeId,
          targetKey: targetKeyFor(canonicalWorkload.owningNodeId),
        },
        implementationMode: canonicalWorkload.implementation.mode,
        runtimeFamily: NODE_RUNTIME_FAMILY,
        handler: LAMBDA_HANDLER,
        languageFamily: canonicalWorkload.languageFamily,
        sourceOwner: "cloudmarkup",
        operations: canonicalWorkload.operations.map((operation) => ({
          id: operation.id,
          capability: operation.capability,
          ...(operation.inputContract.kind === "contract-reference"
            ? { inputContract: operation.inputContract.reference }
            : {}),
          ...(operation.outputContract.kind === "contract-reference"
            ? { outputContract: operation.outputContract.reference }
            : {}),
        })),
        triggers: canonicalWorkload.triggers.map((trigger) => ({
          id: trigger.id,
          edgeId: trigger.edgeId,
          operationId: trigger.targetOperationId,
          kind: "architecture-edge",
        })),
        downstreamActions: canonicalWorkload.downstreamActions.map(
          (action) => ({
            id: action.id,
            edgeId: action.edgeId,
            operationId: action.sourceOperationId,
            kind: "architecture-edge",
          }),
        ),
        environment: normalizedEnvironment,
        artifactInputs: [],
        artifactOutputs: [],
        generationCoverage: "application-generation-required",
        generatorReadiness: {
          state: "ready",
          reasons: [],
          generator,
          templateId: EVENT_APPLICATION_TEMPLATE_ID,
          templateVersion: EVENT_APPLICATION_TEMPLATE_VERSION,
        },
        sourceOwnership: canonicalWorkload.sourceOwnership.map((ownership) => ({
          declarationId: ownership.declarationId,
          path: ownership.path,
          pathKind: ownership.pathKind,
          ownership: ownership.ownership,
          ownerId: ownership.ownerId,
          regeneration: ownership.regeneration,
          conflictBehavior: ownership.conflictBehavior,
          semanticDiff: ownership.semanticDiff.strategy,
        })),
        extensionPoints: canonicalWorkload.extensionPoints.map((point) => ({
          id: point.extensionPointId,
          path: point.path,
          kind: point.kind,
          permittedOwnership: point.permittedOwnership,
          conflictBehavior: point.conflictBehavior,
        })),
        targetReadiness: "ready",
        specification: canonicalWorkload,
      },
    ],
  };
  const solutionRevision = {
    kind: "cloudmarkup.solution-revision-manifest",
    contractVersion: 1,
    solutionRevisionId,
    createdAt: timestamp,
    createdBy: "actor_fixture",
    intent: {
      state: "not-applicable",
      reason:
        "This fixture exercises deterministic event application generation.",
    },
    architecture: {
      documentKind: "cloudmarkup.architecture-document",
      schemaVersion: 3,
      revisionId: architectureDocument.revision.revisionId,
      contentHash: architectureContentHash,
      documentHash: architectureDocumentHash,
      visualHash: architectureVisualHash,
    },
    workload: { contractVersion: 2, contentHash: workloadContentHash },
    contracts: {
      contractVersion: 1,
      contentHash: contractsContentHash,
      recordHashes: contractRecords
        .map(getApplicationContractRecordContentHash)
        .sort(compareUtf16),
    },
    externalResources: {
      contractVersion: 1,
      contentHash: externalResourcesContentHash,
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
      compiler: base.solutionRevision.versions.compiler,
      diagramRenderer: base.solutionRevision.versions.diagramRenderer,
      importer: base.solutionRevision.versions.importer,
      modelPrompt: base.solutionRevision.versions.modelPrompt,
      policy: [],
    },
  };
  return applicationGenerationRequestV1Schema.parse({
    contractVersion: 1,
    architectureDocument,
    workloadBehavior: architectureDocument.workloadBehavior,
    solutionRevision,
    normalizedSolution,
    generator,
    template: {
      id: EVENT_APPLICATION_TEMPLATE_ID,
      version: EVENT_APPLICATION_TEMPLATE_VERSION,
      digest: EVENT_APPLICATION_TEMPLATE_DIGEST,
    },
    pattern: {
      id: EVENT_APPLICATION_PATTERN_ID,
      version: EVENT_APPLICATION_PATTERN_VERSION,
      digest: EVENT_APPLICATION_PATTERN_DIGEST,
    },
    runtime: {
      id: APPLICATION_RUNTIME_ID,
      version: APPLICATION_RUNTIME_VERSION,
      digest: APPLICATION_RUNTIME_DIGEST,
      runtimeFamily: NODE_RUNTIME_FAMILY,
      languageFamily: TYPESCRIPT_LANGUAGE_FAMILY,
      runtime: LAMBDA_RUNTIME,
      handler: LAMBDA_HANDLER,
      moduleFormat: "esm",
    },
    existingFiles: options.existingFiles ?? [],
  });
}

function replaceFixtureIdentityValue(
  value: unknown,
  replacements: Readonly<Record<string, string>>,
): unknown {
  if (typeof value === "string") {
    return replacements[value] ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      replaceFixtureIdentityValue(entry, replacements),
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replaceFixtureIdentityValue(entry, replacements),
      ]),
    );
  }
  return value;
}

function replaceFixtureIdentities<T>(
  value: T,
  replacements: Readonly<Record<string, string>>,
): T {
  return replaceFixtureIdentityValue(value, replacements) as T;
}

/**
 * Two explicit SNS fan-out consumers with distinct Lambda/log/source
 * identities. This fixture proves one deterministic request yields two source
 * entrypoints and two independent Prompt 32A build contracts.
 */
export function createMultiWorkloadEventGenerationRequest(
  options: {
    readonly existingFiles?: readonly ExistingApplicationFileV1[];
    readonly catalog?: FixtureCatalog;
  } = {},
): ApplicationGenerationRequestV1 {
  const primary = createEventGenerationRequest({
    pattern: "sns-fanout-consumer",
    ...(options.catalog === undefined ? {} : { catalog: options.catalog }),
    instanceId: "primary",
  });
  const secondaryInput = createEventGenerationRequest({
    pattern: "sns-fanout-consumer",
    ...(options.catalog === undefined ? {} : { catalog: options.catalog }),
    instanceId: "secondary",
  });
  const secondary = replaceFixtureIdentities(secondaryInput, {
    environment_stage: "environment_stage_secondary",
    node_notes_function: "node_multi_secondary_function",
    node_notes_logs: "node_multi_secondary_logs",
    edge_function_logs: "edge_multi_secondary_logs",
    notes_logs: "event_sns_secondary_logs",
  });
  const solutionRevisionId = "solution_event_multi_revision_1";
  const architectureDocument = architectureDocumentV3Schema.parse({
    ...primary.architectureDocument,
    documentId: "document_event_multi",
    architectureId: "architecture_event_multi",
    nodes: [
      ...primary.architectureDocument.nodes,
      ...secondary.architectureDocument.nodes,
    ],
    edges: [
      ...primary.architectureDocument.edges,
      ...secondary.architectureDocument.edges,
    ],
    workloadBehavior: {
      contractVersion: 2,
      workloads: [
        ...primary.workloadBehavior.workloads,
        ...secondary.workloadBehavior.workloads,
      ],
    },
    applicationContracts: {
      ...primary.architectureDocument.applicationContracts,
      contractSetId: "contracts_event_multi",
      documentId: "document_event_multi",
      contracts: [
        ...primary.architectureDocument.applicationContracts.contracts,
        ...secondary.architectureDocument.applicationContracts.contracts,
      ],
    },
    externalResources: {
      ...primary.architectureDocument.externalResources,
      documentId: "document_event_multi",
      architectureId: "architecture_event_multi",
    },
  });
  const architectureContentHash =
    getArchitectureDocumentContentHash(architectureDocument);
  const architectureDocumentHash =
    getArchitectureDocumentCanonicalHash(architectureDocument);
  const architectureVisualHash =
    getArchitectureDocumentVisualHash(architectureDocument);
  const workloadContentHash = getWorkloadBehaviorContentHash(
    architectureDocument.workloadBehavior,
  );
  const contractsContentHash = getApplicationContractsContentHash(
    architectureDocument.applicationContracts,
  );
  const externalResourcesContentHash = getExternalResourceReferenceContentHash(
    architectureDocument.externalResources,
  );
  const normalizedSolution = {
    ...primary.normalizedSolution,
    provenance: {
      ...primary.normalizedSolution.provenance,
      architectureDocumentId: architectureDocument.documentId,
      architectureId: architectureDocument.architectureId,
      architectureRevisionId: architectureDocument.revision.revisionId,
      architectureContentHash,
      architectureDocumentHash,
      architectureVisualHash,
      workloadContentHash,
      solutionRevisionId,
    },
    resources: [
      ...primary.normalizedSolution.resources,
      ...secondary.normalizedSolution.resources,
    ],
    connections: [
      ...primary.normalizedSolution.connections,
      ...secondary.normalizedSolution.connections,
    ],
    workloads: [
      ...primary.normalizedSolution.workloads,
      ...secondary.normalizedSolution.workloads,
    ],
  };
  const solutionRevision = {
    ...primary.solutionRevision,
    solutionRevisionId,
    architecture: {
      ...primary.solutionRevision.architecture,
      revisionId: architectureDocument.revision.revisionId,
      contentHash: architectureContentHash,
      documentHash: architectureDocumentHash,
      visualHash: architectureVisualHash,
    },
    workload: {
      contractVersion: 2 as const,
      contentHash: workloadContentHash,
    },
    contracts: {
      contractVersion: 1 as const,
      contentHash: contractsContentHash,
      recordHashes: architectureDocument.applicationContracts.contracts
        .map(getApplicationContractRecordContentHash)
        .sort(compareUtf16),
    },
    externalResources: {
      contractVersion: 1 as const,
      contentHash: externalResourcesContentHash,
    },
    generationCoverage: {
      ...primary.solutionRevision.generationCoverage,
      solutionRevisionId,
    },
  };
  return applicationGenerationRequestV1Schema.parse({
    ...primary,
    architectureDocument,
    workloadBehavior: architectureDocument.workloadBehavior,
    solutionRevision,
    normalizedSolution,
    existingFiles: options.existingFiles ?? [],
  });
}

export function createHttpNoContentFixture(
  catalog: FixtureCatalog = CURRENT_APPLICATION_CATALOG,
): ApplicationGenerationRequestV1 {
  return createHttpNoContentFixtureFromBase(
    createNotesGenerationRequest({ catalog }),
  );
}
