import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";
import type { AccountSessionsApplication } from "../application/account-sessions.js";
const now = "2026-10-01T00:00:00.000Z",
  actor = {
    principalId: "principal_actor",
    sessionId: "family_actor",
    authenticatedAt: now,
    expiresAt: "2026-10-01T01:00:00.000Z",
  };
const session = {
  contractVersion: 1 as const,
  principalId: actor.principalId,
  id: "browser_" + "a".repeat(64),
  authenticatedAt: now,
  expiresAt: "2026-10-01T08:00:00.000Z",
  current: false,
};
const input = { contractVersion: 1, action: "revoke", sessionId: session.id };
const receipt = {
  contractVersion: 1 as const,
  principalId: actor.principalId,
  action: "revoke" as const,
  sessionId: session.id,
  authenticatedThrough: null,
  occurredAt: now,
};
const headers = {
  authorization: "Bearer actor",
  origin: "https://beta.example.invalid",
  "content-type": "application/json",
  "idempotency-key": "session-change-001",
};
function fixture(configured = true) {
  const port = {
    list: vi
      .fn<AccountSessionsApplication["list"]>()
      .mockResolvedValue({ items: [session] }),
    change: vi
      .fn<AccountSessionsApplication["change"]>()
      .mockResolvedValue(receipt),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    principalResolver: new FixedPrincipalResolver({ "Bearer actor": actor }),
    ...(configured
      ? { accountSessions: { application: port, publicOrigin: headers.origin } }
      : {}),
  });
  return { app, port };
}
describe("account session HTTP transport", () => {
  it("lists no-store actor-owned metadata and forwards exact validated commands", async () => {
    const f = fixture(),
      read = await f.app.request("/v1/account/sessions", { headers });
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(f.port.list).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: actor.principalId }),
      expect.objectContaining({ limit: 25 }),
    );
    const write = await f.app.request("/v1/account/session-changes", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(write.status).toBe(200);
    expect(write.headers.get("cache-control")).toBe("no-store");
    expect(f.port.change).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: actor.principalId }),
      input,
      headers["idempotency-key"],
    );
  });
  it.each([
    { origin: "https://other.example" },
    { origin: "" },
    { "sec-fetch-site": "cross-site" },
  ])("denies cross-origin mutation %j", async (changed) => {
    const f = fixture(),
      r = await f.app.request("/v1/account/session-changes", {
        method: "POST",
        headers: { ...headers, ...changed },
        body: JSON.stringify(input),
      });
    expect(r.status).toBe(403);
    expect(f.port.change).not.toHaveBeenCalled();
  });
  it.each([
    "/v1/account/sessions?principalId=principal_other",
    "/v1/account/sessions?page[limit]=1&page[limit]=2",
    "/v1/account/session-changes?actor=other",
  ])("rejects unrecognized or duplicate selectors %s", async (path) => {
    const f = fixture(),
      write = path.includes("session-changes");
    const r = await f.app.request(path, {
      method: write ? "POST" : "GET",
      headers,
      ...(write ? { body: JSON.stringify(input) } : {}),
    });
    expect(r.status).toBe(400);
    expect(f.port.change).not.toHaveBeenCalled();
    expect(f.port.list).not.toHaveBeenCalled();
  });
  it("requires authentication and denies caller-selected ownership", async () => {
    const f = fixture();
    expect((await f.app.request("/v1/account/sessions")).status).toBe(401);
    expect(
      (
        await f.app.request("/v1/account/session-changes", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...input, principalId: "principal_other" }),
        })
      ).status,
    ).toBe(400);
    expect(f.port.change).not.toHaveBeenCalled();
  });
  it("fails closed without production configuration", async () => {
    const f = fixture(false);
    expect(
      (await f.app.request("/v1/account/sessions", { headers })).status,
    ).toBe(503);
  });
});
