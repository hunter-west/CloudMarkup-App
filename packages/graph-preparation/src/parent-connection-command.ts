import type {
  ArchitectureDocument,
  ArchitectureNode,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  type GraphCommandActionV1,
} from "@cloudmarkup/schemas";
import type {
  EditorCatalog,
  EditorCatalogRelationship,
} from "./editor-catalog.js";

export class ParentConnectionError extends Error {}

/** Canonical placement owns plain typed parent edges. Generated/adopted edges
 * still require their separate explicit lifecycle workflow. */
export function prepareParentConnectionActions(input: {
  readonly catalog: EditorCatalog;
  readonly document: ArchitectureDocument;
  readonly node: ArchitectureNode;
  readonly parent: NonNullable<ArchitectureNode["semantic"]["parent"]> | null;
  readonly createId: () => string;
}): GraphCommandActionV1[] {
  if (input.catalog.parentEdges !== "catalog") return [];
  const { catalog, document, node, parent } = input;
  function descriptor(
    value: NonNullable<typeof parent>,
  ): EditorCatalogRelationship {
    const parentNode = document.nodes.find(({ id }) => id === value.nodeId);
    const candidates = catalog.relationships?.filter(
      (relationship) =>
        relationship.id === value.relationshipType &&
        ((relationship.sourceServiceType === parentNode?.semantic.serviceType &&
          relationship.targetServiceType === node.semantic.serviceType) ||
          (relationship.targetServiceType ===
            parentNode?.semantic.serviceType &&
            relationship.sourceServiceType === node.semantic.serviceType)),
    );
    const result = candidates?.length === 1 ? candidates[0] : undefined;
    if (
      result?.iamEffects.length !== 0 ||
      result.supportingChanges.length !== 0 ||
      result.configuration.fields.length !== 0
    )
      throw new ParentConnectionError(
        "This parent needs a reviewed connection before placement can change.",
      );
    return result;
  }
  function endpoints(
    value: NonNullable<typeof parent>,
    relationship: EditorCatalogRelationship,
  ) {
    const childIsSource =
      relationship.sourceServiceType === node.semantic.serviceType;
    return {
      source: {
        nodeId: childIsSource ? node.id : value.nodeId,
        port: relationship.sourcePortId,
      },
      target: {
        nodeId: childIsSource ? value.nodeId : node.id,
        port: relationship.targetPortId,
      },
    };
  }
  const parentTypes = new Set(
    catalog.services
      .find(({ serviceType }) => serviceType === node.semantic.serviceType)
      ?.placement.allowedParents.map(
        ({ relationshipType }) => relationshipType,
      ),
  );
  const existing = document.edges.filter(
    ({ semantic }) =>
      parentTypes.has(semantic.relationshipType) &&
      (semantic.source.nodeId === node.id ||
        semantic.target.nodeId === node.id),
  );
  if (existing.length > 1)
    throw new ParentConnectionError(
      "Review the conflicting parent connections before changing placement.",
    );
  const oldEdge = existing[0];
  const previousParent = node.semantic.parent;
  if (oldEdge !== undefined) {
    if (previousParent === undefined)
      throw new ParentConnectionError(
        "The existing parent connection disagrees with this service's placement.",
      );
    const expected = endpoints(previousParent, descriptor(previousParent));
    if (
      oldEdge.semantic.relationshipType !== previousParent.relationshipType ||
      oldEdge.semantic.source.nodeId !== expected.source.nodeId ||
      oldEdge.semantic.source.port !== expected.source.port ||
      oldEdge.semantic.target.nodeId !== expected.target.nodeId ||
      oldEdge.semantic.target.port !== expected.target.port
    )
      throw new ParentConnectionError(
        "The existing parent connection disagrees with this service's placement.",
      );
    if (
      parent?.nodeId === previousParent.nodeId &&
      parent.relationshipType === previousParent.relationshipType
    )
      return [];
    if (oldEdge.semantic.lifecycle.ownership !== "user")
      throw new ParentConnectionError(
        "Review the generated or adopted parent connection before changing placement.",
      );
  }
  const target = {
    architectureId: document.architectureId,
    documentId: document.documentId,
    revisionId: document.revision.revisionId,
  };
  function action(payload: Record<string, unknown>): GraphCommandActionV1 {
    const parsed = parseGraphCommandV1({
      schemaVersion: 1,
      commandId: input.createId(),
      inverseCommandId: input.createId(),
      origin: "user",
      target,
      ...payload,
    });
    if (parsed.kind === "batch")
      throw new TypeError("Expected one placement action.");
    return parsed;
  }
  const actions: GraphCommandActionV1[] = [];
  if (oldEdge !== undefined)
    actions.push(
      action({
        kind: "remove-edge",
        edgeId: oldEdge.id,
        expectedEdge: oldEdge,
      }),
    );
  if (parent !== null) {
    const relationship = descriptor(parent);
    const defaults = relationship.configuration.defaults;
    if (defaults.kind !== "ready")
      throw new ParentConnectionError(
        "Choose the required parent connection settings before changing placement.",
      );
    const validated = relationship.configuration.validate(defaults.values);
    if (!validated.success)
      throw new ParentConnectionError(
        "The parent connection settings are invalid.",
      );
    const pair = endpoints(parent, relationship);
    const peers = document.edges.filter(
      (edge) =>
        edge.id !== oldEdge?.id &&
        edge.semantic.relationshipType === relationship.id,
    );
    if (
      peers.filter(
        ({ semantic }) =>
          semantic.source.nodeId === pair.source.nodeId &&
          semantic.source.port === pair.source.port,
      ).length >= relationship.maximumConnectionsPerSource ||
      peers.filter(
        ({ semantic }) =>
          semantic.target.nodeId === pair.target.nodeId &&
          semantic.target.port === pair.target.port,
      ).length >= relationship.maximumConnectionsPerTarget
    )
      throw new ParentConnectionError(
        "This parent has reached its supported connection limit.",
      );
    actions.push(
      action({
        kind: "add-edge",
        edge: {
          id: oldEdge?.id ?? "edge_parent_" + node.id,
          semantic: {
            ...pair,
            relationshipType: relationship.id,
            configuration: {
              schemaId: relationship.configuration.schemaId,
              schemaVersion: relationship.configuration.schemaVersion,
              values: validated.values,
            },
            lifecycle: { ownership: "user", origin: "user" },
          },
        },
      }),
    );
  }
  return actions;
}
