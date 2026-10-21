import { describe, expect, it } from "vitest";
import {
  BETA_PLAN_VERSIONS_V1,
  deriveBillableSeatQuantityV1,
  getBetaPlanVersion,
  validatePlanVersionV1,
  type MembershipSeatRecordV1,
} from "./commercial.js";
import {
  BETA_SHARING_EFFECTIVE_FROM,
  BETA_SHARING_PLAN_IDS,
  BETA_SHARING_PLAN_VERSIONS_V1,
  canIssueOrganizationInvitationV1,
  evaluateOrganizationSeatAdmissionV1,
} from "./organization-membership-policy.js";

function members(count: number): MembershipSeatRecordV1[] {
  return Array.from({ length: count }, (_, index) => ({
    membershipId: `membership_${String(index)}`,
    status: "active",
    role: index === 0 ? "owner" : index % 2 === 0 ? "viewer" : "editor",
  }));
}
describe("owner-approved included-member sharing plans", () => {
  it("leaves the historical catalog and current selector unchanged", () => {
    expect(
      BETA_PLAN_VERSIONS_V1.map((plan) => [
        plan.planVersionId,
        plan.includedBillableSeats,
        plan.limits.find((entry) => entry.key === "active-members")?.value,
      ]),
    ).toEqual([
      ["planver_starter_2026_08_14_v1", 1, 1],
      ["planver_pro_2026_08_14_v2", 1, 1],
    ]);
    expect(
      getBetaPlanVersion("starter", BETA_SHARING_EFFECTIVE_FROM).planVersionId,
    ).toBe("planver_starter_2026_08_14_v1");
    expect(
      getBetaPlanVersion("pro", BETA_SHARING_EFFECTIVE_FROM).planVersionId,
    ).toBe("planver_pro_2026_08_14_v2");
  });
  it.each([
    [0, 3],
    [1, 10],
  ] as const)(
    "changes only sharing/member configuration for plan %s",
    (index, limit) => {
      const original = BETA_PLAN_VERSIONS_V1[index];
      const plan = BETA_SHARING_PLAN_VERSIONS_V1[index];
      if (original === undefined || plan === undefined)
        throw new Error("Missing plan fixture.");
      expect(plan).not.toBe(original);
      expect(plan.effectiveFrom).toBe(BETA_SHARING_EFFECTIVE_FROM);
      expect(plan.includedBillableSeats).toBe(limit);
      expect(plan.includedCreditGrants).toEqual(original.includedCreditGrants);
      expect(plan.proposedMonthlyPrice).toEqual(original.proposedMonthlyPrice);
      expect(plan.futureAdditionalEditorConcept).toBeNull();
      expect(
        plan.entitlements.filter(
          (entry) =>
            !["organization-roles", "shared-projects"].includes(entry.feature),
        ),
      ).toEqual(
        original.entitlements.filter(
          (entry) =>
            !["organization-roles", "shared-projects"].includes(entry.feature),
        ),
      );
      expect(
        plan.entitlements
          .filter((entry) =>
            ["organization-roles", "shared-projects"].includes(entry.feature),
          )
          .every((entry) => entry.enabled),
      ).toBe(true);
      expect(
        plan.limits.filter(
          (entry) =>
            ![
              "active-members",
              "active-owners",
              "active-administrators",
              "active-editors",
              "billable-seats",
              "viewers",
            ].includes(entry.key),
        ),
      ).toEqual(
        original.limits.filter(
          (entry) =>
            ![
              "active-members",
              "active-owners",
              "active-administrators",
              "active-editors",
              "billable-seats",
              "viewers",
            ].includes(entry.key),
        ),
      );
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.limits[0])).toBe(true);
      expect(Object.isFrozen(plan.entitlements[0])).toBe(true);
      const allEditors = members(limit).map((member) => ({
        ...member,
        role: "editor" as const,
      }));
      expect(
        deriveBillableSeatQuantityV1(plan, allEditors).additionalBillableSeats,
      ).toBe(0);
      expect(() => {
        validatePlanVersionV1(plan);
      }).not.toThrow();
    },
  );
  it.each([
    ["starter", 3],
    ["pro", 10],
  ] as const)(
    "enforces the combined %s total, including owner and viewer",
    (key, limit) => {
      const evaluate = (records: MembershipSeatRecordV1[]) =>
        evaluateOrganizationSeatAdmissionV1({
          planVersionId: BETA_SHARING_PLAN_IDS[key],
          at: BETA_SHARING_EFFECTIVE_FROM,
          memberships: records,
        });
      expect(evaluate(members(limit - 1))).toEqual({ allowed: true });
      expect(evaluate(members(limit))).toEqual({
        allowed: false,
        reason: "member-limit-reached",
      });
      expect(evaluate(members(limit + 1))).toEqual({
        allowed: false,
        reason: "member-limit-reached",
      });
      expect(
        evaluate([
          ...members(limit - 1),
          {
            membershipId: "membership_pending",
            role: "editor",
            status: "pending-invitation",
          },
          {
            membershipId: "membership_suspended",
            role: "viewer",
            status: "suspended",
          },
        ]),
      ).toEqual({ allowed: true });
    },
  );
  it("does not invent a plan or backdate approved capacity", () => {
    for (const planVersionId of ["unknown", "planver_starter_2026_08_14_v1"])
      expect(
        evaluateOrganizationSeatAdmissionV1({
          planVersionId,
          at: BETA_SHARING_EFFECTIVE_FROM,
          memberships: [],
        }),
      ).toEqual({ allowed: false, reason: "plan-unavailable" });
    expect(
      evaluateOrganizationSeatAdmissionV1({
        planVersionId: BETA_SHARING_PLAN_IDS.starter,
        at: "2026-09-07T14:35:21.999Z",
        memberships: [],
      }),
    ).toEqual({ allowed: false, reason: "plan-unavailable" });
  });
  it("retains the old configuration's partition validation", () => {
    const original = BETA_PLAN_VERSIONS_V1[0];
    if (original === undefined)
      throw new Error("Missing original plan fixture.");
    const plan = structuredClone(original);
    expect(() => {
      validatePlanVersionV1({
        ...plan,
        limits: plan.limits.map((entry) =>
          entry.key === "viewers" ? { ...entry, value: 1 } : entry,
        ),
      });
    }).toThrow();
  });
  it("rejects each role maximum exceeding the new aggregate", () => {
    const plan = BETA_SHARING_PLAN_VERSIONS_V1[0];
    if (plan === undefined) throw new Error("Missing sharing plan fixture.");
    for (const key of ["billable-seats", "viewers", "active-editors"])
      expect(() => {
        validatePlanVersionV1({
          ...plan,
          limits: plan.limits.map((entry) =>
            entry.key === key ? { ...entry, value: 4 } : entry,
          ),
        });
      }).toThrow();
  });
  it.each(["administrator", "editor", "viewer"] as const)(
    "owner may invite %s",
    (target) => {
      expect(canIssueOrganizationInvitationV1("owner", target)).toBe(true);
    },
  );
  it.each(["editor", "viewer"] as const)(
    "administrator may invite %s",
    (target) => {
      expect(canIssueOrganizationInvitationV1("administrator", target)).toBe(
        true,
      );
    },
  );
  it("never allows administrator escalation or editor/viewer invitations", () => {
    expect(
      canIssueOrganizationInvitationV1("administrator", "administrator"),
    ).toBe(false);
    for (const issuer of ["editor", "viewer"] as const)
      for (const target of ["administrator", "editor", "viewer"] as const)
        expect(canIssueOrganizationInvitationV1(issuer, target)).toBe(false);
  });
});
