import { normalizeArchitectureDocumentV3 } from "@cloudmarkup/schemas";

import {
  parseArchitectureDocument,
  type VersionedArchitectureDocument,
} from "./architecture-document.js";

function byId<T extends { readonly id: string }>(left: T, right: T): number {
  if (left.id === right.id) {
    return 0;
  }

  return left.id < right.id ? -1 : 1;
}

export function getArchitectureSemanticProjection(
  documentInput: VersionedArchitectureDocument,
) {
  const normalized = normalizeArchitectureDocumentV3(
    parseArchitectureDocument(documentInput),
  );

  return {
    kind: normalized.kind,
    schemaVersion: normalized.schemaVersion,
    documentId: normalized.documentId,
    architectureId: normalized.architectureId,
    revision: normalized.revision,
    provider: normalized.provider,
    catalog: normalized.catalog,
    compilerCompatibility: normalized.compilerCompatibility,
    metadata: normalized.metadata,
    nodes: normalized.nodes
      .map((node) => ({
        id: node.id,
        semantic: node.semantic,
      }))
      .sort(byId),
    edges: normalized.edges,
    variables: normalized.variables,
    outputs: normalized.outputs,
    assumptions: normalized.assumptions,
    unresolvedRequirements: normalized.unresolvedRequirements,
    applicationContracts: normalized.applicationContracts,
    externalResources: normalized.externalResources,
    workloadBehavior: normalized.workloadBehavior,
  };
}

export type ArchitectureSemanticProjection = ReturnType<
  typeof getArchitectureSemanticProjection
>;
