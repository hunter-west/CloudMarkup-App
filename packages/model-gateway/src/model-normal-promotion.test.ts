import { beforeAll, describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  digestModelEvaluationAuthorityRequirementV1,
  digestModelEvaluationCaseV1,
  digestModelEvaluationCaseResultV1,
  digestModelEvaluationDatasetV1,
  digestModelEvaluationReportV1,
  digestModelRuntimeControlConfigurationV1,
  digestModelRuntimeControlPolicyV1,
  modelEvaluationAuthorityTupleV1Schema,
  modelEvaluationReportV1Schema,
  modelEvaluationDatasetV1Schema,
  modelNormalPromotionReceiptV1Schema,
  modelRuntimeControlPolicyV1Schema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  type ModelEvaluationReportV1,
  type ModelEvaluationDatasetV1,
  type ModelNormalPromotionReceiptV1,
  type ModelRuntimeControlPolicyV1,
} from "@cloudmarkup/schemas";

import {
  frozenModelEvaluationDatasetV1,
  runFrozenDeterministicModelEvaluationV1,
} from "./model-evaluation.js";
import { checkModelNormalPromotionBindingsV1 } from "./model-normal-promotion.js";
import { sha256Text } from "./security.js";

let syntheticReport: ModelEvaluationReportV1;
let syntheticFakeReport: ModelEvaluationReportV1;
let syntheticDataset: ModelEvaluationDatasetV1;
let deterministicReport: ModelEvaluationReportV1;
beforeAll(async () => {
  deterministicReport = (await runFrozenDeterministicModelEvaluationV1())
    .report;
  // Structural fixture ONLY, never an issued report, persisted authority,
  // runtime input or provider call. The real frozen dataset has no Intent tuple.
  // Create separate synthetic metadata; never alter that dataset/evaluator or
  // claim this rewritten fixture establishes genuine live coverage.
  const authorityRequirement = {
    operation: "intent.extract" as const,
    role: "low-cost-extraction-help" as const,
  };
  const authorityTuple = modelEvaluationAuthorityTupleV1Schema.parse({
    capabilityRegistryDigest: sha256Text("synthetic capabilities"),
    catalogDigest: sha256Text("synthetic catalog"),
    inferenceProfileId: "inference.synthetic.standard",
    modelConfigurationReference: "model.synthetic.standard",
    ...authorityRequirement,
    promptTemplateDigest: sha256Text("synthetic prompt"),
    promptTemplateId: "prompt.synthetic.intent",
    promptTemplateVersion: "1.0.0",
    responseSchemaDigest: sha256Text("synthetic response"),
    routeDefinitionDigest: sha256Text("synthetic route"),
    routeRegistryDigest: sha256Text("synthetic route registry"),
  });
  const authorityBinding = {
    authorityTuple,
    authorityTupleDigest: digestCanonicalValue(authorityTuple),
  };
  const { datasetDigest, ...datasetMetadata } = frozenModelEvaluationDatasetV1;
  void datasetDigest;
  const datasetShape = {
    ...datasetMetadata,
    datasetId: namespacedIdentifierSchema.parse(
      "cloudmarkup.synthetic.unissued.promotion",
    ),
    cases: datasetMetadata.cases.map((entry, index) => {
      if (index !== 0) return entry;
      const { caseDigest, ...metadata } = entry;
      void caseDigest;
      const changed = {
        ...metadata,
        expected: {
          ...metadata.expected,
          authorityRequirement,
          authorityRequirementDigest:
            digestModelEvaluationAuthorityRequirementV1(authorityRequirement),
        },
      };
      return { ...changed, caseDigest: digestModelEvaluationCaseV1(changed) };
    }),
  };
  syntheticDataset = modelEvaluationDatasetV1Schema.parse({
    ...datasetShape,
    datasetDigest: digestModelEvaluationDatasetV1(datasetShape),
  });
  const firstCase = syntheticDataset.cases[0];
  if (firstCase === undefined) throw new Error("Missing synthetic case.");
  const caseResults = deterministicReport.caseResults.map((entry) => {
    if (entry.caseId !== firstCase.caseId) return entry;
    const { resultDigest, ...metadata } = entry;
    void resultDigest;
    const changed = {
      ...metadata,
      caseDigest: firstCase.caseDigest,
      authorityRequirement,
      authorityRequirementDigest:
        digestModelEvaluationAuthorityRequirementV1(authorityRequirement),
      authorityTupleDigest: authorityBinding.authorityTupleDigest,
    };
    return {
      ...changed,
      resultDigest: digestModelEvaluationCaseResultV1(changed),
    };
  });
  const authorityBindings = [
    ...deterministicReport.authorityBindings,
    authorityBinding,
  ].filter((binding) =>
    caseResults.some(
      (entry) => entry.authorityTupleDigest === binding.authorityTupleDigest,
    ),
  );
  const { reportDigest, ...metadata } = deterministicReport;
  void reportDigest;
  const shape = {
    ...metadata,
    authorityBindings,
    authorityBindingSetDigest: digestCanonicalValue(
      authorityBindings.map((binding) => binding.authorityTupleDigest),
    ),
    caseResults,
    datasetDigest: syntheticDataset.datasetDigest,
    datasetCaseDigests: syntheticDataset.cases.map((entry) => entry.caseDigest),
    evaluationResultSetDigest: digestCanonicalValue(
      caseResults.map((entry) => entry.resultDigest),
    ),
    executionMode: "opt-in-live" as const,
    environment: "staging" as const,
    normalCi: false,
    liveEvaluationAuthorityDigest: sha256Text(
      "unissued synthetic live provenance",
    ),
  };
  syntheticReport = modelEvaluationReportV1Schema.parse({
    ...shape,
    reportDigest: digestModelEvaluationReportV1(shape),
  });
  const { liveEvaluationAuthorityDigest, ...fakeMetadata } = shape;
  void liveEvaluationAuthorityDigest;
  const fakeShape = {
    ...fakeMetadata,
    executionMode: "deterministic-fake" as const,
    normalCi: false,
  };
  syntheticFakeReport = modelEvaluationReportV1Schema.parse({
    ...fakeShape,
    reportDigest: digestModelEvaluationReportV1(fakeShape),
  });
});

function policyFor(
  report: ModelEvaluationReportV1,
): ModelRuntimeControlPolicyV1 {
  const binding = report.authorityBindings.find(
    (entry) => entry.authorityTuple.operation === "intent.extract",
  );
  if (binding === undefined) throw new Error("Missing synthetic Intent tuple.");
  const tuple = binding.authorityTuple;
  const base: Omit<
    ModelRuntimeControlPolicyV1,
    "policyDigest" | "runtimeControlConfigurationDigest"
  > = {
    administrativeSuspensions: [],
    allowlists: {
      dependencies: [],
      modules: [],
      providers: [],
      modelConfigurationReferences: [tuple.modelConfigurationReference],
      roles: [tuple.role],
      routes: ["standard-design"],
    },
    cacheKeyAuthority: {
      dataResidencyBoundary: namespacedIdentifierSchema.parse(
        "residency.synthetic",
      ),
      organizationSafePolicyScope:
        namespacedIdentifierSchema.parse("scope.synthetic"),
    },
    canonicalCommercialAuthority: "canonical-commercial-v1",
    contractVersion: 1,
    evaluationGate: {
      ...binding,
      capabilityRegistryDigest: tuple.capabilityRegistryDigest,
      deterministicPassed: true,
      deterministicQualityBasisPoints: report.deterministicQualityBasisPoints,
      datasetCaseDigests: report.datasetCaseDigests,
      datasetDigest: report.datasetDigest,
      evaluationPolicyDigest: report.evaluationPolicyDigest,
      evaluationPolicyId: report.evaluationPolicyId,
      evaluationPolicyVersion: report.evaluationPolicyVersion,
      evaluationReportDigest: report.reportDigest,
      evaluationReportId: report.evaluationReportId,
      evaluationResultSetDigest: report.evaluationResultSetDigest,
      minimumDeterministicQualityBasisPoints: 0,
      routeRegistryDigest: tuple.routeRegistryDigest,
    },
    featureEntitlements: [{ features: ["intent.extract"], plan: "pro" }],
    killSwitches: { capabilitySwitches: [], global: { engaged: false } },
    limits: {
      maximumEdges: 1,
      maximumFiles: 1,
      maximumNodes: 1,
      maximumOutputBytes: 1000,
      maximumOutputTokens: 100,
      maximumPromptBytes: 1000,
      maximumRepairAttempts: 0,
      maximumRepositoryBytes: 1,
      maximumRepositoryFiles: 1,
    },
    liveEvaluation: {
      enabledByDefault: false,
      excludedFromNormalCi: true,
      killSwitchEngagedByDefault: true,
      permittedEnvironments: ["development", "staging"],
    },
    policyId: namespacedIdentifierSchema.parse("policy.synthetic.normal"),
    policyVersion: semanticVersionSchema.parse("1.0.0"),
    recordKind: "model-runtime-control-policy",
    requestWindows: {
      organization: {
        maximumConcurrentJobs: 1,
        maximumRequests: 1,
        windowSeconds: 60,
      },
      user: { maximumConcurrentJobs: 1, maximumRequests: 1, windowSeconds: 60 },
    },
    safety: {
      arbitraryPackageAuthority: false,
      arbitraryShellAuthority: false,
      arbitraryToolAuthority: false,
      arbitraryUrlAuthority: false,
      credentialAuthority: false,
      deploymentAuthority: false,
      rawSensitiveLogsPermitted: false,
      repositoryWriteAuthority: false,
      resultSanitizationRequired: true,
      secretRedactionRequired: true,
      structuredOutputsRequired: true,
      tenantSafeCacheAndPromptKeysRequired: true,
    },
  };
  const configured = {
    ...base,
    runtimeControlConfigurationDigest:
      digestModelRuntimeControlConfigurationV1(base),
  };
  return modelRuntimeControlPolicyV1Schema.parse({
    ...configured,
    policyDigest: digestModelRuntimeControlPolicyV1(configured),
  });
}
function changedReceipt(
  receipt: ModelNormalPromotionReceiptV1,
  patch: Record<string, unknown>,
) {
  const { authorityDigest, ...metadata } = receipt;
  void authorityDigest;
  const changed = { ...metadata, ...patch };
  return { ...changed, authorityDigest: digestCanonicalValue(changed) };
}
function fixture(report = syntheticReport) {
  const policy = policyFor(report);
  const gate = policy.evaluationGate;
  const metadata = {
    authorityBinding: {
      authorityTuple: gate.authorityTuple,
      authorityTupleDigest: gate.authorityTupleDigest,
    },
    contractVersion: 1,
    effectiveFrom: "2026-09-07T12:00:01.000Z",
    expiresAt: "2026-09-07T12:05:00.000Z",
    issuedAt: "2026-09-07T12:00:00.000Z",
    issuerId: "issuer.synthetic.unissued",
    issuerVersion: "1.0.0",
    receiptId: "receipt.synthetic.unissued",
    recordKind: "model-normal-promotion-receipt",
    routeId: "standard-design",
    scope: {
      environment: "production",
      organizationId: "org.synthetic",
      projectId: "project.synthetic",
      userId: "user.synthetic",
    },
    evaluation: {
      datasetCaseDigests: report.datasetCaseDigests,
      datasetDigest: report.datasetDigest,
      environment: "staging",
      evaluationPolicyDigest: report.evaluationPolicyDigest,
      evaluationPolicyId: report.evaluationPolicyId,
      evaluationPolicyVersion: report.evaluationPolicyVersion,
      liveEvaluationAuthorityDigest:
        report.liveEvaluationAuthorityDigest ?? sha256Text("unissued fixture"),
      reportDigest: report.reportDigest,
      reportId: report.evaluationReportId,
      resultSetDigest: report.evaluationResultSetDigest,
    },
    runtimePolicy: {
      policyDigest: policy.policyDigest,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      runtimeControlConfigurationDigest:
        policy.runtimeControlConfigurationDigest,
    },
  };
  const receipt = modelNormalPromotionReceiptV1Schema.parse({
    ...metadata,
    authorityDigest: digestCanonicalValue(metadata),
  });
  return {
    receipt,
    dataset: structuredClone(syntheticDataset),
    report: structuredClone(report),
    policy,
    expectedScope: structuredClone(receipt.scope),
    expectedAuthorityBinding: structuredClone(receipt.authorityBinding),
    observedAt: "2026-09-07T12:00:02.000Z",
  };
}
const rejects = (value: unknown) => {
  expect(() => checkModelNormalPromotionBindingsV1(value)).toThrow(
    "The proposed normal promotion metadata does not match its evidence.",
  );
};

describe("offline normal promotion exact-binding check (never issuance authority)", () => {
  it("checks all21 cases and unchanged held evidence without asserting any authority", () => {
    const f = fixture();
    const before = digestCanonicalValue(f);
    const result = checkModelNormalPromotionBindingsV1(f);
    expect(result).toMatchObject({
      kind: "bindings-match",
      issuanceVerified: false,
      currentAuthorityVerified: false,
      capabilityActivated: false,
    });
    expect(result.receipt).toEqual(f.receipt);
    expect(result.receipt).not.toBe(f.receipt);
    expect(result.receipt.evaluation.datasetCaseDigests).toHaveLength(21);
    expect(digestCanonicalValue(f)).toBe(before);
    expect(f.report.activationRecommendation).toBe("hold");
    expect(f.report.capabilityActivated).toBe(false);
    expect(deterministicReport.executionMode).toBe("deterministic-fake");
    expect(deterministicReport.activationRecommendation).toBe("hold");
    expect(
      deterministicReport.authorityBindings.some(
        (entry) => entry.authorityTuple.operation === "intent.extract",
      ),
    ).toBe(false);
    expect(
      frozenModelEvaluationDatasetV1.cases.some(
        (entry) =>
          entry.expected.authorityRequirement.operation === "intent.extract",
      ),
    ).toBe(false);
  });
  it("rejects fake-mode provenance even when every receipt/report/policy digest agrees", () => {
    rejects(fixture(syntheticFakeReport));
  });
  it.each(["organizationId"])("rejects mismatched %s scope", (field) => {
    const f = fixture();
    rejects({
      ...f,
      expectedScope: {
        ...f.expectedScope,
        [field]: field === "environment" ? "staging" : "scope.other",
      },
    });
  });
  it.each(["inferenceProfileId"])(
    "rejects substituted tuple %s after rehash",
    (field) => {
      const f = fixture();
      const changedRole =
        f.expectedAuthorityBinding.authorityTuple.role ===
        "standard-planning-generation"
          ? "low-cost-extraction-help"
          : "standard-planning-generation";
      const tuple = {
        ...f.expectedAuthorityBinding.authorityTuple,
        [field]: field.endsWith("Digest")
          ? sha256Text("changed tuple")
          : field === "promptTemplateVersion"
            ? "2.0.0"
            : field === "role"
              ? changedRole
              : "synthetic.changed",
      };
      rejects({
        ...f,
        expectedAuthorityBinding: {
          authorityTuple: tuple,
          authorityTupleDigest: digestCanonicalValue(tuple),
        },
      });
    },
  );
  it.each([
    "datasetDigest",
    "reportDigest",
    "resultSetDigest",
    "evaluationPolicyDigest",
    "liveEvaluationAuthorityDigest",
    "environment",
  ])("rejects substituted evaluation %s after rehash", (field) => {
    const f = fixture();
    const evaluation = {
      ...f.receipt.evaluation,
      [field]: field.endsWith("Digest")
        ? sha256Text("changed evidence")
        : field === "evaluationPolicyVersion"
          ? "2.0.0"
          : field === "environment"
            ? "development"
            : "synthetic.changed",
    };
    rejects({ ...f, receipt: changedReceipt(f.receipt, { evaluation }) });
  });
  it.each(["policyDigest", "runtimeControlConfigurationDigest"])(
    "rejects substituted final %s after rehash",
    (field) => {
      const f = fixture();
      const runtimePolicy = {
        ...f.receipt.runtimePolicy,
        [field]: field.endsWith("Digest")
          ? sha256Text("changed policy")
          : field === "policyVersion"
            ? "2.0.0"
            : "policy.changed",
      };
      rejects({ ...f, receipt: changedReceipt(f.receipt, { runtimePolicy }) });
    },
  );
  it("rejects omitted, repeated or reordered coverage rather than accepting one Intent demo", () => {
    const f = fixture();
    rejects({
      ...f,
      dataset: { ...f.dataset, cases: f.dataset.cases.slice(0, 1) },
    });
    rejects({
      ...f,
      report: { ...f.report, caseResults: f.report.caseResults.slice(1) },
    });
    rejects({
      ...f,
      receipt: changedReceipt(f.receipt, {
        evaluation: {
          ...f.receipt.evaluation,
          datasetCaseDigests: [
            ...f.receipt.evaluation.datasetCaseDigests,
          ].reverse(),
        },
      }),
    });
  });
  it("rejects a self-consistent rehashed report whose case identity does not match the dataset", () => {
    const f = fixture();
    const caseResults = f.report.caseResults.map((entry, index) => {
      if (index !== 0) return entry;
      const { resultDigest, ...metadata } = entry;
      void resultDigest;
      const changed = { ...metadata, caseId: "case.synthetic.substituted" };
      return {
        ...changed,
        resultDigest: digestModelEvaluationCaseResultV1(changed),
      };
    });
    const { reportDigest, ...metadata } = f.report;
    void reportDigest;
    const changed = {
      ...metadata,
      caseResults,
      evaluationResultSetDigest: digestCanonicalValue(
        caseResults.map((entry) => entry.resultDigest),
      ),
    };
    const report = modelEvaluationReportV1Schema.parse({
      ...changed,
      reportDigest: digestModelEvaluationReportV1(changed),
    });
    rejects(fixture(report));
  });
  it.each(["2026-09-07T12:00:00.000Z", "2026-09-07T12:05:00.000Z"])(
    "rejects out-of-window observation %s without reading a clock",
    (observedAt) => {
      rejects({ ...fixture(), observedAt });
    },
  );
  it("does not claim issuance or revocation checks even for internally consistent changed issuer metadata", () => {
    const f = fixture();
    const receipt = changedReceipt(f.receipt, {
      issuerId: "issuer.synthetic.other",
      receiptId: "receipt.synthetic.other",
    });
    expect(
      checkModelNormalPromotionBindingsV1({ ...f, receipt }),
    ).toMatchObject({
      issuanceVerified: false,
      currentAuthorityVerified: false,
      capabilityActivated: false,
    });
    rejects({ ...f, verified: true });
    rejects({ ...f, receipt: { ...f.receipt, approved: true } });
  });
  it("rejects changed report content and a rewritten eligible recommendation", () => {
    const f = fixture();
    rejects({
      ...f,
      report: { ...f.report, evaluationReportId: "report.changed" },
    });
    const { reportDigest, ...metadata } = f.report;
    void reportDigest;
    const changed = {
      ...metadata,
      activationRecommendation: "eligible-for-reviewed-beta" as const,
    };
    const report = modelEvaluationReportV1Schema.parse({
      ...changed,
      reportDigest: digestModelEvaluationReportV1(changed),
    });
    rejects(fixture(report));
  });
});
