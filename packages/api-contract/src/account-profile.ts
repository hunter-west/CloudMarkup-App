import { z } from "zod";
import { createDataEnvelopeSchema } from "./common.js";
import { principalIdSchema } from "./resources.js";

export const reservedAccountUsernamesV1 = Object.freeze([
  "admin",
  "administrator",
  "api",
  "billing",
  "cloudmarkup",
  "help",
  "security",
  "support",
  "system",
]);
export const accountUsernameV1Schema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,31}$/u)
  .refine(
    (value) => !reservedAccountUsernamesV1.includes(value),
    "This username is unavailable.",
  );
const displayName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (value) =>
      !Array.from(value).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ),
    "Use a single-line display name.",
  );
export const accountProfileV1Schema = z
  .object({
    contractVersion: z.literal(1),
    principalId: principalIdSchema,
    // Preserve the existing current-principal v1 read contract for legacy names.
    displayName: z.string().trim().min(1).max(120),
    username: accountUsernameV1Schema.nullable(),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const accountProfileResponseV1Schema = createDataEnvelopeSchema(
  accountProfileV1Schema,
);
export const updateAccountProfileV1Schema = z
  .object({
    contractVersion: z.literal(1),
    displayName,
    username: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(accountUsernameV1Schema)
      .nullable(),
  })
  .strict();
export type AccountProfileV1 = z.output<typeof accountProfileV1Schema>;
export type UpdateAccountProfileV1 = z.output<
  typeof updateAccountProfileV1Schema
>;
