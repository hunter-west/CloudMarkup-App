import type { BillingSubscriptionSnapshot } from "../../application/billing.js";

type JsonObject = Readonly<Record<string, unknown>>;

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function reference(value: unknown, prefix: string): string | undefined {
  const id = typeof value === "string" ? value : object(value)?.["id"];
  return typeof id === "string" &&
    id.length <= 255 &&
    id.startsWith(prefix) &&
    /^[A-Za-z0-9_]+$/.test(id)
    ? id
    : undefined;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function samePeriod(value: unknown, expected: string | null): boolean {
  return (
    nonnegativeInteger(value) &&
    value > 0 &&
    expected !== null &&
    value * 1000 === Date.parse(expected)
  );
}

/** Basil invoice line periods, not invoice.period_start/end, identify the
 * service period. A delayed event must never fund a newer retrieved period.
 * Only the reviewed single-item monthly subscription shape is supported.
 * See https://docs.stripe.com/api/invoice-line-item/object?api-version=2025-06-30.basil
 */
export function isCurrentSubscriptionInvoice(input: {
  readonly stripeEnvironment?: "test" | "live";
  readonly eventType: string;
  readonly invoice: unknown;
  readonly subscription: unknown;
  readonly snapshot: BillingSubscriptionSnapshot;
}): boolean {
  const invoice = object(input.invoice);
  const live = input.stripeEnvironment === "live";
  const subscription = object(input.subscription);
  const snapshot = input.snapshot;
  const invoiceId = reference(invoice?.["id"], "in_");
  const parent = object(invoice?.["parent"]);
  const details = object(parent?.["subscription_details"]);
  const items = object(subscription?.["items"]);
  const itemData = items?.["data"];
  const item =
    Array.isArray(itemData) && itemData.length === 1
      ? object(itemData[0])
      : undefined;
  const itemId = reference(item?.["id"], "si_");
  const price = object(item?.["price"]);
  if (
    invoiceId === undefined ||
    invoice?.["object"] !== "invoice" ||
    invoice["livemode"] !== live ||
    subscription?.["object"] !== "subscription" ||
    subscription["livemode"] !== live ||
    invoice["currency"] !== "usd" ||
    price?.["currency"] !== invoice["currency"] ||
    items?.["has_more"] !== false ||
    itemId === undefined ||
    item?.["quantity"] !== 1 ||
    reference(subscription["latest_invoice"], "in_") !== invoiceId ||
    reference(subscription["id"], "sub_") !==
      snapshot.providerSubscriptionReference ||
    reference(invoice["customer"], "cus_") !==
      snapshot.providerCustomerReference ||
    parent?.["type"] !== "subscription_details" ||
    reference(details?.["subscription"], "sub_") !==
      snapshot.providerSubscriptionReference ||
    (invoice["subscription"] !== undefined &&
      invoice["subscription"] !== null &&
      reference(invoice["subscription"], "sub_") !==
        snapshot.providerSubscriptionReference) ||
    (invoice["billing_reason"] !== "subscription_create" &&
      invoice["billing_reason"] !== "subscription_cycle") ||
    snapshot.currentPeriodId === null
  )
    return false;

  const lines = object(invoice["lines"]);
  const data = lines?.["data"];
  if (
    lines?.["object"] !== "list" ||
    lines["has_more"] !== false ||
    !Array.isArray(data) ||
    data.length !== 1
  )
    return false;
  const line = object(data[0]);
  const lineParent = object(line?.["parent"]);
  const lineDetails = object(lineParent?.["subscription_item_details"]);
  const pricing = object(line?.["pricing"]);
  const priceDetails = object(pricing?.["price_details"]);
  const period = object(line?.["period"]);
  if (
    reference(line?.["id"], "il_") === undefined ||
    line?.["object"] !== "line_item" ||
    line["livemode"] !== live ||
    line["currency"] !== invoice["currency"] ||
    !nonnegativeInteger(line["amount"]) ||
    line["quantity"] !== 1 ||
    (line["invoice"] !== undefined &&
      line["invoice"] !== null &&
      line["invoice"] !== invoiceId) ||
    lineParent?.["type"] !== "subscription_item_details" ||
    lineDetails?.["proration"] !== false ||
    reference(lineDetails["subscription"], "sub_") !==
      snapshot.providerSubscriptionReference ||
    reference(lineDetails["subscription_item"], "si_") !== itemId ||
    pricing?.["type"] !== "price_details" ||
    priceDetails?.["price"] !== snapshot.priceReference ||
    priceDetails["product"] !== snapshot.productReference ||
    !samePeriod(period?.["start"], snapshot.currentPeriodStart) ||
    !samePeriod(period?.["end"], snapshot.currentPeriodEnd)
  )
    return false;

  if (
    !nonnegativeInteger(invoice["amount_due"]) ||
    !nonnegativeInteger(invoice["amount_paid"]) ||
    !nonnegativeInteger(invoice["amount_remaining"])
  )
    return false;
  if (input.eventType === "invoice.paid") {
    return (
      invoice["status"] === "paid" &&
      invoice["amount_remaining"] === 0 &&
      subscription["status"] === "active" &&
      snapshot.normalizedStatus === "active"
    );
  }
  if (
    input.eventType === "invoice.payment_failed" ||
    input.eventType === "invoice.payment_action_required"
  ) {
    // A historical failure cannot override recovered, paused or terminal state.
    return (
      invoice["status"] === "open" &&
      invoice["amount_remaining"] > 0 &&
      (subscription["status"] === "past_due" ||
        subscription["status"] === "unpaid" ||
        subscription["status"] === "incomplete")
    );
  }
  return false;
}
