import type {
  CreditNormalizationPolicyVersionV1,
  ModelProviderPricingVersionV1,
} from "@cloudmarkup/domain";
import type { TrustedCommercialAdministrationContext } from "../../application/commercial-persistence.js";
import { PostgresModelCommercialPersistenceRepository } from "./model-commercial-repository.js";
import type { SqlDatabase } from "./sql.js";
import {
  digestStructuredValue,
  projectModelRuntimeExecutionIdentityV1,
  runFrozenDeterministicModelEvaluationV1,
  sha256Text,
  type ModelCommercialWorkflowRecordV1,
  type ModelRuntimeControlExecutionInputV1,
  type ModelCommercialPricingRoutePinV1,
  type ModelRuntimeStateSnapshotRequestV1,
} from "@cloudmarkup/model-gateway";
import {
  modelTestContext,
  modelTestRoutingDecision,
  modelTestRoutingRequest,
} from "@cloudmarkup/model-gateway/testing";
import {
  digestModelRuntimeControlConfigurationV1,
  digestModelRuntimeControlPolicyV1,
  modelRoutingDecisionV1Schema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  modelRuntimeAdmissionDecisionV1Schema,
  modelRuntimeAdmissionRequestV1Schema,
  modelRuntimeControlPolicyV1Schema,
  modelRuntimeInputEvidenceV1Schema,
  modelInvocationDescriptorV1Schema,
  type ModelInvocationDescriptorV1,
  type ModelRuntimeControlPolicyV1,
} from "@cloudmarkup/schemas";
import { aiPreviewFixture } from "./ai-intent-preview-test-helpers.js";
import {
  parseModelCommercialReadSelectors,
  type ModelCommercialReadSelectorsV1,
} from "./model-commercial-read-host-codec.js";
import { runtimeAdmissionFixture } from "./model-runtime-admission-test-helpers.js";

const hash = (label: string) =>
  sha256Text(`unissued synthetic commercial reader ${label}`);
let reportPromise:
  ReturnType<typeof runFrozenDeterministicModelEvaluationV1> | undefined;
interface ModelReadRuntimeFixture {
  readonly runtime: ModelRuntimeControlExecutionInputV1;
  readonly identity: ReturnType<typeof projectModelRuntimeExecutionIdentityV1>;
  readonly state: ModelRuntimeStateSnapshotRequestV1;
  readonly selectors: ModelCommercialReadSelectorsV1;
  readonly base: ReturnType<typeof runtimeAdmissionFixture>;
  readonly pin: ModelCommercialPricingRoutePinV1;
  readonly descriptor: ModelInvocationDescriptorV1;
}
/** Component-only metadata. The genuine frozen fake report is unchanged/held
 * and cannot authorize this Intent route. No runtime.execute, issuance, paid
 * provider, or production authority is constructed by this test helper. */
export async function modelReadRuntimeFixture(
  preview: ReturnType<typeof aiPreviewFixture>,
  record: ModelCommercialWorkflowRecordV1,
  planVersionId: string,
): Promise<ModelReadRuntimeFixture> {
  const report = (
    await (reportPromise ??= runFrozenDeterministicModelEvaluationV1())
  ).report;
  const binding = report.authorityBindings[0];
  const resolved = record.resolvedContext;
  const pin = resolved?.estimateResult.pricingAuthority.routePins[0];
  if (!binding || !pin)
    throw new Error("Missing synthetic read fixture metadata.");
  const request = record.request;
  const context = {
    ...modelTestContext(preview.binding.invocationId),
    scope: preview.scope,
    idempotencyKeyDigest: sha256Text(request.idempotencyKey),
    evaluationPolicyId: report.evaluationPolicyId,
    evaluationPolicyVersion: report.evaluationPolicyVersion,
    entitlement: {
      ...modelTestContext("synthetic").entitlement,
      planVersionId,
    },
    budget: {
      ...modelTestContext("synthetic").budget,
      acceptedEstimateMaximumCreditUnits:
        resolved.estimateResult.estimate.maximumCreditUnits,
    },
  };
  const routingRequest = modelTestRoutingRequest(
    preview.modelRequest,
    context,
    { environment: request.environment },
  );
  const descriptor = modelInvocationDescriptorV1Schema.parse({
    ...preview.invocation.descriptor,
    idempotencyKeyDigest: sha256Text(request.idempotencyKey),
  });
  const routingDecision = modelRoutingDecisionV1Schema.parse({
    ...modelTestRoutingDecision(routingRequest),
    capabilityRegistryDigest: binding.authorityTuple.capabilityRegistryDigest,
    routeRegistryDigest: binding.authorityTuple.routeRegistryDigest,
    feature: "intent.extract",
    maximumAttempts: 1,
    promptCachePolicy: {
      enabled: false,
      cacheKeyRequired: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
    customerCharge: {
      acceptedMaximumCreditUnits:
        resolved.estimateResult.estimate.maximumCreditUnits,
      incrementalEscalationCreditUnits: 0,
      policy: "accepted-estimate-cap",
    },
    entitlement: {
      allowed: true,
      decisionId: context.entitlement.decisionId,
      planKey: "pro",
      planVersionId,
    },
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    providerId: descriptor.providerId,
    inferenceProfileId: descriptor.inferenceProfileId,
    pricingVersionReference: pin.pricingVersion.pricingVersionId,
    evaluationPolicyId: report.evaluationPolicyId,
    evaluationPolicyVersion: report.evaluationPolicyVersion,
  });
  const configuration = {
    administrativeSuspensions: [],
    allowlists: {
      dependencies: [],
      modules: [],
      providers: [],
      modelConfigurationReferences: [
        routingDecision.modelConfigurationReference,
      ],
      roles: ["low-cost-extraction-help"],
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
      capabilityRegistryDigest: routingDecision.capabilityRegistryDigest,
      routeRegistryDigest: routingDecision.routeRegistryDigest,
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
      minimumDeterministicQualityBasisPoints: 9000,
    },
    featureEntitlements: [{ features: ["intent.extract"], plan: "pro" }],
    killSwitches: { capabilitySwitches: [], global: { engaged: false } },
    limits: {
      maximumEdges: 1000,
      maximumFiles: 100,
      maximumNodes: 500,
      maximumOutputBytes: 1000000,
      maximumOutputTokens: 1000,
      maximumPromptBytes: 100000,
      maximumRepairAttempts: 0,
      maximumRepositoryBytes: 10000000,
      maximumRepositoryFiles: 1000,
    },
    liveEvaluation: {
      enabledByDefault: false,
      excludedFromNormalCi: true,
      killSwitchEngagedByDefault: true,
      permittedEnvironments: ["development", "staging"],
    },
    policyId: namespacedIdentifierSchema.parse("runtime.synthetic.read"),
    policyVersion: semanticVersionSchema.parse("1.0.0"),
    recordKind: "model-runtime-control-policy",
    requestWindows: {
      organization: {
        maximumConcurrentJobs: 2,
        maximumRequests: 100,
        windowSeconds: 3600,
      },
      user: {
        maximumConcurrentJobs: 2,
        maximumRequests: 20,
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
  } satisfies Omit<
    ModelRuntimeControlPolicyV1,
    "policyDigest" | "runtimeControlConfigurationDigest"
  >;
  const policyBody = {
    ...configuration,
    runtimeControlConfigurationDigest:
      digestModelRuntimeControlConfigurationV1(configuration),
  };
  const policy = modelRuntimeControlPolicyV1Schema.parse({
    ...policyBody,
    policyDigest: digestModelRuntimeControlPolicyV1(policyBody),
  });
  const scope = {
    organizationId: request.organizationId,
    projectId: request.projectId,
    userId: request.userId,
  };
  const base = runtimeAdmissionFixture(
    scope,
    request.requestedAt,
    request.requestId,
  );
  const requested = {
    ...base.request.requested,
    outputTokens: request.requestedMaximumOutputUnits,
  };
  const evidenceBody = {
    authority: {
      credential: false,
      deployment: false,
      shell: false,
      tool: false,
      url: false,
    },
    contractVersion: 1,
    evidenceId: `evidence_${request.requestId}`,
    inputDigest: routingRequest.inputDigest,
    inputSanitized: true,
    noRawSensitiveContent: true,
    operation: "intent.extract",
    ...scope,
    recordKind: "model-runtime-input-evidence",
    requested,
    secretRedactionApplied: true,
    sourceOwnership: {
      evidenceDigests: [hash("ownership")],
      status: "verified",
    },
    verifierId: "verifier.synthetic",
    verifierVersion: "1.0.0",
  } as const;
  const inputEvidence = modelRuntimeInputEvidenceV1Schema.parse({
    ...evidenceBody,
    evidenceDigest: digestStructuredValue(evidenceBody),
  });
  const estimate = {
    canonicalAuthority: "canonical-commercial-v1",
    estimatedMicroUsd:
      resolved.estimateResult.maximumEstimatedProviderCostMicros,
    maximumCreditUnits: resolved.estimateResult.estimate.maximumCreditUnits,
    pricingVersionReference: pin.pricingVersion.pricingVersionId,
  };
  const { requestDigest: oldRequestDigest, ...baseRequest } = base.request;
  void oldRequestDigest;
  const requestBody = {
    ...baseRequest,
    capabilityRegistryDigest: routingDecision.capabilityRegistryDigest,
    cacheKeyAuthority: policy.cacheKeyAuthority,
    commercialEstimate: {
      ...estimate,
      estimateDigest: digestStructuredValue(estimate),
    },
    idempotencyKeyDigest: sha256Text(request.idempotencyKey),
    inputDigest: routingRequest.inputDigest,
    inputEvidenceDigest: inputEvidence.evidenceDigest,
    requested,
    role: "low-cost-extraction-help",
    routeRegistryDigest: routingDecision.routeRegistryDigest,
    routingDecisionDigest: digestStructuredValue(routingDecision),
    runtimePolicyDigest: policy.policyDigest,
  };
  const admissionRequest = modelRuntimeAdmissionRequestV1Schema.parse({
    ...requestBody,
    requestDigest: digestStructuredValue(requestBody),
  });
  const { decisionDigest: oldDecisionDigest, ...baseDecision } = base.decision;
  void oldDecisionDigest;
  const decisionBody = {
    ...baseDecision,
    authorization: {
      ...baseDecision.authorization,
      commercialReservationDecisionId: request.reservationId,
      entitlementDecisionId: routingRequest.plan.entitlementDecisionId,
    },
    expiresAt: request.expiresAt,
    requestDigest: admissionRequest.requestDigest,
    commercialEstimateDigest:
      admissionRequest.commercialEstimate.estimateDigest,
    routingDecisionDigest: admissionRequest.routingDecisionDigest,
    runtimePolicyDigest: policy.policyDigest,
  };
  const admissionDecision = modelRuntimeAdmissionDecisionV1Schema.parse({
    ...decisionBody,
    decisionDigest: digestStructuredValue(decisionBody),
  });
  const runtime: ModelRuntimeControlExecutionInputV1 = {
    admissionRequest,
    admissionDecision,
    commercialRequest: request,
    evaluationReport: report,
    inputEvidence,
    policy,
    catalogDigest: admissionRequest.catalogDigest,
    promptTemplateDigest: admissionRequest.promptTemplateDigest,
    responseSchemaDigest: admissionRequest.responseSchemaDigest,
    routingDecision,
    routingRequest,
  };
  const identity = projectModelRuntimeExecutionIdentityV1(runtime);
  const state = {
    ...base.state,
    requestDigest: admissionRequest.requestDigest,
    idempotencyKeyDigest: admissionRequest.idempotencyKeyDigest,
    runtimePolicyDigest: policy.policyDigest,
    tenantScopeDigest: identity.tenantScopeDigest,
  };
  const selectors = parseModelCommercialReadSelectors({
    contractVersion: 1,
    pricingVersionId: pin.pricingVersion.pricingVersionId,
    pricingVersionDigest: digestStructuredValue(pin.pricingVersion),
    normalizationPolicyVersionId:
      pin.normalizationPolicy.normalizationPolicyVersionId,
    normalizationPolicyDigest: digestStructuredValue(pin.normalizationPolicy),
    runtimePolicyId: policy.policyId,
    runtimePolicyVersion: policy.policyVersion,
    runtimePolicyDigest: policy.policyDigest,
    routeId: routingDecision.routeId,
    routeDefinitionDigest: routingDecision.routeDefinitionDigest,
    modelConfigurationReference: routingDecision.modelConfigurationReference,
  });
  return { runtime, identity, state, selectors, base, pin, descriptor };
}

/** Test-only exact canonical row seeding, shared by existing reader and factory
 * component tests. Never production prices, policy issuance or provider calls. */
export async function seedModelCommercialReadPriceFixture(
  database: SqlDatabase,
  administration: TrustedCommercialAdministrationContext,
  price: ModelProviderPricingVersionV1,
  normalization: CreditNormalizationPolicyVersionV1,
): Promise<void> {
  const repository = new PostgresModelCommercialPersistenceRepository(database);
  await repository.createModelProviderPricingVersion(administration, {
    pricingVersionId: price.pricingVersionId,
    providerKey: price.providerKey,
    modelId: price.modelId,
    modelVersion: price.modelVersion,
    ...(price.inferenceProfileId === null
      ? {}
      : { inferenceProfileId: price.inferenceProfileId }),
    environment: price.environment,
    costCurrency: price.currencyCode,
    effectiveFrom: price.effectiveFrom,
    status: price.status,
    inputMicrosPerMillionUnits: String(price.inputMicrosPerMillionUnits),
    outputMicrosPerMillionUnits: String(price.outputMicrosPerMillionUnits),
    ...(price.cacheReadMicrosPerMillionUnits === null
      ? {}
      : {
          cacheReadMicrosPerMillionUnits: String(
            price.cacheReadMicrosPerMillionUnits,
          ),
        }),
    ...(price.cacheWriteMicrosPerMillionUnits === null
      ? {}
      : {
          cacheWriteMicrosPerMillionUnits: String(
            price.cacheWriteMicrosPerMillionUnits,
          ),
        }),
    providerSpecificUnitRates: price.providerSpecificUnitRates.map((rate) => ({
      unitName: rate.unitName,
      microsPerMillionUnits: String(rate.microsPerMillionUnits),
    })),
  });
  await repository.createCreditNormalizationPolicyVersion(administration, {
    normalizationPolicyVersionId: normalization.normalizationPolicyVersionId,
    costCurrency: normalization.currencyCode,
    creditUnitMicros: String(normalization.creditUnitMicros),
    operatingBufferBasisPoints: String(
      normalization.operatingBufferBasisPoints,
    ),
    effectiveFrom: normalization.effectiveFrom,
    status: normalization.status,
  });
}
