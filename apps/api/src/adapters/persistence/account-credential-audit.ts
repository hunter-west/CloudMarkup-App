import { createHash } from "node:crypto";
import { z } from "zod";
import {
  accountCredentialAttemptV1Schema,
  accountCredentialOutcomeV1Schema,
} from "@cloudmarkup/api-contract";
import type {
  AccountCredentialAudit,
  AccountContactSnapshot,
  AccountVerifiedContactProjection,
} from "../../application/account-credentials.js";
import { ApplicationError } from "../../application/errors.js";
import { requireRecentAuthentication } from "../../application/identity.js";
import type { PrincipalContext } from "../../application/ports.js";
import { cognitoSubjectSchema } from "../identity/cognito-subject.js";
import {
  accountSessionAllowed,
  lockAccountSessions,
} from "./account-sessions.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const actionSchema = z.enum([
  "password-change",
  "email-start",
  "email-confirm",
  "email-resend",
  "authenticator-start",
  "authenticator-verify-enable",
  "authenticator-cancel-setup",
  "authenticator-disable",
]);
const contactSchema = z
  .object({ subject: cognitoSubjectSchema, email: z.email().max(320) })
  .strict();
const projectedContactSchema = contactSchema.extend({
  email: z.email().max(320).nullable(),
});
const contactSnapshotSchema = z
  .object({
    email: z.email().max(320).nullable(),
    observedAt: z.iso.datetime(),
  })
  .strict();
const unavailable = () =>
  new ApplicationError(
    "service_unavailable",
    "Account security is temporarily unavailable.",
  );
const denied = () =>
  new ApplicationError(
    "authentication_required",
    "Sign in again to manage account security.",
  );
export async function accountCredentialAttemptCurrent(
  tx: SqlExecutor,
  principal: PrincipalContext,
  attemptId: string,
): Promise<boolean> {
  const result = await tx.query(
    sql(
      `SELECT EXISTS(
      SELECT 1 FROM account_credential_attempts a
      WHERE a.principal_id=$1 AND a.attempt_id=$2::uuid AND a.provider_session_sha256=$3
        AND a.started_at>clock_timestamp()-INTERVAL '2 minutes'
        AND NOT EXISTS(SELECT 1 FROM account_credential_outcomes o WHERE o.principal_id=a.principal_id AND o.attempt_id=a.attempt_id)
        AND NOT EXISTS(SELECT 1 FROM account_credential_attempts newer WHERE newer.principal_id=a.principal_id
          AND newer.attempt_id<>a.attempt_id AND newer.started_at>=a.started_at)
    ) AS current`,
      [principal.principalId, attemptId, digest(principal.sessionId)],
    ),
  );
  return result.rows[0]?.["current"] === true;
}
async function persistVerifiedContact(
  tx: SqlExecutor,
  principal: PrincipalContext,
  issuer: string,
  contact: { readonly subject: string; readonly email: string | null },
  expectedContact?: AccountContactSnapshot,
): Promise<boolean> {
  const updated = await tx.query(
    sql(
      `UPDATE principals p SET email=$4
      FROM principal_identity_references i
      WHERE p.principal_id=$1 AND p.lifecycle_status='active' AND i.principal_id=p.principal_id
        AND i.identity_provider='cognito' AND i.issuer=$2 AND i.subject_reference=$3
        AND ($5::boolean OR (p.email IS NOT DISTINCT FROM $6::varchar
          AND NOT EXISTS(SELECT 1 FROM account_credential_attempts a
            WHERE a.principal_id=p.principal_id AND a.started_at >= $7::timestamptz)))`,
      [
        principal.principalId,
        issuer,
        contact.subject,
        contact.email,
        expectedContact === undefined,
        expectedContact?.email ?? null,
        expectedContact?.observedAt ?? null,
      ],
    ),
  );
  return updated.rowCount === 1;
}

export class PostgresAccountCredentialAudit
  implements AccountCredentialAudit, AccountVerifiedContactProjection
{
  readonly database: SqlDatabase;
  readonly issuer: string;
  constructor(database: SqlDatabase, issuer: string) {
    this.database = database;
    this.issuer = issuer;
    if (
      !/^https:\/\/cognito-idp\.us-east-1\.amazonaws\.com\/us-east-1_[A-Za-z0-9]+$/u.test(
        issuer,
      )
    )
      throw new TypeError("Invalid account identity mapping.");
  }
  async #transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    try {
      return await this.database.transaction(work);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw unavailable();
    }
  }
  async #admit(tx: SqlExecutor, principal: PrincipalContext): Promise<void> {
    await lockAccountSessions(tx, principal.principalId);
    if (!(await accountSessionAllowed(tx, principal))) throw denied();
    requireRecentAuthentication(principal, new Date());
  }
  readContact: AccountVerifiedContactProjection["readContact"] = (
    principal,
  ) => {
    principal = Object.freeze({ ...principal });
    return this.#transaction(async (tx) => {
      await lockAccountSessions(tx, principal.principalId);
      if (!(await accountSessionAllowed(tx, principal))) throw denied();
      const result = await tx.query(
        sql(
          `SELECT p.email,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at
             FROM principals p WHERE p.principal_id=$1 AND p.lifecycle_status='active'
               AND NOT EXISTS(SELECT 1 FROM account_credential_attempts a
                 WHERE a.principal_id=p.principal_id AND a.started_at>clock_timestamp()-INTERVAL '2 minutes'
                   AND NOT EXISTS(SELECT 1 FROM account_credential_outcomes o
                     WHERE o.principal_id=a.principal_id AND o.attempt_id=a.attempt_id))`,
          [principal.principalId],
        ),
      );
      const row = result.rows[0];
      const snapshot = contactSnapshotSchema.safeParse({
        email: row?.["email"],
        observedAt: row?.["observed_at"],
      });
      if (!snapshot.success) throw unavailable();
      return snapshot.data;
    });
  };
  synchronizeVerifiedContact: AccountVerifiedContactProjection["synchronizeVerifiedContact"] =
    (principal, expectedContact, contact) => {
      principal = Object.freeze({ ...principal });
      const parsed = projectedContactSchema.safeParse(contact);
      const snapshot = contactSnapshotSchema.safeParse(expectedContact);
      if (!parsed.success || !snapshot.success)
        return Promise.reject(unavailable());
      return this.#transaction(async (tx) => {
        await lockAccountSessions(tx, principal.principalId);
        if (!(await accountSessionAllowed(tx, principal))) throw denied();
        // A delayed read must not overwrite a newer verified provider result.
        if (
          !(await persistVerifiedContact(
            tx,
            principal,
            this.issuer,
            parsed.data,
            snapshot.data,
          ))
        )
          throw unavailable();
      });
    };
  begin: AccountCredentialAudit["begin"] = (principal, attemptId, action) => {
    principal = Object.freeze({ ...principal });
    if (
      !accountCredentialAttemptV1Schema.safeParse(attemptId).success ||
      !actionSchema.safeParse(action).success ||
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(principal.correlationId)
    )
      return Promise.reject(
        new ApplicationError(
          "invalid_request",
          "The account security attempt is invalid.",
        ),
      );
    return this.#transaction(async (tx) => {
      await this.#admit(tx, principal);
      const duplicate = await tx.query(
        sql(
          "SELECT 1 FROM account_credential_attempts WHERE principal_id=$1 AND attempt_id=$2::uuid",
          [principal.principalId, attemptId],
        ),
      );
      if (duplicate.rowCount !== 0)
        throw new ApplicationError(
          "conflict",
          "This attempt has already been submitted. Refresh account security before starting another change.",
        );
      const active = await tx.query(
        sql(
          `SELECT 1 FROM account_credential_attempts a
        WHERE a.principal_id=$1 AND a.started_at>clock_timestamp()-INTERVAL '2 minutes'
        AND NOT EXISTS(SELECT 1 FROM account_credential_outcomes o WHERE o.principal_id=a.principal_id AND o.attempt_id=a.attempt_id)
        LIMIT 1`,
          [principal.principalId],
        ),
      );
      if (active.rowCount !== 0)
        throw new ApplicationError(
          "conflict",
          "Another account security change is still being checked. Wait before starting a new attempt.",
        );
      const recent = await tx.query(
        sql(
          "SELECT count(*)>=12 AS limited FROM account_credential_attempts WHERE principal_id=$1 AND started_at>clock_timestamp()-INTERVAL '10 minutes'",
          [principal.principalId],
        ),
      );
      const limited = recent.rows[0]?.["limited"];
      if (typeof limited !== "boolean") throw unavailable();
      if (limited)
        throw new ApplicationError(
          "rate_limited",
          "Too many account security attempts. Wait before trying again.",
        );
      await tx.query(
        sql(
          `INSERT INTO account_credential_attempts(principal_id,attempt_id,action,provider_session_sha256,correlation_id)
        VALUES($1,$2::uuid,$3,$4,$5)`,
          [
            principal.principalId,
            attemptId,
            action,
            digest(principal.sessionId),
            principal.correlationId,
          ],
        ),
      );
    });
  };
  assertCurrent: AccountCredentialAudit["assertCurrent"] = (
    principal,
    attemptId,
  ) => {
    principal = Object.freeze({ ...principal });
    if (!accountCredentialAttemptV1Schema.safeParse(attemptId).success)
      return Promise.reject(denied());
    return this.#transaction(async (tx) => {
      await this.#admit(tx, principal);
      if (!(await accountCredentialAttemptCurrent(tx, principal, attemptId)))
        throw new ApplicationError(
          "conflict",
          "This account security attempt is no longer current.",
        );
    });
  };
  finish: AccountCredentialAudit["finish"] = (
    principal,
    attemptId,
    outcome,
    verifiedContact,
  ) => {
    principal = Object.freeze({ ...principal });
    const contact =
      verifiedContact === undefined
        ? undefined
        : contactSchema.safeParse(verifiedContact);
    if (
      !accountCredentialAttemptV1Schema.safeParse(attemptId).success ||
      !accountCredentialOutcomeV1Schema.safeParse(outcome).success ||
      (contact !== undefined && (!contact.success || outcome !== "succeeded"))
    )
      return Promise.reject(unavailable());
    return this.#transaction(async (tx) => {
      await lockAccountSessions(tx, principal.principalId);
      const attempt = await tx.query(
        sql(
          "SELECT 1 FROM account_credential_attempts WHERE principal_id=$1 AND attempt_id=$2::uuid AND provider_session_sha256=$3",
          [principal.principalId, attemptId, digest(principal.sessionId)],
        ),
      );
      if (attempt.rowCount !== 1) throw denied();
      const completed = await tx.query(
        sql(
          "SELECT outcome FROM account_credential_outcomes WHERE principal_id=$1 AND attempt_id=$2::uuid",
          [principal.principalId, attemptId],
        ),
      );
      if (completed.rowCount !== 0) return;
      if (outcome === "succeeded") {
        if (
          !(await accountSessionAllowed(tx, principal)) ||
          !(await accountCredentialAttemptCurrent(tx, principal, attemptId))
        )
          throw denied();
        if (contact?.success) {
          if (
            !(await persistVerifiedContact(
              tx,
              principal,
              this.issuer,
              contact.data,
            ))
          )
            throw denied();
        }
      }
      await tx.query(
        sql(
          "INSERT INTO account_credential_outcomes(principal_id,attempt_id,outcome) VALUES($1,$2::uuid,$3)",
          [principal.principalId, attemptId, outcome],
        ),
      );
    });
  };
}
