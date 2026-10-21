import { describe, expect, it, vi } from "vitest";

import {
  BILLING_PLAN_MAPPING_VERSION,
  BILLING_WEBHOOK_ENDPOINT_VERSION,
  parseBillingWebhookDeliveryV1,
} from "../../application/billing.js";
import { createBillingWebhookQueueHandler } from "./queue-consumer.js";

const queueArn =
  "arn:aws:sqs:us-east-1:111111111111:cloudmarkup-beta-billing-webhook.fifo";
function delivery(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    contractVersion: 1,
    created: 1786622400,
    eventPosition: "00000000001786622400:evt_queue_fixture",
    eventType: "invoice.paid",
    objectReference: "sub_queue_fixture",
    payloadSha256: "a".repeat(64),
    planMappingVersion: BILLING_PLAN_MAPPING_VERSION,
    providerApiVersion: "2025-06-30.basil",
    providerEventReference: "evt_queue_fixture",
    signatureSecretVersion: "current",
    webhookEndpointVersion: BILLING_WEBHOOK_ENDPOINT_VERSION,
    ...overrides,
  };
}
function record(messageId: string, body: unknown = delivery()) {
  return {
    body: JSON.stringify(body),
    eventSource: "aws:sqs",
    eventSourceARN: queueArn,
    messageId,
  };
}

describe("version-bound durable billing deliveries", () => {
  it("retains only exact reference-only contract fields", () => {
    expect(parseBillingWebhookDeliveryV1(delivery())).toEqual(delivery());
  });
  it.each([
    { contractVersion: 2 },
    {
      created: -1,
      eventPosition: (-1).toString().padStart(20, "0") + ":evt_queue_fixture",
    },
    { eventPosition: "wrong" },
    { eventType: "invoice.voided" },
    { objectReference: "../../other" },
    { payloadSha256: "bad" },
    { planMappingVersion: "unconfigured" },
    { webhookEndpointVersion: "future" },
    { providerApiVersion: "latest" },
    { signatureSecretVersion: "unverified" },
    { rawBody: "must-not-persist" },
  ])("rejects malformed, unversioned and unexpected data %#", (override) => {
    if ("created" in override) {
      const control = delivery();
      expect(parseBillingWebhookDeliveryV1(control)).toEqual(control);
      const invalid = delivery(override);
      expect(invalid.eventPosition).toBe(
        invalid.created.toString().padStart(20, "0") +
          ":" +
          invalid.providerEventReference,
      );
    }
    expect(() => parseBillingWebhookDeliveryV1(delivery(override))).toThrow(
      "The billing delivery is invalid.",
    );
  });
});

describe("billing FIFO consumer", () => {
  it("accepts success and durable duplicate outcomes", async () => {
    const processDelivery = vi
      .fn()
      .mockResolvedValueOnce({ status: "applied" })
      .mockResolvedValueOnce({ status: "duplicate" });
    const handler = createBillingWebhookQueueHandler({
      enabled: true,
      expectedQueueArn: queueArn,
      processDelivery,
    });
    await expect(
      handler({ Records: [record("one"), record("two")] }),
    ).resolves.toEqual({ batchItemFailures: [] });
    expect(processDelivery).toHaveBeenCalledTimes(2);
  });
  it("stops at first failure and reports all later FIFO records", async () => {
    const processDelivery = vi
      .fn()
      .mockResolvedValueOnce({ status: "applied" })
      .mockRejectedValueOnce(new Error("sensitive provider detail"));
    const handler = createBillingWebhookQueueHandler({
      enabled: true,
      expectedQueueArn: queueArn,
      processDelivery,
    });
    await expect(
      handler({ Records: [record("one"), record("two"), record("three")] }),
    ).resolves.toEqual({
      batchItemFailures: [
        { itemIdentifier: "two" },
        { itemIdentifier: "three" },
      ],
    });
    expect(processDelivery).toHaveBeenCalledTimes(2);
  });
  it("retries malformed deliveries without calling the projection", async () => {
    const processDelivery = vi.fn();
    const handler = createBillingWebhookQueueHandler({
      enabled: true,
      expectedQueueArn: queueArn,
      processDelivery,
    });
    await expect(
      handler({ Records: [record("one", { invalid: true }), record("two")] }),
    ).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "one" }, { itemIdentifier: "two" }],
    });
    expect(processDelivery).not.toHaveBeenCalled();
  });
  it.each([
    { eventSourceARN: queueArn.replace("111111111111", "222222222222") },
    { eventSource: "aws:sns" },
    { body: "x".repeat(8193) },
    { messageId: "" },
  ])(
    "rejects the whole untrusted source batch before processing %#",
    async (override) => {
      const processDelivery = vi.fn();
      const handler = createBillingWebhookQueueHandler({
        enabled: true,
        expectedQueueArn: queueArn,
        processDelivery,
      });
      await expect(
        handler({
          Records: [record("one"), { ...record("two"), ...override }],
        }),
      ).rejects.toThrow("The billing delivery could not be processed.");
      expect(processDelivery).not.toHaveBeenCalled();
    },
  );
  it("rejects duplicate message identifiers", async () => {
    const processDelivery = vi.fn();
    const handler = createBillingWebhookQueueHandler({
      enabled: true,
      expectedQueueArn: queueArn,
      processDelivery,
    });
    await expect(
      handler({ Records: [record("same"), record("same")] }),
    ).rejects.toThrow();
    expect(processDelivery).not.toHaveBeenCalled();
  });
  it("keeps a disabled consumer closed before inspecting request data", async () => {
    const processDelivery = vi.fn();
    const handler = createBillingWebhookQueueHandler({
      enabled: false,
      expectedQueueArn: queueArn,
      processDelivery,
    });
    const event = Object.defineProperty({}, "Records", {
      get: () => {
        throw new Error("must not read");
      },
    });
    await expect(handler(event)).rejects.toThrow(
      "The billing delivery could not be processed.",
    );
    expect(processDelivery).not.toHaveBeenCalled();
  });
});
