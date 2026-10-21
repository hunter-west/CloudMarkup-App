import { RepositoryError } from "../../application/persistence.js";
import type { OrdinaryRuntimeHost } from "./ordinary-runtime-database.js";
import {
  sql,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

/** Exact existing pattern 7. This matcher is not a general private reader. */
export const privatePreviewAckWorkflowPresenceStatement =
  "SELECT 1 FROM model_commercial_workflows\n            WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3\n              AND workflow_id=$4 AND scope_sha256=$5 FOR SHARE";
export const privatePreviewAckWorkflowPresenceRead =
  "SELECT locked_keys_json FROM cloudmarkup_ordinary_private.lock_preview_ack_workflow($1::text,$2::text,$3::text,$4::text,$5::text)";

function unavailable(): never {
  throw new RepositoryError(
    "persistence-unavailable",
    "The private preview workflow presence is unavailable.",
  );
}

function presence(result: SqlResult): boolean {
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    result.rows.length !== 1 ||
    row === undefined ||
    Object.keys(row).length !== 1 ||
    typeof row["locked_keys_json"] !== "string" ||
    (result.columnNames !== undefined &&
      (result.columnNames.length !== 1 ||
        result.columnNames[0] !== "locked_keys_json"))
  )
    unavailable();
  let keys: unknown;
  try {
    keys = JSON.parse(row["locked_keys_json"]);
  } catch {
    unavailable();
  }
  if (
    !Array.isArray(keys) ||
    keys.length > 1 ||
    keys.some((key: unknown) => key !== "fixed")
  )
    unavailable();
  return keys.length === 1;
}

/** Same live ordinary identity-admitted transaction only. Reuse the existing
 * fixed, API-only five-key definer presence lock for a second current read.
 * It returns no mutable business fields: never treat a captured receipt as
 * current authority, select private columns, or replace ACK request/commit
 * receipt, session, lease, draft, delivery and post-wait clock checks.
 */
export async function tryExecutePrivatePreviewAckWorkflowPresenceV1<
  TRow extends SqlRow = SqlRow,
>(
  executor: SqlExecutor,
  host: OrdinaryRuntimeHost,
  statement: SqlStatement,
): Promise<SqlResult<TRow> | undefined> {
  if (statement.text !== privatePreviewAckWorkflowPresenceStatement)
    return undefined;
  if (
    host !== "api" ||
    statement.values.length !== 5 ||
    statement.values.some((value) => typeof value !== "string" || value === "")
  )
    unavailable();
  // Copy before the first await. Both reads must use the same immutable tuple.
  const values = Object.freeze([...statement.values]);
  const captured = presence(
    await executor.query(sql(privatePreviewAckWorkflowPresenceRead, values)),
  );
  const current = await executor.query(
    sql(privatePreviewAckWorkflowPresenceRead, values),
  );
  const observed = presence(current);
  if (captured !== observed) unavailable();
  const rows: readonly SqlRow[] = observed ? [{ "?column?": 1 }] : [];
  return {
    rowCount: rows.length,
    rows: rows as readonly TRow[],
    ...(current.columnNames === undefined ? {} : { columnNames: ["?column?"] }),
  };
}
