import { Button, StatusBadge, type StatusTone } from "@cloudmarkup/ui";
import { useMemo, useState } from "react";

import { ConformanceDiagram } from "./ConformanceDiagram.js";
import {
  CONTINUOUS_CONFORMANCE_STATES,
  continuousConformanceStateLabels,
  type ContinuousConformanceActiveIssueSummary,
  type ContinuousConformanceDiagramExportIntent,
  type ContinuousConformanceDifference,
  type ContinuousConformanceReadModel,
  type ContinuousConformanceReviewAction,
  type ContinuousConformanceReviewActionKind,
  type ContinuousConformanceState,
} from "./model.js";
import {
  compareConformanceText,
  safeConformanceLabel,
} from "./presentation.js";

import "./continuous-conformance.css";

function qualityTone(
  completeness: "complete" | "partial" | "unknown",
  freshness: "current" | "stale" | "expired" | "invalid",
): StatusTone {
  if (completeness === "complete" && freshness === "current") {
    return "success";
  }
  if (completeness === "unknown" || freshness === "invalid") {
    return "incomplete";
  }
  return "warning";
}

function qualityDescription(
  quality: ContinuousConformanceReadModel["layers"][number]["quality"],
): string {
  if (quality.reason !== undefined) return quality.reason;
  if (quality.completeness === "complete" && quality.freshness === "current") {
    return "Complete and current for its declared scope.";
  }
  return `Evidence is ${quality.completeness} and ${quality.freshness} for its declared scope.`;
}

function issueTone(
  severity: ContinuousConformanceActiveIssueSummary["severity"],
): StatusTone {
  if (severity === "security-error") return "security";
  if (severity === "error") return "error";
  if (severity === "cost-warning") return "cost";
  if (severity === "warning") return "warning";
  if (severity === "recommendation") return "info";
  return "neutral";
}

function actionLabel(kind: ContinuousConformanceReviewActionKind): string {
  return kind === "github-issue"
    ? "Create or update reviewed GitHub issue"
    : "Prepare reviewed reconciliation PR";
}

function DifferenceList({
  differences,
  onReviewAction,
  pendingReviewActionKey,
}: {
  readonly differences: readonly ContinuousConformanceDifference[];
  readonly onReviewAction?: (action: ContinuousConformanceReviewAction) => void;
  readonly pendingReviewActionKey?: string;
}) {
  if (differences.length === 0) {
    return <p>No difference is established for this state.</p>;
  }
  return (
    <ul className="continuous-conformance__difference-list">
      {differences.map((difference) => (
        <li data-severity={difference.severity} key={difference.differenceId}>
          <header>
            <StatusBadge
              label={difference.severity}
              tone={
                difference.severity === "security-error"
                  ? "security"
                  : difference.severity === "error"
                    ? "error"
                    : difference.severity === "warning"
                      ? "warning"
                      : "neutral"
              }
            />
            <strong>{difference.kind.replaceAll("-", " ")}</strong>
          </header>
          <p>{safeConformanceLabel(difference.summary, 500)}</p>
          <small>
            Difference <code>{difference.differenceId}</code> · Evidence{" "}
            {difference.evidenceIds.length === 0
              ? "not established"
              : difference.evidenceIds.join(", ")}
          </small>
          {difference.reviewActions.length === 0 ||
          onReviewAction === undefined ? null : (
            <div
              aria-label={`Review actions for ${difference.differenceId}`}
              className="continuous-conformance__review-actions"
            >
              {difference.reviewActions.map((action) => (
                <Button
                  disabled={pendingReviewActionKey !== undefined}
                  key={action.actionKey}
                  onClick={() => {
                    onReviewAction(action);
                  }}
                  size="compact"
                  variant="secondary"
                >
                  {pendingReviewActionKey === action.actionKey
                    ? "Submitting reviewed action…"
                    : actionLabel(action.kind)}
                </Button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ActiveIssueSummaryList({
  issues,
}: {
  readonly issues: readonly ContinuousConformanceActiveIssueSummary[];
}) {
  return (
    <section
      aria-labelledby="continuous-conformance-active-issues-title"
      className="continuous-conformance__active-issues"
    >
      <header>
        <p className="status-label">Cross-source evidence</p>
        <h3 id="continuous-conformance-active-issues-title">
          Active conformance issues ({String(issues.length)})
        </h3>
      </header>
      {issues.length === 0 ? (
        <p>No cross-source conformance issue is currently projected.</p>
      ) : (
        <ul>
          {issues.map((issue) => (
            <li key={issue.issueId}>
              <StatusBadge
                label={`${issue.severity} · ${issue.lifecycle}`}
                tone={issueTone(issue.severity)}
              />
              <strong>{safeConformanceLabel(issue.summary, 500)}</strong>
              <span>{safeConformanceLabel(issue.source, 120)}</span>
              <small>
                Issue <code>{issue.issueId}</code> · Evidence{" "}
                {issue.evidenceIds.length === 0
                  ? "pending"
                  : issue.evidenceIds.join(", ")}
              </small>
            </li>
          ))}
        </ul>
      )}
      <p>
        Issue lifecycle is server-authored. This view cannot close an issue or
        remediate infrastructure.
      </p>
    </section>
  );
}

export function ContinuousConformanceWorkspace({
  exportPending = false,
  mode,
  onExportDiagram,
  onReviewAction,
  operationFeedback,
  pendingReviewActionKey,
  report,
}: {
  readonly exportPending?: boolean;
  readonly mode: "guided" | "professional";
  readonly onExportDiagram?: (
    intent: ContinuousConformanceDiagramExportIntent,
  ) => void;
  readonly onReviewAction?: (action: ContinuousConformanceReviewAction) => void;
  readonly operationFeedback?: {
    readonly message: string;
    readonly tone: "error" | "status";
  };
  readonly pendingReviewActionKey?: string;
  readonly report: ContinuousConformanceReadModel;
}) {
  const [selectedState, setSelectedState] =
    useState<ContinuousConformanceState>("designed");
  const [showDifferences, setShowDifferences] = useState(true);
  const layers = useMemo(
    () => new Map(report.layers.map((layer) => [layer.state, layer])),
    [report.layers],
  );
  const selectedLayer = layers.get(selectedState);
  const differences = [...report.differences]
    .filter(({ states }) => states.includes(selectedState))
    .sort((left, right) =>
      compareConformanceText(left.differenceId, right.differenceId),
    );

  return (
    <section
      aria-labelledby="continuous-conformance-title"
      className="continuous-conformance"
      data-assistance-mode={mode}
    >
      <header className="continuous-conformance__heading">
        <p className="status-label">Continuous conformance</p>
        <h2 id="continuous-conformance-title">
          Design, repository, generated, and environment evidence
        </h2>
        <p>
          {mode === "guided"
            ? "Compare each independently verified state. Missing, stale, or partial Evidence stays visible and never changes your approved design automatically."
            : "Review distinct designed, imported, generated, planned, deployed, and current-drift projections with exact Evidence provenance."}
        </p>
        <p>
          <strong>Read-only comparison:</strong> no layer becomes design
          authority, complete inventory is never inferred, and no automatic
          remediation is available.
        </p>
      </header>

      <div
        aria-label="Conformance evidence state"
        className="continuous-conformance__state-controls"
        role="group"
      >
        {CONTINUOUS_CONFORMANCE_STATES.map((state) => (
          <Button
            aria-pressed={selectedState === state}
            key={state}
            onClick={() => {
              setSelectedState(state);
            }}
            size="compact"
            variant={selectedState === state ? "primary" : "secondary"}
          >
            {continuousConformanceStateLabels[state]}
          </Button>
        ))}
      </div>
      <label className="continuous-conformance__difference-toggle">
        <input
          checked={showDifferences}
          onChange={(event) => {
            setShowDifferences(event.currentTarget.checked);
          }}
          type="checkbox"
        />
        Show Differences overlay
      </label>
      {onExportDiagram === undefined ? (
        <p className="continuous-conformance__export-unavailable" role="status">
          Evidence diagram export is unavailable until server-verified
          reconstruction is configured for this project.
        </p>
      ) : (
        <Button
          disabled={exportPending}
          onClick={() => {
            onExportDiagram({
              contractVersion: 1,
              environmentId: report.environmentId,
              kind: "cloudmarkup.conformance-diagram-export-intent",
              reportDigest: report.reportDigest,
              reportId: report.reportId,
              showDifferences,
              solutionRevisionId: report.solutionRevisionId,
              state: selectedState,
            });
          }}
          size="compact"
          variant="secondary"
        >
          {exportPending
            ? "Preparing evidence diagram…"
            : "Export current evidence diagram"}
        </Button>
      )}

      {operationFeedback === undefined ? null : (
        <p
          className="continuous-conformance__operation-feedback"
          role={operationFeedback.tone === "error" ? "alert" : "status"}
        >
          {operationFeedback.message}
        </p>
      )}

      <section
        aria-label="Conformance legend"
        className="continuous-conformance__legend"
      >
        <strong>Legend</strong>
        <ul>
          <li data-conformance-presence="present">Mapped and evidenced</li>
          <li data-conformance-presence="comparison-only-missing">
            Comparison-only / missing
          </li>
          <li data-conformance-presence="unknown">Unknown</li>
          <li data-conformance-status="matching">Matching</li>
          <li data-conformance-status="different">Difference</li>
          <li data-conformance-status="external">External or unmanaged</li>
        </ul>
      </section>

      {selectedLayer === undefined ||
      selectedLayer.quality.availability === "unavailable" ? (
        <section className="continuous-conformance__unavailable" role="status">
          <StatusBadge label="Evidence unavailable" tone="incomplete" />
          <h3>{continuousConformanceStateLabels[selectedState]}</h3>
          <p>
            {selectedLayer === undefined
              ? "No authorized Evidence projection was supplied for this state."
              : (selectedLayer.quality.reason ??
                "Evidence was explicitly reported as unavailable.")}{" "}
            This is unknown, not an empty or matching environment.
          </p>
        </section>
      ) : (
        <>
          <section className="continuous-conformance__quality">
            <div>
              <h3>{continuousConformanceStateLabels[selectedState]}</h3>
              <StatusBadge
                label={`${selectedLayer.quality.completeness} · ${selectedLayer.quality.freshness}`}
                tone={qualityTone(
                  selectedLayer.quality.completeness,
                  selectedLayer.quality.freshness,
                )}
              />
            </div>
            <dl>
              <div>
                <dt>Last verified</dt>
                <dd>
                  {selectedLayer.quality.lastVerifiedAt ?? "Not established"}
                </dd>
              </div>
              <div>
                <dt>Evidence expires</dt>
                <dd>{selectedLayer.quality.expiresAt ?? "Not declared"}</dd>
              </div>
              <div>
                <dt>Evidence quality</dt>
                <dd>
                  {safeConformanceLabel(
                    qualityDescription(selectedLayer.quality),
                    500,
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <ConformanceDiagram
            differences={report.differences}
            layer={selectedLayer}
            showDifferences={showDifferences}
          />

          <div className="continuous-conformance__details-grid">
            <section aria-labelledby="continuous-conformance-provenance-title">
              <h3 id="continuous-conformance-provenance-title">
                Provenance ({String(selectedLayer.evidence.length)})
              </h3>
              {selectedLayer.evidence.length === 0 ? (
                <p>No Evidence reference was supplied for this state.</p>
              ) : (
                <ul>
                  {selectedLayer.evidence.map((evidence) => (
                    <li key={evidence.provenanceId}>
                      <strong>
                        {safeConformanceLabel(evidence.sourceLabel, 180)}
                      </strong>
                      <span>
                        {evidence.level === undefined
                          ? "Evidence level not projected"
                          : safeConformanceLabel(evidence.level, 120)}
                      </span>
                      <small>
                        <code>{evidence.provenanceId}</code>
                        {evidence.verifiedAt === undefined
                          ? " · verification time unknown"
                          : ` · ${evidence.verifiedAt}`}
                        {evidence.toolLabel === undefined
                          ? ""
                          : ` · ${safeConformanceLabel(evidence.toolLabel, 120)}`}
                        {` · source ${evidence.sourceDigest} · Evidence ${evidence.evidenceIds.join(", ") || "not established"}`}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="continuous-conformance-unmapped-title">
              <h3 id="continuous-conformance-unmapped-title">
                Unmapped Evidence (
                {String(selectedLayer.diagram.unmappedEvidence.length)})
              </h3>
              {selectedLayer.diagram.unmappedEvidence.length === 0 ? (
                <p>No unmapped Evidence was reported in the declared scope.</p>
              ) : (
                <ul>
                  {selectedLayer.diagram.unmappedEvidence.map((item) => (
                    <li key={item.id}>
                      <strong>{safeConformanceLabel(item.label, 180)}</strong>
                      <span>{item.kind}</span>
                      <small>
                        {safeConformanceLabel(item.reason, 300)} · Evidence{" "}
                        {item.evidenceIds.join(", ") || "not established"}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      <section aria-labelledby="continuous-conformance-differences-title">
        <h3 id="continuous-conformance-differences-title">
          Differences for {continuousConformanceStateLabels[selectedState]} (
          {String(differences.length)})
        </h3>
        <DifferenceList
          differences={differences}
          {...(onReviewAction === undefined ? {} : { onReviewAction })}
          {...(pendingReviewActionKey === undefined
            ? {}
            : { pendingReviewActionKey })}
        />
        <p>
          Review actions create or update review artifacts only. A GitHub issue
          or reconciliation pull request cannot approve, deploy, or remediate a
          change automatically.
        </p>
      </section>

      <details>
        <summary>Technical details</summary>
        <dl className="continuous-conformance__technical">
          <div>
            <dt>Report</dt>
            <dd>
              <code>{report.reportId}</code>
            </dd>
          </div>
          <div>
            <dt>Report digest</dt>
            <dd>
              <code>{report.reportDigest}</code>
            </dd>
          </div>
          <div>
            <dt>Solution Revision</dt>
            <dd>
              <code>{report.solutionRevisionId}</code>
            </dd>
          </div>
          <div>
            <dt>Environment</dt>
            <dd>{safeConformanceLabel(report.environmentLabel, 160)}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
