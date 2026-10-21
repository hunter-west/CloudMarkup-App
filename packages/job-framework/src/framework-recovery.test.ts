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
  asyncJobObjectReferenceV1Schema,
  asyncJobTrustedContextV1Schema,
  type AsyncJobQueueEnvelopeV1,
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
} from "./index.js";

const START = "2026-08-15T12:00:00.000Z";
const DIGEST = `sha256:${"a".repeat(64)}` as const;

class FailOnceJobQueue extends InMemoryFifoJobQueue {
  #failuresRemaining = 1;

  public override async publish(
    envelope: AsyncJobQueueEnvelopeV1,
  ): Promise<void> {
    if (this.#failuresRemaining > 0) {
      this.#failuresRemaining -= 1;
      throw new Error("simulated queue outage");
    }
    await super.publish(envelope);
  }
}

describe("job publication recovery", () => {
  it("recovers record-before-publish crashes without duplicating hooks or deliveries", async () => {
    const context = asyncJobTrustedContextV1Schema.parse({
      actor: { actorId: "actor_recovery", kind: "principal" },
      correlationId: "correlation_recovery_original",
      ownership: {
        organizationId: "org_recovery",
        projectId: "project_recovery",
      },
    });
    const input = asyncJobInputV1Schema.parse({
      contractVersion: 1,
      family: "intent-extraction",
      source: asyncJobObjectReferenceV1Schema.parse({
        contractVersion: 1,
        digest: DIGEST,
        mediaType: "application/json",
        objectId: "object_recovery_input",
        purpose: "input-payload",
        sizeBytes: 32,
      }),
      subject: {
        contentDigest: DIGEST,
        draftId: "draft_recovery",
        draftVersion: 1,
        etag: '"recovery-etag"',
        kind: "draft",
      },
    });
    const jobId = asyncJobIdSchema.parse("job_recovery");
    const request = asyncJobCreateRequestV1Schema.parse({
      contractVersion: 1,
      idempotencyKey: "recovery-key",
      input,
      inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
    });
    const idempotency = asyncJobIdempotencyClaimV1Schema.parse({
      actorId: "actor_recovery",
      keyDigest: getAsyncJobIdempotencyKeyDigestV1(request.idempotencyKey),
      operationId: "job.create",
      requestDigest: getAsyncJobCreateRequestDigestV1(request),
    });
    const ids = new SequentialJobIdGenerator("recovery");
    const queue = new FailOnceJobQueue(ids);
    const repository = new InMemoryJobRepository();
    const entitlement = new AllowAllJobEntitlementPort();
    const reservation = new IdempotentFakeReservationPort();
    const service = new JobService({
      audit: new InMemoryJobAuditPort(),
      clock: new MutableJobClock(START),
      entitlement,
      ids,
      queue,
      repository,
      reservation,
    });
    const createCommand = {
      idempotency,
      inputDigest: getAsyncJobInputDigestV1(input),
      preallocatedJobId: jobId,
      request,

      reservationRequested: true,
    } as const;

    await expect(service.create(context, createCommand)).rejects.toThrow(
      "simulated queue outage",
    );
    expect((await repository.get(jobId))?.state).toBe("queued");
    expect(queue.size).toBe(0);

    const claim = await repository.getCreationClaim({
      keyDigest: idempotency.keyDigest,
      operationId: idempotency.operationId,
      ownership: context.ownership,
    });
    expect(claim).toMatchObject({
      correlationId: context.correlationId,
      entitlementDecision: {
        allowed: true,
        decisionReference: `entitlement:${jobId}`,
      },
      ownership: context.ownership,
      status: "completed",
    });
    expect(claim?.reservationDecision).toMatchObject({
      allowed: true,
      reservationId: `reservation_${jobId}`,
    });
    expect(entitlement.calls).toBe(1);
    expect(reservation.calls).toBe(1);

    const scheduler = asyncJobTrustedContextV1Schema.parse({
      actor: { kind: "system", reason: "scheduler" },
      correlationId: "correlation_scheduler",
      ownership: context.ownership,
    });
    expect(await service.reconcileQueuedPublications(scheduler)).toBe(1);
    expect(queue.size).toBe(1);
    expect(await service.reconcileQueuedPublications(scheduler)).toBe(1);
    expect(queue.size).toBe(1);

    const wrongProject = asyncJobTrustedContextV1Schema.parse({
      ...context,
      ownership: {
        organizationId: context.ownership.organizationId,
        projectId: "project_other",
      },
    });
    expect(await service.poll(wrongProject, jobId)).toBeNull();
  });
});
