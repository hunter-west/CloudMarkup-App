import { readFile } from "node:fs/promises";

import {
  GraphCommandApplicationError,
  applyGraphCommand,
  migrateWorkloadBehaviorV1ToV2,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  composeProviderConnectionIamRequirementsV1,
  createProviderConnectionResolverV1,
  defineProviderConnectionRuleRegistrationV1,
  validateProviderConfigurationV1,
  type ProviderConnectionRuleRegistrationV1,
} from "@cloudmarkup/provider-sdk";
import { workloadBehaviorV1Schema } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  awsConnectionResolverV1,
  awsConnectionRuleRegistrationsV1,
} from "./connection-resolution.js";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";

type ResolverDocument = Parameters<
  typeof awsConnectionResolverV1.resolve
>[0]["document"];

interface ConnectionFixtureCase {
  readonly id: string;
  readonly ruleId: string;
  readonly sourceNodeId: string;
  readonly sourcePortId: string;
  readonly targetNodeId: string;
  readonly targetPortId: string;
  readonly configuration: unknown;
}

interface ConnectionFixture {
  readonly catalogVersion: string;
  readonly cases: readonly ConnectionFixtureCase[];
}

const networkingDirectRuleIds = new Set([
  "aws.ec2.route-table-association-targets-subnet",
  "aws.ec2.vpc-attaches-internet-gateway",
  "aws.ec2.route-targets-internet-gateway",
  "aws.ec2.route-targets-nat-gateway",
  "aws.ec2.gateway-endpoint-associates-route-table",
  "aws.ec2.vpc-associates-security-group",
  "aws.lambda.vpc-access-uses-subnet",
  "aws.lambda.vpc-access-uses-security-group",
]);

function serviceConfiguration(serviceId: string, values: unknown = {}) {
  const service = awsCatalogV1.requireService(serviceId);
  const result = awsCatalogV1.validateConfiguration(serviceId, values);
  if (!result.success) {
    throw new TypeError(`Invalid test configuration for ${serviceId}.`);
  }
  return {
    schemaId: service.configuration.schemaId,
    schemaVersion: service.configuration.schemaVersion,
    values: result.values,
  };
}

function connectionConfiguration(ruleId: string, values: unknown = {}) {
  const rule = awsCatalogV1.getConnectionRule(ruleId);
  if (rule === undefined) {
    throw new TypeError(`Unknown test connection rule ${ruleId}.`);
  }
  const result = validateProviderConfigurationV1(rule.configuration, values);
  if (!result.success) {
    throw new TypeError(`Invalid test connection configuration ${ruleId}.`);
  }
  return {
    schemaId: rule.configuration.schemaId,
    schemaVersion: rule.configuration.schemaVersion,
    values: result.values,
  };
}

function node(
  id: string,
  serviceId: string,
  x: number,
  y: number,
  values: unknown = {},
  parent?: { readonly nodeId: string; readonly relationshipType: string },
) {
  const service = awsCatalogV1.requireService(serviceId);
  const resourceType =
    service.nodeKind.kind === "resource"
      ? service.nodeKind.resourceType
      : service.nodeKind.boundaryType;
  return {
    id,
    semantic: {
      deploymentKey: id.replaceAll("-", "_"),
      serviceType: service.id,
      resourceType,
      configuration: serviceConfiguration(serviceId, values),
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

function createDocument(options?: {
  readonly includeNetworking?: boolean;
  readonly includeRoleEdge?: boolean;
  readonly includeSecondLambda?: boolean;
  readonly includeSecondRole?: boolean;
  readonly includeSecondTable?: boolean;
}): ResolverDocument {
  const includeNetworking = options?.includeNetworking ?? false;
  const includeRoleEdge = options?.includeRoleEdge ?? true;
  const includeSecondLambda = options?.includeSecondLambda ?? false;
  const includeSecondRole = options?.includeSecondRole ?? false;
  const includeSecondTable = options?.includeSecondTable ?? false;
  const nodes = [
    node("api", "aws.apigateway.http-api", 0, 0, {
      corsEnabled: { kind: "boolean", value: false },
    }),
    node("lambda", "aws.lambda.function", 240, 0, {
      memoryMegabytes: { kind: "integer", value: 512 },
    }),
    node("table", "aws.dynamodb.table", 480, 0),
    node("role", "aws.iam.role", 240, 240),
    node("logs", "aws.cloudwatch.log-group", 480, 240),
    node("alarm", "aws.cloudwatch.metric-alarm", 720, 240),
    node("pool", "aws.cognito.user-pool", 0, 240),
    node(
      "client",
      "aws.cognito.user-pool-client",
      0,
      480,
      {},
      {
        nodeId: "pool",
        relationshipType: "aws.cognito.contains-app-client",
      },
    ),
  ];
  if (includeSecondTable) {
    nodes.push(node("table2", "aws.dynamodb.table", 720, 0));
  }
  if (includeSecondLambda) {
    nodes.push(
      node("lambda2", "aws.lambda.function", 240, -240, {
        memoryMegabytes: { kind: "integer", value: 512 },
      }),
    );
  }
  if (includeSecondRole) {
    nodes.push(node("role2", "aws.iam.role", 480, 480));
  }
  if (includeNetworking) {
    nodes.push(
      node("region", "aws.region.boundary", 0, 720, {
        regionName: { kind: "string", value: "us-east-1" },
      }),
      node("vpc", "aws.ec2.vpc", 240, 720),
      node("zone", "aws.ec2.availability-zone", 480, 720, {
        zoneName: { kind: "string", value: "us-east-1a" },
      }),
      node("subnet", "aws.ec2.subnet", 720, 720),
      node("route_table", "aws.ec2.route-table", 960, 720),
      node(
        "route_table_association",
        "aws.ec2.route-table-association",
        1200,
        720,
      ),
      node("route", "aws.ec2.route", 1440, 720),
      node("internet_gateway", "aws.ec2.internet-gateway", 1680, 720),
      node("nat_gateway", "aws.ec2.nat-gateway", 1920, 720, {
        allocationId: {
          kind: "string",
          value: "eipalloc-0123456789abcdef0",
        },
      }),
      node("gateway_endpoint", "aws.ec2.gateway-vpc-endpoint", 2160, 720, {
        service: { kind: "string", value: "s3" },
        policyMode: { kind: "string", value: "full-access" },
      }),
      node("security_group", "aws.ec2.security-group", 2400, 720),
      node("security_group_2", "aws.ec2.security-group", 2400, 840),
      node("security_group_3", "aws.ec2.security-group", 2400, 960),
      node("security_group_4", "aws.ec2.security-group", 2400, 1080),
      node("security_group_5", "aws.ec2.security-group", 2400, 1200),
      node("security_group_6", "aws.ec2.security-group", 2400, 1320),
      node(
        "lambda_vpc_access",
        "aws.lambda.vpc-access-configuration",
        2640,
        720,
      ),
    );
  }

  return {
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 1,
    documentId: "document_notes",
    architectureId: "architecture_notes",
    revision: {
      revisionId: "revision_1",
      revisionNumber: 1,
      createdAt: "2026-07-24T12:00:00Z",
      createdBy: "actor_test",
    },
    provider: {
      id: awsCatalogV1.artifact.provider.id,
      region: "us-east-1",
    },
    catalog: {
      id: awsCatalogV1.artifact.catalog.id,
      version: awsCatalogV1.artifact.catalog.version,
      digest: awsCatalogV1.artifact.digest,
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
    nodes,
    edges: includeRoleEdge
      ? [
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
              configuration: connectionConfiguration(
                "aws.iam.role-assumed-by-lambda",
              ),
              lifecycle: {
                ownership: "user",
                origin: "user",
              },
            },
          },
        ]
      : [],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
  } as unknown as ResolverDocument;
}

function withUserCustomPolicy(document: ResolverDocument): ResolverDocument {
  const customDocument = node(
    "custom_policy_document",
    "aws.iam.policy-document",
    300,
    360,
    {
      policyName: { kind: "string", value: "UserTableRead" },
      policyKind: { kind: "string", value: "identity-inline" },
    },
    {
      nodeId: "role",
      relationshipType: "aws.iam.role-owns-inline-policy",
    },
  );
  const customStatement = node(
    "custom_policy_statement",
    "aws.iam.policy-statement",
    420,
    360,
    {
      statementId: { kind: "string", value: "UserTableRead" },
      effect: { kind: "string", value: "allow" },
      actions: { kind: "string-list", value: ["dynamodb:GetItem"] },
      principalKind: { kind: "string", value: "none" },
      principals: { kind: "string-list", value: [] },
      resourceExpressions: { kind: "string-list", value: [] },
      resourceNode: {
        kind: "node-reference",
        nodeId: "table",
        attribute: "aws.dynamodb.table.arn",
      },
    },
    {
      nodeId: "custom_policy_document",
      relationshipType: "aws.iam.policy-contains-statement",
    },
  );
  const lifecycle = { ownership: "user", origin: "user" } as const;
  return {
    ...document,
    nodes: [...document.nodes, customDocument, customStatement],
    edges: [
      ...document.edges,
      {
        id: "custom_policy_owner",
        semantic: {
          source: {
            nodeId: "custom_policy_document",
            port: "aws.iam.policy-document.role-inline-policy",
          },
          target: {
            nodeId: "role",
            port: "aws.iam.role.custom-inline-policy",
          },
          relationshipType: "aws.iam.role-owns-inline-policy",
          configuration: connectionConfiguration(
            "aws.iam.role-owns-inline-policy",
          ),
          lifecycle,
        },
      },
      {
        id: "custom_policy_membership",
        semantic: {
          source: {
            nodeId: "custom_policy_statement",
            port: "aws.iam.policy-statement.policy-document",
          },
          target: {
            nodeId: "custom_policy_document",
            port: "aws.iam.policy-document.statement",
          },
          relationshipType: "aws.iam.policy-contains-statement",
          configuration: connectionConfiguration(
            "aws.iam.policy-contains-statement",
          ),
          lifecycle,
        },
      },
      {
        id: "custom_policy_scope",
        semantic: {
          source: {
            nodeId: "custom_policy_statement",
            port: "aws.iam.policy-statement.dynamodb-resource",
          },
          target: {
            nodeId: "table",
            port: "aws.dynamodb.table.policy-resource",
          },
          relationshipType: "aws.iam.authorizes-dynamodb-table",
          configuration: connectionConfiguration(
            "aws.iam.policy-statement-authorizes-dynamodb-table",
          ),
          lifecycle,
        },
      },
    ],
  } as unknown as ResolverDocument;
}

function withAwsDownstreamBinding(
  document: ArchitectureDocument,
  edgeId: string,
): ArchitectureDocument {
  return parseArchitectureDocument({
    ...document,
    workloadBehavior: migrateWorkloadBehaviorV1ToV2(
      workloadBehaviorV1Schema.parse({
        contractVersion: 1,
        workloads: [
          {
            id: "workload_lambda",
            owningNodeId: "lambda",
            implementation: {
              mode: "user-provided",
              runtimeFamily: "aws.lambda.runtime.nodejs",
              handler: "index.handler",
              sourceOwnership: "user",
            },
            operations: [
              {
                id: "operation_write",
                capability: "aws.lambda.operation.write",
                inputContract: { kind: "none" },
                outputContract: { kind: "none" },
              },
            ],
            triggers: [],
            downstreamActions: [
              {
                id: "downstream_table_write",
                edgeId,
                sourceOperationId: "operation_write",
              },
            ],
            environment: [],
            errorBehavior: { mode: "fail-invocation" },
            executionAssumptions: {
              timeout: { kind: "unresolved" },
              retry: { kind: "unresolved" },
            },
            triggerDispatch: { mode: "single" },
            unresolvedRequirementIds: [],
          },
        ],
      }),
    ),
  });
}

function request(
  document: ResolverDocument,
  fixture: ConnectionFixtureCase,
  operationId: string,
) {
  return {
    document,
    ruleId: fixture.ruleId,
    source: {
      nodeId: fixture.sourceNodeId,
      portId: fixture.sourcePortId,
    },
    target: {
      nodeId: fixture.targetNodeId,
      portId: fixture.targetPortId,
    },
    configuration: fixture.configuration,
    operationId,
  };
}

function resolverWithApiLambdaRecipe(
  resolve: ProviderConnectionRuleRegistrationV1["resolve"],
) {
  const registration = awsConnectionRuleRegistrationsV1.find(
    (candidate) =>
      candidate.ruleId === "aws.apigateway.http-api-invokes-lambda",
  );
  if (registration === undefined) {
    throw new TypeError("Expected the API Lambda connection registration.");
  }
  const replacement = defineProviderConnectionRuleRegistrationV1({
    implementationId: registration.implementationId,
    interfaceVersion: 1,
    resolve,
    ruleId: registration.ruleId,
    ruleVersion: registration.ruleVersion,
  });
  return createProviderConnectionResolverV1(
    awsCatalogV1.artifact,
    awsConnectionRuleRegistrationsV1.map((candidate) =>
      candidate.ruleId === replacement.ruleId ? replacement : candidate,
    ),
  );
}

async function readConnectionFixture(): Promise<ConnectionFixture> {
  return JSON.parse(
    await readFile(
      new URL("../fixtures/notes-api/connection-cases.json", import.meta.url),
      "utf8",
    ),
  ) as ConnectionFixture;
}

describe("AWS connection resolution v1", () => {
  it("registers every implemented catalog rule and resolves fixture cases deterministically", async () => {
    const fixture = await readConnectionFixture();
    const document = createDocument({ includeNetworking: true });
    const before = structuredClone(document);
    const baselineIamRequirements = composeProviderConnectionIamRequirementsV1(
      awsCatalogArtifactV1,
      document,
    );
    expect(baselineIamRequirements.success).toBe(true);
    if (!baselineIamRequirements.success) {
      throw new TypeError(
        "Expected the baseline document to compose IAM requirements.",
      );
    }

    expect(fixture.catalogVersion).toBe(awsCatalogV1.artifact.catalog.version);
    expect(awsConnectionRuleRegistrationsV1).toHaveLength(112);
    for (const [index, fixtureCase] of fixture.cases.entries()) {
      const operationId = `fixture_${String(index)}`;
      const first = awsConnectionResolverV1.resolve(
        request(document, fixtureCase, operationId),
      );
      const second = awsConnectionResolverV1.resolve(
        request(document, fixtureCase, operationId),
      );
      expect(first, fixtureCase.id).toEqual(second);
      expect(first.success, fixtureCase.id).toBe(true);
      if (first.success) {
        const rule = awsCatalogV1.getConnectionRule(fixtureCase.ruleId);
        if (rule === undefined) {
          throw new TypeError(`Unknown fixture rule ${fixtureCase.ruleId}.`);
        }
        if (networkingDirectRuleIds.has(fixtureCase.ruleId)) {
          const directEdgeId = `${operationId}.edge.connection`;
          expect(first.batch.commands, fixtureCase.id).toHaveLength(1);
          expect(first.batch.commands[0], fixtureCase.id).toMatchObject({
            kind: "add-edge",
            edge: {
              id: directEdgeId,
              semantic: {
                source: {
                  nodeId: fixtureCase.sourceNodeId,
                  port: fixtureCase.sourcePortId,
                },
                target: {
                  nodeId: fixtureCase.targetNodeId,
                  port: fixtureCase.targetPortId,
                },
                relationshipType: fixtureCase.ruleId,
                configuration: { values: {} },
                lifecycle: {
                  ownership: "generated",
                  provenance: {
                    generatorId: fixtureCase.ruleId,
                    operationId,
                  },
                },
              },
            },
          });
          expect(first.generatedResources, fixtureCase.id).toEqual([
            { kind: "edge", edgeId: directEdgeId },
          ]);
          expect(first.iamEffects, fixtureCase.id).toEqual([]);
          expect(first.iamRequirements, fixtureCase.id).toEqual(
            baselineIamRequirements.requirements,
          );
        }
        const actualSupportingChanges = first.generatedResources
          .filter(
            (resource) =>
              !(
                resource.kind === "edge" &&
                resource.edgeId === `${operationId}.edge.connection`
              ),
          )
          .map((resource) => {
            if (resource.kind === "node") {
              const generatedNode = first.preview.document.nodes.find(
                (candidate) => candidate.id === resource.nodeId,
              );
              if (generatedNode === undefined) {
                throw new TypeError("Generated fixture node is missing.");
              }
              return `node:${String(generatedNode.semantic.serviceType)}`;
            }
            const generatedEdge = first.preview.document.edges.find(
              (candidate) => candidate.id === resource.edgeId,
            );
            if (generatedEdge === undefined) {
              throw new TypeError("Generated fixture edge is missing.");
            }
            return `edge:${String(generatedEdge.semantic.relationshipType)}`;
          })
          .sort();
        const declaredSupportingChanges = rule.supportingChanges
          .map((change) =>
            change.kind === "node"
              ? `node:${String(change.serviceId)}`
              : `edge:${String(change.relationshipType)}`,
          )
          .sort();
        expect(actualSupportingChanges, fixtureCase.id).toEqual(
          declaredSupportingChanges,
        );
        expect(first.batch.kind).toBe("batch");
        expect(first.preview.changes.at(-1)).toMatchObject({
          kind: "batch-applied",
        });
      }
    }
    expect(document).toEqual(before);
  });

  it("previews networking direct associations atomically and rejects wrong direction, stale application, and a sixth Lambda security group", () => {
    const document = createDocument({ includeNetworking: true });
    const before = structuredClone(document);
    const requestInput = {
      document,
      ruleId: "aws.ec2.vpc-attaches-internet-gateway",
      source: {
        nodeId: "vpc",
        portId: "aws.ec2.vpc.internet-gateway-attachment",
      },
      target: {
        nodeId: "internet_gateway",
        portId: "aws.ec2.internet-gateway.vpc-attachment",
      },
      configuration: {},
      operationId: "networking_direct_preview",
    } as const;
    const resolved = awsConnectionResolverV1.resolve(requestInput);
    expect(resolved.success, JSON.stringify(resolved)).toBe(true);
    if (!resolved.success) {
      return;
    }
    expect(resolved.batch.commands).toHaveLength(1);
    expect(resolved.preview.changes).toEqual([
      expect.objectContaining({
        kind: "edge-added",
        edgeId: "networking_direct_preview.edge.connection",
      }),
      expect.objectContaining({ kind: "batch-applied", commandCount: 1 }),
    ]);
    expect(document).toEqual(before);

    const reversed = awsConnectionResolverV1.resolve({
      ...requestInput,
      source: requestInput.target,
      target: requestInput.source,
      operationId: "networking_direct_reversed",
    });
    expect(reversed.success).toBe(false);
    if (!reversed.success) {
      expect(reversed.findings[0]?.code).toBe(
        "cloudmarkup.connection.unsupported-direction",
      );
    }

    const staleDocument = {
      ...document,
      revision: {
        ...document.revision,
        revisionId: "revision_stale",
      },
    } as ResolverDocument;
    expect(() => applyGraphCommand(staleDocument, resolved.batch)).toThrow(
      GraphCommandApplicationError,
    );

    const securityGroupIds = [
      "security_group",
      "security_group_2",
      "security_group_3",
      "security_group_4",
      "security_group_5",
    ];
    let current = document;
    for (const [index, securityGroupId] of securityGroupIds.entries()) {
      const association = awsConnectionResolverV1.resolve({
        document: current,
        ruleId: "aws.lambda.vpc-access-uses-security-group",
        source: {
          nodeId: "lambda_vpc_access",
          portId: "aws.lambda.vpc-access-configuration.security-group",
        },
        target: {
          nodeId: securityGroupId,
          portId: "aws.ec2.security-group.lambda-vpc-access",
        },
        configuration: {},
        operationId: `lambda_security_group_${String(index + 1)}`,
      });
      expect(association.success, securityGroupId).toBe(true);
      if (!association.success) {
        return;
      }
      current = association.preview.document;
    }
    const sixth = awsConnectionResolverV1.resolve({
      document: current,
      ruleId: "aws.lambda.vpc-access-uses-security-group",
      source: {
        nodeId: "lambda_vpc_access",
        portId: "aws.lambda.vpc-access-configuration.security-group",
      },
      target: {
        nodeId: "security_group_6",
        portId: "aws.ec2.security-group.lambda-vpc-access",
      },
      configuration: {},
      operationId: "lambda_security_group_6",
    });
    expect(sixth.success).toBe(false);
    if (!sixth.success) {
      expect(sixth.findings.map((finding) => finding.code)).toContain(
        "cloudmarkup.connection.source-cardinality-exceeded",
      );
    }
  });

  it("discovers exact and node-start candidates with canonical direction and edit exclusion", () => {
    const document = createDocument();
    const exact = awsConnectionResolverV1.listCompatible({
      document,
      anchor: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      anchorRole: "source",
      counterpart: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    });

    expect(exact.findings).toEqual([]);
    expect(exact.candidates).toHaveLength(1);
    expect(exact.candidates[0]?.rule.id).toBe(
      "aws.apigateway.http-api-invokes-lambda",
    );
    expect(exact.candidates[0]).toMatchObject({
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      findings: [],
    });

    const nodeStart = awsConnectionResolverV1.listCompatible({
      document,
      anchor: { nodeId: "api" },
      anchorRole: "either",
    });
    expect(nodeStart.findings).toEqual([]);
    expect(nodeStart.candidates.map((candidate) => candidate.rule.id)).toEqual([
      "aws.apigateway.http-api-invokes-lambda",
      "aws.cognito.app-client-authorizes-http-api",
      "aws.cognito.user-pool-authorizes-http-api",
    ]);
    expect(nodeStart.candidates).toHaveLength(3);

    const reversed = awsConnectionResolverV1.listCompatible({
      document,
      anchor: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      anchorRole: "source",
      counterpart: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
    });
    expect(reversed.candidates).toEqual([]);
    expect(reversed.findings[0]?.code).toBe(
      "cloudmarkup.connection.unsupported-direction",
    );

    const invalidAnchorRole = awsConnectionResolverV1.listCompatible({
      document,
      anchor: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      anchorRole: "invalid" as never,
      counterpart: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
    });
    expect(invalidAnchorRole.candidates).toEqual([]);
    expect(invalidAnchorRole.findings[0]).toMatchObject({
      code: "cloudmarkup.connection.invalid-anchor-role",
      path: "$.anchorRole",
      severity: "error",
    });

    const invalidPorts = awsConnectionResolverV1.listCompatible({
      document,
      anchor: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.jwt-issuer",
      },
      anchorRole: "source",
      counterpart: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    });
    expect(invalidPorts.candidates).toEqual([]);
    expect(invalidPorts.findings[0]?.code).toBe(
      "cloudmarkup.connection.invalid-port",
    );

    const invalidCounterpartPort = awsConnectionResolverV1.listCompatible({
      document,
      anchor: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      anchorRole: "source",
      counterpart: {
        nodeId: "lambda",
        portId: "aws.lambda.function.execution-role",
      },
    });
    expect(invalidCounterpartPort.candidates).toEqual([]);
    expect(invalidCounterpartPort.findings[0]).toMatchObject({
      code: "cloudmarkup.connection.invalid-port",
      path: "$.counterpart.portId",
      severity: "error",
    });

    const resolved = awsConnectionResolverV1.resolve({
      document,
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      configuration: {
        routeKey: { kind: "string", value: "GET /notes" },
      },
      operationId: "discovery_edge",
    });
    expect(resolved.success).toBe(true);
    if (!resolved.success) {
      return;
    }
    const reusablePair = awsConnectionResolverV1.listCompatible({
      document: resolved.preview.document,
      anchor: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      anchorRole: "source",
      counterpart: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    });
    expect(reusablePair.candidates[0]?.findings).toEqual([]);

    const editing = awsConnectionResolverV1.listCompatible({
      document: resolved.preview.document,
      anchor: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      anchorRole: "source",
      counterpart: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      excludingConnectionEdgeId: "discovery_edge.edge.connection",
    });
    expect(editing.findings).toEqual([]);
    expect(editing.candidates[0]?.findings).toEqual([]);
  });

  it("returns every deterministic relationship candidate when descriptors are ambiguous", () => {
    const baseRule = awsCatalogV1.getConnectionRule(
      "aws.apigateway.http-api-invokes-lambda",
    );
    if (baseRule?.implementation.status !== "implemented") {
      throw new TypeError("Expected the implemented API Lambda rule.");
    }
    const alternateRule = {
      ...structuredClone(baseRule),
      id: "aws.apigateway.http-api-invokes-lambda-alternate",
      relationshipType: "aws.apigateway.integrates-lambda-alternate",
      implementation: {
        status: "implemented",
        interfaceVersion: 1,
        implementationId:
          "aws.apigateway.resolve-http-api-lambda-integration-alternate",
      },
    } as unknown as typeof baseRule;
    const alternateRegistration = defineProviderConnectionRuleRegistrationV1({
      interfaceVersion: 1,
      ruleId: alternateRule.id,
      ruleVersion: alternateRule.ruleVersion,
      implementationId:
        alternateRule.implementation.status === "implemented"
          ? alternateRule.implementation.implementationId
          : "aws.apigateway.unreachable",
      resolve: () => ({
        success: true,
        commands: [],
        generatedResources: [],
      }),
    });
    const ambiguousArtifact = {
      ...structuredClone(awsCatalogV1.artifact),
      connectionRules: [
        ...awsCatalogV1.artifact.connectionRules,
        alternateRule,
      ],
    };
    const resolver = createProviderConnectionResolverV1(ambiguousArtifact, [
      ...awsConnectionRuleRegistrationsV1,
      alternateRegistration,
    ]);

    const result = resolver.listCompatible({
      document: createDocument(),
      anchor: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      anchorRole: "source",
      counterpart: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    });

    expect(result.findings).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.rule.id)).toEqual([
      "aws.apigateway.http-api-invokes-lambda",
      "aws.apigateway.http-api-invokes-lambda-alternate",
    ]);
    expect(
      result.candidates.every(
        (candidate) =>
          candidate.source.nodeId === "api" &&
          candidate.target.nodeId === "lambda" &&
          candidate.findings.length === 0,
      ),
    ).toBe(true);
  });

  it("rejects a recipe that labels a successful plan with an error finding", () => {
    const document = createDocument();
    const before = structuredClone(document);
    const resolver = resolverWithApiLambdaRecipe(() => ({
      commands: [],
      findings: [
        {
          code: "test.connection.recipe-error",
          guidedMessage: "The test connection is invalid.",
          path: "$.ruleId",
          professionalMessage:
            "The reviewed test recipe returned an error-severity finding.",
          severity: "error",
        },
      ],
      generatedResources: [],
      success: true,
    }));

    const result = resolver.resolve({
      configuration: { routeKey: { kind: "string", value: "GET /notes" } },
      document,
      operationId: "error_finding",
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    });

    expect(result).toEqual({
      findings: [
        expect.objectContaining({
          code: "test.connection.recipe-error",
          severity: "error",
        }),
      ],
      success: false,
    });
    expect(document).toEqual(before);
  });

  it("rejects dangling, duplicate, and omitted generated-resource preview references", () => {
    const document = createDocument();
    const before = structuredClone(document);
    const danglingResolver = resolverWithApiLambdaRecipe((context) => ({
      commands: [],
      generatedResources: [
        { kind: "node", nodeId: context.nodeId("missing-support") },
      ],
      success: true,
    }));
    const duplicateResolver = resolverWithApiLambdaRecipe((context) => ({
      commands: [],
      generatedResources: [{ kind: "edge", edgeId: context.connectionEdgeId }],
      success: true,
    }));
    const omittedResolver = resolverWithApiLambdaRecipe((context) => ({
      commands: [
        {
          ...context.commandEnvelope("add-hidden-support"),
          kind: "add-node",
          node: {
            id: context.nodeId("hidden-support"),
            semantic: {
              deploymentKey: `${context.operationId}_hidden_support`,
              serviceType: context.sourceNode.semantic.serviceType,
              resourceType: context.sourceNode.semantic.resourceType,
              configuration: context.sourceNode.semantic.configuration,
              lifecycle: context.generatedLifecycle([
                { kind: "edge", edgeId: context.connectionEdgeId },
              ]),
            },
            presentation: {
              label: "Hidden support",
              position: { x: 720, y: 240 },
            },
          },
        },
      ],
      generatedResources: [],
      success: true,
    }));
    const request = {
      configuration: { routeKey: { kind: "string", value: "GET /notes" } },
      document,
      operationId: "invalid_resources",
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
    };

    for (const resolver of [
      danglingResolver,
      duplicateResolver,
      omittedResolver,
    ]) {
      const result = resolver.resolve(request);
      expect(result).toEqual({
        findings: [
          expect.objectContaining({
            code: "cloudmarkup.connection.invalid-generated-resource-preview",
            severity: "error",
          }),
        ],
        success: false,
      });
    }
    expect(document).toEqual(before);
  });

  it("enforces a per-rule endpoint-pair cap while allowing distinct data capabilities", () => {
    const write = awsConnectionResolverV1.resolve({
      document: createDocument(),
      ruleId: "aws.lambda.writes-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "write_once",
    });
    expect(write.success).toBe(true);
    if (!write.success) {
      return;
    }
    const duplicateWrite = awsConnectionResolverV1.resolve({
      document: write.preview.document,
      ruleId: "aws.lambda.writes-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "write_twice",
    });
    expect(duplicateWrite.success).toBe(false);
    if (!duplicateWrite.success) {
      expect(duplicateWrite.findings.map((item) => item.code)).toContain(
        "cloudmarkup.connection.endpoint-pair-cardinality-exceeded",
      );
    }

    const read = awsConnectionResolverV1.resolve({
      document: write.preview.document,
      ruleId: "aws.lambda.reads-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-read",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "read_once",
    });
    expect(read.success).toBe(true);
  });

  it("accepts distinct API routes on the same API and Lambda endpoint pair", () => {
    const first = awsConnectionResolverV1.resolve({
      document: createDocument(),
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      configuration: {
        routeKey: { kind: "string", value: "GET /notes" },
      },
      operationId: "route_get_notes",
    });
    expect(first.success).toBe(true);
    if (!first.success) {
      return;
    }
    expect(first.preview.document.schemaVersion).toBe(3);

    const second = awsConnectionResolverV1.resolve({
      document: first.preview.document,
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      configuration: {
        routeKey: { kind: "string", value: "POST /notes" },
      },
      operationId: "route_post_notes",
    });
    expect(second.success).toBe(true);
    if (second.success) {
      expect(
        second.preview.document.edges.filter(
          (edge) =>
            edge.semantic.relationshipType ===
            "aws.apigateway.integrates-lambda",
        ),
      ).toHaveLength(2);
    }
  });

  it("rejects reversed direction, invalid ports, and duplicate exclusive API routes", () => {
    const document = createDocument({ includeSecondLambda: true });
    const reversed = awsConnectionResolverV1.resolve({
      document,
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      target: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      configuration: {
        routeKey: { kind: "string", value: "GET /notes" },
      },
      operationId: "reversed",
    });
    expect(reversed.success).toBe(false);
    if (!reversed.success) {
      expect(reversed.findings[0]?.code).toBe(
        "cloudmarkup.connection.unsupported-direction",
      );
    }

    const invalidPort = awsConnectionResolverV1.resolve({
      document,
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.jwt-issuer",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      configuration: {
        routeKey: { kind: "string", value: "GET /notes" },
      },
      operationId: "invalid_port",
    });
    expect(invalidPort.success).toBe(false);
    if (!invalidPort.success) {
      expect(invalidPort.findings[0]?.code).toBe(
        "cloudmarkup.connection.invalid-port",
      );
    }

    const first = awsConnectionResolverV1.resolve({
      document,
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda2",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      configuration: {
        routeKey: { kind: "string", value: "GET /notes" },
      },
      operationId: "route_one",
    });
    expect(first.success).toBe(true);
    if (!first.success) {
      return;
    }
    const duplicate = awsConnectionResolverV1.resolve({
      document: first.preview.document,
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      configuration: {
        routeKey: { kind: "string", value: "GET /notes" },
      },
      operationId: "route_two",
    });
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) {
      expect(duplicate.findings[0]?.code).toBe(
        "aws.apigateway.finding.duplicate-route-integration",
      );
    }
  });

  it("generates only the selected DynamoDB actions and previews atomic cleanup", () => {
    const result = awsConnectionResolverV1.resolve({
      document: createDocument(),
      ruleId: "aws.lambda.writes-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "table_access",
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.iamEffects).toEqual([
      expect.objectContaining({
        actions: [
          "dynamodb:DeleteItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
        ],
        resourceScope: "connected-target",
      }),
    ]);
    expect(JSON.stringify(result.iamEffects)).not.toContain("*");
    expect(result.iamRequirements).toContainEqual({
      sourceEdgeId: "table_access.edge.connection",
      ruleId: "aws.lambda.writes-dynamodb-table",
      effectId: "aws.lambda.iam.dynamodb-write",
      effect: "allow",
      actions: [
        "dynamodb:DeleteItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
      ],
      resource: { scope: "connected-target", nodeId: "table" },
      qualifier: {
        kind: "connection-edge",
        edgeId: "table_access.edge.connection",
        configurationSchemaId: "aws.lambda.dynamodb-write.connection",
        configurationSchemaVersion: "1.0.0",
      },
      readiness: "preview-only",
    });
    const policy = result.preview.document.nodes.find(
      (candidate) =>
        candidate.semantic.serviceType === "aws.iam.policy-statement",
    );
    const policyDocument = result.preview.document.nodes.find(
      (candidate) =>
        candidate.semantic.serviceType === "aws.iam.policy-document",
    );
    expect(policyDocument?.semantic.configuration.values).toMatchObject({
      policyKind: { kind: "string", value: "generated-permission" },
    });
    expect(policy?.semantic.configuration.values).toMatchObject({
      effect: { kind: "string", value: "allow" },
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
      },
      principals: { kind: "string-list", value: [] },
      resourceExpressions: { kind: "string-list", value: [] },
    });
    expect(
      result.preview.document.edges.find(
        (edge) => edge.id === "table_access.edge.policy-document-statement",
      )?.semantic.relationshipType,
    ).toBe("aws.iam.policy-contains-statement");

    const cleanup = awsConnectionResolverV1.cleanup({
      document: result.preview.document,
      connectionEdgeId: "table_access.edge.connection",
      operationId: "cleanup_table",
    });
    expect(cleanup.success).toBe(true);
    if (cleanup.success) {
      expect(cleanup.preview.document.edges).toEqual([
        expect.objectContaining({ id: "role_lambda" }),
      ]);
      expect(
        cleanup.preview.document.nodes.some(
          (candidate) =>
            candidate.semantic.serviceType === "aws.iam.policy-statement",
        ),
      ).toBe(false);
      expect(
        cleanup.preview.changes.filter(
          (change) =>
            change.kind === "generated-resource-released" &&
            change.disposition === "removed",
        ),
      ).toHaveLength(6);
    }
  });

  it.each([
    "policy-role",
    "policy-document-statement",
    "policy-table",
  ] as const)(
    "rejects a workload-bound connection support %s edge as a cleanup target",
    (supportEdgeSuffix) => {
      const operationId = "support_target";
      const resolved = awsConnectionResolverV1.resolve({
        document: createDocument(),
        ruleId: "aws.lambda.writes-dynamodb-table",
        source: {
          nodeId: "lambda",
          portId: "aws.lambda.function.data-write",
        },
        target: {
          nodeId: "table",
          portId: "aws.dynamodb.table.table-api",
        },
        configuration: {},
        operationId,
      });
      expect(resolved.success).toBe(true);
      if (!resolved.success) {
        return;
      }
      const directEdgeId = operationId + ".edge.connection";
      const boundDocument = withAwsDownstreamBinding(
        resolved.preview.document,
        directEdgeId,
      );
      const before = structuredClone(boundDocument);
      const iamBefore = composeProviderConnectionIamRequirementsV1(
        awsCatalogArtifactV1,
        boundDocument,
      );
      expect(iamBefore.success).toBe(true);

      const cleanup = awsConnectionResolverV1.cleanup({
        document: boundDocument,
        connectionEdgeId: operationId + ".edge." + supportEdgeSuffix,
        operationId: "cleanup_support_target",
      });

      expect(cleanup).toEqual({
        success: false,
        findings: [
          expect.objectContaining({
            code: "cloudmarkup.connection.cleanup-not-generated",
            severity: "error",
            path: "$.connectionEdgeId",
          }),
        ],
      });
      expect(cleanup).not.toHaveProperty("batch");
      expect(cleanup).not.toHaveProperty("preview");
      expect(boundDocument).toEqual(before);
      for (const edgeId of [
        directEdgeId,
        operationId + ".edge.policy-role",
        operationId + ".edge.policy-table",
        operationId + ".edge.policy-document-statement",
      ]) {
        expect(boundDocument.edges.some((edge) => edge.id === edgeId)).toBe(
          true,
        );
      }
      expect(
        boundDocument.nodes.some(
          (node) => node.id === operationId + ".node.dynamodb-policy-document",
        ),
      ).toBe(true);
      expect(
        boundDocument.nodes.some(
          (node) => node.id === operationId + ".node.dynamodb-policy",
        ),
      ).toBe(true);
      expect(
        composeProviderConnectionIamRequirementsV1(
          awsCatalogArtifactV1,
          boundDocument,
        ),
      ).toEqual(iamBefore);
    },
  );

  it("atomically rejects a stale cleanup batch after the direct edge gains a workload binding", () => {
    const operationId = "stale_cleanup";
    const resolved = awsConnectionResolverV1.resolve({
      document: createDocument(),
      ruleId: "aws.lambda.writes-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId,
    });
    expect(resolved.success).toBe(true);
    if (!resolved.success) {
      return;
    }
    const directEdgeId = operationId + ".edge.connection";
    const preparedCleanup = awsConnectionResolverV1.cleanup({
      document: resolved.preview.document,
      connectionEdgeId: directEdgeId,
      operationId: "prepared_cleanup",
    });
    expect(preparedCleanup.success).toBe(true);
    if (!preparedCleanup.success) {
      return;
    }
    const boundDocument = withAwsDownstreamBinding(
      resolved.preview.document,
      directEdgeId,
    );
    const before = structuredClone(boundDocument);
    const iamBefore = composeProviderConnectionIamRequirementsV1(
      awsCatalogArtifactV1,
      boundDocument,
    );
    expect(iamBefore.success).toBe(true);

    let applicationError: unknown;
    try {
      applyGraphCommand(boundDocument, preparedCleanup.batch);
    } catch (error) {
      applicationError = error;
    }

    expect(applicationError).toBeInstanceOf(GraphCommandApplicationError);
    if (applicationError instanceof GraphCommandApplicationError) {
      expect(
        applicationError.issues.some(
          (issue) =>
            issue.code === "precondition_failed" &&
            issue.path.endsWith(".requiredDisposition"),
        ),
      ).toBe(true);
    }
    expect(boundDocument).toEqual(before);
    for (const resourceId of [
      operationId + ".node.dynamodb-policy-document",
      operationId + ".node.dynamodb-policy",
      operationId + ".edge.policy-document-statement",
      operationId + ".edge.policy-role",
      operationId + ".edge.policy-table",
      directEdgeId,
    ]) {
      expect(
        boundDocument.nodes.some((node) => node.id === resourceId) ||
          boundDocument.edges.some((edge) => edge.id === resourceId),
      ).toBe(true);
    }
    expect(
      composeProviderConnectionIamRequirementsV1(
        awsCatalogArtifactV1,
        boundDocument,
      ),
    ).toEqual(iamBefore);
  });

  it("atomically edits DynamoDB access while preserving generated identities and provenance", () => {
    const created = awsConnectionResolverV1.resolve({
      document: createDocument(),
      ruleId: "aws.lambda.writes-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "stable_table",
    });
    expect(created.success).toBe(true);
    if (!created.success) {
      return;
    }
    const beforeEdit = structuredClone(created.preview.document);

    const edited = awsConnectionResolverV1.edit({
      document: created.preview.document,
      connectionEdgeId: "stable_table.edge.connection",
      ruleId: "aws.lambda.writes-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "edit_table",
    });

    expect(edited.success).toBe(true);
    if (!edited.success) {
      return;
    }
    expect(edited.batch.kind).toBe("batch");
    expect(edited.batch.commands).toHaveLength(12);
    expect(edited.generatedResources).toEqual(created.generatedResources);
    expect(edited.iamEffects).toEqual([
      expect.objectContaining({
        actions: [
          "dynamodb:DeleteItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
        ],
      }),
    ]);
    const connection = edited.preview.document.edges.find(
      (edge) => edge.id === "stable_table.edge.connection",
    );
    expect(connection?.semantic.configuration.values).toEqual({});
    const policy = edited.preview.document.nodes.find(
      (node) => node.id === "stable_table.node.dynamodb-policy",
    );
    expect(policy?.semantic.configuration.values).toMatchObject({
      actions: {
        kind: "string-list",
        value: [
          "dynamodb:DeleteItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
        ],
      },
    });
    for (const resource of edited.generatedResources) {
      const element =
        resource.kind === "node"
          ? edited.preview.document.nodes.find(
              (node) => node.id === resource.nodeId,
            )
          : edited.preview.document.edges.find(
              (edge) => edge.id === resource.edgeId,
            );
      expect(element?.semantic.lifecycle).toMatchObject({
        ownership: "generated",
        provenance: {
          generatorId: "aws.lambda.writes-dynamodb-table",
          operationId: "stable_table",
        },
      });
    }
    expect(edited.preview.changes.at(-1)).toEqual(
      expect.objectContaining({
        kind: "batch-applied",
        commandCount: 12,
      }),
    );

    const customizedDocument = structuredClone(created.preview.document);
    const customizedPolicy = customizedDocument.nodes.find(
      (node) => node.id === "stable_table.node.dynamodb-policy",
    );
    if (customizedPolicy === undefined) {
      throw new TypeError("Expected the generated DynamoDB policy.");
    }
    (
      customizedPolicy.semantic.configuration.values as unknown as Record<
        string,
        unknown
      >
    )["statementId"] = {
      kind: "string",
      value: "ManuallyChanged",
    };
    const blocked = awsConnectionResolverV1.edit({
      document: customizedDocument,
      connectionEdgeId: "stable_table.edge.connection",
      ruleId: "aws.lambda.writes-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "edit_custom",
    });
    expect(blocked.success).toBe(false);
    if (!blocked.success) {
      expect(blocked.findings[0]?.code).toBe(
        "cloudmarkup.connection.customized-resource-blocks-edit",
      );
    }

    const orphanDocument = structuredClone(created.preview.document);
    const generatedPolicy = orphanDocument.nodes.find(
      (node) => node.id === "stable_table.node.dynamodb-policy",
    );
    if (generatedPolicy?.semantic.lifecycle.ownership !== "generated") {
      throw new TypeError("Expected the generated DynamoDB policy.");
    }
    const orphanPolicy = structuredClone(generatedPolicy);
    Object.assign(orphanPolicy, { id: "orphan_dynamodb_policy" });
    Object.assign(orphanPolicy.semantic, {
      deploymentKey: "orphan_dynamodb_policy",
    });
    const orphanLifecycle = orphanPolicy.semantic.lifecycle;
    if (orphanLifecycle.ownership !== "generated") {
      throw new TypeError("Expected cloned generated provenance.");
    }
    Object.assign(orphanLifecycle.provenance, {
      dependentEdgeIds: [],
    });
    const orphanDocumentWithExtra = {
      ...orphanDocument,
      nodes: [...orphanDocument.nodes, orphanPolicy],
    };
    const orphanBlocked = awsConnectionResolverV1.edit({
      document: orphanDocumentWithExtra,
      connectionEdgeId: "stable_table.edge.connection",
      ruleId: "aws.lambda.writes-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "edit_orphan",
    });
    expect(orphanBlocked.success).toBe(false);
    if (!orphanBlocked.success) {
      expect(orphanBlocked.findings[0]?.code).toBe(
        "cloudmarkup.connection.customized-resource-blocks-edit",
      );
    }
    expect(created.preview.document).toEqual(beforeEdit);
  });

  it("keeps API, read, write, role, and logs relationships independent during cleanup", () => {
    const api = awsConnectionResolverV1.resolve({
      document: createDocument({ includeSecondTable: true }),
      ruleId: "aws.apigateway.http-api-invokes-lambda",
      source: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.invocation",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.synchronous-invocation",
      },
      configuration: {
        routeKey: { kind: "string", value: "GET /notes" },
      },
      operationId: "multi_api",
    });
    expect(api.success).toBe(true);
    if (!api.success) {
      return;
    }
    const read = awsConnectionResolverV1.resolve({
      document: api.preview.document,
      ruleId: "aws.lambda.reads-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-read",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "multi_read",
    });
    expect(read.success).toBe(true);
    if (!read.success) {
      return;
    }
    const write = awsConnectionResolverV1.resolve({
      document: read.preview.document,
      ruleId: "aws.lambda.writes-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      target: {
        nodeId: "table2",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "multi_write",
    });
    expect(write.success).toBe(true);
    if (!write.success) {
      return;
    }
    const logs = awsConnectionResolverV1.resolve({
      document: write.preview.document,
      ruleId: "aws.lambda.writes-log-group",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.logging",
      },
      target: {
        nodeId: "logs",
        portId: "aws.cloudwatch.log-group.logs",
      },
      configuration: {},
      operationId: "multi_logs",
    });
    expect(logs.success).toBe(true);
    if (!logs.success) {
      return;
    }

    expect(logs.preview.document.edges.map((edge) => edge.id)).toEqual(
      expect.arrayContaining([
        "role_lambda",
        "multi_api.edge.connection",
        "multi_read.edge.connection",
        "multi_write.edge.connection",
        "multi_logs.edge.connection",
      ]),
    );
    const policyNodes = logs.preview.document.nodes.filter(
      (candidate) =>
        candidate.semantic.serviceType === "aws.iam.policy-statement",
    );
    expect(policyNodes).toHaveLength(4);
    expect(
      logs.preview.document.nodes.find(
        (node) => node.id === "multi_api.node.lambda-service-grant",
      )?.semantic.configuration.values,
    ).toMatchObject({
      actions: {
        kind: "string-list",
        value: ["lambda:InvokeFunction"],
      },
      effect: { kind: "string", value: "allow" },
      principalKind: { kind: "string", value: "service" },
      principals: {
        kind: "string-list",
        value: ["apigateway.amazonaws.com"],
      },
      resourceExpressions: { kind: "string-list", value: [] },
      resourceNode: {
        kind: "node-reference",
        nodeId: "lambda",
        attribute: "aws.lambda.function.arn",
      },
    });
    expect(
      logs.preview.document.nodes.find(
        (node) => node.id === "multi_logs.node.logs-policy",
      )?.semantic.configuration.values,
    ).toMatchObject({
      actions: {
        kind: "string-list",
        value: ["logs:CreateLogStream", "logs:PutLogEvents"],
      },
      effect: { kind: "string", value: "allow" },
      principalKind: { kind: "string", value: "none" },
      principals: { kind: "string-list", value: [] },
      resourceExpressions: { kind: "string-list", value: [] },
      resourceNode: {
        kind: "node-reference",
        nodeId: "logs",
        attribute: "aws.cloudwatch.log-group.arn",
      },
    });
    expect(
      logs.preview.document.edges.map((edge) => [
        edge.id,
        edge.semantic.relationshipType,
        edge.semantic.source.port,
        edge.semantic.target.port,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [
          "multi_api.edge.lambda-service-grant-scope",
          "aws.iam.authorizes-lambda-function",
          "aws.iam.policy-statement.lambda-resource",
          "aws.lambda.function.policy-resource",
        ],
        [
          "multi_logs.edge.logs-policy-scope",
          "aws.iam.authorizes-log-group",
          "aws.iam.policy-statement.log-group-resource",
          "aws.cloudwatch.log-group.policy-resource",
        ],
      ]),
    );
    expect(
      logs.iamRequirements
        .filter((requirement) => requirement.ruleId.startsWith("aws.lambda."))
        .map((requirement) => requirement.sourceEdgeId),
    ).toEqual(
      expect.arrayContaining([
        "multi_read.edge.connection",
        "multi_write.edge.connection",
        "multi_logs.edge.connection",
      ]),
    );

    const composedDataAndLogRequirements = logs.iamRequirements.filter(
      (requirement) =>
        [
          "aws.lambda.reads-dynamodb-table",
          "aws.lambda.writes-dynamodb-table",
          "aws.lambda.writes-log-group",
        ].includes(requirement.ruleId),
    );
    expect(
      composedDataAndLogRequirements.map((requirement) => [
        requirement.sourceEdgeId,
        requirement.ruleId,
        requirement.effectId,
        requirement.actions,
        requirement.resource,
      ]),
    ).toEqual([
      [
        "multi_logs.edge.connection",
        "aws.lambda.writes-log-group",
        "aws.lambda.iam.cloudwatch-log-delivery",
        ["logs:CreateLogStream", "logs:PutLogEvents"],
        { scope: "target-node", nodeId: "logs" },
      ],
      [
        "multi_read.edge.connection",
        "aws.lambda.reads-dynamodb-table",
        "aws.lambda.iam.dynamodb-read",
        ["dynamodb:GetItem", "dynamodb:Query"],
        { scope: "connected-target", nodeId: "table" },
      ],
      [
        "multi_write.edge.connection",
        "aws.lambda.writes-dynamodb-table",
        "aws.lambda.iam.dynamodb-write",
        ["dynamodb:DeleteItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
        { scope: "connected-target", nodeId: "table2" },
      ],
    ]);

    const recomposed = composeProviderConnectionIamRequirementsV1(
      awsCatalogArtifactV1,
      {
        ...logs.preview.document,
        edges: [...logs.preview.document.edges].reverse(),
      },
    );
    expect(recomposed.success).toBe(true);
    if (recomposed.success) {
      expect(recomposed.requirements).toEqual(logs.iamRequirements);
    }

    const cleanup = awsConnectionResolverV1.cleanup({
      document: logs.preview.document,
      connectionEdgeId: "multi_read.edge.connection",
      operationId: "cleanup_read",
    });
    expect(cleanup.success).toBe(true);
    if (!cleanup.success) {
      return;
    }
    expect(
      cleanup.preview.document.edges.some(
        (edge) => edge.id === "multi_read.edge.connection",
      ),
    ).toBe(false);
    for (const preservedEdgeId of [
      "role_lambda",
      "multi_api.edge.connection",
      "multi_write.edge.connection",
      "multi_logs.edge.connection",
    ]) {
      expect(
        cleanup.preview.document.edges.some(
          (edge) => edge.id === preservedEdgeId,
        ),
      ).toBe(true);
    }
    expect(
      cleanup.preview.document.nodes.some(
        (node) => node.id === "multi_read.node.dynamodb-policy",
      ),
    ).toBe(false);
    expect(
      cleanup.preview.document.nodes.some(
        (node) => node.id === "multi_write.node.dynamodb-policy",
      ),
    ).toBe(true);
  });

  it("removes generated log permissions without touching a direct user custom policy", () => {
    const document = withUserCustomPolicy(createDocument());
    const before = structuredClone(document);
    const resolved = awsConnectionResolverV1.resolve({
      document,
      ruleId: "aws.lambda.writes-log-group",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.logging",
      },
      target: {
        nodeId: "logs",
        portId: "aws.cloudwatch.log-group.logs",
      },
      configuration: {},
      operationId: "logs_with_custom",
    });
    expect(resolved.success).toBe(true);
    if (!resolved.success) {
      return;
    }
    const cleanup = awsConnectionResolverV1.cleanup({
      document: resolved.preview.document,
      connectionEdgeId: "logs_with_custom.edge.connection",
      operationId: "cleanup_logs_with_custom",
    });
    expect(cleanup.success).toBe(true);
    if (!cleanup.success) {
      return;
    }
    for (const userNodeId of [
      "custom_policy_document",
      "custom_policy_statement",
    ]) {
      expect(
        cleanup.preview.document.nodes.find((node) => node.id === userNodeId),
      ).toEqual(before.nodes.find((node) => node.id === userNodeId));
    }
    for (const userEdgeId of [
      "custom_policy_owner",
      "custom_policy_membership",
      "custom_policy_scope",
    ]) {
      expect(
        cleanup.preview.document.edges.find((edge) => edge.id === userEdgeId),
      ).toEqual(before.edges.find((edge) => edge.id === userEdgeId));
    }
    expect(
      cleanup.preview.document.nodes.some((node) =>
        String(node.id).startsWith("logs_with_custom.node."),
      ),
    ).toBe(false);
    expect(document).toEqual(before);
  });

  it("blocks cleanup after a generated supporting resource is adopted and customized", () => {
    const resolved = awsConnectionResolverV1.resolve({
      document: createDocument(),
      ruleId: "aws.lambda.writes-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "adopt_source",
    });
    expect(resolved.success).toBe(true);
    if (!resolved.success) {
      return;
    }
    const policyResource = resolved.generatedResources.find(
      (resource) => resource.kind === "node",
    );
    if (policyResource?.kind !== "node") {
      throw new TypeError("Expected a generated policy node.");
    }
    const adoption = awsConnectionResolverV1.adopt({
      document: resolved.preview.document,
      resource: policyResource,
      adoptedBy: "actor_editor",
      adoptedAt: "2026-07-24T13:00:00Z",
      operationId: "adopt_policy",
    });
    expect(adoption.success).toBe(true);
    if (!adoption.success) {
      return;
    }
    const customizedDocument = structuredClone(adoption.preview.document);
    const policy = customizedDocument.nodes.find(
      (candidate) => candidate.id === policyResource.nodeId,
    );
    if (policy === undefined) {
      throw new TypeError("Expected the adopted policy node.");
    }
    (
      policy.semantic.configuration.values as unknown as Record<string, unknown>
    )["statementId"] = {
      kind: "string",
      value: "UserCustomizedPolicy",
    };

    const cleanup = awsConnectionResolverV1.cleanup({
      document: customizedDocument,
      connectionEdgeId: "adopt_source.edge.connection",
      operationId: "cleanup_adopted",
    });
    expect(cleanup.success).toBe(false);
    if (!cleanup.success) {
      expect(cleanup.findings[0]?.code).toBe(
        "cloudmarkup.connection.adopted-resource-blocks-cleanup",
      );
    }
    const edit = awsConnectionResolverV1.edit({
      document: customizedDocument,
      connectionEdgeId: "adopt_source.edge.connection",
      ruleId: "aws.lambda.writes-dynamodb-table",
      source: {
        nodeId: "lambda",
        portId: "aws.lambda.function.data-write",
      },
      target: {
        nodeId: "table",
        portId: "aws.dynamodb.table.table-api",
      },
      configuration: {},
      operationId: "edit_adopted",
    });
    expect(edit.success).toBe(false);
    if (!edit.success) {
      expect(edit.findings[0]?.code).toBe(
        "cloudmarkup.connection.adopted-resource-blocks-cleanup",
      );
    }
    expect(customizedDocument.nodes).toContain(policy);
  });

  it("completes Cognito authorization from separate issuer and audience previews", () => {
    const issuer = awsConnectionResolverV1.resolve({
      document: createDocument(),
      ruleId: "aws.cognito.user-pool-authorizes-http-api",
      source: {
        nodeId: "pool",
        portId: "aws.cognito.user-pool.jwt-issuer",
      },
      target: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.jwt-issuer",
      },
      configuration: {},
      operationId: "jwt_issuer",
    });
    expect(issuer.success).toBe(true);
    if (!issuer.success) {
      return;
    }
    expect(issuer.findings).toEqual([
      expect.objectContaining({
        code: "aws.cognito.finding.jwt-audience-required",
        severity: "warning",
      }),
    ]);

    const audience = awsConnectionResolverV1.resolve({
      document: issuer.preview.document,
      ruleId: "aws.cognito.app-client-authorizes-http-api",
      source: {
        nodeId: "client",
        portId: "aws.cognito.user-pool-client.jwt-audience",
      },
      target: {
        nodeId: "api",
        portId: "aws.apigateway.http-api.jwt-audience",
      },
      configuration: {},
      operationId: "jwt_audience",
    });
    expect(audience.success).toBe(true);
    if (audience.success) {
      expect(audience.findings).toEqual([]);
    }
  });

  it("previews the exclusive IAM role attachment without changing the input", () => {
    const document = createDocument({ includeRoleEdge: false });
    const before = structuredClone(document);
    const result = awsConnectionResolverV1.resolve({
      document,
      ruleId: "aws.iam.role-assumed-by-lambda",
      source: {
        nodeId: "role",
        portId: "aws.iam.role.assumable-role",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.execution-role",
      },
      configuration: {},
      operationId: "attach_role",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.generatedResources).toHaveLength(5);
      expect(result.iamEffects).toEqual([
        expect.objectContaining({
          effect: "trust",
          actions: ["sts:AssumeRole"],
          principal: "lambda.amazonaws.com",
        }),
      ]);
      const trustDocument = result.preview.document.nodes.find(
        (candidate) =>
          candidate.id === "attach_role.node.lambda-trust-policy-document",
      );
      const trustStatement = result.preview.document.nodes.find(
        (candidate) => candidate.id === "attach_role.node.lambda-trust-policy",
      );
      expect(trustDocument).toMatchObject({
        semantic: {
          serviceType: "aws.iam.policy-document",
          parent: {
            nodeId: "role",
            relationshipType: "aws.iam.role-owns-trust-policy",
          },
          configuration: {
            values: {
              policyKind: { kind: "string", value: "trust" },
              policyName: { kind: "string", value: "LambdaTrustPolicy" },
            },
          },
          lifecycle: {
            ownership: "generated",
            origin: "connection-rule",
            provenance: {
              operationId: "attach_role",
              dependentEdgeIds: ["attach_role.edge.connection"],
            },
          },
        },
      });
      expect(trustStatement).toMatchObject({
        semantic: {
          serviceType: "aws.iam.policy-statement",
          parent: {
            nodeId: "attach_role.node.lambda-trust-policy-document",
            relationshipType: "aws.iam.policy-contains-statement",
          },
          configuration: {
            values: {
              actions: {
                kind: "string-list",
                value: ["sts:AssumeRole"],
              },
              effect: { kind: "string", value: "allow" },
              principalKind: { kind: "string", value: "service" },
              principals: {
                kind: "string-list",
                value: ["lambda.amazonaws.com"],
              },
              resourceExpressions: { kind: "string-list", value: [] },
              statementId: { kind: "string", value: "LambdaTrust" },
            },
          },
        },
      });
      expect(
        result.preview.document.edges.map((edge) => [
          edge.id,
          edge.semantic.relationshipType,
          edge.semantic.source.port,
          edge.semantic.target.port,
        ]),
      ).toEqual(
        expect.arrayContaining([
          [
            "attach_role.edge.lambda-trust-policy-role",
            "aws.iam.role-owns-trust-policy",
            "aws.iam.policy-document.role-trust-policy",
            "aws.iam.role.trust-policy",
          ],
          [
            "attach_role.edge.lambda-trust-policy-statement",
            "aws.iam.policy-contains-statement",
            "aws.iam.policy-statement.policy-document",
            "aws.iam.policy-document.statement",
          ],
        ]),
      );
      const cleanup = awsConnectionResolverV1.cleanup({
        document: result.preview.document,
        connectionEdgeId: "attach_role.edge.connection",
        operationId: "cleanup_attach_role",
      });
      expect(cleanup.success).toBe(true);
      if (cleanup.success) {
        expect(
          cleanup.preview.document.nodes.some((node) =>
            String(node.id).startsWith("attach_role.node."),
          ),
        ).toBe(false);
      }
    }
    expect(document).toEqual(before);
  });

  it("reuses only an exact user trust policy and fails closed for incompatible, ambiguous, or colliding trust", () => {
    const seeded = awsConnectionResolverV1.resolve({
      document: createDocument({ includeRoleEdge: false }),
      ruleId: "aws.iam.role-assumed-by-lambda",
      source: {
        nodeId: "role",
        portId: "aws.iam.role.assumable-role",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.execution-role",
      },
      configuration: {},
      operationId: "seed_trust",
    });
    expect(seeded.success).toBe(true);
    if (!seeded.success) {
      return;
    }

    const userTrust = structuredClone(seeded.preview.document);
    userTrust.edges = userTrust.edges.filter(
      (edge) => edge.id !== "seed_trust.edge.connection",
    );
    for (const resource of [
      ...userTrust.nodes.filter((node) =>
        String(node.id).startsWith("seed_trust.node."),
      ),
      ...userTrust.edges.filter((edge) =>
        String(edge.id).startsWith("seed_trust.edge."),
      ),
    ]) {
      Object.assign(resource.semantic, {
        lifecycle: { ownership: "user", origin: "user" },
      });
    }
    const beforeReuse = structuredClone(userTrust);
    const reused = awsConnectionResolverV1.resolve({
      document: userTrust,
      ruleId: "aws.iam.role-assumed-by-lambda",
      source: {
        nodeId: "role",
        portId: "aws.iam.role.assumable-role",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.execution-role",
      },
      configuration: {},
      operationId: "reuse_trust",
    });
    expect(reused.success).toBe(true);
    if (reused.success) {
      expect(reused.generatedResources).toEqual([
        { kind: "edge", edgeId: "reuse_trust.edge.connection" },
      ]);
      expect(
        reused.preview.document.nodes.filter((node) =>
          String(node.id).startsWith("seed_trust.node."),
        ),
      ).toEqual(
        beforeReuse.nodes.filter((node) =>
          String(node.id).startsWith("seed_trust.node."),
        ),
      );
      const cleanup = awsConnectionResolverV1.cleanup({
        document: reused.preview.document,
        connectionEdgeId: "reuse_trust.edge.connection",
        operationId: "cleanup_reused_trust",
      });
      expect(cleanup.success).toBe(true);
      if (cleanup.success) {
        expect(
          cleanup.preview.document.nodes.filter((node) =>
            String(node.id).startsWith("seed_trust.node."),
          ),
        ).toEqual(
          beforeReuse.nodes.filter((node) =>
            String(node.id).startsWith("seed_trust.node."),
          ),
        );
      }
    }
    expect(userTrust).toEqual(beforeReuse);

    const incompatibleTrust = structuredClone(userTrust);
    const incompatibleStatement = incompatibleTrust.nodes.find(
      (node) => node.id === "seed_trust.node.lambda-trust-policy",
    );
    if (incompatibleStatement === undefined) {
      throw new TypeError("Expected the seeded trust statement.");
    }
    (
      incompatibleStatement.semantic.configuration.values as unknown as Record<
        string,
        unknown
      >
    )["principals"] = {
      kind: "string-list",
      value: ["ec2.amazonaws.com"],
    };
    const incompatible = awsConnectionResolverV1.resolve({
      document: incompatibleTrust,
      ruleId: "aws.iam.role-assumed-by-lambda",
      source: {
        nodeId: "role",
        portId: "aws.iam.role.assumable-role",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.execution-role",
      },
      configuration: {},
      operationId: "incompatible_trust",
    });
    expect(incompatible.success).toBe(false);
    if (!incompatible.success) {
      expect(incompatible.findings.map((finding) => finding.code)).toEqual([
        "aws.iam.finding.lambda-trust-policy-incompatible",
      ]);
    }

    const ambiguousTrust = structuredClone(userTrust);
    const secondDocument = structuredClone(
      ambiguousTrust.nodes.find(
        (node) => node.id === "seed_trust.node.lambda-trust-policy-document",
      ),
    );
    const secondStatement = structuredClone(
      ambiguousTrust.nodes.find(
        (node) => node.id === "seed_trust.node.lambda-trust-policy",
      ),
    );
    const secondOwner = structuredClone(
      ambiguousTrust.edges.find(
        (edge) => edge.id === "seed_trust.edge.lambda-trust-policy-role",
      ),
    );
    const secondMembership = structuredClone(
      ambiguousTrust.edges.find(
        (edge) => edge.id === "seed_trust.edge.lambda-trust-policy-statement",
      ),
    );
    if (
      secondDocument === undefined ||
      secondStatement === undefined ||
      secondOwner === undefined ||
      secondMembership === undefined
    ) {
      throw new TypeError("Expected a complete seeded trust graph.");
    }
    Object.assign(secondDocument, { id: "second_trust_document" });
    Object.assign(secondDocument.semantic, {
      deploymentKey: "second_trust_document",
    });
    Object.assign(secondStatement, { id: "second_trust_statement" });
    Object.assign(secondStatement.semantic, {
      deploymentKey: "second_trust_statement",
      parent: {
        nodeId: "second_trust_document",
        relationshipType: "aws.iam.policy-contains-statement",
      },
    });
    Object.assign(secondOwner, { id: "second_trust_owner" });
    Object.assign(secondOwner.semantic.source, {
      nodeId: "second_trust_document",
    });
    Object.assign(secondMembership, { id: "second_trust_membership" });
    Object.assign(secondMembership.semantic.source, {
      nodeId: "second_trust_statement",
    });
    Object.assign(secondMembership.semantic.target, {
      nodeId: "second_trust_document",
    });
    ambiguousTrust.nodes.push(secondDocument, secondStatement);
    ambiguousTrust.edges.push(secondOwner, secondMembership);
    const ambiguous = awsConnectionResolverV1.resolve({
      document: ambiguousTrust,
      ruleId: "aws.iam.role-assumed-by-lambda",
      source: {
        nodeId: "role",
        portId: "aws.iam.role.assumable-role",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.execution-role",
      },
      configuration: {},
      operationId: "ambiguous_trust",
    });
    expect(ambiguous.success).toBe(false);
    if (!ambiguous.success) {
      expect(ambiguous.findings.map((finding) => finding.code)).toEqual([
        "aws.iam.finding.lambda-trust-policy-ambiguous",
      ]);
    }

    const idCollision = structuredClone(
      createDocument({ includeRoleEdge: false }),
    );
    const collidingNode = idCollision.nodes.find((node) => node.id === "logs");
    if (collidingNode === undefined) {
      throw new TypeError("Expected the log-group fixture node.");
    }
    Object.assign(collidingNode, {
      id: "colliding_trust.node.lambda-trust-policy-document",
    });
    const collision = awsConnectionResolverV1.resolve({
      document: idCollision,
      ruleId: "aws.iam.role-assumed-by-lambda",
      source: {
        nodeId: "role",
        portId: "aws.iam.role.assumable-role",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.execution-role",
      },
      configuration: {},
      operationId: "colliding_trust",
    });
    expect(collision.success).toBe(false);
    if (!collision.success) {
      expect(collision.findings.map((finding) => finding.code)).toEqual([
        "aws.iam.finding.lambda-trust-policy-generated-collision",
      ]);
    }
  });

  it("rejects a second execution-role attachment against the v3 preview", () => {
    const document = createDocument({
      includeRoleEdge: false,
      includeSecondRole: true,
    });
    const first = awsConnectionResolverV1.resolve({
      document,
      ruleId: "aws.iam.role-assumed-by-lambda",
      source: {
        nodeId: "role",
        portId: "aws.iam.role.assumable-role",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.execution-role",
      },
      configuration: {},
      operationId: "attach_first_role",
    });
    expect(first.success).toBe(true);
    if (!first.success) {
      return;
    }
    expect(first.preview.document.schemaVersion).toBe(3);

    const second = awsConnectionResolverV1.resolve({
      document: first.preview.document,
      ruleId: "aws.iam.role-assumed-by-lambda",
      source: {
        nodeId: "role2",
        portId: "aws.iam.role.assumable-role",
      },
      target: {
        nodeId: "lambda",
        portId: "aws.lambda.function.execution-role",
      },
      configuration: {},
      operationId: "attach_second_role",
    });
    expect(second.success).toBe(false);
    if (!second.success) {
      expect(second.findings.map((finding) => finding.code)).toEqual([
        "cloudmarkup.connection.target-port-cardinality-exceeded",
        "cloudmarkup.connection.target-cardinality-exceeded",
      ]);
    }
  });
});
