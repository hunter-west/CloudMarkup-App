import { describe, expect, it } from "vitest";

import { BILLING_CONFIGURATION_VERSION } from "../../application/billing.js";
import { StripeBillingProvider } from "./stripe-billing-provider.js";

const owner = {
  billingAccountId: "billing_checkout_fixture",
  organizationId: "organization_checkout_fixture",
  providerSessionReference: "cs_test_exact",
};
function fixture(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: owner.providerSessionReference,
    object: "checkout.session",
    client_reference_id: owner.billingAccountId,
    mode: "subscription",
    livemode: false,
    status: "open",
    subscription: null,
    customer: "cus_exact",
    expires_at: 1786795200,
    after_expiration: null,
    url: "https://checkout.stripe.com/c/pay/exact",
    metadata: {
      cloudmarkup_organization_id: owner.organizationId,
      cloudmarkup_billing_account_id: owner.billingAccountId,
      cloudmarkup_configuration_version: BILLING_CONFIGURATION_VERSION,
      cloudmarkup_plan_key: "starter",
    },
    ...overrides,
  };
}
function provider(payload: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    adapter: new StripeBillingProvider({
      apiKey: "sk_test_checkout_fixture",
      webhookSigningSecret: "whsec_checkout_fixture",
      signatureToleranceSeconds: 300,
      fetchImplementation: (url, init = {}) => {
        calls.push({
          url:
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url,
          init,
        });
        return Promise.resolve(Response.json(payload));
      },
    }),
  };
}

describe("Stripe Checkout recovery evidence", () => {
  it("requires the original plan tag for same-request recovery", async () => {
    const { adapter } = provider(
      fixture({
        metadata: { ...fixture().metadata, cloudmarkup_plan_key: "pro" },
      }),
    );
    await expect(
      adapter.getCheckoutSession({ ...owner, expectedPlanKey: "starter" }),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
  });
  it.each(["open", "expired", "complete"] as const)(
    "retrieves exact %s identity without treating it as payment authority",
    async (status) => {
      const { adapter, calls } = provider(
        fixture({
          status,
          subscription: status === "complete" ? "sub_exact" : null,
          url:
            status === "open"
              ? "https://checkout.stripe.com/c/pay/exact"
              : null,
        }),
      );
      const session = await adapter.getCheckoutSession({
        ...owner,
        expectedProviderCustomerReference: "cus_exact",
      });
      expect(session).toMatchObject({
        ...owner,
        status,
        expiresAt: "2026-08-15T12:00:00.000Z",
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(
        "https://api.stripe.com/v1/checkout/sessions/cs_test_exact",
      );
      expect(calls[0]?.init).toMatchObject({
        method: "GET",
        redirect: "error",
      });
      expect(new Headers(calls[0]?.init.headers).has("idempotency-key")).toBe(
        false,
      );
    },
  );

  it.each([
    ["different session", { id: "cs_test_other" }],
    ["live mode", { livemode: true }],
    ["payment mode", { mode: "payment" }],
    ["different account", { client_reference_id: "billing_other" }],
    ["different customer", { customer: "cus_other" }],
    [
      "different organization metadata",
      {
        metadata: {
          ...fixture().metadata,
          cloudmarkup_organization_id: "organization_other",
        },
      },
    ],
    [
      "different account metadata",
      {
        metadata: {
          ...fixture().metadata,
          cloudmarkup_billing_account_id: "billing_other",
        },
      },
    ],
    [
      "unknown configuration",
      {
        metadata: {
          ...fixture().metadata,
          cloudmarkup_configuration_version: "unreviewed",
        },
      },
    ],
    [
      "automatic recovery",
      {
        after_expiration: {
          recovery: {
            enabled: true,
            url: "https://checkout.stripe.com/recover",
          },
        },
      },
    ],
    [
      "expired but subscribed",
      { status: "expired", subscription: "sub_exact" },
    ],
    [
      "complete without subscription",
      { status: "complete", subscription: null },
    ],
    ["open malicious URL", { url: "https://attacker.example/session" }],
    [
      "nonstandard provider port",
      { url: "https://checkout.stripe.com:444/session" },
    ],
    [
      "oversized hosted URL",
      { url: "https://checkout.stripe.com/" + "a".repeat(8192) },
    ],
    ["invalid expiry", { expires_at: -1 }],
  ])("rejects %s", async (_label, overrides) => {
    const { adapter } = provider(fixture(overrides));
    await expect(
      adapter.getCheckoutSession({
        ...owner,
        expectedProviderCustomerReference: "cus_exact",
      }),
    ).rejects.toThrow();
  });

  it("does not request malformed session paths or allow queue-only session reads", async () => {
    const { adapter, calls } = provider(fixture());
    await expect(
      adapter.getCheckoutSession({
        ...owner,
        providerSessionReference: "../customers",
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
    const queue = new StripeBillingProvider({
      apiKey: "sk_test_checkout_fixture",
      signatureToleranceSeconds: 300,
      verificationMode: "queued-events-only",
      fetchImplementation: () => {
        throw new Error("No provider access expected");
      },
    });
    await expect(queue.getCheckoutSession(owner)).rejects.toMatchObject({
      code: "billing-disabled",
    });
  });
});
