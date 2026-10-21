import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import type { BillingWorkspaceApplication } from "../application/billing-workspace.js";
import { ApplicationError } from "../application/errors.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";

const now = "2026-09-05T12:00:00.000Z";
const origin = "https://beta.example.test";
const base = "/v1/organizations/org_test/billing";

function fixture(enabled = true) {
  const checkout = vi
    .fn<BillingWorkspaceApplication["createCheckout"]>()
    .mockResolvedValue({
      contractVersion: 1,
      organizationId: "org_test",
      kind: "checkout",
      url: "https://checkout.stripe.com/c/pay/cs_test_example",
    });
  const portal = vi
    .fn<BillingWorkspaceApplication["createPortal"]>()
    .mockResolvedValue({
      contractVersion: 1,
      organizationId: "org_test",
      kind: "portal",
      url: "https://billing.stripe.com/p/session/test_example",
    });
  const workspace = vi
    .fn<BillingWorkspaceApplication["getWorkspace"]>()
    .mockResolvedValue({
      contractVersion: 1,
      organizationId: "org_test",
      asOf: now,
      mode: "disabled",
      accountState: "unprovisioned",
      subscriptionState: "not-subscribed",
      currentPlanKey: null,
      canCheckout: false,
      canManage: false,
      plans: [
        {
          key: "starter",
          displayName: "Starter",
          currency: "USD",
          monthlyPriceMicros: "9000000",
          monthlyCreditUnits: 200,
        },
        {
          key: "pro",
          displayName: "Professional",
          currency: "USD",
          monthlyPriceMicros: "39000000",
          monthlyCreditUnits: 1000,
        },
      ],
    });
  const topup = vi
    .fn<NonNullable<BillingWorkspaceApplication["createCreditTopUp"]>>()
    .mockResolvedValue({
      contractVersion: 1,
      organizationId: "org_test",
      kind: "checkout",
      url: "https://checkout.stripe.com/c/pay/cs_test_topup",
    });
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    principalResolver: new FixedPrincipalResolver({
      "Bearer owner": {
        authenticatedAt: now,
        expiresAt: "2026-09-05T13:00:00.000Z",
        principalId: "principal_test",
        sessionId: "session_test",
      },
    }),
    ...(enabled
      ? {
          billingWorkspace: {
            publicOrigin: origin,
            application: {
              getWorkspace: workspace,
              createCheckout: checkout,
              createPortal: portal,
              createCreditTopUp: topup,
            },
          },
        }
      : {}),
  });
  const headers = {
    authorization: "Bearer owner",
    origin,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
    "idempotency-key": "billing-test-attempt",
  };
  return { app, checkout, portal, workspace, topup, headers };
}

describe("authenticated sandbox billing routes", () => {
  it("returns a no-store verified workspace without starting payment", async () => {
    const f = fixture();
    const response = await f.app.request(base, { headers: f.headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(f.checkout).not.toHaveBeenCalled();
    expect(f.portal).not.toHaveBeenCalled();
  });
  it("passes only the validated plan and stable idempotency key", async () => {
    const f = fixture();
    const response = await f.app.request(base + "/checkout-sessions", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ contractVersion: 1, planKey: "pro" }),
    });
    expect(response.status).toBe(201);
    expect(f.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: "principal_test" }),
      "org_test",
      { contractVersion: 1, planKey: "pro" },
      "billing-test-attempt",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("creates only a server-owned Portal session", async () => {
    const f = fixture();
    const response = await f.app.request(base + "/portal-sessions", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ contractVersion: 1 }),
    });
    expect(response.status).toBe(201);
    expect(f.portal).toHaveBeenCalledOnce();
  });
  it.each(["/checkout-sessions", "/portal-sessions"])(
    "requires authentication for %s",
    async (path) => {
      const f = fixture();
      const response = await f.app.request(base + path, {
        method: "POST",
        body: "{}",
      });
      expect(response.status).toBe(401);
      expect(f.checkout).not.toHaveBeenCalled();
      expect(f.portal).not.toHaveBeenCalled();
    },
  );
  it.each([
    { origin: "https://other.example.test" },
    { origin: "null" },
    { origin: "" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ])("rejects browser-origin mismatch before any action %j", async (change) => {
    const f = fixture();
    const response = await f.app.request(base + "/checkout-sessions", {
      method: "POST",
      headers: { ...f.headers, ...change },
      body: JSON.stringify({ contractVersion: 1, planKey: "starter" }),
    });
    expect(response.status).toBe(403);
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it.each([
    { planKey: "arbitrary" },
    { organizationId: "org_other" },
    { successUrl: "https://evil.test" },
    { customer: "cus_other" },
    { price: "price_other" },
  ])("rejects extra or invalid authority %j", async (change) => {
    const f = fixture();
    const response = await f.app.request(base + "/checkout-sessions", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        contractVersion: 1,
        planKey: "starter",
        ...change,
      }),
    });
    expect(response.status).toBe(400);
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it("requires idempotency and keeps a disabled service unavailable", async () => {
    const f = fixture();
    const headers = { ...f.headers };
    delete (headers as Partial<typeof headers>)["idempotency-key"];
    expect(
      (
        await f.app.request(base + "/checkout-sessions", {
          method: "POST",
          headers,
          body: JSON.stringify({ contractVersion: 1, planKey: "starter" }),
        })
      ).status,
    ).toBe(400);
    const disabled = fixture(false);
    expect(
      (await disabled.app.request(base, { headers: disabled.headers })).status,
    ).toBe(503);
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it("preserves indistinguishable tenant denial", async () => {
    const f = fixture();
    f.workspace.mockRejectedValue(
      new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      ),
    );
    expect((await f.app.request(base, { headers: f.headers })).status).toBe(
      404,
    );
  });
  it("accepts only the selected credit pack and binds the authenticated actor", async () => {
    const f = fixture();
    const response = await f.app.request(
      base + "/credit-top-ups/checkout-sessions",
      {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({ contractVersion: 1, packKey: "medium" }),
      },
    );
    expect(response.status).toBe(201);
    expect(f.topup).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: "principal_test" }),
      "org_test",
      { contractVersion: 1, packKey: "medium" },
      "billing-test-attempt",
    );
  });
  it.each([
    { creditUnits: 99999 },
    { priceMicros: 1 },
    { customer: "cus_foreign" },
    { organizationId: "org_foreign" },
    { successUrl: "https://evil.test" },
    { packKey: "arbitrary" },
  ])("denies browser-supplied purchase authority %j", async (extra) => {
    const f = fixture();
    const response = await f.app.request(
      base + "/credit-top-ups/checkout-sessions",
      {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({
          contractVersion: 1,
          packKey: "small",
          ...extra,
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(f.topup).not.toHaveBeenCalled();
  });
  it("requires same-origin authenticated top-up creation", async () => {
    const f = fixture();
    for (const headers of [
      { ...f.headers, origin: "https://evil.test" },
      { ...f.headers, authorization: "" },
    ]) {
      const response = await f.app.request(
        base + "/credit-top-ups/checkout-sessions",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ contractVersion: 1, packKey: "small" }),
        },
      );
      expect([401, 403]).toContain(response.status);
    }
    expect(f.topup).not.toHaveBeenCalled();
  });
});
