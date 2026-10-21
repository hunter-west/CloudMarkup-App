import { z } from "zod";
/** Public display capabilities. Registration is enforced independently by Cognito. */
export const accountAccessV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    managedLogin: z.boolean(),
    registrationEnabled: z.boolean(),
  })
  .strict()
  .refine((v) => !v.registrationEnabled || v.managedLogin);
export type AccountAccessV1 = z.output<typeof accountAccessV1Schema>;
export const CLOSED_ACCOUNT_ACCESS_V1: AccountAccessV1 = Object.freeze({
  schemaVersion: 1,
  managedLogin: false,
  registrationEnabled: false,
});
