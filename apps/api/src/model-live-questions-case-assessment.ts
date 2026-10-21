import { z } from "zod";
import {
  digestStructuredValue,
  frozenFullBetaEvaluationDatasetV1,
  inspectModelValueForSecretCandidatesV1,
  modelEvaluationMeasurementV1Schema,
  modelLiveIntentCaseAssessmentV2Schema,
  validateModelRequestAuthority,
  validateModelResponseAuthority,
} from "@cloudmarkup/model-gateway";
import {
  modelBlockingQuestionsRequestV1Schema,
  modelBlockingQuestionsResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  projectBlockingQuestionsReviewV1,
} from "@cloudmarkup/schemas";
import { createProductionModelLiveCaseRequest } from "./production-model-live-case-request.js";
const dimensions = [
  "structured-schema-validity",
  "security-policy-violations",
  "capability-requirement-coverage",
  "issue-clarity-correct-severity",
  "unresolved-behavior-honesty",
  "same-ui-semantics-across-assistance-preferences",
] as const;
const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);
const exact = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  a.every((v) => b.includes(v));
function requireQuestions(value: boolean): asserts value {
  if (!value)
    throw Error("The exact clarification case assessment is unavailable.");
}
/** Counts/digests only. Parsing metadata does not authenticate any execution. */
export const modelLiveQuestionsCaseAssessmentV2Schema = z
  .object({
    ...modelLiveIntentCaseAssessmentV2Schema.shape,
    recordKind: z.literal("model-live-questions-case-assessment"),
    validatorId: z.literal("cloudmarkup.live-questions-case-validator.v2"),
    validatorVersion: z.literal("2.4.0"),
  })
  .strict()
  .superRefine((value, context) => {
    const { assessmentDigest, ...body } = value;
    const digests = [
      ...new Set(
        value.assistancePreferenceSemantics.map((s) => s.semanticDigest),
      ),
    ];
    const semantic = value.measurements.find(
      (m) => m.dimension === "same-ui-semantics-across-assistance-preferences",
    );
    if (
      assessmentDigest !== digestStructuredValue(body) ||
      !exact(
        value.measurements.map((m) => m.dimension),
        dimensions,
      ) ||
      value.measurements.some(
        (m) =>
          m.sourceAuthority !== "deterministic-evaluation-v1" ||
          m.evidenceDigests.length === 0 ||
          m.denominator !==
            ([
              "capability-requirement-coverage",
              "issue-clarity-correct-severity",
            ].includes(m.dimension)
              ? 4
              : 1) ||
          (m.dimension === "structured-schema-validity" && m.numerator !== 1),
      ) ||
      !exact(
        value.assistancePreferenceSemantics.map((s) => s.assistancePreference),
        ["guided", "professional"],
      ) ||
      semantic?.numerator !== (digests.length === 1 ? 1 : 0) ||
      !exact(semantic.evidenceDigests, digests)
    )
      context.addIssue({
        code: "custom",
        message: "Clarification assessment metadata is contradictory.",
      });
  });
/** Fixed frozen case over actual temporary bytes. It measures source-linked,
 * readable unresolved questions and the actual shared UI projection, never
 * linguistic correctness, an accepted answer, financial authority or promotion. */
export function assessModelLiveQuestionsCaseV2(input: {
  readonly evaluationCase: unknown;
  readonly request: unknown;
  readonly descriptor: unknown;
  readonly response: unknown;
  readonly outputDigest: string;
}) {
  const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
    (c) => c.caseKind === "novice-language-professional-constraints",
  );
  requireQuestions(
    evaluationCase !== undefined && same(evaluationCase, input.evaluationCase),
  );
  const request = modelBlockingQuestionsRequestV1Schema.parse(input.request),
    response = modelBlockingQuestionsResponseV1Schema.parse(input.response),
    descriptor = modelInvocationDescriptorV1Schema.parse(input.descriptor);
  requireQuestions(
    same(
      request,
      createProductionModelLiveCaseRequest({
        caseId: evaluationCase.caseId,
        requestedMode: request.requestedMode,
      }),
    ) &&
      descriptor.feature === request.operation &&
      descriptor.role === "low-cost-extraction-help" &&
      descriptor.requestedMode === request.requestedMode &&
      descriptor.inputDigest ===
        digestStructuredValue({ request, scope: descriptor.scope }) &&
      input.outputDigest === digestStructuredValue(response),
  );
  validateModelRequestAuthority(request);
  validateModelResponseAuthority({
    request,
    response,
    descriptor,
    allowedApprovalPathIds: new Set(),
  });
  requireQuestions(
    inspectModelValueForSecretCandidatesV1(response).detectedValueCount === 0,
  );
  const reviews = (["guided", "professional"] as const).map(
    (requestedMode) => ({
      requestedMode,
      review: projectBlockingQuestionsReviewV1({
        request,
        response,
        requestedMode,
      }),
    }),
  );
  const review = reviews[0];
  requireQuestions(review !== undefined);
  const required = request.intentDocument.unresolvedQuestions.filter(
    (q) => q.classification === "blocking",
  );
  requireQuestions(required.length === 4);
  const observations = required.map((source) => {
    const question = review.review.semantic.questions.find(
      (q) => q.source?.questionId === source.id,
    );
    return {
      sourceId: source.id,
      present: question !== undefined,
      readable:
        question !== undefined &&
        question.question.trim().length > 0 &&
        question.rationale.trim().length > 0 &&
        question.source?.classification === "blocking",
    };
  });
  const outputDigest = digestStructuredValue(response),
    projectionDigest = digestStructuredValue(review.review.semantic),
    criteriaDigest = digestStructuredValue(observations);
  const assistancePreferenceSemantics = reviews.map(
    ({ requestedMode, review }) => ({
      assistancePreference: requestedMode,
      semanticDigest: digestStructuredValue(review.semantic),
    }),
  );
  const digests = [
    ...new Set(assistancePreferenceSemantics.map((s) => s.semanticDigest)),
  ];
  const measure = (
    dimension: (typeof dimensions)[number],
    numerator: number,
    denominator: number,
    evidenceDigests: readonly string[],
  ) =>
    modelEvaluationMeasurementV1Schema.parse({
      dimension,
      numerator,
      denominator,
      evidenceDigests,
      sourceAuthority: "deterministic-evaluation-v1",
    });
  const body = {
    contractVersion: 2 as const,
    recordKind: "model-live-questions-case-assessment" as const,
    validatorId: "cloudmarkup.live-questions-case-validator.v2" as const,
    validatorVersion: "2.4.0" as const,
    caseId: evaluationCase.caseId,
    caseDigest: evaluationCase.caseDigest,
    sourceInputDigest: digestStructuredValue(evaluationCase.input),
    inputDigest: descriptor.inputDigest,
    outputDigest,
    proposalDigest: projectionDigest,
    assistancePreferenceSemantics,
    measurements: [
      measure("structured-schema-validity", 1, 1, [outputDigest]),
      measure("security-policy-violations", 0, 1, [outputDigest]),
      measure(
        "capability-requirement-coverage",
        observations.filter((o) => o.present).length,
        4,
        [criteriaDigest],
      ),
      measure(
        "issue-clarity-correct-severity",
        observations.filter((o) => o.readable).length,
        4,
        [criteriaDigest, projectionDigest],
      ),
      measure(
        "unresolved-behavior-honesty",
        response.proposalContext.assumptions.length === 0 &&
          review.review.semantic.questions.every((q) => q.source !== null) &&
          response.proposalContext.unknowns.every((q) => q.blocking)
          ? 1
          : 0,
        1,
        [projectionDigest],
      ),
      measure(
        "same-ui-semantics-across-assistance-preferences",
        digests.length === 1 ? 1 : 0,
        1,
        digests,
      ),
    ],
  };
  return modelLiveQuestionsCaseAssessmentV2Schema.parse({
    ...body,
    assessmentDigest: digestStructuredValue(body),
  });
}
