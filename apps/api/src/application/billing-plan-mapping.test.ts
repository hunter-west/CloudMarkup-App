import { describe, expect, it } from "vitest";
import {
  BETA_SHARING_EFFECTIVE_FROM,
  BETA_SHARING_PLAN_IDS,
} from "@cloudmarkup/domain";
import {
  BILLING_PLAN_MAPPING_VERSION,
  BILLING_SHARING_PLAN_MAPPING_VERSION,
  billingPlanKeyForVersion,
  billingPlanVersionForMapping,
  isBillingPlanMappingVersion,
  selectBillingSubscriptionPlan,
} from "./billing-plan-mapping.js";

const input = {
  configuredVersion: BILLING_SHARING_PLAN_MAPPING_VERSION,
  planKey: "starter" as const,
  currentPlanVersionId: null,
  currentPeriodStart: BETA_SHARING_EFFECTIVE_FROM,
  currentStateRead: true,
  observedAt: "2026-09-07T16:00:00.000Z",
};
const legacy = "planver_starter_2026_08_14_v1";

describe("closed Stripe sharing mapping", () => {
  it.each([BILLING_PLAN_MAPPING_VERSION, BILLING_SHARING_PLAN_MAPPING_VERSION])(
    "accepts only reviewed mapping %s",
    (version) => {
      expect(isBillingPlanMappingVersion(version)).toBe(true);
      for (const key of ["starter", "pro"] as const)
        expect(
          billingPlanKeyForVersion(billingPlanVersionForMapping(version, key)),
        ).toBe(key);
    },
  );
  it.each([
    undefined,
    null,
    "",
    " ",
    "another-v1",
    `${BILLING_PLAN_MAPPING_VERSION} `,
  ])("rejects unknown mapping %j", (value) => {
    expect(isBillingPlanMappingVersion(value)).toBe(false);
    expect(billingPlanKeyForVersion(value)).toBeUndefined();
  });
  it.each(["starter", "pro"] as const)(
    "selects new %s only at an effective period",
    (key) => {
      const before = new Date(
        Date.parse(BETA_SHARING_EFFECTIVE_FROM) - 1,
      ).toISOString();
      expect(
        selectBillingSubscriptionPlan({
          ...input,
          planKey: key,
          currentPeriodStart: before,
        }),
      ).toBe(billingPlanVersionForMapping(BILLING_PLAN_MAPPING_VERSION, key));
      expect(selectBillingSubscriptionPlan({ ...input, planKey: key })).toBe(
        BETA_SHARING_PLAN_IDS[key],
      );
    },
  );
  it("leaves the legacy default and missing-period subscription on the legacy plan", () => {
    expect(
      selectBillingSubscriptionPlan({
        ...input,
        configuredVersion: BILLING_PLAN_MAPPING_VERSION,
      }),
    ).toBe(legacy);
    expect(
      selectBillingSubscriptionPlan({ ...input, currentPeriodStart: null }),
    ).toBe(legacy);
    expect(
      selectBillingSubscriptionPlan({ ...input, currentPlanVersionId: legacy }),
    ).toBe(BETA_SHARING_PLAN_IDS.starter);
  });
  it("requires authenticated current state for adoption and preserves sharing on a compatible legacy worker", () => {
    expect(
      selectBillingSubscriptionPlan({ ...input, currentStateRead: false }),
    ).toBeNull();
    expect(
      selectBillingSubscriptionPlan({
        ...input,
        configuredVersion: BILLING_PLAN_MAPPING_VERSION,
        currentPlanVersionId: BETA_SHARING_PLAN_IDS.pro,
      }),
    ).toBe(BETA_SHARING_PLAN_IDS.starter);
    expect(
      selectBillingSubscriptionPlan({
        ...input,
        configuredVersion: BILLING_PLAN_MAPPING_VERSION,
        currentPlanVersionId: BETA_SHARING_PLAN_IDS.pro,
        currentStateRead: false,
      }),
    ).toBeNull();
  });
  it.each(["planver_unrecognized", "", "planver_free_2026_08_14_v1"])(
    "never reinterprets unknown current canonical plan %s",
    (currentPlanVersionId) => {
      expect(
        selectBillingSubscriptionPlan({ ...input, currentPlanVersionId }),
      ).toBeNull();
      expect(
        selectBillingSubscriptionPlan({
          ...input,
          currentPlanVersionId,
          configuredVersion: BILLING_PLAN_MAPPING_VERSION,
        }),
      ).toBeNull();
    },
  );
  it.each([
    { observedAt: "invalid" },
    { currentPeriodStart: "invalid" },
    { currentPeriodStart: "2026-10-01T00:00:00.000Z" },
    {
      currentPlanVersionId: BETA_SHARING_PLAN_IDS.starter,
      currentPeriodStart: "2026-09-01T00:00:00.000Z",
    },
  ])("fails closed on inconsistent new-plan chronology %j", (override) => {
    expect(selectBillingSubscriptionPlan({ ...input, ...override })).toBeNull();
  });
});
