export const CREDIT_TOP_UP_POLICY_VERSION =
  "cloudmarkup-credit-top-ups-2026-09-30-v1" as const;
export const CREDIT_TOP_UP_PACKS_V1 = Object.freeze([
  Object.freeze({
    key: "small",
    creditUnits: 100,
    priceMicros: 5_000_000,
    currency: "USD",
  }),
  Object.freeze({
    key: "medium",
    creditUnits: 350,
    priceMicros: 15_000_000,
    currency: "USD",
  }),
  Object.freeze({
    key: "large",
    creditUnits: 800,
    priceMicros: 30_000_000,
    currency: "USD",
  }),
] as const);
export const CREDIT_TOP_UP_EXPIRATION_POLICY_V1 = Object.freeze({
  kind: "does-not-expire" as const,
  policyVersion: CREDIT_TOP_UP_POLICY_VERSION,
  expiresAt: null,
});

export type CreditTopUpPack = (typeof CREDIT_TOP_UP_PACKS_V1)[number];
export type CreditTopUpPackKey = CreditTopUpPack["key"];
export function creditTopUpPack(key: unknown): CreditTopUpPack | undefined {
  return CREDIT_TOP_UP_PACKS_V1.find((pack) => pack.key === key);
}
