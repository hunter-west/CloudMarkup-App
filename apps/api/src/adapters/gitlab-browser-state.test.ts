import { afterEach, describe, expect, it, vi } from "vitest";
import { GitLabBrowserState } from "./gitlab-browser-state.js";
import { GitLabProviderError } from "./gitlab-http.js";
import { deferred } from "./gitlab-test-helpers.js";

const applicationId = "a".repeat(64);
const redirectUri = "https://app.example.test/account/gitlab/callback";
const now = new Date("2026-10-01T12:00:00.000Z");
const input = {
  organizationId: "organization_one",
  principalId: "principal_one",
  sessionId: "session_one",
  intentId: "gitlablink_" + "1".repeat(32),
  connectionId: "gitlab_" + "2".repeat(32),
  state: "s".repeat(43),
  verifier: "v".repeat(43),
  expiresAt: "2026-10-01T12:10:00.000Z",
};
const expected = {
  organizationId: input.organizationId,
  principalId: input.principalId,
  sessionId: input.sessionId,
  intentId: input.intentId,
  state: input.state,
};
const admission = { assertCurrentAdmission: () => Promise.resolve() };
const secretText = "synthetic-browser-oauth-client-secret";
function fixture(
  options: {
    applicationId?: string;
    redirectUri?: string;
    secret?: string;
    clock?: () => Date;
  } = {},
) {
  const secrets: Uint8Array[] = [];
  const readClientSecret = vi.fn(() => {
    const value = new TextEncoder().encode(options.secret ?? secretText);
    secrets.push(value);
    return Promise.resolve(value);
  });
  const browser = new GitLabBrowserState({
    applicationId: options.applicationId ?? applicationId,
    redirectUri: options.redirectUri ?? redirectUri,
    readClientSecret,
    clock: options.clock ?? (() => now),
  });
  return { browser, secrets, readClientSecret };
}
afterEach(() => vi.restoreAllMocks());
describe("GitLab sealed browser state", () => {
  it("round-trips an exact session without exposing state, verifier or raw session in the cookie", async () => {
    const f = fixture();
    const cookie = await f.browser.seal(input, admission);
    expect(cookie.length).toBeLessThan(4096);
    for (const value of [
      input.state,
      input.verifier,
      input.sessionId,
      input.principalId,
      secretText,
    ])
      expect(cookie).not.toContain(value);
    const value = await f.browser.open(cookie, expected, admission);
    expect(value).toMatchObject({
      organizationId: input.organizationId,
      principalId: input.principalId,
      intentId: input.intentId,
      connectionId: input.connectionId,
      verifier: input.verifier,
    });
    expect(value).not.toHaveProperty("sessionId");
    expect(f.secrets).toHaveLength(2);
    expect(
      f.secrets.every((secret) => secret.every((byte) => byte === 0)),
    ).toBe(true);
    expect(await f.browser.seal(input, admission)).not.toBe(cookie);
  });
  it.each([
    "organizationId",
    "principalId",
    "sessionId",
    "intentId",
    "state",
  ] as const)("rejects changed %s binding", async (field) => {
    const f = fixture();
    const cookie = await f.browser.seal(input, admission);
    const changed = {
      ...expected,
      [field]:
        field === "intentId"
          ? "gitlablink_" + "3".repeat(32)
          : field === "state"
            ? "t".repeat(43)
            : "other_identity",
    };
    await expect(
      f.browser.open(cookie, changed, admission),
    ).rejects.toMatchObject({ problem: "access-denied" });
    expect(
      f.secrets.every((secret) => secret.every((byte) => byte === 0)),
    ).toBe(true);
  });
  it.each([1, 2, 3])("rejects tampered cookie component %i", async (index) => {
    const f = fixture();
    const parts = (await f.browser.seal(input, admission)).split(".");
    const component = parts[index] ?? "";
    parts[index] = (component.startsWith("A") ? "B" : "A") + component.slice(1);
    await expect(
      f.browser.open(parts.join("."), expected, admission),
    ).rejects.toMatchObject({ problem: "access-denied" });
  });
  it.each([
    { applicationId: "b".repeat(64) },
    { redirectUri: "https://app.example.test/another/callback" },
    { secret: "synthetic-rotated-client-secret" },
  ])("rejects configuration/key changes %j", async (options) => {
    const original = fixture();
    const cookie = await original.browser.seal(input, admission);
    await expect(
      fixture(options).browser.open(cookie, expected, admission),
    ).rejects.toMatchObject({ problem: "access-denied" });
  });
  it.each([
    "v2.a.b.c",
    "v1.a.b.c",
    "v1.abc=.abc.abc",
    "v1.a.b.c.extra",
    "x".repeat(4097),
    "v1...",
  ])("rejects malformed cookie without secret access", async (cookie) => {
    const f = fixture();
    if (
      cookie === "v2.a.b.c" ||
      cookie === "v1.abc=.abc.abc" ||
      cookie === "v1.a.b.c.extra" ||
      cookie.length === 4097
    ) {
      const control = await f.browser.seal(input, admission);
      await expect(
        f.browser.open(control, expected, admission),
      ).resolves.toMatchObject({
        organizationId: input.organizationId,
        intentId: input.intentId,
        verifier: input.verifier,
      });
      const parts = control.split(".");
      const iv = parts[1],
        ciphertext = parts[2],
        tag = parts[3];
      if (iv === undefined || ciphertext === undefined || tag === undefined)
        throw new Error("Expected all three valid sealed components.");
      expect(Buffer.from(iv, "base64url")).toHaveLength(12);
      expect(Buffer.from(tag, "base64url")).toHaveLength(16);
      expect(Buffer.from(ciphertext, "base64url").length).toBeGreaterThan(0);
      expect(Buffer.from(ciphertext, "base64url").length).toBeLessThanOrEqual(
        3072,
      );
      if (cookie === "v2.a.b.c") {
        cookie = ["v2", iv, ciphertext, tag].join(".");
      } else if (cookie === "v1.abc=.abc.abc") {
        cookie = ["v1", iv + "=", ciphertext, tag].join(".");
        expect(Buffer.from(iv + "=", "base64url")).toHaveLength(12);
      } else if (cookie === "v1.a.b.c.extra") {
        // The extra component is canonical too; only envelope arity changes.
        cookie = control + ".YQ";
      } else {
        const fullCiphertext = Buffer.alloc(3072).toString("base64url");
        cookie = ["v1", iv, fullCiphertext, tag].join(".");
        expect(cookie).toMatch(
          /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
        );
        expect(cookie.length).toBeGreaterThan(4096);
        expect(Buffer.from(fullCiphertext, "base64url")).toHaveLength(3072);
      }
      f.readClientSecret.mockClear();
      expect(() => f.browser.open(cookie, expected, admission)).toThrow(
        GitLabProviderError,
      );
      expect(f.readClientSecret).not.toHaveBeenCalled();
      return;
    }
    expect(() => f.browser.open(cookie, expected, admission)).toThrow();
    expect(f.readClientSecret).not.toHaveBeenCalled();
  });
  it("denies expired cookies and implausible issue times", async () => {
    const f = fixture();
    const cookie = await f.browser.seal(input, admission);
    await expect(
      fixture({
        clock: () => new Date("2026-10-01T12:10:00.000Z"),
      }).browser.open(cookie, expected, admission),
    ).rejects.toMatchObject({ problem: "access-denied" });
    await expect(
      fixture({
        clock: () => new Date("2026-10-01T11:59:00.000Z"),
      }).browser.open(cookie, expected, admission),
    ).rejects.toMatchObject({ problem: "access-denied" });
  });
  it.each([
    "2026-10-01T12:10:00.001Z",
    "2026-10-01T12:00:00.000Z",
    "2026-09-30T12:00:00.000Z",
  ])("denies invalid lifetime %s", (expiresAt) => {
    const f = fixture();
    expect(() => f.browser.seal({ ...input, expiresAt }, admission)).toThrow();
    expect(f.readClientSecret).not.toHaveBeenCalled();
  });
  it("rechecks lifetime after secret retrieval and clears the returned secret", async () => {
    let clock = now;
    const secret = new TextEncoder().encode(secretText);
    const browser = new GitLabBrowserState({
      applicationId,
      redirectUri,
      clock: () => clock,
      readClientSecret: () => {
        clock = new Date("2026-10-01T12:11:00Z");
        return Promise.resolve(secret);
      },
    });
    await expect(browser.seal(input, admission)).rejects.toMatchObject({
      problem: "access-denied",
    });
    expect(secret.every((byte) => byte === 0)).toBe(true);
  });
  it("snapshots inputs before asynchronous admission", async () => {
    const pending = deferred<undefined>();
    const f = fixture();
    const mutable = { ...input };
    const result = f.browser.seal(mutable, {
      assertCurrentAdmission: () => pending.promise,
    });
    mutable.principalId = "principal_changed";
    mutable.verifier = "x".repeat(43);
    pending.resolve(undefined);
    expect(
      await f.browser.open(await result, expected, admission),
    ).toMatchObject({
      principalId: input.principalId,
      verifier: input.verifier,
    });
  });
  it("redacts a rejected secret read", async () => {
    const browser = new GitLabBrowserState({
      applicationId,
      redirectUri,
      clock: () => now,
      readClientSecret: () => Promise.reject(Error(secretText)),
    });
    await expect(browser.seal(input, admission)).rejects.toMatchObject({
      message: "The GitLab operation could not be confirmed.",
      problem: "unavailable",
    });
  });
  it("clears late secret bytes after cancellation", async () => {
    const pending = deferred<Uint8Array>();
    const started = deferred<undefined>();
    const controller = new AbortController();
    const browser = new GitLabBrowserState({
      applicationId,
      redirectUri,
      clock: () => now,
      readClientSecret: () => {
        started.resolve(undefined);
        return pending.promise;
      },
    });
    const result = browser.seal(input, {
      ...admission,
      signal: controller.signal,
    });
    const denied = expect(result).rejects.toMatchObject({
      problem: "unavailable",
    });
    await started.promise;
    controller.abort();
    await denied;
    const secret = new TextEncoder().encode(secretText);
    pending.resolve(secret);
    await Promise.resolve();
    await Promise.resolve();
    expect(secret.every((byte) => byte === 0)).toBe(true);
  });
  it("does not return a cookie after current admission is revoked", async () => {
    const f = fixture();
    let calls = 0;
    await expect(
      f.browser.seal(input, {
        assertCurrentAdmission: () =>
          ++calls === 1 ? Promise.resolve() : Promise.reject(Error("revoked")),
      }),
    ).rejects.toMatchObject({ problem: "access-denied" });
    expect(
      f.secrets.every((secret) => secret.every((byte) => byte === 0)),
    ).toBe(true);
  });
});
