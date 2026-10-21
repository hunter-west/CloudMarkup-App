import { randomUUID } from "node:crypto";

import {
  digestStructuredValue,
  type ModelProviderAdapter,
  type ModelProviderInvocationV1,
  type ModelProviderHostSeedInvocationV2,
  type ModelProviderHostSeedInvocationV3,
  type ModelProviderHostRepairSuccessorInvocationV4,
  type ModelProviderResultV1,
} from "@cloudmarkup/model-gateway";
import {
  modelInvocationDescriptorV1Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  modelHostRepairSuccessorRequestV3Schema,
  modelHostSeedRepairRequestV2Schema,
  namespacedIdentifierSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import {
  ModelPlatformHttpGuard,
  type ModelPlatformHttpHandler,
} from "./model-platform-http-guard.js";
export type { ModelPlatformHttpHandler } from "./model-platform-http-guard.js";

export const MODEL_PLATFORM_MONTHLY_CAP_MICRO_USD = 50_000_000;

function canceled(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export class ModelPlatformSpendError extends Error {
  readonly code:
    "model-platform.cap-exceeded" | "model-platform.spend-unavailable";
  constructor(kind: "cap-exceeded" | "unavailable" = "unavailable") {
    super(
      "Model assistance is unavailable under the platform spending controls.",
    );
    this.name = "ModelPlatformSpendError";
    this.code =
      kind === "cap-exceeded"
        ? "model-platform.cap-exceeded"
        : "model-platform.spend-unavailable";
  }
}

export const modelDispatchCostCeilingSchema = z
  .object({
    contractVersion: z.literal(1),
    invocationDigest: sha256DigestSchema,
    providerId: namespacedIdentifierSchema,
    modelId: namespacedIdentifierSchema,
    modelVersion: z.string().min(1).max(128),
    inferenceProfileId: namespacedIdentifierSchema,
    pricingVersionId: namespacedIdentifierSchema,
    pricingVersionDigest: sha256DigestSchema,
    maximumCostMicroUsd: z
      .number()
      .int()
      .min(1)
      .max(MODEL_PLATFORM_MONTHLY_CAP_MICRO_USD),
    validFrom: utcTimestampSchema,
    validUntil: utcTimestampSchema,
    /** Optional freshness limit for starting this exact request; not its billing window. */
    dispatchValidUntil: utcTimestampSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.validUntil) > Date.parse(value.validFrom) &&
      (value.dispatchValidUntil === undefined ||
        (Date.parse(value.dispatchValidUntil) > Date.parse(value.validFrom) &&
          Date.parse(value.dispatchValidUntil) <=
            Date.parse(value.validUntil))),
  );
export type ModelDispatchCostCeiling = z.output<
  typeof modelDispatchCostCeilingSchema
>;

/** Host-reviewed pricing authority, never a browser amount or token estimate.
 * Must bound ALL billable input (system/tools/framing/cache), output including
 * thinking, and any provider-side dispatch amplification for this exact payload.
 * Unknown pricing, token bounds, model/profile or cache billing returns null.
 * Production composition must provide separately reviewed cost authority.
 */
export interface ModelDispatchCostCeilingPort {
  resolve(
    invocation: ModelProviderInvocationV1,
    signal?: AbortSignal,
  ): Promise<ModelDispatchCostCeiling | null>;
}

/** Separate V2 cost boundary; never accepted through a V1 invocation cast. */
export interface ModelHostSeedDispatchCostCeilingPortV2 {
  resolveHostSeedV2(
    invocation: ModelProviderHostSeedInvocationV2,
    signal?: AbortSignal,
  ): Promise<ModelDispatchCostCeiling | null>;
}

export interface ModelHostSeedDispatchCostCeilingPortV3 {
  resolveHostSeedV3(
    invocation: ModelProviderHostSeedInvocationV3,
    signal?: AbortSignal,
  ): Promise<ModelDispatchCostCeiling | null>;
}

export interface ModelHostRepairSuccessorDispatchCostCeilingPortV4 {
  resolveHostRepairSuccessorV4(
    invocation: ModelProviderHostRepairSuccessorInvocationV4,
    signal?: AbortSignal,
  ): Promise<ModelDispatchCostCeiling | null>;
}

export const modelPlatformReservationInputSchema = z
  .object({
    dispatchId: z.string().regex(/^dispatch_[a-f0-9]{32}$/u),
    scope: modelInvocationDescriptorV1Schema.shape.scope,
    invocationId: modelInvocationDescriptorV1Schema.shape.invocationId,
    ceiling: modelDispatchCostCeilingSchema,
  })
  .strict();
export type ModelPlatformReservationInput = z.output<
  typeof modelPlatformReservationInputSchema
>;

export const modelPlatformReservationReceiptSchema = z
  .object({
    kind: z.literal("reserved"),
    dispatchId: z.string().regex(/^dispatch_[a-f0-9]{32}$/u),
    claimDigest: sha256DigestSchema,
    monthUtc: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u),
    reservedAt: utcTimestampSchema,
    dispatchBefore: utcTimestampSchema,
  })
  .strict();
export type ModelPlatformReservationReceipt = z.output<
  typeof modelPlatformReservationReceiptSchema
>;

export interface ModelPlatformSpendReservationPort {
  reserve(
    input: ModelPlatformReservationInput,
  ): Promise<ModelPlatformReservationReceipt | { readonly kind: "duplicate" }>;
}

/** Final host-only dispatch fence. Wrap every Bedrock adapter: initial calls,
 * retries, repairs and escalations all reserve independently before dispatch.
 * Fully retained ceilings are intentionally not refunded, even after errors or
 * cancellation. This caps app-controlled dispatches, not unrelated AWS usage.
 * This is not tenant auth, commercial credit authority or runtime admission.
 */
type SpendInvocation =
  | ModelProviderInvocationV1
  | ModelProviderHostSeedInvocationV2
  | ModelProviderHostSeedInvocationV3
  | ModelProviderHostRepairSuccessorInvocationV4;
interface SpendProvider<TInvocation extends SpendInvocation> {
  readonly profile: ModelProviderAdapter["profile"];
  invoke(
    invocation: TInvocation,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1>;
}
interface SpendCosts<TInvocation extends SpendInvocation> {
  resolve(
    invocation: TInvocation,
    signal?: AbortSignal,
  ): Promise<ModelDispatchCostCeiling | null>;
}

class PlatformSpendBoundInvocation<
  TInvocation extends SpendInvocation,
  TRequest,
  TOptions extends object,
  TResponse,
> {
  readonly #descriptorVersion: 1 | 3 | 4;
  readonly #delegate: SpendProvider<TInvocation>;
  readonly #costs: SpendCosts<TInvocation>;
  readonly #reservations: ModelPlatformSpendReservationPort;
  readonly #scope: ModelPlatformReservationInput["scope"];
  readonly #now: () => Date;
  readonly #http: ModelPlatformHttpGuard<TRequest, TOptions, TResponse>;
  constructor(input: {
    readonly descriptorVersion: 1 | 3 | 4;
    /** Construct the SDK client with this exact final requestHandler. Do not
     * return an opaque pre-existing client, add redirects, or bypass the guard. */
    readonly createDelegate: (
      handler: ModelPlatformHttpHandler<TRequest, TOptions, TResponse>,
    ) => SpendProvider<TInvocation>;
    readonly httpHandler: ModelPlatformHttpHandler<
      TRequest,
      TOptions,
      TResponse
    >;
    readonly costs: SpendCosts<TInvocation>;
    readonly reservations: ModelPlatformSpendReservationPort;
    readonly scope: ModelPlatformReservationInput["scope"];
    /** Trusted host clock only; the ledger independently assigns its UTC month. */
    readonly now?: () => Date;
    /** Optional stricter host execution authority, checked inside the final HTTP
     * fence after credential/signing work and before its synchronous USD check. */
    readonly beforeDispatch?: (
      signal: AbortSignal,
    ) => Promise<{ readonly expiresAt: string }>;
  }) {
    this.#descriptorVersion = input.descriptorVersion;
    const scope = modelInvocationDescriptorV1Schema.shape.scope.safeParse(
      input.scope,
    );
    if (!scope.success) throw new ModelPlatformSpendError();
    this.#now = input.now ?? (() => new Date());
    this.#http = new ModelPlatformHttpGuard({
      handler: input.httpHandler,
      now: this.#now,
      ...(input.beforeDispatch === undefined
        ? {}
        : { beforeDispatch: input.beforeDispatch }),
      deny: () => {
        throw new ModelPlatformSpendError();
      },
    });
    this.#delegate = input.createDelegate(this.#http);
    if (this.#delegate.profile.providerFamily !== "amazon-bedrock")
      throw new ModelPlatformSpendError();
    this.#costs = input.costs;
    this.#reservations = input.reservations;
    this.#scope = scope.data;
  }
  get profile(): ModelProviderAdapter["profile"] {
    return this.#delegate.profile;
  }

  async invoke(
    invocation: TInvocation,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1> {
    const payload = structuredClone(invocation);
    const descriptor =
      this.#descriptorVersion === 4
        ? modelLiveRepairSuccessorInvocationDescriptorV4Schema.safeParse(
            payload.descriptor,
          )
        : this.#descriptorVersion === 3
          ? modelLiveSeedInvocationDescriptorV3Schema.safeParse(
              payload.descriptor,
            )
          : modelInvocationDescriptorV1Schema.safeParse(payload.descriptor);
    if (
      canceled(signal) ||
      !descriptor.success ||
      !this.profile.enabled ||
      descriptor.data.providerId !== this.profile.providerId ||
      digestStructuredValue(descriptor.data.scope) !==
        digestStructuredValue(this.#scope)
    )
      throw new ModelPlatformSpendError();
    const digest = digestStructuredValue(payload);
    const candidate = modelDispatchCostCeilingSchema.safeParse(
      await this.#costs.resolve(structuredClone(payload), signal),
    );
    if (!candidate.success) throw new ModelPlatformSpendError();
    const ceiling = candidate.data;
    const pricedAt = this.#now().getTime();
    if (
      !Number.isFinite(pricedAt) ||
      pricedAt < Date.parse(ceiling.validFrom) ||
      pricedAt >=
        Date.parse(ceiling.dispatchValidUntil ?? ceiling.validUntil) ||
      ceiling.invocationDigest !== digest ||
      ceiling.providerId !== descriptor.data.providerId ||
      ceiling.modelId !== descriptor.data.modelId ||
      ceiling.modelVersion !== descriptor.data.modelVersion ||
      ceiling.inferenceProfileId !== descriptor.data.inferenceProfileId ||
      ceiling.pricingVersionId !==
        descriptor.data.routing?.pricingVersionReference ||
      canceled(signal)
    )
      throw new ModelPlatformSpendError();
    const reservation: ModelPlatformReservationInput = {
      dispatchId: `dispatch_${randomUUID().replaceAll("-", "")}`,
      scope: descriptor.data.scope,
      invocationId: descriptor.data.invocationId,
      ceiling,
    };
    const reservationStartedAt = performance.now();
    const result = await this.#reservations.reserve(reservation);
    const receipt = modelPlatformReservationReceiptSchema.safeParse(result);
    if (!receipt.success) throw new ModelPlatformSpendError();
    const now = this.#now().getTime();
    const reservedAt = Date.parse(receipt.data.reservedAt);
    const dispatchBefore = Date.parse(receipt.data.dispatchBefore);
    // The final HTTP guard repeats freshness after SDK credential/signing work.
    // Stale or uncertain reservations remain held, never refunded here.
    if (
      !Number.isFinite(now) ||
      canceled(signal) ||
      receipt.data.dispatchId !== reservation.dispatchId ||
      receipt.data.claimDigest !== digestStructuredValue(reservation) ||
      receipt.data.monthUtc !== new Date(now).toISOString().slice(0, 7) ||
      receipt.data.monthUtc !== receipt.data.reservedAt.slice(0, 7) ||
      now < reservedAt - 2_000 ||
      now >= dispatchBefore ||
      dispatchBefore <= reservedAt ||
      // Refuse the final five seconds of a month/pricing window entirely. The
      // monotonic round trip then also fences a slow or skewed local clock.
      dispatchBefore - reservedAt !== 5_000 ||
      performance.now() - reservationStartedAt >= 5_000 ||
      now < Date.parse(ceiling.validFrom) ||
      now >= Date.parse(ceiling.validUntil)
    )
      throw new ModelPlatformSpendError();
    return this.#http.run({
      receipt: receipt.data,
      pricingValidUntil: ceiling.validUntil,
      ...(ceiling.dispatchValidUntil === undefined
        ? {}
        : { dispatchValidUntil: ceiling.dispatchValidUntil }),
      reservationStartedAt,
      ...(signal === undefined ? {} : { parentSignal: signal }),
      invoke: (authorizedSignal) =>
        this.#delegate.invoke(payload, authorizedSignal),
    });
  }
}

/** Existing V1 provider port with unchanged reservation and HTTP guard behavior. */
export class PlatformSpendBoundModelProviderAdapter<
  TRequest,
  TOptions extends object,
  TResponse,
>
  extends PlatformSpendBoundInvocation<
    ModelProviderInvocationV1,
    TRequest,
    TOptions,
    TResponse
  >
  implements ModelProviderAdapter
{
  constructor(
    input: Omit<
      ConstructorParameters<
        typeof PlatformSpendBoundInvocation<
          ModelProviderInvocationV1,
          TRequest,
          TOptions,
          TResponse
        >
      >[0],
      "descriptorVersion"
    >,
  ) {
    super({ ...input, descriptorVersion: 1 });
  }
}

export interface ModelHostSeedProviderAdapterV2 {
  readonly profile: ModelProviderAdapter["profile"];
  invokeHostSeedV2(
    invocation: ModelProviderHostSeedInvocationV2,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1>;
}

/** Explicit V2 repair spending path. Each attempt retains its real reservation;
 * current stage/host authority is mandatory again at the final physical send. */
export class PlatformSpendBoundHostSeedProviderAdapterV2<
  TRequest,
  TOptions extends object,
  TResponse,
> implements ModelHostSeedProviderAdapterV2 {
  readonly #bound: PlatformSpendBoundInvocation<
    ModelProviderHostSeedInvocationV2,
    TRequest,
    TOptions,
    TResponse
  >;
  constructor(input: {
    readonly createDelegate: (
      handler: ModelPlatformHttpHandler<TRequest, TOptions, TResponse>,
    ) => ModelHostSeedProviderAdapterV2;
    readonly httpHandler: ModelPlatformHttpHandler<
      TRequest,
      TOptions,
      TResponse
    >;
    readonly costs: ModelHostSeedDispatchCostCeilingPortV2;
    readonly reservations: ModelPlatformSpendReservationPort;
    readonly scope: ModelPlatformReservationInput["scope"];
    readonly now?: () => Date;
    readonly beforeDispatch: (
      signal: AbortSignal,
    ) => Promise<{ readonly expiresAt: string }>;
  }) {
    if (typeof input.beforeDispatch !== "function")
      throw new ModelPlatformSpendError();
    this.#bound = new PlatformSpendBoundInvocation({
      ...input,
      descriptorVersion: 1,
      costs: { resolve: input.costs.resolveHostSeedV2.bind(input.costs) },
      createDelegate: (handler) => {
        const delegate = input.createDelegate(handler);
        return {
          profile: delegate.profile,
          invoke: delegate.invokeHostSeedV2.bind(delegate),
        };
      },
    });
  }
  get profile(): ModelProviderAdapter["profile"] {
    return this.#bound.profile;
  }
  invokeHostSeedV2(
    invocation: ModelProviderHostSeedInvocationV2,
    signal?: AbortSignal,
  ) {
    if (
      !modelHostSeedRepairRequestV2Schema.safeParse(invocation.request).success
    )
      return Promise.reject(new ModelPlatformSpendError());
    return this.#bound.invoke(invocation, signal);
  }
}

export interface ModelHostSeedProviderAdapterV3 {
  readonly profile: ModelProviderAdapter["profile"];
  invokeHostSeedV3(
    invocation: ModelProviderHostSeedInvocationV3,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1>;
}

/** Explicit V3 repair spending path. Each attempt retains its real reservation;
 * current stage/host authority is mandatory again at the final physical send. */
export class PlatformSpendBoundHostSeedProviderAdapterV3<
  TRequest,
  TOptions extends object,
  TResponse,
> implements ModelHostSeedProviderAdapterV3 {
  readonly #bound: PlatformSpendBoundInvocation<
    ModelProviderHostSeedInvocationV3,
    TRequest,
    TOptions,
    TResponse
  >;
  constructor(input: {
    readonly createDelegate: (
      handler: ModelPlatformHttpHandler<TRequest, TOptions, TResponse>,
    ) => ModelHostSeedProviderAdapterV3;
    readonly httpHandler: ModelPlatformHttpHandler<
      TRequest,
      TOptions,
      TResponse
    >;
    readonly costs: ModelHostSeedDispatchCostCeilingPortV3;
    readonly reservations: ModelPlatformSpendReservationPort;
    readonly scope: ModelPlatformReservationInput["scope"];
    readonly now?: () => Date;
    readonly beforeDispatch: (
      signal: AbortSignal,
    ) => Promise<{ readonly expiresAt: string }>;
  }) {
    if (typeof input.beforeDispatch !== "function")
      throw new ModelPlatformSpendError();
    this.#bound = new PlatformSpendBoundInvocation({
      ...input,
      descriptorVersion: 3,
      costs: { resolve: input.costs.resolveHostSeedV3.bind(input.costs) },
      createDelegate: (handler) => {
        const delegate = input.createDelegate(handler);
        return {
          profile: delegate.profile,
          invoke: delegate.invokeHostSeedV3.bind(delegate),
        };
      },
    });
  }
  get profile(): ModelProviderAdapter["profile"] {
    return this.#bound.profile;
  }
  invokeHostSeedV3(
    invocation: ModelProviderHostSeedInvocationV3,
    signal?: AbortSignal,
  ) {
    if (
      !modelHostSeedRepairRequestV2Schema.safeParse(invocation.request).success
    )
      return Promise.reject(new ModelPlatformSpendError());
    return this.#bound.invoke(invocation, signal);
  }
}

export interface ModelHostRepairSuccessorProviderAdapterV4 {
  readonly profile: ModelProviderAdapter["profile"];
  invokeHostRepairSuccessorV4(
    invocation: ModelProviderHostRepairSuccessorInvocationV4,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1>;
}

/** Explicit V4 final repair spending path. Each attempt retains its real reservation;
 * current stage/host authority is mandatory again at the final physical send. */
export class PlatformSpendBoundHostRepairSuccessorProviderAdapterV4<
  TRequest,
  TOptions extends object,
  TResponse,
> implements ModelHostRepairSuccessorProviderAdapterV4 {
  readonly #bound: PlatformSpendBoundInvocation<
    ModelProviderHostRepairSuccessorInvocationV4,
    TRequest,
    TOptions,
    TResponse
  >;
  constructor(input: {
    readonly createDelegate: (
      handler: ModelPlatformHttpHandler<TRequest, TOptions, TResponse>,
    ) => ModelHostRepairSuccessorProviderAdapterV4;
    readonly httpHandler: ModelPlatformHttpHandler<
      TRequest,
      TOptions,
      TResponse
    >;
    readonly costs: ModelHostRepairSuccessorDispatchCostCeilingPortV4;
    readonly reservations: ModelPlatformSpendReservationPort;
    readonly scope: ModelPlatformReservationInput["scope"];
    readonly now?: () => Date;
    readonly beforeDispatch: (
      signal: AbortSignal,
    ) => Promise<{ readonly expiresAt: string }>;
  }) {
    if (typeof input.beforeDispatch !== "function")
      throw new ModelPlatformSpendError();
    this.#bound = new PlatformSpendBoundInvocation({
      ...input,
      descriptorVersion: 4,
      costs: {
        resolve: input.costs.resolveHostRepairSuccessorV4.bind(input.costs),
      },
      createDelegate: (handler) => {
        const delegate = input.createDelegate(handler);
        return {
          profile: delegate.profile,
          invoke: delegate.invokeHostRepairSuccessorV4.bind(delegate),
        };
      },
    });
  }
  get profile(): ModelProviderAdapter["profile"] {
    return this.#bound.profile;
  }
  invokeHostRepairSuccessorV4(
    invocation: ModelProviderHostRepairSuccessorInvocationV4,
    signal?: AbortSignal,
  ) {
    if (
      !modelHostRepairSuccessorRequestV3Schema.safeParse(invocation.request)
        .success
    )
      return Promise.reject(new ModelPlatformSpendError());
    return this.#bound.invoke(invocation, signal);
  }
}
