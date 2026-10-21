import { describe, expect, it } from "vitest";
import {
  BETA_EXPORT_EFFECTIVE_FROM,
  BETA_EXPORT_PRO_PLAN_ID,
  BETA_SHARING_PLAN_IDS,
} from "@cloudmarkup/domain";
import {
  BILLING_EXPORT_PLAN_MAPPING_VERSION,
  BILLING_PLAN_MAPPING_VERSION,
  BILLING_SHARING_PLAN_MAPPING_VERSION,
  billingPlanKeyForVersion,
  billingPlanVersionForMapping,
  selectBillingSubscriptionPlan,
  supportsBillingDeliveryMapping,
} from "./billing-plan-mapping.js";
const selection = {
  configuredVersion: BILLING_EXPORT_PLAN_MAPPING_VERSION,
  planKey: "pro" as const,
  currentPlanVersionId: BETA_SHARING_PLAN_IDS.pro,
  currentPeriodStart: BETA_EXPORT_EFFECTIVE_FROM,
  currentStateRead: true,
  observedAt: "2026-09-13T00:00:00.000Z",
};
describe("explicit export plan mapping", () => {
  it("selects the Pro successor only after a verified effective subscription period", () => {
    expect(selectBillingSubscriptionPlan(selection)).toBe(
      BETA_EXPORT_PRO_PLAN_ID,
    );
    expect(
      selectBillingSubscriptionPlan({ ...selection, currentStateRead: false }),
    ).toBeNull();
    expect(
      selectBillingSubscriptionPlan({
        ...selection,
        currentPeriodStart: "2026-09-10T00:00:00.000Z",
      }),
    ).toBe(BETA_SHARING_PLAN_IDS.pro);
    expect(
      selectBillingSubscriptionPlan({
        ...selection,
        currentPlanVersionId: null,
        currentPeriodStart: null,
      }),
    ).toBe("planver_pro_2026_08_14_v2");
    expect(
      selectBillingSubscriptionPlan({ ...selection, planKey: "starter" }),
    ).toBe(BETA_SHARING_PLAN_IDS.starter);
  });
  it("does not downgrade adopted Pro on historical worker configuration", () => {
    for (const configuredVersion of [
      BILLING_PLAN_MAPPING_VERSION,
      BILLING_SHARING_PLAN_MAPPING_VERSION,
      BILLING_EXPORT_PLAN_MAPPING_VERSION,
    ])
      expect(
        selectBillingSubscriptionPlan({
          ...selection,
          configuredVersion,
          currentPlanVersionId: BETA_EXPORT_PRO_PLAN_ID,
        }),
      ).toBe(BETA_EXPORT_PRO_PLAN_ID);
    expect(
      selectBillingSubscriptionPlan({
        ...selection,
        currentPlanVersionId: BETA_EXPORT_PRO_PLAN_ID,
        planKey: "starter",
      }),
    ).toBe(BETA_SHARING_PLAN_IDS.starter);
  });
  it("rejects unknown canonical state and inconsistent chronology", () => {
    for (const override of [
      { currentPlanVersionId: "unreviewed" },
      { observedAt: "bad" },
      { currentPeriodStart: "bad" },
      { currentPeriodStart: "2026-10-01T00:00:00.000Z" },
      {
        currentPlanVersionId: BETA_EXPORT_PRO_PLAN_ID,
        currentStateRead: false,
      },
      {
        currentPlanVersionId: BETA_EXPORT_PRO_PLAN_ID,
        currentPeriodStart: "2026-09-11T00:00:00.000Z",
      },
    ])
      expect(
        selectBillingSubscriptionPlan({ ...selection, ...override }),
      ).toBeNull();
  });
  it("keeps exact target mappings and rejects new delivery labels at older workers", () => {
    expect(
      billingPlanVersionForMapping(BILLING_EXPORT_PLAN_MAPPING_VERSION, "pro"),
    ).toBe(BETA_EXPORT_PRO_PLAN_ID);
    expect(
      billingPlanVersionForMapping(
        BILLING_EXPORT_PLAN_MAPPING_VERSION,
        "starter",
      ),
    ).toBe(BETA_SHARING_PLAN_IDS.starter);
    expect(billingPlanKeyForVersion(BETA_EXPORT_PRO_PLAN_ID)).toBe("pro");
    const versions = [
      BILLING_PLAN_MAPPING_VERSION,
      BILLING_SHARING_PLAN_MAPPING_VERSION,
      BILLING_EXPORT_PLAN_MAPPING_VERSION,
    ];
    for (const [i, delivery] of versions.entries())
      for (const [j, configured] of versions.entries())
        expect(supportsBillingDeliveryMapping(delivery, configured)).toBe(
          i <= j,
        );
    expect(
      supportsBillingDeliveryMapping(
        "unknown",
        BILLING_EXPORT_PLAN_MAPPING_VERSION,
      ),
    ).toBe(false);
    expect(
      supportsBillingDeliveryMapping(BILLING_PLAN_MAPPING_VERSION, "unknown"),
    ).toBe(false);
  });
});
