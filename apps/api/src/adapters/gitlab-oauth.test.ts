import { httpText } from "./gitlab-test-helpers.js";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GitLabOAuthAdapter } from "./gitlab-oauth.js";

const now = new Date("2026-10-01T12:00:00Z");
const clientId = "a".repeat(64);
const encoder = new TextEncoder();
const accessToken = "synthetic-gitlab-access-for-tests";
const refreshToken = "synthetic-gitlab-refresh-for-tests";
const token = {
  access_token: accessToken,
  refresh_token: refreshToken,
  token_type: "bearer",
  created_at: now.getTime() / 1000,
  expires_in: 7200,
};
const info = {
  resource_owner_id: 8,
  scope: ["api"],
  application: { uid: clientId },
  expires_in: 7199,
};
const user = { id: 8, username: "synthetic-owner", state: "active" };
const admission = { assertCurrentAdmission: () => Promise.resolve() };
const exchange = {
  code: "synthetic-authorization-code",
  verifier: "v".repeat(43),
};

function fixture(values: readonly unknown[] = [token, info, user]) {
  const secret = encoder.encode("synthetic-client-secret-for-tests");
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const value of values) fetch.mockResolvedValueOnce(Response.json(value));
  const readClientSecret = vi.fn(() => Promise.resolve(secret));
  const adapter = new GitLabOAuthAdapter({
    clientId,
    redirectUri: "https://app.example.test/account/gitlab/callback",
    readClientSecret,
    fetch,
    now: () => now,
  });
  return { adapter, fetch, secret, readClientSecret };
}
describe("GitLab OAuth protocol", () => {
  it("generates independent state and S256 verifiers with the actual API grant", () => {
    const { adapter } = fixture();
    const first = adapter.createAuthorization();
    const second = adapter.createAuthorization();
    const url = new URL(first.url);
    expect(url.origin + url.pathname).toBe(
      "https://gitlab.com/oauth/authorize",
    );
    expect(first.state).toHaveLength(43);
    expect(first.verifier).toHaveLength(43);
    expect(first.state).not.toBe(second.state);
    expect(first.verifier).not.toBe(second.verifier);
    expect(url.searchParams.get("state")).toBe(first.state);
    expect(url.searchParams.get("scope")).toBe("api");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(first.verifier).digest("base64url"),
    );
    expect(first.url).not.toContain(first.verifier);
  });
  it("verifies the OAuth app, scope and active user, then consumes secret buffers once", async () => {
    const { adapter, fetch, secret } = fixture();
    const grant = await adapter.exchange(exchange, admission);
    expect(grant).toMatchObject({
      providerUserId: 8,
      username: "synthetic-owner",
      expiresAt: "2026-10-01T13:59:59.000Z",
    });
    expect(JSON.stringify(grant)).not.toContain(accessToken);
    expect(JSON.stringify(grant)).not.toContain(refreshToken);
    expect(secret.every((byte) => byte === 0)).toBe(true);
    const body = new URLSearchParams(httpText(fetch.mock.calls[0]?.[1]?.body));
    expect(Object.fromEntries(body)).toMatchObject({
      client_id: clientId,
      redirect_uri: "https://app.example.test/account/gitlab/callback",
      grant_type: "authorization_code",
      code: exchange.code,
      code_verifier: exchange.verifier,
    });
    const tokens = await grant.consume((value) => {
      expect(new TextDecoder().decode(value.accessToken)).toBe(accessToken);
      return Promise.resolve(value);
    });
    expect(tokens.accessToken.every((byte) => byte === 0)).toBe(true);
    expect(tokens.refreshToken.every((byte) => byte === 0)).toBe(true);
    await expect(grant.consume(() => Promise.resolve())).rejects.toMatchObject({
      outcome: "not-sent",
    });
    expect(
      fetch.mock.calls.every(([url]) => !httpText(url).includes(accessToken)),
    ).toBe(true);
  });
  it("clears token buffers when encrypted persistence fails", async () => {
    const grant = await fixture().adapter.exchange(exchange, admission);
    let bytes: Uint8Array | undefined;
    await expect(
      grant.consume((tokens) => {
        bytes = tokens.accessToken;
        return Promise.reject(Error("storage failure"));
      }),
    ).rejects.toThrow("storage failure");
    expect(bytes?.every((byte) => byte === 0)).toBe(true);
  });
  it.each([
    [{ ...token, token_type: "basic" }, info, user],
    [{ ...token, expires_in: 0 }, info, user],
    [{ ...token, created_at: token.created_at + 61 }, info, user],
    [{ ...token, created_at: token.created_at - 8000 }, info, user],
    [token, { ...info, scope: ["write_repository"] }, user],
    [token, { ...info, scope: ["api", "sudo"] }, user],
    [token, { ...info, application: { uid: "b".repeat(64) } }, user],
    [token, { ...info, expires_in: null }, user],
    [token, info, { ...user, id: 9 }],
    [token, info, { ...user, state: "blocked" }],
  ])(
    "rejects an invalid grant identity, scope or expiry",
    async (...values) => {
      const { adapter, secret } = fixture(values);
      await expect(adapter.exchange(exchange, admission)).rejects.toMatchObject(
        { outcome: "uncertain" },
      );
      expect(secret.every((byte) => byte === 0)).toBe(true);
    },
  );
  it("refreshes only the same provider user", async () => {
    const { adapter, fetch } = fixture();
    const grant = await adapter.refresh(
      { refreshToken: encoder.encode(refreshToken), providerUserId: 8 },
      admission,
    );
    const body = new URLSearchParams(httpText(fetch.mock.calls[0]?.[1]?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe(refreshToken);
    expect(body.has("code")).toBe(false);
    grant.dispose();
    await expect(
      fixture().adapter.refresh(
        { refreshToken: encoder.encode(refreshToken), providerUserId: 9 },
        admission,
      ),
    ).rejects.toMatchObject({ problem: "access-denied" });
  });
  it("does not repeat a refresh after an unknown provider outcome", async () => {
    const { adapter, fetch, secret } = fixture([]);
    fetch.mockRejectedValue(Error("private token response"));
    await expect(
      adapter.refresh(
        { refreshToken: encoder.encode(refreshToken), providerUserId: 8 },
        admission,
      ),
    ).rejects.toMatchObject({ outcome: "uncertain" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(secret.every((byte) => byte === 0)).toBe(true);
  });
  it("does not read credentials when current admission is denied", async () => {
    const { adapter, readClientSecret, fetch } = fixture();
    await expect(
      adapter.exchange(exchange, {
        assertCurrentAdmission: () => Promise.reject(Error()),
      }),
    ).rejects.toMatchObject({ outcome: "not-sent" });
    expect(readClientSecret).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("revokes without returning or logging a token", async () => {
    const { adapter, fetch, secret } = fixture([{}]);
    await adapter.revoke(encoder.encode(accessToken), admission);
    expect(httpText(fetch.mock.calls[0]?.[0])).toBe(
      "https://gitlab.com/oauth/revoke",
    );
    expect(secret.every((byte) => byte === 0)).toBe(true);
  });
  it.each([
    "http://app.example.test/callback",
    "https://name:secret@app.example.test/callback",
    "https://app.example.test/callback?return=other",
    "https://app.example.test/callback#fragment",
  ])("rejects unsafe callback configuration %s", (redirectUri) => {
    expect(
      () =>
        new GitLabOAuthAdapter({
          clientId,
          redirectUri,
          readClientSecret: () => Promise.resolve(new Uint8Array()),
        }),
    ).toThrow();
  });
});
