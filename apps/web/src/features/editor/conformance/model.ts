import {
  conformanceViewLayerV1Schema,
  type ConformanceDifferenceV1,
  type ConformanceReportV1,
  type ConformanceViewLayerV1,
} from "@cloudmarkup/schemas";

export const CONTINUOUS_CONFORMANCE_STATES =
  conformanceViewLayerV1Schema.options;

export type ContinuousConformanceState = ConformanceViewLayerV1;

export const continuousConformanceStateLabels: Readonly<
  Record<ContinuousConformanceState, string>
> = Object.freeze({
  designed: "Designed",
  deployed: "Deployed",
  generated: "Generated",
  imported: "Imported",
  planned: "Planned",
  "current-drift": "Current drift",
});

export type ContinuousConformanceDifferenceKind =
  ConformanceDifferenceV1["kind"];

type SharedConformanceLayer = ConformanceReportV1["layers"][number];

export interface ContinuousConformanceQuality {
  readonly availability: SharedConformanceLayer["availability"];
  readonly completeness: SharedConformanceLayer["quality"]["completeness"];
  readonly expiresAt?: string;
  readonly freshness: SharedConformanceLayer["quality"]["freshness"];
  readonly freshnessReasons: SharedConformanceLayer["quality"]["freshnessReasons"];
  readonly lastVerifiedAt?: string;
  readonly reason?: string;
}
export interface ContinuousConformanceEvidenceSummary {
  readonly evidenceIds: readonly string[];
  readonly level?: string;
  readonly provenanceId: string;
  readonly sourceDigest: string;
  readonly sourceLabel: string;
  readonly toolLabel?: string;
  readonly verifiedAt?: string;
}

export interface ContinuousConformanceDiagramNode {
  readonly differenceIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly id: string;
  readonly label: string;
  readonly mapping: "mapped";
  readonly position: { readonly x: number; readonly y: number };
  readonly presence: "present" | "comparison-only-missing" | "unknown";
  readonly serviceLabel: string;
  readonly status:
    "matching" | "different" | "external" | "unmanaged" | "unknown";
}

export interface ContinuousConformanceDiagramEdge {
  readonly differenceIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly id: string;
  readonly label: string;
  readonly mapping: "mapped";
  readonly presence: "present" | "comparison-only-missing" | "unknown";
  readonly sourceNodeId: string;
  readonly status:
    "matching" | "different" | "external" | "unmanaged" | "unknown";
  readonly targetNodeId: string;
}

export interface ContinuousConformanceUnmappedEvidence {
  readonly evidenceIds: readonly string[];
  readonly id: string;
  readonly kind: "resource" | "connection" | "configuration";
  readonly label: string;
  readonly reason: string;
}

export interface ContinuousConformanceLayer {
  readonly diagram: {
    readonly edges: readonly ContinuousConformanceDiagramEdge[];
    readonly nodes: readonly ContinuousConformanceDiagramNode[];
    readonly unmappedEvidence: readonly ContinuousConformanceUnmappedEvidence[];
  };
  readonly evidence: readonly ContinuousConformanceEvidenceSummary[];
  readonly quality: ContinuousConformanceQuality;
  readonly state: ContinuousConformanceState;
}

export type ContinuousConformanceReviewActionKind =
  "github-issue" | "reconciliation-pr";

export interface ContinuousConformanceReviewAction {
  readonly actionKey: string;
  readonly differenceId: string;
  readonly kind: ContinuousConformanceReviewActionKind;
}

export interface ContinuousConformanceDifference {
  readonly differenceId: string;
  readonly evidenceIds: readonly string[];
  readonly kind: ContinuousConformanceDifferenceKind;
  readonly reviewActions: readonly ContinuousConformanceReviewAction[];
  readonly severity: "information" | "warning" | "error" | "security-error";
  readonly states: readonly ContinuousConformanceState[];
  readonly summary: string;
  readonly target?:
    | { readonly id: string; readonly kind: "node" }
    | { readonly id: string; readonly kind: "edge" }
    | { readonly id: string; readonly kind: "unmapped" };
}

export interface ContinuousConformanceDiagramExportIntent {
  readonly contractVersion: 1;
  readonly environmentId: string;
  readonly kind: "cloudmarkup.conformance-diagram-export-intent";
  readonly reportDigest: string;
  readonly reportId: string;
  readonly showDifferences: boolean;
  readonly solutionRevisionId: string;
  readonly state: ContinuousConformanceState;
}

export interface ContinuousConformanceActiveIssueSummary {
  readonly evidenceIds: readonly string[];
  readonly issueId: string;
  readonly lifecycle:
    "current" | "stale" | "resolved" | "accepted" | "deferred";
  readonly severity:
    | "security-error"
    | "error"
    | "cost-warning"
    | "warning"
    | "recommendation"
    | "educational-note";
  readonly source: string;
  readonly summary: string;
}
export interface ContinuousConformanceReadModel {
  readonly differences: readonly ContinuousConformanceDifference[];
  readonly environmentId: string;
  readonly environmentLabel: string;
  readonly issues: readonly ContinuousConformanceActiveIssueSummary[];
  readonly layers: readonly ContinuousConformanceLayer[];
  readonly reportDigest: string;
  readonly reportId: string;
  readonly solutionRevisionId: string;
}
