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

type Binding = (typeof ordinaryAuthorizationLocks)[number];
type Mode = "current" | "receipt-drift" | "identity-drift" | "denied-helper";

// This exercises the real central adapter and its authorization/private ingress.
// The synthetic executor is a transport fixture, not evidence of SQL permissions.
function fixture(
  binding: Binding,
  host: OrdinaryRuntimeHost = binding.hosts[0],
  mode: Mode = "current",
) {
  const statements: SqlStatement[] = [];
  const events: string[] = [];
  let identities = 0;
  let helpers = 0;
  const key = binding.inventoryId === 7 ? "fixed" : "locked_identity";
  const raw: SqlExecutor = {
    query<TRow extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      statements.push(statement);
      let rows: SqlRow[];
      let columnNames: string[] | undefined;
      if (statement.text.includes("AS effective_role")) {
        identities += 1;
        const login = "cloudmarkup_beta_" + host + "_runtime";
        rows = [
          {
            login,
            effective_role:
              mode === "identity-drift" && identities === 2
                ? "unexpected_role"
                : login,
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
      } else if (statement.text.startsWith("SELECT locked_keys_json")) {
        helpers += 1;
        if (mode === "denied-helper")
          return Promise.reject(new Error("Synthetic helper execution denied"));
        rows = [
          {
            locked_keys_json: JSON.stringify(
              binding.inventoryId === 7 &&
                helpers === 2 &&
                mode === "receipt-drift"
                ? []
                : [key],
            ),
          },
        ];
        columnNames = ["locked_keys_json"];
      } else if (statement.text === binding.reread) {
        rows = [
          {
            ordinary_value: "business_result",
            [marker]: mode === "receipt-drift" ? "changed_identity" : key,
          },
        ];
        columnNames = ["ordinary_value", marker];
      } else {
        throw new Error("Unexpected central raw statement");
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

function values(binding: Binding) {
  return Array.from(
    { length: binding.parameterCount },
    (_value, index) => `key_${String(index)}`,
  );
}
function privateBinding() {
  const binding = ordinaryAuthorizationLocks.find(
    (entry) => entry.inventoryId === 7,
  );
  if (binding === undefined) throw new Error("Missing private ACK binding");
  return binding;
}

describe("combined central authorization routing", () => {
  for (const binding of ordinaryAuthorizationLocks) {
    it(`routes pattern ${String(binding.inventoryId)} through the actual live admitted central transaction`, async () => {
      const f = fixture(binding);
      const parameters = values(binding);
      const result = await f.guarded.query(sql(binding.statement, parameters));
      expect(result).toEqual(
        binding.inventoryId === 7
          ? {
              rowCount: 1,
              rows: [{ "?column?": 1 }],
              columnNames: ["?column?"],
            }
          : {
              rowCount: 1,
              rows: [{ ordinary_value: "business_result" }],
              columnNames: ["ordinary_value"],
            },
      );
      expect(f.events).toEqual(["begin", "commit"]);
      expect(f.statements[3]?.values).toEqual(
        binding.helperArguments.map((argument) =>
          "literal" in argument
            ? argument.literal
            : parameters[argument.valueIndex],
        ),
      );
      expect(f.statements[4]?.text).toBe(binding.reread);
      expect(f.statements[4]?.values).toEqual(parameters);
      expect(
        f.statements.filter((statement) =>
          statement.text.includes("AS effective_role"),
        ),
      ).toHaveLength(2);
      expect(
        f.statements.some((statement) => statement.text === binding.statement),
      ).toBe(false);
    });
  }

  it.each(["receipt-drift", "identity-drift", "denied-helper"] as const)(
    "rolls back private ACK when the combined transaction observes %s",
    async (mode) => {
      const binding = privateBinding();
      const f = fixture(binding, "api", mode);
      await expect(
        f.guarded.query(sql(binding.statement, values(binding))),
      ).rejects.toThrow();
      expect(f.events).toEqual(["begin", "rollback"]);
      expect(
        f.statements.some((statement) =>
          /FROM (?:public\.)?model_commercial_workflows/iu.test(statement.text),
        ),
      ).toBe(false);
    },
  );

  it.each(["billing", "export", "cleanup", "proposal"] as const)(
    "refuses private ACK on %s before helper execution",
    async (host) => {
      const binding = privateBinding();
      const f = fixture(binding, host);
      await expect(
        f.guarded.query(sql(binding.statement, values(binding))),
      ).rejects.toThrow();
      expect(f.events).toEqual(["begin", "rollback"]);
      expect(
        f.statements.some((statement) =>
          statement.text.includes("locked_keys_json"),
        ),
      ).toBe(false);
    },
  );

  it("cannot reuse the private ACK executor after its central transaction ends", async () => {
    const binding = privateBinding();
    const f = fixture(binding);
    let escaped: SqlExecutor | undefined;
    await f.guarded.transaction((transaction) => {
      escaped = transaction;
      return transaction.query(sql(binding.statement, values(binding)));
    });
    const count = f.statements.length;
    expect(() =>
      escaped?.query(sql(binding.statement, values(binding))),
    ).toThrow("identity is unavailable");
    expect(f.statements).toHaveLength(count);
  });
});
