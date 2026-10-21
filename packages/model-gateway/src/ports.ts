import type {
  ModelComplexityV1,
  ModelCacheKeyInputV1,
  ModelCapabilityRecordV1,
  ModelEffortV1,
  ModelGatewayOperationV1,
  ModelGatewayRequestV1,
  ModelHostSeedRepairRequestV2,
  ModelHostRepairSuccessorRequestV3,
  ModelLiveRepairSuccessorInvocationDescriptorV4,
  ModelGatewayResponseV1,
  ModelGatewayRoleV1,
  ModelInvocationDescriptorV1,
  ModelLiveSeedInvocationDescriptorV3,
  ModelLiveSeedRoutingDecisionV3,
  ModelRoutingDecisionV1,
  ModelRoutingRequestV1,
  ModelRequestedModeV1,
  NormalizedModelUsageV1,
  Sha256Digest,
} from "@cloudmarkup/schemas";

import type { ReviewedPromptTemplateV1 } from "./prompts/types.js";
import type {
  ModelProviderContentV1,
  StrictModelResponseToolV1,
} from "./tools.js";

export type ModelRequestFor<TOperation extends ModelGatewayOperationV1> =
  Extract<ModelGatewayRequestV1, { readonly operation: TOperation }>;
export type ModelResponseFor<TOperation extends ModelGatewayOperationV1> =
  Extract<ModelGatewayResponseV1, { readonly operation: TOperation }>;

export interface ModelCapabilityEvaluationV1 {
  readonly evaluationPolicyId: string;
  readonly evaluationPolicyVersion: string;
  readonly passed: boolean;
  /** Canonical digest of the exact evaluated result record. */
  readonly resultDigest: Sha256Digest;
  readonly resultVersion: string;
  readonly scoreBasisPoints: number;
}

export interface ModelCapabilityV1 {
  readonly acceptedEffortLevels: readonly ModelEffortV1[];
  /** Canonical digest of the exact provider capability record. */
  readonly capabilityDigest: Sha256Digest;
  readonly capabilityRegistryDigest: Sha256Digest;
  readonly capabilityRegistryId: string;
  readonly capabilityRegistryVersion: string;
  readonly capabilityVersion: string;
  readonly costTier: "low" | "standard" | "deep";
  readonly dataResidencyBoundary: string;
  readonly evaluation: ModelCapabilityEvaluationV1;
  readonly inferenceProfileId?: string;
  readonly maximumInputBytes: number;
  readonly maximumAttempts: number;
  readonly maximumOutputBytes: number;
  readonly maximumOutputTokens: number;
  readonly contextLimitTokens: number;
  readonly modelConfigurationReference: string;
  readonly modelFamily: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly operations: readonly ModelGatewayOperationV1[];
  readonly pricingVersionReference: string;
  readonly promptCache: {
    readonly maximumCheckpoints: number;
    readonly minimumCheckpointTokens: number;
    readonly supported: boolean;
  };
  readonly roles: readonly ModelGatewayRoleV1[];
  readonly streamingSupported: boolean;
  readonly structuredOutput: "native-json-schema" | "tool-schema";
  readonly supportedModes: readonly ModelRequestedModeV1[];
  readonly timeoutMilliseconds: number;
  readonly usageFieldsExpected: ModelCapabilityRecordV1["usageFieldsExpected"];
}

export interface ModelProviderCapabilityProfileV1 {
  readonly capabilities: readonly ModelCapabilityV1[];
  readonly enabled: boolean;
  readonly profileVersion: string;
  readonly providerFamily:
    "amazon-bedrock" | "future-provider" | "deterministic-fake";
  readonly providerId: string;
}

/**
 * First production-provider capability shape. It deliberately contains no AWS
 * SDK client, Region credential, invocation permission, or network method.
 */
export interface AmazonBedrockCapabilityProfileV1 extends ModelProviderCapabilityProfileV1 {
  readonly providerFamily: "amazon-bedrock";
}

export interface ModelProviderInvocationV1 {
  readonly descriptor: ModelInvocationDescriptorV1;
  readonly maximumOutputBytes: number;
  readonly maximumOutputTokens: number;
  /** Required whenever promptCachePolicy.enabled is true. */
  readonly promptCacheKey?: {
    readonly digest: Sha256Digest;
    readonly input: ModelCacheKeyInputV1;
  };
  readonly promptCachePolicy: ModelRoutingDecisionV1["promptCachePolicy"];
  readonly prompt: ReviewedPromptTemplateV1;
  readonly request: ModelGatewayRequestV1;
  /** One schema-only response channel. It grants no execution authority. */
  readonly responseTool: StrictModelResponseToolV1;
  readonly timeoutMilliseconds: number;
}

/** Explicit first-host-seed input; it preserves the V1 response and grants no
 * provider, sequence, runtime or financial authority. */
export interface ModelProviderHostSeedInvocationV2 extends Omit<
  ModelProviderInvocationV1,
  "request"
> {
  readonly request: ModelHostSeedRepairRequestV2;
}

/** One-way first-seed payload. Static model routing precedes issued input,
 * counted commercial metadata and its final V3 route; no model authority. */
export interface ModelProviderHostSeedInvocationV3 extends Omit<
  ModelProviderHostSeedInvocationV2,
  "descriptor" | "promptCachePolicy" | "promptCacheKey"
> {
  readonly descriptor: ModelLiveSeedInvocationDescriptorV3;
  readonly promptCachePolicy: ModelLiveSeedRoutingDecisionV3["promptCachePolicy"];
}

/** Explicit final repair payload; references are not dispatch authority. */
export interface ModelProviderHostRepairSuccessorInvocationV4 extends Omit<
  ModelProviderHostSeedInvocationV3,
  "descriptor" | "request"
> {
  readonly descriptor: ModelLiveRepairSuccessorInvocationDescriptorV4;
  readonly request: ModelHostRepairSuccessorRequestV3;
}

export interface ModelProviderUsageV1 {
  readonly cacheReadUnits: string;
  readonly cacheWriteUnits: string;
  readonly inputUnits: string;
  readonly outputUnits: string;
  readonly providerRequestId?: string;
  readonly thinkingUnits: string;
}

export interface ModelProviderResultV1 {
  readonly content: ModelProviderContentV1;
  readonly usage?: ModelProviderUsageV1;
}

export interface ModelProviderAdapter {
  readonly profile: ModelProviderCapabilityProfileV1;
  /**
   * The adapter owns timeout and abort settlement. It must not resolve or
   * reject until the provider request is confirmed stopped or a usage-bearing
   * final result/error is available; no provider promise may be abandoned.
   */
  invoke(
    invocation: ModelProviderInvocationV1,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1>;
}

const safeProviderFailureMessages = Object.freeze({
  "model-provider.iam-denied":
    "The model provider invocation is not permitted by its runtime role.",
  "model-provider.canceled": "The model provider invocation was canceled.",
  "model-provider.invalid-usage":
    "The model provider returned invalid technical usage evidence.",
  "model-provider.no-usage":
    "The model provider omitted required technical usage evidence.",
  "model-provider.permanent":
    "The model provider permanently rejected the invocation.",
  "model-provider.retryable":
    "The model provider returned a retryable failure.",
  "model-provider.temporary": "The model provider is temporarily unavailable.",
  "model-provider.throttled": "The model provider throttled the invocation.",
  "model-provider.timeout":
    "The model provider did not settle before its configured timeout.",
  "model-provider.unavailable": "The model provider is unavailable.",
});

function safeProviderFailure(input: {
  readonly classification: "permanent" | "transient";
  readonly requestedCode: string;
}): { readonly code: string; readonly message: string } {
  const fallback =
    input.classification === "transient"
      ? "model-provider.temporary"
      : "model-provider.permanent";
  const code = Object.hasOwn(safeProviderFailureMessages, input.requestedCode)
    ? (input.requestedCode as keyof typeof safeProviderFailureMessages)
    : fallback;
  return { code, message: safeProviderFailureMessages[code] };
}

export class ModelProviderInvocationError extends Error {
  public readonly classification: "permanent" | "transient";
  public readonly safeCode: string;
  /** Provider-reported technical usage for this failed, billable attempt. */
  public readonly usage: ModelProviderUsageV1 | undefined;

  public constructor(input: {
    readonly classification: "permanent" | "transient";
    readonly safeCode: string;
    readonly safeMessage: string;
    readonly usage?: ModelProviderUsageV1;
  }) {
    const safeFailure = safeProviderFailure({
      classification: input.classification,
      requestedCode: input.safeCode,
    });
    super(safeFailure.message);
    this.name = "ModelProviderInvocationError";
    this.classification = input.classification;
    this.safeCode = safeFailure.code;
    this.usage = input.usage === undefined ? undefined : { ...input.usage };
  }
}

/**
 * Trusted, pure routing policy seam. The gateway supplies the strict request
 * and the digest of its exact runtime routing configuration, then compares the
 * complete returned decision with the caller-supplied decision.
 */
export interface ModelRoutingDecisionEvaluatorV1 {
  evaluate(input: {
    readonly request: ModelRoutingRequestV1;
    readonly routingConfigurationDigest: Sha256Digest;
  }): {
    readonly capability: ModelCapabilityV1;
    readonly decision: ModelRoutingDecisionV1;
  };
}

export interface ModelInvocationEntitlementV1 {
  readonly allowed: boolean;
  readonly allowedRoles: readonly ModelGatewayRoleV1[];
  readonly decisionId: string;
  readonly planKey: ModelRoutingRequestV1["plan"]["key"];
  readonly planVersionId: ModelRoutingRequestV1["plan"]["versionId"];
}

export interface ModelInvocationBudgetV1 {
  readonly acceptedEstimateMaximumCreditUnits?: ModelRoutingRequestV1["creditAuthorization"]["acceptedEstimateMaximumCreditUnits"];
  readonly allowed: boolean;
  readonly availableCreditUnits: number;
  readonly decisionId: string;
  readonly estimateAccepted: boolean;
  readonly maximumCostTier: "low" | "standard" | "deep";
}

export interface ModelGatewayInvocationContextV1 {
  readonly budget: ModelInvocationBudgetV1;
  readonly complexity: ModelComplexityV1;
  readonly entitlement: ModelInvocationEntitlementV1;
  readonly evaluationPolicyId: string;
  readonly evaluationPolicyVersion: string;
  readonly idempotencyKeyDigest: Sha256Digest;
  readonly invocationId: string;
  readonly requestedMode: ModelRequestedModeV1;
  /** Required for non-fake providers and derived only from trusted policy input. */
  readonly routingDecision?: ModelRoutingDecisionV1;
  /** Exact trusted request used to produce routingDecision. */
  readonly routingRequest?: ModelRoutingRequestV1;
  readonly scope: ModelInvocationDescriptorV1["scope"];
  /** Exact trusted authorization required before a route may use xhigh effort. */
  readonly xhighEffortAuthorization?: ModelRoutingRequestV1["xhighEffortAuthorization"];
}

export interface ModelInvocationClaimV1 {
  /** Canonical digest of the full trusted authorization and runtime route state. */
  readonly authorityDigest: Sha256Digest;
  readonly idempotencyKeyDigest: Sha256Digest;
  readonly inputDigest: Sha256Digest;
  readonly invocationId: string;
  /**
   * Present only for the single terminal escalation of one exact completed
   * Standard invocation. Stores must atomically fence lineageDigest and verify
   * the original completed descriptor's routing-decision digest.
   */
  readonly escalation?: {
    readonly feature: ModelGatewayOperationV1;
    readonly lineageDigest: Sha256Digest;
    readonly originalAcceptedEstimateMaximumCreditUnits: number;
    readonly originalCreditAuthorizationDecisionId: string;
    readonly originalInvocationId: string;
    readonly originalRoutingDecisionDigest: Sha256Digest;
    readonly scopeDigest: Sha256Digest;
  };
}

export type ModelInvocationClaimResultV1 =
  | { readonly kind: "claimed" }
  | {
      readonly kind: "duplicate-complete";
      readonly result: ModelGatewayResultV1;
    }
  /** The exact invocation terminated, but its content was intentionally never
   * retained. This is terminal evidence, never permission to invoke again. */
  | { readonly kind: "duplicate-result-unavailable" }
  | { readonly kind: "duplicate-in-progress" }
  | { readonly kind: "conflict" };

export interface ModelInvocationStore {
  claim(claim: ModelInvocationClaimV1): Promise<ModelInvocationClaimResultV1>;
  complete(
    claim: ModelInvocationClaimV1,
    result: ModelGatewayResultV1,
  ): Promise<void>;
  fail(claim: ModelInvocationClaimV1, safeCode: string): Promise<void>;
}

export interface ModelUsageRecorder {
  /**
   * Records normalized provider usage only. Implementations at this seam have
   * no reservation, settlement, release, expiry, adjustment, or reconciliation
   * authority. Recording is idempotent by usageRecordId, which is unique for
   * the (invocationId, attemptNumber) tuple.
   */
  record(usage: NormalizedModelUsageV1): Promise<void>;
}

export interface SafeModelLogEventV1 {
  readonly attempt: number;
  readonly feature: ModelGatewayOperationV1;
  readonly inputDigest: Sha256Digest;
  readonly invocationId: string;
  readonly outputDigest?: Sha256Digest;
  readonly providerId?: string;
  readonly result:
    | "started"
    | "retrying"
    | "succeeded"
    | "rejected"
    | "canceled"
    | "provider-error"
    | "metering-failed";
  readonly safeCode?: string;
}

export interface SafeModelLogger {
  write(event: SafeModelLogEventV1): void;
}

export interface ModelInputRedactionSummaryV1 {
  readonly categories: readonly ("credential-candidate" | "secret-candidate")[];
  readonly redactedValueCount: number;
}

export interface ModelGatewayResultV1<
  TOperation extends ModelGatewayOperationV1 = ModelGatewayOperationV1,
> {
  readonly descriptor: ModelInvocationDescriptorV1;
  readonly redaction: ModelInputRedactionSummaryV1;
  readonly response: ModelResponseFor<TOperation>;
  readonly usage: NormalizedModelUsageV1;
}

export interface ModelGateway {
  invoke<TOperation extends ModelGatewayOperationV1>(
    request: ModelRequestFor<TOperation>,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<TOperation>>;
  extractIntent(
    request: ModelRequestFor<"intent.extract">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"intent.extract">>;
  generateBlockingQuestions(
    request: ModelRequestFor<"requirements.blocking-questions">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"requirements.blocking-questions">>;
  proposeArchitecture(
    request: ModelRequestFor<"architecture.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"architecture.propose">>;
  proposeWorkload(
    request: ModelRequestFor<"workload.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"workload.propose">>;
  proposeExternalResources(
    request: ModelRequestFor<"external-resource.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"external-resource.propose">>;
  proposeOperations(
    request: ModelRequestFor<"operations.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"operations.propose">>;
  interpretRepositoryEvidence(
    request: ModelRequestFor<"repository.interpret">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"repository.interpret">>;
  explainIssue(
    request: ModelRequestFor<"issue.explain">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"issue.explain">>;
  explainDeterministicFix(
    request: ModelRequestFor<"deterministic-fix.explain">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"deterministic-fix.explain">>;
  proposeFix(
    request: ModelRequestFor<"fix.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"fix.propose">>;
  generateApplicationSourceCandidate(
    request: ModelRequestFor<"application-source.generate">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"application-source.generate">>;
  generateIacExtensionCandidate(
    request: ModelRequestFor<"iac-extension.generate">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"iac-extension.generate">>;
  repairCandidate(
    request: ModelRequestFor<"candidate.repair">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"candidate.repair">>;
  summarizePlainLanguage(
    request: ModelRequestFor<"summary.plain-language">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"summary.plain-language">>;
  summarizeTechnical(
    request: ModelRequestFor<"summary.technical">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"summary.technical">>;
}
