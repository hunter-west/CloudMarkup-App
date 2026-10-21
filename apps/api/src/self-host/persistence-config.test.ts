import { inspect } from "node:util";
import { tmpdir } from "node:os";
import { resolve, parse } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ORDINARY_PERSISTENCE_PURPOSES,
  parseSelfHostPersistenceConfiguration,
} from "./persistence-config.js";

function configuration() {
  return {
    objectRoot: resolve(tmpdir(), "cloudmarkup-config-synthetic"),
    readinessTimeoutMillis: 1000,
    shutdownTimeoutMillis: 1000,
    databases: Object.fromEntries<Record<string, unknown>>(
      ORDINARY_PERSISTENCE_PURPOSES.map(
        (purpose) =>
          [
            purpose,
            {
              host: "localhost",
              port: 5432,
              database: "cloudmarkup",
              user: `cloudmarkup_beta_${purpose}_runtime`,
              password: `synthetic-only-${purpose}`,
              tls: "disable",
              maxConnections: 2,
              connectionTimeoutMillis: 1000,
              idleTimeoutMillis: 1000,
              statementTimeoutMillis: 1000,
            },
          ] as const,
      ),
    ),
  };
}

describe("server-only persistence configuration", () => {
  it("supplies five fixed identities with bounded connections and no secret in public views", () => {
    const input = configuration();
    const config = parseSelfHostPersistenceConfiguration(input);
    expect(config.publicConfiguration.maximumConnections).toBe(10);
    expect(config.publicConfiguration.purposes).toEqual(
      ORDINARY_PERSISTENCE_PURPOSES,
    );
    for (const purpose of ORDINARY_PERSISTENCE_PURPOSES) {
      expect(config.poolConfiguration(purpose)).toMatchObject({
        user: `cloudmarkup_beta_${purpose}_runtime`,
        max: 2,
        database: "cloudmarkup",
        query_timeout: 1000,
      });
    }
    for (const view of [
      JSON.stringify(config),
      JSON.stringify(config.publicConfiguration),
      inspect(config),
    ]) {
      expect(view).not.toContain("synthetic-only");
      expect(view).not.toContain("localhost");
      expect(view).not.toContain(input.objectRoot);
    }
  });

  it("rejects unavailable private financial and deletion-phase configuration in the core profile", () => {
    const base = configuration();
    expect(
      parseSelfHostPersistenceConfiguration(base).publicConfiguration
        .maximumConnections,
    ).toBe(10);
    for (const extra of [
      { phaseAdmission: "deletion-phase-v1" },
      { phaseAdmission: undefined },
      {
        deletionFinancial: {
          ...base.databases["cleanup"],
          user: "cloudmarkup_deletion_financial_login",
          maxConnections: 1,
        },
      },
      {
        phaseAdmission: "deletion-phase-v1",
        deletionFinancial: {
          ...base.databases["cleanup"],
          user: "cloudmarkup_deletion_financial_login",
          maxConnections: 1,
        },
      },
    ])
      expect(() =>
        parseSelfHostPersistenceConfiguration({ ...base, ...extra }),
      ).toThrow();
  });

  it.each(ORDINARY_PERSISTENCE_PURPOSES)(
    "requires the %s connection and refuses owner, role, and database overrides",
    (purpose) => {
      const missing = configuration();
      expect(Reflect.deleteProperty(missing.databases, purpose)).toBe(true);
      expect(() => parseSelfHostPersistenceConfiguration(missing)).toThrow(
        "configuration is invalid",
      );
      for (const patch of [
        { user: "synthetic_owner" },
        { user: "cloudmarkup_beta_api_runtime", database: "other" },
        { options: "-c role=synthetic_owner" },
        { connectionString: "synthetic-secret-url" },
      ]) {
        const config = configuration();
        config.databases[purpose] = { ...config.databases[purpose], ...patch };
        expect(() => parseSelfHostPersistenceConfiguration(config)).toThrow(
          "configuration is invalid",
        );
      }
    },
  );

  it.each([
    "maxConnections",
    "port",
    "connectionTimeoutMillis",
    "idleTimeoutMillis",
    "statementTimeoutMillis",
  ])("rejects missing and out-of-bound %s", (field) => {
    for (const value of [undefined, 0, -1, 1.5, Number.NaN, 1_000_000, "2"]) {
      const config = configuration();
      config.databases["api"] = { ...config.databases["api"], [field]: value };
      expect(() => parseSelfHostPersistenceConfiguration(config)).toThrow(
        "configuration is invalid",
      );
    }
  });

  it.each([
    "",
    "relative/root",
    parse(resolve(tmpdir())).root,
    resolve(tmpdir()) + "/../unsafe",
  ])("rejects invalid root %s", (objectRoot) => {
    expect(() =>
      parseSelfHostPersistenceConfiguration({ ...configuration(), objectRoot }),
    ).toThrow("configuration is invalid");
  });

  it("requires all lifecycle bounds and rejects extras, missing TLS, and unsafe TLS options", () => {
    for (const patch of [
      { shutdownTimeoutMillis: 0 },
      { readinessTimeoutMillis: undefined },
      { readinessTimeoutMillis: 30001 },
      { extra: "synthetic-secret" },
    ]) {
      expect(() =>
        parseSelfHostPersistenceConfiguration({ ...configuration(), ...patch }),
      ).toThrow("configuration is invalid");
    }
    for (const tls of [
      undefined,
      "require",
      true,
      { mode: "verify-full", rejectUnauthorized: false },
    ]) {
      const config = configuration();
      config.databases["api"] = { ...config.databases["api"], tls };
      expect(() => parseSelfHostPersistenceConfiguration(config)).toThrow(
        "configuration is invalid",
      );
    }
  });

  it("copies caller configuration and returned TLS options without weakening verification", () => {
    const input = configuration();
    input.databases["api"] = {
      ...input.databases["api"],
      tls: { mode: "verify-full", ca: "synthetic\ncertificate" },
    };
    const config = parseSelfHostPersistenceConfiguration(input);
    input.databases["api"] = { ...input.databases["api"], password: "changed" };
    const first = config.poolConfiguration("api");
    first.user = "changed";
    if (typeof first.ssl === "object") first.ssl.rejectUnauthorized = false;
    expect(config.poolConfiguration("api")).toMatchObject({
      user: "cloudmarkup_beta_api_runtime",
      password: "synthetic-only-api",
      ssl: { rejectUnauthorized: true, ca: "synthetic\ncertificate" },
    });
  });

  it("redacts errors from malformed server input", () => {
    expect(() =>
      parseSelfHostPersistenceConfiguration({ password: "synthetic-secret" }),
    ).toThrow("configuration is invalid");
    try {
      parseSelfHostPersistenceConfiguration({ password: "synthetic-secret" });
    } catch (error) {
      expect(inspect(error)).not.toContain("synthetic-secret");
      expect(JSON.stringify(error)).not.toContain("synthetic-secret");
    }
  });

  it("refuses inherited settings and redacts errors thrown by server configuration accessors", () => {
    const inherited: unknown = Object.create(configuration());
    expect(() => parseSelfHostPersistenceConfiguration(inherited)).toThrow(
      "configuration is invalid",
    );
    const accessor = {
      get objectRoot(): string {
        throw Error("synthetic-secret-accessor");
      },
    };
    expect(() => parseSelfHostPersistenceConfiguration(accessor)).toThrow(
      "configuration is invalid",
    );
  });
});
