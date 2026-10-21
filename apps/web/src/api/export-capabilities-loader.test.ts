import { afterEach, describe, expect, it, vi } from "vitest";
import { createExportCapabilitiesLoader } from "./export-capabilities-loader.js";

const capabilities = {
  schemaVersion: 1,
  exports: {
    targets: ["cloudformation"],
    workload: "infrastructure-only",
    maximumBytes: 4_194_304,
  },
};
function response(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bounded public export capability loader", () => {
  it("fetches only the same-origin public variant without credentials or caching changes", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(response(JSON.stringify(capabilities))),
    );
    const signal = new AbortController().signal;
    await expect(
      createExportCapabilitiesLoader(fetcher)(signal),
    ).resolves.toEqual(capabilities);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/runtime-config?view=exports",
      {
        cache: "no-store",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal) as unknown,
      },
    );
  });
  it.each(["caller", "deadline"] as const)(
    "aborts a stalled body when the %s signal expires and releases its reader",
    async (source) => {
      const caller = new AbortController();
      const deadline = new AbortController();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(deadline.signal);
      let streamed: Response | undefined;
      const fetcher = vi.fn<typeof fetch>((_url, init) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null)
          throw new Error("Expected bounded signal.");
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"schemaVersion":1'));
            signal.addEventListener(
              "abort",
              () => {
                controller.error(signal.reason);
              },
              { once: true },
            );
          },
        });
        streamed = new Response(body, {
          headers: { "content-type": "application/json" },
        });
        return Promise.resolve(streamed);
      });
      const loaded = createExportCapabilitiesLoader(fetcher)(caller.signal);
      const rejected = expect(loaded).rejects.toThrow("Synthetic " + source);
      (source === "caller" ? caller : deadline).abort(
        new Error("Synthetic " + source),
      );
      await rejected;
      expect(timeout).toHaveBeenCalledExactlyOnceWith(5_000);
      expect(streamed?.body?.locked).toBe(false);
    },
  );
  it.each([
    () => response(JSON.stringify(capabilities), { status: 503 }),
    () =>
      response(JSON.stringify(capabilities), {
        headers: { "content-type": "text/html" },
      }),
    () =>
      response(JSON.stringify(capabilities), {
        headers: {
          "content-type": "application/json",
          "content-length": "1025",
        },
      }),
    () => response(" ".repeat(1_025)),
    () =>
      response(" ".repeat(1_025), {
        headers: { "content-type": "application/json", "content-length": "1" },
      }),
    () => response("{broken"),
    () =>
      response(
        JSON.stringify({
          ...capabilities,
          exports: { ...capabilities.exports, targets: ["terraform"] },
        }),
      ),
    () =>
      response(JSON.stringify({ ...capabilities, privateKey: "not public" })),
  ])(
    "rejects invalid or oversized responses before showing availability %#",
    async (makeResponse) => {
      const fetcher = vi.fn<typeof fetch>(() =>
        Promise.resolve(makeResponse()),
      );
      await expect(
        createExportCapabilitiesLoader(fetcher)(new AbortController().signal),
      ).rejects.toThrow();
    },
  );
  it("cancels a chunked oversized body as soon as its bound is exceeded", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(600));
        controller.enqueue(new Uint8Array(600));
      },
      cancel,
    });
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(body, { headers: { "content-type": "application/json" } }),
      ),
    );
    await expect(
      createExportCapabilitiesLoader(fetcher)(new AbortController().signal),
    ).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
