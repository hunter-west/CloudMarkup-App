import { z } from "zod";
import {
  digestStructuredValue,
  modelLiveIntentCaseAssessmentV2Schema,
  modelEvaluationMeasurementV1Schema,
} from "@cloudmarkup/model-gateway";

const caseId = "evaluation_case_external_existing_resource_full_beta_v1";
const dimensions = [
  "structured-schema-validity",
  "capability-requirement-coverage",
  "graph-workload-external-rule-violations",
  "grounded-repository-evidence-rate",
  "stable-id-user-owned-file-preservation",
  "security-policy-violations",
  "issue-clarity-correct-severity",
  "same-ui-semantics-across-assistance-preferences",
] as const;
const exact = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  a.every((v) => b.includes(v));

/** Historical shape only; the issued plan, scoped journal and SQL supply authority. */
export const modelLiveExternalCaseAssessmentV2Schema = z
  .object({
    ...modelLiveIntentCaseAssessmentV2Schema.shape,
    recordKind: z.literal("model-live-external-case-assessment"),
    validatorId: z.literal("cloudmarkup.live-external-case-validator.v2"),
    validatorVersion: z.literal("2.7.0"),
    caseId: z.literal(caseId),
    measurements: z.array(modelEvaluationMeasurementV1Schema).length(8),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { assessmentDigest, ...body } = value;
    const ds = [
      ...new Set(
        value.assistancePreferenceSemantics.map((s) => s.semanticDigest),
      ),
    ];
    const parity = value.measurements.find(
      (m) => m.dimension === "same-ui-semantics-across-assistance-preferences",
    );
    if (
      assessmentDigest !== digestStructuredValue(body) ||
      !exact(
        value.measurements.map((m) => m.dimension),
        dimensions,
      ) ||
      !exact(
        value.assistancePreferenceSemantics.map((s) => s.assistancePreference),
        ["guided", "professional"],
      ) ||
      value.measurements.some(
        (m) =>
          m.sourceAuthority !== "deterministic-evaluation-v1" ||
          m.evidenceDigests.length === 0 ||
          (m.dimension === "capability-requirement-coverage"
            ? m.denominator !== 4
            : ![
                "graph-workload-external-rule-violations",
                "security-policy-violations",
              ].includes(m.dimension) && m.denominator !== 1) ||
          (m.dimension === "structured-schema-validity" && m.numerator !== 1),
      ) ||
      parity?.numerator !== (ds.length === 1 ? 1 : 0) ||
      !exact(parity.evidenceDigests, ds)
    )
      ctx.addIssue({
        code: "custom",
        message: "External-resource assessment metadata is contradictory.",
      });
  });
