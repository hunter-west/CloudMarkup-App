import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BILLING_CONFIGURATION_VERSION,
  createBillingConfiguration,
  type VerifiedBillingWebhookEvent,
} from "../../application/billing.js";
import {
  STRIPE_PRO_PRICE_REFERENCE,
  STRIPE_PRO_PRODUCT_REFERENCE,
  STRIPE_STARTER_PRICE_REFERENCE,
  STRIPE_STARTER_PRODUCT_REFERENCE,
} from "./environment.js";
import {
  STRIPE_API_VERSION,
  StripeBillingProvider,
} from "./stripe-billing-provider.js";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const API_KEY = "sk_test_cloudmarkup_fixture";
const WEBHOOK_SECRET = "whsec_cloudmarkup_fixture";

function checkoutFixture(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "cs_test_fixture",
    object: "checkout.session",
    livemode: false,
    mode: "subscription",
    status: "open",
    subscription: null,
    customer: null,
    expires_at: 1786795200,
    client_reference_id: "billing_account_fixture",
    after_expiration: null,
    url: "https://checkout.stripe.com/c/pay/fixture",
    metadata: {
      cloudmarkup_billing_account_id: "billing_account_fixture",
      cloudmarkup_organization_id: "organization_fixture",
      cloudmarkup_configuration_version: BILLING_CONFIGURATION_VERSION,
      cloudmarkup_plan_key: "starter",
    },
    ...overrides,
  };
}

function configuration() {
  return createBillingConfiguration({
    cancelUrl: "http://localhost:4173/settings/billing?checkout=canceled",
    mode: "stripe-sandbox",
    portalConfigurationReference: "bpc_cloudmarkup_reviewed",
    portalReturnUrl: "http://localhost:4173/settings/billing",
    proPriceReference: STRIPE_PRO_PRICE_REFERENCE,
    proProductReference: STRIPE_PRO_PRODUCT_REFERENCE,
    starterPriceReference: STRIPE_STARTER_PRICE_REFERENCE,
    starterProductReference: STRIPE_STARTER_PRODUCT_REFERENCE,
    successUrl: "http://localhost:4173/settings/billing?checkout=success",
  });
}

function stripeSubscription(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    cancel_at_period_end: false,
    customer: "cus_fixture_primary",
    id: "sub_fixture_primary",
    object: "subscription",
    livemode: false,
    latest_invoice: "in_fixture_primary",
    items: {
      has_more: false,
      data: [
        {
          id: "si_fixture_primary",
          current_period_end: 1_789_264_800,
          current_period_start: 1_786_672_800,
          price: {
            currency: "usd",
            id: STRIPE_STARTER_PRICE_REFERENCE,
            product: STRIPE_STARTER_PRODUCT_REFERENCE,
            recurring: {
              interval: "month",
              interval_count: 1,
            },
          },
          quantity: 1,
        },
      ],
    },
    metadata: {
      cloudmarkup_billing_account_id: "billing_account_fixture",
      cloudmarkup_organization_id: "organization_fixture",
    },
    status: "active",
    trial_end: null,
    ...overrides,
  };
}

function signedEvent(
  event: Readonly<Record<string, unknown>>,
  timestamp = Math.floor(NOW.getTime() / 1000),
  webhookSecret = WEBHOOK_SECRET,
): {
  readonly rawBody: Uint8Array;
  readonly signatureHeader: string;
} {
  const rawBody = new TextEncoder().encode(JSON.stringify(event));
  const signature = createHmac("sha256", webhookSecret)
    .update(Buffer.from(timestamp.toString() + ".", "utf8"))
    .update(rawBody)
    .digest("hex");
  return {
    rawBody,
    signatureHeader: "t=" + timestamp.toString() + ",v1=" + signature,
  };
}

function verified(
  eventType: string,
  providerEventData: unknown,
): VerifiedBillingWebhookEvent {
  return {
    eventPosition: "00000000001786628400:evt_fixture_manual",
    eventType,
    occurredAt: "2026-08-14T12:00:00.000Z",
    payloadSha256: "a".repeat(64),
    providerEventData,
    providerEventReference: "evt_fixture_manual",
    supported: true,
  };
}

function formBody(
  call: { readonly init: RequestInit; readonly url: string } | undefined,
): URLSearchParams {
  const body = call?.init.body;
  if (!(body instanceof URLSearchParams)) {
    throw new TypeError("Expected a URL-encoded Stripe request body.");
  }
  return body;
}
describe("Stripe billing sandbox adapter", () => {
  it("creates hosted Checkout and Portal sessions with reviewed server values", async () => {
    const calls: { readonly init: RequestInit; readonly url: string }[] = [];
    const provider = new StripeBillingProvider({
      apiKey: API_KEY,
      fetchImplementation: (request, init = {}) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.toString()
              : request.url;
        calls.push({ init, url });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...(url.endsWith("/v1/checkout/sessions")
                ? checkoutFixture({
                    metadata: {
                      ...checkoutFixture().metadata,
                      cloudmarkup_plan_key: (init.body as URLSearchParams).get(
                        "metadata[cloudmarkup_plan_key]",
                      ),
                    },
                  })
                : {}),
              url: url.endsWith("/v1/checkout/sessions")
                ? "https://checkout.stripe.com/c/pay/fixture"
                : "https://billing.stripe.com/p/session/fixture",
            }),
            {
              headers: { "content-type": "application/json" },
              status: 200,
            },
          ),
        );
      },
      signatureToleranceSeconds: 300,
      webhookSigningSecret: WEBHOOK_SECRET,
    });
    const config = configuration();

    await provider.createCheckoutSession({
      billingAccountId: "billing_account_fixture",
      cancelUrl: config.cancelUrl,
      idempotencyKey: "checkout:organization_fixture:request_0001",
      organizationId: "organization_fixture",
      plan: config.plans.starter,
      successUrl: config.successUrl,
    });
    await provider.createCheckoutSession({
      billingAccountId: "billing_account_fixture",
      cancelUrl: config.cancelUrl,
      idempotencyKey: "checkout:organization_fixture:request_0002",
      organizationId: "organization_fixture",
      plan: config.plans.pro,
      successUrl: config.successUrl,
    });
    await provider.createPortalSession({
      billingAccountId: "billing_account_fixture",
      idempotencyKey: "portal:organization_fixture:request_0001",
      organizationId: "organization_fixture",
      portalConfigurationReference: "bpc_cloudmarkup_reviewed",
      providerCustomerReference: "cus_fixture_primary",
      returnUrl: config.portalReturnUrl,
    });

    const starterBody = formBody(calls[0]);
    const proBody = formBody(calls[1]);
    const portalBody = formBody(calls[2]);
    expect(starterBody.get("line_items[0][price]")).toBe(
      STRIPE_STARTER_PRICE_REFERENCE,
    );
    expect(proBody.get("line_items[0][price]")).toBe(
      STRIPE_PRO_PRICE_REFERENCE,
    );
    expect(starterBody.get("line_items[0][quantity]")).toBe("1");
    expect(starterBody.get("allow_promotion_codes")).toBe("false");
    expect(starterBody.get("after_expiration[recovery][enabled]")).toBe(
      "false",
    );
    expect(starterBody.has("subscription_data[trial_period_days]")).toBe(false);
    expect(starterBody.get("metadata[cloudmarkup_organization_id]")).toBe(
      "organization_fixture",
    );
    expect(
      starterBody.get(
        "subscription_data[metadata][cloudmarkup_billing_account_id]",
      ),
    ).toBe("billing_account_fixture");
    expect(portalBody.get("configuration")).toBe("bpc_cloudmarkup_reviewed");
    expect(calls[0]?.init.headers).toMatchObject({
      "idempotency-key": "checkout:organization_fixture:request_0001",
      "stripe-version": STRIPE_API_VERSION,
    });
    expect(
      calls.every((call) => call.url.startsWith("https://api.stripe.com/")),
    ).toBe(true);
  });

  it("verifies exact raw bytes and rejects invalid or stale signatures", async () => {
    const provider = new StripeBillingProvider({
      apiKey: API_KEY,
      fetchImplementation: () =>
        Promise.resolve(
          new Response(JSON.stringify(stripeSubscription()), { status: 200 }),
        ),
      signatureToleranceSeconds: 300,
      webhookSigningSecret: WEBHOOK_SECRET,
    });
    const event = {
      api_version: STRIPE_API_VERSION,
      livemode: false,
      object: "event",
      created: Math.floor(NOW.getTime() / 1000),
      data: { object: stripeSubscription() },
      id: "evt_fixture_signature",
      type: "customer.subscription.updated",
    };
    const signed = signedEvent(event);

    const verifiedEvent = await provider.verifyWebhook({
      now: NOW,
      ...signed,
    });
    expect(verifiedEvent.providerEventReference).toBe("evt_fixture_signature");
    expect(verifiedEvent.signatureSecretVersion).toBe("current");
    expect(verifiedEvent.supported).toBe(true);
    for (const override of [
      { livemode: true },
      { api_version: "2024-06-20" },
      { object: "customer" },
    ]) {
      await expect(
        provider.verifyWebhook({
          now: NOW,
          ...signedEvent({ ...event, ...override }),
        }),
      ).rejects.toMatchObject({ code: "invalid-provider-event" });
    }

    const previousSecret = "whsec_cloudmarkup_previous_fixture";
    const rotatingProvider = new StripeBillingProvider({
      apiKey: API_KEY,
      previousWebhookSigningSecret: previousSecret,
      signatureToleranceSeconds: 300,
      webhookSigningSecret: WEBHOOK_SECRET,
    });
    await expect(
      rotatingProvider.verifyWebhook({
        now: NOW,
        ...signedEvent(event, Math.floor(NOW.getTime() / 1000), previousSecret),
      }),
    ).resolves.toMatchObject({ signatureSecretVersion: "previous" });
    expect(
      (await provider.resolveSubscriptionSnapshot(verifiedEvent))
        ?.providerSubscriptionReference,
    ).toBe("sub_fixture_primary");

    const changedBody = new Uint8Array(signed.rawBody);
    changedBody[changedBody.byteLength - 1] =
      (changedBody[changedBody.byteLength - 1] ?? 0) ^ 1;
    await expect(
      provider.verifyWebhook({
        now: NOW,
        rawBody: changedBody,
        signatureHeader: signed.signatureHeader,
      }),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });

    const stale = signedEvent(event, Math.floor(NOW.getTime() / 1000) - 301);
    await expect(
      provider.verifyWebhook({ now: NOW, ...stale }),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
  });

  it("maps payment failure, recovery, and cancellation from provider state", async () => {
    let subscription = stripeSubscription({ status: "past_due" });
    const provider = new StripeBillingProvider({
      apiKey: API_KEY,
      fetchImplementation: () =>
        Promise.resolve(
          new Response(JSON.stringify(subscription), {
            headers: { "content-type": "application/json" },
            status: 200,
          }),
        ),
      signatureToleranceSeconds: 300,
      webhookSigningSecret: WEBHOOK_SECRET,
    });
    const invoice = {
      amount_due: 900,
      amount_paid: 0,
      amount_remaining: 900,
      billing_reason: "subscription_cycle",
      currency: "usd",
      customer: "cus_fixture_primary",
      id: "in_fixture_primary",
      livemode: false,
      object: "invoice",
      parent: {
        subscription_details: { subscription: "sub_fixture_primary" },
        type: "subscription_details",
      },
      status: "open",
      lines: {
        object: "list",
        has_more: false,
        data: [
          {
            amount: 900,
            currency: "usd",
            id: "il_fixture_primary",
            livemode: false,
            object: "line_item",
            parent: {
              type: "subscription_item_details",
              subscription_item_details: {
                proration: false,
                subscription: "sub_fixture_primary",
                subscription_item: "si_fixture_primary",
              },
            },
            period: { start: 1_786_672_800, end: 1_789_264_800 },
            pricing: {
              type: "price_details",
              price_details: {
                price: STRIPE_STARTER_PRICE_REFERENCE,
                product: STRIPE_STARTER_PRODUCT_REFERENCE,
              },
            },
            quantity: 1,
          },
        ],
      },
    };

    const failed = await provider.resolveSubscriptionSnapshot(
      verified("invoice.payment_failed", invoice),
    );
    expect(failed?.normalizedStatus).toBe("past-due");

    subscription = stripeSubscription();
    const recovered = await provider.resolveSubscriptionSnapshot(
      verified("invoice.paid", {
        ...invoice,
        amount_paid: 900,
        amount_remaining: 0,
        status: "paid",
      }),
    );
    expect(recovered?.normalizedStatus).toBe("active");
    expect(recovered?.currentPeriodId).toMatch(/^period_[0-9a-f]{40}$/);

    subscription = stripeSubscription({ cancel_at_period_end: true });
    const canceling = await provider.resolveSubscriptionSnapshot(
      verified("customer.subscription.updated", subscription),
    );
    expect(canceling?.cancelAtPeriodEnd).toBe(true);

    subscription = stripeSubscription({
      cancel_at_period_end: false,
      status: "canceled",
    });
    const deleted = await provider.resolveSubscriptionSnapshot(
      verified("customer.subscription.deleted", subscription),
    );
    expect(deleted?.normalizedStatus).toBe("canceled");
  });

  it("fails closed for trials, quantities, periods, and non-monthly prices", async () => {
    const provider = new StripeBillingProvider({
      apiKey: API_KEY,
      fetchImplementation: () => Promise.reject(new Error("no network")),
      signatureToleranceSeconds: 300,
      webhookSigningSecret: WEBHOOK_SECRET,
    });
    const invalidSubscriptions = [
      stripeSubscription({ trial_end: 1_789_264_800 }),
      stripeSubscription({
        items: {
          data: [
            {
              current_period_end: 1_789_264_800,
              current_period_start: 1_786_672_800,
              price: {
                id: STRIPE_STARTER_PRICE_REFERENCE,
                product: STRIPE_STARTER_PRODUCT_REFERENCE,
                recurring: { interval: "month", interval_count: 1 },
              },
              quantity: 2,
            },
          ],
        },
      }),
      stripeSubscription({
        items: {
          data: [
            {
              current_period_end: 1_786_672_700,
              current_period_start: 1_786_672_800,
              price: {
                id: STRIPE_STARTER_PRICE_REFERENCE,
                product: STRIPE_STARTER_PRODUCT_REFERENCE,
                recurring: { interval: "month", interval_count: 1 },
              },
              quantity: 1,
            },
          ],
        },
      }),
      stripeSubscription({
        items: {
          data: [
            {
              current_period_end: 1_789_264_800,
              current_period_start: 1_786_672_800,
              price: {
                id: STRIPE_STARTER_PRICE_REFERENCE,
                product: STRIPE_STARTER_PRODUCT_REFERENCE,
                recurring: { interval: "year", interval_count: 1 },
              },
              quantity: 1,
            },
          ],
        },
      }),
      stripeSubscription({
        items: {
          data: [
            {
              current_period_end: 1_789_264_800,
              current_period_start: 1_786_672_800,
              price: {
                id: STRIPE_STARTER_PRICE_REFERENCE,
                product: STRIPE_STARTER_PRODUCT_REFERENCE,
              },
              quantity: 1,
            },
          ],
        },
      }),
    ];

    for (const candidate of invalidSubscriptions) {
      await expect(
        provider.resolveSubscriptionSnapshot(
          verified("customer.subscription.updated", candidate),
        ),
      ).resolves.toBeNull();
    }
  });

  it("performs a separate authenticated observation when the application refreshes after its version read", async () => {
    const calls: RequestInit[] = [];
    let current = stripeSubscription();
    const provider = new StripeBillingProvider({
      apiKey: API_KEY,
      fetchImplementation: (_request, init = {}) => {
        calls.push(init);
        return Promise.resolve(
          new Response(JSON.stringify(current), { status: 200 }),
        );
      },
      signatureToleranceSeconds: 300,
      webhookSigningSecret: WEBHOOK_SECRET,
    });
    const event = verified(
      "customer.subscription.updated",
      stripeSubscription(),
    );
    const proof = structuredClone(event);
    expect(
      (await provider.resolveSubscriptionSnapshot(event))?.normalizedStatus,
    ).toBe("active");
    current = stripeSubscription({ status: "past_due" });
    expect(
      (await provider.refreshSubscriptionSnapshot(event))?.normalizedStatus,
    ).toBe("past-due");
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(
      calls.every(
        (call) =>
          new Headers(call.headers).get("authorization") ===
          "Bearer " + API_KEY,
      ),
    ).toBe(true);
    expect(event).toEqual(proof);
  });

  it("refreshes same-second historical status without changing webhook proof", async () => {
    const canceled = stripeSubscription({ status: "canceled" });
    const calls: string[] = [];
    const provider = new StripeBillingProvider({
      apiKey: API_KEY,
      signatureToleranceSeconds: 300,
      webhookSigningSecret: WEBHOOK_SECRET,
      fetchImplementation: (url) => {
        calls.push(
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.toString()
              : url.url,
        );
        return Promise.resolve(
          new Response(JSON.stringify(canceled), { status: 200 }),
        );
      },
    });
    const stale = {
      ...verified("customer.subscription.updated", stripeSubscription()),
      eventPosition: "00000000001786628400:evt_z_old_active",
      providerEventReference: "evt_z_old_active",
    };
    const deleted = {
      ...verified("customer.subscription.deleted", canceled),
      eventPosition: "00000000001786628400:evt_a_current_canceled",
      providerEventReference: "evt_a_current_canceled",
    };
    const original = structuredClone(stale);
    expect(stale.eventPosition > deleted.eventPosition).toBe(true);
    await expect(
      provider.resolveSubscriptionSnapshot(deleted),
    ).resolves.toMatchObject({ normalizedStatus: "canceled" });
    await expect(
      provider.resolveSubscriptionSnapshot(stale),
    ).resolves.toMatchObject({ normalizedStatus: "canceled" });
    expect(stale).toEqual(original);
    expect(calls).toEqual(
      Array.from(
        { length: 2 },
        () => "https://api.stripe.com/v1/subscriptions/sub_fixture_primary",
      ),
    );
    await expect(
      provider.resolveSubscriptionSnapshot(
        verified("checkout.session.completed", {
          subscription: stripeSubscription(),
        }),
      ),
    ).resolves.toMatchObject({ normalizedStatus: "canceled" });
  });

  it("rejects refreshed subscription identity changes or contradictory cancellation", async () => {
    let current = stripeSubscription();
    const provider = new StripeBillingProvider({
      apiKey: API_KEY,
      signatureToleranceSeconds: 300,
      webhookSigningSecret: WEBHOOK_SECRET,
      fetchImplementation: () =>
        Promise.resolve(new Response(JSON.stringify(current), { status: 200 })),
    });
    for (const changes of [
      { id: "sub_other" },
      { customer: "cus_other" },
      { object: "customer" },
      { livemode: true },
      {
        metadata: {
          cloudmarkup_organization_id: "other_org",
          cloudmarkup_billing_account_id: "billing_account_fixture",
        },
      },
      {
        metadata: {
          cloudmarkup_organization_id: "organization_fixture",
          cloudmarkup_billing_account_id: "other_account",
        },
      },
    ]) {
      current = stripeSubscription(changes);
      await expect(
        provider.resolveSubscriptionSnapshot(
          verified("customer.subscription.updated", stripeSubscription()),
        ),
      ).resolves.toBeNull();
    }
    current = stripeSubscription();
    await expect(
      provider.resolveSubscriptionSnapshot(
        verified(
          "customer.subscription.deleted",
          stripeSubscription({ status: "canceled" }),
        ),
      ),
    ).resolves.toBeNull();
    current = stripeSubscription({ status: "canceled" });
    await expect(
      provider.resolveSubscriptionSnapshot(
        verified("customer.subscription.deleted", stripeSubscription()),
      ),
    ).resolves.toBeNull();
  });

  it("never falls back to historical active state when current retrieval fails", async () => {
    const provider = new StripeBillingProvider({
      apiKey: API_KEY,
      signatureToleranceSeconds: 300,
      webhookSigningSecret: WEBHOOK_SECRET,
      fetchImplementation: () =>
        Promise.resolve(new Response("{}", { status: 503 })),
    });
    await expect(
      provider.resolveSubscriptionSnapshot(
        verified("customer.subscription.updated", stripeSubscription()),
      ),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
  });

  it("rejects live-mode keys and untrusted hosted response URLs", async () => {
    expect(
      () =>
        new StripeBillingProvider({
          apiKey: "sk_live_not_allowed",
          signatureToleranceSeconds: 300,
          webhookSigningSecret: WEBHOOK_SECRET,
        }),
    ).toThrow("Stripe configuration is invalid.");
    expect(
      () =>
        new StripeBillingProvider({
          apiKey: API_KEY,
          signatureToleranceSeconds: 300,
          stripeEnvironment: "live",
          webhookSigningSecret: WEBHOOK_SECRET,
        }),
    ).toThrow("Stripe configuration is invalid.");
    expect(
      () =>
        new StripeBillingProvider({
          apiKey: API_KEY,
          previousWebhookSigningSecret: WEBHOOK_SECRET,
          signatureToleranceSeconds: 300,
          webhookSigningSecret: WEBHOOK_SECRET,
        }),
    ).toThrow("Stripe configuration is invalid.");

    const provider = new StripeBillingProvider({
      apiKey: API_KEY,
      fetchImplementation: () =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              checkoutFixture({ url: "https://attacker.example/session" }),
            ),
            {
              headers: { "content-type": "application/json" },
              status: 200,
            },
          ),
        ),
      signatureToleranceSeconds: 300,
      webhookSigningSecret: WEBHOOK_SECRET,
    });
    await expect(
      provider.createCheckoutSession({
        billingAccountId: "billing_account_fixture",
        cancelUrl: configuration().cancelUrl,
        idempotencyKey: "checkout:organization_fixture:request_0003",
        organizationId: "organization_fixture",
        plan: configuration().plans.starter,
        successUrl: configuration().successUrl,
      }),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
  });
});
