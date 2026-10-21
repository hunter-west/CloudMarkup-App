import { z } from "zod";
import {
  asyncJobRecordV1Schema,
  digestCanonicalValue,
  normalizedModelUsageV1Schema,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import {
  createServerByokModelsV1,
  requireServerByokConfigurationV1,
  ServerByokInvocationErrorV1,
  type ServerByokConfigurationV1,
  type ServerByokCredentialResolverV1,
  type ServerByokInvocationIdentityV1,
  type ServerByokInvocationPolicyV1,
  type ServerByokRoleV1,
} from "@cloudmarkup/model-gateway/server-byok";
import type { PostgresProviderDirectInvocationJournalV1 } from "../adapters/persistence/provider-direct-invocation-journal.js";
import { createProviderDirectInvocationPolicyV1 } from "./provider-direct-invocation-policy.js";

type Models = ReturnType<typeof createServerByokModelsV1>;
const fields = normalizedModelUsageV1Schema.shape;
const identitySchema = z
  .object({
    attemptNumber: fields.attemptNumber,
    feature: fields.feature,
    idempotencyKeyDigest: fields.idempotencyKeyDigest,
    invocationId: fields.invocationId,
    scope: fields.scope,
    usageRecordId: fields.usageRecordId,
  })
  .strict();

export type SelfHostProviderDirectJournals = Readonly<
  Record<"proposal" | "export", PostgresProviderDirectInvocationJournalV1>
>;
export interface SelfHostVerifiedJobAttempt {
  readonly record: AsyncJobRecordV1;
  readonly attemptId: string;
  readonly workerId: string;
  readonly signal: AbortSignal;
  /** Must be the real worker's current durable ownership/attempt/subject check.
   * Only trusted worker composition supplies this; HTTP/model input cannot. */
  readonly assertCurrent: () => Promise<void>;
}

export class SelfHostModelCompositionError extends Error {
  readonly code = "self-host-model-unavailable";
  constructor() {
    super("The scoped provider-direct model is unavailable.");
    this.name = "SelfHostModelCompositionError";
  }
}
function unavailable(): never {
  throw new SelfHostModelCompositionError();
}
const operations = {
  architecture: "architecture.propose",
  applicationSource: "application-source.generate",
} as const;
const families = {
  architecture: "architecture-proposal",
  applicationSource: "application-source-generation",
} as const;

function jobIdentity(
  role: ServerByokRoleV1,
  context: SelfHostVerifiedJobAttempt,
  now: number,
): ServerByokInvocationIdentityV1 {
  const record = asyncJobRecordV1Schema.parse(structuredClone(context.record));
  const attempt = record.attempts.at(-1);
  if (
    record.state !== "running" ||
    record.cancellation.state !== "none" ||
    record.ownership.projectId === undefined ||
    attempt?.state !== "running" ||
    attempt.attemptId !== context.attemptId ||
    attempt.lease?.workerId !== context.workerId ||
    Date.parse(attempt.lease.leaseExpiresAt) <= now ||
    (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= now) ||
    record.reservation.state !== "none" ||
    record.family !== families[role]
  )
    unavailable();
  // Include role because application/native source share the public feature.
  // Do not include attempt/config/input: changed evidence must conflict with the
  // same invocation, not manufacture a second paid attempt on restart.
  const seed = digestCanonicalValue({
    contractVersion: 1,
    role,
    feature: operations[role],
    jobId: record.jobId,
    ownership: record.ownership,
    actorId: record.idempotency.actorId,
    operationId: record.idempotency.operationId,
    keyDigest: record.idempotency.keyDigest,
  });
  return Object.freeze(
    identitySchema.parse({
      attemptNumber: attempt.attemptNumber,
      feature: operations[role],
      idempotencyKeyDigest: seed,
      invocationId: `invocation.self-host.${seed.slice(7)}`,
      usageRecordId: `usage.self-host.${seed.slice(7)}`,
      scope: {
        userId: record.idempotency.actorId,
        organizationId: record.ownership.organizationId,
        projectId: record.ownership.projectId,
        jobId: record.jobId,
      },
    }),
  );
}

/** No ambient scope or global job policy. Each execution receives the actual
 * verified durable record and creates one fresh matching model/policy pair.
 * Both current shared callable families retain gateway validation/usage sequencing.
 * This module never imports a hosted credit meter or synthesizes a balance. */
export function createSelfHostModelComposition(options: {
  readonly fundingSource: "provider-direct";
  readonly configuration: ServerByokConfigurationV1;
  readonly journals: SelfHostProviderDirectJournals;
  readonly resolveCredential: ServerByokCredentialResolverV1;
  readonly maximumInFlightInvocations: number;
  readonly now?: () => number;
  readonly fetch?: typeof fetch;
  readonly createModels?: typeof createServerByokModelsV1;
  readonly createPolicy?: typeof createProviderDirectInvocationPolicyV1;
  readonly initiallyClosed?: boolean;
}) {
  if (
    !z.literal("provider-direct").safeParse(options.fundingSource).success ||
    options.journals.proposal === options.journals.export
  )
    unavailable();
  if (
    !Number.isSafeInteger(options.maximumInFlightInvocations) ||
    options.maximumInFlightInvocations < 1 ||
    options.maximumInFlightInvocations > 64
  )
    unavailable();
  const configuration = requireServerByokConfigurationV1(options.configuration);
  const active = new Set<Promise<unknown>>();
  const controllers = new Set<AbortController>();
  let accepting = options.initiallyClosed !== true;
  let stopped = false;
  let executions = 0;
  let closing: Promise<void> | undefined;

  function stopAdmissions(): void {
    if (stopped) return;
    stopped = true;
    accepting = false;
    let failed = false;
    for (const journal of Object.values(options.journals)) {
      try {
        journal.stopClaims();
      } catch {
        failed = true;
      }
    }
    if (failed) unavailable();
  }
  function startAdmissions(): void {
    if (stopped) unavailable();
    accepting = true;
  }
  function cancel(): void {
    try {
      stopAdmissions();
    } finally {
      for (const controller of controllers) controller.abort();
    }
  }
  async function drain(): Promise<void> {
    while (active.size > 0) await Promise.allSettled([...active]);
  }
  function close(): Promise<void> {
    closing ??= (async () => {
      cancel();
      await drain();
      const results = await Promise.allSettled(
        Object.values(options.journals).map(async (journal) => {
          await journal.close();
        }),
      );
      if (results.some((result) => result.status === "rejected")) unavailable();
    })();
    return closing;
  }

  async function executeForVerifiedAttempt<T>(
    role: ServerByokRoleV1,
    context: SelfHostVerifiedJobAttempt,
    run: (models: Models, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (!accepting || executions >= options.maximumInFlightInvocations)
      unavailable();
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      context.signal,
      AbortSignal.timeout(configuration.limits.deadlineMilliseconds),
    ]);
    controllers.add(controller);
    executions += 1;
    let usable = true;
    let invoked = false;
    const withdrawn = () => !accepting || signal.aborted || !usable;
    const alreadyInvoked = () => invoked;
    const check = async () => {
      if (withdrawn()) unavailable();
      await context.assertCurrent();
      if (withdrawn()) unavailable();
    };
    try {
      const identity = jobIdentity(role, context, (options.now ?? Date.now)());
      await check();
      const policy = (
        options.createPolicy ?? createProviderDirectInvocationPolicyV1
      )({
        journal:
          role === "architecture"
            ? options.journals.proposal
            : options.journals.export,
        identity,
        authority: {
          attemptId: context.attemptId,
          workerReference: context.workerId,
          jobInputDigest: context.record.inputDigest,
          correlationId: context.record.correlationId,
        },
        signal,
      });
      if (
        !z.literal("provider-direct").safeParse(policy.fundingSource).success ||
        digestCanonicalValue(policy.identity) !== digestCanonicalValue(identity)
      )
        unavailable();
      await check();
      const boundPolicy: ServerByokInvocationPolicyV1 = {
        fundingSource: "provider-direct",
        identity,
        async claim(binding) {
          if (binding.role !== role) unavailable();
          await check();
          const claim = await policy.claim(binding);
          if (claim.disposition !== "dispatch") return claim;
          const lease = claim.lease;
          return {
            disposition: "dispatch",
            lease: {
              fundingSource: lease.fundingSource,
              bindingDigest: lease.bindingDigest,
              assertCurrent: async () => {
                await check();
                await lease.assertCurrent();
                await check();
              },
              markDispatched: async () => {
                await check();
                await lease.markDispatched();
              },
              // Incurred usage and recovery remain writable after cancellation or
              // admission withdrawal. The journal is alive until all calls drain.
              observeKnownUsage: (observation) =>
                lease.observeKnownUsage(observation),
              finish: (outcome) => lease.finish(outcome),
              markUncertain: (reason) => lease.markUncertain(reason),
            },
          };
        },
      };
      const gateway = (options.createModels ?? createServerByokModelsV1)({
        configuration,
        policy: boundPolicy,
        resolveCredential: options.resolveCredential,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      });
      const invoke = async <R>(
        selected: ServerByokRoleV1,
        modelSignal: AbortSignal | undefined,
        work: (signal: AbortSignal) => Promise<R>,
      ): Promise<R> => {
        if (selected !== role || alreadyInvoked()) unavailable();
        await check();
        if (alreadyInvoked()) unavailable();
        invoked = true;
        const pending = work(
          modelSignal === undefined
            ? signal
            : AbortSignal.any([signal, modelSignal]),
        );
        active.add(pending);
        try {
          return await pending;
        } finally {
          active.delete(pending);
        }
      };
      const scoped: Models = {
        architecture: (input) =>
          invoke("architecture", input.signal, (current) =>
            gateway.architecture({ ...input, signal: current }),
          ),
        applicationSource: (input) =>
          invoke("applicationSource", input.signal, (current) =>
            gateway.applicationSource({ ...input, signal: current }),
          ),
      };
      const pending = run(scoped, signal);
      active.add(pending);
      try {
        return await pending;
      } finally {
        active.delete(pending);
      }
    } catch (error) {
      if (
        error instanceof ServerByokInvocationErrorV1 ||
        error instanceof SelfHostModelCompositionError
      )
        throw error;
      unavailable();
    } finally {
      usable = false;
      executions -= 1;
      controllers.delete(controller);
    }
  }
  function runForVerifiedAttempt<T>(
    role: ServerByokRoleV1,
    context: SelfHostVerifiedJobAttempt,
    run: (models: Models, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const pending = executeForVerifiedAttempt(role, context, run);
    active.add(pending);
    void pending.then(
      () => {
        active.delete(pending);
      },
      () => {
        active.delete(pending);
      },
    );
    return pending;
  }
  return Object.freeze({
    runForVerifiedAttempt,
    startAdmissions,
    stopAdmissions,
    cancel,
    drain,
    close,
  });
}

export type SelfHostModelComposition = ReturnType<
  typeof createSelfHostModelComposition
>;
