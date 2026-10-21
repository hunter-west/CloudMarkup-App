import { describe, expect, it } from "vitest";
import {
  BETA_EXPORT_PLAN_CONFIGURATION_VERSION,
  BETA_PLAN_VERSIONS_V1,
  evaluateEntitlementV1,
  validatePlanVersionV1,
  type EntitlementDecisionInputV1,
  type MembershipSeatRecordV1,
} from "./commercial.js";
import {
  BETA_EXPORT_EFFECTIVE_FROM,
  BETA_EXPORT_PRO_PLAN_ID,
  BETA_EXPORT_PRO_PLAN_V1,
  BETA_SHARING_PLAN_IDS,
  BETA_SHARING_PLAN_VERSIONS_V1,
  evaluateOrganizationSeatAdmissionV1,
  sharingPlanConfigurationVersionV1,
} from "./organization-membership-policy.js";

const input: EntitlementDecisionInputV1 = {
  at: BETA_EXPORT_EFFECTIVE_FROM,
  availableCreditUnits: 0,
  billingAccountId: "billing_export_plan",
  billingAccountRecordVersion: 1,
  commercialState: "active",
  expensiveOperationsEnabled: true,
  feature: "cloudformation",
  limitUsage: [],
  memberId: "membership_export",
  operationKind: "data-export",
  organizationId: "organization_export",
  organizationStatus: "active",
  plan: BETA_EXPORT_PRO_PLAN_V1,
  pricingAvailable: false,
  projectId: "project_export",
  requestedCreditUnits: 0,
  scopedLimitExtensions: [],
  subscriptionProjectionVersion: 1,
  subscriptionState: "active",
  targetRole: null,
};

describe("restricted CloudFormation Pro successor", () => {
  it("changes only version authority and the CloudFormation entitlement", () => {
    const prior = BETA_SHARING_PLAN_VERSIONS_V1.find(
      (plan) => plan.planVersionId === BETA_SHARING_PLAN_IDS.pro,
    );
    expect(prior).toBeDefined();
    const next = BETA_EXPORT_PRO_PLAN_V1;
    expect(next).toEqual({
      ...prior,
      configurationVersion: BETA_EXPORT_PLAN_CONFIGURATION_VERSION,
      planVersionId: BETA_EXPORT_PRO_PLAN_ID,
      effectiveFrom: BETA_EXPORT_EFFECTIVE_FROM,
      entitlements: prior?.entitlements.map((entry) =>
        entry.feature === "cloudformation"
          ? { ...entry, enabled: true }
          : entry,
      ),
    });
    expect(next.includedBillableSeats).toBe(10);
    expect(next.includedCreditGrants).toEqual([
      { kind: "monthly", units: 1000 },
    ]);
    expect(next.proposedMonthlyPrice?.unitAmountMicros).toBe(39_000_000);
    expect(Object.isFrozen(next)).toBe(true);
    expect(next.entitlements.every(Object.isFrozen)).toBe(true);
    expect(() => {
      validatePlanVersionV1(next);
    }).not.toThrow();
  });
  it("admits the target without inventing model credit or pricing requirements", () => {
    expect(evaluateEntitlementV1(input)).toMatchObject({
      allowed: true,
      planVersionId: BETA_EXPORT_PRO_PLAN_ID,
    });
    for (const plan of [
      ...BETA_PLAN_VERSIONS_V1,
      ...BETA_SHARING_PLAN_VERSIONS_V1,
    ])
      expect(evaluateEntitlementV1({ ...input, plan })).toMatchObject({
        allowed: false,
        denialReason: "feature_disabled",
      });
    expect(
      evaluateEntitlementV1({ ...input, at: "2026-09-12T16:14:59.999Z" }),
    ).toMatchObject({ allowed: false, denialReason: "plan_not_effective" });
  });
  it("retains active subscription and expensive validation denials", () => {
    const validation: EntitlementDecisionInputV1 = {
      ...input,
      feature: "validation-jobs",
      operationKind: "expensive",
      pricingAvailable: true,
      limitUsage: [
        { currentUsage: 0, limitKey: "concurrent-ai-jobs", requestedUsage: 1 },
      ],
    };
    expect(evaluateEntitlementV1(validation)).toMatchObject({ allowed: true });
    expect(
      evaluateEntitlementV1({ ...validation, organizationStatus: "suspended" }),
    ).toMatchObject({ allowed: false, denialReason: "organization_suspended" });
    expect(
      evaluateEntitlementV1({
        ...validation,
        expensiveOperationsEnabled: false,
      }),
    ).toMatchObject({
      allowed: false,
      denialReason: "expensive_operations_disabled",
    });
    expect(
      evaluateEntitlementV1({
        ...validation,
        subscriptionState: "inactive",
        inactiveSubscriptionAccessPolicy: {
          policyVersion: "export-test-inactive-v1",
          graceEndsAt: null,
          allowPlanExpansionDuringGrace: false,
          preserveApprovedDataExport: false,
          preserveExistingProjectAccess: false,
          preserveManualEditing: false,
        },
      }),
    ).toMatchObject({ allowed: false, denialReason: "subscription_inactive" });
  });
  it("preserves ten-member sharing and rejects unknown configuration identity", () => {
    const members = (count: number): MembershipSeatRecordV1[] =>
      Array.from({ length: count }, (_, i) => ({
        membershipId: `membership_${String(i)}`,
        role: i === 0 ? "owner" : "viewer",
        status: "active",
      }));
    expect(
      evaluateOrganizationSeatAdmissionV1({
        planVersionId: BETA_EXPORT_PRO_PLAN_ID,
        at: BETA_EXPORT_EFFECTIVE_FROM,
        memberships: members(9),
      }),
    ).toEqual({ allowed: true });
    expect(
      evaluateOrganizationSeatAdmissionV1({
        planVersionId: BETA_EXPORT_PRO_PLAN_ID,
        at: BETA_EXPORT_EFFECTIVE_FROM,
        memberships: members(10),
      }),
    ).toEqual({ allowed: false, reason: "member-limit-reached" });
    expect(
      evaluateOrganizationSeatAdmissionV1({
        planVersionId: BETA_EXPORT_PRO_PLAN_ID,
        at: "2026-09-12T16:14:59.999Z",
        memberships: [],
      }),
    ).toEqual({ allowed: false, reason: "plan-unavailable" });
    expect(sharingPlanConfigurationVersionV1(BETA_EXPORT_PRO_PLAN_ID)).toBe(
      BETA_EXPORT_PLAN_CONFIGURATION_VERSION,
    );
    expect(sharingPlanConfigurationVersionV1("planver_unreviewed")).toBeNull();
  });
});
