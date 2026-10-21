import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readinessResponseV1Schema } from "@cloudmarkup/api-contract";
import type {
  SqlDatabase,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "../adapters/persistence/sql.js";
import type { SelfHostPersistenceRuntime } from "./persistence-runtime.js";
import { ORDINARY_PERSISTENCE_PURPOSES } from "./persistence-config.js";
import { loadSelfHostMigrationProfile } from "./migration-profile.js";
import {
  createSelfHostRuntime,
  type SelfHostRuntimeFactories,
} from "./runtime.js";

function document() {
  return {
    schemaVersion: 1,
    server: {
      host: "127.0.0.1",
      port: 3000,
      publicOrigin: "https://app.example.invalid",
      requestDeadlineMilliseconds: 100,
      maximumInFlightRequests: 2,
    },
    identity: {
      mode: "cognito",
      userPoolId: "us-east-1_SYNTHETIC",
      clientId: "a".repeat(26),
      directory: "existing-principals",
      publicRuntime: {
        schemaVersion: 1,
        authentication: {
          provider: "cognito",
          clientId: "a".repeat(26),
          domain: "https://synthetic.auth.us-east-1.amazoncognito.com",
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
      objectRoot: resolve(tmpdir(), "self-host-runtime-synthetic"),
      expectedSchemaVersion: "0138",
      readinessTimeoutMillis: 100,
      shutdownTimeoutMillis: 100,
      databases: Object.fromEntries(
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
                connectionTimeoutMillis: 100,
                idleTimeoutMillis: 100,
                statementTimeoutMillis: 100,
              },
            ] as const,
        ),
      ),
    },
    models: null as unknown,
    adapters: Object.fromEntries<unknown>(
      [
        "proposalJobs",
        "solutionExports",
        "projectCleanup",
        "billing",
        "commercial",
        "github",
        "gitlab",
        "continuousConformance",
      ].map((name) => [name, null] as const),
    ),
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
function fixture() {
  const statements: SqlStatement[] = [];
  let available = true;
  let ledger = [{ version: "0138", checksum_sha256: "a".repeat(64) }];
  const database = (): SqlDatabase => ({
    close: vi.fn(() => Promise.resolve()),
    query<TRow extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      statements.push(statement);
      let rows: SqlRow[] = [];
      if (statement.text.includes("cloudmarkup_schema_migrations"))
        rows = ledger;
      if (statement.text.includes("principal_identity_references"))
        rows = [{ principal_id: "synthetic_actor" }];
      if (statement.text.includes("cloudmarkup_account_session_allowed_v1"))
        rows = [{ allowed: true }];
      if (statement.text.includes("FROM principals WHERE"))
        rows = [{ principal_id: "synthetic_actor" }];
      if (statement.text.includes("AS self_host_identity_ready"))
        rows = [{ self_host_identity_ready: true }];
      return Promise.resolve({
        rowCount: rows.length,
        rows: rows as readonly TRow[],
      });
    },
    transaction: async (work) => work(database()),
  });
  const databases = {
    api: database(),
    proposal: database(),
    export: database(),
    cleanup: database(),
    billing: database(),
  };
  const close = vi.fn(() => {
    available = false;
    return Promise.resolve();
  });
  const persistence: SelfHostPersistenceRuntime = {
    databases,
    close,
    objectStore: {
      initialize: () => Promise.resolve(),
      stage: () => Promise.reject(Error("Unexpected synthetic storage call")),
      head: () => Promise.resolve(null),
      open: () => Promise.reject(Error("Unexpected synthetic storage call")),
      publish: () => Promise.resolve(),
      discardStaged: () => Promise.resolve(),
      requestDeletion: () => Promise.resolve(),
    },
    publicConfiguration: {
      storageProvider: "filesystem",
      purposes: ORDINARY_PERSISTENCE_PURPOSES,
      maximumConnections: 10,
      readinessTimeoutMillis: 100,
      shutdownTimeoutMillis: 100,
    },
    readiness: () => ({
      state: available ? "ready" : "unavailable",
      ordinaryPurposes: ORDINARY_PERSISTENCE_PURPOSES,
    }),
    checkReadiness: () =>
      Promise.resolve({
        state: available ? "ready" : "unavailable",
        ordinaryPurposes: ORDINARY_PERSISTENCE_PURPOSES,
      }),
  };
  const resolveCredential = vi.fn(() =>
    Promise.resolve("synthetic-password-only"),
  );
  const factories: SelfHostRuntimeFactories = {
    resolveCredential,
    persistence: () => Promise.resolve(persistence),
    assertMigrationProfileReady: () => Promise.resolve(),
    readMigrations: () =>
      Promise.resolve([
        {
          version: "0138",
          file: "0138_synthetic.sql",
          checksumSha256: "a".repeat(64),
          statements: [],
        },
      ]),
    tokenVerifier: {
      verify: () =>
        Promise.resolve({
          token_use: "access",
          iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SYNTHETIC",
          sub: "synthetic_subject",
          auth_time: Math.floor(Date.now() / 1000) - 1,
          exp: Math.floor(Date.now() / 1000) + 600,
          jti: "synthetic_session",
          scope: "cloudmarkup-api/access",
          organizationId: "forged_org",
          role: "owner",
        }),
    },
  };
  return {
    factories,
    databases,
    persistence,
    resolveCredential,
    close,
    statements,
    setUnavailable: () => {
      available = false;
    },
    setLedger: (rows: typeof ledger) => {
      ledger = rows;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});

describe("shared self-host runtime admission and lifecycle", () => {
  it("composes all local-owner account controls with trusted loopback mode before HTTP admission", async () => {
    const f = fixture();
    const base = document();
    const raw = {
      ...base,
      server: { ...base.server, publicOrigin: "http://127.0.0.1:3000" },
      identity: {
        mode: "local-owner",
        ownerPrincipalId: "synthetic_actor",
        operatorSecretReference: "operator.local-owner",
      },
      credentialSources: {
        ...base.credentialSources,
        "operator.local-owner": {
          kind: "environment",
          name: "SYNTHETIC_OWNER_PROOF",
        },
      },
    };
    const running = await createSelfHostRuntime(raw, {
      ...f.factories,
      resolveCredential: (reference) =>
        Promise.resolve(
          reference === "operator.local-owner"
            ? Buffer.alloc(32, 7).toString("base64url")
            : "synthetic-password-only",
        ),
    });
    try {
      expect(
        (await running.checkReadiness()).every((check) => check.ready),
      ).toBe(true);
      expect(
        (await running.app.fetch(new Request("http://127.0.0.1:3000/v1/me")))
          .status,
      ).toBe(401);
      expect((await running.app.request("/runtime-config")).status).toBe(404);
      const exports = await running.app.request("/runtime-config?view=exports");
      expect(exports.status).toBe(200);
      expect(await exports.json()).toMatchObject({
        exports: { targets: [] },
      });
    } finally {
      await running.close();
    }
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("the executable default verifies the actual standalone ledger and identity through every guarded purpose", async () => {
    const profile = await loadSelfHostMigrationProfile();
    const f = fixture();
    f.setLedger(
      profile.migrations.map((m) => ({
        version: m.version,
        checksum_sha256: m.checksumSha256,
      })),
    );
    const inspected = new Set<string>();
    const admission = { wrongPurpose: undefined as string | undefined };
    for (const purpose of ORDINARY_PERSISTENCE_PURPOSES) {
      const database = f.databases[purpose];
      const base = database.query.bind(database);
      database.query = async <TRow extends SqlRow>(
        statement: SqlStatement,
      ): Promise<SqlResult<TRow>> => {
        let rows: SqlRow[] | undefined;
        if (statement.text.startsWith("SELECT pg_catalog.current_database()"))
          rows = [
            {
              database_name: "cloudmarkup",
              login: `cloudmarkup_beta_${purpose}_runtime`,
              effective_role: `cloudmarkup_beta_${purpose}_runtime`,
              server_version: 170011,
              replication_role: "origin",
              self_grant: "",
              standalone: true,
              bootstrap_owner: true,
              safe_owner: true,
              safe_caller: true,
              has_profile: true,
              has_ledger: true,
            },
          ];
        if (statement.text.startsWith("SELECT p.*")) {
          inspected.add(purpose);
          rows = [
            {
              singleton: true,
              profile_id:
                purpose === admission.wrongPurpose
                  ? "wrong-profile"
                  : profile.identity.profileId,
              profile_version: 1,
              engine_major: 17,
              schema_owner: "cloudmarkup_admin",
              bootstrap_grantor: "cloudmarkup_owner",
              actual_owner: "cloudmarkup_admin",
            },
          ];
        }
        return rows === undefined
          ? base<TRow>(statement)
          : { rowCount: rows.length, rows: rows as readonly TRow[] };
      };
    }
    const input = document();
    input.persistence.expectedSchemaVersion = "0138";
    input.persistence.readinessTimeoutMillis = 5000;
    const factories = { ...f.factories };
    Reflect.deleteProperty(factories, "readMigrations");
    Reflect.deleteProperty(factories, "assertMigrationProfileReady");
    const runtime = await createSelfHostRuntime(input, factories);
    expect(inspected).toEqual(new Set(ORDINARY_PERSISTENCE_PURPOSES));
    expect(profile.migrations[0]?.version).toBe("0000");
    expect(profile.migrations.at(-1)?.version).toBe("0138");
    admission.wrongPurpose = "cleanup";
    expect(
      (await runtime.checkReadiness()).find((c) => c.name === "schema")?.ready,
    ).toBe(false);
    await runtime.close();
  });
  it("composes the shared API with verified Cognito/session adapters and truthful unavailable optional routes", async () => {
    const f = fixture();
    const runtime = await createSelfHostRuntime(document(), f.factories);
    expect((await runtime.app.request("/ready")).status).toBe(200);
    expect((await runtime.app.request("/v1/me")).status).toBe(401);
    const allowed = await runtime.app.request(
      "/v1/me/presentation-preferences",
      { headers: { authorization: "Bearer synthetic.jwt.token" } },
    );
    expect(allowed.status).toBe(200);
    expect(
      f.statements.some((statement) =>
        statement.values.includes("synthetic_actor"),
      ),
    ).toBe(true);
    expect(
      f.statements.every(
        (statement) => !statement.values.includes("forged_org"),
      ),
    ).toBe(true);
    const denied = await runtime.app.request("/v1/projects/project_other", {
      headers: { authorization: "Bearer synthetic.jwt.token" },
    });
    expect(denied.status).toBe(404);
    const capabilities = await runtime.app.request("/runtime-config?view=ai");
    expect(await capabilities.json()).toMatchObject({
      proposalVersions: [],
      applicationSources: [],
    });
    expect(
      runtime.adapterLedger().every((entry) => entry.state === "unconfigured"),
    ).toBe(true);
    expect((await runtime.close()).resourcesDisposed).toBe(true);
    expect(f.close).toHaveBeenCalledTimes(1);
    await runtime.close();
    expect(f.close).toHaveBeenCalledTimes(1);
    expect((await runtime.app.request("/v1/me")).status).toBe(503);
    expect((await runtime.app.request("/ready")).status).toBe(503);
  });
  it("serves a valid readiness response when a camel-case adapter is configured", async () => {
    const f = fixture();
    const input = document();
    input.adapters["solutionExports"] = {
      adapterReference: "self-host.solution-exports-v1",
      configurationReference: "operator.export",
    };
    input.credentialSources["operator.export"] = {
      kind: "environment",
      name: "SYNTHETIC_EXPORT_SETTINGS",
    };
    const runtime = await createSelfHostRuntime(input, {
      ...f.factories,
      resolveCredential: (reference) =>
        Promise.resolve(
          reference === "operator.export" ? "{}" : "synthetic-password-only",
        ),
      adapters: {
        solutionExports: {
          reference: "self-host.solution-exports-v1",
          create: () =>
            Promise.resolve({
              api: { solutionExports: {} as never },
              worker: {
                purpose: "export" as const,
                start: () => Promise.resolve(),
                stopAdmissions: () => undefined,
                cancel: () => undefined,
                drain: () => Promise.resolve(),
                close: () => Promise.resolve(),
              },
              assertReady: () => Promise.resolve(),
              close: () => Promise.resolve(),
            }),
        },
      },
    });
    try {
      const response = await runtime.app.request("/ready");
      expect(response.status).toBe(200);
      const readiness = readinessResponseV1Schema.parse(await response.json());
      expect(
        readiness.checks.some(
          (check) =>
            check.name === "solution-exports" && check.status === "ready",
        ),
      ).toBe(true);
    } finally {
      await runtime.close();
    }
  });
  it("refuses a configured missing/mismatched adapter before secret acquisition", async () => {
    const input = document();
    input.adapters["github"] = {
      adapterReference: "synthetic.github",
      configurationReference: "operator.github",
    };
    input.credentialSources["operator.github"] = {
      kind: "environment",
      name: "SYNTHETIC_GITHUB",
    };
    const f = fixture();
    await expect(createSelfHostRuntime(input, f.factories)).rejects.toThrow(
      "configuration is unavailable",
    );
    expect(f.resolveCredential).toHaveBeenCalledTimes(0);
  });
  it("refuses schema mismatch/permission failure and closes the owned persistence exactly once", async () => {
    const f = fixture();
    f.setLedger([{ version: "0136", checksum_sha256: "b".repeat(64) }]);
    await expect(
      createSelfHostRuntime(document(), f.factories),
    ).rejects.toThrow("could not be admitted");
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("does not advertise configured AI while C is absent from the canonical ledger", async () => {
    const f = fixture();
    const input = document();
    input.models = {
      fundingSource: "provider-direct",
      policyReference: "provider-direct-journal-v1",
      policyConfigurationReference: "operator.policy",
      maximumInFlightInvocations: 1,
      journalCloseTimeoutMilliseconds: 100,
      configuration: {
        contractVersion: 1,
        provider: "openai-responses",
        endpoint: "https://api.openai.com/v1/responses",
        credentialReference: "operator.openai",
        usageSemantics: "openai-responses-gpt-4.1.v1",
        roles: Object.fromEntries(
          [
            "architecture",
            "applicationSource",
            "nativeSource",
            "typedPlanning",
          ].map((role) => [
            role,
            { model: "gpt-4.1-2025-04-14", maximumOutputTokens: 512 },
          ]),
        ),
        limits: {
          maximumInputBytes: 1024,
          maximumRequestBytes: 4096,
          maximumResponseBytes: 8192,
          deadlineMilliseconds: 100,
        },
      },
    };
    input.credentialSources["operator.policy"] = {
      kind: "environment",
      name: "SYNTHETIC_POLICY",
    };
    input.credentialSources["operator.openai"] = {
      kind: "environment",
      name: "SYNTHETIC_OPENAI",
    };
    await expect(createSelfHostRuntime(input, f.factories)).rejects.toThrow(
      "configuration is unavailable",
    );
    expect(f.resolveCredential).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
  });
  it("invalidates public capability/admission projections after an observed storage outage", async () => {
    const f = fixture();
    const runtime = await createSelfHostRuntime(document(), f.factories);
    f.setUnavailable();
    expect((await runtime.app.request("/v1/me")).status).toBe(503);
    expect((await runtime.app.request("/ready")).status).toBe(503);
    expect(
      await (await runtime.app.request("/runtime-config?view=exports")).json(),
    ).toMatchObject({ exports: { targets: [] } });
    await runtime.close();
  });
  it("does not issue new checks after close begins while a readiness check is waiting", async () => {
    const f = fixture();
    const runtime = await createSelfHostRuntime(document(), f.factories);
    let finish: (() => void) | undefined;
    f.persistence.checkReadiness = () =>
      new Promise((resolve) => {
        finish = () => {
          resolve({
            state: "ready",
            ordinaryPurposes: ORDINARY_PERSISTENCE_PURPOSES,
          });
        };
      });
    const before = f.statements.length;
    const checking = runtime.checkReadiness();
    const closing = runtime.close();
    if (finish === undefined)
      throw Error("Missing synthetic check continuation");
    finish();
    await checking;
    await closing;
    expect(f.statements.length).toBe(before);
    await runtime.checkReadiness();
    expect(f.statements.length).toBe(before);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("keeps pools alive for underlying readiness work after its public wait times out", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const runtime = await createSelfHostRuntime(document(), f.factories);
    let finish: (() => void) | undefined;
    f.persistence.checkReadiness = () =>
      new Promise((resolve) => {
        finish = () => {
          resolve({
            state: "ready",
            ordinaryPurposes: ORDINARY_PERSISTENCE_PURPOSES,
          });
        };
      });
    const checking = runtime.checkReadiness();
    await vi.advanceTimersByTimeAsync(100);
    expect(await checking).toEqual([{ name: "admission", ready: false }]);
    const closing = runtime.close();
    await Promise.resolve();
    expect(f.close).toHaveBeenCalledTimes(0);
    if (finish === undefined)
      throw Error("Missing synthetic check continuation");
    finish();
    expect((await closing).resourcesDisposed).toBe(true);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
});
