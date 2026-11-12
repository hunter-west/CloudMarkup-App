import { z } from "zod";
import { createDataEnvelopeSchema } from "./common.js";
import { organizationIdSchema } from "./resources.js";

const instant = z.iso
  .datetime()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
const reservationId = z.string().regex(/^beta-ai\.[a-f0-9]{64}$/u);
const cost = z.string().regex(/^(0|[1-9][0-9]{0,39})$/u);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const staffProviderCostQueryV1Schema = z
  .object({
    from: instant,
    until: instant,
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/u)
      .max(2048)
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.from < value.until,
    "The report interval must be increasing.",
  );
/** This cursor binds a page, not authority. Every page is independently authorized. */
export const staffProviderCostCursorV1Schema = z
  .object({
    contractVersion: z.literal(1),
    organizationId: organizationIdSchema,
    from: instant,
    until: instant,
    afterReservationId: reservationId,
  })
  .strict();
const status = z.enum([
  "known",
  "not-incurred",
  "unresolved",
  "conflict",
  "unsupported-pricing",
]);
const record = z
  .object({
    organizationId: organizationIdSchema,
    reservationId,
    accountingStatus: status,
    providerCostMicros: cost.nullable(),
    providerCostCurrency: z.literal("USD").nullable(),
    counts: z
      .object({
        inputTokens: count,
        outputTokens: count,
        cacheReadInputTokens: count,
      })
      .strict()
      .nullable(),
    evidenceSources: z
      .array(z.enum(["observation", "retained-legacy", "ledger"]))
      .max(3),
    financialStatus: z.enum(["active", "settled", "released", "expired"]),
    cleanupPending: z.boolean(),
    pricingVersionId: z.string().min(1).max(128),
    chargingPolicyVersion: z.string().min(1).max(128),
  })
  .strict();
const pageCount = z.number().int().min(0).max(25);
export const staffProviderCostReportV1Schema = z
  .object({
    contractVersion: z.literal(1),
    organizationId: organizationIdSchema,
    cohort: z.object({ from: instant, until: instant }).strict(),
    asOf: z.iso.datetime(),
    records: z.array(record).max(25),
    nextCursor: z.string().max(2048).nullable(),
    pageOnly: z.literal(true),
    counts: z
      .object({
        known: pageCount,
        "not-incurred": pageCount,
        unresolved: pageCount,
        conflict: pageCount,
        "unsupported-pricing": pageCount,
      })
      .strict(),
    knownProviderCostMicros: cost.nullable(),
    knownProviderCostCurrency: z.literal("USD").nullable(),
    evidenceComplete: z.boolean(),
    pointInTimeCohortComplete: z.boolean(),
  })
  .strict()
  .superRefine((page, context) => {
    const counts = {
      known: 0,
      "not-incurred": 0,
      unresolved: 0,
      conflict: 0,
      "unsupported-pricing": 0,
    };
    let sum = 0n;
    for (const item of page.records) {
      counts[item.accountingStatus]++;
      if (
        item.organizationId !== page.organizationId ||
        (item.accountingStatus === "known"
          ? item.providerCostMicros === null ||
            item.providerCostCurrency !== "USD" ||
            item.counts === null
          : item.providerCostMicros !== null ||
            item.providerCostCurrency !== null)
      )
        context.addIssue({
          code: "custom",
          message: "The report record is inconsistent.",
        });
      if (item.providerCostMicros !== null)
        sum += BigInt(item.providerCostMicros);
    }
    if (
      Object.keys(counts).some(
        (key) =>
          counts[key as keyof typeof counts] !==
          page.counts[key as keyof typeof counts],
      ) ||
      page.knownProviderCostMicros !==
        (counts.known === 0 ? null : sum.toString()) ||
      page.knownProviderCostCurrency !== (counts.known === 0 ? null : "USD") ||
      page.evidenceComplete !==
        (counts.unresolved + counts.conflict + counts["unsupported-pricing"] ===
          0)
    )
      context.addIssue({
        code: "custom",
        message: "The page accounting summary is inconsistent.",
      });
  });
export const staffProviderCostResponseV1Schema = createDataEnvelopeSchema(
  staffProviderCostReportV1Schema,
);
export type StaffProviderCostQueryV1 = z.infer<
  typeof staffProviderCostQueryV1Schema
>;
export type StaffProviderCostReportV1 = z.infer<
  typeof staffProviderCostReportV1Schema
>;
