import {
  asyncJobAttemptIdSchema,
  asyncJobCheckpointV1Schema,
  asyncJobCreateRequestV1Schema,
  asyncJobHandlerOutcomeV1Schema,
  asyncJobIdSchema,
  asyncJobIdempotencyClaimV1Schema,
  asyncJobInputV1Schema,
  asyncJobLimitsV1Schema,
  asyncJobObjectReferenceV1Schema,
  namespacedIdentifierSchema,
  asyncJobReservationLinkV1Schema,
  asyncJobTrustedContextV1Schema,
  asyncJobWorkerIdSchema,
  type AsyncJobInputV1,
  type AsyncJobLimitsV1,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  AsyncJobLifecycleError,
  DEFAULT_ASYNC_JOB_LIMITS_V1,
  applyAsyncJobLifecycleCommandV1,
  cancelAsyncJobChildFromParentV1,
  cancelAsyncJobForProjectDeletionV1,
  createAsyncJobFailureV1,
  createAsyncJobRecordV1,
  deriveAsyncJobQueueEnvelopeV1,
  deriveAsyncJobStatusViewV1,
  evaluateAsyncJobChildrenV1,
  failAsyncJobParentFromChildrenV1,
  getAsyncJobCreateRequestDigestV1,
  getAsyncJobIdempotencyKeyDigestV1,
  getAsyncJobInputDigestV1,
  getAsyncJobInputSizeBytesV1,
  getAsyncJobRetryDelaySecondsV1,
  sanitizeUnknownAsyncJobFailureV1,
} from "./async-job-lifecycle.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const createdAt = "2026-08-15T12:00:00Z";
const organizationId = "organization-1";
const projectId = "project-1";

function objectReference(
  objectId: string,
  purpose:
    | "build-output"
    | "checkpoint-state"
    | "evidence"
    | "input-payload"
    | "proposal",
  sizeBytes = 64,
  expiresAt?: string,
) {
  return asyncJobObjectReferenceV1Schema.parse({
    contractVersion: 1,
    digest: digestA,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    mediaType: "application/json",
    objectId,
    purpose,
    sizeBytes,
  });
}

function revisionInput(
  solutionRevisionId = "solution-revision-1",
): AsyncJobInputV1 {
  return asyncJobInputV1Schema.parse({
    compilerTargetId: "cloudmarkup.compiler.terraform",
    contractVersion: 1,
    environment: {
      environmentId: "environment-test",
      environmentType: "test",
    },
    family: "iac-compilation",
    subject: {
      kind: "solution-revision",
      manifestDigest: digestA,
      manifestRecordId: `manifest-${solutionRevisionId}`,
      solutionRevisionId,
    },
  });
}

function draftInput(version = 1): AsyncJobInputV1 {
  return asyncJobInputV1Schema.parse({
    contractVersion: 1,
    family: "intent-extraction",
    source: objectReference("input-1", "input-payload"),
    subject: {
      contentDigest: digestA,
      draftId: "draft-1",
      draftVersion: version,
      etag: `"draft-${String(version)}"`,
      kind: "draft",
    },
  });
}

interface CreateOptions {
  readonly createdAt?: string;
  readonly expiresAt?: string;
  readonly expectedChildJobIds?: readonly string[];
  readonly failurePolicy?:
    "cancel-remaining" | "continue-and-report" | "fail-parent";
  readonly input?: AsyncJobInputV1;
  readonly jobId?: string;
  readonly limits?: Partial<AsyncJobLimitsV1>;
  readonly organizationId?: string;
  readonly parentJobId?: string;
  readonly projectId?: string;
  readonly rootJobId?: string;
}

function createJob(options: CreateOptions = {}): AsyncJobRecordV1 {
  const input = options.input ?? revisionInput();
  const jobId = asyncJobIdSchema.parse(options.jobId ?? "job-1");
  const context = asyncJobTrustedContextV1Schema.parse({
    actor: { actorId: "actor-1", kind: "principal" },
    correlationId: "correlation-1",
    ownership: {
      organizationId: options.organizationId ?? organizationId,
      ...(input.subject.kind === "organization"
        ? {}
        : { projectId: options.projectId ?? projectId }),
    },
  });
  const limits = asyncJobLimitsV1Schema.parse({
    ...DEFAULT_ASYNC_JOB_LIMITS_V1,
    ...options.limits,
  });
  return createAsyncJobRecordV1({
    context,
    createdAt: options.createdAt ?? createdAt,
    ...(options.expiresAt === undefined
      ? {}
      : { expiresAt: options.expiresAt }),
    idempotency: asyncJobIdempotencyClaimV1Schema.parse({
      actorId: "actor-1",
      keyDigest: digestA,
      operationId: "cloudmarkup.job.create",
      requestDigest: digestB,
    }),
    input,
    inputDigest: getAsyncJobInputDigestV1(input),
    inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
    jobId,
    limits,
    orchestration: {
      expectedChildJobIds: (options.expectedChildJobIds ?? []).map(
        (childJobId) => asyncJobIdSchema.parse(childJobId),
      ),
      failurePolicy: options.failurePolicy ?? "fail-parent",
      ...(options.parentJobId === undefined
        ? {}
        : { parentJobId: asyncJobIdSchema.parse(options.parentJobId) }),
      ...(options.rootJobId === undefined
        ? {}
        : { rootJobId: asyncJobIdSchema.parse(options.rootJobId) }),
    },
    reservation: asyncJobReservationLinkV1Schema.parse({ state: "none" }),
  }).job;
}

describe("Async Job v1 idempotency digests", () => {
  it("hashes the validated raw idempotency key as UTF-8", () => {
    expect(getAsyncJobIdempotencyKeyDigestV1("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(() =>
      getAsyncJobIdempotencyKeyDigestV1(" contains spaces "),
    ).toThrow();
  });

  it("hashes the canonical validated create request", () => {
    const input = revisionInput();
    const request = asyncJobCreateRequestV1Schema.parse({
      contractVersion: 1,
      idempotencyKey: "abc",
      input,
      inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
    });
    const reorderedRequest = asyncJobCreateRequestV1Schema.parse({
      inputSizeBytes: request.inputSizeBytes,
      input: request.input,
      idempotencyKey: request.idempotencyKey,
      contractVersion: request.contractVersion,
    });

    expect(getAsyncJobCreateRequestDigestV1(request)).toBe(
      "sha256:0d425330eb50958364b4e8bf6942827bd4bb2060303d50fc3697b3c714b89f0b",
    );
    expect(getAsyncJobCreateRequestDigestV1(reorderedRequest)).toBe(
      getAsyncJobCreateRequestDigestV1(request),
    );
    expect(
      getAsyncJobCreateRequestDigestV1({
        ...request,
        idempotencyKey: "different-key",
      }),
    ).not.toBe(getAsyncJobCreateRequestDigestV1(request));
    expect(() =>
      getAsyncJobCreateRequestDigestV1({
        ...request,
        inputSizeBytes: -1,
      }),
    ).toThrow();
  });
});

function commandAuthority(job: AsyncJobRecordV1, at: string) {
  return {
    at,
    expectedInputDigest: job.inputDigest,
    expectedRecordVersion: job.recordVersion,
  };
}

function parentCancellationAuthority(
  parent: AsyncJobRecordV1,
  child: AsyncJobRecordV1,
  at: string,
) {
  return {
    ...commandAuthority(child, at),
    childJobId: child.jobId,
    expectedParentInputDigest: parent.inputDigest,
    expectedParentRecordVersion: parent.recordVersion,
  };
}

function principalContext(
  job: AsyncJobRecordV1,
  scopedOrganizationId: string = job.ownership.organizationId,
) {
  return asyncJobTrustedContextV1Schema.parse({
    actor: { actorId: "actor-1", kind: "principal" },
    correlationId: job.correlationId,
    ownership: {
      organizationId: scopedOrganizationId,
      ...(job.ownership.projectId === undefined
        ? {}
        : { projectId: job.ownership.projectId }),
    },
  });
}

function handlerFor(
  job: AsyncJobRecordV1,
  resumePolicy:
    | "checkpoint-required"
    | "restart-from-input"
    | "not-resumable" = "restart-from-input",
) {
  return {
    family: job.family,
    handlerId: namespacedIdentifierSchema.parse("cloudmarkup.handler.fake"),
    handlerVersion: "1.0.0",
    resumePolicy,
  };
}

function claim(
  job: AsyncJobRecordV1,
  at = "2026-08-15T12:00:01Z",
  leaseExpiresAt = "2026-08-15T12:05:00Z",
  resumedFrom?: {
    readonly checkpointId: ReturnType<
      typeof asyncJobCheckpointV1Schema.parse
    >["checkpointId"];
    readonly interactionId?: string;
  },
  resumePolicy:
    | "checkpoint-required"
    | "restart-from-input"
    | "not-resumable" = resumedFrom === undefined
    ? "restart-from-input"
    : "checkpoint-required",
) {
  return applyAsyncJobLifecycleCommandV1(job, {
    ...commandAuthority(job, at),
    attemptId: asyncJobAttemptIdSchema.parse(
      `attempt-${String(job.attempts.length + 1)}`,
    ),
    dependencies: [],
    handler: handlerFor(job, resumePolicy),
    kind: "claim",
    leaseExpiresAt,
    ...(resumedFrom === undefined ? {} : { resumedFrom }),
    workerId: asyncJobWorkerIdSchema.parse("worker-1"),
  }).job;
}

function exactEvidenceOutput(
  options: {
    readonly artifactExpiresAt?: string;
    readonly artifactSize?: number;
    readonly evidenceRevisionId?: string;
  } = {},
) {
  const artifactSize = options.artifactSize ?? 128;
  return asyncJobHandlerOutcomeV1Schema.parse({
    outcome: "succeeded",
    output: {
      compiledInfrastructure: {
        artifactId: "artifact-iac-1",
        availability: { state: "available" },
        object: objectReference(
          "artifact-object-1",
          "build-output",
          artifactSize,
          options.artifactExpiresAt,
        ),
      },
      contractVersion: 1,
      evidenceRecords: [
        {
          environment: {
            environmentId: "environment-test",
            environmentType: "test",
          },
          evidenceId: "evidence-1",
          record: objectReference("evidence-object-1", "evidence"),
          solutionRevisionId:
            options.evidenceRevisionId ?? "solution-revision-1",
        },
      ],
      family: "iac-compilation",
    },
    outputSizeBytes: artifactSize + 64,
  });
}

function complete(
  job: AsyncJobRecordV1,
  outcome: unknown,
  at = "2026-08-15T12:01:00Z",
  resumePolicy:
    "checkpoint-required" | "restart-from-input" | "not-resumable" = outcome !==
    null &&
  typeof outcome === "object" &&
  (outcome as { readonly outcome?: unknown }).outcome === "awaiting-user-input"
    ? "checkpoint-required"
    : "restart-from-input",
) {
  const attempt = job.attempts[job.attempts.length - 1];
  if (attempt === undefined) {
    throw new Error("Test fixture requires an attempt.");
  }
  return applyAsyncJobLifecycleCommandV1(job, {
    ...commandAuthority(job, at),
    attemptId: attempt.attemptId,
    handler: handlerFor(job, resumePolicy),
    kind: "complete-attempt",
    outcome,
    workerId: asyncJobWorkerIdSchema.parse("worker-1"),
  });
}
function failureOutcome(
  kind: "handler-permanent-failure" | "handler-transient-failure",
) {
  return asyncJobHandlerOutcomeV1Schema.parse({
    failure: createAsyncJobFailureV1(kind),
    outcome: "failed",
  });
}

function lifecycleCodes(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof AsyncJobLifecycleError) {
      return error.issues.map((issue) => issue.code);
    }
    throw error;
  }
  throw new Error("Expected an AsyncJobLifecycleError.");
}

describe("Async Job v1 creation and authority", () => {
  it("creates a bounded queued record and queue envelope without mutating input", () => {
    const input = revisionInput();
    const before = JSON.stringify(input);
    const job = createJob({ input });

    expect(job.state).toBe("queued");
    expect(job.inputDigest).toBe(getAsyncJobInputDigestV1(input));
    expect(job.input.subject).toEqual(input.subject);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("reconstructs the exact queued delivery envelope after publish loss", () => {
    const creation = createAsyncJobRecordV1({
      context: asyncJobTrustedContextV1Schema.parse({
        actor: { actorId: "actor-1", kind: "principal" },
        correlationId: "correlation-republish",
        ownership: { organizationId, projectId },
      }),
      createdAt,
      idempotency: asyncJobIdempotencyClaimV1Schema.parse({
        actorId: "actor-1",
        keyDigest: digestA,
        operationId: "cloudmarkup.job.create",
        requestDigest: digestB,
      }),
      input: revisionInput(),
      inputDigest: getAsyncJobInputDigestV1(revisionInput()),
      inputSizeBytes: getAsyncJobInputSizeBytesV1(revisionInput()),
      jobId: asyncJobIdSchema.parse("job-republish"),
      reservation: asyncJobReservationLinkV1Schema.parse({ state: "none" }),
    });

    expect(deriveAsyncJobQueueEnvelopeV1(creation.job)).toEqual(
      creation.queueEnvelope,
    );
    expect(
      lifecycleCodes(() => deriveAsyncJobQueueEnvelopeV1(claim(creation.job))),
    ).toContain("invalid-state-transition");
  });

  it("binds creator identity to verified principal context", () => {
    const input = revisionInput();
    const context = asyncJobTrustedContextV1Schema.parse({
      actor: { actorId: "actor-other", kind: "principal" },
      correlationId: "correlation-creator",
      ownership: { organizationId, projectId },
    });
    expect(
      lifecycleCodes(() =>
        createAsyncJobRecordV1({
          context,
          createdAt,
          idempotency: asyncJobIdempotencyClaimV1Schema.parse({
            actorId: "actor-1",
            keyDigest: digestA,
            operationId: "cloudmarkup.job.create",
            requestDigest: digestB,
          }),
          input,
          inputDigest: getAsyncJobInputDigestV1(input),
          inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
          jobId: asyncJobIdSchema.parse("job-creator-mismatch"),
          reservation: asyncJobReservationLinkV1Schema.parse({ state: "none" }),
        }),
      ),
    ).toContain("actor-authority-mismatch");
  });

  it("rejects a false digest or byte measurement", () => {
    const input = revisionInput();
    const context = asyncJobTrustedContextV1Schema.parse({
      actor: { actorId: "actor-1", kind: "principal" },
      correlationId: "correlation-1",
      ownership: { organizationId, projectId },
    });
    const common = {
      context,
      createdAt,
      idempotency: asyncJobIdempotencyClaimV1Schema.parse({
        actorId: "actor-1",
        keyDigest: digestA,
        operationId: "cloudmarkup.job.create",
        requestDigest: digestB,
      }),
      input,
      inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
      jobId: asyncJobIdSchema.parse("job-invalid"),
      reservation: asyncJobReservationLinkV1Schema.parse({ state: "none" }),
    };

    expect(
      lifecycleCodes(() =>
        createAsyncJobRecordV1({ ...common, inputDigest: digestB as never }),
      ),
    ).toContain("input-authority-mismatch");
    expect(
      lifecycleCodes(() =>
        createAsyncJobRecordV1({
          ...common,
          inputDigest: getAsyncJobInputDigestV1(input),
          inputSizeBytes: common.inputSizeBytes - 1,
        }),
      ),
    ).toContain("input-authority-mismatch");
  });

  it("enforces inline and referenced payload limits", () => {
    expect(() => createJob({ limits: { inlineInputBytes: 1 } })).toThrow();

    expect(() =>
      createJob({
        input: draftInput(),
        limits: { referencedInputBytes: 1 },
      }),
    ).toThrow();
  });
});

describe("Async Job v1 transitions, cancellation, and retry", () => {
  it("lets a durable running cancellation beat a later success", () => {
    const original = createJob();
    const running = claim(original);
    const requested = applyAsyncJobLifecycleCommandV1(running, {
      ...commandAuthority(running, "2026-08-15T12:00:10Z"),
      kind: "request-cancellation",
      context: principalContext(running),
    }).job;
    const finished = complete(
      requested,
      exactEvidenceOutput(),
      "2026-08-15T12:00:20Z",
    ).job;

    expect(finished.state).toBe("canceled");
    expect(finished.output).toBeUndefined();
    expect(finished.cancellation.state).toBe("acknowledged");
    expect(original).toEqual(createJob());
  });

  it("does not rewrite a success when cancellation loses the CAS race", () => {
    const succeeded = complete(claim(createJob()), exactEvidenceOutput()).job;
    const afterCancellation = applyAsyncJobLifecycleCommandV1(succeeded, {
      ...commandAuthority(succeeded, "2026-08-15T12:02:00Z"),
      kind: "request-cancellation",
      context: principalContext(succeeded),
    }).job;

    expect(afterCancellation).toEqual(succeeded);
    expect(afterCancellation.state).toBe("succeeded");
  });

  it("classifies transient retry with deterministic backoff and preserves exact revision", () => {
    const initial = createJob();
    const running = claim(initial);
    const retried = complete(
      running,
      failureOutcome("handler-transient-failure"),
    );

    expect(getAsyncJobRetryDelaySecondsV1(1)).toBe(5);
    expect(getAsyncJobRetryDelaySecondsV1(2)).toBe(10);
    expect(retried.job.state).toBe("queued");
    expect(retried.queueEnvelope?.availableAt).toBe("2026-08-15T12:01:05.000Z");
    expect(retried.job.input).toEqual(initial.input);
    expect(retried.job.inputDigest).toBe(initial.inputDigest);

    expect(
      lifecycleCodes(() =>
        applyAsyncJobLifecycleCommandV1(retried.job, {
          ...commandAuthority(retried.job, "2026-08-15T12:01:01Z"),
          attemptId: asyncJobAttemptIdSchema.parse("attempt-2"),
          dependencies: [],
          handler: handlerFor(retried.job),
          kind: "claim",
          leaseExpiresAt: "2026-08-15T12:05:00Z",
          workerId: asyncJobWorkerIdSchema.parse("worker-1"),
        }),
      ),
    ).toContain("invalid-time-order");

    const secondAttempt = claim(
      retried.job,
      "2026-08-15T12:01:05Z",
      "2026-08-15T12:05:00Z",
    );
    expect(secondAttempt.attempts).toHaveLength(2);
    expect(secondAttempt.input.subject).toEqual(initial.input.subject);
  });

  it("fails permanently without queueing and rejects stale or switched input authority", () => {
    const running = claim(createJob());
    const failed = complete(
      running,
      failureOutcome("handler-permanent-failure"),
    );
    expect(failed.job.state).toBe("failed");
    expect(failed.queueEnvelope).toBeUndefined();

    expect(
      lifecycleCodes(() =>
        applyAsyncJobLifecycleCommandV1(running, {
          at: "2026-08-15T12:00:10Z",
          expectedInputDigest: getAsyncJobInputDigestV1(
            revisionInput("solution-revision-2"),
          ),
          expectedRecordVersion: running.recordVersion,
          kind: "request-cancellation",
          context: principalContext(running),
        }),
      ),
    ).toContain("input-authority-mismatch");
    expect(
      lifecycleCodes(() =>
        applyAsyncJobLifecycleCommandV1(running, {
          ...commandAuthority(running, "2026-08-15T12:00:10Z"),
          expectedRecordVersion: running.recordVersion - 1,
          kind: "request-cancellation",
          context: principalContext(running),
        }),
      ),
    ).toContain("stale-record-version");
  });

  it("derives cancellation scope from verified principal context", () => {
    const running = claim(createJob());
    expect(
      lifecycleCodes(() =>
        applyAsyncJobLifecycleCommandV1(running, {
          ...commandAuthority(running, "2026-08-15T12:00:10Z"),
          context: principalContext(running, "organization-other"),
          kind: "request-cancellation",
        }),
      ),
    ).toContain("actor-authority-mismatch");
  });

  it("bounds leases and retries by immutable job expiration", () => {
    const queued = createJob({ expiresAt: "2026-08-15T12:01:03Z" });
    expect(
      lifecycleCodes(() =>
        claim(queued, "2026-08-15T12:00:01Z", "2026-08-15T12:01:04Z"),
      ),
    ).toContain("invalid-lease");

    const running = claim(
      queued,
      "2026-08-15T12:00:01Z",
      "2026-08-15T12:01:02Z",
    );
    const exhausted = complete(
      running,
      failureOutcome("handler-transient-failure"),
      "2026-08-15T12:01:00Z",
    ).job;
    expect(exhausted.state).toBe("failed");
    expect(exhausted.failure?.code).toBe(
      "cloudmarkup.job.retry-window-exhausted",
    );
    expect(exhausted.attempts[0]?.retryDisposition).toEqual({
      kind: "do-not-retry",
    });
  });

  it("expires before accepting a late completion and caps attempt runtime", () => {
    const queued = createJob({ expiresAt: "2026-08-15T12:00:30Z" });
    const running = claim(
      queued,
      "2026-08-15T12:00:01Z",
      "2026-08-15T12:00:30Z",
    );
    const expired = complete(
      running,
      exactEvidenceOutput(),
      "2026-08-15T12:10:00Z",
    ).job;
    expect(expired.state).toBe("expired");
    expect(expired.output).toBeUndefined();
    expect(expired.attempts[0]?.runtimeSeconds).toBe(29);
  });

  it("rejects invalid terminal transitions", () => {
    const succeeded = complete(claim(createJob()), exactEvidenceOutput()).job;
    expect(
      lifecycleCodes(() => claim(succeeded, "2026-08-15T12:02:00Z")),
    ).toContain("invalid-state-transition");
  });

  it("expires only due nonterminal work", () => {
    const queued = createJob({ expiresAt: "2026-08-15T12:00:30Z" });
    const expired = applyAsyncJobLifecycleCommandV1(queued, {
      ...commandAuthority(queued, "2026-08-15T12:00:30Z"),
      kind: "expire",
    }).job;

    expect(expired.state).toBe("expired");
    expect(expired.completedAt).toBe("2026-08-15T12:00:30Z");
  });
});

describe("Async Job v1 checkpoints and crash recovery", () => {
  function checkpointFor(job: AsyncJobRecordV1, at: string) {
    const attempt = job.attempts[job.attempts.length - 1];
    if (attempt === undefined) {
      throw new Error("Test fixture requires an attempt.");
    }
    return asyncJobCheckpointV1Schema.parse({
      attemptNumber: attempt.attemptNumber,
      checkpointId: "checkpoint-1",
      createdAt: at,
      handlerId: "cloudmarkup.handler.fake",
      handlerVersion: "1.0.0",
      inputDigest: job.inputDigest,
      sequence: 1,
      state: objectReference("checkpoint-object-1", "checkpoint-state"),
    });
  }

  it("pauses and resumes user input only from the exact handler checkpoint", () => {
    const running = claim(createJob());
    const checkpoint = checkpointFor(running, "2026-08-15T12:00:10Z");
    const awaiting = complete(
      running,
      asyncJobHandlerOutcomeV1Schema.parse({
        checkpoint,
        interactionId: "interaction-1",
        messageKey: "cloudmarkup.job.user-input-required",
        outcome: "awaiting-user-input",
      }),
      checkpoint.createdAt,
    ).job;

    expect(awaiting.state).toBe("awaiting-user-input");
    expect(awaiting.interaction).toMatchObject({
      checkpointId: checkpoint.checkpointId,
      interactionId: "interaction-1",
      state: "awaiting-user-input",
    });
    expect(
      deriveAsyncJobStatusViewV1(awaiting, "2026-08-15T12:00:10Z").interaction,
    ).toEqual({
      interactionId: "interaction-1",
      requestedAt: checkpoint.createdAt,
      state: "awaiting-user-input",
    });
    expect(
      lifecycleCodes(() =>
        applyAsyncJobLifecycleCommandV1(awaiting, {
          ...commandAuthority(awaiting, "2026-08-15T12:00:11Z"),
          checkpointId: checkpoint.checkpointId,
          context: principalContext(awaiting),
          handler: handlerFor(awaiting, "checkpoint-required"),
          interactionId: "interaction-stale",
          kind: "resume-user-input",
          userResponse: objectReference("user-response-stale", "input-payload"),
        }),
      ),
    ).toContain("checkpoint-authority-mismatch");

    expect(
      lifecycleCodes(() =>
        applyAsyncJobLifecycleCommandV1(awaiting, {
          ...commandAuthority(awaiting, "2026-08-15T12:00:11Z"),
          checkpointId: checkpoint.checkpointId,
          context: principalContext(awaiting),
          handler: handlerFor(awaiting, "checkpoint-required"),
          interactionId: "interaction-1",
          kind: "resume-user-input",
          userResponse: objectReference(
            "user-response-expiring",
            "input-payload",
            64,
            "2026-08-16T12:00:00Z",
          ),
        }),
      ),
    ).toContain("input-authority-mismatch");

    const resumed = applyAsyncJobLifecycleCommandV1(awaiting, {
      ...commandAuthority(awaiting, "2026-08-15T12:00:11Z"),
      checkpointId: checkpoint.checkpointId,
      context: principalContext(awaiting),
      handler: handlerFor(awaiting, "checkpoint-required"),
      interactionId: "interaction-1",
      kind: "resume-user-input",
      userResponse: objectReference("user-response-1", "input-payload"),
    });
    expect(resumed.job.state).toBe("queued");
    expect(resumed.job.queuedAt).toBe(awaiting.queuedAt);
    expect(resumed.job.interaction.state).toBe("user-input-received");
    expect(resumed.queueEnvelope?.inputDigest).toBe(awaiting.inputDigest);
    expect(resumed.queueEnvelope?.availableAt).toBe("2026-08-15T12:00:11Z");
    expect(deriveAsyncJobQueueEnvelopeV1(resumed.job)).toEqual(
      resumed.queueEnvelope,
    );

    expect(
      lifecycleCodes(() =>
        claim(resumed.job, "2026-08-15T12:00:12Z", "2026-08-15T12:05:00Z"),
      ),
    ).toContain("checkpoint-authority-mismatch");

    const resumedRunning = claim(
      resumed.job,
      "2026-08-15T12:00:12Z",
      "2026-08-15T12:05:00Z",
      {
        checkpointId: checkpoint.checkpointId,
        interactionId: "interaction-1",
      },
    );
    expect(resumedRunning.attempts[1]?.resumedFromCheckpointId).toBe(
      checkpoint.checkpointId,
    );

    const secondCheckpoint = asyncJobCheckpointV1Schema.parse({
      attemptNumber: 2,
      checkpointId: "checkpoint-2",
      createdAt: "2026-08-15T12:00:20Z",
      handlerId: checkpoint.handlerId,
      handlerVersion: checkpoint.handlerVersion,
      inputDigest: resumedRunning.inputDigest,
      sequence: 2,
      state: objectReference("checkpoint-object-2", "checkpoint-state"),
    });
    const retry = complete(
      resumedRunning,
      asyncJobHandlerOutcomeV1Schema.parse({
        checkpoint: secondCheckpoint,
        failure: createAsyncJobFailureV1("handler-transient-failure"),
        outcome: "failed",
      }),
      secondCheckpoint.createdAt,
      "checkpoint-required",
    ).job;
    expect(retry.interaction.state).toBe("user-input-received");
    const retriedRunning = claim(
      retry,
      "2026-08-15T12:00:30Z",
      "2026-08-15T12:05:00Z",
      {
        checkpointId: secondCheckpoint.checkpointId,
        interactionId: "interaction-1",
      },
    );
    expect(retriedRunning.attempts[2]?.resumedFromCheckpointId).toBe(
      secondCheckpoint.checkpointId,
    );
  });

  it("resumes an orphan only from the exact durable compatible checkpoint", () => {
    const running = claim(
      createJob(),
      "2026-08-15T12:00:01Z",
      "2026-08-15T12:00:30Z",
    );
    const attempt = running.attempts[0];
    if (attempt === undefined) {
      throw new Error("Missing attempt fixture.");
    }
    const checkpoint = checkpointFor(running, "2026-08-15T12:00:10Z");
    const checkpointed = applyAsyncJobLifecycleCommandV1(running, {
      ...commandAuthority(running, checkpoint.createdAt),
      attemptId: attempt.attemptId,
      checkpoint,
      handler: handlerFor(running, "checkpoint-required"),
      kind: "record-checkpoint",
      workerId: asyncJobWorkerIdSchema.parse("worker-1"),
    }).job;

    const recovered = applyAsyncJobLifecycleCommandV1(checkpointed, {
      ...commandAuthority(checkpointed, "2026-08-15T12:00:31Z"),
      handler: handlerFor(checkpointed, "checkpoint-required"),
      kind: "reconcile-orphan",
    });
    expect(recovered.job.state).toBe("queued");
    expect(recovered.job.attempts[0]?.state).toBe("orphaned");
    expect(recovered.job.attempts[0]?.runtimeSeconds).toBe(29);
    expect(recovered.queueEnvelope?.availableAt).toBe(
      "2026-08-15T12:00:36.000Z",
    );
    expect(deriveAsyncJobQueueEnvelopeV1(recovered.job)).toEqual(
      recovered.queueEnvelope,
    );

    const resumed = claim(
      recovered.job,
      "2026-08-15T12:00:36Z",
      "2026-08-15T12:05:00Z",
      { checkpointId: checkpoint.checkpointId },
    );
    expect(resumed.attempts[1]?.resumedFromCheckpointId).toBe(
      checkpoint.checkpointId,
    );
  });

  it("rejects premature orphaning and fails handlers that are not resumable", () => {
    const running = claim(
      createJob(),
      "2026-08-15T12:00:01Z",
      "2026-08-15T12:00:30Z",
    );
    expect(
      lifecycleCodes(() =>
        applyAsyncJobLifecycleCommandV1(running, {
          ...commandAuthority(running, "2026-08-15T12:00:20Z"),
          handler: handlerFor(running),
          kind: "reconcile-orphan",
        }),
      ),
    ).toContain("job-not-orphaned");

    const failed = applyAsyncJobLifecycleCommandV1(running, {
      ...commandAuthority(running, "2026-08-15T12:00:31Z"),
      handler: handlerFor(running, "not-resumable"),
      kind: "reconcile-orphan",
    }).job;
    expect(failed.state).toBe("failed");
    expect(failed.failure?.code).toBe(
      "cloudmarkup.job.checkpoint-incompatible",
    );
  });
  it("enforces checkpoint byte limits", () => {
    const running = claim(createJob({ limits: { checkpointBytes: 16 } }));
    const attempt = running.attempts[0];
    if (attempt === undefined) {
      throw new Error("Missing attempt fixture.");
    }
    const oversized = asyncJobCheckpointV1Schema.parse({
      ...checkpointFor(running, "2026-08-15T12:00:10Z"),
      state: objectReference("checkpoint-object-large", "checkpoint-state", 17),
    });
    expect(
      lifecycleCodes(() =>
        applyAsyncJobLifecycleCommandV1(running, {
          ...commandAuthority(running, oversized.createdAt),
          attemptId: attempt.attemptId,
          checkpoint: oversized,
          handler: handlerFor(running, "checkpoint-required"),
          kind: "record-checkpoint",
          workerId: asyncJobWorkerIdSchema.parse("worker-1"),
        }),
      ),
    ).toContain("checkpoint-limit-exceeded");
  });
});

describe("Async Job v1 orchestration and revision supersession", () => {
  it("fails a parent deterministically under fail-parent policy", () => {
    const parent = createJob({
      expectedChildJobIds: ["child-job"],
      jobId: "parent-job",
    });
    const childQueued = createJob({
      jobId: "child-job",
      parentJobId: parent.jobId,
      rootJobId: parent.jobId,
    });
    const childFailed = complete(
      claim(childQueued),
      failureOutcome("handler-permanent-failure"),
    ).job;

    expect(evaluateAsyncJobChildrenV1(parent, [childFailed])).toEqual({
      failedChildJobIds: [childFailed.jobId],
      kind: "fail-parent",
    });
    const failedParent = failAsyncJobParentFromChildrenV1(
      parent,
      [childFailed],
      commandAuthority(parent, "2026-08-15T12:02:00Z"),
    ).job;
    expect(failedParent.state).toBe("failed");
    expect(failedParent.failure?.publicMessage).toBe("job-internal-error");
  });

  it("waits for the exact complete child set and every successful terminal child", () => {
    const parent = createJob({
      expectedChildJobIds: ["child-a", "child-b"],
      jobId: "parent-waiting",
    });
    const childAQueued = createJob({
      jobId: "child-a",
      parentJobId: parent.jobId,
      rootJobId: parent.jobId,
    });
    const childASucceeded = complete(
      claim(childAQueued),
      exactEvidenceOutput(),
    ).job;
    const childBQueued = createJob({
      jobId: "child-b",
      parentJobId: parent.jobId,
      rootJobId: parent.jobId,
    });

    expect(evaluateAsyncJobChildrenV1(parent, [childASucceeded])).toEqual({
      kind: "waiting",
      missingChildJobIds: [childBQueued.jobId],
      nonterminalChildJobIds: [],
    });
    expect(
      evaluateAsyncJobChildrenV1(parent, [childASucceeded, childBQueued]),
    ).toEqual({
      kind: "waiting",
      missingChildJobIds: [],
      nonterminalChildJobIds: [childBQueued.jobId],
    });
    const childBSucceeded = complete(
      claim(childBQueued),
      exactEvidenceOutput(),
    ).job;
    expect(
      evaluateAsyncJobChildrenV1(parent, [childBSucceeded, childASucceeded]),
    ).toEqual({ kind: "ready" });
  });

  it("applies cancel-remaining and continue-and-report to the full child set", () => {
    const cancelParent = createJob({
      expectedChildJobIds: ["cancel-child-a", "cancel-child-b"],
      failurePolicy: "cancel-remaining",
      jobId: "parent-cancel-policy",
    });
    const failedChild = complete(
      claim(
        createJob({
          jobId: "cancel-child-a",
          parentJobId: cancelParent.jobId,
          rootJobId: cancelParent.jobId,
        }),
      ),
      failureOutcome("handler-permanent-failure"),
    ).job;
    const pendingChild = createJob({
      jobId: "cancel-child-b",
      parentJobId: cancelParent.jobId,
      rootJobId: cancelParent.jobId,
    });
    expect(
      evaluateAsyncJobChildrenV1(cancelParent, [failedChild, pendingChild]),
    ).toEqual({
      cancelChildJobIds: [pendingChild.jobId],
      failedChildJobIds: [failedChild.jobId],
      kind: "cancel-remaining",
    });

    const reportParent = createJob({
      expectedChildJobIds: ["report-child-a", "report-child-b"],
      failurePolicy: "continue-and-report",
      jobId: "parent-report-policy",
    });
    const reportFailed = {
      ...failedChild,
      jobId: asyncJobIdSchema.parse("report-child-a"),
      orchestration: {
        ...failedChild.orchestration,
        parentJobId: reportParent.jobId,
        rootJobId: reportParent.jobId,
      },
    };
    const reportPending = createJob({
      jobId: "report-child-b",
      parentJobId: reportParent.jobId,
      rootJobId: reportParent.jobId,
    });
    expect(
      evaluateAsyncJobChildrenV1(reportParent, [reportFailed, reportPending]),
    ).toEqual({
      allChildrenTerminal: false,
      failedChildJobIds: [reportFailed.jobId],
      kind: "continue-and-report",
      nonterminalChildJobIds: [reportPending.jobId],
    });
  });

  it("rejects a cross-organization child", () => {
    const parent = createJob({
      expectedChildJobIds: ["child-job"],
      jobId: "parent-job",
    });
    const child = createJob({
      jobId: "child-job",
      organizationId: "organization-2",
      parentJobId: parent.jobId,
      rootJobId: parent.jobId,
    });
    expect(
      lifecycleCodes(() => evaluateAsyncJobChildrenV1(parent, [child])),
    ).toContain("parent-authority-mismatch");
  });

  it("supersedes only with a different immutable revision and keeps the old record auditable", () => {
    const original = createJob({ jobId: "job-old" });
    const replacement = createJob({
      createdAt: "2026-08-15T12:01:00Z",
      input: revisionInput("solution-revision-2"),
      jobId: "job-new",
    });
    const superseded = applyAsyncJobLifecycleCommandV1(original, {
      ...commandAuthority(original, "2026-08-15T12:02:00Z"),
      kind: "supersede",
      replacement,
    }).job;

    expect(superseded.state).toBe("superseded");
    expect(superseded.supersededByJobId).toBe(replacement.jobId);
    expect(superseded.input).toEqual(original.input);
    expect(superseded.completedAt).toBe("2026-08-15T12:02:00Z");

    const sameRevisionReplacement = createJob({
      createdAt: "2026-08-15T12:01:00Z",
      jobId: "job-same-revision",
    });
    expect(
      lifecycleCodes(() =>
        applyAsyncJobLifecycleCommandV1(original, {
          ...commandAuthority(original, "2026-08-15T12:02:00Z"),
          kind: "supersede",
          replacement: sameRevisionReplacement,
        }),
      ),
    ).toContain("supersession-not-justified");
  });
});

describe("Async Job v1 outputs, artifact expiry, and redaction", () => {
  it("publishes Evidence references only for the exact revision and environment", () => {
    const succeeded = complete(claim(createJob()), exactEvidenceOutput()).job;
    expect(succeeded.state).toBe("succeeded");
    expect(succeeded.output?.evidenceRecords).toHaveLength(1);
    expect(succeeded.output?.evidenceRecords[0]?.solutionRevisionId).toBe(
      "solution-revision-1",
    );

    const wrongEvidence = exactEvidenceOutput({
      evidenceRevisionId: "solution-revision-other",
    });
    const rejected = complete(claim(createJob()), wrongEvidence).job;
    expect(rejected.state).toBe("failed");
    expect(rejected.failure?.code).toBe("cloudmarkup.job.output-invalid");
  });

  it("enforces output size and derives artifact expiry without rewriting success", () => {
    const running = claim(createJob({ limits: { outputBytes: 127 } }));
    const limited = complete(
      running,
      exactEvidenceOutput({ artifactSize: 128 }),
    ).job;
    expect(limited.state).toBe("failed");
    expect(limited.failure?.code).toBe("cloudmarkup.job.output-limit-exceeded");

    const succeeded = complete(
      claim(createJob()),
      exactEvidenceOutput({
        artifactExpiresAt: "2026-08-15T12:03:00Z",
      }),
    ).job;
    const view = deriveAsyncJobStatusViewV1(succeeded, "2026-08-15T12:04:00Z");
    if (view.output?.family !== "iac-compilation") {
      throw new Error("Expected an IaC output fixture.");
    }
    expect(view.output.compiledInfrastructure.availability.state).toBe(
      "expired",
    );
    if (succeeded.output?.family !== "iac-compilation") {
      throw new Error("Expected a persisted IaC output fixture.");
    }
    expect(succeeded.output.compiledInfrastructure.availability.state).toBe(
      "available",
    );
    expect(view.output.compiledInfrastructure.artifactId).toBe(
      succeeded.output.compiledInfrastructure.artifactId,
    );
    expect(view.output.compiledInfrastructure.object).toEqual(
      succeeded.output.compiledInfrastructure.object,
    );
    expect(view.state).toBe("succeeded");
  });

  it("turns malformed and underreported handler output into sanitized permanent failure", () => {
    const secret = "private-key=do-not-store";
    const malformed = complete(claim(createJob()), {
      debug: secret,
      outcome: "succeeded",
      output: { family: "iac-compilation" },
      outputSizeBytes: 1,
    }).job;
    expect(malformed.state).toBe("failed");
    expect(malformed.failure).toMatchObject({
      classification: "permanent",
      code: "cloudmarkup.job.output-invalid",
      publicMessage: "job-internal-error",
    });
    expect(JSON.stringify(malformed)).not.toContain(secret);

    const exact = exactEvidenceOutput();
    if (exact.outcome !== "succeeded") {
      throw new Error("Expected successful output fixture.");
    }
    const underreported = complete(claim(createJob()), {
      ...exact,
      outputSizeBytes: 1,
    }).job;
    expect(underreported.state).toBe("failed");
    expect(underreported.failure?.code).toBe(
      "cloudmarkup.job.output-limit-exceeded",
    );
  });

  it("never exposes a raw exception through the sanitized failure contract", () => {
    const secret = "access_token=do-not-leak";
    const failure = sanitizeUnknownAsyncJobFailureV1(new Error(secret));
    expect(failure).toEqual({
      classification: "permanent",
      code: "cloudmarkup.job.internal-error",
      publicMessage: "job-internal-error",
    });
    expect(JSON.stringify(failure)).not.toContain(secret);
  });
});

describe("Async Job v1 parent cancellation authority", () => {
  it("cancels remaining children durably before failing the parent", () => {
    const parent = createJob({
      expectedChildJobIds: ["cancel-failed", "cancel-queued", "cancel-running"],
      failurePolicy: "cancel-remaining",
      jobId: "parent-cancel-durable",
    });
    const failedChild = complete(
      claim(
        createJob({
          jobId: "cancel-failed",
          parentJobId: parent.jobId,
          rootJobId: parent.jobId,
        }),
      ),
      failureOutcome("handler-permanent-failure"),
    ).job;
    const queuedChild = createJob({
      jobId: "cancel-queued",
      parentJobId: parent.jobId,
      rootJobId: parent.jobId,
    });
    const runningChild = claim(
      createJob({
        jobId: "cancel-running",
        parentJobId: parent.jobId,
        rootJobId: parent.jobId,
      }),
    );
    const children = [failedChild, queuedChild, runningChild];

    expect(
      lifecycleCodes(() =>
        failAsyncJobParentFromChildrenV1(
          parent,
          children,
          commandAuthority(parent, "2026-08-15T12:01:30Z"),
        ),
      ),
    ).toContain("invalid-state-transition");
    expect(
      lifecycleCodes(() =>
        cancelAsyncJobChildFromParentV1(parent, children, {
          ...parentCancellationAuthority(
            parent,
            queuedChild,
            "2026-08-15T12:01:31Z",
          ),
          expectedParentRecordVersion: parent.recordVersion + 1,
        }),
      ),
    ).toContain("stale-record-version");
    expect(
      lifecycleCodes(() =>
        cancelAsyncJobChildFromParentV1(parent, children, {
          ...parentCancellationAuthority(
            parent,
            queuedChild,
            "2026-08-15T12:01:31Z",
          ),
          expectedRecordVersion: queuedChild.recordVersion + 1,
        }),
      ),
    ).toContain("stale-record-version");

    const queuedCancellation = cancelAsyncJobChildFromParentV1(
      parent,
      children,
      parentCancellationAuthority(parent, queuedChild, "2026-08-15T12:01:32Z"),
    );
    expect(queuedCancellation.job.state).toBe("canceled");
    expect(queuedCancellation.job.cancellation).toMatchObject({
      requestedBy: parent.jobId,
      state: "acknowledged",
    });
    expect(queuedCancellation.transition?.reason).toBe("parent-policy");

    const partiallyCanceledChildren = [
      failedChild,
      queuedCancellation.job,
      runningChild,
    ];
    expect(
      lifecycleCodes(() =>
        failAsyncJobParentFromChildrenV1(
          parent,
          partiallyCanceledChildren,
          commandAuthority(parent, "2026-08-15T12:01:33Z"),
        ),
      ),
    ).toContain("invalid-state-transition");

    const runningCancellation = cancelAsyncJobChildFromParentV1(
      parent,
      partiallyCanceledChildren,
      parentCancellationAuthority(parent, runningChild, "2026-08-15T12:01:34Z"),
    );
    expect(runningCancellation.job.state).toBe("running");
    expect(runningCancellation.job.cancellation).toMatchObject({
      requestedBy: parent.jobId,
      state: "requested",
    });
    expect(runningCancellation.transition?.reason).toBe("parent-policy");

    const failedParent = failAsyncJobParentFromChildrenV1(
      parent,
      [failedChild, queuedCancellation.job, runningCancellation.job],
      commandAuthority(parent, "2026-08-15T12:01:35Z"),
    ).job;
    expect(failedParent.state).toBe("failed");
    expect(runningCancellation.job.state).toBe("running");
    expect(runningCancellation.job.cancellation.state).toBe("requested");
  });
});

describe("exact host project-deletion job cancellation", () => {
  function recover(
    job: AsyncJobRecordV1,
    at = "2026-08-15T12:06:00Z",
    overrides: Record<string, unknown> = {},
  ) {
    return cancelAsyncJobForProjectDeletionV1({
      job,
      at,
      expectedRecordVersion: job.recordVersion,
      expectedInputDigest: job.inputDigest,
      context: asyncJobTrustedContextV1Schema.parse({
        actor: { kind: "system", reason: "retention" },
        correlationId: job.correlationId,
        ownership: job.ownership,
      }),
      deletion: { recordVersion: 2, requestedAt: "2026-08-15T12:00:02Z" },
      ...overrides,
    });
  }
  it("canonically cancels queued work with no fabricated attempt/output or financial disposition", () => {
    const prior = createJob();
    const serialized = JSON.stringify(prior);
    const result = recover(prior);
    expect(result.job.state).toBe("canceled");
    expect(result.job.attempts).toEqual(prior.attempts);
    expect(result.job.output).toBe(prior.output);
    expect(result.job.reservation).toEqual(prior.reservation);
    expect(result.job.inputDigest).toBe(prior.inputDigest);
    expect(result.job.recordVersion).toBe(prior.recordVersion + 1);
    expect(JSON.stringify(prior)).toBe(serialized);
    expect(recover(result.job).job).toEqual(result.job);
  });
  it("requires live workers to drain before canonical attempt cancellation", () => {
    const running = claim(createJob());
    expect(() => recover(running, "2026-08-15T12:03:00Z")).toThrow();
    const result = recover(running);
    expect(result.job.state).toBe("canceled");
    expect(result.job.attempts.at(-1)?.state).toBe("canceled");
  });
  it("preserves expiration and existing terminal outcomes", () => {
    const queued = createJob({ expiresAt: "2026-08-15T12:01:00Z" });
    expect(recover(queued).job.state).toBe("expired");
    const terminal = recover(createJob()).job;
    expect(recover(terminal).job).toEqual(terminal);
  });
  it("rejects forged actors, scope/correlation drift, stale input/version and pre-deletion time", () => {
    const job = createJob();
    for (const context of [
      principalContext(job),
      asyncJobTrustedContextV1Schema.parse({
        actor: { kind: "system", reason: "scheduler" },
        correlationId: job.correlationId,
        ownership: job.ownership,
      }),
      asyncJobTrustedContextV1Schema.parse({
        actor: { kind: "system", reason: "retention" },
        correlationId: "other",
        ownership: job.ownership,
      }),
    ])
      expect(() => recover(job, undefined, { context })).toThrow();
    expect(() =>
      recover(job, undefined, { expectedRecordVersion: 99 }),
    ).toThrow();
    expect(() =>
      recover(job, undefined, { expectedInputDigest: digestB }),
    ).toThrow();
    expect(() => recover(job, "2026-08-15T12:00:01Z")).toThrow();
  });
});
