import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductionBillingWebhookWorker } from "./billing-worker.js";
import { PostgresBillingPersistence } from "./adapters/persistence/billing-persistence.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import {
  BILLING_PLAN_MAPPING_VERSION,
  BILLING_SHARING_PLAN_MAPPING_VERSION,
  BILLING_WEBHOOK_ENDPOINT_VERSION,
} from "./application/billing.js";
import {
  parseStripeBillingWebhookDelivery,
  STRIPE_API_VERSION,
  StripeBillingProvider,
} from "./adapters/billing/stripe-billing-provider.js";
import {
  STRIPE_PRO_PRICE_REFERENCE,
  STRIPE_PRO_PRODUCT_REFERENCE,
  STRIPE_STARTER_PRICE_REFERENCE,
  STRIPE_STARTER_PRODUCT_REFERENCE,
} from "./adapters/billing/environment.js";

const queueArn =
  "arn:aws:sqs:us-east-1:000000000000:cloudmarkup-beta-billing-webhook.fifo";
const apiKeyArn =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/api-key-Abc123";
const environment = {
  CLOUDMARKUP_BILLING_ENABLED: "true",
  CLOUDMARKUP_STRIPE_ENVIRONMENT: "test",
  CLOUDMARKUP_BILLING_WEBHOOK_QUEUE_ARN: queueArn,
  CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN: apiKeyArn,
  CLOUDMARKUP_DATABASE_ARN:
    "arn:aws:rds:us-east-1:000000000000:cluster:cloudmarkup-beta",
  CLOUDMARKUP_DATABASE_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:rds-db-fixture-Abc123",
  CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
  STRIPE_PORTAL_CONFIGURATION_ID: "bpc_worker_fixture",
  CLOUDMARKUP_BILLING_CANCEL_URL:
    "https://beta.example.invalid/settings/billing?checkout=canceled",
  CLOUDMARKUP_BILLING_SUCCESS_URL:
    "https://beta.example.invalid/settings/billing?checkout=success",
  CLOUDMARKUP_BILLING_PORTAL_RETURN_URL:
    "https://beta.example.invalid/settings/billing",
  STRIPE_STARTER_PRICE_ID: STRIPE_STARTER_PRICE_REFERENCE,
  STRIPE_STARTER_PRODUCT_ID: STRIPE_STARTER_PRODUCT_REFERENCE,
  STRIPE_PRO_PRICE_ID: STRIPE_PRO_PRICE_REFERENCE,
  STRIPE_PRO_PRODUCT_ID: STRIPE_PRO_PRODUCT_REFERENCE,
};
function fixture(
  secret = JSON.stringify({ "API key": "sk_test_worker_fixture" }),
) {
  const bytes = new TextEncoder().encode(secret);
  const resolveSecret = vi.fn().mockResolvedValue(bytes);
  const query = vi
    .fn()
    .mockRejectedValue(new Error("Unexpected database access"));
  const source = {
    api_version: STRIPE_API_VERSION,
    created: 1786622400,
    data: { object: { id: "sub_worker" } },
    id: "evt_worker",
    livemode: false,
    object: "event",
    type: "customer.subscription.updated",
  };
  const fetchImplementation = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(source))),
    );
  const delivery = parseStripeBillingWebhookDelivery({
    rawBody: Buffer.from(JSON.stringify(source)),
    planMappingVersion: BILLING_PLAN_MAPPING_VERSION,
    signatureSecretVersion: "current",
    webhookEndpointVersion: BILLING_WEBHOOK_ENDPOINT_VERSION,
  });
  if (delivery === null) throw new Error("Expected fixture delivery");
  const handler = createProductionBillingWebhookWorker({
    environment,
    database: { query } as unknown as SqlDatabase,
    secrets: { resolveSecret },
    fetchImplementation,
  });
  const record = {
    body: JSON.stringify(delivery),
    eventSource: "aws:sqs",
    eventSourceARN: queueArn,
    messageId: "message_worker",
  };
  return {
    handler,
    record,
    resolveSecret,
    query,
    bytes,
    delivery,
    fetchImplementation,
  };
}
afterEach(() => {
  vi.restoreAllMocks();
});
describe("production billing queue composition", () => {
  it("leaves a new-mapping delivery queued on a legacy worker before secrets, provider or SQL", async () => {
    const f = fixture();
    const result = await f.handler({
      Records: [
        {
          ...f.record,
          body: JSON.stringify({
            ...f.delivery,
            planMappingVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
          }),
        },
      ],
    });
    expect(result).toEqual({
      batchItemFailures: [{ itemIdentifier: f.record.messageId }],
    });
    expect(f.resolveSecret).not.toHaveBeenCalled();
    expect(f.fetchImplementation).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
  });
  it("rejects unknown configured mapping before loading a provider or database", () => {
    expect(() =>
      createProductionBillingWebhookWorker({
        environment: {
          ...environment,
          CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION: "unknown",
        },
      }),
    ).toThrow("billing plan mapping");
  });
  it("rejects disabled or cross-account configuration before any provider access", () => {
    expect(() =>
      createProductionBillingWebhookWorker({ environment: {} }),
    ).toThrow("billing worker configuration");
    expect(() =>
      createProductionBillingWebhookWorker({
        environment: { ...environment, CLOUDMARKUP_STRIPE_ENVIRONMENT: "live" },
      }),
    ).toThrow();
    expect(() =>
      createProductionBillingWebhookWorker({
        environment: {
          ...environment,
          CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN: apiKeyArn.replace(
            "000000000000",
            "111111111111",
          ),
        },
      }),
    ).toThrow();
  });
  it("checks the complete queue batch before loading any secrets", async () => {
    const f = fixture();
    await expect(
      f.handler({
        Records: [
          f.record,
          {
            ...f.record,
            messageId: "other",
            eventSourceARN: queueArn.replace("000000000000", "111111111111"),
          },
        ],
      }),
    ).rejects.toThrow();
    expect(f.resolveSecret).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
  });
  it("authentically retrieves the event and accepts an existing durable receipt", async () => {
    const f = fixture();
    const receipt = vi
      .spyOn(PostgresBillingPersistence.prototype, "recordWebhookEvent")
      .mockResolvedValue({
        lifecycleStatus: "processed",
        payloadSha256: f.delivery.payloadSha256,
        webhookEventId: "billing_webhook_fixture",
      });
    await expect(f.handler({ Records: [f.record] })).resolves.toEqual({
      batchItemFailures: [],
    });
    expect(receipt).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadSha256: f.delivery.payloadSha256,
        providerEventReference: "evt_worker",
      }),
    );
    expect(f.resolveSecret).toHaveBeenCalledExactlyOnceWith(apiKeyArn);
    expect(f.bytes.every((value) => value === 0)).toBe(true);
    expect(f.fetchImplementation).toHaveBeenCalledTimes(1);
  });
  it.each([
    "sk_live_never",
    JSON.stringify({ first: "sk_test_first", second: "sk_test_second" }),
    "not-json",
  ])("denies live/ambiguous/malformed secret content", async (secret) => {
    const f = fixture(secret);
    await expect(f.handler({ Records: [f.record] })).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "message_worker" }],
    });
    expect(f.fetchImplementation).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.bytes.every((value) => value === 0)).toBe(true);
  });
  it("queue-only providers cannot verify unsigned ingress or create hosted sessions", async () => {
    const fetchImplementation = vi.fn();
    const provider = new StripeBillingProvider({
      apiKey: "sk_test_worker_fixture",
      signatureToleranceSeconds: 300,
      verificationMode: "queued-events-only",
      fetchImplementation,
    });
    await expect(
      provider.verifyWebhook({
        now: new Date(),
        rawBody: Buffer.from("{}"),
        signatureHeader: undefined,
      }),
    ).rejects.toThrow();
    await expect(
      provider.createCheckoutSession({} as never),
    ).rejects.toMatchObject({ code: "billing-disabled" });
    await expect(
      provider.createPortalSession({} as never),
    ).rejects.toMatchObject({ code: "billing-disabled" });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(
      () =>
        new StripeBillingProvider({
          apiKey: "sk_test_worker_fixture",
          signatureToleranceSeconds: 300,
        }),
    ).toThrow();
  });
});
