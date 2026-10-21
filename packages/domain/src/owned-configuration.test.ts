import { readFile } from "node:fs/promises";

import {
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
  serializeCanonicalJson,
  serviceTypeSchema,
  type ElementLifecycle,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  GraphCommandApplicationError,
  applyGraphCommand,
  classifyOwnedConfigurationNodes,
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
  type ArchitectureDocument,
  type ArchitectureEdge,
  type ArchitectureNode,
  type OwnedConfigurationDescriptorSet,
} from "./index.js";

const ownerNodeId = nodeIdSchema.parse("node_owned_configuration_owner");
const ownedKindId = "example.owned-configuration.identity-policy";
const ownedSlotId = "example.slot.inline-policies";
const ownershipRelationship = relationshipTypeSchema.parse(
  "example.relationship.owns-policy",
);
const configurationServiceType = serviceTypeSchema.parse(
  "example.configuration",
);
const configurationResourceType = resourceTypeSchema.parse(
  "example.configuration.identity-policy",
);
const configurationSchemaId = configurationSchemaIdSchema.parse(
  "example.configuration.identity-policy-config",
);
const configurationSchemaVersion = semanticVersionSchema.parse("1.0.0");
const ownerServiceType = serviceTypeSchema.parse("example.identity");
const ownerResourceType = resourceTypeSchema.parse("example.identity.role");
const configurationPort = portTypeSchema.parse("example.port.policy-owner");
const ownerPort = portTypeSchema.parse("example.port.inline-policies");

const descriptors: OwnedConfigurationDescriptorSet = {
  kinds: [
    {
      id: ownedKindId,
      nodeServiceType: configurationServiceType,
      nodeResourceType: configurationResourceType,
      configurationSchemaId,
      configurationSchemaVersion,
      allowedOwnership: ["user", "generated", "adopted"],
    },
  ],
  slots: [
    {
      id: ownedSlotId,
      ownerServiceType,
      ownerResourceType,
      relationshipType: ownershipRelationship,
      configurationEndpoint: "source",
      configurationPort,
      ownerPort,
      parentBinding: "required",
      configurationKindIds: [ownedKindId],
      cardinality: { minimum: 0, maximum: 8 },
    },
  ],
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

function generatedLifecycle(operationId: string): ElementLifecycle {
  return {
    ownership: "generated",
    origin: "connection-rule",
    provenance: {
      generatorKind: "connection-rule",
      generatorId: generatorIdSchema.parse("example.generator.owned-policy"),
      generatorVersion: configurationSchemaVersion,
      operationId: operationIdSchema.parse(operationId),
      dependentNodeIds: [ownerNodeId],
      dependentEdgeIds: [],
    },
  };
}

function ownerNode(): ArchitectureNode {
  return architectureNodeV1Schema.parse({
    id: ownerNodeId,
    semantic: {
      deploymentKey: "owned_configuration_owner",
      serviceType: ownerServiceType,
      resourceType: ownerResourceType,
      configuration: {
        schemaId: "example.identity.role-config",
        schemaVersion: configurationSchemaVersion,
        values: {},
      },
      lifecycle: userLifecycle(),
    },
    presentation: {
      label: "Execution role",
      position: { x: 500, y: 240 },
    },
  });
}

function configurationNode(
  id: string,
  policyName: string,
  lifecycle: ElementLifecycle,
): ArchitectureNode {
  return architectureNodeV1Schema.parse({
    id,
    semantic: {
      deploymentKey: policyName.toLowerCase(),
      serviceType: configurationServiceType,
      resourceType: configurationResourceType,
      configuration: {
        schemaId: configurationSchemaId,
        schemaVersion: configurationSchemaVersion,
        values: {
          policyName: { kind: "string", value: policyName },
          ownerReference: {
            kind: "node-reference",
            nodeId: ownerNodeId,
            attribute: "example.identity.role-id",
          },
        },
      },
      parent: {
        nodeId: ownerNodeId,
        relationshipType: ownershipRelationship,
      },
      lifecycle,
    },
    presentation: {
      label: policyName,
      position: { x: 640, y: 320 },
    },
  });
}

function bindingEdge(
  id: string,
  configurationNodeId: ArchitectureNode["id"],
  lifecycle: ElementLifecycle,
): ArchitectureEdge {
  return architectureEdgeV1Schema.parse({
    id,
    semantic: {
      source: {
        nodeId: configurationNodeId,
        port: configurationPort,
      },
      target: {
        nodeId: ownerNodeId,
        port: ownerPort,
      },
      relationshipType: ownershipRelationship,
      configuration: {
        schemaId: "example.relationship.owns-policy-config",
        schemaVersion: "1.0.0",
        values: {},
      },
      lifecycle,
    },
  });
}

async function documentWithOwnedConfigurations(): Promise<ArchitectureDocument> {
  const base = await representativeDocument();
  const userPolicy = configurationNode(
    "node_owned_policy_z",
    "UserPolicy",
    userLifecycle(),
  );
  const generatedPolicyLifecycle = generatedLifecycle(
    "operation_generated_owned_policy",
  );
  const generatedPolicy = configurationNode(
    "node_owned_policy_a",
    "GeneratedPolicy",
    generatedPolicyLifecycle,
  );

  return parseArchitectureDocument({
    ...base,
    nodes: [...base.nodes, ownerNode(), userPolicy, generatedPolicy],
    edges: [
      ...base.edges,
      bindingEdge("edge_owned_policy_z", userPolicy.id, userLifecycle()),
      bindingEdge(
        "edge_owned_policy_a",
        generatedPolicy.id,
        generatedPolicyLifecycle,
      ),
    ],
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

describe("graph-backed owned configurations", () => {
  it("preserves stable graph identities and deterministically separates generated and user lifecycles", async () => {
    const document = await documentWithOwnedConfigurations();
    const classified = requireSuccess(
      classifyOwnedConfigurationNodes(document, descriptors),
    );

    expect(
      classified.instances.map((instance) => ({
        configurationNodeId: instance.configurationNodeId,
        bindingEdgeId: instance.bindingEdgeId,
        ownerNodeId: instance.ownerNodeId,
        ownership: instance.ownership,
      })),
    ).toEqual([
      {
        configurationNodeId: "node_owned_policy_a",
        bindingEdgeId: "edge_owned_policy_a",
        ownerNodeId,
        ownership: "generated",
      },
      {
        configurationNodeId: "node_owned_policy_z",
        bindingEdgeId: "edge_owned_policy_z",
        ownerNodeId,
        ownership: "user",
      },
    ]);
    const generatedInstance = classified.instances[0];
    expect(generatedInstance?.node.lifecycle.ownership).toBe("generated");
    if (generatedInstance?.node.lifecycle.ownership !== "generated") {
      throw new Error("Expected generated lifecycle provenance.");
    }
    expect(generatedInstance.node.lifecycle.provenance.operationId).toBe(
      "operation_generated_owned_policy",
    );
    expect(classified.instances[1]?.node.lifecycle).toEqual({
      ownership: "user",
      origin: "user",
    });
    expect(Object.isFrozen(classified.instances)).toBe(true);
    expect(Object.isFrozen(classified.instances[0]?.node)).toBe(true);

    const reordered = parseArchitectureDocument({
      ...document,
      nodes: [...document.nodes].reverse(),
      edges: [...document.edges].reverse(),
    });
    const reorderedClassification = requireSuccess(
      classifyOwnedConfigurationNodes(reordered, {
        kinds: [...descriptors.kinds].reverse(),
        slots: [...descriptors.slots].reverse(),
      }),
    );

    expect(serializeCanonicalJson(reorderedClassification.instances)).toBe(
      serializeCanonicalJson(classified.instances),
    );
  });

  it("fails closed for lifecycle, exact owner-slot, and cardinality violations", async () => {
    const document = await documentWithOwnedConfigurations();
    const lifecycleMismatch = parseArchitectureDocument({
      ...document,
      edges: document.edges.map((edge) =>
        edge.id === "edge_owned_policy_a"
          ? {
              ...edge,
              semantic: { ...edge.semantic, lifecycle: userLifecycle() },
            }
          : edge,
      ),
    });
    const lifecycleResult = classifyOwnedConfigurationNodes(
      lifecycleMismatch,
      descriptors,
    );
    expect(lifecycleResult).toEqual({
      success: false,
      issues: [expect.objectContaining({ code: "lifecycle_mismatch" })],
    });

    const wrongOwner = parseArchitectureDocument({
      ...document,
      edges: document.edges.map((edge) =>
        edge.id === "edge_owned_policy_z"
          ? {
              ...edge,
              semantic: {
                ...edge.semantic,
                target: {
                  ...edge.semantic.target,
                  nodeId: "node_application",
                },
              },
            }
          : edge,
      ),
    });
    const wrongOwnerResult = classifyOwnedConfigurationNodes(
      wrongOwner,
      descriptors,
    );
    expect(wrongOwnerResult.success).toBe(false);
    if (!wrongOwnerResult.success) {
      expect(wrongOwnerResult.issues.map((entry) => entry.code)).toContain(
        "owner_kind_mismatch",
      );
    }

    const constrainedDescriptors: OwnedConfigurationDescriptorSet = {
      ...descriptors,
      slots: descriptors.slots.map((slot) => ({
        ...slot,
        cardinality: { minimum: 0, maximum: 1 },
      })),
    };
    const cardinalityResult = classifyOwnedConfigurationNodes(
      document,
      constrainedDescriptors,
    );
    expect(cardinalityResult).toEqual({
      success: false,
      issues: [expect.objectContaining({ code: "cardinality_above_maximum" })],
    });
  });

  it("uses existing graph references to block deletion of an owner with attached configurations", async () => {
    const document = await documentWithOwnedConfigurations();
    const owner = document.nodes.find((node) => node.id === ownerNodeId);
    if (owner === undefined) {
      throw new Error("Expected the owned-configuration owner node.");
    }

    expect.assertions(3);
    try {
      applyGraphCommand(document, {
        schemaVersion: 1,
        commandId: "operation_remove_owned_configuration_owner",
        inverseCommandId: "operation_restore_owned_configuration_owner",
        origin: "user",
        target: {
          documentId: document.documentId,
          architectureId: document.architectureId,
          revisionId: document.revision.revisionId,
        },
        kind: "remove-node",
        nodeId: owner.id,
        expectedNode: owner,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(GraphCommandApplicationError);
      const applicationError = error as GraphCommandApplicationError;
      expect(applicationError.issues.map((entry) => entry.code)).toContain(
        "resource_has_dependents",
      );
      expect(document.nodes.some((node) => node.id === ownerNodeId)).toBe(true);
      return;
    }
    throw new Error("Expected owner deletion to fail closed.");
  });

  it("keeps presentation out of owned-configuration facts and deployment semantics out of the visual hash", async () => {
    const document = await documentWithOwnedConfigurations();
    const originalClassification = requireSuccess(
      classifyOwnedConfigurationNodes(document, descriptors),
    );
    const originalHashes = getArchitectureDocumentHashes(document);

    const presentationChanged = parseArchitectureDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === "node_owned_policy_a"
          ? {
              ...node,
              presentation: {
                label: "Relabeled without semantic effect",
                position: { x: -800, y: 1600 },
              },
            }
          : node,
      ),
    });
    const presentationClassification = requireSuccess(
      classifyOwnedConfigurationNodes(presentationChanged, descriptors),
    );
    const presentationHashes =
      getArchitectureDocumentHashes(presentationChanged);

    expect(serializeCanonicalJson(presentationClassification.instances)).toBe(
      serializeCanonicalJson(originalClassification.instances),
    );
    expect(presentationHashes.contentHash).toBe(originalHashes.contentHash);
    expect(presentationHashes.visualHash).not.toBe(originalHashes.visualHash);

    const semanticChanged = parseArchitectureDocument({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === "node_owned_policy_a"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    policyName: {
                      kind: "string" as const,
                      value: "ChangedGeneratedPolicy",
                    },
                  },
                },
              },
            }
          : node,
      ),
    });
    const semanticHashes = getArchitectureDocumentHashes(semanticChanged);

    expect(semanticHashes.contentHash).not.toBe(originalHashes.contentHash);
    expect(semanticHashes.visualHash).toBe(originalHashes.visualHash);
  });
});
