import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  BILLING_WEBHOOK_MAX_BODY_BYTES,
  BillingApplicationError,
  type BillingApplicationService,
} from "../application/billing.js";
import type { ApiEnvironment } from "../transport/http.js";
import { registerBillingWebhookRoute } from "./billing-webhook.js";

function testApp(service: BillingApplicationService | undefined) {
  const app = new Hono<ApiEnvironment>();
  registerBillingWebhookRoute(app, service);
  return app;
}

describe("dedicated billing webhook route", () => {
  it("passes the exact raw request bytes and signature to billing verification", async () => {
    const raw = new Uint8Array([0, 1, 2, 13, 10, 255]);
    const processWebhook = vi.fn(
      (input: {
        readonly rawBody: Uint8Array;
        readonly signatureHeader: string | undefined;
      }) => {
        expect([...input.rawBody]).toEqual([...raw]);
        expect(input.signatureHeader).toBe("t=fixture,v1=fixture");
        return Promise.resolve({ status: "applied" as const });
      },
    );
    const app = testApp({
      processWebhook,
    } as unknown as BillingApplicationService);

    const response = await app.request("/webhooks/stripe", {
      body: raw,
      headers: {
        "content-type": "application/octet-stream",
        "stripe-signature": "t=fixture,v1=fixture",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      status: "applied",
    });
    expect(processWebhook).toHaveBeenCalledTimes(1);
  });

  it("bounds a raw body even when Content-Length is unavailable", async () => {
    const processWebhook = vi.fn(() =>
      Promise.resolve({ status: "applied" as const }),
    );
    const app = testApp({
      processWebhook,
    } as unknown as BillingApplicationService);
    const response = await app.request("/webhooks/stripe", {
      body: new Uint8Array(BILLING_WEBHOOK_MAX_BODY_BYTES + 1),
      method: "POST",
    });

    expect(response.status).toBe(413);
    expect(processWebhook).not.toHaveBeenCalled();
  });
  it("returns safe non-retry and retry responses without leaking errors", async () => {
    const invalidApp = testApp({
      processWebhook: () =>
        Promise.reject(
          new BillingApplicationError(
            "invalid-provider-event",
            "sensitive diagnostic must not leave the boundary",
          ),
        ),
    } as unknown as BillingApplicationService);
    const invalid = await invalidApp.request("/webhooks/stripe", {
      body: "{}",
      method: "POST",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("sensitive diagnostic");

    const unavailable = await testApp(undefined).request("/webhooks/stripe", {
      body: "{}",
      method: "POST",
    });
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("retry-after")).toBe("5");
  });
});
