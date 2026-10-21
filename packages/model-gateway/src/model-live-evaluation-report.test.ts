import { fullBetaEventEvaluationPolicyV2 } from "./model-live-event-evaluation-policy.js";
import { describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  sha256Text,
  modelEvaluationReportV1Schema,
  modelEvaluationReportV2Schema,
  modelDeterministicScoreV1Schema,
  modelDeterministicScoreV2Schema,
  modelEvaluationCaseResultV2Schema,
} from "@cloudmarkup/schemas";
import {
  fullBetaModelEvaluationPolicyV2,
  projectModelLiveEvaluationCaseV2,
  projectModelLiveEvaluationReportV2,
} from "./model-live-evaluation-report.js";
import {
  modelEvaluationOperationalBudgetsV1,
  modelEvaluationScoringPolicyV1,
  modelLiveEvaluationObservationV2Schema,
} from "./model-evaluation.js";
import { syntheticLiveEvaluationFixtureV2 } from "./model-live-evaluation-fakes.js";

function rehash<T extends object>(value: T, key: keyof T): T {
  return {
    ...value,
    [key]: digestCanonicalValue(
      Object.fromEntries(
        Object.entries(value).filter(([name]) => name !== key),
      ),
    ),
  };
}
/** Deliberately synthetic metadata only. No hosted observations or issuer proof. */
function fixture(
  overrun = false,
  evaluationPolicy = fullBetaModelEvaluationPolicyV2,
) {
  const f = syntheticLiveEvaluationFixtureV2({
    fullBetaEvaluationSource: true,
  });
  const policy = rehash(
    {
      ...f.policy,
      evaluationRequirement: {
        ...f.policy.evaluationRequirement,
        ...evaluationPolicy,
      },
    },
    "policyDigest",
  );
  const definition = rehash({ ...f.definition, policy }, "definitionDigest");
  const approval = rehash(
    { ...f.approval, definitionDigest: definition.definitionDigest },
    "approvalDigest",
  );
  const plan = rehash({ ...f.plan, definition, approval }, "planDigest");
  const observations = f.dataset.cases.map((c) => {
    const semanticDigest = sha256Text("synthetic-semantic:" + c.caseId);
    const usage = {
      commercialSourceAuthority: "canonical-commercial-v1",
      usageSourceAuthority: "canonical-model-usage-v1",
      creditUnits: overrun ? 1_000_000_000 : 1,
      estimatedMicroUsd: overrun ? 1_000_000_000 : 100,
      inputTokens: overrun ? 13000 : 10,
      outputTokens: 20,
      totalTokens: overrun ? 13020 : 30,
      latencyMilliseconds: overrun ? 180000 : 50,
    };
    const values = {
      credits: usage.creditUnits,
      "estimated-cost": usage.estimatedMicroUsd,
      tokens: usage.totalTokens,
      latency: usage.latencyMilliseconds,
    };
    return modelLiveEvaluationObservationV2Schema.parse({
      adapterId: "cloudmarkup.synthetic.report-test",
      adapterVersion: "2.0.0",
      contractVersion: 2,
      executionMode: "live",
      caseId: c.caseId,
      caseDigest: c.caseDigest,
      outputDigest: sha256Text("synthetic-output:" + c.caseId),
      safeErrorCodes: [],
      noRawPromptResponseRepositoryOrCandidateContent: true,
      operationalUsage: usage,
      assistancePreferenceSemantics: ["guided", "professional"].map(
        (assistancePreference) => ({ assistancePreference, semanticDigest }),
      ),
      measurements: c.targetDimensions.map((dimension) => {
        const operational = Object.hasOwn(values, dimension);
        return {
          dimension,
          numerator: operational
            ? values[dimension as keyof typeof values]
            : modelEvaluationScoringPolicyV1[dimension].direction ===
                "higher-is-better"
              ? 1
              : 0,
          denominator: operational
            ? modelEvaluationOperationalBudgetsV1[
                dimension as keyof typeof values
              ]
            : 1,
          evidenceDigests: [
            dimension === "same-ui-semantics-across-assistance-preferences"
              ? semanticDigest
              : sha256Text("synthetic-evidence:" + c.caseId + ":" + dimension),
          ],
          sourceAuthority: operational
            ? dimension === "credits" || dimension === "estimated-cost"
              ? "canonical-commercial-v1"
              : "canonical-model-usage-v1"
            : "deterministic-evaluation-v1",
        };
      }),
    });
  });
  return {
    dataset: f.dataset,
    plan,
    observations,
    evaluationReportId: "report_synthetic_v2",
    startedAt: plan.issuedAt,
    finishedAt: "2026-09-09T12:01:00.000Z",
  };
}
function firstCase(f = fixture()) {
  return {
    evaluationCase: f.dataset.cases[0],
    authorityBinding: f.plan.definition.cases[0]?.authorityBinding,
    observation: f.observations[0],
  };
}
describe("exact live report arithmetic without issuance authority", () => {
  it("pins policy identity and refuses a report starting outside its issued interval", () => {
    expect(fullBetaModelEvaluationPolicyV2.evaluationPolicyDigest).toBe(
      "sha256:d1e2fdd91f64626630efc49f9bc562d06f80395eaee4fb2699d083ab55b257a6",
    );
    const f = fixture();
    expect(() =>
      projectModelLiveEvaluationReportV2({
        ...f,
        startedAt: f.plan.expiresAt,
        finishedAt: f.plan.expiresAt,
      }),
    ).toThrow();
    expect(() =>
      projectModelLiveEvaluationReportV2({
        ...f,
        startedAt: "2026-09-08T12:00:00.000Z",
      }),
    ).toThrow();
  });
  it.each([
    "empty-evidence",
    "duplicate-evidence",
    "empty-denominator",
    "non-applicable-count",
    "non-applicable-failure",
  ] as const)("rejects invalid %s score data", (kind) => {
    const score = projectModelLiveEvaluationCaseV2(firstCase()).scores.find(
      (s) => s.dimension === "tokens",
    );
    if (!score) throw Error("Missing score");
    if (kind === "empty-evidence") score.evidenceDigests = [];
    if (kind === "duplicate-evidence")
      score.evidenceDigests = [
        ...score.evidenceDigests,
        ...score.evidenceDigests,
      ];
    if (kind === "empty-denominator") score.denominator = 0;
    if (kind.startsWith("non-applicable")) {
      score.applicable = false;
      score.numerator = 0;
      score.denominator = 0;
      score.basisPoints = 0;
      score.passed = true;
      score.evidenceDigests = [];
      if (kind === "non-applicable-count") score.numerator = 1;
      else score.passed = false;
    }
    expect(modelDeterministicScoreV2Schema.safeParse(score).success).toBe(
      false,
    );
  });
  it("projects complete source coverage while explicitly providing no issuance, current authority or activation", () => {
    const f = fixture(),
      before = structuredClone(f);
    const result = projectModelLiveEvaluationReportV2(f);
    expect(result).toMatchObject({
      issuanceVerified: false,
      currentAuthorityVerified: false,
      capabilityActivated: false,
      report: {
        contractVersion: 2,
        activationRecommendation: "hold",
        deterministicPassed: true,
      },
    });
    expect(result.report.caseResults).toHaveLength(21);
    expect(f).toEqual(before);
    expect(projectModelLiveEvaluationReportV2(f)).toEqual(result);
    expect(
      projectModelLiveEvaluationReportV2({
        ...f,
        observations: [...f.observations].reverse(),
      }),
    ).toEqual(result);
    expect(modelEvaluationReportV1Schema.safeParse(result.report).success).toBe(
      false,
    );
  });
  it("retains real-sized token and cost overruns, failing ratios and negative aggregate quality without clipping", () => {
    const f = fixture(true);
    const { report } = projectModelLiveEvaluationReportV2(f);
    const score = report.caseResults[0]?.scores.find(
      (s) => s.dimension === "tokens",
    );
    expect(score).toMatchObject({
      numerator: 13020,
      denominator: 5000,
      basisPoints: 26040,
      passed: false,
    });
    expect(report.deterministicPassed).toBe(false);
    expect(report.deterministicQualityBasisPoints).toBeLessThan(0);
    expect(modelDeterministicScoreV1Schema.safeParse(score).success).toBe(
      false,
    );
    expect(modelDeterministicScoreV2Schema.safeParse(score).success).toBe(true);
    expect(modelEvaluationReportV2Schema.safeParse(report).success).toBe(true);
  });
  it.each([
    "missing",
    "duplicate",
    "wrong-output-count",
    "synthetic-authority",
    "substituted-policy",
    "extra-grade",
    "wrong-source",
    "wrong-tuple",
  ] as const)("rejects %s before projecting report metadata", (kind) => {
    const f = fixture();
    const first = f.observations[0];
    if (!first) throw Error("Missing case");
    if (kind === "missing") f.observations.pop();
    if (kind === "duplicate") f.observations[1] = structuredClone(first);
    if (kind === "wrong-output-count") first.operationalUsage.totalTokens++;
    if (kind === "synthetic-authority")
      Reflect.set(
        first.measurements[0] ?? {},
        "sourceAuthority",
        "synthetic-fake-v1",
      );
    if (kind === "substituted-policy") {
      f.plan.definition.policy.evaluationRequirement.evaluationPolicyDigest =
        sha256Text("other-policy");
      f.plan.definition.policy = rehash(
        f.plan.definition.policy,
        "policyDigest",
      );
      f.plan.definition = rehash(f.plan.definition, "definitionDigest");
      f.plan.approval = rehash(
        {
          ...f.plan.approval,
          definitionDigest: f.plan.definition.definitionDigest,
        },
        "approvalDigest",
      );
      f.plan = rehash(f.plan, "planDigest");
    }
    if (kind === "extra-grade") Reflect.set(f, "passed", true);
    if (kind === "wrong-source") first.caseDigest = sha256Text("other-source");
    if (kind === "wrong-tuple") {
      const c = firstCase(f);
      expect(() =>
        projectModelLiveEvaluationCaseV2({
          ...c,
          authorityBinding: f.plan.definition.cases.find(
            (b) =>
              b.authorityBinding.authorityTuple.operation !==
              c.authorityBinding?.authorityTuple.operation,
          )?.authorityBinding,
        }),
      ).toThrow();
      return;
    }
    expect(() => projectModelLiveEvaluationReportV2(f)).toThrow();
  });
  it("requires every exact per-case dimension and refuses caller-supplied thresholds", () => {
    const f = firstCase();
    if (!f.observation) throw Error("Missing case");
    f.observation.measurements = f.observation.measurements.filter(
      (m) => m.dimension !== "structured-schema-validity",
    );
    expect(() => projectModelLiveEvaluationCaseV2(f)).toThrow();
    const good = firstCase();
    expect(() =>
      projectModelLiveEvaluationCaseV2({ ...good, scoringPolicy: {} }),
    ).toThrow();
  });
  it.each([
    "score-ratio",
    "score-pass",
    "score-bound",
    "result-pass",
    "report-pass",
    "report-quality",
    "activated",
    "duplicate-result",
    "missing-evidence",
    "unused-authority",
    "wrong-tuple",
    "regression",
  ] as const)("rejects rehashed %s report forgery", (kind) => {
    let report = projectModelLiveEvaluationReportV2(fixture(true)).report;
    const first = report.caseResults[0];
    const tokens = first?.scores.find((s) => s.dimension === "tokens");
    if (!first || !tokens) throw Error("Missing score");
    if (kind === "score-ratio") tokens.basisPoints = 10000;
    if (kind === "score-pass") tokens.passed = true;
    if (kind === "score-bound")
      Reflect.set(tokens, "direction", "higher-is-better");
    if (kind === "result-pass") first.deterministicPassed = true;
    if (kind === "report-pass") report.deterministicPassed = true;
    if (kind === "report-quality")
      report.deterministicQualityBasisPoints = 10000;
    if (kind === "activated") Reflect.set(report, "capabilityActivated", true);
    if (kind === "duplicate-result")
      report.caseResults[1] = structuredClone(first);
    if (kind === "missing-evidence") first.evidenceDigests = [];
    if (kind === "unused-authority") report.authorityBindings.pop();
    if (kind === "wrong-tuple")
      first.authorityTupleDigest = sha256Text("substitution");
    if (kind === "regression")
      report.regressions = [
        {
          authority: "deterministic",
          caseId: first.caseId,
          caseDigest: first.caseDigest,
          dimension: "tokens",
          currentBasisPoints: tokens.basisPoints,
          priorBasisPoints: 0,
          deltaBasisPoints: tokens.basisPoints,
          currentPassed: false,
          priorPassed: true,
          evidenceDigests: tokens.evidenceDigests,
        },
      ];
    report.caseResults = report.caseResults.map((r) =>
      rehash(r, "resultDigest"),
    );
    report.evaluationResultSetDigest = digestCanonicalValue(
      report.caseResults.map((r) => r.resultDigest),
    );
    report.authorityBindingSetDigest = digestCanonicalValue(
      report.authorityBindings.map((b) => b.authorityTupleDigest),
    );
    report = rehash(report, "reportDigest");
    expect(modelEvaluationReportV2Schema.safeParse(report).success).toBe(false);
  });
  it("does not reinterpret malformed non-operational counts as permitted overruns", () => {
    const result = projectModelLiveEvaluationCaseV2(firstCase());
    const score = result.scores.find(
      (s) => s.dimension === "structured-schema-validity",
    );
    if (!score) throw Error("Missing score");
    score.numerator = 2;
    score.basisPoints = 20000;
    expect(modelDeterministicScoreV2Schema.safeParse(score).success).toBe(
      false,
    );
    expect(
      modelEvaluationCaseResultV2Schema.safeParse(
        rehash(result, "resultDigest"),
      ).success,
    ).toBe(false);
  });
});

it("projects the exact preissued successor policy without changing arithmetic or activating capability", () => {
  const historical = projectModelLiveEvaluationReportV2(fixture()).report;
  const successor = projectModelLiveEvaluationReportV2(
    fixture(false, fullBetaEventEvaluationPolicyV2),
  ).report;
  expect(successor).toMatchObject(fullBetaEventEvaluationPolicyV2);
  expect(successor).toMatchObject({
    capabilityActivated: false,
    activationRecommendation: "hold",
  });
  expect(successor.caseResults).toEqual(historical.caseResults);
  expect(successor.deterministicQualityBasisPoints).toBe(
    historical.deterministicQualityBasisPoints,
  );
});
