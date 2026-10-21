import {
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { awsConnectionResolverV1 } from "@cloudmarkup/provider-aws/connection-resolution";
import {
  regionIdentifierSchema,
  type ConfigurationValue,
} from "@cloudmarkup/schemas";

import type { EditorCatalogService } from "../features/editor/model/editor-catalog.js";
import type {
  ExactPolicyChildRelationshipDescriptor,
  ExactPolicyNodeKindDescriptor,
} from "../features/editor/model/owned-configuration-policy-model.js";
import { awsEditorCatalog } from "./aws-editor-catalog.js";
import { awsOwnedPolicyGraphDescriptors } from "./aws-owned-policy-descriptors.js";

const UNKNOWN_CONFIGURATION_DIGEST =
  "sha256:4444444444444444444444444444444444444444444444444444444444444444";

const LOCAL_NEW_START_REGION_FALLBACK =
  regionIdentifierSchema.parse("us-east-1");

function requireFixtureService(serviceId: string): EditorCatalogService {
  const service = awsEditorCatalog.services.find(
    (candidate) => candidate.serviceType === serviceId,
  );
  if (service === undefined) {
    throw new TypeError(`The editor fixture requires service ${serviceId}.`);
  }
  return service;
}

function fixtureNode({
  deploymentKey,
  id,
  label,
  parent,
  position,
  serviceId,
  values,
}: {
  readonly deploymentKey: string;
  readonly id: string;
  readonly label: string;
  readonly parent?: {
    readonly nodeId: string;
    readonly relationshipType: string;
  };
  readonly position: { readonly x: number; readonly y: number };
  readonly serviceId: string;
  readonly values?: Readonly<Record<string, Readonly<ConfigurationValue>>>;
}) {
  const service = requireFixtureService(serviceId);
  const configuredValues =
    values ??
    (service.configuration.defaults.kind === "ready"
      ? service.configuration.defaults.values
      : undefined);
  if (configuredValues === undefined) {
    throw new TypeError(`The editor fixture requires values for ${serviceId}.`);
  }
  const validation = service.configuration.validate(configuredValues);
  if (!validation.success) {
    throw new TypeError(
      `The editor fixture configuration is invalid for ${serviceId}.`,
    );
  }

  return {
    id,
    semantic: {
      deploymentKey,
      serviceType: service.serviceType,
      resourceType: service.resourceType,
      configuration: {
        schemaId: service.configuration.schemaId,
        schemaVersion: service.configuration.schemaVersion,
        values: structuredClone(validation.values),
      },
      ...(parent === undefined ? {} : { parent: structuredClone(parent) }),
      lifecycle: {
        ownership: "user",
        origin: "template",
      },
    },
    presentation: {
      label,
      position,
    },
  };
}

function createAwsEditorArchitectureInput(
  region: string = LOCAL_NEW_START_REGION_FALLBACK,
) {
  const effectiveRegion = regionIdentifierSchema.parse(region);
  return {
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 2,
    documentId: "doc_aws_catalog_editor_fixture",
    architectureId: "architecture_aws_catalog_editor_fixture",
    revision: {
      revisionId: "revision_aws_catalog_editor_0001",
      revisionNumber: 1,
      createdAt: "2026-07-27T00:00:00.000Z",
      createdBy: "actor_fixture",
      sourceDraftId: "draft_aws_catalog_editor_0001",
    },
    provider: {
      id: awsEditorCatalog.providerId,
      region: effectiveRegion,
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
      source: "template",
      serialization: {
        mediaType: "application/json",
        encoding: "utf-8",
        canonicalization: "cloudmarkup.canonical-json.v1",
      },
    },
    nodes: [
      fixtureNode({
        deploymentKey: "identity",
        id: "node_identity",
        label: "People sign-in",
        position: { x: 80, y: 80 },
        serviceId: "aws.cognito.user-pool",
      }),
      fixtureNode({
        deploymentKey: "api_handler",
        id: "node_api_handler",
        label: "Notes API handler",
        position: { x: 400, y: 176 },
        serviceId: "aws.lambda.function",
      }),
      fixtureNode({
        deploymentKey: "notes_table",
        id: "node_notes_table",
        label: "Notes data",
        position: { x: 736, y: 368 },
        serviceId: "aws.dynamodb.table",
      }),
      {
        id: "node_imported_unknown",
        semantic: {
          deploymentKey: "imported_unknown",
          serviceType: "aws.cloudmarkup.imported-resource",
          resourceType: "aws.cloudmarkup.imported-resource",
          configuration: {
            schemaId: "aws.cloudmarkup.imported-resource",
            schemaVersion: "1.0.0",
            values: {
              sourceDigest: {
                kind: "string",
                value: UNKNOWN_CONFIGURATION_DIGEST,
              },
            },
          },
          lifecycle: {
            ownership: "user",
            origin: "template",
          },
        },
        presentation: {
          label: "Imported resource",
          position: { x: 1_024, y: 144 },
        },
      },
    ],
    edges: [],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
    workloadBehavior: {
      contractVersion: 1,
      workloads: [
        {
          id: "workload_notes_api_handler",
          owningNodeId: "node_api_handler",
          implementation: {
            mode: "user-provided",
            runtimeFamily: "aws.lambda.runtime-family.nodejs24",
            handler: "index.handler",
            sourceOwnership: "user",
          },
          operations: [
            {
              id: "operation_handle_request",
              capability: "cloudmarkup.workload.handle-request",
              inputContract: { kind: "none" },
              outputContract: { kind: "none" },
            },
          ],
          triggers: [],
          downstreamActions: [],
          environment: [],
          errorBehavior: { mode: "fail-invocation" },
          executionAssumptions: {
            timeout: { kind: "duration", milliseconds: 10_000 },
            retry: { kind: "unresolved" },
          },
          triggerDispatch: { mode: "single" },
          unresolvedRequirementIds: [],
        },
      ],
    },
  };
}

function requireFixtureRelationship(descriptorId: string) {
  const relationship = (awsEditorCatalog.relationships ?? []).find(
    (candidate) => candidate.descriptorId === descriptorId,
  );
  if (relationship?.configuration.defaults.kind !== "ready") {
    throw new TypeError(
      "The deterministic editor fixture requires a defaultable relationship.",
    );
  }
  return relationship;
}

function fixtureRelationshipEdge({
  descriptorId,
  id,
  sourceNodeId,
  targetNodeId,
}: {
  readonly descriptorId: string;
  readonly id: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
}) {
  const relationship = requireFixtureRelationship(descriptorId);
  if (relationship.configuration.defaults.kind !== "ready") {
    throw new TypeError("Expected validated relationship defaults.");
  }
  return {
    id,
    semantic: {
      source: {
        nodeId: sourceNodeId,
        port: relationship.sourcePortId,
      },
      target: {
        nodeId: targetNodeId,
        port: relationship.targetPortId,
      },
      relationshipType: relationship.id,
      configuration: {
        schemaId: relationship.configuration.schemaId,
        schemaVersion: relationship.configuration.schemaVersion,
        values: structuredClone(relationship.configuration.defaults.values),
      },
      lifecycle: {
        ownership: "user",
        origin: "template",
      },
    },
  };
}

function createManualNotesApiArchitectureInput(region?: string) {
  const base = createAwsEditorArchitectureInput(region);
  const userPool = fixtureNode({
    deploymentKey: "notes_users",
    id: "node_cognito_user_pool",
    label: "Notes users",
    position: { x: 80, y: 80 },
    serviceId: "aws.cognito.user-pool",
  });
  const appClient = fixtureNode({
    deploymentKey: "notes_web_client",
    id: "node_cognito_user_pool_client",
    label: "Notes web client",
    position: { x: 368, y: 80 },
    serviceId: "aws.cognito.user-pool-client",
  });

  return {
    ...base,
    documentId: "doc_manual_notes_api_fixture",
    architectureId: "architecture_manual_notes_api_fixture",
    revision: {
      ...base.revision,
      revisionId: "revision_manual_notes_api_0001",
      sourceDraftId: "draft_manual_notes_api_0001",
    },
    nodes: [
      userPool,
      {
        ...appClient,
        semantic: {
          ...appClient.semantic,
          parent: {
            nodeId: userPool.id,
            relationshipType: "aws.cognito.contains-app-client",
          },
        },
      },
    ],
    edges: [
      fixtureRelationshipEdge({
        descriptorId: "aws.cognito.user-pool-configures-app-client",
        id: "edge_cognito_user_pool_contains_client",
        sourceNodeId: userPool.id,
        targetNodeId: appClient.id,
      }),
    ],
    workloadBehavior: {
      contractVersion: 1,
      workloads: [],
    },
  };
}

function createBlankAwsEditorArchitectureInput(region?: string) {
  const base = createAwsEditorArchitectureInput(region);

  return {
    ...base,
    documentId: "doc_blank_aws_editor_fixture",
    architectureId: "architecture_blank_aws_editor_fixture",
    revision: {
      ...base.revision,
      revisionId: "revision_blank_aws_editor_0001",
      sourceDraftId: "draft_blank_aws_editor_0001",
    },
    metadata: {
      ...base.metadata,
      source: "user" as const,
    },
    nodes: [],
    edges: [],
    workloadBehavior: {
      contractVersion: 1,
      workloads: [],
    },
  };
}

function createDynamoDbEncryptionFixArchitectureInput() {
  const base = createAwsEditorArchitectureInput();
  const table = fixtureNode({
    deploymentKey: "notes_table",
    id: "node_dynamodb_table",
    label: "Notes data",
    position: { x: 160, y: 144 },
    serviceId: "aws.dynamodb.table",
  });
  const values = Object.fromEntries(
    Object.entries(table.semantic.configuration.values).filter(
      ([property]) => property !== "serverSideEncryptionEnabled",
    ),
  );

  return {
    ...base,
    documentId: "doc_dynamodb_encryption_fix_fixture",
    architectureId: "architecture_dynamodb_encryption_fix_fixture",
    revision: {
      ...base.revision,
      revisionId: "revision_dynamodb_encryption_fix_0001",
      sourceDraftId: "draft_dynamodb_encryption_fix_0001",
    },
    nodes: [
      {
        ...table,
        semantic: {
          ...table.semantic,
          configuration: {
            ...table.semantic.configuration,
            values,
          },
        },
      },
    ],
    edges: [],
    workloadBehavior: {
      contractVersion: 1,
      workloads: [],
    },
  };
}

const visualUserLifecycle = Object.freeze({
  ownership: "user" as const,
  origin: "template" as const,
});

const visualGeneratedLifecycle = Object.freeze({
  ownership: "generated" as const,
  origin: "connection-rule" as const,
  provenance: {
    generatorKind: "connection-rule" as const,
    generatorId: "aws.iam.visual-fixture",
    generatorVersion: "1.0.0",
    operationId: "operation_fixture_policy",
    dependentNodeIds: ["node_api_handler", "node_notes_table"],
    dependentEdgeIds: [],
  },
});

type VisualLifecycle =
  typeof visualUserLifecycle | typeof visualGeneratedLifecycle;

function visualOwnedNode({
  configuration,
  deploymentKey,
  descriptor,
  id,
  label,
  lifecycle,
  parentNodeId,
  parentRelationshipType,
}: {
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly deploymentKey: string;
  readonly descriptor: ExactPolicyNodeKindDescriptor;
  readonly id: string;
  readonly label: string;
  readonly lifecycle: VisualLifecycle;
  readonly parentNodeId: string;
  readonly parentRelationshipType: string;
}) {
  return {
    id,
    semantic: {
      deploymentKey,
      serviceType: descriptor.serviceType,
      resourceType: descriptor.resourceType,
      configuration: {
        schemaId: descriptor.configurationSchemaId,
        schemaVersion: descriptor.configurationSchemaVersion,
        values: configuration,
      },
      parent: {
        nodeId: parentNodeId,
        relationshipType: parentRelationshipType,
      },
      lifecycle,
    },
    presentation: {
      label,
      position: { x: 520, y: 520 },
    },
  };
}

function visualChildBindingEdge({
  childNodeId,
  descriptor,
  id,
  lifecycle,
  parentNodeId,
}: {
  readonly childNodeId: string;
  readonly descriptor: ExactPolicyChildRelationshipDescriptor;
  readonly id: string;
  readonly lifecycle: VisualLifecycle;
  readonly parentNodeId: string;
}) {
  const child = { nodeId: childNodeId, port: descriptor.childPort };
  const parent = { nodeId: parentNodeId, port: descriptor.parentPort };
  return {
    id,
    semantic: {
      source: descriptor.childEndpoint === "source" ? child : parent,
      target: descriptor.childEndpoint === "source" ? parent : child,
      relationshipType: descriptor.relationshipType,
      configuration: structuredClone(descriptor.edgeConfiguration),
      lifecycle,
    },
  };
}

function visualOwnedBindingEdge({
  configurationNodeId,
  id,
  lifecycle,
  ownerNodeId,
  slotId,
}: {
  readonly configurationNodeId: string;
  readonly id: string;
  readonly lifecycle: VisualLifecycle;
  readonly ownerNodeId: string;
  readonly slotId: string;
}) {
  const slot = awsOwnedPolicyGraphDescriptors.ownedConfigurations.slots.find(
    (candidate) => candidate.id === slotId,
  );
  const binding = awsOwnedPolicyGraphDescriptors.slotBindings.find(
    (candidate) => candidate.slotId === slotId,
  );
  if (slot === undefined || binding === undefined) {
    throw new TypeError(`The visual policy fixture slot ${slotId} is invalid.`);
  }
  const configuration = {
    nodeId: configurationNodeId,
    port: slot.configurationPort,
  };
  const owner = { nodeId: ownerNodeId, port: slot.ownerPort };
  return {
    id,
    semantic: {
      source: slot.configurationEndpoint === "source" ? configuration : owner,
      target: slot.configurationEndpoint === "source" ? owner : configuration,
      relationshipType: slot.relationshipType,
      configuration: structuredClone(binding.edgeConfiguration),
      lifecycle,
    },
  };
}

function visualPolicySubtree({
  actions,
  lifecycle,
  name,
  policyKind,
  prefix,
  principalKind,
  principals,
  resourceNodeId,
  slotId,
}: {
  readonly actions: readonly string[];
  readonly lifecycle: VisualLifecycle;
  readonly name: string;
  readonly policyKind: string;
  readonly prefix: string;
  readonly principalKind: string;
  readonly principals: readonly string[];
  readonly resourceNodeId?: string;
  readonly slotId: string;
}) {
  const descriptors = awsOwnedPolicyGraphDescriptors;
  const slot = descriptors.ownedConfigurations.slots.find(
    (candidate) => candidate.id === slotId,
  );
  const policyKindDescriptor = descriptors.ownedConfigurations.kinds.find(
    (candidate) => candidate.id === slot?.configurationKindIds[0],
  );
  if (slot === undefined || policyKindDescriptor === undefined) {
    throw new TypeError(`The visual policy fixture kind ${slotId} is invalid.`);
  }
  const policyDescriptor: ExactPolicyNodeKindDescriptor = {
    id: policyKindDescriptor.id,
    serviceType: policyKindDescriptor.nodeServiceType,
    resourceType: policyKindDescriptor.nodeResourceType,
    configurationSchemaId: policyKindDescriptor.configurationSchemaId,
    configurationSchemaVersion: policyKindDescriptor.configurationSchemaVersion,
  };
  const policyNodeId = `node_${prefix}_policy`;
  const statementNodeId = `node_${prefix}_statement`;
  const nodes = [
    visualOwnedNode({
      configuration: {
        policyName: { kind: "string", value: name },
        policyKind: { kind: "string", value: policyKind },
      },
      deploymentKey: `${prefix}_policy`,
      descriptor: policyDescriptor,
      id: policyNodeId,
      label: name,
      lifecycle,
      parentNodeId: "node_iam_role_policy_fixture",
      parentRelationshipType: slot.relationshipType,
    }),
    visualOwnedNode({
      configuration: {
        statementId: { kind: "string", value: `${prefix}Statement` },
        effect: { kind: "string", value: "allow" },
        actions: { kind: "string-list", value: actions },
        principalKind: { kind: "string", value: principalKind },
        principals: { kind: "string-list", value: principals },
        resourceExpressions: { kind: "string-list", value: [] },
      },
      deploymentKey: `${prefix}_statement`,
      descriptor: descriptors.statementKind,
      id: statementNodeId,
      label: `${name} statement`,
      lifecycle,
      parentNodeId: policyNodeId,
      parentRelationshipType: descriptors.statementMembership.relationshipType,
    }),
  ];
  const edges = [
    visualOwnedBindingEdge({
      configurationNodeId: policyNodeId,
      id: `edge_${prefix}_owner`,
      lifecycle,
      ownerNodeId: "node_iam_role_policy_fixture",
      slotId,
    }),
    visualChildBindingEdge({
      childNodeId: statementNodeId,
      descriptor: descriptors.statementMembership,
      id: `edge_${prefix}_statement`,
      lifecycle,
      parentNodeId: policyNodeId,
    }),
  ];
  if (resourceNodeId !== undefined) {
    const resource = createAwsEditorArchitectureInput().nodes.find(
      (node) => node.id === resourceNodeId,
    );
    const scope = descriptors.resourceScopes.find(
      (candidate) =>
        candidate.resourceServiceType === resource?.semantic.serviceType &&
        candidate.resourceResourceType === resource.semantic.resourceType,
    );
    if (scope === undefined) {
      throw new TypeError("The visual policy resource scope is invalid.");
    }
    const statement = { nodeId: statementNodeId, port: scope.statementPort };
    const target = { nodeId: resourceNodeId, port: scope.resourcePort };
    edges.push({
      id: `edge_${prefix}_resource`,
      semantic: {
        source: scope.statementEndpoint === "source" ? statement : target,
        target: scope.statementEndpoint === "source" ? target : statement,
        relationshipType: scope.relationshipType,
        configuration: structuredClone(scope.edgeConfiguration),
        lifecycle,
      },
    });
  }
  return { edges, nodes };
}

function visualManagedAttachment({
  attachmentKind,
  name,
  prefix,
  slotId,
}: {
  readonly attachmentKind: "managed-policy-attachment" | "permissions-boundary";
  readonly name: string;
  readonly prefix: string;
  readonly slotId: string;
}) {
  const descriptors = awsOwnedPolicyGraphDescriptors;
  const slot = descriptors.ownedConfigurations.slots.find(
    (candidate) => candidate.id === slotId,
  );
  const kind = descriptors.ownedConfigurations.kinds.find(
    (candidate) => candidate.id === slot?.configurationKindIds[0],
  );
  if (slot === undefined || kind === undefined) {
    throw new TypeError(`The visual attachment fixture ${slotId} is invalid.`);
  }
  const descriptor: ExactPolicyNodeKindDescriptor = {
    id: kind.id,
    serviceType: kind.nodeServiceType,
    resourceType: kind.nodeResourceType,
    configurationSchemaId: kind.configurationSchemaId,
    configurationSchemaVersion: kind.configurationSchemaVersion,
  };
  const nodeId = `node_${prefix}`;
  return {
    node: visualOwnedNode({
      configuration: {
        displayName: { kind: "string", value: name },
        attachmentKind: { kind: "string", value: attachmentKind },
        managedPolicyReference: {
          kind: "string",
          value: "aws-managed:ReadOnlyAccess",
        },
      },
      deploymentKey: prefix,
      descriptor,
      id: nodeId,
      label: name,
      lifecycle: visualUserLifecycle,
      parentNodeId: "node_iam_role_policy_fixture",
      parentRelationshipType: slot.relationshipType,
    }),
    edge: visualOwnedBindingEdge({
      configurationNodeId: nodeId,
      id: `edge_${prefix}_owner`,
      lifecycle: visualUserLifecycle,
      ownerNodeId: "node_iam_role_policy_fixture",
      slotId,
    }),
  };
}

function createOwnedConfigurationVisualArchitectureInput() {
  const base = createAwsEditorArchitectureInput();
  const role = fixtureNode({
    deploymentKey: "policy_fixture_role",
    id: "node_iam_role_policy_fixture",
    label: "Policy showcase role",
    position: { x: 240, y: 520 },
    serviceId: "aws.iam.role",
  });
  const trust = visualPolicySubtree({
    actions: ["sts:AssumeRole"],
    lifecycle: visualUserLifecycle,
    name: "LambdaTrust",
    policyKind: "trust",
    prefix: "trust",
    principalKind: "service",
    principals: ["lambda.amazonaws.com"],
    slotId: "aws.iam.role.slot.trust-policy",
  });
  const custom = visualPolicySubtree({
    actions: ["dynamodb:*"],
    lifecycle: visualUserLifecycle,
    name: "NotesTableAccess",
    policyKind: "identity-inline",
    prefix: "custom",
    principalKind: "none",
    principals: [],
    resourceNodeId: "node_notes_table",
    slotId: "aws.iam.role.slot.custom-inline-policy",
  });
  const generated = visualPolicySubtree({
    actions: ["dynamodb:GetItem"],
    lifecycle: visualGeneratedLifecycle,
    name: "GeneratedNotesRead",
    policyKind: "generated-permission",
    prefix: "generated",
    principalKind: "none",
    principals: [],
    resourceNodeId: "node_notes_table",
    slotId: "aws.iam.role.slot.generated-permission",
  });
  const managed = visualManagedAttachment({
    attachmentKind: "managed-policy-attachment",
    name: "AWS read-only access",
    prefix: "managed_attachment",
    slotId: "aws.iam.role.slot.managed-policy",
  });
  const boundary = visualManagedAttachment({
    attachmentKind: "permissions-boundary",
    name: "Role permissions ceiling",
    prefix: "permissions_boundary",
    slotId: "aws.iam.role.slot.permissions-boundary",
  });
  return {
    ...base,
    documentId: "doc_owned_configuration_visual_fixture",
    architectureId: "architecture_owned_configuration_visual_fixture",
    revision: {
      ...base.revision,
      revisionId: "revision_owned_configuration_visual_0001",
      sourceDraftId: "draft_owned_configuration_visual_0001",
    },
    nodes: [
      ...base.nodes,
      role,
      ...trust.nodes,
      ...custom.nodes,
      ...generated.nodes,
      managed.node,
      boundary.node,
    ],
    edges: [
      ...trust.edges,
      ...custom.edges,
      ...generated.edges,
      managed.edge,
      boundary.edge,
    ],
  };
}

function createStableConnectionDockVisualArchitectureDocument() {
  const base = createAwsEditorArchitectureInput();
  const role = fixtureNode({
    deploymentKey: "notes_api_execution_role",
    id: "node_notes_api_execution_role",
    label: "Notes API execution role",
    position: { x: 400, y: 496 },
    serviceId: "aws.iam.role",
  });
  let document = parseArchitectureDocument({
    ...base,
    documentId: "doc_stable_connection_dock_visual_fixture",
    architectureId: "architecture_stable_connection_dock_visual_fixture",
    revision: {
      ...base.revision,
      revisionId: "revision_stable_connection_dock_visual_0001",
      sourceDraftId: "draft_stable_connection_dock_visual_0001",
    },
    nodes: [...base.nodes, role],
  });

  const roleConnection = awsConnectionResolverV1.resolve({
    configuration: {},
    document,
    operationId: "stable_dock_execution_role",
    ruleId: "aws.iam.role-assumed-by-lambda",
    source: {
      nodeId: role.id,
      portId: "aws.iam.role.assumable-role",
    },
    target: {
      nodeId: "node_api_handler",
      portId: "aws.lambda.function.execution-role",
    },
  });
  if (!roleConnection.success) {
    throw new TypeError(
      "The stable connection dock fixture requires an execution-role connection.",
    );
  }
  document = roleConnection.preview.document;

  const readConnection = awsConnectionResolverV1.resolve({
    configuration: {
      consistentRead: { kind: "boolean", value: false },
    },
    document,
    operationId: "stable_dock_table_read",
    ruleId: "aws.lambda.reads-dynamodb-table",
    source: {
      nodeId: "node_api_handler",
      portId: "aws.lambda.function.data-read",
    },
    target: {
      nodeId: "node_notes_table",
      portId: "aws.dynamodb.table.table-api",
    },
  });
  if (!readConnection.success) {
    throw new TypeError(
      "The stable connection dock fixture requires a DynamoDB read connection.",
    );
  }
  document = readConnection.preview.document;

  const writeConnection = awsConnectionResolverV1.resolve({
    configuration: {},
    document,
    operationId: "stable_dock_table_write",
    ruleId: "aws.lambda.writes-dynamodb-table",
    source: {
      nodeId: "node_api_handler",
      portId: "aws.lambda.function.data-write",
    },
    target: {
      nodeId: "node_notes_table",
      portId: "aws.dynamodb.table.table-api",
    },
  });
  if (!writeConnection.success) {
    throw new TypeError(
      "The stable connection dock fixture requires a DynamoDB write connection.",
    );
  }
  return writeConnection.preview.document;
}

function resolveAwsNetworkingFixtureConnection(
  document: ArchitectureDocument,
  {
    operationId,
    ruleId,
    sourceNodeId,
    sourcePortId,
    targetNodeId,
    targetPortId,
  }: {
    readonly operationId: string;
    readonly ruleId: string;
    readonly sourceNodeId: string;
    readonly sourcePortId: string;
    readonly targetNodeId: string;
    readonly targetPortId: string;
  },
): ArchitectureDocument {
  const result = awsConnectionResolverV1.resolve({
    configuration: {},
    document,
    operationId,
    ruleId,
    source: {
      nodeId: sourceNodeId,
      portId: sourcePortId,
    },
    target: {
      nodeId: targetNodeId,
      portId: targetPortId,
    },
  });
  if (!result.success) {
    throw new TypeError(
      `The AWS networking fixture requires resolver rule ${ruleId}: ${JSON.stringify(result.findings)}.`,
    );
  }
  return result.preview.document;
}

function createAwsNetworkingVisualArchitectureDocument() {
  const base = createBlankAwsEditorArchitectureInput();
  const region = fixtureNode({
    deploymentKey: "network_region",
    id: "node_network_region",
    label: "US East (N. Virginia)",
    position: { x: 48, y: 40 },
    serviceId: "aws.region.boundary",
    values: {
      regionName: { kind: "string", value: "us-east-1" },
    },
  });
  const vpc = fixtureNode({
    deploymentKey: "application_vpc",
    id: "node_network_vpc",
    label: "Application VPC · 10.0.0.0/16",
    parent: {
      nodeId: region.id,
      relationshipType: "aws.region.contains-vpc",
    },
    position: { x: 40, y: 160 },
    serviceId: "aws.ec2.vpc",
  });
  const availabilityZoneA = fixtureNode({
    deploymentKey: "availability_zone_a",
    id: "node_availability_zone_a",
    label: "Availability Zone · us-east-1a",
    parent: {
      nodeId: vpc.id,
      relationshipType: "aws.ec2.vpc-contains-availability-zone",
    },
    position: { x: 32, y: 160 },
    serviceId: "aws.ec2.availability-zone",
    values: {
      zoneName: { kind: "string", value: "us-east-1a" },
    },
  });
  const availabilityZoneB = fixtureNode({
    deploymentKey: "availability_zone_b",
    id: "node_availability_zone_b",
    label: "Availability Zone · us-east-1b",
    parent: {
      nodeId: vpc.id,
      relationshipType: "aws.ec2.vpc-contains-availability-zone",
    },
    position: { x: 560, y: 160 },
    serviceId: "aws.ec2.availability-zone",
    values: {
      zoneName: { kind: "string", value: "us-east-1b" },
    },
  });
  const publicSubnetA = fixtureNode({
    deploymentKey: "public_subnet_a",
    id: "node_public_subnet_a",
    label: "Public subnet A · 10.0.1.0/24",
    parent: {
      nodeId: availabilityZoneA.id,
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
    },
    position: { x: 32, y: 160 },
    serviceId: "aws.ec2.subnet",
    values: {
      accessTier: { kind: "string", value: "public" },
      cidrBlock: { kind: "string", value: "10.0.1.0/24" },
      mapPublicIpOnLaunch: { kind: "boolean", value: true },
    },
  });
  const privateSubnetA = fixtureNode({
    deploymentKey: "private_subnet_a",
    id: "node_private_subnet_a",
    label: "Private subnet A · 10.0.11.0/24",
    parent: {
      nodeId: availabilityZoneA.id,
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
    },
    position: { x: 32, y: 448 },
    serviceId: "aws.ec2.subnet",
    values: {
      accessTier: { kind: "string", value: "private" },
      cidrBlock: { kind: "string", value: "10.0.11.0/24" },
      mapPublicIpOnLaunch: { kind: "boolean", value: false },
    },
  });
  const publicSubnetB = fixtureNode({
    deploymentKey: "public_subnet_b",
    id: "node_public_subnet_b",
    label: "Public subnet B · 10.0.2.0/24",
    parent: {
      nodeId: availabilityZoneB.id,
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
    },
    position: { x: 32, y: 160 },
    serviceId: "aws.ec2.subnet",
    values: {
      accessTier: { kind: "string", value: "public" },
      cidrBlock: { kind: "string", value: "10.0.2.0/24" },
      mapPublicIpOnLaunch: { kind: "boolean", value: true },
    },
  });
  const privateSubnetB = fixtureNode({
    deploymentKey: "private_subnet_b",
    id: "node_private_subnet_b",
    label: "Private subnet B · 10.0.12.0/24",
    parent: {
      nodeId: availabilityZoneB.id,
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
    },
    position: { x: 32, y: 448 },
    serviceId: "aws.ec2.subnet",
    values: {
      accessTier: { kind: "string", value: "private" },
      cidrBlock: { kind: "string", value: "10.0.12.0/24" },
      mapPublicIpOnLaunch: { kind: "boolean", value: false },
    },
  });
  // VPC-level resources sit below both Availability Zone frames; they are not
  // subnet children and must not cover subnet headers or connection controls.
  const vpcInfrastructureRowY = 944;
  const publicRouteTable = fixtureNode({
    deploymentKey: "public_route_table",
    id: "node_public_route_table",
    label: "Public routes",
    parent: {
      nodeId: vpc.id,
      relationshipType: "aws.ec2.vpc-contains-route-table",
    },
    position: { x: 96, y: vpcInfrastructureRowY },
    serviceId: "aws.ec2.route-table",
    values: {
      name: { kind: "string", value: "public-routes" },
    },
  });
  const privateRouteTable = fixtureNode({
    deploymentKey: "private_route_table",
    id: "node_private_route_table",
    label: "Private routes",
    parent: {
      nodeId: vpc.id,
      relationshipType: "aws.ec2.vpc-contains-route-table",
    },
    position: { x: 432, y: vpcInfrastructureRowY },
    serviceId: "aws.ec2.route-table",
    values: {
      name: { kind: "string", value: "private-routes" },
    },
  });
  const publicDefaultRoute = fixtureNode({
    deploymentKey: "public_default_route",
    id: "node_public_default_route",
    label: "0.0.0.0/0 → internet gateway",
    parent: {
      nodeId: publicRouteTable.id,
      relationshipType: "aws.ec2.route-table-owns-route",
    },
    position: { x: 0, y: 0 },
    serviceId: "aws.ec2.route",
  });
  const privateDefaultRoute = fixtureNode({
    deploymentKey: "private_default_route",
    id: "node_private_default_route",
    label: "0.0.0.0/0 → NAT gateway",
    parent: {
      nodeId: privateRouteTable.id,
      relationshipType: "aws.ec2.route-table-owns-route",
    },
    position: { x: 0, y: 0 },
    serviceId: "aws.ec2.route",
  });
  const publicAssociationA = fixtureNode({
    deploymentKey: "public_route_association_a",
    id: "node_public_route_association_a",
    label: "Public subnet A association",
    parent: {
      nodeId: publicRouteTable.id,
      relationshipType: "aws.ec2.route-table-owns-subnet-association",
    },
    position: { x: 0, y: 0 },
    serviceId: "aws.ec2.route-table-association",
  });
  const publicAssociationB = fixtureNode({
    deploymentKey: "public_route_association_b",
    id: "node_public_route_association_b",
    label: "Public subnet B association",
    parent: {
      nodeId: publicRouteTable.id,
      relationshipType: "aws.ec2.route-table-owns-subnet-association",
    },
    position: { x: 0, y: 0 },
    serviceId: "aws.ec2.route-table-association",
  });
  const privateAssociationA = fixtureNode({
    deploymentKey: "private_route_association_a",
    id: "node_private_route_association_a",
    label: "Private subnet A association",
    parent: {
      nodeId: privateRouteTable.id,
      relationshipType: "aws.ec2.route-table-owns-subnet-association",
    },
    position: { x: 0, y: 0 },
    serviceId: "aws.ec2.route-table-association",
  });
  const privateAssociationB = fixtureNode({
    deploymentKey: "private_route_association_b",
    id: "node_private_route_association_b",
    label: "Private subnet B association",
    parent: {
      nodeId: privateRouteTable.id,
      relationshipType: "aws.ec2.route-table-owns-subnet-association",
    },
    position: { x: 0, y: 0 },
    serviceId: "aws.ec2.route-table-association",
  });
  const internetGateway = fixtureNode({
    deploymentKey: "internet_gateway",
    id: "node_internet_gateway",
    label: "Internet gateway",
    position: { x: 1440, y: 48 },
    serviceId: "aws.ec2.internet-gateway",
  });
  const natGateway = fixtureNode({
    deploymentKey: "nat_gateway_a",
    id: "node_nat_gateway_a",
    label: "NAT gateway · AZ A",
    parent: {
      nodeId: publicSubnetA.id,
      relationshipType: "aws.ec2.subnet-contains-nat-gateway",
    },
    position: { x: 32, y: 160 },
    serviceId: "aws.ec2.nat-gateway",
    values: {
      allocationId: {
        kind: "string",
        value: "eipalloc-0123456789abcdef0",
      },
    },
  });
  const gatewayEndpoint = fixtureNode({
    deploymentKey: "s3_gateway_endpoint",
    id: "node_s3_gateway_endpoint",
    label: "S3 gateway endpoint",
    parent: {
      nodeId: vpc.id,
      relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
    },
    position: { x: 768, y: vpcInfrastructureRowY },
    serviceId: "aws.ec2.gateway-vpc-endpoint",
    values: {
      policyMode: { kind: "string", value: "full-access" },
    },
  });
  const securityGroup = fixtureNode({
    deploymentKey: "application_security_group",
    id: "node_application_security_group",
    label: "Application security group",
    position: { x: 1440, y: 272 },
    serviceId: "aws.ec2.security-group",
    values: {
      description: {
        kind: "string",
        value: "TLS access for the private Lambda function",
      },
      groupName: { kind: "string", value: "private-lambda" },
    },
  });
  const ingressRule = fixtureNode({
    deploymentKey: "application_ingress_rule",
    id: "node_application_ingress_rule",
    label: "HTTPS from the VPC",
    parent: {
      nodeId: securityGroup.id,
      relationshipType: "aws.ec2.security-group-owns-ingress-rule",
    },
    position: { x: 0, y: 0 },
    serviceId: "aws.ec2.security-group-ingress-rule",
    values: {
      sourceIpv4Cidr: { kind: "string", value: "10.0.0.0/16" },
    },
  });
  const egressRule = fixtureNode({
    deploymentKey: "application_egress_rule",
    id: "node_application_egress_rule",
    label: "HTTPS egress",
    parent: {
      nodeId: securityGroup.id,
      relationshipType: "aws.ec2.security-group-owns-egress-rule",
    },
    position: { x: 0, y: 0 },
    serviceId: "aws.ec2.security-group-egress-rule",
    values: {
      destinationIpv4Cidr: { kind: "string", value: "0.0.0.0/0" },
    },
  });
  const lambdaFunction = fixtureNode({
    deploymentKey: "private_lambda",
    id: "node_networked_lambda",
    label: "Private application function",
    position: { x: 1440, y: 496 },
    serviceId: "aws.lambda.function",
    values: {
      functionName: { kind: "string", value: "private-application" },
    },
  });
  const lambdaVpcAccess = fixtureNode({
    deploymentKey: "private_lambda_vpc_access",
    id: "node_lambda_vpc_access",
    label: "VPC access · 2 subnets · 1 security group",
    parent: {
      nodeId: lambdaFunction.id,
      relationshipType: "aws.lambda.owns-vpc-access-configuration",
    },
    position: { x: 0, y: 0 },
    serviceId: "aws.lambda.vpc-access-configuration",
  });
  const dynamoDbTable = fixtureNode({
    deploymentKey: "application_data",
    id: "node_application_table",
    label: "DynamoDB · application data",
    position: { x: 1440, y: 720 },
    serviceId: "aws.dynamodb.table",
    values: {
      tableName: { kind: "string", value: "application-data" },
    },
  });

  let document = parseArchitectureDocument({
    ...base,
    documentId: "doc_aws_networking_visual_fixture",
    architectureId: "architecture_aws_networking_visual_fixture",
    revision: {
      ...base.revision,
      revisionId: "revision_aws_networking_visual_0001",
      sourceDraftId: "draft_aws_networking_visual_0001",
    },
    nodes: [
      region,
      vpc,
      availabilityZoneA,
      availabilityZoneB,
      publicSubnetA,
      privateSubnetA,
      publicSubnetB,
      privateSubnetB,
      publicRouteTable,
      privateRouteTable,
      publicDefaultRoute,
      privateDefaultRoute,
      publicAssociationA,
      publicAssociationB,
      privateAssociationA,
      privateAssociationB,
      internetGateway,
      natGateway,
      gatewayEndpoint,
      securityGroup,
      ingressRule,
      egressRule,
      lambdaFunction,
      lambdaVpcAccess,
      dynamoDbTable,
    ],
    edges: [
      fixtureRelationshipEdge({
        descriptorId: "aws.ec2.route-table-owns-route",
        id: "edge_public_route_owner",
        sourceNodeId: publicDefaultRoute.id,
        targetNodeId: publicRouteTable.id,
      }),
      fixtureRelationshipEdge({
        descriptorId: "aws.ec2.route-table-owns-route",
        id: "edge_private_route_owner",
        sourceNodeId: privateDefaultRoute.id,
        targetNodeId: privateRouteTable.id,
      }),
      ...(
        [
          [publicAssociationA.id, publicRouteTable.id],
          [publicAssociationB.id, publicRouteTable.id],
          [privateAssociationA.id, privateRouteTable.id],
          [privateAssociationB.id, privateRouteTable.id],
        ] as const
      ).map(([associationId, routeTableId]) =>
        fixtureRelationshipEdge({
          descriptorId: "aws.ec2.route-table-owns-subnet-association",
          id: `edge_${associationId}_owner`,
          sourceNodeId: associationId,
          targetNodeId: routeTableId,
        }),
      ),
      fixtureRelationshipEdge({
        descriptorId: "aws.ec2.security-group-owns-ingress-rule",
        id: "edge_application_ingress_rule_owner",
        sourceNodeId: ingressRule.id,
        targetNodeId: securityGroup.id,
      }),
      fixtureRelationshipEdge({
        descriptorId: "aws.ec2.security-group-owns-egress-rule",
        id: "edge_application_egress_rule_owner",
        sourceNodeId: egressRule.id,
        targetNodeId: securityGroup.id,
      }),
      fixtureRelationshipEdge({
        descriptorId: "aws.lambda.owns-vpc-access-configuration",
        id: "edge_lambda_vpc_access_owner",
        sourceNodeId: lambdaVpcAccess.id,
        targetNodeId: lambdaFunction.id,
      }),
    ],
  });

  const connections = [
    {
      operationId: "net_pub_a_route_assoc",
      ruleId: "aws.ec2.route-table-association-targets-subnet",
      sourceNodeId: publicAssociationA.id,
      sourcePortId: "aws.ec2.route-table-association.subnet",
      targetNodeId: publicSubnetA.id,
      targetPortId: "aws.ec2.subnet.route-table-association",
    },
    {
      operationId: "net_pub_b_route_assoc",
      ruleId: "aws.ec2.route-table-association-targets-subnet",
      sourceNodeId: publicAssociationB.id,
      sourcePortId: "aws.ec2.route-table-association.subnet",
      targetNodeId: publicSubnetB.id,
      targetPortId: "aws.ec2.subnet.route-table-association",
    },
    {
      operationId: "net_priv_a_route_assoc",
      ruleId: "aws.ec2.route-table-association-targets-subnet",
      sourceNodeId: privateAssociationA.id,
      sourcePortId: "aws.ec2.route-table-association.subnet",
      targetNodeId: privateSubnetA.id,
      targetPortId: "aws.ec2.subnet.route-table-association",
    },
    {
      operationId: "net_priv_b_route_assoc",
      ruleId: "aws.ec2.route-table-association-targets-subnet",
      sourceNodeId: privateAssociationB.id,
      sourcePortId: "aws.ec2.route-table-association.subnet",
      targetNodeId: privateSubnetB.id,
      targetPortId: "aws.ec2.subnet.route-table-association",
    },
    {
      operationId: "net_vpc_igw",
      ruleId: "aws.ec2.vpc-attaches-internet-gateway",
      sourceNodeId: vpc.id,
      sourcePortId: "aws.ec2.vpc.internet-gateway-attachment",
      targetNodeId: internetGateway.id,
      targetPortId: "aws.ec2.internet-gateway.vpc-attachment",
    },
    {
      operationId: "net_public_default",
      ruleId: "aws.ec2.route-targets-internet-gateway",
      sourceNodeId: publicDefaultRoute.id,
      sourcePortId: "aws.ec2.route.internet-gateway-target",
      targetNodeId: internetGateway.id,
      targetPortId: "aws.ec2.internet-gateway.route-target",
    },
    {
      operationId: "net_private_default",
      ruleId: "aws.ec2.route-targets-nat-gateway",
      sourceNodeId: privateDefaultRoute.id,
      sourcePortId: "aws.ec2.route.nat-gateway-target",
      targetNodeId: natGateway.id,
      targetPortId: "aws.ec2.nat-gateway.route-target",
    },
    {
      operationId: "net_s3_endpoint_routes",
      ruleId: "aws.ec2.gateway-endpoint-associates-route-table",
      sourceNodeId: gatewayEndpoint.id,
      sourcePortId: "aws.ec2.gateway-vpc-endpoint.route-table-association",
      targetNodeId: privateRouteTable.id,
      targetPortId: "aws.ec2.route-table.gateway-endpoint-association",
    },
    {
      operationId: "net_vpc_security_group",
      ruleId: "aws.ec2.vpc-associates-security-group",
      sourceNodeId: vpc.id,
      sourcePortId: "aws.ec2.vpc.security-group-association",
      targetNodeId: securityGroup.id,
      targetPortId: "aws.ec2.security-group.vpc",
    },
    {
      operationId: "net_lambda_subnet_a",
      ruleId: "aws.lambda.vpc-access-uses-subnet",
      sourceNodeId: lambdaVpcAccess.id,
      sourcePortId: "aws.lambda.vpc-access-configuration.subnet",
      targetNodeId: privateSubnetA.id,
      targetPortId: "aws.ec2.subnet.lambda-vpc-access",
    },
    {
      operationId: "net_lambda_subnet_b",
      ruleId: "aws.lambda.vpc-access-uses-subnet",
      sourceNodeId: lambdaVpcAccess.id,
      sourcePortId: "aws.lambda.vpc-access-configuration.subnet",
      targetNodeId: privateSubnetB.id,
      targetPortId: "aws.ec2.subnet.lambda-vpc-access",
    },
    {
      operationId: "net_lambda_security_group",
      ruleId: "aws.lambda.vpc-access-uses-security-group",
      sourceNodeId: lambdaVpcAccess.id,
      sourcePortId: "aws.lambda.vpc-access-configuration.security-group",
      targetNodeId: securityGroup.id,
      targetPortId: "aws.ec2.security-group.lambda-vpc-access",
    },
  ] as const;

  for (const connection of connections) {
    document = resolveAwsNetworkingFixtureConnection(document, connection);
  }
  return document;
}

export const awsEditorArchitectureInput = createAwsEditorArchitectureInput();

export function loadAwsEditorArchitectureDocument() {
  return parseArchitectureDocument(
    structuredClone(createAwsEditorArchitectureInput()),
  );
}

export function loadBlankAwsEditorArchitectureDocument(region?: string) {
  return parseArchitectureDocument(
    structuredClone(createBlankAwsEditorArchitectureInput(region)),
  );
}

export function loadManualNotesApiArchitectureDocument(region?: string) {
  return parseArchitectureDocument(
    structuredClone(createManualNotesApiArchitectureInput(region)),
  );
}

export function loadDynamoDbEncryptionFixArchitectureDocument() {
  return parseArchitectureDocument(
    structuredClone(createDynamoDbEncryptionFixArchitectureInput()),
  );
}

export function loadOwnedConfigurationVisualArchitectureDocument() {
  return parseArchitectureDocument(
    structuredClone(createOwnedConfigurationVisualArchitectureInput()),
  );
}

export function loadStableConnectionDockVisualArchitectureDocument() {
  return createStableConnectionDockVisualArchitectureDocument();
}

export function loadAwsNetworkingVisualArchitectureDocument() {
  return createAwsNetworkingVisualArchitectureDocument();
}
