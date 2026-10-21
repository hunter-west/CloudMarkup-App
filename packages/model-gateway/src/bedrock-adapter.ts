import { parseHostRepairSuccessorInvocationV4 } from "./host-repair-successor-binding.js";
import { resolveReviewedHostSeedRepairPromptV3 } from "./prompts/host-seed-patch-repair.js";
import { reviewedHostSeedRepairPromptV2 } from "./prompts/host-seed-repair.js";
import {
  modelHostSeedRepairRequestV2Schema,
  modelHostRepairSuccessorRequestV3Schema,
  modelInvocationDescriptorV1Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveSeedRoutingDecisionV3Schema,
} from "@cloudmarkup/schemas";
import { digestStructuredValue } from "./security.js";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type BedrockRuntimeClientConfig,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  type ConverseStreamCommandOutput,
  type ConverseStreamOutput,
  type TokenUsage,
} from "@aws-sdk/client-bedrock-runtime";

import type {
  AmazonBedrockCapabilityProfileV1,
  ModelProviderAdapter,
  ModelProviderInvocationV1,
  ModelProviderHostSeedInvocationV2,
  ModelProviderHostSeedInvocationV3,
  ModelProviderHostRepairSuccessorInvocationV4,
  ModelProviderResultV1,
  ModelProviderUsageV1,
} from "./ports.js";
import { ModelProviderInvocationError } from "./ports.js";

const textEncoder = new TextEncoder();
const BEDROCK_PROVIDER_ID = "cloudmarkup.amazon-bedrock";

export type BedrockInvocationTransportV1 = "converse" | "converse-stream";

export interface BedrockRuntimeRouteV1 {
  /** Explicit reviewed adaptive mode; omitted preserves legacy provider defaults. */
  readonly thinkingMode?: "adaptive";
  /** Adaptive 4.6 requests use automatic selection; output remains strictly validated. */
  readonly toolChoiceMode?: "auto" | undefined;
  readonly enabled: boolean;
  /** Exact model or inference-profile identifier supplied to Converse. */
  readonly invocationTarget: string;
  readonly modelConfigurationReference: string;
  readonly nativeStructuredOutputSupported: boolean;
  readonly region: string;
  readonly supportedRegions: readonly string[];
  readonly transport: BedrockInvocationTransportV1;
}

export interface BedrockRuntimeClientLikeV1 {
  send(
    command: ConverseCommand | ConverseStreamCommand,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

export interface BedrockModelProviderAdapterDependenciesV1 {
  readonly client?: BedrockRuntimeClientLikeV1;
  /** Host-owned final transport. Mutually exclusive with an opaque client so
   * spending authority cannot be silently bypassed by client substitution. */
  readonly requestHandler?: BedrockFinalHttpHandlerV1;
  readonly profile: AmazonBedrockCapabilityProfileV1;
  readonly routes: readonly BedrockRuntimeRouteV1[];
}

export type BedrockFinalHttpHandlerV1 = Extract<
  NonNullable<BedrockRuntimeClientConfig["requestHandler"]>,
  { handle: unknown }
>;

export class BedrockModelProviderConfigurationError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "BedrockModelProviderConfigurationError";
    this.code = code;
  }
}

function safeConfigurationError(code: string): never {
  throw new BedrockModelProviderConfigurationError(
    code,
    "The Bedrock Runtime adapter configuration is unavailable or contradictory.",
  );
}

function validateRoutes(
  profile: AmazonBedrockCapabilityProfileV1,
  routes: readonly BedrockRuntimeRouteV1[],
): void {
  if (!profile.enabled || profile.providerId !== BEDROCK_PROVIDER_ID)
    safeConfigurationError("model-provider.configuration-disabled");
  if (routes.length === 0)
    safeConfigurationError("model-provider.configuration-empty");
  const references = new Set<string>();
  for (const route of routes) {
    if (
      references.has(route.modelConfigurationReference) ||
      route.invocationTarget.trim().length === 0 ||
      route.region.trim().length === 0 ||
      !route.supportedRegions.includes(route.region)
    ) {
      safeConfigurationError("model-provider.configuration-invalid");
    }
    if (
      route.toolChoiceMode === "auto" &&
      (route.nativeStructuredOutputSupported ||
        route.thinkingMode !== "adaptive")
    )
      safeConfigurationError("model-provider.configuration-contradiction");
    const capability = profile.capabilities.find(
      (candidate) =>
        candidate.modelConfigurationReference ===
        route.modelConfigurationReference,
    );
    if (
      capability === undefined ||
      (capability.structuredOutput === "native-json-schema") !==
        route.nativeStructuredOutputSupported ||
      (route.transport === "converse-stream" && !capability.streamingSupported)
    ) {
      safeConfigurationError("model-provider.configuration-contradiction");
    }
    const descriptorTarget =
      capability.inferenceProfileId ?? capability.modelId;
    if (descriptorTarget !== route.invocationTarget)
      safeConfigurationError("model-provider.configuration-target-mismatch");
    references.add(route.modelConfigurationReference);
  }
}

function jsonByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

const supportedJsonSchemaKeywords = new Set([
  "$defs",
  "$id",
  "$ref",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "default",
  "description",
  "enum",
  "items",
  "oneOf",
  "properties",
  "required",
  "title",
  "type",
]);

/**
 * Bedrock Structured Outputs accepts a JSON Schema subset. CloudMarkup sends a
 * conservative provider schema and still validates the original strict schema
 * after the response, so provider compatibility cannot weaken trust.
 */
export function toBedrockStructuredOutputSchemaV1(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const visit = (input: unknown, inProperties = false): unknown => {
    if (Array.isArray(input)) return input.map((item) => visit(item));
    if (input === null || typeof input !== "object") return input;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input)) {
      if (inProperties || supportedJsonSchemaKeywords.has(key)) {
        output[key] = visit(child, key === "properties" || key === "$defs");
      }
    }
    return output;
  };
  return Object.freeze(visit(value) as Record<string, unknown>);
}

type ProjectedInvocation =
  | ModelProviderInvocationV1
  | ModelProviderHostSeedInvocationV2
  | ModelProviderHostSeedInvocationV3
  | ModelProviderHostRepairSuccessorInvocationV4;

function providerEnvelope(invocation: ProjectedInvocation): string {
  return JSON.stringify({
    operation: invocation.request.operation,
    request: invocation.request,
    requiredProvenance: {
      inputDigest: invocation.descriptor.inputDigest,
      invocationId: invocation.descriptor.invocationId,
      modelId: invocation.descriptor.modelId,
      modelVersion: invocation.descriptor.modelVersion,
      promptDigest: invocation.descriptor.promptDigest,
      promptTemplateId: invocation.descriptor.promptTemplateId,
      promptVersion: invocation.descriptor.promptVersion,
      providerId: invocation.descriptor.providerId,
    },
    responseChannel: {
      authority: "none",
      schemaId: invocation.responseTool.schemaId,
      toolName: invocation.responseTool.toolName,
    },
  });
}

function safeRequestMetadata(
  invocation: ProjectedInvocation,
): Readonly<Record<string, string>> {
  return Object.freeze({
    application: "cloudmarkup",
    feature: invocation.descriptor.feature,
    invocation_id: invocation.descriptor.invocationId,
    ...(invocation.descriptor.scope.jobId === undefined
      ? {}
      : { job_id: invocation.descriptor.scope.jobId }),
    prompt_version: invocation.descriptor.promptVersion,
    route_id: invocation.descriptor.routing?.routeId ?? "unrouted",
  });
}

/** Shared pure transport projection for host cost admission and SDK dispatch.
 * Change this version when adding billable request features or framing. */
export const BEDROCK_CONVERSE_REQUEST_VERSION_V1 = "1.1.0";

function requireV1RequestVersion(value: unknown): void {
  if (value !== 1)
    safeConfigurationError("model-provider.request-version-unavailable");
}

export function buildBedrockConverseRequestV1(
  invocation: ModelProviderInvocationV1,
  route: BedrockRuntimeRouteV1,
): ConverseCommandInput {
  requireV1RequestVersion(invocation.request.contractVersion);
  return projectBedrockConverseRequest(invocation, route);
}

/** Explicit V2 input projection using unchanged Converse framing. Pure data
 * projection only; current seed/sequence, runtime and commercial authority must
 * be authenticated independently before CountTokens or inference. */
export function buildBedrockHostSeedConverseRequestV2(
  input: ModelProviderHostSeedInvocationV2,
  route: BedrockRuntimeRouteV1,
): ConverseCommandInput {
  return projectBedrockConverseRequest(parseHostSeedInvocation(input), route);
}

function parseHostSeedInvocation(
  input: ModelProviderHostSeedInvocationV2,
): ModelProviderHostSeedInvocationV2 {
  try {
    const cloned = structuredClone(input);
    const invocation = {
      ...cloned,
      request: modelHostSeedRepairRequestV2Schema.parse(cloned.request),
      descriptor: modelInvocationDescriptorV1Schema.parse(cloned.descriptor),
    };
    assertHostSeedInvocationBindings(invocation);
    return invocation;
  } catch {
    return safeConfigurationError("model-provider.host-seed-binding-invalid");
  }
}

/** Explicit V3 static descriptor, with unchanged wire framing and no inference. */
export function buildBedrockHostSeedConverseRequestV3(
  input: ModelProviderHostSeedInvocationV3,
  route: BedrockRuntimeRouteV1,
): ConverseCommandInput {
  return projectBedrockConverseRequest(parseHostSeedInvocationV3(input), route);
}
/** Same wire framing for the explicitly distinct final repair input. */
export function buildBedrockHostRepairSuccessorConverseRequestV4(
  input: ModelProviderHostRepairSuccessorInvocationV4,
  route: BedrockRuntimeRouteV1,
): ConverseCommandInput {
  return projectBedrockConverseRequest(
    parseHostRepairSuccessorInvocationV4(input),
    route,
  );
}
function parseHostSeedInvocationV3(
  input: ModelProviderHostSeedInvocationV3,
): ModelProviderHostSeedInvocationV3 {
  try {
    const cloned = structuredClone(input);
    if (Object.hasOwn(cloned, "promptCacheKey"))
      safeConfigurationError("model-provider.host-seed-binding-invalid");
    const invocation = {
      ...cloned,
      request: modelHostSeedRepairRequestV2Schema.parse(cloned.request),
      descriptor: modelLiveSeedInvocationDescriptorV3Schema.parse(
        cloned.descriptor,
      ),
      promptCachePolicy:
        modelLiveSeedRoutingDecisionV3Schema.shape.promptCachePolicy.parse(
          cloned.promptCachePolicy,
        ),
    };
    assertHostSeedInvocationBindings(invocation);
    return invocation;
  } catch {
    return safeConfigurationError("model-provider.host-seed-binding-invalid");
  }
}
function assertHostSeedInvocationBindings(
  invocation:
    ModelProviderHostSeedInvocationV2 | ModelProviderHostSeedInvocationV3,
): void {
  const descriptor = invocation.descriptor;
  const prompt =
    descriptor.contractVersion === 3
      ? resolveReviewedHostSeedRepairPromptV3(descriptor)
      : reviewedHostSeedRepairPromptV2;
  if (
    prompt === null ||
    digestStructuredValue(invocation.prompt) !==
      digestStructuredValue(prompt) ||
    descriptor.feature !== "candidate.repair" ||
    descriptor.role !== "repair-escalation" ||
    descriptor.inputDigest !==
      digestStructuredValue({
        request: invocation.request,
        scope: descriptor.scope,
      }) ||
    descriptor.requestedMode !== invocation.request.requestedMode ||
    descriptor.promptDigest !== invocation.prompt.digest ||
    descriptor.promptTemplateId !== invocation.prompt.templateId ||
    descriptor.promptVersion !== invocation.prompt.version ||
    invocation.responseTool.operation !== "candidate.repair"
  )
    safeConfigurationError("model-provider.host-seed-binding-invalid");
}

function projectBedrockConverseRequest(
  invocation: ProjectedInvocation,
  route: BedrockRuntimeRouteV1,
): ConverseCommandInput {
  const schema = route.nativeStructuredOutputSupported
    ? toBedrockStructuredOutputSchemaV1(invocation.responseTool.inputSchema)
    : invocation.responseTool.inputSchema;
  const system: ConverseCommandInput["system"] = [
    { text: invocation.prompt.content },
    ...(invocation.promptCachePolicy.enabled
      ? [{ cachePoint: { type: "default" as const } }]
      : []),
  ];
  const base = {
    ...(route.thinkingMode === "adaptive"
      ? { additionalModelRequestFields: { thinking: { type: "adaptive" } } }
      : {}),
    inferenceConfig: { maxTokens: invocation.maximumOutputTokens },
    messages: [
      {
        content: [{ text: providerEnvelope(invocation) }],
        role: "user" as const,
      },
    ],
    modelId: route.invocationTarget,
    outputConfig: { effort: invocation.descriptor.routing?.effort ?? "medium" },
    requestMetadata: safeRequestMetadata(invocation),
    system,
  } satisfies ConverseCommandInput;
  if (route.nativeStructuredOutputSupported) {
    return {
      ...base,
      outputConfig: {
        ...base.outputConfig,
        textFormat: {
          structure: {
            jsonSchema: {
              description:
                "Strict CloudMarkup response proposal; no tool authority.",
              name: invocation.responseTool.toolName,
              schema: JSON.stringify(schema),
            },
          },
          type: "json_schema",
        },
      },
    };
  }
  return {
    ...base,
    toolConfig: {
      toolChoice:
        route.toolChoiceMode === "auto"
          ? { auto: {} }
          : { tool: { name: invocation.responseTool.toolName } },
      tools: [
        {
          toolSpec: {
            description: "Return the strict CloudMarkup proposal only.",
            inputSchema: { json: schema as never },
            name: invocation.responseTool.toolName,
            // Strict tool use is Bedrock Structured Outputs, not ordinary tool
            // transport. Unsupported routes retain strict local validation.
          },
        },
      ],
    },
  };
}

function exactUnit(value: number | undefined): string | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : undefined;
}

function normalizeUsage(
  usage: TokenUsage | undefined,
  providerRequestId: string | undefined,
): ModelProviderUsageV1 | undefined {
  if (usage === undefined) return undefined;
  const inputUnits = exactUnit(usage.inputTokens);
  const outputUnits = exactUnit(usage.outputTokens);
  const totalUnits = exactUnit(usage.totalTokens);
  const cacheReadUnits = exactUnit(usage.cacheReadInputTokens ?? 0);
  const cacheWriteUnits = exactUnit(usage.cacheWriteInputTokens ?? 0);
  if (
    inputUnits === undefined ||
    outputUnits === undefined ||
    totalUnits === undefined ||
    cacheReadUnits === undefined ||
    cacheWriteUnits === undefined ||
    BigInt(totalUnits) !== BigInt(inputUnits) + BigInt(outputUnits)
  ) {
    throw new ModelProviderInvocationError({
      classification: "permanent",
      safeCode: "model-provider.invalid-usage",
      safeMessage: "invalid",
    });
  }
  return {
    cacheReadUnits,
    cacheWriteUnits,
    inputUnits,
    outputUnits,
    ...(providerRequestId === undefined ? {} : { providerRequestId }),
    // Bedrock TokenUsage does not expose a separate reasoning-token field.
    thinkingUnits: "0",
  };
}

function optionalUsage(
  usage: TokenUsage | undefined,
  providerRequestId: string | undefined,
): { readonly usage?: ModelProviderUsageV1 } {
  const normalized = normalizeUsage(usage, providerRequestId);
  return normalized === undefined ? {} : { usage: normalized };
}

function responseContent(
  output: ConverseCommandOutput,
  invocation: ProjectedInvocation,
  native: boolean,
): ModelProviderResultV1["content"] {
  const blocks = output.output?.message?.content ?? [];
  if (
    output.stopReason !== undefined &&
    output.stopReason !== (native ? "end_turn" : "tool_use")
  )
    throw new ModelProviderInvocationError({
      classification: "permanent",
      safeCode: "model-provider.permanent",
      safeMessage: "incomplete output",
      ...optionalUsage(output.usage, output.$metadata.requestId),
    });
  const toolBlocks = blocks.filter(
    (block): block is ContentBlock.ToolUseMember => block.toolUse !== undefined,
  );
  if (native) {
    const textBlocks = blocks.filter(
      (block): block is ContentBlock.TextMember => block.text !== undefined,
    );
    const textBlock = textBlocks[0];
    if (
      textBlocks.length !== 1 ||
      textBlock === undefined ||
      toolBlocks.length !== 0 ||
      jsonByteLength(textBlock.text) > invocation.maximumOutputBytes
    )
      throw new ModelProviderInvocationError({
        classification: "permanent",
        safeCode: "model-provider.permanent",
        safeMessage: "invalid output",
        ...optionalUsage(output.usage, output.$metadata.requestId),
      });
    let input: unknown;
    try {
      input = JSON.parse(textBlock.text);
    } catch {
      throw new ModelProviderInvocationError({
        classification: "permanent",
        safeCode: "model-provider.permanent",
        safeMessage: "invalid output",
        ...optionalUsage(output.usage, output.$metadata.requestId),
      });
    }
    return {
      input,
      kind: "tool-use",
      toolName: invocation.responseTool.toolName,
    };
  }
  const toolBlock = toolBlocks[0];
  if (
    toolBlocks.length !== 1 ||
    toolBlock?.toolUse.name !== invocation.responseTool.toolName ||
    jsonByteLength(JSON.stringify(toolBlock.toolUse.input)) >
      invocation.maximumOutputBytes
  )
    throw new ModelProviderInvocationError({
      classification: "permanent",
      safeCode: "model-provider.permanent",
      safeMessage: "invalid output",
      ...optionalUsage(output.usage, output.$metadata.requestId),
    });
  return {
    input: toolBlock.toolUse.input,
    kind: "tool-use",
    toolName: invocation.responseTool.toolName,
  };
}

function streamFailure(
  event: ConverseStreamOutput,
): ModelProviderInvocationError | undefined {
  if (event.throttlingException !== undefined)
    return new ModelProviderInvocationError({
      classification: "transient",
      safeCode: "model-provider.throttled",
      safeMessage: "stream throttled",
    });
  if (event.validationException !== undefined)
    return new ModelProviderInvocationError({
      classification: "permanent",
      safeCode: "model-provider.permanent",
      safeMessage: "stream rejected",
    });
  if (
    event.internalServerException !== undefined ||
    event.modelStreamErrorException !== undefined ||
    event.serviceUnavailableException !== undefined
  )
    return new ModelProviderInvocationError({
      classification: "transient",
      safeCode: "model-provider.retryable",
      safeMessage: "stream unavailable",
    });
  return undefined;
}

async function consumeStream(
  output: ConverseStreamCommandOutput,
  invocation: ProjectedInvocation,
  native: boolean,
): Promise<ModelProviderResultV1> {
  if (output.stream === undefined)
    throw new ModelProviderInvocationError({
      classification: "transient",
      safeCode: "model-provider.temporary",
      safeMessage: "missing stream",
    });
  let text = "";
  let toolName: string | undefined;
  let toolBlockIndex: number | undefined;
  let textBlockIndex: number | undefined;
  let toolInput = "";
  let usage: TokenUsage | undefined;
  let stopReason: string | undefined;
  const invalidOutput = (): never => {
    throw new ModelProviderInvocationError({
      classification: "permanent",
      safeCode: "model-provider.permanent",
      safeMessage: "invalid output",
      ...optionalUsage(usage, output.$metadata.requestId),
    });
  };
  for await (const event of output.stream) {
    const failure = streamFailure(event);
    if (failure !== undefined) throw failure;
    if (event.metadata?.usage !== undefined) usage = event.metadata.usage;
    if (event.messageStop !== undefined)
      stopReason = event.messageStop.stopReason;
    if (event.contentBlockStart?.start?.toolUse !== undefined) {
      if (
        native ||
        toolName !== undefined ||
        event.contentBlockStart.start.toolUse.name !==
          invocation.responseTool.toolName
      )
        invalidOutput();
      toolName = event.contentBlockStart.start.toolUse.name;
      toolBlockIndex = event.contentBlockStart.contentBlockIndex;
    }
    const delta = event.contentBlockDelta?.delta;
    if (delta?.text !== undefined) {
      const index = event.contentBlockDelta?.contentBlockIndex;
      if (native && textBlockIndex !== undefined && textBlockIndex !== index)
        invalidOutput();
      textBlockIndex = index;
      text += delta.text;
    }
    if (delta?.toolUse?.input !== undefined) {
      if (
        native ||
        toolName === undefined ||
        event.contentBlockDelta?.contentBlockIndex !== toolBlockIndex
      )
        invalidOutput();
      toolInput += delta.toolUse.input;
    }
    if (
      jsonByteLength(text) > invocation.maximumOutputBytes ||
      jsonByteLength(toolInput) > invocation.maximumOutputBytes
    ) {
      throw new ModelProviderInvocationError({
        classification: "permanent",
        safeCode: "model-provider.permanent",
        safeMessage: "output exceeded limit",
        ...optionalUsage(usage, output.$metadata.requestId),
      });
    }
  }
  if (
    (stopReason !== undefined &&
      stopReason !== (native ? "end_turn" : "tool_use")) ||
    (!native && toolName !== invocation.responseTool.toolName)
  )
    invalidOutput();
  let parsed: unknown;
  try {
    parsed = JSON.parse(native ? text : toolInput);
  } catch {
    throw new ModelProviderInvocationError({
      classification: "permanent",
      safeCode: "model-provider.permanent",
      safeMessage: "invalid output",
      ...optionalUsage(usage, output.$metadata.requestId),
    });
  }
  const normalizedUsage = normalizeUsage(usage, output.$metadata.requestId);
  return {
    content: {
      input: parsed,
      kind: "tool-use",
      toolName: native ? invocation.responseTool.toolName : (toolName ?? ""),
    },
    ...(normalizedUsage === undefined ? {} : { usage: normalizedUsage }),
  };
}

function classifyProviderError(
  error: unknown,
  timedOut: boolean,
  canceled: boolean,
): ModelProviderInvocationError {
  if (timedOut)
    return new ModelProviderInvocationError({
      classification: "transient",
      safeCode: "model-provider.timeout",
      safeMessage: "timeout",
    });
  if (canceled)
    return new ModelProviderInvocationError({
      classification: "permanent",
      safeCode: "model-provider.canceled",
      safeMessage: "canceled",
    });
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";
  if (name === "AccessDeniedException")
    return new ModelProviderInvocationError({
      classification: "permanent",
      safeCode: "model-provider.iam-denied",
      safeMessage: "denied",
    });
  if (name === "ThrottlingException")
    return new ModelProviderInvocationError({
      classification: "transient",
      safeCode: "model-provider.throttled",
      safeMessage: "throttled",
    });
  if (
    [
      "InternalServerException",
      "ModelNotReadyException",
      "ModelStreamErrorException",
      "ModelTimeoutException",
      "ServiceUnavailableException",
    ].includes(name)
  )
    return new ModelProviderInvocationError({
      classification: "transient",
      safeCode: "model-provider.retryable",
      safeMessage: "retryable",
    });
  return new ModelProviderInvocationError({
    classification: "permanent",
    safeCode: "model-provider.permanent",
    safeMessage: "permanent",
  });
}

export class BedrockModelProviderAdapter implements ModelProviderAdapter {
  public readonly profile: AmazonBedrockCapabilityProfileV1;
  readonly #client: BedrockRuntimeClientLikeV1;
  readonly #routes: ReadonlyMap<string, BedrockRuntimeRouteV1>;
  readonly #hasFinalHttpHandler: boolean;

  public constructor(dependencies: BedrockModelProviderAdapterDependenciesV1) {
    if (
      dependencies.client !== undefined &&
      dependencies.requestHandler !== undefined
    )
      safeConfigurationError("model-provider.configuration-transport-conflict");
    validateRoutes(dependencies.profile, dependencies.routes);
    this.#hasFinalHttpHandler = dependencies.requestHandler !== undefined;
    this.profile = dependencies.profile;
    this.#routes = new Map(
      dependencies.routes.map((route) => [
        route.modelConfigurationReference,
        Object.freeze({ ...route }),
      ]),
    );
    const regions = new Set(dependencies.routes.map((route) => route.region));
    if (regions.size !== 1)
      safeConfigurationError("model-provider.configuration-region-mismatch");
    const region = dependencies.routes[0]?.region;
    if (region === undefined)
      safeConfigurationError("model-provider.configuration-region-missing");
    this.#client =
      dependencies.client ??
      new BedrockRuntimeClient({
        maxAttempts: 1,
        region,
        ...(dependencies.requestHandler === undefined
          ? {}
          : { requestHandler: dependencies.requestHandler }),
      });
  }

  public async invoke(
    invocation: ModelProviderInvocationV1,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1> {
    requireV1RequestVersion(invocation.request.contractVersion);
    return this.#invoke(invocation, signal);
  }

  /** Explicit provider transport only. The trusted host must bind current seed,
   * stage, complete CountTokens and commercial authority in its final HTTP guard.
   * An opaque client cannot be used for this separately versioned path. */
  public async invokeHostSeedV2(
    input: ModelProviderHostSeedInvocationV2,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1> {
    if (!this.#hasFinalHttpHandler)
      safeConfigurationError("model-provider.host-seed-final-handler-required");
    const invocation = parseHostSeedInvocation(input);
    if (signal?.aborted) throw classifyProviderError(undefined, false, true);
    return this.#invoke(invocation, signal);
  }

  /** Explicit static first-seed transport. Current runtime, canonical credits and
   * platform spending must still be authenticated by the final HTTP handler. */
  public async invokeHostSeedV3(
    input: ModelProviderHostSeedInvocationV3,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1> {
    if (!this.#hasFinalHttpHandler)
      safeConfigurationError("model-provider.host-seed-final-handler-required");
    const invocation = parseHostSeedInvocationV3(input);
    if (signal?.aborted) throw classifyProviderError(undefined, false, true);
    return this.#invoke(invocation, signal);
  }

  /** The host-owned final HTTP handler must authenticate current second-stage
   * issuance, the single canonical reservation and platform spending. */
  public async invokeHostRepairSuccessorV4(
    input: ModelProviderHostRepairSuccessorInvocationV4,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1> {
    if (!this.#hasFinalHttpHandler)
      safeConfigurationError(
        "model-provider.repair-successor-final-handler-required",
      );
    const invocation = parseHostRepairSuccessorInvocationV4(input);
    if (signal?.aborted) throw classifyProviderError(undefined, false, true);
    return this.#invoke(invocation, signal);
  }

  async #invoke(
    invocation: ProjectedInvocation,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1> {
    const reference =
      invocation.descriptor.routing?.modelConfigurationReference;
    const route =
      reference === undefined ? undefined : this.#routes.get(reference);
    if (!route?.enabled)
      safeConfigurationError("model-provider.route-disabled");
    if (
      invocation.descriptor.providerFamily !== "amazon-bedrock" ||
      invocation.descriptor.providerId !== this.profile.providerId ||
      (invocation.descriptor.inferenceProfileId ??
        invocation.descriptor.modelId) !== route.invocationTarget
    ) {
      safeConfigurationError("model-provider.invocation-route-mismatch");
    }
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => {
      controller.abort(signal?.reason);
    };
    if (signal?.aborted === true) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Bedrock invocation timeout"));
    }, invocation.timeoutMilliseconds);
    try {
      const input =
        invocation.descriptor.contractVersion === 4
          ? buildBedrockHostRepairSuccessorConverseRequestV4(
              {
                ...invocation,
                descriptor: invocation.descriptor,
                request: modelHostRepairSuccessorRequestV3Schema.parse(
                  invocation.request,
                ),
                promptCachePolicy:
                  modelLiveSeedRoutingDecisionV3Schema.shape.promptCachePolicy.parse(
                    invocation.promptCachePolicy,
                  ),
              },
              route,
            )
          : invocation.descriptor.contractVersion === 3
            ? buildBedrockHostSeedConverseRequestV3(
                {
                  ...invocation,
                  descriptor: invocation.descriptor,
                  request: modelHostSeedRepairRequestV2Schema.parse(
                    invocation.request,
                  ),
                  promptCachePolicy:
                    modelLiveSeedRoutingDecisionV3Schema.shape.promptCachePolicy.parse(
                      invocation.promptCachePolicy,
                    ),
                },
                route,
              )
            : invocation.request.contractVersion === 2
              ? buildBedrockHostSeedConverseRequestV2(
                  {
                    ...invocation,
                    descriptor: invocation.descriptor,
                    request: invocation.request,
                  },
                  route,
                )
              : invocation.request.contractVersion === 1
                ? buildBedrockConverseRequestV1(
                    {
                      ...invocation,
                      descriptor: invocation.descriptor,
                      request: invocation.request,
                    },
                    route,
                  )
                : safeConfigurationError(
                    "model-provider.request-version-unavailable",
                  );
      if (route.transport === "converse-stream") {
        const output = (await this.#client.send(
          new ConverseStreamCommand(input),
          { abortSignal: controller.signal },
        )) as ConverseStreamCommandOutput;
        return await consumeStream(
          output,
          invocation,
          route.nativeStructuredOutputSupported,
        );
      }
      const output = (await this.#client.send(new ConverseCommand(input), {
        abortSignal: controller.signal,
      })) as ConverseCommandOutput;
      const normalizedUsage = normalizeUsage(
        output.usage,
        output.$metadata.requestId,
      );
      return {
        content: responseContent(
          output,
          invocation,
          route.nativeStructuredOutputSupported,
        ),
        ...(normalizedUsage === undefined ? {} : { usage: normalizedUsage }),
      };
    } catch (error) {
      if (error instanceof ModelProviderInvocationError) throw error;
      throw classifyProviderError(error, timedOut, signal?.aborted === true);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }
}
