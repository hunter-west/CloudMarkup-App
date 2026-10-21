/* eslint-disable @typescript-eslint/require-await -- In-memory adapters intentionally implement asynchronous production port contracts. */

import { deriveAsyncJobQueueEnvelopeV1 } from "@cloudmarkup/domain";
import {
  parseAsyncJobRecordV1,
  type AsyncJobAuditEventV1,
  type AsyncJobFamilyV1,
  type AsyncJobQueueEnvelopeV1,
  type AsyncJobRecordV1,
  type AsyncJobTrustedContextV1,
} from "@cloudmarkup/schemas";

import type {
  ClaimJobCreationResultV1,
  CreditReservationDecisionV1,
  EntitlementDecisionV1,
  JobCreationClaimV1,
  JobQueueDeliveryV1,
} from "./framework-contracts.js";
import { JobFrameworkError } from "./framework-contracts.js";
import type {
  JobAuditOutboxEntryV1,
  JobCreationClaimAuditEventV1,
} from "./framework-audit.js";
import type {
  JobAuditPort,
  JobClock,
  JobCreditReservationPort,
  JobEntitlementPort,
  JobGeneratedIdKind,
  JobHandlerRegistry,
  JobHandlerV1,
  JobIdGenerator,
  JobOrchestrationDecisionPort,
  JobOrchestrationDecisionRecordV1,
  JobQueue,
  JobRepository,
} from "./framework-ports.js";

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function claimKey(claim: {
  readonly idempotency: AsyncJobRecordV1["idempotency"];
  readonly ownership: AsyncJobRecordV1["ownership"];
}): string {
  return `${claim.ownership.organizationId}\u0000${claim.idempotency.operationId}\u0000${claim.idempotency.keyDigest}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameOwnership(
  left: AsyncJobRecordV1["ownership"],
  right: AsyncJobRecordV1["ownership"],
): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.projectId === right.projectId
  );
}
function comparableCreationAuthority(
  creation: JobCreationClaimV1["creation"],
): unknown {
  return {
    ...creation,
    orchestration: {
      ...creation.orchestration,
      ...(creation.orchestration.parentJobId === undefined
        ? { rootJobId: "self" }
        : {}),
    },
  };
}

function immutableRecordAuthority(record: AsyncJobRecordV1): unknown {
  return {
    contractVersion: record.contractVersion,
    correlationId: record.correlationId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    family: record.family,
    idempotency: record.idempotency,
    input: record.input,
    inputDigest: record.inputDigest,
    inputSizeBytes: record.inputSizeBytes,
    jobId: record.jobId,
    limits: record.limits,
    orchestration: record.orchestration,
    ownership: record.ownership,
    queuedAt: record.queuedAt,
    reservation: record.reservation,
  };
}

export class InMemoryJobRepository implements JobRepository {
  readonly #auditOutbox = new Map<
    string,
    { entry: JobAuditOutboxEntryV1; publishedAt: string | null }
  >();
  readonly #claims = new Map<string, JobCreationClaimV1>();
  readonly #records = new Map<string, AsyncJobRecordV1>();

  public async claimCreation(input: {
    readonly claimedAt: string;
    readonly correlationId: AsyncJobRecordV1["correlationId"];
    readonly creation: JobCreationClaimV1["creation"];
    readonly idempotency: AsyncJobRecordV1["idempotency"];
    readonly jobId: AsyncJobRecordV1["jobId"];
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<ClaimJobCreationResultV1> {
    const key = claimKey(input);
    const existing = this.#claims.get(key);
    if (existing !== undefined) {
      if (
        existing.idempotency.requestDigest !==
          input.idempotency.requestDigest ||
        existing.idempotency.actorId !== input.idempotency.actorId ||
        !sameJson(existing.ownership, input.ownership) ||
        !sameJson(
          comparableCreationAuthority(existing.creation),
          comparableCreationAuthority(input.creation),
        )
      ) {
        return { kind: "conflict" };
      }
      return { claim: copy(existing), kind: "existing" };
    }
    const claim: JobCreationClaimV1 = {
      claimedAt: input.claimedAt,
      correlationId: input.correlationId,
      creation: copy(input.creation),
      denial: null,
      entitlementDecision: null,
      idempotency: copy(input.idempotency),
      jobId: input.jobId,
      ownership: copy(input.ownership),
      recordVersion: 1,
      reservationDecision: null,
      status: "claimed",
      updatedAt: input.claimedAt,
    };
    this.#claims.set(key, claim);
    return { claim: copy(claim), kind: "claimed" };
  }

  public async completeCreation(
    claim: JobCreationClaimV1,
    record: AsyncJobRecordV1,
    updatedAt: string,
    auditEntries: readonly JobAuditOutboxEntryV1[],
  ): Promise<AsyncJobRecordV1> {
    const key = claimKey(claim);
    const current = this.#claims.get(key);
    if (
      current?.recordVersion !== claim.recordVersion ||
      current.status !== "claimed"
    ) {
      throw new JobFrameworkError(
        "job.creation-claim-conflict",
        "The creation claim changed before completion.",
      );
    }
    const reservation = this.#reservationFor(current);
    if (
      current.entitlementDecision?.allowed !== true ||
      updatedAt < current.updatedAt ||
      record.jobId !== current.jobId ||
      record.createdAt !== current.claimedAt ||
      !sameJson(record.ownership, current.ownership) ||
      record.correlationId !== current.correlationId ||
      !sameJson(record.idempotency, current.idempotency) ||
      !sameJson(record.input, current.creation.input) ||
      record.inputDigest !== current.creation.inputDigest ||
      record.inputSizeBytes !== current.creation.inputSizeBytes ||
      !sameJson(record.limits, current.creation.limits) ||
      !sameJson(record.orchestration, current.creation.orchestration) ||
      record.expiresAt !== current.creation.expiresAt ||
      !sameJson(record.reservation, reservation)
    ) {
      throw new JobFrameworkError(
        "job.creation-claim-mismatch",
        "The job record does not match its durable creation decisions.",
      );
    }
    if (this.#records.has(record.jobId)) {
      throw new JobFrameworkError(
        "job.already-exists",
        "The job identifier already exists.",
      );
    }
    const eventTypes = new Set(
      auditEntries
        .filter((entry) => entry.kind === "job")
        .map((entry) => entry.event.eventType),
    );
    if (
      auditEntries.length < 3 ||
      auditEntries.some(
        (entry) =>
          entry.kind !== "job" ||
          entry.event.jobId !== record.jobId ||
          entry.event.correlationId !== record.correlationId ||
          !sameOwnership(entry.event.ownership, record.ownership),
      ) ||
      !eventTypes.has("entitlement-authorized") ||
      !eventTypes.has("job-created") ||
      !eventTypes.has("job-enqueued") ||
      (current.creation.reservationRequested &&
        !eventTypes.has("reservation-established"))
    ) {
      throw new JobFrameworkError(
        "job.audit-outbox-mismatch",
        "Creation audit entries do not match the durable job.",
      );
    }
    const stagedAudit = this.#stageAuditEntries(auditEntries);
    const stored = parseAsyncJobRecordV1({ ...record, recordVersion: 1 });
    const completed: JobCreationClaimV1 = {
      ...current,
      recordVersion: current.recordVersion + 1,
      status: "completed",
      updatedAt,
    };
    this.#records.set(stored.jobId, copy(stored));
    this.#claims.set(key, completed);
    this.#commitAuditEntries(stagedAudit);
    return copy(stored);
  }

  public async denyCreation(
    claim: JobCreationClaimV1,
    denial: NonNullable<JobCreationClaimV1["denial"]>,
    updatedAt: string,
    auditEntry: Extract<JobAuditOutboxEntryV1, { kind: "creation-claim" }>,
  ): Promise<JobCreationClaimV1> {
    const key = claimKey(claim);
    const current = this.#claims.get(key);
    if (
      current?.recordVersion !== claim.recordVersion ||
      current.status !== "claimed" ||
      updatedAt < current.updatedAt ||
      auditEntry.event.claimRecordVersion !== current.recordVersion + 1 ||
      auditEntry.event.correlationId !== current.correlationId ||
      !sameJson(auditEntry.event.denial, denial) ||
      !sameJson(auditEntry.event.idempotency, current.idempotency) ||
      !sameOwnership(auditEntry.event.ownership, current.ownership)
    ) {
      throw new JobFrameworkError(
        "job.creation-claim-conflict",
        "The creation claim changed before denial was stored.",
      );
    }
    const stagedAudit = this.#stageAuditEntries([auditEntry]);
    const denied: JobCreationClaimV1 = {
      ...current,
      denial: copy(denial),
      recordVersion: current.recordVersion + 1,
      status: "denied",
      updatedAt,
    };
    this.#claims.set(key, denied);
    this.#commitAuditEntries(stagedAudit);
    return copy(denied);
  }

  public async get(jobId: string): Promise<AsyncJobRecordV1 | null> {
    const record = this.#records.get(jobId);
    return record === undefined ? null : copy(record);
  }

  public async getCreationClaim(input: {
    readonly keyDigest: AsyncJobRecordV1["idempotency"]["keyDigest"];
    readonly operationId: AsyncJobRecordV1["idempotency"]["operationId"];
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<JobCreationClaimV1 | null> {
    const key = `${input.ownership.organizationId}\u0000${input.operationId}\u0000${input.keyDigest}`;
    const claim = this.#claims.get(key);
    return claim === undefined || !sameJson(claim.ownership, input.ownership)
      ? null
      : copy(claim);
  }

  public async listChildren(
    parentJobId: string,
  ): Promise<readonly AsyncJobRecordV1[]> {
    return [...this.#records.values()]
      .filter((record) => record.orchestration.parentJobId === parentJobId)
      .sort((left, right) => left.jobId.localeCompare(right.jobId))
      .map(copy);
  }

  public async listStaleCreationClaims(input: {
    readonly limit: number;
    readonly ownership: AsyncJobRecordV1["ownership"];
    readonly updatedBefore: string;
  }): Promise<readonly JobCreationClaimV1[]> {
    return [...this.#claims.values()]
      .filter(
        (claim) =>
          sameOwnership(claim.ownership, input.ownership) &&
          claim.status === "claimed" &&
          claim.updatedAt <= input.updatedBefore,
      )
      .sort(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) ||
          left.jobId.localeCompare(right.jobId),
      )
      .slice(0, input.limit)
      .map(copy);
  }

  public async listPendingAuditEntries(input: {
    readonly limit: number;
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<readonly JobAuditOutboxEntryV1[]> {
    return [...this.#auditOutbox.values()]
      .filter(
        (stored) =>
          stored.publishedAt === null &&
          sameOwnership(stored.entry.event.ownership, input.ownership),
      )
      .sort(
        (left, right) =>
          left.entry.event.occurredAt.localeCompare(
            right.entry.event.occurredAt,
          ) ||
          left.entry.event.eventId.localeCompare(right.entry.event.eventId),
      )
      .slice(0, input.limit)
      .map((stored) => copy(stored.entry));
  }

  public async listJobsWithExpiredLeases(input: {
    readonly expiredBefore: string;
    readonly limit: number;
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<readonly AsyncJobRecordV1[]> {
    return [...this.#records.values()]
      .filter((record) => {
        if (!sameOwnership(record.ownership, input.ownership)) {
          return false;
        }
        const attempt = record.attempts.at(-1);
        return (
          record.state === "running" &&
          attempt?.state === "running" &&
          attempt.lease !== undefined &&
          attempt.lease.leaseExpiresAt <= input.expiredBefore
        );
      })
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, input.limit)
      .map(copy);
  }

  public async listJobsPastRetention(input: {
    readonly expiredBefore: string;
    readonly limit: number;
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<readonly AsyncJobRecordV1[]> {
    return [...this.#records.values()]
      .filter(
        (record) =>
          sameOwnership(record.ownership, input.ownership) &&
          record.expiresAt !== undefined &&
          record.expiresAt <= input.expiredBefore &&
          (record.state === "queued" ||
            record.state === "awaiting-user-input" ||
            record.state === "running"),
      )
      .sort((left, right) =>
        (left.expiresAt ?? "").localeCompare(right.expiresAt ?? ""),
      )
      .slice(0, input.limit)
      .map(copy);
  }

  public async listQueuedJobsReadyForDispatch(input: {
    readonly availableAtOrBefore: string;
    readonly limit: number;
    readonly ownership: AsyncJobRecordV1["ownership"];
  }): Promise<readonly AsyncJobRecordV1[]> {
    return [...this.#records.values()]
      .filter((record) => {
        if (
          !sameOwnership(record.ownership, input.ownership) ||
          record.state !== "queued"
        ) {
          return false;
        }
        return (
          deriveAsyncJobQueueEnvelopeV1(record).availableAt <=
          input.availableAtOrBefore
        );
      })
      .sort((left, right) => {
        const leftEnvelope = deriveAsyncJobQueueEnvelopeV1(left);
        const rightEnvelope = deriveAsyncJobQueueEnvelopeV1(right);
        return (
          leftEnvelope.availableAt.localeCompare(rightEnvelope.availableAt) ||
          left.jobId.localeCompare(right.jobId)
        );
      })
      .slice(0, input.limit)
      .map(copy);
  }

  public async markAuditEntryPublished(input: {
    readonly eventId: AsyncJobAuditEventV1["eventId"];
    readonly ownership: AsyncJobRecordV1["ownership"];
    readonly publishedAt: string;
  }): Promise<void> {
    const stored = this.#auditOutbox.get(input.eventId);
    if (
      stored === undefined ||
      !sameOwnership(stored.entry.event.ownership, input.ownership)
    ) {
      throw new JobFrameworkError(
        "job.audit-outbox-not-found",
        "The audit outbox entry was not found.",
      );
    }
    if (stored.publishedAt === null) {
      this.#auditOutbox.set(input.eventId, {
        entry: stored.entry,
        publishedAt: input.publishedAt,
      });
    }
  }

  public async recordEntitlement(
    claim: JobCreationClaimV1,
    decision: EntitlementDecisionV1,
    updatedAt: string,
  ): Promise<JobCreationClaimV1> {
    const key = claimKey(claim);
    const current = this.#claims.get(key);
    if (
      current?.status === "claimed" &&
      current.entitlementDecision !== null &&
      sameJson(current.entitlementDecision, decision)
    ) {
      return copy(current);
    }
    if (
      current?.recordVersion !== claim.recordVersion ||
      current.status !== "claimed" ||
      current.entitlementDecision !== null ||
      updatedAt < current.updatedAt ||
      decision.decisionReference.length < 1 ||
      decision.decisionReference.length > 128
    ) {
      throw new JobFrameworkError(
        "job.creation-claim-conflict",
        "The creation claim changed before entitlement was recorded.",
      );
    }
    const recorded: JobCreationClaimV1 = {
      ...current,
      entitlementDecision: copy(decision),
      recordVersion: current.recordVersion + 1,
      updatedAt,
    };
    this.#claims.set(key, recorded);
    return copy(recorded);
  }

  public async recordReservation(
    claim: JobCreationClaimV1,
    decision: CreditReservationDecisionV1,
    updatedAt: string,
  ): Promise<JobCreationClaimV1> {
    const key = claimKey(claim);
    const current = this.#claims.get(key);
    if (
      current?.status === "claimed" &&
      current.reservationDecision !== null &&
      sameJson(current.reservationDecision, decision)
    ) {
      return copy(current);
    }
    if (
      current?.recordVersion !== claim.recordVersion ||
      current.status !== "claimed" ||
      current.entitlementDecision?.allowed !== true ||
      !current.creation.reservationRequested ||
      current.reservationDecision !== null ||
      updatedAt < current.updatedAt ||
      (decision.allowed && decision.reservationId === undefined)
    ) {
      throw new JobFrameworkError(
        "job.creation-claim-conflict",
        "The creation claim changed before reservation was recorded.",
      );
    }
    const recorded: JobCreationClaimV1 = {
      ...current,
      recordVersion: current.recordVersion + 1,
      reservationDecision: copy(decision),
      updatedAt,
    };
    this.#claims.set(key, recorded);
    return copy(recorded);
  }

  public async saveWithAudit(
    record: AsyncJobRecordV1,
    expectedRecordVersion: number,
    auditEntries: readonly JobAuditOutboxEntryV1[],
  ): Promise<AsyncJobRecordV1> {
    const current = this.#records.get(record.jobId);
    if (current?.recordVersion !== expectedRecordVersion) {
      throw new JobFrameworkError(
        "job.write-conflict",
        "The job changed before the update was saved.",
      );
    }
    if (
      !sameJson(
        immutableRecordAuthority(current),
        immutableRecordAuthority(record),
      )
    ) {
      throw new JobFrameworkError(
        "job.immutable-authority-changed",
        "Immutable job authority cannot change.",
      );
    }
    const stored = parseAsyncJobRecordV1({
      ...record,
      recordVersion: expectedRecordVersion + 1,
    });
    if (
      auditEntries.length === 0 ||
      auditEntries.some(
        (entry) =>
          entry.kind !== "job" ||
          entry.event.jobId !== stored.jobId ||
          entry.event.correlationId !== stored.correlationId ||
          !sameOwnership(entry.event.ownership, stored.ownership) ||
          entry.event.transition?.recordVersion !== stored.recordVersion,
      )
    ) {
      throw new JobFrameworkError(
        "job.audit-outbox-mismatch",
        "Mutation audit entries must identify the exact stored version.",
      );
    }
    const stagedAudit = this.#stageAuditEntries(auditEntries);
    this.#records.set(stored.jobId, copy(stored));
    this.#commitAuditEntries(stagedAudit);
    return copy(stored);
  }

  #commitAuditEntries(
    staged: ReadonlyMap<
      string,
      { entry: JobAuditOutboxEntryV1; publishedAt: string | null }
    >,
  ): void {
    for (const [eventId, stored] of staged) {
      this.#auditOutbox.set(eventId, stored);
    }
  }

  #reservationFor(claim: JobCreationClaimV1): AsyncJobRecordV1["reservation"] {
    if (!claim.creation.reservationRequested) {
      if (claim.reservationDecision !== null) {
        throw new JobFrameworkError(
          "job.creation-claim-mismatch",
          "An unrequested reservation decision cannot complete a job.",
        );
      }
      return { state: "none" };
    }
    if (
      claim.reservationDecision?.allowed !== true ||
      claim.reservationDecision.reservationId === undefined
    ) {
      throw new JobFrameworkError(
        "job.creation-claim-mismatch",
        "A requested reservation requires durable approval.",
      );
    }
    return {
      reservationId: claim.reservationDecision.reservationId,
      state: "reserved",
    };
  }

  #stageAuditEntries(
    entries: readonly JobAuditOutboxEntryV1[],
  ): ReadonlyMap<
    string,
    { entry: JobAuditOutboxEntryV1; publishedAt: string | null }
  > {
    const staged = new Map<
      string,
      { entry: JobAuditOutboxEntryV1; publishedAt: string | null }
    >();
    for (const entry of entries) {
      const eventId = entry.event.eventId;
      const existing = this.#auditOutbox.get(eventId) ?? staged.get(eventId);
      if (existing !== undefined) {
        if (!sameJson(existing.entry, entry)) {
          throw new JobFrameworkError(
            "job.audit-event-collision",
            "An audit event identity was reused for different evidence.",
          );
        }
        continue;
      }
      staged.set(eventId, { entry: copy(entry), publishedAt: null });
    }
    return staged;
  }
}

interface QueueEntry {
  deliveryId: string | null;
  envelope: AsyncJobQueueEnvelopeV1;
  leaseExpiresAt: string | null;
  sequence: number;
  visibleAt: string;
}

export class InMemoryFifoJobQueue implements JobQueue {
  readonly #entries: QueueEntry[] = [];
  readonly #ids: JobIdGenerator;
  #sequence = 0;

  public constructor(ids: JobIdGenerator) {
    this.#ids = ids;
  }

  public async acknowledge(deliveryId: string): Promise<void> {
    const index = this.#entries.findIndex(
      (entry) => entry.deliveryId === deliveryId,
    );
    if (index >= 0) {
      this.#entries.splice(index, 1);
    }
  }

  public async publish(envelope: AsyncJobQueueEnvelopeV1): Promise<void> {
    if (
      this.#entries.some(
        (entry) =>
          entry.envelope.jobId === envelope.jobId &&
          entry.envelope.attemptNumber === envelope.attemptNumber,
      )
    ) {
      return;
    }
    this.#sequence += 1;
    this.#entries.push({
      deliveryId: null,
      envelope: copy(envelope),
      leaseExpiresAt: null,
      sequence: this.#sequence,
      visibleAt: envelope.availableAt,
    });
  }

  public async receive(input: {
    readonly leaseMilliseconds: number;
    readonly now: string;
    readonly workerId: string;
  }): Promise<JobQueueDeliveryV1 | null> {
    const entry = this.#entries
      .filter(
        (candidate) =>
          candidate.visibleAt <= input.now &&
          (candidate.deliveryId === null ||
            (candidate.leaseExpiresAt !== null &&
              candidate.leaseExpiresAt <= input.now)),
      )
      .sort((left, right) => left.sequence - right.sequence)[0];
    if (entry === undefined) {
      return null;
    }
    entry.deliveryId = this.#ids.nextId("queue-delivery");
    entry.leaseExpiresAt = new Date(
      Date.parse(input.now) + input.leaseMilliseconds,
    ).toISOString();
    return {
      deliveryId: entry.deliveryId,
      envelope: copy(entry.envelope),
      leaseExpiresAt: entry.leaseExpiresAt,
    };
  }

  public async release(deliveryId: string, availableAt: string): Promise<void> {
    const entry = this.#entries.find(
      (candidate) => candidate.deliveryId === deliveryId,
    );
    if (entry === undefined) {
      return;
    }
    entry.deliveryId = null;
    entry.leaseExpiresAt = null;
    entry.visibleAt = availableAt;
  }

  public get size(): number {
    return this.#entries.length;
  }
}

export class MutableJobClock implements JobClock {
  #current: Date;

  public constructor(initial: Date | string) {
    this.#current = new Date(initial);
  }

  public advance(milliseconds: number): void {
    this.#current = new Date(this.#current.getTime() + milliseconds);
  }

  public now(): Date {
    return new Date(this.#current);
  }
}

export class SequentialJobIdGenerator implements JobIdGenerator {
  readonly #prefix: string;
  #value = 0;

  public constructor(prefix = "local") {
    this.#prefix = prefix;
  }

  public nextId(kind: JobGeneratedIdKind): string {
    this.#value += 1;
    return `${kind}_${this.#prefix}_${String(this.#value).padStart(6, "0")}`;
  }
}

export class InMemoryJobAuditPort implements JobAuditPort {
  readonly #creationClaimEvents = new Map<
    string,
    JobCreationClaimAuditEventV1
  >();
  readonly #events = new Map<string, AsyncJobAuditEventV1>();

  public async append(entry: JobAuditOutboxEntryV1): Promise<void> {
    if (entry.kind === "job") {
      this.#events.set(entry.event.eventId, copy(entry.event));
      return;
    }
    this.#creationClaimEvents.set(entry.event.eventId, copy(entry.event));
  }

  public get creationClaimEvents(): readonly JobCreationClaimAuditEventV1[] {
    return [...this.#creationClaimEvents.values()].map(copy);
  }

  public get events(): readonly AsyncJobAuditEventV1[] {
    return [...this.#events.values()].map(copy);
  }
}

export class InMemoryJobOrchestrationDecisionPort implements JobOrchestrationDecisionPort {
  readonly #decisions = new Map<string, JobOrchestrationDecisionRecordV1>();

  public async record(
    decision: JobOrchestrationDecisionRecordV1,
  ): Promise<void> {
    const existing = this.#decisions.get(decision.decisionId);
    if (existing !== undefined) {
      return;
    }
    this.#decisions.set(decision.decisionId, copy(decision));
  }

  public get decisions(): readonly JobOrchestrationDecisionRecordV1[] {
    return [...this.#decisions.values()].map(copy);
  }
}

export class AllowAllJobEntitlementPort implements JobEntitlementPort {
  public calls = 0;

  public async evaluate(input: {
    readonly context: AsyncJobTrustedContextV1;
    readonly family: AsyncJobFamilyV1;
    readonly idempotencyKeyDigest: string;
    readonly jobId: AsyncJobRecordV1["jobId"];
  }): Promise<EntitlementDecisionV1> {
    this.calls += 1;
    return {
      allowed: true,
      decisionReference: `entitlement:${input.jobId}`,
    };
  }
}

export class DenyAllJobEntitlementPort implements JobEntitlementPort {
  public calls = 0;

  public async evaluate(): Promise<EntitlementDecisionV1> {
    this.calls += 1;
    return {
      allowed: false,
      decisionReference: "entitlement:denied",
      denialCode: "job.feature-not-entitled",
      publicMessage: "job-not-supported",
    };
  }
}

export class IdempotentFakeReservationPort implements JobCreditReservationPort {
  public calls = 0;
  readonly #reservations = new Map<string, string>();

  public async reserve(input: {
    readonly context: AsyncJobTrustedContextV1;
    readonly family: AsyncJobFamilyV1;
    readonly idempotencyKeyDigest: string;
    readonly jobId: AsyncJobRecordV1["jobId"];
  }): Promise<CreditReservationDecisionV1> {
    this.calls += 1;
    const key = `${input.context.ownership.organizationId}:${input.idempotencyKeyDigest}`;
    const reservationId =
      this.#reservations.get(key) ?? `reservation_${input.jobId}`;
    this.#reservations.set(key, reservationId);
    return { allowed: true, reservationId };
  }
}

export class InMemoryJobHandlerRegistry implements JobHandlerRegistry {
  readonly #handlers = new Map<AsyncJobFamilyV1, JobHandlerV1>();

  public constructor(handlers: readonly JobHandlerV1[] = []) {
    handlers.forEach((handler) => {
      this.register(handler);
    });
  }

  public get(family: AsyncJobFamilyV1): JobHandlerV1 | null {
    return this.#handlers.get(family) ?? null;
  }

  public register(handler: JobHandlerV1): void {
    this.#handlers.set(handler.family, handler);
  }
}
