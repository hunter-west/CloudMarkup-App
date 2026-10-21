import { describe, expect, it, vi } from "vitest";
import { createSecretHostedBillingProvider } from "./secret-hosted-provider.js";
import { decodeStripeSandboxApiKey } from "./stripe-sandbox-secret.js";
import { StripeBillingProvider } from "./stripe-billing-provider.js";

const reference =
  "arn:aws:secretsmanager:us-east-1:111111111111:secret:cloudmarkup/beta/stripe/api-key-AbCdEf";
const portalInput = {
  billingAccountId: "billing_test",
  organizationId: "org_test",
  idempotencyKey: "portal-test",
  providerCustomerReference: "cus_test",
  portalConfigurationReference: "bpc_test",
  returnUrl: "https://beta.example.test/organizations/org_test/billing",
};

describe("hosted-only sandbox secret boundary", () => {
  it.each([
    "sk_test_cloudmarkup_fixture",
    JSON.stringify({ key: "sk_test_cloudmarkup_fixture" }),
  ])("decodes one sandbox key and zeros its mutable source", (value) => {
    const bytes = new TextEncoder().encode(value);
    expect(decodeStripeSandboxApiKey(bytes)).toBe(
      "sk_test_cloudmarkup_fixture",
    );
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });
  it.each([
    "sk_live_cloudmarkup_fixture",
    "",
    "null",
    "[]",
    "{}",
    JSON.stringify({
      a: "sk_test_cloudmarkup_fixture",
      b: "sk_test_other_fixture",
    }),
    JSON.stringify({ a: "sk_live_cloudmarkup_fixture" }),
  ])(
    "rejects missing, ambiguous and live keys without leaking values",
    (value) => {
      const bytes = new TextEncoder().encode(value);
      expect(() => decodeStripeSandboxApiKey(bytes)).toThrow(
        "The configured billing secret is unavailable.",
      );
      expect(bytes.every((byte) => byte === 0)).toBe(true);
    },
  );
  it("loads no secret at construction and resolves per operation without a credential cache", async () => {
    const buffers: Uint8Array[] = [];
    const resolveSecret = vi.fn(() => {
      const bytes = new TextEncoder().encode("sk_test_cloudmarkup_fixture");
      buffers.push(bytes);
      return Promise.resolve(bytes);
    });
    const authorize = vi.fn(() => Promise.resolve());
    const fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({
          url: "https://billing.stripe.com/p/session/test_example",
        }),
      ),
    );
    const provider = createSecretHostedBillingProvider({
      apiKeyReference: reference,
      secrets: { resolveSecret },
      authorizeBeforeRequest: authorize,
      fetchImplementation: fetch,
    });
    expect(resolveSecret).not.toHaveBeenCalled();
    await provider.createPortalSession(portalInput);
    await provider.createPortalSession({
      ...portalInput,
      idempotencyKey: "portal-second",
    });
    expect(resolveSecret).toHaveBeenCalledTimes(2);
    expect(resolveSecret).toHaveBeenCalledWith(reference);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(
      true,
    );
  });
  it("rechecks authorization after delayed secret resolution before any Stripe request", async () => {
    let finish: ((bytes: Uint8Array) => void) | undefined;
    let current = true;
    const secret = new Promise<Uint8Array>((resolve) => {
      finish = resolve;
    });
    const fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({
          url: "https://billing.stripe.com/p/session/test_example",
        }),
      ),
    );
    const authorize = vi.fn(() =>
      current ? Promise.resolve() : Promise.reject(new Error("revoked")),
    );
    const provider = createSecretHostedBillingProvider({
      apiKeyReference: reference,
      secrets: { resolveSecret: () => secret },
      authorizeBeforeRequest: authorize,
      fetchImplementation: fetch,
    });
    const pending = provider.createPortalSession(portalInput);
    current = false;
    finish?.(new TextEncoder().encode("sk_test_cloudmarkup_fixture"));
    await expect(pending).rejects.toMatchObject({
      code: "provider-unavailable",
    });
    expect(authorize).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("denies all event-processing methods without secret access", async () => {
    const resolveSecret = vi.fn(() =>
      Promise.reject(new Error("must not load")),
    );
    const provider = createSecretHostedBillingProvider({
      apiKeyReference: reference,
      secrets: { resolveSecret },
      authorizeBeforeRequest: () => Promise.resolve(),
    });
    await expect(
      provider.verifyWebhook({
        now: new Date(),
        rawBody: new Uint8Array(),
        signatureHeader: undefined,
      }),
    ).rejects.toMatchObject({ code: "billing-disabled" });
    await expect(
      provider.resolveSubscriptionSnapshot({} as never),
    ).rejects.toMatchObject({ code: "billing-disabled" });
    await expect(
      provider.retrieveQueuedWebhook?.({} as never),
    ).rejects.toMatchObject({ code: "billing-disabled" });
    expect(resolveSecret).not.toHaveBeenCalled();
  });
  it("separates provider capabilities even with a sandbox credential", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("must not send")));
    const hosted = new StripeBillingProvider({
      apiKey: "sk_test_cloudmarkup_fixture",
      signatureToleranceSeconds: 300,
      verificationMode: "hosted-sessions-only",
      fetchImplementation: fetch,
    });
    await expect(
      hosted.verifyWebhook({
        now: new Date(),
        rawBody: new Uint8Array(),
        signatureHeader: "irrelevant",
      }),
    ).rejects.toMatchObject({ code: "billing-disabled" });
    await expect(
      hosted.resolveSubscriptionSnapshot({} as never),
    ).rejects.toMatchObject({ code: "billing-disabled" });
    await expect(
      hosted.retrieveQueuedWebhook({} as never),
    ).rejects.toMatchObject({ code: "billing-disabled" });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      () =>
        new StripeBillingProvider({
          apiKey: "sk_test_cloudmarkup_fixture",
          signatureToleranceSeconds: 300,
          verificationMode: "hosted-sessions-only",
          webhookSigningSecret: "whsec_cloudmarkup_fixture",
        }),
    ).toThrow();
  });
  it.each([
    "https://billing.stripe.com:444/p/session/test",
    "https://billing.stripe.com\\evil.test/session",
    "https://evil.test/session",
    "https://billing.stripe.com/p/" + "a".repeat(4_096),
  ])(
    "rejects unsafe hosted destinations before returning a URL",
    async (url) => {
      const provider = new StripeBillingProvider({
        apiKey: "sk_test_cloudmarkup_fixture",
        signatureToleranceSeconds: 300,
        verificationMode: "hosted-sessions-only",
        fetchImplementation: () => Promise.resolve(Response.json({ url })),
      });
      await expect(
        provider.createPortalSession(portalInput),
      ).rejects.toMatchObject({ code: "provider-unavailable" });
    },
  );
});
