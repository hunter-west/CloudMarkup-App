import { describe, expect, it, vi } from "vitest";
import {
  loadSelfHostMigrationProfile,
  type SelfHostMigrationProfile,
} from "../../self-host/migration-profile.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlStatement,
} from "./sql.js";
import {
  parseLocalPersistenceConfiguration,
  runLocalPersistenceCommand,
  seedContributorSql,
} from "./local-installation.js";

const environment = {
  CLOUDMARKUP_RUNTIME_ENVIRONMENT: "local",
  CLOUDMARKUP_LOCAL_MIGRATION_PROFILE: "cloudmarkup-standalone-pg17-v1",
  CLOUDMARKUP_DATABASE_URL:
    "postgresql://cloudmarkup_beta_api_runtime:synthetic-runtime-password@127.0.0.1:55432/cloudmarkup",
  CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL:
    "postgresql://cloudmarkup_admin:synthetic-migrator-password@127.0.0.1:55432/cloudmarkup",
  CLOUDMARKUP_FILESYSTEM_OBJECT_ROOT: "/synthetic/objects",
};
function database() {
  const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const pool = {
    query: vi.fn(),
    transaction: vi.fn(),
    close,
  } as unknown as SqlDatabase;
  return { pool, close };
}
describe("standalone-profile contributor persistence", () => {
  it("requires explicit local profile, separate purpose logins and one loopback target", () => {
    expect(parseLocalPersistenceConfiguration(environment).runtimeUrl).toBe(
      environment.CLOUDMARKUP_DATABASE_URL,
    );
    for (const invalid of [
      { ...environment, NODE_ENV: "production" },
      { ...environment, CLOUDMARKUP_LOCAL_MIGRATION_PROFILE: "hosted" },
      {
        ...environment,
        CLOUDMARKUP_DATABASE_URL:
          environment.CLOUDMARKUP_DATABASE_URL + "?host=remote.example.test",
      },
      {
        ...environment,
        CLOUDMARKUP_DATABASE_URL:
          environment.CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL,
      },
      {
        ...environment,
        CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL:
          environment.CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL.replace(
            ":55432/",
            ":55433/",
          ),
      },
    ])
      expect(() => parseLocalPersistenceConfiguration(invalid)).toThrow();
  });
  it("migrate and seed reuse the exact PG17 profile; only ordinary publication uses the runtime pool", async () => {
    const profile = await loadSelfHostMigrationProfile();
    const migrator = database(),
      runtime = database();
    const configuration = parseLocalPersistenceConfiguration(environment);
    const events: string[] = [];
    const dependencies = {
      createDatabase: vi.fn((url: string) =>
        url === configuration.migratorUrl ? migrator.pool : runtime.pool,
      ),
      loadProfile: vi.fn().mockResolvedValue(profile),
      applyProfile: vi.fn(
        (pool: SqlDatabase, selected: SelfHostMigrationProfile) => {
          expect(pool).toBe(migrator.pool);
          expect(selected).toBe(profile);
          events.push("profile");
          return Promise.resolve();
        },
      ),
      assertProfile: vi.fn(
        (pool: SqlDatabase, selected: SelfHostMigrationProfile) => {
          expect(pool).toBe(runtime.pool);
          expect(selected).toBe(profile);
          events.push("runtime-check");
          return Promise.resolve();
        },
      ),
      seedSql: vi.fn((pool: SqlDatabase) => {
        expect(pool).toBe(migrator.pool);
        events.push("relational");
        return Promise.resolve();
      }),
      seedProjects: vi.fn((pool: SqlDatabase) => {
        expect(pool).toBe(runtime.pool);
        events.push("objects");
        return Promise.resolve([]);
      }),
    };
    await runLocalPersistenceCommand(
      "migrate",
      configuration,
      "/synthetic/api",
      dependencies,
    );
    await runLocalPersistenceCommand(
      "seed",
      configuration,
      "/synthetic/api",
      dependencies,
    );
    expect(events).toEqual([
      "profile",
      "profile",
      "relational",
      "runtime-check",
      "objects",
    ]);
    expect(migrator.close).toHaveBeenCalledTimes(2);
    expect(runtime.close).toHaveBeenCalledOnce();
  });
  it("failed profile or publication closes pools and cannot fall back to a canonical seed", async () => {
    const pool = database();
    const failure = new Error("profile unavailable");
    const configuration = parseLocalPersistenceConfiguration(environment);
    const dependencies = {
      createDatabase: vi.fn(() => pool.pool),
      loadProfile: loadSelfHostMigrationProfile,
      applyProfile: vi.fn().mockRejectedValue(failure),
      assertProfile: vi.fn(),
      seedSql: vi.fn(),
      seedProjects: vi.fn(),
    };
    await expect(
      runLocalPersistenceCommand(
        "seed",
        configuration,
        "/synthetic/api",
        dependencies,
      ),
    ).rejects.toThrow(failure);
    expect(dependencies.seedSql).not.toHaveBeenCalled();
    expect(dependencies.seedProjects).not.toHaveBeenCalled();
    expect(pool.close).toHaveBeenCalledOnce();
    dependencies.applyProfile.mockResolvedValue(undefined);
    dependencies.seedProjects.mockRejectedValue(
      new Error("publication unavailable"),
    );
    await expect(
      runLocalPersistenceCommand(
        "seed",
        configuration,
        "/synthetic/api",
        dependencies,
      ),
    ).rejects.toThrow("publication unavailable");
    expect(pool.close).toHaveBeenCalledTimes(3);
  });
  it("seed target admission refuses foreign identities and keeps allowed relational seed in the locked transaction", async () => {
    const seed = vi.fn(async (borrowed: SqlDatabase) => {
      await borrowed.transaction((tx) => {
        expect(tx).toBe(transaction);
        return Promise.resolve();
      });
    });
    const query = vi
      .fn<(statement: SqlStatement) => Promise<SqlResult>>()
      .mockResolvedValue({
        rowCount: 1,
        rows: [{ contributor_target: false }],
      });
    const transaction = { query } as unknown as SqlExecutor;
    const transactionMock = vi.fn((work: (tx: SqlExecutor) => Promise<void>) =>
      work(transaction),
    );
    const pool = { transaction: transactionMock } as unknown as SqlDatabase;
    await expect(
      seedContributorSql(pool, "synthetic.sql", seed),
    ).rejects.toThrow("non-fixture");
    expect(seed).not.toHaveBeenCalled();
    query.mockResolvedValue({
      rowCount: 1,
      rows: [{ contributor_target: true }],
    });
    await seedContributorSql(pool, "synthetic.sql", seed);
    expect(seed).toHaveBeenCalledOnce();
    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0].text).toContain("SHARE ROW EXCLUSIVE");
  });
});
