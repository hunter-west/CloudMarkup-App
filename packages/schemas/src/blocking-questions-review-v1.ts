import {
  modelBlockingQuestionsRequestV1Schema,
  modelBlockingQuestionsResponseV1Schema,
  modelRequestedModeV1Schema,
} from "./model-gateway-v1.js";
import { projectIntentReviewV1 } from "./intent-review-v1.js";

/** Read-only projection of untrusted clarification output. Source questions and
 * requirements remain visible even when the model omits or invents a question.
 * This cannot answer, accept, persist or mutate any requirement. */
export function projectBlockingQuestionsReviewV1(input: {
  readonly request: unknown;
  readonly response: unknown;
  readonly requestedMode: unknown;
}) {
  const request = modelBlockingQuestionsRequestV1Schema.parse(input.request);
  const response = modelBlockingQuestionsResponseV1Schema.parse(input.response);
  const requestedMode = modelRequestedModeV1Schema.parse(input.requestedMode);
  const original = projectIntentReviewV1({
    intentDocument: request.intentDocument,
    requestedMode,
  });
  const questions = response.questions.map((question) => {
    const source = original.semantic.questions.find(
      (q) => String(q.id) === String(question.questionId),
    );
    return {
      ...question,
      source:
        source === undefined
          ? null
          : {
              questionId: source.id,
              subject: source.subject,
              classification: source.classification,
            },
    };
  });
  return {
    explanation:
      requestedMode === "guided"
        ? "Answer the open questions before planning changes. Your original requirements remain visible below."
        : "Review the unresolved constraints before planning changes.",
    semantic: {
      contractVersion: 1 as const,
      writeAuthority: "none" as const,
      state: "needs-user-input" as const,
      original: original.semantic,
      questions,
      missingBlockingQuestions: original.semantic.questions.filter(
        (q) =>
          q.classification === "blocking" &&
          !questions.some((p) => p.source?.questionId === q.id),
      ),
      assumptions: response.proposalContext.assumptions,
      unknowns: response.proposalContext.unknowns,
    },
  };
}
