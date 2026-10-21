import {
  getModelHostSeedPatchResponseToolV2,
  buildBedrockConverseRequestV1,
  buildBedrockHostSeedConverseRequestV3,
  resolveReviewedHostPatchRepairPromptV3,
  inspectModelLiveSequenceV3,
  getBedrockModelRegistrationV1,
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  reviewedBedrockConfigurationV1Schema,
  reviewedBedrockLiveEvaluationConfigurationV2Schema,
  digestStructuredValue,
  getModelResponseToolV1,
  measureModelRuntimeRequestV1,
  measureModelHostSeedRuntimeRequestV2,
  reviewedModelPromptRegistry,
  serializedByteLength,
  type BedrockRuntimeRouteV1,
  type ModelProviderInvocationV1,
  type ModelProviderHostSeedInvocationV3,
  type ModelProviderHostRepairSuccessorInvocationV4,
  type ReviewedBedrockConfigurationV1,
  type ReviewedBedrockLiveEvaluationConfigurationV2,
} from "@cloudmarkup/model-gateway";
import { projectModelLiveRoutingConfiguration } from "./model-live-routing-configuration.js";
import {
  modelLiveSeedValidationReceiptV1Schema,
  type ModelLiveSeedValidationReceiptV1,
} from "./model-live-seed-validation-codec.js";
import {
  modelGatewayRequestV1Schema,
  modelHostSeedRepairRequestV2Schema,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  sha256DigestSchema,
  type ModelLiveSequenceSelectionV3,
  modelInvocationDescriptorV1Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveEvaluationPlanV2Schema,
  modelRuntimeInputEvidenceV1Schema,
  modelRuntimeRequestedResourcesV1Schema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type ModelGatewayRequestV1,
  type ModelLiveEvaluationPlanV2,
  type ModelLiveSequencePlanV3,
  type ModelRuntimeInputEvidenceV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import {
  bytesOf,
  parseScope,
  same,
  type ModelInvocationScope,
} from "./model-runtime-invocation-codec.js";

export type ModelLiveBedrockHostConfigurationV2 =
  ReviewedBedrockConfigurationV1 | ReviewedBedrockLiveEvaluationConfigurationV2;
export const modelLiveBedrockHostConfigurationV2Schema = z.union([
  reviewedBedrockConfigurationV1Schema,
  reviewedBedrockLiveEvaluationConfigurationV2Schema,
]);

export const MODEL_LIVE_HOST_EVIDENCE_VERIFIER =
  "cloudmarkup.live-host-evidence.v2";
export const MODEL_LIVE_HOST_EVIDENCE_VERSION = "2.0.0";
export const MODEL_LIVE_HOST_EVIDENCE_MAXIMUM_BYTES = 16384;

export class ModelLiveRuntimeHostEvidenceError extends Error {
  readonly code = "model-runtime.live-host-evidence-unavailable";
  constructor() {
    super("Exact live model host verification evidence is unavailable.");
    this.name = "ModelLiveRuntimeHostEvidenceError";
  }
}
export function requireLiveHostEvidence(condition: boolean): asserts condition {
  if (!condition) throw new ModelLiveRuntimeHostEvidenceError();
}

function embeddedCatalogDigests(
  request: ModelGatewayRequestV1,
): readonly Sha256Digest[] {
  switch (request.operation) {
    case "architecture.propose":
      return [
        request.catalog.catalogDigest,
        ...(request.currentArchitecture === undefined
          ? []
          : [request.currentArchitecture.catalog.digest]),
      ];
    case "workload.propose":
    case "external-resource.propose":
    case "operations.propose":
    case "application-source.generate":
    case "iac-extension.generate":
      return [request.architecture.catalog.digest];
    case "candidate.repair":
      return request.generationContext === undefined
        ? []
        : [request.generationContext.catalogSlice.catalog.digest];
    default:
      return [];
  }
}

// Keep emitted declarations bounded without changing the reviewed parser.
export const invocationSchema: z.ZodObject<
  {
    descriptor: z.ZodType<ModelProviderInvocationV1["descriptor"]>;
    maximumOutputBytes: z.ZodNumber;
    maximumOutputTokens: z.ZodNumber;
    prompt: z.ZodUnknown;
    promptCachePolicy: z.ZodType<{
      cacheKeyRequired: false;
      enabled: false;
      maximumCheckpoints: 0;
      minimumCheckpointTokens: 0;
    }>;
    request: z.ZodType<ModelGatewayRequestV1>;
    responseTool: z.ZodUnknown;
    timeoutMilliseconds: z.ZodNumber;
  },
  z.core.$strict
> = z
  .object({
    descriptor: modelInvocationDescriptorV1Schema,
    maximumOutputBytes: z
      .number()
      .int()
      .positive()
      .max(16 * 1024 * 1024),
    maximumOutputTokens: z.number().int().positive(),
    prompt: z.unknown(),
    promptCachePolicy: z
      .object({
        cacheKeyRequired: z.literal(false),
        enabled: z.literal(false),
        maximumCheckpoints: z.literal(0),
        minimumCheckpointTokens: z.literal(0),
      })
      .strict(),
    request: modelGatewayRequestV1Schema,
    responseTool: z.unknown(),
    timeoutMilliseconds: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1000),
  })
  .strict();

export interface PreparedModelLiveRuntimeInputV2 {
  readonly caseId: string;
  readonly inputEvidence: ModelRuntimeInputEvidenceV1;
  readonly invocation: ModelProviderInvocationV1;
  readonly invocationDigest: Sha256Digest;
  readonly observedAt: string;
  readonly plan: ModelLiveEvaluationPlanV2;
  readonly route: BedrockRuntimeRouteV1;
  readonly routeDigest: Sha256Digest;
  readonly scope: ModelInvocationScope;
}

/** Pure host preparation, not an issuer or approval check. The caller must use
 * actual authenticated scope, configured routes, trusted time and the issued
 * plan, then persist the metadata in a current-plan transaction. The exact
 * prepared invocation and returned route must also reach final HTTP dispatch.
 * This initial live host accepts disabled caching and primary Standard/Deep
 * routes only. Internal escalation still requires its real prior-call lineage;
 * the current V2 journal cannot accept it. No cache key or lineage is ignored.
 * No request or prompt body is returned as persistence metadata. */
export function prepareModelLiveRuntimeInputV2(input: {
  readonly caseId: string;
  readonly configuration: ModelLiveBedrockHostConfigurationV2;
  readonly invocation: ModelProviderInvocationV1;
  readonly observedAt: string;
  readonly plan: ModelLiveEvaluationPlanV2;
  readonly scope: ModelInvocationScope;
}): PreparedModelLiveRuntimeInputV2 {
  try {
    const plan = modelLiveEvaluationPlanV2Schema.parse(input.plan);
    const scope = parseScope(input.scope);
    const caseId = solutionStableIdSchema.parse(input.caseId);
    const observedAt = utcTimestampSchema.parse(input.observedAt);
    const configuration = modelLiveBedrockHostConfigurationV2Schema.parse(
      input.configuration,
    );
    const configured =
      configuration.contractVersion === 1
        ? createBedrockRoutingConfigurationV1({
            asOf: observedAt,
            configuration,
          })
        : prepareBedrockLiveEvaluationConfigurationV2({
            asOf: observedAt,
            configuration,
          });
    const parsed = invocationSchema.parse(input.invocation);
    const { descriptor, request } = parsed;
    const binding = plan.definition.cases.find(
      (entry) => entry.caseId === caseId,
    );
    const routing = descriptor.routing;
    const prompt = reviewedModelPromptRegistry.get(request.operation);
    const responseTool = getModelResponseToolV1(request.operation);
    requireLiveHostEvidence(
      binding !== undefined &&
        binding.routeId !== "internal-escalation" &&
        Date.parse(observedAt) >= Date.parse(plan.issuedAt) &&
        Date.parse(observedAt) < Date.parse(plan.expiresAt) &&
        routing !== undefined &&
        prompt !== null &&
        scope.projectId !== undefined &&
        scope.jobId !== undefined &&
        same(descriptor.scope, scope) &&
        scope.organizationId === plan.definition.scope.organizationId &&
        scope.projectId === plan.definition.scope.projectId &&
        scope.userId === plan.definition.scope.userId &&
        descriptor.inputDigest === digestStructuredValue({ request, scope }) &&
        descriptor.inputDigest === binding.invocationInputDigest &&
        descriptor.feature === request.operation &&
        descriptor.requestedMode === request.requestedMode &&
        descriptor.providerFamily === configured.profile.providerFamily &&
        descriptor.providerId === configured.profile.providerId &&
        same(parsed.prompt, prompt) &&
        same(parsed.responseTool, responseTool) &&
        descriptor.promptDigest === prompt.digest &&
        descriptor.promptTemplateId === prompt.templateId &&
        descriptor.promptVersion === prompt.version,
    );
    const invocation: ModelProviderInvocationV1 = {
      ...parsed,
      prompt,
      responseTool,
    };
    const { route, capability } = requireConfiguredLiveInvocation({
      configured,
      plan,
      binding,
      invocation,
      catalogDigests: embeddedCatalogDigests(request),
    });
    const measurements = measureModelRuntimeRequestV1(request);
    const promptBytes = serializedByteLength(
      buildBedrockConverseRequestV1(invocation, route),
    );
    requireLiveHostEvidence(
      promptBytes > 0 && promptBytes <= capability.maximumInputBytes,
    );
    const invocationDigest = digestStructuredValue(invocation);
    const routeDigest = digestStructuredValue(route);
    const record = {
      authority: {
        credential: false,
        deployment: false,
        shell: false,
        tool: false,
        url: false,
      },
      contractVersion: 1,
      inputDigest: descriptor.inputDigest,
      inputSanitized: true,
      noRawSensitiveContent: true,
      operation: request.operation,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      recordKind: "model-runtime-input-evidence",
      requested: {
        ...measurements.requested,
        outputBytes: invocation.maximumOutputBytes,
        outputTokens: invocation.maximumOutputTokens,
        promptBytes,
      },
      secretRedactionApplied: true,
      sourceOwnership: {
        evidenceDigests: measurements.sourceOwnershipBindingDigests,
        status:
          measurements.sourceOwnershipBindingDigests.length === 0
            ? "not-applicable"
            : "verified",
      },
      userId: scope.userId,
      verifierId: MODEL_LIVE_HOST_EVIDENCE_VERIFIER,
      verifierVersion: MODEL_LIVE_HOST_EVIDENCE_VERSION,
    };
    const identified = {
      ...record,
      evidenceId:
        "evidence_" +
        digestStructuredValue({
          record,
          caseId,
          planDigest: plan.planDigest,
          invocationDigest,
          routeDigest,
        }).slice(7),
    };
    const inputEvidence = modelRuntimeInputEvidenceV1Schema.parse({
      ...identified,
      evidenceDigest: digestStructuredValue(identified),
    });
    requireLiveHostEvidence(
      bytesOf(inputEvidence).byteLength <=
        MODEL_LIVE_HOST_EVIDENCE_MAXIMUM_BYTES,
    );
    return {
      caseId,
      inputEvidence,
      invocation,
      invocationDigest,
      observedAt,
      plan,
      route,
      routeDigest,
      scope,
    };
  } catch {
    throw new ModelLiveRuntimeHostEvidenceError();
  }
}

/** Shared exact configured model/route checks; version-specific callers still
 * validate their own source, plan, selection and request contracts. */
export function requireConfiguredLiveInvocation(input: {
  readonly configured:
    | ReturnType<typeof createBedrockRoutingConfigurationV1>
    | ReturnType<typeof prepareBedrockLiveEvaluationConfigurationV2>;
  readonly plan: ModelLiveEvaluationPlanV2 | ModelLiveSequencePlanV3;
  readonly binding:
    | ModelLiveEvaluationPlanV2["definition"]["cases"][number]
    | ModelLiveSequencePlanV3["definition"]["cases"][number];
  readonly invocation:
    | ModelProviderInvocationV1
    | ModelProviderHostSeedInvocationV3
    | ModelProviderHostRepairSuccessorInvocationV4;
  readonly catalogDigests: readonly Sha256Digest[];
}) {
  const {
    configured,
    plan,
    binding,
    invocation: parsed,
    catalogDigests,
  } = input;
  const { descriptor, request, prompt, responseTool } = parsed;
  const routing = descriptor.routing;
  requireLiveHostEvidence(routing !== undefined);
  const tuple = binding.authorityBinding.authorityTuple;
  const capability = configured.capabilityRegistry.capabilities.find(
    (entry) =>
      entry.modelConfigurationReference === tuple.modelConfigurationReference,
  );
  const registryRoute = configured.routeRegistry.routes.find(
    (entry) => entry.routeId === binding.routeId,
  );
  const route = configured.runtimeRoutes.find(
    (entry) =>
      entry.modelConfigurationReference === tuple.modelConfigurationReference,
  );
  const requirement = plan.definition.policy.evaluationRequirement;
  requireLiveHostEvidence(
    capability !== undefined &&
      registryRoute !== undefined &&
      route !== undefined &&
      capability.evaluation.evaluationPolicyId ===
        requirement.evaluationPolicyId &&
      capability.evaluation.evaluationPolicyVersion ===
        requirement.evaluationPolicyVersion &&
      capability.modelId === descriptor.modelId &&
      capability.modelVersion === descriptor.modelVersion &&
      capability.inferenceProfileId === descriptor.inferenceProfileId &&
      capability.enabledFeatureClasses.includes(request.operation) &&
      capability.roles.includes(descriptor.role) &&
      capability.supportedModes.includes(request.requestedMode) &&
      capability.enabledEnvironments.includes(
        plan.definition.scope.environment,
      ) &&
      parsed.maximumOutputBytes <= capability.maximumOutputBytes &&
      parsed.maximumOutputTokens <= capability.maximumOutputTokens &&
      parsed.timeoutMilliseconds <= capability.timeoutMilliseconds &&
      catalogDigests.every((digest) => digest === tuple.catalogDigest) &&
      tuple.operation === request.operation &&
      tuple.role === descriptor.role &&
      tuple.promptTemplateDigest === prompt.digest &&
      tuple.promptTemplateId === prompt.templateId &&
      tuple.promptTemplateVersion === prompt.version &&
      tuple.responseSchemaDigest ===
        digestStructuredValue(responseTool.inputSchema) &&
      tuple.inferenceProfileId === descriptor.inferenceProfileId &&
      tuple.capabilityRegistryDigest ===
        digestStructuredValue(configured.capabilityRegistry) &&
      tuple.routeRegistryDigest ===
        digestStructuredValue(configured.routeRegistry) &&
      tuple.routeDefinitionDigest === digestStructuredValue(registryRoute) &&
      registryRoute.modelConfigurationReference ===
        tuple.modelConfigurationReference &&
      registryRoute.allowedRoles.includes(descriptor.role) &&
      registryRoute.allowedEffortLevels.includes(routing.effort) &&
      descriptor.evaluationPolicyId === requirement.evaluationPolicyId &&
      descriptor.evaluationPolicyVersion ===
        requirement.evaluationPolicyVersion &&
      routing.routeId === binding.routeId &&
      routing.modelConfigurationReference ===
        tuple.modelConfigurationReference &&
      routing.modelFamily === capability.modelFamily &&
      routing.pricingVersionReference === capability.pricingVersionReference &&
      routing.modelCapabilityDigest === digestStructuredValue(capability) &&
      routing.capabilityVersion === capability.capabilityVersion &&
      routing.capabilityRegistryDigest === tuple.capabilityRegistryDigest &&
      routing.capabilityRegistryId ===
        configured.capabilityRegistry.registryId &&
      routing.capabilityRegistryVersion ===
        configured.capabilityRegistry.registryVersion &&
      routing.routeRegistryDigest === tuple.routeRegistryDigest &&
      routing.routeRegistryId === configured.routeRegistry.routeRegistryId &&
      routing.routeRegistryVersion ===
        configured.routeRegistry.routeRegistryVersion &&
      routing.routeDefinitionDigest === tuple.routeDefinitionDigest,
  );

  if (descriptor.contractVersion === 1) {
    requireLiveHostEvidence(
      descriptor.routing?.evaluationResultDigest ===
        digestStructuredValue(capability.evaluation) &&
        descriptor.routing.evaluationResultVersion ===
          capability.evaluation.resultVersion,
    );
  } else {
    requireLiveHostEvidence(
      routing.routingConfigurationDigest ===
        digestStructuredValue(projectModelLiveRoutingConfiguration(configured)),
    );
  }
  return { route, capability };
}

const preparedSeedInputSchema = z
  .object({
    authority: z.literal("unissued-repair-input"),
    configurationDigest: sha256DigestSchema,
    receiptDigest: sha256DigestSchema,
    inputDigest: sha256DigestSchema,
    request: modelHostSeedRepairRequestV2Schema,
  })
  .strict();
const seedInvocationSchema = invocationSchema.extend({
  descriptor: modelLiveSeedInvocationDescriptorV3Schema,
  request: modelHostSeedRepairRequestV2Schema,
});

/** Pure first-stage preparation only. The authenticated issuer must itself
 * reconstruct preparedSeed from its actual current issued seed outside SQL.
 * Supplied records, this return value and valid digests grant no authority. */
export function prepareModelLiveSeedStageInputV3(input: {
  readonly caseId: string;
  readonly configuration: ModelLiveBedrockHostConfigurationV2;
  readonly invocation: ModelProviderHostSeedInvocationV3;
  readonly observedAt: string;
  readonly plan: ModelLiveSequencePlanV3;
  readonly selection: ModelLiveSequenceSelectionV3;
  readonly scope: ModelInvocationScope;
  readonly preparedSeed: z.output<typeof preparedSeedInputSchema>;
  readonly seedReceipt: ModelLiveSeedValidationReceiptV1;
}) {
  try {
    const plan = modelLiveSequencePlanV3Schema.parse(input.plan);
    const selection = modelLiveSequenceSelectionV3Schema.parse(input.selection);
    const caseId = solutionStableIdSchema.parse(input.caseId);
    const observedAt = utcTimestampSchema.parse(input.observedAt);
    const scope = parseScope(input.scope);
    const seed = preparedSeedInputSchema.parse(input.preparedSeed);
    const receipt = modelLiveSeedValidationReceiptV1Schema.parse(
      input.seedReceipt,
    );
    const parsed = seedInvocationSchema.parse(input.invocation);
    const configuration = modelLiveBedrockHostConfigurationV2Schema.parse(
      input.configuration,
    );
    const configured =
      configuration.contractVersion === 1
        ? createBedrockRoutingConfigurationV1({
            configuration,
            asOf: observedAt,
          })
        : prepareBedrockLiveEvaluationConfigurationV2({
            configuration,
            asOf: observedAt,
          });
    inspectModelLiveSequenceV3({
      plan,
      selection,
      observedAt,
      inputs: [],
      dispatches: [],
      outcomes: [],
    });
    const binding = plan.definition.cases.find(
      (entry) => entry.caseId === caseId,
    );
    const stage = selection.stages.find(
      (entry) => entry.caseId === caseId && entry.stageKey === "repair-1",
    );
    const { descriptor, request } = parsed;
    const prompt = resolveReviewedHostPatchRepairPromptV3(descriptor);
    requireLiveHostEvidence(prompt !== null);
    const responseTool = getModelHostSeedPatchResponseToolV2();
    requireLiveHostEvidence(
      binding !== undefined &&
        stage !== undefined &&
        binding.routeId === "internal-escalation" &&
        Date.parse(observedAt) >= Date.parse(selection.issuedAt) &&
        Date.parse(observedAt) < Date.parse(plan.expiresAt) &&
        scope.projectId !== undefined &&
        scope.jobId !== undefined &&
        scope.repositorySnapshotId === undefined &&
        scope.solutionRevisionId === undefined &&
        same(descriptor.scope, scope) &&
        scope.organizationId === plan.definition.scope.organizationId &&
        scope.projectId === plan.definition.scope.projectId &&
        scope.userId === plan.definition.scope.userId &&
        same(receipt.scope, plan.definition.scope) &&
        receipt.caseId === caseId &&
        receipt.caseDigest === binding.caseDigest &&
        receipt.frozenInputDigest === binding.sourceInputDigest &&
        receipt.datasetDigest ===
          plan.definition.policy.evaluationRequirement.datasetDigest &&
        Date.parse(receipt.issuedAt) <= Date.parse(plan.issuedAt) &&
        same(binding.seed, {
          sourceDigest: receipt.bindings.baselineSourceDigest,
          revisionDigest: receipt.bindings.solutionRevisionDigest,
          candidateDigest: receipt.bindings.sourceTreeDigest,
          ownershipDigest: receipt.ownershipDigest,
          validationReceiptDigest: receipt.receiptDigest,
          validatorPolicyDigest: receipt.bindings.policyDigest,
        }) &&
        seed.configurationDigest === receipt.configurationDigest &&
        seed.receiptDigest === receipt.receiptDigest &&
        seed.inputDigest === digestStructuredValue(seed.request) &&
        same(seed.request, request) &&
        same(
          {
            recipeId: request.hostSeed.recipeId,
            recipeVersion: request.hostSeed.recipeVersion,
          },
          { recipeId: receipt.recipeId, recipeVersion: receipt.recipeVersion },
        ) &&
        request.hostSeed.recipeDigest === receipt.bindings.recipeDigest &&
        request.hostSeed.sourceTreeDigest ===
          receipt.bindings.sourceTreeDigest &&
        request.hostSeed.solutionRevisionDigest ===
          receipt.bindings.solutionRevisionDigest &&
        request.hostSeed.ownershipDigest === receipt.ownershipDigest &&
        request.hostSeed.seedValidationReceiptDigest ===
          receipt.receiptDigest &&
        descriptor.inputDigest === digestStructuredValue({ request, scope }) &&
        descriptor.invocationId === stage.invocationId &&
        descriptor.requestedMode === request.requestedMode &&
        descriptor.providerFamily === configured.profile.providerFamily &&
        descriptor.providerId === configured.profile.providerId &&
        same(parsed.prompt, prompt) &&
        same(parsed.responseTool, responseTool) &&
        descriptor.promptDigest === prompt.digest &&
        descriptor.promptTemplateId === prompt.templateId &&
        descriptor.promptVersion === prompt.version &&
        getBedrockModelRegistrationV1(descriptor.modelId)
          ?.tokenCountingStrategy === "full-converse-count-tokens-v1",
    );
    const invocation: ModelProviderHostSeedInvocationV3 = {
      ...parsed,
      prompt,
      responseTool,
    };
    const { route, capability } = requireConfiguredLiveInvocation({
      configured,
      plan,
      binding,
      invocation,
      catalogDigests: [],
    });
    const promptBytes = serializedByteLength(
      buildBedrockHostSeedConverseRequestV3(invocation, route),
    );
    requireLiveHostEvidence(
      promptBytes > 0 && promptBytes <= capability.maximumInputBytes,
    );
    const invocationDigest = digestStructuredValue(invocation);
    return {
      authority: "unissued-stage-input" as const,
      routingConfigurationDigest: digestStructuredValue(
        projectModelLiveRoutingConfiguration(configured),
      ),
      requested: modelRuntimeRequestedResourcesV1Schema.parse({
        ...measureModelHostSeedRuntimeRequestV2(request).requested,
        promptBytes,
        outputBytes: invocation.maximumOutputBytes,
        outputTokens: invocation.maximumOutputTokens,
      }),
      plan,
      selection,
      stage,
      scope,
      invocation,
      route,
      invocationDigest,
      routeDigest: digestStructuredValue(route),
      configurationDigest: digestStructuredValue(configuration),
      seedConfigurationDigest: seed.configurationDigest,
      fields: {
        contractVersion: 3 as const,
        recordKind: "model-live-sequence-input" as const,
        selectionId: selection.selectionId,
        selectionDigest: selection.selectionDigest,
        planDigest: plan.planDigest,
        ...stage,
        recipeDigest: binding.recipeDigest,
        authorityTupleDigest: binding.authorityBinding.authorityTupleDigest,
        operationInputDigest: descriptor.inputDigest,
        preparedPayloadDigest: invocationDigest,
        diagnosticsDigest: digestStructuredValue(request.diagnostics),
        revisionDigest: receipt.bindings.solutionRevisionDigest,
        ownershipDigest: receipt.ownershipDigest,
        predecessor: {
          kind: "seed" as const,
          candidateDigest: receipt.bindings.sourceTreeDigest,
          validationReceiptDigest: receipt.receiptDigest,
        },
      },
    };
  } catch {
    throw new ModelLiveRuntimeHostEvidenceError();
  }
}
