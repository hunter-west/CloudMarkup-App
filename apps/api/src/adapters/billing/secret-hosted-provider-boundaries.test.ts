import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BILLING_CONFIGURATION_VERSION,
  type BillingProvider,
  type CreateHostedCheckoutInput,
} from "../../application/billing.js";
import { createSecretHostedBillingProvider } from "./secret-hosted-provider.js";
import { decodeStripeSandboxApiKey } from "./stripe-sandbox-secret.js";

const reference =
  "arn:aws:secretsmanager:us-east-1:111111111111:secret:cloudmarkup/beta/stripe/api-key-AbCdEf";
const identity = {
  billingAccountId: "billing_boundary",
  organizationId: "org_boundary",
};
const checkoutInput: CreateHostedCheckoutInput = {
  ...identity,
  cancelUrl: "https://beta.example.test/organizations/org_boundary/billing",
  successUrl: "https://beta.example.test/organizations/org_boundary/billing",
  existingProviderCustomerReference: "cus_boundary",
  idempotencyKey: "checkout:boundary-attempt",
  plan: {
    currency: "USD",
    monthlyCreditUnits: 200,
    monthlyPriceMicros: 9_000_000,
    planKey: "starter",
    planVersionId: "planver_starter_2026_08_14_v1",
    priceReference: "price_boundary",
    productReference: "prod_boundary",
  },
};
const lookupInput = {
  ...identity,
  expectedProviderCustomerReference: "cus_boundary",
  expectedPlanKey: "starter" as const,
  providerSessionReference: "cs_test_boundary",
};
const portalInput = {
  ...identity,
  idempotencyKey: "portal:boundary-attempt",
  portalConfigurationReference: "bpc_boundary",
  providerCustomerReference: "cus_boundary",
  returnUrl: "https://beta.example.test/organizations/org_boundary/billing",
};

function invoke(
  provider: BillingProvider,
  method: "checkout" | "lookup" | "portal",
) {
  if (method === "checkout")
    return provider.createCheckoutSession(checkoutInput);
  if (method === "lookup") return provider.getCheckoutSession(lookupInput);
  return provider.createPortalSession(portalInput);
}

function payload(method: "checkout" | "lookup" | "portal") {
  if (method === "portal")
    return { url: "https://billing.stripe.com/p/session/test_boundary" };
  return {
    id: lookupInput.providerSessionReference,
    object: "checkout.session",
    client_reference_id: identity.billingAccountId,
    livemode: false,
    mode: "subscription",
    status: "open",
    subscription: null,
    customer: "cus_boundary",
    expires_at: 1788696000,
    after_expiration: { recovery: { enabled: false } },
    url: "https://checkout.stripe.com/c/pay/test_boundary",
    metadata: {
      cloudmarkup_organization_id: identity.organizationId,
      cloudmarkup_billing_account_id: identity.billingAccountId,
      cloudmarkup_configuration_version: BILLING_CONFIGURATION_VERSION,
      cloudmarkup_plan_key: "starter",
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("hosted secret boundary independent acceptance", () => {
  it.each(["checkout", "lookup", "portal"] as const)(
    "%s waits for current authorization after secret resolution and zeroization",
    async (method) => {
      const order: string[] = [];
      const bytes = new TextEncoder().encode("sk_test_boundary_fixture");
      let release!: () => void;
      const authorized = new Promise<void>((resolve) => {
        release = resolve;
      });
      const authorizeBeforeRequest = vi.fn(() => {
        expect(bytes.every((byte) => byte === 0)).toBe(true);
        order.push("authorization");
        return authorized;
      });
      const send = vi.fn(() => {
        order.push("request");
        return Promise.resolve(Response.json(payload(method)));
      });
      const resolveSecret = vi.fn((requested: string) => {
        expect(requested).toBe(reference);
        order.push("secret");
        return Promise.resolve(bytes);
      });
      const provider = createSecretHostedBillingProvider({
        apiKeyReference: reference,
        secrets: { resolveSecret },
        authorizeBeforeRequest,
        fetchImplementation: send,
      });
      const pending = invoke(provider, method);
      await vi.waitFor(() => {
        expect(authorizeBeforeRequest).toHaveBeenCalledOnce();
      });
      expect(order).toEqual(["secret", "authorization"]);
      expect(send).not.toHaveBeenCalled();
      release();
      await expect(pending).resolves.toMatchObject({
        url: payload(method).url,
      });
      expect(order).toEqual(["secret", "authorization", "request"]);
      expect(resolveSecret).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledOnce();
    },
  );

  it.each(["checkout", "lookup", "portal"] as const)(
    "%s cannot dispatch after the final current-account authorization fails",
    async (method) => {
      const bytes = new TextEncoder().encode("sk_test_boundary_fixture");
      const send = vi.fn(() => Promise.resolve(Response.json(payload(method))));
      const provider = createSecretHostedBillingProvider({
        apiKeyReference: reference,
        secrets: { resolveSecret: () => Promise.resolve(bytes) },
        authorizeBeforeRequest: () =>
          Promise.reject(new Error("revoked customer boundary")),
        fetchImplementation: send,
      });
      await expect(invoke(provider, method)).rejects.toMatchObject({
        code: "provider-unavailable",
        message: "The billing provider is unavailable.",
      });
      expect(send).not.toHaveBeenCalled();
      expect(bytes.every((byte) => byte === 0)).toBe(true);
    },
  );

  it("does not retry an unknown Checkout after the deadline elapsed during secret resolution", async () => {
    const start = Date.parse("2026-09-05T12:00:00.000Z");
    let now = start;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const bytes = new TextEncoder().encode("sk_test_boundary_fixture");
    let release!: (value: Uint8Array) => void;
    const secret = new Promise<Uint8Array>((resolve) => {
      release = resolve;
    });
    const authorizeBeforeRequest = vi.fn(() => Promise.resolve());
    const send = vi.fn(() =>
      Promise.resolve(Response.json(payload("checkout"))),
    );
    const provider = createSecretHostedBillingProvider({
      apiKeyReference: reference,
      secrets: { resolveSecret: () => secret },
      authorizeBeforeRequest,
      fetchImplementation: send,
    });
    const pending = provider.createCheckoutSession({
      ...checkoutInput,
      retryBefore: new Date(start + 1_000).toISOString(),
    });
    now = start + 1_000;
    release(bytes);
    await expect(pending).rejects.toMatchObject({
      code: "provider-unavailable",
    });
    expect(authorizeBeforeRequest).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it("erases malformed UTF-8 and exposes only a safe decoding error", () => {
    const bytes = new Uint8Array([0x73, 0x6b, 0x5f, 0xc3, 0x28]);
    expect(() => decodeStripeSandboxApiKey(bytes)).toThrow(
      "The configured billing secret is unavailable.",
    );
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it("does not expose secret lookup errors or invoke authorization or HTTP", async () => {
    const authorizeBeforeRequest = vi.fn(() => Promise.resolve());
    const send = vi.fn(() => Promise.resolve(Response.json(payload("portal"))));
    const provider = createSecretHostedBillingProvider({
      apiKeyReference: reference,
      secrets: {
        resolveSecret: () =>
          Promise.reject(new Error("sensitive provider diagnostic")),
      },
      authorizeBeforeRequest,
      fetchImplementation: send,
    });
    await expect(
      provider.createPortalSession(portalInput),
    ).rejects.toMatchObject({
      code: "provider-unavailable",
      message: "Billing is temporarily unavailable.",
    });
    expect(authorizeBeforeRequest).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
