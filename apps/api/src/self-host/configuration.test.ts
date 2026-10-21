import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ORDINARY_PERSISTENCE_PURPOSES } from "./persistence-config.js";
import {
  parseSelfHostConfiguration,
  selfHostRequiredReferences,
} from "./configuration.js";

function document() {
  return {
    schemaVersion: 1,
    server: {
      host: "0.0.0.0",
      port: 3000,
      publicOrigin: "https://app.example.invalid",
      requestDeadlineMilliseconds: 60000,
      maximumInFlightRequests: 8,
    },
    identity: {
      mode: "cognito",
      userPoolId: "us-east-1_SYNTHETIC",
      clientId: "synthetic-client",
      directory: "existing-principals",
      publicRuntime: {
        schemaVersion: 1,
        authentication: {
          provider: "cognito",
          clientId: "synthetic-client",
          domain: "https://identity.example.invalid",
          callbackUrl: "https://app.example.invalid/auth/callback",
          logoutUrl: "https://app.example.invalid/",
          scopes: ["openid", "profile", "cloudmarkup-api/access"],
        },
      },
      accountAccess: {
        schemaVersion: 1,
        managedLogin: true,
        registrationEnabled: false,
      },
      accountSecurity: { schemaVersion: 1, recoveryContact: null },
    },
    persistence: {
      objectRoot: resolve(tmpdir(), "self-host-config-synthetic"),
      expectedSchemaVersion: "0138",
      readinessTimeoutMillis: 1000,
      shutdownTimeoutMillis: 30000,
      databases: Object.fromEntries<Record<string, unknown>>(
        ORDINARY_PERSISTENCE_PURPOSES.map(
          (purpose) =>
            [
              purpose,
              {
                host: "postgres",
                port: 5432,
                database: "cloudmarkup",
                user: `cloudmarkup_beta_${purpose}_runtime`,
                passwordReference: `operator.database.${purpose}`,
                tls: "disable",
                maxConnections: 2,
                connectionTimeoutMillis: 1000,
                idleTimeoutMillis: 1000,
                statementTimeoutMillis: 30000,
              },
            ] as const,
        ),
      ),
    },
    models: null as unknown,
    adapters: {
      proposalJobs: null as unknown,
      solutionExports: null,
      projectCleanup: null,
      billing: null,
      commercial: null,
      github: null,
      gitlab: null,
      continuousConformance: null,
    },
    credentialSources: Object.fromEntries<Record<string, unknown>>(
      ORDINARY_PERSISTENCE_PURPOSES.map(
        (purpose) =>
          [
            `operator.database.${purpose}`,
            {
              kind: "environment",
              name: `SYNTHETIC_PG_${purpose.toUpperCase()}`,
            },
          ] as const,
      ),
    ),
  };
}
function byok() {
  return {
    fundingSource: "provider-direct",
    policyReference: "provider-direct-journal-v1",
    policyConfigurationReference: "operator.policy.byok",
    maximumInFlightInvocations: 2,
    journalCloseTimeoutMilliseconds: 10000,
    configuration: {
      contractVersion: 1,
      provider: "openai-responses",
      endpoint: "https://api.openai.com/v1/responses",
      credentialReference: "operator.openai.primary",
      usageSemantics: "openai-responses-tokens.v1",
      roles: Object.fromEntries(
        ["architecture", "applicationSource"].map((role) => [
          role,
          { model: "gpt-4.1-2025-04-14", maximumOutputTokens: 512 },
        ]),
      ),
      limits: {
        maximumInputBytes: 1024,
        maximumRequestBytes: 4096,
        maximumResponseBytes: 8192,
        deadlineMilliseconds: 60000,
      },
    },
  };
}

it("admits an explicit loopback local owner and refuses mixed, missing-proof and actual broadcast-listener configurations", () => {
  const base = document();
  const local = {
    ...base,
    server: {
      ...base.server,
      host: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:4317",
    },
    identity: {
      mode: "local-owner",
      ownerPrincipalId: "principal_local_owner",
      operatorSecretReference: "operator.owner",
    },
    credentialSources: {
      ...base.credentialSources,
      "operator.owner": { kind: "environment", name: "SYNTHETIC_OWNER_PROOF" },
    },
  };
  const parsed = parseSelfHostConfiguration(local);
  expect(parsed.issuer).toBeNull();
  expect(parsed.identity.mode).toBe("local-owner");
  for (const change of [
    { server: { ...local.server, host: "0.0.0.0" } },
    { server: { ...local.server, publicOrigin: "http://localhost:4317" } },
    { identity: { ...local.identity, clientId: "mixed-cognito" } },
    { credentialSources: base.credentialSources },
  ])
    expect(() => parseSelfHostConfiguration({ ...local, ...change })).toThrow();
});

it("refuses configured optional adapters even with declared credentials", () => {
  const base = document();
  const configured = {
    ...base,
    adapters: {
      ...base.adapters,
      github: {
        adapterReference: "self-host.github-v1",
        configurationReference: "operator.github.settings",
        credentialReferences: ["operator.github.key"],
      },
    },
    credentialSources: {
      ...base.credentialSources,
      "operator.github.settings": {
        kind: "environment",
        name: "SYNTHETIC_GITHUB_SETTINGS",
      },
      "operator.github.key": {
        kind: "environment",
        name: "SYNTHETIC_GITHUB_KEY",
      },
    },
  };
  expect(() => parseSelfHostConfiguration(configured)).toThrow(
    "configuration is unavailable",
  );
  expect(() =>
    parseSelfHostConfiguration({
      ...configured,
      adapters: {
        ...configured.adapters,
        github: {
          ...configured.adapters.github,
          credentialReferences: ["operator.github.key", "operator.github.key"],
        },
      },
    }),
  ).toThrow();
  expect(() =>
    parseSelfHostConfiguration({
      ...configured,
      credentialSources: {
        ...base.credentialSources,
        "operator.github.settings":
          configured.credentialSources["operator.github.settings"],
      },
    }),
  ).toThrow();
});

describe("strict server startup configuration", () => {
  it("accepts the E port/mount contract and preserves five explicit purpose references", () => {
    const config = parseSelfHostConfiguration(document());
    expect(config.server.port).toBe(3000);
    expect(config.shutdownGraceMilliseconds).toBe(90000);
    expect(selfHostRequiredReferences(config)).toEqual(
      ORDINARY_PERSISTENCE_PURPOSES.map(
        (purpose) => `operator.database.${purpose}`,
      ).sort(),
    );
    expect(config.issuer).toBe(
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SYNTHETIC",
    );
  });
  it("bounds grace and requires an explicit proposal factory and declared model references", () => {
    const input = document();
    expect(parseSelfHostConfiguration(input).shutdownGraceMilliseconds).toBe(
      90000,
    );
    input.models = byok();
    expect(() => parseSelfHostConfiguration(input)).toThrow(
      "configuration is unavailable",
    );
    input.adapters.proposalJobs = {
      adapterReference: "self-host.proposal-jobs-v1",
      configurationReference: "operator.jobs",
      credentialReferences: [],
    };
    for (const [reference, name] of [
      ["operator.jobs", "SYNTHETIC_JOBS"],
      ["operator.policy.byok", "SYNTHETIC_POLICY"],
      ["operator.openai.primary", "SYNTHETIC_PROVIDER_KEY"],
    ] as const)
      input.credentialSources[reference] = { kind: "environment", name };
    const configured = parseSelfHostConfiguration(input);
    expect(configured.models?.configuration.roles.architecture.model).toBe(
      "gpt-4.1-2025-04-14",
    );
    expect(configured.shutdownGraceMilliseconds).toBe(100000);
    expect(Object.isFrozen(configured.models?.configuration.roles)).toBe(true);
    input.models = null;
    input.server.requestDeadlineMilliseconds = 120000;
    expect(() => parseSelfHostConfiguration(input)).toThrow(
      "configuration is unavailable",
    );
  });
  it("admits a deterministic export factory without a model key and rejects arbitrary references", () => {
    const input = document();
    const binding = {
      adapterReference: "self-host.solution-exports-v1",
      configurationReference: "operator.exports",
      credentialReferences: [],
    };
    const candidate = {
      ...input,
      adapters: { ...input.adapters, solutionExports: binding },
      credentialSources: {
        ...input.credentialSources,
        "operator.exports": { kind: "environment", name: "SYNTHETIC_EXPORTS" },
      },
    };
    const config = parseSelfHostConfiguration(candidate);
    expect(config.models).toBeNull();
    expect(selfHostRequiredReferences(config)).not.toContain(
      "operator.openai.primary",
    );
    for (const change of [
      { adapterReference: "operator.arbitrary-module" },
      { credentialReferences: ["operator.exports", "operator.exports"] },
    ])
      expect(() =>
        parseSelfHostConfiguration({
          ...candidate,
          adapters: {
            ...candidate.adapters,
            solutionExports: { ...binding, ...change },
          },
        }),
      ).toThrow();
  });
  it.each(ORDINARY_PERSISTENCE_PURPOSES)(
    "refuses missing, owner, aliased-purpose and inline-password %s configuration",
    (purpose) => {
      const missing = document();
      Reflect.deleteProperty(missing.persistence.databases, purpose);
      expect(() => parseSelfHostConfiguration(missing)).toThrow();
      for (const patch of [
        { user: "synthetic_owner" },
        { user: "cloudmarkup_beta_billing_runtime", database: "other" },
        { password: "synthetic-secret" },
        { connectionString: "synthetic-secret-url" },
      ]) {
        const input = document();
        input.persistence.databases[purpose] = {
          ...input.persistence.databases[purpose],
          ...patch,
        };
        expect(() => parseSelfHostConfiguration(input)).toThrow();
      }
    },
  );
  it("requires supported verified browser auth and refuses origin/client/registration mismatches", () => {
    for (const patch of [
      { mode: "local" },
      { clientId: "other" },
      {
        directory: "existing-principals",
        accountAccess: {
          schemaVersion: 1,
          managedLogin: true,
          registrationEnabled: true,
        },
      },
    ]) {
      expect(() =>
        parseSelfHostConfiguration({
          ...document(),
          identity: { ...document().identity, ...patch },
        }),
      ).toThrow();
    }
    expect(() =>
      parseSelfHostConfiguration({
        ...document(),
        server: { ...document().server, publicOrigin: "http://localhost:3000" },
      }),
    ).toThrow();
  });
  it("refuses extra/unresolved references and missing per-job funding", () => {
    const extra = document();
    extra.credentialSources["operator.extra"] = {
      kind: "environment",
      name: "SYNTHETIC_UNUSED",
    };
    expect(() => parseSelfHostConfiguration(extra)).toThrow();
    const missing = document();
    delete missing.credentialSources["operator.database.api"];
    expect(() => parseSelfHostConfiguration(missing)).toThrow();
    const jobs = document();
    jobs.adapters.proposalJobs = {
      adapterReference: "synthetic.jobs",
      configurationReference: "operator.jobs",
    };
    expect(() => parseSelfHostConfiguration(jobs)).toThrow();
    const invalid = document();
    invalid.models = { ...byok(), fundingSource: "hosted-credits" };
    expect(() => parseSelfHostConfiguration(invalid)).toThrow();
  });
  it("freezes parsed configuration and redacts malformed values from errors", () => {
    const config = parseSelfHostConfiguration(document());
    expect(Object.isFrozen(config.persistence.databases.api)).toBe(true);
    expect(() =>
      parseSelfHostConfiguration({ ...document(), secret: "synthetic-secret" }),
    ).toThrow("configuration is unavailable");
    try {
      parseSelfHostConfiguration({ secret: "synthetic-secret" });
    } catch (error) {
      expect(String(error)).not.toContain("synthetic-secret");
      expect(error).not.toHaveProperty("cause");
    }
  });
});
