import { readFile } from "node:fs/promises";

import {
  executeArchitectureValidationRules,
  type ValidationEnvironment,
  type ValidationTarget,
} from "@cloudmarkup/domain";
import {
  providerCatalogArtifactV1Schema,
  validateProviderConfigurationV1,
} from "@cloudmarkup/provider-sdk";
import {
  configurationKeySchema,
  semanticVersionSchema,
  type ArchitectureDocumentV1,
  type ArchitectureDocumentV2,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import { cloudWatchLogGroup } from "./catalog/services/cloudwatch-log-group.js";
import {
  awsValidationRuleRegistrationsV1,
  createAwsValidationRuleRegistrationsV1,
  createCompilerReadinessRuleV1,
  createRegionAvailabilityRuleV1,
  type AwsValidationCatalogV1,
} from "./validation/index.js";

type TestNode = ArchitectureDocumentV1["nodes"][number];
type TestEdge = ArchitectureDocumentV1["edges"][number];

interface ValidationFixtureCase {
  readonly id: string;
  readonly ruleId: string;
  readonly code: string;
  readonly environment: ValidationEnvironment;
  readonly target: ValidationTarget;
  readonly severity: string;
  readonly path: string;
  readonly autoFix: boolean;
}

interface ValidationFixture {
  readonly catalogVersion: string;
  readonly cases: readonly ValidationFixtureCase[];
}

function serviceConfiguration(serviceId: string, values: unknown = {}) {
  const service = awsCatalogV1.requireService(serviceId);
  const result = awsCatalogV1.validateConfiguration(serviceId, values);
  if (!result.success) {
    throw new TypeError(`Invalid test service configuration: ${serviceId}.`);
  }
  return {
    schemaId: service.configuration.schemaId,
    schemaVersion: service.configuration.schemaVersion,
    values: result.values,
  };
}

function rawServiceConfiguration(
  serviceId: string,
  values: unknown,
): TestNode["semantic"]["configuration"] {
  const service = awsCatalogV1.requireService(serviceId);
  return {
    schemaId: service.configuration.schemaId,
    schemaVersion: service.configuration.schemaVersion,
    values,
  } as TestNode["semantic"]["configuration"];
}

function connectionConfiguration(ruleId: string, values: unknown = {}) {
  const rule = awsCatalogV1.getConnectionRule(ruleId);
  if (rule === undefined) {
    throw new TypeError(`Unknown test connection rule: ${ruleId}.`);
  }
  const result = validateProviderConfigurationV1(rule.configuration, values);
  if (!result.success) {
    throw new TypeError(`Invalid test connection configuration: ${ruleId}.`);
  }
  return {
    schemaId: rule.configuration.schemaId,
    schemaVersion: rule.configuration.schemaVersion,
    values: result.values,
  };
}

function rawConnectionConfiguration(
  ruleId: string,
  values: unknown,
): TestEdge["semantic"]["configuration"] {
  const rule = awsCatalogV1.getConnectionRule(ruleId);
  if (rule === undefined) {
    throw new TypeError(`Unknown test connection rule: ${ruleId}.`);
  }
  return {
    schemaId: rule.configuration.schemaId,
    schemaVersion: rule.configuration.schemaVersion,
    values,
  } as TestEdge["semantic"]["configuration"];
}

function node(
  id: string,
  serviceId: string,
  configuration = serviceConfiguration(serviceId),
): TestNode {
  const service = awsCatalogV1.requireService(serviceId);
  if (service.nodeKind.kind !== "resource") {
    throw new TypeError("Validation fixtures require resource services.");
  }
  return {
    id,
    semantic: {
      deploymentKey: id.replaceAll("-", "_"),
      serviceType: service.id,
      resourceType: service.nodeKind.resourceType,
      configuration,
      lifecycle: {
        ownership: "user",
        origin: "user",
      },
    },
    presentation: {
      label: service.displayName,
      position: { x: 0, y: 0 },
    },
  } as unknown as TestNode;
}

function edge(
  id: string,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string,
  relationshipType: string,
  configuration: TestEdge["semantic"]["configuration"],
): TestEdge {
  return {
    id,
    semantic: {
      source: { nodeId: sourceNodeId, port: sourcePort },
      target: { nodeId: targetNodeId, port: targetPort },
      relationshipType,
      configuration,
      lifecycle: {
        ownership: "user",
        origin: "user",
      },
    },
  } as TestEdge;
}

function document(
  nodes: readonly TestNode[],
  edges: readonly TestEdge[] = [],
): ArchitectureDocumentV1 {
  return {
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 1,
    documentId: "validation_document",
    architectureId: "validation_architecture",
    revision: {
      revisionId: "validation_revision",
      revisionNumber: 1,
      createdAt: "2026-07-24T12:00:00Z",
      createdBy: "validation_actor",
    },
    provider: {
      id: awsCatalogArtifactV1.provider.id,
      region: "us-east-1",
    },
    catalog: {
      id: awsCatalogArtifactV1.catalog.id,
      version: awsCatalogArtifactV1.catalog.version,
      digest: awsCatalogArtifactV1.digest,
    },
    compilerCompatibility: {
      inputContractVersion: 1,
      minimumCompilerVersion: "0.1.0",
    },
    metadata: {
      source: "user",
      serialization: {
        mediaType: "application/json",
        encoding: "utf-8",
        canonicalization: "cloudmarkup.canonical-json.v1",
      },
    },
    nodes: [...nodes],
    edges: [...edges],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
  } as unknown as ArchitectureDocumentV1;
}

type TestTriggerDispatch =
  | { readonly mode: "single" }
  | {
      readonly mode: "user-provided";
      readonly dispatcherOperationId: string;
    }
  | {
      readonly mode: "generated-supported";
      readonly dispatcherId: string;
      readonly dispatcherVersion: string;
      readonly dispatcherOperationId: string;
    };

function lambdaWorkloadDocument(options?: {
  readonly triggerEdges?: readonly TestEdge[];
  readonly inputContracts?: readonly (string | null)[];
  readonly triggerDispatch?: TestTriggerDispatch;
  readonly runtimeFamily?: string;
  readonly handler?: string;
}): ArchitectureDocumentV2 {
  const triggerEdges = options?.triggerEdges ?? [];
  const operationCount = Math.max(triggerEdges.length, 1);
  const operations = Array.from({ length: operationCount }, (_, index) => {
    const configuredContract = options?.inputContracts?.[index];
    const contractId =
      configuredContract ?? "aws.lambda.contract.request-envelope";
    return {
      id: `lambda_operation_${String(index)}`,
      capability: "aws.lambda.operation.handle-request",
      inputContract:
        configuredContract === null
          ? { kind: "none" as const }
          : {
              kind: "contract-reference" as const,
              reference: {
                contractId,
                contractVersion: "1.0.0",
                digest:
                  contractId === "aws.lambda.contract.alternate-envelope"
                    ? "sha256:2222222222222222222222222222222222222222222222222222222222222222"
                    : "sha256:1111111111111111111111111111111111111111111111111111111111111111",
              },
            },
      outputContract: { kind: "none" as const },
    };
  });
  const base = document(
    [
      node("api", "aws.apigateway.http-api"),
      node("lambda", "aws.lambda.function"),
      node("role", "aws.iam.role"),
      node("role2", "aws.iam.role"),
    ],
    triggerEdges,
  );

  return {
    ...base,
    schemaVersion: 2,
    workloadBehavior: {
      contractVersion: 1,
      workloads: [
        {
          id: "lambda_workload",
          owningNodeId: "lambda",
          implementation: {
            mode: "user-provided",
            runtimeFamily:
              options?.runtimeFamily ?? "aws.lambda.runtime-family.nodejs24",
            handler: options?.handler ?? "index.handler",
            sourceOwnership: "user",
          },
          operations,
          triggers: triggerEdges.map((triggerEdge, index) => ({
            id: `lambda_trigger_${String(index)}`,
            edgeId: triggerEdge.id,
            targetOperationId: `lambda_operation_${String(index)}`,
          })),
          downstreamActions: [],
          environment: [],
          errorBehavior: { mode: "fail-invocation" },
          executionAssumptions: {
            timeout: { kind: "unresolved" },
            retry: { kind: "unresolved" },
          },
          triggerDispatch: options?.triggerDispatch ?? { mode: "single" },
          unresolvedRequirementIds: [],
        },
      ],
    },
  } as unknown as ArchitectureDocumentV2;
}

function valuesWithout(
  configuration: TestNode["semantic"]["configuration"],
  key: string,
) {
  return Object.fromEntries(
    Object.entries(configuration.values).filter(
      ([candidate]) => candidate !== key,
    ),
  ) as TestNode["semantic"]["configuration"]["values"];
}

function publicRouteDocument() {
  return document(
    [
      node("api", "aws.apigateway.http-api"),
      node("lambda", "aws.lambda.function"),
    ],
    [
      edge(
        "api_lambda",
        "api",
        "aws.apigateway.http-api.invocation",
        "lambda",
        "aws.lambda.function.synchronous-invocation",
        "aws.apigateway.integrates-lambda",
        connectionConfiguration("aws.apigateway.http-api-invokes-lambda", {
          routeKey: { kind: "string", value: "GET /notes" },
        }),
      ),
    ],
  );
}

function authenticatedRouteDocument(mismatchedPools = false) {
  const publicRoute = publicRouteDocument();
  const issuerPoolId = "issuer-pool";
  const appClientPoolId = mismatchedPools ? "client-pool" : issuerPoolId;
  const appClient = node("app-client", "aws.cognito.user-pool-client");
  const containedAppClient = {
    ...appClient,
    semantic: {
      ...appClient.semantic,
      parent: {
        nodeId: appClientPoolId,
        relationshipType: "aws.cognito.contains-app-client",
      },
    },
  } as TestNode;
  return document(
    [
      ...publicRoute.nodes,
      node(issuerPoolId, "aws.cognito.user-pool"),
      ...(mismatchedPools
        ? [node(appClientPoolId, "aws.cognito.user-pool")]
        : []),
      containedAppClient,
    ],
    [
      ...publicRoute.edges,
      edge(
        "pool_api",
        issuerPoolId,
        "aws.cognito.user-pool.jwt-issuer",
        "api",
        "aws.apigateway.http-api.jwt-issuer",
        "aws.cognito.provides-jwt-issuer",
        connectionConfiguration("aws.cognito.user-pool-authorizes-http-api"),
      ),
      edge(
        "client_api",
        "app-client",
        "aws.cognito.user-pool-client.jwt-audience",
        "api",
        "aws.apigateway.http-api.jwt-audience",
        "aws.cognito.provides-jwt-audience",
        connectionConfiguration("aws.cognito.app-client-authorizes-http-api"),
      ),
      edge(
        "pool_client",
        appClientPoolId,
        "aws.cognito.user-pool.app-client-parent",
        "app-client",
        "aws.cognito.user-pool-client.user-pool",
        "aws.cognito.contains-app-client",
        connectionConfiguration("aws.cognito.user-pool-configures-app-client"),
      ),
    ],
  );
}

function lambdaRoleDocument() {
  return document(
    [node("role", "aws.iam.role"), node("lambda", "aws.lambda.function")],
    [
      edge(
        "role_lambda",
        "role",
        "aws.iam.role.assumable-role",
        "lambda",
        "aws.lambda.function.execution-role",
        "aws.iam.role-assumed-by-lambda",
        connectionConfiguration("aws.iam.role-assumed-by-lambda"),
      ),
    ],
  );
}

function canonicalTrustGraph(roleId = "role", suffix = "") {
  const idSuffix = suffix.length === 0 ? "" : `_${suffix}`;
  const statementSuffix = suffix.replaceAll("_", "");
  const policyDocument = node(
    `trust_policy${idSuffix}`,
    "aws.iam.policy-document",
    serviceConfiguration("aws.iam.policy-document", {
      policyName: {
        kind: "string",
        value: `RoleTrust${statementSuffix}`,
      },
      policyKind: { kind: "string", value: "trust" },
    }),
  );
  const statement = node(
    `trust_statement${idSuffix}`,
    "aws.iam.policy-statement",
    serviceConfiguration("aws.iam.policy-statement", {
      statementId: {
        kind: "string",
        value: `RoleTrust${statementSuffix}`,
      },
      effect: { kind: "string", value: "allow" },
      actions: {
        kind: "string-list",
        value: ["sts:AssumeRole"],
      },
      principalKind: { kind: "string", value: "service" },
      principals: {
        kind: "string-list",
        value: ["lambda.amazonaws.com"],
      },
      resourceExpressions: { kind: "string-list", value: [] },
    }),
  );
  const parentedDocument = {
    ...policyDocument,
    semantic: {
      ...policyDocument.semantic,
      parent: {
        nodeId: roleId,
        relationshipType: "aws.iam.role-owns-trust-policy",
      },
    },
  } as TestNode;
  const parentedStatement = {
    ...statement,
    semantic: {
      ...statement.semantic,
      parent: {
        nodeId: parentedDocument.id,
        relationshipType: "aws.iam.policy-contains-statement",
      },
    },
  } as TestNode;
  return {
    nodes: [parentedDocument, parentedStatement],
    edges: [
      edge(
        `trust_role${idSuffix}`,
        parentedDocument.id,
        "aws.iam.policy-document.role-trust-policy",
        roleId,
        "aws.iam.role.trust-policy",
        "aws.iam.role-owns-trust-policy",
        connectionConfiguration("aws.iam.role-owns-trust-policy"),
      ),
      edge(
        `trust_membership${idSuffix}`,
        parentedStatement.id,
        "aws.iam.policy-statement.policy-document",
        parentedDocument.id,
        "aws.iam.policy-document.statement",
        "aws.iam.policy-contains-statement",
        connectionConfiguration("aws.iam.policy-contains-statement"),
      ),
    ],
  } as const;
}

function iamWildcardDocument(key: "actions" | "resourceNode") {
  const base = serviceConfiguration("aws.iam.policy-statement", {
    actions: {
      kind: "string-list",
      value: ["dynamodb:GetItem"],
    },
    resourceNode: {
      kind: "node-reference",
      nodeId: "table",
      attribute: "aws.dynamodb.table.arn",
    },
  });
  const values = {
    ...base.values,
    ...(key === "actions"
      ? { actions: { kind: "string-list" as const, value: ["dynamodb:*"] } }
      : { resourceNode: { kind: "string" as const, value: "*" } }),
  };
  return document([
    node(
      "policy",
      "aws.iam.policy-statement",
      rawServiceConfiguration("aws.iam.policy-statement", values),
    ),
  ]);
}

function lambdaDynamoDocument() {
  return document(
    [
      node("lambda", "aws.lambda.function"),
      node("table", "aws.dynamodb.table"),
    ],
    [
      edge(
        "lambda_table",
        "lambda",
        "aws.lambda.function.data-write",
        "table",
        "aws.dynamodb.table.table-api",
        "aws.lambda.writes-dynamodb-table",
        rawConnectionConfiguration("aws.lambda.writes-dynamodb-table", {}),
      ),
    ],
  );
}

function lambdaDynamoPermissionsDocument() {
  const policyDocument = node(
    "policy_document",
    "aws.iam.policy-document",
    serviceConfiguration("aws.iam.policy-document", {
      policyName: { kind: "string", value: "DynamoDbWriteAccess" },
      policyKind: { kind: "string", value: "generated-permission" },
    }),
  );
  const attachedPolicyDocument = {
    ...policyDocument,
    semantic: {
      ...policyDocument.semantic,
      parent: {
        nodeId: "role",
        relationshipType: "aws.iam.role-owns-generated-permission",
      },
    },
  } as TestNode;
  const statement = node(
    "policy_statement",
    "aws.iam.policy-statement",
    serviceConfiguration("aws.iam.policy-statement", {
      actions: {
        kind: "string-list",
        value: [
          "dynamodb:DeleteItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
        ],
      },
      resourceNode: {
        kind: "node-reference",
        nodeId: "table",
        attribute: "aws.dynamodb.table.arn",
      },
    }),
  );
  const attachedStatement = {
    ...statement,
    semantic: {
      ...statement.semantic,
      parent: {
        nodeId: "policy_document",
        relationshipType: "aws.iam.policy-contains-statement",
      },
    },
  } as TestNode;

  return document(
    [
      node("role", "aws.iam.role"),
      node("lambda", "aws.lambda.function"),
      node("table", "aws.dynamodb.table"),
      attachedPolicyDocument,
      attachedStatement,
    ],
    [
      ...lambdaRoleDocument().edges,
      edge(
        "lambda_table",
        "lambda",
        "aws.lambda.function.data-write",
        "table",
        "aws.dynamodb.table.table-api",
        "aws.lambda.writes-dynamodb-table",
        connectionConfiguration("aws.lambda.writes-dynamodb-table"),
      ),
      edge(
        "policy_document_role",
        "policy_document",
        "aws.iam.policy-document.role-generated-permission",
        "role",
        "aws.iam.role.generated-permission",
        "aws.iam.role-owns-generated-permission",
        connectionConfiguration("aws.iam.role-owns-generated-permission"),
      ),
      edge(
        "policy_statement_document",
        "policy_statement",
        "aws.iam.policy-statement.policy-document",
        "policy_document",
        "aws.iam.policy-document.statement",
        "aws.iam.policy-contains-statement",
        connectionConfiguration("aws.iam.policy-contains-statement"),
      ),
      edge(
        "policy_table",
        "policy_statement",
        "aws.iam.policy-statement.dynamodb-resource",
        "table",
        "aws.dynamodb.table.policy-resource",
        "aws.iam.authorizes-dynamodb-table",
        connectionConfiguration(
          "aws.iam.policy-statement-authorizes-dynamodb-table",
        ),
      ),
    ],
  );
}

function dynamoProtectionDocument(options: {
  readonly omitEncryption?: boolean;
  readonly encryption?: boolean;
  readonly recovery?: boolean;
  readonly generated?: boolean;
}) {
  const base = serviceConfiguration("aws.dynamodb.table");
  const withoutEncryption = valuesWithout(base, "serverSideEncryptionEnabled");
  const values = {
    ...(options.omitEncryption ? withoutEncryption : base.values),
    ...(options.encryption === undefined
      ? {}
      : {
          serverSideEncryptionEnabled: {
            kind: "boolean" as const,
            value: options.encryption,
          },
        }),
    pointInTimeRecoveryEnabled: {
      kind: "boolean" as const,
      value: options.recovery ?? true,
    },
  };
  const table = node(
    "table",
    "aws.dynamodb.table",
    rawServiceConfiguration("aws.dynamodb.table", values),
  );
  if (!options.generated) {
    return document([table]);
  }
  return document([
    {
      ...table,
      semantic: {
        ...table.semantic,
        lifecycle: {
          ownership: "generated",
          origin: "connection-rule",
          provenance: {
            generatorKind: "connection-rule",
            generatorId: "aws.lambda.writes-dynamodb-table",
            generatorVersion: "1.0.0",
            operationId: "validation_generated_table",
            dependentNodeIds: [],
            dependentEdgeIds: [],
          },
        },
      },
    } as unknown as TestNode,
  ]);
}

function logRetentionDocument() {
  const base = serviceConfiguration("aws.cloudwatch.log-group");
  return document([
    node(
      "logs",
      "aws.cloudwatch.log-group",
      rawServiceConfiguration(
        "aws.cloudwatch.log-group",
        valuesWithout(base, "retentionDays"),
      ),
    ),
  ]);
}

function lambdaBoundsDocument(key: "timeoutSeconds" | "memoryMegabytes") {
  const base = serviceConfiguration("aws.lambda.function");
  return document([
    node(
      "lambda",
      "aws.lambda.function",
      rawServiceConfiguration("aws.lambda.function", {
        ...base.values,
        [key]: {
          kind: "integer" as const,
          value: key === "timeoutSeconds" ? 0 : 999,
        },
      }),
    ),
  ]);
}

function fixtureDocument(id: string): ArchitectureDocumentV1 {
  switch (id) {
    case "public-route-development":
    case "public-route-production":
      return publicRouteDocument();
    case "iam-wildcard-action":
      return iamWildcardDocument("actions");
    case "iam-wildcard-resource":
      return iamWildcardDocument("resourceNode");
    case "lambda-role-missing":
      return document([node("lambda", "aws.lambda.function")]);
    case "lambda-dynamodb-actions-missing":
      return lambdaDynamoDocument();
    case "dynamodb-encryption-missing":
      return dynamoProtectionDocument({ omitEncryption: true });
    case "dynamodb-recovery-production":
      return dynamoProtectionDocument({ recovery: false });
    case "log-retention-absent":
      return logRetentionDocument();
    case "lambda-timeout-invalid":
      return lambdaBoundsDocument("timeoutSeconds");
    case "lambda-memory-invalid":
      return lambdaBoundsDocument("memoryMegabytes");
    case "connection-question-unresolved":
      return (() => {
        const candidate = publicRouteDocument();
        const route = candidate.edges[0];
        if (route === undefined) {
          throw new TypeError("Expected the public route edge.");
        }
        route.semantic.configuration = rawConnectionConfiguration(
          "aws.apigateway.http-api-invokes-lambda",
          {},
        );
        return candidate;
      })();
    case "region-availability-unknown":
      return document([node("lambda", "aws.lambda.function")]);
    default:
      throw new TypeError(`Unknown validation fixture case: ${id}.`);
  }
}

async function readValidationFixture(): Promise<ValidationFixture> {
  return JSON.parse(
    await readFile(
      new URL("../fixtures/notes-api/validation-cases.json", import.meta.url),
      "utf8",
    ),
  ) as ValidationFixture;
}

function ruleById(ruleId: string) {
  const registration = awsValidationRuleRegistrationsV1.find(
    (candidate) => candidate.rule.id === ruleId,
  );
  if (registration === undefined) {
    throw new TypeError(`Missing validation rule registration: ${ruleId}.`);
  }
  return registration.rule;
}

describe("AWS notes API validation rules v1", () => {
  it("rejects alarm M greater than N without changing valid M-out-of-N intent", () => {
    for (const [m, n] of [
      [1, 1],
      [2, 3],
      [3, 3],
      [2, 1],
      [5, 1],
    ] as const) {
      const architecture = document([
        node(
          "alarm",
          "aws.cloudwatch.metric-alarm",
          serviceConfiguration("aws.cloudwatch.metric-alarm", {
            datapointsToAlarm: { kind: "integer", value: m },
            evaluationPeriods: { kind: "integer", value: n },
          }),
        ),
      ]);
      const validate = () =>
        executeArchitectureValidationRules(
          {
            document: architecture,
            target: "compilation",
            environment: "production",
          },
          [ruleById("aws.cloudmarkup.validation.compiler-readiness")],
        );
      const report = validate();
      expect(validate()).toEqual(report);
      const invalid = report.findings.filter(
        (f) => f.code === "aws.validation.alarm-datapoints-exceed-periods",
      );
      expect(invalid).toHaveLength(m > n ? 1 : 0);
      if (m > n) {
        expect(invalid[0]?.severity).toBe("error");
        expect(invalid[0]?.affected).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "configuration",
              owner: { kind: "node", nodeId: "alarm" },
              key: "datapointsToAlarm",
            }),
            expect.objectContaining({
              kind: "configuration",
              owner: { kind: "node", nodeId: "alarm" },
              key: "evaluationPeriods",
            }),
          ]),
        );
        expect(invalid[0]?.autoFix).toBeUndefined();
      }
    }
  });
  it("rejects the reserved aws/ log prefix while retaining /aws/ and ordinary names", () => {
    for (const name of [
      "aws/application",
      "/aws/lambda/notes-api-handler",
      "aws-application",
    ]) {
      const rejected = name.startsWith("aws/");
      const values = {
        ...serviceConfiguration("aws.cloudwatch.log-group").values,
        logGroupName: { kind: "string" as const, value: name },
      };
      // Uses reviewed source metadata; artifact regeneration is integration-owned.
      expect
        .soft(
          validateProviderConfigurationV1(
            cloudWatchLogGroup.configuration,
            values,
          ).success,
        )
        .toBe(!rejected);
      const report = executeArchitectureValidationRules(
        {
          document: document([
            node(
              "logs",
              "aws.cloudwatch.log-group",
              rawServiceConfiguration("aws.cloudwatch.log-group", values),
            ),
          ]),
          target: "compilation",
          environment: "production",
        },
        [ruleById("aws.cloudmarkup.validation.log-retention")],
      );
      const invalid = report.findings.filter(
        (f) => f.code === "aws.validation.log-group-name-reserved",
      );
      expect(invalid).toHaveLength(rejected ? 1 : 0);
      if (rejected) {
        expect(invalid[0]).toMatchObject({
          severity: "error",
          affected: [
            expect.objectContaining({
              kind: "configuration",
              owner: { kind: "node", nodeId: "logs" },
              key: "logGroupName",
            }),
          ],
        });
        expect(invalid[0]?.autoFix).toBeUndefined();
      }
    }
  });
  it("fails closed when a recognized catalog version has a substituted digest", () => {
    const changed = document([node("lambda", "aws.lambda.function")]);
    changed.catalog = {
      ...changed.catalog,
      digest: "sha256:" + "0".repeat(64),
    } as typeof changed.catalog;
    const report = executeArchitectureValidationRules(
      { document: changed, target: "compilation", environment: "production" },
      [ruleById("aws.cloudmarkup.validation.lambda-execution-role")],
    );
    expect(report.evaluationStatus).toBe("incomplete");
    expect(report.diagnostics.map(({ code }) => code)).toContain(
      "rule_execution_failed",
    );
  });
  it("keeps descriptor and implementation IDs stable and evaluates every fixture deterministically", async () => {
    const fixture = await readValidationFixture();
    expect(fixture.catalogVersion).toBe(awsCatalogArtifactV1.catalog.version);
    expect(
      awsValidationRuleRegistrationsV1.map((registration) =>
        String(registration.rule.id),
      ),
    ).toEqual([
      "aws.cloudmarkup.validation.regional-waf-readiness",
      "aws.cloudmarkup.validation.ebs-readiness",
      "aws.cloudmarkup.validation.elb-readiness",
      "aws.cloudmarkup.validation.cloudfront-readiness",
      "aws.cloudmarkup.validation.dns-certificate-readiness",
      "aws.cloudmarkup.validation.aurora-postgres-readiness",
      "aws.cloudmarkup.validation.rds-postgres-readiness",
      "aws.cloudmarkup.validation.ecs-fargate-readiness",
      "aws.cloudmarkup.validation.ec2-readiness",
      "aws.cloudmarkup.validation.secret-readiness",
      "aws.cloudmarkup.validation.kms-key-readiness",
      "aws.cloudmarkup.validation.s3-bucket-name",
      "aws.cloudmarkup.validation.s3-notification-filters",
      "aws.cloudmarkup.validation.fsx-storage-capacity",
      "aws.cloudmarkup.validation.fsx-readiness",
      "aws.cloudmarkup.validation.api-route-authentication",
      "aws.cloudmarkup.validation.iam-wildcards",
      "aws.cloudmarkup.validation.iam-policy-safety",
      "aws.cloudmarkup.validation.lambda-execution-role",
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.lambda-trigger-compatibility",
      "aws.cloudmarkup.validation.lambda-dynamodb-actions",
      "aws.cloudmarkup.validation.dynamodb-protection",
      "aws.cloudmarkup.validation.log-retention",
      "aws.cloudmarkup.validation.lambda-runtime-bounds",
      "aws.cloudmarkup.validation.connection-questions",
      "aws.cloudmarkup.validation.region-availability",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.network-placement",
      "aws.cloudmarkup.validation.network-routing",
      "aws.cloudmarkup.validation.event-topology",
      "aws.cloudmarkup.validation.event-delivery",
      "aws.cloudmarkup.validation.security-group-policy",
      "aws.cloudmarkup.validation.lambda-vpc-access",
    ]);

    for (const fixtureCase of fixture.cases) {
      const request = {
        document: fixtureDocument(fixtureCase.id),
        target: fixtureCase.target,
        environment: fixtureCase.environment,
      };
      const rule = ruleById(fixtureCase.ruleId);
      const first = executeArchitectureValidationRules(request, [rule]);
      const second = executeArchitectureValidationRules(
        structuredClone(request),
        [rule],
      );
      const result = first.findings.find(
        (candidate) => candidate.code === fixtureCase.code,
      );

      expect(first, fixtureCase.id).toEqual(second);
      expect(first.diagnostics, fixtureCase.id).toEqual([]);
      expect(result, fixtureCase.id).toMatchObject({
        severity: fixtureCase.severity,
        affected: [{ path: fixtureCase.path }],
        rules: [
          {
            ruleId: fixtureCase.ruleId,
            ruleVersion: "1.0.0",
          },
        ],
      });
      expect(result?.findingId, fixtureCase.id).toMatch(
        /^finding\.[a-f0-9]{64}$/u,
      );
      expect(result?.autoFix !== undefined, fixtureCase.id).toBe(
        fixtureCase.autoFix,
      );
    }
  });

  it("offers only the deterministic encryption-default fix", () => {
    const rule = ruleById("aws.cloudmarkup.validation.dynamodb-protection");
    const missing = executeArchitectureValidationRules(
      {
        document: dynamoProtectionDocument({ omitEncryption: true }),
        target: "draft",
        environment: "development",
      },
      [rule],
    );
    const encryptionFinding = missing.findings.find(
      (finding) =>
        finding.code === "aws.validation.dynamodb-encryption-not-enabled",
    );
    expect(encryptionFinding?.autoFix).toMatchObject({
      command: {
        kind: "batch",
        commands: [
          {
            kind: "update-node-configuration",
            nodeId: "table",
            configuration: {
              values: {
                serverSideEncryptionEnabled: {
                  kind: "boolean",
                  value: true,
                },
              },
            },
          },
        ],
      },
      changes: [
        expect.objectContaining({
          kind: "node-configuration-updated",
          nodeId: "table",
        }),
        expect.objectContaining({
          kind: "batch-applied",
          commandCount: 1,
        }),
      ],
      conflictsWithFindingIds: [],
    });

    for (const unsafeDocument of [
      dynamoProtectionDocument({ encryption: false }),
      dynamoProtectionDocument({
        omitEncryption: true,
        generated: true,
      }),
    ]) {
      const report = executeArchitectureValidationRules(
        {
          document: unsafeDocument,
          target: "draft",
          environment: "development",
        },
        [rule],
      );
      expect(
        report.findings.find(
          (finding) =>
            finding.code === "aws.validation.dynamodb-encryption-not-enabled",
        )?.autoFix,
      ).toBeUndefined();
    }

    const wildcardReport = executeArchitectureValidationRules(
      {
        document: iamWildcardDocument("actions"),
        target: "draft",
        environment: "development",
      },
      [ruleById("aws.cloudmarkup.validation.iam-wildcards")],
    );
    expect(wildcardReport.findings[0]?.autoFix).toBeUndefined();
  });

  it.each([
    "valid",
    "source-port",
    "target-port",
    "owner",
    "schema",
    "version",
    "kind",
    "duplicate",
    "table",
    "actions",
    "deny",
  ])("checks explicit inline DynamoDB permissions: %s", (variation) => {
    const candidate = structuredClone(lambdaDynamoPermissionsDocument());
    const policy = candidate.nodes.find((n) => n.id === "policy_document");
    const statement = candidate.nodes.find((n) => n.id === "policy_statement");
    const owner = candidate.edges.find((e) => e.id === "policy_document_role");
    const rule = awsCatalogV1.getConnectionRule(
      "aws.iam.role-owns-inline-policy",
    );
    if (!policy || !statement || !owner || !rule)
      throw Error("Missing synthetic policy");
    policy.semantic.configuration.values[
      configurationKeySchema.parse("policyKind")
    ] = {
      kind: "string",
      value: "identity-inline",
    };
    policy.semantic.parent = {
      nodeId: "role" as TestNode["id"],
      relationshipType: rule.relationshipType,
    };
    owner.semantic.relationshipType = rule.relationshipType;
    owner.semantic.source.port = rule.source.portId;
    owner.semantic.target.port = rule.target.portId;
    owner.semantic.configuration = connectionConfiguration(rule.id);
    switch (variation) {
      case "source-port":
        owner.semantic.source.port =
          "aws.iam.policy-document.role-trust-policy" as typeof owner.semantic.source.port;
        break;
      case "target-port":
        owner.semantic.target.port =
          "aws.iam.role.trust-policy" as typeof owner.semantic.target.port;
        break;
      case "owner":
        policy.semantic.parent.nodeId = "unrelated_role" as TestNode["id"];
        break;
      case "schema":
        owner.semantic.configuration.schemaId =
          "unrelated.attachment" as typeof owner.semantic.configuration.schemaId;
        break;
      case "version":
        owner.semantic.configuration.schemaVersion =
          semanticVersionSchema.parse("9.0.0");
        break;
      case "kind":
        policy.semantic.configuration.values[
          configurationKeySchema.parse("policyKind")
        ] = {
          kind: "string",
          value: "trust",
        };
        break;
      case "duplicate":
        candidate.edges.push({
          ...structuredClone(owner),
          id: "duplicate_owner" as TestEdge["id"],
        });
        break;
      case "table":
        statement.semantic.configuration.values[
          configurationKeySchema.parse("resourceNode")
        ] = {
          kind: "node-reference",
          nodeId: "unrelated_table" as TestNode["id"],
          attribute: "aws.dynamodb.table.arn" as never,
        };
        break;
      case "actions":
        statement.semantic.configuration.values[
          configurationKeySchema.parse("actions")
        ] = {
          kind: "string-list",
          value: ["dynamodb:GetItem"],
        };
        break;
      case "deny":
        statement.semantic.configuration.values[
          configurationKeySchema.parse("effect")
        ] = {
          kind: "string",
          value: "deny",
        };
        break;
    }
    const report = executeArchitectureValidationRules(
      { document: candidate, target: "revision", environment: "production" },
      [ruleById("aws.cloudmarkup.validation.lambda-dynamodb-actions")],
    );
    expect(report.findings.map((f) => f.code)).toEqual(
      variation === "valid"
        ? []
        : ["aws.validation.lambda-dynamodb-actions-missing"],
    );
    for (const finding of report.findings) {
      expect(finding.severity).toBe("security-error");
      expect(finding.autoFix).toBeUndefined();
    }
  });

  it("requires fully typed supporting relationships before clearing security findings", () => {
    const spoofedAuthentication = publicRouteDocument();
    spoofedAuthentication.edges.push(
      edge(
        "spoofed_issuer",
        "lambda",
        "aws.lambda.function.synchronous-invocation",
        "api",
        "aws.apigateway.http-api.jwt-issuer",
        "aws.cognito.provides-jwt-issuer",
        connectionConfiguration("aws.cognito.user-pool-authorizes-http-api"),
      ),
      edge(
        "spoofed_audience",
        "lambda",
        "aws.lambda.function.synchronous-invocation",
        "api",
        "aws.apigateway.http-api.jwt-audience",
        "aws.cognito.provides-jwt-audience",
        connectionConfiguration("aws.cognito.app-client-authorizes-http-api"),
      ),
    );
    const spoofedRole = document(
      [node("role", "aws.iam.role"), node("lambda", "aws.lambda.function")],
      [
        edge(
          "spoofed_role",
          "role",
          "aws.iam.role.trust-policy",
          "lambda",
          "aws.lambda.function.execution-role",
          "aws.iam.role-assumed-by-lambda",
          connectionConfiguration("aws.iam.role-assumed-by-lambda"),
        ),
      ],
    );
    const unattachedPolicy = lambdaDynamoPermissionsDocument();
    unattachedPolicy.edges = unattachedPolicy.edges.filter(
      (candidate) =>
        candidate.id !== "policy_role" && candidate.id !== "policy_table",
    );
    const mismatchedAuthentication = authenticatedRouteDocument(true);

    for (const [ruleId, candidateDocument, code] of [
      [
        "aws.cloudmarkup.validation.api-route-authentication",
        spoofedAuthentication,
        "aws.validation.public-api-route-without-authentication",
      ],
      [
        "aws.cloudmarkup.validation.api-route-authentication",
        mismatchedAuthentication,
        "aws.validation.public-api-route-without-authentication",
      ],
      [
        "aws.cloudmarkup.validation.lambda-execution-role",
        spoofedRole,
        "aws.validation.lambda-execution-role-missing",
      ],
      [
        "aws.cloudmarkup.validation.lambda-dynamodb-actions",
        unattachedPolicy,
        "aws.validation.lambda-dynamodb-actions-missing",
      ],
    ] as const) {
      const report = executeArchitectureValidationRules(
        {
          document: candidateDocument,
          target: "revision",
          environment: "production",
        },
        [ruleById(ruleId)],
      );
      expect(report.findings.map((finding) => finding.code)).toContain(code);
    }
  });

  it("does not emit findings for complete reviewed relationships and safe defaults", () => {
    const safePolicy = serviceConfiguration("aws.iam.policy-statement", {
      actions: {
        kind: "string-list",
        value: ["dynamodb:GetItem"],
      },
      resourceNode: {
        kind: "node-reference",
        nodeId: "table",
        attribute: "aws.dynamodb.table.arn",
      },
    });
    const cases = [
      {
        ruleId: "aws.cloudmarkup.validation.api-route-authentication",
        candidateDocument: authenticatedRouteDocument(),
      },
      {
        ruleId: "aws.cloudmarkup.validation.iam-wildcards",
        candidateDocument: document([
          node("policy", "aws.iam.policy-statement", safePolicy),
        ]),
      },
      {
        ruleId: "aws.cloudmarkup.validation.lambda-execution-role",
        candidateDocument: lambdaRoleDocument(),
      },
      {
        ruleId: "aws.cloudmarkup.validation.lambda-dynamodb-actions",
        candidateDocument: lambdaDynamoPermissionsDocument(),
      },
      {
        ruleId: "aws.cloudmarkup.validation.dynamodb-protection",
        candidateDocument: document([node("table", "aws.dynamodb.table")]),
      },
      {
        ruleId: "aws.cloudmarkup.validation.log-retention",
        candidateDocument: document([node("logs", "aws.cloudwatch.log-group")]),
      },
      {
        ruleId: "aws.cloudmarkup.validation.lambda-runtime-bounds",
        candidateDocument: document([node("lambda", "aws.lambda.function")]),
      },
      {
        ruleId: "aws.cloudmarkup.validation.connection-questions",
        candidateDocument: publicRouteDocument(),
      },
    ] as const;

    for (const { ruleId, candidateDocument } of cases) {
      const report = executeArchitectureValidationRules(
        {
          document: candidateDocument,
          target: "revision",
          environment: "production",
        },
        [ruleById(ruleId)],
      );
      expect(report.findings, ruleId).toEqual([]);
      expect(report.diagnostics, ruleId).toEqual([]);
    }
  });

  it("reports loaded execution-role cardinality violations with exact edge paths", () => {
    const candidate = document(
      [
        node("lambda", "aws.lambda.function"),
        node("role", "aws.iam.role"),
        node("role2", "aws.iam.role"),
      ],
      [
        edge(
          "role_lambda_a",
          "role",
          "aws.iam.role.assumable-role",
          "lambda",
          "aws.lambda.function.execution-role",
          "aws.iam.role-assumed-by-lambda",
          connectionConfiguration("aws.iam.role-assumed-by-lambda"),
        ),
        edge(
          "role_lambda_b",
          "role2",
          "aws.iam.role.assumable-role",
          "lambda",
          "aws.lambda.function.execution-role",
          "aws.iam.role-assumed-by-lambda",
          connectionConfiguration("aws.iam.role-assumed-by-lambda"),
        ),
      ],
    );
    const cardinality = executeArchitectureValidationRules(
      {
        document: candidate,
        target: "revision",
        environment: "production",
      },
      [ruleById("aws.cloudmarkup.validation.connection-cardinality")],
    );
    for (const code of [
      "aws.validation.connection-target-port-cardinality-exceeded",
      "aws.validation.connection-target-cardinality-exceeded",
    ]) {
      const finding = cardinality.findings.find(
        (candidateFinding) => candidateFinding.code === code,
      );
      expect(finding?.affected.map((location) => location.path)).toEqual([
        code.includes("target-port")
          ? "$.edges[0].semantic.target.port"
          : "$.edges[0].semantic.relationshipType",
        code.includes("target-port")
          ? "$.edges[1].semantic.target.port"
          : "$.edges[1].semantic.relationshipType",
      ]);
    }

    const role = executeArchitectureValidationRules(
      {
        document: candidate,
        target: "revision",
        environment: "production",
      },
      [ruleById("aws.cloudmarkup.validation.lambda-execution-role")],
    );
    expect(role.findings).toEqual([
      expect.objectContaining({
        code: "aws.validation.lambda-execution-role-duplicate",
        affected: [
          expect.objectContaining({
            path: "$.edges[0].semantic.target.port",
          }),
          expect.objectContaining({
            path: "$.edges[1].semantic.target.port",
          }),
        ],
      }),
    ]);
  });

  it("rejects workloads owned by unsupported AWS services for drafts and revisions", () => {
    const base = lambdaWorkloadDocument();
    const workload = base.workloadBehavior.workloads[0];
    if (workload === undefined) {
      throw new TypeError("Expected the Lambda workload fixture.");
    }
    const unsupportedOwner = {
      ...base,
      workloadBehavior: {
        ...base.workloadBehavior,
        workloads: [{ ...workload, owningNodeId: "role" }],
      },
    };
    const triggerRule = ruleById(
      "aws.cloudmarkup.validation.lambda-trigger-compatibility",
    );

    for (const target of ["draft", "revision"] as const) {
      const report = executeArchitectureValidationRules(
        {
          document: unsupportedOwner,
          target,
          environment: "production",
        },
        [triggerRule],
      );

      expect(report.diagnostics, target).toEqual([]);
      expect(report.findings, target).toEqual([
        expect.objectContaining({
          code: "aws.validation.workload-owner-unsupported",
          severity: "error",
          affected: [
            expect.objectContaining({
              kind: "document",
              path: "$.workloadBehavior.workloads[0].owningNodeId",
            }),
          ],
        }),
      ]);
      expect(report.findings[0]?.autoFix, target).toBeUndefined();
    }
  });

  it("requires every catalog trigger edge to bind a declared Lambda workload exactly", () => {
    const routeEdge = edge(
      "api_lambda_get",
      "api",
      "aws.apigateway.http-api.invocation",
      "lambda",
      "aws.lambda.function.synchronous-invocation",
      "aws.apigateway.integrates-lambda",
      connectionConfiguration("aws.apigateway.http-api-invokes-lambda", {
        routeKey: { kind: "string", value: "GET /notes" },
      }),
    );
    const base = lambdaWorkloadDocument({ triggerEdges: [routeEdge] });
    const workload = base.workloadBehavior.workloads[0];
    if (workload === undefined) {
      throw new TypeError("Expected the Lambda workload fixture.");
    }
    const missingBinding = {
      ...base,
      workloadBehavior: {
        ...base.workloadBehavior,
        workloads: [{ ...workload, triggers: [] }],
      },
    };
    const triggerRule = ruleById(
      "aws.cloudmarkup.validation.lambda-trigger-compatibility",
    );

    for (const [target, severity] of [
      ["draft", "warning"],
      ["revision", "error"],
      ["compilation", "error"],
    ] as const) {
      const report = executeArchitectureValidationRules(
        {
          document: missingBinding,
          target,
          environment: "production",
        },
        [triggerRule],
      );

      expect(report.diagnostics, target).toEqual([]);
      expect(report.findings, target).toEqual([
        expect.objectContaining({
          code: "aws.validation.lambda-trigger-binding-missing",
          severity,
          affected: [
            expect.objectContaining({
              kind: "edge",
              edgeId: routeEdge.id,
              path: "$.edges[0]",
            }),
            expect.objectContaining({
              kind: "document",
              path: "$.workloadBehavior.workloads[0].triggers",
            }),
          ],
        }),
      ]);
      expect(report.findings[0]?.autoFix, target).toBeUndefined();
    }

    const migratedWithoutWorkload = executeArchitectureValidationRules(
      {
        document: document(
          [
            node("api", "aws.apigateway.http-api"),
            node("lambda", "aws.lambda.function"),
          ],
          [routeEdge],
        ),
        target: "revision",
        environment: "production",
      },
      [triggerRule],
    );
    expect(migratedWithoutWorkload.findings).toEqual([]);
    expect(migratedWithoutWorkload.diagnostics).toEqual([]);
  });

  it("accepts homogeneous Lambda triggers and rejects non-trigger edges or incompatible dispatch", () => {
    const routeEdges = [
      edge(
        "api_lambda_get",
        "api",
        "aws.apigateway.http-api.invocation",
        "lambda",
        "aws.lambda.function.synchronous-invocation",
        "aws.apigateway.integrates-lambda",
        connectionConfiguration("aws.apigateway.http-api-invokes-lambda", {
          routeKey: { kind: "string", value: "GET /notes" },
        }),
      ),
      edge(
        "api_lambda_post",
        "api",
        "aws.apigateway.http-api.invocation",
        "lambda",
        "aws.lambda.function.synchronous-invocation",
        "aws.apigateway.integrates-lambda",
        connectionConfiguration("aws.apigateway.http-api-invokes-lambda", {
          routeKey: { kind: "string", value: "POST /notes" },
        }),
      ),
    ];
    const triggerRule = ruleById(
      "aws.cloudmarkup.validation.lambda-trigger-compatibility",
    );
    const homogeneous = executeArchitectureValidationRules(
      {
        document: lambdaWorkloadDocument({ triggerEdges: routeEdges }),
        target: "revision",
        environment: "production",
      },
      [triggerRule],
    );
    expect(homogeneous.findings).toEqual([]);

    const roleEdge = edge(
      "role_lambda",
      "role",
      "aws.iam.role.assumable-role",
      "lambda",
      "aws.lambda.function.execution-role",
      "aws.iam.role-assumed-by-lambda",
      connectionConfiguration("aws.iam.role-assumed-by-lambda"),
    );
    const invalidEdge = executeArchitectureValidationRules(
      {
        document: lambdaWorkloadDocument({ triggerEdges: [roleEdge] }),
        target: "revision",
        environment: "production",
      },
      [triggerRule],
    );
    expect(invalidEdge.findings).toEqual([
      expect.objectContaining({
        code: "aws.validation.lambda-trigger-edge-incompatible",
        severity: "error",
        affected: [
          expect.objectContaining({
            path: "$.workloadBehavior.workloads[0].triggers[0].edgeId",
          }),
        ],
      }),
    ]);

    for (const [target, severity] of [
      ["draft", "warning"],
      ["revision", "error"],
    ] as const) {
      const heterogeneous = executeArchitectureValidationRules(
        {
          document: lambdaWorkloadDocument({
            triggerEdges: routeEdges,
            inputContracts: [
              "aws.lambda.contract.request-envelope",
              "aws.lambda.contract.alternate-envelope",
            ],
          }),
          target,
          environment: "production",
        },
        [triggerRule],
      );
      expect(heterogeneous.findings).toEqual([
        expect.objectContaining({
          code: "aws.validation.lambda-incompatible-trigger-contracts",
          severity,
          affected: [
            expect.objectContaining({
              path: "$.workloadBehavior.workloads[0].triggers",
            }),
          ],
        }),
      ]);
    }

    const noContracts = executeArchitectureValidationRules(
      {
        document: lambdaWorkloadDocument({
          triggerEdges: routeEdges,
          inputContracts: [null, null],
        }),
        target: "revision",
        environment: "production",
      },
      [triggerRule],
    );
    expect(noContracts.findings[0]).toMatchObject({
      code: "aws.validation.lambda-incompatible-trigger-contracts",
      severity: "error",
    });

    const unreviewedDispatcher = executeArchitectureValidationRules(
      {
        document: lambdaWorkloadDocument({
          triggerEdges: routeEdges,
          inputContracts: [
            "aws.lambda.contract.request-envelope",
            "aws.lambda.contract.alternate-envelope",
          ],
          triggerDispatch: {
            mode: "generated-supported",
            dispatcherId: "aws.lambda.dispatcher.multi-trigger",
            dispatcherVersion: "1.0.0",
            dispatcherOperationId: "lambda_operation_0",
          },
        }),
        target: "revision",
        environment: "production",
      },
      [triggerRule],
    );
    expect(unreviewedDispatcher.findings).toEqual([
      expect.objectContaining({
        code: "aws.validation.lambda-trigger-dispatcher-not-reviewed",
        severity: "error",
        affected: [
          expect.objectContaining({
            path: "$.workloadBehavior.workloads[0].triggerDispatch",
          }),
        ],
      }),
    ]);
  });

  it("requires exact Lambda runtime-family and handler coherence without inference", () => {
    const runtimeRule = ruleById(
      "aws.cloudmarkup.validation.lambda-runtime-bounds",
    );
    const valid = executeArchitectureValidationRules(
      {
        document: lambdaWorkloadDocument(),
        target: "revision",
        environment: "production",
      },
      [runtimeRule],
    );
    expect(valid.findings).toEqual([]);

    for (const [target, severity] of [
      ["draft", "warning"],
      ["revision", "error"],
    ] as const) {
      const mismatch = executeArchitectureValidationRules(
        {
          document: lambdaWorkloadDocument({
            runtimeFamily: "aws.lambda.runtime-family.other",
            handler: "other.handler",
          }),
          target,
          environment: "production",
        },
        [runtimeRule],
      );
      expect(
        mismatch.findings.map((finding) => ({
          code: finding.code,
          severity: finding.severity,
          paths: finding.affected.map((location) => location.path),
        })),
      ).toEqual([
        {
          code: "aws.validation.lambda-workload-handler-mismatch",
          severity,
          paths: [
            "$.nodes[1].semantic.configuration.values.handler",
            "$.workloadBehavior.workloads[0].implementation.handler",
          ],
        },
        {
          code: "aws.validation.lambda-workload-runtime-mismatch",
          severity,
          paths: [
            "$.nodes[1].semantic.configuration.values.runtime",
            "$.workloadBehavior.workloads[0].implementation.runtimeFamily",
          ],
        },
      ]);
    }
  });

  it("distinguishes unavailable regions from explicit unknown availability", () => {
    const lambdaService = awsCatalogArtifactV1.services.find(
      (service) => service.id === "aws.lambda.function",
    );
    if (lambdaService === undefined) {
      throw new TypeError("The AWS fixture requires Lambda.");
    }
    const unavailableDocument = document([
      node("lambda", "aws.lambda.function"),
    ]);
    const catalog: AwsValidationCatalogV1 =
      providerCatalogArtifactV1Schema.parse({
        ...awsCatalogArtifactV1,
        services: awsCatalogArtifactV1.services.map((service) =>
          service.id === lambdaService.id
            ? {
                ...service,
                regionAvailability: {
                  state: "known",
                  coverage: "complete",
                  regions: [
                    {
                      region: unavailableDocument.provider.region,
                      availability: "unavailable",
                    },
                  ],
                },
              }
            : service,
        ),
      });
    const report = executeArchitectureValidationRules(
      {
        document: unavailableDocument,
        target: "revision",
        environment: "production",
      },
      [createRegionAvailabilityRuleV1(catalog)],
    );

    expect(report.findings).toEqual([
      expect.objectContaining({
        code: "aws.validation.region-unsupported",
        severity: "error",
        affected: [
          expect.objectContaining({
            path: "$.nodes[0].semantic.serviceType",
          }),
        ],
      }),
    ]);
  });

  it("accepts implemented Terraform mappings only for compilation targets", () => {
    const rule = ruleById("aws.cloudmarkup.validation.compiler-readiness");
    const policy = node(
      "policy",
      "aws.iam.policy-document",
      serviceConfiguration("aws.iam.policy-document", {
        policyKind: { kind: "string", value: "identity-inline" },
        policyName: { kind: "string", value: "ReadNotes" },
      }),
    );
    const draft = executeArchitectureValidationRules(
      {
        document: document([node("lambda", "aws.lambda.function"), policy]),
        target: "draft",
        environment: "production",
      },
      [rule],
    );
    const compilation = executeArchitectureValidationRules(
      {
        document: document([node("lambda", "aws.lambda.function"), policy]),
        target: "compilation",
        environment: "production",
      },
      [rule],
    );

    expect(draft.findings).toEqual([]);
    expect(draft.skippedRuleIds).toEqual([rule.id]);
    expect(compilation.findings).toEqual([]);

    const metadataOnlyCatalog: AwsValidationCatalogV1 = {
      ...awsCatalogArtifactV1,
      services: awsCatalogArtifactV1.services.map((service) =>
        service.id === "aws.lambda.function"
          ? {
              ...service,
              mappings: service.mappings.map((mapping) => ({
                ...mapping,
                implementationStatus: "metadata-only" as const,
              })),
            }
          : service,
      ),
    };
    const pending = executeArchitectureValidationRules(
      {
        document: document([node("lambda", "aws.lambda.function")]),
        target: "compilation",
        environment: "production",
      },
      [createCompilerReadinessRuleV1(metadataOnlyCatalog)],
    );
    expect(pending.findings[0]).toMatchObject({
      code: "aws.validation.compiler-target-not-implemented",
      severity: "error",
    });
  });

  it("accepts one graph-backed custom policy with exact actions and resource scope", () => {
    const role = node("role", "aws.iam.role");
    const policy = node(
      "policy",
      "aws.iam.policy-document",
      serviceConfiguration("aws.iam.policy-document", {
        policyName: { kind: "string", value: "ReadNotes" },
        policyKind: { kind: "string", value: "identity-inline" },
      }),
    );
    const statement = node(
      "statement",
      "aws.iam.policy-statement",
      serviceConfiguration("aws.iam.policy-statement", {
        statementId: { kind: "string", value: "ReadNotes" },
        effect: { kind: "string", value: "allow" },
        actions: {
          kind: "string-list",
          value: ["dynamodb:GetItem", "dynamodb:Query"],
        },
        principalKind: { kind: "string", value: "none" },
        principals: { kind: "string-list", value: [] },
        resourceExpressions: { kind: "string-list", value: [] },
      }),
    );
    const table = node("table", "aws.dynamodb.table");
    const trust = canonicalTrustGraph();
    const candidate = document(
      [role, ...trust.nodes, policy, statement, table],
      [
        ...trust.edges,
        edge(
          "policy_role",
          "policy",
          "aws.iam.policy-document.role-inline-policy",
          "role",
          "aws.iam.role.custom-inline-policy",
          "aws.iam.role-owns-inline-policy",
          connectionConfiguration("aws.iam.role-owns-inline-policy"),
        ),
        edge(
          "statement_policy",
          "statement",
          "aws.iam.policy-statement.policy-document",
          "policy",
          "aws.iam.policy-document.statement",
          "aws.iam.policy-contains-statement",
          connectionConfiguration("aws.iam.policy-contains-statement"),
        ),
        edge(
          "statement_table",
          "statement",
          "aws.iam.policy-statement.dynamodb-resource",
          "table",
          "aws.dynamodb.table.policy-resource",
          "aws.iam.authorizes-dynamodb-table",
          connectionConfiguration(
            "aws.iam.policy-statement-authorizes-dynamodb-table",
          ),
        ),
      ],
    );

    const report = executeArchitectureValidationRules(
      {
        document: candidate,
        target: "revision",
        environment: "production",
      },
      [ruleById("aws.cloudmarkup.validation.iam-policy-safety")],
    );

    expect(report.findings).toEqual([]);
  });

  it("reports principal misuse, wildcards, unsupported actions, and equivalent duplicates", () => {
    const role = node("role", "aws.iam.role");
    const policy = node(
      "policy",
      "aws.iam.policy-document",
      serviceConfiguration("aws.iam.policy-document", {
        policyName: { kind: "string", value: "UnsafeNotes" },
        policyKind: { kind: "string", value: "identity-inline" },
      }),
    );
    const unsafeConfiguration = serviceConfiguration(
      "aws.iam.policy-statement",
      {
        statementId: { kind: "string", value: "UnsafeNotes" },
        effect: { kind: "string", value: "allow" },
        actions: {
          kind: "string-list",
          value: ["dynamodb:*", "dynamodb:BatchWriteItem"],
        },
        principalKind: { kind: "string", value: "service" },
        principals: {
          kind: "string-list",
          value: ["lambda.amazonaws.com"],
        },
        resourceExpressions: {
          kind: "string-list",
          value: ["*"],
        },
      },
    );
    const first = node("statement_first", "aws.iam.policy-statement", {
      ...unsafeConfiguration,
      values: {
        ...unsafeConfiguration.values,
        statementId: { kind: "string", value: "UnsafeOne" },
      },
    });
    const duplicate = node("statement_duplicate", "aws.iam.policy-statement", {
      ...unsafeConfiguration,
      values: {
        ...unsafeConfiguration.values,
        statementId: { kind: "string", value: "UnsafeTwo" },
      },
    });
    const unsupported = node(
      "statement_unsupported",
      "aws.iam.policy-statement",
      {
        ...unsafeConfiguration,
        values: {
          ...unsafeConfiguration.values,
          statementId: { kind: "string", value: "UnsupportedAction" },
          actions: { kind: "string-list", value: ["dynamodb:BatchWriteItem"] },
        },
      },
    );
    const candidate = document(
      [role, policy, first, duplicate, unsupported],
      [
        edge(
          "policy_role",
          "policy",
          "aws.iam.policy-document.role-inline-policy",
          "role",
          "aws.iam.role.custom-inline-policy",
          "aws.iam.role-owns-inline-policy",
          connectionConfiguration("aws.iam.role-owns-inline-policy"),
        ),
        ...[first, duplicate, unsupported].map((statementNode, index) =>
          edge(
            `statement_policy_${String(index)}`,
            statementNode.id,
            "aws.iam.policy-statement.policy-document",
            "policy",
            "aws.iam.policy-document.statement",
            "aws.iam.policy-contains-statement",
            connectionConfiguration("aws.iam.policy-contains-statement"),
          ),
        ),
      ],
    );

    const report = executeArchitectureValidationRules(
      {
        document: candidate,
        target: "revision",
        environment: "production",
      },
      [ruleById("aws.cloudmarkup.validation.iam-policy-safety")],
    );

    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "aws.validation.iam-wildcard-action",
        "aws.validation.iam-wildcard-resource",
        "aws.validation.iam-action-service-unsupported",
        "aws.validation.iam-principal-invalid",
        "aws.validation.iam-statement-duplicate",
      ]),
    );
    const unsupportedFindings = report.findings.filter(
      (finding) =>
        finding.code === "aws.validation.iam-action-service-unsupported" &&
        finding.affected.some(
          (location) =>
            location.kind === "configuration" &&
            location.owner.kind === "node" &&
            location.owner.nodeId === unsupported.id &&
            location.key === "actions",
        ),
    );
    expect(unsupportedFindings).toHaveLength(1);
    expect(unsupportedFindings[0]?.severity).toBe("security-error");
    expect(unsupportedFindings[0]?.technicalExplanation).toContain(
      "dynamodb:BatchWriteItem",
    );
  });

  it("checks IAM catalog literals before graph policy safety without coercing values", () => {
    const rule = ruleById("aws.cloudmarkup.validation.iam-policy-safety");
    const statement = {
      actions: { kind: "string-list", value: ["s3:GetObject"] },
      resourceExpressions: {
        kind: "string-list",
        value: ["arn:aws:s3:::audit-bucket/object"],
      },
    } as const;
    const condition = {
      key: { kind: "string", value: "aws:RequestedRegion" },
      operator: { kind: "string", value: "StringEquals" },
      values: { kind: "string-list", value: ["us-east-1"] },
    } as const;
    const attachment = {
      attachmentKind: { kind: "string", value: "managed-policy-attachment" },
      displayName: { kind: "string", value: "AuditAttachment" },
      managedPolicyReference: {
        kind: "string",
        value: "aws-managed:service-role/AWSLambdaBasicExecutionRole",
      },
    } as const;
    for (const [serviceId, input, property, invalid] of [
      ["aws.iam.role", {}, "roleName", { kind: "string", value: "" }],
      [
        "aws.iam.role",
        {},
        "roleName",
        { kind: "string", value: "AuditRole\n" },
      ],
      [
        "aws.iam.role",
        {},
        "maxSessionDurationSeconds",
        { kind: "integer", value: 3599 },
      ],
      [
        "aws.iam.role",
        {},
        "maxSessionDurationSeconds",
        { kind: "string", value: "3600" },
      ],
      [
        "aws.iam.policy-document",
        {
          policyKind: { kind: "string", value: "identity-inline" },
          policyName: { kind: "string", value: "AuditPolicy" },
        },
        "policyName",
        { kind: "string", value: "" },
      ],
      [
        "aws.iam.managed-policy-attachment",
        attachment,
        "displayName",
        { kind: "string", value: "" },
      ],
      [
        "aws.iam.managed-policy-attachment",
        attachment,
        "managedPolicyReference",
        { kind: "string", value: "unreviewed" },
      ],
      [
        "aws.iam.policy-statement",
        statement,
        "actions",
        { kind: "string-list", value: [] },
      ],
      [
        "aws.iam.policy-statement",
        statement,
        "effect",
        { kind: "string", value: "unsupported" },
      ],
      [
        "aws.iam.policy-statement",
        statement,
        "resourceExpressions",
        {
          kind: "string-list",
          value: [
            "arn:aws:s3:::audit-bucket/object",
            "arn:aws:s3:::audit-bucket/object",
          ],
        },
      ],
      [
        "aws.iam.policy-statement",
        statement,
        "statementId",
        { kind: "string", value: "" },
      ],
      [
        "aws.iam.policy-statement",
        statement,
        "statementId",
        { kind: "string", value: "Bad_Sid" },
      ],
      [
        "aws.iam.policy-condition",
        condition,
        "key",
        { kind: "string", value: "" },
      ],
      [
        "aws.iam.policy-condition",
        condition,
        "operator",
        { kind: "string", value: "unsupported" },
      ],
      [
        "aws.iam.policy-condition",
        condition,
        "values",
        { kind: "string-list", value: [] },
      ],
      [
        "aws.iam.policy-condition",
        condition,
        "values",
        { kind: "string-list", value: ["us-east-1", "us-east-1"] },
      ],
    ] as const) {
      const valid = awsCatalogV1.validateConfiguration(serviceId, input);
      if (!valid.success) throw Error("Invalid reviewed IAM literal control");
      const evaluate = (values: unknown) =>
        executeArchitectureValidationRules(
          {
            document: document([
              node(
                "iam",
                serviceId,
                rawServiceConfiguration(serviceId, values),
              ),
            ]),
            target: "compilation",
            environment: "production",
          },
          [rule],
        ).findings.filter(
          (finding) =>
            finding.code === "aws.validation.iam-configuration-invalid",
        );
      expect(evaluate(valid.values)).toHaveLength(0);
      const values = { ...valid.values, [property]: invalid };
      expect(
        awsCatalogV1.validateConfiguration(serviceId, values).success,
      ).toBe(false);
      const before = structuredClone(values);
      expect(evaluate(values)).toEqual([
        expect.objectContaining({
          severity: "error",
          affected: [
            expect.objectContaining({ kind: "configuration", key: property }),
          ],
        }),
      ]);
      expect(values).toEqual(before);
    }
  });

  it("rejects account-wide IAM role name collisions without changing their spelling", () => {
    const rule = ruleById("aws.cloudmarkup.validation.iam-policy-safety");
    for (const otherName of ["Other-Role", "Audit-Role", "audit-role"]) {
      const trusts = [
        canonicalTrustGraph("first_role", "first"),
        canonicalTrustGraph("second_role", "second"),
      ];
      const candidate = document(
        [
          node(
            "first_role",
            "aws.iam.role",
            serviceConfiguration("aws.iam.role", {
              roleName: { kind: "string", value: "Audit-Role" },
            }),
          ),
          node(
            "second_role",
            "aws.iam.role",
            serviceConfiguration("aws.iam.role", {
              roleName: { kind: "string", value: otherName },
            }),
          ),
          ...trusts.flatMap((trust) => trust.nodes),
        ],
        trusts.flatMap((trust) => trust.edges),
      );
      const before = structuredClone(candidate);
      const report = executeArchitectureValidationRules(
        {
          document: candidate,
          target: "compilation",
          environment: "production",
        },
        [rule],
      );
      const failures = report.findings.filter(
        (finding) => finding.code === "aws.validation.iam-role-name-duplicate",
      );
      expect(failures).toHaveLength(otherName === "Other-Role" ? 0 : 1);
      if (failures.length > 0)
        expect(failures[0]).toMatchObject({
          severity: "error",
          affected: [
            {
              kind: "configuration",
              key: "roleName",
              owner: { nodeId: "first_role" },
            },
            {
              kind: "configuration",
              key: "roleName",
              owner: { nodeId: "second_role" },
            },
          ],
        });
      expect(report.findings).toHaveLength(failures.length);
      expect(candidate).toEqual(before);
    }
  });

  it("enforces one trust policy and at most one permissions boundary without limiting other role slots", () => {
    const rule = ruleById("aws.cloudmarkup.validation.iam-policy-safety");
    const missingDraft = executeArchitectureValidationRules(
      {
        document: document([node("role", "aws.iam.role")]),
        target: "draft",
        environment: "production",
      },
      [rule],
    );
    const missingRevision = executeArchitectureValidationRules(
      {
        document: document([node("role", "aws.iam.role")]),
        target: "revision",
        environment: "production",
      },
      [rule],
    );
    expect(missingDraft.findings).toEqual([
      expect.objectContaining({
        code: "aws.validation.iam-role-trust-policy-missing",
        severity: "warning",
      }),
    ]);
    expect(missingRevision.findings).toEqual([
      expect.objectContaining({
        code: "aws.validation.iam-role-trust-policy-missing",
        severity: "security-error",
      }),
    ]);

    const firstTrust = canonicalTrustGraph("role", "first");
    const oneTrust = executeArchitectureValidationRules(
      {
        document: document(
          [node("role", "aws.iam.role"), ...firstTrust.nodes],
          firstTrust.edges,
        ),
        target: "revision",
        environment: "production",
      },
      [rule],
    );
    expect(oneTrust.findings).toEqual([]);

    const secondTrust = canonicalTrustGraph("role", "second");
    const duplicateTrust = executeArchitectureValidationRules(
      {
        document: document(
          [
            node("role", "aws.iam.role"),
            ...firstTrust.nodes,
            ...secondTrust.nodes,
          ],
          [...firstTrust.edges, ...secondTrust.edges],
        ),
        target: "revision",
        environment: "production",
      },
      [rule],
    );
    expect(duplicateTrust.findings.map((finding) => finding.code)).toContain(
      "aws.validation.iam-role-trust-policy-duplicate",
    );

    const boundaryNodes = ["first", "second"].map((suffix) =>
      node(
        `boundary_${suffix}`,
        "aws.iam.managed-policy-attachment",
        serviceConfiguration("aws.iam.managed-policy-attachment", {
          displayName: {
            kind: "string",
            value: `Boundary ${suffix}`,
          },
          attachmentKind: {
            kind: "string",
            value: "permissions-boundary",
          },
          managedPolicyReference: {
            kind: "string",
            value: "aws-managed:ReadOnlyAccess",
          },
        }),
      ),
    );
    const boundaryEdges = boundaryNodes.map((boundaryNode, index) =>
      edge(
        `boundary_role_${String(index)}`,
        boundaryNode.id,
        "aws.iam.managed-policy-attachment.role-permissions-boundary",
        "role",
        "aws.iam.role.permissions-boundary",
        "aws.iam.role-owns-permissions-boundary",
        connectionConfiguration("aws.iam.role-owns-permissions-boundary"),
      ),
    );
    const duplicateBoundary = executeArchitectureValidationRules(
      {
        document: document(
          [node("role", "aws.iam.role"), ...firstTrust.nodes, ...boundaryNodes],
          [...firstTrust.edges, ...boundaryEdges],
        ),
        target: "revision",
        environment: "production",
      },
      [rule],
    );
    expect(duplicateBoundary.findings.map((finding) => finding.code)).toContain(
      "aws.validation.iam-role-permissions-boundary-duplicate",
    );
  });

  it("requires a principal on a trust-policy statement", () => {
    const role = node("role", "aws.iam.role");
    const policy = node(
      "trust_policy",
      "aws.iam.policy-document",
      serviceConfiguration("aws.iam.policy-document", {
        policyName: { kind: "string", value: "RoleTrust" },
        policyKind: { kind: "string", value: "trust" },
      }),
    );
    const statement = node(
      "trust_statement",
      "aws.iam.policy-statement",
      serviceConfiguration("aws.iam.policy-statement", {
        statementId: { kind: "string", value: "RoleTrust" },
        effect: { kind: "string", value: "allow" },
        actions: {
          kind: "string-list",
          value: ["sts:AssumeRole"],
        },
        principalKind: { kind: "string", value: "none" },
        principals: { kind: "string-list", value: [] },
        resourceExpressions: { kind: "string-list", value: [] },
      }),
    );
    const candidate = document(
      [role, policy, statement],
      [
        edge(
          "trust_role",
          "trust_policy",
          "aws.iam.policy-document.role-trust-policy",
          "role",
          "aws.iam.role.trust-policy",
          "aws.iam.role-owns-trust-policy",
          connectionConfiguration("aws.iam.role-owns-trust-policy"),
        ),
        edge(
          "statement_policy",
          "trust_statement",
          "aws.iam.policy-statement.policy-document",
          "trust_policy",
          "aws.iam.policy-document.statement",
          "aws.iam.policy-contains-statement",
          connectionConfiguration("aws.iam.policy-contains-statement"),
        ),
      ],
    );

    const report = executeArchitectureValidationRules(
      {
        document: candidate,
        target: "revision",
        environment: "production",
      },
      [ruleById("aws.cloudmarkup.validation.iam-policy-safety")],
    );

    expect(report.findings.map((finding) => finding.code)).toContain(
      "aws.validation.iam-principal-invalid",
    );
  });
});

describe("FSx capacity accuracy in the successor catalog", () => {
  it("rejects saved ONTAP throughput without choosing a more expensive value", () => {
    const service = "aws.fsx.ontap-file-system";
    for (const throughput of [384, 768, 1536, 3072, 6144]) {
      const graph = document([
        node(
          "storage",
          service,
          rawServiceConfiguration(service, {
            throughputCapacity: { kind: "integer", value: throughput },
          }),
        ),
      ]);
      const before = structuredClone(graph);
      const report = executeArchitectureValidationRules(
        { document: graph, target: "compilation", environment: "production" },
        [ruleById("aws.cloudmarkup.validation.fsx-readiness")],
      );
      const failures = report.findings.filter(
        (f) => f.code === "aws.validation.fsx-ontap-throughput",
      );
      expect(failures).toHaveLength(throughput < 1536 ? 1 : 0);
      if (throughput < 1536) {
        expect(failures[0]).toMatchObject({
          severity: "error",
          affected: [{ kind: "configuration", key: "throughputCapacity" }],
        });
        expect(failures[0]?.autoFix).toBeUndefined();
      }
      expect(graph).toEqual(before);
    }
  });
  const capacityRule = "aws.cloudmarkup.validation.fsx-storage-capacity";
  const cases = [
    ...[1200, 2400, 4800, 2400000].map((capacity) => ({
      family: "lustre",
      capacity,
      valid: true,
    })),
    ...[1199, 1201, 3600, 2402400].map((capacity) => ({
      family: "lustre",
      capacity,
      valid: false,
    })),
    ...[1024, 524288].map((capacity) => ({
      family: "ontap",
      capacity,
      valid: true,
    })),
    ...[1023, 524289].map((capacity) => ({
      family: "ontap",
      capacity,
      valid: false,
    })),
  ];
  it.each(cases)(
    "checks $family capacity $capacity with exact paths and no inferred fix",
    ({ family, capacity, valid }) => {
      const service = "aws.fsx." + family + "-file-system";
      const graph = document([
        node(
          "storage",
          service,
          rawServiceConfiguration(service, {
            storageCapacity: { kind: "integer", value: capacity },
          }),
        ),
      ]);
      const before = structuredClone(graph);
      for (const target of ["draft", "compilation"] as const) {
        const request = {
          document: graph,
          target,
          environment: "production" as const,
        };
        const report = executeArchitectureValidationRules(request, [
          ruleById(capacityRule),
        ]);
        expect(report.diagnostics).toEqual([]);
        expect(report.findings).toHaveLength(valid ? 0 : 1);
        if (!valid) {
          expect(report.findings[0]).toMatchObject({
            code: "aws.validation.fsx-" + family + "-storage-capacity",
            severity: "error",
            rules: [{ ruleId: capacityRule, ruleVersion: "1.0.0" }],
            affected: [
              {
                kind: "configuration",
                owner: { kind: "node", nodeId: "storage" },
                key: "storageCapacity",
                path: "$.nodes[0].semantic.configuration.values.storageCapacity",
              },
            ],
          });
          expect(report.findings[0]?.autoFix).toBeUndefined();
        }
        expect(
          executeArchitectureValidationRules(request, [ruleById(capacityRule)]),
        ).toEqual(report);
      }
      expect(graph).toEqual(before);
    },
  );
});

import {
  isS3SharedBucketName,
  s3NotificationFilterKey,
  s3NotificationFiltersOverlap,
} from "./s3-accuracy-contract.js";

describe("Registered S3 successor accuracy rules", () => {
  const nameRule = ruleById("aws.cloudmarkup.validation.s3-bucket-name");
  const filterRule = ruleById(
    "aws.cloudmarkup.validation.s3-notification-filters",
  );
  const invalidNames = [
    "ab",
    "a".repeat(64),
    "Example",
    "example_bucket",
    "example..bucket",
    "192.168.5.4",
    "999.001.1.2",
    "xn--example",
    "sthree-example",
    "amzn-s3-demo-example",
    "example-s3alias",
    "example--ol-s3",
    "example.mrap",
    "example--x-s3",
    "example--table-s3",
    "example-an",
    "example\n",
    "-example",
    "example.",
  ];
  it.each(invalidNames)(
    "rejects unsupported name %j without exposing its value or renaming",
    (name) => {
      const graph = document([
        node(
          "bucket",
          "aws.s3.bucket",
          rawServiceConfiguration("aws.s3.bucket", {
            bucketName: { kind: "string", value: name },
          }),
        ),
      ]);
      const before = structuredClone(graph);
      for (const target of ["draft", "compilation"] as const) {
        const report = executeArchitectureValidationRules(
          { document: graph, target, environment: "production" },
          [nameRule],
        );
        expect(report.diagnostics).toEqual([]);
        expect(report.findings).toHaveLength(1);
        expect(report.findings[0]).toMatchObject({
          code: "aws.validation.s3-bucket-name",
          severity: "error",
          affected: [
            {
              kind: "configuration",
              key: "bucketName",
              path: "$.nodes[0].semantic.configuration.values.bucketName",
            },
          ],
        });
        expect(report.findings[0]?.autoFix).toBeUndefined();
        if (name.length > 10)
          expect(report.findings[0]?.technicalExplanation).not.toContain(name);
      }
      expect(isS3SharedBucketName(name)).toBe(false);
      expect(graph).toEqual(before);
    },
  );
  it.each([
    "abc",
    "a".repeat(63),
    "012",
    "images.example",
    "my-images-1",
    "192.168.5.images",
  ])(
    "accepts supported shared name %j without proving availability",
    (name) => {
      expect(isS3SharedBucketName(name)).toBe(true);
      const graph = document([
        node(
          "bucket",
          "aws.s3.bucket",
          rawServiceConfiguration("aws.s3.bucket", {
            bucketName: { kind: "string", value: name },
          }),
        ),
      ]);
      expect(
        executeArchitectureValidationRules(
          { document: graph, target: "draft", environment: "development" },
          [nameRule],
        ).findings,
      ).toEqual([]);
    },
  );
  function notification(
    id: string,
    prefix: string,
    suffix: string,
    event = "OBJECT_CREATED",
    bucket = "bucket",
  ) {
    const descriptor = awsCatalogV1.getConnectionRule(
      "aws.s3.bucket-notifies-lambda",
    );
    if (!descriptor) throw new Error("Missing S3 notification descriptor");
    return edge(
      id,
      bucket,
      descriptor.source.portId,
      "lambda",
      descriptor.target.portId,
      descriptor.relationshipType,
      connectionConfiguration(descriptor.id, {
        eventType: { kind: "string", value: event },
        filterPrefix: { kind: "string", value: prefix },
        filterSuffix: { kind: "string", value: suffix },
      }),
    );
  }
  function reportFor(edges: TestEdge[]) {
    return executeArchitectureValidationRules(
      {
        document: document(
          [
            node("bucket", "aws.s3.bucket"),
            node("bucket2", "aws.s3.bucket"),
            node("lambda", "aws.lambda.function"),
          ],
          edges,
        ),
        target: "compilation",
        environment: "production",
      },
      [filterRule],
    );
  }
  it.each([
    { a: ["images/", ".jpg"], b: ["images/raw/", ".jpg"], overlap: true },
    { a: ["images/", "pg"], b: ["images/", "jpg"], overlap: true },
    { a: ["", ""], b: ["images/", ".jpg"], overlap: true },
    { a: ["images/", ".jpg"], b: ["images/", ".png"], overlap: false },
    { a: ["images/", ""], b: ["logs/", ""], overlap: false },
    { a: ["images%2F", ".jpg"], b: ["images/raw/", ".jpg"], overlap: true },
    { a: ["my+images/", ""], b: ["my%20images/raw/", ""], overlap: true },
    { a: ["%252F", ""], b: ["/", ""], overlap: false },
  ])("checks filters $a / $b with overlap=$overlap", ({ a, b, overlap }) => {
    const edges = [
      notification("edge_a", a[0] ?? "", a[1] ?? ""),
      notification("edge_b", b[0] ?? "", b[1] ?? ""),
    ];
    const report = reportFor(edges);
    expect(report.diagnostics).toEqual([]);
    expect(report.findings).toHaveLength(overlap ? 1 : 0);
    if (overlap) {
      const finding = report.findings[0];
      if (!finding) throw new Error("Expected overlap finding");
      expect(finding.code).toBe(
        "aws.validation.s3-overlapping-notification-filters",
      );
      expect(finding.affected).toHaveLength(6);
      expect(finding.affected.map((location) => location.path)).toEqual(
        expect.arrayContaining([
          "$.edges[0].semantic.configuration.values.filterPrefix",
          "$.edges[1].semantic.configuration.values.filterSuffix",
        ]),
      );
      expect(finding.autoFix).toBeUndefined();
    }
    expect(reportFor(edges)).toEqual(report);
    expect(reportFor([...edges].reverse()).findings.map((f) => f.code)).toEqual(
      report.findings.map((f) => f.code),
    );
  });
  it("keeps distinct event families and buckets separate", () => {
    expect(
      reportFor([
        notification("edge_a", "", ""),
        notification("edge_b", "", "", "OBJECT_REMOVED"),
        notification("edge_c", "", "", "OBJECT_CREATED", "bucket2"),
      ]).findings,
    ).toEqual([]);
  });
  it("reports a stable earlier conflicting edge once for each additional route", () => {
    const edges = [
      notification("edge_c", "", ""),
      notification("edge_a", "", ""),
      notification("edge_b", "", ""),
    ];
    const result = reportFor(edges);
    expect(result.diagnostics).toEqual([]);
    expect(result.findings).toHaveLength(2);
    expect(
      result.findings.every((f) =>
        f.affected.some(
          (a) =>
            a.kind === "configuration" &&
            a.owner.kind === "edge" &&
            a.owner.edgeId === "edge_a",
        ),
      ),
    ).toBe(true);
  });
  it.each(["*", "%2A", "bad%", "%FF", "raw space", "rawé"])(
    "rejects malformed or unsupported filter %j",
    (value) => {
      expect(s3NotificationFilterKey(value)).toBeUndefined();
      const report = reportFor([notification("edge_a", value, "")]);
      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]).toMatchObject({
        code: "aws.validation.s3-notification-filter-encoding",
        affected: [
          {
            key: "filterPrefix",
            path: "$.edges[0].semantic.configuration.values.filterPrefix",
          },
        ],
      });
    },
  );
  it("compares encoded Unicode and allows the exact filter length boundary", () => {
    expect(s3NotificationFilterKey("%C3%A9")).toBe("é");
    expect(s3NotificationFilterKey("a".repeat(1024))).toBe("a".repeat(1024));
    expect(s3NotificationFilterKey("a".repeat(1025))).toBeUndefined();
  });
  it("matches an independent finite-language witness for overlapping prefixes and suffixes", () => {
    const keys = [""];
    for (let size = 1; size <= 4; size++)
      for (let bits = 0; bits < 2 ** size; bits++)
        keys.push(
          Array.from({ length: size }, (_, i) =>
            (bits >> i) & 1 ? "a" : "b",
          ).join(""),
        );
    const filters = keys.filter((key) => key.length <= 2);
    for (const p of filters)
      for (const s of filters)
        for (const q of filters)
          for (const t of filters) {
            const expected = keys.some(
              (key) =>
                key.startsWith(p) &&
                key.endsWith(s) &&
                key.startsWith(q) &&
                key.endsWith(t),
            );
            expect(
              s3NotificationFiltersOverlap(
                { prefix: p, suffix: s },
                { prefix: q, suffix: t },
              ),
            ).toBe(expected);
          }
  });
});

describe("exact catalog resource-policy ownership and scope", () => {
  const cases = [
    {
      serviceId: "aws.s3.bucket",
      ownerRuleId: "aws.s3.bucket-owns-resource-policy",
      scopeRuleId: "aws.iam.policy-statement-authorizes-s3-bucket",
      action: "s3:GetObject",
    },
    {
      serviceId: "aws.sqs.queue",
      ownerRuleId: "aws.sqs.queue-owns-resource-policy",
      scopeRuleId: "aws.iam.policy-statement-authorizes-sqs-queue",
      action: "sqs:SendMessage",
    },
    {
      serviceId: "aws.sns.topic",
      ownerRuleId: "aws.sns.topic-owns-resource-policy",
      scopeRuleId: "aws.iam.policy-statement-authorizes-sns-topic",
      action: "sns:Publish",
    },
    {
      serviceId: "aws.eventbridge.event-bus",
      ownerRuleId: "aws.eventbridge.event-bus-owns-resource-policy",
      scopeRuleId: "aws.iam.policy-statement-authorizes-eventbridge-bus",
      action: "events:PutEvents",
    },
  ];
  function fixture(binding: (typeof cases)[number]) {
    const owner = node("resource_owner", binding.serviceId);
    const policy = node(
      "resource_policy",
      "aws.iam.policy-document",
      serviceConfiguration("aws.iam.policy-document", {
        policyName: { kind: "string", value: "ReviewedDelivery" },
        policyKind: { kind: "string", value: "resource" },
      }),
    );
    const statement = node(
      "resource_statement",
      "aws.iam.policy-statement",
      serviceConfiguration("aws.iam.policy-statement", {
        statementId: { kind: "string", value: "ReviewedDelivery" },
        effect: { kind: "string", value: "allow" },
        actions: { kind: "string-list", value: [binding.action] },
        principalKind: { kind: "string", value: "service" },
        principals: { kind: "string-list", value: ["events.amazonaws.com"] },
        resourceExpressions: { kind: "string-list", value: [] },
      }),
    );
    function connection(
      id: string,
      source: TestNode,
      target: TestNode,
      ruleId: string,
    ) {
      const descriptor = awsCatalogV1.getConnectionRule(ruleId);
      if (!descriptor) throw new Error("Expected reviewed connection");
      return edge(
        id,
        source.id,
        descriptor.source.portId,
        target.id,
        descriptor.target.portId,
        descriptor.relationshipType,
        connectionConfiguration(ruleId),
      );
    }
    const ownerEdge = connection(
      "resource_owner_edge",
      policy,
      owner,
      binding.ownerRuleId,
    );
    const membership = connection(
      "resource_member_edge",
      statement,
      policy,
      "aws.iam.policy-contains-statement",
    );
    const scope = connection(
      "resource_scope_edge",
      statement,
      owner,
      binding.scopeRuleId,
    );
    policy.semantic.parent = {
      nodeId: owner.id,
      relationshipType: ownerEdge.semantic.relationshipType,
    };
    statement.semantic.parent = {
      nodeId: policy.id,
      relationshipType: membership.semantic.relationshipType,
    };
    return {
      candidate: document(
        [owner, policy, statement],
        [ownerEdge, membership, scope],
      ),
      owner,
      policy,
      statement,
      ownerEdge,
      scope,
    };
  }
  function evaluate(candidate: ArchitectureDocumentV1) {
    return executeArchitectureValidationRules(
      { document: candidate, target: "revision", environment: "production" },
      [ruleById("aws.cloudmarkup.validation.iam-policy-safety")],
    );
  }
  it.each(cases)(
    "accepts exact $serviceId ownership and typed scope without legacy references",
    (binding) => {
      const f = fixture(binding);
      expect(f.statement.semantic.configuration.values).not.toHaveProperty(
        "resourceNode",
      );
      const before = structuredClone(f.candidate);
      const report = evaluate(f.candidate);
      expect(report.evaluationStatus).toBe("complete");
      expect(report.findings).toEqual([]);
      expect(evaluate(f.candidate)).toEqual(report);
      expect(f.candidate).toEqual(before);
    },
  );
  it.each(cases)(
    "rejects malformed $serviceId ownership without an inferred fix",
    (binding) => {
      for (const variant of [
        "missing",
        "duplicate",
        "source-port",
        "target-port",
        "schema",
        "version",
        "owner-service",
        "parent",
        "parent-relationship",
        "unknown",
        "kind",
      ]) {
        const f = fixture(binding);
        switch (variant) {
          case "missing":
            f.candidate.edges = f.candidate.edges.filter(
              (edge) => edge !== f.ownerEdge,
            );
            break;
          case "duplicate":
            f.candidate.edges.push({
              ...structuredClone(f.ownerEdge),
              id: "duplicate_resource_owner" as TestEdge["id"],
            });
            break;
          case "source-port":
            f.ownerEdge.semantic.source.port =
              "aws.iam.policy-document.role-trust-policy" as TestEdge["semantic"]["source"]["port"];
            break;
          case "target-port":
            f.ownerEdge.semantic.target.port =
              "aws.iam.role.trust-policy" as TestEdge["semantic"]["target"]["port"];
            break;
          case "schema":
            f.ownerEdge.semantic.configuration.schemaId =
              "unrelated.configuration" as TestEdge["semantic"]["configuration"]["schemaId"];
            break;
          case "version":
            f.ownerEdge.semantic.configuration.schemaVersion =
              semanticVersionSchema.parse("9.0.0");
            break;
          case "owner-service":
            f.owner.semantic.serviceType =
              "aws.iam.role" as TestNode["semantic"]["serviceType"];
            break;
          case "parent":
            f.policy.semantic.parent = {
              nodeId: f.statement.id,
              relationshipType: f.ownerEdge.semantic.relationshipType,
            };
            break;
          case "parent-relationship":
            f.policy.semantic.parent = {
              nodeId: f.owner.id,
              relationshipType:
                "aws.unknown.owner" as TestEdge["semantic"]["relationshipType"],
            };
            break;
          case "unknown":
            f.ownerEdge.semantic.relationshipType =
              "aws.unknown.owner" as TestEdge["semantic"]["relationshipType"];
            break;
          case "kind":
            f.policy.semantic.configuration = {
              ...f.policy.semantic.configuration,
              values: {
                ...f.policy.semantic.configuration.values,
                [configurationKeySchema.parse("policyKind")]: {
                  kind: "string",
                  value: "trust",
                },
              },
            };
            break;
        }
        const report = evaluate(f.candidate);
        expect(report.evaluationStatus, variant).toBe("complete");
        expect(report.findings, variant).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code:
                variant === "kind"
                  ? "aws.validation.iam-policy-kind-owner-mismatch"
                  : "aws.validation.iam-policy-owner-invalid",
              severity: "security-error",
              affected: [
                expect.objectContaining({
                  ...(variant === "kind"
                    ? { owner: { kind: "node", nodeId: f.policy.id } }
                    : { nodeId: f.policy.id }),
                  path:
                    variant === "kind"
                      ? "$.nodes[1].semantic.configuration.values.policyKind"
                      : "$.nodes[1]",
                }),
              ],
            }),
          ]),
        );
        expect(
          report.findings.every((finding) => finding.autoFix === undefined),
        ).toBe(true);
      }
    },
  );
  it.each(cases)(
    "rejects malformed or cross-service $serviceId scope without resourceNode fallback",
    (binding) => {
      for (const variant of [
        "source-port",
        "target-port",
        "schema",
        "version",
        "target-service",
        "unknown",
      ]) {
        const f = fixture(binding);
        switch (variant) {
          case "source-port":
            f.scope.semantic.source.port =
              "aws.iam.policy-statement.dynamodb-resource" as TestEdge["semantic"]["source"]["port"];
            break;
          case "target-port":
            f.scope.semantic.target.port =
              "aws.dynamodb.table.policy-resource" as TestEdge["semantic"]["target"]["port"];
            break;
          case "schema":
            f.scope.semantic.configuration.schemaId =
              "unrelated.configuration" as TestEdge["semantic"]["configuration"]["schemaId"];
            break;
          case "version":
            f.scope.semantic.configuration.schemaVersion =
              semanticVersionSchema.parse("9.0.0");
            break;
          case "target-service":
            f.scope.semantic.target.nodeId = f.policy.id;
            break;
          case "unknown":
            f.scope.semantic.relationshipType =
              "aws.unknown.scope" as TestEdge["semantic"]["relationshipType"];
            break;
        }
        const report = evaluate(f.candidate);
        expect(report.evaluationStatus, variant).toBe("complete");
        expect(report.findings, variant).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "aws.validation.iam-resource-missing",
              severity: "security-error",
              affected: [
                expect.objectContaining({
                  nodeId: f.statement.id,
                  path: "$.nodes[2]",
                }),
              ],
            }),
          ]),
        );
        expect(
          report.findings.every((finding) => finding.autoFix === undefined),
        ).toBe(true);
      }
    },
  );
  it.each(cases)(
    "requires declared $serviceId ownership and scope in the supplied catalog",
    (binding) => {
      for (const missing of [binding.ownerRuleId, binding.scopeRuleId]) {
        const f = fixture(binding);
        const registration = createAwsValidationRuleRegistrationsV1({
          ...awsCatalogArtifactV1,
          connectionRules: awsCatalogArtifactV1.connectionRules.filter(
            (rule) => rule.id !== missing,
          ),
        }).find(
          ({ descriptor }) =>
            descriptor.id === "aws.cloudmarkup.validation.iam-policy-safety",
        );
        if (!registration)
          throw new Error("Expected IAM validation registration");
        const report = executeArchitectureValidationRules(
          {
            document: f.candidate,
            target: "revision",
            environment: "production",
          },
          [registration.rule],
        );
        expect(report.evaluationStatus).toBe("complete");
        expect(report.findings.map((finding) => finding.code)).toContain(
          missing === binding.ownerRuleId
            ? "aws.validation.iam-policy-owner-invalid"
            : "aws.validation.iam-resource-missing",
        );
        expect(
          report.findings.every((finding) => finding.autoFix === undefined),
        ).toBe(true);
      }
    },
  );
});
