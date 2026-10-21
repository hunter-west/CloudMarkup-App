import { createHash } from "node:crypto";
import {
  accountSessionV1Schema,
  accountSessionIdV1Schema,
  changeAccountSessionsV1Schema,
  accountSessionChangeReceiptV1Schema,
  idempotencyHeadersV1Schema,
  type AccountSessionChangeReceiptV1,
} from "@cloudmarkup/api-contract";
import type {
  AccountSessionAdmission,
  AccountSessionsApplication,
} from "../../application/account-sessions.js";
import { ApplicationError } from "../../application/errors.js";
import {
  requireRecentAuthentication,
  type Principal,
} from "../../application/identity.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const unavailable = (): never => {
  throw new ApplicationError(
    "authentication_required",
    "Sign in again to continue.",
  );
};
export async function lockAccountSessions(
  tx: SqlExecutor,
  principalId: string,
): Promise<void> {
  await tx.query(
    sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "account-sessions-v1:" + principalId,
    ]),
  );
  await tx.query(
    sql(
      "SELECT principal_id FROM principals WHERE principal_id=$1 AND lifecycle_status='active' FOR SHARE",
      [principalId],
    ),
  );
}
export async function accountSessionAllowed(
  tx: SqlExecutor,
  principal: Principal,
  authenticationSource: "cognito" | "local-owner" = "cognito",
): Promise<boolean> {
  if (
    principal.authenticationSource !== authenticationSource ||
    !Number.isFinite(Date.parse(principal.authenticatedAt)) ||
    !Number.isFinite(Date.parse(principal.expiresAt)) ||
    !principal.sessionId ||
    principal.sessionId.length > 256
  )
    return false;
  const result = await tx.query(
    sql(
      "SELECT cloudmarkup_account_session_allowed_v1($1,$2,$3::timestamptz,$4::timestamptz) AS allowed",
      [
        principal.principalId,
        digest(principal.sessionId),
        principal.authenticatedAt,
        principal.expiresAt,
      ],
    ),
  );
  return result.rows[0]?.["allowed"] === true;
}
/** Actor-owned metadata and monotonic application revocation; no provider credentials. */
export class PostgresAccountSessions
  implements AccountSessionAdmission, AccountSessionsApplication
{
  readonly database: SqlDatabase;
  readonly #authenticationSource: "cognito" | "local-owner";
  constructor(
    database: SqlDatabase,
    options: { readonly authenticationSource?: "cognito" | "local-owner" } = {},
  ) {
    this.database = database;
    this.#authenticationSource = options.authenticationSource ?? "cognito";
  }
  async #transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    try {
      return await this.database.transaction(work);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "service_unavailable",
        "Account sessions are temporarily unavailable. Retry the same attempt.",
      );
    }
  }
  isActive = (principal: Principal): Promise<boolean> =>
    accountSessionAllowed(this.database, principal, this.#authenticationSource);
  list: AccountSessionsApplication["list"] = (principal, options) => {
    principal = Object.freeze({ ...principal });
    const limit = options.limit,
      cursor = options.cursor ?? "";
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (cursor !== "" && !accountSessionIdV1Schema.safeParse(cursor).success)
    )
      return Promise.reject(
        new ApplicationError("invalid_request", "The session page is invalid."),
      );
    return this.#transaction(async (tx) => {
      await lockAccountSessions(tx, principal.principalId);
      if (
        !(await accountSessionAllowed(
          tx,
          principal,
          this.#authenticationSource,
        ))
      )
        return unavailable();
      const rows = await tx.query(
        sql(
          `SELECT s.session_sha256,s.provider_session_sha256,
        to_char(s.authenticated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS authenticated_at,
        to_char(s.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at
        FROM browser_refresh_sessions s WHERE s.principal_id=$1 AND s.lifecycle_status='active' AND s.expires_at>clock_timestamp()
        AND s.session_sha256>$2 AND cloudmarkup_account_session_allowed_v1(s.principal_id,s.provider_session_sha256,s.authenticated_at,s.expires_at)
        ORDER BY s.session_sha256 LIMIT $3`,
          [principal.principalId, cursor.replace(/^browser_/u, ""), limit + 1],
        ),
      );
      const items = rows.rows.slice(0, limit).map((row) =>
        accountSessionV1Schema.parse({
          contractVersion: 1,
          principalId: principal.principalId,
          id: "browser_" + String(row["session_sha256"]),
          authenticatedAt: row["authenticated_at"],
          expiresAt: row["expires_at"],
          current:
            row["provider_session_sha256"] === digest(principal.sessionId),
        }),
      );
      if (
        !(await accountSessionAllowed(
          tx,
          principal,
          this.#authenticationSource,
        ))
      )
        return unavailable();
      const nextCursor = items.at(-1)?.id;
      return {
        items,
        ...(rows.rows.length > limit && nextCursor ? { nextCursor } : {}),
      };
    });
  };
  change: AccountSessionsApplication["change"] = (principal, input, key) => {
    principal = Object.freeze({ ...principal });
    const parsed = changeAccountSessionsV1Schema.safeParse(input);
    if (
      !parsed.success ||
      !idempotencyHeadersV1Schema.safeParse({ "idempotency-key": key }).success
    )
      return Promise.reject(
        new ApplicationError(
          "invalid_request",
          "The session change is invalid.",
        ),
      );
    const request = parsed.data,
      keyHash = digest(JSON.stringify([principal.principalId, key])),
      requestHash = digest(JSON.stringify(request));
    return this.#transaction(async (tx) => {
      requireRecentAuthentication(principal, new Date());
      await lockAccountSessions(tx, principal.principalId);
      requireRecentAuthentication(principal, new Date());
      if (
        !(await accountSessionAllowed(
          tx,
          principal,
          this.#authenticationSource,
        ))
      )
        return unavailable();
      const replay = (
        await tx.query(
          sql(
            "SELECT request_sha256,receipt_json FROM account_session_change_receipts WHERE principal_id=$1 AND idempotency_key_sha256=$2",
            [principal.principalId, keyHash],
          ),
        )
      ).rows[0];
      if (replay) {
        if (replay["request_sha256"] !== requestHash)
          throw new ApplicationError(
            "idempotency_key_reused",
            "Start a new session-management attempt.",
          );
        requireRecentAuthentication(principal, new Date());
        if (
          !(await accountSessionAllowed(
            tx,
            principal,
            this.#authenticationSource,
          ))
        )
          return unavailable();
        return accountSessionChangeReceiptV1Schema.parse(
          replay["receipt_json"],
        );
      }
      let authenticatedThrough: string | null = null;
      if (request.action === "revoke") {
        const target = (
          await tx.query(
            sql(
              "SELECT provider_session_sha256 FROM browser_refresh_sessions WHERE principal_id=$1 AND session_sha256=$2 AND provider_session_sha256 IS NOT NULL FOR UPDATE",
              [principal.principalId, request.sessionId.slice(8)],
            ),
          )
        ).rows[0];
        if (!target)
          throw new ApplicationError(
            "not_found",
            "The session is unavailable.",
          );
        await tx.query(
          sql(
            "INSERT INTO account_revoked_session_families(principal_id,provider_session_sha256) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [principal.principalId, String(target["provider_session_sha256"])],
          ),
        );
        await tx.query(
          sql(
            "UPDATE browser_refresh_sessions SET lifecycle_status='revoked',revoked_at=clock_timestamp() WHERE principal_id=$1 AND provider_session_sha256=$2 AND lifecycle_status='active'",
            [principal.principalId, String(target["provider_session_sha256"])],
          ),
        );
      } else {
        const row = (
          await tx.query(
            sql(
              `INSERT INTO account_authentication_cutoffs(principal_id,authenticated_through) VALUES($1,clock_timestamp())
          ON CONFLICT(principal_id) DO UPDATE SET authenticated_through=GREATEST(account_authentication_cutoffs.authenticated_through,EXCLUDED.authenticated_through)
          RETURNING to_char(authenticated_through AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS cutoff`,
              [principal.principalId],
            ),
          )
        ).rows[0];
        authenticatedThrough = String(row?.["cutoff"]);
        await tx.query(
          sql(
            "UPDATE browser_refresh_sessions SET lifecycle_status='revoked',revoked_at=clock_timestamp() WHERE principal_id=$1 AND lifecycle_status='active'",
            [principal.principalId],
          ),
        );
      }
      const receipt: AccountSessionChangeReceiptV1 =
        accountSessionChangeReceiptV1Schema.parse({
          contractVersion: 1,
          principalId: principal.principalId,
          action: request.action,
          sessionId: request.action === "revoke" ? request.sessionId : null,
          authenticatedThrough,
          occurredAt: new Date().toISOString(),
        });
      await tx.query(
        sql(
          "INSERT INTO account_session_change_receipts(principal_id,idempotency_key_sha256,request_sha256,receipt_json) VALUES($1,$2,$3,$4::jsonb)",
          [
            principal.principalId,
            keyHash,
            requestHash,
            JSON.stringify(receipt),
          ],
        ),
      );
      // The command may intentionally revoke its caller. Identity and request
      // expiry still apply at commit; jobs and historical accounting stay intact.
      requireRecentAuthentication(principal, new Date());
      const valid = await tx.query(
        sql(
          "SELECT principal_id FROM principals WHERE principal_id=$1 AND lifecycle_status='active' AND $2::timestamptz>clock_timestamp()",
          [principal.principalId, principal.expiresAt],
        ),
      );
      if (valid.rowCount !== 1) return unavailable();
      return receipt;
    });
  };
}
