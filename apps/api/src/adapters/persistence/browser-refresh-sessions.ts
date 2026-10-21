import {
  accountSessionAllowed,
  lockAccountSessions,
} from "./account-sessions.js";
import { createHash } from "node:crypto";
import type { Principal } from "../../application/identity.js";
import { sql, type SqlDatabase } from "./sql.js";

export interface BrowserRefreshSessions {
  begin(handle: string): Promise<boolean>;
  activate(handle: string, principal: Principal): Promise<string | null>;
  current(handle: string, principal: Principal): Promise<string | null>;
  revoke(handle: string): Promise<void>;
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const validHandle = (handle: string) => {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(handle))
    throw new TypeError("Invalid browser session handle.");
  return digest(handle);
};
const utcExpiry = `to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at`;

/** Only lifecycle/verified identity metadata is persisted. A handle alone cannot
 * restore access; every current read also needs a verified provider principal. */
export class PostgresBrowserRefreshSessions implements BrowserRefreshSessions {
  private readonly database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.database = database;
  }
  async begin(handle: string): Promise<boolean> {
    const id = validHandle(handle);
    const result = await this.database.query(
      sql(
        `WITH expired AS (
      SELECT session_sha256 FROM browser_refresh_sessions WHERE expires_at < clock_timestamp()-INTERVAL '30 days'
      ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
    ), pruned AS (DELETE FROM browser_refresh_sessions WHERE session_sha256 IN (SELECT session_sha256 FROM expired))
    INSERT INTO browser_refresh_sessions(session_sha256,lifecycle_status,expires_at)
    VALUES ($1,'exchanging',clock_timestamp()+INTERVAL '10 minutes') ON CONFLICT DO NOTHING RETURNING session_sha256`,
        [id],
      ),
    );
    return result.rows.length === 1;
  }
  async activate(handle: string, principal: Principal): Promise<string | null> {
    return this.database.transaction(async (tx) => {
      await lockAccountSessions(tx, principal.principalId);
      if (!(await accountSessionAllowed(tx, principal))) return null;
      const result = await tx.query(
        sql(
          `UPDATE browser_refresh_sessions SET lifecycle_status='active',
      principal_id=$2,provider_session_sha256=$3,authenticated_at=$4::timestamptz,expires_at=$4::timestamptz+INTERVAL '8 hours'
      WHERE session_sha256=$1 AND lifecycle_status='exchanging' AND expires_at>clock_timestamp()
      AND $4::timestamptz <= clock_timestamp()+INTERVAL '30 seconds' AND $4::timestamptz+INTERVAL '8 hours'>clock_timestamp()
      AND EXISTS (SELECT 1 FROM principals WHERE principal_id=$2 AND lifecycle_status='active')
      RETURNING ${utcExpiry}`,
          [
            validHandle(handle),
            principal.principalId,
            digest(principal.sessionId),
            principal.authenticatedAt,
          ],
        ),
      );
      const value = result.rows[0]?.["expires_at"];
      if (!(await accountSessionAllowed(tx, principal))) return null;
      return typeof value === "string" ? value : null;
    });
  }
  async current(handle: string, principal: Principal): Promise<string | null> {
    const result = await this.database.query(
      sql(
        `SELECT ${utcExpiry} FROM browser_refresh_sessions
      WHERE session_sha256=$1 AND lifecycle_status='active' AND expires_at>clock_timestamp()
      AND principal_id=$2 AND provider_session_sha256=$3 AND authenticated_at=$4::timestamptz
      AND cloudmarkup_account_session_allowed_v1($2,$3,$4::timestamptz,$5::timestamptz)
      AND EXISTS (SELECT 1 FROM principals WHERE principal_id=$2 AND lifecycle_status='active')`,
        [
          validHandle(handle),
          principal.principalId,
          digest(principal.sessionId),
          principal.authenticatedAt,
          principal.expiresAt,
        ],
      ),
    );
    const value = result.rows[0]?.["expires_at"];
    return typeof value === "string" ? value : null;
  }
  async revoke(handle: string): Promise<void> {
    const id = validHandle(handle);
    // Read before locking; a pending exchange can acquire its principal once.
    // Conditional writes retry that transition without reversing lock order.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = (
        await this.database.query(
          sql(
            "SELECT principal_id,lifecycle_status FROM browser_refresh_sessions WHERE session_sha256=$1",
            [id],
          ),
        )
      ).rows[0];
      if (before?.["lifecycle_status"] === "revoked") return;
      const principalId =
        typeof before?.["principal_id"] === "string"
          ? before["principal_id"]
          : null;
      const changed = await this.database.transaction(async (tx) => {
        if (principalId !== null) await lockAccountSessions(tx, principalId);
        const result = await tx.query(
          sql(
            `INSERT INTO browser_refresh_sessions(session_sha256,lifecycle_status,expires_at,revoked_at)
          VALUES($1,'revoked',clock_timestamp()+INTERVAL '8 hours',clock_timestamp())
          ON CONFLICT(session_sha256) DO UPDATE SET lifecycle_status='revoked',revoked_at=clock_timestamp()
          WHERE browser_refresh_sessions.lifecycle_status<>'revoked' AND browser_refresh_sessions.principal_id IS NOT DISTINCT FROM $2::text
          RETURNING session_sha256`,
            [id, principalId],
          ),
        );
        return result.rowCount === 1;
      });
      if (changed) return;
    }
    throw new Error("Browser session revocation must be retried.");
  }
}
