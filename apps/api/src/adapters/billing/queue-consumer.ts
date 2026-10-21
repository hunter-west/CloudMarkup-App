import {
  parseBillingWebhookDelivery,
  type BillingWebhookDelivery,
  type BillingWebhookProcessingResult,
} from "../../application/billing.js";

interface QueueRecord {
  readonly body: string;
  readonly messageId: string;
}

function unavailable(): never {
  throw new Error("The billing delivery could not be processed.");
}

/** Consume only the configured FIFO source, without logging provider data. */
export function createBillingWebhookQueueHandler(options: {
  readonly enabled: boolean;
  readonly expectedQueueArn: string;
  readonly processDelivery: (
    delivery: BillingWebhookDelivery,
  ) => Promise<BillingWebhookProcessingResult>;
}) {
  if (
    !/^arn:aws:sqs:[a-z0-9-]+:\d{12}:cloudmarkup-(?:beta|dev|staging|prod)-billing-webhook\.fifo$/u.test(
      options.expectedQueueArn,
    )
  ) {
    throw new Error("The billing queue configuration is invalid.");
  }
  return async (
    event: unknown,
  ): Promise<{
    readonly batchItemFailures: readonly { readonly itemIdentifier: string }[];
  }> => {
    if (!options.enabled) return unavailable();
    if (typeof event !== "object" || event === null || Array.isArray(event))
      return unavailable();
    const rawRecords: unknown = (event as Record<string, unknown>)["Records"];
    if (!Array.isArray(rawRecords) || rawRecords.length > 10)
      return unavailable();
    const ids = new Set<string>();
    const records: QueueRecord[] = rawRecords.map((value: unknown) => {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return unavailable();
      const row = value as Record<string, unknown>;
      const messageId = row["messageId"];
      const body = row["body"];
      if (
        typeof messageId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(messageId) ||
        ids.has(messageId) ||
        row["eventSource"] !== "aws:sqs" ||
        row["eventSourceARN"] !== options.expectedQueueArn ||
        typeof body !== "string" ||
        Buffer.byteLength(body, "utf8") > 8192
      )
        return unavailable();
      ids.add(messageId);
      return { body, messageId };
    });
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record === undefined) return unavailable();
      try {
        const delivery = parseBillingWebhookDelivery(
          JSON.parse(record.body) as unknown,
        );
        const result = await options.processDelivery(delivery);
        if (
          ![
            "applied",
            "duplicate",
            "ignored-out-of-order",
            "rejected",
            "unsupported",
          ].includes(result.status)
        )
          return unavailable();
      } catch {
        // FIFO: later items must remain pending after the first failure.
        return {
          batchItemFailures: records
            .slice(index)
            .map(({ messageId }) => ({ itemIdentifier: messageId })),
        };
      }
    }
    return { batchItemFailures: [] };
  };
}
