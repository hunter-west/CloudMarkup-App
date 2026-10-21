import { describe, it, expect } from "vitest";
import {
  staffTrialState,
  STAFF_TRIAL_POLICY_VERSION,
  STAFF_TRIAL_PLAN_VERSION,
  type StaffTrialAccessV1,
} from "./staff-trial-policy.js";
import {
  evaluateEntitlementV1,
  type EntitlementDecisionInputV1,
} from "./commercial.js";
import {
  STAFF_TRIAL_PLAN_V1,
  BETA_CREDIT_PRO_PLAN_V1,
  includedMembersForSharingPlanV1,
} from "./organization-membership-policy.js";
const input = {
  startsAt: "2026-10-06T00:00:00.000Z",
  expiresAt: "2026-10-07T00:00:00.000Z",
  asOf: "2026-10-06T12:00:00.000Z",
  revoked: false,
  superseded: false,
};
describe("staff trial policy v1", () => {
  it("uses a half-open interval and never depends on ambient time", () => {
    for (const [asOf, state] of [
      [input.startsAt, "active"],
      ["2026-10-06T23:59:59.999Z", "active"],
      [input.expiresAt, "expired"],
      ["2026-10-08T00:00:00.000Z", "expired"],
      ["2026-10-05T00:00:00.000Z", "unavailable"],
    ] as const)
      expect(staffTrialState({ ...input, asOf })).toBe(state);
    expect(staffTrialState(Object.freeze(input))).toBe("active");
  });
  it("revocation and paid conversion are terminal admission fences", () => {
    expect(staffTrialState({ ...input, revoked: true })).toBe("revoked");
    expect(staffTrialState({ ...input, superseded: true })).toBe("superseded");
    expect(
      staffTrialState({ ...input, asOf: input.expiresAt, revoked: true }),
    ).toBe("revoked");
  });
  it.each(["invalid"])("fails closed for malformed clock %s", (asOf) => {
    expect(staffTrialState({ ...input, asOf })).toBe("unavailable");
  });
  it("fails closed for overlong windows or malformed lifecycle flags", () => {
    expect(
      staffTrialState({ ...input, expiresAt: "2026-11-06T00:00:00.000Z" }),
    ).toBe("unavailable");
    expect(
      staffTrialState({ ...input, revoked: undefined as unknown as boolean }),
    ).toBe("unavailable");
  });
  it("fails closed for invalid expiry ordering", () => {
    expect(staffTrialState({ ...input, expiresAt: input.startsAt })).toBe(
      "unavailable",
    );
  });
});

describe("independent full Professional trial entitlement", () => {
  const trialAccess: StaffTrialAccessV1 = {
    contractVersion: 1,
    trialId: "trial_synthetic",
    policyVersion: STAFF_TRIAL_POLICY_VERSION,
    startsAt: input.startsAt,
    expiresAt: input.expiresAt,
    revoked: false,
    superseded: false,
  };
  const decisionInput: EntitlementDecisionInputV1 = {
    at: input.asOf,
    organizationId: "org_synthetic",
    memberId: "principal_synthetic",
    projectId: "project_synthetic",
    billingAccountId: "billing_synthetic",
    billingAccountRecordVersion: 1,
    commercialState: "active",
    organizationStatus: "active",
    subscriptionState: "not-required",
    subscriptionProjectionVersion: null,
    trialAccess,
    expensiveOperationsEnabled: true,
    feature: "terraform",
    operationKind: "data-export",
    plan: STAFF_TRIAL_PLAN_V1,
    pricingAvailable: true,
    availableCreditUnits: 100,
    requestedCreditUnits: 0,
    limitUsage: [],
    scopedLimitExtensions: [],
    targetRole: null,
  };
  it("copies exact Professional features and limits without its recurring allowance", () => {
    expect(STAFF_TRIAL_PLAN_V1.entitlements).toEqual(
      BETA_CREDIT_PRO_PLAN_V1.entitlements,
    );
    expect(STAFF_TRIAL_PLAN_V1.limits).toEqual(BETA_CREDIT_PRO_PLAN_V1.limits);
    expect(STAFF_TRIAL_PLAN_V1.includedCreditGrants).toEqual([]);
    expect(includedMembersForSharingPlanV1(STAFF_TRIAL_PLAN_VERSION)).toBe(10);
  });
  it.each([
    "terraform",
    "cloudformation",
    "github-export",
    "zip-export",
    "diagram-export",
  ] as const)(
    "admits %s using trial evidence and preserves empty paid evidence",
    (feature) => {
      expect(
        evaluateEntitlementV1({ ...decisionInput, feature }),
      ).toMatchObject({
        allowed: true,
        subscriptionState: "not-required",
        subscriptionProjectionVersion: null,
        trialAccess,
      });
    },
  );
  it.each([
    ["manual-editing", "manual-edit"],
    ["read-existing-projects", "read"],
    ["terraform", "data-export"],
    ["organization-roles", "member-activate"],
    ["ai-assisted-operations", "expensive"],
  ] as const)(
    "expiry denies %s without grace or ambient time",
    (feature, operationKind) => {
      const eligible: EntitlementDecisionInputV1 = {
        ...decisionInput,
        feature,
        operationKind,
        targetRole: operationKind === "member-activate" ? "viewer" : null,
        limitUsage:
          operationKind === "expensive"
            ? [
                {
                  limitKey: "concurrent-ai-jobs",
                  currentUsage: 0,
                  requestedUsage: 1,
                },
              ]
            : operationKind === "member-activate"
              ? [
                  {
                    limitKey: "active-members",
                    currentUsage: 0,
                    requestedUsage: 1,
                  },
                  { limitKey: "viewers", currentUsage: 0, requestedUsage: 1 },
                ]
              : [],
      };
      expect(evaluateEntitlementV1(eligible)).toMatchObject({ allowed: true });
      expect(
        evaluateEntitlementV1({
          ...eligible,
          at: input.expiresAt,
        }),
      ).toMatchObject({
        allowed: false,
        denialReason: "commercial_state_unavailable",
        evaluatedLimits: [],
      });
    },
  );
  it.each([{ revoked: true }, { superseded: true }])(
    "denies terminal trial access %j",
    (changed) => {
      expect(
        evaluateEntitlementV1({
          ...decisionInput,
          trialAccess: { ...trialAccess, ...changed },
        }),
      ).toMatchObject({ allowed: false });
    },
  );
  it("rejects missing, paid or mismatched authority", () => {
    const missingTrial = { ...decisionInput };
    delete missingTrial.trialAccess;
    expect(() => evaluateEntitlementV1(missingTrial)).toThrow();
    for (const changed of [
      {
        subscriptionState: "active" as const,
        subscriptionProjectionVersion: 1,
      },
      { plan: BETA_CREDIT_PRO_PLAN_V1 },
      { trialAccess: { ...trialAccess, contractVersion: 2 as 1 } },
    ]) {
      expect(() =>
        evaluateEntitlementV1({ ...decisionInput, ...changed }),
      ).toThrow();
    }
  });
});
