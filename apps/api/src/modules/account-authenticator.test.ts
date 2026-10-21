import { describe, it, expect, vi } from "vitest";
import { createApp } from "../app.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";
import type { AccountAuthenticatorApplication } from "../application/account-authenticator.js";
const now = "2026-10-01T10:00:00.000Z";
const actor = {
  principalId: "principal_actor",
  sessionId: "family_actor",
  authenticatedAt: now,
  expiresAt: "2026-10-01T11:00:00.000Z",
};
const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const state = {
  contractVersion: 1 as const,
  principalId: actor.principalId,
  enabled: false,
  enrollmentAvailable: true,
  recoveryContact: { kind: "email" as const, value: "help@example.com" },
  enrollment: null,
};
const start = {
  contractVersion: 1 as const,
  attemptId: id,
  acknowledgedRecovery: true as const,
};
const change = {
  contractVersion: 1 as const,
  attemptId: id,
  action: "disable" as const,
  acknowledgedReduction: true as const,
};
const result = {
  contractVersion: 1 as const,
  principalId: actor.principalId,
  attemptId: id,
  outcome: "succeeded" as const,
  problem: null,
  state,
};
const secret = "JBSWY3DPEHPK3PXP";
const headers = {
  authorization: "Bearer actor",
  "x-cloudmarkup-account": actor.principalId,
  origin: "https://beta.example.invalid",
  "content-type": "application/json",
};
const paths = [
  "/v1/account/authenticator-enrollments",
  "/v1/account/authenticator-changes",
] as const;
function fixture(enabled = true) {
  const application = {
    read: vi
      .fn<AccountAuthenticatorApplication["read"]>()
      .mockResolvedValue(state),
    start: vi.fn<AccountAuthenticatorApplication["start"]>().mockResolvedValue({
      ...result,
      action: "start",
      secretCode: secret,
      state: {
        ...state,
        enrollment: {
          id,
          expiresAt: "2026-10-01T10:10:00.000Z",
          status: "ready",
          currentSession: true,
        },
      },
    }),
    change: vi
      .fn<AccountAuthenticatorApplication["change"]>()
      .mockResolvedValue({ ...result, action: "disable" }),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    principalResolver: new FixedPrincipalResolver({ "Bearer actor": actor }),
    ...(enabled
      ? { accountAuthenticator: { application, publicOrigin: headers.origin } }
      : {}),
  });
  return { app, application };
}
function body(path: string) {
  return path === paths[0] ? start : change;
}
describe("account authenticator HTTP boundary", () => {
  it("returns uncached account state and a transient setup key only for the matching start", async () => {
    const f = fixture();
    const read = await f.app.request("/v1/account/authenticator", { headers });
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(await read.text()).not.toContain(secret);
    for (const path of paths) {
      const response = await f.app.request(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body(path)),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      if (path === paths[0]) expect(await response.text()).toContain(secret);
      else expect(await response.text()).not.toContain(secret);
    }
    expect(f.application.start).toHaveBeenCalledWith(
      expect.objectContaining(actor),
      headers.authorization,
      start,
    );
    expect(f.application.change).toHaveBeenCalledWith(
      expect.objectContaining(actor),
      headers.authorization,
      change,
    );
  });
  it.each(paths)(
    "requires authentication, exact origin and current account before body parsing: %s",
    async (path) => {
      const f = fixture();
      for (const [extra, status] of [
        [{ authorization: "" }, 401],
        [{ origin: "https://other.example" }, 403],
        [{ origin: "" }, 403],
        [{ "sec-fetch-site": "cross-site" }, 403],
        [{ "x-cloudmarkup-account": "principal_other" }, 403],
      ] as const) {
        const response = await f.app.request(path, {
          method: "POST",
          headers: { ...headers, ...extra },
          body: "malformed",
        });
        expect(response.status).toBe(status);
      }
      expect(f.application.start).not.toHaveBeenCalled();
      expect(f.application.change).not.toHaveBeenCalled();
    },
  );
  it.each(paths)(
    "rejects authority selectors, missing acknowledgement and query selectors: %s",
    async (path) => {
      const f = fixture();
      for (const value of [
        { ...body(path), principalId: "principal_other" },
        { ...body(path), accessToken: "other" },
        { ...body(path), attemptId: "bad" },
        {
          contractVersion: 1,
          attemptId: id,
          action: body(path) === change ? "disable" : "start",
        },
      ]) {
        expect(
          (
            await f.app.request(path, {
              method: "POST",
              headers,
              body: JSON.stringify(value),
            })
          ).status,
        ).toBe(400);
      }
      expect(
        (
          await f.app.request(path + "?account=other", {
            method: "POST",
            headers,
            body: JSON.stringify(body(path)),
          })
        ).status,
      ).toBe(400);
      expect(f.application.start).not.toHaveBeenCalled();
      expect(f.application.change).not.toHaveBeenCalled();
    },
  );
  it("denies unauthenticated reads, query selectors and absent configuration", async () => {
    const f = fixture();
    expect((await f.app.request("/v1/account/authenticator")).status).toBe(401);
    expect(
      (await f.app.request("/v1/account/authenticator?x=1", { headers }))
        .status,
    ).toBe(400);
    expect(f.application.read).not.toHaveBeenCalled();
    expect(
      (
        await fixture(false).app.request("/v1/account/authenticator", {
          headers,
        })
      ).status,
    ).toBe(503);
  });
  it("withholds state and setup secrets when account or attempt readback differs", async () => {
    const f = fixture();
    f.application.read.mockResolvedValue({
      ...state,
      principalId: "principal_other",
    });
    expect(
      (await f.app.request("/v1/account/authenticator", { headers })).status,
    ).toBe(503);
    const initial = await f.application.start(
      {
        ...actor,
        correlationId: "correlation_test",
        authenticationSource: "cognito",
      },
      headers.authorization,
      start,
    );
    for (const mismatched of [
      { ...initial, principalId: "principal_other" },
      { ...initial, attemptId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
    ]) {
      f.application.start.mockResolvedValue(mismatched);
      const response = await f.app.request(paths[0], {
        method: "POST",
        headers,
        body: JSON.stringify(start),
      });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(secret);
    }
    f.application.change.mockResolvedValue({
      ...result,
      action: "cancel-setup",
    });
    expect(
      (
        await f.app.request(paths[1], {
          method: "POST",
          headers,
          body: JSON.stringify(change),
        })
      ).status,
    ).toBe(503);
  });
});
