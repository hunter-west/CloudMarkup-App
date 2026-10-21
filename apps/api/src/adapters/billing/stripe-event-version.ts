import { BillingApplicationError } from "../../application/billing.js";

export const STRIPE_API_VERSION = "2025-06-30.basil" as const;
export const STRIPE_LEGACY_EVENT_VERSION = "2025-02-24.acacia" as const;
export function isReviewedStripeEventVersion(
  value: unknown,
): value is typeof STRIPE_API_VERSION | typeof STRIPE_LEGACY_EVENT_VERSION {
  return value === STRIPE_API_VERSION || value === STRIPE_LEGACY_EVENT_VERSION;
}
type JsonObject = Readonly<Record<string, unknown>>;
function invalid(): never {
  throw new BillingApplicationError(
    "invalid-provider-event",
    "The billing provider event is invalid.",
  );
}
function object(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid();
  return value as JsonObject;
}
function reference(value: unknown, prefix: string): string {
  const id = typeof value === "string" ? value : object(value)["id"];
  if (
    typeof id !== "string" ||
    id.length > 255 ||
    !id.startsWith(prefix) ||
    !/^[A-Za-z0-9_]+$/u.test(id)
  )
    invalid();
  return id;
}

/** Stripe event data retain their creation API version even when retrieved with
 * a newer Stripe-Version header. Translate only the observed exact Acacia
 * invoice shape; retain its historical line period, identities and payment
 * state. No current invoice or subscription period is substituted.
 * https://docs.stripe.com/api/events/object
 * https://docs.stripe.com/api/invoice-line-item/object?api-version=2025-02-24.acacia
 */
export function normalizeReviewedStripeEventObject(input: {
  readonly stripeEnvironment?: "test" | "live";
  readonly eventType: string;
  readonly apiVersion: unknown;
  readonly value: unknown;
}): JsonObject {
  if (!isReviewedStripeEventVersion(input.apiVersion)) invalid();
  const invoice = object(input.value);
  const live = input.stripeEnvironment === "live";
  if (
    input.apiVersion === STRIPE_API_VERSION ||
    !input.eventType.startsWith("invoice.")
  )
    return invoice;
  if (invoice["object"] !== "invoice" || invoice["livemode"] !== live)
    invalid();
  const subscription = reference(invoice["subscription"], "sub_");
  const lines = object(invoice["lines"]),
    data = lines["data"];
  if (
    lines["object"] !== "list" ||
    lines["has_more"] !== false ||
    !Array.isArray(data) ||
    data.length !== 1
  )
    invalid();
  const line = object(data[0]),
    price = object(line["price"]);
  if (
    line["type"] !== "subscription" ||
    line["object"] !== "line_item" ||
    line["livemode"] !== live ||
    line["proration"] !== false ||
    reference(line["subscription"], "sub_") !== subscription ||
    price["object"] !== "price" ||
    price["livemode"] !== live ||
    price["currency"] !== line["currency"]
  )
    invalid();
  const subscriptionItem = reference(line["subscription_item"], "si_");
  const priceId = reference(price["id"], "price_");
  const product = reference(price["product"], "prod_");
  // The observed Acacia event also included additive Basil fields. Accept
  // those only when every identity agrees with its historical legacy field.
  if (invoice["parent"] !== undefined && invoice["parent"] !== null) {
    const parent = object(invoice["parent"]);
    const details = object(parent["subscription_details"]);
    if (
      parent["type"] !== "subscription_details" ||
      reference(details["subscription"], "sub_") !== subscription
    )
      invalid();
  }
  if (line["parent"] !== undefined && line["parent"] !== null) {
    const parent = object(line["parent"]);
    const details = object(parent["subscription_item_details"]);
    if (
      parent["type"] !== "subscription_item_details" ||
      reference(details["subscription"], "sub_") !== subscription ||
      reference(details["subscription_item"], "si_") !== subscriptionItem ||
      details["proration"] !== false
    )
      invalid();
  }
  if (line["pricing"] !== undefined && line["pricing"] !== null) {
    const pricing = object(line["pricing"]);
    const details = object(pricing["price_details"]);
    if (
      pricing["type"] !== "price_details" ||
      reference(details["price"], "price_") !== priceId ||
      reference(details["product"], "prod_") !== product
    )
      invalid();
  }
  return {
    ...invoice,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription },
    },
    lines: {
      ...lines,
      data: [
        {
          ...line,
          parent: {
            type: "subscription_item_details",
            subscription_item_details: {
              subscription,
              subscription_item: subscriptionItem,
              proration: line["proration"],
            },
          },
          pricing: {
            type: "price_details",
            price_details: {
              price: priceId,
              product,
            },
          },
        },
      ],
    },
  };
}
