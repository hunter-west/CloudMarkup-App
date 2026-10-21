import { ApplicationError } from "./errors.js";

/** Trusted server composition boundary, including ordinary JavaScript callers.
 * Only omission selects hosted funding; null/unknown values never downgrade. */
export function requireOperationFundingSource(
  raw: unknown,
): "hosted-credits" | "provider-direct" {
  if (raw === undefined) return "hosted-credits";
  if (raw !== "hosted-credits" && raw !== "provider-direct")
    throw new ApplicationError(
      "service_unavailable",
      "The configured funding mode is unavailable.",
    );
  return raw;
}
