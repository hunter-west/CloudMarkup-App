import { describe, expect, it, vi } from "vitest";
import { createLocalRuntimeDatabase } from "./local-installation.js";
import {
  assertOrdinaryRuntimeBinding,
  OrdinaryRuntimeDatabase,
  type OrdinaryRuntimeHost,
} from "./ordinary-runtime-database.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

function identity(host: OrdinaryRuntimeHost): SqlRow {
  const login = "cloudmarkup_beta_" + host + "_runtime";
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
function fixture(
  host: OrdinaryRuntimeHost = "api",
  rows = [identity(host)],
  beforeIdentityCheck?: (check: number) => Promise<void>,
) {
  const statements: SqlStatement[] = [];
  const events: string[] = [];
  let checks = 0;
  const tx: SqlExecutor = {
    query<TRow extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      statements.push(statement);
      if (statement.text.includes("AS effective_role")) {
        checks += 1;
        const selected = rows[Math.min(checks - 1, rows.length - 1)];
        const result: SqlResult<TRow> = {
          rowCount: selected === undefined ? 0 : 1,
          rows: (selected === undefined ? [] : [selected]) as TRow[],
        };
        return beforeIdentityCheck === undefined
          ? Promise.resolve(result)
          : beforeIdentityCheck(checks).then(() => result);
      }
      return Promise.resolve({
        rowCount: 1,
        rows: [{ value: "ok" }] as unknown as TRow[],
      });
    },
  };
  const directQuery = vi.fn(() => {
    throw Error("Standalone delegate access is forbidden.");
  });
  const close = vi.fn(() => Promise.resolve());
  const database: SqlDatabase = {
    query: directQuery,
    close,
    transaction: async (work) => {
      events.push("begin");
      try {
        const result = await work(tx);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    },
  };
  return {
    database,
    directQuery,
    close,
    guarded:
      host === "api"
        ? createLocalRuntimeDatabase(
            "postgresql://synthetic-local-target",
            () => database,
          )
        : new OrdinaryRuntimeDatabase(database, host),
    statements,
    events,
  };
}
describe("ordinary runtime database isolation", () => {
  it.each(["api", "proposal", "export", "cleanup", "billing"] as const)(
    "checks the fixed %s identity around work in the same transaction",
    async (host) => {
      const f = fixture(host);
      await expect(
        f.guarded.query(
          sql("SELECT tenant_value WHERE tenant_id=$1", ["org_a"]),
        ),
      ).resolves.toMatchObject({ rows: [{ value: "ok" }] });
      expect(f.events).toEqual(["begin", "commit"]);
      expect(f.directQuery).not.toHaveBeenCalled();
      expect(f.statements.map((s) => s.text)).toEqual([
        expect.stringContaining("AS effective_role"),
        "SET LOCAL search_path TO pg_catalog, public, pg_temp",
        "SET LOCAL row_security TO on",
        "SELECT tenant_value WHERE tenant_id=$1",
        expect.stringContaining("AS effective_role"),
      ]);
      expect(f.statements[3]?.values).toEqual(["org_a"]);
      expect(
        f.statements.some((s) => /SET(?: LOCAL)? ROLE/u.test(s.text)),
      ).toBe(false);
    },
  );
  it.each([
    ["login", "cloudmarkup_admin"],
    ["effective_role", "cloudmarkup_admin"],
    ["login", "cloudmarkup_beta_billing_runtime"],
    ["database_name", "other"],
    ["can_login", false],
    ["superuser", true],
    ["create_database", true],
    ["create_role", true],
    ["inherits", true],
    ["replication", true],
    ["bypass_rls", true],
    ["has_membership", true],
    ["owns_object", true],
    ["can_create", true],
    ["replication_role", "replica"],
    ["replication_role", "local"],
    ["replication_role", null],
    ["can_bypass_triggers", true],
    ["can_bypass_triggers", null],
    ["can_bypass_triggers", "false"],
    ["owns_object", null],
    ["has_membership", "false"],
  ])("denies invalid %s before repository work", async (key, value) => {
    const row = { ...identity("api"), [key]: value };
    const f = fixture("api", [row]);
    const work = vi.fn(() => Promise.resolve());
    await expect(f.guarded.transaction(work)).rejects.toThrow(
      "identity is unavailable",
    );
    expect(work).not.toHaveBeenCalled();
    expect(f.events).toEqual(["begin", "rollback"]);
    expect(f.statements).toHaveLength(1);
  });
  it.each(["replication_role", "can_bypass_triggers"])(
    "denies absent %s metadata before work",
    async (key) => {
      const row = Object.fromEntries(
        Object.entries(identity("api")).filter(([field]) => field !== key),
      );
      const f = fixture("api", [row]);
      const work = vi.fn(() => Promise.resolve());
      await expect(f.guarded.transaction(work)).rejects.toThrow(
        "identity is unavailable",
      );
      expect(work).not.toHaveBeenCalled();
      expect(f.events).toEqual(["begin", "rollback"]);
      expect(f.statements).toHaveLength(1);
    },
  );
  it.each([
    ["replication_role", "replica"],
    ["can_bypass_triggers", true],
  ])(
    "rolls back post-work trigger admission drift in %s",
    async (key, value) => {
      const f = fixture("api", [
        identity("api"),
        { ...identity("api"), [key]: value },
      ]);
      const work = vi.fn((tx: SqlExecutor) => tx.query(sql("INSERT safe_row")));
      await expect(f.guarded.transaction(work)).rejects.toThrow(
        "identity is unavailable",
      );
      expect(work).toHaveBeenCalledOnce();
      expect(f.events).toEqual(["begin", "rollback"]);
      expect(
        f.statements.some((statement) => statement.text === "INSERT safe_row"),
      ).toBe(true);
    },
  );
  it("denies missing metadata and rolls back post-work identity drift", async () => {
    const missing = fixture("api", []);
    await expect(missing.guarded.query(sql("SELECT 1"))).rejects.toThrow();
    const changed = fixture("api", [
      identity("api"),
      { ...identity("api"), owns_object: true },
    ]);
    await expect(
      changed.guarded.transaction((tx) => tx.query(sql("INSERT safe_row"))),
    ).rejects.toThrow();
    expect(changed.events).toEqual(["begin", "rollback"]);
  });
  it("does not cache identity admission and expires escaped transaction executors", async () => {
    const f = fixture();
    let escaped: SqlExecutor | undefined;
    await f.guarded.transaction((tx) => {
      escaped = tx;
      return Promise.resolve();
    });
    expect(() => escaped?.query(sql("SELECT escaped"))).toThrow();
    await f.guarded.query(sql("SELECT again"));
    expect(
      f.statements.filter((s) => s.text.includes("AS effective_role")),
    ).toHaveLength(4);
    await f.guarded.close();
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("expires the callback executor before the deferred final identity check settles", async () => {
    let enterFinal: (() => void) | undefined;
    let releaseFinal: (() => void) | undefined;
    const finalEntered = new Promise<void>((resolve) => {
      enterFinal = resolve;
    });
    const finalPending = new Promise<void>((resolve) => {
      releaseFinal = resolve;
    });
    const f = fixture("api", [identity("api")], (check) => {
      if (check !== 2) return Promise.resolve();
      enterFinal?.();
      return finalPending;
    });
    let escaped: SqlExecutor | undefined;
    const work = f.guarded.transaction((tx) => {
      escaped = tx;
      return Promise.resolve("callback-complete");
    });
    await finalEntered;
    const statementsBeforeEscape = f.statements.length;
    try {
      expect(() =>
        escaped?.query(sql("SELECT escaped_during_final_check")),
      ).toThrow("identity is unavailable");
      expect(f.statements).toHaveLength(statementsBeforeEscape);
      expect(f.events).toEqual(["begin"]);
    } finally {
      releaseFinal?.();
    }
    await expect(work).resolves.toBe("callback-complete");
    expect(f.events).toEqual(["begin", "commit"]);
  });

  it("preserves the original repository error and rollback", async () => {
    const f = fixture();
    const failure = Error("repository failure");
    await expect(
      f.guarded.transaction(() => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(f.events).toEqual(["begin", "rollback"]);
  });
});

describe("fixed ordinary credential references", () => {
  const binding = {
    database: "cloudmarkup",
    resourceArn:
      "arn:aws:rds:us-east-1:123456789012:cluster:cloudmarkup-beta-postgresql",
    secretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:cloudmarkup-beta/database/runtime/api-ABC123",
  };
  it.each(["api", "proposal", "export", "cleanup", "billing"] as const)(
    "accepts only the resolved %s secret stem",
    (host) => {
      expect(() => {
        assertOrdinaryRuntimeBinding({
          ...binding,
          host,
          secretArn: binding.secretArn.replace(
            "runtime/api-",
            "runtime/" + host + "-",
          ),
        });
      }).not.toThrow();
    },
  );
  it.each([
    binding.secretArn.replace("runtime/api-", "admin-"),
    binding.secretArn.replace("runtime/api-", "runtime/billing-"),
    binding.secretArn.replace("runtime/api-", "private/notes-producer-"),
    binding.secretArn.replace("123456789012", "999999999999"),
    binding.secretArn.replace("us-east-1", "eu-west-1"),
    binding.secretArn + "-extra",
    binding.secretArn.slice(0, -1),
  ])(
    "rejects admin, private, cross-host and malformed references",
    (secretArn) => {
      expect(() => {
        assertOrdinaryRuntimeBinding({ ...binding, host: "api", secretArn });
      }).toThrow();
    },
  );
  it("rejects another database or cluster", () => {
    expect(() => {
      assertOrdinaryRuntimeBinding({
        ...binding,
        host: "api",
        database: "other",
      });
    }).toThrow();
    expect(() => {
      assertOrdinaryRuntimeBinding({
        ...binding,
        host: "api",
        resourceArn: binding.resourceArn + "-other",
      });
    }).toThrow();
  });
});
