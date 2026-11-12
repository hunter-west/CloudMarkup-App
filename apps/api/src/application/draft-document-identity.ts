import {
  serializeArchitectureDocumentV3,
  serializeCanonicalJson,
  type ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";

function draftIdentityBinding(document: ArchitectureDocumentV3) {
  return {
    applicationContracts: {
      contractSetId: document.applicationContracts.contractSetId,
      documentId: document.applicationContracts.documentId,
      revision: document.applicationContracts.revision,
    },
    architectureId: document.architectureId,
    documentId: document.documentId,
    externalResources: {
      architectureId: document.externalResources.architectureId,
      documentId: document.externalResources.documentId,
      revision: document.externalResources.revision,
    },
    revision: document.revision,
  };
}

/**
 * Draft presentation persistence retains all semantic and protected content;
 * identity remains server-owned. Copy workflows must allocate and rebind new
 * identities before they call the normal draft persistence path.
 */
export function hasMatchingDraftDocumentIdentity(input: {
  readonly candidate: ArchitectureDocumentV3;
  readonly current: ArchitectureDocumentV3;
  readonly currentDraftId: string;
}): boolean {
  return (
    input.current.revision.sourceDraftId === input.currentDraftId &&
    input.candidate.revision.sourceDraftId === input.currentDraftId &&
    serializeCanonicalJson(draftIdentityBinding(input.candidate)) ===
      serializeCanonicalJson(draftIdentityBinding(input.current))
  );
}

/** Snapshot writes are permitted ONLY when everything except each existing
 * node's label and position has identical canonical document storage. Only the
 * schema's established set-order normalization is applied. This deliberately
 * protects provenance/audit fields that compilation hashes omit. It is not proof
 * of semantic command history; every semantic transition uses applyDraftCommand.
 * New presentation fields are not automatically granted this exception. */
export function hasOnlyDraftPresentationChanges(
  current: ArchitectureDocumentV3,
  candidate: ArchitectureDocumentV3,
): boolean {
  const nodes = new Map(current.nodes.map((node) => [node.id, node]));
  const protectedCandidate = {
    ...candidate,
    nodes: candidate.nodes.map((node) => {
      const baseline = nodes.get(node.id);
      if (!baseline) return node;
      return {
        ...node,
        presentation: {
          ...node.presentation,
          label: baseline.presentation.label,
          position: baseline.presentation.position,
        },
      };
    }),
  };
  return (
    serializeArchitectureDocumentV3(protectedCandidate) ===
    serializeArchitectureDocumentV3(current)
  );
}
