import { z } from "zod";
import { createDataEnvelopeSchema } from "./common.js";
import { principalIdSchema } from "./resources.js";

/** A conditional account fence only; verified authentication remains the sole actor authority. */
export const accountCredentialHeadersV1Schema = z
  .object({ "x-cloudmarkup-account": principalIdSchema })
  .strict();
export const accountCredentialAttemptV1Schema = z.uuid();
const common = {
  contractVersion: z.literal(1),
  attemptId: accountCredentialAttemptV1Schema,
};
const password = z.string().min(1).max(256);
const email = z.email().max(320);
const code = z.string().regex(/^[0-9]{6}$/u);
export const changeAccountCredentialsV1Schema = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("password-change"),
      currentPassword: password,
      newPassword: password
        .min(14)
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9\s])\S+$/u),
    })
    .strict(),
  z.object({ ...common, action: z.literal("email-start"), email }).strict(),
  z.object({ ...common, action: z.literal("email-confirm"), code }).strict(),
  z.object({ ...common, action: z.literal("email-resend") }).strict(),
]);
export const accountCredentialStateV1Schema = z
  .object({
    contractVersion: z.literal(1),
    principalId: principalIdSchema,
    email: email.nullable(),
    emailVerified: z.boolean(),
    authenticatorEnabled: z.boolean(),
  })
  .strict()
  .refine((v) => !v.emailVerified || v.email !== null);
export const accountCredentialProblemV1Schema = z.enum([
  "incorrect-password",
  "password-policy",
  "incorrect-code",
  "expired-code",
  "email-unavailable",
  "rate-limited",
  "reauthenticate",
  "unavailable",
  "unknown",
]);
export const accountCredentialOutcomeV1Schema = z.enum([
  "succeeded",
  "rejected",
  "uncertain",
]);
export const accountCredentialResultV1Schema = z
  .object({
    ...common,
    principalId: principalIdSchema,
    action: z.enum([
      "password-change",
      "email-start",
      "email-confirm",
      "email-resend",
    ]),
    outcome: accountCredentialOutcomeV1Schema,
    problem: accountCredentialProblemV1Schema.nullable(),
    state: accountCredentialStateV1Schema.nullable(),
  })
  .strict()
  .refine((v) =>
    v.outcome === "succeeded"
      ? v.problem === null &&
        v.state !== null &&
        v.state.principalId === v.principalId
      : v.problem !== null && v.state === null,
  );
export const accountCredentialStateResponseV1Schema = createDataEnvelopeSchema(
  accountCredentialStateV1Schema,
);
export const accountCredentialResultResponseV1Schema = createDataEnvelopeSchema(
  accountCredentialResultV1Schema,
);
export type ChangeAccountCredentialsV1 = z.output<
  typeof changeAccountCredentialsV1Schema
>;
export type AccountCredentialStateV1 = z.output<
  typeof accountCredentialStateV1Schema
>;
export type AccountCredentialResultV1 = z.output<
  typeof accountCredentialResultV1Schema
>;
export type AccountCredentialProblemV1 = z.output<
  typeof accountCredentialProblemV1Schema
>;
export type AccountCredentialOutcomeV1 = z.output<
  typeof accountCredentialOutcomeV1Schema
>;
