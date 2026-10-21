import { Disclosure } from "@cloudmarkup/ui";
import { IntentRequirementsDetails } from "../generation/IntentRequirementsDetails.js";
import {
  modelBlockingQuestionsRequestV1Schema,
  projectBlockingQuestionsReviewV1,
} from "@cloudmarkup/schemas";

export type BlockingQuestionsReviewInput = Pick<
  Parameters<typeof projectBlockingQuestionsReviewV1>[0],
  "request" | "response"
>;
export function BlockingQuestionsReview({
  input,
  requestedMode,
}: {
  readonly input: BlockingQuestionsReviewInput;
  readonly requestedMode: "guided" | "professional";
}) {
  const request = modelBlockingQuestionsRequestV1Schema.parse(input.request);
  const review = projectBlockingQuestionsReviewV1({ ...input, requestedMode });
  return (
    <section aria-label="Open requirement questions">
      <h3>Open requirement questions</h3>
      <p>{review.explanation}</p>
      <p>{review.semantic.original.summary}</p>
      {review.semantic.questions.length === 0 ? (
        <p>No clarification questions were returned.</p>
      ) : (
        <ol>
          {review.semantic.questions.map((question, index) => (
            <li key={String(question.questionId) + String(index)}>
              <p>{question.question}</p>
              <p>{question.rationale}</p>
              {question.source === null ? (
                <p>This question is not linked to an original requirement.</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {review.semantic.missingBlockingQuestions.length > 0 ? (
        <>
          <h4>Still unresolved</h4>
          <ul>
            {review.semantic.missingBlockingQuestions.map((q) => (
              <li key={q.id}>{q.question}</li>
            ))}
          </ul>
        </>
      ) : null}
      {review.semantic.assumptions.length > 0 ? (
        <>
          <h4>Assumptions to review</h4>
          <ul>
            {review.semantic.assumptions.map((a) => (
              <li key={a.assumptionId}>{a.statement}</li>
            ))}
          </ul>
        </>
      ) : null}
      {review.semantic.unknowns.length > 0 ? (
        <>
          <h4>Other open questions</h4>
          <ul>
            {review.semantic.unknowns.map((q) => (
              <li key={q.unknownId}>{q.question}</li>
            ))}
          </ul>
        </>
      ) : null}
      <Disclosure summary="Original requirements">
        <IntentRequirementsDetails
          intent={request.intentDocument}
          requestedMode={requestedMode}
        />
      </Disclosure>
      <p>No requirement has been answered or accepted.</p>
    </section>
  );
}
