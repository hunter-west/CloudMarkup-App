import {
  modelRepositoryInterpretationRequestV1Schema,
  modelRepositoryInterpretationResponseV1Schema,
  observedSolutionV1Schema,
  repositorySnapshotV1Schema,
  sha256Text,
} from "@cloudmarkup/schemas";
import { createSyntheticAiPreviewCandidate } from "../generation/ai-intent-preview-test-helpers.js";
/** Synthetic presentation data only; never hosted evaluation or import evidence. */
export function syntheticRepositoryInterpretationReview() {
  const content = "export const storage = undefined;\n",
    checksum = sha256Text(content),
    commitSha = "1".repeat(40),
    digest = sha256Text("synthetic-ui-snapshot");
  const createdAt = "2026-09-11T00:00:00.000Z";
  const evidence = {
    evidenceId: "source_synthetic_ui",
    path: "application/handler.ts",
    fileChecksum: checksum,
    location: { startLine: 1, endLine: 1 },
    content,
    redaction: { categories: [], noSecretValues: true, status: "not-required" },
  };
  const request = modelRepositoryInterpretationRequestV1Schema.parse({
    contractVersion: 1,
    operation: "repository.interpret",
    requestedMode: "guided",
    repositorySnapshotId: "snapshot_synthetic_ui",
    repositorySnapshotDigest: digest,
    commitSha,
    evidence: [evidence],
  });
  const reference = {
    kind: "repository-evidence",
    referenceId: evidence.evidenceId,
    path: evidence.path,
    digest: checksum,
    location: evidence.location,
  };
  const confidence = {
    basisPoints: 1000,
    evidenceReferences: [reference],
    rationale: "The source does not establish the storage implementation.",
  };
  const response = modelRepositoryInterpretationResponseV1Schema.parse({
    contractVersion: 1,
    operation: "repository.interpret",
    provenance: createSyntheticAiPreviewCandidate().candidate.provenance,
    proposalContext: {
      assumptions: [],
      confidence,
      unknowns: [
        {
          unknownId: "unknown_storage",
          question: "Who owns the storage and which access rules apply?",
          blocking: true,
          confidence,
        },
      ],
    },
    claims: [
      {
        claimId: "claim_storage",
        category: "workload",
        summary: "Storage implementation is unspecified.",
        confidence,
        evidenceReferences: [reference],
      },
    ],
  });
  const snapshot = repositorySnapshotV1Schema.parse({
    schemaVersion: 1,
    snapshotId: request.repositorySnapshotId,
    source: {
      kind: "local",
      sourceId: "cloudmarkup.synthetic-ui",
      descriptor: "Synthetic presentation data",
    },
    revision: { selector: { kind: "detached" }, commitSha },
    importedAt: createdAt,
    importer: {
      importerId: "cloudmarkup.repository-importer",
      importerVersion: "1.0.1",
    },
    selectedPaths: [{ ruleId: "selection_ui", path: ".", scope: "subtree" }],
    ignoreRules: [],
    files: [
      {
        path: evidence.path,
        checksum,
        sizeBytes: content.length,
        detectedKinds: ["application-source"],
      },
    ],
    detectedTypes: [],
    redaction: {
      status: "not-required",
      redactedFileCount: 0,
      redactedValueCount: 0,
      categories: [],
    },
    sizeLimits: {
      status: "within-limits",
      configured: {
        maximumFileCount: 1,
        maximumFileBytes: 16384,
        maximumTotalBytes: 16384,
      },
      scannedFileCount: 1,
      scannedBytes: content.length,
      includedFileCount: 1,
      excludedFileCount: 0,
    },
    evidence: [],
    parseFindings: [],
    inferredRelationships: [],
    unsupportedFiles: [],
    snapshotDigest: digest,
  });
  const observedSolution = observedSolutionV1Schema.parse({
    contractVersion: 1,
    kind: "cloudmarkup.observed-solution",
    observedSolutionId: "observed_synthetic_ui",
    designAuthority: "none",
    mutationPolicy: "reviewed-reconciliation-required",
    provenance: {
      repositorySnapshotId: snapshot.snapshotId,
      repositorySnapshotDigest: digest,
      commitSha,
      importedAt: createdAt,
      importerId: snapshot.importer.importerId,
      importerVersion: snapshot.importer.importerVersion,
    },
    evidence: [],
    resources: [],
    connections: [],
    workloads: [],
    externalResources: [],
    generatedFileOwnership: [],
    observedContentHash: sha256Text("synthetic-empty-observation"),
  });
  return { request, response, snapshot, observedSolution };
}
