import { describe, expect, it, vi } from "vitest";
import { executeOrdinaryRuntimeStatement } from "./ordinary-runtime-locks.js";
import {
  ordinarySharedLockReads,
  ordinaryStaffReferenceLocks,
  ordinaryVersionedReferenceLocks,
} from "./ordinary-runtime-shared-locks.js";
import {
  sql,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

function executor(keys: string[], readRows: SqlRow[]) {
  const statements: SqlStatement[] = [];
  const query = vi.fn((statement: SqlStatement): Promise<SqlResult> => {
    statements.push(statement);
    const rows = statement.text.includes("locked_keys_json")
      ? [{ locked_keys_json: JSON.stringify(keys) }]
      : readRows;
    return Promise.resolve({
      rowCount: rows.length,
      rows,
    });
  });
  const tx: SqlExecutor = {
    async query<TRow extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      const result = await query(statement);
      return { ...result, rows: result.rows as readonly TRow[] };
    },
  };
  return { tx, query, statements };
}

describe("ordinary shared lock operations", () => {
  it("passes only the declared staff purpose and actor/account keys to the shared reference helper", async () => {
    const binding = ordinaryStaffReferenceLocks[1];
    const f = executor(
      ["subscription_test"],
      [{ subscription_projection_id: "subscription_test" }],
    );
    const statement = sql(binding.statement, ["org_test", "account_test"]);
    await executeOrdinaryRuntimeStatement(f.tx, "api", statement);
    expect(f.statements[0]?.values).toEqual([
      "staff-active-plan",
      "org_test",
      "account_test",
      null,
    ]);
    expect(f.statements[1]?.values).toEqual(statement.values);
    expect(f.statements[1]?.text).toContain("normalized_status='active'");
    expect(f.statements[1]?.text).toContain("billing_provider_cutovers");
  });

  it("rejects a replaced paid entitlement projection after waiting for its fixed lock", async () => {
    const binding = ordinaryStaffReferenceLocks[2];
    const f = executor(
      ["entitlement_locked"],
      [{ entitlement_snapshot_id: "entitlement_replaced" }],
    );
    await expect(
      executeOrdinaryRuntimeStatement(
        f.tx,
        "api",
        sql(binding.statement, ["org_test"]),
      ),
    ).rejects.toThrow();
    expect(f.statements[0]?.values).toEqual([
      "staff-paid-entitlement",
      "org_test",
      null,
      null,
    ]);
  });

  it("preserves absent staff trial subscription state without inventing authority", async () => {
    const binding = ordinaryStaffReferenceLocks[3];
    const f = executor([], []);
    await expect(
      executeOrdinaryRuntimeStatement(
        f.tx,
        "api",
        sql(binding.statement, ["org_test"]),
      ),
    ).resolves.toEqual({ rowCount: 0, rows: [] });
    expect(f.statements[0]?.values).toEqual([
      "staff-trial-state",
      "org_test",
      null,
      null,
    ]);
  });

  it("retains exact saved baseline tenant, current-pointer, version/hash and pending checks", async () => {
    const binding = ordinaryVersionedReferenceLocks[0];
    const f = executor(["draft_test"], [{ draft_id: "draft_test" }]);
    const values = ["org_test", "project_test", "draft_test", 7, "digest_test"];
    await executeOrdinaryRuntimeStatement(
      f.tx,
      "proposal",
      sql(binding.statement, values),
    );
    expect(f.statements[0]?.values).toEqual(values);
    expect(f.statements[1]?.text).toContain("d.draft_id=p.current_draft_id");
    expect(f.statements[1]?.text).toContain(
      "d.draft_version=$4 AND d.content_sha256=$5",
    );
    expect(f.statements[1]?.text).toContain(
      "d.pending_draft_version IS NULL AND d.pending_document_object_id IS NULL",
    );
    expect(f.statements[1]?.text).not.toContain("FOR SHARE");
  });
  it("maps adjustment replay arguments without changing its invoker SQL or values", async () => {
    const binding = ordinarySharedLockReads[2];
    const f = executor(
      ["ledger_expected"],
      [{ ledger_entry_id: "ledger_expected" }],
    );
    const statement = sql(binding.statement, [
      "org_test",
      "key_test",
      "ledger_expected",
    ]);
    await expect(
      executeOrdinaryRuntimeStatement(f.tx, "api", statement),
    ).resolves.toEqual({
      rowCount: 1,
      rows: [{ ledger_entry_id: "ledger_expected" }],
    });
    expect(f.statements[0]?.text).toBe(
      "SELECT locked_keys_json FROM cloudmarkup_ordinary_private.lock_ledger_replay($1::text,$2::text,$3::text)",
    );
    expect(f.statements[0]?.values).toEqual([
      "org_test",
      "ledger_expected",
      "key_test",
    ]);
    expect(f.statements[1]?.values).toEqual(statement.values);
    expect(f.statements[1]?.text).toContain(
      "(idempotency_key_sha256 = $2 OR ledger_entry_id = $3)",
    );
    expect(f.statements[1]?.text).not.toContain("FOR UPDATE");
  });

  it("retains both replay candidates and rejects a missing invoker identity", async () => {
    const binding = ordinarySharedLockReads[1];
    const f = executor(
      ["ledger_id", "ledger_key"],
      [{ ledger_entry_id: "ledger_id" }],
    );
    await expect(
      executeOrdinaryRuntimeStatement(
        f.tx,
        "proposal",
        sql(binding.statement, ["org_test", "ledger_id", "key_test"]),
      ),
    ).rejects.toThrow();
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it("refuses inactive project reread after the point helper captured a row", async () => {
    const binding = ordinarySharedLockReads[3];
    const f = executor(["fixed"], []);
    await expect(
      executeOrdinaryRuntimeStatement(
        f.tx,
        "export",
        sql(binding.statement, ["org_test", "project_test"]),
      ),
    ).rejects.toThrow();
    expect(f.statements[1]?.text).toContain(
      "organization_id=$1 AND project_id=$2 AND lifecycle_status='active'",
    );
  });

  it("accepts an initially absent account consistently and never invents business fields", async () => {
    const binding = ordinarySharedLockReads[0];
    const f = executor([], []);
    await expect(
      executeOrdinaryRuntimeStatement(
        f.tx,
        "proposal",
        sql(binding.statement, ["org_test"]),
      ),
    ).resolves.toEqual({ rowCount: 0, rows: [] });
    expect(f.statements[0]?.text).toContain("lock_billing_account");
    expect(f.statements[1]?.text.trim()).toBe(
      "SELECT billing_account_id FROM organization_billing_accounts WHERE organization_id=$1",
    );
  });

  it("rejects undeclared hosts and parameter arity before contacting a helper", async () => {
    const binding = ordinarySharedLockReads[2];
    const f = executor([], []);
    await expect(
      executeOrdinaryRuntimeStatement(
        f.tx,
        "billing",
        sql(binding.statement, ["org_test", "key_test", "ledger_expected"]),
      ),
    ).rejects.toThrow();
    await expect(
      executeOrdinaryRuntimeStatement(
        f.tx,
        "api",
        sql(binding.statement, ["org_test"]),
      ),
    ).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });
});
