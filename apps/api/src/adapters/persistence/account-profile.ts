import { createHash } from "node:crypto";
import {
  accountProfileV1Schema,
  updateAccountProfileV1Schema,
  type AccountProfileV1,
} from "@cloudmarkup/api-contract";
import type { AccountProfileApplication } from "../../application/account-profile.js";
import { ApplicationError } from "../../application/errors.js";
import { requireRecentAuthentication } from "../../application/identity.js";
import type {
  PrincipalContext,
  VersionedResult,
} from "../../application/ports.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";

function etag(profile: AccountProfileV1): string {
  const actor = createHash("sha256")
    .update(profile.principalId)
    .digest("hex")
    .slice(0, 32);
  return `"profile:${actor}:${String(profile.version)}"`;
}
export class PostgresAccountProfile implements AccountProfileApplication {
  readonly #database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.#database = database;
  }
  async #current(
    tx: SqlExecutor,
    principal: PrincipalContext,
    write: boolean,
  ): Promise<VersionedResult<AccountProfileV1>> {
    const now = new Date();
    if (
      !Number.isFinite(Date.parse(principal.expiresAt)) ||
      Date.parse(principal.expiresAt) <= now.getTime()
    )
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
    if (write) requireRecentAuthentication(principal, now);
    const result = await tx.query(
      sql(
        `SELECT principal_id,display_name,public_username,profile_record_version FROM principals
       WHERE principal_id=$1 AND lifecycle_status='active' AND $2::timestamptz>clock_timestamp()
       FOR ${write ? "UPDATE" : "SHARE"}`,
        [principal.principalId, principal.expiresAt],
      ),
    );
    // Lock acquisition can outlive both token expiry and the recent-auth window.
    const afterLock = new Date();
    if (Date.parse(principal.expiresAt) <= afterLock.getTime())
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
    if (write) requireRecentAuthentication(principal, afterLock);
    const row = result.rows[0];
    if (!row)
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
    const value = accountProfileV1Schema.parse({
      contractVersion: 1,
      principalId: row["principal_id"],
      displayName: row["display_name"],
      username: row["public_username"],
      version: Number(row["profile_record_version"]),
    });
    return { value, etag: etag(value) };
  }
  get: AccountProfileApplication["get"] = (principal) => {
    principal = Object.freeze({ ...principal });
    return this.#database.transaction((tx) =>
      this.#current(tx, principal, false),
    );
  };
  update: AccountProfileApplication["update"] = (
    principal,
    input,
    expectedEtag,
  ) => {
    principal = Object.freeze({ ...principal });
    const parsed = updateAccountProfileV1Schema.safeParse(input);
    if (!parsed.success)
      return Promise.reject(
        new ApplicationError(
          "invalid_request",
          "The profile request is invalid.",
        ),
      );
    const value = parsed.data;
    return this.#database.transaction(async (tx) => {
      const before = await this.#current(tx, principal, true);
      if (before.etag !== expectedEtag)
        throw new ApplicationError(
          "precondition_failed",
          "Your profile changed. Reload it before saving again.",
        );
      if (
        before.value.displayName === value.displayName &&
        before.value.username === value.username
      )
        return before;
      if (value.username !== null) {
        await tx.query(
          sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
            "account-username:" + value.username,
          ]),
        );
        const used = await tx.query(
          sql(
            "SELECT principal_id FROM principals WHERE public_username=$1 AND principal_id<>$2",
            [value.username, principal.principalId],
          ),
        );
        if (used.rows.length > 0)
          throw new ApplicationError(
            "conflict",
            "This username is unavailable.",
            {
              fieldIssues: [
                {
                  code: "account.username-unavailable",
                  path: ["username"],
                  message: "Choose another username.",
                },
              ],
            },
          );
      }
      await tx.query(
        sql(
          "UPDATE principals SET display_name=$2,public_username=$3,profile_record_version=profile_record_version+1,updated_at=clock_timestamp() WHERE principal_id=$1",
          [principal.principalId, value.displayName, value.username],
        ),
      );
      const after = await this.#current(tx, principal, true);
      await tx.query(
        sql(
          "INSERT INTO principal_profile_events(principal_id,profile_record_version,display_name_changed,username_changed,correlation_id) VALUES($1,$2,$3,$4,$5)",
          [
            principal.principalId,
            after.value.version,
            before.value.displayName !== value.displayName,
            before.value.username !== value.username,
            principal.correlationId,
          ],
        ),
      );
      // Recheck expiry/recent authentication after all writes; failure rolls back the transaction.
      await this.#current(tx, principal, true);
      return after;
    });
  };
}
