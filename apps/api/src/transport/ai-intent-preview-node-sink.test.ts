import { createHash } from "node:crypto";
import { Writable } from "node:stream";

import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { modelIntentExtractionResponseV1Schema } from "@cloudmarkup/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aiPreviewFixture } from "../adapters/persistence/ai-intent-preview-test-helpers.js";
import { createAiIntentPreviewNodeSinkV1 } from "./ai-intent-preview-node-sink.js";
import { streamAiIntentPreviewV1 } from "./ai-intent-preview-stream.js";

type SinkInput = Parameters<typeof createAiIntentPreviewNodeSinkV1>[0];
type Handoff = Awaited<ReturnType<SinkInput["authorizeHandoff"]>>;
const bytes = new TextEncoder().encode("synthetic frame");
const safeError = "The memory-only preview output is unavailable.";
const limits = { backpressureMilliseconds: 50, deadlineMilliseconds: 200 };
const cleanup: (() => void)[] = [];

function allowedHandoff(): Handoff {
  return { expiresAt: new Date(Date.now() + 30_000).toISOString() };
}

function deferred() {
  let resolve: (value?: Handoff) => void = () => {
    throw new Error("Synthetic deferred is uninitialized.");
  };
  let reject: (error: unknown) => void = () => {
    throw new Error("Synthetic deferred is uninitialized.");
  };
  const promise = new Promise<Handoff>((complete, fail) => {
    resolve = (value = allowedHandoff()) => {
      complete(value);
    };
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness(
  options: {
    readonly authorize?: SinkInput["authorizeHandoff"];
    readonly nativeFacade?: boolean;
    readonly holdWrite?: boolean;
    readonly holdEnd?: boolean;
    readonly holdDestroy?: boolean;
    readonly highWaterMark?: number;
    readonly limits?: SinkInput["limits"];
  } = {},
) {
  const chunks: Buffer[] = [];
  const callbacks: ((error?: Error | null) => void)[] = [];
  let endCallback: (() => void) | undefined;
  const output = new Writable({
    highWaterMark: options.highWaterMark ?? 16_384,
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callbacks.push(callback);
      if (options.holdWrite !== true) callback();
    },
    final(callback) {
      endCallback = callback;
      if (options.holdEnd !== true) callback();
    },
    destroy(_error, callback) {
      if (options.holdDestroy !== true) callback();
    },
  });
  const request = new AbortController();
  const authorize = vi.fn(
    options.authorize ?? (() => Promise.resolve(allowedHandoff())),
  );
  const nativeOutput: SinkInput["output"] =
    options.nativeFacade === true
      ? {
          destroy: output.destroy.bind(output),
          end: output.end.bind(output),
          on: output.on.bind(output),
          once: output.once.bind(output),
          removeListener: output.removeListener.bind(output),
          write: output.write.bind(output),
          get destroyed() {
            return output.destroyed;
          },
          get writable() {
            return output.writable;
          },
          get writableEnded() {
            return output.writableEnded;
          },
          get writableFinished() {
            return output.writableFinished;
          },
          get writableLength() {
            return output.writableLength;
          },
          get writableObjectMode() {
            return output.writableObjectMode;
          },
        }
      : output;
  const stream = createAiIntentPreviewNodeSinkV1({
    output: nativeOutput,
    signal: request.signal,
    authorizeHandoff: authorize,
    limits: { ...limits, ...options.limits },
  });
  cleanup.push(() => {
    request.abort();
    output.destroy();
  });
  const writer = stream.getWriter();
  void writer.closed.catch(() => undefined);
  return {
    output,
    request,
    authorize,
    stream,
    writer,
    chunks,
    callbacks,
    finish: () => endCallback?.(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("request-local native preview sink", () => {
  it("supports the AWS writable facade without an optional errored property", async () => {
    const h = harness({ nativeFacade: true });
    await h.writer.write(bytes);
    await h.writer.close();
    expect(h.chunks).toEqual([Buffer.from(bytes)]);
    expect(h.output.writableFinished).toBe(true);
  });
  it("still fences native facade errors before another write", async () => {
    const h = harness({ nativeFacade: true });
    h.output.emit("error", new Error("synthetic native facade failure"));
    await expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    expect(h.chunks).toEqual([]);
    expect(h.output.destroyed).toBe(true);
  });
  it("rechecks the exact host expiry at handoff after a valid guard has returned", async () => {
    let calls = 0;
    let returnedAt = 0;
    let expiresAt = 0;
    const h = harness({
      authorize: () => {
        calls++;
        if (calls === 1) return Promise.resolve(allowedHandoff());
        returnedAt = Date.now();
        expiresAt = returnedAt + 1;
        const authorized = { expiresAt: new Date(expiresAt).toISOString() };
        queueMicrotask(() => {
          vi.setSystemTime(expiresAt);
        });
        return Promise.resolve(authorized);
      },
    });
    // First establish that this host callback and exact schema can write.
    await h.writer.write(bytes);
    expect(h.chunks).toHaveLength(1);
    await expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    expect(returnedAt).toBeLessThan(expiresAt);
    expect(Date.now()).toBe(expiresAt);
    expect(h.authorize).toHaveBeenCalledTimes(2);
    expect(h.chunks).toHaveLength(1);
  });

  it.each<{ name: string; value: () => unknown }>([
    { name: "missing result", value: () => undefined },
    { name: "missing expiry", value: () => ({}) },
    { name: "numeric expiry", value: () => ({ expiresAt: Date.now() + 1 }) },
    {
      name: "invalid timestamp",
      value: () => ({ expiresAt: "2026-13-07T22:00:00.000Z" }),
    },
    {
      name: "noncanonical timestamp",
      value: () => ({ expiresAt: "2026-09-07T22:00:00Z" }),
    },
    {
      name: "extra content field",
      value: () => ({ ...allowedHandoff(), body: "synthetic private detail" }),
    },
    {
      name: "extra symbol field",
      value: () => ({ ...allowedHandoff(), [Symbol("extra")]: 1 }),
    },
    {
      name: "exactly expired",
      value: () => ({ expiresAt: new Date(Date.now()).toISOString() }),
    },
  ])(
    "rejects $name after first proving a valid host handoff",
    async ({ value }) => {
      let calls = 0;
      const h = harness({
        authorize: () => {
          calls++;
          // Deliberate runtime corruption beyond the host port's static signature.
          return Promise.resolve(
            calls === 1 ? allowedHandoff() : (value() as Handoff),
          );
        },
      });
      await h.writer.write(bytes);
      expect(h.chunks).toHaveLength(1);
      await expect(h.writer.write(bytes)).rejects.toThrow(safeError);
      expect(h.authorize).toHaveBeenCalledTimes(2);
      expect(h.chunks).toHaveLength(1);
      expect(h.output.destroyed).toBe(true);
    },
  );

  it("rejects accessor expiry without running it or disclosing its contents", async () => {
    const getter = vi.fn(() => allowedHandoff().expiresAt);
    let calls = 0;
    const h = harness({
      authorize: () => {
        calls++;
        const invalid = Object.defineProperty({}, "expiresAt", { get: getter });
        return Promise.resolve(
          calls === 1 ? allowedHandoff() : (invalid as Handoff),
        );
      },
    });
    await h.writer.write(bytes);
    await expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    expect(getter).not.toHaveBeenCalled();
    expect(h.chunks).toHaveLength(1);
  });

  it("hands off exact snapshotted bytes after fresh digest-bound authorization and ends cleanly", async () => {
    const guard = deferred();
    const h = harness({ authorize: () => guard.promise });
    const source = new Uint8Array(bytes);
    const written = h.writer.write(source);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.chunks).toHaveLength(0);
    expect(h.authorize.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    expect(h.authorize.mock.calls[0]?.[0]).toMatchObject({
      frameDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      byteLength: bytes.byteLength,
    });
    source.fill(0);
    guard.resolve();
    await written;
    expect(h.chunks).toEqual([Buffer.from(bytes)]);
    await h.writer.close();
    expect(h.output.writableFinished).toBe(true);
    expect(h.authorize).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("awaits native backpressure and completion before authorizing another serial frame", async () => {
    const h = harness({ holdWrite: true, highWaterMark: 1 });
    const first = h.writer.write(bytes);
    const second = h.writer.write(bytes);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.output.writableNeedDrain).toBe(true);
    expect(h.authorize).toHaveBeenCalledTimes(1);
    expect(h.chunks).toHaveLength(1);
    h.callbacks[0]?.();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(h.authorize).toHaveBeenCalledTimes(2);
    expect(h.chunks).toHaveLength(2);
    h.callbacks[1]?.();
    await second;
    await h.writer.close();
  });

  it("checks cancellation after authority resolves, before the synchronous native write", async () => {
    const request = new AbortController();
    const h = harness({
      authorize: () => {
        queueMicrotask(() => {
          request.abort();
        });
        return Promise.resolve(allowedHandoff());
      },
    });
    request.signal.addEventListener(
      "abort",
      () => {
        h.request.abort();
      },
      {
        once: true,
      },
    );
    await expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    expect(h.chunks).toHaveLength(0);
    expect(h.output.destroyed).toBe(true);
  });

  it.each(["request", "writer"] as const)(
    "cancels an uncooperative authority through %s abort without any later send",
    async (kind) => {
      const guard = deferred();
      const h = harness({ authorize: () => guard.promise, holdDestroy: true });
      const pending = h.writer.write(bytes);
      const rejected = expect(pending).rejects.toThrow(safeError);
      await vi.advanceTimersByTimeAsync(0);
      if (kind === "request") h.request.abort();
      else await h.writer.abort(new Error(safeError));
      await rejected;
      expect(h.authorize.mock.calls[0]?.[0].signal.aborted).toBe(true);
      guard.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.chunks).toHaveLength(0);
      await expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "times out authorization and observes its late %s without sending",
    async (completion) => {
      const guard = deferred();
      const h = harness({ authorize: () => guard.promise });
      const rejected = expect(h.writer.write(bytes)).rejects.toThrow(safeError);
      await vi.advanceTimersByTimeAsync(51);
      await rejected;
      if (completion === "resolve") guard.resolve();
      else guard.reject(new Error("synthetic private authorization detail"));
      await vi.advanceTimersByTimeAsync(0);
      expect(h.chunks).toHaveLength(0);
      expect(h.output.destroyed).toBe(true);
    },
  );

  it("enforces the request deadline even with a longer authorization wait", async () => {
    const guard = deferred();
    const h = harness({
      authorize: () => guard.promise,
      limits: { deadlineMilliseconds: 10 },
    });
    const rejected = expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    await vi.advanceTimersByTimeAsync(11);
    await rejected;
    guard.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.chunks).toHaveLength(0);
  });

  it("bounds a hung native callback and ignores its late success without claiming retraction", async () => {
    const h = harness({ holdWrite: true, holdDestroy: true });
    const rejected = expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    expect(h.chunks).toHaveLength(1);
    expect(h.output.destroyed).toBe(true);
    h.callbacks[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    await expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    expect(h.chunks).toHaveLength(1);
  });

  it("sanitizes native callback errors and denies all subsequent writes", async () => {
    const h = harness({ holdWrite: true });
    const rejected = expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    await vi.advanceTimersByTimeAsync(0);
    h.callbacks[0]?.(new Error("synthetic private provider output"));
    await rejected;
    await expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    expect(h.chunks).toHaveLength(1);
  });

  it("fails closed on premature native close", async () => {
    const guard = deferred();
    const h = harness({ authorize: () => guard.promise });
    const rejected = expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    await vi.advanceTimersByTimeAsync(0);
    h.output.destroy();
    await rejected;
    guard.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.chunks).toHaveLength(0);
  });

  it("bounds native end and ignores a late end callback", async () => {
    const h = harness({ holdEnd: true, holdDestroy: true });
    await h.writer.write(bytes);
    const rejected = expect(h.writer.close()).rejects.toThrow(safeError);
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    expect(h.output.destroyed).toBe(true);
    h.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.chunks).toHaveLength(1);
  });

  it("enforces exact frame and total byte limits before authorization or native writes", async () => {
    const h = harness({
      limits: {
        candidateFrameBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
      },
    });
    await h.writer.write(bytes);
    await expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    expect(h.chunks).toHaveLength(1);
    expect(h.authorize).toHaveBeenCalledTimes(1);
    const tooSmall = harness({
      limits: { candidateFrameBytes: bytes.byteLength - 1 },
    });
    await expect(tooSmall.writer.write(bytes)).rejects.toThrow(safeError);
    expect(tooSmall.authorize).not.toHaveBeenCalled();
  });

  it.each<NonNullable<SinkInput["limits"]> & Readonly<Record<string, number>>>([
    { deadlineMilliseconds: 180_001 },
    { backpressureMilliseconds: 5001 },
    { candidateFrameBytes: 256 * 1024 + 1 },
    { totalBytes: 272 * 1024 + 1 },
    { deadlineMilliseconds: 0 },
    { deadlineMilliseconds: Number.NaN },
    { deadlineMilliseconds: 1.5 },
    { toString: 1 },
  ])("rejects widened or malformed lower-only limits %j", (invalid) => {
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    expect(() =>
      createAiIntentPreviewNodeSinkV1({
        output,
        signal: new AbortController().signal,
        authorizeHandoff: () => Promise.resolve(allowedHandoff()),
        limits: invalid,
      }),
    ).toThrow(safeError);
    output.destroy();
  });

  it("rejects object-mode output and an already cancelled request", async () => {
    const output = new Writable({
      objectMode: true,
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    expect(() =>
      createAiIntentPreviewNodeSinkV1({
        output,
        signal: new AbortController().signal,
        authorizeHandoff: () => Promise.resolve(allowedHandoff()),
      }),
    ).toThrow(safeError);
    output.destroy();
    const h = harness();
    h.request.abort();
    await expect(h.writer.write(bytes)).rejects.toThrow(safeError);
    expect(h.authorize).not.toHaveBeenCalled();
  });
});

describe("existing framer with the native handoff adapter", () => {
  function candidate() {
    const value = modelIntentExtractionResponseV1Schema.parse(
      aiPreviewFixture().result.response,
    );
    return {
      candidate: value,
      delivery: {
        contractVersion: 1 as const,
        invocationId: value.provenance.invocationId,
        outputDigest: digestStructuredValue(value),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        token: "A".repeat(43),
      },
      signal: new AbortController().signal,
      assertCurrentEmission: vi.fn(() => Promise.resolve()),
    };
  }

  it("rechecks deferred native handoff after the framer's earlier emission guard", async () => {
    const guard = deferred();
    let calls = 0;
    const h = harness({
      authorize: () => {
        calls++;
        return calls === 2 ? guard.promise : Promise.resolve(allowedHandoff());
      },
    });
    h.writer.releaseLock();
    const value = candidate();
    const result = streamAiIntentPreviewV1({
      output: h.stream,
      signal: h.request.signal,
      execute: async ({ emit }) => {
        await emit(value);
        return { contractVersion: 1, delivery: "memory-only" };
      },
      limits: { ...limits, heartbeatMilliseconds: 20 },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(value.assertCurrentEmission).toHaveBeenCalledTimes(1);
    expect(h.authorize).toHaveBeenCalledTimes(2);
    expect(h.chunks).toHaveLength(1);
    h.request.abort();
    await expect(result).resolves.toEqual({
      contractVersion: 1,
      outcome: "unavailable",
      candidateWritten: false,
    });
    guard.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.chunks).toHaveLength(1);
  });

  it("does not send a candidate whose exact proof expires during deferred native authorization", async () => {
    const guard = deferred();
    const value = candidate();
    value.delivery.expiresAt = new Date(Date.now() + 10).toISOString();
    let calls = 0;
    const h = harness({
      authorize: () => {
        calls++;
        return calls === 2 ? guard.promise : Promise.resolve(allowedHandoff());
      },
    });
    h.writer.releaseLock();
    const result = streamAiIntentPreviewV1({
      output: h.stream,
      signal: h.request.signal,
      execute: async ({ emit }) => {
        await emit(value);
        return { contractVersion: 1, delivery: "memory-only" };
      },
      limits: { ...limits, heartbeatMilliseconds: 20 },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(value.assertCurrentEmission).toHaveBeenCalledTimes(1);
    expect(h.authorize).toHaveBeenCalledTimes(2);
    expect(h.chunks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);
    guard.resolve({ expiresAt: value.delivery.expiresAt });
    await expect(result).resolves.toEqual({
      contractVersion: 1,
      outcome: "unavailable",
      candidateWritten: false,
    });
    expect(h.chunks).toHaveLength(1);
  });
});
