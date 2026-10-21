import {
  digestStructuredValue,
  sha256Text,
  type ModelCommercialRouteV1,
  type ModelProviderInvocationV1,
} from "@cloudmarkup/model-gateway";
import { deterministicFakeResponseV1 } from "@cloudmarkup/model-gateway/testing";
import {
  modelInvocationDescriptorV1Schema,
  normalizedModelUsageV1Schema,
} from "@cloudmarkup/schemas";
import type { AiIntentPreviewBindingV1 } from "../../application/ai-intent-preview-journal.js";
import {
  commercialRequest,
  commercialScope,
} from "./model-commercial-workflow-test-helpers.js";
import { platformSpendInvocation } from "./model-platform-spend-test-helpers.js";
import {
  invocationFixture,
  syntheticScope,
} from "./model-runtime-invocation-test-helpers.js";
import { parseClaim } from "./model-runtime-invocation-codec.js";

/** Synthetic accounting/metadata fixture only. No evaluation recommendation,
 * runtime admission, production pricing, credentials or provider call exists. */
export function aiPreviewFixture(
  scope = syntheticScope,
  now = "2026-09-06T12:00:00.000Z",
) {
  const base = platformSpendInvocation(scope);
  if (
    base.request.operation !== "intent.extract" ||
    scope.projectId === undefined
  )
    throw new Error("Synthetic Intent fixture missing.");
  const modelRequest = {
    ...base.request,
    source: {
      ...base.request.source,
      digest: sha256Text(base.request.source.content),
    },
  };
  const invocation: ModelProviderInvocationV1 = {
    ...base,
    request: modelRequest,
    descriptor: modelInvocationDescriptorV1Schema.parse({
      ...base.descriptor,
      providerId: "cloudmarkup.amazon-bedrock",
      modelId: "anthropic.claude-sonnet-5",
      inferenceProfileId: "global.anthropic.claude-sonnet-5",
      inputDigest: digestStructuredValue({ request: modelRequest, scope }),
    }),
  };
  const descriptor = invocation.descriptor;
  const route: ModelCommercialRouteV1 = {
    explanation: "Synthetic Standard route, not deployment authority.",
    inferenceProfileId: descriptor.inferenceProfileId ?? null,
    label: "Standard Design",
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    providerKey: descriptor.providerId,
    route: "standard",
    routeId: "standard-design",
  };
  const tenant = commercialScope(
    scope.organizationId,
    scope.projectId,
    scope.userId,
  );
  const originalRequest = commercialRequest(tenant, now);
  const request = {
    ...originalRequest,
    feature: "intent.extract",
    jobId: scope.jobId ?? "missing-job",
    promptId: descriptor.promptTemplateId,
    promptVersion: descriptor.promptVersion,
    plannedCalls: originalRequest.plannedCalls.map((call) => ({
      ...call,
      routeId: route.routeId,
    })),
  };
  const usage = normalizedModelUsageV1Schema.parse({
    ...invocationFixture(scope).result.usage,
    feature: descriptor.feature,
    providerId: descriptor.providerId,
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    inferenceProfileId: descriptor.inferenceProfileId,
    inputDigest: descriptor.inputDigest,
    idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
    promptTemplateId: descriptor.promptTemplateId,
    promptVersion: descriptor.promptVersion,
    invocationId: descriptor.invocationId,
    routing: descriptor.routing,
    startedAt: now,
    completedAt: now,
    durationMilliseconds: 0,
    thinkingUnits: "0",
  });
  const result = {
    descriptor,
    response: deterministicFakeResponseV1(invocation),
    redaction: { categories: [], redactedValueCount: 0 },
    usage,
  };
  const claim = parseClaim({
    authorityDigest: digestStructuredValue(
      "synthetic-authority-not-an-admission",
    ),
    inputDigest: descriptor.inputDigest,
    invocationId: descriptor.invocationId,
    idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
  });
  const binding: AiIntentPreviewBindingV1 = {
    contractVersion: 1,
    scope,
    request,
    invocationId: descriptor.invocationId,
    idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
    inputDigest: descriptor.inputDigest,
    previewBindingDigest: digestStructuredValue(
      "synthetic-baseline-epoch-authority-only",
    ),
  };
  const outputInput = {
    invocation,
    result,
    catalogDigest: digestStructuredValue("synthetic catalog"),
    responseSchemaDigest: digestStructuredValue(
      invocation.responseTool.inputSchema,
    ),
    runtimePolicyDigest: digestStructuredValue(
      "synthetic policy, not activation",
    ),
  };
  return {
    binding,
    claim,
    invocation,
    modelRequest,
    request,
    result,
    route,
    scope,
    tenant,
    outputInput,
  };
}
