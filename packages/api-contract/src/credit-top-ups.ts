import { z } from "zod";
import { createDataEnvelopeSchema, utcTimestampSchema } from "./common.js";
import { organizationIdSchema } from "./resources.js";
import { monetaryMicrosSchema } from "./commercial.js";
export const creditTopUpPackKeyV1Schema = z.enum(["small", "medium", "large"]);
export const createCreditTopUpV1Schema = z
  .object({
    contractVersion: z.literal(1),
    packKey: creditTopUpPackKeyV1Schema,
  })
  .strict();
export const creditTopUpWorkspaceV1Schema = z
  .object({
    contractVersion: z.literal(1),
    organizationId: organizationIdSchema,
    asOf: utcTimestampSchema,
    mode: z.enum(["disabled", "stripe-sandbox", "stripe-live"]),
    canPurchase: z.boolean(),
    availableCreditUnits: z.string().regex(/^(0|[1-9][0-9]{0,18})$/u),
    packs: z
      .array(
        z
          .object({
            key: creditTopUpPackKeyV1Schema,
            creditUnits: z.number().int().positive(),
            priceMicros: monetaryMicrosSchema,
            currency: z.literal("USD"),
            expiration: z.literal("never"),
          })
          .strict(),
      )
      .length(3),
    latestPurchase: z
      .object({
        id: z.string().regex(/^topup_[a-f0-9]{32}$/u),
        packKey: creditTopUpPackKeyV1Schema,
        state: z.enum(["pending", "created", "expired", "fulfilled", "review"]),
        needsReview: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.packs.map((pack) => pack.key)).size !== 3)
      context.addIssue({
        code: "custom",
        path: ["packs"],
        message: "All reviewed packs are required.",
      });
    if (value.mode === "disabled" && value.canPurchase)
      context.addIssue({
        code: "custom",
        path: ["canPurchase"],
        message: "Disabled purchases cannot create Checkout.",
      });
  });
export const creditTopUpWorkspaceResponseV1Schema = createDataEnvelopeSchema(
  creditTopUpWorkspaceV1Schema,
);
export type CreditTopUpWorkspaceV1 = z.output<
  typeof creditTopUpWorkspaceV1Schema
>;
export type CreateCreditTopUpV1 = z.output<typeof createCreditTopUpV1Schema>;
