import type {
  AsyncJobCreateRequestV1,
  AsyncJobFailureV1,
  AsyncJobId,
  AsyncJobLimitsV1,
  AsyncJobRecordV1,
  AsyncJobStateV1,
} from "@cloudmarkup/schemas";

export const DEFAULT_JOB_LIMITS_V1: AsyncJobLimitsV1 = Object.freeze({
  artifactCount: 64,
  attemptCount: 3,
  checkpointBytes: 1024 * 1024,
  checkpointCount: 128,
  contractVersion: 1,
  inlineInputBytes: 64 * 1024,
  outputBytes: 4 * 1024 * 1024,
  referencedInputBytes: 256 * 1024 * 1024,
  runtimeSeconds: 15 * 60,
});

export const TERMINAL_JOB_STATES = [
  "succeeded",
  "failed",
  "canceled",
  "expired",
  "superseded",
] as const satisfies readonly AsyncJobStateV1[];

export type TerminalJobStateV1 = (typeof TERMINAL_JOB_STATES)[number];
type JobIdempotencyClaimV1 = AsyncJobRecordV1["idempotency"];

export interface CreateJobCommandV1 {
  readonly expiresAt?: string;
  readonly idempotency: JobIdempotencyClaimV1;
  readonly inputDigest: AsyncJobRecordV1["inputDigest"];
  readonly limits?: Partial<Omit<AsyncJobLimitsV1, "contractVersion">>;
  readonly orchestration?: {
    readonly dependencyJobIds?: readonly AsyncJobId[];
    readonly expectedChildJobIds?: readonly AsyncJobId[];
    readonly failurePolicy?: AsyncJobRecordV1["orchestration"]["failurePolicy"];
    readonly parentJobId?: AsyncJobId;
  };
  /** Lets an orchestrator predeclare exact child identities before queueing. */
  readonly preallocatedJobId?: AsyncJobId;
  readonly request: AsyncJobCreateRequestV1;
  readonly reservationRequested?: boolean;
}

export type JobCreationOutcomeV1 =
  | {
      readonly job: AsyncJobRecordV1;
      readonly kind: "created" | "duplicate";
    }
  | {
      readonly code: string;
      readonly kind: "denied";
      readonly publicMessage: AsyncJobFailureV1["publicMessage"];
    }
  | {
      readonly kind: "in-progress";
      readonly retryAfterMilliseconds: number;
    };

/**
 * Immutable, replay-safe creation authority captured before any commercial
 * hook runs. Raw idempotency keys and tenant identity never belong here.
 */
export interface JobCreationPlanV1 {
  readonly expiresAt?: string;
  readonly input: AsyncJobCreateRequestV1["input"];
  readonly inputDigest: AsyncJobRecordV1["inputDigest"];
  readonly inputSizeBytes: number;
  readonly limits: AsyncJobLimitsV1;
  readonly orchestration: AsyncJobRecordV1["orchestration"];
  readonly reservationRequested: boolean;
}

/** Internal durable creation claim, not a competing job wire record. */
export interface JobCreationClaimV1 {
  readonly claimedAt: string;
  readonly correlationId: AsyncJobRecordV1["correlationId"];
  readonly creation: JobCreationPlanV1;
  readonly denial: {
    readonly code: string;
    readonly publicMessage: AsyncJobFailureV1["publicMessage"];
  } | null;
  readonly entitlementDecision: EntitlementDecisionV1 | null;
  readonly idempotency: JobIdempotencyClaimV1;
  readonly jobId: AsyncJobId;
  readonly ownership: AsyncJobRecordV1["ownership"];
  readonly recordVersion: number;
  readonly reservationDecision: CreditReservationDecisionV1 | null;
  readonly status: "claimed" | "completed" | "denied";
  readonly updatedAt: string;
}

export type ClaimJobCreationResultV1 =
  | { readonly claim: JobCreationClaimV1; readonly kind: "claimed" }
  | { readonly claim: JobCreationClaimV1; readonly kind: "existing" }
  | { readonly kind: "conflict" };

export interface JobQueueDeliveryV1 {
  readonly deliveryId: string;
  readonly envelope: import("@cloudmarkup/schemas").AsyncJobQueueEnvelopeV1;
  readonly leaseExpiresAt: string;
}

export interface EntitlementDecisionV1 {
  readonly allowed: boolean;
  readonly decisionReference: string;
  readonly denialCode?: string;
  readonly publicMessage?: AsyncJobFailureV1["publicMessage"];
}

export interface CreditReservationDecisionV1 {
  readonly allowed: boolean;
  readonly denialCode?: string;
  readonly publicMessage?: AsyncJobFailureV1["publicMessage"];
  readonly reservationId?: string;
}

export function isTerminalJobState(
  state: AsyncJobStateV1,
): state is TerminalJobStateV1 {
  return (TERMINAL_JOB_STATES as readonly AsyncJobStateV1[]).includes(state);
}

export class JobFrameworkError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "JobFrameworkError";
    this.code = code;
  }
}

export class JobExecutionError extends Error {
  public readonly failure: AsyncJobFailureV1;

  public constructor(failure: AsyncJobFailureV1) {
    super(failure.publicMessage);
    this.name = "JobExecutionError";
    this.failure = failure;
  }
}
