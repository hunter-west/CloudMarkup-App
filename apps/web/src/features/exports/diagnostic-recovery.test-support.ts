import {
  solutionExportJobV1Schema,
  solutionRevisionV1Schema,
  SOLUTION_EXPORT_STAGES_V1,
  type CloudMarkupClient,
} from "@cloudmarkup/api-contract";
import {
  getArchitectureDocumentContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentVisualHash,
} from "@cloudmarkup/domain";
import {
  digestCanonicalValue,
  type ArchitectureDocumentV3,
  type ExportDiagnosticRecoveryRequestV1,
} from "@cloudmarkup/schemas";
import { loadFoundationArchitectureDocument } from "../editor/model/index.js";

/** One synthetic immutable source shared by recovery unit and component tests. */
export function diagnosticRecoveryFixture() {
  const document = loadFoundationArchitectureDocument();
  const node = document.nodes[0];
  if (!node) throw Error("Missing foundation node");
  const at = "2026-08-18T12:00:00.000Z";
  const empty = digestCanonicalValue([]);
  const content = getArchitectureDocumentContentHash(document);
  const visual = getArchitectureDocumentVisualHash(document);
  const full = getArchitectureDocumentCanonicalHash(document);
  const coverage = {
    contractVersion: 1,
    solutionRevisionId: "solution_recovery",
    state: "infrastructure-only",
    evidence: [],
    missingRequirements: [],
    workloads: [],
  };
  const noTool = {
    state: "not-applicable",
    reason: "Synthetic source only; no tool ran.",
  };
  const summary = {
    architectureRevisionId: "revision_recovery",
    contentDigest: content,
    semanticDigest: content,
    visualDigest: visual,
    documentDigest: full,
    createdAt: at,
    createdBy: { id: "principal_recovery", displayName: "Synthetic reviewer" },
    generationCoverage: coverage,
    name: "Saved recovery source",
    projectId: "project_recovery",
    solutionRevisionId: "solution_recovery",
    sourceDraftId: "draft_recovery",
    sourceDraftVersion: 1,
  };
  const revision = solutionRevisionV1Schema.parse({
    summary,
    revision: {
      id: summary.architectureRevisionId,
      projectId: summary.projectId,
      sourceDraftId: summary.sourceDraftId,
      sourceDraftVersion: 1,
      architectureDocument: document,
      catalogDigest: document.catalog.digest,
      catalogId: document.catalog.id,
      catalogVersion: document.catalog.version,
      contentDigest: content,
      documentDigest: full,
      semanticDigest: content,
      visualDigest: visual,
      createdAt: at,
      createdBy: summary.createdBy,
      graphSchemaVersion: 3,
      workloadBehaviorVersion: 2,
    },
    manifest: {
      contractVersion: 1,
      kind: "cloudmarkup.solution-revision-manifest",
      solutionRevisionId: summary.solutionRevisionId,
      createdAt: at,
      createdBy: "principal_recovery",
      aiExtensionIds: [],
      assumptions: [],
      evidenceIdsAtFreeze: [],
      issueIdsAtFreeze: [],
      repositoryObservations: [],
      sourceOwnership: [],
      unresolvedDecisionIds: [],
      generationCoverage: coverage,
      architecture: {
        contentHash: content,
        documentHash: full,
        visualHash: visual,
        documentKind: "cloudmarkup.architecture-document",
        revisionId: summary.architectureRevisionId,
        schemaVersion: 3,
      },
      contracts: { contentHash: empty, contractVersion: 1, recordHashes: [] },
      externalResources: { contentHash: empty, contractVersion: 1 },
      workload: { contentHash: empty, contractVersion: 2 },
      intent: {
        state: "not-applicable",
        reason: "No saved intent in this synthetic source.",
      },
      versions: {
        catalog: document.catalog,
        compiler: noTool,
        applicationGenerator: noTool,
        diagramRenderer: noTool,
        importer: noTool,
        modelPrompt: noTool,
        policy: [],
      },
    },
  });
  const request: ExportDiagnosticRecoveryRequestV1 = {
    contractVersion: 1,
    jobId: "solutionexport_recovery",
    solutionRevisionId: summary.solutionRevisionId,
    manifestDigest: digestCanonicalValue(revision.manifest),
    code: "compiler.configuration-invalid",
    reference: { kind: "node", id: node.id },
  };
  const job = solutionExportJobV1Schema.parse({
    contractVersion: 1,
    id: request.jobId,
    projectId: summary.projectId,
    createdAt: at,
    updatedAt: at,
    state: "queued",
    cancellation: { state: "none" },
    runSequence: 1,
    requestDigest: empty,
    pollAfterMilliseconds: 1000,
    generationCoverage: coverage,
    diagnostics: [
      {
        code: request.code,
        message: "Review the affected configuration.",
        severity: "warning",
        stage: "compilation",
        recoveryReferences: {
          contractVersion: 1,
          locations: [request.reference],
        },
      },
    ],
    evidence: [],
    warnings: [],
    progress: {
      completedStages: 1,
      totalStages: 8,
      currentStage: "compilation",
      message: "Queued",
    },
    stages: SOLUTION_EXPORT_STAGES_V1.map((stage) => ({
      stage,
      status: stage === "authorization" ? "succeeded" : "pending",
    })),
    solutionRevision: {
      solutionRevisionId: request.solutionRevisionId,
      manifestDigest: request.manifestDigest,
      manifestRecordId: "manifest_recovery",
    },
    target: {
      environment: { environmentType: "development" },
      profileId: "cloudmarkup.export.terraform-nodejs24-v1",
      settingsDigest: empty,
      exportName: "recovery",
      diagram: {
        background: "opaque-light",
        includeStableDeploymentIdentifiers: false,
        maxHeight: 4096,
        maxWidth: 4096,
        profile: "presentation",
        scale: 2,
      },
    },
  });
  const draft = {
    architectureDocument: document,
    contentDigest: content,
    documentDigest: full,
    id: summary.sourceDraftId,
    projectId: summary.projectId,
    storageStatus: "published",
    updatedAt: at,
    version: 1,
  };
  const responses: Record<string, unknown> = {
    "solution-export-jobs.get": job,
    "solution-revisions.get": revision,
    "drafts.get": draft,
  };
  const calls: string[] = [];
  const client = {
    request: async (operation: string) => {
      calls.push(operation);
      const value = responses[operation];
      if (value instanceof Error) throw value;
      return {
        apiVersion: "v1",
        data:
          typeof value === "function"
            ? await (value as () => Promise<unknown>)()
            : value,
      };
    },
    requestWithMetadata: () => {
      throw Error("Unexpected metadata operation");
    },
  } as unknown as CloudMarkupClient;
  const live: { value: ArchitectureDocumentV3 | null } = { value: document };
  return {
    document,
    revision,
    draft,
    job,
    request,
    responses,
    calls,
    client,
    live,
    args: {
      client,
      projectId: summary.projectId,
      request,
      currentDocument: () => live.value,
    },
  };
}
