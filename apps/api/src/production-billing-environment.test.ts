import { describe, expect, it } from "vitest";
import { readProductionBillingSessions } from "./production-billing-environment.js";
import {
  BILLING_CREDIT_PLAN_MAPPING_VERSION,
  BILLING_PLAN_MAPPING_VERSION,
  BILLING_SHARING_PLAN_MAPPING_VERSION,
  BILLING_EXPORT_PLAN_MAPPING_VERSION,
} from "./application/billing-plan-mapping.js";

const environment = {
  CLOUDMARKUP_ENVIRONMENT: "beta",
  CLOUDMARKUP_BILLING_ENABLED: "true",
  CLOUDMARKUP_BILLING_SESSIONS_ENABLED: "true",
  CLOUDMARKUP_STRIPE_ENVIRONMENT: "test",
  CLOUDMARKUP_STRIPE_PORTAL_CONFIGURATION_REFERENCE: "bpc_synthetic",
  CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/api-key-EX0004",
};
describe("production sandbox billing configuration", () => {
  it("keeps legacy default and reads only an explicit reviewed sharing selector", () => {
    expect(
      readProductionBillingSessions(environment)?.configuration
        .planMappingVersion,
    ).toBe(BILLING_PLAN_MAPPING_VERSION);
    const next = readProductionBillingSessions({
      ...environment,
      CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION:
        BILLING_SHARING_PLAN_MAPPING_VERSION,
    });
    expect(next?.configuration.plans.starter.planVersionId).toBe(
      "planver_starter_2026_09_07_v2",
    );
    expect(next?.configuration.plans.pro.planVersionId).toBe(
      "planver_pro_2026_09_07_v3",
    );
  });
  it("binds sandbox checkout to the same reviewed export plan mapping as signed delivery", () => {
    const sessions = readProductionBillingSessions({
      ...environment,
      CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION:
        BILLING_EXPORT_PLAN_MAPPING_VERSION,
    });
    expect(sessions?.configuration.mode).toBe("stripe-sandbox");
    expect(sessions?.configuration.plans.pro.planVersionId).toBe(
      "planver_pro_2026_09_12_v4",
    );
    expect(sessions?.configuration.trialPolicy).toBe("no-trial");
  });
  it("exposes the revised Pro allowance and unchanged price for the new mapping", () => {
    const sessions = readProductionBillingSessions({
      ...environment,
      CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION:
        BILLING_CREDIT_PLAN_MAPPING_VERSION,
    });
    expect(sessions?.configuration.plans.pro).toMatchObject({
      planVersionId: "planver_pro_2026_09_30_v5",
      monthlyCreditUnits: 1250,
      monthlyPriceMicros: 39_000_000,
    });
  });
  it("requires a separate explicit flag for top-ups within reviewed sandbox billing", () => {
    expect(readProductionBillingSessions(environment)?.topUpsEnabled).toBe(
      false,
    );
    expect(
      readProductionBillingSessions({
        ...environment,
        CLOUDMARKUP_CREDIT_TOP_UPS_ENABLED: "false",
      })?.topUpsEnabled,
    ).toBe(false);
    expect(
      readProductionBillingSessions({
        ...environment,
        CLOUDMARKUP_CREDIT_TOP_UPS_ENABLED: "true",
      })?.topUpsEnabled,
    ).toBe(true);
    expect(
      readProductionBillingSessions({
        CLOUDMARKUP_CREDIT_TOP_UPS_ENABLED: "true",
      }),
    ).toBeUndefined();
  });
  it.each(["", "1", "TRUE", " true"])(
    "rejects ambiguous top-up admission %j",
    (value) => {
      expect(() =>
        readProductionBillingSessions({
          ...environment,
          CLOUDMARKUP_CREDIT_TOP_UPS_ENABLED: value,
        }),
      ).toThrow();
    },
  );
  it("defaults off without credentials or a provider client", () => {
    expect(readProductionBillingSessions({})).toBeUndefined();
    expect(
      readProductionBillingSessions({
        ...environment,
        CLOUDMARKUP_BILLING_SESSIONS_ENABLED: "false",
      }),
    ).toBeUndefined();
  });
  it("accepts only reviewed beta test-mode identities and hosted plan configuration", () => {
    const value = readProductionBillingSessions(environment);
    expect(value?.configuration).toMatchObject({
      mode: "stripe-sandbox",
      stripeEnvironment: "test",
      portalConfigurationReference: "bpc_synthetic",
      trialPolicy: "no-trial",
    });
    expect(value?.configuration.plans.starter.monthlyCreditUnits).toBe(200);
    expect(value?.configuration.plans.pro.monthlyCreditUnits).toBe(1000);
  });
  it.each([
    { CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION: "unknown" },
    { CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION: "" },
    { CLOUDMARKUP_ENVIRONMENT: "prod" },
    { CLOUDMARKUP_BILLING_ENABLED: "false" },
    { CLOUDMARKUP_BILLING_SESSIONS_ENABLED: "1" },
    { CLOUDMARKUP_STRIPE_ENVIRONMENT: "live" },
    { CLOUDMARKUP_STRIPE_PORTAL_CONFIGURATION_REFERENCE: "" },
    { CLOUDMARKUP_STRIPE_PORTAL_CONFIGURATION_REFERENCE: " bpc_synthetic" },
    {
      CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN:
        "arn:aws:secretsmanager:us-east-1:111111111111:secret:other-AbCdEf",
    },
    {
      CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN: "cloudmarkup/beta/stripe/api-key",
    },
  ])("fails closed on incomplete or unreviewed configuration %j", (change) => {
    expect(() =>
      readProductionBillingSessions({ ...environment, ...change }),
    ).toThrow();
  });
});
