import { useState, useRef } from "react";
import { Button, Disclosure } from "@cloudmarkup/ui";
import type { BetaInfrastructureProposal } from "@cloudmarkup/schemas";
import type { ArchitectureDocument } from "@cloudmarkup/domain";
import type { EditorCatalog } from "../editor/model/editor-catalog.js";
import "./ai-workflow.css";

export function AiWorkflowProgress({
  stage,
}: {
  readonly stage: "context" | "generating" | "review" | "complete";
}) {
  const active = ["context", "generating", "review", "complete"].indexOf(stage);
  return (
    <ol className="ai-workflow-steps" aria-label="AI workflow">
      {["Context & request", "Generate & check", "Review & accept"].map(
        (label, i) => (
          <li
            key={label}
            aria-current={i === active ? "step" : undefined}
            data-complete={i < active}
          >
            <span aria-hidden="true">{i + 1}</span>
            {label}
          </li>
        ),
      )}
    </ol>
  );
}

export function AiProposalReview({
  proposal,
  document,
  catalog,
  onApply,
  applyLabel = "Apply reviewed proposal",
  disabled = false,
}: {
  readonly proposal: BetaInfrastructureProposal;
  readonly document: ArchitectureDocument;
  readonly catalog: EditorCatalog;
  readonly onApply: () => void;
  readonly applyLabel?: string;
  readonly disabled?: boolean;
}) {
  const [step, setStep] = useState<"changes" | "checks">("changes");
  const heading = useRef<HTMLHeadingElement>(null);
  const goTo = (next: "changes" | "checks") => {
    setStep(next);
    requestAnimationFrame(() => {
      heading.current?.focus();
    });
  };
  const review = "review" in proposal ? proposal.review : null;
  const updates = "review" in proposal ? proposal.updates : [];
  const hasChanges =
    proposal.resources.length + proposal.connections.length + updates.length >
    0;
  const label = (key: string) =>
    proposal.resources.find((r) => r.key === key)?.label ??
    (proposal.contractVersion !== 1
      ? document.nodes.find(
          (n) =>
            n.id ===
            proposal.existingResources.find((r) => r.key === key)?.nodeId,
        )?.presentation.label
      : undefined) ??
    key;
  return (
    <section className="ai-review" aria-label="Review AI proposal">
      <header>
        <span className="ai-eyebrow">Your review</span>
        <h4 ref={heading} tabIndex={-1}>
          {step === "changes"
            ? hasChanges
              ? "1. Understand the proposed changes"
              : "1. Understand the assessment"
            : "2. Review checks and open decisions"}
        </h4>
      </header>
      <p>{review?.intent ?? proposal.summary}</p>
      {step === "changes" ? (
        <>
          {review ? <p>{proposal.summary}</p> : null}
          {review && review.questions.length > 0 ? (
            <>
              <ReviewList
                title="Questions to resolve"
                items={review.questions}
              />
              <p>Add these details to your request in Assistant to continue.</p>
            </>
          ) : null}
          <ul className="ai-review-resources">
            {proposal.resources.map((resource) => (
              <li key={resource.key}>
                <strong>{resource.label}</strong>
                <span>
                  {catalog.services.find(
                    (s) => s.serviceType === resource.serviceType,
                  )?.displayName ?? resource.serviceType}
                </span>
                {"purpose" in resource && resource.purpose ? (
                  <p>{resource.purpose}</p>
                ) : null}
                {"configuration" in resource && resource.configuration ? (
                  <Disclosure summary="Proposed settings">
                    <dl>
                      {Object.entries(resource.configuration).map(
                        ([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>{formatSetting(value)}</dd>
                          </div>
                        ),
                      )}
                    </dl>
                  </Disclosure>
                ) : null}
              </li>
            ))}
            {updates.map((update) => (
              <li key={update.resourceKey}>
                <strong>Update {label(update.resourceKey)}</strong>
                <p>{update.reason}</p>
                <table>
                  <caption>Configuration changes</caption>
                  <thead>
                    <tr>
                      <th>Setting</th>
                      <th>Current</th>
                      <th>Proposed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(update.configuration).map(
                      ([key, value]) => {
                        const node =
                          proposal.contractVersion !== 1
                            ? document.nodes.find(
                                (n) =>
                                  n.id ===
                                  proposal.existingResources.find(
                                    (r) => r.key === update.resourceKey,
                                  )?.nodeId,
                              )
                            : undefined;
                        const before = Object.entries(
                          node?.semantic.configuration.values ?? {},
                        ).find(([property]) => property === key)?.[1];
                        return (
                          <tr key={key}>
                            <th scope="row">{key}</th>
                            <td>
                              {before && "value" in before
                                ? formatSetting(before.value)
                                : "Not set"}
                            </td>
                            <td>{formatSetting(value)}</td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
          {proposal.connections.length > 0 ? (
            <Disclosure
              summary={
                String(proposal.connections.length) + " proposed connections"
              }
            >
              <ul>
                {proposal.connections.map((c, i) => (
                  <li key={i}>
                    {label(c.sourceKey)} → {label(c.targetKey)}{" "}
                    <span>
                      {catalog.relationships?.find(
                        (relationship) =>
                          relationship.descriptorId === c.ruleId,
                      )?.displayName ?? c.ruleId}
                    </span>
                    <dl>
                      {Object.entries(c.configuration).map(([key, value]) => (
                        <div key={key}>
                          <dt>
                            {catalog.relationships
                              ?.find(
                                (relationship) =>
                                  relationship.descriptorId === c.ruleId,
                              )
                              ?.configuration.fields.find(
                                (field) => field.property === key,
                              )?.label ?? key}
                          </dt>
                          <dd>{formatSetting(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
          <Button
            onClick={() => {
              goTo("checks");
            }}
            variant="primary"
          >
            Review checks and assumptions
          </Button>
        </>
      ) : (
        <>
          <p className="ai-review-evidence">
            Acceptance requires local command and configuration checks. AI
            review notes are advisory; existing issues may still need attention.
          </p>
          {review ? (
            <>
              <ReviewList title="Assumptions" items={review.assumptions} />
              <ReviewList title="AI review notes" items={review.checks} />
              <ReviewList
                title="Questions to resolve"
                items={review.questions}
              />
            </>
          ) : null}
          <ReviewList
            title="Limitations and next steps"
            items={proposal.limitations}
          />
          <div className="form-actions">
            <Button
              onClick={() => {
                goTo("changes");
              }}
            >
              Back to changes
            </Button>
            {hasChanges ? (
              <Button
                variant="primary"
                disabled={disabled || (review?.questions.length ?? 0) > 0}
                onClick={onApply}
              >
                {applyLabel}
              </Button>
            ) : (
              <p>No canvas changes are proposed.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
function ReviewList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly string[];
}) {
  return items.length ? (
    <section>
      <h4>{title}</h4>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  ) : null;
}

function formatSetting(value: unknown): string {
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}
