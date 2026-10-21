import { z } from "zod";

import { createDataEnvelopeSchema, utcTimestampSchema } from "./common.js";
import { monetaryMicrosSchema } from "./commercial.js";
import { organizationIdSchema } from "./resources.js";

export const billingPlanKeyV1Schema = z.enum(["starter", "pro"]);
export const createBillingCheckoutV1Schema = z
  .object({
    contractVersion: z.literal(1),
    planKey: billingPlanKeyV1Schema,
  })
  .strict();
export const createBillingPortalV1Schema = z
  .object({
    contractVersion: z.literal(1),
  })
  .strict();

export const billingPlanOptionV1Schema = z
  .object({
    key: billingPlanKeyV1Schema,
    displayName: z.string().min(1).max(64),
    currency: z.literal("USD"),
    monthlyPriceMicros: monetaryMicrosSchema,
    monthlyCreditUnits: z.number().int().min(0).max(1_000_000),
  })
  .strict();

export const billingWorkspaceV1Schema = z
  .object({
    contractVersion: z.literal(1),
    organizationId: organizationIdSchema,
    asOf: utcTimestampSchema,
    mode: z.enum(["disabled", "stripe-sandbox", "stripe-live"]),
    accountState: z.enum(["unprovisioned", "active", "suspended", "closed"]),
    subscriptionState: z.enum([
      "not-subscribed",
      "pending",
      "active",
      "past-due",
      "paused",
      "canceled",
      "incomplete",
    ]),
    currentPlanKey: billingPlanKeyV1Schema.nullable(),
    canCheckout: z.boolean(),
    canManage: z.boolean(),
    plans: z.array(billingPlanOptionV1Schema).length(2),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.plans.map((plan) => plan.key)).size !== 2)
      context.addIssue({
        code: "custom",
        path: ["plans"],
        message: "Both reviewed plans are required.",
      });
    if (
      (value.mode === "disabled" ||
        value.accountState === "suspended" ||
        value.accountState === "closed") &&
      (value.canCheckout || value.canManage)
    )
      context.addIssue({
        code: "custom",
        message: "Unavailable billing cannot offer hosted actions.",
      });
    if (
      value.subscriptionState === "not-subscribed" &&
      value.currentPlanKey !== null
    )
      context.addIssue({
        code: "custom",
        path: ["currentPlanKey"],
        message: "An unsubscribed account has no current paid plan.",
      });
    if (
      value.canCheckout &&
      !["not-subscribed", "canceled"].includes(value.subscriptionState)
    )
      context.addIssue({
        code: "custom",
        path: ["canCheckout"],
        message: "Existing subscriptions require the Portal.",
      });
  });

function hostedUrl(host: string) {
  return z
    .url()
    .max(4_096)
    .refine((value) => {
      const prefix = "https://" + host + "/";
      return (
        value.startsWith(prefix) &&
        value.length > prefix.length &&
        !Array.from(value).some(
          (character) =>
            character.charCodeAt(0) <= 32 ||
            character.charCodeAt(0) === 127 ||
            character === "\\",
        )
      );
    }, "The hosted billing destination is invalid.");
}

export const hostedBillingSessionV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      contractVersion: z.literal(1),
      organizationId: organizationIdSchema,
      kind: z.literal("checkout"),
      url: hostedUrl("checkout.stripe.com"),
    })
    .strict(),
  z
    .object({
      contractVersion: z.literal(1),
      organizationId: organizationIdSchema,
      kind: z.literal("portal"),
      url: hostedUrl("billing.stripe.com"),
    })
    .strict(),
]);

export const billingWorkspaceResponseV1Schema = createDataEnvelopeSchema(
  billingWorkspaceV1Schema,
);
export const hostedBillingSessionResponseV1Schema = createDataEnvelopeSchema(
  hostedBillingSessionV1Schema,
);
export type BillingWorkspaceV1 = z.output<typeof billingWorkspaceV1Schema>;
export type CreateBillingCheckoutV1 = z.output<
  typeof createBillingCheckoutV1Schema
>;
export type CreateBillingPortalV1 = z.output<
  typeof createBillingPortalV1Schema
>;
export type HostedBillingSessionV1 = z.output<
  typeof hostedBillingSessionV1Schema
>;
