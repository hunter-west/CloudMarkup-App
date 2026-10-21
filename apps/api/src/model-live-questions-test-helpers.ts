import { deterministicFakeResponseV1 } from "@cloudmarkup/model-gateway/testing";
import {
  frozenFullBetaEvaluationDatasetV1,
  digestStructuredValue,
  reviewedModelPromptRegistry,
  getModelResponseToolV1,
  sha256Text,
} from "@cloudmarkup/model-gateway";
import {
  modelInvocationDescriptorV1Schema,
  modelBlockingQuestionsResponseV1Schema,
} from "@cloudmarkup/schemas";
import { createProductionModelLiveCaseRequest } from "./production-model-live-case-request.js";
/** Synthetic responses only. No provider, hosted quality or financial authority. */
export function syntheticQuestionsCase() {
  const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
    (c) => c.caseKind === "novice-language-professional-constraints",
  );
  if (!evaluationCase) throw Error("Missing frozen question case");
  const request = createProductionModelLiveCaseRequest({
    caseId: evaluationCase.caseId,
    requestedMode: "guided",
  });
  if (request.operation !== "requirements.blocking-questions")
    throw Error("Wrong source");
  const prompt = reviewedModelPromptRegistry.get(request.operation);
  if (!prompt) throw Error("Missing prompt");
  const scope = {
    organizationId: "organization_synthetic_questions",
    projectId: "project_synthetic_questions",
    userId: "user_synthetic_questions",
  };
  const descriptor = modelInvocationDescriptorV1Schema.parse({
    contractVersion: 1,
    feature: request.operation,
    requestedMode: "guided",
    complexity: "standard",
    role: "low-cost-extraction-help",
    scope,
    invocationId: "invocation_synthetic_questions",
    inputDigest: digestStructuredValue({ request, scope }),
    idempotencyKeyDigest: sha256Text("synthetic-questions"),
    budgetDecisionId: "budget_synthetic_questions",
    entitlementDecisionId: "entitlement_synthetic_questions",
    providerFamily: "deterministic-fake",
    providerId: "cloudmarkup.fake",
    modelId: "cloudmarkup.fake-model",
    modelVersion: "1.0.0",
    promptDigest: prompt.digest,
    promptTemplateId: prompt.templateId,
    promptVersion: prompt.version,
    evaluationPolicyId: "cloudmarkup.synthetic.questions",
    evaluationPolicyVersion: "1.0.0",
    toolAuthority: "none",
  });
  const response = modelBlockingQuestionsResponseV1Schema.parse(
    deterministicFakeResponseV1({
      request,
      descriptor,
      prompt,
      responseTool: getModelResponseToolV1(request.operation),
      maximumOutputTokens: 8192,
      maximumOutputBytes: 500000,
      timeoutMilliseconds: 5000,
      promptCachePolicy: {
        enabled: false,
        cacheKeyRequired: false,
        maximumCheckpoints: 0,
        minimumCheckpointTokens: 0,
      },
    }),
  );
  response.questions =
    modelBlockingQuestionsResponseV1Schema.shape.questions.parse(
      request.intentDocument.unresolvedQuestions
        .filter((q) => q.classification === "blocking")
        .map((q) => ({
          questionId: q.id,
          question: q.question,
          rationale: q.rationale,
          evidenceReferences: [],
        })),
    );
  response.proposalContext.assumptions = [];
  response.proposalContext.unknowns = [];
  return {
    evaluationCase: structuredClone(evaluationCase),
    request,
    descriptor,
    response,
    outputDigest: digestStructuredValue(response),
  };
}
