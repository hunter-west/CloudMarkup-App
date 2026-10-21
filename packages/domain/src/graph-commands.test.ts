import { readFile } from "node:fs/promises";

import {
  configurationKeySchema,
  parseGraphCommandV1,
  parseArchitectureDocumentV1Json,
  serializeArchitectureDocumentV3,
  type ArchitectureDocumentV1,
  type ArchitectureEdgeV1,
  type ArchitectureNodeV1,
  type ConfigurationValue,
  type GraphCommandV1,
  type VersionedArchitectureDocument,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  GraphCommandApplicationError,
  applyGraphCommand,
  getArchitectureSemanticProjection,
  parseArchitectureDocument,
} from "./index.js";

async function representativeDocument(): Promise<ArchitectureDocumentV1> {
  return parseArchitectureDocumentV1Json(
    await readFile(
      new URL(
        "../../test-fixtures/fixtures/architecture-document/v1/valid/representative.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

function serializeArchitectureDocumentV1(
  document: VersionedArchitectureDocument,
): string {
  return serializeArchitectureDocumentV3(parseArchitectureDocument(document));
}

function targetOf(document: VersionedArchitectureDocument) {
  return {
    documentId: document.documentId,
    architectureId: document.architectureId,
    revisionId: document.revision.revisionId,
  };
}

function commandEnvelope(
  document: VersionedArchitectureDocument,
  id: string,
  inverseId = `${id}_inverse`,
) {
  return {
    schemaVersion: 1 as const,
    commandId: id,
    inverseCommandId: inverseId,
    origin: "user" as const,
    target: targetOf(document),
  };
}

function userNode(id: string, deploymentKey: string): ArchitectureNodeV1 {
  return {
    id: id as ArchitectureNodeV1["id"],
    semantic: {
      deploymentKey:
        deploymentKey as ArchitectureNodeV1["semantic"]["deploymentKey"],
      serviceType:
        "example.compute" as ArchitectureNodeV1["semantic"]["serviceType"],
      resourceType:
        "example.compute.worker" as ArchitectureNodeV1["semantic"]["resourceType"],
      configuration: {
        schemaId:
          "example.compute.worker-config" as ArchitectureNodeV1["semantic"]["configuration"]["schemaId"],
        schemaVersion:
          "1.0.0" as ArchitectureNodeV1["semantic"]["configuration"]["schemaVersion"],
        values: {},
      },
      lifecycle: {
        ownership: "user",
        origin: "user",
      },
    },
    presentation: {
      label: "Worker",
      position: { x: 400, y: 240 },
    },
  };
}

function generatedNode(
  id: string,
  deploymentKey: string,
  dependentNodeId: ArchitectureNodeV1["id"],
): ArchitectureNodeV1 {
  const node = userNode(id, deploymentKey);
  return {
    ...node,
    semantic: {
      ...node.semantic,
      lifecycle: {
        ownership: "generated",
        origin: "connection-rule",
        provenance: {
          generatorKind: "connection-rule",
          generatorId: "example.generator.support" as Extract<
            ArchitectureNodeV1["semantic"]["lifecycle"],
            { ownership: "generated" }
          >["provenance"]["generatorId"],
          generatorVersion: "1.0.0" as Extract<
            ArchitectureNodeV1["semantic"]["lifecycle"],
            { ownership: "generated" }
          >["provenance"]["generatorVersion"],
          operationId: "operation_generator" as Extract<
            ArchitectureNodeV1["semantic"]["lifecycle"],
            { ownership: "generated" }
          >["provenance"]["operationId"],
          dependentNodeIds: [dependentNodeId],
          dependentEdgeIds: [],
        },
      },
    },
  };
}

function userEdge(id: string): ArchitectureEdgeV1 {
  return {
    id: id as ArchitectureEdgeV1["id"],
    semantic: {
      source: {
        nodeId:
          "node_application" as ArchitectureEdgeV1["semantic"]["source"]["nodeId"],
        port: "example.port.output" as ArchitectureEdgeV1["semantic"]["source"]["port"],
      },
      target: {
        nodeId:
          "node_network" as ArchitectureEdgeV1["semantic"]["target"]["nodeId"],
        port: "example.port.input" as ArchitectureEdgeV1["semantic"]["target"]["port"],
      },
      relationshipType:
        "example.relationship.observes" as ArchitectureEdgeV1["semantic"]["relationshipType"],
      configuration: {
        schemaId:
          "example.relationship.observes-config" as ArchitectureEdgeV1["semantic"]["configuration"]["schemaId"],
        schemaVersion:
          "1.0.0" as ArchitectureEdgeV1["semantic"]["configuration"]["schemaVersion"],
        values: {},
      },
      lifecycle: {
        ownership: "user",
        origin: "user",
      },
    },
  };
}

function expectAvailable(
  inversion: ReturnType<typeof applyGraphCommand>["inversion"],
): GraphCommandV1 {
  expect(inversion.kind).toBe("available");
  if (inversion.kind !== "available") {
    throw new Error("Expected an available inverse.");
  }
  return inversion.command;
}

function expectApplicationIssue(
  action: () => unknown,
  code: GraphCommandApplicationError["issues"][number]["code"],
): GraphCommandApplicationError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(GraphCommandApplicationError);
    const applicationError = error as GraphCommandApplicationError;
    expect(applicationError.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
    return applicationError;
  }
  throw new Error("Expected graph command application to fail.");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach((entry) => {
      deepFreeze(entry);
    });
  }
  return value;
}

function expectUndoRedoRoundTrip(
  original: VersionedArchitectureDocument,
  command: unknown,
): void {
  const applied = applyGraphCommand(original, command);
  const inverse = expectAvailable(applied.inversion);
  const undone = applyGraphCommand(applied.document, inverse);
  expect(serializeArchitectureDocumentV1(undone.document)).toBe(
    serializeArchitectureDocumentV1(original),
  );

  const redo = expectAvailable(undone.inversion);
  const redone = applyGraphCommand(undone.document, redo);
  expect(serializeArchitectureDocumentV1(redone.document)).toBe(
    serializeArchitectureDocumentV1(applied.document),
  );
}

describe("Graph command application", () => {
  it("adds and removes a node without mutating input or changing stable identity", async () => {
    const document = deepFreeze(await representativeDocument());
    const node = userNode("node_worker", "worker");
    const command = {
      ...commandEnvelope(document, "operation_add_worker"),
      kind: "add-node",
      node,
    };

    const result = applyGraphCommand(document, command);

    expect(result.document).not.toBe(document);
    expect(document.nodes.some((item) => item.id === node.id)).toBe(false);
    expect(result.document.nodes.at(-1)?.id).toBe(node.id);
    expect(result.document.nodes.at(-1)?.semantic.deploymentKey).toBe("worker");
    expect(result.changes).toEqual([
      {
        kind: "node-added",
        commandId: "operation_add_worker",
        nodeId: "node_worker",
      },
    ]);
    expectUndoRedoRoundTrip(document, command);
  });

  it("does not treat a removed node's own configuration as an external dependent", async () => {
    const document = await representativeDocument();
    const node = userNode("node_self_configured", "self_configured");
    const selfKey = configurationKeySchema.parse("self");
    node.semantic.configuration.values[selfKey] = {
      kind: "node-reference",
      nodeId: node.id,
      attribute: "example.resource.id" as Extract<
        ConfigurationValue,
        { kind: "node-reference" }
      >["attribute"],
    };
    const command = {
      ...commandEnvelope(document, "operation_add_self_configured"),
      kind: "add-node",
      node,
    };

    expectUndoRedoRoundTrip(document, command);
  });

  it("updates node configuration and visual position with safe undo/redo", async () => {
    const document = await representativeDocument();
    const network = document.nodes.find((node) => node.id === "node_network");
    if (network === undefined) {
      throw new Error("Representative fixture must contain the network node.");
    }
    const configuration = {
      ...network.semantic.configuration,
      values: {
        ...network.semantic.configuration.values,
        addressRange: { kind: "string" as const, value: "10.1.0.0/16" },
      },
    };
    const update = {
      ...commandEnvelope(document, "operation_update_network"),
      kind: "update-node-configuration",
      nodeId: network.id,
      expectedConfiguration: network.semantic.configuration,
      configuration,
    };
    const move = {
      ...commandEnvelope(document, "operation_move_network"),
      kind: "move-node",
      nodeId: network.id,
      expectedPosition: network.presentation.position,
      position: { x: 180, y: 140 },
    };

    expectUndoRedoRoundTrip(document, update);
    expectUndoRedoRoundTrip(document, move);

    const moved = applyGraphCommand(document, move).document;
    expect(getArchitectureSemanticProjection(moved)).toEqual(
      getArchitectureSemanticProjection(parseArchitectureDocument(document)),
    );
  });

  it("reparents safely and rejects missing parents, self-parenting, and cycles", async () => {
    const document = await representativeDocument();
    const network = document.nodes.find((node) => node.id === "node_network");
    if (network === undefined) {
      throw new Error("Representative fixture must contain the network node.");
    }
    const worker = userNode("node_worker", "worker");
    const added = applyGraphCommand(document, {
      ...commandEnvelope(document, "operation_add_reparent_worker"),
      kind: "add-node",
      node: worker,
    }).document;
    const parent = {
      nodeId: network.id,
      relationshipType: "example.relationship.contained-by" as NonNullable<
        ArchitectureNodeV1["semantic"]["parent"]
      >["relationshipType"],
    };
    const reparent = {
      ...commandEnvelope(added, "operation_reparent_worker"),
      kind: "reparent-node",
      nodeId: worker.id,
      expectedParent: null,
      parent,
    };

    expectUndoRedoRoundTrip(added, reparent);

    const missingParent = {
      ...reparent,
      commandId: "operation_reparent_missing",
      inverseCommandId: "operation_reparent_missing_inverse",
      parent: { ...parent, nodeId: "node_missing" },
    };
    const missingError = expectApplicationIssue(
      () => applyGraphCommand(added, missingParent),
      "semantic_invariant_violation",
    );
    expect(missingError.issues[0]).toEqual(
      expect.objectContaining({ semanticCode: "broken_parent_reference" }),
    );

    const selfParent = {
      ...reparent,
      commandId: "operation_reparent_self",
      inverseCommandId: "operation_reparent_self_inverse",
      nodeId: network.id,
      parent: { ...parent, nodeId: network.id },
    };
    expectApplicationIssue(
      () => applyGraphCommand(document, selfParent),
      "semantic_invariant_violation",
    );

    const cycle = {
      ...reparent,
      commandId: "operation_reparent_cycle",
      inverseCommandId: "operation_reparent_cycle_inverse",
      nodeId: network.id,
      parent: { ...parent, nodeId: "node_application" },
    };
    const cycleError = expectApplicationIssue(
      () => applyGraphCommand(document, cycle),
      "semantic_invariant_violation",
    );
    expect(cycleError.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ semanticCode: "parent_cycle" }),
      ]),
    );
  });

  it("rolls back an accompanying move when an atomic reparent would create a cycle", async () => {
    const document = deepFreeze(await representativeDocument());
    const network = document.nodes.find((node) => node.id === "node_network");
    const application = document.nodes.find(
      (node) => node.id === "node_application",
    );
    if (network === undefined || application === undefined) {
      throw new Error("Representative fixture must contain both nodes.");
    }
    const before = serializeArchitectureDocumentV1(document);
    const batch = {
      ...commandEnvelope(document, "operation_cycle_placement_batch"),
      kind: "batch",
      commands: [
        {
          ...commandEnvelope(document, "operation_cycle_placement_move"),
          kind: "move-node",
          nodeId: network.id,
          expectedPosition: network.presentation.position,
          position: { x: 320, y: 180 },
        },
        {
          ...commandEnvelope(document, "operation_cycle_placement_reparent"),
          kind: "reparent-node",
          nodeId: network.id,
          expectedParent: null,
          parent: {
            nodeId: application.id,
            relationshipType:
              "example.relationship.contained-by" as NonNullable<
                ArchitectureNodeV1["semantic"]["parent"]
              >["relationshipType"],
          },
        },
      ],
    };

    const error = expectApplicationIssue(
      () => applyGraphCommand(document, batch),
      "semantic_invariant_violation",
    );

    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ semanticCode: "parent_cycle" }),
      ]),
    );
    expect(serializeArchitectureDocumentV1(document)).toBe(before);
    expect(network.presentation.position).toEqual({ x: 80, y: 40 });
  });

  it("rolls back an accompanying move when an atomic reparent has a stale parent precondition", async () => {
    const document = await representativeDocument();
    const network = document.nodes.find((node) => node.id === "node_network");
    const application = document.nodes.find(
      (node) => node.id === "node_application",
    );
    if (network === undefined || application === undefined) {
      throw new Error("Representative fixture must contain both nodes.");
    }
    const worker = userNode("node_stale_parent_worker", "stale_parent_worker");
    const added = deepFreeze(
      applyGraphCommand(document, {
        ...commandEnvelope(document, "operation_add_stale_parent_worker"),
        kind: "add-node",
        node: worker,
      }).document,
    );
    const before = serializeArchitectureDocumentV1(added);
    const batch = {
      ...commandEnvelope(added, "operation_stale_placement_batch"),
      kind: "batch",
      commands: [
        {
          ...commandEnvelope(added, "operation_stale_placement_move"),
          kind: "move-node",
          nodeId: worker.id,
          expectedPosition: worker.presentation.position,
          position: { x: 144, y: 96 },
        },
        {
          ...commandEnvelope(added, "operation_stale_placement_reparent"),
          kind: "reparent-node",
          nodeId: worker.id,
          expectedParent: {
            nodeId: application.id,
            relationshipType:
              "example.relationship.contained-by" as NonNullable<
                ArchitectureNodeV1["semantic"]["parent"]
              >["relationshipType"],
          },
          parent: {
            nodeId: network.id,
            relationshipType:
              "example.relationship.contained-by" as NonNullable<
                ArchitectureNodeV1["semantic"]["parent"]
              >["relationshipType"],
          },
        },
      ],
    };

    const error = expectApplicationIssue(
      () => applyGraphCommand(added, batch),
      "precondition_failed",
    );

    expect(error.issues[0]?.path).toContain("$.commands[1].expectedParent");
    expect(serializeArchitectureDocumentV1(added)).toBe(before);
    expect(
      added.nodes.find((node) => node.id === worker.id)?.presentation.position,
    ).toEqual({ x: 400, y: 240 });
  });

  it("moves a boundary parent without rewriting its parent-relative child record", async () => {
    const document = deepFreeze(await representativeDocument());
    const network = document.nodes.find((node) => node.id === "node_network");
    const application = document.nodes.find(
      (node) => node.id === "node_application",
    );
    if (network === undefined || application === undefined) {
      throw new Error("Representative fixture must contain both nodes.");
    }
    const childBefore = structuredClone(application);

    const moved = applyGraphCommand(document, {
      ...commandEnvelope(document, "operation_move_boundary_parent"),
      kind: "move-node",
      nodeId: network.id,
      expectedPosition: network.presentation.position,
      position: { x: 208, y: 152 },
    }).document;
    const childAfter = moved.nodes.find((node) => node.id === application.id);
    if (childAfter === undefined) {
      throw new Error("Moved document must retain the contained child.");
    }

    expect(childAfter).toEqual(childBefore);
    expect(childAfter.semantic.parent?.nodeId).toBe(network.id);
    expect(childAfter.presentation.position).toEqual({ x: 220, y: 140 });
  });

  it("adds, updates, and removes edges with exact snapshot preconditions", async () => {
    const document = await representativeDocument();
    const edge = userEdge("edge_observer");
    const add = {
      ...commandEnvelope(document, "operation_add_observer"),
      kind: "add-edge",
      edge,
    };
    const added = applyGraphCommand(document, add).document;
    const configuration = {
      ...edge.semantic.configuration,
      values: {
        mode: { kind: "string" as const, value: "sampled" },
      },
    };
    const update = {
      ...commandEnvelope(added, "operation_update_observer"),
      kind: "update-edge-configuration",
      edgeId: edge.id,
      expectedConfiguration: edge.semantic.configuration,
      configuration,
    };
    const updated = applyGraphCommand(added, update).document;
    const updatedEdge = updated.edges.find((item) => item.id === edge.id);
    if (updatedEdge === undefined) {
      throw new Error("Added edge must exist.");
    }
    const remove = {
      ...commandEnvelope(updated, "operation_remove_observer"),
      kind: "remove-edge",
      edgeId: edge.id,
      expectedEdge: updatedEdge,
    };

    expectUndoRedoRoundTrip(document, add);
    expectUndoRedoRoundTrip(added, update);
    expectUndoRedoRoundTrip(updated, remove);

    expectApplicationIssue(
      () =>
        applyGraphCommand(updated, {
          ...remove,
          commandId: "operation_remove_stale",
          inverseCommandId: "operation_remove_stale_inverse",
          expectedEdge: edge,
        }),
      "precondition_failed",
    );
  });

  it("rolls an entire batch back when a later command fails", async () => {
    const document = deepFreeze(await representativeDocument());
    const network = document.nodes.find((node) => node.id === "node_network");
    if (network === undefined) {
      throw new Error("Representative fixture must contain the network node.");
    }
    const before = serializeArchitectureDocumentV1(document);
    const batch = {
      ...commandEnvelope(document, "operation_atomic_batch"),
      kind: "batch",
      commands: [
        {
          ...commandEnvelope(
            document,
            "operation_atomic_move",
            "operation_atomic_move_inverse",
          ),
          kind: "move-node",
          nodeId: network.id,
          expectedPosition: network.presentation.position,
          position: { x: 999, y: 999 },
        },
        {
          ...commandEnvelope(
            document,
            "operation_atomic_stale_update",
            "operation_atomic_stale_update_inverse",
          ),
          kind: "update-node-configuration",
          nodeId: network.id,
          expectedConfiguration: {
            ...network.semantic.configuration,
            values: {},
          },
          configuration: network.semantic.configuration,
        },
      ],
    };

    const error = expectApplicationIssue(
      () => applyGraphCommand(document, batch),
      "precondition_failed",
    );

    expect(error.issues[0]?.path).toContain("$.commands[1]");
    expect(serializeArchitectureDocumentV1(document)).toBe(before);
    expect(network.presentation.position).toEqual({ x: 80, y: 40 });
  });

  it("enforces document and command identity preconditions", async () => {
    const document = await representativeDocument();
    const network = document.nodes.find((node) => node.id === "node_network");
    if (network === undefined) {
      throw new Error("Representative fixture must contain the network node.");
    }
    const move = {
      ...commandEnvelope(document, "operation_identity_move"),
      kind: "move-node",
      nodeId: network.id,
      expectedPosition: network.presentation.position,
      position: { x: 81, y: 41 },
    };

    expectApplicationIssue(
      () =>
        applyGraphCommand(document, {
          ...move,
          target: {
            ...move.target,
            revisionId: "revision_stale",
          },
        }),
      "document_precondition_failed",
    );
    expectApplicationIssue(
      () =>
        applyGraphCommand(document, {
          ...move,
          inverseCommandId: move.commandId,
        }),
      "command_identity_conflict",
    );
  });

  it("rejects deletion with dependents and routes generated deletion through release", async () => {
    const document = await representativeDocument();
    const network = document.nodes.find((node) => node.id === "node_network");
    const application = document.nodes.find(
      (node) => node.id === "node_application",
    );
    if (network === undefined || application === undefined) {
      throw new Error("Representative fixture must contain both nodes.");
    }

    expectApplicationIssue(
      () =>
        applyGraphCommand(document, {
          ...commandEnvelope(document, "operation_remove_network"),
          kind: "remove-node",
          nodeId: network.id,
          expectedNode: network,
        }),
      "resource_has_dependents",
    );

    expectApplicationIssue(
      () =>
        applyGraphCommand(document, {
          ...commandEnvelope(document, "operation_remove_generated"),
          kind: "remove-node",
          nodeId: application.id,
          expectedNode: application,
        }),
      "generated_resource_requires_release",
    );
  });

  it("requires adoption before generated semantic customization", async () => {
    const document = await representativeDocument();
    const application = document.nodes.find(
      (node) => node.id === "node_application",
    );
    if (application?.semantic.lifecycle.ownership !== "generated") {
      throw new Error("Representative application must be generated.");
    }
    const configuration = {
      ...application.semantic.configuration,
      values: {
        ...application.semantic.configuration.values,
        instanceCount: { kind: "integer" as const, value: 3 },
      },
    };
    const update = {
      ...commandEnvelope(document, "operation_customize_generated"),
      kind: "update-node-configuration",
      nodeId: application.id,
      expectedConfiguration: application.semantic.configuration,
      configuration,
    };

    expectApplicationIssue(
      () => applyGraphCommand(document, update),
      "generated_resource_requires_adoption",
    );

    const adopted = applyGraphCommand(document, {
      ...commandEnvelope(document, "operation_adopt_application"),
      kind: "adopt-generated-resource",
      resource: { kind: "node", nodeId: application.id },
      expectedLifecycle: application.semantic.lifecycle,
      adoptedBy: "actor_user",
      adoptedAt: "2026-07-24T18:00:00Z",
    });

    expect(adopted.inversion.kind).toBe("unavailable");
    if (adopted.inversion.kind !== "unavailable") {
      throw new Error("Adoption must not manufacture a safe inverse.");
    }
    expect(adopted.inversion.reason.code).toBe(
      "adoption_requires_explicit_policy",
    );
    const customized = applyGraphCommand(adopted.document, update);
    expect(
      customized.document.nodes.find((node) => node.id === application.id)
        ?.semantic.configuration,
    ).toEqual(configuration);

    expectApplicationIssue(
      () =>
        applyGraphCommand(customized.document, {
          ...commandEnvelope(
            customized.document,
            "operation_release_adopted_application",
          ),
          kind: "release-generated-resource",
          resource: { kind: "node", nodeId: application.id },
          expectedLifecycle: application.semantic.lifecycle,
          dependencies: [],
          requiredDisposition: "removed",
        }),
      "resource_not_generated",
    );
  });

  it("retains a referenced generated resource with deterministic reference counts", async () => {
    const document = await representativeDocument();
    const application = document.nodes.find(
      (node) => node.id === "node_application",
    );
    if (application?.semantic.lifecycle.ownership !== "generated") {
      throw new Error("Representative application must be generated.");
    }

    const released = applyGraphCommand(document, {
      ...commandEnvelope(document, "operation_release_application"),
      kind: "release-generated-resource",
      resource: { kind: "node", nodeId: application.id },
      expectedLifecycle: application.semantic.lifecycle,
      dependencies: [
        { kind: "node", nodeId: "node_network" },
        { kind: "edge", edgeId: "edge_application_network" },
      ],
      requiredDisposition: "retained",
    });

    expect(released.changes).toEqual([
      expect.objectContaining({
        kind: "generated-resource-released",
        disposition: "retained",
        provenanceReferenceCount: 0,
        graphReferenceCount: 2,
      }),
    ]);
    expect(
      released.document.nodes.find((node) => node.id === application.id),
    ).toBeDefined();
    expect(released.inversion.kind).toBe("unavailable");
    if (released.inversion.kind !== "unavailable") {
      throw new Error("Retained provenance changes must not be inverted.");
    }
    expect(released.inversion.reason.code).toBe("generated_provenance_changed");
  });

  it("safely undoes and redoes an unreferenced generated-resource addition", async () => {
    const document = await representativeDocument();
    const generated = generatedNode(
      "node_support",
      "support",
      "node_network" as ArchitectureNodeV1["id"],
    );
    const add = {
      ...commandEnvelope(document, "operation_add_support"),
      kind: "add-node",
      node: generated,
    };

    const added = applyGraphCommand(document, add);
    const release = expectAvailable(added.inversion);
    expect(release.kind).toBe("release-generated-resource");
    if (release.kind !== "release-generated-resource") {
      throw new Error("Generated additions must invert through release.");
    }
    expect(release.requiredDisposition).toBe("removed");
    const released = applyGraphCommand(added.document, release);
    expect(released.changes).toEqual([
      expect.objectContaining({
        kind: "generated-resource-released",
        disposition: "removed",
        provenanceReferenceCount: 0,
        graphReferenceCount: 0,
      }),
    ]);
    expect(serializeArchitectureDocumentV1(released.document)).toBe(
      serializeArchitectureDocumentV1(document),
    );

    const redo = expectAvailable(released.inversion);
    const redone = applyGraphCommand(released.document, redo);
    expect(serializeArchitectureDocumentV1(redone.document)).toBe(
      serializeArchitectureDocumentV1(added.document),
    );
  });

  it("fails a generated-add inverse when a new reference would retain the resource", async () => {
    const document = await representativeDocument();
    const generated = generatedNode(
      "node_inverse_support",
      "inverse_support",
      "node_network" as ArchitectureNodeV1["id"],
    );
    const added = applyGraphCommand(document, {
      ...commandEnvelope(document, "operation_add_inverse_support"),
      kind: "add-node",
      node: generated,
    });
    const inverse = expectAvailable(added.inversion);
    if (inverse.kind !== "release-generated-resource") {
      throw new Error("Generated additions must invert through release.");
    }
    expect(inverse.requiredDisposition).toBe("removed");

    const reference = userEdge("edge_inverse_support_reference");
    const referenced = applyGraphCommand(added.document, {
      ...commandEnvelope(added.document, "operation_reference_inverse_support"),
      kind: "add-edge",
      edge: {
        ...reference,
        semantic: {
          ...reference.semantic,
          target: {
            ...reference.semantic.target,
            nodeId: generated.id,
          },
        },
      },
    });
    const before = serializeArchitectureDocumentV1(referenced.document);

    const error = expectApplicationIssue(
      () => applyGraphCommand(referenced.document, inverse),
      "precondition_failed",
    );

    expect(error.issues).toEqual([
      {
        code: "precondition_failed",
        message:
          "Generated resource release disposition no longer matches the required value.",
        path: "$.requiredDisposition",
      },
    ]);
    expect(serializeArchitectureDocumentV1(referenced.document)).toBe(before);
    expect(
      referenced.document.nodes.some((node) => node.id === generated.id),
    ).toBe(true);
  });

  it("withholds an earlier release when a later batch release would be retained", async () => {
    const document = await representativeDocument();
    const application = document.nodes.find(
      (node) => node.id === "node_application",
    );
    if (application?.semantic.lifecycle.ownership !== "generated") {
      throw new Error("Representative application must be generated.");
    }
    const support = generatedNode(
      "node_atomic_support",
      "atomic_support",
      "node_network" as ArchitectureNodeV1["id"],
    );
    const added = applyGraphCommand(document, {
      ...commandEnvelope(document, "operation_add_atomic_support"),
      kind: "add-node",
      node: support,
    });
    const releaseSupport = expectAvailable(added.inversion);
    if (releaseSupport.kind !== "release-generated-resource") {
      throw new Error("Generated additions must invert through release.");
    }
    const before = serializeArchitectureDocumentV1(added.document);

    const error = expectApplicationIssue(
      () =>
        applyGraphCommand(added.document, {
          ...commandEnvelope(added.document, "operation_atomic_release_batch"),
          kind: "batch",
          commands: [
            releaseSupport,
            {
              ...commandEnvelope(
                added.document,
                "operation_release_application_required",
              ),
              kind: "release-generated-resource",
              resource: { kind: "node", nodeId: application.id },
              expectedLifecycle: application.semantic.lifecycle,
              dependencies: [
                { kind: "node", nodeId: "node_network" },
                { kind: "edge", edgeId: "edge_application_network" },
              ],
              requiredDisposition: "removed",
            },
          ],
        }),
      "precondition_failed",
    );

    expect(error.issues).toEqual([
      {
        code: "precondition_failed",
        message:
          "Generated resource release disposition no longer matches the required value.",
        path: "$.commands[1].requiredDisposition",
      },
    ]);
    expect(serializeArchitectureDocumentV1(added.document)).toBe(before);
    expect(added.document.nodes.some((node) => node.id === support.id)).toBe(
      true,
    );
  });

  it("round-trips an atomic invertible batch for undo and redo", async () => {
    const document = await representativeDocument();
    const network = document.nodes.find((node) => node.id === "node_network");
    if (network === undefined) {
      throw new Error("Representative fixture must contain the network node.");
    }
    const worker = userNode("node_batch_worker", "batch_worker");
    const batch = {
      ...commandEnvelope(document, "operation_edit_batch"),
      kind: "batch",
      commands: [
        {
          ...commandEnvelope(
            document,
            "operation_batch_add",
            "operation_batch_add_inverse",
          ),
          kind: "add-node",
          node: worker,
        },
        {
          ...commandEnvelope(
            document,
            "operation_batch_move",
            "operation_batch_move_inverse",
          ),
          kind: "move-node",
          nodeId: network.id,
          expectedPosition: network.presentation.position,
          position: { x: 120, y: 90 },
        },
      ],
    };

    const applied = applyGraphCommand(document, batch);
    expect(applied.changes.at(-1)).toEqual({
      kind: "batch-applied",
      commandId: "operation_edit_batch",
      commandCount: 2,
    });
    const inverse = expectAvailable(applied.inversion);
    const undone = applyGraphCommand(applied.document, inverse);
    expect(serializeArchitectureDocumentV1(undone.document)).toBe(
      serializeArchitectureDocumentV1(document),
    );
    const redo = expectAvailable(undone.inversion);
    const redone = applyGraphCommand(undone.document, redo);
    expect(serializeArchitectureDocumentV1(redone.document)).toBe(
      serializeArchitectureDocumentV1(applied.document),
    );
  });
});

describe("reviewed catalog binding replacement", () => {
  it("changes only the binding and restores the exact document on undo", async () => {
    const document = parseArchitectureDocument(await representativeDocument());
    const command = parseGraphCommandV1({
      ...commandEnvelope(document, "upgrade_catalog"),
      kind: "replace-catalog-binding",
      expectedCatalog: document.catalog,
      catalog: {
        ...document.catalog,
        version: "2.0.0",
        digest: "sha256:" + "1".repeat(64),
      },
    });
    const result = applyGraphCommand(document, command);
    expect(result.document).toEqual({
      ...document,
      catalog:
        command.kind === "replace-catalog-binding"
          ? command.catalog
          : undefined,
    });
    expect(result.inversion.kind).toBe("available");
    if (result.inversion.kind === "available")
      expect(
        applyGraphCommand(result.document, result.inversion.command).document,
      ).toEqual(document);
    expect(() => applyGraphCommand(result.document, command)).toThrow(
      "no longer matches",
    );
  });
  it("rejects provider catalog replacement and rolls back a stale batch", async () => {
    const document = parseArchitectureDocument(await representativeDocument());
    const action = {
      ...commandEnvelope(document, "upgrade_catalog"),
      kind: "replace-catalog-binding",
      expectedCatalog: document.catalog,
      catalog: { ...document.catalog, id: "different.catalog" },
    };
    expect(() =>
      applyGraphCommand(document, parseGraphCommandV1(action)),
    ).toThrow("retain the provider catalog identity");
    const before = JSON.stringify(document);
    const good = {
      ...action,
      catalog: {
        ...document.catalog,
        version: "2.0.0",
        digest: "sha256:" + "1".repeat(64),
      },
    };
    const stale = { ...good, ...commandEnvelope(document, "stale_catalog") };
    expect(() =>
      applyGraphCommand(
        document,
        parseGraphCommandV1({
          ...commandEnvelope(document, "batch_upgrade"),
          kind: "batch",
          commands: [good, stale],
        }),
      ),
    ).toThrow("no longer matches");
    expect(JSON.stringify(document)).toBe(before);
  });
});
