import { describe, expect, it } from "vitest";
import {
  executeOrdinaryRuntimeStatement,
  ordinaryFinancialLocks,
  ordinaryProjectLocks,
} from "./ordinary-runtime-locks.js";
import {
  sql,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

function executor(keys: unknown, rows: readonly SqlRow[], helperRows = 1) {
  const statements: SqlStatement[] = [];
  const tx: SqlExecutor = {
    query<T extends SqlRow>(statement: SqlStatement): Promise<SqlResult<T>> {
      statements.push(statement);
      return Promise.resolve(
        statement.text.includes("cloudmarkup_ordinary_private.")
          ? {
              rowCount: helperRows,
              rows:
                helperRows === 0
                  ? []
                  : ([{ locked_keys_json: keys }] as unknown as T[]),
            }
          : { rowCount: rows.length, rows: rows as T[] },
      );
    },
  };
  return { tx, statements };
}
describe("fixed ordinary database locks", () => {
  it.each([...ordinaryFinancialLocks, ...ordinaryProjectLocks])(
    "holds $name through the ordinary invoker read",
    async (entry) => {
      const rows: SqlRow[] =
        entry.identityColumn === null
          ? [{ status: "current" }]
          : [{ [entry.identityColumn]: "row.current" }];
      const keys = JSON.stringify(
        entry.identityColumn === null ? ["fixed"] : ["row.current"],
      );
      const f = executor(keys, rows);
      const values = Array.from(
        { length: entry.parameterCount },
        (_, index) => "scope." + String(index),
      );
      const result = await executeOrdinaryRuntimeStatement(
        f.tx,
        entry.hosts[0],
        sql(entry.statement, values),
      );
      expect(result.rows).toEqual(rows);
      expect(f.statements).toHaveLength(2);
      expect(f.statements[0]?.text).toContain("lock_" + entry.name);
      expect(f.statements[0]?.values).toEqual(values);
      expect(f.statements[1]?.values).toEqual(values);
      expect(f.statements[1]?.text).not.toMatch(/FOR (UPDATE|SHARE)/u);
      expect(f.statements[1]?.text.replace(/\s+/gu, " ").trim()).toContain(
        "WHERE",
      );
    },
  );
  it.each([
    ["[]", [{ credit_grant_id: "new" }]],
    ['["old"]', [{ credit_grant_id: "new" }]],
    ["invalid", []],
    ["{}", []],
    ["[1]", []],
    [null, []],
  ])("refuses malformed or changed lock evidence %s", async (keys, rows) => {
    const entry = ordinaryFinancialLocks[2];
    const f = executor(keys, rows as SqlRow[]);
    await expect(
      executeOrdinaryRuntimeStatement(
        f.tx,
        "billing",
        sql(entry.statement, Array(entry.parameterCount).fill("scope")),
      ),
    ).rejects.toMatchObject({ code: "persistence-unavailable" });
  });
  it("refuses missing helper evidence and a host without the selected method", async () => {
    const entry = ordinaryFinancialLocks[2];
    const statement = sql(
      entry.statement,
      Array(entry.parameterCount).fill("scope"),
    );
    const missing = executor("[]", [], 0);
    await expect(
      executeOrdinaryRuntimeStatement(missing.tx, "billing", statement),
    ).rejects.toThrow();
    const forbidden = executor("[]", []);
    await expect(
      executeOrdinaryRuntimeStatement(forbidden.tx, "proposal", statement),
    ).rejects.toThrow();
    expect(forbidden.statements).toEqual([]);
  });
  it("passes unrelated SQL unchanged and never routes arbitrary text to a helper", async () => {
    const f = executor("[]", [{ value: "ok" }]);
    const statement = sql("SELECT 1 AS value");
    await executeOrdinaryRuntimeStatement(f.tx, "api", statement);
    expect(f.statements).toEqual([statement]);
  });
  it("rejects parameter mismatch before acquiring a lock", async () => {
    const f = executor("[]", []);
    await expect(
      executeOrdinaryRuntimeStatement(
        f.tx,
        "billing",
        sql(ordinaryFinancialLocks[0].statement, []),
      ),
    ).rejects.toThrow();
    expect(f.statements).toEqual([]);
  });
});
