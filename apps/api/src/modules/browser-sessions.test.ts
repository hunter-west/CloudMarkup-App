import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type { Principal } from "../application/identity.js";
import type { BrowserRefreshSessions } from "../adapters/persistence/browser-refresh-sessions.js";
import { BrowserRefreshSessionService } from "../adapters/identity/browser-refresh-session-service.js";
import { InMemoryCloudMarkupApplication } from "../testing/in-memory-adapters.js";

const origin = "https://beta.example.test";
const handle = "a".repeat(43);
const access = "synthetic.access.token";
const refresh = "synthetic-refresh-credential";
const token = () =>
  new Response(
    JSON.stringify({
      access_token: access,
      refresh_token: refresh,
      expires_in: 1800,
      token_type: "Bearer",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
function fixture() {
  const now = Date.now();
  const principal: Principal = {
    principalId: "principal_test",
    sessionId: "family_test",
    authenticationSource: "cognito",
    authenticatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 1800000).toISOString(),
  };
  const expiry = new Date(now + 28800000).toISOString();
  const states = new Map<string, string>();
  const sessions = {
    begin: vi.fn<BrowserRefreshSessions["begin"]>((h) => {
      if (states.has(h)) return Promise.resolve(false);
      states.set(h, "exchanging");
      return Promise.resolve(true);
    }),
    activate: vi.fn<BrowserRefreshSessions["activate"]>((h, p) => {
      if (
        states.get(h) !== "exchanging" ||
        p.principalId !== principal.principalId
      )
        return Promise.resolve(null);
      states.set(h, "active");
      return Promise.resolve(expiry);
    }),
    current: vi.fn<BrowserRefreshSessions["current"]>((h, p) =>
      Promise.resolve(
        states.get(h) === "active" &&
          p.principalId === principal.principalId &&
          p.sessionId === principal.sessionId
          ? expiry
          : null,
      ),
    ),
    revoke: vi.fn<BrowserRefreshSessions["revoke"]>((h) => {
      states.set(h, "revoked");
      return Promise.resolve();
    }),
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(token()));
  const resolver = {
    resolve: vi.fn((authorization: string | undefined) =>
      Promise.resolve(authorization === "Bearer " + access ? principal : null),
    ),
  };
  const service = new BrowserRefreshSessionService({
    clientId: "a".repeat(26),
    domain: "https://synthetic.auth.us-east-1.amazoncognito.com",
    callbackUrl: origin + "/auth/callback",
    principalResolver: resolver,
    sessions,
    fetch,
  });
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    principalResolver: { resolve: () => Promise.resolve(null) },
    browserSessions: { publicOrigin: origin, service },
  });
  function request(
    operation: string,
    body: unknown = { schemaVersion: 1 },
    cookie?: string,
    headers: Record<string, string> = {},
  ) {
    return app.request("/auth/session/v1/" + operation, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-cloudmarkup-session": "1",
        "sec-fetch-site": "same-origin",
        ...(cookie === undefined ? {} : { cookie }),
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }
  const exchange = () =>
    request("exchange", {
      schemaVersion: 1,
      handle,
      code: "synthetic-code",
      verifier: "v".repeat(96),
    });
  return {
    app,
    request,
    exchange,
    states,
    sessions,
    fetch,
    resolver,
    principal,
    service,
  };
}
afterEach(() => vi.useRealTimers());
describe("versioned browser refresh session transport", () => {
  it("restores only from a secure cookie plus current verified identity; APIs still require bearer", async () => {
    const f = fixture();
    const response = await f.exchange();
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-cloudmarkup-refresh=/u);
    expect(cookie).toContain("Secure; HttpOnly; SameSite=Strict");
    expect(cookie).not.toContain("Domain=");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const json = await response.json();
    expect(json).toMatchObject({ schemaVersion: 1, accessToken: access });
    expect(JSON.stringify(json)).not.toContain(refresh);
    const restored = await f.request(
      "restore",
      { schemaVersion: 1 },
      cookie.split(";")[0],
    );
    expect(restored.status).toBe(200);
    expect(restored.headers.get("set-cookie")).toBeNull();
    expect(f.sessions.current).toHaveBeenCalledWith(handle, f.principal);
    expect(
      (await f.app.request("/v1/principal", { headers: { cookie } })).status,
    ).not.toBe(200);
    expect(f.fetch.mock.calls[0]?.[0]).toEqual(
      new URL(
        "https://synthetic.auth.us-east-1.amazoncognito.com/oauth2/token",
      ),
    );
    expect(f.fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
  });
  it.each(["exchange", "restore", "cancel", "logout"])(
    "rejects cross-origin %s before store or provider access",
    async (operation) => {
      const f = fixture();
      expect(
        (
          await f.request(operation, { schemaVersion: 1, handle }, undefined, {
            origin: "https://attacker.example",
          })
        ).status,
      ).toBe(403);
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.sessions.begin).not.toHaveBeenCalled();
      expect(f.sessions.revoke).not.toHaveBeenCalled();
    },
  );
  it.each([
    { "x-cloudmarkup-session": "" },
    { "sec-fetch-site": "same-site" },
    { "content-type": "text/plain" },
  ])("rejects missing CSRF protections", async (headers) => {
    const f = fixture();
    expect((await f.request("exchange", {}, undefined, headers)).status).toBe(
      403,
    );
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("preserves a session through transient provider failure and rejects invalid_grant", async () => {
    const f = fixture();
    const cookie = (await f.exchange()).headers
      .get("set-cookie")
      ?.split(";")[0];
    f.fetch.mockRejectedValueOnce(Error("private provider failure"));
    const failed = await f.request("restore", { schemaVersion: 1 }, cookie);
    expect(failed.status).toBe(503);
    expect(failed.headers.get("set-cookie")).toBeNull();
    expect(f.states.get(handle)).toBe("active");
    expect(await failed.text()).not.toContain("private");
    expect(
      (await f.request("restore", { schemaVersion: 1 }, cookie)).status,
    ).toBe(200);
    f.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(
      (await f.request("restore", { schemaVersion: 1 }, cookie)).status,
    ).toBe(401);
    expect(f.states.get(handle)).toBe("revoked");
  });
  it("cancellation before exchange creates a tombstone and prevents provider dispatch", async () => {
    const f = fixture();
    expect(
      (await f.request("cancel", { schemaVersion: 1, handle })).status,
    ).toBe(204);
    expect((await f.exchange()).status).toBe(401);
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("a cancellation racing a provider response cannot activate or emit a cookie", async () => {
    const f = fixture();
    let finish!: (response: Response) => void;
    f.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.exchange();
    await vi.waitFor(() => {
      expect(f.fetch).toHaveBeenCalledTimes(1);
    });
    await f.request("cancel", { schemaVersion: 1, handle });
    finish(token());
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(f.states.get(handle)).toBe("revoked");
  });
  it("logout prevents a delayed restore and remains revoked when provider revocation fails", async () => {
    const f = fixture();
    const cookie = (await f.exchange()).headers
      .get("set-cookie")
      ?.split(";")[0];
    let finish!: (response: Response) => void;
    f.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.request("restore", { schemaVersion: 1 }, cookie);
    await vi.waitFor(() => {
      expect(f.fetch).toHaveBeenCalledTimes(2);
    });
    f.fetch.mockRejectedValueOnce(Error("offline"));
    const logout = await f.request("logout", { schemaVersion: 1 }, cookie);
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toBeNull();
    finish(token());
    const delayed = await pending;
    expect(delayed.status).toBe(401);
    expect(delayed.headers.get("set-cookie")).toBeNull();
    expect(f.states.get(handle)).toBe("revoked");
  });
  it("a delayed logout cannot clear a newer sign-in cookie", async () => {
    const f = fixture();
    const oldCookie = (await f.exchange()).headers
      .get("set-cookie")
      ?.split(";")[0];
    let finish!: (response: Response) => void;
    f.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.request("logout", { schemaVersion: 1 }, oldCookie);
    await vi.waitFor(() => {
      expect(f.states.get(handle)).toBe("revoked");
      expect(f.fetch).toHaveBeenCalledTimes(2);
    });
    const nextHandle = "b".repeat(43);
    const signedIn = await f.request("exchange", {
      schemaVersion: 1,
      handle: nextHandle,
      code: "next-synthetic-code",
      verifier: "v".repeat(96),
    });
    expect(signedIn.status).toBe(200);
    const newCookie = signedIn.headers.get("set-cookie")?.split(";")[0];
    expect(newCookie).toBeDefined();
    expect(newCookie).not.toBe(oldCookie);
    finish(new Response(null, { status: 200 }));
    const loggedOut = await pending;
    expect(loggedOut.status).toBe(204);
    expect(loggedOut.headers.get("set-cookie")).toBeNull();
    expect(
      (await f.request("restore", { schemaVersion: 1 }, oldCookie)).status,
    ).toBe(401);
    expect(
      (await f.request("restore", { schemaVersion: 1 }, newCookie)).status,
    ).toBe(200);
    expect(f.states.get(nextHandle)).toBe("active");
  });

  it("denies switched principal or refresh family before returning access", async () => {
    const f = fixture();
    const cookie = (await f.exchange()).headers
      .get("set-cookie")
      ?.split(";")[0];
    f.resolver.resolve.mockResolvedValueOnce({
      ...f.principal,
      sessionId: "other-family",
    });
    expect(
      (await f.request("restore", { schemaVersion: 1 }, cookie)).status,
    ).toBe(401);
  });
  it("stops an oversized streaming body before buffering it or using session authority", async () => {
    const f = fixture();
    let pulled = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024).fill(32));
        if (pulled === 100) controller.close();
      },
      cancel,
    });
    const response = await f.app.request(
      new Request(origin + "/auth/session/v1/exchange", {
        method: "POST",
        body,
        headers: {
          origin,
          "content-type": "application/json",
          "x-cloudmarkup-session": "1",
          "sec-fetch-site": "same-origin",
        },
        ...{ duplex: "half" },
      }),
    );
    expect(response.status).toBe(400);
    expect(pulled).toBeLessThanOrEqual(10);
    expect(cancel).toHaveBeenCalledOnce();
    expect(f.sessions.begin).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("rejects unbounded, malformed and duplicate cookies and extra body fields", async () => {
    const f = fixture();
    for (const cookie of [
      "__Host-cloudmarkup-refresh=%garbage",
      "__Host-cloudmarkup-refresh=" + "x".repeat(3801),
      "__Host-cloudmarkup-refresh=a; __Host-cloudmarkup-refresh=b",
    ]) {
      expect(
        (await f.request("restore", { schemaVersion: 1 }, cookie)).status,
      ).toBe(401);
    }
    expect(
      (
        await f.request("restore", {
          schemaVersion: 1,
          organizationId: "untrusted",
        })
      ).status,
    ).toBe(400);
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
