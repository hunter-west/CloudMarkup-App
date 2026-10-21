import {
  applyAsyncJobLifecycleCommandV1,
  cancelAsyncJobChildFromParentV1,
  createAsyncJobFailureV1,
  evaluateAsyncJobChildrenV1,
  failAsyncJobParentFromChildrenV1,
  getAsyncJobRetryDelaySecondsV1,
  hashCanonicalValue,
  sanitizeUnknownAsyncJobFailureV1,
  type AsyncJobHandlerRegistrationV1,
  type AsyncJobOrchestrationDecisionV1,
} from "@cloudmarkup/domain";
import {
  asyncJobAttemptIdSchema,
  asyncJobCheckpointV1Schema,
  asyncJobHandlerOutcomeV1Schema,
  asyncJobTrustedContextV1Schema,
  asyncJobWorkerIdSchema,
  namespacedIdentifierSchema,
  parseAsyncJobRecordV1,
  utcTimestampSchema,
  type AsyncJobAuditEventV1,
  type AsyncJobCheckpointV1,
  type AsyncJobFailureV1,
  type AsyncJobHandlerOutcomeV1,
  type AsyncJobQueueEnvelopeV1,
  type AsyncJobRecordV1,
  type AsyncJobTrustedContextV1,
} from "@cloudmarkup/schemas";

import {
  JobExecutionError,
  JobFrameworkError,
  isTerminalJobState,
} from "./framework-contracts.js";
import { createJobAuditOutboxEntryV1 } from "./framework-audit.js";
import type {
  JobAuditPort,
  JobBackoffPolicy,
  JobClock,
  JobFailureClassifier,
  JobHandlerContextV1,
  JobHandlerRegistry,
  JobHandlerV1,
  JobIdGenerator,
  JobOrchestrationDecisionPort,
  JobPublicationTransportV1,
  JobPublicationReadinessPort,
  JobRepository,
} from "./framework-ports.js";
import {
  publishReadyJobEnvelope,
  selectJobPublicationTransportV1,
} from "./framework-publication.js";

function now(clock: JobClock): string {
  return clock.now().toISOString();
}

function later(
  at: string,
  milliseconds: number,
): ReturnType<typeof utcTimestampSchema.parse> {
  return utcTimestampSchema.parse(
    new Date(Date.parse(at) + milliseconds).toISOString(),
  );
}

function activeAttempt(record: AsyncJobRecordV1) {
  const attempt = record.attempts.at(-1);
  if (
    record.state !== "running" ||
    attempt?.state !== "running" ||
    attempt.lease === undefined
  ) {
    throw new JobFrameworkError(
      "job.attempt-missing",
      "A running job requires an active leased attempt.",
    );
  }
  return attempt;
}

function countOutput(value: unknown): {
  readonly artifactCount: number;
  readonly referencedBytes: number;
} {
  if (Array.isArray(value)) {
    return value.reduce<{
      artifactCount: number;
      referencedBytes: number;
    }>(
      (total, child) => {
        const count = countOutput(child);
        return {
          artifactCount: total.artifactCount + count.artifactCount,
          referencedBytes: total.referencedBytes + count.referencedBytes,
        };
      },
      { artifactCount: 0, referencedBytes: 0 },
    );
  }
  if (value === null || typeof value !== "object") {
    return { artifactCount: 0, referencedBytes: 0 };
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record["objectId"] === "string" &&
    typeof record["sizeBytes"] === "number"
  ) {
    return { artifactCount: 0, referencedBytes: record["sizeBytes"] };
  }
  const children = Object.values(record).reduce<{
    artifactCount: number;
    referencedBytes: number;
  }>(
    (total, child) => {
      const count = countOutput(child);
      return {
        artifactCount: total.artifactCount + count.artifactCount,
        referencedBytes: total.referencedBytes + count.referencedBytes,
      };
    },
    { artifactCount: 0, referencedBytes: 0 },
  );
  return {
    artifactCount:
      children.artifactCount +
      (typeof record["artifactId"] === "string" ? 1 : 0),
    referencedBytes: children.referencedBytes,
  };
}

function boundedOutcome(
  record: AsyncJobRecordV1,
  outcome: AsyncJobHandlerOutcomeV1,
  savedByThisExecution: AsyncJobCheckpointV1 | undefined,
): AsyncJobHandlerOutcomeV1 {
  if (
    outcome.outcome === "failed" &&
    outcome.checkpoint !== undefined &&
    savedByThisExecution !== undefined
  ) {
    const latest = record.checkpoints.at(-1);
    // A handler may repeat the checkpoint whose context save already committed.
    // Recognize only this execution's confirmed save and the exact durable head;
    // new, changed, stale or unconfirmed checkpoints keep domain validation.
    if (
      latest !== undefined &&
      record.latestCheckpointId === latest.checkpointId &&
      latest.attemptNumber === record.attempts.at(-1)?.attemptNumber &&
      latest.inputDigest === record.inputDigest &&
      hashCanonicalValue(latest) === hashCanonicalValue(savedByThisExecution) &&
      hashCanonicalValue(latest) === hashCanonicalValue(outcome.checkpoint)
    ) {
      return { outcome: "failed", failure: outcome.failure };
    }
  }
  if (outcome.outcome !== "succeeded") {
    return outcome;
  }
  const measured = countOutput(outcome.output);
  if (
    outcome.outputSizeBytes > record.limits.outputBytes ||
    measured.referencedBytes > record.limits.outputBytes ||
    measured.artifactCount > record.limits.artifactCount
  ) {
    return asyncJobHandlerOutcomeV1Schema.parse({
      failure: createAsyncJobFailureV1("output-limit-exceeded"),
      outcome: "failed",
    });
  }
  return outcome;
}

function registrationFor(
  family: AsyncJobRecordV1["family"],
  handler: JobHandlerV1 | null,
): AsyncJobHandlerRegistrationV1 {
  return {
    family,
    handlerId: namespacedIdentifierSchema.parse(
      handler?.handlerId ?? "cloudmarkup.job.unsupported-handler",
    ),
    handlerVersion: handler?.handlerVersion ?? "1.0.0",
    resumePolicy: handler?.resumePolicy ?? "not-resumable",
  };
}

function resumableCheckpoint(
  record: AsyncJobRecordV1,
  handler: JobHandlerV1 | null,
): AsyncJobCheckpointV1 | undefined {
  if (
    record.attempts.length === 0 ||
    handler?.resumePolicy !== "checkpoint-required" ||
    record.latestCheckpointId === undefined
  ) {
    return undefined;
  }
  return record.checkpoints.find(
    (item) => item.checkpointId === record.latestCheckpointId,
  );
}

function boundedLeaseExpiresAt(
  record: AsyncJobRecordV1,
  at: string,
  leaseMilliseconds: number,
): ReturnType<typeof utcTimestampSchema.parse> {
  if (!Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 1) {
    throw new JobFrameworkError(
      "job.invalid-lease",
      "A worker lease duration must be a positive integer.",
    );
  }
  const atEpoch = Date.parse(at);
  const completedRuntimeSeconds = record.attempts
    .filter((attempt) => attempt.state !== "running")
    .reduce((total, attempt) => total + attempt.runtimeSeconds, 0);
  const active = record.attempts.at(-1);
  const activeRuntimeSeconds =
    record.state === "running" && active?.state === "running"
      ? Math.ceil(Math.max(0, atEpoch - Date.parse(active.startedAt)) / 1_000)
      : 0;
  const remainingRuntimeMilliseconds = Math.max(
    0,
    (record.limits.runtimeSeconds -
      completedRuntimeSeconds -
      activeRuntimeSeconds) *
      1_000,
  );
  const expirationMilliseconds =
    record.expiresAt === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Date.parse(record.expiresAt) - atEpoch);
  const boundedMilliseconds = Math.min(
    leaseMilliseconds,
    remainingRuntimeMilliseconds,
    expirationMilliseconds,
  );
  if (boundedMilliseconds < 1) {
    throw new JobFrameworkError(
      "job.runtime-or-expiry-exhausted",
      "The job has no remaining lease window.",
    );
  }
  return later(at, boundedMilliseconds);
}

export class DefaultJobFailureClassifier implements JobFailureClassifier {
  public classify(error: unknown, internalErrorId: string): AsyncJobFailureV1 {
    return error instanceof JobExecutionError
      ? error.failure
      : sanitizeUnknownAsyncJobFailureV1(error, internalErrorId);
  }
}

/** Compatibility port implementation; canonical delay remains domain-owned. */
export class ExponentialJobBackoffPolicy implements JobBackoffPolicy {
  public delayMilliseconds(input: {
    readonly attemptNumber: number;
    readonly classification: AsyncJobFailureV1["classification"];
    readonly jobId: AsyncJobRecordV1["jobId"];
  }): number {
    return input.classification === "permanent"
      ? 0
      : getAsyncJobRetryDelaySecondsV1(input.attemptNumber) * 1_000;
  }
}

export type JobWorkerDependencies = JobPublicationTransportV1 & {
  readonly publicationReadiness?: JobPublicationReadinessPort;
  readonly audit: JobAuditPort;
  readonly clock: JobClock;
  readonly failureClassifier: JobFailureClassifier;
  readonly handlers: JobHandlerRegistry;
  readonly ids: JobIdGenerator;
  readonly orchestration: JobOrchestrationDecisionPort;
  readonly repository: JobRepository;
};

export class JobWorker {
  readonly #dependencies: JobWorkerDependencies;

  public constructor(dependencies: JobWorkerDependencies) {
    selectJobPublicationTransportV1(dependencies);
    this.#dependencies = dependencies;
  }

  public async runNext(
    workerIdInput: string,
    leaseMilliseconds = 30_000,
  ): Promise<AsyncJobRecordV1 | null> {
    const queue = this.#dependencies.queue;
    if (queue === undefined)
      throw new JobFrameworkError(
        "job.consumer-transport-required",
        "Polling requires a queue consumer; a publisher cannot receive deliveries.",
      );
    const workerId = asyncJobWorkerIdSchema.parse(workerIdInput);
    const at = now(this.#dependencies.clock);
    const delivery = await queue.receive({
      leaseMilliseconds,
      now: at,
      workerId,
    });
    if (delivery === null) {
      return null;
    }
    const stored = await this.#dependencies.repository.get(
      delivery.envelope.jobId,
    );
    if (stored === null || !this.#envelopeMatches(stored, delivery.envelope)) {
      await queue.acknowledge(delivery.deliveryId);
      return stored;
    }
    if (isTerminalJobState(stored.state)) {
      await this.#recordParentDecision(stored, workerId);
      await queue.acknowledge(delivery.deliveryId);
      return stored;
    }
    if (stored.recordVersion !== delivery.envelope.recordVersion) {
      await queue.acknowledge(delivery.deliveryId);
      return stored;
    }
    if (stored.state !== "queued") {
      await queue.release(delivery.deliveryId, later(at, leaseMilliseconds));
      return stored;
    }

    const parentCoordination = await this.#coordinateParentBeforeClaim(
      stored,
      workerId,
    );
    if (!parentCoordination.execute) {
      if (isTerminalJobState(parentCoordination.job.state)) {
        await queue.acknowledge(delivery.deliveryId);
      } else {
        await queue.release(delivery.deliveryId, later(at, 1_000));
      }
      return parentCoordination.job;
    }
    const queued = parentCoordination.job;
    const dependencies = await Promise.all(
      queued.orchestration.dependencyJobIds.map((jobId) =>
        this.#dependencies.repository.get(jobId),
      ),
    );
    if (dependencies.some((dependency) => dependency?.state !== "succeeded")) {
      await queue.release(delivery.deliveryId, later(at, 1_000));
      return queued;
    }

    const handler = this.#dependencies.handlers.get(queued.family);
    const registration = registrationFor(queued.family, handler);
    const checkpoint = resumableCheckpoint(queued, handler);
    const resumedFrom =
      checkpoint === undefined
        ? undefined
        : {
            checkpointId: checkpoint.checkpointId,
            ...(queued.interaction.state === "user-input-received"
              ? { interactionId: queued.interaction.interactionId }
              : {}),
          };
    const claimedResult = applyAsyncJobLifecycleCommandV1(queued, {
      at,
      attemptId: asyncJobAttemptIdSchema.parse(
        this.#dependencies.ids.nextId("attempt"),
      ),
      dependencies: dependencies.filter(
        (dependency): dependency is AsyncJobRecordV1 => dependency !== null,
      ),
      expectedInputDigest: queued.inputDigest,
      expectedRecordVersion: queued.recordVersion,
      handler: registration,
      kind: "claim",
      leaseExpiresAt: boundedLeaseExpiresAt(queued, at, leaseMilliseconds),
      ...(resumedFrom === undefined ? {} : { resumedFrom }),
      workerId,
    });
    const claimed = await this.#saveResult(
      queued,
      claimedResult,
      workerId,
      "attempt-claimed",
    );

    const completed = await this.#executeClaimed(
      claimed,
      workerId,
      leaseMilliseconds,
    );
    await queue.acknowledge(delivery.deliveryId);
    return completed;
  }

  /** Execute a host's durably committed initial claim without receiving another
   * queue message. The exact stored record and worker lease are reloaded, then a
   * progress CAS fences this entry point before the handler can start. A changed,
   * already-started or expired claim never invokes the handler. The delivered
   * transport remains responsible for terminal reconciliation before ACK. */
  public async runInitialClaimed(
    input: AsyncJobRecordV1,
    workerIdInput: string,
    leaseMilliseconds = 30_000,
  ): Promise<AsyncJobRecordV1> {
    const proposed = parseAsyncJobRecordV1(input);
    if (
      proposed.attempts.length !== 1 ||
      proposed.attempts[0]?.attemptNumber !== 1 ||
      proposed.checkpoints.length !== 0 ||
      proposed.progress?.sequence !== 1 ||
      proposed.progress.completedUnits !== 0
    )
      throw new JobFrameworkError(
        "job.claimed-execution-mismatch",
        "An exact unstarted initial worker claim is required.",
      );
    return this.runClaimed(proposed, workerIdInput, leaseMilliseconds);
  }

  /** The host owns atomic initial/retry admission. Exact stored unstarted
   * attempts use the same CAS execution fence; this method owns no transport ACK. */
  public async runClaimed(
    input: AsyncJobRecordV1,
    workerIdInput: string,
    leaseMilliseconds = 30_000,
  ): Promise<AsyncJobRecordV1> {
    const proposed = parseAsyncJobRecordV1(input);
    const workerId = asyncJobWorkerIdSchema.parse(workerIdInput);
    const stored = await this.#requiredJob(proposed.jobId);
    const attempt = activeAttempt(stored);
    if (
      hashCanonicalValue(stored) !== hashCanonicalValue(proposed) ||
      stored.progress?.phase !== "cloudmarkup.job.running" ||
      stored.progress.updatedAt !== attempt.startedAt ||
      stored.updatedAt !== attempt.startedAt ||
      attempt.lease?.workerId !== workerId ||
      !Number.isSafeInteger(leaseMilliseconds) ||
      leaseMilliseconds < 1
    ) {
      throw new JobFrameworkError(
        "job.claimed-execution-mismatch",
        "An exact unstarted worker claim is required.",
      );
    }
    const at = now(this.#dependencies.clock);
    const started = applyAsyncJobLifecycleCommandV1(stored, {
      kind: "record-progress",
      at,
      attemptId: attempt.attemptId,
      workerId,
      expectedInputDigest: stored.inputDigest,
      expectedRecordVersion: stored.recordVersion,
      progress: {
        sequence: stored.progress.sequence + 1,
        completedUnits: stored.progress.completedUnits,
        ...(stored.progress.totalUnits === undefined
          ? {}
          : { totalUnits: stored.progress.totalUnits }),
        phase: namespacedIdentifierSchema.parse(
          "cloudmarkup.job.execution-start",
        ),
      },
    });
    const claimed = await this.#saveResult(
      stored,
      started,
      workerId,
      "progress-recorded",
    );
    return this.#executeClaimed(claimed, workerId, leaseMilliseconds);
  }

  async #executeClaimed(
    input: AsyncJobRecordV1,
    workerId: ReturnType<typeof asyncJobWorkerIdSchema.parse>,
    leaseMilliseconds: number,
  ): Promise<AsyncJobRecordV1> {
    let claimed = input;
    const handler = this.#dependencies.handlers.get(claimed.family);
    const registration = registrationFor(claimed.family, handler);
    const checkpoint = resumableCheckpoint(claimed, handler);

    const attempt = activeAttempt(claimed);
    let savedByThisExecution: AsyncJobCheckpointV1 | undefined;
    const handlerContext: JobHandlerContextV1 = {
      attemptNumber: attempt.attemptNumber,
      checkpoint,
      correlationId: claimed.correlationId,
      heartbeat: async () => {
        const latest = await this.#requiredJob(claimed.jobId);
        const active = activeAttempt(latest);
        const heartbeatAt = now(this.#dependencies.clock);
        const leaseExpiresAt = boundedLeaseExpiresAt(
          latest,
          heartbeatAt,
          leaseMilliseconds,
        );
        const activeLease = active.lease;
        if (activeLease === undefined) {
          throw new JobFrameworkError(
            "job.invalid-lease",
            "A heartbeat requires an active lease.",
          );
        }
        if (leaseExpiresAt <= activeLease.leaseExpiresAt) {
          throw new JobFrameworkError(
            "job.invalid-lease",
            "A heartbeat must extend the active lease.",
          );
        }
        const result = applyAsyncJobLifecycleCommandV1(latest, {
          at: heartbeatAt,
          attemptId: active.attemptId,
          expectedInputDigest: latest.inputDigest,
          expectedRecordVersion: latest.recordVersion,
          kind: "heartbeat",
          leaseExpiresAt,
          workerId,
        });
        claimed = await this.#saveResult(
          latest,
          result,
          workerId,
          "progress-recorded",
        );
      },
      isCancellationRequested: async () => {
        const latest = await this.#dependencies.repository.get(claimed.jobId);
        return latest?.cancellation.state === "requested";
      },
      jobId: claimed.jobId,
      ownership: claimed.ownership,
      reportProgress: async (progress) => {
        const latest = await this.#requiredJob(claimed.jobId);
        const active = activeAttempt(latest);
        const result = applyAsyncJobLifecycleCommandV1(latest, {
          at: now(this.#dependencies.clock),
          attemptId: active.attemptId,
          expectedInputDigest: latest.inputDigest,
          expectedRecordVersion: latest.recordVersion,
          kind: "record-progress",
          progress,
          workerId,
        });
        claimed = await this.#saveResult(
          latest,
          result,
          workerId,
          "progress-recorded",
        );
      },
      saveCheckpoint: async (newCheckpoint) => {
        const latest = await this.#requiredJob(claimed.jobId);
        const active = activeAttempt(latest);
        const checkpointResult = applyAsyncJobLifecycleCommandV1(latest, {
          at: newCheckpoint.createdAt,
          attemptId: active.attemptId,
          checkpoint: newCheckpoint,
          expectedInputDigest: latest.inputDigest,
          expectedRecordVersion: latest.recordVersion,
          handler: registration,
          kind: "record-checkpoint",
          workerId,
        });
        claimed = await this.#saveResult(
          latest,
          checkpointResult,
          workerId,
          "checkpoint-recorded",
        );
        // Capture the parsed lifecycle result, not a handler-owned mutable input.
        const savedCheckpoint = checkpointResult.job.checkpoints.at(-1);
        savedByThisExecution =
          savedCheckpoint === undefined
            ? undefined
            : asyncJobCheckpointV1Schema.parse(savedCheckpoint);
      },
    };

    // Claim audit delivery can involve I/O. Time at claim is not authority to
    // start a handler after the worker lease or job has expired.
    const dispatchAt = Date.parse(now(this.#dependencies.clock));
    if (
      attempt.lease === undefined ||
      Date.parse(attempt.lease.leaseExpiresAt) <= dispatchAt ||
      (claimed.expiresAt !== undefined &&
        Date.parse(claimed.expiresAt) <= dispatchAt)
    )
      throw new JobFrameworkError(
        "job.execution-lease-expired",
        "The job execution lease has expired.",
      );
    let outcome: AsyncJobHandlerOutcomeV1;
    try {
      outcome =
        handler === null
          ? asyncJobHandlerOutcomeV1Schema.parse({
              failure: createAsyncJobFailureV1("handler-not-supported"),
              outcome: "failed",
            })
          : asyncJobHandlerOutcomeV1Schema.parse(
              await handler.execute(claimed, handlerContext),
            );
    } catch (error) {
      outcome = asyncJobHandlerOutcomeV1Schema.parse({
        failure: this.#dependencies.failureClassifier.classify(
          error,
          this.#dependencies.ids.nextId("internal-error"),
        ),
        outcome: "failed",
      });
    }

    const latest = await this.#requiredJob(claimed.jobId);
    const latestAttempt = activeAttempt(latest);
    const completedResult = applyAsyncJobLifecycleCommandV1(latest, {
      at: now(this.#dependencies.clock),
      attemptId: latestAttempt.attemptId,
      expectedInputDigest: latest.inputDigest,
      expectedRecordVersion: latest.recordVersion,
      handler: registration,
      kind: "complete-attempt",
      outcome: boundedOutcome(latest, outcome, savedByThisExecution),
      workerId,
    });
    const completed = await this.#saveResult(
      latest,
      completedResult,
      workerId,
      this.#eventFor(completedResult.job),
    );
    if (isTerminalJobState(completed.state)) {
      await this.#recordParentDecision(completed, workerId);
    }
    if (completedResult.queueEnvelope !== undefined) {
      await publishReadyJobEnvelope(
        this.#dependencies,
        completedResult.queueEnvelope,
      );
    }
    return completed;
  }

  public async reconcileOrphans(
    contextInput: AsyncJobTrustedContextV1,
    limit = 100,
  ): Promise<number> {
    const context = asyncJobTrustedContextV1Schema.parse(contextInput);
    if (
      context.actor.kind !== "system" ||
      context.actor.reason !== "orphan-reconciler"
    ) {
      throw new JobFrameworkError(
        "job.orphan-context-required",
        "Orphan recovery requires trusted reconciler context.",
      );
    }
    const at = now(this.#dependencies.clock);
    const jobs = await this.#dependencies.repository.listJobsWithExpiredLeases({
      expiredBefore: at,
      limit,
      ownership: context.ownership,
    });
    let reconciled = 0;
    for (const orphan of jobs) {
      if (
        orphan.ownership.organizationId !== context.ownership.organizationId ||
        orphan.ownership.projectId !== context.ownership.projectId
      ) {
        continue;
      }
      const handler = this.#dependencies.handlers.get(orphan.family);
      const result = applyAsyncJobLifecycleCommandV1(orphan, {
        at,
        expectedInputDigest: orphan.inputDigest,
        expectedRecordVersion: orphan.recordVersion,
        handler:
          handler === null ? null : registrationFor(orphan.family, handler),
        kind: "reconcile-orphan",
      });
      const workerId = asyncJobWorkerIdSchema.parse("orphan-reconciler");
      const saved = await this.#saveResult(
        orphan,
        result,
        workerId,
        "orphan-reconciled",
      );
      if (isTerminalJobState(saved.state)) {
        await this.#recordParentDecision(saved, workerId);
      }
      if (result.queueEnvelope !== undefined) {
        await publishReadyJobEnvelope(this.#dependencies, result.queueEnvelope);
      }
      reconciled += 1;
    }
    return reconciled;
  }

  async #coordinateParentBeforeClaim(
    parent: AsyncJobRecordV1,
    workerId: ReturnType<typeof asyncJobWorkerIdSchema.parse>,
  ): Promise<{ readonly execute: boolean; readonly job: AsyncJobRecordV1 }> {
    if (parent.orchestration.expectedChildJobIds.length === 0) {
      return { execute: true, job: parent };
    }
    const children = await this.#dependencies.repository.listChildren(
      parent.jobId,
    );
    const decision = evaluateAsyncJobChildrenV1(parent, children);
    await this.#recordDecision(parent, children, decision);
    const terminalParent = await this.#applyParentDecision(
      parent,
      children,
      decision,
      workerId,
    );
    if (terminalParent !== null) {
      return { execute: false, job: terminalParent };
    }
    const execute =
      decision.kind === "ready" ||
      (decision.kind === "continue-and-report" && decision.allChildrenTerminal);
    return { execute, job: parent };
  }

  async #recordParentDecision(
    child: AsyncJobRecordV1,
    workerId: ReturnType<typeof asyncJobWorkerIdSchema.parse>,
  ): Promise<void> {
    const parentJobId = child.orchestration.parentJobId;
    if (parentJobId === undefined) {
      return;
    }
    const parent = await this.#dependencies.repository.get(parentJobId);
    if (parent === null || isTerminalJobState(parent.state)) {
      return;
    }
    const children =
      await this.#dependencies.repository.listChildren(parentJobId);
    const decision = evaluateAsyncJobChildrenV1(parent, children);
    await this.#recordDecision(parent, children, decision);
    await this.#applyParentDecision(parent, children, decision, workerId);
  }

  async #applyParentDecision(
    parent: AsyncJobRecordV1,
    children: readonly AsyncJobRecordV1[],
    decision: AsyncJobOrchestrationDecisionV1,
    workerId: ReturnType<typeof asyncJobWorkerIdSchema.parse>,
  ): Promise<AsyncJobRecordV1 | null> {
    if (decision.kind === "fail-parent") {
      const result = failAsyncJobParentFromChildrenV1(parent, children, {
        at: now(this.#dependencies.clock),
        expectedInputDigest: parent.inputDigest,
        expectedRecordVersion: parent.recordVersion,
      });
      return this.#saveResult(parent, result, workerId, "job-failed");
    }
    if (decision.kind !== "cancel-remaining") {
      return null;
    }

    const currentChildren = [...children];
    for (const childJobId of [...decision.cancelChildJobIds].sort(
      (left, right) => left.localeCompare(right),
    )) {
      const childIndex = currentChildren.findIndex(
        (candidate) => candidate.jobId === childJobId,
      );
      const child = currentChildren[childIndex];
      if (child === undefined) {
        throw new JobFrameworkError(
          "job.child-set-incomplete",
          "The authoritative child set changed during cancellation.",
        );
      }
      const cancellation = cancelAsyncJobChildFromParentV1(
        parent,
        currentChildren,
        {
          at: now(this.#dependencies.clock),
          childJobId: child.jobId,
          expectedInputDigest: child.inputDigest,
          expectedParentInputDigest: parent.inputDigest,
          expectedParentRecordVersion: parent.recordVersion,
          expectedRecordVersion: child.recordVersion,
        },
      );
      const savedChild = await this.#saveResult(
        child,
        cancellation,
        workerId,
        cancellation.job.state === "expired"
          ? "job-expired"
          : cancellation.job.state === "canceled"
            ? "job-canceled"
            : "cancellation-requested",
      );
      currentChildren[childIndex] = savedChild;
    }

    const finalDecision = evaluateAsyncJobChildrenV1(parent, currentChildren);
    await this.#recordDecision(parent, currentChildren, finalDecision);
    const parentFailure = failAsyncJobParentFromChildrenV1(
      parent,
      currentChildren,
      {
        at: now(this.#dependencies.clock),
        expectedInputDigest: parent.inputDigest,
        expectedRecordVersion: parent.recordVersion,
      },
    );
    return this.#saveResult(parent, parentFailure, workerId, "job-failed");
  }

  async #recordDecision(
    parent: AsyncJobRecordV1,
    children: readonly AsyncJobRecordV1[],
    decision: AsyncJobOrchestrationDecisionV1,
  ): Promise<void> {
    const childStates = children
      .map((child) => ({
        inputDigest: child.inputDigest,
        jobId: child.jobId,
        recordVersion: child.recordVersion,
        state: child.state,
      }))
      .sort((left, right) => left.jobId.localeCompare(right.jobId));
    const childStateDigest = hashCanonicalValue({
      expectedChildJobIds: parent.orchestration.expectedChildJobIds,
      states: childStates,
    });
    const decisionId = hashCanonicalValue({
      childStateDigest,
      contractVersion: 1,
      parentInputDigest: parent.inputDigest,
      parentJobId: parent.jobId,
      parentRecordVersion: parent.recordVersion,
    });
    await this.#dependencies.orchestration.record({
      childStateDigest,
      correlationId: parent.correlationId,
      decision,
      decisionId,
      ownership: parent.ownership,
      parentJobId: parent.jobId,
      parentRecordVersion: parent.recordVersion,
      recordedAt: now(this.#dependencies.clock),
    });
  }

  async #requiredJob(jobId: string): Promise<AsyncJobRecordV1> {
    const job = await this.#dependencies.repository.get(jobId);
    if (job === null) {
      throw new JobFrameworkError("job.not-found", "The job was not found.");
    }
    return job;
  }

  async #saveResult(
    previous: AsyncJobRecordV1,
    result: ReturnType<typeof applyAsyncJobLifecycleCommandV1>,
    workerId: ReturnType<typeof asyncJobWorkerIdSchema.parse>,
    eventType: AsyncJobAuditEventV1["eventType"],
  ): Promise<AsyncJobRecordV1> {
    if (result.job.recordVersion === previous.recordVersion) {
      return previous;
    }
    if (result.transition === undefined) {
      throw new JobFrameworkError(
        "job.audit-transition-required",
        "A durable worker mutation requires transition audit evidence.",
      );
    }
    const auditEntry = createJobAuditOutboxEntryV1({
      actor: { kind: "worker", workerId },
      eventType,
      occurredAt: result.transition.at,
      record: result.job,
      transition: result.transition,
    });
    const saved = await this.#dependencies.repository.saveWithAudit(
      result.job,
      previous.recordVersion,
      [auditEntry],
    );
    try {
      await this.#dependencies.audit.append(auditEntry);
      await this.#dependencies.repository.markAuditEntryPublished({
        eventId: auditEntry.event.eventId,
        ownership: auditEntry.event.ownership,
        publishedAt: now(this.#dependencies.clock),
      });
    } catch {
      // Durable outbox reconciliation owns delivery after a sink failure.
    }
    return saved;
  }

  #eventFor(record: AsyncJobRecordV1): AsyncJobAuditEventV1["eventType"] {
    switch (record.state) {
      case "queued":
        return "retry-scheduled";
      case "awaiting-user-input":
        return "awaiting-user-input";
      case "succeeded":
        return "job-succeeded";
      case "failed":
        return "job-failed";
      case "canceled":
        return "job-canceled";
      case "expired":
        return "job-expired";
      case "superseded":
        return "job-superseded";
      case "running":
        return "progress-recorded";
    }
  }

  #envelopeMatches(
    record: AsyncJobRecordV1,
    envelope: AsyncJobQueueEnvelopeV1,
  ): boolean {
    return (
      record.jobId === envelope.jobId &&
      record.family === envelope.family &&
      record.inputDigest === envelope.inputDigest &&
      record.ownership.organizationId === envelope.ownership.organizationId &&
      record.ownership.projectId === envelope.ownership.projectId
    );
  }
}
