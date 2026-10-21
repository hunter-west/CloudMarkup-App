interface QueueRecord {
  readonly messageId?: unknown;
}

interface QueueEvent {
  readonly Records?: unknown;
}

/**
 * Fail-closed deployment seam for the future Async Job worker. Returning every
 * valid message as a batch failure prevents this placeholder from acknowledging
 * work before the durable PostgreSQL repository and provider-neutral worker are
 * composed. It performs no model, compiler, repository, cloud, or customer
 * operation.
 */
export function handler(event: QueueEvent): {
  readonly batchItemFailures: readonly {
    readonly itemIdentifier: string;
  }[];
} {
  const records = Array.isArray(event.Records) ? event.Records : [];
  return {
    batchItemFailures: records.flatMap((record: unknown) => {
      if (typeof record !== "object" || record === null) return [];
      const messageId = (record as QueueRecord).messageId;
      if (typeof messageId !== "string" || messageId.length === 0) return [];
      return [{ itemIdentifier: messageId }];
    }),
  };
}
