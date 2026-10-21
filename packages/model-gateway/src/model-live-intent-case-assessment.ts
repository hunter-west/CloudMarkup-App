import { z } from "zod";
import {
  modelIntentExtractionResponseV1Schema,
  projectIntentReviewV1,
  sha256DigestSchema,
  solutionStableIdSchema,
} from "@cloudmarkup/schemas";
import {
  modelEvaluationAssistancePreferenceSemanticV1Schema,
  modelEvaluationMeasurementV1Schema,
} from "./model-evaluation.js";
import { assessModelLiveIntentRequirementsV1 } from "./model-live-intent-requirements-assessment.js";
import { digestStructuredValue } from "./security.js";

const dimensions = [
  "structured-schema-validity",
  "security-policy-violations",
  "capability-requirement-coverage",
  "issue-clarity-correct-severity",
  "unresolved-behavior-honesty",
  "same-ui-semantics-across-assistance-preferences",
] as const;
const exactSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  a.every((v) => b.includes(v));

/** Metadata only. Parsing never authenticates execution, journal or settlement. */
export const modelLiveIntentCaseAssessmentV2Schema = z
  .object({
    contractVersion: z.literal(2),
    recordKind: z.literal("model-live-intent-case-assessment"),
    validatorId: z.literal("cloudmarkup.live-intent-case-validator.v2"),
    validatorVersion: z.literal("2.2.0"),
    assessmentDigest: sha256DigestSchema,
    caseId: solutionStableIdSchema,
    caseDigest: sha256DigestSchema,
    sourceInputDigest: sha256DigestSchema,
    inputDigest: sha256DigestSchema,
    outputDigest: sha256DigestSchema,
    proposalDigest: sha256DigestSchema,
    measurements: z
      .array(modelEvaluationMeasurementV1Schema)
      .length(dimensions.length),
    assistancePreferenceSemantics: z
      .array(modelEvaluationAssistancePreferenceSemanticV1Schema)
      .length(2),
  })
  .strict()
  .superRefine((value, context) => {
    const { assessmentDigest, ...body } = value;
    const semanticDigests = [
      ...new Set(
        value.assistancePreferenceSemantics.map((v) => v.semanticDigest),
      ),
    ];
    const semantic = value.measurements.find(
      (m) => m.dimension === "same-ui-semantics-across-assistance-preferences",
    );
    if (
      assessmentDigest !== digestStructuredValue(body) ||
      !exactSet(
        value.measurements.map((m) => m.dimension),
        dimensions,
      ) ||
      value.measurements.some(
        (m) =>
          m.sourceAuthority !== "deterministic-evaluation-v1" ||
          m.evidenceDigests.length === 0 ||
          m.denominator !==
            (m.dimension === "capability-requirement-coverage"
              ? 16
              : m.dimension === "issue-clarity-correct-severity"
                ? 3
                : 1) ||
          (m.dimension === "structured-schema-validity" && m.numerator !== 1),
      ) ||
      !exactSet(
        value.assistancePreferenceSemantics.map((m) => m.assistancePreference),
        ["guided", "professional"],
      ) ||
      semantic?.denominator !== 1 ||
      semantic.numerator !== (semanticDigests.length === 1 ? 1 : 0) ||
      !exactSet(semantic.evidenceDigests, semanticDigests)
    ) {
      context.addIssue({
        code: "custom",
        message: "Intent case assessment metadata is contradictory.",
      });
    }
  });
export type ModelLiveIntentCaseAssessmentV2 = z.output<
  typeof modelLiveIntentCaseAssessmentV2Schema
>;

/** Execute all six non-operational dimensions for the frozen Intent case.
 * Both preferences execute the same canonical projection used by temporary and
 * saved browser review. Mode wording is deliberately outside semantic equality.
 * Structural requirement quality does not claim to grade free-text prose.
 * The host must authenticate actual journal input/output and persist a receipt;
 * canonical operational usage and financial settlement remain separate. */
export function assessModelLiveIntentCaseV2(
  input: Parameters<typeof assessModelLiveIntentRequirementsV1>[0],
): ModelLiveIntentCaseAssessmentV2 {
  const requirements = assessModelLiveIntentRequirementsV1(input);
  const response = modelIntentExtractionResponseV1Schema.parse(input.response);
  const assistancePreferenceSemantics = (
    ["guided", "professional"] as const
  ).map((assistancePreference) => {
    const review = projectIntentReviewV1({
      intentDocument: response.intentDocument,
      requestedMode: assistancePreference,
    });
    return {
      assistancePreference,
      semanticDigest: digestStructuredValue({
        review: review.semantic,
        additionalAssumptions: response.proposalContext.assumptions,
        additionalQuestions: response.proposalContext.unknowns,
      }),
    };
  });
  const digests = [
    ...new Set(assistancePreferenceSemantics.map((m) => m.semanticDigest)),
  ];
  const body = {
    contractVersion: 2 as const,
    recordKind: "model-live-intent-case-assessment" as const,
    validatorId: "cloudmarkup.live-intent-case-validator.v2" as const,
    validatorVersion: "2.2.0" as const,
    caseId: requirements.caseId,
    caseDigest: requirements.caseDigest,
    sourceInputDigest: requirements.sourceInputDigest,
    inputDigest: requirements.inputDigest,
    outputDigest: requirements.outputDigest,
    proposalDigest: requirements.intentDigest,
    measurements: [
      ...requirements.measurements,
      modelEvaluationMeasurementV1Schema.parse({
        dimension: "same-ui-semantics-across-assistance-preferences",
        numerator: digests.length === 1 ? 1 : 0,
        denominator: 1,
        sourceAuthority: "deterministic-evaluation-v1",
        evidenceDigests: digests,
      }),
    ],
    assistancePreferenceSemantics,
  };
  return modelLiveIntentCaseAssessmentV2Schema.parse({
    ...body,
    assessmentDigest: digestStructuredValue(body),
  });
}
