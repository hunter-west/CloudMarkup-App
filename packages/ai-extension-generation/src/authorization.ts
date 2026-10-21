import type { Sha256Digest } from "@cloudmarkup/schemas";

import {
  candidateReviewAuthorizationDecisionV1Schema,
  candidateReviewAuthorizationProofV1Schema,
  candidateReviewAuthorizationRequestV1Schema,
  getCandidateReviewAuthorizationRequestDigest,
  type CandidateReviewActionV1,
  type CandidateReviewAllowedAuthorizationDecisionV1,
  type CandidateReviewAuthorizationDecisionV1,
  type CandidateReviewAuthorizationProofV1,
  type CandidateReviewAuthorizationRequestV1,
  type CandidateScopeV1,
} from "./contracts.js";

export {
  candidateReviewActionV1Schema,
  candidateReviewAllowedAuthorizationDecisionV1Schema,
  candidateReviewAuthorizationDecisionV1Schema,
  candidateReviewAuthorizationProofV1Schema,
  candidateReviewAuthorizationRequestV1Schema,
  getCandidateReviewAuthorizationRequestDigest,
  type CandidateReviewActionV1,
  type CandidateReviewAllowedAuthorizationDecisionV1,
  type CandidateReviewAuthorizationDecisionV1,
  type CandidateReviewAuthorizationProofV1,
  type CandidateReviewAuthorizationRequestV1,
} from "./contracts.js";

/**
 * A host-owned port backed by verified authentication and membership context.
 * This port is a trusted dependency and must never be populated from a request
 * body or model output.
 */
export interface CandidateReviewAuthorizationPort {
  authorize(request: CandidateReviewAuthorizationRequestV1): Promise<unknown>;
}

interface CandidateReviewAuthorizationInputV1 {
  readonly action: CandidateReviewActionV1;
  readonly artifactDigest: Sha256Digest;
  readonly authorization: CandidateReviewAuthorizationPort;
  readonly expectedPrincipalId?: string;
  readonly operationDigest?: Sha256Digest;
  readonly reviewDigest: Sha256Digest;
  readonly reviewId: string;
  readonly scope: CandidateScopeV1;
  readonly solutionRevisionId: string;
}

export async function requireCandidateReviewAuthorizationProof(
  input: CandidateReviewAuthorizationInputV1,
): Promise<CandidateReviewAuthorizationProofV1> {
  const request = candidateReviewAuthorizationRequestV1Schema.parse({
    action: input.action,
    artifactDigest: input.artifactDigest,
    contractVersion: 1,
    ...(input.operationDigest === undefined
      ? {}
      : { operationDigest: input.operationDigest }),
    reviewDigest: input.reviewDigest,
    reviewId: input.reviewId,
    scope: input.scope,
    solutionRevisionId: input.solutionRevisionId,
  });
  const decision: CandidateReviewAuthorizationDecisionV1 =
    candidateReviewAuthorizationDecisionV1Schema.parse(
      await input.authorization.authorize(request),
    );
  if (
    !decision.allowed ||
    decision.action !== request.action ||
    decision.requestDigest !==
      getCandidateReviewAuthorizationRequestDigest(request) ||
    (input.expectedPrincipalId !== undefined &&
      decision.principalId !== input.expectedPrincipalId)
  ) {
    throw new Error(
      "Candidate review operation is not authorized by the exact verified principal and tenant scope.",
    );
  }
  return candidateReviewAuthorizationProofV1Schema.parse({
    allowedDecision: decision,
    request,
  });
}

export async function requireCandidateReviewAuthorization(
  input: CandidateReviewAuthorizationInputV1,
): Promise<CandidateReviewAllowedAuthorizationDecisionV1> {
  return (await requireCandidateReviewAuthorizationProof(input))
    .allowedDecision;
}
