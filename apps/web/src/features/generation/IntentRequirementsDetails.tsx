import {
  projectIntentReviewV1,
  type IntentDocumentV1,
  type ModelRequestedModeV1,
} from "@cloudmarkup/schemas";
import { useContext, type ReactNode } from "react";
import { ModePreferenceContext } from "../../preferences/mode-preference-context.js";

const internalKeys = new Set([
  "id",
  "questionId",
  "subject",
  "selectedAlternativeId",
  "supersedesDecisionId",
  "decidedBy",
  "decidedAt",
]);
const label = (key: string) =>
  key.replaceAll(/([a-z])([A-Z])/gu, "$1 $2").replaceAll("-", " ");
function RequirementValue({ value }: { readonly value: unknown }): ReactNode {
  if (value === null || value === undefined) return "Not specified";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value))
    return value.length === 0 ? (
      "None listed"
    ) : (
      <ul>
        {(value as readonly unknown[]).map((item, index) => (
          <li key={index}>
            <RequirementValue value={item} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <dl>
        {Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !internalKeys.has(key))
          .map(([key, item]) => (
            <div key={key}>
              <dt>{label(key)}</dt>
              <dd>
                <RequirementValue value={item} />
              </dd>
            </div>
          ))}
      </dl>
    );
  return "Not specified";
}

/** Readable domain requirements, without serialization or model provenance fields. */
export function IntentRequirementsDetails({
  intent,
  requestedMode,
}: {
  readonly intent: IntentDocumentV1;
  readonly requestedMode?: ModelRequestedModeV1;
}) {
  const preference = useContext(ModePreferenceContext)?.mode ?? "guided";
  const review = projectIntentReviewV1({
    intentDocument: intent,
    requestedMode: requestedMode ?? preference,
  });
  return (
    <div className="intent-requirements-details">
      <p>{review.explanation}</p>
      <p>{review.semantic.summary}</p>
      <h3>Assumptions</h3>
      {review.semantic.assumptions.length === 0 ? (
        <p>No assumptions listed.</p>
      ) : (
        <ul>
          {review.semantic.assumptions.map((item) => (
            <li key={item.id}>
              {item.statement} ({item.status})
            </li>
          ))}
        </ul>
      )}
      <h3>Open questions</h3>
      {review.semantic.questions.length === 0 ? (
        <p>No open questions listed.</p>
      ) : (
        <ul>
          {review.semantic.questions.map((item) => (
            <li key={item.id}>
              {item.question} ({item.classification})
            </li>
          ))}
        </ul>
      )}
      {review.semantic.sections.map(([title, value]) => (
        <details key={title}>
          <summary>{title}</summary>
          <RequirementValue value={value} />
        </details>
      ))}
    </div>
  );
}
