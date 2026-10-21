export type BillingApplicationErrorCode =
  | "billing-disabled"
  | "idempotency-conflict"
  | "invalid-billing-configuration"
  | "invalid-provider-event"
  | "provider-unavailable"
  | "subscription-required";

export class BillingApplicationError extends Error {
  readonly code: BillingApplicationErrorCode;

  constructor(code: BillingApplicationErrorCode, safeMessage: string) {
    super(safeMessage);
    this.code = code;
    this.name = "BillingApplicationError";
  }
}
