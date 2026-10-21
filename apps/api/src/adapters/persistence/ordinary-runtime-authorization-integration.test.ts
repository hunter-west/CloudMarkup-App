import { describe, expect, it } from "vitest";
import {
  OrdinaryRuntimeDatabase,
  type OrdinaryRuntimeHost,
} from "./ordinary-runtime-database.js";
import {
  ordinaryAuthorizationLocks,
  ordinaryAuthorizationReceiptColumn as marker,
} from "./ordinary-runtime-authorization-locks.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const membership = (() => {
  const entry = ordinaryAuthorizationLocks.find(
    (candidate) => candidate.inventoryId === 21,
  );
  if (entry === undefined) throw new Error("Missing membership operation");
  return entry;
})();
const values = ["membership_test", "principal_test", "organization_test"];

function fixture(
  host: OrdinaryRuntimeHost = "api",
  observed = "membership_test",
) {
  const statements: SqlStatement[] = [];
  const events: string[] = [];
  const raw: SqlExecutor = {
    query<TRow extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      statements.push(statement);
      let rows: SqlRow[];
      let columnNames: string[] | undefined;
      if (statement.text.includes("AS effective_role")) {
        const login = "cloudmarkup_beta_" + host + "_runtime";
        rows = [
          {
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
          },
        ];
      } else if (statement.text.startsWith("SET LOCAL")) {
        rows = [];
      } else if (statement.text.includes("SELECT locked_keys_json")) {
        rows = [{ locked_keys_json: JSON.stringify(["membership_test"]) }];
        columnNames = ["locked_keys_json"];
      } else if (statement.text === membership.reread) {
        rows = [
          {
            membership_id: "membership_test",
            role_key: "editor",
            [marker]: observed,
          },
        ];
        columnNames = ["membership_id", "role_key", marker];
      } else {
        throw new Error("Unexpected raw statement");
      }
      return Promise.resolve({
        rowCount: rows.length,
        rows: rows as TRow[],
        ...(columnNames === undefined ? {} : { columnNames }),
      });
    },
  };
  const database: SqlDatabase = {
    query: () => {
      throw new Error("Standalone raw access forbidden");
    },
    close: () => Promise.resolve(),
    transaction: async (work) => {
      events.push("begin");
      try {
        const result = await work(raw);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    },
  };
  return {
    guarded: new OrdinaryRuntimeDatabase(database, host),
    statements,
    events,
  };
}

describe("ordinary authorization central integration", () => {
  it("uses the same admitted transaction and strips its internal receipt before returning business fields", async () => {
    const f = fixture();
    let escaped: SqlExecutor | undefined;
    const result = await f.guarded.transaction((tx) => {
      escaped = tx;
      return tx.query(sql(membership.statement, values));
    });
    expect(result).toEqual({
      rowCount: 1,
      rows: [{ membership_id: "membership_test", role_key: "editor" }],
      columnNames: ["membership_id", "role_key"],
    });
    expect(f.events).toEqual(["begin", "commit"]);
    expect(f.statements[3]?.values).toEqual([
      "principal_test",
      "organization_test",
    ]);
    expect(f.statements[4]?.text).toBe(membership.reread);
    expect(f.statements[4]?.values).toEqual(values);
    expect(
      f.statements.filter((statement) =>
        statement.text.includes("AS effective_role"),
      ),
    ).toHaveLength(2);
    const count = f.statements.length;
    expect(() => escaped?.query(sql(membership.statement, values))).toThrow(
      "identity is unavailable",
    );
    expect(f.statements).toHaveLength(count);
  });

  it("refuses a host outside the fixed authorization binding before any helper or reread", async () => {
    const f = fixture("billing");
    await expect(
      f.guarded.query(sql(membership.statement, values)),
    ).rejects.toThrow("authorization lock is unavailable");
    expect(f.events).toEqual(["begin", "rollback"]);
    expect(f.statements).toHaveLength(3);
    expect(
      f.statements.some((statement) =>
        statement.text.includes("locked_keys_json"),
      ),
    ).toBe(false);
  });

  it("rolls back a changed fresh receipt through the central adapter", async () => {
    const f = fixture("api", "membership_replaced");
    await expect(
      f.guarded.query(sql(membership.statement, values)),
    ).rejects.toThrow("authorization lock is unavailable");
    expect(f.events).toEqual(["begin", "rollback"]);
    expect(f.statements[4]?.text).toBe(membership.reread);
    expect(
      f.statements.filter((statement) =>
        statement.text.includes("AS effective_role"),
      ),
    ).toHaveLength(1);
  });
});
