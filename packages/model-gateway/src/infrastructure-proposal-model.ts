import type { BetaInfrastructureProposal } from "@cloudmarkup/schemas";

/** Current usage contract, shared by active architecture/application consumers.
 * Numeric observations belong to the caller's usage/funding policy, not an SDK. */
export interface BetaConverseUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly providerRequestId?: string;
}

/** Provider-independent input to the shared infrastructure proposal workflow. */
export interface InfrastructureProposalModelInputV1 {
  readonly requirements: string;
  readonly proposalVersion?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly existingArchitecture?: unknown;
  readonly catalog: unknown;
  readonly signal: AbortSignal;
  readonly onUsage?: (usage: BetaConverseUsage) => Promise<void>;
}

/** The application owns authority, review and graph applicability. A provider
 * observes usage and returns a proposal; this port grants no graph mutation,
 * deployment or execution authority. */
export type InfrastructureProposalModelV1 = (
  input: InfrastructureProposalModelInputV1,
) => Promise<BetaInfrastructureProposal>;
