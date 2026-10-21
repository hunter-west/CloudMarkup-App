import {
  getModelHostSeedPatchResponseToolV2,
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  resolveReviewedHostPatchRepairPromptV3,
  digestStructuredValue as digest,
  sha256Text,
  type ModelProviderHostSeedInvocationV3,
} from "@cloudmarkup/model-gateway";
import { modelLiveSeedInvocationDescriptorV3Schema } from "@cloudmarkup/schemas";
import { projectModelLiveRoutingConfiguration } from "./model-live-routing-configuration.js";
import { prepareModelLiveSeedStageInputV3 } from "./model-live-runtime-host-evidence-codec.js";
import { requireSequenceAuthority as requireAuthority } from "./model-live-sequence-authority-codec.js";

type StageSource = Omit<
  Parameters<typeof prepareModelLiveSeedStageInputV3>[0],
  "invocation" | "scope"
>;
export interface SeedInvocationHostControls {
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly reservationId: string;
  readonly maximumOutputBytes: number;
  readonly maximumOutputTokens: number;
  readonly timeoutMilliseconds: number;
}

/** Pure configured identity, used by the closed host's canonical price read.
 * Parsing and configuration metadata grant no model or commercial authority. */
export function configuredSeedModel(
  source: Pick<
    StageSource,
    "configuration" | "observedAt" | "plan" | "selection" | "caseId"
  >,
) {
  const configured =
    source.configuration.contractVersion === 1
      ? createBedrockRoutingConfigurationV1({
          configuration: source.configuration,
          asOf: source.observedAt,
        })
      : prepareBedrockLiveEvaluationConfigurationV2({
          configuration: source.configuration,
          asOf: source.observedAt,
        });
  const binding = source.plan.definition.cases.find(
    (entry) => entry.caseId === source.caseId,
  );
  const stage = source.selection.stages.find(
    (entry) => entry.caseId === source.caseId && entry.stageKey === "repair-1",
  );
  requireAuthority(
    binding?.routeId === "internal-escalation" && stage !== undefined,
  );
  const tuple = binding.authorityBinding.authorityTuple;
  const capability = configured.capabilityRegistry.capabilities.find(
    (entry) =>
      entry.modelConfigurationReference === tuple.modelConfigurationReference,
  );
  const route = configured.routeRegistry.routes.find(
    (entry) => entry.routeId === binding.routeId,
  );
  requireAuthority(
    capability !== undefined &&
      route?.modelConfigurationReference ===
        capability.modelConfigurationReference,
  );
  return { configured, binding, stage, capability, route };
}

/** Construct from the host's actual reconstructed source and canonical
 * entitlement. Scope comes from its authenticated plan; IDs and output bounds
 * are host controls. The common issuer codec verifies every resulting binding. */
export function prepareSeedInvocation(
  source: StageSource,
  controls: SeedInvocationHostControls,
  entitlementSnapshotId: string,
) {
  const { configured, binding, stage, capability, route } =
    configuredSeedModel(source);
  const tuple = binding.authorityBinding.authorityTuple;
  const requirement = source.plan.definition.policy.evaluationRequirement;
  const scope = {
    organizationId: source.plan.definition.scope.organizationId,
    projectId: source.plan.definition.scope.projectId,
    userId: source.plan.definition.scope.userId,
    jobId: controls.jobId,
  };
  requireAuthority(
    controls.idempotencyKey.length > 0 && controls.idempotencyKey.length <= 256,
  );
  const request = source.preparedSeed.request;
  const prompt = resolveReviewedHostPatchRepairPromptV3({
    promptDigest: tuple.promptTemplateDigest,
    promptTemplateId: tuple.promptTemplateId,
    promptVersion: tuple.promptTemplateVersion,
  });
  requireAuthority(prompt !== null);
  const invocation: ModelProviderHostSeedInvocationV3 = {
    request,
    prompt,
    responseTool: getModelHostSeedPatchResponseToolV2(),
    maximumOutputBytes: controls.maximumOutputBytes,
    maximumOutputTokens: controls.maximumOutputTokens,
    timeoutMilliseconds: controls.timeoutMilliseconds,
    promptCachePolicy: {
      enabled: false,
      cacheKeyRequired: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
    descriptor: modelLiveSeedInvocationDescriptorV3Schema.parse({
      budgetDecisionId: controls.reservationId,
      entitlementDecisionId: entitlementSnapshotId,
      contractVersion: 3,
      recordKind: "model-live-seed-invocation-descriptor",
      complexity: "standard",
      evaluationPolicyId: requirement.evaluationPolicyId,
      evaluationPolicyVersion: requirement.evaluationPolicyVersion,
      feature: "candidate.repair",
      idempotencyKeyDigest: sha256Text(controls.idempotencyKey),
      inferenceProfileId: capability.inferenceProfileId,
      inputDigest: digest({ request, scope }),
      invocationId: stage.invocationId,
      modelId: capability.modelId,
      modelVersion: capability.modelVersion,
      promptDigest: prompt.digest,
      promptTemplateId: prompt.templateId,
      promptVersion: prompt.version,
      providerFamily: configured.profile.providerFamily,
      providerId: configured.profile.providerId,
      requestedMode: request.requestedMode,
      role: "repair-escalation",
      scope,
      toolAuthority: "none",
      routing: {
        capabilityRegistryDigest: tuple.capabilityRegistryDigest,
        capabilityRegistryId: configured.capabilityRegistry.registryId,
        capabilityRegistryVersion:
          configured.capabilityRegistry.registryVersion,
        capabilityVersion: capability.capabilityVersion,
        effort: "high",
        evaluationPolicyId: requirement.evaluationPolicyId,
        evaluationPolicyVersion: requirement.evaluationPolicyVersion,
        modelCapabilityDigest: digest(capability),
        modelConfigurationReference: capability.modelConfigurationReference,
        modelFamily: capability.modelFamily,
        pricingVersionReference: capability.pricingVersionReference,
        routeId: route.routeId,
        routeDefinitionDigest: tuple.routeDefinitionDigest,
        routeRegistryDigest: tuple.routeRegistryDigest,
        routeRegistryId: configured.routeRegistry.routeRegistryId,
        routeRegistryVersion: configured.routeRegistry.routeRegistryVersion,
        routingConfigurationDigest: digest(
          projectModelLiveRoutingConfiguration(configured),
        ),
      },
    }),
  };
  requireAuthority(
    invocation.maximumOutputTokens <=
      source.plan.definition.limits.maximumOutputTokens,
  );
  return prepareModelLiveSeedStageInputV3({ ...source, scope, invocation });
}
