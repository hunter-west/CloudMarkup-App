import { describe, expect, it, vi } from "vitest";
import {
  privatePreviewAckWorkflowPresenceRead as helperRead,
  privatePreviewAckWorkflowPresenceStatement as original,
  tryExecutePrivatePreviewAckWorkflowPresenceV1 as execute,
} from "./private-preview-ack-workflow-presence.js";
import {
  sql,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
  type SqlValue,
} from "./sql.js";

const values = ["org_a", "project_a", "principal_a", "workflow_a", "scope_a"];
function receipt(keys: unknown, nativeLabels = false): SqlResult {
  return {
    rowCount: 1,
    rows: [{ locked_keys_json: JSON.stringify(keys) }],
    ...(nativeLabels ? { columnNames: ["locked_keys_json"] } : {}),
  };
}
// Transport fixtures only: these receipts never prove SQL ACLs or tenant access.
function fixture(results: readonly SqlResult[]) {
  let calls = 0;
  const statements: SqlStatement[] = [];
  const query = vi.fn((statement: SqlStatement): Promise<SqlResult> => {
    statements.push(statement);
    const result = results[calls++];
    if (result === undefined) throw Error("Unexpected fixture read.");
    return Promise.resolve(result);
  });
  const tx: SqlExecutor = {
    query<TRow extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      return query(statement) as Promise<SqlResult<TRow>>;
    },
  };
  return { tx, query, statements };
}

describe("fixed private ACK presence reread", () => {
  it.each([false, true])(
    "returns original constant projection after two current presence reads, native labels=%s",
    async (nativeLabels) => {
      const f = fixture([
        receipt(["fixed"], nativeLabels),
        receipt(["fixed"], nativeLabels),
      ]);
      await expect(
        execute(f.tx, "api", sql(original, values)),
      ).resolves.toEqual({
        rowCount: 1,
        rows: [{ "?column?": 1 }],
        ...(nativeLabels ? { columnNames: ["?column?"] } : {}),
      });
      expect(f.query).toHaveBeenCalledTimes(2);
      for (const [statement] of f.query.mock.calls) {
        expect(statement.text).toBe(helperRead);
        expect(statement.values).toEqual(values);
        expect(statement.text).not.toMatch(
          /FROM (?:public\.)?model_commercial_workflows|snapshot|lease_expires_at|GRANT|REVOKE/iu,
        );
      }
    },
  );
  it("preserves two absent reads as zero rows without inventing ACK authority", async () => {
    const f = fixture([receipt([]), receipt([])]);
    await expect(execute(f.tx, "api", sql(original, values))).resolves.toEqual({
      rowCount: 0,
      rows: [],
    });
    expect(f.query).toHaveBeenCalledTimes(2);
  });
  it.each([
    [["fixed"], []],
    [[], ["fixed"]],
  ])(
    "rejects presence drift %j -> %j after the lock",
    async (before, after) => {
      const f = fixture([receipt(before), receipt(after)]);
      await expect(
        execute(f.tx, "api", sql(original, values)),
      ).rejects.toThrow();
      expect(f.query).toHaveBeenCalledTimes(2);
    },
  );
  const malformed: readonly SqlResult[] = [
    { rowCount: 0, rows: [] },
    { rowCount: 2, rows: [{ locked_keys_json: "[]" }] },
    {
      rowCount: 1,
      rows: [{ locked_keys_json: "[]" }, { locked_keys_json: "[]" }],
    },
    { rowCount: 1, rows: [{ locked_keys_json: null }] },
    { rowCount: 1, rows: [{ locked_keys_json: "[" }] },
    receipt(null),
    receipt({}),
    receipt([null]),
    receipt(["other_tenant"]),
    receipt(["fixed", "fixed"]),
    { rowCount: 1, rows: [{ locked_keys_json: "[]", snapshot: "forbidden" }] },
    { ...receipt([]), columnNames: ["locked_keys_json", "locked_keys_json"] },
    { ...receipt([]), columnNames: ["snapshot"] },
  ];
  it.each(malformed.map((result, index) => ({ result, index })))(
    "rejects malformed receipt $index at either read",
    async ({ result }) => {
      const first = fixture([result]);
      await expect(
        execute(first.tx, "api", sql(original, values)),
      ).rejects.toThrow();
      expect(first.query).toHaveBeenCalledTimes(1);
      const second = fixture([receipt([]), result]);
      await expect(
        execute(second.tx, "api", sql(original, values)),
      ).rejects.toThrow();
      expect(second.query).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["proposal", "export", "cleanup", "billing"] as const)(
    "denies %s before any private read",
    async (host) => {
      const f = fixture([]);
      await expect(
        execute(f.tx, host, sql(original, values)),
      ).rejects.toThrow();
      expect(f.query).not.toHaveBeenCalled();
    },
  );
  it("denies wrong arity, null, empty and nontext slots before IO", async () => {
    const f = fixture([]);
    const invalid: readonly (readonly SqlValue[])[] = [
      values.slice(0, 4),
      [...values, "extra"],
    ];
    for (let index = 0; index < 5; index++) {
      for (const value of [null, "", 4, false]) {
        const changed: SqlValue[] = [...values];
        changed[index] = value;
        await expect(
          execute(f.tx, "api", sql(original, changed)),
        ).rejects.toThrow();
      }
    }
    for (const changed of invalid)
      await expect(
        execute(f.tx, "api", sql(original, changed)),
      ).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });
  it("does not interpret or execute caller SQL variants", async () => {
    const f = fixture([]);
    await expect(
      execute(f.tx, "api", sql(original + " /* caller */", values)),
    ).resolves.toBeUndefined();
    expect(f.query).not.toHaveBeenCalled();
  });
  it("retains the original five-key tuple when caller storage changes during a wait", async () => {
    const callerValues = [...values];
    const observed: SqlStatement[] = [];
    const tx: SqlExecutor = {
      query<TRow extends SqlRow>(
        statement: SqlStatement,
      ): Promise<SqlResult<TRow>> {
        observed.push(statement);
        if (observed.length === 1) callerValues[0] = "other_org";
        return Promise.resolve(receipt(["fixed"]) as SqlResult<TRow>);
      },
    };
    await execute(tx, "api", sql(original, callerValues));
    expect(observed.map((s) => s.values)).toEqual([values, values]);
    expect(callerValues[0]).toBe("other_org");
  });
  it("propagates denied helper execution without falling back to table SELECT", async () => {
    const failure = Error("Synthetic helper denied");
    const query = vi.fn(() => Promise.reject(failure));
    await expect(execute({ query }, "api", sql(original, values))).rejects.toBe(
      failure,
    );
    expect(query).toHaveBeenCalledOnce();
  });
});
