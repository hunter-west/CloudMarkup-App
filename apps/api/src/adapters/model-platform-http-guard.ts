import { AsyncLocalStorage } from "node:async_hooks";

import type { ModelPlatformReservationReceipt } from "./model-platform-spend.js";

/** Structural AWS HTTP-handler seam; preserves its request/response/options
 * types without importing an undeclared transitive SDK dependency. Options
 * must support the standard native AbortSignal used by the Node Bedrock host.
 */
export interface ModelPlatformHttpHandler<
  TRequest,
  TOptions extends object,
  TResponse,
> {
  handle(request: TRequest, options?: TOptions): Promise<TResponse>;
  destroy?(): void;
}

interface DispatchContext {
  readonly controller: AbortController;
  readonly cleanup: (() => void)[];
  readonly receipt: ModelPlatformReservationReceipt;
  readonly reservationStartedAt: number;
  readonly pricingValidUntil: number;
  readonly dispatchValidUntil: number;
  closed: boolean;
  dispatched: boolean;
  checking: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Exact data-only host expiry metadata; no accessor, class, symbol or extra
 * property may substitute for the trusted host's canonical timestamp. */
export function modelDispatchAuthorityExpiry(value: unknown): number | null {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== 1
    )
      return null;
    const property = Object.getOwnPropertyDescriptor(value, "expiresAt");
    const text: unknown = property?.value;
    if (property?.enumerable !== true || typeof text !== "string") return null;
    const expiry = Date.parse(text);
    return Number.isFinite(expiry) && new Date(expiry).toISOString() === text
      ? expiry
      : null;
  } catch {
    return null;
  }
}

/** Must be the final SDK requestHandler, beneath credentials/signing/retries.
 * Each private reservation context permits exactly one HTTP request. The short
 * timer guards pre-dispatch work; after HTTP handover a hard month/pricing
 * deadline remains active, including DNS, connection pools and streamed bodies.
 */
export class ModelPlatformHttpGuard<
  TRequest,
  TOptions extends object,
  TResponse,
> implements ModelPlatformHttpHandler<TRequest, TOptions, TResponse> {
  readonly #context = new AsyncLocalStorage<DispatchContext>();
  readonly #handler: ModelPlatformHttpHandler<TRequest, TOptions, TResponse>;
  readonly #now: () => Date;
  readonly #deny: () => never;
  readonly #beforeDispatch:
    | ((signal: AbortSignal) => Promise<{ readonly expiresAt: string }>)
    | undefined;
  constructor(input: {
    readonly handler: ModelPlatformHttpHandler<TRequest, TOptions, TResponse>;
    readonly now: () => Date;
    readonly deny: () => never;
    readonly beforeDispatch?: (
      signal: AbortSignal,
    ) => Promise<{ readonly expiresAt: string }>;
  }) {
    this.#handler = input.handler;
    this.#now = input.now;
    this.#deny = input.deny;
    this.#beforeDispatch = input.beforeDispatch;
  }
  destroy(): void {
    this.#handler.destroy?.();
  }
  #trustedUpperTime(context: DispatchContext): number {
    // The monotonic anchor precedes SQL reservation. Adding its entire elapsed
    // duration to DB reservedAt is a conservative upper bound, never an excuse
    // to dispatch late when the local wall clock is slow or adjusted backwards.
    return Math.max(
      this.#now().getTime(),
      // SQL receipts truncate sub-millisecond precision; round upward here.
      Date.parse(context.receipt.reservedAt) +
        1 +
        performance.now() -
        context.reservationStartedAt,
    );
  }
  #assertOpenHandoff(context: DispatchContext): void {
    if (
      context.closed ||
      context.dispatched ||
      context.controller.signal.aborted
    )
      this.#deny();
  }
  #arm(context: DispatchContext, delay: number): void {
    if (context.timer !== undefined) clearTimeout(context.timer);
    if (!Number.isFinite(delay) || delay <= 0) return this.#deny();
    context.timer = setTimeout(
      () => {
        context.controller.abort();
      },
      Math.min(delay, 2_147_483_647),
    );
  }
  async run<T>(input: {
    readonly receipt: ModelPlatformReservationReceipt;
    readonly pricingValidUntil: string;
    readonly dispatchValidUntil?: string;
    readonly reservationStartedAt: number;
    readonly parentSignal?: AbortSignal;
    readonly invoke: (signal: AbortSignal) => Promise<T>;
  }): Promise<T> {
    const context: DispatchContext = {
      controller: new AbortController(),
      cleanup: [],
      receipt: input.receipt,
      reservationStartedAt: input.reservationStartedAt,
      pricingValidUntil: Date.parse(input.pricingValidUntil),
      dispatchValidUntil: Date.parse(
        input.dispatchValidUntil ?? input.pricingValidUntil,
      ),
      closed: false,
      dispatched: false,
      checking: false,
      timer: undefined,
    };
    const cancel = () => {
      context.controller.abort();
    };
    if (input.parentSignal?.aborted === true) return this.#deny();
    input.parentSignal?.addEventListener("abort", cancel, { once: true });
    context.cleanup.push(() => {
      input.parentSignal?.removeEventListener("abort", cancel);
    });
    try {
      this.#arm(
        context,
        Math.min(
          Date.parse(context.receipt.dispatchBefore),
          context.dispatchValidUntil,
        ) - this.#trustedUpperTime(context),
      );
      const result = await this.#context.run(context, () =>
        input.invoke(context.controller.signal),
      );
      if (!context.dispatched) return this.#deny();
      return result;
    } finally {
      context.closed = true;
      if (context.timer !== undefined) clearTimeout(context.timer);
      for (const cleanup of context.cleanup) cleanup();
    }
  }
  async handle(request: TRequest, options?: TOptions): Promise<TResponse> {
    const context = this.#context.getStore();
    if (
      context === undefined ||
      context.closed ||
      context.dispatched ||
      context.checking ||
      context.controller.signal.aborted
    )
      return this.#deny();
    // Reserve the single handoff before asynchronous authority verification.
    // A second/reentrant SDK send can never share that pending verification.
    context.checking = true;
    let authorityExpiresAt = Infinity;
    if (this.#beforeDispatch !== undefined) {
      let cancel: (() => void) | undefined;
      try {
        const aborted = new Promise<never>((_resolve, reject) => {
          cancel = () => {
            reject(new Error("Model dispatch authorization was aborted."));
          };
          context.controller.signal.addEventListener("abort", cancel, {
            once: true,
          });
          if (context.controller.signal.aborted) cancel();
        });
        const proof: unknown = await Promise.race([
          this.#beforeDispatch(context.controller.signal),
          aborted,
        ]);
        const expiry = modelDispatchAuthorityExpiry(proof);
        if (expiry === null) return this.#deny();
        authorityExpiresAt = expiry;
      } catch {
        return this.#deny();
      } finally {
        if (cancel !== undefined)
          context.controller.signal.removeEventListener("abort", cancel);
      }
    }
    // No awaited work is allowed below the final checks.
    this.#assertOpenHandoff(context);
    const now = this.#trustedUpperTime(context);
    if (
      !Number.isFinite(now) ||
      now >= Date.parse(context.receipt.dispatchBefore) ||
      new Date(now).toISOString().slice(0, 7) !== context.receipt.monthUtc ||
      now >= context.pricingValidUntil ||
      now >= context.dispatchValidUntil ||
      now >= authorityExpiresAt
    )
      return this.#deny();
    const providerSignal: unknown = (
      options as Readonly<Record<string, unknown>> | undefined
    )?.["abortSignal"];
    if (providerSignal !== undefined) {
      if (!(providerSignal instanceof AbortSignal) || providerSignal.aborted)
        return this.#deny();
      const cancel = () => {
        context.controller.abort();
      };
      providerSignal.addEventListener("abort", cancel, { once: true });
      context.cleanup.push(() => {
        providerSignal.removeEventListener("abort", cancel);
      });
    }
    const instant = new Date(now);
    const nextMonth = Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth() + 1,
      1,
    );
    this.#arm(
      context,
      Math.min(nextMonth, context.pricingValidUntil, authorityExpiresAt) - now,
    );
    context.dispatched = true;
    // Preserve SDK options but replace its signal with the linked hard-deadline
    // signal. TOptions is constrained by this host's standard HTTP-handler seam.
    return this.#handler.handle(request, {
      ...options,
      abortSignal: context.controller.signal,
    } as TOptions);
  }
}
