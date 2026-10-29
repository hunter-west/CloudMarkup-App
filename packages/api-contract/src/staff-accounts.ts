import { z } from "zod";
import { createDataEnvelopeSchema } from "./common.js";
import { organizationIdSchema, principalIdSchema } from "./resources.js";
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const units = z.string().regex(/^(0|[1-9][0-9]{0,17})$/u);
export const staffPermissionV1Schema = z.enum([
  "accounts.read",
  "credits.grant",
  "credits.revoke",
  "operations.manage",
  "trials.grant",
  "trials.revoke",
]);
export const staffAccessV1Schema = z
  .object({
    contractVersion: z.literal(1),
    permissions: z.array(staffPermissionV1Schema).max(6),
  })
  .strict();
export const staffAccessResponseV1Schema =
  createDataEnvelopeSchema(staffAccessV1Schema);
export const staffAccountV1Schema = z
  .object({
    contractVersion: z.literal(1),
    organizationId: organizationIdSchema,
    billingAccountId: identifier,
    displayName: z.string().min(1).max(120),
    kind: z.enum(["personal", "organization"]),
    organizationState: z.enum(["active", "suspended"]),
    billingState: z.enum(["active", "suspended", "closed"]),
    subscriptionState: z.enum([
      "not-subscribed",
      "pending",
      "active",
      "past-due",
      "paused",
      "canceled",
      "incomplete",
    ]),
    planDisplayName: z.string().min(1).max(120).nullable(),
    expensiveOperationsEnabled: z.boolean(),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const staffAccountListV1Schema = z
  .object({
    contractVersion: z.literal(1),
    items: z.array(staffAccountV1Schema).max(50),
    nextCursor: organizationIdSchema.optional(),
  })
  .strict();
export const staffAccountListResponseV1Schema = createDataEnvelopeSchema(
  staffAccountListV1Schema,
);
/** A preview does not claim a persisted account, subscription or grant. */
export const staffUnprovisionedAccountV2Schema = staffAccountV1Schema
  .extend({
    contractVersion: z.literal(2),
    billingState: z.literal("unprovisioned"),
    subscriptionState: z.literal("not-subscribed"),
    planDisplayName: z.null(),
    expensiveOperationsEnabled: z.literal(false),
    version: z.literal(0),
    organizationVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const staffAccountSummarySchema = z.union([
  staffAccountV1Schema,
  staffUnprovisionedAccountV2Schema,
]);
export const staffAccountListV2Schema = staffAccountListV1Schema
  .extend({
    contractVersion: z.literal(2),
    items: z.array(staffAccountSummarySchema).max(50),
  })
  .strict();
export const staffAccountListSchema = z.union([
  staffAccountListV1Schema,
  staffAccountListV2Schema,
]);
export const staffAccountListResponseSchema = createDataEnvelopeSchema(
  staffAccountListSchema,
);
export const staffCreditGrantV1Schema = z
  .object({
    id: identifier,
    creditUnits: units,
    availableCreditUnits: units,
    reservedCreditUnits: units,
    consumedCreditUnits: units,
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    actorPrincipalId: principalIdSchema,
    reason: z.string().max(300),
  })
  .strict();
export const staffActionReceiptV1Schema = z
  .object({
    contractVersion: z.literal(1),
    actionId: identifier,
    organizationId: organizationIdSchema,
    billingAccountId: identifier,
    actorPrincipalId: principalIdSchema,
    action: z.enum([
      "grant-credits",
      "revoke-credits",
      "set-operations",
      "grant-trial",
      "revoke-trial",
    ]),
    trialId: identifier.optional(),
    trialExpiresAt: z.iso.datetime().optional(),
    creditUnits: units.nullable(),
    creditGrantId: identifier.nullable(),
    expensiveOperationsEnabled: z.boolean().nullable(),
    reason: z.string().min(5).max(300),
    occurredAt: z.iso.datetime(),
    accountVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .superRefine((receipt, context) => {
    const trial =
      receipt.action === "grant-trial" || receipt.action === "revoke-trial";
    if (
      trial &&
      (!receipt.trialId ||
        !receipt.trialExpiresAt ||
        !receipt.creditGrantId ||
        receipt.creditUnits === null ||
        receipt.expensiveOperationsEnabled !== null)
    )
      context.addIssue({
        code: "custom",
        message:
          "A trial receipt requires its exact trial, grant, credit and expiry evidence.",
      });
    if (
      !trial &&
      (receipt.trialId !== undefined || receipt.trialExpiresAt !== undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "Paid credit and operations receipts cannot claim trial evidence.",
      });
  });
export const staffTrialV1Schema = z
  .object({
    contractVersion: z.literal(1),
    id: identifier,
    creditGrantId: identifier,
    startsAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    state: z.enum([
      "active",
      "expired",
      "revoked",
      "superseded",
      "unavailable",
    ]),
    creditUnits: units,
    availableCreditUnits: units,
    reservedCreditUnits: units,
  })
  .strict();
export const staffAccountDetailV1Schema = z
  .object({
    contractVersion: z.literal(1),
    account: staffAccountV1Schema,
    trial: staffTrialV1Schema.optional(),
    availableCreditUnits: units,
    reservedCreditUnits: units,
    grants: z.array(staffCreditGrantV1Schema).max(100),
    history: z.array(staffActionReceiptV1Schema).max(100),
  })
  .strict();
export const staffAccountDetailResponseV1Schema = createDataEnvelopeSchema(
  staffAccountDetailV1Schema,
);
export const staffAccountDetailV2Schema = staffAccountDetailV1Schema
  .extend({
    contractVersion: z.literal(2),
    account: staffUnprovisionedAccountV2Schema,
    availableCreditUnits: z.literal("0"),
    reservedCreditUnits: z.literal("0"),
    grants: z.tuple([]),
    history: z.tuple([]),
    trial: z.never().optional(),
  })
  .strict();
export const staffAccountDetailSchema = z.union([
  staffAccountDetailV1Schema,
  staffAccountDetailV2Schema,
]);
export const staffAccountDetailResponseSchema = createDataEnvelopeSchema(
  staffAccountDetailSchema,
);
export const staffActionReceiptResponseV1Schema = createDataEnvelopeSchema(
  staffActionReceiptV1Schema,
);
const reason = z
  .string()
  .trim()
  .min(5)
  .max(300)
  .refine(
    (value) =>
      Array.from(value).every(
        (character) =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ),
    "Use a single-line reason without sensitive information.",
  );
const common = {
  contractVersion: z.literal(1),
  confirmBillingAccountId: identifier,
  reason,
};
export const staffAccountActionV1Schema = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("grant-trial"),
      creditUnits: z.number().int().min(1).max(1000),
      expiresInDays: z.number().int().min(1).max(30),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("revoke-trial"),
      trialId: identifier,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("grant-credits"),
      creditUnits: z.number().int().min(1).max(100000),
      expiresInDays: z.number().int().min(1).max(365),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("revoke-credits"),
      creditGrantId: identifier,
      creditUnits: z.number().int().min(1).max(100000),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("set-operations"),
      enabled: z.boolean(),
    })
    .strict(),
]);
export const staffAccountSearchV1Schema = z
  .object({
    q: z.string().trim().min(2).max(120),
    cursor: organizationIdSchema.optional(),
  })
  .strict();
export type StaffPermissionV1 = z.infer<typeof staffPermissionV1Schema>;
export type StaffAccessV1 = z.infer<typeof staffAccessV1Schema>;
export type StaffAccountV1 = z.infer<typeof staffAccountV1Schema>;
export type StaffAccountSummary = z.infer<typeof staffAccountSummarySchema>;
export type StaffAccountList = z.infer<typeof staffAccountListSchema>;
export type StaffAccountDetail = z.infer<typeof staffAccountDetailSchema>;
export type StaffAccountListV1 = z.infer<typeof staffAccountListV1Schema>;
export type StaffAccountDetailV1 = z.infer<typeof staffAccountDetailV1Schema>;
export type StaffAccountActionV1 = z.infer<typeof staffAccountActionV1Schema>;
export type StaffActionReceiptV1 = z.infer<typeof staffActionReceiptV1Schema>;
