import {
  digestStructuredValue,
  type ModelGatewayResultV1,
  type ModelInvocationClaimV1,
} from "@cloudmarkup/model-gateway";
import {
  modelGatewayResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  modelInvocationRoutingV1Schema,
  normalizedModelUsageV1Schema,
} from "@cloudmarkup/schemas";
import {
  parseClaim,
  parseScope,
  type ModelInvocationScope,
} from "./model-runtime-invocation-codec.js";

export const syntheticScope = parseScope({
  organizationId: "model-org",
  projectId: "model-project",
  userId: "model-user",
  jobId: "model-job",
});
export function invocationFixture(
  scope: ModelInvocationScope = syntheticScope,
  invocationId = "invocation-1",
): { claim: ModelInvocationClaimV1; result: ModelGatewayResultV1 } {
  const digest = digestStructuredValue("synthetic-model-evidence");
  const claim = parseClaim({
    invocationId,
    authorityDigest: digest,
    idempotencyKeyDigest: digestStructuredValue(invocationId),
    inputDigest: digest,
  });
  const routing = modelInvocationRoutingV1Schema.parse({
    acceptedMaximumCreditUnits: 10,
    capabilityRegistryDigest: digest,
    capabilityRegistryId: "test.capabilities",
    capabilityRegistryVersion: "1.0.0",
    capabilityVersion: "1.0.0",
    effort: "medium",
    evaluationPolicyId: "test.evaluation",
    evaluationPolicyVersion: "1.0.0",
    evaluationResultDigest: digest,
    evaluationResultVersion: "1.0.0",
    modelCapabilityDigest: digest,
    modelConfigurationReference: "test.model",
    modelFamily: "test.model",
    pricingVersionReference: "test.pricing",
    routeId: "standard-design",
    routeDefinitionDigest: digest,
    routeRegistryDigest: digest,
    routeRegistryId: "test.routes",
    routeRegistryVersion: "1.0.0",
    routingConfigurationDigest: digest,
    routingDecisionDigest: digest,
  });
  const descriptor = modelInvocationDescriptorV1Schema.parse({
    contractVersion: 1,
    budgetDecisionId: "budget-synthetic",
    complexity: "standard",
    entitlementDecisionId: "entitlement-synthetic",
    evaluationPolicyId: "test.evaluation",
    evaluationPolicyVersion: "1.0.0",
    feature: "requirements.blocking-questions",
    idempotencyKeyDigest: claim.idempotencyKeyDigest,
    inputDigest: digest,
    invocationId,
    modelId: "synthetic.model",
    modelVersion: "1.0.0",
    promptDigest: digest,
    promptTemplateId: "synthetic.prompt",
    promptVersion: "1.0.0",
    providerFamily: "deterministic-fake",
    providerId: "synthetic.provider",
    requestedMode: "guided",
    role: "low-cost-extraction-help",
    routing,
    scope,
    toolAuthority: "none",
  });
  const response = modelGatewayResponseV1Schema.parse({
    contractVersion: 1,
    operation: descriptor.feature,
    questions: [],
    proposalContext: {
      assumptions: [],
      unknowns: [],
      confidence: {
        basisPoints: 10000,
        evidenceReferences: [],
        rationale: "Synthetic schema-only fixture.",
      },
    },
    provenance: {
      contractVersion: 1,
      gatewayId: "cloudmarkup.model-gateway",
      inputDigest: digest,
      invocationId,
      modelId: descriptor.modelId,
      modelVersion: descriptor.modelVersion,
      ownership: "untrusted-proposal",
      promptDigest: digest,
      promptTemplateId: descriptor.promptTemplateId,
      promptVersion: descriptor.promptVersion,
      providerId: descriptor.providerId,
    },
  });
  const usage = normalizedModelUsageV1Schema.parse({
    attemptNumber: 1,
    cacheReadUnits: "0",
    cacheWriteUnits: "0",
    completedAt: "2026-09-05T12:00:01.000Z",
    contractVersion: 1,
    durationMilliseconds: 1000,
    feature: descriptor.feature,
    idempotencyKeyDigest: claim.idempotencyKeyDigest,
    inputDigest: digest,
    inputUnits: "10",
    invocationId,
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    outputUnits: "5",
    promptTemplateId: descriptor.promptTemplateId,
    promptVersion: descriptor.promptVersion,
    providerId: descriptor.providerId,
    result: "succeeded",
    routing,
    scope,
    startedAt: "2026-09-05T12:00:00.000Z",
    thinkingUnits: "0",
    usageRecordId: `usage-${invocationId}`,
  });
  return {
    claim,
    result: {
      descriptor,
      response,
      usage,
      redaction: { categories: [], redactedValueCount: 0 },
    },
  };
}
export function escalationFixture(
  original: ReturnType<typeof invocationFixture>,
  invocationId = "escalation-1",
): ModelInvocationClaimV1 {
  const { descriptor } = original.result;
  const lineage = {
    feature: descriptor.feature,
    inputDigest: descriptor.inputDigest,
    originalAcceptedEstimateMaximumCreditUnits: 10,
    originalCreditAuthorizationDecisionId: descriptor.budgetDecisionId,
    originalInvocationId: descriptor.invocationId,
    originalRoutingDecisionDigest: descriptor.routing?.routingDecisionDigest,
    scopeDigest: digestStructuredValue(descriptor.scope),
  };
  const { inputDigest, ...escalation } = lineage;
  return parseClaim({
    invocationId,
    inputDigest,
    authorityDigest: digestStructuredValue(invocationId),
    idempotencyKeyDigest: digestStructuredValue(`idempotency-${invocationId}`),
    escalation: {
      ...escalation,
      lineageDigest: digestStructuredValue(lineage),
    },
  });
}
