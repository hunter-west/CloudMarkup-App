import {
  digestStructuredValue,
  type ModelProviderAdapter,
  type ModelProviderResultV1,
} from "@cloudmarkup/model-gateway";
import { utcTimestampSchema } from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  ModelPlatformSpendError,
  PlatformSpendBoundModelProviderAdapter,
  modelPlatformReservationReceiptSchema,
  type ModelDispatchCostCeiling,
  type ModelDispatchCostCeilingPort,
  type ModelPlatformReservationInput,
  type ModelPlatformReservationReceipt,
  type ModelPlatformSpendReservationPort,
  type ModelPlatformHttpHandler,
} from "./model-platform-spend.js";
import {
  platformSpendCeiling,
  platformSpendInvocation,
} from "./persistence/model-platform-spend-test-helpers.js";

const now = new Date("2026-09-05T12:00:00.000Z");
function receipt(
  input: ModelPlatformReservationInput,
): ModelPlatformReservationReceipt {
  return modelPlatformReservationReceiptSchema.parse({
    kind: "reserved",
    dispatchId: input.dispatchId,
    claimDigest: digestStructuredValue(input),
    monthUtc: "2026-09",
    reservedAt: now.toISOString(),
    dispatchBefore: new Date(now.getTime() + 5000).toISOString(),
  });
}
function fixture(
  beforeDispatch?: (
    signal: AbortSignal,
  ) => Promise<{ readonly expiresAt: string }>,
) {
  const invocation = platformSpendInvocation();
  const time = { current: now };
  const completed: ModelProviderResultV1 = {
    content: { kind: "text", text: "Synthetic provider boundary fixture." },
  };
  const invoke = vi
    .fn<ModelProviderAdapter["invoke"]>()
    .mockResolvedValue(completed);
  type Http = ModelPlatformHttpHandler<
    typeof invocation,
    { abortSignal?: AbortSignal },
    ModelProviderResultV1
  >;
  const http = vi.fn<Http["handle"]>().mockResolvedValue(completed);
  let guarded: Http | undefined;
  const handler = (): Http => {
    if (guarded === undefined) throw new Error("Synthetic guard is missing.");
    return guarded;
  };
  const delegate: ModelProviderAdapter = {
    profile: {
      capabilities: [],
      enabled: true,
      profileVersion: "1.0.0",
      providerFamily: "amazon-bedrock",
      providerId: invocation.descriptor.providerId,
    },
    invoke,
  };
  const ceilings: ModelDispatchCostCeiling[] = [];
  const reservations: ModelPlatformReservationInput[] = [];
  let used = 0;
  const reserve = vi
    .fn<ModelPlatformSpendReservationPort["reserve"]>()
    .mockImplementation((input) => {
      if (used + input.ceiling.maximumCostMicroUsd > 50_000_000)
        return Promise.reject(new ModelPlatformSpendError("cap-exceeded"));
      used += input.ceiling.maximumCostMicroUsd;
      reservations.push(structuredClone(input));
      return Promise.resolve(receipt(input));
    });
  const costs = {
    resolve: vi
      .fn<ModelDispatchCostCeilingPort["resolve"]>()
      .mockImplementation((payload) => {
        const ceiling = ceilings.shift() ?? platformSpendCeiling(payload);
        return Promise.resolve(ceiling);
      }),
  };
  const adapter = new PlatformSpendBoundModelProviderAdapter({
    ...(beforeDispatch === undefined ? {} : { beforeDispatch }),
    httpHandler: { handle: http },
    createDelegate: (transport) => {
      guarded = transport;
      invoke.mockImplementation((payload, signal) =>
        transport.handle(
          payload,
          signal === undefined ? {} : { abortSignal: signal },
        ),
      );
      return delegate;
    },
    costs,
    reservations: { reserve },
    scope: invocation.descriptor.scope,
    now: () => time.current,
  });
  return {
    invocation,
    completed,
    invoke,
    delegate,
    adapter,
    reserve,
    reservations,
    costs,
    ceilings,
    http,
    handler,
    time,
  };
}

describe("host-only model platform spending dispatch fence", () => {
  it.each([
    "2020-01-01T00:00:00.000Z",
    "2099-01-02T00:00:00.000Z",
    "2026-09-05T12:00:00.000Z",
  ])(
    "denies invalid or expired dispatch freshness %s without a reservation",
    async (expiry) => {
      const f = fixture();
      f.ceilings.push({
        ...platformSpendCeiling(f.invocation),
        dispatchValidUntil: utcTimestampSchema.parse(expiry),
      });
      await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
        ModelPlatformSpendError,
      );
      expect(f.reserve).not.toHaveBeenCalled();
      expect(f.http).not.toHaveBeenCalled();
    },
  );

  it.each(["signing", "authority"] as const)(
    "retains the reservation and denies a count expiring during %s",
    async (stage) => {
      const advance = async () => {
        await Promise.resolve();
        f.time.current = new Date(now.getTime() + 2_000);
      };
      const f = fixture(async () => {
        if (stage === "authority") await advance();
        return { expiresAt: "2026-09-05T12:05:00.000Z" };
      });
      f.ceilings.push({
        ...platformSpendCeiling(f.invocation),
        dispatchValidUntil: utcTimestampSchema.parse(
          new Date(now.getTime() + 2_000).toISOString(),
        ),
      });
      if (stage === "signing") {
        f.invoke.mockImplementation(async (payload, signal) => {
          await advance();
          return f
            .handler()
            .handle(
              payload,
              signal === undefined ? {} : { abortSignal: signal },
            );
        });
      }
      await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
        ModelPlatformSpendError,
      );
      expect(f.reservations).toHaveLength(1);
      expect(f.http).not.toHaveBeenCalled();
    },
  );

  it("allows an authorized response after count freshness expires while preserving its billing deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const f = fixture();
      f.ceilings.push({
        ...platformSpendCeiling(f.invocation),
        validUntil: utcTimestampSchema.parse(
          new Date(now.getTime() + 60_000).toISOString(),
        ),
        dispatchValidUntil: utcTimestampSchema.parse(
          new Date(now.getTime() + 2_000).toISOString(),
        ),
      });
      let started: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      f.http.mockImplementation(
        (_payload, options) =>
          new Promise((resolve, reject) => {
            options?.abortSignal?.addEventListener(
              "abort",
              () => {
                reject(new Error("Synthetic billing deadline"));
              },
              { once: true },
            );
            setTimeout(() => {
              resolve(f.completed);
            }, 3_000);
            started?.();
          }),
      );
      const outcome = expect(f.adapter.invoke(f.invocation)).resolves.toEqual(
        f.completed,
      );
      await ready;
      f.time.current = new Date(now.getTime() + 3_000);
      await vi.advanceTimersByTimeAsync(3_000);
      await outcome;
      expect(f.http).toHaveBeenCalledOnce();
      expect(f.http.mock.calls[0]?.[1]?.abortSignal?.aborted).toBe(false);
      expect(f.reservations).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts a request waiting on credentials when count freshness expires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const f = fixture();
      f.ceilings.push({
        ...platformSpendCeiling(f.invocation),
        dispatchValidUntil: utcTimestampSchema.parse(
          new Date(now.getTime() + 2_000).toISOString(),
        ),
      });
      let started: (() => void) | undefined;
      let release: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const credentials = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.invoke.mockImplementation(async (payload, signal) => {
        started?.();
        await credentials;
        expect(signal?.aborted).toBe(true);
        return f
          .handler()
          .handle(payload, signal === undefined ? {} : { abortSignal: signal });
      });
      const outcome = expect(
        f.adapter.invoke(f.invocation),
      ).rejects.toBeInstanceOf(ModelPlatformSpendError);
      await ready;
      await vi.advanceTimersByTimeAsync(2_001);
      release?.();
      await outcome;
      expect(f.reservations).toHaveLength(1);
      expect(f.http).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks host authority after a slow cost lookup and retains the dollar reservation on denial", async () => {
    let revoked = false;
    const check = vi.fn(() =>
      revoked
        ? Promise.reject(new Error("revoked"))
        : Promise.resolve({ expiresAt: "2026-09-05T12:05:00.000Z" }),
    );
    const f = fixture(check);
    f.costs.resolve.mockImplementationOnce(async (payload) => {
      await Promise.resolve();
      revoked = true;
      return platformSpendCeiling(payload);
    });
    await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
      ModelPlatformSpendError,
    );
    expect(check).toHaveBeenCalledOnce();
    expect(f.reservations).toHaveLength(1);
    expect(f.http).not.toHaveBeenCalled();
  });
  it("checks execution authority after SDK credentials/signing and before any paid handoff", async () => {
    let expired = false;
    const f = fixture(() =>
      expired
        ? Promise.reject(new Error("expired runtime"))
        : Promise.resolve({ expiresAt: "2026-09-05T12:05:00.000Z" }),
    );
    f.invoke.mockImplementation(async (payload, signal) => {
      await Promise.resolve();
      expired = true;
      return f
        .handler()
        .handle(payload, signal === undefined ? {} : { abortSignal: signal });
    });
    await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
      ModelPlatformSpendError,
    );
    expect(f.http).not.toHaveBeenCalled();
    expect(f.reservations).toHaveLength(1);
  });
  it("rechecks the five-second dollar deadline after awaited current authorization", async () => {
    const f = fixture(async () => {
      await Promise.resolve();
      f.time.current = new Date(now.getTime() + 5000);
      return { expiresAt: "2026-09-05T12:05:00.000Z" };
    });
    await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
      ModelPlatformSpendError,
    );
    expect(f.http).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { expiresAt: "2026-09-05T12:00:00.000Z" },
    { expiresAt: "2026-09-05T12:05:00Z" },
    { expiresAt: "2026-09-05T12:05:00.000Z", extra: true },
    { expiresAt: "invalid" },
  ])(
    "rejects malformed, noncanonical or expired final authority proof %j",
    async (proof) => {
      const f = fixture(() => Promise.resolve(proof as { expiresAt: string }));
      await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
        ModelPlatformSpendError,
      );
      expect(f.http).not.toHaveBeenCalled();
    },
  );
  it("does not evaluate accessor-based authority proofs", async () => {
    const get = vi.fn(() => "2026-09-05T12:05:00.000Z");
    const proof = {
      get expiresAt() {
        return get();
      },
    };
    const f = fixture(() => Promise.resolve(proof));
    await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
      ModelPlatformSpendError,
    );
    expect(get).not.toHaveBeenCalled();
    expect(f.http).not.toHaveBeenCalled();
  });
  it("permits only one concurrent HTTP handoff while final authorization awaits", async () => {
    const f = fixture(async () => {
      await Promise.resolve();
      return { expiresAt: "2026-09-05T12:05:00.000Z" };
    });
    f.invoke.mockImplementation(async (payload, signal) => {
      const options = signal === undefined ? {} : { abortSignal: signal };
      const results = await Promise.allSettled([
        f.handler().handle(payload, options),
        f.handler().handle(payload, options),
      ]);
      expect(results.map((result) => result.status)).toEqual([
        "fulfilled",
        "rejected",
      ]);
      return f.completed;
    });
    await expect(f.adapter.invoke(f.invocation)).resolves.toEqual(f.completed);
    expect(f.http).toHaveBeenCalledOnce();
    expect(f.reservations).toHaveLength(1);
  });
  it("reserves exact complete invocation evidence before delegating", async () => {
    const f = fixture();
    await expect(f.adapter.invoke(f.invocation)).resolves.toEqual(f.completed);
    expect(f.reserve).toHaveBeenCalledOnce();
    expect(f.invoke).toHaveBeenCalledExactlyOnceWith(
      f.invocation,
      expect.any(AbortSignal),
    );
    expect(f.http).toHaveBeenCalledOnce();
    expect(f.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      f.invoke.mock.invocationCallOrder[0] ?? 0,
    );
    expect(f.reservations[0]?.ceiling.invocationDigest).toBe(
      digestStructuredValue(f.invocation),
    );
  });

  it("independently reserves each retry and retains unknown charges", async () => {
    const f = fixture();
    f.ceilings.push(
      platformSpendCeiling(f.invocation, 30_000_000),
      platformSpendCeiling(f.invocation, 30_000_000),
    );
    f.invoke.mockRejectedValueOnce(
      new Error("Synthetic unknown provider outcome"),
    );
    await expect(f.adapter.invoke(f.invocation)).rejects.toThrow(
      "Synthetic unknown provider outcome",
    );
    await expect(f.adapter.invoke(f.invocation)).rejects.toMatchObject({
      code: "model-platform.cap-exceeded",
    });
    expect(f.invoke).toHaveBeenCalledOnce();
    expect(f.reserve).toHaveBeenCalledTimes(2);
    expect(f.reserve.mock.calls[0]?.[0].dispatchId).not.toBe(
      f.reserve.mock.calls[1]?.[0].dispatchId,
    );
    expect(f.reservations).toHaveLength(1);
  });

  const substitutions: readonly [string, Partial<ModelDispatchCostCeiling>][] =
    [
      [
        "unknown model",
        {
          modelId:
            "synthetic.other-model" as ModelDispatchCostCeiling["modelId"],
        },
      ],
      [
        "other profile",
        {
          inferenceProfileId:
            "synthetic.other-profile" as ModelDispatchCostCeiling["inferenceProfileId"],
        },
      ],
      [
        "other provider",
        {
          providerId:
            "synthetic.other-provider" as ModelDispatchCostCeiling["providerId"],
        },
      ],
      ["model version", { modelVersion: "2.0.0" }],
      [
        "unreviewed pricing version",
        {
          pricingVersionId:
            "synthetic.other-pricing" as ModelDispatchCostCeiling["pricingVersionId"],
        },
      ],
      [
        "changed payload",
        { invocationDigest: digestStructuredValue("other-payload") },
      ],
      ["zero/unknown estimate", { maximumCostMicroUsd: 0 }],
      ["fractional micro-dollar estimate", { maximumCostMicroUsd: 0.5 }],
      ["over the full monthly ceiling", { maximumCostMicroUsd: 50_000_001 }],
      ["nonfinite estimate", { maximumCostMicroUsd: Number.NaN }],
    ];
  it.each(substitutions)(
    "rejects %s without reserving or dispatching",
    async (_name, changes) => {
      const f = fixture();
      f.ceilings.push({ ...platformSpendCeiling(f.invocation), ...changes });
      await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
        ModelPlatformSpendError,
      );
      expect(f.reserve).not.toHaveBeenCalled();
      expect(f.invoke).not.toHaveBeenCalled();
    },
  );

  it("rejects missing cost authority and cross-tenant scope before dispatch", async () => {
    const f = fixture();
    f.costs.resolve.mockResolvedValueOnce(null);
    await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
      ModelPlatformSpendError,
    );
    await expect(
      f.adapter.invoke({
        ...f.invocation,
        descriptor: {
          ...f.invocation.descriptor,
          scope: {
            ...f.invocation.descriptor.scope,
            organizationId: "other-org",
          },
        },
      }),
    ).rejects.toBeInstanceOf(ModelPlatformSpendError);
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it.each([
    "stale",
    "month-rollover",
    "wrong-claim",
    "wrong-dispatch",
    "future-clock",
    "partial-window",
    "duplicate",
  ])("does not dispatch from a %s receipt", async (kind) => {
    const f = fixture();
    f.reserve.mockImplementation((input) => {
      if (kind === "duplicate") return Promise.resolve({ kind: "duplicate" });
      const result = receipt(input);
      return Promise.resolve(
        modelPlatformReservationReceiptSchema.parse({
          ...result,
          ...(kind === "stale"
            ? {
                reservedAt: "2026-09-05T11:59:00.000Z",
                dispatchBefore: "2026-09-05T11:59:05.000Z",
              }
            : {}),
          ...(kind === "month-rollover"
            ? {
                monthUtc: "2026-08",
                reservedAt: "2026-08-31T23:59:59.000Z",
                dispatchBefore: "2026-09-01T00:00:00.000Z",
              }
            : {}),
          ...(kind === "wrong-claim"
            ? { claimDigest: digestStructuredValue("other-claim") }
            : {}),
          ...(kind === "wrong-dispatch"
            ? { dispatchId: "dispatch_" + "b".repeat(32) }
            : {}),
          ...(kind === "future-clock"
            ? {
                reservedAt: "2026-09-05T12:00:03.000Z",
                dispatchBefore: "2026-09-05T12:00:08.000Z",
              }
            : {}),
          ...(kind === "partial-window"
            ? { dispatchBefore: "2026-09-05T12:00:02.000Z" }
            : {}),
        }),
      );
    });
    await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
      ModelPlatformSpendError,
    );
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("retains a reservation if canceled while awaiting the database", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.reserve.mockImplementation((input) => {
      controller.abort();
      return Promise.resolve(receipt(input));
    });
    await expect(
      f.adapter.invoke(f.invocation, controller.signal),
    ).rejects.toBeInstanceOf(ModelPlatformSpendError);
    expect(f.reserve).toHaveBeenCalledOnce();
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("rejects delayed SDK credentials/signing that cross the UTC month before any HTTP request", async () => {
    const f = fixture();
    f.time.current = new Date("2026-09-30T23:59:54.000Z");
    f.reserve.mockImplementation((input) =>
      Promise.resolve(
        modelPlatformReservationReceiptSchema.parse({
          ...receipt(input),
          reservedAt: "2026-09-30T23:59:54.000Z",
          dispatchBefore: "2026-09-30T23:59:59.000Z",
        }),
      ),
    );
    f.invoke.mockImplementation(async (payload, signal) => {
      // Synthetic credential/signing middleware resolves after month rollover.
      await Promise.resolve();
      f.time.current = new Date("2026-10-01T00:00:00.000Z");
      return f
        .handler()
        .handle(payload, signal === undefined ? {} : { abortSignal: signal });
    });
    await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
      ModelPlatformSpendError,
    );
    expect(f.reserve).toHaveBeenCalledOnce();
    expect(f.invoke).toHaveBeenCalledOnce();
    expect(f.http).not.toHaveBeenCalled();
  });

  it("rejects unreserved HTTP calls, opaque delegates and hidden SDK retries", async () => {
    const f = fixture();
    await expect(f.handler().handle(f.invocation)).rejects.toBeInstanceOf(
      ModelPlatformSpendError,
    );
    f.invoke.mockResolvedValueOnce(f.completed);
    await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
      ModelPlatformSpendError,
    );
    expect(f.http).not.toHaveBeenCalled();
    f.invoke.mockImplementation(async (payload, signal) => {
      const options = signal === undefined ? {} : { abortSignal: signal };
      await f.handler().handle(payload, options);
      return f.handler().handle(payload, options);
    });
    await expect(f.adapter.invoke(f.invocation)).rejects.toBeInstanceOf(
      ModelPlatformSpendError,
    );
    expect(f.http).toHaveBeenCalledOnce();
  });

  it("aborts outstanding credential work at the reservation deadline and denies its later HTTP send", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const f = fixture();
      let release: (() => void) | undefined;
      let started: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const credentials = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.invoke.mockImplementation(async (payload, signal) => {
        started?.();
        await credentials;
        expect(signal?.aborted).toBe(true);
        return f
          .handler()
          .handle(payload, signal === undefined ? {} : { abortSignal: signal });
      });
      const outcome = expect(
        f.adapter.invoke(f.invocation),
      ).rejects.toBeInstanceOf(ModelPlatformSpendError);
      await ready;
      await vi.advanceTimersByTimeAsync(5001);
      release?.();
      await outcome;
      expect(f.http).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a hard month-end signal while the HTTP handler waits for a connection", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const f = fixture();
      f.time.current = new Date("2026-09-30T23:59:53.000Z");
      f.reserve.mockImplementation((input) =>
        Promise.resolve(
          modelPlatformReservationReceiptSchema.parse({
            ...receipt(input),
            reservedAt: "2026-09-30T23:59:53.000Z",
            dispatchBefore: "2026-09-30T23:59:58.000Z",
          }),
        ),
      );
      let started: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      f.http.mockImplementation(
        (_payload, options) =>
          new Promise((_resolve, reject) => {
            options?.abortSignal?.addEventListener(
              "abort",
              () => {
                reject(new Error("Synthetic month deadline"));
              },
              { once: true },
            );
            started?.();
          }),
      );
      const outcome = expect(f.adapter.invoke(f.invocation)).rejects.toThrow(
        "Synthetic month deadline",
      );
      await ready;
      await vi.advanceTimersByTimeAsync(7001);
      await outcome;
      expect(f.http.mock.calls[0]?.[1]?.abortSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves provider timeout cancellation through the final HTTP guard", async () => {
    const f = fixture();
    const providerTimeout = new AbortController();
    f.http.mockImplementation(
      (_payload, options) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener(
            "abort",
            () => {
              reject(new Error("Synthetic provider timeout"));
            },
            { once: true },
          );
        }),
    );
    f.invoke.mockImplementation((payload) => {
      const response = f
        .handler()
        .handle(payload, { abortSignal: providerTimeout.signal });
      providerTimeout.abort();
      return response;
    });
    await expect(f.adapter.invoke(f.invocation)).rejects.toThrow(
      "Synthetic provider timeout",
    );
    expect(f.http.mock.calls[0]?.[1]?.abortSignal?.aborted).toBe(true);
  });
});
