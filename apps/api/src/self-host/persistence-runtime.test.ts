import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PoolConfig } from "pg";

import {
  ObjectStoreError,
  RepositoryError,
  type AuthorizedOrganizationScope,
  type StoredObjectReference,
} from "../application/persistence.js";
import { DurableFilesystemObjectStore } from "../adapters/persistence/durable-filesystem-object-store.js";
import { PostgresStaffAccounts } from "../adapters/persistence/staff-accounts.js";
import { ApplicationError } from "../application/errors.js";
import type { OrdinaryRuntimeHost } from "../adapters/persistence/ordinary-runtime-database.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "../adapters/persistence/sql.js";
import { ORDINARY_PERSISTENCE_PURPOSES } from "./persistence-config.js";
import { createSelfHostPersistenceRuntime } from "./persistence-runtime.js";

const nativePools = vi.hoisted(() => ({
  entries: [] as {
    config: PoolConfig;
    end: ReturnType<typeof vi.fn>;
    listeners: (() => void)[];
  }[],
}));
vi.mock("pg", () => ({
  Pool: class SyntheticPool {
    readonly config: PoolConfig;
    readonly end = vi.fn(() => Promise.resolve());
    readonly listeners: (() => void)[] = [];
    constructor(config: PoolConfig) {
      this.config = config;
      nativePools.entries.push(this);
    }
    on(_event: string, listener: () => void) {
      this.listeners.push(listener);
      return this;
    }
    connect() {
      const purpose = ORDINARY_PERSISTENCE_PURPOSES.find(
        (candidate) =>
          this.config.user === `cloudmarkup_beta_${candidate}_runtime`,
      );
      if (purpose === undefined)
        return Promise.reject(Error("Invalid synthetic purpose"));
      return Promise.resolve({
        release: vi.fn(),
        query: (statement: string) =>
          Promise.resolve({
            rowCount: statement.includes("AS effective_role") ? 1 : 0,
            rows: statement.includes("AS effective_role")
              ? [identity(purpose)]
              : [],
          }),
      });
    }
  },
}));

const scope: AuthorizedOrganizationScope = {
  capabilities: ["projects.write"],
  correlationId: "synthetic_correlation",
  membershipId: "synthetic_membership",
  organizationId: "synthetic_org",
  principalId: "synthetic_principal",
  roleKey: "test-owner",
  sessionId: "synthetic_session",
};
const object: StoredObjectReference = {
  contentSha256: "b".repeat(64),
  entityTag: `"${"b".repeat(64)}"`,
  mediaType: "application/json",
  objectId: "synthetic_object",
  objectVersion: `sha256-${"b".repeat(64)}`,
  owner: {
    organizationId: scope.organizationId,
    projectId: "synthetic_project",
  },
  purpose: "architecture-draft",
  sizeBytes: 1,
  storageKey: "synthetic-key",
  storageProvider: "filesystem",
};
function configuration() {
  return {
    objectRoot: resolve(tmpdir(), "cm-runtime-synthetic"),
    readinessTimeoutMillis: 100,
    shutdownTimeoutMillis: 100,
    databases: Object.fromEntries(
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
              connectionTimeoutMillis: 100,
              idleTimeoutMillis: 100,
              statementTimeoutMillis: 100,
            },
          ] as const,
      ),
    ),
  };
}
function identity(purpose: OrdinaryRuntimeHost) {
  const login = `cloudmarkup_beta_${purpose}_runtime`;
  return {
    login,
    effective_role: login,
    database_name: "cloudmarkup",
    can_login: true,
    superuser: false,
    create_database: false,
    create_role: false,
    inherits: false,
    replication: false,
    bypass_rls: false,
    has_membership: false,
    owns_object: false,
    can_create: false,
    replication_role: "origin",
    can_bypass_triggers: false,
  };
}
class SyntheticStorage extends DurableFilesystemObjectStore {
  readonly initializeFixture = vi.fn(() => Promise.resolve());
  override initialize(): Promise<void> {
    return this.initializeFixture();
  }
}
function fixture() {
  const storage = new SyntheticStorage(configuration().objectRoot);
  const entries: {
    purpose: OrdinaryRuntimeHost;
    config: PoolConfig;
    database: SqlDatabase;
    close: ReturnType<typeof vi.fn<() => Promise<void>>>;
    statements: SqlStatement[];
    row: Record<string, unknown>;
    onUnavailable: () => void;
  }[] = [];
  const factory = (
    purpose: OrdinaryRuntimeHost,
    config: PoolConfig,
    onUnavailable: () => void,
  ): SqlDatabase => {
    const statements: SqlStatement[] = [];
    const row: Record<string, unknown> = identity(purpose);
    const close = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const tx: SqlExecutor = {
      query<TRow extends SqlRow>(
        statement: SqlStatement,
      ): Promise<SqlResult<TRow>> {
        statements.push(statement);
        if (statement.text.includes("AS effective_role"))
          return Promise.resolve({ rowCount: 1, rows: [row] as TRow[] });
        return Promise.resolve({ rowCount: 0, rows: [] });
      },
    };
    const database: SqlDatabase = {
      close,
      query: () => {
        throw Error("Raw database access is forbidden");
      },
      transaction: (work) => work(tx),
    };
    entries.push({
      purpose,
      config,
      database,
      close,
      statements,
      row,
      onUnavailable,
    });
    return database;
  };
  return {
    storage,
    entries,
    factory,
    factories: { database: factory, objectStore: () => storage },
  };
}
afterEach(() => {
  vi.useRealTimers();
  nativePools.entries.splice(0);
});

describe("five-purpose persistence runtime lifecycle", () => {
  it("refuses unavailable private phase and financial configuration before opening ordinary pools", async () => {
    for (const financial of [false, true]) {
      const f = fixture(),
        input = configuration();
      const selected = {
        ...input,
        phaseAdmission: "deletion-phase-v1",
        ...(financial
          ? {
              deletionFinancial: {
                ...input.databases["cleanup"],
                user: "cloudmarkup_deletion_financial_login",
                maxConnections: 1,
              },
            }
          : {}),
      };
      await expect(
        createSelfHostPersistenceRuntime(selected, f.factories),
      ).rejects.toThrow();
      expect(f.entries).toHaveLength(0);
    }
  });
  it("uses five production pg Pool construction paths with synthetic pools and idle error handlers", async () => {
    const storage = new SyntheticStorage(configuration().objectRoot);
    const runtime = await createSelfHostPersistenceRuntime(configuration(), {
      objectStore: () => storage,
    });
    expect(nativePools.entries).toHaveLength(5);
    expect(nativePools.entries.map((entry) => entry.config.user)).toEqual(
      ORDINARY_PERSISTENCE_PURPOSES.map(
        (purpose) => `cloudmarkup_beta_${purpose}_runtime`,
      ),
    );
    expect(new Set(nativePools.entries.map((entry) => entry.config)).size).toBe(
      5,
    );
    nativePools.entries[0]?.listeners[0]?.();
    expect(runtime.readiness().state).toBe("unavailable");
    await runtime.close();
    for (const entry of nativePools.entries)
      expect(entry.end).toHaveBeenCalledTimes(1);
  });
  it("checks each fixed purpose through the existing guard, and closes every owned pool once", async () => {
    const f = fixture();
    const runtime = await createSelfHostPersistenceRuntime(
      configuration(),
      f.factories,
    );
    expect(f.entries.map((entry) => entry.purpose)).toEqual(
      ORDINARY_PERSISTENCE_PURPOSES,
    );
    expect(new Set(f.entries.map((entry) => entry.database)).size).toBe(5);
    expect(new Set(Object.values(runtime.databases)).size).toBe(5);
    expect(runtime.readiness().state).toBe("ready");
    for (const entry of f.entries) {
      expect(entry.config.user).toBe(
        `cloudmarkup_beta_${entry.purpose}_runtime`,
      );
      expect(entry.statements.map((statement) => statement.text)).toEqual([
        expect.stringContaining("AS effective_role"),
        "SET LOCAL search_path TO pg_catalog, public, pg_temp",
        "SET LOCAL row_security TO on",
        expect.stringContaining("AS effective_role"),
      ]);
    }
    expect(JSON.stringify(runtime.readiness())).not.toContain("synthetic-only");
    expect(JSON.stringify(runtime)).not.toContain("synthetic-only");
    await Promise.all([
      runtime.close(),
      runtime.databases.api.close(),
      runtime.close(),
    ]);
    for (const entry of f.entries) expect(entry.close).toHaveBeenCalledTimes(1);
    expect(runtime.readiness().state).toBe("closed");
    await expect(
      runtime.databases.api.transaction(() => Promise.resolve()),
    ).rejects.toMatchObject({ code: "persistence-unavailable" });
    expect((await runtime.checkReadiness()).state).toBe("closed");
  });

  it("does not create lazy pools when configuration is incomplete", async () => {
    const f = fixture();
    await expect(
      createSelfHostPersistenceRuntime({}, f.factories),
    ).rejects.toMatchObject({ code: "invalid-persistence-configuration" });
    expect(f.entries).toHaveLength(0);
  });

  it("refuses aliasing a purpose handle and cleans it up exactly once", async () => {
    const f = fixture();
    const shared = f.factory("api", {}, () => {
      /* synthetic */
    });
    await expect(
      createSelfHostPersistenceRuntime(configuration(), {
        ...f.factories,
        database: () => shared,
      }),
    ).rejects.toMatchObject({ code: "persistence-unavailable" });
    expect(f.entries[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("closes earlier pools on a partial factory failure without leaking its error", async () => {
    const f = fixture();
    await expect(
      createSelfHostPersistenceRuntime(configuration(), {
        ...f.factories,
        database: (purpose, config, onUnavailable) => {
          if (purpose === "export")
            throw Error("synthetic-only-password in factory");
          return f.factory(purpose, config, onUnavailable);
        },
      }),
    ).rejects.toThrow("runtime is unavailable");
    expect(f.entries).toHaveLength(2);
    for (const entry of f.entries) expect(entry.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    "login",
    "database_name",
    "owns_object",
    "bypass_rls",
    "can_bypass_triggers",
  ])(
    "fails startup guard admission for invalid %s and closes all pools",
    async (field) => {
      const f = fixture();
      const starting = createSelfHostPersistenceRuntime(
        configuration(),
        f.factories,
      );
      const entry = f.entries.find((item) => item.purpose === "proposal");
      if (entry === undefined) throw Error("Missing synthetic proposal handle");
      entry.row[field] =
        field === "login" || field === "database_name"
          ? "synthetic_other"
          : true;
      await expect(starting).rejects.toMatchObject({
        code: "persistence-unavailable",
      });
      for (const created of f.entries)
        expect(created.close).toHaveBeenCalledTimes(1);
    },
  );

  it("invalidates readiness on idle errors and rechecks actual guarded identities", async () => {
    const f = fixture();
    const runtime = await createSelfHostPersistenceRuntime(
      configuration(),
      f.factories,
    );
    const entry = f.entries[0];
    if (entry === undefined) throw Error("Missing synthetic handle");
    entry.onUnavailable();
    expect(runtime.readiness().state).toBe("unavailable");
    expect((await runtime.checkReadiness()).state).toBe("ready");
    entry.row["effective_role"] = "synthetic_owner";
    expect((await runtime.checkReadiness()).state).toBe("unavailable");
    await runtime.close();
  });

  it("coalesces readiness checks and does not overwrite an idle error that arrives during a check", async () => {
    const f = fixture();
    const runtime = await createSelfHostPersistenceRuntime(
      configuration(),
      f.factories,
    );
    let finish: (() => void) | undefined;
    let enter: (() => void) | undefined;
    const entered = new Promise<void>((resolveWork) => {
      enter = resolveWork;
    });
    f.storage.initializeFixture.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          enter?.();
        }),
    );
    const first = runtime.checkReadiness();
    const second = runtime.checkReadiness();
    expect(first).toBe(second);
    await entered;
    f.entries[0]?.onUnavailable();
    if (finish === undefined)
      throw Error("Missing synthetic readiness continuation");
    finish();
    expect((await first).state).toBe("unavailable");
    expect((await runtime.checkReadiness()).state).toBe("ready");
    await runtime.close();
  });

  it("does not restore readiness when close occurs during an in-flight readiness check", async () => {
    const f = fixture();
    let holding = false;
    let enter: (() => void) | undefined;
    let finish: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const runtime = await createSelfHostPersistenceRuntime(configuration(), {
      ...f.factories,
      database: (purpose, config, onUnavailable) => {
        const database = f.factory(purpose, config, onUnavailable);
        return {
          ...database,
          transaction: <T>(work: (tx: SqlExecutor) => Promise<T>) =>
            database.transaction(async (tx) => {
              const result = await work(tx);
              if (holding && purpose === "api") {
                // The guarded transaction succeeds; delay its completion so
                // close happens after admission but before readiness settles.
                await new Promise<void>((resolve) => {
                  finish = resolve;
                  if (enter === undefined)
                    throw Error("Missing synthetic transaction entry");
                  enter();
                });
              }
              return result;
            }),
        };
      },
    });
    holding = true;
    const checking = runtime.checkReadiness();
    await held;
    await runtime.close();
    if (finish === undefined)
      throw Error("Missing synthetic readiness continuation");
    finish();
    expect((await checking).state).toBe("closed");
    expect(runtime.readiness().state).toBe("closed");
    for (const entry of f.entries) expect(entry.close).toHaveBeenCalledTimes(1);
  });

  it("preserves safe repository business errors while redacting driver failures", async () => {
    const f = fixture();
    const runtime = await createSelfHostPersistenceRuntime(
      configuration(),
      f.factories,
    );
    const business = new RepositoryError(
      "not-found",
      "The synthetic record is unavailable.",
    );
    await expect(
      runtime.databases.api.transaction(() => Promise.reject(business)),
    ).rejects.toBe(business);
    expect(runtime.readiness().state).toBe("ready");
    await expect(
      runtime.databases.api.transaction(() =>
        Promise.reject(Error("synthetic-only-password")),
      ),
    ).rejects.toThrow("runtime is unavailable");
    expect(runtime.readiness().state).toBe("unavailable");
    await runtime.close();
  });

  it("invalidates readiness on observed storage outages and preserves business errors", async () => {
    const f = fixture();
    const runtime = await createSelfHostPersistenceRuntime(
      configuration(),
      f.factories,
    );
    const business = new ObjectStoreError(
      "object-conflict",
      "The synthetic object conflicts.",
    );
    const head = vi.spyOn(f.storage, "head");
    head.mockRejectedValueOnce(business);
    await expect(runtime.objectStore.head(scope, object)).rejects.toBe(
      business,
    );
    expect(runtime.readiness().state).toBe("ready");
    const outage = new ObjectStoreError(
      "storage-unavailable",
      "The local object storage is unavailable.",
    );
    head.mockRejectedValueOnce(outage);
    await expect(runtime.objectStore.head(scope, object)).rejects.toBe(outage);
    expect(runtime.readiness().state).toBe("unavailable");
    expect((await runtime.checkReadiness()).state).toBe("ready");
    head.mockRejectedValueOnce(Error("synthetic-secret-root"));
    await expect(runtime.objectStore.head(scope, object)).rejects.toThrow(
      "The local object storage is unavailable.",
    );
    expect(runtime.readiness().state).toBe("unavailable");
    await runtime.close();
  });

  it("observes failures raised during streamed object consumption", async () => {
    const f = fixture();
    const runtime = await createSelfHostPersistenceRuntime(
      configuration(),
      f.factories,
    );
    vi.spyOn(f.storage, "open").mockResolvedValueOnce(
      (async function* () {
        yield new Uint8Array([1]);
        await Promise.resolve();
        throw new ObjectStoreError(
          "storage-unavailable",
          "The local object storage is unavailable.",
        );
      })(),
    );
    const consume = async () => {
      for await (const chunk of await runtime.objectStore.open(scope, object))
        expect(chunk).toEqual(new Uint8Array([1]));
    };
    await expect(consume()).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    expect(runtime.readiness().state).toBe("unavailable");
    await runtime.close();
  });

  it("quarantines owned object operations after close", async () => {
    const f = fixture();
    const runtime = await createSelfHostPersistenceRuntime(
      configuration(),
      f.factories,
    );
    const head = vi.spyOn(f.storage, "head");
    await runtime.close();
    await expect(runtime.objectStore.head(scope, object)).rejects.toMatchObject(
      { code: "storage-unavailable" },
    );
    expect(head).not.toHaveBeenCalled();
    expect(runtime.readiness().state).toBe("closed");
  });

  it("cleans up all pools when filesystem readiness fails", async () => {
    const f = fixture();
    f.storage.initializeFixture.mockRejectedValueOnce(
      Error("synthetic-secret-root"),
    );
    await expect(
      createSelfHostPersistenceRuntime(configuration(), f.factories),
    ).rejects.toThrow("runtime is unavailable");
    for (const entry of f.entries) expect(entry.close).toHaveBeenCalledTimes(1);
    if (process.platform === "win32") {
      // Unlike the interruption fixtures, this uses actual filesystem calls.
      // The durable format must refuse unsupported directory fsync, while the
      // existing local-development adapter retains its Windows contract.
      const temporaryRoot = resolve(tmpdir());
      const directory = await mkdtemp(
        resolve(temporaryRoot, "cloudmarkup-durable-refusal-"),
      );
      if (!directory.startsWith(`${temporaryRoot}${sep}`))
        throw Error("Invalid temporary storage fixture");
      try {
        await expect(
          new DurableFilesystemObjectStore(directory).initialize(),
        ).rejects.toThrow("The local object storage is unavailable.");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("bounds startup readiness and attempts all closes even when one rejects or hangs", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.storage.initializeFixture.mockImplementationOnce(
      () =>
        new Promise<void>(() => {
          /* interrupted fixture */
        }),
    );
    const starting = createSelfHostPersistenceRuntime(
      configuration(),
      f.factories,
    );
    const outcome = expect(starting).rejects.toThrow("runtime is unavailable");
    await vi.advanceTimersByTimeAsync(100);
    // A timed-out initialization remains admitted work; shutdown has its own
    // bound and attempts every pool close while that work remains pending.
    for (const entry of f.entries) expect(entry.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    await outcome;
    for (const entry of f.entries) expect(entry.close).toHaveBeenCalledTimes(1);

    const other = fixture();
    const runtime = await createSelfHostPersistenceRuntime(
      configuration(),
      other.factories,
    );
    other.entries[0]?.close.mockImplementationOnce(
      () =>
        new Promise<void>(() => {
          /* hung fixture */
        }),
    );
    other.entries[1]?.close.mockRejectedValueOnce(
      Error("synthetic-secret-close"),
    );
    const closed = expect(runtime.close()).rejects.toThrow(
      "runtime is unavailable",
    );
    await vi.advanceTimersByTimeAsync(100);
    await closed;
    expect(runtime.readiness().state).toBe("closed");
    for (const entry of other.entries)
      expect(entry.close).toHaveBeenCalledTimes(1);
  });

  it("routes statement work through the guard, without introducing readiness SQL probes", async () => {
    const f = fixture();
    const runtime = await createSelfHostPersistenceRuntime(
      configuration(),
      f.factories,
    );
    // Existing guard owns statement policy. This fixture statement matches the
    // ordinary guard's existing test sentinel and is not a runtime probe.
    await runtime.databases.api.query(
      sql("SELECT tenant_value WHERE tenant_id=$1", ["synthetic_org"]),
    );
    const statements = f.entries[0]?.statements ?? [];
    expect(
      statements.some((statement) => statement.values[0] === "synthetic_org"),
    ).toBe(true);
    // Opening the real account menu probes staff access. A local owner is not
    // a Cognito staff principal; that ordinary denial must not poison pools.
    await expect(
      new PostgresStaffAccounts(runtime.databases.api).access({
        principalId: "synthetic_local_owner",
        authenticationSource: "local-owner",
        authenticatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        sessionId: "a".repeat(64),
        correlationId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "authentication_required", status: 401 });
    expect(runtime.readiness().state).toBe("ready");
    await expect(
      runtime.databases.api.transaction(() => {
        throw new Error("Synthetic unknown transaction failure");
      }),
    ).rejects.toMatchObject({ code: "persistence-unavailable" });
    expect(runtime.readiness().state).toBe("unavailable");
    expect((await runtime.checkReadiness()).state).toBe("ready");
    await expect(
      runtime.databases.api.transaction(() => {
        throw new ApplicationError(
          "service_unavailable",
          "Synthetic infrastructure refusal",
        );
      }),
    ).rejects.toMatchObject({ code: "persistence-unavailable" });
    expect(runtime.readiness().state).toBe("unavailable");
    await runtime.close();
  });

  it("exposes only an observed cleanup capability and validates every scoped SQL reference through it", async () => {
    const f = fixture();
    const coverage = vi
      .spyOn(f.storage, "assertProjectReferenceCoverage")
      .mockResolvedValue();
    const runtime = await createSelfHostPersistenceRuntime(
      configuration(),
      f.factories,
    );
    const policy = runtime.projectContentStoragePolicy;
    if (policy === undefined)
      throw Error("Missing concrete cleanup capability");
    expect(policy.configurationSha256).toBe(f.storage.configurationSha256);
    expect(policy).not.toHaveProperty("objectStore");
    const binding = {
      organizationId: scope.organizationId,
      projectId: "synthetic_project",
      deletionRequestedAt: "2026-10-13T00:00:00.000Z",
      recordVersion: 2,
    };
    const row = {
      organization_id: scope.organizationId,
      project_id: binding.projectId,
      object_id: object.objectId,
      storage_provider: "filesystem",
      object_purpose: object.purpose,
      storage_key: object.storageKey,
      object_version: object.objectVersion,
      entity_tag: object.entityTag,
      content_sha256: object.contentSha256,
      size_bytes: "1",
      media_type: object.mediaType,
    };
    const statements: SqlStatement[] = [];
    const tx: SqlExecutor = {
      query<TRow extends SqlRow>(
        statement: SqlStatement,
      ): Promise<SqlResult<TRow>> {
        statements.push(statement);
        return Promise.resolve({
          rowCount: 1,
          rows: [row] as unknown as TRow[],
        });
      },
    };
    await policy.assertReferenceCoverage(tx, binding);
    expect(statements[0]?.values).toEqual([
      scope.organizationId,
      binding.projectId,
    ]);
    expect(coverage).toHaveBeenCalledWith(binding, [object]);
    row.size_bytes = "01";
    await expect(
      policy.assertReferenceCoverage(tx, binding),
    ).rejects.toMatchObject({ code: "storage-unavailable" });
    expect(coverage).toHaveBeenCalledTimes(1);
    expect(runtime.readiness().state).toBe("unavailable");
    await runtime.close();
    await expect(
      policy.assertReferenceCoverage(tx, binding),
    ).rejects.toMatchObject({ code: "storage-unavailable" });
  });

  it("drains an admitted erase call on close and withdraws its authority before an acknowledgement", async () => {
    const f = fixture();
    let release: (() => void) | undefined;
    const admitted = new Promise<void>((resolveWork) => {
      release = resolveWork;
    });
    let enter: (() => void) | undefined;
    const entered = new Promise<void>((resolveWork) => {
      enter = resolveWork;
    });
    vi.spyOn(f.storage, "eraseProjectPage").mockImplementation(
      async (_binding, authority) => {
        await authority();
        enter?.();
        await admitted;
        await authority();
        return { observedEmpty: true };
      },
    );
    const runtime = await createSelfHostPersistenceRuntime(
      configuration(),
      f.factories,
    );
    const policy = runtime.projectContentStoragePolicy;
    if (policy === undefined)
      throw Error("Missing concrete cleanup capability");
    const pending = policy.erasePage(
      {
        organizationId: scope.organizationId,
        projectId: "synthetic_project",
        deletionRequestedAt: "2026-10-13T00:00:00.000Z",
        recordVersion: 2,
      },
      () => Promise.resolve(),
    );
    const refused = expect(pending).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    await entered;
    let closed = false;
    const closing = runtime.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release?.();
    await refused;
    await closing;
    expect(closed).toBe(true);
    for (const entry of f.entries) expect(entry.close).toHaveBeenCalledTimes(1);
  });
});
