import {
  createAsyncJobRecordV1,
  getAsyncJobCreateRequestDigestV1,
  getAsyncJobIdempotencyKeyDigestV1,
  getAsyncJobInputDigestV1,
  getAsyncJobInputSizeBytesV1,
} from "@cloudmarkup/domain";
import {
  AllowAllJobEntitlementPort,
  DefaultJobFailureClassifier,
  IdempotentFakeReservationPort,
  InMemoryFifoJobQueue,
  InMemoryJobAuditPort,
  InMemoryJobHandlerRegistry,
  InMemoryJobOrchestrationDecisionPort,
  InMemoryJobRepository,
  JobService,
  JobWorker,
  SequentialJobIdGenerator,
  type JobHandlerContextV1,
} from "@cloudmarkup/job-framework";
import {
  digestStructuredValue,
  reviewedModelPromptRegistry,
  serializedByteLength,
  type ModelGateway,
  type ModelRuntimeControlServiceV1,
  type ModelRuntimeSanitizedOutputEvidenceV1,
  type ModelCommercialInvocationContextV1,
} from "@cloudmarkup/model-gateway";
import {
  modelTestRequests,
  modelTestContext,
  deterministicFakeProviderProfileV1,
  deterministicFakeRoutingV1,
  testIntent,
} from "@cloudmarkup/model-gateway/testing";
import {
  asyncJobIdSchema,
  asyncJobCreateRequestV1Schema,
  asyncJobInputV1Schema,
  asyncJobRecordV1Schema,
  asyncJobTrustedContextV1Schema,
  modelGatewayResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  normalizedModelUsageV1Schema,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";
import { createProductionAiIntentJobHandler } from "./production-ai-intent.js";
import {
  ProductionAiIntentJobHandler,
  type ProductionAiIntentHost,
  type ProductionAiIntentResolvedInput,
} from "./production-ai-intent-handler.js";
import {
  invocationFixture,
  syntheticScope,
} from "./adapters/persistence/model-runtime-invocation-test-helpers.js";

const instant = "2026-09-06T12:00:00.000Z";
const later = "2026-09-06T12:05:00.000Z";

/** These are synthetic adapter orchestration tests, not evaluated production
 * admission fixtures. The runtime port records one canonical entry; the actual
 * ModelRuntimeControlService, workflow SQL and spending guard have their own
 * independently exercised authority/concurrency suites. No hold is promoted. */
function fixture(now: () => Date = () => new Date(instant)) {
  const model = modelTestRequests().find(
    (candidate) => candidate.operation === "intent.extract",
  );
  if (model?.operation !== "intent.extract")
    throw new Error("Missing synthetic Intent request.");
  const scope = syntheticScope;
  const prompt = reviewedModelPromptRegistry.get(model.operation);
  if (prompt === null) throw new Error("Missing reviewed prompt.");
  const context = { ...modelTestContext("intent-invocation"), scope };
  const original = invocationFixture(scope, context.invocationId).result;
  const route = {
    feature: model.operation,
    inferenceProfileId: undefined,
    modelId: original.descriptor.modelId,
    modelVersion: original.descriptor.modelVersion,
    outcome: "selected",
    providerId: original.descriptor.providerId,
    requestedMode: "guided",
    routeId: "standard-design",
  };
  const routingRequest = { environment: "production" };
  const inputDigest = digestStructuredValue({ request: model, scope });
  const source = {
    contractVersion: 1,
    purpose: "input-payload",
    objectId: "input-intent",
    digest: digestStructuredValue(model),
    mediaType: "application/json",
    sizeBytes: serializedByteLength(model),
    expiresAt: later,
  };
  const jobInput = asyncJobInputV1Schema.parse({
    contractVersion: 1,
    family: "intent-extraction",
    source,
    subject: {
      kind: "draft",
      draftId: "draft_intent",
      draftVersion: 1,
      etag: '"draft-intent-1"',
      contentDigest: digestStructuredValue("synthetic draft"),
    },
  });
  const trusted = asyncJobTrustedContextV1Schema.parse({
    actor: { kind: "principal", actorId: scope.userId },
    correlationId: "correlation-intent",
    ownership: {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
    },
  });
  const queued = createAsyncJobRecordV1({
    context: trusted,
    createdAt: instant,
    expiresAt: later,
    idempotency: {
      actorId:
        trusted.actor.kind === "principal" ? trusted.actor.actorId : "invalid",
      keyDigest: context.idempotencyKeyDigest,
      operationId: "cloudmarkup.intent.extract" as never,
      requestDigest: inputDigest,
    },
    input: jobInput,
    inputDigest: getAsyncJobInputDigestV1(jobInput),
    inputSizeBytes: getAsyncJobInputSizeBytesV1(jobInput),
    jobId: asyncJobIdSchema.parse(scope.jobId),
    reservation: { state: "none" },
  }).job;
  const job = asyncJobRecordV1Schema.parse({
    ...queued,
    state: "running",
    startedAt: instant,
    attempts: [
      {
        attemptId: "attempt-intent",
        attemptNumber: 1,
        runtimeSeconds: 0,
        startedAt: instant,
        state: "running",
        lease: {
          heartbeatAt: instant,
          leaseExpiresAt: later,
          workerId: "worker-intent",
        },
      },
    ],
  });
  const descriptor = modelInvocationDescriptorV1Schema.parse({
    ...original.descriptor,
    budgetDecisionId: context.budget.decisionId,
    entitlementDecisionId: context.entitlement.decisionId,
    feature: model.operation,
    idempotencyKeyDigest: context.idempotencyKeyDigest,
    inputDigest,
    promptDigest: prompt.digest,
    promptTemplateId: prompt.templateId,
    promptVersion: prompt.version,
    routing: {
      ...original.descriptor.routing,
      routingDecisionDigest: digestStructuredValue(route),
    },
  });
  const response = modelGatewayResponseV1Schema.parse({
    contractVersion: 1,
    proposalContext: original.response.proposalContext,
    operation: "intent.extract",
    intentDocument: testIntent,
    provenance: {
      ...original.response.provenance,
      inputDigest,
      promptDigest: prompt.digest,
      promptTemplateId: prompt.templateId,
      promptVersion: prompt.version,
    },
  });
  const result = {
    ...original,
    descriptor,
    response,
    usage: normalizedModelUsageV1Schema.parse({
      ...original.usage,
      feature: model.operation,
      idempotencyKeyDigest: context.idempotencyKeyDigest,
      inputDigest,
      promptTemplateId: prompt.templateId,
      promptVersion: prompt.version,
      routing: descriptor.routing,
    }),
  };
  const commercialRequest = {
    feature: model.operation,
    jobId: job.jobId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    environment: "production",
    requestedRoute: "standard",
    promptId: prompt.templateId,
    promptVersion: prompt.version,
    multiCallWorkflowId: "workflow-intent",
    reservationId: "reservation-intent",
  };
  const resolved = {
    modelRequest: model,
    context: { ...context, routingDecision: route, routingRequest },
    runtime: {
      commercialRequest,
      promptTemplateDigest: prompt.digest,
      routingDecision: route,
      routingRequest,
      admissionRequest: {
        executionClass: "normal",
        operation: model.operation,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        userId: scope.userId,
        inputDigest,
      },
      inputEvidence: { inputDigest },
    },
  } as unknown as ProductionAiIntentResolvedInput;
  const output = {
    outputDigest: digestStructuredValue(result.response),
    outputBytes: serializedByteLength(result.response),
    outputTokens: Number(result.usage.outputUnits),
  } as ModelRuntimeSanitizedOutputEvidenceV1;
  const commercial = {
    reservationAccepted: true,
    denialReason: null,
    state: "completed",
  };
  const callback = {
    route: {
      route: "standard",
      routeId: route.routeId,
      modelId: route.modelId,
      modelVersion: route.modelVersion,
      inferenceProfileId: undefined,
      providerKey: route.providerId,
    },
  } as unknown as ModelCommercialInvocationContextV1;
  let terminal:
    Awaited<ReturnType<ModelRuntimeControlServiceV1["execute"]>> | undefined;
  let entered = false;
  const runtime = vi
    .fn<ModelRuntimeControlServiceV1["execute"]>()
    .mockImplementation(async (_input, invoke) => {
      if (terminal !== undefined) return { ...terminal, replayed: true };
      if (entered) throw new Error("Synthetic duplicate in progress.");
      entered = true;
      const invoked = await invoke({
        commercial: callback,
        inputEvidence: resolved.runtime.inputEvidence,
      });
      terminal = {
        admission: { outcome: "allowed" },
        commercial,
        output: invoked.output,
        replayed: false,
      } as Awaited<ReturnType<ModelRuntimeControlServiceV1["execute"]>>;
      return terminal;
    });
  const gateway = vi.fn<ModelGateway["invoke"]>().mockResolvedValue(result);
  const authorize = vi
    .fn<ProductionAiIntentHost["authorize"]>()
    .mockResolvedValue();
  const resolve = vi
    .fn<ProductionAiIntentHost["resolve"]>()
    .mockResolvedValue(resolved);
  const issue = vi
    .fn<ProductionAiIntentHost["issueOutputEvidence"]>()
    .mockResolvedValue(output);
  const publish = vi.fn<ProductionAiIntentHost["publish"]>().mockResolvedValue({
    contractVersion: 1,
    purpose: "proposal",
    objectId: "proposal-intent",
    digest: output.outputDigest,
    sizeBytes: output.outputBytes,
    mediaType: "application/json",
    expiresAt: later as never,
  });
  const load = vi.fn().mockResolvedValue(result);
  const cancellation = vi.fn().mockResolvedValue(false);
  const handlerContext: JobHandlerContextV1 = {
    jobId: job.jobId,
    ownership: job.ownership,
    correlationId: job.correlationId,
    attemptNumber: 1,
    checkpoint: undefined,
    heartbeat: vi.fn().mockResolvedValue(undefined),
    isCancellationRequested: cancellation,
    reportProgress: vi.fn().mockResolvedValue(undefined),
    saveCheckpoint: vi.fn().mockResolvedValue(undefined),
  };
  const handler = new ProductionAiIntentJobHandler({
    host: { authorize, resolve, issueOutputEvidence: issue, publish },
    gateway: { invoke: gateway } as unknown as ModelGateway,
    runtime: { execute: runtime },
    results: { loadCompleted: load },
    usage: { listByInvocationId: () => Promise.resolve([result.usage]) },
    scope,
    now,
  });
  return {
    handler,
    queued,
    trusted,
    job,
    handlerContext,
    resolved,
    runtime,
    gateway,
    authorize,
    resolve,
    issue,
    publish,
    load,
    cancellation,
    result,
    output,
    commercial,
  };
}

async function workerFixture() {
  const f = fixture(() => new Date());
  const clock = { now: () => new Date() };
  const audit = new InMemoryJobAuditPort();
  const ids = new SequentialJobIdGenerator("intent-worker");
  const queue = new InMemoryFifoJobQueue(ids);
  const repository = new InMemoryJobRepository();
  const reservation = new IdempotentFakeReservationPort();
  const service = new JobService({
    audit,
    clock,
    ids,
    queue,
    repository,
    reservation,
    entitlement: new AllowAllJobEntitlementPort(),
  });
  const worker = new JobWorker({
    audit,
    clock,
    ids,
    queue,
    repository,
    failureClassifier: new DefaultJobFailureClassifier(),
    handlers: new InMemoryJobHandlerRegistry([f.handler]),
    orchestration: new InMemoryJobOrchestrationDecisionPort(),
  });
  const request = asyncJobCreateRequestV1Schema.parse({
    contractVersion: 1,
    idempotencyKey: "intent-worker-request",
    input: f.queued.input,
    inputSizeBytes: f.queued.inputSizeBytes,
  });
  const created = await service.create(f.trusted, {
    request,
    inputDigest: f.queued.inputDigest,
    preallocatedJobId: f.queued.jobId,
    expiresAt: later,
    reservationRequested: false,
    idempotency: {
      ...f.queued.idempotency,
      keyDigest: getAsyncJobIdempotencyKeyDigestV1(request.idempotencyKey),
      requestDigest: getAsyncJobCreateRequestDigestV1(request),
    },
  });
  expect(created.kind).toBe("created");
  return { ...f, worker, service, repository, reservation };
}

describe("runtime-aware production Intent job composition", () => {
  it("constructs the concrete host without SQL, evidence issuance, accounting, credentials or HTTP I/O", async () => {
    const f = fixture();
    const unexpected = vi.fn((): Promise<never> =>
      Promise.reject(
        new Error("No dependency may perform work during construction."),
      ),
    );
    const input = {
      database: {
        close: unexpected,
        query: unexpected,
        transaction: unexpected,
      },
      scope: syntheticScope,
      host: {
        authorize: unexpected,
        resolve: f.resolve,
        issueOutputEvidence: f.issue,
        publish: f.publish,
      },
      resultObjects: { put: unexpected, get: unexpected },
      usage: { record: unexpected, listByInvocationId: unexpected },
      costs: { resolve: unexpected },
      httpHandler: { handle: unexpected },
      bedrock: {
        profile: {
          ...deterministicFakeProviderProfileV1,
          providerFamily: "amazon-bedrock" as const,
          providerId: "cloudmarkup.amazon-bedrock",
        },
        routes: [
          {
            enabled: true,
            invocationTarget: "cloudmarkup.fake-model",
            modelConfigurationReference: "cloudmarkup.fake-model.standard.v1",
            nativeStructuredOutputSupported: false,
            region: "us-east-1",
            supportedRegions: ["us-east-1"],
            transport: "converse" as const,
          },
        ],
      },
      gateway: {
        allowedApprovalPathIds: [],
        invalidProposalStore: { preserveRestricted: unexpected },
        logger: { write: () => undefined },
        routing: deterministicFakeRoutingV1,
      },
      runtime: {
        authorityResolver: { resolve: unexpected },
        commercial: { execute: unexpected, recover: unexpected },
        evidenceVerifier: {
          verify: unexpected,
          verifyInputEvidence: unexpected,
          verifyOperationalOutcome: unexpected,
        },
        store: {
          inspect: unexpected,
          claim: unexpected,
          assertExecutionLease: unexpected,
          checkpointPendingAndRelease: unexpected,
          completeAndRelease: unexpected,
          listPendingOutbox: unexpected,
          acknowledgeOutbox: unexpected,
          release: unexpected,
          readOperationalExecutionBinding: unexpected,
          appendOperationalOutbox: unexpected,
        },
        telemetry: { publish: unexpected },
      },
      now: () => new Date(instant),
    } satisfies Parameters<typeof createProductionAiIntentJobHandler>[0];
    const handler = createProductionAiIntentJobHandler(input);
    expect(handler).toBeInstanceOf(ProductionAiIntentJobHandler);
    expect(unexpected).not.toHaveBeenCalled();
    expect(await handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "failed",
      failure: { classification: "permanent" },
    });
    expect(unexpected).toHaveBeenCalledOnce(); // current host authorization denied first
    expect(f.resolve).not.toHaveBeenCalled();
    const unboundScope = {
      organizationId: syntheticScope.organizationId,
      projectId: syntheticScope.projectId,
      userId: syntheticScope.userId,
    };
    expect(() =>
      createProductionAiIntentJobHandler({ ...input, scope: unboundScope }),
    ).toThrow("verified project and job");
  });

  it("joins one admitted commercial callback and publishes the exact durable validated proposal", async () => {
    const f = fixture();
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "succeeded",
      output: { proposal: { digest: f.output.outputDigest } },
    });
    expect(f.runtime).toHaveBeenCalledOnce();
    expect(f.gateway).toHaveBeenCalledOnce();
    expect(f.load).toHaveBeenCalledOnce();
    expect(f.publish).toHaveBeenCalledOnce();
  });
  it("replays terminal runtime and durable result without another invocation", async () => {
    const f = fixture();
    await f.handler.execute(f.job, f.handlerContext);
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "succeeded",
    });
    expect(f.gateway).toHaveBeenCalledOnce();
    expect(f.issue).toHaveBeenCalledOnce();
    expect(f.load).toHaveBeenCalledTimes(2);
  });
  it("rejects an in-progress duplicate without a second invocation", async () => {
    const f = fixture();
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.issue.mockImplementation(async () => {
      started?.();
      await gate;
      return f.output;
    });
    const first = f.handler.execute(f.job, f.handlerContext);
    await began;
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "failed",
    });
    finish?.();
    expect(await first).toMatchObject({ outcome: "succeeded" });
    expect(f.gateway).toHaveBeenCalledOnce();
  });
  it("retries failed publication without another model call or credit entry", async () => {
    const f = fixture();
    f.publish.mockRejectedValueOnce(new Error("Synthetic store unavailable."));
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "failed",
    });
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "succeeded",
    });
    expect(f.gateway).toHaveBeenCalledOnce();
  });
  it("denies an already reserved job before entering runtime", async () => {
    const f = fixture();
    const job = {
      ...f.job,
      reservation: { state: "reserved", reservationId: "other-reservation" },
    } as AsyncJobRecordV1;
    expect(await f.handler.execute(job, f.handlerContext)).toMatchObject({
      outcome: "failed",
      failure: { classification: "permanent" },
    });
    expect(f.runtime).not.toHaveBeenCalled();
    expect(f.gateway).not.toHaveBeenCalled();
  });
  it.each([
    "organization",
    "project",
    "principal",
    "job",
    "input",
    "evaluation",
  ])("rejects substituted %s authority before runtime", async (kind) => {
    const f = fixture();
    const resolved = structuredClone(f.resolved);
    if (kind === "organization")
      Object.assign(resolved.context.scope, { organizationId: "other-org" });
    if (kind === "project")
      Object.assign(resolved.context.scope, { projectId: "other-project" });
    if (kind === "principal")
      Object.assign(resolved.context.scope, { userId: "other-user" });
    if (kind === "job")
      Object.assign(resolved.context.scope, { jobId: "other-job" });
    if (kind === "input")
      Object.assign(resolved.modelRequest, { requestedMode: "professional" });
    if (kind === "evaluation")
      Object.assign(resolved.runtime.admissionRequest, {
        executionClass: "live-evaluation",
      });
    f.resolve.mockResolvedValue(resolved);
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "failed",
    });
    expect(f.runtime).not.toHaveBeenCalled();
  });
  it("does not call the model or publish when canonical credits deny admission", async () => {
    const f = fixture();
    f.runtime.mockResolvedValue({
      admission: { outcome: "denied" },
      commercial: {
        reservationAccepted: false,
        denialReason: "insufficient-credits",
        state: "reservation-denied",
      },
      output: null,
      replayed: false,
    } as Awaited<ReturnType<ModelRuntimeControlServiceV1["execute"]>>);
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "failed",
    });
    expect(f.gateway).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  });
  it("retains uncertain execution for recovery and never publishes pending accounting", async () => {
    const f = fixture();
    f.commercial.state = "reconciliation-required";
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "failed",
      failure: { classification: "transient" },
    });
    expect(f.publish).not.toHaveBeenCalled();
  });
  it("fails closed when access is revoked before invocation", async () => {
    const f = fixture();
    f.authorize
      .mockResolvedValueOnce()
      .mockRejectedValue(new Error("Synthetic denied."));
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "failed",
    });
    expect(f.gateway).not.toHaveBeenCalled();
  });
  it("fails closed when access is revoked after result-object I/O", async () => {
    const f = fixture();
    f.load.mockImplementation(() => {
      f.authorize.mockRejectedValue(new Error("Synthetic denied."));
      return Promise.resolve(f.result);
    });
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "failed",
    });
    expect(f.publish).not.toHaveBeenCalled();
  });
  it("rejects a substituted durable replay result", async () => {
    const f = fixture();
    f.load.mockResolvedValue({
      ...f.result,
      descriptor: {
        ...f.result.descriptor,
        scope: { ...f.result.descriptor.scope, organizationId: "other-org" },
      },
    });
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "failed",
    });
    expect(f.publish).not.toHaveBeenCalled();
  });
  it("rejects a mismatched host output digest before settlement or publication", async () => {
    const f = fixture();
    f.issue.mockResolvedValue({
      ...f.output,
      outputDigest: digestStructuredValue("different"),
    });
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "failed",
    });
    expect(f.publish).not.toHaveBeenCalled();
  });
  it("rejects a wrong proposal reference returned from publication", async () => {
    const f = fixture();
    f.publish.mockResolvedValue({
      contractVersion: 1,
      purpose: "proposal",
      objectId: "wrong",
      digest: digestStructuredValue("wrong"),
      sizeBytes: 1,
      mediaType: "application/json",
    });
    expect(await f.handler.execute(f.job, f.handlerContext)).toMatchObject({
      outcome: "failed",
    });
  });
  it("cancels before input, runtime or provider activity", async () => {
    const f = fixture();
    f.cancellation.mockResolvedValue(true);
    expect(await f.handler.execute(f.job, f.handlerContext)).toEqual({
      outcome: "canceled",
    });
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.runtime).not.toHaveBeenCalled();
  });

  it("renews the real worker's default 30s lease through a 70s model call and stops before completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);
    try {
      const f = await workerFixture();
      let started: (() => void) | undefined;
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      f.gateway.mockImplementation(async () => {
        started?.();
        await new Promise((resolve) => setTimeout(resolve, 70_000));
        return f.result;
      });
      const running = f.worker.runNext("worker-intent"); // unchanged default lease
      await began;
      await vi.advanceTimersByTimeAsync(35_000);
      const active = await f.repository.get(f.job.jobId);
      expect(active?.state).toBe("running");
      expect(
        Date.parse(active?.attempts.at(-1)?.lease?.leaseExpiresAt ?? ""),
      ).toBeGreaterThan(Date.now());
      expect(f.publish).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(35_000);
      expect(await running).toMatchObject({ state: "succeeded" });
      expect(f.gateway).toHaveBeenCalledOnce();
      expect(f.publish).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      const completed = await f.repository.get(f.job.jobId);
      await vi.advanceTimersByTimeAsync(40_000);
      expect(await f.repository.get(f.job.jobId)).toEqual(completed);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts a running provider on real job cancellation and publishes nothing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);
    try {
      const f = await workerFixture();
      let started: (() => void) | undefined;
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      let signal: AbortSignal | undefined;
      f.gateway.mockImplementation((_request, _context, options) => {
        signal = options;
        started?.();
        return new Promise((_resolve, reject) =>
          signal?.addEventListener(
            "abort",
            () => {
              reject(new Error("Synthetic abort."));
            },
            { once: true },
          ),
        );
      });
      const running = f.worker.runNext("worker-intent");
      await began;
      await vi.advanceTimersByTimeAsync(5_000);
      await f.service.cancel(f.trusted, f.job.jobId);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await running).toMatchObject({ state: "canceled" });
      expect(signal?.aborted).toBe(true);
      expect(f.publish).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on a real worker renewal write failure even if the provider ignores abort and returns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);
    try {
      const f = await workerFixture();
      let started: (() => void) | undefined;
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      let signal: AbortSignal | undefined;
      f.gateway.mockImplementation(async (_request, _context, options) => {
        signal = options;
        started?.();
        await new Promise((resolve) => setTimeout(resolve, 12_000));
        return f.result;
      });
      const running = f.worker.runNext("worker-intent");
      await began;
      vi.spyOn(f.repository, "saveWithAudit").mockRejectedValueOnce(
        new Error("Synthetic renewal write failure."),
      );
      await vi.advanceTimersByTimeAsync(12_000);
      expect(await running).toMatchObject({
        state: "queued",
        attempts: [{ state: "failed" }],
      });
      expect(signal?.aborted).toBe(true);
      expect(f.publish).not.toHaveBeenCalled();
      expect(f.issue).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not overlap a stalled heartbeat and aborts at the known lease expiry without waiting for that I/O", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(instant);
    try {
      const f = fixture(() => new Date());
      const job = asyncJobRecordV1Schema.parse({
        ...f.job,
        attempts: f.job.attempts.map((attempt) => ({
          ...attempt,
          lease: {
            ...attempt.lease,
            leaseExpiresAt: "2026-09-06T12:00:30.000Z",
          },
        })),
      });
      let release: (() => void) | undefined;
      const pendingHeartbeat = new Promise<void>((resolve) => {
        release = resolve;
      });
      const heartbeat = vi.fn(() => pendingHeartbeat);
      let started: (() => void) | undefined;
      const began = new Promise<void>((resolve) => {
        started = resolve;
      });
      let signal: AbortSignal | undefined;
      f.gateway.mockImplementation((_request, _context, incomingSignal) => {
        signal = incomingSignal;
        started?.();
        return new Promise((_resolve, reject) =>
          signal?.addEventListener(
            "abort",
            () => {
              reject(new Error("Synthetic abort."));
            },
            { once: true },
          ),
        );
      });
      const running = f.handler.execute(job, {
        ...f.handlerContext,
        heartbeat,
      });
      await began;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(heartbeat).toHaveBeenCalledOnce();
      expect(signal?.aborted).toBe(true);
      expect(f.publish).not.toHaveBeenCalled();
      release?.();
      expect(await running).toMatchObject({ outcome: "failed" });
      expect(f.issue).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
