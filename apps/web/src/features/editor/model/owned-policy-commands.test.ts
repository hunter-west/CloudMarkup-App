import {
  applyGraphCommand,
  getArchitectureDocumentContentHash,
  parseArchitectureDocument,
  type ArchitectureConfiguration,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import type { ElementLifecycle } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsNetworkingVisualArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { awsOwnedPolicyGraphDescriptors } from "../../../provider-catalog/aws-owned-policy-descriptors.js";
import {
  projectOwnedPolicyConfigurations,
  projectOwnedPolicyConfigurationsForEditing,
  type OwnedPolicyGraphDescriptorSet,
} from "./owned-configuration-policy-model.js";
import {
  preparePolicyConditionAdd,
  preparePolicyConditionRemove,
  preparePolicyResourceScopeSet,
  preparePolicyStatementAdd,
  preparePolicyStatementDuplicate,
  preparePolicyStatementEdit,
  preparePolicyStatementRemove,
  prepareUserOwnedConfigurationCreate,
  prepareUserOwnedConfigurationEdit,
  prepareUserOwnedConfigurationRemove,
  prepareUserPolicyCreation,
  prepareUserPolicyRemove,
  type GraphCommandBatchOperationIdentities,
  type OwnedPolicyCommandPreparationResult,
} from "./owned-policy-commands.js";

const ownerNodeId = "node_role";
const resourceNodeId = "node_resource_a";
const secondResourceNodeId = "node_resource_b";
const policyKindId = "example.configuration.policy-document";
const attachmentKindId = "example.configuration.managed-attachment";

function configuration(
  schemaId: string,
  schemaVersion: string,
  values: Record<string, unknown> = {},
): ArchitectureConfiguration {
  return {
    schemaId,
    schemaVersion,
    values,
  } as unknown as ArchitectureConfiguration;
}

const policyConfiguration = (name: string): ArchitectureConfiguration =>
  configuration("example.policy.document-config", "1.0.0", {
    policyName: { kind: "string", value: name },
    policyKind: { kind: "string", value: "identity-inline" },
  });

const statementConfiguration = (
  id: string,
  actions = ["example:Read"],
): ArchitectureConfiguration =>
  configuration("example.policy.statement-config", "2.0.0", {
    statementId: { kind: "string", value: id },
    effect: { kind: "string", value: "allow" },
    actions: { kind: "string-list", value: actions },
  });

const conditionConfiguration = (key: string): ArchitectureConfiguration =>
  configuration("example.policy.condition-config", "1.0.0", {
    operator: { kind: "string", value: "StringEquals" },
    key: { kind: "string", value: key },
    values: { kind: "string-list", value: ["expected"] },
  });

const managedAttachmentConfiguration = (
  name: string,
  attachmentKind: "managed-policy-attachment" | "permissions-boundary",
): ArchitectureConfiguration =>
  configuration("example.policy.managed-attachment-config", "1.0.0", {
    name: { kind: "string", value: name },
    attachmentKind: { kind: "string", value: attachmentKind },
  });

function edgeConfiguration(schemaId: string): ArchitectureConfiguration {
  return configuration(schemaId, "1.0.0");
}

function graphDescriptors(input?: {
  readonly trustMinimum?: number;
  readonly boundaryMaximum?: number;
  readonly statementMinimum?: number;
}): OwnedPolicyGraphDescriptorSet {
  return {
    ownedConfigurations: {
      kinds: [
        {
          id: policyKindId,
          nodeServiceType: "example.configuration",
          nodeResourceType: "example.configuration.policy-document",
          configurationSchemaId: "example.policy.document-config",
          configurationSchemaVersion: "1.0.0",
          allowedOwnership: ["user", "generated", "adopted"],
        },
        {
          id: attachmentKindId,
          nodeServiceType: "example.configuration",
          nodeResourceType: "example.configuration.managed-attachment",
          configurationSchemaId: "example.policy.managed-attachment-config",
          configurationSchemaVersion: "1.0.0",
          allowedOwnership: ["user"],
        },
      ],
      slots: [
        {
          id: "example.slot.custom-policy",
          ownerServiceType: "example.identity",
          ownerResourceType: "example.identity.role",
          relationshipType: "example.relationship.owns-custom-policy",
          configurationEndpoint: "source",
          configurationPort: "example.port.policy-owner",
          ownerPort: "example.port.custom-policy",
          parentBinding: "required",
          configurationKindIds: [policyKindId],
          cardinality: { minimum: 0, maximum: 8 },
        },
        {
          id: "example.slot.trust-policy",
          ownerServiceType: "example.identity",
          ownerResourceType: "example.identity.role",
          relationshipType: "example.relationship.owns-trust-policy",
          configurationEndpoint: "source",
          configurationPort: "example.port.policy-trust",
          ownerPort: "example.port.trust-policy",
          parentBinding: "required",
          configurationKindIds: [policyKindId],
          cardinality: {
            minimum: input?.trustMinimum ?? 0,
            maximum: 1,
          },
        },
        {
          id: "example.slot.managed-policy",
          ownerServiceType: "example.identity",
          ownerResourceType: "example.identity.role",
          relationshipType: "example.relationship.owns-managed-policy",
          configurationEndpoint: "source",
          configurationPort: "example.port.managed-owner",
          ownerPort: "example.port.managed-policy",
          parentBinding: "required",
          configurationKindIds: [attachmentKindId],
          cardinality: { minimum: 0, maximum: 8 },
        },
        {
          id: "example.slot.permissions-boundary",
          ownerServiceType: "example.identity",
          ownerResourceType: "example.identity.role",
          relationshipType: "example.relationship.owns-boundary",
          configurationEndpoint: "source",
          configurationPort: "example.port.boundary-owner",
          ownerPort: "example.port.permissions-boundary",
          parentBinding: "required",
          configurationKindIds: [attachmentKindId],
          cardinality: {
            minimum: 0,
            maximum: input?.boundaryMaximum ?? 1,
          },
        },
      ],
    },
    policyOwnedKindIds: [policyKindId],
    slotBindings: [
      {
        slotId: "example.slot.custom-policy",
        edgeConfiguration: edgeConfiguration(
          "example.relationship.owns-custom-policy-config",
        ),
      },
      {
        slotId: "example.slot.trust-policy",
        edgeConfiguration: edgeConfiguration(
          "example.relationship.owns-trust-policy-config",
        ),
      },
      {
        slotId: "example.slot.managed-policy",
        edgeConfiguration: edgeConfiguration(
          "example.relationship.owns-managed-policy-config",
        ),
      },
      {
        slotId: "example.slot.permissions-boundary",
        edgeConfiguration: edgeConfiguration(
          "example.relationship.owns-boundary-config",
        ),
      },
    ],
    statementKind: {
      id: "example.policy.statement",
      serviceType: "example.configuration",
      resourceType: "example.configuration.policy-statement",
      configurationSchemaId: "example.policy.statement-config",
      configurationSchemaVersion: "2.0.0",
    },
    statementMembership: {
      id: "example.policy.contains-statement",
      relationshipType: "example.relationship.contains-statement",
      childEndpoint: "source",
      childPort: "example.port.statement-policy",
      parentPort: "example.port.policy-statement",
      childParentBinding: "required",
      edgeConfiguration: edgeConfiguration(
        "example.relationship.contains-statement-config",
      ),
      cardinality: {
        minimum: input?.statementMinimum ?? 1,
        maximum: 16,
      },
    },
    conditionKind: {
      id: "example.policy.condition",
      serviceType: "example.configuration",
      resourceType: "example.configuration.policy-condition",
      configurationSchemaId: "example.policy.condition-config",
      configurationSchemaVersion: "1.0.0",
    },
    conditionMembership: {
      id: "example.policy.statement-condition",
      relationshipType: "example.relationship.statement-condition",
      childEndpoint: "source",
      childPort: "example.port.condition-statement",
      parentPort: "example.port.statement-condition",
      childParentBinding: "required",
      edgeConfiguration: edgeConfiguration(
        "example.relationship.statement-condition-config",
      ),
      cardinality: { minimum: 0, maximum: 8 },
    },
    resourceScopes: [
      {
        id: "example.policy.resource-scope",
        relationshipType: "example.relationship.authorizes-resource",
        statementEndpoint: "source",
        statementPort: "example.port.statement-resource",
        resourcePort: "example.port.resource-policy",
        resourceServiceType: "example.data",
        resourceResourceType: "example.data.resource",
        edgeConfiguration: edgeConfiguration(
          "example.relationship.authorizes-resource-config",
        ),
      },
    ],
    resourceScopeCardinality: { minimum: 0, maximum: 2 },
  } as unknown as OwnedPolicyGraphDescriptorSet;
}

function userLifecycle(): ElementLifecycle {
  return { ownership: "user", origin: "user" };
}

function generatedLifecycle(suffix: string): ElementLifecycle {
  return {
    ownership: "generated",
    origin: "connection-rule",
    provenance: {
      generatorKind: "connection-rule",
      generatorId: "example.generator.policy",
      generatorVersion: "1.0.0",
      operationId: `operation_generated_${suffix}`,
      dependentNodeIds: [ownerNodeId],
      dependentEdgeIds: [],
    },
  } as unknown as ElementLifecycle;
}

function baseNodes(): readonly unknown[] {
  return [
    {
      id: ownerNodeId,
      semantic: {
        deploymentKey: "role",
        serviceType: "example.identity",
        resourceType: "example.identity.role",
        configuration: configuration("example.identity.role-config", "1.0.0"),
        lifecycle: userLifecycle(),
      },
      presentation: { label: "Execution role", position: { x: 100, y: 100 } },
    },
    {
      id: resourceNodeId,
      semantic: {
        deploymentKey: "resource_a",
        serviceType: "example.data",
        resourceType: "example.data.resource",
        configuration: configuration("example.data.resource-config", "1.0.0"),
        lifecycle: userLifecycle(),
      },
      presentation: { label: "Resource A", position: { x: 700, y: 100 } },
    },
    {
      id: secondResourceNodeId,
      semantic: {
        deploymentKey: "resource_b",
        serviceType: "example.data",
        resourceType: "example.data.resource",
        configuration: configuration("example.data.resource-config", "1.0.0"),
        lifecycle: userLifecycle(),
      },
      presentation: { label: "Resource B", position: { x: 700, y: 320 } },
    },
  ];
}

function documentWith(
  nodes: readonly unknown[] = [],
  edges: readonly unknown[] = [],
): ArchitectureDocument {
  return parseArchitectureDocument({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 2,
    documentId: "document_owned_policy_editor",
    architectureId: "architecture_owned_policy_editor",
    revision: {
      revisionId: "revision_owned_policy_editor",
      revisionNumber: 1,
      createdAt: "2026-08-02T00:00:00.000Z",
      createdBy: "actor_test",
      sourceDraftId: "draft_owned_policy_editor",
    },
    provider: { id: "example.cloud", region: "example-region-1" },
    catalog: {
      id: "example.cloud.catalog",
      version: "1.0.0",
      digest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
    nodes: [...baseNodes(), ...nodes],
    edges,
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
    workloadBehavior: { contractVersion: 1, workloads: [] },
  });
}

interface PolicySubtree {
  readonly nodes: readonly unknown[];
  readonly edges: readonly unknown[];
}

function policySubtree(input: {
  readonly suffix: string;
  readonly ownership?: "user" | "generated";
  readonly slot?: "custom" | "trust";
  readonly condition?: boolean;
  readonly resourceScope?: boolean;
  readonly secondStatement?: boolean;
}): PolicySubtree {
  const lifecycle =
    input.ownership === "generated"
      ? generatedLifecycle(input.suffix)
      : userLifecycle();
  const policyNodeId = `node_policy_${input.suffix}`;
  const statementNodeId = `node_statement_${input.suffix}`;
  const relationship =
    input.slot === "trust"
      ? "example.relationship.owns-trust-policy"
      : "example.relationship.owns-custom-policy";
  const policyPort =
    input.slot === "trust"
      ? "example.port.policy-trust"
      : "example.port.policy-owner";
  const ownerPort =
    input.slot === "trust"
      ? "example.port.trust-policy"
      : "example.port.custom-policy";
  const ownerConfig =
    input.slot === "trust"
      ? "example.relationship.owns-trust-policy-config"
      : "example.relationship.owns-custom-policy-config";
  const nodes: unknown[] = [
    {
      id: policyNodeId,
      semantic: {
        deploymentKey: `policy_${input.suffix}`,
        serviceType: "example.configuration",
        resourceType: "example.configuration.policy-document",
        configuration: policyConfiguration(`Policy ${input.suffix}`),
        parent: { nodeId: ownerNodeId, relationshipType: relationship },
        lifecycle,
      },
      presentation: {
        label: `Policy ${input.suffix}`,
        position: { x: 300, y: 100 },
      },
    },
    {
      id: statementNodeId,
      semantic: {
        deploymentKey: `statement_${input.suffix}`,
        serviceType: "example.configuration",
        resourceType: "example.configuration.policy-statement",
        configuration: statementConfiguration(`Statement${input.suffix}`),
        parent: {
          nodeId: policyNodeId,
          relationshipType: "example.relationship.contains-statement",
        },
        lifecycle,
      },
      presentation: {
        label: `Statement ${input.suffix}`,
        position: { x: 340, y: 140 },
      },
    },
  ];
  const edges: unknown[] = [
    {
      id: `edge_owner_${input.suffix}`,
      semantic: {
        source: { nodeId: policyNodeId, port: policyPort },
        target: { nodeId: ownerNodeId, port: ownerPort },
        relationshipType: relationship,
        configuration: edgeConfiguration(ownerConfig),
        lifecycle,
      },
    },
    {
      id: `edge_membership_${input.suffix}`,
      semantic: {
        source: {
          nodeId: statementNodeId,
          port: "example.port.statement-policy",
        },
        target: {
          nodeId: policyNodeId,
          port: "example.port.policy-statement",
        },
        relationshipType: "example.relationship.contains-statement",
        configuration: edgeConfiguration(
          "example.relationship.contains-statement-config",
        ),
        lifecycle,
      },
    },
  ];
  if (input.condition === true) {
    nodes.push({
      id: `node_condition_${input.suffix}`,
      semantic: {
        deploymentKey: `condition_${input.suffix}`,
        serviceType: "example.configuration",
        resourceType: "example.configuration.policy-condition",
        configuration: conditionConfiguration(`condition:${input.suffix}`),
        parent: {
          nodeId: statementNodeId,
          relationshipType: "example.relationship.statement-condition",
        },
        lifecycle,
      },
      presentation: {
        label: `Condition ${input.suffix}`,
        position: { x: 380, y: 180 },
      },
    });
    edges.push({
      id: `edge_condition_${input.suffix}`,
      semantic: {
        source: {
          nodeId: `node_condition_${input.suffix}`,
          port: "example.port.condition-statement",
        },
        target: {
          nodeId: statementNodeId,
          port: "example.port.statement-condition",
        },
        relationshipType: "example.relationship.statement-condition",
        configuration: edgeConfiguration(
          "example.relationship.statement-condition-config",
        ),
        lifecycle,
      },
    });
  }
  if (input.resourceScope === true) {
    edges.push({
      id: `edge_scope_${input.suffix}`,
      semantic: {
        source: {
          nodeId: statementNodeId,
          port: "example.port.statement-resource",
        },
        target: {
          nodeId: resourceNodeId,
          port: "example.port.resource-policy",
        },
        relationshipType: "example.relationship.authorizes-resource",
        configuration: edgeConfiguration(
          "example.relationship.authorizes-resource-config",
        ),
        lifecycle,
      },
    });
  }
  if (input.secondStatement === true) {
    nodes.push({
      id: `node_statement_${input.suffix}_second`,
      semantic: {
        deploymentKey: `statement_${input.suffix}_second`,
        serviceType: "example.configuration",
        resourceType: "example.configuration.policy-statement",
        configuration: statementConfiguration(`Statement${input.suffix}Second`),
        parent: {
          nodeId: policyNodeId,
          relationshipType: "example.relationship.contains-statement",
        },
        lifecycle,
      },
      presentation: {
        label: `Statement ${input.suffix} second`,
        position: { x: 340, y: 260 },
      },
    });
    edges.push({
      id: `edge_membership_${input.suffix}_second`,
      semantic: {
        source: {
          nodeId: `node_statement_${input.suffix}_second`,
          port: "example.port.statement-policy",
        },
        target: {
          nodeId: policyNodeId,
          port: "example.port.policy-statement",
        },
        relationshipType: "example.relationship.contains-statement",
        configuration: edgeConfiguration(
          "example.relationship.contains-statement-config",
        ),
        lifecycle,
      },
    });
  }
  return { nodes, edges };
}

function attachmentSubtree(suffix: string): PolicySubtree {
  const nodeId = `node_boundary_${suffix}`;
  return {
    nodes: [
      {
        id: nodeId,
        semantic: {
          deploymentKey: `boundary_${suffix}`,
          serviceType: "example.configuration",
          resourceType: "example.configuration.managed-attachment",
          configuration: configuration(
            "example.policy.managed-attachment-config",
            "1.0.0",
            { name: { kind: "string", value: suffix } },
          ),
          parent: {
            nodeId: ownerNodeId,
            relationshipType: "example.relationship.owns-boundary",
          },
          lifecycle: userLifecycle(),
        },
        presentation: {
          label: `Boundary ${suffix}`,
          position: { x: 300, y: 400 },
        },
      },
    ],
    edges: [
      {
        id: `edge_boundary_${suffix}`,
        semantic: {
          source: { nodeId, port: "example.port.boundary-owner" },
          target: {
            nodeId: ownerNodeId,
            port: "example.port.permissions-boundary",
          },
          relationshipType: "example.relationship.owns-boundary",
          configuration: edgeConfiguration(
            "example.relationship.owns-boundary-config",
          ),
          lifecycle: userLifecycle(),
        },
      },
    ],
  };
}

function mergeSubtrees(
  ...subtrees: readonly PolicySubtree[]
): ArchitectureDocument {
  return documentWith(
    subtrees.flatMap((subtree) => subtree.nodes),
    subtrees.flatMap((subtree) => subtree.edges),
  );
}

function operations(
  actionCount: number,
  prefix: string,
): GraphCommandBatchOperationIdentities {
  return {
    batch: {
      commandId: `operation_${prefix}_batch`,
      inverseCommandId: `operation_${prefix}_batch_inverse`,
    },
    actions: Array.from({ length: actionCount }, (_, index) => ({
      commandId: `operation_${prefix}_${String(index + 1)}`,
      inverseCommandId: `operation_${prefix}_${String(index + 1)}_inverse`,
    })),
  };
}

function requireReady(
  result: OwnedPolicyCommandPreparationResult,
): Extract<OwnedPolicyCommandPreparationResult, { readonly status: "ready" }> {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") {
    throw new Error(`Expected a ready command, received ${result.status}.`);
  }
  return result;
}

describe("owned configuration and structured policy projection", () => {
  it("projects zero, one, and multiple exact policies in stable ID order", () => {
    const descriptors = graphDescriptors();
    const empty = projectOwnedPolicyConfigurations(documentWith(), descriptors);
    expect(empty).toMatchObject({
      success: true,
      configurations: [],
      policies: [],
    });

    const generated = policySubtree({
      suffix: "z",
      ownership: "generated",
      condition: true,
      resourceScope: true,
    });
    const user = policySubtree({ suffix: "a", condition: true });
    const document = mergeSubtrees(generated, user);
    const projection = projectOwnedPolicyConfigurations(document, descriptors);
    expect(projection.success).toBe(true);
    if (!projection.success) {
      throw new Error("Expected exact policies to project.");
    }
    expect(
      projection.policies.map((policy) => policy.configurationNode.id),
    ).toEqual(["node_policy_a", "node_policy_z"]);
    expect(
      projection.policies[1]?.configurationNode.semantic.lifecycle,
    ).toEqual(generatedLifecycle("z"));
    expect(projection.policies[1]?.bindingEdge.id).toBe("edge_owner_z");
    expect(projection.policies[1]?.statements[0]).toMatchObject({
      node: { id: "node_statement_z" },
      membershipEdge: { id: "edge_membership_z" },
      conditions: [{ node: { id: "node_condition_z" } }],
      resourceScopes: [{ edge: { id: "edge_scope_z" } }],
    });
  });

  it("reports exact trust minimum and permissions-boundary maximum findings", () => {
    const descriptors = graphDescriptors({
      trustMinimum: 1,
      boundaryMaximum: 1,
    });
    const missingTrust = projectOwnedPolicyConfigurations(
      documentWith(),
      descriptors,
    );
    expect(missingTrust.success).toBe(false);
    if (!missingTrust.success) {
      expect(missingTrust.findings.map((entry) => entry.code)).toContain(
        "cardinality_below_minimum",
      );
    }

    expect(
      projectOwnedPolicyConfigurationsForEditing(documentWith(), descriptors)
        .success,
    ).toBe(true);
    expect(descriptors.ownedConfigurations.slots[1]?.cardinality.minimum).toBe(
      1,
    );
    expect(
      projectOwnedPolicyConfigurationsForEditing(
        documentWith(),
        graphDescriptors({ trustMinimum: -1 }),
      ).success,
    ).toBe(false);
    const trust = policySubtree({ suffix: "trust", slot: "trust" });
    const firstBoundary = attachmentSubtree("a");
    const secondBoundary = attachmentSubtree("b");
    const tooManyBoundaries = projectOwnedPolicyConfigurations(
      mergeSubtrees(trust, firstBoundary, secondBoundary),
      descriptors,
    );
    expect(tooManyBoundaries.success).toBe(false);
    if (!tooManyBoundaries.success) {
      expect(tooManyBoundaries.findings.map((entry) => entry.code)).toContain(
        "cardinality_above_maximum",
      );
    }
  });

  it("fails closed with deterministic findings for ambiguous owner and statement bindings", () => {
    const subtree = policySubtree({ suffix: "ambiguous" });
    const duplicateOwner = structuredClone(
      subtree.edges[0] as Record<string, unknown>,
    );
    (duplicateOwner as { id: string }).id = "edge_owner_ambiguous_second";
    const ownerAmbiguity = projectOwnedPolicyConfigurations(
      documentWith(subtree.nodes, [...subtree.edges, duplicateOwner]),
      graphDescriptors(),
    );
    expect(ownerAmbiguity.success).toBe(false);
    if (!ownerAmbiguity.success) {
      expect(ownerAmbiguity.findings).toEqual([
        expect.objectContaining({ code: "ambiguous_binding" }),
      ]);
    }

    const duplicateMembership = structuredClone(
      subtree.edges[1] as Record<string, unknown>,
    );
    (duplicateMembership as { id: string }).id =
      "edge_membership_ambiguous_second";
    const statementAmbiguity = projectOwnedPolicyConfigurations(
      documentWith(subtree.nodes, [...subtree.edges, duplicateMembership]),
      graphDescriptors(),
    );
    expect(statementAmbiguity.success).toBe(false);
    if (!statementAmbiguity.success) {
      expect(statementAmbiguity.findings).toEqual([
        expect.objectContaining({ code: "ambiguous_statement_binding" }),
      ]);
    }
  });
});

describe("owned policy Graph Command v1 builders", () => {
  it("creates, edits, and removes typed managed attachments while preserving siblings", () => {
    const descriptors = graphDescriptors();
    const first = requireReady(
      prepareUserOwnedConfigurationCreate({
        document: documentWith(),
        descriptors,
        ownerNodeId,
        slotId: "example.slot.managed-policy",
        ownedKindId: attachmentKindId,
        ownedConfiguration: {
          nodeId: "node_managed_attachment_a",
          deploymentKey: "managed_attachment_a",
          label: "Managed attachment A",
          position: { x: 300, y: 420 },
          configuration: managedAttachmentConfiguration(
            "ReviewedManagedPolicyA",
            "managed-policy-attachment",
          ),
        },
        ownerBindingEdgeId: "edge_managed_attachment_a",
        operationIdentities: operations(2, "create_managed_attachment_a"),
      }),
    );
    expect(first.command.commands.map((command) => command.kind)).toEqual([
      "add-node",
      "add-edge",
    ]);
    expect(
      first.previewDocument.nodes.find(
        (node) => node.id === "node_managed_attachment_a",
      ),
    ).toMatchObject({
      semantic: {
        parent: {
          nodeId: ownerNodeId,
          relationshipType: "example.relationship.owns-managed-policy",
        },
        lifecycle: { ownership: "user", origin: "user" },
      },
    });
    expect(
      first.previewDocument.edges.find(
        (edge) => edge.id === "edge_managed_attachment_a",
      ),
    ).toMatchObject({
      semantic: {
        source: {
          nodeId: "node_managed_attachment_a",
          port: "example.port.managed-owner",
        },
        target: { nodeId: ownerNodeId, port: "example.port.managed-policy" },
        relationshipType: "example.relationship.owns-managed-policy",
        lifecycle: { ownership: "user", origin: "user" },
      },
    });

    const second = requireReady(
      prepareUserOwnedConfigurationCreate({
        document: first.previewDocument,
        descriptors,
        ownerNodeId,
        slotId: "example.slot.managed-policy",
        ownedKindId: attachmentKindId,
        ownedConfiguration: {
          nodeId: "node_managed_attachment_b",
          deploymentKey: "managed_attachment_b",
          label: "Managed attachment B",
          position: { x: 300, y: 520 },
          configuration: managedAttachmentConfiguration(
            "ReviewedManagedPolicyB",
            "managed-policy-attachment",
          ),
        },
        ownerBindingEdgeId: "edge_managed_attachment_b",
        operationIdentities: operations(2, "create_managed_attachment_b"),
      }),
    );
    const projection = projectOwnedPolicyConfigurations(
      second.previewDocument,
      descriptors,
    );
    expect(projection.success).toBe(true);
    if (!projection.success) {
      throw new Error("Expected managed attachments to project exactly.");
    }
    expect(
      projection.configurations
        .filter(
          (configuration) =>
            configuration.slotId === "example.slot.managed-policy",
        )
        .map((configuration) => configuration.configurationNode.id),
    ).toEqual(["node_managed_attachment_a", "node_managed_attachment_b"]);

    const edited = requireReady(
      prepareUserOwnedConfigurationEdit({
        document: second.previewDocument,
        descriptors,
        configurationNodeId: "node_managed_attachment_a",
        configuration: managedAttachmentConfiguration(
          "ReviewedManagedPolicyAUpdated",
          "managed-policy-attachment",
        ),
        operationIdentities: operations(1, "edit_managed_attachment_a"),
      }),
    );
    expect(edited.previewContentHash).not.toBe(edited.baseContentHash);
    expect(
      edited.previewDocument.nodes.find(
        (node) => node.id === "node_managed_attachment_a",
      )?.semantic.configuration.values,
    ).toMatchObject({
      name: { kind: "string", value: "ReviewedManagedPolicyAUpdated" },
    });
    const preservedNode = edited.previewDocument.nodes.find(
      (node) => node.id === "node_managed_attachment_b",
    );
    const preservedEdge = edited.previewDocument.edges.find(
      (edge) => edge.id === "edge_managed_attachment_b",
    );
    const removed = requireReady(
      prepareUserOwnedConfigurationRemove({
        document: edited.previewDocument,
        descriptors,
        configurationNodeId: "node_managed_attachment_a",
        operationIdentities: operations(2, "remove_managed_attachment_a"),
      }),
    );
    expect(removed.command.commands.map((command) => command.kind)).toEqual([
      "remove-edge",
      "remove-node",
    ]);
    expect(
      removed.previewDocument.nodes.some(
        (node) => node.id === "node_managed_attachment_a",
      ),
    ).toBe(false);
    expect(
      removed.previewDocument.nodes.find(
        (node) => node.id === "node_managed_attachment_b",
      ),
    ).toEqual(preservedNode);
    expect(
      removed.previewDocument.edges.find(
        (edge) => edge.id === "edge_managed_attachment_b",
      ),
    ).toEqual(preservedEdge);
  });

  it("removes completed Lambda VPC access through exact direct generated cleanup with undo and redo", () => {
    const document = loadAwsNetworkingVisualArchitectureDocument();
    const prepared = requireReady(
      prepareUserOwnedConfigurationRemove({
        associationRelationships: awsEditorCatalog.relationships ?? [],
        configurationNodeId: "node_lambda_vpc_access",
        descriptors: awsOwnedPolicyGraphDescriptors,
        document,
        operationIdentities: operations(5, "remove_lambda_vpc_access"),
      }),
    );

    expect(prepared.command.commands.map((command) => command.kind)).toEqual([
      "release-generated-resource",
      "release-generated-resource",
      "release-generated-resource",
      "remove-edge",
      "remove-node",
    ]);
    expect(
      prepared.command.commands.flatMap((command) =>
        command.kind === "release-generated-resource" ? [command.resource] : [],
      ),
    ).toEqual([
      {
        edgeId: "net_lambda_security_group.edge.connection",
        kind: "edge",
      },
      { edgeId: "net_lambda_subnet_a.edge.connection", kind: "edge" },
      { edgeId: "net_lambda_subnet_b.edge.connection", kind: "edge" },
    ]);
    expect(
      prepared.previewDocument.nodes.some(
        (node) => node.id === "node_lambda_vpc_access",
      ),
    ).toBe(false);
    expect(
      prepared.previewDocument.edges.some(
        (edge) =>
          edge.semantic.source.nodeId === "node_lambda_vpc_access" ||
          edge.semantic.target.nodeId === "node_lambda_vpc_access",
      ),
    ).toBe(false);
    expect(
      prepared.previewDocument.nodes.some(
        (node) => node.id === "node_private_subnet_a",
      ),
    ).toBe(true);
    expect(
      prepared.previewDocument.nodes.some(
        (node) => node.id === "node_application_security_group",
      ),
    ).toBe(true);

    const applied = applyGraphCommand(document, prepared.command);
    expect(applied.inversion.kind).toBe("available");
    if (applied.inversion.kind !== "available") {
      throw new Error(
        "Expected completed configuration removal to be undoable.",
      );
    }
    const undone = applyGraphCommand(
      applied.document,
      applied.inversion.command,
    );
    expect(getArchitectureDocumentContentHash(undone.document)).toBe(
      getArchitectureDocumentContentHash(document),
    );
    expect(undone.inversion.kind).toBe("available");
    if (undone.inversion.kind !== "available") {
      throw new Error("Expected completed configuration undo to be redoable.");
    }
    const redone = applyGraphCommand(undone.document, undone.inversion.command);
    expect(getArchitectureDocumentContentHash(redone.document)).toBe(
      prepared.previewContentHash,
    );
  });

  it("removes one route-table association and its exact target edge without changing sibling routing", () => {
    const document = loadAwsNetworkingVisualArchitectureDocument();
    const preservedSibling = document.nodes.find(
      (node) => node.id === "node_public_route_association_b",
    );
    const prepared = requireReady(
      prepareUserOwnedConfigurationRemove({
        associationRelationships: awsEditorCatalog.relationships ?? [],
        configurationNodeId: "node_public_route_association_a",
        descriptors: awsOwnedPolicyGraphDescriptors,
        document,
        operationIdentities: operations(3, "remove_route_association"),
      }),
    );

    expect(prepared.command.commands.map((command) => command.kind)).toEqual([
      "release-generated-resource",
      "remove-edge",
      "remove-node",
    ]);
    expect(
      prepared.previewDocument.nodes.some(
        (node) => node.id === "node_public_route_association_a",
      ),
    ).toBe(false);
    expect(
      prepared.previewDocument.edges.some(
        (edge) => edge.id === "net_pub_a_route_assoc.edge.connection",
      ),
    ).toBe(false);
    expect(
      prepared.previewDocument.nodes.find(
        (node) => node.id === "node_public_route_association_b",
      ),
    ).toEqual(preservedSibling);
    expect(
      prepared.previewDocument.edges.some(
        (edge) => edge.id === "net_pub_b_route_assoc.edge.connection",
      ),
    ).toBe(true);
  });

  it("blocks shared generated association cleanup and keeps a stale multi-action removal atomic", () => {
    const document = loadAwsNetworkingVisualArchitectureDocument();
    expect(
      document.edges.some(
        (edge) => edge.id === "net_lambda_subnet_a.edge.connection",
      ),
    ).toBe(true);
    const sharedDocument = parseArchitectureDocument({
      ...document,
      edges: document.edges.map((edge) => {
        const lifecycle = edge.semantic.lifecycle;
        return edge.id !== "net_lambda_subnet_a.edge.connection" ||
          lifecycle.ownership !== "generated"
          ? edge
          : {
              ...edge,
              semantic: {
                ...edge.semantic,
                lifecycle: {
                  ...lifecycle,
                  provenance: {
                    ...lifecycle.provenance,
                    dependentEdgeIds: ["edge_lambda_vpc_access_owner"],
                  },
                },
              },
            };
      }),
    });
    const beforeSharedHash = getArchitectureDocumentContentHash(sharedDocument);
    const blocked = prepareUserOwnedConfigurationRemove({
      associationRelationships: awsEditorCatalog.relationships ?? [],
      configurationNodeId: "node_lambda_vpc_access",
      descriptors: awsOwnedPolicyGraphDescriptors,
      document: sharedDocument,
      operationIdentities: operations(5, "blocked_shared_lambda_vpc_access"),
    });
    expect(blocked.status).toBe("invalid");
    if (blocked.status !== "invalid") {
      throw new Error("Shared generated association cleanup must fail closed.");
    }
    expect(blocked.issues[0]?.code).toBe("unexpected-reference");
    expect(blocked.issues[0]?.message).toContain(
      "isolated reviewed cleanup path",
    );
    expect(getArchitectureDocumentContentHash(sharedDocument)).toBe(
      beforeSharedHash,
    );

    const prepared = requireReady(
      prepareUserOwnedConfigurationRemove({
        associationRelationships: awsEditorCatalog.relationships ?? [],
        configurationNodeId: "node_lambda_vpc_access",
        descriptors: awsOwnedPolicyGraphDescriptors,
        document,
        operationIdentities: operations(5, "stale_lambda_vpc_access"),
      }),
    );
    const staleDocument = parseArchitectureDocument({
      ...document,
      edges: document.edges.map((edge) =>
        edge.id === "edge_lambda_vpc_access_owner"
          ? {
              ...edge,
              semantic: {
                ...edge.semantic,
                lifecycle: { origin: "user", ownership: "user" },
              },
            }
          : edge,
      ),
    });
    const beforeStaleHash = getArchitectureDocumentContentHash(staleDocument);
    expect(() => applyGraphCommand(staleDocument, prepared.command)).toThrow();
    expect(getArchitectureDocumentContentHash(staleDocument)).toBe(
      beforeStaleHash,
    );
    expect(
      staleDocument.edges.some(
        (edge) => edge.id === "net_lambda_subnet_a.edge.connection",
      ),
    ).toBe(true);
  });

  it("enforces the exact zero-or-one boundary slot before constructing a batch", () => {
    const descriptors = graphDescriptors();
    const first = requireReady(
      prepareUserOwnedConfigurationCreate({
        document: documentWith(),
        descriptors,
        ownerNodeId,
        slotId: "example.slot.permissions-boundary",
        ownedKindId: attachmentKindId,
        ownedConfiguration: {
          nodeId: "node_boundary_created_a",
          deploymentKey: "boundary_created_a",
          label: "Permissions boundary A",
          position: { x: 300, y: 420 },
          configuration: managedAttachmentConfiguration(
            "ReviewedBoundaryA",
            "permissions-boundary",
          ),
        },
        ownerBindingEdgeId: "edge_boundary_created_a",
        operationIdentities: operations(2, "create_boundary_a"),
      }),
    );
    const second = prepareUserOwnedConfigurationCreate({
      document: first.previewDocument,
      descriptors,
      ownerNodeId,
      slotId: "example.slot.permissions-boundary",
      ownedKindId: attachmentKindId,
      ownedConfiguration: {
        nodeId: "node_boundary_created_b",
        deploymentKey: "boundary_created_b",
        label: "Permissions boundary B",
        position: { x: 300, y: 520 },
        configuration: managedAttachmentConfiguration(
          "ReviewedBoundaryB",
          "permissions-boundary",
        ),
      },
      ownerBindingEdgeId: "edge_boundary_created_b",
      operationIdentities: operations(2, "create_boundary_b"),
    });
    expect(second).toMatchObject({
      status: "invalid",
      issues: [{ code: "cardinality-violation" }],
    });
    expect(
      first.previewDocument.nodes.some(
        (node) => node.id === "node_boundary_created_b",
      ),
    ).toBe(false);
  });

  it("requires adoption before editing or removing a generated attachment", () => {
    const lifecycle = generatedLifecycle("attachment");
    const generatedAttachment: PolicySubtree = {
      nodes: [
        {
          id: "node_generated_attachment",
          semantic: {
            deploymentKey: "generated_attachment",
            serviceType: "example.configuration",
            resourceType: "example.configuration.managed-attachment",
            configuration: managedAttachmentConfiguration(
              "GeneratedAttachment",
              "managed-policy-attachment",
            ),
            parent: {
              nodeId: ownerNodeId,
              relationshipType: "example.relationship.owns-managed-policy",
            },
            lifecycle,
          },
          presentation: {
            label: "Generated attachment",
            position: { x: 300, y: 420 },
          },
        },
      ],
      edges: [
        {
          id: "edge_generated_attachment",
          semantic: {
            source: {
              nodeId: "node_generated_attachment",
              port: "example.port.managed-owner",
            },
            target: {
              nodeId: ownerNodeId,
              port: "example.port.managed-policy",
            },
            relationshipType: "example.relationship.owns-managed-policy",
            configuration: edgeConfiguration(
              "example.relationship.owns-managed-policy-config",
            ),
            lifecycle,
          },
        },
      ],
    };
    const baseDescriptors = graphDescriptors();
    const descriptors: OwnedPolicyGraphDescriptorSet = {
      ...baseDescriptors,
      ownedConfigurations: {
        ...baseDescriptors.ownedConfigurations,
        kinds: baseDescriptors.ownedConfigurations.kinds.map((kind) =>
          kind.id === attachmentKindId
            ? { ...kind, allowedOwnership: ["user", "generated"] }
            : kind,
        ),
      },
    };
    const document = mergeSubtrees(generatedAttachment);
    expect(
      prepareUserOwnedConfigurationEdit({
        document,
        descriptors,
        configurationNodeId: "node_generated_attachment",
        configuration: managedAttachmentConfiguration(
          "ChangedGeneratedAttachment",
          "managed-policy-attachment",
        ),
        operationIdentities: operations(1, "edit_generated_attachment"),
      }),
    ).toMatchObject({
      status: "adopt-before-customize",
      resource: { kind: "node", nodeId: "node_generated_attachment" },
    });
    expect(
      prepareUserOwnedConfigurationRemove({
        document,
        descriptors,
        configurationNodeId: "node_generated_attachment",
        operationIdentities: operations(2, "remove_generated_attachment"),
      }),
    ).toMatchObject({
      status: "adopt-before-customize",
      resource: { kind: "node", nodeId: "node_generated_attachment" },
    });
  });

  it("creates one user policy and initial statement atomically with caller identities", () => {
    const document = documentWith();
    const prepared = requireReady(
      prepareUserPolicyCreation({
        document,
        descriptors: graphDescriptors(),
        ownerNodeId,
        slotId: "example.slot.custom-policy",
        policyOwnedKindId: policyKindId,
        policy: {
          nodeId: "node_policy_created",
          deploymentKey: "policy_created",
          label: "Created policy",
          position: { x: 300, y: 100 },
          configuration: policyConfiguration("CreatedPolicy"),
        },
        initialStatement: {
          nodeId: "node_statement_created",
          deploymentKey: "statement_created",
          label: "Initial statement",
          position: { x: 340, y: 140 },
          configuration: statementConfiguration("InitialStatement"),
        },
        ownerBindingEdgeId: "edge_owner_created",
        statementMembershipEdgeId: "edge_membership_created",
        operationIdentities: operations(4, "create_policy"),
      }),
    );

    expect(prepared.command.commands.map((command) => command.kind)).toEqual([
      "add-node",
      "add-node",
      "add-edge",
      "add-edge",
    ]);
    expect(prepared.baseContentHash).toBe(
      getArchitectureDocumentContentHash(document),
    );
    expect(prepared.previewContentHash).not.toBe(prepared.baseContentHash);
    const projection = projectOwnedPolicyConfigurations(
      prepared.previewDocument,
      graphDescriptors(),
    );
    expect(projection).toMatchObject({
      success: true,
      policies: [
        {
          configurationNode: {
            id: "node_policy_created",
            semantic: { lifecycle: { ownership: "user", origin: "user" } },
          },
          statements: [{ node: { id: "node_statement_created" } }],
        },
      ],
    });
    expect(
      prepared.command.commands.some(
        (command) => command.kind === "release-generated-resource",
      ),
    ).toBe(false);
  });

  it("bootstraps required policies one owner at a time without accepting malformed bindings or new deficits", () => {
    const baseline = documentWith();
    const owner = baseline.nodes.find((node) => node.id === ownerNodeId);
    if (owner === undefined) throw new Error("The role fixture is required.");
    const secondOwnerId = "node_second_role";
    const document = parseArchitectureDocument({
      ...baseline,
      nodes: [
        ...baseline.nodes,
        {
          ...owner,
          id: secondOwnerId,
          semantic: { ...owner.semantic, deploymentKey: "second_role" },
        },
      ],
    });
    const descriptors = graphDescriptors({ trustMinimum: 1 });
    const createTrust = (
      source: ArchitectureDocument,
      ownerId: string,
      suffix: string,
    ) =>
      prepareUserPolicyCreation({
        document: source,
        descriptors,
        ownerNodeId: ownerId,
        slotId: "example.slot.trust-policy",
        policyOwnedKindId: policyKindId,
        policy: {
          nodeId: `node_policy_${suffix}`,
          deploymentKey: `policy_${suffix}`,
          label: "Required trust",
          position: { x: 300, y: 100 },
          configuration: policyConfiguration(`Trust${suffix}`),
        },
        initialStatement: {
          nodeId: `node_statement_${suffix}`,
          deploymentKey: `statement_${suffix}`,
          label: "Initial statement",
          position: { x: 340, y: 140 },
          configuration: statementConfiguration(`Trust${suffix}`),
        },
        ownerBindingEdgeId: `edge_owner_${suffix}`,
        statementMembershipEdgeId: `edge_membership_${suffix}`,
        operationIdentities: operations(4, `bootstrap_${suffix}`),
      });

    const initialHash = getArchitectureDocumentContentHash(document);
    const first = requireReady(createTrust(document, ownerNodeId, "first"));
    const stillIncomplete = projectOwnedPolicyConfigurations(
      first.previewDocument,
      descriptors,
    );
    expect(stillIncomplete.success).toBe(false);
    expect(stillIncomplete.findings.map((entry) => entry.code)).toEqual([
      "cardinality_below_minimum",
    ]);
    expect(getArchitectureDocumentContentHash(document)).toBe(initialHash);
    const applied = applyGraphCommand(document, first.command);
    if (applied.inversion.kind !== "available") {
      throw new Error("Bootstrap must have an exact inverse.");
    }
    expect(
      getArchitectureDocumentContentHash(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ),
    ).toBe(initialHash);
    const second = requireReady(
      createTrust(first.previewDocument, secondOwnerId, "second"),
    );
    expect(
      projectOwnedPolicyConfigurations(second.previewDocument, descriptors)
        .success,
    ).toBe(true);
    expect(
      createTrust(first.previewDocument, ownerNodeId, "extra").status,
    ).toBe("invalid");
    expect(
      prepareUserPolicyRemove({
        document: first.previewDocument,
        descriptors,
        policyNodeId: "node_policy_first",
        operationIdentities: operations(4, "remove_required_trust"),
      }).status,
    ).toBe("invalid");
    const membership = first.previewDocument.edges.find(
      (edge) => edge.id === "edge_membership_first",
    );
    if (membership === undefined) throw new Error("Membership is required.");
    const malformed = parseArchitectureDocument({
      ...first.previewDocument,
      edges: [
        ...first.previewDocument.edges,
        { ...membership, id: "edge_membership_duplicate" },
      ],
    });
    expect(createTrust(malformed, secondOwnerId, "malformed").status).toBe(
      "invalid",
    );
  });

  it("adds, edits, and removes statements while preserving the exact minimum", () => {
    const subtree = policySubtree({ suffix: "statement" });
    const document = mergeSubtrees(subtree);
    const added = requireReady(
      preparePolicyStatementAdd({
        document,
        descriptors: graphDescriptors(),
        policyNodeId: "node_policy_statement",
        statement: {
          nodeId: "node_statement_added",
          deploymentKey: "statement_added",
          label: "Added statement",
          position: { x: 340, y: 260 },
          configuration: statementConfiguration("AddedStatement"),
        },
        membershipEdgeId: "edge_membership_added",
        operationIdentities: operations(2, "add_statement"),
      }),
    );
    const edited = requireReady(
      preparePolicyStatementEdit({
        document: added.previewDocument,
        descriptors: graphDescriptors(),
        policyNodeId: "node_policy_statement",
        statementNodeId: "node_statement_added",
        configuration: statementConfiguration("AddedStatement", [
          "example:Read",
          "example:List",
        ]),
        operationIdentities: operations(1, "edit_statement"),
      }),
    );
    expect(edited.previewContentHash).not.toBe(edited.baseContentHash);
    const removed = requireReady(
      preparePolicyStatementRemove({
        document: edited.previewDocument,
        descriptors: graphDescriptors(),
        policyNodeId: "node_policy_statement",
        statementNodeId: "node_statement_added",
        operationIdentities: operations(2, "remove_statement"),
      }),
    );
    expect(removed.command.commands.map((command) => command.kind)).toEqual([
      "remove-edge",
      "remove-node",
    ]);
    expect(
      removed.previewDocument.nodes.some(
        (node) => node.id === "node_statement_added",
      ),
    ).toBe(false);
    expect(
      preparePolicyStatementRemove({
        document: removed.previewDocument,
        descriptors: graphDescriptors(),
        policyNodeId: "node_policy_statement",
        statementNodeId: "node_statement_statement",
        operationIdentities: operations(2, "remove_last_statement"),
      }),
    ).toMatchObject({
      status: "invalid",
      issues: [{ code: "cardinality-violation" }],
    });
  });

  it("duplicates the exact statement, condition, and resource-scope subtree as user-owned graph facts", () => {
    const document = mergeSubtrees(
      policySubtree({
        suffix: "duplicate",
        condition: true,
        resourceScope: true,
      }),
    );
    const prepared = requireReady(
      preparePolicyStatementDuplicate({
        document,
        descriptors: graphDescriptors(),
        policyNodeId: "node_policy_duplicate",
        statementNodeId: "node_statement_duplicate",
        duplicateStatement: {
          nodeId: "node_statement_duplicate_copy",
          deploymentKey: "statement_duplicate_copy",
          label: "Statement duplicate copy",
          position: { x: 340, y: 300 },
        },
        membershipEdgeId: "edge_membership_duplicate_copy",
        conditions: [
          {
            sourceConditionNodeId: "node_condition_duplicate",
            duplicateCondition: {
              nodeId: "node_condition_duplicate_copy",
              deploymentKey: "condition_duplicate_copy",
              label: "Condition duplicate copy",
              position: { x: 380, y: 340 },
            },
            membershipEdgeId: "edge_condition_duplicate_copy",
          },
        ],
        resourceScopes: [
          {
            sourceScopeEdgeId: "edge_scope_duplicate",
            duplicateScopeEdgeId: "edge_scope_duplicate_copy",
          },
        ],
        operationIdentities: operations(5, "duplicate_statement"),
      }),
    );
    expect(prepared.command.commands.map((command) => command.kind)).toEqual([
      "add-node",
      "add-node",
      "add-edge",
      "add-edge",
      "add-edge",
    ]);
    const source = prepared.previewDocument.nodes.find(
      (node) => node.id === "node_statement_duplicate",
    );
    const duplicate = prepared.previewDocument.nodes.find(
      (node) => node.id === "node_statement_duplicate_copy",
    );
    const sourceCondition = prepared.previewDocument.nodes.find(
      (node) => node.id === "node_condition_duplicate",
    );
    const duplicateCondition = prepared.previewDocument.nodes.find(
      (node) => node.id === "node_condition_duplicate_copy",
    );
    expect(duplicate?.semantic.configuration).toEqual(
      source?.semantic.configuration,
    );
    expect(duplicateCondition?.semantic.configuration).toEqual(
      sourceCondition?.semantic.configuration,
    );
    expect(duplicate?.semantic.lifecycle).toEqual(userLifecycle());
    expect(
      prepared.previewDocument.edges.find(
        (edge) => edge.id === "edge_scope_duplicate_copy",
      ),
    ).toMatchObject({
      semantic: {
        source: { nodeId: "node_statement_duplicate_copy" },
        target: { nodeId: resourceNodeId },
        lifecycle: { ownership: "user", origin: "user" },
      },
    });
  });

  it("adds and removes conditions through dependency-safe atomic batches", () => {
    const document = mergeSubtrees(policySubtree({ suffix: "condition" }));
    const added = requireReady(
      preparePolicyConditionAdd({
        document,
        descriptors: graphDescriptors(),
        policyNodeId: "node_policy_condition",
        statementNodeId: "node_statement_condition",
        condition: {
          nodeId: "node_condition_added",
          deploymentKey: "condition_added",
          label: "Added condition",
          position: { x: 380, y: 180 },
          configuration: conditionConfiguration("condition:added"),
        },
        membershipEdgeId: "edge_condition_added",
        operationIdentities: operations(2, "add_condition"),
      }),
    );
    const removed = requireReady(
      preparePolicyConditionRemove({
        document: added.previewDocument,
        descriptors: graphDescriptors(),
        policyNodeId: "node_policy_condition",
        statementNodeId: "node_statement_condition",
        conditionNodeId: "node_condition_added",
        operationIdentities: operations(2, "remove_condition"),
      }),
    );
    expect(removed.command.commands.map((command) => command.kind)).toEqual([
      "remove-edge",
      "remove-node",
    ]);
    expect(
      removed.previewDocument.nodes.some(
        (node) => node.id === "node_condition_added",
      ),
    ).toBe(false);
  });

  it("selects a resource scope and changes it without changing the stable edge ID", () => {
    const withoutScope = mergeSubtrees(policySubtree({ suffix: "scope" }));
    const selected = requireReady(
      preparePolicyResourceScopeSet({
        document: withoutScope,
        descriptors: graphDescriptors(),
        policyNodeId: "node_policy_scope",
        statementNodeId: "node_statement_scope",
        scopeEdgeId: "edge_scope_selected",
        resourceScopeDescriptorId: "example.policy.resource-scope",
        resourceNodeId,
        operationIdentities: operations(1, "select_scope"),
      }),
    );
    expect(selected.command.commands.map((command) => command.kind)).toEqual([
      "add-edge",
    ]);
    const changed = requireReady(
      preparePolicyResourceScopeSet({
        document: selected.previewDocument,
        descriptors: graphDescriptors(),
        policyNodeId: "node_policy_scope",
        statementNodeId: "node_statement_scope",
        scopeEdgeId: "edge_scope_selected",
        resourceScopeDescriptorId: "example.policy.resource-scope",
        resourceNodeId: secondResourceNodeId,
        operationIdentities: operations(2, "change_scope"),
      }),
    );
    expect(changed.command.commands.map((command) => command.kind)).toEqual([
      "remove-edge",
      "add-edge",
    ]);
    expect(
      changed.previewDocument.edges.find(
        (edge) => edge.id === "edge_scope_selected",
      ),
    ).toMatchObject({ semantic: { target: { nodeId: secondResourceNodeId } } });
  });

  it("returns adopt-before-customize for generated resources without proposing mutations", () => {
    const document = mergeSubtrees(
      policySubtree({ suffix: "generated", ownership: "generated" }),
    );
    const edit = preparePolicyStatementEdit({
      document,
      descriptors: graphDescriptors({ trustMinimum: 1 }),
      policyNodeId: "node_policy_generated",
      statementNodeId: "node_statement_generated",
      configuration: statementConfiguration("Changed"),
      operationIdentities: operations(1, "generated_edit"),
    });
    expect(edit.status).toBe("adopt-before-customize");
    if (edit.status !== "adopt-before-customize") {
      throw new Error(
        "Expected generated statement editing to require adoption.",
      );
    }
    expect(edit.resource).toEqual({
      kind: "node",
      nodeId: "node_policy_generated",
    });
    expect(edit.reason).toContain("Adopt");
    expect(
      prepareUserPolicyRemove({
        document,
        descriptors: graphDescriptors({ trustMinimum: 1 }),
        policyNodeId: "node_policy_generated",
        operationIdentities: operations(4, "generated_remove"),
      }),
    ).toMatchObject({
      status: "adopt-before-customize",
      resource: { kind: "node", nodeId: "node_policy_generated" },
    });
  });

  it("removes a whole user policy child-first while preserving a second policy exactly", () => {
    const first = policySubtree({
      suffix: "remove",
      condition: true,
      resourceScope: true,
    });
    const second = policySubtree({
      suffix: "preserve",
      condition: true,
      resourceScope: true,
    });
    const document = mergeSubtrees(first, second);
    const preservedBefore = {
      nodes: document.nodes.filter((node) => node.id.includes("preserve")),
      edges: document.edges.filter((edge) => edge.id.includes("preserve")),
    };
    const prepared = requireReady(
      prepareUserPolicyRemove({
        document,
        descriptors: graphDescriptors(),
        policyNodeId: "node_policy_remove",
        operationIdentities: operations(7, "remove_policy"),
      }),
    );
    expect(
      prepared.command.commands
        .slice(0, 4)
        .every((command) => command.kind === "remove-edge"),
    ).toBe(true);
    expect(
      prepared.command.commands.slice(4).map((command) => command.kind),
    ).toEqual(["remove-node", "remove-node", "remove-node"]);
    expect(
      prepared.command.commands
        .slice(4)
        .map((command) =>
          command.kind === "remove-node" ? command.nodeId : "",
        ),
    ).toEqual([
      "node_condition_remove",
      "node_statement_remove",
      "node_policy_remove",
    ]);
    expect(
      prepared.command.commands.some(
        (command) => command.kind === "release-generated-resource",
      ),
    ).toBe(false);
    expect({
      nodes: prepared.previewDocument.nodes.filter((node) =>
        node.id.includes("preserve"),
      ),
      edges: prepared.previewDocument.edges.filter((edge) =>
        edge.id.includes("preserve"),
      ),
    }).toEqual(preservedBefore);
    expect(
      prepared.previewDocument.nodes.some((node) => node.id.includes("remove")),
    ).toBe(false);
  });

  it("rejects duplicate operation identities before parsing or applying a batch", () => {
    const document = mergeSubtrees(policySubtree({ suffix: "identity" }));
    const beforeHash = getArchitectureDocumentContentHash(document);
    const duplicateIdentities = operations(1, "duplicate_identity");
    const result = preparePolicyStatementEdit({
      document,
      descriptors: graphDescriptors(),
      policyNodeId: "node_policy_identity",
      statementNodeId: "node_statement_identity",
      configuration: statementConfiguration("ChangedIdentity"),
      operationIdentities: {
        ...duplicateIdentities,
        actions: [
          {
            commandId: duplicateIdentities.batch.commandId,
            inverseCommandId: "operation_duplicate_identity_action_inverse",
          },
        ],
      },
    });
    expect(result).toMatchObject({
      status: "invalid",
      issues: [{ code: "invalid-operation-identities" }],
    });
    expect(getArchitectureDocumentContentHash(document)).toBe(beforeHash);
  });
});
