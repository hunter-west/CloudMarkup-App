/** Operational diagnostics only. This policy grants no deletion authority. */
export const CLEANUP_RETENTION_POLICY = "completed-operational-details-60d.v1";
const delayMs = 60 * 24 * 60 * 60 * 1_000;
const sha256 = /^[a-f0-9]{64}$/u;
const stamp = (value: string | null): number | null => {
  if (
    value === null ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  )
    return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : null;
};
export interface CleanupRetentionEvidence {
  readonly recordClass: string;
  readonly policy: string;
  readonly verifiedCompletedAt: string | null;
  readonly now: string;
  readonly restoreAdmitted: boolean;
  readonly sameEpoch: boolean;
  readonly held: boolean;
  readonly pending: boolean;
  readonly dependenciesRetained: boolean;
  readonly originalProof: string | null;
  readonly currentProof: string | null;
}
/** Callers supply freshly read server evidence, never client clocks/booleans.
 * Selection does not authorize retirement; the adapter rechecks in its CAS
 * transaction. Active fences, exact receipts and canonical evidence are excluded. */
export function cleanupRetentionEligibility(
  evidence: CleanupRetentionEvidence,
) {
  const blocked: string[] = [];
  const completion = stamp(evidence.verifiedCompletedAt),
    now = stamp(evidence.now);
  if (evidence.recordClass !== "redundant-page-details")
    blocked.push("record-class-excluded");
  if (evidence.policy !== CLEANUP_RETENTION_POLICY)
    blocked.push("policy-mismatch");
  if (!evidence.restoreAdmitted || !evidence.sameEpoch)
    blocked.push("restore-not-admitted");
  if (evidence.held) blocked.push("held");
  if (evidence.pending) blocked.push("pending-work");
  if (!evidence.dependenciesRetained)
    blocked.push("replay-or-canonical-dependency-missing");
  if (completion === null) blocked.push("completion-unverified");
  if (now === null || (completion !== null && now < completion))
    blocked.push("clock-invalid");
  if (
    !evidence.originalProof ||
    !sha256.test(evidence.originalProof) ||
    !evidence.currentProof ||
    !sha256.test(evidence.currentProof)
  )
    blocked.push("canonical-evidence-unverified");
  else if (evidence.originalProof !== evidence.currentProof)
    blocked.push("canonical-evidence-changed");
  const eligibleAt =
    completion === null ? null : new Date(completion + delayMs).toISOString();
  if (completion !== null && now !== null && now < completion + delayMs)
    blocked.push("completion-delay-not-elapsed");
  return {
    policy: CLEANUP_RETENTION_POLICY,
    eligible: blocked.length === 0,
    eligibleAt,
    blocked,
  };
}
