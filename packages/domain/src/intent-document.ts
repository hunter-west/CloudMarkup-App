import {
  normalizeIntentDocumentV1,
  parseIntentDocumentV1,
  type CandidateAlternativeV1,
  type CapabilityRequirementV1,
  type DataCategoryV1,
  type IntentDocumentV1,
  type UnresolvedQuestionV1,
  type UserDecisionV1,
  type WorkflowRequirementV1,
} from "@cloudmarkup/schemas";

import {
  IntentDocumentSemanticError,
  validateIntentDocumentSemantics,
} from "./intent-semantic-validation.js";

export type IntentDocument = IntentDocumentV1;
export type IntentIR = IntentDocument;
export type IntentCapabilityRequirement = CapabilityRequirementV1;
export type IntentDataCategory = DataCategoryV1;
export type IntentWorkflowRequirement = WorkflowRequirementV1;
export type IntentUnresolvedQuestion = UnresolvedQuestionV1;
export type IntentUserDecision = UserDecisionV1;
export type IntentCandidateAlternative = CandidateAlternativeV1;

export function parseIntentDocument(input: unknown): IntentDocument {
  const document = parseIntentDocumentV1(input);
  const issues = validateIntentDocumentSemantics(document);

  if (issues.length > 0) {
    throw new IntentDocumentSemanticError(issues);
  }

  return normalizeIntentDocumentV1(document);
}
