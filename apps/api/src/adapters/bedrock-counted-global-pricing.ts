import {
  modelHostSeedRepairRequestV2Schema,
  modelHostRepairSuccessorRequestV3Schema,
  modelLiveSeedRoutingDecisionV3Schema,
} from "@cloudmarkup/schemas";
import {
  BEDROCK_CONVERSE_REQUEST_VERSION_V1,
  BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
  BedrockConverseInputTokenCounterV1,
  digestStructuredValue,
  type BedrockFinalHttpHandlerV1,
  type ModelProviderInvocationV1,
  type ModelProviderHostSeedInvocationV2,
  type ModelProviderHostSeedInvocationV3,
  type ModelProviderHostRepairSuccessorInvocationV4,
} from "@cloudmarkup/model-gateway";
import {
  BedrockGlobalFullWindowCostAuthority,
  bedrockGlobalPricingEvidenceV1Schema,
} from "./bedrock-global-pricing.js";
import {
  ModelPlatformSpendError,
  modelDispatchCostCeilingSchema,
  type ModelDispatchCostCeiling,
  type ModelDispatchCostCeilingPort,
  type ModelHostSeedDispatchCostCeilingPortV2,
  type ModelHostSeedDispatchCostCeilingPortV3,
  type ModelHostRepairSuccessorDispatchCostCeilingPortV4,
} from "./model-platform-spend.js";

type FullWindowInput = ConstructorParameters<
  typeof BedrockGlobalFullWindowCostAuthority
>[0];

type PricedInvocation =
  | ModelProviderInvocationV1
  | ModelProviderHostSeedInvocationV2
  | ModelProviderHostSeedInvocationV3
  | ModelProviderHostRepairSuccessorInvocationV4;
interface ReservedRepairTokens {
  readonly input: number;
  readonly output: number;
}
type CountedInput = FullWindowInput & {
  readonly requestHandler: BedrockFinalHttpHandlerV1;
  readonly assertCurrentAuthority: (
    signal: AbortSignal,
  ) => Promise<{ readonly expiresAt: string }>;
};
/** Shared exact-request arithmetic and expiry checks for explicit versioned entry points. */
class BedrockGlobalCountedCostAuthority {
  readonly #full: BedrockGlobalFullWindowCostAuthority;
  readonly #evidence: FullWindowInput["evidence"];
  readonly #route: FullWindowInput["route"];
  readonly #invocationDigest: string;
  readonly #counter: BedrockConverseInputTokenCounterV1;
  readonly #now: () => Date;
  readonly #invocationVersion: 1 | 2 | 3 | 4;
  readonly #reservedTokens: ReservedRepairTokens | undefined;

  constructor(
    input: CountedInput & {
      readonly invocation: PricedInvocation;
      readonly invocationVersion: 1 | 2 | 3 | 4;
      readonly reservedTokenCeiling?: ReservedRepairTokens;
    },
  ) {
    try {
      if (
        (input.invocation.descriptor.contractVersion === 4
          ? 4
          : input.invocation.descriptor.contractVersion === 3
            ? 3
            : input.invocation.request.contractVersion) !==
        input.invocationVersion
      )
        throw new ModelPlatformSpendError();
      this.#invocationVersion = input.invocationVersion;
      const reserved =
        input.invocationVersion === 4 ? input.reservedTokenCeiling : undefined;
      if (
        input.invocationVersion === 4 &&
        (reserved === undefined ||
          !Number.isSafeInteger(reserved.input) ||
          reserved.input <= 0 ||
          !Number.isSafeInteger(reserved.output) ||
          reserved.output <= 0 ||
          input.invocation.maximumOutputTokens > reserved.output)
      )
        throw new ModelPlatformSpendError();
      this.#reservedTokens =
        reserved === undefined ? undefined : Object.freeze({ ...reserved });
      this.#full = new BedrockGlobalFullWindowCostAuthority(input);
      this.#evidence = bedrockGlobalPricingEvidenceV1Schema.parse(
        input.evidence,
      );
      this.#route = structuredClone(input.route);
      this.#invocationDigest = digestStructuredValue(
        structuredClone(input.invocation),
      );
      this.#now = input.now ?? (() => new Date());
      this.#counter = new BedrockConverseInputTokenCounterV1({
        modelId: this.#evidence.modelId,
        invocationDigest: this.#invocationDigest,
        requestHandler: input.requestHandler,
        assertCurrentAuthority: input.assertCurrentAuthority,
        now: this.#now,
      });
    } catch {
      throw new ModelPlatformSpendError();
    }
  }

  async resolve(
    invocation: PricedInvocation,
    signal?: AbortSignal,
  ): Promise<ModelDispatchCostCeiling | null> {
    try {
      const payload = structuredClone(invocation);
      if (
        signal?.aborted ||
        (payload.descriptor.contractVersion === 4
          ? 4
          : payload.descriptor.contractVersion === 3
            ? 3
            : payload.request.contractVersion) !== this.#invocationVersion ||
        digestStructuredValue(payload) !== this.#invocationDigest
      )
        return null;
      // Reuse all existing exact offer, model, prompt, response schema, cache,
      // route and SDK-projection checks before content can reach CountTokens.
      const before = await this.#price(payload);
      if (before === null || signal?.aborted) return null;
      const count =
        payload.descriptor.contractVersion === 4
          ? await this.#counter.countHostRepairSuccessorV4(
              {
                ...payload,
                descriptor: payload.descriptor,
                request: modelHostRepairSuccessorRequestV3Schema.parse(
                  payload.request,
                ),
                promptCachePolicy:
                  modelLiveSeedRoutingDecisionV3Schema.shape.promptCachePolicy.parse(
                    payload.promptCachePolicy,
                  ),
              },
              this.#route,
              signal,
            )
          : payload.descriptor.contractVersion === 3
            ? await this.#counter.countHostSeedV3(
                {
                  ...payload,
                  descriptor: payload.descriptor,
                  request: modelHostSeedRepairRequestV2Schema.parse(
                    payload.request,
                  ),
                  promptCachePolicy:
                    modelLiveSeedRoutingDecisionV3Schema.shape.promptCachePolicy.parse(
                      payload.promptCachePolicy,
                    ),
                },
                this.#route,
                signal,
              )
            : payload.request.contractVersion === 2
              ? await this.#counter.countHostSeedV2(
                  {
                    ...payload,
                    descriptor: payload.descriptor,
                    request: payload.request,
                  },
                  this.#route,
                  signal,
                )
              : payload.request.contractVersion === 1
                ? await this.#counter.count(
                    {
                      ...payload,
                      descriptor: payload.descriptor,
                      request: payload.request,
                    },
                    this.#route,
                    signal,
                  )
                : null;
      const current = await this.#price(payload);
      const now = this.#now().getTime();
      if (
        count === null ||
        (this.#reservedTokens !== undefined &&
          count.inputTokens > this.#reservedTokens.input) ||
        current === null ||
        signal?.aborted ||
        !Number.isFinite(now) ||
        now < Date.parse(count.countedAt) ||
        now >= Date.parse(count.expiresAt) ||
        count.invocationDigest !== this.#invocationDigest ||
        current.pricingVersionDigest !== before.pricingVersionDigest
      )
        return null;
      const rates = this.#evidence.rates;
      const inputRate = Math.max(
        rates.inputMicroUsdPerMillion,
        rates.cacheReadMicroUsdPerMillion,
        rates.cacheWrite5mMicroUsdPerMillion,
        rates.cacheWrite1hMicroUsdPerMillion,
      );
      const million = 1_000_000n;
      const numerator =
        BigInt(count.inputTokens) * BigInt(inputRate) +
        BigInt(payload.maximumOutputTokens) *
          BigInt(rates.outputMicroUsdPerMillion);
      const maximumCostMicroUsd = Number((numerator + million - 1n) / million);
      if (maximumCostMicroUsd > current.maximumCostMicroUsd) return null;
      return modelDispatchCostCeilingSchema.parse({
        ...current,
        maximumCostMicroUsd,
        pricingVersionDigest: digestStructuredValue({
          policyId:
            this.#invocationVersion === 1
              ? "cloudmarkup.bedrock-global-counted-input.v1"
              : this.#invocationVersion === 2
                ? "cloudmarkup.bedrock-global-counted-host-seed.v2"
                : this.#invocationVersion === 3
                  ? "cloudmarkup.bedrock-global-counted-static-seed.v3"
                  : "cloudmarkup.bedrock-global-counted-repair-successor.v4",
          reviewedFullWindowPricingDigest: current.pricingVersionDigest,
          ...(this.#reservedTokens === undefined
            ? {}
            : { reservedTokenCeiling: this.#reservedTokens }),
          tokenCountPolicyId: BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
          requestProjectionVersion: BEDROCK_CONVERSE_REQUEST_VERSION_V1,
          inputAccounting:
            "complete-counted-input-at-maximum-reviewed-cache-rate",
          outputAccounting: "full-output-including-thinking",
          dispatchAccounting: "one-retained-reservation-per-http-send",
          maximumCountAgeMilliseconds: 30_000,
        }),
        validFrom: count.countedAt,
        dispatchValidUntil: new Date(
          Math.min(Date.parse(current.validUntil), Date.parse(count.expiresAt)),
        ).toISOString(),
      });
    } catch {
      return null;
    }
  }
  #price(payload: PricedInvocation) {
    return payload.descriptor.contractVersion === 4
      ? this.#full.resolveHostRepairSuccessorV4({
          ...payload,
          descriptor: payload.descriptor,
          request: modelHostRepairSuccessorRequestV3Schema.parse(
            payload.request,
          ),
          promptCachePolicy:
            modelLiveSeedRoutingDecisionV3Schema.shape.promptCachePolicy.parse(
              payload.promptCachePolicy,
            ),
        })
      : payload.descriptor.contractVersion === 3
        ? this.#full.resolveHostSeedV3({
            ...payload,
            descriptor: payload.descriptor,
            request: modelHostSeedRepairRequestV2Schema.parse(payload.request),
            promptCachePolicy:
              modelLiveSeedRoutingDecisionV3Schema.shape.promptCachePolicy.parse(
                payload.promptCachePolicy,
              ),
          })
        : payload.request.contractVersion === 2
          ? this.#full.resolveHostSeedV2({
              ...payload,
              descriptor: payload.descriptor,
              request: payload.request,
            })
          : payload.request.contractVersion === 1
            ? this.#full.resolve({
                ...payload,
                descriptor: payload.descriptor,
                request: payload.request,
              })
            : null;
  }
}

/** Existing V1 entry point. Every resolve repeats the full actual count; V1
 * pricing digests, deadlines and conservative cache/output arithmetic are preserved. */
export class BedrockGlobalCountedInputCostAuthority implements ModelDispatchCostCeilingPort {
  readonly #authority: BedrockGlobalCountedCostAuthority;
  constructor(
    input: CountedInput & { readonly invocation: ModelProviderInvocationV1 },
  ) {
    this.#authority = new BedrockGlobalCountedCostAuthority({
      ...input,
      invocationVersion: 1,
    });
  }
  resolve(invocation: ModelProviderInvocationV1, signal?: AbortSignal) {
    return this.#authority.resolve(invocation, signal);
  }
}

/** Exact V2 counted pricing, not stage, credit, reservation or dispatch authority.
 * The current-auth closure and final CountTokens handler remain mandatory. */
export class BedrockGlobalCountedHostSeedCostAuthorityV2 implements ModelHostSeedDispatchCostCeilingPortV2 {
  readonly #authority: BedrockGlobalCountedCostAuthority;
  constructor(
    input: CountedInput & {
      readonly invocation: ModelProviderHostSeedInvocationV2;
    },
  ) {
    this.#authority = new BedrockGlobalCountedCostAuthority({
      ...input,
      invocationVersion: 2,
    });
  }
  resolveHostSeedV2(
    invocation: ModelProviderHostSeedInvocationV2,
    signal?: AbortSignal,
  ) {
    return this.#authority.resolve(invocation, signal);
  }
}

/** Static V3 first-seed cost authority. Every resolve counts its exact payload
 * under current host authority; it grants no dispatch or commercial permission. */
export class BedrockGlobalCountedHostSeedCostAuthorityV3 implements ModelHostSeedDispatchCostCeilingPortV3 {
  readonly #authority: BedrockGlobalCountedCostAuthority;
  constructor(
    input: CountedInput & {
      readonly invocation: ModelProviderHostSeedInvocationV3;
    },
  ) {
    this.#authority = new BedrockGlobalCountedCostAuthority({
      ...input,
      invocationVersion: 3,
    });
  }
  resolveHostSeedV3(
    invocation: ModelProviderHostSeedInvocationV3,
    signal?: AbortSignal,
  ) {
    return this.#authority.resolve(invocation, signal);
  }
}

/** V4 final-repair cost authority. Every resolve counts its exact payload
 * under current host authority; it grants no dispatch or commercial permission. */
export class BedrockGlobalCountedHostRepairSuccessorCostAuthorityV4 implements ModelHostRepairSuccessorDispatchCostCeilingPortV4 {
  readonly #authority: BedrockGlobalCountedCostAuthority;
  constructor(
    input: CountedInput & {
      readonly invocation: ModelProviderHostRepairSuccessorInvocationV4;
      /** Exact maximum usage of canonical planned repair two; never a new budget. */
      readonly reservedTokenCeiling: ReservedRepairTokens;
    },
  ) {
    this.#authority = new BedrockGlobalCountedCostAuthority({
      ...input,
      invocationVersion: 4,
    });
  }
  resolveHostRepairSuccessorV4(
    invocation: ModelProviderHostRepairSuccessorInvocationV4,
    signal?: AbortSignal,
  ) {
    return this.#authority.resolve(invocation, signal);
  }
}
