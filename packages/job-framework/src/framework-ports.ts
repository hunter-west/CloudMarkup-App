import type {
  AsyncJobHandlerRegistrationV1,
  AsyncJobHandlerResumePolicyV1,
  AsyncJobOrchestrationDecisionV1,
} from "@cloudmarkup/domain";
import type {
  AsyncJobAuditEventV1,
  AsyncJobCheckpointV1,
  AsyncJobFailureV1,
  AsyncJobFamilyV1,
  AsyncJobHandlerOutcomeV1,
  AsyncJobId,
  AsyncJobProgressV1,
  AsyncJobQueueEnvelopeV1,
  AsyncJobRecordV1,
  AsyncJobTrustedContextV1,
  Sha256Digest,
} from "@cloudmarkup/schemas";

import type {
  ClaimJobCreationResultV1,
  CreditReservationDecisionV1,
  EntitlementDecisionV1,
  JobCreationClaimV1,
  JobQueueDeliveryV1,
} from "./framework-contracts.js";
import type { JobAuditOutboxEntryV1 } from "./framework-audit.js";

export interface JobClock {
  now(): Date;
}

export type JobGeneratedIdKind =
  | "artifact"
  | "attempt"
  | "audit-event"
  | "checkpoint"
  | "internal-error"
  | "job"
  | "object"
  | "queue-delivery";

export interface JobIdGenerator {
  nextId(kind: JobGeneratedIdKind): string;
}

export interface JobRepository {
  claimCreation(input: {
    readonly claimedAt: string;
    readonly correlationId: AsyncJobRecordV1["correlationId"];
    readonly creation: JobCreationClaimV1["creation"];
    readonly idempotency: AsyncJobRecordV1["idempotency"];
    readonly jobId: AsyncJobId;
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<ClaimJobCreationResultV1>;
  completeCreation(
    claim: JobCreationClaimV1,
    record: AsyncJobRecordV1,
    updatedAt: string,
    auditEntries: readonly JobAuditOutboxEntryV1[],
  ): Promise<AsyncJobRecordV1>;
  denyCreation(
    claim: JobCreationClaimV1,
    denial: NonNullable<JobCreationClaimV1["denial"]>,
    updatedAt: string,
    auditEntry: Extract<JobAuditOutboxEntryV1, { kind: "creation-claim" }>,
  ): Promise<JobCreationClaimV1>;
  get(jobId: string): Promise<AsyncJobRecordV1 | null>;
  getCreationClaim(input: {
    readonly keyDigest: AsyncJobRecordV1["idempotency"]["keyDigest"];
    readonly operationId: AsyncJobRecordV1["idempotency"]["operationId"];
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<JobCreationClaimV1 | null>;
  listChildren(parentJobId: string): Promise<readonly AsyncJobRecordV1[]>;
  listStaleCreationClaims(input: {
    readonly limit: number;
    readonly ownership: AsyncJobRecordV1["ownership"];
    readonly updatedBefore: string;
  }): Promise<readonly JobCreationClaimV1[]>;
  listPendingAuditEntries(input: {
    readonly limit: number;
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<readonly JobAuditOutboxEntryV1[]>;
  listJobsWithExpiredLeases(input: {
    readonly expiredBefore: string;
    readonly limit: number;
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<readonly AsyncJobRecordV1[]>;
  listJobsPastRetention(input: {
    readonly expiredBefore: string;
    readonly limit: number;
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<readonly AsyncJobRecordV1[]>;
  listQueuedJobsReadyForDispatch(input: {
    readonly availableAtOrBefore: string;
    readonly limit: number;
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<readonly AsyncJobRecordV1[]>;
  markAuditEntryPublished(input: {
    readonly eventId: AsyncJobAuditEventV1["eventId"];
    readonly ownership: AsyncJobRecordV1["ownership"];
    readonly publishedAt: string;
  }): Promise<void>;
  recordEntitlement(
    claim: JobCreationClaimV1,
    decision: EntitlementDecisionV1,
    updatedAt: string,
  ): Promise<JobCreationClaimV1>;
  recordReservation(
    claim: JobCreationClaimV1,
    decision: CreditReservationDecisionV1,
    updatedAt: string,
  ): Promise<JobCreationClaimV1>;
  saveWithAudit(
    record: AsyncJobRecordV1,
    expectedRecordVersion: number,
    auditEntries: readonly JobAuditOutboxEntryV1[],
  ): Promise<AsyncJobRecordV1>;
}

/** Version-one publication only. Physical delivery is at-least-once: a resolved
 * send means transport acceptance, not unique delivery or logical execution.
 * A rejected/uncertain send may still have been accepted. Existing durable
 * queued-publication recovery and worker CAS/attempt fences remain required. */
export interface JobQueuePublisherV1 {
  readonly contractVersion: 1;
  publish(envelope: AsyncJobQueueEnvelopeV1): Promise<void>;
}

/** Additive producer/service choice. Never substitute a publisher for JobQueue. */
export type JobPublicationTransportV1 =
  | { readonly queue: JobQueue; readonly publisher?: never }
  | { readonly publisher: JobQueuePublisherV1; readonly queue?: never };

/** `publish` must be idempotent for the envelope job/attempt identity. */
export interface JobQueue {
  acknowledge(deliveryId: string): Promise<void>;
  publish(envelope: AsyncJobQueueEnvelopeV1): Promise<void>;
  receive(input: {
    readonly leaseMilliseconds: number;
    readonly now: string;
    readonly workerId: string;
  }): Promise<JobQueueDeliveryV1 | null>;
  release(deliveryId: string, availableAt: string): Promise<void>;
}

/** Committed feature inputs, not queue delivery, establish dispatch readiness.
 * Export orchestration requires this port; false means durably queued but not yet dispatchable. */
export interface JobPublicationReadinessPort {
  isReady(record: AsyncJobRecordV1): Promise<boolean>;
}

export interface JobEntitlementPort {
  evaluate(input: {
    readonly context: AsyncJobTrustedContextV1;
    readonly family: AsyncJobFamilyV1;
    readonly idempotencyKeyDigest: string;
    readonly jobId: AsyncJobId;
  }): Promise<EntitlementDecisionV1>;
}

export interface JobCreditReservationPort {
  /** Implementations must key reservation on the supplied idempotency digest. */
  reserve(input: {
    readonly context: AsyncJobTrustedContextV1;
    readonly family: AsyncJobFamilyV1;
    readonly idempotencyKeyDigest: string;
    readonly jobId: AsyncJobId;
  }): Promise<CreditReservationDecisionV1>;
}

export interface JobAuditPort {
  /** Idempotent on the durable event identity. */
  append(entry: JobAuditOutboxEntryV1): Promise<void>;
}

export interface JobOrchestrationDecisionRecordV1 {
  readonly childStateDigest: Sha256Digest;
  readonly correlationId: AsyncJobRecordV1["correlationId"];
  readonly decision: AsyncJobOrchestrationDecisionV1;
  /** Stable idempotency identity for one parent version and exact child states. */
  readonly decisionId: Sha256Digest;
  readonly ownership: AsyncJobRecordV1["ownership"];
  readonly parentJobId: AsyncJobId;
  readonly parentRecordVersion: number;
  readonly recordedAt: string;
}

/** Durable follow-up journal; it never performs child cancellation itself. */
export interface JobOrchestrationDecisionPort {
  record(decision: JobOrchestrationDecisionRecordV1): Promise<void>;
}

export interface JobHandlerContextV1 {
  readonly attemptNumber: number;
  readonly checkpoint: AsyncJobCheckpointV1 | undefined;
  readonly correlationId: AsyncJobRecordV1["correlationId"];
  readonly jobId: AsyncJobId;
  readonly ownership: AsyncJobRecordV1["ownership"];
  heartbeat(): Promise<void>;
  isCancellationRequested(): Promise<boolean>;
  reportProgress(
    progress: Omit<AsyncJobProgressV1, "updatedAt">,
  ): Promise<void>;
  saveCheckpoint(checkpoint: AsyncJobCheckpointV1): Promise<void>;
}

export interface JobHandlerV1 {
  readonly family: AsyncJobFamilyV1;
  readonly handlerId: string;
  readonly handlerVersion: string;
  readonly resumePolicy: AsyncJobHandlerResumePolicyV1;
  execute(
    record: AsyncJobRecordV1,
    context: JobHandlerContextV1,
  ): Promise<AsyncJobHandlerOutcomeV1>;
}

export interface JobHandlerRegistry {
  get(family: AsyncJobFamilyV1): JobHandlerV1 | null;
}

export interface JobFailureClassifier {
  classify(error: unknown, internalErrorId: string): AsyncJobFailureV1;
}

export interface JobBackoffPolicy {
  delayMilliseconds(input: {
    readonly attemptNumber: number;
    readonly classification: AsyncJobFailureV1["classification"];
    readonly jobId: AsyncJobId;
  }): number;
}

export type TrustedJobHandlerRegistrationV1 = AsyncJobHandlerRegistrationV1;

/** Future authenticated server-event source. No stream implementation exists. */
export interface JobEventCursorSource {
  eventsAfter(input: {
    readonly context: AsyncJobTrustedContextV1;
    readonly cursor: string | null;
    readonly jobId: AsyncJobId;
  }): AsyncIterable<AsyncJobAuditEventV1>;
}
