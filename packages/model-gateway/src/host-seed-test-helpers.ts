import {
  getModelHostSeedPatchResponseToolV2,
  getModelResponseToolV1,
} from "./tools.js";
import { reviewedHostSeedPatchRepairPromptV3 } from "./prompts/host-seed-patch-repair.js";
import {
  modelHostSeedRepairRequestV2Schema,
  modelInvocationDescriptorV1Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  modelInvocationRoutingV1Schema,
  namespacedIdentifierSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import type {
  ModelProviderInvocationV1,
  ModelProviderHostSeedInvocationV2,
  ModelProviderHostSeedInvocationV3,
} from "./ports.js";
import { reviewedHostSeedRepairPromptV2 } from "./prompts/host-seed-repair.js";
import { digestStructuredValue } from "./security.js";
import { modelTestRequests } from "./test-helpers.js";
const digest = sha256DigestSchema.parse("sha256:" + "a".repeat(64));
/** Synthetic fixture only; grants no host, seed, dispatch or accounting authority. */
export function createHostSeedRepairTestInvocation(
  base: ModelProviderInvocationV1,
): ModelProviderHostSeedInvocationV2 {
  const request = createHostSeedRepairTestRequest();
  const prompt = reviewedHostSeedRepairPromptV2;
  const payload: ModelProviderHostSeedInvocationV2 = {
    ...base,
    request,
    prompt,
    responseTool: structuredClone(getModelResponseToolV1("candidate.repair")),
    descriptor: {
      ...base.descriptor,
      routing: modelInvocationRoutingV1Schema.parse({
        capabilityRegistryDigest: digest,
        capabilityRegistryId: "cloudmarkup.synthetic.host-seed-capabilities",
        capabilityRegistryVersion: "1.0.0",
        capabilityVersion: "1.0.0",
        evaluationResultDigest: digest,
        evaluationResultVersion: "1.0.0",
        modelCapabilityDigest: digest,
        modelFamily: "cloudmarkup.synthetic.host-seed-model",
        pricingVersionReference: "cloudmarkup.synthetic.host-seed-pricing",
        routeDefinitionDigest: digest,
        routeRegistryDigest: digest,
        routeRegistryId: "cloudmarkup.synthetic.host-seed-routes",
        routeRegistryVersion: "1.0.0",
        routingConfigurationDigest: digest,
        routingDecisionDigest: digest,
        ...base.descriptor.routing,
        routeId: "internal-escalation",
        evaluationPolicyId: base.descriptor.evaluationPolicyId,
        evaluationPolicyVersion: base.descriptor.evaluationPolicyVersion,
      }),
      feature: "candidate.repair",
      role: "repair-escalation",
      inputDigest: digestStructuredValue({
        request,
        scope: base.descriptor.scope,
      }),
      promptDigest: prompt.digest,
      promptTemplateId: namespacedIdentifierSchema.parse(prompt.templateId),
      promptVersion: prompt.version,
    },
  };
  modelInvocationDescriptorV1Schema.parse(payload.descriptor);
  return payload;
}

/** Shared synthetic fixed source only, not issued seed evidence. */
export function createHostSeedRepairTestRequest() {
  const repair = modelTestRequests().find(
    (value) => value.operation === "candidate.repair",
  );
  if (repair?.operation !== "candidate.repair")
    throw Error("Missing repair fixture");
  const source = repair.failedCandidates.find((value) => value.kind === "file");
  if (source?.kind !== "file") throw Error("Missing synthetic source file");
  const failedCandidates = [
    {
      candidateId: source.candidateId,
      content: source.content,
      contentDigest: source.contentDigest,
      encoding: source.encoding,
      kind: source.kind,
      ownership: "user-owned",
      sourceAuthority: "fixed-host-synthetic",
      path: source.path,
    },
  ];
  return modelHostSeedRepairRequestV2Schema.parse({
    ...repair,
    contractVersion: 2,
    failedCandidates,
    currentAttempt: 1,
    maximumRepairAttempts: 2,
    boundary: { ...repair.boundary, ownedPaths: [source.path] },
    failedOutputDigest: digestStructuredValue(failedCandidates),
    failedCandidatesCanonicalization:
      "cloudmarkup.model-host-seed-files.canonical-json.v2",
    hostSeed: {
      recipeId: "cloudmarkup.model-live.repair-seed.typescript-assignment",
      recipeVersion: "1.1.0",
      recipeDigest: digest,
      sourceTreeDigest: digest,
      solutionRevisionDigest: digest,
      ownershipDigest: digest,
      seedValidationReceiptDigest: digest,
    },
  });
}

/** Synthetic descriptor projection only; no issued input or final route exists. */
export function createHostSeedRepairTestInvocationV3(
  base: ModelProviderInvocationV1,
): ModelProviderHostSeedInvocationV3 {
  const legacy = createHostSeedRepairTestInvocation(base);
  const routing = legacy.descriptor.routing;
  if (!routing) throw Error("Missing synthetic routing");
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
  const scope = {
    ...legacy.descriptor.scope,
    jobId: "synthetic_host_seed_job",
  };
  return {
    ...payload,
    prompt: reviewedHostSeedPatchRepairPromptV3,
    responseTool: getModelHostSeedPatchResponseToolV2(),
    descriptor: modelLiveSeedInvocationDescriptorV3Schema.parse({
      ...legacy.descriptor,
      promptDigest: reviewedHostSeedPatchRepairPromptV3.digest,
      promptTemplateId: reviewedHostSeedPatchRepairPromptV3.templateId,
      promptVersion: reviewedHostSeedPatchRepairPromptV3.version,
      scope,
      contractVersion: 3,
      recordKind: "model-live-seed-invocation-descriptor",
      inputDigest: digestStructuredValue({ request: payload.request, scope }),
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
