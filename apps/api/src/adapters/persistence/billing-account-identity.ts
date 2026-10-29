import { createHash } from "node:crypto";

/** Stable identity shared by lazy Checkout and reviewed staff initialization. */
export function billingAccountIdForOrganization(
  organizationId: string,
): string {
  return (
    "billing_" +
    createHash("sha256")
      .update("billing-account-v1\u0000" + organizationId)
      .digest("hex")
  );
}
