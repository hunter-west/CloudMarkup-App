import { describe, it, expect, vi } from "vitest";
import { createApp } from "../app.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";
import type { AccountCredentialsApplication } from "../application/account-credentials.js";
const now = "2026-10-01T10:00:00.000Z";
const actor = {
  principalId: "principal_actor",
  sessionId: "family_actor",
  authenticatedAt: now,
  expiresAt: "2026-10-01T11:00:00.000Z",
};
const state = {
  contractVersion: 1 as const,
  principalId: actor.principalId,
  email: "actor@example.com",
  emailVerified: true,
  authenticatorEnabled: false,
};
const input = {
  contractVersion: 1 as const,
  attemptId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  action: "email-start" as const,
  email: "new@example.com",
};
const result = {
  contractVersion: 1 as const,
  principalId: actor.principalId,
  attemptId: input.attemptId,
  action: input.action,
  outcome: "succeeded" as const,
  problem: null,
  state,
};
const headers = {
  authorization: "Bearer actor",
  "x-cloudmarkup-account": actor.principalId,
  origin: "https://beta.example.invalid",
  "content-type": "application/json",
};
function fixture(enabled = true) {
  const application = {
    read: vi
      .fn<AccountCredentialsApplication["read"]>()
      .mockResolvedValue(state),
    change: vi
      .fn<AccountCredentialsApplication["change"]>()
      .mockResolvedValue(result),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    principalResolver: new FixedPrincipalResolver({ "Bearer actor": actor }),
    ...(enabled
      ? { accountCredentials: { application, publicOrigin: headers.origin } }
      : {}),
  });
  return { app, application };
}
describe("account credential HTTP boundary", () => {
  it("binds the exact verified transport header and returns no-store data", async () => {
    const f = fixture();
    const read = await f.app.request("/v1/account/credentials", { headers });
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store");
    const write = await f.app.request("/v1/account/credential-changes", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(write.status).toBe(200);
    expect(write.headers.get("cache-control")).toBe("no-store");
    expect(f.application.change).toHaveBeenCalledWith(
      expect.objectContaining(actor),
      headers.authorization,
      input,
    );
  });
  it.each([
    { origin: "https://other.example" },
    { origin: "" },
    { "sec-fetch-site": "cross-site" },
  ])("denies cross-origin writes %j", async (changed) => {
    const f = fixture();
    expect(
      (
        await f.app.request("/v1/account/credential-changes", {
          method: "POST",
          headers: { ...headers, ...changed },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    expect(f.application.change).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, principalId: "principal_other" },
    { ...input, accessToken: "other-token" },
    { ...input, action: "admin-reset" },
    { ...input, email: "invalid" },
  ])("rejects caller-selected authority and malformed input", async (body) => {
    const f = fixture();
    expect(
      (
        await f.app.request("/v1/account/credential-changes", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(400);
    expect(f.application.change).not.toHaveBeenCalled();
  });
  it("denies a stale account fence before using credential input", async () => {
    const f = fixture();
    expect(
      (
        await f.app.request("/v1/account/credential-changes", {
          method: "POST",
          headers: { ...headers, "x-cloudmarkup-account": "principal_other" },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    expect(f.application.change).not.toHaveBeenCalled();
  });
  it("requires authentication and rejects selectors on both endpoints", async () => {
    const f = fixture();
    expect((await f.app.request("/v1/account/credentials")).status).toBe(401);
    expect(
      (
        await f.app.request("/v1/account/credentials?principalId=other", {
          headers,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.app.request("/v1/account/credential-changes?x=1", {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(400);
    expect(f.application.read).not.toHaveBeenCalled();
    expect(f.application.change).not.toHaveBeenCalled();
  });
  it("fails closed when disabled or provider readback belongs to a different actor", async () => {
    const f = fixture(false);
    expect(
      (await f.app.request("/v1/account/credentials", { headers })).status,
    ).toBe(503);
    const other = fixture();
    other.application.read.mockResolvedValue({
      ...state,
      principalId: "principal_other",
    });
    const response = await other.app.request("/v1/account/credentials", {
      headers,
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("actor@example.com");
  });
  it("rejects an outcome from a different attempt", async () => {
    const f = fixture();
    f.application.change.mockResolvedValue({
      ...result,
      attemptId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    expect(
      (
        await f.app.request("/v1/account/credential-changes", {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(503);
  });
});
