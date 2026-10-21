import { createAsyncJobFailureV1 } from "@cloudmarkup/domain";
import type {
  JobHandlerContextV1,
  JobHandlerV1,
} from "@cloudmarkup/job-framework";
import {
  assertIntentModelOperationBindingV1,
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
  invokeReservedIntentModelV1,
  reviewedModelPromptRegistry,
  serializedByteLength,
  validateModelResponseAuthority,
  type IntentModelRequestV1,
  type IntentModelResultV1,
  type ModelGateway,
  type ModelGatewayInvocationContextV1,
  type ModelResultEvidenceSourceV1,
  type ModelRuntimeControlExecutionInputV1,
  type ModelRuntimeControlServiceV1,
  type ModelRuntimeSanitizedOutputEvidenceV1,
  type ModelUsageEvidenceSourceV1,
} from "@cloudmarkup/model-gateway";
import {
  asyncJobHandlerOutcomeV1Schema,
  asyncJobObjectReferenceV1Schema,
  asyncJobRecordV1Schema,
  modelGatewayRequestV1Schema,
  type AsyncJobHandlerOutcomeV1,
  type AsyncJobObjectReferenceV1,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import {
  parseResult,
  type ModelInvocationScope,
} from "./adapters/persistence/model-runtime-invocation-codec.js";

export interface ProductionAiIntentResolvedInput {
  readonly context: ModelGatewayInvocationContextV1;
  readonly modelRequest: IntentModelRequestV1;
  readonly runtime: ModelRuntimeControlExecutionInputV1;
}

/** Host-only ports. Resolution reads one authorized immutable canonical-JSON
 * model request from job.input.source; it must not derive authority from that
 * object's content. Storage and evidence issuance require explicit reviewed
 * retention policy. There is deliberately no default object/evidence adapter. */
export interface ProductionAiIntentHost {
  authorize(job: AsyncJobRecordV1): Promise<void>;
  resolve(job: AsyncJobRecordV1): Promise<ProductionAiIntentResolvedInput>;
  issueOutputEvidence(input: {
    readonly job: AsyncJobRecordV1;
    readonly resolved: ProductionAiIntentResolvedInput;
    readonly result: IntentModelResultV1;
  }): Promise<ModelRuntimeSanitizedOutputEvidenceV1>;
  /** Publish exactly result.response as canonical JSON, under this tenant/job,
   * idempotently. No commercial costs, raw input, or gateway metadata in body. */
  publish(input: {
    readonly job: AsyncJobRecordV1;
    readonly result: IntentModelResultV1;
    readonly evidence: ModelRuntimeSanitizedOutputEvidenceV1;
  }): Promise<AsyncJobObjectReferenceV1>;
}

function failure(transient = false): AsyncJobHandlerOutcomeV1 {
  return asyncJobHandlerOutcomeV1Schema.parse({
    outcome: "failed",
    failure: createAsyncJobFailureV1(
      transient ? "handler-transient-failure" : "handler-permanent-failure",
    ),
  });
}

function canceled(): AsyncJobHandlerOutcomeV1 {
  return asyncJobHandlerOutcomeV1Schema.parse({ outcome: "canceled" });
}

function assert(condition: boolean): asserts condition {
  if (!condition)
    throw new Error("The AI job authority is unavailable or contradictory.");
}

function assertResolved(
  job: AsyncJobRecordV1,
  resolved: ProductionAiIntentResolvedInput,
  now: Date,
): void {
  const model = modelGatewayRequestV1Schema.parse(resolved.modelRequest);
  const { context, runtime } = resolved;
  const admission = runtime.admissionRequest;
  const scope = context.scope;
  assert(
    job.input.family === "intent-extraction" &&
      model.operation === "intent.extract",
  );
  assertIntentModelOperationBindingV1({
    commercial: runtime.commercialRequest,
    context,
    model,
  });
  const inputDigest = digestStructuredValue({ request: model, scope });
  const prompt = reviewedModelPromptRegistry.get(model.operation);
  assert(
    Number.isFinite(now.getTime()) &&
      (job.expiresAt === undefined ||
        Date.parse(job.expiresAt) > now.getTime()) &&
      (job.input.source.expiresAt === undefined ||
        Date.parse(job.input.source.expiresAt) > now.getTime()) &&
      job.input.source.mediaType === "application/json" &&
      job.input.source.digest === digestStructuredValue(model) &&
      job.input.source.sizeBytes === serializedByteLength(model) &&
      job.inputDigest === digestStructuredValue(job.input) &&
      inspectModelValueForSecretCandidatesV1(model).detectedValueCount === 0 &&
      scope.jobId === job.jobId &&
      scope.organizationId === job.ownership.organizationId &&
      scope.projectId === job.ownership.projectId &&
      scope.userId === job.idempotency.actorId &&
      admission.organizationId === scope.organizationId &&
      admission.projectId === scope.projectId &&
      admission.userId === scope.userId &&
      admission.executionClass === "normal" &&
      runtime.liveEvaluationAuthority === undefined &&
      admission.operation === model.operation &&
      admission.inputDigest === inputDigest &&
      runtime.inputEvidence.inputDigest === inputDigest &&
      runtime.commercialRequest.environment ===
        runtime.routingRequest.environment &&
      runtime.commercialRequest.jobId === job.jobId &&
      runtime.commercialRequest.userId === job.idempotency.actorId &&
      prompt !== null &&
      runtime.promptTemplateDigest === prompt.digest &&
      digestStructuredValue(runtime.routingDecision) ===
        digestStructuredValue(context.routingDecision) &&
      digestStructuredValue(runtime.routingRequest) ===
        digestStructuredValue(context.routingRequest),
  );
}

function checkedResult(
  raw: IntentModelResultV1,
  resolved: ProductionAiIntentResolvedInput,
): IntentModelResultV1 {
  const { context, modelRequest } = resolved;
  const result = parseResult(
    raw,
    {
      authorityDigest: digestStructuredValue(context),
      idempotencyKeyDigest: context.idempotencyKeyDigest,
      inputDigest: resolved.runtime.admissionRequest.inputDigest,
      invocationId: context.invocationId,
    },
    context.scope,
  );
  const prompt = reviewedModelPromptRegistry.get(modelRequest.operation);
  const route = context.routingDecision;
  assert(
    result.response.operation === "intent.extract" &&
      result.descriptor.requestedMode === context.requestedMode &&
      result.descriptor.budgetDecisionId === context.budget.decisionId &&
      result.descriptor.entitlementDecisionId ===
        context.entitlement.decisionId &&
      result.descriptor.routing?.routingDecisionDigest ===
        digestStructuredValue(context.routingDecision) &&
      result.descriptor.providerId === route?.providerId &&
      result.descriptor.modelId === route.modelId &&
      result.descriptor.modelVersion === route.modelVersion &&
      result.descriptor.inferenceProfileId === route.inferenceProfileId &&
      result.descriptor.promptTemplateId === prompt?.templateId &&
      result.descriptor.promptVersion === prompt.version &&
      result.descriptor.promptDigest === prompt.digest &&
      inspectModelValueForSecretCandidatesV1(result.response)
        .detectedValueCount === 0,
  );
  validateModelResponseAuthority({
    allowedApprovalPathIds: new Set(),
    descriptor: result.descriptor,
    request: modelRequest,
    response: result.response,
  });
  return { ...result, response: result.response };
}

function assertOutput(
  result: IntentModelResultV1,
  output: ModelRuntimeSanitizedOutputEvidenceV1,
): void {
  assert(
    output.outputDigest === digestStructuredValue(result.response) &&
      output.outputBytes === serializedByteLength(result.response) &&
      output.outputTokens === Number(result.usage.outputUnits),
  );
}

/** Renewal belongs to this long-running handler, not an assumed worker timer.
 * All checks share one promise chain, including shutdown, so heartbeats cannot
 * overlap each other or race framework completion. A failed renewal aborts the
 * provider and permanently closes this attempt's publication boundary. */
class IntentAttemptLease {
  readonly controller = new AbortController();
  readonly #context: JobHandlerContextV1;
  readonly #now: () => Date;
  readonly #duration: number;
  readonly #deadline: number;
  readonly #interval: number;
  #expiresAt: number;
  #lastRenewedAt: number;
  #pending = Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #expiryTimer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  #failed = false;
  #canceled = false;

  constructor(
    job: AsyncJobRecordV1,
    context: JobHandlerContextV1,
    now: () => Date,
  ) {
    const attempt = job.attempts.at(-1);
    assert(attempt?.state === "running" && attempt.lease !== undefined);
    this.#context = context;
    this.#now = now;
    this.#lastRenewedAt = Date.parse(attempt.lease.heartbeatAt);
    this.#expiresAt = Date.parse(attempt.lease.leaseExpiresAt);
    this.#duration = this.#expiresAt - this.#lastRenewedAt;
    assert(this.#duration > 0);
    const completedSeconds = job.attempts
      .filter((item) => item.state !== "running")
      .reduce((total, item) => total + item.runtimeSeconds, 0);
    this.#deadline = Math.min(
      job.expiresAt === undefined ? Infinity : Date.parse(job.expiresAt),
      // The worker rounds active runtime upward to whole seconds. Keep the
      // local guard inside even that conservatively shortened final lease.
      Date.parse(attempt.startedAt) +
        (job.limits.runtimeSeconds - completedSeconds) * 1_000 -
        999,
    );
    this.#interval = Math.max(
      1,
      Math.min(10_000, Math.floor(this.#duration / 3)),
    );
    this.#schedule();
    this.#watchExpiry();
  }

  get canceled(): boolean {
    return this.#canceled && !this.#failed;
  }

  async check(): Promise<void> {
    await this.#enqueue();
    assert(!this.#failed && !this.#canceled);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    clearTimeout(this.#expiryTimer);
    await this.#pending;
  }

  #enqueue(): Promise<void> {
    this.#pending = this.#pending.then(async () => {
      if (this.#failed || this.#stopped) return;
      try {
        const at = this.#now().getTime();
        assert(
          Number.isFinite(at) &&
            at >= this.#lastRenewedAt &&
            at < this.#expiresAt &&
            at < this.#deadline,
        );
        if (await this.#context.isCancellationRequested()) {
          this.#canceled = true;
          this.controller.abort();
        }
        // The framework correctly rejects an identical same-instant renewal.
        // Polling/authorization checks do not need to force such a write.
        if (at - this.#lastRenewedAt >= this.#interval) {
          await this.#context.heartbeat();
          assert(!this.#failed);
          this.#lastRenewedAt = at;
          // Use the pre-I/O instant, not a later clock, as a conservative bound.
          this.#expiresAt = Math.min(at + this.#duration, this.#deadline);
          this.#watchExpiry();
        }
        assert(this.#now().getTime() < this.#expiresAt);
      } catch {
        this.#failed = true;
        this.controller.abort();
      }
    });
    return this.#pending;
  }

  #schedule(): void {
    this.#timer = setTimeout(() => {
      void this.#enqueue().then(() => {
        if (!this.#stopped && !this.#failed) this.#schedule();
      });
    }, this.#interval);
  }

  #watchExpiry(): void {
    clearTimeout(this.#expiryTimer);
    this.#expiryTimer = setTimeout(
      () => {
        // An unresponsive heartbeat must not suppress cancellation of an
        // already in-flight provider while the serialized check awaits I/O.
        this.#failed = true;
        this.controller.abort();
      },
      Math.max(
        0,
        Math.min(this.#expiresAt, this.#deadline) - this.#now().getTime(),
      ),
    );
  }
}

/** The job framework owns queue delivery/attempt leases; runtime owns admission
 * and the ONE canonical commercial entry. This handler cannot accept a second
 * job-level credit reservation or reinterpret customer work as evaluation. */
export class ProductionAiIntentJobHandler implements JobHandlerV1 {
  readonly family = "intent-extraction" as const;
  readonly handlerId = "cloudmarkup.production-ai-intent.v1";
  readonly handlerVersion = "1.0.0";
  readonly resumePolicy = "restart-from-input" as const;
  readonly #host: ProductionAiIntentHost;
  readonly #gateway: ModelGateway;
  readonly #runtime: Pick<ModelRuntimeControlServiceV1, "execute">;
  readonly #results: ModelResultEvidenceSourceV1;
  readonly #usage: ModelUsageEvidenceSourceV1;
  readonly #scope: ModelInvocationScope;
  readonly #now: () => Date;
  constructor(input: {
    readonly host: ProductionAiIntentHost;
    readonly gateway: ModelGateway;
    readonly runtime: Pick<ModelRuntimeControlServiceV1, "execute">;
    readonly results: ModelResultEvidenceSourceV1;
    readonly usage: ModelUsageEvidenceSourceV1;
    readonly scope: ModelInvocationScope;
    readonly now: () => Date;
  }) {
    this.#host = input.host;
    this.#gateway = input.gateway;
    this.#runtime = input.runtime;
    this.#results = input.results;
    this.#usage = input.usage;
    this.#scope = structuredClone(input.scope);
    this.#now = input.now;
  }
  async execute(
    raw: AsyncJobRecordV1,
    context: JobHandlerContextV1,
  ): Promise<AsyncJobHandlerOutcomeV1> {
    let job: AsyncJobRecordV1;
    let resolved: ProductionAiIntentResolvedInput;
    let lease: IntentAttemptLease | undefined;
    let runtimeEntered = false;
    try {
      job = asyncJobRecordV1Schema.parse(raw);
      assert(
        job.family === this.family &&
          job.state === "running" &&
          job.reservation.state === "none",
      );
      assert(
        context.jobId === job.jobId &&
          context.correlationId === job.correlationId &&
          context.attemptNumber === job.attempts.at(-1)?.attemptNumber &&
          digestStructuredValue(context.ownership) ===
            digestStructuredValue(job.ownership),
      );
      lease = new IntentAttemptLease(job, context, this.#now);
      await lease.check();
      await this.#host.authorize(job);
      resolved = structuredClone(await this.#host.resolve(job));
      assertResolved(job, resolved, this.#now());
      assert(
        digestStructuredValue(resolved.context.scope) ===
          digestStructuredValue(this.#scope),
      );
      await lease.check();
      runtimeEntered = true;
      const activeLease = lease;
      const execution = await this.#runtime.execute(
        resolved.runtime,
        async (admitted) => {
          await this.#host.authorize(job);
          await activeLease.check();
          assertResolved(job, resolved, this.#now());
          assert(
            digestStructuredValue(admitted.inputEvidence) ===
              digestStructuredValue(resolved.runtime.inputEvidence),
          );
          const invoked = await invokeReservedIntentModelV1({
            callback: admitted.commercial,
            clock: { now: this.#now },
            commercialRequest: resolved.runtime.commercialRequest,
            context: resolved.context,
            gateway: this.#gateway,
            modelRequest: resolved.modelRequest,
            signal: activeLease.controller.signal,
            usageEvidence: this.#usage,
          });
          await activeLease.check();
          if (invoked.modelResult === null)
            return { commercial: invoked.commercial, output: null };
          const result = checkedResult(invoked.modelResult, resolved);
          const output = await this.#host.issueOutputEvidence({
            job,
            resolved,
            result,
          });
          assertOutput(result, output);
          return { commercial: invoked.commercial, output };
        },
      );
      await lease.check();
      if (
        execution.admission.outcome !== "allowed" ||
        execution.commercial === null ||
        !execution.commercial.reservationAccepted ||
        execution.commercial.denialReason !== null ||
        !["completed", "compensated"].includes(execution.commercial.state) ||
        execution.output === null
      ) {
        return failure(
          execution.commercial?.state === "settlement-pending" ||
            execution.commercial?.state === "reconciliation-required",
        );
      }
      await this.#host.authorize(job);
      const stored = await this.#results.loadCompleted(
        resolved.context.invocationId,
      );
      assert(stored !== null);
      const result = checkedResult(stored, resolved);
      assertOutput(result, execution.output);
      assert(execution.output.outputBytes <= job.limits.outputBytes);
      await this.#host.authorize(job);
      await lease.check();
      const proposal = asyncJobObjectReferenceV1Schema.parse(
        await this.#host.publish({ job, result, evidence: execution.output }),
      );
      assert(
        proposal.purpose === "proposal" &&
          proposal.mediaType === "application/json" &&
          proposal.digest === execution.output.outputDigest &&
          proposal.sizeBytes === execution.output.outputBytes &&
          (proposal.expiresAt === undefined ||
            Date.parse(proposal.expiresAt) > this.#now().getTime()),
      );
      await this.#host.authorize(job);
      await lease.check();
      return asyncJobHandlerOutcomeV1Schema.parse({
        outcome: "succeeded",
        output: {
          contractVersion: 1,
          evidenceRecords: [],
          family: this.family,
          proposal,
        },
        outputSizeBytes: proposal.sizeBytes,
      });
    } catch {
      return lease?.canceled === true ? canceled() : failure(runtimeEntered);
    } finally {
      await lease?.stop();
    }
  }
}
