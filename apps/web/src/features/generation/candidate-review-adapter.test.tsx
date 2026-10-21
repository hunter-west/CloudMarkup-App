import { createCandidateArtifactReference } from "@cloudmarkup/ai-extension-generation";
import {
  candidateInspectionV1Schema,
  candidateReviewRecordV1Schema,
  candidateValidationReplayV1Schema,
  digestCanonicalValue,
  getCandidateReviewDigest,
  sha256Text,
  type CandidateReviewRecordV1,
} from "@cloudmarkup/ai-extension-generation/presentation";
import { getActiveIssueRecordHash } from "@cloudmarkup/domain";
import {
  modelCandidateBundleV1Schema,
  modelGenerationContextV1Schema,
  modelInvocationDescriptorV1Schema,
  solutionRevisionManifestV1Schema,
} from "@cloudmarkup/schemas";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App.js";
import { CandidateReviewSurface } from "./CandidateReviewSurface.js";
import { getModePreferenceStorageKey } from "../../preferences/index.js";
import {
  createCandidateReviewPresentation,
  createCandidateReviewSurfaceProps,
  type CandidateReviewHostInputV1,
} from "./candidate-review-adapter.js";

const timestamp = "2026-08-22T12:00:00Z";
const solutionRevisionId = "solution-revision-web-candidate";
const extensionId = "extension-web-candidate";
const candidatePath = "application/src/custom-handler.ts";
const scope = {
  organizationId: "local-org",
  projectId: "field-notes",
} as const;
const candidateContent =
  "export const handler = () => ({ statusCode: 204 });\n";
const assumptionStatement =
  "The approved handler returns no response body for a successful request.";
const expectedTestDescription =
  "The generated handler satisfies its response contract.";
const catalog = {
  digest: `sha256:${"0".repeat(64)}`,
  id: "example.cloud.catalog",
  version: "2.0.0",
} as const;
const catalogContent =
  '{"entries":[{"resourceType":"example.events.source","serviceType":"example.events"}]}';
const schemaDocument =
  '{"additionalProperties":false,"properties":{},"type":"object"}';
const sourceContractDigest = sha256Text("web-candidate-source-contract");
const coverageRequirements = [
  "structural-validity",
  "provider-architecture-validity",
  "ai-extension-parse-static-validity",
  "application-build-and-tests",
  "application-security-checks",
] as const;

const sourceSolutionRevision = solutionRevisionManifestV1Schema.parse({
  aiExtensionIds: [],
  architecture: {
    contentHash: sha256Text("web-candidate-architecture-content"),
    documentHash: sha256Text("web-candidate-architecture-document"),
    documentKind: "cloudmarkup.architecture-document",
    revisionId: "revision_0002",
    schemaVersion: 3,
    visualHash: sha256Text("web-candidate-architecture-visual"),
  },
  assumptions: [],
  contractVersion: 1,
  contracts: {
    contentHash: sha256Text("web-candidate-contracts"),
    contractVersion: 1,
    recordHashes: [sourceContractDigest],
  },
  createdAt: timestamp,
  createdBy: "actor-web-candidate",
  evidenceIdsAtFreeze: [],
  externalResources: {
    contentHash: sha256Text("web-candidate-external-resources"),
    contractVersion: 1,
  },
  generationCoverage: {
    contractVersion: 1,
    evidence: [],
    missingRequirements: [...coverageRequirements],
    solutionRevisionId,
    state: "custom-implementation-required",
    workloads: [
      {
        evidence: [],
        missingRequirements: [...coverageRequirements],
        state: "custom-implementation-required",
        unresolvedRequirementIds: [],
        workloadId: "workload-web-candidate",
      },
    ],
  },
  intent: {
    reason: "Intent is independently approved in this synthetic web fixture.",
    state: "not-applicable",
  },
  issueIdsAtFreeze: [],
  kind: "cloudmarkup.solution-revision-manifest",
  repositoryObservations: [],
  solutionRevisionId,
  sourceOwnership: [],
  unresolvedDecisionIds: [],
  versions: {
    applicationGenerator: {
      reason: "The fixture exercises an AI-assisted custom extension.",
      state: "not-applicable",
    },
    catalog,
    compiler: {
      reason: "The candidate is not deterministic compiler output.",
      state: "not-applicable",
    },
    diagramRenderer: {
      reason: "No diagram is rendered by this fixture.",
      state: "not-applicable",
    },
    importer: {
      reason: "No repository import is used by this fixture.",
      state: "not-applicable",
    },
    modelPrompt: {
      state: "pinned",
      tool: {
        id: "cloudmarkup.application-generation",
        version: "1.0.0",
      },
    },
    policy: [],
  },
  workload: {
    contentHash: sha256Text("web-candidate-workload"),
    contractVersion: 2,
  },
});

function generationContext() {
  return modelGenerationContextV1Schema.parse({
    allowedDependencies: [],
    allowedProviders: [],
    allowedResources: [],
    catalogSlice: {
      catalog,
      content: catalogContent,
      entries: [
        {
          resourceType: "example.events.source",
          serviceType: "example.events",
        },
      ],
      sliceDigest: sha256Text(catalogContent),
    },
    existingFiles: [],
    extensionId,
    extensionPointId: "extension-point.web-candidate",
    kind: "application",
    language: "language.typescript",
    limits: {
      maximumCandidateFileBytes: 16_384,
      maximumCandidateFiles: 1,
      maximumCandidateTotalBytes: 16_384,
      maximumDependencyRequests: 0,
      maximumExpectedTests: 1,
      maximumRepairAttempts: 1,
      maximumResourceCount: 0,
    },
    officialSchemas: [
      {
        document: schemaDocument,
        schemaDigest: sha256Text(schemaDocument),
        schemaId: "schema.web-candidate",
        schemaVersion: "1.0.0",
      },
    ],
    ownedPaths: [candidatePath],
    ownedResourceAddresses: [],
    protectedPaths: [],
    protectedResourceAddresses: [],
    requestedBehavior: {
      acceptanceCriteria: ["Every required validation check passes."],
      objective: "Create one bounded custom application handler.",
      requirements: ["Do not deploy or overwrite deterministic output."],
    },
    runtimeFamily: "runtime.nodejs",
    sourceReferences: [
      {
        digest: sourceContractDigest,
        kind: "solution-contract",
        referenceId: "cloudmarkup.web-candidate",
      },
    ],
    validationExpectations: [
      {
        checkId: "application.contract-tests",
        kind: "contract-test",
        required: true,
        successCondition: "must-pass",
        toolProfileId: "cloudmarkup.nodejs24-sandbox",
      },
    ],
    workloadId: "workload-web-candidate",
  });
}

function invocationDescriptor() {
  return modelInvocationDescriptorV1Schema.parse({
    budgetDecisionId: "budget-decision-web-candidate",
    complexity: "deep",
    contractVersion: 1,
    entitlementDecisionId: "entitlement-decision-web-candidate",
    evaluationPolicyId: "cloudmarkup.model-evaluation",
    evaluationPolicyVersion: "1.0.0",
    feature: "application-source.generate",
    idempotencyKeyDigest: sha256Text("web-candidate-idempotency"),
    inputDigest: sha256Text("web-candidate-input"),
    invocationId: "invocation-web-candidate",
    modelId: "model.fixture",
    modelVersion: "2026-08-22",
    promptDigest: sha256Text("web-candidate-prompt"),
    promptTemplateId: "cloudmarkup.application-generation",
    promptVersion: "1.0.0",
    providerFamily: "deterministic-fake",
    providerId: "provider.fixture",
    requestedMode: "professional",
    role: "deep-architecture-custom-generation",
    scope: {
      ...scope,
      solutionRevisionId,
      userId: "user-web-reviewer",
    },
    toolAuthority: "none",
  });
}

function candidateReplay() {
  const context = generationContext();
  const descriptor = invocationDescriptor();
  const bundle = modelCandidateBundleV1Schema.parse({
    assumptions: [
      {
        assumptionId: "assumption-web-handler-response",
        sourceReferences: context.sourceReferences,
        statement: assumptionStatement,
      },
    ],
    boundary: {
      approvalPathIds: ["approval.web-candidate"],
      boundaryId: extensionId,
      ownedPaths: [candidatePath],
      writeAuthority: "candidate-artifacts-only",
    },
    candidates: [
      {
        candidateId: "candidate-web-handler",
        content: candidateContent,
        contentDigest: sha256Text(candidateContent),
        encoding: "utf-8",
        kind: "file",
        ownership: "ai-authored-candidate",
        path: candidatePath,
      },
    ],
    dependencies: [],
    expectedTests: [
      {
        description: expectedTestDescription,
        expectedTestId: "expected-test-web-handler-contract",
        kind: "contract-test",
        sourceReferences: context.sourceReferences,
        targetPaths: [candidatePath],
        validationCheckId: "application.contract-tests",
      },
    ],
    generationPlan: {
      objective: "Create only the bounded application handler.",
      planId: "plan-web-candidate",
      steps: [
        {
          action: "create-file",
          rationale: "Use the exact approved custom extension path.",
          sourceReferences: context.sourceReferences,
          stepId: "step-web-candidate",
          targetPath: candidatePath,
        },
      ],
    },
    provenance: {
      contractVersion: 1,
      gatewayId: "cloudmarkup.model-gateway",
      inputDigest: descriptor.inputDigest,
      invocationId: descriptor.invocationId,
      modelId: descriptor.modelId,
      modelVersion: descriptor.modelVersion,
      ownership: "untrusted-proposal",
      promptDigest: descriptor.promptDigest,
      promptTemplateId: descriptor.promptTemplateId,
      promptVersion: descriptor.promptVersion,
      providerId: descriptor.providerId,
    },
    unresolvedItems: [],
    validationExpectations: context.validationExpectations,
  });
  const bundleDigest = digestCanonicalValue(bundle);
  return candidateValidationReplayV1Schema.parse({
    attemptAuthority: [
      {
        attemptNumber: 0,
        descriptor,
        kind: "generation",
        mergedBundleDigest: bundleDigest,
        rawBundleDigest: bundleDigest,
        usage: {
          attemptNumber: 1,
          cacheReadUnits: "0",
          cacheWriteUnits: "0",
          completedAt: timestamp,
          contractVersion: 1,
          durationMilliseconds: 0,
          feature: descriptor.feature,
          idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
          inputDigest: descriptor.inputDigest,
          inputUnits: "1",
          invocationId: descriptor.invocationId,
          modelId: descriptor.modelId,
          modelVersion: descriptor.modelVersion,
          outputUnits: "1",
          promptTemplateId: descriptor.promptTemplateId,
          promptVersion: descriptor.promptVersion,
          providerId: descriptor.providerId,
          result: "succeeded",
          scope: descriptor.scope,
          startedAt: timestamp,
          thinkingUnits: "0",
          usageRecordId: "usage-web-candidate",
        },
      },
    ],
    bundle,
    bundleDigest,
    descriptor,
    generationContext: context,
    generationContextDigest: digestCanonicalValue(context),
    solutionRevision: sourceSolutionRevision,
    solutionRevisionDigest: digestCanonicalValue(sourceSolutionRevision),
  });
}

function candidateHost(): CandidateReviewHostInputV1 {
  const replay = candidateReplay();
  const file = {
    content: candidateContent,
    digest: sha256Text(candidateContent),
    ownership: "ai-authored-candidate" as const,
    path: candidatePath,
    sizeBytes: new TextEncoder().encode(candidateContent).byteLength,
    sourceKind: "file" as const,
  };
  const artifact = createCandidateArtifactReference({
    bundleDigest: replay.bundleDigest,
    extensionId,
    files: [file],
    scope,
    solutionRevisionId,
    storedAt: timestamp,
    targetKind: "application",
    validationReplay: replay,
  });
  const issueSeed = {
    affected: [{ artifactId: artifact.artifactId, kind: "artifact" as const }],
    aiProposedFix: {
      description: "Keep the candidate inside the approved owner boundary.",
      extensionId,
      proposedPatchDigest: sha256Text("web-candidate-owner-proposal"),
      validationStatus: "validated-for-review" as const,
    },
    deterministicFix: {
      description: "Move the candidate node with one reviewed command batch.",
      graphCommand: {
        commandId: "operation_web_candidate_fix",
        commands: [
          {
            commandId: "operation_web_candidate_move",
            expectedPosition: { x: 0, y: 0 },
            inverseCommandId: "operation_web_candidate_move_inverse",
            kind: "move-node" as const,
            nodeId: "node_web_candidate",
            origin: "user" as const,
            position: { x: 40, y: 20 },
            schemaVersion: 1 as const,
            target: {
              architectureId: "architecture_web_candidate",
              documentId: "document_web_candidate",
              revisionId: sourceSolutionRevision.architecture.revisionId,
            },
          },
        ],
        inverseCommandId: "operation_web_candidate_fix_inverse",
        kind: "batch" as const,
        origin: "user" as const,
        schemaVersion: 1 as const,
        target: {
          architectureId: "architecture_web_candidate",
          documentId: "document_web_candidate",
          revisionId: sourceSolutionRevision.architecture.revisionId,
        },
      },
      resultingContentHash: sha256Text("web-candidate-content-after-fix"),
      resultingVisualHash: sha256Text("web-candidate-visual-after-fix"),
    },
    category: "source-ownership" as const,
    closureRequirements: [
      {
        description: "Confirm the application owner before acceptance.",
        evidenceCheckId: "application.owner-confirmed",
        evidenceLevel: {
          kind: "ai-extension-parse-static-validity" as const,
          rank: 4 as const,
        },
      },
    ],
    contractVersion: 1 as const,
    currentRecordDigest: sha256Text("web-candidate-issue-placeholder"),
    id: "active-issue-web-candidate-owner",
    lifecycle: { state: "current" as const },
    provenance: {
      actor: {
        kind: "deterministic-tool" as const,
        tool: { id: "cloudmarkup.ai-extension-validation", version: "1.0.0" },
      },
      createdAt: timestamp,
      inputDigests: [artifact.artifactDigest],
    },
    recordVersion: 1,
    severity: "warning" as const,
    solutionRevisionId,
    source: "ai-generation-repair" as const,
    sourceRecordId: "diagnostic-web-candidate-owner",
    summary: "The application owner still needs confirmation.",
    technicalDetail:
      "The candidate has no accepted owner record in the current revision.",
  };
  const issue = {
    ...issueSeed,
    currentRecordDigest: getActiveIssueRecordHash(issueSeed),
  };
  const validation = [
    {
      checkId: "application.contract-tests",
      kind: "contract-test" as const,
      required: true,
      result: "passed" as const,
      toolVersion: "nodejs24-sandbox-v1",
    },
  ];
  const evidence = {
    artifacts: [
      {
        digest: artifact.artifactDigest,
        mediaType: "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
        sizeBytes: file.sizeBytes,
      },
    ],
    checks: [
      {
        artifactDigests: [artifact.artifactDigest],
        checkId: "application.contract-tests",
        generationCoverageRequirement: "application-build-and-tests" as const,
        issueIds: [],
        status: "passed" as const,
        summary: "The candidate contract checks passed.",
      },
      {
        artifactDigests: [artifact.artifactDigest],
        checkId: "application.security-checks",
        generationCoverageRequirement: "application-security-checks" as const,
        issueIds: [],
        status: "passed" as const,
        summary: "The candidate security checks passed.",
      },
    ],
    contractVersion: 1 as const,
    environment: { environmentType: "test" as const },
    id: "evidence-web-candidate-validation",
    layer: "generated" as const,
    level: { kind: "application-build-and-tests" as const, rank: 5 as const },
    models: [],
    provenance: {
      actor: {
        kind: "deterministic-tool" as const,
        tool: { id: "cloudmarkup.ai-extension-validation", version: "1.0.0" },
      },
      createdAt: timestamp,
      inputDigests: [artifact.artifactDigest],
    },
    solutionRevisionId,
    staleness: { assessedAt: timestamp, state: "current" as const },
    tools: [{ id: "cloudmarkup.ai-extension-validation", version: "1.0.0" }],
  };
  const extension = {
    acceptance: { state: "pending" as const },
    contractVersion: 1 as const,
    dependencies: [],
    exportSafety: {
      missingEvidenceKinds: ["cloudmarkup.user-acceptance"],
      state: "not-safe" as const,
    },
    id: extensionId,
    issueIds: [issue.id],
    model: {
      modelId: replay.descriptor.modelId,
      modelVersion: replay.descriptor.modelVersion,
      outputDigest: artifact.bundleDigest,
      promptDigest: replay.descriptor.promptDigest,
      promptVersion: replay.descriptor.promptVersion,
      providerId: replay.descriptor.providerId,
      reservationId: "reservation-web-candidate",
      usageEventIds: ["usage-web-candidate"],
    },
    outputs: [
      {
        digest: file.digest,
        kind: file.sourceKind,
        path: file.path,
        sizeBytes: file.sizeBytes,
      },
    ],
    ownedPaths: [{ conflictPolicy: "fail" as const, path: file.path }],
    regenerationPolicy: "replace-owned-exact" as const,
    request: {
      acceptanceCriteria: ["Every required check passes."],
      capabilityIds: ["application.custom-handler"],
      constraints: ["Use only the approved application extension point."],
      objective: "Add a bounded custom application handler.",
      prohibitedCapabilities: ["deployment.execute"],
    },
    solutionRevisionId,
    sourceReferences: [
      {
        contractId: "cloudmarkup.web-candidate",
        contractVersion: "1.0.0",
        digest: sourceContractDigest,
        kind: "solution-contract" as const,
      },
    ],
    target: {
      fileType: "application.typescript",
      kind: "application" as const,
      language: "language.typescript",
      workloadId: "workload-web-candidate",
    },
    validation,
  };
  const reviewWithoutDigest = {
    artifact,
    assumptions: (replay.bundle.assumptions ?? []).map((assumption) => ({
      assumptionId: assumption.assumptionId,
      sourceReferenceIds: assumption.sourceReferences.map(
        ({ referenceId }) => referenceId,
      ),
      statement: assumption.statement,
    })),
    attemptAuthority: replay.attemptAuthority,
    attempts: [
      {
        attemptNumber: 0,
        bundleDigest: replay.bundleDigest,
        idempotencyKeyDigest: replay.descriptor.idempotencyKeyDigest,
        invocationId: replay.descriptor.invocationId,
        kind: "generation" as const,
        mergedBundleDigest: replay.bundleDigest,
        metered: true as const,
        model: {
          modelId: replay.descriptor.modelId,
          modelVersion: replay.descriptor.modelVersion,
          promptDigest: replay.descriptor.promptDigest,
          promptTemplateId: replay.descriptor.promptTemplateId,
          promptVersion: replay.descriptor.promptVersion,
          providerId: replay.descriptor.providerId,
        },
        usageRecordId: "usage-web-candidate",
      },
    ],
    contractVersion: 1 as const,
    diagnostics: [
      {
        category: "contract-test" as const,
        checkId: "application.contract-tests",
        code: "application.contract-tests-passed",
        path: candidatePath,
        repairable: false,
        severity: "information" as const,
        summary: "The contract test passed.",
        technicalDetail:
          "The generated contract test completed in the bounded sandbox.",
      },
    ],
    editRevalidations: [],
    evidence: [evidence],
    expectedTests: (replay.bundle.expectedTests ?? []).map((test) => ({
      description: test.description,
      expectedTestId: test.expectedTestId,
      kind: test.kind,
      sourceReferenceIds: test.sourceReferences.map(
        ({ referenceId }) => referenceId,
      ),
      targetPaths: test.targetPaths,
      validationCheckId: test.validationCheckId,
    })),
    generationProgress: {
      contractVersion: 1 as const,
      finalEvidenceCount: 1,
      finalEvidenceDigest: digestCanonicalValue([evidence]),
      finalIssueHistoryCount: 1,
      finalIssueHistoryDigest: digestCanonicalValue([issue]),
      finalIssuesCount: 1,
      finalIssuesDigest: digestCanonicalValue([issue]),
      finalSequence: 1,
      finalSnapshotDigest: sha256Text("web-candidate-progress-final-snapshot"),
      generationRunId: "candidate-generation-run-web-fixture",
      state: "finalized" as const,
      streamDigest: sha256Text("web-candidate-progress-stream"),
      terminalPhase: "validation-assessed" as const,
      terminalResultKind: "candidate-review" as const,
    },
    extension,
    issueHistory: [issue],
    issues: [issue],
    progress: [
      { stage: "generate" as const, state: "complete" as const },
      { stage: "check" as const, state: "complete" as const },
      {
        stage: "fix-automatically-where-safe" as const,
        state: "not-needed" as const,
      },
      {
        stage: "review-remaining-issues" as const,
        state: "complete" as const,
      },
      { stage: "accept-candidate" as const, state: "ready" as const },
    ],
    reviewId: "candidate-review-web-candidate",
    scope,
    state: "ready-for-acceptance" as const,
    unresolvedItems: [],
    validation,
    writeAuthority: "none" as const,
  };
  const review = candidateReviewRecordV1Schema.parse({
    ...reviewWithoutDigest,
    reviewDigest: getCandidateReviewDigest(
      reviewWithoutDigest as unknown as CandidateReviewRecordV1,
    ),
  });
  const inspectionWithoutDigest = {
    artifactDigest: artifact.artifactDigest,
    artifactId: artifact.artifactId,
    authorization: {
      action: "inspect" as const,
      authorizationDecisionId: "authorization-web-candidate-inspect",
      principalId: "local-mock-actor",
    },
    editAuthority: "reviewed-user-modifications-only" as const,
    files: [file],
    repositoryWriteAuthority: "none" as const,
    reviewDigest: review.reviewDigest,
    reviewId: review.reviewId,
    scope,
  };
  const inspection = candidateInspectionV1Schema.parse({
    ...inspectionWithoutDigest,
    inspectionDigest: digestCanonicalValue(inspectionWithoutDigest),
  });
  return {
    artifactLifecycle: { state: "current" },
    inspection,
    onAccept: vi.fn(),
    onFileChange: vi.fn(),
    replay,
    review,
  };
}

function candidateHostWithBlockingQuestion(): CandidateReviewHostInputV1 {
  const host = candidateHost();
  const { reviewDigest: ignoredReviewDigest, ...reviewProjection } =
    host.review;
  void ignoredReviewDigest;
  const reviewWithoutDigest = {
    ...reviewProjection,
    progress: reviewProjection.progress.map((stage) =>
      stage.stage === "accept-candidate"
        ? { ...stage, state: "blocked" as const }
        : stage,
    ),
    state: "review-with-issues" as const,
    unresolvedItems: [
      {
        blocking: true,
        detail:
          "Choose the owning team before this candidate can become an immutable revision.",
        question: "Which team owns the generated handler?",
        sourceReferenceIds: ["cloudmarkup.web-candidate"],
        unresolvedItemId: "unresolved-web-handler-owner",
      },
    ],
  };
  const review = candidateReviewRecordV1Schema.parse({
    ...reviewWithoutDigest,
    reviewDigest: getCandidateReviewDigest(reviewWithoutDigest),
  });
  const { inspectionDigest: ignoredInspectionDigest, ...inspectionProjection } =
    host.inspection;
  void ignoredInspectionDigest;
  const inspectionWithoutDigest = {
    ...inspectionProjection,
    reviewDigest: review.reviewDigest,
  };
  const inspection = candidateInspectionV1Schema.parse({
    ...inspectionWithoutDigest,
    inspectionDigest: digestCanonicalValue(inspectionWithoutDigest),
  });
  return { ...host, inspection, review };
}

async function renderCandidateApp(
  mode: "guided" | "professional",
  host = candidateHost(),
) {
  window.localStorage.setItem(getModePreferenceStorageKey(), mode);
  window.history.replaceState(
    null,
    "",
    `/organizations/local-org/projects/field-notes/artifacts/${host.inspection.artifactId}/review`,
  );
  const result = render(<App candidateReview={host} />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return { host, result };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("candidate review presentation adapter", () => {
  it("maps only strictly parsed candidate, issue, schema, tool, and model records", () => {
    const host = candidateHost();
    expect(createCandidateReviewPresentation(host).authority).toEqual({
      artifactId: host.inspection.artifactId,
      artifactLifecycle: { state: "current" },
      authorizationDecisionId:
        host.inspection.authorization.authorizationDecisionId,
      organizationId: "local-org",
      principalId: "local-mock-actor",
      projectId: "field-notes",
    });

    const props = createCandidateReviewSurfaceProps(host);

    expect(props.candidate).toMatchObject({
      acceptanceReady: true,
      candidateId: "candidate-review-web-candidate",
      files: [
        {
          content: candidateContent,
          language: "TypeScript",
          ownership: "generated-candidate",
          path: candidatePath,
        },
      ],
      modelProvenance: {
        modelId: "model.fixture",
        promptDigest: host.replay.descriptor.promptDigest,
        promptVersion: "1.0.0",
        providerId: "provider.fixture",
      },
      revalidationState: "current",
      schemaReferences: [
        {
          digest: sha256Text(schemaDocument),
          schemaId: "schema.web-candidate",
          version: "1.0.0",
        },
      ],
      toolDiagnostics: [
        {
          checkId: "application.contract-tests",
          code: "application.contract-tests-passed",
          toolName: "cloudmarkup.nodejs24-sandbox",
          toolVersion: "nodejs24-sandbox-v1",
        },
      ],
      validatedCandidateDigest: host.review.artifact.artifactDigest,
    });
    expect(props.candidate.issues).toEqual([
      expect.objectContaining({
        nextAction: "Confirm the application owner before acceptance.",
        severity: "warning",
        state: "active",
        summary: "The application owner still needs confirmation.",
      }),
    ]);
    expect(props.candidate.assumptions).toEqual([
      {
        assumptionId: "assumption-web-handler-response",
        sourceReferenceIds: ["cloudmarkup.web-candidate"],
        statement: assumptionStatement,
      },
    ]);
    expect(props.candidate.expectedTests).toEqual([
      {
        description: expectedTestDescription,
        expectedTestId: "expected-test-web-handler-contract",
        kind: "contract-test",
        sourceReferenceIds: ["cloudmarkup.web-candidate"],
        targetPaths: [candidatePath],
        validationCheckId: "application.contract-tests",
      },
    ]);
    expect(props.candidate.evidence).toEqual([
      {
        checkCounts: { error: 0, failed: 0, passed: 2, skipped: 0 },
        environmentType: "test",
        evidenceId: "evidence-web-candidate-validation",
        layer: "generated",
        levelKind: "application-build-and-tests",
        levelRank: 5,
        stalenessState: "current",
      },
    ]);
    expect(props.candidate.evidence[0]).not.toHaveProperty("artifacts");
    expect(props.candidate.evidence[0]).not.toHaveProperty("provenance");
    expect(props.candidate.unresolvedItems).toEqual([]);
    const deterministicFix = host.review.issues[0]?.deterministicFix;
    if (deterministicFix === undefined) {
      throw new Error("Expected the deterministic fix fixture.");
    }
    expect(props.candidate.fixes).toEqual([
      expect.objectContaining({
        afterContentHash: deterministicFix.resultingContentHash,
        afterVisualHash: deterministicFix.resultingVisualHash,
        beforeContentHash:
          host.replay.solutionRevision.architecture.contentHash,
        beforeVisualHash: host.replay.solutionRevision.architecture.visualHash,
        commandBatchDigest: digestCanonicalValue(deterministicFix.graphCommand),
        exactReference: `graph-command:${deterministicFix.graphCommand.commandId}`,
        kind: "deterministic-operation",
        status: "available",
      }),
      expect.objectContaining({
        exactReference: sha256Text("web-candidate-owner-proposal"),
        kind: "ai-proposal",
        status: "proposed",
      }),
    ]);
  });

  it("projects and renders a canonical blocking question without enabling acceptance", () => {
    const host = candidateHostWithBlockingQuestion();
    const props = createCandidateReviewSurfaceProps(host);

    expect(props.candidate).toMatchObject({
      acceptanceBlockedReason:
        "A required behavior decision is still unresolved.",
      acceptanceReady: false,
      unresolvedItems: [
        {
          blocking: true,
          detail:
            "Choose the owning team before this candidate can become an immutable revision.",
          question: "Which team owns the generated handler?",
          sourceReferenceIds: ["cloudmarkup.web-candidate"],
          unresolvedItemId: "unresolved-web-handler-owner",
        },
      ],
    });

    render(<CandidateReviewSurface {...props} />);
    const questions = screen.getByRole("list", {
      name: "Unresolved questions",
    });
    expect(within(questions).getByText("Blocking question")).toBeVisible();
    expect(
      within(questions).getByText("Which team owns the generated handler?"),
    ).toBeVisible();
    expect(
      within(questions).getByText(
        "Choose the owning team before this candidate can become an immutable revision.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Accept candidate" }),
    ).toBeDisabled();
  });

  it("keeps a superseded record reviewable but disables acceptance", () => {
    const host = candidateHost();
    const supersededHost: CandidateReviewHostInputV1 = {
      ...host,
      artifactLifecycle: {
        state: "superseded",
        successorArtifactDigest: sha256Text("successor-web-candidate"),
        successorArtifactId: "artifact-web-candidate-successor",
        supersededAt: sourceSolutionRevision.createdAt,
      },
    };

    const props = createCandidateReviewSurfaceProps(supersededHost);
    expect(props.candidate).toMatchObject({
      acceptanceBlockedReason:
        "A newer candidate superseded this record. Open the current candidate before acceptance.",
      acceptanceReady: false,
      revalidationState: "failed",
    });

    render(<CandidateReviewSurface {...props} />);
    expect(
      screen.getByRole("textbox", {
        name: `Edit candidate file ${candidatePath}`,
      }),
    ).toHaveValue(candidateContent);
    expect(
      screen.getByRole("button", { name: "Accept candidate" }),
    ).toBeDisabled();
    expect(supersededHost.onAccept).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "A newer candidate superseded this record. Open the current candidate before acceptance.",
      ),
    ).toBeVisible();
  });
  it("rejects a forged review that does not satisfy the strict contract", () => {
    const host = candidateHost();
    const forged = {
      ...host,
      review: { ...host.review, unexpectedAuthority: "deploy" },
    } as CandidateReviewHostInputV1;

    expect(() => createCandidateReviewSurfaceProps(forged)).toThrow(
      "Candidate review presentation authority is inconsistent.",
    );
  });

  it("rejects stale canonical review digests", () => {
    const host = candidateHost();
    const forged = {
      ...host,
      review: { ...host.review, reviewId: "candidate-review-forged" },
    } as CandidateReviewHostInputV1;

    expect(() => createCandidateReviewSurfaceProps(forged)).toThrow(
      "Candidate review presentation authority is inconsistent.",
    );
  });

  it("rejects a replay whose canonical digest no longer matches the artifact", () => {
    const host = candidateHost();
    const descriptor = {
      ...host.replay.descriptor,
      modelVersion: "forged-model-version",
    };
    const replay = candidateValidationReplayV1Schema.parse({
      ...host.replay,
      attemptAuthority: host.replay.attemptAuthority.map((authority) => ({
        ...authority,
        descriptor,
        usage: { ...authority.usage, modelVersion: descriptor.modelVersion },
      })),
      descriptor,
    });

    expect(() =>
      createCandidateReviewSurfaceProps({ ...host, replay }),
    ).toThrow("Candidate review presentation authority is inconsistent.");
  });

  it("rehashes inspected file bytes and rejects content hidden behind a stale digest", () => {
    const host = candidateHost();
    const content = `${candidateContent}// forged\n`;
    const inspectionWithoutDigest = {
      ...host.inspection,
      files: [
        {
          ...host.inspection.files[0],
          content,
          sizeBytes: new TextEncoder().encode(content).byteLength,
        },
      ],
    };
    const projection = { ...inspectionWithoutDigest };
    delete (projection as Partial<typeof projection>).inspectionDigest;
    const inspection = candidateInspectionV1Schema.parse({
      ...inspectionWithoutDigest,
      inspectionDigest: digestCanonicalValue(projection),
    });

    expect(() =>
      createCandidateReviewSurfaceProps({ ...host, inspection }),
    ).toThrow("Candidate review presentation authority is inconsistent.");
  });
});

describe("candidate review App composition", () => {
  it("mounts the authorized surface on the existing artifact-review route", async () => {
    const { host } = await renderCandidateApp("guided");

    expect(
      screen.getByRole("heading", { level: 1, name: "Candidate review" }),
    ).toBeInTheDocument();
    const surface = screen.getByRole("region", { name: "Review candidate" });
    expect(
      within(surface).getByRole("textbox", {
        name: `Edit candidate file ${candidatePath}`,
      }),
    ).toHaveValue(candidateContent);
    expect(
      within(surface).queryByRole("button", {
        name: /deploy|generate|model|plan|retry/iu,
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(surface).getByRole("button", { name: "Accept candidate" }),
    );
    expect(host.onAccept).toHaveBeenCalledWith({
      candidateId: "candidate-review-web-candidate",
      validatedCandidateDigest: host.review.artifact.artifactDigest,
    });

    fireEvent.change(
      within(surface).getByRole("textbox", {
        name: `Edit candidate file ${candidatePath}`,
      }),
      { target: { value: `${candidateContent}// reviewed\n` } },
    );
    expect(host.onFileChange).toHaveBeenCalledWith({
      candidateId: "candidate-review-web-candidate",
      content: `${candidateContent}// reviewed\n`,
      originalContentDigest: sha256Text(candidateContent),
      path: candidatePath,
    });
    expect(
      within(surface).getByRole("button", { name: "Accept candidate" }),
    ).toBeDisabled();
  });

  it("keeps the composed candidate actions identical in Guided and Professional modes", async () => {
    await renderCandidateApp("guided");
    const guidedSurface = screen.getByRole("region", {
      name: "Review candidate",
    });
    const guidedActions = within(guidedSurface)
      .getAllByRole("button")
      .map((button) => button.textContent.trim());
    const guidedText = guidedSurface.textContent;

    cleanup();
    await renderCandidateApp("professional");
    const professionalSurface = screen.getByRole("region", {
      name: "Review candidate",
    });
    expect(
      within(professionalSurface)
        .getAllByRole("button")
        .map((button) => button.textContent.trim()),
    ).toEqual(guidedActions);
    expect(professionalSurface.textContent).toBe(guidedText);
  });

  it("fails closed when inspection authority belongs to another principal", async () => {
    const host = candidateHost();
    const inspectionProjection: Partial<typeof host.inspection> = {
      ...host.inspection,
      authorization: {
        ...host.inspection.authorization,
        principalId: "principal-other-reviewer",
      },
    };
    delete inspectionProjection.inspectionDigest;
    const inspection = candidateInspectionV1Schema.parse({
      ...inspectionProjection,
      inspectionDigest: digestCanonicalValue(inspectionProjection),
    });
    window.history.replaceState(
      null,
      "",
      `/organizations/local-org/projects/field-notes/artifacts/${host.inspection.artifactId}/review`,
    );
    render(<App candidateReview={{ ...host, inspection }} />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "No authorized candidate can be shown",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue(candidateContent),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Accept candidate" }),
    ).not.toBeInTheDocument();
  });
  it("does not expose candidate bytes or acceptance when authority is invalid", async () => {
    const host = candidateHost();
    const invalidHost = {
      ...host,
      review: { ...host.review, unexpectedAuthority: "deploy" },
    } as CandidateReviewHostInputV1;
    window.history.replaceState(
      null,
      "",
      `/organizations/local-org/projects/field-notes/artifacts/${host.inspection.artifactId}/review`,
    );
    render(<App candidateReview={invalidHost} />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "No authorized candidate can be shown",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue(candidateContent),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Accept candidate" }),
    ).not.toBeInTheDocument();
  });
});
