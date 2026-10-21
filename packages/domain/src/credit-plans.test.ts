import { describe, expect, it } from "vitest";
import {
  BETA_CREDIT_PLAN_CONFIGURATION_VERSION,
  validatePlanVersionV1,
} from "./commercial.js";
import {
  BETA_CREDIT_EFFECTIVE_FROM,
  BETA_CREDIT_PRO_PLAN_ID,
  BETA_CREDIT_PRO_PLAN_V1,
  BETA_EXPORT_PRO_PLAN_V1,
  evaluateOrganizationSeatAdmissionV1,
  includedMembersForSharingPlanV1,
  sharingPlanConfigurationVersionV1,
} from "./organization-membership-policy.js";
import {
  CREDIT_TOP_UP_PACKS_V1,
  CREDIT_TOP_UP_EXPIRATION_POLICY_V1,
} from "./credit-top-up-policy.js";

describe("approved September credit policy", () => {
  it("adds only the Pro allowance and version authority, retaining price and features", () => {
    expect(BETA_CREDIT_PRO_PLAN_V1).toEqual({
      ...BETA_EXPORT_PRO_PLAN_V1,
      configurationVersion: BETA_CREDIT_PLAN_CONFIGURATION_VERSION,
      effectiveFrom: BETA_CREDIT_EFFECTIVE_FROM,
      planVersionId: BETA_CREDIT_PRO_PLAN_ID,
      includedCreditGrants: [{ kind: "monthly", units: 1250 }],
    });
    expect(BETA_EXPORT_PRO_PLAN_V1.includedCreditGrants).toEqual([
      { kind: "monthly", units: 1000 },
    ]);
    expect(BETA_CREDIT_PRO_PLAN_V1.proposedMonthlyPrice?.unitAmountMicros).toBe(
      39_000_000,
    );
    expect(() => {
      validatePlanVersionV1(BETA_CREDIT_PRO_PLAN_V1);
    }).not.toThrow();
    expect(
      Object.isFrozen(BETA_CREDIT_PRO_PLAN_V1.includedCreditGrants[0]),
    ).toBe(true);
  });
  it("retains organization admission and rejects pre-effective membership", () => {
    expect(includedMembersForSharingPlanV1(BETA_CREDIT_PRO_PLAN_ID)).toBe(10);
    expect(sharingPlanConfigurationVersionV1(BETA_CREDIT_PRO_PLAN_ID)).toBe(
      BETA_CREDIT_PLAN_CONFIGURATION_VERSION,
    );
    expect(
      evaluateOrganizationSeatAdmissionV1({
        planVersionId: BETA_CREDIT_PRO_PLAN_ID,
        at: BETA_CREDIT_EFFECTIVE_FROM,
        memberships: [],
      }),
    ).toEqual({ allowed: true });
    expect(
      evaluateOrganizationSeatAdmissionV1({
        planVersionId: BETA_CREDIT_PRO_PLAN_ID,
        at: "2026-09-29T23:59:59.999Z",
        memberships: [],
      }),
    ).toEqual({ allowed: false, reason: "plan-unavailable" });
  });
  it("pins the revised USD packs to non-expiring purchased credits", () => {
    expect(
      CREDIT_TOP_UP_PACKS_V1.map((pack) => [
        pack.priceMicros,
        pack.creditUnits,
      ]),
    ).toEqual([
      [5_000_000, 100],
      [15_000_000, 350],
      [30_000_000, 800],
    ]);
    expect(CREDIT_TOP_UP_PACKS_V1.every(Object.isFrozen)).toBe(true);
    expect(CREDIT_TOP_UP_EXPIRATION_POLICY_V1).toMatchObject({
      kind: "does-not-expire",
      expiresAt: null,
    });
  });
});
