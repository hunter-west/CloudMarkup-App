import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
} from "./architecture-document-v1.js";
import { digestCanonicalValue, sha256Text } from "./canonical-digest.js";
import {
  digestModelEvaluationAuthorityTupleV1,
  digestModelRuntimeControlConfigurationV1,
  digestModelRuntimeHostEvidenceV1,
  digestModelRuntimeInputEvidenceV1,
  generateModelEvaluationV1JsonSchema,
  modelDeterministicScoreDimensionV1Values,
  modelDeterministicScoreV1Schema,
  modelEvaluationCaseResultV1Schema,
  modelEvaluationContractV1Schema,
  modelEvaluationDatasetV1Schema,
  modelEvaluationMandatoryCaseDimensionV1Values,
  modelEvaluationReportV1Schema,
  modelLiveEvaluationAuthorityV1Schema,
  modelRuntimeAdmissionDecisionV1Schema,
  modelRuntimeAdmissionRequestV1Schema,
  modelRuntimeControlPolicyV1Schema,
  modelRuntimeHostEvidenceV1Schema,
  modelRuntimeInputEvidenceV1Schema,
  modelRuntimeMetricV1Schema,
  modelRuntimeStateSnapshotV1Schema,
  type ModelEvaluationCaseV1,
  type ModelEvaluationDatasetV1,
  type ModelEvaluationAuthorityRequirementV1,
  type ModelEvaluationReportV1,
  type ModelRuntimeControlPolicyV1,
} from "./model-evaluation-v1.js";

let frozenDataset: ModelEvaluationDatasetV1;

beforeAll(async () => {
  frozenDataset = modelEvaluationDatasetV1Schema.parse(
    JSON.parse(
      await readFile(
        new URL(
          "../../../evals/datasets-v1/model-evaluation-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
});

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}.`);
  return value;
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

function score(
  dimension: (typeof modelDeterministicScoreDimensionV1Values)[number],
) {
  const lowerIsBetter = new Set([
    "unsupported-service-field-rate",
    "graph-workload-external-rule-violations",
    "security-policy-violations",
    "latency",
    "tokens",
    "credits",
    "estimated-cost",
  ]).has(dimension);
  return {
    applicable: true,
    authority: "deterministic",
    basisPoints: lowerIsBetter ? 0 : 10_000,
    denominator: 1,
    dimension,
    direction: lowerIsBetter ? "lower-is-better" : "higher-is-better",
    evidenceDigests: [sha256Text(`evidence:${dimension}`)],
    numerator: lowerIsBetter ? 0 : 1,
    passed: true,
    thresholdBasisPoints: lowerIsBetter ? 0 : 10_000,
    toolId: "cloudmarkup.eval.deterministic-scorer",
    toolVersion: "1.0.0",
  } as const;
}

function authorityBinding(requirement: ModelEvaluationAuthorityRequirementV1) {
  const authorityTuple = {
    capabilityRegistryDigest: sha256Text("capability-registry"),
    catalogDigest: sha256Text("catalog"),
    inferenceProfileId: namespacedIdentifierSchema.parse(
      "inference.fake.prompt38",
    ),
    modelConfigurationReference: namespacedIdentifierSchema.parse(
      `model.fake.${requirement.role}`,
    ),
    operation: requirement.operation,
    promptTemplateDigest: sha256Text(
      `prompt-template:${requirement.operation}:${requirement.role}`,
    ),
    promptTemplateId: namespacedIdentifierSchema.parse(
      `cloudmarkup.prompt.${requirement.operation.replace(".", "-")}`,
    ),
    promptTemplateVersion: semanticVersionSchema.parse("1.0.0"),
    responseSchemaDigest: sha256Text(
      `response-schema:${requirement.operation}`,
    ),
    role: requirement.role,
    routeDefinitionDigest: sha256Text(`route-definition:${requirement.role}`),
    routeRegistryDigest: sha256Text("route-registry"),
  };
  return {
    authorityTuple,
    authorityTupleDigest: digestModelEvaluationAuthorityTupleV1(authorityTuple),
  };
}

function caseResult(
  evaluationCase: ModelEvaluationCaseV1,
  binding: ReturnType<typeof authorityBinding>,
  withJudge = false,
) {
  const scores = modelDeterministicScoreDimensionV1Values.map(score);
  const result = {
    authorityRequirement: evaluationCase.expected.authorityRequirement,
    authorityRequirementDigest:
      evaluationCase.expected.authorityRequirementDigest,
    authorityTupleDigest: binding.authorityTupleDigest,
    caseDigest: evaluationCase.caseDigest,
    caseId: evaluationCase.caseId,
    contractVersion: 1,
    deterministicPassed: true,
    evidenceDigests: [
      ...new Set(scores.flatMap((entry) => entry.evidenceDigests)),
    ],
    judgeScores: withJudge
      ? [
          {
            authority: "non-authoritative" as const,
            basisPoints: 1,
            judgeInvocationDigest: sha256Text("judge-invocation"),
            judgeModelConfigurationReference: "model.fake.judge",
            label: "clarity" as const,
            noRawPromptOrResponse: true as const,
            rationaleDigest: sha256Text("judge-rationale"),
          },
        ]
      : [],
    outputDigest: sha256Text(`output:${evaluationCase.caseId}`),
    recordKind: "model-evaluation-case-result" as const,
    safeErrorCodes: [],
    scores,
  };
  return modelEvaluationCaseResultV1Schema.parse({
    ...result,
    resultDigest: digestCanonicalValue(result),
  });
}

function report(
  dataset: ModelEvaluationDatasetV1,
  options: { withJudge?: boolean } = {},
): ModelEvaluationReportV1 {
  const bindingByClass = new Map<string, ReturnType<typeof authorityBinding>>();
  for (const evaluationCase of dataset.cases) {
    const requirement = evaluationCase.expected.authorityRequirement;
    const key = `${requirement.operation}\u0000${requirement.role}`;
    bindingByClass.set(key, authorityBinding(requirement));
  }
  const authorityBindings = [...bindingByClass.values()];
  const results = dataset.cases.map((evaluationCase, index) => {
    const requirement = evaluationCase.expected.authorityRequirement;
    const binding = bindingByClass.get(
      `${requirement.operation}\u0000${requirement.role}`,
    );
    if (binding === undefined)
      throw new Error("Missing test authority binding.");
    return caseResult(
      evaluationCase,
      binding,
      options.withJudge === true && index === 0,
    );
  });
  const value = {
    activationRecommendation: "hold" as const,
    authorityBindings,
    authorityBindingSetDigest: digestCanonicalValue(
      authorityBindings.map((binding) => binding.authorityTupleDigest),
    ),
    capabilityActivated: false as const,
    caseResults: results,
    contractVersion: 1 as const,
    datasetCaseDigests: dataset.cases.map(
      (evaluationCase) => evaluationCase.caseDigest,
    ),
    datasetDigest: dataset.datasetDigest,
    deterministicPassed: true,
    deterministicQualityBasisPoints: 10_000,
    environment: "test" as const,
    evaluationPolicyDigest: sha256Text("evaluation-policy"),
    evaluationPolicyId: "cloudmarkup.eval.policy.prompt38",
    evaluationPolicyVersion: "1.0.0" as const,
    evaluationReportId: "eval-report.prompt38",
    evaluationResultSetDigest: digestCanonicalValue(
      results.map((result) => result.resultDigest),
    ),
    executionMode: "deterministic-fake" as const,
    finishedAt: "2026-08-22T12:01:00.000Z",
    normalCi: true,
    recordKind: "model-evaluation-report" as const,
    regressions: [],
    startedAt: "2026-08-22T12:00:00.000Z",
  };
  return modelEvaluationReportV1Schema.parse({
    ...value,
    reportDigest: digestCanonicalValue(value),
  });
}

function runtimePolicy(
  evaluationReport: ModelEvaluationReportV1,
): ModelRuntimeControlPolicyV1 {
  const selectedBinding =
    evaluationReport.authorityBindings.find(
      (binding) =>
        binding.authorityTuple.operation === "architecture.propose" &&
        binding.authorityTuple.role === "standard-planning-generation",
    ) ?? evaluationReport.authorityBindings[0];
  if (selectedBinding === undefined) {
    throw new Error("Missing evaluated authority binding.");
  }
  const value = {
    administrativeSuspensions: [],
    allowlists: {
      dependencies: ["zod"],
      modelConfigurationReferences: [
        selectedBinding.authorityTuple.modelConfigurationReference,
      ],
      modules: ["registry.example/approved/module"],
      providers: ["registry.example/approved/provider"],
      roles: [selectedBinding.authorityTuple.role],
      routes: ["standard-design" as const],
    },
    cacheKeyAuthority: {
      dataResidencyBoundary: namespacedIdentifierSchema.parse(
        "cloudmarkup.residency.test.v1",
      ),
      organizationSafePolicyScope: namespacedIdentifierSchema.parse(
        "cloudmarkup.prompt-cache.organization.v1",
      ),
    },
    canonicalCommercialAuthority: "canonical-commercial-v1" as const,
    contractVersion: 1 as const,
    evaluationGate: {
      authorityTuple: selectedBinding.authorityTuple,
      authorityTupleDigest: selectedBinding.authorityTupleDigest,
      capabilityRegistryDigest:
        selectedBinding.authorityTuple.capabilityRegistryDigest,
      deterministicPassed: true as const,
      deterministicQualityBasisPoints:
        evaluationReport.deterministicQualityBasisPoints,
      datasetCaseDigests: evaluationReport.datasetCaseDigests,
      datasetDigest: evaluationReport.datasetDigest,
      evaluationPolicyDigest: evaluationReport.evaluationPolicyDigest,
      evaluationPolicyId: evaluationReport.evaluationPolicyId,
      evaluationPolicyVersion: evaluationReport.evaluationPolicyVersion,
      evaluationReportDigest: evaluationReport.reportDigest,
      evaluationReportId: evaluationReport.evaluationReportId,
      evaluationResultSetDigest: evaluationReport.evaluationResultSetDigest,
      minimumDeterministicQualityBasisPoints: 9_000,
      routeRegistryDigest: selectedBinding.authorityTuple.routeRegistryDigest,
    },
    featureEntitlements: [
      { features: ["architecture.propose" as const], plan: "pro" as const },
    ],
    killSwitches: {
      capabilitySwitches: [],
      global: { engaged: false },
    },
    limits: {
      maximumEdges: 1_000,
      maximumFiles: 100,
      maximumNodes: 500,
      maximumOutputBytes: 1_000_000,
      maximumOutputTokens: 10_000,
      maximumPromptBytes: 100_000,
      maximumRepairAttempts: 2,
      maximumRepositoryBytes: 10_000_000,
      maximumRepositoryFiles: 1_000,
    },
    liveEvaluation: {
      enabledByDefault: false as const,
      excludedFromNormalCi: true as const,
      killSwitchEngagedByDefault: true as const,
      permittedEnvironments: ["development" as const, "staging" as const],
    },
    policyId: namespacedIdentifierSchema.parse(
      "cloudmarkup.runtime.policy.prompt38",
    ),
    policyVersion: semanticVersionSchema.parse("1.0.0"),
    recordKind: "model-runtime-control-policy" as const,
    requestWindows: {
      organization: {
        maximumConcurrentJobs: 10,
        maximumRequests: 100,
        windowSeconds: 3_600,
      },
      user: {
        maximumConcurrentJobs: 2,
        maximumRequests: 20,
        windowSeconds: 3_600,
      },
    },
    safety: {
      arbitraryPackageAuthority: false as const,
      arbitraryShellAuthority: false as const,
      arbitraryToolAuthority: false as const,
      arbitraryUrlAuthority: false as const,
      credentialAuthority: false as const,
      deploymentAuthority: false as const,
      rawSensitiveLogsPermitted: false as const,
      repositoryWriteAuthority: false as const,
      resultSanitizationRequired: true as const,
      secretRedactionRequired: true as const,
      structuredOutputsRequired: true as const,
      tenantSafeCacheAndPromptKeysRequired: true as const,
    },
  };
  const withConfigurationDigest = {
    ...value,
    runtimeControlConfigurationDigest:
      digestModelRuntimeControlConfigurationV1(value),
  };
  return modelRuntimeControlPolicyV1Schema.parse({
    ...withConfigurationDigest,
    policyDigest: digestCanonicalValue(withConfigurationDigest),
  });
}

describe("model evaluation dataset and deterministic reports", () => {
  it("freezes every requested case and score dimension exactly once", () => {
    expect(frozenDataset.cases).toHaveLength(21);
    expect(
      new Set(frozenDataset.cases.map((value) => value.caseKind)).size,
    ).toBe(21);
    expect(frozenDataset.requiredDeterministicDimensions).toEqual(
      modelDeterministicScoreDimensionV1Values,
    );
    for (const evaluationCase of frozenDataset.cases) {
      expect(evaluationCase.input.safety).toEqual({
        containsCustomerData: false,
        containsRealCredentials: false,
        secretPlaceholdersOnly: true,
        synthetic: true,
      });
      expect(evaluationCase.targetDimensions).toEqual(
        expect.arrayContaining([
          ...modelEvaluationMandatoryCaseDimensionV1Values,
        ]),
      );
    }
  });

  it("fails closed on digest mutation, duplicate kinds, and unknown fields", () => {
    const mutated = structuredClone(frozenDataset);
    requireValue(mutated.cases[0], "first mutable case").input.requirements =
      "Changed without a new digest.";
    expect(modelEvaluationDatasetV1Schema.safeParse(mutated).success).toBe(
      false,
    );

    const duplicateKind = structuredClone(frozenDataset);
    duplicateKind.cases[0] = requireValue(
      duplicateKind.cases[1],
      "second duplicate case",
    );
    const withoutDigest = { ...duplicateKind };
    delete (withoutDigest as Partial<ModelEvaluationDatasetV1>).datasetDigest;
    duplicateKind.datasetDigest = digestCanonicalValue(withoutDigest);
    expect(
      modelEvaluationDatasetV1Schema.safeParse(duplicateKind).success,
    ).toBe(false);
  });

  it("rejects self-rehashed datasets that omit mandatory or required dimensions", () => {
    const missingMandatory = structuredClone(frozenDataset);
    const firstCase = requireValue(
      missingMandatory.cases[0],
      "first mandatory-dimension case",
    );
    const mandatoryDimension = modelEvaluationMandatoryCaseDimensionV1Values[0];
    firstCase.targetDimensions = firstCase.targetDimensions.filter(
      (dimension) => dimension !== mandatoryDimension,
    );
    rehashCase(firstCase);
    rehashDataset(missingMandatory);
    expect(
      modelEvaluationDatasetV1Schema.safeParse(missingMandatory).success,
    ).toBe(false);

    const missingRequiredUnion = structuredClone(frozenDataset);
    const requiredDimension =
      "terraform-cloudformation-validation-security-success";
    for (const evaluationCase of missingRequiredUnion.cases) {
      if (evaluationCase.targetDimensions.includes(requiredDimension)) {
        evaluationCase.targetDimensions =
          evaluationCase.targetDimensions.filter(
            (dimension) => dimension !== requiredDimension,
          );
        rehashCase(evaluationCase);
      }
    }
    rehashDataset(missingRequiredUnion);
    expect(
      modelEvaluationDatasetV1Schema.safeParse(missingRequiredUnion).success,
    ).toBe(false);
  });

  it("rejects unresolved and duplicate repository fixture evidence", () => {
    const unresolved = structuredClone(frozenDataset);
    const unresolvedCase = requireValue(
      unresolved.cases.find(
        ({ expected }) => expected.requiredEvidenceIds.length > 0,
      ),
      "case with required evidence",
    );
    unresolvedCase.expected.requiredEvidenceIds = [
      "evidence_synthetic_repository_missing",
    ];
    rehashCase(unresolvedCase);
    rehashDataset(unresolved);
    expect(modelEvaluationDatasetV1Schema.safeParse(unresolved).success).toBe(
      false,
    );

    const duplicateIdentity = structuredClone(frozenDataset);
    const identityCase = requireValue(
      duplicateIdentity.cases.find(
        ({ input }) => input.repositoryFixtures.length > 0,
      ),
      "case with repository fixture",
    );
    const identityFixture = requireValue(
      identityCase.input.repositoryFixtures[0],
      "repository fixture for duplicate identity",
    );
    identityCase.input.repositoryFixtures.push({
      ...identityFixture,
      path: "infrastructure/duplicate-evidence.tf",
    });
    rehashCase(identityCase);
    rehashDataset(duplicateIdentity);
    expect(
      modelEvaluationDatasetV1Schema.safeParse(duplicateIdentity).success,
    ).toBe(false);

    const duplicatePath = structuredClone(frozenDataset);
    const pathCase = requireValue(
      duplicatePath.cases.find(
        ({ input }) => input.repositoryFixtures.length > 0,
      ),
      "case with repository fixture path",
    );
    const pathFixture = requireValue(
      pathCase.input.repositoryFixtures[0],
      "repository fixture for duplicate path",
    );
    pathCase.input.repositoryFixtures.push({
      ...pathFixture,
      evidenceId: "evidence_synthetic_repository_duplicate",
    });
    rehashCase(pathCase);
    rehashDataset(duplicatePath);
    expect(
      modelEvaluationDatasetV1Schema.safeParse(duplicatePath).success,
    ).toBe(false);
  });

  it("derives deterministic rates and keeps optional judge evidence separate", () => {
    expect(
      modelDeterministicScoreV1Schema.safeParse({
        ...score("structured-schema-validity"),
        basisPoints: 9_999,
      }).success,
    ).toBe(false);

    const judged = report(frozenDataset, { withJudge: true });
    expect(judged.deterministicPassed).toBe(true);
    const judgedResult = requireValue(judged.caseResults[0], "judged result");
    expect(
      requireValue(judgedResult.judgeScores[0], "judge score").authority,
    ).toBe("non-authoritative");

    const forged = structuredClone(judged);
    forged.deterministicPassed = false;
    forged.activationRecommendation = "hold";
    const withoutDigest = { ...forged };
    delete (withoutDigest as Partial<ModelEvaluationReportV1>).reportDigest;
    forged.reportDigest = digestCanonicalValue(withoutDigest);
    expect(modelEvaluationReportV1Schema.safeParse(forged).success).toBe(false);
  });

  it("rejects a self-rehashed report with a zero-applicable dimension", () => {
    const uncovered = structuredClone(report(frozenDataset));
    const uncoveredDimension =
      "terraform-cloudformation-validation-security-success";
    for (const caseResult of uncovered.caseResults) {
      const uncoveredScore = requireValue(
        caseResult.scores.find(
          ({ dimension }) => dimension === uncoveredDimension,
        ),
        "score selected for zero-applicable mutation",
      );
      Object.assign(uncoveredScore, {
        applicable: false,
        basisPoints: 0,
        denominator: 0,
        evidenceDigests: [],
        numerator: 0,
        passed: true,
      });
      caseResult.evidenceDigests = [
        ...new Set(
          caseResult.scores
            .filter(({ applicable }) => applicable)
            .flatMap(({ evidenceDigests }) => evidenceDigests),
        ),
      ];
      const resultDraft = { ...caseResult };
      delete (resultDraft as Partial<typeof caseResult>).resultDigest;
      caseResult.resultDigest = digestCanonicalValue(resultDraft);
    }
    uncovered.evaluationResultSetDigest = digestCanonicalValue(
      uncovered.caseResults.map(({ resultDigest }) => resultDigest),
    );
    const reportDraft = { ...uncovered };
    delete (reportDraft as Partial<ModelEvaluationReportV1>).reportDigest;
    uncovered.reportDigest = digestCanonicalValue(reportDraft);

    const parsed = modelEvaluationReportV1Schema.safeParse(uncovered);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              "Every deterministic score dimension requires at least one applicable score with evidence.",
          }),
        ]),
      );
    }
  });

  it("binds reports to one route tuple, result set, and deterministic baseline", () => {
    const current = report(frozenDataset);
    const firstResult = requireValue(current.caseResults[0], "first result");
    const firstScore = requireValue(firstResult.scores[0], "first score");
    const withRegression = {
      ...current,
      baselineReport: {
        reportDigest: sha256Text("baseline-report"),
        reportId: "eval-report.baseline",
      },
      regressions: [
        {
          authority: "deterministic" as const,
          caseDigest: firstResult.caseDigest,
          caseId: firstResult.caseId,
          currentBasisPoints: firstScore.basisPoints,
          currentPassed: firstScore.passed,
          deltaBasisPoints: 1_000,
          dimension: firstScore.dimension,
          evidenceDigests: [sha256Text("regression-evidence")],
          priorBasisPoints: firstScore.basisPoints - 1_000,
          priorPassed: true,
        },
      ],
    };
    delete (withRegression as Partial<ModelEvaluationReportV1>).reportDigest;
    expect(
      modelEvaluationReportV1Schema.parse({
        ...withRegression,
        reportDigest: digestCanonicalValue(withRegression),
      }).regressions,
    ).toHaveLength(1);

    const wrongTuple = structuredClone(current);
    const wrongBinding = requireValue(
      wrongTuple.authorityBindings[0],
      "first authority binding",
    );
    wrongBinding.authorityTuple.catalogDigest = sha256Text("other-catalog");
    wrongBinding.authorityTupleDigest = digestModelEvaluationAuthorityTupleV1(
      wrongBinding.authorityTuple,
    );
    wrongTuple.authorityBindingSetDigest = digestCanonicalValue(
      wrongTuple.authorityBindings.map(
        ({ authorityTupleDigest }) => authorityTupleDigest,
      ),
    );
    const withoutDigest = { ...wrongTuple };
    delete (withoutDigest as Partial<ModelEvaluationReportV1>).reportDigest;
    wrongTuple.reportDigest = digestCanonicalValue(withoutDigest);
    const parsed = modelEvaluationReportV1Schema.safeParse(wrongTuple);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "custom",
            message:
              "Every result must rejoin one declared run tuple with its exact required operation and role class.",
          }),
        ]),
      );
    }
  });

  it("generates the additive strict public JSON Schema", () => {
    const generated = generateModelEvaluationV1JsonSchema();
    expect(generated.$id).toBe(
      "https://schemas.cloudmarkup.com/model-evaluation/v1.schema.json",
    );
    expect(JSON.stringify(generated)).toContain(
      "model-runtime-admission-decision",
    );
    expect(JSON.stringify(generated)).toContain("model-runtime-host-evidence");
  });
});

describe("runtime-control contracts", () => {
  it("rejoins exact passing evaluation evidence and denies dangerous authority", () => {
    const evaluationReport = report(frozenDataset);
    const policy = runtimePolicy(evaluationReport);
    expect(policy.evaluationGate.evaluationReportId).toBe(
      evaluationReport.evaluationReportId,
    );
    expect(Object.values(policy.safety).includes(true)).toBe(true);
    expect(policy.safety.deploymentAuthority).toBe(false);
    expect(policy.safety.repositoryWriteAuthority).toBe(false);

    const weak = structuredClone(policy);
    weak.evaluationGate.minimumDeterministicQualityBasisPoints = 10_001;
    expect(modelRuntimeControlPolicyV1Schema.safeParse(weak).success).toBe(
      false,
    );

    for (const [index, mutate] of [
      (candidate: ModelRuntimeControlPolicyV1) => {
        candidate.limits.maximumEdges -= 1;
      },
      (candidate: ModelRuntimeControlPolicyV1) => {
        Object.assign(candidate.safety, {
          resultSanitizationRequired: false,
        });
      },
    ].entries()) {
      const changed = structuredClone(policy);
      mutate(changed);
      if (index === 1) {
        changed.runtimeControlConfigurationDigest =
          digestModelRuntimeControlConfigurationV1(changed);
      }
      const withoutPolicyDigest = structuredClone(changed);
      delete (withoutPolicyDigest as Partial<ModelRuntimeControlPolicyV1>)
        .policyDigest;
      changed.policyDigest = digestCanonicalValue(withoutPolicyDigest);
      const parsed = modelRuntimeControlPolicyV1Schema.safeParse(changed);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining(
              index === 0
                ? {
                    code: "custom",
                    path: ["runtimeControlConfigurationDigest"],
                  }
                : {
                    code: "invalid_value",
                    path: ["safety", "resultSanitizationRequired"],
                  },
            ),
          ]),
        );
      }
    }
  });

  it("requires explicit restricted live-evaluation authority", () => {
    const base = {
      approved: true as const,
      authorityId: "live-eval-authority.prompt38",
      canonicalCommercialAuthority: "canonical-commercial-v1" as const,
      contractVersion: 1 as const,
      createdAt: "2026-08-22T12:00:00.000Z",
      datasetCaseDigests: frozenDataset.cases.map(
        (evaluationCase) => evaluationCase.caseDigest,
      ),
      datasetDigest: frozenDataset.datasetDigest,
      environment: "staging" as const,
      evaluationPolicyDigest: sha256Text("evaluation-policy.prompt38"),
      evaluationPolicyId: "cloudmarkup.eval.policy.prompt38",
      evaluationPolicyVersion: "1.0.0" as const,
      expiresAt: "2026-08-22T13:00:00.000Z",
      killSwitchEngaged: false as const,
      limits: {
        maximumConcurrentJobs: 1,
        maximumCreditUnits: 10,
        maximumEstimatedMicroUsd: 100,
        maximumInputTokens: 21_000,
        maximumInvocations: 21,
        maximumOutputTokens: 10_500,
        maximumTotalTokens: 31_500,
      },
      modelConfigurationReferences: ["model.fake.standard"],
      normalCi: false as const,
      optIn: true as const,
      organizationId: "organization.prompt38",
      promptTemplateDigests: [sha256Text("prompt")],
      recordKind: "model-live-evaluation-authority" as const,
      runtimeControlConfigurationDigest: sha256Text(
        "runtime-configuration.prompt38",
      ),
      runtimePolicyId: "cloudmarkup.runtime.policy.prompt38",
      runtimePolicyVersion: "1.0.0" as const,
    };
    expect(
      modelLiveEvaluationAuthorityV1Schema.parse({
        ...base,
        authorityDigest: digestCanonicalValue(base),
      }).normalCi,
    ).toBe(false);
    const expired = { ...base, expiresAt: base.createdAt };
    const parsed = modelLiveEvaluationAuthorityV1Schema.safeParse({
      ...expired,
      authorityDigest: digestCanonicalValue(expired),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "custom",
            path: ["expiresAt"],
            message: "Live-evaluation authority must expire after creation.",
          }),
        ]),
      );
    }
  });

  it("binds trusted rate/concurrency state and allowed admission authority", () => {
    const evaluationReport = report(frozenDataset);
    const policy = runtimePolicy(evaluationReport);
    const snapshotValue = {
      activeConcurrencyLeaseIds: ["lease.existing"],
      capturedAt: "2026-08-22T12:00:00.000Z",
      contractVersion: 1 as const,
      idempotencyReplay: false,
      organizationId: "organization.prompt38",
      policyDigest: policy.policyDigest,
      projectId: "project.prompt38",
      recordKind: "model-runtime-state-snapshot" as const,
      requestDigest: sha256Text("pending-request"),
      snapshotId: "runtime-state.prompt38",
      userId: "user.prompt38",
      windows: {
        organization: {
          activeConcurrentJobs: 1,
          requestCount: 2,
          windowEndsAt: "2026-08-22T13:00:00.000Z",
          windowStartedAt: "2026-08-22T12:00:00.000Z",
        },
        user: {
          activeConcurrentJobs: 0,
          requestCount: 1,
          windowEndsAt: "2026-08-22T13:00:00.000Z",
          windowStartedAt: "2026-08-22T12:00:00.000Z",
        },
      },
    };
    const snapshot = modelRuntimeStateSnapshotV1Schema.parse({
      ...snapshotValue,
      snapshotDigest: digestCanonicalValue(snapshotValue),
    });
    const commercialEstimateValue = {
      canonicalAuthority: "canonical-commercial-v1" as const,
      estimatedMicroUsd: 100,
      maximumCreditUnits: 10,
      pricingVersionReference: "cloudmarkup.pricing.prompt38",
    };
    const commercialEstimate = {
      ...commercialEstimateValue,
      estimateDigest: digestCanonicalValue(commercialEstimateValue),
    };
    const requested = {
      dependencyNames: ["zod"],
      edgeCount: 2,
      fileCount: 2,
      moduleSources: [],
      nodeCount: 2,
      outputBytes: 2_000,
      outputTokens: 200,
      promptBytes: 1_000,
      providerSources: [],
      repairAttempts: 0,
      repositoryBytes: 5_000,
      repositoryFiles: 2,
    };
    const inputEvidenceDraft = {
      authority: {
        credential: false as const,
        deployment: false as const,
        shell: false as const,
        tool: false as const,
        url: false as const,
      },
      contractVersion: 1 as const,
      evidenceId: "runtime-input-evidence.prompt38",
      inputDigest: sha256Text("input"),
      inputSanitized: true as const,
      noRawSensitiveContent: true as const,
      operation: "architecture.propose" as const,
      organizationId: snapshot.organizationId,
      projectId: snapshot.projectId,
      recordKind: "model-runtime-input-evidence" as const,
      requested,
      secretRedactionApplied: true as const,
      sourceOwnership: {
        evidenceDigests: [sha256Text("input-ownership")],
        status: "verified" as const,
      },
      userId: snapshot.userId,
      verifierId: namespacedIdentifierSchema.parse(
        "cloudmarkup.runtime.input-evidence-verifier",
      ),
      verifierVersion: semanticVersionSchema.parse("1.0.0"),
    };
    const inputEvidence = modelRuntimeInputEvidenceV1Schema.parse({
      ...inputEvidenceDraft,
      evidenceDigest: digestModelRuntimeInputEvidenceV1(inputEvidenceDraft),
    });
    const requestValue = {
      capabilityRegistryDigest:
        policy.evaluationGate.authorityTuple.capabilityRegistryDigest,
      cacheKeyAuthority: policy.cacheKeyAuthority,
      catalogDigest: policy.evaluationGate.authorityTuple.catalogDigest,
      commercialEstimate,
      contractVersion: 1 as const,
      evaluationAuthorityTupleDigest:
        policy.evaluationGate.authorityTupleDigest,
      evaluationReportDigest: evaluationReport.reportDigest,
      evaluationReportId: evaluationReport.evaluationReportId,
      evaluationResultSetDigest: evaluationReport.evaluationResultSetDigest,
      executionClass: "normal" as const,
      idempotencyKeyDigest: sha256Text("idempotency-key"),
      inputDigest: sha256Text("input"),
      inputEvidenceDigest: inputEvidence.evidenceDigest,
      operation: "architecture.propose" as const,
      organizationId: snapshot.organizationId,
      plan: "pro" as const,
      projectId: snapshot.projectId,
      promptTemplateDigest:
        policy.evaluationGate.authorityTuple.promptTemplateDigest,
      recordKind: "model-runtime-admission-request" as const,
      requested,
      responseSchemaDigest:
        policy.evaluationGate.authorityTuple.responseSchemaDigest,
      role: policy.evaluationGate.authorityTuple.role,
      routeRegistryDigest:
        policy.evaluationGate.authorityTuple.routeRegistryDigest,
      routingDecisionDigest: sha256Text("routing-decision"),
      runtimePolicyDigest: policy.policyDigest,
      userId: snapshot.userId,
    };
    const request = modelRuntimeAdmissionRequestV1Schema.parse({
      ...requestValue,
      requestDigest: digestCanonicalValue(requestValue),
    });
    const extraWindow = modelRuntimeAdmissionRequestV1Schema.safeParse({
      ...request,
      requested: { ...request.requested, userRequestsInWindow: 1 },
    });
    expect(extraWindow.success).toBe(false);
    if (!extraWindow.success) {
      expect(extraWindow.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            path: ["requested"],
            keys: ["userRequestsInWindow"],
          }),
        ]),
      );
    }

    const decisionValue = {
      accountingAuthority: "canonical-commercial-v1" as const,
      authorization: {
        commercialReservationDecisionId: "reservation.prompt38",
        concurrencyLeaseId: "lease.prompt38",
        entitlementDecisionId: "entitlement.prompt38",
      },
      commercialEstimateDigest: commercialEstimate.estimateDigest,
      contractVersion: 1 as const,
      decisionId: "admission.prompt38",
      decidedAt: "2026-08-22T12:00:01.000Z",
      denialReasons: [],
      evaluationAuthorityTupleDigest:
        policy.evaluationGate.authorityTupleDigest,
      evaluationReportDigest: evaluationReport.reportDigest,
      evaluationReportId: evaluationReport.evaluationReportId,
      evaluationResultSetDigest: evaluationReport.evaluationResultSetDigest,
      executionClass: "normal" as const,
      expiresAt: "2026-08-22T12:05:00.000Z",
      invokeModel: true,
      outcome: "allowed" as const,
      recordKind: "model-runtime-admission-decision" as const,
      requestDigest: request.requestDigest,
      routingDecisionDigest: request.routingDecisionDigest,
      runtimePolicyDigest: policy.policyDigest,
      writeAuthority: {
        compiler: false as const,
        deployment: false as const,
        github: false as const,
        payment: false as const,
        repository: false as const,
      },
    };
    const admissionDecision = modelRuntimeAdmissionDecisionV1Schema.parse({
      ...decisionValue,
      decisionDigest: digestCanonicalValue(decisionValue),
    });
    expect(admissionDecision.invokeModel).toBe(true);
    const extraSnapshot = modelRuntimeAdmissionDecisionV1Schema.safeParse({
      ...admissionDecision,
      runtimeStateSnapshotDigest: snapshot.snapshotDigest,
      runtimeStateSnapshotId: snapshot.snapshotId,
    });
    expect(extraSnapshot.success).toBe(false);
    if (!extraSnapshot.success) {
      expect(extraSnapshot.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            path: [],
            keys: ["runtimeStateSnapshotDigest", "runtimeStateSnapshotId"],
          }),
        ]),
      );
    }
    expect(
      modelRuntimeAdmissionDecisionV1Schema.safeParse({
        ...decisionValue,
        authorization: {},
        decisionDigest: digestCanonicalValue({
          ...decisionValue,
          authorization: {},
        }),
      }).success,
    ).toBe(false);
  });

  it("requires cache-aware live reservation counters to exactly compose total tokens", () => {
    const snapshotValue = {
      activeConcurrencyLeaseIds: [],
      capturedAt: "2026-08-22T12:00:00.000Z",
      contractVersion: 1 as const,
      idempotencyReplay: true,
      liveAuthorityUsage: {
        activeConcurrentJobs: 0,
        authorityDigest: sha256Text("live-authority"),
        reservedCacheReadTokens: 6,
        reservedCacheWriteTokens: 4,
        reservedCreditUnits: 2,
        reservedEstimatedMicroUsd: 100,
        reservedInputTokens: 100,
        reservedInvocations: 1,
        reservedOutputTokens: 50,
        reservedTotalTokens: 160,
      },
      organizationId: "organization.prompt38",
      policyDigest: sha256Text("runtime-policy"),
      projectId: "project.prompt38",
      recordKind: "model-runtime-state-snapshot" as const,
      requestDigest: sha256Text("request"),
      snapshotId: "runtime-state.cache-aware",
      userId: "user.prompt38",
      windows: {
        organization: {
          activeConcurrentJobs: 0,
          requestCount: 1,
          windowEndsAt: "2026-08-22T13:00:00.000Z",
          windowStartedAt: "2026-08-22T12:00:00.000Z",
        },
        user: {
          activeConcurrentJobs: 0,
          requestCount: 1,
          windowEndsAt: "2026-08-22T13:00:00.000Z",
          windowStartedAt: "2026-08-22T12:00:00.000Z",
        },
      },
    };
    expect(
      modelRuntimeStateSnapshotV1Schema.parse({
        ...snapshotValue,
        snapshotDigest: digestCanonicalValue(snapshotValue),
      }).liveAuthorityUsage,
    ).toMatchObject({
      reservedCacheReadTokens: 6,
      reservedCacheWriteTokens: 4,
      reservedTotalTokens: 160,
    });
    const inconsistent = {
      ...snapshotValue,
      liveAuthorityUsage: {
        ...snapshotValue.liveAuthorityUsage,
        reservedTotalTokens: 150,
      },
    };
    expect(
      modelRuntimeStateSnapshotV1Schema.safeParse({
        ...inconsistent,
        snapshotDigest: digestCanonicalValue(inconsistent),
      }).success,
    ).toBe(false);
    const missingCacheCounters = structuredClone(snapshotValue) as Record<
      string,
      unknown
    >;
    const liveUsage = missingCacheCounters["liveAuthorityUsage"] as Record<
      string,
      unknown
    >;
    delete liveUsage["reservedCacheReadTokens"];
    expect(
      modelRuntimeStateSnapshotV1Schema.safeParse({
        ...missingCacheCounters,
        snapshotDigest: digestCanonicalValue(missingCacheCounters),
      }).success,
    ).toBe(false);
  });
  it("strictly binds host-issued input Evidence without external authority", () => {
    const draft = {
      authority: {
        credential: false as const,
        deployment: false as const,
        shell: false as const,
        tool: false as const,
        url: false as const,
      },
      contractVersion: 1 as const,
      evidenceId: "runtime-input-evidence.strict",
      inputDigest: sha256Text("strict-input"),
      inputSanitized: true as const,
      noRawSensitiveContent: true as const,
      operation: "operations.propose" as const,
      organizationId: "organization.prompt38",
      projectId: "project.prompt38",
      recordKind: "model-runtime-input-evidence" as const,
      requested: {
        dependencyNames: ["zod"],
        edgeCount: 2,
        fileCount: 3,
        moduleSources: ["registry.example/approved/module"],
        nodeCount: 4,
        outputBytes: 5_000,
        outputTokens: 200,
        promptBytes: 1_000,
        providerSources: ["registry.example/approved/provider"],
        repairAttempts: 1,
        repositoryBytes: 8_000,
        repositoryFiles: 3,
      },
      secretRedactionApplied: true as const,
      sourceOwnership: {
        evidenceDigests: [sha256Text("strict-input-ownership")],
        status: "verified" as const,
      },
      userId: "user.prompt38",
      verifierId: namespacedIdentifierSchema.parse(
        "cloudmarkup.runtime.input-evidence-verifier",
      ),
      verifierVersion: semanticVersionSchema.parse("1.0.0"),
    };
    const evidence = modelRuntimeInputEvidenceV1Schema.parse({
      ...draft,
      evidenceDigest: digestModelRuntimeInputEvidenceV1(draft),
    });
    expect(modelEvaluationContractV1Schema.parse(evidence)).toEqual(evidence);

    for (const capability of [
      "credential",
      "deployment",
      "shell",
      "tool",
      "url",
    ] as const) {
      const authority = { ...evidence.authority, [capability]: true };
      const { evidenceDigest: ignored, ...withoutDigest } = evidence;
      void ignored;
      const changed = { ...withoutDigest, authority };
      expect(
        modelRuntimeInputEvidenceV1Schema.safeParse({
          ...changed,
          evidenceDigest: digestCanonicalValue(changed),
        }).success,
      ).toBe(false);
    }

    const { evidenceDigest: ignored, ...withoutDigest } = evidence;
    void ignored;
    const rawPrompt = modelRuntimeInputEvidenceV1Schema.safeParse({
      ...withoutDigest,
      rawPrompt: "not allowed",
      evidenceDigest: digestCanonicalValue({
        ...withoutDigest,
        rawPrompt: "not allowed",
      }),
    });
    expect(rawPrompt.success).toBe(false);
    if (!rawPrompt.success) {
      expect(rawPrompt.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            path: [],
            keys: ["rawPrompt"],
          }),
        ]),
      );
    }
    const invalidOwnership = {
      ...withoutDigest,
      sourceOwnership: {
        evidenceDigests: evidence.sourceOwnership.evidenceDigests,
        status: "not-applicable" as const,
      },
    };
    expect(
      modelRuntimeInputEvidenceV1Schema.safeParse({
        ...invalidOwnership,
        evidenceDigest: digestCanonicalValue(invalidOwnership),
      }).success,
    ).toBe(false);
    expect(
      modelRuntimeInputEvidenceV1Schema.safeParse({
        ...evidence,
        requested: { ...evidence.requested, repositoryBytes: 7_999 },
      }).success,
    ).toBe(false);
    expect(
      modelRuntimeInputEvidenceV1Schema.safeParse({
        ...withoutDigest,
        secretRedactionApplied: false,
        evidenceDigest: digestCanonicalValue({
          ...withoutDigest,
          secretRedactionApplied: false,
        }),
      }).success,
    ).toBe(false);
  });
  it("digest-binds strict host Evidence to output, tenant, operation, and verifier", () => {
    const draft = {
      catalogDigest: sha256Text("catalog"),
      contractVersion: 1 as const,
      evidenceId: "runtime-evidence.prompt38",
      evidenceKind: "allow-listed-operations" as const,
      inputDigest: sha256Text("input"),
      operation: "architecture.propose" as const,
      organizationId: "organization.prompt38",
      outputBytes: 1_024,
      outputDigest: sha256Text("sanitized-output"),
      outputTokens: 128,
      passed: true as const,
      projectId: "project.prompt38",
      recordKind: "model-runtime-host-evidence" as const,
      responseSchemaDigest: sha256Text("response-schema"),
      runtimePolicyDigest: sha256Text("runtime-policy"),
      verifierId: namespacedIdentifierSchema.parse(
        "cloudmarkup.runtime.host-evidence-verifier",
      ),
      verifierVersion: semanticVersionSchema.parse("1.0.0"),
    };
    const evidence = modelRuntimeHostEvidenceV1Schema.parse({
      ...draft,
      evidenceDigest: digestModelRuntimeHostEvidenceV1(draft),
    });
    expect(evidence.passed).toBe(true);
    expect(
      modelRuntimeHostEvidenceV1Schema.safeParse({
        ...evidence,
        outputDigest: sha256Text("forged-output"),
      }).success,
    ).toBe(false);
    const modelClaim = modelRuntimeHostEvidenceV1Schema.safeParse({
      ...evidence,
      modelClaimedValidation: true,
    });
    expect(modelClaim.success).toBe(false);
    if (!modelClaim.success) {
      expect(modelClaim.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            path: [],
            keys: ["modelClaimedValidation"],
          }),
        ]),
      );
    }
  });
  it("projects credits and tokens only from canonical authorities", () => {
    const base = {
      contractVersion: 1 as const,
      eventKind: "credits" as const,
      metricId: "metric.prompt38",
      noRawSensitiveDimensions: true as const,
      occurredAt: "2026-08-22T12:00:00.000Z",
      organizationScopeDigest: sha256Text("organization"),
      recordKind: "model-runtime-metric" as const,
      unit: "credit-units" as const,
      value: 2,
    };
    expect(
      modelRuntimeMetricV1Schema.safeParse({
        ...base,
        sourceAuthority: "deterministic-evaluation-v1",
      }).success,
    ).toBe(false);
    expect(
      modelRuntimeMetricV1Schema.parse({
        ...base,
        sourceAuthority: "canonical-commercial-v1",
      }).value,
    ).toBe(2);
  });
});
