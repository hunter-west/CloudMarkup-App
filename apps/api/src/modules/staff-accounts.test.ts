import { describe, it, expect, vi } from "vitest";
import { createApp } from "../app.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";
import { ApplicationError } from "../application/errors.js";
import type { StaffAccountsApplication } from "../application/staff-accounts.js";
const now = "2026-10-01T00:00:00.000Z",
  actor = {
    principalId: "principal_staff",
    sessionId: "family_staff",
    authenticatedAt: now,
    expiresAt: "2026-10-01T01:00:00.000Z",
  };
const input = {
  contractVersion: 1,
  action: "grant-credits",
  creditUnits: 100,
  expiresInDays: 30,
  reason: "Synthetic testing grant",
  confirmBillingAccountId: "billing_target",
};
const headers = {
  authorization: "Bearer actor",
  origin: "https://beta.example.invalid",
  "content-type": "application/json",
  "if-match": '"staff-account:billing_target:1"',
  "idempotency-key": "staff-grant-001",
};
function fixture(configured = true) {
  const port = {
    access: vi
      .fn<StaffAccountsApplication["access"]>()
      .mockResolvedValue({ contractVersion: 1, permissions: [] }),
    search: vi
      .fn<StaffAccountsApplication["search"]>()
      .mockResolvedValue({ contractVersion: 1, items: [] }),
    get: vi.fn<StaffAccountsApplication["get"]>(),
    act: vi.fn<StaffAccountsApplication["act"]>().mockResolvedValue({
      contractVersion: 1,
      actionId: "staff_receipt",
      actorPrincipalId: actor.principalId,
      organizationId: "org_target",
      billingAccountId: "billing_target",
      action: "grant-credits",
      creditUnits: "100",
      creditGrantId: "grant_staff",
      expensiveOperationsEnabled: null,
      reason: input.reason,
      occurredAt: now,
      accountVersion: 2,
    }),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    principalResolver: new FixedPrincipalResolver({ "Bearer actor": actor }),
    ...(configured
      ? { staffAccounts: { application: port, publicOrigin: headers.origin } }
      : {}),
  });
  return { app, port };
}
const endpoint = "/v1/staff/accounts/org_target/actions";
describe("platform staff HTTP boundary", () => {
  it("binds commands to the verified actor, exact target, precondition and stable retry key", async () => {
    const f = fixture();
    const r = await f.app.request(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(f.port.act).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: actor.principalId }),
      "org_target",
      input,
      headers["if-match"],
      headers["idempotency-key"],
    );
  });
  it.each([
    { origin: "https://attacker.example" },
    { origin: "" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ])("rejects cross-origin writes %j", async (changed) => {
    const f = fixture();
    expect(
      (
        await f.app.request(endpoint, {
          method: "POST",
          headers: { ...headers, ...changed },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    expect(f.port.act).not.toHaveBeenCalled();
  });
  it.each([{ "if-match": "" }, { "idempotency-key": "" }])(
    "requires mutation preconditions %j",
    async (changed) => {
      const f = fixture();
      const r = await f.app.request(endpoint, {
        method: "POST",
        headers: { ...headers, ...changed },
        body: JSON.stringify(input),
      });
      expect([400, 428]).toContain(r.status);
      expect(f.port.act).not.toHaveBeenCalled();
    },
  );
  it.each([
    { principalId: "principal_other" },
    { permissions: ["credits.grant"] },
    { role: "administrator" },
    { creditUnits: 100001 },
    { expiresInDays: 366 },
  ])("rejects forged authority and invalid bounds %j", async (changed) => {
    const f = fixture();
    expect(
      (
        await f.app.request(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...input, ...changed }),
        })
      ).status,
    ).toBe(400);
    expect(f.port.act).not.toHaveBeenCalled();
  });
  it("requires authentication and preserves service denial without leaking accounts", async () => {
    const f = fixture();
    expect(
      (
        await f.app.request(endpoint, {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(401);
    f.port.act.mockRejectedValue(
      new ApplicationError(
        "access_denied",
        "Platform staff access is required.",
      ),
    );
    expect(
      (
        await f.app.request(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
  });
  it("returns the active-plan restriction with its conflict status and correlation", async () => {
    const f = fixture();
    const message =
      "An active plan is required before granting complimentary credits.";
    f.port.act.mockRejectedValue(new ApplicationError("conflict", message));
    const response = await f.app.request(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      apiVersion: "v1",
      error: {
        code: "conflict",
        message,
        correlationId: expect.any(String) as unknown,
      },
    });
  });
  it.each([
    "/v1/staff/access?role=admin",
    "/v1/staff/accounts?q=one&q=two",
    "/v1/staff/accounts?q=name&principalId=other",
  ])("rejects selectors outside the public contract %s", async (path) => {
    const f = fixture();
    expect((await f.app.request(path, { headers })).status).toBe(400);
    expect(f.port.search).not.toHaveBeenCalled();
  });
  it("has no public staff enrollment operation and fails closed without composition", async () => {
    const f = fixture(false);
    expect((await f.app.request("/v1/staff/access", { headers })).status).toBe(
      503,
    );
    expect(
      (
        await f.app.request("/v1/staff/authorizations", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(404);
  });
});
