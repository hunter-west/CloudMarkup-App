import {
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
 * Full-document draft replacement may change semantic and presentation content,
 * but identity remains server-owned. Copy workflows must allocate and rebind new
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
