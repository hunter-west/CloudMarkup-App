import { executeOrdinaryRuntimeStatement } from "./ordinary-runtime-locks.js";
import { RepositoryError } from "../../application/persistence.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

export type OrdinaryRuntimeHost =
  "api" | "proposal" | "export" | "cleanup" | "billing";
const logins: Readonly<Record<OrdinaryRuntimeHost, string>> = Object.freeze({
  api: "cloudmarkup_beta_api_runtime",
  proposal: "cloudmarkup_beta_proposal_runtime",
  export: "cloudmarkup_beta_export_runtime",
  cleanup: "cloudmarkup_beta_cleanup_runtime",
  billing: "cloudmarkup_beta_billing_runtime",
});

function unavailable(): never {
  throw new RepositoryError(
    "persistence-unavailable",
    "The ordinary database runtime identity is unavailable.",
  );
}

/** Closed hosts choose identities; events and environment role names cannot.
 * Real secret suffixes are provisioned operator outputs. */
export function assertOrdinaryRuntimeBinding(input: {
  readonly host: OrdinaryRuntimeHost;
  readonly database: string;
  readonly resourceArn: string;
  readonly secretArn: string;
}): void {
  const cluster =
    /^arn:aws:rds:([a-z]{2}-[a-z]+-\d):(\d{12}):cluster:cloudmarkup-beta-postgresql$/u.exec(
      input.resourceArn,
    );
  const region = cluster?.[1];
  const account = cluster?.[2];
  if (
    region === undefined ||
    account === undefined ||
    input.database !== "cloudmarkup"
  )
    unavailable();
  const prefix =
    "arn:aws:secretsmanager:" +
    region +
    ":" +
    account +
    ":secret:cloudmarkup-beta/database/runtime/" +
    input.host +
    "-";
  if (
    !input.secretArn.startsWith(prefix) ||
    !/^[A-Za-z0-9]{6}$/u.test(input.secretArn.slice(prefix.length))
  )
    unavailable();
}

const identityStatement = sql(
  [
    "SELECT session_user::text AS login, current_user::text AS effective_role,",
    "pg_catalog.current_database()::text AS database_name,",
    "r.rolcanlogin AS can_login, r.rolsuper AS superuser,",
    "r.rolcreatedb AS create_database, r.rolcreaterole AS create_role,",
    "r.rolinherit AS inherits, r.rolreplication AS replication,",
    "r.rolbypassrls AS bypass_rls,",
    "EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS has_membership,",
    "(EXISTS (SELECT 1 FROM pg_catalog.pg_database d WHERE d.datdba = r.oid)",
    "OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspowner = r.oid)",
    "OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relowner = r.oid)",
    "OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.proowner = r.oid)",
    "OR EXISTS (SELECT 1 FROM pg_catalog.pg_type t WHERE t.typowner = r.oid)) AS owns_object,",
    "(pg_catalog.has_database_privilege(r.oid, pg_catalog.current_database(), 'CREATE')",
    "OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n",
    "WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'",
    "AND pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE'))) AS can_create,",
    "pg_catalog.current_setting('session_replication_role') AS replication_role,",
    "pg_catalog.has_parameter_privilege(r.oid, 'session_replication_role', 'SET, ALTER SYSTEM') AS can_bypass_triggers",
    "FROM pg_catalog.pg_roles r WHERE r.rolname = current_user",
  ].join("\n"),
);

async function assertIdentity(tx: SqlExecutor, host: OrdinaryRuntimeHost) {
  const result = await tx.query(identityStatement);
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    result.rows.length !== 1 ||
    row?.["login"] !== logins[host] ||
    row["effective_role"] !== logins[host] ||
    row["database_name"] !== "cloudmarkup" ||
    row["replication_role"] !== "origin" ||
    row["can_login"] !== true ||
    [
      "superuser",
      "create_database",
      "create_role",
      "inherits",
      "replication",
      "bypass_rls",
      "has_membership",
      "owns_object",
      "can_create",
      "can_bypass_triggers",
    ].some((key) => row[key] !== false)
  )
    unavailable();
}

/** Check the actual executor, including single statements, without selecting
 * any role or caching admission across Data API connections or invocations. */
export class OrdinaryRuntimeDatabase implements SqlDatabase {
  readonly #database: SqlDatabase;
  readonly #host: OrdinaryRuntimeHost;

  constructor(database: SqlDatabase, host: OrdinaryRuntimeHost) {
    this.#database = database;
    this.#host = host;
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    return this.transaction((tx) => tx.query<TRow>(statement));
  }

  transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    return this.#database.transaction(async (tx) => {
      await assertIdentity(tx, this.#host);
      await tx.query(
        sql("SET LOCAL search_path TO pg_catalog, public, pg_temp"),
      );
      await tx.query(sql("SET LOCAL row_security TO on"));
      let active = true;
      const admitted: SqlExecutor = {
        query<TRow extends SqlRow = SqlRow>(statement: SqlStatement) {
          if (!active) unavailable();
          return tx.query<TRow>(statement);
        },
      };
      try {
        const guarded: SqlExecutor = {
          query: <TRow extends SqlRow = SqlRow>(statement: SqlStatement) => {
            if (!active) unavailable();
            return executeOrdinaryRuntimeStatement<TRow>(
              admitted,
              this.#host,
              statement,
            );
          },
        };
        const result = await work(guarded);
        active = false;
        await assertIdentity(tx, this.#host);
        return result;
      } finally {
        active = false;
      }
    });
  }

  close(): Promise<void> {
    return this.#database.close();
  }
}
