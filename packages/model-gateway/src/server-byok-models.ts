import {
  betaInfrastructureProposalV1Schema,
  betaInfrastructureProposalV2Schema,
  betaInfrastructureProposalV3Schema,
  betaInfrastructureProposalV4Schema,
  betaInfrastructureProposalV5Schema,
  betaInfrastructureProposalV6Schema,
  digestCanonicalValue,
  normalizedModelUsageV1Schema,
  type NormalizedModelUsageV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import { prepareInfrastructureProposalRequestV1 } from "./infrastructure-proposal-request.js";
import type {
  InfrastructureProposalModelV1,
  BetaConverseUsage,
} from "./infrastructure-proposal-model.js";
import {
  prepareApplicationSourceRequestV1,
  betaApplicationSourceV1Schema,
  betaApplicationSourceV2Schema,
  betaApplicationSourceV3Schema,
} from "./application-source-content.js";
import type { ApplicationSourceModelV1 } from "./application-source-model.js";
import {
  requireServerByokConfigurationV1,
  type ServerByokRoleV1,
} from "./server-byok-configuration.js";
import {
  createServerByokTransportV1,
  awaitServerByokAbortV1,
  ServerByokTransportErrorV1,
  type ServerByokCredentialResolverV1,
} from "./server-byok-transport.js";
import { inspectModelValueForSecretCandidatesV1 } from "./security.js";

export type ServerByokUsageObservationV1 = Readonly<
  Omit<NormalizedModelUsageV1, "result">
>;
export type ServerByokInvocationIdentityV1 = Readonly<
  Pick<
    NormalizedModelUsageV1,
    | "attemptNumber"
    | "feature"
    | "idempotencyKeyDigest"
    | "invocationId"
    | "scope"
    | "usageRecordId"
  >
>;

export interface ServerByokInvocationBindingV1 extends ServerByokInvocationIdentityV1 {
  readonly contractVersion: 1;
  readonly fundingSource: "provider-direct";
  readonly providerId: "openai.responses";
  readonly modelId: string;
  readonly modelVersion: string;
  readonly role: ServerByokRoleV1;
  readonly operationVersion: number;
  readonly promptTemplateId: string;
  readonly promptVersion: string;
  readonly promptDigest: NormalizedModelUsageV1["inputDigest"];
  readonly inputDigest: NormalizedModelUsageV1["inputDigest"];
  readonly wireDigest: NormalizedModelUsageV1["inputDigest"];
  readonly schemaDigest: NormalizedModelUsageV1["inputDigest"];
  readonly configurationDigest: NormalizedModelUsageV1["inputDigest"];
  readonly maximumOutputTokens: number;
  readonly maximumInputBytes: number;
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
  readonly deadlineMilliseconds: number;
}

export type ServerByokUncertainReasonV1 =
  | "dispatch-fence-failed"
  | "transport"
  | "body"
  | "canceled"
  | "usage-unavailable"
  | "usage-journal-failed"
  | "outcome-journal-failed";

export type ServerByokInvocationOutcomeV1 =
  | { readonly state: "not-dispatched" }
  | {
      readonly state: NormalizedModelUsageV1["result"];
      readonly usage: NormalizedModelUsageV1;
    };

/** Implemented by the server's durable budget/authorization/usage adapter.
 * Methods must persist atomically and reject stale, duplicate or conflicting
 * evidence. No in-memory or no-op production implementation is supplied here. */
export interface ServerByokInvocationLeaseV1 {
  readonly fundingSource: "provider-direct";
  readonly bindingDigest: NormalizedModelUsageV1["inputDigest"];
  readonly assertCurrent: () => Promise<void>;
  readonly markDispatched: () => Promise<void>;
  readonly observeKnownUsage: (
    observation: ServerByokUsageObservationV1,
  ) => Promise<void>;
  readonly finish: (outcome: ServerByokInvocationOutcomeV1) => Promise<void>;
  readonly markUncertain: (
    reason: ServerByokUncertainReasonV1,
  ) => Promise<void>;
}

export type ServerByokInvocationClaimV1 =
  | {
      readonly disposition: "dispatch";
      readonly lease: ServerByokInvocationLeaseV1;
    }
  | { readonly disposition: "recorded" | "uncertain" | "refused" };

export interface ServerByokInvocationPolicyV1 {
  readonly fundingSource: "provider-direct";
  /** Verified server scope and stable idempotency identity, never model input. */
  readonly identity: ServerByokInvocationIdentityV1;
  readonly claim: (
    binding: ServerByokInvocationBindingV1,
  ) => Promise<ServerByokInvocationClaimV1>;
}

export class ServerByokInvocationErrorV1 extends Error {
  readonly code:
    | "input"
    | "admission"
    | "recorded"
    | "uncertain"
    | "journal"
    | "provider"
    | "output"
    | "canceled";
  constructor(code: ServerByokInvocationErrorV1["code"]) {
    super(`Server BYOK invocation is unavailable (${code}).`);
    this.code = code;
    this.name = "ServerByokInvocationErrorV1";
  }
}

const identityFields = normalizedModelUsageV1Schema.shape;
const identitySchema = z
  .object({
    attemptNumber: identityFields.attemptNumber,
    feature: identityFields.feature,
    idempotencyKeyDigest: identityFields.idempotencyKeyDigest,
    invocationId: identityFields.invocationId,
    scope: identityFields.scope,
    usageRecordId: identityFields.usageRecordId,
  })
  .strict();

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const providerUsageSchema = z
  .object({
    input_tokens: counter,
    input_tokens_details: z
      .object({
        cached_tokens: counter,
        cache_write_tokens: z.literal(0).optional(),
      })
      .strict(),
    output_tokens: counter,
    output_tokens_details: z.object({ reasoning_tokens: counter }).strict(),
    total_tokens: counter,
  })
  .strict();

/** Input includes cached reads; output includes reasoning. Preserve reasoning as
 * informational usage, never add it twice. Unknown/cache-write counters refuse
 * rather than inventing cost semantics. Provider invoices own monetary cost. */
export function normalizeServerByokOpenAiUsageV1(raw: unknown) {
  let usage: z.output<typeof providerUsageSchema>;
  try {
    usage = providerUsageSchema.parse(raw);
  } catch {
    throw new ServerByokInvocationErrorV1("provider");
  }
  if (
    usage.input_tokens_details.cached_tokens > usage.input_tokens ||
    usage.output_tokens_details.reasoning_tokens > usage.output_tokens ||
    BigInt(usage.total_tokens) !==
      BigInt(usage.input_tokens) + BigInt(usage.output_tokens)
  )
    throw new ServerByokInvocationErrorV1("provider");
  return {
    inputUnits: String(
      usage.input_tokens - usage.input_tokens_details.cached_tokens,
    ),
    cacheReadUnits: String(usage.input_tokens_details.cached_tokens),
    cacheWriteUnits: "0",
    outputUnits: String(usage.output_tokens),
    thinkingUnits: String(usage.output_tokens_details.reasoning_tokens),
  };
}

interface Content {
  readonly maximumOutputTokens: number;
  readonly systemText: string;
  readonly userText: string | undefined;
  readonly responseTool: {
    readonly name: string;
    readonly description: string;
    readonly schema: Readonly<Record<string, unknown>>;
  };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function assertJson(value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach(assertJson);
    return;
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    Object.values(value).forEach(assertJson);
    return;
  }
  throw new ServerByokInvocationErrorV1("input");
}

function containsProviderCredential(
  value: unknown,
  credential?: string,
): boolean {
  const text = JSON.stringify(value);
  return (
    typeof text === "string" &&
    (/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,512}\b/.test(text) ||
      (credential !== undefined && text.includes(credential)))
  );
}

function hasProviderDirectFunding(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "fundingSource" in value &&
    value.fundingSource === "provider-direct"
  );
}

function requireLease(
  value: unknown,
  digest: string,
): ServerByokInvocationLeaseV1 {
  if (value === null || typeof value !== "object")
    throw new ServerByokInvocationErrorV1("admission");
  const lease = value as Record<string, unknown>;
  if (
    !hasProviderDirectFunding(lease) ||
    lease["bindingDigest"] !== digest ||
    [
      "assertCurrent",
      "markDispatched",
      "observeKnownUsage",
      "finish",
      "markUncertain",
    ].some((name) => typeof lease[name] !== "function")
  )
    throw new ServerByokInvocationErrorV1("admission");
  return value as ServerByokInvocationLeaseV1;
}

function requirePolicy(value: unknown): ServerByokInvocationPolicyV1 {
  if (
    value === null ||
    typeof value !== "object" ||
    !hasProviderDirectFunding(value) ||
    !("claim" in value) ||
    typeof value.claim !== "function"
  )
    throw new ServerByokInvocationErrorV1("admission");
  return value as ServerByokInvocationPolicyV1;
}

/** Source implementation for the two current-main operation families. The host
 * must compose matching provider-direct funding before enabling its API. */
export function createServerByokModelsV1(options: {
  readonly configuration: unknown;
  readonly policy: ServerByokInvocationPolicyV1;
  readonly resolveCredential: ServerByokCredentialResolverV1;
  readonly fetch?: typeof fetch;
}): {
  readonly architecture: InfrastructureProposalModelV1;
  readonly applicationSource: ApplicationSourceModelV1;
} {
  if ("window" in globalThis || "document" in globalThis)
    throw new ServerByokInvocationErrorV1("admission");
  const configuration = requireServerByokConfigurationV1(options.configuration);
  const policy = requirePolicy(options.policy);
  let identity: ServerByokInvocationIdentityV1;
  try {
    identity = freeze(identitySchema.parse(structuredClone(policy.identity)));
    if (
      identity.scope.jobId === undefined ||
      identity.scope.projectId === undefined
    )
      throw new Error();
  } catch {
    throw new ServerByokInvocationErrorV1("admission");
  }
  const transport = createServerByokTransportV1({
    configuration,
    resolveCredential: options.resolveCredential,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  async function invoke<T>(args: {
    readonly role: ServerByokRoleV1;
    readonly operation: NormalizedModelUsageV1["feature"];
    readonly version: number;
    readonly input: unknown;
    readonly prepare: (raw: unknown) => Content;
    readonly parse: (raw: unknown, original: unknown) => T;
    readonly promptId: string;
    readonly promptVersion: string;
    readonly signal: AbortSignal;
    readonly onUsage?:
      ((usage: BetaConverseUsage) => Promise<void>) | undefined;
  }): Promise<T> {
    let original: unknown;
    let content: Content;
    try {
      if (args.signal.aborted)
        throw new ServerByokInvocationErrorV1("canceled");
      original = structuredClone(args.input);
      assertJson(original);
      const serialized = JSON.stringify(original);
      if (
        typeof serialized !== "string" ||
        new TextEncoder().encode(serialized).byteLength >
          configuration.limits.maximumInputBytes ||
        inspectModelValueForSecretCandidatesV1(original).detectedValueCount >
          0 ||
        containsProviderCredential(original)
      )
        throw new Error();
      // Forbid non-JSON coercion/loss before dispatch (undefined fields, NaN,
      // bigint, cycles, custom prototypes and SDK text members included).
      if (
        digestCanonicalValue(JSON.parse(serialized)) !==
        digestCanonicalValue(original)
      )
        throw new Error();
      content = args.prepare(original);
      if (typeof content.userText !== "string" || content.userText.length === 0)
        throw new Error();
    } catch {
      throw new ServerByokInvocationErrorV1(
        args.signal.aborted ? "canceled" : "input",
      );
    }
    if (
      identity.feature !== args.operation ||
      !hasProviderDirectFunding(policy)
    )
      throw new ServerByokInvocationErrorV1("admission");
    const maximumOutputTokens = Math.min(
      content.maximumOutputTokens,
      configuration.roles[args.role].maximumOutputTokens,
    );
    const body = JSON.stringify({
      model: configuration.roles[args.role].model,
      instructions: content.systemText,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: content.userText }],
        },
      ],
      max_output_tokens: maximumOutputTokens,
      store: false,
      stream: false,
      parallel_tool_calls: false,
      tools: [
        {
          type: "function",
          name: content.responseTool.name,
          description: content.responseTool.description,
          parameters: content.responseTool.schema,
          strict: false,
        },
      ],
      tool_choice: { type: "function", name: content.responseTool.name },
    });
    if (
      new TextEncoder().encode(body).byteLength >
      configuration.limits.maximumRequestBytes
    )
      throw new ServerByokInvocationErrorV1("input");
    const binding: ServerByokInvocationBindingV1 = freeze({
      ...identity,
      contractVersion: 1,
      fundingSource: "provider-direct",
      providerId: "openai.responses",
      modelId: `openai.${configuration.roles[args.role].model.replaceAll(".", "-")}`,
      modelVersion: configuration.roles[args.role].model,
      role: args.role,
      operationVersion: args.version,
      promptTemplateId: args.promptId,
      promptVersion: args.promptVersion,
      promptDigest: digestCanonicalValue(content.systemText),
      inputDigest: digestCanonicalValue(original),
      wireDigest: digestCanonicalValue(body),
      schemaDigest: digestCanonicalValue(content.responseTool.schema),
      configurationDigest: digestCanonicalValue(configuration),
      maximumOutputTokens,
      ...configuration.limits,
    });
    const signal = AbortSignal.any([
      args.signal,
      AbortSignal.timeout(configuration.limits.deadlineMilliseconds),
    ]);
    let credential: string;
    let lease: ServerByokInvocationLeaseV1;
    try {
      credential = await transport.resolveCredential(signal);
      if (body.includes(credential))
        throw new ServerByokInvocationErrorV1("input");
      const claim = await awaitServerByokAbortV1(policy.claim(binding), signal);
      if (claim.disposition !== "dispatch")
        throw new ServerByokInvocationErrorV1(
          claim.disposition === "recorded"
            ? "recorded"
            : claim.disposition === "uncertain"
              ? "uncertain"
              : "admission",
        );
      lease = requireLease(claim.lease, digestCanonicalValue(binding));
    } catch (error) {
      credential = "";
      if (error instanceof ServerByokInvocationErrorV1) throw error;
      throw new ServerByokInvocationErrorV1(
        signal.aborted ? "canceled" : "admission",
      );
    }
    let dispatched = false;
    let observation: ServerByokUsageObservationV1 | undefined;
    let uncertainReason: ServerByokUncertainReasonV1 = "transport";
    let finalResult: NormalizedModelUsageV1["result"] = "provider-error";
    let finalized = false;
    const started = Date.now();
    try {
      await awaitServerByokAbortV1(lease.assertCurrent(), signal);
      signal.throwIfAborted();
      if (
        !hasProviderDirectFunding(policy) ||
        digestCanonicalValue(policy.identity) !== digestCanonicalValue(identity)
      )
        throw new ServerByokInvocationErrorV1("admission");
      // Once fencing starts, a persistence failure is conservative uncertainty.
      // It never authorizes this or a later physical request.
      dispatched = true;
      uncertainReason = "dispatch-fence-failed";
      await awaitServerByokAbortV1(lease.markDispatched(), signal);
      signal.throwIfAborted();
      uncertainReason = "transport";
      const response = await transport.dispatch(body, credential, signal);
      uncertainReason = "usage-unavailable";
      const envelope = z
        .object({ usage: z.unknown() })
        .loose()
        .parse(response.raw);
      const counters = normalizeServerByokOpenAiUsageV1(envelope.usage);
      const completed = Date.now();
      if (completed < started || completed - started > 24 * 60 * 60_000)
        throw new ServerByokInvocationErrorV1("provider");
      const known = freeze({
        ...identity,
        contractVersion: 1 as const,
        providerId: identityFields.providerId.parse(binding.providerId),
        modelId: identityFields.modelId.parse(binding.modelId),
        modelVersion: binding.modelVersion,
        inputDigest: binding.inputDigest,
        promptTemplateId: identityFields.promptTemplateId.parse(
          binding.promptTemplateId,
        ),
        promptVersion: identityFields.promptVersion.parse(
          binding.promptVersion,
        ),
        ...counters,
        ...(response.providerRequestId === undefined
          ? {}
          : { providerRequestId: response.providerRequestId }),
        startedAt: identityFields.startedAt.parse(
          new Date(started).toISOString(),
        ),
        completedAt: identityFields.completedAt.parse(
          new Date(completed).toISOString(),
        ),
        durationMilliseconds: completed - started,
      });
      uncertainReason = "usage-journal-failed";
      await awaitServerByokAbortV1(lease.observeKnownUsage(known), signal);
      observation = known;
      // The legacy callback is supplemental. It cannot replace the durable
      // observation or reserve/debit hosted credits in this funding mode.
      if (args.onUsage !== undefined)
        await awaitServerByokAbortV1(
          args.onUsage({
            inputTokens: Number(known.inputUnits),
            outputTokens: Number(known.outputUnits),
            cacheReadInputTokens: Number(known.cacheReadUnits),
            ...(known.providerRequestId === undefined
              ? {}
              : { providerRequestId: known.providerRequestId }),
          }),
          signal,
        );
      if (!response.ok) throw new ServerByokInvocationErrorV1("provider");
      finalResult = "invalid-output";
      if (response.invalidMetadata)
        throw new ServerByokInvocationErrorV1("output");
      if (BigInt(observation.outputUnits) > BigInt(maximumOutputTokens))
        throw new ServerByokInvocationErrorV1("output");
      const output = z
        .object({
          model: z.literal(configuration.roles[args.role].model),
          status: z.literal("completed"),
          error: z.null(),
          incomplete_details: z.null(),
          output: z
            .array(
              z
                .object({
                  type: z.literal("function_call"),
                  name: z.literal(content.responseTool.name),
                  // Function-call status is optional in the documented API;
                  // the enclosing response must still be complete.
                  status: z.literal("completed").optional(),
                  arguments: z.string().min(1),
                })
                .loose(),
            )
            .length(1),
        })
        .loose()
        .parse(response.raw);
      const call = output.output[0];
      if (call === undefined) throw new Error();
      const payload: unknown = JSON.parse(call.arguments);
      if (
        inspectModelValueForSecretCandidatesV1(payload).detectedValueCount >
          0 ||
        containsProviderCredential(payload, credential)
      )
        throw new Error();
      const result = args.parse(payload, original);
      signal.throwIfAborted();
      uncertainReason = "outcome-journal-failed";
      const usage = freeze(
        normalizedModelUsageV1Schema.parse({
          ...observation,
          result: "succeeded",
        }),
      );
      await awaitServerByokAbortV1(
        lease.finish({ state: "succeeded", usage }),
        signal,
      );
      finalized = true;
      signal.throwIfAborted();
      return result;
    } catch (error) {
      try {
        // Recovery is independent of an already-aborted network signal, but
        // bounded to at most 5 seconds (or the smaller configured deadline).
        // An unresponsive durable adapter leaves the dispatch fence intact.
        const recovery = AbortSignal.timeout(
          Math.min(configuration.limits.deadlineMilliseconds, 5000),
        );
        if (!dispatched)
          await awaitServerByokAbortV1(
            lease.finish({ state: "not-dispatched" }),
            recovery,
          );
        else if (
          !finalized &&
          (observation === undefined ||
            uncertainReason === "outcome-journal-failed")
        ) {
          const reason =
            error instanceof ServerByokTransportErrorV1
              ? error.reason
              : signal.aborted && observation === undefined
                ? "canceled"
                : uncertainReason;
          await awaitServerByokAbortV1(lease.markUncertain(reason), recovery);
        } else if (!finalized) {
          const state = signal.aborted ? "canceled" : finalResult;
          const usage = freeze(
            normalizedModelUsageV1Schema.parse({
              ...observation,
              result: state,
            }),
          );
          await awaitServerByokAbortV1(
            lease.finish({ state, usage }),
            recovery,
          );
        }
      } catch {
        // A failed final persistence attempt cannot return accepted output.
        // Keep the persisted dispatch fence for adapter reconciliation.
        throw new ServerByokInvocationErrorV1("journal");
      }
      throw new ServerByokInvocationErrorV1(
        signal.aborted
          ? "canceled"
          : observation === undefined ||
              uncertainReason === "outcome-journal-failed"
            ? "uncertain"
            : finalResult === "invalid-output"
              ? "output"
              : "provider",
      );
    } finally {
      credential = "";
    }
  }

  const architecture: InfrastructureProposalModelV1 = (input) => {
    const version = input.proposalVersion ?? 1;
    const schemas = [
      betaInfrastructureProposalV1Schema,
      betaInfrastructureProposalV2Schema,
      betaInfrastructureProposalV3Schema,
      betaInfrastructureProposalV4Schema,
      betaInfrastructureProposalV5Schema,
      betaInfrastructureProposalV6Schema,
    ];
    const schema = schemas[version - 1];
    if (schema === undefined)
      return Promise.reject(new ServerByokInvocationErrorV1("input"));
    return invoke({
      role: "architecture",
      operation: "architecture.propose",
      version,
      input: {
        requirements: input.requirements,
        proposalVersion: version,
        catalog: input.catalog,
        ...(input.existingArchitecture === undefined
          ? {}
          : { existingArchitecture: input.existingArchitecture }),
      },
      prepare: (raw) =>
        prepareInfrastructureProposalRequestV1(
          raw as Parameters<typeof prepareInfrastructureProposalRequestV1>[0],
        ),
      parse: (raw) => schema.parse(raw),
      promptId: "cloudmarkup.beta-infrastructure",
      promptVersion: `${String(version)}.0.0`,
      signal: input.signal,
      onUsage: input.onUsage,
    });
  };
  const applicationSource: ApplicationSourceModelV1 = (input) => {
    const version = input.semantic ? 3 : input.reviewed ? 2 : 1;
    return invoke({
      role: "applicationSource",
      operation: "application-source.generate",
      version,
      input: {
        context: input.context,
        reviewed: input.reviewed ?? false,
        semantic: input.semantic ?? false,
      },
      prepare: (raw) =>
        prepareApplicationSourceRequestV1(
          raw as Parameters<typeof prepareApplicationSourceRequestV1>[0],
        ),
      parse: (raw) =>
        (version === 3
          ? betaApplicationSourceV3Schema
          : version === 2
            ? betaApplicationSourceV2Schema
            : betaApplicationSourceV1Schema
        ).parse(raw),
      promptId: "cloudmarkup.beta-application-source",
      promptVersion: version === 1 ? "1.1.0" : `${String(version)}.0.0`,
      signal: input.signal,
      onUsage: input.onUsage,
    });
  };
  return Object.freeze({
    architecture,
    applicationSource,
  });
}
