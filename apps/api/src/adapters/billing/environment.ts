import {
  BillingApplicationError,
  createBillingConfiguration,
  type BillingConfiguration,
  type BillingProvider,
  type BillingRuntimeMode,
} from "../../application/billing.js";
import { FakeBillingProvider } from "./fake-billing-provider.js";
import {
  StripeBillingProvider,
  type StripeFetchImplementation,
} from "./stripe-billing-provider.js";

import {
  STRIPE_STARTER_PRODUCT_REFERENCE,
  STRIPE_STARTER_PRICE_REFERENCE,
  STRIPE_PRO_PRODUCT_REFERENCE,
  STRIPE_PRO_PRICE_REFERENCE,
} from "./reviewed-sandbox-plans.js";
export {
  STRIPE_STARTER_PRODUCT_REFERENCE,
  STRIPE_STARTER_PRICE_REFERENCE,
  STRIPE_PRO_PRODUCT_REFERENCE,
  STRIPE_PRO_PRICE_REFERENCE,
} from "./reviewed-sandbox-plans.js";

export interface BillingRuntimeEnvironment {
  readonly configuration: BillingConfiguration;
  readonly stripeSandboxSecrets?: Readonly<{
    readonly apiKey: string;
    readonly previousWebhookSigningSecret?: string;
    readonly webhookSigningSecret: string;
  }>;
}

function optionalTrimmed(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = environment[name]?.trim();
  return value === "" ? undefined : value;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = optionalTrimmed(environment, name);
  if (value === undefined) {
    throw new BillingApplicationError(
      "invalid-billing-configuration",
      "Required Stripe sandbox configuration is missing.",
    );
  }
  return value;
}

function runtimeMode(value: string | undefined): BillingRuntimeMode {
  const normalized = value?.trim() ?? "fake";
  if (
    normalized !== "disabled" &&
    normalized !== "fake" &&
    normalized !== "stripe-sandbox"
  ) {
    throw new BillingApplicationError(
      "invalid-billing-configuration",
      "The billing runtime mode is invalid.",
    );
  }
  return normalized;
}

export function loadBillingRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
): BillingRuntimeEnvironment {
  const mode = runtimeMode(environment["CLOUDMARKUP_BILLING_MODE"]);
  const portalConfigurationReference = optionalTrimmed(
    environment,
    "STRIPE_PORTAL_CONFIGURATION_ID",
  );
  const previousWebhookSigningSecretReference = optionalTrimmed(
    environment,
    "STRIPE_PREVIOUS_WEBHOOK_SECRET_REFERENCE",
  );
  const previousWebhookSigningSecret = optionalTrimmed(
    environment,
    "STRIPE_PREVIOUS_WEBHOOK_SECRET",
  );
  if (mode === "stripe-sandbox" && portalConfigurationReference === undefined) {
    throw new BillingApplicationError(
      "invalid-billing-configuration",
      "A reviewed Stripe Portal configuration is required.",
    );
  }
  const configuration = createBillingConfiguration({
    ...(environment["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"] === undefined
      ? {}
      : {
          planMappingVersion:
            environment["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"],
        }),
    cancelUrl:
      optionalTrimmed(environment, "CLOUDMARKUP_BILLING_CANCEL_URL") ??
      "http://127.0.0.1:4173/settings/billing?checkout=canceled",
    graceDurationHours: Number(
      optionalTrimmed(environment, "CLOUDMARKUP_BILLING_GRACE_HOURS") ?? "0",
    ),
    mode,
    ...(previousWebhookSigningSecretReference === undefined
      ? {}
      : { previousWebhookSigningSecretReference }),
    ...(portalConfigurationReference === undefined
      ? {}
      : { portalConfigurationReference }),
    portalReturnUrl:
      optionalTrimmed(environment, "CLOUDMARKUP_BILLING_PORTAL_RETURN_URL") ??
      "http://127.0.0.1:4173/settings/billing",
    proPriceReference:
      optionalTrimmed(environment, "STRIPE_PRO_PRICE_ID") ??
      STRIPE_PRO_PRICE_REFERENCE,
    proProductReference:
      optionalTrimmed(environment, "STRIPE_PRO_PRODUCT_ID") ??
      STRIPE_PRO_PRODUCT_REFERENCE,
    starterPriceReference:
      optionalTrimmed(environment, "STRIPE_STARTER_PRICE_ID") ??
      STRIPE_STARTER_PRICE_REFERENCE,
    starterProductReference:
      optionalTrimmed(environment, "STRIPE_STARTER_PRODUCT_ID") ??
      STRIPE_STARTER_PRODUCT_REFERENCE,
    stripeApiKeySecretReference:
      optionalTrimmed(environment, "STRIPE_API_KEY_SECRET_REFERENCE") ??
      "cloudmarkup/dev/stripe/api-key",
    stripeEnvironment:
      optionalTrimmed(environment, "CLOUDMARKUP_STRIPE_ENVIRONMENT") ?? "test",
    successUrl:
      optionalTrimmed(environment, "CLOUDMARKUP_BILLING_SUCCESS_URL") ??
      "http://127.0.0.1:4173/settings/billing?checkout=success",
    webhookSigningSecretReference:
      optionalTrimmed(environment, "STRIPE_WEBHOOK_SECRET_REFERENCE") ??
      "cloudmarkup/dev/stripe/webhook-signing-secret",
    webhookSignatureToleranceSeconds: Number(
      optionalTrimmed(
        environment,
        "STRIPE_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS",
      ) ?? "300",
    ),
  });
  return {
    configuration,
    ...(mode !== "stripe-sandbox"
      ? {}
      : {
          stripeSandboxSecrets: {
            apiKey: required(environment, "STRIPE_SECRET_KEY"),
            ...(previousWebhookSigningSecret === undefined
              ? {}
              : { previousWebhookSigningSecret }),
            webhookSigningSecret: required(
              environment,
              "STRIPE_WEBHOOK_SECRET",
            ),
          },
        }),
  };
}
export interface BillingProviderFactoryOptions {
  readonly fetchImplementation?: StripeFetchImplementation;
}

export class DisabledBillingProvider implements BillingProvider {
  readonly #error = new BillingApplicationError(
    "billing-disabled",
    "Billing is disabled in this environment.",
  );

  createCheckoutSession(): Promise<never> {
    return Promise.reject(this.#error);
  }

  getCheckoutSession(): Promise<never> {
    return Promise.reject(this.#error);
  }

  createPortalSession(): Promise<never> {
    return Promise.reject(this.#error);
  }

  resolveSubscriptionSnapshot(): Promise<never> {
    return Promise.reject(this.#error);
  }

  verifyWebhook(): Promise<never> {
    return Promise.reject(this.#error);
  }
}

export function createBillingProvider(
  runtime: BillingRuntimeEnvironment,
  options: BillingProviderFactoryOptions = {},
): BillingProvider {
  if (runtime.configuration.mode === "disabled") {
    return new DisabledBillingProvider();
  }
  if (runtime.configuration.mode === "fake") {
    return new FakeBillingProvider();
  }
  const secrets = runtime.stripeSandboxSecrets;
  if (secrets === undefined) {
    throw new BillingApplicationError(
      "invalid-billing-configuration",
      "Stripe sandbox secrets are unavailable.",
    );
  }
  return new StripeBillingProvider({
    apiKey: secrets.apiKey,
    ...(options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation }),
    ...(secrets.previousWebhookSigningSecret === undefined
      ? {}
      : {
          previousWebhookSigningSecret: secrets.previousWebhookSigningSecret,
        }),
    signatureToleranceSeconds:
      runtime.configuration.webhookSignatureToleranceSeconds,
    stripeEnvironment: runtime.configuration.stripeEnvironment,
    webhookSigningSecret: secrets.webhookSigningSecret,
  });
}
