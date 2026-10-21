import { createCreditTopUpWebhookProcessor } from "./top-up-webhook.js";
import { PostgresCreditTopUpPersistence } from "../persistence/credit-top-up-persistence.js";
import {
  BillingApplicationError,
  BillingApplicationService,
  type BillingConfiguration,
} from "../../application/billing.js";
import { PostgresBillingPersistence } from "../persistence/billing-persistence.js";
import { PostgresCommercialPersistenceRepository } from "../persistence/commercial-repositories.js";
import type { SqlDatabase } from "../persistence/sql.js";
import { createBillingWebhookQueueHandler } from "./queue-consumer.js";
import type { StripeBillingProvider } from "./stripe-billing-provider.js";

/** Only the authenticated queue processor escapes this composition. Webhook
 * audits use durable BillingPersistence transactions; browser-sensitive actions
 * are explicitly absent, not replaced by a no-op or fake audit implementation. */
interface DurableBillingWebhookWorkerInput {
  readonly configuration: BillingConfiguration;
  readonly database: SqlDatabase;
  readonly expectedQueueArn: string;
  readonly provider: StripeBillingProvider;
  readonly now?: () => Date;
}

export function createDurableBillingWebhookProcessor(
  input: DurableBillingWebhookWorkerInput,
) {
  if (!(
    (input.configuration.mode === "stripe-sandbox" &&
      input.configuration.stripeEnvironment === "test") ||
    (input.configuration.mode === "stripe-live" &&
      input.configuration.stripeEnvironment === "live")
  )) {
    throw new BillingApplicationError(
      "billing-disabled",
      "Only a mode-matched Stripe worker can be composed.",
    );
  }
  const service = new BillingApplicationService({
    auditSink: null,
    commercial: new PostgresCommercialPersistenceRepository(input.database),
    configuration: input.configuration,
    persistence: new PostgresBillingPersistence(
      input.database,
      input.configuration.stripeEnvironment,
    ),
    provider: input.provider,
    topUps: createCreditTopUpWebhookProcessor({
      provider: input.provider,
      persistence: new PostgresCreditTopUpPersistence(input.database),
    }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return (delivery: unknown) => service.processQueuedWebhook(delivery);
}

export function createDurableBillingWebhookWorker(
  input: DurableBillingWebhookWorkerInput,
) {
  return createBillingWebhookQueueHandler({
    enabled: true,
    expectedQueueArn: input.expectedQueueArn,
    processDelivery: createDurableBillingWebhookProcessor(input),
  });
}
