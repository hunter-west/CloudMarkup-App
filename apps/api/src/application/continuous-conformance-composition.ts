import {
  composeConformanceReportV1,
  getConformanceReportDigestV1,
  getConformanceReportStateDigestV1,
  hashCanonicalValue,
} from "@cloudmarkup/domain";
import {
  conformanceReportV1Schema,
  sha256DigestSchema,
  type ActiveIssueV1,
  type ConformanceEvaluationRequestV1,
  type ConformanceReportV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import type { ContinuousConformanceReportSource } from "./continuous-conformance.js";
import { ApplicationError } from "./errors.js";

export const continuousConformanceInputDocumentV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evaluation: z.unknown(),
    kind: z.literal("cloudmarkup.continuous-conformance-input"),
  })
  .strict();

const continuousConformanceReportSnapshotV1Schema = z
  .object({
    report: conformanceReportV1Schema,
    selectionDigest: sha256DigestSchema,
  })
  .strict();

export interface ContinuousConformanceInputScopeV1 {
  readonly environmentId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly solutionRevisionId: string;
}

export interface ContinuousConformanceInputSourceV1 {
  get(input: ContinuousConformanceInputScopeV1): Promise<unknown>;
}

export interface ContinuousConformanceTrustedContextV1 {
  readonly currentSolutionRevision: ConformanceEvaluationRequestV1["currentSolutionRevision"];
  readonly previousIssues?: readonly ActiveIssueV1[];
}

export interface ContinuousConformanceTrustedContextSourceV1 {
  get(
    input: ContinuousConformanceInputScopeV1,
  ): Promise<ContinuousConformanceTrustedContextV1 | null>;
}

export interface ContinuousConformanceIssueUpdateSinkV1 {
  appendIfAbsent(input: {
    readonly reportDigest: string;
    readonly reportId: string;
    readonly scope: ContinuousConformanceInputScopeV1;
    readonly updates: readonly ActiveIssueV1[];
  }): Promise<void>;
}

export interface ContinuousConformanceReportBindingV1 {
  readonly reportDigest: string;
  readonly reportId: string;
}

export interface ContinuousConformanceReportSnapshotV1 {
  readonly report: ConformanceReportV1;
  readonly selectionDigest: string;
}

export interface ContinuousConformanceReportSnapshotStoreV1 {
  getExact(input: {
    readonly binding: ContinuousConformanceReportBindingV1;
    readonly scope: ContinuousConformanceInputScopeV1;
  }): Promise<unknown>;
  getLatest(scope: ContinuousConformanceInputScopeV1): Promise<unknown>;
  saveLatest(input: {
    readonly scope: ContinuousConformanceInputScopeV1;
    readonly snapshot: ContinuousConformanceReportSnapshotV1;
  }): Promise<void>;
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function nextIssueHistory(
  previous: readonly ActiveIssueV1[],
  updates: readonly ActiveIssueV1[],
): readonly ActiveIssueV1[] {
  const byId = new Map<string, ActiveIssueV1>();
  for (const issue of previous) {
    byId.set(issue.id, issue);
  }
  for (const update of updates) {
    byId.set(update.id, update);
  }
  return [...byId.values()].sort((left, right) =>
    compareUtf16(left.id, right.id),
  );
}

function selectionDigest(input: {
  readonly currentSolutionRevision: ConformanceEvaluationRequestV1["currentSolutionRevision"];
  readonly evaluation: unknown;
  readonly evaluator: ConformanceEvaluationRequestV1["evaluator"];
  readonly issueHistory: readonly ActiveIssueV1[];
  readonly stalenessPolicy: ConformanceEvaluationRequestV1["stalenessPolicy"];
}): string {
  return hashCanonicalValue({
    contractVersion: 1,
    currentSolutionRevision: input.currentSolutionRevision,
    evaluation: input.evaluation,
    evaluator: input.evaluator,
    issueHistory: input.issueHistory,
    kind: "cloudmarkup.continuous-conformance-selection",
    stalenessPolicy: input.stalenessPolicy,
  });
}

function parseStoredSnapshot(
  raw: unknown,
  scope: ContinuousConformanceInputScopeV1,
  binding?: ContinuousConformanceReportBindingV1,
): ContinuousConformanceReportSnapshotV1 {
  const parsed = continuousConformanceReportSnapshotV1Schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApplicationError(
      "service_unavailable",
      "Continuous conformance evidence is not currently verifiable.",
    );
  }
  const report = parsed.data.report;
  const bindingMatches =
    binding === undefined ||
    (report.reportDigest === binding.reportDigest &&
      report.reportId === binding.reportId);
  if (
    getConformanceReportDigestV1(report) !== report.reportDigest ||
    report.projectId !== scope.projectId ||
    report.evaluatedSolutionRevision.id !== scope.solutionRevisionId ||
    report.environment.environmentId !== scope.environmentId ||
    !bindingMatches
  ) {
    throw new ApplicationError(
      "service_unavailable",
      "Continuous conformance evidence is not currently verifiable.",
    );
  }
  return parsed.data;
}

/**
 * Tenant-scoped application composition. It reconstructs every report from
 * immutable six-layer inputs at read time, so cached browser timestamps or a
 * previously evaluated report cannot determine current freshness.
 */
export class ComposingContinuousConformanceReportSource implements ContinuousConformanceReportSource {
  readonly #clock: () => Date;
  readonly #issueUpdates: ContinuousConformanceIssueUpdateSinkV1;
  readonly #snapshots: ContinuousConformanceReportSnapshotStoreV1;
  readonly #source: ContinuousConformanceInputSourceV1;
  readonly #evaluator: ConformanceEvaluationRequestV1["evaluator"];
  readonly #stalenessPolicy: ConformanceEvaluationRequestV1["stalenessPolicy"];
  readonly #trustedContext: ContinuousConformanceTrustedContextSourceV1;

  constructor(options: {
    readonly clock: () => Date;
    readonly evaluator: ConformanceEvaluationRequestV1["evaluator"];
    readonly issueUpdates: ContinuousConformanceIssueUpdateSinkV1;
    readonly snapshots: ContinuousConformanceReportSnapshotStoreV1;
    readonly source: ContinuousConformanceInputSourceV1;
    readonly stalenessPolicy: ConformanceEvaluationRequestV1["stalenessPolicy"];
    readonly trustedContext: ContinuousConformanceTrustedContextSourceV1;
  }) {
    this.#clock = options.clock;
    this.#evaluator = options.evaluator;
    this.#issueUpdates = options.issueUpdates;
    this.#snapshots = options.snapshots;
    this.#source = options.source;
    this.#stalenessPolicy = options.stalenessPolicy;
    this.#trustedContext = options.trustedContext;
  }

  async get(
    input: ContinuousConformanceInputScopeV1,
    binding?: ContinuousConformanceReportBindingV1,
  ): Promise<unknown> {
    let untrusted: unknown;
    let trusted: ContinuousConformanceTrustedContextV1 | null;
    try {
      [untrusted, trusted] = await Promise.all([
        this.#source.get(input),
        this.#trustedContext.get(input),
      ]);
    } catch {
      throw new ApplicationError(
        "service_unavailable",
        "Continuous conformance evidence is not currently verifiable.",
      );
    }
    if (untrusted === null || trusted === null) return null;
    const document =
      continuousConformanceInputDocumentV1Schema.safeParse(untrusted);
    if (!document.success) {
      throw new ApplicationError(
        "service_unavailable",
        "Continuous conformance evidence is not currently verifiable.",
      );
    }
    try {
      const composition = composeConformanceReportV1({
        clock: this.#clock,
        currentSolutionRevision: trusted.currentSolutionRevision,
        evaluation: document.data.evaluation,
        evaluator: this.#evaluator,
        previousIssues: trusted.previousIssues,
        stalenessPolicy: this.#stalenessPolicy,
      });
      const report = composition.report;
      if (
        report.projectId !== input.projectId ||
        report.evaluatedSolutionRevision.id !== input.solutionRevisionId ||
        report.environment.environmentId !== input.environmentId
      ) {
        return null;
      }
      const issueHistory = nextIssueHistory(
        trusted.previousIssues ?? [],
        composition.issueHistoryUpdates,
      );
      const currentSelectionDigest = selectionDigest({
        currentSolutionRevision: trusted.currentSolutionRevision,
        evaluation: document.data.evaluation,
        evaluator: this.#evaluator,
        issueHistory,
        stalenessPolicy: this.#stalenessPolicy,
      });
      const rawSnapshot =
        binding === undefined
          ? await this.#snapshots.getLatest(input)
          : await this.#snapshots.getExact({
              binding,
              scope: input,
            });
      const storedSnapshot =
        rawSnapshot === null
          ? null
          : parseStoredSnapshot(rawSnapshot, input, binding);
      if (composition.issueHistoryUpdates.length > 0) {
        await this.#issueUpdates.appendIfAbsent({
          reportDigest: report.reportDigest,
          reportId: report.reportId,
          scope: input,
          updates: composition.issueHistoryUpdates,
        });
      }
      if (
        storedSnapshot !== null &&
        storedSnapshot.selectionDigest === currentSelectionDigest &&
        getConformanceReportStateDigestV1(storedSnapshot.report) ===
          getConformanceReportStateDigestV1(report)
      ) {
        return storedSnapshot.report;
      }
      await this.#snapshots.saveLatest({
        scope: input,
        snapshot: {
          report,
          selectionDigest: currentSelectionDigest,
        },
      });
      return report;
    } catch (cause) {
      if (cause instanceof ApplicationError) throw cause;
      throw new ApplicationError(
        "service_unavailable",
        "Continuous conformance evidence is not currently verifiable.",
      );
    }
  }
}
