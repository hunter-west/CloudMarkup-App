import {
  AI_INTENT_PREVIEW_SSE_EVENT_V1,
  AI_INTENT_PREVIEW_STREAM_LIMITS_V1,
  aiIntentPreviewCandidateFrameV1Schema,
  aiIntentPreviewStatusFrameV1Schema,
  type AiIntentPreviewFrameV1,
  type AiIntentPreviewStatusCodeV1,
} from "@cloudmarkup/api-contract";
import { parseIntentDocument } from "@cloudmarkup/domain";
import {
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
} from "@cloudmarkup/model-gateway";
import { z } from "zod";

import type { AiIntentPreviewApplication } from "../application/ai-intent-preview.js";

export const AI_INTENT_PREVIEW_SSE_HEADERS_V1 = Object.freeze({
  "cache-control": "private, no-store, no-transform",
  "content-type": "text/event-stream; charset=utf-8",
  "content-security-policy": "sandbox",
  "x-content-type-options": "nosniff",
});

type ExecuteInput = Parameters<AiIntentPreviewApplication["execute"]>[0];
type Emit = ExecuteInput["emit"];
type Limits = {
  -readonly [Key in keyof typeof AI_INTENT_PREVIEW_STREAM_LIMITS_V1]: number;
};

// Classify only the transport outcome. The real application also returns
// private execution/accounting evidence, which must never enter the stream.
const applicationResultSchema = z.object({
  contractVersion: z.literal(1),
  delivery: z.enum(["memory-only", "result-unavailable"]),
});

export interface AiIntentPreviewStreamResultV1 {
  readonly contractVersion: 1;
  /** Transport completion only: never delivery acknowledgement, acceptance,
   * customer settlement or a successful model/runtime admission. */
  readonly outcome: "finished" | "result-unavailable" | "unavailable";
  readonly candidateWritten: boolean;
}

class PreviewStreamUnavailable extends Error {
  constructor() {
    super("The memory-only preview stream is unavailable.");
    this.name = "PreviewStreamUnavailable";
  }
}

export function checkedAiIntentPreviewStreamLimitsV1(
  input: Partial<Limits> | undefined,
): Limits {
  const result: Limits = { ...AI_INTENT_PREVIEW_STREAM_LIMITS_V1 };
  for (const [key, value] of Object.entries(input ?? {})) {
    if (
      !Object.hasOwn(AI_INTENT_PREVIEW_STREAM_LIMITS_V1, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > AI_INTENT_PREVIEW_STREAM_LIMITS_V1[key as keyof Limits]
    )
      throw new PreviewStreamUnavailable();
    result[key as keyof Limits] = value;
  }
  return result;
}

export function encodeAiIntentPreviewFrameV1(
  frame: AiIntentPreviewFrameV1,
): Uint8Array {
  // Compact JSON escapes content newlines. The canonical digest serializer is
  // intentionally pretty-printed and is not a single-line SSE wire encoding.
  return new TextEncoder().encode(
    `event: ${AI_INTENT_PREVIEW_SSE_EVENT_V1}\ndata: ${JSON.stringify(frame)}\n\n`,
  );
}

/** Request-local framing over a host-owned stream. The caller must authenticate,
 * resolve the exact application scope and attach the fixed headers separately.
 * No route, Lambda URL, storage, logger, provider or acknowledgement is created.
 * The host sink must synchronously hand off bytes at write() or own a final
 * signal/authority check immediately before any delayed physical network send.
 * Cancellation cannot retract bytes already handed to an uncooperative sink.
 * The bound callback may only call the existing preview application once. */
export async function streamAiIntentPreviewV1(input: {
  readonly output: WritableStream<Uint8Array>;
  readonly execute: (input: Pick<ExecuteInput, "emit" | "signal">) => Promise<{
    readonly contractVersion: 1;
    readonly delivery: "memory-only" | "result-unavailable";
  }>;
  readonly signal: AbortSignal;
  /** Hosts/tests may lower limits, never expand the versioned maximum. */
  readonly limits?: Partial<Limits>;
}): Promise<AiIntentPreviewStreamResultV1> {
  const limits = checkedAiIntentPreviewStreamLimitsV1(input.limits);
  const stopAt = performance.now() + limits.deadlineMilliseconds;
  const controller = new AbortController();
  let writer: WritableStreamDefaultWriter<Uint8Array>;
  try {
    writer = input.output.getWriter();
  } catch {
    throw new PreviewStreamUnavailable();
  }
  let bytesWritten = 0;
  let candidateClaimed = false;
  let candidateAdmissionClosed = false;
  let candidateWritten = false;
  let finished = false;
  let outcome: AiIntentPreviewStreamResultV1["outcome"] = "unavailable";
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let applicationSignal: AbortSignal | undefined;
  let chain = Promise.resolve();
  const stop = () => {
    controller.abort();
  };
  const deadline = setTimeout(stop, limits.deadlineMilliseconds);
  input.signal.addEventListener("abort", stop, { once: true });
  if (input.signal.aborted) stop();
  void writer.closed.catch(stop);

  function assertActive(signal?: AbortSignal): void {
    if (
      finished ||
      controller.signal.aborted ||
      input.signal.aborted ||
      signal?.aborted === true ||
      performance.now() >= stopAt
    )
      throw new PreviewStreamUnavailable();
  }

  async function bounded<T>(
    work: Promise<T>,
    signal?: AbortSignal,
    maximum = limits.backpressureMilliseconds,
  ): Promise<T> {
    // Attach before checking cancellation, including to late rejecting work.
    const observed = work.catch(() => {
      throw new PreviewStreamUnavailable();
    });
    void observed.catch(() => undefined);
    assertActive(signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => {
        reject(new PreviewStreamUnavailable());
      };
      controller.signal.addEventListener("abort", abort, { once: true });
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => {
          stop();
          abort?.();
        },
        Math.min(maximum, Math.max(0, stopAt - performance.now())),
      );
    });
    try {
      const value = await Promise.race([observed, interrupted]);
      assertActive(signal);
      return value;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort !== undefined) {
        controller.signal.removeEventListener("abort", abort);
        signal?.removeEventListener("abort", abort);
      }
    }
  }

  function serial(work: () => Promise<void>): Promise<void> {
    const next = chain.then(work).catch(() => {
      stop();
      throw new PreviewStreamUnavailable();
    });
    chain = next;
    void next.catch(() => undefined);
    return next;
  }

  async function write(
    bytes: Uint8Array,
    signal?: AbortSignal,
    authorize?: () => Promise<void>,
    expiresAt?: string,
  ): Promise<void> {
    assertActive(signal);
    if (bytesWritten + bytes.byteLength > limits.totalBytes)
      throw new PreviewStreamUnavailable();
    await bounded(writer.ready, signal);
    if (authorize !== undefined) await bounded(authorize(), signal);
    // No asynchronous operation occurs between this final host assertion and
    // the synchronous write invocation. A queued write is not delivery proof.
    assertActive(signal);
    if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.now())
      throw new PreviewStreamUnavailable();
    bytesWritten += bytes.byteLength;
    await bounded(writer.write(bytes), signal);
  }

  function status(code: AiIntentPreviewStatusCodeV1): Promise<void> {
    const bytes = encodeAiIntentPreviewFrameV1(
      aiIntentPreviewStatusFrameV1Schema.parse({
        contractVersion: 1,
        type: "status",
        code,
      }),
    );
    return serial(() => write(bytes));
  }

  const emit: Emit = (value) => {
    try {
      const signal = value.signal;
      const assertCurrentEmission = value.assertCurrentEmission;
      assertActive(signal);
      if (candidateClaimed || candidateAdmissionClosed)
        throw new PreviewStreamUnavailable();
      candidateClaimed = true;
      applicationSignal = signal;
      signal.addEventListener("abort", stop, { once: true });
      // Parse/copy and serialize before the first await: caller mutation during
      // backpressure/authorization cannot change the bytes whose digest passed.
      const frame = aiIntentPreviewCandidateFrameV1Schema.parse({
        contractVersion: 1,
        type: "candidate",
        candidate: value.candidate,
        delivery: value.delivery,
      });
      if (
        frame.delivery.outputDigest !==
          digestStructuredValue(frame.candidate) ||
        inspectModelValueForSecretCandidatesV1(frame.candidate)
          .detectedValueCount !== 0
      )
        throw new PreviewStreamUnavailable();
      parseIntentDocument(frame.candidate.intentDocument);
      const bytes = encodeAiIntentPreviewFrameV1(frame);
      if (bytes.byteLength > limits.candidateFrameBytes)
        throw new PreviewStreamUnavailable();
      return serial(async () => {
        await write(
          bytes,
          signal,
          assertCurrentEmission,
          frame.delivery.expiresAt,
        );
        candidateWritten = true;
      });
    } catch {
      stop();
      const rejected: Promise<void> = Promise.reject(
        new PreviewStreamUnavailable(),
      );
      void rejected.catch(() => undefined);
      return rejected;
    }
  };

  function heartbeat(): void {
    heartbeatTimer = setTimeout(() => {
      if (finished || candidateAdmissionClosed || controller.signal.aborted)
        return;
      void status(candidateWritten ? "awaiting-acknowledgement" : "processing")
        .then(heartbeat)
        .catch(stop);
    }, limits.heartbeatMilliseconds);
  }

  try {
    await status("processing");
    heartbeat();
    const result = applicationResultSchema.parse(
      await bounded(
        input.execute({ emit, signal: controller.signal }),
        undefined,
        limits.deadlineMilliseconds,
      ),
    );
    candidateAdmissionClosed = true;
    if ((result.delivery === "memory-only") !== candidateWritten)
      throw new PreviewStreamUnavailable();
    outcome =
      result.delivery === "memory-only" ? "finished" : "result-unavailable";
    if (heartbeatTimer !== undefined) clearTimeout(heartbeatTimer);
    await status(outcome);
    await bounded(writer.close());
  } catch {
    candidateAdmissionClosed = true;
    if (heartbeatTimer !== undefined) clearTimeout(heartbeatTimer);
    // A clean application failure can disclose only a closed safe status. Once
    // canceled/expired/backpressured, write nothing else, including heartbeats.
    if (!controller.signal.aborted && !input.signal.aborted) {
      try {
        await status("unavailable");
      } catch {
        stop();
      }
    }
    outcome = "unavailable";
    stop();
  } finally {
    finished = true;
    clearTimeout(deadline);
    if (heartbeatTimer !== undefined) clearTimeout(heartbeatTimer);
    input.signal.removeEventListener("abort", stop);
    applicationSignal?.removeEventListener("abort", stop);
    if (outcome === "unavailable") {
      // Native abort may wait behind an uncooperative underlying write. Observe
      // its rejection, but never let it extend cancellation or the hard deadline.
      try {
        void writer
          .abort(new PreviewStreamUnavailable())
          .catch(() => undefined);
      } catch {
        // A released/errored transport has no further write authority.
      }
    }
    try {
      writer.releaseLock();
    } catch {
      // Pending sink work is detached; every continuation is already observed.
    }
  }
  return { contractVersion: 1, outcome, candidateWritten };
}
