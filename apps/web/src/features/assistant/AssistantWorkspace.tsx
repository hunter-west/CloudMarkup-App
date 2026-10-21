import {
  RepositoryInterpretationReview,
  type RepositoryInterpretationReviewInput,
} from "./RepositoryInterpretationReview.js";
import {
  BlockingQuestionsReview,
  type BlockingQuestionsReviewInput,
} from "./BlockingQuestionsReview.js";
import { Button, Disclosure } from "@cloudmarkup/ui";
import { useState, type ReactNode } from "react";

import { AssistantWorkspaceContext } from "./assistant-workspace-context.js";
import "./assistant-workspace.css";

export interface AssistantWorkspaceOperationViewV1 {
  readonly id: string;
  readonly kind: string;
  readonly paths: readonly string[];
  readonly policyActions: readonly string[];
  readonly primary: string;
  readonly technical: string;
}

export interface AssistantWorkspaceDiffViewV1 {
  readonly category:
    | "architecture"
    | "workload"
    | "contract"
    | "permission-policy"
    | "external-resource"
    | "repository-observation"
    | "file-impact"
    | "validation-coverage"
    | "custom-generation"
    | "clarification";
  readonly evidenceIds: readonly string[];
  readonly ids: readonly string[];
  readonly paths: readonly string[];
  readonly policyActions: readonly string[];
  readonly primary: string;
  readonly validationDeltas: readonly string[];
}

export interface AssistantWorkspaceIssueViewV1 {
  readonly blocking: boolean;
  readonly id: string;
  readonly state: "current" | "resolved" | "stale";
  readonly summary: string;
  readonly technical: string;
}

export interface AssistantWorkspaceProgressViewV1 {
  readonly sequence: number;
  readonly stage: string;
  readonly summary: string;
}

export interface AssistantWorkspaceHostInputV1 {
  readonly blockingQuestions?: BlockingQuestionsReviewInput;
  readonly repositoryInterpretation?: RepositoryInterpretationReviewInput;
  readonly activeIssues: readonly AssistantWorkspaceIssueViewV1[];
  readonly assistancePreference: "guided" | "professional";
  readonly credit: {
    readonly completed: number | null;
    readonly maximumEstimate: number | null;
    readonly minimumEstimate: number | null;
    readonly state: string;
  };
  readonly customGenerationRequests: readonly string[];
  readonly diffs: readonly AssistantWorkspaceDiffViewV1[];
  readonly generatedFileImpact: readonly string[];
  readonly modelProvenance: {
    readonly model: string;
    readonly prompt: string;
    readonly provider: string;
  } | null;
  readonly onAccept?: () => void;
  readonly onCancel?: () => void;
  readonly onEdit?: (instruction: string) => void;
  readonly onReject?: (reason: string) => void;
  readonly operations: readonly AssistantWorkspaceOperationViewV1[];
  readonly progress: readonly AssistantWorkspaceProgressViewV1[];
  readonly repositoryDifferences: readonly string[];
  readonly requirements: readonly string[];
  readonly state:
    | "queued"
    | "running"
    | "review-ready"
    | "needs-user-input"
    | "rejected"
    | "cancelled"
    | "accepted";
  readonly userOwnedFileImpact: readonly string[];
  readonly validationEvidenceIds: readonly string[];
  readonly workflowId: string;
}

export function AssistantWorkspaceProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: AssistantWorkspaceHostInputV1 | undefined;
}) {
  return (
    <AssistantWorkspaceContext.Provider value={value ?? null}>
      {children}
    </AssistantWorkspaceContext.Provider>
  );
}

function ListOrEmpty({
  empty,
  items,
}: {
  readonly empty: string;
  readonly items: readonly string[];
}) {
  return items.length === 0 ? (
    <p>{empty}</p>
  ) : (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function categoryLabel(category: AssistantWorkspaceDiffViewV1["category"]) {
  return category.replaceAll("-", " ");
}

export function AssistantWorkspace({
  value,
}: {
  readonly value: AssistantWorkspaceHostInputV1;
}) {
  const [editInstruction, setEditInstruction] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const blocking = value.activeIssues.some(
    (issue) => issue.blocking && issue.state === "current",
  );
  const canReview = ["review-ready", "needs-user-input"].includes(value.state);
  const canAccept =
    value.state === "review-ready" &&
    !blocking &&
    value.blockingQuestions === undefined &&
    value.repositoryInterpretation === undefined;
  const latestProgress = value.progress.at(-1);

  return (
    <section
      aria-label="Assistant workspace"
      className="assistant-workspace"
      data-assistance-preference={value.assistancePreference}
      data-workflow-id={value.workflowId}
    >
      <header className="assistant-workspace__heading">
        <div>
          <h2>Assistant workspace</h2>
          <p>Review proposed changes. Nothing is applied automatically.</p>
        </div>
        <Disclosure summary="Review safeguards">
          <p>
            Review proposed design and repository decisions here. Nothing is
            applied, deployed, compiled, billed outside the reservation, or
            written to a repository by this workspace.
          </p>
        </Disclosure>
      </header>

      <section
        aria-labelledby="assistant-credit"
        className="assistant-workspace__credit"
      >
        <h3 id="assistant-credit">Credit estimate and use</h3>
        <p>
          {value.credit.minimumEstimate === null ||
          value.credit.maximumEstimate === null
            ? "No credit estimate is available."
            : `${String(value.credit.minimumEstimate)}–${String(value.credit.maximumEstimate)} credits estimated.`}
          {value.credit.completed === null
            ? " No settled use yet."
            : ` ${String(value.credit.completed)} credits used.`}{" "}
          Status: {value.credit.state}.
        </p>
      </section>

      <section aria-labelledby="assistant-requirements">
        <h3 id="assistant-requirements">Requirements</h3>
        <ListOrEmpty
          empty="No requirement summary is available."
          items={value.requirements}
        />
      </section>

      {value.blockingQuestions === undefined ? null : (
        <BlockingQuestionsReview
          input={value.blockingQuestions}
          requestedMode={value.assistancePreference}
        />
      )}

      {value.repositoryInterpretation === undefined ? null : (
        <RepositoryInterpretationReview
          input={value.repositoryInterpretation}
          requestedMode={value.assistancePreference}
        />
      )}

      <section aria-labelledby="assistant-changes">
        <h3 id="assistant-changes">Proposed changes</h3>
        {value.diffs.length === 0 ? (
          <p>No validated changes are ready for review.</p>
        ) : (
          <div className="assistant-diff-list">
            {value.diffs.map((diff, index) => (
              <article key={`${diff.category}-${String(index)}`}>
                <p className="status-label">{categoryLabel(diff.category)}</p>
                <h4>{diff.primary}</h4>
                {diff.validationDeltas.length === 0 ? null : (
                  <p>{diff.validationDeltas.join(" ")}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {value.repositoryDifferences.length === 0 ? null : (
        <section aria-labelledby="assistant-repository-differences">
          <h3 id="assistant-repository-differences">
            Imported repository differences
          </h3>
          <ListOrEmpty
            empty="No imported differences are in this review."
            items={value.repositoryDifferences}
          />
        </section>
      )}

      {value.customGenerationRequests.length === 0 ? null : (
        <section aria-labelledby="assistant-generation-requests">
          <h3 id="assistant-generation-requests">Custom generation requests</h3>
          <ListOrEmpty
            empty="No custom generation request is proposed."
            items={value.customGenerationRequests}
          />
        </section>
      )}

      {value.repositoryDifferences.length === 0 ||
      value.customGenerationRequests.length === 0 ? (
        <Disclosure summary="Additional review context">
          {value.repositoryDifferences.length === 0 ? (
            <p>No imported differences are in this review.</p>
          ) : null}
          {value.customGenerationRequests.length === 0 ? (
            <p>No custom generation request is proposed.</p>
          ) : null}
        </Disclosure>
      ) : null}

      <section aria-labelledby="assistant-file-impact">
        <h3 id="assistant-file-impact">File impact</h3>
        {value.generatedFileImpact.length === 0 &&
        value.userOwnedFileImpact.length === 0 ? (
          <p>No generated or user-owned file impact.</p>
        ) : (
          <>
            <h4>Generated or AI-authored</h4>
            <ListOrEmpty
              empty="No generated file impact."
              items={value.generatedFileImpact}
            />
            <h4>User-owned</h4>
            <ListOrEmpty
              empty="No user-owned file impact."
              items={value.userOwnedFileImpact}
            />
          </>
        )}
      </section>

      <section aria-labelledby="assistant-active-issues" aria-live="polite">
        <h3 id="assistant-active-issues">Active issues</h3>
        {value.activeIssues.length === 0 ? (
          <p>No active issue blocks this review.</p>
        ) : (
          <ul>
            {value.activeIssues.map((issue) => (
              <li key={issue.id}>
                <strong>{issue.summary}</strong>{" "}
                <span>
                  {issue.state === "stale"
                    ? "Stale — retained for evidence."
                    : issue.state === "resolved"
                      ? "Resolved with evidence."
                      : issue.blocking
                        ? "Needs attention before acceptance."
                        : "Review recommended."}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="assistant-progress" aria-live="polite">
        <h3 id="assistant-progress">Job progress</h3>
        {latestProgress === undefined ? (
          <p>No progress update is available.</p>
        ) : (
          <p>
            <strong>{latestProgress.stage.replaceAll("-", " ")}</strong>:{" "}
            {latestProgress.summary}
          </p>
        )}
        {value.progress.length > 1 ? (
          <Disclosure summary="Progress history">
            <ol>
              {value.progress.map((event) => (
                <li key={event.sequence}>
                  <strong>{event.stage.replaceAll("-", " ")}</strong>:{" "}
                  {event.summary}
                </li>
              ))}
            </ol>
          </Disclosure>
        ) : null}
      </section>

      <Disclosure summary="Technical details">
        <h3>Exact operations</h3>
        {value.operations.map((operation) => (
          <article key={operation.id}>
            <h4>{operation.kind}</h4>
            <p>{operation.technical}</p>
            <dl>
              <dt>Operation ID</dt>
              <dd>{operation.id}</dd>
              <dt>Paths</dt>
              <dd>{operation.paths.join(", ") || "None"}</dd>
              <dt>Policy actions</dt>
              <dd>{operation.policyActions.join(", ") || "None"}</dd>
            </dl>
          </article>
        ))}
        <h3>Evidence and validation</h3>
        <p>{value.validationEvidenceIds.join(", ") || "No Evidence IDs."}</p>
        <h3>Model and prompt</h3>
        <p>
          {value.modelProvenance === null
            ? "This review step has no model provenance."
            : `${value.modelProvenance.provider} / ${value.modelProvenance.model}; prompt ${value.modelProvenance.prompt}.`}
        </p>
        <h3>Issue diagnostics</h3>
        <ListOrEmpty
          empty="No issue diagnostics."
          items={value.activeIssues.map(
            (issue) => `${issue.id}: ${issue.technical}`,
          )}
        />
      </Disclosure>

      <section aria-labelledby="assistant-review-actions">
        <h3 id="assistant-review-actions">Accept, reject, or edit</h3>
        <div className="assistant-workspace__review-inputs">
          <Disclosure summary="Request changes">
            <div className="assistant-workspace__field">
              <label htmlFor="assistant-edit-instruction">Edit request</label>
              <textarea
                id="assistant-edit-instruction"
                rows={3}
                onChange={(event) => {
                  setEditInstruction(event.currentTarget.value);
                }}
                value={editInstruction}
              />
              <Button
                disabled={!canReview || editInstruction.trim().length === 0}
                onClick={() => {
                  value.onEdit?.(editInstruction.trim());
                }}
                type="button"
                size="compact"
                variant="secondary"
              >
                Revalidate edit
              </Button>
            </div>
          </Disclosure>
          <Disclosure summary="Add a rejection reason">
            <div className="assistant-workspace__field">
              <label htmlFor="assistant-reject-reason">Rejection reason</label>
              <input
                id="assistant-reject-reason"
                onChange={(event) => {
                  setRejectReason(event.currentTarget.value);
                }}
                value={rejectReason}
              />
            </div>
          </Disclosure>
        </div>
        <div className="assistant-workspace__actions">
          <Button
            disabled={!canReview}
            onClick={() => {
              value.onReject?.(
                rejectReason.trim() || "Reviewer rejected the proposal.",
              );
            }}
            type="button"
            size="compact"
            variant="secondary"
          >
            Reject candidate
          </Button>
          <Button
            disabled={!canAccept}
            onClick={() => {
              value.onAccept?.();
            }}
            type="button"
            size="compact"
            variant="primary"
          >
            Accept candidate
          </Button>
          <Button
            disabled={/^(queued|running)$/u.exec(value.state) === null}
            onClick={() => {
              value.onCancel?.();
            }}
            type="button"
            size="compact"
            variant="quiet"
          >
            Cancel job
          </Button>
        </div>
        {!canAccept && blocking ? (
          <p role="status">Resolve blocking issues before acceptance.</p>
        ) : null}
      </section>
    </section>
  );
}
