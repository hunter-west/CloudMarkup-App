import {
  asyncJobAttemptV1Schema,
  asyncJobCreateRequestV1Schema,
  asyncJobCheckpointV1Schema,
  asyncJobFailureV1Schema,
  asyncJobFamilyV1Schema,
  asyncJobHandlerOutcomeV1Schema,
  asyncJobRecordV1Schema,
  asyncJobTrustedContextV1Schema,
  asyncJobProgressV1Schema,
  namespacedIdentifierSchema,
  asyncJobQueueEnvelopeV1Schema,
  asyncJobStatusViewV1Schema,
  asyncJobTransitionV1Schema,
  parseAsyncJobInputV1,
  parseAsyncJobRecordV1,
  serializeCanonicalJson,
  type AsyncJobAttemptV1,
  type AsyncJobCreateRequestV1,
  type AsyncJobCheckpointV1,
  type AsyncJobFailureV1,
  type AsyncJobId,
  type AsyncJobInputV1,
  type AsyncJobLimitsV1,
  type AsyncJobObjectReferenceV1,
  type AsyncJobOutputV1,
  type AsyncJobProgressV1,
  type AsyncJobQueueEnvelopeV1,
  type AsyncJobRecordV1,
  type AsyncJobStateV1,
  type AsyncJobStatusViewV1,
  type AsyncJobTrustedContextV1,
} from "@cloudmarkup/schemas";

import { hashCanonicalValue } from "./document-hashing.js";
import { sha256Hex } from "./sha256.js";

type AsyncJobTransitionV1 = ReturnType<typeof asyncJobTransitionV1Schema.parse>;

export const ASYNC_JOB_DOMAIN_VERSION = 1 as const;

export const DEFAULT_ASYNC_JOB_LIMITS_V1 = Object.freeze({
  artifactCount: 64,
  attemptCount: 3,
  checkpointBytes: 8_388_608,
  checkpointCount: 64,
  contractVersion: 1,
  inlineInputBytes: 65_536,
  outputBytes: 268_435_456,
  referencedInputBytes: 1_073_741_824,
  runtimeSeconds: 3_600,
} as const satisfies AsyncJobLimitsV1);

/** Hashes a raw, validated idempotency key without persisting the key itself. */
export function getAsyncJobIdempotencyKeyDigestV1(
  rawKey: string,
): AsyncJobRecordV1["idempotency"]["keyDigest"] {
  const validatedKey =
    asyncJobCreateRequestV1Schema.shape.idempotencyKey.parse(rawKey);
  return `sha256:${sha256Hex(validatedKey)}` as AsyncJobRecordV1["idempotency"]["keyDigest"];
}

/** Fingerprints the canonical, schema-validated create request for replay checks. */
export function getAsyncJobCreateRequestDigestV1(
  request: AsyncJobCreateRequestV1,
): AsyncJobRecordV1["idempotency"]["requestDigest"] {
  return hashCanonicalValue(asyncJobCreateRequestV1Schema.parse(request));
}

export const ASYNC_JOB_STATE_TRANSITIONS_V1 = Object.freeze({
  "awaiting-user-input": [
    "queued",
    "failed",
    "canceled",
    "expired",
    "superseded",
  ],
  canceled: [],
  expired: [],
  failed: [],
  queued: ["running", "failed", "canceled", "expired", "superseded"],
  running: [
    "queued",
    "awaiting-user-input",
    "succeeded",
    "failed",
    "canceled",
    "expired",
    "superseded",
  ],
  succeeded: [],
  superseded: [],
} as const satisfies Readonly<
  Record<AsyncJobStateV1, readonly AsyncJobStateV1[]>
>);

export type AsyncJobLifecycleIssueCode =
  | "actor-authority-mismatch"
  | "attempt-limit-exceeded"
  | "cancellation-not-requested"
  | "checkpoint-authority-mismatch"
  | "checkpoint-handler-mismatch"
  | "checkpoint-limit-exceeded"
  | "checkpoint-not-found"
  | "checkpoint-sequence-invalid"
  | "child-set-incomplete"
  | "handler-outcome-invalid"
  | "handler-registration-mismatch"
  | "dependency-authority-mismatch"
  | "dependency-blocked"
  | "dependency-set-mismatch"
  | "input-authority-mismatch"
  | "invalid-lease"
  | "invalid-orphan-resolution"
  | "invalid-state-transition"
  | "invalid-time-order"
  | "job-expired"
  | "job-not-orphaned"
  | "job-not-running"
  | "output-authority-mismatch"
  | "parent-authority-mismatch"
  | "progress-regression"
  | "replacement-authority-mismatch"
  | "runtime-limit-exceeded"
  | "stale-record-version"
  | "supersession-not-justified"
  | "worker-lease-expired"
  | "worker-lease-mismatch";

export interface AsyncJobLifecycleIssue {
  readonly code: AsyncJobLifecycleIssueCode;
  readonly message: string;
  readonly path: string;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function formatAsyncJobLifecycleIssues(
  issues: readonly AsyncJobLifecycleIssue[],
): string {
  return issues
    .map((issue) => `${issue.path}: ${issue.message} [${issue.code}]`)
    .join("\n");
}

export class AsyncJobLifecycleError extends Error {
  public readonly issues: readonly AsyncJobLifecycleIssue[];

  public constructor(issues: readonly AsyncJobLifecycleIssue[]) {
    const sorted = [...issues].sort(
      (left, right) =>
        compareText(left.path, right.path) ||
        compareText(left.code, right.code) ||
        compareText(left.message, right.message),
    );
    super(formatAsyncJobLifecycleIssues(sorted));
    this.name = "AsyncJobLifecycleError";
    this.issues = sorted;
  }
}

function fail(
  code: AsyncJobLifecycleIssueCode,
  path: string,
  message: string,
): never {
  throw new AsyncJobLifecycleError([{ code, message, path }]);
}

function epoch(timestamp: string, path: string): number {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) {
    fail("invalid-time-order", path, "The timestamp is invalid.");
  }
  return value;
}

function assertAtOrAfter(
  value: string,
  lowerBound: string,
  path: string,
): void {
  if (epoch(value, path) < epoch(lowerBound, "$.job.updatedAt")) {
    fail(
      "invalid-time-order",
      path,
      "Lifecycle time cannot precede the stored job update.",
    );
  }
}

function addSeconds(timestamp: string, seconds: number): string {
  return new Date(epoch(timestamp, "$.at") + seconds * 1_000).toISOString();
}

function elapsedSeconds(startedAt: string, completedAt: string): number {
  const elapsed = epoch(completedAt, "$.at") - epoch(startedAt, "$.attempt");
  if (elapsed < 0) {
    fail(
      "invalid-time-order",
      "$.at",
      "Attempt completion cannot precede attempt start.",
    );
  }
  return Math.ceil(elapsed / 1_000);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function getAsyncJobInputDigestV1(input: unknown) {
  return hashCanonicalValue(parseAsyncJobInputV1(input));
}

export function getAsyncJobInputSizeBytesV1(input: unknown): number {
  return utf8ByteLength(serializeCanonicalJson(parseAsyncJobInputV1(input)));
}

export interface CreateAsyncJobRecordV1Input {
  readonly context: AsyncJobTrustedContextV1;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly idempotency: AsyncJobRecordV1["idempotency"];
  readonly input: AsyncJobInputV1;
  readonly inputDigest: AsyncJobRecordV1["inputDigest"];
  readonly inputSizeBytes: number;
  readonly jobId: AsyncJobId;
  readonly limits?: AsyncJobLimitsV1;
  readonly orchestration?: {
    readonly dependencyJobIds?: readonly AsyncJobId[];
    readonly expectedChildJobIds?: readonly AsyncJobId[];
    readonly failurePolicy?: AsyncJobRecordV1["orchestration"]["failurePolicy"];
    readonly parentJobId?: AsyncJobId;
    readonly rootJobId?: AsyncJobId;
  };
  readonly reservation: AsyncJobRecordV1["reservation"];
}

export interface AsyncJobLifecycleResultV1 {
  readonly job: AsyncJobRecordV1;
  readonly queueEnvelope?: AsyncJobQueueEnvelopeV1;
  readonly transition?: AsyncJobTransitionV1;
}

export function createAsyncJobRecordV1(
  creation: CreateAsyncJobRecordV1Input,
): AsyncJobLifecycleResultV1 {
  const context = asyncJobTrustedContextV1Schema.parse(creation.context);
  if (
    context.actor.kind !== "principal" ||
    context.actor.actorId !== creation.idempotency.actorId
  ) {
    fail(
      "actor-authority-mismatch",
      "$.idempotency.actorId",
      "Job creation identity must match the verified principal context.",
    );
  }
  const input = parseAsyncJobInputV1(creation.input);
  const exactDigest = getAsyncJobInputDigestV1(input);
  if (creation.inputDigest !== exactDigest) {
    fail(
      "input-authority-mismatch",
      "$.inputDigest",
      "The supplied digest does not identify the exact validated job input.",
    );
  }
  const exactSize = getAsyncJobInputSizeBytesV1(input);
  if (creation.inputSizeBytes !== exactSize) {
    fail(
      "input-authority-mismatch",
      "$.inputSizeBytes",
      "The supplied byte count does not match the exact validated job input.",
    );
  }
  if (
    creation.expiresAt !== undefined &&
    epoch(creation.expiresAt, "$.expiresAt") <=
      epoch(creation.createdAt, "$.createdAt")
  ) {
    fail(
      "invalid-time-order",
      "$.expiresAt",
      "Job expiration must follow creation.",
    );
  }

  const orchestration = creation.orchestration;
  const parentJobId = orchestration?.parentJobId;
  const rootJobId =
    parentJobId === undefined
      ? creation.jobId
      : (orchestration?.rootJobId ?? parentJobId);
  const candidate = {
    attempts: [],
    cancellation: { state: "none" },
    checkpoints: [],
    contractVersion: 1,
    correlationId: context.correlationId,
    createdAt: creation.createdAt,
    ...(creation.expiresAt === undefined
      ? {}
      : { expiresAt: creation.expiresAt }),
    family: input.family,
    idempotency: creation.idempotency,
    input,
    inputDigest: creation.inputDigest,
    inputSizeBytes: creation.inputSizeBytes,
    interaction: { state: "none" },
    jobId: creation.jobId,
    limits: creation.limits ?? DEFAULT_ASYNC_JOB_LIMITS_V1,
    orchestration: {
      dependencyJobIds: [...(orchestration?.dependencyJobIds ?? [])],
      expectedChildJobIds: [...(orchestration?.expectedChildJobIds ?? [])],
      failurePolicy: orchestration?.failurePolicy ?? "fail-parent",
      ...(parentJobId === undefined ? {} : { parentJobId }),
      rootJobId,
    },
    ownership: context.ownership,
    queuedAt: creation.createdAt,
    recordVersion: 1,
    reservation: creation.reservation,
    state: "queued",
    updatedAt: creation.createdAt,
  };
  const job = parseAsyncJobRecordV1(candidate);
  return {
    job,
    queueEnvelope: createQueueEnvelope(job, creation.createdAt),
    transition: asyncJobTransitionV1Schema.parse({
      at: creation.createdAt,
      reason: "created",
      recordVersion: 1,
      to: "queued",
    }),
  };
}
interface CommandBase {
  readonly at: string;
  readonly expectedInputDigest: AsyncJobRecordV1["inputDigest"];
  readonly expectedRecordVersion: number;
}

export interface CancelAsyncJobChildFromParentCommandV1 {
  readonly at: string;
  readonly childJobId: AsyncJobId;
  readonly expectedInputDigest: AsyncJobRecordV1["inputDigest"];
  readonly expectedParentInputDigest: AsyncJobRecordV1["inputDigest"];
  readonly expectedParentRecordVersion: number;
  readonly expectedRecordVersion: number;
}

export type AsyncJobHandlerResumePolicyV1 =
  "checkpoint-required" | "restart-from-input" | "not-resumable";

export interface AsyncJobHandlerRegistrationV1 {
  readonly family: AsyncJobRecordV1["family"];
  readonly handlerId: AsyncJobCheckpointV1["handlerId"];
  readonly handlerVersion: string;
  readonly resumePolicy: AsyncJobHandlerResumePolicyV1;
}

export type AsyncJobLifecycleCommandV1 =
  | (CommandBase & {
      readonly attemptId: AsyncJobAttemptV1["attemptId"];
      readonly dependencies: readonly AsyncJobRecordV1[];
      readonly handler: AsyncJobHandlerRegistrationV1;
      readonly kind: "claim";
      readonly leaseExpiresAt: string;
      readonly resumedFrom?: {
        readonly checkpointId: AsyncJobCheckpointV1["checkpointId"];
        readonly interactionId?: string;
      };
      readonly workerId: NonNullable<AsyncJobAttemptV1["lease"]>["workerId"];
    })
  | (CommandBase & {
      readonly attemptId: AsyncJobAttemptV1["attemptId"];
      readonly kind: "heartbeat";
      readonly leaseExpiresAt: string;
      readonly workerId: NonNullable<AsyncJobAttemptV1["lease"]>["workerId"];
    })
  | (CommandBase & {
      readonly attemptId: AsyncJobAttemptV1["attemptId"];
      readonly kind: "record-progress";
      readonly progress: Omit<AsyncJobProgressV1, "updatedAt">;
      readonly workerId: NonNullable<AsyncJobAttemptV1["lease"]>["workerId"];
    })
  | (CommandBase & {
      readonly attemptId: AsyncJobAttemptV1["attemptId"];
      readonly checkpoint: AsyncJobCheckpointV1;
      readonly handler: AsyncJobHandlerRegistrationV1;
      readonly kind: "record-checkpoint";
      readonly workerId: NonNullable<AsyncJobAttemptV1["lease"]>["workerId"];
    })
  | (CommandBase & {
      readonly attemptId: AsyncJobAttemptV1["attemptId"];
      readonly handler: AsyncJobHandlerRegistrationV1;
      readonly kind: "complete-attempt";
      readonly outcome: unknown;
      readonly workerId: NonNullable<AsyncJobAttemptV1["lease"]>["workerId"];
    })
  | (CommandBase & {
      readonly context: AsyncJobTrustedContextV1;
      readonly kind: "request-cancellation";
    })
  | (CommandBase & {
      readonly attemptId: AsyncJobAttemptV1["attemptId"];
      readonly kind: "acknowledge-cancellation";
      readonly workerId: NonNullable<AsyncJobAttemptV1["lease"]>["workerId"];
    })
  | (CommandBase & {
      readonly checkpointId: AsyncJobCheckpointV1["checkpointId"];
      readonly context: AsyncJobTrustedContextV1;
      readonly handler: AsyncJobHandlerRegistrationV1;
      readonly interactionId: string;
      readonly kind: "resume-user-input";
      readonly userResponse: AsyncJobObjectReferenceV1;
    })
  | (CommandBase & { readonly kind: "expire" })
  | (CommandBase & {
      readonly kind: "supersede";
      readonly replacement: AsyncJobRecordV1;
    })
  | (CommandBase & {
      readonly handler: AsyncJobHandlerRegistrationV1 | null;
      readonly kind: "reconcile-orphan";
    });
function assertCommandAuthority(
  job: AsyncJobRecordV1,
  command: CommandBase,
): void {
  if (job.recordVersion !== command.expectedRecordVersion) {
    fail(
      "stale-record-version",
      "$.expectedRecordVersion",
      "The job record changed before this lifecycle command was applied.",
    );
  }
  if (job.inputDigest !== command.expectedInputDigest) {
    fail(
      "input-authority-mismatch",
      "$.expectedInputDigest",
      "The lifecycle command does not target the immutable job input.",
    );
  }
  assertAtOrAfter(command.at, job.updatedAt, "$.at");
}

function isTerminal(state: AsyncJobStateV1): boolean {
  return (
    state === "succeeded" ||
    state === "failed" ||
    state === "canceled" ||
    state === "expired" ||
    state === "superseded"
  );
}

function assertTransition(from: AsyncJobStateV1, to: AsyncJobStateV1): void {
  if (
    from !== to &&
    !(
      ASYNC_JOB_STATE_TRANSITIONS_V1[from] as readonly AsyncJobStateV1[]
    ).includes(to)
  ) {
    fail(
      "invalid-state-transition",
      "$.state",
      "The requested Async Job v1 state transition is not permitted.",
    );
  }
}

function createQueueEnvelope(
  job: AsyncJobRecordV1,
  availableAt: string,
): AsyncJobQueueEnvelopeV1 {
  return asyncJobQueueEnvelopeV1Schema.parse({
    attemptNumber: job.attempts.length + 1,
    availableAt,
    contractVersion: 1,
    correlationId: job.correlationId,
    family: job.family,
    inputDigest: job.inputDigest,
    jobId: job.jobId,
    ownership: job.ownership,
    recordVersion: job.recordVersion,
  });
}

function mutationResult(
  previous: AsyncJobRecordV1,
  candidate: unknown,
  reason: AsyncJobTransitionV1["reason"],
  queueAt?: string,
): AsyncJobLifecycleResultV1 {
  const job = parseAsyncJobRecordV1(candidate);
  assertTransition(previous.state, job.state);
  const transition = asyncJobTransitionV1Schema.parse({
    at: job.updatedAt,
    from: previous.state,
    reason,
    recordVersion: job.recordVersion,
    to: job.state,
  });
  return {
    job,
    ...(queueAt === undefined
      ? {}
      : { queueEnvelope: createQueueEnvelope(job, queueAt) }),
    transition,
  };
}

function unchangedResult(job: AsyncJobRecordV1): AsyncJobLifecycleResultV1 {
  return { job };
}

function nextVersion(job: AsyncJobRecordV1, at: string) {
  return { recordVersion: job.recordVersion + 1, updatedAt: at };
}

type RunningAsyncJobAttemptV1 = AsyncJobAttemptV1 & {
  readonly lease: NonNullable<AsyncJobAttemptV1["lease"]>;
  readonly state: "running";
};

function activeAttempt(job: AsyncJobRecordV1): {
  readonly attempt: RunningAsyncJobAttemptV1;
  readonly index: number;
} {
  const index = job.attempts.length - 1;
  const attempt = job.attempts[index];
  if (job.state !== "running" || attempt?.state !== "running") {
    fail(
      "job-not-running",
      "$.state",
      "The job has no active running attempt.",
    );
  }
  return { attempt: attempt as RunningAsyncJobAttemptV1, index };
}

function assertWorker(
  job: AsyncJobRecordV1,
  attemptId: AsyncJobAttemptV1["attemptId"],
  workerId: NonNullable<AsyncJobAttemptV1["lease"]>["workerId"],
  at: string,
  allowExpired = false,
): { readonly attempt: RunningAsyncJobAttemptV1; readonly index: number } {
  const active = activeAttempt(job);
  if (
    active.attempt.attemptId !== attemptId ||
    active.attempt.lease.workerId !== workerId
  ) {
    fail(
      "worker-lease-mismatch",
      "$.workerId",
      "The worker does not own the active attempt lease.",
    );
  }
  if (
    !allowExpired &&
    epoch(at, "$.at") >=
      epoch(
        active.attempt.lease.leaseExpiresAt,
        "$.attempt.lease.leaseExpiresAt",
      )
  ) {
    fail(
      "worker-lease-expired",
      "$.at",
      "The active attempt lease has expired.",
    );
  }
  return active;
}

function isExpirationDue(job: AsyncJobRecordV1, at: string): boolean {
  return (
    job.expiresAt !== undefined &&
    epoch(at, "$.at") >= epoch(job.expiresAt, "$.job.expiresAt")
  );
}

function boundedAttemptRuntimeSeconds(
  job: AsyncJobRecordV1,
  attempt: AsyncJobAttemptV1,
  at: string,
): number {
  const atEpoch = epoch(at, "$.at");
  const startedEpoch = epoch(attempt.startedAt, "$.attempt.startedAt");
  if (atEpoch < startedEpoch) {
    fail(
      "invalid-time-order",
      "$.at",
      "Attempt completion cannot precede attempt start.",
    );
  }
  const otherRuntime = job.attempts
    .filter(
      (candidate) =>
        candidate.attemptId !== attempt.attemptId &&
        candidate.state !== "running",
    )
    .reduce((total, candidate) => total + candidate.runtimeSeconds, 0);
  const remainingRuntime = Math.max(
    0,
    job.limits.runtimeSeconds - otherRuntime,
  );
  const leaseBoundary =
    attempt.lease === undefined
      ? atEpoch
      : epoch(attempt.lease.leaseExpiresAt, "$.attempt.lease.leaseExpiresAt");
  const expirationBoundary =
    job.expiresAt === undefined
      ? atEpoch
      : epoch(job.expiresAt, "$.job.expiresAt");
  const effectiveEnd = Math.max(
    startedEpoch,
    Math.min(atEpoch, leaseBoundary, expirationBoundary),
  );
  return Math.min(
    remainingRuntime,
    Math.ceil((effectiveEnd - startedEpoch) / 1_000),
  );
}

function completedAttempt(
  job: AsyncJobRecordV1,
  attempt: AsyncJobAttemptV1,
  state: "succeeded" | "failed" | "canceled" | "orphaned",
  at: string,
  failure?: AsyncJobFailureV1,
  retryDisposition?:
    | { readonly kind: "retry"; readonly notBefore: string }
    | { readonly kind: "do-not-retry" },
): AsyncJobAttemptV1 {
  return asyncJobAttemptV1Schema.parse({
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    completedAt: at,
    ...(failure === undefined ? {} : { failure }),
    ...(attempt.resumedFromCheckpointId === undefined
      ? {}
      : { resumedFromCheckpointId: attempt.resumedFromCheckpointId }),
    ...(retryDisposition === undefined ? {} : { retryDisposition }),
    runtimeSeconds: boundedAttemptRuntimeSeconds(job, attempt, at),
    startedAt: attempt.startedAt,
    state,
  });
}

function totalRuntimeSeconds(
  job: AsyncJobRecordV1,
  activeRuntimeSeconds = 0,
): number {
  return (
    job.attempts
      .filter((attempt) => attempt.state !== "running")
      .reduce((total, attempt) => total + attempt.runtimeSeconds, 0) +
    activeRuntimeSeconds
  );
}

function retryDelaySeconds(attemptNumber: number): number {
  return Math.min(900, 5 * 2 ** Math.max(0, attemptNumber - 1));
}

export function getAsyncJobRetryDelaySecondsV1(attemptNumber: number): number {
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    fail(
      "attempt-limit-exceeded",
      "$.attemptNumber",
      "Retry calculation requires a positive attempt number.",
    );
  }
  return retryDelaySeconds(attemptNumber);
}

function retryTime(
  job: AsyncJobRecordV1,
  at: string,
  attemptNumber: number,
  suggestedDelaySeconds = 0,
): string | undefined {
  const delay = Math.max(
    retryDelaySeconds(attemptNumber),
    suggestedDelaySeconds,
  );
  const candidate = addSeconds(at, delay);
  if (
    job.expiresAt !== undefined &&
    epoch(candidate, "$.retryAt") >= epoch(job.expiresAt, "$.job.expiresAt")
  ) {
    return undefined;
  }
  return candidate;
}

function nextRetryAt(job: AsyncJobRecordV1): string | undefined {
  const latest = job.attempts[job.attempts.length - 1];
  return latest?.retryDisposition?.kind === "retry"
    ? latest.retryDisposition.notBefore
    : undefined;
}

function queueAvailableAt(job: AsyncJobRecordV1): string {
  return (
    nextRetryAt(job) ??
    (job.interaction.state === "user-input-received"
      ? job.interaction.receivedAt
      : job.queuedAt)
  );
}

/**
 * Reconstructs the one authoritative queued delivery envelope after a
 * record-before-publish crash. Queue transports may deliver it repeatedly;
 * recordVersion and inputDigest fence stale or mismatched work.
 */
export function deriveAsyncJobQueueEnvelopeV1(
  jobInput: unknown,
): AsyncJobQueueEnvelopeV1 {
  const job = parseAsyncJobRecordV1(jobInput);
  if (job.state !== "queued") {
    fail(
      "invalid-state-transition",
      "$.state",
      "Only a queued job has a dispatch envelope.",
    );
  }
  return createQueueEnvelope(job, queueAvailableAt(job));
}

type AsyncJobTrustedPrincipalContextV1 = AsyncJobTrustedContextV1 & {
  readonly actor: Extract<
    AsyncJobTrustedContextV1["actor"],
    { kind: "principal" }
  >;
};

function assertTrustedPrincipalContext(
  job: AsyncJobRecordV1,
  contextInput: AsyncJobTrustedContextV1,
): AsyncJobTrustedPrincipalContextV1 {
  const context = asyncJobTrustedContextV1Schema.parse(contextInput);
  if (
    context.actor.kind !== "principal" ||
    context.ownership.organizationId !== job.ownership.organizationId ||
    context.ownership.projectId !== job.ownership.projectId
  ) {
    fail(
      "actor-authority-mismatch",
      "$.context",
      "The command requires verified principal context with exact job ownership.",
    );
  }
  return context as AsyncJobTrustedPrincipalContextV1;
}

function assertHandlerRegistration(
  job: AsyncJobRecordV1,
  handler: AsyncJobHandlerRegistrationV1,
): void {
  const handlerId = namespacedIdentifierSchema.safeParse(handler.handlerId);
  const family = asyncJobFamilyV1Schema.safeParse(handler.family);
  if (
    !handlerId.success ||
    !family.success ||
    handler.family !== job.family ||
    handler.handlerVersion.length < 1 ||
    handler.handlerVersion.length > 128 ||
    !["checkpoint-required", "restart-from-input", "not-resumable"].includes(
      handler.resumePolicy,
    )
  ) {
    fail(
      "handler-registration-mismatch",
      "$.handler",
      "The trusted handler registration does not match this job family.",
    );
  }
}

function validateDependencies(
  job: AsyncJobRecordV1,
  dependencies: readonly AsyncJobRecordV1[],
): void {
  const expected = [...job.orchestration.dependencyJobIds].sort(compareText);
  const actual = [...dependencies.map((dependency) => dependency.jobId)].sort(
    compareText,
  );
  if (
    expected.length !== actual.length ||
    expected.some((jobId, index) => jobId !== actual[index])
  ) {
    fail(
      "dependency-set-mismatch",
      "$.dependencies",
      "The supplied dependency set is not exact.",
    );
  }
  for (const dependency of dependencies) {
    if (
      dependency.ownership.organizationId !== job.ownership.organizationId ||
      dependency.ownership.projectId !== job.ownership.projectId ||
      dependency.jobId === job.jobId
    ) {
      fail(
        "dependency-authority-mismatch",
        "$.dependencies",
        "A dependency is outside the job ownership boundary.",
      );
    }
    if (dependency.state !== "succeeded") {
      fail(
        "dependency-blocked",
        "$.dependencies",
        "Every dependency must succeed before the job can be claimed.",
      );
    }
  }
}

function findCheckpoint(
  job: AsyncJobRecordV1,
  checkpointId: AsyncJobCheckpointV1["checkpointId"],
): AsyncJobCheckpointV1 {
  const checkpoint = job.checkpoints.find(
    (candidate) => candidate.checkpointId === checkpointId,
  );
  if (checkpoint === undefined) {
    fail(
      "checkpoint-not-found",
      "$.checkpointId",
      "The durable checkpoint does not exist on this job.",
    );
  }
  return checkpoint;
}

function assertCheckpointCompatible(
  job: AsyncJobRecordV1,
  checkpoint: AsyncJobCheckpointV1,
  handler: AsyncJobHandlerRegistrationV1,
): void {
  assertHandlerRegistration(job, handler);
  if (checkpoint.inputDigest !== job.inputDigest) {
    fail(
      "checkpoint-authority-mismatch",
      "$.checkpoint.inputDigest",
      "The checkpoint does not bind the immutable job input.",
    );
  }
  if (
    checkpoint.handlerId !== handler.handlerId ||
    checkpoint.handlerVersion !== handler.handlerVersion
  ) {
    fail(
      "checkpoint-handler-mismatch",
      "$.checkpoint.handlerVersion",
      "The checkpoint is not compatible with the trusted handler registration.",
    );
  }
}

function appendCheckpoint(
  job: AsyncJobRecordV1,
  checkpointInput: AsyncJobCheckpointV1,
  active: { readonly attempt: AsyncJobAttemptV1 },
  at: string,
  handler: AsyncJobHandlerRegistrationV1,
): {
  readonly checkpoints: readonly AsyncJobCheckpointV1[];
  readonly latestCheckpointId: AsyncJobCheckpointV1["checkpointId"];
} {
  const parsed = asyncJobCheckpointV1Schema.safeParse(checkpointInput);
  if (!parsed.success) {
    fail(
      "checkpoint-authority-mismatch",
      "$.checkpoint",
      "The handler checkpoint is invalid.",
    );
  }
  const checkpoint = parsed.data;
  assertCheckpointCompatible(job, checkpoint, handler);
  if (
    checkpoint.attemptNumber !== active.attempt.attemptNumber ||
    checkpoint.inputDigest !== job.inputDigest
  ) {
    fail(
      "checkpoint-authority-mismatch",
      "$.checkpoint",
      "The checkpoint does not identify the active attempt and exact input.",
    );
  }
  if (checkpoint.createdAt !== at) {
    fail(
      "invalid-time-order",
      "$.checkpoint.createdAt",
      "Checkpoint creation time must equal the lifecycle command time.",
    );
  }
  if (
    checkpoint.sequence !== job.checkpoints.length + 1 ||
    job.checkpoints.some(
      (existing) => existing.checkpointId === checkpoint.checkpointId,
    )
  ) {
    fail(
      "checkpoint-sequence-invalid",
      "$.checkpoint.sequence",
      "Checkpoints require unique IDs and contiguous one-based sequences.",
    );
  }
  if (job.checkpoints.length >= job.limits.checkpointCount) {
    fail(
      "checkpoint-limit-exceeded",
      "$.checkpoints",
      "The configured checkpoint count limit has been reached.",
    );
  }
  if (checkpoint.state.sizeBytes > job.limits.checkpointBytes) {
    fail(
      "checkpoint-limit-exceeded",
      "$.checkpoint.state.sizeBytes",
      "The checkpoint exceeds the configured byte limit.",
    );
  }
  return {
    checkpoints: [...job.checkpoints, checkpoint],
    latestCheckpointId: checkpoint.checkpointId,
  };
}
function cancelRunningJob(
  job: AsyncJobRecordV1,
  active: { readonly attempt: AsyncJobAttemptV1; readonly index: number },
  at: string,
): unknown {
  if (job.cancellation.state !== "requested") {
    fail(
      "cancellation-not-requested",
      "$.cancellation",
      "Cancellation must be durably requested before acknowledgement.",
    );
  }
  const attempts = [...job.attempts];
  attempts[active.index] = completedAttempt(
    job,
    active.attempt,
    "canceled",
    at,
  );
  return {
    ...job,
    ...nextVersion(job, at),
    attempts,
    cancellation: {
      acknowledgedAt: at,
      requestedAt: job.cancellation.requestedAt,
      requestedBy: job.cancellation.requestedBy,
      state: "acknowledged",
    },
    completedAt: at,
    state: "canceled",
  };
}

function claimJob(
  job: AsyncJobRecordV1,
  command: Extract<AsyncJobLifecycleCommandV1, { kind: "claim" }>,
): AsyncJobLifecycleResultV1 {
  if (job.state !== "queued") {
    fail(
      "invalid-state-transition",
      "$.state",
      "Only a queued job can be claimed.",
    );
  }
  if (isExpirationDue(job, command.at)) {
    fail("job-expired", "$.at", "The job must be expired instead of claimed.");
  }
  assertHandlerRegistration(job, command.handler);
  const retryAt = nextRetryAt(job);
  if (
    retryAt !== undefined &&
    epoch(command.at, "$.at") < epoch(retryAt, "$.attempt.retryDisposition")
  ) {
    fail(
      "invalid-time-order",
      "$.at",
      "The deterministic retry backoff has not elapsed.",
    );
  }
  validateDependencies(job, command.dependencies);
  if (job.attempts.length >= job.limits.attemptCount) {
    fail(
      "attempt-limit-exceeded",
      "$.attempts",
      "The configured attempt count limit has been reached.",
    );
  }
  if (totalRuntimeSeconds(job) >= job.limits.runtimeSeconds) {
    fail(
      "runtime-limit-exceeded",
      "$.attempts",
      "The configured total runtime limit has been reached.",
    );
  }
  if (job.cancellation.state !== "none") {
    fail(
      "invalid-state-transition",
      "$.cancellation",
      "A job with requested cancellation cannot be claimed.",
    );
  }
  const claimedAt = epoch(command.at, "$.at");
  const leaseExpiresAt = epoch(command.leaseExpiresAt, "$.leaseExpiresAt");
  if (leaseExpiresAt <= claimedAt) {
    fail(
      "invalid-lease",
      "$.leaseExpiresAt",
      "A worker lease must expire after it is claimed.",
    );
  }
  if (
    job.expiresAt !== undefined &&
    leaseExpiresAt > epoch(job.expiresAt, "$.job.expiresAt")
  ) {
    fail(
      "invalid-lease",
      "$.leaseExpiresAt",
      "A worker lease cannot extend beyond job expiration.",
    );
  }
  const remainingRuntime = job.limits.runtimeSeconds - totalRuntimeSeconds(job);
  if (leaseExpiresAt > claimedAt + remainingRuntime * 1_000) {
    fail(
      "runtime-limit-exceeded",
      "$.leaseExpiresAt",
      "The worker lease extends beyond the remaining runtime budget.",
    );
  }
  if (job.attempts.some((attempt) => attempt.attemptId === command.attemptId)) {
    fail(
      "worker-lease-mismatch",
      "$.attemptId",
      "Attempt identities cannot be reused.",
    );
  }

  const isRetry = job.attempts.length > 0;
  const interaction = job.interaction;
  let resumedFromCheckpointId: AsyncJobCheckpointV1["checkpointId"] | undefined;
  if (command.resumedFrom !== undefined) {
    if (command.handler.resumePolicy !== "checkpoint-required") {
      fail(
        "handler-registration-mismatch",
        "$.handler.resumePolicy",
        "Only a checkpoint-resumable handler may claim from a checkpoint.",
      );
    }
    const checkpoint = findCheckpoint(job, command.resumedFrom.checkpointId);
    assertCheckpointCompatible(job, checkpoint, command.handler);
    if (job.latestCheckpointId !== checkpoint.checkpointId) {
      fail(
        "checkpoint-authority-mismatch",
        "$.resumedFrom.checkpointId",
        "A claim can resume only the latest durable checkpoint.",
      );
    }
    resumedFromCheckpointId = checkpoint.checkpointId;
  }

  if (interaction.state === "user-input-received") {
    if (
      command.resumedFrom?.interactionId !== interaction.interactionId ||
      command.handler.handlerId !== interaction.handlerId ||
      command.handler.handlerVersion !== interaction.handlerVersion
    ) {
      fail(
        "checkpoint-authority-mismatch",
        "$.resumedFrom",
        "The resumed claim must bind the exact durable user interaction and checkpoint.",
      );
    }
  } else if (command.resumedFrom?.interactionId !== undefined) {
    fail(
      "checkpoint-authority-mismatch",
      "$.resumedFrom.interactionId",
      "A claim cannot bind an interaction that has not been durably received.",
    );
  }

  if (isRetry) {
    if (command.handler.resumePolicy === "not-resumable") {
      fail(
        "handler-registration-mismatch",
        "$.handler.resumePolicy",
        "The registered handler does not permit another attempt.",
      );
    }
    if (
      command.handler.resumePolicy === "checkpoint-required" &&
      command.resumedFrom === undefined
    ) {
      fail(
        "checkpoint-not-found",
        "$.resumedFrom",
        "The registered handler requires an exact durable checkpoint to resume.",
      );
    }
    if (
      command.handler.resumePolicy === "restart-from-input" &&
      command.resumedFrom !== undefined
    ) {
      fail(
        "handler-registration-mismatch",
        "$.handler.resumePolicy",
        "A restart-from-input handler cannot claim from checkpoint state.",
      );
    }
  } else if (command.resumedFrom !== undefined) {
    fail(
      "checkpoint-authority-mismatch",
      "$.resumedFrom",
      "An initial attempt cannot resume prior checkpoint state.",
    );
  }

  const attempt = asyncJobAttemptV1Schema.parse({
    attemptId: command.attemptId,
    attemptNumber: job.attempts.length + 1,
    lease: {
      heartbeatAt: command.at,
      leaseExpiresAt: command.leaseExpiresAt,
      workerId: command.workerId,
    },
    ...(resumedFromCheckpointId === undefined
      ? {}
      : { resumedFromCheckpointId }),
    runtimeSeconds: 0,
    startedAt: command.at,
    state: "running",
  });
  return mutationResult(
    job,
    {
      ...job,
      ...nextVersion(job, command.at),
      attempts: [...job.attempts, attempt],
      progress: {
        completedUnits: job.progress?.completedUnits ?? 0,
        phase: "cloudmarkup.job.running",
        sequence: (job.progress?.sequence ?? 0) + 1,
        ...(job.progress?.totalUnits === undefined
          ? {}
          : { totalUnits: job.progress.totalUnits }),
        updatedAt: command.at,
      },
      ...(job.startedAt === undefined ? { startedAt: command.at } : {}),
      state: "running",
    },
    "worker-claimed",
  );
}
function heartbeatJob(
  job: AsyncJobRecordV1,
  command: Extract<AsyncJobLifecycleCommandV1, { kind: "heartbeat" }>,
): AsyncJobLifecycleResultV1 {
  const active = assertWorker(
    job,
    command.attemptId,
    command.workerId,
    command.at,
  );
  if (
    epoch(command.leaseExpiresAt, "$.leaseExpiresAt") <=
    epoch(active.attempt.lease.leaseExpiresAt, "$.attempt.lease.leaseExpiresAt")
  ) {
    fail(
      "invalid-lease",
      "$.leaseExpiresAt",
      "A heartbeat must extend the active lease.",
    );
  }
  if (
    job.expiresAt !== undefined &&
    epoch(command.leaseExpiresAt, "$.leaseExpiresAt") >
      epoch(job.expiresAt, "$.job.expiresAt")
  ) {
    fail(
      "invalid-lease",
      "$.leaseExpiresAt",
      "A worker lease cannot extend beyond job expiration.",
    );
  }
  const runtime = elapsedSeconds(active.attempt.startedAt, command.at);
  const consumed = totalRuntimeSeconds(job, runtime);
  if (
    consumed > job.limits.runtimeSeconds ||
    epoch(command.leaseExpiresAt, "$.leaseExpiresAt") >
      epoch(command.at, "$.at") + (job.limits.runtimeSeconds - consumed) * 1_000
  ) {
    fail(
      "runtime-limit-exceeded",
      "$.leaseExpiresAt",
      "The heartbeat exceeds the remaining runtime budget.",
    );
  }
  const attempts = [...job.attempts];
  attempts[active.index] = asyncJobAttemptV1Schema.parse({
    ...active.attempt,
    lease: {
      heartbeatAt: command.at,
      leaseExpiresAt: command.leaseExpiresAt,
      workerId: command.workerId,
    },
    runtimeSeconds: runtime,
  });
  return mutationResult(
    job,
    { ...job, ...nextVersion(job, command.at), attempts },
    "progress-checkpoint",
  );
}

function recordProgress(
  job: AsyncJobRecordV1,
  command: Extract<AsyncJobLifecycleCommandV1, { kind: "record-progress" }>,
): AsyncJobLifecycleResultV1 {
  assertWorker(job, command.attemptId, command.workerId, command.at);
  const progress = asyncJobProgressV1Schema.parse({
    ...command.progress,
    updatedAt: command.at,
  });
  if (
    progress.sequence !== (job.progress?.sequence ?? 0) + 1 ||
    progress.completedUnits < (job.progress?.completedUnits ?? 0) ||
    (job.progress?.totalUnits !== undefined &&
      progress.totalUnits !== job.progress.totalUnits)
  ) {
    fail(
      "progress-regression",
      "$.progress",
      "Progress must advance by one sequence without reducing completed work.",
    );
  }
  return mutationResult(
    job,
    { ...job, ...nextVersion(job, command.at), progress },
    "progress-checkpoint",
  );
}

function recordCheckpoint(
  job: AsyncJobRecordV1,
  command: Extract<AsyncJobLifecycleCommandV1, { kind: "record-checkpoint" }>,
): AsyncJobLifecycleResultV1 {
  const active = assertWorker(
    job,
    command.attemptId,
    command.workerId,
    command.at,
  );
  const checkpoint = appendCheckpoint(
    job,
    command.checkpoint,
    active,
    command.at,
    command.handler,
  );
  return mutationResult(
    job,
    { ...job, ...nextVersion(job, command.at), ...checkpoint },
    "progress-checkpoint",
  );
}

interface AsyncJobOutputMetricsV1 {
  readonly artifactCount: number;
  readonly referencedBytes: number;
}

function collectOutputMetrics(value: unknown): AsyncJobOutputMetricsV1 {
  let artifactCount = 0;
  let referencedBytes = 0;
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate === null || typeof candidate !== "object") {
      return;
    }
    const record = candidate as Readonly<Record<string, unknown>>;
    if (
      typeof record["objectId"] === "string" &&
      typeof record["sizeBytes"] === "number" &&
      typeof record["purpose"] === "string"
    ) {
      referencedBytes += record["sizeBytes"];
      return;
    }
    if (
      typeof record["artifactId"] === "string" &&
      record["availability"] !== undefined &&
      record["object"] !== undefined
    ) {
      artifactCount += 1;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return { artifactCount, referencedBytes };
}

function hasOutputLimitViolation(
  job: AsyncJobRecordV1,
  outcome: unknown,
): boolean {
  const metrics = collectOutputMetrics(outcome);
  const record =
    outcome !== null && typeof outcome === "object"
      ? (outcome as Readonly<Record<string, unknown>>)
      : undefined;
  const declaredBytes = record?.["outputSizeBytes"];
  return (
    metrics.artifactCount > job.limits.artifactCount ||
    metrics.referencedBytes > job.limits.outputBytes ||
    (typeof declaredBytes === "number" &&
      (declaredBytes > job.limits.outputBytes ||
        metrics.referencedBytes > declaredBytes))
  );
}

function failRunningAttemptSafely(
  job: AsyncJobRecordV1,
  active: { readonly attempt: AsyncJobAttemptV1; readonly index: number },
  at: string,
  failureKind: AsyncJobSafeFailureKindV1,
): AsyncJobLifecycleResultV1 {
  const failure = createAsyncJobFailureV1(failureKind);
  const attempts = [...job.attempts];
  attempts[active.index] = completedAttempt(
    job,
    active.attempt,
    "failed",
    at,
    failure,
    { kind: "do-not-retry" },
  );
  return mutationResult(
    job,
    {
      ...job,
      ...nextVersion(job, at),
      attempts,
      completedAt: at,
      failure,
      state: "failed",
    },
    "handler-failed",
  );
}

function completeAttempt(
  job: AsyncJobRecordV1,
  command: Extract<AsyncJobLifecycleCommandV1, { kind: "complete-attempt" }>,
): AsyncJobLifecycleResultV1 {
  const active = assertWorker(
    job,
    command.attemptId,
    command.workerId,
    command.at,
  );
  assertHandlerRegistration(job, command.handler);
  if (job.cancellation.state === "requested") {
    return mutationResult(
      job,
      cancelRunningJob(job, active, command.at),
      "cancellation-acknowledged",
    );
  }

  const parsedOutcome = asyncJobHandlerOutcomeV1Schema.safeParse(
    command.outcome,
  );
  if (!parsedOutcome.success) {
    return failRunningAttemptSafely(
      job,
      active,
      command.at,
      hasOutputLimitViolation(job, command.outcome)
        ? "output-limit-exceeded"
        : "handler-output-invalid",
    );
  }
  const outcome = parsedOutcome.data;
  const runtime = boundedAttemptRuntimeSeconds(job, active.attempt, command.at);
  if (totalRuntimeSeconds(job, runtime) > job.limits.runtimeSeconds) {
    return failRunningAttemptSafely(
      job,
      active,
      command.at,
      "runtime-limit-exceeded",
    );
  }
  if (outcome.outcome === "canceled") {
    return failRunningAttemptSafely(
      job,
      active,
      command.at,
      "handler-output-invalid",
    );
  }
  if (outcome.outcome === "succeeded") {
    if (hasOutputLimitViolation(job, outcome)) {
      return failRunningAttemptSafely(
        job,
        active,
        command.at,
        "output-limit-exceeded",
      );
    }
    const attempts = [...job.attempts];
    attempts[active.index] = completedAttempt(
      job,
      active.attempt,
      "succeeded",
      command.at,
    );
    const candidate = {
      ...job,
      ...nextVersion(job, command.at),
      attempts,
      completedAt: command.at,
      output: outcome.output,
      outputSizeBytes: outcome.outputSizeBytes,
      progress: {
        completedUnits: job.progress?.totalUnits ?? 1,
        phase: "cloudmarkup.job.succeeded",
        sequence: (job.progress?.sequence ?? 0) + 1,
        totalUnits: job.progress?.totalUnits ?? 1,
        updatedAt: command.at,
      },
      state: "succeeded",
    };
    const stored = asyncJobRecordV1Schema.safeParse(candidate);
    if (!stored.success) {
      return failRunningAttemptSafely(
        job,
        active,
        command.at,
        hasOutputLimitViolation(job, outcome)
          ? "output-limit-exceeded"
          : "handler-output-invalid",
      );
    }
    return mutationResult(job, stored.data, "handler-succeeded");
  }
  if (outcome.outcome === "awaiting-user-input") {
    if (command.handler.resumePolicy !== "checkpoint-required") {
      return failRunningAttemptSafely(
        job,
        active,
        command.at,
        "checkpoint-incompatible",
      );
    }
    let checkpoint: ReturnType<typeof appendCheckpoint>;
    try {
      checkpoint = appendCheckpoint(
        job,
        outcome.checkpoint,
        active,
        command.at,
        command.handler,
      );
    } catch {
      return failRunningAttemptSafely(
        job,
        active,
        command.at,
        "checkpoint-incompatible",
      );
    }
    const attempts = [...job.attempts];
    attempts[active.index] = completedAttempt(
      job,
      active.attempt,
      "succeeded",
      command.at,
    );
    const candidate = {
      ...job,
      ...nextVersion(job, command.at),
      ...checkpoint,
      attempts,
      interaction: {
        checkpointId: checkpoint.latestCheckpointId,
        handlerId: command.handler.handlerId,
        handlerVersion: command.handler.handlerVersion,
        interactionId: outcome.interactionId,
        requestedAt: command.at,
        state: "awaiting-user-input",
      },
      progress: {
        completedUnits: job.progress?.completedUnits ?? 0,
        messageKey: outcome.messageKey,
        phase: "cloudmarkup.job.awaiting-user-input",
        sequence: (job.progress?.sequence ?? 0) + 1,
        ...(job.progress?.totalUnits === undefined
          ? {}
          : { totalUnits: job.progress.totalUnits }),
        updatedAt: command.at,
      },
      state: "awaiting-user-input",
    };
    const stored = asyncJobRecordV1Schema.safeParse(candidate);
    if (!stored.success) {
      return failRunningAttemptSafely(
        job,
        active,
        command.at,
        "handler-output-invalid",
      );
    }
    return mutationResult(job, stored.data, "user-input-required");
  }

  let checkpointFields: {
    readonly checkpoints?: readonly AsyncJobCheckpointV1[];
    readonly latestCheckpointId?: AsyncJobCheckpointV1["checkpointId"];
  } = {};
  if (outcome.checkpoint !== undefined) {
    try {
      checkpointFields = appendCheckpoint(
        job,
        outcome.checkpoint,
        active,
        command.at,
        command.handler,
      );
    } catch {
      return failRunningAttemptSafely(
        job,
        active,
        command.at,
        "checkpoint-incompatible",
      );
    }
  }

  const completedRuntime = totalRuntimeSeconds(job, runtime);
  const retryAt = retryTime(
    job,
    command.at,
    active.attempt.attemptNumber,
    outcome.failure.retryAfterSeconds,
  );
  const checkpointAvailable =
    checkpointFields.latestCheckpointId !== undefined ||
    job.latestCheckpointId !== undefined;
  const canRetry =
    outcome.failure.classification === "transient" &&
    active.attempt.attemptNumber < job.limits.attemptCount &&
    completedRuntime < job.limits.runtimeSeconds &&
    retryAt !== undefined &&
    command.handler.resumePolicy !== "not-resumable" &&
    (command.handler.resumePolicy !== "checkpoint-required" ||
      checkpointAvailable);

  let terminalFailure = outcome.failure;
  if (outcome.failure.classification === "transient" && !canRetry) {
    terminalFailure =
      active.attempt.attemptNumber >= job.limits.attemptCount
        ? createAsyncJobFailureV1("attempt-limit-exceeded")
        : completedRuntime >= job.limits.runtimeSeconds
          ? createAsyncJobFailureV1("runtime-limit-exceeded")
          : retryAt === undefined
            ? createAsyncJobFailureV1("retry-window-exhausted")
            : createAsyncJobFailureV1("checkpoint-incompatible");
  }

  const attempts = [...job.attempts];
  attempts[active.index] = completedAttempt(
    job,
    active.attempt,
    "failed",
    command.at,
    canRetry ? outcome.failure : terminalFailure,
    canRetry ? { kind: "retry", notBefore: retryAt } : { kind: "do-not-retry" },
  );
  if (canRetry) {
    return mutationResult(
      job,
      {
        ...job,
        ...nextVersion(job, command.at),
        ...checkpointFields,
        attempts,
        progress: {
          completedUnits: job.progress?.completedUnits ?? 0,
          messageKey: "cloudmarkup.job.retry-scheduled",
          phase: "cloudmarkup.job.queued",
          sequence: (job.progress?.sequence ?? 0) + 1,
          ...(job.progress?.totalUnits === undefined
            ? {}
            : { totalUnits: job.progress.totalUnits }),
          updatedAt: command.at,
        },
        state: "queued",
      },
      "retry-scheduled",
      retryAt,
    );
  }
  return mutationResult(
    job,
    {
      ...job,
      ...nextVersion(job, command.at),
      ...checkpointFields,
      attempts,
      completedAt: command.at,
      failure: terminalFailure,
      state: "failed",
    },
    "handler-failed",
  );
}
function requestCancellation(
  job: AsyncJobRecordV1,
  command: Extract<
    AsyncJobLifecycleCommandV1,
    { kind: "request-cancellation" }
  >,
): AsyncJobLifecycleResultV1 {
  const context = assertTrustedPrincipalContext(job, command.context);
  if (isTerminal(job.state) || job.cancellation.state !== "none") {
    return unchangedResult(job);
  }
  const requested = {
    requestedAt: command.at,
    requestedBy: context.actor.actorId,
    state: "requested",
  } as const;
  if (job.state === "running") {
    return mutationResult(
      job,
      {
        ...job,
        ...nextVersion(job, command.at),
        cancellation: requested,
      },
      "cancellation-requested",
    );
  }
  return mutationResult(
    job,
    {
      ...job,
      ...nextVersion(job, command.at),
      cancellation: {
        acknowledgedAt: command.at,
        requestedAt: command.at,
        requestedBy: context.actor.actorId,
        state: "acknowledged",
      },
      completedAt: command.at,
      state: "canceled",
    },
    "cancellation-acknowledged",
  );
}
function acknowledgeCancellation(
  job: AsyncJobRecordV1,
  command: Extract<
    AsyncJobLifecycleCommandV1,
    { kind: "acknowledge-cancellation" }
  >,
): AsyncJobLifecycleResultV1 {
  const active = assertWorker(
    job,
    command.attemptId,
    command.workerId,
    command.at,
  );
  return mutationResult(
    job,
    cancelRunningJob(job, active, command.at),
    "cancellation-acknowledged",
  );
}

function resumeUserInput(
  job: AsyncJobRecordV1,
  command: Extract<AsyncJobLifecycleCommandV1, { kind: "resume-user-input" }>,
): AsyncJobLifecycleResultV1 {
  if (job.state !== "awaiting-user-input") {
    fail(
      "invalid-state-transition",
      "$.state",
      "Only a job awaiting user input can be resumed.",
    );
  }
  assertTrustedPrincipalContext(job, command.context);
  if (job.cancellation.state !== "none") {
    fail(
      "invalid-state-transition",
      "$.cancellation",
      "Canceled work cannot be resumed.",
    );
  }
  const interaction = job.interaction;
  if (
    interaction.state !== "awaiting-user-input" ||
    interaction.interactionId !== command.interactionId ||
    interaction.checkpointId !== command.checkpointId
  ) {
    fail(
      "checkpoint-authority-mismatch",
      "$.interactionId",
      "The response must bind the exact active durable interaction.",
    );
  }
  const checkpoint = findCheckpoint(job, command.checkpointId);
  if (job.latestCheckpointId !== checkpoint.checkpointId) {
    fail(
      "checkpoint-authority-mismatch",
      "$.checkpointId",
      "Only the latest durable checkpoint can resume this job.",
    );
  }
  assertCheckpointCompatible(job, checkpoint, command.handler);
  if (
    command.handler.resumePolicy !== "checkpoint-required" ||
    command.handler.handlerId !== interaction.handlerId ||
    command.handler.handlerVersion !== interaction.handlerVersion
  ) {
    fail(
      "handler-registration-mismatch",
      "$.handler",
      "The response must use the exact trusted checkpoint-resume handler.",
    );
  }
  const candidate = {
    ...job,
    ...nextVersion(job, command.at),
    interaction: {
      ...interaction,
      receivedAt: command.at,
      state: "user-input-received",
      userResponse: command.userResponse,
    },
    progress: {
      completedUnits: job.progress?.completedUnits ?? 0,
      phase: "cloudmarkup.job.queued",
      sequence: (job.progress?.sequence ?? 0) + 1,
      ...(job.progress?.totalUnits === undefined
        ? {}
        : { totalUnits: job.progress.totalUnits }),
      updatedAt: command.at,
    },
    state: "queued",
  };
  const stored = asyncJobRecordV1Schema.safeParse(candidate);
  if (!stored.success) {
    fail(
      "input-authority-mismatch",
      "$.userResponse",
      "User input must be a durable non-expiring input-payload reference.",
    );
  }
  return mutationResult(job, stored.data, "user-input-received", command.at);
}
function closeRunningAttemptWithoutFailure(
  job: AsyncJobRecordV1,
  at: string,
): readonly AsyncJobAttemptV1[] {
  if (job.state !== "running") {
    return job.attempts;
  }
  const active = activeAttempt(job);
  const attempts = [...job.attempts];
  attempts[active.index] = completedAttempt(
    job,
    active.attempt,
    "canceled",
    at,
  );
  return attempts;
}

function expireJob(
  job: AsyncJobRecordV1,
  command: Extract<AsyncJobLifecycleCommandV1, { kind: "expire" }>,
): AsyncJobLifecycleResultV1 {
  if (isTerminal(job.state)) {
    return unchangedResult(job);
  }
  if (
    job.expiresAt === undefined ||
    epoch(command.at, "$.at") < epoch(job.expiresAt, "$.job.expiresAt")
  ) {
    fail(
      "job-expired",
      "$.expiresAt",
      "The job has not reached its explicit expiration time.",
    );
  }
  return mutationResult(
    job,
    {
      ...job,
      ...nextVersion(job, command.at),
      attempts: closeRunningAttemptWithoutFailure(job, command.at),
      completedAt: command.at,
      state: "expired",
    },
    "retention-expired",
  );
}

function assertSameOwnership(
  left: AsyncJobRecordV1,
  right: AsyncJobRecordV1,
  code: "parent-authority-mismatch" | "replacement-authority-mismatch",
): void {
  if (
    left.ownership.organizationId !== right.ownership.organizationId ||
    left.ownership.projectId !== right.ownership.projectId
  ) {
    fail(code, "$.ownership", "The jobs do not share exact trusted ownership.");
  }
}

function supersedeJob(
  job: AsyncJobRecordV1,
  command: Extract<AsyncJobLifecycleCommandV1, { kind: "supersede" }>,
): AsyncJobLifecycleResultV1 {
  const replacement = parseAsyncJobRecordV1(command.replacement);
  if (job.state === "superseded") {
    return job.supersededByJobId === replacement.jobId
      ? unchangedResult(job)
      : fail(
          "invalid-state-transition",
          "$.replacement.jobId",
          "A superseded job cannot change its replacement.",
        );
  }
  if (isTerminal(job.state)) {
    fail(
      "invalid-state-transition",
      "$.state",
      "Completed work cannot be rewritten as superseded.",
    );
  }
  assertSameOwnership(job, replacement, "replacement-authority-mismatch");
  if (
    replacement.jobId === job.jobId ||
    replacement.family !== job.family ||
    epoch(replacement.createdAt, "$.replacement.createdAt") <
      epoch(job.createdAt, "$.job.createdAt")
  ) {
    fail(
      "replacement-authority-mismatch",
      "$.replacement",
      "The replacement must be a distinct, same-family, later job.",
    );
  }
  const currentSubject = job.input.subject;
  const replacementSubject = replacement.input.subject;
  let justified = false;
  if (
    currentSubject.kind === "solution-revision" &&
    replacementSubject.kind === "solution-revision"
  ) {
    justified =
      currentSubject.solutionRevisionId !==
      replacementSubject.solutionRevisionId;
  } else if (
    currentSubject.kind === "draft" &&
    replacementSubject.kind === "draft"
  ) {
    justified =
      currentSubject.draftId === replacementSubject.draftId &&
      replacementSubject.draftVersion > currentSubject.draftVersion;
  }
  if (!justified) {
    fail(
      "supersession-not-justified",
      "$.replacement.input.subject",
      "Supersession requires a newer draft or a different immutable Solution Revision.",
    );
  }
  return mutationResult(
    job,
    {
      ...job,
      ...nextVersion(job, command.at),
      attempts: closeRunningAttemptWithoutFailure(job, command.at),
      completedAt: command.at,
      state: "superseded",
      supersededByJobId: replacement.jobId,
    },
    "revision-superseded",
  );
}

function failOrphanedJobSafely(
  job: AsyncJobRecordV1,
  active: { readonly attempt: AsyncJobAttemptV1; readonly index: number },
  at: string,
  failureKind: AsyncJobSafeFailureKindV1,
): AsyncJobLifecycleResultV1 {
  const failure = createAsyncJobFailureV1(failureKind);
  const attempts = [...job.attempts];
  attempts[active.index] = completedAttempt(
    job,
    active.attempt,
    "orphaned",
    at,
    undefined,
    { kind: "do-not-retry" },
  );
  return mutationResult(
    job,
    {
      ...job,
      ...nextVersion(job, at),
      attempts,
      completedAt: at,
      failure,
      state: "failed",
    },
    "orphan-reconciled",
  );
}

function reconcileOrphan(
  job: AsyncJobRecordV1,
  command: Extract<AsyncJobLifecycleCommandV1, { kind: "reconcile-orphan" }>,
): AsyncJobLifecycleResultV1 {
  const active = activeAttempt(job);
  if (
    epoch(command.at, "$.at") <
    epoch(active.attempt.lease.leaseExpiresAt, "$.attempt.lease.leaseExpiresAt")
  ) {
    fail(
      "job-not-orphaned",
      "$.at",
      "The active worker lease has not expired.",
    );
  }
  if (job.cancellation.state === "requested") {
    return mutationResult(
      job,
      cancelRunningJob(job, active, command.at),
      "orphan-reconciled",
    );
  }
  if (command.handler === null) {
    return failOrphanedJobSafely(
      job,
      active,
      command.at,
      "handler-not-supported",
    );
  }
  assertHandlerRegistration(job, command.handler);
  if (job.attempts.length >= job.limits.attemptCount) {
    return failOrphanedJobSafely(
      job,
      active,
      command.at,
      "attempt-limit-exceeded",
    );
  }
  const runtime = boundedAttemptRuntimeSeconds(job, active.attempt, command.at);
  if (totalRuntimeSeconds(job, runtime) >= job.limits.runtimeSeconds) {
    return failOrphanedJobSafely(
      job,
      active,
      command.at,
      "runtime-limit-exceeded",
    );
  }
  if (command.handler.resumePolicy === "not-resumable") {
    return failOrphanedJobSafely(
      job,
      active,
      command.at,
      "checkpoint-incompatible",
    );
  }
  if (command.handler.resumePolicy === "checkpoint-required") {
    if (job.latestCheckpointId === undefined) {
      return failOrphanedJobSafely(
        job,
        active,
        command.at,
        "checkpoint-incompatible",
      );
    }
    const checkpoint = findCheckpoint(job, job.latestCheckpointId);
    try {
      assertCheckpointCompatible(job, checkpoint, command.handler);
    } catch {
      return failOrphanedJobSafely(
        job,
        active,
        command.at,
        "checkpoint-incompatible",
      );
    }
  }
  const notBefore = retryTime(job, command.at, active.attempt.attemptNumber);
  if (notBefore === undefined) {
    return failOrphanedJobSafely(
      job,
      active,
      command.at,
      "retry-window-exhausted",
    );
  }
  const attempts = [...job.attempts];
  attempts[active.index] = completedAttempt(
    job,
    active.attempt,
    "orphaned",
    command.at,
    undefined,
    { kind: "retry", notBefore },
  );
  const candidate = {
    ...job,
    ...nextVersion(job, command.at),
    attempts,
    progress: {
      completedUnits: job.progress?.completedUnits ?? 0,
      messageKey: "cloudmarkup.job.orphan-reconciled",
      phase: "cloudmarkup.job.queued",
      sequence: (job.progress?.sequence ?? 0) + 1,
      ...(job.progress?.totalUnits === undefined
        ? {}
        : { totalUnits: job.progress.totalUnits }),
      updatedAt: command.at,
    },
    state: "queued",
  };
  return mutationResult(job, candidate, "orphan-reconciled", notBefore);
}
export function applyAsyncJobLifecycleCommandV1(
  jobInput: unknown,
  command: AsyncJobLifecycleCommandV1,
): AsyncJobLifecycleResultV1 {
  const job = parseAsyncJobRecordV1(jobInput);
  assertCommandAuthority(job, command);
  if (
    command.kind === "request-cancellation" ||
    command.kind === "resume-user-input"
  ) {
    assertTrustedPrincipalContext(job, command.context);
  }
  if (
    command.kind !== "expire" &&
    !isTerminal(job.state) &&
    isExpirationDue(job, command.at)
  ) {
    return expireJob(job, {
      at: command.at,
      expectedInputDigest: command.expectedInputDigest,
      expectedRecordVersion: command.expectedRecordVersion,
      kind: "expire",
    });
  }
  switch (command.kind) {
    case "claim":
      return claimJob(job, command);
    case "heartbeat":
      return heartbeatJob(job, command);
    case "record-progress":
      return recordProgress(job, command);
    case "record-checkpoint":
      return recordCheckpoint(job, command);
    case "complete-attempt":
      return completeAttempt(job, command);
    case "request-cancellation":
      return requestCancellation(job, command);
    case "acknowledge-cancellation":
      return acknowledgeCancellation(job, command);
    case "resume-user-input":
      return resumeUserInput(job, command);
    case "expire":
      return expireJob(job, command);
    case "supersede":
      return supersedeJob(job, command);
    case "reconcile-orphan":
      return reconcileOrphan(job, command);
  }
}

/** Host-only retention command. The host must verify an exact committed project
 * tombstone and permanent write closure. It grants no execution or erasure
 * authority and leaves storage uncertainty/financial disposition to their owners. */
export function cancelAsyncJobForProjectDeletionV1(input: {
  readonly job: unknown;
  readonly context: AsyncJobTrustedContextV1;
  readonly at: string;
  readonly expectedRecordVersion: number;
  readonly expectedInputDigest: AsyncJobRecordV1["inputDigest"];
  readonly deletion: {
    readonly recordVersion: number;
    readonly requestedAt: string;
  };
}): AsyncJobLifecycleResultV1 {
  const job = parseAsyncJobRecordV1(input.job);
  const context = asyncJobTrustedContextV1Schema.parse(input.context);
  assertCommandAuthority(job, input);
  if (
    context.actor.kind !== "system" ||
    context.actor.reason !== "retention" ||
    context.ownership.projectId === undefined ||
    context.ownership.organizationId !== job.ownership.organizationId ||
    context.ownership.projectId !== job.ownership.projectId ||
    context.correlationId !== job.correlationId ||
    !Number.isSafeInteger(input.deletion.recordVersion) ||
    input.deletion.recordVersion < 1
  )
    fail(
      "actor-authority-mismatch",
      "$.context",
      "Deletion cancellation requires exact host retention authority.",
    );
  assertAtOrAfter(
    input.at,
    input.deletion.requestedAt,
    "$.deletion.requestedAt",
  );
  if (isTerminal(job.state)) return unchangedResult(job);
  if (job.state === "running") {
    const active = activeAttempt(job);
    if (
      epoch(input.at, "$.at") <
      epoch(active.attempt.lease.leaseExpiresAt, "$.lease")
    )
      fail(
        "job-not-orphaned",
        "$.at",
        "A live execution lease still blocks deletion recovery.",
      );
  }
  if (isExpirationDue(job, input.at))
    return expireJob(job, { ...input, kind: "expire" });
  const cancellation =
    job.cancellation.state === "none"
      ? {
          state: "requested" as const,
          requestedAt: input.at,
          requestedBy:
            "deletion_" +
            hashCanonicalValue({
              ownership: job.ownership,
              ...input.deletion,
            }).slice(7),
        }
      : job.cancellation;
  const requested = parseAsyncJobRecordV1({ ...job, cancellation });
  if (requested.state === "running")
    return mutationResult(
      job,
      cancelRunningJob(requested, activeAttempt(requested), input.at),
      "cancellation-acknowledged",
    );
  return mutationResult(
    job,
    {
      ...requested,
      ...nextVersion(job, input.at),
      completedAt: input.at,
      state: "canceled",
      cancellation: {
        ...cancellation,
        state: "acknowledged",
        acknowledgedAt: input.at,
      },
    },
    "cancellation-acknowledged",
  );
}

export type AsyncJobSafeFailureKindV1 =
  | "attempt-limit-exceeded"
  | "checkpoint-incompatible"
  | "handler-input-invalid"
  | "handler-not-supported"
  | "handler-output-invalid"
  | "handler-permanent-failure"
  | "handler-transient-failure"
  | "internal-error"
  | "output-limit-exceeded"
  | "retry-window-exhausted"
  | "runtime-limit-exceeded";

const safeFailures = Object.freeze({
  "attempt-limit-exceeded": {
    classification: "permanent",
    code: "cloudmarkup.job.attempt-limit-exceeded",
    publicMessage: "job-limit-exceeded",
  },
  "checkpoint-incompatible": {
    classification: "permanent",
    code: "cloudmarkup.job.checkpoint-incompatible",
    publicMessage: "job-input-invalid",
  },
  "handler-input-invalid": {
    classification: "permanent",
    code: "cloudmarkup.job.input-invalid",
    publicMessage: "job-input-invalid",
  },
  "handler-not-supported": {
    classification: "permanent",
    code: "cloudmarkup.job.not-supported",
    publicMessage: "job-not-supported",
  },
  "handler-output-invalid": {
    classification: "permanent",
    code: "cloudmarkup.job.output-invalid",
    publicMessage: "job-internal-error",
  },
  "handler-permanent-failure": {
    classification: "permanent",
    code: "cloudmarkup.job.handler-failed",
    publicMessage: "job-internal-error",
  },
  "handler-transient-failure": {
    classification: "transient",
    code: "cloudmarkup.job.temporarily-unavailable",
    publicMessage: "job-temporarily-unavailable",
  },
  "internal-error": {
    classification: "permanent",
    code: "cloudmarkup.job.internal-error",
    publicMessage: "job-internal-error",
  },
  "output-limit-exceeded": {
    classification: "permanent",
    code: "cloudmarkup.job.output-limit-exceeded",
    publicMessage: "job-limit-exceeded",
  },
  "retry-window-exhausted": {
    classification: "permanent",
    code: "cloudmarkup.job.retry-window-exhausted",
    publicMessage: "job-expired",
  },
  "runtime-limit-exceeded": {
    classification: "permanent",
    code: "cloudmarkup.job.runtime-limit-exceeded",
    publicMessage: "job-limit-exceeded",
  },
} as const satisfies Record<
  AsyncJobSafeFailureKindV1,
  {
    readonly classification: "permanent" | "transient";
    readonly code: string;
    readonly publicMessage: AsyncJobFailureV1["publicMessage"];
  }
>);

export function createAsyncJobFailureV1(
  kind: AsyncJobSafeFailureKindV1,
  options: {
    readonly internalErrorId?: string;
    readonly retryAfterSeconds?: number;
  } = {},
): AsyncJobFailureV1 {
  const safe = safeFailures[kind];
  return asyncJobFailureV1Schema.parse({
    ...safe,
    ...(options.internalErrorId === undefined
      ? {}
      : { internalErrorId: options.internalErrorId }),
    ...(safe.classification === "transient" &&
    options.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: options.retryAfterSeconds }
      : {}),
  });
}

/** Unknown/raw failures deliberately collapse to one non-retryable safe code. */
export function sanitizeUnknownAsyncJobFailureV1(
  _failure: unknown,
  internalErrorId?: string,
): AsyncJobFailureV1 {
  return createAsyncJobFailureV1("internal-error", {
    ...(internalErrorId === undefined ? {} : { internalErrorId }),
  });
}

export type AsyncJobOrchestrationDecisionV1 =
  | { readonly kind: "ready" }
  | {
      readonly kind: "waiting";
      readonly missingChildJobIds: readonly AsyncJobId[];
      readonly nonterminalChildJobIds: readonly AsyncJobId[];
    }
  | {
      readonly failedChildJobIds: readonly AsyncJobId[];
      readonly kind: "fail-parent";
    }
  | {
      readonly cancelChildJobIds: readonly AsyncJobId[];
      readonly failedChildJobIds: readonly AsyncJobId[];
      readonly kind: "cancel-remaining";
    }
  | {
      readonly allChildrenTerminal: boolean;
      readonly failedChildJobIds: readonly AsyncJobId[];
      readonly kind: "continue-and-report";
      readonly nonterminalChildJobIds: readonly AsyncJobId[];
    };

export function evaluateAsyncJobChildrenV1(
  parentInput: unknown,
  childInputs: readonly unknown[],
): AsyncJobOrchestrationDecisionV1 {
  const parent = parseAsyncJobRecordV1(parentInput);
  const expectedChildJobIds = [
    ...parent.orchestration.expectedChildJobIds,
  ].sort(compareText);
  if (expectedChildJobIds.length === 0) {
    fail(
      "child-set-incomplete",
      "$.parent.orchestration.expectedChildJobIds",
      "Child orchestration requires a nonempty authoritative expected-child set.",
    );
  }
  const children = childInputs
    .map((child) => parseAsyncJobRecordV1(child))
    .sort((left, right) => compareText(left.jobId, right.jobId));
  if (
    children.some(
      (child, index) => index > 0 && children[index - 1]?.jobId === child.jobId,
    )
  ) {
    fail(
      "child-set-incomplete",
      "$.children",
      "The supplied child set cannot contain duplicate job identities.",
    );
  }
  for (const child of children) {
    assertSameOwnership(parent, child, "parent-authority-mismatch");
    if (
      child.orchestration.parentJobId !== parent.jobId ||
      child.orchestration.rootJobId !== parent.orchestration.rootJobId
    ) {
      fail(
        "parent-authority-mismatch",
        "$.children",
        "A child does not identify the exact parent and orchestration root.",
      );
    }
  }
  const actualChildJobIds = children.map((child) => child.jobId);
  const unexpectedChildJobIds = actualChildJobIds.filter(
    (jobId) => !expectedChildJobIds.includes(jobId),
  );
  if (unexpectedChildJobIds.length > 0) {
    fail(
      "child-set-incomplete",
      "$.children",
      "The supplied child set includes work outside the authoritative expected-child set.",
    );
  }
  const missingChildJobIds = expectedChildJobIds.filter(
    (jobId) => !actualChildJobIds.includes(jobId),
  );
  const nonterminalChildJobIds = children
    .filter((child) => !isTerminal(child.state))
    .map((child) => child.jobId);
  if (missingChildJobIds.length > 0) {
    return {
      kind: "waiting",
      missingChildJobIds,
      nonterminalChildJobIds,
    };
  }

  const failedChildJobIds = children
    .filter((child) => isTerminal(child.state) && child.state !== "succeeded")
    .map((child) => child.jobId);
  if (failedChildJobIds.length === 0) {
    return nonterminalChildJobIds.length === 0
      ? { kind: "ready" }
      : {
          kind: "waiting",
          missingChildJobIds: [],
          nonterminalChildJobIds,
        };
  }
  switch (parent.orchestration.failurePolicy) {
    case "fail-parent":
      return { failedChildJobIds, kind: "fail-parent" };
    case "cancel-remaining":
      return {
        cancelChildJobIds: nonterminalChildJobIds,
        failedChildJobIds,
        kind: "cancel-remaining",
      };
    case "continue-and-report":
      return {
        allChildrenTerminal: nonterminalChildJobIds.length === 0,
        failedChildJobIds,
        kind: "continue-and-report",
        nonterminalChildJobIds,
      };
  }
}

export function cancelAsyncJobChildFromParentV1(
  parentInput: unknown,
  childInputs: readonly unknown[],
  command: CancelAsyncJobChildFromParentCommandV1,
): AsyncJobLifecycleResultV1 {
  const parent = parseAsyncJobRecordV1(parentInput);
  assertCommandAuthority(parent, {
    at: command.at,
    expectedInputDigest: command.expectedParentInputDigest,
    expectedRecordVersion: command.expectedParentRecordVersion,
  });
  if (isTerminal(parent.state)) {
    fail(
      "invalid-state-transition",
      "$.parent.state",
      "A terminal parent cannot issue child cancellation.",
    );
  }
  if (parent.orchestration.failurePolicy !== "cancel-remaining") {
    fail(
      "invalid-state-transition",
      "$.parent.orchestration.failurePolicy",
      "Only cancel-remaining policy authorizes parent-issued child cancellation.",
    );
  }

  const children = childInputs.map((child) => parseAsyncJobRecordV1(child));
  const decision = evaluateAsyncJobChildrenV1(parent, children);
  if (decision.kind !== "cancel-remaining") {
    fail(
      "invalid-state-transition",
      "$.children",
      "The complete child set does not authorize remaining-child cancellation.",
    );
  }
  const child = children.find(
    (candidate) => candidate.jobId === command.childJobId,
  );
  if (child === undefined) {
    fail(
      "child-set-incomplete",
      "$.childJobId",
      "The cancellation target must belong to the complete authoritative child set.",
    );
  }
  assertCommandAuthority(child, command);

  const cancellationAlreadyApplied =
    child.state === "canceled" &&
    child.cancellation.state === "acknowledged" &&
    child.cancellation.requestedBy === parent.jobId;
  if (!decision.cancelChildJobIds.includes(child.jobId)) {
    if (cancellationAlreadyApplied) {
      return unchangedResult(child);
    }
    fail(
      "invalid-state-transition",
      "$.childJobId",
      "The orchestration decision does not authorize canceling this child.",
    );
  }
  if (isExpirationDue(child, command.at)) {
    return expireJob(child, {
      ...command,
      kind: "expire",
    });
  }
  if (isTerminal(child.state) || child.cancellation.state !== "none") {
    return unchangedResult(child);
  }

  if (child.state === "running") {
    return mutationResult(
      child,
      {
        ...child,
        ...nextVersion(child, command.at),
        cancellation: {
          requestedAt: command.at,
          requestedBy: parent.jobId,
          state: "requested",
        },
      },
      "parent-policy",
    );
  }
  return mutationResult(
    child,
    {
      ...child,
      ...nextVersion(child, command.at),
      cancellation: {
        acknowledgedAt: command.at,
        requestedAt: command.at,
        requestedBy: parent.jobId,
        state: "acknowledged",
      },
      completedAt: command.at,
      state: "canceled",
    },
    "parent-policy",
  );
}

export function failAsyncJobParentFromChildrenV1(
  parentInput: unknown,
  childInputs: readonly unknown[],
  command: CommandBase,
): AsyncJobLifecycleResultV1 {
  const parent = parseAsyncJobRecordV1(parentInput);
  assertCommandAuthority(parent, command);
  if (isTerminal(parent.state)) {
    return unchangedResult(parent);
  }
  if (isExpirationDue(parent, command.at)) {
    return expireJob(parent, {
      ...command,
      kind: "expire",
    });
  }
  if (parent.state === "running" && parent.cancellation.state === "requested") {
    const active = activeAttempt(parent);
    return mutationResult(
      parent,
      cancelRunningJob(parent, active, command.at),
      "cancellation-acknowledged",
    );
  }
  const children = childInputs.map((child) => parseAsyncJobRecordV1(child));
  const decision = evaluateAsyncJobChildrenV1(parent, children);
  const childrenById = new Map(
    children.map((child) => [child.jobId, child] as const),
  );
  const cancellationIssued =
    decision.kind === "cancel-remaining" &&
    decision.cancelChildJobIds.every((jobId) => {
      const child = childrenById.get(jobId);
      return (
        child !== undefined &&
        (isTerminal(child.state) || child.cancellation.state !== "none")
      );
    });
  if (decision.kind !== "fail-parent" && !cancellationIssued) {
    fail(
      "invalid-state-transition",
      "$.orchestration.failurePolicy",
      "The complete child set does not authorize terminal parent failure.",
    );
  }
  const failure = createAsyncJobFailureV1("handler-permanent-failure");
  let attempts = parent.attempts;
  if (parent.state === "running") {
    const active = activeAttempt(parent);
    attempts = [...parent.attempts];
    attempts[active.index] = completedAttempt(
      parent,
      active.attempt,
      "failed",
      command.at,
      failure,
      { kind: "do-not-retry" },
    );
  }
  return mutationResult(
    parent,
    {
      ...parent,
      ...nextVersion(parent, command.at),
      attempts,
      completedAt: command.at,
      failure,
      state: "failed",
    },
    "parent-policy",
  );
}

/** @deprecated Supply the complete authoritative child set instead. */
export function failAsyncJobParentFromChildV1(
  parentInput: unknown,
  failedChildInput: unknown,
  command: CommandBase,
): AsyncJobLifecycleResultV1 {
  return failAsyncJobParentFromChildrenV1(
    parentInput,
    [failedChildInput],
    command,
  );
}
function expireArtifacts(value: unknown, at: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => expireArtifacts(entry, at));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record["artifactId"] === "string" &&
    record["availability"] !== undefined &&
    record["object"] !== null &&
    typeof record["object"] === "object"
  ) {
    const object = record["object"] as Readonly<Record<string, unknown>>;
    const expiresAt = object["expiresAt"];
    const availability = record["availability"] as Readonly<
      Record<string, unknown>
    >;
    if (
      availability["state"] === "available" &&
      typeof expiresAt === "string" &&
      epoch(expiresAt, "$.output.artifact.object.expiresAt") <=
        epoch(at, "$.at")
    ) {
      return {
        ...record,
        availability: { expiredAt: expiresAt, state: "expired" },
      };
    }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      expireArtifacts(child, at),
    ]),
  );
}

export function deriveAsyncJobStatusViewV1(
  jobInput: unknown,
  at: string,
): AsyncJobStatusViewV1 {
  const job = parseAsyncJobRecordV1(jobInput);
  const output =
    job.output === undefined
      ? undefined
      : (expireArtifacts(job.output, at) as AsyncJobOutputV1);
  const retryAt = nextRetryAt(job);
  return asyncJobStatusViewV1Schema.parse({
    cancellation: job.cancellation,
    ...(job.completedAt === undefined ? {} : { completedAt: job.completedAt }),
    contractVersion: 1,
    correlationId: job.correlationId,
    createdAt: job.createdAt,
    ...(job.failure === undefined
      ? {}
      : {
          failure: {
            code: job.failure.code,
            publicMessage: job.failure.publicMessage,
          },
        }),
    family: job.family,
    inputSubject: job.input.subject,
    interaction:
      job.state === "awaiting-user-input" &&
      job.interaction.state === "awaiting-user-input"
        ? {
            interactionId: job.interaction.interactionId,
            requestedAt: job.interaction.requestedAt,
            state: "awaiting-user-input",
          }
        : { state: "none" },
    jobId: job.jobId,
    ...(retryAt === undefined ? {} : { nextRetryAt: retryAt }),
    ...(output === undefined ? {} : { output }),
    ...(job.progress === undefined ? {} : { progress: job.progress }),
    recordVersion: job.recordVersion,
    state: job.state,
    ...(job.supersededByJobId === undefined
      ? {}
      : { supersededByJobId: job.supersededByJobId }),
    updatedAt: job.updatedAt,
  });
}
