import { convertPositionalParameters } from "./rds-data-driver.js";
import {
  sql,
  type SqlDatabase,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

/** Real PostgreSQL with Data API parameter types and JSON scalar representations.
 * Native pg otherwise conceals missing casts and UTC timestamp normalization. */
export function withDataApiTypes(
  database: SqlDatabase,
  onRoundTrip?: (operation: string) => void,
): SqlDatabase {
  function typed(statement: SqlStatement): SqlStatement {
    onRoundTrip?.(statement.text);
    const { parameters } = convertPositionalParameters(statement);
    return sql(
      statement.text.replace(/\$(\d+)/gu, (match, index: string) => {
        const value = parameters[Number(index) - 1]?.value;
        const type =
          value?.stringValue !== undefined
            ? "text"
            : value?.longValue !== undefined
              ? "bigint"
              : value?.doubleValue !== undefined
                ? "double precision"
                : value?.booleanValue !== undefined
                  ? "boolean"
                  : undefined;
        return type === undefined ? match : "(" + match + "::" + type + ")";
      }),
      statement.values,
    );
  }
  function decoded<TRow extends SqlRow>(
    result: SqlResult<TRow>,
  ): SqlResult<TRow> {
    if (
      result.columnNames !== undefined &&
      new Set(result.columnNames).size !== result.columnNames.length
    ) {
      throw new Error(
        "Data API cannot convert a result with duplicate column names to JSON.",
      );
    }
    return {
      ...result,
      rows: result.rows.map(
        (row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              value instanceof Date
                ? value.toISOString().replace("T", " ").replace("Z", "")
                : typeof value === "bigint" ||
                    (typeof value === "number" && Number.isInteger(value))
                  ? String(value)
                  : value,
            ]),
          ) as TRow,
      ),
    };
  }
  return {
    close: () => Promise.resolve(),
    query: async <TRow extends SqlRow>(statement: SqlStatement) =>
      decoded(await database.query<TRow>(typed(statement))),
    transaction: (work) => {
      onRoundTrip?.("BEGIN");
      return database.transaction(async (transaction) => {
        try {
          return await work({
            query: async <TRow extends SqlRow>(statement: SqlStatement) =>
              decoded(await transaction.query<TRow>(typed(statement))),
          });
        } finally {
          onRoundTrip?.("COMMIT/ROLLBACK");
        }
      });
    },
  };
}
