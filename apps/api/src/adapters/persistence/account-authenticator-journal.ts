import { createHash } from "node:crypto";
import { z } from "zod";
import {
  accountAuthenticatorEnrollmentV1Schema,
  accountCredentialAttemptV1Schema,
  accountCredentialOutcomeV1Schema,
  type AccountAuthenticatorEnrollmentV1,
} from "@cloudmarkup/api-contract";
import type { AccountAuthenticatorJournal } from "../../application/account-authenticator.js";
import { ApplicationError } from "../../application/errors.js";
import { requireRecentAuthentication } from "../../application/identity.js";
import type { PrincipalContext } from "../../application/ports.js";
import {
  PostgresAccountCredentialAudit,
  accountCredentialAttemptCurrent,
} from "./account-credential-audit.js";
import {
  lockAccountSessions,
  accountSessionAllowed,
} from "./account-sessions.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const actionSchema = z.enum([
  "start",
  "verify-enable",
  "cancel-setup",
  "disable",
]);
const conflict = () =>
  new ApplicationError(
    "conflict",
    "This authenticator setup is no longer available for that change. Refresh account security.",
  );
const denied = () =>
  new ApplicationError(
    "authentication_required",
    "Sign in again to manage your authenticator.",
  );
const unavailable = () =>
  new ApplicationError(
    "service_unavailable",
    "Authenticator setup could not be confirmed.",
  );
function enrollment(
  row: SqlRow,
  principal: PrincipalContext,
): AccountAuthenticatorEnrollmentV1 {
  return accountAuthenticatorEnrollmentV1Schema.parse({
    id: row["enrollment_id"],
    expiresAt: row["expires_at"],
    status: row["state"],
    currentSession:
      row["provider_session_sha256"] === hash(principal.sessionId),
  });
}
/** Mutable setup state plus immutable actor-owned attempts; no secret material is accepted. */
export class PostgresAccountAuthenticatorJournal implements AccountAuthenticatorJournal {
  readonly #database: SqlDatabase;
  readonly #audit: PostgresAccountCredentialAudit;
  constructor(database: SqlDatabase, issuer: string) {
    this.#database = database;
    this.#audit = new PostgresAccountCredentialAudit(database, issuer);
  }
  async #transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    try {
      return await this.#database.transaction(work);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw unavailable();
    }
  }
  async #admit(
    tx: SqlExecutor,
    principal: PrincipalContext,
    recent: boolean,
  ): Promise<void> {
    await lockAccountSessions(tx, principal.principalId);
    if (!(await accountSessionAllowed(tx, principal))) throw denied();
    if (recent) requireRecentAuthentication(principal, new Date());
  }
  async #active(
    tx: SqlExecutor,
    principal: PrincipalContext,
  ): Promise<SqlRow | undefined> {
    const result = await tx.query(
      sql(
        `SELECT enrollment_id,provider_session_sha256,state,last_attempt_id,
      to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at
      FROM account_authenticator_enrollments WHERE principal_id=$1 AND expires_at>clock_timestamp()
      AND state NOT IN ('confirmed','cancelled') ORDER BY expires_at DESC LIMIT 2`,
        [principal.principalId],
      ),
    );
    if (result.rowCount > 1) throw unavailable();
    return result.rows[0];
  }
  async #mapped(
    tx: SqlExecutor,
    principal: PrincipalContext,
    attemptId: string,
  ): Promise<SqlRow> {
    const result = await tx.query(
      sql(
        `SELECT m.action,m.enrollment_id,e.state,e.last_attempt_id,e.provider_session_sha256,
      e.expires_at>clock_timestamp() AS active
      FROM account_authenticator_attempts m JOIN account_credential_attempts a
      ON a.principal_id=m.principal_id AND a.attempt_id=m.attempt_id
      LEFT JOIN account_authenticator_enrollments e ON e.principal_id=m.principal_id AND e.enrollment_id=m.enrollment_id
      WHERE m.principal_id=$1 AND m.attempt_id=$2::uuid AND a.provider_session_sha256=$3
      AND a.action='authenticator-'||m.action`,
        [principal.principalId, attemptId, hash(principal.sessionId)],
      ),
    );
    if (
      result.rowCount !== 1 ||
      !result.rows[0] ||
      !actionSchema.safeParse(result.rows[0]["action"]).success
    )
      throw denied();
    return result.rows[0];
  }
  async #assert(
    tx: SqlExecutor,
    principal: PrincipalContext,
    attemptId: string,
  ): Promise<SqlRow> {
    await this.#admit(tx, principal, true);
    if (!(await accountCredentialAttemptCurrent(tx, principal, attemptId)))
      throw conflict();
    const row = await this.#mapped(tx, principal, attemptId),
      action = row["action"];
    if (row["enrollment_id"] === null) {
      if (action !== "disable") throw conflict();
      return row;
    }
    if (row["last_attempt_id"] !== attemptId) throw conflict();
    if (action !== "disable" && row["active"] !== true) throw conflict();
    if (
      action === "start" &&
      (row["state"] !== "starting" ||
        row["provider_session_sha256"] !== hash(principal.sessionId))
    )
      throw conflict();
    if (
      action === "verify-enable" &&
      (row["state"] !== "verifying" ||
        row["provider_session_sha256"] !== hash(principal.sessionId))
    )
      throw conflict();
    if (
      action === "cancel-setup" &&
      row["state"] !== "ready" &&
      row["state"] !== "starting"
    )
      throw conflict();
    return row;
  }
  read: AccountAuthenticatorJournal["read"] = (principal) => {
    principal = Object.freeze({ ...principal });
    return this.#transaction(async (tx) => {
      await this.#admit(tx, principal, false);
      const row = await this.#active(tx, principal);
      return row ? enrollment(row, principal) : null;
    });
  };
  begin: AccountAuthenticatorJournal["begin"] = async (
    principal,
    attemptId,
    action,
    enrollmentId,
  ) => {
    principal = Object.freeze({ ...principal });
    if (
      !accountCredentialAttemptV1Schema.safeParse(attemptId).success ||
      !actionSchema.safeParse(action).success ||
      (action === "verify-enable" || action === "cancel-setup"
        ? !accountCredentialAttemptV1Schema.safeParse(enrollmentId).success
        : enrollmentId !== undefined)
    )
      throw new ApplicationError(
        "invalid_request",
        "The authenticator attempt is invalid.",
      );
    attemptId = attemptId.toLowerCase();
    enrollmentId = enrollmentId?.toLowerCase();
    await this.#audit.begin(principal, attemptId, `authenticator-${action}`);
    try {
      return await this.#transaction(async (tx) => {
        await this.#admit(tx, principal, true);
        if (!(await accountCredentialAttemptCurrent(tx, principal, attemptId)))
          throw conflict();
        const active = await this.#active(tx, principal);
        let selectedId: string | null = null;
        if (action === "start") {
          if (active) throw conflict();
          selectedId = attemptId;
          await tx.query(
            sql(
              `WITH t AS (SELECT clock_timestamp() AS now)
            INSERT INTO account_authenticator_enrollments(principal_id,enrollment_id,provider_session_sha256,state,last_attempt_id,created_at,expires_at)
            SELECT $1,$2::uuid,$3,'starting',$2::uuid,t.now,LEAST(t.now+INTERVAL '10 minutes',$4::timestamptz+INTERVAL '10 minutes') FROM t`,
              [
                principal.principalId,
                attemptId,
                hash(principal.sessionId),
                principal.authenticatedAt,
              ],
            ),
          );
        } else if (action === "verify-enable" || action === "cancel-setup") {
          if (!active || active["enrollment_id"] !== enrollmentId)
            throw conflict();
          if (
            action === "verify-enable" &&
            (active["state"] !== "ready" ||
              active["provider_session_sha256"] !== hash(principal.sessionId))
          )
            throw conflict();
          if (
            action === "cancel-setup" &&
            active["state"] !== "ready" &&
            active["state"] !== "starting"
          )
            throw conflict();
          selectedId = enrollmentId ?? null;
          await tx.query(
            sql(
              `UPDATE account_authenticator_enrollments SET last_attempt_id=$3::uuid,
            state=CASE WHEN $4='verify-enable' THEN 'verifying' ELSE state END
            WHERE principal_id=$1 AND enrollment_id=$2::uuid`,
              [principal.principalId, selectedId, attemptId, action],
            ),
          );
        } else if (active) {
          if (typeof active["enrollment_id"] !== "string") throw unavailable();
          selectedId = active["enrollment_id"];
          await tx.query(
            sql(
              "UPDATE account_authenticator_enrollments SET last_attempt_id=$3::uuid WHERE principal_id=$1 AND enrollment_id=$2::uuid",
              [principal.principalId, selectedId, attemptId],
            ),
          );
        }
        await tx.query(
          sql(
            "INSERT INTO account_authenticator_attempts(principal_id,attempt_id,action,enrollment_id) VALUES($1,$2::uuid,$3,$4::uuid)",
            [principal.principalId, attemptId, action, selectedId],
          ),
        );
        const current = await this.#active(tx, principal);
        return current ? enrollment(current, principal) : null;
      });
    } catch (error) {
      await this.#audit
        .finish(principal, attemptId, "rejected")
        .catch(() => undefined);
      throw error;
    }
  };
  assertCurrent: AccountAuthenticatorJournal["assertCurrent"] = (
    principal,
    attemptId,
  ) => {
    principal = Object.freeze({ ...principal });
    if (!accountCredentialAttemptV1Schema.safeParse(attemptId).success)
      return Promise.reject(denied());
    return this.#transaction(async (tx) => {
      await this.#assert(tx, principal, attemptId.toLowerCase());
    });
  };
  finish: AccountAuthenticatorJournal["finish"] = async (
    principal,
    attemptId,
    outcome,
  ) => {
    principal = Object.freeze({ ...principal });
    if (
      !accountCredentialAttemptV1Schema.safeParse(attemptId).success ||
      !accountCredentialOutcomeV1Schema.safeParse(outcome).success
    )
      throw unavailable();
    attemptId = attemptId.toLowerCase();
    await this.#transaction(async (tx) => {
      await lockAccountSessions(tx, principal.principalId);
      const mapped = await this.#mapped(tx, principal, attemptId);
      const completed = await tx.query(
        sql(
          "SELECT outcome FROM account_credential_outcomes WHERE principal_id=$1 AND attempt_id=$2::uuid",
          [principal.principalId, attemptId],
        ),
      );
      if (completed.rowCount !== 0) return;
      const row =
        outcome === "succeeded"
          ? await this.#assert(tx, principal, attemptId)
          : mapped;
      const action = actionSchema.parse(row["action"]);
      if (
        row["enrollment_id"] !== null &&
        row["last_attempt_id"] === attemptId &&
        row["state"] !== "confirmed" &&
        row["state"] !== "cancelled"
      ) {
        const next =
          outcome === "uncertain"
            ? "uncertain"
            : outcome === "succeeded"
              ? action === "start"
                ? "ready"
                : action === "verify-enable"
                  ? "confirmed"
                  : "cancelled"
              : action === "start"
                ? "cancelled"
                : action === "verify-enable"
                  ? "ready"
                  : row["state"];
        if (
          typeof next !== "string" ||
          typeof row["enrollment_id"] !== "string"
        )
          throw unavailable();
        await tx.query(
          sql(
            "UPDATE account_authenticator_enrollments SET state=$4 WHERE principal_id=$1 AND enrollment_id=$2::uuid AND last_attempt_id=$3::uuid",
            [principal.principalId, row["enrollment_id"], attemptId, next],
          ),
        );
      }
      await tx.query(
        sql(
          "INSERT INTO account_credential_outcomes(principal_id,attempt_id,outcome) VALUES($1,$2::uuid,$3)",
          [principal.principalId, attemptId, outcome],
        ),
      );
    });
    // Enrollment state and its immutable outcome commit together after provider I/O.
  };
}
