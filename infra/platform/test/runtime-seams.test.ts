import { createHash, createHmac } from "node:crypto";

import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, test, vi } from "vitest";

import {
  createBillingWebhookHandler,
  handler as billingWebhook,
  type BillingWebhookRuntimeDependencies,
} from "../runtime/billing-webhook.js";
import { handler as jobWorker } from "../runtime/job-worker.js";

describe("Prompt 47A controlled-beta runtime seams", () => {
  test("never acknowledges a valid queued job", () => {
    expect(
      jobWorker({
        Records: [
          { messageId: "job-message-1" },
          { messageId: "job-message-2" },
          { malformed: true },
        ],
      }),
    ).toEqual({
      batchItemFailures: [
        { itemIdentifier: "job-message-1" },
        { itemIdentifier: "job-message-2" },
      ],
    });
  });

  test("keeps the deployed webhook disabled before reading request data", async () => {
    delete process.env["CLOUDMARKUP_BILLING_ENABLED"];
    const event = {} as APIGatewayProxyEventV2;
    Object.defineProperty(event, "body", {
      get: () => {
        throw new Error("disabled billing must not read request data");
      },
    });

    await expect(billingWebhook(event)).resolves.toEqual({
      body: JSON.stringify({ received: false, status: "billing-disabled" }),
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
      statusCode: 503,
    });
  });

  test("rejects direct-origin billing requests before reading request data", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const previousBilling = process.env["CLOUDMARKUP_BILLING_ENABLED"];
    const previousOrigin = process.env["CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION"];
    process.env["CLOUDMARKUP_BILLING_ENABLED"] = "true";
    delete process.env["CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION"];
    const event = { headers: {} } as APIGatewayProxyEventV2;
    Object.defineProperty(event, "body", {
      get: () => {
        throw new Error("origin rejection must not read request data");
      },
    });

    try {
      await expect(billingWebhook(event)).resolves.toMatchObject({
        body: JSON.stringify({
          received: false,
          status: "origin-verification-failed",
        }),
        statusCode: 403,
      });
      process.env["CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION"] =
        "edge-origin-verification-fixture-0001";
      event.headers["X-CloudMarkup-Edge-Origin"] =
        "edge-origin-verification-fixture-9999";
      await expect(billingWebhook(event)).resolves.toMatchObject({
        statusCode: 403,
      });
      expect(log).toHaveBeenLastCalledWith(
        JSON.stringify({
          component: "billing-webhook",
          event: "security.origin.denied",
          outcome: "origin-verification-failure",
        }),
      );
    } finally {
      if (previousBilling === undefined) {
        delete process.env["CLOUDMARKUP_BILLING_ENABLED"];
      } else {
        process.env["CLOUDMARKUP_BILLING_ENABLED"] = previousBilling;
      }
      if (previousOrigin === undefined) {
        delete process.env["CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION"];
      } else {
        process.env["CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION"] = previousOrigin;
      }
      log.mockRestore();
    }
  });

  test("verifies exact raw bytes with current/previous secrets and enqueues only a safe deterministic envelope", async () => {
    process.env["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"] =
      "cloudmarkup-starter-pro-mapping-2026-08-28-v1";
    process.env["CLOUDMARKUP_BILLING_WEBHOOK_ENDPOINT_VERSION"] =
      "cloudmarkup-stripe-webhook-2026-08-28-v1";
    const now = new Date("2026-08-28T12:00:00.000Z");
    const timestamp = Math.floor(now.getTime() / 1_000);
    const previousSecret = "whsec_previous_fixture";
    const eventBody = JSON.stringify({
      api_version: "2025-06-30.basil",
      livemode: false,
      object: "event",
      created: timestamp,
      data: {
        object: {
          card: "must-not-escape",
          customer_email: "must-not-escape",
          id: "sub_controlled_beta",
          private_repository_content: "must-not-escape",
          raw_prompt: "must-not-escape",
        },
      },
      id: "evt_controlled_beta",
      type: "customer.subscription.updated",
    });
    const signature = createHmac("sha256", previousSecret)
      .update(timestamp.toString() + "." + eventBody)
      .digest("hex");
    const enqueue = vi
      .fn<BillingWebhookRuntimeDependencies["enqueue"]>()
      .mockResolvedValue(undefined);
    const log = vi.fn();
    const handler = createBillingWebhookHandler({
      enqueue,
      loadSigningSecrets: () =>
        Promise.resolve([
          { secret: "whsec_current_fixture", version: "current" },
          { secret: previousSecret, version: "previous" },
        ]),
      log,
      now: () => now,
    });
    const event = {
      body: eventBody,
      headers: {
        "stripe-signature": "t=" + timestamp.toString() + ",v1=" + signature,
      },
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2;

    await expect(handler(event)).resolves.toMatchObject({ statusCode: 202 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const message = enqueue.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      objectReference: "sub_controlled_beta",
      planMappingVersion: "cloudmarkup-starter-pro-mapping-2026-08-28-v1",
      providerEventReference: "evt_controlled_beta",
      signatureSecretVersion: "previous",
      webhookEndpointVersion: "cloudmarkup-stripe-webhook-2026-08-28-v1",
    });
    expect(JSON.stringify(message)).not.toMatch(
      /must-not-escape|raw_prompt|customer_email|card/u,
    );
    expect(log).toHaveBeenLastCalledWith({
      component: "billing-webhook",
      outcome: "accepted",
      providerEventReference: "evt_controlled_beta",
      signatureSecretVersion: "previous",
    });

    await expect(
      handler({
        ...event,
        headers: {
          "stripe-signature":
            "t=" + timestamp.toString() + ",v1=" + "0".repeat(64),
        },
      }),
    ).resolves.toMatchObject({ statusCode: 400 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenLastCalledWith({
      component: "billing-webhook",
      outcome: "signature-failure",
      reasonCode: "signature-mismatch",
    });
  });

  test("preserves REST payload-v1 raw bytes for billing verification", async () => {
    process.env["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"] =
      "cloudmarkup-starter-pro-mapping-2026-08-28-v1";
    process.env["CLOUDMARKUP_BILLING_WEBHOOK_ENDPOINT_VERSION"] =
      "cloudmarkup-stripe-webhook-2026-08-28-v1";
    const now = new Date("2026-08-28T12:00:00.000Z");
    const timestamp = Math.floor(now.getTime() / 1_000);
    const secret = "whsec_rest_fixture";
    const raw = Buffer.from(
      JSON.stringify({
        api_version: "2025-06-30.basil",
        livemode: false,
        object: "event",
        created: timestamp,
        data: { object: { id: "sub_rest_payload" } },
        id: "evt_rest_payload",
        type: "customer.subscription.updated",
      }),
      "utf8",
    );
    const signature = createHmac("sha256", secret)
      .update(timestamp.toString() + ".")
      .update(raw)
      .digest("hex");
    const enqueue = vi
      .fn<BillingWebhookRuntimeDependencies["enqueue"]>()
      .mockResolvedValue(undefined);
    const handler = createBillingWebhookHandler({
      enqueue,
      loadSigningSecrets: () =>
        Promise.resolve([{ secret, version: "current" }]),
      log: vi.fn(),
      now: () => now,
    });
    const event = {
      body: raw.toString("utf8"),
      headers: {
        "stripe-signature": `t=${String(timestamp)},v1=${signature}`,
      },
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEvent;

    await expect(handler(event)).resolves.toMatchObject({ statusCode: 202 });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadSha256: createHash("sha256").update(raw).digest("hex"),
        providerEventReference: "evt_rest_payload",
      }),
    );
  });

  test("returns retryable failure and no acknowledgement when secret loading or enqueueing fails", async () => {
    const now = new Date("2026-08-28T12:00:00.000Z");
    const timestamp = Math.floor(now.getTime() / 1_000);
    const secret = "whsec_current_fixture";
    const body = JSON.stringify({
      api_version: "2025-06-30.basil",
      livemode: false,
      object: "event",
      created: timestamp,
      data: { object: { id: "sub_retry" } },
      id: "evt_retry",
      type: "customer.subscription.updated",
    });
    const signature = createHmac("sha256", secret)
      .update(timestamp.toString() + "." + body)
      .digest("hex");
    const baseEvent = {
      body,
      headers: {
        "stripe-signature": "t=" + timestamp.toString() + ",v1=" + signature,
      },
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2;

    const secretFailure = createBillingWebhookHandler({
      enqueue: vi.fn(),
      loadSigningSecrets: () => Promise.reject(new Error("secret outage")),
      log: vi.fn(),
      now: () => now,
    });
    await expect(secretFailure(baseEvent)).resolves.toMatchObject({
      statusCode: 503,
    });

    const enqueueFailure = createBillingWebhookHandler({
      enqueue: () => Promise.reject(new Error("queue outage")),
      loadSigningSecrets: () =>
        Promise.resolve([{ secret, version: "current" }]),
      log: vi.fn(),
      now: () => now,
    });
    await expect(enqueueFailure(baseEvent)).resolves.toMatchObject({
      statusCode: 503,
    });
  });
});

test("live webhook ingress emits only a V2 live delivery and rejects signed test events", async () => {
  const previous = process.env["CLOUDMARKUP_STRIPE_ENVIRONMENT"];
  process.env["CLOUDMARKUP_STRIPE_ENVIRONMENT"] = "live";
  process.env["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"] =
    "cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4";
  process.env["CLOUDMARKUP_BILLING_WEBHOOK_ENDPOINT_VERSION"] =
    "cloudmarkup-stripe-webhook-2026-08-28-v1";
  try {
    const now = new Date("2026-10-01T12:00:00.000Z"),
      timestamp = Math.floor(now.getTime() / 1000),
      secret = "whsec_live_synthetic_fixture",
      enqueue = vi
        .fn<BillingWebhookRuntimeDependencies["enqueue"]>()
        .mockResolvedValue(undefined);
    const handler = createBillingWebhookHandler({
      enqueue,
      loadSigningSecrets: () =>
        Promise.resolve([{ secret, version: "current" }]),
      log: vi.fn(),
      now: () => now,
    });
    for (const livemode of [true, false]) {
      const body = JSON.stringify({
        api_version: "2025-06-30.basil",
        object: "event",
        livemode,
        created: timestamp,
        id: "evt_live_synthetic",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_live_synthetic",
            subscription: "sub_live_synthetic",
            private: "never-forward",
          },
        },
      });
      const signature = createHmac("sha256", secret)
        .update(timestamp.toString() + "." + body)
        .digest("hex");
      await expect(
        handler({
          body,
          headers: {
            "stripe-signature":
              "t=" + timestamp.toString() + ",v1=" + signature,
          },
          isBase64Encoded: false,
        }),
      ).resolves.toMatchObject({ statusCode: livemode ? 202 : 400 });
    }
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      contractVersion: 2,
      stripeEnvironment: "live",
    });
    expect(JSON.stringify(enqueue.mock.calls)).not.toContain("never-forward");
  } finally {
    if (previous === undefined)
      delete process.env["CLOUDMARKUP_STRIPE_ENVIRONMENT"];
    else process.env["CLOUDMARKUP_STRIPE_ENVIRONMENT"] = previous;
  }
});
