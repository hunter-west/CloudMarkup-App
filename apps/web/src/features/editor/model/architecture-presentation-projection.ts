import type {
  ArchitectureDocument,
  ArchitectureEdge,
  ArchitectureNode,
} from "@cloudmarkup/domain";
import type { ConfigurationValue } from "@cloudmarkup/schemas";

import {
  isArchitectureNodeNormallyVisible,
  resolveExactEditorCatalogRelationship,
  resolveExactEditorCatalogService,
} from "@cloudmarkup/graph-preparation/catalog-selection";
import type {
  EditorCatalog,
  EditorCatalogService,
  EditorConnectionGroupCategory,
  EditorOwnedConfigurationSlot,
} from "./editor-catalog.js";
import { visualBoundaryParentId } from "./placement-rules.js";

export type ArchitectureBoundaryLevel =
  "outer" | "primary" | "secondary" | "tertiary";

export interface ArchitecturePresentationFact {
  readonly label: string;
  readonly value: string;
  readonly tone: "cost" | "default" | "security";
}

export interface ArchitectureAssociationBadge {
  readonly edgeIds: readonly ArchitectureEdge["id"][];
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

export interface ArchitectureOwnedConfigurationAssociation {
  readonly edgeId: ArchitectureEdge["id"];
  readonly label: string;
  readonly remoteNodeId: ArchitectureNode["id"];
  readonly remoteNodeLabel: string;
}

export interface ArchitectureOwnedConfigurationEntry {
  readonly associations: readonly ArchitectureOwnedConfigurationAssociation[];
  readonly facts: readonly ArchitecturePresentationFact[];
  readonly label: string;
  readonly nodeId: ArchitectureNode["id"];
}

export interface ArchitectureOwnedConfigurationSummary {
  readonly count: number;
  readonly description: string;
  readonly entries: readonly ArchitectureOwnedConfigurationEntry[];
  readonly label: string;
  readonly slotId: string;
}

export interface ArchitectureEducationPresentation {
  readonly considerations: readonly string[];
  readonly guidedExplanation: string;
  readonly professionalExplanation: string;
  readonly unsupported: readonly {
    readonly explanation: string;
    readonly title: string;
  }[];
}

interface ConnectionGroupProjectionInput {
  readonly category: EditorConnectionGroupCategory;
  readonly currentEdgeIds: readonly string[];
  readonly id: string;
  readonly label: string;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function opposite(endpoint: "source" | "target"): "source" | "target" {
  return endpoint === "source" ? "target" : "source";
}

function literalValueText(value: Readonly<ConfigurationValue>): string | null {
  switch (value.kind) {
    case "boolean":
      return value.value ? "Yes" : "No";
    case "integer":
    case "number":
      return String(value.value);
    case "number-list":
    case "string-list":
      return value.value.length === 0 ? "None" : value.value.join(", ");
    case "string":
      return value.value;
    case "node-reference":
    case "secret-reference":
    case "variable-reference":
      return null;
  }
}

function configurationValue(
  node: ArchitectureNode,
  property: string,
): Readonly<ConfigurationValue> | undefined {
  return Object.entries(node.semantic.configuration.values).find(
    ([key]) => key === property,
  )?.[1];
}

function presentationFacts(
  node: ArchitectureNode,
  service: EditorCatalogService,
  maximum: number,
): readonly ArchitecturePresentationFact[] {
  return service.configuration.fields
    .filter(
      (field) =>
        !field.advanced &&
        field.valueSource === "literal" &&
        configurationValue(node, field.property) !== undefined,
    )
    .sort(
      (left, right) =>
        left.order - right.order || compareText(left.property, right.property),
    )
    .flatMap((field) => {
      const value = configurationValue(node, field.property);
      const text = value === undefined ? null : literalValueText(value);
      return text === null
        ? []
        : [
            {
              label: field.label,
              tone:
                field.costImpact === "cost-sensitive"
                  ? ("cost" as const)
                  : field.securityImpact === "security-sensitive"
                    ? ("security" as const)
                    : ("default" as const),
              value: text,
            },
          ];
    })
    .slice(0, maximum);
}

export function architectureBoundaryLevel(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  node: ArchitectureNode,
): ArchitectureBoundaryLevel | null {
  const service = resolveExactEditorCatalogService(document, node, catalog);
  if (service?.nodeKind !== "boundary") {
    return null;
  }

  const nodes = new Map(
    document.nodes.map((candidate) => [candidate.id, candidate]),
  );
  const seen = new Set<ArchitectureNode["id"]>();
  let depth = 0;
  let current: ArchitectureNode | undefined = node;
  while (current !== undefined) {
    if (seen.has(current.id)) {
      return null;
    }
    seen.add(current.id);
    const parentId = visualBoundaryParentId(document, catalog, current);
    if (parentId === null) {
      break;
    }
    depth += 1;
    current = nodes.get(parentId);
  }

  if (depth === 0) {
    return "outer";
  }
  if (depth === 1) {
    return "primary";
  }
  if (depth === 2) {
    return "secondary";
  }
  return "tertiary";
}

/**
 * A line is containment only when it agrees with an exact, currently valid
 * visual boundary parent. Ordinary semantic parents on hidden configuration
 * nodes remain ownership/association evidence rather than physical nesting.
 */
export function isVisualContainmentEdge(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  edge: ArchitectureEdge,
): boolean {
  const source = document.nodes.find(
    (node) => node.id === edge.semantic.source.nodeId,
  );
  const target = document.nodes.find(
    (node) => node.id === edge.semantic.target.nodeId,
  );
  if (source === undefined || target === undefined) {
    return false;
  }

  return [
    { child: source, parent: target },
    { child: target, parent: source },
  ].some(
    ({ child, parent }) =>
      child.semantic.parent?.nodeId === parent.id &&
      child.semantic.parent.relationshipType ===
        edge.semantic.relationshipType &&
      visualBoundaryParentId(document, catalog, child) === parent.id,
  );
}

export function projectArchitectureAssociationBadges(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  groups: readonly ConnectionGroupProjectionInput[],
): readonly ArchitectureAssociationBadge[] {
  if (!groups.some((group) => group.category === "networking")) return [];
  const edgesById = new Map<string, ArchitectureEdge>(
    document.edges.map((edge) => [edge.id, edge]),
  );
  return groups
    .filter((group) => group.category === "networking")
    .flatMap((group) => {
      const edges = group.currentEdgeIds.flatMap((edgeId) => {
        const edge = edgesById.get(edgeId);
        return edge === undefined ||
          isVisualContainmentEdge(document, catalog, edge)
          ? []
          : [edge];
      });
      return edges.length === 0
        ? []
        : [
            {
              count: edges.length,
              edgeIds: edges.map((edge) => edge.id),
              id: group.id,
              label: group.label,
            },
          ];
    })
    .sort((left, right) => compareText(left.id, right.id));
}

function configurationBinding(
  owner: ArchitectureNode,
  slot: EditorOwnedConfigurationSlot,
  edge: ArchitectureEdge,
): { readonly configurationNodeId: ArchitectureNode["id"] } | null {
  if (
    edge.semantic.relationshipType !==
    slot.graphBinding.ownershipRelationshipType
  ) {
    return null;
  }
  const configurationEndpoint = slot.graphBinding.configurationEndpoint;
  const ownerEndpoint = opposite(configurationEndpoint);
  if (
    edge.semantic[ownerEndpoint].nodeId !== owner.id ||
    edge.semantic[ownerEndpoint].port !== slot.graphBinding.ownerPortId ||
    edge.semantic[configurationEndpoint].port !==
      slot.graphBinding.configurationPortId
  ) {
    return null;
  }
  return {
    configurationNodeId: edge.semantic[configurationEndpoint].nodeId,
  };
}

function relatedAssociations(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  configurationNode: ArchitectureNode,
  bindingEdgeId: ArchitectureEdge["id"],
): readonly ArchitectureOwnedConfigurationAssociation[] {
  return document.edges
    .filter(
      (edge) =>
        edge.id !== bindingEdgeId &&
        (edge.semantic.source.nodeId === configurationNode.id ||
          edge.semantic.target.nodeId === configurationNode.id),
    )
    .flatMap((edge) => {
      const remoteNodeId =
        edge.semantic.source.nodeId === configurationNode.id
          ? edge.semantic.target.nodeId
          : edge.semantic.source.nodeId;
      const remoteNode = document.nodes.find(
        (node) => node.id === remoteNodeId,
      );
      if (
        remoteNode === undefined ||
        !isArchitectureNodeNormallyVisible(document, remoteNode, catalog)
      ) {
        return [];
      }
      const relationship = resolveExactEditorCatalogRelationship(
        document,
        edge,
        catalog,
      );
      return [
        {
          edgeId: edge.id,
          label:
            relationship?.presentationLabel ??
            relationship?.displayName ??
            "Associated with",
          remoteNodeId,
          remoteNodeLabel: remoteNode.presentation.label,
        },
      ];
    })
    .sort(
      (left, right) =>
        compareText(left.label, right.label) ||
        compareText(left.remoteNodeId, right.remoteNodeId),
    );
}

export function projectArchitectureOwnedConfigurationSummaries(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  owner: ArchitectureNode,
  service: EditorCatalogService,
): readonly ArchitectureOwnedConfigurationSummary[] {
  return (service.ownedConfigurationSlots ?? [])
    .filter((slot) => slot.policyKinds.length === 0)
    .map((slot) => {
      const entries = document.edges
        .flatMap((edge) => {
          const binding = configurationBinding(owner, slot, edge);
          if (binding === null) {
            return [];
          }
          const configurationNode = document.nodes.find(
            (node) => node.id === binding.configurationNodeId,
          );
          if (configurationNode === undefined) {
            return [];
          }
          const configurationService = resolveExactEditorCatalogService(
            document,
            configurationNode,
            catalog,
          );
          if (
            configurationService?.serviceType !==
              slot.graphBinding.configurationServiceType ||
            configurationService.deployable
          ) {
            return [];
          }
          return [
            {
              associations: relatedAssociations(
                document,
                catalog,
                configurationNode,
                edge.id,
              ),
              facts: presentationFacts(
                configurationNode,
                configurationService,
                2,
              ),
              label: configurationService.displayName,
              nodeId: configurationNode.id,
            },
          ];
        })
        .sort((left, right) => compareText(left.nodeId, right.nodeId));
      return {
        count: entries.length,
        description: slot.description,
        entries,
        label: slot.displayName,
        slotId: slot.id,
      };
    })
    .filter((summary) => summary.count > 0)
    .sort((left, right) => compareText(left.slotId, right.slotId));
}

export function projectArchitecturePrimaryFacts(
  node: ArchitectureNode,
  service: EditorCatalogService,
): readonly ArchitecturePresentationFact[] {
  return presentationFacts(node, service, 2);
}

export function projectArchitectureEducation(
  service: EditorCatalogService,
): ArchitectureEducationPresentation {
  return {
    considerations: service.education.considerations,
    guidedExplanation: service.education.guidedExplanation,
    professionalExplanation: service.education.professionalExplanation,
    unsupported: service.unsupportedCapabilities.map((capability) => ({
      explanation: capability.explanation,
      title: capability.title,
    })),
  };
}
