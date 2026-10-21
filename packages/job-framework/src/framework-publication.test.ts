import {
  createAsyncJobRecordV1,
  deriveAsyncJobQueueEnvelopeV1,
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
  type AsyncJobQueueEnvelopeV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  publishReadyJobEnvelope,
  selectJobPublicationTransportV1,
} from "./framework-publication.js";
import {
  AllowAllJobEntitlementPort,
  InMemoryFifoJobQueue,
  InMemoryJobAuditPort,
  InMemoryJobRepository,
  JobService,
  MutableJobClock,
  SequentialJobIdGenerator,
} from "./index.js";
const at = "2026-09-06T00:00:00.000Z";
const digest = `sha256:${"a".repeat(64)}`;
function fixture(transport: "queue" | "publisher" = "queue") {
  const context = asyncJobTrustedContextV1Schema.parse({
    actor: { kind: "principal", actorId: "principal.export" },
    correlationId: "correlation.export",
    ownership: { organizationId: "org.export", projectId: "project.export" },
  });
  const input = asyncJobInputV1Schema.parse({
    contractVersion: 1,
    family: "solution-export-orchestration",
    subject: {
      kind: "solution-revision",
      solutionRevisionId: "revision.export",
      manifestRecordId: "manifest.export",
      manifestDigest: digest,
    },
    environment: { environmentType: "development" },
    request: {
      contractVersion: 1,
      objectId: "object.request",
      purpose: "input-payload",
      digest,
      mediaType: "application/json",
      sizeBytes: 10,
    },
    targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1",
    targetSettingsDigest: digest,
  });
  const request = asyncJobCreateRequestV1Schema.parse({
    contractVersion: 1,
    input,
    inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
    idempotencyKey: "synthetic-export-key",
  });
  const command = {
    request,
    preallocatedJobId: asyncJobIdSchema.parse("job.export"),
    inputDigest: getAsyncJobInputDigestV1(input),
    idempotency: asyncJobIdempotencyClaimV1Schema.parse({
      actorId: "principal.export",
      keyDigest: getAsyncJobIdempotencyKeyDigestV1(request.idempotencyKey),
      requestDigest: getAsyncJobCreateRequestDigestV1(request),
      operationId: "job.create",
    }),
  };
  const clock = new MutableJobClock(at);
  const repository = new InMemoryJobRepository();
  const ids = new SequentialJobIdGenerator();
  const queue = new InMemoryFifoJobQueue(ids);
  const publish = vi.fn<(envelope: AsyncJobQueueEnvelopeV1) => Promise<void>>(
    () => Promise.resolve(),
  );
  vi.spyOn(queue, "publish").mockImplementation(publish);
  const publisher = { contractVersion: 1 as const, publish };
  const dependencies = {
    clock,
    repository,
    ...(transport === "publisher" ? { publisher } : { queue }),
    ids,
    entitlement: new AllowAllJobEntitlementPort(),
    audit: new InMemoryJobAuditPort(),
  };
  const job = createAsyncJobRecordV1({
    context,
    createdAt: at,
    input,
    inputSizeBytes: request.inputSizeBytes,
    inputDigest: command.inputDigest,
    idempotency: command.idempotency,
    jobId: command.preallocatedJobId,
    reservation: { state: "none" },
  }).job;
  return { command, context, job, dependencies, publish };
}
describe.each(["queue", "publisher"] as const)(
  "mandatory export dispatch readiness through %s",
  (transport) => {
    it("commits genuine admission but does not immediately dispatch or reconcile without readiness", async () => {
      const f = fixture(transport);
      const service = new JobService(f.dependencies);
      expect((await service.create(f.context, f.command)).kind).toBe("created");
      expect(await f.dependencies.repository.get(f.job.jobId)).not.toBeNull();
      expect(
        await service.reconcileQueuedPublications({
          ...f.context,
          actor: { kind: "system", reason: "scheduler" },
        }),
      ).toBe(0);
      expect(f.publish).not.toHaveBeenCalled();
    });
    it("reconciles only after readiness, without repeating admission", async () => {
      const f = fixture(transport);
      let ready = false;
      const gate = { isReady: vi.fn(() => Promise.resolve(ready)) };
      const service = new JobService({
        ...f.dependencies,
        publicationReadiness: gate,
      });
      await service.create(f.context, f.command);
      expect(f.publish).not.toHaveBeenCalled();
      ready = true;
      expect(
        await service.reconcileQueuedPublications({
          ...f.context,
          actor: { kind: "system", reason: "scheduler" },
        }),
      ).toBe(1);
      expect(f.publish).toHaveBeenCalledTimes(1);
      expect((await service.create(f.context, f.command)).kind).toBe(
        "duplicate",
      );
      expect(f.publish).toHaveBeenCalledTimes(1);
    });
    it("never publishes if readiness throws", async () => {
      const f = fixture(transport);
      await new JobService(f.dependencies).create(f.context, f.command);
      await expect(
        publishReadyJobEnvelope(
          {
            ...f.dependencies,
            publicationReadiness: {
              isReady: () => Promise.reject(new Error("Synthetic unavailable")),
            },
          },
          deriveAsyncJobQueueEnvelopeV1(f.job),
        ),
      ).rejects.toThrow("Synthetic unavailable");
      expect(f.publish).not.toHaveBeenCalled();
    });
    it.each(["changed", "missing", "expired"])(
      "rereads after readiness and denies %s state",
      async (change) => {
        const f = fixture(transport);
        await new JobService(f.dependencies).create(f.context, f.command);
        const get = vi.spyOn(f.dependencies.repository, "get");
        const before = await f.dependencies.repository.get(f.job.jobId);
        if (before === null) throw new Error("Expected real admission.");
        get.mockResolvedValueOnce(before).mockResolvedValueOnce(
          change === "missing"
            ? null
            : {
                ...before,
                ...(change === "changed"
                  ? { recordVersion: before.recordVersion + 1 }
                  : { expiresAt: before.createdAt }),
              },
        );
        expect(
          await publishReadyJobEnvelope(
            {
              ...f.dependencies,
              publicationReadiness: { isReady: () => Promise.resolve(true) },
            },
            deriveAsyncJobQueueEnvelopeV1(before),
          ),
        ).toBe(false);
        expect(f.publish).not.toHaveBeenCalled();
      },
    );
  },
);

describe("exclusive versioned publication transport", () => {
  it("preserves a real legacy queue and never fabricates consumer methods on a publisher", () => {
    const queue = new InMemoryFifoJobQueue(new SequentialJobIdGenerator());
    const publisher = {
      contractVersion: 1 as const,
      publish: () => Promise.resolve(),
    };
    expect(selectJobPublicationTransportV1({ queue })).toEqual({ queue });
    expect(selectJobPublicationTransportV1({ publisher })).toEqual({
      publisher,
    });
    expect("queue" in selectJobPublicationTransportV1({ publisher })).toBe(
      false,
    );
    expect("receive" in publisher).toBe(false);
  });
  it.each([
    {},
    { queue: undefined },
    { publisher: undefined },
    { queue: { publish: () => Promise.resolve() } },
    { publisher: { contractVersion: 2, publish: () => Promise.resolve() } },
    { publisher: { contractVersion: 1 } },
  ])("rejects missing, partial or unsupported transports: %j", (input) => {
    expect(() => selectJobPublicationTransportV1(input)).toThrow(
      expect.objectContaining({ code: "job.publication-transport-invalid" }),
    );
  });
  it("rejects both properties even if one is undefined, before any construction effects", () => {
    const f = fixture("publisher");
    const before = vi.spyOn(f.dependencies.ids, "nextId");
    // Model untyped host configuration without weakening the declared union.
    const input = { ...f.dependencies };
    Object.defineProperty(input, "queue", { value: undefined });
    expect(() => new JobService(input)).toThrow(
      expect.objectContaining({ code: "job.publication-transport-invalid" }),
    );
    expect(before).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  });
  it("does not evaluate accessor-supplied transports", () => {
    const read = vi.fn(() => ({
      contractVersion: 1,
      publish: () => Promise.resolve(),
    }));
    const input = Object.defineProperty({}, "publisher", { get: read });
    expect(() => selectJobPublicationTransportV1(input)).toThrow(
      expect.objectContaining({ code: "job.publication-transport-invalid" }),
    );
    expect(read).not.toHaveBeenCalled();
  });
});
