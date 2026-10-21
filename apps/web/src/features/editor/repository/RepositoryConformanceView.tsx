import { Button, Tabs } from "@cloudmarkup/ui";
import type {
  RepositoryConformanceDifferenceV1,
  RepositoryImportResultV1,
} from "@cloudmarkup/repository-importer";
import type {
  ArchitectureDocumentV3,
  ReconciliationOperationV1,
} from "@cloudmarkup/schemas";
import { useState } from "react";
import { ObservedArchitectureDiagram } from "./ObservedArchitectureDiagram.js";

import "./repository-conformance.css";

export type RepositoryReviewActionKind =
  | "accept-into-design"
  | "keep-observed-only"
  | "mark-external"
  | "regenerate-to-design"
  | "ignore"
  | "reject";

type ConformanceVisualState =
  | "matching"
  | "observed-only"
  | "designed-only"
  | "changed"
  | "external"
  | "unresolved";

const visualStateLabels: Readonly<Record<ConformanceVisualState, string>> = {
  changed: "Changed",
  "designed-only": "Designed-only",
  external: "External",
  matching: "Matching",
  "observed-only": "Observed-only",
  unresolved: "Unresolved",
};

function differenceState(
  difference: RepositoryConformanceDisplayDifference,
): ConformanceVisualState {
  if (difference.kind === "matches") return "matching";
  if (difference.kind === "designed-but-not-observed") return "designed-only";
  if (difference.kind === "observed-but-not-designed") return "observed-only";
  if (difference.kind === "unsupported-unresolved-import") return "unresolved";
  if (difference.kind === "ownership-mismatch") return "external";
  return "changed";
}

export interface RepositoryReviewAction {
  readonly action: RepositoryReviewActionKind;
  readonly differenceId: string;
  readonly operationId?: string;
  readonly reason?: string;
  readonly expiresAt?: string;
}

export interface RepositoryConformanceDisplayDifference {
  readonly designTargetId?: string | undefined;
  readonly differenceId: string;
  readonly evidenceIds: readonly string[];
  readonly kind: RepositoryConformanceDifferenceV1["kind"];
  readonly observedFactIds: readonly string[];
  readonly operationId?: string | undefined;
  readonly operationKind?: ReconciliationOperationV1["kind"] | undefined;
  readonly severity: RepositoryConformanceDifferenceV1["severity"];
  readonly summary: string;
}

export interface RepositoryConformanceDisplayIssue {
  readonly id: string;
  readonly lifecycle: { readonly state: string };
  readonly severity: RepositoryImportResultV1["issues"][number]["severity"];
  readonly sourceRecordId: string;
  readonly summary: string;
}

export interface RepositoryConformanceDisplayResult {
  readonly differences: readonly RepositoryConformanceDisplayDifference[];
  readonly issues: readonly RepositoryConformanceDisplayIssue[];
  readonly observedSolution: RepositoryImportResultV1["observedSolution"];
  readonly proposal?:
    | {
        readonly operations: readonly ReconciliationOperationV1[];
      }
    | undefined;
}

function DifferenceCard({
  difference,
  enabled,
  onReviewAction,
  operationId,
  operationKind,
  regenerationUnavailableReason,
}: {
  readonly difference: RepositoryConformanceDisplayDifference;
  readonly enabled: boolean;
  readonly onReviewAction?:
    ((action: RepositoryReviewAction) => void) | undefined;
  readonly operationId?: string | undefined;
  readonly operationKind?: ReconciliationOperationV1["kind"] | undefined;
  readonly regenerationUnavailableReason?: string | undefined;
}) {
  const [reason, setReason] = useState("");
  const emit = (action: RepositoryReviewActionKind) => {
    onReviewAction?.({
      action,
      differenceId: difference.differenceId,
      ...(operationId === undefined ? {} : { operationId }),
      ...(action === "ignore" && reason.trim() !== ""
        ? { reason: reason.trim() }
        : {}),
    });
  };
  const hasOperation = enabled && operationId !== undefined;
  const acceptsDesign =
    hasOperation &&
    (operationKind === "accept-observed-graph-change" ||
      operationKind === "accept-observed-domain-change");
  const marksExternal =
    hasOperation && operationKind === "mark-intentionally-external";
  const regenerates =
    hasOperation &&
    operationKind === "update-generated-output-to-design" &&
    regenerationUnavailableReason === undefined;
  const ignores = hasOperation && operationKind === "ignore-observation";
  return (
    <li
      className="repository-conformance__difference"
      data-conformance-state={differenceState(difference)}
    >
      <header>
        <span data-severity={difference.severity}>{difference.severity}</span>
        <strong>{difference.kind}</strong>
      </header>
      <p>{difference.summary}</p>
      <p className="repository-conformance__provenance">
        Difference {difference.differenceId}; Evidence{" "}
        {difference.evidenceIds.join(", ") || "not linked"}
      </p>
      <div
        className="repository-conformance__actions"
        aria-label={`Review ${difference.differenceId}`}
      >
        <Button
          disabled={!acceptsDesign}
          onClick={() => {
            emit("accept-into-design");
          }}
        >
          Accept into design
        </Button>
        <Button
          disabled={!hasOperation}
          onClick={() => {
            emit("keep-observed-only");
          }}
        >
          Keep observed-only
        </Button>
        <Button
          disabled={!marksExternal}
          onClick={() => {
            emit("mark-external");
          }}
        >
          Mark external
        </Button>
        <Button
          disabled={!regenerates}
          onClick={() => {
            emit("regenerate-to-design");
          }}
        >
          Regenerate to design
        </Button>
        <Button
          disabled={!hasOperation}
          onClick={() => {
            emit("reject");
          }}
        >
          Reject observation
        </Button>
      </div>
      {operationKind === "update-generated-output-to-design" &&
      regenerationUnavailableReason !== undefined ? (
        <p>{regenerationUnavailableReason}</p>
      ) : null}
      <div className="repository-conformance__ignore">
        <label>
          Ignore reason
          <input
            value={reason}
            maxLength={1_000}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
          />
        </label>
        <Button
          disabled={!ignores || reason.trim() === ""}
          onClick={() => {
            emit("ignore");
          }}
        >
          Ignore with reason
        </Button>
      </div>
    </li>
  );
}

function ApprovedDiagramProjection({
  architecture,
  stateFor,
}: {
  readonly architecture: ArchitectureDocumentV3;
  readonly stateFor: (nodeId: string) => ConformanceVisualState;
}) {
  if (architecture.nodes.length === 0) {
    return <p>The approved design contains no architecture nodes.</p>;
  }
  const width = 800;
  const height = 420;
  const nodeWidth = 168;
  const nodeHeight = 66;
  const sourceX = architecture.nodes.map(
    ({ presentation }) => presentation.position.x,
  );
  const sourceY = architecture.nodes.map(
    ({ presentation }) => presentation.position.y,
  );
  const minX = Math.min(...sourceX);
  const maxX = Math.max(...sourceX);
  const minY = Math.min(...sourceY);
  const maxY = Math.max(...sourceY);
  const project = (
    value: number,
    minimum: number,
    maximum: number,
    span: number,
  ) =>
    minimum === maximum
      ? span / 2
      : 100 + ((value - minimum) / (maximum - minimum)) * (span - 200);
  const positions = new Map(
    architecture.nodes.map((node) => [
      node.id,
      {
        x: project(node.presentation.position.x, minX, maxX, width),
        y: project(node.presentation.position.y, minY, maxY, height),
      },
    ]),
  );
  return (
    <figure className="repository-conformance__diagram">
      <svg
        aria-label="Approved architecture diagram with repository comparison states"
        role="img"
        viewBox={`0 0 ${String(width)} ${String(height)}`}
      >
        <g aria-hidden="true" className="repository-conformance__diagram-edges">
          {architecture.edges.map((edge) => {
            const source = positions.get(edge.semantic.source.nodeId);
            const target = positions.get(edge.semantic.target.nodeId);
            return source === undefined || target === undefined ? null : (
              <line
                key={edge.id}
                x1={source.x}
                x2={target.x}
                y1={source.y}
                y2={target.y}
              />
            );
          })}
        </g>
        {architecture.nodes.map((node) => {
          const position = positions.get(node.id);
          if (position === undefined) return null;
          const label = node.presentation.label;
          const displayedLabel =
            label.length > 26 ? `${label.slice(0, 25)}…` : label;
          return (
            <g
              aria-label={`${label}, ${visualStateLabels[stateFor(node.id)]}`}
              data-conformance-state={stateFor(node.id)}
              key={node.id}
              transform={`translate(${String(position.x - nodeWidth / 2)} ${String(position.y - nodeHeight / 2)})`}
            >
              <title>{`${label} · ${node.semantic.serviceType}`}</title>
              <rect height={nodeHeight} rx="10" width={nodeWidth} />
              <text x="12" y="27">
                {displayedLabel}
              </text>
              <text
                className="repository-conformance__diagram-service"
                x="12"
                y="48"
              >
                {node.semantic.serviceType.slice(0, 30)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        Your saved design, with imported changes marked for review.
      </figcaption>
    </figure>
  );
}

export function RepositoryConformanceView({
  architecture,
  mode,
  onReviewAction,
  result,
  regenerationUnavailableReason,
}: {
  readonly architecture: ArchitectureDocumentV3;
  readonly mode: "guided" | "professional";
  readonly onReviewAction?: (action: RepositoryReviewAction) => void;
  readonly result: RepositoryConformanceDisplayResult;
  readonly regenerationUnavailableReason?: string;
}) {
  const [view, setView] = useState("combined");
  const differences = result.differences.filter(
    ({ kind }) => kind !== "matches",
  );
  const differencesByNode = new Map<
    string,
    RepositoryConformanceDisplayDifference
  >();
  for (const difference of result.differences) {
    if (
      difference.designTargetId !== undefined &&
      !differencesByNode.has(difference.designTargetId)
    )
      differencesByNode.set(difference.designTargetId, difference);
  }
  const matchingNodes = new Set<string>(
    result.observedSolution.resources.flatMap(({ designComparison }) =>
      designComparison.state === "matches-approved-design" &&
      designComparison.target.kind === "architecture-node"
        ? [designComparison.target.nodeId]
        : [],
    ),
  );
  const sourceEvidence = new Map(
    result.observedSolution.evidence.map((item) => [
      item.sourceEvidenceId,
      item,
    ]),
  );
  const designedState = (nodeId: string): ConformanceVisualState => {
    const difference = differencesByNode.get(nodeId);
    if (difference !== undefined) return differenceState(difference);
    return matchingNodes.has(nodeId) ? "matching" : "designed-only";
  };
  const observedState = (
    resource: RepositoryImportResultV1["observedSolution"]["resources"][number],
  ): ConformanceVisualState =>
    resource.certainty.kind !== "deterministic"
      ? "unresolved"
      : resource.designComparison.state === "matches-approved-design"
        ? "matching"
        : resource.designComparison.state === "conflicts-with-approved-design"
          ? "changed"
          : "observed-only";
  const operationByFact = new Map<
    string,
    {
      readonly operationId: string;
      readonly operationKind: ReconciliationOperationV1["kind"];
    }
  >();
  for (const operation of result.proposal?.operations ?? []) {
    const target = operation.target;
    const observedId =
      target.kind === "resource"
        ? target.observedResourceId
        : target.kind === "connection"
          ? target.observedConnectionId
          : target.kind === "generated-file"
            ? target.observedGeneratedFileId
            : undefined;
    if (observedId !== undefined) {
      operationByFact.set(observedId, {
        operationId: operation.operationId,
        operationKind: operation.kind,
      });
    }
  }
  const operationFor = (difference: RepositoryConformanceDisplayDifference) => {
    if (
      difference.operationId !== undefined &&
      difference.operationKind !== undefined
    ) {
      return {
        operationId: difference.operationId,
        operationKind: difference.operationKind,
      };
    }
    for (const factId of difference.observedFactIds) {
      const operation = operationByFact.get(`observed.${factId}`);
      if (operation !== undefined) return operation;
    }
    return undefined;
  };
  const designedPanel = (
    <section className="repository-conformance__panel">
      <h3>Approved design</h3>
      <ApprovedDiagramProjection
        architecture={architecture}
        stateFor={designedState}
      />
      <details>
        <summary>Approved diagram element list</summary>
        <ul>
          {architecture.nodes.map((node) => (
            <li key={node.id} data-conformance-state={designedState(node.id)}>
              <strong>{node.presentation.label}</strong>
              <span>{node.semantic.serviceType}</span>
              <small>Designed · {node.id}</small>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
  const importedPanel = (
    <section className="repository-conformance__panel">
      <h3>Imported observations</h3>
      <ObservedArchitectureDiagram
        key={result.observedSolution.observedSolutionId}
        solution={result.observedSolution}
      />
      <details>
        <summary>Imported resource details</summary>
        <ul>
          {result.observedSolution.resources.map((resource) => {
            const evidence = resource.sourceEvidenceIds
              .map((id) => sourceEvidence.get(id))
              .find((item) => item !== undefined);
            return (
              <li
                key={resource.observedResourceId}
                data-conformance-state={observedState(resource)}
              >
                <strong>{resource.resourceType}</strong>
                <span>
                  {resource.certainty.kind === "deterministic"
                    ? "Confirmed"
                    : "Unresolved"}
                </span>
                <small>
                  Imported · {evidence?.path ?? "source unavailable"}
                </small>
              </li>
            );
          })}
          {result.observedSolution.externalResources.map((resource) => (
            <li key={resource.candidateId} data-conformance-state="external">
              <strong>External resource reference</strong>
              <span>{resource.capability}</span>
              <small>Observed only · ownership unresolved until review</small>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
  return (
    <section
      className="repository-conformance"
      data-assistance-mode={mode}
      aria-label="Repository conformance"
    >
      <header className="repository-conformance__heading">
        <p className="status-label">Repository comparison</p>
        <h2>Designed and imported architecture</h2>
        <p>
          {mode === "guided"
            ? "Compare your saved design with the resources detected in your repository. Review proposed changes before adding them to your design."
            : "Compare the saved design, imported resources, source evidence, and proposed changes."}
        </p>
        <p>Repository code may differ from your running cloud resources.</p>
      </header>
      <section
        aria-label="Repository conformance legend"
        className="repository-conformance__legend"
      >
        <strong>Comparison key</strong>
        <ul>
          {(Object.keys(visualStateLabels) as ConformanceVisualState[]).map(
            (state) => (
              <li key={state} data-conformance-state={state}>
                <span aria-hidden="true" />
                {visualStateLabels[state]}
              </li>
            ),
          )}
        </ul>
        <p>
          Comparison colors show how imported resources relate to your saved
          design.
        </p>
      </section>
      <Tabs
        ariaLabel="Repository architecture views"
        items={[
          { id: "designed", label: "Designed", panel: designedPanel },
          { id: "imported", label: "Imported/observed", panel: importedPanel },
          {
            id: "combined",
            label: "Combined",
            panel: (
              <div className="repository-conformance__combined">
                {designedPanel}
                {importedPanel}
              </div>
            ),
          },
          {
            id: "differences",
            label: `Differences (${String(differences.length)})`,
            panel: (
              <section className="repository-conformance__panel">
                <h3>Reviewable differences</h3>
                {differences.length === 0 ? (
                  <p>Repository facts match the approved design.</p>
                ) : (
                  <ul>
                    {differences.map((difference) => (
                      <DifferenceCard
                        key={difference.differenceId}
                        difference={difference}
                        enabled={onReviewAction !== undefined}
                        regenerationUnavailableReason={
                          regenerationUnavailableReason
                        }
                        {...(onReviewAction === undefined
                          ? {}
                          : { onReviewAction })}
                        {...(operationFor(difference) ?? {})}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ),
          },
        ]}
        onValueChange={setView}
        value={view}
      />
      <details>
        <summary>
          Source evidence and import issues ({String(result.issues.length)})
        </summary>
        <div className="repository-conformance__evidence-grid">
          <section aria-labelledby="repository-source-evidence-title">
            <h3 id="repository-source-evidence-title">Source and evidence</h3>
            <ul>
              {result.observedSolution.evidence.map((evidence) => (
                <li key={evidence.sourceEvidenceId}>
                  <strong>{evidence.path}</strong>
                  <span>
                    Lines {String(evidence.location.startLine)}–
                    {String(evidence.location.endLine)}
                  </span>
                  <small>
                    {evidence.sourceEvidenceId} · {evidence.fileChecksum}
                  </small>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="repository-active-issues-title">
            <h3 id="repository-active-issues-title">
              Active repository issues ({String(result.issues.length)})
            </h3>
            {result.issues.length === 0 ? (
              <p>No unresolved repository conformance issues.</p>
            ) : (
              <ul>
                {result.issues.map((issue) => (
                  <li
                    key={issue.id}
                    data-conformance-state="unresolved"
                    data-severity={issue.severity}
                  >
                    <strong>{issue.summary}</strong>
                    <span>
                      {issue.severity} · {issue.lifecycle.state}
                    </span>
                    <small>{issue.sourceRecordId}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </details>
    </section>
  );
}
