import type { SecretConfigurationResolver } from "@cloudmarkup/github-repository-export";

import {
  BillingApplicationError,
  type BillingProvider,
} from "../../application/billing.js";
import { decodeStripeApiKey } from "./stripe-sandbox-secret.js";
import {
  StripeBillingProvider,
  type StripeFetchImplementation,
} from "./stripe-billing-provider.js";

/** Exact-reference, operation-local secret loading. No webhook secret or credential cache. */
export function createSecretHostedBillingProvider(options: {
  readonly apiKeyReference: string;
  readonly stripeEnvironment?: "test" | "live";
  readonly secrets: SecretConfigurationResolver;
  readonly authorizeBeforeRequest: () => Promise<void>;
  readonly fetchImplementation?: StripeFetchImplementation;
}): BillingProvider {
  if (
    !/^arn:aws:secretsmanager:[a-z]{2}-[a-z]+-\d:\d{12}:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/u.test(
      options.apiKeyReference,
    )
  )
    throw new TypeError(
      "Hosted billing requires one exact API-key secret ARN.",
    );
  async function provider() {
    try {
      return new StripeBillingProvider({
        apiKey: decodeStripeApiKey(
          await options.secrets.resolveSecret(options.apiKeyReference),
          options.stripeEnvironment ?? "test",
        ),
        signatureToleranceSeconds: 300,
        stripeEnvironment: options.stripeEnvironment ?? "test",
        verificationMode: "hosted-sessions-only",
        fetchImplementation: async (input, init) => {
          await options.authorizeBeforeRequest();
          return (options.fetchImplementation ?? fetch)(input, init);
        },
      });
    } catch {
      throw new BillingApplicationError(
        "provider-unavailable",
        "Billing is temporarily unavailable.",
      );
    }
  }
  function unavailable(): Promise<never> {
    return Promise.reject(
      new BillingApplicationError(
        "billing-disabled",
        "Subscription event processing is disabled in this runtime.",
      ),
    );
  }
  return {
    createCreditTopUpSession: async (input) =>
      (await provider()).createCreditTopUpSession(input),
    getCreditTopUpSession: async (input) =>
      (await provider()).getCreditTopUpSession(input),
    createCheckoutSession: async (input) =>
      (await provider()).createCheckoutSession(input),
    getCheckoutSession: async (input) =>
      (await provider()).getCheckoutSession(input),
    createPortalSession: async (input) =>
      (await provider()).createPortalSession(input),
    verifyWebhook: unavailable,
    retrieveQueuedWebhook: unavailable,
    resolveSubscriptionSnapshot: unavailable,
    refreshSubscriptionSnapshot: unavailable,
  };
}
