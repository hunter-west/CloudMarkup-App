/** Pure v1 policy: time, lifecycle and payment evidence are supplied by callers. */
export const STAFF_TRIAL_POLICY_VERSION = "cloudmarkup-staff-trial-v1";
export const STAFF_TRIAL_PLAN_VERSION = "planver_staff_trial_2026_10_06_v1";
export function staffTrialState(input: {
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly asOf: string;
  readonly revoked: boolean;
  readonly superseded: boolean;
}): "active" | "expired" | "revoked" | "superseded" | "unavailable" {
  const start = Date.parse(input.startsAt),
    end = Date.parse(input.expiresAt),
    now = Date.parse(input.asOf);
  if (
    typeof input.revoked !== "boolean" ||
    typeof input.superseded !== "boolean" ||
    ![start, end, now].every(Number.isFinite) ||
    end <= start ||
    end - start > 30 * 86400000 ||
    now < start
  )
    return "unavailable";
  if (input.revoked) return "revoked";
  if (input.superseded) return "superseded";
  return now >= end ? "expired" : "active";
}

/** Trusted canonical observation; no payment or recurring credit authority. */
export interface StaffTrialAccessV1 {
  readonly contractVersion: 1;
  readonly trialId: string;
  readonly policyVersion: typeof STAFF_TRIAL_POLICY_VERSION;
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
  readonly superseded: boolean;
}
