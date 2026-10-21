import {
  activeIssueV1Schema,
  aiAuthoredExtensionV1Schema,
  applicationContractsV1Schema,
  cloudMarkupRepositoryLockV1Schema,
  cloudMarkupRepositoryManifestV1Schema,
  evidenceCollectionV1Schema,
  evidenceRecordV1Schema,
  externalResourceReferenceDocumentV1Schema,
  normalizeActiveIssueV1,
  normalizeAiAuthoredExtensionV1,
  normalizeApplicationContractsV1,
  normalizeArchitectureDocumentV2,
  normalizeArchitectureDocumentV3,
  normalizeCloudMarkupRepositoryLockV1,
  normalizeCloudMarkupRepositoryManifestV1,
  normalizeEvidenceCollectionV1,
  normalizeEvidenceRecordV1,
  normalizeExternalResourceReferenceDocumentV1,
  normalizeObservedSolutionV1,
  normalizeReconciliationProposalV1,
  normalizeRepositorySnapshotV1,
  normalizeSolutionGenerationCoverageV1,
  normalizeSolutionRevisionManifestV1,
  normalizeWorkloadBehaviorV2,
  observedSolutionV1Schema,
  parseArchitectureDocumentV2,
  reconciliationProposalV1Schema,
  repositorySnapshotV1Schema,
  serializeCanonicalJson,
  solutionGenerationCoverageV1Schema,
  workloadBehaviorV2Schema,
  type ArchitectureDocumentV2,
  type ArchitectureDocumentV3,
  type ElementLifecycle,
  type IntentDocumentV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import {
  migrateArchitectureDocumentV1ToV2,
  parseArchitectureDocument,
} from "./architecture-document.js";
import { parseIntentDocument } from "./intent-document.js";
import {
  ArchitectureDocumentSemanticError,
  validateArchitectureDocumentSemantics,
} from "./semantic-validation.js";
import { validateSolutionRevisionManifestIntrinsicV1 } from "./solution-coverage-validation.js";
import { sha256Hex } from "./sha256.js";

export function hashCanonicalValue(value: unknown): Sha256Digest {
  return `sha256:${sha256Hex(serializeCanonicalJson(value))}` as Sha256Digest;
}

function lifecycleWithoutAuditTimestamp(lifecycle: ElementLifecycle): unknown {
  if (lifecycle.ownership !== "adopted") {
    return lifecycle;
  }

  return {
    ownership: lifecycle.ownership,
    origin: lifecycle.origin,
    provenance: lifecycle.provenance,
    adoptedBy: lifecycle.adoptedBy,
  };
}

function architectureRevisionWithoutAuditTimestamp(
  revision: (ArchitectureDocumentV2 | ArchitectureDocumentV3)["revision"],
): unknown {
  return {
    revisionId: revision.revisionId,
    revisionNumber: revision.revisionNumber,
    createdBy: revision.createdBy,
    ...(revision.sourceDraftId === undefined
      ? {}
      : { sourceDraftId: revision.sourceDraftId }),
    ...(revision.previousRevisionId === undefined
      ? {}
      : { previousRevisionId: revision.previousRevisionId }),
  };
}

function workloadBehaviorWithoutAuditTimestamps(
  document: ArchitectureDocumentV3,
): unknown {
  return {
    ...document.workloadBehavior,
    workloads: document.workloadBehavior.workloads.map((workload) => {
      const provenance =
        workload.provenance.source === "manual"
          ? {
              source: workload.provenance.source,
              recordedBy: workload.provenance.recordedBy,
            }
          : workload.provenance.source === "ai-assisted"
            ? {
                source: workload.provenance.source,
                modelGatewayId: workload.provenance.modelGatewayId,
                modelProviderId: workload.provenance.modelProviderId,
                modelId: workload.provenance.modelId,
                promptTemplateId: workload.provenance.promptTemplateId,
                promptVersion: workload.provenance.promptVersion,
                promptDigest: workload.provenance.promptDigest,
                outputDigest: workload.provenance.outputDigest,
                acceptedBy: workload.provenance.acceptedBy,
              }
            : workload.provenance;
      return { ...workload, provenance };
    }),
  };
}

function applicationContractsWithoutAuditTimestamps(
  document: ArchitectureDocumentV3,
): unknown {
  return {
    ...document.applicationContracts,
    revision: architectureRevisionWithoutAuditTimestamp(
      document.applicationContracts.revision,
    ),
    contracts: document.applicationContracts.contracts.map((contract) => ({
      ...contract,
      provenance: {
        source: contract.provenance.source,
        sourceReferenceIds: contract.provenance.sourceReferenceIds,
        ...(contract.provenance.recordedBy === undefined
          ? {}
          : { recordedBy: contract.provenance.recordedBy }),
      },
    })),
  };
}

function externalResourcesWithoutAuditTimestamps(
  document: ArchitectureDocumentV3,
): unknown {
  return {
    ...document.externalResources,
    revision: architectureRevisionWithoutAuditTimestamp(
      document.externalResources.revision,
    ),
    resources: document.externalResources.resources.map((resource) => ({
      ...resource,
      evidence: resource.evidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        source: evidence.source,
        digest: evidence.digest,
      })),
    })),
  };
}

function parseVersionBoundArchitectureDocumentForContentHash(
  input: unknown,
): ArchitectureDocumentV2 | ArchitectureDocumentV3 {
  if (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    (input as Readonly<Record<string, unknown>>)["schemaVersion"] === 1
  ) {
    return migrateArchitectureDocumentV1ToV2(input);
  }

  if (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    (input as Readonly<Record<string, unknown>>)["schemaVersion"] === 2
  ) {
    const document = parseArchitectureDocumentV2(input);
    const issues = validateArchitectureDocumentSemantics(document);
    if (issues.length > 0) {
      throw new ArchitectureDocumentSemanticError(issues);
    }
    return document;
  }

  return parseArchitectureDocument(input);
}
function architectureContentProjection(
  documentInput: ArchitectureDocumentV2 | ArchitectureDocumentV3,
): Readonly<Record<string, unknown>> {
  const document =
    documentInput.schemaVersion === 3
      ? normalizeArchitectureDocumentV3(documentInput)
      : normalizeArchitectureDocumentV2(documentInput);

  const common = {
    kind: document.kind,
    schemaVersion: document.schemaVersion,
    documentId: document.documentId,
    architectureId: document.architectureId,
    revision: architectureRevisionWithoutAuditTimestamp(document.revision),
    provider: document.provider,
    catalog: document.catalog,
    compilerCompatibility: document.compilerCompatibility,
    metadata: document.metadata,
    nodes: document.nodes.map((node) => ({
      id: node.id,
      semantic: {
        ...node.semantic,
        lifecycle: lifecycleWithoutAuditTimestamp(node.semantic.lifecycle),
      },
    })),
    edges: document.edges.map((edge) => ({
      id: edge.id,
      semantic: {
        ...edge.semantic,
        lifecycle: lifecycleWithoutAuditTimestamp(edge.semantic.lifecycle),
      },
    })),
    variables: document.variables,
    outputs: document.outputs,
    assumptions: document.assumptions,
    unresolvedRequirements: document.unresolvedRequirements,
    workloadBehavior:
      document.schemaVersion === 3
        ? workloadBehaviorWithoutAuditTimestamps(document)
        : document.workloadBehavior,
  };

  return document.schemaVersion === 3
    ? {
        ...common,
        applicationContracts:
          applicationContractsWithoutAuditTimestamps(document),
        externalResources: externalResourcesWithoutAuditTimestamps(document),
      }
    : common;
}

function intentRevisionWithoutAuditTimestamp(
  revision: IntentDocumentV1["revision"],
): unknown {
  return {
    revisionId: revision.revisionId,
    revisionNumber: revision.revisionNumber,
    createdBy: revision.createdBy,
    ...(revision.previousRevisionId === undefined
      ? {}
      : { previousRevisionId: revision.previousRevisionId }),
  };
}

function intentContentProjection(
  input: unknown,
): Readonly<Record<string, unknown>> {
  const document = parseIntentDocument(input);
  const prompt = document.metadata.provenance.prompt;

  return {
    ...document,
    revision: intentRevisionWithoutAuditTimestamp(document.revision),
    decisions: document.decisions.map((decision) => ({
      id: decision.id,
      subject: decision.subject,
      statement: decision.statement,
      status: decision.status,
      ...(decision.selectedAlternativeId === undefined
        ? {}
        : { selectedAlternativeId: decision.selectedAlternativeId }),
      ...(decision.supersedesDecisionId === undefined
        ? {}
        : { supersedesDecisionId: decision.supersedesDecisionId }),
      rationale: decision.rationale,
      decidedBy: decision.decidedBy,
    })),
    metadata: {
      ...document.metadata,
      provenance: {
        ...document.metadata.provenance,
        prompt:
          prompt.kind === "not-applicable"
            ? prompt
            : {
                kind: prompt.kind,
                interactionId: prompt.interactionId,
                templateId: prompt.templateId,
                templateVersion: prompt.templateVersion,
                inputDigest: prompt.inputDigest,
                ...(prompt.outputDigest === undefined
                  ? {}
                  : { outputDigest: prompt.outputDigest }),
              },
      },
    },
  };
}

export interface ArchitectureDocumentHashes {
  readonly contentHash: Sha256Digest;
  readonly visualHash: Sha256Digest;
}

export function getArchitectureDocumentContentHash(
  input: unknown,
): Sha256Digest {
  return getStructurallyValidArchitectureDocumentContentHash(
    parseVersionBoundArchitectureDocumentForContentHash(input),
  );
}

export function getStructurallyValidArchitectureDocumentContentHash(
  document: ArchitectureDocumentV2 | ArchitectureDocumentV3,
): Sha256Digest {
  return hashCanonicalValue(architectureContentProjection(document));
}

export function getArchitectureDocumentVisualHash(
  input: unknown,
): Sha256Digest {
  const document = normalizeArchitectureDocumentV3(
    parseArchitectureDocument(input),
  );

  return hashCanonicalValue({
    kind: "cloudmarkup.architecture-visual-projection",
    schemaVersion: 1,
    nodes: document.nodes.map((node) => ({
      id: node.id,
      presentation: node.presentation,
    })),
  });
}

export function getArchitectureDocumentHashes(
  input: unknown,
): ArchitectureDocumentHashes {
  return {
    contentHash: getArchitectureDocumentContentHash(input),
    visualHash: getArchitectureDocumentVisualHash(input),
  };
}

export function getIntentDocumentContentHash(input: unknown): Sha256Digest {
  return hashCanonicalValue(intentContentProjection(input));
}
export function getArchitectureDocumentCanonicalHash(
  input: unknown,
): Sha256Digest {
  return hashCanonicalValue(
    normalizeArchitectureDocumentV3(parseArchitectureDocument(input)),
  );
}

export function getApplicationContractsContentHash(
  input: unknown,
): Sha256Digest {
  return hashCanonicalValue(
    normalizeApplicationContractsV1(applicationContractsV1Schema.parse(input)),
  );
}

export function getWorkloadBehaviorContentHash(input: unknown): Sha256Digest {
  return hashCanonicalValue(
    normalizeWorkloadBehaviorV2(workloadBehaviorV2Schema.parse(input)),
  );
}

export function getExternalResourceReferenceContentHash(
  input: unknown,
): Sha256Digest {
  return hashCanonicalValue(
    normalizeExternalResourceReferenceDocumentV1(
      externalResourceReferenceDocumentV1Schema.parse(input),
    ),
  );
}

export function getRepositorySnapshotContentHash(input: unknown): Sha256Digest {
  return hashCanonicalValue(
    normalizeRepositorySnapshotV1(repositorySnapshotV1Schema.parse(input)),
  );
}

export function getObservedSolutionContentHash(input: unknown): Sha256Digest {
  return hashCanonicalValue(
    normalizeObservedSolutionV1(observedSolutionV1Schema.parse(input)),
  );
}

export function getReconciliationProposalContentHash(
  input: unknown,
): Sha256Digest {
  return hashCanonicalValue(
    normalizeReconciliationProposalV1(
      reconciliationProposalV1Schema.parse(input),
    ),
  );
}

export function getCloudMarkupRepositoryLockContentHash(
  input: unknown,
): Sha256Digest {
  return hashCanonicalValue(
    normalizeCloudMarkupRepositoryLockV1(
      cloudMarkupRepositoryLockV1Schema.parse(input),
    ),
  );
}

export function getCloudMarkupRepositoryManifestContentHash(
  input: unknown,
): Sha256Digest {
  return hashCanonicalValue(
    normalizeCloudMarkupRepositoryManifestV1(
      cloudMarkupRepositoryManifestV1Schema.parse(input),
    ),
  );
}

/**
 * Hashes only manifest-contained content. External Evidence records are
 * intentionally excluded from the immutable manifest content hash.
 */
export function getSolutionRevisionManifestContentHash(
  input: unknown,
): Sha256Digest {
  return hashCanonicalValue(
    normalizeSolutionRevisionManifestV1(
      validateSolutionRevisionManifestIntrinsicV1(input),
    ),
  );
}

export function getAiAuthoredExtensionContentHash(
  input: unknown,
): Sha256Digest {
  return hashCanonicalValue(
    normalizeAiAuthoredExtensionV1(aiAuthoredExtensionV1Schema.parse(input)),
  );
}

export function getSolutionGenerationCoverageContentHash(
  input: unknown,
): Sha256Digest {
  return hashCanonicalValue(
    normalizeSolutionGenerationCoverageV1(
      solutionGenerationCoverageV1Schema.parse(input),
    ),
  );
}

export function getActiveIssueContentHash(input: unknown): Sha256Digest {
  return hashCanonicalValue(
    normalizeActiveIssueV1(activeIssueV1Schema.parse(input)),
  );
}

export function getEvidenceRecordContentHash(input: unknown): Sha256Digest {
  return hashCanonicalValue(
    normalizeEvidenceRecordV1(evidenceRecordV1Schema.parse(input)),
  );
}

export function getEvidenceCollectionContentHash(input: unknown): Sha256Digest {
  return hashCanonicalValue(
    normalizeEvidenceCollectionV1(evidenceCollectionV1Schema.parse(input)),
  );
}
