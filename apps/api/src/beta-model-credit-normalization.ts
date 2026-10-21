import type { CreditNormalizationPolicyVersionV1 } from "@cloudmarkup/domain";

/** Owner-approved beta conversion, not model-pricing or invocation authority.
 * One credit represents USD 0.01 of normalized cost, with a 30% markup on
 * provider cost (not a 30% margin). The canonical domain calculator uses exact
 * integer arithmetic: ceil(providerCostMicros * 13 / 100000), including zero.
 * Future host composition must select and pin this immutable policy through the
 * existing commercial pricing port. Do not rewrite historical reservations or
 * use customer credits to reduce the independent full provider-cost ceiling. */
export const betaModelCreditNormalizationPolicyV1: CreditNormalizationPolicyVersionV1 =
  Object.freeze({
    creditUnitMicros: 10_000,
    currencyCode: "USD",
    effectiveFrom: "2026-09-07T12:23:22.000Z",
    effectiveUntil: null,
    normalizationPolicyVersionId:
      "cloudmarkup.credit-normalization.beta-usd-cent-markup30.2026-09-07.v1",
    operatingBufferBasisPoints: 3_000,
    status: "enabled",
    version: 1,
  });
