import { useEffect, useId, useRef } from "react";

import { focusValidationElement } from "../validation/validation-navigation.js";

export interface ConfigurationErrorSummaryIssue {
  readonly key: string;
  readonly label: string;
  readonly message: string;
  readonly fieldId: string | undefined;
}

/** Shared form recovery; callers keep the issue array stable between submits. */
export function ConfigurationErrorSummary({
  issues,
}: {
  readonly issues: readonly ConfigurationErrorSummaryIssue[];
}) {
  const summary = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useEffect(() => {
    if (issues.length === 0) return;
    const focused = issues.some(
      (issue) =>
        issue.fieldId !== undefined &&
        focusValidationElement(document.getElementById(issue.fieldId)),
    );
    if (!focused) focusValidationElement(summary.current);
  }, [issues]);
  if (issues.length === 0) return null;
  return (
    <div
      aria-labelledby={headingId}
      className="selected-inspector__error-summary"
      ref={summary}
      role="alert"
      tabIndex={-1}
    >
      <h4 id={headingId}>
        Review {String(issues.length)} configuration{" "}
        {issues.length === 1 ? "error" : "errors"}
      </h4>
      <ul>
        {issues.map((issue) => (
          <li key={issue.key}>
            {issue.fieldId === undefined ? (
              `${issue.label}: ${issue.message}`
            ) : (
              <a
                href={`#${issue.fieldId}`}
                onClick={(event) => {
                  event.preventDefault();
                  if (
                    !focusValidationElement(
                      document.getElementById(issue.fieldId ?? ""),
                    )
                  ) {
                    focusValidationElement(summary.current);
                  }
                }}
              >
                {issue.label}: {issue.message}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
