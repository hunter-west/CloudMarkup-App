import {
  evidenceRecordV1Schema,
  type ActiveIssueV1,
  type EvidenceRecordV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { getActiveIssueRecordHash } from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import {
  candidateDiagnosticV1Schema,
  type CandidateDiagnosticV1,
} from "./contracts.js";
import { createCandidateIssues, reconcileCandidateIssues } from "./issues.js";

const digestA = ("sha256:" + "a".repeat(64)) as Sha256Digest;
const digestB = ("sha256:" + "b".repeat(64)) as Sha256Digest;
const digestC = ("sha256:" + "c".repeat(64)) as Sha256Digest;
const assessedAt = "2026-08-21T12:00:00.000Z";
const laterAt = "2026-08-21T12:01:00.000Z";

function diagnostic(
  overrides: Readonly<Record<string, unknown>> = {},
): CandidateDiagnosticV1 {
  return candidateDiagnosticV1Schema.parse({
    category: "format",
    checkId: "cloudmarkup.ai-extension.test-format",
    code: "cloudmarkup.ai-extension.test-format-failed",
    path: "infrastructure/extensions/custom.tf",
    repairable: true,
    severity: "error",
    summary: "The candidate file is not formatted.",
    technicalDetail:
      "The approved formatter reported a difference for the candidate path.",
    ...overrides,
  });
}

function reconcile(input: {
  readonly bundleDigest: Sha256Digest;
  readonly diagnostics?: readonly CandidateDiagnosticV1[];
  readonly evidence?: readonly EvidenceRecordV1[];
  readonly markMissingAsStale?: boolean;
  readonly previousRecords?: readonly ActiveIssueV1[];
  readonly repairReference?: {
    readonly description: string;
    readonly issueIds: readonly string[];
    readonly proposedPatchDigest: Sha256Digest;
    readonly validationStatus:
      "validation-pending" | "rejected" | "validated-for-review";
  };
}) {
  return reconcileCandidateIssues({
    assessedAt:
      input.previousRecords === undefined || input.previousRecords.length === 0
        ? assessedAt
        : laterAt,
    bundleDigest: input.bundleDigest,
    diagnostics: input.diagnostics ?? [],
    evidence: input.evidence ?? [],
    extensionId: "extension_test",
    inputDigests: [digestC],
    markMissingAsStale: input.markMissingAsStale ?? false,
    previousRecords: input.previousRecords ?? [],
    ...(input.repairReference === undefined
      ? {}
      : { repairReference: input.repairReference }),
    solutionRevisionId: "solution_revision_test",
    source: "ai-generation-repair",
  });
}

function passingClosureEvidence(
  issue: ActiveIssueV1,
  options: {
    readonly evidenceId?: string;
    readonly issueIds?: readonly string[];
    readonly status?: "passed" | "failed";
  } = {},
): EvidenceRecordV1 {
  const requirement = issue.closureRequirements[0];
  if (requirement === undefined) {
    throw new Error("The candidate issue fixture requires closure Evidence.");
  }
  return evidenceRecordV1Schema.parse({
    artifacts: [
      {
        digest: digestB,
        mediaType: "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
        sizeBytes: 42,
      },
    ],
    checks: [
      {
        artifactDigests: [digestB],
        checkId: requirement.evidenceCheckId,
        issueIds: options.issueIds ?? [issue.id],
        ...(options.status === "failed"
          ? { redactedFailure: "The exact bounded check did not pass." }
          : {}),
        status: options.status ?? "passed",
        summary: "The exact candidate validation check was rerun.",
      },
    ],
    contractVersion: 1,
    environment: { environmentType: "unknown" },
    id: options.evidenceId ?? "evidence_candidate_issue_test",
    layer: "generated",
    level: requirement.evidenceLevel,
    models: [],
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: {
          id: "cloudmarkup.test-validator",
          version: "1.0.0",
        },
      },
      createdAt: laterAt,
      inputDigests: [digestB],
    },
    solutionRevisionId: issue.solutionRevisionId,
    staleness: { assessedAt: laterAt, state: "current" },
    tools: [
      {
        id: "cloudmarkup.test-validator",
        version: "1.0.0",
      },
    ],
  });
}

function initialIssue() {
  const result = reconcile({
    bundleDigest: digestA,
    diagnostics: [diagnostic()],
  });
  const issue = result.currentIssues[0];
  if (issue === undefined) throw new Error("Expected a current issue fixture.");
  return { issue, result };
}

describe("candidate issue reconciliation", () => {
  it("derives issue identity from exact authority rather than human copy", () => {
    const common = {
      assessedAt,
      bundleDigest: digestA,
      evidenceLevel: {
        kind: "ai-extension-parse-static-validity" as const,
        rank: 4 as const,
      },
      extensionId: "extension_test",
      inputDigests: [digestC],
      solutionRevisionId: "solution_revision_test",
      source: "ai-generation-repair" as const,
    };
    const first = createCandidateIssues({
      ...common,
      diagnostics: [diagnostic()],
    })[0];
    const reworded = createCandidateIssues({
      ...common,
      diagnostics: [
        diagnostic({
          summary: "Please format this candidate file.",
          technicalDetail:
            "The same exact check and path produced differently worded copy.",
        }),
      ],
    })[0];

    expect(first).toBeDefined();
    expect(reworded).toBeDefined();
    expect(reworded?.id).toBe(first?.id);
    expect(reworded?.sourceRecordId).toBe(first?.sourceRecordId);
    expect(first?.aiProposedFix).toBeUndefined();
    expect(reworded?.aiProposedFix).toBeUndefined();
  });

  it("keeps an issue current when no complete superseding assessment exists", () => {
    const { issue, result } = initialIssue();
    const next = reconcile({
      bundleDigest: digestB,
      diagnostics: [],
      markMissingAsStale: false,
      previousRecords: result.history,
    });

    expect(next.appendedRecords).toEqual([]);
    expect(next.history).toEqual(result.history);
    expect(next.currentIssues).toEqual([issue]);
    expect(next.latestRecords).toEqual([issue]);
  });

  it("marks superseded issues stale and retains every immutable record", () => {
    const { issue, result } = initialIssue();
    const next = reconcile({
      bundleDigest: digestB,
      diagnostics: [diagnostic()],
      markMissingAsStale: true,
      previousRecords: result.history,
    });

    const stale = next.latestRecords.find(({ id }) => id === issue.id);
    const replacement = next.currentIssues.find(({ id }) => id !== issue.id);
    expect(stale?.lifecycle.state).toBe("stale");
    expect(stale?.recordVersion).toBe(2);
    expect(stale?.previousRecordDigest).toBe(issue.currentRecordDigest);
    expect(stale?.currentRecordDigest).toBe(
      stale === undefined ? undefined : getActiveIssueRecordHash(stale),
    );
    expect(replacement?.lifecycle.state).toBe("current");
    expect(next.history).toHaveLength(3);
    expect(next.history[0]).toEqual(issue);
    expect(next.staleIssueIds).toEqual([issue.id]);
  });

  it("records an actual rejected AI repair only on the stale source issue", () => {
    const { issue, result } = initialIssue();
    const next = reconcile({
      bundleDigest: digestB,
      diagnostics: [diagnostic()],
      markMissingAsStale: true,
      previousRecords: result.history,
      repairReference: {
        description: "The proposed formatting repair failed validation.",
        issueIds: [issue.id],
        proposedPatchDigest: digestB,
        validationStatus: "rejected",
      },
    });

    const stale = next.latestRecords.find(({ id }) => id === issue.id);
    const replacement = next.currentIssues.find(({ id }) => id !== issue.id);
    expect(stale?.lifecycle.state).toBe("stale");
    expect(stale?.aiProposedFix).toEqual({
      description: "The proposed formatting repair failed validation.",
      extensionId: "extension_test",
      proposedPatchDigest: digestB,
      validationStatus: "rejected",
    });
    expect(replacement?.aiProposedFix).toBeUndefined();
    expect(next.history).toHaveLength(3);
  });

  it("retains a pending AI repair before exact Evidence validates it", () => {
    const { issue, result } = initialIssue();
    const pending = reconcile({
      bundleDigest: digestB,
      diagnostics: [],
      markMissingAsStale: false,
      previousRecords: result.history,
      repairReference: {
        description: "The proposed repair is being checked.",
        issueIds: [issue.id],
        proposedPatchDigest: digestB,
        validationStatus: "validation-pending",
      },
    });

    const pendingVersions = pending.history.filter(({ id }) => id === issue.id);
    expect(pendingVersions).toHaveLength(3);
    expect(pendingVersions.map(({ lifecycle }) => lifecycle.state)).toEqual([
      "current",
      "stale",
      "current",
    ]);
    expect(pending.latestRecords[0]?.aiProposedFix?.validationStatus).toBe(
      "validation-pending",
    );

    const evidence = passingClosureEvidence(issue);
    const validated = reconcile({
      bundleDigest: digestB,
      diagnostics: [],
      evidence: [evidence],
      markMissingAsStale: false,
      previousRecords: pending.history,
      repairReference: {
        description:
          "The proposed repair passed the exact deterministic check.",
        issueIds: [issue.id],
        proposedPatchDigest: digestB,
        validationStatus: "validated-for-review",
      },
    });

    expect(validated.latestRecords[0]?.lifecycle.state).toBe("resolved");
    expect(validated.latestRecords[0]?.aiProposedFix?.validationStatus).toBe(
      "validated-for-review",
    );
    expect(validated.history).toHaveLength(4);
    expect(validated.currentIssues).toEqual([]);
  });
  it("resolves an issue only with exact linked passing Evidence", () => {
    const { issue, result } = initialIssue();
    const evidence = passingClosureEvidence(issue);
    const next = reconcile({
      bundleDigest: digestB,
      diagnostics: [],
      evidence: [evidence],
      markMissingAsStale: true,
      previousRecords: result.history,
      repairReference: {
        description: "The exact candidate repair passed the full check.",
        issueIds: [issue.id],
        proposedPatchDigest: digestB,
        validationStatus: "validated-for-review",
      },
    });

    const resolved = next.latestRecords[0];
    expect(resolved?.lifecycle).toEqual({
      evidenceIds: [evidence.id],
      reason:
        "Exact current passing candidate validation Evidence proves this issue is resolved.",
      resolvedAt: laterAt,
      resolvedBy: "cloudmarkup.ai-extension-generation",
      state: "resolved",
    });
    expect(resolved?.recordVersion).toBe(2);
    expect(resolved?.previousRecordDigest).toBe(issue.currentRecordDigest);
    expect(resolved?.aiProposedFix?.validationStatus).toBe(
      "validated-for-review",
    );
    expect(
      evidence.checks.some((check) => check.issueIds.includes(issue.id)),
    ).toBe(true);
    expect(next.currentIssues).toEqual([]);
    expect(next.resolvedIssueIds).toEqual([issue.id]);
    expect(next.history).toEqual([issue, resolved]);
  });

  it("rejects validated repair claims without exact issue-linked closure Evidence", () => {
    const { issue, result } = initialIssue();
    const unlinked = passingClosureEvidence(issue, { issueIds: [] });
    const failed = passingClosureEvidence(issue, {
      evidenceId: "evidence_candidate_issue_failed",
      status: "failed",
    });
    const repairReference = {
      description: "The repair claims validation success.",
      issueIds: [issue.id],
      proposedPatchDigest: digestB,
      validationStatus: "validated-for-review" as const,
    };

    expect(() =>
      reconcile({
        bundleDigest: digestB,
        evidence: [unlinked],
        markMissingAsStale: true,
        previousRecords: result.history,
        repairReference,
      }),
    ).toThrow(/requires exact passing closure Evidence/u);
    expect(() =>
      reconcile({
        bundleDigest: digestB,
        evidence: [failed],
        markMissingAsStale: true,
        previousRecords: result.history,
        repairReference,
      }),
    ).toThrow(/requires exact passing closure Evidence/u);
  });

  it("preserves resolved history and rejects tampered or truncated chains", () => {
    const { issue, result } = initialIssue();
    const evidence = passingClosureEvidence(issue);
    const resolved = reconcile({
      bundleDigest: digestB,
      evidence: [evidence],
      markMissingAsStale: true,
      previousRecords: result.history,
    });
    const replay = reconcile({
      bundleDigest: digestC,
      evidence: [evidence],
      markMissingAsStale: false,
      previousRecords: resolved.history,
    });

    expect(replay.appendedRecords).toEqual([]);
    expect(replay.history).toEqual(resolved.history);
    expect(replay.latestRecords[0]?.lifecycle.state).toBe("resolved");
    const tampered = resolved.history.map((record, index) =>
      index === 0
        ? { ...record, summary: "Tampered immutable issue copy." }
        : record,
    );
    expect(() =>
      reconcile({
        bundleDigest: digestC,
        evidence: [evidence],
        previousRecords: tampered,
      }),
    ).toThrow(/invalid immutable record digest/u);
    expect(() =>
      reconcile({
        bundleDigest: digestC,
        evidence: [evidence],
        previousRecords: resolved.history.slice(1),
      }),
    ).toThrow(/retain the first immutable record/u);
  });

  it("fails closed before excessive diagnostics or history can be truncated", () => {
    expect(() =>
      reconcile({
        bundleDigest: digestA,
        diagnostics: Array.from({ length: 1_001 }, (_, index) =>
          diagnostic({
            checkId: `cloudmarkup.ai-extension.check-${String(index)}`,
            code: `cloudmarkup.ai-extension.code-${String(index)}`,
          }),
        ),
      }),
    ).toThrow(/bounded candidate issue reconciliation limit/u);
  });
});
