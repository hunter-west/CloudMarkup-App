import { readFile } from "node:fs/promises";

import {
  actorIdSchema,
  architectureEdgeV1Schema,
  architectureNodeV1Schema,
  configurationSchemaIdSchema,
  generatorIdSchema,
  nodeIdSchema,
  operationIdSchema,
  portTypeSchema,
  relationshipTypeSchema,
  resourceTypeSchema,
  semanticVersionSchema,
  serviceTypeSchema,
  type ElementLifecycle,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  GraphCommandApplicationError,
  applyGraphCommand,
  classifyOwnedConfigurationNodes,
  parseArchitectureDocument,
  type ArchitectureDocument,
  type ArchitectureEdge,
  type ArchitectureNode,
  type OwnedConfigurationClassificationIssueCode,
  type OwnedConfigurationDescriptorSet,
} from "./index.js";

const schemaVersion = semanticVersionSchema.parse("1.0.0");
const generatedAt = utcTimestampSchema.parse("2026-08-25T14:00:00Z");
const adoptedBy = actorIdSchema.parse("actor_user");

const slotSpecifications = [
  {
    key: "route",
    kindId: "example.network-configuration.route",
    slotId: "example.network-slot.routes",
    ownerNodeId: "node_network_route_owner",
    configurationNodeId: "node_network_route_configuration",
    bindingEdgeId: "edge_network_route_owner",
    ownerServiceType: "example.network-control",
    ownerResourceType: "example.network-control.route-table",
    configurationResourceType: "example.network-configuration.route",
    configurationSchemaId: "example.network-configuration.route-config",
    relationshipType: "example.relationship.owns-route",
    configurationPort: "example.port.route-owner",
    ownerPort: "example.port.routes",
  },
  {
    key: "association",
    kindId: "example.network-configuration.association",
    slotId: "example.network-slot.associations",
    ownerNodeId: "node_network_association_owner",
    configurationNodeId: "node_network_association_configuration",
    bindingEdgeId: "edge_network_association_owner",
    ownerServiceType: "example.network-control",
    ownerResourceType: "example.network-control.association-table",
    configurationResourceType: "example.network-configuration.association",
    configurationSchemaId: "example.network-configuration.association-config",
    relationshipType: "example.relationship.owns-association",
    configurationPort: "example.port.association-owner",
    ownerPort: "example.port.associations",
  },
  {
    key: "policy_rule",
    kindId: "example.network-configuration.policy-rule",
    slotId: "example.network-slot.policy-rules",
    ownerNodeId: "node_network_policy_owner",
    configurationNodeId: "node_network_policy_rule_configuration",
    bindingEdgeId: "edge_network_policy_rule_owner",
    ownerServiceType: "example.network-policy",
    ownerResourceType: "example.network-policy.group",
    configurationResourceType: "example.network-configuration.policy-rule",
    configurationSchemaId: "example.network-configuration.policy-rule-config",
    relationshipType: "example.relationship.owns-policy-rule",
    configurationPort: "example.port.policy-rule-owner",
    ownerPort: "example.port.policy-rules",
  },
  {
    key: "workload_network",
    kindId: "example.workload-configuration.network-association",
    slotId: "example.workload-slot.network-associations",
    ownerNodeId: "node_workload_network_owner",
    configurationNodeId: "node_workload_network_configuration",
    bindingEdgeId: "edge_workload_network_owner",
    ownerServiceType: "example.workload",
    ownerResourceType: "example.workload.function",
    configurationResourceType:
      "example.workload-configuration.network-association",
    configurationSchemaId:
      "example.workload-configuration.network-association-config",
    relationshipType: "example.relationship.owns-network-association",
    configurationPort: "example.port.network-association-owner",
    ownerPort: "example.port.network-associations",
  },
] as const;

type SlotSpecification = (typeof slotSpecifications)[number];

const configurationServiceType = serviceTypeSchema.parse(
  "example.owned-configuration",
);

const descriptors: OwnedConfigurationDescriptorSet = {
  kinds: slotSpecifications.map((specification) => ({
    id: specification.kindId,
    nodeServiceType: configurationServiceType,
    nodeResourceType: resourceTypeSchema.parse(
      specification.configurationResourceType,
    ),
    configurationSchemaId: configurationSchemaIdSchema.parse(
      specification.configurationSchemaId,
    ),
    configurationSchemaVersion: schemaVersion,
    allowedOwnership: ["user", "generated", "adopted"],
  })),
  slots: slotSpecifications.map((specification) => ({
    id: specification.slotId,
    ownerServiceType: serviceTypeSchema.parse(specification.ownerServiceType),
    ownerResourceType: resourceTypeSchema.parse(
      specification.ownerResourceType,
    ),
    relationshipType: relationshipTypeSchema.parse(
      specification.relationshipType,
    ),
    configurationEndpoint: "source",
    configurationPort: portTypeSchema.parse(specification.configurationPort),
    ownerPort: portTypeSchema.parse(specification.ownerPort),
    parentBinding: "required",
    configurationKindIds: [specification.kindId],
    cardinality: { minimum: 0, maximum: 16 },
  })),
};

async function representativeDocument(): Promise<ArchitectureDocument> {
  return parseArchitectureDocument(
    JSON.parse(
      await readFile(
        new URL(
          "../../test-fixtures/fixtures/architecture-document/v1/valid/representative.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown,
  );
}

function userLifecycle(): ElementLifecycle {
  return { ownership: "user", origin: "user" };
}

function generatedLifecycle(
  specification: SlotSpecification,
): ElementLifecycle {
  return {
    ownership: "generated",
    origin: "connection-rule",
    provenance: {
      generatorKind: "connection-rule",
      generatorId: generatorIdSchema.parse(
        "example.generator.network-owned-configuration",
      ),
      generatorVersion: schemaVersion,
      operationId: operationIdSchema.parse(
        `operation_generate_${specification.key}`,
      ),
      dependentNodeIds: [nodeIdSchema.parse(specification.ownerNodeId)],
      dependentEdgeIds: [],
    },
  };
}

function adoptedLifecycle(specification: SlotSpecification): ElementLifecycle {
  const generated = generatedLifecycle(specification);
  if (generated.ownership !== "generated") {
    throw new Error("Expected generated provenance for adoption.");
  }

  return {
    ownership: "adopted",
    origin: generated.origin,
    provenance: generated.provenance,
    adoptedBy,
    adoptedAt: generatedAt,
  };
}

function lifecycleFor(specification: SlotSpecification): ElementLifecycle {
  switch (specification.key) {
    case "association":
      return generatedLifecycle(specification);
    case "policy_rule":
      return adoptedLifecycle(specification);
    default:
      return userLifecycle();
  }
}

function ownerNode(
  specification: SlotSpecification,
  index: number,
): ArchitectureNode {
  return architectureNodeV1Schema.parse({
    id: specification.ownerNodeId,
    semantic: {
      deploymentKey: `${specification.key}_owner`,
      serviceType: specification.ownerServiceType,
      resourceType: specification.ownerResourceType,
      configuration: {
        schemaId: `example.owner.${specification.key.replaceAll("_", "-")}-config`,
        schemaVersion,
        values: {},
      },
      lifecycle: userLifecycle(),
    },
    presentation: {
      label: `${specification.key} owner`,
      position: { x: 500, y: 180 + index * 160 },
    },
  });
}

function configurationNode(
  specification: SlotSpecification,
  lifecycle: ElementLifecycle,
  index: number,
): ArchitectureNode {
  return architectureNodeV1Schema.parse({
    id: specification.configurationNodeId,
    semantic: {
      deploymentKey: `${specification.key}_configuration`,
      serviceType: configurationServiceType,
      resourceType: specification.configurationResourceType,
      configuration: {
        schemaId: specification.configurationSchemaId,
        schemaVersion,
        values: {
          description: {
            kind: "string",
            value: `${specification.key} configuration`,
          },
        },
      },
      parent: {
        nodeId: specification.ownerNodeId,
        relationshipType: specification.relationshipType,
      },
      lifecycle,
    },
    presentation: {
      label: `${specification.key} configuration`,
      position: { x: 760, y: 180 + index * 160 },
    },
  });
}

function bindingEdge(
  specification: SlotSpecification,
  lifecycle: ElementLifecycle,
): ArchitectureEdge {
  return architectureEdgeV1Schema.parse({
    id: specification.bindingEdgeId,
    semantic: {
      source: {
        nodeId: specification.configurationNodeId,
        port: specification.configurationPort,
      },
      target: {
        nodeId: specification.ownerNodeId,
        port: specification.ownerPort,
      },
      relationshipType: specification.relationshipType,
      configuration: {
        schemaId: `example.relationship.${specification.key.replaceAll("_", "-")}-config`,
        schemaVersion,
        values: {},
      },
      lifecycle,
    },
  });
}

async function networkingDocument(): Promise<ArchitectureDocument> {
  const base = await representativeDocument();
  const owners: ArchitectureNode[] = [];
  const configurations: ArchitectureNode[] = [];
  const bindings: ArchitectureEdge[] = [];

  slotSpecifications.forEach((specification, index) => {
    const lifecycle = lifecycleFor(specification);
    owners.push(ownerNode(specification, index));
    configurations.push(configurationNode(specification, lifecycle, index));
    bindings.push(bindingEdge(specification, lifecycle));
  });

  return parseArchitectureDocument({
    ...base,
    nodes: [...base.nodes, ...owners, ...configurations],
    edges: [...base.edges, ...bindings],
  });
}

function requireSuccess(
  result: ReturnType<typeof classifyOwnedConfigurationNodes>,
) {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error("Expected owned-configuration classification to succeed.");
  }
  return result;
}

function expectClassificationIssue(
  result: ReturnType<typeof classifyOwnedConfigurationNodes>,
  code: OwnedConfigurationClassificationIssueCode,
): void {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error(`Expected classification issue ${code}.`);
  }
  expect(result.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code })]),
  );
}

function commandEnvelope(document: ArchitectureDocument, commandId: string) {
  return {
    schemaVersion: 1 as const,
    commandId,
    inverseCommandId: `${commandId}_inverse`,
    origin: "user" as const,
    target: {
      documentId: document.documentId,
      architectureId: document.architectureId,
      revisionId: document.revision.revisionId,
    },
  };
}

function expectApplicationIssue(
  action: () => unknown,
  code: GraphCommandApplicationError["issues"][number]["code"],
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(GraphCommandApplicationError);
    expect((error as GraphCommandApplicationError).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
    return;
  }
  throw new Error(`Expected graph command issue ${code}.`);
}

function specification(key: SlotSpecification["key"]): SlotSpecification {
  const match = slotSpecifications.find((entry) => entry.key === key);
  if (match === undefined) {
    throw new Error(`Missing slot specification ${key}.`);
  }
  return match;
}

describe("provider-neutral networking owned configurations", () => {
  it("classifies route, association, policy-rule, and workload-network slots with exact ownership facts", async () => {
    const document = await networkingDocument();
    const classified = requireSuccess(
      classifyOwnedConfigurationNodes(document, descriptors),
    );

    expect(classified.instances).toHaveLength(slotSpecifications.length);
    const instanceByKind = new Map(
      classified.instances.map((instance) => [instance.kindId, instance]),
    );

    slotSpecifications.forEach((entry) => {
      const instance = instanceByKind.get(entry.kindId);
      expect(instance).toMatchObject({
        configurationNodeId: entry.configurationNodeId,
        bindingEdgeId: entry.bindingEdgeId,
        ownerNodeId: entry.ownerNodeId,
        kindId: entry.kindId,
        slotId: entry.slotId,
        node: {
          parent: {
            nodeId: entry.ownerNodeId,
            relationshipType: entry.relationshipType,
          },
        },
        binding: {
          source: {
            nodeId: entry.configurationNodeId,
            port: entry.configurationPort,
          },
          target: {
            nodeId: entry.ownerNodeId,
            port: entry.ownerPort,
          },
        },
      });
    });

    expect(instanceByKind.get(specification("route").kindId)?.ownership).toBe(
      "user",
    );
    expect(
      instanceByKind.get(specification("association").kindId)?.node.lifecycle,
    ).toMatchObject({
      ownership: "generated",
      origin: "connection-rule",
      provenance: { operationId: "operation_generate_association" },
    });
    expect(
      instanceByKind.get(specification("policy_rule").kindId)?.node.lifecycle,
    ).toMatchObject({
      ownership: "adopted",
      origin: "connection-rule",
      adoptedBy,
      provenance: { operationId: "operation_generate_policy_rule" },
    });
    expect(
      instanceByKind.get(specification("policy_rule").kindId)?.node.lifecycle,
    ).not.toHaveProperty("adoptedAt");
    expect(
      instanceByKind.get(specification("workload_network").kindId)?.ownership,
    ).toBe("user");
  });

  it("fails closed for wrong owners, absent or reversed bindings, and parent disagreement", async () => {
    const document = await networkingDocument();
    const association = specification("association");
    const route = specification("route");
    const policyRule = specification("policy_rule");

    const wrongOwner = parseArchitectureDocument({
      ...document,
      edges: document.edges.map((edge) =>
        edge.id === association.bindingEdgeId
          ? {
              ...edge,
              semantic: {
                ...edge.semantic,
                target: {
                  ...edge.semantic.target,
                  nodeId: route.ownerNodeId,
                },
              },
            }
          : edge,
      ),
    });
    expectClassificationIssue(
      classifyOwnedConfigurationNodes(wrongOwner, descriptors),
      "owner_kind_mismatch",
    );

    const missingBinding = parseArchitectureDocument({
      ...document,
      edges: document.edges.filter(
        (edge) => edge.id !== association.bindingEdgeId,
      ),
    });
    expectClassificationIssue(
      classifyOwnedConfigurationNodes(missingBinding, descriptors),
      "missing_binding",
    );

    const reversedBinding = parseArchitectureDocument({
      ...document,
      edges: document.edges.map((edge) =>
        edge.id === route.bindingEdgeId
          ? {
              ...edge,
              semantic: {
                ...edge.semantic,
                source: edge.semantic.target,
                target: edge.semantic.source,
              },
            }
          : edge,
      ),
    });
    expectClassificationIssue(
      classifyOwnedConfigurationNodes(reversedBinding, descriptors),
      "missing_binding",
    );

    const mismatchedParent = parseArchitectureDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === policyRule.configurationNodeId
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                parent: {
                  nodeId: route.ownerNodeId,
                  relationshipType: policyRule.relationshipType,
                },
              },
            }
          : node,
      ),
    });
    expectClassificationIssue(
      classifyOwnedConfigurationNodes(mismatchedParent, descriptors),
      "parent_binding_mismatch",
    );
  });

  it("requires exact adoption before generated configuration customization", async () => {
    const document = await networkingDocument();
    const association = specification("association");
    const configuration = document.nodes.find(
      (node) => node.id === association.configurationNodeId,
    );
    const binding = document.edges.find(
      (edge) => edge.id === association.bindingEdgeId,
    );
    if (
      configuration?.semantic.lifecycle.ownership !== "generated" ||
      binding?.semantic.lifecycle.ownership !== "generated"
    ) {
      throw new Error("Expected generated association node and binding.");
    }

    const customizedConfiguration = {
      ...configuration.semantic.configuration,
      values: {
        ...configuration.semantic.configuration.values,
        description: { kind: "string" as const, value: "customized" },
      },
    };
    expectApplicationIssue(
      () =>
        applyGraphCommand(document, {
          ...commandEnvelope(document, "operation_customize_association"),
          kind: "update-node-configuration",
          nodeId: configuration.id,
          expectedConfiguration: configuration.semantic.configuration,
          configuration: customizedConfiguration,
        }),
      "generated_resource_requires_adoption",
    );

    const staleLifecycle = {
      ...configuration.semantic.lifecycle,
      provenance: {
        ...configuration.semantic.lifecycle.provenance,
        operationId: operationIdSchema.parse(
          "operation_stale_association_generation",
        ),
      },
    };
    expectApplicationIssue(
      () =>
        applyGraphCommand(document, {
          ...commandEnvelope(document, "operation_adopt_stale_association"),
          kind: "adopt-generated-resource",
          resource: { kind: "node", nodeId: configuration.id },
          expectedLifecycle: staleLifecycle,
          adoptedBy,
          adoptedAt: generatedAt,
        }),
      "precondition_failed",
    );

    const adoptedNode = applyGraphCommand(document, {
      ...commandEnvelope(document, "operation_adopt_association_node"),
      kind: "adopt-generated-resource",
      resource: { kind: "node", nodeId: configuration.id },
      expectedLifecycle: configuration.semantic.lifecycle,
      adoptedBy,
      adoptedAt: generatedAt,
    });
    expectClassificationIssue(
      classifyOwnedConfigurationNodes(adoptedNode.document, descriptors),
      "lifecycle_mismatch",
    );

    expectApplicationIssue(
      () =>
        applyGraphCommand(adoptedNode.document, {
          ...commandEnvelope(
            adoptedNode.document,
            "operation_readopt_association_node",
          ),
          kind: "adopt-generated-resource",
          resource: { kind: "node", nodeId: configuration.id },
          expectedLifecycle: configuration.semantic.lifecycle,
          adoptedBy,
          adoptedAt: generatedAt,
        }),
      "resource_not_generated",
    );

    const adoptedBinding = applyGraphCommand(adoptedNode.document, {
      ...commandEnvelope(
        adoptedNode.document,
        "operation_adopt_association_binding",
      ),
      kind: "adopt-generated-resource",
      resource: { kind: "edge", edgeId: binding.id },
      expectedLifecycle: binding.semantic.lifecycle,
      adoptedBy,
      adoptedAt: generatedAt,
    });
    const classified = requireSuccess(
      classifyOwnedConfigurationNodes(adoptedBinding.document, descriptors),
    );
    expect(
      classified.instances.find(
        (instance) => instance.kindId === association.kindId,
      )?.ownership,
    ).toBe("adopted");

    const customized = applyGraphCommand(adoptedBinding.document, {
      ...commandEnvelope(
        adoptedBinding.document,
        "operation_customize_adopted_association",
      ),
      kind: "update-node-configuration",
      nodeId: configuration.id,
      expectedConfiguration: configuration.semantic.configuration,
      configuration: customizedConfiguration,
    });
    expect(
      customized.document.nodes.find((node) => node.id === configuration.id)
        ?.semantic.configuration,
    ).toEqual(customizedConfiguration);
  });
});
