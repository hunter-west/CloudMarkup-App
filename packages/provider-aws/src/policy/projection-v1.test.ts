import {
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  defineProviderOwnedConfigurationSlotV1,
  type ProviderOwnedConfigurationSlotV1,
} from "@cloudmarkup/provider-sdk";
import {
  serializeCanonicalJson,
  type ArchitectureDocumentV2,
  type ConfigurationValue,
  type ElementLifecycle,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";
import { awsCatalogV1 } from "../catalog-v1-accessors.js";

import {
  AWS_IAM_POLICY_RESOURCE_SCOPES_V1,
  projectAwsCanonicalPolicyDocumentsV1,
  type AwsCanonicalPolicyProjectionResultV1,
  type AwsPolicyOwnerSlotDescriptorV1,
} from "./projection-v1.js";

type TestNode = ArchitectureDocumentV2["nodes"][number];
type TestEdge = ArchitectureDocumentV2["edges"][number];
type GeneratedLifecycle = Extract<ElementLifecycle, { ownership: "generated" }>;

const roleNodeId = "node_policy_owner" as TestNode["id"];
const tableNodeId = "node_policy_table" as TestNode["id"];
const policyNodeId = "node_policy_document" as TestNode["id"];
const statementNodeId = "node_policy_statement" as TestNode["id"];
const conditionNodeId = "node_policy_condition" as TestNode["id"];

function targetReadiness() {
  return {
    modeling: {
      status: "supported" as const,
      reason: "The typed graph models this policy configuration.",
    },
    configuration: {
      status: "supported" as const,
      reason: "The bounded graph configuration is editable.",
    },
    validation: {
      status: "supported" as const,
      reason: "Deterministic policy validation is available.",
    },
    terraform: {
      status: "pending" as const,
      reason: "Terraform rendering remains pending until Prompt 29.",
    },
    cloudformation: {
      status: "pending" as const,
      reason: "CloudFormation rendering remains pending until Prompt 46.",
    },
    generatedCode: {
      status: "not-applicable" as const,
      reason: "IAM policy documents do not generate application code.",
    },
  };
}

function customPolicySlot(options?: {
  readonly allowedOwnership?: readonly ("user" | "generated")[];
}): ProviderOwnedConfigurationSlotV1 {
  return defineProviderOwnedConfigurationSlotV1({
    id: "aws.iam.role.slot.custom-inline-policies",
    slotVersion: "1.0.0",
    configurationKind: "aws.iam.configuration.policy-document",
    displayName: "Custom inline policies",
    description: "User-authored identity policies owned by one IAM role.",
    graphBinding: {
      configurationServiceId: "aws.iam.policy-document",
      ownershipRelationshipType: "aws.iam.role-owns-inline-policy",
    },
    cardinality: {
      minimum: 0,
      maximum: "many",
      enforcement: "provider-rule",
    },
    allowedOwnership: [...(options?.allowedOwnership ?? ["user"])],
    generatedAdoption:
      options?.allowedOwnership?.includes("generated") === true
        ? "allowed"
        : "not-applicable",
    policyKinds: ["identity-inline"],
    targetReadiness: targetReadiness(),
    guidedExplanation: "Add only the permissions this role needs.",
    professionalExplanation:
      "The exact graph owner edge binds this policy to the role slot.",
  });
}

function ownerDescriptor(
  slot = customPolicySlot(),
): AwsPolicyOwnerSlotDescriptorV1 {
  return {
    slot,
    ownerServiceType: "aws.iam.role",
    ownerResourceType: "aws.iam.role",
    policyDocumentPort: "aws.iam.policy-document.role-inline-policy",
    ownerPort: "aws.iam.role.custom-inline-policy",
    bindingConfigurationSchemaId: "aws.iam.role-inline-policy.attachment",
    bindingConfigurationSchemaVersion: "1.0.0",
  };
}

function userLifecycle(): ElementLifecycle {
  return { ownership: "user", origin: "user" };
}

function generatedLifecycle(): GeneratedLifecycle {
  return {
    ownership: "generated",
    origin: "connection-rule",
    provenance: {
      generatorKind: "connection-rule",
      generatorId:
        "aws.generator.policy-projection-test" as GeneratedLifecycle["provenance"]["generatorId"],
      generatorVersion:
        "1.0.0" as GeneratedLifecycle["provenance"]["generatorVersion"],
      operationId:
        "operation_policy_projection" as GeneratedLifecycle["provenance"]["operationId"],
      dependentNodeIds: [roleNodeId, tableNodeId],
      dependentEdgeIds: [],
    },
  };
}

function configuration(
  schemaId: string,
  schemaVersion: string,
  values: Readonly<Record<string, ConfigurationValue>>,
) {
  return {
    schemaId,
    schemaVersion,
    values,
  } as TestNode["semantic"]["configuration"];
}

function node(
  id: string,
  serviceType: string,
  nodeConfiguration: TestNode["semantic"]["configuration"],
  lifecycle: ElementLifecycle,
  parent?: { readonly nodeId: string; readonly relationshipType: string },
): TestNode {
  return {
    id,
    semantic: {
      deploymentKey: id,
      serviceType,
      resourceType: serviceType,
      configuration: nodeConfiguration,
      ...(parent === undefined ? {} : { parent }),
      lifecycle,
    },
    presentation: {
      label: id,
      position: { x: 0, y: 0 },
    },
  } as TestNode;
}

function edge(
  id: string,
  sourceNodeId: string,
  sourcePort: string,
  targetNodeId: string,
  targetPort: string,
  relationshipType: string,
  schemaId: string,
  lifecycle: ElementLifecycle,
): TestEdge {
  return {
    id,
    semantic: {
      source: { nodeId: sourceNodeId, port: sourcePort },
      target: { nodeId: targetNodeId, port: targetPort },
      relationshipType,
      configuration: configuration(schemaId, "1.0.0", {}),
      lifecycle,
    },
  } as TestEdge;
}

function policyDocumentNode(lifecycle: ElementLifecycle): TestNode {
  return node(
    policyNodeId,
    "aws.iam.policy-document",
    configuration("aws.iam.policy-document.configuration", "1.0.0", {
      policyName: { kind: "string", value: "ReadNotes" },
      policyKind: { kind: "string", value: "identity-inline" },
    }),
    lifecycle,
    {
      nodeId: roleNodeId,
      relationshipType: "aws.iam.role-owns-inline-policy",
    },
  );
}

function statementNode(
  id: string,
  lifecycle: ElementLifecycle,
  statementId = "ReadNotes",
  overrides: Readonly<Record<string, ConfigurationValue>> = {},
): TestNode {
  return node(
    id,
    "aws.iam.policy-statement",
    configuration("aws.iam.policy-statement.configuration", "2.0.0", {
      statementId: { kind: "string", value: statementId },
      effect: { kind: "string", value: "allow" },
      actions: { kind: "string-list", value: ["dynamodb:GetItem"] },
      principalKind: { kind: "string", value: "none" },
      principals: { kind: "string-list", value: [] },
      resourceExpressions: { kind: "string-list", value: [] },
      resourceNode: {
        kind: "node-reference",
        nodeId: tableNodeId,
        attribute: "aws.dynamodb.table.arn",
      } as ConfigurationValue,
      ...overrides,
    }),
    lifecycle,
    {
      nodeId: policyNodeId,
      relationshipType: "aws.iam.policy-contains-statement",
    },
  );
}

function conditionNode(lifecycle: ElementLifecycle): TestNode {
  return node(
    conditionNodeId,
    "aws.iam.policy-condition",
    configuration("aws.iam.policy-condition.configuration", "1.0.0", {
      operator: { kind: "string", value: "StringEquals" },
      key: { kind: "string", value: "aws:RequestedRegion" },
      values: { kind: "string-list", value: ["us-east-1"] },
    }),
    lifecycle,
    {
      nodeId: statementNodeId,
      relationshipType: "aws.iam.statement-owns-condition",
    },
  );
}

function statementMembershipEdge(
  id: string,
  statementId: string,
  lifecycle: ElementLifecycle,
): TestEdge {
  return edge(
    id,
    statementId,
    "aws.iam.policy-statement.policy-document",
    policyNodeId,
    "aws.iam.policy-document.statement",
    "aws.iam.policy-contains-statement",
    "aws.iam.policy-membership.connection",
    lifecycle,
  );
}

function statementScopeEdge(
  id: string,
  statementId: string,
  lifecycle: ElementLifecycle,
): TestEdge {
  return edge(
    id,
    statementId,
    "aws.iam.policy-statement.dynamodb-resource",
    tableNodeId,
    "aws.dynamodb.table.policy-resource",
    "aws.iam.authorizes-dynamodb-table",
    "aws.iam.policy-table.connection",
    lifecycle,
  );
}

function createDocument(options?: {
  readonly lifecycle?: ElementLifecycle;
  readonly includeCondition?: boolean;
  readonly duplicateStatement?: boolean;
}): ArchitectureDocument {
  const lifecycle = options?.lifecycle ?? userLifecycle();
  const includeCondition = options?.includeCondition ?? true;
  const duplicateStatement = options?.duplicateStatement ?? false;
  const nodes: TestNode[] = [
    node(
      roleNodeId,
      "aws.iam.role",
      configuration("aws.iam.role.configuration", "1.0.0", {}),
      userLifecycle(),
    ),
    node(
      tableNodeId,
      "aws.dynamodb.table",
      configuration("aws.dynamodb.table.configuration", "1.0.0", {}),
      userLifecycle(),
    ),
    policyDocumentNode(lifecycle),
    statementNode(statementNodeId, lifecycle),
  ];
  const edges: TestEdge[] = [
    edge(
      "edge_policy_owner",
      policyNodeId,
      "aws.iam.policy-document.role-inline-policy",
      roleNodeId,
      "aws.iam.role.custom-inline-policy",
      "aws.iam.role-owns-inline-policy",
      "aws.iam.role-inline-policy.attachment",
      lifecycle,
    ),
    statementMembershipEdge(
      "edge_policy_statement",
      statementNodeId,
      lifecycle,
    ),
    statementScopeEdge("edge_statement_table", statementNodeId, lifecycle),
  ];
  if (includeCondition) {
    nodes.push(conditionNode(lifecycle));
    edges.push(
      edge(
        "edge_statement_condition",
        conditionNodeId,
        "aws.iam.policy-condition.statement-condition",
        statementNodeId,
        "aws.iam.policy-statement.condition",
        "aws.iam.statement-owns-condition",
        "aws.iam.condition-membership.connection",
        lifecycle,
      ),
    );
  }
  if (duplicateStatement) {
    const duplicateId = "node_policy_statement_duplicate";
    nodes.push(statementNode(duplicateId, lifecycle, "ReadNotesDuplicate"));
    edges.push(
      statementMembershipEdge(
        "edge_policy_statement_duplicate",
        duplicateId,
        lifecycle,
      ),
      statementScopeEdge(
        "edge_statement_table_duplicate",
        duplicateId,
        lifecycle,
      ),
    );
  }

  return parseArchitectureDocument({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 2,
    documentId: "document_policy_projection",
    architectureId: "architecture_policy_projection",
    revision: {
      revisionId: "revision_policy_projection",
      revisionNumber: 1,
      createdAt: "2026-08-02T12:00:00Z",
      createdBy: "actor_policy_projection",
    },
    provider: { id: "aws.cloud", region: "us-east-1" },
    catalog: {
      id: "aws.cloudmarkup.catalog",
      version: "1.0.0",
      digest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
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
    nodes,
    edges,
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
    workloadBehavior: { contractVersion: 1, workloads: [] },
  });
}

function requireSuccess(result: AwsCanonicalPolicyProjectionResultV1) {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error("Expected canonical policy projection to succeed.");
  }
  return result;
}

function replaceConfigurationValues(
  document: ArchitectureDocument,
  nodeId: string,
  replace: (
    values: Readonly<Record<string, ConfigurationValue>>,
  ) => Readonly<Record<string, ConfigurationValue>>,
): ArchitectureDocument {
  return parseArchitectureDocument({
    ...document,
    nodes: document.nodes.map((candidate) =>
      candidate.id === nodeId
        ? {
            ...candidate,
            semantic: {
              ...candidate.semantic,
              configuration: {
                ...candidate.semantic.configuration,
                values: replace(
                  candidate.semantic.configuration.values as Readonly<
                    Record<string, ConfigurationValue>
                  >,
                ),
              },
            },
          }
        : candidate,
    ),
  });
}

function withoutResourceNode(
  values: Readonly<Record<string, ConfigurationValue>>,
): Readonly<Record<string, ConfigurationValue>> {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => key !== "resourceNode"),
  );
}

function issueCodes(result: AwsCanonicalPolicyProjectionResultV1) {
  expect(result.success).toBe(false);
  return result.success ? [] : result.issues.map((entry) => entry.code);
}

describe("AWS canonical policy graph projection", () => {
  it("preserves stable graph IDs and projects deterministic typed policy facts with target readiness", () => {
    const document = createDocument();
    const projection = requireSuccess(
      projectAwsCanonicalPolicyDocumentsV1(document, {
        ownerSlots: [ownerDescriptor()],
      }),
    );

    expect(projection.documents).toHaveLength(1);
    expect(projection.documents[0]).toMatchObject({
      id: policyNodeId,
      ownerNodeId: roleNodeId,
      slotId: "aws.iam.role.slot.custom-inline-policies",
      displayName: "ReadNotes",
      policyKind: "identity-inline",
      lifecycle: { ownership: "user", origin: "user" },
      targetReadiness: {
        terraform: { status: "pending" },
        cloudformation: { status: "pending" },
      },
      statements: [
        {
          id: statementNodeId,
          statementIdentifier: "ReadNotes",
          effect: "allow",
          actions: [{ kind: "provider-action", action: "dynamodb:GetItem" }],
          resources: [
            {
              kind: "architecture-node",
              nodeId: tableNodeId,
              attribute: "aws.dynamodb.table.arn",
            },
          ],
          principals: [],
          conditions: [
            {
              id: conditionNodeId,
              operator: "StringEquals",
              key: "aws:RequestedRegion",
              values: [{ kind: "string", value: "us-east-1" }],
            },
          ],
        },
      ],
    });
    expect(Object.isFrozen(projection.documents[0])).toBe(true);

    const reordered = parseArchitectureDocument({
      ...document,
      nodes: [...document.nodes].reverse(),
      edges: [...document.edges].reverse(),
    });
    const reorderedProjection = requireSuccess(
      projectAwsCanonicalPolicyDocumentsV1(reordered, {
        ownerSlots: [ownerDescriptor()],
      }),
    );
    expect(serializeCanonicalJson(reorderedProjection.documents)).toBe(
      serializeCanonicalJson(projection.documents),
    );
  });

  it("projects exact Lambda, log-group, S3 bucket and SQS queue resource scope edges", () => {
    expect(AWS_IAM_POLICY_RESOURCE_SCOPES_V1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationshipType: "aws.iam.authorizes-lambda-function",
          statementPort: "aws.iam.policy-statement.lambda-resource",
          resourcePort: "aws.lambda.function.policy-resource",
          resourceAttribute: "aws.lambda.function.arn",
        }),
        expect.objectContaining({
          relationshipType: "aws.iam.authorizes-log-group",
          statementPort: "aws.iam.policy-statement.log-group-resource",
          resourcePort: "aws.cloudwatch.log-group.policy-resource",
          resourceAttribute: "aws.cloudwatch.log-group.arn",
        }),
      ]),
    );

    for (const scope of [
      {
        serviceType: "aws.lambda.function",
        statementPort: "aws.iam.policy-statement.lambda-resource",
        resourcePort: "aws.lambda.function.policy-resource",
        relationshipType: "aws.iam.authorizes-lambda-function",
        bindingSchemaId: "aws.iam.policy-lambda.connection",
        attribute: "aws.lambda.function.arn",
        action: "lambda:InvokeFunction",
      },
      {
        serviceType: "aws.cloudwatch.log-group",
        statementPort: "aws.iam.policy-statement.log-group-resource",
        resourcePort: "aws.cloudwatch.log-group.policy-resource",
        relationshipType: "aws.iam.authorizes-log-group",
        bindingSchemaId: "aws.iam.policy-log-group.connection",
        attribute: "aws.cloudwatch.log-group.arn",
        action: "logs:PutLogEvents",
      },
      {
        serviceType: "aws.s3.bucket",
        statementPort: "aws.iam.policy-statement.s3-resource",
        resourcePort: "aws.s3.bucket.policy-resource",
        relationshipType: "aws.iam.authorizes-s3-bucket",
        bindingSchemaId:
          "aws.iam.policy-statement-authorizes-s3-bucket.connection",
        attribute: "aws.s3.bucket.arn",
        action: "s3:ListBucket",
      },
      {
        serviceType: "aws.sqs.queue",
        statementPort: "aws.iam.policy-statement.sqs-resource",
        resourcePort: "aws.sqs.queue.policy-resource",
        relationshipType: "aws.iam.authorizes-sqs-queue",
        bindingSchemaId:
          "aws.iam.policy-statement-authorizes-sqs-queue.connection",
        attribute: "aws.sqs.queue.arn",
        action: "sqs:SendMessage",
      },
    ] as const) {
      const base = createDocument({ includeCondition: false });
      const scoped = parseArchitectureDocument({
        ...base,
        nodes: base.nodes.map((candidate) => {
          if (candidate.id === tableNodeId) {
            return {
              ...candidate,
              semantic: {
                ...candidate.semantic,
                serviceType: scope.serviceType,
                resourceType: scope.serviceType,
              },
            };
          }
          if (candidate.id !== statementNodeId) {
            return candidate;
          }
          return {
            ...candidate,
            semantic: {
              ...candidate.semantic,
              configuration: {
                ...candidate.semantic.configuration,
                values: {
                  ...candidate.semantic.configuration.values,
                  actions: { kind: "string-list", value: [scope.action] },
                  resourceNode: {
                    kind: "node-reference",
                    nodeId: tableNodeId,
                    attribute: scope.attribute,
                  },
                },
              },
            },
          };
        }),
        edges: base.edges.map((candidate) =>
          candidate.id === "edge_statement_table"
            ? edge(
                candidate.id,
                statementNodeId,
                scope.statementPort,
                tableNodeId,
                scope.resourcePort,
                scope.relationshipType,
                scope.bindingSchemaId,
                candidate.semantic.lifecycle,
              )
            : candidate,
        ),
      });
      const projection = requireSuccess(
        projectAwsCanonicalPolicyDocumentsV1(scoped, {
          ownerSlots: [ownerDescriptor()],
        }),
      );
      expect(projection.documents[0]?.statements[0]?.resources).toEqual([
        {
          kind: "architecture-node",
          nodeId: tableNodeId,
          attribute: scope.attribute,
        },
      ]);
      expect(projection.documents[0]?.statements[0]?.actions).toEqual([
        { kind: "provider-action", action: scope.action },
      ]);
      expect(
        requireSuccess(
          projectAwsCanonicalPolicyDocumentsV1(
            parseArchitectureDocument({
              ...scoped,
              nodes: [...scoped.nodes].reverse(),
              edges: [...scoped.edges].reverse(),
            }),
            { ownerSlots: [ownerDescriptor()] },
          ),
        ).documents,
      ).toEqual(projection.documents);

      const exactBinding = awsCatalogV1
        .listConnectionRules()
        .find((rule) => rule.relationshipType === scope.relationshipType);
      expect(exactBinding).toMatchObject({
        source: {
          serviceId: "aws.iam.policy-statement",
          portId: scope.statementPort,
        },
        target: { serviceId: scope.serviceType, portId: scope.resourcePort },
        configuration: {
          schemaId: scope.bindingSchemaId,
          schemaVersion: "1.0.0",
        },
      });
      // Graph scopes retain exact resource identity; target rendering owns
      // action-specific ARN derivation, never a model-supplied wildcard.
      const wrongAttribute = replaceConfigurationValues(
        scoped,
        statementNodeId,
        (values) => ({
          ...values,
          resourceNode: {
            kind: "node-reference",
            nodeId: tableNodeId,
            attribute: "aws.s3.bucket.object-arn",
          } as ConfigurationValue,
        }),
      );
      expect(
        issueCodes(
          projectAwsCanonicalPolicyDocumentsV1(wrongAttribute, {
            ownerSlots: [ownerDescriptor()],
          }),
        ),
      ).toContain("resource-scope-mismatch");
      for (const tamper of [
        "port",
        "schema",
        "direction",
        "lifecycle",
      ] as const) {
        const invalid = parseArchitectureDocument({
          ...scoped,
          edges: scoped.edges.map((candidate) => {
            if (candidate.id !== "edge_statement_table") return candidate;
            const semantic = candidate.semantic;
            return {
              ...candidate,
              semantic: {
                ...semantic,
                ...(tamper === "port"
                  ? {
                      target: {
                        ...semantic.target,
                        port: "aws.iam.role.custom-inline-policy",
                      },
                    }
                  : {}),
                ...(tamper === "schema"
                  ? {
                      configuration: {
                        ...semantic.configuration,
                        schemaId: "aws.unreviewed.connection",
                      },
                    }
                  : {}),
                ...(tamper === "direction"
                  ? {
                      source: semantic.target,
                      target: semantic.source,
                    }
                  : {}),
                ...(tamper === "lifecycle"
                  ? { lifecycle: generatedLifecycle() }
                  : {}),
              },
            };
          }),
        });
        expect(
          issueCodes(
            projectAwsCanonicalPolicyDocumentsV1(invalid, {
              ownerSlots: [ownerDescriptor()],
            }),
          ),
        ).toContain(
          tamper === "lifecycle"
            ? "lifecycle-mismatch"
            : "invalid-resource-scope",
        );
      }
    }
  });

  it("preserves generated provenance and rejects mismatched lifecycle authority", () => {
    const lifecycle = generatedLifecycle();
    const generated = requireSuccess(
      projectAwsCanonicalPolicyDocumentsV1(createDocument({ lifecycle }), {
        ownerSlots: [
          ownerDescriptor(
            customPolicySlot({ allowedOwnership: ["user", "generated"] }),
          ),
        ],
      }),
    );
    expect(generated.documents[0]?.lifecycle).toEqual(lifecycle);
    expect(generated.documents[0]?.statements[0]?.lifecycle).toEqual(lifecycle);

    const document = createDocument();
    const mismatch = parseArchitectureDocument({
      ...document,
      nodes: document.nodes.map((candidate) =>
        candidate.id === statementNodeId
          ? {
              ...candidate,
              semantic: { ...candidate.semantic, lifecycle },
            }
          : candidate,
      ),
    });
    expect(
      issueCodes(
        projectAwsCanonicalPolicyDocumentsV1(mismatch, {
          ownerSlots: [ownerDescriptor()],
        }),
      ),
    ).toContain("invalid-statement-binding");
  });

  it("rejects invalid principal kinds plus empty and wildcard action/resource scopes", () => {
    const document = createDocument({ includeCondition: false });
    const principalMismatch = replaceConfigurationValues(
      document,
      statementNodeId,
      (values) => ({
        ...values,
        principalKind: { kind: "string", value: "service" },
        principals: {
          kind: "string-list",
          value: ["lambda.amazonaws.com"],
        },
      }),
    );
    expect(
      issueCodes(
        projectAwsCanonicalPolicyDocumentsV1(principalMismatch, {
          ownerSlots: [ownerDescriptor()],
        }),
      ),
    ).toContain("invalid-principal-kind");

    const legacyEffect = replaceConfigurationValues(
      document,
      statementNodeId,
      (values) => ({
        ...values,
        effect: { kind: "string", value: "Allow" },
      }),
    );
    expect(
      issueCodes(
        projectAwsCanonicalPolicyDocumentsV1(legacyEffect, {
          ownerSlots: [ownerDescriptor()],
        }),
      ),
    ).toContain("invalid-statement-configuration");

    const legacyPrincipalField = replaceConfigurationValues(
      document,
      statementNodeId,
      (values) =>
        Object.fromEntries([
          ...Object.entries(values).filter(([key]) => key !== "principalKind"),
          ["principalType", { kind: "string", value: "None" }],
        ]),
    );
    expect(
      issueCodes(
        projectAwsCanonicalPolicyDocumentsV1(legacyPrincipalField, {
          ownerSlots: [ownerDescriptor()],
        }),
      ),
    ).toContain("invalid-statement-configuration");

    const empty = replaceConfigurationValues(
      parseArchitectureDocument({
        ...document,
        edges: document.edges.filter(
          (candidate) => candidate.id !== "edge_statement_table",
        ),
      }),
      statementNodeId,
      (values) => ({
        ...withoutResourceNode(values),
        actions: { kind: "string-list", value: [] },
      }),
    );
    const emptyCodes = issueCodes(
      projectAwsCanonicalPolicyDocumentsV1(empty, {
        ownerSlots: [ownerDescriptor()],
      }),
    );
    expect(emptyCodes).toContain("empty-actions");
    expect(emptyCodes).toContain("empty-resources");

    const wildcard = replaceConfigurationValues(
      parseArchitectureDocument({
        ...document,
        edges: document.edges.filter(
          (candidate) => candidate.id !== "edge_statement_table",
        ),
      }),
      statementNodeId,
      (values) => ({
        ...withoutResourceNode(values),
        actions: { kind: "string-list", value: ["dynamodb:*"] },
        resourceExpressions: { kind: "string-list", value: ["*"] },
      }),
    );
    const wildcardCodes = issueCodes(
      projectAwsCanonicalPolicyDocumentsV1(wildcard, {
        ownerSlots: [ownerDescriptor()],
      }),
    );
    expect(wildcardCodes).toContain("wildcard-action");
    expect(wildcardCodes).toContain("wildcard-resource");
  });

  it("rejects duplicate equivalent statements even when stable IDs and Sids differ", () => {
    const result = projectAwsCanonicalPolicyDocumentsV1(
      createDocument({ includeCondition: false, duplicateStatement: true }),
      { ownerSlots: [ownerDescriptor()] },
    );

    expect(issueCodes(result)).toContain("duplicate-equivalent-statement");
  });

  it("rejects malformed conditions, mismatched typed scope references, and false compiler readiness claims", () => {
    const document = createDocument();
    const malformedCondition = replaceConfigurationValues(
      document,
      conditionNodeId,
      (values) => ({
        ...values,
        values: { kind: "string-list", value: [] },
      }),
    );
    expect(
      issueCodes(
        projectAwsCanonicalPolicyDocumentsV1(malformedCondition, {
          ownerSlots: [ownerDescriptor()],
        }),
      ),
    ).toContain("malformed-condition");

    const mismatchedScope = replaceConfigurationValues(
      document,
      statementNodeId,
      (values) => ({
        ...values,
        resourceNode: {
          kind: "node-reference",
          nodeId: tableNodeId,
          attribute: "aws.dynamodb.table.stream-arn",
        } as ConfigurationValue,
      }),
    );
    expect(
      issueCodes(
        projectAwsCanonicalPolicyDocumentsV1(mismatchedScope, {
          ownerSlots: [ownerDescriptor()],
        }),
      ),
    ).toContain("resource-scope-mismatch");

    const cloudFormationReadySlot = {
      ...customPolicySlot(),
      targetReadiness: {
        ...targetReadiness(),
        cloudformation: {
          status: "supported" as const,
          reason: "Compiler evidence supports this exact owner slot.",
        },
      },
    } as ProviderOwnedConfigurationSlotV1;
    const readyProjection = requireSuccess(
      projectAwsCanonicalPolicyDocumentsV1(document, {
        ownerSlots: [ownerDescriptor(cloudFormationReadySlot)],
      }),
    );
    expect(
      readyProjection.documents[0]?.targetReadiness.cloudformation,
    ).toEqual(cloudFormationReadySlot.targetReadiness.cloudformation);
  });
});
