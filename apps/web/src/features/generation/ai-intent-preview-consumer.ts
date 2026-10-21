import {
  AI_INTENT_PREVIEW_SSE_EVENT_V1,
  AI_INTENT_PREVIEW_STREAM_LIMITS_V1,
  aiIntentPreviewDeliveryProofV1Schema,
  aiIntentPreviewFrameV1Schema,
  type AiIntentPreviewFrameV1,
  type AiIntentPreviewStatusCodeV1,
} from "@cloudmarkup/api-contract";
import { parseIntentDocument } from "@cloudmarkup/domain";
import { digestCanonicalValue } from "@cloudmarkup/schemas";

type CandidateFrame = Extract<AiIntentPreviewFrameV1, { type: "candidate" }>;
type DeliveryProof = CandidateFrame["delivery"];
interface Limits {
  candidateFrameBytes: number;
  totalBytes: number;
  deadlineMilliseconds: number;
  backpressureMilliseconds: number;
}

export interface AiIntentPreviewConsumptionV1 {
  readonly contractVersion: 1;
  /** Stream completion is not Intent acceptance or a commercial outcome. */
  readonly transport:
    "finished" | "result-unavailable" | "unavailable" | "interrupted";
  /** A successful synchronous handoff cannot be retracted after disconnect. */
  readonly candidateHandedOff: boolean;
  readonly acknowledgement: "not-attempted" | "confirmed" | "unconfirmed";
}

class PreviewUnavailable extends Error {
  constructor() {
    super("The memory-only preview could not be received.");
    this.name = "PreviewUnavailable";
  }
}
class PreviewInterrupted extends PreviewUnavailable {}

function limitsFor(input: Partial<Limits> | undefined): Limits {
  const limits: Limits = {
    candidateFrameBytes: AI_INTENT_PREVIEW_STREAM_LIMITS_V1.candidateFrameBytes,
    totalBytes: AI_INTENT_PREVIEW_STREAM_LIMITS_V1.totalBytes,
    deadlineMilliseconds:
      AI_INTENT_PREVIEW_STREAM_LIMITS_V1.deadlineMilliseconds,
    backpressureMilliseconds:
      AI_INTENT_PREVIEW_STREAM_LIMITS_V1.backpressureMilliseconds,
  };
  for (const [key, value] of Object.entries(input ?? {})) {
    if (
      !Object.hasOwn(limits, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > limits[key as keyof Limits]
    )
      throw new PreviewUnavailable();
    limits[key as keyof Limits] = value;
  }
  return limits;
}

/** One request-local reader, not an authenticated route or a replay client.
 * request/acknowledge are host-owned closures over the exact current identity,
 * organization, project, baseline and invocation. They must enforce same-origin
 * authenticated transport and validate the eventual ACK response themselves.
 * The existing proof schema is reused; no public ACK operation is invented here.
 * onCandidate must synchronously retain only in host RAM, never persistent state,
 * query caches, downloads or logs. Receipt ACK is deliberately before stream EOF:
 * the server may wait for it. Later transport failure MUST NOT discard that RAM
 * candidate, because an ACK may already have reached the server. Neither callback
 * accepts an Intent, mutates a graph, retries a request or enables a provider. */
export async function consumeAiIntentPreviewV1(input: {
  readonly expectedInvocationId: string;
  readonly signal: AbortSignal;
  readonly request: (input: {
    readonly signal: AbortSignal;
  }) => Promise<Response>;
  readonly acknowledge: (input: {
    readonly delivery: DeliveryProof;
    readonly signal: AbortSignal;
  }) => Promise<void>;
  /** Must finish synchronously and return undefined; other results fail closed. */
  readonly onCandidate: (candidate: CandidateFrame["candidate"]) => unknown;
  readonly onStatus?: (code: AiIntentPreviewStatusCodeV1) => unknown;
  /** Host/tests may lower the existing wire ceilings, never widen them. */
  readonly limits?: Partial<Limits>;
}): Promise<AiIntentPreviewConsumptionV1> {
  const limits = limitsFor(input.limits);
  const invocation =
    aiIntentPreviewDeliveryProofV1Schema.shape.invocationId.safeParse(
      input.expectedInvocationId,
    );
  if (!invocation.success) throw new PreviewUnavailable();
  const controller = new AbortController();
  const stopAt = performance.now() + limits.deadlineMilliseconds;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let transport: AiIntentPreviewConsumptionV1["transport"] = "unavailable";
  let candidateHandedOff = false;
  let acknowledgement: AiIntentPreviewConsumptionV1["acknowledgement"] =
    "not-attempted";
  let candidateSeen = false;
  let terminal: "finished" | "result-unavailable" | "unavailable" | undefined;
  let processingSeen = false;
  const stop = () => {
    controller.abort();
  };
  input.signal.addEventListener("abort", stop, { once: true });
  if (input.signal.aborted) stop();
  const deadline = setTimeout(stop, limits.deadlineMilliseconds);

  function assertActive(expiresAt?: string): void {
    if (
      controller.signal.aborted ||
      input.signal.aborted ||
      performance.now() >= stopAt
    )
      throw new PreviewInterrupted();
    if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.now())
      throw new PreviewUnavailable();
  }
  async function bounded<T>(
    work: () => Promise<T>,
    maximum = limits.deadlineMilliseconds,
  ): Promise<T> {
    assertActive();
    const observed = work().catch((error: unknown) => {
      throw error instanceof PreviewInterrupted
        ? error
        : new PreviewUnavailable();
    });
    void observed.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const interruption = new Promise<never>((_resolve, reject) => {
      abort = () => {
        reject(new PreviewInterrupted());
      };
      controller.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => {
          stop();
        },
        Math.min(maximum, Math.max(0, stopAt - performance.now())),
      );
      if (controller.signal.aborted) abort();
    });
    try {
      const value = await Promise.race([observed, interruption]);
      assertActive();
      return value;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort !== undefined)
        controller.signal.removeEventListener("abort", abort);
    }
  }
  function cancelBody(response: Response): void {
    try {
      void response.body?.cancel().catch(() => undefined);
    } catch {
      /* Closed body. */
    }
  }
  async function frame(bytes: Uint8Array): Promise<void> {
    assertActive();
    if (terminal !== undefined) throw new PreviewUnavailable();
    // This is the exact single-line versioned producer grammar, not a permissive
    // EventSource parser. IDs, retry, comments, CRLF and multiline data fail closed.
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    const lines = text.split("\n");
    if (
      lines.length !== 4 ||
      lines[0] !== `event: ${AI_INTENT_PREVIEW_SSE_EVENT_V1}` ||
      !lines[1]?.startsWith("data: ") ||
      lines[2] !== "" ||
      lines[3] !== ""
    )
      throw new PreviewUnavailable();
    const parsed = aiIntentPreviewFrameV1Schema.parse(
      JSON.parse(lines[1].slice(6)) as unknown,
    );
    if (parsed.type === "status") {
      if (
        (!processingSeen && parsed.code !== "processing") ||
        (parsed.code === "awaiting-acknowledgement" && !candidateSeen) ||
        (parsed.code === "finished" &&
          (!candidateHandedOff || acknowledgement !== "confirmed")) ||
        (parsed.code === "result-unavailable" && candidateSeen)
      )
        throw new PreviewUnavailable();
      processingSeen = true;
      // The producer can queue a processing heartbeat while its candidate write
      // is pending. Ignore that delayed heartbeat without regressing host state.
      if (parsed.code === "processing" && candidateSeen) return;
      if (
        parsed.code === "finished" ||
        parsed.code === "result-unavailable" ||
        parsed.code === "unavailable"
      )
        terminal = parsed.code;
      const notified: unknown = input.onStatus?.(parsed.code);
      if (notified !== undefined) {
        void Promise.resolve(notified).catch(() => undefined);
        throw new PreviewUnavailable();
      }
      return;
    }
    if (
      !processingSeen ||
      candidateSeen ||
      parsed.delivery.invocationId !== invocation.data ||
      digestCanonicalValue(parsed.candidate) !== parsed.delivery.outputDigest
    )
      throw new PreviewUnavailable();
    candidateSeen = true;
    parseIntentDocument(parsed.candidate.intentDocument);
    // Parse has copied the untrusted JSON. Keep the content-free proof separate
    // before handing candidate ownership to the host (which may mutate its RAM).
    const delivery = { ...parsed.delivery };
    assertActive(delivery.expiresAt);
    const handoff: unknown = input.onCandidate(parsed.candidate);
    // Reject accidental async callbacks; validation/handoff must finish before ACK.
    if (handoff !== undefined) {
      void Promise.resolve(handoff).catch(() => undefined);
      throw new PreviewUnavailable();
    }
    candidateHandedOff = true;
    assertActive(delivery.expiresAt);
    acknowledgement = "unconfirmed";
    await bounded(
      () => {
        assertActive(delivery.expiresAt);
        return input.acknowledge({ delivery, signal: controller.signal });
      },
      Math.min(
        limits.backpressureMilliseconds,
        Date.parse(delivery.expiresAt) - Date.now(),
      ),
    );
    acknowledgement = "confirmed";
  }
  try {
    const response = await bounded(() => {
      const pending = input.request({ signal: controller.signal });
      void pending
        .then((value) => {
          if (controller.signal.aborted) cancelBody(value);
        })
        .catch(() => undefined);
      return pending;
    });
    if (
      response.status !== 200 ||
      response.redirected ||
      response.body === null ||
      response.headers.get("content-type")?.toLowerCase() !==
        "text/event-stream; charset=utf-8" ||
      response.headers.get("cache-control")?.toLowerCase() !==
        "private, no-store, no-transform"
    ) {
      cancelBody(response);
      throw new PreviewUnavailable();
    }
    reader = response.body.getReader();
    const bytes = new Uint8Array(limits.candidateFrameBytes);
    let used = 0;
    let total = 0;
    for (;;) {
      const next = await bounded(() => {
        if (reader === undefined) throw new PreviewUnavailable();
        return reader.read().catch(() => {
          throw new PreviewInterrupted();
        });
      });
      if (next.done) {
        if (used !== 0 || terminal === undefined)
          throw new PreviewInterrupted();
        transport = terminal;
        break;
      }
      if (
        !(next.value instanceof Uint8Array) ||
        total + next.value.byteLength > limits.totalBytes
      )
        throw new PreviewUnavailable();
      total += next.value.byteLength;
      for (const byte of next.value) {
        if (used === bytes.byteLength) throw new PreviewUnavailable();
        bytes[used++] = byte;
        if (used >= 2 && byte === 10 && bytes[used - 2] === 10) {
          await frame(bytes.subarray(0, used));
          used = 0;
        }
      }
    }
  } catch (error) {
    transport =
      error instanceof PreviewInterrupted || controller.signal.aborted
        ? "interrupted"
        : "unavailable";
  } finally {
    stop();
    clearTimeout(deadline);
    input.signal.removeEventListener("abort", stop);
    // Native cancellation may hang or reject after a stalled read. Observe it,
    // never wait past the request bound or propagate content-bearing errors.
    try {
      void reader?.cancel().catch(() => undefined);
    } catch {
      /* Closed reader. */
    }
    try {
      reader?.releaseLock();
    } catch {
      /* A detached read has no callback authority. */
    }
  }
  return { contractVersion: 1, transport, candidateHandedOff, acknowledgement };
}
