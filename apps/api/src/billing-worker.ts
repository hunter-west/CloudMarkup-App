import { REVIEWED_LIVE_STRIPE } from "./adapters/billing/reviewed-live-plans.js";
import { supportsBillingDeliveryMapping } from "./application/billing-plan-mapping.js";
import type { SecretConfigurationResolver } from "@cloudmarkup/github-repository-export";

import {
  BILLING_CREDIT_PLAN_MAPPING_VERSION,
  billingDeliveryEnvironment,
  BillingApplicationError,
  createBillingConfiguration,
} from "./application/billing.js";
import { createDurableBillingWebhookProcessor } from "./adapters/billing/durable-queue-worker.js";
import { createBillingWebhookQueueHandler } from "./adapters/billing/queue-consumer.js";
import {
  StripeBillingProvider,
  type StripeFetchImplementation,
} from "./adapters/billing/stripe-billing-provider.js";
import { createProductionDatabase } from "./production-database.js";
import { createProductionCleanupIncarnation } from "./production-cleanup-incarnation.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { SecretsManagerConfigurationResolver } from "./adapters/secret-configuration.js";
import { decodeStripeApiKey } from "./adapters/billing/stripe-sandbox-secret.js";

function unavailable(): never {
  throw new BillingApplicationError(
    "billing-disabled",
    "The billing worker configuration is unavailable.",
  );
}
function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined) return unavailable();
  if (value.length === 0 || value.trim() !== value) return unavailable();
  return value;
}

/** Creates one invocation-local processor. API keys are loaded lazily only
 * after every queue record's source is verified, then discarded with the batch. */
export function createProductionBillingWebhookWorker(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly database?: SqlDatabase;
  readonly secrets?: SecretConfigurationResolver;
  readonly fetchImplementation?: StripeFetchImplementation;
}) {
  const environment = input.environment;
  const stripeEnvironment = environment["CLOUDMARKUP_STRIPE_ENVIRONMENT"];
  const live = stripeEnvironment === "live";
  if (
    environment["CLOUDMARKUP_BILLING_ENABLED"] !== "true" ||
    (stripeEnvironment !== "test" && stripeEnvironment !== "live")
  )
    return unavailable();
  const expectedQueueArn = required(
    environment,
    "CLOUDMARKUP_BILLING_WEBHOOK_QUEUE_ARN",
  );
  const queue =
    /^arn:aws:sqs:([a-z]{2}-[a-z]+-\d):(\d{12}):cloudmarkup-(beta|dev|staging|prod)-billing-webhook\.fifo$/u.exec(
      expectedQueueArn,
    );
  if (queue === null) return unavailable();
  const [, region, account, stage] = queue;
  if (region === undefined || account === undefined || stage === undefined)
    return unavailable();
  const apiKeyArn = required(
    environment,
    "CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN",
  );
  const secretPrefix = `arn:aws:secretsmanager:${region}:${account}:secret:`;
  if (
    !apiKeyArn.startsWith(
      secretPrefix +
        `cloudmarkup/${stage}/stripe/${live ? "live/" : ""}api-key-`,
    )
  )
    return unavailable();
  if (
    live &&
    (apiKeyArn !== REVIEWED_LIVE_STRIPE.apiKeyArn ||
      stage !== "beta" ||
      environment["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"] !==
        BILLING_CREDIT_PLAN_MAPPING_VERSION ||
      environment["STRIPE_PORTAL_CONFIGURATION_ID"] !==
        REVIEWED_LIVE_STRIPE.portalConfigurationReference ||
      environment["STRIPE_STARTER_PRICE_ID"] !==
        REVIEWED_LIVE_STRIPE.starter.priceReference ||
      environment["STRIPE_STARTER_PRODUCT_ID"] !==
        REVIEWED_LIVE_STRIPE.starter.productReference ||
      environment["STRIPE_PRO_PRICE_ID"] !==
        REVIEWED_LIVE_STRIPE.pro.priceReference ||
      environment["STRIPE_PRO_PRODUCT_ID"] !==
        REVIEWED_LIVE_STRIPE.pro.productReference)
  )
    return unavailable();
  const databaseArn = required(environment, "CLOUDMARKUP_DATABASE_ARN");
  const databaseSecretArn = required(
    environment,
    "CLOUDMARKUP_DATABASE_SECRET_ARN",
  );
  if (
    !databaseArn.startsWith(`arn:aws:rds:${region}:${account}:cluster:`) ||
    !databaseSecretArn.startsWith(secretPrefix)
  )
    return unavailable();
  const database =
    input.database ??
    createProductionDatabase(
      {
        database: required(environment, "CLOUDMARKUP_DATABASE_NAME"),
        resourceArn: databaseArn,
        secretArn: databaseSecretArn,
      },
      environment,
      "billing",
      createProductionCleanupIncarnation(environment),
    );
  const secrets =
    input.secrets ??
    new SecretsManagerConfigurationResolver({ allowedReferences: [apiKeyArn] });
  const configuration = createBillingConfiguration({
    ...(environment["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"] === undefined
      ? {}
      : {
          planMappingVersion:
            environment["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"],
        }),
    mode: live ? "stripe-live" : "stripe-sandbox",
    stripeEnvironment,
    portalConfigurationReference: required(
      environment,
      "STRIPE_PORTAL_CONFIGURATION_ID",
    ),
    cancelUrl: required(environment, "CLOUDMARKUP_BILLING_CANCEL_URL"),
    portalReturnUrl: required(
      environment,
      "CLOUDMARKUP_BILLING_PORTAL_RETURN_URL",
    ),
    successUrl: required(environment, "CLOUDMARKUP_BILLING_SUCCESS_URL"),
    starterPriceReference: required(environment, "STRIPE_STARTER_PRICE_ID"),
    starterProductReference: required(environment, "STRIPE_STARTER_PRODUCT_ID"),
    proPriceReference: required(environment, "STRIPE_PRO_PRICE_ID"),
    proProductReference: required(environment, "STRIPE_PRO_PRODUCT_ID"),
    stripeApiKeySecretReference: `cloudmarkup/${stage}/stripe/${live ? "live/" : ""}api-key`,
    webhookSigningSecretReference: `cloudmarkup/${stage}/stripe/${live ? "live/" : ""}webhook-signing-secret`,
  });
  let processor:
    | Promise<ReturnType<typeof createDurableBillingWebhookProcessor>>
    | undefined;
  return createBillingWebhookQueueHandler({
    enabled: true,
    expectedQueueArn,
    processDelivery: async (delivery) => {
      if (
        billingDeliveryEnvironment(delivery) !== stripeEnvironment ||
        !supportsBillingDeliveryMapping(
          delivery.planMappingVersion,
          configuration.planMappingVersion,
        )
      )
        return unavailable();
      processor ??= (async () => {
        const apiKey = decodeStripeApiKey(
          await secrets.resolveSecret(apiKeyArn),
          stripeEnvironment,
        );
        return createDurableBillingWebhookProcessor({
          configuration,
          database,
          expectedQueueArn,
          provider: new StripeBillingProvider({
            apiKey,
            stripeEnvironment,
            verificationMode: "queued-events-only",
            signatureToleranceSeconds: 300,
            ...(input.fetchImplementation === undefined
              ? {}
              : { fetchImplementation: input.fetchImplementation }),
          }),
        });
      })();
      return (await processor)(delivery);
    },
  });
}

export async function billingWorkerHandler(event: unknown) {
  return createProductionBillingWebhookWorker({ environment: process.env })(
    event,
  );
}
