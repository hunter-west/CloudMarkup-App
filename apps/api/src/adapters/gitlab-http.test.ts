import { httpText, deferred } from "./gitlab-test-helpers.js";
import { describe, expect, it, vi } from "vitest";
import {
  GitLabProviderError,
  withGitLabOperation,
  type GitLabRequest,
} from "./gitlab-http.js";

const request: GitLabRequest = {
  method: "GET",
  path: "/api/v4/user",
  successStatus: 200,
  token: new TextEncoder().encode("synthetic-gitlab-access-for-tests"),
};

describe("fixed GitLab transport", () => {
  it("observes rejection when admission synchronously cancels its operation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const controller = new AbortController();
    await expect(
      withGitLabOperation(
        {
          fetch,
          signal: controller.signal,
          assertCurrentAdmission: () => {
            controller.abort();
            return Promise.reject(Error("private-denial"));
          },
        },
        (operation) => operation.request(request),
      ),
    ).rejects.toMatchObject({ name: "GitLabProviderError" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the fixed host, header token, bounded deadline and no ambient credentials or redirects", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ id: 8 }));
    const admission = vi.fn(() => Promise.resolve());
    const result = await withGitLabOperation(
      { fetch, assertCurrentAdmission: admission },
      (operation) => operation.request(request),
    );
    expect(result?.value).toEqual({ id: 8 });
    expect(admission).toHaveBeenCalledTimes(4);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(httpText(url)).toBe("https://gitlab.com/api/v4/user");
    expect(init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer synthetic-gitlab-access-for-tests",
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    "https://evil.invalid/api/v4/user",
    "//evil.invalid/api/v4/user",
    "/api/v4/user?access_token=secret",
    "/api/v4/user#fragment",
    "/api/v4/projects/8/pipelines",
    "/api/v4/projects/8/repository/archive",
    "/oauth/authorize",
    "/\\evil.invalid/api/v4/user",
  ])("denies an unapproved endpoint %s before fetch", async (path) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      withGitLabOperation(
        { fetch, assertCurrentAdmission: () => Promise.resolve() },
        (operation) => operation.request({ ...request, path }),
      ),
    ).rejects.toMatchObject({ outcome: "not-sent", problem: "invalid-input" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not dispatch after initial admission denial", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      withGitLabOperation(
        {
          fetch,
          assertCurrentAdmission: () =>
            Promise.reject(Error("private tenant detail")),
        },
        (operation) => operation.request(request),
      ),
    ).rejects.toMatchObject({ outcome: "not-sent", problem: "access-denied" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("discards provider output after current access is revoked", async () => {
    let allowed = true;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
      allowed = false;
      return Promise.resolve(Response.json({ private: "repository" }));
    });
    await expect(
      withGitLabOperation(
        {
          fetch,
          assertCurrentAdmission: () =>
            allowed
              ? Promise.resolve()
              : Promise.reject(Error("private denial")),
        },
        (operation) => operation.request(request),
      ),
    ).rejects.toMatchObject({ outcome: "uncertain", problem: "access-denied" });
  });
  it.each([401, 404, 409, 429, 500])(
    "redacts status %s and never retries",
    async (status) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          Response.json({ error: "private source and secret" }, { status }),
        );
      const error = await withGitLabOperation(
        { fetch, assertCurrentAdmission: () => Promise.resolve() },
        (operation) => operation.request(request),
      ).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(GitLabProviderError);
      const expectedByStatus: Readonly<
        Record<number, Pick<GitLabProviderError, "outcome" | "problem">>
      > = {
        401: { outcome: "rejected", problem: "access-denied" },
        404: { outcome: "rejected", problem: "unavailable" },
        409: { outcome: "rejected", problem: "conflict" },
        429: { outcome: "rejected", problem: "rate-limited" },
        500: { outcome: "uncertain", problem: "unavailable" },
      };
      expect(error).toMatchObject({
        message: "The GitLab operation could not be confirmed.",
        ...expectedByStatus[status],
      });
      expect(JSON.stringify(error)).not.toContain("private source and secret");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("only converts 404 into missing for an explicitly permitted branch read", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({}, { status: 404 }));
    expect(
      await withGitLabOperation(
        { fetch, assertCurrentAdmission: () => Promise.resolve() },
        (operation) =>
          operation.request({
            ...request,
            path: "/api/v4/projects/8/repository/branches/main",
            allowMissing: true,
          }),
      ),
    ).toBeNull();
    await expect(
      withGitLabOperation(
        { fetch, assertCurrentAdmission: () => Promise.resolve() },
        (operation) => operation.request({ ...request, allowMissing: true }),
      ),
    ).rejects.toMatchObject({ outcome: "not-sent" });
  });
  it.each([
    () => new Response("{}", { headers: { "content-type": "text/html" } }),
    () =>
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "90000",
        },
      }),
    () =>
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "1" },
      }),
    () =>
      new Response("{broken", {
        headers: { "content-type": "application/json" },
      }),
    () =>
      new Response(new Uint8Array([255]), {
        headers: { "content-type": "application/json" },
      }),
    () => Response.json({ tooLarge: "x".repeat(33000) }),
  ])("rejects malformed or oversized bodies", async (response) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response());
    await expect(
      withGitLabOperation(
        { fetch, assertCurrentAdmission: () => Promise.resolve() },
        (operation) => operation.request(request),
      ),
    ).rejects.toMatchObject({ outcome: "uncertain", problem: "unavailable" });
  });
  it("bounds a provider that ignores cancellation and cancels its late body", async () => {
    const controller = new AbortController();
    const pending = deferred<Response>();
    const fetched = deferred<undefined>();
    const cancelled = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
      fetched.resolve(undefined);
      return pending.promise;
    });
    const result = withGitLabOperation(
      {
        fetch,
        signal: controller.signal,
        assertCurrentAdmission: () => Promise.resolve(),
      },
      (operation) => operation.request(request),
    );
    const assertion = expect(result).rejects.toMatchObject({
      outcome: "uncertain",
    });
    await fetched.promise;
    controller.abort();
    await assertion;
    pending.resolve(
      new Response(new ReadableStream({ cancel: cancelled }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it("bounds a stalled streamed body and cancels it", async () => {
    const controller = new AbortController();
    const reading = deferred<undefined>();
    const cancelled = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        new ReadableStream(
          {
            pull() {
              reading.resolve(undefined);
            },
            cancel: cancelled,
          },
          { highWaterMark: 0 },
        ),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const result = withGitLabOperation(
      {
        fetch,
        signal: controller.signal,
        assertCurrentAdmission: () => Promise.resolve(),
      },
      (operation) => operation.request(request),
    );
    const assertion = expect(result).rejects.toMatchObject({
      outcome: "uncertain",
    });
    await reading.promise;
    controller.abort();
    await assertion;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it("redacts local credential resolver errors", async () => {
    await expect(
      withGitLabOperation(
        { assertCurrentAdmission: () => Promise.resolve() },
        () => Promise.reject(Error("private-secret-value")),
      ),
    ).rejects.toMatchObject({
      message: "The GitLab operation could not be confirmed.",
      outcome: "not-sent",
    });
  });
  it("bounds decoded bytes without comparing them to a compressed wire length", async () => {
    const response = new Response(JSON.stringify({ id: 8 }), {
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": "29",
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    expect(
      (
        await withGitLabOperation(
          { fetch, assertCurrentAdmission: () => Promise.resolve() },
          (operation) => operation.request(request),
        )
      )?.value,
    ).toEqual({ id: 8 });
  });
  it("closes operation authority after its callback returns", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ id: 8 }));
    const operation = await withGitLabOperation(
      { fetch, assertCurrentAdmission: () => Promise.resolve() },
      (value) => Promise.resolve(value),
    );
    await expect(operation.request(request)).rejects.toMatchObject({
      outcome: "not-sent",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shares one ten-second deadline across a sequence of requests", async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(controller.signal);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 8 }));
    try {
      await expect(
        withGitLabOperation(
          { fetch, assertCurrentAdmission: () => Promise.resolve() },
          async (operation) => {
            await operation.request(request);
            controller.abort();
            return operation.request(request);
          },
        ),
      ).rejects.toMatchObject({ outcome: "uncertain" });
      expect(timeout).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledWith(10000);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });
});
