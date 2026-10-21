import {
  sql,
  type SqlDatabase,
  type SqlRow,
} from "../adapters/persistence/sql.js";
import type {
  LocalOwnerSessionRecord,
  LocalOwnerSessionStore,
} from "./local-owner-identity.js";

type LocalOwnerRow = SqlRow & {
  readonly token_sha256?: unknown;
  readonly principal_id?: unknown;
  readonly session_sha256?: unknown;
  readonly authenticated_at?: unknown;
  readonly expires_at?: unknown;
};

const utc = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Uses the existing browser_refresh_sessions lifecycle and revocation family.
 * It requires the standalone runtime role to have the same narrowly scoped
 * table/function privileges as the existing browser-session adapter. */
export class PostgresLocalOwnerSessionStore implements LocalOwnerSessionStore {
  readonly #database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.#database = database;
  }

  async isActiveOwner(principalId: string): Promise<boolean> {
    const result = await this.#database.query(
      sql(
        "SELECT principal_id FROM principals WHERE principal_id=$1 AND lifecycle_status='active'",
        [principalId],
      ),
    );
    return result.rowCount === 1;
  }

  async create(record: LocalOwnerSessionRecord): Promise<boolean> {
    const result = await this.#database.query(
      sql(
        `INSERT INTO browser_refresh_sessions
          (session_sha256,lifecycle_status,principal_id,provider_session_sha256,authenticated_at,expires_at)
        SELECT $1,'active',$2,$3,$4::timestamptz,$5::timestamptz
        WHERE EXISTS (SELECT 1 FROM principals WHERE principal_id=$2 AND lifecycle_status='active')
        ON CONFLICT DO NOTHING RETURNING session_sha256`,
        [
          record.tokenSha256,
          record.principalId,
          record.sessionSha256,
          record.authenticatedAt,
          record.expiresAt,
        ],
      ),
    );
    return result.rowCount === 1;
  }

  async readActive(
    tokenSha256: string,
    sessionSha256: string,
  ): Promise<LocalOwnerSessionRecord | null> {
    const result = await this.#database.query<LocalOwnerRow>(
      sql(
        `SELECT session_sha256 AS token_sha256,principal_id,
          provider_session_sha256 AS session_sha256,
          ${utc("authenticated_at")} AS authenticated_at,
          ${utc("expires_at")} AS expires_at
        FROM browser_refresh_sessions
        WHERE session_sha256=$1 AND provider_session_sha256=$2
          AND lifecycle_status='active' AND expires_at>clock_timestamp()
          AND cloudmarkup_account_session_allowed_v1(
            principal_id,provider_session_sha256,authenticated_at,expires_at)
        LIMIT 1`,
        [tokenSha256, sessionSha256],
      ),
    );
    const row = result.rows[0];
    return row !== undefined &&
      typeof row.token_sha256 === "string" &&
      typeof row.principal_id === "string" &&
      typeof row.session_sha256 === "string" &&
      typeof row.authenticated_at === "string" &&
      typeof row.expires_at === "string"
      ? {
          tokenSha256: row.token_sha256,
          principalId: row.principal_id,
          sessionSha256: row.session_sha256,
          authenticatedAt: row.authenticated_at,
          expiresAt: row.expires_at,
        }
      : null;
  }

  async revoke(tokenSha256: string): Promise<void> {
    await this.#database.query(
      sql(
        `UPDATE browser_refresh_sessions
          SET lifecycle_status='revoked',revoked_at=clock_timestamp()
        WHERE session_sha256=$1 AND lifecycle_status='active'`,
        [tokenSha256],
      ),
    );
  }
}
