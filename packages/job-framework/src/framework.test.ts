import {
  applyAsyncJobLifecycleCommandV1,
  createAsyncJobFailureV1,
  getAsyncJobCreateRequestDigestV1,
  getAsyncJobIdempotencyKeyDigestV1,
  getAsyncJobInputDigestV1,
  getAsyncJobInputSizeBytesV1,
} from "@cloudmarkup/domain";
import {
  asyncJobCheckpointV1Schema,
  asyncJobAttemptIdSchema,
  asyncJobWorkerIdSchema,
  asyncJobCreateRequestV1Schema,
  asyncJobHandlerOutcomeV1Schema,
  asyncJobIdSchema,
  asyncJobIdempotencyClaimV1Schema,
  asyncJobInputV1Schema,
  asyncJobObjectReferenceV1Schema,
  asyncJobTrustedContextV1Schema,
  namespacedIdentifierSchema,
  sha256DigestSchema,
  type AsyncJobHandlerOutcomeV1,
  type AsyncJobCheckpointV1,
  type AsyncJobId,
  type AsyncJobInputV1,
  type AsyncJobRecordV1,
  type AsyncJobTrustedContextV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  AllowAllJobEntitlementPort,
  createJobAuditOutboxEntryV1,
  DefaultJobFailureClassifier,
  DenyAllJobEntitlementPort,
  DeterministicFakeJobHandler,
  IdempotentFakeReservationPort,
  InMemoryFifoJobQueue,
  InMemoryJobAuditPort,
  InMemoryJobOrchestrationDecisionPort,
  InMemoryJobHandlerRegistry,
  InMemoryJobRepository,
  JobService,
  JobWorker,
  MutableJobClock,
  ScriptedFakeJobHandler,
  SequentialJobIdGenerator,
  type CreateJobCommandV1,
  type JobEntitlementPort,
  type JobHandlerContextV1,
  type JobHandlerV1,
} from "./index.js";

const START = "2026-08-15T12:00:00.000Z";
const HEX = "0123456789abcdef";

function digest(seed: string): Sha256Digest {
  const value = Array.from(seed).reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  );
  return sha256DigestSchema.parse(
    `sha256:${HEX.charAt(value % HEX.length).repeat(64)}`,
  );
}

function reference(
  purpose: Parameters<
    typeof asyncJobObjectReferenceV1Schema.parse
  >[0] extends never
    ? never
    : string,
  sizeBytes = 32,
  expiresAt?: string,
) {
  return asyncJobObjectReferenceV1Schema.parse({
    contractVersion: 1,
    digest: digest(`${purpose}:${String(sizeBytes)}`),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    mediaType: "application/json",
    objectId: `object_${purpose.replaceAll("-", "_")}_${String(sizeBytes)}`,
    purpose,
    sizeBytes,
  });
}

function principalContext(
  organizationId = "org_alpha",
  projectId = "project_alpha",
): AsyncJobTrustedContextV1 {
  return asyncJobTrustedContextV1Schema.parse({
    actor: { actorId: "actor_alpha", kind: "principal" },
    correlationId: `correlation_${organizationId}`,
    ownership: { organizationId, projectId },
  });
}

function systemContext(
  reason: "orphan-reconciler" | "retention" | "scheduler",
  organizationId = "org_alpha",
  projectId = "project_alpha",
): AsyncJobTrustedContextV1 {
  return asyncJobTrustedContextV1Schema.parse({
    actor: { kind: "system", reason },
    correlationId: `correlation_${reason}`,
    ownership: { organizationId, projectId },
  });
}

function draftInput(): AsyncJobInputV1 {
  return asyncJobInputV1Schema.parse({
    contractVersion: 1,
    family: "intent-extraction",
    source: reference("input-payload"),
    subject: {
      contentDigest: digest("draft"),
      draftId: "draft_alpha",
      draftVersion: 1,
      etag: '"draft-etag-1"',
      kind: "draft",
    },
  });
}

function solutionInput(
  family:
    "customer-owned-plan-evidence" | "diagram-rendering" = "diagram-rendering",
  revision = "solution_revision_1",
): AsyncJobInputV1 {
  const subject = {
    kind: "solution-revision" as const,
    manifestDigest: digest(revision),
    manifestRecordId: `manifest_${revision}`,
    solutionRevisionId: revision,
  };
  return family === "diagram-rendering"
    ? asyncJobInputV1Schema.parse({
        contractVersion: 1,
        family,
        format: "svg",
        rendererTargetId: "cloudmarkup.renderer",
        subject,
      })
    : asyncJobInputV1Schema.parse({
        contractVersion: 1,
        environment: { environmentType: "development" },
        family,
        subject,
        targetId: "cloudmarkup.plan",
      });
}

interface CommandOptions {
  readonly expectedChildJobIds?: readonly AsyncJobId[];
  readonly failurePolicy?: AsyncJobRecordV1["orchestration"]["failurePolicy"];
  readonly expiresAt?: string;
  readonly limits?: CreateJobCommandV1["limits"];
  readonly parentJobId?: AsyncJobId;
  readonly preallocatedJobId?: AsyncJobId;
  readonly reservationRequested?: boolean;
}

function command(
  context: AsyncJobTrustedContextV1,
  input: AsyncJobInputV1,
  idempotencyKey: string,
  options: CommandOptions = {},
): CreateJobCommandV1 {
  const inputDigest = getAsyncJobInputDigestV1(input);
  const request = asyncJobCreateRequestV1Schema.parse({
    contractVersion: 1,
    idempotencyKey,
    input,
    inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
  });
  return {
    ...(options.expiresAt === undefined
      ? {}
      : { expiresAt: options.expiresAt }),
    idempotency: asyncJobIdempotencyClaimV1Schema.parse({
      actorId:
        context.actor.kind === "principal"
          ? context.actor.actorId
          : "actor_system",
      keyDigest: getAsyncJobIdempotencyKeyDigestV1(idempotencyKey),
      operationId: "job.create",
      requestDigest: getAsyncJobCreateRequestDigestV1(request),
    }),
    inputDigest,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    orchestration: {
      expectedChildJobIds: options.expectedChildJobIds ?? [],
      failurePolicy: options.failurePolicy ?? "fail-parent",
      ...(options.parentJobId === undefined
        ? {}
        : { parentJobId: options.parentJobId }),
    },
    ...(options.preallocatedJobId === undefined
      ? {}
      : { preallocatedJobId: options.preallocatedJobId }),
    request,
    ...(options.reservationRequested === undefined
      ? {}
      : { reservationRequested: options.reservationRequested }),
  };
}
function proposalOutcome(sizeBytes = 32): AsyncJobHandlerOutcomeV1 {
  return asyncJobHandlerOutcomeV1Schema.parse({
    outcome: "succeeded",
    output: {
      contractVersion: 1,
      evidenceRecords: [],
      family: "intent-extraction",
      proposal: reference("proposal", sizeBytes),
    },
    outputSizeBytes: sizeBytes,
  });
}

function diagramOutcome(
  expiresAt?: string,
  sizeBytes = 32,
): AsyncJobHandlerOutcomeV1 {
  return asyncJobHandlerOutcomeV1Schema.parse({
    outcome: "succeeded",
    output: {
      contractVersion: 1,
      diagram: {
        artifactId: "artifact_diagram",
        availability: { state: "available" },
        object: reference("diagram", sizeBytes, expiresAt),
      },
      evidenceRecords: [],
      family: "diagram-rendering",
    },
    outputSizeBytes: sizeBytes,
  });
}

function transientFailure(): AsyncJobHandlerOutcomeV1 {
  return asyncJobHandlerOutcomeV1Schema.parse({
    failure: createAsyncJobFailureV1("handler-transient-failure"),
    outcome: "failed",
  });
}

function permanentFailure(): AsyncJobHandlerOutcomeV1 {
  return asyncJobHandlerOutcomeV1Schema.parse({
    failure: createAsyncJobFailureV1("handler-permanent-failure"),
    outcome: "failed",
  });
}

function harness(
  handlers: readonly JobHandlerV1[],
  entitlement: JobEntitlementPort = new AllowAllJobEntitlementPort(),
) {
  const audit = new InMemoryJobAuditPort();
  const clock = new MutableJobClock(START);
  const ids = new SequentialJobIdGenerator("framework");
  const queue = new InMemoryFifoJobQueue(ids);
  const repository = new InMemoryJobRepository();
  const orchestration = new InMemoryJobOrchestrationDecisionPort();
  const reservation = new IdempotentFakeReservationPort();
  const registry = new InMemoryJobHandlerRegistry(handlers);
  const service = new JobService({
    audit,
    clock,
    entitlement,
    ids,
    queue,
    repository,
    reservation,
  });
  const worker = new JobWorker({
    audit,
    clock,
    failureClassifier: new DefaultJobFailureClassifier(),
    handlers: registry,
    ids,
    orchestration,
    queue,
    repository,
  });
  return {
    audit,
    clock,
    entitlement,
    ids,
    orchestration,
    queue,
    registry,
    repository,
    reservation,
    service,
    worker,
  };
}

async function createdJob(
  service: JobService,
  context: AsyncJobTrustedContextV1,
  createCommand: CreateJobCommandV1,
): Promise<AsyncJobRecordV1> {
  const outcome = await service.create(context, createCommand);
  if (outcome.kind !== "created") {
    throw new Error(`Expected created, received ${outcome.kind}.`);
  }
  return outcome.job;
}

describe("provider-neutral asynchronous job framework", () => {
  async function initialClaimFixture() {
    const execute = vi
      .fn<JobHandlerV1["execute"]>()
      .mockResolvedValue(proposalOutcome());
    const handler: JobHandlerV1 = {
      family: "intent-extraction",
      handlerId: "job.initial-claim-test",
      handlerVersion: "1.0.0",
      resumePolicy: "restart-from-input",
      execute,
    };
    const environment = harness([handler]);
    const context = principalContext();
    const queued = await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "initial-claimed"),
    );
    const workerId = asyncJobWorkerIdSchema.parse("worker_initial_claim");
    const result = applyAsyncJobLifecycleCommandV1(queued, {
      kind: "claim",
      at: START,
      attemptId: asyncJobAttemptIdSchema.parse("attempt_initial_claim"),
      dependencies: [],
      expectedInputDigest: queued.inputDigest,
      expectedRecordVersion: queued.recordVersion,
      handler: {
        family: handler.family,
        handlerId: namespacedIdentifierSchema.parse(handler.handlerId),
        handlerVersion: handler.handlerVersion,
        resumePolicy: handler.resumePolicy,
      },
      leaseExpiresAt: "2026-08-15T12:00:30.000Z",
      workerId,
    });
    if (result.transition === undefined)
      throw new Error("Synthetic initial claim was not applied");
    const claimed = await environment.repository.saveWithAudit(
      result.job,
      queued.recordVersion,
      [
        createJobAuditOutboxEntryV1({
          actor: { kind: "worker", workerId },
          eventType: "attempt-claimed",
          occurredAt: START,
          record: result.job,
          transition: result.transition,
        }),
      ],
    );
    return { ...environment, claimed, handler, execute, workerId };
  }

  it("executes a durably claimed initial job without receiving or acknowledging a delivery", async () => {
    const f = await initialClaimFixture();
    const receive = vi.spyOn(f.queue, "receive");
    const acknowledge = vi.spyOn(f.queue, "acknowledge");
    const completed = await f.worker.runInitialClaimed(f.claimed, f.workerId);
    expect(completed.state).toBe("succeeded");
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(receive).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
    expect(completed.attempts).toHaveLength(1);
  });

  it("fences concurrent execution of the same committed initial claim", async () => {
    const f = await initialClaimFixture();
    const results = await Promise.allSettled([
      f.worker.runInitialClaimed(f.claimed, f.workerId),
      f.worker.runInitialClaimed(f.claimed, f.workerId),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it("executes an initial delivered claim with a publisher and rejects polling it", async () => {
    const f = await initialClaimFixture();
    const publish = vi.fn(() => Promise.resolve());
    const worker = new JobWorker({
      audit: f.audit,
      clock: f.clock,
      failureClassifier: new DefaultJobFailureClassifier(),
      handlers: f.registry,
      ids: f.ids,
      orchestration: f.orchestration,
      publisher: { contractVersion: 1, publish },
      repository: f.repository,
    });
    await expect(worker.runNext(f.workerId)).rejects.toMatchObject({
      code: "job.consumer-transport-required",
    });
    expect(f.execute).not.toHaveBeenCalled();
    expect((await worker.runInitialClaimed(f.claimed, f.workerId)).state).toBe(
      "succeeded",
    );
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    "wrong-worker",
    "expired-lease",
    "changed-record",
    "failed-cas",
  ] as const)("rejects %s before executing a claimed handler", async (mode) => {
    const f = await initialClaimFixture();
    if (mode === "expired-lease") f.clock.advance(30_001);
    if (mode === "failed-cas")
      vi.spyOn(f.repository, "saveWithAudit").mockRejectedValueOnce(
        new Error("Synthetic CAS failure"),
      );
    await expect(
      f.worker.runInitialClaimed(
        mode === "changed-record"
          ? { ...f.claimed, recordVersion: f.claimed.recordVersion + 1 }
          : f.claimed,
        mode === "wrong-worker" ? "worker_another" : f.workerId,
      ),
    ).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("does not execute a terminal or already-started claim again", async () => {
    const f = await initialClaimFixture();
    const completed = await f.worker.runInitialClaimed(f.claimed, f.workerId);
    await expect(
      f.worker.runInitialClaimed(f.claimed, f.workerId),
    ).rejects.toThrow();
    await expect(
      f.worker.runInitialClaimed(completed, f.workerId),
    ).rejects.toThrow();
    expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it("rechecks the worker lease after a slow audit sink before starting a handler", async () => {
    const f = await initialClaimFixture();
    const append = f.audit.append.bind(f.audit);
    vi.spyOn(f.audit, "append").mockImplementation(async (entry) => {
      await append(entry);
      f.clock.advance(30_001);
    });
    await expect(
      f.worker.runInitialClaimed(f.claimed, f.workerId),
    ).rejects.toMatchObject({ code: "job.execution-lease-expired" });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it.each([
    "confirmed",
    "returned-only",
    "changed-content",
    "changed-id",
    "save-failed",
    "save-ack-lost",
    "latest-changed",
    "not-this-execution",
  ] as const)(
    "normalizes only this execution's exact confirmed durable checkpoint: %s",
    async (mode) => {
      const failure = createAsyncJobFailureV1("handler-permanent-failure");
      const handler: JobHandlerV1 = {
        family: "intent-extraction",
        handlerId: "job.checkpoint-replay",
        handlerVersion: "1.0.0",
        resumePolicy: "restart-from-input",
        async execute(record, context) {
          const checkpoint = asyncJobCheckpointV1Schema.parse({
            attemptNumber: context.attemptNumber,
            checkpointId: "checkpoint_original",
            createdAt: environment.clock.now().toISOString(),
            handlerId: this.handlerId,
            handlerVersion: this.handlerVersion,
            inputDigest: record.inputDigest,
            sequence: 1,
            state: reference("checkpoint-state"),
          });
          const persistOutsideContext = async (value: AsyncJobCheckpointV1) => {
            const latest = await environment.repository.get(record.jobId);
            const attempt = latest?.attempts.at(-1);
            if (latest === null || attempt?.lease === undefined)
              throw new Error("Missing synthetic current attempt.");
            const result = applyAsyncJobLifecycleCommandV1(latest, {
              kind: "record-checkpoint",
              at: value.createdAt,
              checkpoint: value,
              expectedInputDigest: latest.inputDigest,
              expectedRecordVersion: latest.recordVersion,
              attemptId: attempt.attemptId,
              workerId: attempt.lease.workerId,
              handler: {
                family: this.family,
                handlerId: namespacedIdentifierSchema.parse(this.handlerId),
                handlerVersion: this.handlerVersion,
                resumePolicy: this.resumePolicy,
              },
            });
            if (result.transition === undefined)
              throw new Error("Missing synthetic checkpoint transition.");
            await environment.repository.saveWithAudit(
              result.job,
              latest.recordVersion,
              [
                createJobAuditOutboxEntryV1({
                  actor: { kind: "worker", workerId: attempt.lease.workerId },
                  eventType: "checkpoint-recorded",
                  occurredAt: value.createdAt,
                  record: result.job,
                  transition: result.transition,
                }),
              ],
            );
          };
          if (mode === "not-this-execution")
            await persistOutsideContext(checkpoint);
          else if (mode === "save-failed" || mode === "save-ack-lost") {
            const original = environment.repository.saveWithAudit.bind(
              environment.repository,
            );
            const failed = vi
              .spyOn(environment.repository, "saveWithAudit")
              .mockImplementationOnce(async (...args) => {
                if (mode === "save-ack-lost") await original(...args);
                throw new Error(
                  "Synthetic checkpoint persistence acknowledgement failed.",
                );
              });
            await expect(context.saveCheckpoint(checkpoint)).rejects.toThrow(
              "Synthetic checkpoint persistence acknowledgement failed.",
            );
            failed.mockRestore();
          } else if (mode !== "returned-only")
            await context.saveCheckpoint(checkpoint);
          if (mode === "latest-changed")
            await persistOutsideContext(
              asyncJobCheckpointV1Schema.parse({
                ...checkpoint,
                checkpointId: "checkpoint_newer",
                sequence: 2,
              }),
            );
          if (mode !== "returned-only") environment.clock.advance(1000);
          return {
            outcome: "failed",
            failure,
            checkpoint:
              mode === "changed-content"
                ? { ...checkpoint, state: reference("checkpoint-state", 64) }
                : mode === "changed-id"
                  ? {
                      ...checkpoint,
                      checkpointId: asyncJobCheckpointV1Schema.parse({
                        ...checkpoint,
                        checkpointId: "checkpoint_changed",
                      }).checkpointId,
                    }
                  : checkpoint,
          };
        },
      };
      const environment = harness([handler]);
      const context = principalContext();
      await createdJob(
        environment.service,
        context,
        command(context, draftInput(), `checkpoint-${mode}`),
      );
      const completed = await environment.worker.runNext("worker_checkpoint");
      expect(completed?.state).toBe("failed");
      const allowed = mode === "confirmed" || mode === "returned-only";
      expect(completed?.failure).toEqual(
        allowed ? failure : createAsyncJobFailureV1("checkpoint-incompatible"),
      );
      expect(completed?.checkpoints).toHaveLength(
        mode === "save-failed" ? 0 : mode === "latest-changed" ? 2 : 1,
      );
      expect(completed?.attempts[0]?.retryDisposition?.kind).toBe(
        "do-not-retry",
      );
      if (mode === "confirmed")
        expect(
          environment.audit.events.filter(
            (event) => event.eventType === "checkpoint-recorded",
          ),
        ).toHaveLength(1);
    },
  );
  it("preserves transient retry after a confirmed checkpoint, but never treats a prior attempt checkpoint as this execution's save", async () => {
    let prior: AsyncJobCheckpointV1 | undefined;
    const failure = createAsyncJobFailureV1("handler-transient-failure");
    const handler: JobHandlerV1 = {
      family: "intent-extraction",
      handlerId: "job.checkpoint-retry",
      handlerVersion: "1.0.0",
      resumePolicy: "restart-from-input",
      async execute(record, context) {
        if (context.attemptNumber === 1) {
          prior = asyncJobCheckpointV1Schema.parse({
            attemptNumber: 1,
            checkpointId: "checkpoint_prior_attempt",
            createdAt: environment.clock.now().toISOString(),
            handlerId: this.handlerId,
            handlerVersion: this.handlerVersion,
            inputDigest: record.inputDigest,
            sequence: 1,
            state: reference("checkpoint-state"),
          });
          await context.saveCheckpoint(prior);
        }
        if (prior === undefined)
          throw new Error("Missing prior synthetic checkpoint.");
        environment.clock.advance(1000);
        return { outcome: "failed", failure, checkpoint: prior };
      },
    };
    const environment = harness([handler]);
    const context = principalContext();
    await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "checkpoint-prior-attempt"),
    );
    const retry = await environment.worker.runNext("worker_checkpoint_first");
    expect(retry?.state).toBe("queued");
    expect(retry?.attempts[0]?.failure).toEqual(failure);
    expect(retry?.attempts[0]?.retryDisposition?.kind).toBe("retry");
    environment.clock.advance(60000);
    const failed = await environment.worker.runNext("worker_checkpoint_second");
    expect(failed?.state).toBe("failed");
    expect(failed?.failure).toEqual(
      createAsyncJobFailureV1("checkpoint-incompatible"),
    );
    expect(failed?.checkpoints).toHaveLength(1);
    expect(
      environment.audit.events.filter(
        (event) => event.eventType === "checkpoint-recorded",
      ),
    ).toHaveLength(1);
  });
  it("claims idempotency before entitlement/reservation and never creates twice", async () => {
    const context = principalContext();
    const environment = harness([
      new DeterministicFakeJobHandler("intent-extraction"),
    ]);
    const createCommand = command(context, draftInput(), "duplicate", {
      reservationRequested: true,
    });

    const retryContext = asyncJobTrustedContextV1Schema.parse({
      ...context,
      correlationId: "correlation_retry",
    });
    const first = await environment.service.create(context, createCommand);
    const duplicate = await environment.service.create(
      retryContext,
      createCommand,
    );

    expect(first.kind).toBe("created");
    expect(duplicate.kind).toBe("duplicate");
    if (first.kind === "created" && duplicate.kind === "duplicate") {
      expect(duplicate.job.jobId).toBe(first.job.jobId);
      expect(duplicate.job.reservation).toEqual(first.job.reservation);
      expect(duplicate.job.correlationId).toBe(first.job.correlationId);
      expect(duplicate.job.correlationId).not.toBe(retryContext.correlationId);
    }
    expect((environment.entitlement as AllowAllJobEntitlementPort).calls).toBe(
      1,
    );
    expect(environment.reservation.calls).toBe(1);
    expect(environment.queue.size).toBe(1);
  });

  it("derives idempotency authority internally before commercial hooks", async () => {
    const context = principalContext();
    const environment = harness([
      new DeterministicFakeJobHandler("intent-extraction"),
    ]);
    const valid = command(context, draftInput(), "raw-key-authority", {
      reservationRequested: true,
    });

    await expect(
      environment.service.create(context, {
        ...valid,
        idempotency: {
          ...valid.idempotency,
          keyDigest: digest("attacker-selected-key-digest"),
        },
      }),
    ).rejects.toMatchObject({ code: "job.idempotency-authority-mismatch" });
    await expect(
      environment.service.create(context, {
        ...valid,
        idempotency: {
          ...valid.idempotency,
          requestDigest: digest("attacker-selected-request-digest"),
        },
      }),
    ).rejects.toMatchObject({ code: "job.idempotency-authority-mismatch" });

    const created = await environment.service.create(context, valid);
    expect(created.kind).toBe("created");
    expect((environment.entitlement as AllowAllJobEntitlementPort).calls).toBe(
      1,
    );
    expect(environment.reservation.calls).toBe(1);
    expect(environment.queue.size).toBe(1);
  });
  it("persists an entitlement denial idempotently before queueing", async () => {
    const context = principalContext();
    const entitlement = new DenyAllJobEntitlementPort();
    const environment = harness([], entitlement);
    const createCommand = command(context, draftInput(), "denied");

    const first = await environment.service.create(context, createCommand);
    const duplicate = await environment.service.create(context, createCommand);

    expect(first.kind).toBe("denied");
    expect(duplicate).toEqual(first);
    expect(entitlement.calls).toBe(1);
    expect(environment.queue.size).toBe(0);
    expect(environment.audit.events).toHaveLength(0);
    expect(environment.audit.creationClaimEvents).toMatchObject([
      { denialSource: "entitlement", eventType: "creation-denied" },
    ]);
  });

  it("makes tenant-safe polling indistinguishable from an absent job", async () => {
    const owner = principalContext();
    const other = principalContext("org_beta", "project_beta");
    const environment = harness([
      new DeterministicFakeJobHandler("intent-extraction"),
    ]);
    const job = await createdJob(
      environment.service,
      owner,
      command(owner, draftInput(), "tenant"),
    );

    expect(await environment.service.poll(other, job.jobId)).toBeNull();
    expect(await environment.service.poll(other, "job_absent")).toBeNull();
    expect((await environment.service.poll(owner, job.jobId))?.job.jobId).toBe(
      job.jobId,
    );
  });

  it("filters reconciliation candidates by exact ownership before limiting", async () => {
    const alpha = principalContext("org_alpha_scan", "project_alpha_scan");
    const beta = principalContext("org_beta_scan", "project_beta_scan");
    const environment = harness([
      new DeterministicFakeJobHandler("intent-extraction"),
    ]);
    const expiresAt = "2026-08-15T12:00:10.000Z";
    const alphaJob = await createdJob(
      environment.service,
      alpha,
      command(alpha, draftInput(), "scan-alpha", { expiresAt }),
    );
    const betaJob = await createdJob(
      environment.service,
      beta,
      command(beta, draftInput(), "scan-beta", { expiresAt }),
    );

    const betaQueued =
      await environment.repository.listQueuedJobsReadyForDispatch({
        availableAtOrBefore: START,
        limit: 1,
        ownership: beta.ownership,
      });
    const betaExpired = await environment.repository.listJobsPastRetention({
      expiredBefore: expiresAt,
      limit: 1,
      ownership: beta.ownership,
    });

    expect(betaQueued.map(({ jobId }) => jobId)).toEqual([betaJob.jobId]);
    expect(betaExpired.map(({ jobId }) => jobId)).toEqual([betaJob.jobId]);
    expect(betaQueued.map(({ jobId }) => jobId)).not.toContain(alphaJob.jobId);
  });
  it("classifies transient retry with deterministic backoff and preserves the exact revision", async () => {
    const context = principalContext();
    const handler = new ScriptedFakeJobHandler("diagram-rendering", [
      transientFailure(),
      diagramOutcome(),
    ]);
    const environment = harness([handler]);
    const job = await createdJob(
      environment.service,
      context,
      command(context, solutionInput(), "retry-revision"),
    );
    const originalSubject = job.input.subject;

    const retry = await environment.worker.runNext("worker_retry");
    expect(retry?.state).toBe("queued");
    expect(retry?.attempts[0]?.retryDisposition?.kind).toBe("retry");
    expect(retry?.input.subject).toEqual(originalSubject);
    expect(await environment.worker.runNext("worker_too_early")).toBeNull();

    environment.clock.advance(5_000);
    const succeeded = await environment.worker.runNext("worker_retry_2");
    expect(succeeded?.state).toBe("succeeded");
    expect(succeeded?.attempts).toHaveLength(2);
    expect(succeeded?.input.subject).toEqual(originalSubject);
  });

  it("does not retry permanent failures", async () => {
    const context = principalContext();
    const environment = harness([
      new ScriptedFakeJobHandler("intent-extraction", [permanentFailure()]),
    ]);
    await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "permanent"),
    );

    const failed = await environment.worker.runNext("worker_permanent");
    expect(failed?.state).toBe("failed");
    expect(failed?.attempts[0]?.retryDisposition).toEqual({
      kind: "do-not-retry",
    });
    expect(environment.queue.size).toBe(0);
  });

  it("lets a durable cancellation request win a completion race", async () => {
    const context = principalContext();
    // eslint-disable-next-line prefer-const -- Assigned after the handler closure is created.
    let service: JobService;
    const handler: JobHandlerV1 = {
      family: "intent-extraction",
      handlerId: "job.cancel-race",
      handlerVersion: "1.0.0",
      resumePolicy: "not-resumable",
      async execute(record) {
        await service.cancel(context, record.jobId);
        return proposalOutcome();
      },
    };
    const environment = harness([handler]);
    service = environment.service;
    await createdJob(
      service,
      context,
      command(context, draftInput(), "cancel-race"),
    );

    const canceled = await environment.worker.runNext("worker_cancel");
    expect(canceled?.state).toBe("canceled");
    expect(canceled?.cancellation.state).toBe("acknowledged");
    expect(canceled?.output).toBeUndefined();
  });

  it("reconciles an expired worker lease using reviewed restart policy", async () => {
    const context = principalContext();
    const handler = new DeterministicFakeJobHandler("intent-extraction");
    const environment = harness([handler]);
    const queued = await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "orphan"),
    );
    const claimed = applyAsyncJobLifecycleCommandV1(queued, {
      at: START,
      attemptId: "attempt_crashed" as never,
      dependencies: [],
      expectedInputDigest: queued.inputDigest,
      expectedRecordVersion: queued.recordVersion,
      handler: {
        family: queued.family,
        handlerId: namespacedIdentifierSchema.parse(handler.handlerId),
        handlerVersion: handler.handlerVersion,
        resumePolicy: handler.resumePolicy,
      },
      kind: "claim",
      leaseExpiresAt: "2026-08-15T12:00:01.000Z",
      workerId: "worker_crashed" as never,
    });
    await environment.repository.saveWithAudit(
      claimed.job,
      queued.recordVersion,
      [
        createJobAuditOutboxEntryV1({
          actor: { kind: "worker", workerId: "worker_crashed" as never },
          eventType: "attempt-claimed",
          occurredAt: START,
          record: claimed.job,
          transition: claimed.transition,
        }),
      ],
    );
    environment.clock.advance(1_001);

    const count = await environment.worker.reconcileOrphans(
      systemContext("orphan-reconciler"),
    );
    const recovered = await environment.repository.get(queued.jobId);
    expect(count).toBe(1);
    expect(recovered?.state).toBe("queued");
    expect(recovered?.attempts[0]?.state).toBe("orphaned");
  });

  it("propagates a required child failure to its predeclared parent", async () => {
    const context = principalContext();
    const parentId = asyncJobIdSchema.parse("job_parent");
    const childId = asyncJobIdSchema.parse("job_child");
    const environment = harness([
      new ScriptedFakeJobHandler("intent-extraction", [permanentFailure()]),
    ]);
    const parent = await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "parent", {
        expectedChildJobIds: [childId],
        preallocatedJobId: parentId,
      }),
    );
    await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "child", {
        parentJobId: parentId,
        preallocatedJobId: childId,
      }),
    );
    const parentDelivery = await environment.queue.receive({
      leaseMilliseconds: 1_000,
      now: START,
      workerId: "test",
    });
    expect(parentDelivery?.envelope.jobId).toBe(parent.jobId);
    if (parentDelivery === null) {
      throw new Error("Expected a queue delivery for the parent job.");
    }
    await environment.queue.acknowledge(parentDelivery.deliveryId);

    const child = await environment.worker.runNext("worker_child");
    const failedParent = await environment.repository.get(parent.jobId);
    expect(child?.state).toBe("failed");
    expect(failedParent?.state).toBe("failed");
  });

  it("cancels remaining siblings durably, fails the parent, and drains stale deliveries", async () => {
    const context = principalContext();
    const parentId = asyncJobIdSchema.parse("job_cancel_parent");
    const failedChildId = asyncJobIdSchema.parse("job_cancel_failed_child");
    const queuedChildId = asyncJobIdSchema.parse("job_cancel_queued_child");
    const runningChildId = asyncJobIdSchema.parse("job_cancel_running_child");
    const handler = new ScriptedFakeJobHandler("intent-extraction", [
      permanentFailure(),
    ]);
    const environment = harness([handler]);
    const parent = await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "cancel-parent", {
        expectedChildJobIds: [failedChildId, queuedChildId, runningChildId],
        failurePolicy: "cancel-remaining",
        preallocatedJobId: parentId,
      }),
    );
    await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "cancel-failed-child", {
        parentJobId: parentId,
        preallocatedJobId: failedChildId,
      }),
    );
    await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "cancel-queued-child", {
        parentJobId: parentId,
        preallocatedJobId: queuedChildId,
      }),
    );
    const runningChild = await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "cancel-running-child", {
        parentJobId: parentId,
        preallocatedJobId: runningChildId,
      }),
    );

    const parentDelivery = await environment.queue.receive({
      leaseMilliseconds: 1_000,
      now: START,
      workerId: "test",
    });
    expect(parentDelivery?.envelope.jobId).toBe(parent.jobId);
    if (parentDelivery === null) {
      throw new Error("Expected the parent queue delivery.");
    }
    await environment.queue.acknowledge(parentDelivery.deliveryId);

    const runningClaim = applyAsyncJobLifecycleCommandV1(runningChild, {
      at: START,
      attemptId: "attempt_cancel_running" as never,
      dependencies: [],
      expectedInputDigest: runningChild.inputDigest,
      expectedRecordVersion: runningChild.recordVersion,
      handler: {
        family: runningChild.family,
        handlerId: namespacedIdentifierSchema.parse(handler.handlerId),
        handlerVersion: handler.handlerVersion,
        resumePolicy: handler.resumePolicy,
      },
      kind: "claim",
      leaseExpiresAt: "2026-08-15T12:01:00.000Z",
      workerId: "worker_cancel_running" as never,
    });
    const runningAudit = createJobAuditOutboxEntryV1({
      actor: { kind: "worker", workerId: "worker_cancel_running" as never },
      eventType: "attempt-claimed",
      occurredAt: START,
      record: runningClaim.job,
      transition: runningClaim.transition,
    });
    await environment.repository.saveWithAudit(
      runningClaim.job,
      runningChild.recordVersion,
      [runningAudit],
    );
    await environment.audit.append(runningAudit);
    await environment.repository.markAuditEntryPublished({
      eventId: runningAudit.event.eventId,
      ownership: runningAudit.event.ownership,
      publishedAt: START,
    });

    expect(
      (await environment.worker.runNext("worker_cancel_failure"))?.state,
    ).toBe("failed");
    const failedParent = await environment.repository.get(parentId);
    const canceledSibling = await environment.repository.get(queuedChildId);
    const requestedSibling = await environment.repository.get(runningChildId);
    expect(failedParent?.state).toBe("failed");
    expect(canceledSibling).toMatchObject({
      cancellation: {
        requestedBy: parentId,
        state: "acknowledged",
      },
      state: "canceled",
    });
    expect(requestedSibling).toMatchObject({
      cancellation: { requestedBy: parentId, state: "requested" },
      state: "running",
    });

    await environment.worker.runNext("worker_cancel_drain_1");
    await environment.worker.runNext("worker_cancel_drain_2");
    expect(
      await environment.worker.runNext("worker_cancel_drain_3"),
    ).toBeNull();
    expect(environment.queue.size).toBe(0);
    expect(environment.audit.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "cancellation-requested",
        "job-canceled",
        "job-failed",
      ]),
    );
  });

  it("marks expired artifact references in polling without rewriting evidence", async () => {
    const context = principalContext();
    const expiresAt = "2026-08-15T12:00:01.000Z";
    const environment = harness([
      new ScriptedFakeJobHandler("diagram-rendering", [
        diagramOutcome(expiresAt),
      ]),
    ]);
    const job = await createdJob(
      environment.service,
      context,
      command(context, solutionInput(), "artifact-expiry"),
    );
    await environment.worker.runNext("worker_artifact");
    environment.clock.advance(1_001);

    const polled = await environment.service.poll(context, job.jobId);
    expect(polled?.job.output?.family).toBe("diagram-rendering");
    if (polled?.job.output?.family === "diagram-rendering") {
      expect(polled.job.output.diagram.availability).toEqual({
        expiredAt: expiresAt,
        state: "expired",
      });
    }
  });

  it("rejects invalid lifecycle transitions and keeps superseded jobs auditable", async () => {
    const context = principalContext();
    const environment = harness([
      new DeterministicFakeJobHandler("diagram-rendering"),
    ]);
    const original = await createdJob(
      environment.service,
      context,
      command(context, solutionInput("diagram-rendering", "revision_1"), "old"),
    );
    const replacement = await createdJob(
      environment.service,
      context,
      command(context, solutionInput("diagram-rendering", "revision_2"), "new"),
    );

    await expect(
      environment.service.resumeAwaitingUserInput(
        context,
        original.jobId,
        {
          handlerId: "job.deterministic-fake",
          handlerVersion: "1.0.0",
          resumePolicy: "checkpoint-required",
        },
        "interaction_missing",
        reference("input-payload"),
      ),
    ).rejects.toThrow();
    const superseded = await environment.service.supersede(
      context,
      original.jobId,
      replacement.jobId,
    );
    expect(superseded?.state).toBe("superseded");
    expect(superseded?.supersededByJobId).toBe(replacement.jobId);
    expect(superseded?.input.subject).toEqual(original.input.subject);
    expect(
      (await environment.service.poll(context, original.jobId))?.job.state,
    ).toBe("superseded");
  });

  it("creates evidence references bound to the exact revision and environment", async () => {
    const context = principalContext();
    const environment = harness([
      new DeterministicFakeJobHandler("customer-owned-plan-evidence"),
    ]);
    const job = await createdJob(
      environment.service,
      context,
      command(
        context,
        solutionInput("customer-owned-plan-evidence"),
        "evidence",
      ),
    );
    const succeeded = await environment.worker.runNext("worker_evidence");

    expect(succeeded?.state).toBe("succeeded");
    expect(succeeded?.output?.evidenceRecords).toHaveLength(1);
    const evidence = succeeded?.output?.evidenceRecords[0];
    expect(evidence?.solutionRevisionId).toBe(
      job.input.subject.kind === "solution-revision"
        ? job.input.subject.solutionRevisionId
        : undefined,
    );
    expect(evidence?.environment).toEqual({ environmentType: "development" });
  });

  it("rejects oversized input before queueing and fails oversized output safely", async () => {
    const context = principalContext();
    const environment = harness([
      new DeterministicFakeJobHandler("intent-extraction", 1_024),
    ]);
    await expect(
      environment.service.create(
        context,
        command(context, draftInput(), "large-input", {
          limits: { referencedInputBytes: 1 },
        }),
      ),
    ).rejects.toThrow();

    await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "large-output", {
        limits: { attemptCount: 1, outputBytes: 64 },
      }),
    );
    const failed = await environment.worker.runNext("worker_large_output");
    expect(failed?.state).toBe("failed");
    expect(failed?.failure?.code).toBe("cloudmarkup.job.output-limit-exceeded");
  });

  it("redacts unexpected handler errors from records and audit output", async () => {
    const context = principalContext();
    const secret = "token-super-secret-value";
    const environment = harness([
      new ScriptedFakeJobHandler("intent-extraction", [
        { error: new Error(`provider failed ${secret}`), kind: "unsafe-error" },
      ]),
    ]);
    await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "redaction", {
        limits: { attemptCount: 1 },
      }),
    );
    const failed = await environment.worker.runNext("worker_redaction");
    const serialized = JSON.stringify({
      events: environment.audit.events,
      failed,
    });

    expect(failed?.state).toBe("failed");
    expect(failed?.failure?.publicMessage).toBe("job-internal-error");
    expect(serialized).not.toContain(secret);
  });

  it("resumes from a durable checkpoint and durable user response", async () => {
    const context = principalContext();
    const clock = new MutableJobClock(START);
    let calls = 0;
    const handler: JobHandlerV1 = {
      family: "intent-extraction",
      handlerId: "job.user-input-fake",
      handlerVersion: "1.0.0",
      resumePolicy: "checkpoint-required",
      execute(record, handlerContext: JobHandlerContextV1) {
        calls += 1;
        if (calls === 1) {
          const checkpoint = asyncJobCheckpointV1Schema.parse({
            attemptNumber: handlerContext.attemptNumber,
            checkpointId: "checkpoint_user_input",
            createdAt: clock.now().toISOString(),
            handlerId: namespacedIdentifierSchema.parse(this.handlerId),
            handlerVersion: this.handlerVersion,
            inputDigest: record.inputDigest,
            sequence: 1,
            state: reference("checkpoint-state"),
          });
          return Promise.resolve(
            asyncJobHandlerOutcomeV1Schema.parse({
              checkpoint,
              interactionId: "interaction_1",
              messageKey: "job.input-required",
              outcome: "awaiting-user-input",
            }),
          );
        }
        expect(handlerContext.checkpoint?.checkpointId).toBe(
          "checkpoint_user_input",
        );
        return Promise.resolve(proposalOutcome());
      },
    };
    const environment = harness([handler]);
    // Keep the handler's deterministic clock synchronized with the harness.
    clock.advance(environment.clock.now().getTime() - clock.now().getTime());
    const job = await createdJob(
      environment.service,
      context,
      command(context, draftInput(), "user-input"),
    );
    const waiting = await environment.worker.runNext("worker_user_input_1");
    expect(waiting?.state).toBe("awaiting-user-input");
    expect(waiting?.interaction.state).toBe("awaiting-user-input");

    const resumed = await environment.service.resumeAwaitingUserInput(
      context,
      job.jobId,
      {
        handlerId: handler.handlerId,
        handlerVersion: handler.handlerVersion,
        resumePolicy: handler.resumePolicy,
      },
      "interaction_1",
      reference("input-payload"),
    );
    expect(resumed?.state).toBe("queued");
    expect(resumed?.interaction.state).toBe("user-input-received");

    const succeeded = await environment.worker.runNext("worker_user_input_2");
    expect(succeeded?.state).toBe("succeeded");
    expect(succeeded?.attempts[1]?.resumedFromCheckpointId).toBe(
      "checkpoint_user_input",
    );
  });
});
