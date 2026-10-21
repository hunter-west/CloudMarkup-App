import { z } from "zod";
import { digestCanonicalValue } from "./canonical-digest.js";
import { sha256DigestSchema } from "./architecture-document-v1.js";
import {
  modelDeterministicScoreDimensionV1Values,
  modelDeterministicScoreV1Schema,
  modelEvaluationCaseKindV1Values,
  modelEvaluationCaseResultV1Schema,
  modelEvaluationReportV1Schema,
  modelEvaluationRegressionV1Schema,
} from "./model-evaluation-v1.js";

const operational = new Set(["credits", "estimated-cost", "latency", "tokens"]);
// Counts are bounded at 1e9; a positive denominator yields at most 1e13 bp.
// This is an exact ratio, not a percentage clamped to 100%.
const ratio = z.number().int().min(0).max(10_000_000_000_000);
const signedRatio = z
  .number()
  .int()
  .min(-10_000_000_000_000)
  .max(10_000_000_000_000);
const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;
const exactSet = (a: readonly string[], b: readonly string[]) =>
  unique(a) &&
  unique(b) &&
  a.length === b.length &&
  a.every((v) => b.includes(v));
function fail(context: z.RefinementCtx, message: string) {
  context.addIssue({ code: "custom", message });
}

/** Additive live score metadata. Exact operational budget overruns remain
 * observable and fail their threshold; V1 contracts and artifacts are unchanged.
 * Parsing never authenticates measurements, receipts or current authority. */
export const modelDeterministicScoreV2Schema = z
  .object({
    ...modelDeterministicScoreV1Schema.shape,
    basisPoints: ratio,
  })
  .strict()
  .superRefine((value, context) => {
    if (!unique(value.evidenceDigests))
      fail(context, "Score evidence must be unique.");
    if (!value.applicable) {
      if (
        value.numerator !== 0 ||
        value.denominator !== 0 ||
        value.basisPoints !== 0 ||
        !value.passed ||
        value.evidenceDigests.length !== 0
      )
        fail(context, "Non-applicable scores must be empty and cannot fail.");
      return;
    }
    if (
      value.denominator === 0 ||
      (!operational.has(value.dimension) &&
        value.numerator > value.denominator) ||
      value.evidenceDigests.length === 0 ||
      (operational.has(value.dimension) &&
        value.direction !== "lower-is-better")
    ) {
      fail(
        context,
        "Applicable score counts require exact evidence and a valid dimension bound.",
      );
      return;
    }
    if (
      value.basisPoints !==
      Math.floor((value.numerator * 10_000) / value.denominator)
    )
      fail(context, "Score ratios must preserve exact measured counts.");
    if (
      value.passed !==
      (value.direction === "higher-is-better"
        ? value.basisPoints >= value.thresholdBasisPoints
        : value.basisPoints <= value.thresholdBasisPoints)
    )
      fail(
        context,
        "Score pass state must follow its exact direction and threshold.",
      );
  });
export type ModelDeterministicScoreV2 = z.output<
  typeof modelDeterministicScoreV2Schema
>;

export const modelEvaluationCaseResultV2Schema = z
  .object({
    ...modelEvaluationCaseResultV1Schema.shape,
    contractVersion: z.literal(2),
    scores: z
      .array(modelDeterministicScoreV2Schema)
      .length(modelDeterministicScoreDimensionV1Values.length),
  })
  .strict()
  .superRefine((value, context) => {
    const { resultDigest, ...body } = value;
    const scoreEvidence = [
      ...new Set(
        value.scores
          .filter((s) => s.applicable)
          .flatMap((s) => s.evidenceDigests),
      ),
    ];
    if (
      value.authorityRequirementDigest !==
        digestCanonicalValue(value.authorityRequirement) ||
      !exactSet(
        value.scores.map((s) => s.dimension),
        modelDeterministicScoreDimensionV1Values,
      ) ||
      value.deterministicPassed !== value.scores.every((s) => s.passed) ||
      !exactSet(value.evidenceDigests, scoreEvidence) ||
      !unique(value.safeErrorCodes) ||
      resultDigest !== digestCanonicalValue(body)
    )
      fail(
        context,
        "Case metadata must bind exact requirements, scores, evidence and pass state.",
      );
  });
export type ModelEvaluationCaseResultV2 = z.output<
  typeof modelEvaluationCaseResultV2Schema
>;

export const modelEvaluationRegressionV2Schema = z
  .object({
    ...modelEvaluationRegressionV1Schema.shape,
    currentBasisPoints: ratio,
    priorBasisPoints: ratio,
    deltaBasisPoints: signedRatio,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.deltaBasisPoints !==
        value.currentBasisPoints - value.priorBasisPoints ||
      !unique(value.evidenceDigests) ||
      (!operational.has(value.dimension) &&
        (value.currentBasisPoints > 10_000 || value.priorBasisPoints > 10_000))
    )
      fail(
        context,
        "Regression must preserve exact compatible score ratios and unique evidence.",
      );
  });

/** Full live report comparison data, always held and never activation authority.
 * Negative aggregate quality is retained when operational overruns outweigh
 * correctness. Raw counts, ratios and threshold failures are never clipped. */
export const modelEvaluationReportV2Schema = z
  .object({
    ...modelEvaluationReportV1Schema.shape,
    activationRecommendation: z.literal("hold"),
    caseResults: z
      .array(modelEvaluationCaseResultV2Schema)
      .length(modelEvaluationCaseKindV1Values.length),
    contractVersion: z.literal(2),
    deterministicQualityBasisPoints: signedRatio.max(10_000),
    environment: z.enum(["development", "staging"]),
    executionMode: z.literal("opt-in-live"),
    liveEvaluationAuthorityDigest: sha256DigestSchema,
    normalCi: z.literal(false),
    regressions: z.array(modelEvaluationRegressionV2Schema).max(512),
  })
  .strict()
  .superRefine((value, context) => {
    const tuples = value.authorityBindings.map((b) => b.authorityTupleDigest);
    if (
      !unique(tuples) ||
      value.authorityBindingSetDigest !== digestCanonicalValue(tuples)
    )
      fail(
        context,
        "Report bindings must be unique and digest the exact ordered tuples.",
      );
    for (const result of value.caseResults) {
      const tuple = value.authorityBindings.find(
        (b) => b.authorityTupleDigest === result.authorityTupleDigest,
      )?.authorityTuple;
      if (
        tuple?.operation !== result.authorityRequirement.operation ||
        tuple.role !== result.authorityRequirement.role
      )
        fail(
          context,
          "Every result must bind an exact declared operation and role.",
        );
    }
    if (
      tuples.some(
        (t) => !value.caseResults.some((c) => c.authorityTupleDigest === t),
      )
    )
      fail(context, "Unused report authority tuples are forbidden.");
    if (
      !exactSet(
        value.caseResults.map((c) => c.caseDigest),
        value.datasetCaseDigests,
      ) ||
      !unique(value.caseResults.map((c) => c.caseId))
    )
      fail(
        context,
        "Report results must cover every declared case exactly once.",
      );
    if (
      !unique(
        value.regressions.map((r) => r.caseId + "\u0000" + r.dimension),
      ) ||
      (value.regressions.length > 0 && value.baselineReport === undefined)
    )
      fail(
        context,
        "Regressions must be unique and reference an exact baseline.",
      );
    for (const regression of value.regressions) {
      const score = value.caseResults
        .find(
          (c) =>
            c.caseId === regression.caseId &&
            c.caseDigest === regression.caseDigest,
        )
        ?.scores.find((s) => s.dimension === regression.dimension);
      if (
        score?.basisPoints !== regression.currentBasisPoints ||
        score.passed !== regression.currentPassed
      )
        fail(context, "Regressions must rejoin the exact current score.");
    }
    const scores = value.caseResults.flatMap((c) =>
      c.scores.filter((s) => s.applicable),
    );
    const covered = new Set(scores.map((s) => s.dimension));
    if (modelDeterministicScoreDimensionV1Values.some((d) => !covered.has(d)))
      fail(
        context,
        "Every required dimension needs actual applicable evidence.",
      );
    const quality =
      scores.length === 0
        ? 0
        : Math.floor(
            scores.reduce(
              (sum, s) =>
                sum +
                (s.direction === "higher-is-better"
                  ? s.basisPoints
                  : 10_000 - s.basisPoints),
              0,
            ) / scores.length,
          );
    if (
      value.deterministicQualityBasisPoints !== quality ||
      value.deterministicPassed !==
        value.caseResults.every((c) => c.deterministicPassed)
    )
      fail(
        context,
        "Report quality and pass state must preserve deterministic score results.",
      );
    const { reportDigest, ...body } = value;
    if (
      value.evaluationResultSetDigest !==
        digestCanonicalValue(value.caseResults.map((c) => c.resultDigest)) ||
      Date.parse(value.finishedAt) < Date.parse(value.startedAt) ||
      reportDigest !== digestCanonicalValue(body)
    )
      fail(
        context,
        "Report must bind every ordered result and valid run interval.",
      );
  });
export type ModelEvaluationReportV2 = z.output<
  typeof modelEvaluationReportV2Schema
>;
