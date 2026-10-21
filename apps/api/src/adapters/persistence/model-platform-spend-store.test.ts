import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { ModelPlatformSpendError } from "../model-platform-spend.js";
import { PostgresModelPlatformSpendStore } from "./model-platform-spend-store.js";
import { platformSpendReservation } from "./model-platform-spend-test-helpers.js";
import { loadMigrations } from "./migrations.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

function statementDatabase(responses: SqlResult[]): {
  database: SqlDatabase;
  statements: SqlStatement[];
} {
  const statements: SqlStatement[] = [];
  const database: SqlDatabase = {
    close: () => Promise.resolve(),
    transaction: <T>(work: (tx: SqlExecutor) => Promise<T>) => work(database),
    query: <T extends SqlRow>(statement: SqlStatement) => {
      statements.push(statement);
      const result = responses.shift();
      if (result === undefined)
        return Promise.reject(new Error("Unexpected synthetic statement"));
      return Promise.resolve(result as SqlResult<T>);
    },
  };
  return { database, statements };
}

describe("platform spend SQL and metadata boundaries (statement doubles, not PostgreSQL)", () => {
  it("rejects changed tenant scope and unknown pricing before SQL", async () => {
    const f = platformSpendReservation();
    const { database, statements } = statementDatabase([]);
    const store = new PostgresModelPlatformSpendStore({
      database,
      scope: f.scope,
    });
    await expect(
      store.reserve({
        ...f,
        scope: {
          ...f.scope,
          projectId: "other-project",
        },
      }),
    ).rejects.toBeInstanceOf(ModelPlatformSpendError);
    await expect(
      store.reserve({
        ...f,
        ceiling: { ...f.ceiling, maximumCostMicroUsd: 0 },
      }),
    ).rejects.toBeInstanceOf(ModelPlatformSpendError);
    expect(statements).toEqual([]);
  });
  it("fences exact duplicate claims without returning dispatch permission", async () => {
    const f = platformSpendReservation();
    const { database, statements } = statementDatabase([
      { rowCount: 1, rows: [{}] },
      {
        rowCount: 1,
        rows: [{ claim_sha256: digestStructuredValue(f).slice(7) }],
      },
    ]);
    const store = new PostgresModelPlatformSpendStore({
      database,
      scope: f.scope,
    });
    await expect(store.reserve(f)).resolves.toEqual({ kind: "duplicate" });
    expect(statements[0]?.text).toContain("pg_advisory_xact_lock");
    expect(statements[0]?.values).toEqual([]);
    expect(statements[1]?.values).toEqual([f.dispatchId]);
    expect(statements[1]?.text).not.toContain(f.dispatchId);
  });
  it("rejects the global sum before insert, without a tenant-filtered allowance", async () => {
    const f = platformSpendReservation(undefined, 2_000_000);
    const { database, statements } = statementDatabase([
      { rowCount: 1, rows: [{}] },
      { rowCount: 0, rows: [] },
      {
        rowCount: 1,
        rows: [
          { month_utc: "2026-09", trusted_now: "2026-09-05T12:00:00.000Z" },
        ],
      },
      { rowCount: 1, rows: [{ reserved_micro_usd: "49000000" }] },
    ]);
    const store = new PostgresModelPlatformSpendStore({
      database,
      scope: f.scope,
    });
    await expect(store.reserve(f)).rejects.toMatchObject({
      code: "model-platform.cap-exceeded",
    });
    expect(statements[2]?.text).toContain("clock_timestamp()");
    expect(statements[3]?.values).toEqual(["2026-09"]);
    expect(statements[3]?.text).not.toContain("organization_id");
    expect(statements.some(({ text }) => text.startsWith("INSERT"))).toBe(
      false,
    );
  });
  it("does not leak database/provider diagnostics", async () => {
    const f = platformSpendReservation();
    const { database } = statementDatabase([]);
    const query = vi
      .spyOn(database, "query")
      .mockRejectedValue(new Error("Synthetic private SQL details"));
    const store = new PostgresModelPlatformSpendStore({
      database,
      scope: f.scope,
    });
    await expect(store.reserve(f)).rejects.toThrow(
      "Model assistance is unavailable under the platform spending controls.",
    );
    expect(query).toHaveBeenCalledOnce();
  });
  it("loads the pinned additive cap migration without inventing a credit ledger", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    const budget = migrations.find(({ version }) => version === "0020");
    expect(budget?.statements).toHaveLength(6);
    const source = budget?.statements.join("\n") ?? "";
    expect(source).toContain("50000000");
    expect(source).toContain("NEW.reserved_at := clock_timestamp()");
    expect(source).toContain("BEFORE UPDATE OR DELETE");
    expect(source).toContain(
      "hashtextextended('cloudmarkup:model-platform-monthly-usd:v1',0)",
    );
    expect(source).not.toContain("CREATE TABLE credit");
  });
});
