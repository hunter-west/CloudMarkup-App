import { graphChangeResourceLabel } from "../model/graph-change-resource-label.js";
import type {
  ArchitectureDocument,
  ValidationAffectedLocation,
  ValidationFinding,
  ValidationSeverity,
} from "@cloudmarkup/domain";
import type { GraphCommandActionV1 } from "@cloudmarkup/schemas";
import {
  Button,
  Dialog,
  Disclosure,
  StatusBadge,
  type StatusTone,
} from "@cloudmarkup/ui";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  LocateFixed,
  RotateCcw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import {
  ActiveIssueSummaryList,
  type ContinuousConformanceActiveIssueSummary,
} from "../conformance/index.js";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { useUsabilityEvents } from "../../../instrumentation/usability-events.js";
import { ModeSwitch } from "../../../preferences/ModeSwitch.js";
import { useModePreference } from "../../../preferences/index.js";
import { useWorkspaceShellController } from "../../../shell/workspace-shell-context.js";
import {
  useEditorDocumentSession,
  useEditorSessionState,
  useEditorSessionStoreApi,
} from "../session/index.js";
import {
  findValidationFinding,
  isEditorValidationSnapshotComplete,
  snapshotFromValidationState,
  type EditorValidationSnapshot,
  type EditorValidationTarget,
} from "./editor-validation.js";
import {
  navigateToValidationFinding,
  validationLocationEdgeId,
  validationLocationNodeId,
} from "./validation-navigation.js";
import {
  groupValidationFindings,
  projectEditorReadiness,
  validationLocationPresentation,
  validationRecoveryInstruction,
  VALIDATION_FILTERS,
  VALIDATION_SEVERITY_PRESENTATION,
  type ValidationFilterId,
} from "./validation-presentation.js";
import type { EditorCatalog } from "../model/editor-catalog.js";
import "./validation.css";

/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Exact command JSON is a keyboard-scrollable review region; focusability is required by the automated accessibility gate. */

function severityTone(severity: ValidationSeverity): StatusTone {
  switch (severity) {
    case "error":
      return "error";
    case "security-error":
      return "security";
    case "cost-warning":
      return "cost";
    case "warning":
      return "warning";
    case "recommendation":
      return "info";
    case "educational-note":
      return "neutral";
  }
}

const NO_REVIEWED_FINDING_IDS: ReadonlySet<string> = new Set();

/** Advisory UI guidance only. Reasons must be reviewed local copy, never remote error prose. */
export interface AiRepairAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

function localAiRepairAvailability(
  finding: ValidationFinding,
  getAvailability:
    ((finding: ValidationFinding) => AiRepairAvailability) | undefined,
): AiRepairAvailability {
  if (getAvailability === undefined) return { available: true };
  try {
    const availability = getAvailability(finding);
    if (availability.available) return { available: true };
    const reason = availability.reason?.trim();
    return reason === undefined || reason.length === 0
      ? { available: false }
      : { available: false, reason };
  } catch {
    return { available: false };
  }
}
const NO_REVIEWED_FINDING_IDS_BY_TARGET: Readonly<
  Record<EditorValidationTarget, ReadonlySet<string>>
> = Object.freeze({
  compilation: NO_REVIEWED_FINDING_IDS,
  draft: NO_REVIEWED_FINDING_IDS,
});

const graphCommandEnvelopeKeys = new Set([
  "schemaVersion",
  "commandId",
  "inverseCommandId",
  "origin",
  "target",
  "kind",
]);

function commandResourceLabel(command: GraphCommandActionV1): string {
  switch (command.kind) {
    case "add-node":
      return `node ${command.node.id}`;
    case "remove-node":
    case "update-node-configuration":
    case "move-node":
    case "reparent-node":
      return `node ${command.nodeId}`;
    case "add-edge":
      return `edge ${command.edge.id}`;
    case "remove-edge":
    case "update-edge-configuration":
      return `edge ${command.edgeId}`;
    case "adopt-generated-resource":
    case "release-generated-resource":
      return command.resource.kind === "node"
        ? `node ${command.resource.nodeId}`
        : `edge ${command.resource.edgeId}`;
    case "replace-catalog-binding":
    case "replace-workload-and-application-contracts":
      return "workload behavior and application contracts";
  }
}

function commandEffect(command: GraphCommandActionV1) {
  return Object.fromEntries(
    Object.entries(command).filter(
      ([property]) => !graphCommandEnvelopeKeys.has(property),
    ),
  );
}

function CommandConsentPreview({
  command,
  index,
}: {
  readonly command: GraphCommandActionV1;
  readonly index: number;
}) {
  return (
    <li>
      <p>
        <strong>
          {String(index + 1)}. {command.kind.replaceAll("-", " ")}
        </strong>{" "}
        — <code>{commandResourceLabel(command)}</code>
      </p>
      <p>
        Exact proposed values and required current-state preconditions are shown
        below. A mismatch rejects the whole batch without changing the draft.
      </p>
      <pre
        aria-label="Exact command effect and preconditions"
        role="region"
        tabIndex={0}
      >
        {JSON.stringify(commandEffect(command), null, 2)}
      </pre>
    </li>
  );
}
function FixPreviewDialog({
  finding,
  onApplied,
  onClose,
  returnFocusRef,
  target,
}: {
  readonly finding: ValidationFinding;
  readonly onApplied: () => void;
  readonly onClose: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly target: EditorValidationTarget;
}) {
  const session = useEditorDocumentSession();
  const { mode } = useModePreference();
  const usabilityEvents = useUsabilityEvents();
  const [error, setError] = useState<string | null>(null);
  const autoFix = finding.autoFix;

  if (autoFix === undefined) {
    return null;
  }

  return (
    <Dialog
      className="validation-fix-dialog"
      description="Review the exact domain-validated atomic command batch. The architecture has not changed."
      footer={
        <div className="validation-fix-dialog__footer">
          <Button onClick={onClose} variant="quiet">
            Cancel
          </Button>
          <Button
            disabled={autoFix.conflictsWithFindingIds.length > 0}
            onClick={() => {
              const result = session.applyValidationFix(
                finding.findingId,
                target,
              );
              if (result.ok) {
                usabilityEvents.record({
                  surface: "issues",
                  target,
                  type: "validation_fix_accepted",
                });
                onApplied();
                onClose();
              } else {
                setError(result.message);
              }
            }}
          >
            <Check aria-hidden="true" size={16} /> Apply safe fix
          </Button>
        </div>
      }
      onClose={onClose}
      open
      returnFocusRef={returnFocusRef}
      title={`Review fix: ${finding.title}`}
    >
      <div className="validation-fix-dialog__mode">
        <StatusBadge
          label={mode === "guided" ? "Guided review" : "Professional review"}
          tone="info"
        />
        <ModeSwitch />
      </div>
      <p>
        This preview is bound to the <strong>{target}</strong> validation
        report.
      </p>
      <p>
        This preview contains {String(autoFix.command.commands.length)}{" "}
        {autoFix.command.commands.length === 1 ? "command" : "commands"} and{" "}
        {String(autoFix.changes.length)} reported changes. Confirmation applies
        the batch atomically and creates one undo entry.
      </p>
      <h3>Exact atomic commands</h3>
      <ol aria-label="Exact validation fix commands">
        {autoFix.command.commands.map((command, index) => (
          <CommandConsentPreview
            command={command}
            index={index}
            key={command.commandId}
          />
        ))}
      </ol>
      <h3>Domain change summary</h3>
      <ul aria-label="Validation fix changes">
        {autoFix.changes.map((change) => (
          <li key={`${change.commandId}:${change.kind}`}>
            <strong>{change.kind.replaceAll("-", " ")}</strong>{" "}
            <code>{graphChangeResourceLabel(change)}</code>
          </li>
        ))}
      </ul>
      <p>
        Resulting content hash: <code>{autoFix.resultingDocumentHash}</code>
      </p>
      <p>
        Resulting visual hash: <code>{autoFix.resultingVisualHash}</code>
      </p>
      {autoFix.conflictsWithFindingIds.length === 0 ? (
        <p>No conflicting validated fixes were reported.</p>
      ) : (
        <p role="alert">
          This fix conflicts with{" "}
          {autoFix.conflictsWithFindingIds.map(String).join(", ")}; automatic
          application is unavailable. Resolve the conflicting findings manually.
        </p>
      )}
      <p>
        {mode === "guided"
          ? "Recommended because the provider rule supplied this complete, preconditioned batch and the domain engine replayed it successfully."
          : "Inspect the complete, preconditioned Graph Command batch and its exact identities before applying it."}
      </p>
      <details>
        <summary>Technical details</summary>
        <pre aria-label="Full Graph Command batch" role="region" tabIndex={0}>
          {JSON.stringify(autoFix.command, null, 2)}
        </pre>
      </details>{" "}
      {error === null ? null : <p role="alert">{error}</p>}
    </Dialog>
  );
}

function ReadinessSummary({
  reviewedFindingIdsByTarget,
  snapshot,
}: {
  readonly reviewedFindingIdsByTarget: Readonly<
    Record<EditorValidationTarget, ReadonlySet<string>>
  >;
  readonly snapshot: EditorValidationSnapshot;
}) {
  const session = useEditorDocumentSession();
  if (session.status !== "ready") {
    return null;
  }
  const readiness = projectEditorReadiness({
    reviewedFindingIds: reviewedFindingIdsByTarget.draft,
    catalog: session.catalog,
    document: session.document,
    snapshot,
  });
  const report = snapshot.draftReport;
  const compilationWarningIds: ReadonlySet<string> = new Set(
    snapshot.compilationReport.findings
      .filter((finding) =>
        ["warning", "cost-warning"].includes(finding.severity),
      )
      .map((finding) => finding.findingId),
  );
  const reviewedCompilationWarningCount = [
    ...reviewedFindingIdsByTarget.compilation,
  ].filter((findingId) => compilationWarningIds.has(findingId)).length;
  const needsAttention =
    !readiness.diagramValid || readiness.draftHasConsequentialFindings;

  return (
    <Disclosure
      aria-label="Project readiness: Local draft review"
      className="validation-readiness"
      summary={
        <span className="validation-readiness__summary">
          <span>
            <span className="status-label">Project readiness</span>
            <strong>Local draft review</strong>
          </span>
          <StatusBadge
            label={needsAttention ? "Needs attention" : "Review details"}
            tone={needsAttention ? "warning" : "success"}
          />
        </span>
      }
    >
      <p>
        This summary is browser-local evidence for the current draft. A valid
        diagram is not a claim that every production context is secure.
      </p>
      <dl>
        <div>
          <dt>Diagram validity</dt>
          <dd>
            <StatusBadge
              label={
                readiness.diagramValid
                  ? "Structurally valid"
                  : "Needs correction"
              }
              tone={readiness.diagramValid ? "success" : "error"}
            />
            {readiness.diagramValid
              ? " No error-severity finding was reported; security findings remain separate."
              : " Review the error-severity findings."}
          </dd>
        </div>
        <div>
          <dt>Draft validation</dt>
          <dd>
            <StatusBadge
              label={
                readiness.draftHasConsequentialFindings
                  ? "Consequential findings present"
                  : "No error or security-error findings"
              }
              tone={
                readiness.draftHasConsequentialFindings ? "warning" : "success"
              }
            />
            Exact severity counts remain unchanged below.
          </dd>
        </div>
        <div>
          <dt>IaC-ready revision</dt>
          <dd>
            <StatusBadge label="Not available" tone="incomplete" /> This local
            draft is not a server-authoritative immutable revision.
          </dd>
        </div>
        <div>
          <dt>Warning acceptance</dt>
          <dd>
            <StatusBadge label="Not available" tone="incomplete" />
            Product-wide acknowledgement and suppression policy is unresolved;
            reviewing a warning locally grants no exception.
          </dd>
        </div>
        <div>
          <dt>Warnings reviewed this session</dt>
          <dd>
            {String(readiness.localReviewedWarningCount)} of{" "}
            {String(readiness.reviewableWarningCount)} draft warnings and{" "}
            {String(reviewedCompilationWarningCount)} of{" "}
            {String(compilationWarningIds.size)} compilation warnings marked
            reviewed in this session. Review state is target-scoped and does not
            suppress, reclassify, persist, or satisfy a future revision gate.
          </dd>
        </div>
      </dl>
      <h4>Target-specific readiness</h4>
      {readiness.targets.length === 0 ? (
        <p>No compiler target mapping is declared for every used resource.</p>
      ) : (
        <ul aria-label="Target-specific readiness">
          {readiness.targets.map((target) => (
            <li key={target.target}>
              <StatusBadge
                label={`${target.label}: ${target.ready ? "Ready" : "Not ready"}`}
                tone={target.ready ? "success" : "incomplete"}
              />{" "}
              {target.reason}
            </li>
          ))}
        </ul>
      )}
      <p className="validation-readiness__binding">
        Report {String(report.reportVersion)} · engine {report.engineVersion} ·
        target {report.target} · environment {report.environment} · content{" "}
        <code>{report.documentHash}</code>
      </p>{" "}
    </Disclosure>
  );
}

function FindingDetail({
  document,
  catalog,
  reviewed,
  current,
  finding,
  learningHidden,
  onReview,
  onLearningHiddenChange,
  onNavigate,
  onOpenRepair,
  onReviewFix,
  onRequestAiFix,
  getAiRepairAvailability,
  snapshot,
  target,
}: {
  readonly document: ArchitectureDocument;
  readonly catalog: EditorCatalog;
  readonly reviewed: boolean;
  readonly current: boolean;
  readonly finding: ValidationFinding;
  readonly learningHidden: boolean;
  readonly onReview: () => void;
  readonly onLearningHiddenChange: (hidden: boolean) => void;
  readonly onNavigate: (location: ValidationAffectedLocation) => void;
  readonly onOpenRepair: () => void;
  readonly onReviewFix: (returnFocusTarget: HTMLButtonElement) => void;
  readonly onRequestAiFix?: ((finding: ValidationFinding) => void) | undefined;
  readonly getAiRepairAvailability?:
    ((finding: ValidationFinding) => AiRepairAvailability) | undefined;
  readonly snapshot: EditorValidationSnapshot;
  readonly target: EditorValidationTarget;
}) {
  const { mode } = useModePreference();
  const aiReasonId = useId();
  const aiAvailability = localAiRepairAvailability(
    finding,
    getAiRepairAvailability,
  );
  const aiReason = !current
    ? "Run current validation before reviewing a fix with AI."
    : aiAvailability.available
      ? undefined
      : (aiAvailability.reason ??
        "AI review is unavailable for this finding. Use the manual review controls.");
  const reviewable = ["warning", "cost-warning"].includes(finding.severity);
  const hasSafeAutoFix = finding.autoFix?.conflictsWithFindingIds.length === 0;
  const recoveryInstruction = validationRecoveryInstruction(
    document,
    catalog,
    finding,
  );
  const affectedLabels = [
    ...new Set(
      finding.affected.map(
        (location) =>
          validationLocationPresentation(document, catalog, location).label,
      ),
    ),
  ];
  const manualFixExplanation =
    finding.autoFix === undefined
      ? reviewable
        ? `${recoveryInstruction} Marking reviewed records only this browser session; it does not clear the finding or establish readiness.`
        : recoveryInstruction
      : "The proposed batch conflicts with one or more other reviewed changes. Review the conflicting findings before choosing a change.";
  const evaluatedTargetEvidence = [
    snapshot.draftReport,
    snapshot.compilationReport,
  ].map((report) => {
    const executedContributingRules = finding.rules.filter((rule) =>
      report.executedRules.some(
        (executed) =>
          executed.ruleId === rule.ruleId &&
          executed.ruleVersion === rule.ruleVersion,
      ),
    );
    const emitted = report.findings.some(
      (candidate) => candidate.findingId === finding.findingId,
    );
    const ruleEvidence = executedContributingRules
      .map((rule) => `${rule.ruleId}@${rule.ruleVersion}`)
      .join(", ");
    const allContributingRulesSkipped =
      finding.rules.length > 0 &&
      finding.rules.every((rule) =>
        report.skippedRuleIds.includes(rule.ruleId),
      );
    const statement =
      report.evaluationStatus === "incomplete"
        ? `Not established by this incomplete evaluation; finding ${emitted ? "emitted" : "not emitted"}.`
        : executedContributingRules.length > 0
          ? `Applicable: ${ruleEvidence} executed; finding ${emitted ? "emitted" : "not emitted"}.`
          : allContributingRulesSkipped
            ? `Not applicable in this complete local evaluation: all contributing rule IDs were skipped; finding ${emitted ? "emitted" : "not emitted"}.`
            : `Not evaluated in this report; applicability is not established; finding ${emitted ? "emitted" : "not emitted"}.`;
    return {
      statement,
      target: report.target,
    };
  });

  return (
    <article
      aria-labelledby="validation-finding-detail-title"
      className="validation-finding-detail"
    >
      <header>
        <StatusBadge
          label={VALIDATION_SEVERITY_PRESENTATION[finding.severity].label}
          tone={severityTone(finding.severity)}
        />
        <StatusBadge label={`${target} finding`} tone="neutral" />
        <h3 id="validation-finding-detail-title">{finding.title}</h3>
      </header>
      <p className="validation-finding-detail__location">
        <strong>Affected:</strong> {affectedLabels.join("; ")}
      </p>
      <section>
        <h4>What happened</h4>
        <p>{finding.beginnerExplanation}</p>
      </section>
      <section>
        <h4>How to fix it</h4>
        {!hasSafeAutoFix ? (
          <>
            <p>{manualFixExplanation}</p>
          </>
        ) : (
          <p>
            {mode === "guided"
              ? "Recommended next action: review the validated safe fix, then confirm its complete atomic batch."
              : "Review the validated safe fix and inspect its exact atomic command batch before confirming it."}
          </p>
        )}
      </section>
      <details>
        <summary>Technical details</summary>
        <section>
          <h4>Why it matters</h4>
          <p>{finding.technicalExplanation}</p>
        </section>
        {!hasSafeAutoFix && finding.autoFix !== undefined ? (
          <p>
            Conflicting finding IDs:{" "}
            <code>
              {finding.autoFix.conflictsWithFindingIds.map(String).join(", ")}
            </code>
          </p>
        ) : null}
        <dl className="validation-finding-detail__technical">
          <div>
            <dt>Target applicability (evaluated locally)</dt>
            <dd>
              <ul aria-label="Finding target applicability">
                {evaluatedTargetEvidence.map((evidence) => (
                  <li key={evidence.target}>
                    <strong>{evidence.target}</strong> — {evidence.statement}
                  </li>
                ))}
                <li>
                  <strong>revision</strong> — Not evaluated locally;
                  applicability is not established.
                </li>
              </ul>
              Environment <code>{snapshot.draftReport.environment}</code>.
            </dd>
          </div>
          <div>
            <dt>Finding ID</dt>
            <dd>
              <code>{finding.findingId}</code>
            </dd>
          </div>
          <div>
            <dt>Code</dt>
            <dd>
              <code>{finding.code}</code>
            </dd>
          </div>
          <div>
            <dt>Rule IDs</dt>
            <dd>
              <ul
                aria-label="Contributing validation rule IDs"
                className="validation-finding-detail__values"
              >
                {finding.rules.map((rule) => (
                  <li key={`${rule.ruleId}:${rule.ruleVersion}`}>
                    <code>
                      {rule.ruleId}@{rule.ruleVersion}
                    </code>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt>Affected paths</dt>
            <dd>
              <ul
                aria-label="Affected document paths"
                className="validation-finding-detail__values"
              >
                {finding.affected.map((location) => (
                  <li key={location.path}>
                    <code>{location.path}</code>
                    <code>
                      {JSON.stringify(location, (key, value: unknown) =>
                        key === "path" ? undefined : value,
                      )}
                    </code>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </details>{" "}
      <div className="validation-finding-detail__actions">
        {onRequestAiFix ? (
          <div className="validation-finding-detail__ai-action">
            <Button
              aria-describedby={aiReason === undefined ? undefined : aiReasonId}
              disabled={!current || !aiAvailability.available}
              onClick={() => {
                if (current && aiAvailability.available)
                  onRequestAiFix(finding);
              }}
            >
              Review a fix with AI
            </Button>
            {aiReason === undefined ? null : <p id={aiReasonId}>{aiReason}</p>}
          </div>
        ) : null}
        {finding.code ===
        "aws.validation.subnet-route-table-association-invalid" ? (
          <Button onClick={onOpenRepair} variant="primary">
            {finding.affected.some((location) => location.kind === "node")
              ? "Find route table association"
              : "Open association controls"}
          </Button>
        ) : finding.code === "aws.validation.lambda-trigger-binding-missing" ? (
          <Button onClick={onOpenRepair} variant="primary">
            Open connection controls
          </Button>
        ) : finding.code === "aws.validation.iam-resource-missing" ? (
          <Button onClick={onOpenRepair} variant="primary">
            Review permission source
          </Button>
        ) : null}
        {(finding.code === "aws.validation.region-availability-unknown"
          ? []
          : finding.affected
        ).map((location, index) => (
          <Button
            key={location.path}
            onClick={() => {
              onNavigate(location);
            }}
            variant="secondary"
          >
            <LocateFixed aria-hidden="true" size={16} />{" "}
            {
              validationLocationPresentation(document, catalog, location)
                .actionLabel
            }
            {finding.affected.length > 1 ? ` ${String(index + 1)}` : ""}
          </Button>
        ))}
        {!hasSafeAutoFix ? (
          <StatusBadge
            label={
              finding.autoFix === undefined && reviewable
                ? "No automatic fix"
                : "Manual action required"
            }
            tone="incomplete"
          />
        ) : (
          <Button
            disabled={!current}
            onClick={(event) => {
              onReviewFix(event.currentTarget);
            }}
          >
            <Wrench aria-hidden="true" size={16} /> Review safe fix
          </Button>
        )}
        {reviewable ? (
          <Button
            aria-pressed={reviewed}
            disabled={!current}
            onClick={onReview}
            variant="quiet"
          >
            <Check aria-hidden="true" size={16} />{" "}
            {reviewed ? "Reviewed this session" : "Mark reviewed this session"}
          </Button>
        ) : null}
      </div>
      {finding.documentationReferences.length === 0 ? null : (
        <section className="validation-learning">
          <div>
            <h4>Learn more</h4>
            <Button
              onClick={() => {
                onLearningHiddenChange(!learningHidden);
              }}
              size="compact"
              variant="quiet"
            >
              {learningHidden ? "Show learning links" : "Hide learning links"}
            </Button>
          </div>
          {learningHidden ? null : (
            <ul>
              {finding.documentationReferences.map((reference) => (
                <li key={reference.id}>
                  {reference.kind === "external" ? (
                    <a href={reference.url} rel="noreferrer" target="_blank">
                      {reference.title} ({reference.publisher})
                    </a>
                  ) : (
                    <>
                      {reference.title}: <code>{reference.path}</code>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </article>
  );
}

export function IssuesPanel({
  activeIssues = [],
  onRequestAiFix,
  getAiRepairAvailability,
}: {
  readonly activeIssues?: readonly ContinuousConformanceActiveIssueSummary[];
  readonly onRequestAiFix?: ((finding: ValidationFinding) => void) | undefined;
  readonly getAiRepairAvailability?:
    ((finding: ValidationFinding) => AiRepairAvailability) | undefined;
} = {}) {
  const session = useEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const shell = useWorkspaceShellController();
  const [enabledFilters, setEnabledFilters] = useState<
    ReadonlySet<ValidationFilterId>
  >(() => new Set(VALIDATION_FILTERS.map((filter) => filter.id)));
  const [selectedTarget, setSelectedTarget] = useState<EditorValidationTarget>(
    () => {
      const initialFocus = store.getState().validationFocus;
      return initialFocus === null ? "draft" : initialFocus.target;
    },
  );
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(
    null,
  );
  const [selectedNavigationKey, setSelectedNavigationKey] = useState<
    string | null
  >(null);

  const [learningHidden, setLearningHidden] = useState(false);
  const [fixSelection, setFixSelection] = useState<{
    readonly findingId: string;
    readonly target: EditorValidationTarget;
  } | null>(null);
  const issuesReference = useRef<HTMLElement>(null);
  const fixReturnFocusReference = useRef<HTMLElement>(null);
  const navigationReference = useRef<HTMLDivElement>(null);
  const validationReview = useEditorSessionState(
    (state) => state.validationReview,
  );
  const validationFocus = useEditorSessionState(
    (state) => state.validationFocus,
  );
  const validation = session.validation;
  const snapshot = snapshotFromValidationState(validation);
  const reviewedFindingIdsByTarget =
    validationReview !== null &&
    validationReview.documentHash === snapshot?.hashes.contentHash
      ? validationReview.findingIdsByTarget
      : NO_REVIEWED_FINDING_IDS_BY_TARGET;
  const reviewedFindingIds = reviewedFindingIdsByTarget[selectedTarget];
  const current =
    validation.status === "current" &&
    session.status === "ready" &&
    snapshot !== null &&
    snapshot.hashes.contentHash === session.hashes.contentHash &&
    snapshot.hashes.visualHash === session.hashes.visualHash;
  const completeCurrent =
    current && isEditorValidationSnapshotComplete(snapshot);
  const incompleteReports =
    snapshot === null
      ? []
      : [snapshot.draftReport, snapshot.compilationReport].filter(
          (report) => report.evaluationStatus === "incomplete",
        );
  const activeReport =
    snapshot === null
      ? null
      : selectedTarget === "draft"
        ? snapshot.draftReport
        : snapshot.compilationReport;

  const groups =
    activeReport === null || session.status !== "ready"
      ? []
      : groupValidationFindings(activeReport, session.document, enabledFilters);
  const visibleFindings = [
    ...new Map(
      groups
        .flatMap((group) =>
          group.resources.flatMap((resource) => resource.findings),
        )
        .map((finding) => [finding.findingId, finding] as const),
    ).values(),
  ];
  const navigationEntries = groups.flatMap((group) =>
    group.resources.flatMap((resource) =>
      resource.findings.map((finding) => ({
        findingId: finding.findingId,
        key: `${group.severity}:${resource.id}:${finding.findingId}`,
      })),
    ),
  );
  const selectedFinding =
    (selectedFindingId === null
      ? validationFocus?.target !== selectedTarget
        ? undefined
        : visibleFindings.find(
            (finding) => finding.findingId === validationFocus.findingId,
          )
      : visibleFindings.find(
          (finding) => finding.findingId === selectedFindingId,
        )) ?? visibleFindings[0];
  const activeNavigationKey =
    selectedNavigationKey !== null &&
    navigationEntries.some(
      (entry) =>
        entry.key === selectedNavigationKey &&
        entry.findingId === selectedFinding?.findingId,
    )
      ? selectedNavigationKey
      : (navigationEntries.find(
          (entry) => entry.findingId === selectedFinding?.findingId,
        )?.key ?? null);
  const fixFinding =
    fixSelection === null || snapshot === null
      ? undefined
      : findValidationFinding(
          snapshot,
          fixSelection.findingId,
          fixSelection.target,
        );

  function moveFindingFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    direction: -1 | 1,
  ): void {
    event.preventDefault();
    const items = [
      ...(navigationReference.current?.querySelectorAll<HTMLButtonElement>(
        "[data-validation-finding-navigation]",
      ) ?? []),
    ];
    const currentIndex = items.indexOf(event.currentTarget);
    const nextIndex = Math.max(
      0,
      Math.min(items.length - 1, currentIndex + direction),
    );
    items[nextIndex]?.focus();
  }

  if (session.status !== "ready" || validation.status === "unavailable") {
    return (
      <section className="workspace-empty" aria-live="polite">
        <p className="status-label">Issues</p>
        <h2>Validation unavailable</h2>
        <p>
          {validation.status === "unavailable"
            ? validation.message
            : "A valid Architecture Document is required."}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="validation-issues-title"
      className="validation-issues"
      data-validation-current={current ? "true" : "false"}
      id="validation-issues-panel"
      data-validation-target={selectedTarget}
      ref={issuesReference}
      tabIndex={-1}
    >
      <header className="validation-issues__header">
        <div>
          <p className="status-label">Review your design</p>
          <h2 id="validation-issues-title">Issues</h2>
        </div>
        <StatusBadge
          label={
            validation.status === "scheduled"
              ? "Validation scheduled"
              : validation.status === "running"
                ? "Validation running"
                : validation.status === "failed"
                  ? "Validation failed"
                  : !current
                    ? "Validation stale"
                    : completeCurrent
                      ? "Current and complete"
                      : "Validation incomplete"
          }
          tone={
            validation.status === "failed"
              ? "error"
              : !current
                ? "incomplete"
                : completeCurrent
                  ? "success"
                  : "error"
          }
        />
        <Button
          onClick={() => {
            session.requestValidation();
          }}
          size="compact"
        >
          <RotateCcw aria-hidden="true" size={15} /> Run validation
        </Button>
      </header>
      {activeIssues.length > 0 ? (
        <Disclosure summary="Repository and export checks">
          <ActiveIssueSummaryList issues={activeIssues} />
        </Disclosure>
      ) : null}
      {snapshot === null ? null : (
        <>
          <div className="validation-issues__controls">
            <label className="validation-target-selector">
              <span className="visually-hidden">Validation target</span>
              <select
                aria-label="Validation target"
                onChange={(event) => {
                  const nextTarget =
                    event.currentTarget.value === "compilation"
                      ? "compilation"
                      : "draft";
                  setSelectedTarget(nextTarget);
                  setSelectedFindingId(null);
                  setSelectedNavigationKey(null);
                  setFixSelection(null);
                  setLearningHidden(false);
                  store.getState().setValidationFocus(null);
                  store
                    .getState()
                    .announce(`Showing ${nextTarget} validation findings.`);
                }}
                value={selectedTarget}
              >
                <option value="draft">
                  Draft findings ({String(snapshot.draftReport.findings.length)}
                  )
                </option>
                <option value="compilation">
                  Compilation findings (
                  {String(snapshot.compilationReport.findings.length)})
                </option>
              </select>
            </label>
            <fieldset className="validation-filters">
              <legend className="visually-hidden">
                Filter finding categories
              </legend>
              {VALIDATION_FILTERS.map((filter) => (
                <label key={filter.id}>
                  <input
                    checked={enabledFilters.has(filter.id)}
                    onChange={(event) => {
                      const next = new Set(enabledFilters);
                      if (event.target.checked) {
                        next.add(filter.id);
                      } else {
                        next.delete(filter.id);
                      }
                      const selectedStillVisible =
                        selectedFinding === undefined ||
                        VALIDATION_FILTERS.some(
                          (candidate) =>
                            next.has(candidate.id) &&
                            candidate.severities.some(
                              (severity) =>
                                severity === selectedFinding.severity,
                            ),
                        );
                      if (!selectedStillVisible) {
                        setSelectedFindingId(null);
                        setSelectedNavigationKey(null);
                      }
                      const focusedFinding =
                        validationFocus?.target !== selectedTarget
                          ? undefined
                          : activeReport?.findings.find(
                              (finding) =>
                                finding.findingId === validationFocus.findingId,
                            );
                      const focusedFindingStillVisible =
                        validationFocus === null ||
                        (focusedFinding !== undefined &&
                          VALIDATION_FILTERS.some(
                            (candidate) =>
                              next.has(candidate.id) &&
                              candidate.severities.some(
                                (severity) =>
                                  severity === focusedFinding.severity,
                              ),
                          ));
                      if (!focusedFindingStillVisible) {
                        store.getState().setValidationFocus(null);
                      }
                      setEnabledFilters(next);
                    }}
                    type="checkbox"
                  />
                  {filter.label}
                </label>
              ))}
            </fieldset>
          </div>
          <p className="validation-target-description">
            {selectedTarget === "draft"
              ? "Design checks identify missing configuration, unsafe connections, and recommendations."
              : "Export checks identify issues that can prevent code generation."}
          </p>
        </>
      )}
      {validation.status === "failed" ? (
        <p role="alert">{validation.message}</p>
      ) : current ? null : snapshot === null ? (
        <p role="status">
          Validation is scheduled or running. No previous report is available,
          and zero visible findings is not a clean result.
        </p>
      ) : (
        <p role="status">
          The displayed previous report is stale and cannot establish readiness
          or apply a fix.
        </p>
      )}
      {snapshot === null ? null : (
        <>
          <div className="validation-issues__layout">
            <nav
              aria-label="Validation findings"
              className="validation-findings-tree"
              ref={navigationReference}
            >
              {groups.length === 0 ? (
                <p>
                  {activeReport?.findings.length === 0
                    ? completeCurrent
                      ? `No findings in the complete current ${selectedTarget} report.`
                      : `No findings are visible in this stale or incomplete ${selectedTarget} report; readiness is unavailable.`
                    : `No ${selectedTarget} findings match these filters.`}
                </p>
              ) : (
                <ul>
                  {groups.map((group) => (
                    <li key={group.severity}>
                      <h3>
                        <StatusBadge
                          label={`${group.label} (${String(
                            new Set(
                              group.resources.flatMap((resource) =>
                                resource.findings.map(
                                  (finding) => finding.findingId,
                                ),
                              ),
                            ).size,
                          )})`}
                          tone={severityTone(group.severity)}
                        />
                      </h3>
                      <ul>
                        {group.resources.map((resource) => (
                          <li key={resource.id}>
                            <h4>{resource.label}</h4>
                            <ul>
                              {resource.findings.map((finding) => (
                                <li key={finding.findingId}>
                                  <button
                                    aria-current={
                                      `${group.severity}:${resource.id}:${finding.findingId}` ===
                                      activeNavigationKey
                                        ? "true"
                                        : undefined
                                    }
                                    data-validation-finding-id={
                                      finding.findingId
                                    }
                                    data-validation-finding-navigation=""
                                    data-validation-severity={finding.severity}
                                    onClick={() => {
                                      if (
                                        validationFocus?.findingId !==
                                          finding.findingId ||
                                        validationFocus.target !==
                                          selectedTarget
                                      ) {
                                        store
                                          .getState()
                                          .setValidationFocus(null);
                                      }
                                      setSelectedFindingId(finding.findingId);
                                      setSelectedNavigationKey(
                                        `${group.severity}:${resource.id}:${finding.findingId}`,
                                      );
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "ArrowDown") {
                                        moveFindingFocus(event, 1);
                                      } else if (event.key === "ArrowUp") {
                                        moveFindingFocus(event, -1);
                                      } else if (event.key === "Enter") {
                                        if (
                                          validationFocus?.findingId !==
                                            finding.findingId ||
                                          validationFocus.target !==
                                            selectedTarget
                                        ) {
                                          store
                                            .getState()
                                            .setValidationFocus(null);
                                        }
                                        setSelectedFindingId(finding.findingId);
                                        setSelectedNavigationKey(
                                          `${group.severity}:${resource.id}:${finding.findingId}`,
                                        );
                                      }
                                    }}
                                    type="button"
                                  >
                                    <ChevronRight
                                      aria-hidden="true"
                                      size={14}
                                    />
                                    <span>{finding.title}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </nav>
            {selectedFinding === undefined ? (
              <div className="validation-finding-detail">
                {completeCurrent ? (
                  <>
                    <Check aria-hidden="true" size={20} />
                    <h3>No matching findings</h3>
                    <p>
                      The current report is complete for this local draft and
                      selected filters. This is not universal security or
                      deployment evidence.
                    </p>
                  </>
                ) : (
                  <>
                    <AlertTriangle aria-hidden="true" size={20} />
                    <h3>Readiness unavailable</h3>
                    <p>
                      This report is stale or incomplete. Run current, complete
                      validation before relying on its result.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <FindingDetail
                document={session.document}
                catalog={session.catalog}
                reviewed={reviewedFindingIds.has(selectedFinding.findingId)}
                current={completeCurrent}
                finding={selectedFinding}
                onRequestAiFix={onRequestAiFix}
                getAiRepairAvailability={getAiRepairAvailability}
                learningHidden={learningHidden}
                onReview={() => {
                  store
                    .getState()
                    .setValidationFindingReviewed(
                      snapshot.hashes.contentHash,
                      selectedTarget,
                      selectedFinding.findingId,
                      !reviewedFindingIds.has(selectedFinding.findingId),
                    );
                }}
                onLearningHiddenChange={setLearningHidden}
                onNavigate={(location) => {
                  navigateToValidationFinding({
                    finding: selectedFinding,
                    location,
                    shell,
                    store,
                    target: selectedTarget,
                  });
                }}
                onOpenRepair={() => {
                  const code = selectedFinding.code;
                  const location = selectedFinding.affected.find(
                    (item) =>
                      item.kind === "node" ||
                      item.kind === "edge" ||
                      item.kind === "configuration" ||
                      item.kind === "port",
                  );
                  if (location === undefined) return;
                  const nodeId = validationLocationNodeId(location);
                  const edgeId = validationLocationEdgeId(location);
                  if (
                    code === "aws.validation.iam-resource-missing" &&
                    nodeId !== null
                  ) {
                    const node = session.document.nodes.find(
                      (item) => item.id === nodeId,
                    );
                    if (node?.semantic.lifecycle.ownership === "generated") {
                      const sourceEdgeId =
                        node.semantic.lifecycle.provenance.dependentEdgeIds.find(
                          (id) =>
                            session.document.edges.some(
                              (edge) => edge.id === id,
                            ),
                        );
                      if (sourceEdgeId !== undefined) {
                        store
                          .getState()
                          .setSelection({ id: sourceEdgeId, kind: "edge" });
                        shell?.openContextPanel(
                          "selected-resource-inspector",
                          "connect",
                        );
                        return;
                      }
                    }
                  }
                  if (nodeId !== null)
                    store.getState().setSelection({ id: nodeId, kind: "node" });
                  else if (edgeId !== null)
                    store.getState().setSelection({ id: edgeId, kind: "edge" });
                  if (
                    code ===
                      "aws.validation.subnet-route-table-association-invalid" &&
                    location.kind === "node"
                  ) {
                    store
                      .getState()
                      .setCatalogSearchQuery("route table association");
                    shell?.openCatalogPanel();
                  } else {
                    shell?.openContextPanel(
                      "selected-resource-inspector",
                      code ===
                        "aws.validation.lambda-trigger-binding-missing" ||
                        code ===
                          "aws.validation.subnet-route-table-association-invalid"
                        ? "connect"
                        : "configure",
                    );
                  }
                }}
                onReviewFix={(returnFocusTarget) => {
                  fixReturnFocusReference.current = returnFocusTarget;
                  setFixSelection({
                    findingId: selectedFinding.findingId,
                    target: selectedTarget,
                  });
                }}
                snapshot={snapshot}
                target={selectedTarget}
              />
            )}
          </div>
          {completeCurrent ? (
            <ReadinessSummary
              reviewedFindingIdsByTarget={reviewedFindingIdsByTarget}
              snapshot={snapshot}
            />
          ) : (
            <section className="validation-readiness" role="status">
              <h3>Readiness unavailable</h3>
              <p>
                Only complete draft and compilation reports bound to the current
                document can establish local readiness. Findings from the
                selected target remain review evidence only.
              </p>
            </section>
          )}
          {incompleteReports.length > 0 ? (
            <details className="validation-diagnostics">
              <summary>
                <ShieldAlert aria-hidden="true" size={15} /> Validation engine
                diagnostics
              </summary>
              <ul>
                {incompleteReports.flatMap((report) =>
                  report.diagnostics.map((diagnostic) => (
                    <li
                      key={`${report.target}:${diagnostic.code}:${diagnostic.path}`}
                    >
                      <strong>{report.target}</strong> {" — "}
                      <code>{diagnostic.code}</code> {diagnostic.message}{" "}
                      <code>{diagnostic.path}</code>
                    </li>
                  )),
                )}
              </ul>
            </details>
          ) : null}
        </>
      )}
      {!completeCurrent ||
      fixSelection === null ||
      fixFinding?.autoFix === undefined ||
      fixFinding.autoFix.conflictsWithFindingIds.length > 0 ? null : (
        <FixPreviewDialog
          finding={fixFinding}
          onApplied={() => {
            fixReturnFocusReference.current = issuesReference.current;
          }}
          onClose={() => {
            setFixSelection(null);
          }}
          returnFocusRef={fixReturnFocusReference}
          target={fixSelection.target}
        />
      )}
    </section>
  );
}
