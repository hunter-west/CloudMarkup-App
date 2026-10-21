import {
  accountAccessV1Schema,
  CLOSED_ACCOUNT_ACCESS_V1,
  type AccountAccessV1,
} from "@cloudmarkup/api-contract";
/** Nonsecret configuration emitted from the same CDK input as the user-pool gate. */
export function readProductionAccountAccess(
  environment: NodeJS.ProcessEnv,
): AccountAccessV1 {
  const value = environment["CLOUDMARKUP_ACCOUNT_ACCESS"];
  if (value === undefined) return CLOSED_ACCOUNT_ACCESS_V1;
  try {
    return accountAccessV1Schema.parse(JSON.parse(value) as unknown);
  } catch {
    throw new TypeError("CLOUDMARKUP_ACCOUNT_ACCESS is invalid.");
  }
}
