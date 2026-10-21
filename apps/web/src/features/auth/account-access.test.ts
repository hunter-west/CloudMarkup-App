import { describe, it, expect, vi } from "vitest";
import {
  CognitoBrowserAuthSession,
  type AccountAuthenticationIntent,
} from "./cognito-browser-auth.js";
const origin = "https://beta.example.invalid";
const runtime = {
  schemaVersion: 1,
  authentication: {
    provider: "cognito",
    clientId: "a".repeat(26),
    domain: "https://synthetic.auth.us-east-1.amazoncognito.com",
    callbackUrl: origin + "/auth/callback",
    logoutUrl: origin,
    scopes: ["openid", "profile", "cloudmarkup-api/access"],
  },
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}
function setup(registrationEnabled = false) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation((input) =>
      Promise.resolve(
        requestUrl(input).includes("?view=account")
          ? json({ schemaVersion: 1, managedLogin: true, registrationEnabled })
          : json(runtime),
      ),
    );
  const session = new CognitoBrowserAuthSession(() => ({
    origin,
    now: () => Date.parse("2026-10-01T10:00:00Z"),
    fetchImplementation: fetch,
    cryptoImplementation: globalThis.crypto,
  }));
  return { session, fetch };
}
describe("branded account PKCE entry points", () => {
  it.each([
    ["sign-in", "/oauth2/authorize"],
    ["recover", "/forgotPassword"],
    ["sign-up", "/signup"],
  ] as const)(
    "keeps %s bound to the same PKCE callback",
    async (intent, path) => {
      const { session } = setup(true);
      const prepared = await session.prepareAuthorization(intent);
      const url = new URL(prepared.authorizationUrl);
      expect(url.origin).toBe(runtime.authentication.domain);
      expect(url.pathname).toBe(path);
      expect(url.searchParams.get("redirect_uri")).toBe(
        runtime.authentication.callbackUrl,
      );
      expect(url.searchParams.get("prompt")).toBe("login");
      expect(url.searchParams.get("scope")).toBe(
        "openid profile cloudmarkup-api/access aws.cognito.signin.user.admin",
      );
      expect(url.searchParams.get("state")).toBe(prepared.state);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")).toMatch(
        /^[A-Za-z0-9_-]{43}$/u,
      );
    },
  );
  it("denies closed signup before clearing the existing token or cancelling its server cookie", async () => {
    const { session, fetch } = setup();
    const token = "a".repeat(48) + "." + "b".repeat(48) + "." + "c".repeat(48);
    fetch
      .mockResolvedValueOnce(json(runtime))
      .mockResolvedValueOnce(
        json({ access_token: token, expires_in: 1800, token_type: "Bearer" }),
      );
    const prepared = await session.prepareAuthorization();
    await session.completeCallback({
      kind: "success",
      code: "synthetic-code",
      state: prepared.state,
    });
    expect(session.getAccessToken()).toBe(token);
    await expect(session.prepareAuthorization("sign-up")).rejects.toMatchObject(
      { code: "registration-closed" },
    );
    expect(session.getAccessToken()).toBe(token);
    expect(
      fetch.mock.calls.some(([u]) => requestUrl(u).includes("/logout")),
    ).toBe(false);
  });
  it.each(["sign-in", "recover"] as const)(
    "allows %s when registration is closed or its display view is unavailable",
    async (intent) => {
      const { session, fetch } = setup(false);
      await expect(
        session.prepareAuthorization(intent),
      ).resolves.toHaveProperty("state");
      session.clearSession();
      fetch.mockResolvedValueOnce(json({}, 503));
      const p = await session.prepareAuthorization(intent);
      expect(new URL(p.authorizationUrl).searchParams.get("scope")).toBe(
        runtime.authentication.scopes.join(" "),
      );
    },
  );
  it("rechecks signup admission for each new attempt", async () => {
    const { session, fetch } = setup(true);
    await session.prepareAuthorization("sign-up");
    session.clearSession();
    fetch.mockResolvedValueOnce(
      json({
        schemaVersion: 1,
        managedLogin: true,
        registrationEnabled: false,
      }),
    );
    await expect(session.prepareAuthorization("sign-up")).rejects.toMatchObject(
      { code: "registration-closed" },
    );
  });
  it("rejects unrecognized capabilities and caller-selected auth intents", async () => {
    const { session, fetch } = setup(true);
    fetch.mockResolvedValueOnce(
      json({
        schemaVersion: 1,
        managedLogin: true,
        registrationEnabled: true,
        redirect: "https://attacker.example",
      }),
    );
    await expect(session.prepareAuthorization("sign-up")).rejects.toMatchObject(
      { code: "runtime-config-unavailable" },
    );
    await expect(
      session.prepareAuthorization("attacker" as AccountAuthenticationIntent),
    ).rejects.toMatchObject({ code: "authorization-unavailable" });
  });
  it("serializes concurrent prepares and cannot resume after cancellation while reading the gate", async () => {
    const { session, fetch } = setup(true);
    let resolve: (r: Response) => void = () => {
      throw Error("Uninitialized");
    };
    fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const first = session.prepareAuthorization("sign-up");
    await expect(session.prepareAuthorization("sign-in")).rejects.toMatchObject(
      { code: "authorization-in-progress" },
    );
    session.clearSession();
    resolve(
      json({ schemaVersion: 1, managedLogin: true, registrationEnabled: true }),
    );
    await expect(first).rejects.toMatchObject({
      code: "authorization-cancelled",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
