import { describe, expect, it, vi } from "vitest";
import {
  BILLING_CREDIT_PLAN_MAPPING_VERSION,
  BILLING_WEBHOOK_ENDPOINT_VERSION,
  parseBillingWebhookDelivery,
} from "../../application/billing.js";
import {
  parseStripeBillingWebhookDelivery,
  STRIPE_API_VERSION,
  StripeBillingProvider,
} from "./stripe-billing-provider.js";
import { decodeStripeApiKey } from "./stripe-sandbox-secret.js";
import { readProductionBillingSessions } from "../../production-billing-environment.js";
import { REVIEWED_LIVE_STRIPE } from "./reviewed-live-plans.js";
const source = {
  id: "evt_live_fixture",
  object: "event",
  created: 1790856000,
  livemode: true,
  api_version: STRIPE_API_VERSION,
  type: "customer.subscription.updated",
  data: { object: { id: "sub_live_fixture" } },
};
function delivery(live = true) {
  return parseStripeBillingWebhookDelivery({
    stripeEnvironment: live ? "live" : "test",
    rawBody: Buffer.from(JSON.stringify({ ...source, livemode: live })),
    planMappingVersion: BILLING_CREDIT_PLAN_MAPPING_VERSION,
    signatureSecretVersion: "current",
    webhookEndpointVersion: BILLING_WEBHOOK_ENDPOINT_VERSION,
  });
}
describe("live billing admission", () => {
  it.each(["sk", "rk"])(
    "decodes a %s live key only in live mode and erases source bytes",
    (prefix) => {
      const bytes = new TextEncoder().encode(
        JSON.stringify({ key: prefix + "_live_synthetic_fixture" }),
      );
      expect(decodeStripeApiKey(bytes, "live")).toBe(
        prefix + "_live_synthetic_fixture",
      );
      expect(bytes.every((b) => b === 0)).toBe(true);
      const wrong = new TextEncoder().encode(
        prefix + "_test_synthetic_fixture",
      );
      expect(() => decodeStripeApiKey(wrong, "live")).toThrow(
        "The configured billing secret is unavailable.",
      );
      expect(wrong.every((b) => b === 0)).toBe(true);
    },
  );
  it("requires a V2 live envelope and rejects test deliveries before provider access", async () => {
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(Response.json(source)),
    );
    const provider = new StripeBillingProvider({
      apiKey: "sk_live_synthetic_fixture",
      stripeEnvironment: "live",
      signatureToleranceSeconds: 300,
      verificationMode: "queued-events-only",
      fetchImplementation,
    });
    const live = delivery();
    if (!live) throw Error("fixture");
    expect(live).toMatchObject({
      contractVersion: 2,
      stripeEnvironment: "live",
    });
    await expect(provider.retrieveQueuedWebhook(live)).resolves.toMatchObject({
      providerEventReference: source.id,
    });
    fetchImplementation.mockClear();
    const test = delivery(false);
    if (!test) throw Error("fixture");
    await expect(provider.retrieveQueuedWebhook(test)).rejects.toMatchObject({
      code: "invalid-provider-event",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(() =>
      parseBillingWebhookDelivery({ ...live, stripeEnvironment: "other" }),
    ).toThrow();
    expect(() =>
      parseBillingWebhookDelivery({ ...live, extra: true }),
    ).toThrow();
  });
  it("binds production sessions to exact live secrets, portal and reviewed prices", () => {
    const env = {
      CLOUDMARKUP_ENVIRONMENT: "beta",
      CLOUDMARKUP_BILLING_ENABLED: "true",
      CLOUDMARKUP_BILLING_SESSIONS_ENABLED: "true",
      CLOUDMARKUP_STRIPE_ENVIRONMENT: "live",
      CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN: REVIEWED_LIVE_STRIPE.apiKeyArn,
      CLOUDMARKUP_STRIPE_PORTAL_CONFIGURATION_REFERENCE:
        REVIEWED_LIVE_STRIPE.portalConfigurationReference,
      CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION:
        BILLING_CREDIT_PLAN_MAPPING_VERSION,
    };
    const runtime = readProductionBillingSessions(env);
    expect(runtime?.configuration).toMatchObject({
      mode: "stripe-live",
      stripeEnvironment: "live",
      plans: {
        starter: { ...REVIEWED_LIVE_STRIPE.starter, monthlyCreditUnits: 200 },
        pro: { ...REVIEWED_LIVE_STRIPE.pro, monthlyCreditUnits: 1250 },
      },
    });
    expect(() =>
      readProductionBillingSessions({
        ...env,
        CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN:
          REVIEWED_LIVE_STRIPE.apiKeyArn + "x",
      }),
    ).toThrow();
    expect(() =>
      readProductionBillingSessions({
        ...env,
        CLOUDMARKUP_STRIPE_PORTAL_CONFIGURATION_REFERENCE: "bpc_other",
      }),
    ).toThrow();
  });
});

// Fresh live provider state, including nested price evidence, governs fulfillment.
it.each([
  {},
  { livemode: false },
  { unit_amount: 900 },
  { currency: "eur" },
  { id: "price_unreviewed" },
  { product: "prod_unreviewed" },
  {
    recurring: { interval: "year", interval_count: 1, usage_type: "licensed" },
  },
])(
  "requires the exact live Professional subscription price %j",
  async (patch) => {
    const price = {
      id: REVIEWED_LIVE_STRIPE.pro.priceReference,
      product: REVIEWED_LIVE_STRIPE.pro.productReference,
      object: "price",
      livemode: true,
      currency: "usd",
      unit_amount: 3900,
      type: "recurring",
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "licensed",
      },
      ...patch,
    };
    const subscription = {
      id: "sub_live_fixture",
      object: "subscription",
      livemode: true,
      customer: "cus_live_fixture",
      status: "active",
      trial_end: null,
      cancel_at_period_end: false,
      metadata: {
        cloudmarkup_organization_id: "org_live_fixture",
        cloudmarkup_billing_account_id: "billing_live_fixture",
      },
      items: {
        data: [
          {
            quantity: 1,
            price,
            current_period_start: 1790856000,
            current_period_end: 1793448000,
          },
        ],
      },
    };
    const provider = new StripeBillingProvider({
      apiKey: "sk_live_synthetic_fixture",
      stripeEnvironment: "live",
      verificationMode: "queued-events-only",
      signatureToleranceSeconds: 300,
      fetchImplementation: () => Promise.resolve(Response.json(subscription)),
    });
    const result = await provider.resolveSubscriptionSnapshot({
      providerEventReference: "evt_live_fixture",
      eventType: "customer.subscription.updated",
      eventPosition: "00000000001790856000:evt_live_fixture",
      occurredAt: "2026-10-01T09:20:00.000Z",
      payloadSha256: "a".repeat(64),
      supported: true,
      providerEventData: subscription,
    });
    if (Object.keys(patch).length === 0)
      expect(result).toMatchObject({
        priceReference: REVIEWED_LIVE_STRIPE.pro.priceReference,
        normalizedStatus: "active",
      });
    else expect(result).toBeNull();
  },
);
