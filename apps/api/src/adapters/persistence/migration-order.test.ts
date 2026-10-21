import { describe, expect, it } from "vitest";
import { RepositoryError } from "../../application/persistence.js";
import { runMigrations, type LoadedMigration } from "./migrations.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

type LedgerRow = SqlRow & {
  readonly version: string;
  readonly checksum_sha256: string;
};

const migrations: readonly LoadedMigration[] = ["0093", "0094", "0095"].map(
  (version, index) => ({
    version,
    file: `${version}_order_test.sql`,
    checksumSha256: String(index + 1).repeat(64),
    statements: [`CREATE TABLE order_test_${version} (id INTEGER PRIMARY KEY)`],
  }),
);
function migrationAt(index: number): LoadedMigration {
  const migration = migrations[index];
  if (!migration) throw new Error("Missing test migration");
  return migration;
}
const row = (index: number): LedgerRow => ({
  version: migrationAt(index).version,
  checksum_sha256: migrationAt(index).checksumSha256,
});

function databaseHarness(
  initial: readonly LedgerRow[],
  options: {
    readonly concurrentSuccessor?: LedgerRow;
    readonly failFirstUpgrade?: boolean;
  } = {},
) {
  const ledger = new Map(initial.map((entry) => [entry.version, entry]));
  const executed: string[] = [];
  const trace: string[] = [];
  let successor = options.concurrentSuccessor;
  let failUpgrade = options.failFirstUpgrade === true;
  let rollbacks = 0;

  function execute(
    statement: SqlStatement,
    state: Map<string, LedgerRow>,
  ): SqlResult {
    trace.push(statement.text);
    const text = statement.text.trim().replace(/\s+/gu, " ");
    if (text.includes("pg_advisory_xact_lock")) {
      if (successor) {
        state.set(successor.version, successor);
        ledger.set(successor.version, successor);
        successor = undefined;
      }
      return { rowCount: 1, rows: [{ pg_advisory_xact_lock: "" }] };
    }
    if (text.startsWith("SELECT version, checksum_sha256")) {
      const version = String(statement.values[0]);
      const rows = [...state.values()].filter((entry) =>
        text.includes("WHERE version >")
          ? entry.version > version
          : text.includes("WHERE version =")
            ? entry.version === version
            : true,
      );
      return { rowCount: rows.length, rows };
    }
    if (text.startsWith("INSERT INTO cloudmarkup_schema_migrations")) {
      const version = String(statement.values[0]);
      state.set(version, {
        version,
        checksum_sha256: String(statement.values[1]),
      });
    } else if (text.startsWith("CREATE TABLE order_test_")) {
      executed.push(statement.text);
      if (failUpgrade && statement.text === migrationAt(1).statements[0]) {
        failUpgrade = false;
        throw new Error("Simulated migration statement failure");
      }
    } else if (!text.startsWith("CREATE TABLE IF NOT EXISTS")) {
      throw new Error("Unexpected migration query");
    }
    return { rowCount: 0, rows: [] };
  }

  const database: SqlDatabase = {
    close: () => Promise.resolve(),
    query<TRow extends SqlRow>(statement: SqlStatement) {
      return Promise.resolve(execute(statement, ledger) as SqlResult<TRow>);
    },
    async transaction<TResult>(
      work: (transaction: SqlExecutor) => Promise<TResult>,
    ): Promise<TResult> {
      const staged = new Map(ledger);
      const transaction: SqlExecutor = {
        query<TRow extends SqlRow>(statement: SqlStatement) {
          return Promise.resolve(execute(statement, staged) as SqlResult<TRow>);
        },
      };
      try {
        const result = await work(transaction);
        ledger.clear();
        for (const [version, entry] of staged) ledger.set(version, entry);
        return result;
      } catch (error) {
        rollbacks += 1;
        throw error;
      }
    },
  };
  return { database, ledger, executed, trace, rollbacks: () => rollbacks };
}

describe("migration order under the database lock", () => {
  it("upgrades 0093 through 0094 and 0095 and replays without rerunning SQL", async () => {
    const harness = databaseHarness([row(0)]);
    await runMigrations(harness.database, migrations);
    await runMigrations(harness.database, migrations);
    expect([...harness.ledger.values()]).toEqual([row(0), row(1), row(2)]);
    expect(harness.executed).toEqual([
      migrationAt(1).statements[0],
      migrationAt(2).statements[0],
    ]);
    expect(harness.rollbacks()).toBe(0);
  });

  it("rejects an older missing migration before executing its SQL", async () => {
    const harness = databaseHarness([row(0), row(2)]);
    await expect(
      runMigrations(harness.database, migrations),
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(harness.executed).toEqual([]);
    expect([...harness.ledger.values()]).toEqual([row(0), row(2)]);
    expect(harness.rollbacks()).toBe(1);
    expect(
      harness.trace.findIndex((sql) => sql.includes("pg_advisory_xact_lock")),
    ).toBeLessThan(
      harness.trace.findIndex((sql) => sql.includes("WHERE version >")),
    );
  });

  it("detects a successor committed after the initial ledger read", async () => {
    const harness = databaseHarness([row(0)], { concurrentSuccessor: row(2) });
    await expect(
      runMigrations(harness.database, migrations),
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(harness.executed).toEqual([]);
    expect(harness.ledger.has("0094")).toBe(false);
    expect(harness.ledger.get("0095")).toEqual(row(2));
  });

  it("retains checksum rejection before beginning an upgrade", async () => {
    const harness = databaseHarness([
      { ...row(0), checksum_sha256: "f".repeat(64) },
    ]);
    await expect(
      runMigrations(harness.database, migrations),
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(harness.executed).toEqual([]);
    expect(
      harness.trace.some((sql) => sql.includes("pg_advisory_xact_lock")),
    ).toBe(false);
  });

  it("retains rejection of an unknown applied migration", async () => {
    const harness = databaseHarness([
      { version: "0096", checksum_sha256: "f".repeat(64) },
    ]);
    await expect(
      runMigrations(harness.database, migrations),
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(harness.executed).toEqual([]);
  });

  it("allows retry after a failed statement rolls back its migration", async () => {
    const harness = databaseHarness([row(0)], { failFirstUpgrade: true });
    await expect(runMigrations(harness.database, migrations)).rejects.toThrow(
      "Simulated migration statement failure",
    );
    expect([...harness.ledger.values()]).toEqual([row(0)]);
    await runMigrations(harness.database, migrations);
    expect([...harness.ledger.values()]).toEqual([row(0), row(1), row(2)]);
    expect(harness.rollbacks()).toBe(1);
  });
});
