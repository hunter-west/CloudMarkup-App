import {
  CREDIT_TOP_UP_POLICY_VERSION,
  creditTopUpPack,
} from "@cloudmarkup/domain";
import type {
  CreditTopUpPurchase,
  CreditTopUpSession,
  CreateCreditTopUpSessionInput,
} from "../../application/billing-top-ups.js";
import { BillingApplicationError } from "../../application/billing-errors.js";

export interface StripeTopUpConfiguration {
  readonly stripeEnvironment: "test" | "live";
  readonly prices?: Readonly<
    Record<
      "small" | "medium" | "large",
      Readonly<{
        readonly productReference: string;
        readonly priceReference: string;
      }>
    >
  >;
}
const sandboxConfiguration: StripeTopUpConfiguration = {
  stripeEnvironment: "test",
};
function configuredPrice(
  configuration: StripeTopUpConfiguration,
  purchase: CreditTopUpPurchase,
) {
  const pack = packFor(purchase);
  if (!["test", "live"].includes(configuration.stripeEnvironment))
    return invalid();
  const mapping = configuration.prices?.[pack.key];
  if (configuration.stripeEnvironment === "live" && mapping === undefined)
    return invalid();
  if (mapping !== undefined) {
    reference(mapping.productReference, "prod_");
    reference(mapping.priceReference, "price_");
  }
  return mapping;
}

type JsonObject = Readonly<Record<string, unknown>>;
export type StripeTopUpRequest = (
  path: string,
  init: {
    readonly method: "GET" | "POST";
    readonly body?: URLSearchParams;
    readonly idempotencyKey?: string;
  },
) => Promise<JsonObject>;
function invalid(): never {
  throw new BillingApplicationError(
    "invalid-provider-event",
    "The credit purchase evidence is invalid.",
  );
}
function object(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as JsonObject;
}
function reference(value: unknown, prefix: string): string {
  if (
    typeof value !== "string" ||
    value.length > 255 ||
    value.length <= prefix.length ||
    !value.startsWith(prefix) ||
    !/^[A-Za-z0-9_]+$/u.test(value)
  )
    return invalid();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    return invalid();
  const date = new Date(value * 1000);
  if (!Number.isFinite(date.getTime())) return invalid();
  return date.toISOString();
}
function packFor(purchase: CreditTopUpPurchase) {
  const pack = creditTopUpPack(purchase.packKey);
  if (
    pack === undefined ||
    purchase.policyVersion !== CREDIT_TOP_UP_POLICY_VERSION ||
    !/^topup_[a-f0-9]{32}$/u.test(purchase.attemptId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(purchase.organizationId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(purchase.billingAccountId)
  )
    return invalid();
  reference(purchase.providerCustomerReference, "cus_");
  return pack;
}
function metadata(
  purchase: CreditTopUpPurchase,
): Readonly<Record<string, string>> {
  return {
    cloudmarkup_top_up_attempt: purchase.attemptId,
    cloudmarkup_organization_id: purchase.organizationId,
    cloudmarkup_billing_account_id: purchase.billingAccountId,
    cloudmarkup_top_up_policy: purchase.policyVersion,
    cloudmarkup_top_up_pack: purchase.packKey,
  };
}
function verifyMetadata(value: unknown, purchase: CreditTopUpPurchase): void {
  const actual = object(value);
  if (
    Object.entries(metadata(purchase)).some(
      ([key, value]) => actual[key] !== value,
    )
  )
    invalid();
}
function checkoutUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    Array.from(value).some(
      (character) =>
        character.charCodeAt(0) <= 32 ||
        character.charCodeAt(0) === 127 ||
        character === "\\",
    )
  )
    return invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "checkout.stripe.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname === "/"
  )
    return invalid();
  return url.href;
}
function returnUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.href !== value
  )
    invalid();
}
function session(
  value: JsonObject,
  purchase: CreditTopUpPurchase,
  configuration: StripeTopUpConfiguration,
  expectedReference?: string,
): CreditTopUpSession {
  const pack = packFor(purchase);
  configuredPrice(configuration, purchase);
  const id = reference(
    value["id"],
    configuration.stripeEnvironment === "live" ? "cs_live_" : "cs_test_",
  );
  verifyMetadata(value["metadata"], purchase);
  const details = object(value["total_details"]);
  const automaticTax = object(value["automatic_tax"]);
  const status = value["status"],
    paymentStatus = value["payment_status"];
  const recovery =
    value["after_expiration"] == null
      ? null
      : object(object(value["after_expiration"])["recovery"]);
  if (
    value["object"] !== "checkout.session" ||
    value["livemode"] !== (configuration.stripeEnvironment === "live") ||
    value["mode"] !== "payment" ||
    (expectedReference !== undefined && id !== expectedReference) ||
    value["customer"] !== purchase.providerCustomerReference ||
    value["client_reference_id"] !== purchase.attemptId ||
    value["subscription"] !== null ||
    value["currency"] !== "usd" ||
    value["amount_subtotal"] !== pack.priceMicros / 10000 ||
    value["amount_total"] !== pack.priceMicros / 10000 ||
    details["amount_discount"] !== 0 ||
    details["amount_shipping"] !== 0 ||
    details["amount_tax"] !== 0 ||
    automaticTax["enabled"] !== false ||
    (recovery !== null && recovery["enabled"] !== false) ||
    !["open", "complete", "expired"].includes(String(status)) ||
    !["paid", "unpaid"].includes(String(paymentStatus)) ||
    (paymentStatus === "paid" && status !== "complete")
  )
    return invalid();
  const payment =
    value["payment_intent"] === null
      ? null
      : reference(value["payment_intent"], "pi_");
  if (paymentStatus === "paid" && payment === null) return invalid();
  return {
    purchase,
    providerSessionReference: id,
    expiresAt: timestamp(value["expires_at"]),
    status: status as CreditTopUpSession["status"],
    paymentStatus: paymentStatus as CreditTopUpSession["paymentStatus"],
    providerPaymentReference: payment,
    paymentReview: null,
    url: status === "open" ? checkoutUrl(value["url"]) : null,
  };
}
async function verifyLineItems(
  request: StripeTopUpRequest,
  checked: CreditTopUpSession,
  configuration: StripeTopUpConfiguration,
): Promise<void> {
  const result = await request(
    "/v1/checkout/sessions/" +
      encodeURIComponent(checked.providerSessionReference) +
      "/line_items?limit=2",
    { method: "GET" },
  );
  const data = result["data"];
  if (
    result["object"] !== "list" ||
    result["has_more"] !== false ||
    !Array.isArray(data) ||
    data.length !== 1
  )
    return invalid();
  const line = object(data[0]),
    price = object(line["price"]),
    pack = packFor(checked.purchase);
  reference(price["id"], "price_");
  const mapping = configuredPrice(configuration, checked.purchase);
  if (
    mapping !== undefined &&
    (price["id"] !== mapping.priceReference ||
      price["product"] !== mapping.productReference)
  )
    invalid();
  if (
    line["object"] !== "item" ||
    line["quantity"] !== 1 ||
    line["currency"] !== "usd" ||
    line["amount_subtotal"] !== pack.priceMicros / 10000 ||
    line["amount_total"] !== pack.priceMicros / 10000 ||
    line["amount_discount"] !== 0 ||
    line["amount_tax"] !== 0 ||
    price["object"] !== "price" ||
    price["livemode"] !== (configuration.stripeEnvironment === "live") ||
    price["currency"] !== "usd" ||
    price["unit_amount"] !== pack.priceMicros / 10000 ||
    price["type"] !== "one_time" ||
    price["recurring"] !== null ||
    price["billing_scheme"] !== "per_unit"
  )
    invalid();
}
async function verifyPayment(
  request: StripeTopUpRequest,
  checked: CreditTopUpSession,
  configuration: StripeTopUpConfiguration,
): Promise<CreditTopUpSession> {
  if (checked.paymentStatus !== "paid") return checked;
  const paymentId = reference(checked.providerPaymentReference, "pi_");
  const payment = await request(
    "/v1/payment_intents/" +
      encodeURIComponent(paymentId) +
      "?expand%5B%5D=latest_charge",
    { method: "GET" },
  );
  const charge = object(payment["latest_charge"]),
    pack = packFor(checked.purchase);
  verifyMetadata(payment["metadata"], checked.purchase);
  reference(charge["id"], "ch_");
  const refunded = charge["amount_refunded"];
  if (
    payment["object"] !== "payment_intent" ||
    payment["id"] !== paymentId ||
    payment["livemode"] !== (configuration.stripeEnvironment === "live") ||
    payment["customer"] !== checked.purchase.providerCustomerReference ||
    payment["status"] !== "succeeded" ||
    payment["currency"] !== "usd" ||
    payment["amount"] !== pack.priceMicros / 10000 ||
    payment["amount_received"] !== pack.priceMicros / 10000 ||
    charge["object"] !== "charge" ||
    charge["livemode"] !== (configuration.stripeEnvironment === "live") ||
    charge["payment_intent"] !== paymentId ||
    charge["customer"] !== checked.purchase.providerCustomerReference ||
    charge["currency"] !== "usd" ||
    charge["status"] !== "succeeded" ||
    charge["paid"] !== true ||
    charge["captured"] !== true ||
    charge["amount"] !== pack.priceMicros / 10000 ||
    charge["amount_captured"] !== pack.priceMicros / 10000 ||
    typeof refunded !== "number" ||
    !Number.isSafeInteger(refunded) ||
    refunded < 0 ||
    refunded > pack.priceMicros / 10000 ||
    charge["refunded"] !== (refunded === pack.priceMicros / 10000) ||
    typeof charge["disputed"] !== "boolean"
  )
    return invalid();
  return {
    ...checked,
    paymentReview: charge["disputed"]
      ? "dispute"
      : refunded > 0
        ? "refund"
        : "clear",
  };
}
/** Fixed-host transport is supplied by the existing Stripe adapter. Amounts,
 * quantities and metadata always derive from the persisted approved policy. */
export async function createStripeTopUpSession(
  request: StripeTopUpRequest,
  input: CreateCreditTopUpSessionInput,
  configuration: StripeTopUpConfiguration = sandboxConfiguration,
): Promise<CreditTopUpSession> {
  const pack = packFor(input.purchase);
  const mapping = configuredPrice(configuration, input.purchase);
  returnUrl(input.successUrl);
  returnUrl(input.cancelUrl);
  if (
    !Number.isFinite(Date.parse(input.retryBefore)) ||
    Date.now() >= Date.parse(input.retryBefore)
  ) {
    throw new BillingApplicationError(
      "provider-unavailable",
      "The purchase attempt requires reconciliation.",
    );
  }
  const body = new URLSearchParams({
    mode: "payment",
    ui_mode: "hosted",
    "payment_method_types[0]": "card",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer: input.purchase.providerCustomerReference,
    client_reference_id: input.purchase.attemptId,
    allow_promotion_codes: "false",
    "automatic_tax[enabled]": "false",
    "after_expiration[recovery][enabled]": "false",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(pack.priceMicros / 10000),
    "line_items[0][price_data][product_data][name]":
      String(pack.creditUnits) + " Cloud Markup credits",
  });
  if (mapping !== undefined) {
    body.delete("line_items[0][price_data][currency]");
    body.delete("line_items[0][price_data][unit_amount]");
    body.delete("line_items[0][price_data][product_data][name]");
    body.set("line_items[0][price]", mapping.priceReference);
  }
  for (const [key, value] of Object.entries(metadata(input.purchase))) {
    body.set("metadata[" + key + "]", value);
    body.set("payment_intent_data[metadata][" + key + "]", value);
  }
  const result = session(
    await request("/v1/checkout/sessions", {
      method: "POST",
      body,
      idempotencyKey: "top-up:" + input.purchase.attemptId,
    }),
    input.purchase,
    configuration,
  );
  await verifyLineItems(request, result, configuration);
  return verifyPayment(request, result, configuration);
}
export async function getStripeTopUpSession(
  request: StripeTopUpRequest,
  input: {
    readonly purchase: CreditTopUpPurchase;
    readonly providerSessionReference: string;
  },
  configuration: StripeTopUpConfiguration = sandboxConfiguration,
): Promise<CreditTopUpSession> {
  packFor(input.purchase);
  configuredPrice(configuration, input.purchase);
  reference(
    input.providerSessionReference,
    configuration.stripeEnvironment === "live" ? "cs_live_" : "cs_test_",
  );
  const result = session(
    await request(
      "/v1/checkout/sessions/" +
        encodeURIComponent(input.providerSessionReference),
      { method: "GET" },
    ),
    input.purchase,
    configuration,
    input.providerSessionReference,
  );
  await verifyLineItems(request, result, configuration);
  return verifyPayment(request, result, configuration);
}
