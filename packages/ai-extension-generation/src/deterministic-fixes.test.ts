import { readFileSync } from "node:fs";

import {
  applyGraphCommand,
  getActiveIssueRecordHash,
  getArchitectureDocumentHashes,
} from "@cloudmarkup/domain";
import {
  activeIssueV1Schema,
  architectureDocumentV3Schema,
  modelInvocationDescriptorV1Schema,
  normalizedModelUsageV1Schema,
  parseGraphCommandV1,
  utcTimestampSchema,
  type ActiveIssueV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  getCandidateReviewAuthorizationRequestDigest,
  type CandidateReviewAuthorizationPort,
  type CandidateReviewAuthorizationRequestV1,
} from "./authorization.js";
import {
  createCandidateArtifactReviewBinding,
  type CandidateArtifactStore,
  type StoredCandidateArtifactV1,
} from "./artifact-store.js";
import { createReviewedDeterministicIssueFixService } from "./deterministic-fixes.js";
import {
  candidateArtifactReferenceV1Schema,
  candidateReviewRecordV1Schema,
  type CandidateReviewRecordV1,
} from "./presentation-contracts.js";
import {
  digestCanonicalValue,
  sha256Text,
  stableRecordId,
} from "./security.js";
import { InMemoryCandidateArtifactStore } from "./testing.js";

const assessedAt = "2026-08-22T12:00:00.000Z";
const solutionRevisionId = "solution-revision-safe-fix";
const scope = {
  organizationId: "organization-safe-fix",
  projectId: "project-safe-fix",
} as const;
const candidatePath = "infrastructure/extensions/safe-fix.tf";
const extensionId = "extension-safe-fix";
const candidateContent = [
  'resource "aws_cloudwatch_log_group" "safe_fix" {',
  '  name = "/cloudmarkup/safe-fix"',
  "}",
  "",
].join("\n");
const candidateFile = {
  content: candidateContent,
  digest: sha256Text(candidateContent),
  ownership: "ai-authored-candidate" as const,
  path: candidatePath,
  sizeBytes: new TextEncoder().encode(candidateContent).byteLength,
  sourceKind: "file" as const,
};
const bundleDigest = sha256Text("candidate-bundle-safe-fix");
const idempotencyKeyDigest = sha256Text("idempotency-safe-fix");
const promptDigest = sha256Text("candidate-prompt");
const routingDigest = sha256Text("routing-safe-fix");
const invocationId = "invocation-safe-fix";
const modelScope = {
  ...scope,
  solutionRevisionId,
  userId: "user-safe-fix",
};
const attemptDescriptor = modelInvocationDescriptorV1Schema.parse({
  budgetDecisionId: "budget-decision-safe-fix",
  complexity: "deep",
  contractVersion: 1,
  entitlementDecisionId: "entitlement-decision-safe-fix",
  evaluationPolicyId: "cloudmarkup.model-evaluation",
  evaluationPolicyVersion: "1.0.0",
  feature: "iac-extension.generate",
  idempotencyKeyDigest,
  inputDigest: sha256Text("input-safe-fix"),
  invocationId,
  modelId: "model.fixture",
  modelVersion: "2026-08-22",
  promptDigest,
  promptTemplateId: "prompt.safe-fix",
  promptVersion: "1.0.0",
  providerFamily: "deterministic-fake",
  providerId: "provider.fixture",
  requestedMode: "guided",
  role: "deep-architecture-custom-generation",
  routing: {
    acceptedMaximumCreditUnits: 20,
    capabilityRegistryDigest: routingDigest,
    capabilityRegistryId: "cloudmarkup.model-capabilities",
    capabilityRegistryVersion: "1.0.0",
    capabilityVersion: "1.0.0",
    effort: "high",
    evaluationPolicyId: "cloudmarkup.model-evaluation",
    evaluationPolicyVersion: "1.0.0",
    evaluationResultDigest: routingDigest,
    evaluationResultVersion: "1.0.0",
    modelCapabilityDigest: routingDigest,
    modelConfigurationReference: "cloudmarkup.model-configuration",
    modelFamily: "model.fixture-family",
    pricingVersionReference: "cloudmarkup.model-pricing",
    routeDefinitionDigest: routingDigest,
    routeId: "deep-design",
    routeRegistryDigest: routingDigest,
    routeRegistryId: "cloudmarkup.model-routes",
    routeRegistryVersion: "1.0.0",
    routingConfigurationDigest: routingDigest,
    routingDecisionDigest: routingDigest,
  },
  scope: modelScope,
  toolAuthority: "none",
});
const attemptUsage = normalizedModelUsageV1Schema.parse({
  attemptNumber: 1,
  cacheReadUnits: "0",
  cacheWriteUnits: "0",
  completedAt: "2026-08-22T12:00:01.000Z",
  contractVersion: 1,
  durationMilliseconds: 1_000,
  feature: attemptDescriptor.feature,
  idempotencyKeyDigest,
  inputDigest: attemptDescriptor.inputDigest,
  inputUnits: "10",
  invocationId,
  modelId: attemptDescriptor.modelId,
  modelVersion: attemptDescriptor.modelVersion,
  outputUnits: "10",
  promptTemplateId: attemptDescriptor.promptTemplateId,
  promptVersion: attemptDescriptor.promptVersion,
  providerId: attemptDescriptor.providerId,
  result: "succeeded",
  routing: attemptDescriptor.routing,
  scope: modelScope,
  startedAt: assessedAt,
  thinkingUnits: "0",
  usageRecordId: "usage-safe-fix",
});

const document = architectureDocumentV3Schema.parse(
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
const node = document.nodes.find(({ id }) => id === "node_worker");
if (node === undefined)
  throw new Error("Missing deterministic-fix node fixture.");
const nodeId = node.id;

const target = {
  architectureId: document.architectureId,
  documentId: document.documentId,
  revisionId: document.revision.revisionId,
};
const command = parseGraphCommandV1({
  commandId: "operation_safe_fix_batch",
  commands: [
    {
      commandId: "operation_safe_fix_move",
      expectedPosition: node.presentation.position,
      inverseCommandId: "operation_safe_fix_move_inverse",
      kind: "move-node",
      nodeId: node.id,
      origin: "user",
      position: { x: 260, y: 100 },
      schemaVersion: 1,
      target,
    },
  ],
  inverseCommandId: "operation_safe_fix_batch_inverse",
  kind: "batch",
  origin: "user",
  schemaVersion: 1,
  target,
});
if (command.kind !== "batch") throw new Error("Missing batch command fixture.");

const sourceHashes = getArchitectureDocumentHashes(document);
const expectedHashes = getArchitectureDocumentHashes(
  applyGraphCommand(document, command).document,
);

function issueWith(
  input: {
    readonly aiOnly?: boolean;
    readonly id?: string;
    readonly resultingContentHash?: typeof expectedHashes.contentHash;
  } = {},
): ActiveIssueV1 {
  const base = activeIssueV1Schema.parse({
    affected: [{ kind: "architecture-node", nodeId }],
    ...(input.aiOnly
      ? {
          aiProposedFix: {
            description:
              "AI may propose a patch, but it cannot invoke this operation.",
            extensionId: "cloudmarkup.extension-safe-fix-test",
            proposedPatchDigest: sha256Text("ai-only-proposal"),
            validationStatus: "validated-for-review",
          },
        }
      : {
          deterministicFix: {
            description:
              "Move the node through the reviewed Graph Command batch.",
            graphCommand: command,
            resultingContentHash:
              input.resultingContentHash ?? expectedHashes.contentHash,
            resultingVisualHash: expectedHashes.visualHash,
          },
        }),
    category: "structure",
    closureRequirements: [],
    contractVersion: 1,
    currentRecordDigest: sha256Text("placeholder-record-digest"),
    id: input.id ?? "active-issue-safe-fix",
    lifecycle: { state: "current" },
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: { id: "cloudmarkup.validation-fixture", version: "1.0.0" },
      },
      createdAt: assessedAt,
      inputDigests: [sourceHashes.contentHash, sourceHashes.visualHash],
    },
    recordVersion: 1,
    severity: "warning",
    solutionRevisionId,
    source: "schema-graph-validation",
    sourceRecordId: `validation-finding-${input.id ?? "safe-fix"}`,
    summary: "A deterministic layout fix is available.",
    technicalDetail:
      "The validated Graph Command preview pins the exact resulting hashes.",
  });
  return activeIssueV1Schema.parse({
    ...base,
    currentRecordDigest: getActiveIssueRecordHash(base),
  });
}

async function reviewFixture(issue: ActiveIssueV1) {
  const backingStore = new InMemoryCandidateArtifactStore();
  const provisionalArtifact = await backingStore.put({
    bundleDigest,
    extensionId,
    files: [candidateFile],
    scope,
    solutionRevisionId,
    storedAt: assessedAt,
    targetKind: "terraform",
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
      modelId: attemptDescriptor.modelId,
      modelVersion: attemptDescriptor.modelVersion,
      outputDigest: bundleDigest,
      promptDigest: attemptDescriptor.promptDigest,
      promptVersion: attemptDescriptor.promptVersion,
      providerId: attemptDescriptor.providerId,
      reservationId: "reservation-safe-fix",
      usageEventIds: ["usage-safe-fix"],
    },
    outputs: [
      {
        digest: candidateFile.digest,
        kind: candidateFile.sourceKind,
        path: candidateFile.path,
        sizeBytes: candidateFile.sizeBytes,
      },
    ],
    ownedPaths: [{ conflictPolicy: "fail" as const, path: candidatePath }],
    regenerationPolicy: "replace-owned-exact" as const,
    request: {
      acceptanceCriteria: ["The exact reviewed Graph Command remains bounded."],
      capabilityIds: ["infrastructure.custom-extension"],
      constraints: ["Use only the reviewed extension slot."],
      objective: "Carry one reviewed deterministic issue fix.",
      prohibitedCapabilities: ["deployment.execute"],
    },
    solutionRevisionId,
    sourceReferences: [
      {
        contractId: "cloudmarkup.safe-fix",
        contractVersion: "1.0.0",
        digest: sha256Text("source-contract-safe-fix"),
        kind: "solution-contract" as const,
      },
    ],
    target: {
      extensionSlotId: "terraform-extension-slot-safe-fix",
      fileType: "infrastructure.hcl",
      kind: "iac-extension" as const,
      language: "language.hcl",
      targetFormat: "terraform" as const,
    },
    validation,
  };
  const attemptAuthority = [
    {
      attemptNumber: 0,
      descriptor: attemptDescriptor,
      kind: "generation" as const,
      mergedBundleDigest: bundleDigest,
      rawBundleDigest: bundleDigest,
      usage: attemptUsage,
    },
  ];
  const attemptAuthorityDigest = digestCanonicalValue(attemptAuthority);
  const artifactDigest = digestCanonicalValue({
    attemptAuthorityDigest,
    bundleDigest: provisionalArtifact.bundleDigest,
    extensionId: provisionalArtifact.extensionId,
    files: provisionalArtifact.files,
    origin: provisionalArtifact.origin,
    scope: provisionalArtifact.scope,
    solutionRevisionId: provisionalArtifact.solutionRevisionId,
    targetKind: "terraform",
    validationReplayDigest: provisionalArtifact.validationReplayDigest,
  });
  const artifact = candidateArtifactReferenceV1Schema.parse({
    ...provisionalArtifact,
    artifactDigest,
    artifactId: stableRecordId("candidate", { artifactDigest, scope }),
    attemptAuthorityDigest,
  });
  const reviewWithoutDigest = {
    artifact,
    assumptions: [],
    attemptAuthority,
    attempts: [
      {
        attemptNumber: 0,
        bundleDigest,
        idempotencyKeyDigest,
        invocationId,
        kind: "generation" as const,
        mergedBundleDigest: bundleDigest,
        metered: true as const,
        model: {
          modelId: attemptDescriptor.modelId,
          modelVersion: attemptDescriptor.modelVersion,
          promptDigest: attemptDescriptor.promptDigest,
          promptTemplateId: attemptDescriptor.promptTemplateId,
          promptVersion: attemptDescriptor.promptVersion,
          providerId: attemptDescriptor.providerId,
        },
        usageRecordId: "usage-safe-fix",
      },
    ],
    contractVersion: 1 as const,
    diagnostics: [],
    editRevalidations: [],
    evidence: [],
    expectedTests: [],
    generationProgress: {
      contractVersion: 1 as const,
      finalEvidenceCount: 0,
      finalEvidenceDigest: digestCanonicalValue([]),
      finalIssueHistoryCount: 1,
      finalIssueHistoryDigest: digestCanonicalValue([issue]),
      finalIssuesCount: 1,
      finalIssuesDigest: digestCanonicalValue([issue]),
      finalSequence: 1,
      finalSnapshotDigest: sha256Text("safe-fix-progress-final-snapshot"),
      generationRunId: "candidate-generation-run-safe-fix-fixture",
      state: "finalized" as const,
      streamDigest: sha256Text("safe-fix-progress-stream"),
      terminalPhase: "validation-assessed" as const,
      terminalResultKind: "candidate-review" as const,
    },
    extension,
    issueHistory: [issue],
    issues: [issue],
    progress: [
      { stage: "generate", state: "complete" },
      { stage: "check", state: "complete" },
      { stage: "fix-automatically-where-safe", state: "not-needed" },
      { stage: "review-remaining-issues", state: "complete" },
      { stage: "accept-candidate", state: "ready" },
    ],
    reviewId: "candidate-review-safe-fix",
    scope,
    state: "ready-for-acceptance" as const,
    unresolvedItems: [],
    validation,
    writeAuthority: "none" as const,
  };
  const review = candidateReviewRecordV1Schema.parse({
    ...reviewWithoutDigest,
    reviewDigest: digestCanonicalValue(reviewWithoutDigest),
  });
  const stored = {
    files: [candidateFile],
    lifecycle: { state: "current" as const },
    reference: artifact,
    reviewBinding: createCandidateArtifactReviewBinding({
      reference: artifact,
      review: {
        boundAt: assessedAt,
        reviewDigest: review.reviewDigest,
        reviewId: review.reviewId,
      },
    }),
    targetKind: "terraform" as const,
  } satisfies StoredCandidateArtifactV1;
  const store: CandidateArtifactStore = {
    preserveInvalid: (input) => backingStore.preserveInvalid(input),
    put: (input) => backingStore.put(input),
    read: (input) => {
      if (
        input.artifactId !== artifact.artifactId ||
        input.expectedArtifactDigest !== artifact.artifactDigest ||
        digestCanonicalValue(input.scope) !== digestCanonicalValue(scope)
      ) {
        return Promise.reject(
          new Error("Candidate artifact lookup did not bind the fixture."),
        );
      }
      return Promise.resolve(structuredClone(stored));
    },
  };
  return { artifact, review, store };
}

function redigestReview(
  review: CandidateReviewRecordV1,
  changes: Partial<CandidateReviewRecordV1>,
): CandidateReviewRecordV1 {
  const { reviewDigest: _oldDigest, ...projection } = { ...review, ...changes };
  void _oldDigest;
  return candidateReviewRecordV1Schema.parse({
    ...projection,
    reviewDigest: digestCanonicalValue(projection),
  });
}

function authority(review: CandidateReviewRecordV1, issue: ActiveIssueV1) {
  return {
    artifactDigest: review.artifact.artifactDigest,
    artifactId: review.artifact.artifactId,
    authority: "reviewed-deterministic-issue-fix" as const,
    expectedIssueRecordDigest: issue.currentRecordDigest,
    expectedIssueRecordVersion: issue.recordVersion,
    expectedReviewState: review.state,
    expectedSourceContentHash: sourceHashes.contentHash,
    expectedSourceVisualHash: sourceHashes.visualHash,
    issueId: issue.id,
    reviewDigest: review.reviewDigest,
    reviewId: review.reviewId,
    scope: review.scope,
    solutionRevisionId: issue.solutionRevisionId,
  };
}

function authorization(
  input: {
    readonly allowed?: boolean;
    readonly calls?: CandidateReviewAuthorizationRequestV1[];
    readonly order?: string[];
  } = {},
): CandidateReviewAuthorizationPort {
  return {
    authorize: (request) => {
      input.order?.push("authorization");
      input.calls?.push(request);
      return Promise.resolve(
        input.allowed === false
          ? {
              action: request.action,
              allowed: false,
              authoritySource: "verified-authentication-context",
              contractVersion: 1,
              decidedAt: assessedAt,
              decisionId: "authorization-safe-fix-denied",
              reason: "The verified reviewer cannot apply this fix.",
              requestDigest:
                getCandidateReviewAuthorizationRequestDigest(request),
            }
          : {
              action: request.action,
              allowed: true,
              authoritySource: "verified-authentication-context",
              contractVersion: 1,
              decidedAt: assessedAt,
              decisionId: "authorization-safe-fix-allowed",
              principalId: "actor-reviewer",
              requestDigest:
                getCandidateReviewAuthorizationRequestDigest(request),
            },
      );
    },
  };
}

function storeWithRead(
  store: CandidateArtifactStore,
  read: CandidateArtifactStore["read"],
): CandidateArtifactStore {
  return {
    preserveInvalid: (input) => store.preserveInvalid(input),
    put: (input) => store.put(input),
    read,
  };
}

function applyFix(input: {
  readonly artifactStore: CandidateArtifactStore;
  readonly authorization?: CandidateReviewAuthorizationPort;
  readonly authority: unknown;
  readonly issue: unknown;
  readonly review: unknown;
  readonly architectureDocument?: unknown;
}) {
  return createReviewedDeterministicIssueFixService({
    artifactStore: input.artifactStore,
    authorization: input.authorization ?? authorization(),
  }).apply({
    architectureDocument: input.architectureDocument ?? document,
    authority: input.authority,
    issue: input.issue,
    review: input.review,
  });
}

describe("reviewed deterministic Active Issue fixes", () => {
  it("applies the exact current review issue only after artifact lookup and verified authorization", async () => {
    const issue = issueWith();
    const fixture = await reviewFixture(issue);
    const before = structuredClone(document);
    const calls: CandidateReviewAuthorizationRequestV1[] = [];
    const order: string[] = [];
    const reviewedAuthority = authority(fixture.review, issue);
    const result = await applyFix({
      artifactStore: storeWithRead(fixture.store, async (input) => {
        order.push("artifact-read");
        return fixture.store.read(input);
      }),
      authorization: authorization({ calls, order }),
      authority: reviewedAuthority,
      issue,
      review: fixture.review,
    });

    expect(document).toEqual(before);
    expect(order).toEqual(["artifact-read", "authorization", "artifact-read"]);
    expect(calls[0]).toMatchObject({
      action: "apply-deterministic-fix",
      artifactDigest: fixture.review.artifact.artifactDigest,
      operationDigest: digestCanonicalValue({
        authority: reviewedAuthority,
        issue,
        review: fixture.review,
      }),
      reviewDigest: fixture.review.reviewDigest,
      reviewId: fixture.review.reviewId,
      scope: fixture.review.scope,
      solutionRevisionId: fixture.review.artifact.solutionRevisionId,
    });
    expect(result.resultingContentHash).toBe(expectedHashes.contentHash);
    expect(result.resultingVisualHash).toBe(expectedHashes.visualHash);
    expect(result.repositoryWriteAuthority).toBe("none");
    expect(result.deploymentAuthority).toBe("none");
    expect(result.authority).toMatchObject({
      artifactDigest: fixture.review.artifact.artifactDigest,
      artifactId: fixture.review.artifact.artifactId,
      authorizationDecisionId: "authorization-safe-fix-allowed",
      issueRecordDigest: issue.currentRecordDigest,
      reviewedBy: "actor-reviewer",
      reviewDigest: fixture.review.reviewDigest,
      reviewId: fixture.review.reviewId,
      scope: fixture.review.scope,
    });
  });

  it("rejects a different review authority and an issue absent from the exact review", async () => {
    const issue = issueWith();
    const fixture = await reviewFixture(issue);
    const calls: CandidateReviewAuthorizationRequestV1[] = [];
    const otherReview = redigestReview(fixture.review, {
      reviewId: "candidate-review-safe-fix-other",
    });

    await expect(
      applyFix({
        artifactStore: fixture.store,
        authorization: authorization({ calls }),
        authority: authority(fixture.review, issue),
        issue,
        review: otherReview,
      }),
    ).rejects.toThrow(/exact Candidate Review record/u);

    const unlistedIssue = issueWith({ id: "active-issue-unlisted-safe-fix" });
    await expect(
      applyFix({
        artifactStore: fixture.store,
        authorization: authorization({ calls }),
        authority: authority(fixture.review, unlistedIssue),
        issue: unlistedIssue,
        review: fixture.review,
      }),
    ).rejects.toThrow(/listed by the Candidate Review/u);
    expect(calls).toHaveLength(0);
  });

  it("rejects a superseded reviewed artifact before authorization", async () => {
    const issue = issueWith();
    const fixture = await reviewFixture(issue);
    const calls: CandidateReviewAuthorizationRequestV1[] = [];
    const supersededStore = storeWithRead(fixture.store, async (input) => {
      const stored = await fixture.store.read(input);
      return {
        ...stored,
        lifecycle: {
          state: "superseded",
          successorArtifactDigest: sha256Text("successor-artifact"),
          successorArtifactId: "candidate-successor-safe-fix",
          supersededAt: utcTimestampSchema.parse("2026-08-22T12:01:00.000Z"),
        },
      } satisfies StoredCandidateArtifactV1;
    });

    await expect(
      applyFix({
        artifactStore: supersededStore,
        authorization: authorization({ calls }),
        authority: authority(fixture.review, issue),
        issue,
        review: fixture.review,
      }),
    ).rejects.toThrow(/exact current Candidate Artifact/u);
    expect(calls).toHaveLength(0);
  });

  it("rejects a missing or divergent immutable review binding before authorization", async () => {
    const issue = issueWith();
    const fixture = await reviewFixture(issue);
    const calls: CandidateReviewAuthorizationRequestV1[] = [];
    const missingBindingStore = storeWithRead(fixture.store, async (input) => {
      const stored = await fixture.store.read(input);
      const { reviewBinding: _reviewBinding, ...withoutBinding } = stored;
      void _reviewBinding;
      return withoutBinding;
    });

    await expect(
      applyFix({
        artifactStore: missingBindingStore,
        authorization: authorization({ calls }),
        authority: authority(fixture.review, issue),
        issue,
        review: fixture.review,
      }),
    ).rejects.toThrow(/immutable review binding/u);

    const divergentBindingStore = storeWithRead(
      fixture.store,
      async (input) => {
        const stored = await fixture.store.read(input);
        if (stored.reviewBinding === undefined) {
          throw new Error("Expected the exact review-binding fixture.");
        }
        return {
          ...stored,
          reviewBinding: {
            ...stored.reviewBinding,
            reviewDigest: sha256Text("divergent-stored-review-binding"),
          },
        };
      },
    );
    await expect(
      applyFix({
        artifactStore: divergentBindingStore,
        authorization: authorization({ calls }),
        authority: authority(fixture.review, issue),
        issue,
        review: fixture.review,
      }),
    ).rejects.toThrow(/immutable review binding/u);
    expect(calls).toHaveLength(0);
  });

  it("rejects supersession while verified authorization is pending", async () => {
    const issue = issueWith();
    const fixture = await reviewFixture(issue);
    const before = structuredClone(document);
    const calls: CandidateReviewAuthorizationRequestV1[] = [];
    let superseded = false;
    let readCount = 0;
    let signalAuthorizationStarted: () => void = () => {
      throw new Error("Authorization start signal was not initialized.");
    };
    let releaseAuthorization: () => void = () => {
      throw new Error("Authorization release signal was not initialized.");
    };
    const authorizationStarted = new Promise<void>((resolve) => {
      signalAuthorizationStarted = resolve;
    });
    const authorizationRelease = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const allowedAuthorization = authorization({ calls });
    const deferredAuthorization: CandidateReviewAuthorizationPort = {
      async authorize(request) {
        signalAuthorizationStarted();
        await authorizationRelease;
        return allowedAuthorization.authorize(request);
      },
    };
    const racingStore = storeWithRead(fixture.store, async (input) => {
      readCount += 1;
      const stored = await fixture.store.read(input);
      return superseded
        ? ({
            ...stored,
            lifecycle: {
              state: "superseded",
              successorArtifactDigest: sha256Text("racing-successor"),
              successorArtifactId: "candidate-racing-successor-safe-fix",
              supersededAt: utcTimestampSchema.parse(
                "2026-08-22T12:01:00.000Z",
              ),
            },
          } satisfies StoredCandidateArtifactV1)
        : stored;
    });

    const application = applyFix({
      artifactStore: racingStore,
      authorization: deferredAuthorization,
      authority: authority(fixture.review, issue),
      issue,
      review: fixture.review,
    });
    await authorizationStarted;
    superseded = true;
    releaseAuthorization();

    await expect(application).rejects.toThrow(
      /exact current Candidate Artifact/u,
    );
    expect(readCount).toBe(2);
    expect(calls).toHaveLength(1);
    expect(document).toEqual(before);
  });

  it("rejects AI-only fixes, tampering, and authorization denial", async () => {
    const aiIssue = issueWith({ aiOnly: true });
    const aiFixture = await reviewFixture(aiIssue);
    await expect(
      applyFix({
        artifactStore: aiFixture.store,
        authority: authority(aiFixture.review, aiIssue),
        issue: aiIssue,
        review: aiFixture.review,
      }),
    ).rejects.toThrow(/AI-proposed fixes cannot be applied/u);

    const issue = issueWith();
    const fixture = await reviewFixture(issue);
    await expect(
      applyFix({
        artifactStore: fixture.store,
        authority: {
          ...authority(fixture.review, issue),
          expectedIssueRecordDigest: sha256Text("stale-issue-record"),
        },
        issue,
        review: fixture.review,
      }),
    ).rejects.toThrow(/exact current Active Issue record/u);

    await expect(
      applyFix({
        artifactStore: fixture.store,
        authorization: authorization({ allowed: false }),
        authority: authority(fixture.review, issue),
        issue,
        review: fixture.review,
      }),
    ).rejects.toThrow(/not authorized by the exact verified principal/u);

    const falseHashIssue = issueWith({
      resultingContentHash: sha256Text("false-resulting-content"),
    });
    const falseHashFixture = await reviewFixture(falseHashIssue);
    await expect(
      applyFix({
        artifactStore: falseHashFixture.store,
        authority: authority(falseHashFixture.review, falseHashIssue),
        issue: falseHashIssue,
        review: falseHashFixture.review,
      }),
    ).rejects.toThrow(/does not match the reviewed content and visual hashes/u);
  });
});
