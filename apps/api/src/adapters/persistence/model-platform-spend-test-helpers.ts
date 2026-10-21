import {
  getModelHostSeedPatchResponseToolV2,
  reviewedHostSeedPatchRepairPromptV3,
  digestStructuredValue,
  sha256Text,
  reviewedHostSeedRepairPromptV2,
  type ModelProviderHostSeedInvocationV2,
  type ModelProviderHostSeedInvocationV3,
  getModelResponseToolV1,
  reviewedModelPromptRegistry,
  type ModelProviderInvocationV1,
} from "@cloudmarkup/model-gateway";
import { randomUUID } from "node:crypto";
import {
  modelGatewayRequestV1Schema,
  modelHostSeedRepairRequestV2Schema,
  modelInvocationDescriptorV1Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
} from "@cloudmarkup/schemas";
import {
  modelDispatchCostCeilingSchema,
  type ModelDispatchCostCeiling,
  type ModelPlatformReservationInput,
} from "../model-platform-spend.js";
import {
  invocationFixture,
  syntheticScope,
} from "./model-runtime-invocation-test-helpers.js";

/** Synthetic pricing evidence only. Never a production rate card. */
export function platformSpendInvocation(
  scope = syntheticScope,
): ModelProviderInvocationV1 {
  const request = modelGatewayRequestV1Schema.parse({
    contractVersion: 1,
    operation: "intent.extract",
    requestedMode: "guided",
    source: {
      content: "Synthetic spending-fence fixture.",
      digest: digestStructuredValue("Synthetic spending-fence fixture."),
      kind: "requirements-text",
      sourceId: "synthetic_requirements",
    },
  });
  const prompt = reviewedModelPromptRegistry.get(request.operation);
  if (prompt === null) throw new Error("Synthetic prompt unavailable.");
  return {
    descriptor: modelInvocationDescriptorV1Schema.parse({
      ...invocationFixture(scope).result.descriptor,
      feature: request.operation,
      inferenceProfileId: "synthetic.global-profile",
      inputDigest: digestStructuredValue(request),
      promptDigest: prompt.digest,
      promptTemplateId: prompt.templateId,
      promptVersion: prompt.version,
      providerFamily: "amazon-bedrock",
    }),
    maximumOutputBytes: 100_000,
    maximumOutputTokens: 1024,
    prompt,
    promptCachePolicy: {
      enabled: false,
      cacheKeyRequired: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
    request,
    responseTool: getModelResponseToolV1(request.operation),
    timeoutMilliseconds: 5_000,
  };
}

export function platformSpendCeiling(
  invocation: ModelProviderInvocationV1 | ModelProviderHostSeedInvocationV2,
  maximumCostMicroUsd = 1_000_000,
): ModelDispatchCostCeiling {
  return modelDispatchCostCeilingSchema.parse({
    contractVersion: 1,
    invocationDigest: digestStructuredValue(invocation),
    providerId: invocation.descriptor.providerId,
    modelId: invocation.descriptor.modelId,
    modelVersion: invocation.descriptor.modelVersion,
    inferenceProfileId: invocation.descriptor.inferenceProfileId,
    pricingVersionId: invocation.descriptor.routing?.pricingVersionReference,
    pricingVersionDigest: digestStructuredValue(
      "synthetic-pricing-not-a-production-rate",
    ),
    maximumCostMicroUsd,
    validFrom: "2020-01-01T00:00:00.000Z",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
}

export function platformSpendReservation(
  scope = syntheticScope,
  maximumCostMicroUsd = 1_000_000,
): ModelPlatformReservationInput {
  const invocation = platformSpendInvocation(scope);
  return {
    dispatchId: `dispatch_${randomUUID().replaceAll("-", "")}`,
    scope,
    invocationId: invocation.descriptor.invocationId,
    ceiling: platformSpendCeiling(invocation, maximumCostMicroUsd),
  };
}

/** Synthetic fixed-host source only; never a real issued seed or authority. */
export function platformSpendHostSeedInvocation(
  base: ModelProviderInvocationV1 = platformSpendInvocation(),
): ModelProviderHostSeedInvocationV2 {
  const content = "export const label: string = 1;\n";
  const reference = sha256Text("synthetic-host-receipt-reference-only");
  const files = [
    {
      candidateId: "synthetic_host_seed",
      kind: "file",
      path: "src/seed.ts",
      content,
      contentDigest: sha256Text(content),
      encoding: "utf-8",
      ownership: "user-owned",
      sourceAuthority: "fixed-host-synthetic",
    },
  ];
  const request = modelHostSeedRepairRequestV2Schema.parse({
    contractVersion: 2,
    operation: "candidate.repair",
    requestedMode: "guided",
    currentAttempt: 1,
    maximumRepairAttempts: 2,
    failedCandidates: files,
    failedCandidatesCanonicalization:
      "cloudmarkup.model-host-seed-files.canonical-json.v2",
    failedOutputDigest: digestStructuredValue(files),
    boundary: {
      boundaryId: "synthetic_host_seed_boundary",
      approvalPathIds: ["cloudmarkup.host-seed-repair"],
      ownedPaths: ["src/seed.ts"],
      writeAuthority: "candidate-artifacts-only",
    },
    diagnostics: [
      {
        candidateId: "synthetic_host_seed",
        diagnosticId: "synthetic_ts2322",
        path: "src/seed.ts",
        checkKind: "build",
        toolId: "compiler.typescript",
        toolVersion: "6.0.3",
        message: "Synthetic type mismatch",
        noSecretValues: true,
        redactionStatus: "not-required",
      },
    ],
    validationExpectations: [
      {
        checkId: "cloudmarkup.repair-seed.typecheck",
        kind: "build",
        required: true,
        successCondition: "must-pass",
        toolProfileId: "cloudmarkup.synthetic.host-seed",
      },
    ],
    hostSeed: {
      recipeId: "cloudmarkup.model-live.repair-seed.typescript-assignment",
      recipeVersion: "1.1.0",
      recipeDigest: reference,
      sourceTreeDigest: reference,
      solutionRevisionDigest: reference,
      ownershipDigest: reference,
      seedValidationReceiptDigest: reference,
    },
  });
  const prompt = reviewedHostSeedRepairPromptV2;
  return {
    ...base,
    request,
    prompt,
    responseTool: getModelResponseToolV1("candidate.repair"),
    descriptor: modelInvocationDescriptorV1Schema.parse({
      ...base.descriptor,
      feature: "candidate.repair",
      role: "repair-escalation",
      inputDigest: digestStructuredValue({
        request,
        scope: base.descriptor.scope,
      }),
      promptDigest: prompt.digest,
      promptTemplateId: prompt.templateId,
      promptVersion: prompt.version,
      routing: {
        ...base.descriptor.routing,
        routeId: "internal-escalation",
      },
    }),
  };
}

/** Synthetic static descriptor only; no issued input or final route authority. */
export function platformSpendHostSeedInvocationV3(
  base: ModelProviderInvocationV1 = platformSpendInvocation(),
): ModelProviderHostSeedInvocationV3 {
  const legacy = platformSpendHostSeedInvocation(base);
  const routing = legacy.descriptor.routing;
  if (!routing) throw Error("Missing synthetic route");
  const {
    routingDecisionDigest,
    acceptedMaximumCreditUnits,
    evaluationResultDigest,
    evaluationResultVersion,
    ...staticRouting
  } = routing;
  void routingDecisionDigest;
  void acceptedMaximumCreditUnits;
  void evaluationResultDigest;
  void evaluationResultVersion;
  const { promptCacheKey, ...payload } = legacy;
  void promptCacheKey;
  return {
    ...payload,
    prompt: reviewedHostSeedPatchRepairPromptV3,
    responseTool: getModelHostSeedPatchResponseToolV2(),
    descriptor: modelLiveSeedInvocationDescriptorV3Schema.parse({
      ...legacy.descriptor,
      promptDigest: reviewedHostSeedPatchRepairPromptV3.digest,
      promptTemplateId: reviewedHostSeedPatchRepairPromptV3.templateId,
      promptVersion: reviewedHostSeedPatchRepairPromptV3.version,
      contractVersion: 3,
      recordKind: "model-live-seed-invocation-descriptor",
      routing: { ...staticRouting, effort: "high" },
    }),
    promptCachePolicy: {
      enabled: false,
      cacheKeyRequired: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
  };
}
