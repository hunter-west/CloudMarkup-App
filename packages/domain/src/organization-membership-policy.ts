import {
  STAFF_TRIAL_PLAN_VERSION,
  STAFF_TRIAL_POLICY_VERSION,
} from "./staff-trial-policy.js";
import {
  BETA_CREDIT_PLAN_CONFIGURATION_VERSION,
  BETA_EXPORT_PLAN_CONFIGURATION_VERSION,
  BETA_PLAN_VERSIONS_V1,
  BETA_SHARING_PLAN_CONFIGURATION_VERSION,
  countSeatUsageV1,
  isPlanEffectiveAt,
  validatePlanVersionV1,
  type MembershipSeatRecordV1,
  type OrganizationRole,
  type PlanKey,
  type PlanVersionV1,
} from "./commercial.js";
export { BETA_SHARING_PLAN_CONFIGURATION_VERSION } from "./commercial.js";

export const BETA_SHARING_EFFECTIVE_FROM = "2026-09-07T14:35:22.000Z" as const;
export const BETA_SHARING_PLAN_IDS = Object.freeze({
  starter: "planver_starter_2026_09_07_v2",
  pro: "planver_pro_2026_09_07_v3",
} as const);
export type InvitableOrganizationRoleV1 = Exclude<OrganizationRole, "owner">;

function sharingPlan(key: PlanKey, members: number): PlanVersionV1 {
  const original = BETA_PLAN_VERSIONS_V1.find(
    (plan) => plan.planDefinitionId === `plan_${key}`,
  );
  if (original === undefined)
    throw new TypeError("The source plan is unavailable.");
  const seatKeys = new Set([
    "active-members",
    "active-owners",
    "active-administrators",
    "active-editors",
    "billable-seats",
    "viewers",
  ]);
  const plan: PlanVersionV1 = Object.freeze({
    ...original,
    configurationVersion: BETA_SHARING_PLAN_CONFIGURATION_VERSION,
    effectiveFrom: BETA_SHARING_EFFECTIVE_FROM,
    planVersionId: BETA_SHARING_PLAN_IDS[key],
    includedBillableSeats: members,
    entitlements: Object.freeze(
      original.entitlements.map((entry) =>
        Object.freeze({
          ...entry,
          ...(entry.feature === "organization-roles" ||
          entry.feature === "shared-projects"
            ? { enabled: true }
            : {}),
        }),
      ),
    ),
    limits: Object.freeze(
      original.limits.map((entry) =>
        Object.freeze({
          ...entry,
          value: seatKeys.has(entry.key) ? members : entry.value,
        }),
      ),
    ),
    includedCreditGrants: Object.freeze(
      original.includedCreditGrants.map((grant) => Object.freeze({ ...grant })),
    ),
    proposedMonthlyPrice:
      original.proposedMonthlyPrice === null
        ? null
        : Object.freeze({ ...original.proposedMonthlyPrice }),
  });
  validatePlanVersionV1(plan);
  return plan;
}

/** New, unselected versions. Historical catalog and billing mappings stay unchanged. */
export const BETA_SHARING_PLAN_VERSIONS_V1: readonly PlanVersionV1[] =
  Object.freeze([sharingPlan("starter", 3), sharingPlan("pro", 10)]);

export const BETA_EXPORT_EFFECTIVE_FROM = "2026-09-12T16:15:00.000Z" as const;
export const BETA_EXPORT_PRO_PLAN_ID = "planver_pro_2026_09_12_v4" as const;

function cloudFormationExportPlan(): PlanVersionV1 {
  const source = BETA_SHARING_PLAN_VERSIONS_V1.find(
    (plan) => plan.planVersionId === BETA_SHARING_PLAN_IDS.pro,
  );
  if (source === undefined)
    throw new TypeError("The source Pro plan is unavailable.");
  const plan: PlanVersionV1 = Object.freeze({
    ...source,
    configurationVersion: BETA_EXPORT_PLAN_CONFIGURATION_VERSION,
    planVersionId: BETA_EXPORT_PRO_PLAN_ID,
    effectiveFrom: BETA_EXPORT_EFFECTIVE_FROM,
    entitlements: Object.freeze(
      source.entitlements.map((entry) =>
        Object.freeze(
          entry.feature === "cloudformation"
            ? { ...entry, enabled: true }
            : { ...entry },
        ),
      ),
    ),
  });
  validatePlanVersionV1(plan);
  return plan;
}

/** Explicit successor; existing selectors and immutable plan versions are unchanged. */
export const BETA_EXPORT_PRO_PLAN_V1 = cloudFormationExportPlan();

export const BETA_CREDIT_EFFECTIVE_FROM = "2026-09-30T00:00:00.000Z" as const;
export const BETA_CREDIT_PRO_PLAN_ID = "planver_pro_2026_09_30_v5" as const;

/** Additive allowance; prior plans and already-issued grants remain immutable. */
export const BETA_CREDIT_PRO_PLAN_V1: PlanVersionV1 = Object.freeze({
  ...BETA_EXPORT_PRO_PLAN_V1,
  configurationVersion: BETA_CREDIT_PLAN_CONFIGURATION_VERSION,
  planVersionId: BETA_CREDIT_PRO_PLAN_ID,
  effectiveFrom: BETA_CREDIT_EFFECTIVE_FROM,
  includedCreditGrants: Object.freeze([
    Object.freeze({ kind: "monthly" as const, units: 1_250 }),
  ]),
});
validatePlanVersionV1(BETA_CREDIT_PRO_PLAN_V1);

/** Matches current Professional features/limits, with no recurring billing grant. */
export const STAFF_TRIAL_PLAN_V1: PlanVersionV1 = Object.freeze({
  ...BETA_CREDIT_PRO_PLAN_V1,
  configurationVersion: STAFF_TRIAL_POLICY_VERSION,
  planDefinitionId: "plan_staff_trial",
  planVersionId: STAFF_TRIAL_PLAN_VERSION,
  effectiveFrom: "2026-10-06T00:00:00.000Z",
  includedCreditGrants: Object.freeze([]),
  proposedMonthlyPrice: Object.freeze({
    currencyCode: "USD",
    unitAmountMicros: 0,
  }),
});
validatePlanVersionV1(STAFF_TRIAL_PLAN_V1);

export function sharingPlanConfigurationVersionV1(
  planVersionId: string,
): string | null {
  if (planVersionId === STAFF_TRIAL_PLAN_VERSION)
    return STAFF_TRIAL_POLICY_VERSION;
  if (planVersionId === BETA_CREDIT_PRO_PLAN_ID)
    return BETA_CREDIT_PLAN_CONFIGURATION_VERSION;
  if (planVersionId === BETA_EXPORT_PRO_PLAN_ID)
    return BETA_EXPORT_PLAN_CONFIGURATION_VERSION;
  if (
    planVersionId === BETA_SHARING_PLAN_IDS.starter ||
    planVersionId === BETA_SHARING_PLAN_IDS.pro
  )
    return BETA_SHARING_PLAN_CONFIGURATION_VERSION;
  return null;
}

export function includedMembersForSharingPlanV1(
  planVersionId: string,
): number | null {
  if (planVersionId === BETA_SHARING_PLAN_IDS.starter) return 3;
  if (
    planVersionId === BETA_SHARING_PLAN_IDS.pro ||
    planVersionId === BETA_EXPORT_PRO_PLAN_ID ||
    planVersionId === BETA_CREDIT_PRO_PLAN_ID ||
    planVersionId === STAFF_TRIAL_PLAN_VERSION
  )
    return 10;
  return null;
}

export function canIssueOrganizationInvitationV1(
  issuerRole: OrganizationRole,
  targetRole: InvitableOrganizationRoleV1,
): boolean {
  return (
    (issuerRole === "owner" &&
      ["administrator", "editor", "viewer"].includes(targetRole)) ||
    (issuerRole === "administrator" &&
      ["editor", "viewer"].includes(targetRole))
  );
}

export type OrganizationSeatAdmissionV1 =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "plan-unavailable" | "member-limit-reached";
    };

/** Caller supplies one transaction's canonical plan and complete membership snapshot. */
export function evaluateOrganizationSeatAdmissionV1(input: {
  readonly planVersionId: string;
  readonly at: string;
  readonly memberships: readonly MembershipSeatRecordV1[];
}): OrganizationSeatAdmissionV1 {
  const plan =
    input.planVersionId === STAFF_TRIAL_PLAN_VERSION
      ? STAFF_TRIAL_PLAN_V1
      : input.planVersionId === BETA_CREDIT_PRO_PLAN_ID
        ? BETA_CREDIT_PRO_PLAN_V1
        : input.planVersionId === BETA_EXPORT_PRO_PLAN_ID
          ? BETA_EXPORT_PRO_PLAN_V1
          : BETA_SHARING_PLAN_VERSIONS_V1.find(
              (entry) => entry.planVersionId === input.planVersionId,
            );
  if (plan === undefined || !isPlanEffectiveAt(plan, input.at)) {
    return { allowed: false, reason: "plan-unavailable" };
  }
  const members = includedMembersForSharingPlanV1(input.planVersionId);
  if (
    members === null ||
    countSeatUsageV1(input.memberships).activeMembers >= members
  ) {
    return { allowed: false, reason: "member-limit-reached" };
  }
  return { allowed: true };
}
