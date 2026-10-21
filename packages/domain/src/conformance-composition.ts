import {
  activeIssueCollectionV1Schema,
  activeIssueV1Schema,
  conformanceDifferenceV1Schema,
  conformanceEvaluationRequestV1Schema,
  conformanceReportV1Schema,
  utcTimestampSchema,
  type ActiveIssueV1,
  type ConformanceDifferenceV1,
  type ConformanceEvaluationRequestV1,
  type ConformanceReportV1,
} from "@cloudmarkup/schemas";

import {
  evaluateConformanceV1,
  getConformanceReportDigestV1,
} from "./conformance.js";
import { hashCanonicalValue } from "./document-hashing.js";
import {
  getActiveIssueRecordHash,
  validateActiveIssueTransitionV1,
} from "./solution-lifecycle.js";

const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}.${hashCanonicalValue(value).slice("sha256:".length, 31)}`;
}

export type ConformanceCompositionInputV1 = Omit<
  ConformanceEvaluationRequestV1,
  "currentSolutionRevision" | "evaluatedAt" | "evaluator" | "stalenessPolicy"
>;

export interface ConformanceCompositionResultV1 {
  /** Immutable issue records that a persistence adapter may append. */
  readonly issueHistoryUpdates: readonly ActiveIssueV1[];
  readonly report: ConformanceReportV1;
}

export class ConformanceCompositionError extends Error {
  readonly code:
    | "clock-invalid"
    | "evaluation-time-not-authoritative"
    | "evidence-time-incoherent"
    | "issue-history-invalid"
    | "input-invalid";

  constructor(code: ConformanceCompositionError["code"], message: string) {
    super(message);
    this.name = "ConformanceCompositionError";
    this.code = code;
  }
}

function stableDifferenceId(difference: ConformanceDifferenceV1): string {
  return stableId("difference", {
    comparedWithLayer: difference.comparedWithLayer,
    differenceDigest: difference.differenceDigest,
    environmentId: difference.environmentId,
    kind: difference.kind,
    layer: difference.layer,
    leftFactId: difference.leftFactId,
    rightFactId: difference.rightFactId,
    solutionRevisionId: difference.solutionRevisionId,
    subject: difference.subject,
  });
}

function recordWithDigest(issue: ActiveIssueV1): ActiveIssueV1 {
  const withoutDigest = { ...issue, currentRecordDigest: ZERO_DIGEST };
  return activeIssueV1Schema.parse({
    ...withoutDigest,
    currentRecordDigest: getActiveIssueRecordHash(withoutDigest),
  });
}

function rehashReport(
  report: ConformanceReportV1,
  differences: readonly ConformanceDifferenceV1[],
  issues: readonly ActiveIssueV1[],
): ConformanceReportV1 {
  const { reportDigest: _digest, reportId: _id, ...base } = report;
  void _digest;
  void _id;
  const normalizedBase = {
    ...base,
    differences: [...differences],
    issues: [...issues],
  };
  const reportId = stableId("conformance-report", normalizedBase);
  const withId = { ...normalizedBase, reportId };
  const candidate = conformanceReportV1Schema.parse({
    ...withId,
    reportDigest: ZERO_DIGEST,
  });
  return conformanceReportV1Schema.parse({
    ...candidate,
    reportDigest: getConformanceReportDigestV1(candidate),
  });
}

function normalizeStableIssueIdentity(
  report: ConformanceReportV1,
): ConformanceReportV1 {
  const differenceIds = new Map<string, string>();
  const differences = report.differences.map((difference) => {
    const differenceId = stableDifferenceId(difference);
    differenceIds.set(difference.differenceId, differenceId);
    return conformanceDifferenceV1Schema.parse({ ...difference, differenceId });
  });
  const issues = report.issues.map((issue) => {
    const sourceRecordId = differenceIds.get(issue.sourceRecordId);
    if (sourceRecordId === undefined) {
      throw new ConformanceCompositionError(
        "input-invalid",
        "A conformance issue does not bind a report difference.",
      );
    }
    const normalized = {
      ...issue,
      affected: [...issue.affected],
      id: stableId("conformance-issue", {
        environmentId: report.environment.environmentId,
        solutionRevisionId: report.evaluatedSolutionRevision.id,
        sourceRecordId,
      }),
      sourceRecordId,
    };
    return recordWithDigest(activeIssueV1Schema.parse(normalized));
  });
  return rehashReport(report, differences, issues);
}

function assertEvidenceTimes(
  request: ConformanceEvaluationRequestV1,
  evaluatedAtEpoch: number,
): void {
  for (const layer of request.layers) {
    if (layer.availability !== "available") continue;
    if (layer.verifiedAt === undefined) {
      throw new ConformanceCompositionError(
        "input-invalid",
        `Layer ${layer.layer} is missing its verification time.`,
      );
    }
    const verifiedAtEpoch = Date.parse(layer.verifiedAt);
    if (verifiedAtEpoch > evaluatedAtEpoch) {
      throw new ConformanceCompositionError(
        "evidence-time-incoherent",
        `Layer ${layer.layer} cannot be verified in the future.`,
      );
    }
    for (const source of layer.sources) {
      const observedAtEpoch = Date.parse(source.observedAt);
      if (
        observedAtEpoch > evaluatedAtEpoch ||
        observedAtEpoch > verifiedAtEpoch
      ) {
        throw new ConformanceCompositionError(
          "evidence-time-incoherent",
          `Layer ${layer.layer} has future or post-verification source evidence.`,
        );
      }
    }
    if (
      layer.explicitExpiresAt !== undefined &&
      layer.sources.some(
        (source) =>
          Date.parse(layer.explicitExpiresAt ?? "") <=
          Date.parse(source.observedAt),
      )
    ) {
      throw new ConformanceCompositionError(
        "evidence-time-incoherent",
        `Layer ${layer.layer} expires before or at its source observation time.`,
      );
    }
  }
}

function reconcileIssues(
  report: ConformanceReportV1,
  previousIssuesInput: unknown,
): {
  readonly current: readonly ActiveIssueV1[];
  readonly updates: readonly ActiveIssueV1[];
} {
  let previousIssues: readonly ActiveIssueV1[];
  try {
    previousIssues = activeIssueCollectionV1Schema.parse({
      contractVersion: 1,
      issues: previousIssuesInput ?? [],
    }).issues;
  } catch {
    throw new ConformanceCompositionError(
      "issue-history-invalid",
      "Previous conformance issue records are invalid.",
    );
  }
  const previousById = new Map<string, ActiveIssueV1>();
  for (const previous of previousIssues) {
    if (
      previous.currentRecordDigest !== getActiveIssueRecordHash(previous) ||
      previous.solutionRevisionId !== report.evaluatedSolutionRevision.id ||
      previousById.has(previous.id)
    ) {
      throw new ConformanceCompositionError(
        "issue-history-invalid",
        "Previous conformance issue records are not unique, current, and revision-bound.",
      );
    }
    previousById.set(previous.id, previous);
  }

  const updates: ActiveIssueV1[] = [];
  const current = report.issues.map((candidate) => {
    const previous = previousById.get(candidate.id);
    if (previous === undefined) {
      updates.push(candidate);
      return candidate;
    }
    previousById.delete(candidate.id);
    if (
      previous.sourceRecordId !== candidate.sourceRecordId ||
      previous.source !== candidate.source ||
      previous.category !== candidate.category
    ) {
      throw new ConformanceCompositionError(
        "issue-history-invalid",
        "A stable conformance issue ID cannot change its source lineage.",
      );
    }
    if (previous.lifecycle.state === "current") return previous;
    const next = recordWithDigest({
      ...candidate,
      affected: previous.affected,
      closureRequirements: previous.closureRequirements,
      previousRecordDigest: previous.currentRecordDigest,
      recordVersion: previous.recordVersion + 1,
    });
    try {
      validateActiveIssueTransitionV1(previous, next);
    } catch {
      throw new ConformanceCompositionError(
        "issue-history-invalid",
        "A conformance issue could not be reopened through a valid immutable transition.",
      );
    }
    updates.push(next);
    return next;
  });

  for (const previous of previousById.values()) {
    if (previous.lifecycle.state !== "current") continue;
    const stale = recordWithDigest({
      ...previous,
      lifecycle: {
        reason:
          "The latest deterministic evaluation no longer contains the source difference; retain history pending reviewed closure.",
        staleAt: report.evaluatedAt,
        state: "stale",
      },
      previousRecordDigest: previous.currentRecordDigest,
      provenance: {
        actor: { kind: "deterministic-tool", tool: report.evaluator },
        createdAt: report.evaluatedAt,
        inputDigests: report.provenance.inputDigests,
      },
      recordVersion: previous.recordVersion + 1,
    });
    try {
      validateActiveIssueTransitionV1(previous, stale);
    } catch {
      throw new ConformanceCompositionError(
        "issue-history-invalid",
        "A cleared conformance issue could not be marked stale through a valid immutable transition.",
      );
    }
    updates.push(stale);
  }
  return {
    current: current.sort((left, right) => compareUtf16(left.id, right.id)),
    updates: updates.sort((left, right) => compareUtf16(left.id, right.id)),
  };
}

/**
 * Production composition boundary. The source supplies immutable evidence only;
 * evaluation time is always reconstructed from the injected clock.
 */
export function composeConformanceReportV1(input: {
  readonly clock: () => Date;
  readonly currentSolutionRevision: ConformanceEvaluationRequestV1["currentSolutionRevision"];
  readonly evaluation: unknown;
  readonly evaluator: ConformanceEvaluationRequestV1["evaluator"];
  readonly stalenessPolicy: ConformanceEvaluationRequestV1["stalenessPolicy"];
  readonly previousIssues?: unknown;
}): ConformanceCompositionResultV1 {
  if (
    typeof input.evaluation !== "object" ||
    input.evaluation === null ||
    Array.isArray(input.evaluation)
  ) {
    throw new ConformanceCompositionError(
      "input-invalid",
      "Conformance composition requires one exact evidence input object.",
    );
  }
  const evidenceInput = input.evaluation;
  const untrustedFields = [
    "currentSolutionRevision",
    "evaluatedAt",
    "evaluator",
    "stalenessPolicy",
  ];
  if (untrustedFields.some((field) => Object.hasOwn(evidenceInput, field))) {
    throw new ConformanceCompositionError(
      "evaluation-time-not-authoritative",
      "Evidence inputs cannot choose the current revision, evaluation time, evaluator, or staleness policy.",
    );
  }
  const now = input.clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new ConformanceCompositionError(
      "clock-invalid",
      "The conformance evaluation clock is invalid.",
    );
  }
  const evaluatedAt = utcTimestampSchema.parse(now.toISOString());
  let request: ConformanceEvaluationRequestV1;
  try {
    request = conformanceEvaluationRequestV1Schema.parse({
      ...(input.evaluation as Record<string, unknown>),
      evaluatedAt,
      currentSolutionRevision: input.currentSolutionRevision,
      evaluator: input.evaluator,
      stalenessPolicy: input.stalenessPolicy,
    });
  } catch {
    throw new ConformanceCompositionError(
      "input-invalid",
      "Conformance evidence inputs are invalid or incomplete.",
    );
  }
  assertEvidenceTimes(request, now.getTime());
  const evaluated = normalizeStableIssueIdentity(
    evaluateConformanceV1(request),
  );
  const reconciled = reconcileIssues(evaluated, input.previousIssues);
  return {
    issueHistoryUpdates: reconciled.updates,
    report: rehashReport(evaluated, evaluated.differences, reconciled.current),
  };
}
