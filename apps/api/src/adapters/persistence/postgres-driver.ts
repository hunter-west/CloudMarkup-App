import { Pool, type PoolConfig, type PoolClient } from "pg";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

interface PgQueryable {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly fields?: readonly { readonly name: string }[];
    readonly rowCount: number | null;
    readonly rows: readonly unknown[];
  }>;
}

async function execute<TRow extends SqlRow>(
  queryable: PgQueryable,
  statement: SqlStatement,
): Promise<SqlResult<TRow>> {
  const result = await queryable.query(statement.text, statement.values);
  return {
    ...(result.fields === undefined
      ? {}
      : { columnNames: result.fields.map((field) => field.name) }),
    rowCount: result.rowCount ?? 0,
    rows: result.rows as readonly TRow[],
  };
}

class PostgresTransactionExecutor implements SqlExecutor {
  readonly #client: PoolClient;

  constructor(client: PoolClient) {
    this.#client = client;
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    return execute<TRow>(this.#client, statement);
  }
}

export class PostgresDatabase implements SqlDatabase {
  readonly #pool: Pool;

  constructor(config: PoolConfig | Pool) {
    this.#pool = config instanceof Pool ? config : new Pool(config);
  }

  close(): Promise<void> {
    return this.#pool.end();
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    return execute<TRow>(this.#pool, statement);
  }

  async transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    const client = await this.#pool.connect();
    let discardClient = false;
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresTransactionExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discardClient = true;
        // Preserve the original transaction error. Connection disposal below
        // prevents a failed rollback from returning this client to normal use.
      }
      throw error;
    } finally {
      client.release(discardClient);
    }
  }
}
