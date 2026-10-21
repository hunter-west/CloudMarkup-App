import { z } from "zod";
import { createDataEnvelopeSchema, utcTimestampSchema } from "./common.js";
import { creditBalanceV1Schema, creditUnitsSchema } from "./commercial.js";

export const creditOverviewQueryV1Schema = z.object({}).strict();

/** A single ledger snapshot. Available buckets exclude reservations and expiry. */
export const creditOverviewV1Schema = z
  .object({
    contractVersion: z.literal(1),
    balance: creditBalanceV1Schema,
    availableByKind: z
      .object({
        monthly: creditUnitsSchema,
        purchased: creditUnitsSchema,
        other: creditUnitsSchema,
      })
      .strict(),
    nextExpiration: z
      .object({
        at: utcTimestampSchema,
        creditUnits: creditUnitsSchema.refine((value) => value > 0),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const total = Object.values(value.availableByKind).reduce(
      (sum, units) => sum + BigInt(units),
      0n,
    );
    if (total !== BigInt(value.balance.availableCreditUnits))
      context.addIssue({
        code: "custom",
        path: ["availableByKind"],
        message: "Available credit buckets must reconcile to the same balance.",
      });
    if (
      value.nextExpiration !== null &&
      (Date.parse(value.nextExpiration.at) <= Date.parse(value.balance.asOf) ||
        BigInt(value.nextExpiration.creditUnits) > total)
    )
      context.addIssue({
        code: "custom",
        path: ["nextExpiration"],
        message:
          "The next expiration must describe available credits after the snapshot time.",
      });
  });
export const creditOverviewResponseV1Schema = createDataEnvelopeSchema(
  creditOverviewV1Schema,
);
export type CreditOverviewV1 = z.output<typeof creditOverviewV1Schema>;
