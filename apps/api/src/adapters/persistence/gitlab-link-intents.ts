import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApplicationError } from "../../application/errors.js";
import type { GitLabConnectionAuthority } from "./gitlab-connection-authority.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";

const applicationIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const intentIdSchema = z.string().regex(/^gitlablink_[a-f0-9]{32}$/u);
const stateSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const intentSchema = z
  .object({
    intentId: intentIdSchema,
    connectionId: z.string().regex(/^gitlab_[a-f0-9]{32}$/u),
    expiresAt: z.iso.datetime(),
    status: z.enum(["pending", "consumed", "completed"]),
  })
  .strict();
export type GitLabLinkIntent = z.output<typeof intentSchema>;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const invalid = (): never => {
  throw new ApplicationError(
    "invalid_request",
    "The GitLab connection request is invalid.",
  );
};
const unavailable = (): never => {
  throw new ApplicationError(
    "conflict",
    "Start a new GitLab connection attempt.",
  );
};
function map(row: SqlRow | undefined): GitLabLinkIntent {
  if (!row) return unavailable();
  return intentSchema.parse({
    intentId: row["intent_id"],
    connectionId: row["connection_id"],
    expiresAt: row["expires_at"],
    status: row["lifecycle_status"],
  });
}
const projection = `intent_id,connection_id,lifecycle_status,to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at`;

/** Consumes the durable intent before any provider exchange; no replay can repeat the exchange. */
export class PostgresGitLabLinkIntents {
  readonly #authority: GitLabConnectionAuthority;
  readonly #applicationId: string;
  constructor(authority: GitLabConnectionAuthority, applicationId: string) {
    if (!applicationIdSchema.safeParse(applicationId).success) invalid();
    this.#authority = authority;
    this.#applicationId = applicationId;
  }
  #scope(): readonly string[] {
    return [
      this.#authority.organizationId,
      this.#authority.principal.principalId,
      this.#applicationId,
      digest(this.#authority.principal.sessionId),
    ];
  }
  async #audit(
    tx: SqlExecutor,
    intentId: string,
    action: "start" | "consume",
  ): Promise<void> {
    await tx.query(
      sql(
        `INSERT INTO audit_events(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id)
       VALUES($1,$2,$3,$4,'integration',$5,'succeeded',$6,$7)`,
        [
          "audit_" + randomUUID(),
          this.#authority.organizationId,
          this.#authority.principal.principalId,
          "gitlab.connection." + action,
          intentId,
          action === "start"
            ? "Started a GitLab connection attempt."
            : "Consumed a GitLab connection attempt.",
          this.#authority.principal.correlationId,
        ],
      ),
    );
  }
  start(state: string): Promise<GitLabLinkIntent> {
    if (!stateSchema.safeParse(state).success)
      return Promise.reject(
        new ApplicationError(
          "invalid_request",
          "The GitLab connection request is invalid.",
        ),
      );
    const stateHash = digest(state);
    return this.#authority.transaction("integrations.manage", async (tx) => {
      const active = await tx.query(
        sql(
          "SELECT count(*)::int AS count FROM gitlab_oauth_link_intents WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND lifecycle_status='pending' AND expires_at>clock_timestamp()",
          this.#scope().slice(0, 3),
        ),
      );
      if (Number(active.rows[0]?.["count"]) >= 10)
        throw new ApplicationError(
          "rate_limited",
          "Wait for earlier GitLab connection attempts to expire.",
        );
      const intentId = "gitlablink_" + randomUUID().replaceAll("-", "");
      const connectionId = "gitlab_" + randomUUID().replaceAll("-", "");
      const result = await tx.query(
        sql(
          `INSERT INTO gitlab_oauth_link_intents(organization_id,principal_id,application_id,session_sha256,intent_id,connection_id,state_sha256,created_at,expires_at)
         SELECT $1,$2,$3,$4,$5,$6,$7,t.now,t.now+INTERVAL '10 minutes' FROM (SELECT clock_timestamp() AS now) t RETURNING ${projection}`,
          [...this.#scope(), intentId, connectionId, stateHash],
        ),
      );
      await this.#audit(tx, intentId, "start");
      return map(result.rows[0]);
    });
  }
  consume(intentId: string, state: string): Promise<GitLabLinkIntent> {
    if (
      !intentIdSchema.safeParse(intentId).success ||
      !stateSchema.safeParse(state).success
    )
      invalid();
    const stateHash = digest(state);
    return this.#authority.transaction("integrations.manage", async (tx) => {
      const result = await tx.query(
        sql(
          `UPDATE gitlab_oauth_link_intents SET lifecycle_status='consumed',consumed_at=clock_timestamp()
         WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND session_sha256=$4 AND intent_id=$5 AND state_sha256=$6
         AND lifecycle_status='pending' AND expires_at>clock_timestamp() RETURNING ${projection}`,
          [...this.#scope(), intentId, stateHash],
        ),
      );
      const intent = map(result.rows[0]);
      await this.#audit(tx, intentId, "consume");
      return intent;
    });
  }
  inspect(intentId: string): Promise<GitLabLinkIntent> {
    if (!intentIdSchema.safeParse(intentId).success) invalid();
    return this.#authority.transaction("integrations.manage", async (tx) =>
      map(
        (
          await tx.query(
            sql(
              `SELECT ${projection} FROM gitlab_oauth_link_intents
       WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND session_sha256=$4 AND intent_id=$5`,
              [...this.#scope(), intentId],
            ),
          )
        ).rows[0],
      ),
    );
  }
}
