import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CognitoBrowserAuthSession,
  type CognitoBrowserAuthEnvironment,
} from "./cognito-browser-auth.js";
const origin = "https://beta.example.invalid";
const accessToken = ["a", "b", "c"].map((s) => s.repeat(48)).join(".");
const nextToken = ["d", "e", "f"].map((s) => s.repeat(48)).join(".");
const started = Date.parse("2026-09-17T12:00:00.000Z");
const config = {
  schemaVersion: 1,
  authentication: {
    clientId: "a".repeat(26),
    domain: "https://cloudmarkup-beta.auth.us-east-1.amazoncognito.com",
    callbackUrl: origin + "/auth/callback",
    logoutUrl: origin,
    provider: "cognito",
    scopes: ["openid", "profile", "cloudmarkup-api/access"],
  },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
function deferred() {
  let finish!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}
function requestBody(options: RequestInit | undefined): string {
  if (typeof options?.body !== "string")
    throw Error("Expected a JSON session request.");
  return options.body;
}
function fixture() {
  let now = started;
  const fetch = vi.fn<typeof globalThis.fetch>();
  const environment = (): CognitoBrowserAuthEnvironment => ({
    cryptoImplementation: globalThis.crypto,
    fetchImplementation: fetch,
    now: () => now,
    origin,
    secureSession: true,
  });
  const session = new CognitoBrowserAuthSession(environment);
  const grant = (value = accessToken) =>
    json({
      schemaVersion: 1,
      accessToken: value,
      expiresIn: 1800,
      sessionExpiresAt: new Date(started + 8 * 60 * 60 * 1000).toISOString(),
    });
  async function prepare() {
    fetch
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(config));
    return session.prepareAuthorization();
  }
  async function signIn() {
    const prepared = await prepare();
    fetch.mockResolvedValueOnce(grant());
    await session.completeCallback({
      kind: "success",
      state: prepared.state,
      code: "synthetic-code",
    });
    return prepared;
  }
  return {
    session,
    fetch,
    environment,
    grant,
    prepare,
    signIn,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
afterEach(() => vi.restoreAllMocks());
describe("secure browser session restoration", () => {
  it("exchanges PKCE through the same-origin host and restores a fresh browser instance", async () => {
    const f = fixture();
    const prepared = await f.signIn();
    expect(f.session.getAccessToken()).toBe(accessToken);
    const call = f.fetch.mock.calls[2];
    if (call === undefined) throw Error("Expected session exchange.");
    const [url, options] = call;
    expect(url).toBe(origin + "/api/auth/session/v1/exchange");
    expect(options).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-cloudmarkup-session": "1",
      },
    });
    const body = JSON.parse(requestBody(options)) as Record<string, unknown>;
    expect(body).toMatchObject({ schemaVersion: 1, code: "synthetic-code" });
    expect(body["handle"]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(body["handle"]).not.toBe(prepared.state);
    expect(body["verifier"]).toMatch(/^[A-Za-z0-9_-]{128}$/u);
    expect(prepared.authorizationUrl).not.toContain(String(body["handle"]));
    f.fetch.mockResolvedValueOnce(f.grant(nextToken));
    const reloaded = new CognitoBrowserAuthSession(f.environment);
    expect(await reloaded.getValidAccessToken()).toBe(nextToken);
    expect(f.fetch.mock.calls[3]).toMatchObject([
      origin + "/api/auth/session/v1/restore",
      { credentials: "same-origin", body: '{"schemaVersion":1}' },
    ]);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(JSON.stringify(f.session)).not.toContain(accessToken);
  });
  it("shares restoration and preserves recovery after a transient outage", async () => {
    const f = fixture();
    const pending = deferred();
    f.fetch.mockReturnValueOnce(pending.promise);
    const first = f.session.getValidAccessToken();
    const second = f.session.getValidAccessToken();
    const checks = [
      expect(first).rejects.toMatchObject({ code: "token-unavailable" }),
      expect(second).rejects.toMatchObject({ code: "token-unavailable" }),
    ];
    pending.finish(json({ schemaVersion: 1, error: "unavailable" }, 503));
    await Promise.all(checks);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    await expect(f.session.getValidAccessToken()).rejects.toMatchObject({
      code: "token-unavailable",
    });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    f.advance(5000);
    f.fetch.mockResolvedValueOnce(f.grant());
    expect(await f.session.getValidAccessToken()).toBe(accessToken);
  });
  it("keeps a still-valid token through a renewal outage", async () => {
    const f = fixture();
    await f.signIn();
    f.advance(29 * 60000);
    f.fetch.mockResolvedValueOnce(
      json({ schemaVersion: 1, error: "unavailable" }, 503),
    );
    expect(await f.session.getValidAccessToken()).toBe(accessToken);
    expect(f.session.getAccessToken()).toBe(accessToken);
  });
  it("stops automatic restoration after a confirmed rejection", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(
      json({ schemaVersion: 1, error: "rejected" }, 401),
    );
    expect(await f.session.getValidAccessToken()).toBeUndefined();
    expect(await f.session.getValidAccessToken()).toBeUndefined();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps a new sign-in pending when an older guest restore is rejected", async () => {
    const f = fixture();
    const restore = deferred();
    const accountAccess = deferred();
    f.fetch
      .mockReturnValueOnce(restore.promise)
      .mockReturnValueOnce(accountAccess.promise)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(config));

    const restored = f.session.getValidAccessToken();
    const preparation = f.session.prepareAuthorization("sign-in");
    expect(f.fetch.mock.calls[0]?.[0]).toBe(
      origin + "/api/auth/session/v1/restore",
    );
    expect(f.fetch.mock.calls[1]?.[0]).toContain("?view=account");

    restore.finish(json({ schemaVersion: 1, error: "rejected" }, 401));
    expect(await restored).toBeUndefined();
    accountAccess.finish(
      json({ schemaVersion: 1, managedLogin: true, registrationEnabled: true }),
    );
    const prepared = await preparation;
    expect(new URL(prepared.authorizationUrl).pathname).toBe(
      "/oauth2/authorize",
    );
    expect(f.fetch.mock.calls[2]?.[0]).toBe(
      origin + "/api/auth/session/v1/logout",
    );
    expect(await f.session.getValidAccessToken()).toBeUndefined();
  });
  it("retains a failed cancellation handle and revokes it before another sign-in", async () => {
    const f = fixture();
    await f.prepare();
    f.fetch.mockResolvedValueOnce(
      json({ schemaVersion: 1, error: "unavailable" }, 503),
    );
    await expect(f.session.cancelPendingAuthorization()).rejects.toMatchObject({
      code: "token-unavailable",
    });
    const cancel = f.fetch.mock.calls[2];
    expect(cancel?.[1]?.credentials).toBe("omit");
    expect(await f.session.getValidAccessToken()).toBeUndefined();
    f.fetch
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(config));
    await f.session.prepareAuthorization();
    expect(f.fetch.mock.calls[3]?.[0]).toBe(
      origin + "/api/auth/session/v1/cancel",
    );
    expect(f.fetch.mock.calls[3]?.[1]?.body).toBe(cancel?.[1]?.body);
  });
  it("fences a late restored token after local sign-out", async () => {
    const f = fixture();
    const pending = deferred();
    f.fetch.mockReturnValueOnce(pending.promise);
    const restored = f.session.getValidAccessToken();
    f.session.clearSession();
    pending.finish(f.grant());
    expect(await restored).toBeUndefined();
    expect(await f.session.getValidAccessToken()).toBeUndefined();
  });
  it("durably cancels an in-flight exchange and ignores its late response", async () => {
    const f = fixture();
    const prepared = await f.prepare();
    const pending = deferred();
    f.fetch.mockReturnValueOnce(pending.promise);
    const completion = f.session.completeCallback({
      kind: "success",
      state: prepared.state,
      code: "synthetic-code",
    });
    const rejected = expect(completion).rejects.toMatchObject({
      code: "authorization-cancelled",
    });
    f.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await f.session.cancelPendingAuthorization();
    pending.finish(f.grant());
    await rejected;
    const exchanged = JSON.parse(
      requestBody(f.fetch.mock.calls[2]?.[1]),
    ) as Record<string, unknown>;
    const cancelled = JSON.parse(
      requestBody(f.fetch.mock.calls[3]?.[1]),
    ) as Record<string, unknown>;
    expect(cancelled["handle"]).toBe(exchanged["handle"]);
    expect(await f.session.getValidAccessToken()).toBeUndefined();
  });
  it("does not extend the original eight-hour lifetime after restoration", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(f.grant());
    expect(await f.session.getValidAccessToken()).toBe(accessToken);
    f.advance(8 * 60 * 60 * 1000);
    expect(await f.session.getValidAccessToken()).toBeUndefined();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not confirm sign-out when durable revocation is unavailable", async () => {
    const f = fixture();
    await f.signIn();
    f.fetch.mockResolvedValueOnce(
      json({ schemaVersion: 1, error: "unavailable" }, 503),
    );
    await expect(f.session.createLogoutUrl()).rejects.toMatchObject({
      code: "token-unavailable",
    });
    f.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await f.session.createLogoutUrl()).toContain("/logout?");
    f.session.clearSession();
    expect(await f.session.getValidAccessToken()).toBeUndefined();
  });
});

describe("configured browser session transport", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it.each([true, false])(
    "limits default restoration to production (development=%s)",
    async (development) => {
      vi.stubEnv("DEV", development);
      const fetch = vi
        .spyOn(window, "fetch")
        .mockResolvedValue(new Response(null, { status: 401 }));
      const session = new CognitoBrowserAuthSession();
      await expect(session.getValidAccessToken()).resolves.toBeUndefined();
      expect(fetch).toHaveBeenCalledTimes(development ? 0 : 1);
      if (!development)
        expect(fetch).toHaveBeenCalledWith(
          window.location.origin + "/api/auth/session/v1/restore",
          expect.objectContaining({
            credentials: "same-origin",
            method: "POST",
          }),
        );
    },
  );
});
