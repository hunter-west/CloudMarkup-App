import { z } from "zod";
import {
  createDataEnvelopeSchema,
  createListEnvelopeSchema,
  paginationQueryShape,
  utcTimestampSchema,
} from "./common.js";
import { principalIdSchema } from "./resources.js";
export const accountSessionIdV1Schema = z
  .string()
  .regex(/^browser_[a-f0-9]{64}$/u);
export const accountSessionV1Schema = z
  .object({
    contractVersion: z.literal(1),
    principalId: principalIdSchema,
    id: accountSessionIdV1Schema,
    authenticatedAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
    current: z.boolean(),
  })
  .strict();
export const accountSessionListResponseV1Schema = createListEnvelopeSchema(
  accountSessionV1Schema,
);
export const accountSessionListQueryV1Schema = z
  .object({ ...paginationQueryShape })
  .strict();
export const changeAccountSessionsV1Schema = z.discriminatedUnion("action", [
  z
    .object({
      contractVersion: z.literal(1),
      action: z.literal("revoke"),
      sessionId: accountSessionIdV1Schema,
    })
    .strict(),
  z
    .object({ contractVersion: z.literal(1), action: z.literal("revoke-all") })
    .strict(),
]);
export const accountSessionChangeReceiptV1Schema = z
  .object({
    contractVersion: z.literal(1),
    principalId: principalIdSchema,
    action: z.enum(["revoke", "revoke-all"]),
    sessionId: accountSessionIdV1Schema.nullable(),
    authenticatedThrough: utcTimestampSchema.nullable(),
    occurredAt: utcTimestampSchema,
  })
  .strict()
  .refine((v) =>
    v.action === "revoke-all"
      ? v.sessionId === null && v.authenticatedThrough !== null
      : v.sessionId !== null && v.authenticatedThrough === null,
  );
export const accountSessionChangeResponseV1Schema = createDataEnvelopeSchema(
  accountSessionChangeReceiptV1Schema,
);
export type AccountSessionV1 = z.output<typeof accountSessionV1Schema>;
export type ChangeAccountSessionsV1 = z.output<
  typeof changeAccountSessionsV1Schema
>;
export type AccountSessionChangeReceiptV1 = z.output<
  typeof accountSessionChangeReceiptV1Schema
>;
