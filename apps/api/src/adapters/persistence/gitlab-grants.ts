import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApplicationError } from "../../application/errors.js";
import {
  gitLabGrantBindingDigestV1,
  gitLabGrantBindingV1Schema,
  gitLabSealedGrantV1Schema,
  type GitLabGrantBindingV1,
  type GitLabSealedGrantV1,
} from "../gitlab-grant-vault.js";
import type { GitLabConnectionAuthority } from "./gitlab-connection-authority.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";

const idSchema = z.string().regex(/^gitlab_[a-f0-9]{32}$/u);
const intentSchema = z.string().regex(/^gitlablink_[a-f0-9]{32}$/u);
const attemptSchema = z.string().regex(/^gitlabrefresh_[a-f0-9]{32}$/u);
const versionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const metadata = z
  .object({
    providerUserId: versionSchema,
    username: z.string().min(1).max(255),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const stateSchema = z.enum([
  "active",
  "refreshing",
  "reconnect-required",
  "disconnected",
  "revoked",
]);
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const conflict = (): never => {
  throw new ApplicationError(
    "conflict",
    "The GitLab connection changed. Reload its status before continuing.",
  );
};
const invalid = (): never => {
  throw new ApplicationError(
    "invalid_request",
    "The GitLab connection request is invalid.",
  );
};
const missing = (): never => {
  throw new ApplicationError(
    "not_found",
    "The GitLab connection is unavailable.",
  );
};
type GrantMetadata = z.output<typeof metadata>;
/** Server-only record. HTTP routes must project explicit credential-free public metadata. */
export interface StoredGitLabGrant {
  readonly binding: GitLabGrantBindingV1;
  readonly username: string;
  readonly expiresAt: string;
  readonly status: z.output<typeof stateSchema>;
  readonly recordVersion: number;
  readonly providerRevocationUncertain: boolean;
  readonly refreshExpired: boolean;
  readonly sealedGrant: GitLabSealedGrantV1 | null;
  readonly refreshAttemptId: string | null;
}
const projection = `connection_id,provider_user_id,provider_username,grant_version,record_version,lifecycle_status,sealed_grant,refresh_attempt_id,provider_revocation_uncertain,
  COALESCE(lifecycle_status='refreshing' AND refresh_deadline<=clock_timestamp(),FALSE) AS refresh_expired,
  to_char(grant_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at`;

/** Transactional grant lifecycle. No SQL lock is retained across KMS or provider I/O. */
export class PostgresGitLabGrants {
  readonly #authority: GitLabConnectionAuthority;
  readonly #applicationId: string;
  constructor(authority: GitLabConnectionAuthority, applicationId: string) {
    if (!/^[a-f0-9]{64}$/u.test(applicationId)) invalid();
    this.#authority = authority;
    this.#applicationId = applicationId;
  }
  #scope(): readonly string[] {
    return [
      this.#authority.organizationId,
      this.#authority.principal.principalId,
      this.#applicationId,
    ];
  }
  #binding(
    connectionId: string,
    providerUserId: number,
    grantVersion: number,
  ): GitLabGrantBindingV1 {
    return gitLabGrantBindingV1Schema.parse({
      schemaVersion: 1,
      applicationId: this.#applicationId,
      organizationId: this.#authority.organizationId,
      principalId: this.#authority.principal.principalId,
      connectionId,
      providerUserId,
      grantVersion,
    });
  }
  #sealed(
    binding: GitLabGrantBindingV1,
    input: GitLabSealedGrantV1,
  ): GitLabSealedGrantV1 {
    const parsed = gitLabSealedGrantV1Schema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.bindingSha256 !== gitLabGrantBindingDigestV1(binding)
    )
      return invalid();
    return parsed.data;
  }
  #map(row: SqlRow | undefined): StoredGitLabGrant {
    if (!row) return missing();
    const binding = this.#binding(
      idSchema.parse(row["connection_id"]),
      Number(row["provider_user_id"]),
      Number(row["grant_version"]),
    );
    const details = metadata.parse({
      providerUserId: binding.providerUserId,
      username: row["provider_username"],
      expiresAt: row["expires_at"],
    });
    const status = stateSchema.parse(row["lifecycle_status"]);
    const sealedGrant =
      row["sealed_grant"] === null
        ? null
        : this.#sealed(
            binding,
            gitLabSealedGrantV1Schema.parse(row["sealed_grant"]),
          );
    if ((status === "revoked") !== (sealedGrant === null)) invalid();
    return {
      binding,
      username: details.username,
      expiresAt: details.expiresAt,
      status,
      recordVersion: versionSchema.parse(Number(row["record_version"])),
      refreshExpired: z.boolean().parse(row["refresh_expired"]),
      providerRevocationUncertain: z
        .boolean()
        .parse(row["provider_revocation_uncertain"]),
      sealedGrant,
      refreshAttemptId:
        row["refresh_attempt_id"] === null
          ? null
          : attemptSchema.parse(row["refresh_attempt_id"]),
    };
  }
  async #audit(
    tx: SqlExecutor,
    connectionId: string,
    action:
      | "connect"
      | "refresh-claim"
      | "refresh-complete"
      | "refresh-unknown"
      | "disconnect"
      | "revoke",
  ): Promise<void> {
    await tx.query(
      sql(
        `INSERT INTO audit_events(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id)
      VALUES($1,$2,$3,$4,'integration',$5,'succeeded','Updated GitLab connection state.',$6)`,
        [
          "audit_" + randomUUID(),
          this.#authority.organizationId,
          this.#authority.principal.principalId,
          "gitlab.connection." + action,
          connectionId,
          this.#authority.principal.correlationId,
        ],
      ),
    );
  }
  async #read(
    tx: SqlExecutor,
    connectionId: string,
    lock = false,
  ): Promise<StoredGitLabGrant> {
    return this.#map(
      (
        await tx.query(
          sql(
            `SELECT ${projection} FROM gitlab_oauth_connections WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND connection_id=$4${lock ? " FOR UPDATE" : ""}`,
            [...this.#scope(), connectionId],
          ),
        )
      ).rows[0],
    );
  }
  completeLink(
    intentId: string,
    connectionId: string,
    input: GrantMetadata,
    envelope: GitLabSealedGrantV1,
  ): Promise<StoredGitLabGrant> {
    if (
      !intentSchema.safeParse(intentId).success ||
      !idSchema.safeParse(connectionId).success
    )
      invalid();
    const parsedDetails = metadata.safeParse(input);
    if (!parsedDetails.success) return invalid();
    const details = parsedDetails.data;
    const sealed = this.#sealed(
      this.#binding(connectionId, details.providerUserId, 1),
      envelope,
    );
    return this.#authority.transaction("integrations.manage", async (tx) => {
      const intent = await tx.query(
        sql(
          `UPDATE gitlab_oauth_link_intents SET lifecycle_status='completed',completed_at=clock_timestamp()
        WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND session_sha256=$4 AND intent_id=$5 AND connection_id=$6
        AND lifecycle_status='consumed' AND expires_at>clock_timestamp() RETURNING intent_id`,
          [
            ...this.#scope(),
            digest(this.#authority.principal.sessionId),
            intentId,
            connectionId,
          ],
        ),
      );
      if (intent.rowCount !== 1) conflict();
      const result = await tx.query(
        sql(
          `INSERT INTO gitlab_oauth_connections(organization_id,principal_id,application_id,connection_id,intent_id,provider_user_id,provider_username,grant_expires_at,sealed_grant)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::jsonb WHERE $8::timestamptz>clock_timestamp() AND $8::timestamptz<=clock_timestamp()+INTERVAL '1 day' RETURNING ${projection}`,
          [
            ...this.#scope(),
            connectionId,
            intentId,
            details.providerUserId,
            details.username,
            details.expiresAt,
            JSON.stringify(sealed),
          ],
        ),
      );
      if (result.rowCount !== 1) conflict();
      await this.#audit(tx, connectionId, "connect");
      return this.#map(result.rows[0]);
    });
  }
  get(connectionId: string): Promise<StoredGitLabGrant> {
    if (!idSchema.safeParse(connectionId).success) invalid();
    return this.#authority.transaction("integrations.read", (tx) =>
      this.#read(tx, connectionId),
    );
  }
  list(
    limit = 50,
    cursor = "",
  ): Promise<{
    readonly items: readonly StoredGitLabGrant[];
    readonly nextCursor?: string;
  }> {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (cursor !== "" && !idSchema.safeParse(cursor).success)
    )
      invalid();
    return this.#authority.transaction("integrations.read", async (tx) => {
      const result = await tx.query(
        sql(
          "SELECT " +
            projection +
            " FROM gitlab_oauth_connections WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND connection_id>$4 ORDER BY connection_id LIMIT $5",
          [...this.#scope(), cursor, limit + 1],
        ),
      );
      const items = result.rows.slice(0, limit).map((row) => this.#map(row));
      const nextCursor = items.at(-1)?.binding.connectionId;
      return {
        items,
        ...(result.rows.length > limit && nextCursor ? { nextCursor } : {}),
      };
    });
  }
  assertUsable(connectionId: string, grantVersion: number): Promise<void> {
    if (
      !idSchema.safeParse(connectionId).success ||
      !versionSchema.safeParse(grantVersion).success
    )
      invalid();
    return this.#authority.transaction("integrations.read", async (tx) => {
      const result = await tx.query(
        sql(
          `SELECT connection_id FROM gitlab_oauth_connections WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND connection_id=$4
        AND grant_version=$5 AND lifecycle_status='active' AND grant_expires_at>clock_timestamp()`,
          [...this.#scope(), connectionId, grantVersion],
        ),
      );
      if (result.rows.length !== 1) conflict();
    });
  }
  claimRefresh(
    connectionId: string,
    grantVersion: number,
  ): Promise<StoredGitLabGrant> {
    if (
      !idSchema.safeParse(connectionId).success ||
      !versionSchema.safeParse(grantVersion).success
    )
      invalid();
    const attemptId = "gitlabrefresh_" + randomUUID().replaceAll("-", "");
    return this.#authority.transaction("integrations.read", async (tx) => {
      const result = await tx.query(
        sql(
          `UPDATE gitlab_oauth_connections SET lifecycle_status='refreshing',record_version=record_version+1,updated_at=clock_timestamp(),
        refresh_attempt_id=$6,refresh_session_sha256=$7,refresh_deadline=clock_timestamp()+INTERVAL '45 seconds'
        WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND connection_id=$4 AND grant_version=$5 AND lifecycle_status='active' RETURNING ${projection}`,
          [
            ...this.#scope(),
            connectionId,
            grantVersion,
            attemptId,
            digest(this.#authority.principal.sessionId),
          ],
        ),
      );
      if (result.rowCount !== 1) conflict();
      await this.#audit(tx, connectionId, "refresh-claim");
      return this.#map(result.rows[0]);
    });
  }
  assertRefreshCurrent(
    connectionId: string,
    grantVersion: number,
    attemptId: string,
  ): Promise<void> {
    if (
      !idSchema.safeParse(connectionId).success ||
      !versionSchema.safeParse(grantVersion).success ||
      !attemptSchema.safeParse(attemptId).success
    )
      invalid();
    return this.#authority.transaction("integrations.read", async (tx) => {
      const result = await tx.query(
        sql(
          `SELECT connection_id FROM gitlab_oauth_connections WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND connection_id=$4
        AND grant_version=$5 AND lifecycle_status='refreshing' AND refresh_attempt_id=$6 AND refresh_session_sha256=$7 AND refresh_deadline>clock_timestamp()`,
          [
            ...this.#scope(),
            connectionId,
            grantVersion,
            attemptId,
            digest(this.#authority.principal.sessionId),
          ],
        ),
      );
      if (result.rows.length !== 1) conflict();
    });
  }
  completeRefresh(
    connectionId: string,
    grantVersion: number,
    attemptId: string,
    input: GrantMetadata,
    envelope: GitLabSealedGrantV1,
  ): Promise<StoredGitLabGrant> {
    if (
      !idSchema.safeParse(connectionId).success ||
      !versionSchema.safeParse(grantVersion).success ||
      !attemptSchema.safeParse(attemptId).success
    )
      invalid();
    const details = metadata.parse(input);
    const sealed = this.#sealed(
      this.#binding(connectionId, details.providerUserId, grantVersion + 1),
      envelope,
    );
    return this.#authority.transaction("integrations.read", async (tx) => {
      const result = await tx.query(
        sql(
          `UPDATE gitlab_oauth_connections SET lifecycle_status='active',grant_version=grant_version+1,record_version=record_version+1,updated_at=clock_timestamp(),
        provider_username=$8,grant_expires_at=$9::timestamptz,sealed_grant=$10::jsonb
        WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND connection_id=$4 AND grant_version=$5 AND lifecycle_status='refreshing'
        AND refresh_attempt_id=$6 AND refresh_session_sha256=$7 AND refresh_deadline>clock_timestamp() AND provider_user_id=$11
        AND $9::timestamptz>clock_timestamp() AND $9::timestamptz<=clock_timestamp()+INTERVAL '1 day' RETURNING ${projection}`,
          [
            ...this.#scope(),
            connectionId,
            grantVersion,
            attemptId,
            digest(this.#authority.principal.sessionId),
            details.username,
            details.expiresAt,
            JSON.stringify(sealed),
            details.providerUserId,
          ],
        ),
      );
      if (result.rowCount !== 1) conflict();
      await this.#audit(tx, connectionId, "refresh-complete");
      return this.#map(result.rows[0]);
    });
  }
  markRefreshUnknown(
    connectionId: string,
    grantVersion: number,
    attemptId: string,
  ): Promise<StoredGitLabGrant> {
    if (
      !idSchema.safeParse(connectionId).success ||
      !versionSchema.safeParse(grantVersion).success ||
      !attemptSchema.safeParse(attemptId).success
    )
      invalid();
    return this.#authority.transaction("integrations.read", async (tx) => {
      const result = await tx.query(
        sql(
          `UPDATE gitlab_oauth_connections SET lifecycle_status='reconnect-required',provider_revocation_uncertain=TRUE,record_version=record_version+1,updated_at=clock_timestamp()
        WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND connection_id=$4 AND grant_version=$5 AND lifecycle_status='refreshing'
        AND refresh_attempt_id=$6 AND (refresh_session_sha256=$7 OR refresh_deadline<=clock_timestamp()) RETURNING ${projection}`,
          [
            ...this.#scope(),
            connectionId,
            grantVersion,
            attemptId,
            digest(this.#authority.principal.sessionId),
          ],
        ),
      );
      if (result.rowCount !== 1) conflict();
      await this.#audit(tx, connectionId, "refresh-unknown");
      return this.#map(result.rows[0]);
    });
  }
  disconnect(connectionId: string): Promise<StoredGitLabGrant> {
    if (!idSchema.safeParse(connectionId).success) invalid();
    return this.#authority.transaction("integrations.manage", async (tx) => {
      const current = await this.#read(tx, connectionId, true);
      if (current.status === "disconnected" || current.status === "revoked")
        return current;
      const result = await tx.query(
        sql(
          `UPDATE gitlab_oauth_connections SET provider_revocation_uncertain=provider_revocation_uncertain OR lifecycle_status='refreshing',lifecycle_status='disconnected',record_version=record_version+1,updated_at=clock_timestamp()
        WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND connection_id=$4 RETURNING ${projection}`,
          [...this.#scope(), connectionId],
        ),
      );
      await this.#audit(tx, connectionId, "disconnect");
      return this.#map(result.rows[0]);
    });
  }
  confirmRevoked(
    connectionId: string,
    grantVersion: number,
  ): Promise<StoredGitLabGrant> {
    if (
      !idSchema.safeParse(connectionId).success ||
      !versionSchema.safeParse(grantVersion).success
    )
      invalid();
    return this.#authority.transaction("integrations.manage", async (tx) => {
      const current = await this.#read(tx, connectionId, true);
      if (current.binding.grantVersion !== grantVersion) conflict();
      if (current.status === "revoked") return current;
      if (
        current.status !== "disconnected" ||
        current.providerRevocationUncertain
      )
        conflict();
      const result = await tx.query(
        sql(
          `UPDATE gitlab_oauth_connections SET lifecycle_status='revoked',sealed_grant=NULL,record_version=record_version+1,updated_at=clock_timestamp()
        WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND connection_id=$4 RETURNING ${projection}`,
          [...this.#scope(), connectionId],
        ),
      );
      await this.#audit(tx, connectionId, "revoke");
      return this.#map(result.rows[0]);
    });
  }
}
