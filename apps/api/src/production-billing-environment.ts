import {
  BILLING_CREDIT_PLAN_MAPPING_VERSION,
  createBillingConfiguration,
} from "./application/billing.js";
import { createSecretHostedBillingProvider } from "./adapters/billing/secret-hosted-provider.js";
import { SecretsManagerConfigurationResolver } from "./adapters/secret-configuration.js";
import {
  STRIPE_STARTER_PRICE_REFERENCE,
  STRIPE_STARTER_PRODUCT_REFERENCE,
  STRIPE_PRO_PRICE_REFERENCE,
  STRIPE_PRO_PRODUCT_REFERENCE,
} from "./adapters/billing/reviewed-sandbox-plans.js";

import { REVIEWED_LIVE_STRIPE } from "./adapters/billing/reviewed-live-plans.js";

const sandboxApiKeyReference =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/api-key-EX0004";

/** Reviewed mode-specific configuration only; no secret is read during application startup. */
export function readProductionBillingSessions(environment: NodeJS.ProcessEnv) {
  const enabled = environment["CLOUDMARKUP_BILLING_SESSIONS_ENABLED"];
  const stripeEnvironment = environment["CLOUDMARKUP_STRIPE_ENVIRONMENT"];
  const live = stripeEnvironment === "live";
  const apiKeyReference = live
    ? REVIEWED_LIVE_STRIPE.apiKeyArn
    : sandboxApiKeyReference;
  if (enabled === undefined || enabled === "false") return undefined;
  if (
    enabled !== "true" ||
    environment["CLOUDMARKUP_ENVIRONMENT"] !== "beta" ||
    environment["CLOUDMARKUP_BILLING_ENABLED"] !== "true" ||
    (stripeEnvironment !== "test" && stripeEnvironment !== "live") ||
    environment["CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN"] !== apiKeyReference
  )
    throw new Error(
      "Billing sessions require the reviewed beta runtime configuration.",
    );
  const portal =
    environment["CLOUDMARKUP_STRIPE_PORTAL_CONFIGURATION_REFERENCE"];
  if (
    portal === undefined ||
    !/^bpc_[A-Za-z0-9_]{1,250}$/u.test(portal) ||
    (live && portal !== REVIEWED_LIVE_STRIPE.portalConfigurationReference)
  )
    throw new Error("A reviewed Portal configuration is required.");
  if (
    live &&
    environment["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"] !==
      BILLING_CREDIT_PLAN_MAPPING_VERSION
  )
    throw new Error("Live sessions require the reviewed credit plan mapping.");
  const configuration = createBillingConfiguration({
    ...(environment["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"] === undefined
      ? {}
      : {
          planMappingVersion:
            environment["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"],
        }),
    mode: live ? "stripe-live" : "stripe-sandbox",
    stripeEnvironment,
    cancelUrl: "https://beta.example.invalid/organizations",
    successUrl: "https://beta.example.invalid/organizations",
    portalReturnUrl: "https://beta.example.invalid/organizations",
    portalConfigurationReference: portal,
    starterPriceReference: live
      ? REVIEWED_LIVE_STRIPE.starter.priceReference
      : STRIPE_STARTER_PRICE_REFERENCE,
    starterProductReference: live
      ? REVIEWED_LIVE_STRIPE.starter.productReference
      : STRIPE_STARTER_PRODUCT_REFERENCE,
    proPriceReference: live
      ? REVIEWED_LIVE_STRIPE.pro.priceReference
      : STRIPE_PRO_PRICE_REFERENCE,
    proProductReference: live
      ? REVIEWED_LIVE_STRIPE.pro.productReference
      : STRIPE_PRO_PRODUCT_REFERENCE,
    stripeApiKeySecretReference: live
      ? "cloudmarkup/beta/stripe/live/api-key"
      : "cloudmarkup/beta/stripe/api-key",
    // This session-only runtime never resolves or accepts webhook secrets.
    webhookSigningSecretReference: live
      ? "cloudmarkup/beta/stripe/live/webhook-signing-secret"
      : "cloudmarkup/beta/stripe/webhook-signing-secret",
  });
  const topUps = environment["CLOUDMARKUP_CREDIT_TOP_UPS_ENABLED"];
  if (topUps !== undefined && topUps !== "false" && topUps !== "true")
    throw new Error(
      "Credit purchase admission must be explicitly true or false.",
    );
  return {
    topUpsEnabled: topUps === "true",
    configuration,
    createProvider: (authorizeBeforeRequest: () => Promise<void>) =>
      createSecretHostedBillingProvider({
        apiKeyReference,
        stripeEnvironment,
        authorizeBeforeRequest,
        secrets: new SecretsManagerConfigurationResolver({
          allowedReferences: [apiKeyReference],
        }),
      }),
  };
}
