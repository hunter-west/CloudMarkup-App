import type { UnderlyingSink } from "node:stream/web";
import { aiIntentPreviewFrameV1Schema } from "@cloudmarkup/api-contract";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { modelIntentExtractionResponseV1Schema } from "@cloudmarkup/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiPreviewFixture } from "../adapters/persistence/ai-intent-preview-test-helpers.js";
import {
  AI_INTENT_PREVIEW_SSE_HEADERS_V1,
  streamAiIntentPreviewV1,
} from "./ai-intent-preview-stream.js";

type Input = Parameters<typeof streamAiIntentPreviewV1>[0];
type Execute = Input["execute"];
type Emit = Parameters<Execute>[0]["emit"];
const completed = { contractVersion: 1, delivery: "memory-only" } as const;
const unavailable = {
  contractVersion: 1,
  delivery: "result-unavailable",
} as const;
const limits = {
  heartbeatMilliseconds: 20,
  backpressureMilliseconds: 50,
  deadlineMilliseconds: 200,
};

function deferred<T = void>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {
    throw new Error("Uninitialized synthetic deferred.");
  };
  let reject: (reason: unknown) => void = () => {
    throw new Error("Uninitialized synthetic deferred.");
  };
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// Synthetic stream/application callback only: no authentication, provider,
// normal-runtime admission, billing, delivery ACK or persistence is exercised.
function emission() {
  const candidate = modelIntentExtractionResponseV1Schema.parse(
    aiPreviewFixture().result.response,
  );
  const application = new AbortController();
  return {
    candidate,
    delivery: {
      contractVersion: 1 as const,
      invocationId: candidate.provenance.invocationId,
      outputDigest: digestStructuredValue(candidate),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      token: "A".repeat(43),
    },
    signal: application.signal,
    assertCurrentEmission: vi.fn((): Promise<void> => Promise.resolve()),
    application,
  };
}

function harness(sink: UnderlyingSink<Uint8Array> = {}) {
  const chunks: string[] = [];
  const request = new AbortController();
  const output = new WritableStream<Uint8Array>({
    ...sink,
    write(bytes, controller) {
      chunks.push(new TextDecoder().decode(bytes));
      return sink.write?.(bytes, controller);
    },
  });
  return {
    chunks,
    request,
    output,
    run: (execute: Execute, overrides: Partial<Input> = {}) =>
      streamAiIntentPreviewV1({
        output,
        signal: request.signal,
        execute,
        limits,
        ...overrides,
      }),
    frames: () =>
      chunks.map((chunk) => {
        const data = chunk
          .split("\n")
          .find((line) => line.startsWith("data: "));
        return aiIntentPreviewFrameV1Schema.parse(
          JSON.parse(data?.slice(6) ?? "null"),
        );
      }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("request-local memory-only preview transport", () => {
  it("writes one exact schema/digest-bound candidate and transport-only completion", async () => {
    const h = harness();
    const value = emission();
    const execute = vi.fn<Execute>(async ({ emit }) => {
      await emit(value);
      return {
        ...completed,
        execution: { privateEvidence: "never serialize" },
      };
    });
    expect(await h.run(execute)).toEqual({
      contractVersion: 1,
      outcome: "finished",
      candidateWritten: true,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(value.assertCurrentEmission).toHaveBeenCalledTimes(1);
    expect(h.frames()).toEqual([
      { contractVersion: 1, type: "status", code: "processing" },
      {
        contractVersion: 1,
        type: "candidate",
        candidate: value.candidate,
        delivery: value.delivery,
      },
      { contractVersion: 1, type: "status", code: "finished" },
    ]);
    expect(h.chunks.join("")).not.toMatch(
      /(?:^|\n)(?:id|retry):|privateEvidence|never serialize/u,
    );
    expect(AI_INTENT_PREVIEW_SSE_HEADERS_V1["cache-control"]).toBe(
      "private, no-store, no-transform",
    );
    expect(AI_INTENT_PREVIEW_SSE_HEADERS_V1["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(h.output.locked).toBe(false);
  });

  it("returns a distinct result-unavailable state without re-emitting internal results", async () => {
    const h = harness();
    expect(await h.run(() => Promise.resolve(unavailable))).toEqual({
      contractVersion: 1,
      outcome: "result-unavailable",
      candidateWritten: false,
    });
    expect(
      h.frames().map((frame) => frame.type === "status" && frame.code),
    ).toEqual(["processing", "result-unavailable"]);
  });

  it("escapes SSE-looking content and measures exact UTF-8 frame bytes", async () => {
    const first = harness();
    const value = emission();
    value.candidate.intentDocument.application.summary =
      "Résumé notes.\n\nevent: forged\ndata: {}";
    value.delivery.outputDigest = digestStructuredValue(value.candidate);
    const execute: Execute = async ({ emit }) => {
      await emit(value);
      return completed;
    };
    expect((await first.run(execute)).outcome).toBe("finished");
    const chunk = first.chunks[1];
    if (chunk === undefined) throw new Error("Synthetic frame missing.");
    expect(chunk.split("\n")).toHaveLength(4);
    expect(chunk).not.toMatch(/\nevent: forged/u);
    expect(first.frames()[1]).toMatchObject({ candidate: value.candidate });
    const byteLength = new TextEncoder().encode(chunk).byteLength;
    expect(byteLength).toBeGreaterThan(chunk.length);
    const exact = harness();
    expect(
      (
        await exact.run(execute, {
          limits: { ...limits, candidateFrameBytes: byteLength },
        })
      ).outcome,
    ).toBe("finished");
    const short = harness();
    expect(
      (
        await short.run(execute, {
          limits: { ...limits, candidateFrameBytes: byteLength - 1 },
        })
      ).outcome,
    ).toBe("unavailable");
    expect(short.frames().every((frame) => frame.type === "status")).toBe(true);
  });

  it("rechecks proof expiry after the final asynchronous host authority check", async () => {
    const authority = deferred();
    const value = emission();
    value.delivery.expiresAt = new Date(Date.now() + 10).toISOString();
    value.assertCurrentEmission.mockImplementation(() => authority.promise);
    const h = harness();
    const task = h.run(async ({ emit }) => {
      await emit(value);
      return completed;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(value.assertCurrentEmission).toHaveBeenCalledTimes(1);
    authority.resolve();
    expect((await task).outcome).toBe("unavailable");
    expect(h.frames().every((frame) => frame.type === "status")).toBe(true);
  });

  it("uses only bounded safe heartbeats while awaiting the application's separate outcome", async () => {
    const h = harness();
    const permit = deferred();
    const outcome = deferred<typeof completed>();
    const task = h.run(async ({ emit }) => {
      await permit.promise;
      await emit(emission());
      return outcome.promise;
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(h.frames().at(-1)).toMatchObject({ code: "processing" });
    permit.resolve();
    await vi.advanceTimersByTimeAsync(20);
    expect(h.frames().at(-1)).toMatchObject({
      code: "awaiting-acknowledgement",
    });
    outcome.resolve(completed);
    expect((await task).outcome).toBe("finished");
    const count = h.chunks.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.chunks).toHaveLength(count);
  });

  it.each([
    [
      "digest",
      (value: ReturnType<typeof emission>) => {
        value.delivery.outputDigest = digestStructuredValue(
          "different synthetic output",
        );
      },
    ],
    [
      "identity",
      (value: ReturnType<typeof emission>) => {
        Object.assign(value.delivery, { invocationId: "foreign_execution" });
      },
    ],
    [
      "token",
      (value: ReturnType<typeof emission>) => {
        value.delivery.token = "A".repeat(42) + "B";
      },
    ],
    [
      "instant",
      (value: ReturnType<typeof emission>) => {
        value.delivery.expiresAt = "2026-09-06T12:00:30Z";
      },
    ],
    [
      "expired",
      (value: ReturnType<typeof emission>) => {
        value.delivery.expiresAt = new Date(Date.now()).toISOString();
      },
    ],
    [
      "unsafe output",
      (value: ReturnType<typeof emission>) => {
        value.candidate.proposalContext.confidence.rationale =
          "Bearer " + "synthetic-credential-marker";
        value.delivery.outputDigest = digestStructuredValue(value.candidate);
      },
    ],
    [
      "source schema",
      (value: ReturnType<typeof emission>) => {
        Object.assign(value.candidate, { operation: "architecture.propose" });
        value.delivery.outputDigest = digestStructuredValue(value.candidate);
      },
    ],
  ] as const)("rejects %s before candidate bytes", async (_name, alter) => {
    const h = harness();
    const value = emission();
    alter(value);
    expect(
      (
        await h.run(async ({ emit }) => {
          await emit(value);
          return completed;
        })
      ).outcome,
    ).toBe("unavailable");
    expect(h.frames().every((frame) => frame.type === "status")).toBe(true);
    expect(h.chunks.join("")).not.toContain("synthetic-credential-marker");
  });

  it("copies candidate, proof and authority callback before any asynchronous wait", async () => {
    const ready = deferred();
    const h = harness();
    const value = emission();
    const original = structuredClone({
      candidate: value.candidate,
      delivery: value.delivery,
    });
    value.assertCurrentEmission.mockImplementation(() => ready.promise);
    const substitute = vi.fn((): Promise<void> => Promise.resolve());
    const task = h.run(async ({ emit }) => {
      const pending = emit(value);
      value.candidate.proposalContext.confidence.rationale =
        "Changed after validation";
      value.delivery.token = "invalid-after-copy";
      value.assertCurrentEmission = substitute;
      await pending;
      return completed;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(substitute).not.toHaveBeenCalled();
    expect(h.frames()).toHaveLength(1);
    ready.resolve();
    expect((await task).outcome).toBe("finished");
    expect(h.frames()[1]).toEqual({
      contractVersion: 1,
      type: "candidate",
      ...original,
    });
  });

  it.each(["concurrent", "sequential"])(
    "rejects %s duplicate emissions without a second candidate",
    async (kind) => {
      const h = harness();
      const task = h.run(async ({ emit }) => {
        if (kind === "concurrent")
          await Promise.all([emit(emission()), emit(emission())]);
        else {
          await emit(emission());
          await emit(emission());
        }
        return completed;
      });
      expect((await task).outcome).toBe("unavailable");
      expect(
        h.frames().filter((frame) => frame.type === "candidate"),
      ).toHaveLength(kind === "concurrent" ? 0 : 1);
    },
  );

  it.each(["request", "application", "deadline"])(
    "invalidates pending authority and future emissions on %s cancellation",
    async (kind) => {
      const authority = deferred();
      const h = harness();
      const value = emission();
      value.assertCurrentEmission.mockImplementation(() => authority.promise);
      let retained: Emit | undefined;
      const task = h.run(
        async ({ emit }) => {
          retained = emit;
          await emit(value);
          return completed;
        },
        { limits: { ...limits, deadlineMilliseconds: 40 } },
      );
      await vi.advanceTimersByTimeAsync(0);
      if (kind === "request") h.request.abort();
      else if (kind === "application") value.application.abort();
      else await vi.advanceTimersByTimeAsync(40);
      expect((await task).outcome).toBe("unavailable");
      authority.resolve();
      await expect(retained?.(emission())).rejects.toThrow(
        "memory-only preview stream is unavailable",
      );
      expect(h.frames().every((frame) => frame.type === "status")).toBe(true);
    },
  );

  it("stops on application cancellation after candidate write while the callback ignores abort", async () => {
    const h = harness();
    const value = emission();
    const result = deferred<typeof completed>();
    const task = h.run(async ({ emit }) => {
      await emit(value);
      return result.promise;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.frames()[1]?.type).toBe("candidate");
    value.application.abort();
    expect(await task).toMatchObject({
      outcome: "unavailable",
      candidateWritten: true,
    });
    result.reject(new Error("late internal failure"));
    await vi.advanceTimersByTimeAsync(0);
  });

  it("enforces the hard deadline even when execute ignores abort, and handles its late rejection", async () => {
    const h = harness();
    const result = deferred<typeof completed>();
    let retained: Emit | undefined;
    const task = h.run(({ emit }) => {
      retained = emit;
      return result.promise;
    });
    await vi.advanceTimersByTimeAsync(200);
    expect((await task).outcome).toBe("unavailable");
    await expect(retained?.(emission())).rejects.toThrow(
      "memory-only preview stream is unavailable",
    );
    const count = h.chunks.length;
    result.reject(new Error("private delayed error"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.chunks).toHaveLength(count);
    expect(h.chunks.join("")).not.toContain("private delayed error");
  });

  it.each(["request", "application", "deadline", "backpressure"])(
    "bounds an uncooperative candidate write on %s",
    async (kind) => {
      const pending = deferred();
      const value = emission();
      const h = harness({
        write(bytes) {
          return new TextDecoder().decode(bytes).includes('"type":"candidate"')
            ? pending.promise
            : undefined;
        },
        abort: () => new Promise<void>(() => undefined),
      });
      const task = h.run(
        async ({ emit }) => {
          await emit(value);
          return completed;
        },
        {
          limits: {
            ...limits,
            ...(kind === "deadline" ? { deadlineMilliseconds: 40 } : {}),
          },
        },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(h.frames()[1]?.type).toBe("candidate");
      if (kind === "request") h.request.abort();
      else if (kind === "application") value.application.abort();
      else await vi.advanceTimersByTimeAsync(kind === "deadline" ? 40 : 50);
      // Bytes already handed to a sink cannot be retracted. Neither write nor this
      // metadata response is a delivery acknowledgement or settlement authority.
      expect(await task).toMatchObject({
        outcome: "unavailable",
        candidateWritten: false,
      });
      const count = h.chunks.length;
      pending.reject(new Error("late sink diagnostic"));
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.chunks).toHaveLength(count);
    },
  );

  it("bounds ready backpressure before starting the application", async () => {
    const h = harness();
    const execute = vi.fn<Execute>(() => Promise.resolve(unavailable));
    const output = new WritableStream<Uint8Array>({}, { highWaterMark: 0 });
    const task = h.run(execute, { output });
    await vi.advanceTimersByTimeAsync(50);
    expect((await task).outcome).toBe("unavailable");
    expect(execute).not.toHaveBeenCalled();
    expect(output.locked).toBe(false);
  });

  it("bounds an uncooperative close without leaking its delayed rejection", async () => {
    const closing = deferred();
    const h = harness({ close: () => closing.promise });
    const task = h.run(() => Promise.resolve(unavailable));
    await vi.advanceTimersByTimeAsync(50);
    expect((await task).outcome).toBe("unavailable");
    closing.reject(new Error("private close diagnostics"));
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each(["candidate", "total"])(
    "enforces the %s byte cap without forwarding candidate bytes",
    async (kind) => {
      const h = harness();
      const task = h.run(
        async ({ emit }) => {
          await emit(emission());
          return completed;
        },
        {
          limits: {
            ...limits,
            ...(kind === "candidate"
              ? { candidateFrameBytes: 100 }
              : { totalBytes: 200 }),
          },
        },
      );
      expect((await task).outcome).toBe("unavailable");
      expect(h.frames().every((frame) => frame.type === "status")).toBe(true);
      expect(
        new TextEncoder().encode(h.chunks.join("")).byteLength,
      ).toBeLessThanOrEqual(200);
    },
  );

  it.each<[string, number]>([
    ["candidateFrameBytes", 262145],
    ["totalBytes", 278529],
    ["heartbeatMilliseconds", 5001],
    ["backpressureMilliseconds", 5001],
    ["deadlineMilliseconds", 180001],
    ["totalBytes", 0],
    ["totalBytes", Number.NaN],
    ["totalBytes", 1.5],
    ["unrecognized", 1],
    ["toString", 1],
    ["__proto__", 1],
  ])(
    "rejects host settings outside fixed lower-only limits: %s=%s",
    async (key, value) => {
      const h = harness();
      await expect(
        h.run(() => Promise.resolve(unavailable), {
          limits: { [key]: value },
        }),
      ).rejects.toThrow("memory-only preview stream is unavailable");
      expect(h.chunks).toHaveLength(0);
    },
  );

  it("reports only a safe error status and closes future admission when the application fails", async () => {
    const h = harness();
    let retained: Emit | undefined;
    expect(
      await h.run(({ emit }) => {
        retained = emit;
        return Promise.reject(
          new Error("private provider prompt and commercial detail"),
        );
      }),
    ).toMatchObject({ outcome: "unavailable", candidateWritten: false });
    await expect(retained?.(emission())).rejects.toThrow(
      "memory-only preview stream is unavailable",
    );
    expect(h.frames()).toEqual([
      { contractVersion: 1, type: "status", code: "processing" },
      { contractVersion: 1, type: "status", code: "unavailable" },
    ]);
    expect(h.chunks.join("")).not.toContain("private provider");
  });

  it("rejects a malformed application completion rather than asserting successful delivery", async () => {
    const h = harness();
    expect((await h.run(() => Promise.resolve(completed))).outcome).toBe(
      "unavailable",
    );
    expect(h.frames().every((frame) => frame.type === "status")).toBe(true);
  });

  it("rejects a locked output with a sanitized transport error", async () => {
    const h = harness();
    const lock = h.output.getWriter();
    await expect(h.run(() => Promise.resolve(unavailable))).rejects.toThrow(
      "memory-only preview stream is unavailable",
    );
    lock.releaseLock();
  });
});
