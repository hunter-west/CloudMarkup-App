export const PROVIDER_DIRECT_PROPOSAL_JOB_PREFIX_V1 =
  "job.provider-direct-proposal.";
/** Mode discriminator only. Real auth, durable creation/attempt and current
 * scope still admit execution; a caller cannot fund a job with its identifier. */
export function isProviderDirectProposalJobIdV1(jobId: string): boolean {
  return /^job\.provider-direct-proposal\.[0-9a-f]{64}$/u.test(jobId);
}
