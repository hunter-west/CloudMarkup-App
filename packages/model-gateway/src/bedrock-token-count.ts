import { getBedrockModelRegistrationV1 } from "./bedrock-model-registry.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  BedrockRuntimeClient,
  CountTokensCommand,
  type ClientDefaults,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import {
  buildBedrockConverseRequestV1,
  buildBedrockHostSeedConverseRequestV2,
  buildBedrockHostSeedConverseRequestV3,
  buildBedrockHostRepairSuccessorConverseRequestV4,
  type BedrockFinalHttpHandlerV1,
  type BedrockRuntimeRouteV1,
} from "./bedrock-adapter.js";
import type {
  ModelProviderInvocationV1,
  ModelProviderHostSeedInvocationV2,
  ModelProviderHostSeedInvocationV3,
  ModelProviderHostRepairSuccessorInvocationV4,
} from "./ports.js";
import { digestStructuredValue } from "./security.js";

export const BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1 =
  "cloudmarkup.bedrock-converse-token-count.v1" as const;
const host = "bedrock-runtime.us-east-1.amazonaws.com";
const maximumBytes = 4 * 1_048_576;
const maximumTokens = 1_048_576;
const responseSchema = z.object({
  inputTokens: z.number().int().positive().max(maximumTokens),
  $metadata: z.object({ httpStatusCode: z.literal(200) }),
});
const proofSchema = z.object({ expiresAt: z.iso.datetime() }).strict();
const successfulHttpResponseSchema = z.object({
  response: z.object({ statusCode: z.literal(200) }),
});
/** Derive the canonical transport from the declared SDK export, avoiding its
 * legacy any-typed handler overload and an undeclared Smithy dependency. */
type CanonicalHttpHandler = Extract<
  NonNullable<ClientDefaults["requestHandler"]>,
  { httpHandlerConfigs: unknown }
>;
export interface BedrockCountHttpRequestV1 extends Omit<
  Parameters<CanonicalHttpHandler["handle"]>[0],
  "body"
> {
  body?: unknown;
}
export type BedrockCountHttpOptionsV1 = Parameters<
  CanonicalHttpHandler["handle"]
>[1];
interface CountContext {
  readonly controller: AbortController;
  readonly bodyDigest: string;
  readonly path: string;
  readonly invocationDigest: string;
  readonly startedAt: number;
  expiresAt: number;
  authorizationTimer?: ReturnType<typeof setTimeout>;
  claimed: boolean;
  responseReceived: boolean;
  closed: boolean;
}
export interface BedrockCountedInputV1 {
  readonly policyId: typeof BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1;
  readonly invocationDigest: string;
  readonly requestDigest: string;
  readonly inputTokens: number;
  readonly countedAt: string;
  readonly expiresAt: string;
}

/** One request-local, no-charge CountTokens client. This is not model inference,
 * evaluation, customer accounting or invocation permission. The host must bind
 * assertCurrentAuthority to the exact authenticated request; it is rechecked
 * after SDK signing, immediately before handing bytes to its HTTP transport.
 * Input and response bodies remain in RAM and are never logged or stored. */
export class BedrockConverseInputTokenCounterV1 {
  readonly #client: BedrockRuntimeClient;
  readonly #contexts = new AsyncLocalStorage<CountContext>();
  readonly #modelId: string;
  readonly #invocationDigest: string;
  readonly #now: () => Date;
  readonly #authorize: (
    signal: AbortSignal,
  ) => Promise<{ readonly expiresAt: string }>;

  constructor(input: {
    readonly modelId: string;
    readonly invocationDigest: string;
    readonly requestHandler: BedrockFinalHttpHandlerV1;
    readonly assertCurrentAuthority: (
      signal: AbortSignal,
    ) => Promise<{ readonly expiresAt: string }>;
    readonly now?: () => Date;
  }) {
    if (
      getBedrockModelRegistrationV1(input.modelId)?.tokenCountingStrategy !==
        "full-converse-count-tokens-v1" ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.invocationDigest)
    )
      throw new Error("The token counting configuration is unavailable.");
    this.#modelId = input.modelId;
    this.#invocationDigest = input.invocationDigest;
    this.#now = input.now ?? (() => new Date());
    this.#authorize = input.assertCurrentAuthority;
    const requestHandler: BedrockFinalHttpHandlerV1 = {
      handle: async (
        request: BedrockCountHttpRequestV1,
        options?: BedrockCountHttpOptionsV1,
      ) => {
        const context = this.#contexts.getStore();
        if (context === undefined || context.claimed || context.closed)
          throw new Error("The token counting request is unavailable.");
        context.claimed = true;
        const assertRequest = () => {
          const raw =
            typeof request.body === "string"
              ? request.body
              : request.body instanceof Uint8Array
                ? new TextDecoder("utf-8", { fatal: true }).decode(request.body)
                : null;
          if (
            request.protocol !== "https:" ||
            request.hostname !== host ||
            (request.port !== undefined && request.port !== 443) ||
            request.method !== "POST" ||
            Object.entries(request.headers).some(
              ([key, value]) =>
                key.toLowerCase() === "host" &&
                value !== host &&
                value !== `${host}:443`,
            ) ||
            request.path !== context.path ||
            Object.keys(request.query).length !== 0 ||
            raw === null ||
            new TextEncoder().encode(raw).byteLength > maximumBytes ||
            digestStructuredValue(JSON.parse(raw) as unknown) !==
              context.bodyDigest
          )
            throw new Error("The token counting request is unavailable.");
        };
        assertRequest();
        await this.#current(context);
        assertRequest();
        const response = await input.requestHandler.handle(request, {
          ...options,
          abortSignal: context.controller.signal,
        });
        context.responseReceived =
          successfulHttpResponseSchema.safeParse(response).success;
        return response;
      },
    };
    this.#client = new BedrockRuntimeClient({
      region: "us-east-1",
      endpoint: `https://${host}`,
      maxAttempts: 1,
      requestHandler,
    });
  }

  async #current(context: CountContext): Promise<number> {
    const active = () => {
      const now = this.#now().getTime();
      if (
        !Number.isFinite(now) ||
        context.closed ||
        context.controller.signal.aborted ||
        now < context.startedAt ||
        now >= context.expiresAt ||
        context.invocationDigest !== this.#invocationDigest
      )
        throw new Error("The token counting request is unavailable.");
      return now;
    };
    active();
    const proof = proofSchema.parse(
      await this.#authorize(context.controller.signal),
    );
    const expiry = Date.parse(proof.expiresAt);
    const now = active();
    if (now >= expiry)
      throw new Error("The token counting request is unavailable.");
    context.expiresAt = Math.min(context.expiresAt, expiry);
    if (context.authorizationTimer !== undefined)
      clearTimeout(context.authorizationTimer);
    context.authorizationTimer = setTimeout(() => {
      context.controller.abort();
    }, context.expiresAt - now);
    return expiry;
  }

  count(
    invocation: ModelProviderInvocationV1,
    route: BedrockRuntimeRouteV1,
    signal?: AbortSignal,
  ): Promise<BedrockCountedInputV1 | null> {
    return this.#count({ version: 1, invocation }, route, signal);
  }

  /** Same complete-input counting and current-authority/send fence, with an
   * explicitly validated host-seed input. This cannot perform model inference. */
  countHostSeedV2(
    invocation: ModelProviderHostSeedInvocationV2,
    route: BedrockRuntimeRouteV1,
    signal?: AbortSignal,
  ): Promise<BedrockCountedInputV1 | null> {
    return this.#count({ version: 2, invocation }, route, signal);
  }

  /** Complete V3 static-descriptor payload, with the same final HTTP authority fence. */
  countHostSeedV3(
    invocation: ModelProviderHostSeedInvocationV3,
    route: BedrockRuntimeRouteV1,
    signal?: AbortSignal,
  ): Promise<BedrockCountedInputV1 | null> {
    return this.#count({ version: 3, invocation }, route, signal);
  }

  /** Counts the exact final-repair payload with the existing current send fence. */
  countHostRepairSuccessorV4(
    invocation: ModelProviderHostRepairSuccessorInvocationV4,
    route: BedrockRuntimeRouteV1,
    signal?: AbortSignal,
  ): Promise<BedrockCountedInputV1 | null> {
    return this.#count({ version: 4, invocation }, route, signal);
  }

  async #count(
    input:
      | { readonly version: 1; readonly invocation: ModelProviderInvocationV1 }
      | {
          readonly version: 2;
          readonly invocation: ModelProviderHostSeedInvocationV2;
        }
      | {
          readonly version: 3;
          readonly invocation: ModelProviderHostSeedInvocationV3;
        }
      | {
          readonly version: 4;
          readonly invocation: ModelProviderHostRepairSuccessorInvocationV4;
        },
    route: BedrockRuntimeRouteV1,
    signal?: AbortSignal,
  ): Promise<BedrockCountedInputV1 | null> {
    const controller = new AbortController();
    const cancel = () => {
      controller.abort();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    let context: CountContext | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;
    try {
      const prepared = structuredClone(input);
      const payload = prepared.invocation;
      const invocationDigest = digestStructuredValue(payload);
      if (
        invocationDigest !== this.#invocationDigest ||
        payload.descriptor.modelId !== this.#modelId ||
        payload.descriptor.inferenceProfileId !== `global.${this.#modelId}` ||
        route.invocationTarget !== payload.descriptor.inferenceProfileId ||
        route.region !== "us-east-1" ||
        !route.supportedRegions.includes(route.region) ||
        route.modelConfigurationReference !==
          payload.descriptor.routing?.modelConfigurationReference ||
        !route.enabled ||
        route.nativeStructuredOutputSupported ||
        route.toolChoiceMode !== "auto" ||
        route.thinkingMode !== "adaptive"
      )
        return null;
      const command =
        prepared.version === 1
          ? buildBedrockConverseRequestV1(prepared.invocation, route)
          : prepared.version === 2
            ? buildBedrockHostSeedConverseRequestV2(prepared.invocation, route)
            : prepared.version === 3
              ? buildBedrockHostSeedConverseRequestV3(
                  prepared.invocation,
                  route,
                )
              : buildBedrockHostRepairSuccessorConverseRequestV4(
                  prepared.invocation,
                  route,
                );
      const {
        modelId,
        inferenceConfig,
        outputConfig,
        requestMetadata,
        ...converse
      } = command;
      // CountTokens mirrors all billable Converse input. Only these reviewed
      // output controls and request labels are absent from its API shape.
      if (
        modelId !== route.invocationTarget ||
        Object.keys(command).some(
          (key) =>
            ![
              "modelId",
              "inferenceConfig",
              "outputConfig",
              "requestMetadata",
              "messages",
              "system",
              "toolConfig",
              "additionalModelRequestFields",
            ].includes(key),
        ) ||
        Object.keys(inferenceConfig ?? {}).some((key) => key !== "maxTokens") ||
        Object.keys(outputConfig ?? {}).some((key) => key !== "effort") ||
        requestMetadata === undefined
      )
        return null;
      const body = { input: { converse } };
      if (
        new TextEncoder().encode(JSON.stringify(body)).byteLength > maximumBytes
      )
        return null;
      const started = this.#now().getTime();
      if (!Number.isFinite(started) || controller.signal.aborted) return null;
      context = {
        bodyDigest: digestStructuredValue(body),
        path: `/model/${encodeURIComponent(this.#modelId)}/count-tokens`,
        invocationDigest,
        controller,
        startedAt: started,
        expiresAt: started + 10_000,
        claimed: false,
        responseReceived: false,
        closed: false,
      };
      const scoped = context;
      const deadline = new Promise<never>((_, reject) => {
        stop = () => {
          reject(new Error("The token counting request is unavailable."));
        };
        controller.signal.addEventListener("abort", stop, { once: true });
        timer = setTimeout(() => {
          controller.abort();
        }, 10_000);
      });
      const work = this.#contexts.run(scoped, async () => {
        await this.#current(scoped);
        const response = responseSchema.parse(
          await this.#client.send(
            new CountTokensCommand({
              modelId: this.#modelId,
              input: { converse },
            }),
            { abortSignal: controller.signal },
          ),
        );
        if (!scoped.responseReceived)
          throw new Error("The token counting receipt is unavailable.");
        const authorityExpiry = await this.#current(scoped);
        const countedAt = this.#now().getTime();
        const expiresAt = Math.min(authorityExpiry, started + 30_000);
        if (countedAt >= expiresAt) return null;
        return {
          policyId: BEDROCK_CONVERSE_TOKEN_COUNT_POLICY_V1,
          invocationDigest,
          requestDigest: scoped.bodyDigest,
          inputTokens: response.inputTokens,
          countedAt: new Date(countedAt).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
        };
      });
      return await Promise.race([work, deadline]);
    } catch {
      return null;
    } finally {
      if (context !== undefined) {
        context.closed = true;
        if (context.authorizationTimer !== undefined)
          clearTimeout(context.authorizationTimer);
      }
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (stop !== undefined)
        controller.signal.removeEventListener("abort", stop);
      controller.abort();
    }
  }

  destroy(): void {
    this.#client.destroy();
  }
}
