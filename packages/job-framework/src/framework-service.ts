import {
  applyAsyncJobLifecycleCommandV1,
  createAsyncJobRecordV1,
  deriveAsyncJobQueueEnvelopeV1,
  deriveAsyncJobStatusViewV1,
  getAsyncJobCreateRequestDigestV1,
  getAsyncJobIdempotencyKeyDigestV1,
  getAsyncJobInputDigestV1,
  getAsyncJobInputSizeBytesV1,
  type AsyncJobHandlerResumePolicyV1,
} from "@cloudmarkup/domain";
import {
  asyncJobCreateRequestV1Schema,
  asyncJobDurableInputReferenceV1Schema,
  asyncJobIdSchema,
  asyncJobInteractionIdSchema,
  asyncJobLimitsV1Schema,
  asyncJobPollingResponseV1Schema,
  asyncJobPublicFailureMessageV1Schema,
  asyncJobReservationLinkV1Schema,
  asyncJobTransitionCursorV1Schema,
  asyncJobTrustedContextV1Schema,
  namespacedIdentifierSchema,
  type AsyncJobAuditEventV1,
  type AsyncJobId,
  type AsyncJobLimitsV1,
  type AsyncJobObjectReferenceV1,
  type AsyncJobPollingResponseV1,
  type AsyncJobRecordV1,
  type AsyncJobTrustedContextV1,
} from "@cloudmarkup/schemas";

import {
  DEFAULT_JOB_LIMITS_V1,
  JobFrameworkError,
  isTerminalJobState,
  type CreateJobCommandV1,
  type CreditReservationDecisionV1,
  type EntitlementDecisionV1,
  type JobCreationClaimV1,
  type JobCreationOutcomeV1,
} from "./framework-contracts.js";
import {
  createCreationClaimAuditOutboxEntryV1,
  createJobAuditOutboxEntryV1,
  type JobAuditOutboxEntryV1,
  type JobCreationClaimAuditEventV1,
} from "./framework-audit.js";
import type {
  JobAuditPort,
  JobClock,
  JobCreditReservationPort,
  JobEntitlementPort,
  JobIdGenerator,
  JobPublicationTransportV1,
  JobPublicationReadinessPort,
  JobRepository,
} from "./framework-ports.js";
import {
  publishReadyJobEnvelope,
  selectJobPublicationTransportV1,
} from "./framework-publication.js";

export type JobServiceDependencies = JobPublicationTransportV1 & {
  readonly audit: JobAuditPort;
  readonly clock: JobClock;
  readonly entitlement: JobEntitlementPort;
  readonly ids: JobIdGenerator;
  readonly maximumLimits?: AsyncJobLimitsV1;
  readonly repository: JobRepository;
  readonly reservation?: JobCreditReservationPort;
  readonly publicationReadiness?: JobPublicationReadinessPort;
};

function now(clock: JobClock): string {
  return clock.now().toISOString();
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

function effectiveLimits(
  maximum: AsyncJobLimitsV1,
  requested: CreateJobCommandV1["limits"],
): AsyncJobLimitsV1 {
  const candidate = asyncJobLimitsV1Schema.parse({
    ...maximum,
    ...requested,
    contractVersion: 1,
  });
  for (const key of Object.keys(
    maximum,
  ) as readonly (keyof AsyncJobLimitsV1)[]) {
    if (key !== "contractVersion" && candidate[key] > maximum[key]) {
      throw new JobFrameworkError(
        "job.limit-above-service-maximum",
        `The ${key} limit exceeds the service maximum.`,
      );
    }
  }
  return candidate;
}

function normalizeEntitlementDecision(
  decision: EntitlementDecisionV1,
): EntitlementDecisionV1 {
  if (
    typeof decision.decisionReference !== "string" ||
    decision.decisionReference.length < 1 ||
    decision.decisionReference.length > 128
  ) {
    throw new JobFrameworkError(
      "job.invalid-entitlement-decision",
      "The entitlement decision reference is invalid.",
    );
  }
  if (decision.allowed) {
    return { allowed: true, decisionReference: decision.decisionReference };
  }
  return {
    allowed: false,
    decisionReference: decision.decisionReference,
    denialCode: namespacedIdentifierSchema.parse(
      decision.denialCode ?? "job.entitlement-denied",
    ),
    publicMessage: asyncJobPublicFailureMessageV1Schema.parse(
      decision.publicMessage ?? "job-not-supported",
    ),
  };
}

function normalizeReservationDecision(
  decision: CreditReservationDecisionV1,
): CreditReservationDecisionV1 {
  if (decision.allowed && decision.reservationId !== undefined) {
    const reservation = asyncJobReservationLinkV1Schema.parse({
      reservationId: decision.reservationId,
      state: "reserved",
    });
    if (reservation.state !== "reserved") {
      throw new JobFrameworkError(
        "job.invalid-reservation-decision",
        "The reservation decision is invalid.",
      );
    }
    return { allowed: true, reservationId: reservation.reservationId };
  }
  return {
    allowed: false,
    denialCode: namespacedIdentifierSchema.parse(
      decision.denialCode ?? "job.reservation-denied",
    ),
    publicMessage: asyncJobPublicFailureMessageV1Schema.parse(
      decision.publicMessage ?? "job-temporarily-unavailable",
    ),
  };
}

export class JobService {
  readonly #dependencies: JobServiceDependencies;
  readonly #maximumLimits: AsyncJobLimitsV1;

  public constructor(dependencies: JobServiceDependencies) {
    selectJobPublicationTransportV1(dependencies);
    this.#dependencies = dependencies;
    this.#maximumLimits = asyncJobLimitsV1Schema.parse(
      dependencies.maximumLimits ?? DEFAULT_JOB_LIMITS_V1,
    );
  }

  public async create(
    contextInput: AsyncJobTrustedContextV1,
    command: CreateJobCommandV1,
  ): Promise<JobCreationOutcomeV1> {
    const context = asyncJobTrustedContextV1Schema.parse(contextInput);
    const request = asyncJobCreateRequestV1Schema.parse(command.request);
    const exactKeyDigest = getAsyncJobIdempotencyKeyDigestV1(
      request.idempotencyKey,
    );
    const exactRequestDigest = getAsyncJobCreateRequestDigestV1(request);
    if (
      command.idempotency.keyDigest !== exactKeyDigest ||
      command.idempotency.requestDigest !== exactRequestDigest
    ) {
      throw new JobFrameworkError(
        "job.idempotency-authority-mismatch",
        "Idempotency digests must identify the exact validated request.",
      );
    }
    const limits = effectiveLimits(this.#maximumLimits, command.limits);
    const exactDigest = getAsyncJobInputDigestV1(request.input);
    const exactSize = getAsyncJobInputSizeBytesV1(request.input);
    if (
      command.inputDigest !== exactDigest ||
      request.inputSizeBytes !== exactSize
    ) {
      throw new JobFrameworkError(
        "job.input-authority-mismatch",
        "The job digest and size must identify the exact validated input.",
      );
    }
    if (
      context.actor.kind !== "principal" ||
      context.actor.actorId !== command.idempotency.actorId
    ) {
      throw new JobFrameworkError(
        "job.idempotency-actor-mismatch",
        "Job creation requires the matching verified principal.",
      );
    }
    const organizationJob = request.input.subject.kind === "organization";
    if (organizationJob === (context.ownership.projectId !== undefined)) {
      throw new JobFrameworkError(
        "job.invalid-ownership-scope",
        organizationJob
          ? "Organization jobs cannot claim project ownership."
          : "Draft and Solution Revision jobs require project ownership.",
      );
    }

    const jobId = asyncJobIdSchema.parse(
      command.preallocatedJobId ?? this.#dependencies.ids.nextId("job"),
    );
    const parent = await this.#resolveParent(context, command, jobId);
    await this.#validateDependencies(
      context,
      command.orchestration?.dependencyJobIds ?? [],
    );
    const creationContext =
      parent === null
        ? context
        : asyncJobTrustedContextV1Schema.parse({
            ...context,
            correlationId: parent.correlationId,
            ownership: parent.ownership,
          });
    const orchestration: AsyncJobRecordV1["orchestration"] = {
      dependencyJobIds: [...(command.orchestration?.dependencyJobIds ?? [])],
      expectedChildJobIds: [
        ...(command.orchestration?.expectedChildJobIds ?? []),
      ],
      failurePolicy: command.orchestration?.failurePolicy ?? "fail-parent",
      ...(parent === null ? {} : { parentJobId: parent.jobId }),
      rootJobId: parent?.orchestration.rootJobId ?? jobId,
    };
    const createdAt = now(this.#dependencies.clock);
    const claimed = await this.#dependencies.repository.claimCreation({
      claimedAt: createdAt,
      correlationId: creationContext.correlationId,
      creation: {
        ...(command.expiresAt === undefined
          ? {}
          : { expiresAt: command.expiresAt }),
        input: request.input,
        inputDigest: command.inputDigest,
        inputSizeBytes: request.inputSizeBytes,
        limits,
        orchestration,
        reservationRequested: command.reservationRequested === true,
      },
      idempotency: command.idempotency,
      jobId,
      ownership: creationContext.ownership,
    });
    if (claimed.kind === "conflict") {
      throw new JobFrameworkError(
        "job.idempotency-key-reused",
        "The idempotency key was already used for a different request.",
      );
    }
    if (claimed.kind === "existing") {
      if (claimed.claim.status === "denied") {
        return {
          code: claimed.claim.denial?.code ?? "job.creation-denied",
          kind: "denied",
          publicMessage:
            claimed.claim.denial?.publicMessage ?? "job-not-supported",
        };
      }
      if (claimed.claim.status === "claimed") {
        return { kind: "in-progress", retryAfterMilliseconds: 250 };
      }
      const duplicate = await this.#dependencies.repository.get(
        claimed.claim.jobId,
      );
      if (
        duplicate === null ||
        !sameOwnership(duplicate.ownership, creationContext.ownership)
      ) {
        throw new JobFrameworkError(
          "job.creation-claim-inconsistent",
          "The completed claim has no matching job.",
        );
      }
      return { job: duplicate, kind: "duplicate" };
    }

    let activeClaim = claimed.claim;
    const entitlement = normalizeEntitlementDecision(
      await this.#dependencies.entitlement.evaluate({
        context: creationContext,
        family: request.input.family,
        idempotencyKeyDigest: command.idempotency.keyDigest,
        jobId,
      }),
    );
    activeClaim = await this.#dependencies.repository.recordEntitlement(
      activeClaim,
      entitlement,
      now(this.#dependencies.clock),
    );
    if (!entitlement.allowed) {
      const denial = {
        code: entitlement.denialCode ?? "job.entitlement-denied",
        publicMessage: entitlement.publicMessage ?? "job-not-supported",
      } as const;
      await this.#denyCreationClaim(
        activeClaim,
        denial,
        "entitlement",
        creationContext.actor,
      );
      return { ...denial, kind: "denied" };
    }

    if (activeClaim.creation.reservationRequested) {
      const port = this.#dependencies.reservation;
      const decision = normalizeReservationDecision(
        port === undefined
          ? {
              allowed: false,
              denialCode: "job.reservation-unavailable",
              publicMessage: "job-temporarily-unavailable",
            }
          : await port.reserve({
              context: creationContext,
              family: request.input.family,
              idempotencyKeyDigest: command.idempotency.keyDigest,
              jobId,
            }),
      );
      activeClaim = await this.#dependencies.repository.recordReservation(
        activeClaim,
        decision,
        now(this.#dependencies.clock),
      );
      if (!decision.allowed) {
        const denial = {
          code: decision.denialCode ?? "job.reservation-denied",
          publicMessage:
            decision.publicMessage ?? "job-temporarily-unavailable",
        } as const;
        await this.#denyCreationClaim(
          activeClaim,
          denial,
          "reservation",
          creationContext.actor,
        );
        return { ...denial, kind: "denied" };
      }
    }

    const completed = await this.#completeCreationClaim(
      activeClaim,
      creationContext.actor,
    );
    if (completed.queueEnvelope !== undefined) {
      await publishReadyJobEnvelope(
        this.#dependencies,
        completed.queueEnvelope,
      );
    }
    return { job: completed.job, kind: "created" };
  }

  public async poll(
    contextInput: AsyncJobTrustedContextV1,
    jobId: string,
  ): Promise<AsyncJobPollingResponseV1 | null> {
    const context = asyncJobTrustedContextV1Schema.parse(contextInput);
    const job = await this.#authorizedJob(context, jobId);
    if (job === null) {
      return null;
    }
    return asyncJobPollingResponseV1Schema.parse({
      contractVersion: 1,
      job: deriveAsyncJobStatusViewV1(job, now(this.#dependencies.clock)),
      pollAfterMilliseconds: isTerminalJobState(job.state) ? 60_000 : 1_000,
      transitionCursor: asyncJobTransitionCursorV1Schema.parse(
        `v1_${job.recordVersion.toString(36)}`,
      ),
    });
  }

  public async cancel(
    contextInput: AsyncJobTrustedContextV1,
    jobId: string,
  ): Promise<AsyncJobRecordV1 | null> {
    const context = asyncJobTrustedContextV1Schema.parse(contextInput);
    if (context.actor.kind !== "principal") {
      throw new JobFrameworkError(
        "job.principal-required",
        "Cancellation requires a verified principal.",
      );
    }
    const current = await this.#authorizedJob(context, jobId);
    if (current === null) {
      return null;
    }
    const result = applyAsyncJobLifecycleCommandV1(current, {
      at: now(this.#dependencies.clock),
      context,
      expectedInputDigest: current.inputDigest,
      expectedRecordVersion: current.recordVersion,
      kind: "request-cancellation",
    });
    const saved = await this.#saveResult(
      current,
      result,
      context.actor,
      result.job.state === "canceled"
        ? "job-canceled"
        : "cancellation-requested",
    );
    return saved;
  }

  public async resumeAwaitingUserInput(
    contextInput: AsyncJobTrustedContextV1,
    jobId: string,
    handler: {
      readonly handlerId: string;
      readonly handlerVersion: string;
      readonly resumePolicy: AsyncJobHandlerResumePolicyV1;
    },
    interactionIdInput: string,
    userResponseInput: AsyncJobObjectReferenceV1,
  ): Promise<AsyncJobRecordV1 | null> {
    const context = asyncJobTrustedContextV1Schema.parse(contextInput);
    const current = await this.#authorizedJob(context, jobId);
    if (current === null) {
      return null;
    }
    if (current.latestCheckpointId === undefined) {
      throw new JobFrameworkError(
        "job.checkpoint-required",
        "Resumption requires the latest durable checkpoint.",
      );
    }
    const interactionId = asyncJobInteractionIdSchema.parse(interactionIdInput);
    const userResponse =
      asyncJobDurableInputReferenceV1Schema.parse(userResponseInput);
    const result = applyAsyncJobLifecycleCommandV1(current, {
      at: now(this.#dependencies.clock),
      checkpointId: current.latestCheckpointId,
      context,
      expectedInputDigest: current.inputDigest,
      expectedRecordVersion: current.recordVersion,
      handler: {
        family: current.family,
        handlerId: namespacedIdentifierSchema.parse(handler.handlerId),
        handlerVersion: handler.handlerVersion,
        resumePolicy: handler.resumePolicy,
      },
      interactionId,
      kind: "resume-user-input",
      userResponse,
    });
    const saved = await this.#saveResult(
      current,
      result,
      context.actor,
      "job-enqueued",
    );
    await this.#publishResult(result);
    return saved;
  }

  public async supersede(
    contextInput: AsyncJobTrustedContextV1,
    jobId: string,
    replacementJobId: AsyncJobId,
  ): Promise<AsyncJobRecordV1 | null> {
    const context = asyncJobTrustedContextV1Schema.parse(contextInput);
    const current = await this.#authorizedJob(context, jobId);
    const replacement = await this.#authorizedJob(context, replacementJobId);
    if (current === null || replacement === null) {
      return null;
    }
    const result = applyAsyncJobLifecycleCommandV1(current, {
      at: now(this.#dependencies.clock),
      expectedInputDigest: current.inputDigest,
      expectedRecordVersion: current.recordVersion,
      kind: "supersede",
      replacement,
    });
    const saved = await this.#saveResult(
      current,
      result,
      context.actor,
      "job-superseded",
    );
    return saved;
  }

  public async expireDueJobs(
    contextInput: AsyncJobTrustedContextV1,
    limit = 100,
  ): Promise<number> {
    const context = asyncJobTrustedContextV1Schema.parse(contextInput);
    if (
      context.actor.kind !== "system" ||
      context.actor.reason !== "retention"
    ) {
      throw new JobFrameworkError(
        "job.retention-context-required",
        "Expiration requires trusted retention context.",
      );
    }
    const at = now(this.#dependencies.clock);
    const jobs = await this.#dependencies.repository.listJobsPastRetention({
      expiredBefore: at,
      limit,
      ownership: context.ownership,
    });
    let expired = 0;
    for (const current of jobs) {
      if (!sameOwnership(current.ownership, context.ownership)) {
        continue;
      }
      const result = applyAsyncJobLifecycleCommandV1(current, {
        at,
        expectedInputDigest: current.inputDigest,
        expectedRecordVersion: current.recordVersion,
        kind: "expire",
      });
      if (result.transition === undefined) {
        continue;
      }
      await this.#saveResult(current, result, context.actor, "job-expired");
      expired += 1;
    }
    return expired;
  }

  public async reconcileQueuedPublications(
    contextInput: AsyncJobTrustedContextV1,
    limit = 100,
  ): Promise<number> {
    const context = asyncJobTrustedContextV1Schema.parse(contextInput);
    if (
      context.actor.kind !== "system" ||
      context.actor.reason !== "scheduler"
    ) {
      throw new JobFrameworkError(
        "job.scheduler-context-required",
        "Queue publication recovery requires trusted scheduler context.",
      );
    }
    const at = now(this.#dependencies.clock);
    const candidates =
      await this.#dependencies.repository.listQueuedJobsReadyForDispatch({
        availableAtOrBefore: at,
        limit,
        ownership: context.ownership,
      });
    let published = 0;
    for (const candidate of candidates) {
      if (!sameOwnership(candidate.ownership, context.ownership)) {
        continue;
      }
      const current = await this.#dependencies.repository.get(candidate.jobId);
      if (
        current?.state !== "queued" ||
        current.recordVersion !== candidate.recordVersion
      ) {
        continue;
      }
      if (
        await publishReadyJobEnvelope(
          this.#dependencies,
          deriveAsyncJobQueueEnvelopeV1(current),
        )
      )
        published += 1;
    }
    return published;
  }

  /** Exact-job record-before-publish recovery; never broadens trusted ownership. */
  public async publishQueuedJob(
    contextInput: AsyncJobTrustedContextV1,
    jobId: string,
  ): Promise<boolean> {
    const context = asyncJobTrustedContextV1Schema.parse(contextInput);
    const current = await this.#dependencies.repository.get(
      asyncJobIdSchema.parse(jobId),
    );
    if (
      current?.state !== "queued" ||
      !sameOwnership(current.ownership, context.ownership)
    )
      return false;
    return publishReadyJobEnvelope(
      this.#dependencies,
      deriveAsyncJobQueueEnvelopeV1(current),
    );
  }

  public async reconcileStaleCreations(
    contextInput: AsyncJobTrustedContextV1,
    staleAfterMilliseconds = 30_000,
    limit = 100,
  ): Promise<number> {
    const context = asyncJobTrustedContextV1Schema.parse(contextInput);
    if (
      context.actor.kind !== "system" ||
      context.actor.reason !== "orphan-reconciler"
    ) {
      throw new JobFrameworkError(
        "job.orphan-context-required",
        "Creation recovery requires trusted reconciler context.",
      );
    }
    if (
      !Number.isSafeInteger(staleAfterMilliseconds) ||
      staleAfterMilliseconds < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1
    ) {
      throw new JobFrameworkError(
        "job.invalid-reconciliation-limit",
        "Creation recovery bounds must be positive integers.",
      );
    }
    const reconciliationAt = now(this.#dependencies.clock);
    const updatedBefore = new Date(
      Date.parse(reconciliationAt) - staleAfterMilliseconds,
    ).toISOString();
    const candidates =
      await this.#dependencies.repository.listStaleCreationClaims({
        limit,
        ownership: context.ownership,
        updatedBefore,
      });
    let reconciled = 0;
    for (const candidate of candidates) {
      if (!sameOwnership(candidate.ownership, context.ownership)) {
        continue;
      }
      const current = await this.#dependencies.repository.getCreationClaim({
        keyDigest: candidate.idempotency.keyDigest,
        operationId: candidate.idempotency.operationId,
        ownership: context.ownership,
      });
      if (
        current?.status !== "claimed" ||
        current.recordVersion !== candidate.recordVersion ||
        current.updatedAt > updatedBefore
      ) {
        continue;
      }
      if (
        current.creation.expiresAt !== undefined &&
        current.creation.expiresAt <= reconciliationAt
      ) {
        await this.#denyCreationClaim(
          current,
          {
            code: "job.creation-recovery-expired",
            publicMessage: "job-expired",
          },
          "recovery",
          context.actor,
        );
        reconciled += 1;
        continue;
      }
      if (!(await this.#creationAuthorityRemainsValid(current))) {
        await this.#denyCreationClaim(
          current,
          {
            code: "job.creation-recovery-incomplete",
            publicMessage: "job-temporarily-unavailable",
          },
          "recovery",
          context.actor,
        );
        reconciled += 1;
        continue;
      }
      const entitlement = current.entitlementDecision;
      if (entitlement === null) {
        await this.#denyCreationClaim(
          current,
          {
            code: "job.creation-recovery-incomplete",
            publicMessage: "job-temporarily-unavailable",
          },
          "recovery",
          context.actor,
        );
        reconciled += 1;
        continue;
      }
      if (!entitlement.allowed) {
        await this.#denyCreationClaim(
          current,
          {
            code: entitlement.denialCode ?? "job.entitlement-denied",
            publicMessage: entitlement.publicMessage ?? "job-not-supported",
          },
          "entitlement",
          context.actor,
        );
        reconciled += 1;
        continue;
      }
      const reservation = current.reservationDecision;
      if (current.creation.reservationRequested && reservation === null) {
        await this.#denyCreationClaim(
          current,
          {
            code: "job.creation-recovery-incomplete",
            publicMessage: "job-temporarily-unavailable",
          },
          "recovery",
          context.actor,
        );
        reconciled += 1;
        continue;
      }
      if (reservation !== null && !reservation.allowed) {
        await this.#denyCreationClaim(
          current,
          {
            code: reservation.denialCode ?? "job.reservation-denied",
            publicMessage:
              reservation.publicMessage ?? "job-temporarily-unavailable",
          },
          "reservation",
          context.actor,
        );
        reconciled += 1;
        continue;
      }
      const completed = await this.#completeCreationClaim(
        current,
        context.actor,
      );
      if (completed.queueEnvelope !== undefined) {
        try {
          await publishReadyJobEnvelope(
            this.#dependencies,
            completed.queueEnvelope,
          );
        } catch {
          // The queued-publication reconciler owns record-before-publish repair.
        }
      }
      reconciled += 1;
    }
    return reconciled;
  }

  public async reconcileAuditOutbox(
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
        "Audit recovery requires trusted reconciler context.",
      );
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new JobFrameworkError(
        "job.invalid-reconciliation-limit",
        "Audit recovery limit must be a positive integer.",
      );
    }
    const entries = await this.#dependencies.repository.listPendingAuditEntries(
      {
        limit,
        ownership: context.ownership,
      },
    );
    let delivered = 0;
    for (const entry of entries) {
      if (!sameOwnership(entry.event.ownership, context.ownership)) {
        continue;
      }
      if (await this.#deliverAuditEntry(entry)) {
        delivered += 1;
      }
    }
    return delivered;
  }

  async #creationAuthorityRemainsValid(
    claim: JobCreationClaimV1,
  ): Promise<boolean> {
    const orchestration = claim.creation.orchestration;
    if (orchestration.parentJobId === undefined) {
      if (orchestration.rootJobId !== claim.jobId) {
        return false;
      }
    } else {
      const parent = await this.#dependencies.repository.get(
        orchestration.parentJobId,
      );
      if (
        parent === null ||
        isTerminalJobState(parent.state) ||
        !sameOwnership(parent.ownership, claim.ownership) ||
        parent.correlationId !== claim.correlationId ||
        parent.orchestration.rootJobId !== orchestration.rootJobId ||
        !parent.orchestration.expectedChildJobIds.includes(claim.jobId)
      ) {
        return false;
      }
    }
    for (const dependencyJobId of orchestration.dependencyJobIds) {
      const dependency =
        await this.#dependencies.repository.get(dependencyJobId);
      if (
        dependency === null ||
        !sameOwnership(dependency.ownership, claim.ownership) ||
        (isTerminalJobState(dependency.state) &&
          dependency.state !== "succeeded")
      ) {
        return false;
      }
    }
    return true;
  }
  async #completeCreationClaim(
    claim: JobCreationClaimV1,
    auditActor: AsyncJobTrustedContextV1["actor"],
  ): Promise<ReturnType<typeof createAsyncJobRecordV1>> {
    if (claim.entitlementDecision?.allowed !== true) {
      throw new JobFrameworkError(
        "job.creation-claim-mismatch",
        "Job creation requires durable entitlement approval.",
      );
    }
    let reservation: AsyncJobRecordV1["reservation"] = { state: "none" };
    if (claim.creation.reservationRequested) {
      if (
        claim.reservationDecision?.allowed !== true ||
        claim.reservationDecision.reservationId === undefined
      ) {
        throw new JobFrameworkError(
          "job.creation-claim-mismatch",
          "A requested reservation requires durable approval.",
        );
      }
      reservation = asyncJobReservationLinkV1Schema.parse({
        reservationId: claim.reservationDecision.reservationId,
        state: "reserved",
      });
    } else if (claim.reservationDecision !== null) {
      throw new JobFrameworkError(
        "job.creation-claim-mismatch",
        "An unrequested reservation decision cannot complete a job.",
      );
    }
    const created = createAsyncJobRecordV1({
      context: asyncJobTrustedContextV1Schema.parse({
        actor: { actorId: claim.idempotency.actorId, kind: "principal" },
        correlationId: claim.correlationId,
        ownership: claim.ownership,
      }),
      createdAt: claim.claimedAt,
      ...(claim.creation.expiresAt === undefined
        ? {}
        : { expiresAt: claim.creation.expiresAt }),
      idempotency: claim.idempotency,
      input: claim.creation.input,
      inputDigest: claim.creation.inputDigest,
      inputSizeBytes: claim.creation.inputSizeBytes,
      jobId: claim.jobId,
      limits: claim.creation.limits,
      orchestration: {
        dependencyJobIds: claim.creation.orchestration.dependencyJobIds,
        expectedChildJobIds: claim.creation.orchestration.expectedChildJobIds,
        failurePolicy: claim.creation.orchestration.failurePolicy,
        ...(claim.creation.orchestration.parentJobId === undefined
          ? {}
          : { parentJobId: claim.creation.orchestration.parentJobId }),
        rootJobId: claim.creation.orchestration.rootJobId,
      },
      reservation,
    });
    const occurredAt = now(this.#dependencies.clock);
    const auditEntries: JobAuditOutboxEntryV1[] = [
      createJobAuditOutboxEntryV1({
        actor: auditActor,
        eventType: "entitlement-authorized",
        occurredAt,
        record: created.job,
      }),
      ...(reservation.state === "reserved"
        ? [
            createJobAuditOutboxEntryV1({
              actor: auditActor,
              eventType: "reservation-established",
              occurredAt,
              record: created.job,
            }),
          ]
        : []),
      createJobAuditOutboxEntryV1({
        actor: auditActor,
        eventType: "job-created",
        occurredAt,
        record: created.job,
        transition: created.transition,
      }),
      createJobAuditOutboxEntryV1({
        actor: auditActor,
        eventType: "job-enqueued",
        occurredAt,
        record: created.job,
      }),
    ];
    const saved = await this.#dependencies.repository.completeCreation(
      claim,
      created.job,
      occurredAt,
      auditEntries,
    );
    await this.#deliverAuditEntries(auditEntries);
    return { ...created, job: saved };
  }

  async #denyCreationClaim(
    claim: JobCreationClaimV1,
    denial: NonNullable<JobCreationClaimV1["denial"]>,
    denialSource: JobCreationClaimAuditEventV1["denialSource"],
    actor: AsyncJobTrustedContextV1["actor"],
  ): Promise<JobCreationClaimV1> {
    const occurredAt = now(this.#dependencies.clock);
    const auditEntry = createCreationClaimAuditOutboxEntryV1({
      actor,
      claim,
      denial,
      denialSource,
      occurredAt,
    });
    const denied = await this.#dependencies.repository.denyCreation(
      claim,
      denial,
      occurredAt,
      auditEntry,
    );
    await this.#deliverAuditEntries([auditEntry]);
    return denied;
  }

  async #deliverAuditEntry(entry: JobAuditOutboxEntryV1): Promise<boolean> {
    try {
      await this.#dependencies.audit.append(entry);
      await this.#dependencies.repository.markAuditEntryPublished({
        eventId: entry.event.eventId,
        ownership: entry.event.ownership,
        publishedAt: now(this.#dependencies.clock),
      });
      return true;
    } catch {
      return false;
    }
  }

  async #deliverAuditEntries(
    entries: readonly JobAuditOutboxEntryV1[],
  ): Promise<void> {
    for (const entry of entries) {
      await this.#deliverAuditEntry(entry);
    }
  }

  async #saveResult(
    previous: AsyncJobRecordV1,
    result: ReturnType<typeof applyAsyncJobLifecycleCommandV1>,
    actor: AsyncJobTrustedContextV1["actor"],
    eventType: AsyncJobAuditEventV1["eventType"],
  ): Promise<AsyncJobRecordV1> {
    if (result.job.recordVersion === previous.recordVersion) {
      return previous;
    }
    if (result.transition === undefined) {
      throw new JobFrameworkError(
        "job.audit-transition-required",
        "A durable job mutation requires transition audit evidence.",
      );
    }
    const auditEntry = createJobAuditOutboxEntryV1({
      actor,
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
    await this.#deliverAuditEntries([auditEntry]);
    return saved;
  }

  async #publishResult(
    result: ReturnType<typeof applyAsyncJobLifecycleCommandV1>,
  ): Promise<void> {
    if (result.queueEnvelope !== undefined) {
      await publishReadyJobEnvelope(this.#dependencies, result.queueEnvelope);
    }
  }

  async #resolveParent(
    context: AsyncJobTrustedContextV1,
    command: CreateJobCommandV1,
    jobId: AsyncJobId,
  ): Promise<AsyncJobRecordV1 | null> {
    const parentJobId = command.orchestration?.parentJobId;
    if (parentJobId === undefined) {
      return null;
    }
    const parent = await this.#authorizedJob(context, parentJobId);
    if (
      parent === null ||
      parent.ownership.projectId !== context.ownership.projectId ||
      isTerminalJobState(parent.state)
    ) {
      throw new JobFrameworkError("job.not-found", "The job was not found.");
    }
    if (!parent.orchestration.expectedChildJobIds.includes(jobId)) {
      throw new JobFrameworkError(
        "job.child-not-predeclared",
        "The child job identity was not predeclared by its parent.",
      );
    }
    return parent;
  }

  async #validateDependencies(
    context: AsyncJobTrustedContextV1,
    dependencyJobIds: readonly AsyncJobId[],
  ): Promise<void> {
    for (const dependencyJobId of dependencyJobIds) {
      const dependency = await this.#authorizedJob(context, dependencyJobId);
      if (
        dependency === null ||
        dependency.ownership.projectId !== context.ownership.projectId
      ) {
        throw new JobFrameworkError("job.not-found", "The job was not found.");
      }
    }
  }

  async #authorizedJob(
    context: AsyncJobTrustedContextV1,
    jobId: string,
  ): Promise<AsyncJobRecordV1 | null> {
    const job = await this.#dependencies.repository.get(jobId);
    return job === null || !sameOwnership(job.ownership, context.ownership)
      ? null
      : job;
  }
}
