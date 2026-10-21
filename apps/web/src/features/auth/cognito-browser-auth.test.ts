import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COGNITO_BROWSER_AUTH_COMPOSITION,
  COGNITO_BROWSER_SESSION_MAXIMUM_MILLISECONDS,
  COGNITO_AUTHORIZATION_TIMEOUT_MILLISECONDS,
  CognitoBrowserAuthError,
  CognitoBrowserAuthSession,
  parseCognitoRuntimeConfig,
  startCognitoSignInWithPopup,
  type CognitoBrowserAuthEnvironment,
} from "./cognito-browser-auth.js";

const origin = "https://beta.example.invalid";
const clientId = "a".repeat(26);
const accessToken = `${"a".repeat(48)}.${"b".repeat(48)}.${"c".repeat(48)}`;

class TestBroadcastChannel {
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  public readonly close = vi.fn();
  public readonly name: string;
  public readonly postMessage = vi.fn();

  public constructor(name: string) {
    this.name = name;
  }
}

function popupFixture() {
  let closedReads = 0;
  const close = vi.fn();
  const replace = vi.fn();
  const popup = {
    close,
    location: { replace },
    opener: window,
  };
  Object.defineProperty(popup, "closed", {
    get() {
      closedReads += 1;
      throw new Error("A severed WindowProxy must not be inspected.");
    },
  });
  return {
    close,
    closedReads: () => closedReads,
    popup: popup as unknown as Window,
    replace,
  };
}

function popupSessionFixture() {
  const cancelPendingAuthorization = vi.fn().mockResolvedValue(undefined);
  const completeCallback = vi.fn().mockResolvedValue(undefined);
  const prepareAuthorization = vi.fn().mockResolvedValue({
    authorizationUrl:
      "https://cloudmarkup-beta-000000000000.auth.us-east-1.amazoncognito.com/oauth2/authorize",
    state: "a".repeat(43),
  });
  return {
    cancelPendingAuthorization,
    completeCallback,
    prepareAuthorization,
    session: {
      cancelPendingAuthorization,
      completeCallback,
      prepareAuthorization,
    } as unknown as CognitoBrowserAuthSession,
  };
}

function runtimeConfig(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    authentication: {
      callbackUrl: `${origin}/auth/callback`,
      clientId,
      domain:
        "https://cloudmarkup-beta-000000000000.auth.us-east-1.amazoncognito.com",
      logoutUrl: origin,
      provider: "cognito",
      scopes: ["openid", "profile", "cloudmarkup-api/access"],
      ...overrides,
    },
    schemaVersion: 1,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
}

function authEnvironment(
  fetchImplementation: typeof globalThis.fetch,
  now = () => Date.parse("2026-09-02T12:00:00.000Z"),
): CognitoBrowserAuthEnvironment {
  return {
    cryptoImplementation: globalThis.crypto,
    fetchImplementation,
    now,
    origin,
  };
}

function callbackSearch(authorizationUrl: string, code = "code_value"): string {
  const state = new URL(authorizationUrl).searchParams.get("state");
  if (state === null)
    throw new Error("The test authorization state is absent.");
  return `?code=${code}&state=${state}`;
}

describe("Cognito browser Authorization Code + PKCE", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("identifies the reviewed production browser composition", () => {
    const session = new CognitoBrowserAuthSession(() =>
      authEnvironment(() => Promise.resolve(new Response(null))),
    );

    expect(session.composition).toBe(COGNITO_BROWSER_AUTH_COMPOSITION);
    expect(session.composition).toBe(
      "cloudmarkup.auth-composition/cognito-pkce-v1",
    );
  });

  it("rejects malformed, non-Cognito, cross-origin, or broadened runtime configuration", () => {
    const invalid = [
      runtimeConfig({ domain: "https://login.example.test" }),
      runtimeConfig({ callbackUrl: "https://attacker.invalid/auth/callback" }),
      runtimeConfig({ callbackUrl: `${origin}/auth/callback?next=/projects` }),
      runtimeConfig({ logoutUrl: `${origin}/signed-out` }),
      runtimeConfig({
        scopes: [
          "openid",
          "profile",
          "cloudmarkup-api/access",
          "aws.cognito.signin.user.admin",
        ],
      }),
      { ...runtimeConfig(), extra: true },
    ];

    for (const value of invalid) {
      expect(() => parseCognitoRuntimeConfig(value, origin)).toThrow(
        CognitoBrowserAuthError,
      );
    }
  });

  it("rejects a state mismatch without consuming the valid in-memory transaction", async () => {
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(runtimeConfig()))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: accessToken,
          expires_in: 1800,
          token_type: "Bearer",
        }),
      );
    const session = new CognitoBrowserAuthSession(() =>
      authEnvironment(fetchImplementation),
    );
    const prepared = await session.prepareAuthorization();
    expect(new URL(prepared.authorizationUrl).searchParams.get("prompt")).toBe(
      "login",
    );

    await expect(
      session.completeCallback(`?code=code_value&state=${"z".repeat(43)}`),
    ).rejects.toMatchObject({ code: "authorization-state-mismatch" });
    expect(session.getAccessToken()).toBeUndefined();

    await session.completeCallback(callbackSearch(prepared.authorizationUrl));
    expect(session.getAccessToken()).toBe(accessToken);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("exchanges one callback once and rejects replay without a second token request", async () => {
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(runtimeConfig()))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: accessToken,
          expires_in: 1800,
          id_token: `${"d".repeat(48)}.${"e".repeat(48)}.${"f".repeat(48)}`,
          refresh_token: "synthetic-refresh-token",
          token_type: "Bearer",
        }),
      );
    const session = new CognitoBrowserAuthSession(() =>
      authEnvironment(fetchImplementation),
    );
    const prepared = await session.prepareAuthorization();
    const callback = callbackSearch(prepared.authorizationUrl);

    await session.completeCallback(callback);
    await expect(session.completeCallback(callback)).rejects.toMatchObject({
      code: "authorization-replayed",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(session.getAccessToken()).toBe(accessToken);
  });

  it("fails closed on token exchange failure and will not replay the code", async () => {
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(runtimeConfig()))
      .mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400));
    const session = new CognitoBrowserAuthSession(() =>
      authEnvironment(fetchImplementation),
    );
    const prepared = await session.prepareAuthorization();
    const callback = callbackSearch(prepared.authorizationUrl);

    await expect(session.completeCallback(callback)).rejects.toMatchObject({
      code: "token-rejected",
    });
    expect(session.getAccessToken()).toBeUndefined();
    await expect(session.completeCallback(callback)).rejects.toMatchObject({
      code: "authorization-replayed",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("keeps verifier, state, discarded ID tokens, and session credentials out of browser storage", async () => {
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    const cookieBefore = document.cookie;
    const fetchImplementation = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(runtimeConfig()))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: accessToken,
          expires_in: 1800,
          id_token: `${"d".repeat(48)}.${"e".repeat(48)}.${"f".repeat(48)}`,
          refresh_token: "synthetic-refresh-token",
          token_type: "Bearer",
        }),
      );
    const session = new CognitoBrowserAuthSession(() =>
      authEnvironment(fetchImplementation),
    );
    const prepared = await session.prepareAuthorization();
    await session.completeCallback(callbackSearch(prepared.authorizationUrl));

    expect(session.getAccessToken()).toBe(accessToken);
    expect(localSet).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(document.cookie).toBe(cookieBefore);
  });

  it("cancels through AbortSignal without reading a COOP-severed popup handle", async () => {
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    const popup = popupFixture();
    vi.spyOn(window, "open").mockReturnValue(popup.popup);
    const auth = popupSessionFixture();
    const controller = new AbortController();
    const completion = startCognitoSignInWithPopup(auth.session, {
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(popup.replace).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(completion).rejects.toMatchObject({
      code: "authorization-cancelled",
    });
    expect(auth.cancelPendingAuthorization).toHaveBeenCalledOnce();
    expect(popup.closedReads()).toBe(0);
  });

  it.each(["acknowledged", "unavailable"])(
    "settles cancellation when popup closure is blocked and cancellation is %s",
    async (cancellation) => {
      vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
      const popup = popupFixture();
      popup.close.mockImplementation(() => {
        throw new Error("The cross-origin popup handle cannot be closed.");
      });
      vi.spyOn(window, "open").mockReturnValue(popup.popup);
      const auth = popupSessionFixture();
      if (cancellation === "unavailable") {
        auth.cancelPendingAuthorization.mockRejectedValueOnce(
          new Error("Synthetic cancellation service unavailable"),
        );
      }
      const controller = new AbortController();
      const completion = startCognitoSignInWithPopup(auth.session, {
        signal: controller.signal,
      });
      await vi.waitFor(() => {
        expect(popup.replace).toHaveBeenCalledOnce();
      });
      controller.abort();

      await expect(completion).rejects.toMatchObject({
        code:
          cancellation === "acknowledged"
            ? "authorization-cancelled"
            : "token-unavailable",
      });
      expect(auth.cancelPendingAuthorization).toHaveBeenCalledOnce();
      expect(popup.close).toHaveBeenCalledOnce();
      expect(popup.closedReads()).toBe(0);
    },
  );

  it("expires an unfinished popup attempt after the bounded ten-minute maximum", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    const popup = popupFixture();
    vi.spyOn(window, "open").mockReturnValue(popup.popup);
    const auth = popupSessionFixture();
    const completion = startCognitoSignInWithPopup(auth.session);
    const rejection = expect(completion).rejects.toMatchObject({
      code: "authorization-expired",
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(popup.replace).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(
      COGNITO_AUTHORIZATION_TIMEOUT_MILLISECONDS,
    );

    await rejection;
    expect(COGNITO_AUTHORIZATION_TIMEOUT_MILLISECONDS).toBe(600_000);
    expect(auth.cancelPendingAuthorization).toHaveBeenCalledOnce();
    expect(popup.closedReads()).toBe(0);
  });
  function deferredResponse() {
    let finish: (response: Response) => void = () => {
      throw new Error("Deferred response is not initialized.");
    };
    const promise = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    return { finish, promise };
  }

  function tokenRequestBody(body: BodyInit | null | undefined): string {
    if (!(body instanceof URLSearchParams))
      throw new Error("Expected a form token request.");
    return body.toString();
  }

  function renewalFixture() {
    let now = Date.parse("2026-09-02T12:00:00.000Z");
    const fetchImplementation = vi.fn<typeof globalThis.fetch>();
    const session = new CognitoBrowserAuthSession(() =>
      authEnvironment(fetchImplementation, () => now),
    );
    const tokenResponse = (
      refreshToken: string | null = "synthetic-refresh-one",
      token = accessToken,
    ) =>
      jsonResponse({
        access_token: token,
        expires_in: 1800,
        token_type: "Bearer",
        ...(refreshToken === null ? {} : { refresh_token: refreshToken }),
      });
    const signIn = async (response = tokenResponse()) => {
      fetchImplementation
        .mockResolvedValueOnce(jsonResponse(runtimeConfig()))
        .mockResolvedValueOnce(response);
      const prepared = await session.prepareAuthorization();
      await session.completeCallback(callbackSearch(prepared.authorizationUrl));
    };
    return {
      session,
      fetchImplementation,
      tokenResponse,
      signIn,
      advance: (milliseconds: number) => {
        now += milliseconds;
      },
    };
  }

  it("uses a current token without contacting the provider and renews once for concurrent callers", async () => {
    const fixture = renewalFixture();
    await fixture.signIn();
    expect(await fixture.session.getValidAccessToken()).toBe(accessToken);
    expect(fixture.fetchImplementation).toHaveBeenCalledTimes(2);
    fixture.advance(29 * 60_000);
    const response = deferredResponse();
    fixture.fetchImplementation.mockReturnValueOnce(response.promise);
    const requests = Array.from({ length: 5 }, () =>
      fixture.session.getValidAccessToken(),
    );
    expect(fixture.fetchImplementation).toHaveBeenCalledTimes(3);
    const renewed = `${"g".repeat(48)}.${"h".repeat(48)}.${"i".repeat(48)}`;
    response.finish(fixture.tokenResponse(null, renewed));
    expect(await Promise.all(requests)).toEqual(
      Array.from({ length: 5 }, () => renewed),
    );
    const request = fixture.fetchImplementation.mock.calls[2];
    expect(request?.[0]).toBe(
      runtimeConfig().authentication.domain + "/oauth2/token",
    );
    expect(request?.[1]).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    expect(tokenRequestBody(request?.[1]?.body)).toBe(
      new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: "synthetic-refresh-one",
      }).toString(),
    );
  });

  it("retains refresh credentials only in memory and uses a rotated credential for the next renewal", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const before = document.cookie;
    const fixture = renewalFixture();
    await fixture.signIn();
    fixture.advance(31 * 60_000);
    expect(fixture.session.getAccessToken()).toBeUndefined();
    fixture.fetchImplementation.mockResolvedValueOnce(
      fixture.tokenResponse("synthetic-refresh-two"),
    );
    expect(await fixture.session.getValidAccessToken()).toBe(accessToken);
    fixture.advance(31 * 60_000);
    fixture.fetchImplementation.mockResolvedValueOnce(fixture.tokenResponse());
    await fixture.session.getValidAccessToken();
    expect(
      tokenRequestBody(fixture.fetchImplementation.mock.calls[3]?.[1]?.body),
    ).toContain("refresh_token=synthetic-refresh-two");
    expect(storage).not.toHaveBeenCalled();
    expect(document.cookie).toBe(before);
    expect(
      new CognitoBrowserAuthSession(() =>
        authEnvironment(fixture.fetchImplementation),
      ).getAccessToken(),
    ).toBeUndefined();
  });

  it("does not invent a refresh credential for an access-token-only sign-in", async () => {
    const fixture = renewalFixture();
    await fixture.signIn(
      jsonResponse({
        access_token: accessToken,
        expires_in: 1800,
        token_type: "Bearer",
      }),
    );
    fixture.advance(31 * 60_000);
    expect(await fixture.session.getValidAccessToken()).toBeUndefined();
    expect(fixture.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it.each(["rejected", "malformed"] as const)(
    "clears local credentials when renewal is %s, without retrying the provider",
    async (failure) => {
      const fixture = renewalFixture();
      await fixture.signIn();
      fixture.advance(29 * 60_000);
      fixture.fetchImplementation.mockResolvedValueOnce(
        failure === "rejected"
          ? jsonResponse({ error: "invalid_grant" }, 400)
          : jsonResponse({ access_token: "invalid" }),
      );
      expect(await fixture.session.getValidAccessToken()).toBeUndefined();
      expect(fixture.session.getAccessToken()).toBeUndefined();
      expect(await fixture.session.getValidAccessToken()).toBeUndefined();
      expect(fixture.fetchImplementation).toHaveBeenCalledTimes(3);
    },
  );

  it("preserves renewal after a transient outage and shares a bounded retry cooldown", async () => {
    const fixture = renewalFixture();
    await fixture.signIn();
    fixture.advance(29 * 60_000);
    fixture.fetchImplementation.mockRejectedValueOnce(
      new Error("private provider failure"),
    );
    expect(await fixture.session.getValidAccessToken()).toBe(accessToken);
    expect(await fixture.session.getValidAccessToken()).toBe(accessToken);
    expect(fixture.fetchImplementation).toHaveBeenCalledTimes(3);
    fixture.advance(2 * 60_000);
    fixture.fetchImplementation.mockResolvedValueOnce(jsonResponse({}, 503));
    await expect(fixture.session.getValidAccessToken()).rejects.toMatchObject({
      code: "token-unavailable",
    });
    await expect(fixture.session.getValidAccessToken()).rejects.toMatchObject({
      code: "token-unavailable",
    });
    expect(fixture.fetchImplementation).toHaveBeenCalledTimes(4);
    fixture.advance(5000);
    fixture.fetchImplementation.mockResolvedValueOnce(fixture.tokenResponse());
    expect(await fixture.session.getValidAccessToken()).toBe(accessToken);
    expect(fixture.fetchImplementation).toHaveBeenCalledTimes(5);
  });

  it("aborts a stalled refresh after fifteen seconds and never returns a late token", async () => {
    vi.useFakeTimers();
    const fixture = renewalFixture();
    await fixture.signIn();
    fixture.advance(29 * 60_000);
    const response = deferredResponse();
    fixture.fetchImplementation.mockReturnValueOnce(response.promise);
    const token = fixture.session.getValidAccessToken();
    const signal = fixture.fetchImplementation.mock.calls[2]?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(signal?.aborted).toBe(true);
    response.finish(fixture.tokenResponse());
    expect(await token).toBe(accessToken);
    expect(fixture.session.getAccessToken()).toBe(accessToken);
  });

  it("cannot restore credentials after sign-out while a refresh is in flight", async () => {
    const fixture = renewalFixture();
    await fixture.signIn();
    fixture.advance(29 * 60_000);
    const response = deferredResponse();
    fixture.fetchImplementation.mockReturnValueOnce(response.promise);
    const token = fixture.session.getValidAccessToken();
    const signal = fixture.fetchImplementation.mock.calls[2]?.[1]?.signal;
    fixture.session.clearSession();
    expect(signal?.aborted).toBe(true);
    response.finish(fixture.tokenResponse());
    expect(await token).toBeUndefined();
    expect(await fixture.session.getValidAccessToken()).toBeUndefined();
    expect(fixture.fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("does not replace a new sign-in with an old refresh response", async () => {
    const fixture = renewalFixture();
    await fixture.signIn();
    fixture.advance(29 * 60_000);
    const response = deferredResponse();
    fixture.fetchImplementation.mockReturnValueOnce(response.promise);
    const oldRequest = fixture.session.getValidAccessToken();
    const nextToken = `${"j".repeat(48)}.${"k".repeat(48)}.${"l".repeat(48)}`;
    await fixture.signIn(
      fixture.tokenResponse("synthetic-new-login", nextToken),
    );
    response.finish(fixture.tokenResponse());
    expect(await oldRequest).toBeUndefined();
    expect(await fixture.session.getValidAccessToken()).toBe(nextToken);
  });

  it.each(["clearSession", "cancelPendingAuthorization"] as const)(
    "rejects a late code exchange after %s",
    async (cancel) => {
      const fixture = renewalFixture();
      const response = deferredResponse();
      fixture.fetchImplementation
        .mockResolvedValueOnce(jsonResponse(runtimeConfig()))
        .mockReturnValueOnce(response.promise);
      const prepared = await fixture.session.prepareAuthorization();
      const completion = fixture.session.completeCallback(
        callbackSearch(prepared.authorizationUrl),
      );
      const rejected = expect(completion).rejects.toBeInstanceOf(
        CognitoBrowserAuthError,
      );
      await fixture.session[cancel]();
      response.finish(fixture.tokenResponse());
      await rejected;
      expect(await fixture.session.getValidAccessToken()).toBeUndefined();
    },
  );

  it("rejects concurrent preparation and cannot revive a canceled preparation", async () => {
    const fixture = renewalFixture();
    const response = deferredResponse();
    fixture.fetchImplementation.mockReturnValueOnce(response.promise);
    const preparation = fixture.session.prepareAuthorization();
    const rejected = expect(preparation).rejects.toMatchObject({
      code: "authorization-cancelled",
    });
    await expect(fixture.session.prepareAuthorization()).rejects.toMatchObject({
      code: "authorization-in-progress",
    });
    fixture.session.clearSession();
    response.finish(jsonResponse(runtimeConfig()));
    await rejected;
    expect(await fixture.session.getValidAccessToken()).toBeUndefined();
  });

  it("requires a new interactive sign-in at the eight-hour tab limit", async () => {
    const fixture = renewalFixture();
    await fixture.signIn();
    fixture.advance(COGNITO_BROWSER_SESSION_MAXIMUM_MILLISECONDS);
    expect(await fixture.session.getValidAccessToken()).toBeUndefined();
    expect(fixture.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("does not extend the eight-hour limit when a refresh finishes across it", async () => {
    const fixture = renewalFixture();
    await fixture.signIn();
    fixture.advance(COGNITO_BROWSER_SESSION_MAXIMUM_MILLISECONDS - 1000);
    const response = deferredResponse();
    fixture.fetchImplementation.mockReturnValueOnce(response.promise);
    const token = fixture.session.getValidAccessToken();
    fixture.advance(1000);
    response.finish(fixture.tokenResponse());
    expect(await token).toBeUndefined();
    expect(await fixture.session.getValidAccessToken()).toBeUndefined();
  });

  it.each(["", "bad token", "bad\ntoken", "x".repeat(16_385)])(
    "rejects a malformed refresh credential without leaking it",
    async (refreshToken) => {
      const fixture = renewalFixture();
      await expect(
        fixture.signIn(fixture.tokenResponse(refreshToken)),
      ).rejects.toMatchObject({
        code: "token-invalid",
      });
      expect(await fixture.session.getValidAccessToken()).toBeUndefined();
    },
  );
});
