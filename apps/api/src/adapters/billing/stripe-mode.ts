/** Keys and provider evidence must belong to the explicitly configured mode. */
export function isStripeApiKeyForEnvironment(
  value: unknown,
  environment: "test" | "live",
): value is string {
  return (
    ["test", "live"].includes(environment) &&
    typeof value === "string" &&
    new RegExp("^(?:sk|rk)_" + environment + "_[A-Za-z0-9_]+$", "u").test(value)
  );
}
