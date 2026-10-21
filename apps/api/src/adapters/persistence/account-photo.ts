import { createHash } from "node:crypto";
import {
  accountPhotoV1Schema,
  updateAccountPhotoV1Schema,
  type AccountPhotoV1,
} from "@cloudmarkup/api-contract";
import type { AccountPhotoApplication } from "../../application/account-photo.js";
import { ApplicationError } from "../../application/errors.js";
import { requireRecentAuthentication } from "../../application/identity.js";
import type {
  PrincipalContext,
  VersionedResult,
} from "../../application/ports.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";

function verify(principal: PrincipalContext, write: boolean) {
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
}
export class PostgresAccountPhoto implements AccountPhotoApplication {
  readonly #database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.#database = database;
  }
  async #current(
    tx: SqlExecutor,
    principal: PrincipalContext,
    write: boolean,
  ): Promise<VersionedResult<AccountPhotoV1>> {
    verify(principal, write);
    const active = await tx.query(
      sql(
        `SELECT principal_id FROM principals WHERE principal_id=$1 AND lifecycle_status='active' AND $2::timestamptz>clock_timestamp() FOR ${write ? "UPDATE" : "SHARE"}`,
        [principal.principalId, principal.expiresAt],
      ),
    );
    verify(principal, write);
    if (!active.rows[0])
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
    // Base64 projection works with both pg and the existing RDS Data API scalar adapter.
    const result = await tx.query(
      sql(
        "SELECT record_version,replace(encode(image_bytes,'base64'),E'\\n','') AS encoded FROM principal_account_photos WHERE principal_id=$1",
        [principal.principalId],
      ),
    );
    verify(principal, write);
    const row = result.rows[0];
    const encoded = row?.["encoded"];
    if (encoded != null && typeof encoded !== "string")
      throw Error("Invalid stored photo encoding");
    const value = accountPhotoV1Schema.parse({
      contractVersion: 1,
      principalId: principal.principalId,
      version: Number(row?.["record_version"] ?? 0),
      image: encoded == null ? null : "data:image/png;base64," + encoded,
    });
    const actor = createHash("sha256")
      .update(principal.principalId)
      .digest("hex")
      .slice(0, 32);
    return { value, etag: `"photo:${actor}:${String(value.version)}"` };
  }
  get: AccountPhotoApplication["get"] = (principal) => {
    const actor = Object.freeze({ ...principal });
    return this.#database.transaction((tx) => this.#current(tx, actor, false));
  };
  update: AccountPhotoApplication["update"] = (
    principal,
    input,
    expectedEtag,
  ) => {
    const actor = Object.freeze({ ...principal });
    const parsed = updateAccountPhotoV1Schema.safeParse(input);
    if (!parsed.success)
      return Promise.reject(
        new ApplicationError(
          "invalid_request",
          "The photo request is invalid.",
        ),
      );
    return this.#database.transaction(async (tx) => {
      const before = await this.#current(tx, actor, true);
      if (before.etag !== expectedEtag)
        throw new ApplicationError(
          "precondition_failed",
          "Your photo changed. Reload it before saving again.",
        );
      const bytes =
        parsed.data.image === null
          ? null
          : (await import("./account-photo-raster.js")).canonicalAccountPhoto(
              parsed.data.image,
            );
      verify(actor, true);
      const image =
        bytes === null
          ? null
          : "data:image/png;base64," + bytes.toString("base64");
      if (before.value.image === image) return before;
      const version = before.value.version + 1;
      await tx.query(
        sql(
          "INSERT INTO principal_account_photos(principal_id,record_version,image_bytes) VALUES($1,$2,$3) ON CONFLICT(principal_id) DO UPDATE SET record_version=EXCLUDED.record_version,image_bytes=EXCLUDED.image_bytes,updated_at=clock_timestamp()",
          [actor.principalId, version, bytes],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO principal_account_photo_events(principal_id,record_version,action,correlation_id) VALUES($1,$2,$3,$4)",
          [
            actor.principalId,
            version,
            bytes === null ? "removed" : "changed",
            actor.correlationId,
          ],
        ),
      );
      // Includes expiry/recent-auth verification after all writes. Failure rolls everything back.
      return this.#current(tx, actor, true);
    });
  };
}
