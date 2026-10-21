import {
  applyGraphCommand,
  getActiveIssueRecordHash,
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
  type ArchitectureDocument,
  type GraphChangeSummary,
  type GraphCommandInversion,
} from "@cloudmarkup/domain";
import {
  activeIssueV1Schema,
  parseGraphCommandV1,
  sha256DigestSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
  type ActiveIssueV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  requireCandidateReviewAuthorization,
  type CandidateReviewAuthorizationPort,
} from "./authorization.js";
import {
  candidateArtifactReviewBindingV1Schema,
  type CandidateArtifactStore,
} from "./artifact-store.js";
import {
  candidateArtifactLifecycleV1Schema,
  candidateArtifactReferenceV1Schema,
  candidateReviewRecordV1Schema,
  candidateScopeV1Schema,
  getCandidateReviewDigest,
  type CandidateReviewRecordV1,
  type CandidateScopeV1,
} from "./presentation-contracts.js";
import { digestCanonicalValue } from "./security.js";

export const REVIEWED_DETERMINISTIC_ISSUE_FIX_OPERATION_ID =
  "cloudmarkup.ai-extension.reviewed-deterministic-issue-fix";
export const REVIEWED_DETERMINISTIC_ISSUE_FIX_OPERATION_VERSION = "1.0.0";

export const reviewedDeterministicIssueFixAuthorityV1Schema = z
  .object({
    artifactDigest: sha256DigestSchema,
    artifactId: solutionStableIdSchema,
    authority: z.literal("reviewed-deterministic-issue-fix"),
    expectedIssueRecordDigest: sha256DigestSchema,
    expectedIssueRecordVersion: z.number().int().positive(),
    expectedReviewState: z.enum(["ready-for-acceptance", "review-with-issues"]),
    expectedSourceContentHash: sha256DigestSchema,
    expectedSourceVisualHash: sha256DigestSchema,
    issueId: solutionStableIdSchema,
    reviewDigest: sha256DigestSchema,
    reviewId: solutionStableIdSchema,
    scope: candidateScopeV1Schema,
    solutionRevisionId: solutionRevisionIdSchema,
  })
  .strict();

export type ReviewedDeterministicIssueFixAuthorityV1 = z.output<
  typeof reviewedDeterministicIssueFixAuthorityV1Schema
>;

export interface ApplyReviewedDeterministicIssueFixInputV1 {
  readonly architectureDocument: unknown;
  readonly authority: unknown;
  readonly issue: unknown;
  readonly review: unknown;
}

export interface ReviewedDeterministicIssueFixResultV1 {
  readonly authority: Readonly<{
    readonly artifactDigest: Sha256Digest;
    readonly artifactId: string;
    readonly authorizationDecisionId: string;
    readonly issueId: ActiveIssueV1["id"];
    readonly issueRecordDigest: Sha256Digest;
    readonly issueRecordVersion: number;
    readonly reviewedBy: string;
    readonly reviewDigest: Sha256Digest;
    readonly reviewId: string;
    readonly scope: CandidateScopeV1;
    readonly solutionRevisionId: ActiveIssueV1["solutionRevisionId"];
  }>;
  readonly changes: readonly GraphChangeSummary[];
  readonly contractVersion: 1;
  readonly deploymentAuthority: "none";
  readonly document: ArchitectureDocument;
  readonly inversion: GraphCommandInversion;
  readonly operation: typeof REVIEWED_DETERMINISTIC_ISSUE_FIX_OPERATION_ID;
  readonly operationVersion: typeof REVIEWED_DETERMINISTIC_ISSUE_FIX_OPERATION_VERSION;
  readonly repositoryWriteAuthority: "none";
  readonly resultingContentHash: Sha256Digest;
  readonly resultingVisualHash: Sha256Digest;
  readonly resultDigest: Sha256Digest;
}

export interface ReviewedDeterministicIssueFixService {
  apply(
    input: ApplyReviewedDeterministicIssueFixInputV1,
  ): Promise<ReviewedDeterministicIssueFixResultV1>;
}

export interface ReviewedDeterministicIssueFixServiceDependencies {
  readonly artifactStore: CandidateArtifactStore;
  readonly authorization: CandidateReviewAuthorizationPort;
}

function assertExactReviewIssueAuthority(input: {
  readonly authority: ReviewedDeterministicIssueFixAuthorityV1;
  readonly issue: ActiveIssueV1;
  readonly review: CandidateReviewRecordV1;
}): void {
  const { authority, issue, review } = input;
  const exactIssueDigest = digestCanonicalValue(issue);
  const matchingLatest = review.issues.filter(
    (candidate) => candidate.id === issue.id,
  );
  const exactHistoryContainsIssue = review.issueHistory.some(
    (candidate) => digestCanonicalValue(candidate) === exactIssueDigest,
  );
  if (
    authority.artifactDigest !== review.artifact.artifactDigest ||
    authority.artifactId !== review.artifact.artifactId ||
    authority.expectedReviewState !== review.state ||
    authority.reviewDigest !== review.reviewDigest ||
    authority.reviewId !== review.reviewId ||
    authority.solutionRevisionId !== review.artifact.solutionRevisionId ||
    digestCanonicalValue(authority.scope) !==
      digestCanonicalValue(review.scope) ||
    getCandidateReviewDigest(review) !== review.reviewDigest
  ) {
    throw new Error(
      "Reviewed deterministic fix authority does not bind the exact Candidate Review record, state, scope, artifact, and revision.",
    );
  }
  if (
    matchingLatest.length !== 1 ||
    digestCanonicalValue(matchingLatest[0]) !== exactIssueDigest ||
    !exactHistoryContainsIssue ||
    issue.solutionRevisionId !== review.artifact.solutionRevisionId
  ) {
    throw new Error(
      "The exact current Active Issue must be listed by the Candidate Review and retained in its immutable issue history.",
    );
  }
}

async function requireExactCurrentReviewedArtifact(input: {
  readonly artifactStore: CandidateArtifactStore;
  readonly review: CandidateReviewRecordV1;
}): Promise<void> {
  const storedArtifact = await input.artifactStore.read({
    artifactId: input.review.artifact.artifactId,
    expectedArtifactDigest: input.review.artifact.artifactDigest,
    scope: input.review.scope,
  });
  const storedLifecycle = candidateArtifactLifecycleV1Schema.parse(
    storedArtifact.lifecycle,
  );
  const storedReference = candidateArtifactReferenceV1Schema.parse(
    storedArtifact.reference,
  );
  const storedReviewBinding =
    storedArtifact.reviewBinding === undefined
      ? undefined
      : candidateArtifactReviewBindingV1Schema.parse(
          storedArtifact.reviewBinding,
        );
  if (
    storedLifecycle.state !== "current" ||
    digestCanonicalValue(storedReference) !==
      digestCanonicalValue(input.review.artifact) ||
    storedReviewBinding?.artifactDigest !==
      input.review.artifact.artifactDigest ||
    storedReviewBinding.artifactId !== input.review.artifact.artifactId ||
    storedReviewBinding.boundAt !== input.review.artifact.storedAt ||
    storedReviewBinding.reviewDigest !== input.review.reviewDigest ||
    storedReviewBinding.reviewId !== input.review.reviewId ||
    storedReviewBinding.scope.organizationId !==
      input.review.scope.organizationId ||
    storedReviewBinding.scope.projectId !== input.review.scope.projectId ||
    storedReviewBinding.solutionRevisionId !==
      input.review.artifact.solutionRevisionId
  ) {
    throw new Error(
      "Reviewed deterministic fix requires the exact current Candidate Artifact and immutable review binding from the reviewed record.",
    );
  }
}

/**
 * Applies one exact, already-reviewed deterministic Active Issue fix to the
 * supplied immutable document value. This pure operation does not persist the
 * returned document and carries no repository-write or deployment authority.
 */
async function applyReviewedDeterministicIssueFix(
  input: ApplyReviewedDeterministicIssueFixInputV1,
  dependencies: ReviewedDeterministicIssueFixServiceDependencies,
): Promise<ReviewedDeterministicIssueFixResultV1> {
  const authority = reviewedDeterministicIssueFixAuthorityV1Schema.parse(
    input.authority,
  );
  const issue = activeIssueV1Schema.parse(input.issue);
  const review = candidateReviewRecordV1Schema.parse(input.review);
  const actualIssueDigest = getActiveIssueRecordHash(issue);
  const sourceDocument = parseArchitectureDocument(input.architectureDocument);
  const sourceHashes = getArchitectureDocumentHashes(sourceDocument);

  assertExactReviewIssueAuthority({ authority, issue, review });
  if (
    issue.id !== authority.issueId ||
    issue.solutionRevisionId !== authority.solutionRevisionId ||
    issue.recordVersion !== authority.expectedIssueRecordVersion ||
    issue.currentRecordDigest !== authority.expectedIssueRecordDigest ||
    actualIssueDigest !== issue.currentRecordDigest
  ) {
    throw new Error(
      "Reviewed deterministic fix authority does not bind the exact current Active Issue record.",
    );
  }
  if (issue.lifecycle.state !== "current") {
    throw new Error(
      "Only a current Active Issue may authorize a deterministic fix.",
    );
  }
  if (issue.deterministicFix === undefined) {
    throw new Error(
      issue.aiProposedFix === undefined
        ? "The current Active Issue has no deterministic fix."
        : "AI-proposed fixes cannot be applied through deterministic fix authority.",
    );
  }
  if (
    sourceHashes.contentHash !== authority.expectedSourceContentHash ||
    sourceHashes.visualHash !== authority.expectedSourceVisualHash
  ) {
    throw new Error(
      "Reviewed deterministic fix authority does not bind the exact source architecture hashes.",
    );
  }

  await requireExactCurrentReviewedArtifact({
    artifactStore: dependencies.artifactStore,
    review,
  });

  const authorizationDecision = await requireCandidateReviewAuthorization({
    action: "apply-deterministic-fix",
    artifactDigest: review.artifact.artifactDigest,
    authorization: dependencies.authorization,
    operationDigest: digestCanonicalValue({ authority, issue, review }),
    reviewDigest: review.reviewDigest,
    reviewId: review.reviewId,
    scope: review.scope,
    solutionRevisionId: review.artifact.solutionRevisionId,
  });

  await requireExactCurrentReviewedArtifact({
    artifactStore: dependencies.artifactStore,
    review,
  });

  const command = parseGraphCommandV1(issue.deterministicFix.graphCommand);
  if (command.kind !== "batch") {
    throw new Error(
      "A deterministic Active Issue fix must be a Graph Command v1 batch.",
    );
  }
  const application = applyGraphCommand(sourceDocument, command);
  const hashes = getArchitectureDocumentHashes(application.document);
  if (
    hashes.contentHash !== issue.deterministicFix.resultingContentHash ||
    hashes.visualHash !== issue.deterministicFix.resultingVisualHash
  ) {
    throw new Error(
      "The deterministic Graph Command result does not match the reviewed content and visual hashes.",
    );
  }

  const projection: Omit<
    ReviewedDeterministicIssueFixResultV1,
    "resultDigest"
  > = {
    authority: {
      artifactDigest: review.artifact.artifactDigest,
      artifactId: review.artifact.artifactId,
      authorizationDecisionId: authorizationDecision.decisionId,
      issueId: issue.id,
      issueRecordDigest: issue.currentRecordDigest,
      issueRecordVersion: issue.recordVersion,
      reviewedBy: authorizationDecision.principalId,
      reviewDigest: review.reviewDigest,
      reviewId: review.reviewId,
      scope: review.scope,
      solutionRevisionId: issue.solutionRevisionId,
    },
    changes: application.changes,
    contractVersion: 1,
    deploymentAuthority: "none",
    document: application.document,
    inversion: application.inversion,
    operation: REVIEWED_DETERMINISTIC_ISSUE_FIX_OPERATION_ID,
    operationVersion: REVIEWED_DETERMINISTIC_ISSUE_FIX_OPERATION_VERSION,
    repositoryWriteAuthority: "none",
    resultingContentHash: hashes.contentHash,
    resultingVisualHash: hashes.visualHash,
  };
  return Object.freeze({
    ...projection,
    resultDigest: digestCanonicalValue(projection),
  });
}

export function createReviewedDeterministicIssueFixService(
  dependencies: ReviewedDeterministicIssueFixServiceDependencies,
): ReviewedDeterministicIssueFixService {
  return Object.freeze({
    apply: (input: ApplyReviewedDeterministicIssueFixInputV1) =>
      applyReviewedDeterministicIssueFix(input, dependencies),
  });
}
