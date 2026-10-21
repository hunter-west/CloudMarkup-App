import { isStripeApiKeyForEnvironment } from "./stripe-mode.js";
import { REVIEWED_LIVE_STRIPE } from "./reviewed-live-plans.js";
import {
  createStripeTopUpSession,
  getStripeTopUpSession,
} from "./stripe-top-ups.js";
import type { CreditTopUpProvider } from "../../application/billing-top-ups.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  billingDeliveryEnvironment,
  BILLING_CONFIGURATION_VERSION,
  BILLING_WEBHOOK_EVENT_TYPES,
  parseBillingWebhookDelivery,
  BillingApplicationError,
  type BillingProjectionState,
  type BillingProvider,
  type BillingSubscriptionSnapshot,
  type CreateHostedCheckoutInput,
  type CreateHostedPortalInput,
  type HostedBillingSession,
  type StripeEnvironment,
  type VerifiedBillingWebhookEvent,
  type BillingWebhookDelivery,
} from "../../application/billing.js";
import { isCurrentSubscriptionInvoice } from "./stripe-invoice-period.js";
import {
  STRIPE_API_VERSION,
  isReviewedStripeEventVersion,
  normalizeReviewedStripeEventObject,
} from "./stripe-event-version.js";
import type { BillingCheckoutSession } from "../../application/billing-checkout.js";

export { STRIPE_API_VERSION } from "./stripe-event-version.js";

export type StripeFetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface StripeBillingProviderInput {
  readonly apiKey: string;
  readonly fetchImplementation?: StripeFetchImplementation;
  readonly previousWebhookSigningSecret?: string;
  readonly signatureToleranceSeconds: number;
  readonly stripeEnvironment?: StripeEnvironment;
  readonly webhookSigningSecret?: string;
  readonly verificationMode?:
    "signed-webhook" | "queued-events-only" | "hosted-sessions-only";
}

type JsonObject = Readonly<Record<string, unknown>>;

function invalidProviderEvent(): never {
  throw new BillingApplicationError(
    "invalid-provider-event",
    "The billing provider event is invalid.",
  );
}

function unavailable(): never {
  throw new BillingApplicationError(
    "provider-unavailable",
    "The billing provider is unavailable.",
  );
}

function asObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidProviderEvent();
  }
  return value as JsonObject;
}

function optionalObject(value: unknown): JsonObject | undefined {
  return value === undefined || value === null ? undefined : asObject(value);
}

function stringField(object: JsonObject, key: string, pattern: RegExp): string {
  const value = object[key];
  if (typeof value !== "string" || value.length > 255 || !pattern.test(value)) {
    return invalidProviderEvent();
  }
  return value;
}

function optionalStringField(
  object: JsonObject,
  key: string,
  pattern: RegExp,
): string | undefined {
  const value = object[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > 255 || !pattern.test(value)) {
    return invalidProviderEvent();
  }
  return value;
}

function identifierFromExpandable(
  value: unknown,
  prefix: "cus_" | "prod_",
): string {
  if (typeof value === "string") {
    if (
      value.length > 255 ||
      !value.startsWith(prefix) ||
      !/^[A-Za-z0-9_]+$/.test(value)
    ) {
      return invalidProviderEvent();
    }
    return value;
  }
  const object = asObject(value);
  return stringField(
    object,
    "id",
    prefix === "cus_" ? /^cus_[A-Za-z0-9_]+$/ : /^prod_[A-Za-z0-9_]+$/,
  );
}

function unixSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalidProviderEvent();
  }
  return value;
}

function isoFromUnixSeconds(value: unknown): string {
  const date = new Date(unixSeconds(value) * 1000);
  if (!Number.isFinite(date.getTime())) return invalidProviderEvent();
  return date.toISOString();
}

function secureEqual(left: Buffer, right: Buffer): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function signatureParts(header: string): {
  readonly timestamp: number;
  readonly signatures: readonly Buffer[];
} {
  const fields = header.split(",").map((field) => field.trim());
  const timestamps = fields
    .filter((field) => field.startsWith("t="))
    .map((field) => field.slice(2));
  const signatureValues = fields
    .filter((field) => field.startsWith("v1="))
    .map((field) => field.slice(3));
  if (
    timestamps.length !== 1 ||
    !/^\d+$/.test(timestamps[0] ?? "") ||
    signatureValues.length < 1
  ) {
    return invalidProviderEvent();
  }
  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp)) return invalidProviderEvent();
  const signatures = signatureValues.map((value) => {
    if (!/^[0-9a-f]{64}$/i.test(value)) return invalidProviderEvent();
    return Buffer.from(value, "hex");
  });
  return { signatures, timestamp };
}

function supportedEventType(value: string): boolean {
  return (BILLING_WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

function hostedUrl(value: unknown, expectedHost: string): HostedBillingSession {
  if (
    typeof value !== "string" ||
    value.length > 4_096 ||
    Array.from(value).some(
      (character) =>
        character.charCodeAt(0) <= 32 ||
        character.charCodeAt(0) === 127 ||
        character === "\\",
    )
  )
    return unavailable();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return unavailable();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== expectedHost ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return unavailable();
  }
  return { url: parsed.toString() };
}

function addMetadata(
  form: URLSearchParams,
  prefix: string,
  input: {
    readonly billingAccountId: string;
    readonly organizationId: string;
    readonly planKey: string;
  },
): void {
  form.set(prefix + "[cloudmarkup_organization_id]", input.organizationId);
  form.set(prefix + "[cloudmarkup_billing_account_id]", input.billingAccountId);
  form.set(
    prefix + "[cloudmarkup_configuration_version]",
    BILLING_CONFIGURATION_VERSION,
  );
  form.set(prefix + "[cloudmarkup_plan_key]", input.planKey);
}

function subscriptionReferenceFromEvent(
  eventType: string,
  object: JsonObject,
): string | JsonObject | null {
  if (eventType.startsWith("customer.subscription.")) return object;
  if (eventType === "checkout.session.completed") {
    const subscription = object["subscription"];
    return typeof subscription === "string" ||
      (typeof subscription === "object" && subscription !== null)
      ? (subscription as string | JsonObject)
      : null;
  }
  if (eventType.startsWith("invoice.")) {
    const direct = object["subscription"];
    if (
      typeof direct === "string" ||
      (typeof direct === "object" && direct !== null)
    ) {
      return direct as string | JsonObject;
    }
    const parent = optionalObject(object["parent"]);
    const details = optionalObject(parent?.["subscription_details"]);
    const nested = details?.["subscription"];
    if (
      typeof nested === "string" ||
      (typeof nested === "object" && nested !== null)
    ) {
      return nested as string | JsonObject;
    }
  }
  return null;
}

function normalizeStatus(status: string): BillingProjectionState | null {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past-due";
    case "paused":
      return "paused";
    case "canceled":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
      return "incomplete";
    default:
      return null;
  }
}

/** Shared by authenticated ingress and the queue consumer so FIFO ordering
 * uses the same subscription identity for expanded and Basil invoice events. */
export function stripeBillingWebhookObjectReference(
  eventType: string,
  value: unknown,
): string {
  const object = asObject(value);
  const subscription = subscriptionReferenceFromEvent(eventType, object);
  const reference =
    typeof subscription === "string"
      ? subscription
      : subscription === null
        ? object["id"]
        : subscription["id"];
  if (
    typeof reference !== "string" ||
    reference.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(reference)
  )
    return invalidProviderEvent();
  return reference;
}

/** Call only after checking the exact wire-body signature. The raw body is
 * reduced to bounded, versioned delivery metadata, never queued or logged. */
export function parseStripeBillingWebhookDelivery(input: {
  readonly stripeEnvironment?: StripeEnvironment;
  readonly rawBody: Uint8Array;
  readonly planMappingVersion: string;
  readonly signatureSecretVersion: "current" | "previous";
  readonly webhookEndpointVersion: string;
}): BillingWebhookDelivery | null {
  if (input.rawBody.byteLength > 256 * 1024) return invalidProviderEvent();
  const event = asObject(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody)),
  );
  const providerEventReference = stringField(
    event,
    "id",
    /^evt_[A-Za-z0-9_]+$/,
  );
  const eventType = stringField(
    event,
    "type",
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/,
  );
  const created = unixSeconds(event["created"]);
  if (
    created < 1 ||
    !Number.isFinite(new Date(created * 1000).getTime()) ||
    event["object"] !== "event" ||
    event["livemode"] !== (input.stripeEnvironment === "live") ||
    !isReviewedStripeEventVersion(event["api_version"])
  )
    return invalidProviderEvent();
  if (!supportedEventType(eventType)) return null;
  return parseBillingWebhookDelivery({
    ...(input.stripeEnvironment === "live"
      ? { contractVersion: 2, stripeEnvironment: "live" }
      : { contractVersion: 1 }),
    created,
    eventPosition:
      created.toString().padStart(20, "0") + ":" + providerEventReference,
    eventType,
    objectReference: stripeBillingWebhookObjectReference(
      eventType,
      asObject(event["data"])["object"],
    ),
    payloadSha256: createHash("sha256").update(input.rawBody).digest("hex"),
    planMappingVersion: input.planMappingVersion,
    providerApiVersion: event["api_version"],
    providerEventReference,
    signatureSecretVersion: input.signatureSecretVersion,
    webhookEndpointVersion: input.webhookEndpointVersion,
  });
}

function subscriptionSnapshot(
  value: unknown,
  environment: StripeEnvironment = "test",
): BillingSubscriptionSnapshot | null {
  const subscription = asObject(value);
  const subscriptionId = stringField(subscription, "id", /^sub_[A-Za-z0-9_]+$/);
  const customerReference = identifierFromExpandable(
    subscription["customer"],
    "cus_",
  );
  const metadata = optionalObject(subscription["metadata"]) ?? {};
  const organizationId =
    optionalStringField(
      metadata,
      "cloudmarkup_organization_id",
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
    ) ?? null;
  const billingAccountId =
    optionalStringField(
      metadata,
      "cloudmarkup_billing_account_id",
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
    ) ?? null;
  const statusValue = subscription["status"];
  if (typeof statusValue !== "string") return null;
  const normalizedStatus = normalizeStatus(statusValue);
  if (
    normalizedStatus === null ||
    (subscription["trial_end"] !== undefined &&
      subscription["trial_end"] !== null)
  ) {
    return null;
  }

  const items = asObject(subscription["items"]);
  const data = items["data"];
  if (!Array.isArray(data) || data.length !== 1) return null;
  const item = asObject(data[0]);
  if (item["quantity"] !== 1) return null;
  const price = asObject(item["price"]);
  const priceReference = stringField(price, "id", /^price_[A-Za-z0-9_]+$/);
  const productReference = identifierFromExpandable(price["product"], "prod_");
  const recurring = optionalObject(price["recurring"]);
  if (environment === "live") {
    const plan = [REVIEWED_LIVE_STRIPE.starter, REVIEWED_LIVE_STRIPE.pro].find(
      (p) =>
        p.priceReference === priceReference &&
        p.productReference === productReference,
    );
    if (
      !plan ||
      price["object"] !== "price" ||
      price["livemode"] !== true ||
      price["currency"] !== "usd" ||
      price["type"] !== "recurring" ||
      price["unit_amount"] !==
        (plan === REVIEWED_LIVE_STRIPE.starter ? 900 : 3900) ||
      recurring?.["interval_count"] !== 1 ||
      recurring["usage_type"] !== "licensed"
    )
      return null;
  }
  if (
    recurring?.["interval"] !== "month" ||
    (recurring["interval_count"] !== undefined &&
      recurring["interval_count"] !== 1)
  ) {
    return null;
  }

  const periodStartValue =
    item["current_period_start"] ?? subscription["current_period_start"];
  const periodEndValue =
    item["current_period_end"] ?? subscription["current_period_end"];
  const bothAbsent =
    (periodStartValue === undefined || periodStartValue === null) &&
    (periodEndValue === undefined || periodEndValue === null);
  const bothPresent =
    periodStartValue !== undefined &&
    periodStartValue !== null &&
    periodEndValue !== undefined &&
    periodEndValue !== null;
  if (!bothAbsent && !bothPresent) return null;

  let currentPeriodStart: string | null = null;
  let currentPeriodEnd: string | null = null;
  let currentPeriodId: string | null = null;
  if (bothPresent) {
    const startSeconds = unixSeconds(periodStartValue);
    const endSeconds = unixSeconds(periodEndValue);
    if (endSeconds <= startSeconds) return null;
    currentPeriodStart = isoFromUnixSeconds(startSeconds);
    currentPeriodEnd = isoFromUnixSeconds(endSeconds);
    const digest = createHash("sha256")
      .update(
        subscriptionId +
          "\u001f" +
          startSeconds.toString() +
          "\u001f" +
          endSeconds.toString(),
      )
      .digest("hex")
      .slice(0, 40);
    currentPeriodId = "period_" + digest;
  }

  const cancelAtPeriodEnd = subscription["cancel_at_period_end"];
  if (typeof cancelAtPeriodEnd !== "boolean") return null;

  return {
    billableSeatQuantity: 1,
    billingAccountId,
    cancelAtPeriodEnd,
    currentPeriodEnd,
    currentPeriodId,
    currentPeriodStart,
    normalizedStatus,
    organizationId,
    priceReference,
    productReference,
    providerCustomerReference: customerReference,
    providerSubscriptionReference: subscriptionId,
  };
}

export class StripeBillingProvider implements BillingProvider {
  readonly #apiKey: string;
  readonly #stripeEnvironment: StripeEnvironment;
  readonly #queuedEventsOnly: boolean;
  readonly #hostedSessionsOnly: boolean;
  readonly #fetch: StripeFetchImplementation;
  readonly #signatureToleranceSeconds: number;
  readonly #webhookSigningSecrets: readonly Readonly<{
    secret: string;
    version: "current" | "previous";
  }>[];

  constructor(input: StripeBillingProviderInput) {
    const stripeEnvironment = input.stripeEnvironment ?? "test";
    const verificationMode = input.verificationMode ?? "signed-webhook";
    if (!["test", "live"].includes(stripeEnvironment)) {
      throw new BillingApplicationError(
        "billing-disabled",
        "The Stripe environment is invalid.",
      );
    }
    if (
      !isStripeApiKeyForEnvironment(input.apiKey, stripeEnvironment) ||
      ![
        "signed-webhook",
        "queued-events-only",
        "hosted-sessions-only",
      ].includes(verificationMode) ||
      (verificationMode === "signed-webhook" &&
        (input.webhookSigningSecret === undefined ||
          !/^whsec_[A-Za-z0-9_]+$/.test(input.webhookSigningSecret))) ||
      (verificationMode !== "signed-webhook" &&
        (input.webhookSigningSecret !== undefined ||
          input.previousWebhookSigningSecret !== undefined)) ||
      (input.previousWebhookSigningSecret !== undefined &&
        (!/^whsec_[A-Za-z0-9_]+$/.test(input.previousWebhookSigningSecret) ||
          input.previousWebhookSigningSecret === input.webhookSigningSecret)) ||
      !Number.isInteger(input.signatureToleranceSeconds) ||
      input.signatureToleranceSeconds < 60 ||
      input.signatureToleranceSeconds > 900
    ) {
      throw new BillingApplicationError(
        "invalid-billing-configuration",
        "Stripe configuration is invalid.",
      );
    }
    this.#apiKey = input.apiKey;
    this.#stripeEnvironment = stripeEnvironment;
    this.#queuedEventsOnly = verificationMode === "queued-events-only";
    this.#hostedSessionsOnly = verificationMode === "hosted-sessions-only";
    this.#fetch = input.fetchImplementation ?? fetch;
    this.#signatureToleranceSeconds = input.signatureToleranceSeconds;
    this.#webhookSigningSecrets = Object.freeze([
      ...(input.webhookSigningSecret === undefined
        ? []
        : [
            Object.freeze({
              secret: input.webhookSigningSecret,
              version: "current" as const,
            }),
          ]),
      ...(input.previousWebhookSigningSecret === undefined
        ? []
        : [
            Object.freeze({
              secret: input.previousWebhookSigningSecret,
              version: "previous" as const,
            }),
          ]),
    ]);
  }

  async #request(
    path: string,
    init: {
      readonly body?: URLSearchParams;
      readonly idempotencyKey?: string;
      readonly method: "GET" | "POST";
    },
  ): Promise<JsonObject> {
    let response: Response;
    try {
      response = await this.#fetch("https://api.stripe.com" + path, {
        ...(init.body === undefined ? {} : { body: init.body }),
        headers: {
          authorization: "Bearer " + this.#apiKey,
          "stripe-version": STRIPE_API_VERSION,
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/x-www-form-urlencoded" }),
          ...(init.idempotencyKey === undefined
            ? {}
            : { "idempotency-key": init.idempotencyKey }),
        },
        method: init.method,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return unavailable();
    }
    if (!response.ok) return unavailable();
    let payload: unknown;
    try {
      const reader = response.body?.getReader() as
        ReadableStreamDefaultReader<unknown> | undefined;
      if (reader === undefined) return unavailable();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          if (!(next.value instanceof Uint8Array)) return unavailable();
          size += next.value.byteLength;
          if (size > 256 * 1024) {
            await reader.cancel();
            return unavailable();
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      payload = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      return unavailable();
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    ) {
      return unavailable();
    }
    return payload as JsonObject;
  }

  async createCheckoutSession(
    input: CreateHostedCheckoutInput,
  ): Promise<BillingCheckoutSession> {
    if (this.#queuedEventsOnly)
      throw new BillingApplicationError(
        "billing-disabled",
        "Hosted billing sessions are disabled in this runtime.",
      );
    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("ui_mode", "hosted");
    form.set("success_url", input.successUrl);
    form.set("cancel_url", input.cancelUrl);
    form.set("line_items[0][price]", input.plan.priceReference);
    form.set("line_items[0][quantity]", "1");
    form.set("client_reference_id", input.billingAccountId);
    form.set("allow_promotion_codes", "false");
    form.set("after_expiration[recovery][enabled]", "false");
    if (input.existingProviderCustomerReference !== undefined) {
      form.set("customer", input.existingProviderCustomerReference);
    }
    const metadata = {
      billingAccountId: input.billingAccountId,
      organizationId: input.organizationId,
      planKey: input.plan.planKey,
    } as const;
    addMetadata(form, "metadata", metadata);
    addMetadata(form, "subscription_data[metadata]", metadata);
    if (
      input.retryBefore !== undefined &&
      (!Number.isFinite(Date.parse(input.retryBefore)) ||
        Date.now() >= Date.parse(input.retryBefore))
    )
      return unavailable();
    const response = await this.#request("/v1/checkout/sessions", {
      body: form,
      idempotencyKey: input.idempotencyKey,
      method: "POST",
    });
    return this.#checkoutSession(response, {
      billingAccountId: input.billingAccountId,
      organizationId: input.organizationId,
      ...(input.existingProviderCustomerReference === undefined
        ? {}
        : {
            expectedProviderCustomerReference:
              input.existingProviderCustomerReference,
          }),
      expectedPlanKey: input.plan.planKey,
    });
  }

  #checkoutSession(
    response: JsonObject,
    input: {
      readonly billingAccountId: string;
      readonly expectedPlanKey?: string;
      readonly expectedProviderCustomerReference?: string;
      readonly organizationId: string;
      readonly providerSessionReference?: string;
    },
  ): BillingCheckoutSession {
    const reference = stringField(response, "id", /^cs_[A-Za-z0-9_]+$/u);
    const metadata = asObject(response["metadata"]);
    const status = response["status"];
    const recovery = optionalObject(
      optionalObject(response["after_expiration"])?.["recovery"],
    );
    if (
      response["object"] !== "checkout.session" ||
      response["livemode"] !== (this.#stripeEnvironment === "live") ||
      response["mode"] !== "subscription" ||
      response["client_reference_id"] !== input.billingAccountId ||
      metadata["cloudmarkup_organization_id"] !== input.organizationId ||
      metadata["cloudmarkup_billing_account_id"] !== input.billingAccountId ||
      metadata["cloudmarkup_configuration_version"] !==
        BILLING_CONFIGURATION_VERSION ||
      !["starter", "pro"].includes(String(metadata["cloudmarkup_plan_key"])) ||
      (input.expectedPlanKey !== undefined &&
        metadata["cloudmarkup_plan_key"] !== input.expectedPlanKey) ||
      (input.providerSessionReference !== undefined &&
        reference !== input.providerSessionReference) ||
      (input.expectedProviderCustomerReference !== undefined &&
        response["customer"] !== input.expectedProviderCustomerReference) ||
      (recovery !== undefined && recovery["enabled"] !== false) ||
      !["open", "complete", "expired"].includes(String(status))
    )
      return invalidProviderEvent();
    const subscription =
      response["subscription"] === null
        ? null
        : stringField(response, "subscription", /^sub_[A-Za-z0-9_]+$/u);
    if ((status === "complete") !== (subscription !== null))
      return invalidProviderEvent();
    return {
      billingAccountId: input.billingAccountId,
      expiresAt: isoFromUnixSeconds(response["expires_at"]),
      organizationId: input.organizationId,
      providerSessionReference: reference,
      providerSubscriptionReference: subscription,
      status: status as BillingCheckoutSession["status"],
      url:
        status === "open"
          ? hostedUrl(response["url"], "checkout.stripe.com").url
          : null,
    };
  }

  async getCheckoutSession(input: {
    readonly billingAccountId: string;
    readonly expectedPlanKey?: "starter" | "pro";
    readonly expectedProviderCustomerReference?: string;
    readonly organizationId: string;
    readonly providerSessionReference: string;
  }): Promise<BillingCheckoutSession> {
    if (this.#queuedEventsOnly)
      throw new BillingApplicationError(
        "billing-disabled",
        "Hosted billing sessions are disabled in this runtime.",
      );
    if (!/^cs_[A-Za-z0-9_]{1,250}$/u.test(input.providerSessionReference))
      return invalidProviderEvent();
    return this.#checkoutSession(
      await this.#request(
        "/v1/checkout/sessions/" +
          encodeURIComponent(input.providerSessionReference),
        { method: "GET" },
      ),
      input,
    );
  }

  createCreditTopUpSession: CreditTopUpProvider["createCreditTopUpSession"] = (
    input,
  ) => {
    if (this.#queuedEventsOnly)
      throw new BillingApplicationError(
        "billing-disabled",
        "Hosted billing sessions are disabled in this runtime.",
      );
    return createStripeTopUpSession(
      (path, init) => this.#request(path, init),
      input,
      {
        stripeEnvironment: this.#stripeEnvironment,
        ...(this.#stripeEnvironment === "live"
          ? { prices: REVIEWED_LIVE_STRIPE.topUps }
          : {}),
      },
    );
  };

  getCreditTopUpSession: CreditTopUpProvider["getCreditTopUpSession"] = (
    input,
  ) =>
    getStripeTopUpSession((path, init) => this.#request(path, init), input, {
      stripeEnvironment: this.#stripeEnvironment,
      ...(this.#stripeEnvironment === "live"
        ? { prices: REVIEWED_LIVE_STRIPE.topUps }
        : {}),
    });

  async createPortalSession(
    input: CreateHostedPortalInput,
  ): Promise<HostedBillingSession> {
    if (this.#queuedEventsOnly)
      throw new BillingApplicationError(
        "billing-disabled",
        "Hosted billing sessions are disabled in this runtime.",
      );
    const form = new URLSearchParams();
    form.set("customer", input.providerCustomerReference);
    form.set("return_url", input.returnUrl);
    if (input.portalConfigurationReference !== undefined) {
      form.set("configuration", input.portalConfigurationReference);
    }
    const response = await this.#request("/v1/billing_portal/sessions", {
      body: form,
      idempotencyKey: input.idempotencyKey,
      method: "POST",
    });
    return hostedUrl(response["url"], "billing.stripe.com");
  }

  verifyWebhook(input: {
    readonly now: Date;
    readonly rawBody: Uint8Array;
    readonly signatureHeader: string | undefined;
  }): Promise<VerifiedBillingWebhookEvent> {
    if (this.#hostedSessionsOnly || this.#queuedEventsOnly)
      return Promise.reject(
        new BillingApplicationError(
          "billing-disabled",
          "Webhook verification is disabled in this runtime.",
        ),
      );
    if (input.signatureHeader === undefined) {
      return Promise.reject(
        new BillingApplicationError(
          "invalid-provider-event",
          "The billing provider event is invalid.",
        ),
      );
    }
    try {
      const parts = signatureParts(input.signatureHeader);
      if (input.rawBody.byteLength > 256 * 1024) return invalidProviderEvent();
      const nowSeconds = Math.floor(input.now.getTime() / 1000);
      if (
        !Number.isFinite(nowSeconds) ||
        Math.abs(nowSeconds - parts.timestamp) > this.#signatureToleranceSeconds
      ) {
        return invalidProviderEvent();
      }

      const signedPayload = Buffer.concat([
        Buffer.from(parts.timestamp.toString() + ".", "utf8"),
        Buffer.from(
          input.rawBody.buffer,
          input.rawBody.byteOffset,
          input.rawBody.byteLength,
        ),
      ]);
      const signatureSecretVersion = this.#webhookSigningSecrets.find(
        ({ secret }) => {
          const expected = createHmac("sha256", secret)
            .update(signedPayload)
            .digest();
          return parts.signatures.some((signature) =>
            secureEqual(signature, expected),
          );
        },
      )?.version;
      if (signatureSecretVersion === undefined) {
        return invalidProviderEvent();
      }

      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        input.rawBody,
      );
      const event = asObject(JSON.parse(decoded) as unknown);
      if (
        event["object"] !== "event" ||
        event["livemode"] !== (this.#stripeEnvironment === "live") ||
        !isReviewedStripeEventVersion(event["api_version"])
      )
        return invalidProviderEvent();
      const providerEventReference = stringField(
        event,
        "id",
        /^evt_[A-Za-z0-9_]+$/,
      );
      const eventType = stringField(
        event,
        "type",
        /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/,
      );
      const created = unixSeconds(event["created"]);
      if (created < 1) return invalidProviderEvent();
      const data = asObject(event["data"]);
      const providerEventData = supportedEventType(eventType)
        ? normalizeReviewedStripeEventObject({
            eventType,
            apiVersion: event["api_version"],
            value: data["object"],
            stripeEnvironment: this.#stripeEnvironment,
          })
        : asObject(data["object"]);
      return Promise.resolve({
        eventPosition:
          created.toString().padStart(20, "0") + ":" + providerEventReference,
        eventType,
        occurredAt: isoFromUnixSeconds(created),
        payloadSha256: createHash("sha256").update(input.rawBody).digest("hex"),
        providerEventData,
        providerEventReference,
        signatureSecretVersion,
        supported: supportedEventType(eventType),
      });
    } catch (error) {
      return Promise.reject(
        error instanceof BillingApplicationError
          ? error
          : new BillingApplicationError(
              "invalid-provider-event",
              "The billing provider event is invalid.",
            ),
      );
    }
  }

  async resolveSubscriptionSnapshot(
    event: VerifiedBillingWebhookEvent,
  ): Promise<BillingSubscriptionSnapshot | null> {
    if (this.#hostedSessionsOnly)
      throw new BillingApplicationError(
        "billing-disabled",
        "Subscription event processing is disabled in this runtime.",
      );
    const object = asObject(event.providerEventData);
    const reference = subscriptionReferenceFromEvent(event.eventType, object);
    if (reference === null) return null;
    const isInvoice = event.eventType.startsWith("invoice.");
    const isSubscriptionEvent = event.eventType.startsWith(
      "customer.subscription.",
    );
    const historical = isSubscriptionEvent
      ? subscriptionSnapshot(reference, this.#stripeEnvironment)
      : null;
    if (isSubscriptionEvent && historical === null) return null;
    const subscriptionId =
      typeof reference === "string" ? reference : reference["id"];
    if (
      typeof subscriptionId !== "string" ||
      subscriptionId.length > 255 ||
      !/^sub_[A-Za-z0-9_]+$/.test(subscriptionId)
    )
      return null;
    const subscription = await this.#request(
      "/v1/subscriptions/" + encodeURIComponent(subscriptionId),
      { method: "GET" },
    );
    // Event snapshots are historical, and Stripe created seconds/event IDs are
    // not a causal sequence. Refresh even expanded checkout/subscription data.
    // Preserve the event proof, but never use stale status as current authority.
    // https://docs.stripe.com/webhooks#event-ordering
    const snapshot = subscriptionSnapshot(
      subscription,
      this.#stripeEnvironment,
    );
    if (
      snapshot?.providerSubscriptionReference !== subscriptionId ||
      subscription["object"] !== "subscription" ||
      subscription["livemode"] !== (this.#stripeEnvironment === "live") ||
      (historical !== null &&
        (historical.providerCustomerReference !==
          snapshot.providerCustomerReference ||
          historical.organizationId !== snapshot.organizationId ||
          historical.billingAccountId !== snapshot.billingAccountId)) ||
      (event.eventType === "customer.subscription.deleted" &&
        (historical?.normalizedStatus !== "canceled" ||
          snapshot.normalizedStatus !== "canceled")) ||
      (isInvoice &&
        !isCurrentSubscriptionInvoice({
          eventType: event.eventType,
          invoice: object,
          stripeEnvironment: this.#stripeEnvironment,
          snapshot,
          subscription,
        }))
    )
      return null;
    return snapshot;
  }

  refreshSubscriptionSnapshot(
    event: VerifiedBillingWebhookEvent,
  ): Promise<BillingSubscriptionSnapshot | null> {
    return this.resolveSubscriptionSnapshot(event);
  }

  async retrieveQueuedWebhook(
    input: BillingWebhookDelivery,
  ): Promise<VerifiedBillingWebhookEvent> {
    if (this.#hostedSessionsOnly)
      throw new BillingApplicationError(
        "billing-disabled",
        "Subscription event processing is disabled in this runtime.",
      );
    const delivery = parseBillingWebhookDelivery(input);
    if (billingDeliveryEnvironment(delivery) !== this.#stripeEnvironment)
      return invalidProviderEvent();
    if (!isReviewedStripeEventVersion(delivery.providerApiVersion))
      return invalidProviderEvent();
    const event = await this.#request(
      "/v1/events/" + encodeURIComponent(delivery.providerEventReference),
      { method: "GET" },
    );
    if (
      event["id"] !== delivery.providerEventReference ||
      event["object"] !== "event" ||
      event["livemode"] !== (this.#stripeEnvironment === "live") ||
      !isReviewedStripeEventVersion(event["api_version"]) ||
      event["created"] !== delivery.created ||
      event["type"] !== delivery.eventType
    ) {
      return invalidProviderEvent();
    }
    const object = asObject(asObject(event["data"])["object"]);
    const reference = stripeBillingWebhookObjectReference(
      delivery.eventType,
      object,
    );
    if (reference !== delivery.objectReference) return invalidProviderEvent();
    return {
      eventPosition: delivery.eventPosition,
      eventType: delivery.eventType,
      occurredAt: isoFromUnixSeconds(delivery.created),
      payloadSha256: delivery.payloadSha256,
      // Stored events retain their original API version; an endpoint may have
      // rendered the signed delivery at a newer reviewed version. Event and
      // subscription identities above must still match exactly.
      providerEventData: normalizeReviewedStripeEventObject({
        eventType: delivery.eventType,
        apiVersion: event["api_version"],
        value: object,
        stripeEnvironment: this.#stripeEnvironment,
      }),
      providerEventReference: delivery.providerEventReference,
      signatureSecretVersion: delivery.signatureSecretVersion,
      supported: true,
    };
  }
}
