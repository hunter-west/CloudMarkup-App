import { hashCanonicalValue } from "@cloudmarkup/domain";
import {
  asyncJobAuditEventIdSchema,
  asyncJobAuditEventV1Schema,
  type AsyncJobAuditEventV1,
  type AsyncJobRecordV1,
  type AsyncJobTrustedContextV1,
} from "@cloudmarkup/schemas";

import type { JobCreationClaimV1 } from "./framework-contracts.js";

export interface JobCreationClaimAuditEventV1 {
  readonly actor: AsyncJobTrustedContextV1["actor"];
  readonly claimRecordVersion: number;
  readonly contractVersion: 1;
  readonly correlationId: JobCreationClaimV1["correlationId"];
  readonly denial: NonNullable<JobCreationClaimV1["denial"]>;
  readonly denialSource: "entitlement" | "recovery" | "reservation";
  readonly eventId: AsyncJobAuditEventV1["eventId"];
  readonly eventType: "creation-denied";
  readonly idempotency: JobCreationClaimV1["idempotency"];
  readonly occurredAt: string;
  readonly ownership: JobCreationClaimV1["ownership"];
}

export type JobAuditOutboxEntryV1 =
  | {
      readonly event: AsyncJobAuditEventV1;
      readonly kind: "job";
    }
  | {
      readonly event: JobCreationClaimAuditEventV1;
      readonly kind: "creation-claim";
    };

function deterministicAuditEventId(value: unknown) {
  return asyncJobAuditEventIdSchema.parse(
    `audit_${hashCanonicalValue(value).slice("sha256:".length)}`,
  );
}

export function createJobAuditOutboxEntryV1(input: {
  readonly actor: AsyncJobTrustedContextV1["actor"];
  readonly eventType: AsyncJobAuditEventV1["eventType"];
  readonly occurredAt: string;
  readonly record: AsyncJobRecordV1;
  readonly transition?: AsyncJobAuditEventV1["transition"];
}): Extract<JobAuditOutboxEntryV1, { kind: "job" }> {
  const event = asyncJobAuditEventV1Schema.parse({
    actor: input.actor,
    correlationId: input.record.correlationId,
    eventId: deterministicAuditEventId({
      contractVersion: 1,
      eventType: input.eventType,
      jobId: input.record.jobId,
      organizationId: input.record.ownership.organizationId,
      recordVersion: input.record.recordVersion,
    }),
    eventType: input.eventType,
    jobId: input.record.jobId,
    occurredAt: input.occurredAt,
    ownership: input.record.ownership,
    ...(input.transition === undefined ? {} : { transition: input.transition }),
  });
  return { event, kind: "job" };
}

export function createCreationClaimAuditOutboxEntryV1(input: {
  readonly actor: AsyncJobTrustedContextV1["actor"];
  readonly claim: JobCreationClaimV1;
  readonly denial: NonNullable<JobCreationClaimV1["denial"]>;
  readonly denialSource: JobCreationClaimAuditEventV1["denialSource"];
  readonly occurredAt: string;
}): Extract<JobAuditOutboxEntryV1, { kind: "creation-claim" }> {
  const claimRecordVersion = input.claim.recordVersion + 1;
  const event: JobCreationClaimAuditEventV1 = {
    actor: input.actor,
    claimRecordVersion,
    contractVersion: 1,
    correlationId: input.claim.correlationId,
    denial: input.denial,
    denialSource: input.denialSource,
    eventId: deterministicAuditEventId({
      claimRecordVersion,
      contractVersion: 1,
      eventType: "creation-denied",
      keyDigest: input.claim.idempotency.keyDigest,
      operationId: input.claim.idempotency.operationId,
      organizationId: input.claim.ownership.organizationId,
    }),
    eventType: "creation-denied",
    idempotency: input.claim.idempotency,
    occurredAt: input.occurredAt,
    ownership: input.claim.ownership,
  };
  return { event, kind: "creation-claim" };
}
