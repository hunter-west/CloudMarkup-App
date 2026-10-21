import { describe, expect, it } from "vitest";
import {
  BETA_CREDIT_EFFECTIVE_FROM,
  BETA_CREDIT_PRO_PLAN_ID,
  BETA_EXPORT_PRO_PLAN_ID,
} from "@cloudmarkup/domain";
import {
  BILLING_CREDIT_PLAN_MAPPING_VERSION,
  BILLING_EXPORT_PLAN_MAPPING_VERSION,
  billingMonthlyCreditsForPlanVersion,
  billingPlanVersionForMapping,
  selectBillingSubscriptionPlan,
  supportsBillingDeliveryMapping,
} from "./billing-plan-mapping.js";
const input = {
  configuredVersion: BILLING_CREDIT_PLAN_MAPPING_VERSION,
  planKey: "pro" as const,
  currentPlanVersionId: BETA_EXPORT_PRO_PLAN_ID,
  currentPeriodStart: BETA_CREDIT_EFFECTIVE_FROM,
  currentStateRead: true,
  observedAt: "2026-10-01T00:00:00.000Z",
};
describe("Pro allowance mapping", () => {
  it("uses 1250 only for the approved successor", () => {
    expect(
      billingPlanVersionForMapping(BILLING_CREDIT_PLAN_MAPPING_VERSION, "pro"),
    ).toBe(BETA_CREDIT_PRO_PLAN_ID);
    expect(billingMonthlyCreditsForPlanVersion(BETA_CREDIT_PRO_PLAN_ID)).toBe(
      1250,
    );
    expect(billingMonthlyCreditsForPlanVersion(BETA_EXPORT_PRO_PLAN_ID)).toBe(
      1000,
    );
    expect(selectBillingSubscriptionPlan(input)).toBe(BETA_CREDIT_PRO_PLAN_ID);
    expect(
      selectBillingSubscriptionPlan({
        ...input,
        currentPeriodStart: "2026-09-20T00:00:00.000Z",
      }),
    ).toBe(BETA_EXPORT_PRO_PLAN_ID);
  });
  it("requires a fresh observation and valid known chronology", () => {
    for (const override of [
      { currentStateRead: false },
      { currentPlanVersionId: "unknown" },
      { observedAt: "bad" },
      { currentPeriodStart: "2026-11-01T00:00:00.000Z" },
    ])
      expect(
        selectBillingSubscriptionPlan({ ...input, ...override }),
      ).toBeNull();
    expect(
      selectBillingSubscriptionPlan({
        ...input,
        currentPlanVersionId: BETA_CREDIT_PRO_PLAN_ID,
        configuredVersion: BILLING_EXPORT_PLAN_MAPPING_VERSION,
      }),
    ).toBe(BETA_CREDIT_PRO_PLAN_ID);
    expect(
      supportsBillingDeliveryMapping(
        BILLING_CREDIT_PLAN_MAPPING_VERSION,
        BILLING_EXPORT_PLAN_MAPPING_VERSION,
      ),
    ).toBe(false);
    expect(
      supportsBillingDeliveryMapping(
        BILLING_EXPORT_PLAN_MAPPING_VERSION,
        BILLING_CREDIT_PLAN_MAPPING_VERSION,
      ),
    ).toBe(true);
  });
});
