import {
  digestCanonicalValue,
  normalizedModelUsageV1Schema,
  solutionStableIdSchema,
} from "@cloudmarkup/schemas";
import type {
  ServerByokInvocationBindingV1,
  ServerByokInvocationIdentityV1,
  ServerByokInvocationPolicyV1,
} from "@cloudmarkup/model-gateway/server-byok";
import { z } from "zod";
import type { PostgresProviderDirectInvocationJournalV1 } from "../adapters/persistence/provider-direct-invocation-journal.js";

export class ProviderDirectJournalErrorV1 extends Error {
  constructor() {
    super("Provider-direct invocation journal is unavailable.");
    this.name = "ProviderDirectJournalErrorV1";
  }
}

const usage = normalizedModelUsageV1Schema.shape;
const scope = usage.scope.extend({
  projectId: solutionStableIdSchema,
  jobId: solutionStableIdSchema,
});
const identitySchema = z
  .object({
    attemptNumber: usage.attemptNumber,
    feature: usage.feature,
    idempotencyKeyDigest: usage.idempotencyKeyDigest,
    invocationId: usage.invocationId,
    scope,
    usageRecordId: usage.usageRecordId,
  })
  .strict();

const authoritySchema = z
  .object({
    attemptId: solutionStableIdSchema,
    workerReference: solutionStableIdSchema,
    jobInputDigest: usage.inputDigest,
    correlationId: solutionStableIdSchema,
  })
  .strict();
export type ProviderDirectJobAuthorityV1 = Readonly<
  z.output<typeof authoritySchema>
>;

const bindingSchema = identitySchema
  .extend({
    contractVersion: z.literal(1),
    fundingSource: z.literal("provider-direct"),
    providerId: z.literal("openai.responses"),
    modelId: usage.modelId,
    modelVersion: z
      .string()
      .regex(/^[a-z][a-z0-9.-]{0,70}-\d{4}-\d{2}-\d{2}$/u),
    role: z.enum(["architecture", "applicationSource"]),
    operationVersion: z.number().int().min(1).max(6),
    promptTemplateId: usage.promptTemplateId,
    promptVersion: usage.promptVersion,
    promptDigest: usage.inputDigest,
    inputDigest: usage.inputDigest,
    wireDigest: usage.inputDigest,
    schemaDigest: usage.inputDigest,
    configurationDigest: usage.inputDigest,
    maximumOutputTokens: z.number().int().min(1).max(12000),
    maximumInputBytes: z.number().int().min(1).max(1048576),
    maximumRequestBytes: z.number().int().min(1).max(2097152),
    maximumResponseBytes: z.number().int().min(1).max(1048576),
    deadlineMilliseconds: z.number().int().min(1).max(120000),
  })
  .strict();

const roles = {
  architecture: {
    feature: "architecture.propose",
    family: "architecture-proposal",
    permission: "projects.mutate",
    maximumVersion: 6,
    maximumTokens: 6144,
  },
  applicationSource: {
    feature: "application-source.generate",
    family: "application-source-generation",
    permission: "exports.run",
    maximumVersion: 3,
    maximumTokens: 12000,
  },
} as const;

export function requireProviderDirectBindingV1(
  raw: unknown,
): ServerByokInvocationBindingV1 {
  try {
    const value = bindingSchema.parse(structuredClone(raw));
    const rule = roles[value.role];
    if (
      value.modelId !== `openai.${value.modelVersion.replaceAll(".", "-")}` ||
      value.feature !== rule.feature ||
      value.operationVersion > rule.maximumVersion ||
      value.maximumOutputTokens > rule.maximumTokens ||
      value.maximumInputBytes > value.maximumRequestBytes
    )
      throw new Error();
    return value;
  } catch {
    throw new ProviderDirectJournalErrorV1();
  }
}

export function providerDirectRoleAuthorityV1(
  binding: ServerByokInvocationBindingV1,
) {
  return roles[binding.role];
}

export function requireProviderDirectIdentityV1(raw: unknown) {
  try {
    return identitySchema.parse(structuredClone(raw));
  } catch {
    throw new ProviderDirectJournalErrorV1();
  }
}

export function requireProviderDirectJobAuthorityV1(raw: unknown) {
  try {
    return authoritySchema.parse(structuredClone(raw));
  } catch {
    throw new ProviderDirectJournalErrorV1();
  }
}

/** Construct only from verified authentication and durable running job/attempt
 * metadata. The journal independently checks those real records in its SQL
 * transaction. No optional observer, credit executor or unmetered fallback. */
export function createProviderDirectInvocationPolicyV1(options: {
  readonly journal: PostgresProviderDirectInvocationJournalV1;
  readonly identity: ServerByokInvocationIdentityV1;
  readonly authority: ProviderDirectJobAuthorityV1;
  readonly signal: AbortSignal;
}): ServerByokInvocationPolicyV1 {
  const identity = requireProviderDirectIdentityV1(options.identity);
  const authority = requireProviderDirectJobAuthorityV1(options.authority);
  const journal = options.journal;
  const signal = options.signal;
  Object.freeze(identity.scope);
  Object.freeze(identity);
  Object.freeze(authority);
  return Object.freeze({
    fundingSource: "provider-direct" as const,
    identity,
    claim: async (raw: ServerByokInvocationBindingV1) => {
      if (signal.aborted) return { disposition: "refused" as const };
      const binding = requireProviderDirectBindingV1(raw);
      const actual = {
        attemptNumber: binding.attemptNumber,
        feature: binding.feature,
        idempotencyKeyDigest: binding.idempotencyKeyDigest,
        invocationId: binding.invocationId,
        scope: binding.scope,
        usageRecordId: binding.usageRecordId,
      };
      if (digestCanonicalValue(actual) !== digestCanonicalValue(identity))
        return { disposition: "refused" as const };
      return journal.claim(binding, authority, signal);
    },
  });
}
