import { z } from "zod";
import {
  modelCacheKeyInputV1Schema,
  modelGatewayRequestV1Schema,
  modelGatewayResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  type ModelLiveRepairSuccessorInvocationDescriptorV4,
  type ModelLiveSeedInvocationDescriptorV3,
  modelRouteRegistryV1Schema,
  modelRoutingDecisionV1Schema,
  modelRoutingRequestV1Schema,
  normalizedModelUsageV1Schema,
  serializeCanonicalJson,
  type ModelGatewayOperationV1,
  type ModelGatewayRequestV1,
  type Sha256Digest,
  type ModelGatewayResponseV1,
  type ModelRouteRegistryV1,
  type ModelRoutingRequestV1,
  type NormalizedModelUsageV1,
} from "@cloudmarkup/schemas";

import type { ModelPromptRegistry } from "./prompts/types.js";
import type { InvalidSolutionProposalStoreV1 } from "./solution-planner.js";
import { reviewedModelPromptRegistry } from "./prompts/registry.js";
import {
  ModelProviderInvocationError,
  type ModelGateway,
  type ModelGatewayInvocationContextV1,
  type ModelGatewayResultV1,
  type ModelCapabilityV1,
  type ModelInvocationClaimV1,
  type ModelInvocationStore,
  type ModelProviderAdapter,
  type ModelProviderResultV1,
  type ModelProviderInvocationV1,
  type ModelProviderUsageV1,
  type ModelRequestFor,
  type ModelResponseFor,
  type ModelRoutingDecisionEvaluatorV1,
  type ModelUsageRecorder,
  type SafeModelLogger,
} from "./ports.js";
import {
  ModelRoutingError,
  isModelPromptCacheEligibleV1,
  modelRoutingConfigurationV1Schema,
  requiredModelEffortV1,
  selectModelRouteForDecisionV1,
  selectPreparedModelLiveRouteV2,
  selectModelRouteV1,
  type ModelRoutingConfigurationV1,
} from "./routing.js";
import {
  ModelGatewayValidationError,
  digestStructuredValue,
  redactModelRequest,
  serializedByteLength,
  validateModelRequestAuthority,
  validateModelResponseAuthority,
} from "./security.js";
import {
  ModelResponseToolError,
  getModelResponseToolV1,
  parseModelResponseToolContentV1,
} from "./tools.js";

import {
  createModelLiveRoutingDecisionEvaluatorV2,
  type ModelLiveRoutingPreparationInputV2,
} from "./bedrock-routing.js";

export interface ModelLiveGatewayAuthorityV2 {
  /** Actual host authentication of the issued/current V2 plan, exact frozen
   * request, tenant and configuration. Called before claim and provider entry.
   * Production must also wire the runtime lease/credit assertion into the
   * platform adapter's final HTTP guard. Metadata equality is never approval. */
  authorize(
    input: {
      readonly request: ModelGatewayRequestV1;
      readonly context: ModelGatewayInvocationContextV1;
      readonly routingConfigurationDigest: Sha256Digest;
    } & (
      | { readonly phase: "invoke" }
      | {
          readonly phase: "dispatch";
          readonly invocation: ModelProviderInvocationV1;
        }
    ),
  ): Promise<ModelLiveRoutingPreparationInputV2>;
}

function hasLiveAuthority(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "authorize" in value &&
    typeof value.authorize === "function"
  );
}

function livePreparationDigest(input: ModelLiveRoutingPreparationInputV2) {
  const { observedAt, ...binding } = input;
  void observedAt;
  return digestStructuredValue(binding);
}

export class ModelGatewayError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "ModelGatewayError";
    this.code = code;
  }
}

export interface ProviderNeutralModelGatewayDependencies {
  readonly adapters: readonly ModelProviderAdapter[];
  readonly allowedApprovalPathIds: readonly string[];
  readonly invocationStore: ModelInvocationStore;
  readonly invalidProposalStore: InvalidSolutionProposalStoreV1;
  readonly logger: SafeModelLogger;
  readonly maximumAttempts?: number;
  readonly maximumInputBytes?: number;
  readonly maximumOutputBytes?: number;
  readonly promptRegistry?: ModelPromptRegistry;
  /** Exact reviewed registry used to authorize production routing decisions. */
  readonly routeRegistry?: ModelRouteRegistryV1;
  /** Injectable for deterministic tests; production uses bounded full jitter. */
  readonly retryDelay?: (input: {
    readonly attemptNumber: number;
    readonly maximumDelayMilliseconds: number;
    readonly signal?: AbortSignal;
  }) => Promise<void>;
  /** Trusted pure policy evaluator backed by the exact current registries. */
  readonly routingDecisionEvaluator?: ModelRoutingDecisionEvaluatorV1;
  readonly routing: ModelRoutingConfigurationV1;
  readonly usageRecorder: ModelUsageRecorder;
}

function throwIfCanceled(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new ModelGatewayError(
      "model-gateway.canceled",
      "The model invocation was canceled.",
    );
  }
}

function normalizeUsage(
  descriptor:
    | ModelGatewayResultV1["descriptor"]
    | ModelLiveSeedInvocationDescriptorV3
    | ModelLiveRepairSuccessorInvocationDescriptorV4,
  providerUsage: ModelProviderUsageV1 | undefined,
  result: NormalizedModelUsageV1["result"],
  timing: {
    readonly attemptNumber: number;
    readonly completedAtMilliseconds: number;
    readonly startedAtMilliseconds: number;
  },
): NormalizedModelUsageV1 {
  if (providerUsage === undefined) {
    throw new ModelGatewayError(
      "model-gateway.missing-usage",
      "The provider result omitted required normalized usage inputs.",
    );
  }
  const usageRecordId = `model_usage_${digestStructuredValue({
    attemptNumber: timing.attemptNumber,
    invocationId: descriptor.invocationId,
  }).slice("sha256:".length)}`;
  const normalized = normalizedModelUsageV1Schema.safeParse({
    ...providerUsage,
    attemptNumber: timing.attemptNumber,
    completedAt: new Date(timing.completedAtMilliseconds).toISOString(),
    contractVersion: 1,
    durationMilliseconds:
      timing.completedAtMilliseconds - timing.startedAtMilliseconds,
    feature: descriptor.feature,
    idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
    inferenceProfileId: descriptor.inferenceProfileId,
    invocationId: descriptor.invocationId,
    inputDigest: descriptor.inputDigest,
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    promptTemplateId: descriptor.promptTemplateId,
    promptVersion: descriptor.promptVersion,
    providerId: descriptor.providerId,
    result,
    ...(descriptor.contractVersion !== 1 || descriptor.routing === undefined
      ? {}
      : { routing: descriptor.routing }),
    scope: descriptor.scope,
    startedAt: new Date(timing.startedAtMilliseconds).toISOString(),
    usageRecordId,
  });
  if (!normalized.success) {
    throw new ModelGatewayError(
      "model-gateway.invalid-usage",
      "The provider result contained invalid normalized usage inputs.",
    );
  }
  return normalized.data;
}

const seedUsageFields = normalizedModelUsageV1Schema.shape;
const seedProviderUsageSchema = z
  .object({
    cacheReadUnits: seedUsageFields.cacheReadUnits,
    cacheWriteUnits: seedUsageFields.cacheWriteUnits,
    inputUnits: seedUsageFields.inputUnits,
    outputUnits: seedUsageFields.outputUnits,
    thinkingUnits: seedUsageFields.thinkingUnits,
    providerRequestId: seedUsageFields.providerRequestId.unwrap(),
  })
  .strict();

/** Normalize actual known usage for the single physical send in one seed stage.
 * The canonical workflow ordinal is separate from this physical attempt (one).
 * Static V3 routing is not historical final V1 routing, so none is invented here.
 * Missing or invalid usage must remain unknown at the host accounting boundary. */
interface HostUsageInput<D> {
  readonly descriptor: D;
  readonly providerUsage: ModelProviderUsageV1 | undefined;
  readonly result: NormalizedModelUsageV1["result"];
  readonly startedAtMilliseconds: number;
  readonly completedAtMilliseconds: number;
}
function normalizeHostUsage<
  D extends
    | ModelLiveSeedInvocationDescriptorV3
    | ModelLiveRepairSuccessorInvocationDescriptorV4,
>(
  input: HostUsageInput<D>,
  parse: (raw: unknown) => D,
): NormalizedModelUsageV1 {
  if (input.providerUsage === undefined) {
    throw new ModelGatewayError(
      "model-gateway.missing-usage",
      "The provider result omitted required normalized usage inputs.",
    );
  }
  try {
    const descriptor = parse(input.descriptor);
    const usage = seedProviderUsageSchema.parse(input.providerUsage);
    if (usage.cacheReadUnits !== "0" || usage.cacheWriteUnits !== "0")
      throw new Error("Host repair caching is disabled");
    return normalizeUsage(descriptor, usage, input.result, {
      attemptNumber: 1,
      startedAtMilliseconds: input.startedAtMilliseconds,
      completedAtMilliseconds: input.completedAtMilliseconds,
    });
  } catch {
    throw new ModelGatewayError(
      "model-gateway.invalid-usage",
      "The provider result contained invalid normalized usage inputs.",
    );
  }
}
export function normalizeModelHostSeedUsageV3(
  input: HostUsageInput<ModelLiveSeedInvocationDescriptorV3>,
): NormalizedModelUsageV1 {
  return normalizeHostUsage(input, (raw) =>
    modelLiveSeedInvocationDescriptorV3Schema.parse(raw),
  );
}
/** Explicit final-stage reader; physical send one is canonical repair two. */
export function normalizeModelHostRepairSuccessorUsageV4(
  input: HostUsageInput<ModelLiveRepairSuccessorInvocationDescriptorV4>,
): NormalizedModelUsageV1 {
  return normalizeHostUsage(input, (raw) =>
    modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse(raw),
  );
}

const providerUsagePropertyByExpectedField = Object.freeze({
  "cache-read-units": "cacheReadUnits",
  "cache-write-units": "cacheWriteUnits",
  "input-units": "inputUnits",
  "output-units": "outputUnits",
  "provider-request-id": "providerRequestId",
  "thinking-units": "thinkingUnits",
} as const satisfies Record<
  ModelCapabilityV1["usageFieldsExpected"][number],
  keyof ModelProviderUsageV1
>);

function assertExpectedProviderUsageFields(
  capability: ModelCapabilityV1,
  providerUsage: ModelProviderUsageV1 | undefined,
): asserts providerUsage is ModelProviderUsageV1 {
  if (providerUsage === undefined) {
    throw new ModelGatewayError(
      "model-gateway.missing-usage",
      "The provider result omitted required normalized usage inputs.",
    );
  }
  for (const field of capability.usageFieldsExpected) {
    if (
      providerUsage[providerUsagePropertyByExpectedField[field]] === undefined
    ) {
      throw new ModelGatewayError(
        "model-gateway.missing-usage",
        "The provider result omitted a usage field required by the selected capability.",
      );
    }
  }
}

async function boundedRetryDelay(input: {
  readonly attemptNumber: number;
  readonly maximumDelayMilliseconds: number;
  readonly signal?: AbortSignal;
}): Promise<void> {
  throwIfCanceled(input.signal);
  const exponentialMaximum = Math.min(
    input.maximumDelayMilliseconds,
    250 * 2 ** Math.max(0, input.attemptNumber - 1),
  );
  const delayMilliseconds = Math.floor(Math.random() * exponentialMaximum);
  if (delayMilliseconds === 0) return;
  await new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", cancel);
      reject(
        new ModelGatewayError(
          "model-gateway.canceled",
          "The model invocation was canceled.",
        ),
      );
    };
    const complete = () => {
      input.signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timeout = setTimeout(complete, delayMilliseconds);
    input.signal?.addEventListener("abort", cancel, { once: true });
  });
}

function compareUtf16CodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requestCatalogScopeDigest(request: ModelGatewayRequestV1) {
  const catalogAuthorities: {
    readonly path: string;
    readonly value: unknown;
  }[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        visit(entry, `${path}[${String(index)}]`);
      });
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, entry] of Object.entries(value).sort(([left], [right]) =>
      compareUtf16CodeUnits(left, right),
    )) {
      const entryPath = path.length === 0 ? key : `${path}.${key}`;
      if (key.toLowerCase().includes("catalog")) {
        catalogAuthorities.push({ path: entryPath, value: entry });
      } else {
        visit(entry, entryPath);
      }
    }
  };
  visit(request, "");
  return digestStructuredValue({
    catalogAuthorities,
    operation: request.operation,
  });
}

function safeError(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (
    error instanceof ModelGatewayError ||
    error instanceof ModelGatewayValidationError ||
    error instanceof ModelRoutingError ||
    error instanceof ModelResponseToolError
  ) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ModelProviderInvocationError) {
    return { code: error.safeCode, message: error.message };
  }
  return {
    code: "model-gateway.internal-error",
    message: "The model request could not be completed.",
  };
}

function assertOperationScopeBinding(
  request: ModelGatewayRequestV1,
  scope: ModelGatewayInvocationContextV1["scope"],
): void {
  if (
    (request.operation === "application-source.generate" ||
      request.operation === "iac-extension.generate") &&
    request.solutionRevision.solutionRevisionId !== scope.solutionRevisionId
  ) {
    throw new ModelGatewayError(
      "model-gateway.scope-authority-mismatch",
      "The immutable Solution Revision source does not match the trusted invocation scope.",
    );
  }
  if (
    request.operation === "workload.propose" &&
    request.solutionRevision !== undefined &&
    request.solutionRevision.solutionRevisionId !== scope.solutionRevisionId
  ) {
    throw new ModelGatewayError(
      "model-gateway.scope-authority-mismatch",
      "The optional workload Solution Revision does not match the trusted invocation scope.",
    );
  }
  if (
    (request.operation === "issue.explain" ||
      request.operation === "deterministic-fix.explain" ||
      request.operation === "fix.propose") &&
    request.issue.solutionRevisionId !== scope.solutionRevisionId
  ) {
    throw new ModelGatewayError(
      "model-gateway.scope-authority-mismatch",
      "The issue Solution Revision does not match the trusted invocation scope.",
    );
  }
  if (
    request.operation === "operations.propose" &&
    request.reconciliation !== undefined &&
    request.reconciliation.repositorySnapshotId !== scope.repositorySnapshotId
  ) {
    throw new ModelGatewayError(
      "model-gateway.scope-authority-mismatch",
      "The Reconciliation Proposal Repository Snapshot does not match the trusted invocation scope.",
    );
  }
  if (
    request.operation === "repository.interpret" &&
    request.repositorySnapshotId !== scope.repositorySnapshotId
  ) {
    throw new ModelGatewayError(
      "model-gateway.scope-authority-mismatch",
      "The Repository Snapshot source does not match the trusted invocation scope.",
    );
  }
}

function routingRequestMatchesInvocationAuthority(input: {
  readonly authorityInputDigest: string;
  readonly context: ModelGatewayInvocationContextV1;
  readonly operation: ModelGatewayOperationV1;
  readonly request: ModelRoutingRequestV1;
  readonly scopeDigest: string;
}): boolean {
  const { authorityInputDigest, context, operation, request, scopeDigest } =
    input;
  return (
    request.feature === operation &&
    request.requestedMode === context.requestedMode &&
    request.inputDigest === authorityInputDigest &&
    request.scopeDigest === scopeDigest &&
    request.idempotencyKeyDigest === context.idempotencyKeyDigest &&
    request.organizationId === context.scope.organizationId &&
    request.principalId === context.scope.userId &&
    request.projectId === context.scope.projectId &&
    request.solutionRevisionId === context.scope.solutionRevisionId &&
    request.plan.entitlementDecisionId === context.entitlement.decisionId &&
    request.plan.key === context.entitlement.planKey &&
    request.plan.versionId === context.entitlement.planVersionId &&
    request.creditAuthorization.decisionId === context.budget.decisionId &&
    request.creditAuthorization.allowed === context.budget.allowed &&
    request.creditAuthorization.availableCreditUnits ===
      context.budget.availableCreditUnits &&
    request.creditAuthorization.estimateAccepted ===
      context.budget.estimateAccepted &&
    request.creditAuthorization.acceptedEstimateMaximumCreditUnits ===
      context.budget.acceptedEstimateMaximumCreditUnits &&
    request.requiredEvaluationPolicyId === context.evaluationPolicyId &&
    request.requiredEvaluationPolicyVersion ===
      context.evaluationPolicyVersion &&
    serializeCanonicalJson(request.xhighEffortAuthorization ?? null) ===
      serializeCanonicalJson(context.xhighEffortAuthorization ?? null)
  );
}

interface GatewayClaimAuthorityInput {
  readonly livePreparation: ModelLiveRoutingPreparationInputV2 | undefined;
  readonly adapterProfiles: readonly ModelProviderAdapter["profile"][];
  readonly allowedApprovalPathIds: ReadonlySet<string>;
  readonly context: ModelGatewayInvocationContextV1;
  readonly authorityInputDigest: Sha256Digest;
  readonly routeRegistry: ModelRouteRegistryV1 | undefined;
  readonly prompt: NonNullable<ReturnType<ModelPromptRegistry["get"]>>;
  readonly routingConfiguration: ModelRoutingConfigurationV1;
  readonly routingDecision: ModelGatewayInvocationContextV1["routingDecision"];
  readonly routingRequest: ModelGatewayInvocationContextV1["routingRequest"];
}
function gatewayClaimAuthority(
  input: GatewayClaimAuthorityInput,
): Sha256Digest {
  const {
    livePreparation,
    adapterProfiles,
    allowedApprovalPathIds,
    context,
    authorityInputDigest,
    routeRegistry,
    prompt,
    routingConfiguration,
    routingDecision,
    routingRequest,
  } = input;
  return digestStructuredValue({
    ...(livePreparation === undefined
      ? {}
      : { liveEvaluation: livePreparationDigest(livePreparation) }),
    adapterProfiles: adapterProfiles,
    allowedApprovalPathIds: [...allowedApprovalPathIds].sort(
      compareUtf16CodeUnits,
    ),
    authorization: {
      budget: context.budget,
      complexity: context.complexity,
      entitlement: context.entitlement,
      evaluationPolicyId: context.evaluationPolicyId,
      evaluationPolicyVersion: context.evaluationPolicyVersion,
      requestedMode: context.requestedMode,
      scope: context.scope,
      xhighEffortAuthorization: context.xhighEffortAuthorization ?? null,
    },
    authorityInputDigest,
    routeRegistry: routeRegistry ?? null,
    reviewedPrompt: {
      digest: prompt.digest,
      operations: [...prompt.operations].sort(compareUtf16CodeUnits),
      templateId: prompt.templateId,
      version: prompt.version,
    },
    routingConfiguration: routingConfiguration,
    routingDecision: routingDecision ?? null,
    routingRequest: routingRequest ?? null,
  });
}
export interface ModelLiveGatewayClaimProjectionInputV2 {
  readonly preparation: ModelLiveRoutingPreparationInputV2;
  readonly request: ModelGatewayRequestV1;
  readonly context: ModelGatewayInvocationContextV1;
  readonly adapterProfiles: readonly ModelProviderAdapter["profile"][];
  readonly allowedApprovalPathIds: readonly string[];
  readonly routing: ModelRoutingConfigurationV1;
}
/** Pure identity preparation for a closed live host's durable journal.
 * Shares the real gateway hash; never approves, claims, reserves or dispatches.
 * Uses the reviewed prompt registry. The actual gateway still authenticates
 * current issued authority and must produce exactly this claim before a call. */
export function projectModelLiveGatewayClaimV2(
  raw: ModelLiveGatewayClaimProjectionInputV2,
): ModelInvocationClaimV1 {
  try {
    const input = structuredClone(raw);
    const request = modelGatewayRequestV1Schema.parse(input.request);
    const context = input.context;
    const routingConfiguration = modelRoutingConfigurationV1Schema.parse(
      input.routing,
    );
    const routingRequest = modelRoutingRequestV1Schema.parse(
      context.routingRequest,
    );
    const routingDecision = modelRoutingDecisionV1Schema.parse(
      context.routingDecision,
    );
    const routeRegistry = modelRouteRegistryV1Schema.parse(
      input.preparation.routeRegistry,
    );
    assertOperationScopeBinding(request, context.scope);
    validateModelRequestAuthority(request);
    const sanitized = modelGatewayRequestV1Schema.parse(
      redactModelRequest(request).request,
    );
    validateModelRequestAuthority(sanitized);
    const authorityInputDigest = digestStructuredValue({
      request,
      scope: context.scope,
    });
    const routingConfigurationDigest =
      digestStructuredValue(routingConfiguration);
    if (
      request.requestedMode !== context.requestedMode ||
      routingConfiguration.allowFallback ||
      routingDecision.outcome !== "selected" ||
      serializeCanonicalJson(input.preparation.request) !==
        serializeCanonicalJson(routingRequest) ||
      input.preparation.routingConfigurationDigest !==
        routingConfigurationDigest ||
      !routingRequestMatchesInvocationAuthority({
        authorityInputDigest,
        context,
        operation: request.operation,
        request: routingRequest,
        scopeDigest: digestStructuredValue(context.scope),
      })
    )
      throw Error("Mismatched prepared identity.");
    const evaluated = createModelLiveRoutingDecisionEvaluatorV2(
      input.preparation,
    ).evaluate({ request: routingRequest, routingConfigurationDigest });
    if (
      serializeCanonicalJson(evaluated.decision) !==
      serializeCanonicalJson(routingDecision)
    )
      throw Error("Mismatched prepared route.");
    const prompt = reviewedModelPromptRegistry.get(request.operation);
    if (prompt === null) throw Error("Missing reviewed prompt.");
    return {
      authorityDigest: gatewayClaimAuthority({
        livePreparation: input.preparation,
        adapterProfiles: input.adapterProfiles,
        allowedApprovalPathIds: new Set(input.allowedApprovalPathIds),
        context,
        authorityInputDigest,
        routeRegistry,
        prompt,
        routingConfiguration,
        routingDecision,
        routingRequest,
      }),
      idempotencyKeyDigest: context.idempotencyKeyDigest,
      inputDigest: digestStructuredValue({
        request: sanitized,
        scope: context.scope,
      }),
      invocationId: context.invocationId,
    };
  } catch {
    throw new ModelGatewayError(
      "model-gateway.live-authority-required",
      "Exact live gateway claim preparation is unavailable.",
    );
  }
}

class ModelGatewayEngine implements ModelGateway {
  readonly #liveAuthority: ModelLiveGatewayAuthorityV2 | undefined;
  readonly #dependencies: ProviderNeutralModelGatewayDependencies;
  readonly #allowedApprovalPathIds: ReadonlySet<string>;
  readonly #maximumAttempts: number;
  readonly #maximumInputBytes: number;
  readonly #maximumOutputBytes: number;
  readonly #promptRegistry: ModelPromptRegistry;
  readonly #routingConfiguration: ModelRoutingConfigurationV1;

  public constructor(
    dependencies: ProviderNeutralModelGatewayDependencies,
    liveAuthority?: ModelLiveGatewayAuthorityV2,
  ) {
    this.#liveAuthority =
      liveAuthority === undefined
        ? undefined
        : { authorize: liveAuthority.authorize.bind(liveAuthority) };
    this.#dependencies = dependencies;
    this.#allowedApprovalPathIds = new Set(dependencies.allowedApprovalPathIds);
    this.#maximumAttempts = dependencies.maximumAttempts ?? 2;
    this.#maximumInputBytes = dependencies.maximumInputBytes ?? 1024 * 1024;
    this.#maximumOutputBytes = dependencies.maximumOutputBytes ?? 512 * 1024;
    this.#promptRegistry =
      dependencies.promptRegistry ?? reviewedModelPromptRegistry;
    const routingConfiguration = modelRoutingConfigurationV1Schema.safeParse(
      dependencies.routing,
    );
    if (!routingConfiguration.success) {
      throw new ModelGatewayError(
        "model-gateway.invalid-routing-configuration",
        "The runtime model routing configuration does not match its strict reviewed contract.",
      );
    }
    this.#routingConfiguration = routingConfiguration.data;
    if (
      liveAuthority !== undefined &&
      (this.#routingConfiguration.allowFallback ||
        dependencies.routeRegistry === undefined)
    )
      throw new ModelGatewayError(
        "model-gateway.live-authority-required",
        "Live evaluation requires its exact route registry and disables fallback.",
      );
    if (
      !Number.isSafeInteger(this.#maximumAttempts) ||
      this.#maximumAttempts < 1 ||
      this.#maximumAttempts > 2
    ) {
      throw new ModelGatewayError(
        "model-gateway.invalid-attempt-limit",
        "The maximum model attempt count must be between one and two.",
      );
    }
  }

  async #authorizeLive(
    input: Parameters<ModelLiveGatewayAuthorityV2["authorize"]>[0],
  ): Promise<ModelLiveRoutingPreparationInputV2> {
    try {
      if (this.#liveAuthority === undefined) throw Error("Missing authority.");
      const prepared = structuredClone(
        await this.#liveAuthority.authorize(structuredClone(input)),
      );
      if (
        input.context.routingRequest === undefined ||
        serializeCanonicalJson(prepared.request) !==
          serializeCanonicalJson(input.context.routingRequest) ||
        prepared.routingConfigurationDigest !==
          input.routingConfigurationDigest ||
        serializeCanonicalJson(prepared.routeRegistry) !==
          serializeCanonicalJson(this.#dependencies.routeRegistry)
      )
        throw Error("Mismatched live binding.");
      createModelLiveRoutingDecisionEvaluatorV2(prepared);
      return prepared;
    } catch {
      throw new ModelGatewayError(
        "model-gateway.live-authority-required",
        "Current exact live evaluation authority is unavailable.",
      );
    }
  }

  public async invoke<TOperation extends ModelGatewayOperationV1>(
    requestInput: ModelRequestFor<TOperation>,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<TOperation>> {
    throwIfCanceled(signal);
    if (this.#liveAuthority !== undefined) context = structuredClone(context);
    const parsed = modelGatewayRequestV1Schema.safeParse(requestInput);
    if (!parsed.success) {
      throw new ModelGatewayError(
        "model-gateway.invalid-request",
        "The model request does not match the strict v1 contract.",
      );
    }
    if (parsed.data.requestedMode !== context.requestedMode) {
      throw new ModelGatewayError(
        "model-gateway.mode-authority-mismatch",
        "The request mode does not match trusted invocation context.",
      );
    }
    assertOperationScopeBinding(parsed.data, context.scope);
    validateModelRequestAuthority(parsed.data);
    const authorityInputDigest = digestStructuredValue({
      request: parsed.data,
      scope: context.scope,
    });
    const redacted = redactModelRequest(parsed.data);
    const sanitized = modelGatewayRequestV1Schema.safeParse(redacted.request);
    if (!sanitized.success) {
      throw new ModelGatewayError(
        "model-gateway.redaction-invalid",
        "Input redaction could not preserve the strict request contract.",
      );
    }
    validateModelRequestAuthority(sanitized.data);
    const inputBytes = serializedByteLength(sanitized.data);
    if (inputBytes > this.#maximumInputBytes) {
      throw new ModelGatewayError(
        "model-gateway.input-too-large",
        "The sanitized model input exceeds the gateway limit.",
      );
    }
    const inputDigest = digestStructuredValue({
      request: sanitized.data,
      scope: context.scope,
    });
    const scopeDigest = digestStructuredValue(context.scope);
    const routingConfigurationDigest = digestStructuredValue(
      this.#routingConfiguration,
    );
    const suppliedRoutingDecision =
      context.routingDecision === undefined
        ? undefined
        : modelRoutingDecisionV1Schema.safeParse(context.routingDecision);
    const suppliedRoutingRequest =
      context.routingRequest === undefined
        ? undefined
        : modelRoutingRequestV1Schema.safeParse(context.routingRequest);
    if (
      suppliedRoutingDecision?.success === false ||
      suppliedRoutingRequest?.success === false ||
      (suppliedRoutingDecision === undefined) !==
        (suppliedRoutingRequest === undefined)
    ) {
      throw new ModelGatewayError(
        "model-gateway.routing-decision-mismatch",
        "The routing decision and request must both match their strict v1 contracts.",
      );
    }
    const routingDecision = suppliedRoutingDecision?.data;
    const routingRequest = suppliedRoutingRequest?.data;
    if (
      this.#liveAuthority !== undefined &&
      (routingRequest === undefined || routingDecision === undefined)
    )
      throw new ModelGatewayError(
        "model-gateway.live-authority-required",
        "Live evaluation requires exact prepared routing authority.",
      );
    const livePreparation =
      this.#liveAuthority === undefined
        ? undefined
        : await this.#authorizeLive({
            phase: "invoke",
            request: sanitized.data,
            context,
            routingConfigurationDigest,
          });
    let trustedRoutingCapability: ModelCapabilityV1 | undefined;
    if (routingDecision !== undefined && routingRequest !== undefined) {
      if (
        routingDecision.outcome !== "selected" ||
        !routingRequestMatchesInvocationAuthority({
          authorityInputDigest,
          context,
          operation: sanitized.data.operation,
          request: routingRequest,
          scopeDigest,
        })
      ) {
        throw new ModelGatewayError(
          "model-gateway.routing-decision-mismatch",
          "The routing request does not match the exact invocation, scope, entitlement, credit, or evaluation authority.",
        );
      }
      const evaluator =
        livePreparation === undefined
          ? this.#dependencies.routingDecisionEvaluator
          : createModelLiveRoutingDecisionEvaluatorV2(livePreparation);
      if (evaluator === undefined) {
        throw new ModelGatewayError(
          "model-gateway.routing-decision-mismatch",
          "The routing decision cannot be verified without the trusted policy evaluator.",
        );
      }
      let recomputedEvaluation:
        | {
            readonly capability: ModelCapabilityV1;
            readonly decision: unknown;
          }
        | undefined;
      try {
        recomputedEvaluation = evaluator.evaluate({
          request: routingRequest,
          routingConfigurationDigest,
        });
      } catch {
        throw new ModelGatewayError(
          "model-gateway.routing-decision-mismatch",
          "The routing decision could not be reproduced by the trusted policy evaluator.",
        );
      }
      const parsedRecomputedDecision = modelRoutingDecisionV1Schema.safeParse(
        recomputedEvaluation.decision,
      );
      if (
        !parsedRecomputedDecision.success ||
        serializeCanonicalJson(parsedRecomputedDecision.data) !==
          serializeCanonicalJson(routingDecision)
      ) {
        throw new ModelGatewayError(
          "model-gateway.routing-decision-mismatch",
          "The supplied routing decision differs from the complete trusted policy decision.",
        );
      }
      trustedRoutingCapability = recomputedEvaluation.capability;
    }
    const prompt = this.#promptRegistry.get(sanitized.data.operation);
    if (prompt === null) {
      throw new ModelGatewayError(
        "model-gateway.prompt-not-registered",
        "No reviewed prompt is registered for this operation.",
      );
    }
    const authorityDigest = gatewayClaimAuthority({
      livePreparation,
      adapterProfiles: this.#dependencies.adapters.map(
        (adapter) => adapter.profile,
      ),
      allowedApprovalPathIds: this.#allowedApprovalPathIds,
      context,
      authorityInputDigest,
      routeRegistry: this.#dependencies.routeRegistry,
      prompt,
      routingConfiguration: this.#routingConfiguration,
      routingDecision,
      routingRequest,
    });
    const claim: ModelInvocationClaimV1 = {
      authorityDigest,
      idempotencyKeyDigest: context.idempotencyKeyDigest,
      inputDigest,
      invocationId: context.invocationId,
      ...(routingDecision?.routeId === "internal-escalation" &&
      routingRequest?.priorAttempt !== undefined
        ? {
            escalation: {
              feature: sanitized.data.operation,
              lineageDigest: digestStructuredValue({
                feature: sanitized.data.operation,
                inputDigest,
                originalAcceptedEstimateMaximumCreditUnits:
                  routingRequest.priorAttempt
                    .originalAcceptedEstimateMaximumCreditUnits,
                originalCreditAuthorizationDecisionId:
                  routingRequest.priorAttempt
                    .originalCreditAuthorizationDecisionId,
                originalInvocationId:
                  routingRequest.priorAttempt.originalInvocationId,
                originalRoutingDecisionDigest:
                  routingRequest.priorAttempt.originalRoutingDecisionDigest,
                scopeDigest,
              }),
              originalAcceptedEstimateMaximumCreditUnits:
                routingRequest.priorAttempt
                  .originalAcceptedEstimateMaximumCreditUnits,
              originalCreditAuthorizationDecisionId:
                routingRequest.priorAttempt
                  .originalCreditAuthorizationDecisionId,
              originalInvocationId:
                routingRequest.priorAttempt.originalInvocationId,
              originalRoutingDecisionDigest:
                routingRequest.priorAttempt.originalRoutingDecisionDigest,
              scopeDigest,
            },
          }
        : {}),
    };
    const claimed = await this.#dependencies.invocationStore.claim(claim);
    if (claimed.kind === "duplicate-complete") {
      if (
        digestStructuredValue(claimed.result.descriptor.scope) !==
          scopeDigest ||
        claimed.result.descriptor.idempotencyKeyDigest !==
          context.idempotencyKeyDigest ||
        claimed.result.descriptor.inputDigest !== inputDigest ||
        claimed.result.descriptor.complexity !== context.complexity ||
        claimed.result.descriptor.requestedMode !== context.requestedMode ||
        !context.entitlement.allowed ||
        !context.budget.allowed ||
        !context.entitlement.allowedRoles.includes(
          claimed.result.descriptor.role,
        ) ||
        claimed.result.descriptor.entitlementDecisionId !==
          context.entitlement.decisionId ||
        claimed.result.descriptor.budgetDecisionId !==
          context.budget.decisionId ||
        claimed.result.descriptor.evaluationPolicyId !==
          context.evaluationPolicyId ||
        claimed.result.descriptor.evaluationPolicyVersion !==
          context.evaluationPolicyVersion ||
        claimed.result.descriptor.routing?.routingDecisionDigest !==
          (routingDecision === undefined
            ? undefined
            : digestStructuredValue(routingDecision))
      ) {
        throw new ModelGatewayError(
          "model-gateway.invocation-conflict",
          "The invocation identity is already bound to different scope, routing, or authorization authority.",
        );
      }
      return claimed.result as unknown as ModelGatewayResultV1<TOperation>;
    }
    if (claimed.kind === "duplicate-result-unavailable") {
      throw new ModelGatewayError(
        "model-gateway.result-not-replayable",
        "This invocation has finished. Its memory-only result cannot be replayed.",
      );
    }
    if (claimed.kind === "duplicate-in-progress") {
      throw new ModelGatewayError(
        "model-gateway.invocation-in-progress",
        "The exact model invocation is already in progress.",
      );
    }
    if (claimed.kind === "conflict") {
      throw new ModelGatewayError(
        "model-gateway.invocation-conflict",
        "The invocation identity is already bound to a different request.",
      );
    }

    let terminalAttemptNumber = 1;
    try {
      const selected =
        routingDecision === undefined || routingRequest === undefined
          ? (() => {
              const deterministicFakeProfiles = this.#dependencies.adapters
                .map((adapter) => adapter.profile)
                .filter(
                  (profile) => profile.providerFamily === "deterministic-fake",
                );
              if (deterministicFakeProfiles.length === 0) {
                throw new ModelGatewayError(
                  "model-gateway.routing-decision-required",
                  "A trusted routing decision is required for a production provider.",
                );
              }
              return selectModelRouteV1({
                configuration: this.#routingConfiguration,
                context,
                operation: sanitized.data.operation,
                profiles: deterministicFakeProfiles,
              });
            })()
          : (() => {
              const selection = {
                configuration: this.#routingConfiguration,
                context,
                decision: routingDecision,
                operation: sanitized.data.operation,
                profiles: this.#dependencies.adapters.map(
                  (adapter) => adapter.profile,
                ),
                request: routingRequest,
              };
              if (livePreparation === undefined)
                return selectModelRouteForDecisionV1(selection);
              if (trustedRoutingCapability === undefined)
                throw new ModelGatewayError(
                  "model-gateway.live-authority-required",
                  "The exact live capability is unavailable.",
                );
              return selectPreparedModelLiveRouteV2({
                ...selection,
                preparedCapability: trustedRoutingCapability,
              });
            })();
      const adapter = this.#dependencies.adapters.find(
        (candidate) =>
          candidate.profile.providerId === selected.profile.providerId,
      );
      if (adapter === undefined) {
        throw new ModelGatewayError(
          "model-gateway.adapter-unavailable",
          "The selected model provider adapter is unavailable.",
        );
      }
      if (
        adapter.profile.providerFamily !== "deterministic-fake" &&
        routingDecision === undefined
      ) {
        throw new ModelGatewayError(
          "model-gateway.routing-decision-required",
          "A trusted routing decision is required for a production provider.",
        );
      }
      if (routingDecision !== undefined) {
        const parsedRouteRegistry =
          this.#dependencies.routeRegistry === undefined
            ? null
            : modelRouteRegistryV1Schema.safeParse(
                this.#dependencies.routeRegistry,
              );
        const routeRegistry =
          parsedRouteRegistry?.success === true
            ? parsedRouteRegistry.data
            : undefined;
        const exactRoute = routeRegistry?.routes.find(
          (route) => route.routeId === routingDecision.routeId,
        );
        const expectedCacheEnabled =
          livePreparation === undefined &&
          exactRoute !== undefined &&
          routingRequest !== undefined &&
          isModelPromptCacheEligibleV1({
            capability: selected.capability,
            request: routingRequest,
            route: exactRoute,
          });
        if (
          routingRequest === undefined ||
          routeRegistry === undefined ||
          exactRoute === undefined ||
          routingDecision.outcome !== "selected" ||
          trustedRoutingCapability === undefined ||
          !routingRequestMatchesInvocationAuthority({
            authorityInputDigest,
            context,
            operation: sanitized.data.operation,
            request: routingRequest,
            scopeDigest,
          }) ||
          serializeCanonicalJson(selected.capability) !==
            serializeCanonicalJson(trustedRoutingCapability) ||
          routingDecision.feature !== sanitized.data.operation ||
          routingDecision.requestedMode !== context.requestedMode ||
          routingDecision.providerFamily !== selected.profile.providerFamily ||
          routingDecision.providerId !== selected.profile.providerId ||
          routingDecision.modelFamily !== selected.capability.modelFamily ||
          routingDecision.modelId !== selected.capability.modelId ||
          routingDecision.modelVersion !== selected.capability.modelVersion ||
          routingDecision.inferenceProfileId !==
            selected.capability.inferenceProfileId ||
          routingDecision.capabilityRegistryId !==
            selected.capability.capabilityRegistryId ||
          routingDecision.capabilityRegistryDigest !==
            selected.capability.capabilityRegistryDigest ||
          routingDecision.capabilityRegistryVersion !==
            selected.capability.capabilityRegistryVersion ||
          routingDecision.modelCapabilityVersion !==
            selected.capability.capabilityVersion ||
          routingDecision.modelCapabilityDigest !==
            selected.capability.capabilityDigest ||
          routingDecision.modelConfigurationReference !==
            selected.capability.modelConfigurationReference ||
          routingDecision.pricingVersionReference !==
            selected.capability.pricingVersionReference ||
          routingDecision.evaluationPolicyId !== context.evaluationPolicyId ||
          routingDecision.evaluationPolicyVersion !==
            context.evaluationPolicyVersion ||
          routingDecision.evaluationResultDigest !==
            selected.capability.evaluation.resultDigest ||
          routingDecision.evaluationResultVersion !==
            selected.capability.evaluation.resultVersion ||
          routingRequest.requiredEvaluationPolicyId !==
            context.evaluationPolicyId ||
          routingRequest.requiredEvaluationPolicyVersion !==
            context.evaluationPolicyVersion ||
          routingRequest.feature !== sanitized.data.operation ||
          routingRequest.requestedMode !== context.requestedMode ||
          routingRequest.organizationId !== context.scope.organizationId ||
          routingRequest.principalId !== context.scope.userId ||
          routingRequest.projectId !== context.scope.projectId ||
          routingRequest.solutionRevisionId !==
            context.scope.solutionRevisionId ||
          routingRequest.plan.entitlementDecisionId !==
            context.entitlement.decisionId ||
          routingRequest.creditAuthorization.decisionId !==
            context.budget.decisionId ||
          routingRequest.creditAuthorization.allowed !==
            context.budget.allowed ||
          routingDecision.entitlement.allowed !== context.entitlement.allowed ||
          routingDecision.entitlement.decisionId !==
            routingRequest.plan.entitlementDecisionId ||
          routingDecision.entitlement.planKey !== routingRequest.plan.key ||
          routingDecision.entitlement.planVersionId !==
            routingRequest.plan.versionId ||
          routingDecision.creditAuthorization.allowed !==
            routingRequest.creditAuthorization.allowed ||
          routingDecision.creditAuthorization.decisionId !==
            routingRequest.creditAuthorization.decisionId ||
          routingDecision.creditAuthorization.estimateAccepted !==
            routingRequest.creditAuthorization.estimateAccepted ||
          routingDecision.customerCharge.acceptedMaximumCreditUnits !==
            routingRequest.creditAuthorization
              .acceptedEstimateMaximumCreditUnits ||
          routingDecision.requestBinding.inputDigest !== authorityInputDigest ||
          routingDecision.requestBinding.scopeDigest !== scopeDigest ||
          routingDecision.requestBinding.idempotencyKeyDigest !==
            context.idempotencyKeyDigest ||
          routingDecision.requestBinding.routingRequestDigest !==
            digestStructuredValue(routingRequest) ||
          routingRequest.inputDigest !== authorityInputDigest ||
          routingRequest.scopeDigest !== scopeDigest ||
          routingRequest.idempotencyKeyDigest !==
            context.idempotencyKeyDigest ||
          !selected.capability.acceptedEffortLevels.includes(
            routingDecision.effort,
          ) ||
          !exactRoute.allowedEffortLevels.includes(routingDecision.effort) ||
          routingDecision.effort !==
            requiredModelEffortV1(exactRoute, routingRequest) ||
          !exactRoute.allowedRoles.includes(selected.role) ||
          !selected.capability.roles.includes(selected.role) ||
          !exactRoute.enabled ||
          exactRoute.modelConfigurationReference !==
            selected.capability.modelConfigurationReference ||
          routingDecision.maximumAttempts > exactRoute.maximumAttempts ||
          routingDecision.maximumAttempts >
            selected.capability.maximumAttempts ||
          routingDecision.timeoutMilliseconds >
            selected.capability.timeoutMilliseconds ||
          routingDecision.maximumOutputTokens >
            selected.capability.maximumOutputTokens ||
          routingRequest.estimatedContextTokens >
            selected.capability.contextLimitTokens -
              routingDecision.maximumOutputTokens ||
          routingDecision.promptCachePolicy.enabled !== expectedCacheEnabled ||
          routingDecision.promptCachePolicy.cacheKeyRequired !==
            expectedCacheEnabled ||
          routingDecision.promptCachePolicy.maximumCheckpoints !==
            (expectedCacheEnabled
              ? selected.capability.promptCache.maximumCheckpoints
              : 0) ||
          routingDecision.promptCachePolicy.minimumCheckpointTokens !==
            (expectedCacheEnabled
              ? selected.capability.promptCache.minimumCheckpointTokens
              : 0) ||
          (routingDecision.effort === "xhigh"
            ? routingDecision.xhighEffortAuthorizationDecisionId !==
              routingRequest.xhighEffortAuthorization?.decisionId
            : routingDecision.xhighEffortAuthorizationDecisionId !==
              undefined) ||
          routeRegistry.capabilityRegistryId !==
            selected.capability.capabilityRegistryId ||
          routeRegistry.capabilityRegistryDigest !==
            selected.capability.capabilityRegistryDigest ||
          routeRegistry.capabilityRegistryVersion !==
            selected.capability.capabilityRegistryVersion ||
          routingDecision.routeRegistryId !== routeRegistry.routeRegistryId ||
          routingDecision.routeRegistryVersion !==
            routeRegistry.routeRegistryVersion ||
          routingDecision.routeRegistryDigest !==
            digestStructuredValue(routeRegistry) ||
          routingDecision.routeDefinitionDigest !==
            digestStructuredValue(exactRoute) ||
          routingDecision.routingConfigurationDigest !==
            routingConfigurationDigest ||
          routeRegistry.routeRegistryId !==
            this.#routingConfiguration.configurationId ||
          routeRegistry.routeRegistryVersion !==
            this.#routingConfiguration.configurationVersion
        ) {
          throw new ModelGatewayError(
            "model-gateway.routing-decision-mismatch",
            "The trusted routing decision does not match its exact request, route, scope, or provider capability.",
          );
        }
      }
      if (inputBytes > selected.capability.maximumInputBytes) {
        throw new ModelGatewayError(
          "model-gateway.provider-input-too-large",
          "The sanitized model input exceeds the selected capability limit.",
        );
      }
      const responseTool = getModelResponseToolV1(sanitized.data.operation);
      const descriptor = modelInvocationDescriptorV1Schema.parse({
        budgetDecisionId: context.budget.decisionId,
        complexity: context.complexity,
        contractVersion: 1,
        entitlementDecisionId: context.entitlement.decisionId,
        evaluationPolicyId: context.evaluationPolicyId,
        evaluationPolicyVersion: context.evaluationPolicyVersion,
        feature: sanitized.data.operation,
        idempotencyKeyDigest: context.idempotencyKeyDigest,
        inferenceProfileId: selected.capability.inferenceProfileId,
        inputDigest,
        invocationId: context.invocationId,
        modelId: selected.capability.modelId,
        modelVersion: selected.capability.modelVersion,
        promptDigest: prompt.digest,
        promptTemplateId: prompt.templateId,
        promptVersion: prompt.version,
        providerFamily: selected.profile.providerFamily,
        providerId: selected.profile.providerId,
        requestedMode: context.requestedMode,
        role: selected.role,
        ...(routingDecision === undefined
          ? {}
          : {
              routing: {
                ...(routingDecision.customerCharge
                  .acceptedMaximumCreditUnits === undefined
                  ? {}
                  : {
                      acceptedMaximumCreditUnits:
                        routingDecision.customerCharge
                          .acceptedMaximumCreditUnits,
                    }),
                capabilityRegistryDigest:
                  routingDecision.capabilityRegistryDigest,
                capabilityRegistryId: routingDecision.capabilityRegistryId,
                capabilityRegistryVersion:
                  routingDecision.capabilityRegistryVersion,
                capabilityVersion: routingDecision.modelCapabilityVersion,
                effort: routingDecision.effort,
                evaluationResultDigest: routingDecision.evaluationResultDigest,
                evaluationResultVersion:
                  routingDecision.evaluationResultVersion,
                evaluationPolicyId: routingDecision.evaluationPolicyId,
                evaluationPolicyVersion:
                  routingDecision.evaluationPolicyVersion,
                modelConfigurationReference:
                  routingDecision.modelConfigurationReference,
                modelCapabilityDigest: routingDecision.modelCapabilityDigest,
                modelFamily: routingDecision.modelFamily,
                pricingVersionReference:
                  routingDecision.pricingVersionReference,
                routeId: routingDecision.routeId,
                routeDefinitionDigest: routingDecision.routeDefinitionDigest,
                routeRegistryId: routingDecision.routeRegistryId,
                routeRegistryDigest: routingDecision.routeRegistryDigest,
                routeRegistryVersion: routingDecision.routeRegistryVersion,
                routingConfigurationDigest:
                  routingDecision.routingConfigurationDigest,
                routingDecisionDigest: digestStructuredValue(routingDecision),
              },
            }),
        scope: context.scope,
        toolAuthority: "none",
      });
      const maximumOutputBytes = Math.min(
        this.#maximumOutputBytes,
        selected.capability.maximumOutputBytes,
      );
      const maximumOutputTokens = Math.min(
        selected.capability.maximumOutputTokens,
        routingDecision?.maximumOutputTokens ??
          selected.capability.maximumOutputTokens,
      );
      const promptCachePolicy =
        routingDecision?.promptCachePolicy ??
        ({
          cacheKeyRequired: false,
          enabled: false,
          maximumCheckpoints: 0,
          minimumCheckpointTokens: 0,
        } as const);
      const promptCacheKey = promptCachePolicy.enabled
        ? (() => {
            if (routingDecision === undefined) {
              throw new ModelGatewayError(
                "model-gateway.prompt-cache-key-mismatch",
                "Prompt caching requires complete trusted routing provenance.",
              );
            }
            const catalogScopeDigest = requestCatalogScopeDigest(
              sanitized.data,
            );
            const responseSchemaDigest = digestStructuredValue({
              inputSchema: responseTool.inputSchema,
              schemaId: responseTool.schemaId,
            });
            const cacheKeyInput = modelCacheKeyInputV1Schema.parse({
              cacheScope: "organization",
              capabilityDigest: selected.capability.capabilityDigest,
              capabilityRegistryDigest:
                selected.capability.capabilityRegistryDigest,
              capabilityVersion: selected.capability.capabilityVersion,
              catalogScopeDigest,
              contentDigests: [
                inputDigest,
                prompt.digest,
                catalogScopeDigest,
                responseSchemaDigest,
              ],
              dataResidencyBoundary: selected.capability.dataResidencyBoundary,
              evaluationResultDigest:
                selected.capability.evaluation.resultDigest,
              evaluationResultVersion:
                selected.capability.evaluation.resultVersion,
              ...(selected.capability.inferenceProfileId === undefined
                ? {}
                : {
                    inferenceProfileId: selected.capability.inferenceProfileId,
                  }),
              inputDigest,
              modelConfigurationReference:
                selected.capability.modelConfigurationReference,
              modelId: selected.capability.modelId,
              modelVersion: selected.capability.modelVersion,
              organizationId: context.scope.organizationId,
              organizationSafePolicyScope:
                "cloudmarkup.prompt-cache.organization.v1",
              promptDigest: prompt.digest,
              promptTemplateId: prompt.templateId,
              promptTemplateVersion: prompt.version,
              providerId: selected.profile.providerId,
              responseSchemaDigest,
              responseSchemaId: responseTool.schemaId,
              routeDefinitionDigest: routingDecision.routeDefinitionDigest,
              routeRegistryDigest: routingDecision.routeRegistryDigest,
              routingConfigurationDigest:
                routingDecision.routingConfigurationDigest,
            });
            return Object.freeze({
              digest: digestStructuredValue(cacheKeyInput),
              input: cacheKeyInput,
            });
          })()
        : undefined;
      if (
        promptCachePolicy.enabled !== (promptCacheKey !== undefined) ||
        (promptCacheKey !== undefined &&
          (promptCacheKey.input.organizationId !==
            context.scope.organizationId ||
            promptCacheKey.input.cacheScope !== "organization" ||
            promptCacheKey.digest !==
              digestStructuredValue(promptCacheKey.input)))
      ) {
        throw new ModelGatewayError(
          "model-gateway.prompt-cache-key-mismatch",
          "Enabled prompt caching requires the exact trusted organization-scoped key.",
        );
      }
      const attemptLimit = Math.min(
        this.#maximumAttempts,
        selected.capability.maximumAttempts,
        routingDecision?.maximumAttempts ?? Number.POSITIVE_INFINITY,
      );
      const timeoutMilliseconds = Math.min(
        selected.capability.timeoutMilliseconds,
        routingDecision?.timeoutMilliseconds ?? Number.POSITIVE_INFINITY,
      );
      let providerResult: ModelProviderResultV1 | undefined;
      let completedAttemptNumber = 0;
      let completedAttemptStartedAtMilliseconds = 0;
      const recordAttemptUsage = async (input: {
        readonly attemptNumber: number;
        readonly completedAtMilliseconds: number;
        readonly providerUsage: ModelProviderUsageV1 | undefined;
        readonly result: NormalizedModelUsageV1["result"];
        readonly startedAtMilliseconds: number;
      }): Promise<NormalizedModelUsageV1> => {
        assertExpectedProviderUsageFields(
          selected.capability,
          input.providerUsage,
        );
        if (
          !promptCachePolicy.enabled &&
          (input.providerUsage.cacheReadUnits !== "0" ||
            input.providerUsage.cacheWriteUnits !== "0")
        ) {
          throw new ModelGatewayError(
            "model-gateway.invalid-usage",
            "Provider cache usage requires the exact authorized prompt-cache key.",
          );
        }
        const usage = normalizeUsage(
          descriptor,
          input.providerUsage,
          input.result,
          input,
        );
        try {
          await this.#dependencies.usageRecorder.record(usage);
        } catch {
          this.#dependencies.logger.write({
            attempt: input.attemptNumber,
            feature: descriptor.feature,
            inputDigest,
            invocationId: descriptor.invocationId,
            providerId: descriptor.providerId,
            result: "metering-failed",
            safeCode: "model-gateway.metering-failed",
          });
          throw new ModelGatewayError(
            "model-gateway.metering-failed",
            "Normalized model usage could not be recorded.",
          );
        }
        return usage;
      };
      const providerInvocation: ModelProviderInvocationV1 = {
        descriptor,
        maximumOutputBytes,
        maximumOutputTokens,
        prompt,
        ...(promptCacheKey === undefined ? {} : { promptCacheKey }),
        promptCachePolicy,
        request: sanitized.data,
        responseTool,
        timeoutMilliseconds,
      };
      for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
        if (livePreparation !== undefined) {
          const current = await this.#authorizeLive({
            phase: "dispatch",
            request: sanitized.data,
            context,
            routingConfigurationDigest,
            invocation: providerInvocation,
          });
          if (
            livePreparationDigest(current) !==
            livePreparationDigest(livePreparation)
          )
            throw new ModelGatewayError(
              "model-gateway.live-authority-required",
              "The live evaluation authority changed before provider entry.",
            );
        }
        throwIfCanceled(signal);
        terminalAttemptNumber = attempt;
        const attemptStartedAtMilliseconds = Date.now();
        this.#dependencies.logger.write({
          attempt,
          feature: descriptor.feature,
          inputDigest,
          invocationId: descriptor.invocationId,
          providerId: descriptor.providerId,
          result: "started",
        });
        try {
          providerResult = await adapter.invoke(providerInvocation, signal);
          completedAttemptNumber = attempt;
          completedAttemptStartedAtMilliseconds = attemptStartedAtMilliseconds;
          break;
        } catch (error) {
          if (signal?.aborted === true) {
            if (!(error instanceof ModelProviderInvocationError)) {
              throw new ModelGatewayError(
                "model-gateway.missing-usage",
                "A started provider attempt must settle with exact cancellation usage evidence.",
              );
            }
            await recordAttemptUsage({
              attemptNumber: attempt,
              completedAtMilliseconds: Date.now(),
              providerUsage: error.usage,
              result: "canceled",
              startedAtMilliseconds: attemptStartedAtMilliseconds,
            });
            throwIfCanceled(signal);
          }
          if (error instanceof ModelProviderInvocationError) {
            await recordAttemptUsage({
              attemptNumber: attempt,
              completedAtMilliseconds: Date.now(),
              providerUsage: error.usage,
              result: "provider-error",
              startedAtMilliseconds: attemptStartedAtMilliseconds,
            });
            if (
              error.classification === "transient" &&
              attempt < attemptLimit
            ) {
              this.#dependencies.logger.write({
                attempt,
                feature: descriptor.feature,
                inputDigest,
                invocationId: descriptor.invocationId,
                providerId: descriptor.providerId,
                result: "retrying",
                safeCode: error.safeCode,
              });
              if (selected.profile.providerFamily === "amazon-bedrock") {
                await (this.#dependencies.retryDelay ?? boundedRetryDelay)({
                  attemptNumber: attempt,
                  maximumDelayMilliseconds: 1_000,
                  ...(signal === undefined ? {} : { signal }),
                });
              }
              continue;
            }
            this.#dependencies.logger.write({
              attempt,
              feature: descriptor.feature,
              inputDigest,
              invocationId: descriptor.invocationId,
              providerId: descriptor.providerId,
              result: "provider-error",
              safeCode: error.safeCode,
            });
          }
          if (!(error instanceof ModelProviderInvocationError)) {
            throw new ModelGatewayError(
              "model-gateway.missing-usage",
              "A started provider attempt must settle with exact technical usage evidence.",
            );
          }
          throw error;
        }
      }
      if (providerResult === undefined) {
        throw new ModelGatewayError(
          "model-gateway.provider-error",
          "The model provider did not return a result.",
        );
      }
      const completedProviderResult = providerResult;
      const recordCancellationUsage = async (): Promise<void> => {
        if (signal?.aborted !== true) return;
        await recordAttemptUsage({
          attemptNumber: completedAttemptNumber,
          completedAtMilliseconds: Date.now(),
          providerUsage: completedProviderResult.usage,
          result: "canceled",
          startedAtMilliseconds: completedAttemptStartedAtMilliseconds,
        });
        throwIfCanceled(signal);
      };
      await recordCancellationUsage();
      let response: ModelGatewayResponseV1;
      try {
        let outputBytes: number;
        try {
          outputBytes = serializedByteLength(providerResult.content);
        } catch {
          throw new ModelGatewayError(
            "model-gateway.invalid-output",
            "The model provider returned non-serializable output.",
          );
        }
        if (outputBytes > maximumOutputBytes) {
          throw new ModelGatewayError(
            "model-gateway.output-too-large",
            "The model provider output exceeds the bounded response limit.",
          );
        }
        const toolResponse = parseModelResponseToolContentV1({
          content: providerResult.content,
          operation: sanitized.data.operation,
        });
        const parsedResponse =
          modelGatewayResponseV1Schema.safeParse(toolResponse);
        if (!parsedResponse.success)
          throw new ModelGatewayError(
            "model-gateway.invalid-output",
            "The response tool input does not match the strict v1 response schema.",
          );
        validateModelResponseAuthority({
          allowedApprovalPathIds: this.#allowedApprovalPathIds,
          descriptor,
          request: sanitized.data,
          response: parsedResponse.data,
        });
        response = parsedResponse.data;
      } catch (error) {
        if (
          (sanitized.data.operation === "operations.propose" &&
            sanitized.data.planningContext !== undefined) ||
          sanitized.data.operation === "application-source.generate" ||
          sanitized.data.operation === "iac-extension.generate" ||
          sanitized.data.operation === "candidate.repair"
        ) {
          const safe = safeError(error);
          let proposalCanonicalJson: string;
          let proposalDigest: ReturnType<typeof digestStructuredValue>;
          try {
            const rawCanonicalJson = serializeCanonicalJson(
              providerResult.content,
            );
            proposalDigest = digestStructuredValue(providerResult.content);
            proposalCanonicalJson =
              new TextEncoder().encode(rawCanonicalJson).byteLength <=
              maximumOutputBytes
                ? rawCanonicalJson
                : serializeCanonicalJson({
                    preservation: "digest-only-oversized-output",
                    proposalDigest,
                  });
          } catch {
            proposalCanonicalJson = serializeCanonicalJson({
              preservation: "non-serializable-output",
            });
            proposalDigest = digestStructuredValue({
              invocationId: descriptor.invocationId,
              preservation: "non-serializable-output",
            });
          }
          await this.#dependencies.invalidProposalStore.preserveRestricted({
            classification: "restricted-model-proposal",
            diagnostics: [
              {
                code: safe.code,
                message: safe.message,
                path: "$.providerOutput",
              },
            ],
            invocationId: descriptor.invocationId,
            organizationId: context.scope.organizationId,
            ...(context.scope.projectId === undefined
              ? {}
              : { projectId: context.scope.projectId }),
            proposalCanonicalJson,
            proposalDigest,
            retentionPolicyId: "cloudmarkup.invalid-model-proposal.v1",
          });
        }
        await recordAttemptUsage({
          attemptNumber: completedAttemptNumber,
          completedAtMilliseconds: Date.now(),
          providerUsage: providerResult.usage,
          result: "invalid-output",
          startedAtMilliseconds: completedAttemptStartedAtMilliseconds,
        });
        throw error;
      }
      await recordCancellationUsage();
      const usage = await recordAttemptUsage({
        attemptNumber: completedAttemptNumber,
        completedAtMilliseconds: Date.now(),
        providerUsage: providerResult.usage,
        result: "succeeded",
        startedAtMilliseconds: completedAttemptStartedAtMilliseconds,
      });
      const result: ModelGatewayResultV1 = {
        descriptor,
        redaction: redacted.summary,
        response,
        usage,
      };
      await this.#dependencies.invocationStore.complete(claim, result);
      this.#dependencies.logger.write({
        attempt: completedAttemptNumber,
        feature: descriptor.feature,
        inputDigest,
        invocationId: descriptor.invocationId,
        outputDigest: digestStructuredValue(response),
        providerId: descriptor.providerId,
        result: "succeeded",
      });
      return result as unknown as ModelGatewayResultV1<TOperation>;
    } catch (error) {
      const safe = safeError(error);
      await this.#dependencies.invocationStore.fail(claim, safe.code);
      this.#dependencies.logger.write({
        attempt: terminalAttemptNumber,
        feature: parsed.data.operation,
        inputDigest,
        invocationId: context.invocationId,
        result:
          safe.code === "model-gateway.canceled"
            ? "canceled"
            : safe.code.includes("provider")
              ? "provider-error"
              : "rejected",
        safeCode: safe.code,
      });
      throw new ModelGatewayError(safe.code, safe.message);
    }
  }

  public extractIntent(
    request: ModelRequestFor<"intent.extract">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public generateBlockingQuestions(
    request: ModelRequestFor<"requirements.blocking-questions">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public proposeArchitecture(
    request: ModelRequestFor<"architecture.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public proposeWorkload(
    request: ModelRequestFor<"workload.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public proposeExternalResources(
    request: ModelRequestFor<"external-resource.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public proposeOperations(
    request: ModelRequestFor<"operations.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public interpretRepositoryEvidence(
    request: ModelRequestFor<"repository.interpret">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public explainIssue(
    request: ModelRequestFor<"issue.explain">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public explainDeterministicFix(
    request: ModelRequestFor<"deterministic-fix.explain">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public proposeFix(
    request: ModelRequestFor<"fix.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public generateApplicationSourceCandidate(
    request: ModelRequestFor<"application-source.generate">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public generateIacExtensionCandidate(
    request: ModelRequestFor<"iac-extension.generate">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public repairCandidate(
    request: ModelRequestFor<"candidate.repair">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public summarizePlainLanguage(
    request: ModelRequestFor<"summary.plain-language">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }

  public summarizeTechnical(
    request: ModelRequestFor<"summary.technical">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ) {
    return this.invoke(request, context, signal);
  }
}

export function assertNoModelTools(
  invocation: Readonly<Record<string, unknown>>,
): void {
  for (const forbidden of [
    "tools",
    "toolChoice",
    "urlRetriever",
    "shell",
    "filesystem",
    "compiler",
    "deployment",
    "billing",
    "payment",
  ]) {
    if (forbidden in invocation) {
      throw new ModelGatewayError(
        "model-gateway.tool-authority-denied",
        "Model invocations cannot contain tool authority.",
      );
    }
  }
}

/** Normal V1 gateway: its constructor cannot opt into candidate evaluation. */
export class ProviderNeutralModelGateway extends ModelGatewayEngine {
  public constructor(dependencies: ProviderNeutralModelGatewayDependencies) {
    super(dependencies);
  }
}

/** Explicit V2 host composition, using the same journal, usage normalization,
 * strict response checks and provider engine as V1. Never normal activation. */
export function createModelLiveEvaluationGatewayV2(
  dependencies: Omit<
    ProviderNeutralModelGatewayDependencies,
    "routingDecisionEvaluator" | "maximumAttempts"
  > & {
    readonly liveAuthority: ModelLiveGatewayAuthorityV2;
  },
): ModelGateway {
  const { liveAuthority, ...shared } = dependencies;
  if (!hasLiveAuthority(liveAuthority))
    throw new ModelGatewayError(
      "model-gateway.live-authority-required",
      "The explicit live gateway requires host authentication.",
    );
  return new ModelGatewayEngine(
    { ...shared, maximumAttempts: 1 },
    liveAuthority,
  );
}

export function isModelGatewayResponseFor<
  TOperation extends ModelGatewayOperationV1,
>(
  operation: TOperation,
  response: ModelGatewayResponseV1,
): response is ModelResponseFor<TOperation> {
  return response.operation === operation;
}
