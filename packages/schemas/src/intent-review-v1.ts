import {
  intentDocumentV1Schema,
  type IntentDocumentV1,
} from "./intent-document-v1.js";
import { normalizeIntentDocumentV1 } from "./intent-normalization.js";
import {
  modelRequestedModeV1Schema,
  type ModelRequestedModeV1,
} from "./model-gateway-v1.js";

/** Shared read-only review data for temporary and accepted requirements. The
 * assistance preference controls explanatory wording only; requirements,
 * questions, ordering and write authority remain identical. This projection
 * does not approve requirements or create an editing/tenant authorization. */
export function projectIntentReviewV1(input: {
  readonly intentDocument: IntentDocumentV1;
  readonly requestedMode: ModelRequestedModeV1;
}) {
  const mode = modelRequestedModeV1Schema.parse(input.requestedMode);
  const intent = normalizeIntentDocumentV1(
    intentDocumentV1Schema.parse(input.intentDocument),
  );
  return {
    explanation:
      mode === "guided"
        ? "Review the requirements, assumptions and open questions before planning changes."
        : "Review requirements and unresolved constraints before planning changes.",
    semantic: {
      contractVersion: 1 as const,
      writeAuthority: "none" as const,
      summary: intent.application.summary,
      assumptions: intent.assumptions,
      questions: intent.unresolvedQuestions,
      sections: [
        ["Capabilities", intent.application.capabilities],
        ["Connectivity", intent.connectivity],
        ["Identity and access", intent.identity],
        ["Data", intent.data],
        ["Workflows", intent.workflows],
        ["Availability, recovery and scale", intent.quality],
        ["Environment", intent.environment],
        ["Cost and operations", intent.preferences],
        ["Compliance", intent.compliance],
        ["Decisions", intent.decisions],
        ["Alternatives", intent.alternatives],
      ] as const,
    },
  };
}
