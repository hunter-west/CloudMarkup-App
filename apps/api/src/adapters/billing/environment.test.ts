import { describe, expect, it } from "vitest";

import { BillingApplicationError } from "../../application/billing.js";
import { BILLING_SHARING_PLAN_MAPPING_VERSION } from "../../application/billing-plan-mapping.js";
import { FakeBillingProvider } from "./fake-billing-provider.js";
import { StripeBillingProvider } from "./stripe-billing-provider.js";
import {
  STRIPE_PRO_PRICE_REFERENCE,
  STRIPE_STARTER_PRICE_REFERENCE,
  createBillingProvider,
  loadBillingRuntimeEnvironment,
} from "./environment.js";

describe("billing runtime environment", () => {
  it("accepts only the explicit additive mapping without changing money or quantity", () => {
    const old = loadBillingRuntimeEnvironment({}).configuration;
    const next = loadBillingRuntimeEnvironment({
      CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION:
        BILLING_SHARING_PLAN_MAPPING_VERSION,
    }).configuration;
    expect(next.planMappingVersion).toBe(BILLING_SHARING_PLAN_MAPPING_VERSION);
    expect(next.plans.starter.planVersionId).toBe(
      "planver_starter_2026_09_07_v2",
    );
    expect(next.plans.pro.planVersionId).toBe("planver_pro_2026_09_07_v3");
    for (const key of ["starter", "pro"] as const)
      expect({
        ...next.plans[key],
        planVersionId: old.plans[key].planVersionId,
      }).toEqual(old.plans[key]);
    expect(next.mode).toBe(old.mode);
    expect(next.cancellationPolicy).toEqual(old.cancellationPolicy);
    for (const invalid of [
      "",
      " ",
      "unknown",
      `${BILLING_SHARING_PLAN_MAPPING_VERSION} `,
    ])
      expect(() =>
        loadBillingRuntimeEnvironment({
          CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION: invalid,
        }),
      ).toThrow(BillingApplicationError);
  });
  it("defaults to the deterministic fake with the reviewed mapping", () => {
    const runtime = loadBillingRuntimeEnvironment({});

    expect(runtime.configuration.mode).toBe("fake");
    expect(runtime.configuration.currency).toBe("USD");
    expect(runtime.configuration.gracePolicy).toMatchObject({
      durationHours: 0,
      expensiveOperationsEnabled: false,
    });
    expect(runtime.configuration.planMappingVersion).toMatch(
      /starter-pro-mapping/u,
    );
    expect(runtime.configuration.plans.starter.monthlyCreditUnits).toBe(200);
    expect(runtime.configuration.plans.pro.monthlyCreditUnits).toBe(1000);
    expect(runtime.configuration.publishableKeyIdentifier).toBeNull();
    expect(runtime.configuration.stripeEnvironment).toBe("test");
    expect(runtime.configuration.trialPolicy).toBe("no-trial");
    expect(runtime.configuration.webhookEndpointVersion).toMatch(
      /stripe-webhook/u,
    );
    expect(runtime.configuration.plans.starter.priceReference).toBe(
      STRIPE_STARTER_PRICE_REFERENCE,
    );
    expect(runtime.configuration.plans.pro.priceReference).toBe(
      STRIPE_PRO_PRICE_REFERENCE,
    );
    expect(runtime.configuration.cancelUrl).toBe(
      "http://127.0.0.1:4173/settings/billing?checkout=canceled",
    );
    expect(runtime.configuration.portalReturnUrl).toBe(
      "http://127.0.0.1:4173/settings/billing",
    );
    expect(runtime.configuration.successUrl).toBe(
      "http://127.0.0.1:4173/settings/billing?checkout=success",
    );
    expect(runtime.stripeSandboxSecrets).toBeUndefined();
  });

  it("constructs fake by default and Stripe only for explicit sandbox mode", () => {
    const fakeRuntime = loadBillingRuntimeEnvironment({});
    expect(createBillingProvider(fakeRuntime)).toBeInstanceOf(
      FakeBillingProvider,
    );

    const stripeRuntime = loadBillingRuntimeEnvironment({
      CLOUDMARKUP_BILLING_MODE: "stripe-sandbox",
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_reviewed",
      STRIPE_SECRET_KEY: "sk_test_local_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_local_fixture",
    });
    expect(createBillingProvider(stripeRuntime)).toBeInstanceOf(
      StripeBillingProvider,
    );
  });
  it("supports explicit disabled behavior without resolving secrets", () => {
    const runtime = loadBillingRuntimeEnvironment({
      CLOUDMARKUP_BILLING_MODE: "disabled",
    });

    expect(runtime.configuration.mode).toBe("disabled");
    expect(runtime.stripeSandboxSecrets).toBeUndefined();
  });

  it("requires a reviewed Portal config and both sandbox secrets", () => {
    expect(() =>
      loadBillingRuntimeEnvironment({
        CLOUDMARKUP_BILLING_MODE: "stripe-sandbox",
      }),
    ).toThrow(BillingApplicationError);
    expect(() =>
      loadBillingRuntimeEnvironment({
        CLOUDMARKUP_BILLING_MODE: "stripe-sandbox",
        STRIPE_PORTAL_CONFIGURATION_ID: "bpc_reviewed",
      }),
    ).toThrow("Required Stripe sandbox configuration is missing.");

    const runtime = loadBillingRuntimeEnvironment({
      CLOUDMARKUP_BILLING_MODE: "stripe-sandbox",
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_reviewed",
      STRIPE_SECRET_KEY: "sk_test_local_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_local_fixture",
    });
    expect(runtime.stripeSandboxSecrets).toEqual({
      apiKey: "sk_test_local_fixture",
      webhookSigningSecret: "whsec_local_fixture",
    });
    expect(JSON.stringify(runtime.configuration)).not.toContain(
      "sk_test_local_fixture",
    );
    expect(JSON.stringify(runtime.configuration)).not.toContain(
      "whsec_local_fixture",
    );
  });

  it("keeps dual-secret rotation references separate from secret values and live mode unavailable", () => {
    const runtime = loadBillingRuntimeEnvironment({
      CLOUDMARKUP_BILLING_GRACE_HOURS: "48",
      CLOUDMARKUP_BILLING_MODE: "stripe-sandbox",
      STRIPE_API_KEY_SECRET_REFERENCE: "cloudmarkup/staging/stripe/api-key",
      STRIPE_PORTAL_CONFIGURATION_ID: "bpc_reviewed",
      STRIPE_PREVIOUS_WEBHOOK_SECRET: "whsec_previous_fixture",
      STRIPE_PREVIOUS_WEBHOOK_SECRET_REFERENCE:
        "cloudmarkup/staging/stripe/webhook-signing-secret-previous",
      STRIPE_SECRET_KEY: "sk_test_local_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_current_fixture",
      STRIPE_WEBHOOK_SECRET_REFERENCE:
        "cloudmarkup/staging/stripe/webhook-signing-secret-current",
    });

    expect(runtime.configuration.gracePolicy.durationHours).toBe(48);
    expect(runtime.configuration.secretReferences).toEqual({
      apiKey: "cloudmarkup/staging/stripe/api-key",
      previousWebhookSigningSecret:
        "cloudmarkup/staging/stripe/webhook-signing-secret-previous",
      webhookSigningSecret:
        "cloudmarkup/staging/stripe/webhook-signing-secret-current",
    });
    expect(runtime.stripeSandboxSecrets).toEqual({
      apiKey: "sk_test_local_fixture",
      previousWebhookSigningSecret: "whsec_previous_fixture",
      webhookSigningSecret: "whsec_current_fixture",
    });
    expect(JSON.stringify(runtime.configuration)).not.toMatch(
      /sk_test_local_fixture|whsec_(?:previous|current)_fixture/u,
    );
    expect(() =>
      loadBillingRuntimeEnvironment({
        CLOUDMARKUP_BILLING_MODE: "stripe-sandbox",
        CLOUDMARKUP_STRIPE_ENVIRONMENT: "live",
        STRIPE_PORTAL_CONFIGURATION_ID: "bpc_reviewed",
        STRIPE_SECRET_KEY: "sk_test_local_fixture",
        STRIPE_WEBHOOK_SECRET: "whsec_current_fixture",
      }),
    ).toThrow("The billing runtime and Stripe environment must match.");
    expect(() =>
      loadBillingRuntimeEnvironment({
        CLOUDMARKUP_BILLING_MODE: "fake",
        CLOUDMARKUP_STRIPE_ENVIRONMENT: "live",
      }),
    ).toThrow("The billing runtime and Stripe environment must match.");
  });

  it("rejects invalid modes, URLs, mappings, and signature tolerance", () => {
    expect(() =>
      loadBillingRuntimeEnvironment({
        CLOUDMARKUP_BILLING_MODE: "live",
      }),
    ).toThrow("billing runtime mode is invalid");
    expect(() =>
      loadBillingRuntimeEnvironment({
        CLOUDMARKUP_BILLING_SUCCESS_URL: "http://attacker.example/return",
      }),
    ).toThrow("must use HTTPS");
    expect(() =>
      loadBillingRuntimeEnvironment({
        STRIPE_STARTER_PRICE_ID: "arbitrary_amount",
      }),
    ).toThrow("Starter Price reference");
    expect(() =>
      loadBillingRuntimeEnvironment({
        STRIPE_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS: "3600",
      }),
    ).toThrow("between 60 and 900");
  });
});
