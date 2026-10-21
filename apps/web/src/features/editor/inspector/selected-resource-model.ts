import type {
  ArchitectureDocument,
  ArchitectureEdge,
  ArchitectureNode,
} from "@cloudmarkup/domain";
import type { WorkloadV2 } from "@cloudmarkup/schemas";

import {
  resolveExactEditorCatalogRelationship,
  resolveExactEditorCatalogService,
} from "@cloudmarkup/graph-preparation/catalog-selection";
import type {
  EditorCatalog,
  EditorCatalogConfiguration,
  EditorCatalogEducation,
  EditorCatalogMapping,
  EditorCatalogRelationship,
  EditorCatalogService,
  EditorCatalogUnsupportedCapability,
} from "../model/editor-catalog.js";
import type { EditorElementReference } from "../session/index.js";

interface SelectedInspectorBase {
  readonly configuration: EditorCatalogConfiguration;
  readonly currentConfiguration: ArchitectureNode["semantic"]["configuration"];
  readonly education: EditorCatalogEducation;
  readonly lifecycle: ArchitectureNode["semantic"]["lifecycle"];
  readonly target: EditorElementReference;
  readonly title: string;
  readonly unsupportedCapabilities: readonly EditorCatalogUnsupportedCapability[];
}

export interface SelectedNodeInspectorModel extends SelectedInspectorBase {
  readonly kind: "node";
  readonly mappings: readonly EditorCatalogMapping[];
  readonly node: ArchitectureNode;
  readonly service: EditorCatalogService;
  readonly workload: WorkloadV2 | null;
  readonly workloadContractVersion: 2 | null;
}

export interface SelectedEdgeInspectorModel extends SelectedInspectorBase {
  readonly edge: ArchitectureEdge;
  readonly kind: "edge";
  readonly relationship: EditorCatalogRelationship;
  readonly sourceNode: ArchitectureNode;
  readonly targetNode: ArchitectureNode;
}

export type SelectedResourceInspectorModel =
  SelectedEdgeInspectorModel | SelectedNodeInspectorModel;

export type SelectedResourceInspectorResolution =
  | {
      readonly kind: "ready";
      readonly model: SelectedResourceInspectorModel;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: string;
      readonly title: string;
    };

function workloadForNode(
  document: ArchitectureDocument,
  nodeId: ArchitectureNode["id"],
): {
  readonly contractVersion: 2 | null;
  readonly workload: WorkloadV2 | null;
} {
  const matches = document.workloadBehavior.workloads.filter(
    (workload) => workload.owningNodeId === nodeId,
  );
  return {
    contractVersion: document.workloadBehavior.contractVersion,
    workload: matches.length === 1 ? (matches[0] ?? null) : null,
  };
}

export function resolveSelectedResourceInspectorModel(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  selection: EditorElementReference,
): SelectedResourceInspectorResolution {
  if (selection.kind === "node") {
    const node = document.nodes.find(
      (candidate) => candidate.id === selection.id,
    );
    if (node === undefined) {
      return {
        kind: "unavailable",
        reason:
          "The selected resource is no longer present in this Architecture Document.",
        title: "Resource unavailable",
      };
    }

    const service = resolveExactEditorCatalogService(document, node, catalog);
    if (service?.supportState !== "available") {
      return {
        kind: "unavailable",
        reason:
          "This resource is not described by the exact provider catalog bound to the document. Its existing data remains untouched.",
        title: node.presentation.label,
      };
    }

    if (
      node.semantic.configuration.schemaId !== service.configuration.schemaId ||
      node.semantic.configuration.schemaVersion !==
        service.configuration.schemaVersion
    ) {
      return {
        kind: "unavailable",
        reason:
          "This resource uses a configuration schema version that the bound catalog cannot edit safely.",
        title: node.presentation.label,
      };
    }

    const workload = workloadForNode(document, node.id);
    return {
      kind: "ready",
      model: {
        configuration: service.configuration,
        currentConfiguration: node.semantic.configuration,
        education: service.education,
        kind: "node",
        lifecycle: node.semantic.lifecycle,
        mappings: service.mappings,
        node,
        service,
        target: { id: node.id, kind: "node" },
        title: node.presentation.label,
        unsupportedCapabilities: service.unsupportedCapabilities,
        workload: workload.workload,
        workloadContractVersion: workload.contractVersion,
      },
    };
  }

  const edge = document.edges.find(
    (candidate) => candidate.id === selection.id,
  );
  if (edge === undefined) {
    return {
      kind: "unavailable",
      reason:
        "The selected relationship is no longer present in this Architecture Document.",
      title: "Relationship unavailable",
    };
  }
  const relationship = resolveExactEditorCatalogRelationship(
    document,
    edge,
    catalog,
  );
  const sourceNode = document.nodes.find(
    (node) => node.id === edge.semantic.source.nodeId,
  );
  const targetNode = document.nodes.find(
    (node) => node.id === edge.semantic.target.nodeId,
  );
  if (
    relationship === undefined ||
    sourceNode === undefined ||
    targetNode === undefined
  ) {
    return {
      kind: "unavailable",
      reason:
        "The bound catalog has no exact relationship descriptor for these typed endpoints. No compatibility is inferred.",
      title: edge.semantic.relationshipType,
    };
  }
  if (
    edge.semantic.configuration.schemaId !==
      relationship.configuration.schemaId ||
    edge.semantic.configuration.schemaVersion !==
      relationship.configuration.schemaVersion
  ) {
    return {
      kind: "unavailable",
      reason:
        "This relationship uses a configuration schema version that the bound catalog cannot edit safely.",
      title: relationship.displayName,
    };
  }

  return {
    kind: "ready",
    model: {
      configuration: relationship.configuration,
      currentConfiguration: edge.semantic.configuration,
      edge,
      education: relationship.education,
      kind: "edge",
      lifecycle: edge.semantic.lifecycle,
      relationship,
      sourceNode,
      target: { id: edge.id, kind: "edge" },
      targetNode,
      title: relationship.displayName,
      unsupportedCapabilities: [],
    },
  };
}
