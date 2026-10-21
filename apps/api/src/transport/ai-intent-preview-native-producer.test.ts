import { Writable } from "node:stream";
import {
  aiIntentPreviewFrameV1Schema,
  type AiIntentPreviewFrameV1,
} from "@cloudmarkup/api-contract";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { modelIntentExtractionResponseV1Schema } from "@cloudmarkup/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiPreviewFixture } from "../adapters/persistence/ai-intent-preview-test-helpers.js";
import { streamAiIntentPreviewToNodeV1 } from "./ai-intent-preview-native-producer.js";

type Input = Parameters<typeof streamAiIntentPreviewToNodeV1>[0];
type Emission = Parameters<Parameters<Input["execute"]>[0]["emit"]>[0];
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
const cleanups: (() => void)[] = [];
function emission(): Emission {
  const candidate = modelIntentExtractionResponseV1Schema.parse(
    aiPreviewFixture().result.response,
  );
  return {
    candidate,
    delivery: {
      contractVersion: 1,
      invocationId: candidate.provenance.invocationId,
      outputDigest: digestStructuredValue(candidate),
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      token: "A".repeat(43),
    },
    signal: new AbortController().signal,
    assertCurrentEmission: vi.fn(() => Promise.resolve()),
  };
}
function fixture() {
  const value = emission();
  const chunks: Buffer[] = [];
  const request = new AbortController();
  const authorize = vi.fn<Input["assertCurrentAuthority"]>(() =>
    Promise.resolve({
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    }),
  );
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  cleanups.push(() => {
    request.abort();
    output.destroy();
  });
  const run = (execute: Input["execute"], extra: Partial<Input> = {}) =>
    streamAiIntentPreviewToNodeV1({
      output,
      invocationId: value.delivery.invocationId,
      signal: request.signal,
      execute,
      assertCurrentAuthority: authorize,
      limits,
      ...extra,
    });
  const frames = (): AiIntentPreviewFrameV1[] =>
    chunks.map((chunk) =>
      aiIntentPreviewFrameV1Schema.parse(
        JSON.parse(
          chunk
            .toString("utf8")
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6) ?? "null",
        ),
      ),
    );
  return { value, chunks, request, authorize, output, run, frames };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T18:00:00.000Z"));
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("request-local native preview producer", () => {
  it("joins the real framer and native sink, rechecking each frame and exact candidate twice", async () => {
    const f = fixture();
    const execute = vi.fn<Input["execute"]>(async ({ emit }) => {
      await emit(f.value);
      return completed;
    });
    expect(await f.run(execute)).toEqual({
      contractVersion: 1,
      outcome: "finished",
      candidateWritten: true,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      f
        .frames()
        .map((frame) => (frame.type === "status" ? frame.code : frame.type)),
    ).toEqual(["processing", "candidate", "finished"]);
    expect(f.frames()[1]).toMatchObject({
      candidate: f.value.candidate,
      delivery: f.value.delivery,
    });
    expect(f.authorize).toHaveBeenCalledTimes(3);
    expect(f.value.assertCurrentEmission).toHaveBeenCalledTimes(2);
    expect(f.output.writableFinished).toBe(true);
  });
  it("writes only result-unavailable metadata for a content-free duplicate", async () => {
    const f = fixture();
    const result = await f.run(() => Promise.resolve(unavailable));
    expect(result).toEqual({
      contractVersion: 1,
      outcome: "result-unavailable",
      candidateWritten: false,
    });
    expect(
      f
        .frames()
        .map((frame) => (frame.type === "status" ? frame.code : frame.type)),
    ).toEqual(["processing", "result-unavailable"]);
  });
  it("denies before application execution when current host authority is missing", async () => {
    const f = fixture();
    f.authorize.mockRejectedValue(
      new Error("private synthetic authority failure"),
    );
    const execute = vi.fn<Input["execute"]>();
    expect(await f.run(execute)).toMatchObject({
      outcome: "unavailable",
      candidateWritten: false,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(f.chunks).toEqual([]);
    expect(f.output.destroyed).toBe(true);
  });
  it.each(["invalid", "2026-09-09T18:00:00.000Z"])(
    "denies invalid or expired host intervals (%s)",
    async (expiresAt) => {
      const f = fixture();
      f.authorize.mockResolvedValue({ expiresAt });
      const execute = vi.fn<Input["execute"]>();
      expect(await f.run(execute)).toMatchObject({
        outcome: "unavailable",
        candidateWritten: false,
      });
      expect(execute).not.toHaveBeenCalled();
      expect(f.chunks).toEqual([]);
    },
  );
  it("rejects a candidate for a different server invocation even if its internal IDs agree", async () => {
    const f = fixture();
    await f.run(
      async ({ emit }) => {
        await emit(f.value);
        return completed;
      },
      {
        invocationId: "invocation_different",
      },
    );
    expect(f.frames().some((frame) => frame.type === "candidate")).toBe(false);
    expect(f.value.assertCurrentEmission).not.toHaveBeenCalled();
  });
  it("does not write candidate bytes when execution is revoked only at the native handoff", async () => {
    const f = fixture();
    const verify = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("private execution revocation"));
    const result = await f.run(async ({ emit }) => {
      await emit({ ...f.value, assertCurrentEmission: verify });
      return completed;
    });
    expect(result).toMatchObject({
      outcome: "unavailable",
      candidateWritten: false,
    });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(f.frames().some((frame) => frame.type === "candidate")).toBe(false);
    expect(f.output.destroyed).toBe(true);
  });
  it("rechecks host scope after candidate execution authority completes", async () => {
    const f = fixture();
    f.authorize
      .mockResolvedValueOnce({
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      })
      .mockRejectedValueOnce(new Error("private project fence"));
    const result = await f.run(async ({ emit }) => {
      await emit(f.value);
      return completed;
    });
    expect(result.candidateWritten).toBe(false);
    expect(f.value.assertCurrentEmission).toHaveBeenCalledTimes(2);
    expect(f.frames()).toHaveLength(1);
  });
  it("denies delivery that expires while the final native authority check is awaited", async () => {
    const f = fixture();
    let checks = 0;
    const verify = vi.fn(() => {
      checks++;
      if (checks === 2) vi.setSystemTime(new Date(f.value.delivery.expiresAt));
      return Promise.resolve();
    });
    const result = await f.run(async ({ emit }) => {
      await emit({ ...f.value, assertCurrentEmission: verify });
      return completed;
    });
    expect(result.candidateWritten).toBe(false);
    expect(f.frames()).toHaveLength(1);
  });
  it("observes application cancellation during the final current-scope await", async () => {
    const f = fixture();
    const application = new AbortController();
    let checks = 0;
    f.authorize.mockImplementation(() => {
      checks++;
      if (checks === 2) application.abort();
      return Promise.resolve({
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
    });
    const result = await f.run(async ({ emit }) => {
      await emit({ ...f.value, signal: application.signal });
      return completed;
    });
    expect(result.candidateWritten).toBe(false);
    expect(f.frames()).toHaveLength(1);
  });
  it("snapshots candidate and proof before a caller mutates its original objects", async () => {
    const f = fixture();
    const original = structuredClone(f.value.candidate);
    await f.run(async ({ emit }) => {
      const pending = emit(f.value);
      Reflect.set(
        f.value.candidate.provenance,
        "invocationId",
        "invocation_mutated",
      );
      Reflect.set(f.value.delivery, "token", "B".repeat(43));
      await pending;
      return completed;
    });
    expect(f.frames()[1]).toMatchObject({
      type: "candidate",
      candidate: original,
      delivery: { token: "A".repeat(43) },
    });
  });
  it("bounds uncooperative host verification and never invokes after its late resolution", async () => {
    const f = fixture();
    let release: (() => void) | undefined;
    f.authorize.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ expiresAt: new Date(Date.now() + 60000).toISOString() });
          };
        }),
    );
    const execute = vi.fn<Input["execute"]>();
    const pending = f.run(execute);
    await vi.advanceTimersByTimeAsync(60);
    expect(await pending).toMatchObject({
      outcome: "unavailable",
      candidateWritten: false,
    });
    release?.();
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
    expect(f.chunks).toEqual([]);
    expect(f.output.destroyed).toBe(true);
  });
  it("stops a disconnected request before application execution", async () => {
    const f = fixture();
    f.request.abort();
    const execute = vi.fn<Input["execute"]>();
    expect(await f.run(execute)).toMatchObject({ outcome: "unavailable" });
    expect(execute).not.toHaveBeenCalled();
    expect(f.chunks).toEqual([]);
  });
  it("does not emit a second candidate", async () => {
    const f = fixture();
    const result = await f.run(async ({ emit }) => {
      await emit(f.value);
      await emit(f.value);
      return completed;
    });
    expect(result.outcome).toBe("unavailable");
    expect(
      f.frames().filter((frame) => frame.type === "candidate"),
    ).toHaveLength(1);
  });
  it("refuses bad frame digests before native candidate authority", async () => {
    const f = fixture();
    const result = await f.run(async ({ emit }) => {
      await emit({
        ...f.value,
        delivery: {
          ...f.value.delivery,
          outputDigest: digestStructuredValue("synthetic mismatched candidate"),
        },
      });
      return completed;
    });
    expect(result.candidateWritten).toBe(false);
    expect(f.value.assertCurrentEmission).not.toHaveBeenCalled();
    expect(f.frames().some((frame) => frame.type === "candidate")).toBe(false);
  });
  it.each([
    { heartbeatMilliseconds: 5001 },
    { deadlineMilliseconds: 180001 },
    { totalBytes: 0 },
  ])(
    "validates all limits before installing an output listener %#",
    async (invalid) => {
      const f = fixture();
      const execute = vi.fn<Input["execute"]>();
      await expect(f.run(execute, { limits: invalid })).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
      expect(f.output.listenerCount("error")).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
