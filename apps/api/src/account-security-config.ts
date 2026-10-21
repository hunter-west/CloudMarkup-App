import { z } from "zod";
import { accountRecoveryContactV1Schema } from "@cloudmarkup/api-contract";
/** Operator-owned nonsecret input; no default support contact is invented. */
export const accountSecurityConfigurationV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    recoveryContact: accountRecoveryContactV1Schema.nullable(),
  })
  .strict();
export type AccountSecurityConfigurationV1 = z.output<
  typeof accountSecurityConfigurationV1Schema
>;
export function readProductionAccountSecurity(
  environment: NodeJS.ProcessEnv,
): AccountSecurityConfigurationV1 {
  const value = environment["CLOUDMARKUP_ACCOUNT_SECURITY"];
  if (value === undefined) return { schemaVersion: 1, recoveryContact: null };
  try {
    return accountSecurityConfigurationV1Schema.parse(
      JSON.parse(value) as unknown,
    );
  } catch {
    throw new TypeError("CLOUDMARKUP_ACCOUNT_SECURITY is invalid.");
  }
}
