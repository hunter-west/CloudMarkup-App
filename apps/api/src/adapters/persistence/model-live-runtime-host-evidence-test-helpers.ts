import {
  bedrockModelCapabilityRegistryV1,
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  reviewedBedrockLiveEvaluationConfigurationV2Schema,
  digestStructuredValue,
  getModelResponseToolV1,
  reviewedBedrockConfigurationV1Schema,
  reviewedModelPromptRegistry,
  type ModelProviderInvocationV1,
} from "@cloudmarkup/model-gateway";
import {
  modelTestRequests,
  testSolutionRevision,
  syntheticLiveEvaluationFixtureV2,
} from "@cloudmarkup/model-gateway/testing";
import {
  modelInvocationDescriptorV1Schema,
  modelEvaluationAuthorityTupleV1Schema,
  modelLiveEvaluationPlanV2Schema,
  type ModelGatewayRequestV1,
  type ModelLiveRuntimeControlPolicyV2,
} from "@cloudmarkup/schemas";
import { parseScope } from "./model-runtime-invocation-codec.js";

/** Synthetic test data only. These rebased plan records have never been issued,
 * approved, invoked or validated by a live host. No model/SQL/network port. */
export function liveHostInputFixture(
  operation: ModelGatewayRequestV1["operation"] = "architecture.propose",
  original: Pick<
    ReturnType<typeof syntheticLiveEvaluationFixtureV2>,
    "now" | "plan" | "policy" | "request"
  > = syntheticLiveEvaluationFixtureV2(),
  jobId = "job_live_host_synthetic",
  activation: "normal" | "candidate" = "normal",
  routeMode?: "standard" | "deep",
  proposalSource?: {
    readonly request: ModelGatewayRequestV1;
    readonly caseId: string;
    readonly evaluationPolicy?: Pick<
      ModelLiveRuntimeControlPolicyV2["evaluationRequirement"],
      | "evaluationPolicyId"
      | "evaluationPolicyVersion"
      | "evaluationPolicyDigest"
    >;
  },
) {
  const selected = original.plan.definition.cases.find(
    (entry) =>
      entry.authorityBinding.authorityTuple.operation === operation &&
      (proposalSource === undefined ||
        entry.caseId === proposalSource.caseId) &&
      (routeMode !== "deep" ||
        entry.authorityBinding.authorityTuple.role ===
          "deep-architecture-custom-generation"),
  );
  const request =
    proposalSource?.request ??
    modelTestRequests().find((entry) => entry.operation === operation);
  if (selected === undefined || request === undefined)
    throw new Error("Missing synthetic source.");
  const requirement = {
    ...original.policy.evaluationRequirement,
    ...proposalSource?.evaluationPolicy,
  };
  // PostgreSQL callers rebase the synthetic plan to their current clock.
  // Keep this bounded test configuration on the same clock, without expiry drift.
  const fixtureTime = Date.parse(original.now);
  const configurationWindowMilliseconds = 24 * 60 * 60 * 1000;
  const rawConfiguration = {
    contractVersion: 1,
    capabilityRegistryVersion: "2.0.0",
    routeRegistryVersion: "2.0.0",
    routes: bedrockModelCapabilityRegistryV1.capabilities.map(
      (capability, index) => {
        const modelId =
          index === 0
            ? "anthropic.claude-sonnet-4-6"
            : "anthropic.claude-opus-4-6-v1";
        return {
          approvedModelClass: index === 0 ? "sonnet" : "opus",
          capability: {
            ...capability,
            modelId,
            modelVersion: "synthetic-4.6",
            pricingVersionReference:
              routeMode === "deep" && index === 1
                ? "pricing.synthetic.preview.deep"
                : "pricing.synthetic.preview",
            inferenceProfileId: "global." + modelId,
            nativeStructuredOutputSupported: false,
            maximumOutputTokens: 64000,
            enabledEnvironments: ["development"],
            lifecycleState: activation === "candidate" ? "candidate" : "active",
            killSwitch: { engaged: false },
            evaluation: {
              ...capability.evaluation,
              passed: activation === "normal",
              scoreBasisPoints: activation === "normal" ? 10000 : 0,
              evaluationPolicyId: requirement.evaluationPolicyId,
              evaluationPolicyVersion: requirement.evaluationPolicyVersion,
            },
          },
          effectiveFrom: new Date(
            fixtureTime - configurationWindowMilliseconds,
          ).toISOString(),
          effectiveUntil: new Date(
            fixtureTime + configurationWindowMilliseconds,
          ).toISOString(),
          retentionPolicy: "application-content-not-retained",
          route: index === 0 ? "standard" : "deep",
          selectedRegion: "us-east-1",
          supportedRegions: ["us-east-1"],
          transport: "converse",
        };
      },
    ),
  };
  const configuration =
    activation === "normal"
      ? reviewedBedrockConfigurationV1Schema.parse(rawConfiguration)
      : reviewedBedrockLiveEvaluationConfigurationV2Schema.parse({
          ...rawConfiguration,
          contractVersion: 2,
          executionClass: "live-evaluation",
          recordKind: "bedrock-live-evaluation-configuration",
        });
  const configured =
    configuration.contractVersion === 1
      ? createBedrockRoutingConfigurationV1({
          asOf: original.now,
          configuration,
        })
      : prepareBedrockLiveEvaluationConfigurationV2({
          asOf: original.now,
          configuration,
        });
  const role = selected.authorityBinding.authorityTuple.role;
  const capability = configured.capabilityRegistry.capabilities.find((entry) =>
    entry.roles.includes(role),
  );
  if (capability === undefined)
    throw new Error("Missing synthetic capability.");
  const route = configured.routeRegistry.routes.find((entry) =>
    entry.allowedRoles.includes(role),
  );
  const prompt = reviewedModelPromptRegistry.get(operation);
  if (route === undefined || prompt === null)
    throw new Error("Missing synthetic route.");
  const scope = parseScope({
    organizationId: original.request.organizationId,
    projectId: original.request.projectId,
    userId: original.request.userId,
    jobId,
    ...(request.operation === "application-source.generate" ||
    request.operation === "iac-extension.generate"
      ? { solutionRevisionId: request.solutionRevision.solutionRevisionId }
      : request.operation === "operations.propose"
        ? {
            solutionRevisionId: testSolutionRevision.solutionRevisionId,
            ...(request.planningContext?.approvedRepositoryEvidence ===
            undefined
              ? {}
              : {
                  repositorySnapshotId:
                    request.planningContext.approvedRepositoryEvidence
                      .repositorySnapshotId,
                }),
          }
        : request.operation === "repository.interpret"
          ? { repositorySnapshotId: request.repositorySnapshotId }
          : {}),
  });
  const responseTool = getModelResponseToolV1(operation);
  const tuple = modelEvaluationAuthorityTupleV1Schema.parse({
    ...selected.authorityBinding.authorityTuple,
    role,
    catalogDigest:
      request.operation === "architecture.propose"
        ? request.catalog.catalogDigest
        : "architecture" in request
          ? request.architecture.catalog.digest
          : selected.authorityBinding.authorityTuple.catalogDigest,
    capabilityRegistryDigest: digestStructuredValue(
      configured.capabilityRegistry,
    ),
    routeRegistryDigest: digestStructuredValue(configured.routeRegistry),
    routeDefinitionDigest: digestStructuredValue(route),
    modelConfigurationReference: capability.modelConfigurationReference,
    inferenceProfileId: capability.inferenceProfileId,
    promptTemplateDigest: prompt.digest,
    promptTemplateId: prompt.templateId,
    promptTemplateVersion: prompt.version,
    responseSchemaDigest: digestStructuredValue(responseTool.inputSchema),
  });
  const descriptor = modelInvocationDescriptorV1Schema.parse({
    budgetDecisionId: "budget_live_host_synthetic",
    entitlementDecisionId: "entitlement_live_host_synthetic",
    contractVersion: 1,
    complexity: "standard",
    evaluationPolicyId: requirement.evaluationPolicyId,
    evaluationPolicyVersion: requirement.evaluationPolicyVersion,
    feature: operation,
    idempotencyKeyDigest: digestStructuredValue(
      "synthetic live host idempotency",
    ),
    inferenceProfileId: capability.inferenceProfileId,
    inputDigest: digestStructuredValue({ request, scope }),
    invocationId: "invocation_live_host_synthetic",
    modelId: capability.modelId,
    modelVersion: capability.modelVersion,
    promptDigest: prompt.digest,
    promptTemplateId: prompt.templateId,
    promptVersion: prompt.version,
    providerFamily: "amazon-bedrock",
    providerId: "cloudmarkup.amazon-bedrock",
    requestedMode: request.requestedMode,
    role,
    scope,
    toolAuthority: "none",
    routing: {
      capabilityRegistryDigest: tuple.capabilityRegistryDigest,
      capabilityRegistryId: configured.capabilityRegistry.registryId,
      capabilityRegistryVersion: configured.capabilityRegistry.registryVersion,
      capabilityVersion: capability.capabilityVersion,
      effort: route.defaultEffort,
      evaluationPolicyId: requirement.evaluationPolicyId,
      evaluationPolicyVersion: requirement.evaluationPolicyVersion,
      evaluationResultDigest: digestStructuredValue(capability.evaluation),
      evaluationResultVersion: capability.evaluation.resultVersion,
      modelCapabilityDigest: digestStructuredValue(capability),
      modelConfigurationReference: capability.modelConfigurationReference,
      modelFamily: capability.modelFamily,
      pricingVersionReference: capability.pricingVersionReference,
      routeId: route.routeId,
      routeDefinitionDigest: tuple.routeDefinitionDigest,
      routeRegistryDigest: tuple.routeRegistryDigest,
      routeRegistryId: configured.routeRegistry.routeRegistryId,
      routeRegistryVersion: configured.routeRegistry.routeRegistryVersion,
      routingConfigurationDigest: digestStructuredValue(
        "synthetic bound configuration",
      ),
      routingDecisionDigest: digestStructuredValue("synthetic bound decision"),
    },
  });
  const invocation: ModelProviderInvocationV1 = {
    descriptor,
    request,
    prompt,
    responseTool,
    timeoutMilliseconds: 10000,
    maximumOutputBytes: 100000,
    maximumOutputTokens: 1000,
    promptCachePolicy: {
      enabled: false,
      cacheKeyRequired: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
  };
  const definition = structuredClone(original.plan.definition);
  definition.policy.evaluationRequirement = {
    ...definition.policy.evaluationRequirement,
    ...proposalSource?.evaluationPolicy,
  };
  definition.policy.allowlists.modelConfigurationReferences.push(
    capability.modelConfigurationReference,
  );
  if (!definition.policy.allowlists.routes.includes(route.routeId))
    definition.policy.allowlists.routes.push(route.routeId);
  if (!definition.policy.allowlists.roles.includes(role))
    definition.policy.allowlists.roles.push(role);
  const { policyDigest: oldPolicy, ...policyData } = definition.policy;
  void oldPolicy;
  definition.policy.policyDigest = digestStructuredValue(policyData);
  definition.cases = definition.cases.map((entry) =>
    entry.caseId === selected.caseId
      ? {
          ...entry,
          routeId: route.routeId,
          invocationInputDigest: descriptor.inputDigest,
          authorityBinding: {
            authorityTuple: tuple,
            authorityTupleDigest: digestStructuredValue(tuple),
          },
        }
      : entry,
  );
  const { definitionDigest: oldDefinition, ...definitionData } = definition;
  void oldDefinition;
  definition.definitionDigest = digestStructuredValue(definitionData);
  const approval = {
    ...original.plan.approval,
    definitionDigest: definition.definitionDigest,
  };
  const { approvalDigest: oldApproval, ...approvalData } = approval;
  void oldApproval;
  approval.approvalDigest = digestStructuredValue(approvalData);
  const { planDigest: oldPlan, ...priorPlanData } = original.plan;
  void oldPlan;
  const planData = { ...priorPlanData, definition, approval };
  const plan = modelLiveEvaluationPlanV2Schema.parse({
    ...planData,
    planDigest: digestStructuredValue(planData),
  });
  return {
    caseId: selected.caseId,
    configuration,
    invocation,
    observedAt: original.now,
    plan,
    scope,
  };
}
