import {
  CREDIT_TOP_UP_PACKS_V1,
  CREDIT_TOP_UP_POLICY_VERSION,
} from "@cloudmarkup/domain";
import { describe, expect, it, vi } from "vitest";
import { REVIEWED_LIVE_STRIPE } from "./reviewed-live-plans.js";
import { StripeBillingProvider } from "./stripe-billing-provider.js";
import type { CreditTopUpPurchase } from "../../application/billing-top-ups.js";

function fixture(
  packKey: CreditTopUpPurchase["packKey"] = "small",
  paid = false,
  live = false,
) {
  const pack = CREDIT_TOP_UP_PACKS_V1.find((pack) => pack.key === packKey);
  if (pack === undefined) throw Error("Missing synthetic pack");
  const purchase: CreditTopUpPurchase = {
    attemptId: "topup_" + "a".repeat(32),
    organizationId: "org_owner",
    billingAccountId: "billing_owner",
    providerCustomerReference: "cus_owner",
    packKey,
    policyVersion: CREDIT_TOP_UP_POLICY_VERSION,
  };
  const metadata = {
    cloudmarkup_top_up_attempt: purchase.attemptId,
    cloudmarkup_organization_id: purchase.organizationId,
    cloudmarkup_billing_account_id: purchase.billingAccountId,
    cloudmarkup_top_up_policy: purchase.policyVersion,
    cloudmarkup_top_up_pack: packKey,
  };
  const amount = pack.priceMicros / 10000;
  const session = {
    id: live ? "cs_live_purchase" : "cs_test_purchase",
    object: "checkout.session",
    livemode: live,
    mode: "payment",
    customer: "cus_owner",
    client_reference_id: purchase.attemptId,
    metadata,
    subscription: null,
    currency: "usd",
    amount_subtotal: amount,
    amount_total: amount,
    total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
    automatic_tax: { enabled: false },
    after_expiration: null,
    status: paid ? "complete" : "open",
    payment_status: paid ? "paid" : "unpaid",
    payment_intent: paid ? "pi_purchase" : null,
    expires_at: 1_800_000_000,
    url: paid ? null : "https://checkout.stripe.com/c/pay/cs_test_purchase",
  };
  const line = {
    object: "item",
    quantity: 1,
    currency: "usd",
    amount_subtotal: amount,
    amount_total: amount,
    amount_discount: 0,
    amount_tax: 0,
    price: {
      object: "price",
      id: live
        ? REVIEWED_LIVE_STRIPE.topUps[packKey].priceReference
        : "price_purchase",
      product: live
        ? REVIEWED_LIVE_STRIPE.topUps[packKey].productReference
        : "prod_purchase",
      livemode: live,
      currency: "usd",
      unit_amount: amount,
      type: "one_time",
      recurring: null,
      billing_scheme: "per_unit",
    },
  };
  const items = { object: "list", has_more: false, data: [line] };
  const charge = {
    object: "charge",
    id: "ch_purchase",
    livemode: live,
    customer: "cus_owner",
    payment_intent: "pi_purchase",
    currency: "usd",
    status: "succeeded",
    paid: true,
    captured: true,
    amount,
    amount_captured: amount,
    amount_refunded: 0,
    refunded: false,
    disputed: false,
  };
  const payment = {
    object: "payment_intent",
    id: "pi_purchase",
    customer: "cus_owner",
    metadata,
    livemode: live,
    currency: "usd",
    status: "succeeded",
    amount,
    amount_received: amount,
    latest_charge: charge,
  };
  const fetchImplementation = vi.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST" && !(init.body instanceof URLSearchParams))
        throw Error("Invalid fixture request body");
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return Promise.resolve(
        Response.json(
          url.includes("/line_items?")
            ? items
            : url.includes("/payment_intents/")
              ? payment
              : session,
        ),
      );
    },
  );
  const provider = new StripeBillingProvider({
    apiKey: live
      ? "sk_live_cloudmarkup_fixture"
      : "sk_test_cloudmarkup_fixture",
    stripeEnvironment: live ? "live" : "test",
    signatureToleranceSeconds: 300,
    verificationMode: "hosted-sessions-only",
    fetchImplementation,
  });
  const input = { purchase, providerSessionReference: session.id };
  return {
    purchase,
    session,
    line,
    items,
    payment,
    charge,
    provider,
    input,
    fetchImplementation,
  };
}

describe("sandbox credit top-up checkout", () => {
  it.each(CREDIT_TOP_UP_PACKS_V1.filter((pack) => pack.key === "small"))(
    "uses only the approved $key pack and a stable provider retry identity",
    async (pack) => {
      const f = fixture(pack.key);
      const result = await f.provider.createCreditTopUpSession({
        purchase: f.purchase,
        retryBefore: new Date(Date.now() + 3600000).toISOString(),
        successUrl: "https://beta.example.invalid/billing?returned=true",
        cancelUrl: "https://beta.example.invalid/billing",
      });
      expect(result.paymentReview).toBeNull();
      expect(result.url).toBe(f.session.url);
      const call = f.fetchImplementation.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(call[0]).toBe("https://api.stripe.com/v1/checkout/sessions");
      const body = call[1].body as URLSearchParams;
      expect(body.get("mode")).toBe("payment");
      expect(body.get("payment_method_types[0]")).toBe("card");
      expect(body.get("line_items[0][price_data][unit_amount]")).toBe(
        String(pack.priceMicros / 10000),
      );
      expect(body.get("line_items[0][quantity]")).toBe("1");
      expect(body.get("line_items[0][price_data][product_data][name]")).toBe(
        String(pack.creditUnits) + " Cloud Markup credits",
      );
      expect(new Headers(call[1].headers).get("idempotency-key")).toBe(
        "top-up:" + f.purchase.attemptId,
      );
      expect(
        body.get("payment_intent_data[metadata][cloudmarkup_top_up_attempt]"),
      ).toBe(f.purchase.attemptId);
      expect(f.fetchImplementation).toHaveBeenCalledTimes(2);
    },
  );
  it("requires fresh session, line-item and captured payment evidence", async () => {
    const f = fixture("medium", true);
    const result = await f.provider.getCreditTopUpSession(f.input);
    expect(result.paymentReview).toBe("clear");
    expect(result.paymentStatus).toBe("paid");
    expect(result.providerPaymentReference).toBe("pi_purchase");
    expect(result.url).toBeNull();
    expect(f.fetchImplementation).toHaveBeenCalledTimes(3);
  });
  it("does not count a completed but delayed unpaid payment as paid", async () => {
    const f = fixture();
    f.session.status = "complete";
    expect(
      (await f.provider.getCreditTopUpSession(f.input)).paymentReview,
    ).toBeNull();
    expect(f.fetchImplementation).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["mode", "subscription"],
    ["livemode", true],
    ["customer", "cus_foreign"],
    ["client_reference_id", "another_attempt"],
    ["currency", "eur"],
    ["amount_subtotal", 499],
    ["amount_total", 499],
    ["subscription", "sub_other"],
    ["payment_status", "no_payment_required"],
    ["id", "cs_test_another"],
    ["url", "https://checkout.stripe.com.evil.test/c/pay"],
    ["url", "https://user@checkout.stripe.com/c/pay"],
  ])("rejects substituted session %s", async (key, value) => {
    const f = fixture();
    Object.assign(f.session, { [key]: value });
    await expect(
      f.provider.getCreditTopUpSession(f.input),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
  });
  it.each([
    "cloudmarkup_top_up_attempt",
    "cloudmarkup_organization_id",
    "cloudmarkup_billing_account_id",
    "cloudmarkup_top_up_policy",
    "cloudmarkup_top_up_pack",
  ])("rejects substituted ownership/policy %s", async (key) => {
    const f = fixture();
    Object.assign(f.session.metadata, { [key]: "foreign" });
    await expect(
      f.provider.getCreditTopUpSession(f.input),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
  });
  it.each([
    ["quantity", 2],
    ["amount_subtotal", 1],
    ["amount_total", 1],
    ["amount_discount", 1],
    ["amount_tax", 1],
    ["currency", "eur"],
  ])("rejects inconsistent line item %s", async (key, value) => {
    const f = fixture();
    Object.assign(f.line, { [key]: value });
    await expect(
      f.provider.getCreditTopUpSession(f.input),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
  });
  it.each([
    ["livemode", true],
    ["unit_amount", 1],
    ["recurring", { interval: "month" }],
    ["type", "recurring"],
    ["currency", "eur"],
    ["billing_scheme", "tiered"],
  ])("rejects unexpected price %s", async (key, value) => {
    const f = fixture();
    Object.assign(f.line.price, { [key]: value });
    await expect(
      f.provider.getCreditTopUpSession(f.input),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
  });
  it.each(["extra", "pagination"])("rejects %s line items", async (kind) => {
    const f = fixture();
    if (kind === "extra") f.items.data.push(f.line);
    else f.items.has_more = true;
    await expect(
      f.provider.getCreditTopUpSession(f.input),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
  });
  it.each([
    ["status", "processing"],
    ["amount_received", 1],
    ["customer", "cus_foreign"],
    ["currency", "eur"],
    ["livemode", true],
    ["id", "pi_foreign"],
  ])("rejects insufficient payment %s", async (key, value) => {
    const f = fixture("small", true);
    Object.assign(f.payment, { [key]: value });
    await expect(
      f.provider.getCreditTopUpSession(f.input),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
  });
  it.each([
    ["captured", false],
    ["paid", false],
    ["amount_captured", 1],
    ["payment_intent", "pi_foreign"],
    ["customer", "cus_foreign"],
    ["livemode", true],
    ["amount_refunded", -1],
  ])("rejects inconsistent charge %s", async (key, value) => {
    const f = fixture("small", true);
    Object.assign(f.charge, { [key]: value });
    await expect(
      f.provider.getCreditTopUpSession(f.input),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
  });
  it.each(["partial refund", "full refund", "dispute"])(
    "marks %s for reconciliation instead of treating it as a clear payment",
    async (kind) => {
      const f = fixture("small", true);
      if (kind === "dispute") f.charge.disputed = true;
      else {
        f.charge.amount_refunded = kind === "full refund" ? 500 : 100;
        f.charge.refunded = kind === "full refund";
      }
      expect(
        (await f.provider.getCreditTopUpSession(f.input)).paymentReview,
      ).toBe(kind === "dispute" ? "dispute" : "refund");
    },
  );
  it("cannot issue a new external attempt after its safe retry window", async () => {
    const f = fixture();
    await expect(
      f.provider.createCreditTopUpSession({
        purchase: f.purchase,
        retryBefore: "2000-01-01T00:00:00.000Z",
        successUrl: "https://beta.example.invalid/",
        cancelUrl: "https://beta.example.invalid/",
      }),
    ).rejects.toMatchObject({ code: "provider-unavailable" });
    expect(f.fetchImplementation).not.toHaveBeenCalled();
  });
  it("does not expose checkout creation in a queue-only runtime", () => {
    const f = fixture();
    const worker = new StripeBillingProvider({
      apiKey: "sk_test_cloudmarkup_fixture",
      signatureToleranceSeconds: 300,
      verificationMode: "queued-events-only",
      fetchImplementation: f.fetchImplementation,
    });
    expect(() =>
      worker.createCreditTopUpSession({
        purchase: f.purchase,
        retryBefore: new Date(Date.now() + 3600000).toISOString(),
        successUrl: "https://beta.example.invalid/",
        cancelUrl: "https://beta.example.invalid/",
      }),
    ).toThrow("disabled");
    expect(f.fetchImplementation).not.toHaveBeenCalled();
  });
});

describe("reviewed live credit pack catalog", () => {
  it.each(CREDIT_TOP_UP_PACKS_V1)(
    "checks the exact live $key price and product on checkout and settlement",
    async (pack) => {
      const f = fixture(pack.key, false, true);
      await f.provider.createCreditTopUpSession({
        purchase: f.purchase,
        retryBefore: new Date(Date.now() + 3600000).toISOString(),
        successUrl: "https://beta.example.invalid/organizations",
        cancelUrl: "https://beta.example.invalid/organizations",
      });
      const body = f.fetchImplementation.mock.calls[0]?.[1]?.body;
      if (!(body instanceof URLSearchParams)) throw Error("Expected form body");
      expect(body.get("line_items[0][price]")).toBe(
        REVIEWED_LIVE_STRIPE.topUps[pack.key].priceReference,
      );
      expect([...body.keys()].some((key) => key.includes("price_data"))).toBe(
        false,
      );
      const paid = fixture(pack.key, true, true);
      await expect(
        paid.provider.getCreditTopUpSession(paid.input),
      ).resolves.toMatchObject({
        paymentReview: "clear",
        paymentStatus: "paid",
      });
    },
  );
  it.each([
    "price",
    "product",
    "mode",
    "payment-mode",
    "charge-mode",
    "amount",
  ])("denies contradictory live %s evidence", async (field) => {
    const f = fixture("small", true, true);
    if (field === "price") f.line.price.id = "price_other";
    if (field === "product") f.line.price.product = "prod_other";
    if (field === "mode") f.line.price.livemode = false;
    if (field === "payment-mode") f.payment.livemode = false;
    if (field === "charge-mode") f.charge.livemode = false;
    if (field === "amount") f.line.price.unit_amount = 1;
    await expect(
      f.provider.getCreditTopUpSession(f.input),
    ).rejects.toMatchObject({ code: "invalid-provider-event" });
  });
  it("rejects a test Checkout reference before issuing any live request", async () => {
    const f = fixture("small", false, true);
    await expect(
      f.provider.getCreditTopUpSession({
        ...f.input,
        providerSessionReference: "cs_test_other",
      }),
    ).rejects.toThrow();
    expect(f.fetchImplementation).not.toHaveBeenCalled();
  });
});
