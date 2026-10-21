import { resolveFullBetaEvaluationPolicyV2 } from "./model-live-event-evaluation-policy.js";
import { z } from "zod";
import {
  digestCanonicalValue,
  modelDeterministicScoreDimensionV1Values,
  modelEvaluationAuthorityBindingV1Schema,
  modelEvaluationCaseResultV2Schema,
  modelEvaluationCaseV1Schema,
  modelEvaluationDatasetV1Schema,
  modelEvaluationReportV2Schema,
  modelLiveEvaluationPlanV2Schema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import {
  modelEvaluationOperationalBudgetsV1,
  modelEvaluationScoringPolicyV1,
  modelLiveEvaluationObservationV2Schema,
} from "./model-evaluation.js";
import { frozenFullBetaEvaluationDatasetV1 } from "./full-beta-evaluation-dataset.js";
import { validateModelLiveEvaluationDefinitionV2 } from "./model-live-evaluation-plan.js";

const same = (a: unknown, b: unknown) =>
  digestCanonicalValue(a) === digestCanonicalValue(b);
function requireReport(value: boolean): asserts value {
  if (!value)
    throw new Error(
      "Live evaluation report bindings are incomplete or inconsistent.",
    );
}
const scorePolicy = Object.freeze(
  Object.fromEntries(
    Object.entries(modelEvaluationScoringPolicyV1).map(([key, value]) => [
      key,
      Object.freeze({ ...value }),
    ]),
  ),
) as typeof modelEvaluationScoringPolicyV1;
const identity = {
  evaluationPolicyId: namespacedIdentifierSchema.parse(
    "cloudmarkup.model-evaluation.full-beta",
  ),
  evaluationPolicyVersion: semanticVersionSchema.parse("2.4.0"),
};
/** Exact projection policy frozen before provider execution. Existing thresholds
 * and denominators are preserved; this does not change financial budgets. */
export const fullBetaModelEvaluationPolicyV2 = Object.freeze({
  ...identity,
  evaluationPolicyDigest: digestCanonicalValue({
    ...identity,
    datasetId: frozenFullBetaEvaluationDatasetV1.datasetId,
    datasetVersion: frozenFullBetaEvaluationDatasetV1.datasetVersion,
    datasetDigest: frozenFullBetaEvaluationDatasetV1.datasetDigest,
    operationalBudgets: modelEvaluationOperationalBudgetsV1,
    scoringPolicy: scorePolicy,
    scoreContractVersion: 2,
    aggregateQuality: "unclipped-mean-direction-adjusted-basis-points",
  }),
});
requireReport(
  fullBetaModelEvaluationPolicyV2.evaluationPolicyDigest ===
    "sha256:d1e2fdd91f64626630efc49f9bc562d06f80395eaee4fb2699d083ab55b257a6",
);
const caseInput = z
  .object({
    evaluationCase: modelEvaluationCaseV1Schema,
    authorityBinding: modelEvaluationAuthorityBindingV1Schema,
    observation: modelLiveEvaluationObservationV2Schema,
  })
  .strict();

/** Pure arithmetic and exact source binding over untrusted metadata. Actual
 * journal/receipt and canonical-settlement authentication belongs to the host.
 * There is no invocation, arbitrary grade callback, persistence or promotion. */
export function projectModelLiveEvaluationCaseV2(value: unknown) {
  const { evaluationCase, authorityBinding, observation } =
    caseInput.parse(value);
  const tuple = authorityBinding.authorityTuple;
  requireReport(
    observation.caseId === evaluationCase.caseId &&
      observation.caseDigest === evaluationCase.caseDigest &&
      tuple.operation ===
        evaluationCase.expected.authorityRequirement.operation &&
      tuple.role === evaluationCase.expected.authorityRequirement.role &&
      same(
        [...observation.measurements.map((m) => m.dimension)].sort(),
        [...evaluationCase.targetDimensions].sort(),
      ),
  );
  const scores = modelDeterministicScoreDimensionV1Values.map((dimension) => {
    const policy = scorePolicy[dimension];
    const m = observation.measurements.find((v) => v.dimension === dimension);
    const basisPoints =
      m === undefined ? 0 : Math.floor((m.numerator * 10_000) / m.denominator);
    return {
      applicable: m !== undefined,
      authority: "deterministic" as const,
      dimension,
      basisPoints,
      numerator: m?.numerator ?? 0,
      denominator: m?.denominator ?? 0,
      direction: policy.direction,
      thresholdBasisPoints: policy.thresholdBasisPoints,
      passed:
        m === undefined ||
        (policy.direction === "higher-is-better"
          ? basisPoints >= policy.thresholdBasisPoints
          : basisPoints <= policy.thresholdBasisPoints),
      evidenceDigests: [...(m?.evidenceDigests ?? [])].sort(),
      toolId: namespacedIdentifierSchema.parse(policy.toolId),
      toolVersion: semanticVersionSchema.parse(policy.toolVersion),
    };
  });
  const body = {
    contractVersion: 2 as const,
    recordKind: "model-evaluation-case-result" as const,
    caseId: evaluationCase.caseId,
    caseDigest: evaluationCase.caseDigest,
    authorityRequirement: evaluationCase.expected.authorityRequirement,
    authorityRequirementDigest:
      evaluationCase.expected.authorityRequirementDigest,
    authorityTupleDigest: authorityBinding.authorityTupleDigest,
    outputDigest: observation.outputDigest,
    scores,
    deterministicPassed: scores.every((s) => s.passed),
    evidenceDigests: [
      ...new Set(scores.flatMap((s) => s.evidenceDigests)),
    ].sort(),
    safeErrorCodes: [...observation.safeErrorCodes].sort(),
    judgeScores: [],
  };
  return modelEvaluationCaseResultV2Schema.parse({
    ...body,
    resultDigest: digestCanonicalValue(body),
  });
}

const reportInput = z
  .object({
    dataset: modelEvaluationDatasetV1Schema,
    plan: modelLiveEvaluationPlanV2Schema,
    evaluationReportId: solutionStableIdSchema,
    startedAt: utcTimestampSchema,
    finishedAt: utcTimestampSchema,
    observations: z.array(modelLiveEvaluationObservationV2Schema).length(21),
  })
  .strict();

/** Complete held report projection ONLY. Digests and parsed plans are not proof
 * of issuance. The durable host must independently authenticate every original
 * receipt, canonical settlement, plan and current tenant/operator authorization
 * before recording this report. This helper cannot admit a model or run code. */
export function projectModelLiveEvaluationReportV2(value: unknown) {
  const input = reportInput.parse(value);
  const { dataset, plan } = input;
  requireReport(same(dataset, frozenFullBetaEvaluationDatasetV1));
  validateModelLiveEvaluationDefinitionV2({
    definition: plan.definition,
    dataset,
    expectedPolicy: plan.definition.policy,
  });
  const policy = plan.definition.policy.evaluationRequirement;
  const selectedPolicy = resolveFullBetaEvaluationPolicyV2(policy);
  requireReport(
    policy.evaluationPolicyId === selectedPolicy.evaluationPolicyId &&
      policy.evaluationPolicyVersion ===
        selectedPolicy.evaluationPolicyVersion &&
      policy.evaluationPolicyDigest === selectedPolicy.evaluationPolicyDigest &&
      new Set(input.observations.map((o) => o.caseId)).size ===
        dataset.cases.length &&
      Date.parse(plan.issuedAt) <= Date.parse(input.startedAt) &&
      Date.parse(input.startedAt) < Date.parse(plan.expiresAt) &&
      Date.parse(input.startedAt) <= Date.parse(input.finishedAt),
  );
  const authorityBindings = [
    ...new Map(
      plan.definition.cases.map((c) => [
        c.authorityBinding.authorityTupleDigest,
        c.authorityBinding,
      ]),
    ).values(),
  ];
  const caseResults = dataset.cases.map((evaluationCase, index) =>
    projectModelLiveEvaluationCaseV2({
      evaluationCase,
      authorityBinding: plan.definition.cases[index]?.authorityBinding,
      observation: input.observations.find(
        (o) => o.caseId === evaluationCase.caseId,
      ),
    }),
  );
  const scores = caseResults.flatMap((c) =>
    c.scores.filter((s) => s.applicable),
  );
  const body = {
    contractVersion: 2 as const,
    recordKind: "model-evaluation-report" as const,
    evaluationReportId: input.evaluationReportId,
    executionMode: "opt-in-live" as const,
    normalCi: false as const,
    activationRecommendation: "hold" as const,
    capabilityActivated: false as const,
    environment: plan.definition.scope.environment,
    liveEvaluationAuthorityDigest: plan.approval.approvalDigest,
    ...selectedPolicy,
    datasetDigest: dataset.datasetDigest,
    datasetCaseDigests: dataset.cases.map((c) => c.caseDigest),
    authorityBindings,
    authorityBindingSetDigest: digestCanonicalValue(
      authorityBindings.map((b) => b.authorityTupleDigest),
    ),
    caseResults,
    evaluationResultSetDigest: digestCanonicalValue(
      caseResults.map((c) => c.resultDigest),
    ),
    deterministicPassed: caseResults.every((c) => c.deterministicPassed),
    deterministicQualityBasisPoints: Math.floor(
      scores.reduce(
        (sum, s) =>
          sum +
          (s.direction === "higher-is-better"
            ? s.basisPoints
            : 10_000 - s.basisPoints),
        0,
      ) / scores.length,
    ),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    regressions: [],
  };
  return {
    report: modelEvaluationReportV2Schema.parse({
      ...body,
      reportDigest: digestCanonicalValue(body),
    }),
    issuanceVerified: false as const,
    currentAuthorityVerified: false as const,
    capabilityActivated: false as const,
  };
}
