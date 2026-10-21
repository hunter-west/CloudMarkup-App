import {
  getAsyncJobCreateRequestDigestV1,
  getAsyncJobIdempotencyKeyDigestV1,
  getAsyncJobInputDigestV1,
  getAsyncJobInputSizeBytesV1,
} from "@cloudmarkup/domain";
import {
  asyncJobCreateRequestV1Schema,
  asyncJobHandlerOutcomeV1Schema,
  asyncJobIdempotencyClaimV1Schema,
  asyncJobInputV1Schema,
  asyncJobObjectReferenceV1Schema,
  asyncJobTrustedContextV1Schema,
  namespacedIdentifierSchema,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  AllowAllJobEntitlementPort,
  DefaultJobFailureClassifier,
  InMemoryFifoJobQueue,
  InMemoryJobAuditPort,
  InMemoryJobHandlerRegistry,
  InMemoryJobOrchestrationDecisionPort,
  InMemoryJobRepository,
  JobService,
  JobWorker,
  MutableJobClock,
  SequentialJobIdGenerator,
  type JobHandlerV1,
  type JobAuditOutboxEntryV1,
} from "./index.js";

const START = "2026-08-15T12:00:00.000Z";
const DIGEST = `sha256:${"c".repeat(64)}` as const;

class FailNextAuditPort extends InMemoryJobAuditPort {
  #failuresRemaining = 0;

  public failNext(): void {
    this.#failuresRemaining += 1;
  }

  public override async append(entry: JobAuditOutboxEntryV1): Promise<void> {
    if (this.#failuresRemaining > 0) {
      this.#failuresRemaining -= 1;
      throw new Error("simulated worker audit outage");
    }
    await super.append(entry);
  }
}
describe("worker progress and leases", () => {
  it("persists monotonic progress and heartbeat checkpoints", async () => {
    const context = asyncJobTrustedContextV1Schema.parse({
      actor: { actorId: "actor_progress", kind: "principal" },
      correlationId: "correlation_progress",
      ownership: {
        organizationId: "org_progress",
        projectId: "project_progress",
      },
    });
    const input = asyncJobInputV1Schema.parse({
      contractVersion: 1,
      family: "intent-extraction",
      source: asyncJobObjectReferenceV1Schema.parse({
        contractVersion: 1,
        digest: DIGEST,
        mediaType: "application/json",
        objectId: "object_progress_input",
        purpose: "input-payload",
        sizeBytes: 32,
      }),
      subject: {
        contentDigest: DIGEST,
        draftId: "draft_progress",
        draftVersion: 1,
        etag: '"progress-etag"',
        kind: "draft",
      },
    });
    const clock = new MutableJobClock(START);
    const handler: JobHandlerV1 = {
      family: "intent-extraction",
      handlerId: "job.progress-fake",
      handlerVersion: "1.0.0",
      resumePolicy: "restart-from-input",
      async execute(record: AsyncJobRecordV1, handlerContext) {
        await handlerContext.reportProgress({
          completedUnits: 1,
          phase: namespacedIdentifierSchema.parse("cloudmarkup.job.testing"),
          sequence: 2,
          totalUnits: 2,
        });
        clock.advance(10_000);
        await handlerContext.heartbeat();
        return asyncJobHandlerOutcomeV1Schema.parse({
          outcome: "succeeded",
          output: {
            contractVersion: 1,
            evidenceRecords: [],
            family: "intent-extraction",
            proposal: asyncJobObjectReferenceV1Schema.parse({
              contractVersion: 1,
              digest: DIGEST,
              mediaType: "application/json",
              objectId: `object_${record.jobId}_proposal`,
              purpose: "proposal",
              sizeBytes: 32,
            }),
          },
          outputSizeBytes: 32,
        });
      },
    };
    const ids = new SequentialJobIdGenerator("progress");
    const queue = new InMemoryFifoJobQueue(ids);
    const repository = new InMemoryJobRepository();
    const audit = new FailNextAuditPort();
    const handlers = new InMemoryJobHandlerRegistry([handler]);
    const service = new JobService({
      audit,
      clock,
      entitlement: new AllowAllJobEntitlementPort(),
      ids,
      queue,
      repository,
    });
    const worker = new JobWorker({
      audit,
      clock,
      failureClassifier: new DefaultJobFailureClassifier(),
      handlers,
      ids,
      orchestration: new InMemoryJobOrchestrationDecisionPort(),
      queue,
      repository,
    });
    const request = asyncJobCreateRequestV1Schema.parse({
      contractVersion: 1,
      idempotencyKey: "progress-key",
      input,
      inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
    });
    const idempotency = asyncJobIdempotencyClaimV1Schema.parse({
      actorId: "actor_progress",
      keyDigest: getAsyncJobIdempotencyKeyDigestV1(request.idempotencyKey),
      operationId: "job.create",
      requestDigest: getAsyncJobCreateRequestDigestV1(request),
    });
    const created = await service.create(context, {
      idempotency,
      inputDigest: getAsyncJobInputDigestV1(input),
      request,
    });
    expect(created.kind).toBe("created");

    audit.failNext();
    const succeeded = await worker.runNext("worker_progress", 30_000);
    expect(succeeded?.state).toBe("succeeded");
    expect(succeeded?.attempts[0]?.runtimeSeconds).toBe(10);
    expect(succeeded?.progress).toMatchObject({
      completedUnits: 2,
      phase: "cloudmarkup.job.succeeded",
      sequence: 3,
      totalUnits: 2,
    });
    expect(
      audit.events.filter((event) => event.eventType === "progress-recorded"),
    ).toHaveLength(2);
    const reconciler = asyncJobTrustedContextV1Schema.parse({
      actor: { kind: "system", reason: "orphan-reconciler" },
      correlationId: "correlation_progress_audit_reconciler",
      ownership: context.ownership,
    });
    expect(await service.reconcileAuditOutbox(reconciler)).toBe(1);
    expect(
      audit.events.filter((event) => event.eventType === "attempt-claimed"),
    ).toHaveLength(1);
    expect(new Set(audit.events.map((event) => event.eventId)).size).toBe(
      audit.events.length,
    );
    expect(await service.reconcileAuditOutbox(reconciler)).toBe(0);
  });
});
