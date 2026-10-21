import { createHash, createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  BILLING_PLAN_MAPPING_VERSION,
  BILLING_WEBHOOK_ENDPOINT_VERSION,
  BILLING_WEBHOOK_EVENT_TYPES,
} from "../../application/billing.js";
import {
  parseStripeBillingWebhookDelivery,
  STRIPE_API_VERSION,
  StripeBillingProvider,
} from "./stripe-billing-provider.js";
import { STRIPE_LEGACY_EVENT_VERSION } from "./stripe-event-version.js";

const created = 1_788_350_400;
function event(
  type = "customer.subscription.updated",
  object: unknown = { id: "sub_delivery" },
) {
  return {
    api_version: STRIPE_API_VERSION,
    created,
    data: { object },
    id: "evt_delivery",
    livemode: false,
    object: "event",
    type,
  };
}
function delivery(value: unknown) {
  return parseStripeBillingWebhookDelivery({
    rawBody: Buffer.from(JSON.stringify(value)),
    planMappingVersion: BILLING_PLAN_MAPPING_VERSION,
    signatureSecretVersion: "current",
    webhookEndpointVersion: BILLING_WEBHOOK_ENDPOINT_VERSION,
  });
}
function provider(value: unknown) {
  const request = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(value)));
  return {
    request,
    adapter: new StripeBillingProvider({
      apiKey: "sk_test_delivery_fixture",
      webhookSigningSecret: "whsec_delivery_fixture",
      signatureToleranceSeconds: 300,
      fetchImplementation: request,
    }),
  };
}

describe("versioned Stripe delivery round trip", () => {
  it.each([STRIPE_API_VERSION, STRIPE_LEGACY_EVENT_VERSION])(
    "preserves signed %s delivery provenance when Stripe retrieves an older stored event",
    async (apiVersion) => {
      const original = { ...event(), api_version: apiVersion };
      const rawBody = Buffer.from(JSON.stringify(original));
      const signature = createHmac("sha256", "whsec_delivery_fixture")
        .update(created.toString() + ".")
        .update(rawBody)
        .digest("hex");
      const stored = { ...original, api_version: STRIPE_LEGACY_EVENT_VERSION };
      const { adapter } = provider(stored);
      await expect(
        adapter.verifyWebhook({
          rawBody,
          now: new Date(created * 1000),
          signatureHeader: "t=" + created.toString() + ",v1=" + signature,
        }),
      ).resolves.toMatchObject({
        supported: true,
        providerEventReference: original.id,
      });
      const message = delivery(original);
      expect(message?.providerApiVersion).toBe(apiVersion);
      if (message === null) throw new Error("Expected supported delivery");
      await expect(
        adapter.retrieveQueuedWebhook(message),
      ).resolves.toMatchObject({
        providerEventReference: original.id,
        providerEventData: original.data.object,
        payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
      });
      await expect(
        adapter.verifyWebhook({
          rawBody: Buffer.from(
            JSON.stringify({ ...original, id: "evt_tampered" }),
          ),
          now: new Date(created * 1000),
          signatureHeader: "t=" + created.toString() + ",v1=" + signature,
        }),
      ).rejects.toMatchObject({ code: "invalid-provider-event" });
    },
  );
  it.each(BILLING_WEBHOOK_EVENT_TYPES)(
    "binds %s to its verified original envelope",
    async (type) => {
      const subscription =
        type.startsWith("customer.subscription.") ||
        type.startsWith("invoice.") ||
        type === "checkout.session.completed";
      const object = type.startsWith("customer.subscription.")
        ? { id: "sub_delivery" }
        : subscription
          ? { id: "obj_delivery", subscription: "sub_delivery" }
          : { id: "obj_delivery" };
      const source = event(type, object);
      const message = delivery(source);
      expect(message).toMatchObject({
        contractVersion: 1,
        objectReference: subscription ? "sub_delivery" : "obj_delivery",
        providerApiVersion: STRIPE_API_VERSION,
      });
      if (message === null) throw new Error("Expected supported delivery");
      const { adapter, request } = provider(source);
      await expect(
        adapter.retrieveQueuedWebhook(message),
      ).resolves.toMatchObject({
        providerEventReference: "evt_delivery",
        providerEventData: object,
        supported: true,
        payloadSha256: createHash("sha256")
          .update(JSON.stringify(source))
          .digest("hex"),
      });
      expect(request).toHaveBeenCalledWith(
        "https://api.stripe.com/v1/events/evt_delivery",
        expect.objectContaining({
          method: "GET",
          redirect: "error",
          signal: expect.any(AbortSignal) as unknown,
          headers: {
            authorization: "Bearer sk_test_delivery_fixture",
            "stripe-version": STRIPE_API_VERSION,
          },
        }),
      );
    },
  );
  it.each([
    {
      id: "in_delivery",
      parent: { subscription_details: { subscription: "sub_delivery" } },
    },
    {
      id: "in_delivery",
      parent: {
        subscription_details: { subscription: { id: "sub_delivery" } },
      },
    },
    { id: "in_delivery", subscription: { id: "sub_delivery" } },
  ])(
    "uses one FIFO identity for Basil and expanded invoices",
    async (object) => {
      const source = event("invoice.paid", object);
      const message = delivery(source);
      expect(message?.objectReference).toBe("sub_delivery");
      if (message === null) throw new Error("Expected supported delivery");
      await expect(
        provider(source).adapter.retrieveQueuedWebhook(message),
      ).resolves.toMatchObject({ providerEventData: object });
    },
  );
  it.each([
    { livemode: true },
    { api_version: "2024-06-20" },
    { object: "customer" },
    { created: -1 },
    { created: Number.MAX_SAFE_INTEGER },
    { id: "evt_/bad" },
  ])("rejects invalid ingress provider evidence %j", (override) => {
    expect(() => delivery({ ...event(), ...override })).toThrow();
  });
  it.each([
    { id: "evt_other" },
    { created: created + 1 },
    { livemode: true },
    { api_version: "2024-06-20" },
    { type: "customer.subscription.deleted" },
    { data: { object: { id: "sub_other" } } },
  ])(
    "rejects a retrieved event not bound to the delivery %j",
    async (override) => {
      const message = delivery(event());
      if (message === null) throw new Error("Expected supported delivery");
      await expect(
        provider({ ...event(), ...override }).adapter.retrieveQueuedWebhook(
          message,
        ),
      ).rejects.toMatchObject({ code: "invalid-provider-event" });
    },
  );
  it("acknowledges valid unsupported events without creating delivery metadata", () => {
    expect(
      delivery(event("customer.created", { id: "cus_delivery" })),
    ).toBeNull();
  });
  it("bounds fetched provider bytes and redacts failed responses", async () => {
    const message = delivery(event());
    if (message === null) throw new Error("Expected supported delivery");
    await expect(
      provider({
        secret: "x".repeat(256 * 1024),
      }).adapter.retrieveQueuedWebhook(message),
    ).rejects.toMatchObject({
      code: "provider-unavailable",
      message: "The billing provider is unavailable.",
    });
  });
});
