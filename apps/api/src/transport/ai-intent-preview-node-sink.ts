import { createHash } from "node:crypto";
import type { Writable } from "node:stream";

import { AI_INTENT_PREVIEW_STREAM_LIMITS_V1 } from "@cloudmarkup/api-contract";

/** AWS exposes a writable facade rather than a Writable instance. Its documented
 * lifecycle/write surface omits Node's optional errored state; the mandatory
 * error observer and destroyed/cancellation checks still fence every handoff. */
export type AiIntentPreviewNativeOutputV1 = Pick<
  Writable,
  | "destroy"
  | "destroyed"
  | "end"
  | "on"
  | "once"
  | "removeListener"
  | "writable"
  | "writableEnded"
  | "writableFinished"
  | "writableLength"
  | "writableObjectMode"
  | "write"
> & { readonly errored?: Writable["errored"] | undefined };

interface SinkLimits {
  readonly candidateFrameBytes: number;
  readonly totalBytes: number;
  readonly backpressureMilliseconds: number;
  readonly deadlineMilliseconds: number;
}

class PreviewNodeSinkUnavailable extends Error {
  constructor() {
    super("The memory-only preview output is unavailable.");
    this.name = "PreviewNodeSinkUnavailable";
  }
}

function checkedLimits(input: Partial<SinkLimits> | undefined): SinkLimits {
  const maximum: SinkLimits = {
    candidateFrameBytes: AI_INTENT_PREVIEW_STREAM_LIMITS_V1.candidateFrameBytes,
    totalBytes: AI_INTENT_PREVIEW_STREAM_LIMITS_V1.totalBytes,
    backpressureMilliseconds:
      AI_INTENT_PREVIEW_STREAM_LIMITS_V1.backpressureMilliseconds,
    deadlineMilliseconds:
      AI_INTENT_PREVIEW_STREAM_LIMITS_V1.deadlineMilliseconds,
  };
  for (const [key, value] of Object.entries(input ?? {})) {
    if (
      !Object.hasOwn(maximum, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > maximum[key as keyof SinkLimits]
    ) {
      throw new PreviewNodeSinkUnavailable();
    }
  }
  return { ...maximum, ...input };
}

function checkedHandoffExpiry(value: unknown): number {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 1
  ) {
    throw new PreviewNodeSinkUnavailable();
  }
  // A data-only snapshot: getters and later host-object mutation cannot change
  // the expiry whose authority was returned by this exact handoff check.
  const expiry: unknown = Object.getOwnPropertyDescriptor(
    value,
    "expiresAt",
  )?.value;
  if (
    typeof expiry !== "string" ||
    (expiry.length !== 24 && expiry.length !== 27)
  ) {
    throw new PreviewNodeSinkUnavailable();
  }
  const timestamp = Date.parse(expiry);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== expiry
  ) {
    throw new PreviewNodeSinkUnavailable();
  }
  return timestamp;
}

/** Request-local adapter for the existing single, serial SSE framer producer.
 * The host exclusively owns a fresh binary Writable and authenticates the exact
 * execution/emission in authorizeHandoff. Digests/counts select that authority;
 * they never turn client bytes into permission. No credentials or content are
 * retained, logged or persisted here. This is not a public/authenticated route.
 * The host returns its current scope expiry for status frames, and the earliest
 * exact delivery-proof, editing-lease and scope expiry for candidate frames.
 * A future Lambda HttpResponseStream metadata wrapper must preserve the fresh,
 * empty, exclusively owned native output invariant checked here.
 *
 * Native write() is the final synchronous handoff, NOT browser acknowledgement.
 * Already handed-off bytes cannot be retracted. A custom Node implementation
 * that defers the physical send must honor destruction/cancellation itself.
 * Queue backpressure bounds this cooperating framer, not arbitrary producers
 * that ignore writer.ready and enqueue unlimited pending writes. */
export function createAiIntentPreviewNodeSinkV1(input: {
  readonly output: AiIntentPreviewNativeOutputV1;
  readonly signal: AbortSignal;
  readonly authorizeHandoff: (input: {
    readonly frameDigest: string;
    readonly byteLength: number;
    readonly signal: AbortSignal;
  }) => Promise<{ readonly expiresAt: string }>;
  /** Hosts/tests may only lower the existing protocol ceilings. */
  readonly limits?: Partial<SinkLimits>;
}): WritableStream<Uint8Array> {
  const limits = checkedLimits(input.limits);
  const output = input.output;
  if (
    output.writableObjectMode ||
    output.destroyed ||
    output.writableEnded ||
    output.writableLength !== 0 ||
    !output.writable
  ) {
    throw new PreviewNodeSinkUnavailable();
  }
  const controller = new AbortController();
  const stopAt = performance.now() + limits.deadlineMilliseconds;
  let streamController: WritableStreamDefaultController;
  let bytesHandedOff = 0;
  let finished = false;
  let closing = false;
  let cleaned = false;
  let webSignal: AbortSignal | undefined;

  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(deadline);
    input.signal.removeEventListener("abort", stop);
    webSignal?.removeEventListener("abort", stop);
  }

  function stop(): void {
    if (finished || controller.signal.aborted) return;
    controller.abort();
    cleanup();
    // writer.abort() already owns the Web stream's error transition. Reentering
    // controller.error from its synchronous signal listener corrupts Node's
    // abort algorithm; only our independent cancellation initiates this state.
    if (webSignal?.aborted !== true) {
      streamController.error(new PreviewNodeSinkUnavailable());
    }
    // destroy() returns synchronously even when a custom _destroy callback is
    // uncooperative. Never await its callback or disclose the originating error.
    try {
      output.destroy();
    } catch {
      /* No further native write authority. */
    }
  }

  function onClose(): void {
    if (!finished && !(closing && output.writableFinished)) stop();
    output.removeListener("error", stop);
    output.removeListener("finish", onFinish);
  }

  function onFinish(): void {
    if (!closing) stop();
  }

  function assertActive(handoffExpiresAt?: number): void {
    if (
      finished ||
      controller.signal.aborted ||
      input.signal.aborted ||
      webSignal?.aborted === true ||
      performance.now() >= stopAt ||
      output.destroyed ||
      output.errored != null ||
      !output.writable ||
      output.writableEnded ||
      (handoffExpiresAt !== undefined && Date.now() >= handoffExpiresAt)
    ) {
      throw new PreviewNodeSinkUnavailable();
    }
  }

  async function bounded<T>(work: Promise<T>): Promise<T> {
    // Observe before any active check, including work rejected after timeout.
    const observed = work.catch(() => {
      throw new PreviewNodeSinkUnavailable();
    });
    void observed.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interrupt: (() => void) | undefined;
    try {
      if (controller.signal.aborted || performance.now() >= stopAt)
        throw new PreviewNodeSinkUnavailable();
      const interrupted = new Promise<never>((_resolve, reject) => {
        interrupt = () => {
          reject(new PreviewNodeSinkUnavailable());
        };
        controller.signal.addEventListener("abort", interrupt, { once: true });
        timer = setTimeout(
          stop,
          Math.min(
            limits.backpressureMilliseconds,
            Math.max(0, stopAt - performance.now()),
          ),
        );
      });
      return await Promise.race([observed, interrupted]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (interrupt !== undefined)
        controller.signal.removeEventListener("abort", interrupt);
    }
  }

  async function write(chunk: Uint8Array): Promise<void> {
    try {
      assertActive();
      if (
        !(chunk instanceof Uint8Array) ||
        chunk.byteLength === 0 ||
        chunk.byteLength > limits.candidateFrameBytes ||
        bytesHandedOff + chunk.byteLength > limits.totalBytes
      )
        throw new PreviewNodeSinkUnavailable();
      // No caller/authorizer reference can mutate the bytes during its await.
      const bytes = Buffer.from(chunk);
      const selection = Object.freeze({
        frameDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        byteLength: bytes.byteLength,
        signal: controller.signal,
      });
      const handoffExpiresAt = checkedHandoffExpiry(
        await bounded(
          Promise.resolve().then(() => {
            assertActive();
            return input.authorizeHandoff(selection);
          }),
        ),
      );
      let callbackFinished = false;
      let drainSeen = false;
      let handedOff = false;
      let requiresDrain = false;
      let resolveWrite: (() => void) | undefined;
      let rejectWrite: (() => void) | undefined;
      const complete = () => {
        if (handedOff && callbackFinished && (!requiresDrain || drainSeen))
          resolveWrite?.();
      };
      const drained = () => {
        drainSeen = true;
        complete();
      };
      const completion = new Promise<void>((resolve, reject) => {
        resolveWrite = resolve;
        rejectWrite = () => {
          reject(new PreviewNodeSinkUnavailable());
        };
      });
      void completion.catch(() => undefined);
      output.on("drain", drained);
      try {
        // Final synchronous guard at the native handoff. In particular, no
        // promise/await can allow abort or expiry between this and write().
        assertActive(handoffExpiresAt);
        requiresDrain = !output.write(bytes, (error?: Error | null) => {
          if (controller.signal.aborted || finished) return;
          if (error !== undefined && error !== null) {
            rejectWrite?.();
            stop();
            return;
          }
          callbackFinished = true;
          complete();
        });
        bytesHandedOff += bytes.byteLength;
        handedOff = true;
        complete();
        await bounded(completion);
        assertActive();
      } finally {
        output.removeListener("drain", drained);
      }
    } catch {
      stop();
      throw new PreviewNodeSinkUnavailable();
    }
  }

  async function close(): Promise<void> {
    try {
      assertActive();
      closing = true;
      await bounded(
        new Promise<void>((resolve, reject) => {
          output.end((error?: Error | null) => {
            if (error !== undefined && error !== null)
              reject(new PreviewNodeSinkUnavailable());
            else resolve();
          });
        }),
      );
      if (
        controller.signal.aborted ||
        input.signal.aborted ||
        performance.now() >= stopAt ||
        !output.writableFinished
      )
        throw new PreviewNodeSinkUnavailable();
      finished = true;
      cleanup();
    } catch {
      stop();
      throw new PreviewNodeSinkUnavailable();
    }
  }

  const deadline = setTimeout(stop, limits.deadlineMilliseconds);
  return new WritableStream<Uint8Array>(
    {
      start(value) {
        streamController = value;
        // The pinned Node runtime provides this Web Streams abort signal; its
        // installed type declarations lag the runtime. Validate, never assume.
        if (!("signal" in value) || !(value.signal instanceof AbortSignal)) {
          clearTimeout(deadline);
          throw new PreviewNodeSinkUnavailable();
        }
        webSignal = value.signal;
        webSignal.addEventListener("abort", stop, { once: true });
        input.signal.addEventListener("abort", stop, { once: true });
        // Retain the content-free error observer until native close, including
        // late write/_destroy errors. An uncooperative socket cannot hold a wait.
        output.on("error", stop);
        output.on("finish", onFinish);
        output.once("close", onClose);
        if (input.signal.aborted) stop();
      },
      write,
      close,
      abort() {
        stop();
      },
    },
    { highWaterMark: 1, size: (bytes) => bytes.byteLength },
  );
}
