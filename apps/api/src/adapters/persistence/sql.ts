export type SqlValue = string | number | bigint | boolean | Uint8Array | null;

export interface SqlStatement {
  readonly text: string;
  readonly values: readonly SqlValue[];
}

export type SqlRow = Readonly<Record<string, unknown>>;

export interface SqlResult<TRow extends SqlRow = SqlRow> {
  /** Native result labels, retained before object decoding can hide duplicates. */
  readonly columnNames?: readonly string[];
  /** Returned rows for reads, affected rows for writes (including no-row writes). */
  readonly rowCount: number;
  readonly rows: readonly TRow[];
}

export interface SqlExecutor {
  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>>;
}

export interface SqlDatabase extends SqlExecutor {
  close(): Promise<void>;
  transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult>;
}

export function sql(
  text: string,
  values: readonly SqlValue[] = [],
): SqlStatement {
  return { text, values };
}
