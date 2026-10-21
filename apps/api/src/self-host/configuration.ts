import { requireServerByokConfigurationV1 } from "@cloudmarkup/model-gateway/server-byok";
import { isAbsolute, parse, resolve } from "node:path";
import { z } from "zod";
import { accountAccessV1Schema } from "@cloudmarkup/api-contract";

import { parsePublicRuntimeConfig, publicRuntimeConfigSchema } from "../app.js";
import { accountSecurityConfigurationV1Schema } from "../account-security-config.js";
import {
  ORDINARY_PERSISTENCE_PURPOSES,
  parseSelfHostPersistenceConfiguration,
} from "./persistence-config.js";

export const SELF_HOST_CONFIGURATION_ENVIRONMENT_NAME =
  "CLOUDMARKUP_SELF_HOST_CONFIGURATION_FILE";
export const SELF_HOST_ADAPTER_NAMES = [
  "proposalJobs",
  "solutionExports",
  "projectCleanup",
  "billing",
  "commercial",
  "github",
  "gitlab",
  "continuousConformance",
] as const;
export type SelfHostAdapterName = (typeof SELF_HOST_ADAPTER_NAMES)[number];

const reference = z.string().regex(/^operator\.[a-z][a-z0-9.-]{0,95}$/u);
const absolutePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => {
    return (
      !value.includes("\0") &&
      isAbsolute(value) &&
      resolve(value) !== parse(resolve(value)).root &&
      !value.split(/[\\/]/u).includes("..")
    );
  });
const credentialSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: absolutePath }).strict(),
  z
    .object({
      kind: z.literal("environment"),
      name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
    })
    .strict(),
]);
const tls = z.union([
  z.literal("disable"),
  z
    .object({
      mode: z.literal("verify-full"),
      ca: z.string().min(1).max(65536).optional(),
    })
    .strict(),
]);
function database(purpose: (typeof ORDINARY_PERSISTENCE_PURPOSES)[number]) {
  return z
    .object({
      host: z.string().min(1).max(253),
      port: z.number().int().min(1).max(65535),
      database: z.literal("cloudmarkup"),
      user: z.literal(`cloudmarkup_beta_${purpose}_runtime`),
      passwordReference: reference,
      tls,
      maxConnections: z.number().int().min(1).max(20),
      connectionTimeoutMillis: z.number().int().min(1).max(60000),
      idleTimeoutMillis: z.number().int().min(1).max(60000),
      statementTimeoutMillis: z.number().int().min(1).max(120000),
    })
    .strict();
}
const binding = z
  .object({
    adapterReference: z.string().regex(/^[a-z][a-z0-9.-]{0,95}$/u),
    configurationReference: reference,
    credentialReferences: z.array(reference).max(16).default([]),
  })
  .strict()
  .nullable();

const configurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    server: z
      .object({
        host: z.enum(["127.0.0.1", "0.0.0.0"]),
        port: z.number().int().min(1).max(65535),
        publicOrigin: z.url(),
        requestDeadlineMilliseconds: z.number().int().min(1).max(120000),
        maximumInFlightRequests: z.number().int().min(1).max(256),
      })
      .strict(),
    identity: z.discriminatedUnion("mode", [
      z
        .object({
          mode: z.literal("cognito"),
          userPoolId: z.string().regex(/^[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]+$/u),
          clientId: z.string().min(1).max(128),
          directory: z.enum([
            "existing-principals",
            "verified-cognito-bootstrap",
          ]),
          publicRuntime: publicRuntimeConfigSchema,
          accountAccess: accountAccessV1Schema,
          accountSecurity: accountSecurityConfigurationV1Schema,
        })
        .strict(),
      z
        .object({
          mode: z.literal("local-owner"),
          ownerPrincipalId: z
            .string()
            .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
          operatorSecretReference: reference,
        })
        .strict(),
    ]),
    persistence: z
      .object({
        objectRoot: absolutePath,
        expectedSchemaVersion: z.string().regex(/^\d{4}$/u),
        readinessTimeoutMillis: z.number().int().min(1).max(30000),
        shutdownTimeoutMillis: z.number().int().min(1).max(30000),
        databases: z
          .object({
            api: database("api"),
            proposal: database("proposal"),
            export: database("export"),
            cleanup: database("cleanup"),
            billing: database("billing"),
          })
          .strict(),
      })
      .strict(),
    models: z
      .object({
        fundingSource: z.literal("provider-direct"),
        policyReference: z.literal("provider-direct-journal-v1"),
        policyConfigurationReference: reference,
        maximumInFlightInvocations: z.number().int().min(1).max(64),
        journalCloseTimeoutMilliseconds: z.number().int().min(1).max(30000),
        configuration: z.unknown().transform((value, context) => {
          try {
            return requireServerByokConfigurationV1(value);
          } catch {
            context.addIssue({
              code: "custom",
              message: "Unavailable model configuration",
            });
            return z.NEVER;
          }
        }),
      })
      .strict()
      .nullable(),
    adapters: z
      .object({
        proposalJobs: binding,
        solutionExports: binding,
        projectCleanup: binding,
        billing: binding,
        commercial: binding,
        github: binding,
        gitlab: binding,
        continuousConformance: binding,
      })
      .strict(),
    credentialSources: z.record(reference, credentialSource),
  })
  .strict();

type ParsedConfiguration = z.output<typeof configurationSchema>;
export type SelfHostConfiguration = Readonly<
  ParsedConfiguration & {
    readonly shutdownGraceMilliseconds: number;
    readonly issuer: string | null;
  }
>;
export type SelfHostCredentialResolver = (
  reference: string,
  signal: AbortSignal,
) => Promise<string>;
export type SelfHostCredentialSource = z.output<typeof credentialSource>;

export class SelfHostConfigurationError extends Error {
  readonly code = "self-host-configuration-unavailable";
  constructor() {
    super("The self-host server configuration is unavailable.");
    this.name = "SelfHostConfigurationError";
  }
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** A private startup document, never a request or browser configuration. All
 * passwords/keys/adapter settings are reference-resolved on the server. No
 * environment role, tenant, model, funding, or endpoint override is inferred. */
export function parseSelfHostConfiguration(
  raw: unknown,
): SelfHostConfiguration {
  try {
    const parsed = configurationSchema.parse(structuredClone(raw));
    // Only factories actually implemented in this artifact may be selected.
    const supported = {
      proposalJobs: "self-host.proposal-jobs-v1",
      solutionExports: "self-host.solution-exports-v1",
    } as const;
    for (const name of SELF_HOST_ADAPTER_NAMES) {
      const selected = parsed.adapters[name];
      if (selected === null) continue;
      if (
        !(name in supported) ||
        selected.adapterReference !==
          supported[name as keyof typeof supported] ||
        new Set(selected.credentialReferences).size !==
          selected.credentialReferences.length
      )
        throw new Error();
    }
    if ((parsed.models === null) !== (parsed.adapters.proposalJobs === null))
      throw new Error();
    if (
      parsed.models !== null &&
      parsed.models.configuration.limits.deadlineMilliseconds >
        parsed.server.requestDeadlineMilliseconds
    )
      throw new Error();
    const publicOrigin = new URL(parsed.server.publicOrigin);
    if (publicOrigin.origin !== parsed.server.publicOrigin) throw new Error();
    let issuer: string | null = null;
    if (parsed.identity.mode === "cognito") {
      const publicRuntime = parsePublicRuntimeConfig(
        parsed.identity.publicRuntime,
      );
      if (
        publicOrigin.origin !==
          new URL(publicRuntime.authentication.callbackUrl).origin ||
        parsed.identity.clientId !== publicRuntime.authentication.clientId ||
        (parsed.identity.accountAccess.registrationEnabled &&
          parsed.identity.directory !== "verified-cognito-bootstrap")
      )
        throw new Error();
      const region = parsed.identity.userPoolId.split("_")[0];
      issuer = `https://cognito-idp.${String(region)}.amazonaws.com/${parsed.identity.userPoolId}`;
    } else if (
      parsed.server.host !== "127.0.0.1" ||
      publicOrigin.hostname !== "127.0.0.1" ||
      !["http:", "https:"].includes(publicOrigin.protocol) ||
      publicOrigin.username !== "" ||
      publicOrigin.password !== ""
    )
      throw new Error();
    const used = new Set<string>(
      ORDINARY_PERSISTENCE_PURPOSES.map(
        (purpose) => parsed.persistence.databases[purpose].passwordReference,
      ),
    );
    if (parsed.identity.mode === "local-owner")
      used.add(parsed.identity.operatorSecretReference);
    for (const binding of Object.values(parsed.adapters)) {
      if (binding === null) continue;
      used.add(binding.configurationReference);
      binding.credentialReferences.forEach((name) => used.add(name));
    }
    if (parsed.models !== null) {
      used.add(parsed.models.policyConfigurationReference);
      used.add(parsed.models.configuration.credentialReference);
    }
    if (
      [...used].some((name) => parsed.credentialSources[name] === undefined) ||
      Object.keys(parsed.credentialSources).some((name) => !used.has(name))
    )
      throw new Error();
    // Reuse the owning persistence parser for all identity/path/connection bounds
    // before resolving any credential. This sentinel is never a runtime password.
    parseSelfHostPersistenceConfiguration({
      objectRoot: parsed.persistence.objectRoot,
      readinessTimeoutMillis: parsed.persistence.readinessTimeoutMillis,
      shutdownTimeoutMillis: parsed.persistence.shutdownTimeoutMillis,
      databases: Object.fromEntries(
        ORDINARY_PERSISTENCE_PURPOSES.map((purpose) => {
          const connection = Object.fromEntries(
            Object.entries(parsed.persistence.databases[purpose]).filter(
              ([key]) => key !== "passwordReference",
            ),
          );
          return [
            purpose,
            { ...connection, password: "configuration-validation-only" },
          ] as const;
        }),
      ),
    });
    const shutdownGraceMilliseconds =
      parsed.server.requestDeadlineMilliseconds +
      parsed.persistence.shutdownTimeoutMillis +
      (parsed.models?.journalCloseTimeoutMilliseconds ?? 0);
    if (shutdownGraceMilliseconds > 120000) throw new Error();
    // Workers must bound an invocation to this request bound. Journal recovery
    // and pool closure have their own budgets after cancellation/drain.
    return freeze({
      ...parsed,
      identity: parsed.identity,
      issuer,
      shutdownGraceMilliseconds,
    });
  } catch {
    throw new SelfHostConfigurationError();
  }
}

/** Redacted reference names for packaging; neither values nor file paths. */
export function selfHostRequiredReferences(
  config: SelfHostConfiguration,
): readonly string[] {
  return Object.freeze(Object.keys(config.credentialSources).sort());
}
