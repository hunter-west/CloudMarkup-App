import { RepositoryError } from "../../application/persistence.js";
import { tryExecutePrivatePreviewAckWorkflowPresenceV1 } from "./private-preview-ack-workflow-presence.js";
import type { OrdinaryRuntimeHost } from "./ordinary-runtime-database.js";
import {
  ordinaryAuthorizationLocks,
  ordinaryAuthorizationReceiptColumn,
} from "./ordinary-runtime-authorization-locks.js";
import {
  sql,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

function unavailable(): never {
  throw new RepositoryError(
    "persistence-unavailable",
    "The ordinary authorization lock is unavailable.",
  );
}

function keysFromReceipt(result: SqlResult): string[] {
  if (
    result.rowCount !== 1 ||
    result.rows.length !== 1 ||
    typeof result.rows[0]?.["locked_keys_json"] !== "string" ||
    (result.columnNames !== undefined &&
      (result.columnNames.length !== 1 ||
        result.columnNames[0] !== "locked_keys_json"))
  )
    unavailable();
  let value: unknown;
  try {
    value = JSON.parse(result.rows[0]["locked_keys_json"]);
  } catch {
    unavailable();
  }
  if (
    !Array.isArray(value) ||
    !value.every((key: unknown) => typeof key === "string" && key.length > 0)
  )
    unavailable();
  return value as string[];
}

/** Called only with the same live, identity-admitted transaction executor used
 * by OrdinaryRuntimeDatabase. Undefined means the central adapter owns this SQL.
 * A captured identity grants no authority: all mutable business fields and original
 * predicates are read again as the ordinary invoker after the fixed lock waits. */
export async function tryExecuteOrdinaryAuthorizationStatement<
  TRow extends SqlRow = SqlRow,
>(
  executor: SqlExecutor,
  host: OrdinaryRuntimeHost,
  statement: SqlStatement,
): Promise<SqlResult<TRow> | undefined> {
  // Only pattern7 is pure presence; its fixed helper reread exposes no private columns.
  const privatePresence =
    await tryExecutePrivatePreviewAckWorkflowPresenceV1<TRow>(
      executor,
      host,
      statement,
    );
  if (privatePresence !== undefined) return privatePresence;
  const binding = ordinaryAuthorizationLocks.find(
    (entry) => entry.statement === statement.text,
  );
  if (binding === undefined) return undefined;
  if (
    !(binding.hosts as readonly string[]).includes(host) ||
    statement.values.length !== binding.parameterCount ||
    statement.values.some((value) => typeof value !== "string" || value === "")
  )
    unavailable();

  const helperValues = binding.helperArguments.map((argument) => {
    if ("literal" in argument) return argument.literal;
    const value = statement.values[argument.valueIndex];
    if (value === undefined) unavailable();
    return value;
  });
  const captured = keysFromReceipt(
    await executor.query(
      sql(
        "SELECT locked_keys_json FROM cloudmarkup_ordinary_private.lock_" +
          binding.name +
          "(" +
          helperValues
            .map((_value, index) => "$" + String(index + 1) + "::text")
            .join(",") +
          ")",
        helperValues,
      ),
    ),
  );
  // Reread text is a fixed source literal. Do not rewrite caller SQL or accept a
  // helper-returned projection. Even the optional object stays an invoker read.
  const read = await executor.query(sql(binding.reread, statement.values));
  const marker = ordinaryAuthorizationReceiptColumn;
  if (
    read.rowCount !== read.rows.length ||
    (binding.nullableAnchor && read.rowCount !== 1) ||
    (read.columnNames !== undefined &&
      (read.columnNames.filter((name) => name === marker).length !== 1 ||
        new Set(read.columnNames).size !== read.columnNames.length))
  )
    unavailable();
  const observed: string[] = [];
  const rows = read.rows.map((row) => {
    const key = row[marker];
    if (binding.nullableAnchor && key === null) {
      // LEFT JOIN's diagnostic anchor is not a locked membership. Preserve the
      // authenticated flag and null business fields for the original caller.
      if (row["membership_id"] !== null || row["role_key"] !== null)
        unavailable();
    } else {
      if (typeof key !== "string" || key.length === 0) unavailable();
      observed.push(key);
    }
    return Object.fromEntries(
      Object.entries(row).filter(([name]) => name !== marker),
    );
  });
  if (
    JSON.stringify([...captured].sort()) !==
    JSON.stringify([...observed].sort())
  )
    unavailable();
  return {
    rowCount: read.rowCount,
    rows: rows as TRow[],
    ...(read.columnNames === undefined
      ? {}
      : { columnNames: read.columnNames.filter((name) => name !== marker) }),
  };
}
