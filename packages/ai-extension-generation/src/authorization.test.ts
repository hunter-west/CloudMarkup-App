import { describe, expect, it } from "vitest";

import {
  getCandidateReviewAuthorizationRequestDigest,
  requireCandidateReviewAuthorization,
  type CandidateReviewAuthorizationPort,
} from "./authorization.js";
import { sha256Text } from "./security.js";

const base = {
  action: "edit" as const,
  artifactDigest: sha256Text("candidate-artifact"),
  expectedPrincipalId: "principal-reviewer",
  reviewDigest: sha256Text("candidate-review"),
  reviewId: "candidate-review-1",
  scope: {
    organizationId: "organization-primary",
    projectId: "project-primary",
  },
  solutionRevisionId: "solution-revision-1",
};

function authorization(
  mutate: (decision: Record<string, unknown>) => Record<string, unknown> = (
    decision,
  ) => decision,
): CandidateReviewAuthorizationPort {
  return {
    authorize: (request) =>
      Promise.resolve(
        mutate({
          action: request.action,
          allowed: true,
          authoritySource: "verified-authentication-context",
          contractVersion: 1,
          decidedAt: "2026-08-22T12:00:00Z",
          decisionId: "authorization-edit-1",
          principalId: "principal-reviewer",
          requestDigest: getCandidateReviewAuthorizationRequestDigest(request),
        }),
      ),
  };
}

describe("candidate reviewer authorization", () => {
  it("accepts only an exact allowed decision from verified host context", async () => {
    await expect(
      requireCandidateReviewAuthorization({
        ...base,
        authorization: authorization(),
      }),
    ).resolves.toMatchObject({
      action: "edit",
      allowed: true,
      principalId: "principal-reviewer",
    });
  });

  it("requires an exact operation digest only for deterministic-fix authorization", async () => {
    await expect(
      requireCandidateReviewAuthorization({
        ...base,
        action: "apply-deterministic-fix",
        authorization: authorization(),
      }),
    ).rejects.toThrow();

    await expect(
      requireCandidateReviewAuthorization({
        ...base,
        action: "apply-deterministic-fix",
        authorization: authorization(),
        operationDigest: sha256Text("reviewed-operation"),
      }),
    ).resolves.toMatchObject({
      action: "apply-deterministic-fix",
      allowed: true,
    });

    await expect(
      requireCandidateReviewAuthorization({
        ...base,
        authorization: authorization(),
        operationDigest: sha256Text("unexpected-operation"),
      }),
    ).rejects.toThrow();
  });

  it.each([
    [
      "denied",
      (decision: Record<string, unknown>) => ({
        action: decision["action"],
        allowed: false,
        authoritySource: decision["authoritySource"],
        contractVersion: decision["contractVersion"],
        decidedAt: decision["decidedAt"],
        decisionId: decision["decisionId"],
        reason: "Membership does not permit candidate editing.",
        requestDigest: decision["requestDigest"],
      }),
    ],
    [
      "wrong principal",
      (decision: Record<string, unknown>) => ({
        ...decision,
        principalId: "principal-other",
      }),
    ],
    [
      "replayed scope",
      (decision: Record<string, unknown>) => ({
        ...decision,
        requestDigest: sha256Text("different-tenant-scope"),
      }),
    ],
    [
      "wrong action",
      (decision: Record<string, unknown>) => ({
        ...decision,
        action: "accept",
      }),
    ],
  ] as const)("rejects a %s authorization decision", async (_name, mutate) => {
    await expect(
      requireCandidateReviewAuthorization({
        ...base,
        authorization: authorization(mutate),
      }),
    ).rejects.toThrow(/not authorized by the exact verified principal/u);
  });
});
