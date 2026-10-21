import { describe, expect, it } from "vitest";

import type {
  BillingSubscriptionSnapshot,
  VerifiedBillingWebhookEvent,
} from "../../application/billing.js";
import { StripeBillingProvider } from "./stripe-billing-provider.js";
import { isCurrentSubscriptionInvoice } from "./stripe-invoice-period.js";
import {
  STRIPE_LEGACY_EVENT_VERSION,
  normalizeReviewedStripeEventObject,
} from "./stripe-event-version.js";

function fixture() {
  const item = {
    current_period_start: 1_786_672_800,
    current_period_end: 1_789_264_800,
    id: "si_current",
    price: {
      currency: "usd",
      id: "price_starter",
      product: "prod_starter",
      recurring: { interval: "month", interval_count: 1 },
    },
    quantity: 1,
  };
  const line = {
    amount: 900,
    currency: "usd",
    id: "il_current",
    invoice: "in_current",
    livemode: false,
    object: "line_item",
    parent: {
      type: "subscription_item_details",
      subscription_item_details: {
        proration: false,
        subscription: "sub_current",
        subscription_item: item.id,
      },
    },
    period: { start: item.current_period_start, end: item.current_period_end },
    pricing: {
      type: "price_details",
      price_details: { price: item.price.id, product: item.price.product },
    },
    quantity: 1,
  };
  const subscription = {
    cancel_at_period_end: false,
    customer: "cus_current",
    id: "sub_current",
    items: { data: [item], has_more: false },
    latest_invoice: "in_current",
    livemode: false,
    metadata: {
      cloudmarkup_billing_account_id: "billing_account_current",
      cloudmarkup_organization_id: "organization_current",
    },
    object: "subscription",
    status: "active",
    trial_end: null,
  };
  const invoice = {
    amount_due: 900,
    amount_paid: 900,
    amount_remaining: 0,
    billing_reason: "subscription_cycle",
    currency: "usd",
    customer: subscription.customer,
    id: "in_current",
    lines: { object: "list", data: [line], has_more: false },
    livemode: false,
    object: "invoice",
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: subscription.id },
    },
    // Invoice usage periods look back one cycle. They are NOT service periods.
    period_start: item.current_period_start - 2_592_000,
    period_end: item.current_period_start,
    status: "paid",
  };
  const snapshot: BillingSubscriptionSnapshot = {
    billingAccountId: "billing_account_current",
    billableSeatQuantity: 1,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(),
    currentPeriodId: "period_current",
    currentPeriodStart: new Date(
      item.current_period_start * 1000,
    ).toISOString(),
    normalizedStatus: "active",
    organizationId: "organization_current",
    priceReference: item.price.id,
    productReference: item.price.product,
    providerCustomerReference: subscription.customer,
    providerSubscriptionReference: subscription.id,
  };
  return { invoice, item, line, snapshot, subscription };
}

type Fixture = ReturnType<typeof fixture>;

function legacyInvoice(value: Fixture) {
  return {
    ...value.invoice,
    parent: undefined,
    subscription: value.invoice.parent.subscription_details.subscription,
    lines: {
      ...value.invoice.lines,
      data: value.invoice.lines.data.map((line) => ({
        ...line,
        parent: undefined,
        pricing: undefined,
        type: "subscription",
        ...line.parent.subscription_item_details,
        price: {
          object: "price",
          livemode: false,
          currency: line.currency,
          id: line.pricing.price_details.price,
          product: line.pricing.price_details.product,
        },
      })),
    },
  };
}

function normalizeLegacyInvoice(value: unknown) {
  return normalizeReviewedStripeEventObject({
    eventType: "invoice.paid",
    apiVersion: STRIPE_LEGACY_EVENT_VERSION,
    value,
  });
}

function validates(value: Fixture, eventType = "invoice.paid"): boolean {
  return isCurrentSubscriptionInvoice({ ...value, eventType });
}

function verified(
  eventType: string,
  providerEventData: unknown,
): VerifiedBillingWebhookEvent {
  return {
    eventPosition: "00000000001786628400:evt_invoice_provenance",
    eventType,
    occurredAt: "2026-08-14T12:00:00.000Z",
    payloadSha256: "a".repeat(64),
    providerEventData,
    providerEventReference: "evt_invoice_provenance",
    supported: true,
  };
}

describe("Stripe invoice service-period provenance", () => {
  it("normalizes the reviewed Acacia invoice without changing historical evidence", () => {
    const value = fixture();
    const source = legacyInvoice(value);
    const original = structuredClone(source);
    const invoice = normalizeLegacyInvoice(source);
    expect(source).toEqual(original);
    expect(invoice).toMatchObject({
      amount_paid: 900,
      period_start: value.invoice.period_start,
      parent: value.invoice.parent,
      lines: {
        data: [
          expect.objectContaining({
            period: value.line.period,
            parent: value.line.parent,
            pricing: value.line.pricing,
          }),
        ],
      },
    });
    expect(
      isCurrentSubscriptionInvoice({
        ...value,
        invoice,
        eventType: "invoice.paid",
      }),
    ).toBe(true);
  });

  it.each(["2024-06-20", "2025-06-30.other", null, undefined])(
    "rejects an unreviewed stored event version %s",
    (apiVersion) => {
      expect(() =>
        normalizeReviewedStripeEventObject({
          eventType: "invoice.paid",
          apiVersion,
          value: legacyInvoice(fixture()),
        }),
      ).toThrow();
    },
  );

  it("accepts additive modern fields only when they agree with the historical legacy identities", () => {
    const value = fixture();
    const source = legacyInvoice(value);
    const additive = {
      ...source,
      parent: value.invoice.parent,
      lines: {
        ...source.lines,
        data: [
          {
            ...source.lines.data[0],
            parent: value.line.parent,
            pricing: value.line.pricing,
          },
        ],
      },
    };
    expect(
      isCurrentSubscriptionInvoice({
        ...value,
        invoice: normalizeLegacyInvoice(additive),
        eventType: "invoice.paid",
      }),
    ).toBe(true);
    const contradicted = structuredClone(additive);
    const contradictedLine = contradicted.lines.data[0];
    if (contradictedLine === undefined) throw new Error("Fixture line absent");
    contradictedLine.parent.subscription_item_details.subscription_item =
      "si_other";
    expect(() => normalizeLegacyInvoice(contradicted)).toThrow();
  });

  it("rejects conflicting additive fields and incomplete legacy price evidence", () => {
    const source = legacyInvoice(fixture());
    const parent = fixture().invoice.parent;
    parent.subscription_details.subscription = "sub_other";
    expect(() => normalizeLegacyInvoice({ ...source, parent })).toThrow();
    const pricing = fixture().line.pricing;
    pricing.price_details.price = "price_other";
    expect(() =>
      normalizeLegacyInvoice({
        ...source,
        lines: {
          ...source.lines,
          data: [{ ...source.lines.data[0], pricing }],
        },
      }),
    ).toThrow();
    expect(() =>
      normalizeLegacyInvoice({
        ...source,
        lines: {
          ...source.lines,
          data: [{ ...source.lines.data[0], price: "price_starter" }],
        },
      }),
    ).toThrow();
  });
  it("accepts the complete current subscription line, not the top-level usage period", () => {
    expect(validates(fixture())).toBe(true);
    const first = fixture();
    first.invoice.billing_reason = "subscription_create";
    expect(validates(first)).toBe(true);
  });

  const invalidCases: readonly [string, (value: Fixture) => void][] = [
    [
      "prior service period",
      (f) => {
        f.line.period.start -= 2_592_000;
        f.line.period.end -= 2_592_000;
      },
    ],
    [
      "wrong customer",
      (f) => {
        f.invoice.customer = "cus_other";
      },
    ],
    [
      "wrong subscription",
      (f) => {
        f.invoice.parent.subscription_details.subscription = "sub_other";
      },
    ],
    [
      "wrong line subscription",
      (f) => {
        f.line.parent.subscription_item_details.subscription = "sub_other";
      },
    ],
    [
      "wrong subscription item",
      (f) => {
        f.line.parent.subscription_item_details.subscription_item = "si_other";
      },
    ],
    [
      "wrong price",
      (f) => {
        f.line.pricing.price_details.price = "price_other";
      },
    ],
    [
      "wrong product",
      (f) => {
        f.line.pricing.price_details.product = "prod_other";
      },
    ],
    [
      "wrong line invoice",
      (f) => {
        f.line.invoice = "in_other";
      },
    ],
    [
      "newer invoice exists",
      (f) => {
        f.subscription.latest_invoice = "in_newer";
      },
    ],
    [
      "paginated lines",
      (f) => {
        f.invoice.lines.has_more = true;
      },
    ],
    [
      "missing lines",
      (f) => {
        f.invoice.lines.data = [];
      },
    ],
    [
      "additional lines",
      (f) => {
        f.invoice.lines.data.push({ ...f.line, id: "il_other" });
      },
    ],
    [
      "paginated subscription items",
      (f) => {
        f.subscription.items.has_more = true;
      },
    ],
    [
      "proration",
      (f) => {
        f.line.parent.subscription_item_details.proration = true;
      },
    ],
    [
      "plan update invoice",
      (f) => {
        f.invoice.billing_reason = "subscription_update";
      },
    ],
    [
      "manual invoice",
      (f) => {
        f.invoice.billing_reason = "manual";
      },
    ],
    [
      "multiple quantity",
      (f) => {
        f.line.quantity = 2;
      },
    ],
    [
      "foreign currency",
      (f) => {
        f.invoice.currency = "eur";
      },
    ],
    [
      "unpaid invoice",
      (f) => {
        f.invoice.status = "open";
      },
    ],
    [
      "remaining balance",
      (f) => {
        f.invoice.amount_remaining = 1;
      },
    ],
    [
      "invalid amount",
      (f) => {
        f.invoice.amount_paid = Number.NaN;
      },
    ],
    [
      "live invoice",
      (f) => {
        f.invoice.livemode = true;
      },
    ],
    [
      "live subscription",
      (f) => {
        f.subscription.livemode = true;
      },
    ],
    [
      "live line",
      (f) => {
        f.line.livemode = true;
      },
    ],
    [
      "missing period",
      (f) => {
        f.snapshot = { ...f.snapshot, currentPeriodId: null };
      },
    ],
    [
      "canceled subscription",
      (f) => {
        f.subscription.status = "canceled";
      },
    ],
  ];
  it.each(
    invalidCases.filter(
      ([name]) => !["manual invoice", "missing lines"].includes(name),
    ),
  )("rejects %s before credits can be granted", (_name, mutate) => {
    const value = fixture();
    mutate(value);
    expect(validates(value)).toBe(false);
  });
  it.each(
    invalidCases.filter(
      ([name]) =>
        ![
          "wrong subscription",
          "newer invoice exists",
          "paginated subscription items",
          "manual invoice",
          "missing lines",
          "live subscription",
          "missing period",
          "canceled subscription",
        ].includes(name),
    ),
  )("also denies %s in the reviewed legacy invoice", (_name, mutate) => {
    const value = fixture();
    mutate(value);
    let invoice: unknown;
    try {
      invoice = normalizeLegacyInvoice(legacyInvoice(value));
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid-provider-event" });
      return;
    }
    expect(
      isCurrentSubscriptionInvoice({
        ...value,
        invoice,
        eventType: "invoice.paid",
      }),
    ).toBe(false);
  });

  it.each([undefined, null, [], {}, { subscription: "sub_current" }])(
    "rejects insufficient invoice evidence (%j)",
    (invoice) => {
      const value = fixture();
      expect(
        isCurrentSubscriptionInvoice({
          ...value,
          invoice,
          eventType: "invoice.paid",
        }),
      ).toBe(false);
    },
  );

  it.each(["invoice.payment_failed", "invoice.payment_action_required"])(
    "accepts %s only for the current unpaid invoice and current nonterminal failure state",
    (eventType) => {
      const value = fixture();
      value.invoice.status = "open";
      value.invoice.amount_paid = 0;
      value.invoice.amount_remaining = 900;
      for (const status of ["past_due", "unpaid", "incomplete"]) {
        value.subscription.status = status;
        expect(validates(value, eventType)).toBe(true);
      }
      for (const status of [
        "active",
        "canceled",
        "paused",
        "incomplete_expired",
        "trialing",
      ]) {
        value.subscription.status = status;
        expect(validates(value, eventType)).toBe(false);
      }
      value.subscription.status = "past_due";
      value.invoice.status = "paid";
      expect(validates(value, eventType)).toBe(false);
    },
  );

  it("refreshes expanded invoice subscriptions and rejects a paid prior period", async () => {
    const value = fixture();
    const staleExpandedSubscription = structuredClone(value.subscription);
    const calls: string[] = [];
    value.item.current_period_start = value.item.current_period_end;
    value.item.current_period_end += 2_592_000;
    const provider = new StripeBillingProvider({
      apiKey: "sk_test_invoice_fixture",
      fetchImplementation: (url) => {
        calls.push(
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.toString()
              : url.url,
        );
        return Promise.resolve(
          new Response(JSON.stringify(value.subscription), { status: 200 }),
        );
      },
      signatureToleranceSeconds: 300,
      webhookSigningSecret: "whsec_invoice_fixture",
    });
    const invoice = {
      ...value.invoice,
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: staleExpandedSubscription },
      },
    };
    await expect(
      provider.resolveSubscriptionSnapshot(verified("invoice.paid", invoice)),
    ).resolves.toBeNull();
    expect(calls).toEqual([
      "https://api.stripe.com/v1/subscriptions/sub_current",
    ]);
  });

  it("does not resurrect a canceled subscription or downgrade recovered state from an old failure", async () => {
    const value = fixture();
    value.invoice.status = "open";
    value.invoice.amount_paid = 0;
    value.invoice.amount_remaining = 900;
    const provider = new StripeBillingProvider({
      apiKey: "sk_test_invoice_fixture",
      fetchImplementation: () =>
        Promise.resolve(
          new Response(JSON.stringify(value.subscription), { status: 200 }),
        ),
      signatureToleranceSeconds: 300,
      webhookSigningSecret: "whsec_invoice_fixture",
    });
    for (const status of [
      "canceled",
      "active",
      "paused",
      "incomplete_expired",
    ]) {
      value.subscription.status = status;
      await expect(
        provider.resolveSubscriptionSnapshot(
          verified("invoice.payment_failed", value.invoice),
        ),
      ).resolves.toBeNull();
    }
    value.subscription.status = "incomplete";
    await expect(
      provider.resolveSubscriptionSnapshot(
        verified("invoice.payment_failed", value.invoice),
      ),
    ).resolves.toMatchObject({ normalizedStatus: "incomplete" });
  });
});
