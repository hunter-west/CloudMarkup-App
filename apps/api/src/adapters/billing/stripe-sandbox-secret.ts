import { isStripeApiKeyForEnvironment } from "./stripe-mode.js";
import { BillingApplicationError } from "../../application/billing.js";

/** Decode only a mode-matched plain key or one exact-value JSON field. */
export function decodeStripeApiKey(
  bytes: Uint8Array,
  environment: "test" | "live",
): string {
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (isStripeApiKeyForEnvironment(raw, environment)) return raw;
    const object: unknown = JSON.parse(raw);
    if (typeof object !== "object" || object === null || Array.isArray(object))
      throw new Error();
    const values = Object.values(object);
    if (
      values.length !== 1 ||
      typeof values[0] !== "string" ||
      !isStripeApiKeyForEnvironment(values[0], environment)
    )
      throw new Error();
    return values[0];
  } catch {
    throw new BillingApplicationError(
      "billing-disabled",
      "The configured billing secret is unavailable.",
    );
  } finally {
    bytes.fill(0);
  }
}

/** Backward-compatible test-mode decoder. */
export function decodeStripeSandboxApiKey(bytes: Uint8Array): string {
  return decodeStripeApiKey(bytes, "test");
}
