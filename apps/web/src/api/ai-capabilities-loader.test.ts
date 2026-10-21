import { afterEach, expect, it, vi } from "vitest";
import { createAiCapabilitiesLoader } from "./ai-capabilities-loader.js";
const support = {
  schemaVersion: 1,
  proposalVersions: [6],
  applicationSources: ["ai-source-draft-v3"],
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
it("uses a bounded uncached public GET before any paid admission", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response(JSON.stringify(support)));
  await expect(
    createAiCapabilitiesLoader(fetcher)(new AbortController().signal),
  ).resolves.toEqual(support);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    "/api/runtime-config?view=ai",
    expect.objectContaining({
      cache: "no-store",
      mode: "same-origin",
      redirect: "error",
      signal: expect.any(AbortSignal) as unknown,
    }),
  );
});
it.each([400, 404])(
  "treats older API status %s as unavailable without guessing legacy support",
  async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response("old release", { status }));
    await expect(
      createAiCapabilitiesLoader(fetcher)(new AbortController().signal),
    ).resolves.toEqual({
      schemaVersion: 1,
      proposalVersions: [],
      applicationSources: [],
    });
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
it.each([
  () => response(JSON.stringify(support), { status: 503 }),
  () =>
    response(JSON.stringify(support), {
      headers: { "content-type": "text/html" },
    }),
  () =>
    response(JSON.stringify(support), {
      headers: { "content-type": "application/json", "content-length": "1025" },
    }),
  () => response(" ".repeat(1025)),
  () => response("{invalid"),
  () => response(JSON.stringify({ ...support, proposalVersions: [5] })),
  () => response(JSON.stringify({ ...support, tenantId: "private" })),
])("refuses untrusted or oversized capabilities %#", async (makeResponse) => {
  await expect(
    createAiCapabilitiesLoader(
      vi.fn<typeof fetch>().mockResolvedValue(makeResponse()),
    )(new AbortController().signal),
  ).rejects.toThrow();
});
it("releases a stalled reader when the bounded request aborts", async () => {
  const caller = new AbortController();
  let streamed: Response | undefined;
  const fetcher = vi.fn<typeof fetch>((_url, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error("Missing bounded signal");
    streamed = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener(
            "abort",
            () => {
              controller.error(signal.reason);
            },
            { once: true },
          );
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
    return Promise.resolve(streamed);
  });
  const pending = createAiCapabilitiesLoader(fetcher)(caller.signal);
  const rejected = expect(pending).rejects.toThrow("Synthetic abort");
  caller.abort(new Error("Synthetic abort"));
  await rejected;
  expect(streamed?.body?.locked).toBe(false);
});
