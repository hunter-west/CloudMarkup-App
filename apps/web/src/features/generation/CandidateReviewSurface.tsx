import { Button } from "@cloudmarkup/ui";
import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

const CANDIDATE_PROGRESS_STAGES = [
  { id: "generate", label: "Generate" },
  { id: "check", label: "Check" },
  { id: "fix", label: "Fix automatically where safe" },
  { id: "review", label: "Review remaining issues" },
  { id: "accept", label: "Accept candidate" },
] as const;

export type CandidateProgressStageId =
  (typeof CANDIDATE_PROGRESS_STAGES)[number]["id"];
export type CandidateProgressState =
  "complete" | "current" | "pending" | "blocked";
export type CandidateRevalidationState =
  "current" | "required" | "checking" | "failed";

export interface CandidateReviewFile {
  readonly content: string;
  readonly contentDigest: string;
  readonly language: string;
  readonly ownership: "generated-candidate" | "user-owned";
  readonly path: string;
  readonly sizeBytes: number;
}

export interface CandidateReviewIssue {
  readonly issueId: string;
  readonly nextAction: string;
  readonly severity: "error" | "warning" | "information";
  readonly state: "active" | "stale" | "resolved";
  readonly summary: string;
}

export interface CandidateReviewAssumption {
  readonly assumptionId: string;
  readonly sourceReferenceIds: readonly string[];
  readonly statement: string;
}

export interface CandidateReviewUnresolvedItem {
  readonly blocking: boolean;
  readonly detail: string;
  readonly question: string;
  readonly sourceReferenceIds: readonly string[];
  readonly unresolvedItemId: string;
}

export interface CandidateReviewExpectedTest {
  readonly description: string;
  readonly expectedTestId: string;
  readonly kind: "unit-test" | "contract-test" | "integration-test";
  readonly sourceReferenceIds: readonly string[];
  readonly targetPaths: readonly string[];
  readonly validationCheckId: string;
}

export interface CandidateEvidenceSummary {
  readonly checkCounts: Readonly<
    Record<"error" | "failed" | "passed" | "skipped", number>
  >;
  readonly environmentType: string;
  readonly evidenceId: string;
  readonly layer: string;
  readonly levelKind: string;
  readonly levelRank: number;
  readonly stalenessState: "current" | "stale";
}

export interface CandidateSchemaReference {
  readonly digest: string;
  readonly schemaId: string;
  readonly version: string;
}

export interface CandidateToolDiagnostic {
  readonly checkId: string;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly toolName: string;
  readonly toolVersion: string;
}

export interface CandidateModelProvenance {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly promptDigest: string;
  readonly promptVersion: string;
  readonly providerId: string;
}

interface CandidateFixReferenceBase {
  readonly description: string;
  readonly exactReference: string;
  readonly status: "available" | "applied" | "proposed" | "rejected";
}

export type CandidateFixReference =
  | (CandidateFixReferenceBase & {
      readonly afterContentHash: string;
      readonly afterVisualHash: string;
      readonly beforeContentHash: string;
      readonly beforeVisualHash: string;
      readonly commandBatchDigest: string;
      readonly kind: "deterministic-operation";
    })
  | (CandidateFixReferenceBase & { readonly kind: "ai-proposal" });

export interface CandidateReviewView {
  readonly acceptanceBlockedReason?: string;
  readonly acceptanceReady: boolean;
  readonly assumptions: readonly CandidateReviewAssumption[];
  readonly candidateId: string;
  readonly evidence: readonly CandidateEvidenceSummary[];
  readonly expectedTests: readonly CandidateReviewExpectedTest[];
  readonly files: readonly CandidateReviewFile[];
  readonly fixes: readonly CandidateFixReference[];
  readonly issues: readonly CandidateReviewIssue[];
  readonly modelProvenance: CandidateModelProvenance;
  readonly progress: Readonly<
    Record<CandidateProgressStageId, CandidateProgressState>
  >;
  readonly revalidationState: CandidateRevalidationState;
  readonly schemaReferences: readonly CandidateSchemaReference[];
  readonly toolDiagnostics: readonly CandidateToolDiagnostic[];
  readonly unresolvedItems: readonly CandidateReviewUnresolvedItem[];
  /** Changes whenever the complete candidate has passed validation again. */
  readonly validatedCandidateDigest: string;
}

export interface CandidateFileEdit {
  readonly candidateId: string;
  readonly content: string;
  readonly originalContentDigest: string;
  readonly path: string;
}

export interface CandidateAcceptance {
  readonly candidateId: string;
  readonly validatedCandidateDigest: string;
}

export interface CandidateReviewSurfaceProps {
  readonly candidate: CandidateReviewView;
  readonly onAccept: (acceptance: CandidateAcceptance) => void;
  readonly onFileChange: (edit: CandidateFileEdit) => void;
}

interface CandidateEditorState {
  readonly baselineKey: string;
  readonly contents: Readonly<Record<string, string>>;
}

const PROGRESS_STATE_LABELS: Readonly<Record<CandidateProgressState, string>> =
  Object.freeze({
    blocked: "Blocked",
    complete: "Complete",
    current: "Current",
    pending: "Pending",
  });

const ISSUE_SEVERITY_LABELS: Readonly<
  Record<CandidateReviewIssue["severity"], string>
> = Object.freeze({
  error: "Error",
  information: "Information",
  warning: "Warning",
});

const ISSUE_STATE_LABELS: Readonly<
  Record<CandidateReviewIssue["state"], string>
> = Object.freeze({
  active: "Active",
  resolved: "Resolved with evidence",
  stale: "Stale — retained for review",
});

const FILE_OWNERSHIP_LABELS: Readonly<
  Record<CandidateReviewFile["ownership"], string>
> = Object.freeze({
  "generated-candidate": "Generated candidate",
  "user-owned": "User-owned file",
});

function createEditorState(
  candidate: CandidateReviewView,
  baselineKey: string,
): CandidateEditorState {
  return {
    baselineKey,
    contents: Object.fromEntries(
      candidate.files.map((file) => [file.path, file.content]),
    ),
  };
}

function revalidationMessage(state: CandidateRevalidationState): string {
  switch (state) {
    case "checking":
      return "Checking the modified candidate.";
    case "current":
      return "Validation evidence is current for this candidate.";
    case "failed":
      return "The latest checks did not pass. Review the remaining issues.";
    case "required":
      return "Changes need revalidation before acceptance.";
  }
}

/**
 * A mode-neutral review surface. The host remains authoritative for validation
 * and acceptance readiness; this component never generates, retries, deploys,
 * or mutates a repository directly.
 */
export function CandidateReviewSurface({
  candidate,
  onAccept,
  onFileChange,
}: CandidateReviewSurfaceProps) {
  const componentId = useId();
  const tabElements = useRef<(HTMLButtonElement | null)[]>([]);
  const baselineKey = `${candidate.candidateId}:${candidate.validatedCandidateDigest}`;
  const [selectedPath, setSelectedPath] = useState<string | null>(
    candidate.files[0]?.path ?? null,
  );
  const [editorState, setEditorState] = useState<CandidateEditorState>(() =>
    createEditorState(candidate, baselineKey),
  );
  const activeEditorState =
    editorState.baselineKey === baselineKey
      ? editorState
      : createEditorState(candidate, baselineKey);
  const activePath = candidate.files.some((file) => file.path === selectedPath)
    ? selectedPath
    : (candidate.files[0]?.path ?? null);
  const selectedFile = candidate.files.find((file) => file.path === activePath);
  const dirtyPaths = candidate.files
    .filter(
      (file) =>
        (activeEditorState.contents[file.path] ?? file.content) !==
        file.content,
    )
    .map((file) => file.path);
  const hasLocalEdits = dirtyPaths.length > 0;
  const hasBlockingUnresolvedItem = candidate.unresolvedItems.some(
    ({ blocking }) => blocking,
  );
  const hasUnresolvedItems = candidate.unresolvedItems.length > 0;
  const canAccept =
    candidate.files.length > 0 &&
    candidate.acceptanceReady &&
    candidate.revalidationState === "current" &&
    !hasLocalEdits &&
    !hasUnresolvedItems;
  const headingId = `${componentId}-heading`;
  const acceptanceStatusId = `${componentId}-acceptance-status`;

  const selectAdjacentTab = (
    currentIndex: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (candidate.files.length === 0) {
      return;
    }
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowLeft":
        nextIndex =
          (currentIndex - 1 + candidate.files.length) % candidate.files.length;
        break;
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % candidate.files.length;
        break;
      case "End":
        nextIndex = candidate.files.length - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
    }

    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    const nextFile = candidate.files[nextIndex];
    if (nextFile === undefined) {
      return;
    }
    setSelectedPath(nextFile.path);
    tabElements.current[nextIndex]?.focus();
  };

  const handleFileChange = (
    file: CandidateReviewFile,
    event: ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const content = event.currentTarget.value;
    setEditorState((current) => {
      const active =
        current.baselineKey === baselineKey
          ? current
          : createEditorState(candidate, baselineKey);
      return {
        ...active,
        contents: {
          ...active.contents,
          [file.path]: content,
        },
      };
    });
    onFileChange({
      candidateId: candidate.candidateId,
      content,
      originalContentDigest: file.contentDigest,
      path: file.path,
    });
  };

  let acceptanceMessage = revalidationMessage(candidate.revalidationState);
  if (candidate.files.length === 0) {
    acceptanceMessage = "No candidate files are available to accept.";
  } else if (hasBlockingUnresolvedItem) {
    acceptanceMessage = "A required behavior decision is still unresolved.";
  } else if (hasUnresolvedItems) {
    acceptanceMessage = "An unresolved behavior question still needs review.";
  } else if (hasLocalEdits) {
    acceptanceMessage = "Changes need revalidation before acceptance.";
  } else if (
    !candidate.acceptanceReady &&
    candidate.acceptanceBlockedReason !== undefined
  ) {
    acceptanceMessage = candidate.acceptanceBlockedReason;
  } else if (
    candidate.revalidationState === "current" &&
    !candidate.acceptanceReady
  ) {
    acceptanceMessage =
      candidate.acceptanceBlockedReason ??
      "The candidate is not ready for acceptance.";
  } else if (canAccept) {
    acceptanceMessage = "The checked candidate is ready for acceptance.";
  }

  return (
    <section aria-labelledby={headingId} className="candidate-review">
      <header>
        <h2 id={headingId}>Review candidate</h2>
        <p>
          Inspect or edit the candidate, review the checks, then accept only the
          validated result.
        </p>
      </header>

      <section aria-labelledby={`${componentId}-progress-heading`}>
        <h3 id={`${componentId}-progress-heading`}>Generation progress</h3>
        <ol aria-label="Candidate generation progress">
          {CANDIDATE_PROGRESS_STAGES.map((stage) => {
            const state = candidate.progress[stage.id];
            return (
              <li data-progress-state={state} key={stage.id}>
                <span>{stage.label}</span>{" "}
                <span>— {PROGRESS_STATE_LABELS[state]}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby={`${componentId}-review-context-heading`}>
        <h3 id={`${componentId}-review-context-heading`}>Review context</h3>

        <h4>Assumptions</h4>
        {candidate.assumptions.length === 0 ? (
          <p>No assumptions were recorded.</p>
        ) : (
          <ul aria-label="Candidate assumptions">
            {candidate.assumptions.map((assumption) => (
              <li key={assumption.assumptionId}>
                <p>{assumption.statement}</p>
                <p>
                  {String(assumption.sourceReferenceIds.length)} grounded source
                  reference(s).
                </p>
              </li>
            ))}
          </ul>
        )}

        <h4>Unresolved questions</h4>
        {candidate.unresolvedItems.length === 0 ? (
          <p>No unresolved behavior questions remain.</p>
        ) : (
          <ul aria-label="Unresolved questions">
            {candidate.unresolvedItems.map((item) => (
              <li data-blocking={item.blocking} key={item.unresolvedItemId}>
                <p>
                  <strong>
                    {item.blocking ? "Blocking question" : "Open question"}
                  </strong>
                </p>
                <p>{item.question}</p>
                <p>{item.detail}</p>
                <p>
                  {String(item.sourceReferenceIds.length)} grounded source
                  reference(s).
                </p>
              </li>
            ))}
          </ul>
        )}

        <h4>Expected tests</h4>
        {candidate.expectedTests.length === 0 ? (
          <p>No expected tests were recorded.</p>
        ) : (
          <ul aria-label="Expected candidate tests">
            {candidate.expectedTests.map((test) => (
              <li key={test.expectedTestId}>
                <p>
                  <strong>{test.description}</strong>
                </p>
                <p>
                  {test.kind.replaceAll("-", " ")} -{" "}
                  {String(test.targetPaths.length)} target path(s) - check{" "}
                  <code>{test.validationCheckId}</code>
                </p>
              </li>
            ))}
          </ul>
        )}

        <h4>Evidence</h4>
        {candidate.evidence.length === 0 ? (
          <p>No validation Evidence was recorded.</p>
        ) : (
          <ul aria-label="Candidate Evidence summaries">
            {candidate.evidence.map((evidence) => {
              const totalChecks =
                evidence.checkCounts.error +
                evidence.checkCounts.failed +
                evidence.checkCounts.passed +
                evidence.checkCounts.skipped;
              return (
                <li key={evidence.evidenceId}>
                  <p>
                    <strong>
                      {evidence.levelKind.replaceAll("-", " ")} (level{" "}
                      {String(evidence.levelRank)})
                    </strong>
                  </p>
                  <p>
                    {String(totalChecks)} checks:{" "}
                    {String(evidence.checkCounts.passed)}
                    {" passed, "}
                    {String(evidence.checkCounts.failed)} failed,{" "}
                    {String(evidence.checkCounts.error)} errors, and{" "}
                    {String(evidence.checkCounts.skipped)} skipped.
                  </p>
                  <p>
                    {evidence.layer} layer - {evidence.environmentType}{" "}
                    environment - Evidence {evidence.stalenessState}.
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${componentId}-files-heading`}>
        <h3 id={`${componentId}-files-heading`}>Candidate files</h3>
        {candidate.files.length === 0 ? (
          <p>No candidate files were returned.</p>
        ) : (
          <>
            <div aria-label="Candidate files" role="tablist">
              {candidate.files.map((file, index) => {
                const selected = file.path === activePath;
                return (
                  <button
                    aria-controls={`${componentId}-file-panel`}
                    aria-selected={selected}
                    id={`${componentId}-file-tab-${String(index)}`}
                    key={file.path}
                    onClick={() => {
                      setSelectedPath(file.path);
                    }}
                    onKeyDown={(event) => {
                      selectAdjacentTab(index, event);
                    }}
                    ref={(element) => {
                      tabElements.current[index] = element;
                    }}
                    role="tab"
                    tabIndex={selected ? 0 : -1}
                    type="button"
                  >
                    {file.path}
                  </button>
                );
              })}
            </div>
            {selectedFile === undefined ? null : (
              <div
                aria-labelledby={`${componentId}-file-tab-${String(
                  candidate.files.indexOf(selectedFile),
                )}`}
                id={`${componentId}-file-panel`}
                role="tabpanel"
              >
                <p>
                  <strong>
                    {FILE_OWNERSHIP_LABELS[selectedFile.ownership]}
                  </strong>
                  {" · "}
                  {selectedFile.language}
                  {dirtyPaths.includes(selectedFile.path)
                    ? " · Edited — revalidation required"
                    : " · Matches validated candidate"}
                </p>
                <textarea
                  aria-label={`Edit candidate file ${selectedFile.path}`}
                  onChange={(event) => {
                    handleFileChange(selectedFile, event);
                  }}
                  spellCheck={false}
                  value={
                    activeEditorState.contents[selectedFile.path] ??
                    selectedFile.content
                  }
                />
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby={`${componentId}-issues-heading`}>
        <h3 id={`${componentId}-issues-heading`}>Issues</h3>
        {candidate.issues.length === 0 ? (
          <p>No remaining issues were reported.</p>
        ) : (
          <ul aria-label="Candidate issues">
            {candidate.issues.map((issue) => (
              <li key={issue.issueId}>
                <p>
                  <strong>{issue.summary}</strong>
                </p>
                <p>{issue.nextAction}</p>
                <p>
                  {ISSUE_SEVERITY_LABELS[issue.severity]} ·{" "}
                  {ISSUE_STATE_LABELS[issue.state]}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details>
        <summary>Technical details</summary>
        <div aria-label="Candidate technical details" role="region">
          <h3>File references</h3>
          <ul>
            {candidate.files.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code> ·{" "}
                {FILE_OWNERSHIP_LABELS[file.ownership]}
                {" · "}
                {String(file.sizeBytes)} bytes · digest{" "}
                <code>{file.contentDigest}</code>
              </li>
            ))}
          </ul>

          <h3>Schema references</h3>
          {candidate.schemaReferences.length === 0 ? (
            <p>No schema references were supplied.</p>
          ) : (
            <ul>
              {candidate.schemaReferences.map((schema) => (
                <li key={`${schema.schemaId}:${schema.version}`}>
                  <code>{schema.schemaId}</code> version {schema.version} ·
                  digest <code>{schema.digest}</code>
                </li>
              ))}
            </ul>
          )}

          <h3>Tool diagnostics</h3>
          {candidate.toolDiagnostics.length === 0 ? (
            <p>No tool diagnostics were supplied.</p>
          ) : (
            <ul>
              {candidate.toolDiagnostics.map((diagnostic) => (
                <li key={`${diagnostic.checkId}:${diagnostic.code}`}>
                  <code>{diagnostic.checkId}</code> /{" "}
                  <code>{diagnostic.code}</code>
                  {" · "}
                  {diagnostic.toolName} {diagnostic.toolVersion}
                  {diagnostic.path === undefined ? null : (
                    <>
                      {" · "}
                      <code>{diagnostic.path}</code>
                    </>
                  )}
                  {" — "}
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          )}

          <h3>Model provenance</h3>
          <dl>
            <div>
              <dt>Provider</dt>
              <dd>
                <code>{candidate.modelProvenance.providerId}</code>
              </dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>
                <code>{candidate.modelProvenance.modelId}</code> version{" "}
                {candidate.modelProvenance.modelVersion}
              </dd>
            </div>
            <div>
              <dt>Prompt</dt>
              <dd>
                Version {candidate.modelProvenance.promptVersion} · digest{" "}
                <code>{candidate.modelProvenance.promptDigest}</code>
              </dd>
            </div>
          </dl>

          <h3>Exact fix references</h3>
          {candidate.fixes.length === 0 ? (
            <p>No fixes were proposed or applied.</p>
          ) : (
            <ul>
              {candidate.fixes.map((fix) => (
                <li key={`${fix.kind}:${fix.exactReference}`}>
                  {fix.description} · {fix.kind} · {fix.status} ·{" "}
                  <code>{fix.exactReference}</code>
                  {fix.kind === "deterministic-operation" ? (
                    <dl>
                      <dt>Command batch digest</dt>
                      <dd>
                        <code>{fix.commandBatchDigest}</code>
                      </dd>
                      <dt>Content hash (before → after)</dt>
                      <dd>
                        <code>{fix.beforeContentHash}</code> →{" "}
                        <code>{fix.afterContentHash}</code>
                      </dd>
                      <dt>Visual hash (before → after)</dt>
                      <dd>
                        <code>{fix.beforeVisualHash}</code> →{" "}
                        <code>{fix.afterVisualHash}</code>
                      </dd>
                    </dl>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <p aria-live="polite" id={acceptanceStatusId} role="status">
        {acceptanceMessage}
      </p>
      <p>
        Acceptance creates a new immutable Solution Revision/export input. It
        does not deploy, plan, apply, or create a change set.
      </p>
      <Button
        aria-describedby={acceptanceStatusId}
        disabled={!canAccept}
        onClick={() => {
          if (canAccept) {
            onAccept({
              candidateId: candidate.candidateId,
              validatedCandidateDigest: candidate.validatedCandidateDigest,
            });
          }
        }}
        variant="primary"
      >
        Accept candidate
      </Button>
    </section>
  );
}
