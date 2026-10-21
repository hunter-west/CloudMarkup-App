import { readFileSync } from "node:fs";

import {
  architectureDocumentV3Schema,
  evidenceRecordV1Schema,
  modelCandidateBundleV1Schema,
  modelGenerationContextV1Schema,
  modelInvocationDescriptorV1Schema,
  normalizedModelUsageV1Schema,
  solutionRevisionManifestV1Schema,
  solutionRevisionIdSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  createCandidateAcceptanceService,
  type CandidateAcceptanceRequestV1,
  type CandidateAcceptanceServiceDependencies,
  type CandidateRejectionRequestV1,
} from "./acceptance.js";
import {
  createCandidateArtifactReference,
  type CandidateArtifactStore,
  type StoredCandidateArtifactV1,
} from "./artifact-store.js";
import type { MaterializedCandidateFile } from "./materializer.js";
import {
  candidateAcceptanceResultV1Schema,
  candidateAttemptV1Schema,
  candidateDiagnosticV1Schema,
  candidateEditRevalidationFinalizationV1Schema,
  candidateExportInputV1Schema,
  candidateReviewRecordV1Schema,
  candidateValidationReplayV1Schema,
  getCandidateEditRevalidationFinalizationDigest,
  getCandidateExportInputId,
  getCandidateReviewAuthorizationRequestDigest,
  type CandidateExportInputV1,
  type CandidateReviewRecordV1,
} from "./contracts.js";
import { createCandidateIssues } from "./issues.js";
import { digestCanonicalValue, sha256Text } from "./security.js";
import { InMemoryCandidateArtifactStore } from "./testing.js";

const timestamp = utcTimestampSchema.parse("2026-08-21T12:00:00Z");
const solutionRevisionId = solutionRevisionIdSchema.parse(
  "solution-revision-1",
);
const scope = {
  organizationId: "organization-primary",
  projectId: "project-primary",
} as const;
const candidatePath = "infrastructure/extensions/custom.tf";
const extensionId = "extension-custom";
const sourceContractDigest = sha256Text("source-contract");
const successorSolutionRevisionId = "solution-revision-accepted-1";
const architecture = architectureDocumentV3Schema.parse(
  JSON.parse(
    readFileSync(
      new URL(
        "../../test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as unknown,
);
const catalogEntry = (() => {
  const entry = architecture.nodes[0]?.semantic;
  if (entry === undefined) {
    throw new Error("Acceptance fixture requires one grounded catalog entry.");
  }
  return entry;
})();
const catalogContent = JSON.stringify({
  catalog: architecture.catalog,
  entries: [
    {
      resourceType: catalogEntry.resourceType,
      serviceType: catalogEntry.serviceType,
    },
  ],
});
const schemaDocument =
  '{"additionalProperties":false,"properties":{},"type":"object"}';
const customCoverageRequirements = [
  "structural-validity",
  "provider-architecture-validity",
  "ai-extension-parse-static-validity",
  "application-build-and-tests",
  "application-security-checks",
] as const;
const sourceSolutionRevision = solutionRevisionManifestV1Schema.parse({
  aiExtensionIds: [],
  architecture: {
    contentHash: sha256Text("acceptance-architecture-content"),
    documentHash: sha256Text("acceptance-architecture-document"),
    documentKind: "cloudmarkup.architecture-document",
    revisionId: architecture.revision.revisionId,
    schemaVersion: 3,
    visualHash: sha256Text("acceptance-architecture-visual"),
  },
  assumptions: [],
  contractVersion: 1,
  contracts: {
    contentHash: sha256Text("acceptance-contracts"),
    contractVersion: 1,
    recordHashes: [sourceContractDigest],
  },
  createdAt: timestamp,
  createdBy: "actor-acceptance-source",
  evidenceIdsAtFreeze: [],
  externalResources: {
    contentHash: sha256Text("acceptance-external-resources"),
    contractVersion: 1,
  },
  generationCoverage: {
    contractVersion: 1,
    evidence: [],
    missingRequirements: [...customCoverageRequirements],
    solutionRevisionId,
    state: "custom-implementation-required",
    workloads: [
      {
        evidence: [],
        missingRequirements: [...customCoverageRequirements],
        state: "custom-implementation-required",
        unresolvedRequirementIds: [],
        workloadId: "workload-custom",
      },
    ],
  },
  intent: {
    reason: "Intent is independently approved in this acceptance fixture.",
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
      reason:
        "No deterministic application generation is used by this fixture.",
      state: "not-applicable",
    },
    catalog: architecture.catalog,
    compiler: {
      reason: "The candidate is a reviewed extension, not a compiler output.",
      state: "not-applicable",
    },
    diagramRenderer: {
      reason: "No diagram rendering is used by this fixture.",
      state: "not-applicable",
    },
    importer: {
      reason: "No repository import is used by this fixture.",
      state: "not-applicable",
    },
    modelPrompt: {
      state: "pinned",
      tool: {
        id: "cloudmarkup.prompt-extension",
        version: "1.0.0",
      },
    },
    policy: [],
  },
  workload: {
    contentHash: sha256Text("acceptance-workload"),
    contractVersion: 2,
  },
});
const sourceEvidence = { contractVersion: 1 as const, records: [] };
const reviewerAuthorization: CandidateAcceptanceServiceDependencies["authorization"] =
  {
    authorize: (request) =>
      Promise.resolve({
        action: request.action,
        allowed: true as const,
        authoritySource: "verified-authentication-context" as const,
        contractVersion: 1 as const,
        decidedAt: timestamp,
        decisionId: `authorization-${request.action}-reviewer-1`,
        principalId: "reviewer-1",
        requestDigest: digestCanonicalValue(request),
      }),
  };
const acceptanceAuthority = {
  authorization: reviewerAuthorization,
  sourceEvidence,
  sourceSolutionRevision,
  successorSolutionRevisionId,
};
function acceptCandidateReview(
  input: CandidateAcceptanceRequestV1 & CandidateAcceptanceServiceDependencies,
) {
  const { artifactStore, authorization, ...request } = input;
  return createCandidateAcceptanceService({
    artifactStore,
    authorization,
  }).accept(request);
}

function rejectCandidateReview(
  input: CandidateRejectionRequestV1 & CandidateAcceptanceServiceDependencies,
) {
  const { artifactStore, authorization, ...request } = input;
  return createCandidateAcceptanceService({
    artifactStore,
    authorization,
  }).reject(request);
}

function invocationDescriptor(kind: "application" | "iac-extension") {
  return modelInvocationDescriptorV1Schema.parse({
    budgetDecisionId: "budget-decision-acceptance",
    complexity: "deep",
    contractVersion: 1,
    entitlementDecisionId: "entitlement-decision-acceptance",
    evaluationPolicyId: "cloudmarkup.model-evaluation",
    evaluationPolicyVersion: "1.0.0",
    feature:
      kind === "application"
        ? "application-source.generate"
        : "iac-extension.generate",
    idempotencyKeyDigest: sha256Text(`acceptance-${kind}-idempotency`),
    inputDigest: sha256Text(`acceptance-${kind}-input`),
    invocationId: `invocation-acceptance-${kind}`,
    modelId: "model.fixture",
    modelVersion: "2026-08-21",
    promptDigest: sha256Text("candidate-prompt"),
    promptTemplateId: "cloudmarkup.prompt-extension",
    promptVersion: "1.0.0",
    providerFamily: "deterministic-fake",
    providerId: "provider.fixture",
    requestedMode: "professional",
    role: "deep-architecture-custom-generation",
    scope: {
      ...scope,
      solutionRevisionId,
      userId: "user-acceptance",
    },
    toolAuthority: "none",
  });
}

function normalizedUsage(
  descriptor: ReturnType<typeof invocationDescriptor>,
  usageRecordId = "usage-1",
) {
  return normalizedModelUsageV1Schema.parse({
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
    usageRecordId,
  });
}
function generationContext(kind: "application" | "iac-extension") {
  return modelGenerationContextV1Schema.parse({
    allowedDependencies: [],
    allowedProviders: [
      {
        providerId: "provider.hashicorp-aws",
        source: "hashicorp/aws",
        versionConstraint: ">= 6.0.0, < 7.0.0",
      },
    ],
    allowedResources: [
      {
        providerId: "provider.hashicorp-aws",
        resourceType: "aws_cloudwatch_log_group",
      },
    ],
    catalogSlice: {
      catalog: architecture.catalog,
      content: catalogContent,
      entries: [
        {
          resourceType: catalogEntry.resourceType,
          serviceType: catalogEntry.serviceType,
        },
      ],
      sliceDigest: sha256Text(catalogContent),
    },
    existingFiles: [],
    extensionId,
    ...(kind === "application"
      ? {
          extensionPointId: "extension-point.custom-application",
          kind,
          workloadId: "workload-custom",
        }
      : {
          extensionSlotId: "terraform-extension-slot-1",
          kind,
          targetFormat: "terraform" as const,
        }),
    language: kind === "application" ? "language.typescript" : "language.hcl",
    limits: {
      maximumCandidateFileBytes: 16_384,
      maximumCandidateFiles: 1,
      maximumCandidateTotalBytes: 16_384,
      maximumDependencyRequests: 0,
      maximumExpectedTests: 0,
      maximumRepairAttempts: 1,
      maximumResourceCount: 1,
    },
    officialSchemas: [
      {
        document: schemaDocument,
        schemaDigest: sha256Text(schemaDocument),
        schemaId: "schema.acceptance-extension",
        schemaVersion: "1.0.0",
      },
    ],
    ownedPaths: [candidatePath],
    ownedResourceAddresses: ["aws_cloudwatch_log_group.custom"],
    protectedPaths: [],
    protectedResourceAddresses: [],
    requestedBehavior: {
      acceptanceCriteria: ["Every required validation check passes."],
      objective: "Create one bounded review-only custom extension.",
      requirements: ["Do not deploy or overwrite canonical compiler output."],
    },
    runtimeFamily:
      kind === "application" ? "runtime.nodejs" : "runtime.terraform",
    sourceReferences: [
      {
        digest: sourceContractDigest,
        kind: "solution-contract",
        referenceId: "cloudmarkup.custom-extension",
      },
    ],
    validationExpectations: [
      {
        checkId: "extension.parse",
        kind: "parse",
        required: true,
        successCondition: "must-pass",
        toolProfileId: "cloudmarkup.extension-parser",
      },
    ],
  });
}

function modelBundle(
  context: ReturnType<typeof generationContext>,
  descriptor: ReturnType<typeof invocationDescriptor>,
  content: string,
) {
  return modelCandidateBundleV1Schema.parse({
    assumptions: [],
    boundary: {
      approvalPathIds: ["approval.acceptance-extension"],
      boundaryId: extensionId,
      ownedPaths: [candidatePath],
      writeAuthority: "candidate-artifacts-only",
    },
    candidates: [
      {
        candidateId: "candidate-acceptance-extension",
        content,
        contentDigest: sha256Text(content),
        encoding: "utf-8",
        kind: "file",
        ownership: "ai-authored-candidate",
        path: candidatePath,
      },
    ],
    dependencies: [],
    expectedTests: [],
    generationPlan: {
      objective: "Create only the exact bounded candidate file.",
      planId: "plan-acceptance-extension",
      steps: [
        {
          action: "create-file",
          rationale: "Use only the exact reviewed extension path.",
          sourceReferences: context.sourceReferences,
          stepId: "step-acceptance-extension",
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
}

function validationReplay(
  kind: "application" | "iac-extension",
  content: string,
  sourceRevision = sourceSolutionRevision,
) {
  const descriptor = invocationDescriptor(kind);
  const context = generationContext(kind);
  const bundle = modelBundle(context, descriptor, content);
  const bundleDigest = digestCanonicalValue(bundle);
  return {
    attemptAuthority: [
      {
        attemptNumber: 0,
        descriptor,
        kind: "generation" as const,
        mergedBundleDigest: bundleDigest,
        rawBundleDigest: bundleDigest,
        usage: normalizedUsage(descriptor),
      },
    ],
    bundle,
    bundleDigest,
    descriptor,
    generationContext: context,
    generationContextDigest: digestCanonicalValue(context),
    solutionRevision: sourceRevision,
    solutionRevisionDigest: digestCanonicalValue(sourceRevision),
  };
}

async function readyReviewFixture() {
  const store = new InMemoryCandidateArtifactStore();
  const content = [
    'resource "aws_cloudwatch_log_group" "custom" {',
    '  name = "/cloudmarkup/custom"',
    "}",
    "",
  ].join("\n");
  const file = {
    content,
    digest: sha256Text(content),
    ownership: "ai-authored-candidate" as const,
    path: candidatePath,
    sizeBytes: new TextEncoder().encode(content).byteLength,
    sourceKind: "file" as const,
  };
  const replay = validationReplay("iac-extension", content);
  const bundleDigest = replay.bundleDigest;
  const artifact = await store.put({
    bundleDigest,
    extensionId,
    files: [file],
    scope,
    solutionRevisionId,
    storedAt: timestamp,
    targetKind: "terraform",
    validationReplay: replay,
  });
  const validation = [
    {
      checkId: "extension.parse",
      kind: "parse",
      required: true,
      result: "passed",
      toolVersion: "1.0.0",
    },
  ] as const;
  const extension = {
    acceptance: { state: "pending" },
    contractVersion: 1,
    dependencies: [],
    exportSafety: {
      missingEvidenceKinds: ["cloudmarkup.user-acceptance"],
      state: "not-safe",
    },
    id: "extension-custom",
    issueIds: [],
    model: {
      modelId: "model.fixture",
      modelVersion: "2026-08-21",
      outputDigest: bundleDigest,
      promptDigest: sha256Text("candidate-prompt"),
      promptVersion: "1.0.0",
      providerId: "provider.fixture",
      reservationId: "reservation-1",
      usageEventIds: ["usage-1"],
    },
    outputs: [
      {
        digest: file.digest,
        kind: file.sourceKind,
        path: file.path,
        sizeBytes: file.sizeBytes,
      },
    ],
    ownedPaths: [{ conflictPolicy: "fail", path: file.path }],
    regenerationPolicy: "replace-owned-exact",
    request: {
      acceptanceCriteria: ["The extension passes every required check."],
      capabilityIds: ["infrastructure.custom-extension"],
      constraints: ["Use only the reviewed extension slot."],
      objective: "Add a bounded reviewed Terraform extension.",
      prohibitedCapabilities: ["deployment.execute"],
    },
    solutionRevisionId,
    sourceReferences: [
      {
        contractId: "cloudmarkup.custom-extension",
        contractVersion: "1.0.0",
        digest: sha256Text("source-contract"),
        kind: "solution-contract",
      },
    ],
    target: {
      extensionSlotId: "terraform-extension-slot-1",
      fileType: "infrastructure.hcl",
      kind: "iac-extension",
      language: "language.hcl",
      targetFormat: "terraform",
    },
    validation,
  };
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
        checkId: "cloudmarkup.extension.parse-static",
        generationCoverageRequirement: "ai-extension-parse-static-validity",
        issueIds: [],
        status: "passed",
        summary: "The candidate passed deterministic parse and static checks.",
      },
    ],
    contractVersion: 1,
    environment: { environmentType: "test" },
    id: "evidence-static-1",
    layer: "generated",
    level: { kind: "ai-extension-parse-static-validity", rank: 4 },
    models: [],
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: {
          id: "cloudmarkup.ai-extension-validation",
          version: "1.0.0",
        },
      },
      createdAt: timestamp,
      inputDigests: [
        artifact.artifactDigest,
        digestCanonicalValue(sourceSolutionRevision),
      ],
    },
    solutionRevisionId,
    staleness: { assessedAt: timestamp, state: "current" },
    tools: [
      {
        id: "cloudmarkup.ai-extension-validation",
        version: "1.0.0",
      },
    ],
  };
  const reviewWithoutDigest = {
    artifact,
    assumptions: [],
    attemptAuthority: replay.attemptAuthority,
    attempts: [
      {
        attemptNumber: 0,
        bundleDigest,
        idempotencyKeyDigest: replay.descriptor.idempotencyKeyDigest,
        invocationId: replay.descriptor.invocationId,
        kind: "generation",
        mergedBundleDigest: bundleDigest,
        metered: true,
        model: {
          modelId: replay.descriptor.modelId,
          modelVersion: replay.descriptor.modelVersion,
          promptDigest: replay.descriptor.promptDigest,
          promptTemplateId: replay.descriptor.promptTemplateId,
          promptVersion: replay.descriptor.promptVersion,
          providerId: replay.descriptor.providerId,
        },
        usageRecordId: "usage-1",
      },
    ],
    contractVersion: 1,
    diagnostics: [],
    editRevalidations: [],
    evidence: [evidence],
    expectedTests: [],
    generationProgress: {
      contractVersion: 1,
      finalEvidenceCount: 1,
      finalEvidenceDigest: digestCanonicalValue([evidence]),
      finalIssueHistoryCount: 0,
      finalIssueHistoryDigest: digestCanonicalValue([]),
      finalIssuesCount: 0,
      finalIssuesDigest: digestCanonicalValue([]),
      finalSequence: 1,
      finalSnapshotDigest: sha256Text("acceptance-progress-final-snapshot"),
      generationRunId: "candidate-generation-run-acceptance-fixture",
      state: "finalized",
      streamDigest: sha256Text("acceptance-progress-stream"),
      terminalPhase: "validation-assessed",
      terminalResultKind: "candidate-review",
    },
    extension,
    issues: [],
    issueHistory: [],
    progress: [
      { stage: "generate", state: "complete" },
      { stage: "check", state: "complete" },
      { stage: "fix-automatically-where-safe", state: "not-needed" },
      { stage: "review-remaining-issues", state: "complete" },
      { stage: "accept-candidate", state: "ready" },
    ],
    reviewId: `candidate-review-${digestCanonicalValue({
      artifactDigest: artifact.artifactDigest,
      extensionId: extension.id,
      solutionRevisionId,
    }).slice("sha256:".length, 38)}`,
    scope,
    state: "ready-for-acceptance",
    unresolvedItems: [],
    validation,
    writeAuthority: "none",
  };
  const review = candidateReviewRecordV1Schema.parse({
    ...reviewWithoutDigest,
    reviewDigest: digestCanonicalValue(reviewWithoutDigest),
  });
  await store.bindReview({
    artifactId: artifact.artifactId,
    boundAt: timestamp,
    expectedArtifactDigest: artifact.artifactDigest,
    reviewDigest: review.reviewDigest,
    reviewId: review.reviewId,
    scope,
  });
  return { artifact, file, review, store };
}

async function twoAttemptReadyReviewFixture() {
  const base = await readyReviewFixture();
  const stored = await base.store.read({
    artifactId: base.artifact.artifactId,
    expectedArtifactDigest: base.artifact.artifactDigest,
    scope,
  });
  if (stored.validationReplay === undefined) {
    throw new Error("Missing two-attempt fixture validation replay.");
  }
  const generationAuthority = stored.validationReplay.attemptAuthority[0];
  const generationAttempt = base.review.attempts[0];
  if (generationAuthority === undefined || generationAttempt === undefined) {
    throw new Error("Missing two-attempt fixture generation authority.");
  }
  const repairDescriptor = modelInvocationDescriptorV1Schema.parse({
    ...generationAuthority.descriptor,
    feature: "candidate.repair",
    idempotencyKeyDigest: sha256Text("two-attempt-repair-idempotency"),
    inputDigest: sha256Text("two-attempt-repair-input"),
    invocationId: "invocation-two-attempt-repair",
  });
  const rawRepairBundleDigest = sha256Text("two-attempt-raw-repair-bundle");
  const repairAuthority = {
    attemptNumber: 1,
    descriptor: repairDescriptor,
    kind: "repair" as const,
    mergedBundleDigest: stored.validationReplay.bundleDigest,
    rawBundleDigest: rawRepairBundleDigest,
    usage: normalizedUsage(repairDescriptor, "usage-2"),
  };
  const replay = candidateValidationReplayV1Schema.parse({
    ...stored.validationReplay,
    attemptAuthority: [generationAuthority, repairAuthority],
    descriptor: repairDescriptor,
  });
  const store = new InMemoryCandidateArtifactStore();
  const artifact = await store.put({
    bundleDigest: replay.bundleDigest,
    extensionId,
    files: stored.files,
    scope,
    solutionRevisionId,
    storedAt: timestamp,
    targetKind: "terraform",
    validationReplay: replay,
  });
  const repairAttempt = {
    attemptNumber: 1,
    bundleDigest: rawRepairBundleDigest,
    idempotencyKeyDigest: repairDescriptor.idempotencyKeyDigest,
    invocationId: repairDescriptor.invocationId,
    kind: "repair" as const,
    mergedBundleDigest: replay.bundleDigest,
    metered: true as const,
    model: {
      modelId: repairDescriptor.modelId,
      modelVersion: repairDescriptor.modelVersion,
      promptDigest: repairDescriptor.promptDigest,
      promptTemplateId: repairDescriptor.promptTemplateId,
      promptVersion: repairDescriptor.promptVersion,
      providerId: repairDescriptor.providerId,
    },
    usageRecordId: repairAuthority.usage.usageRecordId,
  };
  const evidence = base.review.evidence.map((record, index) =>
    evidenceRecordV1Schema.parse({
      ...record,
      artifacts: record.artifacts.map((candidateArtifact) => ({
        ...candidateArtifact,
        digest: artifact.artifactDigest,
      })),
      checks: record.checks.map((check) => ({
        ...check,
        artifactDigests: [artifact.artifactDigest],
      })),
      id: "evidence-two-attempt-" + String(index),
      provenance: {
        ...record.provenance,
        inputDigests: [
          artifact.artifactDigest,
          digestCanonicalValue(sourceSolutionRevision),
        ],
      },
    }),
  );
  const review = candidateReviewRecordV1Schema.parse(
    redigestReview({
      ...base.review,
      artifact,
      attemptAuthority: replay.attemptAuthority,
      attempts: [generationAttempt, repairAttempt],
      evidence,
      extension: {
        ...base.review.extension,
        model: {
          ...base.review.extension.model,
          modelId: repairDescriptor.modelId,
          modelVersion: repairDescriptor.modelVersion,
          outputDigest: replay.bundleDigest,
          promptDigest: repairDescriptor.promptDigest,
          promptVersion: repairDescriptor.promptVersion,
          providerId: repairDescriptor.providerId,
          usageEventIds: [
            generationAuthority.usage.usageRecordId,
            repairAuthority.usage.usageRecordId,
          ],
        },
      },
      reviewId: "candidate-review-two-attempts",
    }),
  );
  await store.bindReview({
    artifactId: artifact.artifactId,
    boundAt: timestamp,
    expectedArtifactDigest: artifact.artifactDigest,
    reviewDigest: review.reviewDigest,
    reviewId: review.reviewId,
    scope,
  });
  return { artifact, review, store };
}
function redigestReview(
  review: CandidateReviewRecordV1,
): CandidateReviewRecordV1 {
  const withFinalProgress = {
    ...review,
    generationProgress:
      review.editRevalidations.length > 0
        ? review.generationProgress
        : {
            ...review.generationProgress,
            finalEvidenceCount: review.evidence.length,
            finalEvidenceDigest: digestCanonicalValue(review.evidence),
            finalIssueHistoryCount: review.issueHistory.length,
            finalIssueHistoryDigest: digestCanonicalValue(review.issueHistory),
            finalIssuesCount: review.issues.length,
            finalIssuesDigest: digestCanonicalValue(review.issues),
          },
  };
  const { reviewDigest: _reviewDigest, ...projection } = withFinalProgress;
  void _reviewDigest;
  return {
    ...projection,
    reviewDigest: digestCanonicalValue(projection),
  };
}

async function cloneCurrentStoreBoundToReview(
  source: CandidateArtifactStore,
  review: CandidateReviewRecordV1,
): Promise<InMemoryCandidateArtifactStore> {
  const stored = await source.read({
    artifactId: review.artifact.artifactId,
    expectedArtifactDigest: review.artifact.artifactDigest,
    scope: review.scope,
  });
  const store = new InMemoryCandidateArtifactStore();
  const artifact = await store.put({
    bundleDigest: stored.reference.bundleDigest,
    extensionId: stored.reference.extensionId,
    files: stored.files,
    origin: stored.reference.origin,
    scope: stored.reference.scope,
    solutionRevisionId: stored.reference.solutionRevisionId,
    storedAt: stored.reference.storedAt,
    targetKind: stored.targetKind,
    ...(stored.validationReplay === undefined
      ? {}
      : { validationReplay: stored.validationReplay }),
  });
  if (
    digestCanonicalValue(artifact) !== digestCanonicalValue(review.artifact)
  ) {
    throw new Error(
      "The review-binding fixture changed the artifact authority.",
    );
  }
  await store.bindReview({
    artifactId: artifact.artifactId,
    boundAt: artifact.storedAt,
    expectedArtifactDigest: artifact.artifactDigest,
    reviewDigest: review.reviewDigest,
    reviewId: review.reviewId,
    scope: review.scope,
  });
  return store;
}

function redigestExportRecord(input: unknown): unknown {
  const projection = structuredClone(input) as Partial<CandidateExportInputV1>;
  delete projection.exportInputDigest;
  return {
    ...projection,
    exportInputDigest: digestCanonicalValue(projection),
  };
}

function reidentifyAndRedigestExportRecord(input: unknown): unknown {
  const candidate = structuredClone(input) as CandidateExportInputV1;
  const withStableId = {
    ...candidate,
    exportInputId: getCandidateExportInputId({
      acceptanceAuthorization: candidate.acceptanceAuthorization,
      acceptedAt: candidate.createdAt,
      acceptedBy: candidate.createdBy,
      artifactDigest: candidate.artifact.artifactDigest,
      attemptAuthority: candidate.attemptAuthority,
      review: candidate.review,
      sourceSolutionRevision: candidate.sourceSolutionRevision,
      successorSolutionRevision: candidate.successorSolutionRevision,
    }),
  };
  return redigestExportRecord(withStableId);
}
function withoutStoredReviewBinding(
  stored: StoredCandidateArtifactV1,
): StoredCandidateArtifactV1 {
  const { reviewBinding: _reviewBinding, ...withoutReviewBinding } = stored;
  void _reviewBinding;
  return withoutReviewBinding;
}

function withStoredReviewDigest(
  stored: StoredCandidateArtifactV1,
  reviewDigest: CandidateReviewRecordV1["reviewDigest"],
): StoredCandidateArtifactV1 {
  if (stored.reviewBinding === undefined) {
    throw new Error("Missing stored review binding fixture.");
  }
  return {
    ...stored,
    reviewBinding: { ...stored.reviewBinding, reviewDigest },
  };
}
function storeWithMutatedRead(
  store: InMemoryCandidateArtifactStore,
  mutate: (stored: StoredCandidateArtifactV1) => StoredCandidateArtifactV1,
): CandidateArtifactStore {
  return {
    preserveInvalid: (input) => store.preserveInvalid(input),
    put: (input) => store.put(input),
    read: async (input) => mutate(await store.read(input)),
  };
}

async function applicationReviewFixture(
  sourceRevision = sourceSolutionRevision,
) {
  const base = await readyReviewFixture();
  const sourceEvidence = base.review.evidence[0];
  const sourceCheck = sourceEvidence?.checks[0];
  if (sourceEvidence === undefined || sourceCheck === undefined) {
    throw new Error("Missing fixture Evidence.");
  }
  const store = new InMemoryCandidateArtifactStore();
  const replay = validationReplay(
    "application",
    base.file.content,
    sourceRevision,
  );
  const artifact = await store.put({
    bundleDigest: replay.bundleDigest,
    extensionId: base.artifact.extensionId,
    files: [base.file],
    scope,
    solutionRevisionId,
    storedAt: timestamp,
    targetKind: "application",
    validationReplay: replay,
  });
  const artifactReference = {
    digest: artifact.artifactDigest,
    mediaType: "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
    sizeBytes: base.file.sizeBytes,
  };
  const staticEvidence = {
    ...sourceEvidence,
    artifacts: [artifactReference],
    checks: sourceEvidence.checks.map((check) => ({
      ...check,
      artifactDigests: [artifact.artifactDigest],
    })),
    provenance: {
      ...sourceEvidence.provenance,
      inputDigests: [
        artifact.artifactDigest,
        digestCanonicalValue(sourceRevision),
      ],
    },
  };
  const applicationEvidence = {
    ...staticEvidence,
    checks: [
      {
        ...sourceCheck,
        artifactDigests: [artifact.artifactDigest],
        checkId: "cloudmarkup.application.build-and-tests",
        generationCoverageRequirement: "application-build-and-tests",
        summary: "The exact candidate passed its application build and tests.",
      },
      {
        ...sourceCheck,
        artifactDigests: [artifact.artifactDigest],
        checkId: "cloudmarkup.application.security-checks",
        generationCoverageRequirement: "application-security-checks",
        summary: "The exact candidate passed application security checks.",
      },
    ],
    id: "evidence-application-1",
    level: { kind: "application-build-and-tests", rank: 5 },
  };
  const reviewWithOldDigest = {
    ...base.review,
    artifact,
    attemptAuthority: replay.attemptAuthority,
    attempts: base.review.attempts.map((attempt) => ({
      ...attempt,
      bundleDigest: replay.bundleDigest,
      idempotencyKeyDigest: replay.descriptor.idempotencyKeyDigest,
      invocationId: replay.descriptor.invocationId,
      mergedBundleDigest: replay.bundleDigest,
      model: {
        modelId: replay.descriptor.modelId,
        modelVersion: replay.descriptor.modelVersion,
        promptDigest: replay.descriptor.promptDigest,
        promptTemplateId: replay.descriptor.promptTemplateId,
        promptVersion: replay.descriptor.promptVersion,
        providerId: replay.descriptor.providerId,
      },
    })),
    evidence: [staticEvidence, applicationEvidence],
    generationProgress: {
      ...base.review.generationProgress,
      finalEvidenceCount: 2,
      finalEvidenceDigest: digestCanonicalValue([
        staticEvidence,
        applicationEvidence,
      ]),
    },
    extension: {
      ...base.review.extension,
      model: {
        ...base.review.extension.model,
        outputDigest: replay.bundleDigest,
      },
      target: {
        fileType: "application.typescript",
        kind: "application",
        language: "language.typescript",
        workloadId: "workload-custom",
      },
    },
  };
  const { reviewDigest: _reviewDigest, ...projection } = reviewWithOldDigest;
  void _reviewDigest;
  const review = candidateReviewRecordV1Schema.parse({
    ...projection,
    reviewDigest: digestCanonicalValue(projection),
  });
  await store.bindReview({
    artifactId: artifact.artifactId,
    boundAt: timestamp,
    expectedArtifactDigest: artifact.artifactDigest,
    reviewDigest: review.reviewDigest,
    reviewId: review.reviewId,
    scope,
  });
  return { review, store };
}

function sourceCoverageAuthority(
  input: {
    readonly includeIncompleteWorkload?: boolean;
    readonly targetUnresolved?: boolean;
  } = {},
) {
  const artifactDigest = sourceSolutionRevision.architecture.contentHash;
  const artifact = {
    digest: artifactDigest,
    mediaType: "application/vnd.cloudmarkup.architecture-document.v3+json",
    sizeBytes: 1,
  };
  const common = {
    artifacts: [artifact],
    contractVersion: 1 as const,
    environment: { environmentType: "test" as const },
    layer: "designed" as const,
    models: [],
    provenance: {
      actor: {
        kind: "deterministic-tool" as const,
        tool: { id: "cloudmarkup.source-validation", version: "1.0.0" },
      },
      createdAt: timestamp,
      inputDigests: [artifactDigest],
    },
    solutionRevisionId,
    staleness: { assessedAt: timestamp, state: "current" as const },
    tools: [{ id: "cloudmarkup.source-validation", version: "1.0.0" }],
  };
  const structural = evidenceRecordV1Schema.parse({
    ...common,
    checks: [
      {
        artifactDigests: [artifactDigest],
        checkId: "cloudmarkup.source.structural-validity",
        generationCoverageRequirement: "structural-validity",
        issueIds: [],
        status: "passed",
        summary: "The frozen source architecture passed structural validation.",
      },
    ],
    id: "evidence-source-structural",
    level: { kind: "structural-validity", rank: 1 },
  });
  const provider = evidenceRecordV1Schema.parse({
    ...common,
    checks: [
      {
        artifactDigests: [artifactDigest],
        checkId: "cloudmarkup.source.provider-validity",
        generationCoverageRequirement: "provider-architecture-validity",
        issueIds: [],
        status: "passed",
        summary: "The frozen source architecture passed provider validation.",
      },
    ],
    id: "evidence-source-provider",
    level: { kind: "provider-architecture-validity", rank: 2 },
  });
  const coverageEvidence = [
    { evidenceId: structural.id, requirement: "structural-validity" as const },
    {
      evidenceId: provider.id,
      requirement: "provider-architecture-validity" as const,
    },
  ];
  const remainingTargetRequirements = [
    "ai-extension-parse-static-validity",
    "application-build-and-tests",
    "application-security-checks",
  ] as const;
  const sourceRevision = solutionRevisionManifestV1Schema.parse({
    ...sourceSolutionRevision,
    evidenceIdsAtFreeze: [structural.id, provider.id],
    generationCoverage: {
      ...sourceSolutionRevision.generationCoverage,
      evidence: coverageEvidence,
      missingRequirements: [
        ...remainingTargetRequirements,
        ...(input.includeIncompleteWorkload
          ? (["deterministic-application-generation"] as const)
          : []),
      ],
      workloads: [
        {
          evidence: coverageEvidence,
          missingRequirements: [...remainingTargetRequirements],
          state: "custom-implementation-required",
          unresolvedRequirementIds: input.targetUnresolved
            ? ["requirement-unresolved-custom-behavior"]
            : [],
          workloadId: "workload-custom",
        },
        ...(input.includeIncompleteWorkload
          ? [
              {
                evidence: coverageEvidence,
                missingRequirements: [
                  "deterministic-application-generation" as const,
                ],
                state: "custom-implementation-required" as const,
                unresolvedRequirementIds: [
                  "requirement-other-workload-behavior",
                ],
                workloadId: "workload-other",
              },
            ]
          : []),
      ],
    },
  });
  return {
    sourceEvidence: {
      contractVersion: 1 as const,
      records: [structural, provider],
    },
    sourceSolutionRevision: sourceRevision,
  };
}

async function warningReviewFixture() {
  const fixture = await readyReviewFixture();
  const warningDiagnostic = candidateDiagnosticV1Schema.parse({
    category: "format",
    checkId: "cloudmarkup.ai-extension.review-note",
    code: "cloudmarkup.ai-extension.review-note",
    path: candidatePath,
    repairable: false,
    severity: "warning",
    summary: "Review the accepted formatter convention.",
    technicalDetail:
      "The candidate remains valid, but the immutable warning stays visible with its exact provenance.",
  });
  const issue = createCandidateIssues({
    assessedAt: timestamp,
    bundleDigest: fixture.artifact.bundleDigest,
    diagnostics: [warningDiagnostic],
    extensionId,
    inputDigests: [fixture.artifact.artifactDigest],
    solutionRevisionId,
    source: "ai-generation-repair",
  })[0];
  if (issue === undefined) throw new Error("Missing warning issue fixture.");
  const review = candidateReviewRecordV1Schema.parse(
    redigestReview({
      ...fixture.review,
      diagnostics: [warningDiagnostic],
      extension: {
        ...fixture.review.extension,
        issueIds: [issue.id],
      },
      issueHistory: [issue],
      issues: [issue],
    }),
  );
  return {
    ...fixture,
    issue,
    review,
    store: await cloneCurrentStoreBoundToReview(fixture.store, review),
  };
}

async function editReviewFixture(input: {
  readonly fixture: {
    readonly artifact: CandidateReviewRecordV1["artifact"];
    readonly file: MaterializedCandidateFile;
    readonly review: CandidateReviewRecordV1;
    readonly store: InMemoryCandidateArtifactStore;
  };
  readonly sequence: number;
}) {
  const editedAt = utcTimestampSchema.parse(
    "2026-08-21T12:0" + String(input.sequence) + ":00Z",
  );
  const previousStored = await input.fixture.store.read({
    artifactId: input.fixture.review.artifact.artifactId,
    expectedArtifactDigest: input.fixture.review.artifact.artifactDigest,
    scope,
  });
  const content = [
    'resource "aws_cloudwatch_log_group" "custom" {',
    `  name = "/cloudmarkup/custom-edit-${String(input.sequence)}"`,
    "}",
    "",
  ].join("\n");
  const previousFile = previousStored.files[0];
  if (previousFile === undefined) {
    throw new Error("Missing edited file fixture.");
  }
  const file: MaterializedCandidateFile = {
    ...previousFile,
    content,
    digest: sha256Text(content),
    sizeBytes: new TextEncoder().encode(content).byteLength,
  };
  const currentReplay = validationReplay("iac-extension", content);
  const replay = {
    ...currentReplay,
    attemptAuthority:
      previousStored.validationReplay?.attemptAuthority ??
      currentReplay.attemptAuthority,
  };
  const previousOrigin = input.fixture.review.artifact.origin;
  const previousEdits =
    previousOrigin.kind === "user-modified" ? previousOrigin.edits : [];
  const origin = {
    baseArtifactDigest:
      previousOrigin.kind === "user-modified"
        ? previousOrigin.baseArtifactDigest
        : input.fixture.review.artifact.artifactDigest,
    baseArtifactId:
      previousOrigin.kind === "user-modified"
        ? previousOrigin.baseArtifactId
        : input.fixture.review.artifact.artifactId,
    edits: [
      ...previousEdits,
      {
        authorizationDecisionId: `authorization-edit-${String(input.sequence)}`,
        editId: `candidate-edit-${String(input.sequence)}`,
        editedAt,
        editedBy: "reviewer-1",
        path: candidatePath,
        priorDigest: previousFile.digest,
        resultDigest: file.digest,
      },
    ],
    kind: "user-modified" as const,
    modelOutputDigest: previousOrigin.modelOutputDigest,
    parentArtifactDigest: input.fixture.review.artifact.artifactDigest,
    parentArtifactId: input.fixture.review.artifact.artifactId,
  };

  const artifact = createCandidateArtifactReference({
    bundleDigest: replay.bundleDigest,
    extensionId,
    files: [file],
    origin,
    scope,
    solutionRevisionId,
    storedAt: editedAt,
    targetKind: "terraform",
    validationReplay: replay,
  });
  const previousEvidence = input.fixture.review.evidence.at(-1);
  const latestEdit = origin.edits.at(-1);
  if (previousEvidence === undefined || latestEdit === undefined) {
    throw new Error("Missing prior edit authority fixture.");
  }
  const currentEvidence = evidenceRecordV1Schema.parse({
    ...previousEvidence,
    artifacts: [
      {
        digest: artifact.artifactDigest,
        mediaType: "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
        sizeBytes: file.sizeBytes,
      },
    ],
    checks: previousEvidence.checks.map((check) => ({
      ...check,
      artifactDigests: [artifact.artifactDigest],
      status: "passed" as const,
      summary: "The edited candidate passed deterministic validation.",
    })),
    id: `evidence-static-edit-${String(input.sequence)}`,
    provenance: {
      ...previousEvidence.provenance,
      createdAt: editedAt,
      inputDigests: [
        artifact.artifactDigest,
        digestCanonicalValue(sourceSolutionRevision),
      ],
    },
    staleness: { assessedAt: editedAt, state: "current" as const },
  });
  const evidence = [...input.fixture.review.evidence, currentEvidence];
  const authorizationRequest = {
    action: "edit" as const,
    artifactDigest: input.fixture.review.artifact.artifactDigest,
    contractVersion: 1 as const,
    reviewDigest: input.fixture.review.reviewDigest,
    reviewId: input.fixture.review.reviewId,
    scope,
    solutionRevisionId,
  };
  const authorizationDecision = {
    action: "edit" as const,
    allowed: true as const,
    authoritySource: "verified-authentication-context" as const,
    contractVersion: 1 as const,
    decidedAt: editedAt,
    decisionId: latestEdit.authorizationDecisionId,
    principalId: "reviewer-1",
    requestDigest:
      getCandidateReviewAuthorizationRequestDigest(authorizationRequest),
  };
  const reviewId = `candidate-review-${digestCanonicalValue({
    artifactDigest: artifact.artifactDigest,
    priorReviewDigest: input.fixture.review.reviewDigest,
  }).slice("sha256:".length, 38)}`;
  const priorEditRevalidations = input.fixture.review.editRevalidations;
  const parentProgressFinalization =
    priorEditRevalidations.at(-1) ?? input.fixture.review.generationProgress;
  const editRevalidationProjection = {
    artifactDigest: artifact.artifactDigest,
    artifactId: artifact.artifactId,
    artifactStoredAt: artifact.storedAt,
    authorityKind: "candidate-edit-revalidation" as const,
    authorizationDecision,
    contractVersion: 1 as const,
    editCount: origin.edits.length,
    editLineageDigest: digestCanonicalValue(origin.edits),
    evidenceCount: evidence.length,
    evidenceDigest: digestCanonicalValue(evidence),
    issueHistoryCount: input.fixture.review.issueHistory.length,
    finalIssueHistoryDigest: digestCanonicalValue(
      input.fixture.review.issueHistory,
    ),
    finalIssuesCount: input.fixture.review.issues.length,
    finalIssuesDigest: digestCanonicalValue(input.fixture.review.issues),
    parentArtifactDigest: input.fixture.review.artifact.artifactDigest,
    parentArtifactId: input.fixture.review.artifact.artifactId,
    parentProgressFinalizationDigest: digestCanonicalValue(
      parentProgressFinalization,
    ),
    parentReviewDigest: input.fixture.review.reviewDigest,
    parentReviewId: input.fixture.review.reviewId,
    priorEditCount: previousEdits.length,
    priorEditLineageDigest: digestCanonicalValue(previousEdits),
    revalidatedAt: editedAt,
    scope,
    solutionRevisionId,
    state: "finalized" as const,
    terminalPhase: "edit-revalidated" as const,
    terminalResultKind: "candidate-review" as const,
    validationDigest: digestCanonicalValue(input.fixture.review.validation),
  };
  const editRevalidation = candidateEditRevalidationFinalizationV1Schema.parse({
    ...editRevalidationProjection,
    finalizationDigest: getCandidateEditRevalidationFinalizationDigest(
      editRevalidationProjection,
    ),
  });
  const review = candidateReviewRecordV1Schema.parse(
    redigestReview({
      ...input.fixture.review,
      artifact,
      editRevalidations: [...priorEditRevalidations, editRevalidation],
      evidence,
      extension: {
        ...input.fixture.review.extension,
        outputs: [
          {
            digest: file.digest,
            kind: file.sourceKind,
            path: file.path,
            sizeBytes: file.sizeBytes,
          },
        ],
      },
      reviewId,
    }),
  );
  const storedArtifact = await input.fixture.store.supersede({
    bundleDigest: replay.bundleDigest,
    expectedSupersededArtifactDigest:
      input.fixture.review.artifact.artifactDigest,
    expectedSupersededReview: {
      reviewDigest: input.fixture.review.reviewDigest,
      reviewId: input.fixture.review.reviewId,
    },
    extensionId,
    files: [file],
    origin,
    scope,
    solutionRevisionId,
    storedAt: editedAt,
    successorReview: {
      boundAt: editedAt,
      reviewDigest: review.reviewDigest,
      reviewId: review.reviewId,
    },
    supersededArtifactId: input.fixture.review.artifact.artifactId,
    supersededAt: editedAt,
    targetKind: "terraform",
    validationReplay: replay,
  });
  if (digestCanonicalValue(storedArtifact) !== digestCanonicalValue(artifact)) {
    throw new Error("The edit fixture store changed the content address.");
  }
  return {
    artifact,
    file,
    review,
    store: input.fixture.store,
  };
}

function withoutHistoricalRead(
  store: InMemoryCandidateArtifactStore,
): CandidateArtifactStore {
  return {
    preserveInvalid: (input) => store.preserveInvalid(input),
    put: (input) => store.put(input),
    read: (input) => store.read(input),
    supersede: (input) => store.supersede(input),
  };
}

function withHistoricalMutation(
  store: InMemoryCandidateArtifactStore,
  mutate: (stored: StoredCandidateArtifactV1) => StoredCandidateArtifactV1,
): CandidateArtifactStore {
  return {
    preserveInvalid: (input) => store.preserveInvalid(input),
    put: (input) => store.put(input),
    read: (input) => store.read(input),
    readImmutable: async (input) => mutate(await store.readImmutable(input)),
    supersede: (input) => store.supersede(input),
  };
}

describe("candidate review decisions", () => {
  it("serializes exact reviewer authority and preserves review state", async () => {
    const { review, store } = await warningReviewFixture();
    const result = await acceptCandidateReview({
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: store,
      expectedReviewDigest: review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review,
    });

    expect(result.decision.authorizationDecisionId).toBe(
      "authorization-accept-reviewer-1",
    );
    expect(result.exportInput.acceptanceAuthorizationDecisionId).toBe(
      result.decision.authorizationDecisionId,
    );
    expect(result.decision.decidedBy).toBe("reviewer-1");
    expect(result.exportInput.createdBy).toBe("reviewer-1");
    expect(result.decision.authorization).toEqual(
      result.exportInput.acceptanceAuthorization,
    );
    expect(result.decision.review).toEqual(review);
    expect(result.exportInput.review).toEqual(review);
    expect(result.exportInput.sourceSolutionRevision).toEqual(
      sourceSolutionRevision,
    );
    expect(result.exportInput.reviewEvidence).toEqual(review.evidence);
    expect(result.exportInput.issues).toEqual(review.issues);
    expect(result.exportInput.issueHistory).toEqual(review.issueHistory);
    expect(result.exportInput.sourceIssueIdsAtFreeze).toEqual(
      sourceSolutionRevision.issueIdsAtFreeze,
    );
    expect(
      result.exportInput.successorSolutionRevision.issueIdsAtFreeze,
    ).toEqual([review.issues[0]?.id]);
    for (const tampered of [
      { ...result.exportInput, reviewEvidence: [] },
      { ...result.exportInput, issueHistory: [] },
      { ...result.exportInput, issues: [] },
    ]) {
      expect(
        candidateExportInputV1Schema.safeParse(redigestExportRecord(tampered))
          .success,
      ).toBe(false);
    }
  });

  it("rejects independently valid serialized authority divergence", async () => {
    const { review, store } = await readyReviewFixture();
    const result = await acceptCandidateReview({
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: store,
      expectedReviewDigest: review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review,
    });
    const wrongDigest = sha256Text("forged-export-output");
    const invalidExports = [
      redigestExportRecord({
        ...result.exportInput,
        extension: {
          ...result.exportInput.extension,
          outputs: result.exportInput.extension.outputs.map((output) => ({
            ...output,
            digest: wrongDigest,
          })),
        },
      }),
      redigestExportRecord({
        ...result.exportInput,
        extension: {
          ...result.exportInput.extension,
          model: {
            ...result.exportInput.extension.model,
            modelVersion: "forged-model-version",
          },
        },
      }),
      redigestExportRecord({
        ...result.exportInput,
        extension: {
          ...result.exportInput.extension,
          acceptance: { state: "pending" },
          exportSafety: {
            missingEvidenceKinds: ["cloudmarkup.user-acceptance"],
            state: "not-safe",
          },
        },
      }),
      redigestExportRecord({
        ...result.exportInput,
        extension: {
          ...result.exportInput.extension,
          exportSafety: {
            evidenceIds: ["evidence-forged"],
            state: "safe-to-export",
          },
        },
      }),
      redigestExportRecord({
        ...result.exportInput,
        evidence: {
          ...result.exportInput.evidence,
          records: result.exportInput.evidence.records.map((record) => ({
            ...record,
            staleness: {
              assessedAt: result.exportInput.createdAt,
              reason: "Tampered after validation.",
              staleAt: result.exportInput.createdAt,
              state: "stale",
            },
          })),
        },
      }),
      redigestExportRecord({
        ...result.exportInput,
        sourceIssueIdsAtFreeze: ["issue-injected"],
      }),
    ];
    invalidExports.forEach((candidate) => {
      expect(candidateExportInputV1Schema.safeParse(candidate).success).toBe(
        false,
      );
    });

    const divergentResults = [
      {
        ...result,
        decision: {
          ...result.decision,
          artifact: {
            ...result.decision.artifact,
            artifactId: "candidate-divergent",
          },
        },
      },
      {
        ...result,
        decision: {
          ...result.decision,
          authorizationDecisionId: "authorization-accept-another-reviewer",
        },
      },
      {
        ...result,
        decision: {
          ...result.decision,
          extension: {
            ...result.decision.extension,
            regenerationPolicy: "manual-only",
          },
        },
      },
    ];
    divergentResults.forEach((candidate) => {
      expect(
        candidateAcceptanceResultV1Schema.safeParse(candidate).success,
      ).toBe(false);
    });
  });

  it("rejects paired opaque review and authorization substitutions after stable re-identification", async () => {
    const { review, store } = await readyReviewFixture();
    const result = await acceptCandidateReview({
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: store,
      expectedReviewDigest: review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review,
    });
    const substitutedReviewDigest = sha256Text("substituted-review-record");
    const substitutedReviewExport = reidentifyAndRedigestExportRecord({
      ...result.exportInput,
      reviewDigest: substitutedReviewDigest,
      reviewId: "candidate-review-substituted",
    });
    const substitutedReviewResult = {
      ...result,
      decision: {
        ...result.decision,
        reviewDigest: substitutedReviewDigest,
        reviewId: "candidate-review-substituted",
      },
      exportInput: substitutedReviewExport,
    };
    expect(
      candidateExportInputV1Schema.safeParse(substitutedReviewExport).success,
    ).toBe(false);
    expect(
      candidateAcceptanceResultV1Schema.safeParse(substitutedReviewResult)
        .success,
    ).toBe(false);

    const substitutedAuthorizationExport = reidentifyAndRedigestExportRecord({
      ...result.exportInput,
      acceptanceAuthorizationDecisionId: "authorization-accept-substituted",
    });
    const substitutedAuthorizationResult = {
      ...result,
      decision: {
        ...result.decision,
        authorizationDecisionId: "authorization-accept-substituted",
      },
      exportInput: substitutedAuthorizationExport,
    };
    expect(
      candidateExportInputV1Schema.safeParse(substitutedAuthorizationExport)
        .success,
    ).toBe(false);
    expect(
      candidateAcceptanceResultV1Schema.safeParse(
        substitutedAuthorizationResult,
      ).success,
    ).toBe(false);
  });

  it("rejects coherent review substitutions and missing or wrong stored bindings", async () => {
    const { review, store } = await readyReviewFixture();
    const request = {
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      expectedSolutionRevisionId: solutionRevisionId,
    };
    const substitutedReview = candidateReviewRecordV1Schema.parse(
      redigestReview({
        ...review,
        reviewId: "candidate-review-coherent-substitution",
      }),
    );
    await expect(
      acceptCandidateReview({
        ...request,
        artifactStore: store,
        expectedReviewDigest: substitutedReview.reviewDigest,
        review: substitutedReview,
      }),
    ).rejects.toThrow(/exact immutable stored artifact review binding/u);

    for (const artifactStore of [
      storeWithMutatedRead(store, withoutStoredReviewBinding),
      storeWithMutatedRead(store, (stored) =>
        withStoredReviewDigest(stored, sha256Text("wrong-stored-review")),
      ),
    ]) {
      await expect(
        acceptCandidateReview({
          ...request,
          artifactStore,
          expectedReviewDigest: review.reviewDigest,
          review,
        }),
      ).rejects.toThrow(/exact immutable stored artifact review binding/u);
    }
  });
  it("rejects a self-consistent source manifest and digest substitution", async () => {
    const { review, store } = await readyReviewFixture();
    const result = await acceptCandidateReview({
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: store,
      expectedReviewDigest: review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review,
    });
    const substitutedSource = solutionRevisionManifestV1Schema.parse({
      ...result.exportInput.sourceSolutionRevision,
      createdBy: "actor-substituted-source",
    });
    const substitutedExport = reidentifyAndRedigestExportRecord({
      ...result.exportInput,
      sourceSolutionRevision: substitutedSource,
      sourceSolutionRevisionDigest: digestCanonicalValue(substitutedSource),
    });

    expect(
      candidateExportInputV1Schema.safeParse(substitutedExport).success,
    ).toBe(false);
  });

  it("validates every ordered attempt against stored replay authority without exposing historical source bytes", async () => {
    const { review, store } = await twoAttemptReadyReviewFixture();
    const request = {
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: store,
      expectedReviewDigest: review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review,
    };
    const accepted = await acceptCandidateReview(request);
    const serializedPresentation = JSON.stringify({
      attemptAuthority: accepted.exportInput.attemptAuthority,
      attempts: accepted.exportInput.attempts,
      review: accepted.exportInput.review,
    });
    for (const forbiddenKey of [
      '"bundle":',
      '"content":',
      '"mergedBundle":',
      '"rawBundle":',
    ]) {
      expect(serializedPresentation).not.toContain(forbiddenKey);
    }

    const historicalSourceMarker =
      "HISTORICAL_FAILED_ATTEMPT_SOURCE_MUST_NOT_ESCAPE";
    const reviewWithHistoricalBytes = redigestReview({
      ...review,
      attemptAuthority: review.attemptAuthority.map((authority, index) =>
        index === 0
          ? {
              ...authority,
              rawBundle: { content: historicalSourceMarker },
            }
          : authority,
      ),
    });
    expect(
      candidateReviewRecordV1Schema.safeParse(reviewWithHistoricalBytes)
        .success,
    ).toBe(false);

    const stored = await store.read({
      artifactId: review.artifact.artifactId,
      expectedArtifactDigest: review.artifact.artifactDigest,
      scope,
    });
    if (stored.validationReplay === undefined) {
      throw new Error("Missing trusted two-attempt replay.");
    }
    const firstAuthority = stored.validationReplay.attemptAuthority[0];
    if (firstAuthority === undefined) {
      throw new Error("Missing trusted attempt-zero authority.");
    }
    const substitutedDescriptor = modelInvocationDescriptorV1Schema.parse({
      ...firstAuthority.descriptor,
      modelVersion: "forged-attempt-zero-model",
      promptDigest: sha256Text("forged-attempt-zero-prompt"),
      promptVersion: "1.0.1",
    });
    const substitutedBundleDigest = sha256Text(
      "forged-attempt-zero-raw-and-merged-bundle",
    );
    const substitutedFirstAuthority = {
      ...firstAuthority,
      descriptor: substitutedDescriptor,
      mergedBundleDigest: substitutedBundleDigest,
      rawBundleDigest: substitutedBundleDigest,
      usage: normalizedModelUsageV1Schema.parse({
        ...firstAuthority.usage,
        inputUnits: "999",
        modelVersion: substitutedDescriptor.modelVersion,
        promptVersion: substitutedDescriptor.promptVersion,
      }),
    };
    const substitutedReplay = candidateValidationReplayV1Schema.parse({
      ...stored.validationReplay,
      attemptAuthority: [
        substitutedFirstAuthority,
        ...stored.validationReplay.attemptAuthority.slice(1),
      ],
    });
    const substitutedStore = storeWithMutatedRead(store, (current) => ({
      ...current,
      validationReplay: substitutedReplay,
    }));

    await expect(
      acceptCandidateReview({
        ...request,
        artifactStore: substitutedStore,
      }),
    ).rejects.toThrow(/full-validation replay/u);
  });
  it("accepts a fully verified repeated user-edit lineage reproducibly", async () => {
    const base = await readyReviewFixture();
    const first = await editReviewFixture({ fixture: base, sequence: 1 });
    const second = await editReviewFixture({ fixture: first, sequence: 2 });
    const request = {
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: second.store,
      expectedReviewDigest: second.review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review: second.review,
    };
    const result = await acceptCandidateReview(request);

    expect(first.review.generationProgress).toEqual(
      base.review.generationProgress,
    );
    expect(second.review.generationProgress).toEqual(
      base.review.generationProgress,
    );
    expect(first.review.editRevalidations).toHaveLength(1);
    expect(second.review.editRevalidations).toHaveLength(2);
    expect(second.review.editRevalidations.slice(0, 1)).toEqual(
      first.review.editRevalidations,
    );
    expect(result.decision.review.generationProgress).toEqual(
      base.review.generationProgress,
    );
    expect(result.exportInput.review.generationProgress).toEqual(
      base.review.generationProgress,
    );
    expect(result.decision.review.editRevalidations).toEqual(
      second.review.editRevalidations,
    );
    expect(result.exportInput.review.editRevalidations).toEqual(
      second.review.editRevalidations,
    );
    expect(result.exportInput.userModifications).toEqual(
      second.review.artifact.origin.kind === "user-modified"
        ? second.review.artifact.origin.edits
        : [],
    );
    expect(result.exportInput.userModifications).toHaveLength(2);
    expect(await acceptCandidateReview(request)).toEqual(result);
    await expect(
      acceptCandidateReview({
        ...request,
        expectedReviewDigest: base.review.reviewDigest,
        review: base.review,
      }),
    ).rejects.toThrow(/unavailable|current/u);
  });

  it("rejects a candidate superseded while historical lineage reads are deferred", async () => {
    const base = await readyReviewFixture();
    const first = await editReviewFixture({ fixture: base, sequence: 1 });
    const second = await editReviewFixture({ fixture: first, sequence: 2 });
    let releaseHistory: (() => void) | undefined;
    let signalHistoryRead: (() => void) | undefined;
    const historyReleased = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    const historyReadStarted = new Promise<void>((resolve) => {
      signalHistoryRead = resolve;
    });
    const raceStore: CandidateArtifactStore = {
      bindReview: (input) => second.store.bindReview(input),
      preserveInvalid: (input) => second.store.preserveInvalid(input),
      put: (input) => second.store.put(input),
      read: (input) => second.store.read(input),
      readImmutable: async (input) => {
        const stored = await second.store.readImmutable(input);
        signalHistoryRead?.();
        await historyReleased;
        return stored;
      },
      supersede: (input) => second.store.supersede(input),
    };
    const pendingAcceptance = acceptCandidateReview({
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: raceStore,
      expectedReviewDigest: second.review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review: second.review,
    });
    await historyReadStarted;
    await editReviewFixture({ fixture: second, sequence: 3 });
    releaseHistory?.();

    await expect(pendingAcceptance).rejects.toThrow(/unavailable|changed/u);
  });
  it("keeps failed pre-edit Evidence in audit history without promoting it into the successor freeze", async () => {
    const base = await readyReviewFixture();
    const priorEvidence = base.review.evidence[0];
    if (priorEvidence === undefined) {
      throw new Error("Missing pre-edit Evidence fixture.");
    }
    const failedPriorEvidence = evidenceRecordV1Schema.parse({
      ...priorEvidence,
      checks: priorEvidence.checks.map((check) => ({
        ...check,
        status: "failed",
        summary: "The pre-edit candidate failed deterministic validation.",
      })),
      id: "evidence-static-failed-before-edit",
      staleness: {
        assessedAt: "2026-08-21T12:01:00Z",
        reason: "A later user edit superseded this failed artifact.",
        staleAt: "2026-08-21T12:01:00Z",
        state: "stale",
      },
    });
    const failedBaseReview = candidateReviewRecordV1Schema.parse(
      redigestReview({
        ...base.review,
        evidence: [failedPriorEvidence],
      }),
    );
    const failedStore = await cloneCurrentStoreBoundToReview(
      base.store,
      failedBaseReview,
    );
    const edited = await editReviewFixture({
      fixture: { ...base, review: failedBaseReview, store: failedStore },
      sequence: 1,
    });
    const review = edited.review;
    const result = await acceptCandidateReview({
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: edited.store,
      expectedReviewDigest: review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review,
    });

    expect(result.exportInput.reviewEvidence).toEqual(review.evidence);
    expect(result.exportInput.review.evidence).toEqual(review.evidence);
    expect(
      result.exportInput.reviewEvidence.some(
        ({ id }) => id === failedPriorEvidence.id,
      ),
    ).toBe(true);
    expect(result.exportInput.evidence.records).toHaveLength(1);
    expect(
      result.exportInput.evidence.records.every((record) =>
        record.checks.every(({ status }) => status === "passed"),
      ),
    ).toBe(true);
    expect(
      result.exportInput.evidence.records.flatMap(
        ({ provenance }) => provenance.inputDigests,
      ),
    ).not.toContain(base.artifact.artifactDigest);
  });
  it("rejects a fully recomputed edited parent-review substitution at the immutable historical binding", async () => {
    const base = await readyReviewFixture();
    const edited = await editReviewFixture({ fixture: base, sequence: 1 });
    const originalRevalidation = edited.review.editRevalidations[0];
    if (originalRevalidation === undefined) {
      throw new Error("Missing edit revalidation fixture.");
    }
    const substitutedParentReviewDigest = sha256Text(
      "coherent-substituted-parent-review",
    );
    const substitutedAuthorizationRequest = {
      action: "edit" as const,
      artifactDigest: originalRevalidation.parentArtifactDigest,
      contractVersion: 1 as const,
      reviewDigest: substitutedParentReviewDigest,
      reviewId: originalRevalidation.parentReviewId,
      scope: edited.review.scope,
      solutionRevisionId: edited.review.artifact.solutionRevisionId,
    };
    const substitutedAuthorizationDecision = {
      ...originalRevalidation.authorizationDecision,
      requestDigest: getCandidateReviewAuthorizationRequestDigest(
        substitutedAuthorizationRequest,
      ),
    };
    const {
      finalizationDigest: _originalFinalizationDigest,
      ...originalRevalidationProjection
    } = originalRevalidation;
    void _originalFinalizationDigest;
    const substitutedRevalidationProjection = {
      ...originalRevalidationProjection,
      authorizationDecision: substitutedAuthorizationDecision,
      parentReviewDigest: substitutedParentReviewDigest,
    };
    const substitutedRevalidation =
      candidateEditRevalidationFinalizationV1Schema.parse({
        ...substitutedRevalidationProjection,
        finalizationDigest: getCandidateEditRevalidationFinalizationDigest(
          substitutedRevalidationProjection,
        ),
      });
    const substitutedReviewId = `candidate-review-${digestCanonicalValue({
      artifactDigest: edited.review.artifact.artifactDigest,
      priorReviewDigest: substitutedParentReviewDigest,
    }).slice("sha256:".length, 38)}`;
    const substitutedReview = candidateReviewRecordV1Schema.parse(
      redigestReview({
        ...edited.review,
        editRevalidations: [substitutedRevalidation],
        reviewId: substitutedReviewId,
      }),
    );
    const substitutedCurrentStore = await cloneCurrentStoreBoundToReview(
      edited.store,
      substitutedReview,
    );
    const splitAuthorityStore: CandidateArtifactStore = {
      preserveInvalid: (input) =>
        substitutedCurrentStore.preserveInvalid(input),
      put: (input) => substitutedCurrentStore.put(input),
      read: (input) => substitutedCurrentStore.read(input),
      readImmutable: (input) => edited.store.readImmutable(input),
    };
    const immutableParent = await edited.store.readImmutable({
      artifactId: base.review.artifact.artifactId,
      expectedArtifactDigest: base.review.artifact.artifactDigest,
      scope,
    });
    expect(immutableParent.reviewBinding?.reviewDigest).toBe(
      base.review.reviewDigest,
    );
    expect(substitutedRevalidation.parentReviewDigest).not.toBe(
      immutableParent.reviewBinding?.reviewDigest,
    );

    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: splitAuthorityStore,
        expectedReviewDigest: substitutedReview.reviewDigest,
        expectedSolutionRevisionId: solutionRevisionId,
        review: substitutedReview,
      }),
    ).rejects.toThrow(/exact immutable stored artifact review binding/u);
  });
  it("fails closed when edited-candidate historical authority is unavailable or forged", async () => {
    const base = await readyReviewFixture();
    const edited = await editReviewFixture({ fixture: base, sequence: 1 });
    const request = {
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      expectedReviewDigest: edited.review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review: edited.review,
    };
    await expect(
      acceptCandidateReview({
        ...request,
        artifactStore: withoutHistoricalRead(edited.store),
      }),
    ).rejects.toThrow(/immutable historical artifact authority/u);
    await expect(
      acceptCandidateReview({
        ...request,
        artifactStore: withHistoricalMutation(edited.store, (stored) => ({
          ...stored,
          lifecycle: { state: "current" },
        })),
      }),
    ).rejects.toThrow(/predecessor and successor lifecycle/u);
    await expect(
      acceptCandidateReview({
        ...request,
        artifactStore: withHistoricalMutation(edited.store, (stored) => ({
          ...stored,
          reference: {
            ...stored.reference,
            artifactId: "candidate-forged-base",
          },
        })),
      }),
    ).rejects.toThrow(/predecessor and successor lifecycle/u);
    for (const artifactStore of [
      withHistoricalMutation(edited.store, withoutStoredReviewBinding),
      withHistoricalMutation(edited.store, (stored) =>
        withStoredReviewDigest(stored, sha256Text("wrong-historical-review")),
      ),
    ]) {
      await expect(
        acceptCandidateReview({ ...request, artifactStore }),
      ).rejects.toThrow(/exact immutable stored artifact review binding/u);
    }
    const missingHistory: CandidateArtifactStore = {
      ...withoutHistoricalRead(edited.store),
      readImmutable: () =>
        Promise.reject(new Error("Immutable ancestor is missing.")),
    };
    await expect(
      acceptCandidateReview({
        ...request,
        artifactStore: missingHistory,
      }),
    ).rejects.toThrow(/ancestor is missing/u);
  });

  it("accepts only a current review-ready candidate with exact evidence", async () => {
    const { artifact, review, store } = await readyReviewFixture();

    const result = await acceptCandidateReview({
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: store,
      expectedReviewDigest: review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review,
    });
    const { decision, exportInput } = result;

    expect(decision).toMatchObject({
      decision: "accepted",
      deploymentAuthority: "none",
      extension: {
        acceptance: { state: "accepted" },
        exportSafety: { state: "safe-to-export" },
        solutionRevisionId: successorSolutionRevisionId,
      },
      reviewDigest: review.reviewDigest,
      sourceSolutionRevisionId: solutionRevisionId,
      successorSolutionRevisionId,
      writeAuthority: "none",
    });
    expect(decision.extension.exportSafety).toMatchObject({
      evidenceIds: [expect.stringMatching(/^evidence-successor-/u)],
    });
    expect(exportInput).toMatchObject({
      artifactReadAuthority: "restricted-candidate-artifact-only",
      classification: "immutable-solution-revision-export-input",
      deploymentAuthority: "none",
      repositoryWriteAuthority: "none",
      sourceSolutionRevisionId: solutionRevisionId,
      successorSolutionRevision: {
        aiExtensionIds: [extensionId],
        solutionRevisionId: successorSolutionRevisionId,
      },
      userModifications: [],
    });
    expect(exportInput.evidence.records).toHaveLength(1);
    expect(exportInput.evidence.records[0]?.solutionRevisionId).toBe(
      successorSolutionRevisionId,
    );
    expect(exportInput.successorSolutionRevisionDigest).toBe(
      digestCanonicalValue(exportInput.successorSolutionRevision),
    );
    expect(exportInput.successorSolutionRevision.versions.modelPrompt).toEqual({
      state: "pinned",
      tool: {
        id: review.attempts[0]?.model.promptTemplateId,
        version: review.attempts[0]?.model.promptVersion,
      },
    });
    expect(
      await acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: store,
        expectedReviewDigest: review.reviewDigest,
        expectedSolutionRevisionId: solutionRevisionId,
        review,
      }),
    ).toEqual(result);

    expect(
      await store.read({
        artifactId: artifact.artifactId,
        expectedArtifactDigest: artifact.artifactDigest,
        scope,
      }),
    ).toBeDefined();
    expect(decision.artifact).toEqual(artifact);
    expect(decision.artifact.files[0]?.ownership).toBe("ai-authored-candidate");
  });

  it("promotes coverage only when the exact target workload is complete", async () => {
    const authority = sourceCoverageAuthority();
    const fixture = await applicationReviewFixture(
      authority.sourceSolutionRevision,
    );
    const result = await acceptCandidateReview({
      ...acceptanceAuthority,
      ...authority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: fixture.store,
      expectedReviewDigest: fixture.review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review: fixture.review,
    });
    expect(
      result.exportInput.successorSolutionRevision.generationCoverage,
    ).toMatchObject({
      missingRequirements: [],
      state: "ai-assisted-custom-validated",
      workloads: [
        {
          missingRequirements: [],
          state: "ai-assisted-custom-validated",
          unresolvedRequirementIds: [],
          workloadId: "workload-custom",
        },
      ],
    });
  });
  it("does not promote unrelated or unresolved workload coverage", async () => {
    const multiWorkloadAuthority = sourceCoverageAuthority({
      includeIncompleteWorkload: true,
    });
    const multiWorkloadFixture = await applicationReviewFixture(
      multiWorkloadAuthority.sourceSolutionRevision,
    );
    const multiWorkloadResult = await acceptCandidateReview({
      ...acceptanceAuthority,
      ...multiWorkloadAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: multiWorkloadFixture.store,
      expectedReviewDigest: multiWorkloadFixture.review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review: multiWorkloadFixture.review,
    });
    expect(
      multiWorkloadResult.exportInput.successorSolutionRevision
        .generationCoverage,
    ).toMatchObject({
      missingRequirements: ["deterministic-application-generation"],
      state: "custom-implementation-required",
      workloads: [
        {
          missingRequirements: [],
          state: "ai-assisted-custom-validated",
          workloadId: "workload-custom",
        },
        {
          missingRequirements: ["deterministic-application-generation"],
          state: "custom-implementation-required",
          unresolvedRequirementIds: ["requirement-other-workload-behavior"],
          workloadId: "workload-other",
        },
      ],
    });
    expect(multiWorkloadResult.exportInput.evidence.records).toHaveLength(4);

    const unresolvedAuthority = sourceCoverageAuthority({
      targetUnresolved: true,
    });
    const unresolvedFixture = await applicationReviewFixture(
      unresolvedAuthority.sourceSolutionRevision,
    );
    const unresolvedResult = await acceptCandidateReview({
      ...acceptanceAuthority,
      ...unresolvedAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: unresolvedFixture.store,
      expectedReviewDigest: unresolvedFixture.review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review: unresolvedFixture.review,
    });
    expect(
      unresolvedResult.exportInput.successorSolutionRevision.generationCoverage,
    ).toMatchObject({
      missingRequirements: [],
      state: "custom-implementation-required",
      workloads: [
        {
          state: "custom-implementation-required",
          unresolvedRequirementIds: ["requirement-unresolved-custom-behavior"],
          workloadId: "workload-custom",
        },
      ],
    });
  });
  it("rejects decisions timestamped before their immutable authority", async () => {
    const { review, store } = await readyReviewFixture();
    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T11:59:59Z",
        artifactStore: store,
        expectedReviewDigest: review.reviewDigest,
        expectedSolutionRevisionId: solutionRevisionId,
        review,
      }),
    ).rejects.toThrow(/timestamp cannot precede/u);
    await expect(
      rejectCandidateReview({
        artifactStore: store,
        authorization: reviewerAuthorization,
        expectedReviewDigest: review.reviewDigest,
        reason: "A stale clock cannot author an immutable decision.",
        rejectedAt: "2026-08-21T11:59:59Z",
        review,
      }),
    ).rejects.toThrow(/timestamp cannot precede/u);
  });
  it("rejects stale review and Solution Revision preconditions", async () => {
    const { review, store } = await readyReviewFixture();

    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: store,
        expectedReviewDigest: sha256Text("stale-review"),
        expectedSolutionRevisionId: solutionRevisionId,
        review,
      }),
    ).rejects.toThrow(/review digest is stale/u);
    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: store,
        expectedReviewDigest: review.reviewDigest,
        expectedSolutionRevisionId: "solution-revision-2",
        review,
      }),
    ).rejects.toThrow(/Solution Revision changed/u);
  });

  it("requires exact verified reviewer authority", async () => {
    const { review, store } = await readyReviewFixture();
    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: store,
        authorization: {
          authorize: (request) =>
            Promise.resolve({
              action: request.action,
              allowed: false as const,
              authoritySource: "verified-authentication-context" as const,
              contractVersion: 1 as const,
              decidedAt: timestamp,
              decisionId: "authorization-denied",
              reason: "The verified membership does not permit acceptance.",
              requestDigest: digestCanonicalValue(request),
            }),
        },
        expectedReviewDigest: review.reviewDigest,
        expectedSolutionRevisionId: solutionRevisionId,
        review,
      }),
    ).rejects.toThrow(/not authorized by the exact verified principal/u);
  });
  it("requires the exact source freeze, distinct successor, and validation replay", async () => {
    const { review, store } = await readyReviewFixture();
    const changedSource = solutionRevisionManifestV1Schema.parse({
      ...sourceSolutionRevision,
      createdBy: "actor-unrelated-source",
    });
    const alreadyAcceptedSource = solutionRevisionManifestV1Schema.parse({
      ...sourceSolutionRevision,
      aiExtensionIds: [extensionId],
    });
    const forgedAttemptAuthority = review.attemptAuthority.map((authority) => ({
      ...authority,
      descriptor: {
        ...authority.descriptor,
        modelVersion: "forged-model-version",
      },
      usage: {
        ...authority.usage,
        modelVersion: "forged-model-version",
      },
    }));
    const forgedModelReview = candidateReviewRecordV1Schema.parse(
      redigestReview({
        ...review,
        artifact: {
          ...review.artifact,
          attemptAuthorityDigest: digestCanonicalValue(forgedAttemptAuthority),
        },
        attemptAuthority: forgedAttemptAuthority,
        attempts: review.attempts.map((attempt) => ({
          ...attempt,
          model: { ...attempt.model, modelVersion: "forged-model-version" },
        })),
        extension: {
          ...review.extension,
          model: {
            ...review.extension.model,
            modelVersion: "forged-model-version",
          },
        },
      }),
    );
    const staleReplayStore = storeWithMutatedRead(store, (stored) => {
      if (stored.validationReplay === undefined) {
        throw new Error("Missing validation replay fixture.");
      }
      return {
        ...stored,
        validationReplay: {
          ...stored.validationReplay,
          descriptor: {
            ...stored.validationReplay.descriptor,
            modelVersion: "stale-model-version",
          },
        },
      };
    });
    const baseInput = {
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: store,
      expectedReviewDigest: review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review,
    };

    await expect(
      acceptCandidateReview({
        ...baseInput,
        sourceSolutionRevision: changedSource,
      }),
    ).rejects.toThrow(/full-validation replay/u);
    await expect(
      acceptCandidateReview({
        ...baseInput,
        sourceEvidence: { contractVersion: 1, records: review.evidence },
      }),
    ).rejects.toThrow(/exact source revision Evidence freeze/u);
    await expect(
      acceptCandidateReview({
        ...baseInput,
        successorSolutionRevisionId: solutionRevisionId,
      }),
    ).rejects.toThrow(/distinct new successor/u);
    await expect(
      acceptCandidateReview({
        ...baseInput,
        sourceSolutionRevision: alreadyAcceptedSource,
      }),
    ).rejects.toThrow(/distinct new successor/u);
    await expect(
      acceptCandidateReview({
        ...baseInput,
        artifactStore: staleReplayStore,
      }),
    ).rejects.toThrow(/full-validation replay/u);
    await expect(
      acceptCandidateReview({
        ...baseInput,
        expectedReviewDigest: forgedModelReview.reviewDigest,
        review: forgedModelReview,
      }),
    ).rejects.toThrow(/immutable stored artifact review binding/u);
  });
  it("rejects stale validation evidence even when the review digest is current", async () => {
    const { review, store } = await readyReviewFixture();
    const staleWithOldDigest = {
      ...review,
      evidence: review.evidence.map((record) => ({
        ...record,
        staleness: {
          assessedAt: timestamp,
          reason: "The candidate input digest changed.",
          staleAt: utcTimestampSchema.parse("2026-08-21T12:04:00Z"),
          state: "stale" as const,
        },
      })),
    };
    const staleReview = candidateReviewRecordV1Schema.parse(
      redigestReview(staleWithOldDigest),
    );

    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: await cloneCurrentStoreBoundToReview(store, staleReview),
        expectedReviewDigest: staleReview.reviewDigest,
        expectedSolutionRevisionId: solutionRevisionId,
        review: staleReview,
      }),
    ).rejects.toThrow(/exact required Evidence is missing/u);
  });

  it("records rejection without granting repository write authority", async () => {
    const { review, store } = await readyReviewFixture();
    const originalReview = structuredClone(review);
    const canonicalRepository = Object.freeze({
      files: Object.freeze(["canonical/generated/main.tf"]),
      revision: solutionRevisionId,
    });

    const decision = await rejectCandidateReview({
      artifactStore: store,
      authorization: reviewerAuthorization,
      expectedReviewDigest: review.reviewDigest,
      reason: "The custom behavior is no longer required.",
      rejectedAt: "2026-08-21T12:05:00Z",
      review,
    });

    expect(decision).toMatchObject({
      decision: "rejected",
      deploymentAuthority: "none",
      extension: {
        acceptance: { state: "rejected" },
        exportSafety: { state: "not-safe" },
      },
      sourceSolutionRevisionId: solutionRevisionId,
      writeAuthority: "none",
    });
    expect(decision.successorSolutionRevisionId).toBeUndefined();
    expect(review).toEqual(originalReview);
    expect(canonicalRepository).toEqual({
      files: ["canonical/generated/main.tf"],
      revision: solutionRevisionId,
    });
    const rejectionRequest = {
      artifactStore: store,
      authorization: reviewerAuthorization,
      expectedReviewDigest: review.reviewDigest,
      reason: "The custom behavior is no longer required.",
      rejectedAt: "2026-08-21T12:05:00Z",
      review,
    };
    await expect(
      rejectCandidateReview({
        ...rejectionRequest,
        artifactStore: storeWithMutatedRead(store, (stored) => ({
          ...stored,
          lifecycle: {
            state: "superseded",
            successorArtifactDigest: sha256Text("rejection-successor"),
            successorArtifactId: "candidate-rejection-successor",
            supersededAt: utcTimestampSchema.parse("2026-08-21T12:04:00Z"),
          },
        })),
      }),
    ).rejects.toThrow(/exact current bound artifact/u);
    await expect(
      rejectCandidateReview({
        ...rejectionRequest,
        artifactStore: storeWithMutatedRead(store, (stored) =>
          withStoredReviewDigest(stored, sha256Text("wrong-rejection-review")),
        ),
      }),
    ).rejects.toThrow(/exact immutable stored artifact review binding/u);
    expect(store.artifactCount()).toBe(1);
  });

  it("returns a decision record without mutating review, artifact, or canonical design", async () => {
    const { artifact, review, store } = await readyReviewFixture();
    const reviewBefore = structuredClone(review);
    const artifactBefore = await store.read({
      artifactId: artifact.artifactId,
      expectedArtifactDigest: artifact.artifactDigest,
      scope,
    });
    const canonicalDesign = structuredClone({
      architectureRevision: "architecture-revision-1",
      acceptedExtensionIds: [] as string[],
    });
    const designBefore = structuredClone(canonicalDesign);

    const result = await acceptCandidateReview({
      ...acceptanceAuthority,
      acceptedAt: "2026-08-21T12:05:00Z",
      artifactStore: store,
      expectedReviewDigest: review.reviewDigest,
      expectedSolutionRevisionId: solutionRevisionId,
      review,
    });

    expect(result.decision.writeAuthority).toBe("none");
    expect(result.decision.deploymentAuthority).toBe("none");
    expect(result.exportInput.repositoryWriteAuthority).toBe("none");
    expect(result.exportInput.deploymentAuthority).toBe("none");
    expect(review).toEqual(reviewBefore);
    expect(canonicalDesign).toEqual(designBefore);
    expect(
      await store.read({
        artifactId: artifact.artifactId,
        expectedArtifactDigest: artifact.artifactDigest,
        scope,
      }),
    ).toEqual(artifactBefore);
  });

  it("rehashes exact stored bytes before accepting", async () => {
    const { review, store } = await readyReviewFixture();
    const corruptedStore = storeWithMutatedRead(store, (stored) => ({
      ...stored,
      files: stored.files.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              content: entry.content.replace("custom", "damage"),
            }
          : entry,
      ),
    }));

    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: corruptedStore,
        expectedReviewDigest: review.reviewDigest,
        expectedSolutionRevisionId: solutionRevisionId,
        review,
      }),
    ).rejects.toThrow(/stored file bytes or size/u);
  });

  it("rejects changed stored file sizes and target kinds", async () => {
    const { review, store } = await readyReviewFixture();
    const wrongSizeStore = storeWithMutatedRead(store, (stored) => ({
      ...stored,
      files: stored.files.map((entry, index) =>
        index === 0 ? { ...entry, sizeBytes: entry.sizeBytes + 1 } : entry,
      ),
    }));
    const wrongTargetStore = storeWithMutatedRead(store, (stored) => ({
      ...stored,
      targetKind: "cloudformation",
    }));

    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: wrongSizeStore,
        expectedReviewDigest: review.reviewDigest,
        expectedSolutionRevisionId: solutionRevisionId,
        review,
      }),
    ).rejects.toThrow(/stored file bytes or size/u);
    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: wrongTargetStore,
        expectedReviewDigest: review.reviewDigest,
        expectedSolutionRevisionId: solutionRevisionId,
        review,
      }),
    ).rejects.toThrow(/stored target kind/u);
  });

  it("requires the stored artifact reference and file inventories to match exactly", async () => {
    const { review, store } = await readyReviewFixture();
    const extraContent = "# unreviewed extra file\n";
    const extraFile = {
      content: extraContent,
      digest: sha256Text(extraContent),
      ownership: "ai-authored-candidate" as const,
      path: "infrastructure/extensions/unreviewed.tf",
      sizeBytes: new TextEncoder().encode(extraContent).byteLength,
      sourceKind: "file" as const,
    };
    const extraFileStore = storeWithMutatedRead(store, (stored) => ({
      ...stored,
      files: [...stored.files, extraFile],
      reference: {
        ...stored.reference,
        files: [
          ...stored.reference.files,
          {
            digest: extraFile.digest,
            ownership: extraFile.ownership,
            path: extraFile.path,
            sizeBytes: extraFile.sizeBytes,
            sourceKind: extraFile.sourceKind,
          },
        ],
      },
    }));

    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: extraFileStore,
        expectedReviewDigest: review.reviewDigest,
        expectedSolutionRevisionId: solutionRevisionId,
        review,
      }),
    ).rejects.toThrow(/artifact reference inventory/u);
  });

  it("requires an exact artifact/output bijection", async () => {
    const { review } = await readyReviewFixture();
    const extraContent = "# extra\n";
    const extraReference = {
      digest: sha256Text(extraContent),
      ownership: "ai-authored-candidate" as const,
      path: "infrastructure/extensions/extra.tf",
      sizeBytes: new TextEncoder().encode(extraContent).byteLength,
      sourceKind: "file" as const,
    };
    const extraArtifactReview = redigestReview({
      ...review,
      artifact: {
        ...review.artifact,
        files: [...review.artifact.files, extraReference],
      },
    });
    const extraOutputReview = redigestReview({
      ...review,
      extension: {
        ...review.extension,
        outputs: [
          ...review.extension.outputs,
          {
            digest: extraReference.digest,
            kind: extraReference.sourceKind,
            path: extraReference.path,
            sizeBytes: extraReference.sizeBytes,
          },
        ],
        ownedPaths: [
          ...review.extension.ownedPaths,
          { conflictPolicy: "fail" as const, path: extraReference.path },
        ],
      },
    });

    for (const candidate of [extraArtifactReview, extraOutputReview]) {
      const result = candidateReviewRecordV1Schema.safeParse(candidate);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(({ message }) =>
            message.includes("same exact cardinality"),
          ),
        ).toBe(true);
      }
    }
  });

  it("rejects bundle-only Evidence provenance or check bindings", async () => {
    const { review, store } = await readyReviewFixture();
    const bundleOnlyProvenance = candidateReviewRecordV1Schema.parse(
      redigestReview({
        ...review,
        evidence: review.evidence.map((record) => ({
          ...record,
          provenance: {
            ...record.provenance,
            inputDigests: [review.artifact.bundleDigest],
          },
        })),
      }),
    );
    const bundleOnlyChecks = candidateReviewRecordV1Schema.parse(
      redigestReview({
        ...review,
        evidence: review.evidence.map((record) => ({
          ...record,
          checks: record.checks.map((check) => ({
            ...check,
            artifactDigests: [review.artifact.bundleDigest],
          })),
        })),
      }),
    );

    for (const candidate of [bundleOnlyProvenance, bundleOnlyChecks]) {
      await expect(
        acceptCandidateReview({
          ...acceptanceAuthority,
          acceptedAt: "2026-08-21T12:05:00Z",
          artifactStore: await cloneCurrentStoreBoundToReview(store, candidate),
          expectedReviewDigest: candidate.reviewDigest,
          expectedSolutionRevisionId: solutionRevisionId,
          review: candidate,
        }),
      ).rejects.toThrow(/exact required Evidence is missing/u);
    }
  });

  it("rejects Evidence at a valid but wrong exact kind and rank", async () => {
    const { review, store } = await readyReviewFixture();
    const wrongLevelReview = candidateReviewRecordV1Schema.parse(
      redigestReview({
        ...review,
        evidence: review.evidence.map((record) => ({
          ...record,
          checks: record.checks.map((check) => {
            const {
              generationCoverageRequirement: _requirement,
              ...withoutRequirement
            } = check;
            void _requirement;
            return withoutRequirement;
          }),
          level: {
            kind: "application-build-and-tests" as const,
            rank: 5 as const,
          },
        })),
      }),
    );

    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: await cloneCurrentStoreBoundToReview(
          store,
          wrongLevelReview,
        ),
        expectedReviewDigest: wrongLevelReview.reviewDigest,
        expectedSolutionRevisionId: solutionRevisionId,
        review: wrongLevelReview,
      }),
    ).rejects.toThrow(/exact required Evidence is missing/u);
  });

  it("enforces sequential generation/repair replay lineage", async () => {
    const { review } = await readyReviewFixture();
    const generationAttempt = review.attempts[0];
    if (generationAttempt === undefined) {
      throw new Error("Missing fixture generation attempt.");
    }
    const repairAttempt = candidateAttemptV1Schema.parse({
      attemptNumber: 1,
      bundleDigest: sha256Text("raw-repair-bundle"),
      idempotencyKeyDigest: sha256Text("repair-idempotency-key"),
      invocationId: "invocation-repair-1",
      kind: "repair" as const,
      mergedBundleDigest: review.artifact.bundleDigest,
      model: generationAttempt.model,
      metered: true as const,
      usageRecordId: "usage-2",
    });
    const generationAuthority = review.attemptAuthority[0];
    if (generationAuthority === undefined) {
      throw new Error("Missing fixture generation authority.");
    }
    const repairDescriptor = modelInvocationDescriptorV1Schema.parse({
      ...generationAuthority.descriptor,
      feature: "candidate.repair",
      idempotencyKeyDigest: repairAttempt.idempotencyKeyDigest,
      inputDigest: sha256Text("repair-input-1"),
      invocationId: repairAttempt.invocationId,
    });
    const repairAuthority = {
      attemptNumber: 1,
      descriptor: repairDescriptor,
      kind: "repair" as const,
      mergedBundleDigest: repairAttempt.mergedBundleDigest,
      rawBundleDigest: repairAttempt.bundleDigest,
      usage: normalizedUsage(repairDescriptor, repairAttempt.usageRecordId),
    };
    const repairAttemptAuthority = [
      ...review.attemptAuthority,
      repairAuthority,
    ];
    const validRepairReview = redigestReview({
      ...review,
      artifact: {
        ...review.artifact,
        attemptAuthorityDigest: digestCanonicalValue(repairAttemptAuthority),
      },
      attemptAuthority: repairAttemptAuthority,
      attempts: [...review.attempts, repairAttempt],
      extension: {
        ...review.extension,
        model: {
          ...review.extension.model,
          usageEventIds: ["usage-1", "usage-2"],
        },
      },
    });
    expect(
      candidateReviewRecordV1Schema.safeParse(validRepairReview).success,
    ).toBe(true);

    const invalidReviews = [
      redigestReview({
        ...validRepairReview,
        attempts: validRepairReview.attempts.map((attempt, index) =>
          index === 1 ? { ...attempt, attemptNumber: 2 } : attempt,
        ),
      }),
      redigestReview({
        ...validRepairReview,
        attempts: validRepairReview.attempts.map((attempt, index) =>
          index === 0 ? { ...attempt, kind: "repair" as const } : attempt,
        ),
      }),
      redigestReview({
        ...validRepairReview,
        attempts: validRepairReview.attempts.map((attempt, index) =>
          index === 1
            ? {
                ...attempt,
                bundleDigest: attempt.mergedBundleDigest,
                kind: "generation" as const,
              }
            : attempt,
        ),
      }),
      redigestReview({
        ...validRepairReview,
        attempts: validRepairReview.attempts.map((attempt, index) =>
          index === 1
            ? { ...attempt, mergedBundleDigest: sha256Text("wrong-merge") }
            : attempt,
        ),
      }),
      redigestReview({
        ...validRepairReview,
        extension: {
          ...validRepairReview.extension,
          model: {
            ...validRepairReview.extension.model,
            usageEventIds: ["usage-2", "usage-1"],
          },
        },
      }),
    ];

    for (const candidate of invalidReviews) {
      expect(candidateReviewRecordV1Schema.safeParse(candidate).success).toBe(
        false,
      );
    }
  });

  it.each(["idempotencyKeyDigest", "invocationId", "usageRecordId"] as const)(
    "rejects duplicate attempt %s values",
    async (field) => {
      const { review } = await readyReviewFixture();
      const first = review.attempts[0];
      if (first === undefined) throw new Error("Missing fixture attempt.");
      const repairAttempt = candidateAttemptV1Schema.parse({
        attemptNumber: 1,
        bundleDigest: sha256Text("raw-repair-bundle"),
        idempotencyKeyDigest: sha256Text("repair-idempotency-key"),
        invocationId: "invocation-repair-1",
        kind: "repair" as const,
        mergedBundleDigest: review.artifact.bundleDigest,
        metered: true as const,
        model: first.model,
        usageRecordId: "usage-2",
        [field]: first[field],
      });
      const duplicateReview = redigestReview({
        ...review,
        attempts: [first, repairAttempt],
        extension: {
          ...review.extension,
          model: {
            ...review.extension.model,
            usageEventIds: ["usage-1", repairAttempt.usageRecordId],
          },
        },
      });

      expect(
        candidateReviewRecordV1Schema.safeParse(duplicateReview).success,
      ).toBe(false);
    },
  );

  it("keeps raw and merged generation bundle digests identical", async () => {
    const { review } = await readyReviewFixture();
    const invalidReview = redigestReview({
      ...review,
      attempts: review.attempts.map((attempt) => ({
        ...attempt,
        mergedBundleDigest: sha256Text("different-initial-merge"),
      })),
    });

    expect(candidateReviewRecordV1Schema.safeParse(invalidReview).success).toBe(
      false,
    );
  });

  it("rejects candidate Evidence with a wrong media type or exact artifact size", async () => {
    const { review, store } = await readyReviewFixture();
    const wrongMedia = candidateReviewRecordV1Schema.parse(
      redigestReview({
        ...review,
        evidence: review.evidence.map((record) => ({
          ...record,
          artifacts: record.artifacts.map((artifact) => ({
            ...artifact,
            mediaType: "application/json",
          })),
        })),
      }),
    );
    const wrongSize = candidateReviewRecordV1Schema.parse(
      redigestReview({
        ...review,
        evidence: review.evidence.map((record) => ({
          ...record,
          artifacts: record.artifacts.map((artifact) => ({
            ...artifact,
            sizeBytes: artifact.sizeBytes + 1,
          })),
        })),
      }),
    );

    for (const candidate of [wrongMedia, wrongSize]) {
      await expect(
        acceptCandidateReview({
          ...acceptanceAuthority,
          acceptedAt: "2026-08-21T12:05:00Z",
          artifactStore: await cloneCurrentStoreBoundToReview(store, candidate),
          expectedReviewDigest: candidate.reviewDigest,
          expectedSolutionRevisionId: solutionRevisionId,
          review: candidate,
        }),
      ).rejects.toThrow(/exact required Evidence is missing/u);
    }
  });

  it("rejects duplicate Evidence IDs at the review contract boundary", async () => {
    const { review } = await readyReviewFixture();
    const sourceEvidence = review.evidence[0];
    if (sourceEvidence === undefined)
      throw new Error("Missing fixture Evidence.");
    const parsed = candidateReviewRecordV1Schema.safeParse(
      redigestReview({
        ...review,
        evidence: [...review.evidence, sourceEvidence],
      }),
    );

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          message: "Candidate review Evidence IDs must be unique.",
          path: ["evidence", 1, "id"],
        }),
      );
    }
  });

  it("rejects distinct duplicate records that both claim the exact required Evidence", async () => {
    const { review, store } = await readyReviewFixture();
    const sourceEvidence = review.evidence[0];
    if (sourceEvidence === undefined)
      throw new Error("Missing fixture Evidence.");
    const duplicateEvidence = evidenceRecordV1Schema.parse({
      ...sourceEvidence,
      id: "evidence-static-duplicate",
    });
    const duplicateReview = candidateReviewRecordV1Schema.parse(
      redigestReview({
        ...review,
        evidence: [...review.evidence, duplicateEvidence],
      }),
    );

    await expect(
      acceptCandidateReview({
        ...acceptanceAuthority,
        acceptedAt: "2026-08-21T12:05:00Z",
        artifactStore: await cloneCurrentStoreBoundToReview(
          store,
          duplicateReview,
        ),
        expectedReviewDigest: duplicateReview.reviewDigest,
        expectedSolutionRevisionId: solutionRevisionId,
        review: duplicateReview,
      }),
    ).rejects.toThrow(/exact required Evidence is missing or duplicated/u);
  });

  it.each([
    "application-build-and-tests",
    "application-security-checks",
  ] as const)(
    "requires one passing rank-5 application Evidence claim for %s",
    async (missingRequirement) => {
      const { review, store } = await applicationReviewFixture();
      const missingClaimReview = candidateReviewRecordV1Schema.parse(
        redigestReview({
          ...review,
          evidence: review.evidence.map((record) =>
            record.level.rank === 5
              ? {
                  ...record,
                  checks: record.checks.map((check) => {
                    if (
                      check.generationCoverageRequirement !== missingRequirement
                    ) {
                      return check;
                    }
                    const {
                      generationCoverageRequirement: _requirement,
                      ...withoutRequirement
                    } = check;
                    void _requirement;
                    return withoutRequirement;
                  }),
                }
              : record,
          ),
        }),
      );

      await expect(
        acceptCandidateReview({
          ...acceptanceAuthority,
          acceptedAt: "2026-08-21T12:05:00Z",
          artifactStore: await cloneCurrentStoreBoundToReview(
            store,
            missingClaimReview,
          ),
          expectedReviewDigest: missingClaimReview.reviewDigest,
          expectedSolutionRevisionId: solutionRevisionId,
          review: missingClaimReview,
        }),
      ).rejects.toThrow(/exact required Evidence is missing or duplicated/u);
    },
  );
});
