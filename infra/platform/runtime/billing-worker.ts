import { billingWorkerHandler } from "@cloudmarkup/api/billing";

/** Partial-batch retries are successful Lambda invocations, so emit a separate
 * content-free signal for the worker alarm without logging Stripe identifiers. */
export async function handler(event: unknown) {
  const result = await billingWorkerHandler(event);
  if (result.batchItemFailures.length > 0) {
    console.warn(
      JSON.stringify({ component: "billing-worker", outcome: "batch-retry" }),
    );
  }
  return result;
}
