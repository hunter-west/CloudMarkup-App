import {
  getAsyncJobCreateRequestDigestV1,
  getAsyncJobIdempotencyKeyDigestV1,
  getAsyncJobInputDigestV1,
  getAsyncJobInputSizeBytesV1,
} from "@cloudmarkup/domain";
import {
  asyncJobCreateRequestV1Schema,
  asyncJobIdSchema,
  asyncJobIdempotencyClaimV1Schema,
  asyncJobInputV1Schema,
  asyncJobTrustedContextV1Schema,
  type AsyncJobRecordV1,
  type AsyncJobTrustedContextV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  AllowAllJobEntitlementPort,
  IdempotentFakeReservationPort,
  InMemoryFifoJobQueue,
  InMemoryJobAuditPort,
  InMemoryJobRepository,
  JobService,
  MutableJobClock,
  SequentialJobIdGenerator,
  type CreateJobCommandV1,
  type EntitlementDecisionV1,
  type JobAuditOutboxEntryV1,
  type JobCreationClaimV1,
  type JobEntitlementPort,
} from "./index.js";

const START = "2026-08-15T12:00:00.000Z";
const DIGEST = `sha256:${"d".repeat(64)}` as const;

function context(
  organizationId = "org_recovery",
  projectId = "project_recovery",
): AsyncJobTrustedContextV1 {
  return asyncJobTrustedContextV1Schema.parse({
    actor: { actorId: `actor_${organizationId}`, kind: "principal" },
    correlationId: `correlation_${organizationId}`,
    ownership: { organizationId, projectId },
  });
}

function reconciler(
  principal: AsyncJobTrustedContextV1,
): AsyncJobTrustedContextV1 {
  return asyncJobTrustedContextV1Schema.parse({
    actor: { kind: "system", reason: "orphan-reconciler" },
    correlationId: `correlation_reconciler_${principal.ownership.organizationId}`,
    ownership: principal.ownership,
  });
}

function command(
  principal: AsyncJobTrustedContextV1,
  key: string,
  jobId: string,
  revision = "solution_revision_recovery",
  reservationRequested = false,
  expiresAt?: string,
): CreateJobCommandV1 {
  if (principal.actor.kind !== "principal") {
    throw new Error("Test command requires a principal.");
  }
  const input = asyncJobInputV1Schema.parse({
    contractVersion: 1,
    family: "diagram-rendering",
    format: "svg",
    rendererTargetId: "cloudmarkup.renderer",
    subject: {
      kind: "solution-revision",
      manifestDigest: DIGEST,
      manifestRecordId: `manifest_${revision}`,
      solutionRevisionId: revision,
    },
  });
  const request = asyncJobCreateRequestV1Schema.parse({
    contractVersion: 1,
    idempotencyKey: key,
    input,
    inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
  });
  return {
    ...(expiresAt === undefined ? {} : { expiresAt }),
    idempotency: asyncJobIdempotencyClaimV1Schema.parse({
      actorId: principal.actor.actorId,
      keyDigest: getAsyncJobIdempotencyKeyDigestV1(key),
      operationId: "job.create",
      requestDigest: getAsyncJobCreateRequestDigestV1(request),
    }),
    inputDigest: getAsyncJobInputDigestV1(input),
    preallocatedJobId: asyncJobIdSchema.parse(jobId),
    request,
    reservationRequested,
  };
}

class ThrowingEntitlementPort implements JobEntitlementPort {
  public calls = 0;

  public evaluate(): Promise<EntitlementDecisionV1> {
    this.calls += 1;
    return Promise.reject(new Error("simulated entitlement crash"));
  }
}

class FailOnceCompleteRepository extends InMemoryJobRepository {
  #failuresRemaining = 1;
  readonly #targetJobId: string | undefined;

  public constructor(targetJobId?: string) {
    super();
    this.#targetJobId = targetJobId;
  }

  public override async completeCreation(
    claim: JobCreationClaimV1,
    record: AsyncJobRecordV1,
    updatedAt: string,
    auditEntries: readonly JobAuditOutboxEntryV1[],
  ): Promise<AsyncJobRecordV1> {
    if (
      this.#failuresRemaining > 0 &&
      (this.#targetJobId === undefined || this.#targetJobId === record.jobId)
    ) {
      this.#failuresRemaining -= 1;
      throw new Error("simulated completion crash");
    }
    return super.completeCreation(claim, record, updatedAt, auditEntries);
  }
}

class FailOnceAuditPort extends InMemoryJobAuditPort {
  #failuresRemaining = 1;

  public override async append(entry: JobAuditOutboxEntryV1): Promise<void> {
    if (this.#failuresRemaining > 0) {
      this.#failuresRemaining -= 1;
      throw new Error("simulated audit outage");
    }
    await super.append(entry);
  }
}

function environment(options: {
  readonly audit?: InMemoryJobAuditPort;
  readonly entitlement: JobEntitlementPort;
  readonly repository?: InMemoryJobRepository;
  readonly reservation?: IdempotentFakeReservationPort;
}) {
  const audit = options.audit ?? new InMemoryJobAuditPort();
  const clock = new MutableJobClock(START);
  const ids = new SequentialJobIdGenerator("creation-recovery");
  const queue = new InMemoryFifoJobQueue(ids);
  const repository = options.repository ?? new InMemoryJobRepository();
  const service = new JobService({
    audit,
    clock,
    entitlement: options.entitlement,
    ids,
    queue,
    repository,
    ...(options.reservation === undefined
      ? {}
      : { reservation: options.reservation }),
  });
  return { audit, clock, queue, repository, service };
}

describe("durable job creation recovery and audit outbox", () => {
  it("fails closed from a stale claim without repeating an interrupted hook", async () => {
    const principal = context();
    const entitlement = new ThrowingEntitlementPort();
    const env = environment({ entitlement });
    const createCommand = command(
      principal,
      "interrupted-entitlement",
      "job_interrupted_entitlement",
    );

    await expect(env.service.create(principal, createCommand)).rejects.toThrow(
      "simulated entitlement crash",
    );
    env.clock.advance(30_001);
    expect(
      await env.service.reconcileStaleCreations(reconciler(principal)),
    ).toBe(1);
    expect(
      await env.service.reconcileStaleCreations(reconciler(principal)),
    ).toBe(0);

    const claim = await env.repository.getCreationClaim({
      keyDigest: createCommand.idempotency.keyDigest,
      operationId: createCommand.idempotency.operationId,
      ownership: principal.ownership,
    });
    expect(claim).toMatchObject({
      creation: {
        inputDigest: createCommand.inputDigest,
        reservationRequested: false,
      },
      denial: {
        code: "job.creation-recovery-incomplete",
        publicMessage: "job-temporarily-unavailable",
      },
      entitlementDecision: null,
      status: "denied",
    });
    expect(entitlement.calls).toBe(1);
    expect(env.audit.events).toHaveLength(0);
    expect(env.audit.creationClaimEvents).toMatchObject([
      {
        correlationId: principal.correlationId,
        denialSource: "recovery",
        eventType: "creation-denied",
        ownership: principal.ownership,
      },
    ]);
  });

  it("reconstructs the exact revision from durable approved decisions without repeating hooks", async () => {
    const principal = context();
    const entitlement = new AllowAllJobEntitlementPort();
    const reservation = new IdempotentFakeReservationPort();
    const repository = new FailOnceCompleteRepository();
    const env = environment({ entitlement, repository, reservation });
    const createCommand = command(
      principal,
      "approved-before-crash",
      "job_approved_before_crash",
      "solution_revision_exact_recovery",
      true,
    );

    await expect(env.service.create(principal, createCommand)).rejects.toThrow(
      "simulated completion crash",
    );
    expect(await repository.get("job_approved_before_crash")).toBeNull();
    const durableClaim = await repository.getCreationClaim({
      keyDigest: createCommand.idempotency.keyDigest,
      operationId: createCommand.idempotency.operationId,
      ownership: principal.ownership,
    });
    expect(durableClaim).toMatchObject({
      entitlementDecision: {
        allowed: true,
        decisionReference: "entitlement:job_approved_before_crash",
      },
      reservationDecision: {
        allowed: true,
        reservationId: "reservation_job_approved_before_crash",
      },
      status: "claimed",
    });

    env.clock.advance(30_001);
    expect(
      await env.service.reconcileStaleCreations(reconciler(principal)),
    ).toBe(1);
    const recovered = await repository.get("job_approved_before_crash");
    expect(recovered?.input.subject).toMatchObject({
      kind: "solution-revision",
      solutionRevisionId: "solution_revision_exact_recovery",
    });
    expect(recovered?.inputDigest).toBe(createCommand.inputDigest);
    expect(recovered?.reservation).toEqual({
      reservationId: "reservation_job_approved_before_crash",
      state: "reserved",
    });
    expect(entitlement.calls).toBe(1);
    expect(reservation.calls).toBe(1);
    expect(env.queue.size).toBe(1);
    expect(
      await env.service.reconcileStaleCreations(reconciler(principal)),
    ).toBe(0);
    expect((await env.service.create(principal, createCommand)).kind).toBe(
      "duplicate",
    );
    expect(entitlement.calls).toBe(1);
    expect(reservation.calls).toBe(1);
  });

  it("commits creation when immediate audit delivery fails and reconciles once", async () => {
    const principal = context();
    const audit = new FailOnceAuditPort();
    const env = environment({
      audit,
      entitlement: new AllowAllJobEntitlementPort(),
    });

    const outcome = await env.service.create(
      principal,
      command(principal, "audit-outage", "job_audit_outage"),
    );
    expect(outcome.kind).toBe("created");
    await expect(
      env.service.reconcileAuditOutbox(reconciler(principal), 0),
    ).rejects.toThrow("positive integer");
    expect(audit.events).toHaveLength(2);
    expect(await env.service.reconcileAuditOutbox(reconciler(principal))).toBe(
      1,
    );
    expect(audit.events).toHaveLength(3);
    expect(await env.service.reconcileAuditOutbox(reconciler(principal))).toBe(
      0,
    );
    expect(audit.events).toHaveLength(3);
  });

  it("filters stale creation claims by ownership before applying a low limit", async () => {
    const alpha = context("org_alpha_claim", "project_alpha_claim");
    const beta = context("org_beta_claim", "project_beta_claim");
    const entitlement = new ThrowingEntitlementPort();
    const env = environment({ entitlement });
    const alphaCommand = command(alpha, "alpha-stale", "job_alpha_stale_claim");
    const betaCommand = command(beta, "beta-stale", "job_beta_stale_claim");
    await expect(env.service.create(alpha, alphaCommand)).rejects.toThrow();
    await expect(env.service.create(beta, betaCommand)).rejects.toThrow();
    env.clock.advance(30_001);

    expect(
      await env.service.reconcileStaleCreations(reconciler(beta), 30_000, 1),
    ).toBe(1);
    const alphaClaim = await env.repository.getCreationClaim({
      keyDigest: alphaCommand.idempotency.keyDigest,
      operationId: alphaCommand.idempotency.operationId,
      ownership: alpha.ownership,
    });
    const betaClaim = await env.repository.getCreationClaim({
      keyDigest: betaCommand.idempotency.keyDigest,
      operationId: betaCommand.idempotency.operationId,
      ownership: beta.ownership,
    });
    expect(alphaClaim?.status).toBe("claimed");
    expect(betaClaim?.status).toBe("denied");
  });

  it("denies an approved stale claim that has already expired", async () => {
    const principal = context();
    const jobId = "job_expired_creation_recovery";
    const repository = new FailOnceCompleteRepository(jobId);
    const env = environment({
      entitlement: new AllowAllJobEntitlementPort(),
      repository,
    });
    const createCommand = command(
      principal,
      "expired-creation-recovery",
      jobId,
      "solution_revision_expired_recovery",
      false,
      "2026-08-15T12:00:10.000Z",
    );
    await expect(env.service.create(principal, createCommand)).rejects.toThrow(
      "simulated completion crash",
    );
    env.clock.advance(30_001);

    expect(
      await env.service.reconcileStaleCreations(reconciler(principal)),
    ).toBe(1);
    expect(await repository.get(jobId)).toBeNull();
    expect(env.queue.size).toBe(0);
    const claim = await repository.getCreationClaim({
      keyDigest: createCommand.idempotency.keyDigest,
      operationId: createCommand.idempotency.operationId,
      ownership: principal.ownership,
    });
    expect(claim).toMatchObject({
      denial: {
        code: "job.creation-recovery-expired",
        publicMessage: "job-expired",
      },
      status: "denied",
    });
  });

  it("denies stale child creation when its authoritative parent became terminal", async () => {
    const principal = context();
    const parentId = asyncJobIdSchema.parse("job_recovery_parent");
    const childId = asyncJobIdSchema.parse("job_recovery_child");
    const repository = new FailOnceCompleteRepository(childId);
    const entitlement = new AllowAllJobEntitlementPort();
    const env = environment({ entitlement, repository });
    const parentCommand: CreateJobCommandV1 = {
      ...command(principal, "recovery-parent", parentId),
      orchestration: { expectedChildJobIds: [childId] },
    };
    expect((await env.service.create(principal, parentCommand)).kind).toBe(
      "created",
    );
    const childCommand: CreateJobCommandV1 = {
      ...command(principal, "recovery-child", childId),
      orchestration: { parentJobId: parentId },
    };
    await expect(env.service.create(principal, childCommand)).rejects.toThrow(
      "simulated completion crash",
    );
    expect((await env.service.cancel(principal, parentId))?.state).toBe(
      "canceled",
    );
    env.clock.advance(30_001);

    expect(
      await env.service.reconcileStaleCreations(reconciler(principal)),
    ).toBe(1);
    expect(await repository.get(childId)).toBeNull();
    const claim = await repository.getCreationClaim({
      keyDigest: childCommand.idempotency.keyDigest,
      operationId: childCommand.idempotency.operationId,
      ownership: principal.ownership,
    });
    expect(claim).toMatchObject({
      denial: { code: "job.creation-recovery-incomplete" },
      status: "denied",
    });
    expect(entitlement.calls).toBe(2);
  });

  it("denies stale creation after a dependency reaches terminal non-success", async () => {
    const principal = context();
    const dependencyId = asyncJobIdSchema.parse("job_recovery_dependency");
    const targetId = asyncJobIdSchema.parse("job_recovery_dependent");
    const repository = new FailOnceCompleteRepository(targetId);
    const env = environment({
      entitlement: new AllowAllJobEntitlementPort(),
      repository,
    });
    expect(
      (
        await env.service.create(
          principal,
          command(principal, "recovery-dependency", dependencyId),
        )
      ).kind,
    ).toBe("created");
    expect((await env.service.cancel(principal, dependencyId))?.state).toBe(
      "canceled",
    );
    const targetCommand: CreateJobCommandV1 = {
      ...command(principal, "recovery-dependent", targetId),
      orchestration: { dependencyJobIds: [dependencyId] },
    };
    await expect(env.service.create(principal, targetCommand)).rejects.toThrow(
      "simulated completion crash",
    );
    env.clock.advance(30_001);

    expect(
      await env.service.reconcileStaleCreations(reconciler(principal)),
    ).toBe(1);
    expect(await repository.get(targetId)).toBeNull();
    const claim = await repository.getCreationClaim({
      keyDigest: targetCommand.idempotency.keyDigest,
      operationId: targetCommand.idempotency.operationId,
      ownership: principal.ownership,
    });
    expect(claim).toMatchObject({
      denial: { code: "job.creation-recovery-incomplete" },
      status: "denied",
    });
  });
});
