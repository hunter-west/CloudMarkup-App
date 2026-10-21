import {
  getActiveIssueRecordHash,
  getConformanceDifferenceDigestV1,
  getConformanceReportDigestV1,
} from "@cloudmarkup/domain";
import {
  conformanceReportV1Schema,
  type ConformanceReportV1,
} from "@cloudmarkup/schemas";

import {
  architectureCliConformanceSummaryV1Schema,
  type ArchitectureCliConformanceSummaryV1,
} from "./conformance-contracts.js";
import type { ArchitectureCliEvidenceSummaryV1 } from "./contracts.js";

export interface ArchitectureCliConformancePortV1 {
  read(input: {
    readonly environmentId: string;
    readonly root: string;
    readonly signal: AbortSignal;
    readonly solutionRevision: {
      readonly digest: string;
      readonly id: string;
    };
  }): Promise<unknown>;
}

const evidenceRanks = {
  "current-drift": 9,
  deployed: 7,
  designed: 1,
  generated: 3,
  imported: 8,
  planned: 6,
} as const;

export interface ArchitectureCliConformanceProjectionV1 {
  readonly drift: boolean;
  readonly evidence: ArchitectureCliEvidenceSummaryV1;
  readonly report: ConformanceReportV1;
  readonly summary: ArchitectureCliConformanceSummaryV1;
}

export type ArchitectureCliConformanceVerificationV1 =
  | {
      readonly ok: true;
      readonly projection: ArchitectureCliConformanceProjectionV1;
    }
  | {
      readonly code:
        | "cloudmarkup.cli.conformance-environment-mismatch"
        | "cloudmarkup.cli.conformance-invalid"
        | "cloudmarkup.cli.conformance-revision-mismatch";
      readonly ok: false;
    };

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function verifyArchitectureCliConformanceV1(input: {
  readonly environmentId: string;
  readonly report: unknown;
  readonly solutionRevision: { readonly digest: string; readonly id: string };
}): ArchitectureCliConformanceVerificationV1 {
  const parsed = conformanceReportV1Schema.safeParse(input.report);
  if (!parsed.success) {
    return { code: "cloudmarkup.cli.conformance-invalid", ok: false };
  }
  const report = parsed.data;
  if (
    getConformanceReportDigestV1(report) !== report.reportDigest ||
    report.differences.some(
      (difference) =>
        getConformanceDifferenceDigestV1(difference) !==
        difference.differenceDigest,
    ) ||
    report.issues.some(
      (issue) => getActiveIssueRecordHash(issue) !== issue.currentRecordDigest,
    )
  ) {
    return { code: "cloudmarkup.cli.conformance-invalid", ok: false };
  }
  if (
    report.evaluatedSolutionRevision.id !== input.solutionRevision.id ||
    report.evaluatedSolutionRevision.digest !== input.solutionRevision.digest
  ) {
    return {
      code: "cloudmarkup.cli.conformance-revision-mismatch",
      ok: false,
    };
  }
  if (report.environment.environmentId !== input.environmentId) {
    return {
      code: "cloudmarkup.cli.conformance-environment-mismatch",
      ok: false,
    };
  }

  const summary = architectureCliConformanceSummaryV1Schema.parse({
    contractVersion: 1,
    counts: {
      byKind: [...new Set(report.differences.map(({ kind }) => kind))]
        .sort(compareUtf16)
        .map((kind) => ({
          count: report.differences.filter((entry) => entry.kind === kind)
            .length,
          kind,
        })),
      byLayer: report.layers.map(({ layer }) => ({
        count: report.differences.filter((entry) => entry.layer === layer)
          .length,
        layer,
      })),
      bySeverity: [...new Set(report.issues.map(({ severity }) => severity))]
        .sort(compareUtf16)
        .map((severity) => ({
          count: report.issues.filter((entry) => entry.severity === severity)
            .length,
          severity,
        })),
    },
    differenceIds: report.differences
      .map(({ differenceId }) => differenceId)
      .sort(compareUtf16),
    evaluatedAt: report.evaluatedAt,
    issueIds: report.issues.map(({ id }) => id).sort(compareUtf16),
    layers: report.layers.map((layer) => ({
      availability: layer.availability,
      completeness: layer.quality.completeness,
      freshness: layer.quality.freshness,
      layer: layer.layer,
    })),
    mutationPolicy: report.mutationPolicy,
    reportDigest: report.reportDigest,
    reportId: report.reportId,
  });
  const unavailableLevels = report.layers
    .filter(({ availability }) => availability === "unavailable")
    .map(({ layer }) => evidenceRanks[layer])
    .sort((left, right) => left - right);
  const evidence = {
    current: report.layers.filter(
      ({ availability, quality }) =>
        availability === "available" && quality.freshness === "current",
    ).length,
    failed: report.layers.filter(
      ({ quality }) =>
        quality.freshness === "expired" || quality.freshness === "invalid",
    ).length,
    stale: report.layers.filter(({ quality }) => quality.freshness === "stale")
      .length,
    unavailableLevels,
  };
  return {
    ok: true,
    projection: {
      drift:
        report.issues.length > 0 ||
        report.differences.some(({ kind }) => !kind.startsWith("matching-")),
      evidence,
      report,
      summary,
    },
  };
}
