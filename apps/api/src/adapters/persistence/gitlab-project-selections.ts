import { randomUUID } from "node:crypto";
import {
  gitlabConnectionIdV1Schema,
  gitlabProjectIdV1Schema,
  gitlabProjectSelectionV1Schema,
  gitlabProjectSelectionListQueryV1Schema,
  updateGitlabProjectSelectionV1Schema,
  type GitlabProjectSelectionV1,
  type UpdateGitlabProjectSelectionV1,
} from "@cloudmarkup/api-contract";
import { ApplicationError } from "../../application/errors.js";
import type { GitLabConnectionAuthority } from "./gitlab-connection-authority.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";

function changed(): never {
  throw new ApplicationError(
    "conflict",
    "GitLab project access changed. Reload the selected projects before continuing.",
  );
}
function invalid(): never {
  throw new ApplicationError(
    "invalid_request",
    "The GitLab project selection is invalid.",
  );
}
/** Actor-owned application restriction. Provider authority is rechecked separately on every repository use. */
export class PostgresGitLabProjectSelections {
  private readonly authority: GitLabConnectionAuthority;
  private readonly applicationId: string;
  constructor(authority: GitLabConnectionAuthority, applicationId: string) {
    this.authority = authority;
    this.applicationId = applicationId;
    if (!/^[a-f0-9]{64}$/u.test(applicationId)) invalid();
  }
  private scope(connectionId: string) {
    if (!gitlabConnectionIdV1Schema.safeParse(connectionId).success) invalid();
    return [
      this.authority.organizationId,
      this.authority.principal.principalId,
      this.applicationId,
      connectionId,
    ] as const;
  }
  private async connection(
    tx: SqlExecutor,
    connectionId: string,
    usable: boolean,
    grantVersion?: number,
  ) {
    const row = (
      await tx.query(
        sql(
          `SELECT lifecycle_status,grant_version,grant_expires_at>clock_timestamp() AS unexpired
      FROM gitlab_oauth_connections WHERE organization_id=$1 AND principal_id=$2 AND application_id=$3 AND connection_id=$4 FOR UPDATE`,
          this.scope(connectionId),
        ),
      )
    ).rows[0];
    if (!row)
      throw new ApplicationError(
        "not_found",
        "The GitLab connection is unavailable.",
      );
    if (
      usable &&
      (row["lifecycle_status"] !== "active" ||
        row["unexpired"] !== true ||
        (grantVersion !== undefined &&
          Number(row["grant_version"]) !== grantVersion))
    )
      changed();
  }
  private map(connectionId: string, row: SqlRow): GitlabProjectSelectionV1 {
    return gitlabProjectSelectionV1Schema.parse({
      contractVersion: 1,
      organizationId: this.authority.organizationId,
      principalId: this.authority.principal.principalId,
      connectionId,
      projectId: Number(row["provider_project_id"]),
      version: Number(row["selection_version"]),
      enabled: row["enabled"],
    });
  }
  list(
    connectionId: string,
    limit = 50,
    cursor?: string,
  ): Promise<{
    items: readonly GitlabProjectSelectionV1[];
    nextCursor?: string;
  }> {
    const query = gitlabProjectSelectionListQueryV1Schema.safeParse({
      limit,
      ...(cursor ? { cursor } : {}),
    });
    if (!query.success) return invalid();
    return this.authority.transaction("integrations.read", async (tx) => {
      await this.connection(tx, connectionId, false);
      const rows = (
        await tx.query(
          sql(
            `SELECT provider_project_id,selection_version,enabled FROM gitlab_project_selections
        WHERE connection_id=$1 AND provider_project_id>$2::bigint ORDER BY provider_project_id LIMIT $3`,
            [connectionId, query.data.cursor ?? "0", query.data.limit + 1],
          ),
        )
      ).rows;
      const items = rows
        .slice(0, query.data.limit)
        .map((row) => this.map(connectionId, row));
      return {
        items,
        ...(rows.length > query.data.limit
          ? { nextCursor: String(items.at(-1)?.projectId) }
          : {}),
      };
    });
  }
  /** Enabling requires the exact grant version used for the immediately preceding provider project check. */
  update(
    connectionId: string,
    projectId: number,
    input: UpdateGitlabProjectSelectionV1,
    verifiedGrantVersion?: number,
  ): Promise<GitlabProjectSelectionV1> {
    const parsed = updateGitlabProjectSelectionV1Schema.safeParse(input);
    if (
      !parsed.success ||
      !gitlabProjectIdV1Schema.safeParse(projectId).success ||
      (parsed.data.enabled &&
        (!Number.isSafeInteger(verifiedGrantVersion) ||
          (verifiedGrantVersion ?? 0) < 1))
    )
      return invalid();
    const snapshot = parsed.data;
    return this.authority.transaction("integrations.manage", async (tx) => {
      await this.connection(
        tx,
        connectionId,
        snapshot.enabled,
        verifiedGrantVersion,
      );
      const previous = (
        await tx.query(
          sql(
            `SELECT provider_project_id,selection_version,enabled FROM gitlab_project_selections WHERE connection_id=$1 AND provider_project_id=$2`,
            [connectionId, projectId],
          ),
        )
      ).rows[0];
      if (!previous && !snapshot.enabled) changed();
      if (
        Number(previous?.["selection_version"] ?? 0) !==
        snapshot.expectedVersion
      )
        changed();
      if (snapshot.enabled && previous?.["enabled"] !== true) {
        const count = (
          await tx.query(
            sql(
              `SELECT count(*) AS count FROM gitlab_project_selections WHERE connection_id=$1 AND enabled`,
              [connectionId],
            ),
          )
        ).rows[0]?.["count"];
        if (Number(count) >= 100)
          throw new ApplicationError(
            "conflict",
            "A GitLab connection can have up to 100 selected projects.",
          );
      }
      const row = (
        await tx.query(
          sql(
            `INSERT INTO gitlab_project_selections(connection_id,provider_project_id,selection_version,enabled)
        VALUES($1,$2,1,$3) ON CONFLICT(connection_id,provider_project_id) DO UPDATE
        SET selection_version=gitlab_project_selections.selection_version+1,enabled=EXCLUDED.enabled,updated_at=clock_timestamp()
        RETURNING provider_project_id,selection_version,enabled`,
            [connectionId, projectId, snapshot.enabled],
          ),
        )
      ).rows[0];
      if (!row) changed();
      await tx.query(
        sql(
          `INSERT INTO audit_events(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id)
        VALUES($1,$2,$3,'gitlab.project.selection','integration',$4,'succeeded','Updated GitLab selected project access.',$5)`,
          [
            "audit_" + randomUUID(),
            this.authority.organizationId,
            this.authority.principal.principalId,
            connectionId,
            this.authority.principal.correlationId,
          ],
        ),
      );
      return this.map(connectionId, row);
    });
  }
  assertSelected(
    connectionId: string,
    projectId: number,
    selectionVersion: number,
  ): Promise<void> {
    if (
      !gitlabProjectIdV1Schema.safeParse(projectId).success ||
      !Number.isSafeInteger(selectionVersion) ||
      selectionVersion < 1
    )
      return invalid();
    return this.authority.transaction("integrations.read", async (tx) => {
      await this.connection(tx, connectionId, true);
      const row = (
        await tx.query(
          sql(
            `SELECT selection_version,enabled FROM gitlab_project_selections WHERE connection_id=$1 AND provider_project_id=$2`,
            [connectionId, projectId],
          ),
        )
      ).rows[0];
      if (
        row?.["enabled"] !== true ||
        Number(row["selection_version"]) !== selectionVersion
      )
        changed();
    });
  }
}
