import { frozenFullBetaEvaluationDatasetV1 } from "./full-beta-evaluation-dataset.js";
import {
  digestCanonicalValue,
  modelEvaluationAuthorityTupleV1Schema,
  modelLiveRuntimeControlPolicyV2Schema,
  modelLiveEvaluationDefinitionV2Schema,
  modelLiveEvaluationApprovalV2Schema,
  modelLiveEvaluationPlanV2Schema,
  modelRuntimeInputEvidenceV1Schema,
  modelLiveRuntimeAdmissionRequestV2Schema,
  sha256Text,
} from "@cloudmarkup/schemas";
import {
  frozenModelEvaluationDatasetV1,
  frozenModelEvaluationAuthorityBindingsV1,
  modelEvaluationDefaultsV1,
} from "./model-evaluation.js";

/** Public testing export only. Synthetic fake model/prompt/case metadata and
 * self-authored receipts are never live report or production approval evidence. */
export function syntheticLiveEvaluationFixtureV2(
  input: {
    readonly organizationId?: string;
    readonly projectId?: string;
    readonly userId?: string;
    readonly operatorUserId?: string;
    readonly now?: string;
    readonly definitionId?: string;
    readonly fullBetaEvaluationSource?: boolean;
  } = {},
) {
  const now = input.now ?? "2026-09-09T12:00:00.000Z";
  const expiresAt = new Date(Date.parse(now) + 60 * 60 * 1000).toISOString();
  const scope = {
    organizationId: input.organizationId ?? "org_live_synthetic",
    projectId: input.projectId ?? "project_live_synthetic",
    userId: input.userId ?? "principal_live_synthetic",
    environment: "development" as const,
    plan: "pro" as const,
  };
  const dataset = structuredClone(
    input.fullBetaEvaluationSource
      ? frozenFullBetaEvaluationDatasetV1
      : frozenModelEvaluationDatasetV1,
  );
  const bindings = [...frozenModelEvaluationAuthorityBindingsV1];
  if (input.fullBetaEvaluationSource) {
    const base = bindings.find(
      (b) => b.authorityTuple.role === "low-cost-extraction-help",
    );
    if (!base) throw Error("Missing synthetic extraction tuple");
    const authorityTuple = modelEvaluationAuthorityTupleV1Schema.parse({
      ...base.authorityTuple,
      operation: "intent.extract",
      promptTemplateId: "cloudmarkup.model-evaluation.intent.extract",
      promptTemplateDigest: sha256Text("synthetic-full-beta-intent-prompt"),
      responseSchemaDigest: sha256Text("synthetic-full-beta-intent-schema"),
    });
    bindings.push({
      authorityTuple,
      authorityTupleDigest: digestCanonicalValue(authorityTuple),
    });
  }
  const tuples = bindings.map((b) => b.authorityTuple);
  const controls = {
    contractVersion: 2,
    recordKind: "model-live-runtime-control-policy",
    policyId: "cloudmarkup.live.synthetic",
    policyVersion: "2.0.0",
    administrativeSuspensions: [],
    allowlists: {
      dependencies: [],
      providers: [],
      modules: [],
      modelConfigurationReferences: [
        ...new Set(tuples.map((t) => t.modelConfigurationReference)),
      ],
      roles: [...new Set(tuples.map((t) => t.role))],
      routes: ["standard-design"],
    },
    cacheKeyAuthority: {
      dataResidencyBoundary: "cloudmarkup.synthetic.residency",
      organizationSafePolicyScope: "cloudmarkup.synthetic.cache",
    },
    canonicalCommercialAuthority: "canonical-commercial-v1",
    evaluationRequirement: {
      datasetId: dataset.datasetId,
      datasetVersion: dataset.datasetVersion,
      datasetDigest: dataset.datasetDigest,
      datasetCaseDigests: dataset.cases.map((c) => c.caseDigest),
      evaluationPolicyDigest: modelEvaluationDefaultsV1.evaluationPolicyDigest,
      evaluationPolicyId: modelEvaluationDefaultsV1.evaluationPolicyId,
      evaluationPolicyVersion:
        modelEvaluationDefaultsV1.evaluationPolicyVersion,
      minimumDeterministicQualityBasisPoints: 9000,
    },
    featureEntitlements: [
      { plan: "pro", features: [...new Set(tuples.map((t) => t.operation))] },
    ],
    killSwitches: { global: { engaged: false }, capabilitySwitches: [] },
    limits: {
      maximumEdges: 1000,
      maximumFiles: 100,
      maximumNodes: 500,
      maximumOutputBytes: 1000000,
      maximumOutputTokens: 10000,
      maximumPromptBytes: 100000,
      maximumRepairAttempts: 2,
      maximumRepositoryBytes: 10000000,
      maximumRepositoryFiles: 1000,
    },
    liveEvaluation: {
      enabledByDefault: false,
      excludedFromNormalCi: true,
      killSwitchEngagedByDefault: true,
      permittedEnvironments: ["development", "staging"],
    },
    requestWindows: {
      organization: {
        maximumConcurrentJobs: 2,
        maximumRequests: 100,
        windowSeconds: 3600,
      },
      user: {
        maximumConcurrentJobs: 1,
        maximumRequests: 30,
        windowSeconds: 3600,
      },
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
  const policy = modelLiveRuntimeControlPolicyV2Schema.parse({
    ...controls,
    policyDigest: digestCanonicalValue(controls),
  });
  const definitionMetadata = {
    contractVersion: 2,
    recordKind: "model-live-evaluation-definition",
    definitionId: input.definitionId ?? "live_definition_synthetic",
    scope,
    policy,
    expiresAt,
    normalCi: false,
    cases: dataset.cases.map((c) => {
      const authorityBinding = bindings.find(
        (b) =>
          b.authorityTuple.operation ===
            c.expected.authorityRequirement.operation &&
          b.authorityTuple.role === c.expected.authorityRequirement.role,
      );
      if (authorityBinding === undefined)
        throw Error("Missing frozen synthetic authority tuple.");
      return {
        caseId: c.caseId,
        caseDigest: c.caseDigest,
        sourceInputDigest: digestCanonicalValue(c.input),
        invocationInputDigest: digestCanonicalValue({
          synthetic: true,
          caseDigest: c.caseDigest,
          scope,
        }),
        authorityBinding,
        routeId: "standard-design",
      };
    }),
    limits: {
      maximumConcurrentJobs: 1,
      maximumCreditUnits: 100,
      maximumEstimatedMicroUsd: 1000000,
      maximumInputTokens: 100000,
      maximumInvocations: 21,
      maximumOutputTokens: 100000,
      maximumTotalTokens: 200000,
    },
  };
  const definition = modelLiveEvaluationDefinitionV2Schema.parse({
    ...definitionMetadata,
    definitionDigest: digestCanonicalValue(definitionMetadata),
  });
  const approvalMetadata = {
    contractVersion: 2,
    recordKind: "model-live-evaluation-approval",
    approvalId: "live_approval_synthetic",
    definitionDigest: definition.definitionDigest,
    scope,
    operatorUserId: input.operatorUserId ?? scope.userId,
    approvedAt: now,
    expiresAt,
  };
  const approval = modelLiveEvaluationApprovalV2Schema.parse({
    ...approvalMetadata,
    approvalDigest: digestCanonicalValue(approvalMetadata),
  });
  const planMetadata = {
    contractVersion: 2,
    recordKind: "model-live-evaluation-plan",
    planId: "live_plan_synthetic",
    definition,
    approval,
    issuedAt: now,
    expiresAt,
  };
  const plan = modelLiveEvaluationPlanV2Schema.parse({
    ...planMetadata,
    planDigest: digestCanonicalValue(planMetadata),
  });
  const binding = definition.cases[0];
  if (binding === undefined) throw Error("Missing frozen synthetic case.");
  const tuple = binding.authorityBinding.authorityTuple;
  const requested = {
    dependencyNames: [],
    edgeCount: 0,
    fileCount: 0,
    moduleSources: [],
    nodeCount: 0,
    outputBytes: 10000,
    outputTokens: 1000,
    promptBytes: 100,
    providerSources: [],
    repairAttempts: 0,
    repositoryBytes: 0,
    repositoryFiles: 0,
  };
  const evidenceMetadata = {
    authority: {
      credential: false,
      deployment: false,
      shell: false,
      tool: false,
      url: false,
    },
    contractVersion: 1,
    evidenceId: "evidence_live_synthetic",
    inputDigest: binding.invocationInputDigest,
    inputSanitized: true,
    noRawSensitiveContent: true,
    operation: tuple.operation,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    recordKind: "model-runtime-input-evidence",
    requested,
    secretRedactionApplied: true,
    sourceOwnership: { status: "not-applicable", evidenceDigests: [] },
    verifierId: "cloudmarkup.synthetic.verifier",
    verifierVersion: "1.0.0",
  };
  const inputEvidence = modelRuntimeInputEvidenceV1Schema.parse({
    ...evidenceMetadata,
    evidenceDigest: digestCanonicalValue(evidenceMetadata),
  });
  const estimate = {
    canonicalAuthority: "canonical-commercial-v1",
    estimatedMicroUsd: 1000,
    maximumCreditUnits: 1,
    pricingVersionReference: "cloudmarkup.synthetic.pricing",
  };
  const requestMetadata = {
    capabilityRegistryDigest: tuple.capabilityRegistryDigest,
    cacheKeyAuthority: policy.cacheKeyAuthority,
    catalogDigest: tuple.catalogDigest,
    commercialEstimate: {
      ...estimate,
      estimateDigest: digestCanonicalValue(estimate),
    },
    contractVersion: 2,
    evaluationAuthorityTupleDigest:
      binding.authorityBinding.authorityTupleDigest,
    evaluationCaseDigest: binding.caseDigest,
    evaluationCaseId: binding.caseId,
    executionClass: "live-evaluation",
    idempotencyKeyDigest: sha256Text("synthetic live idempotency"),
    inputDigest: binding.invocationInputDigest,
    inputEvidenceDigest: inputEvidence.evidenceDigest,
    liveEvaluationAuthorityDigest: approval.approvalDigest,
    liveEvaluationPlanDigest: plan.planDigest,
    operation: tuple.operation,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    plan: scope.plan,
    promptTemplateDigest: tuple.promptTemplateDigest,
    recordKind: "model-live-runtime-admission-request",
    requested,
    responseSchemaDigest: tuple.responseSchemaDigest,
    role: tuple.role,
    routeRegistryDigest: tuple.routeRegistryDigest,
    routingDecisionDigest: sha256Text("synthetic live route"),
    runtimePolicyDigest: policy.policyDigest,
  };
  const request = modelLiveRuntimeAdmissionRequestV2Schema.parse({
    ...requestMetadata,
    requestDigest: digestCanonicalValue(requestMetadata),
  });
  return {
    definition,
    dataset,
    policy,
    approval,
    plan,
    inputEvidence,
    request,
    now,
    scope,
  };
}
