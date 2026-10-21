import { createHash } from "node:crypto";
import {
  AI_INTENT_PREVIEW_SSE_EVENT_V1,
  type AiIntentPreviewFrameV1,
} from "@cloudmarkup/api-contract";
import {
  digestCanonicalValue,
  modelIntentExtractionResponseV1Schema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSyntheticAiPreviewCandidate as candidateFrame } from "./ai-intent-preview-test-helpers.js";
import { consumeAiIntentPreviewV1 } from "./ai-intent-preview-consumer.js";

type Input = Parameters<typeof consumeAiIntentPreviewV1>[0];
const invocationId = "preview_browser_synthetic";
const limits = { deadlineMilliseconds: 200, backpressureMilliseconds: 30 };
const headers = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "private, no-store, no-transform",
};
const encoder = new TextEncoder();
const status = (code: string) => ({ contractVersion: 1, type: "status", code });

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Missing synthetic resolver.");
  };
  let reject: (reason: unknown) => void = () => {
    throw new Error("Missing synthetic rejecter.");
  };
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function encode(value: unknown): Uint8Array {
  return Uint8Array.from(
    encoder.encode(
      `event: ${AI_INTENT_PREVIEW_SSE_EVENT_V1}\ndata: ${JSON.stringify(value)}\n\n`,
    ),
  );
}

function response(
  chunks: readonly Uint8Array[],
  options: {
    close?: boolean;
    cancel?: () => Promise<void>;
    status?: number;
    headers?: Record<string, string>;
  } = {},
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        // Node's TextEncoder and jsdom use different typed-array realms. Native
        // browser fetch supplies the consumer's own realm; reproduce that here.
        for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
        if (options.close !== false) controller.close();
      },
      ...(options.cancel === undefined ? {} : { cancel: options.cancel }),
    }),
    { status: options.status ?? 200, headers: options.headers ?? headers },
  );
}

function harness(
  chunks: readonly Uint8Array[] = [
    encode(status("processing")),
    encode(candidateFrame()),
    encode(status("finished")),
  ],
  options: Parameters<typeof response>[1] = {},
) {
  const signal = new AbortController();
  const retained: Extract<
    AiIntentPreviewFrameV1,
    { type: "candidate" }
  >["candidate"][] = [];
  const order: string[] = [];
  const request = vi.fn((): Promise<Response> =>
    Promise.resolve(response(chunks, options)),
  );
  const acknowledge = vi.fn(
    (value: Parameters<Input["acknowledge"]>[0]): Promise<void> => {
      order.push("ack");
      expect(retained).toHaveLength(1);
      expect(Object.keys(value.delivery).sort()).toEqual([
        "contractVersion",
        "expiresAt",
        "invocationId",
        "outputDigest",
        "token",
      ]);
      return Promise.resolve();
    },
  );
  const onCandidate = vi.fn(
    (candidate: Parameters<Input["onCandidate"]>[0]) => {
      retained.push(candidate);
      order.push("candidate");
    },
  );
  const onStatus = vi.fn<NonNullable<Input["onStatus"]>>();
  const run = (overrides: Partial<Input> = {}) =>
    consumeAiIntentPreviewV1({
      signal: signal.signal,
      expectedInvocationId: invocationId,
      request,
      acknowledge,
      onCandidate,
      onStatus,
      limits,
      ...overrides,
    });
  return {
    signal,
    retained,
    request,
    acknowledge,
    onCandidate,
    onStatus,
    order,
    run,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RAM-only preview consumer", () => {
  it("validates canonical bytes, hands off RAM first, ACKs only metadata and requires terminal EOF", async () => {
    const h = harness();
    expect(await h.run()).toEqual({
      contractVersion: 1,
      transport: "finished",
      candidateHandedOff: true,
      acknowledgement: "confirmed",
    });
    expect(h.order).toEqual(["candidate", "ack"]);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.acknowledge).toHaveBeenCalledTimes(1);
    expect(h.retained[0]).toEqual(candidateFrame().candidate);
    expect(h.onStatus.mock.calls.map(([code]) => code)).toEqual([
      "processing",
      "finished",
    ]);
    const value = candidateFrame().candidate;
    expect(digestCanonicalValue(value)).toBe(
      `sha256:${createHash("sha256").update(serializeCanonicalJson(value)).digest("hex")}`,
    );
  });

  it.each([1, 100000])(
    "accepts UTF-8 and delimiters split at %i-byte boundaries",
    async (size) => {
      const frame = candidateFrame();
      frame.candidate.intentDocument.application.summary =
        "Résumé – planning 🧭.\n\nevent: injected\ndata: {}";
      frame.delivery.outputDigest = digestCanonicalValue(frame.candidate);
      const text = [
        status("processing"),
        frame,
        status("awaiting-acknowledgement"),
        status("finished"),
      ]
        .map((item) => new TextDecoder().decode(encode(item)))
        .join("");
      const bytes = encoder.encode(text);
      const chunks: Uint8Array[] = [];
      for (let offset = 0; offset < bytes.length; offset += size)
        chunks.push(bytes.slice(offset, offset + size));
      const h = harness(chunks);
      expect((await h.run()).transport).toBe("finished");
      expect(h.retained[0]?.intentDocument.application.summary).toBe(
        frame.candidate.intentDocument.application.summary,
      );
    },
  );

  it("retains the handed-off candidate if ACK succeeds but finished/EOF never arrives", async () => {
    const cancel = vi.fn((): Promise<void> => Promise.resolve());
    const h = harness(
      [encode(status("processing")), encode(candidateFrame())],
      { close: false, cancel },
    );
    const pending = h.run();
    await vi.advanceTimersByTimeAsync(201);
    expect(await pending).toEqual({
      contractVersion: 1,
      transport: "interrupted",
      candidateHandedOff: true,
      acknowledgement: "confirmed",
    });
    expect(h.retained).toHaveLength(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("retains acknowledged RAM on EOF without a terminal status", async () => {
    const h = harness([encode(status("processing")), encode(candidateFrame())]);
    expect(await h.run()).toMatchObject({
      transport: "interrupted",
      candidateHandedOff: true,
      acknowledgement: "confirmed",
    });
    expect(h.retained).toHaveLength(1);
  });

  it("receives and ACKs before the server closes a stream waiting for the ACK", async () => {
    const h = harness();
    let control: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        control = value;
        value.enqueue(encode(status("processing")));
        value.enqueue(encode(candidateFrame()));
      },
    });
    const acknowledge = vi.fn((): Promise<void> => {
      expect(h.retained).toHaveLength(1);
      control?.enqueue(encode(status("finished")));
      control?.close();
      return Promise.resolve();
    });
    expect(
      (
        await h.run({
          request: () => Promise.resolve(new Response(body, { headers })),
          acknowledge,
        })
      ).transport,
    ).toBe("finished");
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it("never calls ACK when synchronous RAM handoff fails", async () => {
    const h = harness();
    expect(
      await h.run({
        onCandidate: () => {
          throw new Error("private candidate details");
        },
      }),
    ).toEqual({
      contractVersion: 1,
      transport: "unavailable",
      candidateHandedOff: false,
      acknowledgement: "not-attempted",
    });
    expect(h.acknowledge).not.toHaveBeenCalled();
  });

  it("rejects accidental asynchronous handoff and observes its rejection", async () => {
    const h = harness();
    expect(
      (
        await h.run({
          onCandidate: () =>
            Promise.reject(new Error("private callback details")),
        })
      ).acknowledgement,
    ).toBe("not-attempted");
    expect(h.acknowledge).not.toHaveBeenCalled();
  });

  it("ACK metadata remains bound when the host mutates its own RAM candidate", async () => {
    const value = candidateFrame();
    const h = harness();
    const acknowledge = vi.fn(
      (input: Parameters<Input["acknowledge"]>[0]): Promise<void> => {
        expect(input.delivery).toEqual(value.delivery);
        return Promise.resolve();
      },
    );
    expect(
      (
        await h.run({
          onCandidate: (candidate) => {
            candidate.intentDocument.application.summary =
              "Local RAM edit, not accepted.";
          },
          acknowledge,
        })
      ).transport,
    ).toBe("finished");
  });

  it.each(["result-unavailable", "unavailable"])(
    "returns the closed %s status without regeneration or ACK",
    async (code) => {
      const h = harness([encode(status("processing")), encode(status(code))]);
      expect(await h.run()).toEqual({
        contractVersion: 1,
        transport: code,
        candidateHandedOff: false,
        acknowledgement: "not-attempted",
      });
      expect(h.request).toHaveBeenCalledTimes(1);
      expect(h.acknowledge).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "unknown event",
      `event: other\ndata: ${JSON.stringify(status("processing"))}\n\n`,
    ],
    [
      "retry",
      `retry: 100\nevent: ${AI_INTENT_PREVIEW_SSE_EVENT_V1}\ndata: {}\n\n`,
    ],
    [
      "id",
      `id: secret\nevent: ${AI_INTENT_PREVIEW_SSE_EVENT_V1}\ndata: {}\n\n`,
    ],
    ["comment", ": keepalive\n\n"],
    [
      "multiline data",
      `event: ${AI_INTENT_PREVIEW_SSE_EVENT_V1}\ndata: {}\ndata: {}\n\n`,
    ],
    ["CRLF", `event: ${AI_INTENT_PREVIEW_SSE_EVENT_V1}\r\ndata: {}\r\n\r\n`],
    ["BOM", `\ufeffevent: ${AI_INTENT_PREVIEW_SSE_EVENT_V1}\ndata: {}\n\n`],
    [
      "invalid JSON",
      `event: ${AI_INTENT_PREVIEW_SSE_EVENT_V1}\ndata: {private-data}\n\n`,
    ],
    [
      "extra JSON field",
      new TextDecoder().decode(
        encode({ ...status("processing"), message: "private-data" }),
      ),
    ],
    ["unknown code", new TextDecoder().decode(encode(status("paid")))],
  ])("rejects %s without ACK or exposing content", async (_name, text) => {
    const h = harness([encoder.encode(text)]);
    const result = await h.run();
    expect(["unavailable", "interrupted"]).toContain(result.transport);
    expect(JSON.stringify(result)).not.toContain("private-data");
    expect(h.onCandidate).not.toHaveBeenCalled();
    expect(h.acknowledge).not.toHaveBeenCalled();
  });

  it.each([
    new Uint8Array([0xc3, 0x28, 10, 10]),
    new Uint8Array([0xed, 0xa0, 0x80, 10, 10]),
    new Uint8Array([0xf0, 0x9f, 10, 10]),
  ])("rejects invalid UTF-8 instead of replacement decoding", async (bytes) => {
    const h = harness([bytes]);
    expect((await h.run()).transport).toBe("unavailable");
    expect(h.acknowledge).not.toHaveBeenCalled();
  });

  it.each([
    "digest",
    "invocation",
    "expired",
    "malformed proof",
    "invalid domain",
  ])(
    "rejects %s before handoff/ACK after establishing a valid fixture",
    async (reason) => {
      expect((await harness().run()).transport).toBe("finished");
      const frame = candidateFrame();
      if (reason === "digest")
        frame.candidate.intentDocument.application.summary = "Changed bytes";
      if (reason === "invocation") {
        frame.delivery.invocationId = "preview_foreign";
        frame.candidate = modelIntentExtractionResponseV1Schema.parse({
          ...frame.candidate,
          provenance: {
            ...frame.candidate.provenance,
            invocationId: "preview_foreign",
          },
        });
        frame.delivery.outputDigest = digestCanonicalValue(frame.candidate);
      }
      if (reason === "expired")
        frame.delivery.expiresAt = new Date(Date.now()).toISOString();
      if (reason === "malformed proof") frame.delivery.token = "not-a-token";
      if (reason === "invalid domain") {
        frame.candidate.intentDocument.unresolvedQuestions = [];
        frame.delivery.outputDigest = digestCanonicalValue(frame.candidate);
      }
      const h = harness([
        encode(status("processing")),
        encode(frame),
        encode(status("finished")),
      ]);
      expect((await h.run()).transport).toBe("unavailable");
      expect(h.acknowledge).not.toHaveBeenCalled();
      expect(h.onCandidate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["candidate before processing", () => [candidateFrame()]],
    [
      "ACK heartbeat before candidate",
      () => [status("processing"), status("awaiting-acknowledgement")],
    ],
    [
      "finished without candidate",
      () => [status("processing"), status("finished")],
    ],
    [
      "duplicate candidate",
      () => [status("processing"), candidateFrame(), candidateFrame()],
    ],
    [
      "result unavailable after candidate",
      () => [
        status("processing"),
        candidateFrame(),
        status("result-unavailable"),
      ],
    ],
    [
      "frame after terminal",
      () => [
        status("processing"),
        status("result-unavailable"),
        status("processing"),
      ],
    ],
  ] as const)(
    "rejects %s with at most one candidate and ACK",
    async (_name, values) => {
      const h = harness(values().map(encode));
      expect((await h.run()).transport).toBe("unavailable");
      expect(h.onCandidate.mock.calls.length).toBeLessThanOrEqual(1);
      expect(h.acknowledge.mock.calls.length).toBeLessThanOrEqual(1);
    },
  );

  it("ignores a processing heartbeat queued behind a pending producer candidate write", async () => {
    const h = harness(
      [
        status("processing"),
        candidateFrame(),
        status("processing"),
        status("awaiting-acknowledgement"),
        status("finished"),
      ].map(encode),
    );
    expect((await h.run()).transport).toBe("finished");
    expect(h.onStatus.mock.calls.map(([code]) => code)).toEqual([
      "processing",
      "awaiting-acknowledgement",
      "finished",
    ]);
    expect(h.retained).toHaveLength(1);
    expect(h.acknowledge).toHaveBeenCalledTimes(1);
  });

  it("measures exact frame and aggregate wire bytes, including framing", async () => {
    const chunks = [
      encode(status("processing")),
      encode(candidateFrame()),
      encode(status("finished")),
    ];
    const total = chunks.reduce((sum, bytes) => sum + bytes.length, 0);
    const frameLimit = encode(candidateFrame()).length;
    expect(
      (
        await harness(chunks).run({
          limits: {
            ...limits,
            totalBytes: total,
            candidateFrameBytes: frameLimit,
          },
        })
      ).transport,
    ).toBe("finished");
    const shortFrame = harness(chunks);
    expect(
      (
        await shortFrame.run({
          limits: { ...limits, candidateFrameBytes: frameLimit - 1 },
        })
      ).transport,
    ).toBe("unavailable");
    expect(shortFrame.acknowledge).not.toHaveBeenCalled();
    expect(
      (
        await harness(chunks).run({
          limits: { ...limits, totalBytes: total - 1 },
        })
      ).transport,
    ).toBe("unavailable");
  });

  it("rejects an oversized single incoming chunk before parsing or handoff", async () => {
    const h = harness([new Uint8Array(272 * 1024 + 1)]);
    expect((await h.run()).transport).toBe("unavailable");
    expect(h.acknowledge).not.toHaveBeenCalled();
  });

  it.each([
    { candidateFrameBytes: 262145 },
    { totalBytes: 278529 },
    { deadlineMilliseconds: 180001 },
    { backpressureMilliseconds: 5001 },
    { deadlineMilliseconds: 0 },
    { totalBytes: NaN },
    { toString: 1 },
    JSON.parse('{"__proto__":1}') as Record<string, number>,
  ])("rejects widened or malformed host limits", async (badLimits) => {
    const h = harness();
    await expect(h.run({ limits: badLimits })).rejects.toThrow(
      "The memory-only preview could not be received.",
    );
    expect(h.request).not.toHaveBeenCalled();
  });

  it.each([{ status: 201 }])(
    "fails closed on unavailable or cacheable/non-stream responses",
    async (options) => {
      const h = harness([], options);
      expect((await h.run()).transport).toBe("unavailable");
      expect(h.acknowledge).not.toHaveBeenCalled();
    },
  );

  it("does not open a request after pre-cancellation", async () => {
    const h = harness();
    h.signal.abort();
    expect((await h.run()).transport).toBe("interrupted");
    expect(h.request).not.toHaveBeenCalled();
  });

  it("bounds hanging request and cancels a late response without handoff", async () => {
    const h = harness();
    const late = deferred<Response>();
    const pending = h.run({ request: () => late.promise });
    await vi.advanceTimersByTimeAsync(201);
    expect((await pending).transport).toBe("interrupted");
    const cancel = vi.fn((): Promise<void> => Promise.resolve());
    late.resolve(response([], { close: false, cancel }));
    await Promise.resolve();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.onCandidate).not.toHaveBeenCalled();
  });

  it("does not wait for a hanging reader cancel or expose its late rejection", async () => {
    const h = harness([], {
      close: false,
      cancel: () => new Promise<void>(() => undefined),
    });
    const pending = h.run();
    await vi.advanceTimersByTimeAsync(201);
    expect((await pending).transport).toBe("interrupted");
  });

  it.each(["reject", "hang", "abort"])(
    "retains RAM and reports unconfirmed ACK on %s without retry",
    async (kind) => {
      const h = harness();
      const pendingAck = deferred<undefined>();
      const acknowledge = vi.fn((): Promise<void> => {
        if (kind === "reject")
          return Promise.reject(new Error("private HTTP body"));
        if (kind === "abort") h.signal.abort();
        return pendingAck.promise;
      });
      const pending = h.run({ acknowledge });
      await vi.advanceTimersByTimeAsync(31);
      expect(await pending).toMatchObject({
        candidateHandedOff: true,
        acknowledgement: "unconfirmed",
      });
      expect(h.retained).toHaveLength(1);
      expect(acknowledge).toHaveBeenCalledTimes(1);
      if (kind !== "reject") pendingAck.reject(new Error("late private body"));
      await Promise.resolve();
    },
  );

  it("rechecks cancellation and proof expiry synchronously after handoff before ACK", async () => {
    for (const invalidate of ["abort", "expiry"] as const) {
      const h = harness();
      const result = await h.run({
        onCandidate: (candidate) => {
          h.retained.push(candidate);
          if (invalidate === "abort") h.signal.abort();
          else vi.setSystemTime(new Date(Date.now() + 30_000));
        },
      });
      expect(result.candidateHandedOff).toBe(true);
      expect(result.acknowledgement).toBe("not-attempted");
      expect(h.acknowledge).not.toHaveBeenCalled();
    }
  });

  it("uses no default fetch, persistent storage or logging", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const store = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log");
    expect((await harness().run()).transport).toBe("finished");
    expect(fetch).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
