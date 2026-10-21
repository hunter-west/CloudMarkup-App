import { isAbsolute, parse, resolve } from "node:path";
import type { PoolConfig } from "pg";

import type { OrdinaryRuntimeHost } from "../adapters/persistence/ordinary-runtime-database.js";

export const ORDINARY_PERSISTENCE_PURPOSES = Object.freeze([
  "api",
  "proposal",
  "export",
  "cleanup",
  "billing",
] as const satisfies readonly OrdinaryRuntimeHost[]);

export class PersistenceConfigurationError extends Error {
  readonly code = "invalid-persistence-configuration";
  constructor() {
    super("The server persistence configuration is invalid.");
    this.name = "PersistenceConfigurationError";
  }
}

function invalid(): never {
  throw new PersistenceConfigurationError();
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    invalid();
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    invalid();
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function text(value: unknown, maximum = 1024): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.includes("\u0000") ||
    /[\r\n]/u.test(value)
  )
    invalid();
  return value;
}
function certificate(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 65536 ||
    value.includes("\u0000")
  )
    invalid();
  return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    invalid();
  return value;
}

export interface PublicPersistenceConfiguration {
  readonly storageProvider: "filesystem";
  readonly purposes: readonly OrdinaryRuntimeHost[];
  readonly maximumConnections: number;
  readonly readinessTimeoutMillis: number;
  readonly shutdownTimeoutMillis: number;
}

/** Trusted startup configuration, never HTTP input. Use structured connection
 * fields, not URLs/options that can override identities or inject pg settings.
 * Actual admission remains the OrdinaryRuntimeDatabase guard on every tx.
 * Secrets live in private fields; JSON and inspection expose no credentials.
 */
export class SelfHostPersistenceConfiguration {
  readonly #root: string;
  readonly #pools: Readonly<Record<OrdinaryRuntimeHost, PoolConfig>>;
  readonly publicConfiguration: PublicPersistenceConfiguration;

  private constructor(
    root: string,
    pools: Record<OrdinaryRuntimeHost, PoolConfig>,
    readinessTimeoutMillis: number,
    shutdownTimeoutMillis: number,
  ) {
    this.#root = root;
    this.#pools = pools;
    this.publicConfiguration = Object.freeze({
      storageProvider: "filesystem",
      purposes: Object.freeze([...ORDINARY_PERSISTENCE_PURPOSES]),
      maximumConnections: ORDINARY_PERSISTENCE_PURPOSES.reduce(
        (total, purpose) => total + (pools[purpose].max ?? 0),
        0,
      ),
      readinessTimeoutMillis,
      shutdownTimeoutMillis,
    });
    Object.freeze(this);
  }

  static from(input: unknown): SelfHostPersistenceConfiguration {
    try {
      const config = record(input);
      keys(config, [
        "objectRoot",
        "databases",
        "readinessTimeoutMillis",
        "shutdownTimeoutMillis",
      ]);
      const root = text(config["objectRoot"], 4096);
      if (
        !isAbsolute(root) ||
        resolve(root) === parse(resolve(root)).root ||
        root.split(/[\\/]/u).includes("..")
      )
        invalid();
      const databases = record(config["databases"]);
      keys(databases, ORDINARY_PERSISTENCE_PURPOSES);
      const pools = {} as Record<OrdinaryRuntimeHost, PoolConfig>;
      const parseConnection = (
        input: unknown,
        user: string,
        purpose: string,
        maximum: number,
      ): PoolConfig => {
        const connection = record(input);
        keys(connection, [
          "host",
          "port",
          "database",
          "user",
          "password",
          "tls",
          "maxConnections",
          "connectionTimeoutMillis",
          "idleTimeoutMillis",
          "statementTimeoutMillis",
        ]);
        const host = text(connection["host"], 253);
        if (!/^[A-Za-z0-9._:-]+$/u.test(host)) invalid();
        // These are the existing guard's current logins, including its beta names.
        if (
          connection["user"] !== user ||
          connection["database"] !== "cloudmarkup"
        )
          invalid();
        const tls = connection["tls"];
        let ssl: PoolConfig["ssl"];
        if (tls === "disable") ssl = false;
        else {
          const settings = record(tls);
          keys(settings, ["mode", "ca"]);
          if (settings["mode"] !== "verify-full") invalid();
          ssl = Object.freeze(
            settings["ca"] === undefined
              ? { rejectUnauthorized: true }
              : { rejectUnauthorized: true, ca: certificate(settings["ca"]) },
          );
        }
        const statementTimeoutMillis = integer(
          connection["statementTimeoutMillis"],
          1,
          120000,
        );
        return Object.freeze({
          host,
          port: integer(connection["port"], 1, 65535),
          database: "cloudmarkup",
          user,
          password: text(connection["password"], 4096),
          ssl,
          max: integer(connection["maxConnections"], 1, maximum),
          connectionTimeoutMillis: integer(
            connection["connectionTimeoutMillis"],
            1,
            60000,
          ),
          idleTimeoutMillis: integer(connection["idleTimeoutMillis"], 1, 60000),
          statement_timeout: statementTimeoutMillis,
          query_timeout: statementTimeoutMillis,
          application_name: `cloudmarkup-self-host-${purpose}`,
          allowExitOnIdle: true,
        });
      };
      for (const purpose of ORDINARY_PERSISTENCE_PURPOSES)
        pools[purpose] = parseConnection(
          databases[purpose],
          `cloudmarkup_beta_${purpose}_runtime`,
          purpose,
          20,
        );
      return new SelfHostPersistenceConfiguration(
        resolve(root),
        pools,
        integer(config["readinessTimeoutMillis"], 1, 30000),
        integer(config["shutdownTimeoutMillis"], 1, 30000),
      );
    } catch {
      invalid();
    }
  }

  /** Server-only access for the owned lifecycle factory; never public config. */
  objectRoot(): string {
    return this.#root;
  }
  poolConfiguration(purpose: OrdinaryRuntimeHost): PoolConfig {
    if (!ORDINARY_PERSISTENCE_PURPOSES.includes(purpose)) invalid();
    const pool = this.#pools[purpose];
    return {
      ...pool,
      ssl: typeof pool.ssl === "object" ? { ...pool.ssl } : pool.ssl,
    };
  }
  toJSON(): PublicPersistenceConfiguration {
    return this.publicConfiguration;
  }
}

export function parseSelfHostPersistenceConfiguration(
  input: unknown,
): SelfHostPersistenceConfiguration {
  return SelfHostPersistenceConfiguration.from(input);
}
