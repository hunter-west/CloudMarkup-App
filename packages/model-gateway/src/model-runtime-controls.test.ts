import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  digestModelEvaluationReportV1,
  digestModelLiveEvaluationAuthorityV1,
  digestModelRuntimeAdmissionDecisionV1,
  digestModelRuntimeAdmissionRequestV1,
  digestModelRuntimeCommercialEstimateV1,
  digestModelRuntimeControlConfigurationV1,
  digestModelRuntimeControlPolicyV1,
  digestModelRuntimeHostEvidenceV1,
  digestModelRuntimeInputEvidenceV1,
  modelCacheKeyInputV1Schema,
  modelEvaluationReportV1Schema,
  modelLiveEvaluationAuthorityV1Schema,
  modelRoutingDecisionV1Schema,
  modelRoutingRequestV1Schema,
  modelRuntimeAdmissionDecisionV1Schema,
  modelRuntimeAdmissionRequestV1Schema,
  modelRuntimeCommercialEstimateV1Schema,
  modelRuntimeControlPolicyV1Schema,
  modelRuntimeHostEvidenceV1Schema,
  modelRuntimeInputEvidenceV1Schema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  utcTimestampSchema,
  type ModelCacheKeyInputV1,
  type ModelEvaluationRegressionV1,
  type ModelEvaluationReportV1,
  type ModelLiveEvaluationAuthorityV1,
  type ModelRoutingDecisionV1,
  type ModelRoutingRequestV1,
  type ModelRuntimeAdmissionDecisionV1,
  type ModelRuntimeAdmissionRequestV1,
  type ModelRuntimeAuditEventV1,
  type ModelRuntimeControlPolicyV1,
  type ModelRuntimeHostEvidenceV1,
  type ModelRuntimeInputEvidenceV1,
  type ModelRuntimeMetricV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import {
  MODEL_COMMERCIAL_LIFECYCLE_VERSION,
  projectModelCommercialOperationIdentityV1,
  type ModelCommercialInvocationAttemptV1,
  type ModelCommercialInvocationContextV1,
  type ModelCommercialInvocationResultV1,
  type ModelCommercialLifecycleResponseV1,
  type ModelCommercialOperationRequestV1,
  type ModelCommercialRouteV1,
} from "./commercial-lifecycle.js";
import {
  modelEvaluationDefaultsV1,
  runFrozenDeterministicModelEvaluationV1,
} from "./model-evaluation.js";
import {
  digestModelRuntimeOperationalOutcomeAuthorityV1,
  InMemoryModelRuntimeAdmissionStoreV1,
  ModelRuntimeControlError,
  ModelRuntimeControlServiceV1,
  verifyModelRuntimeInvocationOutputV1,
  projectModelRuntimeExecutionIdentityV1,
  type ModelRuntimeAdmissionStoreV1,
  type ModelRuntimeAuthorityResolverV1,
  type ModelRuntimeCanonicalCommercialPortV1,
  type ModelRuntimeControlExecutionInputV1,
  type ModelRuntimeControlledInvocationContextV1,
  type ModelRuntimeControlledInvocationResultV1,
  type ModelRuntimeExecutionLeaseV1,
  type ModelRuntimeHostEvidenceVerifierV1,
  type ModelRuntimeOperationalEventKindV1,
  type ModelRuntimeOperationalOutcomeAuthorityV1,
  type ModelRuntimeSanitizedOutputEvidenceV1,
  type ModelRuntimeTelemetryPortV1,
  type ModelRuntimeTrustedAuthorityBundleV1,
} from "./model-runtime-controls.js";
import { digestStructuredValue, sha256Text } from "./security.js";
import {
  modelTestContext,
  modelTestRequests,
  modelTestRoutingDecision,
  modelTestRoutingRequest,
} from "./test-helpers.js";

const NOW = "2026-08-22T12:00:10.000Z";
const EXPIRES_AT = "2026-08-22T12:05:10.000Z";
const PRICING_REFERENCE = namespacedIdentifierSchema.parse(
  "cloudmarkup.pricing.prompt38",
);
const DATA_RESIDENCY_BOUNDARY = namespacedIdentifierSchema.parse(
  "cloudmarkup.residency.test.v1",
);
const ORGANIZATION_SAFE_POLICY_SCOPE = namespacedIdentifierSchema.parse(
  "cloudmarkup.prompt-cache.organization.v1",
);
const MAXIMUM_CREDIT_UNITS = 2;
const ESTIMATED_MICRO_USD = 150;

type DenialReason = ModelRuntimeAdmissionDecisionV1["denialReasons"][number];
type AuthorityBinding = ModelEvaluationReportV1["authorityBindings"][number];
type PolicyDraft = Omit<ModelRuntimeControlPolicyV1, "policyDigest">;
type PolicyConfigurationDraft = Omit<
  PolicyDraft,
  "runtimeControlConfigurationDigest"
>;

let evaluationReport: ModelEvaluationReportV1;
let authorityBinding: AuthorityBinding;

function issueValidatorAuthorizedRuntimeReportForTest(
  report: ModelEvaluationReportV1,
): ModelEvaluationReportV1 {
  if (!report.deterministicPassed) {
    throw new Error(
      "The runtime test authority cannot promote a failing report.",
    );
  }
  const { reportDigest: _selfScoredReportDigest, ...reportWithoutDigest } =
    report;
  void _selfScoredReportDigest;
  const reportDraft = {
    ...reportWithoutDigest,
    activationRecommendation: "eligible-for-reviewed-beta" as const,
  };
  return modelEvaluationReportV1Schema.parse({
    ...reportDraft,
    reportDigest: digestModelEvaluationReportV1(reportDraft),
  });
}

beforeAll(async () => {
  const evaluated = await runFrozenDeterministicModelEvaluationV1();
  if (evaluated.report.activationRecommendation !== "hold") {
    throw new Error("The self-scored evaluator must not recommend activation.");
  }
  evaluationReport = issueValidatorAuthorizedRuntimeReportForTest(
    evaluated.report,
  );
  const selected = evaluationReport.authorityBindings.find(
    (binding) =>
      binding.authorityTuple.operation === "operations.propose" &&
      binding.authorityTuple.role === "standard-planning-generation",
  );
  if (selected === undefined) {
    throw new Error("The frozen evaluation is missing operations authority.");
  }
  authorityBinding = selected;
});

function operationRequest(
  operation: ModelRuntimeAdmissionRequestV1["operation"] = "operations.propose",
) {
  const request = modelTestRequests().find(
    (candidate) => candidate.operation === operation,
  );
  if (request === undefined) throw new Error("Missing operation fixture.");
  return request;
}

function makeCommercialEstimate() {
  const draft = {
    canonicalAuthority: "canonical-commercial-v1" as const,
    estimatedMicroUsd: ESTIMATED_MICRO_USD,
    maximumCreditUnits: MAXIMUM_CREDIT_UNITS,
    pricingVersionReference: PRICING_REFERENCE,
  };
  return modelRuntimeCommercialEstimateV1Schema.parse({
    ...draft,
    estimateDigest: digestModelRuntimeCommercialEstimateV1(draft),
  });
}

function makePolicy(
  transform?: (draft: PolicyConfigurationDraft) => unknown,
  report: ModelEvaluationReportV1 = evaluationReport,
  operation: ModelRuntimeAdmissionRequestV1["operation"] = "operations.propose",
): ModelRuntimeControlPolicyV1 {
  const binding =
    report.authorityBindings.find(
      (candidate) =>
        candidate.authorityTuple.operation === operation &&
        candidate.authorityTuple.role === "standard-planning-generation",
    ) ??
    report.authorityBindings.find(
      (candidate) => candidate.authorityTuple.operation === operation,
    ) ??
    authorityBinding;
  const tuple = binding.authorityTuple;
  const routeId =
    tuple.role === "repair-escalation"
      ? ("internal-escalation" as const)
      : tuple.role === "deep-architecture-custom-generation"
        ? ("deep-design" as const)
        : ("standard-design" as const);
  const draft = {
    administrativeSuspensions: [],
    allowlists: {
      dependencies: ["zod"],
      modelConfigurationReferences: [tuple.modelConfigurationReference],
      modules: ["registry.example/approved/module"],
      providers: ["registry.example/approved/provider"],
      roles: [tuple.role],
      routes: [routeId],
    },
    cacheKeyAuthority: {
      dataResidencyBoundary: DATA_RESIDENCY_BOUNDARY,
      organizationSafePolicyScope: ORGANIZATION_SAFE_POLICY_SCOPE,
    },
    canonicalCommercialAuthority: "canonical-commercial-v1" as const,
    contractVersion: 1 as const,
    evaluationGate: {
      authorityTuple: tuple,
      authorityTupleDigest: binding.authorityTupleDigest,
      capabilityRegistryDigest: tuple.capabilityRegistryDigest,
      deterministicPassed: true as const,
      deterministicQualityBasisPoints: report.deterministicQualityBasisPoints,
      datasetCaseDigests: report.datasetCaseDigests,
      datasetDigest: report.datasetDigest,
      evaluationPolicyDigest: report.evaluationPolicyDigest,
      evaluationPolicyId: report.evaluationPolicyId,
      evaluationPolicyVersion: report.evaluationPolicyVersion,
      evaluationReportDigest: report.reportDigest,
      evaluationReportId: report.evaluationReportId,
      evaluationResultSetDigest: report.evaluationResultSetDigest,
      minimumDeterministicQualityBasisPoints: 9_000,
      routeRegistryDigest: tuple.routeRegistryDigest,
    },
    featureEntitlements: [{ features: [operation], plan: "pro" as const }],
    killSwitches: {
      capabilitySwitches: [],
      global: { engaged: false },
    },
    limits: {
      maximumEdges: 1_000,
      maximumFiles: 100,
      maximumNodes: 500,
      maximumOutputBytes: 1_000_000,
      maximumOutputTokens: 1_000,
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
  } satisfies PolicyConfigurationDraft;
  const transformed = transform?.(draft) ?? draft;
  const configuration = transformed as PolicyConfigurationDraft;
  const withoutDigest = {
    ...configuration,
    runtimeControlConfigurationDigest:
      digestModelRuntimeControlConfigurationV1(configuration),
  } satisfies PolicyDraft;
  return modelRuntimeControlPolicyV1Schema.parse({
    ...withoutDigest,
    policyDigest: digestModelRuntimeControlPolicyV1(withoutDigest),
  });
}

function evaluationReportWithRegression(input: {
  readonly currentBasisPoints: number;
  readonly currentPassed: boolean;
  readonly dimension: ModelEvaluationRegressionV1["dimension"];
  readonly priorBasisPoints: number;
  readonly priorPassed: boolean;
}): {
  readonly regression: ModelEvaluationRegressionV1;
  readonly report: ModelEvaluationReportV1;
} {
  const caseIndex = evaluationReport.caseResults.findIndex((result) =>
    result.scores.some(
      (score) => score.dimension === input.dimension && score.applicable,
    ),
  );
  const originalCase = evaluationReport.caseResults[caseIndex];
  if (originalCase === undefined) {
    throw new Error(`Missing applicable score for ${input.dimension}.`);
  }
  const scores = originalCase.scores.map((score) =>
    score.dimension === input.dimension
      ? {
          ...score,
          basisPoints: input.currentBasisPoints,
          denominator: 10_000,
          numerator: input.currentBasisPoints,
          passed: input.currentPassed,
        }
      : score,
  );
  const { resultDigest: _oldResultDigest, ...caseWithoutDigest } = originalCase;
  void _oldResultDigest;
  const caseDraft = {
    ...caseWithoutDigest,
    deterministicPassed: scores.every((score) => score.passed),
    scores,
  };
  const currentCase = {
    ...caseDraft,
    resultDigest: digestStructuredValue(caseDraft),
  };
  const caseResults = evaluationReport.caseResults.map((result, index) =>
    index === caseIndex ? currentCase : result,
  );
  const currentScore = currentCase.scores.find(
    (score) => score.dimension === input.dimension,
  );
  if (currentScore === undefined) throw new Error("Missing current score.");
  const regression = {
    authority: "deterministic" as const,
    caseDigest: currentCase.caseDigest,
    caseId: currentCase.caseId,
    currentBasisPoints: input.currentBasisPoints,
    currentPassed: input.currentPassed,
    deltaBasisPoints: input.currentBasisPoints - input.priorBasisPoints,
    dimension: input.dimension,
    evidenceDigests:
      currentScore.evidenceDigests.length > 0
        ? currentScore.evidenceDigests
        : [sha256Text("regression-evidence")],
    priorBasisPoints: input.priorBasisPoints,
    priorPassed: input.priorPassed,
  } satisfies ModelEvaluationRegressionV1;
  const applicableScores = caseResults.flatMap((result) =>
    result.scores.filter((score) => score.applicable),
  );
  const deterministicQualityBasisPoints = Math.floor(
    applicableScores.reduce(
      (total, score) =>
        total +
        (score.direction === "higher-is-better"
          ? score.basisPoints
          : 10_000 - score.basisPoints),
      0,
    ) / applicableScores.length,
  );
  const deterministicPassed = caseResults.every(
    (result) => result.deterministicPassed,
  );
  const { reportDigest: _oldReportDigest, ...reportWithoutDigest } =
    evaluationReport;
  void _oldReportDigest;
  const reportDraft = {
    ...reportWithoutDigest,
    activationRecommendation: deterministicPassed
      ? ("eligible-for-reviewed-beta" as const)
      : ("hold" as const),
    baselineReport: {
      reportDigest: sha256Text("runtime-regression-baseline"),
      reportId: "runtime_regression_baseline",
    },
    caseResults,
    deterministicPassed,
    deterministicQualityBasisPoints,
    evaluationResultSetDigest: digestStructuredValue(
      caseResults.map(({ resultDigest }) => resultDigest),
    ),
    regressions: [regression],
  };
  return {
    regression,
    report: modelEvaluationReportV1Schema.parse({
      ...reportDraft,
      reportDigest: digestModelEvaluationReportV1(reportDraft),
    }),
  };
}

function commercialRoute(
  live = false,
  tuple: AuthorityBinding["authorityTuple"] = authorityBinding.authorityTuple,
): ModelCommercialRouteV1 {
  if (tuple.inferenceProfileId === undefined) {
    throw new Error("The evaluated route must bind its inference profile.");
  }
  const deep = [
    "deep-architecture-custom-generation",
    "repair-escalation",
  ].includes(tuple.role);
  return {
    explanation: "Reviewed bounded route for runtime-control tests.",
    inferenceProfileId: tuple.inferenceProfileId,
    label: deep ? "Deep Design" : "Standard Design",
    modelId: live
      ? "configured.model.standard.required"
      : "cloudmarkup.fake-model.operations",
    modelVersion: live ? "configured-at-runtime" : "1.0.0",
    providerKey: live
      ? "cloudmarkup.amazon-bedrock"
      : "cloudmarkup.deterministic-fake",
    route: deep ? "deep" : "standard",
    routeId:
      tuple.role === "repair-escalation"
        ? "internal-escalation"
        : deep
          ? "deep-design"
          : "standard-design",
  };
}

const OUTPUT_DIGEST = sha256Text("sanitized-runtime-output");

function hostEvidence(
  evidenceKind: ModelRuntimeHostEvidenceV1["evidenceKind"],
  bindings: {
    readonly catalogDigest?: ModelRuntimeHostEvidenceV1["catalogDigest"];
    readonly inputDigest?: ModelRuntimeHostEvidenceV1["inputDigest"];
    readonly operation?: ModelRuntimeAdmissionRequestV1["operation"];
    readonly organizationId?: string;
    readonly outputBytes?: ModelRuntimeHostEvidenceV1["outputBytes"];
    readonly outputDigest?: ModelRuntimeHostEvidenceV1["outputDigest"];
    readonly outputTokens?: ModelRuntimeHostEvidenceV1["outputTokens"];
    readonly projectId?: string;
    readonly responseSchemaDigest?: ModelRuntimeHostEvidenceV1["responseSchemaDigest"];
    readonly runtimePolicyDigest?: ModelRuntimeHostEvidenceV1["runtimePolicyDigest"];
    readonly verifierId?: ModelRuntimeHostEvidenceV1["verifierId"];
  } = {},
): ModelRuntimeHostEvidenceV1 {
  const draft = {
    catalogDigest: bindings.catalogDigest ?? sha256Text("default-catalog"),
    contractVersion: 1 as const,
    evidenceId: `runtime_evidence_${evidenceKind.replaceAll("-", "_")}`,
    evidenceKind,
    inputDigest: bindings.inputDigest ?? sha256Text("default-input"),
    operation: bindings.operation ?? ("operations.propose" as const),
    organizationId: bindings.organizationId ?? "organization_test",
    outputBytes: bindings.outputBytes ?? 100,
    outputDigest: bindings.outputDigest ?? OUTPUT_DIGEST,
    outputTokens: bindings.outputTokens ?? 10,
    passed: true as const,
    projectId: bindings.projectId ?? "project_test",
    recordKind: "model-runtime-host-evidence" as const,
    responseSchemaDigest:
      bindings.responseSchemaDigest ?? sha256Text("default-response-schema"),
    runtimePolicyDigest:
      bindings.runtimePolicyDigest ?? sha256Text("default-runtime-policy"),
    verifierId:
      bindings.verifierId ??
      namespacedIdentifierSchema.parse(
        "cloudmarkup.runtime.host-evidence-verifier",
      ),
    verifierVersion: semanticVersionSchema.parse("1.0.0"),
  };
  return modelRuntimeHostEvidenceV1Schema.parse({
    ...draft,
    evidenceDigest: digestModelRuntimeHostEvidenceV1(draft),
  });
}

function inputEvidenceScopeKey(evidence: ModelRuntimeInputEvidenceV1): string {
  return digestStructuredValue({
    evidenceId: evidence.evidenceId,
    organizationId: evidence.organizationId,
    projectId: evidence.projectId,
    userId: evidence.userId,
  });
}

class MemoryHostEvidenceVerifier implements ModelRuntimeHostEvidenceVerifierV1 {
  readonly #inputEvidenceByScope = new Map<
    string,
    ModelRuntimeInputEvidenceV1
  >();
  readonly #operationalAuthorities = new Map<
    Sha256Digest,
    ModelRuntimeOperationalOutcomeAuthorityV1
  >();
  public readonly calls: ModelRuntimeHostEvidenceV1[] = [];
  public readonly inputCalls: ModelRuntimeInputEvidenceV1[] = [];
  public readonly operationalCalls: ModelRuntimeOperationalOutcomeAuthorityV1[] =
    [];

  public issueInputEvidence(
    draft: Omit<ModelRuntimeInputEvidenceV1, "evidenceDigest">,
  ): ModelRuntimeInputEvidenceV1 {
    const evidence = modelRuntimeInputEvidenceV1Schema.parse({
      ...draft,
      evidenceDigest: digestModelRuntimeInputEvidenceV1(draft),
    });
    const key = inputEvidenceScopeKey(evidence);
    const existing = this.#inputEvidenceByScope.get(key);
    if (
      existing !== undefined &&
      digestStructuredValue(existing) !== digestStructuredValue(evidence)
    ) {
      throw new Error("Runtime input Evidence identity conflict.");
    }
    this.#inputEvidenceByScope.set(key, structuredClone(evidence));
    return structuredClone(evidence);
  }

  public removeInputEvidence(evidence: ModelRuntimeInputEvidenceV1): void {
    this.#inputEvidenceByScope.delete(inputEvidenceScopeKey(evidence));
  }

  public verifyInputEvidence(input: {
    readonly evidence: ModelRuntimeInputEvidenceV1;
  }): Promise<boolean> {
    this.inputCalls.push(structuredClone(input.evidence));
    const issued = this.#inputEvidenceByScope.get(
      inputEvidenceScopeKey(input.evidence),
    );
    return Promise.resolve(
      input.evidence.verifierId ===
        "cloudmarkup.runtime.input-evidence-verifier" &&
        input.evidence.verifierVersion === "1.0.0" &&
        issued !== undefined &&
        digestStructuredValue(issued) === digestStructuredValue(input.evidence),
    );
  }

  public issueOperationalOutcome(
    draft: Omit<ModelRuntimeOperationalOutcomeAuthorityV1, "authorityDigest">,
  ): ModelRuntimeOperationalOutcomeAuthorityV1 {
    const authority = {
      ...draft,
      authorityDigest: digestModelRuntimeOperationalOutcomeAuthorityV1(draft),
    } satisfies ModelRuntimeOperationalOutcomeAuthorityV1;
    this.#operationalAuthorities.set(
      authority.authorityDigest,
      structuredClone(authority),
    );
    return authority;
  }

  public verifyOperationalOutcome(input: {
    readonly authority: ModelRuntimeOperationalOutcomeAuthorityV1;
  }): Promise<boolean> {
    this.operationalCalls.push(structuredClone(input.authority));
    const issued = this.#operationalAuthorities.get(
      input.authority.authorityDigest,
    );
    return Promise.resolve(
      issued !== undefined &&
        digestStructuredValue(issued) ===
          digestStructuredValue(input.authority),
    );
  }

  public verify(
    input: Parameters<ModelRuntimeHostEvidenceVerifierV1["verify"]>[0],
  ): Promise<boolean> {
    this.calls.push(structuredClone(input.evidence));
    return Promise.resolve(
      input.evidence.verifierId ===
        "cloudmarkup.runtime.host-evidence-verifier" &&
        input.evidence.verifierVersion === "1.0.0" &&
        input.evidence.evidenceKind === input.expected.evidenceKind &&
        input.evidence.catalogDigest === input.expected.catalogDigest &&
        input.evidence.inputDigest === input.expected.inputDigest &&
        input.evidence.operation === input.expected.operation &&
        input.evidence.organizationId === input.expected.organizationId &&
        input.evidence.outputBytes === input.expected.outputBytes &&
        input.evidence.outputDigest === input.expected.outputDigest &&
        input.evidence.outputTokens === input.expected.outputTokens &&
        input.evidence.projectId === input.expected.projectId &&
        input.evidence.responseSchemaDigest ===
          input.expected.responseSchemaDigest &&
        input.evidence.runtimePolicyDigest ===
          input.expected.runtimePolicyDigest,
    );
  }
}
class MemoryTelemetry implements ModelRuntimeTelemetryPortV1 {
  readonly #failAfterPersistAt = new Set<number>();
  readonly #pairsByEventId = new Map<
    string,
    {
      readonly audit: ModelRuntimeAuditEventV1;
      readonly metric: ModelRuntimeMetricV1;
    }
  >();
  #publishAttempts = 0;

  public get pairs(): readonly {
    readonly audit: ModelRuntimeAuditEventV1;
    readonly metric: ModelRuntimeMetricV1;
  }[] {
    return [...this.#pairsByEventId.values()].map((pair) =>
      structuredClone(pair),
    );
  }

  public get publishAttempts(): number {
    return this.#publishAttempts;
  }

  public failAfterPersist(attempt: number): void {
    this.#failAfterPersistAt.add(attempt);
  }

  public publish(input: {
    readonly audit: ModelRuntimeAuditEventV1;
    readonly metric: ModelRuntimeMetricV1;
  }): Promise<void> {
    this.#publishAttempts += 1;
    const clone = structuredClone(input);
    const existing = this.#pairsByEventId.get(input.audit.eventId);
    if (
      existing !== undefined &&
      digestStructuredValue(existing) !== digestStructuredValue(clone)
    ) {
      throw new Error("Runtime telemetry identity conflict.");
    }
    this.#pairsByEventId.set(input.audit.eventId, clone);
    if (this.#failAfterPersistAt.delete(this.#publishAttempts)) {
      throw new Error("Synthetic telemetry publish failure after persistence.");
    }
    return Promise.resolve();
  }
}

class ClaimBarrierAdmissionStore implements ModelRuntimeAdmissionStoreV1 {
  readonly #delegate: ModelRuntimeAdmissionStoreV1;
  #arrivals = 0;
  readonly #barrier: Promise<void>;
  readonly #releaseBarrier: () => void;

  public constructor(delegate: ModelRuntimeAdmissionStoreV1) {
    this.#delegate = delegate;
    let releaseBarrier: (() => void) | undefined;
    this.#barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    if (releaseBarrier === undefined) {
      throw new Error("The claim barrier was not initialized.");
    }
    this.#releaseBarrier = releaseBarrier;
  }

  public inspect(
    input: Parameters<ModelRuntimeAdmissionStoreV1["inspect"]>[0],
  ): ReturnType<ModelRuntimeAdmissionStoreV1["inspect"]> {
    return this.#delegate.inspect(input);
  }

  public async claim(
    input: Parameters<ModelRuntimeAdmissionStoreV1["claim"]>[0],
  ): Promise<Awaited<ReturnType<ModelRuntimeAdmissionStoreV1["claim"]>>> {
    this.#arrivals += 1;
    if (this.#arrivals === 2) this.#releaseBarrier();
    await this.#barrier;
    return await this.#delegate.claim(input);
  }

  public assertExecutionLease(
    input: Parameters<ModelRuntimeAdmissionStoreV1["assertExecutionLease"]>[0],
  ): ReturnType<ModelRuntimeAdmissionStoreV1["assertExecutionLease"]> {
    return this.#delegate.assertExecutionLease(input);
  }

  public readOperationalExecutionBinding(
    input: Parameters<
      ModelRuntimeAdmissionStoreV1["readOperationalExecutionBinding"]
    >[0],
  ): ReturnType<
    ModelRuntimeAdmissionStoreV1["readOperationalExecutionBinding"]
  > {
    return this.#delegate.readOperationalExecutionBinding(input);
  }

  public appendOperationalOutbox(
    input: Parameters<
      ModelRuntimeAdmissionStoreV1["appendOperationalOutbox"]
    >[0],
  ): ReturnType<ModelRuntimeAdmissionStoreV1["appendOperationalOutbox"]> {
    return this.#delegate.appendOperationalOutbox(input);
  }

  public checkpointPendingAndRelease(
    input: Parameters<
      ModelRuntimeAdmissionStoreV1["checkpointPendingAndRelease"]
    >[0],
  ): ReturnType<ModelRuntimeAdmissionStoreV1["checkpointPendingAndRelease"]> {
    return this.#delegate.checkpointPendingAndRelease(input);
  }

  public completeAndRelease(
    input: Parameters<ModelRuntimeAdmissionStoreV1["completeAndRelease"]>[0],
  ): ReturnType<ModelRuntimeAdmissionStoreV1["completeAndRelease"]> {
    return this.#delegate.completeAndRelease(input);
  }

  public listPendingOutbox(
    input: Parameters<ModelRuntimeAdmissionStoreV1["listPendingOutbox"]>[0],
  ): ReturnType<ModelRuntimeAdmissionStoreV1["listPendingOutbox"]> {
    return this.#delegate.listPendingOutbox(input);
  }

  public acknowledgeOutbox(
    input: Parameters<ModelRuntimeAdmissionStoreV1["acknowledgeOutbox"]>[0],
  ): ReturnType<ModelRuntimeAdmissionStoreV1["acknowledgeOutbox"]> {
    return this.#delegate.acknowledgeOutbox(input);
  }

  public release(
    input: Parameters<ModelRuntimeAdmissionStoreV1["release"]>[0],
  ): ReturnType<ModelRuntimeAdmissionStoreV1["release"]> {
    return this.#delegate.release(input);
  }
}

function strandingAdmissionStore(delegate: ModelRuntimeAdmissionStoreV1): {
  readonly state: {
    capturedLeases: ModelRuntimeExecutionLeaseV1[];
    claimCalls: number;
    failNextComplete: boolean;
    inspectCalls: number;
    strandNextRelease: boolean;
  };
  readonly store: ModelRuntimeAdmissionStoreV1;
} {
  const state = {
    capturedLeases: [] as ModelRuntimeExecutionLeaseV1[],
    claimCalls: 0,
    failNextComplete: false,
    inspectCalls: 0,
    strandNextRelease: true,
  };
  return {
    state,
    store: {
      acknowledgeOutbox: (input) => delegate.acknowledgeOutbox(input),
      appendOperationalOutbox: (input) =>
        delegate.appendOperationalOutbox(input),
      assertExecutionLease: (input) => delegate.assertExecutionLease(input),
      checkpointPendingAndRelease: (input) =>
        delegate.checkpointPendingAndRelease(input),
      claim: async (input) => {
        state.claimCalls += 1;
        const result = await delegate.claim(input);
        if (result.kind === "claimed") {
          state.capturedLeases.push(structuredClone(result.executionLease));
        }
        return result;
      },
      completeAndRelease: async (input) => {
        if (state.failNextComplete) {
          state.failNextComplete = false;
          throw new Error("Synthetic runtime terminal checkpoint crash.");
        }
        await delegate.completeAndRelease(input);
      },
      inspect: (input) => {
        state.inspectCalls += 1;
        return delegate.inspect(input);
      },
      listPendingOutbox: (input) => delegate.listPendingOutbox(input),
      readOperationalExecutionBinding: (input) =>
        delegate.readOperationalExecutionBinding(input),
      release: async (input) => {
        if (state.strandNextRelease) {
          state.strandNextRelease = false;
          return;
        }
        await delegate.release(input);
      },
    },
  };
}

function tamperingOutboxStore(
  delegate: ModelRuntimeAdmissionStoreV1,
  tamper: (entry: unknown) => unknown,
): {
  readonly acknowledgementState: { count: number };
  readonly store: ModelRuntimeAdmissionStoreV1;
} {
  const acknowledgementState = { count: 0 };
  return {
    acknowledgementState,
    store: {
      acknowledgeOutbox: async (input) => {
        acknowledgementState.count += 1;
        await delegate.acknowledgeOutbox(input);
      },
      appendOperationalOutbox: (input) =>
        delegate.appendOperationalOutbox(input),
      assertExecutionLease: (input) => delegate.assertExecutionLease(input),
      checkpointPendingAndRelease: (input) =>
        delegate.checkpointPendingAndRelease(input),
      claim: (input) => delegate.claim(input),
      completeAndRelease: (input) => delegate.completeAndRelease(input),
      inspect: (input) => delegate.inspect(input),
      readOperationalExecutionBinding: (input) =>
        delegate.readOperationalExecutionBinding(input),
      listPendingOutbox: async (input) => {
        const entries = await delegate.listPendingOutbox(input);
        const first = entries[0];
        return first === undefined ? [] : ([tamper(first)] as never);
      },
      release: (input) => delegate.release(input),
    },
  };
}

function releasedCommercialResponse(
  request: ModelCommercialOperationRequestV1,
): ModelCommercialLifecycleResponseV1 {
  return {
    compensationStatus: "not-required",
    completedCreditUnits: 0,
    denialReason: null,
    estimate: {
      maximumCreditUnits: MAXIMUM_CREDIT_UNITS,
      minimumCreditUnits: 1,
      requiresConfirmation: false,
    },
    reconciliationState: "not-required",
    reservationAccepted: true,
    reservationId: request.reservationId,
    route: "standard",
    routeExplanation: "Reviewed standard route for runtime-control tests.",
    routeLabel: "Standard Design",
    state: "released",
    technicalUnits: null,
    version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
  };
}

class EchoCurrentAuthorityResolver implements ModelRuntimeAuthorityResolverV1 {
  public calls = 0;

  public resolve(
    input: Parameters<ModelRuntimeAuthorityResolverV1["resolve"]>[0],
  ): ReturnType<ModelRuntimeAuthorityResolverV1["resolve"]> {
    this.calls += 1;
    return Promise.resolve(structuredClone(input.candidate));
  }
}

class FakeCanonicalCommercial implements ModelRuntimeCanonicalCommercialPortV1 {
  public authorityTuple: AuthorityBinding["authorityTuple"] =
    authorityBinding.authorityTuple;
  public beforeInvoke: (() => Promise<void> | void) | null = null;
  public calls = 0;
  public executeCalls = 0;
  public reserveCalls = 0;
  public responseMode:
    | "normal"
    | "reconciliation-required"
    | "reservation-crash-once"
    | "settlement-pending-once" = "normal";
  public throwAfterInvokeMarker: string | null = null;
  public throwMarker: string | null = null;
  #dispatchUncertain = false;
  #reservedWithoutDispatch = false;
  #settlementPending = false;
  public deniedState:
    "denied" | "estimate-confirmation-required" | "reservation-denied" | null =
    null;
  public readonly invocationResults: ModelCommercialInvocationResultV1[] = [];
  public invokeCalls = 0;
  public recoverCalls = 0;
  public pricingVersionReference = PRICING_REFERENCE;
  public technicalUnits: NonNullable<
    ModelCommercialLifecycleResponseV1["technicalUnits"]
  > = {
    cacheReadUnits: 0,
    cacheWriteUnits: 0,
    inputUnits: 20,
    outputUnits: 10,
    providerSpecificUnits: [],
    totalUnits: 30,
  };
  #lastResponse: ModelCommercialLifecycleResponseV1 | null = null;

  public async execute(
    request: ModelCommercialOperationRequestV1,
    invoke: (
      context: ModelCommercialInvocationContextV1,
    ) => Promise<ModelCommercialInvocationResultV1>,
  ): Promise<ModelCommercialLifecycleResponseV1> {
    this.executeCalls += 1;
    const response = await this.#executeOnce(request, invoke);
    this.#lastResponse = structuredClone(response);
    return response;
  }

  public async recover(
    request: ModelCommercialOperationRequestV1,
  ): Promise<ModelCommercialLifecycleResponseV1> {
    await Promise.resolve();
    this.calls += 1;
    this.recoverCalls += 1;
    if (this.#reservedWithoutDispatch) {
      this.#reservedWithoutDispatch = false;
      const response = releasedCommercialResponse(request);
      this.#lastResponse = structuredClone(response);
      return response;
    }
    if (this.#dispatchUncertain) {
      this.#dispatchUncertain = false;
      const response = {
        compensationStatus: "not-required" as const,
        completedCreditUnits: null,
        denialReason: null,
        estimate: {
          maximumCreditUnits: MAXIMUM_CREDIT_UNITS,
          minimumCreditUnits: 1,
          requiresConfirmation: false,
        },
        reconciliationState: "pending-missing-usage" as const,
        reservationAccepted: true,
        reservationId: request.reservationId,
        route: "standard" as const,
        routeExplanation: "Reviewed standard route for runtime-control tests.",
        routeLabel: "Standard Design" as const,
        state: "reconciliation-required" as const,
        technicalUnits: null,
        version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
      } satisfies ModelCommercialLifecycleResponseV1;
      this.#lastResponse = structuredClone(response);
      return response;
    }
    if (this.#settlementPending) {
      this.#settlementPending = false;
      const response = {
        compensationStatus: "not-required" as const,
        completedCreditUnits: 1,
        denialReason: null,
        estimate: {
          maximumCreditUnits: MAXIMUM_CREDIT_UNITS,
          minimumCreditUnits: 1,
          requiresConfirmation: false,
        },
        reconciliationState: "not-required" as const,
        reservationAccepted: true,
        reservationId: request.reservationId,
        route: "standard" as const,
        routeExplanation: "Reviewed standard route for runtime-control tests.",
        routeLabel: "Standard Design" as const,
        state: "completed" as const,
        technicalUnits: structuredClone(this.technicalUnits),
        version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
      } satisfies ModelCommercialLifecycleResponseV1;
      this.#lastResponse = structuredClone(response);
      return response;
    }
    if (this.#lastResponse !== null) {
      return structuredClone(this.#lastResponse);
    }
    return {
      compensationStatus: "not-required",
      completedCreditUnits: null,
      denialReason: "reservation-denied",
      estimate: null,
      reconciliationState: "not-required",
      reservationAccepted: false,
      reservationId: null,
      route: null,
      routeExplanation: null,
      routeLabel: null,
      state: "reservation-denied",
      technicalUnits: null,
      version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
    };
  }

  async #executeOnce(
    request: ModelCommercialOperationRequestV1,
    invoke: (
      context: ModelCommercialInvocationContextV1,
    ) => Promise<ModelCommercialInvocationResultV1>,
  ): Promise<ModelCommercialLifecycleResponseV1> {
    this.calls += 1;
    if (this.responseMode === "reservation-crash-once") {
      this.responseMode = "normal";
      this.reserveCalls += 1;
      this.#reservedWithoutDispatch = true;
      throw new Error("Synthetic reserved-before-runtime-checkpoint crash.");
    }
    if (this.throwMarker !== null) throw new Error(this.throwMarker);
    if (this.#dispatchUncertain) {
      this.#dispatchUncertain = false;
      return {
        compensationStatus: "not-required",
        completedCreditUnits: null,
        denialReason: null,
        estimate: {
          maximumCreditUnits: MAXIMUM_CREDIT_UNITS,
          minimumCreditUnits: 1,
          requiresConfirmation: false,
        },
        reconciliationState: "pending-missing-usage",
        reservationAccepted: true,
        reservationId: request.reservationId,
        route: "standard",
        routeExplanation: "Reviewed standard route for runtime-control tests.",
        routeLabel: "Standard Design",
        state: "reconciliation-required",
        technicalUnits: null,
        version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
      };
    }
    if (
      this.responseMode === "settlement-pending-once" &&
      this.#settlementPending
    ) {
      this.#settlementPending = false;
      return {
        compensationStatus: "not-required",
        completedCreditUnits: 1,
        denialReason: null,
        estimate: {
          maximumCreditUnits: MAXIMUM_CREDIT_UNITS,
          minimumCreditUnits: 1,
          requiresConfirmation: false,
        },
        reconciliationState: "not-required",
        reservationAccepted: true,
        reservationId: request.reservationId,
        route: "standard",
        routeExplanation: "Reviewed standard route for runtime-control tests.",
        routeLabel: "Standard Design",
        state: "completed",
        technicalUnits: structuredClone(this.technicalUnits),
        version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
      };
    }
    if (this.deniedState !== null) {
      return {
        compensationStatus: "not-required",
        completedCreditUnits: null,
        denialReason:
          this.deniedState === "estimate-confirmation-required"
            ? "confirmation-required"
            : this.deniedState === "reservation-denied"
              ? "reservation-denied"
              : "insufficient-credits",
        estimate: null,
        reconciliationState: "not-required",
        reservationAccepted: false,
        reservationId: null,
        route: null,
        routeExplanation: null,
        routeLabel: null,
        state: this.deniedState,
        technicalUnits: null,
        version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
      };
    }
    try {
      await this.beforeInvoke?.();
      this.invokeCalls += 1;
      const invocation = await invoke({
        acceptedMaximumCreditUnits: MAXIMUM_CREDIT_UNITS,
        acceptedMaximumEstimatedProviderCostMicros: ESTIMATED_MICRO_USD,
        dispatchIntentId: "runtime_dispatch_intent",
        multiCallWorkflowId: request.multiCallWorkflowId,
        normalizationPolicyCatalogDigest: sha256Text(
          "runtime-normalization-policy-catalog",
        ),
        normalizationPolicyVersionReference:
          "cloudmarkup.normalization.prompt38",
        pricingAuthorityDigest: sha256Text("runtime-pricing-authority"),
        pricingCatalogDigest: sha256Text("runtime-pricing-catalog"),
        pricingVersionReference: this.pricingVersionReference,
        reservationId: request.reservationId,
        route: commercialRoute(
          request.environment === "development",
          this.authorityTuple,
        ),
      });
      this.invocationResults.push(structuredClone(invocation));
      if (this.throwAfterInvokeMarker !== null) {
        this.#dispatchUncertain = true;
        throw new Error(this.throwAfterInvokeMarker);
      }
      const completed =
        invocation.status === "completed" && invocation.usefulOutputDelivered;
      if (this.responseMode === "settlement-pending-once") {
        this.#settlementPending = true;
        return {
          compensationStatus: "not-required",
          completedCreditUnits: null,
          denialReason: null,
          estimate: {
            maximumCreditUnits: MAXIMUM_CREDIT_UNITS,
            minimumCreditUnits: 1,
            requiresConfirmation: false,
          },
          reconciliationState: "pending-settlement",
          reservationAccepted: true,
          reservationId: request.reservationId,
          route: "standard",
          routeExplanation:
            "Reviewed standard route for runtime-control tests.",
          routeLabel: "Standard Design",
          state: "settlement-pending",
          technicalUnits: structuredClone(this.technicalUnits),
          version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
        };
      }
      if (this.responseMode === "reconciliation-required") {
        return {
          compensationStatus: "not-required",
          completedCreditUnits: null,
          denialReason: null,
          estimate: {
            maximumCreditUnits: MAXIMUM_CREDIT_UNITS,
            minimumCreditUnits: 1,
            requiresConfirmation: false,
          },
          reconciliationState: "pending-missing-usage",
          reservationAccepted: true,
          reservationId: request.reservationId,
          route: "standard",
          routeExplanation:
            "Reviewed standard route for runtime-control tests.",
          routeLabel: "Standard Design",
          state: "reconciliation-required",
          technicalUnits: null,
          version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
        };
      }
      return {
        compensationStatus: "not-required",
        completedCreditUnits: completed ? 1 : 0,
        denialReason: null,
        estimate: {
          maximumCreditUnits: MAXIMUM_CREDIT_UNITS,
          minimumCreditUnits: 1,
          requiresConfirmation: false,
        },
        reconciliationState: "not-required",
        reservationAccepted: true,
        reservationId: request.reservationId,
        route: "standard",
        routeExplanation: "Reviewed standard route for runtime-control tests.",
        routeLabel: "Standard Design",
        state: completed ? "completed" : "released",
        technicalUnits: completed ? structuredClone(this.technicalUnits) : null,
        version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
      };
    } catch (error) {
      if (this.#dispatchUncertain) throw error;
      return releasedCommercialResponse(request);
    }
  }
}

const inputEvidenceVerifierByStore = new WeakMap<
  InMemoryModelRuntimeAdmissionStoreV1,
  MemoryHostEvidenceVerifier
>();

interface Harness {
  readonly authorityResolver: EchoCurrentAuthorityResolver;
  readonly commercial: FakeCanonicalCommercial;
  readonly evidenceVerifier: MemoryHostEvidenceVerifier;
  readonly service: ModelRuntimeControlServiceV1;
  readonly store: InMemoryModelRuntimeAdmissionStoreV1;
  readonly telemetry: MemoryTelemetry;
}

function makeHarness(
  store = new InMemoryModelRuntimeAdmissionStoreV1(),
  now: () => string = () => NOW,
): Harness {
  const authorityResolver = new EchoCurrentAuthorityResolver();
  const commercial = new FakeCanonicalCommercial();
  const evidenceVerifier = new MemoryHostEvidenceVerifier();
  inputEvidenceVerifierByStore.set(store, evidenceVerifier);
  const telemetry = new MemoryTelemetry();
  return {
    authorityResolver,
    commercial,
    evidenceVerifier,
    service: new ModelRuntimeControlServiceV1({
      authorityResolver,
      commercial,
      evidenceVerifier,
      now,
      store,
      telemetry,
    }),
    store,
    telemetry,
  };
}

interface BuildExecutionOptions {
  readonly cacheTransform?: (value: ModelCacheKeyInputV1) => unknown;
  readonly commercialExpiresAt?: string;
  readonly commercialRequestTransform?: (
    value: ModelCommercialOperationRequestV1,
  ) => ModelCommercialOperationRequestV1;
  readonly commercialRequestedAt?: string;
  readonly concurrencyLeaseId?: string;
  readonly decisionDecidedAt?: string;
  readonly decisionExpiresAt?: string;
  readonly denialReasons?: readonly DenialReason[];
  readonly evaluationReport?: ModelEvaluationReportV1;
  readonly executionClass?: ModelRuntimeAdmissionRequestV1["executionClass"];
  readonly idempotencyKey?: string;
  readonly inputSalt?: string;
  readonly liveEvaluationAuthority?: ModelLiveEvaluationAuthorityV1;
  readonly operation?: ModelRuntimeAdmissionRequestV1["operation"];
  readonly organizationId?: string;
  readonly policy?: ModelRuntimeControlPolicyV1;
  readonly projectId?: string;
  readonly requestedPatch?: Readonly<Record<string, unknown>>;
  readonly routingDecisionTransform?: (
    value: ModelRoutingDecisionV1,
  ) => unknown;
  readonly routingRequestTransform?: (value: ModelRoutingRequestV1) => unknown;
  readonly suffix?: string;
  readonly userId?: string;
}

interface BuiltExecution {
  readonly input: ModelRuntimeControlExecutionInputV1;
  readonly policy: ModelRuntimeControlPolicyV1;
}

async function buildExecution(
  store: InMemoryModelRuntimeAdmissionStoreV1,
  options: BuildExecutionOptions = {},
): Promise<BuiltExecution> {
  const evidenceVerifier = inputEvidenceVerifierByStore.get(store);
  if (evidenceVerifier === undefined) {
    throw new Error(
      "The runtime test store must be registered with a host Evidence verifier before building an execution.",
    );
  }
  const suffix = options.suffix ?? "one";
  const organizationId = options.organizationId ?? "organization_test";
  const projectId = options.projectId ?? "project_test";
  const userId = options.userId ?? "user_test";
  const idempotencyKey =
    options.idempotencyKey ?? "runtime_idempotency_" + suffix;
  const idempotencyKeyDigest = sha256Text(idempotencyKey);
  const decisionDecidedAt = utcTimestampSchema.parse(
    options.decisionDecidedAt ?? NOW,
  );
  const decisionExpiresAt = utcTimestampSchema.parse(
    options.decisionExpiresAt ?? EXPIRES_AT,
  );
  const trustedEvaluationReport = options.evaluationReport ?? evaluationReport;
  const operation =
    options.operation ??
    options.policy?.evaluationGate.authorityTuple.operation ??
    "operations.propose";
  const selectedBinding =
    trustedEvaluationReport.authorityBindings.find(
      (candidate) =>
        candidate.authorityTupleDigest ===
        options.policy?.evaluationGate.authorityTupleDigest,
    ) ??
    trustedEvaluationReport.authorityBindings.find(
      (candidate) =>
        candidate.authorityTuple.operation === operation &&
        candidate.authorityTuple.role === "standard-planning-generation",
    ) ??
    trustedEvaluationReport.authorityBindings.find(
      (candidate) => candidate.authorityTuple.operation === operation,
    );
  if (selectedBinding === undefined) {
    throw new Error(`The frozen evaluation is missing ${operation} authority.`);
  }
  const tuple = selectedBinding.authorityTuple;
  const routeId =
    tuple.role === "repair-escalation"
      ? ("internal-escalation" as const)
      : tuple.role === "deep-architecture-custom-generation"
        ? ("deep-design" as const)
        : ("standard-design" as const);
  const requestedRoute =
    routeId === "standard-design" ? ("standard" as const) : ("deep" as const);
  const context = {
    ...modelTestContext("runtime_invocation_" + suffix),
    evaluationPolicyId: modelEvaluationDefaultsV1.evaluationPolicyId,
    evaluationPolicyVersion: modelEvaluationDefaultsV1.evaluationPolicyVersion,
    idempotencyKeyDigest,
    scope: {
      ...modelTestContext("runtime_scope_" + suffix).scope,
      organizationId,
      projectId,
      userId,
    },
  };
  const rawRoutingRequest = modelTestRoutingRequest(
    operationRequest(operation),
    context,
    {
      environment:
        options.executionClass === "live-evaluation"
          ? "development"
          : "production",
      ...(options.inputSalt === undefined
        ? {}
        : { inputDigest: sha256Text(options.inputSalt) }),
    },
  );
  const routingRequest = modelRoutingRequestV1Schema.parse(
    options.routingRequestTransform?.(rawRoutingRequest) ?? rawRoutingRequest,
  );
  if (tuple.inferenceProfileId === undefined) {
    throw new Error("The evaluated route must bind its inference profile.");
  }
  const rawRoutingDecision = modelRoutingDecisionV1Schema.parse({
    ...modelTestRoutingDecision(routingRequest),
    automaticEscalationPermitted: routeId !== "internal-escalation",
    ...(routeId === "internal-escalation"
      ? {
          escalation: {
            diagnosticsDigest: sha256Text("runtime-repair-diagnostics"),
            originalAcceptedEstimateMaximumCreditUnits: MAXIMUM_CREDIT_UNITS,
            originalCreditAuthorizationDecisionId:
              "credit_decision_runtime_original",
            originalInvocationId: "runtime_invocation_original",
            originalResult: "validation-failure" as const,
            originalRouteId: "standard-design" as const,
            originalRoutingDecisionDigest: sha256Text(
              "runtime-routing-decision-original",
            ),
          },
          reasonCodes: ["prior-validation-failure" as const],
        }
      : {}),
    capabilityRegistryDigest: tuple.capabilityRegistryDigest,
    customerCharge: {
      acceptedMaximumCreditUnits: MAXIMUM_CREDIT_UNITS,
      incrementalEscalationCreditUnits: 0,
      policy: "accepted-estimate-cap",
    },
    evaluationPolicyId: modelEvaluationDefaultsV1.evaluationPolicyId,
    evaluationPolicyVersion: modelEvaluationDefaultsV1.evaluationPolicyVersion,
    feature: operation,
    inferenceProfileId: tuple.inferenceProfileId,
    modelConfigurationReference: tuple.modelConfigurationReference,
    pricingVersionReference: PRICING_REFERENCE,
    routeId,
    recommendedServiceLevel:
      routeId === "standard-design" ? "standard-design" : "deep-design",
    maximumAttempts: routeId === "internal-escalation" ? 1 : 2,
    effort: routeId === "standard-design" ? "medium" : "high",
    ...(options.executionClass === "live-evaluation"
      ? {}
      : {
          modelId: "cloudmarkup.fake-model.operations",
          modelVersion: "1.0.0",
          providerFamily: "deterministic-fake" as const,
          providerId: "cloudmarkup.deterministic-fake",
        }),
    routeDefinitionDigest: tuple.routeDefinitionDigest,
    routeRegistryDigest: tuple.routeRegistryDigest,
  });
  const routingDecision = modelRoutingDecisionV1Schema.parse(
    options.routingDecisionTransform?.(rawRoutingDecision) ??
      rawRoutingDecision,
  );
  const policy =
    options.policy ?? makePolicy(undefined, trustedEvaluationReport, operation);
  const commercialEstimate = makeCommercialEstimate();
  const requested = {
    dependencyNames: ["zod"],
    edgeCount: 2,
    fileCount: 2,
    moduleSources: ["registry.example/approved/module"],
    nodeCount: 2,
    outputBytes: 5_000,
    outputTokens: 50,
    promptBytes: 1_000,
    providerSources: ["registry.example/approved/provider"],
    repairAttempts: 0,
    repositoryBytes: 5_000,
    repositoryFiles: 2,
    ...options.requestedPatch,
  };
  const inputEvidence = evidenceVerifier.issueInputEvidence({
    authority: {
      credential: false,
      deployment: false,
      shell: false,
      tool: false,
      url: false,
    },
    contractVersion: 1,
    evidenceId: "runtime_input_evidence_" + suffix,
    inputDigest: routingRequest.inputDigest,
    inputSanitized: true,
    noRawSensitiveContent: true,
    operation,
    organizationId,
    projectId,
    recordKind: "model-runtime-input-evidence",
    requested,
    secretRedactionApplied: true,
    sourceOwnership: {
      evidenceDigests: [sha256Text("runtime_input_ownership_" + suffix)],
      status: "verified",
    },
    userId,
    verifierId: namespacedIdentifierSchema.parse(
      "cloudmarkup.runtime.input-evidence-verifier",
    ),
    verifierVersion: semanticVersionSchema.parse("1.0.0"),
  });
  const rawCommercialRequest: ModelCommercialOperationRequestV1 = {
    confirmationRequired: false,
    environment:
      options.executionClass === "live-evaluation" ? "development" : "test",
    estimateAccepted: true,
    eventIdPrefix: "runtime_event_" + suffix,
    expiresAt: options.commercialExpiresAt ?? decisionExpiresAt,
    feature: operation,
    idempotencyKey,
    includeTechnicalUnitDetail: true,
    jobId: "runtime_job_" + suffix,
    multiCallWorkflowId: "runtime_workflow_" + suffix,
    organizationId,
    plannedCalls: [
      {
        kind: "primary",
        maximumUsage: {
          cacheReadUnits: 0,
          cacheWriteUnits: 0,
          inputUnits: 100,
          outputUnits: requested.outputTokens,
          providerSpecificUnits: [],
          totalUnits: 100 + requested.outputTokens,
        },
        minimumUsage: {
          cacheReadUnits: 0,
          cacheWriteUnits: 0,
          inputUnits: 1,
          outputUnits: 1,
          providerSpecificUnits: [],
          totalUnits: 2,
        },
        routeId: routingDecision.routeId,
      },
    ],
    projectId,
    promptId: tuple.promptTemplateId,
    promptVersion: tuple.promptTemplateVersion,
    requestedAt: options.commercialRequestedAt ?? decisionDecidedAt,
    requestedMaximumInputUnits: 100,
    requestedMaximumOutputUnits: requested.outputTokens,
    requestedRoute,
    requestId: "runtime_request_" + suffix,
    reservationId: "runtime_reservation_" + suffix,
    templateId: null,
    templateVersion: null,
    userId,
  };
  const commercialRequest =
    options.commercialRequestTransform?.(rawCommercialRequest) ??
    rawCommercialRequest;
  const plannedUsage = commercialRequest.plannedCalls.reduce(
    (total, call) => ({
      cacheReadTokens: total.cacheReadTokens + call.maximumUsage.cacheReadUnits,
      cacheWriteTokens:
        total.cacheWriteTokens + call.maximumUsage.cacheWriteUnits,
      inputTokens: total.inputTokens + call.maximumUsage.inputUnits,
      invocations: total.invocations + 1,
      outputTokens: total.outputTokens + call.maximumUsage.outputUnits,
      totalTokens: total.totalTokens + call.maximumUsage.totalUnits,
    }),
    {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 0,
      invocations: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  );
  const requestDraft = {
    capabilityRegistryDigest: routingDecision.capabilityRegistryDigest,
    cacheKeyAuthority: policy.cacheKeyAuthority,
    catalogDigest: tuple.catalogDigest,
    commercialEstimate,
    contractVersion: 1 as const,
    evaluationAuthorityTupleDigest: selectedBinding.authorityTupleDigest,
    evaluationReportDigest: trustedEvaluationReport.reportDigest,
    evaluationReportId: trustedEvaluationReport.evaluationReportId,
    evaluationResultSetDigest:
      trustedEvaluationReport.evaluationResultSetDigest,
    executionClass: options.executionClass ?? ("normal" as const),
    idempotencyKeyDigest,
    inputDigest: routingRequest.inputDigest,
    inputEvidenceDigest: inputEvidence.evidenceDigest,
    ...(options.liveEvaluationAuthority === undefined
      ? {}
      : {
          liveEvaluationAuthorityDigest:
            options.liveEvaluationAuthority.authorityDigest,
        }),
    operation,
    organizationId,
    plan: "pro" as const,
    projectId,
    promptTemplateDigest: tuple.promptTemplateDigest,
    recordKind: "model-runtime-admission-request" as const,
    requested,
    responseSchemaDigest: tuple.responseSchemaDigest,
    role: tuple.role,
    routeRegistryDigest: routingDecision.routeRegistryDigest,
    routingDecisionDigest: digestStructuredValue(routingDecision),
    runtimePolicyDigest: policy.policyDigest,
    userId,
  };
  const admissionRequest = modelRuntimeAdmissionRequestV1Schema.parse({
    ...requestDraft,
    requestDigest: digestModelRuntimeAdmissionRequestV1(requestDraft),
  });
  const tenantScopeDigest = digestStructuredValue({
    idempotencyKeyDigest,
    organizationId,
    projectId,
    userId,
  });
  await store.inspect({
    decidedAt: decisionDecidedAt,
    idempotencyKeyDigest,
    organizationId,
    organizationWindowSeconds: policy.requestWindows.organization.windowSeconds,
    projectId,
    requestDigest: admissionRequest.requestDigest,
    runtimePolicyDigest: policy.policyDigest,
    tenantScopeDigest,
    ...(options.liveEvaluationAuthority === undefined
      ? {}
      : {
          liveAuthorityReservation: {
            authorityDigest: options.liveEvaluationAuthority.authorityDigest,
            limits: options.liveEvaluationAuthority.limits,
            planned: {
              cacheReadTokens: plannedUsage.cacheReadTokens,
              cacheWriteTokens: plannedUsage.cacheWriteTokens,
              creditUnits: commercialEstimate.maximumCreditUnits,
              estimatedMicroUsd: commercialEstimate.estimatedMicroUsd,
              inputTokens: plannedUsage.inputTokens,
              invocations: plannedUsage.invocations,
              outputTokens: plannedUsage.outputTokens,
              totalTokens: plannedUsage.totalTokens,
            },
          },
        }),
    userId,
    userWindowSeconds: policy.requestWindows.user.windowSeconds,
  });
  const denialReasons = [...(options.denialReasons ?? [])];
  const primaryDenialReason = denialReasons[0];
  const allowed = primaryDenialReason === undefined;
  const decisionDraft = {
    accountingAuthority: "canonical-commercial-v1" as const,
    authorization: allowed
      ? {
          commercialReservationDecisionId: commercialRequest.reservationId,
          concurrencyLeaseId:
            options.concurrencyLeaseId ?? "runtime_lease_" + suffix,
          entitlementDecisionId: routingRequest.plan.entitlementDecisionId,
        }
      : {},
    commercialEstimateDigest: commercialEstimate.estimateDigest,
    contractVersion: 1 as const,
    decisionId: "runtime_admission_" + suffix,
    decidedAt: decisionDecidedAt,
    denialReasons,
    evaluationAuthorityTupleDigest: selectedBinding.authorityTupleDigest,
    evaluationReportDigest: trustedEvaluationReport.reportDigest,
    evaluationReportId: trustedEvaluationReport.evaluationReportId,
    evaluationResultSetDigest:
      trustedEvaluationReport.evaluationResultSetDigest,
    executionClass: admissionRequest.executionClass,
    ...(allowed ? { expiresAt: decisionExpiresAt } : {}),
    invokeModel: allowed,
    outcome: allowed ? ("allowed" as const) : ("denied" as const),
    recordKind: "model-runtime-admission-decision" as const,
    requestDigest: admissionRequest.requestDigest,
    routingDecisionDigest: admissionRequest.routingDecisionDigest,
    runtimePolicyDigest: policy.policyDigest,
    ...(primaryDenialReason === undefined
      ? {}
      : {
          safeError: {
            code: primaryDenialReason,
            messageKey: namespacedIdentifierSchema.parse(
              "cloudmarkup.runtime.denied",
            ),
            noRawSensitiveValues: true as const,
          },
        }),
    writeAuthority: {
      compiler: false as const,
      deployment: false as const,
      github: false as const,
      payment: false as const,
      repository: false as const,
    },
  };
  const admissionDecision = modelRuntimeAdmissionDecisionV1Schema.parse({
    ...decisionDraft,
    decisionDigest: digestModelRuntimeAdmissionDecisionV1(decisionDraft),
  });
  const rawCacheKey = modelCacheKeyInputV1Schema.parse({
    cacheScope: "organization",
    capabilityDigest: routingDecision.modelCapabilityDigest,
    capabilityRegistryDigest: routingDecision.capabilityRegistryDigest,
    capabilityVersion: routingDecision.modelCapabilityVersion,
    catalogScopeDigest: tuple.catalogDigest,
    contentDigests: [admissionRequest.inputDigest],
    dataResidencyBoundary: DATA_RESIDENCY_BOUNDARY,
    evaluationResultDigest: routingDecision.evaluationResultDigest,
    evaluationResultVersion: routingDecision.evaluationResultVersion,
    inferenceProfileId: routingDecision.inferenceProfileId,
    inputDigest: admissionRequest.inputDigest,
    modelConfigurationReference: routingDecision.modelConfigurationReference,
    modelId: routingDecision.modelId,
    modelVersion: routingDecision.modelVersion,
    organizationId,
    organizationSafePolicyScope: ORGANIZATION_SAFE_POLICY_SCOPE,
    promptDigest: tuple.promptTemplateDigest,
    promptTemplateId: tuple.promptTemplateId,
    promptTemplateVersion: tuple.promptTemplateVersion,
    providerId: routingDecision.providerId,
    responseSchemaDigest: tuple.responseSchemaDigest,
    responseSchemaId:
      "https://schemas.cloudmarkup.com/runtime/prompt38-response.schema.json",
    routeDefinitionDigest: routingDecision.routeDefinitionDigest,
    routeRegistryDigest: routingDecision.routeRegistryDigest,
    routingConfigurationDigest: routingDecision.routingConfigurationDigest,
  });
  const promptCacheKey = routingDecision.promptCachePolicy.enabled
    ? modelCacheKeyInputV1Schema.parse(
        options.cacheTransform?.(rawCacheKey) ?? rawCacheKey,
      )
    : undefined;
  return {
    input: {
      admissionDecision,
      admissionRequest,
      commercialRequest,
      catalogDigest: tuple.catalogDigest,
      evaluationReport: trustedEvaluationReport,
      inputEvidence,
      ...(options.liveEvaluationAuthority === undefined
        ? {}
        : { liveEvaluationAuthority: options.liveEvaluationAuthority }),
      policy,
      ...(promptCacheKey === undefined ? {} : { promptCacheKey }),
      promptTemplateDigest: tuple.promptTemplateDigest,
      responseSchemaDigest: tuple.responseSchemaDigest,
      routingDecision,
      routingRequest,
    },
    policy,
  };
}

function reissueTransportAuthority(
  built: BuiltExecution,
  input: {
    readonly commercialExpiresAt: string;
    readonly commercialRequestedAt?: string;
    readonly decidedAt: string;
    readonly decisionExpiresAt: string;
  },
): BuiltExecution {
  const decisionBase = Object.fromEntries(
    Object.entries(built.input.admissionDecision).filter(
      ([key]) => !["decidedAt", "decisionDigest", "expiresAt"].includes(key),
    ),
  );
  const decisionDraft = {
    ...decisionBase,
    decidedAt: input.decidedAt,
    ...(built.input.admissionDecision.outcome === "allowed"
      ? { expiresAt: input.decisionExpiresAt }
      : {}),
  };
  const admissionDecision = modelRuntimeAdmissionDecisionV1Schema.parse({
    ...decisionDraft,
    decisionDigest: digestModelRuntimeAdmissionDecisionV1(
      decisionDraft as Omit<ModelRuntimeAdmissionDecisionV1, "decisionDigest">,
    ),
  });
  return {
    ...built,
    input: {
      ...built.input,
      admissionDecision,
      commercialRequest: {
        ...built.input.commercialRequest,
        expiresAt: input.commercialExpiresAt,
        requestedAt: input.commercialRequestedAt ?? input.decidedAt,
      },
    },
  };
}
function rebindInputEvidence(
  built: BuiltExecution,
  inputEvidence: ModelRuntimeInputEvidenceV1,
): BuiltExecution {
  const { requestDigest: ignoredRequestDigest, ...requestBase } =
    built.input.admissionRequest;
  void ignoredRequestDigest;
  const requestDraft = {
    ...requestBase,
    inputEvidenceDigest: inputEvidence.evidenceDigest,
  };
  const admissionRequest = modelRuntimeAdmissionRequestV1Schema.parse({
    ...requestDraft,
    requestDigest: digestModelRuntimeAdmissionRequestV1(requestDraft),
  });
  const { decisionDigest: ignoredDecisionDigest, ...decisionBase } =
    built.input.admissionDecision;
  void ignoredDecisionDigest;
  const decisionDraft = {
    ...decisionBase,
    requestDigest: admissionRequest.requestDigest,
  };
  const admissionDecision = modelRuntimeAdmissionDecisionV1Schema.parse({
    ...decisionDraft,
    decisionDigest: digestModelRuntimeAdmissionDecisionV1(decisionDraft),
  });
  return {
    ...built,
    input: {
      ...built.input,
      admissionDecision,
      admissionRequest,
      inputEvidence,
    },
  };
}
function rehashRequestedAdmissionProjection(
  built: BuiltExecution,
  requested: ModelRuntimeAdmissionRequestV1["requested"],
): BuiltExecution {
  const { requestDigest: ignoredRequestDigest, ...requestBase } =
    built.input.admissionRequest;
  void ignoredRequestDigest;
  const requestDraft = { ...requestBase, requested };
  const admissionRequest = modelRuntimeAdmissionRequestV1Schema.parse({
    ...requestDraft,
    requestDigest: digestModelRuntimeAdmissionRequestV1(requestDraft),
  });
  const { decisionDigest: ignoredDecisionDigest, ...decisionBase } =
    built.input.admissionDecision;
  void ignoredDecisionDigest;
  const decisionDraft = {
    ...decisionBase,
    requestDigest: admissionRequest.requestDigest,
  };
  const admissionDecision = modelRuntimeAdmissionDecisionV1Schema.parse({
    ...decisionDraft,
    decisionDigest: digestModelRuntimeAdmissionDecisionV1(decisionDraft),
  });
  return {
    ...built,
    input: {
      ...built.input,
      admissionDecision,
      admissionRequest,
    },
  };
}
function attempt(
  status: ModelCommercialInvocationAttemptV1["status"] = "succeeded",
  live = false,
  tuple: AuthorityBinding["authorityTuple"] = authorityBinding.authorityTuple,
): ModelCommercialInvocationAttemptV1 {
  const route = commercialRoute(live, tuple);
  return {
    attemptId: "runtime_attempt_one",
    attemptKind: "primary",
    attemptNumber: 1,
    callId: "runtime_call_one",
    completedAt: NOW,
    failureCategory: status === "succeeded" ? null : "runtime.test.failure",
    inferenceProfileId: route.inferenceProfileId,
    invocationId: "runtime_invocation_one",
    latencyMilliseconds: 10,
    mayHaveBeenProcessed: true,
    modelId: route.modelId,
    modelVersion: route.modelVersion,
    promptId: tuple.promptTemplateId,
    promptVersion: tuple.promptTemplateVersion,
    providerKey: route.providerKey,
    providerRequestId: "runtime_provider_request_one",
    retryOfAttemptId: null,
    routeId: route.routeId,
    startedAt: NOW,
    status,
    usage: {
      cacheReadUnits: 0,
      cacheWriteUnits: 0,
      inputUnits: 20,
      outputUnits: 10,
      providerSpecificUnits: [],
      totalUnits: 30,
    },
    usageRecordId: "runtime_usage_one",
  };
}
function additionalAttempt(
  kind: ModelCommercialInvocationAttemptV1["attemptKind"],
  attemptNumber: number,
  live = false,
): ModelCommercialInvocationAttemptV1 {
  return {
    ...attempt("succeeded", live),
    attemptId: `runtime_attempt_${String(attemptNumber)}`,
    attemptKind: kind,
    attemptNumber,
    callId: `runtime_call_${String(attemptNumber)}`,
    invocationId: `runtime_invocation_${String(attemptNumber)}`,
    providerRequestId: `runtime_provider_request_${String(attemptNumber)}`,
    retryOfAttemptId: "runtime_attempt_one",
    usageRecordId: `runtime_usage_${String(attemptNumber)}`,
  };
}

function withTwoPlannedCalls(
  request: ModelCommercialOperationRequestV1,
  secondKind: ModelCommercialOperationRequestV1["plannedCalls"][number]["kind"],
): ModelCommercialOperationRequestV1 {
  const primary = request.plannedCalls[0];
  if (primary === undefined) throw new Error("Missing primary planned call.");
  const maximumUsage = {
    ...primary.maximumUsage,
    inputUnits: 50,
    outputUnits: 25,
    totalUnits: 75,
  };
  return {
    ...request,
    plannedCalls: [
      { ...primary, maximumUsage },
      { ...primary, kind: secondKind, maximumUsage },
    ],
  };
}

function withCacheUsage(
  request: ModelCommercialOperationRequestV1,
  cacheReadTokens = 6,
  cacheWriteTokens = 4,
): ModelCommercialOperationRequestV1 {
  return {
    ...request,
    plannedCalls: request.plannedCalls.map((call) => ({
      ...call,
      maximumUsage: {
        ...call.maximumUsage,
        cacheReadUnits: cacheReadTokens,
        cacheWriteUnits: cacheWriteTokens,
        totalUnits:
          cacheReadTokens +
          cacheWriteTokens +
          call.maximumUsage.inputUnits +
          call.maximumUsage.outputUnits,
      },
    })),
  };
}

function validOutput(
  request?: Pick<
    ModelRuntimeAdmissionRequestV1,
    | "catalogDigest"
    | "inputDigest"
    | "operation"
    | "organizationId"
    | "projectId"
    | "responseSchemaDigest"
    | "runtimePolicyDigest"
  >,
): ModelRuntimeSanitizedOutputEvidenceV1 {
  const bindings = {
    ...(request ?? {}),
    outputBytes: 100,
    outputDigest: OUTPUT_DIGEST,
    outputTokens: 10,
  };
  return {
    allowListedOperationsEvidence: hostEvidence(
      "allow-listed-operations",
      bindings,
    ),
    noRawSensitiveContent: true,
    outputBytes: 100,
    outputDigest: OUTPUT_DIGEST,
    outputTokens: 10,
    resultSanitized: true,
    secretRedactionApplied: true,
    sourceOwnershipEvidence: hostEvidence("source-ownership", bindings),
    structuredOutputValidated: true,
  };
}
function operationalOutcomeAuthority(
  harness: Harness,
  built: BuiltExecution,
  result: Pick<
    Awaited<ReturnType<ModelRuntimeControlServiceV1["execute"]>>,
    "admission" | "commercial" | "output"
  >,
  eventKind: ModelRuntimeOperationalEventKindV1,
  safeReasonCodes: readonly string[] = [],
  referenceDigests: readonly Sha256Digest[] = [],
): ModelRuntimeOperationalOutcomeAuthorityV1 {
  const terminalDigest = digestStructuredValue({
    admission: result.admission,
    commercial: result.commercial,
    output: result.output,
  });
  return harness.evidenceVerifier.issueOperationalOutcome({
    contractVersion: 1,
    decisionDigest: built.input.admissionDecision.decisionDigest,
    eventKind,
    issuerId: "cloudmarkup.runtime.operational-outcome-verifier",
    issuerVersion: "1.0.0",
    noRawSensitiveContent: true,
    occurredAt: NOW,
    operation: built.input.admissionRequest.operation,
    organizationId: built.input.admissionRequest.organizationId,
    projectId: built.input.admissionRequest.projectId,
    recordKind: "model-runtime-operational-outcome-authority",
    referenceDigests,
    requestDigest: built.input.admissionRequest.requestDigest,
    safeReasonCodes,
    sourceEvidenceDigests: [
      result.output?.sourceOwnershipEvidence.evidenceDigest ?? terminalDigest,
    ],
    terminalDigest,
    userId: built.input.admissionRequest.userId,
  });
}

function trustedAuthorityBundle(
  input: ModelRuntimeControlExecutionInputV1,
): ModelRuntimeTrustedAuthorityBundleV1 {
  return {
    catalogDigest: input.catalogDigest,
    evaluationReport: input.evaluationReport,
    liveEvaluationAuthority: input.liveEvaluationAuthority,
    policy: input.policy,
    promptTemplateDigest: input.promptTemplateDigest,
    responseSchemaDigest: input.responseSchemaDigest,
    routingDecision: input.routingDecision,
    routingRequest: input.routingRequest,
  };
}

function controlledInvocation(
  output: ModelRuntimeSanitizedOutputEvidenceV1 | null = validOutput(),
  patch: Partial<ModelCommercialInvocationResultV1> = {},
): ModelRuntimeControlledInvocationResultV1 {
  return {
    commercial: {
      attempts: [attempt()],
      completedAt: NOW,
      failureCategory: null,
      resultId: "runtime_result_one",
      status: "completed",
      usefulOutputDelivered: output !== null,
      ...patch,
    },
    output,
  };
}

async function executeDefault(
  harness: Harness,
  built: BuiltExecution,
  invocation?: ModelRuntimeControlledInvocationResultV1,
) {
  const live =
    built.input.admissionRequest.executionClass === "live-evaluation";
  harness.commercial.authorityTuple =
    built.input.policy.evaluationGate.authorityTuple;
  return harness.service.execute(built.input, () =>
    Promise.resolve(
      invocation ??
        controlledInvocation(validOutput(built.input.admissionRequest), {
          attempts: [
            attempt(
              "succeeded",
              live,
              built.input.policy.evaluationGate.authorityTuple,
            ),
          ],
        }),
    ),
  );
}
describe("strict runtime metadata identity projection", () => {
  it("matches the actual runtime claim and commercial request identity without issuing authority", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store);
    const claim = vi.spyOn(harness.store, "claim");
    const projected = projectModelRuntimeExecutionIdentityV1(built.input);
    expect(claim).not.toHaveBeenCalled();
    expect(
      projectModelCommercialOperationIdentityV1(built.input.commercialRequest),
    ).toEqual({
      requestId: built.input.commercialRequest.requestId,
      fingerprint: digestStructuredValue(built.input.commercialRequest),
    });
    await executeDefault(harness, built);
    expect(claim.mock.calls[0]?.[0]).toMatchObject(projected);
  });
  it("rejects changed tenant and malformed commercial request rather than hashing unchecked metadata", async () => {
    const harness = makeHarness();
    const { input } = await buildExecution(harness.store);
    expect(() =>
      projectModelRuntimeExecutionIdentityV1({
        ...input,
        commercialRequest: {
          ...input.commercialRequest,
          organizationId: "different_org",
        },
      }),
    ).toThrow();
    expect(() =>
      projectModelRuntimeExecutionIdentityV1({
        ...input,
        catalogDigest: sha256Text("different-catalog"),
      }),
    ).toThrow();
    expect(() =>
      projectModelRuntimeExecutionIdentityV1({
        ...input,
        responseSchemaDigest: sha256Text("different-schema"),
      }),
    ).toThrow();
    expect(() =>
      projectModelCommercialOperationIdentityV1({
        ...input.commercialRequest,
        unexpected: "extra",
      } as ModelCommercialOperationRequestV1),
    ).toThrow();
    expect(() =>
      projectModelCommercialOperationIdentityV1({
        ...input.commercialRequest,
        expiresAt: input.commercialRequest.requestedAt,
      }),
    ).toThrow();
  });
  it("cannot turn a held evaluation report into actual runtime admission", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store);
    const { reportDigest: _old, ...report } = built.input.evaluationReport;
    void _old;
    const draft = { ...report, activationRecommendation: "hold" as const };
    const held = modelEvaluationReportV1Schema.parse({
      ...draft,
      reportDigest: digestModelEvaluationReportV1(draft),
    });
    const input = { ...built.input, evaluationReport: held };
    const claim = vi.spyOn(harness.store, "claim");
    expect(projectModelRuntimeExecutionIdentityV1(input).fingerprint).not.toBe(
      projectModelRuntimeExecutionIdentityV1(built.input).fingerprint,
    );
    await expect(
      executeDefault(harness, { ...built, input }),
    ).rejects.toBeInstanceOf(ModelRuntimeControlError);
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("memory-only preview execution fencing and verifier parity", () => {
  it("re-resolves current route and policy authority inside the real final dispatch closure", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store);
    harness.commercial.authorityTuple =
      built.policy.evaluationGate.authorityTuple;
    const resolve = vi.spyOn(harness.authorityResolver, "resolve");
    let checked = false;
    const result = await harness.service.execute(
      built.input,
      async (context) => {
        if (context.assertCurrentDispatch === undefined)
          throw new Error("Missing real dispatch fence.");
        expect(await context.assertCurrentDispatch()).toEqual({
          expiresAt: EXPIRES_AT,
        });
        resolve.mockRejectedValueOnce(
          new ModelRuntimeControlError("routing-authority-mismatch"),
        );
        await expect(context.assertCurrentDispatch()).rejects.toBeInstanceOf(
          ModelRuntimeControlError,
        );
        checked = true;
        throw new ModelRuntimeControlError("routing-authority-mismatch");
      },
    );
    expect(checked).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(result.commercial?.state).toBe("released");
    expect(harness.commercial.invocationResults).toEqual([]);
  });
  it.each(["expiry", "release"] as const)(
    "rejects the real current-execution callback after %s while the provider result is pending",
    async (loss) => {
      const baseStore = new InMemoryModelRuntimeAdmissionStoreV1();
      const adapted = strandingAdmissionStore(baseStore);
      adapted.state.strandNextRelease = false;
      let trustedNow = NOW;
      const harness = makeHarness(baseStore, () => trustedNow);
      const service = new ModelRuntimeControlServiceV1({
        authorityResolver: harness.authorityResolver,
        commercial: harness.commercial,
        evidenceVerifier: harness.evidenceVerifier,
        now: () => trustedNow,
        store: adapted.store,
        telemetry: harness.telemetry,
      });
      const built = await buildExecution(baseStore, {
        commercialExpiresAt: "2026-08-22T12:20:10.000Z",
        decisionExpiresAt: "2026-08-22T12:20:10.000Z",
        suffix: `preview_callback_${loss}`,
      });
      harness.commercial.authorityTuple =
        built.policy.evaluationGate.authorityTuple;
      let providerComplete: (() => void) | undefined;
      let providerEntered: (() => void) | undefined;
      const provider = new Promise<void>((resolve) => {
        providerComplete = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        providerEntered = resolve;
      });
      let emitted = 0;
      let callbacks = 0;
      const execution = service.execute(built.input, async (context) => {
        callbacks += 1;
        if (context.assertCurrentExecution === undefined)
          throw new Error("The real runtime must supply its execution fence.");
        await context.assertCurrentExecution();
        if (context.assertCurrentDispatch === undefined)
          throw new Error("Missing real dispatch fence.");
        await context.assertCurrentDispatch();
        providerEntered?.();
        await provider;
        await context.assertCurrentDispatch();
        await context.assertCurrentExecution();
        emitted += 1;
        return controlledInvocation(validOutput(built.input.admissionRequest));
      });
      const denied = expect(execution).rejects.toMatchObject({
        safeCode: "stale-or-duplicate-conflict",
      });
      await entered;
      if (loss === "expiry") {
        // Commercial/admission authority is still current; only the five-minute
        // execution lease has elapsed. No wall-clock sleeps or provider calls.
        trustedNow = "2026-08-22T12:05:10.001Z";
      } else {
        const lease = adapted.state.capturedLeases[0];
        if (lease === undefined)
          throw new Error("A genuine runtime lease was not acquired.");
        await baseStore.release({
          executionLease: lease,
          tenantScopeDigest: digestStructuredValue({
            idempotencyKeyDigest:
              built.input.admissionRequest.idempotencyKeyDigest,
            organizationId: built.input.admissionRequest.organizationId,
            projectId: built.input.admissionRequest.projectId,
            userId: built.input.admissionRequest.userId,
          }),
        });
      }
      providerComplete?.();
      await denied;
      expect(callbacks).toBe(1);
      expect(harness.commercial.invokeCalls).toBe(1);
      expect(harness.commercial.invocationResults).toEqual([]);
      expect(emitted).toBe(0);
    },
  );

  it("keeps a captured callback unusable after the original runtime has completed and released its lease", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "preview_after_completion",
    });
    harness.commercial.authorityTuple =
      built.policy.evaluationGate.authorityTuple;
    let captured: (() => Promise<void>) | undefined;
    const result = await harness.service.execute(
      built.input,
      async (context) => {
        captured = context.assertCurrentExecution;
        if (captured === undefined)
          throw new Error("Missing runtime execution fence.");
        await captured();
        return controlledInvocation(validOutput(built.input.admissionRequest));
      },
    );
    expect(result.output).not.toBeNull();
    if (captured === undefined)
      throw new Error("Missing captured execution fence.");
    await expect(captured()).rejects.toMatchObject({
      safeCode: "stale-or-duplicate-conflict",
    });
    expect(harness.commercial.invokeCalls).toBe(1);
  });

  it.each([
    "valid",
    "oversize",
    "forged-verifier",
    "foreign-scope",
    "extra-field",
  ] as const)(
    "uses the same %s output verification before emission and after the callback",
    async (kind) => {
      const harness = makeHarness();
      const built = await buildExecution(harness.store, {
        suffix: `preview_parity_${kind}`,
      });
      const valid = validOutput(built.input.admissionRequest);
      const output =
        kind === "oversize"
          ? {
              ...valid,
              outputBytes:
                built.input.admissionRequest.requested.outputBytes + 1,
            }
          : kind === "forged-verifier"
            ? {
                ...valid,
                sourceOwnershipEvidence: hostEvidence("source-ownership", {
                  ...built.input.admissionRequest,
                  verifierId: namespacedIdentifierSchema.parse(
                    "cloudmarkup.untrusted.verifier",
                  ),
                }),
              }
            : kind === "foreign-scope"
              ? {
                  ...valid,
                  sourceOwnershipEvidence: hostEvidence("source-ownership", {
                    ...built.input.admissionRequest,
                    organizationId: "organization_other",
                  }),
                }
              : kind === "extra-field"
                ? { ...valid, candidateBody: "Synthetic unapproved body" }
                : valid;
      const supplied = controlledInvocation(output);
      const checked = await verifyModelRuntimeInvocationOutputV1(supplied, {
        admissionRequest: built.input.admissionRequest,
        commercialRequest: built.input.commercialRequest,
        evidenceVerifier: harness.evidenceVerifier,
        liveEvaluationAuthority: built.input.liveEvaluationAuthority,
        policy: built.policy,
        routingDecision: built.input.routingDecision,
      });
      const result = await executeDefault(harness, built, supplied);
      expect(checked.rejected).toBe(kind !== "valid");
      expect(result.output).toEqual(checked.output);
      expect(harness.commercial.invocationResults).toEqual([
        checked.commercial,
      ]);
      if (kind === "valid") {
        expect(checked.output).toEqual(valid);
        expect(checked.commercial.usefulOutputDelivered).toBe(true);
      } else {
        expect(checked.output).toBeNull();
        expect(checked.commercial).toMatchObject({
          status: "internal-failure",
          usefulOutputDelivered: false,
          failureCategory: "cloudmarkup.runtime.result-sanitization-failed",
        });
        if (kind === "oversize" || kind === "extra-field")
          expect(
            harness.telemetry.pairs.some(
              (pair) => pair.audit.eventKind === "safety-issue",
            ),
          ).toBe(true);
      }
    },
  );
});

async function expectInputEvidenceRejectedBeforeState(
  harness: Harness,
  built: BuiltExecution,
  supplied: ModelRuntimeControlExecutionInputV1 = built.input,
): Promise<void> {
  const adapted = strandingAdmissionStore(harness.store);
  const service = new ModelRuntimeControlServiceV1({
    authorityResolver: harness.authorityResolver,
    commercial: harness.commercial,
    evidenceVerifier: harness.evidenceVerifier,
    now: () => NOW,
    store: adapted.store,
    telemetry: harness.telemetry,
  });
  let callbackCalls = 0;
  await expect(
    service.execute(supplied, () => {
      callbackCalls += 1;
      return Promise.resolve(controlledInvocation());
    }),
  ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
  expect(adapted.state.inspectCalls).toBe(0);
  expect(adapted.state.claimCalls).toBe(0);
  expect(harness.authorityResolver.calls).toBe(0);
  expect(harness.commercial.calls).toBe(0);
  expect(harness.commercial.invokeCalls).toBe(0);
  expect(callbackCalls).toBe(0);
  expect(harness.telemetry.pairs).toHaveLength(0);
}

function issueChangedInputEvidence(
  harness: Harness,
  source: ModelRuntimeInputEvidenceV1,
  patch: Partial<Omit<ModelRuntimeInputEvidenceV1, "evidenceDigest">>,
): ModelRuntimeInputEvidenceV1 {
  const { evidenceDigest: ignored, ...base } = source;
  void ignored;
  return harness.evidenceVerifier.issueInputEvidence({ ...base, ...patch });
}
function makeUnissuedInputEvidence(
  source: ModelRuntimeInputEvidenceV1,
  patch: Partial<Omit<ModelRuntimeInputEvidenceV1, "evidenceDigest">>,
): ModelRuntimeInputEvidenceV1 {
  const { evidenceDigest: ignored, ...base } = source;
  void ignored;
  const draft = { ...base, ...patch };
  return modelRuntimeInputEvidenceV1Schema.parse({
    ...draft,
    evidenceDigest: digestModelRuntimeInputEvidenceV1(draft),
  });
}
function makeLiveReport(
  authority: ModelLiveEvaluationAuthorityV1,
): ModelEvaluationReportV1 {
  const base = structuredClone(evaluationReport);
  delete (base as Partial<ModelEvaluationReportV1>).reportDigest;
  const draft = {
    ...base,
    environment: authority.environment,
    evaluationReportId: "runtime_live_evaluation_report",
    executionMode: "opt-in-live" as const,
    liveEvaluationAuthorityDigest: authority.authorityDigest,
    normalCi: false,
  };
  return modelEvaluationReportV1Schema.parse({
    ...draft,
    reportDigest: digestModelEvaluationReportV1(draft),
  });
}

function pinPolicyToReport(
  policy: ModelRuntimeControlPolicyV1,
  report: ModelEvaluationReportV1,
): ModelRuntimeControlPolicyV1 {
  const { policyDigest, ...base } = policy;
  void policyDigest;
  const draft = {
    ...base,
    evaluationGate: {
      ...base.evaluationGate,
      deterministicPassed: report.deterministicPassed as true,
      deterministicQualityBasisPoints: report.deterministicQualityBasisPoints,
      evaluationReportDigest: report.reportDigest,
      evaluationReportId: report.evaluationReportId,
      evaluationResultSetDigest: report.evaluationResultSetDigest,
    },
  };
  return modelRuntimeControlPolicyV1Schema.parse({
    ...draft,
    policyDigest: digestModelRuntimeControlPolicyV1(draft),
  });
}
function makeLiveAuthority(
  policy: ModelRuntimeControlPolicyV1,
  limits: ModelLiveEvaluationAuthorityV1["limits"] = {
    maximumConcurrentJobs: 1,
    maximumCreditUnits: MAXIMUM_CREDIT_UNITS,
    maximumEstimatedMicroUsd: ESTIMATED_MICRO_USD,
    maximumInputTokens: 100,
    maximumInvocations: 1,
    maximumOutputTokens: 50,
    maximumTotalTokens: 150,
  },
): ModelLiveEvaluationAuthorityV1 {
  const draft = {
    approved: true as const,
    authorityId: "runtime_live_authority_one",
    canonicalCommercialAuthority: "canonical-commercial-v1" as const,
    contractVersion: 1 as const,
    createdAt: utcTimestampSchema.parse("2026-08-22T11:59:00.000Z"),
    datasetCaseDigests: evaluationReport.datasetCaseDigests,
    datasetDigest: evaluationReport.datasetDigest,
    environment: "development" as const,
    evaluationPolicyDigest: evaluationReport.evaluationPolicyDigest,
    evaluationPolicyId: evaluationReport.evaluationPolicyId,
    evaluationPolicyVersion: evaluationReport.evaluationPolicyVersion,
    expiresAt: utcTimestampSchema.parse(EXPIRES_AT),
    killSwitchEngaged: false as const,
    limits,
    modelConfigurationReferences: [
      authorityBinding.authorityTuple.modelConfigurationReference,
    ],
    normalCi: false as const,
    optIn: true as const,
    organizationId: "organization_test",
    promptTemplateDigests: [
      authorityBinding.authorityTuple.promptTemplateDigest,
    ],
    recordKind: "model-live-evaluation-authority" as const,
    runtimeControlConfigurationDigest: policy.runtimeControlConfigurationDigest,
    runtimePolicyId: policy.policyId,
    runtimePolicyVersion: policy.policyVersion,
  };
  return modelLiveEvaluationAuthorityV1Schema.parse({
    ...draft,
    authorityDigest: digestModelLiveEvaluationAuthorityV1(draft),
  });
}

describe("ModelRuntimeControlServiceV1", () => {
  it("invokes only through the canonical commercial callback and emits safe canonical projections", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store);
    const result = await executeDefault(harness, built);

    expect(result).toMatchObject({
      commercial: { completedCreditUnits: 1, state: "completed" },
      output: { structuredOutputValidated: true },
      replayed: false,
    });
    expect(harness.commercial.calls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);
    expect(harness.telemetry.pairs.map((pair) => pair.audit.eventKind)).toEqual(
      expect.arrayContaining([
        "request",
        "model-route",
        "estimated-cost",
        "reserve",
        "settle",
        "credits",
        "tokens",
      ]),
    );
    expect(JSON.stringify(harness.telemetry.pairs)).not.toContain(
      "sanitized-runtime-output",
    );
  });

  it("passes exact authenticated input Evidence to the controlled invocation callback", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "authenticated_input_callback",
    });
    harness.commercial.authorityTuple =
      built.input.policy.evaluationGate.authorityTuple;
    let received: ModelRuntimeControlledInvocationContextV1 | undefined;
    const result = await harness.service.execute(built.input, (context) => {
      // The host-owned fence is deliberately a closure, not serializable data.
      // Keep the actual callback context so clone-isolation assertions below
      // verify the runtime rather than a second clone made by this test.
      received = context;
      return Promise.resolve(
        controlledInvocation(validOutput(built.input.admissionRequest)),
      );
    });

    expect(result.commercial?.state).toBe("completed");
    if (received === undefined) {
      throw new Error(
        "The controlled callback did not receive input Evidence.",
      );
    }
    expect(received.commercial.reservationId).toBe(
      built.input.commercialRequest.reservationId,
    );
    expect(received.inputEvidence).toEqual(built.input.inputEvidence);
    expect(received.inputEvidence).not.toBe(built.input.inputEvidence);
    expect(typeof received.assertCurrentExecution).toBe("function");
    expect(harness.evidenceVerifier.inputCalls).toEqual([
      built.input.inputEvidence,
    ]);
  });

  it("reauthenticates the same issued input Evidence on terminal replay without reinvocation or recharge", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "input_evidence_terminal_replay",
    });
    const first = await executeDefault(harness, built);
    const replay = await executeDefault(harness, built);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(harness.evidenceVerifier.inputCalls).toEqual([
      built.input.inputEvidence,
      built.input.inputEvidence,
    ]);
    expect(harness.commercial.calls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);
  });
  it("rejects forged input Evidence before verifier, state, commercial, or model work", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "forged_input_evidence",
    });
    await expectInputEvidenceRejectedBeforeState(harness, built, {
      ...built.input,
      inputEvidence: {
        ...built.input.inputEvidence,
        evidenceId: "runtime_input_evidence_forged",
      },
    });
    expect(harness.evidenceVerifier.inputCalls).toHaveLength(0);
  });

  it("rejects structurally valid but unissued input Evidence before state or commercial work", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "unissued_input_evidence",
    });
    const unissued = makeUnissuedInputEvidence(built.input.inputEvidence, {
      evidenceId: "runtime_input_evidence_not_issued",
    });
    await expectInputEvidenceRejectedBeforeState(
      harness,
      rebindInputEvidence(built, unissued),
    );
    expect(harness.evidenceVerifier.inputCalls).toEqual([unissued]);
  });

  it("rejects an issued input Evidence substitution not bound by admission", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "substituted_input_evidence",
    });
    const substituted = issueChangedInputEvidence(
      harness,
      built.input.inputEvidence,
      { evidenceId: "runtime_input_evidence_substitute" },
    );
    await expectInputEvidenceRejectedBeforeState(harness, built, {
      ...built.input,
      inputEvidence: substituted,
    });
    expect(harness.evidenceVerifier.inputCalls).toHaveLength(0);
  });

  it("rejects issued cross-tenant input Evidence even when a caller rehashes admission", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "cross_tenant_input_evidence",
    });
    const crossTenant = issueChangedInputEvidence(
      harness,
      built.input.inputEvidence,
      {
        evidenceId: "runtime_input_evidence_cross_tenant",
        organizationId: "organization_attacker",
      },
    );
    await expectInputEvidenceRejectedBeforeState(
      harness,
      rebindInputEvidence(built, crossTenant),
    );
    expect(harness.evidenceVerifier.inputCalls).toHaveLength(0);
  });

  it.each([["prompt bytes", { promptBytes: 999 }]] as const)(
    "rejects self-rehashed admission that underreports %s against unchanged issued Evidence",
    async (label, requestedPatch) => {
      const harness = makeHarness();
      const built = await buildExecution(harness.store, {
        suffix: "request_underreport_" + label.replaceAll(" ", "_"),
      });
      const forged = rehashRequestedAdmissionProjection(built, {
        ...built.input.admissionRequest.requested,
        ...requestedPatch,
      });
      await expectInputEvidenceRejectedBeforeState(harness, forged);
      expect(harness.evidenceVerifier.inputCalls).toHaveLength(0);
    },
  );
  it.each([
    ["dependency list", { dependencyNames: [] as string[] }],
    ["prompt bytes", { promptBytes: 999 }],
  ] as const)(
    "rejects issued evidence whose exact requested %s projection differs before state access",
    async (label, requestedPatch) => {
      const harness = makeHarness();
      const built = await buildExecution(harness.store, {
        suffix: "input_projection_" + label.replaceAll(" ", "_"),
      });
      const changed = issueChangedInputEvidence(
        harness,
        built.input.inputEvidence,
        {
          evidenceId:
            built.input.inputEvidence.evidenceId +
            "_changed_" +
            label.replaceAll(" ", "_"),
          requested: {
            ...built.input.inputEvidence.requested,
            ...requestedPatch,
          },
        },
      );
      await expectInputEvidenceRejectedBeforeState(
        harness,
        rebindInputEvidence(built, changed),
      );
      expect(harness.evidenceVerifier.inputCalls).toHaveLength(0);
    },
  );

  it("rejects secret-bearing input Evidence before durable verification or state access", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      requestedPatch: {
        dependencyNames: ["github_pat_abcdefghijklmnopqrstuv"],
      },
      suffix: "secret_bearing_input_evidence",
    });
    await expectInputEvidenceRejectedBeforeState(harness, built);
    expect(harness.evidenceVerifier.inputCalls).toHaveLength(0);
  });

  it("rejects unredacted input Evidence before verifier, state, commercial, or model work", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "unredacted_input_evidence",
    });
    await expectInputEvidenceRejectedBeforeState(harness, built, {
      ...built.input,
      inputEvidence: {
        ...built.input.inputEvidence,
        secretRedactionApplied: false,
      } as unknown as ModelRuntimeInputEvidenceV1,
    });
    expect(harness.evidenceVerifier.inputCalls).toHaveLength(0);
  });
  it.each([
    [
      "prompt bytes",
      "maximumPromptBytes",
      "promptBytes",
      "input-limit-exceeded",
    ],
    [
      "repository bytes",
      "maximumRepositoryBytes",
      "repositoryBytes",
      "input-limit-exceeded",
    ],
    [
      "repository files",
      "maximumRepositoryFiles",
      "repositoryFiles",
      "input-limit-exceeded",
    ],
    ["candidate files", "maximumFiles", "fileCount", "input-limit-exceeded"],
    ["nodes", "maximumNodes", "nodeCount", "input-limit-exceeded"],
    ["edges", "maximumEdges", "edgeCount", "input-limit-exceeded"],
    [
      "output bytes",
      "maximumOutputBytes",
      "outputBytes",
      "output-limit-exceeded",
    ],
    [
      "output tokens",
      "maximumOutputTokens",
      "outputTokens",
      "output-limit-exceeded",
    ],
    [
      "repair attempts",
      "maximumRepairAttempts",
      "repairAttempts",
      "repair-limit-exceeded",
    ],
  ] as const)(
    "denies %s before commercial or model work",
    async (_label, limitKey, requestedKey, reason) => {
      const harness = makeHarness();
      const maximum = limitKey === "maximumRepairAttempts" ? 0 : 1;
      const requested = limitKey === "maximumRepairAttempts" ? 1 : 2;
      const policy = makePolicy((draft) => ({
        ...draft,
        limits: { ...draft.limits, [limitKey]: maximum },
      }));
      const built = await buildExecution(harness.store, {
        denialReasons: [reason],
        policy,
        requestedPatch: { [requestedKey]: requested },
      });
      const result = await executeDefault(harness, built);

      expect(result.commercial).toBeNull();
      expect(result.admission.denialReasons).toEqual([reason]);
      expect(harness.commercial.calls).toBe(0);
      expect(harness.commercial.invokeCalls).toBe(0);
    },
  );

  it.each([
    [
      "dependency",
      { dependencyNames: ["unapproved-package"] },
      "dependency-not-allow-listed",
    ],
    [
      "provider",
      { providerSources: ["registry.example/unapproved/provider"] },
      "provider-not-allow-listed",
    ],
    [
      "module",
      { moduleSources: ["registry.example/unapproved/module"] },
      "module-not-allow-listed",
    ],
  ] as const)(
    "denies an unapproved %s before reservation",
    async (_label, requestedPatch, reason) => {
      const harness = makeHarness();
      const built = await buildExecution(harness.store, {
        denialReasons: [reason],
        requestedPatch,
      });
      const result = await executeDefault(harness, built);
      expect(result.admission.denialReasons).toEqual([reason]);
      expect(harness.commercial.calls).toBe(0);
    },
  );

  it.each([
    [
      "route",
      (draft: PolicyConfigurationDraft) => ({
        ...draft,
        allowlists: { ...draft.allowlists, routes: ["deep-design"] },
      }),
    ],
    [
      "role",
      (draft: PolicyConfigurationDraft) => ({
        ...draft,
        allowlists: { ...draft.allowlists, roles: ["fallback"] },
      }),
    ],
    [
      "model configuration",
      (draft: PolicyConfigurationDraft) => ({
        ...draft,
        allowlists: {
          ...draft.allowlists,
          modelConfigurationReferences: [evaluationReport.evaluationPolicyId],
        },
      }),
    ],
  ] as const)("denies an unapproved %s", async (_label, transform) => {
    const harness = makeHarness();
    const policy = makePolicy(transform);
    const built = await buildExecution(harness.store, {
      denialReasons: ["model-not-allow-listed"],
      policy,
    });
    const result = await executeDefault(harness, built);
    expect(result.admission.denialReasons).toEqual(["model-not-allow-listed"]);
    expect(harness.commercial.calls).toBe(0);
  });

  it.each(["organization", "user"] as const)(
    "enforces %s administrative suspension",
    async (scope) => {
      const harness = makeHarness();
      const policy = makePolicy((draft) => ({
        ...draft,
        administrativeSuspensions: [
          {
            reasonCode: evaluationReport.evaluationPolicyId,
            scope,
            scopeId:
              scope === "organization" ? "organization_test" : "user_test",
          },
        ],
      }));
      const built = await buildExecution(harness.store, {
        denialReasons: ["administratively-suspended"],
        policy,
      });
      expect((await executeDefault(harness, built)).commercial).toBeNull();
      expect(harness.commercial.calls).toBe(0);
    },
  );

  it.each(["capability"] as readonly ("global" | "capability")[])(
    "enforces the %s kill switch",
    async (kind) => {
      const harness = makeHarness();
      const policy = makePolicy((draft) => ({
        ...draft,
        killSwitches:
          kind === "global"
            ? {
                capabilitySwitches: [],
                global: {
                  engaged: true,
                  reasonCode: evaluationReport.evaluationPolicyId,
                },
              }
            : {
                capabilitySwitches: [
                  {
                    engaged: true,
                    operation: "operations.propose",
                    reasonCode: evaluationReport.evaluationPolicyId,
                  },
                ],
                global: { engaged: false },
              },
      }));
      const built = await buildExecution(harness.store, {
        denialReasons: ["capability-killed"],
        policy,
      });
      expect((await executeDefault(harness, built)).commercial).toBeNull();
      expect(harness.commercial.calls).toBe(0);
    },
  );

  it("enforces plan feature entitlement and trusted routing entitlement", async () => {
    const policyHarness = makeHarness();
    const policy = makePolicy((draft) => ({
      ...draft,
      featureEntitlements: [
        { features: ["architecture.propose"], plan: "pro" },
      ],
    }));
    const policyDenied = await buildExecution(policyHarness.store, {
      denialReasons: ["feature-not-entitled"],
      policy,
    });
    expect(
      (await executeDefault(policyHarness, policyDenied)).commercial,
    ).toBeNull();

    const routeHarness = makeHarness();
    const routeDenied = await buildExecution(routeHarness.store, {
      denialReasons: ["feature-not-entitled"],
      routingDecisionTransform: (decision) => ({
        ...decision,
        entitlement: { ...decision.entitlement, allowed: false },
        outcome: "denied",
      }),
    });
    expect(
      (await executeDefault(routeHarness, routeDenied)).commercial,
    ).toBeNull();
    expect(policyHarness.commercial.calls + routeHarness.commercial.calls).toBe(
      0,
    );
  });

  it("enforces trusted credit denial before the canonical callback", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      denialReasons: ["insufficient-credits"],
      routingDecisionTransform: (decision) => ({
        ...decision,
        creditAuthorization: {
          ...decision.creditAuthorization,
          allowed: false,
        },
        outcome: "denied",
      }),
    });
    expect((await executeDefault(harness, built)).commercial).toBeNull();
    expect(harness.commercial.calls).toBe(0);
  });

  it.each(["user", "organization"] as const)(
    "atomically enforces the %s request window",
    async (scope) => {
      const harness = makeHarness();
      const policy = makePolicy((draft) => ({
        ...draft,
        requestWindows: {
          organization: {
            ...draft.requestWindows.organization,
            maximumRequests: scope === "organization" ? 1 : 100,
          },
          user: {
            ...draft.requestWindows.user,
            maximumRequests: scope === "user" ? 1 : 100,
          },
        },
      }));
      const first = await buildExecution(harness.store, {
        policy,
        suffix: "window_first_" + scope,
      });
      await executeDefault(harness, first);
      const second = await buildExecution(harness.store, {
        denialReasons: ["request-limit-exceeded"],
        policy,
        suffix: "window_second_" + scope,
        userId: scope === "organization" ? "user_second" : "user_test",
      });
      const denied = await executeDefault(harness, second);
      expect(denied.admission.denialReasons).toEqual([
        "request-limit-exceeded",
      ]);
      expect(harness.commercial.calls).toBe(1);
    },
  );

  it.each(["user", "organization"] as const)(
    "atomically enforces %s concurrency and releases the first lease",
    async (scope) => {
      const harness = makeHarness();
      const policy = makePolicy((draft) => ({
        ...draft,
        requestWindows: {
          organization: {
            ...draft.requestWindows.organization,
            maximumConcurrentJobs: scope === "organization" ? 1 : 10,
          },
          user: {
            ...draft.requestWindows.user,
            maximumConcurrentJobs: scope === "user" ? 1 : 10,
          },
        },
      }));
      let releaseFirst: (() => void) | undefined;
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const first = await buildExecution(harness.store, {
        policy,
        suffix: "concurrency_first_" + scope,
      });
      const firstExecution = harness.service.execute(first.input, async () => {
        markStarted?.();
        await release;
        return controlledInvocation(validOutput(first.input.admissionRequest));
      });
      await started;
      const second = await buildExecution(harness.store, {
        denialReasons: ["concurrency-limit-exceeded"],
        policy,
        suffix: "concurrency_second_" + scope,
        userId: scope === "organization" ? "user_second" : "user_test",
      });
      const denied = await executeDefault(harness, second);
      expect(denied.admission.denialReasons).toEqual([
        "concurrency-limit-exceeded",
      ]);
      releaseFirst?.();
      await firstExecution;
      expect(harness.commercial.calls).toBe(1);
    },
  );

  it("replays an allowed terminal without another reservation or model call", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store);
    const first = await executeDefault(harness, built);
    const replay = await executeDefault(harness, built);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.commercial).toEqual(first.commercial);
    expect(harness.commercial.calls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);
  });

  it("fences a concurrent exact replay before a second commercial callback", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "concurrent_exact_replay",
    });
    let enterFirst: (() => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enterFirst = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = harness.service.execute(built.input, async () => {
      enterFirst?.();
      await release;
      return controlledInvocation(validOutput(built.input.admissionRequest));
    });
    await entered;
    await expect(executeDefault(harness, built)).rejects.toMatchObject({
      safeCode: "stale-or-duplicate-conflict",
    });
    expect(harness.commercial.calls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);
    releaseFirst?.();
    await expect(first).resolves.toMatchObject({
      commercial: { state: "completed" },
      replayed: false,
    });
  });

  it("atomically owns active concurrency lease IDs within an organization and permits reuse after release", async () => {
    const harness = makeHarness();
    const sharedLeaseId = "runtime_lease_shared_active_owner";
    let releaseFirst: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = await buildExecution(harness.store, {
      concurrencyLeaseId: sharedLeaseId,
      suffix: "lease_owner_first",
    });
    const firstExecution = harness.service.execute(first.input, async () => {
      markStarted?.();
      await release;
      return controlledInvocation(validOutput(first.input.admissionRequest));
    });
    await started;

    const second = await buildExecution(harness.store, {
      concurrencyLeaseId: sharedLeaseId,
      suffix: "lease_owner_second",
    });
    await expect(executeDefault(harness, second)).rejects.toMatchObject({
      safeCode: "stale-or-duplicate-conflict",
    });
    const inspectInput = {
      decidedAt: NOW,
      idempotencyKeyDigest: second.input.admissionRequest.idempotencyKeyDigest,
      organizationId: second.input.admissionRequest.organizationId,
      organizationWindowSeconds:
        second.policy.requestWindows.organization.windowSeconds,
      projectId: second.input.admissionRequest.projectId,
      requestDigest: second.input.admissionRequest.requestDigest,
      runtimePolicyDigest: second.policy.policyDigest,
      tenantScopeDigest: digestStructuredValue({
        idempotencyKeyDigest:
          second.input.admissionRequest.idempotencyKeyDigest,
        organizationId: second.input.admissionRequest.organizationId,
        projectId: second.input.admissionRequest.projectId,
        userId: second.input.admissionRequest.userId,
      }),
      userId: second.input.admissionRequest.userId,
      userWindowSeconds: second.policy.requestWindows.user.windowSeconds,
    };
    expect(
      (await harness.store.inspect(inspectInput)).activeConcurrencyLeaseIds,
    ).toEqual([sharedLeaseId]);
    expect(harness.commercial.calls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);

    releaseFirst?.();
    await firstExecution;
    expect(
      (await harness.store.inspect(inspectInput)).activeConcurrencyLeaseIds,
    ).toEqual([]);

    const reused = await buildExecution(harness.store, {
      concurrencyLeaseId: sharedLeaseId,
      suffix: "lease_owner_reused",
    });
    await expect(executeDefault(harness, reused)).resolves.toMatchObject({
      commercial: { state: "completed" },
    });
    expect(harness.commercial.calls).toBe(2);
    expect(harness.commercial.invokeCalls).toBe(2);
  });
  it("atomically grants one capacity lease to two independently valid concurrent requests", async () => {
    const baseStore = new InMemoryModelRuntimeAdmissionStoreV1();
    const harness = makeHarness(baseStore);
    const policy = makePolicy((draft) => ({
      ...draft,
      requestWindows: {
        organization: {
          ...draft.requestWindows.organization,
          maximumConcurrentJobs: 1,
        },
        user: {
          ...draft.requestWindows.user,
          maximumConcurrentJobs: 1,
        },
      },
    }));
    const firstBuilt = await buildExecution(baseStore, {
      policy,
      suffix: "atomic_capacity_first",
    });
    const secondBuilt = await buildExecution(baseStore, {
      policy,
      suffix: "atomic_capacity_second",
    });
    const barrierStore = new ClaimBarrierAdmissionStore(baseStore);
    const service = new ModelRuntimeControlServiceV1({
      authorityResolver: harness.authorityResolver,
      commercial: harness.commercial,
      evidenceVerifier: harness.evidenceVerifier,
      now: () => NOW,
      store: barrierStore,
      telemetry: harness.telemetry,
    });
    let modelCallbacks = 0;
    const run = (built: BuiltExecution) =>
      service.execute(built.input, () => {
        modelCallbacks += 1;
        return Promise.resolve(
          controlledInvocation(validOutput(built.input.admissionRequest)),
        );
      });
    const outcomes = await Promise.allSettled([
      run(firstBuilt),
      run(secondBuilt),
    ]);
    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === "fulfilled",
    );
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status !== "rejected") {
      throw new Error("Expected one atomic capacity rejection.");
    }
    expect(rejected.reason).toMatchObject({
      safeCode: "stale-or-duplicate-conflict",
    });
    expect(harness.commercial.calls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);
    expect(modelCallbacks).toBe(1);
  });
  it.each([
    [
      "unknown top-level field",
      (entry: unknown) => ({
        ...(entry as Record<string, unknown>),
        rawSecret: "sk-provider-secret",
      }),
    ],
    [
      "unknown nested field",
      (entry: unknown) => {
        const record = entry as {
          readonly audit: Record<string, unknown>;
          readonly metric: unknown;
          readonly outboxId: unknown;
        };
        return {
          ...record,
          audit: { ...record.audit, rawSecret: "sk-provider-secret" },
        };
      },
    ],
    [
      "mismatched identity",
      (entry: unknown) => ({
        ...(entry as Record<string, unknown>),
        outboxId: sha256Text("mismatched-outbox"),
      }),
    ],
    [
      "credential-shaped safe code",
      (entry: unknown) => {
        const record = entry as {
          readonly audit: ModelRuntimeAuditEventV1;
          readonly metric: ModelRuntimeMetricV1;
        };
        const audit = {
          ...record.audit,
          safeReasonCodes: ["cloudmarkup.sk-provider-secret"],
        };
        return {
          audit,
          metric: record.metric,
          outboxId: digestStructuredValue({ audit, metric: record.metric }),
        };
      },
    ],
  ] as const)(
    "rejects malicious production-store outbox output with %s before publish or acknowledgement",
    async (_label, tamper) => {
      const baseStore = new InMemoryModelRuntimeAdmissionStoreV1();
      const harness = makeHarness(baseStore);
      const built = await buildExecution(baseStore, {
        suffix: `malicious_outbox_${_label.replaceAll(" ", "_")}`,
      });
      const adapted = tamperingOutboxStore(baseStore, tamper);
      const service = new ModelRuntimeControlServiceV1({
        authorityResolver: harness.authorityResolver,
        commercial: harness.commercial,
        evidenceVerifier: harness.evidenceVerifier,
        now: () => NOW,
        store: adapted.store,
        telemetry: harness.telemetry,
      });
      await expect(
        service.execute(built.input, () =>
          Promise.resolve(
            controlledInvocation(validOutput(built.input.admissionRequest)),
          ),
        ),
      ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
      expect(harness.telemetry.pairs).toHaveLength(0);
      expect(adapted.acknowledgementState.count).toBe(0);
      expect(harness.commercial.calls).toBe(0);
    },
  );

  it.each([
    ["claim", 1, false],
    ["terminal", 4, true],
  ] as const)(
    "drains an idempotent %s outbox after publish succeeded but acknowledgement failed",
    async (boundary, failedPublishAttempt, replayed) => {
      const harness = makeHarness();
      harness.telemetry.failAfterPersist(failedPublishAttempt);
      const built = await buildExecution(harness.store, {
        suffix: `outbox_retry_${boundary}_${String(failedPublishAttempt)}`,
      });
      let caught: unknown;
      try {
        await executeDefault(harness, built);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ safeCode: "runtime-control-unavailable" });
      expect(String(caught)).not.toContain(
        "Synthetic telemetry publish failure",
      );
      const result = await executeDefault(harness, built);
      expect(result.replayed).toBe(replayed);
      expect(harness.commercial.calls).toBe(1);
      expect(harness.commercial.invokeCalls).toBe(1);
      expect(harness.telemetry.publishAttempts).toBe(
        harness.telemetry.pairs.length + 1,
      );
      expect(
        new Set(harness.telemetry.pairs.map((pair) => pair.audit.eventId)).size,
      ).toBe(harness.telemetry.pairs.length);
      expect(
        new Set(harness.telemetry.pairs.map((pair) => pair.audit.eventKind)),
      ).toEqual(
        expect.objectContaining(
          new Set([
            "credits",
            "estimated-cost",
            "model-route",
            "request",
            "reserve",
            "settle",
            "tokens",
          ]),
        ),
      );
    },
  );

  it("records and replays a denial without charging or recounting", async () => {
    const harness = makeHarness();
    const policy = makePolicy((draft) => ({
      ...draft,
      killSwitches: {
        capabilitySwitches: [],
        global: {
          engaged: true,
          reasonCode: evaluationReport.evaluationPolicyId,
        },
      },
    }));
    const built = await buildExecution(harness.store, {
      denialReasons: ["capability-killed"],
      policy,
    });
    expect((await executeDefault(harness, built)).replayed).toBe(false);
    expect((await executeDefault(harness, built)).replayed).toBe(true);
    expect(harness.commercial.calls).toBe(0);
    expect(harness.telemetry.pairs).toHaveLength(2);
  });

  it("rejects an idempotency collision and keeps tenant scopes separate", async () => {
    const harness = makeHarness();
    const first = await buildExecution(harness.store, {
      idempotencyKey: "shared_runtime_key",
      suffix: "collision_first",
    });
    await executeDefault(harness, first);
    const collision = await buildExecution(harness.store, {
      idempotencyKey: "shared_runtime_key",
      inputSalt: "changed-input",
      suffix: "collision_second",
    });
    await expect(executeDefault(harness, collision)).rejects.toMatchObject({
      safeCode: "stale-or-duplicate-conflict",
    });
    const otherTenant = await buildExecution(harness.store, {
      idempotencyKey: "shared_runtime_key",
      organizationId: "organization_other",
      projectId: "project_other",
      suffix: "collision_other_tenant",
      userId: "user_other",
    });
    expect((await executeDefault(harness, otherTenant)).commercial?.state).toBe(
      "completed",
    );
    expect(harness.commercial.calls).toBe(2);
  });

  it("rejects a cross-tenant prompt-cache key before commercial work", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      cacheTransform: (cache) => ({
        ...cache,
        organizationId: "organization_other",
      }),
    });
    await expect(executeDefault(harness, built)).rejects.toMatchObject({
      safeCode: "routing-authority-mismatch",
    });
    expect(harness.commercial.calls).toBe(0);
  });

  it.each(["dataResidencyBoundary", "organizationSafePolicyScope"] as const)(
    "rejects cache %s outside trusted policy/admission scope",
    async (field) => {
      const harness = makeHarness();
      const built = await buildExecution(harness.store, {
        cacheTransform: (cache) => ({
          ...cache,
          [field]: `${cache[field]}.other`,
        }),
        suffix: `cache_scope_${field}`,
      });
      await expect(executeDefault(harness, built)).rejects.toMatchObject({
        safeCode: "routing-authority-mismatch",
      });
      expect(harness.commercial.calls).toBe(0);
    },
  );
  it("returns only a bounded safe error for malformed input", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store);
    const sensitiveMarker = "sk-live-secret-must-not-escape";
    const malformed = {
      ...built.input,
      admissionRequest: {
        ...built.input.admissionRequest,
        rawCredential: sensitiveMarker,
      },
    } as unknown as ModelRuntimeControlExecutionInputV1;
    let caught: unknown;
    try {
      await harness.service.execute(malformed, () =>
        Promise.resolve(controlledInvocation()),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelRuntimeControlError);
    expect(String(caught)).not.toContain(sensitiveMarker);
    expect(harness.commercial.calls).toBe(0);
    expect(harness.telemetry.pairs).toHaveLength(0);
  });

  it.each([
    [
      "sensitive",
      {
        ...validOutput(),
        noRawSensitiveContent: false,
        secretRedactionApplied: false,
      },
    ],
    [
      "unvalidated operation batch",
      {
        ...validOutput(),
        allowListedOperationsEvidence: {
          ...validOutput().allowListedOperationsEvidence,
          passed: false,
        },
      },
    ],
    [
      "unvalidated source ownership",
      {
        ...validOutput(),
        sourceOwnershipEvidence: {
          ...validOutput().sourceOwnershipEvidence,
          passed: false,
        },
      },
    ],
  ] as const)("rejects %s output before it escapes", async (_label, output) => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store);
    const result = await executeDefault(
      harness,
      built,
      controlledInvocation(
        output as unknown as ModelRuntimeSanitizedOutputEvidenceV1,
      ),
    );
    expect(result.output).toBeNull();
    expect(harness.commercial.invocationResults[0]).toMatchObject({
      status: "internal-failure",
      usefulOutputDelivered: false,
    });
    expect(
      harness.telemetry.pairs.some(
        (pair) => pair.audit.eventKind === "safety-issue",
      ),
    ).toBe(true);
  });

  it("rejects correctly self-digested Evidence from an untrusted host verifier", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "forged_host_evidence",
    });
    const output = validOutput(built.input.admissionRequest);
    const forged = hostEvidence("allow-listed-operations", {
      catalogDigest: built.input.admissionRequest.catalogDigest,
      inputDigest: built.input.admissionRequest.inputDigest,
      operation: built.input.admissionRequest.operation,
      organizationId: built.input.admissionRequest.organizationId,
      outputBytes: output.outputBytes,
      outputDigest: output.outputDigest,
      outputTokens: output.outputTokens,
      projectId: built.input.admissionRequest.projectId,
      responseSchemaDigest: built.input.admissionRequest.responseSchemaDigest,
      runtimePolicyDigest: built.input.admissionRequest.runtimePolicyDigest,
      verifierId: namespacedIdentifierSchema.parse(
        "cloudmarkup.attacker.self-attestation",
      ),
    });
    const result = await executeDefault(
      harness,
      built,
      controlledInvocation({
        ...output,
        allowListedOperationsEvidence: forged,
      }),
    );
    expect(result.output).toBeNull();
    expect(
      harness.evidenceVerifier.calls.some(
        (evidence) => evidence.evidenceDigest === forged.evidenceDigest,
      ),
    ).toBe(true);
  });
  // All former labels changed only inputSalt, which projects one inputDigest.
  it.each(["changed input"] as const)(
    "rejects stale host Evidence for %s with identical output bytes",
    async (label) => {
      const store = new InMemoryModelRuntimeAdmissionStoreV1();
      const harness = makeHarness(store);
      const original = await buildExecution(store, {
        inputSalt: "source-authority-original",
        suffix: `stale_evidence_original_${label.replaceAll(" ", "_")}`,
      });
      const current = await buildExecution(store, {
        inputSalt: `source-authority-current-${label}`,
        suffix: `stale_evidence_current_${label.replaceAll(" ", "_")}`,
      });
      const staleOutput = validOutput(original.input.admissionRequest);
      const result = await executeDefault(
        harness,
        current,
        controlledInvocation(staleOutput),
      );
      expect(result.output).toBeNull();
      expect(staleOutput.outputDigest).toBe(OUTPUT_DIGEST);
    },
  );

  it.each([
    ["catalogDigest", sha256Text("forged-catalog")],
    ["responseSchemaDigest", sha256Text("forged-response-schema")],
    ["runtimePolicyDigest", sha256Text("forged-runtime-policy")],
    ["outputBytes", 99],
    ["outputTokens", 9],
  ] as const)(
    "rejects self-digested Evidence with mismatched authenticated %s",
    async (field, value) => {
      const harness = makeHarness();
      const built = await buildExecution(harness.store, {
        suffix: `forged_evidence_${field}`,
      });
      const output = validOutput(built.input.admissionRequest);
      const { evidenceDigest: _ignoredEvidenceDigest, ...withoutDigest } = {
        ...output.allowListedOperationsEvidence,
        [field]: value,
      };
      void _ignoredEvidenceDigest;
      const forged = modelRuntimeHostEvidenceV1Schema.parse({
        ...withoutDigest,
        evidenceDigest: digestModelRuntimeHostEvidenceV1(withoutDigest),
      });
      const result = await executeDefault(
        harness,
        built,
        controlledInvocation({
          ...output,
          allowListedOperationsEvidence: forged,
        }),
      );
      expect(result.output).toBeNull();
    },
  );

  it("releases runtime concurrency after cancellation", async () => {
    const harness = makeHarness();
    const policy = makePolicy((draft) => ({
      ...draft,
      requestWindows: {
        organization: {
          ...draft.requestWindows.organization,
          maximumConcurrentJobs: 1,
        },
        user: { ...draft.requestWindows.user, maximumConcurrentJobs: 1 },
      },
    }));
    const cancelled = await buildExecution(harness.store, {
      policy,
      suffix: "cancelled",
    });
    const cancelledResult = await executeDefault(
      harness,
      cancelled,
      controlledInvocation(null, {
        attempts: [attempt("cancelled")],
        failureCategory: "runtime.test.cancelled",
        status: "cancelled",
        usefulOutputDelivered: false,
      }),
    );
    expect(cancelledResult.commercial?.state).toBe("released");
    const after = await buildExecution(harness.store, {
      policy,
      suffix: "after_cancel",
    });
    expect((await executeDefault(harness, after)).commercial?.state).toBe(
      "completed",
    );
  });

  it("keeps live evaluation opt-in and enforces exact cost authority before invoke", async () => {
    const allowedHarness = makeHarness();
    const basePolicy = makePolicy();
    const liveAuthority = makeLiveAuthority(basePolicy);
    const liveReport = makeLiveReport(liveAuthority);
    const policy = pinPolicyToReport(basePolicy, liveReport);
    const allowed = await buildExecution(allowedHarness.store, {
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: liveAuthority,
      policy,
      suffix: "live_allowed",
    });
    expect(
      (await executeDefault(allowedHarness, allowed)).commercial?.state,
    ).toBe("completed");

    const deniedHarness = makeHarness();
    const deniedAuthority = makeLiveAuthority(basePolicy, {
      ...liveAuthority.limits,
      maximumEstimatedMicroUsd: ESTIMATED_MICRO_USD - 1,
    });
    const deniedReport = makeLiveReport(deniedAuthority);
    const deniedPolicy = pinPolicyToReport(basePolicy, deniedReport);
    const denied = await buildExecution(deniedHarness.store, {
      denialReasons: ["live-evaluation-not-authorized"],
      evaluationReport: deniedReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: deniedAuthority,
      policy: deniedPolicy,
      suffix: "live_denied",
    });
    expect((await executeDefault(deniedHarness, denied)).commercial).toBeNull();
    expect(deniedHarness.commercial.calls).toBe(0);
  });

  it("rejects a live substitute report even when its authority tuple still matches", async () => {
    const harness = makeHarness();
    const basePolicy = makePolicy();
    const authority = makeLiveAuthority(basePolicy);
    const pinnedReport = makeLiveReport(authority);
    const policy = pinPolicyToReport(basePolicy, pinnedReport);
    const substituteDraft = {
      ...pinnedReport,
      evaluationReportId: "runtime_live_evaluation_report_substitute",
    };
    delete (substituteDraft as Partial<ModelEvaluationReportV1>).reportDigest;
    const substitute = modelEvaluationReportV1Schema.parse({
      ...substituteDraft,
      reportDigest: digestModelEvaluationReportV1(substituteDraft),
    });
    const built = await buildExecution(harness.store, {
      evaluationReport: substitute,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "live_substitute_report",
    });
    await expect(executeDefault(harness, built)).rejects.toMatchObject({
      safeCode: "routing-authority-mismatch",
    });
    expect(harness.commercial.calls).toBe(0);
  });

  it("denies planned live invocations beyond the exact authority budget", async () => {
    const harness = makeHarness();
    const basePolicy = makePolicy();
    const authority = makeLiveAuthority(basePolicy);
    const liveReport = makeLiveReport(authority);
    const policy = pinPolicyToReport(basePolicy, liveReport);
    const built = await buildExecution(harness.store, {
      commercialRequestTransform: (request) =>
        withTwoPlannedCalls(request, "automatic-retry"),
      denialReasons: ["live-evaluation-not-authorized"],
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "live_invocation_overage",
    });
    expect((await executeDefault(harness, built)).commercial).toBeNull();
    expect(harness.commercial.calls).toBe(0);
  });

  it("persists cache-bearing live capacity across allowed execution, replay, and a second denied claim", async () => {
    const harness = makeHarness();
    const basePolicy = makePolicy();
    const authority = makeLiveAuthority(basePolicy, {
      maximumConcurrentJobs: 1,
      maximumCreditUnits: MAXIMUM_CREDIT_UNITS * 2,
      maximumEstimatedMicroUsd: ESTIMATED_MICRO_USD * 2,
      maximumInputTokens: 200,
      maximumInvocations: 2,
      maximumOutputTokens: 100,
      maximumTotalTokens: 319,
    });
    const liveReport = makeLiveReport(authority);
    const policy = pinPolicyToReport(basePolicy, liveReport);
    const first = await buildExecution(harness.store, {
      commercialRequestTransform: (request) => withCacheUsage(request),
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "live_cache_allowed_first",
    });
    expect((await executeDefault(harness, first)).replayed).toBe(false);
    expect((await executeDefault(harness, first)).replayed).toBe(true);

    const request = first.input.admissionRequest;
    const snapshotInput = {
      decidedAt: NOW,
      idempotencyKeyDigest: request.idempotencyKeyDigest,
      liveAuthorityReservation: {
        authorityDigest: authority.authorityDigest,
        limits: authority.limits,
        planned: {
          cacheReadTokens: 6,
          cacheWriteTokens: 4,
          creditUnits: request.commercialEstimate.maximumCreditUnits,
          estimatedMicroUsd: request.commercialEstimate.estimatedMicroUsd,
          inputTokens: 100,
          invocations: 1,
          outputTokens: request.requested.outputTokens,
          totalTokens: 160,
        },
      },
      organizationId: request.organizationId,
      organizationWindowSeconds:
        policy.requestWindows.organization.windowSeconds,
      projectId: request.projectId,
      requestDigest: request.requestDigest,
      runtimePolicyDigest: policy.policyDigest,
      tenantScopeDigest: digestStructuredValue({
        idempotencyKeyDigest: request.idempotencyKeyDigest,
        organizationId: request.organizationId,
        projectId: request.projectId,
        userId: request.userId,
      }),
      userId: request.userId,
      userWindowSeconds: policy.requestWindows.user.windowSeconds,
    };
    const afterReplay = await harness.store.inspect(snapshotInput);
    expect(afterReplay.liveAuthorityUsage).toMatchObject({
      activeConcurrentJobs: 0,
      reservedCacheReadTokens: 6,
      reservedCacheWriteTokens: 4,
      reservedInputTokens: 100,
      reservedInvocations: 1,
      reservedOutputTokens: 50,
      reservedTotalTokens: 160,
    });

    const second = await buildExecution(harness.store, {
      commercialRequestTransform: (request) => withCacheUsage(request),
      denialReasons: ["live-evaluation-not-authorized"],
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "live_cache_second_denied",
    });
    const denied = await executeDefault(harness, second);
    expect(denied.commercial).toBeNull();
    expect(harness.commercial.calls).toBe(1);
    const afterSecond = await harness.store.inspect(snapshotInput);
    expect(afterSecond.liveAuthorityUsage).toEqual(
      afterReplay.liveAuthorityUsage,
    );
  });

  it("rejects an inconsistent cache-inclusive planned total before runtime claim or commercial work", async () => {
    const baseStore = new InMemoryModelRuntimeAdmissionStoreV1();
    const adapted = strandingAdmissionStore(baseStore);
    const harness = makeHarness(baseStore);
    const built = await buildExecution(baseStore, {
      suffix: "inconsistent_cache_total",
    });
    const primary = built.input.commercialRequest.plannedCalls[0];
    if (primary === undefined) throw new Error("Missing primary planned call.");
    const service = new ModelRuntimeControlServiceV1({
      authorityResolver: harness.authorityResolver,
      commercial: harness.commercial,
      evidenceVerifier: harness.evidenceVerifier,
      now: () => NOW,
      store: adapted.store,
      telemetry: harness.telemetry,
    });
    await expect(
      service.execute(
        {
          ...built.input,
          commercialRequest: {
            ...built.input.commercialRequest,
            plannedCalls: [
              {
                ...primary,
                maximumUsage: {
                  ...primary.maximumUsage,
                  cacheReadUnits: 1,
                },
              },
            ],
          },
        },
        () => Promise.resolve(controlledInvocation()),
      ),
    ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
    expect(adapted.state.capturedLeases).toHaveLength(0);
    expect(harness.commercial.calls).toBe(0);
  });
  it("denies a planned cache-token total above live authority before commercial dispatch", async () => {
    const harness = makeHarness();
    const basePolicy = makePolicy();
    const authority = makeLiveAuthority(basePolicy);
    const liveReport = makeLiveReport(authority);
    const policy = pinPolicyToReport(basePolicy, liveReport);
    const built = await buildExecution(harness.store, {
      commercialRequestTransform: (request) => ({
        ...request,
        plannedCalls: request.plannedCalls.map((call) => ({
          ...call,
          maximumUsage: {
            ...call.maximumUsage,
            cacheReadUnits: 1,
            totalUnits:
              call.maximumUsage.inputUnits + call.maximumUsage.outputUnits + 1,
          },
        })),
      }),
      denialReasons: ["live-evaluation-not-authorized"],
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "live_cache_total_overage",
    });
    expect((await executeDefault(harness, built)).commercial).toBeNull();
    expect(harness.commercial.calls).toBe(0);
    expect(harness.commercial.invokeCalls).toBe(0);
  });

  it("rejects commercial expiry beyond live authority before claiming", async () => {
    const harness = makeHarness();
    const basePolicy = makePolicy();
    const authority = makeLiveAuthority(basePolicy);
    const liveReport = makeLiveReport(authority);
    const policy = pinPolicyToReport(basePolicy, liveReport);
    const built = await buildExecution(harness.store, {
      commercialExpiresAt: "2026-08-22T12:06:00.000Z",
      decisionExpiresAt: "2026-08-22T12:06:00.000Z",
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "live_commercial_expiry",
    });
    await expect(executeDefault(harness, built)).rejects.toMatchObject({
      safeCode: "routing-authority-mismatch",
    });
    expect(harness.commercial.calls).toBe(0);
  });
  it("denies a fresh request when live authority has expired", async () => {
    const store = new InMemoryModelRuntimeAdmissionStoreV1();
    const harness = makeHarness(store, () => EXPIRES_AT);
    const basePolicy = makePolicy();
    const authority = makeLiveAuthority(basePolicy);
    const liveReport = makeLiveReport(authority);
    const policy = pinPolicyToReport(basePolicy, liveReport);
    const built = await buildExecution(store, {
      denialReasons: ["live-evaluation-not-authorized"],
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "expired_live_first_use",
    });
    await expect(executeDefault(harness, built)).rejects.toMatchObject({
      safeCode: "stale-or-duplicate-conflict",
    });
    expect(harness.commercial.calls).toBe(0);
  });
  it.each([
    "catalogDigest",
    "promptTemplateDigest",
    "responseSchemaDigest",
  ] as const)(
    "rejoins %s to evaluated evidence even when prompt caching is disabled",
    async (field) => {
      const harness = makeHarness();
      const built = await buildExecution(harness.store, {
        routingDecisionTransform: (decision) => ({
          ...decision,
          promptCachePolicy: {
            ...decision.promptCachePolicy,
            cacheKeyRequired: false,
            enabled: false,
          },
        }),
        suffix: "exact_" + field,
      });
      const mismatched = {
        ...built.input,
        [field]: sha256Text("mismatched-" + field),
      };
      await expect(
        harness.service.execute(mismatched, () =>
          Promise.resolve(controlledInvocation()),
        ),
      ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
      expect(harness.commercial.calls).toBe(0);
    },
  );

  it("rejects a non-fake route backed only by deterministic-fake evidence", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      routingDecisionTransform: (decision) => ({
        ...decision,
        modelId: "configured.model.standard.required",
        modelVersion: "configured-at-runtime",
        providerFamily: "amazon-bedrock",
        providerId: "cloudmarkup.amazon-bedrock",
      }),
      suffix: "fake_evidence_live_route",
    });
    await expect(executeDefault(harness, built)).rejects.toMatchObject({
      safeCode: "routing-authority-mismatch",
    });
    expect(harness.commercial.calls).toBe(0);
  });

  it("accepts a nonfuture unexpired predecision and derives current state from trusted time", async () => {
    const store = new InMemoryModelRuntimeAdmissionStoreV1();
    const later = makeHarness(store, () => "2026-08-22T12:00:11.000Z");
    const built = await buildExecution(store, { suffix: "predecision" });
    expect((await executeDefault(later, built)).commercial?.state).toBe(
      "completed",
    );
    expect(later.commercial.calls).toBe(1);
  });

  it("rejects future allowed and denied decisions before commercial work", async () => {
    const allowedHarness = makeHarness();
    const futureAllowed = await buildExecution(allowedHarness.store, {
      decisionDecidedAt: "2026-08-22T12:01:00.000Z",
      decisionExpiresAt: "2026-08-22T12:06:00.000Z",
      suffix: "future_allowed",
    });
    await expect(
      executeDefault(allowedHarness, futureAllowed),
    ).rejects.toMatchObject({ safeCode: "stale-or-duplicate-conflict" });
    expect(allowedHarness.commercial.calls).toBe(0);

    const deniedHarness = makeHarness();
    const deniedPolicy = makePolicy((draft) => ({
      ...draft,
      killSwitches: {
        capabilitySwitches: [],
        global: {
          engaged: true,
          reasonCode: evaluationReport.evaluationPolicyId,
        },
      },
    }));
    const futureDenied = await buildExecution(deniedHarness.store, {
      decisionDecidedAt: "2026-08-22T12:01:00.000Z",
      decisionExpiresAt: "2026-08-22T12:06:00.000Z",
      denialReasons: ["capability-killed"],
      policy: deniedPolicy,
      suffix: "future_denied",
    });
    await expect(
      executeDefault(deniedHarness, futureDenied),
    ).rejects.toMatchObject({ safeCode: "stale-or-duplicate-conflict" });
    expect(deniedHarness.commercial.calls).toBe(0);
  });

  it("rejects an expired first-use decision before commercial work", async () => {
    const harness = makeHarness();
    const expired = await buildExecution(harness.store, {
      decisionDecidedAt: "2026-08-22T11:59:00.000Z",
      decisionExpiresAt: "2026-08-22T12:00:09.000Z",
      suffix: "expired_first_use",
    });
    await expect(executeDefault(harness, expired)).rejects.toMatchObject({
      safeCode: "stale-or-duplicate-conflict",
    });
    expect(harness.commercial.calls).toBe(0);
  });

  it("cannot select an earlier rate window with caller decision time", async () => {
    const harness = makeHarness();
    const policy = makePolicy((draft) => ({
      ...draft,
      requestWindows: {
        organization: {
          ...draft.requestWindows.organization,
          maximumRequests: 1,
        },
        user: { ...draft.requestWindows.user, maximumRequests: 1 },
      },
    }));
    const first = await buildExecution(harness.store, {
      decisionDecidedAt: "2026-08-22T11:00:10.000Z",
      policy,
      suffix: "trusted_window_first",
    });
    await executeDefault(harness, first);
    const denied = await buildExecution(harness.store, {
      decisionDecidedAt: "2026-08-22T11:00:20.000Z",
      denialReasons: ["request-limit-exceeded"],
      policy,
      suffix: "trusted_window_denied",
    });
    expect((await executeDefault(harness, denied)).commercial).toBeNull();
    expect(harness.commercial.calls).toBe(1);
  });

  it("rejects caller snapshot provenance and never retains it in the terminal decision", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "forged_decision_snapshot_provenance",
    });
    await expect(
      harness.service.execute(
        {
          ...built.input,
          admissionDecision: {
            ...built.input.admissionDecision,
            runtimeStateSnapshotDigest: sha256Text("forged-runtime-snapshot"),
            runtimeStateSnapshotId: "runtime_snapshot_forged",
          } as never,
        },
        () =>
          Promise.resolve(
            controlledInvocation(validOutput(built.input.admissionRequest)),
          ),
      ),
    ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
    expect(harness.commercial.calls).toBe(0);

    const accepted = await executeDefault(harness, built);
    expect("runtimeStateSnapshotDigest" in accepted.admission).toBe(false);
    expect("runtimeStateSnapshotId" in accepted.admission).toBe(false);
  });
  it("replays a terminal after clock advance but conflicts on semantic change", async () => {
    let current = NOW;
    const harness = makeHarness(
      new InMemoryModelRuntimeAdmissionStoreV1(),
      () => current,
    );
    const built = await buildExecution(harness.store, {
      suffix: "advancing_replay",
    });
    expect((await executeDefault(harness, built)).replayed).toBe(false);
    const telemetryCount = harness.telemetry.pairs.length;
    current = "2026-08-22T12:06:10.000Z";
    const reissued = reissueTransportAuthority(built, {
      commercialExpiresAt: "2026-08-22T12:11:10.000Z",
      decidedAt: current,
      decisionExpiresAt: "2026-08-22T12:11:10.000Z",
    });
    expect((await executeDefault(harness, reissued)).replayed).toBe(true);
    expect(harness.commercial.calls).toBe(1);
    expect(harness.telemetry.pairs).toHaveLength(telemetryCount);

    const semanticChange = {
      ...reissued,
      input: {
        ...reissued.input,
        commercialRequest: {
          ...reissued.input.commercialRequest,
          requestedMaximumInputUnits:
            reissued.input.commercialRequest.requestedMaximumInputUnits + 1,
        },
      },
    };
    await expect(executeDefault(harness, semanticChange)).rejects.toMatchObject(
      { safeCode: "stale-or-duplicate-conflict" },
    );
  });
  it.each([
    [
      "requestedAt differs from the admission decision",
      {
        commercialRequestedAt: "2026-08-22T12:00:09.000Z",
      },
    ],
    [
      "commercial expiry exceeds admission expiry",
      {
        commercialExpiresAt: "2026-08-22T12:05:11.000Z",
      },
    ],
  ] as const)("rejects commercial time skew when %s", async (_label, patch) => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      ...patch,
      suffix: "commercial_time_skew",
    });
    await expect(executeDefault(harness, built)).rejects.toMatchObject({
      safeCode: "routing-authority-mismatch",
    });
    expect(harness.commercial.calls).toBe(0);
  });

  it("does not invoke a model when canonical pricing resolution differs from the pinned reference", async () => {
    const harness = makeHarness();
    harness.commercial.pricingVersionReference =
      namespacedIdentifierSchema.parse("cloudmarkup.pricing.unexpected");
    const built = await buildExecution(harness.store, {
      suffix: "pricing_reference_skew",
    });
    let invoked = false;
    const result = await harness.service.execute(built.input, () => {
      invoked = true;
      return Promise.resolve(
        controlledInvocation(validOutput(built.input.admissionRequest)),
      );
    });
    expect(invoked).toBe(false);
    expect(result.commercial?.state).toBe("released");
    expect(result.output).toBeNull();
  });
  it("rejects planned calls beyond the selected route attempt cap", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      commercialRequestTransform: (request) => {
        const two = withTwoPlannedCalls(request, "automatic-retry");
        const retry = two.plannedCalls[1];
        if (retry === undefined) throw new Error("Missing retry call.");
        return { ...two, plannedCalls: [...two.plannedCalls, retry] };
      },
      suffix: "planned_attempt_overage",
    });
    await expect(executeDefault(harness, built)).rejects.toMatchObject({
      safeCode: "routing-authority-mismatch",
    });
    expect(harness.commercial.calls).toBe(0);
  });

  it("rejects a planned repair call without repair authority", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      commercialRequestTransform: (request) =>
        withTwoPlannedCalls(request, "repair"),
      suffix: "planned_repair_without_authority",
    });
    await expect(executeDefault(harness, built)).rejects.toMatchObject({
      safeCode: "routing-authority-mismatch",
    });
    expect(harness.commercial.calls).toBe(0);
  });

  it.each([
    [
      "more actual attempts than planned or routed",
      () => [
        attempt(),
        additionalAttempt("automatic-retry", 2),
        additionalAttempt("automatic-retry", 3),
      ],
    ],
    [
      "an unplanned repair kind",
      () => [{ ...attempt(), attemptKind: "repair" as const }],
    ],
  ] as const)("suppresses output for %s", async (_label, attemptFactory) => {
    const attempts = attemptFactory();
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      ...(attempts.length > 1
        ? {
            commercialRequestTransform: (
              request: ModelCommercialOperationRequestV1,
            ) => withTwoPlannedCalls(request, "automatic-retry"),
          }
        : {}),
      suffix: `actual_attempt_${String(attempts.length)}`,
    });
    const result = await executeDefault(
      harness,
      built,
      controlledInvocation(validOutput(built.input.admissionRequest), {
        attempts,
      }),
    );
    expect(result.output).toBeNull();
    expect(result.commercial?.state).toBe("released");
  });

  it("accepts a bounded planned and actual repair when authority is explicit", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      commercialRequestTransform: (request) =>
        withTwoPlannedCalls(request, "repair"),
      requestedPatch: { repairAttempts: 1 },
      suffix: "authorized_repair_attempt",
    });
    const result = await executeDefault(
      harness,
      built,
      controlledInvocation(validOutput(built.input.admissionRequest), {
        attempts: [attempt(), additionalAttempt("repair", 2)],
      }),
    );
    expect(result.output).not.toBeNull();
    expect(result.commercial?.state).toBe("completed");
  });
  it("rejects commercial planned output above admission and route authority", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "planned_output_overage",
    });
    const plannedCall = built.input.commercialRequest.plannedCalls[0];
    if (plannedCall === undefined) throw new Error("Missing planned call.");
    const input = {
      ...built.input,
      commercialRequest: {
        ...built.input.commercialRequest,
        plannedCalls: [
          {
            ...plannedCall,
            maximumUsage: {
              ...plannedCall.maximumUsage,
              outputUnits: 51,
              totalUnits: 151,
            },
          },
        ],
      },
    };
    await expect(
      harness.service.execute(input, () =>
        Promise.resolve(controlledInvocation()),
      ),
    ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
    expect(harness.commercial.calls).toBe(0);
  });

  it("suppresses output when canonical usage exceeds normal admission bounds", async () => {
    const harness = makeHarness();
    harness.commercial.technicalUnits = {
      cacheReadUnits: 0,
      cacheWriteUnits: 0,
      inputUnits: 20,
      outputUnits: 51,
      providerSpecificUnits: [],
      totalUnits: 71,
    };
    const built = await buildExecution(harness.store, {
      suffix: "canonical_usage_overage",
    });
    const result = await executeDefault(harness, built);
    expect(result.output).toBeNull();
    expect(
      harness.telemetry.pairs.some(
        (pair) => pair.audit.eventKind === "safety-issue",
      ),
    ).toBe(true);
  });

  it.each([
    "denied",
    "estimate-confirmation-required",
    "reservation-denied",
  ] as const)(
    "records canonical commercial %s once without invoking a model",
    async (state) => {
      const harness = makeHarness();
      harness.commercial.deniedState = state;
      const built = await buildExecution(harness.store, {
        suffix: "commercial_" + state.replaceAll("-", "_"),
      });
      const result = await executeDefault(harness, built);
      expect(result.commercial?.state).toBe(state);
      expect(harness.commercial.invokeCalls).toBe(0);
      expect(
        harness.telemetry.pairs.filter(
          (pair) => pair.audit.eventKind === "deny",
        ),
      ).toHaveLength(1);
      expect((await executeDefault(harness, built)).replayed).toBe(true);
      expect(harness.commercial.calls).toBe(1);
      expect(
        harness.telemetry.pairs.filter(
          (pair) => pair.audit.eventKind === "deny",
        ),
      ).toHaveLength(1);
    },
  );

  it("rejects live authority whose runtime configuration digest is not current", async () => {
    const harness = makeHarness();
    const basePolicy = makePolicy();
    const authority = makeLiveAuthority(basePolicy);
    const { authorityDigest, ...authorityDraft } = authority;
    void authorityDigest;
    const mismatchedDraft = {
      ...authorityDraft,
      runtimeControlConfigurationDigest: sha256Text(
        "different-runtime-configuration",
      ),
    };
    const mismatchedAuthority = modelLiveEvaluationAuthorityV1Schema.parse({
      ...mismatchedDraft,
      authorityDigest: digestModelLiveEvaluationAuthorityV1(mismatchedDraft),
    });
    const mismatchedReport = makeLiveReport(mismatchedAuthority);
    const policy = pinPolicyToReport(basePolicy, mismatchedReport);
    const built = await buildExecution(harness.store, {
      evaluationReport: mismatchedReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: mismatchedAuthority,
      policy,
      suffix: "live_configuration_mismatch",
    });
    await expect(executeDefault(harness, built)).rejects.toMatchObject({
      safeCode: "routing-authority-mismatch",
    });
    expect(harness.commercial.calls).toBe(0);
  });
  it("keeps live authority reservations cumulative while replay is free", async () => {
    const harness = makeHarness();
    const basePolicy = makePolicy();
    const authority = makeLiveAuthority(basePolicy);
    const liveReport = makeLiveReport(authority);
    const policy = pinPolicyToReport(basePolicy, liveReport);
    const first = await buildExecution(harness.store, {
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "live_budget_first",
    });
    expect((await executeDefault(harness, first)).replayed).toBe(false);
    expect((await executeDefault(harness, first)).replayed).toBe(true);
    const exhausted = await buildExecution(harness.store, {
      denialReasons: ["live-evaluation-not-authorized"],
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "live_budget_exhausted",
    });
    const denied = await executeDefault(harness, exhausted);
    const telemetryCount = harness.telemetry.pairs.length;
    expect(denied.commercial).toBeNull();
    expect(denied.replayed).toBe(false);
    const replayedDenial = await executeDefault(harness, exhausted);
    expect(replayedDenial.commercial).toBeNull();
    expect(replayedDenial.replayed).toBe(true);
    expect(harness.telemetry.pairs).toHaveLength(telemetryCount);
    expect(harness.commercial.calls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);
  });

  it("atomically fences live-authority concurrency separately from cumulative budgets", async () => {
    const harness = makeHarness();
    const basePolicy = makePolicy();
    const authority = makeLiveAuthority(basePolicy, {
      maximumConcurrentJobs: 1,
      maximumCreditUnits: MAXIMUM_CREDIT_UNITS * 2,
      maximumEstimatedMicroUsd: ESTIMATED_MICRO_USD * 2,
      maximumInputTokens: 200,
      maximumInvocations: 2,
      maximumOutputTokens: 100,
      maximumTotalTokens: 300,
    });
    const liveReport = makeLiveReport(authority);
    const policy = pinPolicyToReport(basePolicy, liveReport);
    const first = await buildExecution(harness.store, {
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "live_concurrency_first",
    });
    let releaseFirst: (() => void) | undefined;
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let enteredFirst: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredFirst = resolve;
    });
    const firstExecution = harness.service.execute(first.input, async () => {
      enteredFirst?.();
      await release;
      return controlledInvocation(validOutput(first.input.admissionRequest), {
        attempts: [attempt("succeeded", true)],
      });
    });
    await entered;
    const second = await buildExecution(harness.store, {
      denialReasons: ["concurrency-limit-exceeded"],
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "live_concurrency_second",
    });
    expect((await executeDefault(harness, second)).commercial).toBeNull();
    releaseFirst?.();
    await firstExecution;
    expect(harness.commercial.calls).toBe(1);
  });

  it("recovers a reserve-only commercial crash after expiry without another reserve or model call", async () => {
    const baseStore = new InMemoryModelRuntimeAdmissionStoreV1();
    const adapted = strandingAdmissionStore(baseStore);
    let trustedNow = NOW;
    const harness = makeHarness(baseStore);
    harness.commercial.responseMode = "reservation-crash-once";
    const service = new ModelRuntimeControlServiceV1({
      authorityResolver: harness.authorityResolver,
      commercial: harness.commercial,
      evidenceVerifier: harness.evidenceVerifier,
      now: () => trustedNow,
      store: adapted.store,
      telemetry: harness.telemetry,
    });
    const built = await buildExecution(baseStore, {
      commercialExpiresAt: "2026-08-22T12:05:10.000Z",
      decisionExpiresAt: "2026-08-22T12:05:10.000Z",
      suffix: "reserve_before_runtime_checkpoint",
    });
    await expect(
      service.execute(built.input, () => {
        throw new Error(
          "The model callback must not run for reserve-only crash.",
        );
      }),
    ).rejects.toMatchObject({ safeCode: "runtime-control-unavailable" });
    expect(harness.commercial.reserveCalls).toBe(1);
    expect(harness.commercial.executeCalls).toBe(1);
    expect(harness.commercial.recoverCalls).toBe(0);
    expect(harness.commercial.invokeCalls).toBe(0);

    trustedNow = "2026-08-22T12:06:10.000Z";
    const recovered = await service.execute(built.input, () => {
      throw new Error("Expired recovery must not invoke the model callback.");
    });
    expect(recovered.commercial?.state).toBe("released");
    expect(harness.commercial.reserveCalls).toBe(1);
    expect(harness.commercial.executeCalls).toBe(1);
    expect(harness.commercial.recoverCalls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(0);

    const replay = await service.execute(built.input, () => {
      throw new Error("Terminal replay must not invoke the model callback.");
    });
    expect(replay).toEqual({ ...recovered, replayed: true });
    expect(harness.commercial.calls).toBe(2);
  });

  it("reconciles an expired commercial receipt-persistence crash through runtime without reinvoking", async () => {
    const baseStore = new InMemoryModelRuntimeAdmissionStoreV1();
    const adapted = strandingAdmissionStore(baseStore);
    let trustedNow = NOW;
    const harness = makeHarness(baseStore);
    harness.commercial.throwAfterInvokeMarker =
      "sk-provider-secret-commercial-receipt-crash";
    const service = new ModelRuntimeControlServiceV1({
      authorityResolver: harness.authorityResolver,
      commercial: harness.commercial,
      evidenceVerifier: harness.evidenceVerifier,
      now: () => trustedNow,
      store: adapted.store,
      telemetry: harness.telemetry,
    });
    const built = await buildExecution(baseStore, {
      commercialExpiresAt: "2026-08-22T12:05:10.000Z",
      decisionExpiresAt: "2026-08-22T12:05:10.000Z",
      suffix: "expired_commercial_receipt_crash",
    });
    await expect(
      service.execute(built.input, () =>
        Promise.resolve(
          controlledInvocation(validOutput(built.input.admissionRequest)),
        ),
      ),
    ).rejects.toMatchObject({ safeCode: "runtime-control-unavailable" });
    expect(harness.commercial.executeCalls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);
    expect(harness.commercial.recoverCalls).toBe(0);

    trustedNow = "2026-08-22T12:06:10.000Z";
    const recovered = await service.execute(built.input, () => {
      throw new Error("Expired receipt recovery must not invoke the model.");
    });
    expect(recovered.commercial?.state).toBe("reconciliation-required");
    expect(harness.commercial.executeCalls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);
    expect(harness.commercial.recoverCalls).toBe(1);
  });
  it("recovers a dispatched result after an expired runtime checkpoint crash without cumulative live re-add", async () => {
    const baseStore = new InMemoryModelRuntimeAdmissionStoreV1();
    const adapted = strandingAdmissionStore(baseStore);
    adapted.state.failNextComplete = true;
    let trustedNow = NOW;
    const harness = makeHarness(baseStore);
    const basePolicy = makePolicy();
    const authority = makeLiveAuthority(basePolicy);
    const liveReport = makeLiveReport(authority);
    const policy = pinPolicyToReport(basePolicy, liveReport);
    const service = new ModelRuntimeControlServiceV1({
      authorityResolver: harness.authorityResolver,
      commercial: harness.commercial,
      evidenceVerifier: harness.evidenceVerifier,
      now: () => trustedNow,
      store: adapted.store,
      telemetry: harness.telemetry,
    });
    const built = await buildExecution(baseStore, {
      commercialExpiresAt: "2026-08-22T12:05:10.000Z",
      decisionExpiresAt: "2026-08-22T12:05:10.000Z",
      evaluationReport: liveReport,
      executionClass: "live-evaluation",
      liveEvaluationAuthority: authority,
      policy,
      suffix: "dispatch_before_runtime_checkpoint",
    });
    await expect(
      service.execute(built.input, () =>
        Promise.resolve(
          controlledInvocation(validOutput(built.input.admissionRequest), {
            attempts: [attempt("succeeded", true)],
          }),
        ),
      ),
    ).rejects.toMatchObject({ safeCode: "runtime-control-unavailable" });
    expect(harness.commercial.executeCalls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);
    expect(harness.commercial.recoverCalls).toBe(0);

    trustedNow = "2026-08-22T12:06:10.000Z";
    const reissued = reissueTransportAuthority(built, {
      commercialExpiresAt: built.input.commercialRequest.expiresAt,
      commercialRequestedAt: built.input.commercialRequest.requestedAt,
      decidedAt: built.input.admissionDecision.decidedAt,
      decisionExpiresAt: "2026-08-22T12:11:10.000Z",
    });
    const recovered = await service.execute(reissued.input, () => {
      throw new Error("Expired recovery must not invoke the model callback.");
    });
    expect(recovered.admission.decisionDigest).toBe(
      built.input.admissionDecision.decisionDigest,
    );
    expect(recovered.admission.decisionDigest).not.toBe(
      reissued.input.admissionDecision.decisionDigest,
    );
    expect(recovered.commercial?.state).toBe("completed");
    expect(harness.commercial.executeCalls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);
    expect(harness.commercial.recoverCalls).toBe(1);
    const operational = await service.recordOperationalOutcome({
      admissionDecision: built.input.admissionDecision,
      admissionRequest: built.input.admissionRequest,
      outcomeAuthority: operationalOutcomeAuthority(
        harness,
        built,
        recovered,
        "validator-failure",
        ["cloudmarkup.runtime.validator-failure"],
      ),
      trustedAuthority: trustedAuthorityBundle(built.input),
    });
    expect(operational.audit.eventKind).toBe("validator-failure");

    const request = built.input.admissionRequest;
    const snapshot = await baseStore.inspect({
      decidedAt: trustedNow,
      idempotencyKeyDigest: request.idempotencyKeyDigest,
      liveAuthorityReservation: {
        authorityDigest: authority.authorityDigest,
        limits: authority.limits,
        planned: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          creditUnits: request.commercialEstimate.maximumCreditUnits,
          estimatedMicroUsd: request.commercialEstimate.estimatedMicroUsd,
          inputTokens: 100,
          invocations: 1,
          outputTokens: request.requested.outputTokens,
          totalTokens: 100 + request.requested.outputTokens,
        },
      },
      organizationId: request.organizationId,
      organizationWindowSeconds:
        policy.requestWindows.organization.windowSeconds,
      projectId: request.projectId,
      requestDigest: request.requestDigest,
      runtimePolicyDigest: policy.policyDigest,
      tenantScopeDigest: digestStructuredValue({
        idempotencyKeyDigest: request.idempotencyKeyDigest,
        organizationId: request.organizationId,
        projectId: request.projectId,
        userId: request.userId,
      }),
      userId: request.userId,
      userWindowSeconds: policy.requestWindows.user.windowSeconds,
    });
    expect(snapshot.liveAuthorityUsage).toMatchObject({
      activeConcurrentJobs: 0,
      reservedInputTokens: 100,
      reservedInvocations: 1,
      reservedOutputTokens: request.requested.outputTokens,
      reservedTotalTokens: 100 + request.requested.outputTokens,
    });

    const replay = await service.execute(built.input, () => {
      throw new Error("Terminal replay must not invoke the model callback.");
    });
    expect(replay).toEqual({ ...recovered, replayed: true });
    expect(harness.commercial.calls).toBe(2);
  });
  it("reaps a stale predispatch runtime lease without restoring consumed request capacity", async () => {
    const baseStore = new InMemoryModelRuntimeAdmissionStoreV1();
    const adapted = strandingAdmissionStore(baseStore);
    let trustedNow = NOW;
    const harness = makeHarness(baseStore);
    harness.telemetry.failAfterPersist(1);
    const policy = makePolicy((draft) => ({
      ...draft,
      requestWindows: {
        organization: {
          ...draft.requestWindows.organization,
          maximumConcurrentJobs: 1,
        },
        user: {
          ...draft.requestWindows.user,
          maximumConcurrentJobs: 1,
        },
      },
    }));
    const service = new ModelRuntimeControlServiceV1({
      authorityResolver: harness.authorityResolver,
      commercial: harness.commercial,
      evidenceVerifier: harness.evidenceVerifier,
      now: () => trustedNow,
      store: adapted.store,
      telemetry: harness.telemetry,
    });
    const built = await buildExecution(baseStore, {
      commercialExpiresAt: "2026-08-22T12:20:10.000Z",
      decisionExpiresAt: "2026-08-22T12:20:10.000Z",
      policy,
      suffix: "stale_predispatch_lease",
    });
    await expect(
      service.execute(built.input, () =>
        Promise.resolve(
          controlledInvocation(validOutput(built.input.admissionRequest)),
        ),
      ),
    ).rejects.toMatchObject({ safeCode: "runtime-control-unavailable" });
    expect(harness.commercial.calls).toBe(0);
    const oldLease = adapted.state.capturedLeases[0];
    if (oldLease === undefined) throw new Error("Missing stranded lease.");

    trustedNow = "2026-08-22T12:06:10.000Z";
    const recovered = await service.execute(built.input, () =>
      Promise.resolve(
        controlledInvocation(validOutput(built.input.admissionRequest)),
      ),
    );
    expect(recovered.commercial?.state).toBe("completed");
    expect(adapted.state.capturedLeases).toHaveLength(2);
    expect(adapted.state.capturedLeases[1]?.fencingToken).not.toBe(
      oldLease.fencingToken,
    );
    let staleFenceError: unknown;
    try {
      await baseStore.release({
        executionLease: oldLease,
        tenantScopeDigest: digestStructuredValue({
          idempotencyKeyDigest:
            built.input.admissionRequest.idempotencyKeyDigest,
          organizationId: built.input.admissionRequest.organizationId,
          projectId: built.input.admissionRequest.projectId,
          userId: built.input.admissionRequest.userId,
        }),
      });
    } catch (error) {
      staleFenceError = error;
    }
    expect(staleFenceError).toMatchObject({
      safeCode: "stale-or-duplicate-conflict",
    });
    expect(harness.commercial.calls).toBe(1);
  });

  it("reconciles a stale post-dispatch runtime lease without invoking the model twice", async () => {
    const baseStore = new InMemoryModelRuntimeAdmissionStoreV1();
    const adapted = strandingAdmissionStore(baseStore);
    let trustedNow = NOW;
    const harness = makeHarness(baseStore);
    const marker = "sk-provider-secret-post-dispatch";
    harness.commercial.throwAfterInvokeMarker = marker;
    const service = new ModelRuntimeControlServiceV1({
      authorityResolver: harness.authorityResolver,
      commercial: harness.commercial,
      evidenceVerifier: harness.evidenceVerifier,
      now: () => trustedNow,
      store: adapted.store,
      telemetry: harness.telemetry,
    });
    const built = await buildExecution(baseStore, {
      commercialExpiresAt: "2026-08-22T12:20:10.000Z",
      decisionExpiresAt: "2026-08-22T12:20:10.000Z",
      suffix: "stale_postdispatch_lease",
    });
    let caught: unknown;
    try {
      await service.execute(built.input, () =>
        Promise.resolve(
          controlledInvocation(validOutput(built.input.admissionRequest)),
        ),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ safeCode: "runtime-control-unavailable" });
    expect(String(caught)).not.toContain(marker);
    expect(harness.commercial.invokeCalls).toBe(1);

    trustedNow = "2026-08-22T12:06:10.000Z";
    const recovered = await service.execute(built.input, () => {
      throw new Error("The model callback must not run during reconciliation.");
    });
    expect(recovered.commercial?.state).toBe("reconciliation-required");
    expect(harness.commercial.invokeCalls).toBe(1);
    expect(adapted.state.capturedLeases).toHaveLength(2);
  });

  it("retries only canonical settlement after expiry and terminalizes without a second model call", async () => {
    const store = new InMemoryModelRuntimeAdmissionStoreV1();
    let trustedNow = NOW;
    const harness = makeHarness(store, () => trustedNow);
    harness.commercial.responseMode = "settlement-pending-once";
    const built = await buildExecution(store, { suffix: "pending_settlement" });

    const first = await executeDefault(harness, built);
    expect(first.commercial?.state).toBe("settlement-pending");
    expect(
      harness.telemetry.pairs.filter(
        (pair) => pair.audit.eventKind === "settle",
      ),
    ).toHaveLength(0);
    expect(harness.commercial.calls).toBe(1);
    expect(harness.commercial.invokeCalls).toBe(1);

    trustedNow = "2026-08-22T12:10:10.000Z";
    const second = await executeDefault(harness, built);
    expect(second.commercial?.state).toBe("completed");
    expect(second.output).toEqual(first.output);
    expect(harness.commercial.calls).toBe(2);
    expect(harness.commercial.invokeCalls).toBe(1);
    expect(
      harness.telemetry.pairs.filter(
        (pair) => pair.audit.eventKind === "settle",
      ),
    ).toHaveLength(1);

    const third = await executeDefault(harness, built);
    expect(third).toEqual({ ...second, replayed: true });
    expect(harness.commercial.calls).toBe(2);
    expect(harness.commercial.invokeCalls).toBe(1);
  });

  it("emits truthful reconciliation safety telemetry and never a settlement projection", async () => {
    const harness = makeHarness();
    harness.commercial.responseMode = "reconciliation-required";
    const built = await buildExecution(harness.store, {
      suffix: "runtime_reconciliation",
    });
    const result = await executeDefault(harness, built);
    expect(result.commercial?.state).toBe("reconciliation-required");
    expect(
      harness.telemetry.pairs.filter(
        (pair) => pair.audit.eventKind === "settle",
      ),
    ).toHaveLength(0);
    expect(
      harness.telemetry.pairs.some(
        (pair) =>
          pair.audit.eventKind === "safety-issue" &&
          pair.audit.safeReasonCodes.includes(
            namespacedIdentifierSchema.parse(
              "cloudmarkup.runtime.reconciliation-required",
            ),
          ),
      ),
    ).toBe(true);
  });

  it("maps unknown commercial dependency errors to a fixed safe runtime error", async () => {
    const harness = makeHarness();
    const marker = "sk-provider-secret-commercial";
    harness.commercial.throwMarker = marker;
    const built = await buildExecution(harness.store, {
      suffix: "commercial_dependency_failure",
    });
    let caught: unknown;
    try {
      await executeDefault(harness, built);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ safeCode: "runtime-control-unavailable" });
    expect(String(caught)).not.toContain(marker);
    expect(harness.commercial.invokeCalls).toBe(0);
  });

  it("rejects a self-rehashed permissive authority graph against host current authority", async () => {
    const store = new InMemoryModelRuntimeAdmissionStoreV1();
    const harness = makeHarness(store);
    const trusted = await buildExecution(store, {
      suffix: "trusted_authority",
    });
    const permissivePolicy = makePolicy((draft) => ({
      ...draft,
      limits: {
        ...draft.limits,
        maximumNodes: draft.limits.maximumNodes + 1,
      },
    }));
    const forged = await buildExecution(store, {
      policy: permissivePolicy,
      suffix: "self_rehashed_permissive",
    });
    const resolver: ModelRuntimeAuthorityResolverV1 = {
      resolve: () => Promise.resolve(trustedAuthorityBundle(trusted.input)),
    };
    const service = new ModelRuntimeControlServiceV1({
      authorityResolver: resolver,
      commercial: harness.commercial,
      evidenceVerifier: harness.evidenceVerifier,
      now: () => NOW,
      store,
      telemetry: harness.telemetry,
    });
    await expect(
      service.execute(forged.input, () =>
        Promise.resolve(
          controlledInvocation(validOutput(forged.input.admissionRequest)),
        ),
      ),
    ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
    expect(harness.commercial.calls).toBe(0);
    expect(harness.telemetry.pairs).toHaveLength(0);
  });

  it("maps resolver dependency failures to a fixed safe unavailable error before state access", async () => {
    const store = new InMemoryModelRuntimeAdmissionStoreV1();
    const harness = makeHarness(store);
    const built = await buildExecution(store, { suffix: "resolver_failure" });
    const marker = "sk-provider-secret";
    const service = new ModelRuntimeControlServiceV1({
      authorityResolver: {
        resolve: () => Promise.reject(new Error(marker)),
      },
      commercial: harness.commercial,
      evidenceVerifier: harness.evidenceVerifier,
      now: () => NOW,
      store,
      telemetry: harness.telemetry,
    });
    let caught: unknown;
    try {
      await service.execute(built.input, () =>
        Promise.resolve(
          controlledInvocation(validOutput(built.input.admissionRequest)),
        ),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ safeCode: "runtime-control-unavailable" });
    expect(String(caught)).not.toContain(marker);
    expect(harness.commercial.calls).toBe(0);
    expect(harness.telemetry.pairs).toHaveLength(0);
  });

  it("rejects public attempts to forge canonical usage projections", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "forged_projection",
    });
    await executeDefault(harness, built);
    const count = harness.telemetry.pairs.length;
    await expect(
      harness.service.recordOperationalOutcome({
        admissionDecision: built.input.admissionDecision,
        admissionRequest: built.input.admissionRequest,
        eventKind: "credits",
        occurredAt: NOW,
        referenceDigests: [],
        safeReasonCodes: [],
        sourceEvidenceDigest: sha256Text("forged-credit-source"),
      } as never),
    ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
    expect(harness.telemetry.pairs).toHaveLength(count);
  });
  it("records every bounded downstream outcome with its required authority", async () => {
    const regressionFixture = evaluationReportWithRegression({
      currentBasisPoints: 9_000,
      currentPassed: true,
      dimension: "capability-requirement-coverage",
      priorBasisPoints: 10_000,
      priorPassed: true,
    });
    const harness = makeHarness();
    const cases = [
      ["import-inference", "repository.interpret"],
      ["generation-result", "application-source.generate"],
      ["repair-result", "candidate.repair"],
      ["validator-failure", "operations.propose"],
      ["groundedness-failure", "operations.propose"],
      ["safety-issue", "operations.propose"],
    ] as const satisfies readonly (readonly [
      ModelRuntimeOperationalEventKindV1,
      ModelRuntimeAdmissionRequestV1["operation"],
    ])[];
    let regressionExecution:
      | {
          readonly built: BuiltExecution;
          readonly result: Awaited<
            ReturnType<ModelRuntimeControlServiceV1["execute"]>
          >;
        }
      | undefined;
    for (const [eventKind, operation] of cases) {
      const built = await buildExecution(harness.store, {
        evaluationReport: regressionFixture.report,
        operation,
        policy: makePolicy(undefined, regressionFixture.report, operation),
        suffix: `outcomes_${eventKind}`,
      });
      const result = await executeDefault(harness, built);
      const safeReasonCodes =
        eventKind === "validator-failure"
          ? ["cloudmarkup.runtime.validator-failure"]
          : eventKind === "groundedness-failure"
            ? ["cloudmarkup.runtime.groundedness-failure"]
            : eventKind === "safety-issue"
              ? ["cloudmarkup.runtime.output-limit-exceeded"]
              : [];
      await harness.service.recordOperationalOutcome({
        admissionDecision: built.input.admissionDecision,
        admissionRequest: built.input.admissionRequest,
        outcomeAuthority: operationalOutcomeAuthority(
          harness,
          built,
          result,
          eventKind,
          safeReasonCodes,
        ),
        trustedAuthority: trustedAuthorityBundle(built.input),
      });
      if (operation === "operations.propose") {
        regressionExecution = { built, result };
      }
    }
    if (regressionExecution === undefined) {
      throw new Error("Missing executed regression authority fixture.");
    }
    await harness.service.recordEvaluationRegression({
      admissionDecision: regressionExecution.built.input.admissionDecision,
      admissionRequest: regressionExecution.built.input.admissionRequest,
      evaluationReport: regressionFixture.report,
      regression: regressionFixture.regression,
      trustedAuthority: trustedAuthorityBundle(regressionExecution.built.input),
    });
    const kinds = new Set(
      harness.telemetry.pairs.map((pair) => pair.audit.eventKind),
    );
    const expectedKinds = [
      ...cases.map(([eventKind]) => eventKind),
      "eval-regression",
      "estimated-cost",
      "credits",
      "tokens",
      "latency",
    ] as const satisfies readonly ModelRuntimeMetricV1["eventKind"][];
    expect(expectedKinds.every((kind) => kinds.has(kind))).toBe(true);
    expect(harness.evidenceVerifier.operationalCalls).toHaveLength(
      cases.length,
    );
  });
  it.each([
    [
      "higher-is-better improvement",
      "capability-requirement-coverage",
      10_000,
      true,
      9_000,
      true,
    ],
    [
      "lower-is-better improvement",
      "security-policy-violations",
      0,
      true,
      1_000,
      false,
    ],
  ] as const)(
    "does not label a %s as an evaluation regression",
    async (
      _label,
      dimension,
      currentBasisPoints,
      currentPassed,
      priorBasisPoints,
      priorPassed,
    ) => {
      const fixture = evaluationReportWithRegression({
        currentBasisPoints,
        currentPassed,
        dimension,
        priorBasisPoints,
        priorPassed,
      });
      const harness = makeHarness();
      const built = await buildExecution(harness.store, {
        evaluationReport: fixture.report,
        policy: makePolicy(undefined, fixture.report),
        suffix: `improvement_${dimension}`,
      });
      await expect(
        harness.service.recordEvaluationRegression({
          admissionDecision: built.input.admissionDecision,
          admissionRequest: built.input.admissionRequest,
          evaluationReport: fixture.report,
          regression: fixture.regression,
          trustedAuthority: trustedAuthorityBundle(built.input),
        }),
      ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
      expect(harness.telemetry.pairs).toHaveLength(0);
    },
  );

  it("rejects an unexecuted pass-state-only regression even when self-digested", async () => {
    const fixture = evaluationReportWithRegression({
      currentBasisPoints: 8_000,
      currentPassed: false,
      dimension: "capability-requirement-coverage",
      priorBasisPoints: 8_000,
      priorPassed: true,
    });
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      evaluationReport: fixture.report,
      policy: makePolicy(undefined, fixture.report),
      suffix: "unexecuted_pass_state_regression",
    });
    await expect(
      harness.service.recordEvaluationRegression({
        admissionDecision: built.input.admissionDecision,
        admissionRequest: built.input.admissionRequest,
        evaluationReport: fixture.report,
        regression: fixture.regression,
        trustedAuthority: trustedAuthorityBundle(built.input),
      }),
    ).rejects.toMatchObject({ safeCode: "stale-or-duplicate-conflict" });
    expect(harness.telemetry.pairs).toHaveLength(0);
  });
  it("rejects a self-digested operational authority that the host did not issue", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "forged_operational_authority",
    });
    const result = await executeDefault(harness, built);
    const issued = operationalOutcomeAuthority(
      harness,
      built,
      result,
      "safety-issue",
      ["cloudmarkup.runtime.output-limit-exceeded"],
    );
    const { authorityDigest: _authorityDigest, ...draft } = issued;
    void _authorityDigest;
    const forgedDraft = {
      ...draft,
      sourceEvidenceDigests: [sha256Text("forged-outcome-source")],
    };
    const count = harness.telemetry.pairs.length;
    await expect(
      harness.service.recordOperationalOutcome({
        admissionDecision: built.input.admissionDecision,
        admissionRequest: built.input.admissionRequest,
        outcomeAuthority: {
          ...forgedDraft,
          authorityDigest:
            digestModelRuntimeOperationalOutcomeAuthorityV1(forgedDraft),
        },
        trustedAuthority: trustedAuthorityBundle(built.input),
      }),
    ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
    expect(harness.telemetry.pairs).toHaveLength(count);
  });

  it("rejects a host-issued outcome bound to the wrong persisted terminal", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "wrong_operational_terminal",
    });
    const result = await executeDefault(harness, built);
    const exact = operationalOutcomeAuthority(
      harness,
      built,
      result,
      "validator-failure",
      ["cloudmarkup.runtime.validator-failure"],
    );
    const { authorityDigest: _authorityDigest, ...draft } = exact;
    void _authorityDigest;
    const wrongTerminalAuthority =
      harness.evidenceVerifier.issueOperationalOutcome({
        ...draft,
        terminalDigest: sha256Text("wrong-persisted-terminal"),
      });
    const count = harness.telemetry.pairs.length;
    await expect(
      harness.service.recordOperationalOutcome({
        admissionDecision: built.input.admissionDecision,
        admissionRequest: built.input.admissionRequest,
        outcomeAuthority: wrongTerminalAuthority,
        trustedAuthority: trustedAuthorityBundle(built.input),
      }),
    ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
    expect(harness.telemetry.pairs).toHaveLength(count);
  });

  it("rejects an event kind that is incompatible with the executed operation", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "incompatible_operational_event",
    });
    const result = await executeDefault(harness, built);
    const count = harness.telemetry.pairs.length;
    await expect(
      harness.service.recordOperationalOutcome({
        admissionDecision: built.input.admissionDecision,
        admissionRequest: built.input.admissionRequest,
        outcomeAuthority: operationalOutcomeAuthority(
          harness,
          built,
          result,
          "import-inference",
        ),
        trustedAuthority: trustedAuthorityBundle(built.input),
      }),
    ).rejects.toMatchObject({ safeCode: "routing-authority-mismatch" });
    expect(harness.telemetry.pairs).toHaveLength(count);
  });

  it("rejects a current but unexecuted cross-tenant regression principal", async () => {
    const fixture = evaluationReportWithRegression({
      currentBasisPoints: 9_000,
      currentPassed: true,
      dimension: "capability-requirement-coverage",
      priorBasisPoints: 10_000,
      priorPassed: true,
    });
    const harness = makeHarness();
    const owner = await buildExecution(harness.store, {
      evaluationReport: fixture.report,
      idempotencyKey: "runtime_cross_tenant_regression",
      policy: makePolicy(undefined, fixture.report),
      suffix: "cross_tenant_owner",
    });
    await executeDefault(harness, owner);
    const foreign = await buildExecution(harness.store, {
      evaluationReport: fixture.report,
      idempotencyKey: "runtime_cross_tenant_regression",
      policy: makePolicy(undefined, fixture.report),
      suffix: "cross_tenant_foreign",
      userId: "user_foreign",
    });
    const count = harness.telemetry.pairs.length;
    await expect(
      harness.service.recordEvaluationRegression({
        admissionDecision: foreign.input.admissionDecision,
        admissionRequest: foreign.input.admissionRequest,
        evaluationReport: fixture.report,
        regression: fixture.regression,
        trustedAuthority: trustedAuthorityBundle(foreign.input),
      }),
    ).rejects.toMatchObject({ safeCode: "stale-or-duplicate-conflict" });
    expect(harness.telemetry.pairs).toHaveLength(count);
  });

  it("rejects a substituted self-digested report for a persisted execution fingerprint", async () => {
    const executedFixture = evaluationReportWithRegression({
      currentBasisPoints: 9_000,
      currentPassed: true,
      dimension: "capability-requirement-coverage",
      priorBasisPoints: 10_000,
      priorPassed: true,
    });
    const substitutedFixture = evaluationReportWithRegression({
      currentBasisPoints: 9_500,
      currentPassed: true,
      dimension: "capability-requirement-coverage",
      priorBasisPoints: 10_000,
      priorPassed: true,
    });
    const harness = makeHarness();
    const executed = await buildExecution(harness.store, {
      evaluationReport: executedFixture.report,
      idempotencyKey: "runtime_substituted_report",
      policy: makePolicy(undefined, executedFixture.report),
      suffix: "substituted_report_executed",
    });
    await executeDefault(harness, executed);
    const substituted = await buildExecution(harness.store, {
      evaluationReport: substitutedFixture.report,
      idempotencyKey: "runtime_substituted_report",
      policy: makePolicy(undefined, substitutedFixture.report),
      suffix: "substituted_report_candidate",
    });
    const count = harness.telemetry.pairs.length;
    await expect(
      harness.service.recordEvaluationRegression({
        admissionDecision: substituted.input.admissionDecision,
        admissionRequest: substituted.input.admissionRequest,
        evaluationReport: substitutedFixture.report,
        regression: substitutedFixture.regression,
        trustedAuthority: trustedAuthorityBundle(substituted.input),
      }),
    ).rejects.toMatchObject({ safeCode: "stale-or-duplicate-conflict" });
    expect(harness.telemetry.pairs).toHaveLength(count);
  });

  it("recovers an operational outbox publish crash without duplicating the event", async () => {
    const harness = makeHarness();
    const built = await buildExecution(harness.store, {
      suffix: "operational_outbox_recovery",
    });
    const result = await executeDefault(harness, built);
    const outcome = {
      admissionDecision: built.input.admissionDecision,
      admissionRequest: built.input.admissionRequest,
      outcomeAuthority: operationalOutcomeAuthority(
        harness,
        built,
        result,
        "safety-issue",
        ["cloudmarkup.runtime.output-limit-exceeded"],
      ),
      trustedAuthority: trustedAuthorityBundle(built.input),
    };
    const pairCount = harness.telemetry.pairs.length;
    const attempts = harness.telemetry.publishAttempts;
    harness.telemetry.failAfterPersist(attempts + 1);
    await expect(
      harness.service.recordOperationalOutcome(outcome),
    ).rejects.toMatchObject({ safeCode: "runtime-control-unavailable" });
    expect(harness.telemetry.pairs).toHaveLength(pairCount + 1);
    const recovered = await harness.service.recordOperationalOutcome(outcome);
    expect(recovered.audit.eventKind).toBe("safety-issue");
    expect(harness.telemetry.pairs).toHaveLength(pairCount + 1);
    expect(harness.telemetry.publishAttempts).toBe(attempts + 2);
    const replayed = await harness.service.recordOperationalOutcome(outcome);
    expect(replayed.audit.eventId).toBe(recovered.audit.eventId);
    expect(harness.telemetry.publishAttempts).toBe(attempts + 2);
  });
});
