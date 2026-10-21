import { z } from "zod";
import { createDataEnvelopeSchema } from "./common.js";
import { principalIdSchema } from "./resources.js";
import {
  accountCredentialAttemptV1Schema,
  accountCredentialOutcomeV1Schema,
  accountCredentialProblemV1Schema,
} from "./account-credentials.js";

export const accountRecoveryContactV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), value: z.email().max(320) }).strict(),
  z
    .object({
      kind: z.literal("url"),
      value: z
        .url({ protocol: /^https$/u })
        .max(2048)
        .regex(/^https:\/\/[^/?#@]+(?:[/?#]|$)/iu),
    })
    .strict(),
]);
export const accountAuthenticatorEnrollmentV1Schema = z
  .object({
    id: z.uuid().toLowerCase(),
    expiresAt: z.iso.datetime(),
    status: z.enum(["starting", "ready", "verifying", "uncertain"]),
    currentSession: z.boolean(),
  })
  .strict();
export const accountAuthenticatorStateV1Schema = z
  .object({
    contractVersion: z.literal(1),
    principalId: principalIdSchema,
    enabled: z.boolean(),
    enrollmentAvailable: z.boolean(),
    recoveryContact: accountRecoveryContactV1Schema.nullable(),
    enrollment: accountAuthenticatorEnrollmentV1Schema.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      !value.enrollmentAvailable ||
      (value.recoveryContact !== null && !value.enabled),
  );
const common = {
  contractVersion: z.literal(1),
  attemptId: accountCredentialAttemptV1Schema.toLowerCase(),
};
export const startAccountAuthenticatorV1Schema = z
  .object({
    ...common,
    acknowledgedRecovery: z.literal(true),
  })
  .strict();
export const changeAccountAuthenticatorV1Schema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        ...common,
        action: z.literal("verify-enable"),
        enrollmentId: z.uuid().toLowerCase(),
        code: z.string().regex(/^[0-9]{6}$/u),
      })
      .strict(),
    z
      .object({
        ...common,
        action: z.literal("cancel-setup"),
        enrollmentId: z.uuid().toLowerCase(),
      })
      .strict(),
    z
      .object({
        ...common,
        action: z.literal("disable"),
        acknowledgedReduction: z.literal(true),
      })
      .strict(),
  ],
);
export const accountAuthenticatorProblemV1Schema = z.enum([
  ...accountCredentialProblemV1Schema.options,
  "already-enabled",
  "not-enabled",
  "setup-active",
  "setup-expired",
  "setup-uncertain",
  "recovery-unavailable",
]);
const outcome = {
  ...common,
  principalId: principalIdSchema,
  outcome: accountCredentialOutcomeV1Schema,
  problem: accountAuthenticatorProblemV1Schema.nullable(),
  state: accountAuthenticatorStateV1Schema.nullable(),
};
export const accountAuthenticatorStartResultV1Schema = z
  .object({
    ...outcome,
    action: z.literal("start"),
    secretCode: z
      .string()
      .regex(/^[A-Z2-7]{16,128}$/u)
      .nullable(),
  })
  .strict()
  .refine((value) =>
    value.outcome === "succeeded"
      ? value.problem === null &&
        value.secretCode !== null &&
        value.state?.enrollmentAvailable === true &&
        value.state.principalId === value.principalId &&
        !value.state.enabled &&
        value.state.enrollment?.id === value.attemptId &&
        value.state.enrollment.status === "ready" &&
        value.state.enrollment.currentSession
      : value.problem !== null &&
        value.secretCode === null &&
        value.state === null,
  );
export const accountAuthenticatorChangeResultV1Schema = z
  .object({
    ...outcome,
    action: z.enum(["verify-enable", "cancel-setup", "disable"]),
  })
  .strict()
  .refine((value) =>
    value.outcome === "succeeded"
      ? value.problem === null &&
        value.state?.principalId === value.principalId &&
        value.state.enrollment === null &&
        (value.action === "cancel-setup" ||
          value.state.enabled === (value.action === "verify-enable"))
      : value.problem !== null && value.state === null,
  );
export const accountAuthenticatorStateResponseV1Schema =
  createDataEnvelopeSchema(accountAuthenticatorStateV1Schema);
export const accountAuthenticatorStartResponseV1Schema =
  createDataEnvelopeSchema(accountAuthenticatorStartResultV1Schema);
export const accountAuthenticatorChangeResponseV1Schema =
  createDataEnvelopeSchema(accountAuthenticatorChangeResultV1Schema);
export type AccountRecoveryContactV1 = z.output<
  typeof accountRecoveryContactV1Schema
>;
export type AccountAuthenticatorEnrollmentV1 = z.output<
  typeof accountAuthenticatorEnrollmentV1Schema
>;
export type AccountAuthenticatorStateV1 = z.output<
  typeof accountAuthenticatorStateV1Schema
>;
export type StartAccountAuthenticatorV1 = z.output<
  typeof startAccountAuthenticatorV1Schema
>;
export type ChangeAccountAuthenticatorV1 = z.output<
  typeof changeAccountAuthenticatorV1Schema
>;
export type AccountAuthenticatorProblemV1 = z.output<
  typeof accountAuthenticatorProblemV1Schema
>;
export type AccountAuthenticatorStartResultV1 = z.output<
  typeof accountAuthenticatorStartResultV1Schema
>;
export type AccountAuthenticatorChangeResultV1 = z.output<
  typeof accountAuthenticatorChangeResultV1Schema
>;
