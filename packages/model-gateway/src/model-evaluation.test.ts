import { describe, expect, it } from "vitest";

import {
  digestCanonicalValue,
  digestModelEvaluationAuthorityTupleV1,
  digestModelLiveEvaluationAuthorityV1,
  modelDeterministicScoreDimensionV1Values,
  modelEvaluationCaseKindV1Values,
  modelLiveEvaluationAuthorityV1Schema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  utcTimestampSchema,
  type ModelEvaluationAuthorityBindingV1,
  type ModelEvaluationCaseV1,
  type ModelEvaluationDatasetV1,
  type ModelEvaluationReportV1,
  type ModelLiveEvaluationAuthorityV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import {
  FrozenSyntheticModelEvaluationAdapterV1,
  defaultModelEvaluationPolicyDigestV1,
  formatModelEvaluationReportSummaryV1,
  frozenModelEvaluationAuthorityBindingsV1,
  frozenModelEvaluationDatasetV1,
  modelEvaluationAdapterDescriptorV1Schema,
  modelEvaluationDefaultsV1,
  modelEvaluationOperationalBudgetsV1,
  modelEvaluationScoringPolicyV1,
  runFrozenDeterministicModelEvaluationV1,
  runModelEvaluationDatasetV1,
  type ModelEvaluationAdapterV1,
  type ModelEvaluationJudgeV1,
  type ModelEvaluationObservationV1,
} from "./model-evaluation.js";

const STARTED_AT = utcTimestampSchema.parse("2026-08-22T12:00:00.000Z");
const FINISHED_AT = utcTimestampSchema.parse("2026-08-22T12:00:01.000Z");
const RUNTIME_POLICY_REFERENCE = {
  policyId: namespacedIdentifierSchema.parse(
    "cloudmarkup.model-runtime.prompt-38",
  ),
  policyVersion: semanticVersionSchema.parse("1.0.0"),
} as const;
const RUNTIME_POLICY = {
  ...RUNTIME_POLICY_REFERENCE,
  runtimeControlConfigurationDigest: digestCanonicalValue(
    RUNTIME_POLICY_REFERENCE,
  ),
} as const;

function clock() {
  const values = [STARTED_AT, FINISHED_AT];
  let index = 0;
  return {
    now: () => values[Math.min(index++, values.length - 1)] ?? FINISHED_AT,
  };
}

function deterministicRun(input?: {
  adapter?: ModelEvaluationAdapterV1;
  authorityBindings?: readonly ModelEvaluationAuthorityBindingV1[];
  baselineReport?: ModelEvaluationReportV1;
  dataset?: ModelEvaluationDatasetV1;
  evaluationPolicyDigest?: Sha256Digest;
  judge?: ModelEvaluationJudgeV1;
  signal?: AbortSignal;
}) {
  return runModelEvaluationDatasetV1({
    adapter: input?.adapter ?? new FrozenSyntheticModelEvaluationAdapterV1(),
    authorityBindings:
      input?.authorityBindings ?? frozenModelEvaluationAuthorityBindingsV1,
    ...(input?.baselineReport === undefined
      ? {}
      : { baselineReport: input.baselineReport }),
    clock: clock(),
    dataset: input?.dataset ?? frozenModelEvaluationDatasetV1,
    evaluationPolicyDigest:
      input?.evaluationPolicyDigest ?? defaultModelEvaluationPolicyDigestV1,
    evaluationPolicyId: modelEvaluationDefaultsV1.evaluationPolicyId,
    evaluationPolicyVersion: modelEvaluationDefaultsV1.evaluationPolicyVersion,
    ...(input?.judge === undefined ? {} : { judge: input.judge }),
    mode: "deterministic",
    ...(input?.signal === undefined ? {} : { signal: input.signal }),
  });
}

function rehashCase(evaluationCase: ModelEvaluationCaseV1): void {
  const draft = { ...evaluationCase };
  delete (draft as Partial<ModelEvaluationCaseV1>).caseDigest;
  evaluationCase.caseDigest = digestCanonicalValue(draft);
}

function rehashDataset(dataset: ModelEvaluationDatasetV1): void {
  const draft = { ...dataset };
  delete (draft as Partial<ModelEvaluationDatasetV1>).datasetDigest;
  dataset.datasetDigest = digestCanonicalValue(draft);
}

function transformingAdapter(
  transform: (
    value: ModelEvaluationObservationV1,
  ) => ModelEvaluationObservationV1 | Readonly<Record<string, unknown>>,
): ModelEvaluationAdapterV1 {
  const base = new FrozenSyntheticModelEvaluationAdapterV1();
  return {
    descriptor: base.descriptor,
    async evaluateCase(input) {
      return transform(await base.evaluateCase(input));
    },
  };
}

const bindingModelReferences = [
  ...new Set(
    frozenModelEvaluationAuthorityBindingsV1.map(
      ({ authorityTuple }) => authorityTuple.modelConfigurationReference,
    ),
  ),
].sort();
const bindingPromptDigests = [
  ...new Set(
    frozenModelEvaluationAuthorityBindingsV1.map(
      ({ authorityTuple }) => authorityTuple.promptTemplateDigest,
    ),
  ),
].sort();

class DirectLiveAdapterProbeV1 implements ModelEvaluationAdapterV1 {
  public calls = 0;

  public readonly descriptor = modelEvaluationAdapterDescriptorV1Schema.parse({
    adapterId: "cloudmarkup.model-evaluation.direct-live-adapter-probe",
    adapterVersion: "1.0.0",
    executionMode: "live",
    honorsLiveCaseAuthority: true,
    modelConfigurationReferences: bindingModelReferences,
    promptTemplateDigests: bindingPromptDigests,
  });

  public evaluateCase(): Promise<never> {
    this.calls += 1;
    return Promise.reject(
      new Error("Direct live adapter probe must never be invoked."),
    );
  }
}

class DirectLiveJudgeProbeV1 implements ModelEvaluationJudgeV1 {
  public calls = 0;

  public readonly descriptor = modelEvaluationAdapterDescriptorV1Schema.parse({
    adapterId: "cloudmarkup.model-evaluation.direct-live-judge-probe",
    adapterVersion: "1.0.0",
    executionMode: "live",
    honorsLiveCaseAuthority: true,
    modelConfigurationReferences: bindingModelReferences,
    promptTemplateDigests: bindingPromptDigests,
  });

  public scoreCase(): Promise<readonly never[]> {
    this.calls += 1;
    return Promise.resolve([]);
  }
}

function liveAuthority(
  overrides?: Partial<Omit<ModelLiveEvaluationAuthorityV1, "authorityDigest">>,
): ModelLiveEvaluationAuthorityV1 {
  const draft = {
    approved: true as const,
    authorityId: "live_eval_authority_one",
    canonicalCommercialAuthority: "canonical-commercial-v1" as const,
    contractVersion: 1 as const,
    createdAt: utcTimestampSchema.parse("2026-08-22T11:59:00.000Z"),
    datasetCaseDigests: frozenModelEvaluationDatasetV1.cases.map(
      ({ caseDigest }) => caseDigest,
    ),
    datasetDigest: frozenModelEvaluationDatasetV1.datasetDigest,
    environment: "staging" as const,
    evaluationPolicyDigest: defaultModelEvaluationPolicyDigestV1,
    evaluationPolicyId: namespacedIdentifierSchema.parse(
      modelEvaluationDefaultsV1.evaluationPolicyId,
    ),
    evaluationPolicyVersion: semanticVersionSchema.parse(
      modelEvaluationDefaultsV1.evaluationPolicyVersion,
    ),
    expiresAt: utcTimestampSchema.parse("2026-08-22T12:10:00.000Z"),
    killSwitchEngaged: false as const,
    limits: {
      maximumConcurrentJobs: 1,
      maximumCreditUnits: 42,
      maximumEstimatedMicroUsd: 2_310,
      maximumInputTokens: 4_830,
      maximumInvocations: 21,
      maximumOutputTokens: 1_470,
      maximumTotalTokens: 6_300,
    },
    modelConfigurationReferences: bindingModelReferences,
    normalCi: false as const,
    optIn: true as const,
    organizationId: "organization_eval_one",
    promptTemplateDigests: bindingPromptDigests,
    recordKind: "model-live-evaluation-authority" as const,
    runtimeControlConfigurationDigest:
      RUNTIME_POLICY.runtimeControlConfigurationDigest,
    runtimePolicyId: RUNTIME_POLICY.policyId,
    runtimePolicyVersion: RUNTIME_POLICY.policyVersion,
    ...overrides,
  };
  return modelLiveEvaluationAuthorityV1Schema.parse({
    ...draft,
    authorityDigest: digestModelLiveEvaluationAuthorityV1(draft),
  });
}

function liveRun(input: {
  adapter: DirectLiveAdapterProbeV1;
  authority?: ModelLiveEvaluationAuthorityV1;
  judge?: ModelEvaluationJudgeV1;
  runtimePolicy?: typeof RUNTIME_POLICY;
}) {
  return runModelEvaluationDatasetV1({
    adapter: input.adapter,
    authorityBindings: frozenModelEvaluationAuthorityBindingsV1,
    clock: clock(),
    dataset: frozenModelEvaluationDatasetV1,
    evaluationPolicyDigest: defaultModelEvaluationPolicyDigestV1,
    evaluationPolicyId: modelEvaluationDefaultsV1.evaluationPolicyId,
    evaluationPolicyVersion: modelEvaluationDefaultsV1.evaluationPolicyVersion,
    ...(input.judge === undefined ? {} : { judge: input.judge }),
    ...(input.authority === undefined
      ? {}
      : { liveAuthority: input.authority }),
    ...(input.runtimePolicy === undefined
      ? {}
      : { liveRuntimePolicy: input.runtimePolicy }),
    mode: "live",
  });
}

describe("deterministic model evaluation harness contract smoke", () => {
  it("freezes all 21 cases and contract-smoke scores all 19 dimensions", async () => {
    expect(
      frozenModelEvaluationDatasetV1.cases.map(({ caseKind }) => caseKind),
    ).toEqual(modelEvaluationCaseKindV1Values);
    expect(
      frozenModelEvaluationDatasetV1.requiredDeterministicDimensions,
    ).toEqual(modelDeterministicScoreDimensionV1Values);

    const { report, aggregate } =
      await runFrozenDeterministicModelEvaluationV1();
    expect(report.caseResults).toHaveLength(21);
    expect(aggregate.dimensionAggregates).toHaveLength(19);
    for (const result of report.caseResults) {
      expect(result.scores).toHaveLength(19);
      expect(result.authorityRequirementDigest).toBeDefined();
      expect(result.authorityTupleDigest).toBeDefined();
    }
    expect(report.authorityBindings.length).toBeGreaterThan(1);
    expect(report.deterministicPassed).toBe(true);
    expect(report.activationRecommendation).toBe("hold");
    expect(report.capabilityActivated).toBe(false);
    expect(report.normalCi).toBe(true);
  });

  it("retains unsupported image-event and private-VPC requests honestly", () => {
    for (const caseKind of [
      "event-driven-image-processing",
      "private-vpc-application",
    ] as const) {
      const evaluationCase = frozenModelEvaluationDatasetV1.cases.find(
        (candidate) => candidate.caseKind === caseKind,
      );
      expect(evaluationCase?.expected).toMatchObject({
        disposition: "retain-unresolved",
        expectedIssueSeverity: "error",
        generationTarget: "none",
      });
      expect(evaluationCase?.expected.requiredSafetyOutcomes).toEqual(
        expect.arrayContaining([
          "reject-unsupported-service",
          "unresolved-honestly",
        ]),
      );
      expect(evaluationCase?.targetDimensions).not.toContain(
        "application-generation-build-test-success",
      );
    }
  });

  it("produces a content-stable report, aggregate, and safe printer output", async () => {
    const first = await runFrozenDeterministicModelEvaluationV1();
    const second = await runFrozenDeterministicModelEvaluationV1();

    expect(second).toEqual(first);
    expect(second.report.reportDigest).toBe(first.report.reportDigest);
    expect(second.aggregate.aggregateDigest).toBe(
      first.aggregate.aggregateDigest,
    );
    expect(formatModelEvaluationReportSummaryV1(second)).toBe(
      formatModelEvaluationReportSummaryV1(first),
    );
    expect(formatModelEvaluationReportSummaryV1(first)).toContain(
      '"authority": "observation-only-not-accounting"',
    );
  });

  it.each([
    [
      "malformed",
      transformingAdapter((observation) => ({
        adapterId: observation.adapterId,
      })),
      "model-evaluation.invalid-observation",
    ],
    [
      "partial",
      transformingAdapter((observation) => ({
        ...observation,
        measurements: observation.measurements.slice(1),
      })),
      "model-evaluation.measurement-coverage-mismatch",
    ],
    [
      "secret-shaped",
      transformingAdapter((observation) => ({
        ...observation,
        leakedValue: "password=synthetic-evaluation-marker",
      })),
      "model-evaluation.sensitive-observation",
    ],
  ])("rejects %s adapter observations", async (_label, adapter, code) => {
    await expect(deterministicRun({ adapter })).rejects.toMatchObject({ code });
  });

  it("binds the default policy digest to the exact frozen dataset tuple", () => {
    const expected = digestCanonicalValue({
      datasetDigest: frozenModelEvaluationDatasetV1.datasetDigest,
      datasetId: frozenModelEvaluationDatasetV1.datasetId,
      datasetVersion: frozenModelEvaluationDatasetV1.datasetVersion,
      evaluationPolicyId: modelEvaluationDefaultsV1.evaluationPolicyId,
      evaluationPolicyVersion:
        modelEvaluationDefaultsV1.evaluationPolicyVersion,
      operationalBudgets: modelEvaluationOperationalBudgetsV1,
      scoringPolicy: modelEvaluationScoringPolicyV1,
    });
    expect(defaultModelEvaluationPolicyDigestV1).toBe(expected);
    expect(defaultModelEvaluationPolicyDigestV1).not.toBe(
      digestCanonicalValue({
        datasetDigest: digestCanonicalValue("different-dataset"),
        datasetId: frozenModelEvaluationDatasetV1.datasetId,
        datasetVersion: frozenModelEvaluationDatasetV1.datasetVersion,
        evaluationPolicyId: modelEvaluationDefaultsV1.evaluationPolicyId,
        evaluationPolicyVersion:
          modelEvaluationDefaultsV1.evaluationPolicyVersion,
        operationalBudgets: modelEvaluationOperationalBudgetsV1,
        scoringPolicy: modelEvaluationScoringPolicyV1,
      }),
    );
  });

  it("freezes and enforces reviewed operational denominators", async () => {
    expect(Object.isFrozen(modelEvaluationOperationalBudgetsV1)).toBe(true);
    expect(modelEvaluationOperationalBudgetsV1).toEqual({
      credits: 100,
      "estimated-cost": 10_000,
      latency: 1_000,
      tokens: 5_000,
    });

    await expect(
      deterministicRun({
        adapter: transformingAdapter((observation) => ({
          ...observation,
          measurements: observation.measurements.map((measurement) =>
            measurement.dimension === "credits"
              ? {
                  ...measurement,
                  denominator: modelEvaluationOperationalBudgetsV1.credits - 1,
                }
              : measurement,
          ),
        })),
      }),
    ).rejects.toMatchObject({
      code: "model-evaluation.invalid-operational-denominator",
    });
  });

  it.each(["credits", "estimated-cost", "latency", "tokens"] as const)(
    "fails a schema-valid %s threshold breach against the fixed normalization denominator",
    async (dimension) => {
      const denominator = modelEvaluationOperationalBudgetsV1[dimension];
      const thresholdBasisPoints =
        modelEvaluationScoringPolicyV1[dimension].thresholdBasisPoints;
      const thresholdBreachValue =
        Math.floor((denominator * thresholdBasisPoints) / 10_000) + 1;
      const result = await deterministicRun({
        adapter: transformingAdapter((observation) => {
          const operationalUsage = {
            ...observation.operationalUsage,
            ...(dimension === "credits"
              ? { creditUnits: thresholdBreachValue }
              : {}),
            ...(dimension === "estimated-cost"
              ? { estimatedMicroUsd: thresholdBreachValue }
              : {}),
            ...(dimension === "latency"
              ? { latencyMilliseconds: thresholdBreachValue }
              : {}),
            ...(dimension === "tokens"
              ? {
                  inputTokens: thresholdBreachValue,
                  outputTokens: 0,
                  totalTokens: thresholdBreachValue,
                }
              : {}),
          };
          return {
            ...observation,
            measurements: observation.measurements.map((measurement) =>
              measurement.dimension === dimension
                ? { ...measurement, numerator: thresholdBreachValue }
                : measurement,
            ),
            operationalUsage,
          };
        }),
      });

      expect(result.report.deterministicPassed).toBe(false);
      expect(
        result.report.caseResults.every((caseResult) => {
          const score = caseResult.scores.find(
            (candidate) => candidate.dimension === dimension,
          );
          return (
            score?.applicable === true &&
            score.denominator === denominator &&
            score.numerator === thresholdBreachValue &&
            score.basisPoints > thresholdBasisPoints &&
            !score.passed
          );
        }),
      ).toBe(true);
    },
  );

  it("rejects a schema-valid self-rehashed dataset before adapter invocation", async () => {
    const dataset = structuredClone(frozenModelEvaluationDatasetV1);
    const firstCase = dataset.cases[0];
    expect(firstCase).toBeDefined();
    if (firstCase === undefined) return;
    firstCase.input.requirements =
      firstCase.input.requirements + " Keep this synthetic mutation bounded.";
    rehashCase(firstCase);
    rehashDataset(dataset);
    expect(modelEvaluationDefaultsV1.evaluationPolicyDigest).toBe(
      defaultModelEvaluationPolicyDigestV1,
    );

    const base = new FrozenSyntheticModelEvaluationAdapterV1();
    let calls = 0;
    const adapter: ModelEvaluationAdapterV1 = {
      descriptor: base.descriptor,
      async evaluateCase(input) {
        calls += 1;
        return base.evaluateCase(input);
      },
    };

    await expect(deterministicRun({ adapter, dataset })).rejects.toMatchObject({
      code: "model-evaluation.deterministic-fake-dataset-mismatch",
    });
    expect(calls).toBe(0);
  });

  it("rejects a self-rehashed uncovered dataset before adapter invocation", async () => {
    const dataset = structuredClone(frozenModelEvaluationDatasetV1);
    const removedDimension =
      "terraform-cloudformation-validation-security-success";
    for (const evaluationCase of dataset.cases) {
      if (evaluationCase.targetDimensions.includes(removedDimension)) {
        evaluationCase.targetDimensions =
          evaluationCase.targetDimensions.filter(
            (dimension) => dimension !== removedDimension,
          );
        rehashCase(evaluationCase);
      }
    }
    rehashDataset(dataset);

    const base = new FrozenSyntheticModelEvaluationAdapterV1();
    let calls = 0;
    const adapter: ModelEvaluationAdapterV1 = {
      descriptor: base.descriptor,
      async evaluateCase(input) {
        calls += 1;
        return base.evaluateCase(input);
      },
    };

    await expect(deterministicRun({ adapter, dataset })).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("rejects a noncanonical deterministic policy before adapter invocation", async () => {
    const base = new FrozenSyntheticModelEvaluationAdapterV1();
    let calls = 0;
    const adapter: ModelEvaluationAdapterV1 = {
      descriptor: base.descriptor,
      async evaluateCase(input) {
        calls += 1;
        return base.evaluateCase(input);
      },
    };

    await expect(
      deterministicRun({
        adapter,
        evaluationPolicyDigest: digestCanonicalValue(
          "noncanonical-evaluation-policy",
        ),
      }),
    ).rejects.toMatchObject({
      code: "model-evaluation.deterministic-fake-policy-mismatch",
    });
    expect(calls).toBe(0);
  });

  it("rejects non-fake deterministic authority before adapter invocation", async () => {
    const original = frozenModelEvaluationAuthorityBindingsV1[0];
    expect(original).toBeDefined();
    if (original === undefined) return;
    const authorityTuple = {
      ...original.authorityTuple,
      modelConfigurationReference: namespacedIdentifierSchema.parse(
        "cloudmarkup.model-evaluation.runtime-route",
      ),
    };
    const authorityBindings = frozenModelEvaluationAuthorityBindingsV1.map(
      (binding, index) =>
        index === 0
          ? {
              authorityTuple,
              authorityTupleDigest:
                digestModelEvaluationAuthorityTupleV1(authorityTuple),
            }
          : binding,
    );
    const base = new FrozenSyntheticModelEvaluationAdapterV1();
    let calls = 0;
    const adapter: ModelEvaluationAdapterV1 = {
      descriptor: base.descriptor,
      async evaluateCase(input) {
        calls += 1;
        return base.evaluateCase(input);
      },
    };

    await expect(
      deterministicRun({ adapter, authorityBindings }),
    ).rejects.toMatchObject({
      code: "model-evaluation.deterministic-fake-authority-mismatch",
    });
    expect(calls).toBe(0);
  });

  it("derives same-UI scoring from Guided and Professional semantic results", async () => {
    const result = await deterministicRun({
      adapter: transformingAdapter((observation) => ({
        ...observation,
        assistancePreferenceSemantics:
          observation.assistancePreferenceSemantics.map((semantic) =>
            semantic.assistancePreference === "professional"
              ? {
                  ...semantic,
                  semanticDigest: frozenModelEvaluationDatasetV1.datasetDigest,
                }
              : semantic,
          ),
        measurements: observation.measurements.map((measurement) =>
          measurement.dimension ===
          "same-ui-semantics-across-assistance-preferences"
            ? {
                ...measurement,
                evidenceDigests: [frozenModelEvaluationDatasetV1.datasetDigest],
                numerator: 0,
              }
            : measurement,
        ),
      })),
    });

    expect(result.report.deterministicPassed).toBe(false);
    expect(
      result.report.caseResults.every((caseResult) =>
        caseResult.scores.some(
          (score) =>
            score.dimension ===
              "same-ui-semantics-across-assistance-preferences" &&
            score.applicable &&
            !score.passed,
        ),
      ),
    ).toBe(true);
  });

  it("rejects a self-awarded same-UI pass when semantic digests differ", async () => {
    await expect(
      deterministicRun({
        adapter: transformingAdapter((observation) => ({
          ...observation,
          assistancePreferenceSemantics:
            observation.assistancePreferenceSemantics.map((semantic) =>
              semantic.assistancePreference === "professional"
                ? {
                    ...semantic,
                    semanticDigest:
                      frozenModelEvaluationDatasetV1.datasetDigest,
                  }
                : semantic,
            ),
        })),
      }),
    ).rejects.toMatchObject({ code: "model-evaluation.invalid-observation" });
  });

  it("keeps optional judge scores non-authoritative", async () => {
    const judge: ModelEvaluationJudgeV1 = {
      descriptor: modelEvaluationAdapterDescriptorV1Schema.parse({
        adapterId: "cloudmarkup.model-evaluation.optional-fake-judge",
        adapterVersion: "1.0.0",
        executionMode: "deterministic-fake",
        honorsLiveCaseAuthority: false,
        modelConfigurationReferences: [],
        promptTemplateDigests: [],
      }),
      scoreCase({ evaluationCase, outputDigest }) {
        return Promise.resolve([
          {
            authority: "non-authoritative",
            basisPoints: 0,
            judgeInvocationDigest: outputDigest,
            judgeModelConfigurationReference:
              "cloudmarkup.model-evaluation.fake-judge",
            label: "clarity",
            noRawPromptOrResponse: true,
            rationaleDigest: evaluationCase.caseDigest,
          },
        ]);
      },
    };
    const result = await deterministicRun({ judge });

    expect(result.report.deterministicPassed).toBe(true);
    expect(
      result.report.caseResults.every(
        ({ deterministicPassed }) => deterministicPassed,
      ),
    ).toBe(true);
    expect(
      result.report.caseResults.every(
        ({ judgeScores }) => judgeScores.length === 1,
      ),
    ).toBe(true);
    expect(result.report.caseResults[0]?.judgeScores[0]).toMatchObject({
      authority: "non-authoritative",
    });
  });

  it("reports deterministic regressions using each score direction", async () => {
    const baseline = (await deterministicRun()).report;
    const regressed = await deterministicRun({
      adapter: transformingAdapter((observation) => ({
        ...observation,
        measurements: observation.measurements.map((measurement) =>
          measurement.dimension === "structured-schema-validity"
            ? { ...measurement, numerator: 0 }
            : measurement.dimension === "security-policy-violations"
              ? { ...measurement, numerator: measurement.denominator }
              : measurement,
        ),
      })),
      baselineReport: baseline,
    });

    expect(regressed.aggregate.regressionCount).toBeGreaterThan(0);
    expect(regressed.aggregate.regressionDeltas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: "structured-schema-validity",
          deltaBasisPoints: -10_000,
          regressed: true,
        }),
        expect.objectContaining({
          dimension: "security-policy-violations",
          deltaBasisPoints: 10_000,
          regressed: true,
        }),
      ]),
    );
  });

  it("cancels before adapter invocation", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const base = new FrozenSyntheticModelEvaluationAdapterV1();
    const adapter: ModelEvaluationAdapterV1 = {
      descriptor: base.descriptor,
      async evaluateCase(input) {
        calls += 1;
        return base.evaluateCase(input);
      },
    };

    await expect(
      deterministicRun({ adapter, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "model-evaluation.cancelled" });
    expect(calls).toBe(0);
  });
  it("cancels after an in-flight adapter returns and skips the judge", async () => {
    const controller = new AbortController();
    const base = new FrozenSyntheticModelEvaluationAdapterV1();
    let adapterCalls = 0;
    let judgeCalls = 0;
    const adapter: ModelEvaluationAdapterV1 = {
      descriptor: base.descriptor,
      async evaluateCase(input) {
        adapterCalls += 1;
        const observation = await base.evaluateCase(input);
        controller.abort();
        return observation;
      },
    };
    const judge: ModelEvaluationJudgeV1 = {
      descriptor: modelEvaluationAdapterDescriptorV1Schema.parse({
        adapterId: "cloudmarkup.model-evaluation.cancelled-fake-judge",
        adapterVersion: "1.0.0",
        executionMode: "deterministic-fake",
        honorsLiveCaseAuthority: false,
        modelConfigurationReferences: [],
        promptTemplateDigests: [],
      }),
      scoreCase() {
        judgeCalls += 1;
        return Promise.resolve([]);
      },
    };

    await expect(
      deterministicRun({ adapter, judge, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "model-evaluation.cancelled" });
    expect(adapterCalls).toBe(1);
    expect(judgeCalls).toBe(0);
  });

  it("cancels after an in-flight judge returns", async () => {
    const controller = new AbortController();
    let judgeCalls = 0;
    const judge: ModelEvaluationJudgeV1 = {
      descriptor: modelEvaluationAdapterDescriptorV1Schema.parse({
        adapterId: "cloudmarkup.model-evaluation.aborting-fake-judge",
        adapterVersion: "1.0.0",
        executionMode: "deterministic-fake",
        honorsLiveCaseAuthority: false,
        modelConfigurationReferences: [],
        promptTemplateDigests: [],
      }),
      scoreCase() {
        judgeCalls += 1;
        controller.abort();
        return Promise.resolve([]);
      },
    };

    await expect(
      deterministicRun({ judge, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "model-evaluation.cancelled" });
    expect(judgeCalls).toBe(1);
  });

  it("cancels when the signal changes at the final report boundary", async () => {
    const controller = new AbortController();
    let clockCalls = 0;

    await expect(
      runModelEvaluationDatasetV1({
        adapter: new FrozenSyntheticModelEvaluationAdapterV1(),
        authorityBindings: frozenModelEvaluationAuthorityBindingsV1,
        clock: {
          now() {
            clockCalls += 1;
            if (clockCalls === 2) controller.abort();
            return clockCalls === 1 ? STARTED_AT : FINISHED_AT;
          },
        },
        dataset: frozenModelEvaluationDatasetV1,
        evaluationPolicyDigest: defaultModelEvaluationPolicyDigestV1,
        evaluationPolicyId: modelEvaluationDefaultsV1.evaluationPolicyId,
        evaluationPolicyVersion:
          modelEvaluationDefaultsV1.evaluationPolicyVersion,
        mode: "deterministic",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "model-evaluation.cancelled" });
    expect(clockCalls).toBe(2);
  });
});

describe("opt-in live evaluation authority seam", () => {
  const portRequired = {
    code: "model-evaluation.live-execution-port-required",
  } as const;

  it("treats exact opt-in authority as necessary but insufficient without the host execution port", async () => {
    const adapter = new DirectLiveAdapterProbeV1();
    const judge = new DirectLiveJudgeProbeV1();

    await expect(
      liveRun({
        adapter,
        authority: liveAuthority(),
        judge,
        runtimePolicy: RUNTIME_POLICY,
      }),
    ).rejects.toMatchObject(portRequired);
    expect(adapter.calls).toBe(0);
    expect(judge.calls).toBe(0);
  });

  it("does not invoke or double-count an exact authority replayed sequentially", async () => {
    const adapter = new DirectLiveAdapterProbeV1();
    const authority = liveAuthority();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        liveRun({ adapter, authority, runtimePolicy: RUNTIME_POLICY }),
      ).rejects.toMatchObject(portRequired);
    }
    expect(adapter.calls).toBe(0);
  });

  it("does not let parallel authority reuse bypass the unavailable concurrency fence", async () => {
    const adapter = new DirectLiveAdapterProbeV1();
    const authority = liveAuthority();

    await Promise.all(
      Array.from({ length: 2 }, async () =>
        expect(
          liveRun({ adapter, authority, runtimePolicy: RUNTIME_POLICY }),
        ).rejects.toMatchObject(portRequired),
      ),
    );
    expect(adapter.calls).toBe(0);
  });
});
