import { z } from "zod";
import {
  digestCanonicalValue,
  sha256DigestSchema,
  type ModelGatewayOperationV1,
} from "@cloudmarkup/schemas";

export const BEDROCK_REGISTERED_MODEL_IDS_V1 = Object.freeze([
  "anthropic.claude-sonnet-5",
  "anthropic.claude-opus-5",
  "anthropic.claude-sonnet-4-6",
  "anthropic.claude-opus-4-6-v1",
] as const);
export type RegisteredBedrockModelIdV1 =
  (typeof BEDROCK_REGISTERED_MODEL_IDS_V1)[number];
export const BEDROCK_FULL_INPUT_WINDOW_CEILING_V1 = 1_048_576;
export const BEDROCK_MAXIMUM_REVIEWED_OUTPUT_TOKENS_V1 = 131_072;
const operations = [
  "intent.extract",
  "requirements.blocking-questions",
  "architecture.propose",
  "workload.propose",
  "external-resource.propose",
  "operations.propose",
  "repository.interpret",
  "issue.explain",
  "deterministic-fix.explain",
  "fix.propose",
  "application-source.generate",
  "iac-extension.generate",
  "candidate.repair",
  "summary.plain-language",
  "summary.technical",
] as const satisfies readonly ModelGatewayOperationV1[];
export interface BedrockModelRegistrationV1 {
  readonly contractVersion: 1;
  readonly registrationId: string;
  readonly registrationDigest: string;
  readonly modelId: RegisteredBedrockModelIdV1;
  readonly inferenceProfileId: string;
  readonly routeClass: "standard" | "deep";
  readonly sourceRegion: "us-east-1";
  readonly geography: "global";
  readonly transports: readonly ["converse", "converse-stream"];
  readonly implementedOperations: readonly ModelGatewayOperationV1[];
  readonly structuredOutputStrategy: "schema-only-response-tool";
  readonly thinkingMode: "adaptive";
  readonly adaptiveToolChoiceMode: "auto" | "forced-response-tool";
  readonly tokenCountingStrategy:
    "full-converse-count-tokens-v1" | "unavailable";
  readonly fullInputWindowCeilingTokens: number;
  readonly maximumOutputTokens: number;
  readonly offerDimensions: Readonly<
    Record<
      | "inputMicroUsdPerMillion"
      | "outputMicroUsdPerMillion"
      | "cacheReadMicroUsdPerMillion"
      | "cacheWrite5mMicroUsdPerMillion"
      | "cacheWrite1hMicroUsdPerMillion",
      string
    >
  >;

  /** Preserved V1 offer interpretation; never a claim that these prices are current. */
  readonly pricingSnapshot: {
    readonly offerId: string;
    readonly validFrom: string;
    readonly validUntil: string;
    readonly inputMicroUsdPerMillion: number;
    readonly outputMicroUsdPerMillion: number;
    readonly cacheReadMicroUsdPerMillion: number;
    readonly cacheWrite5mMicroUsdPerMillion: number;
    readonly cacheWrite1hMicroUsdPerMillion: number;
  };
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function registration(
  input: Pick<
    BedrockModelRegistrationV1,
    | "registrationId"
    | "modelId"
    | "routeClass"
    | "adaptiveToolChoiceMode"
    | "tokenCountingStrategy"
    | "maximumOutputTokens"
    | "pricingSnapshot"
    | "offerDimensions"
  >,
): BedrockModelRegistrationV1 {
  const body = {
    contractVersion: 1 as const,
    ...input,
    inferenceProfileId: "global." + input.modelId,
    sourceRegion: "us-east-1" as const,
    geography: "global" as const,
    transports: ["converse", "converse-stream"] as const,
    implementedOperations: operations,
    structuredOutputStrategy: "schema-only-response-tool" as const,
    thinkingMode: "adaptive" as const,
    fullInputWindowCeilingTokens: BEDROCK_FULL_INPUT_WINDOW_CEILING_V1,
  };
  return freeze({ ...body, registrationDigest: digestCanonicalValue(body) });
}
const legacyWindow = {
  validFrom: "2026-09-05T00:00:00.000Z",
  validUntil: "2026-09-12T00:00:00.000Z",
};
const fallbackWindow = {
  validFrom: "2026-09-09T00:00:00.000Z",
  validUntil: "2026-09-16T00:00:00.000Z",
};
const legacyOfferDimensions = {
  inputMicroUsdPerMillion: "USE1_input_tokens_global_standard",
  outputMicroUsdPerMillion: "USE1_output_tokens_global_standard",
  cacheReadMicroUsdPerMillion: "USE1_cache_read_tokens_global_standard",
  cacheWrite5mMicroUsdPerMillion: "USE1_cache_write_tokens_global_standard",
  cacheWrite1hMicroUsdPerMillion: "USE1_cache_write_tokens_1h_global_standard",
};
const fallbackOfferDimensions = {
  inputMicroUsdPerMillion: "USE1_InputTokenCount_Global",
  outputMicroUsdPerMillion: "USE1_OutputTokenCount_Global",
  cacheReadMicroUsdPerMillion: "USE1_CacheReadInputTokenCount_Global",
  cacheWrite5mMicroUsdPerMillion: "USE1_CacheWriteInputTokenCount_Global",
  cacheWrite1hMicroUsdPerMillion: "USE1_CacheWrite1hInputTokenCount_Global",
};
/** Implementation metadata only. Current account access, prices, authenticated
 * evaluation and exact model/profile promotion must be verified independently. */
export const BEDROCK_MODEL_REGISTRATIONS_V1: readonly BedrockModelRegistrationV1[] =
  freeze([
    registration({
      registrationId: "cloudmarkup.bedrock.sonnet-5.v1",
      offerDimensions: legacyOfferDimensions,
      modelId: "anthropic.claude-sonnet-5",
      routeClass: "standard",
      adaptiveToolChoiceMode: "forced-response-tool",
      tokenCountingStrategy: "unavailable",
      maximumOutputTokens: 131_072,
      pricingSnapshot: {
        ...legacyWindow,
        offerId: "offer-2ykemehpsyf7g",
        inputMicroUsdPerMillion: 2_000_000,
        outputMicroUsdPerMillion: 10_000_000,
        cacheReadMicroUsdPerMillion: 200_000,
        cacheWrite5mMicroUsdPerMillion: 2_500_000,
        cacheWrite1hMicroUsdPerMillion: 4_000_000,
      },
    }),
    registration({
      registrationId: "cloudmarkup.bedrock.opus-5.v1",
      offerDimensions: legacyOfferDimensions,
      modelId: "anthropic.claude-opus-5",
      routeClass: "deep",
      adaptiveToolChoiceMode: "forced-response-tool",
      tokenCountingStrategy: "unavailable",
      maximumOutputTokens: 131_072,
      pricingSnapshot: {
        ...legacyWindow,
        offerId: "offer-f3u6lgbrem3zs",
        inputMicroUsdPerMillion: 5_000_000,
        outputMicroUsdPerMillion: 25_000_000,
        cacheReadMicroUsdPerMillion: 500_000,
        cacheWrite5mMicroUsdPerMillion: 6_250_000,
        cacheWrite1hMicroUsdPerMillion: 10_000_000,
      },
    }),
    registration({
      registrationId: "cloudmarkup.bedrock.sonnet-4-6.v1",
      offerDimensions: fallbackOfferDimensions,
      modelId: "anthropic.claude-sonnet-4-6",
      routeClass: "standard",
      adaptiveToolChoiceMode: "auto",
      tokenCountingStrategy: "full-converse-count-tokens-v1",
      maximumOutputTokens: 64_000,
      pricingSnapshot: {
        ...fallbackWindow,
        offerId: "offer-ldnd26nhxx676",
        inputMicroUsdPerMillion: 3_000_000,
        outputMicroUsdPerMillion: 15_000_000,
        cacheReadMicroUsdPerMillion: 300_000,
        cacheWrite5mMicroUsdPerMillion: 3_750_000,
        cacheWrite1hMicroUsdPerMillion: 6_000_000,
      },
    }),
    registration({
      registrationId: "cloudmarkup.bedrock.opus-4-6.v1",
      offerDimensions: fallbackOfferDimensions,
      modelId: "anthropic.claude-opus-4-6-v1",
      routeClass: "deep",
      adaptiveToolChoiceMode: "auto",
      tokenCountingStrategy: "full-converse-count-tokens-v1",
      maximumOutputTokens: 128_000,
      pricingSnapshot: {
        ...fallbackWindow,
        offerId: "offer-ee7a27hh4hr62",
        inputMicroUsdPerMillion: 5_000_000,
        outputMicroUsdPerMillion: 25_000_000,
        cacheReadMicroUsdPerMillion: 500_000,
        cacheWrite5mMicroUsdPerMillion: 6_250_000,
        cacheWrite1hMicroUsdPerMillion: 10_000_000,
      },
    }),
  ]);
const byModel = new Map<string, BedrockModelRegistrationV1>(
  BEDROCK_MODEL_REGISTRATIONS_V1.map((entry) => [entry.modelId, entry]),
);
export function getBedrockModelRegistrationV1(
  modelId: RegisteredBedrockModelIdV1,
): BedrockModelRegistrationV1;
export function getBedrockModelRegistrationV1(
  modelId: string,
): BedrockModelRegistrationV1 | undefined;
export function getBedrockModelRegistrationV1(
  modelId: string,
): BedrockModelRegistrationV1 | undefined {
  return byModel.get(modelId);
}
/** Preserve historical transport projection only; this alias is never selectable,
 * priced or admitted by the full-input token counter. */
export function usesBedrockAdaptiveAutoToolChoiceV1(modelId: string): boolean {
  return (
    modelId === "anthropic.claude-opus-4-6" ||
    getBedrockModelRegistrationV1(modelId)?.adaptiveToolChoiceMode === "auto"
  );
}

const selection = z
  .object({
    modelId: z.string().min(1).max(128),
    expectedRegistrationDigest: sha256DigestSchema,
    inferenceProfileId: z.string().min(1).max(128),
    routeClass: z.enum(["standard", "deep"]),
    sourceRegion: z.string().min(1).max(32),
    transport: z.string().min(1).max(64),
    operation: z.string().min(1).max(64),
    thinkingMode: z.string().min(1).max(64),
    structuredOutputStrategy: z.string().min(1).max(64),
    maximumOutputTokens: z.number().int().positive(),
  })
  .strict();
export type BedrockModelSelectionReasonV1 =
  | "invalid-selection"
  | "unregistered-model"
  | "registration-changed"
  | "profile-mismatch"
  | "route-class-mismatch"
  | "source-region-unsupported"
  | "transport-unsupported"
  | "operation-unsupported"
  | "thinking-unsupported"
  | "structured-output-unsupported"
  | "output-limit-exceeded"
  | "token-counting-unavailable";
export type BedrockModelSelectionV1 =
  | {
      readonly status: "unsupported";
      readonly reason: BedrockModelSelectionReasonV1;
    }
  | {
      readonly status: "supported-configuration";
      readonly registration: BedrockModelRegistrationV1;
      readonly accountReadiness: "unverified";
      readonly normalActivation: false;
    };
/** Pure operator-configuration comparison, not operator authentication or runtime
 * admission. Never reuses another model's quality, pricing or promotion evidence. */
export function selectBedrockEvaluationModelV1(
  raw: unknown,
): BedrockModelSelectionV1 {
  const parsed = selection.safeParse(raw);
  if (!parsed.success)
    return { status: "unsupported", reason: "invalid-selection" };
  const input = parsed.data,
    record = getBedrockModelRegistrationV1(input.modelId);
  const deny = (
    reason: BedrockModelSelectionReasonV1,
  ): BedrockModelSelectionV1 => ({ status: "unsupported", reason });
  if (!record) return deny("unregistered-model");
  if (input.expectedRegistrationDigest !== record.registrationDigest)
    return deny("registration-changed");
  if (input.inferenceProfileId !== record.inferenceProfileId)
    return deny("profile-mismatch");
  if (input.routeClass !== record.routeClass)
    return deny("route-class-mismatch");
  if (input.sourceRegion !== record.sourceRegion)
    return deny("source-region-unsupported");
  if (!record.transports.some((value) => value === input.transport))
    return deny("transport-unsupported");
  if (!record.implementedOperations.some((value) => value === input.operation))
    return deny("operation-unsupported");
  if (input.thinkingMode !== record.thinkingMode)
    return deny("thinking-unsupported");
  if (input.structuredOutputStrategy !== record.structuredOutputStrategy)
    return deny("structured-output-unsupported");
  if (input.maximumOutputTokens > record.maximumOutputTokens)
    return deny("output-limit-exceeded");
  if (record.tokenCountingStrategy === "unavailable")
    return deny("token-counting-unavailable");
  return {
    status: "supported-configuration",
    registration: record,
    accountReadiness: "unverified",
    normalActivation: false,
  };
}
