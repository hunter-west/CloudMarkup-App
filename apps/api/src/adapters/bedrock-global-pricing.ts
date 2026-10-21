import {
  BEDROCK_REGISTERED_MODEL_IDS_V1,
  BEDROCK_FULL_INPUT_WINDOW_CEILING_V1,
  BEDROCK_MAXIMUM_REVIEWED_OUTPUT_TOKENS_V1,
  getBedrockModelRegistrationV1,
  BEDROCK_CONVERSE_REQUEST_VERSION_V1,
  buildBedrockConverseRequestV1,
  buildBedrockHostSeedConverseRequestV2,
  buildBedrockHostSeedConverseRequestV3,
  buildBedrockHostRepairSuccessorConverseRequestV4,
  reviewedHostBoundedRepairPromptV4,
  reviewedHostSeedRepairPromptV2,
  resolveReviewedHostSeedRepairPromptV3,
  resolveReviewedHostPatchRepairPromptV3,
  getModelHostSeedPatchResponseToolV2,
  digestStructuredValue,
  getModelResponseToolV1,
  reviewedModelPromptRegistry,
  type ModelProviderInvocationV1,
  type ModelProviderHostSeedInvocationV2,
  type ModelProviderHostSeedInvocationV3,
  type ModelProviderHostRepairSuccessorInvocationV4,
  type BedrockRuntimeRouteV1,
} from "@cloudmarkup/model-gateway";
import {
  modelCacheKeyInputV1Schema,
  modelGatewayRequestV1Schema,
  modelHostSeedRepairRequestV2Schema,
  modelHostRepairSuccessorRequestV3Schema,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  modelInvocationDescriptorV1Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveSeedRoutingDecisionV3Schema,
  modelRoutingDecisionV1Schema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import { reviewedBedrockPricing20260916 } from "./bedrock-reviewed-pricing-20260916.js";
import {
  ModelPlatformSpendError,
  modelDispatchCostCeilingSchema,
  type ModelDispatchCostCeiling,
  type ModelDispatchCostCeilingPort,
} from "./model-platform-spend.js";

// A full model-window ceiling, NOT a tokenizer estimate. 2^20 conservatively
// covers the published 1M window; all system, message, tool and cache input
// occupies that window. The separate full requested output is not subtracted.
// https://platform.claude.com/docs/en/build-with-claude/context-windows
const FULL_INPUT_WINDOW_TOKENS = BEDROCK_FULL_INPUT_WINDOW_CEILING_V1;
const MAXIMUM_OUTPUT_TOKENS = BEDROCK_MAXIMUM_REVIEWED_OUTPUT_TOKENS_V1;
const MILLION = 1_000_000n;

const rateSchema = z.number().int().positive().max(50_000_000);

/** Host-owned sanitized offer evidence, never a browser payload. Cache rates
 * must be independently read from the same offer, not inferred multipliers.
 * No default expiry or environment loader silently activates this authority. */
export const bedrockGlobalPricingEvidenceV1Schema = z
  .object({
    contractVersion: z.literal(1),
    policyId: z.literal("cloudmarkup.bedrock-global-full-window.v1"),
    accountId: z.literal("000000000000"),
    environment: z.literal("beta"),
    sourceRegion: z.literal("us-east-1"),
    endpoint: z.literal("bedrock-runtime"),
    serviceTier: z.literal("standard"),
    // AWS describes its offer unit only as 'Units'. USD/million is the
    // separately reviewed published-pricing interpretation, not an API field.
    offerUnit: z.literal("Units"),
    currency: z.literal("USD"),
    tokenDenominator: z.literal(1_000_000),
    publishedPricingReference: z.literal(
      "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    pricingVersionId: namespacedIdentifierSchema,
    modelId: z.enum(BEDROCK_REGISTERED_MODEL_IDS_V1),
    modelVersion: z.string().min(1).max(128),
    inferenceProfileId: namespacedIdentifierSchema,
    offerId: z.string().min(1).max(128),
    offerTermsDigest: sha256DigestSchema,
    observedAt: utcTimestampSchema,
    validFrom: utcTimestampSchema,
    validUntil: utcTimestampSchema,
    rates: z
      .object({
        inputMicroUsdPerMillion: rateSchema,
        outputMicroUsdPerMillion: rateSchema,
        cacheReadMicroUsdPerMillion: rateSchema,
        cacheWrite5mMicroUsdPerMillion: rateSchema,
        cacheWrite1hMicroUsdPerMillion: rateSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const registration = getBedrockModelRegistrationV1(evidence.modelId);
    const refreshed = reviewedBedrockPricing20260916.find(
      (snapshot) => snapshot.pricingVersionId === evidence.pricingVersionId,
    );
    const approved = refreshed?.pricingSnapshot ?? registration.pricingSnapshot;
    if (
      (refreshed !== undefined &&
        (evidence.modelId !== refreshed.modelId ||
          evidence.observedAt !== refreshed.observedAt ||
          evidence.offerTermsDigest !== refreshed.offerTermsDigest)) ||
      evidence.validFrom !== approved.validFrom ||
      evidence.validUntil !== approved.validUntil ||
      evidence.inferenceProfileId !== registration.inferenceProfileId ||
      evidence.offerId !== approved.offerId ||
      evidence.rates.inputMicroUsdPerMillion !==
        approved.inputMicroUsdPerMillion ||
      evidence.rates.outputMicroUsdPerMillion !==
        approved.outputMicroUsdPerMillion ||
      evidence.rates.cacheReadMicroUsdPerMillion !==
        approved.cacheReadMicroUsdPerMillion ||
      evidence.rates.cacheWrite5mMicroUsdPerMillion !==
        approved.cacheWrite5mMicroUsdPerMillion ||
      evidence.rates.cacheWrite1hMicroUsdPerMillion !==
        approved.cacheWrite1hMicroUsdPerMillion ||
      Date.parse(evidence.validUntil) <= Date.parse(evidence.validFrom) ||
      Date.parse(evidence.observedAt) < Date.parse(evidence.validFrom) ||
      Date.parse(evidence.observedAt) >= Date.parse(evidence.validUntil)
    )
      context.addIssue({
        code: "custom",
        message: "The reviewed GLOBAL offer evidence is contradictory.",
      });
  });

export type BedrockGlobalPricingEvidenceV1 = z.output<
  typeof bedrockGlobalPricingEvidenceV1Schema
>;

const reviewedRouteSchema = z
  .object({
    enabled: z.literal(true),
    invocationTarget: namespacedIdentifierSchema,
    modelConfigurationReference: namespacedIdentifierSchema,
    nativeStructuredOutputSupported: z.literal(false),
    region: z.literal("us-east-1"),
    supportedRegions: z.array(z.literal("us-east-1")).length(1),
    thinkingMode: z.literal("adaptive"),
    toolChoiceMode: z.literal("auto").optional(),
    transport: z.enum(["converse", "converse-stream"]),
  })
  .strict();

const invocationSchema = z
  .object({
    descriptor: modelInvocationDescriptorV1Schema,
    maximumOutputBytes: z
      .number()
      .int()
      .positive()
      .max(4 * 1_048_576),
    maximumOutputTokens: z.number().int().positive().max(MAXIMUM_OUTPUT_TOKENS),
    promptCacheKey: z
      .object({ digest: sha256DigestSchema, input: modelCacheKeyInputV1Schema })
      .strict()
      .optional(),
    promptCachePolicy: modelRoutingDecisionV1Schema.shape.promptCachePolicy,
    prompt: z
      .object({
        content: z.string().min(1).max(1_048_576),
        digest: sha256DigestSchema,
        operations: z.array(z.string()).min(1),
        reviewed: z.literal(true),
        templateId: namespacedIdentifierSchema,
        version: semanticVersionSchema,
      })
      .strict(),
    request: modelGatewayRequestV1Schema,
    responseTool: z
      .object({
        authority: z.literal("none"),
        contractVersion: z.literal(1),
        inputSchema: z.record(z.string(), z.unknown()),
        operation: z.string(),
        schemaId: z.string(),
        toolName: z.string(),
      })
      .strict(),
    timeoutMilliseconds: z.number().int().positive().max(300_000),
  })
  .strict();

const hostSeedInvocationSchema = invocationSchema.extend({
  request: modelHostSeedRepairRequestV2Schema,
});
const staticSeedInvocationSchema = hostSeedInvocationSchema
  .omit({ promptCacheKey: true })
  .extend({
    descriptor: modelLiveSeedInvocationDescriptorV3Schema,
    promptCachePolicy:
      modelLiveSeedRoutingDecisionV3Schema.shape.promptCachePolicy,
  });
const repairSuccessorInvocationSchema = staticSeedInvocationSchema.extend({
  descriptor: modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  request: modelHostRepairSuccessorRequestV3Schema,
});

type PricedInvocation =
  | ModelProviderInvocationV1
  | ModelProviderHostSeedInvocationV2
  | ModelProviderHostSeedInvocationV3
  | ModelProviderHostRepairSuccessorInvocationV4;

// Strictly constrain the *shared actual SDK projection*. A future compaction,
// server tool, Guardrail, performance tier, prompt router or other billable
// addition must fail here until a new pricing policy explicitly covers it.
const textBlock = z.object({ text: z.string() }).strict();
const commandSchema = z
  .object({
    modelId: namespacedIdentifierSchema,
    additionalModelRequestFields: z
      .object({ thinking: z.object({ type: z.literal("adaptive") }).strict() })
      .strict(),
    inferenceConfig: z
      .object({
        maxTokens: z.number().int().positive().max(MAXIMUM_OUTPUT_TOKENS),
      })
      .strict(),
    messages: z
      .array(
        z
          .object({
            role: z.literal("user"),
            content: z.array(textBlock).length(1),
          })
          .strict(),
      )
      .length(1),
    system: z
      .array(
        z.union([
          textBlock,
          z
            .object({
              cachePoint: z.object({ type: z.literal("default") }).strict(),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(2),
    outputConfig: z
      .object({ effort: z.enum(["medium", "high", "xhigh"]) })
      .strict(),
    requestMetadata: z.record(z.string(), z.string()),
    toolConfig: z
      .object({
        toolChoice: z.union([
          z.object({ tool: z.object({ name: z.string() }).strict() }).strict(),
          z.object({ auto: z.object({}).strict() }).strict(),
        ]),
        tools: z
          .array(
            z
              .object({
                toolSpec: z
                  .object({
                    description: z.literal(
                      "Return the strict CloudMarkup proposal only.",
                    ),
                    inputSchema: z
                      .object({ json: z.record(z.string(), z.unknown()) })
                      .strict(),
                    name: z.string(),
                  })
                  .strict(),
              })
              .strict(),
          )
          .length(1),
      })
      .strict(),
  })
  .strict();

/** Concrete conservative currency authority for the approved beta GLOBAL offers.
 * It does NOT authorize tenants, routes, evaluation, commercial credits or jobs.
 * Each resolve prices one SDK send; the spending wrapper independently reserves
 * again for every retry/escalation and retains even uncertain charges. Caching
 * always reserves at the maximum reviewed input rate, including when disabled,
 * so implicit caching cannot reduce the ceiling. No live client is constructed.
 */
export class BedrockGlobalFullWindowCostAuthority implements ModelDispatchCostCeilingPort {
  readonly #evidence: BedrockGlobalPricingEvidenceV1;
  readonly #route: z.output<typeof reviewedRouteSchema>;
  readonly #now: () => Date;
  readonly #pricingDigest: ReturnType<typeof digestStructuredValue>;

  constructor(input: {
    readonly evidence: BedrockGlobalPricingEvidenceV1;
    readonly route: BedrockRuntimeRouteV1;
    readonly now?: () => Date;
  }) {
    const evidence = bedrockGlobalPricingEvidenceV1Schema.safeParse(
      input.evidence,
    );
    const route = reviewedRouteSchema.safeParse(input.route);
    if (
      !evidence.success ||
      !route.success ||
      route.data.invocationTarget !== evidence.data.inferenceProfileId
    )
      throw new ModelPlatformSpendError();
    this.#evidence = evidence.data;
    this.#route = route.data;
    this.#now = input.now ?? (() => new Date());
    this.#pricingDigest = digestStructuredValue({
      evidence: this.#evidence,
      offerDimensions: getBedrockModelRegistrationV1(this.#evidence.modelId)
        .offerDimensions,
      route: this.#route,
      requestProjectionVersion: BEDROCK_CONVERSE_REQUEST_VERSION_V1,
      maximumInputTokens: FULL_INPUT_WINDOW_TOKENS,
      maximumOutputTokens: getBedrockModelRegistrationV1(this.#evidence.modelId)
        .maximumOutputTokens,
      inputAccounting: "all-input-at-maximum-reviewed-cache-rate",
      outputAccounting: "full-output-including-thinking",
      dispatchAccounting: "one-retained-reservation-per-http-send",
    });
  }

  resolve(
    invocation: ModelProviderInvocationV1,
  ): Promise<ModelDispatchCostCeiling | null> {
    // Malformed or unserializable values must not expose content-bearing schema
    // errors through the provider boundary.
    try {
      return Promise.resolve(this.#resolve(invocation, 1));
    } catch {
      return Promise.resolve(null);
    }
  }

  /** Explicit fixed-host input pricing. It grants no CountTokens, stage,
   * commercial, dispatch or normal runtime authority. */
  resolveHostSeedV2(
    invocation: ModelProviderHostSeedInvocationV2,
  ): Promise<ModelDispatchCostCeiling | null> {
    try {
      return Promise.resolve(this.#resolve(invocation, 2));
    } catch {
      return Promise.resolve(null);
    }
  }

  resolveHostSeedV3(
    invocation: ModelProviderHostSeedInvocationV3,
  ): Promise<ModelDispatchCostCeiling | null> {
    try {
      return Promise.resolve(this.#resolve(invocation, 3));
    } catch {
      return Promise.resolve(null);
    }
  }

  resolveHostRepairSuccessorV4(
    invocation: ModelProviderHostRepairSuccessorInvocationV4,
  ): Promise<ModelDispatchCostCeiling | null> {
    try {
      return Promise.resolve(this.#resolve(invocation, 4));
    } catch {
      return Promise.resolve(null);
    }
  }

  #resolve(
    invocation: PricedInvocation,
    contractVersion: 1 | 2 | 3 | 4,
  ): ModelDispatchCostCeiling | null {
    const parsed =
      contractVersion === 1
        ? invocationSchema.safeParse(invocation)
        : contractVersion === 2
          ? hostSeedInvocationSchema.safeParse(invocation)
          : contractVersion === 3
            ? staticSeedInvocationSchema.safeParse(invocation)
            : repairSuccessorInvocationSchema.safeParse(invocation);
    if (
      contractVersion !== 1 &&
      getBedrockModelRegistrationV1(this.#evidence.modelId)
        .tokenCountingStrategy !== "full-converse-count-tokens-v1"
    )
      return null;
    const now = this.#now().getTime();
    if (
      !parsed.success ||
      parsed.data.maximumOutputTokens >
        getBedrockModelRegistrationV1(this.#evidence.modelId)
          .maximumOutputTokens ||
      !Number.isFinite(now) ||
      now < Date.parse(this.#evidence.observedAt) ||
      now < Date.parse(this.#evidence.validFrom) ||
      now >= Date.parse(this.#evidence.validUntil)
    )
      return null;
    const { descriptor, request } = parsed.data;
    const prompt =
      contractVersion === 4
        ? reviewedHostBoundedRepairPromptV4
        : contractVersion === 3
          ? resolveReviewedHostSeedRepairPromptV3(descriptor)
          : contractVersion === 2
            ? reviewedHostSeedRepairPromptV2
            : reviewedModelPromptRegistry.get(request.operation);
    if (
      prompt === null ||
      descriptor.providerFamily !== "amazon-bedrock" ||
      descriptor.providerId !== "cloudmarkup.amazon-bedrock" ||
      descriptor.modelId !== this.#evidence.modelId ||
      descriptor.modelVersion !== this.#evidence.modelVersion ||
      descriptor.inferenceProfileId !== this.#evidence.inferenceProfileId ||
      descriptor.routing?.pricingVersionReference !==
        this.#evidence.pricingVersionId ||
      descriptor.routing.modelConfigurationReference !==
        this.#route.modelConfigurationReference ||
      descriptor.feature !== request.operation ||
      descriptor.requestedMode !== request.requestedMode ||
      descriptor.inputDigest !==
        digestStructuredValue({ request, scope: descriptor.scope }) ||
      descriptor.promptDigest !== prompt.digest ||
      descriptor.promptTemplateId !== prompt.templateId ||
      descriptor.promptVersion !== prompt.version ||
      digestStructuredValue(invocation.prompt) !==
        digestStructuredValue(prompt) ||
      digestStructuredValue(invocation.responseTool) !==
        digestStructuredValue(
          contractVersion === 4 ||
            (contractVersion === 3 &&
              resolveReviewedHostPatchRepairPromptV3(descriptor) !== null)
            ? getModelHostSeedPatchResponseToolV2()
            : getModelResponseToolV1(request.operation),
        )
    )
      return null;
    const projection =
      contractVersion === 4
        ? buildBedrockHostRepairSuccessorConverseRequestV4(
            {
              ...repairSuccessorInvocationSchema.parse(invocation),
              prompt: reviewedHostBoundedRepairPromptV4,
              responseTool: getModelHostSeedPatchResponseToolV2(),
            },
            this.#route,
          )
        : contractVersion === 3 && invocation.descriptor.contractVersion === 3
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
              this.#route,
            )
          : contractVersion === 2 &&
              invocation.descriptor.contractVersion === 1 &&
              invocation.request.contractVersion === 2
            ? buildBedrockHostSeedConverseRequestV2(
                {
                  ...invocation,
                  descriptor: invocation.descriptor,
                  request: invocation.request,
                },
                this.#route,
              )
            : contractVersion === 1 &&
                invocation.descriptor.contractVersion === 1 &&
                invocation.request.contractVersion === 1
              ? buildBedrockConverseRequestV1(
                  {
                    ...invocation,
                    descriptor: invocation.descriptor,
                    request: invocation.request,
                  },
                  this.#route,
                )
              : null;
    const command = commandSchema.safeParse(projection);
    if (
      !command.success ||
      command.data.modelId !== this.#evidence.inferenceProfileId ||
      command.data.inferenceConfig.maxTokens !== parsed.data.maximumOutputTokens
    )
      return null;
    const rates = this.#evidence.rates;
    const maximumInputRate = Math.max(
      rates.inputMicroUsdPerMillion,
      rates.cacheReadMicroUsdPerMillion,
      rates.cacheWrite5mMicroUsdPerMillion,
      rates.cacheWrite1hMicroUsdPerMillion,
    );
    const numerator =
      BigInt(FULL_INPUT_WINDOW_TOKENS) * BigInt(maximumInputRate) +
      BigInt(command.data.inferenceConfig.maxTokens) *
        BigInt(rates.outputMicroUsdPerMillion);
    const maximumCostMicroUsd = Number((numerator + MILLION - 1n) / MILLION);
    const ceiling = modelDispatchCostCeilingSchema.safeParse({
      contractVersion: 1,
      invocationDigest: digestStructuredValue(invocation),
      providerId: descriptor.providerId,
      modelId: descriptor.modelId,
      modelVersion: descriptor.modelVersion,
      inferenceProfileId: descriptor.inferenceProfileId,
      pricingVersionId: this.#evidence.pricingVersionId,
      pricingVersionDigest:
        contractVersion === 1
          ? this.#pricingDigest
          : digestStructuredValue({
              policyId:
                contractVersion === 2
                  ? "cloudmarkup.bedrock-global-host-seed-full-window.v2"
                  : contractVersion === 3
                    ? "cloudmarkup.bedrock-global-static-seed-full-window.v3"
                    : "cloudmarkup.bedrock-global-repair-successor-full-window.v4",
              reviewedFullWindowPricingDigest: this.#pricingDigest,
              requestContractVersion: contractVersion === 4 ? 3 : 2,
              ...(contractVersion === 3 || contractVersion === 4
                ? { descriptorContractVersion: contractVersion }
                : {}),
              hostSeedPromptDigest: prompt.digest,
            }),
      maximumCostMicroUsd,
      validFrom: this.#evidence.observedAt,
      validUntil: this.#evidence.validUntil,
    });
    return ceiling.success ? ceiling.data : null;
  }
}
